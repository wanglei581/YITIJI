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
import type { PrintJobParams } from '@ai-job-print/shared'

export interface CreatePrintJobInput {
  fileUrl:   string
  fileMd5?:  string
  fileName?: string
  params:    PrintJobParams
}

export interface PrintJobCreated {
  taskId:    string
  status:    string
  createdAt: string
}

/** Backend status values — subset of shared PrintTaskStatus */
export type BackendJobStatus = 'pending' | 'claimed' | 'printing' | 'completed' | 'failed'

export interface PrintJobStatusResult {
  taskId:        string
  status:        BackendJobStatus
  errorCode?:    string
  errorMessage?: string
  completedAt?:  string
}

export async function createPrintJob(input: CreatePrintJobInput): Promise<PrintJobCreated> {
  const res = await fetch(`${API_BASE_URL}/print/jobs`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(input),
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
