// ============================================================
// 会员「我的打印订单」— 只读列表类型（Phase C-2C 后续小步）
//
// 合规约束（CLAUDE.md §10/§11/§12/§18）：
// - 只返回**归属于请求方本人**（endUserId）的打印任务；跨用户、匿名一律拒绝
//   （后端 EndUserAuthGuard）。匿名 Kiosk 打印（endUserId 为空）天然不会出现在任何会员名下。
// - 只返回**安全元数据**：绝不返回文件原文 / fileUrl(签名链接) / fileMd5(SHA-256) /
//   paramsJson 原文 / accessTokenHash / 内部错误堆栈等敏感字段。
// - 不含支付字段：当前 PrintTask 无 amount / paidStatus 等真实列，绝不伪造。
// - 不含页数 / 设备名：PrintTask 无 pages 列；会员 Kiosk 任务 terminalId 为空且
//   Terminal 无人类可读名称，故不返回 pages / deviceName，避免编造。
// - 空列表返回 []，不伪造订单数量。
// ============================================================

import type { ColorMode, PrintTaskStatus } from './print'

/** 我的打印订单：会员名下一条打印任务（仅安全元数据）。 */
export interface MemberPrintOrderItem {
  /** PrintTask id */
  id: string
  /** 任务状态：pending / claimed / printing / completed / failed / cancelled */
  status: PrintTaskStatus
  /** 原始文件名（落在 paramsJson 内；未提供时为 null，不编造） */
  fileName: string | null
  createdAt: string
  /** 完成时间；未完成为 null */
  completedAt: string | null
  /** 打印份数（来自 paramsJson，1–99）；缺省 / 非法为 null */
  copies: number | null
  /** 黑白 / 彩色（来自 paramsJson）；缺省 / 非法为 null */
  colorMode: ColorMode | null
  /** 纸张幅面（来自 paramsJson，当前机型固定 A4）；缺省为 null */
  paperSize: string | null
  /**
   * 面向用户的安全失败原因（仅失败订单非 null）。
   * 后端把内部 errorCode 映射为白名单可读文案；未知错误码 / 仅有原始 errorMessage → 统一兜底文案。
   * 绝不透出原始 errorCode / errorMessage（可能含设备路径 / 驱动 / 主机名 / 内部堆栈）。
   * 非失败订单为 null。
   */
  failureReasonForUser: string | null
}
