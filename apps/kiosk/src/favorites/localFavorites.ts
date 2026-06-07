// ============================================================
// localFavorites — 匿名/未登录态的岗位收藏（纯本机 localStorage）
//
// 合规：收藏仅记录岗位 id 到本机 localStorage，用于「我感兴趣的岗位」浏览，
// 绝不上传简历、不形成投递/招聘闭环，不与任何企业端数据关联。
//
// 登录会员的收藏走服务端 /me/favorites（见 FavoritesProvider）；本文件只服务
// 未登录/匿名态，保留既有本机收藏体验。沿用既有 STORAGE_KEY，历史本机收藏不丢失。
// ============================================================

const STORAGE_KEY = 'kiosk:jobFavorites:v1'

/** 读取本机收藏的岗位 id 列表（容错：非数组/解析失败返回 []）。 */
export function readLocalJobFavorites(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function write(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // localStorage 不可用（隐私模式 / 配额）时静默降级，仅本次内存生效
  }
}

/** 切换本机收藏，返回切换后的最新 id 列表。 */
export function toggleLocalJobFavorite(id: string): string[] {
  const cur = readLocalJobFavorites()
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
  write(next)
  return next
}
