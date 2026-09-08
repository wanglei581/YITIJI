/**
 * 走查骨架的合规文案纯函数。不依赖 Playwright，给 node --test 和走查用例共用。
 */

/**
 * CLAUDE.md §2 按钮文案白名单，再加上页面上会把黑名单做成子串的合规写法。
 * 「至少」含 §2 六条；「打开来源平台投递页 / 来源平台投递页」是 2026-09-08 实测误报原文。
 */
export const COMPLIANCE_ALLOWED_PHRASES = Object.freeze([
  '查看岗位',
  '去来源平台投递',
  '扫码投递',
  '查看招聘会',
  '去来源平台预约',
  '扫码预约',
  '复制来源链接',
  '打开来源平台投递页',
  '来源平台投递页',
  '扫码前往来源平台投递',
  '来源平台投递',
])

export const COMPLIANCE_FORBIDDEN_PHRASES = Object.freeze([
  '一键投递',
  '立即投递',
  '平台投递',
])

/**
 * 先把白名单短语从文本里全量剔掉，再查黑名单。
 *
 * WHY: 子串误报的真实案例：合规文案「去来源平台投递」含黑名单词「平台投递」。
 * 页面上的「打开来源平台投递页」同样含「平台投递」。朴素 includes / 正则直接查黑名单
 * 会把合规句判红。同一段文本里白名单短语可能出现多次，必须 split/join 全量剔除，
 * 不能只 replace 一次。
 *
 * @param {string} text
 * @returns {string[]} 仍命中的黑名单短语（去重、按清单顺序）
 */
export function scanForbiddenCopy(text) {
  const remaining = stripAllowedPhrases(String(text ?? ''))
  /** @type {string[]} */
  const hits = []
  for (const banned of COMPLIANCE_FORBIDDEN_PHRASES) {
    if (remaining.includes(banned)) hits.push(banned)
  }
  return hits
}

/**
 * @param {string} text
 * @returns {string}
 */
export function stripAllowedPhrases(text) {
  const ordered = [...COMPLIANCE_ALLOWED_PHRASES].sort((a, b) => b.length - a.length)
  let scan = String(text ?? '')
  for (const phrase of ordered) {
    scan = scan.split(phrase).join('')
  }
  return scan
}

/**
 * CLAUDE.md §10 岗位/招聘会详情必须展示的四要素（用户可见标签，缺一即报）。
 */
export const SOURCE_FOUR_ELEMENT_LABELS = Object.freeze([
  '来源机构',
  '同步时间',
  '外部ID',
  '外部投递链接',
])

/**
 * 第四项在岗位详情页常写成「来源链接」（JobTrustSection），
 * 企业 / 招聘会详情写「外部投递链接」。两者都是 §10 的外部投递链接。
 * 外部ID 在部分招聘会二维码元数据里写成「外部编号」。
 */
const SOURCE_FOUR_ELEMENT_ALIASES = Object.freeze({
  来源机构: Object.freeze(['来源机构']),
  同步时间: Object.freeze(['同步时间']),
  外部ID: Object.freeze(['外部ID', '外部编号']),
  外部投递链接: Object.freeze(['外部投递链接', '来源链接']),
})

/**
 * 查岗位 / 招聘会详情是否展示了 CLAUDE.md §10 四要素。
 *
 * WHY: 缺陷可以表现为该显示的没显示，黑名单查不出来。
 * 只查「没说错话」会放过一张来源机构 / 同步时间 / 外部ID / 外部投递链接缺失的详情页。
 * 返回缺失项的中文标签（canonical 名），不要只报 true/false。
 *
 * @param {string} text
 * @returns {string[]}
 */
export function missingSourceFourElements(text) {
  const haystack = String(text ?? '')
  /** @type {string[]} */
  const missing = []
  for (const label of SOURCE_FOUR_ELEMENT_LABELS) {
    const aliases = SOURCE_FOUR_ELEMENT_ALIASES[label]
    if (!aliases.some((alias) => haystack.includes(alias))) missing.push(label)
  }
  return missing
}

/**
 * @param {readonly string[]} missing
 * @returns {string}
 */
export function formatMissingSourceFourElements(missing) {
  if (!missing.length) return ''
  return `岗位/招聘会详情缺少必须展示的：${missing.join('、')}`
}

/**
 * @param {string} text
 * @returns {void}
 */
export function assertSourceFourElements(text) {
  const missing = missingSourceFourElements(text)
  if (missing.length > 0) {
    throw new Error(formatMissingSourceFourElements(missing))
  }
}
