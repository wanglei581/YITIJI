/**
 * 会员收藏契约本地副本（Phase C-2C）。
 *
 * **契约源**：packages/shared/src/types/memberFavorites.ts
 *
 * 为什么不直接 import @ai-job-print/shared：services/api 走 commonjs + node
 * moduleResolution，而 packages/shared 是 ESM-only、exports 直指 .ts，互操作复杂。
 * decision 是把类型本地副本化、严格遵守 SSOT 注释（见 files/file.types.ts）。
 *
 * 任何字段变更必须同时改两处：
 *   1. packages/shared/src/types/memberFavorites.ts（前端 SSOT）
 *   2. 本文件（后端副本）
 *
 * 合规（CLAUDE.md §10）：收藏只记录浏览 / 收藏行为，绝不记录投递结果 / 候选人数据。
 */

export type FavoriteTargetType = 'job' | 'job_fair' | 'policy'

export interface MemberFavoriteItem {
  id: string
  targetType: FavoriteTargetType
  targetId: string
  title: string | null
  createdAt: string
}

export interface AddFavoriteInput {
  targetType: FavoriteTargetType
  targetId: string
  title?: string
}
