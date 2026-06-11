// ============================================================
// localFavorites — 匿名/未登录态的收藏（纯本机 localStorage，C-2D 扩展到三类）
//
// 合规：收藏仅记录 岗位 / 招聘会 / 政策 的 id 到本机 localStorage，用于「我感兴趣」浏览，
// 绝不上传简历、不形成投递/招聘闭环，不与任何企业端数据关联。
//
// 登录会员的收藏走服务端 /me/favorites（见 FavoritesProvider）；本文件只服务
// 未登录/匿名态。job 沿用既有 STORAGE_KEY，历史本机收藏不丢失。
//
// 「合并到账号」：登录后由用户在「我的收藏」显式触发（幂等，不覆盖服务端收藏），
// 合并成功后清空对应本机记录；不自动合并、不静默上传。
// ============================================================

import type { FavoriteTargetType } from '@ai-job-print/shared'

const STORAGE_KEYS: Record<FavoriteTargetType, string> = {
  job: 'kiosk:jobFavorites:v1', // 沿用历史 key，既有本机收藏不丢
  job_fair: 'kiosk:fairFavorites:v1',
  policy: 'kiosk:policyFavorites:v1',
}

export const FAVORITE_TYPES: FavoriteTargetType[] = ['job', 'job_fair', 'policy']

/** 读取某类本机收藏的 id 列表（容错：非数组/解析失败返回 []）。 */
export function readLocalFavorites(type: FavoriteTargetType): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS[type])
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function write(type: FavoriteTargetType, ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS[type], JSON.stringify(ids))
  } catch {
    // localStorage 不可用（隐私模式 / 配额）时静默降级，仅本次内存生效
  }
}

/** 切换某类本机收藏，返回切换后的最新 id 列表。 */
export function toggleLocalFavorite(type: FavoriteTargetType, id: string): string[] {
  const cur = readLocalFavorites(type)
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
  write(type, next)
  return next
}

/** 读取全部本机收藏（合并到账号用）。 */
export function readAllLocalFavorites(): Array<{ type: FavoriteTargetType; id: string }> {
  return FAVORITE_TYPES.flatMap((type) => readLocalFavorites(type).map((id) => ({ type, id })))
}

/** 清除已成功合并的本机收藏（仅清除指定项，未合并成功的保留）。 */
export function removeLocalFavorites(merged: Array<{ type: FavoriteTargetType; id: string }>): void {
  for (const type of FAVORITE_TYPES) {
    const ids = new Set(merged.filter((m) => m.type === type).map((m) => m.id))
    if (ids.size === 0) continue
    write(type, readLocalFavorites(type).filter((x) => !ids.has(x)))
  }
}
