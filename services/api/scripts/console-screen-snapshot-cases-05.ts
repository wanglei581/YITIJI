import { verifyTimelinePrivacy } from './support/console-screen-timeline-privacy'

import { ADMIN_GOV_METRIC_KEYS, ADMIN_OPS_METRIC_KEYS, PARTNER_METRIC_KEYS, SCREEN_MIN_AGGREGATE_SAMPLE } from '../src/console-screen/console-screen.types'
import { ScreenSnapshotCache, containsFailedLoaded } from '../src/console-screen/console-screen.cache'
import { filterSourceEntryOpens, suppressAggregateCount, snapshotLoadStatus } from '../src/console-screen/console-screen.metric'
import { metricKeysFor } from '../src/console-screen/console-screen.assemble'
import { PartnerOrgRequiredError, requirePartnerOrgId } from '../src/console-screen/console-screen.org'
import { suppressTerminalTodayCount } from '../src/console-screen/console-screen.twin'
import { suppressSmallCount } from '../src/console-screen/console-screen.usage.queries'
import { deriveTerminalTimeline } from '../src/console-screen/console-screen.timeline'
import { assert } from './console-screen-snapshot-cases-01'
import { assertPureHelpersSetup } from './console-screen-snapshot-cases-04'
import { carryContext } from './console-screen-snapshot-cases-18'



export async function assertPureHelpersPhase1(context: Awaited<ReturnType<typeof assertPureHelpersSetup>>) {
const filtered = filterSourceEntryOpens([
    { sourceName: '大源', count: 12 },
    { sourceName: '小源', count: 4 },
    { sourceName: '中源', count: 5 },
  ])
assert(
    '2a. N<5 的来源不进 Top',
    filtered.belowThreshold === false
      && filtered.items.length === 2
      && filtered.items.every((item) => item.count >= SCREEN_MIN_AGGREGATE_SAMPLE)
      && !filtered.items.some((item) => item.sourceName === '小源'),
  )
const allSmall = filterSourceEntryOpens([
    { sourceName: 'A', count: 2 },
    { sourceName: 'B', count: 4 },
  ])
assert(
    '2b. 全部 N<5 时 belowThreshold=true 且 items 为空',
    allSmall.belowThreshold && allSmall.items.length === 0,
  )
assert(
    '2c. gov 现为 12 项且含任务流与告警，ops 仍不含 visitCount',
    metricKeysFor('admin', 'gov').includes('visitCount')
      && metricKeysFor('admin', 'gov').includes('taskFlow24h')
      && metricKeysFor('admin', 'gov').includes('alertsRealtime')
      && metricKeysFor('admin', 'gov').length === 12
      && ADMIN_GOV_METRIC_KEYS.length === 12
      && metricKeysFor('admin', 'ops').includes('alertsRealtime')
      && metricKeysFor('admin', 'ops').includes('taskFlow24h')
      && !metricKeysFor('admin', 'ops').includes('visitCount')
      && metricKeysFor('admin', 'gov').join() !== metricKeysFor('admin', 'ops').join()
      && metricKeysFor('partner').includes('sourceEntryOpensTop')
      && ADMIN_OPS_METRIC_KEYS.length === 12
      && PARTNER_METRIC_KEYS.length > 10,
  )
assert(
    '2u. 终端当日计数：0 保留，1 与 4 为 null，5 给出',
    suppressTerminalTodayCount === suppressAggregateCount
      && suppressSmallCount === suppressAggregateCount
      && suppressTerminalTodayCount(-2) === 0
      && suppressTerminalTodayCount(0) === 0
      && suppressTerminalTodayCount(1) === null
      && suppressTerminalTodayCount(4) === null
      && suppressTerminalTodayCount(5) === 5
      && suppressTerminalTodayCount(12) === 12,
  )
let now = 1_000
const cache = ScreenSnapshotCache.forTest(() => now)
let loads = 0
const load = async () => {
    loads += 1
    return loads
  }
await cache.getOrLoad('k', 15, load)
await cache.getOrLoad('k', 15, load)
assert('2d. 缓存命中不重复加载', loads === 1)
now += 16_000
await cache.getOrLoad('k', 15, load)
assert('2e. TTL 过期后重新加载', loads === 2)
assert('2f. 全失败/局部失败状态机', snapshotLoadStatus(4, 4) === 'ok' && snapshotLoadStatus(2, 4) === 'degraded' && snapshotLoadStatus(0, 4) === 'unavailable')
const capped = ScreenSnapshotCache.forTest(() => 2_000, 3)
for (let i = 0; i < 5; i += 1) {
    await capped.getOrLoad(`k${i}`, 15, async () => i)
  }
assert('2g. 缓存活 key 不超过上限', capped.size() === 3, `size=${capped.size()}`)
let clock = 3_000
const expiring = ScreenSnapshotCache.forTest(() => clock, 10)
await expiring.getOrLoad('old', 15, async () => 1)
clock += 16_000
await expiring.getOrLoad('new', 15, async () => 2)
assert('2h. 过期 key 被清理', expiring.size() === 1)
let flightLoads = 0
let releaseFlight!: () => void
const flightGate = new Promise<void>((resolve) => {
    releaseFlight = resolve
  })
const flightCache = ScreenSnapshotCache.forTest(() => 4_000)
const sharedLoad = async () => {
    flightLoads += 1
    await flightGate
    return 77
  }
const firstFlight = flightCache.getOrLoad('same', 15, sharedLoad)
while (flightLoads < 1) await Promise.resolve()
const secondFlight = flightCache.getOrLoad('same', 15, sharedLoad)
releaseFlight()
const [left, right] = await Promise.all([firstFlight, secondFlight])
assert(
    '2i. 同一 key 并发 miss 只 load 一次且结果一致',
    flightLoads === 1 && left.value === 77 && right.value === 77 && left.storedAt === right.storedAt,
    `loads=${flightLoads}`,
  )
let blocked = false
let releaseSlow!: () => void
const slowGate = new Promise<void>((resolve) => {
    releaseSlow = resolve
  })
const isolated = ScreenSnapshotCache.forTest(() => 5_000)
const slow = isolated.getOrLoad('slow', 15, async () => {
    await slowGate
    return 'slow'
  })
const fast = await isolated.getOrLoad('fast', 15, async () => 'fast')
blocked = fast.value !== 'fast'
releaseSlow()
await slow
assert('2j. 不同 key 不互相阻塞', !blocked && fast.value === 'fast')
let boomLoads = 0
let releaseBoom!: () => void
const boomGate = new Promise<void>((resolve) => {
    releaseBoom = resolve
  })
const boomCache = ScreenSnapshotCache.forTest(() => 6_000)
const boom = async () => {
    boomLoads += 1
    await boomGate
    throw new Error('loader-reject')
  }
const boomOne = boomCache.getOrLoad('boom', 15, boom)
while (boomLoads < 1) await Promise.resolve()
const boomTwo = boomCache.getOrLoad('boom', 15, boom)
releaseBoom()
const boomSettled = await Promise.allSettled([boomOne, boomTwo])
assert(
    '2k. loader reject 后 in-flight 清理且只跑一次',
    boomLoads === 1
      && boomSettled.every((item) => item.status === 'rejected')
      && boomCache.inflightSize() === 0,
    `loads=${boomLoads} inflight=${boomCache.inflightSize()}`,
  )
let retryLoads = 0
const retried = await boomCache.getOrLoad('boom', 15, async () => {
    retryLoads += 1
    return 9
  })
assert('2l. reject 之后可以重试', retryLoads === 1 && retried.value === 9)
assert('2m. 含 ok:false 的聚合判定为失败切片', containsFailedLoaded({ fleet: { ok: false, reason: 'source_query_failed' } }))
const rejectedOrgIds: unknown[] = [null, undefined, '', '   ', '\n\t', 0, {}, []]
assert(
    '2n. Partner orgId 空/空白/不可解析一律 throw，不得当成全局',
    rejectedOrgIds.every((value) => {
      try {
        requirePartnerOrgId(value)
        return false
      } catch (error) {
        return error instanceof PartnerOrgRequiredError
      }
    })
      && requirePartnerOrgId(' org_ok ') === 'org_ok',
  )
await verifyTimelinePrivacy(assert)
const timelineNow = new Date('2026-09-25T04:00:00.000Z')
const timelineStart = new Date(timelineNow.getTime() - 24 * 60 * 60 * 1000)
const beatAt = new Date(timelineNow.getTime() - 400_000)
const mergedTimeline = deriveTerminalTimeline({
    now: timelineNow,
    heartbeats: [
      { at: beatAt, printerStatus: 'ready' },
      { at: new Date(beatAt.getTime() + 10_000), printerStatus: 'ok' },
    ],
    prints: [],
    onlineWindowMs: 180_000,
  })
return carryContext(context, { filtered, allSmall, get now() { return now }, set now(value: typeof now) { now = value }, cache, get loads() { return loads }, set loads(value: typeof loads) { loads = value }, load, capped, get clock() { return clock }, set clock(value: typeof clock) { clock = value }, expiring, get flightLoads() { return flightLoads }, set flightLoads(value: typeof flightLoads) { flightLoads = value }, get releaseFlight() { return releaseFlight }, set releaseFlight(value: typeof releaseFlight) { releaseFlight = value }, flightGate, flightCache, sharedLoad, firstFlight, secondFlight, left, right, get blocked() { return blocked }, set blocked(value: typeof blocked) { blocked = value }, get releaseSlow() { return releaseSlow }, set releaseSlow(value: typeof releaseSlow) { releaseSlow = value }, slowGate, isolated, slow, fast, get boomLoads() { return boomLoads }, set boomLoads(value: typeof boomLoads) { boomLoads = value }, get releaseBoom() { return releaseBoom }, set releaseBoom(value: typeof releaseBoom) { releaseBoom = value }, boomGate, boomCache, boom, boomOne, boomTwo, boomSettled, get retryLoads() { return retryLoads }, set retryLoads(value: typeof retryLoads) { retryLoads = value }, retried, rejectedOrgIds, timelineNow, timelineStart, beatAt, mergedTimeline })
}
