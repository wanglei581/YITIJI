// 合作机构后台的法务文档取数 —— 只读「后台当前已激活的正式版本」。
//
// 与 apps/admin/src/services/api/legalDocs.ts 同源同端点：
// `GET /api/v1/kiosk/legal/:docType`（`legal.controller.ts` 上标注「无鉴权」，
// 登录页没有 JWT 也能读）。两端读的是同一张 LegalDocVersion 表的 isActive 行。
//
// **这里没有 mock 分支，也不接受任何硬编码兜底文案。**
// admin 那份文件顶上已经写死了口径：「接不到真实文档时只显示『法务文档加载失败』，
// 不得回落到硬编码 v1 草拟文」。partner 此前恰恰是被禁止的那个形态 ——
// 登录页把用户拦在「我已阅读并同意《用户服务协议》和《隐私政策》」的勾选前，
// 而弹层里展示的是文件内硬编码的「v1 草拟版」，那份文档自己写着
// 「正式运营前以法务审定发布版本为准」。于是用户同意的，是一份自称不作数的文档。
//
// 2026-09-09 生产实测：
//   admin.zyidai.cn   → 3451 字，版本 2026.08.10-v1.0，载明运营主体
//   partner.zyidai.cn → 454 字，无版本号、无运营主体，自称 v1 草拟版
//
// mock 模式下本函数同样走 HTTP：拿不到就进错误态，页面显示「法务文档加载失败」。
// 那是**正确**的表现 —— 与其给一份假协议，不如明说读不到。
import { API_BASE_URL, ApiHttpError } from './client'

export interface LegalDocActiveView {
  id: string
  docType: string
  version: string
  title: string
  content: string
  publishedAt: string | null
}

/** docType 取值与 LegalDocVersion.docType 一致，不要在页面里另起别名。 */
export const LEGAL_DOC_TYPE = {
  terms: 'terms_of_service',
  privacy: 'privacy_policy',
} as const

export async function getActiveLegalDoc(docType: string): Promise<LegalDocActiveView | null> {
  const res = await fetch(`${API_BASE_URL}/kiosk/legal/${encodeURIComponent(docType)}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    throw new ApiHttpError('LEGAL_DOC_LOAD_ERROR', body.message ?? '法务文档加载失败', res.status)
  }
  const body = (await res.json()) as { success?: boolean; data?: LegalDocActiveView | null }
  return body.data ?? null
}
