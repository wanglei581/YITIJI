import type { CareerPlanPayload } from './llm-career-plan.service'

/** Old stored plans may contain null array entries; both JSON and PDF consumers need safe arrays. */
export function sanitizeCareerPlanPayload(payload: CareerPlanPayload): CareerPlanPayload {
  const objects = <T extends object>(items: T[] | undefined): T[] => Array.isArray(items)
    ? items.filter((item): item is T => !!item && typeof item === 'object' && !Array.isArray(item)) : []
  return {
    ...payload,
    currentSnapshot: objects(payload?.currentSnapshot),
    directions: objects(payload?.directions),
    skillPlan: objects(payload?.skillPlan),
    actionChecklist: Array.isArray(payload?.actionChecklist)
      ? payload.actionChecklist.filter((item): item is string => typeof item === 'string') : [],
  }
}
