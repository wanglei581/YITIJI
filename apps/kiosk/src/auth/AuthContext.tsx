import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { memberLogout } from '../services/auth/memberAuthApi'
import { onMemberSessionExpired } from '../services/auth/memberSessionEvents'
import { AuthContext, deriveDisplayName, type AuthContextValue, type AuthUser } from './context'
import { clearKioskSensitiveSession, clearKioskSharedDeviceResidue } from './kioskSensitiveSession'
import { clearGuestScanBeforeMemberLogin } from './kioskClearScope'
import { getMemberSessionExpiryExit } from './memberSessionExpiryExit'

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
  /* 401 之后「回登录页」那一步。它在收尾闸确认服务端撤掉上一场扫描之前不许跳转，
   * 否则整页跳转会把闸的重试一起干掉，留下一条已确认、仍可投递的 waiting 任务
   * ——下一位在面板上扫出来的文件会投给刚失效的这一位（memberSessionExpiryExit）。
   *
   * 取的是**页面级单例**，不是 per-Provider 实例：`main.tsx` 的
   * `<AuthProvider key={identityRevision}>` 在 terminalId 换台时会重挂整棵树，而待办的
   * 跳转登记在模块级的收尾闸上、活得比这棵树久。两个 owner 的后果是新 Provider 的
   * `login()` 取消不了旧 owner，闸一 settle 就把刚登进来的这一位踢回登录页。 */
  const sessionExpiryExit = getMemberSessionExpiryExit()

  // 纯内存方案：无需异步校验，挂载后立即标记 ready。
  useEffect(() => {
    setReady(true)
  }, [])

  const login = useCallback((next: AuthUser) => {
    const current = userRef.current
    // 只清别人的敏感会话：游客中途登录视为同一人继续办理，打印材料仍在。
    // 已登录会员换成另一个人时才清场。
    if (current && current.id !== next.id) {
      // 换人：撤销服务端扫描任务必须用**上一位**的令牌（服务端按 endUserId 校验取消权限，
      // 用新登录这位的令牌只会被 403 顶回来，旧任务原地存活）。
      clearKioskSensitiveSession(current.token)
    } else if (!current) {
      // 游客 → 会员。上面那句「视为同一人继续办理」对打印材料成立，对**扫描**不成立：
      // 上一位游客扫完没按出口就走了，下一位一碰屏幕就把隐私空闲计时重置，
      // 他一登录就会继承那份扫描件和登记里那枚 controlToken 明文。
      // 扫描流程自己从不把人送去登录（结果页未登录时那颗按钮是禁用的，任何出口都会先
      // leaveScanFlow 清干净），所以这里没有可信的延续标记，按 fail-closed 收掉扫描。
      // 范围只到扫描，其余敏感会话不动；判据与理由见 kioskClearScope。
      clearGuestScanBeforeMemberLogin()
    }
    // 这一位已经换了一张有效令牌：还在等收尾闸放行的那次「回登录页」就此作废。
    sessionExpiryExit.cancel()
    userRef.current = next
    setUser(next)
    setGuestMode(false)
    // sessionExpiryExit 取自 ref，identity 恒定：列进依赖不会让 login 每帧重建。
  }, [sessionExpiryExit])

  const logout = useCallback(() => {
    const token = userRef.current?.token ?? null
    /* 这里**不碰** sessionExpiryExit：401 一旦登记了「回登录页」，那就是一条必须走完的
     * 承诺，手工登出 / 隐私清场都不该把它撤掉 —— 撤掉的结果是这一位既登不回去、也走不掉，
     * 停在一张过期的页面上。旧代码在这一句的位置写的是
     * `sessionExpiredRedirectingRef.current = false`，那时跳转是同步发的，复位只影响
     * 「下一次 401 还能不能跳」；现在跳转是待办的，同一句会变成撤销，语义完全不同。
     * 只有 login()（这一位换了一张有效令牌）才有资格作废它。 */
    // 令牌上面刚从 userRef 取过：清空登录态之前把它交出去，
    // 服务端扫描任务才撤得掉（401 过期链路走的也是这里）。
    clearKioskSensitiveSession(token)
    // 游客本机收藏不能跟 login() 一起清，否则没机会合并到账号。
    clearKioskSharedDeviceResidue()
    // 先清本地状态，后端失败也不影响。
    userRef.current = null
    setUser(null)
    setBusyState(false)
    // 登出回到干净「未登录」态（公共终端会话重置）。
    setGuestMode(false)
    // fire-and-forget：memberLogout 内部用 keepalive 尽力送达；后端失败时本地已清即安全。
    if (token) {
      memberLogout(token).catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    const unsubscribe = onMemberSessionExpired((failedToken) => {
      if (failedToken && userRef.current?.token !== failedToken) return
      /* 本机 PII / 令牌 / 登录态由 logout() 同步清掉，不等网络；跳转则交给
       * sessionExpiryExit 按收尾闸的结论决定什么时候执行（没有待清理扫描会话时
       * 它是同步的，一帧都不多等）。判据与三面旗子见 memberSessionExpiryExit。 */
      sessionExpiryExit.expire(logout)
    })
    /* 卸载只退订事件总线，**不撤销**已经登记的跳转：那一步是整页导航，不是这棵树的
     * 局部状态。StrictMode 的「挂载→清理→再挂载」发生在同一次提交里，中间不可能插进
     * 一发 401，所以这里没有东西可丢；而真正的卸载（terminalId 换了，<AuthProvider key>
     * 重挂）之后，这一位仍然应该落在登录页上。 */
    return unsubscribe
  }, [logout, sessionExpiryExit])

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
