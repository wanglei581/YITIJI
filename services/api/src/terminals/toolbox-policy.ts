export const TOOLBOX_COMPLIANCE_FORBIDDEN_PATTERNS = [
  { label: '平台内一键投递', pattern: /(?:平台(?:内)?|在线|直接|一键|立即)投递/ },
  { label: '企业收简历', pattern: /(?:(?:企业|公司|雇主|用人单位).{0,8})?(?:直收|收取|接收|收集).{0,6}简历|简历.{0,6}(?:直收|收取|接收|收集)/ },
  { label: '候选人筛选', pattern: /(?:候选人|简历)筛选|筛选(?:候选人|简历)/ },
  { label: '候选人推荐给企业', pattern: /(?:候选人|简历).{0,6}推荐.{0,8}(?:给|至)?(?:企业|公司|雇主)|推荐.{0,6}(?:候选人|简历).{0,8}(?:给|至)?(?:企业|公司|雇主)/ },
  { label: '面试邀约', pattern: /面试(?:邀约|邀请)|(?:企业|公司|雇主).{0,8}面试(?:通知|安排)|面试(?:通知|安排).{0,8}(?:企业|公司|雇主)/ },
  { label: 'offer管理', pattern: /offer管理|录用管理/ },
] as const

function normalizeComplianceText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
}

export function findToolboxComplianceViolation(title: string, description: string): string | null {
  const text = normalizeComplianceText(`${title} ${description}`)
  const hit = TOOLBOX_COMPLIANCE_FORBIDDEN_PATTERNS.find((item) => item.pattern.test(text))
  return hit?.label ?? null
}
