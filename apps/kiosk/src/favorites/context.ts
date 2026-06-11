import { createContext } from 'react'
import type { FavoriteTargetType } from '@ai-job-print/shared'

/**
 * 收藏上下文（Phase C-2C job → C-2D 扩展到 岗位/招聘会/政策 三类）。
 *
 * 登录态门控：
 * - 登录会员：收藏的 SSOT 为服务端 /me/favorites，toggle 写后端。
 * - 未登录 / 匿名：保留本机 localStorage 收藏体验，toggle 写本机，并提示「登录后可同步到账号」。
 *
 * 「合并到账号」：登录后由用户显式触发 mergeLocalToAccount（幂等：服务端 upsert 去重，
 * 不覆盖服务端已有收藏；合并成功的本机记录被清除，失败的保留）。
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
  /** 切换收藏（登录→后端，匿名→本机 + 同步提示）。 */
  toggle: (item: FavoriteToggleItem) => void
  /** 登录态首次拉取服务端收藏是否进行中。 */
  loading: boolean
  /** 当前收藏来源：登录会员=server，匿名=local。 */
  source: 'local' | 'server'
  /** 本机待合并收藏数（登录态下提示「合并到账号」用；匿名恒为 0）。 */
  localPendingCount: number
  /** 显式把本机收藏合并到账号（幂等去重，不覆盖服务端收藏）。返回成功合并条数。 */
  mergeLocalToAccount: () => Promise<{ merged: number; failed: number }>
}

export const FavoritesContext = createContext<FavoritesContextValue | null>(null)
