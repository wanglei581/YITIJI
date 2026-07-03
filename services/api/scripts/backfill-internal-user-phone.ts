/**
 * 存量内部账号手机号回填。
 *
 * 默认 dry-run。仅在显式传入 --apply 时写库。
 * 回填来源仅使用机构 contactPhone 作为候选值,且不会把手机号标记为已验证;
 * 账号本人仍需登录后通过 /auth/phone/code + /auth/phone/verify 完成持有性验证。
 */
import 'dotenv/config'
import { encryptPhone, hashPhone, isValidCnMobile, normalizePhone } from '../src/common/crypto/phone-identity'
import { PrismaService } from '../src/prisma/prisma.service'

process.env['DATABASE_URL'] ||= 'file:./prisma/dev.db'
process.env['SECRET_ENCRYPTION_KEY'] ||= 'backfill-internal-phone-secret-32b'

interface Candidate {
  userId: string
  username: string
  orgId: string
  phone: string
}

async function main() {
  const apply = process.argv.includes('--apply')
  const prisma = new PrismaService()
  await prisma.onModuleInit()

  try {
    const users = await prisma.user.findMany({
      where: { role: 'partner', phoneHash: null, orgId: { not: null } },
      select: {
        id: true,
        username: true,
        orgId: true,
        org: { select: { contactPhone: true } },
      },
    })

    const candidates: Candidate[] = []
    const skipped: Array<{ username: string; reason: string }> = []
    const seen = new Set<string>()

    for (const user of users) {
      const normalized = normalizePhone(user.org?.contactPhone ?? '')
      if (!isValidCnMobile(normalized)) {
        skipped.push({ username: user.username, reason: '机构联系电话不是有效手机号' })
        continue
      }
      const phoneHash = hashPhone(normalized)
      if (seen.has(phoneHash)) {
        skipped.push({ username: user.username, reason: '本批次手机号重复' })
        continue
      }
      const exists = await prisma.user.findUnique({ where: { phoneHash } })
      if (exists) {
        skipped.push({ username: user.username, reason: '手机号已绑定其他账号' })
        continue
      }
      seen.add(phoneHash)
      candidates.push({
        userId: user.id,
        username: user.username,
        orgId: user.orgId!,
        phone: normalized,
      })
    }

    console.log(`internal phone backfill ${apply ? 'APPLY' : 'DRY-RUN'}`)
    console.log(`candidates=${candidates.length} skipped=${skipped.length}`)
    for (const item of skipped) {
      console.log(`SKIP ${item.username}: ${item.reason}`)
    }

    if (!apply) {
      console.log('未写库。确认候选无误后使用 --apply 执行。')
      return
    }

    for (const item of candidates) {
      await prisma.user.update({
        where: { id: item.userId },
        data: {
          phoneHash: hashPhone(item.phone),
          phoneEnc: encryptPhone(item.phone),
          phoneVerifiedAt: null,
        },
      })
      console.log(`UPDATED ${item.username} org=${item.orgId}`)
    }
  } finally {
    await prisma.onModuleDestroy()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
