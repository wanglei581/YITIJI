/**
 * 「查看联系方式」入口（走查 I-11）。
 *
 * 没配服务电话时，标准求助句只剩一句「查看《隐私政策》里的联系方式」，那是纯文字，现场没人、点也点不开，
 * 出错的人就没有路。这里给它一个真能点开的入口：打开隐私政策，停在「联系我们」那一章
 * （/legal/:doc 按章节标题包含的字找章，找不到停在开头，不报错）。
 * 配了服务电话就不出这个入口——号码在屏上，要打电话的人直接看得到。
 */

export const CONTACT_ENTRY_LABEL = '查看联系方式'

/** 隐私政策里「联系我们」那一章。正文是后台发布的纯文本，只能按标题里的字找。 */
export const PRIVACY_CONTACT_SECTION = '联系'

export const PRIVACY_CONTACT_ROUTE = `/legal/privacy?section=${encodeURIComponent(PRIVACY_CONTACT_SECTION)}`

/** 没有服务电话才要给入口。 */
export function needsContactEntry(contact: { servicePhone: string | null }): boolean {
  return !contact.servicePhone
}
