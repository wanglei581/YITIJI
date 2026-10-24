import { hashEmail } from '../common/crypto/email-identity'
import { hashPhone } from '../common/crypto/phone-identity'
import type { PrismaService } from '../prisma/prisma.service'

/** Password login only: resolve once, then let the existing password/portal guards decide. */
export async function findPasswordLoginUser(
  prisma: Pick<PrismaService, 'user'>,
  loginId: string,
  phone: string | null,
  email: string | null,
) {
  if (phone) {
    const verified = await prisma.user.findFirst({
      where: { phoneHash: hashPhone(phone), phoneVerifiedAt: { not: null }, deletedAt: null },
    })
    // Even an unusable verified account reserves its alias; never try another password target.
    if (verified) return verified
  } else if (email) {
    const user = await prisma.user.findFirst({ where: { emailHash: hashEmail(email), deletedAt: null } })
    return user?.emailVerifiedAt ? user : null
  }
  // A phone-shaped username is still an exact username, not an unverified phone alias.
  return prisma.user.findFirst({ where: { username: loginId.trim(), deletedAt: null } })
}
