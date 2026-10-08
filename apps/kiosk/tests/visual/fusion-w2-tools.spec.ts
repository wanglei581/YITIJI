import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { assertNoHorizontalOverflow } from './assert-layout'
import { isAbortedPdfjsBlobImport } from './fixtures/pdf-preview-blob-abort'

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    if (isAbortedPdfjsBlobImport(request)) return
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

// P39 迁移（V6 纵切第一刀）后，这个入口改名叫「到机码核销」并移出「七件事」栅格。
// 2026-10-06 方案②：到机码就是取件码。卡面上的「不是取件码」只用来和上传码消歧。
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
  // 方案②：到机码就是唯一取件码。卡面徽标不再说「不是取件码」。
  await expect(entry).toContainText('取件就用它')
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
        hasEndUser: false,
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

// 后端没有「游客转换件登录后认领」的接口：归属在转换那一刻按会员令牌定死（hasEndUser）。
// 所以游客完成态的登录按钮只能叫「先登录再转换」，登录回来回到本页重新选图，由用户自己再点转换；
// 不能把这份游客件带去打印台，让人以为登录就把它存下了。
test('guest login from a finished conversion comes back to convert again, not to a "saved" copy @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  await fulfillFixtureImage(page)
  registerShell(api)
  registerConvertUpload(api)
  registerMemberLogin(api)
  api.respond('POST', '/api/v1/print/convert/images-to-pdf', {
    status: 200,
    json: {
      success: true,
      data: {
        fileId: 'w2-pdf-guest-login',
        printFileUrl: '/w2-fixtures/image.png',
        fileMd5: 'f'.repeat(32),
        sizeBytes: 2048,
        pages: 1,
        hasEndUser: false,
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
  await expect(page.getByTestId('img2pdf-band')).toContainText('转好之后再登录也存不进去')
  await expect(page.getByTestId('img2pdf-band')).toContainText('不登录也能直接打印这份')
  await expect(page.getByRole('button', { name: '先登录再保存' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '拿这份 PDF 去打印' })).toBeVisible()

  await page.getByRole('button', { name: '先登录再转换', exact: true }).click()
  await expect(page).toHaveURL(/\/login\?from=%2Fprint-scan%2Fconvert$/)
  // 没有替用户把这份游客件写成打印交接：登录回来不会落到打印台。
  expect(
    await page.evaluate(() => window.sessionStorage.getItem('ai-job-print:current-print-material-check')),
  ).toBeNull()

  await loginThroughVisibleUi(page, '/print-scan/convert')
  await expect(page).toHaveURL(/\/print-scan\/convert$/)
  // 回到选图这一步：列表是空的，转换要用户自己重新做；规则卡按已登录说「会进我的文档」。
  await expect(page.getByText('w2-image.png', { exact: true })).toHaveCount(0)
  await expect(page.getByTestId('img2pdf-band').getByText('PDF 已生成')).toHaveCount(0)
  await expect(page.getByTestId('img2pdf-primary')).toBeDisabled()
  expect(api.requestCount('POST', '/api/v1/print/convert/images-to-pdf')).toBe(1)
  await expectHealthy(page, errors, 'print-scan-convert')
})

test('finished conversion hides file id, checksum and request key, and offers 问小青 @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  await fulfillFixtureImage(page)
  registerShell(api)
  registerConvertUpload(api, '毕业证-正面.jpg', 'w2-image-honest')
  const fileId = 'w2-pdf-honest-9f3c'
  const fileMd5 = '9f3c1a7e4b20d8569f3c1a7e4b20d856'
  let requestKey = ''
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/print/convert/images-to-pdf')) {
      requestKey = request.headers()['idempotency-key'] ?? ''
    }
  })
  api.respond('POST', '/api/v1/print/convert/images-to-pdf', {
    status: 200,
    json: {
      success: true,
      data: {
        fileId,
        printFileUrl: '/w2-fixtures/image.png',
        fileMd5,
        sizeBytes: 2048,
        pages: 1,
        hasEndUser: false,
      },
    },
  })

  await page.goto('/print-scan/convert')
  await page.locator('input[type="file"]').setInputFiles({
    name: '毕业证-正面.jpg',
    mimeType: 'image/png',
    buffer: PNG_BYTES,
  })
  await expect(page.getByText('毕业证-正面.jpg', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /合成 1 张为一份 PDF/ }).click()
  await expect(page.getByTestId('img2pdf-band').getByText('PDF 已生成')).toBeVisible()
  await expect(page.getByTestId('img2pdf-fileid')).toHaveText('看文件名和页数')
  await expect(page.getByText('怎么认', { exact: true })).toBeVisible()

  expect(requestKey).toMatch(/^convert-\d+-[a-z0-9]+$/)
  const text = await page.locator('.qx-stage').innerText()
  expect(text).not.toContain(fileId)
  expect(text).not.toContain(fileMd5)
  expect(text).not.toContain(fileMd5.slice(0, 12))
  expect(text).not.toContain(requestKey)
  expect(text).toContain('问小青')
  expect(text).not.toContain('工作人员')
  await expect(page.getByTestId('img2pdf-ask')).toContainText('问小青：这几张图怎么排')
  await expect(page).toHaveURL(/\/print-scan\/convert$/)
  await expectHealthy(page, errors, 'print-scan-convert')
})

test('completed conversion says the same save fact in the pill, the card and the footer when logged in @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  await fulfillFixtureImage(page)
  registerShell(api)
  registerMemberLogin(api)
  registerConvertUpload(api)
  api.respond('POST', '/api/v1/print/convert/images-to-pdf', {
    status: 200,
    json: {
      success: true,
      data: {
        fileId: 'w2-pdf-member',
        printFileUrl: '/w2-fixtures/image.png',
        fileMd5: 'a'.repeat(32),
        sizeBytes: 2048,
        pages: 1,
        hasEndUser: true,
      },
    },
  })

  await loginThroughVisibleUi(page, '/print-scan/convert')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'w2-image.png',
    mimeType: 'image/png',
    buffer: PNG_BYTES,
  })
  await expect(page.getByText('w2-image.png', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /合成 1 张为一份 PDF/ }).click()

  await expect(page.locator('.qx-pill')).toHaveText('PDF 已生成 · 已进我的文档')
  const band = page.getByTestId('img2pdf-band')
  await expect(band).toContainText('已进我的文档')
  await expect(band).not.toContainText('未登录')
  await expect(band).not.toContainText('存不进去')
  const card = page.getByTestId('img2pdf-retention')
  await expect(card).toHaveAttribute('data-auth', 'in')
  await expect(card).toContainText('带走一份按顺序排好的 PDF')
  await expect(card).toContainText('默认保存约 24 小时')
  await expect(card).not.toContainText('存不进去')
  await expect(card).not.toContainText('未登录')
  const truth = page.getByTestId('img2pdf-truth')
  await expect(truth).toContainText('登录后 PDF 进「我的文档」')
  await expect(truth).not.toContainText('未登录')
  await expect(page.getByRole('button', { name: '查看我的文档', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '先登录再转换', exact: true })).toHaveCount(0)
  await expectHealthy(page, errors, 'print-scan-convert')
})

test('completed conversion says the same save fact in the pill, the card and the footer when logged out @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  await fulfillFixtureImage(page)
  registerShell(api)
  registerConvertUpload(api)
  api.respond('POST', '/api/v1/print/convert/images-to-pdf', {
    status: 200,
    json: {
      success: true,
      data: {
        fileId: 'w2-pdf-guest-agree',
        printFileUrl: '/w2-fixtures/image.png',
        fileMd5: 'b'.repeat(32),
        sizeBytes: 2048,
        pages: 1,
        hasEndUser: false,
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

  await expect(page.locator('.qx-pill')).toHaveText('已生成 · 未登录不留存')
  const band = page.getByTestId('img2pdf-band')
  await expect(band).toContainText('未登录 · 不进我的文档')
  await expect(band).toContainText('转好之后再登录也存不进去')
  const card = page.getByTestId('img2pdf-retention')
  await expect(card).toHaveAttribute('data-auth', 'out')
  await expect(card).toContainText('转好之后再登录也存不进去')
  await expect(card).not.toContainText('默认保存约 24 小时')
  const truth = page.getByTestId('img2pdf-truth')
  await expect(truth).toContainText('未登录时 PDF 不会进入「我的文档」')
  await expect(truth).not.toContainText('登录后 PDF 进「我的文档」')
  await expect(page.getByRole('button', { name: '先登录再转换', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '先登录再保存', exact: true })).toHaveCount(0)
  await expectHealthy(page, errors, 'print-scan-convert')
})

test('example bar on the conversion page appears only with example=1 and never on the empty screen @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  await fulfillFixtureImage(page)
  registerShell(api)
  registerConvertUpload(api)

  await page.goto('/print-scan/convert')
  await expect(page.getByText('先加第一张。', { exact: true })).toBeVisible()
  await expect(page.getByTestId('img2pdf-fixture')).toHaveCount(0)

  await page.locator('input[type="file"]').setInputFiles({
    name: 'w2-image.png',
    mimeType: 'image/png',
    buffer: Buffer.from('synthetic-w2-image'),
  })
  await expect(page.getByText('w2-image.png', { exact: true })).toBeVisible()
  await expect(page.getByTestId('img2pdf-fixture')).toHaveCount(0)

  await page.goto('/print-scan/convert?example=1')
  await expect(page.getByText('先加第一张。', { exact: true })).toBeVisible()
  await expect(page.getByTestId('img2pdf-fixture')).toHaveCount(0)

  await page.locator('input[type="file"]').setInputFiles({
    name: 'w2-image.png',
    mimeType: 'image/png',
    buffer: Buffer.from('synthetic-w2-image'),
  })
  await expect(page.getByText('w2-image.png', { exact: true })).toBeVisible()
  const bar = page.getByTestId('img2pdf-fixture')
  await expect(bar).toBeVisible()
  await expect(bar.locator('.i2p-fx-b')).toHaveText('示例')
  await expect(bar).toContainText('这一屏是示例：图片、文件名和转换结果都是示例，不是哪位用户的文件。')
  await expectHealthy(page, errors, 'print-scan-convert')
})

test('known conversion failure offers the service phone and a real retry, not a staff button @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  await fulfillFixtureImage(page)
  registerShell(api)
  registerConvertUpload(api)
  api.respond('POST', '/api/v1/print/convert/images-to-pdf', {
    status: 422,
    json: { success: false, error: { code: 'CONVERT_FAILED', message: 'PDF 生成校验失败，请重试' } },
  })

  await page.goto('/print-scan/convert')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'w2-image.png',
    mimeType: 'image/png',
    buffer: Buffer.from('synthetic-w2-image'),
  })
  await expect(page.getByText('w2-image.png', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /合成 1 张为一份 PDF/ }).click()

  await expect(page.getByText('PDF 生成校验失败，请重试', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '按原样重试合成', exact: true })).toBeVisible()
  await expect(page.getByText('图片和顺序都保留着', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '返回打印扫描', exact: true }).first()).toBeVisible()
  await expect(page.getByTestId('img2pdf-ask')).toContainText('问小青')
  const help = page.getByTestId('img2pdf-help')
  await expect(help).toContainText('需要帮助？')
  await expect(help).toContainText('18369161921')
  await expect(help).not.toContainText('工作人员')
  const text = await page.locator('.qx-stage').innerText()
  expect(text).not.toContain('工作人员')
  expect(text).not.toContain('服务台')
  await expect(page.getByRole('button', { name: '联系工作人员' })).toHaveCount(0)
  await expectHealthy(page, errors, 'print-scan-convert')
})

async function assertRetentionNotCoveredByTruth(page: Page): Promise<void> {
  const report = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="img2pdf-retention"]')
    const truth = document.querySelector('[data-testid="img2pdf-truth"]')
    const scroll = document.querySelector('.i2p-scroll')
    if (!(card instanceof HTMLElement) || !(truth instanceof HTMLElement) || !(scroll instanceof HTMLElement)) {
      return { ok: false, reason: 'missing' }
    }
    const measure = (block: 'start' | 'end') => {
      const before = card.getBoundingClientRect()
      const frame = scroll.getBoundingClientRect()
      scroll.scrollTop += block === 'start' ? before.top - frame.top : before.bottom - frame.bottom
      const cr = card.getBoundingClientRect()
      const tr = truth.getBoundingClientRect()
      const sr = scroll.getBoundingClientRect()
      const top = Math.max(cr.top, sr.top)
      const bottom = Math.min(cr.bottom, sr.bottom)
      const left = Math.max(cr.left, sr.left)
      const right = Math.min(cr.right, sr.right)
      const visible = bottom - top > 8 && right - left > 8
      const overlapY = Math.min(bottom, tr.bottom) - Math.max(top, tr.top)
      const overlapX = Math.min(right, tr.right) - Math.max(left, tr.left)
      return {
        visible,
        covered: visible && overlapY > 1 && overlapX > 1,
        overlapY,
        cardBottom: cr.bottom,
        truthTop: tr.top,
        scrollBottom: sr.bottom,
      }
    }
    const atStart = measure('start')
    const atEnd = measure('end')
    return { ok: atStart.visible && !atStart.covered && atEnd.visible && !atEnd.covered, atStart, atEnd }
  })
  expect(report.ok, JSON.stringify(report)).toBe(true)
}

test('bottom truth bar does not cover the retention card on ready or completed conversion @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  await fulfillFixtureImage(page)
  registerShell(api)
  api.respondWith('POST', '/api/v1/files/kiosk-upload', (requestNumber) => ({
    status: 200,
    json: {
      success: true,
      data: {
        fileId: `w2-cover-00${requestNumber}`,
        filename: `w2-cover-${requestNumber}.png`,
        sizeBytes: 1024,
        mimeType: 'image/png',
        sha256: 'c'.repeat(64),
        signedUrl: '/w2-fixtures/image.png',
        signedUrlExpiresAt: '2026-07-24T00:10:00.000Z',
        fileExpiresAt: '2026-07-25T00:00:00.000Z',
      },
    },
  }))
  api.respond('POST', '/api/v1/print/convert/images-to-pdf', {
    status: 200,
    json: {
      success: true,
      data: {
        fileId: 'w2-pdf-cover',
        printFileUrl: '/w2-fixtures/image.png',
        fileMd5: 'c'.repeat(32),
        sizeBytes: 4096,
        pages: 3,
        hasEndUser: false,
      },
    },
  })

  await page.goto('/print-scan/convert')
  const upload = page.locator('input[type="file"]')
  for (const name of ['w2-cover-1.png', 'w2-cover-2.png', 'w2-cover-3.png']) {
    await upload.setInputFiles({ name, mimeType: 'image/png', buffer: Buffer.from(`synthetic-${name}`) })
    await expect(page.getByText(name, { exact: true })).toBeVisible()
  }
  await expect(page.getByTestId('img2pdf-list')).toHaveAttribute('data-count', '3')
  await expect(page.getByTestId('img2pdf-rotnote')).toContainText(
    '旋转 90° 现在不能用。这一页先不改图片方向，避免你以为转过了、打出来却没变。',
  )
  await assertRetentionNotCoveredByTruth(page)

  await page.getByRole('button', { name: /合成 3 张为一份 PDF/ }).click()
  await expect(page.getByTestId('img2pdf-band').getByText('PDF 已生成')).toBeVisible()
  await expect(page.getByTestId('img2pdf-list')).toHaveAttribute('data-mode', 'output')
  await expect(page.getByText('页序与来源', { exact: true })).toBeVisible()
  await expect(page.getByText('3 页 · 与提交顺序一致', { exact: true })).toBeVisible()
  await expect(page.getByText('来自 w2-cover-1.png · 按 A4 居中放大，不裁切', { exact: true })).toBeVisible()
  await assertRetentionNotCoveredByTruth(page)
  await expect(page.getByTestId('img2pdf-fixture')).toHaveCount(0)
  await expectHealthy(page, errors, 'print-scan-convert')
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

test('signature page fails closed for anonymous users @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerSignCapabilities(api)

  await page.goto('/print-scan/sign')
  await expect(page.locator('[data-testid="sign-stamp-state-login-required"]')).toBeVisible()
  await expect(page.getByTestId('sign-stamp-fallback')).toContainText('先登录才能签名')
  await expect(page.getByTestId('sign-stamp-truth')).toContainText('只接受本人手写签名，不接受单位公章或圆形章；这不是可靠电子签名。')
  await expect(page.getByTestId('sign-stamp-notice-full')).toHaveCount(0)
  await page.getByTestId('sign-stamp-notice-toggle').click()
  await expect(page.getByTestId('sign-stamp-notice-full')).toContainText(
    '签名仅用于个人材料整理与打印辅助，不提供 CA 电子签、电子认证或合同签署服务；仅为图片合成预览，不具备法律认证效力，正式法律文件请通过具备资质的电子签名服务办理。',
  )
  await expect(page.getByTestId('sign-stamp-ask')).toContainText('问小青：签名放在哪一页')
  await expect(page.getByText('工作人员')).toHaveCount(0)
  await expectHealthy(page, errors, 'print-scan-sign')
  await page.getByTestId('sign-stamp-primary').click()
  await expect(page).toHaveURL(/\/login/)
})

// D3（2026-09-28）：签名默认关，管理员逐台配成 available 才开（服务端 DEFAULT_DENY_CAPABILITY_KEYS，
// 未配置即以 CAPABILITY_NOT_CONFIGURED 拒绝）。能力读取成功、但本机没有已配置的 signature_stamp 行时，
// 已登录用户直接进签名页也必须停在「没有开放」，不给任何上传入口 —— 否则传完文件才被拒，
// 页面还会把那次拒绝说成「PDF 读不开」。
function capabilityRow(capabilityKey: string, status: string, configured: boolean) {
  return { capabilityKey, status, note: null, configured, updatedAt: null }
}

const SIGNATURE_NEVER_ENABLED = [
  { name: 'row absent', capabilities: [capabilityRow('document_print', 'available', true)] },
  // 真实后端的形状：每个键都下发，没配置过的是 configured=false（listForTerminal）。
  {
    name: 'row configured=false',
    capabilities: [
      capabilityRow('document_print', 'available', true),
      capabilityRow('signature_stamp', 'not_verified', false),
    ],
  },
]

async function expectSignatureNotOpen(page: Page, api: ApiRouter): Promise<void> {
  await expect(page.locator('[data-testid="sign-stamp-state-capability-disabled"]')).toBeVisible()
  await expect(page.getByTestId('sign-stamp-fallback')).toContainText('这台机器没有开放签名')
  // 没有任何上传入口：选 PDF / 传签名图的卡片都不出现，页面上也没有带「上传」的按钮。
  await expect(page.locator('[data-testid^="sign-stamp-pick-"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /上传/ })).toHaveCount(0)
  expect(api.requestCount('POST', '/api/v1/files/kiosk-upload')).toBe(0)
  expect(api.requestCount('POST', '/api/v1/print/sign/inspect')).toBe(0)
}

for (const variant of SIGNATURE_NEVER_ENABLED) {
  test(`signature page stays closed on a terminal that never enabled it (${variant.name}) @w2`, async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    registerShell(api)
    registerMemberLogin(api)
    api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
      status: 200,
      json: { capabilities: variant.capabilities },
    })

    await loginThroughVisibleUi(page, '/print-scan/sign')
    await expectSignatureNotOpen(page, api)
    await expectHealthy(page, errors, 'print-scan-sign')
  })
}

test('signature page retry after a failed capability read still refuses a terminal that never enabled it @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerMemberLogin(api)
  let capabilityReadOk = false
  api.respondWith('GET', '/api/v1/terminals/KSK-001/capabilities', () =>
    capabilityReadOk
      ? { status: 200, json: { capabilities: [capabilityRow('document_print', 'available', true)] } }
      : { status: 500, json: { error: { code: 'INTERNAL', message: 'boom' } } },
  )

  await loginThroughVisibleUi(page, '/print-scan/sign')
  await expect(page.locator('[data-testid="sign-stamp-state-capability-error"]')).toBeVisible()
  capabilityReadOk = true
  await page.getByRole('button', { name: '重试读取', exact: true }).click()
  await expectSignatureNotOpen(page, api)
  await expectHealthy(page, errors, 'print-scan-sign')
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
  await expect(page.getByText('选要放入签名的 PDF')).toBeVisible()
  await expect(page.getByTestId('sign-stamp-truth')).toContainText('只接受本人手写签名，不接受单位公章或圆形章；这不是可靠电子签名。')
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
  const authorize = page.getByRole('checkbox', { name: /我确认本人拥有该本人手写签名的使用授权/ })
  await expect(authorize).not.toBeChecked()
  await expect(page.getByRole('button', { name: '生成合成 PDF（请先确认授权）' })).toBeDisabled()
  await authorize.click()
  await page.getByRole('button', { name: '生成合成 PDF', exact: true }).click()
  await expect(page.getByTestId('sign-stamp-fallback')).toContainText('新的签好的 PDF 已生成')
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
  await page.getByRole('checkbox', { name: /我确认本人拥有该本人手写签名的使用授权/ }).click()
  await page.getByRole('button', { name: '生成合成 PDF', exact: true }).click()
  await expect(page.getByTestId('sign-stamp-fallback')).toContainText('提交太频繁了')
  await expect(page.locator('[data-testid="sign-stamp-state-rate-limited"]')).toBeVisible()
  await expect(page.getByText('新的 PDF 已生成')).toHaveCount(0)
  expect(api.requestCount('POST', '/api/v1/print/sign/compose')).toBe(1)
  await expectHealthy(page, errors, 'print-scan-sign')
})

test('signature phone stamp card stays disabled and does not open an upload session @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)

  await page.goto('/print-scan/sign?capture=1&state=pick-stamp')
  const phone = page.getByTestId('sign-stamp-pick-stamp-phone')
  await expect(phone).toBeVisible()
  await expect(phone).toHaveAttribute('aria-disabled', 'true')
  await expect(phone).toContainText('签名图片暂不支持手机上传，请在本机上传。')
  await expect(page.getByRole('button', { name: /手机扫码上传图片/ })).toHaveCount(0)
  expect(api.requestCount('POST', '/api/v1/upload-sessions')).toBe(0)
  // aria-disabled 会让 Playwright 的普通 click 一直等「可点」。强制点下去，确认这条死路没有点击处理。
  await phone.click({ force: true })
  expect(api.requestCount('POST', '/api/v1/upload-sessions')).toBe(0)
  await expect(page.getByText('手机扫码上传 PDF 文档')).toHaveCount(0)
  await expect(page.getByTestId('sign-stamp-ask')).toContainText('问小青：签名放在哪一页')
  await expect(page.getByText('工作人员')).toHaveCount(0)
  await expect(page.getByTestId('sign-stamp-notice-full')).toHaveCount(0)
  await page.getByTestId('sign-stamp-notice-toggle').click()
  await expect(page.getByTestId('sign-stamp-notice-full')).toContainText(
    '签名仅用于个人材料整理与打印辅助，不提供 CA 电子签、电子认证或合同签署服务；仅为图片合成预览，不具备法律认证效力，正式法律文件请通过具备资质的电子签名服务办理。',
  )
  await expectHealthy(page, errors, 'print-scan-sign')
})

async function assertTruthDoesNotCover(page: Page) {
  const read = () =>
    page.evaluate(() => {
      const truth = document.querySelector('[data-testid="sign-stamp-truth"]')
      const root = document.querySelector('.ss-page')
      if (!truth || !root) return { covered: ['missing'], lastBottom: 0, truthTop: 0, fits: false }
      const clip = (el: Element) => {
        let top = el.getBoundingClientRect().top
        let bottom = el.getBoundingClientRect().bottom
        let left = el.getBoundingClientRect().left
        let right = el.getBoundingClientRect().right
        let parent = el.parentElement
        while (parent) {
          const style = getComputedStyle(parent)
          if (/(auto|scroll|hidden)/.test(style.overflowY) || /(auto|scroll|hidden)/.test(style.overflowX)) {
            const box = parent.getBoundingClientRect()
            top = Math.max(top, box.top)
            bottom = Math.min(bottom, box.bottom)
            left = Math.max(left, box.left)
            right = Math.min(right, box.right)
          }
          parent = parent.parentElement
        }
        return { top, bottom, left, right, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
      }
      const t = truth.getBoundingClientRect()
      const nodes = [
        ...root.querySelectorAll(
          '.ss-state, .ss-pick, .ss-note, .ss-grp, .ss-step, .ss-consent, .ss-acol, .ss-pickcard, .ss-xq, .ss-sec-label, .ss-pvcol, .ss-gatecol',
        ),
      ]
      const covered: string[] = []
      let lastBottom = -Infinity
      for (const el of nodes) {
        if (truth.contains(el)) continue
        const r = clip(el)
        if (r.width < 2 || r.height < 2) continue
        if (r.bottom > lastBottom) lastBottom = r.bottom
        const overlaps = r.top < t.bottom - 1 && r.bottom > t.top + 1 && r.left < t.right && r.right > t.left
        if (overlaps) covered.push(el.getAttribute('data-testid') || String(el.className).slice(0, 80))
      }
      const pageBox = root.getBoundingClientRect()
      return {
        covered,
        lastBottom,
        truthTop: t.top,
        fits: root.scrollHeight <= root.clientHeight + 1 && t.bottom <= pageBox.bottom + 1,
      }
    })
  let info = await read()
  if (info.covered.length > 0 || info.lastBottom > info.truthTop + 1) {
    await page.locator('.ss-page').evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    info = await read()
  }
  expect(info.covered).toEqual([])
  expect(info.lastBottom).toBeLessThanOrEqual(info.truthTop + 1)
  return info.fits
}

test('signature four capture states keep the truth bar from covering content @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  await page.setViewportSize({ width: 1080, height: 1920 })

  await page.goto('/print-scan/sign?capture=1&state=pick-stamp')
  const fixture = page.getByTestId('sign-stamp-fixture-bar')
  await expect(page.getByTestId('sign-stamp-truth')).toContainText('示例')
  await expect(fixture).toBeVisible()
  await expect(page.locator('.ss-ctxbar [data-testid="sign-stamp-fixture-bar"]')).toHaveCount(0)
  const sameRow = await page.evaluate(() => {
    const fx = document.querySelector('[data-testid="sign-stamp-fixture-bar"]')
    const disc = document.querySelector('[data-testid="sign-stamp-truth"] [data-disclaimer]')
    if (!fx || !disc) return false
    const a = fx.getBoundingClientRect()
    const b = disc.getBoundingClientRect()
    return a.left < b.left && Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 36
  })
  expect(sameRow).toBe(true)
  await expect(page.locator('.ss-xq-ask em')).toHaveText('这次要用的')
  await expect(page.getByTestId('sign-stamp-primary')).toHaveText('传好签名图再继续')
  const note = page.getByTestId('sign-stamp-stamp-note')
  await expect(note).toContainText('只收本人这一次新拍的手写签名。')
  await expect(note).toContainText('大约保留 1 小时，用完即清。')
  await expect(note).toContainText('不进「我的文档」，也不能下次再用。')
  const noteWide = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="sign-stamp-stamp-note"]')
    const row = document.querySelector('.ss-pickrow')
    if (!card || !row) return { wide: false, inline: false }
    const cardBox = card.getBoundingClientRect()
    const rowBox = row.getBoundingClientRect()
    const lis = [...card.querySelectorAll('li')].map((el) => el.getBoundingClientRect())
    const inline =
      lis.length === 3 &&
      Math.abs(lis[0].y - lis[1].y) < 8 &&
      Math.abs(lis[1].y - lis[2].y) < 8 &&
      lis[0].x < lis[1].x &&
      lis[1].x < lis[2].x
    return { wide: cardBox.width > rowBox.width * 0.85, inline }
  })
  expect(noteWide.wide).toBe(true)
  expect(noteWide.inline).toBe(true)
  expect(await assertTruthDoesNotCover(page)).toBe(true)

  await page.goto('/print-scan/sign?capture=1&state=placement-default')
  await expect(page.getByTestId('sign-stamp-fallback')).toHaveAttribute('data-kind', 'warn')
  await expect(page.getByTestId('sign-stamp-fallback')).toContainText('需勾选授权')
  await expect(page.getByTestId('sign-stamp-fallback')).toContainText('换图后需重新确认')
  await expect(page.getByTestId('sign-stamp-fallback')).toContainText('原 PDF 不被改写')
  await expect(page.getByText('签好的 PDF：每次都是新文件。')).toBeVisible()
  await expect(page.getByText('不判断该签在哪。')).toBeVisible()
  await expect(page.getByText('不做防篡改，不发证书。')).toBeVisible()
  await expect(page.locator('.ss-aside').getByText('不画进度条，也不自动重试。')).toHaveCount(0)
  expect(await assertTruthDoesNotCover(page)).toBe(true)

  await page.goto('/print-scan/sign?capture=1&state=completed')
  await expect(page.getByTestId('sign-stamp-add-another')).toHaveText('再加一处签名')
  await expect(page.getByTestId('sign-stamp-fallback').locator('b')).toContainText(['一份新文件', '原 PDF 一点没改', '材料检查'])
  expect(await assertTruthDoesNotCover(page)).toBe(true)

  await page.goto('/print-scan/sign?capture=1&state=login-required')
  await expect(page.getByTestId('sign-stamp-fallback')).toContainText('签名图片属于高敏个人材料')
  await expect(page.getByTestId('sign-stamp-fallback')).toContainText('签名图不跨这次办理保留')
  await expect(page.getByText('登录后才能确认这份文档和这张签名图都属于你本人。')).toBeVisible()
  const grid = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.ss-gaterow .ss-pickcard')].map((el) => {
      const box = el.getBoundingClientRect()
      const icon = el.querySelector('.pi')?.getBoundingClientRect()
      const title = el.querySelector('b')?.getBoundingClientRect()
      return { x: box.x, y: box.y, iconBottom: icon?.bottom ?? 0, titleTop: title?.top ?? 0 }
    })
    if (cards.length !== 4) return false
    const sameRow = (a: number, b: number) => Math.abs(cards[a].y - cards[b].y) < 8
    const iconAbove = cards.every((card) => card.iconBottom <= card.titleTop + 1)
    return sameRow(0, 1) && sameRow(2, 3) && cards[2].y > cards[0].y + 40 && cards[0].x < cards[1].x && cards[2].x < cards[3].x && iconAbove
  })
  expect(grid).toBe(true)
  expect(await assertTruthDoesNotCover(page)).toBe(true)
  await expectHealthy(page, errors, 'print-scan-sign')
})

test('signature preview toolbar sits under the page view @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)

  await page.goto('/print-scan/sign?capture=1&state=placement-default')
  const view = page.getByTestId('sign-stamp-pv-view')
  const bar = page.getByTestId('sign-stamp-pv-toolbar')
  await expect(view).toBeVisible()
  await expect(bar).toBeVisible()
  const viewBox = await view.boundingBox()
  const barBox = await bar.boundingBox()
  expect(viewBox).toBeTruthy()
  expect(barBox).toBeTruthy()
  expect(barBox!.y).toBeGreaterThanOrEqual(viewBox!.y + viewBox!.height - 2)
  await expect(page.getByTestId('sign-stamp-ask')).toBeVisible()
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
