/**
 * 一体机屏上说到小程序时用的话（2026-10-29，一体机手机码改短链）。
 *
 * 小程序的名字只从 `MINIAPP_DISPLAY_NAME` 取。一体机马上要能贴牌（换品牌名和 Logo），
 * 但小程序不跟着换，永远叫「职易达」。所以屏上凡是提到小程序名字，一律用这个常量，
 * 不要写死，也不要拿一体机当前的品牌名去拼小程序的名字。
 *
 * 扫码说明和取件入口里提到小程序的句子，只在小程序已发布时给出，是否已发布只经 `whenMiniapp` 判断，
 * 本文件不自己读字段。那些句子在小程序未发布、显式传 null，或省略参数而会话缓存里还没有联系方式时，
 * 都返回空串；调用方拿到空串就保持原来的说法。
 * 取件失败屏的三句不一样：开关关着或读不到时也要有一句，只是不点名小程序，改说「在手机上」。
 * 本文件不发请求。
 *
 * 句子里不许出现 `UNATTENDED_FORBIDDEN_PHRASES` 里的说法，也不写价格、购买与岗位、招聘会、企业，
 * 由 scripts/tests/miniapp-link-copy.test.mjs 转译本文件逐条钉住。
 */
import { whenMiniapp, type PublicSupportContact } from './unattendedCopy'

/** 小程序的名字。一体机贴牌换名时它不变。 */
export const MINIAPP_DISPLAY_NAME = '职易达'

/**
 * 手机这一侧（扫一体机码打开的网页：/k/u/、/k/l/ 中转页，手机上传页，手机确认登录页）的页头品牌。
 * 手机侧和小程序是同一个品牌，不随一体机贴牌换（触屏版总指挥 10/29 定），三页都从这里取，不写字面量。
 */
export const PLATFORM_BRAND_NAME = MINIAPP_DISPLAY_NAME

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

/**
 * 到机取件入口的一行说明（首页磁贴、登录门、继续页）。
 * 未发布时为空串，调用方保持「手机上下了单」那类原句，不改口去叫人打开小程序。
 */
export function pickupEntryMiniappLine(contact?: PublicSupportContact | null): string {
  return whenMiniapp(contact, `在${MINIAPP_DISPLAY_NAME}小程序下了单，来这里取`)
}

/** 到机码页页头：去哪找码。未发布时为空串，调用方改说「输入 N 位到机码」。 */
export function pickupCodeFindLead(contact?: PublicSupportContact | null): string {
  return whenMiniapp(contact, `打开${MINIAPP_DISPLAY_NAME}小程序「我的 → 打印订单」`)
}

/**
 * 到机码页页脚里提到小程序的前半句。没付款要在本机付，那半句留在调用处，不放进这里
 * （这里的句子不写付款）。未发布时为空串，调用方连那半句一起不显示。
 */
export function pickupClaimMiniappClause(contact?: PublicSupportContact | null): string {
  return whenMiniapp(contact, `在${MINIAPP_DISPLAY_NAME}小程序下的单，到这里输到机码取件`)
}

/** 「码找不到了」里回看订单的标题。未发布时为空串，调用方不画出这一条。 */
export function pickupLookBackTitle(contact?: PublicSupportContact | null): string {
  return whenMiniapp(contact, `回${MINIAPP_DISPLAY_NAME}小程序看`)
}

/** 扫码枪说明前面那半句。未发布时为空串，后面怎么扫的原句照旧。 */
export function pickupScanMiniappLead(contact?: PublicSupportContact | null): string {
  return whenMiniapp(contact, `打开${MINIAPP_DISPLAY_NAME}小程序里的到机码页面，`)
}

/**
 * 取件失败屏：订单已经不能再领。开着时点名小程序；关着或读不到时只说在手机上。
 * 不返回空串——失败屏必须有下一句，调用方不再另备一句。
 */
const PICKUP_UNAVAILABLE_ON = '这个到机码已经不能使用。请在手机小程序「我的 → 打印订单」查看这笔订单，需要的话重新下单'
const PICKUP_UNAVAILABLE_OFF = '这个到机码已经不能使用。请在手机上「我的 → 打印订单」查看这笔订单，需要的话重新下单'
const PICKUP_REFUNDED_ON = '本单已退款，不再出纸。款项按原路退回，可在小程序「我的 → 打印订单」查看退款进度'
const PICKUP_REFUNDED_OFF = '本单已退款，不再出纸。款项按原路退回，可在手机上「我的 → 打印订单」查看退款进度'
const PICKUP_PAYMENT_ON = '这笔订单已经不能付款（可能已关闭）。请在手机小程序「我的 → 打印订单」查看，需要的话重新下单'
const PICKUP_PAYMENT_OFF = '这笔订单已经不能付款（可能已关闭）。请在手机上「我的 → 打印订单」查看，需要的话重新下单'

export function pickupCodeUnavailableLine(contact?: PublicSupportContact | null): string {
  return whenMiniapp(contact, PICKUP_UNAVAILABLE_ON) || PICKUP_UNAVAILABLE_OFF
}

export function pickupOrderRefundedLine(contact?: PublicSupportContact | null): string {
  return whenMiniapp(contact, PICKUP_REFUNDED_ON) || PICKUP_REFUNDED_OFF
}

export function pickupOrderPaymentUnavailableLine(contact?: PublicSupportContact | null): string {
  return whenMiniapp(contact, PICKUP_PAYMENT_ON) || PICKUP_PAYMENT_OFF
}
