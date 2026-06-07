// 会员个人资产中心只读列表类型（Phase C-2B）。
// 与 packages/shared/src/types/memberAssets.ts 结构对齐（前后端契约 SSOT 见 shared）。
// 只含元数据，绝不含 payloadJson / 文件内容 / storageKey / sha256 / accessTokenHash / PII。

export interface MemberResumeItem {
  id: string
  taskId: string
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
  createdAt: string
  expiresAt: string
  downloadUrlPath: string
  previewUrlPath: string
}

export interface MemberAiRecordItem {
  id: string
  taskId: string
  kind: 'parse' | 'optimize'
  status: string
  provider: string
  createdAt: string
  expiresAt: string | null
}
