/**
 * 「这一页没拿到文件或任务」空态（稿 st-empty）的文案。纯函数：组件渲染它，print-walk-copy.test.mjs 直接断言它。
 *
 * 「没有订单、没有扣费」只在付款之前才是事实（材料检查、预览的空态）。出纸页、完成页拿不到任务信息时，
 * 订单很可能已建、已付，页面并不知道——对一个已经付过款的人说「没有订单，也没有扣费」是未经证实的结论。
 */

import { printProblemLine, type PublicSupportContact } from '../../../copy/unattendedCopy'

/** 付款之前的空态原句。出纸页、完成页不得使用。 */
export const PRE_ORDER_HOWTO = '文件还没选，或者上一位的文件已经清除。到这一步没有订单，也没有扣费。'

/** 出纸页、完成页：不下结论，说清这一页不知道，并给出可以自己查的出路。 */
export const ORDER_MAY_EXIST_HOWTO = '这一页没拿到这次打印的信息，说不准有没有下过单、扣没扣费。已付款的订单，登录后可在「我的 → 打印订单」里查看。'

export function missResumeHowto(orderMayExist: boolean): string {
  return orderMayExist ? ORDER_MAY_EXIST_HOWTO : PRE_ORDER_HOWTO
}

/** 小字行：页面自己的一句话；订单可能已存在时再接标准求助句（printProblemLine）。 */
export function missResumeFine(orderMayExist: boolean, note: string, contact?: PublicSupportContact | null): string {
  return orderMayExist ? `${note}${printProblemLine(contact)}` : note
}

/** 「我的文档」卡的说明句：已登录写稿 st-empty 已登录态的话，未登录才说「登录后才能看到」。 */
export function missResumeDocumentsDesc(isLoggedIn: boolean): string {
  return isLoggedIn ? '你保存过的文件在这里，选一份再来' : '登录后才能看到你保存的文件'
}
