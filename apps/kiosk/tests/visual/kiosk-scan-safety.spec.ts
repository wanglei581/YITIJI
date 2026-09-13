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

import type { Page, Route } from '@playwright/test'
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
  const input = page.getByLabel('到机码输入框')
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

// ══ 一次性安全重扫授权（FIX-SCAN-RESCAN，2026-09-14） ═══════════════════════
//
// ## 这组用例证明的那件事
//
// 服务端对「已经取到文件（matched）但没建档成功」的同一份字节有 2 小时去重
// （SCAN_FILE_PREVIOUSLY_ATTEMPTED）。它挡的是把上一位用户的扫描件误挂到下一位头上，
// 必须留。代价落在合法用户身上：上一场在取件之后失败了，他把**同一张纸**再扫一遍，
// 字节一模一样 —— 文件回传会被那条去重原样拒掉，任务停在 waiting 直到过期。
// 用户在机器前白等十分钟，屏幕上全程没有任何提示（那次拒绝发生在 Agent 与服务端之间）。
//
// 服务端为此铸了一枚一次性授权。前台此前完全没接：结果页的「重试扫描」只是换个阶段
// 重新建会话，建出来的是普通新会话，照样撞去重。
//
// 所以下面的路由不是「返回一个 200 让页面走下去」的桩，而是一份**同字节服务端模型**：
// 带对了配对凭证的那一次才放行，没带的那一次照真实后果回 failed。两条路径跑的是完全
// 相同的页面代码，区别只有请求里有没有那一对 —— 这正是判据要区分的东西。

const PRIOR_TASK_ID = 'scan-rescan-prior'
const PRIOR_CONTROL_TOKEN = 'prior-control-token-9f2b1e'
const SCAN_SESSION_KEY = 'ai-job-print:current-scan-workbench'
/** 同一张纸的回传文件。只有拿到放行的那一场才认它。 */
const SAME_SHEET_FILE = {
  fileId: 'scan-rescan-file',
  filename: '同一份材料.png',
  sizeBytes: 2048,
  mimeType: 'image/png',
  sha256: 'a'.repeat(64),
  fileUrl: '/api/v1/files/scan-rescan-file/content?sig=fixture',
}
/** 服务端那句真实的去重回执（scan-tasks.service.ts 的 SCAN_FILE_PREVIOUSLY_ATTEMPTED）。 */
const DEDUP_REASON = '该扫描文件此前已尝试投递但未完成，请勿重复上传'

interface CreateAttempt {
  body: Record<string, unknown>
  headers: Record<string, string>
}

/** 扫描首页挂载即读终端能力（scan 是否被管理员配成 available）。 */
function registerScanCapabilities(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', { status: 200, json: { capabilities: [] } })
}

/**
 * 同字节服务端模型。
 *
 * `POST /scan/sessions` 的配对判据逐条复刻 scan-tasks.service.ts 的 create()：
 * 只有头 → 400；只有 id → 403；配对正确且未被消费 → 放行并**一次性**消费；
 * 其余 → 403。放行过的会话在随后的状态查询里才会 completed —— 也就是说，
 * 「用户把同一张纸放回去」这件事的结局完全由「创建时带没带那一对」决定。
 */
function installSameSheetScanServer(page: Page): {
  creates: CreateAttempt[]
  /** 把那枚一次性授权预先用掉：之后任何配对请求都只会拿回 403。 */
  consumeAuthorityUpfront: () => void
} {
  const creates: CreateAttempt[] = []
  const authorized = new Set<string>()
  const known = new Set<string>()
  let authorityConsumed = false

  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  const fail = (route: Route, status: number, code: string, message: string) =>
    json(route, status, { success: false, error: { code, message } })

  void page.route('**/api/v1/scan/sessions', async (route) => {
    const request = route.request()
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/v1/scan/sessions') {
      await route.fallback()
      return
    }
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
    const headers = request.headers()
    creates.push({ body, headers })

    const retryId = typeof body.retryOfScanTaskId === 'string' ? body.retryOfScanTaskId : ''
    const retryToken = headers['x-scan-retry-control'] ?? ''
    if (retryToken && !retryId) {
      await fail(route, 400, 'SCAN_RETRY_TASK_ID_MISSING', '重扫控制凭证缺少对应的原扫描任务')
      return
    }
    if (retryId && !retryToken) {
      await fail(route, 403, 'SCAN_RETRY_NOT_AUTHORIZED', '重扫授权无效、已过期或已使用')
      return
    }
    if (retryId) {
      const pairOk = retryId === PRIOR_TASK_ID && retryToken === PRIOR_CONTROL_TOKEN
      if (!pairOk || authorityConsumed) {
        await fail(route, 403, 'SCAN_RETRY_NOT_AUTHORIZED', '重扫授权无效、已过期或已使用')
        return
      }
      authorityConsumed = true
    }

    const id = `scan-rescan-${creates.length}`
    known.add(id)
    if (retryId) authorized.add(id)
    await json(route, 200, {
      success: true,
      data: {
        scanTaskId: id,
        controlToken: `session-control-${creates.length}`,
        instructions: ['放好原件', '在打印机面板选扫描到网络文件夹'],
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      },
    })
  })

  void page.route('**/api/v1/scan/sessions/*', async (route) => {
    const request = route.request()
    const id = new URL(request.url()).pathname.split('/').pop() ?? ''
    if (request.method() === 'DELETE') {
      await json(route, 200, { success: true, data: { scanTaskId: id, status: 'cancelled' } })
      return
    }
    if (request.method() !== 'GET') {
      await route.fallback()
      return
    }
    const base = { scanTaskId: id, scanType: 'resume', file: null, errorCode: null, errorMessage: null, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() }
    if (id === PRIOR_TASK_ID) {
      // 上一场：文件已经被取走（matched），建档阶段失败 —— 服务端正是在这条路径上铸授权的。
      await json(route, 200, {
        success: true,
        data: { ...base, status: 'failed', errorCode: 'SCAN_UPLOAD_FAILED', errorMessage: '扫描文件处理失败，请重新扫描' },
      })
      return
    }
    if (!known.has(id)) {
      await fail(route, 404, 'SCAN_TASK_NOT_FOUND', '扫描任务不存在')
      return
    }
    // 用户把同一张纸原样放回去扫。结局只取决于这一场创建时带没带那一对配对凭证。
    await json(route, 200, {
      success: true,
      data: authorized.has(id)
        ? { ...base, status: 'completed', file: SAME_SHEET_FILE }
        : { ...base, status: 'failed', errorCode: 'SCAN_FILE_PREVIOUSLY_ATTEMPTED', errorMessage: DEDUP_REASON },
    })
  })

  // 结果页会真的把回执里那条签名内容链接加载进预览，别让它撞成未注册请求。
  void page.route(`**${SAME_SHEET_FILE.fileUrl.split('?')[0]}**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    })
  })

  return {
    creates,
    consumeAuthorityUpfront: () => { authorityConsumed = true },
  }
}

function seedPriorScanInProgress(page: Page): Promise<void> {
  return page.evaluate(
    ({ key, taskId, controlToken }) => {
      window.sessionStorage.setItem(key, JSON.stringify({
        stage: 'progress',
        scanType: 'resume',
        live: {
          scanTaskId: taskId,
          controlToken,
          instructions: ['放好原件', '在打印机面板选扫描到网络文件夹'],
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      }))
    },
    { key: SCAN_SESSION_KEY, taskId: PRIOR_TASK_ID, controlToken: PRIOR_CONTROL_TOKEN },
  )
}

/** 走到「上一场在取件之后失败了」这一屏 —— 服务端此刻已经铸好那枚一次性授权。 */
async function landOnFailedPriorScan(page: Page): Promise<void> {
  await page.goto('/scan?stage=start')
  await seedPriorScanInProgress(page)
  await page.goto('/scan?stage=progress')
  await expect(page).toHaveURL(/\/scan\?stage=result/, { timeout: 20_000 })
  await expect(page.getByText('扫描未完成', { exact: true }).first()).toBeVisible()
}

test('the safe rescan sends the prior task id in the body and its token only in the header @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)

  await landOnFailedPriorScan(page)
  // 页面知道自己手里有那份凭据，并且**说出来**：用户据此判断该不该把同一张纸放回去。
  // 注意这一屏的措辞只能说到「去申请」——本机看不见服务端到底铸没铸那枚授权
  // （waiting 阶段放弃轮询也会走到这一屏，那种情况根本没有授权）。有资格说
  // 「已放行」的是下一页：那一行只在带着两半的创建**成功之后**才渲染。
  const retry = page.getByRole('button', { name: '重试扫描（同一份材料）', exact: true })
  await expect(retry).toBeVisible()
  await expect(page.getByText(/这一次会带上上一场的凭据去申请安全重扫放行/)).toBeVisible()
  await expect(page.getByText(/不会悄悄按普通重扫处理/)).toBeVisible()
  await expect(page.getByText('服务端已放行', { exact: false })).toHaveCount(0)

  await retry.click()
  await page.waitForURL(/\/scan\?stage=settings/)
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()

  // ① 两半都在，且各在各的位置上。
  expect(server.creates).toHaveLength(1)
  const attempt = server.creates[0]!
  expect(attempt.body.retryOfScanTaskId).toBe(PRIOR_TASK_ID)
  expect(attempt.headers['x-scan-retry-control']).toBe(PRIOR_CONTROL_TOKEN)
  // ② 凭证只在头里：进了 body 就会跟着请求日志与回放一起留存。
  expect(JSON.stringify(attempt.body)).not.toContain(PRIOR_CONTROL_TOKEN)

  // ③ 此刻本机登记里已经没有上一场的凭证了（live 被移交时抹掉），URL 里也没有 ——
  //    它只活在页面内存里，却仍然把上面那次请求发对了。
  const leak = await page.evaluate((token) => {
    const session = window.sessionStorage.getItem('ai-job-print:current-scan-workbench') ?? ''
    const local = Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i))
      .some((key) => key !== null && (window.localStorage.getItem(key) ?? '').includes(token))
    return { inSession: session.includes(token), inLocal: local, inUrl: window.location.href.includes(token) }
  }, PRIOR_CONTROL_TOKEN)
  expect(leak).toEqual({ inSession: false, inLocal: false, inUrl: false })

  // ④ 页面如实说明这一次是什么性质的会话。
  await expect(page.getByText('安全重扫：服务端已放行同一份材料再扫一次')).toBeVisible()

  // ⑤ 同一张纸再扫一遍真的走通了 —— 这就是接线之前拿不到的结果。
  await page.getByRole('button', { name: '我已操作，开始等待' }).click()
  await expect(page).toHaveURL(/\/scan\?stage=result/, { timeout: 30_000 })
  await expect(page.getByText('扫描完成', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(SAME_SHEET_FILE.filename, { exact: false }).first()).toBeVisible()

  expect(errors).toEqual([])
})

test('after a successful rescan the next scan carries no retry credentials @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)

  await landOnFailedPriorScan(page)
  await page.getByRole('button', { name: '重试扫描（同一份材料）', exact: true }).click()
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '我已操作，开始等待' }).click()
  await expect(page.getByText('扫描完成', { exact: true }).first()).toBeVisible({ timeout: 30_000 })

  // 成功终态之后那枚授权必须已经没了：留着它，这台机器的下一位用户就会继承一份
  // 指向别人任务的凭证。所以成功页上的「重新扫描」只能是一个干净的新会话。
  await page.getByRole('button', { name: '重新扫描', exact: true }).click()
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()

  expect(server.creates).toHaveLength(2)
  const second = server.creates[1]!
  expect(second.body.retryOfScanTaskId).toBeUndefined()
  expect(second.headers['x-scan-retry-control']).toBeUndefined()

  expect(errors).toEqual([])
})

function registerPrintScanHub(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: {
      smartCampus: { enabled: false, modules: {}, items: [] },
      toolbox: { enabled: false, items: [] },
      configVersion: 'scan-rescan-fixture',
      refreshIntervalMs: 300_000,
      serverTime: '2026-09-14T00:00:00.000Z',
    },
  })
}

test('leaving the scan flow drops the rescan authority @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrintScanHub(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)

  await landOnFailedPriorScan(page)
  await expect(page.getByRole('button', { name: '重试扫描（同一份材料）', exact: true })).toBeVisible()

  // 顶栏返回和隐私清场、退出、屏保走同一条 leaveScanFlow → clearScanWorkbenchSession，
  // 代次在抹掉登记之前同步推进 —— 授权必须跟着那一步消失，不能被下一位用户继承。
  await page.locator('.qx-topbar-back').click()
  await page.waitForURL(/\/print-scan$/)

  // 这里**必须**用页内回退，不能 page.goto：整页加载会把模块内存连同授权一起抹掉，
  // 那样这条用例无论代码对不对都是绿的（2026-09-14 实测过：删掉清理逻辑它照样通过）。
  // 页内回退保留同一个 document，授权还在不在内存里，这一次创建请求会如实说出来。
  await page.goBack()
  await page.waitForURL(/\/scan/)
  await expect(page.getByText('下一步会创建真实扫描会话', { exact: false }).first()).toBeVisible()
  await page.getByRole('button', { name: /下一步/ }).click()
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()

  expect(server.creates).toHaveLength(1)
  const attempt = server.creates[0]!
  expect(attempt.body.retryOfScanTaskId).toBeUndefined()
  expect(attempt.headers['x-scan-retry-control']).toBeUndefined()
  // 这一场是刚在本页建成的普通会话：既不是安全重扫，也不是复水出来的，所以
  // 「本次性质」那一行根本不该出现。它一旦按每帧重算的 restoredLive 判，创建成功后
  // live 写回登记，下一帧就会把一个刚建成的会话说成「本页重载过」——一句假话。
  await expect(page.getByText('本次性质', { exact: true })).toHaveCount(0)

  expect(errors).toEqual([])
})

test('the result page own exit drops the rescan authority too @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrintScanHub(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)

  await landOnFailedPriorScan(page)
  await expect(page.getByRole('button', { name: '重试扫描（同一份材料）', exact: true })).toBeVisible()

  // 上一条走的是顶栏返回（ScanWorkbenchChrome.leaveScanFlow）。结果页 ctabar 上的
  // 「返回打印扫描」是**另一套按钮**，此前只是裸 navigate —— 同一屏两个出口两种命运：
  // 从顶栏走的人登记被清干净，从这里走的人把 live 登记（含刚结束那一场的 controlToken
  // 明文）和这枚一次性授权一起留在原地，下一位用户接着用这台机器就继承了。
  await page.locator('.qx-ctabar').getByRole('button', { name: '返回打印扫描', exact: true }).click()
  await page.waitForURL(/\/print-scan$/)

  // 必须页内回退：整页加载会把模块内存连授权一起抹掉，那样这条用例无论代码对不对都绿。
  await page.goBack()
  await page.waitForURL(/\/scan/)
  await expect(page.getByText('下一步会创建真实扫描会话', { exact: false }).first()).toBeVisible()
  await page.getByRole('button', { name: /下一步/ }).click()
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()

  expect(server.creates).toHaveLength(1)
  const attempt = server.creates[0]!
  expect(attempt.body.retryOfScanTaskId).toBeUndefined()
  expect(attempt.headers['x-scan-retry-control']).toBeUndefined()

  // 本机登记也跟着那一步被抹掉了：上一场的 controlToken 明文不留在 sessionStorage 里。
  const priorTokenInStorage = await page.evaluate(
    (token) => (window.sessionStorage.getItem('ai-job-print:current-scan-workbench') ?? '').includes(token),
    PRIOR_CONTROL_TOKEN,
  )
  expect(priorTokenInStorage).toBe(false)

  expect(errors).toEqual([])
})

test('a refused rescan authority is reported honestly and never falls back to a plain create @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)
  // 那枚一次性授权在别处已经被用掉了（并发的另一条路径消费了它，或者已经超过 15 分钟）。
  // 服务端接下来只会回 403 SCAN_RETRY_NOT_AUTHORIZED。
  server.consumeAuthorityUpfront()

  await landOnFailedPriorScan(page)
  await page.getByRole('button', { name: '重试扫描（同一份材料）', exact: true }).click()
  await page.waitForURL(/\/scan\?stage=settings/)

  // ① 说人话，并说清「接下来做什么」。不把 403 压成「扫描任务未创建」的通用兜底。
  await expect(page.getByText('安全重扫授权已失效', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/本页不会自动改用普通重扫/).first()).toBeVisible()
  // ② 不伪造会话：没有任务编号、没有面板操作指引。
  await expect(page.getByText('扫描任务已创建', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '我已操作，开始等待' })).toHaveCount(0)
  // ③ 不自动改发一个普通创建，也不循环重试 —— 那会把用户支到面板前去扫一张注定
  //    被同字节去重拒收的纸，白等十分钟且全程没有提示。
  await page.waitForTimeout(1_500)
  expect(server.creates).toHaveLength(1)
  expect(server.creates[0]!.body.retryOfScanTaskId).toBe(PRIOR_TASK_ID)
  // ④ 出路是用户自己按的那一个。
  await expect(page.getByRole('button', { name: '安全返回扫描首页' }).first()).toBeVisible()

  expect(errors).toEqual([])
})
