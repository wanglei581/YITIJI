import type {
  UploadSessionCancelResponse,
  UploadSessionConfirmResponse,
  UploadSessionCreateRequest,
  UploadSessionCreateResponse,
  UploadSessionSceneResolveResponse,
  UploadSessionStatusResponse,
} from '@ai-job-print/shared'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { API_BASE_URL } from './client'
import { ApiHttpError } from './httpAdapter'

interface ResponseEnvelope<T> {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string }
}

function makeUrl(path: string): string {
  return new URL(`${API_BASE_URL}${path}`, window.location.origin).toString()
}

async function requestJson<T>(path: string, init?: RequestInit & { token?: string | null; controlToken?: string | null }): Promise<T> {
  const token = init?.token
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  if (init?.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init?.controlToken) headers.set('X-Upload-Session-Control', init.controlToken)

  let res: Response
  try {
    res = await fetch(makeUrl(path), {
      ...init,
      headers,
      credentials: 'include',
    })
  } catch {
    throw new ApiHttpError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }

  let payload: ResponseEnvelope<T> | T | null = null
  try {
    payload = (await res.json()) as ResponseEnvelope<T> | T
  } catch {
    payload = null
  }

  if (!res.ok) {
    const envelope = payload as ResponseEnvelope<T> | null
    const code = envelope?.error?.code ?? 'UNKNOWN_ERROR'
    const message = envelope?.error?.message ?? `请求失败（${res.status}）`
    if (isMemberSessionInvalidError(res.status, code, Boolean(token))) notifyMemberSessionExpired(token ?? undefined)
    throw new ApiHttpError(code, message, res.status)
  }

  const envelope = payload as ResponseEnvelope<T> | null
  if (envelope && typeof envelope === 'object' && 'data' in envelope) {
    if (envelope.data === undefined || envelope.data === null) {
      throw new ApiHttpError('UPLOAD_SESSION_EMPTY', '这次没读到上传结果', res.status)
    }
    return envelope.data
  }
  if (payload === null) {
    throw new ApiHttpError('UPLOAD_SESSION_EMPTY', '这次没读到上传结果', res.status)
  }
  return payload as T
}

const uploadCreatesInFlight = new Map<string, Promise<UploadSessionCreateResponse>>()

export function createUploadSession(
  input: UploadSessionCreateRequest,
  token?: string | null,
): Promise<UploadSessionCreateResponse> {
  const key = JSON.stringify([input, token ?? null])
  const existing = uploadCreatesInFlight.get(key)
  if (existing) return existing
  const request = requestJson<UploadSessionCreateResponse>('/upload-sessions', {
    method: 'POST',
    token,
    body: JSON.stringify(input),
  }).finally(() => {
    if (uploadCreatesInFlight.get(key) === request) uploadCreatesInFlight.delete(key)
  })
  uploadCreatesInFlight.set(key, request)
  return request
}

export function getUploadSessionStatus(sessionId: string, controlToken: string): Promise<UploadSessionStatusResponse> {
  return requestJson<UploadSessionStatusResponse>(`/upload-sessions/${encodeURIComponent(sessionId)}`, { controlToken })
}

export function confirmUploadSession(
  sessionId: string,
  controlToken: string,
  token?: string | null,
): Promise<UploadSessionConfirmResponse> {
  return requestJson<UploadSessionConfirmResponse>(`/upload-sessions/${encodeURIComponent(sessionId)}/confirm`, {
    method: 'POST',
    controlToken,
    token,
  })
}

export function cancelUploadSession(sessionId: string, controlToken: string): Promise<UploadSessionCancelResponse> {
  return requestJson<UploadSessionCancelResponse>(`/upload-sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    controlToken,
  })
}

export function uploadPhoneSessionFile(args: {
  sessionId: string
  uploadToken: string
  file: File
}): Promise<UploadSessionStatusResponse> {
  const form = new FormData()
  form.append('uploadToken', args.uploadToken)
  form.append('file', args.file, args.file.name)
  return requestJson<UploadSessionStatusResponse>(
    `/upload-sessions/${encodeURIComponent(args.sessionId)}/files`,
    {
      method: 'POST',
      body: form,
    },
  )
}

export function buildPhoneUploadUrl(uploadUrl: string, sessionId: string, uploadToken: string, purpose?: string): string {
  const url = new URL(uploadUrl, window.location.origin)
  const fragment = new URLSearchParams()
  fragment.set('sessionId', sessionId)
  fragment.set('token', uploadToken)
  // purpose 仅用于手机端文案展示,不参与鉴权(会话真正的 purpose 由服务端存储决定)。
  if (purpose) fragment.set('purpose', purpose)
  url.hash = fragment.toString()
  return url.toString()
}

/** 场景码格式：服务端签发 24 位 base64url，这里留一点长度余量；手机码路径只认这个字符集。 */
const UPLOAD_SCENE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,32}$/

export function isUploadSceneToken(value: unknown): value is string {
  return typeof value === 'string' && UPLOAD_SCENE_TOKEN_PATTERN.test(value)
}

/**
 * 一体机屏上手机上传码的地址。
 * 回执带合格场景码：`<公网域名>/k/u/<场景码>`，域名取回执 uploadUrl 的 origin（服务端按 KIOSK_PUBLIC_BASE_URL 拼）。
 * 微信「扫普通链接二维码打开小程序」规则生效时，扫码直接进小程序；没生效或用别的软件扫，打开网页中转页 /k/u/:scene，
 * 兑换后转到 /upload/phone。码里不再放会话号与上传令牌。
 * 回执没带场景码（旧后端）或格式不对：照旧出 buildPhoneUploadUrl 的长链，purpose 只在长链里作文案提示。
 */
export function buildPhoneUploadQrUrl(
  created: Pick<UploadSessionCreateResponse, 'uploadUrl' | 'sessionId' | 'uploadToken' | 'sceneToken'>,
  purpose?: string,
): string {
  if (isUploadSceneToken(created.sceneToken)) {
    const origin = new URL(created.uploadUrl, window.location.origin).origin
    return new URL(`/k/u/${created.sceneToken}`, origin).toString()
  }
  return buildPhoneUploadUrl(created.uploadUrl, created.sessionId, created.uploadToken, purpose)
}

const sceneResolvesInFlight = new Map<string, Promise<UploadSessionSceneResolveResponse>>()

/**
 * 手机端用场景码换回会话号与上传令牌（不带会员令牌，回执也不含控制令牌）。
 * 会话有效期内可重复兑换，同一张码每次拿到同一把令牌，所以断网后重试是安全的；失败一律 UPLOAD_SCENE_UNUSABLE。
 * 同一场景码同时只发一次（React StrictMode 下进页 effect 会跑两遍），结束后可再发。
 */
export function resolveUploadScene(scene: string): Promise<UploadSessionSceneResolveResponse> {
  const existing = sceneResolvesInFlight.get(scene)
  if (existing) return existing
  const request = requestJson<UploadSessionSceneResolveResponse>('/upload-sessions/scene/resolve', {
    method: 'POST',
    body: JSON.stringify({ scene }),
  }).finally(() => {
    if (sceneResolvesInFlight.get(scene) === request) sceneResolvesInFlight.delete(scene)
  })
  sceneResolvesInFlight.set(scene, request)
  return request
}

/**
 * 上传会话接口面对公共终端和手机浏览器；不要把服务端原始错误（可能含内部状态）
 * 直接显示给用户。这里保留用户可执行的恢复路径，不改变错误码给调用方作逻辑判断。
 */
export function uploadSessionUserMessage(error: unknown, fallback = '上传暂时不可用，请稍后重试。'): string {
  const code = error instanceof ApiHttpError ? error.code : undefined
  switch (code) {
    // NETWORK_ERROR 的文案由本模块的 requestJson 自己合成，从不携带服务端内容，
    // 本来就无需改写；保持与既有可见文案一致（fusion-w5 浏览器用例逐字钉死）。
    case 'NETWORK_ERROR':
      return '网络连接失败，请稍后重试'
    case 'UPLOAD_SESSION_EXPIRED':
    case 'UPLOAD_SESSION_NOT_PENDING':
    case 'UPLOAD_SESSION_NOT_FOUND':
    case 'UPLOAD_TOKEN_INVALID':
    case 'UPLOAD_SCENE_UNUSABLE':
      // 场景码兑换失败（格式错、查无此码、已过期、已收到文件）服务端只回 UPLOAD_SCENE_UNUSABLE，补救动作与上面几种一样。
      return '二维码已失效或已使用，请回到一体机刷新二维码。'
    case 'UPLOAD_SESSION_UPLOAD_IN_PROGRESS':
      return '文件正在上传，请稍候。'
    case 'FILE_REQUIRED':
      return '请选择要上传的文件。'
    case 'FILE_TOO_LARGE':
      return '文件超过 10MB，请压缩后重新上传。'
    case 'UPLOAD_SESSION_NOT_READY':
      return '手机端尚未完成上传，请先在手机上选择文件。'
    case 'MEMBER_AUTH_REQUIRED':
      return '登录状态已失效，请回到一体机重新登录或使用临时上传。'
    default:
      return fallback
  }
}
