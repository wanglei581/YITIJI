// ============================================================
// 会员收藏 + 权益 API（Phase C-2C）
//
// 调用真实后端 /api/v1/me/favorites/* 与 /api/v1/me/benefits（受 EndUserAuthGuard 保护，需会员 token）。
// - token 由调用方显式传入（来自 AuthContext 内存态 getToken()），不从任何存储读取。
// - 后端响应 envelope：{ success, data }，call<T> 解包后返回 T。
// - 这些接口只对登录会员有意义；mock 模式（无真实会员会话）直接返回空列表 / no-op，避免无效请求。
//
// 合规（CLAUDE.md §10）：收藏只记录浏览 / 收藏行为，绝不记录投递结果 / 候选人数据；
// 权益为只读底座，本阶段不接发放 / 核销真实逻辑、不接支付。
// ============================================================

import type {
  AddFavoriteInput,
  MemberBenefitItem,
  MemberFavoriteItem,
  FavoriteTargetType,
  MemberRedemptionItem,
} from '@ai-job-print/shared'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { API_BASE_URL, API_MODE } from './client'

export class MemberFavoritesApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'MemberFavoritesApiError'
  }
}

interface Envelope<T> {
  success: boolean
  data: T
}

async function request<T>(
  path: string,
  token: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      credentials: 'include',
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
  } catch {
    throw new MemberFavoritesApiError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }
  if (!res.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = `请求失败（${res.status}）`
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch {
      /* keep defaults */
    }
    if (isMemberSessionInvalidError(res.status, code, true)) notifyMemberSessionExpired(token)
    throw new MemberFavoritesApiError(code, message, res.status)
  }
  const json = (await res.json()) as Envelope<T>
  return json.data
}

// ── 收藏 ─────────────────────────────────────────────────────

/** 我的收藏（本人，可选按类型过滤；游标分页，pageSize 封顶 50）。未登录 / mock 模式返回空页。 */
export function getMyFavorites(
  token: string | null | undefined,
  type?: FavoriteTargetType,
  opts?: { cursor?: string | null; pageSize?: number },
): Promise<{ items: MemberFavoriteItem[]; nextCursor: string | null; total: number }> {
  if (API_MODE !== 'http' || !token) return Promise.resolve({ items: [], nextCursor: null, total: 0 })
  const params = new URLSearchParams()
  if (type) params.set('type', type)
  if (opts?.cursor) params.set('cursor', opts.cursor)
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize))
  const q = params.toString()
  return request<{ items: MemberFavoriteItem[]; nextCursor: string | null; total: number }>(
    `/me/favorites${q ? `?${q}` : ''}`,
    token,
  )
}

/**
 * 拉取全部收藏（FavoritesProvider 需要完整 id 集合判断「已收藏」状态）。
 * 逐页拉取（每页 50），硬上限 10 页 / 500 条防失控——超出部分不再拉取（只影响
 * 心形按钮回显，不影响资产中心分页列表的完整浏览）。
 */
export async function getAllMyFavorites(
  token: string | null | undefined,
  type?: FavoriteTargetType,
): Promise<MemberFavoriteItem[]> {
  if (API_MODE !== 'http' || !token) return []
  const all: MemberFavoriteItem[] = []
  let cursor: string | null = null
  for (let i = 0; i < 10; i += 1) {
    const page = await getMyFavorites(token, type, { cursor, pageSize: 50 })
    all.push(...page.items)
    if (!page.nextCursor) break
    cursor = page.nextCursor
  }
  return all
}

/** 新增收藏（幂等）。未登录 / mock 模式 no-op（返回 null）。 */
export function addFavorite(
  token: string | null | undefined,
  input: AddFavoriteInput,
): Promise<MemberFavoriteItem | null> {
  if (API_MODE !== 'http' || !token) return Promise.resolve(null)
  return request<MemberFavoriteItem>('/me/favorites', token, { method: 'POST', body: input })
}

/** 取消收藏（幂等）。未登录 / mock 模式 no-op。 */
export function removeFavorite(
  token: string | null | undefined,
  targetType: FavoriteTargetType,
  targetId: string,
): Promise<{ removed: boolean }> {
  if (API_MODE !== 'http' || !token) return Promise.resolve({ removed: false })
  return request<{ removed: boolean }>(
    `/me/favorites/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`,
    token,
    { method: 'DELETE' },
  )
}

// ── 权益（只读）─────────────────────────────────────────────

/** 我的权益（本人，只读；游标分页，pageSize 封顶 50）。未登录 / mock 模式返回空页。 */
export function getMyBenefits(
  token: string | null | undefined,
  opts?: { cursor?: string | null; pageSize?: number },
): Promise<{ items: MemberBenefitItem[]; nextCursor: string | null; total: number }> {
  if (API_MODE !== 'http' || !token) return Promise.resolve({ items: [], nextCursor: null, total: 0 })
  const params = new URLSearchParams()
  if (opts?.cursor) params.set('cursor', opts.cursor)
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize))
  const q = params.toString()
  return request<{ items: MemberBenefitItem[]; nextCursor: string | null; total: number }>(
    `/me/benefits${q ? `?${q}` : ''}`,
    token,
  )
}

/**
 * 我的核销记录（Wave 3；本人，只读；游标分页，pageSize 封顶 50）。
 * 未登录 / mock 模式返回空页，不发真实请求。
 * GET /api/v1/me/benefits/redemptions
 */
export function getMyRedemptions(
  token: string | null | undefined,
  opts?: { cursor?: string | null; pageSize?: number },
): Promise<{ items: MemberRedemptionItem[]; nextCursor: string | null; total: number }> {
  if (API_MODE !== 'http' || !token) return Promise.resolve({ items: [], nextCursor: null, total: 0 })
  const params = new URLSearchParams()
  if (opts?.cursor) params.set('cursor', opts.cursor)
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize))
  const q = params.toString()
  return request<{ items: MemberRedemptionItem[]; nextCursor: string | null; total: number }>(
    `/me/benefits/redemptions${q ? `?${q}` : ''}`,
    token,
  )
}
