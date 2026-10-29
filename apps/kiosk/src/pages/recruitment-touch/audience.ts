import type { ExternalJobFairDTO } from '@ai-job-print/shared'

/**
 * 校园招聘会识别。与 CampusPage 原来的规则相同，不加新字段：
 * theme 为 campus / campus_corp，或名称、主办方、简介、来源命中校园关键词。
 */
export const CAMPUS_FAIR_RE = /校园|校招|高校|大学|学院|应届|毕业生|双选|研究生|校企/

export function isCampusFair(
  fair: Pick<ExternalJobFairDTO, 'theme' | 'name' | 'organizer' | 'description' | 'sourceName'>,
): boolean {
  return (
    fair.theme === 'campus' ||
    fair.theme === 'campus_corp' ||
    CAMPUS_FAIR_RE.test(`${fair.name} ${fair.organizer} ${fair.description ?? ''} ${fair.sourceName}`)
  )
}

/** 社会招聘会：theme 为 general / industry，且没有被校园规则认走。 */
export function isSocialFair(
  fair: Pick<ExternalJobFairDTO, 'theme' | 'name' | 'organizer' | 'description' | 'sourceName'>,
): boolean {
  if (isCampusFair(fair)) return false
  return fair.theme === 'general' || fair.theme === 'industry'
}

export function campusFairScore(fair: Pick<ExternalJobFairDTO, 'theme' | 'name' | 'status'>): number {
  let score = 0
  if (fair.theme === 'campus') score += 100
  else if (fair.theme === 'campus_corp') score += 80
  if (/校园|校招|双选|高校|毕业生|研究生/.test(fair.name)) score += 50
  if (fair.status === 'ongoing') score += 10
  else if (fair.status === 'upcoming') score += 5
  return score
}
