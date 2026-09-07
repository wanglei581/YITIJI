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

/** AI 服务记录种类：解析 / 优化 / 生成 / 岗位匹配 / 职业规划 / 招聘会准备 / 自我探索（v1）。 */
export type MemberAiRecordKind = 'parse' | 'optimize' | 'generate' | 'job_fit' | 'career_plan' | 'fair_visit_plan' | 'self_assessment'

export interface MemberResumeItem {
  id: string
  taskId: string
  /** parse=上传并诊断的简历；generate=AI 引导生成的简历 */
  kind: 'parse' | 'generate'
  status: string
  provider: string
  optimized: boolean
  hasDraft: boolean
  latestVersion: number | null
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
  /** false = 高敏报告等禁止进入打印链路，前端不得展示重新打印。 */
  reprintable: boolean
}

export type MemberDeletedDocumentStorageState = 'removed' | 'pending' | 'unknown'
export type MemberDeletedDocumentActorKind = 'system' | 'self' | 'admin' | 'unknown'

export interface MemberDeletedDocumentItem {
  id: string
  filename: string
  purpose: string
  createdAt: string
  expiresAt: string | null
  deletedAt: string
  deleteReason: string | null
  deletedByKind: MemberDeletedDocumentActorKind
  storageObjectState: MemberDeletedDocumentStorageState
}

export interface MemberAiRecordRef {
  type: 'job_fair'
  id: string
  name: string
}

export interface MemberAiRecordItem {
  id: string
  taskId: string
  kind: MemberAiRecordKind
  status: string
  provider: string
  /** parse 行：同 taskId 是否已有 optimize。其它 kind 为 false。 */
  optimized: boolean
  /** parse 行：同 taskId 是否有 optimize_draft。其它 kind 为 false。 */
  hasDraft: boolean
  /** parse 行：optimize_confirmed.version；无快照或非 parse 为 null。 */
  latestVersion: number | null
  createdAt: string
  expiresAt: string | null
  /** 仅 fair_visit_plan：从 payload.basedOn 抽出的窄字段，不回传 payload。 */
  ref?: MemberAiRecordRef | null
}

export interface MemberQaRecordItem {
  id: string
  sessionId: string
  artifactId: string
  kind: 'qa_pins'
  title: string
  createdAt: string
  expiresAt: string
  fileId: string | null
}

export interface MemberAiRecordPage {
  items: MemberAiRecordItem[]
  total: number
  nextCursor: string | null
  qaRecords: MemberQaRecordItem[]
}
