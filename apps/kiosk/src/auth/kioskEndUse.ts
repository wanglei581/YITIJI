// ============================================================
// 一体机「结束使用」的唯一规则（隐私 P0，走查 W-42 / W-43 / W-75 / W-64 / B-12）。
//
// 这台机器摆在大厅里，一个人走了另一个人就站上来。以前每个离场出口各清各的：
// 「我的」退出清一套、完成页倒计时只收起预览、换号只管跳登录页……于是总有一条路
// 漏掉一样东西，下一位就看得到上一位的文件、订单或登录。
//
// 现在所有离场出口只有一个入口 endKioskUse(reason)，由 KioskPrivacyGuard 执行，
// 步骤与顺序由本文件的 runEndKioskUse 定死：
//   1. 结束这一次服务人次（上报失败不拦后面）；
//   2. 清本机临时数据（打印材料、AI 简历、扫描等，清单在 kioskSensitiveSession）；
//   3. 退出会员登录；
//   4. 离开：回首页（换号去登录页），整页重载，截断浏览器前进 / 后退。
// 任何一步出错都照样走完后面几步 —— 宁可多清，不能半清。
//
// 本文件不引 React、不碰浏览器，单测直接跑（scripts/tests/kiosk-end-use.test.mjs）。
// ============================================================
import type { KioskVisitEndReason } from '../services/api/kioskSession'
import type { KioskSessionClearDestination } from './KioskSessionControlContext'

/** 页面能用的离场原因。 */
export const KIOSK_END_USE_REASONS = [
  'end_use', // 本人点「结束使用」（我的、账号设置、完成页、超时提醒页的结束按钮）
  'switch_account', // 换号登录：清完上一位再进登录页
  'idle_timeout', // 闲置到点
  'print_done_timeout', // 打印完成页 60 秒倒计时到点
  'handover', // 首页「结束上一位的使用」、进「我的」时答「不是我」
] as const
export type KioskEndUseReason = (typeof KIOSK_END_USE_REASONS)[number]

/**
 * 守卫自己发起的兜底清场（旧历史项、浏览器前进后退缓存恢复、孤立的超时页）。
 * 不给页面用，只为上报时和本人主动离场分开计数。
 */
export type KioskClearReason = KioskEndUseReason | 'privacy_fallback'

/** 映射到服务人次契约里的 endReason（与服务端 KIOSK_SESSION_END_REASONS 一致）。 */
export const END_USE_VISIT_REASON: Record<KioskClearReason, KioskVisitEndReason> = {
  end_use: 'user_exit',
  switch_account: 'handover',
  idle_timeout: 'idle_timeout',
  print_done_timeout: 'idle_timeout',
  handover: 'handover',
  privacy_fallback: 'privacy_clear',
}

export interface KioskEndUseOptions {
  /** 只对 switch_account 有效：登录页顶部那句提示（如「换绑成功，请用新手机号登录」）。 */
  loginHint?: string
}

/** 离场后落在哪：换号进登录页（登录后回「我的」），其余一律回首页。 */
export function endUseDestination(
  reason: KioskClearReason,
  options?: KioskEndUseOptions,
): KioskSessionClearDestination {
  if (reason === 'switch_account') {
    return options?.loginHint
      ? { path: '/login', state: { from: '/profile', hint: options.loginHint } }
      : { path: '/login', state: { from: '/profile' } }
  }
  return { path: '/' }
}

export interface KioskEndUseSteps {
  endVisit: (reason: KioskVisitEndReason) => void
  clearLocal: () => void
  logout: () => void
  leave: (destination: KioskSessionClearDestination) => void
}

function attempt(step: () => void): void {
  try {
    step()
  } catch {
    // 一步失败不许让后面几步不跑：半清比多清危险。
  }
}

/** 四步顺序的唯一出处。守卫里的每一条离场路径都经这里。 */
export function runEndKioskUse(
  reason: KioskClearReason,
  steps: KioskEndUseSteps,
  options?: KioskEndUseOptions,
): void {
  attempt(() => steps.endVisit(END_USE_VISIT_REASON[reason]))
  attempt(steps.clearLocal)
  attempt(steps.logout)
  steps.leave(endUseDestination(reason, options))
}
