import { API_BASE_URL, API_MODE } from './client'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { ApiHttpError } from './httpAdapter'

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
export type PiiFindingDecisionAction = 'keep' | 'redact'

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

export interface CreateMaterialTaskInput {
  kind: MaterialTaskKind
  sourceFileId: string
  params?: Record<string, unknown>
}

export interface MaterialTaskAccess {
  token?: string | null
  accessToken?: string | null
}

export interface PiiFindingDecision {
  findingId: string
  action: PiiFindingDecisionAction
}

interface ResponseEnvelope<T> {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string }
  message?: string | string[]
}

const mockTasks = new Map<string, DocumentProcessTaskView>()
let mockTaskSeq = 1

function makeUrl(path: string): string {
  // L2：匿名材料任务 token 只走 x-material-task-token header（见 authHeaders），
  // 不再拼入 URL query，避免 token 落入访问日志 / 浏览器历史。
  return new URL(`${API_BASE_URL}${path}`, window.location.origin).toString()
}

function authHeaders(access?: MaterialTaskAccess): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  if (access?.token) headers.Authorization = `Bearer ${access.token}`
  if (access?.accessToken) headers['x-material-task-token'] = access.accessToken
  return headers
}

function extractError(body: ResponseEnvelope<unknown>, fallback: string): { code: string; message: string } {
  const message = Array.isArray(body.message)
    ? body.message.join('；')
    : typeof body.message === 'string'
      ? body.message
      : undefined
  return {
    code: body.error?.code ?? 'UNKNOWN_ERROR',
    message: body.error?.message ?? message ?? fallback,
  }
}

async function parseEnvelope<T>(res: Response, failedToken?: string): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as ResponseEnvelope<T>
  if (!res.ok) {
    const error = extractError(body, `HTTP ${res.status}`)
    if (isMemberSessionInvalidError(res.status, error.code, Boolean(failedToken))) notifyMemberSessionExpired(failedToken)
    throw new ApiHttpError(error.code, error.message, res.status)
  }
  if (body.success === false) {
    const error = extractError(body, '材料检查接口返回失败')
    throw new ApiHttpError(error.code, error.message, res.status)
  }
  if (!body.data) {
    throw new ApiHttpError('MATERIAL_TASK_EMPTY', '材料检查接口返回数据为空', res.status)
  }
  return body.data
}

async function request<T>(
  path: string,
  init: RequestInit,
  access?: MaterialTaskAccess,
): Promise<T> {
  const res = await fetch(makeUrl(path), {
    ...init,
    headers: authHeaders(access),
    credentials: 'include',
  })
  return parseEnvelope<T>(res, access?.token ?? undefined)
}

function createMockTask(input: CreateMaterialTaskInput, token?: string | null): DocumentProcessTaskView {
  const now = new Date()
  const id = `mock-material-${input.kind}-${mockTaskSeq++}`
  const isMember = !!token
  const task: DocumentProcessTaskView = {
    id,
    kind: input.kind,
    status: 'completed',
    requesterMode: isMember ? 'member' : 'anonymous',
    accessToken: isMember ? undefined : `mock-access-${id}`,
    sourceFileId: input.sourceFileId,
    resultFileId: null,
    endUserId: null,
    params: input.params ?? {},
    result: createMockTaskResult(input.kind),
    errorCode: null,
    errorMessage: null,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    piiFindings: input.kind === 'pii_scan' ? [] : undefined,
  }
  mockTasks.set(id, task)
  return task
}

function createMockTaskResult(kind: MaterialTaskKind): Record<string, unknown> {
  if (kind === 'inspection') {
    return {
      mode: 'mock',
      note: '流程演示，未连接后端材料检查服务',
      checks: {
        filePresent: true,
        pageCount: null,
        pageCountSource: 'mock',
        canPrint: true,
        warnings: [],
        messages: [{ code: 'MOCK_INSPECTION', severity: 'info', text: '流程演示模式，页数以实际打印为准' }],
      },
    }
  }
  if (kind === 'pii_scan') {
    return {
      mode: 'mock',
      note: '流程演示，未连接后端材料检查服务',
      findingCount: 0,
    }
  }
  if (kind === 'pii_redact') {
    return {
      mode: 'mock',
      note: '流程演示，未连接后端材料检查服务',
      checks: {
        canRedact: true,
        redactedFileId: null,
        resultFileCreated: false,
        decisionTaskId: null,
        findingCount: 0,
        redactedCount: 0,
        keptCount: 0,
        pendingCount: 0,
        warnings: [],
        messages: [{ code: 'MOCK_PII_REDACT', severity: 'info', text: '流程演示模式，当前版本不生成遮挡后文件，打印仍使用原文件' }],
      },
    }
  }
  if (kind === 'normalize_a4') {
    return {
      mode: 'mock',
      note: '流程演示，未连接后端材料检查服务',
      checks: {
        targetPaperSize: 'A4',
        canNormalize: true,
        normalizedFileId: null,
        pageCount: null,
        pageCountSource: 'mock',
        warnings: [],
        messages: [{ code: 'MOCK_A4_NORMALIZE', severity: 'info', text: '流程演示模式，当前版本不生成新文件，打印仍使用原文件' }],
      },
    }
  }
  return {
    mode: 'mock',
    note: '流程演示，未连接后端材料检查服务',
  }
}

export async function createMaterialTask(
  input: CreateMaterialTaskInput,
  token?: string | null,
  accessToken?: string | null,
): Promise<DocumentProcessTaskView> {
  if (API_MODE !== 'http') {
    await new Promise((resolve) => setTimeout(resolve, 500))
    return createMockTask(input, token)
  }

  return request<DocumentProcessTaskView>(
    '/materials/tasks',
    { method: 'POST', body: JSON.stringify(input) },
    { token, accessToken },
  )
}

export async function getMaterialTask(
  taskId: string,
  access?: MaterialTaskAccess,
): Promise<DocumentProcessTaskView> {
  if (API_MODE !== 'http') {
    await new Promise((resolve) => setTimeout(resolve, 250))
    const task = mockTasks.get(taskId)
    if (!task) throw new ApiHttpError('MATERIAL_TASK_NOT_FOUND', '材料检查任务不存在', 404)
    return task
  }

  return request<DocumentProcessTaskView>(
    `/materials/tasks/${encodeURIComponent(taskId)}`,
    { method: 'GET' },
    access,
  )
}

export async function decidePiiFindings(
  taskId: string,
  decisions: PiiFindingDecision[],
  access?: MaterialTaskAccess,
): Promise<DocumentProcessTaskView> {
  if (API_MODE !== 'http') {
    await new Promise((resolve) => setTimeout(resolve, 300))
    const task = mockTasks.get(taskId)
    if (!task) throw new ApiHttpError('MATERIAL_TASK_NOT_FOUND', '材料检查任务不存在', 404)
    const nextFindings = task.piiFindings?.map((finding) => {
      const decision = decisions.find((item) => item.findingId === finding.id)
      return decision ? { ...finding, action: decision.action } : finding
    })
    const nextTask = { ...task, piiFindings: nextFindings, updatedAt: new Date().toISOString() }
    mockTasks.set(taskId, nextTask)
    return nextTask
  }

  return request<DocumentProcessTaskView>(
    `/materials/tasks/${encodeURIComponent(taskId)}/pii-findings/decisions`,
    { method: 'POST', body: JSON.stringify({ decisions }) },
    access,
  )
}
