// ============================================================
// useAiAdvisorCallSession — 腾讯 TRTC 对话式 AI 通话会话（headless hook）
//
// 2026-07-03 由 components/AiAdvisorCall.tsx 拆分而来：本文件承载全部
// TRTC 会话逻辑（逐行搬移，零逻辑改动）；展示层改为助手页内嵌通话面板
// （pages/assistant/AssistantCallPanel.tsx），不再有独立全屏通话页。
//
// 技术：trtc-sdk-v5（WebRTC）+ 腾讯云对话式 AI（ASR + LLM + TTS）
//   - 后端 /api/v1/trtc/session 启动 AI 会话并下发 userSig
//   - 卸载/退出时调用 /api/v1/trtc/session/stop 释放资源
//
// 浏览器自动播放策略：进房必须由用户手势触发。现在「语音通话」卡的点击
// 即手势（面板挂载后立即 startCall）；若音频仍被拦截，AUTOPLAY_FAILED
// 会置 needResume，由面板给出「点击播放顾问语音」恢复钮。
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useBusyLock } from '../contexts/KioskBusyContext'
import { API_BASE_URL } from '../services/api/client'

const TERMINAL_ID = (import.meta.env['VITE_TERMINAL_ID'] ?? '').trim()

// 通知后端结束腾讯云 AI 会话（StopAIConversation），立即停止按分钟计费。
//  - keepalive：保证在组件卸载 / 切走页面 / 关闭标签页时请求仍能发出
//  - X-Terminal-Id：满足后端鉴权（缺失会 401，导致会话停不掉持续计费）
// 纯函数、模块级：可在 cleanup、startCall 中途离开、pagehide 三处复用。
function stopBackendTask(taskId: string): void {
  if (!taskId) return
  fetch(`${API_BASE_URL}/trtc/session/stop`, {
    method:    'POST',
    headers:   { 'Content-Type': 'application/json', 'X-Terminal-Id': TERMINAL_ID },
    body:      JSON.stringify({ taskId }),
    keepalive: true,
  }).catch(() => {})
}

export type CallPhase = 'gate' | 'connecting' | 'live' | 'error'
export type AiState = 'idle' | 'listening' | 'thinking' | 'speaking'

interface SessionResp {
  sdkAppId: number
  userId:   string
  userSig:  string
  roomId:   string
  taskId:   string
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

export function useAiAdvisorCallSession() {
  const [phase, setPhase]           = useState<CallPhase>('gate')
  // 通话接通/进行中:禁止进入待机宣传屏(评审 bug #1)
  useBusyLock(phase === 'connecting' || phase === 'live')
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
  const sessionEpochRef = useRef(0)
  const remoteAudioUsersRef = useRef<Set<string>>(new Set())
  const autoplayResumeRef   = useRef<(() => Promise<void>) | null>(null)

  // 通话计时
  useEffect(() => {
    if (phase !== 'live') return
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [phase])

  // 卸载清理 + 关闭标签页/浏览器兜底
  useEffect(() => {
    destroyedRef.current = false
    // pagehide：标签页关闭 / 浏览器退出 / 整页跳转时触发（React 卸载 effect 此时不保证执行）。
    // 用 keepalive fetch 补发 stop，避免关页后机器人留在房间继续计费。
    // 注意只挂 pagehide，不挂 visibilitychange——切后台 tab 不应结束通话。
    const onPageHide = () => {
      stopBackendTask(taskIdRef.current)
      taskIdRef.current = ''
    }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
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

  // ── 清理 ─────────────────────────────────────────────────
  const cleanup = useCallback(async () => {
    if (taskIdRef.current) {
      stopBackendTask(taskIdRef.current)
      taskIdRef.current = ''
    }
    // 同步取出并立即置空：handleExit 直接调 cleanup 后又切走触发卸载再调一次，
    // 两个并发 cleanup 若都读到非空 trtc，会把 exitRoom/destroy 各跑两遍（SDK 报
    // “Cannot read properties of null (reading 'sdkAppId')”善后噪音）。先置空让第二次跳过。
    const trtc = trtcRef.current
    trtcRef.current = null
    if (trtc) {
      try {
        await trtc.stopLocalAudio?.()
        await trtc.exitRoom?.()
        trtc.destroy?.()
      } catch { /* ignore */ }
    }
    remoteAudioUsersRef.current.clear()
  }, [])

  // SDK 加载、进房与运行期错误都必须先释放后端任务和房间，再展示可重试错误。
  // startedRef 同步归零可防 EVENT.ERROR 与外层 catch 对同一故障重复清理。
  const failCall = useCallback(async (message: string) => {
    if (!startedRef.current) return
    startedRef.current = false
    sessionEpochRef.current += 1
    await cleanup()
    if (destroyedRef.current) return
    setErrMsg(message)
    setPhase('error')
  }, [cleanup])

  // ── 启动通话（用户点击后调用，满足自动播放策略）──────────
  const startCall = useCallback(async () => {
    if (startedRef.current) return
    startedRef.current = true
    const sessionEpoch = sessionEpochRef.current + 1
    sessionEpochRef.current = sessionEpoch
    setPhase('connecting')

    try {
      const isCurrentSession = () =>
        !destroyedRef.current && startedRef.current && sessionEpochRef.current === sessionEpoch

      // 1. 后端启动 AI 会话 + 下发进房凭证（30s 超时，防止后端挂起永久等待）
      const ac = new AbortController()
      const timeoutId = setTimeout(() => ac.abort(), 30_000)
      let res: Response
      try {
        res = await fetch(`${API_BASE_URL}/trtc/session`, {
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
      const activeTaskId = session.taskId
      // 用户在「连接中」就离开了：cleanup 已先于 fetch 返回跑过（当时 taskId 还为空，
      // 没发 stop），但后端机器人此刻已进房计费 —— 必须立即补发 stop，防止漏到 60s 超时。
      if (!isCurrentSession()) {
        stopBackendTask(activeTaskId)
        return
      }
      taskIdRef.current = activeTaskId

      // 2. 加载 TRTC SDK
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let TRTC: any
      try {
        const mod = await import('trtc-sdk-v5')
        TRTC = (mod as { default?: unknown }).default ?? mod
      } catch {
        throw new Error('trtc-sdk-v5 未安装')
      }
      if (!isCurrentSession()) {
        stopBackendTask(activeTaskId)
        if (taskIdRef.current === activeTaskId) taskIdRef.current = ''
        return
      }

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
        else setAiState('idle')
      })

      // 自动播放被拦截 → 提示用户点击恢复
      trtc.on(EVENT.AUTOPLAY_FAILED, (e: { resume: () => Promise<void> }) => {
        autoplayResumeRef.current = e.resume
        if (!destroyedRef.current) setNeedResume(true)
      })

      trtc.on(EVENT.ERROR, (e: unknown) => {
        if (destroyedRef.current) return
        void failCall(e instanceof Error ? e.message : String(e))
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

      if (!isCurrentSession()) {
        stopBackendTask(activeTaskId)
        if (taskIdRef.current === activeTaskId) taskIdRef.current = ''
        try {
          await trtc.stopLocalAudio?.()
          await trtc.exitRoom?.()
          trtc.destroy?.()
        } catch { /* ignore */ }
        return
      }
      setPhase('live')
      setAiState('speaking') // AI 先播欢迎语
    } catch (err: unknown) {
      if (destroyedRef.current || !startedRef.current || sessionEpochRef.current !== sessionEpoch) return
      await failCall(err instanceof Error ? err.message : String(err))
    }
  }, [failCall, restoreRemoteAudio])

  // 用户主动挂断、切换咨询方式或重试时，先释放真实会话，再回到未接通状态。
  // cleanup 本身幂等；这里同步重置 startedRef，允许下一次明确点击重新发起通话。
  const endCall = useCallback(async () => {
    startedRef.current = false
    sessionEpochRef.current += 1
    await cleanup()
    autoplayResumeRef.current = null
    setPhase('gate')
    setErrMsg('')
    setAiState('idle')
    setMuted(false)
    setSubtitle('')
    setElapsed(0)
    setNeedResume(false)
    setMicBlocked(false)
  }, [cleanup])

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

  return {
    phase,
    errMsg,
    aiState,
    muted,
    subtitle,
    elapsed,
    needResume,
    micBlocked,
    startCall,
    resumePlay,
    toggleMute,
    endCall,
    cleanup,
  }
}
