import { createContext } from 'react'

/**
 * 岗位收藏上下文（Phase C-2C follow-up）。
 *
 * 登录态门控：
 * - 登录会员：收藏的 SSOT 为服务端 /me/favorites（targetType='job'），toggle 写后端。
 * - 未登录 / 匿名：保留本机 localStorage 收藏体验，toggle 写本机，并提示「登录后可同步到账号」。
 *
 * 合规：收藏只记录「浏览 / 收藏」行为，绝不记录投递结果 / 候选人数据，不形成招聘闭环。
 * 此文件只导出类型与 Context 对象（满足 react-refresh/only-export-components）。
 */

/** toggle 入参：岗位 id + 可选展示标题快照（仅展示用，登录态作为收藏标题写入后端）。 */
export interface FavoriteToggleItem {
  id: string
  title?: string
}

export interface FavoritesContextValue {
  /** 当前已收藏的岗位 id 集合（响应式）。 */
  ids: Set<string>
  /** 是否已收藏某岗位。 */
  isFavorite: (id: string) => boolean
  /** 切换收藏（登录→后端，匿名→本机 + 同步提示）。 */
  toggle: (item: FavoriteToggleItem) => void
  /** 登录态首次拉取服务端收藏是否进行中。 */
  loading: boolean
  /** 当前收藏来源：登录会员=server，匿名=local。 */
  source: 'local' | 'server'
}

export const FavoritesContext = createContext<FavoritesContextValue | null>(null)
