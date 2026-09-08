import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { assertNoHorizontalOverflow } from './assert-layout'

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    if (['document', 'script', 'stylesheet'].includes(request.resourceType())) {
      errors.push(`${request.resourceType()}: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`)
    }
  })
  return errors
}

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
    json: { capabilities: [] },
  })
}

async function expectHealthy(page: Page, errors: string[], marker: string): Promise<void> {
  await expect(page.locator('[data-kiosk-presentation="fusion-youth"]').first()).toBeVisible()
  await expect(page.locator(`[data-w2-page="${marker}"]`)).toBeVisible()
  await assertNoHorizontalOverflow(page)
  expect(errors).toEqual([])
}

test('tool center honors terminal capability configuration @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: {
      capabilities: [
        { capabilityKey: 'document_print', status: 'available', note: null, configured: true, updatedAt: null },
        { capabilityKey: 'scan', status: 'maintenance', note: '扫描仪正在保养', configured: true, updatedAt: null },
        { capabilityKey: 'format_convert', status: 'available', note: null, configured: true, updatedAt: null },
        { capabilityKey: 'signature_stamp', status: 'available', note: null, configured: true, updatedAt: null },
      ],
    },
  })

  await page.goto('/print-scan')
  await expect(page.getByRole('button', { name: /材料扫描/ })).toBeDisabled()
  await expect(page.getByText('扫描仪正在保养', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /格式转换/ })).toBeEnabled()
  await expectHealthy(page, errors, 'print-scan-home')
})

// P39 迁移（V6 纵切第一刀）后，这个入口改名叫「到机码核销」并移出「七件事」栅格：
// 后端与小程序下单页本来就叫它到机码（pickup-order.service.ts 的「到机码无效或已过期」），
// 它和付款后生成的「取件凭证码」(Order.pickupCode) 是两个码。
// 合同不变：入口必须可见、可点、落到 /print/pickup-claim。
test('tool center exposes the miniapp arrival-code claim entry @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: [] },
  })

  await page.goto('/print-scan')
  const entry = page.getByRole('button', { name: /到机码核销/ })
  await expect(entry).toBeVisible()
  // 两个码必须在卡面上被区分开，否则用户拿错码白跑一趟。
  await expect(entry).toContainText('不是付款后的取件凭证码')
  // 它不占「七件事」栅格的格子 —— 标题写着七件事，就必须只有七张能力卡。
  await expect(page.locator('[data-testid^="print-hub-cap-"]')).toHaveCount(8)
  await entry.click()

  await expect(page).toHaveURL(/\/print\/pickup-claim$/)
  await expect(page.getByLabel('到机码输入框')).toBeVisible()
  expect(errors).toEqual([])
})

test('unknown tool feature key fails closed with a real recovery action @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)

  await page.goto('/print-scan/feature/not-a-real-feature')
  await expect(page.getByRole('heading', { name: '未找到该功能' })).toBeVisible()
  await expect(page.getByRole('button', { name: '返回打印扫描服务' })).toBeVisible()
  await expectHealthy(page, errors, 'print-scan-feature')
})

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

function registerConvertUpload(api: ApiRouter, filename = 'w2-image.png', fileId = 'w2-image-001'): void {
  api.respond('POST', '/api/v1/files/kiosk-upload', {
    status: 200,
    json: {
      success: true,
      data: {
        fileId,
        filename,
        sizeBytes: 1024,
        mimeType: 'image/png',
        sha256: 'c'.repeat(64),
        signedUrl: '/w2-fixtures/image.png',
        signedUrlExpiresAt: '2026-07-24T00:10:00.000Z',
        fileExpiresAt: '2026-07-25T00:00:00.000Z',
      },
    },
  })
}

async function fulfillFixtureImage(page: Page): Promise<void> {
  await page.route('**/w2-fixtures/image.png', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG_BYTES }),
  )
}

test('conversion page renders a server conversion error without fabricating output @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  await fulfillFixtureImage(page)
  registerShell(api)
  registerConvertUpload(api)
  api.respond('POST', '/api/v1/print/convert/images-to-pdf', {
    status: 422,
    json: { success: false, error: { code: 'CONVERT_FAILED', message: '合成图片尺寸不受支持' } },
  })

  await page.goto('/print-scan/convert')
  const upload = page.locator('input[type="file"]')
  await upload.setInputFiles({ name: 'w2-image.png', mimeType: 'image/png', buffer: Buffer.from('synthetic-w2-image') })
  await expect(page.getByText('w2-image.png', { exact: true })).toBeVisible()
  const thumbnail = page.getByRole('img', { name: 'w2-image.png 缩略图' })
  await expect(thumbnail).toBeVisible()
  await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  await page.getByRole('button', { name: /合成 1 张为一份 PDF/ }).click()
  await expect(page.getByText('合成图片尺寸不受支持', { exact: true })).toBeVisible()
  await expect(page.getByText('已生成', { exact: false })).toHaveCount(0)
  await expect(page).toHaveURL(/\/print-scan\/convert$/)
  await expectHealthy(page, errors, 'print-scan-convert')
})

test('conversion payload order matches the visible list after reorder @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  await fulfillFixtureImage(page)
  registerShell(api)
  api.respondWith('POST', '/api/v1/files/kiosk-upload', (requestNumber) => ({
    status: 200,
    json: {
      success: true,
      data: {
        fileId: `w2-image-00${requestNumber}`,
        filename: `w2-image-${requestNumber}.png`,
        sizeBytes: 1024,
        mimeType: 'image/png',
        sha256: 'c'.repeat(64),
        signedUrl: '/w2-fixtures/image.png',
        signedUrlExpiresAt: '2026-07-24T00:10:00.000Z',
        fileExpiresAt: '2026-07-25T00:00:00.000Z',
      },
    },
  }))
  const convertBodies: Array<{ sources?: Array<{ fileId?: string }> }> = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/print/convert/images-to-pdf')) {
      convertBodies.push(request.postDataJSON() as { sources?: Array<{ fileId?: string }> })
    }
  })
  api.respond('POST', '/api/v1/print/convert/images-to-pdf', {
    status: 200,
    json: {
      success: true,
      data: {
        fileId: 'w2-pdf-001',
        printFileUrl: '/w2-fixtures/image.png',
        fileMd5: 'd'.repeat(32),
        sizeBytes: 4096,
        pages: 2,
      },
    },
  })

  await page.goto('/print-scan/convert')
  const upload = page.locator('input[type="file"]')
  await upload.setInputFiles({ name: 'w2-image-1.png', mimeType: 'image/png', buffer: Buffer.from('synthetic-w2-image-1') })
  await expect(page.getByText('w2-image-1.png', { exact: true })).toBeVisible()
  await upload.setInputFiles({ name: 'w2-image-2.png', mimeType: 'image/png', buffer: Buffer.from('synthetic-w2-image-2') })
  await expect(page.getByText('w2-image-2.png', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '选中第 1 张：w2-image-1.png' }).click()
  await page.getByRole('button', { name: '下移' }).click()
  await expect(page.locator('[data-testid="img2pdf-order"]')).toHaveAttribute(
    'data-sent-payload',
    'w2-image-2.png | w2-image-1.png',
  )
  await page.getByRole('button', { name: /合成 2 张为一份 PDF/ }).click()
  await expect.poll(() => convertBodies.length).toBe(1)
  expect(convertBodies[0]?.sources?.map((source) => source.fileId)).toEqual(['w2-image-002', 'w2-image-001'])
  await expect(page.getByTestId('img2pdf-band').getByText('PDF 已生成')).toBeVisible()
  await expect(page.getByText('共 2 页', { exact: false })).toBeVisible()
  await expect(page).toHaveURL(/\/print-scan\/convert$/)
  await expectHealthy(page, errors, 'print-scan-convert')
})

test('conversion success stays on the page until the print CTA and does not claim save for guests @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  await fulfillFixtureImage(page)
  registerShell(api)
  registerConvertUpload(api)
  api.respond('POST', '/api/v1/print/convert/images-to-pdf', {
    status: 200,
    json: {
      success: true,
      data: {
        fileId: 'w2-pdf-guest',
        printFileUrl: '/w2-fixtures/image.png',
        fileMd5: 'e'.repeat(32),
        sizeBytes: 2048,
        pages: 1,
      },
    },
  })
  // 合成 PDF 进打印台后会立刻开始材料检查。本用例只断言出口落到 /print/desk，
  // 不跑完整 PII 链，所以给一个最小完成态，避免 ApiRouter 把 POST 判成未处理。
  api.respond('POST', '/api/v1/materials/tasks', {
    status: 200,
    json: {
      success: true,
      data: {
        id: 'w2-convert-inspection',
        kind: 'inspection',
        status: 'completed',
        sourceFileId: 'w2-pdf-guest',
        result: { mode: 'real', checks: { pageCount: 1, canPrint: true, messages: [] } },
        createdAt: '2026-07-24T00:00:00.000Z',
        updatedAt: '2026-07-24T00:00:00.000Z',
      },
    },
  })

  await page.goto('/print-scan/convert')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'w2-image.png',
    mimeType: 'image/png',
    buffer: Buffer.from('synthetic-w2-image'),
  })
  await expect(page.getByText('w2-image.png', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /合成 1 张为一份 PDF/ }).click()
  await expect(page.getByTestId('img2pdf-band').getByText('PDF 已生成')).toBeVisible()
  await expect(page.getByText('未登录 · 不进我的文档', { exact: true })).toBeVisible()
  await expect(page.getByText('已保存', { exact: false })).toHaveCount(0)
  const printCta = page.getByRole('button', { name: '拿这份 PDF 去打印' })
  await expect(printCta).toBeVisible()
  const box = await printCta.boundingBox()
  expect(box, '主按钮必须能量到尺寸').not.toBeNull()
  expect(box!.height, '主按钮高度（1080 舞台未缩放）不得小于 56px').toBeGreaterThanOrEqual(56)
  await printCta.click()
  await expect(page).toHaveURL(/\/print\/desk\?step=check/)
  expect(errors).toEqual([])
})

const W2_MEMBER_TOKEN = 'w2-sign-memory-token'
const W2_MEMBER_PHONE = '13800138000'
const W2_MEMBER_CODE = '123456'

function registerSignCapabilities(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: {
      capabilities: [
        {
          capabilityKey: 'signature_stamp',
          status: 'available',
          note: null,
          configured: true,
          updatedAt: null,
        },
      ],
    },
  })
}

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
        user: { id: 'member-w2-sign', phoneMasked: '138****8000', nickname: '签章验收用户' },
      },
    },
  })
  api.respond('GET', '/api/v1/me/pending-tasks', { status: 200, json: { success: true, data: [] } })
  api.respond('GET', '/api/v1/me/favorites', {
    status: 200,
    json: { success: true, data: { items: [], nextCursor: null, total: 0 } },
  })
}

async function loginThroughVisibleUi(page: Page, returnTo: string): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  for (const digit of W2_MEMBER_PHONE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of W2_MEMBER_CODE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === returnTo)
}

test('signature page fails closed for anonymous users @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerSignCapabilities(api)

  await page.goto('/print-scan/sign')
  await expect(page.locator('[data-testid="sign-stamp-state-login-required"]')).toBeVisible()
  await expect(page.getByTestId('sign-stamp-fallback')).toContainText('先登录才能做签名盖章')
  await expect(page.locator('[data-w2-page="print-scan-sign"]')).toContainText('不提供 CA 电子签')
  await expectHealthy(page, errors, 'print-scan-sign')
  await page.getByTestId('sign-stamp-primary').click()
  await expect(page).toHaveURL(/\/login/)
})

test('signature inspect renders server pages and compose sends placement payload @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerSignCapabilities(api)
  registerMemberLogin(api)
  api.respondWith('POST', '/api/v1/files/kiosk-upload', (n) =>
    n === 1
      ? {
          status: 200,
          json: {
            success: true,
            data: {
              fileId: 'w2-sign-doc',
              filename: '就业协议.pdf',
              sizeBytes: 1800,
              mimeType: 'application/pdf',
              sha256: 'a'.repeat(64),
              signedUrl: '/w2-fixtures/doc.pdf',
              signedUrlExpiresAt: '2026-07-24T00:10:00.000Z',
              fileExpiresAt: '2026-07-25T00:00:00.000Z',
            },
          },
        }
      : {
          status: 200,
          json: {
            success: true,
            data: {
              fileId: 'w2-sign-stamp',
              filename: '签名.png',
              sizeBytes: 240,
              mimeType: 'image/png',
              sha256: 'b'.repeat(64),
              signedUrl: '/w2-fixtures/stamp.png',
              signedUrlExpiresAt: '2026-07-24T00:10:00.000Z',
              fileExpiresAt: '2026-07-24T01:00:00.000Z',
            },
          },
        },
  )
  api.respond('POST', '/api/v1/print/sign/inspect', {
    status: 200,
    json: { success: true, data: { pages: 6 } },
  })
  api.respond('POST', '/api/v1/print/sign/compose', {
    status: 200,
    json: {
      success: true,
      data: {
        fileId: 'w2-sign-out',
        printFileUrl: '',
        fileMd5: 'c'.repeat(32),
        sizeBytes: 2100,
        pages: 6,
      },
    },
  })

  const composeBodies: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/print/sign/compose')) {
      composeBodies.push(request.postData() ?? '')
    }
  })

  await loginThroughVisibleUi(page, '/print-scan/sign')
  await expect(page.getByText('选要盖章的 PDF')).toBeVisible()
  await page.locator('input[accept="application/pdf"]').setInputFiles({
    name: '就业协议.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
  })
  await expect(page.getByTestId('sign-stamp-doc-tag')).toContainText('就业协议.pdf')
  await expect(page.getByTestId('sign-stamp-doc-tag')).toContainText('6 页')
  await page.locator('input[accept="image/jpeg,image/png"]').setInputFiles({
    name: '签名.png',
    mimeType: 'image/png',
    buffer: Buffer.from('png'),
  })
  await expect(page.getByTestId('sign-stamp-stamp-tag')).toContainText('签名.png')
  const authorize = page.getByRole('checkbox', { name: /我确认本人拥有该签名\/印章图片的使用授权/ })
  await expect(authorize).not.toBeChecked()
  await expect(page.getByRole('button', { name: '生成合成 PDF（请先确认授权）' })).toBeDisabled()
  await authorize.click()
  await page.getByRole('button', { name: '生成合成 PDF', exact: true }).click()
  await expect(page.getByTestId('sign-stamp-fallback')).toContainText('新的派生 PDF 已生成')
  expect(composeBodies).toHaveLength(1)
  const payload = JSON.parse(composeBodies[0]) as {
    authorizationConfirmed: boolean
    placement: { page: number; position: string; size: string }
    document: { fileId: string }
    stamp: { fileId: string }
  }
  expect(payload.authorizationConfirmed).toBe(true)
  expect(payload.placement).toEqual({ page: 6, position: 'bottom-right', size: 'medium' })
  expect(payload.document.fileId).toBe('w2-sign-doc')
  expect(payload.stamp.fileId).toBe('w2-sign-stamp')
  await expectHealthy(page, errors, 'print-scan-sign')
})

test('signature compose 429 shows rate-limited and does not silently retry @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerSignCapabilities(api)
  registerMemberLogin(api)
  api.respondWith('POST', '/api/v1/files/kiosk-upload', (n) =>
    n === 1
      ? {
          status: 200,
          json: {
            success: true,
            data: {
              fileId: 'w2-sign-doc-rl',
              filename: '协议.pdf',
              sizeBytes: 1200,
              mimeType: 'application/pdf',
              sha256: 'd'.repeat(64),
              signedUrl: '/w2-fixtures/doc.pdf',
              signedUrlExpiresAt: '2026-07-24T00:10:00.000Z',
              fileExpiresAt: '2026-07-25T00:00:00.000Z',
            },
          },
        }
      : {
          status: 200,
          json: {
            success: true,
            data: {
              fileId: 'w2-sign-stamp-rl',
              filename: '章.png',
              sizeBytes: 200,
              mimeType: 'image/png',
              sha256: 'e'.repeat(64),
              signedUrl: '/w2-fixtures/stamp.png',
              signedUrlExpiresAt: '2026-07-24T00:10:00.000Z',
              fileExpiresAt: '2026-07-24T01:00:00.000Z',
            },
          },
        },
  )
  api.respond('POST', '/api/v1/print/sign/inspect', {
    status: 200,
    json: { success: true, data: { pages: 2 } },
  })
  api.respond('POST', '/api/v1/print/sign/compose', {
    status: 429,
    json: { success: false, error: { code: 'RATE_LIMITED', message: '提交太频繁' } },
  })

  await loginThroughVisibleUi(page, '/print-scan/sign')
  await page.locator('input[accept="application/pdf"]').setInputFiles({
    name: '协议.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
  })
  await expect(page.getByTestId('sign-stamp-doc-tag')).toContainText('协议.pdf')
  await page.locator('input[accept="image/jpeg,image/png"]').setInputFiles({
    name: '章.png',
    mimeType: 'image/png',
    buffer: Buffer.from('png'),
  })
  await page.getByRole('checkbox', { name: /我确认本人拥有该签名\/印章图片的使用授权/ }).click()
  await page.getByRole('button', { name: '生成合成 PDF', exact: true }).click()
  await expect(page.getByTestId('sign-stamp-fallback')).toContainText('提交太频繁了')
  await expect(page.locator('[data-testid="sign-stamp-state-rate-limited"]')).toBeVisible()
  await expect(page.getByText('新的派生 PDF 已生成')).toHaveCount(0)
  expect(api.requestCount('POST', '/api/v1/print/sign/compose')).toBe(1)
  await expectHealthy(page, errors, 'print-scan-sign')
})

for (const alias of [
  { from: '/print/scan-convert', to: '/print-scan/convert', marker: 'print-scan-convert' },
  { from: '/print/scan-sign', to: '/print-scan/sign', marker: 'print-scan-sign' },
  { from: '/print/scan-feature', to: '/print-scan/feature/id-photo', marker: 'print-scan-feature' },
] as const) {
  test(`${alias.from} redirects to ${alias.to} @w2`, async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    registerShell(api)

    await page.goto(alias.from)
    await page.waitForURL(`**${alias.to}`)
    await expectHealthy(page, errors, alias.marker)
  })
}
