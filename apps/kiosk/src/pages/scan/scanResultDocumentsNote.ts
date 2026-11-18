import type { PublicSupportContact } from '../../copy/unattendedCopy'
import { SCAN_GUEST_WAYS_LEAD, scanGuestWays } from './scanGuestWays'

/** 定稿 `fix-scan.js` 登录成功去向的副句。只有「我的文档」列表里真有这份才用。 */
export const PANEL_SAVED_IN_DOCUMENTS = '在「我的文档」查看与管理本次扫描件'

/**
 * 完成页对 `GET /me/documents` 的核对结果。
 * 核对中、没查到、请求失败都还不能说这份已经在「我的文档」里。
 */
export type ScanDocumentsCheck = 'checking' | 'found' | 'missing' | 'failed'

/**
 * 面板扫描完成页「前往我的文档」下面那句小字。
 * 登录且列表里查到这份 fileId 才说已存；其余登录态用当场打印那句。
 * 游客仍是「不进我的文档」那句开头，三条出路由去向行另外列出。
 */
export function scanResultDocumentsNote(input: {
  loggedIn: boolean
  check: ScanDocumentsCheck
  contact?: PublicSupportContact | null
}): string {
  if (!input.loggedIn) return SCAN_GUEST_WAYS_LEAD
  if (input.check === 'found') return PANEL_SAVED_IN_DOCUMENTS
  return scanGuestWays(input.contact).find((way) => way.key === 'print')?.text ?? ''
}
