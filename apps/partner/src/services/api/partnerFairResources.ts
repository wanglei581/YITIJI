import type { FairVenueGuideDTO, SaveFairVenueGuideInput } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE, ApiHttpError, resolveApiUrl } from './client'
import { authHeader, redirectToLogin } from '../auth'

export interface PartnerFairZone { id: string; name: string; category: string | null; city: string | null; description: string | null; sortOrder: number }
export interface PartnerFairMaterial { id: string; name: string; type: string; description?: string; pageCount: number; fileSizeKB: number; allowPrint: boolean; publishStatus: string }
export interface SavePartnerFairZoneInput { name: string; category?: string; city?: string; description?: string; sortOrder?: number }
export interface UpdatePartnerFairMaterialInput { name?: string; type?: string; description?: string; pageCount?: number; allowPrint?: boolean }

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData
  const response = await fetch(method === 'GET' ? resolveApiUrl(path) : `${API_BASE_URL}${path}`, {
    method, credentials: 'include',
    headers: { Accept: 'application/json', ...(isForm || body === undefined ? {} : { 'Content-Type': 'application/json' }), ...authHeader() },
    ...(body === undefined ? {} : { body: isForm ? body : JSON.stringify(body) }),
  })
  if (!response.ok) {
    let code = `HTTP_${response.status}`, message = response.statusText
    try { const parsed = await response.json() as { error?: { code?: string; message?: string } }; code = parsed.error?.code ?? code; message = parsed.error?.message ?? message } catch { /* HTTP fallback */ }
    if (response.status === 401) redirectToLogin()
    throw new ApiHttpError(code, message, response.status)
  }
  return response.json() as Promise<T>
}

function path(fairId: string, suffix: string): string { return `/partner/fairs/${encodeURIComponent(fairId)}${suffix}` }
const http = {
  getZones: async (fairId: string) => (await request<{ data: PartnerFairZone[] }>('GET', path(fairId, '/zones'))).data,
  createZone: (fairId: string, input: SavePartnerFairZoneInput) => request<PartnerFairZone>('POST', path(fairId, '/zones'), input),
  updateZone: (fairId: string, zoneId: string, input: SavePartnerFairZoneInput) => request<PartnerFairZone>('PATCH', path(fairId, `/zones/${encodeURIComponent(zoneId)}`), input),
  deleteZone: async (fairId: string, zoneId: string) => { await request('DELETE', path(fairId, `/zones/${encodeURIComponent(zoneId)}`)) },
  getMaterials: async (fairId: string) => (await request<{ data: PartnerFairMaterial[] }>('GET', path(fairId, '/materials'))).data,
  uploadMaterial: async (fairId: string, file: File, input: { name: string; type?: string; description?: string; pageCount?: number }) => {
    const form = new FormData(); form.append('file', file); form.append('name', input.name)
    if (input.type) form.append('type', input.type); if (input.description) form.append('description', input.description); if (input.pageCount !== undefined) form.append('pageCount', String(input.pageCount))
    return request<PartnerFairMaterial>('POST', path(fairId, '/materials'), form)
  },
  updateMaterial: (fairId: string, materialId: string, input: UpdatePartnerFairMaterialInput) => request<PartnerFairMaterial>('PATCH', path(fairId, `/materials/${encodeURIComponent(materialId)}`), input),
  deleteMaterial: async (fairId: string, materialId: string) => { await request('DELETE', path(fairId, `/materials/${encodeURIComponent(materialId)}`)) },
  getVenueGuide: async (fairId: string) => (await request<{ data: FairVenueGuideDTO | null }>('GET', path(fairId, '/venue-guide'))).data,
  saveVenueGuide: (fairId: string, input: SaveFairVenueGuideInput) => request<FairVenueGuideDTO>('PUT', path(fairId, '/venue-guide'), input),
  deleteVenueGuide: async (fairId: string) => { await request('DELETE', path(fairId, '/venue-guide')) },
}

const unavailable = () => Promise.reject(new ApiHttpError('API_UNAVAILABLE', 'Mock 模式不支持招聘会配置', 503))
const mock = { getZones: unavailable, createZone: unavailable, updateZone: unavailable, deleteZone: unavailable, getMaterials: unavailable, uploadMaterial: unavailable, updateMaterial: unavailable, deleteMaterial: unavailable, getVenueGuide: unavailable, saveVenueGuide: unavailable, deleteVenueGuide: unavailable }
export const partnerFairResources = API_MODE === 'http' ? http : mock
