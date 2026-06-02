// ============================================================
// AiAdvisorCall — 腾讯 TRTC 对话式 AI 通话组件
//
// 效果：
//   - 全屏静态女士照片作为背景（数字人顾问形象「小青」）
//   - 「点击开始对话」启动门（满足浏览器自动播放策略，解锁音频）
//   - 实时语音对话：AI 说话时声波 + 字幕；用户说话时聆听态
//   - 通话控制栏（静音 / 挂断 / 文字模式）
//
// 技术：trtc-sdk-v5（WebRTC）+ 腾讯云对话式 AI（ASR + LLM + TTS）
//   - 后端 /api/v1/trtc/session 启动 AI 会话并下发 userSig
//   - 卸载/退出时调用 /api/v1/trtc/session/stop 释放资源
//
// 浏览器自动播放策略：必须有用户手势才能播放远端音频，
// 因此用启动门（一次点击）进房，避免 AUTOPLAY_FAILED。
// ============================================================

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

const ADVISOR_IMG = '/assets/ai-advisor.png'

type Phase = 'gate' | 'connecting' | 'live' | 'error'
type AiState = 'idle' | 'listening' | 'thinking' | 'speaking'

interface SessionResp {
  sdkAppId: number
  userId:   string
  userSig:  string
  roomId:   string
  taskId:   string
}

interface AiAdvisorCallProps {
  onSwitchToText: () => void
  onExit: () => void
}

// 从 AI 自定义消息中提取「AI 回复字幕」，过滤掉用户 ASR 识别文本
function extractAssistantSubtitleText(raw: string): string {
  const msg = JSON.parse(raw) as {
    text?: string
    type?: string | number
    userid?: string
    sender?: string
    role?: string
    payload?: { text?: string }
  }

  const msgType = String(msg.type ?? '').toLowerCase()
  const speaker = String(msg.role ?? msg.sender ?? msg.userid ?? '').toLowerCase()

  if (
    msgType.includes('transcription') ||
    msgType.includes('recognition') ||
    msgType.includes('asr') ||
    msgType.includes('stt') ||
    speaker === 'user' ||
    speaker.includes('user_')
  ) {
    return ''
  }

  if (msgType && msgType !== 'subtitle' && !msg.payload?.text) {
    return ''
  }

  return (msg.payload?.text ?? msg.text ?? '').trim()
}

export function AiAdvisorCall({ onSwitchToText, onExit }: AiAdvisorCallProps) {
  const [phase, setPhase]           = useState<Phase>('gate')
  const [errMsg, setErrMsg]         = useState('')
  const [aiState, setAiState]       = useState<AiState>('idle')
  const [muted, setMuted]           = useState(false)
  const [subtitle, setSubtitle]     = useState('')
  const [elapsed, setElapsed]       = useState(0)
  const [needResume, setNeedResume] = useState(false)
  const [micBlocked, setMicBlocked] = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trtcRef       = useRef<any>(null)
  const taskIdRef     = useRef<string>('')
  const destroyedRef  = useRef(false)
  const startedRef    = useRef(false) // 防重复进房
  const remoteAudioUsersRef = useRef<Set<string>>(new Set())
  const autoplayResumeRef   = useRef<(() => Promise<void>) | null>(null)

  // 通话计时
  useEffect(() => {
    if (phase !== 'live') return
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [phase])

  // 卸载清理
  useEffect(() => {
    destroyedRef.current = false
    return () => {
      destroyedRef.current = true
      void cleanup()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 恢复远端音频播放（确保未静音、音量拉满）──────────────
  const restoreRemoteAudio = useCallback(async (userId: string) => {
    const trtc = trtcRef.current
    if (!trtc) return
    try {
      await trtc.muteRemoteAudio?.(userId, false)
      trtc.setRemoteAudioVolume?.(userId, 100)
      await autoplayResumeRef.current?.()
      if (!destroyedRef.current) setNeedResume(false)
    } catch {
      if (!destroyedRef.current) setNeedResume(true)
    }
  }, [])

  // ── 启动通话（用户点击后调用，满足自动播放策略）──────────
  const startCall = useCallback(async () => {
    if (startedRef.current) return
    startedRef.current = true
    setPhase('connecting')

    try {
      // 1. 后端启动 AI 会话 + 下发进房凭证（30s 超时，防止后端挂起永久等待）
      const ac = new AbortController()
      const timeoutId = setTimeout(() => ac.abort(), 30_000)
      let res: Response
      try {
        res = await fetch('/api/v1/trtc/session', {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Terminal-Id': (import.meta.env['VITE_TERMINAL_ID'] ?? '').trim(),
          },
          body:    JSON.stringify({}),
          signal:  ac.signal,
        })
      } catch (fetchErr) {
        clearTimeout(timeoutId)
        if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
          throw new Error('连接超时（30s），请检查网络后重试')
        }
        throw fetchErr
      }
      clearTimeout(timeoutId)
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error((b as { message?: string }).message ?? `HTTP ${res.status}`)
      }
      const session = await res.json() as SessionResp
      taskIdRef.current = session.taskId
      if (destroyedRef.current) return

      // 2. 加载 TRTC SDK
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let TRTC: any
      try {
        const mod = await import('trtc-sdk-v5')
        TRTC = (mod as { default?: unknown }).default ?? mod
      } catch {
        throw new Error('trtc-sdk-v5 未安装')
      }
      if (destroyedRef.current) return

      const EVENT = TRTC.EVENT
      const trtc  = TRTC.create()
      trtcRef.current = trtc

      // 远端音频可用 → 确保播放
      trtc.on(EVENT.REMOTE_AUDIO_AVAILABLE, (e: { userId: string }) => {
        remoteAudioUsersRef.current.add(e.userId)
        void restoreRemoteAudio(e.userId)
      })
      trtc.on(EVENT.REMOTE_AUDIO_UNAVAILABLE, (e: { userId: string }) => {
        remoteAudioUsersRef.current.delete(e.userId)
      })

      // AI 回复字幕
      trtc.on(EVENT.CUSTOM_MESSAGE, (e: { userId: string; cmdId: number; data: ArrayBuffer }) => {
        try {
          const subtitleText = extractAssistantSubtitleText(new TextDecoder().decode(e.data))
          if (subtitleText) setSubtitle(subtitleText)
        } catch { /* ignore */ }
      })

      // 音量评估：驱动「说话 / 聆听」状态与声波动画
      trtc.on(EVENT.AUDIO_VOLUME, (e: { result: Array<{ userId: string; volume: number }> }) => {
        let remoteVol = 0
        let localVol  = 0
        for (const r of e.result) {
          if (r.userId === '') localVol = r.volume   // 本地用户 userId 为空串
          else remoteVol = Math.max(remoteVol, r.volume)
        }
        if (remoteVol > 5) setAiState('speaking')
        else if (localVol > 5) setAiState('listening')
        else setAiState((s) => (s === 'speaking' ? 'idle' : s))
      })

      // 自动播放被拦截 → 提示用户点击恢复
      trtc.on(EVENT.AUTOPLAY_FAILED, (e: { resume: () => Promise<void> }) => {
        autoplayResumeRef.current = e.resume
        if (!destroyedRef.current) setNeedResume(true)
      })

      trtc.on(EVENT.ERROR, (e: unknown) => {
        if (!destroyedRef.current) {
          setErrMsg(e instanceof Error ? e.message : String(e))
          setPhase('error')
        }
      })

      // 3. 进房 + 开麦
      await trtc.enterRoom({
        strRoomId:        session.roomId,
        sdkAppId:         session.sdkAppId,
        userId:           session.userId,
        userSig:          session.userSig,
        autoReceiveAudio: true,
      })
      try {
        await trtc.startLocalAudio({ option: { profile: 'standard' } })
        setMicBlocked(false)
      } catch {
        // 麦克风被拒 → 降级为只听模式
        setMuted(true)
        setMicBlocked(true)
      }
      trtc.enableAudioVolumeEvaluation?.(300)
      await restoreRemoteAudio('*')

      if (destroyedRef.current) return
      setPhase('live')
      setAiState('speaking') // AI 先播欢迎语
    } catch (err: unknown) {
      if (destroyedRef.current) return
      setErrMsg(err instanceof Error ? err.message : String(err))
      setPhase('error')
      startedRef.current = false
    }
  }, [restoreRemoteAudio])

  // ── 清理 ─────────────────────────────────────────────────
  const cleanup = useCallback(async () => {
    if (taskIdRef.current) {
      fetch('/api/v1/trtc/session/stop', {
        method:    'POST',
        headers:   {
          'Content-Type': 'application/json',
          'X-Terminal-Id': (import.meta.env['VITE_TERMINAL_ID'] ?? '').trim(),
        },
        body:      JSON.stringify({ taskId: taskIdRef.current }),
        keepalive: true,
      }).catch(() => {})
      taskIdRef.current = ''
    }
    if (trtcRef.current) {
      try {
        await trtcRef.current.stopLocalAudio?.()
        await trtcRef.current.exitRoom?.()
        trtcRef.current.destroy?.()
      } catch { /* ignore */ }
      trtcRef.current = null
    }
    remoteAudioUsersRef.current.clear()
  }, [])

  // ── 恢复播放（AUTOPLAY_FAILED 后用户点击）─────────────────
  const resumePlay = useCallback(async () => {
    try {
      await autoplayResumeRef.current?.()
      const users = [...remoteAudioUsersRef.current]
      if (users.length === 0) await restoreRemoteAudio('*')
      else await Promise.all(users.map((userId) => restoreRemoteAudio(userId)))
    } catch {
      if (!destroyedRef.current) setNeedResume(true)
    }
  }, [restoreRemoteAudio])

  // ── 静音 ─────────────────────────────────────────────────
  const toggleMute = useCallback(async () => {
    const next = !muted
    setMuted(next)
    try {
      await trtcRef.current?.updateLocalAudio?.({ mute: next })
    } catch { /* ignore */ }
  }, [muted])

  const handleExit = useCallback(() => {
    void cleanup()
    onExit()
  }, [cleanup, onExit])

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')

  return (
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-b from-slate-100 to-slate-200">
      {/* 声波动画关键帧：放在组件根部渲染一次，避免 Waveform 每次重渲染重复注入 <style> */}
      <style>{`@keyframes aiWave { 0% { transform: scaleY(0.35) } 100% { transform: scaleY(1) } }`}</style>

      {/* 背景照片 */}
      <img
        src={ADVISOR_IMG}
        alt="AI 就业服务顾问"
        className="absolute inset-0 h-full w-full object-contain object-bottom"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
      />

      {/* 顶栏 */}
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/40 to-transparent pt-5 pb-10 px-5">
        <div className="flex items-center text-white">
          <div>
            <p className="text-base font-semibold drop-shadow">就业服务顾问 · 小青</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <StatusDot phase={phase} aiState={aiState} />
              <span className="text-xs text-white/80 drop-shadow font-mono">
                {phase === 'connecting' ? '连接中…' : phase === 'error' ? '连接失败' : phase === 'live' ? `${mm}:${ss}` : '待接通'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 启动门：文字咨询（上） + 点击开始（下） */}
      {phase === 'gate' && (
        <div className="absolute inset-0 flex flex-col items-center justify-end gap-6 pb-16 bg-gradient-to-t from-black/55 via-black/10 to-transparent">
          {/* 次要：文字咨询 */}
          <button
            type="button"
            onClick={onSwitchToText}
            className="flex min-h-[48px] items-center gap-2 rounded-full bg-white/25 backdrop-blur px-6 py-2.5 text-sm font-medium text-white shadow hover:bg-white/35 active:bg-white/45 transition-colors"
          >
            <ChatIcon />
            文字咨询
          </button>

          {/* 主要：开始通话 */}
          <button
            type="button"
            onClick={() => void startCall()}
            className="flex flex-col items-center gap-3 group"
          >
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-500 shadow-xl group-active:scale-95 transition-transform">
              <PhoneIcon />
            </span>
            <span className="text-white text-base font-medium drop-shadow">点击开始与顾问对话</span>
          </button>
        </div>
      )}

      {/* 连接中 */}
      {phase === 'connecting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/40 backdrop-blur-sm">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/40 border-t-white" />
          <p className="text-sm text-white">正在接通顾问…</p>
        </div>
      )}

      {/* 错误 */}
      {phase === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/70 px-6 text-center">
          <p className="text-base font-medium text-red-300">连接失败</p>
          <p className="text-xs text-white/70 break-all max-w-sm">{errMsg}</p>
          <button
            type="button"
            onClick={onSwitchToText}
            className="mt-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-slate-800"
          >
            改用文字咨询
          </button>
        </div>
      )}

      {/* 自动播放被拦截提示 */}
      {needResume && phase === 'live' && (
        <button
          type="button"
          onClick={() => void resumePlay()}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 rounded-full bg-blue-500 px-6 py-3 text-sm font-medium text-white shadow-xl"
        >
          点击播放顾问语音
        </button>
      )}

      {/* 通话区：字幕 + 声波 + 控制栏 */}
      {phase === 'live' && (
        <div className="absolute inset-x-0 bottom-0 flex flex-col bg-gradient-to-t from-black/65 via-black/35 to-transparent px-4 pt-10 pb-4">
          {/* 声波 */}
          <div className="flex justify-center mb-2.5 h-7 items-center">
            <Waveform state={aiState} />
          </div>

          {/* 字幕 */}
          <div className="mx-auto mb-4 w-full max-w-md">
            {micBlocked && (
              <p className="mb-2 rounded-2xl bg-amber-400/20 px-4 py-2 text-center text-xs leading-relaxed text-amber-50 backdrop-blur">
                麦克风权限未开启，当前为只听模式。请在浏览器地址栏允许麦克风后刷新页面。
              </p>
            )}
            <p className="line-clamp-3 text-center text-sm leading-relaxed text-white drop-shadow rounded-2xl bg-black/30 backdrop-blur px-4 py-2.5">
              {subtitle || (aiState === 'listening' ? (muted ? '麦克风已关闭' : '请讲，我在听…') : '您好，我是就业服务顾问小青，请问有什么可以帮您？')}
            </p>
            <p className="mt-1 text-center text-[11px] text-white/60">AI 回复内容仅供参考</p>
          </div>

          {/* 控制栏：图标 + 文字标签 */}
          <div className="flex items-end justify-center gap-10">
            <ControlButton
              label={muted ? '取消静音' : '静音'}
              onClick={() => void toggleMute()}
              tone={muted ? 'danger' : 'normal'}
            >
              <MicIcon muted={muted} />
            </ControlButton>

            <ControlButton label="结束" onClick={handleExit} tone="hangup" large>
              <HangupIcon />
            </ControlButton>

            <ControlButton label="文字" onClick={onSwitchToText} tone="normal">
              <ChatIcon />
            </ControlButton>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 子组件 ───────────────────────────────────────────────

function ControlButton({
  label, onClick, tone, large, children,
}: {
  label: string
  onClick: () => void
  tone: 'normal' | 'danger' | 'hangup'
  large?: boolean
  children: ReactNode
}) {
  const size = large ? 'h-16 w-16' : 'h-14 w-14'
  const style =
    tone === 'hangup' ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg' :
    tone === 'danger' ? 'bg-red-500/30 border border-red-300/50 text-red-100 backdrop-blur' :
    'bg-white/20 border border-white/30 text-white backdrop-blur hover:bg-white/30'
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={`flex items-center justify-center rounded-full transition-colors ${size} ${style}`}
      >
        {children}
      </button>
      <span className="text-[11px] text-white/80 drop-shadow">{label}</span>
    </div>
  )
}

function StatusDot({ phase, aiState }: { phase: string; aiState: AiState }) {
  const color =
    phase === 'error' ? 'bg-red-400' :
    phase === 'connecting' ? 'bg-amber-400' :
    phase === 'gate' ? 'bg-white/60' :
    aiState === 'listening' ? 'bg-emerald-400' :
    aiState === 'speaking'  ? 'bg-blue-400' : 'bg-white/70'
  return <span className={`h-2 w-2 rounded-full ${color} ${phase === 'live' ? 'animate-pulse' : ''}`} />
}

function Waveform({ state }: { state: AiState }) {
  const active = state === 'speaking' || state === 'listening'
  const color  = state === 'speaking' ? 'bg-blue-300' : state === 'listening' ? 'bg-emerald-300' : 'bg-white/40'
  const bars   = [4, 7, 11, 16, 11, 7, 4, 7, 11, 16, 11, 7, 4]
  return (
    <div className="flex items-center gap-1">
      {bars.map((h, i) => (
        <div
          key={i}
          className={`w-1 rounded-full ${color}`}
          style={{
            height: active ? `${h * 1.8}px` : '4px',
            animation: active ? 'aiWave 0.7s ease-in-out infinite alternate' : undefined,
            animationDelay: `${i * 55}ms`,
          }}
        />
      ))}
    </div>
  )
}

function PhoneIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92Z" />
    </svg>
  )
}

function MicIcon({ muted }: { muted: boolean }) {
  return muted ? (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" x2="22" y1="2" y2="22" /><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
      <path d="M5 10v2a7 7 0 0 0 12 5" /><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12" /><line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  ) : (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  )
}

function HangupIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67" transform="rotate(135 12 12)" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}
