// ============================================================
// Print Jobs API — W6
//
// Thin fetch wrappers around:
//   POST /api/v1/print/jobs          — create a job, get taskId
//   GET  /api/v1/print/jobs/:taskId  — poll task status
//
// Only used when API_MODE === 'http' and file.fileUrl is set.
// Callers should handle errors (network failure, 404, etc.)
// and fall back to simulation as needed.
// ============================================================

import { API_BASE_URL } from '../api/client'
import { getTerminalId } from '../api/screensaver'
import type { PrintJobParams } from '@ai-job-print/shared'

export interface CreatePrintJobInput {
  fileUrl:   string
  /**
   * 文件哈希（hex）。方案②：字段名保留 `fileMd5`，但应传入上传返回的 **SHA-256**
   * （KioskUploadResult.sha256）。后端原样存储，Terminal Agent 用 SHA-256 比对。
   */
  fileMd5?:  string
  fileName?: string
  params:    PrintJobParams
  token?:    string | null
}

export interface PrintJobCreated {
  taskId:    string
  status:    string
  createdAt: string
}

/** Backend status values — subset of shared PrintTaskStatus */
export type BackendJobStatus = 'pending' | 'claimed' | 'printing' | 'completed' | 'failed' | 'cancelled'

export interface PrintJobStatusResult {
  taskId:        string
  status:        BackendJobStatus
  errorCode?:    string
  errorMessage?: string
  completedAt?:  string
}

export async function createPrintJob(input: CreatePrintJobInput): Promise<PrintJobCreated> {
  const { token, ...body } = input
  const terminalId = getTerminalId()
  const res = await fetch(`${API_BASE_URL}/print/jobs`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(terminalId ? { 'X-Terminal-Id': terminalId } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body:    JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`createPrintJob failed: ${res.status} ${text}`)
  }
  return res.json() as Promise<PrintJobCreated>
}

export async function getPrintJobStatus(taskId: string): Promise<PrintJobStatusResult> {
  const res = await fetch(`${API_BASE_URL}/print/jobs/${taskId}`)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`getPrintJobStatus failed: ${res.status} ${text}`)
  }
  return res.json() as Promise<PrintJobStatusResult>
}
