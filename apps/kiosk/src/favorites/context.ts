import { createContext } from 'react'
import type { FavoriteTargetType } from '@ai-job-print/shared'

/**
 * 收藏上下文（Phase C-2C job → C-2D 扩展到 岗位/招聘会/政策 三类）。
 *
 * 收藏只存进本人账号（2026-11-05 政策最小闭环）：
 * - 登录会员：收藏以服务端 /me/favorites 为准，toggle 写后端。
 * - 未登录：不记本机收藏（localFavorites.ts 停放），toggle 直接去登录，登录后回到原页。
 *
 * 合规：收藏只记录「浏览 / 收藏」行为，绝不记录投递结果 / 候选人数据，不形成招聘闭环。
 * 此文件只导出类型与 Context 对象（满足 react-refresh/only-export-components）。
 */

/** toggle 入参：类型 + id + 可选展示标题快照（仅展示用，登录态作为收藏标题写入后端）。 */
export interface FavoriteToggleItem {
  type: FavoriteTargetType
  id: string
  title?: string
}

export interface FavoritesContextValue {
  /** 是否已收藏某对象。 */
  isFavorite: (type: FavoriteTargetType, id: string) => boolean
  /** 某类已收藏 id 集合（响应式；列表过滤/计数用）。 */
  idsOf: (type: FavoriteTargetType) => Set<string>
  /** 切换收藏（登录→后端；未登录→去登录页，登录后回到原页）。 */
  toggle: (item: FavoriteToggleItem) => void
  /** 取消一条收藏（「我的收藏」用）：成功 true；失败已回滚，返回 false 由页面说明。 */
  unfavorite: (type: FavoriteTargetType, id: string) => Promise<boolean>
  /** 登录态首次拉取服务端收藏是否进行中。 */
  loading: boolean
  /** 登录会员=server；未登录=local（只表示没登录，本机不再记收藏）。 */
  source: 'local' | 'server'
}

export const FavoritesContext = createContext<FavoritesContextValue | null>(null)
