import type { Locator, Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import { allowLocalBootTicket, loginThroughVisibleUi, registerPrivacyShell } from './fixtures/privacy-clear-shell'

// playwright.w3.config.ts 已接入 testMatch 和 @w3-kiosk；仅用页面时钟，不改隐私时限。
const NOTICE = '等你传文件期间，这台机器不会自动退出，请不要走开。二维码到期后没有操作，就会自动退出。'
const CASES = [
  { label: '简历来源', path: '/resume/source', purpose: 'resume_upload', qr: '.resume-source-phone-session svg[width="150"]', renew: '刷新二维码', leave: '返回 AI 简历服务' },
  { label: '打印上传', path: '/print/upload?source=document&tab=qr', purpose: 'print_doc', qr: '[data-testid="file-source-qr"] svg', renew: '重新出一张码', leave: '返回打印扫描' },
] as const

type ScanOpen = {
  label: string
  path: string
  purpose: string
  qr: string
  renew?: string
  leave?: string
  /** 为真时先走屏上手机号登录，再进 path。签名页未登录进不了选文件。 */
  login?: boolean
  /** 为真时把 signature_stamp 配成 available。签名页未配置即拒绝，没有扫码入口。 */
  signature?: boolean
  /** 覆盖默认的「简历来源页点手机扫码」。不传时，只有 resume_upload 会点那一下。 */
  open?: (page: Page) => Promise<void>
}

async function openWaiting(page: Page, api: ApiRouter, item: ScanOpen) {
  await page.clock.install()
  registerPrivacyShell(api)
  await allowLocalBootTicket(page)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', item.signature
    ? { status: 200, json: { capabilities: [{ capabilityKey: 'signature_stamp', status: 'available', configured: true, note: null, updatedAt: null }] } }
    : { status: 200, json: { success: true, data: { capabilities: [{ capabilityKey: 'usb_import', status: 'available', configured: true, note: null }] } } })
  api.respond('GET', '/api/v1/contract-reviews/consent-scope', {
    status: 200,
    json: {
      success: true,
      data: {
        consentVersion: 'v1.0',
        consentScopeHash: 'a'.repeat(64),
        disclaimer: {
          id: 'disclaimer-v1',
          version: 'v1.0',
          content: '本 AI 签约风险提示服务仅作条款风险提示，请自行核对原文。',
          publishedAt: '2026-09-01T00:00:00.000Z',
        },
        disclosures: {
          processorIdentityAndContact: 'provided_by_active_disclaimer',
          processingPurposeAndMethod: ['contract_risk_notice'],
          dataCategories: ['source_file', 'ocr_text', 'ai_review_result'],
          entrustedProcessingRoles: ['domestic_llm_as_ai_inference_processor'],
          retention: { maximumHours: 2, sessionDeletionFirst: true },
          dataSubjectRights: ['access', 'delete', 'withdraw_consent'],
          sensitivePersonalInformation: { separateConsentRequired: true, necessityAndImpactNoticeRequired: true },
        },
      },
    },
  })
  let creates = 0
  const cancelled: { id: string; control: string | undefined }[] = []
  const sessions = new Map<string, string>()
  // 置真后轮询回「文件已收到、等本机确认」。
  const phone = { uploaded: false }
  // URL 函数按 pathname 匹配，兼容查询串；Node 的 Date.now 不参与会话到期计算。
  await page.route((url) => /^\/api\/v1\/upload-sessions(?:\/[^/]+)?$/.test(url.pathname), async (route) => {
    const request = route.request()
    if (request.method() === 'POST') {
      const id = `scan-wait-${++creates}`
      const expiresAt = await page.evaluate(() => new Date(Date.now() + 600_000).toISOString())
      sessions.set(id, expiresAt)
      await route.fulfill({ json: { success: true, data: { sessionId: id, uploadToken: 'scan-upload', controlToken: `control-${id}`, uploadUrl: '/upload/phone', expiresAt } } })
      return
    }
    const id = new URL(request.url()).pathname.split('/').at(-1)!
    if (request.method() === 'DELETE') cancelled.push({ id, control: request.headers()['x-upload-session-control'] })
    // 即使轮询返回 pending，客户端仍须按真实 expiresAt 到期，不能被迟到的应答重新锁住。
    await route.fulfill({ json: { success: true, data: { sessionId: id, status: request.method() === 'DELETE' ? 'cancelled' : phone.uploaded ? 'uploaded' : 'pending', purpose: item.purpose, mode: 'temporary', file: phone.uploaded ? { fileId: 'scan-wait-file', filename: '手机传来的文件.pdf', mimeType: 'application/pdf', sizeBytes: 2048 } : null, requiresKioskConfirmation: phone.uploaded, expiresAt: sessions.get(id) } } })
  })
  if (item.login) {
    api.respond('POST', '/api/v1/member/auth/login', {
      status: 200,
      json: {
        success: true,
        data: {
          token: 'scan-wait-member',
          user: { id: 'member-scan-wait', phoneMasked: '138****8000', nickname: '扫码等待会员' },
        },
      },
    })
    await loginThroughVisibleUi(page, item.path.split('?')[0], '13800138000')
  } else {
    await page.goto(item.path)
  }
  // 简历来源页要先点「手机扫码上传」这条来源，上传码面板才出现。其它页用自己的 open。
  if (item.open) await item.open(page)
  else if (item.purpose === 'resume_upload') await page.getByRole('button', { name: /手机扫码上传/ }).click()
  await expect(page.getByText(NOTICE, { exact: true })).toBeVisible()
  await expect(page.locator(item.qr)).toBeVisible()
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000)
  return { cancelled, creates: () => creates, phone }
}

async function expectOriginalPage(page: Page, item: typeof CASES[number]) {
  await expect(page).toHaveURL((url) => url.pathname === item.path.split('?')[0])
  await expect(page.locator(item.qr)).toBeVisible()
  await expect(page.locator('[data-screen="session-guard"]')).toHaveCount(0)
}

async function expectTapTarget(locator: Locator) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  if (!box) return
  expect(box.width).toBeGreaterThanOrEqual(48)
  expect(box.height).toBeGreaterThanOrEqual(48)
  expect(await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return hit !== null && (hit === element || element.contains(hit))
  }), '按钮中心可由指针命中').toBe(true)
}

async function expectLayout(page: Page, qr: Locator) {
  expect(await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  })), '提示不造成页面横向溢出').toEqual({ body: 0, root: 0 })
  expect(await page.evaluate(() => ({
    body: document.body.scrollHeight - document.body.clientHeight,
    root: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  })), '提示不造成页面纵向溢出').toEqual({ body: 0, root: 0 })
  const box = await qr.boundingBox()
  expect(box).not.toBeNull()
  if (box) {
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  }
}

for (const item of CASES) {
  test(`${item.label}：等待 200 秒、60 秒提醒、触屏后过期及正常 180 秒清场 @w3-kiosk`, async ({ page, api }) => {
    await openWaiting(page, api, item)
    // a：查询 enabled 和指针命中都不触屏、不导航，证明简历页换来源的出口没被 phoneBusy 锁住。
    await page.clock.runFor(200_000)
    await expectOriginalPage(page, item)
    if (item.purpose === 'resume_upload') {
      // 手机扫码这一屏上换来源的出口是「回到来源选择」；等码期间它不能被锁住（03156ba28c 当初改 received 就为这个）。
      const back = page.getByRole('button', { name: '回到来源选择', exact: true })
      await expect(back).toBeEnabled()
      await expectTapTarget(back)
    }
    const qr = page.locator(item.qr)
    const before = await qr.boundingBox()
    // b：到第 545 秒，真实剩余不到 60 秒。
    await page.clock.runFor(345_000)
    const warning = page.getByRole('status').filter({ hasText: '二维码还剩' })
    await expect(warning).toHaveText(/二维码还剩 0:\d{2}。还在传的话点一下屏幕，到期后可以在这里重新出码。/)
    await expectLayout(page, qr)
    await page.screenshot({ path: test.info().outputPath('scan-wait-warning.png') })
    const after = await qr.boundingBox()
    expect(after?.width, '提示不挤小二维码').toBe(before?.width)
    expect(after?.height, '提示不挤小二维码').toBe(before?.height)
    // c：点提示条算一次真实 pointerdown；到期后原页仍在且重新出码按钮可点。
    await warning.click()
    await page.clock.runFor(56_000)
    await expect(page).toHaveURL((url) => url.pathname === item.path.split('?')[0])
    await expect(page.getByText(item.purpose === 'resume_upload' ? '二维码已过期' : '这张上传码已失效', { exact: true })).toBeVisible()
    const renew = page.getByRole('button', { name: item.renew, exact: true })
    await expect(renew).toBeEnabled()
    await expectTapTarget(renew)
    expect((await renew.boundingBox())!.height).toBeGreaterThanOrEqual(56)
    await expect(page.locator('[data-screen="session-guard"]')).toHaveCount(0)
    // 既有 180 秒包含最后 30 秒预警：150 秒开始预警，180 秒清场；不另加时限。
    await page.clock.runFor(140_000)
    await expect(page.locator('[data-screen="session-guard"]')).toHaveCount(0)
    await page.clock.runFor(15_000)
    await expect(page).toHaveURL(/\/session-timeout$/)
    await expect(page.locator('[data-screen="session-guard"]')).toBeVisible()
    await page.clock.runFor(26_000)
    await expect(page).toHaveURL(/\/$/)
  })

  test(`${item.label}：全程不触屏，码到期释放锁后硬清场回首页 @w3-kiosk`, async ({ page, api }) => {
    await openWaiting(page, api, item)
    await page.clock.runFor(545_000)
    await expectOriginalPage(page, item)
    await expect(page.getByRole('status').filter({ hasText: '二维码还剩' })).toBeVisible()
    await page.clock.runFor(58_000)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.locator('[data-screen="session-guard"]')).toHaveCount(0)
    await expect(page.locator(item.qr)).toHaveCount(0)
  })

  test(`${item.label}：等待中离页只作废一次旧会话 @w3-kiosk`, async ({ page, api }) => {
    const state = await openWaiting(page, api, item)
    expect(state.creates()).toBe(1)
    expect(state.cancelled).toHaveLength(0)
    await page.getByRole('button', { name: item.leave, exact: true }).click()
    await expect(page).not.toHaveURL((url) => url.pathname === item.path.split('?')[0])
    await expect.poll(() => state.cancelled.length).toBe(1)
    await page.clock.runFor(5_000)
    expect(state.cancelled).toEqual([{ id: 'scan-wait-1', control: 'control-scan-wait-1' }])
  })

  test(`${item.label}：过期按钮点击沿用旧码作废再建新码 @w3-kiosk`, async ({ page, api }) => {
    const state = await openWaiting(page, api, item)
    await page.clock.runFor(545_000)
    await page.getByRole('status').filter({ hasText: '二维码还剩' }).click()
    await page.clock.runFor(56_000)
    const renew = page.getByRole('button', { name: item.renew, exact: true })
    await expect(renew).toBeVisible()
    await renew.click()
    await expect(page.getByText(NOTICE, { exact: true })).toBeVisible()
    await expect(page.locator(item.qr)).toBeVisible()
    expect(state.creates()).toBe(2)
    expect(state.cancelled).toHaveLength(1)
  })
}

// 合规 10/10：文件已经传到、等本机点确认的那一段不算进顺延。这时屏上有文件名、下一步在本机，
// 人在手机上看到「上传成功」后可能转身就走；打印上传页这一段原来就是 180 秒清场，不能被带成 10 分钟。
test('打印上传：文件已收到后不再顺延，照常 150 秒预警、180 秒清场 @w3-kiosk', async ({ page, api }) => {
  const item = CASES[1]
  const state = await openWaiting(page, api, item)
  await page.clock.runFor(100_000)
  state.phone.uploaded = true
  await page.clock.runFor(10_000)
  await expect(page.getByText('手机传来的文件.pdf', { exact: false }).first()).toBeVisible()
  // 收到文件后常驻说明和忙碌锁一起撤掉：屏上不再说「不会自动退出」。
  await expect(page.getByText(NOTICE, { exact: true })).toHaveCount(0)
  await expect(page.locator('[data-screen="session-guard"]')).toHaveCount(0)
  // 轮询几秒内就读到「已收到」，无操作计时从那一刻起算：130 秒时还没预警，再过 30 秒已在预警，再过 40 秒已清场。
  await page.clock.runFor(130_000)
  await expect(page.locator('[data-screen="session-guard"]')).toHaveCount(0)
  await page.clock.runFor(30_000)
  await expect(page).toHaveURL(/\/session-timeout$/)
  await page.clock.runFor(40_000)
  await expect(page).toHaveURL(/\/$/)
  // 被清场时这个已收到文件的会话没有被悄悄确认。
  expect(state.cancelled.every((entry) => entry.id === 'scan-wait-1')).toBe(true)
})

// 合规 10/10 的另外五页。purpose 取自各页 UploadSessionQrPanel。
// 合同审查路由只在构建时 VITE_ENABLE_CONTRACT_REVIEW=true 才挂上，否则冷开会回首页。
// 面试设置的旧地址 /interview/setup 会 replace 到 /interview?stage=setup。
const HELD = [
  { label: '简历来源', path: '/resume/source', pathname: '/resume/source', purpose: 'resume_upload', qr: '.resume-source-phone-session svg[width="150"]', confirm: '确认使用这份简历' },
  {
    label: '面试设置',
    path: '/interview/setup',
    pathname: '/interview',
    stage: 'setup',
    purpose: 'resume_upload',
    qr: 'svg[width="150"]',
    confirm: '确认使用这份简历',
    open: async (page: Page) => { await page.getByRole('button', { name: /手机扫码上传/ }).click() },
  },
  { label: '合同审查', path: '/contract-review', pathname: '/contract-review', purpose: 'contract_upload', qr: 'svg[width="150"]', confirm: '确认使用这份合同' },
  {
    label: '图片转 PDF',
    path: '/print-scan/convert',
    pathname: '/print-scan/convert',
    purpose: 'print_doc',
    qr: 'svg[width="150"]',
    confirm: '确认加入待合并列表',
    open: async (page: Page) => { await page.getByTestId('img2pdf-add-phone').click() },
  },
  {
    label: '签名',
    path: '/print-scan/sign',
    pathname: '/print-scan/sign',
    purpose: 'print_doc',
    qr: 'svg[width="150"]',
    confirm: '确认使用该文档',
    login: true,
    signature: true,
    open: async (page: Page) => { await page.getByTestId('sign-stamp-pick-doc-phone').click() },
  },
] as const

function stillOnHeld(url: URL, item: typeof HELD[number]) {
  if (url.pathname !== item.pathname) return false
  if ('stage' in item && url.searchParams.get('stage') !== item.stage) return false
  return true
}

for (const item of HELD) {
  test(`${item.label}：文件还没到时，等满 200 秒仍不会被清场 @w3-kiosk`, async ({ page, api }) => {
    await openWaiting(page, api, item)
    // 200 秒超过普通页 180 秒清场。锁还在时必须停在原页，二维码还在，不进预警。
    await page.clock.runFor(200_000)
    await expect(page).toHaveURL((url) => stillOnHeld(url, item))
    await expect(page.locator(item.qr)).toBeVisible()
    await expect(page.getByText(NOTICE, { exact: true })).toBeVisible()
    await expect(page.locator('[data-screen="session-guard"]')).toHaveCount(0)
  })

  test(`${item.label}：文件已收到、没人点确认，150 秒进预警、180 秒清场回首页 @w3-kiosk`, async ({ page, api }) => {
    // 记下每一次确认请求：被清场不等于替人点了确认。
    const confirms: string[] = []
    page.on('request', (request) => {
      if (/\/upload-sessions\/[^/]+\/confirm$/.test(new URL(request.url()).pathname)) confirms.push(request.url())
    })
    const state = await openWaiting(page, api, item)
    await page.clock.runFor(100_000)
    state.phone.uploaded = true
    await page.clock.runFor(10_000)
    await expect(page.getByText('手机传来的文件.pdf', { exact: false }).first()).toBeVisible()
    await expect(page.getByText(NOTICE, { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: item.confirm, exact: true })).toBeEnabled()
    await expect(page.locator('[data-screen="session-guard"]')).toHaveCount(0)
    // 轮询几秒内读到「已收到」，无操作从那一刻起算。不点确认。
    await page.clock.runFor(130_000)
    await expect(page.locator('[data-screen="session-guard"]')).toHaveCount(0)
    await page.clock.runFor(30_000)
    await expect(page).toHaveURL(/\/session-timeout$/)
    await page.clock.runFor(40_000)
    await expect(page).toHaveURL(/\/$/)
    expect(confirms).toEqual([])
    // 2026-10-12（合规 10/11，第八次）：人走了、文件已传到没确认，清场时这一份当场作废（服务端连文件一起删），
    // 只作废这一个会话、带它自己的控制令牌、只发一次。以前这里跳过已收到的会话，一个作废请求都没有。
    expect(state.cancelled).toEqual([{ id: 'scan-wait-1', control: 'control-scan-wait-1' }])
  })
}
