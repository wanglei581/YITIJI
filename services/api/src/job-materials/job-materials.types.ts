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
