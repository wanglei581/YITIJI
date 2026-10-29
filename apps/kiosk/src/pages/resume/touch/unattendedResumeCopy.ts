import type { PublicSupportContact } from '../../../copy/unattendedCopy'

const STAFF = /(?:请|或)?(?:联系|找)(?:现场)?工作人员/g

/** 本包屏上不出现叫用户去找人的话。号码读不到就不加电话句。 */
export function unattendedResumeCopy(text: string, contact?: PublicSupportContact | null): string {
  const base = text
    .replace(STAFF, '')
    .replace(/[，,、]\s*(?=[。.!！]|$)/g, '')
    .replace(/[，,]{2,}/g, '，')
    .replace(/\s{2,}/g, ' ')
    .replace(/。。+/g, '。')
    .trim()
  const phone = contact?.servicePhone?.trim()
  if (!phone || base.includes(phone)) return base
  const joiner = /[。！]$/.test(base) ? '' : '。'
  return `${base}${joiner}需要帮助？拨打服务电话 ${phone}`
}
