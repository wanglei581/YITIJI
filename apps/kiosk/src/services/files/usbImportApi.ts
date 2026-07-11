// ============================================================
// U 盘导入本地网桥客户端（Task 9）
//
// 浏览器不直接读 U 盘：文件枚举与字节读取都由 Terminal Agent 在
// 127.0.0.1 完成，本模块只负责调用 Agent 暴露的 /local/usb/* 接口。
// 鉴权分两层：Origin 白名单（Agent 侧 CORS）+ 静态共享令牌
// VITE_TERMINAL_AGENT_BRIDGE_TOKEN（随 Kiosk 构建注入，需与 Agent
// 的 localApiBridgeToken 配置一致，安装时一起下发）。
// ============================================================

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

async function callLocalAgent<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  if (!BRIDGE_TOKEN) {
    throw new LocalAgentApiError('LOCAL_USB_BRIDGE_TOKEN_MISSING', '当前终端未配置 U 盘导入本地令牌', 0)
  }

  let res: Response
  try {
    res = await fetch(`${LOCAL_AGENT_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'X-Local-Bridge-Token': BRIDGE_TOKEN,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new LocalAgentApiError('LOCAL_AGENT_UNREACHABLE', '无法连接本机 Terminal Agent，请确认 Agent 正在运行', 0)
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

export function uploadUsbFile(safeId: string): Promise<UsbUploadResult> {
  return callLocalAgent<UsbUploadResult>('/local/usb/upload', 'POST', { safeId })
}
