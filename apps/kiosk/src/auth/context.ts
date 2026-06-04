import { createContext } from 'react'

/**
 * Kiosk C 端会话层——Context 对象、类型与脱敏辅助。
 *
 * 合规约束（CLAUDE.md §11 §17）：
 * - 公共一体机：token 只存内存（React state），禁止写 localStorage /
 *   sessionStorage / IndexedDB / cookie。
 * - 刷新或关 tab 即回游客态——这是公共终端的正确行为。
 * - displayName 永远使用 phoneMasked（来自后端已脱敏），不展示原始手机号。
 */

// ── 登录方式 ──────────────────────────────────────────────────

export type LoginMethod = 'phone'

// ── 登录用户快照 ───────────────────────────────────────────────

/**
 * 内存中的登录态快照。
 * token 来自后端 /member/auth/login 响应，只存 React state，
 * 不写任何浏览器存储。
 */
export interface AuthUser {
  id: string
  /** 后端已脱敏手机号，例如 138****8888。UI 一律展示此字段。 */
  phoneMasked: string
  nickname: string | null
  /** JWT，仅内存。通过 getToken() 取用，不直接暴露到组件层。 */
  token: string
  method: LoginMethod
}

// ── Context 值 ────────────────────────────────────────────────

export interface AuthContextValue {
  user: AuthUser | null
  isLoggedIn: boolean
  /**
   * 启动校验是否完成。
   * 纯内存方案下无需异步校验（刷新即游客），挂载后立即 true。
   * 保留此字段，供未来需要启动时校验 token 有效性的场景扩展。
   */
  ready: boolean
  /** 展示名：登录态为 phoneMasked；游客态为空串。 */
  displayName: string
  /**
   * 业务繁忙态（打印中 / 扫描中 / AI 生成中）。
   * IdleLogoutGuard 接入后，busy=true 时暂停自动登出计时。
   */
  busy: boolean
  setBusy: (busy: boolean) => void
  /** 登录成功后由调用方（LoginPage）注入完整 AuthUser（含 token）。 */
  login: (user: AuthUser) => void
  /**
   * 登出：内存状态立即清空，同时向后端发 logout 请求（fire-and-forget）。
   * 后端失败也保证本地状态清空。
   */
  logout: () => void
  /** 取当前 token，供 API 层显式传参。游客态返回 null。 */
  getToken: () => string | null
}

// ── Context 对象 ──────────────────────────────────────────────

export const AuthContext = createContext<AuthContextValue | null>(null)

// ── 脱敏辅助 ─────────────────────────────────────────────────

/** 从 AuthUser 派生展示名（后端已脱敏，直接取 phoneMasked）。 */
export function deriveDisplayName(user: AuthUser): string {
  return user.phoneMasked || '已登录用户'
}
