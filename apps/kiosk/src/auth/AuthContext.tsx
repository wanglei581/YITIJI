import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { memberLogout } from '../services/auth/memberAuthApi'
import { AuthContext, deriveDisplayName, type AuthContextValue, type AuthUser } from './context'

/**
 * Kiosk C 端会话 Provider（纯内存）。
 *
 * 安全约束（CLAUDE.md §11 §17）：
 * - token / user 只存 React state，不写任何浏览器存储。
 * - 刷新页面即回游客态——公共一体机的正确行为。
 * - logout：本地状态立即清空，后端 logout 请求 fire-and-forget；
 *   后端失败时本地状态已清，不阻塞用户继续使用。
 *
 * Context 类型 / AuthUser / useAuth 见同级文件，
 * 此文件只导出 <AuthProvider> 组件（满足 react-refresh/only-export-components）。
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusyState] = useState(false)
  // 匿名「先使用」标记（仅内存，登出复位），用于首页状态栏区分未登录/匿名。
  const [guestMode, setGuestMode] = useState(false)

  // 用 ref 在 logout 中读取最新 token，避免 useCallback 依赖 user 导致的闭包问题。
  const userRef = useRef<AuthUser | null>(null)

  // 纯内存方案：无需异步校验，挂载后立即标记 ready。
  useEffect(() => {
    setReady(true)
  }, [])

  const login = useCallback((next: AuthUser) => {
    userRef.current = next
    setUser(next)
    setGuestMode(false)
  }, [])

  const logout = useCallback(() => {
    const token = userRef.current?.token ?? null
    // 先清本地状态，后端失败也不影响。
    userRef.current = null
    setUser(null)
    setBusyState(false)
    // 登出回到干净「未登录」态（公共终端会话重置）。
    setGuestMode(false)
    // fire-and-forget：后端失败静默，公共终端本地已清即安全。
    if (token) {
      memberLogout(token).catch(() => undefined)
    }
  }, [])

  const setBusy = useCallback((next: boolean) => setBusyState(next), [])

  const continueAsGuest = useCallback(() => setGuestMode(true), [])

  const getToken = useCallback(() => userRef.current?.token ?? null, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoggedIn: user !== null,
      ready,
      displayName: user ? deriveDisplayName(user) : '',
      busy,
      setBusy,
      guestMode,
      continueAsGuest,
      login,
      logout,
      getToken,
    }),
    [user, ready, busy, setBusy, guestMode, continueAsGuest, login, logout, getToken],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
