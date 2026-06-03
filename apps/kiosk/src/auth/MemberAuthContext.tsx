// ============================================================
// C 端求职者登录上下文（阶段 A）
//
// - 启动时若 sessionStorage 有 token，调用 /member/me 校验会话；失效则清空。
// - login / logout 维护内存中的用户态；token 只在 sessionStorage（见 memberSession）。
// - 配套 useMemberIdleLogout：5 分钟无操作自动登出（公共一体机硬要求）。
// ============================================================

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  fetchMemberMe,
  memberLogin,
  memberLogout,
  type MemberUser,
} from '../services/auth/memberAuthApi'
import { clearMemberToken, getMemberToken, setMemberToken } from '../services/auth/memberSession'

interface MemberAuthValue {
  /** 已通过会话校验的用户；未登录为 null。 */
  user: MemberUser | null
  isAuthenticated: boolean
  /** 启动期会话校验是否已完成（避免登录态闪烁）。 */
  ready: boolean
  login: (phone: string, code: string) => Promise<void>
  logout: () => Promise<void>
}

const MemberAuthContext = createContext<MemberAuthValue | null>(null)

export function MemberAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MemberUser | null>(null)
  const [ready, setReady] = useState(false)

  // 启动：有 token 才校验，避免无谓请求。
  useEffect(() => {
    let cancelled = false
    const token = getMemberToken()
    if (!token) {
      setReady(true)
      return
    }
    fetchMemberMe()
      .then((me) => {
        if (!cancelled) setUser(me)
      })
      .catch(() => {
        // 会话失效 / 网络问题：清掉本地 token，回到匿名态。
        clearMemberToken()
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (phone: string, code: string) => {
    const { token, user: me } = await memberLogin(phone, code)
    setMemberToken(token)
    setUser(me)
  }, [])

  const logout = useCallback(async () => {
    try {
      await memberLogout()
    } catch {
      // 服务端登出失败（网络等）也要清本地，绝不把会话留在公共终端。
    } finally {
      clearMemberToken()
      setUser(null)
    }
  }, [])

  return (
    <MemberAuthContext.Provider value={{ user, isAuthenticated: user !== null, ready, login, logout }}>
      {children}
    </MemberAuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMemberAuth(): MemberAuthValue {
  const ctx = useContext(MemberAuthContext)
  if (!ctx) {
    throw new Error('useMemberAuth 必须在 <MemberAuthProvider> 内使用')
  }
  return ctx
}

const IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 分钟

/**
 * 公共一体机空闲超时登出：登录态下 5 分钟无操作 → 登出并回首页，
 * 防止上一个用户走开后下一个人复用其登录态。任何指针/键盘/触摸事件重置计时。
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useMemberIdleLogout(): void {
  const { isAuthenticated, logout } = useMemberAuth()
  const navigate = useNavigate()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!isAuthenticated) return

    const fire = (): void => {
      void logout().then(() => navigate('/'))
    }
    const reset = (): void => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(fire, IDLE_TIMEOUT_MS)
    }

    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'mousemove']
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    reset()

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      events.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [isAuthenticated, logout, navigate])
}
