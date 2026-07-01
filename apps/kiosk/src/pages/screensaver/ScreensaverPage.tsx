import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { KioskScreensaverItem, KioskScreensaverPlaylist } from '@ai-job-print/shared'
import { clearKioskSensitiveSession } from '../../auth/kioskSensitiveSession'
import { useAuth } from '../../auth/useAuth'
import { getScreensaverPlaylist, getTerminalId } from '../../services/api/screensaver'
import { prefetchAsset, resolveAssetUrl } from '../../services/screensaverCache'

/**
 * 待机宣传屏(全屏路由)。
 *
 * 评审 bug 防护:
 *   #2 视频自动播放被拦截 → muted + playsInline + autoPlay,play() 失败自动跳下一个
 *   #3 唤醒卡死 → 任意输入立即退出回首页(整页覆盖,无业务按钮可穿透)
 *   #4 断网黑屏 → resolveAssetUrl 缓存优先;拉不到配置/无素材直接退出,不显示空白
 *   #5 大视频拖垮内存 → 只预加载"下一个",不全量加载
 *
 * 退出回首页(replace):为下一位用户重置会话,也避免上一位的浏览痕迹残留。
 */
export function ScreensaverPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { logout } = useAuth()
  const statePlaylist = (location.state as { playlist?: KioskScreensaverPlaylist } | null)?.playlist

  // 进入待机宣传屏即重置（Phase C-1 + C-2A）：屏保意味着用户已离开，
  // 清会员登录态 + 打印材料 / AI 简历最小会话（含匿名 accessToken），
  // 为下一位用户重置内存与 sessionStorage 残留。logout / clear 均幂等。
  useEffect(() => {
    clearKioskSensitiveSession()
    logout()
  }, [logout])

  const [items, setItems] = useState<KioskScreensaverItem[]>(statePlaylist?.items ?? [])
  const [index, setIndex] = useState(0)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)

  const exit = useCallback(() => navigate('/', { replace: true }), [navigate])

  const advance = useCallback(() => {
    setIndex((i) => (items.length > 0 ? (i + 1) % items.length : 0))
  }, [items.length])

  // advance 的最新引用,供定时器/媒体事件回调使用,避免闭包过期
  const advanceRef = useRef(advance)
  advanceRef.current = advance

  // ── 无 state 时自行拉取;无素材/未启用则直接退出 ──────────────────────────
  useEffect(() => {
    if (items.length > 0) return
    const terminalId = getTerminalId()
    if (!terminalId) {
      exit()
      return
    }
    let cancelled = false
    getScreensaverPlaylist(terminalId)
      .then((p) => {
        if (cancelled) return
        if (!p.enabled || p.items.length === 0) {
          exit()
          return
        }
        setItems(p.items)
      })
      .catch(() => exit())
    return () => {
      cancelled = true
    }
    // 仅首次挂载时兜底拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 任意输入立即退出 ──────────────────────────────────────────────────────
  useEffect(() => {
    const onInput = (): void => {
      exit()
    }
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'touchstart', 'keydown', 'mousedown', 'wheel']
    events.forEach((e) => window.addEventListener(e, onInput, { passive: true }))
    return () => events.forEach((e) => window.removeEventListener(e, onInput))
  }, [exit])

  // ── 解析当前素材 URL(缓存优先)+ 预加载下一个 ──────────────────────────
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
      setMediaUrl(url)
    })

    // 只预加载下一个(评审 bug #5),不全量加载
    if (items.length > 1) {
      const next = items[(index + 1) % items.length]
      if (next) void prefetchAsset(next)
    }

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [current, index, items])

  // ── 图片按 durationSec 切换(视频靠 onEnded / 兜底定时器)──────────────────
  useEffect(() => {
    if (!current || current.type !== 'image') return
    const ms = Math.max(3, current.durationSec) * 1000
    const t = window.setTimeout(() => advanceRef.current(), ms)
    return () => window.clearTimeout(t)
  }, [current, index])

  // ── 视频兜底定时器:onEnded 未触发(卡顿/解码异常)时强制前进 ──────────────
  useEffect(() => {
    if (!current || current.type !== 'video') return
    if (items.length <= 1) return // 单视频用 loop,不前进
    const ms = (Math.max(3, current.durationSec) + 8) * 1000
    const t = window.setTimeout(() => advanceRef.current(), ms)
    return () => window.clearTimeout(t)
  }, [current, index, items.length])

  if (!current || !mediaUrl) {
    return <div className="fixed inset-0 z-[9999] bg-black" aria-hidden="true" />
  }

  const loopVideo = items.length <= 1

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black" role="presentation">
      {current.type === 'video' ? (
        <video
          key={current.id}
          src={mediaUrl}
          className="h-full w-full object-contain"
          autoPlay
          muted
          playsInline
          loop={loopVideo}
          // 自动播放被拦截 / 解码失败 → 跳下一个(评审 bug #2)
          onEnded={() => {
            if (!loopVideo) advanceRef.current()
          }}
          onError={() => advanceRef.current()}
          onCanPlay={(e) => {
            void e.currentTarget.play().catch(() => advanceRef.current())
          }}
        />
      ) : (
        <img
          key={current.id}
          src={mediaUrl}
          className="h-full w-full object-contain"
          alt=""
          onError={() => advanceRef.current()}
        />
      )}

      {/* 触摸提示:克制、不喧宾夺主 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-10 flex justify-center">
        <span className="rounded-full bg-white/15 px-6 py-2.5 text-base text-white/90 backdrop-blur-sm">
          触摸屏幕开始使用
        </span>
      </div>
    </div>
  )
}
