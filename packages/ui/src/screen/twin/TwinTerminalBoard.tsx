import type { ScreenMetricLike } from '../ScreenPrimitives'
import { screenCount } from '../ScreenPrimitives'
import { TwinSceneBox, TwinSlot } from './TwinFrame'
import { TwinMetricPanel, TwinPanel } from './TwinPanel'
import { TwinLegend, TwinTiles, TwinTimeline, type TwinState } from './TwinCharts'
import { TWIN_DEVICE_H, TWIN_DEVICE_W, TwinDevice, type TwinDeviceCallout } from './TwinDevice'
import { twinTerminalState, TWIN_STATE_TEXT } from './TwinCity'

/**
 * 单台终端孪生的整版块位（当前任务 / 设备模型 / 设备概况 / 今日服务 / 24 小时状态）。
 * 管理员与机构两端共用；数据来自各自的终端孪生接口，时间格式化由调用方注入（上海时区）。
 *
 * UI 包不依赖 shared，这里的结构类型与契约 ScreenTerminalTwin 同形。
 */

export interface TwinTerminalTwinLike {
  generatedAt: string
  terminal: { id: string; code: string; displayName: string | null; areaLabel: string | null; locationLabel: string | null }
  status: {
    health: 'healthy' | 'degraded' | 'offline' | 'unknown'
    lastHeartbeatAt: string | null
    onlineWindowSeconds: number
    agentVersion: string | null
    wiredNetwork: string | null
  }
  printer: ScreenMetricLike<{
    name: string | null
    state: 'ready' | 'printing' | 'error' | 'offline' | 'unknown'
    errorLabel: string | null
    colorEnabled: boolean
    duplexEnabled: boolean
  }>
  scanner: ScreenMetricLike<{ state: 'ready' | 'busy' | 'error' | 'unknown'; label: string | null }>
  currentTask: ScreenMetricLike<{ pages: number; colorMode: 'bw' | 'color' | null; startedAt: string | null } | null>
  today: { printPages: number; printTasks: number; scans: number; failed: number; visits: ScreenMetricLike<number> }
  consumables: ScreenMetricLike<{ paper: string | null; toner: string | null }>
  timeline24h: ScreenMetricLike<Array<{ from: string; to: string; state: 'idle' | 'printing' | 'alert' | 'offline' | 'unknown' }>>
}

export interface TwinTerminalBoardProps {
  twin: TwinTerminalTwinLike
  /** ISO → 上海时区「HH:mm:ss」。 */
  formatClock: (iso: string) => string
  /** ISO → 上海时区「YYYY-MM-DD HH:mm」。 */
  formatDateTime: (iso: string) => string
  unassignedAreaLabel: string
}

const PRINTER_TEXT = { ready: '就绪', printing: '打印中', error: '故障', offline: '离线', unknown: '状态未知' } as const
const SCANNER_TEXT = { ready: '就绪', busy: '使用中', error: '暂不可用', unknown: '状态未知' } as const
const WIRED_TEXT: Record<string, string> = { connected: '有线已连接', disconnected: '有线已断开', unknown: '有线状态未知' }

/** 终端级计数也守「少于 5 不显示」：一台机器一天只有两三单时，具体数字就能对上是谁。 */
function smallCount(value: number): string {
  if (value > 0 && value < 5) return '少于 5'
  return screenCount(value)
}

function heartbeatText(twin: TwinTerminalTwinLike): string {
  const last = twin.status.lastHeartbeatAt
  if (!last) return '从未上报心跳'
  const seconds = Math.max(0, Math.round((Date.parse(twin.generatedAt) - Date.parse(last)) / 1000))
  if (seconds > twin.status.onlineWindowSeconds) return `超过 ${twin.status.onlineWindowSeconds} 秒无心跳`
  if (seconds < 60) return `心跳 ${seconds} 秒前`
  return `心跳 ${Math.floor(seconds / 60)} 分钟前`
}

function deviceCallouts(twin: TwinTerminalTwinLike, state: TwinState): TwinDeviceCallout[] {
  const out: TwinDeviceCallout[] = [
    {
      key: 'terminal',
      label: '终端',
      value: `${TWIN_STATE_TEXT[state]} · ${heartbeatText(twin)}`,
      tone: state === 'off' ? 'err' : state === 'un' ? 'muted' : state === 'wa' ? 'warn' : 'ok',
    },
  ]
  if (twin.printer.available) {
    const p = twin.printer.value
    const caps = `${p.colorEnabled ? '彩色已开通' : '彩色未开通'} · ${p.duplexEnabled ? '双面已开通' : '双面未开通'}`
    out.push({
      key: 'printer',
      label: '打印机',
      value: `${p.errorLabel ?? PRINTER_TEXT[p.state]} · ${caps}`,
      tone: p.state === 'error' ? 'err' : p.state === 'offline' ? 'err' : p.state === 'unknown' ? 'muted' : 'ok',
    })
  } else {
    out.push({ key: 'printer', label: '打印机', value: '待接入', tone: 'pend' })
  }
  if (twin.scanner.available) {
    const s = twin.scanner.value
    out.push({ key: 'scanner', label: '扫码器', value: s.label ?? SCANNER_TEXT[s.state], tone: s.state === 'error' ? 'warn' : s.state === 'unknown' ? 'muted' : 'ok' })
  } else {
    out.push({ key: 'scanner', label: '扫码器', value: '待接入', tone: 'pend' })
  }
  const wired = twin.status.wiredNetwork
  out.push({
    key: 'network',
    label: '网络',
    value: wired ? WIRED_TEXT[wired] ?? '有线状态未知' : '网络状态未上报',
    tone: wired === 'connected' ? 'ok' : wired === 'disconnected' ? 'err' : 'muted',
  })
  out.push({
    key: 'supplies',
    label: '纸盒与碳粉',
    value: twin.consumables.available ? '已上报' : '待接入 · 需 Agent 上报',
    tone: twin.consumables.available ? 'ok' : 'pend',
  })
  return out
}

function timelineTicks(twin: TwinTerminalTwinLike, formatClock: (iso: string) => string): string[] {
  const end = Date.parse(twin.generatedAt)
  const ticks: string[] = []
  for (let h = 24; h > 0; h -= 6) ticks.push(formatClock(new Date(end - h * 3600_000).toISOString()).split(':').slice(0, 2).join(':'))
  ticks.push('现在')
  return ticks
}

export function TwinTerminalBoard({ twin, formatClock, formatDateTime, unassignedAreaLabel }: TwinTerminalBoardProps) {
  const state = twinTerminalState({ health: twin.status.health, activity: null, alert: null })
  const current = twin.currentTask.available ? twin.currentTask.value : null
  const printing = current !== null
  const shownState: TwinState = printing && state === 'ok' ? 'pr' : state
  const screenTitle = printing ? '正在打印' : TWIN_STATE_TEXT[shownState]
  const screenLine = printing
    ? `${current.colorMode === 'color' ? '彩色' : current.colorMode === 'bw' ? '黑白' : '色彩未标注'} · 共 ${screenCount(current.pages)} 页`
    : heartbeatText(twin)
  return (
    <>
      <TwinSlot slot="task">
        <TwinMetricPanel
          title="当前任务"
          metric={twin.currentTask}
          source="打印任务当前状态（已领取或打印中）。只显示页数与色彩，不显示文件名、用户与订单号。"
          render={(task) =>
            task ? (
              <p className="twin-cap">
                <span className="twin-strong">
                  {task.colorMode === 'color' ? '彩色' : task.colorMode === 'bw' ? '黑白' : '色彩未标注'} · {screenCount(task.pages)} 页
                </span>
                {task.startedAt ? ` · 开始于 ${formatClock(task.startedAt)}` : ' · 已领取，等待出纸'}
              </p>
            ) : (
              <p className="twin-cap">当前没有进行中的打印任务</p>
            )
          }
        />
      </TwinSlot>

      <TwinSlot slot="scene">
        <TwinSceneBox baseWidth={TWIN_DEVICE_W} baseHeight={TWIN_DEVICE_H} label={`${twin.terminal.code} 终端孪生`}>
          <TwinDevice
            code={twin.terminal.code}
            state={shownState}
            screenTitle={screenTitle}
            screenLine={screenLine}
            printing={printing}
            callouts={deviceCallouts(twin, shownState)}
          />
        </TwinSceneBox>
      </TwinSlot>

      <TwinSlot slot="r1">
        <TwinPanel title="设备概况" sub="实时" source={`终端档案与最近一次心跳。在线判定窗口 ${twin.status.onlineWindowSeconds} 秒。打印机型号按本机配置，不在大屏写死。`}>
          <dl className="twin-rows">
            <div><dt>终端编号</dt><dd className="twin-num">{twin.terminal.code}</dd></div>
            <div><dt>名称</dt><dd>{twin.terminal.displayName ?? '未命名'}</dd></div>
            <div><dt>所在区</dt><dd>{twin.terminal.areaLabel ?? unassignedAreaLabel}</dd></div>
            <div><dt>点位</dt><dd>{twin.terminal.locationLabel ?? '未填写'}</dd></div>
            <div><dt>最近心跳</dt><dd className="twin-num">{twin.status.lastHeartbeatAt ? formatDateTime(twin.status.lastHeartbeatAt) : '从未上报'}</dd></div>
            <div><dt>Agent 版本</dt><dd className="twin-num">{twin.status.agentVersion ?? '未上报'}</dd></div>
          </dl>
        </TwinPanel>
      </TwinSlot>

      <TwinSlot slot="r2">
        <TwinPanel title="今日服务" sub="本机 · 上海自然日" source="已支付订单页数（按支付时间）、今日创建的打印与扫描任务、今日失败次数。一台机器的计数少于 5 时只显示「少于 5」。服务人次需一体机会话记录，接入前不显示。">
          <TwinTiles
            items={[
              { value: smallCount(twin.today.printPages), unit: '页', label: '打印页数' },
              { value: smallCount(twin.today.printTasks), unit: '单', label: '打印任务' },
              { value: smallCount(twin.today.scans), unit: '次', label: '扫描' },
              twin.today.visits.available
                ? { value: smallCount(twin.today.visits.value), unit: '人次', label: '服务人次' }
                : { label: '服务人次', unavailableReason: twin.today.visits.reason },
            ]}
          />
          {twin.today.failed > 0 ? <p className="twin-cap">今日打印失败 {smallCount(twin.today.failed)} 次，详情见打印扫描运维</p> : null}
        </TwinPanel>
      </TwinSlot>

      <TwinSlot slot="r3">
        <TwinMetricPanel
          title="24 小时状态"
          sub="近 24 小时 · 至现在"
          metric={twin.timeline24h}
          source={`由终端心跳与打印任务推导：心跳后 ${twin.status.onlineWindowSeconds} 秒内算在线，缺口算离线，打印机异常心跳算告警。`}
          render={(segments) => (
            <>
              <TwinTimeline segments={segments} ticks={timelineTicks(twin, formatClock)} />
              <TwinLegend
                items={[
                  { state: 'ok', label: '在线空闲' },
                  { state: 'pr', label: '打印中' },
                  { state: 'wa', label: '告警' },
                  { state: 'off', label: '离线' },
                ]}
              />
              <p className="twin-cap twin-push">纸盒、碳粉余量需 Windows Agent 上报后显示；接入前不估算。</p>
            </>
          )}
        />
      </TwinSlot>
    </>
  )
}
