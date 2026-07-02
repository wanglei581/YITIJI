// 会员个人资产中心列表类型（Phase C-2B → C-2D）。
// 与 packages/shared/src/types/memberAssets.ts 结构对齐（前后端契约 SSOT 见 shared）。
// 只含元数据，绝不含 payloadJson / 文件内容 / storageKey / sha256 / accessTokenHash / PII。

/** 游标分页响应（C-2D，所有 /me/* 列表统一形状）。 */
export interface MemberAssetPage<T> {
  items: T[]
  /** 同条件下的真实总条数（头部统计用） */
  total: number
  nextCursor: string | null
}

/** AI 服务记录种类：解析 / 优化 / 生成。 */
export type MemberAiRecordKind = 'parse' | 'optimize' | 'generate' | 'job_fit' | 'career_plan' | 'fair_visit_plan'

export interface MemberResumeItem {
  id: string
  taskId: string
  /** parse=上传并诊断的简历；generate=AI 引导生成的简历 */
  kind: 'parse' | 'generate'
  status: string
  provider: string
  optimized: boolean
  createdAt: string
  updatedAt: string
  expiresAt: string | null
}

export interface MemberDocumentItem {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  purpose: string
  sensitiveLevel: string
  assetCategory: 'original' | 'optimized' | 'derived'
  retentionPolicy: 'months_3' | 'months_6' | 'long_term' | 'system_short' | null
  allowedRetentionPolicies: ('months_3' | 'months_6' | 'long_term' | 'system_short')[]
  createdAt: string
  expiresAt: string | null
  downloadUrlPath: string
  previewUrlPath: string
}

export interface MemberAiRecordItem {
  id: string
  taskId: string
  kind: MemberAiRecordKind
  status: string
  provider: string
  createdAt: string
  expiresAt: string | null
}
