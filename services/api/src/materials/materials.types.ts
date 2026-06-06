export type MaterialTaskKind =
  | 'inspection'
  | 'normalize_a4'
  | 'pii_scan'
  | 'pii_redact'
  | 'bundle_render'

export type MaterialTaskStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type PiiFindingAction = 'pending' | 'keep' | 'redact'

export interface MaterialsRequester {
  kind: 'anonymous' | 'member'
  endUserId?: string
  accessToken?: string
}

export interface PiiFindingView {
  id: string
  taskId: string
  type: string
  label: string
  pageNumber: number | null
  snippet: string | null
  confidence: number | null
  action: PiiFindingAction
  createdAt: string
}

export interface DocumentProcessTaskView {
  id: string
  kind: MaterialTaskKind
  status: MaterialTaskStatus
  requesterMode: 'anonymous' | 'member'
  accessToken?: string
  sourceFileId: string
  resultFileId: string | null
  endUserId: string | null
  params: Record<string, unknown>
  result: Record<string, unknown> | null
  errorCode: string | null
  errorMessage: string | null
  expiresAt: string
  createdAt: string
  updatedAt: string
  piiFindings?: PiiFindingView[]
}
