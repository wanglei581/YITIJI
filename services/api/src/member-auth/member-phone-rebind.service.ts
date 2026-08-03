import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { encryptPhone, hashPhone, maskPhone, maskPhoneFromEnc } from '../common/crypto/phone-identity'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { MemberStepUpService } from './member-step-up.service'

/**
 * 手机号换绑服务（Wave 2 最小安全版）。
 *
 * 换绑流程（需前端按序调用）：
 *  1. 旧号发起 step-up: POST /member/auth/step-up/sms-code { action: "phone_rebind" }
 *  2. 旧号验证 step-up: POST /member/auth/step-up/verify → stepUpToken
 *  3. 新号请求验证码:  POST /member/auth/sms-code { phone: newPhone }
 *  4. 提交换绑:        POST /member/phone/rebind { stepUpToken, newPhone, newPhoneCode }
 *
 * 安全设计：
 * - 旧号 step-up consumeGrant 原子消费：一个 stepUpToken 只能用一次。
 * - 新号 SMS 验证码通过同一套 Redis 机制（member:sms:code:{hash}）原子读删。
 * - 与已注册账号号码冲突 → 4xx PHONE_CONFLICT（首期禁止自动合并）。
 * - 换绑成功后立即踢出所有旧会话（revokeMemberSessions），防止旧 token 继续使用。
 * - 全程写 AuditLog。
 *
 * 禁止事项：
 * - 不自动合并两个账号的资产（数据一致性风险，留 Wave 3+）。
 * - 不在换绑成功后自动签发新 token（让用户用新号重新登录以完整验证身份）。
 */

const MAX_NEW_PHONE_ATTEMPTS = 5
const SMS_CODE_KEY = (hash: string) => `member:sms:code:${hash}`
const SMS_ATTEMPT_KEY = (hash: string) => `member:sms:attempt:${hash}`

export interface PhoneRebindResult {
  /** 换绑后的脱敏手机号 */
  newPhoneMasked: string
  /** 所有旧会话已失效，前端应清除内存 token 并提示重新登录 */
  sessionsRevoked: number
}

@Injectable()
export class MemberPhoneRebindService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly stepUp: MemberStepUpService,
    private readonly audit: AuditService,
  ) {}

  async rebind(
    endUserId: string,
    stepUpToken: string,
    newPhone: string,
    newPhoneCode: string,
    deviceId?: string,
  ): Promise<PhoneRebindResult> {
    // ── 1. 消费 step-up grant（绑定 phone_rebind 动作）──────────────────
    // consumeGrant 内部先原子消费再复核账号状态；失败抛 STEP_UP_TOKEN_INVALID /
    // ACCOUNT_UNAVAILABLE。一个 token 只能用一次，防重放。
    await this.stepUp.consumeGrant(endUserId, 'phone_rebind', stepUpToken, deviceId)

    // ── 2. 验证新号 SMS 验证码 ─────────────────────────────────────────
    const newPhoneHash = hashPhone(newPhone)
    const attemptKey = SMS_ATTEMPT_KEY(newPhoneHash)
    const attempts = await this.redis.incrWithTtl(attemptKey, 300)
    if (attempts > MAX_NEW_PHONE_ATTEMPTS) {
      await this.redis.del(SMS_CODE_KEY(newPhoneHash))
      await this.redis.del(attemptKey)
      throw new UnauthorizedException({ error: { code: 'REBIND_CODE_LOCKED', message: '新手机验证码尝试次数过多，请重新获取' } })
    }

    const codeStatus = await this.redis.getAndDelIfEquals(SMS_CODE_KEY(newPhoneHash), newPhoneCode)
    if (codeStatus === 'missing') {
      throw new UnauthorizedException({ error: { code: 'REBIND_CODE_EXPIRED', message: '新手机验证码已过期，请重新获取' } })
    }
    if (codeStatus === 'mismatched') {
      throw new UnauthorizedException({ error: { code: 'REBIND_CODE_INVALID', message: '新手机验证码不正确' } })
    }
    // 验证通过，清理尝试计数
    await this.redis.del(attemptKey)

    // ── 3. 账号冲突检查：新号不得已被其他账号使用 ───────────────────────
    const existing = await this.prisma.endUser.findUnique({
      where: { phoneHash: newPhoneHash },
      select: { id: true },
    })
    if (existing && existing.id !== endUserId) {
      throw new ConflictException({ error: { code: 'PHONE_CONFLICT', message: '该手机号已绑定其他账号，无法换绑' } })
    }

    // ── 4. 获取当前手机号用于审计日志 ───────────────────────────────────
    const currentUser = await this.prisma.endUser.findUnique({
      where: { id: endUserId },
      select: { phoneEnc: true, enabled: true, status: true },
    })
    if (!currentUser || !currentUser.enabled || currentUser.status !== 'active') {
      throw new UnauthorizedException({ error: { code: 'ACCOUNT_UNAVAILABLE', message: '账号当前不可用' } })
    }
    const oldPhoneMasked = maskPhoneFromEnc(currentUser.phoneEnc)

    // ── 5. 更新 EndUser 手机号 ──────────────────────────────────────────
    await this.prisma.endUser.update({
      where: { id: endUserId },
      data: {
        phoneHash: newPhoneHash,
        phoneEnc: encryptPhone(newPhone),
        updatedAt: new Date(),
      },
    })

    // ── 6. 踢出所有旧会话（手机号换绑属安全边界变更，必须强制重新登录）──
    const sessionsRevoked = await this.redis.revokeMemberSessions(endUserId)

    // ── 7. 写审计日志 ─────────────────────────────────────────────────
    await this.audit.write({
      actorId: null,
      actorRole: 'end_user',
      action: 'member.phone.rebind',
      targetType: 'EndUser',
      targetId: endUserId,
      payload: {
        endUserId,
        oldPhoneMasked,
        newPhoneMasked: maskPhone(newPhone),
        sessionsRevoked,
      },
    })

    return {
      newPhoneMasked: maskPhone(newPhone),
      sessionsRevoked,
    }
  }
}
