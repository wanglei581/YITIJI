/**
 * 服务人次（一体机会话真写入）验证。
 *
 * 覆盖：
 *   1. DTO 白名单：多余字段（会员号、手机号、页面路径）、未知大类、非 UUID、未知结束原因一律拒绝。
 *   2. 控制器只认终端验签身份（TerminalIdentityGuard），三个路由都按台限流。
 *   3. start：落一条匿名记录（终端、机构快照、大类），不写 memberId；同一周期重放只落一条且不改字段。
 *   4. 开始时间只在 10 分钟内采信，太早或晚于服务器时间都按服务器时间记。
 *   5. heartbeat：没 start 过 404；大类去重累加；别的终端拿同一 clientSessionId 碰不到。
 *   6. end：记结束时间与原因；重放不改；结束后不再续期；早于开始的结束时间按服务器时间记。
 *   7. 机构快照：终端改绑后新会话归新机构，旧会话留在旧机构；按机构计数只算快照为本机构的会话，窗口外不算。
 *   8. 保留期：默认 180 天，可配，非法值回落默认。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:kiosk-session
 */
import 'dotenv/config'
import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { PrismaService } from '../src/prisma/prisma.service'
import { TerminalIdentityGuard } from '../src/terminals/terminal-identity.guard'
import { KioskSessionController } from '../src/kiosk-session/kiosk-session.controller'
import { KioskSessionService } from '../src/kiosk-session/kiosk-session.service'
import { countKioskVisitsByTerminal } from '../src/kiosk-session/kiosk-session.queries'
import { kioskSessionRetentionCutoff } from '../src/kiosk-session/kiosk-session-retention.task'
import { EndKioskSessionDto, StartKioskSessionDto, TouchKioskSessionDto } from '../src/kiosk-session/dto/kiosk-session.dto'
import { resolveTerminalScopedTracker } from '../src/common/throttler/terminal-throttle'

let failures = 0
function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string) { console.error(`  FAIL ${m}`); failures += 1 }
function check(label: string, ok: boolean, detail = '') { if (ok) pass(label); else fail(detail ? `${label} — ${detail}` : label) }

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : undefined) as { error?: { code?: string } } | undefined
  return resp?.error?.code
}

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
async function rejects(metatype: new () => object, body: Record<string, unknown>): Promise<boolean> {
  try {
    await pipe.transform(body, { type: 'body', metatype })
    return false
  } catch (e) {
    return e instanceof BadRequestException
  }
}
async function accepts(metatype: new () => object, body: Record<string, unknown>): Promise<boolean> {
  return !(await rejects(metatype, body))
}

async function main() {
  console.log('\n=== 服务人次（一体机会话）验证 ===')

  // ── 1. DTO 白名单 ────────────────────────────────────────────────────────
  const sid = randomUUID()
  const nowIso = new Date().toISOString()
  check('1a. 合法 start 通过', await accepts(StartKioskSessionDto, { clientSessionId: sid, wokeAt: nowIso, category: 'print' }))
  for (const extra of ['memberId', 'phone', 'path', 'fileId', 'terminalId']) {
    check(`1b. start 多带 ${extra} 被拒`, await rejects(StartKioskSessionDto, { clientSessionId: sid, wokeAt: nowIso, category: 'print', [extra]: 'x' }))
  }
  check('1c. 未知大类被拒', await rejects(StartKioskSessionDto, { clientSessionId: sid, wokeAt: nowIso, category: 'jobs' }))
  check('1d. clientSessionId 非 UUID 被拒', await rejects(StartKioskSessionDto, { clientSessionId: 'abc', wokeAt: nowIso, category: 'print' }))
  check('1e. heartbeat 大类可省略', await accepts(TouchKioskSessionDto, { clientSessionId: sid }))
  check('1f. end 未知结束原因被拒', await rejects(EndKioskSessionDto, { clientSessionId: sid, endedAt: nowIso, endReason: 'crash' }))

  // ── 2. 守卫与限流 ────────────────────────────────────────────────────────
  {
    const guards = (Reflect.getMetadata(GUARDS_METADATA, KioskSessionController) ?? []) as unknown[]
    check('2a. 控制器挂 TerminalIdentityGuard', guards.includes(TerminalIdentityGuard))
    const proto = KioskSessionController.prototype as unknown as Record<string, object>
    for (const [route, limit] of [['start', 10], ['heartbeat', 30], ['end', 10]] as const) {
      const handler = proto[route]
      const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', handler)
      const max = Reflect.getMetadata('THROTTLER:LIMITdefault', handler)
      const tracker = Reflect.getMetadata('THROTTLER:TRACKERdefault', handler)
      check(`2b. ${route} 按台限流 ${limit} 次/分钟`, ttl === 60_000 && max === limit && tracker === resolveTerminalScopedTracker,
        `ttl=${ttl} limit=${max} tracker=${typeof tracker}`)
    }
  }

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const svc = new KioskSessionService(prisma)
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const orgA = `org_vks_a_${suffix}`
  const orgB = `org_vks_b_${suffix}`
  const termT = `term_vks_t_${suffix}`
  const termU = `term_vks_u_${suffix}`

  const cleanup = async () => {
    await prisma.kioskSession.deleteMany({ where: { terminalId: { in: [termT, termU] } } }).catch(() => undefined)
    await prisma.terminal.deleteMany({ where: { id: { in: [termT, termU] } } }).catch(() => undefined)
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } }).catch(() => undefined)
  }

  try {
    await prisma.organization.createMany({
      data: [
        { id: orgA, name: `会话机构A_${suffix}`, type: 'public_employment_service' },
        { id: orgB, name: `会话机构B_${suffix}`, type: 'school_employment_center' },
      ],
    })
    await prisma.terminal.createMany({
      data: [
        { id: termT, terminalCode: `VKS-T-${suffix}`, agentToken: `tok-t-${suffix}`, deviceFingerprint: 'fp-t', orgId: orgA },
        { id: termU, terminalCode: `VKS-U-${suffix}`, agentToken: `tok-u-${suffix}`, deviceFingerprint: 'fp-u', orgId: orgA },
      ],
    })

    // ── 3. start ─────────────────────────────────────────────────────────
    const now = new Date()
    const s1 = randomUUID()
    const wokeAt = new Date(now.getTime() - 3 * 60 * 1000)
    await svc.start(termT, { clientSessionId: s1, wokeAt: wokeAt.toISOString(), category: 'print' }, now)
    const row1 = await prisma.kioskSession.findUnique({ where: { terminalId_clientSessionId: { terminalId: termT, clientSessionId: s1 } } })
    check('3a. start 落一条记录，带终端与机构快照', row1?.terminalId === termT && row1?.orgId === orgA, JSON.stringify(row1))
    check('3b. 不写会员号', row1?.memberId === null)
    check('3c. 大类记为 [print]', row1?.categoriesJson === '["print"]', row1?.categoriesJson)
    check('3d. 10 分钟内的开始时间照报来的记', row1?.startedAt.getTime() === wokeAt.getTime())
    await svc.start(termT, { clientSessionId: s1, wokeAt: now.toISOString(), category: 'scan' }, now)
    const replayCount = await prisma.kioskSession.count({ where: { terminalId: termT, clientSessionId: s1 } })
    const row1b = await prisma.kioskSession.findUnique({ where: { id: row1!.id } })
    check('3e. 同一周期重放只一条、字段不变', replayCount === 1 && row1b?.categoriesJson === '["print"]' && row1b?.startedAt.getTime() === wokeAt.getTime())

    // ── 4. 开始时间采信范围 ──────────────────────────────────────────────
    const s2 = randomUUID()
    await svc.start(termT, { clientSessionId: s2, wokeAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(), category: 'resume' }, now)
    const row2 = await prisma.kioskSession.findUnique({ where: { terminalId_clientSessionId: { terminalId: termT, clientSessionId: s2 } } })
    check('4a. 两小时前的开始时间按服务器时间记', row2?.startedAt.getTime() === now.getTime())
    const s3 = randomUUID()
    await svc.start(termT, { clientSessionId: s3, wokeAt: new Date(now.getTime() + 60 * 1000).toISOString(), category: 'help' }, now)
    const row3 = await prisma.kioskSession.findUnique({ where: { terminalId_clientSessionId: { terminalId: termT, clientSessionId: s3 } } })
    check('4b. 晚于服务器时间的开始时间按服务器时间记', row3?.startedAt.getTime() === now.getTime())

    // ── 5. heartbeat ─────────────────────────────────────────────────────
    try {
      await svc.touch(termT, { clientSessionId: randomUUID(), category: 'print' }, now)
      fail('5a. 没 start 过的 heartbeat 应 404')
    } catch (e) {
      check('5a. 没 start 过的 heartbeat 返回 KIOSK_SESSION_NOT_FOUND', errCode(e) === 'KIOSK_SESSION_NOT_FOUND', String(errCode(e)))
    }
    try {
      await svc.touch(termU, { clientSessionId: s1, category: 'scan' }, now)
      fail('5b. 别的终端拿同一 clientSessionId 不应碰到这条会话')
    } catch (e) {
      check('5b. 别的终端拿同一 clientSessionId 碰不到（404）', errCode(e) === 'KIOSK_SESSION_NOT_FOUND')
    }
    const later = new Date(now.getTime() + 60 * 1000)
    await svc.touch(termT, { clientSessionId: s1, category: 'scan' }, later)
    await svc.touch(termT, { clientSessionId: s1, category: 'scan' }, later)
    await svc.touch(termT, { clientSessionId: s1 }, later)
    const row1c = await prisma.kioskSession.findUnique({ where: { id: row1!.id } })
    check('5c. 大类去重累加为 [print, scan]', row1c?.categoriesJson === '["print","scan"]', row1c?.categoriesJson)
    check('5d. heartbeat 续期最后活跃时间', row1c?.lastActiveAt.getTime() === later.getTime())

    // ── 6. end ───────────────────────────────────────────────────────────
    const endAt = new Date(now.getTime() + 2 * 60 * 1000)
    const endNow = new Date(now.getTime() + 3 * 60 * 1000)
    const ack = await svc.end(termT, { clientSessionId: s1, endedAt: endAt.toISOString(), endReason: 'idle_timeout' }, endNow)
    const row1d = await prisma.kioskSession.findUnique({ where: { id: row1!.id } })
    check('6a. end 记结束时间与原因', ack.recorded && row1d?.endedAt?.getTime() === endAt.getTime() && row1d?.endReason === 'idle_timeout' && row1d?.isExpired === true)
    const replay = await svc.end(termT, { clientSessionId: s1, endedAt: endNow.toISOString(), endReason: 'user_exit' }, endNow)
    const row1e = await prisma.kioskSession.findUnique({ where: { id: row1!.id } })
    check('6b. end 重放不改', !replay.recorded && row1e?.endedAt?.getTime() === endAt.getTime() && row1e?.endReason === 'idle_timeout')
    const touchAfter = await svc.touch(termT, { clientSessionId: s1, category: 'policy' }, endNow)
    const row1f = await prisma.kioskSession.findUnique({ where: { id: row1!.id } })
    check('6c. 结束后 heartbeat 不续期、不加大类', !touchAfter.recorded && row1f?.categoriesJson === '["print","scan"]')
    await svc.end(termT, { clientSessionId: s2, endedAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(), endReason: 'privacy_clear' }, endNow)
    const row2b = await prisma.kioskSession.findUnique({ where: { id: row2!.id } })
    check('6d. 早于开始的结束时间按服务器时间记', row2b?.endedAt?.getTime() === endNow.getTime())

    // ── 7. 机构快照与计数 ────────────────────────────────────────────────
    await prisma.terminal.update({ where: { id: termT }, data: { orgId: orgB } })
    const s4 = randomUUID()
    await svc.start(termT, { clientSessionId: s4, wokeAt: now.toISOString(), category: 'interview' }, now)
    const row4 = await prisma.kioskSession.findUnique({ where: { terminalId_clientSessionId: { terminalId: termT, clientSessionId: s4 } } })
    const row1g = await prisma.kioskSession.findUnique({ where: { id: row1!.id } })
    check('7a. 改绑后新会话归新机构、旧会话留在旧机构', row4?.orgId === orgB && row1g?.orgId === orgA)
    const window = { from: new Date(now.getTime() - 60 * 60 * 1000), to: new Date(now.getTime() + 60 * 60 * 1000) }
    const forB = await countKioskVisitsByTerminal(prisma, { orgId: orgB, terminalIds: [termT], ...window })
    const forA = await countKioskVisitsByTerminal(prisma, { orgId: orgA, terminalIds: [termT, termU], ...window })
    check('7b. 新机构只数到改绑后的 1 次', forB.get(termT) === 1, JSON.stringify([...forB]))
    check('7c. 旧机构只数到自己快照的 3 次，新会话不算', forA.get(termT) === 3 && !forA.has(termU), JSON.stringify([...forA]))
    const outside = await countKioskVisitsByTerminal(prisma, { orgId: orgA, terminalIds: [termT], from: new Date(now.getTime() + 2 * 60 * 60 * 1000), to: new Date(now.getTime() + 3 * 60 * 60 * 1000) })
    check('7d. 窗口外不计', outside.size === 0)
    const empty = await countKioskVisitsByTerminal(prisma, { orgId: '', terminalIds: [termT], ...window })
    check('7e. 空机构不做全局计数', empty.size === 0)

    // ── 8. 保留期 ─────────────────────────────────────────────────────────
    const base = new Date('2026-09-29T00:00:00.000Z')
    const day = 24 * 60 * 60 * 1000
    delete process.env['KIOSK_SESSION_RETENTION_DAYS']
    check('8a. 默认保留 180 天', kioskSessionRetentionCutoff(base).getTime() === base.getTime() - 180 * day)
    process.env['KIOSK_SESSION_RETENTION_DAYS'] = '30'
    check('8b. 可配置保留天数', kioskSessionRetentionCutoff(base).getTime() === base.getTime() - 30 * day)
    process.env['KIOSK_SESSION_RETENTION_DAYS'] = 'abc'
    check('8c. 非法配置回落默认', kioskSessionRetentionCutoff(base).getTime() === base.getTime() - 180 * day)
    delete process.env['KIOSK_SESSION_RETENTION_DAYS']
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

  if (failures > 0) {
    console.error(`\n=== 服务人次验证失败：${failures} 项 ===`)
    process.exit(1)
  }
  console.log('\n=== 服务人次验证通过 ===')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
