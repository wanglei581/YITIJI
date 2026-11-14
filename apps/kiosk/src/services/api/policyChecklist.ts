// 一页办事清单（2026-11-05 政策最小闭环，产品负责人拍板）。
//
// 服务端按「已发布」的这条政策生成一页 A4 PDF：政策名、发布机构、发布日期、谁可以申请、
// 要准备的材料、去哪办、原文二维码（只在原文链接核验通过时印），页脚写明
// 「仅供参考，不具证明效力；办理要件和资格以发布机构和经办窗口为准，本机不代办」。
// 同一条政策同一个内容版本只生成一次，之后复用；生成和打印建单前服务端都再查一次是否已撤下。
//
// 端点：POST /policies/:id/checklist（公开，只含已发布的公共信息，不收任何个人信息）
//   200 { success: true, data: PolicyChecklistFile }
//   404 { error: { code: 'POLICY_NOT_FOUND' } } —— 没有这条、未发布、已撤下或被紧急下架
//   其它 —— 失败，页面如实说「这次没生成」，给重试；不冒充「已撤下」。

import { terminalAttributedFetch } from '../terminalAuth'
import { API_BASE_URL, API_MODE } from './client'

export interface PolicyChecklistFile {
  policyId: string
  /** 生成时依据的内容版本。 */
  contentVersion: number
  fileId: string
  /** 形如「材料清单-政策名.pdf」。 */
  filename: string
  pageCount: number
  sizeBytes: number
  /** 打印链用的临时签名链接。 */
  printFileUrl: string
  /** 给手机扫码下载的临时签名链接（打印机离线时「扫码把清单存到手机」用）；服务端给不出时为 null。 */
  phoneUrl: string | null
  /** phoneUrl 的到期时间（ISO）；没有 phoneUrl 时为 null。 */
  phoneUrlExpiresAt: string | null
}

export type PolicyChecklistResult =
  | { status: 'ok'; file: PolicyChecklistFile }
  | { status: 'withdrawn' }
  | { status: 'failed' }

export async function createPolicyChecklist(policyId: string): Promise<PolicyChecklistResult> {
  const id = policyId.trim()
  if (!id) return { status: 'withdrawn' }
  // 演示模式没有后端，生成不了真实文件；如实失败，不造一份假清单。
  if (API_MODE !== 'http') return { status: 'failed' }
  try {
    const res = await terminalAttributedFetch(`${API_BASE_URL}/policies/${encodeURIComponent(id)}/checklist`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    })
    if (res.status === 404) return { status: 'withdrawn' }
    if (!res.ok) return { status: 'failed' }
    const body = (await res.json()) as { data?: Partial<PolicyChecklistFile> }
    const data = body.data
    if (!data || typeof data.fileId !== 'string' || typeof data.printFileUrl !== 'string' || !data.fileId || !data.printFileUrl) {
      return { status: 'failed' }
    }
    return {
      status: 'ok',
      file: {
        policyId: typeof data.policyId === 'string' ? data.policyId : id,
        contentVersion: typeof data.contentVersion === 'number' ? data.contentVersion : 1,
        fileId: data.fileId,
        filename: typeof data.filename === 'string' && data.filename ? data.filename : '材料清单.pdf',
        pageCount: typeof data.pageCount === 'number' && data.pageCount > 0 ? data.pageCount : 1,
        sizeBytes: typeof data.sizeBytes === 'number' && data.sizeBytes > 0 ? data.sizeBytes : 0,
        printFileUrl: data.printFileUrl,
        phoneUrl: typeof data.phoneUrl === 'string' && data.phoneUrl ? data.phoneUrl : null,
        phoneUrlExpiresAt: typeof data.phoneUrlExpiresAt === 'string' ? data.phoneUrlExpiresAt : null,
      },
    }
  } catch {
    return { status: 'failed' }
  }
}
