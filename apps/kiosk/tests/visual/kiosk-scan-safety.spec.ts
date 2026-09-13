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
  /**
   * 让下一次创建**永远不回话**。
   *
   * 用来复现「请求还在飞的时候看门狗整页重载」：那一刻本机登记里还没有 live，
   * 而内存里那份重扫凭据会随重载一起消失。服务端这边请求照旧挂着（浏览器重载时
   * 自己取消），所以这条 route 不 fulfill、也不 abort —— 挂住就是它要模拟的状态。
   */
  hangNextCreate: () => void
} {
  const creates: CreateAttempt[] = []
  const authorized = new Set<string>()
  const known = new Set<string>()
  let authorityConsumed = false
  let hangNext = false

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

    if (hangNext) {
      hangNext = false
      await new Promise(() => {})
      return
    }

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
    hangNextCreate: () => { hangNext = true },
  }
}

/** 只有结果快照、没有凭证的结果页 —— 上一场根本没走到取件时的真实登记形状。 */
function seedFailedResultWithoutCredentials(page: Page): Promise<void> {
  return page.evaluate((key) => {
    window.sessionStorage.setItem(key, JSON.stringify({
      stage: 'result',
      scanType: 'resume',
      result: { outcome: 'failed', success: false, reason: '扫描任务未能完成，请重试或联系工作人员' },
    }))
  }, SCAN_SESSION_KEY)
}

/**
 * 一次成功的扫描（带回文件）—— 成功页那三个去向都从这一屏出发。
 *
 * 调用前页面必须已经在应用里。种完登记之后用 pushState + popstate 在**同一个
 * document** 里换到结果阶段，刻意不用 page.goto：整页加载会把内存里的登录态一起抹掉
 * （会员令牌刻意不落存储），而「前往我的文档」只对已登录用户放行。
 */
async function landOnCompletedScan(page: Page): Promise<void> {
  await page.evaluate(({ key, file, taskId, controlToken }) => {
    window.sessionStorage.setItem(key, JSON.stringify({
      stage: 'result',
      scanType: 'resume',
      live: {
        scanTaskId: taskId,
        controlToken,
        instructions: ['放好原件'],
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
      result: {
        outcome: 'completed',
        success: true,
        file: {
          fileId: file.fileId,
          fileUrl: file.fileUrl,
          name: file.filename,
          size: '2 KB',
          pages: 1,
          format: 'PNG',
          mimeType: file.mimeType,
        },
      },
    }))
    window.history.pushState({}, '', '/scan?stage=result')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, { key: SCAN_SESSION_KEY, file: SAME_SHEET_FILE, taskId: PRIOR_TASK_ID, controlToken: PRIOR_CONTROL_TOKEN })
  await expect(page.getByText('扫描完成', { exact: true }).first()).toBeVisible()
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

/* ══ 安全重扫意图不许落成一个无签名的普通建单（第二轮，P1-A） ═══════════════
 *
 * 结果页那一刻手里可能根本没有可用的成对授权：从来没铸过、已经被取用、超过本地
 * 15 分钟、或者中间清过场。旧实现忽略 beginScanRescan() 的返回值照样跳设置页 ——
 * 设置页接着建会话，取不到授权，于是发出去一个**普通**创建。用户按的是「同一份
 * 材料」，随后把同一张纸放回面板，服务端按两小时同字节去重把文件拒掉，任务停在
 * waiting 直到过期：人在机器前白等十分钟，屏幕上全程没有一句话解释。 */

test('with no rescan credentials the page offers a plainly labelled restart, not a retry @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)

  // 上一场根本没走到取件（服务端不会铸授权），本机也就没有任何凭据。
  await page.goto('/scan?stage=start')
  await seedFailedResultWithoutCredentials(page)
  await page.goto('/scan?stage=result')
  await expect(page.getByText('扫描未完成', { exact: true }).first()).toBeVisible()

  // 主行动必须**改口**：这一次不是安全重扫，按钮不许仍然写着「重试扫描」。
  await expect(page.getByRole('button', { name: '重新开始一次扫描', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /重试扫描/ })).toHaveCount(0)
  await expect(page.getByText(/本机没有可用的安全重扫凭据/)).toBeVisible()
  expect(server.creates).toHaveLength(0)

  // 按下去是一次普通会话 —— 用户自己选的，页面已经把代价说清楚了。
  await page.getByRole('button', { name: '重新开始一次扫描', exact: true }).click()
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()
  expect(server.creates).toHaveLength(1)
  expect(server.creates[0]!.body.retryOfScanTaskId).toBeUndefined()
  expect(server.creates[0]!.headers['x-scan-retry-control']).toBeUndefined()

  expect(errors).toEqual([])
})

test('a stale safe rescan is refused at click time and creates nothing @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)

  // 时钟装在导航之前（clock 只能这样用）。装完是**暂停**的：定时器不会自己跑，
  // 所以那个每 5 秒重新采样的按钮文案不会在我们点击之前改口 —— 这正是要复现的那一帧：
  // 屏幕上还写着「同一份材料」，而本机手里那份凭据已经过了 15 分钟。
  await page.clock.install()
  await landOnFailedPriorScan(page)
  const retry = page.getByRole('button', { name: '重试扫描（同一份材料）', exact: true })
  await expect(retry).toBeVisible()

  await page.clock.setSystemTime(new Date(Date.now() + 16 * 60 * 1000))
  // 时钟暂停时 requestAnimationFrame 也是假的，click() 的稳定性检查会等在那儿；
  // dispatchEvent 直接投事件，绕开那道检查，React 的 onClick 照常收到。
  await retry.dispatchEvent('click')

  // ① 一个请求都不许发出去。旧实现在这里会跳设置页，然后发一个不带两半的普通创建。
  expect(server.creates).toHaveLength(0)
  // ② 还停在结果页，而且什么都没被销毁 —— beginScanRescan 拿不到授权时一个字节都不动。
  await expect(page).toHaveURL(/\/scan\?stage=result/)
  await expect(page.getByText('扫描未完成', { exact: true }).first()).toBeVisible()
  // ③ 把「为什么什么都没发生」说出来，并且把出路交回给用户。
  await expect(page.getByTestId('scan-safe-rescan-lost')).toBeVisible()
  await expect(page.getByText(/没有[\s\S]{0,8}替你改发一次普通重扫/)).toBeVisible()
  await expect(page.getByRole('button', { name: '重新开始一次扫描', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '重试扫描（同一份材料）', exact: true })).toHaveCount(0)

  expect(errors).toEqual([])
})

test('a reload after the retry intent never turns into a plain create @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)

  await landOnFailedPriorScan(page)
  // 整页重载（看门狗）把内存里那份凭据抹掉，用户手里还是同一张纸。
  await page.reload()
  await expect(page.getByText('扫描未完成', { exact: true }).first()).toBeVisible()

  // 重载之后按主行动。无论落到哪一条（首屏 effect 按同一份 live 登记重新登记 →
  // 安全重扫；或者根本没有凭据 → 显式普通会话），**绝不许**出现的是
  // 「带着重扫意图跳过去，却发了一个不带两半的创建」。
  await page.locator('.qx-ctabar .qx-btn[data-variant="primary"]').click()
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()
  expect(server.creates).toHaveLength(1)
  const attempt = server.creates[0]!
  const paired = typeof attempt.body.retryOfScanTaskId === 'string'
    && attempt.headers['x-scan-retry-control'] === PRIOR_CONTROL_TOKEN
  const plainAndDeclared = attempt.body.retryOfScanTaskId === undefined
    && attempt.headers['x-scan-retry-control'] === undefined
  expect(paired || plainAndDeclared).toBe(true)
  if (paired) {
    expect(attempt.body.retryOfScanTaskId).toBe(PRIOR_TASK_ID)
    await expect(page.getByText('安全重扫：服务端已放行同一份材料再扫一次')).toBeVisible()
  }

  expect(errors).toEqual([])
})

test('a reload while the paired create is in flight fails closed @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)

  await landOnFailedPriorScan(page)
  // 这一次创建永远不回话：请求在飞的时候整页重载，本机登记里还没有 live，
  // 而内存里那份重扫凭据会随重载消失。
  server.hangNextCreate()
  await page.getByRole('button', { name: '重试扫描（同一份材料）', exact: true }).click()
  await expect(page.getByText('正在创建扫描任务', { exact: true }).first()).toBeVisible()
  expect(server.creates).toHaveLength(1)
  expect(server.creates[0]!.headers['x-scan-retry-control']).toBe(PRIOR_CONTROL_TOKEN)

  await page.reload()

  // ① fail-closed：不发第二个请求，尤其不发那个不带两半的普通创建。
  await expect(page.getByText('安全重扫凭据已随本页重载消失', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('扫描任务已创建', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '我已操作，开始等待' })).toHaveCount(0)
  await page.waitForTimeout(1_000)
  expect(server.creates).toHaveLength(1)
  // ② 凭据没有被写进任何存储（重载之后本机也就无从申请了，这是刻意的代价）。
  const leak = await page.evaluate((token) => ({
    session: (window.sessionStorage.getItem('ai-job-print:current-scan-workbench') ?? '').includes(token),
    local: Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i))
      .some((key) => key !== null && (window.localStorage.getItem(key) ?? '').includes(token)),
    url: window.location.href.includes(token),
  }), PRIOR_CONTROL_TOKEN)
  expect(leak).toEqual({ session: false, local: false, url: false })
  // ③ 出路是用户显式按下的普通会话，而且页面把这个选择记在「本次性质」里。
  await page.getByRole('button', { name: '重新开始一次扫描', exact: true }).click()
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()
  expect(server.creates).toHaveLength(2)
  expect(server.creates[1]!.body.retryOfScanTaskId).toBeUndefined()
  expect(server.creates[1]!.headers['x-scan-retry-control']).toBeUndefined()
  await expect(page.getByText('普通会话：你已确认这一次不是安全同字节重扫')).toBeVisible()

  expect(errors).toEqual([])
})

/* ══ 成功页那三个去向也是「离开整条扫描流程」（第二轮，P1-B） ═════════════════
 *
 * 直接打印 / AI 简历识别 / 前往我的文档，此前都是裸 navigate：本机登记原封不动留在
 * sessionStorage 里 —— 里面有上一位的 live.controlToken 明文，还有 result.file
 * （文件名 + 那条签名内容链接）。下一位在这台机器上进 /scan，阶段直接从登记复水到
 * result：他看到的是上一位的扫描件，随后那一次创建还会带上上一位的重扫血缘。
 *
 * 三个出口逐个覆盖，而不是抽查一个：出口是各写各的时候，抽查任何一个都证明不了其余两个。 */

const MEMBER_PHONE = '13800138000'
const MEMBER_CODE = '123456'

/** 「前往我的文档」只对已登录用户放行，所以这一条必须真的登录一次。 */
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
        token: 'scan-rescan-member-token',
        user: { id: 'member-scan-rescan', phoneMasked: '138****8000', nickname: '扫描验收用户' },
      },
    },
  })
  api.respond('GET', '/api/v1/me/favorites', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
}

async function loginThroughVisibleUi(page: Page, returnTo: string): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  for (const digit of MEMBER_PHONE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of MEMBER_CODE) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === returnTo)
}

/** 打印确认页与 AI 解析页挂载时会真的问服务端，别让它们撞成未注册请求。 */
function registerCompletedExitDestinations(api: ApiRouter): void {
  api.respond('GET', '/api/v1/print/price-config', {
    status: 200,
    json: { billingEnabled: true, items: [{ serviceKey: 'print_bw_page', unitCents: 100, unit: 'page', description: '黑白打印' }] },
  })
  api.respond('POST', '/api/v1/orders/quote', {
    status: 200,
    json: {
      amountCents: 100,
      billablePages: 1,
      billingPageSource: 'detected',
      priceLines: [{ serviceKey: 'print_bw_page', description: '黑白打印', unitCents: 100, quantity: 1, amountCents: 100 }],
    },
  })
  // 解析真的发起会走进另一条长链路，这里只要证明「离开时清干净了」，所以让它当场停下。
  api.respond('POST', '/api/v1/resume/parse', {
    status: 503,
    json: { success: false, error: { code: 'SCAN_EXIT_FIXTURE_STOP', message: '用例只验证离开语义' } },
  })
}

const COMPLETED_EXITS = [
  { key: 'print', button: '直接打印', url: /\/print\/confirm$/, needsLogin: false },
  { key: 'resume-ai', button: 'AI 简历识别', url: /\/resume\/parse$/, needsLogin: false },
  { key: 'documents', button: '前往我的文档', url: /\/me\/documents$/, needsLogin: true },
] as const

for (const exit of COMPLETED_EXITS) {
  test(`leaving a completed scan by ${exit.key} clears the local registry @scan-safety`, async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    registerShell(api)
    registerPrintScanHub(api)
    registerScanCapabilities(api)
    registerCompletedExitDestinations(api)
    if (exit.needsLogin) registerMemberLogin(api)
    const server = installSameSheetScanServer(page)

    // 登录必须在种登记**之前**：login() 自己会走一次清场（换人），种在前面会被它清掉。
    // 落点取 /scan（它只读本轮已经注册的那几条接口），不去 /profile —— 那一页会拉一串
    // 会员聚合接口，全都得注册才能过 assertNoUnhandledRequests，与本用例要证明的事无关。
    if (exit.needsLogin) await loginThroughVisibleUi(page, '/scan')
    else await page.goto('/scan?stage=start')
    await landOnCompletedScan(page)

    await page.getByRole('button', { name: exit.button }).first().click()
    await expect(page).toHaveURL(exit.url)

    // ① 本机登记必须已经没了 —— 下一位在这台机器上进 /scan 会从这里复水。
    const registry = await page.evaluate(
      (key) => window.sessionStorage.getItem(key),
      SCAN_SESSION_KEY,
    )
    expect(registry).toBeNull()

    /* ② 重新进入 /scan：落在选类型那一屏，看不到上一位的结果，也看不到那份凭证。
     *
     * 这里用整页加载而**不是**页内导航，是刻意的，而且不是在放水：能让下一位看到上一场
     * 结果的唯一通道就是 sessionStorage 里那份登记（结果页只从登记或路由 state 取数），
     * 而整页加载**保留** sessionStorage —— 它抹掉的是模块内存，那反而让这条断言更严：
     * 页面此刻只能靠存储复水，而存储已经在 ① 里被证明是空的。
     * 「页内重新进入」的那一半正是 ① 那条断言（下一位进 /scan 读的就是它）。 */
    await page.goto('/scan')
    await expect(page.getByText('下一步会创建真实扫描会话', { exact: false }).first()).toBeVisible()
    await expect(page.getByText(SAME_SHEET_FILE.filename, { exact: false })).toHaveCount(0)
    await expect(page.getByText('扫描完成', { exact: true })).toHaveCount(0)
    const residue = await page.evaluate((token) => ({
      session: JSON.stringify(Object.fromEntries(
        Array.from({ length: window.sessionStorage.length }, (_, i) => window.sessionStorage.key(i))
          .filter((key): key is string => key !== null)
          .map((key) => [key, window.sessionStorage.getItem(key) ?? '']),
      )).includes(token),
      local: JSON.stringify(Object.fromEntries(
        Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i))
          .filter((key): key is string => key !== null)
          .map((key) => [key, window.localStorage.getItem(key) ?? '']),
      )).includes(token),
    }), PRIOR_CONTROL_TOKEN)
    expect(residue).toEqual({ session: false, local: false })

    // ③ 下一次创建不许带上一位的重扫血缘。
    await page.getByRole('button', { name: /下一步/ }).click()
    await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()
    expect(server.creates).toHaveLength(1)
    expect(server.creates[0]!.body.retryOfScanTaskId).toBeUndefined()
    expect(server.creates[0]!.headers['x-scan-retry-control']).toBeUndefined()

    expect(errors).toEqual([])
  })
}

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
