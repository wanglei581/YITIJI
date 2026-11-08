import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'
import { assertNoHorizontalOverflow, assertTapTargetPointerHit } from './assert-layout'

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
  await expect(page.locator('[data-testid^="print-hub-cap-"]')).toHaveCount(4)
  await expect(page.getByTestId('print-hub-cap-id-photo')).toHaveCount(0)
  // 签名盖章 2026-11-08 停放：AVAILABLE 里 signature_stamp 是 available，卡也不出（SIGN_ENTRY_PARKED）。
  await expect(page.getByTestId('print-hub-cap-sign')).toHaveCount(0)
  await expect(page.getByTestId('print-hub-cap-usb-import')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /打印文件/ })).toBeEnabled()
  await expect(page.getByRole('button', { name: /到机码核销/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /到机码核销/ })).toContainText('不是取件码')
  await expect(page.getByText('在打印机屏幕上点「复印」「身份证复印」或「票据复印」；不经过这台一体机下单，也不进打印订单')).toBeVisible()
  await expect(page.getByRole('button', { name: '问小青：怎么选打印方式 →' })).toBeVisible()
  await page.locator('.qxt-body').evaluate((element) => { element.scrollTop = 0 })
  const firstCard = await page.getByTestId('print-hub-cap-doc-print').boundingBox()
  expect(firstCard!.y, '2.0 可点能力卡位于顶部只读区之后').toBeGreaterThanOrEqual(500)
  await expectNoForgedReady(page)
  await assertNoHorizontalOverflow(page)
  // 稿 10：无独立页头（h1 只给读屏），1080 首屏横幅紧贴顶栏，快捷入口与底注整屏可见、不被底栏遮住。
  await expect(page.getByRole('heading', { level: 1, name: '你的文件，现在在哪？' })).toHaveCount(1)
  if (page.viewportSize()?.width === 1080) {
    const geo = await page.evaluate(() => {
      const box = (el: Element | null) => el!.getBoundingClientRect()
      const notes = [...document.querySelectorAll('.ph-note')].map((el) => el.getBoundingClientRect().bottom)
      return {
        bandH: box(document.querySelector('.qxt-band')).height,
        gridTop: box(document.querySelector('.ph-grid')).top,
        noticesBottom: box(document.querySelector('.ph-notices')).bottom,
        notesBottom: Math.max(...notes),
        truthBottom: box(document.querySelector('.ph-truth')).bottom,
        navTop: box(document.querySelector('.qxt-nav')).top,
      }
    })
    console.log(`print-hub-geometry ${JSON.stringify(geo)}`)
    await page.screenshot({ path: 'test-results/print-hub-qx-1080x1920.png' })
    expect(geo.bandH).toBeGreaterThanOrEqual(400)
    expect(geo.gridTop).toBeGreaterThanOrEqual(400)
    expect(geo.notesBottom).toBeLessThanOrEqual(geo.navTop)
    expect(geo.truthBottom).toBeLessThanOrEqual(geo.navTop)
    expect(geo.noticesBottom).toBeLessThanOrEqual(geo.navTop)
  }
  await page.screenshot({ path: test.info().outputPath('print-hub-default.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('print hub openable cards: name is the title, the description sentence is the accessible description @w2', async ({ page, api }) => {
  // 照统一版 QxTouchTask：可点卡 aria-labelledby 指标题、aria-describedby 指说明句。
  // 只给 aria-label 标题时，读屏用户听不到「手机、U 盘或我的文档」这类说明。
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: AVAILABLE },
  })

  await page.goto('/print-scan')
  await expect(page.locator('[data-testid="print-hub-state-default"]')).toBeVisible()
  // 大卡（task）：打印文件、扫描纸质材料。
  const docCard = page.getByRole('button', { name: '打印文件', exact: true })
  await expect(docCard).toHaveCount(1)
  await expect(docCard).toHaveAccessibleDescription('手机、U 盘或我的文档')
  const scanCard = page.getByRole('button', { name: '扫描纸质材料', exact: true })
  await expect(scanCard).toHaveCount(1)
  await expect(scanCard).toHaveAccessibleDescription('扫成 PDF，可以存、可以打')
  // 磁贴（tile）：同一做法。
  const convertCard = page.getByRole('button', { name: '照片合成 PDF', exact: true })
  await expect(convertCard).toHaveCount(1)
  await expect(convertCard).toHaveAccessibleDescription('几张照片拼成一个文件')
  expect(errors).toEqual([])
})

test('print hub 390 keeps hero readable and bottom notes above the nav bar @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: AVAILABLE },
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/print-scan')
  await expect(page.locator('[data-testid="print-hub-state-default"]')).toBeVisible()
  await assertNoHorizontalOverflow(page)
  // 手机宽度下横幅标题曾被「青」头像挤成逐字竖排：要求占到过半宽度、每行不少于四个字。
  const hero = await page.locator('.qxt-ask h1').evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const lines = new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size
    return { width: el.getBoundingClientRect().width, lines, chars: (el.textContent ?? '').length }
  })
  expect(hero.width, '横幅标题不得被挤成窄条').toBeGreaterThan(390 * 0.5)
  expect(hero.chars / hero.lines, '横幅标题不得逐字竖排').toBeGreaterThanOrEqual(4)

  // 滚到底：底注与快捷入口必须落在底栏之上，不被遮住。
  await expect(page.getByTestId('print-hub-copy-note')).toBeVisible()
  const geo = await page.locator('.qxt-body').evaluate((scroller) => {
    scroller.scrollTop = scroller.scrollHeight
    const notes = [...document.querySelectorAll('.ph-note, .ph-foot')].map((el) => el.getBoundingClientRect().bottom)
    return {
      atEnd: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1,
      scrolls: scroller.scrollHeight > scroller.clientHeight,
      notesBottom: Math.max(...notes),
      truthBottom: document.querySelector('.ph-truth')!.getBoundingClientRect().bottom,
      navTop: document.querySelector('.qxt-nav')!.getBoundingClientRect().top,
    }
  })
  expect(geo.scrolls && geo.atEnd, '390 下内容应在 .qxt-body 内滚动且已滚到底').toBe(true)
  expect(geo.truthBottom).toBeLessThanOrEqual(geo.navTop)
  expect(geo.notesBottom).toBeLessThanOrEqual(geo.navTop)
  await expect(page.getByTestId('print-hub-truth')).toBeInViewport()
  await assertNoHorizontalOverflow(page)
  await expectNoForgedReady(page)
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
  await expect(page.getByRole('heading', { level: 1, name: '正在确认这台机器能做什么。' })).toBeVisible()
  // 稿 st-loading 的问句原样：「问小青：怎么选打印方式？」（默认态才带箭头）。
  await expect(page.getByRole('button', { name: '问小青：怎么选打印方式？', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /打印文件/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: /到机码核销/ })).toBeEnabled()
  await expect(page.getByTestId('print-hub-cap-id-photo')).toHaveCount(0)
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
  await expect(page.locator('.ph-actions').getByRole('button', { name: '重新检测', exact: true })).toBeVisible()
  await expect(page.locator('.ph-actions').getByRole('button', { name: '使用帮助', exact: true })).toBeVisible()
  await expect(page.getByText('需要帮助？')).toBeVisible()
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
  await expect(page.getByRole('button', { name: /扫描纸质材料/ })).toBeDisabled()
  await expect(page.getByText('扫描仪正在保养', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /照片合成 PDF/ })).toBeEnabled()
  const bottom = await page.locator('.qxt-body').evaluate((scroller) => {
    scroller.scrollTop = scroller.scrollHeight
    return {
      atEnd: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1,
      actionsBottom: [...document.querySelectorAll('.ph-grid, .qxt-tools')].reduce((max, node) => Math.max(max, node.getBoundingClientRect().bottom), 0),
      footerBottom: document.querySelector('.ph-foot')!.getBoundingClientRect().bottom,
      navTop: document.querySelector('.qxt-nav')!.getBoundingClientRect().top,
    }
  })
  expect(bottom.atEnd).toBe(true)
  expect(bottom.actionsBottom).toBeLessThanOrEqual(bottom.navTop)
  expect(bottom.footerBottom).toBeLessThanOrEqual(bottom.navTop)
  await expectNoForgedReady(page)
  expect(errors).toEqual([])
})

// D3（2026-09-28）两条「签名卡在没开通的终端上整卡停用」随签名盖章 2026-11-08 停放删除；
// 重新打开签名时从 42e945e76 的本文件取回（见 printHubContent.ts 的 SIGN_ENTRY_PARKED）。

test('print hub device-off pauses paper paths and keeps software paths @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api, { isOnline: false, printerStatus: 'offline' })
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: AVAILABLE },
  })

  await page.goto('/print-scan')
  await expect(page.locator('[data-testid="print-hub-state-device-off"]')).toBeVisible()
  // 2026-10-28 稿 print：状态由顶栏胶囊和卡片角标各说一次（取自真实打印机状态），提醒条只留标准句。
  await expect(page.locator('.qxt-status')).toContainText('打印机离线 · 出纸类暂停')
  await expect(page.getByTestId('print-hub-cap-doc-print')).toContainText('打印机离线')
  await expect(page.getByTestId('print-hub-fallback')).toContainText('这台机器暂时打不了')
  await expect(page.getByTestId('print-hub-fallback')).not.toContainText('找现场工作人员')
  await expect(page.getByTestId('print-hub-cap-doc-print')).toBeDisabled()
  await expect(page.getByTestId('print-hub-cap-scan')).toBeDisabled()
  await expect(page.getByTestId('print-hub-cap-convert')).toBeEnabled()
  await expect(page.getByRole('button', { name: /到机码核销/ })).toBeEnabled()
  await expect(page.getByTestId('print-hub-cap-doc-print')).toContainText('这次出不了纸')
  const bottom = await page.locator('.qxt-body').evaluate((scroller) => {
    scroller.scrollTop = scroller.scrollHeight
    return {
      atEnd: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1,
      actionsBottom: [...document.querySelectorAll('.ph-grid, .qxt-tools')].reduce((max, node) => Math.max(max, node.getBoundingClientRect().bottom), 0),
      footerBottom: document.querySelector('.ph-foot')!.getBoundingClientRect().bottom,
      navTop: document.querySelector('.qxt-nav')!.getBoundingClientRect().top,
    }
  })
  expect(bottom.atEnd).toBe(true)
  expect(bottom.actionsBottom).toBeLessThanOrEqual(bottom.navTop)
  expect(bottom.footerBottom).toBeLessThanOrEqual(bottom.navTop)
  await expect(page.getByTestId('print-hub-cap-phone-upload')).toBeEnabled()
  await expect(page.getByTestId('print-hub-cap-usb-import')).toBeEnabled()
  await expect(page.getByTestId('print-hub-cap-id-photo')).toHaveCount(0)
  await expectNoForgedReady(page)
  expect(errors).toEqual([])
})

test('print hub paper-empty layout (draft st-device-off): paper paths paused, 先传、稍后打印 stays open @w2', async ({ page, api }) => {
  // 稿 st-device-off：打印机确定缺纸时，出纸类（打印文件、扫描）先停，复印说明、到机码、手机和 U 盘上传仍可进，
  // 手机扫码、U 盘导入收在「先传、稍后打印」两块里。这一版式此前没有任何用例守着：隐去那两块，所有用例照样绿。
  const errors = collectRuntimeErrors(page)
  registerShell(api, { isOnline: true, printerStatus: 'paper_empty' })
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: AVAILABLE },
  })

  await page.goto('/print-scan')
  await expect(page.locator('[data-testid="print-hub-state-device-off"]')).toBeVisible()
  await expect(page.locator('.qxt-print-hub.ph-paper')).toBeVisible()
  await expect(page.locator('.qxt-status')).toContainText('打印机缺纸 · 出纸类暂停')
  await expect(page.getByTestId('print-hub-cap-doc-print')).toBeDisabled()
  await expect(page.getByTestId('print-hub-cap-doc-print')).toContainText('这次出不了纸')
  await expect(page.getByTestId('print-hub-cap-scan')).toBeDisabled()
  await expect(page.getByRole('button', { name: /到机码核销/ })).toBeEnabled()
  await expect(page.getByTestId('print-hub-fallback')).toContainText('这台机器暂时打不了')
  await expect(page.getByTestId('print-hub-fallback')).not.toContainText('找现场工作人员')
  // 「先传、稍后打印」：标题 + 手机扫码上传、U 盘导入两块（行式磁贴），可点。
  await expect(page.getByText('先传、稍后打印', { exact: true })).toBeVisible()
  const phoneRow = page.getByTestId('print-hub-cap-phone-upload')
  const usbRow = page.getByTestId('print-hub-cap-usb-import')
  await expect(phoneRow).toBeEnabled()
  await expect(usbRow).toBeEnabled()
  await expect(phoneRow).toContainText('手机扫码上传')
  await expect(usbRow).toContainText('U 盘导入')
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
  await expect(page.getByRole('button', { name: /打印文件/ })).toBeEnabled()
  expect(errors).toEqual([])
})

test('id-photo feature page is parked and returns to the print hub @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: [] },
  })

  await page.goto('/print-scan/feature/id-photo')
  await expect(page).toHaveURL(/\/print-scan$/)
  await expect(page.locator('[data-w2-page="print-scan-home"]')).toBeVisible()
  await expect(page.locator('[data-testid="print-hub-state-feature-id-photo"]')).toHaveCount(0)
  await expect(page.getByTestId('print-hub-cap-id-photo')).toHaveCount(0)
  await expect(page.getByText('证件照：本机尚未开放')).toHaveCount(0)
  expect(errors).toEqual([])
})

// 证件照停放前，「已经有证件照文件 → 按普通照片打印」由说明页的替代按钮测；停放后这条路只剩服务台的照片打印卡，
// 正向流程照样要有人测：点卡进上传页，带上 category=photo。
test('photo-print tool card still opens the upload page for ordinary photos @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: AVAILABLE },
  })

  await page.goto('/print-scan')
  await expect(page.locator('[data-testid="print-hub-state-default"]')).toBeVisible()
  const photoPrint = page.getByTestId('print-hub-cap-photo-print')
  await expect(photoPrint).toBeEnabled()
  await photoPrint.click()
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
  await expect(page.getByRole('heading', { name: '这个能力名我不认识' })).toBeVisible()
  await expect(page.getByText('没有这项能力说明')).toBeVisible()
  await expect(page.getByText('这个名字不在现有的说明里，本页不编一套步骤。')).toBeVisible()
  await expect(page.getByText('复印的说明在「怎么在打印机上复印」。')).toBeVisible()
  await expect(page.getByRole('button', { name: '看证件照说明' })).toHaveCount(0)
  await expect(page.getByText('证件照这一页写的是尚未开放，和两条替代路径')).toHaveCount(0)
  await expect(page.getByTestId('print-hub-primary')).toHaveText('返回打印扫描')
  await expect(page.getByRole('button', { name: '联系工作人员' })).toHaveCount(0)
  await page.getByTestId('print-hub-primary').click()
  await expect(page).toHaveURL(/\/print-scan$/)
  expect(errors).toEqual([])
})

/**
 * 复印说明一屏的几何（1080×1920）：不滚动、没有大片留白、字 ≥20px（图里的字按渲染后的有效字号）、
 * 可点区 ≥48px、底部主按钮 ≥64px。两个视图各量一次。
 */
async function expectCopyGuideGeometry(page: Page, label: string): Promise<void> {
  const geo = await page.evaluate(() => {
    const scroller = document.querySelector('.ph-page') as HTMLElement
    const box = scroller.getBoundingClientRect()
    const lastBottom = Math.max(...[...scroller.children].map((el) => el.getBoundingClientRect().bottom))
    const ownText = (el: Element) => [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 0)
    const fonts = [...scroller.querySelectorAll('*')]
      .filter((el) => !el.closest('svg') && ownText(el))
      .map((el) => parseFloat(getComputedStyle(el).fontSize))
    // svg 里的字：写在 viewBox 里的字号 × 实际渲染宽 / viewBox 宽。
    const svgFonts = [...scroller.querySelectorAll('svg text')].map((text) => {
      const svg = (text as SVGTextElement).ownerSVGElement as SVGSVGElement
      return parseFloat(getComputedStyle(text).fontSize) * (svg.getBoundingClientRect().width / svg.viewBox.baseVal.width)
    })
    const taps = [...document.querySelectorAll('.qxt-band button, .qxt-body button, .qxt-dock button')].map((el) => {
      const rect = el.getBoundingClientRect()
      return Math.min(rect.width, rect.height)
    })
    const ctas = [...document.querySelectorAll('.qxt-dock .qxt-btn')].map((el) => el.getBoundingClientRect().height)
    const primary = (document.querySelector('[data-testid="print-hub-primary"]') as Element).getBoundingClientRect().height
    return {
      overflow: scroller.scrollHeight - scroller.clientHeight,
      trailingBlank: box.bottom - lastBottom,
      minFont: Math.min(...fonts),
      minSvgFont: svgFonts.length > 0 ? Math.min(...svgFonts) : 9999,
      minTap: Math.min(...taps),
      minCta: Math.min(...ctas),
      primary,
    }
  })
  console.log(`copy-guide-geometry ${label} ${JSON.stringify(geo)}`)
  expect(geo.overflow, `${label}：1080×1920 一屏放下，不需要滚动`).toBeLessThanOrEqual(1)
  expect(geo.trailingBlank, `${label}：一屏内不许大片留白（整行 ≥160px 即算）`).toBeLessThan(160)
  expect(geo.minFont, `${label}：主要文字 ≥20px`).toBeGreaterThanOrEqual(20)
  expect(geo.minSvgFont, `${label}：图里的字按渲染后的有效字号 ≥20px`).toBeGreaterThanOrEqual(20)
  expect(geo.minCta, `${label}：底部主按钮 ≥56px`).toBeGreaterThanOrEqual(56)
  expect(geo.minTap, `${label}：可点区 ≥48px`).toBeGreaterThanOrEqual(48)
  expect(geo.primary, `${label}：主按钮可点区 ≥64px`).toBeGreaterThanOrEqual(64)
}

// R4（2026-09-29 产品负责人拍板）：复印走打印机面板自带功能。打印扫描首页的「复印」卡原是 2.0 稿 10
// 里不可点的静态说明（data-static / role=group），按拍板改为可点，进 /print-scan/feature/copy。
// 11/02 起复印说明是图文分步：第一视图五步配图，第 2 步旁的「这几种原件这样复印」进第二视图
// （同一路由 ?view=cases：身份证、发票收据、正反两面都有字），第二视图的返回回到第一视图。
// 这条用例从首页真实点击进入说明态，走完两个视图，再点「返回打印扫描」回到首页。
test('copy card opens the panel copy guide and returns to the hub @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: AVAILABLE },
  })

  await page.goto('/print-scan')
  await expect(page.locator('[data-testid="print-hub-state-default"]')).toBeVisible()
  const copyCard = page.getByTestId('print-hub-copy-note')
  // 依据 R4（9/29）：复印卡从静态说明改为可点按钮，不再带 data-static。
  await expect(copyCard).toHaveRole('button')
  await expect(copyCard).not.toHaveAttribute('data-static', /.*/)
  await expect(copyCard).toContainText('在打印机屏幕上点「复印」「身份证复印」或「票据复印」；不经过这台一体机下单，也不进打印订单')
  await page.screenshot({ path: test.info().outputPath('01-print-hub.png') })
  await copyCard.click()

  await expect(page).toHaveURL(/\/print-scan\/feature\/copy$/)
  const guide = page.getByTestId('print-hub-state-feature-copy')
  await expect(guide).toBeVisible()
  await expect(guide).toHaveAttribute('data-view', 'steps')
  await expect(page.getByRole('heading', { level: 1, name: '怎么在打印机上复印' })).toHaveCount(1)
  // 稿 18：这句话在意图带的副标题里，不再在正文里重复一遍。
  const band = page.locator('.qxt-band')
  await expect(band.getByText('不用在这台屏幕上下单', { exact: false })).toBeVisible()
  await expect(band.getByText('也不会出现在「我的打印订单」里', { exact: false })).toBeVisible()
  await expect(page.getByTestId('print-hub-copy-steps').locator('li')).toHaveCount(5)
  // 按钮名按面板屏幕实际字样：主屏的「复印」「身份证复印」「票据复印」。手册里前后不一的叫法不得出现。
  for (const panelWord of ['「复印」', '「身份证复印」', '「票据复印」']) {
    await expect(guide.getByText(panelWord, { exact: false }).first()).toBeVisible()
  }
  for (const manualWord of ['OK 键', 'OK键', '复印开始键']) {
    await expect(guide.getByText(manualWord, { exact: false })).toHaveCount(0)
  }
  // 第 1、2 步补的两句（出自厂家官方手册）。
  await expect(guide.getByText('进纸器里有纸时先扫进纸器，玻璃上的不会被复印。')).toBeVisible()
  await expect(guide.getByText('屏幕不在主屏时，先按触摸屏左边的主页键（小房子）。')).toBeVisible()
  await expect(page.getByTestId('print-hub-copy-take-original')).toContainText('复印件和原件一起带走。原件还在玻璃上或进纸口里，请务必取回。')
  await expect(page.getByTestId('print-hub-copy-legal')).toContainText('不得复印伪造的证件、印章、票据。')
  // 三种原件不在第一视图里：它们在第二视图，从第 2 步旁的按钮进。
  await expect(page.getByTestId('print-hub-copy-case-id-card')).toHaveCount(0)
  // 第一视图：五步和进第二视图的按钮同屏可见、可点。
  const entry = page.getByTestId('print-hub-copy-cases-entry')
  await expect(entry).toBeVisible()
  await expect(entry).toBeEnabled()
  await expect(entry).toContainText('这几种原件这样复印')
  await expect(entry).toContainText('身份证、发票、双面')
  for (const step of await page.getByTestId('print-hub-copy-steps').locator('li').all()) await expect(step).toBeVisible()
  // 不伪造结果、不写收费、不写工程词，也不写「找工作人员」一类说法（现场无人值守）。
  for (const word of ['已复印', '复印成功', '复印完成', '免费', '元/页', '服务端', 'Agent', '能力配置', '工作人员']) {
    await expect(guide.getByText(word, { exact: false })).toHaveCount(0)
  }
  await expectNoForgedReady(page)
  await assertNoHorizontalOverflow(page)

  if (page.viewportSize()?.width === 1080) {
    const onScreen = await page.evaluate(() => {
      const boxes = [
        ...document.querySelectorAll('[data-testid="print-hub-copy-steps"] > li'),
        document.querySelector('[data-testid="print-hub-copy-cases-entry"]') as Element,
      ].map((el) => el.getBoundingClientRect())
      return {
        top: Math.min(...boxes.map((box) => box.top)),
        bottom: Math.max(...boxes.map((box) => box.bottom)),
        bandBottom: (document.querySelector('.qxt-band') as Element).getBoundingClientRect().bottom,
        dockTop: (document.querySelector('.qxt-dock') as Element).getBoundingClientRect().top,
      }
    })
    expect(onScreen.top, '五步和入口按钮都在意图带之下').toBeGreaterThanOrEqual(onScreen.bandBottom - 1)
    expect(onScreen.bottom, '五步和入口按钮都在底栏之上，同一屏，不用滚').toBeLessThanOrEqual(onScreen.dockTop + 1)
    await assertTapTargetPointerHit(entry)
    await expectCopyGuideGeometry(page, '第一视图')
  }
  await page.screenshot({ path: test.info().outputPath('02-copy-guide.png') })

  // 点第 2 步旁的「这几种原件这样复印」进第二视图（同一路由，查询串 view=cases）。
  await entry.click()
  await expect(page).toHaveURL(/\/print-scan\/feature\/copy\?view=cases$/)
  await expect(guide).toHaveAttribute('data-view', 'cases')
  await expect(page.getByRole('heading', { level: 1, name: '这几种原件这样复印' })).toHaveCount(1)
  await expect(band.getByText('身份证、发票收据、正反两面都有字，各有一点不同。')).toBeVisible()
  // 三种原件：身份证、发票收据、正反两面都有字。
  for (const key of ['id-card', 'receipt', 'duplex']) {
    await expect(page.getByTestId(`print-hub-copy-case-${key}`)).toBeVisible()
  }
  await expect(page.getByTestId('print-hub-copy-case-id-card')).toContainText('在打印机屏幕上点「身份证复印」，需要时改设置，再点「复印」开始。')
  await expect(page.getByTestId('print-hub-copy-case-receipt')).toContainText('在打印机屏幕上点「票据复印」，原件字朝下放在玻璃上、合上盖，需要时改设置，再点「复印」开始。')
  await expect(page.getByTestId('print-hub-copy-case-receipt')).toContainText('摆放位置以打印机屏幕提示为准。')
  await expect(page.getByTestId('print-hub-copy-case-duplex')).toContainText('用进纸器放原件，选「双面复印」。第一面印完，原件会从进纸器出口出来。照原样放回进纸口，不翻面、不转方向，再按打印机屏幕提示印第二面。')
  await expect(page.getByTestId('print-hub-copy-case-duplex')).toContainText('等太久没放，就只印单面。')
  // 身份证放置位置待现场核实：只给指路句，不编造位置。
  await expect(page.getByTestId('print-hub-copy-case-id-card')).toHaveAttribute('data-pending', 'true')
  await expect(page.getByTestId('print-hub-copy-case-id-card')).toContainText('身份证怎么放、怎么翻面，请看打印机屏幕上的图示。')
  // 两条提醒两个视图都在，原句不变。
  await expect(page.getByTestId('print-hub-copy-take-original')).toContainText('复印件和原件一起带走。原件还在玻璃上或进纸口里，请务必取回。')
  await expect(page.getByTestId('print-hub-copy-legal')).toContainText('不得复印伪造的证件、印章、票据。只能复印本人的真实证件和票据。')
  // 第二视图同样不伪造结果、不写收费、不写工程词，也不写「找工作人员」一类说法（现场无人值守）。
  for (const word of ['已复印', '复印成功', '复印完成', '免费', '元/页', '服务端', 'Agent', '能力配置', '工作人员']) {
    await expect(guide.getByText(word, { exact: false })).toHaveCount(0)
  }
  await expectNoForgedReady(page)
  await assertNoHorizontalOverflow(page)
  if (page.viewportSize()?.width === 1080) await expectCopyGuideGeometry(page, '第二视图')
  await page.screenshot({ path: test.info().outputPath('02b-copy-cases.png') })

  // 第二视图的返回回到第一视图，不直接退出复印说明页：先点顶栏返回键，再进去，再点底栏的「返回」。
  await band.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/\/print-scan\/feature\/copy$/)
  await expect(guide).toHaveAttribute('data-view', 'steps')
  await expect(page.getByTestId('print-hub-copy-steps').locator('li')).toHaveCount(5)
  await entry.click()
  await expect(guide).toHaveAttribute('data-view', 'cases')
  await page.locator('.qxt-dock').getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/\/print-scan\/feature\/copy$/)
  await expect(guide).toHaveAttribute('data-view', 'steps')

  // 点底部操作条里的「返回打印扫描」（顶栏返回键同名，这里点的是操作条那一个）。
  await page.locator('.qxt-dock').getByRole('button', { name: '返回打印扫描', exact: true }).click()
  await expect(page).toHaveURL(/\/print-scan$/)
  await expect(page.locator('[data-testid="print-hub-state-default"]')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('03-back-to-hub.png') })
  expect(errors).toEqual([])
})

const PAUSE_LABEL = '暂停接单'
// 无人值守标准句 3（machineUnusableLine）。运行时根会读服务联系方式；ApiRouter 对这个接口的默认应答是
// 服务电话 18369161921、服务时间「工作日 9:00–18:00」、两个布尔为假（单点位，写「请稍后再来」）。
const PAUSE_NOTICE = '这台机器暂时不能用，请稍后再来，或拨打服务电话 18369161921（工作日 9:00–18:00）。'
// 读不到服务联系方式（接口 404 / 超时 / 字段缺失）时的最保守一套：没号码，指向隐私政策。
const PAUSE_NOTICE_CONSERVATIVE = '这台机器暂时不能用，请稍后再来，或查看《隐私政策》里的联系方式。'
const CONTACT_PATH = '/api/v1/public/support-contact'
// 触屏版任务卡（第三包）停用时卡面只写短标题「暂停接单」，整句原因是读屏名「标题（原因）」；整句说明在卡面下面的 print-hub-fallback 里看得见。
// 旧的暂停说明指向现场工作人员，不许再回来。
const PAUSE_NOTICE_STAFF = '打印机暂时不可用，请联系现场工作人员'
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function registerQueueGate(api: ApiRouter, printerStatus: string): void {
  registerShell(api, { isOnline: true, printerStatus })
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: AVAILABLE },
  })
  api.respond('GET', '/api/v1/jobs', {
    status: 200,
    json: { data: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } },
  })
  api.respond('GET', '/api/v1/job-fairs', {
    status: 200,
    json: { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
  })
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.G8_EVIDENCE_DIR
  if (!dir) return
  await page.screenshot({ path: `${dir}/${name}.png` })
}

// 打印闸门合上：要出纸的入口停用，短标题「暂停接单」，说明用无人值守标准句（不把人引向现场）。
// 不经过打印机的入口（格式转换）照旧可点。删掉 map 里的 case 会掉进「状态未知」，这两条变红。
for (const status of ['queue_cleanup_failed', 'queue_pause_failed'] as const) {
  test(`print entry pauses new orders when heartbeat is ${status} @w2`, async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    registerQueueGate(api, status)

    await page.goto('/')
    const printTile = page.locator('[data-action="print-hub"]')
    await expect(printTile).toHaveAttribute('data-panel-state', 'error')
    await expect(printTile.getByText(PAUSE_LABEL, { exact: true })).toBeVisible()
    await expect(printTile.getByText(PAUSE_NOTICE, { exact: true })).toBeVisible()
    await shot(page, `G8-${status}-home`)

    await page.goto('/print-scan')
    await expect(page.locator('[data-testid="print-hub-state-device-off"]')).toBeVisible()
    const docPrint = page.getByTestId('print-hub-cap-doc-print')
    await expect(docPrint).toBeDisabled()
    await expect(docPrint).toContainText(PAUSE_LABEL)
    await expect(docPrint).toHaveAttribute('aria-label', new RegExp(escapeRegExp(PAUSE_NOTICE)))
    await expect(docPrint).not.toContainText('工作人员')
    await expect(page.getByTestId('print-hub-cap-photo-print')).toBeDisabled()
    await expect(page.getByTestId('print-hub-cap-scan')).toBeDisabled()
    await expect(page.getByTestId('print-hub-cap-convert')).toBeEnabled()
    await expect(page.getByTestId('print-hub-fallback')).toContainText(PAUSE_LABEL)
    await expect(page.getByTestId('print-hub-fallback')).toContainText(PAUSE_NOTICE)
    await expect(page.getByTestId('print-hub-fallback')).not.toContainText('工作人员')
    // 这两种心跳表示打印队列闸门失败，不是连接中断；新旧离线文案都必须被拦住。
    await expect(page.getByText(/离线|无法连接/)).toHaveCount(0)
    await docPrint.click({ force: true })
    await expect(page).toHaveURL(/\/print-scan$/)
    await shot(page, `G8-${status}-print-hub`)

    await page.goto('/print/upload?source=document&tab=file')
    await expect(page.getByText(PAUSE_LABEL, { exact: true }).first()).toBeVisible()
    await expect(page.getByText(PAUSE_NOTICE, { exact: true }).first()).toBeVisible()
    await expect(page.getByText(PAUSE_NOTICE_STAFF, { exact: true })).toHaveCount(0)
    await shot(page, `G8-${status}-upload`)

    await expectNoForgedReady(page)
    expect(errors).toEqual([])
  })
}

// 服务联系方式读不到（后台没发布这个接口、超时、字段缺失）：说明回到保守句，页面上一个号码都不能有。
test('pause notice keeps the conservative sentence when support-contact answers 404 @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerQueueGate(api, 'queue_pause_failed')
  api.respond('GET', CONTACT_PATH, {
    status: 404,
    json: { error: { code: 'NOT_FOUND', message: 'Cannot GET /api/v1/public/support-contact' } },
  })

  // 先等接口真的答过 404，再断言：不然保守句可能只是「还没读到」。
  const answered = page.waitForResponse((response) => new URL(response.url()).pathname === CONTACT_PATH)
  await page.goto('/')
  expect((await answered).status()).toBe(404)
  const printTile = page.locator('[data-action="print-hub"]')
  await expect(printTile).toHaveAttribute('data-panel-state', 'error')
  await expect(printTile.getByText(PAUSE_LABEL, { exact: true })).toBeVisible()
  await expect(printTile.getByText(PAUSE_NOTICE_CONSERVATIVE, { exact: true })).toBeVisible()
  await expect(page.getByText('18369161921')).toHaveCount(0)
  await shot(page, 'G8-contact-404-home')

  await page.goto('/print-scan')
  await expect(page.locator('[data-testid="print-hub-state-device-off"]')).toBeVisible()
  await expect(page.getByTestId('print-hub-cap-doc-print')).toHaveAttribute('aria-label', new RegExp(escapeRegExp(PAUSE_NOTICE_CONSERVATIVE)))
  await expect(page.getByTestId('print-hub-fallback')).toContainText(PAUSE_NOTICE_CONSERVATIVE)

  await page.goto('/print/upload?source=document&tab=file')
  await expect(page.getByText(PAUSE_NOTICE_CONSERVATIVE, { exact: true }).first()).toBeVisible()
  await expect(page.getByText('18369161921')).toHaveCount(0)

  await expectNoForgedReady(page)
  expect(errors).toEqual([])
})

// 号码比打印机状态晚到：状态里存的说明是取状态那一刻算好的，必须随联系方式重算。
// 打印机状态一分钟才再取一次，这里的断言窗口只有几秒，所以换句只能是「号码到了就重算」，不是下一次轮询碰巧换的。
test('pause notice switches to the phone sentence when the number arrives after the printer status @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerQueueGate(api, 'queue_pause_failed')
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => { release = resolve })
  api.respondWith('GET', CONTACT_PATH, async () => {
    await held
    return {
      status: 200,
      json: {
        success: true,
        data: { servicePhone: '13800138000', serviceHours: '每天 8:00–20:00', otherOnlineTerminalNearby: false, miniappPublished: false },
      },
    }
  })

  await page.goto('/')
  const printTile = page.locator('[data-action="print-hub"]')
  await expect(printTile).toHaveAttribute('data-panel-state', 'error')
  await expect(printTile.getByText(PAUSE_NOTICE_CONSERVATIVE, { exact: true })).toBeVisible()
  await expect.poll(() => api.requestCount('GET', CONTACT_PATH), '号码还没回来，但已经问过一次').toBe(1)
  const statusRequestsBefore = api.requestCount('GET', '/api/v1/terminals/KSK-001/printer-status')
  await shot(page, 'G8-contact-late-before')

  release()
  const withNumber = '这台机器暂时不能用，请稍后再来，或拨打服务电话 13800138000（每天 8:00–20:00）。'
  await expect(printTile.getByText(withNumber, { exact: true })).toBeVisible()
  await expect(printTile.getByText(PAUSE_NOTICE_CONSERVATIVE, { exact: true })).toHaveCount(0)
  expect(
    api.requestCount('GET', '/api/v1/terminals/KSK-001/printer-status'),
    '说明换了，但打印机状态没有再取一次：靠的是号码到了就重算',
  ).toBe(statusRequestsBefore)
  expect(api.requestCount('GET', CONTACT_PATH), '运行时根读一次，设备状态只订阅不再各自去读').toBe(1)
  await shot(page, 'G8-contact-late-after')

  await expectNoForgedReady(page)
  expect(errors).toEqual([])
})

test('unknown feature page lists the copy guide as the second known explanation @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: [] },
  })

  await page.goto('/print-scan/feature/not-a-real-feature')
  await expect(page.locator('[data-testid="print-hub-state-feature-not-found"]')).toBeVisible()
  await page.getByTestId('print-hub-copy-note').click()
  await expect(page).toHaveURL(/\/print-scan\/feature\/copy$/)
  await expect(page.getByTestId('print-hub-state-feature-copy')).toBeVisible()
  expect(errors).toEqual([])
})
