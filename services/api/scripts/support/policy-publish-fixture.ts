/** 仅供门禁的政策发布夹具；不是生产机构或真实政策资料。 */
export const POLICY_PUBLISH_FIXTURE = {
  whoCanApply: '验证对象，具体以原文为准',
  requiredMaterials: '验证材料清单，具体以原文为准',
  whereToApply: '验证经办窗口，具体以原文为准',
  externalUrl: 'https://example.gov.cn/policy/1',
} as const

export const POLICY_VERIFIED_DOMAINS_FIXTURE = JSON.stringify([
  { domain: 'example.gov.cn', verifiedAt: '2026-11-05T00:00:00.000Z', verifiedBy: 'policy-verification-fixture' },
])
