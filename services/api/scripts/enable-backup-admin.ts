/**
 * 服务器端应急启用备用管理员（3.9）。只在主管理员账号登不上、后台里没人能点「启用」时用。
 *
 * 第一步（只查看、签发确认码，不改账号）：
 *   NODE_ENV=production \
 *   BACKUP_ADMIN_EMERGENCY_CONFIRM=ENABLE_BACKUP_ADMIN_IN_EMERGENCY \
 *   BACKUP_ADMIN_EMERGENCY_REASON='主管理员手机丢失，无法登录' \
 *   pnpm --filter @ai-job-print/api backup-admin:emergency-enable
 *
 * 第二步（10 分钟内，核对第一步打印的账号无误后）：同样的命令，再加
 *   BACKUP_ADMIN_EMERGENCY_CODE=<第一步打印的确认码>
 *
 * 护栏与设计理由见 src/admin-internal-accounts/backup-admin-emergency-enable.ts 头注释；
 * 谁能执行、执行后必须做什么见 docs/device/production-deployment-runbook.md §4「备用管理员应急启用」。
 */
import 'dotenv/config'
import { PrismaService } from '../src/prisma/prisma.service'
import {
  BACKUP_ADMIN_EMERGENCY_CONFIRMATION,
  commitBackupAdminEmergencyEnable,
  issueBackupAdminEmergencyCode,
  readBackupAdminEmergencyConfig,
} from '../src/admin-internal-accounts/backup-admin-emergency-enable'

async function main(): Promise<void> {
  const config = readBackupAdminEmergencyConfig(process.env)
  const prisma = new PrismaService()
  if (prisma.dbKind !== 'postgres') throw new Error('BACKUP_ADMIN_EMERGENCY_POSTGRES_REQUIRED')
  await prisma.onModuleInit()
  try {
    if (!config.code) {
      const issued = await issueBackupAdminEmergencyCode(prisma, { reason: config.reason, secret: config.secret })
      console.log(JSON.stringify({ ok: true, step: 'confirm', username: issued.username, phoneMasked: issued.phoneMasked, expiresAt: issued.expiresAt }))
      console.log(`将要启用的备用管理员：${issued.username}（手机 ${issued.phoneMasked}）。本步没有改动任何账号。`)
      console.log('核对无误后，10 分钟内再运行一次同样的命令，并加上：')
      console.log(`  BACKUP_ADMIN_EMERGENCY_CONFIRM=${BACKUP_ADMIN_EMERGENCY_CONFIRMATION} BACKUP_ADMIN_EMERGENCY_CODE=${issued.code}`)
      return
    }
    const enabled = await commitBackupAdminEmergencyEnable(prisma, {
      code: config.code,
      reason: config.reason,
      secret: config.secret,
    })
    console.log(JSON.stringify({ ok: true, step: 'enabled', username: enabled.username, phoneMasked: enabled.phoneMasked }))
    console.log(`备用管理员 ${enabled.username} 已启用。`)
    console.log(`请持有手机 ${enabled.phoneMasked} 的人打开管理后台登录页，点「找回密码」，用短信验证码设置新密码后再登录。`)
    console.log('主账号恢复后，请在后台「内部账号」里把备用管理员重新停用。')
  } finally {
    await prisma.onModuleDestroy()
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
