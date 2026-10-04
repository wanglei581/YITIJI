import type { ScreenUsageCoverage, ScreenUsageLane, ScreenUsageRange, ScreenUsageServiceItem, ScreenUsageServiceKey, ScreenUsageSnapshot, ScreenTerminalTwin } from '@ai-job-print/shared'
import { isoAgo, ok, na, cityCells } from './snapshots-cases-01'
import { isUsageRange, heatDays, pulseBuckets } from './snapshots-cases-02'



export function usageSnapshot(range: string): ScreenUsageSnapshot {
  const safe: ScreenUsageRange = isUsageRange(range) ? range : 'today'
  const nowMs = Date.now()
  const start = new Date(nowMs + 8 * 3600000)
  start.setUTCHours(0, 0, 0, 0)
  const midnight = start.getTime() - 8 * 3600000
  const until = safe === 'today' ? nowMs : midnight
  const from = safe === 'today' ? midnight : midnight - (safe === '7d' ? 7 : 30) * 86400000
  const svc = (key: ScreenUsageServiceKey, lane: ScreenUsageLane, count: number | null, coverage: ScreenUsageCoverage): ScreenUsageServiceItem => ({
    key,
    lane,
    count,
    coverage,
  })
  return {
    generatedAt: isoAgo(9),
    audience: 'admin',
    range: safe,
    window: { timezone: 'Asia/Shanghai', from: new Date(from).toISOString(), to: new Date(until).toISOString() },
    status: 'ok',
    degraded: false,
    limits: { minAggregateSample: 5, recruitmentHosting: 'enabled' },
    metrics: {
      channels: ok('Order.channel', safe, { paidOrders: 415, kiosk: 290, miniapp: 118, unlabeled: 7, memberOrders: 158 }),
      visits: na('KioskSession.startedAt', safe, 'sample_below_threshold'),
      services: ok('mixed', safe, [
        svc('jobs', 'info', 1246, 'members_only'),
        svc('fairs', 'info', 328, 'members_only'),
        svc('policy', 'info', 412, 'members_only'),
        svc('company', 'info', 236, 'members_only'),
        svc('aiResume', 'ai', 439, 'all_recorded'),
        svc('aiAdvisor', 'ai', 486, 'all_recorded'),
        svc('interview', 'ai', 72, 'all_recorded'),
        svc('careerPlan', 'ai', 53, 'all_recorded'),
        svc('jobAi', 'ai', null, 'all_recorded'),
        svc('print', 'print', 402, 'all_recorded'),
        svc('scan', 'print', 84, 'all_recorded'),
      ]),
      outcomes: ok('mixed', safe, { sourceOpens: 532, favorites: 136, aiReports: 381, printed: 402 }),
      heat7d: ok('mixed', '7d', { days: heatDays(nowMs), peakHour: 11 }),
      pulse2h: ok('mixed', '2h', { bucketMinutes: 5 as const, buckets: pulseBuckets(nowMs) }),
      printSteps: ok('PrintTask/Order', safe, {
        uploaded: na<number>('FileObject', safe, 'upload_counter_unwritten'),
        inspected: na<number>('DocumentProcessTask', safe, 'inspection_counter_unwritten'),
        paid: 415,
        printed: 402,
      }),
      resumeSteps: ok('AiServiceLog/AuditLog', safe, {
        uploaded: na<number>('FileObject', safe, 'upload_counter_unwritten'),
        analyzed: 268,
        optimized: 171,
        exported: 118,
      }),
      ai: ok('AiServiceLog', safe, {
        total: 1086,
        success: 1058,
        failed: 28,
        successRate: 97.4,
        avgLatencyMs: 2180,
        estimatedCostCny: 38.74,
        costMeasuredCalls: 980,
        fallbackCalls: 9,
        byOperation: [
          { operation: 'chatAssistant', count: 486 },
          { operation: 'parseResume', count: 268 },
          { operation: 'optimizeResume', count: 171 },
          { operation: 'interviewQuestion', count: 72 },
          { operation: 'careerPlan', count: 53 },
          { operation: 'contractReview', count: null },
        ],
        providers: [
          { provider: 'llm:deepseek', label: 'DeepSeek', count: 1032 },
          { provider: 'llm:qwen', label: '千问', count: 45 },
          { provider: 'mock', label: '未就绪兜底', count: 9 },
        ],
      }),
      jobs: ok('BrowseLog/Favorite/ExternalJumpLog', safe, { browse: 1246, favorites: 97, sourceOpens: 388, coverage: 'members_only' }),
      topSources30d: ok('ExternalJumpLog.sourceName', '30d', {
        copy: '打开来源平台入口',
        minSampleThreshold: 5,
        items: [
          { sourceName: '广东公共就业', count: 412 },
          { sourceName: '海珠海纳职通', count: 293 },
          { sourceName: '南方人才网', count: 198 },
          { sourceName: '广州人社局', count: 127 },
          { sourceName: '校园招聘专区', count: 89 },
        ],
      }),
      content: ok('BrowseLog', safe, { policy: 412, fair: 328, company: 236, coverage: 'members_only' }),
    },
  }
}


export function usageHostingOff(range: string): ScreenUsageSnapshot {
  const base = usageSnapshot(range)
  base.limits = { minAggregateSample: 5, recruitmentHosting: 'disabled' }
  const services = base.metrics.services
  if (services?.available) {
    base.metrics.services = ok(
      services.source,
      services.window,
      services.value
        .filter((item) => item.key !== 'jobs' && item.key !== 'fairs' && item.key !== 'company')
        .map((item) => (item.key === 'jobAi' ? { ...item, count: 23 } : item)),
    )
  }
  const ai = base.metrics.ai
  if (ai?.available) {
    base.metrics.ai = ok(ai.source, ai.window, { ...ai.value, byOperation: [...ai.value.byOperation, { operation: 'jobMatch', count: 23 }] })
  }
  base.metrics.outcomes = ok('mixed', base.range, { sourceOpens: 58, favorites: 41, aiReports: 381, printed: 402 })
  base.metrics.jobs = na('BrowseLog/Favorite/ExternalJumpLog', base.range, 'recruitment_hosting_disabled')
  base.metrics.topSources30d = na('ExternalJumpLog.sourceName', '30d', 'recruitment_hosting_disabled')
  base.metrics.content = ok('BrowseLog', base.range, { policy: 412, fair: null, company: null, coverage: 'members_only' })
  return base
}


export function usageChannelsFailed(range: string): ScreenUsageSnapshot {
  const base = usageSnapshot(range)
  base.status = 'degraded'
  base.degraded = true
  base.metrics.channels = na('Order.channel', base.range, 'source_query_failed')
  return base
}


export function usageVisitsFailed(range: string): ScreenUsageSnapshot {
  const base = usageSnapshot(range)
  base.status = 'degraded'
  base.degraded = true
  base.metrics.visits = na('KioskSession', base.range, 'source_query_failed')
  return base
}


export function terminalTwin(id: string): ScreenTerminalTwin | null {
  const cell = cityCells().find((c) => c.terminalId === id)
  if (!cell) return null
  const now = Date.now()
  const seg = (fromH: number, toH: number, state: 'idle' | 'alert' | 'offline' | 'unknown') => ({
    from: new Date(now - fromH * 3600_000).toISOString().slice(0, 16) + 'Z',
    to: new Date(now - toH * 3600_000).toISOString().slice(0, 16) + 'Z',
    state,
  })
  const printing = cell.activity === 'printing'
  const printerState = cell.health === 'offline' ? 'offline' : cell.health === 'unknown' ? 'unknown' : cell.health === 'degraded' ? 'error' : printing ? 'printing' : 'ready'
  return {
    generatedAt: new Date(now).toISOString().slice(0, 16) + 'Z',
    audience: 'admin',
    terminal: { id, code: cell.terminalCode, displayName: '人才服务大厅一楼', areaLabel: cell.areaLabel, locationLabel: '人才服务大厅', geo: null },
    status: {
      health: cell.health,
      lastHeartbeatAt: cell.health === 'unknown' ? null : new Date(now - (cell.health === 'offline' ? 720_000 : 3000)).toISOString().slice(0, 16) + 'Z',
      onlineWindowSeconds: 180,
      agentVersion: cell.health === 'unknown' ? null : '0.9.4',
      wiredNetwork: cell.health === 'unknown' ? null : 'connected',
    },
    printer: ok('TerminalHeartbeat+TerminalCapability', 'current', {
      name: null,
      state: printerState,
      errorLabel: cell.health === 'degraded' && cell.alert ? cell.alert.title : null,
      colorEnabled: false,
      duplexEnabled: true,
    }),
    scanner: ok('TerminalHeartbeat+ScanTask', 'current', { state: 'ready', label: null }),
    currentTask: ok('PrintTask.status', 'current', printing ? { pages: 12, colorMode: 'bw', startedAt: new Date(now - 40_000).toISOString().slice(0, 16) + 'Z' } : null),
    today: { printPages: 36, printTasks: 18, scans: null, failed: null, visits: na('KioskSession.startedAt', 'shanghai-day', 'sample_below_threshold') },
    consumables: na('TerminalHeartbeat', 'current', 'no_consumable_or_geo_fields'),
    timeline24h: ok('TerminalHeartbeat', '24h', [
      seg(24, 17, 'offline'),
      seg(17, 9.5, 'idle'),
      seg(9.5, 9.2, 'idle'),
      seg(9.2, 7, 'idle'),
      seg(7, 6.7, 'alert'),
      seg(6.7, 3, 'idle'),
      seg(3, 2.8, 'idle'),
      seg(2.8, 0.02, 'idle'),
      seg(0.02, 0, 'idle'),
    ]),
  }
}


export function terminalTwinVisitsFailed(id: string): ScreenTerminalTwin | null {
  const twin = terminalTwin(id)
  if (!twin) return null
  twin.today.visits = na('KioskSession.startedAt', 'shanghai-day', 'source_query_failed')
  return twin
}


export function terminalTwinPrinterFailed(id: string): ScreenTerminalTwin | null {
  const twin = terminalTwin(id)
  if (twin) twin.printer = na('TerminalHeartbeat+TerminalCapability', 'current', 'source_query_failed')
  return twin
}
