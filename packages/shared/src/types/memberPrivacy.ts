/**
 * 会员隐私数据请求 UI 诚实文案 SSOT。
 *
 * 类型契约以 `./member-privacy` 为准；本文件只承载两端 UI 共用文案。
 * 与后端对齐（2026-07 main）：
 * - `delete` 创建会被 ACCOUNT_CLOSURE_NOT_AVAILABLE 拒绝（账号注销暂未开放）
 * - `export` 需 step-up；一体机本波只展示说明，不伪造已导出
 * - `revoke_consent` 可即时撤回 job_ai 授权
 */

export type {
  MemberDataRequestType,
  MemberDataRequestStatus,
  MemberDataRequestItem,
  MemberDataRequestPage,
  AdminMemberDataRequestItem,
} from './member-privacy'

import type { MemberDataRequestStatus, MemberDataRequestType } from './member-privacy'

/** 范围横幅：会员端与管理端共用，锁进 verify。 */
export const MEMBER_DATA_REQUEST_SCOPE =
  '本功能仅针对「岗位 AI 咨询会话与授权」。不删除、不导出简历、文档、打印订单、收藏或其他账号资产。账号注销暂未开放。'

export const MEMBER_DATA_REQUEST_TYPE_LABEL: Record<MemberDataRequestType, string> = {
  export: '导出岗位 AI 会话与授权记录',
  delete: '账号注销（暂未开放）',
  revoke_consent: '撤回岗位 AI 授权',
}

export const MEMBER_DATA_REQUEST_TYPE_HINT: Record<MemberDataRequestType, string> = {
  export:
    '导出需完成安全验证（step-up）。一体机本波仅展示说明与历史记录，不伪造「已自动打包下载」。',
  delete: '账号注销暂未开放。系统不会通过此入口删除简历、文档、打印订单或收藏。',
  revoke_consent:
    '提交后会立即撤回岗位 AI 授权；请求会记入处理记录。再次使用岗位 AI 时需重新确认授权。',
}

export const MEMBER_DATA_REQUEST_STATUS_LABEL: Record<MemberDataRequestStatus, string> = {
  pending: '待处理',
  handling: '处理中',
  ready: '可下载',
  completed: '已完成',
  expired: '已过期',
  failed: '处理失败',
  rejected: '已驳回',
  cancelled: '已取消',
}

/** 管理端：驳回说明（导出失败后的人工处理口径）。 */
export const ADMIN_DATA_REQUEST_REJECT_HINT =
  '驳回仅记录运营处理结论，不会删除简历、文档、打印订单或收藏。账号注销仍未开放。'

/** 管理端：完成删除类文案保留为诚实否定口径（后端拒绝创建 delete）。 */
export const ADMIN_DATA_REQUEST_DELETE_COMPLETE_CONFIRM =
  '账号注销暂未开放。请勿将任何状态标记理解为「已清空全部个人资产」。岗位 AI 会话删除与账号注销是不同能力。'

/** 管理端：导出处理说明。 */
export const ADMIN_DATA_REQUEST_EXPORT_COMPLETE_HINT =
  '导出由后台队列执行；管理员可对失败请求重试或驳回。系统不会自动打包简历或其他个人资产。'
