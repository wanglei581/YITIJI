// 机构端「终端数据」服务 — GET /partner/terminal-operations?period=week|month|quarter
//
// http 模式：只读真实接口，请求串只带 period（服务端 DTO 只白名单它，多发即 400），
//            机构取自登录账号，本文件不发送任何机构或终端标识；**绝不返回演示数据**。
// mock 模式：返回明确标为「演示数据」的示例（dataMode='demo'），只给本地无后端时看版式。
//
// 口径由服务端算好（services/api/src/orgs/partner-terminal-ops.ts），前端只展示：
//   - 1–4 的计数服务端已置为 null，页面显示「不足 5 次不显示」，不自行补数；
//   - 出纸成功率分母不足 5 时 successRate=null；
//   - 服务人次、AI 可用率当前恒为 available:false，照实写「暂不能统计」。

import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export type TerminalOpsPeriod = 'week' | 'month' | 'quarter'

export interface TerminalOpsOutput {
  /** 出纸成功（completed + 现场核查已出纸） */
  printed: number | null
  /** 统计窗口内已结束（completed + failed） */
  settled: number | null
  /** 百分数，一位小数；分母不足 5 为 null */
  successRate: number | null
  /** 超时未确认、尚未核查 */
  unconfirmed: number | null
}

export interface TerminalOpsFaultTotals {
  offlineCount: number
  offlineMinutes: number
  printerFaultCount: number
  printerFaultMinutes: number
  recoveredCount: number
  avgRecoveryMinutes: number | null
  longestMinutes: number | null
}

export interface TerminalOpsFaults extends TerminalOpsFaultTotals {
  /** 统计到当前仍未恢复 */
  unrecovered: boolean
  /** false = 统计窗口内一次都没上报 */
  reportedInWindow: boolean
}

export interface TerminalOpsRow {
  terminalCode: string
  displayName: string | null
  locationLabel: string | null
  online: boolean
  lastHeartbeatAt: string | null
  /** 服务人次：一体机会话数（1–4 为 null） */
  visitCount: number | null
  /** 打印 + 扫描任务数（按任务计，不等于人次） */
  serviceCount: number | null
  output: TerminalOpsOutput
  faults: TerminalOpsFaults
}

export interface TerminalOpsUnavailable {
  available: false
  reason: string
}

export interface PartnerTerminalOpsResponse {
  period: TerminalOpsPeriod
  timezone: string
  window: { from: string; to: string }
  generatedAt: string
  minSample: number
  terminals: TerminalOpsRow[]
  totals: {
    terminalCount: number
    onlineTerminals: number
    unrecoveredTerminals: number
    silentTerminals: number
    visitCount: number | null
    serviceCount: number | null
    output: TerminalOpsOutput
    faults: TerminalOpsFaultTotals
  }
  /** 服务人次按一体机会话统计；会话记录上线之前的时段没有数 */
  /** recordingStarted=false：本机构终端还没有任何会话记录（一体机上报尚未开始），页面显示「暂无」 */
  visitCount: { available: true; recordingStarted: boolean }
  aiAvailability: TerminalOpsUnavailable
}

/** live = 真实接口；demo = mock 模式的演示数据，不代表任何终端的真实情况 */
export type PartnerTerminalOpsView = PartnerTerminalOpsResponse & { dataMode: 'live' | 'demo' }

async function fetchTerminalOps(period: TerminalOpsPeriod): Promise<PartnerTerminalOpsView> {
  const res = await fetch(`${API_BASE_URL}/partner/terminal-operations?period=${period}`, {
    headers: { Accept: 'application/json', ...authHeader() },
    credentials: 'include',
  })
  if (res.status === 401) redirectToLogin()
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = '终端数据加载失败'
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      if (body.error?.code) code = body.error.code
      if (body.error?.message) message = body.error.message
    } catch {
      /* keep defaults */
    }
    throw new ApiHttpError(code, message, res.status)
  }
  // orgs 模块控制器返回裸对象，不解包 body.data
  const body = (await res.json()) as PartnerTerminalOpsResponse
  return { ...body, dataMode: 'live' }
}

// ─── mock 模式演示数据（只在 VITE_API_MODE 不是 http 时出现）────────────────

function buildDemoTerminalOps(period: TerminalOpsPeriod): PartnerTerminalOpsView {
  const to = '2026-05-26T16:00:00.000Z' // 固定演示参考日 5/27 零点，统计截至 5/26。
  const days = period === 'week' ? 7 : period === 'month' ? 30 : 90
  const from = new Date(Date.parse(to) - days * 86400_000).toISOString()
  const faults = (over: Partial<TerminalOpsFaults>): TerminalOpsFaults => ({
    offlineCount: 0, offlineMinutes: 0, printerFaultCount: 0, printerFaultMinutes: 0,
    recoveredCount: 0, avgRecoveryMinutes: null, longestMinutes: null,
    unrecovered: false, reportedInWindow: true, ...over,
  })
  const terminals: TerminalOpsRow[] = [
    {
      terminalCode: 'DEMO-001', displayName: '演示终端 · 图书馆一层', locationLabel: '演示位置 A',
      online: true, lastHeartbeatAt: to, visitCount: 54, serviceCount: 86,
      output: { printed: null, settled: 63, successRate: null, unconfirmed: null },
      faults: faults({ offlineCount: 1, offlineMinutes: 12, recoveredCount: 1, avgRecoveryMinutes: 12, longestMinutes: 12 }),
    },
    {
      terminalCode: 'DEMO-002', displayName: '演示终端 · 就业服务大厅', locationLabel: '演示位置 B',
      online: false, lastHeartbeatAt: '2026-05-26T05:40:00.000Z', visitCount: null, serviceCount: null,
      output: { printed: null, settled: null, successRate: null, unconfirmed: null },
      faults: faults({ offlineCount: 2, offlineMinutes: 175, printerFaultCount: 1, printerFaultMinutes: 18, recoveredCount: 2, avgRecoveryMinutes: 16.5, longestMinutes: 135, unrecovered: true }),
    },
    {
      terminalCode: 'DEMO-003', displayName: '演示终端 · 未上线', locationLabel: null,
      online: false, lastHeartbeatAt: null, visitCount: 0, serviceCount: 0,
      output: { printed: 0, settled: 0, successRate: null, unconfirmed: 0 },
      faults: faults({ reportedInWindow: false }),
    },
  ]
  return {
    dataMode: 'demo',
    period,
    timezone: 'Asia/Shanghai',
    window: { from, to },
    generatedAt: to,
    minSample: 5,
    terminals,
    totals: {
      terminalCount: 3, onlineTerminals: 1, unrecoveredTerminals: 1, silentTerminals: 1,
      visitCount: null,
      serviceCount: null,
      output: { printed: null, settled: null, successRate: null, unconfirmed: null },
      faults: { offlineCount: 3, offlineMinutes: 187, printerFaultCount: 1, printerFaultMinutes: 18, recoveredCount: 3, avgRecoveryMinutes: 15, longestMinutes: 135 },
    },
    visitCount: { available: true, recordingStarted: true },
    aiAvailability: { available: false, reason: 'ai_calls_not_attributed_to_terminal' },
  }
}

export async function getPartnerTerminalOperations(period: TerminalOpsPeriod = 'week'): Promise<PartnerTerminalOpsView> {
  if (API_MODE !== 'http') return buildDemoTerminalOps(period)
  return fetchTerminalOps(period)
}
