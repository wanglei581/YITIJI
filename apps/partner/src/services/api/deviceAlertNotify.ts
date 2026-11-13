import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export interface DeviceAlertNotifyView {
  configured: boolean
  maskedUrl: string | null
  dataMode?: 'demo'
}

const DEMO_MESSAGE = '当前是本地演示，不能保存或发送通知。'

async function parseError(res: Response): Promise<never> {
  let code = `HTTP_${res.status}`
  let message = '通知设置没有保存'
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string }; message?: string | string[] }
    if (body.error?.code) code = body.error.code
    if (body.error?.message) message = body.error.message
    else if (typeof body.message === 'string') message = body.message
    else if (Array.isArray(body.message) && body.message[0]) message = body.message.join('；')
  } catch {
    /* 保留默认文案 */
  }
  if (res.status === 401) redirectToLogin()
  throw new ApiHttpError(code, message, res.status)
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = new Headers({ Accept: 'application/json', ...authHeader() })
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) return parseError(res)
  return res.json() as Promise<T>
}

export function getDeviceAlertNotify(): Promise<DeviceAlertNotifyView> {
  if (API_MODE !== 'http') return Promise.resolve({ configured: false, maskedUrl: null, dataMode: 'demo' })
  return request('GET', '/partner/device-alert-notify')
}

export function saveDeviceAlertNotify(url: string): Promise<DeviceAlertNotifyView> {
  if (API_MODE !== 'http') return Promise.reject(new ApiHttpError('DEMO', DEMO_MESSAGE, 400))
  return request('PUT', '/partner/device-alert-notify', { url })
}

export function testDeviceAlertNotify(): Promise<{ sent: true }> {
  if (API_MODE !== 'http') return Promise.reject(new ApiHttpError('DEMO', DEMO_MESSAGE, 400))
  return request('POST', '/partner/device-alert-notify/test')
}
