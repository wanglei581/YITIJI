/**
 * 屏上复印计费口径（产品负责人 11/08「按推荐执行」）：
 * ① 复印单价就是同色打印单价，与打印走同一个 readPrintUnitPrice，不另设复印价目行；
 * ② 复印与打印共用机器每天、会员每天、游客每单三条免费额度，出纸成功（handed）才计入已用，
 *    确认后到出纸前算在途，结果未确认、失败、取消、过期都不计；
 * ③ 超额回 429 与打印同一错误码，复印说复印的话，打印的提示不变。
 * 隔离库（SQLite / PostgreSQL 均可）；Redis 只用传输夹具；结束时删掉自建数据，价目与额度设置原样恢复。
 */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { HttpException } from '@nestjs/common'
import { collectPrintQuotaAlerts } from '../src/admin-ops/derived-print-quota-alerts'
import { AuditService } from '../src/audit/audit.service'
import { RedisService } from '../src/common/redis/redis.service'
import { CopyAgentService } from '../src/copy-jobs/copy-agent.service'
import { CopyJobStore } from '../src/copy-jobs/copy-job-store.service'
import type { CopyColorMode, CopyJobView } from '../src/copy-jobs/copy-job.types'
import { CopyJobsService } from '../src/copy-jobs/copy-jobs.service'
import { AdminBillingService } from '../src/payment/admin-billing.service'
import { quoteCopy } from '../src/payment/copy-pricing'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
import { PricingService } from '../src/payment/pricing.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { assertFreePrintQuota, freePrintQuotaView } from '../src/print-jobs/free-print-quota.decide'
import {
  FREE_PRINT_QUOTA_KEYS, KEY_GUEST_PER_ORDER_SIDES, KEY_MEMBER_DAILY_SIDES,
  PRINT_GUEST_ORDER_QUOTA_EXCEEDED, PRINT_MEMBER_DAILY_QUOTA_REACHED, PRINT_TERMINAL_DAILY_QUOTA_REACHED,
  beijingDayBounds,
} from '../src/print-jobs/free-print-quota.policy'
import { loadFreePrintUsage, todayFreePrintSidesByTerminal } from '../src/print-jobs/free-print-quota.usage'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const pass = (message: string) => console.log(`PASS ${message}`)
const GUEST_LIMIT = 6
const MEMBER_LIMIT = 8
const COPY_TERMINAL = '今天这台机器的免费打印复印量已用完，明天 0 点恢复。'
const COPY_MEMBER = `你今天已免费打印复印 ${MEMBER_LIMIT} 面，达到每日上限，明天 0 点恢复。确有急用，可以拨打屏幕上的服务电话。`
const COPY_GUEST = `免登录每次最多复印 ${GUEST_LIMIT} 面。用手机号登录后，可以一次复印更多。`
const PRINT_TERMINAL = '今天这台机器的免费打印量已用完，明天 0 点恢复。'
const PRINT_MEMBER = `你今天已免费打印 ${MEMBER_LIMIT} 面，达到每日上限，明天 0 点恢复。确有急用，可以拨打屏幕上的服务电话。`
const PRINT_GUEST = `免登录每次最多打印 ${GUEST_LIMIT} 面。用手机号登录后，可以一次打更多。`
type PriceDb = Pick<PrismaService, 'priceConfig'>

async function rejectsQuota(promise: Promise<unknown>, code: string, message: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof HttpException, String(error))
    assert.equal(error.getStatus(), 429)
    const body = error.getResponse() as { error: { code: string; message: string } }
    assert.equal(body.error.code, code)
    assert.equal(body.error.message, message)
    return true
  })
}

/** 同一价目状态下打印报价与复印报价：可报价时单价、价目键、金额都相同；不可报价时同样不可报价。 */
async function assertPriceParity(label: string, colorMode: CopyColorMode, db: PriceDb) {
  const toCopyCode: Record<string, string> = { PRICE_CONFIG_UNAVAILABLE: 'COPY_PRICE_UNAVAILABLE', PRICE_CONFIG_INVALID: 'COPY_PRICE_INVALID' }
  const print = await new PricingService(db as PrismaService)
    .quotePrint({ billablePages: 3, billingPageSource: 'pdf_lightweight_scan', copies: 2, colorMode })
    .then((quote) => ({ ok: true as const, line: quote.lines[0], amountCents: quote.amountCents }),
      (error: Error) => ({ ok: false as const, code: error.message }))
  const copy = await quoteCopy({ pageCount: 3, copies: 2, colorMode, duplex: 'duplex_long_edge' }, db)
  if (print.ok) {
    assert.ok(copy.quotable, `${label}：打印可报价，复印也必须可报价`)
    assert.equal(copy.quote.unitCents, print.line.unitCents, `${label}：复印单价与打印单价不同`)
    assert.equal(copy.quote.serviceKey, print.line.serviceKey, label)
    assert.equal(copy.quote.amountCents, print.amountCents, `${label}：原件页 × 份数按面计，双面不减价`)
  } else {
    assert.deepEqual(copy, { quotable: false, code: toCopyCode[print.code] }, `${label}：打印 ${print.code}`)
  }
}

async function main() {
  assertIsolatedVerificationDatabase()
  // 夹具按真实时间落库，用量按北京自然日取窗；离零点不到两分钟就等过零点，免得两头落在不同的一天。
  const toMidnight = beijingDayBounds(new Date()).end.getTime() - Date.now()
  if (toMidnight < 120_000) await new Promise((done) => setTimeout(done, toMidnight + 1_000))
  const prisma = new PrismaService(), audit = new AuditService(prisma), suffix = randomUUID()
  await prisma.onModuleInit()
  const cache = new Map<string, string>()
  const redis = { get: async (key: string) => cache.get(key) ?? null,
    set: async (key: string, value: string) => { cache.set(key, value) } } as unknown as RedisService
  const store = new CopyJobStore(prisma, redis, audit), jobs = new CopyJobsService(store), agent = new CopyAgentService(store)
  const orgId = `copy-quota-org-${suffix}`, members = [`copy-quota-sun-${suffix}`, `copy-quota-zhao-${suffix}`]
  const tid = (name: string) => `copy-quota-${name}-${suffix}`
  const terminals = { usage: tid('usage'), other: tid('other'), daily: tid('daily'), member: tid('member'), print: tid('print') }
  const priorPrices = await prisma.priceConfig.findMany()
  const priorSettings = await prisma.platformSetting.findMany({ where: { key: { in: [...FREE_PRINT_QUOTA_KEYS] } } })
  try {
    // ── 复印没有自己的价目行：开发种子与后台计费页都不补 copy_* 行 ──
    const copyKeys = async () => (await prisma.priceConfig.findMany({ where: { serviceKey: { startsWith: 'copy_' } } }))
      .map((row) => row.serviceKey).sort()
    const keysBefore = await copyKeys()
    await seedDevDefaultPriceConfig(prisma)
    await new AdminBillingService(prisma, audit).listPriceConfig()
    assert.deepEqual(await copyKeys(), keysBefore, '种子或计费页又补出了复印价目行')
    pass('不新增全局价目行：种子与后台计费页不补复印价目')

    // ── ① 复印单价 = 同色打印单价（有效 / 大于 0 / 停用 / 单价非法 / 缺行）──
    for (const colorMode of ['black_white', 'color'] as const) {
      const serviceKey = colorMode === 'color' ? 'print_color_page' : 'print_bw_page'
      for (const [label, data] of [['有效 0 元', { active: true, unitCents: 0 }], ['有效且大于 0', { active: true, unitCents: 30 }],
        ['停用', { active: false, unitCents: 0 }], ['单价非法', { active: true, unitCents: -1 }], ['缺行', null]] as const) {
        if (data) await prisma.priceConfig.upsert({ where: { serviceKey }, create: { serviceKey, unit: 'page', ...data }, update: data })
        else await prisma.priceConfig.deleteMany({ where: { serviceKey } })
        await assertPriceParity(`${colorMode} ${label}`, colorMode, prisma)
      }
      for (const unitCents of [0.5, Number.NaN]) {
        const stub = { priceConfig: { findUnique: async () => ({ serviceKey, active: true, unit: 'page', unitCents, description: null }) } }
        await assertPriceParity(`${colorMode} 单价 ${unitCents}`, colorMode, stub as unknown as PriceDb)
      }
    }
    for (const serviceKey of ['print_bw_page', 'print_color_page']) {
      await prisma.priceConfig.upsert({ where: { serviceKey }, create: { serviceKey, unit: 'page', unitCents: 0 },
        update: { active: true, unitCents: 0 } })
    }
    pass('复印单价与同色打印单价相同：有效、大于 0、停用、单价非法、缺行（黑白、彩色）')

    // ── 夹具：机构、两位会员、五台机器（复印四项能力全开），游客每单与会员每天调小 ──
    await prisma.organization.create({ data: { id: orgId, name: '青岛市城阳区公共就业服务中心', type: 'public_service' } })
    for (const [id, nickname] of [[members[0], '孙晓雯'], [members[1], '赵立新']] as const) {
      await prisma.endUser.create({ data: { id, phoneHash: id, phoneEnc: id, nickname, enabled: true, status: 'active' } })
    }
    const limits: Record<string, number> = { usage: 1000, other: 1000, daily: 10, member: 1000, print: 10 }
    for (const [index, [name, id]] of Object.entries(terminals).entries()) {
      await prisma.terminal.create({ data: { id, terminalCode: id, agentToken: `token-${id}`, deviceFingerprint: id, orgId,
        displayName: `城阳区公共就业服务中心 ${index + 1} 号机`, dailyFreePrintSides: limits[name] } })
      for (const capabilityKey of ['copy', 'scan_device', 'color_print', 'duplex_print']) {
        await prisma.terminalCapability.create({ data: { terminalId: id, capabilityKey, status: 'available' } })
      }
    }
    for (const [key, value] of [[KEY_GUEST_PER_ORDER_SIDES, GUEST_LIMIT], [KEY_MEMBER_DAILY_SIDES, MEMBER_LIMIT]] as const) {
      await prisma.platformSetting.upsert({ where: { key }, create: { key, value: String(value) }, update: { value: String(value) } })
    }

    // ── ② 用量：0 元 handed 计已用，未过期 confirmed / dispatching / spooled 计在途，其余不计 ──
    const row = async (terminalId: string, state: string, sides: number,
      extra: { endUserId?: string; amountCents?: number; expiresAt?: Date; createdAt?: Date } = {}) => {
      const order = await prisma.order.create({ data: { orderNo: `COPY-${randomUUID()}`, type: 'copy', terminalId,
        endUserId: extra.endUserId ?? null, amountCents: extra.amountCents ?? 0, payStatus: 'paid',
        paymentSource: extra.amountCents ? 'offline' : 'free', billablePages: sides, billingPageSource: 'terminal_scan' } })
      await prisma.copyJob.create({ data: { terminalId, organizationId: orgId, endUserId: extra.endUserId ?? null,
        source: 'flatbed', state, pageCount: sides, billableSides: sides, requestKey: randomUUID(), orderId: order.id,
        expiresAt: extra.expiresAt ?? new Date(Date.now() + 600_000), ...(extra.createdAt ? { createdAt: extra.createdAt } : {}) } })
    }
    const sun = members[0]
    await row(terminals.usage, 'handed', 4, { endUserId: sun })
    await row(terminals.other, 'handed', 5, { endUserId: sun })
    await row(terminals.usage, 'dispatching', 1)
    await row(terminals.usage, 'confirmed', 2, { endUserId: sun })
    await row(terminals.usage, 'spooled', 10)
    for (const [state, sides] of [['unconfirmed', 5], ['failed', 6], ['cancelled', 7], ['expired', 8], ['scanned', 9]] as const) {
      await row(terminals.usage, state, sides, { endUserId: sun })
    }
    await row(terminals.usage, 'handed', 3, { amountCents: 100 })
    await row(terminals.usage, 'confirmed', 3, { endUserId: sun, expiresAt: new Date(Date.now() - 60_000) })
    await row(terminals.usage, 'handed', 11, { createdAt: new Date(Date.now() - 3 * 24 * 3600_000) })
    assert.deepEqual(await loadFreePrintUsage(prisma, terminals.usage, sun, new Date()),
      { terminalUsed: 4, terminalInFlight: 13, memberUsed: 9, memberInFlight: 2 })
    const usageView = await freePrintQuotaView(prisma, terminals.usage, sun)
    assert.deepEqual([usageView.terminal.used, usageView.terminal.remaining, usageView.member?.used, usageView.member?.remaining],
      [4, 1000 - 4 - 13, 9, 0])
    const listed = await todayFreePrintSidesByTerminal(prisma, [terminals.usage, terminals.other])
    assert.deepEqual([listed.get(terminals.usage), listed.get(terminals.other)], [4, 5])
    pass('用量：handed 计已用、在途另计；未确认/失败/取消/过期/确认前/付费/过期未派发/老单不计；一体机余量与终端列表同口径')

    // ── ③ 确认走同一份额度：游客每单、机器每天（含在途）、会员每天 ──
    const scanned = async (terminalId: string, endUserId: string | null, pageCount: number) => {
      const job = await jobs.create({ terminalId, requestKey: randomUUID(), source: 'flatbed', colorMode: 'black_white',
        duplex: 'simplex', copies: 1 }, endUserId) as CopyJobView & { controlToken: string }
      const scannedView = await agent.scanResult(terminalId, job.copyId, { generation: job.generation, pageCount })
      return { id: job.copyId, terminalId, generation: job.generation,
        confirm: () => jobs.confirm(job.copyId, terminalId, endUserId, job.controlToken, scannedView.quoteVersion!) }
    }
    const finish = async (job: { id: string; terminalId: string; generation: number }, state: 'handed' | 'failed') => {
      assert.equal((await agent.permit(job.terminalId, job.id, 'print')).allowed, true)
      await agent.result(job.terminalId, job.id, { generation: job.generation, eventId: randomUUID(), state })
    }
    const guestOver = await scanned(terminals.daily, null, GUEST_LIMIT + 1)
    await rejectsQuota(guestOver.confirm(), PRINT_GUEST_ORDER_QUOTA_EXCEEDED, COPY_GUEST)
    const untouched = await store.find(guestOver.id)
    assert.deepEqual([untouched.state, untouched.orderId], ['scanned', null], '超额不建单、不占单')
    const first = await scanned(terminals.daily, null, 5)
    assert.ok((await first.confirm()).orderId)
    await rejectsQuota((await scanned(terminals.daily, null, 6)).confirm(), PRINT_TERMINAL_DAILY_QUOTA_REACHED, COPY_TERMINAL)
    await finish(first, 'handed')
    const second = await scanned(terminals.daily, null, 5)
    await second.confirm()
    // 复印用满之后打印也被挡，打印仍说打印的话。
    await rejectsQuota(assertFreePrintQuota(prisma, { terminalId: terminals.daily, endUserId: null, requestedSides: 1, payableCents: 0 }),
      PRINT_TERMINAL_DAILY_QUOTA_REACHED, PRINT_TERMINAL)
    await finish(second, 'failed')
    const third = await scanned(terminals.daily, null, 5)
    await third.confirm()
    await finish(third, 'handed')
    assert.deepEqual((await freePrintQuotaView(prisma, terminals.daily, null)).terminal, { limit: 10, used: 10, remaining: 0 })
    assert.equal((await todayFreePrintSidesByTerminal(prisma, [terminals.daily])).get(terminals.daily), 10)
    const alert = (await collectPrintQuotaAlerts(prisma, new Date())).find((item) => item.subjectId === terminals.daily)
    assert.equal(alert?.severity, 'error')
    assert.match(alert?.title ?? '', / 10 \/ 10 面$/)
    pass('确认：游客每单、机器每天（在途也挡）对复印生效，失败释放额度；复印用满后打印被挡；80% 告警与余量把复印算进去')

    const zhao = members[1]
    await (await scanned(terminals.member, zhao, 6)).confirm()
    await rejectsQuota((await scanned(terminals.member, zhao, 3)).confirm(), PRINT_MEMBER_DAILY_QUOTA_REACHED, COPY_MEMBER)
    await rejectsQuota(assertFreePrintQuota(prisma, { terminalId: terminals.member, endUserId: zhao, requestedSides: 3, payableCents: 0 }),
      PRINT_MEMBER_DAILY_QUOTA_REACHED, PRINT_MEMBER)
    pass('会员每天：复印在途计入，超额回复印的句子；同一会员再打印被挡，打印句子不变')

    // ── 反过来：打印用满之后复印被挡 ──
    const task = await prisma.printTask.create({ data: { id: `copy-quota-task-${suffix}`, terminalId: terminals.print,
      fileUrl: 'not-used', fileMd5: 'not-used', status: 'completed', completedAt: new Date(), paramsJson: JSON.stringify({ copies: 1 }) } })
    await prisma.order.create({ data: { orderNo: `PRINT-${randomUUID()}`, terminalId: terminals.print, printTaskId: task.id,
      amountCents: 0, payStatus: 'paid', paymentSource: 'free', taskStatus: 'completed', billablePages: 10,
      printParamsJson: JSON.stringify({ copies: 1 }) } })
    await rejectsQuota((await scanned(terminals.print, null, 1)).confirm(), PRINT_TERMINAL_DAILY_QUOTA_REACHED, COPY_TERMINAL)
    await rejectsQuota(assertFreePrintQuota(prisma, { terminalId: terminals.print, endUserId: null, requestedSides: GUEST_LIMIT + 1, payableCents: 0 }),
      PRINT_GUEST_ORDER_QUOTA_EXCEEDED, PRINT_GUEST)
    pass('打印用满之后复印被挡；打印游客每单句子不变')

    const ci = readFileSync(resolve(__dirname, '../../../.github/workflows/ci.yml'), 'utf8')
    assert.equal(ci.split('verify:copy-quota').length - 1, 2, 'SQLite 与 PostgreSQL 两组各跑一次')
    pass('CI 两组接线')
    console.log('PASS verify-copy-quota')
  } finally {
    const ids = Object.values(terminals)
    const copies = (await prisma.copyJob.findMany({ where: { terminalId: { in: ids } } })).map((job) => job.id)
    const orders = (await prisma.order.findMany({ where: { terminalId: { in: ids } } })).map((order) => order.id)
    await prisma.auditLog.deleteMany({ where: { targetId: { in: [...ids, ...copies, ...orders] } } })
    await prisma.copyJob.deleteMany({ where: { terminalId: { in: ids } } })
    await prisma.order.deleteMany({ where: { terminalId: { in: ids } } })
    await prisma.printTask.deleteMany({ where: { terminalId: { in: ids } } })
    await prisma.terminal.deleteMany({ where: { id: { in: ids } } })
    await prisma.organization.deleteMany({ where: { id: orgId } })
    await prisma.endUser.deleteMany({ where: { id: { in: members } } })
    await prisma.platformSetting.deleteMany({ where: { key: { in: [...FREE_PRINT_QUOTA_KEYS] } } })
    for (const setting of priorSettings) await prisma.platformSetting.create({ data: setting })
    await prisma.priceConfig.deleteMany({})
    for (const price of priorPrices) await prisma.priceConfig.create({ data: price })
    await prisma.onModuleDestroy()
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
