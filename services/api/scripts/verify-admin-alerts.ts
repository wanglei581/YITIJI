/**
 * Sprint 1 / Task 3 — Admin 告警中心（alerts）验证。
 *
 * 覆盖：
 *   1. 列表 + 分页（page/pageSize）+ total。
 *   2. 筛选：severity / status / type / keyword（title·message·alertNo contains）。
 *   3. 详情：message / payloadJson / handleNote / 处理人信息；不存在 → ALERT_NOT_FOUND。
 *   4. 处理：new→resolved 写 handledBy/handledAt/handleNote 并回前值；handlerName 由 User 解析；
 *      processing / ignored 同样可标记。
 *   5. 审计（controller 层）：alert.status_change 落 AuditLog（targetType=alert）。
 *
 * 运行：pnpm verify:admin-alerts
 * 直接实例化 service + controller（不触发 onModuleInit 种子），用 tag 隔离本测试数据。
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { AlertsService } from '../src/alerts/alerts.service'
import { AlertsController } from '../src/alerts/alerts.controller'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }
function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}
async function expectCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望抛 ${code}，但未抛`)
  } catch (e) {
    const c = errCode(e)
    if (c === code) pass(label)
    else fail(`${label} — 期望 ${code}，实际：${c ?? (e as Error).message}`)
  }
}

async function main() {
  console.log('\n=== Sprint 1 / Task 3 Admin 告警中心验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const service = new AlertsService(prisma) // 不调 onModuleInit → 不跑种子
  const controller = new AlertsController(service, audit)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
  const tag = `VFY${suffix}`
  const adminUserId = `admin_al_${suffix}`
  const alertIds: string[] = []

  const mkAlert = async (
    n: number, type: string, severity: string, status: string, title: string,
    message: string | null, terminalId: string | null, payloadJson: string | null,
  ): Promise<string> => {
    const a = await prisma.alert.create({
      data: { alertNo: `ALT-${tag}-${n}`, type, severity, status, title, message, terminalId, deviceName: terminalId ? `${terminalId} 设备` : null, payloadJson, occurredAt: new Date(`2026-06-09T0${n}:00:00.000Z`) },
    })
    alertIds.push(a.id)
    return a.id
  }

  async function cleanup() {
    await prisma.auditLog.deleteMany({ where: { targetId: { in: alertIds }, targetType: 'alert' } })
    await prisma.alert.deleteMany({ where: { alertNo: { contains: tag } } })
    await prisma.user.deleteMany({ where: { id: adminUserId } })
  }

  try {
    await cleanup()
    alertIds.length = 0

    await prisma.user.create({ data: { id: adminUserId, username: `admin_al_${suffix}`, passwordHash: 'verify-not-a-real-hash', name: '告警审计验证管理员', role: 'admin' } })

    const idCritNew = await mkAlert(1, 'printer-fault', 'critical', 'new', '卡纸故障', '卡纸，队列阻塞', 'KSK-008', '{"errorCode":"PAPER_JAM"}')
    await mkAlert(2, 'toner-low', 'warning', 'processing', '碳粉低', '碳粉 8%', 'KSK-003', null)
    await mkAlert(3, 'sync-fail', 'info', 'resolved', '同步失败', '接口 503', null, null)
    const idForAudit = await mkAlert(4, 'paper-empty', 'warning', 'new', '纸盒空', '无法打印', 'KSK-005', null)
    pass('夹具就绪：admin 账号 + 4 条告警')

    // ── 1. 列表 + 分页 ──────────────────────────────────────────
    const p1 = await service.list({ keyword: tag, page: 1, pageSize: 2 })
    const p2 = await service.list({ keyword: tag, page: 2, pageSize: 2 })
    if (p1.total === 4 && p1.items.length === 2 && p1.page === 1 && p1.pageSize === 2 && p2.items.length === 2) {
      pass('1. 列表 + 分页：total=4，page/pageSize 生效')
    } else fail(`1. 分页异常：${JSON.stringify({ total: p1.total, l1: p1.items.length, l2: p2.items.length })}`)

    // ── 2. 筛选 ────────────────────────────────────────────────
    const crit = await service.list({ keyword: tag, severity: 'critical' })
    const newOnly = await service.list({ keyword: tag, status: 'new' })
    const tonerOnly = await service.list({ keyword: tag, type: 'toner-low' })
    const kw = await service.list({ keyword: '卡纸' })
    if (crit.total === 1 && newOnly.total === 2 && tonerOnly.total === 1 && kw.items.some((a) => a.id === idCritNew)) {
      pass('2. 筛选：severity / status / type / keyword 均生效')
    } else fail(`2. 筛选异常：crit=${crit.total} new=${newOnly.total} toner=${tonerOnly.total} kw=${kw.total}`)

    // ── 3. 详情 ────────────────────────────────────────────────
    const detail = await service.getById(idCritNew)
    if (detail.message === '卡纸，队列阻塞' && detail.payloadJson?.includes('PAPER_JAM') && detail.alertNo === `ALT-${tag}-1`) {
      pass('3. 详情：message / payloadJson / alertNo 正确')
    } else fail(`3. 详情异常：${JSON.stringify(detail)}`)
    await expectCode(() => service.getById('alert_does_not_exist'), 'ALERT_NOT_FOUND', '3b. 不存在告警 → ALERT_NOT_FOUND')

    // ── 4. 处理 + handler 解析 ──────────────────────────────────
    const upd = await service.updateStatus(idCritNew, 'resolved', '现场已清理卡纸', adminUserId)
    if (
      upd.previous.status === 'new' && upd.detail.status === 'resolved' &&
      upd.detail.handledBy === adminUserId && upd.detail.handlerName === '告警审计验证管理员' &&
      upd.detail.handleNote === '现场已清理卡纸' && upd.detail.handledAt
    ) {
      pass('4. 处理：new→resolved，写 handledBy/handledAt/handleNote，handlerName 由 User 解析')
    } else fail(`4. 处理异常：${JSON.stringify(upd)}`)

    // ── 5. 审计（controller）────────────────────────────────────
    const user: AuthedUser = { userId: adminUserId, role: 'admin', orgId: null }
    const req = { headers: { 'user-agent': 'verify-admin-alerts' }, requestId: `req_${suffix}`, ip: '127.0.0.1' }
    await controller.updateStatus(idForAudit, { status: 'ignored', note: '偶发，忽略' }, user, req)
    const audits = await prisma.auditLog.count({
      where: { actorId: adminUserId, action: 'alert.status_change', targetType: 'alert', targetId: idForAudit },
    })
    if (audits === 1) pass('5. 审计：alert.status_change 已落 AuditLog（targetType=alert）')
    else fail(`5. 审计异常：count=${audits}`)
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
