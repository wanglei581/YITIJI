// 稿 46：简历决策工作台。四条路由的状态都走真实请求，不改页面来伪造。
// 托管按我们云上的关闭口径应答，避免截图里冒出岗位卡片。
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../../../fixtures/api-router'
import { RECRUITMENT_HOSTING_OFF, terminalConfigWithHosting } from '../../../fixtures/recruitment-hosting'
import type { ResumePageExtraPair, ResumePageFixture } from './types'

const TASK = 'sunxiaowen-resume-20261006'
const ANON = 'anon-sunxiaowen-20261006'
const MEMBER = 'member-sunxiaowen-token'
const NAME = '孙晓雯的诊断简历'

const JOB_FIT = `/resume/job-fit?resumeName=${encodeURIComponent(NAME)}`
const ACTIONS = '/resume/job-fit/actions'
const CAREER = '/resume/career-plan'
const TEMPLATES = '/resume/templates'

const JOB = {
  title: '活动运营助理',
  company: '青岛市南区市民服务中心',
  sourceName: '青岛职业技术学院就业网',
  sourceUrl: null,
  externalId: 'QD-2026-OPS-018',
}

function fit(kind: 'high' | 'mid' | 'low') {
  const summary = {
    high: '孙晓雯的简历里，活动运营助理的大部分要求已经写到了。',
    mid: '孙晓雯的简历写到了一部分要求，表格和数据汇总还要补。',
    low: '孙晓雯的简历里，活动运营助理的多数要求还没有写到。',
  }[kind]
  const matched = kind === 'low'
    ? [{ point: '能做现场沟通', evidence: '迎新当天在签到台回答过同学的流程问题。' }]
    : [
        { point: '活动执行', evidence: '在青岛职业技术学院负责迎新报名，单场核对 180 份名单。' },
        { point: '通知跟进', evidence: '管理过班级通知群，日常回复咨询并记录未回复的人。' },
      ]
  const gaps = kind === 'high'
    ? [{ gap: '表格汇总写得不够具体', suggestion: '补一句用过的表格和核对过的人数。' }]
    : [
        { gap: '数据汇总没有写清工具', suggestion: '补上用电子表格分类统计的那一次。' },
        { gap: '活动复盘没有写成结果', suggestion: '写出到场人数和你负责的那一段。' },
        ...(kind === 'low' ? [{ gap: '岗位要求里的物料台账还没出现', suggestion: '如果做过签到物资清点，补一条。' }] : []),
      ]
  return {
    taskId: TASK,
    status: 'completed' as const,
    summary,
    job: JOB,
    matchPoints: matched,
    gapPoints: gaps,
    targetedSuggestions: ['把迎新名单核对写成一条带数字的经历'],
    providerName: 'llm',
    decisionSupport: {
      analysisVersion: 'job_fit_m1_5' as const,
      keywordCoverage: {
        matched: kind === 'low' ? ['现场沟通'] : ['活动执行', '通知跟进'],
        missing: kind === 'high' ? ['数据汇总'] : ['数据汇总', '物料台账'],
      },
    },
  }
}

const PLAN = {
  taskId: TASK,
  status: 'completed' as const,
  basedOn: { resume: true as const, jobFit: '已有一次简历对照', interview: null },
  summary: '孙晓雯的经历偏活动执行，适合先从运营助理起步。',
  currentSnapshot: [{ point: '有校园活动执行经历', evidence: '负责过迎新报名名单核对' }],
  directions: [{ title: '活动运营助理', why: '经历贴近现场执行', firstStep: '把名单核对写成带数字的经历' }],
  skillPlan: [{ skill: '表格整理', action: '用一份真实名单练一次分类汇总', timeframe: '30 天' }],
  actionChecklist: ['把迎新名单核对补进简历'],
  providerName: 'llm',
}

const TEMPLATE = {
  id: 'tpl-qingdao-clean',
  type: 'resume_template',
  title: '清爽单栏简历',
  description: '适合应届生把教育经历和校园活动放在一页 A4 里。',
  tags: ['简历模板', '通用'],
  status: 'published',
  recommendedFor: '青岛职业技术学院一类应届毕业生，例如孙晓雯这种活动执行经历',
  outputFilename: '清爽单栏简历.pdf',
  fields: [{ key: 'applicantName', label: '姓名', required: true, maxLength: 40, placeholder: '例：孙晓雯' }],
  resumeLayoutPreset: {
    style: 'clean',
    defaultLayout: { columns: 1, fontScale: 'standard', lineSpacing: 'standard', margin: 'normal', accent: 'green' },
    sectionOrder: ['header', 'education', 'experience', 'skills'],
  },
}

const PRINT = {
  fileId: 'sunxiaowen-print',
  filename: '孙晓雯-简历对照.pdf',
  sizeBytes: 180000,
  pageCount: 2,
  printFileUrl: '/api/v1/files/sunxiaowen-print/content?sig=pair46',
}

function err(status: number, code: string, message: string) {
  return { status, json: { error: { code, message } } }
}

function never(api: ApiRouter, method: string, path: string) {
  api.respondWith(method, path, () => new Promise(() => undefined))
}

function seed(page: Page, accessToken?: string) {
  return page.addInitScript(({ taskId, token }) => {
    window.sessionStorage.setItem('ai-job-print:current-ai-resume', JSON.stringify({
      taskId,
      ...(token ? { accessToken: token } : {}),
    }))
  }, { taskId: TASK, token: accessToken ?? null })
}

function hostingOff(api: ApiRouter) {
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: terminalConfigWithHosting(RECRUITMENT_HOSTING_OFF, 'p46'),
  })
}

function registerLogin(api: ApiRouter) {
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', { status: 200, json: { success: true, data: null } })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', { status: 200, json: { success: true, data: null } })
  api.respond('POST', '/api/v1/member/auth/sms-code', {
    status: 200,
    json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } },
  })
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 200,
    json: { success: true, data: { token: MEMBER, user: { id: 'member-sunxiaowen', phoneMasked: '138****8000', nickname: '孙晓雯' } } },
  })
}

async function loginThenOpen(page: Page, target: string) {
  await page.goto(`/login?from=${encodeURIComponent(target)}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of '13800138000') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of '123456') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
  await page.waitForURL((url) => `${url.pathname}${url.search}` === target)
}

async function fillAndAnalyze(page: Page) {
  await page.locator('[data-testid="resume-job-fit-state-pick"]').waitFor({ state: 'visible', timeout: 12_000 })
  await page.getByLabel('目标岗位名称').fill('活动运营助理')
  await page.getByRole('button', { name: '继续并确认授权' }).click()
}

function cta(page: Page, name: string) {
  return page.locator('.qx-ctabar').getByRole('button', { name, exact: true })
}

const UNREACHABLE: Record<string, string> = {
  'actions:unknown': '行动清单的 unknown 在现有加载路径里到不了：读取结束时要么已有清单，要么已经失败或碰到能力级故障，不会停在未确认。',
  'career-plan:unknown': '职业规划的 unknown 要停在 guide 且尚未探测。读取一返回就会变成已探测、任务不存在或能力级故障，现有往返到不了这一态。',
}

function markerOf(screen: string, state: string): string {
  if (screen === 'job-fit' && (state === 'anonymous-consent' || state === 'member-consent')) return '[role="dialog"]'
  if (screen === 'job-fit' && state.startsWith('result-')) return '[data-testid="resume-job-fit-state-result"]'
  if (screen === 'job-fit') return `[data-testid="resume-job-fit-state-${state}"]`
  if (screen === 'actions') return `[data-testid="resume-job-fit-actions-state-${state}"]`
  if (screen === 'career-plan') return `[data-testid="resume-career-plan-state-${state}"]`
  return `[data-testid="resume-templates-state-${state}"]`
}

function routeOf(screen: string): string | null {
  if (screen === 'job-fit') return JOB_FIT
  if (screen === 'actions') return ACTIONS
  if (screen === 'career-plan') return CAREER
  if (screen === 'templates') return TEMPLATES
  return null
}

const PAIRED = new Set([
  'job-fit:missing-task', 'job-fit:rejected-task', 'job-fit:loading', 'job-fit:anonymous-consent',
  'job-fit:member-consent', 'job-fit:pick', 'job-fit:analyzing', 'job-fit:result-high',
  'job-fit:result-mid', 'job-fit:result-low', 'job-fit:ai-down', 'job-fit:failed',
  'actions:missing-task', 'actions:loading', 'actions:ready', 'actions:print-pending', 'actions:print-failed',
  'actions:session-ended', 'actions:ai-down', 'actions:failed',
  'career-plan:missing-task', 'career-plan:loading', 'career-plan:generating', 'career-plan:ready',
  'career-plan:ai-down', 'career-plan:failed', 'career-plan:print-pending', 'career-plan:print-failed',
  'career-plan:session-ended', 'career-plan:rejected-task', 'career-plan:guide', 'career-plan:print-degraded',
  'templates:loading', 'templates:error', 'templates:empty', 'templates:list', 'templates:selected',
])

function extra(screen: string, state: string, protoState: string): ResumePageExtraPair {
  return {
    screen,
    state,
    route: routeOf(screen) ?? '/',
    protoQuery: `?screen=${screen === 'career-plan' ? 'career-plan' : screen}&state=${protoState}&capture=1&flat=1`,
  }
}

export const page46: ResumePageFixture = {
  prefix: '46-',
  plan(screen, state) {
    const key = `${screen}:${state}`
    const blocked = UNREACHABLE[key]
    if (blocked) return { plan: { kind: 'none' }, reason: blocked, marker: null, runtimePath: null }
    if (!PAIRED.has(key)) return null
    return { plan: { kind: 'resume-pages' }, reason: null, marker: markerOf(screen, state), runtimePath: routeOf(screen) }
  },
  extraPairs() {
    return [
      extra('actions', 'session-ended', 'print-failed'),
      extra('actions', 'unknown', 'print-failed'),
      extra('actions', 'ai-down', 'print-failed'),
      extra('actions', 'failed', 'print-failed'),
      extra('career-plan', 'session-ended', 'failed'),
      extra('career-plan', 'rejected-task', 'missing-task'),
      extra('career-plan', 'guide', 'missing-task'),
      extra('career-plan', 'print-degraded', 'failed'),
      extra('career-plan', 'unknown', 'failed'),
    ]
  },
  async prepare(page, api, target) {
    const key = `${target.screen}:${target.state}`
    hostingOff(api)
    if (key === 'job-fit:member-consent') {
      await seed(page)
      registerLogin(api)
    } else if (key !== 'job-fit:missing-task' && key !== 'actions:missing-task' && key !== 'career-plan:missing-task' && !key.startsWith('templates:')) {
      await seed(page, ANON)
    }
    wire(api, key)
    if (key === 'job-fit:member-consent') await loginThenOpen(page, JOB_FIT)
    else await page.goto(target.runtimeUrl ?? routeOf(target.screen) ?? '/', { waitUntil: 'domcontentloaded' })
    await settle(page, key)
    await page.locator(markerOf(target.screen, target.state)).first().waitFor({ state: 'visible', timeout: 12_000 })
  },
}

function wire(api: ApiRouter, key: string) {
  const latest = `/api/v1/resume/job-fit/${TASK}`
  const consent = `/api/v1/resume/job-fit/consent/${TASK}`
  const analyze = '/api/v1/resume/job-fit'
  const fitPrint = `/api/v1/resume/job-fit/${TASK}/print`
  const career = `/api/v1/resume/career-plan/${TASK}`
  const careerPrint = `/api/v1/resume/career-plan/${TASK}/print`
  const templates = '/api/v1/job-materials/templates'
  const notFound = err(404, 'JOB_FIT_NOT_FOUND', '还没有对照结果')
  const missingPlan = err(404, 'CAREER_PLAN_NOT_FOUND', '尚未生成')
  const paused = err(503, 'AI_PAUSED', 'AI 服务暂停中')
  const active = key === 'job-fit:result-high'

  if (key.startsWith('job-fit:') && key !== 'job-fit:missing-task') {
    api.respond('GET', consent, {
      status: 200,
      json: { taskId: TASK, consentVersion: 'job-fit-anon-1', grantedAt: active ? '2026-10-01T00:00:00.000Z' : null, revokedAt: null, active },
    })
  }
  if (key === 'job-fit:loading') never(api, 'GET', latest)
  else if (key === 'job-fit:rejected-task') api.respond('GET', latest, err(404, 'AI_TASK_NOT_FOUND', '任务不存在'))
  else if (key === 'job-fit:result-high') api.respond('GET', latest, { status: 200, json: fit('high') })
  else if (key === 'job-fit:result-mid') api.respond('GET', latest, { status: 200, json: fit('mid') })
  else if (key === 'job-fit:result-low') api.respond('GET', latest, { status: 200, json: fit('low') })
  else if (key.startsWith('job-fit:') && key !== 'job-fit:missing-task') api.respond('GET', latest, notFound)

  if (key === 'job-fit:analyzing') never(api, 'POST', analyze)
  else if (key === 'job-fit:anonymous-consent') api.respond('POST', analyze, err(403, 'JOB_FIT_ANONYMOUS_CONSENT_REQUIRED', '需要授权'))
  else if (key === 'job-fit:member-consent') api.respond('POST', analyze, err(403, 'USER_AI_CONSENT_REQUIRED', '需要同意岗位 AI 辅助'))
  else if (key === 'job-fit:ai-down') api.respond('POST', analyze, paused)
  else if (key === 'job-fit:failed') api.respond('POST', analyze, { status: 200, json: { taskId: TASK, status: 'failed', failReason: '这次没有整理出可确认的对照要点。' } })

  if (key === 'actions:loading') never(api, 'GET', latest)
  else if (key === 'actions:ai-down') api.respond('GET', latest, paused)
  else if (key === 'actions:failed') api.respond('GET', latest, { status: 200, json: { taskId: TASK, status: 'failed', failReason: '这次没有整理出可执行的准备建议。' } })
  else if (key.startsWith('actions:') && key !== 'actions:missing-task') api.respond('GET', latest, { status: 200, json: fit('mid') })
  if (key === 'actions:print-pending') never(api, 'POST', fitPrint)
  else if (key === 'actions:print-failed') api.respond('POST', fitPrint, err(500, 'INTERNAL', '打印文件生成失败'))

  if (key === 'career-plan:loading') never(api, 'GET', career)
  else if (key === 'career-plan:rejected-task') api.respond('GET', career, err(404, 'AI_TASK_NOT_FOUND', '任务不存在'))
  else if (key === 'career-plan:ai-down') api.respond('GET', career, paused)
  else if (key === 'career-plan:ready' || key === 'career-plan:print-pending' || key === 'career-plan:print-failed' || key === 'career-plan:print-degraded' || key === 'career-plan:session-ended') {
    api.respond('GET', career, { status: 200, json: PLAN })
  } else if (key.startsWith('career-plan:') && key !== 'career-plan:missing-task') api.respond('GET', career, missingPlan)

  if (key === 'career-plan:generating') never(api, 'POST', career)
  else if (key === 'career-plan:failed') api.respond('POST', career, { status: 200, json: { taskId: TASK, status: 'failed', failReason: '这次没有整理出可用的方向。', basedOn: { resume: true, jobFit: null, interview: null } } })
  if (key === 'career-plan:print-pending') never(api, 'POST', careerPrint)
  else if (key === 'career-plan:print-failed') api.respond('POST', careerPrint, err(500, 'INTERNAL', '打印文件生成失败'))
  else if (key === 'career-plan:print-degraded') {
    api.respond('POST', careerPrint, {
      status: 200,
      json: { ...PRINT, filename: '孙晓雯-求职参考单.pdf', pageCount: 1, variant: 'degraded' },
    })
  }

  if (key === 'templates:loading') never(api, 'GET', templates)
  else if (key === 'templates:error') api.respond('GET', templates, { status: 500, json: { success: false, error: { code: 'INTERNAL', message: '列表读取失败' } } })
  else if (key === 'templates:list' || key === 'templates:selected') {
    api.respond('GET', templates, { status: 200, json: { success: true, data: [TEMPLATE] } })
  }
}

async function settle(page: Page, key: string) {
  if (key === 'job-fit:anonymous-consent' || key === 'job-fit:member-consent' || key === 'job-fit:analyzing' || key === 'job-fit:ai-down' || key === 'job-fit:failed') {
    await fillAndAnalyze(page)
  }
  if (key === 'actions:print-pending' || key === 'actions:print-failed') {
    await page.locator('[data-testid="resume-job-fit-actions-state-ready"]').waitFor({ state: 'visible', timeout: 12_000 })
    await cta(page, '生成打印版').click()
  }
  if (key === 'actions:session-ended') {
    await page.locator('[data-testid="resume-job-fit-actions-state-ready"]').waitFor({ state: 'visible', timeout: 12_000 })
    await page.evaluate(() => window.sessionStorage.removeItem('ai-job-print:current-ai-resume'))
    await cta(page, '生成打印版').click()
  }
  if (key === 'career-plan:generating' || key === 'career-plan:failed') {
    await page.locator('[data-testid="resume-career-plan-state-guide"]').waitFor({ state: 'visible', timeout: 12_000 })
    await cta(page, '生成求职方案').click()
  }
  if (key === 'career-plan:print-pending' || key === 'career-plan:print-failed' || key === 'career-plan:print-degraded') {
    await page.locator('[data-testid="resume-career-plan-state-ready"]').waitFor({ state: 'visible', timeout: 12_000 })
    await cta(page, '打印建议单').click()
  }
  if (key === 'career-plan:session-ended') {
    await page.locator('[data-testid="resume-career-plan-state-ready"]').waitFor({ state: 'visible', timeout: 12_000 })
    await page.evaluate(() => window.sessionStorage.removeItem('ai-job-print:current-ai-resume'))
    await cta(page, '打印建议单').click()
  }
  if (key === 'job-fit:result-high') await page.getByText('撤回本次授权').waitFor({ state: 'visible', timeout: 12_000 })
  if (key === 'templates:selected') {
    await page.locator('[data-testid="resume-templates-state-list"]').waitFor({ state: 'visible', timeout: 12_000 })
    await page.locator('[data-testid="resume-templates-template-tpl-qingdao-clean"]').click()
  }
}
