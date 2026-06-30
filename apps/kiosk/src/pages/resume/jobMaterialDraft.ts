import type { JobMaterialGenerateInput } from '@ai-job-print/shared'

const JOB_MATERIAL_DRAFT_KEY = 'ai-job-print:job-material-draft:v1'
const JOB_MATERIAL_DRAFT_TTL_MS = 10 * 60 * 1000

export type JobMaterialDraftForm = Pick<
  JobMaterialGenerateInput,
  'applicantName' | 'targetRole' | 'targetOrganization' | 'keyStrengths' | 'notes'
>

export interface JobMaterialDraft {
  selectedId: string | null
  form: JobMaterialDraftForm
}

interface StoredJobMaterialDraft extends JobMaterialDraft {
  savedAt?: number
}

function normalizeDraftForm(value: unknown): JobMaterialDraftForm | null {
  if (!value || typeof value !== 'object') return null
  const draft = value as Record<keyof JobMaterialDraftForm, unknown>
  return {
    applicantName: typeof draft.applicantName === 'string' ? draft.applicantName : '',
    targetRole: typeof draft.targetRole === 'string' ? draft.targetRole : '',
    targetOrganization: typeof draft.targetOrganization === 'string' ? draft.targetOrganization : '',
    keyStrengths: typeof draft.keyStrengths === 'string' ? draft.keyStrengths : '',
    notes: typeof draft.notes === 'string' ? draft.notes : '',
  }
}

export function readJobMaterialDraft(): JobMaterialDraft | null {
  try {
    const raw = window.sessionStorage.getItem(JOB_MATERIAL_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as StoredJobMaterialDraft
    const savedAt = typeof record.savedAt === 'number' ? record.savedAt : 0
    const ageMs = Date.now() - savedAt
    if (savedAt <= 0 || ageMs > JOB_MATERIAL_DRAFT_TTL_MS || ageMs < -JOB_MATERIAL_DRAFT_TTL_MS) {
      clearJobMaterialDraft()
      return null
    }
    const form = normalizeDraftForm(record.form)
    if (!form) return null
    return {
      selectedId: typeof record.selectedId === 'string' ? record.selectedId : null,
      form,
    }
  } catch {
    return null
  }
}

export function saveJobMaterialDraft(selectedId: string | null, form: JobMaterialDraftForm): void {
  try {
    window.sessionStorage.setItem(JOB_MATERIAL_DRAFT_KEY, JSON.stringify({ selectedId, form, savedAt: Date.now() }))
  } catch {
    // 公共终端浏览器可能禁用 sessionStorage，草稿恢复是体验增强，不阻断登录。
  }
}

export function clearJobMaterialDraft(): void {
  try {
    window.sessionStorage.removeItem(JOB_MATERIAL_DRAFT_KEY)
  } catch {
    // 忽略浏览器存储异常。
  }
}
