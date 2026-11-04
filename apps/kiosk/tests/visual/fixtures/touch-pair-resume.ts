import type { GeneratedResume } from '@ai-job-print/shared'
import { kioskAiCapabilitiesResponse } from '../../fixtures/ai-capabilities'
import { diagnosis } from './fusion-w3-states'
import { loginTo, registerTouchShell, see, spaGo, writeSession } from './touch-pair-shell'
import type { TouchPair } from './touch-pair-types'

const RESUME_KEY = 'ai-job-print:current-ai-resume'
const TASK_ID = diagnosis.taskId
const NO_FILE = '诊断方向在确认文件之后才从「下一步」进入。一体机不渲染本机文件选择，现成注册器没有不经上传就写入已确认文件的入口。不许伪造文件已到。'
const NO_READING = '直接打开 /resume/parse 没有文件时是「未找到简历文件」，不是正在读简历。现成注册器没有不经上传就造出进行中的解析任务。'

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
  // 换票发生在首屏绘制前，会清掉简历会话。等服务台标题出来再写，软跳进报告页才会读到。
  await page.goto('/resume-service', { waitUntil: 'domcontentloaded' })
  await see(page, 'text=你手上有简历吗？')
  await writeSession(page, RESUME_KEY, { taskId, accessToken })
}

function stubOptimize(api: import('../../fixtures/api-router').ApiRouter): void {
  api.respond('GET', '/api/v1/resume/records/w6-compare/optimize', { status: 200, json: optimizeBody })
}

export function resumePairs(): TouchPair[] {
  return [
    {
      item: '简历', screen: 'resume', state: 'default', route: '/resume-service',
      seeds: ['registerTouchShell'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        await page.goto('/resume-service')
        await see(page, 'h1')
      },
    },
    {
      item: '简历', screen: 'resume', state: 'ai-down', route: '/resume-service',
      seeds: ['kioskAiCapabilitiesResponse resume_* off'],
      missingReason: null,
      proto: { query: { ai: 'down' } },
      prepare: async (page, api) => {
        registerTouchShell(api)
        api.respond('GET', '/api/v1/kiosk/ai/capabilities', {
          status: 200,
          json: kioskAiCapabilitiesResponse({
            resume_diagnosis: { status: 'off', reason: 'AI_PAUSED' },
            resume_optimize: { status: 'off', reason: 'AI_PAUSED' },
            resume_generate: { status: 'off', reason: 'AI_PAUSED' },
          }),
        })
        await page.goto('/resume-service')
        await see(page, 'h1')
      },
    },
    {
      item: '简历', screen: 'resume-more', state: 'open', route: '/resume-service',
      seeds: ['registerTouchShell', 'click 其余'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        await page.goto('/resume-service')
        await page.getByRole('button', { name: /其余/ }).click()
        await see(page, 'text=其余简历服务')
      },
    },
    {
      item: '简历', screen: 'resume-src', state: 'default', route: '/resume/source',
      seeds: ['registerTouchShell'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
        await page.goto('/resume/source')
        await see(page, '[data-kiosk-screen="resume-source"]')
      },
    },
    {
      item: '简历', screen: 'resume-src', state: 'logged', route: '/resume/source',
      seeds: ['loginThroughVisibleUi'],
      missingReason: null,
      proto: { query: { login: '1' } },
      prepare: async (page, api) => {
        registerTouchShell(api)
        await loginTo(page, api, '/resume/source')
        await see(page, '[data-kiosk-screen="resume-source"]')
      },
    },
    {
      item: '简历', screen: 'upload', state: 'phone', route: '/resume/source',
      seeds: ['click 在手机里'],
      missingReason: null,
      proto: { patch: { ctx: 'resume' } },
      prepare: async (page, api) => {
        registerTouchShell(api)
        await page.goto('/resume/source')
        await page.getByRole('button', { name: /在手机里/ }).click()
        await see(page, 'text=在手机上选文件')
      },
    },
    {
      item: '简历', screen: 'usb', state: 'usb', route: '/resume/source',
      seeds: ['click 在 U 盘里'],
      missingReason: null,
      proto: { patch: { ctx: 'resume' } },
      prepare: async (page, api) => {
        registerTouchShell(api)
        await page.goto('/resume/source')
        await page.getByRole('button', { name: /在 U 盘里/ }).click()
        await see(page, '[data-kiosk-screen="resume-source"]')
        // usbListed 要大于 0 才切到文件列表。预览没有本机 U 盘网桥，停在未开通，不是稿上的根目录文件。
        throw new Error('预览没有本机 U 盘网桥，到不了根目录文件列表。屏上是未开通或没有文件，不是稿上的文件列表。')
      },
    },
    {
      item: '简历', screen: 'resume-direction', state: 'default', route: '/resume/source',
      seeds: [],
      missingReason: NO_FILE,
    },
    {
      item: '简历', screen: 'resume-direction-more', state: 'more', route: '/resume/source',
      seeds: [],
      missingReason: NO_FILE,
    },
    {
      item: '简历', screen: 'reading', state: 'default', route: '/resume/parse',
      seeds: [],
      missingReason: NO_READING,
    },
    {
      item: '简历', screen: 'reading', state: 'ai-down', route: '/resume/parse',
      seeds: [],
      missingReason: NO_READING,
      proto: { query: { ai: 'down' } },
    },
    {
      item: '简历', screen: 'diagnosis', state: 'default', route: '/resume/report',
      seeds: ['session current-ai-resume', 'GET resume/records diagnosis'],
      missingReason: null,
      prepare: async (page, api) => {
        registerTouchShell(api)
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
        registerTouchShell(api)
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
        registerTouchShell(api)
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
        registerTouchShell(api)
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
        registerTouchShell(api)
        stubOptimize(api)
        await seedResume(page, 'w6-compare', 'w6-compare-access')
        await spaGo(page, '/resume/optimize?screen=editor')
        await see(page, 'text=去导出')
        await page.getByRole('button', { name: '去导出' }).click()
        const dialog = page.getByText('导出前核对事实')
        if (await dialog.isVisible().catch(() => false)) {
          const boxes = page.locator('.qxt-factlist input[type="checkbox"]')
          const count = await boxes.count()
          for (let i = 0; i < count; i += 1) await boxes.nth(i).click()
          await page.getByRole('button', { name: '确认导出' }).click()
        }
        await see(page, 'text=要带走哪一种文件')
      },
    },
  ]
}
