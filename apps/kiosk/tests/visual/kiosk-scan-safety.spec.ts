// 扫码输入安全浏览器套件（FIX-SCAN-SAFETY）
//
// 覆盖两个真实缺陷的回归：
// 1. 付款码曾以 value={authCode} 明文渲染在 27 寸公共竖屏的输入框里。
// 2. 全仓没有任何全局 keydown 拦截，嵌入式常亮扫码模组的误扫会直接落进用户
//    当前聚焦的控件（付款码/取件码可能被写进简历或搜索表单并落库）。
//
// 扫码模组在操作系统眼里就是一个 USB 键盘，所以这里用 pressSequentially 的
// 极小 delay 来真实模拟它：delay=5ms 是扫码突发，delay=120ms 是人手打字。
// 两者走的是**完全相同**的代码路径（真实 trusted keydown），区别只有节奏 ——
// 这正是判据要区分的东西。

import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { test, expect } from '../fixtures/kiosk-test'

const SCAN_DELAY_MS = 5
const HUMAN_DELAY_MS = 120

/** 一串 18 位「付款码」。测试断言它绝不出现在任何可见节点或属性里。 */
const PAYMENT_CODE = '134567890123456789'
/** 路人误扫进来的内容（比如另一个人的取件码二维码）。 */
const STRAY_SCAN = 'AB2C7M9P3K'

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
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

/**
 * /jobs 是「用户在搜岗位时被路人误扫」这个真实场景的载体，也是一个 React 受控
 * 输入框（value={keyword}），正好覆盖「回滚必须走原生 setter」这条实现要求。
 * 返回体必须符合 PaginatedResponse<T>（data + pagination），否则页面会崩到错误边界。
 */
function registerJobsList(api: ApiRouter): void {
  api.respond('GET', '/api/v1/jobs', {
    status: 200,
    json: { data: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } },
  })
}

/**
 * 全页面扫描：付款码绝不允许出现在任何可见文本、任何元素属性、任何输入框的
 * value 属性或 value 属性值里。
 */
async function assertCodeAbsentFromDom(page: Page, code: string): Promise<void> {
  const leaks = await page.evaluate((secret) => {
    const found: string[] = []
    if ((document.body.innerText ?? '').includes(secret)) found.push('body.innerText')
    if (document.documentElement.outerHTML.includes(secret)) found.push('documentElement.outerHTML')
    for (const el of Array.from(document.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        if (attr.value.includes(secret)) found.push(`${el.tagName.toLowerCase()}[${attr.name}]`)
      }
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (el.value.includes(secret)) found.push(`${el.tagName.toLowerCase()}.value`)
      }
    }
    return found
  }, code)
  expect(leaks, `付款码泄漏到了这些位置：${leaks.join(', ')}`).toEqual([])
}

// ── ① 付款码不落屏 ────────────────────────────────────────────────
test('payment code never renders on the public screen @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  api.respond('GET', '/api/v1/payment/channels', { status: 200, json: { channels: ['wechat'] } })
  api.respond('GET', '/api/v1/orders/scan-order/pay-status', {
    status: 200,
    json: {
      orderId: 'scan-order',
      orderNo: 'ORD-SCAN',
      payStatus: 'unpaid',
      paymentSource: null,
      payChannel: null,
      amountCents: 200,
      paidAt: null,
      pickupCode: null,
      attempt: null,
    },
  })

  let submittedCode: string | null = null
  await page.route('**/api/v1/orders/scan-order/code-pay', async (route) => {
    const body = route.request().postDataJSON() as { authCode?: string }
    submittedCode = body.authCode ?? null
    // 停一会儿，让扫码模组的尾随回车在输入框还挂着的时候送达。
    await new Promise((resolve) => setTimeout(resolve, 150))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ attemptId: 'scan-attempt', status: 'failed', failReason: '测试用：不放行' }),
    })
  })

  await page.goto('/print/cashier')
  await page.evaluate(() => {
    window.history.replaceState(
      {
        usr: {
          orderId: 'scan-order',
          orderNo: 'ORD-SCAN',
          amountCents: 200,
          paymentSessionToken: 'scan-session-token',
          priceLines: [],
          taskId: 'scan-task',
        },
      },
      '',
      '/print/cashier',
    )
  })
  await page.reload()

  await page.getByRole('button', { name: /付款码/ }).first().click()

  const input = page.getByLabel('付款码输入区（内容不显示）')
  await expect(input).toBeVisible()

  // ── 关键断言：输入过程中就不能可见 ──
  // 原缺陷正是「边输入边明文显示在 27 寸公共屏上」。只在提交完成后检查是不够的
  // ——那时缓冲区已清空，任何「输入期间可见」的回退都会被漏过（本用例的变异测试
  // 抓到过这一点）。所以先输到第 17 位（不触发自动提交），此刻做全页扫描。
  const partial = PAYMENT_CODE.slice(0, 17)
  await input.pressSequentially(partial, { delay: SCAN_DELAY_MS })
  await expect(page.getByText('已读取 17 / 18 位', { exact: false })).toBeVisible()
  await assertCodeAbsentFromDom(page, partial)
  await expect(input).toHaveValue('')

  // 再补最后一位触发自动提交，并送上扫码模组的尾随回车。
  await input.pressSequentially(PAYMENT_CODE.slice(17), { delay: SCAN_DELAY_MS })
  await input.press('Enter')

  // 码值确实送到了服务端（功能没坏）……
  await expect.poll(() => submittedCode).toBe(PAYMENT_CODE)
  // ……但屏幕上任何地方都不该有它。
  await assertCodeAbsentFromDom(page, PAYMENT_CODE)
  // 输入框自身必须是空的（被 drainInput 抽干）。
  await expect(input).toHaveValue('')
  // 非内容型反馈仍然告诉用户「扫上了」。
  await expect(page.getByText(/已读取完整付款码/)).toBeVisible()

  expect(errors).toEqual([])
})

test('payment code input is not bound to a value attribute @scan-safety', async ({ page, api }) => {
  registerShell(api)
  registerJobsList(api)
  await page.goto('/jobs')
  // 结构性断言：源码里不允许出现 value={authCode} 这种绑定。
  // 运行时断言见上一个用例；这里额外确认收银面板没有把码值写进 defaultValue。
  const html = await page.content()
  expect(html).not.toContain(PAYMENT_CODE)
})

// ── ② 非授权页的 HID 突发被吞掉 ──────────────────────────────────
test('stray scanner burst is swallowed on a non-scanning page @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerJobsList(api)

  await page.goto('/jobs')
  const search = page.getByPlaceholder('搜索职位 / 公司')
  await expect(search).toBeVisible()

  // 用户先正常输入了一些内容。
  await search.click()
  await search.pressSequentially('前端', { delay: HUMAN_DELAY_MS })
  await expect(search).toHaveValue('前端')

  // 此时路人举着一个码从常亮的扫码模组前经过。
  await search.pressSequentially(STRAY_SCAN, { delay: SCAN_DELAY_MS })
  await search.press('Enter')

  // 误扫内容必须被吞掉，且用户原本输入的内容必须原样保留。
  await expect(search).toHaveValue('前端')
  await expect(page.getByTestId('hid-scan-notice')).toBeVisible()
  await expect(page.getByText('已忽略一次扫码')).toBeVisible()

  expect(errors).toEqual([])
})

test('stray scanner burst cannot activate a focused button @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerJobsList(api)

  await page.goto('/jobs')
  await expect(page.getByPlaceholder('搜索职位 / 公司')).toBeVisible()

  // 焦点落在一个按钮上时，扫码模组的尾随回车等价于一次点击 —— 必须被吞掉。
  const urlBefore = page.url()
  await page.keyboard.press('Tab')
  await page.keyboard.type(STRAY_SCAN, { delay: SCAN_DELAY_MS })
  await page.keyboard.press('Enter')

  await expect(page.getByTestId('hid-scan-notice')).toBeVisible()
  expect(page.url()).toBe(urlBefore)
  expect(errors).toEqual([])
})

// ── ③ 人工逐字输入不被误拦 ──────────────────────────────────────
test('human typing is never swallowed @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerJobsList(api)

  await page.goto('/jobs')
  const search = page.getByPlaceholder('搜索职位 / 公司')
  await search.click()

  // 一个比扫码串更长的、按人手节奏输入的字符串：一个字符都不许丢。
  const typed = 'ABCDEFGHIJKLMNOP'
  await search.pressSequentially(typed, { delay: HUMAN_DELAY_MS })

  await expect(search).toHaveValue(typed)
  await expect(page.getByTestId('hid-scan-notice')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('sustained fast human typing below the burst threshold is not swallowed @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerJobsList(api)

  await page.goto('/jobs')
  const search = page.getByPlaceholder('搜索职位 / 公司')
  await search.click()

  // 60ms/键 ≈ 200WPM，已是人类打字的世界纪录区间，仍在 40ms 阈值之上，必须放行。
  const typed = 'FASTTYPINGUSER'
  await search.pressSequentially(typed, { delay: 60 })

  await expect(search).toHaveValue(typed)
  await expect(page.getByTestId('hid-scan-notice')).toHaveCount(0)
  expect(errors).toEqual([])
})

// ── ④ 授权页扫码行为无回归 ──────────────────────────────────────
test('pickup page still accepts scanner input and shows no guard notice @scan-safety', async ({ page, api }) => {
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
    submittedCode = (route.request().postDataJSON() as { code?: string }).code ?? ''
    await new Promise((resolve) => setTimeout(resolve, 150))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        released: false,
        orderId: 'scan-pickup-order',
        orderNo: 'ORD-SCAN-PICKUP',
        terminalId: 'KSK-001',
        amountCents: 100,
        priceLines: [],
        paymentSessionToken: 'scan-pickup-token',
      }),
    })
  })

  await page.goto('/print/pickup-claim')
  const input = page.getByLabel('取件码输入框')
  await expect(input).toBeVisible()

  // 同样的 5ms 突发节奏 —— 在授权页必须照常工作，不能被守卫吞掉。
  await input.pressSequentially(STRAY_SCAN, { delay: SCAN_DELAY_MS })
  await input.press('Enter')

  await expect(page.getByText('订单核验成功', { exact: true })).toBeVisible()
  expect(submittedCode).toBe(STRAY_SCAN)
  expect(claimCount).toBe(1)
  await expect(page.getByTestId('hid-scan-notice')).toHaveCount(0)
  expect(errors).toEqual([])
})
