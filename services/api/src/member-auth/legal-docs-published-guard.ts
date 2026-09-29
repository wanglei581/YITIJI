import { ForbiddenException } from '@nestjs/common'
import { LEGAL_DRAFT_FALLBACK_VERSION } from '../legal/legal-constants'

// ============================================================
// C4：登录前协议必须已正式发布（next-tasks 合规小改 C4）。
//
// 没有已激活的《用户服务协议》《隐私政策》时，服务端回落草稿哨兵版本，用户勾选的是一份
// 没有正式发布的协议 —— 同意记录站不住。要求生效时，缺任何一份「已激活且有发布时间」的
// 版本就拒绝登录（LEGAL_DOCS_NOT_PUBLISHED），短信、微信、扫码三条登录路径都经过这里。
//
// 默认：NODE_ENV=production 时要求，其余环境（开发、自动化测试、E2E）照旧回落。
// LEGAL_DOCS_REQUIRE_PUBLISHED=true / false 可显式覆盖；false 只作生产应急口，用完改回。
// 发布顺序不能反：先在后台「法务文档」发布两份文档，再部署带本闸门的版本，否则会员登不上。
//
// 一体机（2026-09-29 口径）：正式生产构建取不到已发布版本时不再回落草稿哨兵，直接在登录页如实
// 拦住（apps/kiosk/src/services/auth/legalConsentVersions.ts）；开发、单测、E2E 构建照旧回落。
// 因此 LEGAL_DOCS_REQUIRE_PUBLISHED=false 对一体机正式构建不再生效，这是有意的：发布前 preflight
// 会硬检查三份法务文档都已激活。小程序仍在取不到版本时回落，由这里的服务端闸门兜底。
// ============================================================

export interface ResolvedLegalVersions {
  termsVersion: string
  privacyVersion: string
  termsDocVersionId: string | null
  privacyDocVersionId: string | null
  termsPublishedAt: Date | null
  privacyPublishedAt: Date | null
}

export function legalDocsRequirePublished(): boolean {
  const raw = process.env['LEGAL_DOCS_REQUIRE_PUBLISHED']?.trim()
  if (raw === 'true') return true
  if (raw === 'false') return false
  return process.env['NODE_ENV'] === 'production'
}

export function assertLegalDocsPublished(resolved: ResolvedLegalVersions): void {
  if (!legalDocsRequirePublished()) return
  const published = (version: string, docId: string | null, publishedAt: Date | null) =>
    version !== LEGAL_DRAFT_FALLBACK_VERSION && Boolean(docId) && Boolean(publishedAt)
  if (
    published(resolved.termsVersion, resolved.termsDocVersionId, resolved.termsPublishedAt) &&
    published(resolved.privacyVersion, resolved.privacyDocVersionId, resolved.privacyPublishedAt)
  ) {
    return
  }
  throw new ForbiddenException({
    error: { code: 'LEGAL_DOCS_NOT_PUBLISHED', message: '服务协议暂未正式发布，暂时不能登录，请联系现场工作人员' },
  })
}
