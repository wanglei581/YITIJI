import * as bcrypt from 'bcryptjs'
import type { AuditService } from '../audit/audit.service'
import { PASSWORD_PROOF_STATE } from '../auth/password-proof-state'
import type { PartnerAccountActionRedisService } from '../common/redis/partner-account-action-redis.service'
import type { PrismaService } from '../prisma/prisma.service'
import { internalAccountErrors, type InternalAccountRequestContext } from './internal-accounts.types'

export interface StepUpAdmin {
  id: string
  username: string
  tokenVersion: number
  passwordHash: string
}

/**
 * 账号管理高风险动作前的「管理员本人当前密码」确认（写法同 auth/partner-account-action.service）。
 *
 * - 失败计数与 partner-account-action 共用同一把「管理员密码」锁（5 次 / 5 分钟）：
 *   同一个被盗的管理员登录凭证，不能在两个入口各拿 5 次猜密码的机会。
 * - 每次都必须带密码，不认「10 分钟内验过」——建备用管理员与启停管理员都是低频动作。
 * - 临时密码（别人设的、本人还没改）不算「本人确认」，直接拒。
 */
export async function verifyAdminStepUp(
  deps: { prisma: PrismaService; actionRedis: PartnerAccountActionRedisService; audit: AuditService },
  adminId: string,
  submittedPassword: string,
  context: InternalAccountRequestContext,
  action: string,
): Promise<StepUpAdmin> {
  const admin = await deps.prisma.user.findUnique({
    where: { id: adminId },
    select: {
      id: true,
      username: true,
      role: true,
      enabled: true,
      deletedAt: true,
      tokenVersion: true,
      passwordHash: true,
      passwordProofState: true,
    },
  })
  if (!admin || admin.role !== 'admin' || !admin.enabled || admin.deletedAt) throw internalAccountErrors.actorUnavailable()
  if (admin.passwordProofState === PASSWORD_PROOF_STATE.TEMPORARY) throw internalAccountErrors.actorTemporaryPassword()

  if (!(await deps.actionRedis.reservePasswordAttempt('admin', admin.id))) {
    await auditStepUpFailure(deps.audit, admin.id, context, action, 'locked')
    throw internalAccountErrors.adminCredentialLocked()
  }
  const valid = await bcrypt.compare(submittedPassword, admin.passwordHash).catch(() => false)
  if (!valid) {
    const locked = await deps.actionRedis.isPasswordLocked('admin', admin.id)
    await auditStepUpFailure(deps.audit, admin.id, context, action, locked ? 'locked' : 'invalid')
    throw locked ? internalAccountErrors.adminCredentialLocked() : internalAccountErrors.adminCredentialInvalid()
  }
  await deps.actionRedis.clearPasswordFailures('admin', admin.id)
  return { id: admin.id, username: admin.username, tokenVersion: admin.tokenVersion, passwordHash: admin.passwordHash }
}

async function auditStepUpFailure(
  audit: AuditService,
  adminId: string,
  context: InternalAccountRequestContext,
  action: string,
  result: 'invalid' | 'locked',
): Promise<void> {
  await audit.write({
    actorId: adminId,
    actorRole: 'admin',
    action: 'user.step_up_failed',
    targetType: 'user',
    targetId: adminId,
    payload: { action, result },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    requestId: context.requestId,
  })
}
