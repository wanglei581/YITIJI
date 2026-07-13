/**
 * cloud_upload 能力键存量盘点（只读，词汇债治理 ②，2026-07-12 D4 拍板方向的后续步骤）。
 *
 * 纯只读查询，不写库，不需要 --apply。用于在执行 next-tasks.md「cloud_upload 并入
 * phone_upload」④ 移除旧键之前，确认目标数据库（预生产 / 生产 PostgreSQL）里是否还有
 * 管理员配置过 cloud_upload 的终端；本脚本报告 0 行只是移除该键的前提条件之一，
 * 还需人工确认代码引用已清零。移除本身不在本脚本范围内，须另起独立任务执行。
 *
 * 运行（默认读取 .env 里的 DATABASE_URL，本地为 SQLite dev.db）：
 *   pnpm --filter @ai-job-print/api audit:cloud-upload-capability-usage
 *
 * 指向生产/预生产 PostgreSQL（只读查询，不做任何写入，但仍建议先确认账号只有读权限）：
 *   DATABASE_URL="$POSTGRES_URL" pnpm --filter @ai-job-print/api audit:cloud-upload-capability-usage
 */
import 'dotenv/config'
import { PrismaService } from '../src/prisma/prisma.service'

async function main() {
  const prisma = new PrismaService()
  await prisma.onModuleInit()

  try {
    const cloudRows = await prisma.terminalCapability.findMany({
      where: { capabilityKey: 'cloud_upload' },
      select: { terminalId: true, status: true, note: true, updatedAt: true, updatedBy: true },
      orderBy: { updatedAt: 'desc' },
    })

    console.log('\n=== cloud_upload 能力键存量盘点（只读） ===')
    console.log(`数据库: ${process.env['DATABASE_URL'] ?? '(未设置，检查 .env)'}`)

    if (cloudRows.length === 0) {
      console.log('结果: 0 行 —— 当前目标库无任何终端配置过 cloud_upload。')
      console.log('可据此认为该库具备移除 cloud_upload 键的前提条件之一（仍需另行确认代码引用已清零后再执行④）。')
      return
    }

    console.log(`结果: ${cloudRows.length} 个终端曾配置 cloud_upload，详情如下：`)
    for (const row of cloudRows) {
      const terminal = await prisma.terminal.findUnique({
        where: { id: row.terminalId },
        select: { terminalCode: true },
      })
      const phoneRow = await prisma.terminalCapability.findUnique({
        where: { terminalId_capabilityKey: { terminalId: row.terminalId, capabilityKey: 'phone_upload' } },
        select: { status: true },
      })
      const phoneNote = phoneRow
        ? `phone_upload 自身已配置(status=${phoneRow.status})，不依赖 cloud_upload 兼容读取`
        : 'phone_upload 未自行配置，读取时会兼容展示此 cloud_upload 状态'
      console.log(
        `  - 终端 ${terminal?.terminalCode ?? row.terminalId}：status=${row.status}` +
          `${row.note ? ` note="${row.note}"` : ''} updatedAt=${row.updatedAt.toISOString()} updatedBy=${row.updatedBy}` +
          ` | ${phoneNote}`,
      )
    }
    console.log('\n移除 cloud_upload 键前，需人工确认以上每个终端的历史配置是否可以直接丢弃，')
    console.log('或先手工把状态迁移到 phone_upload 自身配置，再执行移除。本脚本不做任何写入。')
  } finally {
    await prisma.onModuleDestroy()
  }
}

main().catch((err) => {
  console.error('盘点失败:', err)
  process.exit(1)
})
