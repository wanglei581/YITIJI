// ============================================================
// 机器状态 — /error-offline（整屏路由，在 KioskRoot 之外）。
//
// 2026-09-25 迁入青序稿 09-system-state：状态 Hero → 这台机器的八项状态 → 屏幕不会替你猜的三件事。
// 稿里四个真实态照做：unknown（进页默认，没检测过就不写结论）/ checking / partial / offline。
// 稿里的 ready-example 是「写死示例值」的排版稿，运行时不渲染 —— 本页不伪造任何读数。
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
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { mapTerminalPrinterStatus, normalizePrinterStatusRaw } from '../../hooks/useTerminalDeviceStatus'
import { API_BASE_URL, getTerminalId } from '../../services/api'
import './system-state-qx.css'

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

/** 八个状态轴：名字与依赖说明照稿；判定只有「这次」的读数，没有「正常」「在线」这类保证词。 */
const CAPS: { key: string; glyph: GlyphName; tone: string; name: string; dep: string }[] = [
  { key: 'network', glyph: 'upload', tone: 'slate', name: '联网', dep: '这台机器现在能不能连上服务器' },
  { key: 'agent', glyph: 'desk', tone: 'teal', name: '机器后台程序', dep: '没有单独的检测口，只能从机器上报的信号间接看' },
  { key: 'printer', glyph: 'printer', tone: 'teal', name: '打印机', dep: '读机器上报的状态；「没读到」和「离线」不合并' },
  { key: 'scan', glyph: 'scan', tone: 'slate', name: '扫描件的存放', dep: '扫出来的文件先存在这台机器上再送走；没有单独的检测口' },
  { key: 'usb', glyph: 'usb', tone: 'wheat', name: 'U 盘读取', dep: '插盘后由这台机器读取；整条流程还没在正式机器上验收' },
  { key: 'pay', glyph: 'gauge', tone: 'clay', name: '付款', dep: '没有单独的检测口，到收银台真付一次才知道' },
  { key: 'ai', glyph: 'spark', tone: 'plum', name: 'AI 服务', dep: '没有单独的检测口，用到哪个 AI 功能时当场确认' },
  { key: 'jobs', glyph: 'briefcase', tone: 'slate', name: '岗位与招聘会信息', dep: '打开列表时分别确认；能连上不等于现在有内容' },
]

type Verdict = [label: string, tone: Tone]

/** 本次读到的打印机侧信号。unread = 请求失败 / 未绑定终端；stale = 心跳超过 5 分钟。 */
interface PrinterReading {
  heartbeatOnline: boolean
  ready: boolean
  verdict: Verdict
}

const UNREAD: PrinterReading = { heartbeatOnline: false, ready: false, verdict: ['没读到', 'warn'] }

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
          : ['没读到', 'warn']
    return { heartbeatOnline, ready: false, verdict }
  } catch {
    return UNREAD
  }
}

function verdictsFor(view: View, result: CheckResult | null): Verdict[] {
  const q = (label: string): Verdict => [label, 'q']
  if (view === 'checking') {
    return [q('检测中'), q('检测中'), q('检测中'), q('未检测'), q('未验收'), q('随请求确认'), q('随请求确认'), q('随请求确认')]
  }
  if (view === 'offline') {
    const unread: Verdict = ['没读到', 'warn']
    return [['这次连不上', 'bad'], unread, unread, q('未检测'), q('未验收'), unread, unread, unread]
  }
  if (view === 'partial' && result?.printer) {
    const agent: Verdict = result.printer.heartbeatOnline ? ['这次连得上', 'ok'] : ['没读到', 'warn']
    return [['这次连得上', 'ok'], agent, result.printer.verdict, q('未检测'), q('未验收'), q('随请求确认'), q('随请求确认'), q('随请求确认')]
  }
  return [q('未检测'), q('未检测'), q('未检测'), q('未检测'), q('未验收'), q('随请求确认'), q('随请求确认'), q('随请求确认')]
}

const clock = (date: Date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

export default function ErrorOfflinePage() {
  const navigate = useNavigate()
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

  const verdicts = verdictsFor(view, result)
  const printerRead = result?.printer && result.printer.verdict[0] !== '没读到' ? result.printer.verdict[0] : null
  const lastCheck = result ? `最近一次检测：${clock(result.at)}` : ''
  const hero: Record<View, { glyph: GlyphName; label: string; title: ReactNode; copy: ReactNode; note: ReactNode }> = {
    unknown: {
      glyph: 'question', label: '本机状态未检测',
      title: <>这台机器<em>还没检测</em></>,
      copy: <>本页<b>不会默认写成正常</b>：没检测过就是没检测过，检测不到就是取不到 —— 不拿一排绿点让你以为一切都好，结果白跑一趟。</>,
      note: <>进入本页后<b>还没检测过</b>，点下面的重新检测</>,
    },
    checking: {
      glyph: 'radar', label: '正在检测本机状态',
      title: <>正在<em>检测</em></>,
      copy: <>先检测<b>联网、机器后台程序和打印机</b>这三项；扫描件存放、U 盘、付款、AI、岗位信息没有单独的检测口，照实写成未检测或随请求确认。</>,
      note: <>检测<b>不会打断</b>你已经创建的打印任务</>,
    },
    partial: {
      glyph: 'half', label: '部分状态取不到',
      title: <>连得上，但<em>有几项取不到</em></>,
      copy: printerRead
        ? <>这次检测里，这台机器<b>连得上服务器</b>；打印机报的是<b>「{printerRead}」</b>，以打印机面板上的提示为准。</>
        : <>这次检测里，这台机器<b>连得上服务器</b>；打印机那边的状态<b>没读到</b>。没读到不等于坏了，也不等于好着 —— 所以这里写「没读到」。</>,
      note: <>能不能出纸，<b>要到打印那一步才知道</b>；先别在这里下结论</>,
    },
    offline: {
      glyph: 'wifioff', label: '本机连不上服务器',
      title: <>和服务器<em>连不上</em></>,
      copy: safeFrom
        ? <>传文件、算价、AI 和岗位信息都要走服务器，所以这几项现在用不了。<b>机器会自己一直重试</b>，一连上就把你送回刚才那一页。</>
        : <>传文件、算价、AI 和岗位信息都要走服务器，所以这几项现在用不了。<b>机器会自己一直重试</b>，连上服务器、打印机也读得到时就带你回首页。</>,
      note: <>已经交出去的打印任务<b>不会因此取消</b>，到机码照常有效</>,
    },
  }
  const current = hero[view]
  const nextAuto = `约 ${autoDelayMs / 1000} 秒后自动再${view === 'offline' ? '试' : '检测'}`
  const hint = view === 'unknown' ? '检测之后才有判定'
    : view === 'checking' ? '等这次结果'
      : view === 'offline' ? `${lastCheck} · 已重试 ${attempts} 次，${nextAuto}`
        : `${lastCheck} · ${nextAuto}`
  const pill = {
    unknown: { tone: 'unknown', label: '还没检测' },
    checking: { tone: 'unknown', label: '正在检测' },
    partial: { tone: 'warn', label: '部分取不到' },
    offline: { tone: 'bad', label: '连不上服务器' },
  } as const

  return (
    <main
      className="fusion-w5 fusion-w5--system k9-system-state"
      data-kiosk-screen="error-offline"
      data-kiosk-presentation="fusion-youth"
      data-kiosk-viewport="kiosk"
      data-state={view}
    >
      <KioskStageFit>
        <QxPageFrame
          title="机器状态"
          status={pill[view]}
          back={{ label: '返回首页', onBack: () => navigate('/') }}
          ctabar={(
            <>
              <div className="k9s-cta">
                <button type="button" className="k9s-btn" onClick={() => navigate('/')}>返回首页</button>
                <button type="button" className="k9s-btn" onClick={() => navigate('/help', { replace: true })}>帮助与求助</button>
                <button type="button" className="k9s-btn is-primary" data-testid="system-state-primary" disabled={checking}
                        onClick={() => void retry()}>
                  <Glyph name="radar" size={26} />{checking ? '正在检测' : '重新检测'}
                </button>
              </div>
              <div className="k9s-truth" data-disclaimer="true" data-testid="system-state-truth">
                <p><b>怎么判断</b>八项状态一项不少地列出来；只有能真检测的才给结果，其余照实写未检测或随请求确认，<b>不会默认写成正常</b>。</p>
                <p><b>读数不留旧值</b>这一页只显示本次检测的结果，不会把上一次的结果接着摆在这里当成现在的情况；拿不准就找工作人员。</p>
              </div>
            </>
          )}
        >
          <div className="k9s-scroll" data-testid={`system-state-state-${view}`}>
            <section className="k9s-sec">
              <div className="k9s-hero" data-testid={view === 'offline' ? 'system-state-fallback' : undefined}>
                <div className={`k9s-glyph${view === 'checking' ? ' is-breathing' : ''}`} role="img" aria-label={current.label}>
                  <Glyph name={current.glyph} size={104} />
                </div>
                <div className="k9s-hero-main">
                  <div className="k9s-eyebrow" aria-hidden="true">机器状态</div>
                  <h2 className="k9s-title">{current.title}</h2>
                  <p className="k9s-copy">{current.copy}</p>
                  <p className="k9s-note" role="status"><Glyph name="info" size={22} />{current.note}</p>
                </div>
              </div>
            </section>
            <section className="k9s-sec">
              <div className="k9s-label">
                <span className="no" aria-hidden="true">01</span>
                <h2 className="t">这台机器的八项状态</h2>
                <span className="hint">{hint}</span>
              </div>
              <ul className="k9s-caps" data-testid="system-state-list">
                {CAPS.map((cap, index) => (
                  <li key={cap.key} className="k9s-cap">
                    <span className="k9s-ic" data-tone={cap.tone}><Glyph name={cap.glyph} size={28} /></span>
                    <span className="k9s-cap-main">
                      <span className="k9s-cap-name">{cap.name}</span>
                      <span className="k9s-cap-dep">{cap.dep}</span>
                    </span>
                    <span className="k9s-verdict" data-tone={verdicts[index][1]}>{verdicts[index][0]}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="k9s-sec">
              <div className="k9s-label">
                <span className="no" aria-hidden="true">02</span>
                <h2 className="t">这三件事，屏幕不会替你猜</h2>
                <span className="hint">说不了就不说</span>
              </div>
              <div className="k9s-grid3">
                <div className="k9s-card">
                  <h3><span className="k9s-ic" data-tone="slate"><Glyph name="scan" size={26} /></span>有些部件报不了状态</h3>
                  <p>扫码器当键盘用，<b>插着不等于能用</b>，真读到码才知道；摄像头软件还没接通。所以不给它们发状态徽章。</p>
                </div>
                <div className="k9s-card">
                  <h3><span className="k9s-ic" data-tone="wheat"><Glyph name="gauge" size={26} /></span>耗材数值拿不到</h3>
                  <p>终端不上报墨粉和纸量，这里<b>永远不出现墨粉百分比</b>。缺纸缺粉以打印机面板上的提示为准。</p>
                </div>
                <div className="k9s-card">
                  <h3><span className="k9s-ic" data-tone="cinnabar"><Glyph name="clockoff" size={26} /></span>不预告什么时候好</h3>
                  <p>屏幕上<b>不写「预计几点恢复」</b>。什么时候好由现场和服务端决定，写个时间只会让你白等。</p>
                </div>
              </div>
            </section>
          </div>
        </QxPageFrame>
      </KioskStageFit>
    </main>
  )
}
