import { serveHappy, open } from './helpers'
import { test, expect } from '@playwright/test'

const brand = { brandName: '青岛就业通', brandMark: '青', logoUrl: null as string | null }
const logoPath = '/api/v1/public/brand-logo/test-logo'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')

test('登录页使用配置品牌，版权仍显示运营主体', async ({ page }) => {
  let calls = 0
  await page.route('**/api/v1/public/brand', route => {
    calls++
    expect(route.request().headers()['authorization']).toBeUndefined()
    return route.fulfill({ json: { success: true, data: brand } })
  })
  await page.goto('/login')
  await expect(page.locator('.c-brand strong')).toHaveText('青岛就业通')
  await expect(page.locator('.c-legal')).toContainText('© 2026 职易达')
  await expect(page).toHaveTitle('管理员后台 - 青岛就业通')
  expect(calls).toBe(1)
})

test('旧后端 404 时静默使用默认品牌', async ({ page }) => {
  await page.route('**/api/v1/public/brand', route => route.fulfill({ status: 404 }))
  const response = page.waitForResponse('**/api/v1/public/brand')
  await page.goto('/login')
  expect((await response).status()).toBe(404)
  await expect(page.locator('.c-brand strong')).toHaveText('职易达')
  await expect(page).toHaveTitle('管理员后台 - 职易达')
  await expect(page.locator('.c-legal')).toContainText('© 2026 职易达')
  await expect(page.getByText(/读取失败|请求失败|网络错误/)).toHaveCount(0)
  await expect(page.locator('[role="alert"]')).toHaveCount(0)
})

test('字段不合格时整份品牌回退', async ({ page }) => {
  await page.route('**/api/v1/public/brand', route => route.fulfill({ json: { success: true, data: { ...brand, brandMark: '青岛' } } }))
  const response = page.waitForResponse('**/api/v1/public/brand')
  await page.goto('/login')
  await response
  await expect(page.locator('.c-brand strong')).toHaveText('职易达')
  await expect(page).toHaveTitle('管理员后台 - 职易达')
})

test('配置 Logo 时显示图片，图片失败时回退图标', async ({ page }) => {
  await page.route('**/api/v1/public/brand', route => route.fulfill({ json: { success: true, data: { ...brand, logoUrl: logoPath } } }))
  await page.route('**/api/v1/public/brand-logo/test-logo', route => route.fulfill({ contentType: 'image/png', headers: { 'cache-control': 'no-store' }, body: png }))
  await page.goto('/login')
  const image = page.locator('.c-logo img')
  await expect(image).toBeVisible()
  await expect(image).toHaveAttribute('alt', '')
  await expect(image).toHaveJSProperty('naturalWidth', 1)
  await page.route('**/api/v1/public/brand-logo/test-logo', route => route.abort())
  await page.reload()
  await expect(page.locator('.c-logo svg')).toBeVisible()
  await expect(page.locator('.c-logo img')).toHaveCount(0)
})

test('政务总览与服务调用标题使用配置品牌', async ({ page }) => {
  await serveHappy(page)
  await page.route('**/api/v1/public/brand', route => route.fulfill({ json: { success: true, data: brand } }))
  await open(page, '/screen/gov')
  await expect(page.getByRole('heading', { name: '青岛就业通 · 就业服务终端运行态势', exact: true })).toBeVisible()
  await page.getByRole('navigation', { name: '大屏页签' }).getByRole('link', { name: '服务调用', exact: true }).click()
  await expect(page.getByRole('heading', { name: '青岛就业通 · 系统使用与服务调用态势', exact: true })).toBeVisible()
})
