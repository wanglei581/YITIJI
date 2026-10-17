import { isRecruitmentContentHostingEnabled } from '../recruitment-hosting/recruitment-hosting'
import type { JobQualityService, SourceQualitySummaryItem } from './job-quality.service'

/**
 * 机构端 GET /partner/jobs/quality-summary。
 * 招聘内容托管关闭时回空数组（响应仍是 SourceQualitySummaryItem[]），不查快照。
 * 管理员汇总不走这里。
 */
export async function partnerJobQualitySummary(
  jobQuality: Pick<JobQualityService, 'getSourceQualitySummary'>,
  sourceOrgId: string,
): Promise<SourceQualitySummaryItem[]> {
  if (!isRecruitmentContentHostingEnabled()) return []
  return jobQuality.getSourceQualitySummary({ sourceOrgId })
}
