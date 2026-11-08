import type { CareerPlanPayload } from './llm-career-plan.service'
import { sanitizeCareerPlanPayload } from './career-plan-payload-safety'
import type { SelfAssessmentExclusion } from './self-assessment-consent-reconfirm'

export interface StoredCareerPlan {
  payload: CareerPlanPayload
  /** 生成时使用的上下文来源（如实展示给用户：基于哪些材料） */
  basedOn: {
    resume: true
    jobFit: string | null
    /** 旧存档无此字段；旧 basedOn.jobFit 按系统岗位引用保守清理。 */
    jobFitSource?: 'system' | 'manual' | null
    interview: string | null
    /** 自我探索记分仅作可选上下文。不参与签名门禁 / 配额。同意不是当前版本时不送进模型（这次不纳入）。 */
    selfAssessment: string | null
  }
  providerName: string
  /** 这次没纳入自我探索的原因（如实告知，不悄悄降级）；旧存档无此字段按 null。 */
  selfAssessmentExcluded?: SelfAssessmentExclusion
}

function scrubSystemJobTitle(value: string, title: string): string {
  // An unmarked occupation in the person's own prose is not recruitment content.
  // Only whole, explicitly marked references are changed, and short titles are left alone.
  if (!title.trim() || title.length < 4) return value
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return value
    .replace(new RegExp(`([「“《])${escaped}([」”》])`, 'g'), '$1目标岗位$2')
    .replace(new RegExp(`目标岗位[：:]\\s*${escaped}(?=$|[，。；;、\\s])`, 'g'), '目标岗位')
}

/** 去掉系统岗位标题，保留规划正文。basedOn.jobFit 清空，避免标题从依据栏漏出。 */
export function redactCareerPlanSystemJobTitle(stored: StoredCareerPlan, title: string): StoredCareerPlan {
  const safeStored = { ...stored, payload: sanitizeCareerPlanPayload(stored.payload) }
  if (!safeStored.basedOn?.jobFit || safeStored.basedOn.jobFitSource === 'manual') return safeStored
  const clean = (value: string | undefined) => scrubSystemJobTitle(value ?? '', title)
  const cleanStructured = (value: string | undefined) => value === title && !!title.trim() ? '目标岗位' : clean(value)
  const payload = safeStored.payload
  const objects = <T extends object>(items: T[] | undefined): T[] => Array.isArray(items)
    ? items.filter((item): item is T => !!item && typeof item === 'object' && !Array.isArray(item)) : []
  return {
    ...safeStored,
    basedOn: { ...safeStored.basedOn, jobFit: null, jobFitSource: null },
    payload: {
      ...payload,
      summary: clean(payload?.summary),
      currentSnapshot: objects(payload?.currentSnapshot).map((item) => ({
        ...item,
        point: cleanStructured(item.point),
        evidence: clean(item.evidence),
      })),
      directions: objects(payload?.directions).map((item) => ({
        ...item,
        title: cleanStructured(item.title),
        why: clean(item.why),
        firstStep: clean(item.firstStep),
      })),
      skillPlan: objects(payload?.skillPlan).map((item) => ({
        ...item,
        skill: cleanStructured(item.skill),
        action: clean(item.action),
        timeframe: clean(item.timeframe),
      })),
      actionChecklist: (Array.isArray(payload?.actionChecklist) ? payload.actionChecklist : [])
        .filter((item): item is string => typeof item === 'string').map((item) => clean(item)),
    },
  }
}
