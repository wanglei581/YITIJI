import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { RECRUITMENT_HOSTING_ON } from '../fixtures/recruitment-hosting'

/**
 * 系统键盘共享层：在正式构建的真实反馈页（/me/feedback）上验。
 * 真的 Windows 触摸键盘这里弹不出来，用假的 navigator.virtualKeyboard 报键盘位置；
 * 真机上键盘的高度、弹不弹、拼音组合，仍以真触摸屏验收为准。
 */
const MEMBER_PHONE = '13800138000'
const MEMBER_CODE = '123456'
const VIEWPORT_H = 1920
/** 键盘顶边离「反馈内容」框顶边的距离：保证这一格被键盘盖住。 */
const COVER_FROM_FIELD_TOP = 20
const MARGIN = 24

type Mode = 'push' | 'shrink' | 'scroll' | 'off'

function registerApi(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', { status: 200, json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true } })
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: {
      smartCampus: { enabled: false, modules: { welcome: false, bigdata: false, luggage: false, panorama: false }, items: [] },
      toolbox: { enabled: false, items: [] },
      ...RECRUITMENT_HOSTING_ON,
      configVersion: 'kbd-system-keyboard',
      refreshIntervalMs: 300000,
      serverTime: '2026-09-07T00:00:00.000Z',
    },
  })
  api.respond('GET', '/api/v1/jobs', { status: 200, json: { data: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } } })
  api.respond('GET', '/api/v1/job-fairs', { status: 200, json: { success: true, data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } })
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', { status: 200, json: { success: true, data: null } })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', { status: 200, json: { success: true, data: null } })
  api.respond('POST', '/api/v1/member/auth/sms-code', { status: 200, json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } } })
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 200,
    json: { success: true, data: { token: 'kbd-member-token', user: { id: 'member-kbd', phoneMasked: '138****8000', nickname: '键盘验收用户' } } },
  })
  api.respond('GET', '/api/v1/me/favorites', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
  api.respond('GET', '/api/v1/me/feedback', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
  // 点返回后落到「我的」，它会读这几份清单。
  for (const name of ['resumes', 'documents', 'print-orders', 'benefits', 'ai-records', 'pending-tasks']) {
    api.respond('GET', `/api/v1/me/${name}`, { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
  }
}

/** 页面加载前装一个假的系统键盘接口，并按需指定让位模式。 */
async function installFakeKeyboard(page: Page, mode: Mode): Promise<void> {
  await page.addInitScript(({ mode, viewportH }) => {
    ;(window as unknown as Record<string, unknown>).__kioskKeyboardAvoidMode = mode
    const vk = new EventTarget() as EventTarget & Record<string, unknown>
    vk.overlaysContent = false
    vk.boundingRect = new DOMRect(0, 0, 0, 0)
    const set = (top: number | null) => {
      vk.boundingRect = top === null ? new DOMRect(0, 0, 0, 0) : new DOMRect(0, top, window.innerWidth, viewportH - top)
      vk.dispatchEvent(new Event('geometrychange'))
    }
    vk.hide = () => set(null)
    vk.show = () => {}
    Object.defineProperty(navigator, 'virtualKeyboard', { value: vk, configurable: true })
    ;(window as unknown as Record<string, unknown>).__setFakeKeyboardTop = set
  }, { mode, viewportH: VIEWPORT_H })
}

async function openFeedbackForm(page: Page, api: ApiRouter, mode: Mode): Promise<void> {
  registerApi(api)
  await installFakeKeyboard(page, mode)
  await page.goto(`/login?from=${encodeURIComponent('/me/feedback')}`)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of MEMBER_PHONE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of MEMBER_CODE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/me/feedback')
  await expect(page.getByLabel('反馈内容')).toBeVisible()
}

const setKeyboardTop = (page: Page, top: number | null) =>
  page.evaluate((value) => (window as unknown as { __setFakeKeyboardTop(top: number | null): void }).__setFakeKeyboardTop(value), top)
const overlays = (page: Page) => page.evaluate(() => (navigator as unknown as { virtualKeyboard: { overlaysContent: boolean } }).virtualKeyboard.overlaysContent)
const stageTransform = (page: Page) => page.locator('.kiosk-stage').first().evaluate((el) => getComputedStyle(el).transform)
const scalerStyle = (page: Page) => page.locator('.kiosk-stage-scaler').first().getAttribute('style')
const hostStyle = (page: Page) => page.locator('.kiosk-stage-host').first().getAttribute('style')
const pushed = (page: Page) => page.locator('[data-kiosk-keyboard-pushed]')
const fieldRect = (page: Page, label: string) => page.getByLabel(label).evaluate((el) => {
  const rect = el.getBoundingClientRect()
  return { top: rect.top, bottom: rect.bottom }
})

/** 聚焦「反馈内容」，再让假键盘从它顶边下方一点开始盖住屏幕下半；返回键盘顶边。 */
async function coverContentField(page: Page): Promise<number> {
  const before = await fieldRect(page, '反馈内容')
  const keyboardTop = Math.round(before.top + COVER_FROM_FIELD_TOP)
  expect(before.bottom, '前提：这一格的底边在键盘顶边之下，确实会被盖住').toBeGreaterThan(keyboardTop)
  await page.getByLabel('反馈内容').focus()
  await setKeyboardTop(page, keyboardTop)
  return keyboardTop
}

test('上推：被键盘盖住的格子挪到键盘上方，舞台不缩，收起后不留痕迹 @kiosk', async ({ page, api }) => {
  await openFeedbackForm(page, api, 'push')
  expect(await overlays(page), '共享层启动后应接管键盘让位').toBe(true)
  const transform = await stageTransform(page)
  const scaler = await scalerStyle(page)
  expect(await hostStyle(page)).toBeNull()

  for (let round = 0; round < 5; round += 1) {
    const keyboardTop = await coverContentField(page)
    await expect.poll(async () => (await fieldRect(page, '反馈内容')).bottom, { message: `第 ${round + 1} 次：格子底边应在键盘顶边之上并留出余量` }).toBeLessThanOrEqual(keyboardTop - MARGIN + 1)
    expect((await fieldRect(page, '反馈内容')).bottom, '上推不该推过头').toBeGreaterThan(keyboardTop - MARGIN - 4)
    expect(await stageTransform(page), '上推模式下舞台缩放不变').toBe(transform)
    await expect(pushed(page)).toHaveCount(1)

    await page.getByLabel('反馈内容').pressSequentially('甲')
    await page.getByLabel('反馈内容').blur()
    await setKeyboardTop(page, null)
    await expect(pushed(page)).toHaveCount(0)
    expect(await scalerStyle(page), '收起后舞台元素样式回到原样').toBe(scaler)
    expect(await hostStyle(page)).toBeNull()
    expect(await stageTransform(page)).toBe(transform)
  }
  await expect(page.getByLabel('反馈内容')).toHaveValue('甲甲甲甲甲')

  for (const [name, value] of Object.entries({ autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' })) {
    await expect(page.getByLabel('反馈内容')).toHaveAttribute(name, value)
  }
})

test('上推：没被盖住的格子不动；页面自带键盘的格子不让位并压住系统键盘 @kiosk', async ({ page, api }) => {
  await openFeedbackForm(page, api, 'push')
  const title = await fieldRect(page, '标题（选填）')
  await page.getByLabel('标题（选填）').focus()
  await setKeyboardTop(page, Math.round(title.bottom + 200))
  await page.waitForTimeout(200)
  await expect(pushed(page)).toHaveCount(0)
  expect((await fieldRect(page, '标题（选填）')).top).toBe(title.top)
  await page.getByLabel('标题（选填）').blur()
  await setKeyboardTop(page, null)

  await page.getByLabel('联系电话（选填）').evaluate((el) => el.setAttribute('data-kiosk-keyboard', 'page'))
  const phone = await fieldRect(page, '联系电话（选填）')
  await page.getByLabel('联系电话（选填）').focus()
  await setKeyboardTop(page, Math.round(phone.top - 100))
  await page.waitForTimeout(200)
  await expect(page.getByLabel('联系电话（选填）')).toHaveAttribute('virtualkeyboardpolicy', 'manual')
  await expect(page.getByLabel('联系电话（选填）')).toHaveAttribute('inputmode', 'none')
  await expect(pushed(page)).toHaveCount(0)
})

test('缩小：舞台等比变小、整页在键盘上方，收起后恢复 @kiosk', async ({ page, api }) => {
  await openFeedbackForm(page, api, 'shrink')
  const transform = await stageTransform(page)
  const keyboardTop = await coverContentField(page)
  await expect.poll(() => stageTransform(page)).not.toBe(transform)
  await expect.poll(async () => (await fieldRect(page, '反馈内容')).bottom).toBeLessThanOrEqual(keyboardTop)
  await expect(pushed(page)).toHaveCount(0)
  await page.getByLabel('反馈内容').blur()
  await setKeyboardTop(page, null)
  await expect.poll(() => stageTransform(page)).toBe(transform)
  expect(await hostStyle(page)).toBeNull()
})

test('只滚动：不上推、不缩舞台 @kiosk', async ({ page, api }) => {
  await openFeedbackForm(page, api, 'scroll')
  const transform = await stageTransform(page)
  await coverContentField(page)
  await page.waitForTimeout(300)
  await expect(pushed(page)).toHaveCount(0)
  expect(await stageTransform(page)).toBe(transform)
})

test('关闭：不接管键盘、不补属性、不让位 @kiosk', async ({ page, api }) => {
  await openFeedbackForm(page, api, 'off')
  expect(await overlays(page)).toBe(false)
  const transform = await stageTransform(page)
  await coverContentField(page)
  await page.waitForTimeout(300)
  await expect(pushed(page)).toHaveCount(0)
  expect(await stageTransform(page)).toBe(transform)
  await expect(page.getByLabel('反馈内容')).not.toHaveAttribute('autocomplete', 'off')
})

test('上推着的时候按钮点得中；换页时通知系统键盘收起 @kiosk', async ({ page, api }) => {
  await openFeedbackForm(page, api, 'push')
  await coverContentField(page)
  await expect(pushed(page)).toHaveCount(1)
  await page.evaluate(() => {
    const vk = (navigator as unknown as { virtualKeyboard: Record<string, unknown> }).virtualKeyboard
    const hide = vk.hide as () => void
    vk.hide = () => { sessionStorage.setItem('kbd-fake-hidden', '1'); hide() }
  })
  // 点页面自己的返回（站内跳转）。这一下同时验：页面被上推着的时候，按钮点得中（按下时不能把页面放回原位）。
  await page.getByRole('button', { name: /返回/ }).last().click()
  await page.waitForURL((url) => url.pathname !== '/me/feedback')
  // 换页可能伴随整页刷新，标记放 sessionStorage 才留得住。
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('kbd-fake-hidden'))).toBe('1')
  await expect(pushed(page)).toHaveCount(0)
})
