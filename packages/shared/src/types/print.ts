export type PrintTaskStatus =
  | 'pending'
  | 'queued'
  | 'printing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface PrintTask {
  id: string
  status: PrintTaskStatus
  fileName: string
  pageCount: number
  colorMode: 'color' | 'grayscale'
  duplex: boolean
  copies: number
  createdAt: string
  completedAt?: string
  errorMessage?: string
}
