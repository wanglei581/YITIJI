/**
 * 会员 step-up 契约的 API 本地副本。
 *
 * SSOT: packages/shared/src/types/member-privacy.ts
 *
 * services/api 使用 CommonJS 运行时，packages/shared 是 ESM-only 源码包，
 * API 不能在编译产物中直接 require 该包。因此遵循仓库现有契约副本
 * 约定，在 API 内保留完全同构的窄化常量与类型。
 * services/api/scripts/verify-member-step-up.ts 会逐项比对两份 allowlist，
 * 任何 shared 变更未同步 API 时都会 fail closed。
 */
export const MEMBER_STEP_UP_ACTIONS = [
  'export_data_request',
  'export_data_download',
  'close_account',
] as const

export type MemberStepUpAction = (typeof MEMBER_STEP_UP_ACTIONS)[number]
