import { BadRequestException, ConflictException } from '@nestjs/common'
import { hashPhone, isValidCnMobile, normalizePhone } from '../common/crypto/phone-identity'
import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'

/** Shared by both admin creation paths; never marks a phone or password holder as verified. */
export async function assertPartnerAccountIdentifiers(
  prisma: Pick<PrismaService, 'user'> | Pick<PrismaTransactionClient, 'user'>,
  input: { username: string; phone: string },
): Promise<void> {
  const phone = normalizePhone(input.phone)
  if (isValidCnMobile(normalizePhone(input.username)) && input.username !== phone) {
    throw new BadRequestException({ error: { code: 'USERNAME_PHONE_MISMATCH', message: '使用手机号作为用户名时，须与登录手机号相同' } })
  }
  // Keep deleted usernames reserved, as required by the existing database unique constraint.
  if (await prisma.user.findUnique({ where: { username: input.username } })) {
    throw new ConflictException({ error: { code: 'USERNAME_TAKEN', message: `用户名 ${input.username} 已存在` } })
  }
  const occupied = await prisma.user.findFirst({
    where: { deletedAt: null, OR: [{ phoneHash: hashPhone(phone) }, { username: phone }] },
  })
  if (occupied) {
    throw new ConflictException({ error: { code: 'PHONE_ALREADY_BOUND', message: '该手机号或同号用户名已绑定其他账号' } })
  }
}
