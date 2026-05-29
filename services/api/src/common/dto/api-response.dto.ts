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
  }
  requestId?: string
}
