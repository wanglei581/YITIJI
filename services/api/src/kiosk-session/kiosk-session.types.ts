// ============================================================
// 服务人次（一体机会话）口径。契约 v1 见 docs/progress/current-progress.md 2026-09-29 条目。
//
// 一次会话 = 一个使用周期：从待机屏被唤醒、或上一次清场之后开始，到清场 / 超时结束；
// 周期内出现第一次有效操作时一体机才 start，所以误触不计。
// 只收匿名字段，不收手机号、会员号、文件、页面路径或输入内容。
// ============================================================

/** 服务大类白名单。一体机把路由归到这些大类；未知值 400。 */
export const KIOSK_SERVICE_CATEGORIES = [
  'print', // 打印、复印、取件
  'scan',
  'resume', // 简历诊断 / 优化 / 生成 / 对照
  'interview',
  'assistant', // 小青 / AI 顾问
  'career', // 职业规划 / 自我探索
  'policy',
  'official_channel',
  'member', // 登录、我的
  'help', // 帮助、意见反馈
  'other',
] as const
export type KioskServiceCategory = (typeof KIOSK_SERVICE_CATEGORIES)[number]

export const KIOSK_SESSION_END_REASONS = ['idle_timeout', 'user_exit', 'privacy_clear', 'handover', 'other'] as const
export type KioskSessionEndReason = (typeof KIOSK_SESSION_END_REASONS)[number]

/** 最后一次活跃后多久视为过期（没收到 end 的会话按最后活跃时间算时长）。 */
export const KIOSK_SESSION_IDLE_EXPIRY_MS = 30 * 60 * 1000
/** 一体机报来的开始时间早于服务器时间超过这个值就不采信，用服务器时间。 */
export const KIOSK_SESSION_CLOCK_SKEW_MS = 10 * 60 * 1000
export const DEFAULT_KIOSK_SESSION_RETENTION_DAYS = 180

export const KIOSK_SESSION_NOT_FOUND_CODE = 'KIOSK_SESSION_NOT_FOUND'
