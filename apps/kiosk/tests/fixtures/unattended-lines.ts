/**
 * 无人值守标准句在浏览器用例里的样子。
 *
 * 现场不安排人，需要人接着处理时只给服务电话（src/copy/unattendedCopy.ts）。号码和服务时间读自
 * GET /public/support-contact：一体机还没读到时是保守句「查看《隐私政策》里的联系方式」，
 * 读到了是「拨打服务电话 号码（服务时间）」。用例既要在两种形态下都对，又要钉住句子的结构，
 * 所以这里用正则钉结构、不钉具体号码。句子逐字的形状由 verify:kiosk-support-contact 的单测钉住。
 *
 * 「叫人去找现场的人」的判定直接用 src 里那份词表（containsStaffHandoff），不在用例里另抄一份。
 */
export { containsStaffHandoff } from '../../src/copy/unattendedCopy'

const PHONE_PART = '(?:查看《隐私政策》里的联系方式|拨打服务电话 [0-9-]+(?:（[^）]*）)?)'

/** 标准句 1：需要帮助？{电话片段}。不含句末标点。 */
export const HELP_NEEDED_LINE = new RegExp(`需要帮助？${PHONE_PART}`)

/** 标准句 3：这台机器暂时不能用，请稍后再来（附近有别的在线终端才写「换一台机器」），或{电话片段}。 */
export const MACHINE_UNUSABLE_LINE = new RegExp(`这台机器暂时不能用，请(?:稍后再来|换一台机器)，或${PHONE_PART}。`)

/** 整句匹配用：把正则变成首尾锚定的版本（getByText / toHaveText 要整段文字都是这一句时用）。 */
export function whole(pattern: RegExp): RegExp {
  return new RegExp(`^${pattern.source}$`)
}
