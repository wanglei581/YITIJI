import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import { assertNoHorizontalOverflow } from './assert-layout'

/*
 * 一体机手机码改短链（2026-10-29）：/k/u/:scene 与 /k/l/:ticketId 两个网页中转页。
 * 微信规则没生效、或用别的软件扫码时，手机打开的就是这两页；兑换或校验之后 replace 到原来的
 * /upload/phone#…、/member/qr-login?ticketId=…，那两页一个字不改。接口一律在这里拦，不起后端。
 * 文件名带 fusion-w5 是为了进 playwright.w5.config.ts 的 testMatch（与 *-fusion-w3.spec.ts 同一做法），CI 的 test:browser:w5 会跑。
 */

const RESOLVE = '/api/v1/upload-sessions/scene/resolve'
const SCENE = 'w5SceneToken_0123456789a'
const SESSION_ID = 'w5-scene-session'
const UPLOAD_TOKEN = 'w5-scene-derived-upload-token'
const TICKET = 'w5_ticket-0123456789abcdefghijkl'
const UNUSABLE = '二维码已失效或已使用，请回到一体机刷新二维码。'
const RETRYABLE = '网络连接失败，请稍后重试'
const NOT_KIOSK_TICKET = '这不是一体机上的登录二维码，请回到一体机刷新后重新扫码。'

const resolved = {
  status: 200,
  json: {
    success: true,
    data: { sessionId: SESSION_ID, purpose: 'print_doc', mode: 'temporary', expiresAt: '2099-01-01T00:00:00.000Z', uploadToken: UPLOAD_TOKEN },
  },
}

function runtimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('requestfailed', (request) => {
    if (['document', 'script', 'stylesheet'].includes(request.resourceType())) {
      errors.push(`${request.resourceType()}: ${request.url()} ${request.failure()?.errorText ?? ''}`)
    }
  })
  return errors
}

async function expectLandedOnPhoneUpload(page: Page): Promise<void> {
  await expect(page).toHaveURL((url) => url.pathname === '/upload/phone')
  const fragment = new URLSearchParams(new URL(page.url()).hash.slice(1))
  expect(fragment.get('sessionId')).toBe(SESSION_ID)
  expect(fragment.get('token')).toBe(UPLOAD_TOKEN)
  expect(fragment.get('purpose')).toBe('print_doc')
  const root = page.locator('main[data-kiosk-screen="phone-upload"]')
  await expect(root).toHaveAttribute('data-phone-upload-state', 'idle')
  await expect(root.getByLabel('选择要上传的文件')).toBeEnabled()
}

test('上传短链兑换成功：换成手机上传页且可选文件，短链不留在历史里 @w5-mobile', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  api.respond('POST', RESOLVE, resolved)
  const request = page.waitForRequest((candidate) => candidate.method() === 'POST' && new URL(candidate.url()).pathname === RESOLVE)
  await page.goto(`/k/u/${SCENE}`)
  const sent = await request
  expect(sent.postDataJSON()).toEqual({ scene: SCENE })
  expect(sent.headers().authorization).toBeUndefined()
  await expectLandedOnPhoneUpload(page)
  expect(api.requestCount('POST', RESOLVE)).toBe(1)
  await page.goBack()
  expect(page.url()).not.toContain('/k/u/')
  expect(errors).toEqual([])
})

test('上传短链失效：显示失效句，不给重试，不上服务端原话 @w5-mobile', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  api.respond('POST', RESOLVE, {
    status: 404,
    json: { success: false, error: { code: 'UPLOAD_SCENE_UNUSABLE', message: '二维码已失效，请回到一体机重新生成' } },
  })
  await page.goto(`/k/u/${SCENE}`)
  const root = page.locator('main[data-kiosk-screen="upload-scene-entry"]')
  await expect(root).toHaveAttribute('data-kiosk-viewport', 'mobile')
  await expect(root).toHaveAttribute('data-kiosk-code-entry', 'unusable')
  await expect(root.getByRole('heading', { name: UNUSABLE, exact: true })).toBeVisible()
  await expect(root.getByRole('alert')).toContainText(UNUSABLE)
  await expect(page.getByRole('button')).toHaveCount(0)
  await expect(page.getByText('二维码已失效，请回到一体机重新生成')).toHaveCount(0)
  await expect(page).toHaveURL((url) => url.pathname === `/k/u/${SCENE}`)
  expect(api.requestCount('POST', RESOLVE)).toBe(1)
  await assertNoHorizontalOverflow(page)
  expect(errors).toEqual([])
})

test('上传短链格式不对：不发兑换请求，直接显示失效句 @w5-mobile', async ({ page, api }) => {
  await page.goto('/k/u/not-a-scene')
  const root = page.locator('main[data-kiosk-screen="upload-scene-entry"]')
  await expect(root.getByRole('heading', { name: UNUSABLE, exact: true })).toBeVisible()
  await expect(page.getByRole('button')).toHaveCount(0)
  expect(api.requestCount('POST', RESOLVE)).toBe(0)
})

test('上传短链断网：显示网络句和重试，重试成功后换成手机上传页 @w5-mobile', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  api.respondWith('POST', RESOLVE, (attempt) => (attempt === 1 ? { abort: 'internetdisconnected' } : resolved))
  await page.goto(`/k/u/${SCENE}`)
  const root = page.locator('main[data-kiosk-screen="upload-scene-entry"]')
  await expect(root).toHaveAttribute('data-kiosk-code-entry', 'retryable')
  await expect(root.getByRole('heading', { name: RETRYABLE, exact: true })).toBeVisible()
  const retry = root.getByRole('button', { name: '重试', exact: true })
  const box = await retry.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.height).toBeGreaterThanOrEqual(48)
  expect(box!.width).toBeGreaterThanOrEqual(48)
  await assertNoHorizontalOverflow(page)
  await retry.click()
  await expectLandedOnPhoneUpload(page)
  expect(api.requestCount('POST', RESOLVE)).toBe(2)
  expect(errors).toEqual([])
})

test('上传短链遇到 5xx 与断网同样给重试，不说已失效 @w5-mobile', async ({ page, api }) => {
  api.respondWith('POST', RESOLVE, (attempt) => (attempt === 1
    ? { status: 503, json: { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'unavailable' } } }
    : resolved))
  await page.goto(`/k/u/${SCENE}`)
  const root = page.locator('main[data-kiosk-screen="upload-scene-entry"]')
  await expect(root.getByRole('heading', { name: RETRYABLE, exact: true })).toBeVisible()
  await expect(root.getByText(UNUSABLE)).toHaveCount(0)
  await root.getByRole('button', { name: '重试', exact: true }).click()
  await expectLandedOnPhoneUpload(page)
})

test('登录短链格式对：换成手机确认登录页并带上票据 @w5-mobile', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  api.respond('GET', `/api/v1/member/auth/qr/${TICKET}/status`, {
    status: 200,
    json: { success: true, data: { status: 'pending', deviceLabel: 'KSK-001', returnTo: '/', expiresInSeconds: 180 } },
  })
  await page.goto(`/k/l/${TICKET}`)
  await expect(page).toHaveURL((url) => url.pathname === '/member/qr-login' && url.searchParams.get('ticketId') === TICKET)
  const root = page.locator('main[data-kiosk-screen="member-qr-login"]')
  await expect(root).toHaveAttribute('data-mobile-qr-state', 'ready')
  expect(api.requestCount('GET', `/api/v1/member/auth/qr/${TICKET}/status`)).toBe(1)
  await page.goBack()
  expect(page.url()).not.toContain('/k/l/')
  expect(errors).toEqual([])
})

test('登录短链格式不对：说明这不是一体机登录码，不查票据 @w5-mobile', async ({ page, api }) => {
  const errors = runtimeErrors(page)
  await page.goto('/k/l/not-a-kiosk-ticket')
  const root = page.locator('main[data-kiosk-screen="login-ticket-entry"]')
  await expect(root).toHaveAttribute('data-kiosk-presentation', 'fusion-youth')
  await expect(root).toHaveAttribute('data-kiosk-viewport', 'mobile')
  await expect(root.getByRole('heading', { name: NOT_KIOSK_TICKET, exact: true })).toBeVisible()
  await expect(page).toHaveURL((url) => url.pathname === '/k/l/not-a-kiosk-ticket')
  await expect(page.locator('main[data-kiosk-screen="member-qr-login"]')).toHaveCount(0)
  expect(api.requestCount('GET', '/api/v1/member/auth/qr/not-a-kiosk-ticket/status')).toBe(0)
  await assertNoHorizontalOverflow(page)
  expect(errors).toEqual([])
})
