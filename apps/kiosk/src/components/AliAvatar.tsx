// 阿里云万象数字人组件
// 依赖：lm-avatar-chat-sdk（需先安装：pnpm --filter kiosk add lm-avatar-chat-sdk）
//
// 启用条件：VITE_USE_ALI_AVATAR=true（默认 false）
// 未启用时组件返回 null，不发起任何后端请求。

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

// 是否启用阿里云数字人（后端接口 /api/v1/avatar/* 尚未实现，默认关闭）
const USE_ALI_AVATAR = import.meta.env['VITE_USE_ALI_AVATAR'] === 'true'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AvatarInstance = any

export interface AliAvatarHandle {
  speak: (text: string) => Promise<void>
  interrupt: () => void
}

type ReadyState = 'idle' | 'loading' | 'ready' | 'error'

interface AliAvatarProps {
  onStateChange?: (talking: boolean) => void
  className?: string
}

export const AliAvatar = forwardRef<AliAvatarHandle, AliAvatarProps>(
  function AliAvatar({ onStateChange, className = '' }, ref) {
    const videoRef   = useRef<HTMLVideoElement>(null)
    const avatarRef  = useRef<AvatarInstance>(null)
    // stateRef 与 state 同步，供 useImperativeHandle 读取最新值（H-1：避免闭包过期）
    const stateRef   = useRef<ReadyState>('idle')
    const [state, setStateRaw] = useState<ReadyState>('idle')
    const [errMsg, setErrMsg]  = useState('')

    const setState = useCallback((s: ReadyState) => {
      stateRef.current = s
      setStateRaw(s)
    }, [])

    // ── 初始化 —— 仅在 feature flag 开启时发起后端请求 ─────────────
    useEffect(() => {
      if (!USE_ALI_AVATAR) return  // flag 未开启：不发任何网络请求

      let destroyed = false
      setState('loading')

      async function init() {
        try {
          const res = await fetch('/api/v1/avatar/session', { method: 'POST' })
          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`)
          }
          const { rtcParams } = await res.json() as { rtcParams: Record<string, unknown>; sessionId: string }

          if (destroyed) return

          let createAvatar: (opts: unknown) => Promise<AvatarInstance>
          try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore – vite-ignore: 未安装时运行时给出友好错误
            const mod = await import(/* @vite-ignore */ 'lm-avatar-chat-sdk')
            createAvatar = (mod as { createAvatar: typeof createAvatar }).createAvatar
          } catch {
            throw new Error('lm-avatar-chat-sdk 未安装，请运行：pnpm --filter kiosk add lm-avatar-chat-sdk')
          }

          if (destroyed) return

          const avatar = await createAvatar({ container: videoRef.current!, ...rtcParams })
          avatarRef.current = avatar

          avatar.on?.('avatarReady', () => { if (!destroyed) setState('ready') })
          avatar.on?.('avatarTalking', (talking: boolean) => { onStateChange?.(talking) })
          avatar.on?.('error', (err: unknown) => {
            if (!destroyed) { setErrMsg(String(err)); setState('error') }
          })

          await avatar.start?.()
          if (!destroyed) setState('ready')
        } catch (err: unknown) {
          if (!destroyed) {
            setErrMsg(err instanceof Error ? err.message : String(err))
            setState('error')
          }
        }
      }

      void init()

      return () => {
        destroyed = true
        avatarRef.current?.exit?.().catch(() => {})
        avatarRef.current = null
        fetch('/api/v1/avatar/sessions', { method: 'DELETE' }).catch(() => {})
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // ── 对外暴露命令（stateRef.current 消除闭包过期）──────────────
    useImperativeHandle(ref, () => ({
      async speak(text: string) {
        if (avatarRef.current && stateRef.current === 'ready') {
          await avatarRef.current.requestToRespond?.(text)
        }
      },
      interrupt() { avatarRef.current?.interrupt?.() },
    }))

    // 所有 hook 已调用完毕，flag 关闭时安全 return null
    if (!USE_ALI_AVATAR) return null

    return (
      <div className={`relative overflow-hidden rounded-2xl bg-black ${className}`}>
        <video ref={videoRef} muted playsInline autoPlay className="h-full w-full object-cover" aria-label="AI 数字人" />

        {state === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-900/80">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-400 border-t-transparent" />
            <p className="text-sm text-gray-300">数字人启动中…</p>
          </div>
        )}
        {state === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gray-900/90 px-4 text-center">
            <p className="text-sm font-medium text-red-400">数字人暂不可用</p>
            <p className="text-xs text-gray-400 break-all">{errMsg}</p>
          </div>
        )}
        {state === 'ready' && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full bg-black/50 px-2 py-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
            <span className="text-xs text-white">在线</span>
          </div>
        )}
      </div>
    )
  },
)
