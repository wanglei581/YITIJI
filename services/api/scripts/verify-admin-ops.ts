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
 *   4. 确认/静默/关闭持久化；确认后默认 open 视图消失，all 视图仍标「问题仍在发生」。
 *   5. 已退款失败单（Order.payStatus=refunded，printOutcome 仍为空）不再报警。
 *   6. episode 不一致拒绝；处理动作写审计。
 *
 * 运行:pnpm --filter @ai-job-print/api verify:admin-ops
 */
import 'reflect-metadata'
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { Module } from '@nestjs/common'
import { NestFactory, Reflector } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AuditService } from '../src/audit/audit.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { AdminAlertActionsService } from '../src/admin-ops/admin-alert-actions.service'
import { AdminOpsController } from '../src/admin-ops/admin-ops.controller'
import { AdminOpsService } from '../src/admin-ops/admin-ops.service'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { RedisService } from '../src/common/redis/redis.service'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

function errorCode(err: unknown): string | undefined {
  const e = err as {
    message?: string
    response?: { error?: { code?: string } }
    getResponse?: () => { error?: { code?: string } }
  }
  return e.response?.error?.code ?? e.getResponse?.()?.error?.code ?? e.message
}

function mockOpsPrisma(terminalRows: unknown[], printRows: unknown[] = []): PrismaService {
  return {
    terminal: { findMany: async () => terminalRows },
    printTask: { findMany: async () => printRows },
    terminalHeartbeat: { groupBy: async () => [] },
    alertDisposition: {
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
    },
  } as unknown as PrismaService
}

async function verifyHealthyPrinterStatusesDoNotAlert(): Promise<void> {
  const now = new Date()
  for (const printerStatus of ['ok', 'ready', 'idle']) {
    const service = new AdminOpsService(mockOpsPrisma([{
      id: `term_vop_healthy_${printerStatus}`,
      terminalCode: `VOP-HEALTHY-${printerStatus}`,
      registeredAt: now,
      heartbeats: [{ createdAt: now, printerStatus }],
    }]))
    const { data } = await service.listDerivedAlerts()
    if (data.some((alert) => alert.type === 'printer_issue')) {
      fail(`3. 健康打印机状态 ${printerStatus} 不应产生 printer_issue 告警`)
    }
  }
  pass('3a. 健康打印机状态(ok/ready/idle)不产生 printer_issue 告警')
}

async function main() {
  console.log('\n=== 阶段1E Admin 运营视图验证 ===')

  await verifyHealthyPrinterStatusesDoNotAlert()
  if (process.env.ADMIN_OPS_ALERT_HEALTH_ONLY === '1') return

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const svc = new AdminOpsService(prisma)
  const actions = new AdminAlertActionsService(prisma, new AuditService(prisma))

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const tOffline = `term_vop_off_${suffix}`
  const tOnline = `term_vop_on_${suffix}`
  const tPrinterIssue = `term_vop_pi_${suffix}`
  const adminId = `user_vop_adm_${suffix}`
  const taskOk = `pt_vop_ok_${suffix}`
  const taskFailed = `pt_vop_fail_${suffix}`
  const taskVerified = `pt_vop_verified_${suffix}`
  const taskRefunded = `pt_vop_refunded_${suffix}`
  const ordRefunded = `ord_vop_refunded_${suffix}`
  const subjectKeys = [
    `terminal_offline:${tOffline}`,
    `printer_issue:${tPrinterIssue}`,
    `print_failed:${taskFailed}`,
    `print_failed:${taskRefunded}`,
  ]

  await prisma.user.create({
    data: {
      id: adminId,
      username: `vop_admin_${suffix}`,
      name: `VOP Admin ${suffix}`,
      passwordHash: 'hash',
      role: 'admin',
      enabled: true,
      tokenVersion: 0,
    },
  })

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
      { terminalId: tPrinterIssue, printerStatus: 'ok', createdAt: new Date(Date.now() - 20 * 60 * 1000) },
      { terminalId: tPrinterIssue, printerStatus: 'paper_empty', createdAt: new Date() },
    ],
  })

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
      {
        id: taskVerified, terminalId: tOnline, fileUrl: 'https://internal/secret-url-3', fileMd5: 'verified',
        paramsJson: '{}', status: 'failed', errorCode: 'PRINT_JOB_UNCONFIRMED', printOutcome: 'printed',
      },
      {
        id: taskRefunded, terminalId: tOnline, fileUrl: 'https://internal/secret-url-4', fileMd5: 'refunded',
        paramsJson: '{}', status: 'failed', errorCode: 'PRINTER_OFFLINE',
      },
    ],
  })
  await prisma.order.create({
    data: {
      id: ordRefunded,
      orderNo: `ORD-VOP-R-${suffix.toUpperCase()}`,
      type: 'print',
      printTaskId: taskRefunded,
      terminalId: tOnline,
      amountCents: 100,
      currency: 'CNY',
      payStatus: 'refunded',
      taskStatus: 'failed',
      paymentSource: 'sandbox',
      discountCents: 0,
    },
  })

  const cleanup = async () => {
    await prisma.alertDisposition.deleteMany({ where: { subjectKey: { in: subjectKeys } } })
    await prisma.auditLog.deleteMany({ where: { targetId: { in: subjectKeys } } })
    await prisma.order.deleteMany({ where: { id: ordRefunded } })
    await prisma.printTask.deleteMany({ where: { id: { in: [taskOk, taskFailed, taskVerified, taskRefunded] } } })
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId: { in: [tOffline, tOnline, tPrinterIssue] } } })
    await prisma.terminal.deleteMany({ where: { id: { in: [tOffline, tOnline, tPrinterIssue] } } })
    await prisma.user.deleteMany({ where: { id: adminId } })
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
      if (data.some((a) => a.id === `print_failed:${taskVerified}`)) fail('3. 已核查任务不得再进失败告警')
      if (data.some((a) => a.terminalCode === `VOP-ON-${suffix}` && a.type !== 'print_failed')) {
        fail('3. 在线正常终端不应产生终端/打印机告警')
      }
      if (data.some((a) => a.id === `print_failed:${taskRefunded}`)) fail('3. 已退款失败单不得再进告警')
      if (offline.conditionState !== 'firing' || offline.handlingState !== 'open') fail('3. 新告警应为 firing + open')
      pass('3. 派生告警:离线(error)/缺纸(warning)/打印失败齐全,正常终端无告警')
    }

    // ── 4. 确认持久化，确认 ≠ 恢复 ──────────────────────────────────────
    {
      const openList = await svc.listDerivedAlerts('open')
      const offline = openList.data.find((a) => a.id === `terminal_offline:${tOffline}`)
      if (!offline) fail('4. 确认前应能看到离线告警')
      const first = await actions.dispose({
        subjectKey: offline.subjectKey,
        episodeToken: offline.episodeToken,
        action: 'acknowledge',
      }, adminId)
      if (first.idempotent || first.handlingState !== 'acknowledged' || first.conditionState !== 'firing') {
        fail(`4. 首次确认返回异常：${JSON.stringify(first)}`)
      }
      const again = await actions.dispose({
        subjectKey: offline.subjectKey,
        episodeToken: offline.episodeToken,
        action: 'acknowledge',
      }, adminId)
      if (!again.idempotent) fail('4. 重复确认应幂等')
      const afterOpen = await svc.listDerivedAlerts('open')
      if (afterOpen.data.some((a) => a.id === offline.id)) fail('4. 确认后不应再出现在待处理列表')
      const afterAck = await svc.listDerivedAlerts('acknowledged')
      const still = afterAck.data.find((a) => a.id === offline.id)
      if (!still) fail('4. 确认后应能在已确认列表看到')
      if (still.conditionState !== 'firing' || still.handlingState !== 'acknowledged') fail('4. 确认后不得把仍离线说成已恢复')
      if (afterAck.firingCount < 1) fail('4. firingCount 应计入仍在发生的已确认告警')
      try {
        await actions.dispose({
          subjectKey: offline.subjectKey,
          episodeToken: 'not-the-current-episode',
          action: 'acknowledge',
        }, adminId)
        fail('4. 错误 episode 应被拒绝')
      } catch (err) {
        if (errorCode(err) !== 'ALERT_EPISODE_CHANGED') fail(`4. 期望 ALERT_EPISODE_CHANGED，得到 ${errorCode(err)}`)
      }
      const audits = await prisma.auditLog.findMany({
        where: { action: 'alert.acknowledge', targetId: offline.subjectKey },
      })
      if (audits.length !== 1) fail(`4. 确认审计应写 1 条，实际 ${audits.length}`)
      pass('4. 确认持久化、待处理消失、仍标问题在发生、错 episode 拒绝、审计 1 条')
    }

    // ── 5. 静默 / 关闭 / 恢复后再发 ────────────────────────────────────
    {
      const failed = (await svc.listDerivedAlerts('open')).data.find((a) => a.id === `print_failed:${taskFailed}`)
      if (!failed) fail('5. 缺少可关闭的失败告警')
      await actions.dispose({
        subjectKey: failed.subjectKey,
        episodeToken: failed.episodeToken,
        action: 'close',
      }, adminId)
      const afterClose = await svc.listDerivedAlerts('open')
      if (afterClose.data.some((a) => a.id === failed.id)) fail('5. 关闭后待处理仍能看到失败告警')
      const hidden = (await svc.listDerivedAlerts('suppressed')).data.find((a) => a.id === failed.id)
      if (!hidden || hidden.handlingState !== 'closed' || hidden.conditionState !== 'firing') {
        fail('5. 关闭后仍应能看到「已关闭但问题仍在发生」')
      }
      const closeAudits = await prisma.auditLog.findMany({
        where: { action: 'alert.close', targetId: failed.subjectKey },
      })
      if (closeAudits.length !== 1) fail('5. 关闭审计未写入')

      const issue = (await svc.listDerivedAlerts('open')).data.find((a) => a.id === `printer_issue:${tPrinterIssue}`)
      if (!issue) fail('5. 缺少打印机异常告警')
      await actions.dispose({
        subjectKey: issue.subjectKey,
        episodeToken: issue.episodeToken,
        action: 'silence',
        duration: '1h',
      }, adminId)
      if ((await svc.listDerivedAlerts('open')).data.some((a) => a.id === issue.id)) fail('5. 静默后仍在待处理')
      const silenced = (await svc.listDerivedAlerts('suppressed')).data.find((a) => a.id === issue.id)
      if (!silenced || silenced.handlingState !== 'silenced' || !silenced.silencedUntil) fail('5. 静默态未持久化')

      const recoveredAt = new Date()
      await prisma.terminalHeartbeat.create({
        data: { terminalId: tPrinterIssue, printerStatus: 'ok', createdAt: recoveredAt },
      })
      const recovered = await svc.listDerivedAlerts('all')
      if (recovered.data.some((a) => a.id === issue.id)) fail('5. 打印机恢复后不应再派生 printer_issue')
      const stale = await prisma.alertDisposition.findUnique({ where: { subjectKey: issue.subjectKey } })
      if (!stale?.recoveredAt) fail('5. 恢复后应把 disposition.recoveredAt 写上')
      await prisma.terminalHeartbeat.create({
        data: { terminalId: tPrinterIssue, printerStatus: 'paper_empty', createdAt: new Date(recoveredAt.getTime() + 1000) },
      })
      const recurred = (await svc.listDerivedAlerts('open')).data.find((a) => a.id === issue.id)
      if (!recurred) fail('5. 恢复后再缺纸应作为新一轮待处理告警')
      if (recurred.handlingState !== 'open') fail('5. 新一轮故障不得继承旧静默')
      if (recurred.episodeToken === issue.episodeToken) fail('5. 新一轮 episodeToken 应变化')
      pass('5. 关闭/静默持久化、恢复后消失、再发作为新一轮待处理')
    }

    // ── 6. HTTP：造告警 → 确认 → 再查列表 ────────────────────────────────
    {
      process.env['JWT_SECRET'] ||= 'dev-only-secret-please-replace-in-prod-min-16-chars'
      const jwtSecret = process.env['JWT_SECRET']
      const redisStub = {
        get: async () => null,
        del: async () => 0,
        setJsonIfVersionNotOlder: async () => 'stored' as const,
      }
      const httpPrisma = new PrismaService()
      await httpPrisma.onModuleInit()
      @Module({
        imports: [JwtModule.register({ secret: jwtSecret, signOptions: { expiresIn: '30m' } })],
        controllers: [AdminOpsController],
        providers: [
          { provide: PrismaService, useValue: httpPrisma },
          AdminOpsService,
          AdminAlertActionsService,
          AuditService,
          JwtAuthGuard,
          RolesGuard,
          Reflector,
          { provide: RedisService, useValue: redisStub },
        ],
      })
      class AlertHttpModule {}

      const app = await NestFactory.create<NestExpressApplication>(AlertHttpModule, { logger: ['error'] })
      app.setGlobalPrefix('api/v1')
      app.useGlobalFilters(new HttpExceptionFilter())
      await app.listen(0, '127.0.0.1')
      try {
        const base = `${(await app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`
        const jwt = app.get(JwtService)
        const token = jwt.sign({ sub: adminId, ver: 0, jti: randomUUID() })
        const auth = { Authorization: `Bearer ${token}`, Accept: 'application/json' }

        const unauth = await fetch(`${base}/admin/alerts`)
        if (unauth.status !== 401) fail(`6. 无 token 应为 401，得到 ${unauth.status}`)

        const beforeRes = await fetch(`${base}/admin/alerts?view=open`, { headers: auth })
        const before = await beforeRes.json() as { data: Array<{ id: string; subjectKey: string; episodeToken: string; handlingState: string; conditionState: string }>; firingCount: number; openCount: number }
        if (beforeRes.status !== 200) fail(`6. GET open 失败：${beforeRes.status} ${JSON.stringify(before)}`)
        const target = before.data.find((a) => a.id === `printer_issue:${tPrinterIssue}`)
        if (!target) fail('6. HTTP 待处理列表缺少新一轮打印机异常')

        const postRes = await fetch(`${base}/admin/alerts/disposition`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subjectKey: target.subjectKey,
            episodeToken: target.episodeToken,
            action: 'acknowledge',
          }),
        })
        const posted = await postRes.json() as { handlingState?: string; conditionState?: string; idempotent?: boolean }
        if (postRes.status !== 200) fail(`6. POST 确认失败：${postRes.status} ${JSON.stringify(posted)}`)
        if (posted.handlingState !== 'acknowledged' || posted.conditionState !== 'firing' || posted.idempotent !== false) {
          fail(`6. POST 确认响应不诚实：${JSON.stringify(posted)}`)
        }

        const afterOpenRes = await fetch(`${base}/admin/alerts?view=open`, { headers: auth })
        const afterOpen = await afterOpenRes.json() as { data: Array<{ id: string }> }
        if (afterOpen.data.some((a) => a.id === target.id)) fail('6. HTTP 确认后待处理仍能看到该条')

        const afterAckRes = await fetch(`${base}/admin/alerts?view=acknowledged`, { headers: auth })
        const afterAck = await afterAckRes.json() as { data: Array<{ id: string; handlingState: string; conditionState: string }>; firingCount: number }
        const still = afterAck.data.find((a) => a.id === target.id)
        if (!still) fail('6. HTTP 确认后已确认列表看不到该条')
        if (still.handlingState !== 'acknowledged' || still.conditionState !== 'firing') fail('6. HTTP 确认后把仍在发生说成已恢复')
        if (afterAck.firingCount < 1) fail('6. HTTP firingCount 未计入仍在发生的已确认告警')
        pass('6. HTTP 造告警→确认→待处理消失、已确认仍标问题在发生')
      } finally {
        await app.close()
        await httpPrisma.onModuleDestroy?.()
      }
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
