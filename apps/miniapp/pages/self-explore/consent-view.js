/**
 * 自我探索知情同意：把 questions 接口响应里的同意部分整理成页面要用的形状。
 *
 * 条款、勾选框文字、链接、版本号全部来自同一次响应（9/29 合规裁定），这里一个字都不写：
 * 页面自己写一份，改版时就会出现「看的是这份、记的是那份」；写死版本号则会静默失配
 * （服务端回 SELF_ASSESSMENT_CONSENT_VERSION_STALE）。
 * 条款、勾选框文字、版本号缺任何一样都不就绪：没看到说明的同意不算同意。
 * 链接缺了不影响就绪（说明本身已经在页面上），只是少一个跳转。
 */

function trimmed(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : ''
}

/** consentLinks：只留小程序法务页认得的文档类型；打不开的链接不画出来。 */
function toLinks(raw, docTypes) {
  return (Array.isArray(raw) ? raw : [])
    .map((l) => ({
      label: trimmed(l && l.label),
      legalDocType: trimmed(l && l.legalDocType),
      anchor: trimmed(l && l.anchor),
    }))
    .filter((l) => l.label && docTypes && Object.prototype.hasOwnProperty.call(docTypes, l.legalDocType))
}

/**
 * 勾选框文字按链接文字切段：链接文字出现在勾选框文字里，就在原位做成可点的；
 * 没出现的链接放进 extraLinks，页面另起一行列出，不丢。
 */
function splitLabel(label, links) {
  const parts = []
  const extraLinks = []
  let rest = label
  links.forEach((link, i) => {
    const at = rest.indexOf(link.label)
    if (at < 0) { extraLinks.push({ label: link.label, link: i }); return }
    if (at > 0) parts.push({ text: rest.slice(0, at), link: -1 })
    parts.push({ text: link.label, link: i })
    rest = rest.slice(at + link.label.length)
  })
  if (rest) parts.push({ text: rest, link: -1 })
  return { parts, extraLinks }
}

/**
 * @param res       questions 接口响应
 * @param docTypes  小程序法务页认得的文档类型表（utils/api 的 LEGAL_DOC_TITLES）
 */
function toConsentView(res, docTypes) {
  const items = (res && Array.isArray(res.consentItems) ? res.consentItems : []).map(trimmed).filter(Boolean)
  const version = trimmed(res && res.consentVersion)
  const checkboxLabel = trimmed(res && res.consentCheckboxLabel)
  const links = toLinks(res && res.consentLinks, docTypes)
  const split = splitLabel(checkboxLabel, links)
  return {
    consentItems: items,
    consentVersion: version,
    consentCheckboxLabel: checkboxLabel,
    consentLinks: links,
    checkboxParts: split.parts,
    extraLinks: split.extraLinks,
    consentReady: items.length > 0 && !!version && !!checkboxLabel,
  }
}

/** 取不到说明时页面上的同意部分：全空、不就绪。 */
function emptyConsentView() {
  return toConsentView(null, null)
}

module.exports = { toConsentView, emptyConsentView }
