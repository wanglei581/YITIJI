import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { RECRUITMENT_HOSTING_OFF, terminalConfigWithHosting } from '../fixtures/recruitment-hosting'

// 稿 46 四屏（简历对照 / 行动清单 / 职业规划 / 简历模板）的英雄区、真话栏、
// 缺任务第三条出口，以及结果屏匿名撤回卡的位置。
// 文件名以 fusion-w3.spec.ts 结尾，由 playwright.w3.config.ts 的 testMatch 接进 CI。
// 标题带 @w3-kiosk，否则 project grep 会把整文件滤成 0 条。

const HERO_STEPS = [
  '要求自己写，不从列表里选',
  '小青对照你的简历',
  '带走下一步，或去打印',
] as const

const TASK_ID = 't-sunxw'
const ACCESS_TOKEN = 'sun-anon-access'
const ANON_RESULT = {
  taskId: TASK_ID,
  status: 'completed',
  summary: '活动执行写到了，表格整理还没写上。',
  job: { title: '行政专员', company: '青岛市南区市民服务中心' },
  matchPoints: [{ point: '有活动执行经历', evidence: '负责过青岛职业技术学院的校园活动报名统计' }],
  gapPoints: [{ gap: '表格整理还没写进经历', suggestion: '把报名统计写成一条经历' }],
  targetedSuggestions: ['把「协助活动」改写成具体做过的三件事'],
}

function decisionShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: terminalConfigWithHosting(RECRUITMENT_HOSTING_OFF, 'w3-decision-chrome'),
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200,
    json: { data: { asrEnabled: false, ttsEnabled: false } },
  })
}

/** 用路由 state 带上匿名任务，与诊断页跳进对照页是同一条通道。 */
async function openJobFitResult(page: Page): Promise<void> {
  const path = `/resume/job-fit?resumeName=${encodeURIComponent('孙晓雯的诊断简历')}`
  await page.goto(path)
  await page.evaluate(([target, usr]) => {
    window.history.replaceState({ usr, key: 'w3-decision', idx: 0 }, '', target)
  }, [path, { taskId: TASK_ID, accessToken: ACCESS_TOKEN }] as const)
  await page.reload()
}

async function expectNoJobMatchCopy(page: Page, screen: string): Promise<void> {
  const visible = await page.locator('.jfq-root').innerText()
  expect(visible, `${screen} 用户可见文字`).not.toContain('岗位匹配')
}

async function expectHeroAndTruth(page: Page, screen: string): Promise<void> {
  const root = page.locator('.jfq-root')
  const hero = root.getByTestId('resume-decision-hero')
  await expect(hero, `${screen} 英雄区`).toBeVisible()
  const steps = hero.locator('ol.jfq-hero-steps li')
  await expect(steps, `${screen} 三步轨`).toHaveCount(3)
  await expect(steps.locator('b')).toHaveText(['1', '2', '3'])
  for (const step of HERO_STEPS) await expect(hero).toContainText(step)
  const truth = root.getByTestId('resume-decision-truth')
  await expect(truth, `${screen} 单行真话栏`).toBeVisible()
  await expect(truth.locator('p')).toHaveCount(1)
  await expect(truth.locator('p')).toContainText('只供本人准备')
  await expect(truth.locator('p')).toContainText('不提供给企业')
  await expect(truth.locator('p')).toContainText('结果以实际记录为准')
  await expect(truth.locator('p')).toContainText('结束这次办理会清除本机登录')
  await expectNoJobMatchCopy(page, screen)
}

async function expectHelpOpensHelp(page: Page, screen: string): Promise<void> {
  await page.locator('.jfq-root').getByTestId('resume-decision-truth').getByRole('button', { name: '使用说明' }).click()
  await expect(page, `${screen} 的使用说明去 /help`).toHaveURL(/\/help$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('什么问题')
}

test('missing resume task keeps three exits and opens the own-requirements panel @w3-kiosk', async ({ page, api }) => {
  decisionShell(api)
  await page.goto('/resume/job-fit')
  const screen = page.locator('[data-kiosk-screen="resume-job-fit"]')
  await expect(screen).toHaveAttribute('data-state', 'missing-task')
  await expect.poll(() => api.requestCount('GET', '/api/v1/terminals/KSK-001/config')).toBeGreaterThan(0)

  const exits = screen.locator('.jfq-kit > button')
  await expect(exits, '托管关闭时缺任务只有三条出口').toHaveCount(3)
  await expect(exits.locator('b')).toHaveText(['打印现有简历', '扫描纸质简历', '自己写下要求'])
  await expect(screen.getByText('看来源岗位要求')).toHaveCount(0)

  await exits.filter({ hasText: '自己写下要求' }).click()
  // 去向：仍停在缺任务的简历对照屏，就地打开能自己贴要求的区域。不开始分析，也不改去别的路由。
  await expect(page, '自己写下要求留在简历对照屏').toHaveURL(/\/resume\/job-fit$/)
  await expect(screen).toHaveAttribute('data-state', 'missing-task')
  const panel = page.locator('#job-fit-own-requirements')
  await expect(panel, '去向是本屏的手写要求区').toBeVisible()
  await expect(panel).toContainText('没有可读取的简历任务时，这里不开始分析，也不写成已完成')
  const requirement = panel.getByRole('textbox', { name: '岗位 JD 或任职要求' })
  await expect(requirement, '这一屏能自己贴要求').toBeVisible()
  await requirement.fill('熟悉 Excel，能独立整理报名表')
  await expect(requirement).toHaveValue('熟悉 Excel，能独立整理报名表')
  expect(api.requestCount('POST', '/api/v1/resume/job-fit')).toBe(0)
  await expectNoJobMatchCopy(page, '简历对照')
})

test('four decision screens show the hero track, truth bar, and help route @w3-kiosk', async ({ page, api }) => {
  decisionShell(api)
  const screens = [
    { name: '简历对照', path: '/resume/job-fit', screen: 'resume-job-fit', state: 'missing-task' },
    { name: '行动清单', path: '/resume/job-fit/actions', screen: 'resume-job-fit-actions', state: 'missing-task' },
    { name: '职业规划', path: '/resume/career-plan', screen: 'resume-career-plan', state: 'missing-task' },
    { name: '简历模板', path: '/resume/templates', screen: 'resume-templates', state: 'empty' },
  ] as const
  for (const item of screens) {
    await page.goto(item.path)
    const screen = page.locator(`[data-kiosk-screen="${item.screen}"]`)
    await expect(screen, item.name).toHaveAttribute('data-state', item.state)
    await expectHeroAndTruth(page, item.name)
    await expectHelpOpensHelp(page, item.name)
  }
})

test('anonymous withdrawal card stays below the comparison summary @w3-kiosk', async ({ page, api }) => {
  decisionShell(api)
  api.respond('GET', `/api/v1/resume/job-fit/${TASK_ID}`, { status: 200, json: ANON_RESULT })
  api.respond('GET', `/api/v1/resume/job-fit/consent/${TASK_ID}`, {
    status: 200,
    json: {
      taskId: TASK_ID,
      consentVersion: 'job-fit-anon-v1',
      grantedAt: '2026-10-01T01:00:00.000Z',
      revokedAt: null,
      active: true,
    },
  })
  await openJobFitResult(page)
  const screen = page.locator('[data-kiosk-screen="resume-job-fit"]')
  await expect(screen).toHaveAttribute('data-state', 'result')
  await expect(screen.getByText('正在用：孙晓雯的诊断简历')).toBeVisible()

  const summary = screen.locator('section.jfq-sec').filter({ has: page.getByRole('heading', { name: '对照概要', exact: true }) })
  const card = screen.locator('.jfq-consent-card').filter({ has: page.getByRole('button', { name: '撤回本次授权' }) })
  await expect(summary).toBeVisible()
  await expect(card).toBeVisible()
  await card.scrollIntoViewIfNeeded()
  const summaryBox = await summary.boundingBox()
  const cardBox = await card.boundingBox()
  expect(summaryBox, '对照概要必须有位置').not.toBeNull()
  expect(cardBox, '撤回卡必须有位置').not.toBeNull()
  expect(cardBox!.y, '匿名撤回卡在对照概要下面').toBeGreaterThan(summaryBox!.y + summaryBox!.height - 1)
  await expectHeroAndTruth(page, '简历对照结果')
})
