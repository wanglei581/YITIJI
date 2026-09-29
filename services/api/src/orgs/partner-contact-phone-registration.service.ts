/**
 * 管理员为「只有临时密码、还没自己验证手机」的机构账号登记联系人手机。
 *
 * 不能放进 admin-orgs.service.ts：那个文件已经 960 行以上，超过 800 行不得再加功能，
 * 任务也明确要求逻辑单独成文件。
 *
 * 登记成功只写入号码和「管理员登记、本人尚未自证」的时间，不发验证码给管理员。
 * 随后给该号码发一条知会短信。本人之后用找回密码收验证码，成功才算自己证明过这个号码。
 */
import { maskPhoneFromEnc } from '../common/crypto/phone-identity'
import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { PartnerAccountActionService } from '../auth/partner-account-action.service'
import { PASSWORD_PROOF_STATE } from '../auth/password-proof-state'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import {
  encryptPhone,
  hashPhone,
  isValidCnMobile,
  maskPhone,
  normalizePhone,
} from '../common/crypto/phone-identity'
import { SMS_SENDER, type SmsSender } from '../member-auth/sms/sms-sender'
import { PrismaService } from '../prisma/prisma.service'
import { contactPhoneRecentlyChanged } from './contact-phone-change'
import type { RegisterPartnerContactPhoneDto } from './dto/register-partner-contact-phone.dto'

const LETTER_PATTERN = /^[A-Za-z0-9\-/]{4,64}$/
const NOTICE_UNAVAILABLE = '知会短信暂时发不出，暂不能登记'

export interface PartnerContactPhoneRegistrationResult {
  accountId: string
  phoneMasked: string
  registeredAt: string
}

interface RegistrationInput {
  phone: string
  confirmationLetterNo: string
  currentPassword: string
}

@Injectable()
export class PartnerContactPhoneRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly actions: PartnerAccountActionService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
  ) {}

  async register(
    orgId: string,
    accountId: string,
    input: RegistrationInput | RegisterPartnerContactPhoneDto,
    actor: AuthedUser,
  ): Promise<PartnerContactPhoneRegistrationResult> {
    if (actor.role !== 'admin') {
      throw new ForbiddenException({
        error: { code: 'ADMIN_REQUIRED', message: '只有管理员可以登记机构联系人手机' },
      })
    }
    const phone = this.normalizeSubmittedPhone(input.phone)
    const confirmationLetterNo = this.normalizeLetter(input.confirmationLetterNo)
    this.assertPasswordPresent(input.currentPassword)
    this.assertNoticeConfigured()

    const admin = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: {
        id: true,
        role: true,
        enabled: true,
        deletedAt: true,
        tokenVersion: true,
        passwordHash: true,
      },
    })
    if (!admin || admin.role !== 'admin' || !admin.enabled || admin.deletedAt) {
      throw new ForbiddenException({
        error: { code: 'ADMIN_REQUIRED', message: '只有管理员可以登记机构联系人手机' },
      })
    }
    await this.actions.confirmAdminCurrentPassword(admin, input.currentPassword)

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, contactPhone: true, contactPhoneChangedAt: true },
    })
    const account = await this.prisma.user.findFirst({
      where: { id: accountId, deletedAt: null },
      select: {
        id: true,
        role: true,
        orgId: true,
        enabled: true,
        passwordProofState: true,
        phoneHash: true,
        phoneVerifiedAt: true,
        phoneRegisteredByAdminAt: true,
        phoneEnc: true,
      },
    })
    if (!org || !account || !this.eligible(account, orgId)) this.notEligible()
    if (normalizePhone(org.contactPhone ?? '') !== phone) {
      throw this.error(
        HttpStatus.BAD_REQUEST,
        'CONTACT_PHONE_MISMATCH',
        '手机号和机构确认函上登记的联系人手机不一致，请先核对机构资料',
      )
    }
    if (contactPhoneRecentlyChanged(org.contactPhoneChangedAt, new Date())) {
      throw this.error(
        HttpStatus.CONFLICT,
        'CONTACT_PHONE_RECENTLY_CHANGED',
        '机构联系人手机 24 小时内改过，请过 24 小时再登记',
      )
    }

    const phoneHash = hashPhone(phone)
    const replacedUnverified = Boolean(account.phoneHash) && account.phoneRegisteredByAdminAt == null && account.phoneHash !== phoneHash
    const phoneMasked = maskPhone(phone)
    const taken = await this.prisma.user.findFirst({
      where: { phoneHash, NOT: { id: accountId } },
      select: { id: true },
    })
    if (taken) this.phoneInUse()

    const registeredAt = new Date()
    try {
      await this.prisma.$transaction(async (tx) => {
        const raced = await tx.user.findFirst({
          where: { phoneHash, NOT: { id: accountId } },
          select: { id: true },
        })
        if (raced) this.phoneInUse()
        const updated = await tx.user.updateMany({
          where: {
            id: accountId,
            orgId,
            role: 'partner',
            enabled: true,
            deletedAt: null,
            passwordProofState: PASSWORD_PROOF_STATE.TEMPORARY,
            phoneVerifiedAt: null,
          },
          data: {
            phoneHash,
            phoneEnc: encryptPhone(phone),
            phoneRegisteredByAdminAt: registeredAt,
            phoneVerifiedAt: null,
          },
        })
        if (updated.count !== 1) this.notEligible()
        await this.audit.writeRequired(tx, {
          actorId: actor.userId,
          actorRole: 'admin',
          action: 'partner_account.contact_phone_registered',
          targetType: 'organization',
          targetId: orgId,
          payload: {
            orgId,
            accountId,
            phoneMasked,
            confirmationLetterNo,
            // 覆盖了建号时填的、未经验证的号：记下来，只记脱敏号。
            replacedUnverifiedPhone: replacedUnverified,
            ...(replacedUnverified && account.phoneEnc ? { previousPhoneMasked: maskPhoneFromEnc(account.phoneEnc) } : {}),
          },
        })
      })
    } catch (error) {
      if (error instanceof HttpException) throw error
      if (isUniqueConflict(error)) this.phoneInUse()
      throw error
    }

    try {
      await this.sms.sendPartnerPhoneRegisteredNotice(phone, org.name)
    } catch {
      await this.revertRegistration(orgId, accountId, phoneHash, phoneMasked, confirmationLetterNo, actor.userId)
      throw this.error(HttpStatus.SERVICE_UNAVAILABLE, 'CONTACT_PHONE_NOTICE_UNAVAILABLE', NOTICE_UNAVAILABLE)
    }

    return { accountId, phoneMasked, registeredAt: registeredAt.toISOString() }
  }

  private eligible(
    account: {
      role: string
      orgId: string | null
      enabled: boolean
      passwordProofState: string
      phoneHash: string | null
      phoneVerifiedAt: Date | null
      phoneRegisteredByAdminAt: Date | null
    },
    orgId: string,
  ): boolean {
    if (account.role !== 'partner' || account.orgId !== orgId || !account.enabled) return false
    if (account.passwordProofState !== PASSWORD_PROOF_STATE.TEMPORARY) return false
    // 与 admin-org-account-view.ts 的 canRegisterContactPhone 同一口径：手机未经本人自证即可登记，
    // 含建号时填了但未验证的号（登记时用确认函上的号覆盖，审计记下覆盖了什么）。
    return !account.phoneVerifiedAt
  }

  private async revertRegistration(
    orgId: string,
    accountId: string,
    phoneHash: string,
    phoneMasked: string,
    confirmationLetterNo: string,
    actorId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const cleared = await tx.user.updateMany({
        where: { id: accountId, phoneVerifiedAt: null, phoneHash },
        data: { phoneHash: null, phoneEnc: null, phoneRegisteredByAdminAt: null },
      })
      if (cleared.count !== 1) return
      await this.audit.writeRequired(tx, {
        actorId,
        actorRole: 'admin',
        action: 'partner_account.contact_phone_registration_reverted',
        targetType: 'organization',
        targetId: orgId,
        payload: { orgId, accountId, phoneMasked, confirmationLetterNo },
      })
    })
  }

  private assertNoticeConfigured(): void {
    if (process.env['NODE_ENV'] === 'production' && !process.env['SMS_TEMPLATE_PARTNER_PHONE_REGISTERED']?.trim()) {
      throw this.error(HttpStatus.SERVICE_UNAVAILABLE, 'CONTACT_PHONE_NOTICE_UNAVAILABLE', NOTICE_UNAVAILABLE)
    }
  }

  private normalizeSubmittedPhone(value: unknown): string {
    const phone = typeof value === 'string' ? normalizePhone(value) : ''
    if (!isValidCnMobile(phone)) {
      throw this.error(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', '请填写中国大陆手机号')
    }
    return phone
  }

  private normalizeLetter(value: unknown): string {
    const letter = typeof value === 'string' ? value.replace(/\s+/g, '') : ''
    if (!LETTER_PATTERN.test(letter)) {
      throw this.error(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        '确认函编号应为 4 到 64 位字母、数字、横线或斜线',
      )
    }
    return letter
  }

  private assertPasswordPresent(value: unknown): void {
    if (typeof value !== 'string' || value.length < 1 || value.length > 72) {
      throw this.error(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', '请填写管理员本人密码')
    }
  }

  private notEligible(): never {
    throw this.error(HttpStatus.CONFLICT, 'PARTNER_CONTACT_PHONE_NOT_ELIGIBLE', '这个账号现在不能登记手机号')
  }

  private phoneInUse(): never {
    throw this.error(HttpStatus.CONFLICT, 'PHONE_IN_USE', '这个手机号已被其他账号使用')
  }

  private error(status: HttpStatus, code: string, message: string): HttpException {
    return new HttpException({ error: { code, message } }, status)
  }
}

function isUniqueConflict(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    if ('code' in current && (current as { code?: unknown }).code === 'P2002') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}
