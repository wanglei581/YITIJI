import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { KioskScreensaverItem, KioskScreensaverPlaylist } from '@ai-job-print/shared'
import { clearKioskSensitiveSession } from '../../auth/kioskSensitiveSession'
import { useAuth } from '../../auth/useAuth'
import { KioskStageFit } from '../../components/kiosk-shell/KioskStageFit'
import { getScreensaverPlaylist, getTerminalId } from '../../services/api/screensaver'
import { prefetchAsset, resolveAssetUrl } from '../../services/screensaverCache'
import { StandbyView } from './StandbyView'
import { deriveStandbyPhase, formatStandbyClock, nextPlayableIndex, standbyShouldExitHome } from './standbyModel'
import '../../styles/qingxu/index.css'
import './screensaver-service-desk.css'

/**
 * 待机宣传屏。进入即走集中式清场，唤醒回首页。
 * 无素材 / 未启用 / 拉取失败：退出回首页，不伪造宣传图。
 */
export function ScreensaverPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { logout, getToken } = useAuth()
  const routeState = location.state as {
    playlist?: KioskScreensaverPlaylist
    privacyBoundary?: { token: string; minHistoryIndex: number; createdAt: number }
  } | null
  const statePlaylist = routeState?.playlist
  const privacyBoundary = routeState?.privacyBoundary

  useEffect(() => {
    // 进屏保 = 这一位用完了。传当前令牌，本地扫描会话被清掉之前先撤服务端那个还活着的
    // 扫描任务；否则下一位在面板上按下扫描，文件会投给刚离开的这一位。
    clearKioskSensitiveSession(getToken())
    logout()
  }, [getToken, logout])

  const [items, setItems] = useState<KioskScreensaverItem[]>(statePlaylist?.items ?? [])
  const [enabled, setEnabled] = useState(statePlaylist ? statePlaylist.enabled : true)
  const [fetchSettled, setFetchSettled] = useState(Boolean(statePlaylist))
  const [fetchFailed, setFetchFailed] = useState(false)
  const [index, setIndex] = useState(0)
  // 地址连同它属于哪一条素材一起记：切到下一条时新地址还没解析出来，这期间照旧显示
  // 上一条，不能拿上一条的地址去显示新素材（上一条坏了的话，会把好的这条也误记成失败）。
  const [media, setMedia] = useState<{ id: string; url: string } | null>(null)
  // 加载失败的素材（链接过期、断网、文件损坏）。只有一条素材时「换下一条」还是它自己，
  // 画面会停在一个空框上；记下失败的，轮播跳过它们，全都失败就显示稿里的「暂无宣传内容」。
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(() => new Set())
  const failedRef = useRef<ReadonlySet<string>>(failedIds)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  const exit = useCallback(
    () => navigate('/', {
      replace: true,
      state: privacyBoundary ? { privacyBoundary } : undefined,
    }),
    [navigate, privacyBoundary],
  )

  const advance = useCallback(() => {
    setIndex((i) => nextPlayableIndex(items, i, failedRef.current))
  }, [items])
  const advanceRef = useRef(advance)
  advanceRef.current = advance

  const markFailed = useCallback((id: string) => {
    if (failedRef.current.has(id)) return
    const failed = new Set(failedRef.current).add(id)
    failedRef.current = failed
    setFailedIds(failed)
    setIndex((i) => nextPlayableIndex(items, i, failed))
  }, [items])
  const markFailedRef = useRef(markFailed)
  markFailedRef.current = markFailed

  useEffect(() => {
    if (items.length > 0) return
    const terminalId = getTerminalId()
    if (!terminalId) {
      setFetchFailed(true)
      setFetchSettled(true)
      setEnabled(false)
      return
    }
    let cancelled = false
    getScreensaverPlaylist(terminalId)
      .then((p) => {
        if (cancelled) return
        setEnabled(p.enabled)
        setItems(p.items)
        setFetchSettled(true)
        if (!p.enabled || p.items.length === 0) {
          exit()
        }
      })
      .catch(() => {
        if (cancelled) return
        setFetchFailed(true)
        setFetchSettled(true)
        setEnabled(false)
        exit()
      })
    return () => { cancelled = true }
    // 仅首次挂载时兜底拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onInput = (): void => { exit() }
    const events: (keyof WindowEventMap)[] = ['keydown', 'wheel']
    events.forEach((e) => window.addEventListener(e, onInput, { passive: true }))
    return () => events.forEach((e) => window.removeEventListener(e, onInput))
  }, [exit])

  const current: KioskScreensaverItem | undefined = items[index]
  useEffect(() => {
    if (!current) return
    let cancelled = false
    let objectUrl: string | null = null
    void resolveAssetUrl(current).then((url) => {
      if (cancelled) {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url)
        return
      }
      if (url.startsWith('blob:')) objectUrl = url
      setMedia({ id: current.id, url })
    })
    if (items.length > 1) {
      const next = items[(index + 1) % items.length]
      if (next) void prefetchAsset(next)
    }
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [current, index, items])

  useEffect(() => {
    if (!current || current.type !== 'image') return
    const ms = Math.max(3, current.durationSec) * 1000
    const t = window.setTimeout(() => advanceRef.current(), ms)
    return () => window.clearTimeout(t)
  }, [current, index])

  useEffect(() => {
    if (!current || current.type !== 'video') return
    if (items.length <= 1) return
    const ms = (Math.max(3, current.durationSec) + 8) * 1000
    const t = window.setTimeout(() => advanceRef.current(), ms)
    return () => window.clearTimeout(t)
  }, [current, index, items.length])

  const shown = media ? items.find((item) => item.id === media.id && !failedIds.has(item.id)) : undefined
  const allFailed = items.length > 0 && items.every((item) => failedIds.has(item.id))
  const phase = deriveStandbyPhase({
    fetchSettled,
    fetchFailed,
    enabled,
    itemCount: items.length,
    mediaReady: Boolean(shown),
  })
  if (standbyShouldExitHome(phase) && fetchSettled) {
    // 退出由上面的 effect 发起；这一帧仍画可唤醒壳，禁止纯黑空白。
  }

  const terminalName = (import.meta.env['VITE_TERMINAL_DISPLAY_NAME'] ?? '').trim() || '就业服务大厅'
  const clock = formatStandbyClock(now)

  return (
    <div
      className="fusion-w5 fusion-w5--system service-desk k1-screensaver"
      data-kiosk-screen="screensaver"
      data-kiosk-presentation="fusion-youth"
      data-kiosk-viewport="kiosk"
      data-visual-theme="service-desk"
      data-ux-density="touch"
      role="presentation"
    >
      <KioskStageFit>
        <StandbyView
          // 素材全部加载失败：显示「暂无宣传内容」（empty 态的说明），而不是一直「正在读取」。
          phase={allFailed ? 'empty' : phase === 'empty' ? 'loading' : phase}
          terminalName={terminalName}
          date={clock.date}
          time={clock.time}
          current={allFailed ? undefined : shown}
          mediaUrl={allFailed || !shown ? null : media?.url ?? null}
          loopVideo={items.length <= 1}
          onAdvance={() => advanceRef.current()}
          onMediaError={() => { if (shown) markFailedRef.current(shown.id) }}
          onWake={exit}
        />
      </KioskStageFit>
    </div>
  )
}
