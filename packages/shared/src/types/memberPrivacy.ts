/**
 * 会员隐私数据请求 UI 诚实文案 SSOT。
 *
 * 类型契约以 `./member-privacy` 为准；本文件只承载两端 UI 共用文案。
 * 与后端对齐（2026-07-25）：
 * - `delete` 创建会被 ACCOUNT_CLOSURE_NOT_AVAILABLE 拒绝（账号注销暂未开放）
 * - `export` 由后台 MemberDataExportMapper 生成元数据包（含文件清单/订单/收藏等），一体机本波不提供提交与下载
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

/**
 * 范围横幅：会员端与管理端共用，锁进 verify。
 * 必须与 `MemberDataExportMapper` 白名单一致；不得否认订单/文件等已在导出包中的分区。
 */
export const MEMBER_DATA_REQUEST_SCOPE =
  '一体机本页仅开放「撤回岗位 AI 授权」。账号注销暂未开放；数据导出在一体机端尚未开放。后台若执行导出，打包内容为会员相关元数据清单（账号摘要、文件清单、AI 服务记录摘要、打印订单、收藏、权益、浏览与外跳、通知、反馈、授权与历史请求），不含文件原文二进制与简历正文全文。撤回或注销入口不会删除简历、文档、打印订单或收藏。'

export const MEMBER_DATA_REQUEST_TYPE_LABEL: Record<MemberDataRequestType, string> = {
  export: '导出账号与业务元数据清单',
  delete: '账号注销（暂未开放）',
  revoke_consent: '撤回岗位 AI 授权',
}

export const MEMBER_DATA_REQUEST_TYPE_HINT: Record<MemberDataRequestType, string> = {
  export:
    '导出需完成安全验证（step-up），并由后台生成短期私有元数据包。一体机本波不提供提交与下载入口，不伪造「已自动打包下载」。包内含文件清单、AI 记录、打印订单、收藏等摘要，不含文件原文与简历正文全文。',
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

/** 管理端：导出处理说明（与 MemberDataExportMapper 白名单一致）。 */
export const ADMIN_DATA_REQUEST_EXPORT_COMPLETE_HINT =
  '导出由后台队列生成短期私有元数据包；管理员可对失败请求重试或驳回。包内容含账号/文件清单/AI 记录/打印订单/收藏等元数据，不是「仅岗位 AI 会话」。'
