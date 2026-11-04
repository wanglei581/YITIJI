import { expect } from '@playwright/test'
import type { GeneratedResume, ResumeParseResponse } from '@ai-job-print/shared'
// 只引模板常量所在的单个文件：从 shared 包入口引运行时值会把 regions.ts 的 china-division JSON 一并加载，
// Node 要求 JSON 导入带 type 属性，并排工具配置会整个加载失败（「No tests found」）。
import { JOB_MATERIAL_TEMPLATES } from '../../../../../packages/shared/src/types/jobMaterials'
import { diagnosis } from './fusion-w3-states'
import { loginTo, see, spaGo, terminalReady, writeSession } from './touch-pair-shell'
import { openResumeUsb, pauseResumeAi, resumeDirection, resumeReading, resumeShell } from './touch-pair-resume-seeds'
import type { TouchPair } from './touch-pair-types'

const RESUME_KEY = 'ai-job-print:current-ai-resume'
const TASK_ID = diagnosis.taskId
const optimizedResume: GeneratedResume = {
  basic: { name: '李佳怡', phone: '13800138000', city: '青岛' },
  intention: { position: '求职方向：内容运营，侧重公众号内容与活动传播。', city: '青岛' },
  summary: '能主动沟通、整理反馈，并在协作中持续学习。',
  education: [{ school: '青岛大学', major: '新闻学', degree: '本科', period: '2022.09-2026.06' }],
  experience: [{
    company: '学院新媒体中心',
    role: '公众号编辑',
    period: '2024.09-2025.06',
    description: '负责学院公众号的选题、撰写和排版，周更 2 篇。',
  }],
  projects: [{ name: '迎新志愿服务', role: '志愿者', description: '参与迎新志愿服务。' }],
  skills: ['Excel', 'Word', '公众号排版'],
  certificates: [],
}

const optimizeBody = {
  taskId: 'w6-compare',
  status: 'completed',
  providerName: 'deepseek',
  modules: [
    { title: '求职目标', before: '希望找一份稳定的工作。', after: optimizedResume.intention.position },
    { title: '项目经历', before: '参与迎新志愿服务。', after: '协助新生办理报到、指引宿舍位置，并整理现场常见问题。' },
    { title: '自我评价', before: '性格开朗，学习能力强。', after: optimizedResume.summary },
    { title: '工作经历', before: '负责学院公众号的选题、撰写和排版。', after: optimizedResume.experience[0].description },
  ],
  optimizedResume,
}

const reportBody: ResumeParseResponse = {
  ...diagnosis,
  report: {
    sections: diagnosis.report.sections.map((section, index) => ({ ...section, score: [8, 6, 5, 3, 6, 8][index] })),
    suggestions: [],
    priorities: [
      { focus: '工作经历', reason: '职责后面补充本人能核实的结果。' },
      { focus: '求职目标', reason: '先写清目标岗位，再围绕它整理经历。' },
      { focus: '项目经历', reason: '交代本人具体做过的事。' },
    ],
    contentBlocks: [
      { key: 'basic', label: '基础信息', lines: ['李佳怡 · 青岛'] },
      { key: 'objective', label: '求职目标', lines: [optimizeBody.modules[0].before] },
      { key: 'education', label: '教育经历', lines: ['青岛大学 · 新闻学 · 本科 · 2022.09-2026.06'] },
      { key: 'experience', label: '工作经历', lines: [optimizeBody.modules[3].before] },
      { key: 'project', label: '项目经历', lines: [optimizeBody.modules[1].before] },
      { key: 'skill', label: '技能', lines: ['熟悉办公软件。'] },
      { key: 'selfintro', label: '自我评价', lines: [optimizeBody.modules[2].before] },
    ],
    issues: [
      { id: 'I1', dim: 'quantification', title: '工作经历', evidence: [{ blockKey: 'experience', lineIndex: 0, quote: optimizeBody.modules[3].before }], impact: '看不出做了多少、做成了什么。', fixIt: '只在原文已有的事实里补周期和篇数，没有的数字不要写上。' },
      { id: 'I2', dim: 'objective', title: '求职目标', evidence: [{ blockKey: 'objective', lineIndex: 0, quote: optimizeBody.modules[0].before }], impact: '全篇没有岗位名，后面的经历对不上具体职位。', fixIt: '写成目标岗位，让经历围着它写。' },
      { id: 'I3', dim: 'experience', title: '项目经历', evidence: [{ blockKey: 'project', lineIndex: 0, quote: optimizeBody.modules[1].before }], impact: '只有活动名，没有具体做了什么。', fixIt: '补上你负责的那一段，不新加没做过的项目。' },
      { id: 'I4', dim: 'keyword', title: '技能', evidence: [{ blockKey: 'skill', lineIndex: 0, quote: '熟悉办公软件。' }], impact: '看不出会哪些工具。', fixIt: '写成你真实用过的软件名，例如 Excel、Word。' },
    ],
  },
}

async function seedResume(page: import('@playwright/test').Page, taskId: string, accessToken: string): Promise<void> {
  // 先等换票清场结束，再写读回凭证，软跳报告页。标题出现本身不能证明清场完成。
  await page.goto('/resume-service', { waitUntil: 'domcontentloaded' })
  await see(page, 'text=你手上有简历吗？')
  await terminalReady(page)
  await writeSession(page, RESUME_KEY, { taskId, accessToken })
}

function stubOptimize(api: import('../../fixtures/api-router').ApiRouter, editor = false): void {
  // 编辑屏另外保留「主导」这一处新增职责词，与数字 2 一共两处待本人确认。
  const body = editor ? { ...optimizeBody, optimizedResume: { ...optimizedResume, summary: `主导内容复盘，${optimizedResume.summary}` } } : optimizeBody
  api.respond('GET', '/api/v1/resume/records/w6-compare/optimize', { status: 200, json: body })
  api.respond('GET', '/api/v1/job-materials/templates', { status: 200, json: { success: true, data: JOB_MATERIAL_TEMPLATES.filter((item) => item.title === '清爽通用简历模板') } })
  api.respond('GET', '/api/v1/resume/records/w6-compare/draft', { status: 200, json: { draft: null } })
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
        api.respond('GET', `/api/v1/resume/records/${TASK_ID}`, { status: 200, json: reportBody })
        api.respond('GET', '/api/v1/resume/export/pricing', { status: 200, json: { mode: 'free', unitCents: 0, unit: '份', benefit: null, label: '免费试运营' } })
        await seedResume(page, TASK_ID, diagnosis.accessToken)
        await spaGo(page, '/resume/report')
        await see(page, 'text=基础信息完整度')
        await expect(page.locator('.qxt-status')).toHaveText('报告已读取')
        await expect(page.getByRole('heading', { name: '问题 4 处', exact: true })).toBeVisible()
        await expect(page.getByTestId('resume-report-primary')).toContainText('查看优化建议（4 条）')
      },
    },
    {
      item: '简历', screen: 'optimize', state: 'default', route: '/resume/optimize',
      seeds: ['session w6-compare', 'GET optimize 4 条 + optimizedResume', '求职目标保留原文'],
      missingReason: null,
      prepare: async (page, api) => {
        resumeShell(api)
        stubOptimize(api)
        await seedResume(page, 'w6-compare', 'w6-compare-access')
        await spaGo(page, '/resume/optimize')
        await expect(page.locator('.qxt-row')).toHaveCount(4)
        await page.locator('.qxt-row').filter({ hasText: '求职目标' }).getByRole('button', { name: '保留原文', exact: true }).click()
        await expect(page.locator('[data-d="optimized"] b')).toHaveText('2 / 3')
        await expect(page.locator('[data-d="manual"] b')).toHaveText('1')
      },
    },
    {
      item: '简历', screen: 'compare', state: 'default', route: '/resume/optimize/compare',
      seeds: ['session w6-compare', 'GET optimize 4 条', 'focusIndex 3', '自己写展开'],
      missingReason: null,
      prepare: async (page, api) => {
        resumeShell(api)
        stubOptimize(api)
        await seedResume(page, 'w6-compare', 'w6-compare-access')
        await spaGo(page, '/resume/optimize/compare', { taskId: 'w6-compare', accessToken: 'w6-compare-access', focusIndex: 3, decisions: { 'm0:求职目标': 'original', 'm1:项目经历': 'optimized', 'm2:自我评价': 'optimized' } })
        await see(page, 'text=第 4 / 4 条')
        await page.getByRole('button', { name: '自己写', exact: true }).click()
        await expect(page.getByRole('textbox', { name: '自己改写这一条' })).toBeVisible()
        await expect(page.getByRole('button', { name: '自己写', exact: true })).toHaveAttribute('aria-pressed', 'true')
      },
    },
    {
      item: '简历', screen: 'resume-edit', state: 'editor', route: '/resume/optimize?screen=editor',
      seeds: ['session w6-compare', 'GET optimize 4 条 / 2 处待确认', '内置清爽通用模板', '已登录 / 未保存'],
      missingReason: null,
      prepare: async (page, api) => {
        resumeShell(api)
        stubOptimize(api, true)
        // 已登录会员进编辑屏前会读 resume_ai 授权：按「已授权」造，不让授权弹窗挡住编辑器（弹窗本身另有用例）。
        api.respond('GET', '/api/v1/me/ai-consents/status', { status: 200, json: { success: true, data: [{ scope: 'resume_ai', granted: true }] } })
        await loginTo(page, api, '/resume-service')
        await terminalReady(page)
        await writeSession(page, RESUME_KEY, { taskId: 'w6-compare', accessToken: 'w6-compare-access' })
        await spaGo(page, '/resume/optimize?screen=editor')
        await see(page, 'text=去导出')
        await expect(page.getByRole('button', { name: '清爽通用简历模板', exact: true })).toHaveAttribute('aria-pressed', 'true')
        await expect(page.locator('.qxt-savestat')).toHaveText('未保存')
        await expect(page.locator('.qxt-warn')).toContainText('还有 2 处事实待你确认')
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
