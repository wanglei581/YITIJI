/**
 * 一体机屏上说到小程序时用的话（2026-10-29，一体机手机码改短链）。
 *
 * 小程序的名字只从 `MINIAPP_DISPLAY_NAME` 取。一体机马上要能贴牌（换品牌名和 Logo），
 * 但小程序不跟着换，永远叫「职易达」。所以屏上凡是提到小程序名字，一律用这个常量，
 * 不要写死，也不要拿一体机当前的品牌名去拼小程序的名字。
 *
 * 两句扫码说明只在小程序已发布时给出，是否已发布只经 `whenMiniapp` 判断，本文件不自己读字段。
 * 小程序未发布、显式传 null，或省略参数而会话缓存里还没有联系方式时，都返回空串；
 * 调用方拿到空串就保持面板原来的说法。本文件不发请求。
 *
 * 句子里不许出现 `UNATTENDED_FORBIDDEN_PHRASES` 里的说法，也不写价格、购买与岗位、招聘会、企业，
 * 由 scripts/tests/miniapp-link-copy.test.mjs 转译本文件逐条钉住。
 */
import { whenMiniapp, type PublicSupportContact } from './unattendedCopy'

/** 小程序的名字。一体机贴牌换名时它不变。 */
export const MINIAPP_DISPLAY_NAME = '职易达'

/** 手机上传二维码旁的说明。小程序未发布或读不到联系方式时为空串。 */
export function phoneUploadScanHint(contact?: PublicSupportContact | null): string {
  return whenMiniapp(contact, `用手机微信扫码：打开的是${MINIAPP_DISPLAY_NAME}小程序，就在里面选文件；打开的是网页，也能照常上传。`)
}

/** 扫码登录二维码旁的说明。小程序未发布或读不到联系方式时为空串。 */
export function qrLoginScanHint(contact?: PublicSupportContact | null): string {
  return whenMiniapp(contact, `用手机微信扫码：打开的是${MINIAPP_DISPLAY_NAME}小程序，已登录的直接确认；打开的是网页，用短信验证。`)
}

/**
 * 手机传来文件后，文件名下面那一行「这份文件从哪来」。
 * 场景码在这单等文件期间可以重复兑换，旁人拍到屏上的码也可能抢在本人之前传；现场无人值守，
 * 只能靠本人认出不是自己传的文件并点取消。来源由服务端按入口和微信小程序固定的 Referer 判定
 * （会话状态里 file.source），只作提示、可被伪造。读不到或不认得时为空串，调用方就不显示这一行。
 * 这是事实陈述，不是「打开小程序」一类引导，所以不经 whenMiniapp。
 */
export function uploadedFileSourceLine(source: unknown): string {
  if (source === 'miniapp_documents') return `来自${MINIAPP_DISPLAY_NAME}小程序「我的文档」`
  if (source === 'miniapp') return `来自${MINIAPP_DISPLAY_NAME}小程序`
  if (source === 'web') return '来自手机网页'
  return ''
}

/** 手机传来文件后的提醒，和来源那一行一起放在文件名下面。 */
export function notYourFileHint(): string {
  return '不是你传的文件？请点「取消」，再重新扫码。'
}
