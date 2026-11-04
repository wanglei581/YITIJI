// ============================================================
// U 盘导入本地网桥客户端（Task 9）
//
// 浏览器不直接读 U 盘：文件枚举与字节读取都由 Terminal Agent 在
// 127.0.0.1 完成，本模块只负责调用 Agent 暴露的 /local/usb/* 接口。
// 鉴权分两层：Origin 白名单（Agent 侧 CORS）+ 静态共享令牌
// VITE_TERMINAL_AGENT_BRIDGE_TOKEN（随 Kiosk 构建注入，需与 Agent
// 的 localApiBridgeToken 配置一致，安装时一起下发）。
// ============================================================

import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { USB_IMPORT_UNCONFIRMED_COPY } from '../../copy/usbImportCopy'

/**
 * 浏览器等本机程序回上传结果的上限。
 * 本机程序到后端的上传超时是 30 秒（terminal-agent api-client，且不自动重试）。
 * 这里再留 15 秒，避免本机程序还在那 30 秒预算里时，浏览器先把请求掐断。
 */
export const USB_UPLOAD_TIMEOUT_MS = 45_000

/** 上传没有 HTTP 答复（到点或连接中断）。不表示本机程序没开，也不表示后端没保存。 */
export const USB_UPLOAD_UNCONFIRMED_CODE = 'USB_UPLOAD_UNCONFIRMED'

const configuredLocalAgentBaseUrl = (import.meta.env['VITE_TERMINAL_AGENT_LOCAL_URL'] ?? '').trim()
const LOCAL_AGENT_BASE_URL = configuredLocalAgentBaseUrl || 'http://127.0.0.1:9527'
const BRIDGE_TOKEN = (import.meta.env['VITE_TERMINAL_AGENT_BRIDGE_TOKEN'] ?? '').trim()

export class LocalAgentApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'LocalAgentApiError'
  }
}

export interface UsbStatus {
  present: boolean
  driveLabel: string | null
}

export interface UsbFileListItem {
  safeId: string
  filename: string
  extension: string
  sizeBytes: number
}

export interface UsbFileListResult extends UsbStatus {
  files: UsbFileListItem[]
}

export interface UsbUploadResult {
  fileId: string
  filename: string
  sizeBytes: number
  mimeType: string
  sha256: string
  fileUrl: string | null
  fileUrlExpiresAt: string | null
}

interface Envelope<T> {
  success: boolean
  data: T
}

/** U 盘导入功能是否已在本终端完成配置（未配置令牌时前端不应展示为可用）。 */
export function isUsbImportConfigured(): boolean {
  return Boolean(BRIDGE_TOKEN)
}

function isTransportUnconfirmed(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = 'name' in err ? (err as { name?: unknown }).name : undefined
  if (name === 'AbortError') return true
  return err instanceof TypeError
}

export function isUsbUploadUnconfirmed(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code?: unknown }).code === USB_UPLOAD_UNCONFIRMED_CODE)
}

async function callLocalAgent<T>(
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
  endUserToken?: string | null,
  options?: { signal?: AbortSignal; unconfirmedOnTransportFailure?: boolean },
): Promise<T> {
  if (!BRIDGE_TOKEN) {
    throw new LocalAgentApiError('LOCAL_USB_BRIDGE_TOKEN_MISSING', '这台机器还没配好 U 盘导入', 0)
  }

  let res: Response
  try {
    res = await fetch(`${LOCAL_AGENT_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'X-Local-Bridge-Token': BRIDGE_TOKEN,
        ...(endUserToken ? { Authorization: `Bearer ${endUserToken}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: options?.signal,
    })
  } catch (err) {
    // 只有上传走这条：到点或连接中断时没有 HTTP 答复，不能说成「本机程序没开」或「导入失败」。
    // 列表和状态轮询仍按连不上处理。这里不重发。
    if (options?.unconfirmedOnTransportFailure && isTransportUnconfirmed(err)) {
      throw new LocalAgentApiError(USB_UPLOAD_UNCONFIRMED_CODE, USB_IMPORT_UNCONFIRMED_COPY, 0)
    }
    throw new LocalAgentApiError('LOCAL_AGENT_UNREACHABLE', '无法连接这台机器的本机程序，请确认本机程序正在运行', 0)
  }

  if (!res.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = `请求失败（${res.status}）`
    try {
      const payload = (await res.json()) as { error?: { code?: string; message?: string } }
      code = payload.error?.code ?? code
      message = payload.error?.message ?? message
    } catch {
      /* keep default */
    }
    if (isMemberSessionInvalidError(res.status, code, Boolean(endUserToken))) {
      notifyMemberSessionExpired(endUserToken ?? undefined)
    }
    throw new LocalAgentApiError(code, message, res.status)
  }

  const json = (await res.json()) as Envelope<T>
  return json.data
}

export function getUsbStatus(): Promise<UsbStatus> {
  return callLocalAgent<UsbStatus>('/local/usb/status', 'GET')
}

export function listUsbFiles(): Promise<UsbFileListResult> {
  return callLocalAgent<UsbFileListResult>('/local/usb/files', 'GET')
}

export function uploadUsbFile(
  safeId: string,
  purpose: 'print_doc' | 'resume_upload' = 'print_doc',
  endUserToken?: string | null,
): Promise<UsbUploadResult> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), USB_UPLOAD_TIMEOUT_MS)
  return callLocalAgent<UsbUploadResult>(
    '/local/usb/upload',
    'POST',
    { safeId, purpose },
    endUserToken,
    { signal: controller.signal, unconfirmedOnTransportFailure: true },
  ).finally(() => window.clearTimeout(timer))
}
