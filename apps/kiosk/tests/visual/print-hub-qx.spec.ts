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

function registerShell(api: ApiRouter, printer: { isOnline: boolean; printerStatus: string } = {
  isOnline: true,
  printerStatus: 'ready',
}): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: printer.printerStatus, paperLevel: 'sufficient', isOnline: printer.isOnline },
  })
}

const AVAILABLE = [
  { capabilityKey: 'document_print', status: 'available', note: null, configured: true, updatedAt: null },
  { capabilityKey: 'phone_upload', status: 'available', note: null, configured: true, updatedAt: null },
  { capabilityKey: 'usb_import', status: 'available', note: null, configured: true, updatedAt: null },
  { capabilityKey: 'scan', status: 'available', note: null, configured: true, updatedAt: null },
  { capabilityKey: 'format_convert', status: 'available', note: null, configured: true, updatedAt: null },
  { capabilityKey: 'signature_stamp', status: 'available', note: null, configured: true, updatedAt: null },
]

async function expectNoForgedReady(page: Page): Promise<void> {
  await expect(page.getByText('设备正常', { exact: false })).toHaveCount(0)
  await expect(page.getByText('一键投递')).toHaveCount(0)
  await expect(page.getByText('立即投递')).toHaveCount(0)
  await expect(page.getByText('平台投递')).toHaveCount(0)
}

test('print hub default state reads capabilities and never claims 设备正常 @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: AVAILABLE },
  })

  await page.goto('/print-scan')
  await expect(page.locator('[data-testid="print-hub-state-default"]')).toBeVisible()
  await expect(page.getByText('能力与设备状态以办理时确认')).toBeVisible()
  await expect(page.locator('[data-testid^="print-hub-cap-"]')).toHaveCount(8)
  await expect(page.getByRole('button', { name: /文档打印/ })).toBeEnabled()
  await expect(page.getByRole('button', { name: /U 盘导入打印/ })).toBeEnabled()
  await expect(page.getByRole('button', { name: /到机码核销/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /到机码核销/ })).toContainText('不是付款后的取件凭证码')
  await expect(page.getByText('请直接在奔图机器面板上操作')).toBeVisible()
  await expectNoForgedReady(page)
  await assertNoHorizontalOverflow(page)
  await page.screenshot({ path: test.info().outputPath('print-hub-default.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('print hub capability-loading fail-closes all eight cards @w2', async ({ page, api }) => {
  test.setTimeout(20_000)
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respondWith('GET', '/api/v1/terminals/KSK-001/capabilities', async () => {
    await new Promise((resolve) => setTimeout(resolve, 60_000))
    return { status: 200, json: { capabilities: [] } }
  })

  await page.goto('/print-scan')
  await expect(page.locator('[data-testid="print-hub-state-capability-loading"]')).toBeVisible()
  await expect(page.getByText('正在检查本机能力')).toBeVisible()
  await expect(page.getByRole('button', { name: /文档打印/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: /到机码核销/ })).toBeEnabled()
  await expectNoForgedReady(page)
  expect(errors).toEqual([])
})

test('print hub capability-error fail-closes tasks and keeps arrival-code @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 500,
    json: { error: { code: 'INTERNAL', message: 'boom' } },
  })

  await page.goto('/print-scan')
  await expect(page.locator('[data-testid="print-hub-state-capability-error"]')).toBeVisible()
  await expect(page.getByTestId('print-hub-fallback').getByText('服务状态无法确认', { exact: true })).toBeVisible()
  await expect(page.getByTestId('print-hub-cap-doc-print')).toBeDisabled()
  await expect(page.getByTestId('print-hub-fallback').getByRole('button', { name: '重新检测', exact: true })).toBeVisible()
  await expect(page.getByTestId('print-hub-fallback').getByRole('button', { name: '联系工作人员', exact: true })).toBeVisible()
  await expect(page.getByTestId('print-hub-primary')).toBeEnabled()
  await expectNoForgedReady(page)
  expect(errors).toEqual([])
})

test('print hub locked state uses admin capability notes @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: {
      capabilities: [
        { capabilityKey: 'document_print', status: 'maintenance', note: null, configured: true, updatedAt: null },
        { capabilityKey: 'scan', status: 'maintenance', note: '扫描仪正在保养', configured: true, updatedAt: null },
        { capabilityKey: 'id_photo', status: 'not_verified', note: null, configured: true, updatedAt: null },
        { capabilityKey: 'format_convert', status: 'available', note: null, configured: true, updatedAt: null },
      ],
    },
  })

  await page.goto('/print-scan')
  await expect(page.locator('[data-testid="print-hub-state-locked"]')).toBeVisible()
  await expect(page.getByText('有几项被管理员关掉了')).toBeVisible()
  await expect(page.getByRole('button', { name: /材料扫描/ })).toBeDisabled()
  await expect(page.getByText('扫描仪正在保养', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /格式转换/ })).toBeEnabled()
  await expectNoForgedReady(page)
  expect(errors).toEqual([])
})

test('print hub device-off pauses paper paths and keeps software paths @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api, { isOnline: false, printerStatus: 'offline' })
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: AVAILABLE },
  })

  await page.goto('/print-scan')
  await expect(page.locator('[data-testid="print-hub-state-device-off"]')).toBeVisible()
  await expect(page.getByTestId('print-hub-fallback').getByText('打印扫描一体机离线', { exact: false })).toBeVisible()
  await expect(page.getByTestId('print-hub-cap-doc-print')).toBeDisabled()
  await expect(page.getByTestId('print-hub-cap-scan')).toBeDisabled()
  await expect(page.getByTestId('print-hub-cap-convert')).toBeEnabled()
  await expect(page.getByTestId('print-hub-cap-sign')).toBeEnabled()
  await expect(page.getByRole('button', { name: /到机码核销/ })).toBeEnabled()
  await expect(page.getByTestId('print-hub-cap-doc-print')).toContainText('这台机器现在出不了纸')
  await expectNoForgedReady(page)
  expect(errors).toEqual([])
})

test('print hub printer-status failure stays unknown, never 设备正常 @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.abort('GET', '/api/v1/terminals/KSK-001/printer-status', 'internetdisconnected')
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: AVAILABLE },
  })

  await page.goto('/print-scan')
  await expect(page.locator('[data-testid="print-hub-state-default"]')).toBeVisible()
  await expect(page.getByText('能力与设备状态以办理时确认')).toBeVisible()
  await expect(page.getByText('设备正常')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /文档打印/ })).toBeEnabled()
  expect(errors).toEqual([])
})

test('id-photo feature page is honest and offers real fallbacks @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: [] },
  })

  await page.goto('/print-scan/feature/id-photo')
  await expect(page.locator('[data-testid="print-hub-state-feature-id-photo"]')).toBeVisible()
  await expect(page.getByText('证件照：本机尚未开放')).toBeVisible()
  await expect(page.getByText('没有可用流程')).toBeVisible()
  await page.locator('[data-testid="print-hub-idphoto-fallback"]').click()
  await expect(page).toHaveURL(/\/print\/upload\?.*category=photo/)
  expect(errors).toEqual([])
})

test('unknown feature key fails closed with recovery actions @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: [] },
  })

  await page.goto('/print-scan/feature/not-a-real-feature')
  await expect(page.locator('[data-testid="print-hub-state-feature-not-found"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: '未找到该功能' })).toBeVisible()
  await expect(page.getByText('没有这项能力说明')).toBeVisible()
  await expect(page.getByRole('button', { name: '返回打印扫描服务' })).toBeVisible()
  await expect(page.getByRole('button', { name: '联系工作人员' })).toBeVisible()
  await page.getByRole('button', { name: '返回打印扫描服务' }).click()
  await expect(page).toHaveURL(/\/print-scan$/)
  expect(errors).toEqual([])
})
