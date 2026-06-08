// 会员「我的打印订单」只读列表类型（Phase C-2C 后续小步）。
// 与 packages/shared/src/types/memberPrintOrders.ts 结构对齐（前后端契约 SSOT 见 shared）。
// 只含安全元数据，绝不含 fileUrl / fileMd5 / paramsJson 原文 / 内部错误信息 / 支付字段。

export interface MemberPrintOrderItem {
  id: string
  status: string
  fileName: string | null
  createdAt: string
  completedAt: string | null
  copies: number | null
  colorMode: 'black_white' | 'color' | null
  paperSize: string | null
}
