import { expect, test, type Page } from '@playwright/test'
import { MOCK_ADMIN_AUTH } from './helpers/auth'
import { openAuthed } from './helpers/open'

const PROBE_TITLE = '自动刷新探针告警'

function alertsBody() {
  return {
    data: [{
      id: 'terminal_offline:probe',
      subjectKey: 'terminal_offline:probe',
      episodeToken: '2026-11-17T00:00:00.000Z',
      type: 'terminal_offline',
      severity: 'warning',
      title: PROBE_TITLE,
      detail: '探针明细',
      terminalCode: 'KSK-002',
      occurredAt: '2026-11-17T00:00:00.000Z',
      conditionState: 'firing',
      handlingState: 'open',
      acknowledgedAt: null,
      silencedUntil: null,
      note: null,
    }],
    derivedAt: '2026-11-17T00:00:00.000Z',
    firingCount: 1,
    total: 1,
    viewTotal: 1,
    truncated: false,
    listedCount: 1,
    truncation: null,
    openCount: 1,
    acknowledgedCount: 0,
    suppressedCount: 0,
  }
}

async function installAlerts(page: Page, mode: 'ok' | 'fail-all' | 'fail-next') {
  let gets = 0
  let failFrom = Number.POSITIVE_INFINITY
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
    if (url.pathname.endsWith('/auth/me')) {
      return json({ data: { userId: MOCK_ADMIN_AUTH.user.id, role: 'admin', orgId: null } })
    }
    if (url.pathname.endsWith('/admin/alerts')) {
      gets += 1
      if (mode === 'fail-all' || gets >= failFrom) {
        return json({ error: { code: 'ALERT_REFRESH_FAILED', message: '告警列表暂时取不到' } }, 500)
      }
      return json(alertsBody())
    }
    return json({ items: [], total: 0, data: [] })
  })
  await page.clock.install()
  return {
    count: () => gets,
    failNext() { failFrom = gets + 1 },
  }
}

async function openAlerts(page: Page) {
  await openAuthed(page, '/alerts')
  await expect(page.getByRole('heading', { name: '告警中心' })).toBeVisible()
}

test('60 秒后发出下一次告警列表请求，未到点不请求', async ({ page }) => {
  const alerts = await installAlerts(page, 'ok')
  await openAlerts(page)
  await expect(page.getByText(PROBE_TITLE)).toBeVisible()
  await expect(page.getByText(/最后刷新 \d{2}:\d{2}:\d{2}/)).toBeVisible()
  await expect.poll(() => alerts.count()).toBeGreaterThan(0)
  const baseline = alerts.count()
  await page.clock.fastForward(59_000)
  expect(alerts.count()).toBe(baseline)
  await page.clock.fastForward(1_000)
  await expect.poll(() => alerts.count()).toBe(baseline + 1)
})

test('自动刷新失败时保留上一份列表，并写明不是现状', async ({ page }) => {
  const alerts = await installAlerts(page, 'fail-next')
  await openAlerts(page)
  await expect(page.getByText(PROBE_TITLE)).toBeVisible()
  await expect.poll(() => alerts.count()).toBeGreaterThan(0)
  alerts.failNext()
  await page.clock.fastForward(60_000)
  await expect(page.getByText(/自动刷新失败，以下为上次成功获取的数据（\d{2}:\d{2}:\d{2}），不代表现状。/)).toBeVisible()
  await expect(page.getByText(PROBE_TITLE)).toBeVisible()
  await expect(page.getByText('当前无告警')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重新获取' })).toHaveCount(1)
})

test('离开告警页后不再请求告警列表', async ({ page }) => {
  const alerts = await installAlerts(page, 'ok')
  await openAlerts(page)
  await expect(page.getByText(PROBE_TITLE)).toBeVisible()
  await expect.poll(() => alerts.count()).toBeGreaterThan(0)
  const baseline = alerts.count()
  await page.getByRole('navigation', { name: '告警与反馈' }).getByRole('link', { name: '意见反馈' }).click()
  await expect(page).toHaveURL(/\/member-feedback/)
  await page.clock.fastForward(120_000)
  expect(alerts.count()).toBe(baseline)
})

test('换筛选后 60 秒计时从头算', async ({ page }) => {
  const alerts = await installAlerts(page, 'ok')
  await openAlerts(page)
  await expect(page.getByText(PROBE_TITLE)).toBeVisible()
  await expect.poll(() => alerts.count()).toBeGreaterThan(0)
  const baseline = alerts.count()
  await page.clock.fastForward(50_000)
  expect(alerts.count()).toBe(baseline)
  await page.getByRole('button', { name: /^打印机异常/ }).click()
  await page.clock.fastForward(50_000)
  expect(alerts.count()).toBe(baseline)
  await page.clock.fastForward(10_000)
  await expect.poll(() => alerts.count()).toBe(baseline + 1)
})

test('首次加载失败显示错误态，不用空列表冒充没有告警', async ({ page }) => {
  await installAlerts(page, 'fail-all')
  await openAlerts(page)
  await expect(page.getByText('出现了一些问题')).toBeVisible()
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
  await expect(page.getByText('当前无告警')).toHaveCount(0)
  await expect(page.getByText('不是现状')).toHaveCount(0)
  await expect(page.getByText(PROBE_TITLE)).toHaveCount(0)
})
