import { formatCount, type PartnerLicenseView } from '@ai-job-print/shared'

/**
 * 机构资料授权卡与工作台提醒共用的口径：两处必须说同一件事。
 * 只在受管控（managed）时调用。
 */

/** 只有待生效的授权、当前没有在期授权：服务端判为不可用，但这是「还没开始」，不是被停用。 */
export function isPendingOnly(view: PartnerLicenseView): boolean {
  return !view.usable && view.current === null && view.upcoming !== null
}

/** 30 天内到期、且还没录入接续授权——这才需要机构去联系平台续期。 */
export function needsRenewal(view: PartnerLicenseView): boolean {
  return view.state === 'ok' && view.upcoming === null && view.daysLeft !== null && view.daysLeft <= 30
}

export function licenseStatusText(view: PartnerLicenseView): string {
  if (isPendingOnly(view)) return `待生效（${view.upcoming!.startsOn} 起）`
  if (!view.usable) return view.state === 'suspended' ? '已暂停' : view.state === 'expired' ? '已到期停用' : '没有可用授权'
  if (view.state === 'grace') {
    const until = view.current?.graceEndsOn ? `，宽限至 ${view.current.graceEndsOn}（含当天）` : ''
    return view.daysLeft === null ? `宽限期${until}` : `宽限期还剩 ${formatCount(view.daysLeft)} 天${until}`
  }
  return '正常'
}

export function terminalCountText(view: PartnerLicenseView): string {
  if (view.current) return `终端台数：已绑定 ${formatCount(view.terminalsBound)} 台 / 上限 ${formatCount(view.current.terminalQuota)} 台`
  if (view.upcoming) return `终端台数：已绑定 ${formatCount(view.terminalsBound)} 台（授权生效后上限 ${formatCount(view.upcoming.terminalQuota)} 台）`
  return `终端台数：已绑定 ${formatCount(view.terminalsBound)} 台（当前没有可用授权）`
}

/** 工作台「今天要处理」里的一行；返回 null 表示不用提醒。tone=neutral 的不算待办。 */
export function dashboardNotice(view: PartnerLicenseView): { text: string; tone: 'warning' | 'neutral' } | null {
  if (isPendingOnly(view)) {
    return { tone: 'warning', text: `软件使用授权将于 ${view.upcoming!.startsOn} 生效；在此之前名下一体机不能开始新的服务，本后台暂时不能发布或修改内容。` }
  }
  if (!view.usable) return { tone: 'warning', text: '软件使用授权已停用：名下一体机不能开始新的服务，本后台暂时不能发布或修改内容，请联系平台。' }
  if (view.state === 'grace' && view.daysLeft !== null) {
    const until = view.current?.graceEndsOn ? `（宽限至 ${view.current.graceEndsOn}，含当天）` : ''
    return { tone: 'warning', text: `软件使用授权处于宽限期，还剩 ${formatCount(view.daysLeft)} 天${until}；期间照常服务，结束后自动停用，请尽快联系平台续期。` }
  }
  if (view.state === 'ok' && view.daysLeft !== null && view.daysLeft <= 30) {
    if (view.upcoming) return { tone: 'neutral', text: `已录入续期，${view.upcoming.startsOn} 起接续` }
    const after = view.current?.graceEndsOn
      ? `到期后进入宽限期（宽限至 ${view.current.graceEndsOn}，含当天），宽限结束后停用`
      : '到期后自动停用'
    return { tone: 'warning', text: `软件使用授权还剩 ${formatCount(view.daysLeft)} 天到期，请联系平台续期；${after}。` }
  }
  return null
}
