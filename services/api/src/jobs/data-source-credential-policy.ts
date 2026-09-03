/**
 * 数据源凭证轮换 / Webhook 密钥写入策略。
 *
 * 从 jobs-partner.service.ts 拆出（该文件已超 800 行，CLAUDE.md §8 不得继续堆）。
 * 本文件只含策略与拒写，不含 Prisma 写路径。
 */
import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'
import {
  WEBHOOK_SECRET_MIN_LENGTH,
  normalizeOptionalSecret,
  webhookSecretStrengthIssue,
} from '../common/crypto/webhook-secret-strength'

/** 与 packages/shared 的同名常量必须逐字一致（verify-backend-p0-contracts 对账）。 */
export const ROTATE_CREDENTIAL_CONFIRMATION = 'ROTATE_CREDENTIAL' as const

/** 同一数据源两次成功轮换的最小间隔。新建未满该窗口的源不计入（创建后立即丢密钥要能补救）。 */
export const CREDENTIAL_ROTATION_SOURCE_COOLDOWN_MS = 5 * 60 * 1000

/** 同一机构对「窗口开始前就存在的源」成功轮换的计数窗口。 */
export const CREDENTIAL_ROTATION_ORG_WINDOW_MS = 15 * 60 * 1000

/** 窗口内允许的成功轮换次数。被盗 JWT 一次空 body 不能废掉机构名下全部 webhook。 */
export const CREDENTIAL_ROTATION_ORG_LIMIT = 3

export function assertCredentialRotationConfirmed(phrase: string | undefined): void {
  if (phrase !== ROTATE_CREDENTIAL_CONFIRMATION) {
    throw new BadRequestException({
      error: {
        code: 'CREDENTIAL_ROTATION_CONFIRMATION_REQUIRED',
        message: `轮换必须在请求体提交 confirmPhrase=${ROTATE_CREDENTIAL_CONFIRMATION}；空 body 不会生成新密钥`,
      },
    })
  }
}

export function assertCredentialRotationNotArchived(archivedAt: Date | null): void {
  if (archivedAt != null) {
    throw new BadRequestException({
      error: {
        code: 'DATA_SOURCE_ARCHIVED',
        message: '数据源已归档，无法轮换密钥。紧急停止接收请保持归档；恢复对接请先取消归档再轮换',
      },
    })
  }
}

export function assertCredentialRotationSourceCooldown(source: {
  createdAt: Date
  webhookSecretRotatedAt: Date | null
}): void {
  if (!source.webhookSecretRotatedAt) return
  const now = Date.now()
  // 刚创建的源允许立刻再轮一次：创建响应是唯一一次展示密钥，关掉窗口就只能靠轮换补救。
  if (now - source.createdAt.getTime() < CREDENTIAL_ROTATION_SOURCE_COOLDOWN_MS) return
  const elapsed = now - source.webhookSecretRotatedAt.getTime()
  if (elapsed < CREDENTIAL_ROTATION_SOURCE_COOLDOWN_MS) {
    const waitSec = Math.ceil((CREDENTIAL_ROTATION_SOURCE_COOLDOWN_MS - elapsed) / 1000)
    throw new BadRequestException({
      error: {
        code: 'CREDENTIAL_ROTATION_COOLDOWN',
        message: `该数据源刚刚完成轮换，请 ${waitSec} 秒后再试。紧急停止接收请归档（不会下架已发布内容）`,
      },
    })
  }
}

export async function assertCredentialRotationOrgRateLimit(
  prisma: PrismaService,
  orgId: string,
): Promise<void> {
  const windowStart = new Date(Date.now() - CREDENTIAL_ROTATION_ORG_WINDOW_MS)
  const recent = await prisma.jobSource.count({
    where: {
      orgId,
      webhookSecretRotatedAt: { gte: windowStart },
      // 窗口内新建的源不计入：创建会写 webhookSecretRotatedAt，不能把「建源」当成「轮换」。
      createdAt: { lt: windowStart },
    },
  })
  if (recent >= CREDENTIAL_ROTATION_ORG_LIMIT) {
    throw new HttpException({
      error: {
        code: 'CREDENTIAL_ROTATION_RATE_LIMITED',
        message: `该机构 ${Math.round(CREDENTIAL_ROTATION_ORG_WINDOW_MS / 60000)} 分钟内轮换次数已达上限。紧急停止接收请归档数据源（不会下架已发布内容）`,
      },
    }, HttpStatus.TOO_MANY_REQUESTS)
  }
}

export function assertWebhookSecretStrength(secret: string): void {
  const issue = webhookSecretStrengthIssue(secret)
  if (issue === 'too_short') {
    throw new BadRequestException({
      error: {
        code: 'WEBHOOK_SECRET_TOO_SHORT',
        message: `Webhook 签名密钥至少 ${WEBHOOK_SECRET_MIN_LENGTH} 位；短密钥可被离线撞库。推荐留空由系统生成`,
      },
    })
  }
  if (issue === 'low_entropy') {
    throw new BadRequestException({
      error: {
        code: 'WEBHOOK_SECRET_LOW_ENTROPY',
        message: 'Webhook 签名密钥重复字符过多或模式过于简单，无法抵抗离线撞库。请换一串更随机的密钥，或留空由系统生成',
      },
    })
  }
}

export { normalizeOptionalSecret, WEBHOOK_SECRET_MIN_LENGTH }
