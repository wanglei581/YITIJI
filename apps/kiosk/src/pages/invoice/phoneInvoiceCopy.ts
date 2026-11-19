/**
 * 手机开票页文案。
 * 稿：docs/design/kiosk-touch-2026-10/pay-1113.js 开票屏（用手机扫码填写开票信息）。
 * 合规句：docs/compliance/pilot-compliance-procedures.md「发票申请流程」。
 * 过期、已提交、提交成功与服务端 invoice-sessions.service.ts 同一句。
 * 稿里「这台屏幕不保存税号」属于一体机屏，手机上不用（税号存在服务端，手机上说这句会被读成「这一页不保存」）。
 * 下一步（回一体机重新扫码、回一体机查看）都写在状态句里，这几屏不放没有动作的按钮。
 */
import { servicePhoneLine, type PublicSupportContact } from '../../copy/unattendedCopy'

export const INVOICE_PAGE_TITLE = '用手机扫码填写开票信息'
export const INVOICE_STEPS = ['手机扫码', '填写开票信息', '发票发到邮箱'] as const
export const INVOICE_LIST_TITLE = '手机上要填的三项'
export const INVOICE_FIELD_TITLE = '抬头。个人写姓名，单位写单位名称。'
export const INVOICE_FIELD_TAX = '税号。单位才要填。个人不用填税号。'
export const INVOICE_FIELD_EMAIL = '接收邮箱。电子发票发到这个邮箱。'
export const INVOICE_FINE = '在手机上填写并提交。没付成或已退款的单，开不了发票。'
export const INVOICE_KIND = '电子发票（普通发票）'
export const INVOICE_NO_ID = '个人不需要提供身份证号。'
export const INVOICE_COMPANY_HINT = '单位请填写名称和统一社会信用代码。'
/** 合规句「需要专用发票请拨打服务电话」接上公开的服务电话配置；读不到号码时用标准句「查看《隐私政策》里的联系方式」。 */
export function invoiceSpecialLine(contact: PublicSupportContact): string {
  return `需要专用发票请${servicePhoneLine(contact)}`
}
export const INVOICE_SUBMITTED = '已提交。开好后，电子发票发到你填的邮箱。'
export const INVOICE_EXPIRED = '这个二维码已经过期。请回到一体机，重新扫码。'
export const INVOICE_ALREADY = '这份开票信息已经提交过了。请回到一体机查看。'
export const INVOICE_COLD = '这个链接不能用来填写开票信息。请回到一体机，重新扫码。'
export const INVOICE_BLOCKED_NEXT = '这一单开不了发票。请回到一体机查看订单。'
export const INVOICE_OPENING = '正在打开开票页…'
export const INVOICE_RETRY = '网络连接失败，请稍后重试'
export const INVOICE_TITLE_TOO_LONG = '抬头请控制在 80 个字以内。'
export const INVOICE_EMAIL_INVALID = '接收邮箱格式不对。电子发票发到这个邮箱。'
export const INVOICE_SUBMIT_LABEL = '提交'
export const INVOICE_RETRY_LABEL = '重试'
