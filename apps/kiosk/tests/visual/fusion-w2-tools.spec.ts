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
