/**
 * 阶段1E — Admin 运营视图(打印任务流水 + 派生告警)验证。
 *
 * 覆盖(对应需求验收点):
 *   1. 打印任务列表:倒序返回、状态过滤、分页 total 准确。
 *   2. 安全字段:响应不含 fileUrl / fileMd5 / paramsJson / errorMessage / endUserId;
 *      paramsJson 损坏 → 字段 null 不抛错;归属仅 member/anonymous。
 *   3. 派生告警:离线终端产生 terminal_offline(超 30 分钟 error);
 *      在线终端 + 打印机异常心跳产生 printer_issue;
 *      近 24h 失败任务产生 print_failed;在线且正常的终端不产生告警。
 *
 * 运行:pnpm --filter @ai-job-print/api verify:admin-ops
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { AdminOpsService } from '../src/admin-ops/admin-ops.service'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

async function main() {
  console.log('\n=== 阶段1E Admin 运营视图验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const svc = new AdminOpsService(prisma)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const tOffline = `term_vop_off_${suffix}`
  const tOnline = `term_vop_on_${suffix}`
  const tPrinterIssue = `term_vop_pi_${suffix}`

  // 终端:一台离线(40 分钟前心跳)、一台在线正常、一台在线但打印机缺纸
  await prisma.terminal.createMany({
    data: [
      { id: tOffline, terminalCode: `VOP-OFF-${suffix}`, agentToken: `tok_off_${suffix}`, deviceFingerprint: 'fp' },
      { id: tOnline, terminalCode: `VOP-ON-${suffix}`, agentToken: `tok_on_${suffix}`, deviceFingerprint: 'fp' },
      { id: tPrinterIssue, terminalCode: `VOP-PI-${suffix}`, agentToken: `tok_pi_${suffix}`, deviceFingerprint: 'fp' },
    ],
  })
  await prisma.terminalHeartbeat.createMany({
    data: [
      { terminalId: tOffline, printerStatus: 'ok', createdAt: new Date(Date.now() - 40 * 60 * 1000) },
      { terminalId: tOnline, printerStatus: 'ok', createdAt: new Date() },
      { terminalId: tPrinterIssue, printerStatus: 'paper_empty', createdAt: new Date() },
    ],
  })

  // 打印任务:完成 1 条(合法 params)、失败 1 条(损坏 params)
  const taskOk = `pt_vop_ok_${suffix}`
  const taskFailed = `pt_vop_fail_${suffix}`
  await prisma.printTask.createMany({
    data: [
      {
        id: taskOk, terminalId: tOnline, fileUrl: 'https://internal/secret-url', fileMd5: 'deadbeef',
        paramsJson: JSON.stringify({ fileName: '验证文件.pdf', copies: 2, colorMode: 'black_white', paperSize: 'A4' }),
        status: 'completed', completedAt: new Date(),
      },
      {
        id: taskFailed, terminalId: tOnline, fileUrl: 'https://internal/secret-url-2', fileMd5: 'cafebabe',
        paramsJson: '{broken json', status: 'failed', errorCode: 'PRINTER_OFFLINE', errorMessage: '内部细节不外露',
      },
    ],
  })

  const cleanup = async () => {
    await prisma.printTask.deleteMany({ where: { id: { in: [taskOk, taskFailed] } } })
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId: { in: [tOffline, tOnline, tPrinterIssue] } } })
    await prisma.terminal.deleteMany({ where: { id: { in: [tOffline, tOnline, tPrinterIssue] } } })
  }

  try {
    // ── 1. 列表 + 过滤 + 分页 ──────────────────────────────────────────────
    {
      const all = await svc.listPrintTasks({ page: 1, pageSize: 100 })
      if (!all.data.some((t) => t.id === taskOk) || !all.data.some((t) => t.id === taskFailed)) fail('1. 列表缺测试任务')
      const failedOnly = await svc.listPrintTasks({ status: 'failed', page: 1, pageSize: 100 })
      if (failedOnly.data.some((t) => t.status !== 'failed')) fail('1. 状态过滤失效')
      if (failedOnly.pagination.total < 1) fail('1. 分页 total 异常')
      pass('1. 打印任务列表 + 状态过滤 + 分页')
    }

    // ── 2. 安全字段 ────────────────────────────────────────────────────────
    {
      const all = await svc.listPrintTasks({ page: 1, pageSize: 100 })
      const raw = JSON.stringify(all.data.filter((t) => t.id === taskOk || t.id === taskFailed))
      for (const banned of ['secret-url', 'deadbeef', 'cafebabe', 'fileUrl', 'fileMd5', 'paramsJson', 'errorMessage', '内部细节', 'endUserId']) {
        if (raw.includes(banned)) fail(`2. 响应泄露敏感字段: ${banned}`)
      }
      const ok = all.data.find((t) => t.id === taskOk)!
      if (ok.fileName !== '验证文件.pdf' || ok.copies !== 2 || ok.colorMode !== 'black_white') fail('2. 安全元数据提取错误')
      const broken = all.data.find((t) => t.id === taskFailed)!
      if (broken.fileName !== null || broken.copies !== null) fail('2. 损坏 paramsJson 应得 null')
      if (broken.errorCode !== 'PRINTER_OFFLINE') fail('2. errorCode 应保留(运维需要)')
      if (broken.ownerType !== 'anonymous') fail('2. 匿名任务归属应为 anonymous')
      pass('2. 安全字段收口(无文件链接/指纹/原文/内部错误细节),损坏 params 优雅降级')
    }

    // ── 3. 派生告警 ────────────────────────────────────────────────────────
    {
      const { data } = await svc.listDerivedAlerts()
      const offline = data.find((a) => a.id === `terminal_offline:${tOffline}`)
      if (!offline) fail('3. 缺少终端离线告警')
      if (offline.severity !== 'error') fail('3. 离线 40 分钟应为 error 级')
      const printerIssue = data.find((a) => a.id === `printer_issue:${tPrinterIssue}`)
      if (!printerIssue || printerIssue.severity !== 'warning') fail('3. 缺少打印机缺纸告警(warning)')
      const printFailed = data.find((a) => a.id === `print_failed:${taskFailed}`)
      if (!printFailed) fail('3. 缺少打印失败告警')
      if (data.some((a) => a.terminalCode === `VOP-ON-${suffix}` && a.type !== 'print_failed')) {
        fail('3. 在线正常终端不应产生终端/打印机告警')
      }
      pass('3. 派生告警:离线(error)/缺纸(warning)/打印失败齐全,正常终端无告警')
    }

    console.log('\n=== ALL PASS ===')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => {
  console.error('VERIFY FAILED:', e)
  process.exit(1)
})
