export type JobMaterialTemplateType =
  | 'resume_template'
  | 'cover_letter'
  | 'thank_you'
  | 'portfolio_cover'
  | 'materials_checklist'

export type JobMaterialTemplateStatus = 'published' | 'disabled'

export type ResumeTemplateSectionKey =
  | 'header'
  | 'summary'
  | 'education'
  | 'experience'
  | 'projects'
  | 'skills'
  | 'certificates'

export interface ResumeTemplateLayoutPreset {
  style: 'clean' | 'compact' | 'formal'
  defaultLayout: {
    fontScale?: 'compact' | 'standard' | 'large'
    lineSpacing?: 'compact' | 'standard' | 'relaxed'
    margin?: 'narrow' | 'normal' | 'wide'
    columns?: 1 | 2
    accent?: 'blue' | 'green' | 'slate'
  }
  sectionOrder: ResumeTemplateSectionKey[]
}

export interface JobMaterialTemplateField {
  key: 'applicantName' | 'targetRole' | 'targetOrganization' | 'keyStrengths' | 'notes'
  label: string
  required: boolean
  maxLength: number
  multiline?: boolean
  placeholder: string
}

export interface JobMaterialTemplateView {
  id: string
  type: JobMaterialTemplateType
  title: string
  description: string
  tags: string[]
  status: JobMaterialTemplateStatus
  recommendedFor: string
  outputFilename: string
  fields: JobMaterialTemplateField[]
  resumeLayoutPreset?: ResumeTemplateLayoutPreset
}

export interface GenerateJobMaterialInput {
  templateId: string
  applicantName: string
  targetRole: string
  targetOrganization?: string
  keyStrengths?: string
  notes?: string
}

export interface JobMaterialGenerateView {
  templateId: string
  templateTitle: string
  documentType: JobMaterialTemplateType
  fileId: string
  filename: string
  mimeType: 'application/pdf'
  sizeBytes: number
  pageCount: number
  signedUrl: string
  /** 系统 HMAC content URL，仅供 /print/jobs 使用。 */
  printFileUrl?: string
  signedUrlExpiresAt: string
  fileExpiresAt: string | null
  previewUrlPath: string
  downloadUrlPath: string
}

export interface JobMaterialAdminSummaryView {
  templateCount: number
  publishedTemplateCount: number
  generatedFileCount: number
  activeGeneratedFileCount: number
  last7DaysGenerated: Array<{ date: string; count: number }>
  templates: Array<{
    id: string
    type: JobMaterialTemplateType
    title: string
    status: JobMaterialTemplateStatus
    generatedCount: number
  }>
}

/**
 * 管理员视角的模板行：在公开模板视图基础上追加运营元数据
 * （公开 GET 不暴露这些字段，见 JobMaterialTemplateView）。
 */
export interface JobMaterialTemplateAdminView extends JobMaterialTemplateView {
  sortOrder: number
  createdAt: string
  updatedAt: string
  updatedByUserId: string | null
}

/** 后台新建 / 编辑模板的写入载荷（DTO 校验通过后的领域形状）。 */
export interface JobMaterialTemplateAdminWriteInput {
  type: JobMaterialTemplateType
  title: string
  description: string
  tags: string[]
  recommendedFor: string
  outputFilename: string
  sortOrder: number
  fields: JobMaterialTemplateField[]
  resumeLayoutPreset?: ResumeTemplateLayoutPreset | null
}
