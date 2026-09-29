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
  /** 临时密码且手机尚未本人自证时，后台可以显示「登记手机号」。 */
  contactPhoneRegistrationAvailable: boolean
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
    contactPhoneRegistrationAvailable: contactPhoneRegistrationAvailable({ ...account, passwordProofState }),
    createdAt: account.createdAt.toISOString(),
  }
}

export function contactPhoneRegistrationAvailable(account: {
  enabled: boolean
  phoneHash: string | null
  phoneVerifiedAt: Date | null
  phoneRegisteredByAdminAt: Date | null
  passwordProofState: string
}): boolean {
  if (!account.enabled) return false
  if (account.passwordProofState !== PASSWORD_PROOF_STATE.TEMPORARY) return false
  if (account.phoneVerifiedAt) return false
  const noPhone = account.phoneHash == null || account.phoneHash === ''
  return noPhone || account.phoneRegisteredByAdminAt != null
}
