// ============================================================
// 匿名 AI 简历结果最小会话态（Phase C-2A）
//
// 公共一体机安全约束（CLAUDE.md §11/§17/§18）：
// - 只保存「读回本人匿名结果」所需的最小凭证：taskId + accessToken（一次性令牌）。
// - 绝不保存简历原文 / 诊断报告 / 优化建议 / PII / 任何 AI payload——这些只在
//   导航 location.state（内存）流转，刷新后凭 taskId + accessToken 从后端重新拉取。
// - 仅用 sessionStorage（随标签页关闭即清），不写 localStorage / IndexedDB / cookie。
// - 受限 Kiosk 浏览器模式下 sessionStorage 可能不可用：所有访问 try/catch 包裹，
//   失败时静默降级（流程仍可凭 location.state 工作，只是刷新后匿名需重跑解析）。
// - idle 自动登出 / 进入待机宣传屏时由 clearAiResumeSession() 清理，避免下一位用户继承。
//
// 会员结果不依赖本 session：会员 token 仅在 AuthContext 内存，刷新即失效，
// 跨会话资产读取属未来「用户资产中心」（Phase C-2B，本轮不做）。
// ============================================================

const STORAGE_KEY = 'ai-job-print:current-ai-resume'

export interface AiResumeSession {
  /** AI 解析任务 ID */
  taskId: string
  /** 匿名 parse 时下发的一次性访问令牌；会员结果无此值 */
  accessToken?: string
}

function isBrowserStorageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function readAiResumeSession(): AiResumeSession | null {
  if (!isBrowserStorageAvailable()) return null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) return null
    const taskId = optionalString(parsed['taskId'])
    if (!taskId) return null
    return { taskId, accessToken: optionalString(parsed['accessToken']) }
  } catch {
    return null
  }
}

/** 写入最小会话；只持久化 taskId + accessToken，其余字段一律丢弃。 */
export function saveAiResumeSession(session: AiResumeSession): void {
  if (!isBrowserStorageAvailable()) return
  const taskId = optionalString(session.taskId)
  if (!taskId) return
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ taskId, accessToken: optionalString(session.accessToken) }),
    )
  } catch {
    // sessionStorage 在受限浏览器模式下可能不可用；流程仍可凭 location.state 工作。
  }
}

export function clearAiResumeSession(): void {
  if (!isBrowserStorageAvailable()) return
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
