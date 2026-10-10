import type {
  GeneratedResume,
  ResumeGenerateExportResponse,
  ResumeGenerateResponse,
  ResumeOptimizeModule,
} from '@ai-job-print/shared'

export const SYNTHETIC_RESUME: GeneratedResume = {
  basic: { name: '合成样本', phone: '13800000000', city: '青岛' },
  intention: { position: '前端开发', city: '青岛' },
  summary: '合成演示摘要，不是真实简历。',
  education: [{ school: '合成大学', major: '计算机', degree: '本科', period: '2018-2022', description: '完成本科学业。' }],
  experience: [{
    company: '合成科技',
    role: '实习生',
    period: '2022-2023',
    description: '参与前端开发。主导活动并完成 5000 人场次，获季度之星。',
  }],
  projects: [{ name: '合成项目', role: '成员', description: '按任务书完成页面改版。' }],
  skills: ['TypeScript', 'React'],
  certificates: ['合成证书'],
}

/** 23 号并排和 capture 用的示例简历。合成样本标记仍留在总览上，人名写成真人会写的一份。 */
export const PAGE23_CAPTURE_RESUME: GeneratedResume = {
  basic: { name: '孙晓雯', phone: '13853201826', email: 'sunxiaowen@example.com', city: '青岛' },
  intention: { position: '仓储专员', city: '青岛', jobType: '全职' },
  summary: '青岛职业技术学院物流管理 2026 届。在青岛某物流公司仓储部实习，按入库单核对货位并整理当日台账。',
  education: [{ school: '青岛职业技术学院', major: '物流管理', degree: '专科', period: '2023-2026', description: '在校完成仓储与配送课程。' }],
  experience: [{
    company: '青岛某物流公司',
    role: '仓储部实习生',
    period: '2025-2026',
    description: '在仓储部按入库单核对货位，并整理了当日台账。主导盘点并完成 5000 条记录校验。',
  }],
  projects: [{ name: '校园快递驿站整理', role: '组员', description: '按班级统计待取件，核对货架编号。' }],
  skills: ['入库核对', 'Excel 台账'],
  certificates: ['物流员职业资格'],
}

export const PAGE23_CAPTURE_MODULES: ResumeOptimizeModule[] = [
  {
    title: '仓储实习',
    before: '在仓储部按入库单核对货位。',
    after: '在仓储部按入库单核对货位，并整理了当日台账。',
  },
  {
    title: '盘点记录',
    before: '参与过一次盘点。',
    after: '主导盘点并完成 5000 条记录校验。',
  },
]

export const SYNTHETIC_MODULES: ResumeOptimizeModule[] = [
  {
    title: '经历表达',
    before: '参与前端开发。',
    after: '参与前端开发。主导活动并完成 5000 人场次，获季度之星。',
  },
]

export const SYNTHETIC_GENERATE: ResumeGenerateResponse = {
  taskId: 'capture-generate',
  status: 'completed',
  providerName: 'mock',
  resume: SYNTHETIC_RESUME,
  missingHints: ['未填写联系邮箱，招聘方可能无法联系你'],
}

export function syntheticExport(kind: 'ready' | 'no-print' | 'failed' | 'expired'): ResumeGenerateExportResponse | null {
  if (kind === 'failed') return null
  const expired = kind === 'expired'
  return {
    fileId: 'capture-export',
    filename: 'AI优化稿_合成样本.pdf',
    sizeBytes: kind === 'ready' ? 4096 : 0,
    pageCount: 1,
    signedUrl: '',
    expiresAt: new Date(Date.now() + (expired ? -60_000 : 30 * 60 * 1000)).toISOString(),
    printFileUrl: kind === 'ready' ? undefined : undefined,
  }
}

export const SYNTHETIC_HINTS = ['未填写联系邮箱，招聘方可能无法联系你']
