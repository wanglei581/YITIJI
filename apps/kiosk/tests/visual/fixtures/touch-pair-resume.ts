import { expect } from '@playwright/test'
import type { GeneratedResume } from '@ai-job-print/shared'
import { diagnosis } from './fusion-w3-states'
import { loginTo, see, spaGo, terminalReady, writeSession } from './touch-pair-shell'
import { openResumeUsb, pauseResumeAi, resumeDirection, resumeReading, resumeShell } from './touch-pair-resume-seeds'
import type { TouchPair } from './touch-pair-types'

const RESUME_KEY = 'ai-job-print:current-ai-resume'
const TASK_ID = diagnosis.taskId
const optimizedResume: GeneratedResume = {
  basic: { name: '求职者', phone: '13800138000', city: '青岛' },
  intention: { position: '前端开发', city: '青岛' },
  summary: '按本人经历整理表达。',
  education: [{ school: '示例大学', major: '计算机', degree: '本科', period: '2018-2022' }],
  experience: [{
    company: '示例科技',
    role: '实习生',
    period: '2022-2023',
    description: '主导数据整理，完成 5000 条记录校验。',
  }],
  projects: [],
  skills: ['TypeScript'],
  certificates: [],
}

const optimizeBody = {
  taskId: 'w6-compare',
  status: 'completed',
  providerName: 'deepseek',
  modules: [
    { title: '项目成果', before: '参与数据整理工作。', after: '主导数据整理，完成 5000 条记录校验。' },
    { title: '团队协作', before: '与团队沟通需求并跟进问题。', after: '与团队对齐需求，持续跟进问题至闭环。' },
  ],
  optimizedResume,
}

async function seedResume(page: import('@playwright/test').Page, taskId: string, accessToken: string): Promise<void> {
  // 先等换票清场结束，再写读回凭证，软跳报告页。标题出现本身不能证明清场完成。
  await page.goto('/resume-service', { waitUntil: 'domcontentloaded' })
  await see(page, 'text=你手上有简历吗？')
  await terminalReady(page)
  await writeSession(page, RESUME_KEY, { taskId, accessToken })
}

function stubOptimize(api: import('../../fixtures/api-router').ApiRouter): void {
  api.respond('GET', '/api/v1/resume/records/w6-compare/optimize', { status: 200, json: optimizeBody })
}

export function resumePairs(): TouchPair[] {
  return [
    {
      item: '简历', screen: 'resume', state: 'default', route: '/resume-service',
      seeds: ['resumeShell', 'stubResumePhone pending'],
      missingReason: null,
      prepare: async (page, api) => {
        resumeShell(api)
        await page.goto('/resume-service')
        await see(page, '[data-qx-page="resume"][data-readiness="ready"]')
      },
    },
    {
      item: '简历', screen: 'resume', state: 'ai-down', route: '/resume-service',
      seeds: ['resumeShell', 'pauseResumeAi config.ai.paused true'],
      missingReason: null,
      proto: { query: { ai: 'down' } },
      prepare: async (page, api) => {
        resumeShell(api)
        pauseResumeAi(api)
        await page.goto('/resume-service')
        await expect(page.locator('.qxt-slab.qxt-slab-off')).toHaveCount(2)
        await see(page, 'text=可以先打印原件')
      },
    },
    {
      item: '简历', screen: 'resume-more', state: 'open', route: '/resume-service',
      seeds: ['registerTouchShell', 'click 其余'],
      missingReason: null,
      prepare: async (page, api) => {
        resumeShell(api)
        await page.goto('/resume-service')
        await see(page, '[data-qx-page="resume"][data-readiness="ready"]')
        await page.getByRole('button', { name: /其余/ }).click()
        await see(page, 'text=其余简历服务')
      },
    },
    {
      item: '简历', screen: 'resume-src', state: 'default', route: '/resume/source',
      seeds: ['resumeShell', 'stubResumePhone pending'],
      missingReason: null,
      prepare: async (page, api) => {
        resumeShell(api)
        await page.goto('/resume/source')
        await see(page, '.resume-source-phone-session svg[role="img"]')
        await expect(page.locator('body')).not.toContainText('网络连接失败')
      },
    },
    {
      item: '简历', screen: 'resume-src', state: 'logged', route: '/resume/source',
      seeds: ['resumeShell', 'loginThroughVisibleUi', 'stubResumePhone pending'],
      missingReason: null,
      proto: { query: { login: '1' } },
      prepare: async (page, api) => {
        resumeShell(api)
        await loginTo(page, api, '/resume/source')
        await see(page, '.resume-source-phone-session svg[role="img"]')
        await expect(page.locator('body')).not.toContainText('网络连接失败')
      },
    },
    {
      item: '简历', screen: 'upload', state: 'phone', route: '/resume/source',
      seeds: ['resumeShell', 'stubResumePhone pending', 'click 在手机里'],
      missingReason: null,
      proto: { patch: { ctx: 'resume' } },
      prepare: async (page, api) => {
        resumeShell(api)
        await page.goto('/resume/source')
        await page.getByRole('button', { name: /在手机里/ }).click()
        await see(page, '.resume-source-phone-session svg[role="img"]')
        await see(page, 'text=请用手机微信或浏览器扫码')
      },
    },
    {
      item: '简历', screen: 'usb', state: 'usb', route: '/resume/source',
      seeds: ['openResumeUsb', 'fusion-w3 USB status/files/upload'],
      missingReason: null,
      proto: { patch: { ctx: 'resume' } },
      prepare: openResumeUsb,
    },
    {
      item: '简历', screen: 'resume-direction', state: 'default', route: '/resume/source',
      seeds: ['resumeDirection', 'USB 导入', 'openResumeDirection'],
      missingReason: null,
      prepare: (page, api) => resumeDirection(page, api),
    },
    {
      item: '简历', screen: 'resume-direction-more', state: 'more', route: '/resume/source',
      seeds: ['resumeDirection', '定向诊断 → 更多条件'],
      missingReason: null,
      prepare: (page, api) => resumeDirection(page, api, true),
    },
    {
      item: '简历', screen: 'reading', state: 'default', route: '/resume/parse',
      seeds: ['resumeReading', 'USB 导入', 'POST resume/parse 在途'],
      missingReason: null,
      prepare: (page, api) => resumeReading(page, api),
    },
    {
      item: '简历', screen: 'reading', state: 'ai-down', route: '/resume/report',
      seeds: ['resumeReading', 'POST resume/parse 429 AI_QUOTA_EXHAUSTED → 失败报告'],
      missingReason: null,
      proto: { query: { ai: 'down' } },
      prepare: (page, api) => resumeReading(page, api, true, 'AI_QUOTA_EXHAUSTED'),
    },
    {
      item: '简历', screen: 'diagnosis', state: 'default', route: '/resume/report',
      seeds: ['session current-ai-resume', 'GET resume/records diagnosis'],
      missingReason: null,
      prepare: async (page, api) => {
        resumeShell(api)
        api.respond('GET', `/api/v1/resume/records/${TASK_ID}`, { status: 200, json: diagnosis })
        await seedResume(page, TASK_ID, diagnosis.accessToken)
        await spaGo(page, '/resume/report')
        await see(page, 'text=基础信息完整度')
      },
    },
    {
      item: '简历', screen: 'optimize', state: 'default', route: '/resume/optimize',
      seeds: ['session w6-compare', 'GET optimize + optimizedResume'],
      missingReason: null,
      prepare: async (page, api) => {
        resumeShell(api)
        stubOptimize(api)
        await seedResume(page, 'w6-compare', 'w6-compare-access')
        await spaGo(page, '/resume/optimize')
        await see(page, 'text=项目成果')
      },
    },
    {
      item: '简历', screen: 'compare', state: 'default', route: '/resume/optimize/compare',
      seeds: ['session w6-compare', 'GET optimize'],
      missingReason: null,
      prepare: async (page, api) => {
        resumeShell(api)
        stubOptimize(api)
        await seedResume(page, 'w6-compare', 'w6-compare-access')
        await spaGo(page, '/resume/optimize/compare')
        await see(page, 'text=项目成果')
      },
    },
    {
      item: '简历', screen: 'resume-edit', state: 'editor', route: '/resume/optimize?screen=editor',
      seeds: ['session w6-compare', 'GET optimize', 'screen=editor'],
      missingReason: null,
      prepare: async (page, api) => {
        resumeShell(api)
        stubOptimize(api)
        await seedResume(page, 'w6-compare', 'w6-compare-access')
        await spaGo(page, '/resume/optimize?screen=editor')
        await see(page, 'text=去导出')
      },
    },
    {
      item: '简历', screen: 'resume-export', state: 'choose-format', route: '/resume/optimize?screen=editor',
      seeds: ['session w6-compare', '去导出', '核对事实'],
      missingReason: null,
      prepare: async (page, api) => {
        resumeShell(api)
        stubOptimize(api)
        await seedResume(page, 'w6-compare', 'w6-compare-access')
        await spaGo(page, '/resume/optimize?screen=editor')
        await see(page, 'text=去导出')
        await page.getByRole('button', { name: '去导出' }).click()
        const dialog = page.getByRole('dialog', { name: '导出前核对事实' })
        await expect(dialog).toBeVisible()
        const boxes = dialog.getByRole('checkbox')
        expect(await boxes.count()).toBeGreaterThan(0)
        for (const box of await boxes.all()) await box.check()
        await dialog.getByRole('button', { name: '确认导出', exact: true }).click()
        await see(page, 'text=要带走哪一种文件')
      },
    },
  ]
}
