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
  await expect(page.getByRole('button', { name: /扫描纸质材料/ })).toBeDisabled()
  await expect(page.getByText('扫描仪正在保养', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /照片合成 PDF/ })).toBeEnabled()
  // 签名盖章 2026-11-08 停放：后台把 signature_stamp 配成 available 也不出卡（SIGN_ENTRY_PARKED）。
  await expect(page.getByTestId('print-hub-cap-sign')).toHaveCount(0)
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
  // 2.0 卡面用徽标「不是取件码」区分（稿 10），不再重复长句。
  await expect(entry).toContainText('不是取件码')
  // 它不占能力卡的格子。证件照（11/04）、签名（11/08）停放后，能力卡只剩打印文件、扫描、照片打印、照片合成 PDF 四张。
  await expect(page.locator('[data-testid^="print-hub-cap-"]')).toHaveCount(4)
  await expect(page.getByTestId('print-hub-cap-id-photo')).toHaveCount(0)
  await entry.click()

  await expect(page).toHaveURL(/\/print\/pickup-claim$/)
  await expect(page.getByLabel('到机码输入框')).toBeVisible()
  expect(errors).toEqual([])
})

test('unknown tool feature key fails closed with a real recovery action @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)

  await page.goto('/print-scan/feature/not-a-real-feature')
  await expect(page.getByRole('heading', { name: '这个能力名我不认识' })).toBeVisible()
  await expect(page.getByRole('button', { name: '看证件照说明' })).toHaveCount(0)
  await expect(page.getByText('证件照这一页写的是尚未开放，和两条替代路径')).toHaveCount(0)
  await expect(page.getByTestId('print-hub-primary')).toHaveText('返回打印扫描')
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
  await page.getByRole('button', { name: '合成', exact: true }).click()
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
  // 上移 / 下移 / 移除 / 查看 / 旋转收在「更多设置」里（稿 18），先点开再排序。
  await page.getByRole('button', { name: '更多设置', exact: true }).click()
  await page.getByRole('button', { name: '下移' }).click()
  await expect(page.locator('[data-testid="img2pdf-order"]')).toHaveAttribute(
    'data-sent-payload',
    'w2-image-2.png | w2-image-1.png',
  )
  await page.getByRole('button', { name: '合成', exact: true }).click()
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
  await page.getByRole('button', { name: '合成', exact: true }).click()
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

// 只用于这一单（11/02 拍板）：登录了也可能不进「我的文档」——用了一体机这一单里从手机传来的图时，
// 后端回 savedToDocuments=false。完成态只认这个字段：不说「已进我的文档」，也不给「查看我的文档」。
async function convertOneImageWith(page: Page, api: ApiRouter, data: Record<string, unknown>): Promise<void> {
  await fulfillFixtureImage(page)
  registerShell(api)
  registerConvertUpload(api)
  api.respond('POST', '/api/v1/print/convert/images-to-pdf', { status: 200, json: { success: true, data } })
  await page.goto('/print-scan/convert')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'w2-image.png',
    mimeType: 'image/png',
    buffer: Buffer.from('synthetic-w2-image'),
  })
  await expect(page.getByText('w2-image.png', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '合成', exact: true }).click()
  await expect(page.getByTestId('img2pdf-band').getByText('PDF 已生成')).toBeVisible()
}

test('member PDF made from phone images is order-only, not claimed as saved @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  await convertOneImageWith(page, api, {
    fileId: 'w2-pdf-order-only',
    printFileUrl: '/w2-fixtures/image.png',
    fileMd5: 'a'.repeat(32),
    sizeBytes: 2048,
    pages: 1,
    hasEndUser: true,
    savedToDocuments: false,
  })
  await expect(page.getByText('只用于这一单 · 不进我的文档', { exact: true })).toBeVisible()
  await expect(page.getByText(/用了手机传来的图片，这份 PDF 只用于这一单/)).toBeVisible()
  await expect(page.getByText('已进我的文档', { exact: false })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '查看我的文档' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '拿这份 PDF 去打印' })).toBeVisible()
  expect(errors).toEqual([])
})

test('member PDF that did go into my documents says so and links there @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  await convertOneImageWith(page, api, {
    fileId: 'w2-pdf-saved',
    printFileUrl: '/w2-fixtures/image.png',
    fileMd5: 'b'.repeat(32),
    sizeBytes: 2048,
    pages: 1,
    hasEndUser: true,
    savedToDocuments: true,
  })
  await expect(page.getByText('已进我的文档 · 约 24 小时', { exact: true })).toBeVisible()
  await expect(page.getByText('只用于这一单', { exact: false })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '查看我的文档' })).toBeVisible()
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
  await page.getByRole('button', { name: '合成', exact: true }).click()
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


/*
 * 版式体检（审查意见 A1 / A2）。一体机竖屏 1080×1920 上，工具页的内容块必须：
 *   · 左右各留 ≥32px（贴到屏边就是没排好）；
 *   · 上下相邻、互不压盖（后一块的上沿 ≥ 前一块的下沿 − 1）；
 *   · 带字的块没有被截（scrollHeight ≤ clientHeight + 1；自己能滚的列表不算）；
 *   · 屏上所有可点的件 ≥64×64（隐藏的文件输入、读屏专用的除外）。
 * 此前加 3 张图后「待合并图片」卡只露出前 2 行、上移 / 下移那条和下面两句说明叠成一团，
 * 签名页内容从 x=0 铺到 x=1080：这些靠空白扫描量不到，要用量出来的几何钉住。
 */
async function auditToolLayout(page: Page, rootSelector: string, gutter = 32): Promise<string[]> {
  return page.evaluate(
    ({ rootSelector: rootSel, gutter: g }) => {
      const issues: string[] = []
      const root = document.querySelector(rootSel) as HTMLElement | null
      if (!root) return [`找不到版式根 ${rootSel}`]
      const vw = window.innerWidth
      const vis = (el: Element) => {
        const rect = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return rect.width > 0 && rect.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
      }
      const label = (el: Element) => {
        const h = el as HTMLElement
        const id = h.dataset?.testid
        return `${el.tagName.toLowerCase()}${id ? `[${id}]` : `.${String(h.className).split(' ')[0] ?? ''}`}`
      }
      const blocks = Array.from(root.children).filter((c) => {
        const pos = getComputedStyle(c).position
        return vis(c) && pos !== 'absolute' && pos !== 'fixed'
      }) as HTMLElement[]
      const placed = blocks
        .map((block) => ({ block, rect: block.getBoundingClientRect() }))
        .sort((a, b) => a.rect.top - b.rect.top)
      for (const { block, rect } of placed) {
        if (rect.left < g - 0.5 || vw - rect.right < g - 0.5) {
          issues.push(`${label(block)} 左右留白不足（左 ${Math.round(rect.left)}、右 ${Math.round(vw - rect.right)}，要 ≥${g}）`)
        }
      }
      for (let i = 1; i < placed.length; i += 1) {
        const prev = placed[i - 1]!
        const next = placed[i]!
        if (next.rect.top < prev.rect.bottom - 1) {
          issues.push(`${label(next.block)} 压在 ${label(prev.block)} 上（${Math.round(next.rect.top)} < ${Math.round(prev.rect.bottom)}）`)
        }
      }
      const scrolls = (el: Element) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)
      for (const block of blocks) {
        for (const el of [block, ...Array.from(block.querySelectorAll<HTMLElement>('*'))]) {
          if (!vis(el) || scrolls(el) || el instanceof SVGElement || el.closest('[aria-hidden="true"]')) continue
          if (el.clientHeight === 0 || !(el.textContent ?? '').trim()) continue
          if (el.scrollHeight > el.clientHeight + 1) {
            issues.push(`${label(el)} 里的字被截（内容 ${el.scrollHeight}px > 盒子 ${el.clientHeight}px）`)
          }
        }
      }
      const screen = document.querySelector('[data-qxt-screen]')
      for (const el of Array.from(screen?.querySelectorAll<HTMLElement>('button, a[href], [role="button"], [role="radio"], [role="checkbox"], input:not([type="hidden"])') ?? [])) {
        if (!vis(el) || el.closest('[inert]') || el.closest('[aria-hidden="true"]')) continue
        if (el.matches('.sr-only, .ss-hidden-file, input[type="file"]')) continue
        const rect = el.getBoundingClientRect()
        if (rect.width < 64 - 0.5 || rect.height < 64 - 0.5) {
          issues.push(`${label(el)}「${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 14)}」可点区只有 ${Math.round(rect.width)}×${Math.round(rect.height)}，要 ≥64×64`)
        }
      }
      return issues
    },
    { rootSelector, gutter },
  )
}

function registerNumberedImageUploads(api: ApiRouter): void {
  api.respondWith('POST', '/api/v1/files/kiosk-upload', (n) => ({
    status: 200,
    json: {
      success: true,
      data: {
        fileId: `w2-image-${String(n).padStart(3, '0')}`,
        filename: `成绩单-扫描-${n}.png`,
        sizeBytes: 1024,
        mimeType: 'image/png',
        sha256: 'c'.repeat(64),
        signedUrl: '/w2-fixtures/image.png',
        signedUrlExpiresAt: '2026-07-24T00:10:00.000Z',
        fileExpiresAt: '2026-07-25T00:00:00.000Z',
      },
    },
  }))
}

async function addNumberedImages(page: Page, count: number): Promise<void> {
  for (let i = 1; i <= count; i += 1) {
    await page.locator('input[type="file"]').setInputFiles({
      name: `成绩单-扫描-${i}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(`synthetic-w2-image-${i}`),
    })
    await expect(page.getByText(`成绩单-扫描-${i}.png`, { exact: true })).toBeVisible()
  }
}

const CONVERT_LAYOUT_ROOT = '[data-qx-page="img2pdf"] .i2p-scroll'

for (const count of [1, 3, 20]) {
  test(`conversion list with ${count} image(s) keeps blocks apart, uncut and tappable @w2`, async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    await fulfillFixtureImage(page)
    registerShell(api)
    registerNumberedImageUploads(api)

    await page.goto('/print-scan/convert')
    await addNumberedImages(page, count)
    expect(await auditToolLayout(page, CONVERT_LAYOUT_ROOT), `${count} 张图的列表版式`).toEqual([])
    // 选中一张、点开「更多设置」之后也一样：设置条不许压在下面的说明上。
    await page.getByRole('button', { name: `选中第 ${count} 张：成绩单-扫描-${count}.png` }).click()
    await page.getByRole('button', { name: '更多设置', exact: true }).click()
    expect(await auditToolLayout(page, CONVERT_LAYOUT_ROOT), `${count} 张图、选中并展开更多设置的版式`).toEqual([])
    await expectHealthy(page, errors, 'print-scan-convert')
  })
}

test('conversion finished and failed states keep blocks apart, uncut and tappable @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  await fulfillFixtureImage(page)
  registerShell(api)
  registerNumberedImageUploads(api)
  api.respond('POST', '/api/v1/print/convert/images-to-pdf', {
    status: 422,
    json: { success: false, error: { code: 'CONVERT_FAILED', message: '合成图片尺寸不受支持' } },
  })

  await page.goto('/print-scan/convert')
  await addNumberedImages(page, 3)
  await page.getByRole('button', { name: '合成', exact: true }).click()
  await expect(page.getByText('合成图片尺寸不受支持', { exact: true })).toBeVisible()
  expect(await auditToolLayout(page, CONVERT_LAYOUT_ROOT), '明确失败态的版式').toEqual([])

  api.respond('POST', '/api/v1/print/convert/images-to-pdf', {
    status: 200,
    json: {
      success: true,
      data: { fileId: 'w2-pdf-layout', printFileUrl: '/w2-fixtures/image.png', fileMd5: 'd'.repeat(32), sizeBytes: 4096, pages: 3, hasEndUser: false },
    },
  })
  await page.getByRole('button', { name: '改完之后重试合成' }).click()
  await expect(page.getByTestId('img2pdf-band').getByText('PDF 已生成')).toBeVisible()
  expect(await auditToolLayout(page, CONVERT_LAYOUT_ROOT), '完成态的版式').toEqual([])
  await expectHealthy(page, errors, 'print-scan-convert')
})

const W2_MEMBER_TOKEN = 'w2-sign-memory-token'
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

for (const alias of [
  { from: '/print/scan-convert', to: '/print-scan/convert', marker: 'print-scan-convert' },
  { from: '/print/scan-feature', to: '/print-scan', marker: 'print-scan-home' },
] as const) {
  test(`${alias.from} redirects to ${alias.to} @w2`, async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    registerShell(api)

    await page.goto(alias.from)
    await page.waitForURL(`**${alias.to}`)
    await expectHealthy(page, errors, alias.marker)
  })
}
