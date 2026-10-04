/** Unified successful response envelope */
export class ApiResponse<T> {
  readonly success = true
  constructor(public readonly data: T) {}

  static ok<T>(data: T): ApiResponse<T> {
    return new ApiResponse(data)
  }
}

/**
 * 统一错误响应体。
 *
 * `requestId` 由 RequestId 中间件注入到 `req.requestId`,
 * HttpExceptionFilter 取出后写入响应,方便客户端报错时
 * 提供 ID 给运维排查日志。
 */
export interface ErrorResponseBody {
  success: false
  error: {
    code: string
    message: string
    /** 校验类错误的详细分项,例如 ["items[0].externalId: should not be empty"] */
    details?: string[]
    /** 管理员注销阻塞清单，只含订单号与状态。 */
    orders?: Array<{ orderNo: string; status: string }>
    /** 手机上传二维码已过期，但文件已经记在会员名下。只有 true，不带文件名。 */
    memberFileRetained?: true
    /** 仅 PICKUP_TERMINAL_MISMATCH（会员本机领取走错机器）：该单绑定的网点，给本人看。 */
    terminal?: { id: string; displayName: string | null; locationLabel: string | null } | null
    /** 前端可用的下一步标识（小写蛇形），如 export_ai_labeled；只在拒绝时附带。 */
    nextAction?: string
  }
  requestId?: string
}
