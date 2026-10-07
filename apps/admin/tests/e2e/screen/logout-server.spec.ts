import { expect, test, type Page } from '@playwright/test'

/**
 * http 构建下的退出登录。挂在 playwright.screen.config.ts（VITE_API_MODE=http）。
 * mock 构建不会发 /auth/logout，测不到这条。
 * 登录态只写一次：不能用 addInitScript 回写，否则跳到 /login 会把 token 种回去。
 */

const STORAGE_KEY = 'admin_auth_v1'
const TOKEN = 'e2e-logout-fixture-token'
const AUTH = {
  token: TOKEN,
  user: { id: 'admin-e2e-logout', name: '走查管理员', role: 'admin' as const, orgId: null },
}

type Mode = 'ok' | 'http500' | 'slow'

interface Bag {
  posts: { url: string; authorization: string | undefined }[]
  responded: boolean
}

async function install(page: Page, mode: Mode, bag: Bag): Promise<void> {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window)
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (String(url).includes('/auth/logout')) {
        sessionStorage.setItem('e2e-logout-keepalive', init && init.keepalive === true ? '1' : '0')
      }
      return original(input, init)
    }
  })
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = request.url()
    if (request.method() === 'POST' && url.includes('/auth/logout')) {
      bag.posts.push({ url, authorization: request.headers().authorization })
      if (mode === 'http500') {
        bag.responded = true
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL","message":"退出失败"}}' })
        return
      }
      if (mode === 'slow') {
        await new Promise((resolve) => setTimeout(resolve, 5_000))
        bag.responded = true
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{"loggedOut":true}}' })
        return
      }
      bag.responded = true
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{"loggedOut":true}}' })
      return
    }
    if (url.includes('/auth/me')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { userId: AUTH.user.id, role: 'admin', orgId: null } }),
      })
      return
    }
    if (url.includes('/admin/audit-logs')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { items: [], total: 0, limit: 5, offset: 0 } }),
      })
      return
    }
    if (url.includes('/admin/alerts')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [],
          derivedAt: '2026-10-07T00:00:00.000Z',
          firingCount: 0,
          total: 0,
          viewTotal: 0,
          truncated: false,
          listedCount: 0,
          truncation: null,
          openCount: 0,
          acknowledgedCount: 0,
          suppressedCount: 0,
        }),
      })
      return
    }
    await route.abort('failed')
  })
}

async function openConsole(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.evaluate(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value))
  }, { key: STORAGE_KEY, value: AUTH })
  await page.goto('/account-settings', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible({ timeout: 15_000 })
}

async function storedAuth(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)
}

test.describe('管理员退出登录通知服务端', () => {
  test('点击退出会带 Bearer 调用 POST /auth/logout，然后到登录页并清掉本地登录态', async ({ page }) => {
    const bag: Bag = { posts: [], responded: false }
    await install(page, 'ok', bag)
    await openConsole(page)
    await page.getByRole('button', { name: '退出登录' }).click()
    await page.waitForURL(/\/login/)
    expect(bag.posts).toHaveLength(1)
    expect(bag.posts[0]?.url).toContain('/api/v1/auth/logout')
    expect(bag.posts[0]?.authorization).toBe(`Bearer ${TOKEN}`)
    expect(await storedAuth(page)).toBeNull()
    expect(await page.evaluate(() => sessionStorage.getItem('e2e-logout-keepalive'))).toBe('1')
  })

  test('服务端回 500 仍然到登录页并清掉本地登录态', async ({ page }) => {
    const bag: Bag = { posts: [], responded: false }
    await install(page, 'http500', bag)
    await openConsole(page)
    await page.getByRole('button', { name: '退出登录' }).click()
    await page.waitForURL(/\/login/)
    expect(bag.posts).toHaveLength(1)
    expect(bag.responded).toBe(true)
    expect(await storedAuth(page)).toBeNull()
  })

  test('服务端 5 秒才回时，跳转发生在响应之前', async ({ page }) => {
    const bag: Bag = { posts: [], responded: false }
    await install(page, 'slow', bag)
    await openConsole(page)
    await page.getByRole('button', { name: '退出登录' }).click()
    await page.waitForURL(/\/login/, { timeout: 4_500 })
    expect(bag.posts).toHaveLength(1)
    expect(bag.responded).toBe(false)
    expect(await storedAuth(page)).toBeNull()
  })
})
