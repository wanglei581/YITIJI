import { JOB_MATERIAL_TEMPLATE_TYPES, type JobMaterialTemplateType } from '@ai-job-print/shared'

export const JOB_MATERIAL_TYPE_LABELS: Record<JobMaterialTemplateType, string> = {
  resume_template: '简历模板',
  cover_letter: '求职信',
  thank_you: '感谢信',
  portfolio_cover: '作品集封面',
  materials_checklist: '材料清单',
}

export const JOB_MATERIAL_TYPE_OPTIONS = JOB_MATERIAL_TEMPLATE_TYPES.map((value) => ({
  value,
  label: JOB_MATERIAL_TYPE_LABELS[value],
}))
