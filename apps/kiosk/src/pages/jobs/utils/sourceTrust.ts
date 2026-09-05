// ============================================================
// 岗位来源要素门禁（fail-closed）
//
// 规则出处：docs/design/kiosk-redesign-2026-08/27-browse-detail.html
//   - 「信息来源」卡常显 `四要素缺一即不放行外跳`
//   - source-unavailable 态：`来源链接未确认，外跳与扫码已停用`，
//     底栏 why 写「来源平台、外部编号、同步时间或有效期缺一项，本机就不放行外跳与扫码」
// 以及 CLAUDE.md §10：岗位详情必须展示来源机构、同步时间、外部ID、外部投递链接、数据来源说明。
//
// ── 为什么这里的第四项是「外部投递链接」而不是原型字面写的「有效期限」 ──
// 原型自己就不自洽：它把 `有效期限` 数进四要素，但真正触发 source-unavailable 的判据、
// 以及被停用的按钮上写的原因，全都是「来源链接未确认」。取后者，因为：
//   1. `sourceUrl` 缺失是实打实的死链风险：「去来源平台投递」按钮点下去无处可去，
//      而且发生在合规最敏感的那个按钮上 —— 这正是 fail-closed 要防的东西。
//   2. CLAUDE.md §10 的强制展示清单里有「外部投递链接」，没有「有效期」。
//   3. 有效期已经由服务端在读取时兜住了，见下。
// 所以门禁四要素 = 来源机构 / 同步时间 / 外部ID / 外部投递链接。
//
// ── validThrough 不在本门禁里，因为过期岗位根本到不了这一页（2026-09-02 复核）──
// services/api/src/jobs/job-validity.ts 的 jobValidityWhere 已经下推到 SQL，
// 且**列表与详情两条读取路径都套用了它**：
//   - 列表：jobs-shared.ts buildPublishedJobWhere → and.push(jobValidityWhere(now))
//   - 详情：jobs-kiosk.service.ts getPublishedJobById → where 里直接 ...jobValidityWhere()
// 空值语义也已处理：validThrough == null 不判过期（缺有效期是数据质量问题，
// 由 job-quality.service 的 missingFields 记账，不等于失效）；边界取 strict `<`，当天仍有效。
// 互补性由 verify:job-validity-expiry / verify:publish-expiry-completeness 两条门禁断言。
// kiosk 侧唯一带 location.state 进详情的入口是 JobsPage 列表点选，而列表本身已被同一条件过滤。
//
// 因此本页**不做任何按当前时间的过期分支**，也不写「已过期 / 实际状态以来源平台为准」
// 一类措辞 —— 那是在描述一个到不了这一页的状态，写了反而让人以为本页会遇到过期岗位。
// 「有效期限」一格只如实回显来源标注的日期（见 JobDetailSections.tsx）。
// ============================================================

import { isParseableInstant, type ExternalJobDTO } from '@ai-job-print/shared'
import { isValidSourceUrl } from '../../../lib/url'

export type SourceElementKey = 'sourceName' | 'syncTime' | 'externalId' | 'sourceUrl'

/** 用户可见标签，与「来源可信区」四格的 k 文案保持一致。 */
export const SOURCE_ELEMENT_LABEL: Record<SourceElementKey, string> = {
  sourceName: '来源机构',
  syncTime: '同步时间',
  externalId: '外部ID',
  sourceUrl: '外部投递链接',
}

export interface JobSourceTrust {
  /** 四要素齐全 —— 只有这时才放行外跳与扫码。 */
  ok: boolean
  /** 缺失的要素（按展示顺序）。 */
  missing: SourceElementKey[]
  /** 缺失要素的中文标签，用于常显原因。 */
  missingLabels: string[]
  /** 单项是否齐全，供各格分别显示「来源平台未提供」。 */
  present: Record<SourceElementKey, boolean>
}

/** 类型上是 string，运行时来源方可能同步来空串 / 全空白 —— 那就是没给。 */
function hasText(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * 同步时间既要有值，也要能解析成真实时间。
 * 解析不出来时 formatFullDate 会把原串直接上屏（见 utils/jobDisplay.ts），
 * 用户会看到一段无法理解的技术串却以为那是「同步时间」—— 那和没有同步时间一样不可核对。
 */
function hasDate(value: string | undefined | null): boolean {
  return isParseableInstant(value)
}

export function evaluateJobSourceTrust(job: ExternalJobDTO): JobSourceTrust {
  const present: Record<SourceElementKey, boolean> = {
    sourceName: hasText(job.sourceName),
    syncTime: hasDate(job.syncTime),
    externalId: hasText(job.externalId),
    sourceUrl: isValidSourceUrl(job.sourceUrl),
  }
  const missing = (Object.keys(present) as SourceElementKey[]).filter((key) => !present[key])
  return {
    ok: missing.length === 0,
    missing,
    missingLabels: missing.map((key) => SOURCE_ELEMENT_LABEL[key]),
    present,
  }
}

/**
 * 常显的「为什么不能点」原因。
 *
 * 只缺链接时沿用调用方传进来的全局能力门禁常量（SOURCE_APPLY_UNAVAILABLE_REASON），
 * 让岗位 / 企业 / 招聘会参展企业三处文案继续一致；其余情况按缺哪项如实列出。
 *
 * 文案边界：只说「本机为什么不放行」，不说「该岗位无效 / 已失效」——
 * 岗位有没有效由来源平台决定，本机无权替它下结论（CLAUDE.md §9）。
 */
export function sourceTrustReason(trust: JobSourceTrust, linkUnavailableReason: string): string {
  if (trust.ok) return ''
  if (trust.missing.length === 1 && trust.missing[0] === 'sourceUrl') return linkUnavailableReason
  return (
    `来源要素缺「${trust.missingLabels.join('、')}」，无法核对这条岗位的来源，`
    + '本机不放行前往来源平台与扫码；可到来源平台自行查询该职位。'
  )
}

/** 缺失要素在「来源可信区」里的占位文案，与摘要卡的空值口径一致。 */
export const SOURCE_ELEMENT_MISSING_TEXT = '来源平台未提供'
