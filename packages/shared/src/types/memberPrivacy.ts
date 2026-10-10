/**
 * 会员隐私数据请求 UI 诚实文案 SSOT。
 *
 * 类型契约以 `./member-privacy` 为准；本文件只承载两端 UI 共用文案。
 * 与后端对齐（2026-07-25）：
 * - `delete` 创建：2026-10-04 起后端受理为「待管理员执行」的注销申请（需二次短信验证）。
 *   下面几句「账号注销暂未开放」是各端入口尚未接上时的文案，由各端接入口时一并改，后端 PR 不动用户可见文案。
 * - `export` 由后台 MemberDataExportMapper 生成元数据包（含文件清单/订单/收藏等），一体机本波不提供提交与下载
 * - `revoke_consent` 可即时撤回 job_ai 授权（用户可见名「AI 使用授权」，与稿 41、账号设置页同名；
 *   托管 a 下 job_ai 仍被「目标岗位定向优化 + 简历对照」手填岗位要求那条路使用，所以撤回项保留）
 *
 * 用户可见文案按稿 v2 README 规则 4：不写「元数据」「step-up」「后台」这类工程词（2026-09-30 A 批）。
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
 * 导出包里的本人资料清单。一体机导出行和管理端范围横幅共用这一份，避免两处各写各的。
 * 必须与 `MemberDataExportMapper` 白名单一致；不得否认订单/文件等已在导出包中的分区。
 */
export const MEMBER_DATA_EXPORT_INVENTORY =
  '账号摘要、文件清单、AI 服务记录摘要、AI 用量（功能、时间、状态、金额）、打印订单、收藏、权益、浏览与打开来源记录、求职进度、通知、反馈、授权与历史请求'

/**
 * 范围横幅：管理端仍整段展示，锁进 verify。
 * 拼出来的句子必须与改用清单常量之前逐字相同。一体机页不再引用这一段：
 * 里面的「如由工作人员办理导出」「账号注销暂未开放」和无人值守、注销口径冲突。
 */
export const MEMBER_DATA_REQUEST_SCOPE =
  `一体机本页只开放「撤回 AI 使用授权」。账号注销暂未开放；数据导出在一体机上尚未开放。如由工作人员办理导出，导出的是本人资料清单（${MEMBER_DATA_EXPORT_INVENTORY}），不含文件原文与简历正文全文。撤回或注销入口不会删除简历、文档、打印订单或收藏。`

export const MEMBER_DATA_REQUEST_TYPE_LABEL: Record<MemberDataRequestType, string> = {
  export: '导出我的资料清单',
  delete: '账号注销（暂未开放）',
  revoke_consent: '撤回 AI 使用授权',
}

export const MEMBER_DATA_REQUEST_TYPE_HINT: Record<MemberDataRequestType, string> = {
  export:
    '导出需要再验证一次是你本人，并由工作人员生成一份短期资料。这台机器不提供提交和下载。资料里是文件清单、AI 记录、AI 用量（功能、时间、状态、金额）、打印订单、收藏、你自己填写的求职进度等摘要，不含文件原文和简历全文。',
  delete: '账号注销暂未开放。系统不会通过此入口删除简历、文档、打印订单或收藏。',
  revoke_consent:
    '提交后会立即撤回 AI 使用授权；请求会记入处理记录。再次使用时需重新确认授权。',
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
  '驳回只记录处理结论。账号注销由管理员在用户管理页执行。'

/** 管理端：注销执行位置说明，不将工单状态标记当作执行操作。 */
export const ADMIN_DATA_REQUEST_DELETE_COMPLETE_CONFIRM =
  '账号注销由管理员在用户管理页执行，需要核对会员身份并再次确认；本页只记录请求与处理结论。数据导出为本人资料清单，不含文件原文与简历正文全文。'

/** 管理端：导出处理说明（与 MemberDataExportMapper 白名单一致）。 */
export const ADMIN_DATA_REQUEST_EXPORT_COMPLETE_HINT =
  '导出由后台队列生成短期私有元数据包；管理员可对失败请求重试或驳回。包内容含账号/文件清单/AI 记录/AI 用量（功能、时间、状态、金额）/打印订单/收藏等元数据，不是「仅岗位 AI 会话」。'
