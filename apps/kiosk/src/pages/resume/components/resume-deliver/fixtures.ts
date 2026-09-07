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
