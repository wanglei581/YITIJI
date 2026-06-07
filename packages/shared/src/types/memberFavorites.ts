// ============================================================
// 会员收藏 — 服务端化收藏列表类型（Phase C-2C）
//
// 合规约束（CLAUDE.md §10「系统只记录:浏览/收藏/外部跳转/打印/AI服务调用」）:
// - 收藏只记录"对某个外部来源岗位 / 招聘会 / 政策的兴趣标记",归属于会员本人(endUserId)。
// - 绝不记录投递结果 / 投递状态 / 面试 / Offer / 候选人数据,不形成任何招聘闭环。
// - 跨用户、匿名一律拒绝（后端 EndUserAuthGuard + service 按本人 endUserId 隔离）。
// - 只回最小展示元数据（targetType / targetId / 展示标题快照），不含简历 / PII / 投递信息。
// ============================================================

/** 收藏对象类型：外部来源信息入口的三类对象。 */
export type FavoriteTargetType = 'job' | 'job_fair' | 'policy'

/** 我的收藏：会员名下一条收藏标记（仅展示元数据）。 */
export interface MemberFavoriteItem {
  /** Favorite 行 id */
  id: string
  targetType: FavoriteTargetType
  /** 对应对象 id（Job.id / JobFair.id / 政策条目 id）；可凭此跳转既有详情页 */
  targetId: string
  /** 收藏时的展示标题快照（可空）；用于列表渲染，不依赖来源对象是否仍在架 */
  title: string | null
  createdAt: string
}

/** 新增收藏入参（前端从岗位 / 招聘会 / 政策详情发起）。 */
export interface AddFavoriteInput {
  targetType: FavoriteTargetType
  targetId: string
  /** 展示标题快照（可空，最长 200 字符，仅展示用） */
  title?: string
}
