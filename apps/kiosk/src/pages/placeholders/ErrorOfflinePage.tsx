// ============================================================
// 机器状态 — /error-offline（整屏路由，在 KioskRoot 之外）。
//
// 触屏稿 offline：意图带写本页状态 → 八项状态清单（名称、依赖说明、本次判定）→ 机器插画 → 求助句；底栏返回首页、帮助与求助、重新检测。
// 四个真实态照做：unknown（进页默认，没检测过就不写结论）/ checking / partial / offline。
// 稿里没有「正常」「在线」这类保证词，本页也不伪造任何读数；没探到的写「暂时读不到」，不写成好或坏。
//
// 能真检测的只有两条（其余六轴照实写未检测 / 未验收 / 随请求确认，不默认写成正常）：
//   1) 联网 = GET {API_BASE_URL}/health（5s 超时）+ navigator.onLine —— 与其它接口同一个基址，
//      VITE_API_BASE_URL 指向别的源时也探得到（写死 /api/v1 会永远探测失败、卡在本页）；
//   2) 机器后台程序 / 打印机 = 公开只读 printer-status（后端按 5 分钟心跳窗算 isOnline），
//      映射沿用 useTerminalDeviceStatus 的纯函数，default 分支不返回在线。
// 行为沿用旧页：自动重试 + 监听 online 事件；连得上时 replace 回安全的
// location.state.from（没有来源时回 /）——来源页之外，只有打印机也读到可用才离开，
// 否则停在 partial 把「连得上但几项取不到」照实摆出来。
// 自动重试退避：每多一次「检测完仍留在本页」（offline / partial），间隔翻倍 10 → 20 → 40 秒，封顶 60 秒；
// online 事件归零并立即重测；「重新检测」按钮始终立即执行。页面卸载时中断在途的探测与它的 5 秒计时器。
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { isSafeInternalPath } from '../../auth/returnPath'
import { KioskStageFit } from '../../components/kiosk-shell/KioskStageFit'
import { IllusMachine } from '../public-touch/PublicIllus'
import { ArtBox, Card } from '../public-touch/PublicBlocks'
import { QxTouchCallout } from '../../components/qingxu/touch/QxTouchCallout'
import { QxTouchDock } from '../../components/qingxu/touch/QxTouchDock'
import { PublicTouchFrame } from '../public-touch/PublicTouchFrame'
import { useVisibleHelpLine } from '../public-touch/publicTouchHooks'
import { mapTerminalPrinterStatus, normalizePrinterStatusRaw } from '../../hooks/useTerminalDeviceStatus'
import { API_BASE_URL, getTerminalId } from '../../services/api'
import './system-state-qx.css'
import './offline-touch.css'

type View = 'unknown' | 'checking' | 'partial' | 'offline'
type Tone = 'q' | 'ok' | 'warn' | 'bad'
type GlyphName =
  | 'question' | 'radar' | 'wifioff' | 'half' | 'upload' | 'spark' | 'briefcase' | 'printer' | 'usb'
  | 'info' | 'scan' | 'gauge' | 'clockoff' | 'desk'

const GLYPHS: Record<GlyphName, ReactNode> = {
  question: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.7-.9 1.3v.5" /><path d="M12 17h.01" /></>,
  radar: <><path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" /><path d="M20.5 4.4V10h-5.6" /><circle cx="12" cy="12" r="2.4" /></>,
  wifioff: <><path d="M3 4l18 18" /><path d="M5.2 9.6a13 13 0 0 1 3.6-2.2M2.2 6.3A17 17 0 0 1 6 3.9M12 19.6h.01" /><path d="M8.6 14.2a7 7 0 0 1 2.2-1.3M15 10.2a13 13 0 0 1 3.8 2.2" /></>,
  half: <><circle cx="12" cy="12" r="9" /><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18" /></>,
  upload: <><path d="M12 16.5V5.4" /><path d="M7.8 9.6L12 5.4l4.2 4.2" /><path d="M4.5 15.5v2.6a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.6" /></>,
  spark: <path d="M12 3.2l1.9 5 5.1 1.9-5.1 1.9L12 17l-1.9-5L5 10.1l5.1-1.9z" />,
  briefcase: <><rect x="3" y="7.5" width="18" height="12" rx="2.4" /><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3 12.5h18" /></>,
  printer: <><path d="M6 9V3h12v6" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v8H6z" /></>,
  usb: <><path d="M12 20.5V6.6" /><path d="M9.4 9.2L12 6.6l2.6 2.6" /><rect x="9.2" y="20.5" width="5.6" height="0.2" /><path d="M12 13.6l3.6-2.1V8.6M12 16.4l-3.4-2V11.4" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  scan: <><path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5" /><path d="M4 12h16" /></>,
  gauge: <><path d="M4 17.5a8.5 8.5 0 1 1 16 0" /><path d="M12 17.5l3.6-4.6" /></>,
  clockoff: <><circle cx="12" cy="12" r="9" /><path d="M12 6.8V12l3 1.8" /><path d="M4 4l16 16" /></>,
  desk: <><path d="M21 10c0 7-9 12.5-9 12.5S3 17 3 10a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3.1" /></>,
}

function Glyph({ name, size = 28 }: { name: GlyphName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPHS[name]}
    </svg>
  )
}

/** 八个状态轴：名字照稿；依赖说明与本次判定随状态变（见 rowsFor），判定只有「这次」的读数，没有「正常」「在线」这类保证词。 */
const CAPS: { key: string; glyph: GlyphName; tone: string; name: string }[] = [
  { key: 'network', glyph: 'upload', tone: 'slate', name: '联网' },
  { key: 'agent', glyph: 'desk', tone: 'teal', name: '本机程序' },
  { key: 'printer', glyph: 'printer', tone: 'teal', name: '打印机' },
  { key: 'scan', glyph: 'scan', tone: 'slate', name: '扫描件的存放' },
  { key: 'usb', glyph: 'usb', tone: 'wheat', name: 'U 盘读取' },
  { key: 'pay', glyph: 'gauge', tone: 'clay', name: '付款' },
  { key: 'ai', glyph: 'spark', tone: 'plum', name: 'AI 服务' },
  // 托管 a：这一项叫「机构官方渠道」，不在我们云上做招聘入口。key 不改，判定仍是「随请求确认」。
  { key: 'jobs', glyph: 'briefcase', tone: 'slate', name: '机构官方渠道' },
]

type Verdict = [label: string, tone: Tone]

/** 本次读到的打印机侧信号。unread = 请求失败 / 未绑定终端；stale = 心跳超过 5 分钟。 */
interface PrinterReading {
  heartbeatOnline: boolean
  ready: boolean
  verdict: Verdict
}

/** 读不到就写「暂时读不到」：不当成好，也不当成坏。 */
const UNREAD_LABEL = '暂时读不到'
const UNREAD: PrinterReading = { heartbeatOnline: false, ready: false, verdict: [UNREAD_LABEL, 'warn'] }

interface CheckResult {
  at: Date
  reachable: boolean
  printer: PrinterReading | null
}

/** 一次探测 = 一个 AbortController + 它的 5 秒计时器。放在 ref 里，页面卸载时连同计时器一起中断。 */
interface ProbeWindow { controller: AbortController; timer: number }
type ProbeRef = { current: ProbeWindow | null }
const PROBE_TIMEOUT_MS = 5_000

function openProbe(ref: ProbeRef): AbortSignal {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  ref.current = { controller, timer }
  return controller.signal
}

function closeProbe(ref: ProbeRef, abort: boolean): void {
  const probe = ref.current
  if (!probe) return
  window.clearTimeout(probe.timer)
  if (abort) probe.controller.abort()
  ref.current = null
}

/** 自动重测间隔：连续 streak 次检测完仍留在本页，间隔 = 10 秒 × 2^streak，封顶 60 秒。 */
const AUTO_CHECK_BASE_MS = 10_000
const AUTO_CHECK_MAX_MS = 60_000
function autoCheckDelayMs(streak: number): number {
  return Math.min(AUTO_CHECK_BASE_MS * 2 ** streak, AUTO_CHECK_MAX_MS)
}

async function readPrinterStatus(signal: AbortSignal): Promise<PrinterReading> {
  const terminalId = getTerminalId()
  if (!terminalId) return UNREAD
  try {
    const response = await fetch(`${API_BASE_URL}/terminals/${encodeURIComponent(terminalId)}/printer-status`, {
      cache: 'no-store',
      signal,
    })
    if (!response.ok) return UNREAD
    const body = (await response.json()) as { isOnline?: boolean; printerStatus?: string | null; data?: { isOnline?: boolean; printerStatus?: string | null } }
    const payload = body.data ?? body
    const heartbeatOnline = Boolean(payload.isOnline)
    // 心跳过期时后端读数不代表现在：写「没读到」，不写「离线」（稿：两者不合并）。
    if (!heartbeatOnline) return UNREAD
    const mapped = mapTerminalPrinterStatus({ heartbeatOnline, printerStatus: payload.printerStatus })
    if (mapped.printerReady) return { heartbeatOnline, ready: true, verdict: ['这次读到可用', 'ok'] }
    const raw = normalizePrinterStatusRaw(payload.printerStatus)
    const verdict: Verdict = raw === 'offline' ? ['离线', 'bad']
      : raw === 'paper_empty' ? ['缺纸', 'bad']
        : raw === 'error' ? ['异常', 'bad']
          : (raw === 'queue_cleanup_failed' || raw === 'queue_pause_failed') ? ['暂停接单', 'bad']
            : [UNREAD_LABEL, 'warn']
    return { heartbeatOnline, ready: false, verdict }
  } catch {
    return UNREAD
  }
}

type Row = { dep: string; verdict: Verdict }

/** 八行：依赖说明随状态变，本次判定只来自这一次检测。读不到的写「暂时读不到」。 */
function rowsFor(view: View, result: CheckResult | null): Row[] {
  const q = (label: string): Verdict => [label, 'q']
  const unread: Verdict = [UNREAD_LABEL, 'warn']
  const asked = '办理到那一步再确认'
  const usb: Row = { dep: '这项本来就没开', verdict: q('暂未开通') }
  if (view === 'checking') {
    return [
      { dep: '正在向服务器探', verdict: q('检测中') },
      { dep: '正在检测', verdict: q('检测中') },
      { dep: '正在检测', verdict: q('检测中') },
      { dep: '还没有检测', verdict: q('未检测') },
      usb,
      { dep: asked, verdict: q('随请求确认') },
      { dep: asked, verdict: q('随请求确认') },
      { dep: asked, verdict: q('随请求确认') },
    ]
  }
  if (view === 'offline') {
    const none = { dep: '这次没有读到', verdict: unread }
    return [
      { dep: '和服务器之间不通', verdict: ['这次连不上', 'bad'] },
      none,
      none,
      { dep: '还没有检测', verdict: q('未检测') },
      usb,
      none,
      none,
      none,
    ]
  }
  if (view === 'partial' && result?.printer) {
    const printer = result.printer
    return [
      { dep: '只说明这条路通了', verdict: ['这次连得上', 'ok'] },
      printer.heartbeatOnline
        ? { dep: '只说明程序有回应', verdict: ['这次连得上', 'ok'] }
        : { dep: '这次没有读到', verdict: unread },
      printer.verdict[0] === UNREAD_LABEL
        ? { dep: '这次没有读到', verdict: printer.verdict }
        : { dep: '读机器上报的状态', verdict: printer.verdict },
      { dep: '还没有检测', verdict: q('未检测') },
      usb,
      { dep: asked, verdict: q('随请求确认') },
      { dep: asked, verdict: q('随请求确认') },
      { dep: asked, verdict: q('随请求确认') },
    ]
  }
  return [
    { dep: '还没有向服务器探过', verdict: q('未检测') },
    { dep: '还没有检测结果', verdict: q('未检测') },
    { dep: '还没有检测结果', verdict: q('未检测') },
    { dep: '办理时才知道落在哪', verdict: q('未检测') },
    usb,
    { dep: asked, verdict: q('随请求确认') },
    { dep: asked, verdict: q('随请求确认') },
    { dep: asked, verdict: q('随请求确认') },
  ]
}

const clock = (date: Date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

export default function ErrorOfflinePage() {
  const navigate = useNavigate()
  const faultLine = useVisibleHelpLine(true)
  const helpLine = useVisibleHelpLine(false)
  const location = useLocation()
  const [attempts, setAttempts] = useState(0)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<CheckResult | null>(null)
  // 连续多少次检测完仍留在本页（offline / partial）；决定下一次自动重测的间隔。
  const [stayStreak, setStayStreak] = useState(0)
  const checkingRef = useRef(false)
  const probeRef = useRef<ProbeWindow | null>(null)
  // 检测是异步的：用户在检测途中点了「返回首页 / 帮助与求助」离开本页后，迟到的结果不得再改状态或把人拽走。
  const mountedRef = useRef(true)
  const safeFrom = useMemo(() => {
    const candidate = (location.state as { from?: unknown } | null)?.from
    return typeof candidate === 'string' && candidate !== '/error-offline' && isSafeInternalPath(candidate)
      ? candidate
      : null
  }, [location.state])
  const returnTo = safeFrom ?? '/'

  const view: View = checking ? 'checking' : !result ? 'unknown' : result.reachable ? 'partial' : 'offline'

  const retry = useCallback(async () => {
    if (checkingRef.current) return
    checkingRef.current = true
    setChecking(true)
    setAttempts((value) => value + 1)
    let reachable = false
    try {
      if (!navigator.onLine) throw new Error('offline')
      const response = await fetch(`${API_BASE_URL}/health`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: openProbe(probeRef),
      })
      reachable = response.ok
    } catch {
      reachable = false
    } finally {
      closeProbe(probeRef, false)
    }
    let printer: PrinterReading | null = null
    if (reachable && mountedRef.current) {
      try {
        printer = await readPrinterStatus(openProbe(probeRef))
      } finally {
        closeProbe(probeRef, false)
      }
    }
    checkingRef.current = false
    if (!mountedRef.current) return
    // 连得上：有来源页就回去（稿：一连上就把你送回刚才那一页）；没有来源页时，打印机也读到可用才回首页。
    if (reachable && (safeFrom !== null || printer?.ready)) {
      navigate(returnTo, { replace: true })
      return
    }
    setStayStreak((value) => value + 1)
    setResult({ at: new Date(), reachable, printer })
    setChecking(false)
  }, [navigate, returnTo, safeFrom])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      closeProbe(probeRef, true)
    }
  }, [])

  useEffect(() => {
    // 网络恢复：退避归零，立刻重测。
    const handleOnline = () => {
      setStayStreak(0)
      void retry()
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [retry])

  const autoDelayMs = autoCheckDelayMs(stayStreak)
  useEffect(() => {
    // 每次检测结束（view 从 checking 回来）都按当前退避重新排下一次；检测进行中不排。
    if (view === 'checking') return
    const timer = window.setTimeout(() => void retry(), autoDelayMs)
    return () => window.clearTimeout(timer)
  }, [autoDelayMs, retry, view])

  const rows = rowsFor(view, result)
  const lastCheck = result ? `最近一次检测：${clock(result.at)}` : ''
  const nextAuto = `约 ${autoDelayMs / 1000} 秒后自动再${view === 'offline' ? '试' : '检测'}`
  const title = view === 'unknown'
    ? '这台机器还没检测'
    : view === 'checking'
      ? '正在检测'
      : view === 'partial'
        ? '连得上，但有几项取不到'
        : '和服务器连不上'
  const sub = view === 'unknown'
    ? '还没向服务器和打印机问过。'
    : view === 'checking'
      ? '先问联网、本机程序和打印机；其余没有单独的检测口。'
      : view === 'partial'
        ? '取不到的标成暂时读不到。'
        : '这次连不上。其余没问到的项标成暂时读不到。'
  const pill = {
    unknown: { tone: 'unknown', label: '还没检测' },
    checking: { tone: 'unknown', label: '正在检测' },
    partial: { tone: 'warn', label: '部分取不到' },
    offline: { tone: 'bad', label: '连不上服务器' },
  } as const
  const remind = view === 'offline' ? faultLine : helpLine

  return (
    <div
      className="fusion-w5 fusion-w5--system k9-system-state"
      data-kiosk-screen="error-offline"
      data-kiosk-presentation="fusion-youth"
      data-kiosk-viewport="kiosk"
      data-state={view}
    >
      <KioskStageFit>
        <PublicTouchFrame
          page="offline"
          title={title}
          eyebrow="机器状态"
          sub={sub}
          status={pill[view]}
          back={{ label: '返回首页', onBack: () => navigate('/') }}
          nav={false}
          dock={(
            <QxTouchDock
              onBack={() => navigate('/')}
              backLabel="返回首页"
              mid={<button type="button" className="qxt-btn qxt-btn-sec qxt-fill" onClick={() => navigate('/help', { replace: true })}>帮助与求助</button>}
              primary={{
                label: checking ? '正在检测' : '重新检测',
                kind: 'pri',
                noArrow: true,
                disabled: checking,
                onClick: () => void retry(),
              }}
            />
          )}
        >
          <div className="of-page" data-testid={`system-state-state-${view}`}>
            {/* 自动再测的间隔与已重试次数只留给读屏和门禁核对，屏上不写秒数，页面也不自己跳走。 */}
            <p className="qxp-sr" data-testid="system-state-auto">
              {view === 'offline' ? `已重试 ${attempts} 次，${nextAuto}` : nextAuto}
              <span className="hint">{view === 'checking' ? '等这次结果' : lastCheck || '等下一次检测'}</span>
            </p>
            <ul className="of-list" data-testid="system-state-list" aria-label="这台机器的八项状态">
              {CAPS.map((cap, index) => (
                <li key={cap.key} className="qxp-hit of-row" data-cap={cap.key}>
                  <span className="qxp-ic" data-tone={cap.tone} aria-hidden="true"><Glyph name={cap.glyph} size={30} /></span>
                  <span className="qxp-tx"><b>{cap.name}</b><small>{rows[index].dep}</small></span>
                  <span className="of-verdict" data-tone={rows[index].verdict[1]}>{rows[index].verdict[0]}</span>
                </li>
              ))}
            </ul>
            <Card className="of-machine" testId={view === 'offline' ? 'system-state-fallback' : undefined}>
              {lastCheck ? <p className="qxp-note of-last">{lastCheck}</p> : null}
              <ArtBox><IllusMachine /></ArtBox>
            </Card>
            {remind ? <QxTouchCallout kind="remind">{remind}</QxTouchCallout> : null}
          </div>
        </PublicTouchFrame>
      </KioskStageFit>
    </div>
  )
}
