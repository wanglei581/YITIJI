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
  await expect(page.getByRole('button', { name: /到机码核销/ })).toContainText('取件就用它')
  await expect(page.getByText('在打印机面板上操作，取走纸质复印件。')).toBeVisible()
  await expect(page.getByRole('button', { name: '问小青：怎么选打印方式 →' })).toBeVisible()
  await page.locator('.ph-page').evaluate((element) => { element.scrollTop = 0 })
  const firstCard = await page.getByTestId('print-hub-cap-doc-print').boundingBox()
  expect(firstCard!.y, '2.0 可点能力卡位于顶部只读区之后').toBeGreaterThanOrEqual(500)
  await expectNoForgedReady(page)
  await assertNoHorizontalOverflow(page)
  // 稿 10：无独立页头（h1 只给读屏），1080 首屏横幅紧贴顶栏，快捷入口与底注整屏可见、不被底栏遮住。
  await expect(page.getByRole('heading', { level: 1, name: '打印扫描服务' })).toHaveCount(1)
  if (page.viewportSize()?.width === 1080) {
    const geo = await page.evaluate(() => {
      const box = (el: Element | null) => el!.getBoundingClientRect()
      const notes = [...document.querySelectorAll('.ph-note')].map((el) => el.getBoundingClientRect().bottom)
      return {
        pageheadH: box(document.querySelector('.qx-pagehead')).height,
        heroTop: box(document.querySelector('.ph-xq')).top,
        heroBottom: box(document.querySelector('.ph-xq')).bottom,
        gridTop: box(document.querySelector('.ph-grid')).top,
        gridBottom: box(document.querySelector('.ph-grid')).bottom,
        srcBottom: box(document.querySelector('.ph-src')).bottom,
        noticesBottom: box(document.querySelector('.ph-notices')).bottom,
        truthTop: box(document.querySelector('.ph-truth')).top,
        notesBottom: Math.max(...notes),
        truthBottom: box(document.querySelector('.ph-truth')).bottom,
        navTop: box(document.querySelector('.qx-navbar')).top,
      }
    })
    console.log(`print-hub-geometry ${JSON.stringify(geo)}`)
    await page.screenshot({ path: 'test-results/print-hub-qx-1080x1920.png' })
    expect(geo.pageheadH).toBeLessThanOrEqual(1)
    expect(geo.heroTop).toBeLessThan(140)
    expect(geo.notesBottom).toBeLessThanOrEqual(geo.navTop)
    expect(geo.truthBottom).toBeLessThanOrEqual(geo.navTop)
    expect(geo.noticesBottom).toBeLessThanOrEqual(geo.navTop)
  }
  await page.screenshot({ path: test.info().outputPath('print-hub-default.png'), fullPage: true })
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
  const hero = await page.locator('.ph-xq-ask').evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const lines = new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size
    return { width: el.getBoundingClientRect().width, lines, chars: (el.textContent ?? '').length }
  })
  expect(hero.width, '横幅标题不得被挤成窄条').toBeGreaterThan(390 * 0.5)
  expect(hero.chars / hero.lines, '横幅标题不得逐字竖排').toBeGreaterThanOrEqual(4)

  // 滚到底：底注与快捷入口必须落在底栏之上，不被遮住。
  const geo = await page.locator('.qx-scroll').evaluate((scroller) => {
    scroller.scrollTop = scroller.scrollHeight
    const notes = [...document.querySelectorAll('.ph-note')].map((el) => el.getBoundingClientRect().bottom)
    return {
      atEnd: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1,
      scrolls: scroller.scrollHeight > scroller.clientHeight,
      notesBottom: Math.max(...notes),
      truthBottom: document.querySelector('.ph-truth')!.getBoundingClientRect().bottom,
      navTop: document.querySelector('.qx-navbar')!.getBoundingClientRect().top,
    }
  })
  expect(geo.scrolls && geo.atEnd, '390 下内容应在 .qx-scroll 内滚动且已滚到底').toBe(true)
  expect(geo.truthBottom).toBeLessThanOrEqual(geo.navTop)
  expect(geo.notesBottom).toBeLessThanOrEqual(geo.navTop)
  await expect(page.getByTestId('print-hub-truth')).toBeInViewport()
  await expect(page.getByTestId('print-hub-copy-note')).toBeInViewport()
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
  await expect(page.locator('.ph-actions').getByRole('button', { name: '重新检测', exact: true })).toBeVisible()
  await expect(page.locator('.ph-actions').getByRole('button', { name: /问小青/ })).toBeVisible()
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
  const bottom = await page.locator('.ph-page').evaluate((scroller) => {
    scroller.scrollTop = scroller.scrollHeight
    return {
      atEnd: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1,
      actionsBottom: document.querySelector('.ph-actions')!.getBoundingClientRect().bottom,
      footerBottom: document.querySelector('.ph-foot')!.getBoundingClientRect().bottom,
      navTop: document.querySelector('.qx-navbar')!.getBoundingClientRect().top,
    }
  })
  expect(bottom.atEnd).toBe(true)
  expect(bottom.actionsBottom).toBeLessThanOrEqual(bottom.navTop)
  expect(bottom.footerBottom).toBeLessThanOrEqual(bottom.navTop)
  await expectNoForgedReady(page)
  expect(errors).toEqual([])
})

// D3（2026-09-28）：签名默认关，管理员逐台配成 available 才开（服务端 DEFAULT_DENY_CAPABILITY_KEYS）。
// 能力读取成功、但本机没有已配置的 signature_stamp 行时，这张卡必须和管理员配成 not_verified 一样
// 整卡停用、写明「本机暂未开通」—— 不能让人点进去、传完文件才被服务端拒绝。两种形状都要覆盖：
//   · 列表里根本没有这一行；
//   · 真实后端的形状：每个键都下发，没配置过的是 configured=false（listForTerminal）。
const WITHOUT_SIGNATURE = AVAILABLE.filter((row) => row.capabilityKey !== 'signature_stamp')
for (const variant of [
  { name: 'row absent', capabilities: WITHOUT_SIGNATURE },
  {
    name: 'row configured=false',
    capabilities: [
      ...WITHOUT_SIGNATURE,
      { capabilityKey: 'signature_stamp', status: 'not_verified', note: null, configured: false, updatedAt: null },
    ],
  },
]) {
  test(`print hub keeps the signature card closed on a terminal that never enabled it (${variant.name}) @w2`, async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    registerShell(api)
    api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
      status: 200,
      json: { capabilities: variant.capabilities },
    })

    await page.goto('/print-scan')
    const sign = page.getByTestId('print-hub-cap-sign')
    await expect(sign).toBeDisabled()
    await expect(sign).toContainText('本机暂未开通')
    // 停用要真的点不进去，不只是换个样子。
    await sign.click({ force: true })
    await expect(page).toHaveURL(/\/print-scan$/)
    // 阳性对照：读取本身是成功的 —— 同样不经过打印机、已登记可用的格式转换照常可点。
    await expect(page.getByTestId('print-hub-cap-convert')).toBeEnabled()
    await expectNoForgedReady(page)
    expect(errors).toEqual([])
  })
}

test('print hub device-off pauses paper paths and keeps software paths @w2', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api, { isOnline: false, printerStatus: 'offline' })
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: AVAILABLE },
  })

  await page.goto('/print-scan')
  await expect(page.locator('[data-testid="print-hub-state-device-off"]')).toBeVisible()
  await expect(page.getByTestId('print-hub-fallback').getByText('打印机离线 · 出纸类暂停', { exact: true })).toBeVisible()
  await expect(page.getByTestId('print-hub-fallback')).toContainText('这台机器暂时打不了，我们已经收到提醒，会尽快处理。请稍后再来；需要帮助请拨打服务电话 18369161921（工作日 9:00–18:00）。')
  await expect(page.getByTestId('print-hub-fallback')).not.toContainText('换一台机器')
  await expect(page.getByTestId('print-hub-cap-doc-print')).toBeDisabled()
  await expect(page.getByTestId('print-hub-cap-scan')).toBeDisabled()
  await expect(page.getByTestId('print-hub-cap-convert')).toBeEnabled()
  await expect(page.getByTestId('print-hub-cap-sign')).toBeEnabled()
  await expect(page.getByRole('button', { name: /到机码核销/ })).toBeEnabled()
  await expect(page.getByTestId('print-hub-cap-doc-print')).toContainText('这台机器现在出不了纸')
  const bottom = await page.locator('.ph-page').evaluate((scroller) => {
    scroller.scrollTop = scroller.scrollHeight
    return {
      atEnd: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1,
      actionsBottom: document.querySelector('.ph-actions')!.getBoundingClientRect().bottom,
      footerBottom: document.querySelector('.ph-foot')!.getBoundingClientRect().bottom,
      navTop: document.querySelector('.qx-navbar')!.getBoundingClientRect().top,
    }
  })
  expect(bottom.atEnd).toBe(true)
  expect(bottom.actionsBottom).toBeLessThanOrEqual(bottom.navTop)
  expect(bottom.footerBottom).toBeLessThanOrEqual(bottom.navTop)
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
  await expect(page.getByRole('button', { name: '求助' })).toBeVisible()
  await page.getByRole('button', { name: '返回打印扫描服务' }).click()
  await expect(page).toHaveURL(/\/print-scan$/)
  expect(errors).toEqual([])
})

// R4（2026-09-29 产品负责人拍板）：复印走打印机面板自带功能。打印扫描首页的「复印」卡原是 2.0 稿 10
// 里不可点的静态说明（data-static / role=group），按拍板改为可点，进 /print-scan/feature/copy。
// 这条用例从首页真实点击进入说明态，再点「返回打印扫描」回到首页。
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
  await expect(copyCard).toContainText('在打印机面板上操作，取走纸质复印件。')
  await page.screenshot({ path: test.info().outputPath('01-print-hub.png') })
  await copyCard.click()

  await expect(page).toHaveURL(/\/print-scan\/feature\/copy$/)
  const guide = page.getByTestId('print-hub-state-feature-copy')
  await expect(guide).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: '怎么在打印机上复印' })).toHaveCount(1)
  await expect(guide.getByText('不用在这台屏幕上下单', { exact: false })).toBeVisible()
  await expect(guide.getByText('也不会出现在「我的打印订单」里', { exact: false })).toBeVisible()
  await expect(page.getByTestId('print-hub-copy-steps').locator('li')).toHaveCount(5)
  // 按钮名按面板屏幕实际字样：主屏的「复印」「身份证复印」「票据复印」。手册里前后不一的叫法不得出现。
  for (const panelWord of ['「复印」', '「身份证复印」', '「票据复印」']) {
    await expect(guide.getByText(panelWord, { exact: false }).first()).toBeVisible()
  }
  for (const manualWord of ['OK 键', 'OK键', '复印开始键']) {
    await expect(guide.getByText(manualWord, { exact: false })).toHaveCount(0)
  }
  // 身份证放置位置待现场核实：只给指路句，不编造位置。
  await expect(page.getByTestId('print-hub-copy-case-id-card')).toHaveAttribute('data-pending', 'true')
  await expect(page.getByTestId('print-hub-copy-case-id-card')).toContainText('身份证怎么放、怎么翻面，请看打印机屏幕提示。')
  await expect(page.getByTestId('print-hub-copy-take-original')).toContainText('别忘了取走玻璃上或进纸口里的原件（身份证等）')
  await expect(page.getByTestId('print-hub-copy-legal')).toContainText('不得复印伪造的证件、印章、票据。')
  // 不伪造结果、不写收费、不写工程词。
  for (const word of ['已复印', '复印成功', '复印完成', '免费', '元/页', '服务端', 'Agent', '能力配置']) {
    await expect(guide.getByText(word, { exact: false })).toHaveCount(0)
  }
  await expectNoForgedReady(page)
  await assertNoHorizontalOverflow(page)

  if (page.viewportSize()?.width === 1080) {
    const geo = await page.evaluate(() => {
      const scroller = document.querySelector('.ph-page') as HTMLElement
      const box = scroller.getBoundingClientRect()
      const lastBottom = Math.max(...[...scroller.children].map((el) => el.getBoundingClientRect().bottom))
      const texts = [...scroller.querySelectorAll('b, .d, .ph-state-p, .ph-state-t, .ph-truth div, .ph-xq-doing, .ph-sec-h .t, .hint')]
        .filter((el) => (el.textContent ?? '').trim().length > 0)
        .map((el) => parseFloat(getComputedStyle(el).fontSize))
      const ctas = [...document.querySelectorAll('.qx-ctabar .qx-btn')].map((el) => el.getBoundingClientRect().height)
      return {
        overflow: scroller.scrollHeight - scroller.clientHeight,
        trailingBlank: box.bottom - lastBottom,
        minFont: Math.min(...texts),
        minCta: Math.min(...ctas),
      }
    })
    console.log(`copy-guide-geometry ${JSON.stringify(geo)}`)
    expect(geo.overflow, '1080×1920 一屏放下，不需要滚动').toBeLessThanOrEqual(1)
    expect(geo.trailingBlank, '一屏内不许大片留白（整行 ≥160px 即算）').toBeLessThan(160)
    expect(geo.minFont, '主要文字 ≥20px').toBeGreaterThanOrEqual(20)
    expect(geo.minCta, '底部主按钮 ≥56px').toBeGreaterThanOrEqual(56)
  }
  await page.screenshot({ path: test.info().outputPath('02-copy-guide.png') })

  // 点底部操作条里的「返回打印扫描」（顶栏返回键同名，这里点的是操作条那一个）。
  await page.locator('.qx-ctabar').getByRole('button', { name: '返回打印扫描', exact: true }).click()
  await expect(page).toHaveURL(/\/print-scan$/)
  await expect(page.locator('[data-testid="print-hub-state-default"]')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('03-back-to-hub.png') })
  expect(errors).toEqual([])
})

const PAUSE_LABEL = '暂停接单'
const PAUSE_NOTICE = '这台机器暂时不能用，请稍后再来，或拨打服务电话 18369161921（工作日 9:00–18:00）。'

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

// 打印闸门合上：要出纸的入口停用，短标题「暂停接单」，说明是标准句 3。默认单点位不写「换一台机器」。
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
    await expect(printTile).not.toContainText('换一台机器')
    await shot(page, `G8-${status}-home`)

    await page.goto('/print-scan')
    await expect(page.locator('[data-testid="print-hub-state-device-off"]')).toBeVisible()
    const docPrint = page.getByTestId('print-hub-cap-doc-print')
    await expect(docPrint).toBeDisabled()
    await expect(docPrint).toContainText(PAUSE_LABEL)
    await expect(docPrint).toContainText(PAUSE_NOTICE)
    await expect(page.getByTestId('print-hub-cap-photo-print')).toBeDisabled()
    await expect(page.getByTestId('print-hub-cap-scan')).toBeDisabled()
    await expect(page.getByTestId('print-hub-cap-convert')).toBeEnabled()
    await expect(page.getByTestId('print-hub-fallback')).toContainText(PAUSE_LABEL)
    await expect(page.getByTestId('print-hub-fallback')).toContainText(PAUSE_NOTICE)
    // 这两种心跳表示打印队列闸门失败，不是连接中断；新旧离线文案都必须被拦住。
    await expect(page.getByText(/离线|无法连接/)).toHaveCount(0)
    await docPrint.click({ force: true })
    await expect(page).toHaveURL(/\/print-scan$/)
    await shot(page, `G8-${status}-print-hub`)

    await page.goto('/print/upload?source=document&tab=file')
    await expect(page.getByText(PAUSE_LABEL, { exact: true }).first()).toBeVisible()
    await expect(page.getByText(PAUSE_NOTICE, { exact: true }).first()).toBeVisible()
    await shot(page, `G8-${status}-upload`)

    await expectNoForgedReady(page)
    expect(errors).toEqual([])
  })
}

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

function supportContact(api: ApiRouter, patch: { nearby?: boolean; miniapp?: boolean; missing?: boolean }): void {
  if (patch.missing) {
    api.respond('GET', '/api/v1/public/support-contact', { status: 404, json: { success: false } })
    return
  }
  api.respond('GET', '/api/v1/public/support-contact', {
    status: 200,
    json: {
      success: true,
      data: {
        servicePhone: '18369161921',
        serviceHours: '工作日 9:00–18:00',
        otherOnlineTerminalNearby: patch.nearby === true,
        miniappPublished: patch.miniapp === true,
      },
    },
  })
}

test('queue gate names another machine only when one is online nearby @w2', async ({ page, api }) => {
  registerQueueGate(api, 'queue_cleanup_failed')
  supportContact(api, { nearby: true })
  await page.goto('/')
  const printTile = page.locator('[data-action="print-hub"]')
  await expect(printTile.getByText('这台机器暂时不能用，请换一台机器，或拨打服务电话 18369161921（工作日 9:00–18:00）。', { exact: true })).toBeVisible()
  await expect(printTile).toContainText('换一台机器')
})

test('queue gate still renders when support contact is missing @w2', async ({ page, api }) => {
  registerQueueGate(api, 'queue_pause_failed')
  supportContact(api, { missing: true })
  await page.goto('/')
  const printTile = page.locator('[data-action="print-hub"]')
  await expect.poll(() => api.requestCount('GET', '/api/v1/public/support-contact')).toBeGreaterThan(0)
  await expect(printTile.getByText(PAUSE_LABEL, { exact: true })).toBeVisible()
  await expect(printTile.getByText('这台机器暂时不能用，请稍后再来，或查看《隐私政策》里的联系方式。', { exact: true })).toBeVisible()
  await expect(printTile).not.toContainText('18369161921')
  await expect(printTile).not.toContainText('换一台机器')
})

test('device-off names another machine only when one is online nearby @w2', async ({ page, api }) => {
  registerShell(api, { isOnline: false, printerStatus: 'offline' })
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: AVAILABLE },
  })
  supportContact(api, { nearby: true })
  await page.goto('/print-scan')
  const fallback = page.getByTestId('print-hub-fallback')
  await expect(fallback).toContainText('你可以换一台机器继续，或稍后再来')
  await expect(fallback).toContainText('换一台机器')
  await expect(page.getByTestId('print-hub-cap-doc-print')).toContainText('换一台再打')
})

test('device-off does not say the order is on the phone when no order is on this screen @w2', async ({ page, api }) => {
  registerShell(api, { isOnline: false, printerStatus: 'offline' })
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: AVAILABLE },
  })
  supportContact(api, { miniapp: true })
  await page.goto('/print-scan')
  const fallback = page.getByTestId('print-hub-fallback')
  await expect(fallback).toContainText('这台机器暂时打不了')
  await expect(fallback).not.toContainText('这单还在，手机上能看到')
  await expect(fallback).not.toContainText('换一台机器')
})
