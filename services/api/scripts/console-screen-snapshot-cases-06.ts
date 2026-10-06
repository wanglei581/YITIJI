import { SCREEN_UNAVAILABLE_REASON } from '../src/console-screen/console-screen.types'
import { offlineAlertTitle } from '../src/console-screen/console-screen.fleet'
import { TIMELINE_HEARTBEAT_ROW_CAP, TIMELINE_SEGMENT_CAP, deriveTerminalTimeline, type TimelineHeartbeat } from '../src/console-screen/console-screen.timeline'
import { assert } from './console-screen-snapshot-cases-01'
import { deriveTerminalTimelineQuadratic } from './console-screen-snapshot-cases-03'
import { diffTimelineSamples, assertPureHelpersSetup } from './console-screen-snapshot-cases-04'
import { assertPureHelpersPhase1 } from './console-screen-snapshot-cases-05'
import { carryContext } from './console-screen-snapshot-cases-18'

import { Module, type INestApplicationContext } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ScreenSnapshotCache } from '../src/console-screen/console-screen.cache'
import { PrismaService } from '../src/prisma/prisma.service'
import { ConsoleScreenService } from '../src/console-screen/console-screen.service'



export async function assertPureHelpersPhase2(context: Awaited<ReturnType<typeof assertPureHelpersPhase1>>) {
const { timelineNow, timelineStart, beatAt, mergedTimeline } = context
assert(
    '2p. 重叠在线心跳合并成一段 idle，缺口记 offline，且铺满 24 小时',
    mergedTimeline.ok
      && mergedTimeline.segments.filter((segment) => segment.state === 'idle').length === 1
      && mergedTimeline.segments[0]?.from === timelineStart.toISOString().slice(0, 16) + 'Z'
      && mergedTimeline.segments[mergedTimeline.segments.length - 1]?.to === timelineNow.toISOString().slice(0, 16) + 'Z'
      && mergedTimeline.segments.every((segment, index) => index === 0 || segment.from === mergedTimeline.segments[index - 1]?.to)
      && mergedTimeline.segments.every((segment, index) => index === mergedTimeline.segments.length - 1 || segment.state !== mergedTimeline.segments[index + 1]?.state),
  )
const printedTimeline = deriveTerminalTimeline({
    now: timelineNow,
    heartbeats: [{ at: beatAt, printerStatus: null }],
    prints: [{ from: new Date(timelineNow.getTime() - 300_000), to: new Date(timelineNow.getTime() - 200_000) }],
    onlineWindowMs: 180_000,
  })
const alertTimeline = deriveTerminalTimeline({
    now: timelineNow,
    heartbeats: [{ at: new Date(timelineNow.getTime() - 60_000), printerStatus: 'paper_empty' }],
    prints: [],
    onlineWindowMs: 180_000,
  })
const unknownTimeline = deriveTerminalTimeline({ now: timelineNow, heartbeats: [], prints: [] })
const cappedTimeline = deriveTerminalTimeline({
    now: timelineNow,
    heartbeats: [{ at: beatAt, printerStatus: null }],
    prints: [],
    onlineWindowMs: 180_000,
    segmentCap: 1,
  })
const rowCapTimeline = deriveTerminalTimeline({
    now: timelineNow,
    heartbeats: [],
    prints: [],
    heartbeatRowCapExceeded: true,
  })
assert(
    '2q. 打印不改变心跳可用性；缺纸标 alert；没有心跳是 unknown；超上限整段不可用',
    printedTimeline.ok
      && !printedTimeline.segments.some((segment) => String(segment.state) === 'printing')
      && alertTimeline.ok
      && alertTimeline.segments.some((segment) => segment.state === 'alert')
      && !alertTimeline.segments.some((segment) => segment.state === 'idle')
      && unknownTimeline.ok
      && unknownTimeline.segments.length === 1
      && unknownTimeline.segments[0]?.state === 'unknown'
      && !cappedTimeline.ok
      && cappedTimeline.reason === SCREEN_UNAVAILABLE_REASON.windowRowCapExceeded
      && !rowCapTimeline.ok
      && rowCapTimeline.reason === SCREEN_UNAVAILABLE_REASON.windowRowCapExceeded
      && TIMELINE_SEGMENT_CAP >= 480,
  )
const tenSecondCount = (24 * 60 * 60 * 1000) / 10_000
const tenSecondBeats: TimelineHeartbeat[] = Array.from({ length: tenSecondCount }, (_, index) => ({
    at: new Date(timelineNow.getTime() - 24 * 60 * 60 * 1000 + index * 10_000),
    printerStatus: 'ready',
  }))
const timelineStarted = performance.now()
const tenSecondTimeline = deriveTerminalTimeline({ now: timelineNow, heartbeats: tenSecondBeats, prints: [] })
const tenSecondMs = performance.now() - timelineStarted
const tenSecondReferenceStarted = performance.now()
const tenSecondReference = deriveTerminalTimelineQuadratic({ now: timelineNow, heartbeats: tenSecondBeats, prints: [] })
const tenSecondReferenceMs = performance.now() - tenSecondReferenceStarted
console.log(
    `  timeline 10s×24h: new ${tenSecondMs.toFixed(2)} ms, quadratic reference ${tenSecondReferenceMs.toFixed(2)} ms, segments ${tenSecondTimeline.ok ? tenSecondTimeline.segments.length : 'unavailable'}`,
  )
assert(
    '2s. 10 秒一次、24 小时心跳推导 < 100ms，且与旧算法逐段一致、合并为 1 段 idle',
    tenSecondMs < 100
      && JSON.stringify(tenSecondTimeline) === JSON.stringify(tenSecondReference)
      && tenSecondTimeline.ok
      && tenSecondTimeline.segments.length === 1
      && tenSecondTimeline.segments[0]?.state === 'idle'
      && TIMELINE_HEARTBEAT_ROW_CAP >= 8_640,
    `new=${tenSecondMs.toFixed(2)} ms reference=${tenSecondReferenceMs.toFixed(2)} ms cap=${TIMELINE_HEARTBEAT_ROW_CAP}`,
  )
const timelineDiffs = diffTimelineSamples(timelineNow)
assert(
    '2t. 50 组随机心跳和打印区间与旧算法逐段一致',
    timelineDiffs.length === 0,
    timelineDiffs[0],
  )
assert(
    '2r. 离线文案按分钟/小时给领导短句',
    offlineAlertTitle(34 * 60_000) === '离线 34 分钟'
      && offlineAlertTitle(2 * 60 * 60_000) === '离线 2 小时'
      && offlineAlertTitle(3 * 24 * 60 * 60_000) === '离线 3 天',
  )
await assertNestConstructsCache()
return carryContext(context, { printedTimeline, alertTimeline, unknownTimeline, cappedTimeline, rowCapTimeline, tenSecondCount, tenSecondBeats, timelineStarted, tenSecondTimeline, tenSecondMs, tenSecondReferenceStarted, tenSecondReference, tenSecondReferenceMs, timelineDiffs })
}


export async function assertPureHelpers(): Promise<void> {
const context = await assertPureHelpersSetup()
const phase1 = await assertPureHelpersPhase1(context)
await assertPureHelpersPhase2(phase1)

}


export async function assertNestConstructsCache(): Promise<void> {
  const paramtypes = (Reflect.getMetadata('design:paramtypes', ScreenSnapshotCache) ?? []) as unknown[]
  const injectableTypes = paramtypes.filter((item) => item === Function || item === Number)

  @Module({ providers: [ScreenSnapshotCache] })
  class ScreenCacheNestProbeModule {}

  let app: INestApplicationContext | undefined
  try {
    app = await NestFactory.createApplicationContext(ScreenCacheNestProbeModule, {
      logger: false,
      abortOnError: false,
    })
    const cache = app.get(ScreenSnapshotCache)
    const loaded = await cache.getOrLoad('nest-boot', 15, async () => 7)
    assert(
      '2o. Nest class provider 能构造 ScreenSnapshotCache，不依赖 Function/Number token',
      injectableTypes.length === 0
        && loaded.value === 7
        && loaded.hit === false
        && cache.size() === 1,
      `paramtypes=${paramtypes.map((item) => (typeof item === 'function' ? item.name : String(item))).join(',') || '(empty)'}`,
    )
  } catch (error) {
    assert(
      '2o. Nest class provider 能构造 ScreenSnapshotCache，不依赖 Function/Number token',
      false,
      error instanceof Error ? error.message : String(error),
    )
  } finally {
    await app?.close()
  }
}


export function isHostingClosed(
  metric: { available: boolean; source: string; window: string; reason?: string } | undefined,
  source: string,
  window: string,
): boolean {
  return Boolean(
    metric
      && metric.available === false
      && metric.reason === 'recruitment_hosting_disabled'
      && SCREEN_UNAVAILABLE_REASON.recruitmentHostingDisabled === 'recruitment_hosting_disabled'
      && metric.source === source
      && metric.window === window
      && !('value' in metric),
  )
}


export function firstMetricDiff(left: object, right: object, except: readonly string[]): string {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (JSON.stringify(leftKeys) !== JSON.stringify(rightKeys)) {
    return `keys ${leftKeys.join(',')} vs ${rightKeys.join(',')}`
  }
  for (const key of leftKeys) {
    if (except.includes(key)) continue
    const l = JSON.stringify((left as Record<string, unknown>)[key])
    const r = JSON.stringify((right as Record<string, unknown>)[key])
    if (l !== r) return `${key} ${(l ?? '').slice(0, 140)} != ${(r ?? '').slice(0, 140)}`
  }
  return ''
}


export function limitRest(limits: { recruitmentHosting: string }): string {
  const rest = Object.fromEntries(Object.entries(limits).filter(([key]) => key !== 'recruitmentHosting'))
  return JSON.stringify(rest)
}


export async function assertRecruitmentHostingContractSetup(
  prisma: PrismaService,
  screen: ConsoleScreenService,
  args: {
    orgA: string
    orgB: string
    memberId: string
    suffix: string
    now: Date
    jumpQualified: string
    jumpSmall: string
  },
){
const { orgA, orgB, memberId, suffix, now, jumpQualified, jumpSmall } = args
const orgEmpty = `org_scrn_host_${suffix}`
const policyId = `pol_host_${suffix}`
const fairId = `fair_host_${suffix}`
const companyId = `co_host_${suffix}`
let jobId = ''
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'true'
return { prisma, screen, args, orgA, orgB, memberId, suffix, now, jumpQualified, jumpSmall, orgEmpty, policyId, fairId, companyId, get jobId() { return jobId }, set jobId(value: typeof jobId) { jobId = value } }
}
