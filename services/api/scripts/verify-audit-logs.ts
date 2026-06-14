/**
 * 审计日志 service 级验证（P1-B③ 守门）。
 *
 * 覆盖（按验收优先级）：
 *   1. write 同步落库字段完整性：actorId/actorRole/action/targetType/targetId/
 *      payloadJson/ipAddress/userAgent/requestId/createdAt 全部正确回读。
 *   2. payloadJson 安全封顶：超 4KB payload → 截断标记（truncated/originalSize/head），
 *      不撑爆表；不可序列化 payload → 错误标记。
 *   3. list 过滤（action/actorId/targetType/targetId/startAt/endAt）、createdAt 倒序、limit/offset 分页。
 *   4. actorId=null 系统动作可写可读（actorRole 必填）。
 *   5. write 失败 best-effort：actorRole 违约 → write() 不抛、不落行。
 *
 * service 直调真库（临时 SQLite，DATABASE_URL 由 runner/CI 提供，脚本只创建+清理自身夹具）。
 * 运行：pnpm --filter @ai-job-print/api verify:audit-logs
 */
import 'dotenv/config'
import { randomBytes } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

async function main() {
  console.log('\n=== 审计日志 service 级验证（P1-B③ 守门）===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)

  const sfx = randomBytes(6).toString('hex')
  const TT = `audit_vfy_tt_${sfx}` // 唯一 targetType，用于隔离 + 过滤
  const ACT_A = `audit_vfy.action_a_${sfx}`
  const ACT_SYS = `audit_vfy.system_${sfx}`
  const ACT_BIG = `audit_vfy.big_${sfx}`
  const ACT_BAD = `audit_vfy.bad_${sfx}`
  const ACT_FAIL = `audit_vfy.fail_${sfx}`
  const userId = `usr_vfy_${sfx}`

  async function cleanup() {
    await prisma.auditLog.deleteMany({ where: { targetType: TT } })
    await prisma.auditLog.deleteMany({ where: { action: { in: [ACT_FAIL] } } })
    await prisma.user.deleteMany({ where: { id: userId } })
  }

  const rowByTarget = (targetId: string) =>
    prisma.auditLog.findFirst({ where: { targetType: TT, targetId } })

  try {
    await cleanup()
    await prisma.user.create({
      data: { id: userId, username: `vfy_${sfx}`, passwordHash: 'x', name: '审计验证管理员', role: 'admin' },
    })
    pass('管理员夹具已创建')

    // ── 写入 5 条（targetType=TT 隔离）──────────────────────────────────
    await audit.write({ actorId: userId, actorRole: 'admin', action: ACT_A, targetType: TT, targetId: 'TID1', payload: { reason: 'test', n: 1 }, ipAddress: '10.0.0.1', userAgent: 'vfy-agent', requestId: 'req-vfy-1' })
    await audit.write({ actorId: userId, actorRole: 'admin', action: ACT_A, targetType: TT, targetId: 'TID2', payload: { n: 2 } })
    await audit.write({ actorId: null, actorRole: 'system', action: ACT_SYS, targetType: TT, targetId: 'TID3', payload: { sys: true } })
    await audit.write({ actorId: null, actorRole: 'system', action: ACT_BIG, targetType: TT, targetId: 'TID4', payload: { blob: 'x'.repeat(5000) } })
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    await audit.write({ actorId: null, actorRole: 'system', action: ACT_BAD, targetType: TT, targetId: 'TID5', payload: circular })

    // 回拨 createdAt 制造确定倒序（TID1 最旧 … TID5 最新）
    const base = Date.parse('2026-06-01T00:00:00.000Z')
    const ats: Record<string, Date> = {}
    for (let i = 1; i <= 5; i++) {
      const tid = `TID${i}`
      const row = await rowByTarget(tid)
      if (!row) fail(`写入后未找到 ${tid}（write 未落库？）`)
      const at = new Date(base + i * 60_000)
      ats[tid] = at
      await prisma.auditLog.update({ where: { id: row.id }, data: { createdAt: at } })
    }
    pass('5 条审计夹具已写入（targetType=TT 隔离）')

    // ── 1. 字段完整性（TID1 全字段）─────────────────────────────────────
    const r1 = (await audit.list({ targetType: TT, targetId: 'TID1' })).items[0]
    if (
      r1 && r1.actorId === userId && r1.actorRole === 'admin' && r1.action === ACT_A &&
      r1.targetType === TT && r1.targetId === 'TID1' && r1.ipAddress === '10.0.0.1' &&
      r1.userAgent === 'vfy-agent' && r1.requestId === 'req-vfy-1' &&
      JSON.parse(r1.payloadJson).reason === 'test' && typeof r1.createdAt === 'string'
    ) pass('1. write 字段完整性：全字段正确回读（含 ip/ua/requestId/payload/createdAt ISO）')
    else fail(`1. 字段完整性异常: ${JSON.stringify(r1)}`)

    // ── 2. payload 安全封顶 + 不可序列化 ────────────────────────────────
    const rBig = (await audit.list({ targetType: TT, targetId: 'TID4' })).items[0]
    const big = JSON.parse(rBig.payloadJson) as { truncated?: boolean; originalSize?: number; head?: string }
    if (big.truncated === true && (big.originalSize ?? 0) > 4096 && typeof big.head === 'string' && rBig.payloadJson.length < 5000) {
      pass('2a. 超 4KB payload → 截断标记（truncated/originalSize/head），表不被撑爆')
    } else fail(`2a. payload 封顶异常: len=${rBig.payloadJson.length} ${rBig.payloadJson.slice(0, 80)}`)
    const rBad = (await audit.list({ targetType: TT, targetId: 'TID5' })).items[0]
    if (rBad.payloadJson === '{"error":"payload not serializable"}') pass('2b. 不可序列化 payload → 错误标记（不抛）')
    else fail(`2b. 不可序列化处理异常: ${rBad.payloadJson}`)

    // ── 3. list 过滤 / 倒序 / 分页 / 时间范围 ───────────────────────────
    const all = await audit.list({ targetType: TT })
    if (all.total === 5 && all.items.length === 5 && all.items[0].targetId === 'TID5' && all.items[4].targetId === 'TID1') {
      pass('3a. targetType 过滤 + createdAt 倒序：5 条，TID5(最新)→TID1(最旧)')
    } else fail(`3a. 过滤/倒序异常: total=${all.total} order=${all.items.map((i) => i.targetId).join(',')}`)

    const byAction = await audit.list({ targetType: TT, action: ACT_A })
    if (byAction.total === 2 && byAction.items.every((i) => i.action === ACT_A)) pass('3b. action 过滤：仅 ACT_A 的 2 条')
    else fail(`3b. action 过滤异常: ${byAction.total}`)

    const byActor = await audit.list({ targetType: TT, actorId: userId })
    if (byActor.total === 2 && byActor.items.every((i) => i.actorId === userId)) pass('3c. actorId 过滤：仅该管理员的 2 条')
    else fail(`3c. actorId 过滤异常: ${byActor.total}`)

    const byTarget = await audit.list({ targetType: TT, targetId: 'TID3' })
    if (byTarget.total === 1 && byTarget.items[0].targetId === 'TID3') pass('3d. targetId 过滤：仅 TID3 的 1 条')
    else fail(`3d. targetId 过滤异常: ${byTarget.total}`)

    const page1 = await audit.list({ targetType: TT, limit: 2, offset: 0 })
    const page2 = await audit.list({ targetType: TT, limit: 2, offset: 2 })
    if (page1.items.length === 2 && page1.total === 5 && page1.items[0].targetId === 'TID5' &&
        page2.items.length === 2 && page2.items[0].targetId === 'TID3') {
      pass('3e. limit/offset 分页：每页 2 条，total=5，分页边界正确')
    } else fail(`3e. 分页异常: p1=${page1.items.map((i) => i.targetId)} p2=${page2.items.map((i) => i.targetId)}`)

    const rangeFrom = await audit.list({ targetType: TT, startAt: ats['TID3'].toISOString() })
    const rangeTo = await audit.list({ targetType: TT, endAt: ats['TID3'].toISOString() })
    if (rangeFrom.total === 3 && rangeTo.total === 2) pass('3f. 时间范围：startAt(gte TID3)→3 条，endAt(lt TID3)→2 条')
    else fail(`3f. 时间范围异常: from=${rangeFrom.total} to=${rangeTo.total}`)

    // ── 4. actorId=null 系统动作 ────────────────────────────────────────
    const rSys = (await audit.list({ targetType: TT, targetId: 'TID3' })).items[0]
    if (rSys.actorId === null && rSys.actorRole === 'system') pass('4. 系统动作：actorId=null 可写可读，actorRole=system')
    else fail(`4. 系统动作异常: ${JSON.stringify(rSys)}`)

    // ── 5. write 失败 best-effort 不抛 ──────────────────────────────────
    let threw = false
    await audit
      .write({ actorId: null, actorRole: null as unknown as string, action: ACT_FAIL, targetType: TT, targetId: 'TIDFAIL' })
      .catch(() => { threw = true })
    const failCount = await audit.list({ action: ACT_FAIL })
    if (!threw && failCount.total === 0) pass('5. write 失败 best-effort：actorRole 违约 → 不抛、不落行')
    else fail(`5. best-effort 异常: threw=${threw} rows=${failCount.total}`)
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
