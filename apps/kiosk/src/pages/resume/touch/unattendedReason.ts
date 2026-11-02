// 屏上要显示一句动态来的失败原因（接口原话、共享错误码表的句子）时，先过一遍这里：
// 现场无人值守，原话里一旦带「找 / 联系（现场）工作人员」这类话，就换成页面给的固定句。
import { containsStaffHandoff } from '../../../copy/unattendedCopy'

export function unattendedReason(raw: string | null | undefined, fallback: string): string {
  const text = raw?.trim()
  return text && !containsStaffHandoff(text) ? text : fallback
}
