import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page, Route } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import type { DocumentProcessTaskView } from '../../src/services/api/materials'
import { test, expect } from '../fixtures/kiosk-test'
import { RECRUITMENT_HOSTING_OFF, terminalConfigWithHosting } from '../fixtures/recruitment-hosting'
import { assertNoElementCrossesViewport, assertNoHorizontalOverflow, assertTapTargetPointerHit, readEnabledStageScale } from './assert-layout'
import { FusionW2BinaryRoute } from './fixtures/fusion-w2-binary-route'
import { isAbortedPdfjsBlobImport } from './fixtures/pdf-preview-blob-abort'
import { seedMaterialSession, seedPrintHandoff, setReactRouterState, writeMaterialSession, writePrintHandoff, W2_FILE, W2_ORDER, W2_PRINT_PARAMS, type PrintHandoffSeed } from './fixtures/fusion-w2-state'

const NOW = '2026-07-24T00:00:00.000Z'
const LATER = '2099-07-24T00:10:00.000Z'
// playwright.w2.config.ts 的 webServer 用 VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN 构建出这个值，
// terminalAuth 在 E2E 构建下拿它当**初始**终端会话票（套件不走引导票交换，sessionStorage 起初是空的）。
// 下面的断言逐字对齐它，而不是只判非空 —— 判非空的话，只要将来有谁往请求里塞了同名但无关的头，
// 用例照样绿。
const TERMINAL_SESSION_FIXTURE = 'playwright-terminal-session-fixture'
// 续期应答下发的新票。初始票一旦被它换掉，terminalAuth 读到的就必须是这一张 ——
// 「等完换票再组请求头」这件事的全部可观察性都落在这两个值不相等上：若哪天 headers 又被挪回
// await 之前，发出去的会是上面那张初始票，下面钉住本值的断言当场红。
const TERMINAL_SESSION_ROTATED = 'w2-rotated-terminal-session'

function collectRuntimeErrors(page: Page, ignoredDocumentPath?: string): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    if (request.resourceType() === 'document' && new URL(request.url()).pathname === ignoredDocumentPath) return
    if (isAbortedPdfjsBlobImport(request)) return
    if (['document', 'script', 'stylesheet'].includes(request.resourceType())) {
      errors.push(`${request.resourceType()}: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`)
    }
  })
  return errors
}

// 2026-08-18：打印预览 / 确认页新增依赖 GET /terminals/:id/capabilities —— 彩色与双面
// 改为按**本机**能力登记决定可用性（服务端 fail-closed 门禁的体验层镜像）。
// 这里给的是**未验证机器的生产默认态**：真实后端对一台没有任何 TerminalCapability 行的
// 终端就是这样回的（每个键都下发，但 configured=false）。Kiosk 只采信 configured=true 的行，
// 因此彩色/双面在默认夹具下保持禁用 —— 与放开之前的用户可见结果一致。
const UNVERIFIED_CAPABILITIES = [
  'document_print',
  'phone_upload',
  'cloud_upload',
  'usb_import',
  'material_pack',
  'scan',
  'copy',
  'id_photo',
  'format_convert',
  'signature_stamp',
  'color_print',
  'duplex_print',
].map((capabilityKey) => ({
  capabilityKey,
  status: 'not_verified',
  note: null,
  configured: false,
  updatedAt: null,
}))

function registerShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { terminalCode: 'KSK-001', capabilities: UNVERIFIED_CAPABILITIES },
  })
  api.respond('GET', '/api/v1/materials/tasks/w2-inspection-001/print-param-suggestions', {
    status: 200,
    json: { success: true, data: printParamSuggestions() },
  })
}

function registerPrice(api: ApiRouter): void {
  api.respond('GET', '/api/v1/print/price-config', {
    status: 200,
    json: {
      billingEnabled: true,
      items: [
        { serviceKey: 'print_bw_page', unitCents: 100, unit: 'page', description: '黑白打印' },
        { serviceKey: 'print_color_page', unitCents: 200, unit: 'page', description: '彩色打印' },
      ],
    },
  })
}

/**
 * 打印交接统一（商用收口 P0-5）之后，打印台 / 确认页只认打印交接上下文，跳转临时状态里的文件一律不看。
 * 以前这些用例用 setReactRouterState 把文件塞进临时状态造数；现在改为写一份 v2 上下文再重载。
 */
async function openWithHandoff(page: Page, path: string, seed: PrintHandoffSeed): Promise<void> {
  await page.goto(path)
  await writePrintHandoff(page, seed)
  await page.reload({ waitUntil: 'domcontentloaded' })
}

test('pickup scanner auto-submits once and Enter suffix is deduplicated @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  let claimCount = 0
  let submittedCode = ''
  await page.route('**/api/v1/print/jobs/claim-pickup', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    claimCount += 1
    const body = route.request().postDataJSON() as { code?: string }
    submittedCode = body.code ?? ''
    // Keep the input mounted long enough to deliver the HID scanner's trailing
    // Enter. This makes the assertion exercise the submit lock instead of
    // passing only because the success screen replaced the input first.
    await new Promise(resolve => setTimeout(resolve, 150))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        released: false,
        orderId: 'w2-pickup-order',
        orderNo: 'ORD-W2-PICKUP',
        terminalId: 'KSK-001',
        amountCents: 100,
        priceLines: [],
        paymentSessionToken: 'w2-payment-session-token',
      }),
    })
  })

  await page.goto('/print/pickup-claim')
  const input = page.getByLabel('到机码输入框')
  await expect(page.locator('[data-w2-page="pickup-claim"]')).toBeVisible()
  // 未扫码时指引必须可见：机身扫码区位置 + 亮度（真机 A5/A3），不能等扫到才出现。
  await expect(page.getByText('机身侧面的扫码区')).toBeVisible()
  await expect(page.getByText('亮度调高')).toBeVisible()
  await assertNoHorizontalOverflow(page)
  await input.pressSequentially('AB2C7M9P3K', { delay: 5 })
  await input.press('Enter')

  await expect(page.getByText('订单核验成功', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '进入现场支付' })).toBeVisible()
  expect(submittedCode).toBe('AB2C7M9P3K')
  expect(claimCount).toBe(1)
  expect(errors).toEqual([])
})

test('pickup controls remain readable in Windows landscape @pickup-landscape', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  await page.route('**/api/v1/print/jobs/claim-pickup', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        released: false,
        orderId: 'w2-landscape-order',
        orderNo: 'ORD-W2-LANDSCAPE',
        terminalId: 'KSK-001',
        amountCents: 100,
        priceLines: [],
        paymentSessionToken: 'w2-landscape-payment-session-token',
      }),
    })
  })

  await page.goto('/print/pickup-claim')

  const input = page.getByLabel('到机码输入框')
  // 11-arrival-code.html 主按钮是「确认校验」，不是旧壳「确认取件」。
  // 横屏电脑走 1080×1920 舞台缩放：控件必须可见，高度除回 scale 后仍 ≥56 CSS px。
  const submit = page.getByRole('button', { name: '确认校验' })
  // 同稿 outs()：「码找不到了？」取代旧壳「怎么找到机码？」；仍是找不到码时的兜底说明。
  const help = page.getByText('码找不到了？')
  await expect(input).toBeVisible()
  await expect(submit).toBeVisible()
  await expect(help).toBeVisible()
  await assertNoHorizontalOverflow(page)

  const [inputBox, submitBox] = await Promise.all([input.boundingBox(), submit.boundingBox()])
  const scale = await readEnabledStageScale(page)
  expect((inputBox?.height ?? 0) / scale).toBeGreaterThanOrEqual(56)
  expect((submitBox?.height ?? 0) / scale).toBeGreaterThanOrEqual(56)
  const layout = await page.locator('.ui-kiosk-content').evaluate((node) => {
    const submitButton = node.querySelector<HTMLElement>('.pcp-submit')
    const contentRect = node.getBoundingClientRect()
    const submitRect = submitButton?.getBoundingClientRect()
    return {
      overflowY: node.scrollHeight - node.clientHeight,
      submitVisible: Boolean(submitRect && submitRect.top >= contentRect.top && submitRect.bottom <= contentRect.bottom),
    }
  })
  expect(layout.overflowY).toBeLessThanOrEqual(8)
  expect(layout.submitVisible).toBe(true)

  await input.fill('AB2C7M9P3K')
  const paymentButton = page.getByRole('button', { name: '进入现场支付' })
  await expect(paymentButton).toBeVisible()
  const successFits = await page.locator('.ui-kiosk-content').evaluate((node) => {
    const action = node.querySelector<HTMLElement>('.pcs-primary')
    const contentRect = node.getBoundingClientRect()
    const actionRect = action?.getBoundingClientRect()
    return Boolean(actionRect && actionRect.top >= contentRect.top && actionRect.bottom <= contentRect.bottom)
  })
  expect(successFits).toBe(true)
  expect(errors).toEqual([])
})

test('pickup manual fallback normalizes the displayed code before claiming @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  let submittedCode = ''
  await page.route('**/api/v1/print/jobs/claim-pickup', async (route) => {
    submittedCode = (route.request().postDataJSON() as { code?: string }).code ?? ''
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        released: false,
        orderId: 'w2-manual-order',
        orderNo: 'ORD-W2-MANUAL',
        terminalId: 'KSK-001',
        amountCents: 100,
        priceLines: [],
        paymentSessionToken: 'w2-manual-payment-session-token',
      }),
    })
  })

  await page.goto('/print/pickup-claim')
  await page.getByLabel('到机码输入框').fill('ab-2c-7m-9p-3k')

  await expect(page.getByText('订单核验成功', { exact: true })).toBeVisible()
  expect(submittedCode).toBe('AB2C7M9P3K')
  expect(errors).toEqual([])
})

// 2026-08-18：取件码改为 8 位纯数字，过渡期同时受理 10 位存量码。
// 这条守的是「两种长度共用一个输入框」引出的那个真实陷阱：存量码字符集含 2–9，
// 因此旧码前 8 位可能恰好全是数字（(8/31)^8 ≈ 1/50000）。若读满 8 位就提交，
// 这类已付费用户会被永久卡在「截断 → 认领失败 → 输入被清空」的循环里。
// 页面用 250ms 静默窗口区分两者：扫码器按键间隔约 5ms，10 位码 <100ms 读完，
// 永远不会命中 8 位分支。
test('pickup accepts 8-digit codes without truncating a legacy 10-char code @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  const submitted: string[] = []
  await page.route('**/api/v1/print/jobs/claim-pickup', async (route) => {
    submitted.push(JSON.parse(route.request().postData() ?? '{}').code)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        released: false,
        orderId: 'order-w2-digit',
        orderNo: 'ORD-W2-DIGIT',
        terminalId: 'KSK-001',
        taskStatus: 'awaiting_payment',
        printTaskStatus: 'awaiting_payment',
        amountCents: 100,
        priceLines: [],
        paymentSessionToken: 'w2-digit-payment-session-token',
      }),
    })
  })

  await page.goto('/print/pickup-claim')
  const input = page.getByLabel('到机码输入框')
  await expect(input).toBeVisible()
  // 纯数字码必须唤起数字键盘，而不是全键盘。
  await expect(input).toHaveAttribute('inputmode', 'numeric')

  // 前 8 位全为数字的存量码：逐字符输入，不得在第 8 位被提交。
  await input.pressSequentially('23456789', { delay: 5 })
  expect(submitted).toEqual([])
  await input.pressSequentially('AB', { delay: 5 })
  await expect(page.getByText('订单核验成功', { exact: true })).toBeVisible()
  expect(submitted).toEqual(['23456789AB'])

  // 8 位新码：静默 250ms 后自动核销，无需按钮。
  await page.getByRole('button', { name: '再取一件' }).click()
  await input.pressSequentially('28491703', { delay: 5 })
  await expect(page.getByText('订单核验成功', { exact: true })).toBeVisible()
  expect(submitted).toEqual(['23456789AB', '28491703'])
  expect(errors).toEqual([])
})

test('pickup invalid code is rejected, cleared, and ready for the next scan @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  let claimCount = 0
  await page.route('**/api/v1/print/jobs/claim-pickup', async (route) => {
    claimCount += 1
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        error: { code: 'PICKUP_CODE_INVALID', message: '到机码无效或已过期' },
      }),
    })
  })

  await page.goto('/print/pickup-claim')
  const input = page.getByLabel('到机码输入框')
  await input.fill('AB2C7M9P3K')

  await expect(page.getByRole('alert')).toHaveText(/到机码无效或已过期/)
  await expect(input).toHaveValue('')
  await expect(input).toBeFocused()
  expect(claimCount).toBe(1)
  expect(errors).toEqual([])
})

test('pickup hid guidance is visible before any scan and both draft controls work @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)

  await page.goto('/print/pickup-claim')
  const hidEntry = page.getByRole('button', { name: /把手机上的码，对准机身侧面的扫码区/ })
  await expect(hidEntry).toBeVisible()
  await expect(page.getByText('亮度调高')).toBeVisible()
  await expect(page.getByText('扫码器就绪')).toHaveCount(0)
  await assertTapTargetPointerHit(hidEntry)
  await assertNoElementCrossesViewport(page)

  await hidEntry.click()
  await expect(page.getByTestId('arrival-code-state-hid')).toBeVisible()
  await expect(page.getByText('请出示手机上的码')).toBeVisible()
  await expect(page.getByText('等待扫码输入')).toBeVisible()
  await expect(page.getByText('机身侧面的扫码区')).toBeVisible()
  await expect(page.getByText('亮度调高')).toBeVisible()
  await expect(page.getByText('扫码器就绪')).toHaveCount(0)

  const typeInstead = page.getByRole('button', { name: '还是手输吧' })
  const askHelp = page.getByRole('button', { name: '扫不出来？求助' })
  await expect(typeInstead).toBeVisible()
  await expect(askHelp).toBeVisible()
  const [typeBox, helpBox] = await Promise.all([typeInstead.boundingBox(), askHelp.boundingBox()])
  expect(typeBox?.height ?? 0).toBeGreaterThanOrEqual(56)
  expect(helpBox?.height ?? 0).toBeGreaterThanOrEqual(56)
  await assertTapTargetPointerHit(typeInstead)
  await assertTapTargetPointerHit(askHelp)
  await assertNoElementCrossesViewport(page)

  await typeInstead.click()
  await expect(page.getByRole('button', { name: '确认校验' })).toBeVisible()
  await expect(page.getByTestId('arrival-code-state-hid')).toHaveCount(0)

  await page.getByRole('button', { name: '用机身扫码区' }).click()
  await expect(page.getByTestId('arrival-code-state-hid')).toBeVisible()
  await askHelp.click()
  await expect(page).toHaveURL(/\/help$/)
  await expect(page.locator('[data-kiosk-screen="help"]')).toBeVisible()
  expect(errors).toEqual([])
})

test('pickup 问小青 hands one draft to the assistant: prefilled once, never sent by itself @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  // 顾问页挂载时读终端配置与语音能力；形状同 W3 基线，招聘托管按云上默认关闭。
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: terminalConfigWithHosting(RECRUITMENT_HOSTING_OFF, 'w2-assistant-draft'),
  })
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200,
    json: { data: { asrEnabled: false, ttsEnabled: false } },
  })

  await page.goto('/print/pickup-claim')
  await expect(page.locator('[data-w2-page="pickup-claim"]')).toBeVisible()
  await page.getByRole('button', { name: '问小青：到机码怎么找 →' }).click()
  await expect(page).toHaveURL(/\/assistant$/)
  // 只填进输入框；发送会清空它，所以草稿还在就说明没有自动发出。
  await expect(page.getByLabel('输入咨询问题')).toHaveValue('手机打印订单里的到机码在哪里找？8 位新码和 10 位历史码怎么输入？')
  expect(api.requestCount('POST', '/api/v1/assistant/chat')).toBe(0)

  // 读过一次就没有了：回到到机码页，再从底栏进顾问页，输入框是空的。
  await page.goBack()
  await expect(page.locator('[data-w2-page="pickup-claim"]')).toBeVisible()
  await page.locator('.qx-nav-item', { hasText: 'AI 顾问' }).first().click()
  await expect(page).toHaveURL(/\/assistant$/)
  await expect(page.getByLabel('输入咨询问题')).toHaveValue('')
  expect(errors).toEqual([])
})

for (const help of [
  { path: '/print-scan', label: '问小青：怎么选打印方式 →', draft: '我想打印一份文件，应该选手机上传、U 盘还是扫描？请帮我选一种方式。' },
  { path: '/print/upload?source=document', label: '问小青：这份文件怎么检查 →', draft: '这份文件要怎么检查？检查会看哪些内容？' },
  { path: '/print/desk?step=check', label: '问小青：保留和遮挡有什么区别 →', draft: '材料检查发现了个人信息片段，保留和遮挡有什么区别？' },
  { path: '/print/desk?step=preview', label: '问小青：帮我选打印参数 →', draft: '帮我选打印参数：黑白还是彩色、单面还是双面？' },
]) {
  test(`M1 AI help hands off the current question once: ${help.path} @w2`, async ({ page, api }) => {
    const errors = collectRuntimeErrors(page, W2_FILE.fileUrl)
    registerShell(api)
    api.respond('GET', '/api/v1/terminals/KSK-001/config', { status: 200, json: terminalConfigWithHosting(RECRUITMENT_HOSTING_OFF, 'w4-m1-assistant-draft') })
    api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', { status: 200, json: { data: { asrEnabled: false, ttsEnabled: false } } })
    if (help.path.endsWith('preview')) {
      registerPrice(api)
      const binary = new FusionW2BinaryRoute(page)
      await binary.install()
      await seedMaterialSession(page)
    }
    await page.goto(help.path)
    await page.getByRole('button', { name: help.label, exact: true }).click()
    await expect(page).toHaveURL(/\/assistant$/)
    await expect(page.getByLabel('输入咨询问题')).toHaveValue(help.draft)
    expect(api.requestCount('POST', '/api/v1/assistant/chat')).toBe(0)
    await page.goto('/print/upload?source=document')
    await page.locator('.qx-nav-item', { hasText: 'AI 顾问' }).first().click()
    await expect(page.getByLabel('输入咨询问题')).toHaveValue('')
    expect(api.requestCount('POST', '/api/v1/assistant/chat')).toBe(0)
    expect(errors).toEqual([])
  })
}

test('pickup hid scan posts the claim payload and renders the server result @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  let submittedCode = ''
  await page.route('**/api/v1/print/jobs/claim-pickup', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    submittedCode = (route.request().postDataJSON() as { code?: string }).code ?? ''
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        released: false,
        orderId: 'w2-hid-order',
        orderNo: 'ORD-W2-HID',
        terminalId: 'KSK-001',
        amountCents: 100,
        priceLines: [],
        paymentSessionToken: 'w2-hid-payment-session-token',
      }),
    })
  })

  await page.goto('/print/pickup-claim')
  await page.getByRole('button', { name: /把手机上的码，对准机身侧面的扫码区/ }).click()
  await expect(page.getByTestId('arrival-code-state-hid')).toBeVisible()
  await expect(page.getByText('等待扫码输入')).toBeVisible()

  const input = page.getByLabel('到机码输入框')
  await input.pressSequentially('AB2C7M9P3K', { delay: 5 })

  await expect(page.getByText('订单核验成功', { exact: true })).toBeVisible()
  await expect(page.getByText('ORD-W2-HID')).toBeVisible()
  expect(submittedCode).toBe('AB2C7M9P3K')
  expect(errors).toEqual([])
})

test('pickup hid invalid code shows the server error without fabricating success @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  let claimCount = 0
  await page.route('**/api/v1/print/jobs/claim-pickup', async (route) => {
    claimCount += 1
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        error: { code: 'PICKUP_CODE_INVALID', message: '到机码无效或已过期' },
      }),
    })
  })

  await page.goto('/print/pickup-claim')
  await page.getByRole('button', { name: /把手机上的码，对准机身侧面的扫码区/ }).click()
  await page.getByLabel('到机码输入框').fill('AB2C7M9P3K')

  await expect(page.getByRole('alert')).toHaveText(/到机码无效或已过期/)
  await expect(page.getByText('订单核验成功')).toHaveCount(0)
  await expect(page.getByTestId('arrival-code-state-hid')).toBeVisible()
  expect(claimCount).toBe(1)
  expect(errors).toEqual([])
})

// ============================================================
// 到机认领 / 释放的终端身份闸门
//
// 后端 claim-pickup 与 :orderId/release 都由 TerminalIdentityGuard 把守：认领一枚到机码
// 会核销别人已付费的文件，释放会当场在本机创建打印任务并出纸 —— 这两件事只许在一台
// 经服务端签发过会话票的机器上发生，光带一个可以随手编的 x-terminal-id 不算数。
// 前台侧的判据就是「这两条请求必须经 terminalProtectedFetch 发出」。
//
// 本块钉认领两条；释放那条在下面收银段（Order-only release ...），
// 另有一条钉 takeaway-url **不得**被一起升级成终端限定接口（在 print-done 段）。
// ============================================================

test('pickup claim carries the terminal session token, not just the terminal id @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('POST', '/api/v1/print/jobs/claim-pickup', {
    status: 200,
    json: {
      released: false,
      orderId: 'w2-terminal-auth-order',
      orderNo: 'ORD-W2-TERMINAL-AUTH',
      terminalId: 'KSK-001',
      amountCents: 100,
      priceLines: [],
      paymentSessionToken: 'w2-terminal-auth-payment-session',
    },
  })
  const claimRequest = page.waitForRequest(
    (request) =>
      request.method() === 'POST'
      && new URL(request.url()).pathname === '/api/v1/print/jobs/claim-pickup',
  )

  await page.goto('/print/pickup-claim')
  await page.getByLabel('到机码输入框').pressSequentially('12345678', { delay: 5 })
  await expect(page.getByText('订单核验成功', { exact: true })).toBeVisible()

  const claimHeaders = (await claimRequest).headers()
  expect(
    claimHeaders['x-terminal-session-token'],
    '认领请求必须带服务端签发的终端会话票；裸 fetch 只会带上谁都能编的 x-terminal-id',
  ).toBe(TERMINAL_SESSION_FIXTURE)
  expect(claimHeaders['x-terminal-id']).toBe('KSK-001')
  expect(errors).toEqual([])
})

test('a terminal-session 401 on claim never replays the rejected session @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  // 认领被判会话无效，续期也被拒 —— 这台机器的会话票是真的废了。
  // 正确行为是当场诚实失败：既不能拿刚被拒的那张票把 claim 再打一遍（重放只会再被拒，
  // 还白扣一次 20 次/min 的限流额度），也不能把它说成「到机码不对」让用户去重输码。
  api.respond('POST', '/api/v1/print/jobs/claim-pickup', {
    status: 401,
    json: { error: { code: 'TERMINAL_SESSION_INVALID', message: '终端安全会话无效' } },
  })
  api.respond('POST', '/api/v1/terminals/session-token/refresh', {
    status: 401,
    json: { error: { code: 'TERMINAL_SESSION_INVALID', message: '终端安全会话无效' } },
  })
  const claimSessions: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'POST') return
    if (new URL(request.url()).pathname !== '/api/v1/print/jobs/claim-pickup') return
    claimSessions.push(request.headers()['x-terminal-session-token'] ?? '')
  })

  await page.goto('/print/pickup-claim')
  await page.getByLabel('到机码输入框').pressSequentially('87654321', { delay: 5 })

  await expect(page.getByRole('alert')).toHaveText(/这台机器的安全校验没通过/)
  await expect(page.getByText('订单核验成功')).toHaveCount(0)
  // 恰好一次，且带的就是那张票：没有用旧票重放，也没有在续期失败后继续发请求。
  expect(claimSessions).toEqual([TERMINAL_SESSION_FIXTURE])
  expect(api.requestCount('POST', '/api/v1/terminals/session-token/refresh')).toBe(1)
  expect(errors).toEqual([])
})

// ── 正常续期窗口：等票，而不是把用户判死 ──────────────────────────────────
//
// 健康的一体机每十分钟续一次会话票，续期那一两秒里 terminalAuth 的 state 真的是
// checking。下面三条用例守的就是这个窄窗口：用户恰好在这时按「到机认领」或付款成功
// 触发 Order-only 释放时，请求必须**等这次续期出结果**再发，而不是当场报
// 「终端安全校验失败，请联系现场工作人员」—— 票其实好好的，只是正在换。
//
// 为什么不能只靠 VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN 那条路：E2E 构建里会话恒为
// ready，checking 窗口在浏览器里根本进不去（缺陷正是长在那段没人跑过的代码里）。
// 因此这里用 terminalAuth 只在 E2E 构建挂出的测试缝发起一次**真实**续期
// （与十分钟定时器调的是同一个 retryRefresh），再用路由 mock 扣住应答控制时机。
// 状态仍由真实代码写、票仍由真实代码读发，用例控制的只有「续期什么时候回来」。
//
// 「等」只是一半：等完之后发出去的必须是**换回来的那张票**。所以下面的应答下发
// TERMINAL_SESSION_ROTATED，断言钉的也是它 —— 只断言「请求发生在放行之后」是钉不住这件事的，
// 请求可以等完再发却仍然带着等待之前就组好的旧票，后端照样 401。

interface HeldRefresh {
  /** 续期请求已经真的打到路由 mock。 */
  arrived: Promise<void>
  /** 放行这次续期的应答。 */
  open: () => void
}

function holdTerminalRefresh(api: ApiRouter, response: { status: number; json: unknown } = {
  status: 200,
  json: { sessionToken: TERMINAL_SESSION_ROTATED },
}): HeldRefresh {
  let open: () => void = () => undefined
  const gate = new Promise<void>((resolve) => { open = resolve })
  let received: () => void = () => undefined
  const arrived = new Promise<void>((resolve) => { received = resolve })
  api.respondWith('POST', '/api/v1/terminals/session-token/refresh', async () => {
    received()
    await gate
    return response
  })
  return { arrived, open: () => open() }
}

async function startTerminalSessionRefresh(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hooks = (window as unknown as { __terminalSessionE2E?: { startRefresh: () => void } }).__terminalSessionE2E
    // 缺了测试缝就是构建没带 E2E 标记，用例必须当场失败：否则它会退化成
    // 「会话一直是 ready」的假绿，钉不住任何等待行为。
    if (!hooks) throw new Error('terminalAuth 的 E2E 测试缝缺失，无法进入 checking 窗口')
    hooks.startRefresh()
  })
}

async function terminalSessionStateOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const hooks = (window as unknown as { __terminalSessionE2E?: { state: () => string } }).__terminalSessionE2E
    return hooks ? hooks.state() : 'missing'
  })
}

test('pickup claim during a normal session refresh waits for the new ticket @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('POST', '/api/v1/print/jobs/claim-pickup', {
    status: 200,
    json: {
      released: false,
      orderId: 'w2-refresh-window-order',
      orderNo: 'ORD-W2-REFRESH-WINDOW',
      terminalId: 'KSK-001',
      amountCents: 100,
      priceLines: [],
      paymentSessionToken: 'w2-refresh-window-payment-session',
    },
  })
  const refresh = holdTerminalRefresh(api)
  const claimRequest = page.waitForRequest(
    (request) =>
      request.method() === 'POST'
      && new URL(request.url()).pathname === '/api/v1/print/jobs/claim-pickup',
  )

  await page.goto('/print/pickup-claim')
  await startTerminalSessionRefresh(page)
  await refresh.arrived
  expect(await terminalSessionStateOf(page), '续期在飞时会话状态必须真的是 checking').toBe('checking')

  await page.getByLabel('到机码输入框').pressSequentially('12345678', { delay: 5 })
  // 输满静默 250ms 后提交已经发生（页面进入认领中），但请求必须还扣在手里等换票。
  await expect(page.locator('[data-w2-page="pickup-claim"][data-claim-state="loading"]')).toBeVisible()
  await page.waitForTimeout(700)
  expect(
    api.requestCount('POST', '/api/v1/print/jobs/claim-pickup'),
    '续期没出结果之前不许把认领请求发出去（旧票发出去只会被后端拒）',
  ).toBe(0)
  await expect(page.locator('#pcp-error-msg')).toHaveCount(0)

  refresh.open()
  await expect(page.getByText('订单核验成功', { exact: true })).toBeVisible()
  expect(api.requestCount('POST', '/api/v1/print/jobs/claim-pickup'), '等完只发一次认领').toBe(1)
  expect(
    api.requestCount('POST', '/api/v1/terminals/session-token/refresh'),
    '等的是在飞的那一次续期，不许自己再补发一次',
  ).toBe(1)
  // 等完还不够：发出去的必须是换回来的新票。头一旦在 await 之前就组好，这里读到的会是
  // TERMINAL_SESSION_FIXTURE —— 请求时机看着对，带的却是已经被换掉的票，后端照样判 401。
  const claimHeaders = (await claimRequest).headers()
  expect(
    claimHeaders['x-terminal-session-token'],
    '认领必须带续期换回来的新票；等于初始票就说明请求头在等待之前就组好了',
  ).toBe(TERMINAL_SESSION_ROTATED)
  expect(claimHeaders['x-terminal-id']).toBe('KSK-001')
  expect(await terminalSessionStateOf(page)).toBe('ready')
  expect(errors).toEqual([])
})

// 401 续期被扣住时，人还在就重放并带上新票；人走了或隐私清场（含 BFCache）就不再重放，
// 也不把上一单的订单号留在这块公共屏幕上。服务端那一次认领不取消、不回滚。
const LIFECYCLE_ORDER_NO = 'LIFECYCLE-OLD-ORDER'

function watchPostTokens(page: Page, path: string): string[] {
  const tokens: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'POST') return
    if (new URL(request.url()).pathname !== path) return
    tokens.push(request.headers()['x-terminal-session-token'] ?? '')
  })
  return tokens
}

/** 隐私清场会整页重载。这里只让 pageshow(persisted) 把 children 换成遮罩，截住那一次重载。 */
async function freezeBfCachePrivacyClear(page: Page): Promise<void> {
  await page.evaluate(() => {
    const raf = window.requestAnimationFrame
    const timeout = window.setTimeout
    window.requestAnimationFrame = () => 0
    window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) =>
      delay === 250 ? 0 : timeout(callback, delay, ...args)) as typeof window.setTimeout
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    window.requestAnimationFrame = raf
    window.setTimeout = timeout
  })
}

async function waitForRotatedSession(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('terminal_session_token_v1'))).toBe(TERMINAL_SESSION_ROTATED)
  await page.evaluate(() => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
  }))
}

for (const scenario of ['active', 'leave', 'privacy'] as const) {
  test(`pickup lifecycle claim refresh ${scenario} @w2`, async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    registerShell(api)
    const refresh = holdTerminalRefresh(api)
    const claimPath = '/api/v1/print/jobs/claim-pickup'
    const claimTokens = watchPostTokens(page, claimPath)
    page.on('request', (request) => {
      if (request.method() !== 'POST') return
      if (new URL(request.url()).pathname !== claimPath) return
      expect(request.postDataJSON()).toEqual({ code: '12345678' })
      expect(request.headers()['x-terminal-id']).toBe('KSK-001')
    })
    api.respondWith('POST', claimPath, (requestNumber) => (
      requestNumber === 1
        ? { status: 401, json: { error: { code: 'TERMINAL_SESSION_INVALID', message: 'Expired fixture' } } }
        : {
          status: 200,
          json: {
            released: false,
            orderId: 'lifecycle-order',
            orderNo: LIFECYCLE_ORDER_NO,
            terminalId: 'KSK-001',
            amountCents: 100,
            priceLines: [],
            paymentSessionToken: 'lifecycle-payment',
          },
        }
    ))

    try {
      await page.goto('/print/pickup-claim')
      await page.getByLabel('到机码输入框').pressSequentially('12345678', { delay: 5 })
      await refresh.arrived
      expect(api.requestCount('POST', claimPath)).toBe(1)
      expect(claimTokens).toEqual([TERMINAL_SESSION_FIXTURE])

      if (scenario === 'privacy') {
        await freezeBfCachePrivacyClear(page)
        await expect(page.getByTestId('session-guard-state-clearing')).toBeVisible()
        await expect(page.getByLabel('到机码输入框')).toHaveCount(0)
      } else if (scenario === 'leave') {
        await page.getByRole('button', { name: '返回打印扫描', exact: true }).click()
        await expect(page).toHaveURL(/\/print-scan$/)
      }

      const refreshed = page.waitForResponse('**/api/v1/terminals/session-token/refresh')
      refresh.open()
      await refreshed
      if (scenario === 'active') {
        await expect(page.getByText(LIFECYCLE_ORDER_NO)).toBeVisible()
        expect(api.requestCount('POST', claimPath)).toBe(2)
        expect(claimTokens).toEqual([TERMINAL_SESSION_FIXTURE, TERMINAL_SESSION_ROTATED])
      } else {
        await waitForRotatedSession(page)
        expect(api.requestCount('POST', claimPath), '离页或清场后不得重放认领').toBe(1)
        expect(claimTokens).toEqual([TERMINAL_SESSION_FIXTURE])
        await expect(page.getByText(LIFECYCLE_ORDER_NO)).toHaveCount(0)
        if (scenario === 'leave') await expect(page).toHaveURL(/\/print-scan$/)
        else await expect(page.getByTestId('session-guard-state-clearing')).toBeVisible()
      }
      expect(api.requestCount('POST', '/api/v1/terminals/session-token/refresh')).toBe(1)
      expect(errors).toEqual([])
    } finally {
      refresh.open()
    }
  })
}

function quoteResponseJson(opts?: { amountCents?: number; billablePages?: number; unitCents?: number }) {
  const billablePages = opts?.billablePages ?? 2
  const unitCents = opts?.unitCents ?? 100
  const amountCents = opts?.amountCents ?? billablePages * unitCents
  return {
    amountCents,
    billablePages,
    billingPageSource: 'detected' as const,
    priceLines: [
      {
        serviceKey: 'print_bw_page',
        description: '黑白打印',
        unitCents,
        quantity: billablePages,
        amountCents,
      },
    ],
  }
}

/** 确认页 POST /orders/quote；金额与 W2_ORDER / 价目夹具对齐。 */
function registerQuote(api: ApiRouter, opts?: { amountCents?: number; billablePages?: number; unitCents?: number }): void {
  api.respond('POST', '/api/v1/orders/quote', {
    status: 200,
    json: quoteResponseJson(opts),
  })
}

async function expectHealthy(page: Page, errors: string[], marker?: string): Promise<void> {
  await expect(page.locator('[data-kiosk-presentation="fusion-youth"]').first()).toBeVisible()
  if (marker) await expect(page.locator(`[data-w2-page="${marker}"]`)).toBeVisible()
  await assertNoHorizontalOverflow(page)
  expect(errors).toEqual([])
}

async function routeExactJson(
  page: Page,
  method: string,
  path: string,
  handler: (route: Route) => Promise<void>,
): Promise<void> {
  await page.route(`**${path}`, async (route) => {
    const request = route.request()
    if (request.method() !== method || new URL(request.url()).pathname !== path) {
      await route.fallback()
      return
    }
    await handler(route)
  })
}

function materialTask(kind: 'inspection' | 'normalize_a4' | 'pii_scan' | 'pii_redact'): DocumentProcessTaskView {
  const checks = kind === 'inspection'
    ? { pageCount: 2, canPrint: true, messages: [] }
    : kind === 'normalize_a4'
      ? { targetPaperSize: 'A4', canNormalize: true, messages: [] }
      : kind === 'pii_redact'
        ? {
            canRedact: true,
            claim: 'nothing_to_redact',
            redactedFileId: null,
            resultFileCreated: false,
            decisionTaskId: 'w2-pii_scan',
            findingCount: 0,
            redactedCount: 0,
            keptCount: 0,
            pendingCount: 0,
            items: [],
            reverify: { ran: false, method: null, remainingCount: null },
          }
      : undefined
  return {
    id: `w2-${kind}`,
    kind,
    status: 'completed',
    requesterMode: 'anonymous',
    accessToken: 'raw-w2-fixture-token',
    sourceFileId: W2_FILE.fileId,
    resultFileId: null,
    endUserId: null,
    params: {},
    result: kind === 'pii_redact' ? { mode: 'real', ...checks } : checks ? { mode: 'real', checks } : { mode: 'real' },
    errorCode: null,
    errorMessage: null,
    expiresAt: LATER,
    createdAt: NOW,
    updatedAt: NOW,
    ...(kind === 'pii_scan' ? { piiFindings: [] } : {}),
  }
}

function printParamSuggestions(overrides: Partial<Record<'copies' | 'colorMode' | 'duplex' | 'pagesPerSheet', string | number>> = {}) {
  const values = { copies: 2, colorMode: 'black_white', duplex: 'simplex', pagesPerSheet: 1, ...overrides }
  return {
    taskId: 'w2-inspection-001',
    featureKey: 'print_param_prefill',
    derivation: 'deterministic_rules',
    advisory: true,
    available: true,
    unavailableReason: null,
    capabilityProfile: {
      paperSize: 'A4', verifiedColorModes: ['black_white'], verifiedDuplexModes: ['simplex'],
      verifiedPagesPerSheet: [1], copiesRange: { min: 1, max: 99 }, note: 'fixture',
    },
    items: Object.entries(values).map(([field, suggestedValue]) => ({
      field,
      label: field === 'copies' ? '打印份数' : field === 'colorMode' ? '色彩模式' : field === 'duplex' ? '单双面' : '每张页数',
      status: 'suggested',
      suggestedValue,
      basis: { code: `W2_${field}`, evidenceLevel: 'E1', text: '基于文件体检事实', facts: {} },
      reason: null,
      blockedPreference: null,
      editable: true,
    })),
    notices: [],
    evidence: null,
    disclaimer: '只建议不裁决，确认前不会生效。',
    generatedAt: NOW,
  }
}

const cashierState = {
  file: W2_FILE,
  params: W2_PRINT_PARAMS,
  source: 'document',
  ...W2_ORDER,
  priceLines: [{
    serviceKey: 'print_bw_page', description: '黑白打印', unitCents: 100, quantity: 2, subtotalCents: 200,
  }],
}

function payStatus(payStatus: string, attempt: null | Record<string, unknown> = null, pickupCode: string | null = null) {
  return {
    orderId: W2_ORDER.orderId,
    orderNo: W2_ORDER.orderNo,
    payStatus,
    paymentSource: payStatus === 'paid' ? 'wechat' : null,
    payChannel: payStatus === 'paid' ? 'wechat' : null,
    amountCents: W2_ORDER.amountCents,
    paidAt: payStatus === 'paid' ? NOW : null,
    pickupCode,
    attempt,
  }
}

test('print intake keeps three upload sources and a separate scan CTA @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: {
      capabilities: [
        {
          capabilityKey: 'scan',
          status: 'available',
          note: null,
          configured: true,
          updatedAt: new Date().toISOString(),
        },
      ],
    },
  })

  await page.goto('/print/upload?source=document')
  await expect(page.locator('[data-w2-page="print-upload"]')).toBeVisible()
  await expect(page.locator('[data-qx-frame="true"]')).toBeVisible()
  await expect(page.getByRole('button', { name: /本机选文件/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /手机扫码上传/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /U 盘导入/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /扫描纸质原件|扫描原件/ })).toBeVisible()
  const primary = page.getByTestId('file-source-primary')
  await expect(primary).toBeVisible()
  await expect(primary).toBeDisabled()
  await expect(primary).toHaveText('下一步：材料检查')
  await expect(page.getByRole('button', { name: '问小青：这份文件怎么检查 →' })).toBeVisible()
  const firstSource = await page.locator('.fs-ch').first().boundingBox()
  expect(firstSource!.y, '2.0 来源按钮位于顶部只读区之后').toBeGreaterThanOrEqual(500)
  await expectHealthy(page, errors, 'print-upload')

  await page.getByRole('button', { name: /扫描纸质原件|扫描原件/ }).click()
  await page.waitForURL((url) => url.pathname === '/scan')
  await expect(page.getByRole('heading', { name: '材料扫描' })).toBeVisible()
  await expectHealthy(page, errors)
})

test('print upload does not skip privacy check without a file @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)

  await page.goto('/print/upload?source=document')
  await expect(page.locator('[data-testid="file-source-state-source-chooser"]')).toBeVisible()
  await page.getByTestId('file-source-primary').click({ force: true })
  await expect(page).toHaveURL(/\/print\/upload/)
  await expect(page.locator('[data-w2-page="print-upload"]')).toBeVisible()
  await expectHealthy(page, errors, 'print-upload')
})

test('material checks require a PII decision, create the redacted task, and carry the derived file forward @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page, '/w2-fixtures/sample-redacted.pdf')
  registerShell(api)
  // 青序流光版 /print/preview 进页就取参数建议（原型 13-print-desk 声明的
  // GET /materials/tasks/:id/print-param-suggestions）。这条测试用的 taskId 是
  // w2-inspection，此前没有 stub，会撞 ApiRouter 的 Unhandled API requests。
  // 建议为空表示「本机没有可给的建议」，是诚实空态，不影响本测试断言的 PII 决策链路。
  api.respond('GET', '/api/v1/materials/tasks/w2-inspection/print-param-suggestions', {
    status: 200,
    json: { success: true, data: { status: 'not_derivable', suggestions: [] } },
  })
  let decisionBody: unknown = null
  let redactionCreated = false
  await routeExactJson(page, 'POST', '/api/v1/materials/tasks', async (route) => {
    const body = route.request().postDataJSON() as { kind?: string }
    if (!['inspection', 'normalize_a4', 'pii_scan', 'pii_redact'].includes(body.kind ?? '')) {
      await route.abort('blockedbyclient')
      return
    }
    if (body.kind === 'pii_redact') redactionCreated = true
    const task = materialTask(body.kind as 'inspection' | 'normalize_a4' | 'pii_scan' | 'pii_redact')
    if (body.kind === 'pii_scan') {
      task.piiFindings = [{
        id: 'w2-finding-phone', taskId: task.id, type: 'phone', label: '手机号', pageNumber: 1,
        snippet: '13800138000', confidence: 0.98, action: 'pending', createdAt: NOW,
      }]
    }
    if (body.kind === 'pii_redact') {
      task.resultFileId = 'w2-redacted-file'
      task.result = {
        mode: 'real', ok: true, claim: 'redacted_verified', redactedFileId: 'w2-redacted-file',
        redactedFileUrl: '/w2-fixtures/sample-redacted.pdf',
        items: [{ id: 'w2-finding-phone', type: 'phone', pageNumber: 1, requested: 'redact', applied: 'redacted' }],
        reverify: { ran: true, method: 'text_layer', remainingCount: 0 },
      }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: task }) })
  })
  api.respondWith('POST', '/api/v1/materials/tasks/w2-pii_scan/pii-findings/decisions', async () => ({
    status: 200,
    json: {
      success: true,
      data: {
        ...materialTask('pii_scan'),
        piiFindings: [{
          id: 'w2-finding-phone', taskId: 'w2-pii_scan', type: 'phone', label: '手机号', pageNumber: 1,
          snippet: '13800138000', confidence: 0.98, action: 'redact', createdAt: NOW,
        }],
      },
    },
  }))
  await page.route('**/api/v1/materials/tasks/w2-pii_scan/pii-findings/decisions', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    decisionBody = route.request().postDataJSON()
    await route.fallback()
  })
  const binary = new FusionW2BinaryRoute(page)
  await binary.install()

  await openWithHandoff(page, '/print/desk?step=check', { materialCheck: null, printParams: null })
  await expect(page.getByRole('heading', { name: '有 1 处要你决定', exact: true })).toBeVisible()
  await expect(page.locator('.qpd-finding-snippet')).toHaveText('第 1 页 · 138****8000')
  await expect(page.locator('.qpd-decision-counts')).toContainText('已决定 0 / 1')
  await expect(page.getByRole('button', { name: '下一步：预览与参数' })).toBeDisabled()
  await page.getByRole('button', { name: '遮挡', exact: true }).click()
  await expect(page.locator('.qpd-decision-counts')).toContainText('已决定 1 / 1')
  await expect(page.locator('.qpd-decision-counts')).toContainText('遮挡 1 处')
  await expect(page.locator('.qpd-finding-decision')).toContainText('原文件不变')
  await page.getByRole('button', { name: '下一步：预览与参数' }).click()
  await page.waitForURL(/\/print\/desk\?step=preview/)
  await expect(page.getByTitle('w2-sample.pdf 预览')).toHaveAttribute('data-preview-src', '/w2-fixtures/sample-redacted.pdf')
  expect(decisionBody).toEqual({ decisions: [{ findingId: 'w2-finding-phone', action: 'redact' }] })
  expect(redactionCreated).toBe(true)
  await expect(page.getByText('raw-w2-fixture-token')).toHaveCount(0)
  await expectHealthy(page, errors, 'print-preview')
})

test('material check failure exposes its real retry action @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('POST', '/api/v1/materials/tasks', {
    status: 503,
    json: { success: false, error: { code: 'MATERIAL_UNAVAILABLE', message: '材料服务暂不可用' } },
  })

  await openWithHandoff(page, '/print/desk?step=check', { materialCheck: null, printParams: null })
  await expect(page.getByRole('heading', { name: '材料检查未完成' })).toBeVisible()
  await expect(page.getByRole('button', { name: '重试检查' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '现在的事实' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '两条路' })).toBeVisible()
  await expect(page.getByRole('button', { name: '下一步：预览与参数' })).toBeDisabled()
  await expect(page.getByRole('button', { name: /跳过/ })).toHaveCount(0)
  await expect(page.locator('.qpd-summary')).toHaveCount(0)
  await expectHealthy(page, errors, 'print-material-check')
})

test('direct preview restores the material session and completes the PDF response @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page, W2_FILE.fileUrl)
  registerShell(api)
  registerPrice(api)
  const binary = new FusionW2BinaryRoute(page)
  await binary.install()
  await seedMaterialSession(page)

  await page.goto('/print/desk?step=preview')
  await expect(page.getByTitle(`${W2_FILE.name} 预览`)).toBeVisible()
  const previewHost = page.locator(`[data-pdf-preview-host][data-preview-src="${W2_FILE.fileUrl}"]`)
  await expect(previewHost).toHaveAttribute('data-pdf-status', 'ready', { timeout: 20_000 })
  await expect(previewHost.locator('canvas')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '问小青：帮我选打印参数 →' })).toBeVisible()
  await expect(page.locator('.qpd-guide button, .qpd-guide a')).toHaveCount(0)
  await expect(page.locator('.qpd-param-stack > .qpd-param-card')).toHaveCount(4)
  await expect(page.locator('.qpd-device-strip > div')).toHaveCount(4)
  await page.getByRole('button', { name: '增加十份', exact: true }).click()
  await expect(page.locator('.qpd-stepper output')).toHaveText('11 份')
  await expect(page.getByRole('region', { name: '参数摘要' })).toContainText('11 份')
  await page.getByRole('button', { name: '减少十份', exact: true }).click()
  await expect(page.locator('.qpd-stepper output')).toHaveText('1 份')
  await expect(page.getByRole('button', { name: '减少打印份数' })).toBeDisabled()
  await page.getByRole('button', { name: '打开完整预览 · 逐页看清' }).click()
  const dialog = page.getByRole('dialog', { name: `完整预览：${W2_FILE.name}` })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-pdf-preview-host]')).toHaveAttribute('data-pdf-status', 'ready', { timeout: 20_000 })
  await expect(dialog.locator('canvas')).toHaveCount(1)
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  binary.assertPdfCompleted()
  await expectHealthy(page, errors, 'print-preview')
})

test('direct preview without a completed PII summary is fail-closed @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)

  await openWithHandoff(page, '/print/desk?step=preview', { materialCheck: null, printParams: null })

  const preview = page.locator('[data-w2-page="print-preview"]')
  await expect(preview).toHaveAttribute('data-qx-state', 'check-required')
  await expect(page.getByRole('heading', { name: '不能跳过隐私预检直接打印' })).toBeVisible()
  await expect(page.getByRole('button', { name: '完成材料检查' })).toBeVisible()
  await expect(page.getByRole('button', { name: '下一步：核对价格' })).toHaveCount(0)
  await expectHealthy(page, errors, 'print-preview')
})

test('preview rejects task ids without a trustworthy redaction result @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)

  await openWithHandoff(page, '/print/desk?step=preview', {
    printParams: null,
    materialCheck: {
      inspectionTaskId: 'w2-inspection-001',
      piiTaskId: 'w2-pii-001',
      piiRedactTaskId: 'w2-pii-redact-001',
      checkedAt: NOW,
      findingCount: 1,
      redactedCount: 1,
      keptCount: 0,
      redaction: {
        claim: 'redacted_verified',
        redactedFileId: null,
        appliedRedactedCount: 1,
        failedNoPositionCount: 0,
        keptCount: 0,
        reverifyRemainingCount: 0,
        reverifyRan: true,
      },
      mode: 'checked',
    },
  })

  await expect(page.locator('[data-w2-page="print-preview"]')).toHaveAttribute('data-qx-state', 'check-required')
  await expect(page.getByText('这份文件尚未完成材料检查，请检查后再继续。', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: '下一步：核对价格' })).toHaveCount(0)
  await expectHealthy(page, errors, 'print-preview')
})

test('print parameter suggestions are advisory until applied and then flow to confirmation @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  registerQuote(api, { amountCents: 600, billablePages: 6, unitCents: 100 })
  api.respond('GET', '/api/v1/materials/tasks/w2-inspection-001/print-param-suggestions', {
    status: 200,
    json: { success: true, data: printParamSuggestions({ copies: 3 }) },
  })
  const binary = new FusionW2BinaryRoute(page)
  await binary.install()
  await seedMaterialSession(page)
  // 预览→确认是 SPA 导航。Playwright 在这个窗口里对已拦截 POST 的 postDataJSON()
  // 为空（页面已按 registerQuote 渲染 ¥6.00，请求确实发出了）。
  // page.route + fallback 会把报价挂死；自己 fulfill 也读不到 body。
  // 所以在页面 fetch 出口抓 payload，应答仍只由 registerQuote 提供。
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
      if (method === 'POST' && String(url).includes('/orders/quote')) {
        const marker = window as Window & { __w2QuoteBodies?: unknown[] }
        marker.__w2QuoteBodies = marker.__w2QuoteBodies ?? []
        const body = typeof init?.body === 'string' ? init.body : null
        try {
          marker.__w2QuoteBodies.push(body ? JSON.parse(body) : null)
        } catch {
          marker.__w2QuoteBodies.push(body)
        }
      }
      return originalFetch(input, init)
    }
  })

  await page.goto('/print/desk?step=preview')
  // 2.0 份数步进器把单位写在读数里（稿 13：「1 份」）。
  await expect(page.locator('.qpd-stepper output')).toHaveText('1 份')
  await expect(page.getByText('3 份', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '采用这些建议' }).click()
  await expect(page.locator('.qpd-stepper output')).toHaveText('3 份')
  await page.getByRole('button', { name: '下一步：核对价格' }).click()
  await page.waitForURL('**/print/confirm')
  // 确认页摘要用 data-sum-row + <b class="v">，报价金额来自 POST /orders/quote。
  // 预览页才有「3 份」的 dd/strong；不能用它们冒充确认页断言。
  await expect(page.locator('[data-sum-row="打印份数"] .v')).toHaveText('3 份')
  await expect(page.getByTestId('print-confirm-amount')).toHaveText(/6\.00/)
  await expect.poll(async () => {
    return page.evaluate(() => {
      const bodies = (window as Window & { __w2QuoteBodies?: Array<{ params?: { copies?: number } }> }).__w2QuoteBodies
      return bodies?.[bodies.length - 1] ?? null
    })
  }).toMatchObject({ params: { copies: 3 } })
  await expectHealthy(page, errors, 'print-confirm')
})

// ── 彩色 / 双面按终端能力开放（2026-08-18）────────────────────────────────────
// 硬件（奔图 CM2800/CM2820）支持彩色与自动双面，但**驱动映射未在每台真机验证过**。
// 误放的代价是用户按彩色付费拿到黑白纸，所以放行必须按台、显式、可审计。
// 这两个用例锁住闸门的两端：未登记必须禁用且理由诚实；登记 available 后必须真的可选。

function capabilitiesWith(overrides: Record<string, string>): unknown {
  return {
    terminalCode: 'KSK-001',
    capabilities: UNVERIFIED_CAPABILITIES.map((row) =>
      overrides[row.capabilityKey]
        ? { ...row, status: overrides[row.capabilityKey], configured: true, updatedAt: NOW }
        : row,
    ),
  }
}

test('unverified terminal disables color and duplex with an honest reason @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api) // 默认即「未登记」态
  registerPrice(api)
  await seedMaterialSession(page)

  await page.goto('/print/desk?step=preview')
  const preview = page.locator('[data-w2-page="print-preview"]')

  // 理由须保留本机未开通的真值、使用用户文案，不能说「不支持」—— 硬件确实支持，说不支持是谎报。
  await expect(preview.getByText(/本机彩色打印暂未开通/)).toBeVisible()
  await expect(preview.getByText(/本机自动双面暂未开通/)).toBeVisible()
  await expect(preview.getByText(/不支持/)).toHaveCount(0)

  // 禁用态必须是**可聚焦的 aria-disabled**，不是原生 disabled ——
  // 原生 disabled 的按钮拿不到焦点，读屏和键盘用户根本读不到 aria-describedby 里的原因。
  const colorBtn = preview.getByRole('button', { name: '彩色', exact: true })
  await expect(colorBtn).toHaveAttribute('aria-disabled', 'true')
  await expect(colorBtn).not.toHaveAttribute('disabled', /.*/)
  await expect(colorBtn).toHaveAttribute('aria-describedby', 'print-color-capability-note')
  // 真的能聚焦（这才是选 aria-disabled 而不是 disabled 的全部意义）
  await colorBtn.focus()
  await expect(colorBtn).toBeFocused()

  const duplexBtn = preview.getByRole('button', { name: '双面（长边）', exact: true })
  await expect(duplexBtn).toHaveAttribute('aria-disabled', 'true')
  await expect(duplexBtn).not.toHaveAttribute('disabled', /.*/)
  await duplexBtn.focus()
  await expect(duplexBtn).toBeFocused()

  // 点下去不得选中：仍停在黑白 / 单面。
  // force:true 绕过 Playwright 的 actionability —— 这里要证的正是「用户硬点也选不上」。
  await colorBtn.click({ force: true })
  await duplexBtn.click({ force: true })
  await expect(preview.getByRole('button', { name: '黑白', exact: true })).toHaveAttribute('data-selected', 'true')
  await expect(preview.getByRole('button', { name: '单面', exact: true })).toHaveAttribute('data-selected', 'true')

  await expectHealthy(page, errors, 'print-preview')
})

test('terminal verified for color and duplex can actually select them @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  // 管理员在该终端真机验过后显式配成 available —— 唯一的放行路径。
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: capabilitiesWith({ color_print: 'available', duplex_print: 'available' }),
  })
  await seedMaterialSession(page)

  await page.goto('/print/desk?step=preview')
  const preview = page.locator('[data-w2-page="print-preview"]')

  const colorBtn = preview.getByRole('button', { name: '彩色', exact: true })
  await expect(colorBtn).not.toHaveAttribute('aria-disabled', 'true')
  await expect(preview.getByText(/暂未开通/)).toHaveCount(0)

  await colorBtn.click()
  await expect(colorBtn).toHaveAttribute('data-selected', 'true')

  const duplexBtn = preview.getByRole('button', { name: '双面（长边）', exact: true })
  await duplexBtn.click()
  await expect(duplexBtn).toHaveAttribute('data-selected', 'true')

  await expectHealthy(page, errors, 'print-preview')
})

// 2026-08-18：/print/params 下线为兼容重定向。该页每个可编辑控件都与 /print/preview 重复，
// 且全站零运行时导航指向它——用户只能手敲 URL 才到得了。原用例断言的「参数页本地估价」
// 已按预览页既定口径退场（实付金额由确认页 POST /orders/quote 出）。
test('retired params route redirects into preview with real printer fixtures @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  await seedMaterialSession(page)

  await page.goto('/print/params')
  await expect(page).toHaveURL(/\/print\/desk\?step=preview/)
  await expect(page.locator('[data-w2-page="print-preview"]')).toBeVisible()
  // 2.0 把打印机卡并进页头的只读信息行（稿 13 顶部四格），它是 role=status，不在参数栅格里。
  const deviceRow = page.getByRole('status').filter({ hasText: '纸张' })
  await expect(deviceRow.getByText('已配置打印机', { exact: true })).toBeVisible()
  await expect(deviceRow.getByText('打印机在线', { exact: true })).toBeVisible()
  await expectHealthy(page, errors, 'print-preview')
})

test('legacy material-check and preview routes redirect with step intent @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)

  await page.goto('/print/material-check')
  await expect(page).toHaveURL(/\/print\/desk\?step=check/)
  await expect(page.locator('[data-print-desk-step="check"]')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: '这一页没有待处理的文件' })).toBeVisible()

  await seedMaterialSession(page)
  await page.goto('/print/preview')
  await expect(page).toHaveURL(/\/print\/desk\?step=preview/)
  await expect(page.locator('[data-w2-page="print-preview"]')).toBeVisible()
  await expectHealthy(page, errors, 'print-preview')
})

test('preview stage survives reload from sessionStorage @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page, W2_FILE.fileUrl)
  registerShell(api)
  registerPrice(api)
  const binary = new FusionW2BinaryRoute(page)
  await binary.install()

  await page.goto('/print/desk?step=preview')
  await writeMaterialSession(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/print\/desk\?step=preview/)
  await expect(page.locator('[data-w2-page="print-preview"]')).toHaveAttribute('data-qx-state', 'preview')
  await expect(page.locator('[data-print-desk-step="preview"]')).toHaveCount(1)
  await expect(page.locator('[data-w2-page="print-material-check"]')).toHaveCount(0)
  await expect(page.getByText(W2_FILE.name)).toBeVisible()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-w2-page="print-preview"]')).toHaveAttribute('data-qx-state', 'preview')
  await expectHealthy(page, errors, 'print-preview')
})

test('a new material check invalidates the previous summary so preview cannot authorize from it @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page, W2_FILE.fileUrl)
  registerShell(api)
  registerPrice(api)
  const binary = new FusionW2BinaryRoute(page)
  await binary.install()
  // 新一轮检查停在体检进行中：结论不回来，上一轮的摘要也不能再替它放行。
  const pendingInspection = (): DocumentProcessTaskView => ({ ...materialTask('inspection'), status: 'processing', result: null })
  let inspectionCreated = false
  await routeExactJson(page, 'POST', '/api/v1/materials/tasks', async (route) => {
    const body = route.request().postDataJSON() as { kind?: string }
    if (body.kind !== 'inspection') {
      await route.abort('blockedbyclient')
      return
    }
    inspectionCreated = true
    await route.fulfill({ status: 201, json: { success: true, data: pendingInspection() } })
  })
  await routeExactJson(page, 'GET', '/api/v1/materials/tasks/w2-inspection', async (route) => {
    await route.fulfill({ status: 200, json: { success: true, data: pendingInspection() } })
  })

  // 前提：带着上一轮完整摘要时，预览确实会放行 —— 否则下面的 check-required 证明不了任何事。
  await page.goto('/print/desk?step=preview')
  await writeMaterialSession(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-w2-page="print-preview"]')).toHaveAttribute('data-qx-state', 'preview')

  await page.goto('/print/desk?step=check')
  await expect(page.locator('[data-w2-page="print-material-check"]')).toHaveAttribute('data-qx-state', 'inspection')
  await expect.poll(() => inspectionCreated).toBe(true)
  const stored = await page.evaluate(() => JSON.parse(window.sessionStorage.getItem('ai-job-print:current-print-material-check') ?? 'null') as Record<string, unknown> | null)
  expect(stored?.['file']).toMatchObject({ fileId: W2_FILE.fileId })
  expect(stored).not.toHaveProperty('materialCheck')
  expect(stored).not.toHaveProperty('piiRedactTask')

  await page.goto('/print/desk?step=preview')
  await expect(page.locator('[data-w2-page="print-preview"]')).toHaveAttribute('data-qx-state', 'check-required')
  await expect(page.getByRole('heading', { name: '不能跳过隐私预检直接打印' })).toBeVisible()
  expect(errors).toEqual([])
})

test('sensitive session clear returns the desk to empty without the previous file name @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)

  await page.goto('/print/desk?step=preview')
  await writeMaterialSession(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText(W2_FILE.name)).toBeVisible()

  await page.evaluate(() => {
    window.sessionStorage.removeItem('ai-job-print:current-print-material-check')
  })
  await page.reload({ waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: '这一页没有待处理的文件' })).toBeVisible()
  await expect(page.getByText(W2_FILE.name)).toHaveCount(0)
  await expect(page.getByText('当前文件：无')).toBeVisible()
  expect(errors).toEqual([])
})

test('paid print-job amount routes confirmation to cashier @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  registerQuote(api, { amountCents: W2_ORDER.amountCents, billablePages: 2, unitCents: 100 })
  api.respond('POST', '/api/v1/print/jobs', {
    status: 200,
    json: {
      taskId: W2_ORDER.taskId,
      status: 'pending',
      createdAt: NOW,
      orderId: W2_ORDER.orderId,
      orderNo: W2_ORDER.orderNo,
      amountCents: W2_ORDER.amountCents,
      payStatus: 'unpaid',
      priceLines: cashierState.priceLines,
      billablePages: 2,
      billingPageSource: 'detected',
      paymentSessionToken: W2_ORDER.paymentSessionToken,
    },
  })
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, { status: 200, json: payStatus('unpaid') })
  await seedMaterialSession(page)

  await page.goto('/print/confirm')
  await expect(page.getByText('¥1.00/页 × 2 页', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^(确认并去付款|确认并打印)$/ }).click()
  await page.waitForURL('**/print/cashier')
  await expect(page.getByText('¥2.00', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(W2_ORDER.paymentSessionToken)).toHaveCount(0)
  await expectHealthy(page, errors, 'print-cashier')
})

test('cashier renders a pending QR without exposing its session token @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, { status: 200, json: payStatus('unpaid') })
  api.respond('POST', `/api/v1/orders/${W2_ORDER.orderId}/pay`, {
    status: 200,
    json: {
      attemptId: 'w2-attempt-pending', orderId: W2_ORDER.orderId, orderNo: W2_ORDER.orderNo,
      channel: 'wechat', amountCents: 200, status: 'pending', qrCodeContent: 'weixin://w2-synthetic-qr',
      expiresAt: LATER, orderPayStatus: 'paying', orderExpiresAt: LATER,
    },
  })

  await page.goto('/print/cashier')
  await setReactRouterState(page, '/print/cashier', cashierState)
  await page.getByRole('button', { name: '手机扫屏幕上的码' }).click()
  await expect(page.locator('.qx-state-t', { hasText: '请扫码支付' })).toBeVisible()
  await expect(page.locator('svg').filter({ has: page.locator('path') })).not.toHaveCount(0)
  await expect(page.getByText(W2_ORDER.paymentSessionToken)).toHaveCount(0)
  // 稿 32-cashier 把出码等待态的主按钮定为「刷新付款结果」（稿内 5 次），
  // 取代旧的禁用「等待支付…」。断言随稿更新，但**守的东西不变且更明确**：
  // 等待期间不得出现任何进入出纸的入口，主按钮只能是刷新状态。
  await expect(page.getByRole('button', { name: '刷新付款结果' })).toBeVisible()
  await expect(page.getByRole('button', { name: '开始打印' })).toHaveCount(0)
  await expect(page).toHaveURL(/\/print\/cashier$/)
  await expectHealthy(page, errors, 'print-cashier')
})

// 青序流光迁移（32-cashier.html）改了终态的文案与出口，断言随稿更新，**强度只增不减**：
//   copy      取自 CashierQxView 的状态标题，仍是 exact 精确匹配，未放松成通用词
//   primary   稿里终态统一给「重新发起打印」（稿内出现 4 次），取代旧的禁用「等待支付…」
//   nextPath  新增：断言主按钮点下去落在**上传页**而不是出纸链路 ——
//             这比旧版「按钮是禁用的」更强：旧版只证明点不动，新版证明就算点了也进不了出纸。
// 三条不可动的红线原样保留：停在 /print/cashier、无「开始打印」、canProceed 仅 paid 为真。
for (const scenario of [
  { name: 'failed attempt', status: 'unpaid', attempt: { attemptId: 'w2-failed', channel: 'wechat', status: 'failed', qrCodeContent: null, expiresAt: null }, copy: '这次支付尝试没有完成', primary: '重新发起支付', nextPath: null },
  { name: 'closed order', status: 'closed', attempt: { attemptId: 'w2-closed', channel: 'wechat', status: 'expired', qrCodeContent: null, expiresAt: null }, copy: '订单已超时关闭', primary: '重新发起打印', nextPath: /\/print\/upload/ },
  { name: 'refunded order', status: 'refunded', attempt: { attemptId: 'w2-refunded', channel: 'wechat', status: 'success', qrCodeContent: null, expiresAt: null }, copy: '这一单已经退款', primary: '重新发起打印', nextPath: /\/print\/upload/ },
] as const) {
  test(`cashier keeps ${scenario.name} out of print fulfillment @w2`, async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    registerShell(api)
    api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
    api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, {
      status: 200,
      json: payStatus(scenario.status, scenario.attempt),
    })

    await page.goto('/print/cashier')
    await setReactRouterState(page, '/print/cashier', cashierState)
    // 锚到状态标题元素而不是全页 getByText：青序流光把同一句话同时放在状态卡标题
    // 与摘要 <dd> 里，全页匹配会撞 strict mode。锚元素比原来更精确，不是放松。
    await expect(page.locator('.qx-state-t', { hasText: scenario.copy })).toBeVisible()
    await expect(page).toHaveURL(/\/print\/cashier$/)
    await expect(page.getByRole('button', { name: '开始打印' })).toHaveCount(0)
    const primary = page.getByRole('button', { name: scenario.primary }).first()
    await expect(primary, `终态主按钮应为「${scenario.primary}」`).toBeVisible()
    await expectHealthy(page, errors, 'print-cashier')
    if (scenario.nextPath) {
      // 真按一次：证明这个出口通向重新下单，而不是绕进出纸链路。
      await primary.click()
      await expect(page).toHaveURL(scenario.nextPath)
      await expect(page).not.toHaveURL(/\/print\/progress/)
    }
  })
}

test('only a paid cashier response enters print progress @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, { status: 200, json: payStatus('paid') })
  api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, {
    status: 200,
    json: { taskId: W2_ORDER.taskId, status: 'pending' },
  })

  await page.goto('/print/cashier')
  await setReactRouterState(page, '/print/cashier', cashierState)
  await page.waitForURL('**/print/progress')
  await expectHealthy(page, errors, 'print-progress')
})

test('Order-only release carries the terminal session alongside the payment session @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  const releasedTaskId = 'w2-released-task-001'
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, { status: 200, json: payStatus('paid') })
  api.respond('POST', `/api/v1/print/jobs/${W2_ORDER.orderId}/release`, {
    status: 200,
    json: {
      released: true,
      taskId: releasedTaskId,
      orderId: W2_ORDER.orderId,
      orderNo: W2_ORDER.orderNo,
      terminalId: 'KSK-001',
      taskStatus: 'pending',
      printTaskStatus: 'pending',
      paymentSessionToken: W2_ORDER.paymentSessionToken,
    },
  })
  api.respond('GET', `/api/v1/print/jobs/${releasedTaskId}`, {
    status: 200,
    json: { taskId: releasedTaskId, status: 'pending' },
  })
  const releaseRequest = page.waitForRequest(
    (request) =>
      request.method() === 'POST'
      && new URL(request.url()).pathname === `/api/v1/print/jobs/${W2_ORDER.orderId}/release`,
  )

  await page.goto('/print/cashier')
  // 小程序 Order-only 单在付款成功前没有 PrintTask —— 去掉 taskId 才会走 release 这条路。
  await setReactRouterState(page, '/print/cashier', { ...cashierState, taskId: undefined })
  await page.waitForURL('**/print/progress')

  const releaseHeaders = (await releaseRequest).headers()
  expect(
    releaseHeaders['x-terminal-session-token'],
    '释放会当场在本机建任务出纸，必须带服务端签发的终端会话票',
  ).toBe(TERMINAL_SESSION_FIXTURE)
  expect(releaseHeaders['x-terminal-id']).toBe('KSK-001')
  // 终端身份是新增的一道闸门，不是替换：付款方身份仍由这张短期支付会话票证明。
  expect(releaseHeaders['x-payment-session-token']).toBe(W2_ORDER.paymentSessionToken)
  await expectHealthy(page, errors, 'print-progress')
})

test('Order-only release during a normal session refresh waits instead of failing @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  const releasedTaskId = 'w2-refresh-window-task'
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
  // 先未付款：否则页面一挂载就释放，抢在续期开始之前，用例就钉不到那个窗口。
  let paid = false
  api.respondWith('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, () => ({
    status: 200,
    json: payStatus(paid ? 'paid' : 'unpaid'),
  }))
  api.respond('POST', `/api/v1/print/jobs/${W2_ORDER.orderId}/release`, {
    status: 200,
    json: {
      released: true,
      taskId: releasedTaskId,
      orderId: W2_ORDER.orderId,
      orderNo: W2_ORDER.orderNo,
      terminalId: 'KSK-001',
      taskStatus: 'pending',
      printTaskStatus: 'pending',
      paymentSessionToken: W2_ORDER.paymentSessionToken,
    },
  })
  api.respond('GET', `/api/v1/print/jobs/${releasedTaskId}`, {
    status: 200,
    json: { taskId: releasedTaskId, status: 'pending' },
  })
  const refresh = holdTerminalRefresh(api)
  const releaseRequest = page.waitForRequest(
    (request) =>
      request.method() === 'POST'
      && new URL(request.url()).pathname === `/api/v1/print/jobs/${W2_ORDER.orderId}/release`,
  )

  await page.goto('/print/cashier')
  // 小程序 Order-only 单在付款成功前没有 PrintTask —— 去掉 taskId 才会走 release 这条路。
  await setReactRouterState(page, '/print/cashier', { ...cashierState, taskId: undefined })
  // 只有一个通道时页面会自动选中它，落在「通道已选」这一态（未付款、未出码）。
  await expect(page.locator('.qx-state-t', { hasText: '通道已选，请选择扫码方式' })).toBeVisible()

  await startTerminalSessionRefresh(page)
  await refresh.arrived
  expect(await terminalSessionStateOf(page), '续期在飞时会话状态必须真的是 checking').toBe('checking')

  // 钱已经收了。此刻释放必须等换票，而不是把一单已付款的活当场判成安全失败 ——
  // 那会让站在机器前的人看到「打印任务尚未建立」，以为钱付了纸不出。
  paid = true
  await expect(page.locator('.qx-state-t', { hasText: '付款成功' })).toBeVisible()
  await page.waitForTimeout(700)
  expect(
    api.requestCount('POST', `/api/v1/print/jobs/${W2_ORDER.orderId}/release`),
    '续期没出结果之前不许把释放请求发出去',
  ).toBe(0)
  await expect(page.locator('.qx-state-t', { hasText: '打印任务尚未建立' })).toHaveCount(0)
  await expect(page).toHaveURL(/\/print\/cashier$/)

  refresh.open()
  await page.waitForURL('**/print/progress')
  expect(
    api.requestCount('POST', `/api/v1/print/jobs/${W2_ORDER.orderId}/release`),
    '等完只释放一次：释放会在本机建任务出纸，重复发就是重复出纸的风险',
  ).toBe(1)
  expect(
    api.requestCount('POST', '/api/v1/terminals/session-token/refresh'),
    '等的是在飞的那一次续期，不许自己再补发一次',
  ).toBe(1)
  // 头是在等完之后才组的，因此带的是续期换回来的那张新票。若哪天它被挪回 await 之前，
  // 这里读到的会是 TERMINAL_SESSION_FIXTURE：释放看着等到了，却拿已经作废的旧票去出纸。
  const releaseHeaders = (await releaseRequest).headers()
  expect(
    releaseHeaders['x-terminal-session-token'],
    '释放必须带续期换回来的新票；等于初始票就说明请求头在等待之前就组好了',
  ).toBe(TERMINAL_SESSION_ROTATED)
  expect(releaseHeaders['x-payment-session-token']).toBe(W2_ORDER.paymentSessionToken)
  await expectHealthy(page, errors, 'print-progress')
})

test('a terminal-session 401 on Order-only release fails as terminal security, not network @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, { status: 200, json: payStatus('paid') })
  // 会话票真的废了：释放被判无效，续期也被拒。
  api.respond('POST', `/api/v1/print/jobs/${W2_ORDER.orderId}/release`, {
    status: 401,
    json: { error: { code: 'TERMINAL_SESSION_INVALID', message: '终端安全会话无效' } },
  })
  api.respond('POST', '/api/v1/terminals/session-token/refresh', {
    status: 401,
    json: { error: { code: 'TERMINAL_SESSION_INVALID', message: '终端安全会话无效' } },
  })

  await page.goto('/print/cashier')
  await setReactRouterState(page, '/print/cashier', { ...cashierState, taskId: undefined })

  // 用户看到的必须是「终端安全校验失败」这件事本身。等待逻辑一旦把续期的原始错误
  // 原样外抛（续期失败可能是 TypeError），这里就会变成「网络连接失败」——
  // 把一次安全失败说成网络问题，现场工作人员会照着去查网线。
  const alert = page.locator('.cashier-qx-error')
  await expect(alert).toHaveText(/这台机器的安全校验没通过/)
  await expect(alert).not.toHaveText(/网络连接失败/)
  await expect(page.locator('.qx-state-t', { hasText: '打印任务尚未建立' })).toBeVisible()
  await expect(page).toHaveURL(/\/print\/cashier$/)
  expect(
    api.requestCount('POST', `/api/v1/print/jobs/${W2_ORDER.orderId}/release`),
    '刚被拒的票绝不重放：释放只发一次',
  ).toBe(1)
  expect(
    api.requestCount('POST', '/api/v1/terminals/session-token/refresh'),
    '401 不是抖动，续期只发一次',
  ).toBe(1)
  expect(errors).toEqual([])
})

// Order-only：续期或 release 本身被扣住时，人还在就换票后释放并进入进度页；
// 人走了或清场后，已发出的那一次释放照常落服务端（幂等、不取消），但不得再重放，
// 也不得把上一位推进 /print/progress。
for (const scenario of ['active-refresh', 'leave-refresh', 'leave-success', 'privacy-refresh'] as const) {
  const leave = scenario !== 'active-refresh'
  const lateSuccess = scenario === 'leave-success'
  test(`pickup lifecycle release ${scenario} @w2`, async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    registerShell(api)
    const releasePath = '/api/v1/print/jobs/lifecycle-order/release'
    api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
    api.respond('GET', '/api/v1/orders/lifecycle-order/pay-status', {
      status: 200,
      json: {
        orderId: 'lifecycle-order',
        orderNo: 'LIFECYCLE-ORDER',
        payStatus: 'paid',
        paymentSource: 'wechat',
        payChannel: 'wechat',
        amountCents: 100,
        paidAt: NOW,
        pickupCode: null,
        attempt: null,
      },
    })
    api.respond('GET', '/api/v1/print/jobs/lifecycle-task', {
      status: 200,
      json: { taskId: 'lifecycle-task', status: 'pending' },
    })
    const refresh = holdTerminalRefresh(api)
    let openRelease = (): void => undefined
    const releaseGate = new Promise<void>((resolve) => { openRelease = resolve })
    let markRelease = (): void => undefined
    const releaseArrived = new Promise<void>((resolve) => { markRelease = resolve })
    const releaseTokens = watchPostTokens(page, releasePath)
    page.on('request', (request) => {
      if (request.method() !== 'POST') return
      if (new URL(request.url()).pathname !== releasePath) return
      expect(request.headers()['x-terminal-id']).toBe('KSK-001')
      expect(request.headers()['x-payment-session-token']).toBe('lifecycle-payment')
    })
    api.respondWith('POST', releasePath, async (requestNumber) => {
      markRelease()
      if (lateSuccess) {
        await releaseGate
        return {
          status: 200,
          json: {
            released: true,
            taskId: 'lifecycle-task',
            orderId: 'lifecycle-order',
            orderNo: 'LIFECYCLE-ORDER',
            terminalId: 'KSK-001',
            taskStatus: 'pending',
            printTaskStatus: 'pending',
            paymentSessionToken: 'lifecycle-payment',
          },
        }
      }
      if (requestNumber === 1) {
        return { status: 401, json: { error: { code: 'TERMINAL_SESSION_INVALID', message: 'Expired fixture' } } }
      }
      return {
        status: 200,
        json: {
          released: true,
          taskId: 'lifecycle-task',
          orderId: 'lifecycle-order',
          orderNo: 'LIFECYCLE-ORDER',
          terminalId: 'KSK-001',
          taskStatus: 'pending',
          printTaskStatus: 'pending',
          paymentSessionToken: 'lifecycle-payment',
        },
      }
    })

    try {
      await page.goto('/print/cashier')
      await setReactRouterState(page, '/print/cashier', {
        orderId: 'lifecycle-order',
        orderNo: 'LIFECYCLE-ORDER',
        amountCents: 100,
        priceLines: [],
        paymentSessionToken: 'lifecycle-payment',
      })
      await releaseArrived
      expect(api.requestCount('POST', releasePath)).toBe(1)
      expect(releaseTokens[0]).toBe(TERMINAL_SESSION_FIXTURE)
      if (!lateSuccess) await refresh.arrived

      if (scenario === 'privacy-refresh') {
        await freezeBfCachePrivacyClear(page)
        await expect(page.getByTestId('session-guard-state-clearing')).toBeVisible()
        await expect(page.getByRole('button', { name: '返回我的打印订单', exact: true })).toHaveCount(0)
      } else if (leave) {
        await page.getByRole('button', { name: '返回我的打印订单', exact: true }).click()
        await expect(page).not.toHaveURL(/\/print\/cashier/)
      }

      const settled = page.waitForResponse((response) => {
        const path = new URL(response.url()).pathname
        return path === (lateSuccess ? releasePath : '/api/v1/terminals/session-token/refresh')
      })
      if (lateSuccess) openRelease()
      else refresh.open()
      await settled

      if (leave) {
        if (!lateSuccess) await waitForRotatedSession(page)
        else {
          await page.evaluate(() => new Promise<void>((resolve) => {
            window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
          }))
        }
        expect(api.requestCount('POST', releasePath), '离页或清场后不得重放释放').toBe(1)
        expect(releaseTokens).toEqual([TERMINAL_SESSION_FIXTURE])
        await expect(page).not.toHaveURL(/\/print\/progress/)
      } else {
        await expect(page).toHaveURL(/\/print\/progress/)
        expect(api.requestCount('POST', releasePath)).toBe(2)
        expect(releaseTokens).toEqual([TERMINAL_SESSION_FIXTURE, TERMINAL_SESSION_ROTATED])
      }
      expect(api.requestCount('POST', '/api/v1/terminals/session-token/refresh')).toBe(lateSuccess ? 0 : 1)
      expect(errors).toEqual([])
    } finally {
      openRelease()
      refresh.open()
    }
  })
}

test('print polling reaches done and does not show a pickup code @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  let polls = 0
  await routeExactJson(page, 'GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, async (route) => {
    const status = ['pending', 'printing', 'completed'][Math.min(polls, 2)]
    polls += 1
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ taskId: W2_ORDER.taskId, status }) })
  })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, {
    status: 200,
    json: payStatus('paid', null, 'W2-PICKUP-7391'),
  })

  await page.goto('/print/progress')
  await setReactRouterState(page, '/print/progress', cashierState)
  await page.waitForURL('**/print/done', { timeout: 10_000 })
  await expect(page.getByText('已在本机出纸', { exact: true })).toBeVisible()
  await expect(page.getByText('W2-PICKUP-7391', { exact: true })).toHaveCount(0)
  await expectHealthy(page, errors, 'print-done')
})

test('failed print status displays only the safe user reason and no pickup code @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, {
    status: 200,
    json: {
      taskId: W2_ORDER.taskId,
      status: 'failed',
      errorMessage: 'agent stack and local path must stay hidden',
      failureReasonForUser: '打印机暂时离线，请联系现场工作人员',
    },
  })
  // 包 G：失败态会向服务端要「文件带走」链接；本用例无支付会话凭证 → 404，页面只能显示失败原因，不得伪造二维码。
  api.respond('POST', `/api/v1/print/jobs/${W2_ORDER.taskId}/takeaway-url`, {
    status: 404,
    json: { error: { code: 'PRINT_TASK_NOT_FOUND', message: '打印任务不存在或无权访问' } },
  })

  await page.goto('/print/progress')
  await setReactRouterState(page, '/print/progress', cashierState)
  await page.waitForURL('**/print/done')
  await expect(page.getByText('打印机暂时离线，请联系现场工作人员', { exact: true })).toBeVisible()
  await expect(page.getByText('agent stack and local path must stay hidden')).toHaveCount(0)
  await expect(page.getByText('取件凭证码')).toHaveCount(0)
  await expectHealthy(page, errors, 'print-done')
})

test('takeaway-url stays a payment-token recovery path with no terminal session requirement @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, {
    status: 200,
    json: {
      taskId: W2_ORDER.taskId,
      status: 'failed',
      failureReasonForUser: '打印机暂时离线，请联系现场工作人员',
    },
  })
  api.respond('POST', `/api/v1/print/jobs/${W2_ORDER.taskId}/takeaway-url`, {
    status: 200,
    json: {
      signedUrl: '/api/v1/files/signed/w2-takeaway',
      expiresAt: '2099-01-01T00:00:00.000Z',
      filename: W2_FILE.name,
      mimeType: 'application/pdf',
      sizeBytes: 128,
      orderId: W2_ORDER.orderId,
      orderNo: W2_ORDER.orderNo,
      payStatus: 'paid',
      amountCents: W2_ORDER.amountCents,
      canRetry: false,
    },
  })
  const takeawayRequest = page.waitForRequest(
    (request) =>
      request.method() === 'POST'
      && new URL(request.url()).pathname === `/api/v1/print/jobs/${W2_ORDER.taskId}/takeaway-url`,
  )

  await page.goto('/print/progress')
  await setReactRouterState(page, '/print/progress', cashierState)
  await page.waitForURL('**/print/done')
  await expect(page.getByText('打印机暂时离线，请联系现场工作人员', { exact: true })).toBeVisible()

  const takeawayHeaders = (await takeawayRequest).headers()
  expect(takeawayHeaders['x-payment-session-token']).toBe(W2_ORDER.paymentSessionToken)
  // 打印失败后「把文件带走」是这一单的兜底出口：用户可能已经离开机器、改用手机打开链接，
  // 凭据只能是会员登录态或这张支付会话票。给它加终端会话要求等于把兜底路径也焊死在本机上，
  // 打印机一坏就连文件都拿不走 —— 因此这条**必须**不带终端会话票。
  expect(
    takeawayHeaders['x-terminal-session-token'],
    'takeaway-url 不得升级成终端限定接口，否则打印失败时用户拿不回自己已付费的文件',
  ).toBeUndefined()
  await expectHealthy(page, errors, 'print-done')
})

// ============================================================
// S2 权益卡六态（V6 原型 P06 s4，06-print-workbench.html:914-919）
//
// 每一态都由**真实数据**判定，测试也只通过真实端点响应来触发：
//   guest             — 未登录（不发 /me/benefits）
//   price_unavailable — POST /orders/quote 失败
//   repriced          — /print/price-config 单价 ≠ 本单报价单价
//   not_applicable    — 报价应付 0 元（服务端对免费单拒绝核销）
//   available / none  — 登录后 GET /me/benefits 的真实内容
//   error             — GET /me/benefits 失败（诚实态：不许滑成「没有权益」）
//
// 反向验证：每条用例断言 data-benefit-state 的**精确取值**，并断言互斥态不出现。
// 判定错一态，属性值就不同，用例即失败。
// ============================================================

const W2_MEMBER_TOKEN = 'w2-benefit-memory-token'
const W2_MEMBER_PHONE = '13800138000'
const W2_MEMBER_CODE = '123456'

function registerMemberLogin(api: ApiRouter): void {
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', { status: 200, json: { success: true, data: null } })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', { status: 200, json: { success: true, data: null } })
  api.respond('POST', '/api/v1/member/auth/sms-code', {
    status: 200,
    json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } },
  })
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 200,
    json: {
      success: true,
      data: {
        token: W2_MEMBER_TOKEN,
        user: { id: 'member-w2-benefit', phoneMasked: '138****8000', nickname: '权益验收用户' },
      },
    },
  })
  api.respond('GET', '/api/v1/me/pending-tasks', { status: 200, json: { success: true, data: [] } })
  // 登录后外壳会预取收藏；与权益卡无关，但必须登记，否则 ApiRouter 判为未处理请求。
  api.respond('GET', '/api/v1/me/favorites', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })
}

/**
 * 通过真实可见 UI 登录。
 *
 * 登录会触发 AuthContext.clearKioskSensitiveSession()（公共终端切换身份即清上一位用户的
 * 敏感材料，是产品既定行为），所以打印材料上下文必须在登录**之后**再送进来。
 */
async function loginThroughVisibleUi(page: Page, returnTo: string): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of W2_MEMBER_PHONE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of W2_MEMBER_CODE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === returnTo)
}

/**
 * 客户端软跳转（pushState + popstate），**不重载文档**。
 *
 * 必须不重载：Kiosk 会话是纯内存态，reload 即登出（setReactRouterState 会 reload，
 * 因此不能用在登录后的用例里）。这里只驱动 React Router 既有的 popstate 监听，
 * 不改动任何应用代码。
 */
async function softNavigate(page: Page, path: string, usr: unknown): Promise<void> {
  await page.evaluate(
    ({ nextPath, state }) => {
      window.history.pushState({ usr: state, key: 'w2-benefit-fixture', idx: 1 }, '', nextPath)
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
    },
    { nextPath: path, state: usr },
  )
}

function benefitGrant(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'grant-001',
    benefitType: 'coupon',
    title: '打印体验券',
    description: null,
    quantityTotal: 3,
    quantityRemaining: 2,
    status: 'active',
    sourceType: 'platform',
    validFrom: null,
    validUntil: null,
    createdAt: NOW,
    ...overrides,
  }
}

function registerBenefits(api: ApiRouter, items: Record<string, unknown>[]): void {
  api.respond('GET', '/api/v1/me/benefits', {
    status: 200,
    json: { success: true, data: { items, nextCursor: null, total: items.length } },
  })
}

/** 没有材料检查结论的确认页交接（ai-down / 登录后的会员用例）；游客写入、会员读到时按「中途登录」改绑。 */
const CONFIRM_HANDOFF: PrintHandoffSeed = { materialCheck: null }

const benefitCard = (page: Page) => page.locator('[data-benefit-state]')

test('benefit card reports 未认领身份 for a guest and never fabricates a discount @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  registerQuote(api, { amountCents: 200, billablePages: 2, unitCents: 100 })
  await seedMaterialSession(page)

  await page.goto('/print/confirm')
  await expect(benefitCard(page)).toHaveAttribute('data-benefit-state', 'guest')
  await expect(page.getByRole('button', { name: '去登录查看我的权益' })).toBeVisible()
  // 反向：游客态不得出现核销 CTA，也不得出现任何抵扣结论。
  await expect(page.locator('[data-benefit-redeem]')).toHaveCount(0)
  await expect(page.getByText('已抵扣')).toHaveCount(0)
  await expect(page.getByText('¥2.00', { exact: true }).first()).toBeVisible()
  await expectHealthy(page, errors, 'print-confirm')
})

test('benefit card survives the AI-down state and stays decoupled from 材料体检 @w2', async ({ page, api }) => {
  // V6 原型 06-print-workbench.html:895 —— 权益卡 data-when="default first ai-down"：
  // AI 材料体检不可用（ai-down）**不会**关掉权益卡；只有 device-off 才收起可选项。
  // 这里用「无 materialCheck 的确认页上下文」复现 ai-down：体检结论缺席，
  // 但价目、核价与权益仍必须照常工作（原型 :946「体检与预填中断 · 预览、参数、核价、出纸都不受影响」）。
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  registerQuote(api, { amountCents: 200, billablePages: 2, unitCents: 100 })

  await openWithHandoff(page, '/print/confirm', CONFIRM_HANDOFF)
  // 体检摘要缺席（ai-down），但权益卡与金额都在。
  await expect(page.getByText('隐私检查摘要')).toHaveCount(0)
  await expect(benefitCard(page)).toHaveAttribute('data-benefit-state', 'guest')
  await expect(page.getByText('¥2.00', { exact: true }).first()).toBeVisible()
  await expectHealthy(page, errors, 'print-confirm')
})

test('benefit card reports 价目拉不到 when the quote fails and shows no amount @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  api.respond('POST', '/api/v1/orders/quote', {
    status: 500,
    json: { success: false, error: { code: 'PRICE_CONFIG_UNAVAILABLE', message: 'no active price config' } },
  })
  await seedMaterialSession(page)

  await page.goto('/print/confirm')
  await expect(benefitCard(page)).toHaveAttribute('data-benefit-state', 'price_unavailable')
  await expect(page.getByText('本机没能取到现行价目', { exact: true })).toBeVisible()
  // 反向：报价失败时既不显示金额，也不给出任何「有可用 / 已用完」结论。
  await expect(page.getByText('¥2.00')).toHaveCount(0)
  await expect(page.locator('[data-benefit-redeem]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重新报价' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^(确认并去付款|确认并打印)$/ })).toHaveCount(0)
  await expectHealthy(page, errors, 'print-confirm')
})

test('benefit card reports 后台刚调价 when quote and price-config disagree @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  // 公示价 1.20 元/页，本单报价单价 1.00 元/页 —— 两次真实读取不一致 = 后台改过价。
  api.respond('GET', '/api/v1/print/price-config', {
    status: 200,
    json: {
      billingEnabled: true,
      items: [{ serviceKey: 'print_bw_page', unitCents: 120, unit: 'page', description: '黑白打印' }],
    },
  })
  registerQuote(api, { amountCents: 200, billablePages: 2, unitCents: 100 })
  await seedMaterialSession(page)

  await page.goto('/print/confirm')
  await expect(benefitCard(page)).toHaveAttribute('data-benefit-state', 'repriced')
  await expect(page.getByText('本单报价单价 ¥1.00，现行公示单价 ¥1.20')).toBeVisible()
  // 反向：调价态不得退化成「未认领身份」，也不得给出任何权益结论。
  await expect(benefitCard(page)).not.toHaveAttribute('data-benefit-state', 'guest')
  await expect(page.locator('[data-benefit-redeem]')).toHaveCount(0)
  await expectHealthy(page, errors, 'print-confirm')
})

test('zero-amount order confirms pages without benefit mechanism copy @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  // 免费试运营价目：公示价与报价单价一致（同为 0），排除「调价」干扰，只留「免费单」。
  api.respond('GET', '/api/v1/print/price-config', {
    status: 200,
    json: {
      billingEnabled: true,
      items: [{ serviceKey: 'print_bw_page', unitCents: 0, unit: 'page', description: '免费试运营' }],
    },
  })
  registerQuote(api, { amountCents: 0, billablePages: 2, unitCents: 0 })
  await seedMaterialSession(page)

  await page.goto('/print/confirm')
  // 9/30 零元口径：保留免费事实，权益机制不出现在公共屏幕；收费单的权益用例原样保留。
  await expect(page.getByTestId('print-confirm-state-zero-amount')).toBeVisible()
  await expect(benefitCard(page)).toHaveCount(0)
  await expect(page.getByText('本单无需权益抵扣', { exact: true })).toHaveCount(0)
  await expect(page.getByTestId('print-confirm-amount')).toHaveText('免费试运营')
  await expect(page.locator('[data-w2-page="print-confirm"]')).not.toContainText(/报价|价格|付款|权益|抵扣|不扣/)
  // 反向：免费单不得摆出核销入口，也不得声称权益被消耗。
  await expect(page.locator('[data-benefit-redeem]')).toHaveCount(0)
  await expect(page.getByText('已抵扣')).toHaveCount(0)
  await expectHealthy(page, errors, 'print-confirm')
})

test('benefit card lists usable grants but keeps redemption disabled and focusable @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  registerQuote(api, { amountCents: 200, billablePages: 2, unitCents: 100 })
  registerMemberLogin(api)
  registerBenefits(api, [
    benefitGrant({ id: 'grant-usable', title: '打印体验券', quantityRemaining: 2, quantityTotal: 3 }),
    // 政策资格提示不在服务端 REDEEMABLE 白名单内，必须被挡掉（不能算成「有可用」）。
    benefitGrant({ id: 'grant-hint', benefitType: 'subsidy_eligibility_hint', title: '就业补贴资格提示' }),
  ])

  await loginThroughVisibleUi(page, '/print/confirm')
  await writePrintHandoff(page, CONFIRM_HANDOFF)
  await softNavigate(page, '/print/confirm', null)

  await expect(benefitCard(page)).toHaveAttribute('data-benefit-state', 'available')
  await expect(page.getByText('你有 1 项权益在有效期内', { exact: true })).toBeVisible()
  await expect(page.getByText('打印体验券', { exact: true })).toBeVisible()
  // 反向：不可核销的政策资格提示不得混进可用列表。
  await expect(page.getByText('就业补贴资格提示')).toHaveCount(0)

  // 核销 CTA：真 button + aria-disabled，保留焦点（不能用 disabled 属性），原因常驻可见。
  const redeem = page.locator('[data-benefit-redeem="disabled"]')
  await expect(redeem).toBeVisible()
  await expect(redeem).toHaveAttribute('aria-disabled', 'true')
  // 必须是 aria-disabled 而非 disabled 属性：disabled 会把按钮踢出 Tab 序列，
  // 变成读屏用户完全摸不到的死控件。.disabled IDL 属性直接反映内容属性是否存在。
  await expect(redeem).toHaveJSProperty('disabled', false)
  await redeem.focus()
  await expect(redeem).toBeFocused()
  await expect(page.locator('#print-benefit-redeem-reason')).toBeVisible()
  await expect(page.getByText(/本轮只展示、不核销/)).toBeVisible()

  // 资损防线：不得伪造抵扣，应付金额保持报价原值。
  await expect(page.getByText('已抵扣')).toHaveCount(0)
  await expect(page.getByText('¥0.00')).toHaveCount(0)
  await expect(page.getByText('¥2.00', { exact: true }).first()).toBeVisible()
  await expectHealthy(page, errors, 'print-confirm')
})

test('benefit card reports 已用完/过期 when no grant passes the server preconditions @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  registerQuote(api, { amountCents: 200, billablePages: 2, unitCents: 100 })
  registerMemberLogin(api)
  // 每条 grant 只违反**一条**服务端前置条件，其余字段全部合格 —— 这样任何一条校验
  // 被删掉，都会有对应的券漏进「有可用」，用例即失败（逐条可反向验证）。
  registerBenefits(api, [
    // 仅 status 不合格（对应服务端 BENEFIT_NOT_ACTIVE）
    benefitGrant({ id: 'grant-revoked', status: 'revoked', quantityRemaining: 2, title: '已撤销的券' }),
    // 仅 validUntil 已过（BENEFIT_EXPIRED）
    benefitGrant({ id: 'grant-expired', validUntil: '2020-01-01T00:00:00.000Z', title: '过期的券' }),
    // 仅 validFrom 未到（BENEFIT_NOT_STARTED）
    benefitGrant({ id: 'grant-future', validFrom: '2099-01-01T00:00:00.000Z', title: '未生效的券' }),
    // 仅余额为 0（BENEFIT_USED_UP）
    benefitGrant({ id: 'grant-used', quantityRemaining: 0, title: '已用完的券' }),
    // 仅额度为空（BENEFIT_NOT_QUANTIFIED）
    benefitGrant({ id: 'grant-unquantified', quantityRemaining: null, quantityTotal: null, title: '无额度的券' }),
    // 仅类型不在白名单（BENEFIT_NOT_REDEEMABLE）
    benefitGrant({ id: 'grant-hint', benefitType: 'subsidy_eligibility_hint', title: '就业补贴资格提示' }),
  ])

  await loginThroughVisibleUi(page, '/print/confirm')
  await writePrintHandoff(page, CONFIRM_HANDOFF)
  await softNavigate(page, '/print/confirm', null)

  await expect(benefitCard(page)).toHaveAttribute('data-benefit-state', 'none')
  await expect(page.getByText('当前没有可核销的权益', { exact: true })).toBeVisible()
  // 反向：任何一条被服务端明确会拒的券都不得出现在卡里，也不得出现核销 CTA。
  for (const blocked of ['已撤销的券', '过期的券', '未生效的券', '已用完的券', '无额度的券', '就业补贴资格提示']) {
    await expect(page.getByText(blocked)).toHaveCount(0)
  }
  await expect(page.locator('[data-benefit-redeem]')).toHaveCount(0)
  await expectHealthy(page, errors, 'print-confirm')
})

test('benefit card says 读不出来 instead of 没有权益 when /me/benefits fails @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  registerQuote(api, { amountCents: 200, billablePages: 2, unitCents: 100 })
  registerMemberLogin(api)
  api.respond('GET', '/api/v1/me/benefits', {
    status: 500,
    json: { success: false, error: { code: 'INTERNAL_ERROR', message: 'synthetic failure' } },
  })

  await loginThroughVisibleUi(page, '/print/confirm')
  await writePrintHandoff(page, CONFIRM_HANDOFF)
  await softNavigate(page, '/print/confirm', null)

  await expect(benefitCard(page)).toHaveAttribute('data-benefit-state', 'error')
  await expect(page.getByText('权益暂时读不出来', { exact: true })).toBeVisible()
  // 反向：读取失败绝不能显示成「没有可核销的权益」。
  await expect(page.getByText('当前没有可核销的权益')).toHaveCount(0)
  await expect(page.locator('[data-benefit-redeem]')).toHaveCount(0)
  await expectHealthy(page, errors, 'print-confirm')
})

test('print confirm renders the server quote amount and never a local estimate @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  let quoteBody: { fileUrl?: string; params?: { colorMode?: string; copies?: number } } | null = null
  await page.route('**/api/v1/orders/quote', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    quoteBody = route.request().postDataJSON() as typeof quoteBody
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        amountCents: 200,
        billablePages: 2,
        billingPageSource: 'detected',
        priceLines: [{ serviceKey: 'print_bw_page', description: '黑白打印', unitCents: 100, quantity: 2, amountCents: 200 }],
      }),
    })
  })
  await seedMaterialSession(page)
  await page.goto('/print/confirm')
  await expect(page.locator('[data-testid="print-confirm-state-quoted"]')).toBeVisible()
  await expect(page.getByText('¥2.00', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('¥1.00/页 × 2 页', { exact: true })).toBeVisible()
  expect(quoteBody?.fileUrl).toBe(W2_FILE.fileUrl)
  expect(quoteBody?.params?.colorMode).toBe('black_white')
  expect(quoteBody?.params?.copies).toBe(1)
  await expectHealthy(page, errors, 'print-confirm')
})

test('print confirm create-job payload matches the quoted file and params @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrice(api)
  registerQuote(api, { amountCents: 200, billablePages: 2, unitCents: 100 })
  let jobBody: { fileUrl?: string; fileName?: string; params?: { colorMode?: string; copies?: number } } | null = null
  await page.route('**/api/v1/print/jobs', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    jobBody = route.request().postDataJSON() as typeof jobBody
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        taskId: W2_ORDER.taskId,
        status: 'pending',
        createdAt: NOW,
        orderId: W2_ORDER.orderId,
        orderNo: W2_ORDER.orderNo,
        amountCents: 200,
        payStatus: 'unpaid',
        priceLines: [],
        billablePages: 2,
        billingPageSource: 'detected',
        paymentSessionToken: W2_ORDER.paymentSessionToken,
      }),
    })
  })
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
  api.respond('GET', `/api/v1/orders/${W2_ORDER.orderId}/pay-status`, { status: 200, json: payStatus('unpaid') })
  await seedMaterialSession(page)
  await page.goto('/print/confirm')
  await expect(page.getByText('¥2.00', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: /^(确认并去付款|确认并打印)$/ }).click()
  await page.waitForURL('**/print/cashier')
  expect(jobBody?.fileUrl).toBe(W2_FILE.fileUrl)
  expect(jobBody?.fileName).toBe(W2_FILE.name)
  expect(jobBody?.params?.colorMode).toBe('black_white')
  expect(jobBody?.params?.copies).toBe(1)
  await expectHealthy(page, errors, 'print-cashier')
})

test('print confirm fail-closes duplicate query keys and missing file context @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  await page.goto('/print/confirm?copies=1&copies=2')
  await expect(page.locator('[data-testid="print-confirm-state-invalid-context"]')).toBeVisible()
  await expect(page.getByTestId('print-confirm-invalid-reason')).toBeVisible()
  await expect(page.getByTestId('print-confirm-invalid-reason')).not.toHaveText(/copies=2|1&copies/)
  expect(new URL(page.url()).searchParams.getAll('copies')).toEqual([])
  expect(page.url()).toContain('state=invalid-context')
  expect(page.url()).not.toContain('#')
  await expect(page.getByRole('button', { name: '重新选文件' })).toBeVisible()
  await expect(page.getByRole('button', { name: '返回打印台' })).toBeVisible()

  await page.goto('/print/confirm')
  await expect(page.locator('[data-testid="print-confirm-state-missing-context"]')).toBeVisible()
  await expect(page.getByText('未找到文件信息')).toBeVisible()
  await expect(page.getByText('¥2.00')).toHaveCount(0)
  await expectHealthy(page, errors, 'print-confirm')
})

function buildCanvasPreviewPdf(pageStreams: string[]): string {
  const kids = pageStreams.map((_, index) => `${3 + index * 2} 0 R`).join(' ')
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Count ${pageStreams.length} /Kids [${kids}] >>\nendobj\n`,
    ...pageStreams.flatMap((stream, index) => {
      const pageId = 3 + index * 2
      return [
        `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents ${pageId + 1} 0 R >>\nendobj\n`,
        `${pageId + 1} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`,
      ]
    }),
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'))
    pdf += object
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return pdf
}

async function waitForCanvasInk(canvas: import('@playwright/test').Locator): Promise<{ dark: number; checksum: number }> {
  let ink: { dark: number; checksum: number } | null = null
  await expect.poll(async () => {
    ink = await canvas.evaluate((node: HTMLCanvasElement) => {
      const context = node.getContext('2d')
      if (!context || node.width < 2 || node.height < 2) return null
      const { data } = context.getImageData(0, 0, node.width, node.height)
      let dark = 0
      let checksum = 0
      for (let index = 0; index < data.length; index += 32) {
        const red = data[index] ?? 0
        const green = data[index + 1] ?? 0
        const blue = data[index + 2] ?? 0
        if (red < 250 || green < 250 || blue < 250) dark += 1
        checksum = (checksum + red + green * 3 + blue * 7) % 10000019
      }
      return { dark, checksum }
    })
    return ink?.dark ?? 0
  }, { timeout: 15_000 }).toBeGreaterThan(0)
  if (!ink) throw new Error('canvas ink missing')
  return ink
}

test('print preview paints each PDF page on a canvas and leaves without ERR_ABORTED @w2', async ({ page, api }) => {
  test.setTimeout(60_000)
  const errors = collectRuntimeErrors(page)
  const consoleAborts: string[] = []
  page.on('console', (message) => {
    if (message.text().includes('ERR_ABORTED')) consoleAborts.push(message.text())
  })
  registerShell(api)
  registerPrice(api)
  const pdfPath = '/pdf-canvas-fixtures/two-page.pdf'
  await page.route(`**${pdfPath}`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/pdf',
    body: buildCanvasPreviewPdf(['0 0 0 rg\n30 30 40 140 re f\n', '0 0 0 rg\n130 30 40 140 re f\n']),
  }))
  const file = { ...W2_FILE, fileUrl: pdfPath, name: 'two-page.pdf', pages: 2 }
  await seedPrintHandoff(page, { file })

  await page.goto('/print/desk?step=preview')
  const host = page.locator(`[data-pdf-preview-host][data-preview-src="${pdfPath}"]`)
  await expect(host).toHaveAttribute('data-pdf-status', 'ready', { timeout: 20_000 })
  await expect.poll(() => host.getAttribute('data-pdf-render'), { timeout: 20_000 }).not.toBe('0')
  await expect(host).toHaveAttribute('data-pdf-page', '1')
  await expect(host).toHaveAttribute('data-pdf-page-count', '2')
  await expect(host).toContainText('第 1 / 共 2 页')
  await expect(page.locator('.qpd-preview-shell iframe, .qpd-preview-shell embed, .qpd-preview-shell object')).toHaveCount(0)
  const canvas = host.locator('canvas')
  const first = await waitForCanvasInk(canvas)

  const painted = await host.getAttribute('data-pdf-render')
  await host.getByRole('button', { name: '下一页' }).click()
  await expect(host).toHaveAttribute('data-pdf-page', '2')
  await expect(host).toContainText('第 2 / 共 2 页')
  await expect.poll(() => host.getAttribute('data-pdf-render'), { timeout: 20_000 }).not.toBe(painted)
  const second = await waitForCanvasInk(canvas)
  expect(second.checksum, '第二页和第一页不是同一幅画面').not.toBe(first.checksum)

  await page.goto('/print/upload?source=document')
  await expect(page.locator('[data-w2-page="print-upload"]')).toBeVisible()
  await expect(page.locator('[data-pdf-preview-host]')).toHaveCount(0)
  expect(consoleAborts, '离开预览后控制台没有 ERR_ABORTED').toEqual([])
  expect(errors.filter((item) => item.includes('ERR_ABORTED')), '离开预览后没有 document 级 ERR_ABORTED').toEqual([])
  await expectHealthy(page, errors, 'print-upload')
})

test('print preview paints preset-CMap Chinese text @w2', async ({ page, api }) => {
  test.setTimeout(60_000)
  const errors = collectRuntimeErrors(page)
  const cmapStatuses: number[] = []
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.includes('/pdfjs/cmaps/')) cmapStatuses.push(response.status())
  })
  registerShell(api)
  registerPrice(api)
  const pdfPath = '/pdf-canvas-fixtures/zh-cmap.pdf'
  const pdfBytes = readFileSync(fileURLToPath(new URL('../../../../services/api/fixtures/zh-cmap.pdf', import.meta.url)))
  await page.route(`**${pdfPath}`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/pdf',
    body: pdfBytes,
  }))
  const file = { ...W2_FILE, fileUrl: pdfPath, name: 'zh-cmap.pdf', pages: 1 }
  await seedPrintHandoff(page, { file })

  await page.goto('/print/desk?step=preview')
  const host = page.locator(`[data-pdf-preview-host][data-preview-src="${pdfPath}"]`)
  await expect(host).toHaveAttribute('data-pdf-status', 'ready', { timeout: 20_000 })
  await expect.poll(() => host.getAttribute('data-pdf-render'), { timeout: 20_000 }).not.toBe('0')
  const bands = await host.locator('canvas').evaluate((node: HTMLCanvasElement) => {
    const context = node.getContext('2d')
    if (!context || node.width < 2 || node.height < 2) return null
    const { data, width, height } = context.getImageData(0, 0, node.width, node.height)
    const count = (start: number, end: number) => {
      const y0 = Math.floor(height * start)
      const y1 = Math.floor(height * end)
      let dark = 0
      for (let y = y0; y < y1; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4
          if ((data[index] ?? 255) < 160) dark += 1
        }
      }
      return dark
    }
    return { zh: count(0.085, 0.135), ascii: count(0.15, 0.19) }
  })
  expect(bands?.zh ?? 0, '中文行区域要有深色像素').toBeGreaterThan(30)
  expect(bands?.ascii ?? 0, '英文对照行也要画出来').toBeGreaterThan(10)
  expect(cmapStatuses.length, 'CMap 按需请求，不打进首屏脚本').toBeGreaterThan(0)
  expect(cmapStatuses.every((status) => status === 200), `CMap 请求状态 ${cmapStatuses.join(',')}`).toBe(true)
  await expectHealthy(page, errors, 'print-preview')
})

// W-118：停住第一条建任务响应，覆盖编号尚未写回时的重复挂载与 SPA 返回。
test('W-118 material checks share one in-flight round across immediate back and re-entry @w2', async ({ page, api }) => {
  registerShell(api)
  const binary = new FusionW2BinaryRoute(page)
  await binary.install()
  const counts = { inspection: 0, normalize_a4: 0, pii_scan: 0 }
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await routeExactJson(page, 'POST', '/api/v1/materials/tasks', async (route) => {
    const { kind } = route.request().postDataJSON() as { kind: keyof typeof counts }
    counts[kind] += 1
    if (kind === 'inspection') await held
    await route.fulfill({ status: 201, json: { success: true, data: materialTask(kind) } })
  })
  await seedPrintHandoff(page, { materialCheck: null })
  await page.goto('/print/desk?step=check')
  await expect.poll(() => counts.inspection).toBe(1)
  try {
    await page.getByRole('button', { name: '返回选文件', exact: true }).first().click()
    await expect(page).toHaveURL(/\/print\/upload/)
    await page.goBack()
    await expect(page.locator('[data-w2-page="print-material-check"]')).toHaveAttribute('data-qx-state', 'inspection')
  } finally {
    release()
  }
  await expect(page.getByRole('button', { name: '下一步：预览与参数' })).toBeEnabled()
  expect(counts).toEqual({ inspection: 1, normalize_a4: 1, pii_scan: 1 })
  await expect(page.getByText(W2_FILE.name, { exact: true }).first()).toBeVisible()
})

for (const withDetails of [false, true]) {
  test(`W-118 PII rejection retains the file and allows a fresh check and print (details=${withDetails}) @w2`, async ({ page, api }) => {
    registerShell(api)
    registerPrice(api)
    registerQuote(api, { amountCents: 0, billablePages: 2, unitCents: 0 })
    const binary = new FusionW2BinaryRoute(page)
    await binary.install()
    let attempts = 0
    const kinds: string[] = []
    const finding = {
      id: 'w118-phone', taskId: 'w2-pii_scan', type: 'phone', label: '手机号', pageNumber: 1,
      snippet: '13800138000', confidence: 0.98, action: 'pending' as const, createdAt: NOW,
    }
    api.respond('POST', '/api/v1/materials/tasks/w2-pii_scan/pii-findings/decisions', {
      status: 200, json: { success: true, data: { ...materialTask('pii_scan'), piiFindings: [{ ...finding, action: 'keep' }] } },
    })
    await routeExactJson(page, 'POST', '/api/v1/print/jobs', async (route) => {
      attempts += 1
      expect(route.request().postDataJSON().fileUrl).toBe(W2_FILE.fileUrl)
      await route.fulfill(attempts === 1 ? {
        status: 400,
        json: { error: { code: 'PRINT_PII_SCAN_REQUIRED', message: 'PRINT_PII_SCAN_REQUIRED', ...(withDetails ? { details: { piiTaskId: 'ignored-task', reason: 'ignored-reason' } } : {}) } },
      } : {
        status: 200,
        json: { ...W2_ORDER, status: 'pending', amountCents: 0, payStatus: 'paid', priceLines: [], billablePages: 2, billingPageSource: 'detected' },
      })
    })
    await routeExactJson(page, 'POST', '/api/v1/materials/tasks', async (route) => {
      const { kind } = route.request().postDataJSON() as { kind: 'inspection' | 'normalize_a4' | 'pii_scan' | 'pii_redact' }
      kinds.push(kind)
      expect(route.request().postDataJSON().sourceFileId).toBe(W2_FILE.fileId)
      const task = materialTask(kind)
      if (kind === 'pii_scan') task.piiFindings = [finding]
      if (kind === 'pii_redact') task.result = { ...task.result, findingCount: 1, keptCount: 1 }
      await route.fulfill({ status: 201, json: { success: true, data: task } })
    })
    api.respond('GET', '/api/v1/materials/tasks/w2-inspection/print-param-suggestions', { status: 200, json: { success: true, data: printParamSuggestions({ copies: 1 }) } })
    api.respond('GET', `/api/v1/print/jobs/${W2_ORDER.taskId}`, { status: 200, json: { taskId: W2_ORDER.taskId, status: 'pending' } })
    // 只写一次，导航后不重新播种，防止夹具掩盖上下文丢失。
    await openWithHandoff(page, '/print/confirm', {})
    await page.getByRole('button', { name: '确认并打印', exact: true }).click()
    await expect(page.getByText('这份文件的隐私检查还没有确认完，需要回到材料检查再确认一次。你的文件还在，不用重新上传。', { exact: true })).toBeVisible()
    await expect(page.getByText(/稍后重试|PRINT_PII_SCAN_REQUIRED|ignored-task|ignored-reason/)).toHaveCount(0)
    const recovery = page.getByRole('button', { name: '回到材料检查', exact: true })
    await expect(recovery).toBeVisible()
    expect((await recovery.boundingBox())!.height).toBeGreaterThanOrEqual(56)
    await recovery.click()
    await expect(page).toHaveURL(/\/print\/desk\?step=check/)
    await expect(page.getByRole('heading', { name: '这一页没有待处理的文件' })).toHaveCount(0)
    await expect(page.getByText(W2_FILE.name, { exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: '全部保留', exact: true }).click()
    await page.getByRole('button', { name: '下一步：预览与参数' }).click()
    await expect(page).toHaveURL(/step=preview/)
    await page.getByRole('button', { name: '下一步：核对价格' }).click()
    await expect(page).toHaveURL(/\/print\/confirm/)
    await expect(page.getByText('发现 1 处个人信息，你选择了全部保留，原样打印。')).toBeVisible()
    await page.getByRole('button', { name: '确认并打印', exact: true }).click()
    await expect(page).toHaveURL(/\/print\/progress/)
    expect(attempts).toBe(2)
    expect(kinds).toEqual(['inspection', 'normalize_a4', 'pii_scan', 'pii_redact'])
  })
}

// 走查 N1（10/4）：保存裁决的接口不回带访问凭证，交接里丢了它，游客从预览返回检查页时
// 隐私检查任务被 403 拒，整份办理被清。会员不靠这张凭证，所以只有游客会遇到。
test('W-118 N1 guest returns from preview to check without losing the file after keeping findings @w2', async ({ page, api }) => {
  registerShell(api)
  const binary = new FusionW2BinaryRoute(page)
  await binary.install()
  const finding = {
    id: 'n1-phone', taskId: 'w2-pii_scan', type: 'phone', label: '手机号', pageNumber: 1,
    snippet: '13800138000', confidence: 0.98, action: 'pending' as const, createdAt: NOW,
  }
  const withToken = (kind: 'inspection' | 'normalize_a4' | 'pii_scan' | 'pii_redact') => ({
    ...materialTask(kind), accessToken: `n1-token-${kind}`, ...(kind === 'pii_scan' ? { piiFindings: [finding] } : {}),
  })
  await routeExactJson(page, 'POST', '/api/v1/materials/tasks', async (route) => {
    const { kind } = route.request().postDataJSON() as { kind: 'inspection' | 'normalize_a4' | 'pii_scan' | 'pii_redact' }
    await route.fulfill({ status: 201, json: { success: true, data: withToken(kind) } })
  })
  // 和服务端一样：裁决响应里没有 accessToken。
  api.respond('POST', '/api/v1/materials/tasks/w2-pii_scan/pii-findings/decisions', {
    status: 200, json: { success: true, data: { ...materialTask('pii_scan'), accessToken: undefined, piiFindings: [{ ...finding, action: 'keep' }] } },
  })
  const piiReads: Array<string | undefined> = []
  for (const kind of ['inspection', 'normalize_a4', 'pii_scan'] as const) {
    await routeExactJson(page, 'GET', `/api/v1/materials/tasks/w2-${kind}`, async (route) => {
      const presented = route.request().headers()['x-material-task-token']
      if (kind === 'pii_scan') piiReads.push(presented)
      if (presented !== `n1-token-${kind}`) {
        await route.fulfill({ status: 403, json: { success: false, error: { code: 'MATERIAL_TASK_TOKEN_REQUIRED', message: '缺少或无效的材料任务访问凭证' } } })
        return
      }
      await route.fulfill({ status: 200, json: { success: true, data: { ...withToken(kind), ...(kind === 'pii_scan' ? { piiFindings: [{ ...finding, action: 'keep' }] } : {}) } } })
    })
  }
  api.respond('GET', '/api/v1/materials/tasks/w2-inspection/print-param-suggestions', { status: 200, json: { success: true, data: printParamSuggestions({ copies: 1 }) } })
  await seedPrintHandoff(page, { materialCheck: null })
  await page.goto('/print/desk?step=check')
  await page.getByRole('button', { name: '全部保留', exact: true }).click()
  await page.getByRole('button', { name: '下一步：预览与参数' }).click()
  await expect(page).toHaveURL(/step=preview/)
  await page.getByRole('button', { name: '返回材料检查', exact: true }).click()
  await expect(page).toHaveURL(/step=check/)
  await expect(page.getByRole('heading', { name: '这一页没有待处理的文件' })).toHaveCount(0)
  await expect(page.getByText(W2_FILE.name, { exact: true }).first()).toBeVisible()
  await expect.poll(() => piiReads.length).toBeGreaterThan(0)
  expect(piiReads.every((presented) => presented === 'n1-token-pii_scan')).toBe(true)
})

for (const [findingCount, redactedCount, keptCount, text] of [
  [0, 0, 0, '没发现需要遮挡的内容'],
  [3, 0, 3, '发现 3 处个人信息，你选择了全部保留，原样打印。'],
  [3, 2, 1, '发现 3 处个人信息，遮挡 2 处，保留 1 处。'],
] as const) {
  test(`W-118 confirm privacy summary reports actual decisions ${findingCount}/${redactedCount}/${keptCount} @w2`, async ({ page, api }) => {
    registerShell(api)
    registerPrice(api)
    registerQuote(api, { amountCents: 0, billablePages: 2, unitCents: 0 })
    await seedPrintHandoff(page, { materialCheck: {
      inspectionTaskId: 'w2-inspection-001', piiTaskId: 'w2-pii_scan', piiRedactTaskId: 'w2-pii_redact',
      checkedAt: NOW, findingCount, redactedCount, keptCount, mode: 'checked',
      redaction: { claim: redactedCount > 0 ? 'redacted_verified' : 'nothing_to_redact', redactedFileId: redactedCount > 0 ? W2_FILE.fileId : null, appliedRedactedCount: redactedCount, keptCount, failedNoPositionCount: 0, reverifyRan: redactedCount > 0, reverifyRemainingCount: 0 },
    } })
    await page.goto('/print/confirm')
    await expect(page.getByText(text, { exact: false })).toBeVisible()
    // 摘要文字和「隐私检查摘要」标签在同一个元素里，exact 匹配永远找不到它，toHaveCount(0) 会空转；这里必须用包含匹配。
    if (findingCount > 0) await expect(page.getByText('没发现需要遮挡的内容')).toHaveCount(0)
  })
}
// W-125：后台把 usb_import 关掉之后，深链接和二维码过期屏也要跟着停。
// 这些用例打 @w2，靠 playwright.w2 注入的网桥令牌才能走到能力闸门；没令牌时页面停在「未配置」。
function usbCapability(status: string, note: string | null = null) {
  return {
    status: 200,
    json: {
      terminalCode: 'KSK-001',
      capabilities: [{
        capabilityKey: 'usb_import',
        status,
        note,
        configured: true,
        updatedAt: '2026-10-04T00:00:00.000Z',
      }],
    },
  }
}

async function installUsbBridge(page: Page, hits: { count: number }): Promise<void> {
  await page.route('http://127.0.0.1:9527/local/usb/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const origin = new URL(page.url()).origin
    const corsHeaders = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Local-Bridge-Token',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Private-Network': 'true',
    }
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders })
      return
    }
    if (request.method() === 'GET' && (path.endsWith('/status') || path.endsWith('/files'))) hits.count += 1
    if (path.endsWith('/status')) {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { present: true, driveLabel: 'W125-USB' } }),
      })
      return
    }
    if (path.endsWith('/files')) {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            present: true,
            driveLabel: 'W125-USB',
            files: [{ safeId: 'w125-safe', filename: '求职材料.pdf', extension: '.pdf', sizeBytes: 2048 }],
          },
        }),
      })
      return
    }
    await route.fulfill({ status: 404, headers: corsHeaders, contentType: 'application/json', body: '{}' })
  })
}

function installExpiredPhoneUpload(api: ApiRouter): void {
  const sessionId = 'w125-upload'
  const expiresAt = '2000-01-01T00:00:00.000Z'
  api.respond('POST', '/api/v1/upload-sessions', {
    status: 200,
    json: {
      success: true,
      data: {
        sessionId,
        uploadUrl: '/upload/phone',
        uploadToken: 'w125-upload-token',
        controlToken: 'w125-control',
        expiresAt,
      },
    },
  })
  api.respond('GET', `/api/v1/upload-sessions/${sessionId}`, {
    status: 200,
    json: {
      success: true,
      data: {
        sessionId,
        status: 'expired',
        purpose: 'print_doc',
        mode: 'temporary',
        file: null,
        requiresKioskConfirmation: true,
        expiresAt,
      },
    },
  })
}

test('usb deep link stays closed while usb import is in maintenance @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  const hits = { count: 0 }
  registerShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', usbCapability('maintenance'))
  await installUsbBridge(page, hits)

  await page.goto('/print/upload?source=document&tab=usb&mode=transfer')
  await expect(page.getByText('维护中，暂时不可用', { exact: true })).toBeVisible()
  await expect(page.locator('[data-testid^="file-source-usb-file"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '导入这一份' })).toHaveCount(0)
  // 轮询是放行后立刻发出的，不是等 2 秒。先看到拒绝文案再等一小段，才能证明没有迟到的请求。
  await page.waitForTimeout(400)
  expect(hits.count).toBe(0)
  await expectHealthy(page, errors, 'print-upload')
})

test('usb deep link lists files when usb import is available @w2', async ({ page, api }) => {
  // 维护中、以及能力接口失败那两条的反向对照：同一条深链接，配成可用就要能选文件并走到导入。
  const errors = collectRuntimeErrors(page)
  const hits = { count: 0 }
  registerShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', usbCapability('available'))
  await installUsbBridge(page, hits)

  await page.goto('/print/upload?source=document&tab=usb&mode=transfer')
  await expect(page.getByRole('button', { name: /求职材料\.pdf/ })).toBeVisible()
  expect(hits.count).toBeGreaterThan(0)
  await page.getByRole('button', { name: /求职材料\.pdf/ }).click()
  await expect(page.getByRole('button', { name: '导入这一份' })).toBeVisible()
  await expectHealthy(page, errors, 'print-upload')
})

test('usb column explains when capability status cannot be read @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  const hits = { count: 0 }
  registerShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 500,
    json: { message: 'boom-internal' },
  })
  await installUsbBridge(page, hits)

  await page.goto('/print/upload?source=document&tab=usb&mode=transfer')
  await expect(page.getByText('暂时读不到本机的服务开通情况，请稍后再试或使用其他方式', { exact: true })).toBeVisible()
  await expect(page.getByText('boom-internal')).toHaveCount(0)
  await expect(page.locator('[data-testid^="file-source-usb-file"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '导入这一份' })).toHaveCount(0)
  const retry = page.getByTestId('usb-import-retry')
  await expect(retry).toBeVisible()
  const box = await retry.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(56)
  const before = api.requestCount('GET', '/api/v1/terminals/KSK-001/capabilities')
  await retry.click()
  await expect.poll(() => api.requestCount('GET', '/api/v1/terminals/KSK-001/capabilities')).toBeGreaterThan(before)
  await page.waitForTimeout(400)
  expect(hits.count).toBe(0)
  await expectHealthy(page, errors, 'print-upload')
})

test('expired phone upload hides the usb switch when usb import is closed @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', usbCapability('maintenance'))
  installExpiredPhoneUpload(api)

  await page.goto('/print/upload?source=document&tab=qr')
  await expect(page.getByRole('button', { name: '重新出一张码' })).toBeVisible()
  await expect.poll(() => api.requestCount('GET', '/api/v1/terminals/KSK-001/capabilities')).toBeGreaterThan(0)
  await page.waitForTimeout(300)
  await expect(page.getByRole('button', { name: '改用 U 盘导入' })).toHaveCount(0)
  await expectHealthy(page, errors, 'print-upload')
})

test('expired phone upload offers the usb switch when usb import is available @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', usbCapability('available'))
  installExpiredPhoneUpload(api)

  await page.goto('/print/upload?source=document&tab=qr')
  await expect(page.getByRole('button', { name: '重新出一张码' })).toBeVisible()
  await expect(page.getByRole('button', { name: '改用 U 盘导入' })).toBeVisible()
  await expectHealthy(page, errors, 'print-upload')
})
