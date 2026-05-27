// ============================================================
// API 通用类型 — Phase 7
// 所有 /api/v1 接口的请求/响应通用结构
// ============================================================

/** 单体响应包装 */
export interface ApiResponse<T> {
  data: T
  success: boolean
  message?: string
}

/** 分页响应包装 */
export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

/** 业务错误码 */
export type ApiErrorCode =
  | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_TOKEN_EXPIRED'
  | 'AUTH_FORBIDDEN'
  | 'TERMINAL_NOT_REGISTERED'
  | 'TERMINAL_OFFLINE'
  | 'PRINT_PRINTER_OFFLINE'
  | 'PRINT_PAPER_EMPTY'
  | 'PRINT_FILE_TOO_LARGE'
  | 'PRINT_UNSUPPORTED_FORMAT'
  | 'PRINT_QUOTA_EXCEEDED'
  | 'FILE_NOT_FOUND'
  | 'FILE_UPLOAD_FAILED'
  | 'SCAN_DEVICE_BUSY'
  | 'AI_SERVICE_UNAVAILABLE'
  | 'SOURCE_REVIEW_PENDING'
  | 'IMPORT_MAPPING_ERROR'
  | 'DATA_NOT_APPROVED'

/** API 错误响应体 */
export interface ApiError {
  error: {
    code: ApiErrorCode
    message: string
    details?: Record<string, unknown>
  }
}

/** 权限级别 */
export type PermissionLevel = 'public' | 'kiosk' | 'partner' | 'admin'

/**
 * 前台功能服务模块标识
 * 用于 sceneConfig.enabledModules 的扩展类型（Phase 7 新增）
 */
export type ServiceModule =
  | 'job_info_display'          // 岗位信息展示
  | 'job_fair_info'             // 招聘会信息展示
  | 'job_fair_digital_service'  // 招聘会数字服务（企业/展位/资料）
  | 'print_material_service'    // 资料打印服务
  | 'policy_announcement'       // 政策公告
  | 'data_source_api'           // API 数据源接入
  | 'data_source_import'        // 文件导入数据源
  | 'statistics_dashboard'      // 数据统计看板
  // 以下永久禁止
  | 'in_platform_apply'             // 永久禁止
  | 'candidate_management'          // 永久禁止
  | 'resume_delivery_to_enterprise' // 永久禁止
  | 'interview_invitation'          // 永久禁止
  | 'offer_management'              // 永久禁止
