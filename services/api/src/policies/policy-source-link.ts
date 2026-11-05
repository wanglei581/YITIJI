// 政策原文链接核对（2026-11-05 政策最小闭环，产品负责人拍板）。
//
// 原文链接必须落在发布机构已登记的官方网站内（管理员在「合作机构 → 官方域名」登记，
// 与官方渠道同一份 verifiedOfficialDomainsJson、同一个校验函数）。核对由系统在发布时做，
// 一体机读取时再按当前登记名单算一次，不让老人自己去辨认域名。
//
// 本文件只放纯函数和对外文案，发布闸门（policies.service.ts）、公开读取的 externalUrlVerified、
// 一页办事清单的二维码都从这里取同一个判定。

import { verifiedHttpsUrl } from '../official-channels/registrable-domain'
import { parseVerifiedDomains } from '../official-channels/verified-domains'

export type PolicySourceLinkCheck =
  | { status: 'missing' }
  | { status: 'no_registered_domains' }
  | { status: 'not_verified' }
  | { status: 'verified'; url: string; host: string }

/** 判定一条政策的原文链接是否在机构登记的官方网站内。只认 https、不带账号的地址。 */
export function checkPolicySourceLink(
  externalUrl: string | null | undefined,
  verifiedOfficialDomainsJson: string | null | undefined,
): PolicySourceLinkCheck {
  const raw = typeof externalUrl === 'string' ? externalUrl.trim() : ''
  if (!raw) return { status: 'missing' }
  const domains = parseVerifiedDomains(verifiedOfficialDomainsJson).map((item) => item.domain)
  if (domains.length === 0) return { status: 'no_registered_domains' }
  const url = verifiedHttpsUrl(raw, domains)
  if (!url) return { status: 'not_verified' }
  return { status: 'verified', url: url.toString(), host: url.hostname }
}

export function isPolicySourceLinkVerified(
  externalUrl: string | null | undefined,
  verifiedOfficialDomainsJson: string | null | undefined,
): boolean {
  return checkPolicySourceLink(externalUrl, verifiedOfficialDomainsJson).status === 'verified'
}

/** 发布闸门的错误码与对外文案（机构对接人看得懂的话，不露接口路径、字段名和 JSON）。 */
export const POLICY_PUBLISH_ISSUES = {
  handlingFieldsRequired: {
    code: 'POLICY_HANDLING_FIELDS_REQUIRED',
    message: '发布前请把「谁可以申请」「要准备的材料」「去哪办」三栏都填好。',
  },
  sourceUrlRequired: {
    code: 'POLICY_SOURCE_URL_REQUIRED',
    message: '发布前请填写这条政策的原文链接（官方网站上这条政策原文的地址）。',
  },
  sourceDomainsNotRegistered: {
    code: 'POLICY_SOURCE_DOMAINS_NOT_REGISTERED',
    message: '本机构还没有登记官方网站，暂时不能发布带原文链接的政策。请联系平台管理员登记官方网站后再发布。',
  },
  sourceUrlNotVerified: {
    code: 'POLICY_SOURCE_URL_NOT_VERIFIED',
    message:
      '原文链接不在本机构登记的官方网站内。请改用登记网站上的原文地址；原文在上级部门网站的，请联系平台管理员把该网站登记为本机构认可的官方网站。',
  },
} as const
