/**
 * 机构账号「管理员已登记手机、本人还没短信自证」时，允许走找回密码。
 *
 * 不能放进 auth.service.ts：那个文件已经顶到 800 行，再加这段会越过规模红线。
 * 不改 findVerifiedUserByPhone：登录验证码仍然只认已经自证的手机号。
 */
import { decryptPhone, hashPhone } from '../common/crypto/phone-identity'
import { PrismaService } from '../prisma/prisma.service'
import { PASSWORD_PROOF_STATE } from './password-proof-state'

export interface AdminRegisteredResetPhoneUser {
  role: string
  passwordProofState: string
  phoneEnc: string | null
  phoneVerifiedAt: Date | null
  phoneRegisteredByAdminAt: Date | null
}

/** 只有这一种机构账号可以在手机号尚未自证时找回密码。管理员和其他角色一律不行。 */
export function acceptsAdminRegisteredResetPhone(user: {
  role: string
  passwordProofState: string
  phoneRegisteredByAdminAt: Date | null
  phoneVerifiedAt: Date | null
}): boolean {
  return user.role === 'partner'
    && user.passwordProofState === PASSWORD_PROOF_STATE.TEMPORARY
    && user.phoneRegisteredByAdminAt != null
    && user.phoneVerifiedAt == null
}

export function canResetWithStoredPhone(user: AdminRegisteredResetPhoneUser): boolean {
  return user.phoneVerifiedAt != null || acceptsAdminRegisteredResetPhone(user)
}

export async function findPasswordResetTarget<T extends AdminRegisteredResetPhoneUser>(
  prisma: PrismaService,
  loginIdOrPhone: string,
  normalizedPhone: string | null,
  findVerifiedUserByPhone: (phone: string) => Promise<T | null>,
): Promise<{ user: T; phone: string } | null> {
  if (normalizedPhone) {
    const verified = await findVerifiedUserByPhone(normalizedPhone)
    if (verified) return { user: verified, phone: normalizedPhone }
    const registered = await prisma.user.findFirst({
      where: { phoneHash: hashPhone(normalizedPhone), deletedAt: null },
    })
    if (!registered || !acceptsAdminRegisteredResetPhone(registered)) return null
    return { user: registered as unknown as T, phone: normalizedPhone }
  }

  const user = await prisma.user.findFirst({
    where: { username: loginIdOrPhone.trim(), deletedAt: null },
  })
  if (!user?.phoneEnc || !canResetWithStoredPhone(user)) return null
  return { user: user as unknown as T, phone: decryptPhone(user.phoneEnc) }
}
