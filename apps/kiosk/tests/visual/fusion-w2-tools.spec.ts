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
  await expect(page.locator('.v6-ph-grid .v6-ph-card')).toHaveCount(8) // 7 张能力卡 + 1 张状态卡
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

test('conversion page renders a server conversion error without fabricating output @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  await page.route('**/w2-fixtures/image.png', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  )
  registerShell(api)
  api.respond('POST', '/api/v1/files/kiosk-upload', {
    status: 200,
    json: {
      success: true,
      data: {
        fileId: 'w2-image-001',
        filename: 'w2-image.png',
        sizeBytes: 1024,
        mimeType: 'image/png',
        sha256: 'c'.repeat(64),
        signedUrl: '/w2-fixtures/image.png',
        signedUrlExpiresAt: '2026-07-24T00:10:00.000Z',
        fileExpiresAt: '2026-07-25T00:00:00.000Z',
      },
    },
  })
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
  await page.getByRole('button', { name: /生成 PDF/ }).click()
  await expect(page.getByText('合成图片尺寸不受支持', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/print-scan\/convert$/)
  await expectHealthy(page, errors, 'print-scan-convert')
})

test('signature compose remains gated by explicit authorization @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)

  await page.goto('/print-scan/sign')
  const generate = page.getByRole('button', { name: '生成合成 PDF（请先确认授权）' })
  await expect(generate).toBeDisabled()
  await expect(page.getByRole('checkbox', { name: /我确认本人拥有该签名\/印章图片的使用授权/ })).not.toBeChecked()
  await expect(page.locator('[data-w2-page="print-scan-sign"]')).toContainText('不提供 CA 电子签')
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
