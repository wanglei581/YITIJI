
import { SCREEN_JUMP_COPY } from '../src/console-screen/console-screen.types'
import { PartnerUsageController } from '../src/console-screen/console-screen.usage.controller'
import { loadUsageTimeline } from '../src/console-screen/console-screen.usage.queries'
import { assert, opened } from './console-screen-usage-cases-01'
import { assertBehaviorPhase2 } from './console-screen-usage-cases-04'
import { NOW, TODAY_START, PHONE, FILE_NAME, IP_SECRET, APP_COMPANY, FAVORITE_SNAPSHOT, carryContext, assertSmallSampleFloor, assertHttp } from './console-screen-usage-cases-07'
import { verifyClosedWindows } from './support/console-screen-closed-window-cases'
import { ForbiddenException } from '@nestjs/common'
import { PartnerOrgRequiredError } from '../src/console-screen/console-screen.org'
import { assertBehaviorSetup } from './console-screen-usage-cases-02'
import { assertBehaviorPhase1 } from './console-screen-usage-cases-03'
import { PrismaService } from '../src/prisma/prisma.service'
import { ScreenSnapshotCache } from '../src/console-screen/console-screen.cache'
import { ConsoleScreenUsageService } from '../src/console-screen/console-screen.usage.service'



export async function assertBehaviorPhase3(context: Awaited<ReturnType<typeof assertBehaviorPhase2>>) {
const { prisma, cache, usage, suffix, orgA, orgB, termLeak, userA, memberId, phoneEnc, fileUrl, orderNo, jobDel, owned, countBrowse, countFav, countJump, show, today, week, admin, weekSnap, monthSnap, partnerA, partnerB, contentA, rowA, rowB, topA } = context
const topB = opened(partnerB.metrics.partnerTop)
assert(
      'u21. 机构只看见自己内容上的浏览、收藏和外跳，已删目标不计',
      partnerA.audience === 'partner'
        && contentA?.coverage === 'members_only'
        && contentA.basis === 'current_content_join'
        && contentA.byType.map((row) => row.type).join(',') === 'job,job_fair,policy,company_profile'
        && rowA('job')?.browse === show(countBrowse(['job'], today.from, today.to, owned.A['job']))
        && rowA('job')?.favorites === show(countFav('job', today.from, today.to, owned.A['job']))
        && rowA('job')?.sourceOpens === show(countJump('job', today.from, today.to, owned.A['job']))
        && rowA('job_fair')?.browse === 5
        && rowA('policy')?.browse === 5
        && rowA('policy')?.favorites === null
        && rowA('company_profile')?.browse === null
        && rowB('job')?.browse === 7
        && rowB('policy')?.browse === null
        && rowA('job')?.browse !== (rowA('job')?.browse ?? 0) + (rowB('job')?.browse ?? 0)
        && countBrowse(['job'], today.from, today.to, [jobDel]) === 6
        && (rowA('job')?.browse ?? 0) < countBrowse(['job'], today.from, today.to),
      `Ajob=${String(rowA('job')?.browse)} Bjob=${String(rowB('job')?.browse)}`,
    )
assert(
      'u22. 机构热门只用本机构内容标题，浏览少于 5 不进榜',
      topA !== null
        && topA.items.length <= 5
        && topA.items.every((item) => item.browse >= 5)
        && topA.items.some((item) => item.title === '甲机构岗位' && item.type === 'job')
        && topA.items.every((item) => item.title.startsWith('甲机构'))
        && !topA.items.some((item) => item.title.includes('乙') || item.title === '甲机构冷门' || item.title === '已删岗位' || item.title === FAVORITE_SNAPSHOT)
        && topB?.items.length === 1
        && topB.items[0]?.title === '乙机构岗位'
        && !JSON.stringify(topB).includes('甲机构'),
      `A=${topA?.items.map((item) => item.title).join('|')} B=${topB?.items.map((item) => item.title).join('|')}`,
    )
const dailyA = opened((await usage.getPartnerUsage(orgA, '7d', NOW)).metrics.partnerDaily)
assert(
      'u23. 机构按日序列跟随 range：0 保留；1–4 为 null；≥5 原样',
      opened(partnerA.metrics.partnerDaily)?.days.length === 1
        && opened(partnerA.metrics.partnerDaily)?.days[0]?.date === '2026-01-15'
        && dailyA?.days.length === 7
        && dailyA.days[0]?.date === '2026-01-08'
        && dailyA.days[6]?.date === '2026-01-14'
        && dailyA.days[6]?.browse !== null
        && dailyA.days[6]?.sourceOpens === 5
        && dailyA.days[0]?.browse === 0 && dailyA.days[0]?.sourceOpens === 0,
      `days=${String(dailyA?.days.length)} yOpens=${String(dailyA?.days[5]?.sourceOpens)}`,
    )
assert(
      'u23b. 机构端浏览、收藏同样是 4 为 null、5 为实数',
      countBrowse(['company_profile'], today.from, today.to, owned.A['company_profile']) === 4
        && rowA('company_profile')?.browse === null
        && rowA('policy')?.browse === 5
        && countFav('policy', today.from, today.to, owned.A['policy']) === 4
        && rowA('policy')?.favorites === null
        && rowA('job')?.favorites === 5
        && rowA('job_fair')?.favorites === 0
        && dailyA?.days[6]?.sourceOpens === 5
        && dailyA.days[0]?.browse === 0 && dailyA.days[0]?.sourceOpens === 0,
    )
const packed = JSON.stringify({ admin, weekSnap, monthSnap, partnerA, partnerB })
const secrets = [PHONE, phoneEnc, FILE_NAME, fileUrl, orderNo, IP_SECRET, APP_COMPANY, '自填机密岗位', FAVORITE_SNAPSHOT, termLeak, memberId, `tok_${suffix}`]
const leaked = secrets.filter((secret) => packed.includes(secret))
const bannedKeys = ['endUserId', 'phoneEnc', 'phoneHash', 'orderNo', 'sourceFileName', 'ipAddress', 'terminalId', 'payloadJson', 'fileUrl', 'jobApplication', 'searchKeyword']
assert('u24. 响应 JSON 不含手机号、文件名、订单号、IP、终端和自填进度', leaked.length === 0, leaked.join(','))
assert('u25. 响应键不含身份、文件或搜索字段', bannedKeys.every((key) => !packed.includes(`"${key}"`)))
assert('u26. 响应不出现投递成功等违禁文案', !/投递成功|一键投递|立即投递|平台投递/.test(packed) && packed.includes(SCREEN_JUMP_COPY))
assert(
      'u27. 快照带上海窗口、样本下限和 ok 状态',
      admin.range === 'today'
        && admin.window.timezone === 'Asia/Shanghai'
        && admin.window.from === TODAY_START.toISOString()
        && admin.limits.minAggregateSample === 5
        && admin.limits.recruitmentHosting === 'enabled'
        && admin.status === 'ok'
        && admin.degraded === false
        && partnerA.range === 'today'
        && partnerB.metrics.visits?.available === true && partnerB.metrics.visits.value === 0,
    )
cache.clear()
const seenKeys: string[] = []
const seenTtls: number[] = []
const originalGet = cache.getOrLoad.bind(cache)
cache.getOrLoad = (async (key: string, ttl: number, load: () => Promise<unknown>, shouldCache?: (value: unknown) => boolean) => {
      seenKeys.push(key)
      seenTtls.push(ttl)
      return originalGet(key, ttl, load as never, shouldCache as never)
    }) as typeof cache.getOrLoad
let orderCalls = 0
const originalOrderCount = prisma.order.count.bind(prisma.order)
prisma.order.count = (async (...args: unknown[]) => {
      orderCalls += 1
      return originalOrderCount(...args as Parameters<typeof originalOrderCount>)
    }) as typeof prisma.order.count
await usage.getAdminUsage('today', NOW)
const afterFirst = orderCalls
await usage.getAdminUsage('today', NOW)
const afterHit = orderCalls
await usage.getAdminUsage('7d', NOW)
await usage.getPartnerUsage(orgA, '30d', NOW)
await usage.getPartnerUsage(orgB, '30d', NOW)
prisma.order.count = originalOrderCount
cache.getOrLoad = originalGet
assert(
      'u28. 缓存键区分 range 和 orgId，命中不再查订单，TTL 为 60 秒',
      afterFirst > 0
        && afterHit === afterFirst
        && seenKeys.includes('usage:admin:platform:today')
        && seenKeys.includes('usage:admin:platform:7d')
        && seenKeys.includes(`usage:partner:${orgA}:30d`)
        && seenKeys.includes(`usage:partner:${orgB}:30d`)
        && seenTtls.every((ttl) => ttl === 60),
      `orders ${afterFirst}->${afterHit} keys=${seenKeys.join(',')}`,
    )
cache.clear()
prisma.order.count = (async () => {
      throw new Error('order down')
    }) as typeof prisma.order.count
const degraded = await usage.getAdminUsage('today', NOW)
prisma.order.count = originalOrderCount
const recovered = await usage.getAdminUsage('today', NOW)
assert(
      'u29. 查询失败不入缓存，渠道 unavailable，热力仍在，状态 degraded',
      degraded.status === 'degraded'
        && degraded.degraded
        && degraded.metrics.channels?.available === false
        && degraded.metrics.channels.reason === 'source_query_failed'
        && degraded.metrics.heat7d?.available === true
        && recovered.metrics.channels?.available === true
        && recovered.status === 'ok',
    )
cache.clear()
const capped = await loadUsageTimeline(prisma, week.from, NOW, 2)
const cappedAdmin = await usage.getAdminUsage('today', NOW, 2)
const cappedPartner = await usage.getPartnerUsage(orgA, 'today', NOW, 1)
assert(
      'u30. 超过行数上限整项拒绝，不返回半截桶',
      capped.capped === true
        && capped.lanes.info.length === 0
        && capped.lanes.ai.length === 0
        && capped.lanes.print.length === 0
        && cappedAdmin.metrics.heat7d?.available === false
        && cappedAdmin.metrics.heat7d.reason === 'window_row_cap_exceeded'
        && !('value' in cappedAdmin.metrics.heat7d)
        && cappedAdmin.metrics.pulse2h?.available === false
        && cappedAdmin.metrics.channels?.available === true
        && cappedPartner.metrics.partnerDaily?.available === false
        && cappedPartner.metrics.partnerDaily.reason === 'window_row_cap_exceeded'
        && cappedPartner.metrics.partnerContent?.available === true
        && cappedPartner.metrics.partnerTop?.available === true,
    )
let blankOrg: unknown
try {
      await usage.getPartnerUsage('   ', 'today', NOW)
    } catch (error) {
      blankOrg = error
    }
const partnerController = new PartnerUsageController(usage)
let controllerBlank: unknown
try {
      await partnerController.getPartnerUsage({ userId: userA, role: 'partner', orgId: null }, {})
    } catch (error) {
      controllerBlank = error
    }
return carryContext(context, { topB, dailyA, packed, secrets, leaked, bannedKeys, seenKeys, seenTtls, originalGet, get orderCalls() { return orderCalls }, set orderCalls(value: typeof orderCalls) { orderCalls = value }, originalOrderCount, afterFirst, afterHit, degraded, recovered, capped, cappedAdmin, cappedPartner, get blankOrg() { return blankOrg }, set blankOrg(value: typeof blankOrg) { blankOrg = value }, partnerController, get controllerBlank() { return controllerBlank }, set controllerBlank(value: typeof controllerBlank) { controllerBlank = value } })
}


export async function assertBehaviorPhase4(context: Awaited<ReturnType<typeof assertBehaviorPhase3>>) {
const { prisma, cache, usage, suffix, orgA, termLeak, adminId, userA, userB, userBlank, memberId, fileUrl } = context
assert(
      'u31. 空白机构 fail-closed',
      context.blankOrg instanceof PartnerOrgRequiredError && context.controllerBlank instanceof ForbiddenException,
    )
await assertSmallSampleFloor({
      prisma, usage, cache, memberId, terminalId: termLeak, fileUrl, suffix,
    })
await verifyClosedWindows(assert, prisma)
if (process.env['VERIFY_SKIP_HTTP'] !== '1') await assertHttp(prisma, { adminId, userA, userB, userBlank, orgA })
return carryContext(context, {  })
}


export async function assertBehavior(): Promise<void> {
const context = await assertBehaviorSetup()
const { isolated, prisma } = context
try {
const phase1 = await assertBehaviorPhase1(context)
const phase2 = await assertBehaviorPhase2(phase1)
const phase3 = await assertBehaviorPhase3(phase2)
await assertBehaviorPhase4(phase3)

}  finally {
    await prisma.onModuleDestroy().catch(() => undefined)
    isolated.cleanup()
  }

}


export async function assertSmallSampleFloorSetup(input: {
  prisma: PrismaService
  usage: ConsoleScreenUsageService
  cache: ScreenSnapshotCache
  memberId: string
  terminalId: string
  fileUrl: string
  suffix: string
}){

return { input }
}
