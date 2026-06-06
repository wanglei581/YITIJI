// ============================================================
// 待机宣传屏 Admin Service
//
// API_MODE=http → 真实后端 /admin/ad-assets|ad-playlists|... (返回裸数据)
// API_MODE=mock → 内存 mock(无后端也能走通 UI:上传/排序/配置都在内存生效)
// ============================================================

import type {
  AdAssetView,
  AdPlaylistView,
  AiPosterStatusView,
  SaveAdPlaylistInput,
  SaveScreensaverConfigInput,
  ScreensaverTerminalView,
  TerminalScreensaverConfigView,
} from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export type {
  AdAssetView,
  AdPlaylistView,
  AiPosterStatusView,
  SaveAdPlaylistInput,
  SaveScreensaverConfigInput,
  ScreensaverTerminalView,
  TerminalScreensaverConfigView,
}

export interface ScreensaverServiceInterface {
  listAssets(): Promise<AdAssetView[]>
  uploadAsset(file: File, title: string, durationSec?: number): Promise<AdAssetView>
  createExternalVideo(url: string, title: string, durationSec?: number): Promise<AdAssetView>
  updateAsset(id: string, patch: { title?: string; durationSec?: number; status?: 'active' | 'disabled' }): Promise<AdAssetView>
  deleteAsset(id: string): Promise<AdAssetView>

  listPlaylists(): Promise<AdPlaylistView[]>
  createPlaylist(input: SaveAdPlaylistInput): Promise<AdPlaylistView>
  updatePlaylist(id: string, input: SaveAdPlaylistInput): Promise<AdPlaylistView>
  deletePlaylist(id: string): Promise<void>

  listTerminals(): Promise<ScreensaverTerminalView[]>
  saveConfig(terminalId: string, input: SaveScreensaverConfigInput): Promise<TerminalScreensaverConfigView>

  aiPosterStatus(): Promise<AiPosterStatusView>
}

// ─── HTTP adapter ─────────────────────────────────────────────────────────────

function handleAuthFailure(status: number, code: string): void {
  if (status === 401) {
    redirectToLogin()
    throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', status)
  }
}

async function parseError(res: Response): Promise<never> {
  let code = `HTTP_${res.status}`
  let message = res.statusText
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } }
    if (body.error?.code) code = body.error.code
    if (body.error?.message) message = body.error.message
  } catch {
    /* keep defaults */
  }
  handleAuthFailure(res.status, code)
  throw new ApiHttpError(code, message, res.status)
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) await parseError(res)
  return res.json() as Promise<T>
}

const httpAdapter: ScreensaverServiceInterface = {
  listAssets: () => req<AdAssetView[]>('GET', '/admin/ad-assets'),
  async uploadAsset(file, title, durationSec) {
    const form = new FormData()
    form.append('file', file)
    form.append('title', title)
    if (durationSec !== undefined) form.append('durationSec', String(durationSec))
    // multipart:不要手动设 Content-Type,浏览器自动带 boundary
    const res = await fetch(`${API_BASE_URL}/admin/ad-assets`, {
      method: 'POST',
      headers: { ...authHeader() },
      credentials: 'include',
      body: form,
    })
    if (!res.ok) await parseError(res)
    return res.json() as Promise<AdAssetView>
  },
  createExternalVideo: (url, title, durationSec) =>
    req<AdAssetView>('POST', '/admin/ad-assets/external-video', { url, title, durationSec }),
  updateAsset: (id, patch) => req<AdAssetView>('PATCH', `/admin/ad-assets/${id}`, patch),
  deleteAsset: (id) => req<AdAssetView>('DELETE', `/admin/ad-assets/${id}`),

  listPlaylists: () => req<AdPlaylistView[]>('GET', '/admin/ad-playlists'),
  createPlaylist: (input) => req<AdPlaylistView>('POST', '/admin/ad-playlists', input),
  updatePlaylist: (id, input) => req<AdPlaylistView>('PUT', `/admin/ad-playlists/${id}`, input),
  async deletePlaylist(id) {
    await req<{ success: boolean }>('DELETE', `/admin/ad-playlists/${id}`)
  },

  listTerminals: () => req<ScreensaverTerminalView[]>('GET', '/admin/screensaver/terminals'),
  saveConfig: (terminalId, input) =>
    req<TerminalScreensaverConfigView>('PUT', `/admin/terminals/${terminalId}/screensaver-config`, input),

  aiPosterStatus: () => req<AiPosterStatusView>('GET', '/admin/ai-posters/status'),
}

// ─── 内存 Mock adapter(无后端也能演示完整 UI)──────────────────────────────

const DEMO_PREVIEW = (label: string, color: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='420'><rect width='100%' height='100%' fill='${color}'/><text x='50%' y='50%' fill='white' font-size='20' font-family='sans-serif' text-anchor='middle' dominant-baseline='middle'>${label}</text></svg>`,
  )}`

const mockAssets: AdAssetView[] = [
  {
    id: 'demo-asset-1', type: 'image', title: '就业服务宣传海报', mimeType: 'image/png',
    sizeBytes: 245_000, sha256: 'demo1', width: 1080, height: 1920, durationSec: 8,
    source: 'uploaded', externalUrl: null, status: 'active', createdAt: new Date(0).toISOString(),
    previewUrl: DEMO_PREVIEW('海报 1', '#2563eb'),
  },
  {
    id: 'demo-asset-2', type: 'image', title: '校企合作展宣传', mimeType: 'image/png',
    sizeBytes: 318_000, sha256: 'demo2', width: 1080, height: 1920, durationSec: 10,
    source: 'uploaded', externalUrl: null, status: 'active', createdAt: new Date(0).toISOString(),
    previewUrl: DEMO_PREVIEW('海报 2', '#0891b2'),
  },
]
let mockPlaylists: AdPlaylistView[] = []
const mockTerminals: ScreensaverTerminalView[] = [
  { terminalId: 'KIOSK-DEMO-01', terminalCode: 'KIOSK-DEMO-01', isOnline: true, config: null },
]

function genId(prefix: string): string {
  // mock-only:用计数器派生稳定 id(避免 Date.now/Math.random,便于复现)
  mockCounter += 1
  return `${prefix}-${mockCounter}`
}
let mockCounter = 0

const mockAdapter: ScreensaverServiceInterface = {
  async listAssets() {
    return mockAssets.filter((a) => a.status !== undefined)
  },
  async uploadAsset(file, title, durationSec) {
    const isVideo = file.type.startsWith('video/')
    const asset: AdAssetView = {
      id: genId('asset'), type: isVideo ? 'video' : 'image', title,
      mimeType: file.type || 'image/png', sizeBytes: file.size, sha256: genId('sha'),
      width: null, height: null, durationSec: durationSec ?? (isVideo ? 15 : 8),
      source: 'uploaded', externalUrl: null, status: 'active', createdAt: new Date(0).toISOString(),
      previewUrl: isVideo ? DEMO_PREVIEW('视频', '#7c3aed') : DEMO_PREVIEW(title.slice(0, 6) || '海报', '#2563eb'),
    }
    mockAssets.unshift(asset)
    return asset
  },
  async createExternalVideo(url, title, durationSec) {
    const isWebm = url.toLowerCase().includes('.webm')
    const asset: AdAssetView = {
      id: genId('asset'), type: 'video', title,
      mimeType: isWebm ? 'video/webm' : 'video/mp4', sizeBytes: 0, sha256: genId('sha'),
      width: null, height: null, durationSec: durationSec ?? 15,
      source: 'external_url', externalUrl: url, status: 'active', createdAt: new Date(0).toISOString(),
      previewUrl: DEMO_PREVIEW('外链视频', '#7c3aed'),
    }
    mockAssets.unshift(asset)
    return asset
  },
  async updateAsset(id, patch) {
    const a = mockAssets.find((x) => x.id === id)
    if (!a) throw new ApiHttpError('AD_ASSET_NOT_FOUND', '素材不存在', 404)
    if (patch.title !== undefined) a.title = patch.title
    if (patch.durationSec !== undefined) a.durationSec = patch.durationSec
    if (patch.status !== undefined) a.status = patch.status
    return a
  },
  async deleteAsset(id) {
    const i = mockAssets.findIndex((x) => x.id === id)
    if (i < 0) throw new ApiHttpError('AD_ASSET_NOT_FOUND', '素材不存在', 404)
    const [removed] = mockAssets.splice(i, 1)
    return { ...removed!, status: 'disabled' }
  },

  async listPlaylists() {
    return mockPlaylists
  },
  async createPlaylist(input) {
    const pl = buildMockPlaylist(genId('playlist'), input)
    mockPlaylists.unshift(pl)
    return pl
  },
  async updatePlaylist(id, input) {
    const idx = mockPlaylists.findIndex((p) => p.id === id)
    if (idx < 0) throw new ApiHttpError('AD_PLAYLIST_NOT_FOUND', '方案不存在', 404)
    const pl = buildMockPlaylist(id, input)
    mockPlaylists[idx] = pl
    return pl
  },
  async deletePlaylist(id) {
    mockPlaylists = mockPlaylists.filter((p) => p.id !== id)
    mockTerminals.forEach((t) => {
      if (t.config?.playlistId === id) t.config = { ...t.config, playlistId: null, playlistName: null, enabled: false }
    })
  },

  async listTerminals() {
    return mockTerminals
  },
  async saveConfig(terminalId, input) {
    const t = mockTerminals.find((x) => x.terminalId === terminalId)
    const playlistName = mockPlaylists.find((p) => p.id === input.playlistId)?.name ?? null
    const enabled = input.enabled && !!input.playlistId
    const config: TerminalScreensaverConfigView = {
      terminalId, enabled, idleTimeoutSec: input.idleTimeoutSec,
      playlistId: input.playlistId, playlistName, updatedAt: new Date(0).toISOString(),
    }
    if (t) t.config = config
    return config
  },

  async aiPosterStatus() {
    return { enabled: false, provider: 'disabled', dailyLimit: null }
  },
}

function buildMockPlaylist(id: string, input: SaveAdPlaylistInput): AdPlaylistView {
  const items = input.items.map((it, i) => {
    const asset = mockAssets.find((a) => a.id === it.assetId)!
    return { id: `${id}-item-${i}`, assetId: it.assetId, order: it.order, enabled: it.enabled ?? true, asset }
  })
  return {
    id, name: input.name, status: input.status ?? 'active', itemCount: items.length,
    items, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  }
}

// ─── 导出 ────────────────────────────────────────────────────────────────────

const adapter: ScreensaverServiceInterface = API_MODE === 'http' ? httpAdapter : mockAdapter

export const screensaverService = adapter
