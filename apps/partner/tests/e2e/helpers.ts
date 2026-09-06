import { expect, type Page } from '@playwright/test'

/** mock 登录态，与 `apps/partner/src/services/auth/index.ts` 的 STORAGE_KEY / MOCK_PARTNER_USER 对齐。 */
export const PARTNER_AUTH_STORAGE_KEY = 'partner_auth_v1'

export const MOCK_PARTNER_AUTH = {
  token: 'mock-token',
  user: {
    id: 'mock-partner-001',
    name: '测试机构账号（预览）',
    role: 'partner' as const,
    orgId: 'org-mock-001',
  },
}

const TECH_STRINGS = ['TypeError', '[object Object]', 'Failed to fetch', 'Cannot read'] as const

export async function injectPartnerAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const rejections: string[] = []
    window.addEventListener('unhandledrejection', (event) => {
      rejections.push(String(event.reason))
    })
    Object.defineProperty(window, '__partnerUnhandledRejections', {
      configurable: true,
      get: () => rejections,
    })
  })
  // 只写一次 localStorage，不用 addInitScript 注入登录态——否则退出登录后整页跳转会把 token 写回去。
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value))
    },
    { key: PARTNER_AUTH_STORAGE_KEY, value: MOCK_PARTNER_AUTH },
  )
}

/** 点协议勾选框左侧方块，避开嵌套的《用户服务协议》链接（点到链接会打开弹层且不勾选）。 */
export async function checkAgreement(scope: Page | import('@playwright/test').Locator): Promise<void> {
  await scope.getByRole('checkbox', { name: /我已阅读并同意/ }).click({ position: { x: 10, y: 10 } })
}

export function collectPageFaults(page: Page): { errors: string[] } {
  const errors: string[] = []
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`)
  })
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (text.includes('favicon')) return
    errors.push(`console: ${text}`)
  })
  return { errors }
}

export async function assertNoPageFaults(page: Page, errors: string[]): Promise<void> {
  const rejections = await page.evaluate(() => {
    const bag = (window as unknown as { __partnerUnhandledRejections?: string[] }).__partnerUnhandledRejections
    return bag ?? []
  })
  expect(errors, `页面运行时错误：\n${errors.join('\n')}`).toEqual([])
  expect(rejections, `未捕获 Promise rejection：\n${rejections.join('\n')}`).toEqual([])
}

export async function assertNoTechGibberish(page: Page): Promise<void> {
  const body = await page.locator('body').innerText()
  for (const needle of TECH_STRINGS) {
    expect(body, `页面出现英文技术串「${needle}」`).not.toContain(needle)
  }
  expect(body, '页面出现裸 undefined').not.toMatch(/\bundefined\b/)
}

export async function gotoPartner(page: Page, path: string, title: string | RegExp): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('正在验证身份…')).toHaveCount(0, { timeout: 15_000 })
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15_000 })
}

export async function waitForMockList(page: Page): Promise<void> {
  await expect(page.getByText('加载中…')).toHaveCount(0, { timeout: 15_000 })
  await expect(page.getByText('加载中...')).toHaveCount(0)
}

export async function assertPageHonest(page: Page, errors: string[]): Promise<void> {
  await expect(page.locator('#root')).not.toBeEmpty()
  await assertNoTechGibberish(page)
  await assertNoPageFaults(page, errors)
}
