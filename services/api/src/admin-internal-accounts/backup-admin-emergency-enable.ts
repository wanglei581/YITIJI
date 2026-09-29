import { createHmac, timingSafeEqual } from 'node:crypto'
import { maskPhoneFromEnc } from '../common/crypto/phone-identity'
import { dbKindOf } from '../prisma/create-client'
import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'

/**
 * 服务器端应急启用备用管理员（3.9）——主管理员账号登不上、后台里没人能点「启用」时用。
 * CLI 入口：scripts/enable-backup-admin.ts（`pnpm --filter @ai-job-print/api backup-admin:emergency-enable`）。
 * 运维说明：docs/device/production-deployment-runbook.md §4「备用管理员应急启用」。
 *
 * 与 bootstrap:first-admin 同一套护栏：只许 NODE_ENV=production + PostgreSQL、必须输入精确确认短语、
 * 10 分钟有效窗口。窗口的做法不同，理由写在这里：
 *
 * - bootstrap 用「AUTHORIZED_UNTIL 时间戳」：它只在 User 表为空时生效，没有「选错账号」的可能；
 * - 这里是两步：第一次运行只**查出并打印**将被启用的账号（用户名 + 脱敏手机号）并签发确认码，
 *   不改任何账号；10 分钟内带确认码再运行才真正启用。操作人先看清楚再动手。
 * - 确认码不存库、不写文件、不依赖 Redis（出事时 Redis 未必可用）：它是用
 *   SECRET_ENCRYPTION_KEY 派生的 HMAC，绑定「账号 id + 当前 tokenVersion + 过期时间」。
 *   启用一次后 tokenVersion 变了、账号也不再是停用状态，同一个码天然作废（一次性）；
 *   从命令历史里翻出旧码重放也没用。
 *
 * 只能启用「isBackupAdmin=true、未删除、当前停用、手机号已验证」的那一个账号：查找与更新条件
 * 都带 isBackupAdmin=true，命令本身不接受任何账号参数。
 * 启用后该账号仍是随机临时密码（没人知道）：本人必须用备用手机号走「找回密码」设新密码后才能登录。
 */
export const BACKUP_ADMIN_EMERGENCY_CONFIRMATION = 'ENABLE_BACKUP_ADMIN_IN_EMERGENCY'
export const BACKUP_ADMIN_EMERGENCY_WINDOW_MS = 10 * 60 * 1000
export const BACKUP_ADMIN_EMERGENCY_ACTOR_ROLE = 'system-cli'

export interface BackupAdminEmergencyConfig {
  reason: string
  code: string | null
  secret: string
}

export interface BackupAdminEmergencyTarget {
  userId: string
  username: string
  phoneMasked: string
}

export function readBackupAdminEmergencyConfig(env: NodeJS.ProcessEnv): BackupAdminEmergencyConfig {
  if (env.NODE_ENV !== 'production') throw new Error('BACKUP_ADMIN_EMERGENCY_ENV_FORBIDDEN: NODE_ENV must be production')
  const databaseUrl = required(env, 'DATABASE_URL')
  if (dbKindOf(databaseUrl) !== 'postgres') throw new Error('BACKUP_ADMIN_EMERGENCY_POSTGRES_REQUIRED')
  if (required(env, 'BACKUP_ADMIN_EMERGENCY_CONFIRM') !== BACKUP_ADMIN_EMERGENCY_CONFIRMATION) {
    throw new Error(`BACKUP_ADMIN_EMERGENCY_CONFIRMATION_REQUIRED: expected ${BACKUP_ADMIN_EMERGENCY_CONFIRMATION}`)
  }
  const reason = required(env, 'BACKUP_ADMIN_EMERGENCY_REASON')
  const reasonLength = Array.from(reason).length
  if (reasonLength < 2 || reasonLength > 200) throw new Error('BACKUP_ADMIN_EMERGENCY_REASON_INVALID: 2-200 characters')
  const secret = required(env, 'SECRET_ENCRYPTION_KEY')
  if (secret.length < 32) throw new Error('BACKUP_ADMIN_EMERGENCY_SECRET_INVALID')
  const code = env.BACKUP_ADMIN_EMERGENCY_CODE?.trim() || null
  return { reason, code, secret }
}

/** 第一步：查出唯一的停用中备用管理员，签发 10 分钟确认码，记一条审计。不改账号。 */
export async function issueBackupAdminEmergencyCode(
  prisma: PrismaService,
  input: { reason: string; secret: string; now?: Date },
): Promise<BackupAdminEmergencyTarget & { code: string; expiresAt: string }> {
  const now = input.now ?? new Date()
  const candidate = await findDisabledBackupAdmin(prisma)
  const expiresAtMs = now.getTime() + BACKUP_ADMIN_EMERGENCY_WINDOW_MS
  const code = `${expiresAtMs.toString(36)}.${signature(input.secret, candidate.id, candidate.tokenVersion, expiresAtMs)}`
  const target = { userId: candidate.id, username: candidate.username, phoneMasked: maskPhoneFromEnc(candidate.phoneEnc) }
  await prisma.auditLog.create({
    data: {
      actorId: null,
      actorRole: BACKUP_ADMIN_EMERGENCY_ACTOR_ROLE,
      action: 'user.emergency_enable_requested',
      targetType: 'user',
      targetId: candidate.id,
      payloadJson: JSON.stringify({
        username: candidate.username,
        phoneMasked: target.phoneMasked,
        reason: input.reason,
        expiresAt: new Date(expiresAtMs).toISOString(),
      }),
    },
  })
  return { ...target, code, expiresAt: new Date(expiresAtMs).toISOString() }
}

/** 第二步：确认码有效（未过期、绑定的账号与版本没变）才启用，启用与审计同一事务。 */
export async function commitBackupAdminEmergencyEnable(
  prisma: PrismaService,
  input: { code: string; reason: string; secret: string; now?: Date },
): Promise<BackupAdminEmergencyTarget> {
  const now = input.now ?? new Date()
  const parsed = /^([0-9a-z]{1,12})\.([a-f0-9]{32})$/.exec(input.code)
  if (!parsed) throw new Error('BACKUP_ADMIN_EMERGENCY_CODE_INVALID')
  const expiresAtMs = parseInt(parsed[1]!, 36)
  const remaining = expiresAtMs - now.getTime()
  if (!Number.isSafeInteger(expiresAtMs) || remaining <= 0 || remaining > BACKUP_ADMIN_EMERGENCY_WINDOW_MS) {
    throw new Error('BACKUP_ADMIN_EMERGENCY_CODE_EXPIRED: 确认码已超过 10 分钟，请重新运行第一步')
  }
  const candidate = await findDisabledBackupAdmin(prisma)
  const expected = Buffer.from(signature(input.secret, candidate.id, candidate.tokenVersion, expiresAtMs), 'hex')
  const submitted = Buffer.from(parsed[2]!, 'hex')
  if (expected.length !== submitted.length || !timingSafeEqual(expected, submitted)) {
    throw new Error('BACKUP_ADMIN_EMERGENCY_CODE_INVALID')
  }
  const phoneMasked = maskPhoneFromEnc(candidate.phoneEnc)
  await prisma.$transaction(async (tx: PrismaTransactionClient) => {
    const updated = await tx.user.updateMany({
      where: {
        id: candidate.id,
        isBackupAdmin: true,
        role: 'admin',
        enabled: false,
        deletedAt: null,
        tokenVersion: candidate.tokenVersion,
      },
      data: { enabled: true, tokenVersion: { increment: 1 } },
    })
    if (updated.count !== 1) throw new Error('BACKUP_ADMIN_EMERGENCY_STATE_CHANGED: 账号状态刚被修改，请重新运行第一步')
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorRole: BACKUP_ADMIN_EMERGENCY_ACTOR_ROLE,
        action: 'user.enable',
        targetType: 'user',
        targetId: candidate.id,
        payloadJson: JSON.stringify({
          username: candidate.username,
          role: 'admin',
          isBackupAdmin: true,
          reason: input.reason,
          via: 'emergency_cli',
          phoneMasked,
        }),
      },
    })
  })
  return { userId: candidate.id, username: candidate.username, phoneMasked }
}

async function findDisabledBackupAdmin(prisma: PrismaService): Promise<{
  id: string
  username: string
  tokenVersion: number
  phoneEnc: string
}> {
  const candidate = await prisma.user.findFirst({
    where: { isBackupAdmin: true, deletedAt: null },
    select: { id: true, username: true, role: true, enabled: true, tokenVersion: true, phoneEnc: true, phoneVerifiedAt: true },
  })
  if (!candidate || candidate.role !== 'admin') throw new Error('BACKUP_ADMIN_EMERGENCY_NOT_FOUND: 系统里没有备用管理员账号')
  if (candidate.enabled) throw new Error('BACKUP_ADMIN_EMERGENCY_ALREADY_ENABLED: 备用管理员已经是启用状态')
  if (!candidate.phoneEnc || !candidate.phoneVerifiedAt) {
    throw new Error('BACKUP_ADMIN_EMERGENCY_PHONE_NOT_VERIFIED: 备用管理员没有已验证手机号，启用后无法找回密码')
  }
  return { id: candidate.id, username: candidate.username, tokenVersion: candidate.tokenVersion, phoneEnc: candidate.phoneEnc }
}

function signature(secret: string, userId: string, tokenVersion: number, expiresAtMs: number): string {
  const key = createHmac('sha256', secret).update('backup-admin-emergency-enable:v1').digest()
  return createHmac('sha256', key).update(`${userId}|${tokenVersion}|${expiresAtMs}`).digest('hex').slice(0, 32)
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name}_REQUIRED`)
  return value
}
