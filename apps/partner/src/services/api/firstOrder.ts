import type {
  FirstOrderIncident, FirstOrderIncidentInput, FirstOrderIncidentUpdate,
  FirstOrderOverview,
  FirstOrderReport, FirstOrderReportSnapshot,
} from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE } from './client'
import { authHeader, redirectToLogin } from '../auth'

export const FIRST_ORDER_HTTP = API_MODE === 'http'
const PREFIX = '/partner/first-order'

function responseError(status: number, code?: string): Error {
  if (code === 'FIRST_ORDER_PROJECT_DATES_LOCKED') return new Error('项目已有设备登记，历史服务日期不能修改；续期请新建项目。')
  if (code === 'FIRST_ORDER_BINDING_UNVERIFIED') return new Error('设备归属变化尚未完成登记核对，请联系平台核验后再生成报告。')
  if (code === 'FIRST_ORDER_LIMIT' || code === 'FIRST_ORDER_REPORT_LIMIT') return new Error('数据量超出本次计算范围，请联系平台分批核对，不显示截断结果。')
  if (code === 'FIRST_ORDER_DEPLOYMENT_INVALID') return new Error('请核对项目是否在服务期内，并填写实际安装位置。')
  if (code === 'FIRST_ORDER_MONTH_FUTURE') return new Error('所选月份尚未开始，请选择当前或过去的月份。')
  if (code === 'FIRST_ORDER_NO_COVERAGE') return new Error('这个月还没有经过核验的设备部署记录，不能生成报告。')
  if (code === 'FIRST_ORDER_MONTH_OPEN') return new Error('本月尚未结束，可以先预览，结束后再生成月报。')
  if (status === 401) return new Error('登录已过期，请重新登录。')
  if (status === 403) return new Error('当前账号没有这项操作的权限。')
  if (status === 404) return new Error('记录不存在或已不在当前机构的范围内，请刷新后重试。')
  if (status === 409) return new Error('记录已发生变化或这次操作已提交，请刷新核对后重试。')
  if (status === 400 || status === 422) return new Error('提交内容或统计月份不符合要求，请核对后重试。')
  if (status === 429) return new Error('操作较频繁，请稍后重试。')
  return new Error('服务暂时不可用，请稍后重试。')
}

async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal, asBlob = false): Promise<T> {
  if (!FIRST_ORDER_HTTP) throw new Error('项目交付与服务需要连接真实后端，当前预览模式不可操作。')
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 20000)
  try {
    const response = await fetch(`${API_BASE_URL}${PREFIX}${path}`, {
      method, credentials: 'include', signal: controller.signal,
      headers: { Accept: asBlob ? 'text/csv' : 'application/json', ...authHeader(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) {
      let code: string | undefined
      try { code = ((await response.json()) as { error?: { code?: string } }).error?.code } catch { /* status fallback */ }
      if (response.status === 401) redirectToLogin()
      throw responseError(response.status, code)
    }
    if (asBlob) return await response.blob() as T
    try { return await response.json() as T } catch { throw new Error('服务返回的内容不完整，请刷新重试。') }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('请求已超时或取消，请刷新核对后重试。')
    if (error instanceof TypeError) throw new Error('网络连接失败，请检查网络后重试。')
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

export const firstOrderApi = {
  overview: (signal?: AbortSignal) => request<FirstOrderOverview>('/overview', 'GET', undefined, signal),

  createIncident: (input: FirstOrderIncidentInput) => request<FirstOrderIncident>('/incidents', 'POST', input),
  updateIncident: (id: string, input: FirstOrderIncidentUpdate) => request<FirstOrderIncident>(`/incidents/${encodeURIComponent(id)}`, 'PATCH', input),
  preview: (projectId: string, month: string, signal?: AbortSignal) => request<FirstOrderReportSnapshot>(`/projects/${encodeURIComponent(projectId)}/report-preview?month=${encodeURIComponent(month)}`, 'GET', undefined, signal),
  seal: (projectId: string, month: string) => request<FirstOrderReport>(`/projects/${encodeURIComponent(projectId)}/reports`, 'POST', { month }),
  report: (id: string, signal?: AbortSignal) => request<FirstOrderReport>(`/reports/${encodeURIComponent(id)}`, 'GET', undefined, signal),
  acknowledge: (id: string) => request<FirstOrderReport>(`/reports/${encodeURIComponent(id)}/acknowledge`, 'POST', {}),
  async downloadReport(id: string, month: string): Promise<void> {
    const blob = await request<Blob>(`/reports/${encodeURIComponent(id)}/csv`, 'GET', undefined, undefined, true)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `服务月报-${month.replace(/[^0-9-]/g, '')}-${id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)}.csv`
    try { document.body.appendChild(link); link.click() } finally { link.remove(); URL.revokeObjectURL(url) }
  },
}
