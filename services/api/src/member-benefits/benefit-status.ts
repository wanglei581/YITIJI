import type { BenefitStatus } from './member-benefits.types'

/**
 * 有效期派生状态（不伪造能力，CLAUDE.md §9）。
 *
 * 背景：BenefitGrant.status 是**存量字段**，全仓只有三处会写：
 *   - benefit-redemption.service.ts → 'used_up'（额度扣完）
 *   - admin-member-benefits.service.ts → 'revoked'（管理员撤销）
 *   - benefit-activities / admin grant → 'active'（发放）
 * **没有任何代码路径会把 status 写成 'expired'**，也没有到期扫描任务。
 * 于是一张 validUntil 已过的券会永远以 status='active' 存在库里。
 *
 * 而核销侧 benefit-redemption.service.ts 是**按 validUntil 实时判定**的：
 *   if (grant.validUntil && grant.validUntil.getTime() < now.getTime())
 *       → ConflictException BENEFIT_EXPIRED（"权益已过期"）
 *
 * 两边不一致的后果：用户在「我的权益」看到"可用"，点核销却被拒。
 * 本函数把读取侧对齐到核销侧，**判定谓词与上面那行严格一致**（strict `<`），
 * 保证"页面显示可用" ⇔ "核销不会因过期被拒"。
 *
 * 只派生、不落库：与核销侧一样按请求时刻实时计算。这样无需迁移 / 定时任务，
 * 且天然幂等；服务端时钟是唯一权威时钟（一体机本地时钟可能漂移，不能用于判定）。
 *
 * 只收敛 'active'：used_up / revoked / expired 是终态，原样返回。
 */
export function deriveBenefitStatus(
  storedStatus: BenefitStatus,
  validUntil: Date | null,
  now: Date = new Date(),
): BenefitStatus {
  if (storedStatus !== 'active') return storedStatus
  if (validUntil && validUntil.getTime() < now.getTime()) return 'expired'
  return storedStatus
}
