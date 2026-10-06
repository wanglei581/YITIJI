// 终端详情抽屉「远程操作」用。只被这一处引用。
// API_MODE=http → /admin/terminals/:terminalId/commands（后端 #1288 重启终端程序、#1303 清空打印队列）
// API_MODE=mock → 内存，只记下发，不假装终端已经执行。
// 共享包里没有命令视图类型，按服务端 terminal-commands.service.ts 的 TerminalCommandView 声明。

import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export type TerminalCommandType = 'restart_agent' | 'clear_print_queue'

export interface TerminalCommandView {
  id: string
  type: string
  status: string
  requestedBy: { id: string; name: string }
  requestedAt: string
  expiresAt: string
  acceptedAt: string | null
  finishedAt: string | null
  completedVerified: boolean | null
  resultCode: string | null
  remainingJobs: number | null
}

const COMMAND_LIST_LIMIT = 20
const COMMAND_TTL_MS = 10 * 60 * 1000

function handleAuthFailure(status: number): void {
  if (status === 401 || status === 403) redirectToLogin()
}

async function toApiError(res: Response, fallbackMessage: string): Promise<ApiHttpError> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string }
    message?: unknown
  }
  const message = body.error?.message ?? (typeof body.message === 'string' ? body.message : undefined)
  return new ApiHttpError(body.error?.code ?? 'TERMINAL_COMMAND_ERROR', message ?? fallbackMessage, res.status)
}

function commandsUrl(terminalId: string): string {
  return `${API_BASE_URL}/admin/terminals/${encodeURIComponent(terminalId)}/commands`
}

async function httpList(terminalId: string): Promise<TerminalCommandView[]> {
  const res = await fetch(`${commandsUrl(terminalId)}?limit=${COMMAND_LIST_LIMIT}`, { headers: authHeader() })
  handleAuthFailure(res.status)
  if (!res.ok) throw await toApiError(res, '读取远程命令记录失败')
  const { data } = (await res.json()) as { data: TerminalCommandView[] }
  return Array.isArray(data) ? data : []
}

async function httpIssue(terminalId: string, type: TerminalCommandType): Promise<TerminalCommandView> {
  const res = await fetch(commandsUrl(terminalId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ type }),
  })
  handleAuthFailure(res.status)
  if (!res.ok) throw await toApiError(res, '下发远程命令失败')
  const { data } = (await res.json()) as { data: TerminalCommandView }
  return data
}

// mock：演示用一条六天前已完成的重启记录；新下发只停在「待执行」，演示模式没有终端会来执行。
const mockStore = new Map<string, TerminalCommandView[]>()

function mockSeed(terminalId: string): TerminalCommandView[] {
  const existing = mockStore.get(terminalId)
  if (existing) return existing
  const requestedAt = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000 - 3 * 60 * 60 * 1000)
  const seeded: TerminalCommandView[] = [{
    id: `cmd-${terminalId}-seed`,
    type: 'restart_agent',
    status: 'completed',
    requestedBy: { id: 'mock-admin-001', name: '周晓雯' },
    requestedAt: requestedAt.toISOString(),
    expiresAt: new Date(requestedAt.getTime() + COMMAND_TTL_MS).toISOString(),
    acceptedAt: new Date(requestedAt.getTime() + 18_000).toISOString(),
    finishedAt: new Date(requestedAt.getTime() + 71_000).toISOString(),
    completedVerified: true,
    resultCode: null,
    remainingJobs: null,
  }]
  mockStore.set(terminalId, seeded)
  return seeded
}

export const terminalCommandService = {
  async list(terminalId: string): Promise<TerminalCommandView[]> {
    if (API_MODE === 'http') return httpList(terminalId)
    return mockSeed(terminalId).map((item) => ({ ...item, requestedBy: { ...item.requestedBy } }))
  },
  async issue(terminalId: string, type: TerminalCommandType): Promise<TerminalCommandView> {
    if (API_MODE === 'http') return httpIssue(terminalId, type)
    const current = mockSeed(terminalId)
    if (current.some((item) => item.status === 'pending' || item.status === 'accepted')) {
      throw new ApiHttpError('TERMINAL_COMMAND_PENDING', '这台终端还有一条没结束的远程命令', 409)
    }
    const now = new Date()
    const created: TerminalCommandView = {
      id: `cmd-${terminalId}-${now.getTime()}`,
      type,
      status: 'pending',
      requestedBy: { id: 'mock-admin-001', name: '周晓雯' },
      requestedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + COMMAND_TTL_MS).toISOString(),
      acceptedAt: null,
      finishedAt: null,
      completedVerified: null,
      resultCode: null,
      remainingJobs: null,
    }
    mockStore.set(terminalId, [created, ...current].slice(0, COMMAND_LIST_LIMIT))
    return { ...created }
  },
}
