// 本机构官方渠道（next-tasks 3.14，一体机侧）：GET /terminals/:terminalId/official-channels。
//
// 终端鉴权，与 terminalConfig.ts 走同一个 terminalProtectedFetch。服务端只按终端身份取数：
//   items            本终端所属机构已启用的官方渠道；终端没绑机构时为空。
//   legacyPlatforms  只在招聘内容托管打开（客户私有化部署 b）时有内容：原线上平台目录。
// 一体机不打开外部网页，url 只用来生成二维码；不是 http(s) 的条目整条丢掉，不生成二维码。
//
// 缓存与 getCachedKioskTerminalConfig 同一形态：30 秒内存缓存 + 同一终端的在途请求合并。
// 失败不进缓存，重试一定会重新请求。

import { isValidSourceUrl } from '../../lib/url'
import { terminalProtectedFetch } from '../terminalAuth'
import { API_BASE_URL, API_MODE } from './client'
import { ApiHttpError } from './httpAdapter'

/**
 * 一条渠道。镜像 packages/shared 的 `OfficialChannelPublicItem`：3.14 后端并入后，
 * 这里与下面的响应类型都改为从 `@ai-job-print/shared` 引用 `OfficialChannelPublicResponse`，不再本地定义。
 */
export interface OfficialChannelItem {
  name: string
  url: string
  displayOrder: number
  organizationName: string
}

/** 镜像 packages/shared 的 `OfficialChannelPublicResponse`（3.14 并入后改为 import）。 */
export interface OfficialChannelsResponse {
  items: OfficialChannelItem[]
  legacyPlatforms: OfficialChannelItem[]
}

export function emptyOfficialChannels(): OfficialChannelsResponse {
  return { items: [], legacyPlatforms: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 名称、机构名缺一不收；链接不是 http(s) 不收（不给 javascript: 之类生成二维码）。 */
function channelOf(value: unknown): OfficialChannelItem | null {
  if (!isRecord(value)) return null
  const name = text(value['name'])
  const url = text(value['url'])
  const organizationName = text(value['organizationName'])
  if (!name || !organizationName || !isValidSourceUrl(url)) return null
  const order = value['displayOrder']
  const displayOrder = typeof order === 'number' && Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER
  return { name, url, displayOrder, organizationName }
}

function channelsOf(value: unknown[]): OfficialChannelItem[] {
  return value
    .map(channelOf)
    .filter((item): item is OfficialChannelItem => item !== null)
    .sort((a, b) => a.displayOrder - b.displayOrder)
}

/**
 * 同时认裸对象与 `{ success: true, data }` 信封：终端配置接口是裸对象，服务端统一信封也常见，
 * 两种都按同一份字段读。`items` 不是数组即视为响应畸形（进 error，不当成「没有渠道」）；
 * `legacyPlatforms` 缺失或畸形按空处理——它只影响 b 版本的附加一段，宁可不显示。
 */
export function parseOfficialChannels(body: unknown): OfficialChannelsResponse {
  const data = isRecord(body) && body['success'] === true && 'data' in body ? body['data'] : body
  if (!isRecord(data) || !Array.isArray(data['items'])) {
    throw new Error('official channels response is malformed')
  }
  const legacy = data['legacyPlatforms']
  return {
    items: channelsOf(data['items']),
    legacyPlatforms: Array.isArray(legacy) ? channelsOf(legacy) : [],
  }
}

export async function getOfficialChannels(terminalId: string): Promise<OfficialChannelsResponse> {
  // 本地 mock 模式没有后端：按「没有渠道」处理，不编渠道。
  if (API_MODE !== 'http') return emptyOfficialChannels()
  if (!terminalId.trim()) throw new Error('getOfficialChannels failed: missing terminal id')

  const url = new URL(
    `${API_BASE_URL}/terminals/${encodeURIComponent(terminalId)}/official-channels`,
    window.location.origin,
  )
  const res = await terminalProtectedFetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  })
  if (!res.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = `请求失败（${res.status}）`
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch {
      /* non-JSON */
    }
    throw new ApiHttpError(code, message, res.status)
  }
  return parseOfficialChannels(await res.json())
}

const DEFAULT_CACHE_TTL_MS = 30_000
let cachedTerminalId: string | null = null
let cachedChannels: OfficialChannelsResponse | null = null
let cachedAt = 0
let inflightTerminalId: string | null = null
let inflight: Promise<OfficialChannelsResponse> | null = null

/** 同步读取仍在有效期内的缓存；没有就返回 null，不发请求。 */
export function peekCachedOfficialChannels(
  terminalId: string,
  maxAgeMs = DEFAULT_CACHE_TTL_MS,
): OfficialChannelsResponse | null {
  if (!cachedChannels || cachedTerminalId !== terminalId) return null
  return Date.now() - cachedAt <= maxAgeMs ? cachedChannels : null
}

export async function getCachedOfficialChannels(
  terminalId: string,
  maxAgeMs = DEFAULT_CACHE_TTL_MS,
): Promise<OfficialChannelsResponse> {
  const fresh = peekCachedOfficialChannels(terminalId, maxAgeMs)
  if (fresh) return fresh
  if (inflight && inflightTerminalId === terminalId) return inflight

  const request: Promise<OfficialChannelsResponse> = getOfficialChannels(terminalId)
    .then((channels) => {
      cachedTerminalId = terminalId
      cachedChannels = channels
      cachedAt = Date.now()
      return channels
    })
    .finally(() => {
      // 只清自己：请求在途时换了终端，新终端的那一单已经占了这个位置。
      if (inflight !== request) return
      inflight = null
      inflightTerminalId = null
    })
  inflight = request
  inflightTerminalId = terminalId
  return request
}
