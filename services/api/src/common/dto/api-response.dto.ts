/** Unified successful response envelope */
export class ApiResponse<T> {
  readonly success = true
  constructor(public readonly data: T) {}

  static ok<T>(data: T): ApiResponse<T> {
    return new ApiResponse(data)
  }
}

/** Unified error response shape (matches frontend ApiHttpError parser) */
export interface ErrorResponseBody {
  success: false
  error: {
    code: string
    message: string
  }
}
