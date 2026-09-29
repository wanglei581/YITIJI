import { maskEmailFromEnc } from '../common/crypto/email-identity'
import { maskPhoneFromEnc } from '../common/crypto/phone-identity'
import type { Prisma } from '../generated/prisma/client'
import {
  PASSWORD_PROOF_STATE,
  type PasswordProofState,
} from '../auth/password-proof-state'

export type PartnerAccountVerificationMethod = 'sms' | 'password'

export interface AdminOrgAccount {
  id: string
  username: string
  name: string
  enabled: boolean
  phoneMasked: string | null
  phoneVerifiedAt: string | null
  emailMasked: string | null
  emailVerifiedAt: string | null
  emailVerifyMethod: string | null
  availableActionVerificationMethods: PartnerAccountVerificationMethod[]
  /** 非空 = 管理员已按确认函登记手机号，机构本人还没用「忘记密码」自证。 */
  phoneRegisteredByAdminAt: string | null
  /**
   * 服务端按登记接口同一套资格规则算好；后台按钮只看它，不自行推断。
   * 原始密码状态（passwordProofState）是内部状态，不下发（verify:partner-account-action:schema 钉住）。
   */
  canRegisterContactPhone: boolean
  createdAt: string
}

export const ADMIN_ORG_ACCOUNT_SELECT = {
  id: true,
  username: true,
  name: true,
  enabled: true,
  phoneHash: true,
  phoneEnc: true,
  phoneVerifiedAt: true,
  phoneRegisteredByAdminAt: true,
  emailHash: true,
  emailEnc: true,
  emailVerifiedAt: true,
  emailVerifyMethod: true,
  passwordProofState: true,
  createdAt: true,
} as const satisfies Prisma.UserSelect

interface AdminOrgAccountRow {
  id: string
  username: string
  name: string
  enabled: boolean
  phoneHash: string | null
  phoneEnc: string | null
  phoneVerifiedAt: Date | null
  phoneRegisteredByAdminAt: Date | null
  emailHash: string | null
  emailEnc: string | null
  emailVerifiedAt: Date | null
  emailVerifyMethod: string | null
  passwordProofState: string
  createdAt: Date
}

function normalizePasswordProofState(value: string): PasswordProofState {
  if (value === PASSWORD_PROOF_STATE.TEMPORARY) return PASSWORD_PROOF_STATE.TEMPORARY
  if (value === PASSWORD_PROOF_STATE.OWNER_MANAGED) return PASSWORD_PROOF_STATE.OWNER_MANAGED
  return PASSWORD_PROOF_STATE.LEGACY
}

export function availableMethodsForAccount(
  account: Pick<AdminOrgAccountRow, 'phoneHash' | 'phoneEnc' | 'phoneVerifiedAt' | 'passwordProofState'>,
): PartnerAccountVerificationMethod[] {
  const methods: PartnerAccountVerificationMethod[] = []
  if (account.phoneHash && account.phoneEnc && account.phoneVerifiedAt) methods.push('sms')
  if (account.passwordProofState === PASSWORD_PROOF_STATE.OWNER_MANAGED) methods.push('password')
  return methods
}

export function mapAdminOrgAccount(account: AdminOrgAccountRow): AdminOrgAccount {
  const passwordProofState = normalizePasswordProofState(account.passwordProofState)
  return {
    id: account.id,
    username: account.username,
    name: account.name,
    enabled: account.enabled,
    phoneMasked: account.phoneEnc ? maskPhoneFromEnc(account.phoneEnc) : null,
    phoneVerifiedAt: account.phoneVerifiedAt?.toISOString() ?? null,
    emailMasked: account.emailEnc ? maskEmailFromEnc(account.emailEnc) : null,
    emailVerifiedAt: account.emailVerifiedAt?.toISOString() ?? null,
    emailVerifyMethod: account.emailVerifyMethod,
    availableActionVerificationMethods: availableMethodsForAccount({ ...account, passwordProofState }),
    phoneRegisteredByAdminAt: account.phoneRegisteredByAdminAt?.toISOString() ?? null,
    canRegisterContactPhone: canRegisterContactPhone({ ...account, passwordProofState }),
    createdAt: account.createdAt.toISOString(),
  }
}

export function canRegisterContactPhone(account: {
  enabled: boolean
  phoneHash: string | null
  phoneVerifiedAt: Date | null
  phoneRegisteredByAdminAt: Date | null
  passwordProofState: string
}): boolean {
  if (!account.enabled) return false
  if (account.passwordProofState !== PASSWORD_PROOF_STATE.TEMPORARY) return false
  // 手机没经本人自证就可以登记：没填、管理员已登记、或建号时填了但未验证（W-03 走查 9/29 裁定）。
  // 建号时填的号没经过任何核对、也不能用来登录或找回密码；用与确认函一致的号覆盖只会更严。
  return !account.phoneVerifiedAt
}
