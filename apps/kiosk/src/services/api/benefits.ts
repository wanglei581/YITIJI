// ============================================================
// 打印权益接线（**只读**）— V6 原型 P06 s4「权益与本单价格」卡六态
//
// 读：GET /api/v1/me/benefits
//   复用 memberFavorites.getMyBenefits（同一端点已有实现），本模块**不另起第二个 fetch**，
//   避免 CLAUDE.md §8 禁止的重复入口。本模块只负责「打印域怎么解读这份权益列表」。
//
// ⚠️ 本模块刻意**不提供** POST /orders/:id/redeem 的调用函数。
//
//   服务端现状（origin/main，已逐行核对）：
//     benefit-redemption.service.ts:153  discountCents: order.amountCents
//     order-status.service.ts:298/312    要求 discountCents >= 应付；落库 discountCents = 应付
//   即**核销 = 整单免**：抵扣额恒等于订单应付金额，不看券面值、不看品类、不看色彩、
//   不看计费页上限、不看退款后是否恢复。在这些规则落地前把「使用权益」CTA 接上，
//   一张小额券可以免掉任意金额的整单 —— 直接资损。
//
//   这与服务端自己的口径一致：order-redeem.controller.ts 头注释写明
//   「**仅后端能力 + 端点**：Kiosk / 会员前端本波不加『使用券抵扣 / 核销』用户可操作入口」。
//
//   因此本轮只做「读」：查权益、按真实数据渲染六态、说明适用性由谁裁定。
//   页面上的核销 CTA 保持**可聚焦的 aria-disabled**，并明文写出原因，绝不静默、
//   绝不显示「已抵扣 / 已减免」这类假成功。
//
// 合规（CLAUDE.md §9）：券 = 平台 credit，非资金、非收款；本模块不产出任何
//   「补贴已到账 / 已发放金额」承诺；subsidy_eligibility_hint 只作信息指引，不可核销。
// ============================================================

import type { MemberBenefitItem } from '@ai-job-print/shared'
import { getMyBenefits } from './memberFavorites'

/**
 * 可核销权益类型白名单。
 *
 * 镜像服务端 SSOT：`services/api/src/benefit-redemption/benefit-redemption.types.ts:11`
 * `REDEEMABLE_BENEFIT_TYPES = ['coupon', 'free_quota', 'package_entitlement']`。
 * subsidy_eligibility_hint 不在白名单 —— 服务端 benefit-redemption.service.ts:133
 * 对它抛 `BENEFIT_NOT_REDEEMABLE`，所以本机也不能把它算成「可用权益」。
 */
export const REDEEMABLE_BENEFIT_TYPES = ['coupon', 'free_quota', 'package_entitlement'] as const

/**
 * 这条权益是否满足服务端核销的**前置条件**。
 *
 * 每一条都对应服务端 benefit-redemption.service.ts 里一个真实的拒绝分支，不是前端自拟规则：
 *   - 类型不在白名单        :133 BENEFIT_NOT_REDEEMABLE
 *   - status !== 'active'   :137 BENEFIT_NOT_ACTIVE
 *   - validFrom 未到        :141 BENEFIT_NOT_STARTED
 *   - validUntil 已过       :144 BENEFIT_EXPIRED
 *   - quantityRemaining 为空:147 BENEFIT_NOT_QUANTIFIED
 *   - 余额 <= 0             :161 BENEFIT_USED_UP（CAS where quantityRemaining > 0）
 *
 * ⚠️ 这是**展示用过滤**，不是资格裁定。最终能不能核销永远由服务端说了算；
 *    本函数只保证本机不会把服务端明确会拒的权益摆出来当「可用」。
 */
export function isRedeemableForPrint(item: MemberBenefitItem, now: number): boolean {
  if (!(REDEEMABLE_BENEFIT_TYPES as readonly string[]).includes(item.benefitType)) return false
  if (item.status !== 'active') return false
  if (item.validFrom && Date.parse(item.validFrom) > now) return false
  if (item.validUntil && Date.parse(item.validUntil) < now) return false
  if (item.quantityRemaining === null) return false
  return item.quantityRemaining > 0
}

/** 拉取本人权益列表（只读）。未登录 / mock 模式由 getMyBenefits 直接返回空页，不发无效请求。 */
export function fetchPrintBenefits(
  token: string | null | undefined,
): Promise<{ items: MemberBenefitItem[]; total: number }> {
  return getMyBenefits(token, { pageSize: 50 }).then((page) => ({
    items: page.items,
    total: page.total,
  }))
}

// ── 六态 ─────────────────────────────────────────────────────

/**
 * V6 P06 s4 权益卡状态。前四个对应原型 6 个演示态中可由**真实数据**判定的部分，
 * `loading` / `error` 是原型没画、但诚实性要求必须有的两态：
 * 拉不到权益时不能显示「已用完」，那是把「不知道」说成「没有」。
 */
export type PrintBenefitState =
  | 'price_unavailable'  // 价目拉不到
  | 'loading'
  | 'repriced'           // 后台刚调价
  | 'not_applicable'     // 本单不适用（服务端对免费单拒绝核销）
  | 'guest'              // 未认领身份
  | 'error'              // 权益列表读取失败
  | 'none'               // 已用完 / 过期 / 没有可核销权益
  | 'available'          // 有可用

export interface PrintBenefitInput {
  isLoggedIn: boolean
  /** GET /me/benefits 的真实结果。 */
  benefits: { status: 'loading' | 'ready' | 'error'; items: MemberBenefitItem[] }
  /** POST /orders/quote 的真实结果（确认页已有）。 */
  quote:
    | { status: 'loading' | 'unavailable' }
    | { status: 'ready'; amountCents: number; unitCents: number }
  /** GET /print/price-config 的真实结果（公示价唯一来源）。 */
  priceConfig: { status: 'loading' | 'ready' | 'error'; unitCents: number | null }
  now: number
}

export interface PrintBenefitView {
  state: PrintBenefitState
  title: string
  detail: string
  /** 仅 available 态非空：可核销权益列表（服务端返回的原始条目）。 */
  grants: MemberBenefitItem[]
  /** 仅 guest 态为 true：需要展示真实登录入口。 */
  showLoginAction: boolean
  /** 仅 repriced 态非空：两次真实读取的单价对比（分）。 */
  repricedUnits: { quoteUnitCents: number; configUnitCents: number } | null
}

/**
 * 机端核销 CTA 为什么保持禁用 —— 面向用户的明文原因。
 *
 * 必须常驻可见（不是 tooltip、不是只在 focus 时出现），否则就成了「死按钮」。
 */
export const PRINT_BENEFIT_REDEEM_DISABLED_REASON =
  '抵扣规则（适用品类、面值上限、退款后是否恢复）还没有在服务端落地，现在核销会把整单直接免掉。' +
  '为避免错扣你的权益，本轮只展示、不核销。权益不会因此失效，可在「我的 · 我的权益」查看有效期；' +
  '本单请按现场公示价支付。'

/** 机端核销 CTA 文案。明说「本轮不支持」，不说「即将上线」这类没有依据的承诺。 */
export const PRINT_BENEFIT_REDEEM_CTA_LABEL = '本轮暂不支持在机端核销权益'

/**
 * 六态判定。**全部依据真实数据**：登录态、GET /me/benefits、POST /orders/quote、
 * GET /print/price-config。没有任何一态靠前端猜测或 URL 参数。
 *
 * 判定顺序是「最阻塞的先说」：价目取不到 → 还在读 → 价目对不上 → 本单不需要
 * → 不知道你是谁 → 权益读不出来 → 没有可用的 → 有可用。
 */
export function resolvePrintBenefitState(input: PrintBenefitInput): PrintBenefitView {
  const base = { grants: [] as MemberBenefitItem[], showLoginAction: false, repricedUnits: null }

  // ① 价目拉不到：报价失败或公示价读取失败。一个数都不给，也不拿旧价当现价。
  if (input.quote.status === 'unavailable' || input.priceConfig.status === 'error') {
    return {
      ...base,
      state: 'price_unavailable',
      title: '本机没能取到现行价目',
      detail:
        '价目与权益都来自后台配置。取不到就不显示金额、不试算抵扣，也不会拿上一次的价格当现价。'
        + '请稍后重试，或联系现场工作人员。',
    }
  }

  // ② 还在读：报价、公示价、权益任一未就绪，都不给结论。
  const benefitsPending = input.isLoggedIn && input.benefits.status === 'loading'
  if (input.quote.status === 'loading' || input.priceConfig.status === 'loading' || benefitsPending) {
    return {
      ...base,
      state: 'loading',
      title: '正在读取价目与权益…',
      detail: '金额与可用权益都以服务端返回为准，读到之前这里不显示任何结论。',
    }
  }

  // ③ 后台刚调价：报价与公示价是对同一份 PriceConfig 的两次独立读取，
  //    单价不一致说明后台在这两次读取之间改过价 —— 本屏金额已经不是现价。
  const configUnitCents = input.priceConfig.unitCents
  if (
    input.quote.status === 'ready'
    && input.priceConfig.status === 'ready'
    && configUnitCents !== null
    && configUnitCents !== input.quote.unitCents
  ) {
    return {
      ...base,
      state: 'repriced',
      title: '后台刚调过价，本屏报价已不是现价',
      detail:
        '本机取到的公示价与本单报价单价不一致，说明后台在这两次读取之间改过价。'
        + '请返回上一步重新核价后再继续，不要按本屏金额付款。',
      repricedUnits: { quoteUnitCents: input.quote.unitCents, configUnitCents },
    }
  }

  // ④ 本单不适用：应付 0 元。服务端 benefit-redemption.service.ts:126 对免费单
  //    直接抛 REDEEM_NOT_REQUIRED —— 这是真实存在的服务端规则，不是前端自拟。
  if (input.quote.status === 'ready' && input.quote.amountCents === 0) {
    return {
      ...base,
      state: 'not_applicable',
      title: '本单无需权益抵扣',
      detail:
        '本单应付 0 元，服务端对免费单不接受核销。你的权益留着下次用，不会因为这一单被扣掉。',
    }
  }

  // ⑤ 未认领身份：权益挂在本人账号上，游客态读不到，也不该假装读到了。
  if (!input.isLoggedIn) {
    return {
      ...base,
      state: 'guest',
      title: '还没认领身份，看不到你的权益',
      detail:
        '券、免费次数与服务额度都挂在你本人的账号下。登录后这里会显示你已领取的权益；'
        + '不登录也可以按现场公示价直接打印。',
      showLoginAction: true,
    }
  }

  // ⑥ 权益读不出来：明确说「读不出来」，不能滑进「没有权益」。
  if (input.benefits.status === 'error') {
    return {
      ...base,
      state: 'error',
      title: '权益暂时读不出来',
      detail:
        '本机没能从服务端取到你的权益列表，所以这里不给出任何「可用 / 不可用」结论。'
        + '可稍后重试；本单仍可按现场公示价支付。',
    }
  }

  // ⑦ / ⑧ 按服务端核销前置条件过滤。
  const grants = input.benefits.items.filter((item) => isRedeemableForPrint(item, input.now))
  if (grants.length === 0) {
    return {
      ...base,
      state: 'none',
      title: '当前没有可核销的权益',
      detail:
        '你的权益里没有仍在有效期、且还有剩余次数的券 / 免费次数 / 服务额度。'
        + '政策资格提示只提供信息指引，本身不能用于抵扣。',
    }
  }

  return {
    ...base,
    state: 'available',
    grants,
    title: `你有 ${grants.length} 项权益在有效期内`,
    // 这句是本卡最重要的一句诚实声明：适用范围（品类 / 面值上限 / 色彩）在服务端
    // BenefitGrant 上**没有对应字段**，所以本机不判定「这一张能不能用于本单」。
    detail:
      '能否用于本单由服务端在核销时裁定。服务端目前没有下发适用范围（品类 / 面值上限 / 色彩）字段，'
      + '本机不替你预判，也不显示抵扣金额。',
  }
}
