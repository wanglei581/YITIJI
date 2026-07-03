import type { JobMaterialTemplateView } from './job-materials.types'

const COMMON_FIELDS = [
  { key: 'applicantName', label: '姓名', required: true, maxLength: 40, placeholder: '例：王同学' },
  { key: 'targetRole', label: '目标岗位', required: true, maxLength: 60, placeholder: '例：前端开发工程师' },
  { key: 'targetOrganization', label: '目标单位', required: false, maxLength: 80, placeholder: '例：某科技公司 / 某高校招聘会' },
  { key: 'keyStrengths', label: '核心亮点', required: false, maxLength: 280, multiline: true, placeholder: '例：React 项目经验、校级竞赛、数据分析能力' },
  { key: 'notes', label: '补充说明', required: false, maxLength: 220, multiline: true, placeholder: '例：希望语气稳重，突出实习经历' },
] as const

export const JOB_MATERIAL_TEMPLATES: JobMaterialTemplateView[] = [
  {
    id: 'resume-template-clean',
    type: 'resume_template',
    title: '清爽通用简历模板',
    description: '用于选择简历版式方向，进入简历诊断/优化后生成正式简历。',
    tags: ['简历模板', '通用'],
    status: 'published',
    recommendedFor: '简历诊断、AI 简历优化、现场打印前版式参考',
    outputFilename: '清爽通用简历模板.pdf',
    fields: [...COMMON_FIELDS],
    resumeLayoutPreset: {
      style: 'clean',
      defaultLayout: {
        fontScale: 'standard',
        lineSpacing: 'standard',
        margin: 'normal',
        columns: 1,
        accent: 'blue',
      },
      sectionOrder: ['header', 'summary', 'education', 'experience', 'projects', 'skills', 'certificates'],
    },
  },
  {
    id: 'campus-cover-letter',
    type: 'cover_letter',
    title: '校招自荐信',
    description: '适合应届生在校招现场快速生成一页自荐材料。',
    tags: ['校招', '通用'],
    status: 'published',
    recommendedFor: '应届毕业生、校园招聘会、宣讲会后补充材料',
    outputFilename: '校招自荐信.pdf',
    fields: [...COMMON_FIELDS],
  },
  {
    id: 'experienced-cover-letter',
    type: 'cover_letter',
    title: '社招求职信',
    description: '围绕岗位要求、过往成果和匹配理由生成正式求职信。',
    tags: ['社招', '通用'],
    status: 'published',
    recommendedFor: '社招求职、岗位咨询、线下招聘会沟通',
    outputFilename: '社招求职信.pdf',
    fields: [...COMMON_FIELDS],
  },
  {
    id: 'interview-thank-you',
    type: 'thank_you',
    title: '面试感谢信',
    description: '面试后整理感谢与补充说明，方便用户自行发送。',
    tags: ['面试', '通用'],
    status: 'published',
    recommendedFor: '面试结束后的跟进、补充说明、二次沟通准备',
    outputFilename: '面试感谢信.pdf',
    fields: [...COMMON_FIELDS],
  },
  {
    id: 'portfolio-cover',
    type: 'portfolio_cover',
    title: '作品集封面',
    description: '为设计、内容、运营岗位生成简洁作品集封面页。',
    tags: ['设计岗', '运营岗'],
    status: 'published',
    recommendedFor: '作品集打印、现场展示、材料装订首页',
    outputFilename: '作品集封面.pdf',
    fields: [...COMMON_FIELDS],
  },
  {
    id: 'job-fair-checklist',
    type: 'materials_checklist',
    title: '招聘会材料清单',
    description: '生成参加招聘会前的材料准备清单，减少遗漏。',
    tags: ['招聘会', '通用'],
    status: 'published',
    recommendedFor: '招聘会现场打印、面试前检查、材料整理',
    outputFilename: '招聘会材料清单.pdf',
    fields: [...COMMON_FIELDS],
  },
]

export function listPublishedJobMaterialTemplates(): JobMaterialTemplateView[] {
  return JOB_MATERIAL_TEMPLATES.filter((template) => template.status === 'published')
}

export function findJobMaterialTemplate(id: string): JobMaterialTemplateView | null {
  return JOB_MATERIAL_TEMPLATES.find((template) => template.id === id) ?? null
}
