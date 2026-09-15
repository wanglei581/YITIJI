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
  /**
   * 让下一次创建以一个「证明不了服务端消费过那枚授权」的失败收场。
   *
   * 这类失败在真实服务端上全部发生在消费之前：限流（`@Throttle` 12 次/分）与终端态
   * 检查在 `$transaction` 之前就抛，`SCAN_TERMINAL_BUSY` 是事务里的唯一索引冲突导致
   * **整个事务回滚**，断网则请求根本没落地。也就是说这一刻服务端那枚授权原封没动，
   * 只有本机那一份被取走了 —— 它必须能被原样放回。
   *
   * `kind: 'offline'` 走 `route.abort()`：浏览器侧是 TypeError，页面据此判
   * outcomeUnknown（「服务端可能已经收到，结果未知」），和 HTTP 错误不是同一条分支。
   */
  failNextCreate: (failure: { kind: 'offline' } | { status: number; code: string; message: string }) => void
  /**
   * 让下一次配对创建**真的把 child 建出来**，然后把回话丢掉。
   *
   * 这是 P1 本体：服务端提交成功（一条 child 挂在这台终端上 waiting 等文件），
   * 浏览器却只收到一个 TypeError。本机既不知道 child 的 id 也不知道它的 controlToken，
   * 于是屏幕上什么都没有，而那条 waiting 会去接下一位用户的面板扫描。
   *
   * 和 `failNextCreate({kind:'offline'})` 的区别正是这条用例的全部要点：那一条是
   * 「请求根本没落地」，这一条是「落地了、回话丢了」。浏览器侧两者一模一样。
   */
  dropNextCreateResponse: () => void
  /**
   * 让那条已经提交的 child 变成不可恢复（过期 / 被撤 / 已完成）。
   * 服务端此后对同一枚授权回 409 `SCAN_RETRY_CHILD_NOT_RECOVERABLE`，且不开 grandchild。
   */
  makeChildUnrecoverable: () => void
  /** 服务端侧真实存在的 child 任务 id（按创建顺序）。断言「只建了一条」用。 */
  childIds: () => string[]
  /** **生效过**的 DELETE 对应的 scanTaskId。断言「领回来的 child 被撤掉了」用。 */
  deleted: () => string[]
  /**
   * 浏览器**发出过**的每一次 DELETE，含在路上丢掉的那些（按发生顺序，可重复）。
   *
   * 和 {@link deleted} 分开，是因为这两件事在「撤销丢了」那条路径上必须分得开：
   * 前者是「本机确实又发了一次」，后者是「服务端那条任务真的没了」。
   * 混成一个数组，补偿用例就只能证明其中一件。
   */
  deleteAttempts: () => string[]
  /** 让下一次 DELETE 在路上丢掉：服务端从未收到，那条任务原地不动。 */
  dropNextDelete: () => void
  /** 已经收到投递确认（ACK）的 scanTaskId。没在这里面的任务对 Agent 不可见。 */
  acked: () => string[]
  /** 让下一次投递确认**永远不回话**：用来把页面钉在「正在确认投递授权」那一屏上。 */
  hangNextAck: () => void
  /**
   * 让下一次投递确认**挂住，直到用例放行**；放行之后它照常处理（会真的确认成功）。
   *
   * 和 {@link hangNextAck} 的区别正是那条补偿用例的全部要点：hang 住不回话时
   * 服务端那条任务永远不会变得可投递，怎么写都是安全的；而真实的危险场景是
   * 「用户走了，那次确认**随后成功了**」—— 只有放得开的挂起才模拟得出来。
   */
  holdNextAck: () => void
  /** 放行被 {@link holdNextAck} 挂住的那一次确认。 */
  releaseHeldAck: () => void
  /**
   * 模拟一次 **Agent** 的 `GET /terminals/:id/scan-tasks/current-lease`。
   *
   * 这是整条链路上唯一能回答「面板上扫出来的文件会被投给谁」的地方。
   * 服务端只把**已确认且仍在 waiting** 的任务签成租约；没确认的行在这里根本看不见
   * （scan-tasks.service.ts 的 `deliveryAckedAt: { not: null }`）。
   *
   * 刻意走页面里的 fetch 而不是 `page.request`：`page.request` 不经过 `page.route`，
   * 那样问到的就不是上面这份服务端模型，断言等于白做。
   */
  currentLease: () => Promise<{ status: number; code?: string; scanTaskId?: string }>
} {
  const creates: CreateAttempt[] = []
  const authorized = new Set<string>()
  const known = new Set<string>()
  const children: string[] = []
  const deleted: string[] = []
  /** 浏览器发出过的每一次 DELETE（含丢掉的）。补偿用例要数「第二次发了没有」。 */
  const deleteAttempts: string[] = []
  let dropNextDeleteRequest = false
  /**
   * 每条任务的 controlToken。ACK 要按它验身份（服务端比对 controlTokenHash）。
   * 上一场那条预置进去：它走到过 matched（文件已经被取走），而只有**确认过**的任务
   * 才可能被 Agent 租走并投递 —— 所以「上一场早就确认过」是这份模型唯一诚实的写法。
   */
  const controlTokens = new Map<string, string>([[PRIOR_TASK_ID, PRIOR_CONTROL_TOKEN]])
  const acked = new Set<string>([PRIOR_TASK_ID])
  let hangNextAckResponse = false
  /**
   * 被 `holdNextAck()` 挂起的那一次确认的闸门。
   *
   * promise 在 **`holdNextAck()` 那一刻**就建好，不是等路由跑到才建。
   * 差别只在一种顺序上：`releaseHeldAck()` 赶在确认请求到达之前调用时 ——
   *   · 把 resolve 留到路由里再赋值的写法，这一次放行会落到那个空的默认函数上，
   *     被**静默丢掉**（当前这条用例仍然会过，因为后面还有一次真正的放行；
   *     但用例一改动顺序，丢掉的那一次就变成一次挂到超时的偶发失败）；
   *   · 先建后用的写法，闸门已经是开的，请求到了直接穿过去。
   * 也就是说这份夹具的行为不再取决于「页面什么时候把那个请求发出来」——
   * 而那件事恰恰不由用例控制。
   */
  let heldAckGate: Promise<void> | null = null
  let releaseHeldAckGate: () => void = () => undefined
  let authorityConsumed = false
  let hangNext = false
  let dropNextResponse = false
  /**
   * 那枚授权被消费之后，服务端记下它生出来的那条 child。
   *
   * 配对创建的幂等就靠它：同一对凭据再来一次，回的是**同一条**（id 不变、
   * controlToken 就是上一场那份明文），而不是 403，也不是第二条 child。
   * 这份模型逐条对着 scan-tasks.service.ts 的 recoverRetryChildIfPresent 写。
   */
  let retryChild: { id: string; instructions: string[]; expiresAt: string } | null = null
  /** child 已经不在 waiting/matched（过期 / 被撤 / 已完成）：回 409，且不许再开 grandchild。 */
  let childRecoverable = true
  let failNext: { kind: 'offline' } | { status: number; code: string; message: string } | null = null

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

    /* 这一支刻意排在任何重扫判定**之前**：真实服务端上这类失败也发生在消费之前，
     * 所以这里绝不能顺手把 authorityConsumed 立起来 —— 立了就等于在断言
     * 「服务端已经用掉它」，而那正是这条用例要证伪的前提。 */
    if (failNext) {
      const failure = failNext
      failNext = null
      if ('kind' in failure) await route.abort('connectionfailed')
      else await fail(route, failure.status, failure.code, failure.message)
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
      /* 身份不对一律 403，且**不泄露 child 存不存在** —— 和服务端
       * assertRetryIdentity 同一口径：先验身份，再谈恢复。 */
      if (!pairOk) {
        await fail(route, 403, 'SCAN_RETRY_NOT_AUTHORIZED', '重扫授权无效、已过期或已使用')
        return
      }
      /* 幂等重放：授权已经被消费、child 也还在 → 把**同一条**原样交回来。
       * 这是 2026-09-14 的服务端契约，也是本机重放之所以安全的全部依据：
       * 它不是「再建一个」，而是「把刚才那个领回来」。 */
      if (authorityConsumed && retryChild) {
        if (!childRecoverable) {
          await fail(route, 409, 'SCAN_RETRY_CHILD_NOT_RECOVERABLE', '该重扫会话已不可恢复，请重新发起扫描')
          return
        }
        await json(route, 200, {
          success: true,
          data: {
            scanTaskId: retryChild.id,
            // child 的 controlToken 就是上一场那份明文（服务端不新铸、不落明文）。
            controlToken: PRIOR_CONTROL_TOKEN,
            instructions: retryChild.instructions,
            expiresAt: retryChild.expiresAt,
          },
        })
        return
      }
      if (authorityConsumed) {
        await fail(route, 403, 'SCAN_RETRY_NOT_AUTHORIZED', '重扫授权无效、已过期或已使用')
        return
      }
      authorityConsumed = true
    }

    const id = `scan-rescan-${creates.length}`
    known.add(id)
    children.push(id)
    const instructions = ['放好原件', '在打印机面板选扫描到网络文件夹']
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    // child 的 controlToken 就是上一场那份明文（幂等重放靠的就是这一点）；
    // 普通创建则各发各的。ACK 按这一份验身份。
    controlTokens.set(id, retryId ? PRIOR_CONTROL_TOKEN : `session-control-${creates.length}`)
    if (retryId) {
      authorized.add(id)
      retryChild = { id, instructions, expiresAt }
    }
    /* 提交成功之后才丢回话 —— 顺序就是 P1 的形状：服务端这边 child 已经落地并开始
     * 等文件，客户端那边只看到一个 TypeError。放在提交之前 abort 就成了
     * failNextCreate('offline')，测的是另一件事。 */
    if (dropNextResponse) {
      dropNextResponse = false
      await route.abort('connectionfailed')
      return
    }
    await json(route, 200, {
      success: true,
      data: {
        scanTaskId: id,
        controlToken: retryId ? PRIOR_CONTROL_TOKEN : `session-control-${creates.length}`,
        instructions,
        expiresAt,
      },
    })
  })

  void page.route('**/api/v1/scan/sessions/*', async (route) => {
    const request = route.request()
    const id = new URL(request.url()).pathname.split('/').pop() ?? ''
    if (request.method() === 'DELETE') {
      deleteAttempts.push(id)
      /* 在途丢失：浏览器确实发了，服务端从未收到 —— 那条任务原地不动，
       * 而本机永远不会知道（撤销是 fire-and-forget，回执一律吞掉）。
       * 这正是 keepalive 请求随文档拆卸被掐断 / 网络抖动时的真实形状。 */
      if (dropNextDeleteRequest) {
        dropNextDeleteRequest = false
        await route.abort('connectionfailed')
        return
      }
      deleted.push(id)
      // 撤掉的 child 随即不可恢复：服务端此后对同一枚授权回 409，不会再开 grandchild。
      if (retryChild && retryChild.id === id) childRecoverable = false
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

  /* 投递确认。注册在 `sessions/*` **之后**（Playwright 后注册的先匹配），
   * 所以 `/scan/sessions/:id/ack` 永远落在这里，不会被上面那条状态/取消路由接走。
   *
   * 逐条对着 scan-tasks.service.ts 的 ack() 写：
   *   · 没有终端身份 → 401（服务端那边是 TerminalIdentityGuard + x-terminal-id 校验）；
   *   · controlToken 对不上 → 403（assertTaskReadAccess）；
   *   · 任务不存在 → 404；
   *   · **已经确认过 → 原样回那一刻的时间戳**（幂等，而且这一条排在状态检查之前 ——
   *     所以一条确认过的任务即使后来失败 / 过期，再确认仍然是 200）；
   *   · 已被撤销 / 已终态 → 409 SCAN_TASK_ACK_NOT_ALLOWED。 */
  void page.route('**/api/v1/scan/sessions/*/ack', async (route) => {
    const request = route.request()
    if (request.method() !== 'POST') {
      await route.fallback()
      return
    }
    if (hangNextAckResponse) {
      hangNextAckResponse = false
      await new Promise(() => {})
      return
    }
    /* 挂住但放得开：用例放行之后这一次照常往下走，于是它**真的会确认成功**。
     * 「用户已经走了，而那次确认随后成功了」只有这样才模拟得出来。 */
    if (heldAckGate) {
      const gate = heldAckGate
      heldAckGate = null
      await gate
    }
    const segments = new URL(request.url()).pathname.split('/')
    const id = segments[segments.length - 2] ?? ''
    const headers = request.headers()
    if (!headers['x-terminal-id'] || !headers['x-terminal-session-token']) {
      await fail(route, 401, 'TERMINAL_SESSION_INVALID', '终端安全会话无效')
      return
    }
    if (!known.has(id) && id !== PRIOR_TASK_ID) {
      await fail(route, 404, 'SCAN_TASK_NOT_FOUND', '扫描任务不存在')
      return
    }
    if (headers['x-scan-session-control'] !== controlTokens.get(id)) {
      await fail(route, 403, 'SCAN_TASK_FORBIDDEN', '无权确认该扫描任务')
      return
    }
    if (acked.has(id)) {
      await json(route, 200, {
        success: true,
        data: { scanTaskId: id, deliveryAckedAt: '2026-09-14T00:00:00.000Z' },
      })
      return
    }
    if (deleted.includes(id)) {
      await fail(route, 409, 'SCAN_TASK_ACK_NOT_ALLOWED', '当前扫描任务状态不允许确认投递')
      return
    }
    acked.add(id)
    await json(route, 200, {
      success: true,
      data: { scanTaskId: id, deliveryAckedAt: new Date().toISOString() },
    })
  })

  /* Agent 那一侧的租约端点。这份模型只做一件事，但它是整条链路的判据：
   * **没确认的 waiting 行在这里看不见**。 */
  void page.route('**/api/v1/terminals/*/scan-tasks/current-lease', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    const leasable = children.find((id) => acked.has(id) && !deleted.includes(id))
    if (!leasable) {
      await fail(route, 409, 'NO_WAITING_SCAN_TASK', '没有匹配的等待中扫描任务')
      return
    }
    await json(route, 200, {
      success: true,
      data: { scanTaskId: leasable, deliveryLease: `lease-${leasable}` },
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
    failNextCreate: (failure) => { failNext = failure },
    dropNextCreateResponse: () => { dropNextResponse = true },
    makeChildUnrecoverable: () => { childRecoverable = false },
    childIds: () => [...children],
    deleted: () => [...deleted],
    deleteAttempts: () => [...deleteAttempts],
    dropNextDelete: () => { dropNextDeleteRequest = true },
    acked: () => [...acked],
    hangNextAck: () => { hangNextAckResponse = true },
    holdNextAck: () => {
      heldAckGate = new Promise<void>((resolve) => { releaseHeldAckGate = resolve })
    },
    releaseHeldAck: () => { releaseHeldAckGate() },
    currentLease: () => page.evaluate(async () => {
      const response = await fetch('/api/v1/terminals/KSK-001/scan-tasks/current-lease', {
        headers: { Accept: 'application/json' },
      })
      const payload = (await response.json()) as {
        data?: { scanTaskId?: string }
        error?: { code?: string }
      }
      return {
        status: response.status,
        code: payload.error?.code,
        scanTaskId: payload.data?.scanTaskId,
      }
    }),
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

  /* ③ 这个凭证不许散落到 localStorage / URL / 请求 body 里。
   *
   * 2026-09-14 口径修正：sessionStorage 这一格从「必须没有」改成「只许以**本场会话自己的
   * controlToken** 的身份出现，且只有那一处」。
   *
   * 变的不是前端，是服务端契约：配对创建现在把 child 的 controlToken **就设成上一场那份
   * 明文**（scan-tasks.service.ts：`controlToken = retryControlToken`，child 的
   * controlTokenHash 直接沿用 prior 的），这正是「丢了回话还能凭同一个头把 child 领回来」
   * 的实现方式。于是这串字节在创建成功之后就是这一场的会话凭证，而会话凭证本来就要写进
   * 登记（看门狗整页重载之后还要接着轮询同一场，见 scanWorkbenchSession）。
   *
   * 所以断言不能简单放宽成「随便出现在哪都行」——判据收紧成三条：
   *   · 只出现在 live.controlToken 这一个位置；
   *   · 整份登记里出现的次数恰好一次（别处再抄一份就是真的泄漏）；
   *   · localStorage / URL / body 仍然一个字节都没有。 */
  const leak = await page.evaluate((token) => {
    const raw = window.sessionStorage.getItem('ai-job-print:current-scan-workbench') ?? ''
    const parsed = JSON.parse(raw || '{}') as { live?: { controlToken?: string } }
    const local = Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i))
      .some((key) => key !== null && (window.localStorage.getItem(key) ?? '').includes(token))
    return {
      onlyAsLiveControlToken: parsed.live?.controlToken === token,
      occurrences: raw.split(token).length - 1,
      inLocal: local,
      inUrl: window.location.href.includes(token),
    }
  }, PRIOR_CONTROL_TOKEN)
  expect(leak).toEqual({ onlyAsLiveControlToken: true, occurrences: 1, inLocal: false, inUrl: false })

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

  /* 2026-09-14 收紧：这条断言原来接受「配对 或 明确声明的普通会话」两种结局。
   * 那个析取在当时是保守写法，但它让用例证明不了**实际**走的是哪一条 —— 而两条
   * 的代价完全不同（普通会话会让同一张纸撞上两小时的同字节去重）。
   *
   * 现在结局是确定的：结果页挂载时 `armIfPossible()` 按登记里那份 live
   * （PRIOR_TASK_ID + PRIOR_CONTROL_TOKEN，整页重载带不走的只是模块内存里那一份）
   * 重新登记授权，所以重载之后主行动必然是「重试扫描（同一份材料）」。
   * 按名字取按钮而不是按 `[data-variant="primary"]` 取：名字对不上就当场红，
   * 而不是顺手点到另一条分支再放行。
   *
   * 反向对照在上面那条「with no rescan credentials」用例里：登记里**没有** live 时
   * 同一段代码只给「重新开始一次扫描」。两条合起来才说明这里测到的是真东西。 */
  await page.getByRole('button', { name: '重试扫描（同一份材料）', exact: true }).click()
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()
  expect(server.creates).toHaveLength(1)
  const attempt = server.creates[0]!
  expect(attempt.body.retryOfScanTaskId).toBe(PRIOR_TASK_ID)
  expect(attempt.headers['x-scan-retry-control']).toBe(PRIOR_CONTROL_TOKEN)
  await expect(page.getByText('安全重扫：服务端已放行同一份材料再扫一次')).toBeVisible()

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
  await expect(page.getByText('安全重扫凭据已经不在本机', { exact: true }).first()).toBeVisible()
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

/* ══ 丢失响应：把「看不见的收件箱」收回来（第三轮，P1） ══════════════════════
 *
 * 第一次配对创建**提交成功了**（服务端一条 child waiting 挂在这台终端上等文件），
 * 而回话在路上丢了。浏览器侧只有一个 TypeError，本机既不知道 child 的 id，
 * 也不知道它的 controlToken。旧实现到此为止：屏幕上落到「无法确认扫描任务状态」，
 * 服务端那条 waiting 原地不动 —— 下一位走到面板前按下扫描，文件就投给了它。
 * 公共一体机上，这就是一个没有任何界面在看着的收件箱。
 *
 * 服务端 2026-09-14 把配对创建做成了幂等：同一对凭据再发一次拿回**同一条** child。
 * 所以本机对未知态的正确动作是重放同一对请求，把它领回来。
 *
 * 下面这组用例的服务端模型分得很清楚：`failNextCreate({kind:'offline'})` 是
 * 「请求根本没落地」，`dropNextCreateResponse()` 是「落地了、回话丢了」——
 * 浏览器侧两者一模一样，而后者正是这一轮要修的那一个。 */

test('a lost create response is recovered into exactly one live session @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)

  await landOnFailedPriorScan(page)
  // 这一次服务端**真的建出了 child**，然后把回话丢掉。
  server.dropNextCreateResponse()
  await page.getByRole('button', { name: '重试扫描（同一份材料）', exact: true }).click()

  // ① 等待屏必须改口。说「正在建扫描会话」在这一刻是假话：会话已经建成了，丢的是回话。
  await expect(page.getByTestId('scan-create-replay-notice')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('正在确认上一次请求').first()).toBeVisible()
  // 屏幕必须劝阻面板操作 —— 这一刻服务端那条 child 正等着收纸。
  // 取 testid 内部那一句：等待屏本来就另有一句「但先别在面板上按开始」，
  // 用宽正则会同时命中两处，断言就证明不了到底是哪一句在起作用。
  await expect(page.getByTestId('scan-create-replay-notice').getByText(/先别在面板上按开始/))
    .toBeVisible()

  // ② 重放把同一条 child 领了回来，页面据此落成**一个**真实会话。
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible({ timeout: 20_000 })

  // ③ 发了两次请求，但服务端只建了**一条** child。这是幂等契约的全部意义：
  //    重放不是「再建一个」，而是「把刚才那个领回来」。
  expect(server.creates).toHaveLength(2)
  expect(server.childIds()).toHaveLength(1)
  const childId = server.childIds()[0]!
  // ④ 两次都必须是成对的。任何一次退化成无签名的普通创建，同一张纸就会撞上
  //    服务端两小时的同字节去重 —— 那正是这整条链路存在的理由。
  for (const attempt of server.creates) {
    expect(attempt.body.retryOfScanTaskId).toBe(PRIOR_TASK_ID)
    expect(attempt.headers['x-scan-retry-control']).toBe(PRIOR_CONTROL_TOKEN)
  }

  // ⑤ 本机登记里那一场就是服务端那条 child，不是本机编出来的第二个身份。
  const live = await page.evaluate(
    (key) => JSON.parse(window.sessionStorage.getItem(key) ?? '{}') as { live?: { scanTaskId?: string } },
    SCAN_SESSION_KEY,
  )
  expect(live.live?.scanTaskId).toBe(childId)
  // 屏幕上那个编号也必须是它 —— 用户拿着这个号去认领待会儿回传的文件。
  await expect(page.getByText(childId, { exact: true })).toBeVisible()
  // ⑥ 这一场的性质是「安全重扫」：服务端认了那一对，同一张纸可以原样放回去。
  await expect(page.getByText('安全重扫：服务端已放行同一份材料再扫一次')).toBeVisible()

  /* ⑦ 领回来的那条 child **必须已经确认过投递授权**，而且确认的就是它本身。
   *
   * 这一条是这一轮新加的，它守的是一个很容易犯的错：重放把 child 领回来、屏幕上
   * 画出了操作指引，但本机没有对这条 child 发确认 —— 于是用户照着指引扫出来的文件
   * 对 Agent 是不可见的，人白等到轮询上限。指引已经出现（上面 ② 断言过），
   * 所以这里断言 acked 里有它，等价于断言「确认排在指引之前」。 */
  expect(server.acked()).toContain(childId)
  // ⑧ 站到 Agent 的位置上：可投递的就是这一条，不是另一条、也不是零条。
  const lease = await server.currentLease()
  expect(lease.status).toBe(200)
  expect(lease.scanTaskId).toBe(childId)

  expect(errors).toEqual([])
})

test('leaving during the recovery window revokes the recovered child @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrintScanHub(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)

  await landOnFailedPriorScan(page)
  server.dropNextCreateResponse()
  await page.getByRole('button', { name: '重试扫描（同一份材料）', exact: true }).click()
  await expect(page.getByTestId('scan-create-replay-notice')).toBeVisible({ timeout: 10_000 })

  /* 重放还在退避窗口里，用户就走了（顶栏返回 = leaveScanFlow：撤服务端 + 清本机登记 +
   * 推进代次）。此刻本机登记里**还没有** live，所以那一次撤销无从下手 ——
   * 真正要证明的是：随后领回来的那条 child 不许被写进任何状态，而且必须被撤掉。
   * 这一步刻意用页内跳转，不用 page.goto：整页加载会把还在飞的重放一起干掉，
   * 那样这条用例无论代码对不对都是绿的。 */
  await page.locator('.qx-topbar-back').click()
  await page.waitForURL(/\/print-scan$/)

  // ① 领回来的 child 必须被撤掉。不撤它就停在 waiting 收下一位的面板扫描 ——
  //    正是这一整轮要消灭的「看不见的收件箱」。
  await expect.poll(
    () => server.deleted(),
    { timeout: 20_000, message: '离开之后领回来的 child 必须收到 DELETE' },
  ).toContain(server.childIds()[0]!)

  // ② 服务端仍然只有一条 child：离开不该让重放退化成「再建一个」。
  expect(server.childIds()).toHaveLength(1)

  /* ②' 这条 child **从来没被确认过**。
   *
   * 撤销可能失败（断网 / keepalive 被掐断），所以「撤了」不是这条路径上唯一的防线：
   * 没确认过的任务在服务端本来就不可投递，还会被 60 秒未确认回收器收掉。
   * 一旦本机在离开之后顺手对它确认一次，这层兜底就整个没了 ——
   * 它会变成一条可投递、回收器也够不着的 waiting。 */
  expect(
    server.acked(),
    '用户已经离开，这条领回来的 child 一次都不许被确认：确认等于把一个没人看着的收件箱变成可投递的',
  ).not.toContain(server.childIds()[0]!)

  /* ②'' 最终判据：站到 Agent 的位置上问「现在面板扫出来的文件投给谁」。
   * 上面两条都是过程，这一条才是后果 —— 没有可投递的任务，也就没有跨用户串件。 */
  expect((await server.currentLease()).code).toBe('NO_WAITING_SCAN_TASK')

  // ③ 绝不许状态复活：本机登记必须是空的，也不许把上一场那份 controlToken 留下。
  await page.waitForTimeout(1_000)
  const residue = await page.evaluate(
    ({ key, token }) => ({
      session: window.sessionStorage.getItem(key),
      leaked: (window.sessionStorage.getItem(key) ?? '').includes(token),
    }),
    { key: SCAN_SESSION_KEY, token: PRIOR_CONTROL_TOKEN },
  )
  expect(residue.session).toBeNull()
  expect(residue.leaked).toBe(false)

  // ④ 人还在打印扫描页，没有被那条迟到的响应拽回扫描流程。
  await expect(page).toHaveURL(/\/print-scan$/)

  expect(errors).toEqual([])
})

test('a child that is no longer recoverable offers only an honest plain restart @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)

  await landOnFailedPriorScan(page)
  // child 提交了、回话丢了，而等到本机重放上来时它已经不在 waiting/matched
  // （过期 / 被撤 / 已完成）。服务端回 409，并且**不会**再开一条 grandchild。
  server.dropNextCreateResponse()
  server.makeChildUnrecoverable()
  await page.getByRole('button', { name: '重试扫描（同一份材料）', exact: true }).click()

  // ① 拿到 409 就当场收工，不再继续退避：确定的答案不许被拖成一屏无意义的等待。
  await expect(page.getByText('那次安全重扫的会话已经失效', { exact: true }).first())
    .toBeVisible({ timeout: 20_000 })
  expect(server.creates).toHaveLength(2)

  // ② 必须交代「服务端没有留下还在等文件的任务」—— 用户据此才知道自己那张纸安不安全。
  //    同一句会在结论屏和工作台兜底里各渲染一次，取第一处即可。
  await expect(page.getByText(/没有留下还在等文件的任务/).first()).toBeVisible()
  //    顺带钉住：这些 description 是纯字符串，写成 markdown 会把星号打在屏幕上。
  await expect(page.getByText(/\*\*/)).toHaveCount(0)

  // ③ 出路只剩显式的普通重启：服务端不会为同一枚授权再开一条 child，
  //    所以「再试一次安全重扫」在这一屏是一句假承诺，绝不许出现。
  await expect(page.getByRole('button', { name: '重新开始一次扫描', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '再试一次安全重扫', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /重试扫描/ })).toHaveCount(0)

  // ④ 按下去是一次**普通**会话，而且页面把这个选择如实记在「本次性质」里。
  await page.getByRole('button', { name: '重新开始一次扫描', exact: true }).click()
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()
  expect(server.creates).toHaveLength(3)
  expect(server.creates[2]!.body.retryOfScanTaskId).toBeUndefined()
  expect(server.creates[2]!.headers['x-scan-retry-control']).toBeUndefined()
  await expect(page.getByText('普通会话：你已确认这一次不是安全同字节重扫')).toBeVisible()

  expect(errors).toEqual([])
})

test('a 429 is answered by the server and must never be auto-replayed @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)

  await landOnFailedPriorScan(page)
  /* 429 是一个**确定**的答案：服务端回过话了，而且它发生在消费那枚授权之前。
   * 自动重放这一条会把整个大厅的创建额度烧掉（端点按出口 IP 限 12 次/分），
   * 而正确处置本来就有 —— 原样放回授权，让用户自己按那颗仍然成对的按钮。 */
  server.failNextCreate({ status: 429, code: 'RATE_LIMITED', message: '当前使用的人较多，请稍后再试' })
  await page.getByRole('button', { name: '重试扫描（同一份材料）', exact: true }).click()

  await expect(page.getByText('请求过于频繁', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
  // ① 一次都不许自动重发。旧的等待屏说「正在确认上一次请求」在这里就是假话。
  expect(server.creates).toHaveLength(1)
  await expect(page.getByTestId('scan-create-replay-notice')).toHaveCount(0)
  // 再等一个退避周期，确认确实没有偷偷发第二个。
  await page.waitForTimeout(2_000)
  expect(server.creates).toHaveLength(1)

  // ② 既有的手动安全重试必须原样保留：凭据还在，且有效期不因重试而延长。
  await expect(page.getByTestId('scan-rescan-still-held')).toBeVisible()
  await expect(page.getByRole('button', { name: '再试一次安全重扫', exact: true })).toBeVisible()

  // ③ 按下去发出的仍然是成对的那一次，不是降级。
  await page.getByRole('button', { name: '再试一次安全重扫', exact: true }).click()
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()
  expect(server.creates).toHaveLength(2)
  expect(server.creates[1]!.body.retryOfScanTaskId).toBe(PRIOR_TASK_ID)
  expect(server.creates[1]!.headers['x-scan-retry-control']).toBe(PRIOR_CONTROL_TOKEN)

  expect(errors).toEqual([])
})

/* ── 整页重载打断重放：本机确实丢了那条 child，但它**领不走** ────────────────
 *
 * 这条用例接替了上一轮那个「documented local limit」。上一轮的结论是：
 * 隐私清场最后一步是 `window.location.reload()`
 * （KioskPrivacyGuard.pushSanitizedDestination），整页重载把还在退避窗口里的重放连同
 * JS 上下文一起换掉，本机再没机会去领那条 child、也就没法撤它；于是服务端留下一条
 * waiting，而当时那条 waiting 对 Agent 是**立刻可投递**的 —— 那才是真正的
 * 「看不见的收件箱」。当时只能把它如实记成一个取舍。
 *
 * 服务端 2026-09-14 把那个取舍取消了：新建会话一律 `deliveryAckedAt = null`，
 * current-lease 看不见未确认的行（60 秒没确认就回收）。本机在响应丢失的那条路径上
 * 从来没拿到过 child 的 id，也就从来没确认过它 —— 所以这条 child 从诞生到过期
 * **一秒都没有可投递过**。
 *
 * 于是判据换了，而且强了：不再问「本机撤没撤掉它」，而是直接站到 Agent 的位置上问
 * 「面板上这一刻扫出来的文件会被投给谁」。答案必须是 NO_WAITING_SCAN_TASK。
 * 一条留在库里但谁都领不走的行不是收件箱；一条**能被领走**的才是，
 * 而这条用例不接受后者。 */
test('a full reload during recovery leaves a child that no agent can lease @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)

  await landOnFailedPriorScan(page)
  server.dropNextCreateResponse()
  await page.getByRole('button', { name: '重试扫描（同一份材料）', exact: true }).click()
  await expect(page.getByTestId('scan-create-replay-notice')).toBeVisible({ timeout: 10_000 })

  // 隐私清场的最后一步就是这个。整页重载 = 重放的执行环境没了。
  await page.reload()
  await page.waitForTimeout(2_000)

  // ① 服务端那条 child 确实还在，本机也确实没撤掉它 —— 这一半和上一轮一样，不粉饰。
  expect(server.childIds()).toHaveLength(1)
  const orphan = server.childIds()[0]!
  expect(server.deleted()).not.toContain(orphan)

  // ② 但它从来没被确认过：本机在响应丢失那条路径上根本不知道它的 id。
  expect(server.acked()).not.toContain(orphan)

  // ③ **这一条才是真正的判据**：站到 Agent 的位置上问「现在扫出来的文件投给谁」。
  //    没有可投递的任务 —— 也就没有任何跨用户串件的可能。
  const lease = await server.currentLease()
  expect(lease.status).toBe(409)
  expect(lease.code).toBe('NO_WAITING_SCAN_TASK')
  expect(lease.scanTaskId).toBeUndefined()

  // ④ 本机绝不许因此说假话：重载之后凭据已经不在内存里，页面 fail-closed，
  //    既不假装会话建成了，也不偷偷改发一个无签名的普通创建。
  await expect(page.getByText('安全重扫凭据已经不在本机', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('扫描任务已创建', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '我已操作，开始等待' })).toHaveCount(0)
  // 重载之后不许再多发任何请求（那一次重放已经随上下文消失了）。
  expect(server.creates).toHaveLength(1)

  expect(errors).toEqual([])
})

/* ── 反向对照：确认过的会话，Agent 就该看得见 ──────────────────────────────
 *
 * 没有这一条，上面那条用例证明不了什么：一个永远回 NO_WAITING_SCAN_TASK 的桩
 * 也能让它全绿。两条合起来才说明租约端点真的在按「确认过没有」分流。 */
test('an acknowledged session is exactly what the agent may lease @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)

  await landOnFailedPriorScan(page)
  // 建成之前 Agent 什么都领不到。
  expect((await server.currentLease()).code).toBe('NO_WAITING_SCAN_TASK')

  await page.getByRole('button', { name: '重试扫描（同一份材料）', exact: true }).click()
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()

  const childId = server.childIds()[0]!
  expect(server.acked()).toContain(childId)
  const lease = await server.currentLease()
  expect(lease.status).toBe(200)
  expect(lease.scanTaskId).toBe(childId)

  // 用户按「返回（取消任务）」之后它又该消失 —— 撤掉的任务不许还能被领走。
  await page.getByRole('button', { name: '返回（取消任务）', exact: true }).click()
  await expect.poll(() => server.deleted(), { timeout: 10_000 }).toContain(childId)
  expect((await server.currentLease()).code).toBe('NO_WAITING_SCAN_TASK')

  expect(errors).toEqual([])
})

/* ── 确认还没回来时用户就走了 ──────────────────────────────────────────────
 *
 * 这一刻最危险：会话已经建成、本机登记也写了，而那一次确认可能**正好在路上成功**——
 * 成功的瞬间它就变成一条可投递的 waiting，而看着它的那个人已经走了。 */
test('leaving while the delivery ack is in flight revokes the session @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrintScanHub(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)

  await landOnFailedPriorScan(page)
  // 确认请求挂住不回：页面停在「正在确认投递授权」，指引与「我已操作」都不许出现。
  server.hangNextAck()
  await page.getByRole('button', { name: '重试扫描（同一份材料）', exact: true }).click()

  await expect(page.getByTestId('scan-ack-pending-notice')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('放好原件', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '我已操作，开始等待' })).toHaveCount(0)
  const childId = server.childIds()[0]!
  expect(server.acked()).not.toContain(childId)

  // 顶栏返回 = leaveScanFlow（撤服务端 + 清本机登记 + 推进代次）。用页内跳转，
  // 不用 page.goto：整页加载会把还在飞的那次确认一起干掉，那样用例怎么写都是绿的。
  await page.locator('.qx-topbar-back').click()
  await page.waitForURL(/\/print-scan$/)

  // ① 这一场必须被撤掉 —— 否则它就是一条没人看着的会话。
  await expect.poll(
    () => server.deleted(),
    { timeout: 20_000, message: '确认途中离开之后，这一场必须收到 DELETE' },
  ).toContain(childId)
  // ② 站到 Agent 的位置上再确认一次：没有任何可投递的任务。
  expect((await server.currentLease()).code).toBe('NO_WAITING_SCAN_TASK')
  // ③ 本机登记必须干净，上一场那份 controlToken 也不许留下。
  const residue = await page.evaluate(
    ({ key, token }) => ({
      session: window.sessionStorage.getItem(key),
      leaked: (window.sessionStorage.getItem(key) ?? '').includes(token),
    }),
    { key: SCAN_SESSION_KEY, token: PRIOR_CONTROL_TOKEN },
  )
  expect(residue.session).toBeNull()
  expect(residue.leaked).toBe(false)
  await expect(page).toHaveURL(/\/print-scan$/)

  expect(errors).toEqual([])
})

/* ── 走人时那次撤销丢了，而确认随后成功了（2026-09-14 P1） ─────────────────────
 *
 * 上面那条用例把确认**永远**挂住，所以服务端那条任务从头到尾不可投递 —— 它证明不了
 * 这一条。真正的危险形状是两件事撞在一起：
 *
 *   ① 离开时发出的那次 DELETE 在路上丢了（keepalive 请求随文档拆卸被掐断 /
 *      网络抖动）。撤销是 fire-and-forget、回执一律吞掉，本机永远不会知道；
 *   ② 离开那一刻还在飞的那次 ACK **成功了**。
 *
 * 于是服务端那条任务同时满足：`deliveryAckedAt` 非空（60 秒未确认回收器再也收不到
 * 它）、状态仍是 waiting（Agent 的 current-lease 看得见它）。它会一直可投递到自然
 * 过期 —— 下一位走到面板前按下扫描，文件投给已经走掉的上一位。跨用户串件。
 *
 * 而「ACK 成功」恰恰是①的证据：服务端 ack() 只对未过期的 waiting/matched 放行，
 * 那条 DELETE 真生效了的话这次确认只会拿回 409。所以确认回来的那一支必须能发出
 * **第二次** DELETE，哪怕先前那次尽力而为的撤销已经登记过。
 *
 * 判据落在最后三行：本机第二次发了、服务端这次真收到了、Agent 领不到任何东西。 */
test('an ack that succeeds after the user left forces a second revoke when the first was lost @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrintScanHub(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)

  await landOnFailedPriorScan(page)
  // 挂住但放得开：用户离开之后再让它成功。
  server.holdNextAck()
  await page.getByRole('button', { name: '重试扫描（同一份材料）', exact: true }).click()

  await expect(page.getByTestId('scan-ack-pending-notice')).toBeVisible({ timeout: 20_000 })
  const childId = server.childIds()[0]!
  expect(server.acked()).not.toContain(childId)
  // 没确认之前这一屏不许把人支到面板上去。
  await expect(page.getByText('放好原件', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '我已操作，开始等待' })).toHaveCount(0)

  // 离开时那一次撤销在路上丢了。页内跳转，不用 page.goto：整页加载会把还在飞的
  // 那次确认一起干掉，那样这条用例无论代码对不对都是绿的。
  server.dropNextDelete()
  await page.locator('.qx-topbar-back').click()
  await page.waitForURL(/\/print-scan$/)

  // ① 本机确实按登记发了那一次，而它确实没生效 —— 前提成立，这条用例才测得到东西。
  await expect.poll(
    () => server.deleteAttempts(),
    { timeout: 20_000, message: '离开时必须按本机登记发出第一次 DELETE' },
  ).toContain(childId)
  expect(
    server.deleted(),
    '第一次 DELETE 必须是无效的：它一旦生效，下面那次确认只会拿回 409，这条用例就空转了',
  ).not.toContain(childId)

  // ② 现在放行那次还在飞的确认。它会成功 —— 于是这条任务在服务端变得可投递，
  //    而看着它的那个人已经走了。
  server.releaseHeldAck()
  await expect.poll(
    () => server.acked(),
    { timeout: 20_000, message: '这一次确认必须真的成功，否则测的还是上面那条用例' },
  ).toContain(childId)

  // ③ 判据一：本机必须**再发一次** DELETE。按「发过没有」去重的话这里永远是 1。
  await expect.poll(
    () => server.deleteAttempts().filter((id) => id === childId).length,
    {
      timeout: 20_000,
      message: '确认成功之后必须补一次撤销：先前那次已知没生效，而任务此刻已经可投递，'
        + '60 秒未确认回收器也收不到它了',
    },
  ).toBeGreaterThanOrEqual(2)
  // ④ 判据二：这一次真的到了服务端。
  await expect.poll(
    () => server.deleted(),
    { timeout: 20_000, message: '补发的那次撤销必须生效，否则任务会一直可投递到自然过期' },
  ).toContain(childId)
  // ⑤ 判据三（最终判据）：站到 Agent 的位置上问「现在面板扫出来的文件投给谁」。
  await expect.poll(
    async () => (await server.currentLease()).code,
    { timeout: 10_000, message: '撤掉之后不许还有任何可投递的任务' },
  ).toBe('NO_WAITING_SCAN_TASK')

  // ⑥ 补偿不是「无限重试」：封顶两次，不许因为这条修复变成对服务端刷请求。
  await page.waitForTimeout(1_500)
  expect(server.deleteAttempts().filter((id) => id === childId).length).toBeLessThanOrEqual(2)
  // ⑦ 本机登记必须干净，上一场那份 controlToken 也不许留下。
  const compensationResidue = await page.evaluate(
    ({ key, token }) => ({
      session: window.sessionStorage.getItem(key),
      leaked: (window.sessionStorage.getItem(key) ?? '').includes(token),
    }),
    { key: SCAN_SESSION_KEY, token: PRIOR_CONTROL_TOKEN },
  )
  expect(compensationResidue.session).toBeNull()
  expect(compensationResidue.leaked).toBe(false)
  await expect(page).toHaveURL(/\/print-scan$/)

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

// carriesFile：这个去向要不要把文件随路由 state 一起带过去。
// 打印确认页读 `state.file`、解析页读 `state.fileId`；「我的文档」不带文件（它自己去查）。
// 这一位是「清场不许连落点一起清掉」的判据 —— 见下面 history 那一组的断言 ①。
const COMPLETED_EXITS = [
  { key: 'print', button: '直接打印', url: /\/print\/confirm$/, needsLogin: false, carriesFile: true },
  { key: 'resume-ai', button: 'AI 简历识别', url: /\/resume\/parse$/, needsLogin: false, carriesFile: true },
  { key: 'documents', button: '前往我的文档', url: /\/me\/documents$/, needsLogin: true, carriesFile: false },
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

/* ══ 离开完成态之后，后退 / 前进都回不到那一屏 ═══════════════════════════════
 *
 * 清 sessionStorage 只决定了「下一位进 /scan 会复水到哪一屏」。历史条目是另一回事：
 * push 之后 `/scan?stage=result` 仍然在浏览器历史里，并且带着当时那笔 location.state
 * （ScanProgressPage 的非工作台路径会把 file 写进去），而结果页取数是
 * `stored?.result?.file ?? locationState.file` —— 存储清了，路由 state 还能把上一位
 * 那份文件名与签名内容链接补回来。
 *
 * 所以这一组**必须**用 goBack/goForward 来证，用 page.goto 证不了：goto 建的是新条目，
 * 永远碰不到历史里那一条。
 *
 * ## 判据为什么是「后退落在哪个 pathname」，而不是「URL 里还有没有 stage=result」
 *
 * 后者试过，是个假绿：push 之后后退确实落在 `/scan?stage=result` 那一条，但登记已经
 * 被清掉，ScanWorkbenchPage 当帧就把 view 解析成 start 并 `setSearchParams(replace)`
 * 把 URL 改写成 `?stage=start` —— 断言 stage 不等于 result，push 和 replace 一样绿。
 * （删掉 replace 跑一遍，那版断言 3/3 全过，什么都没测到。）
 *
 * 所以这里先在结果条目**之前**插一条非 /scan 的历史条目。于是两种实现后退第一站不同：
 *   · replace：结果条目被落点换掉 → 后退第一站是 `/print-scan`；
 *   · push   ：结果条目还在       → 后退第一站是 `/scan`。
 * pathname 不会被那次 URL 自愈改写，这一位才真的分得开。 */
for (const exit of COMPLETED_EXITS) {
  test(`browser history cannot return to a completed scan left by ${exit.key} @scan-safety`, async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    registerShell(api)
    registerPrintScanHub(api)
    registerScanCapabilities(api)
    registerCompletedExitDestinations(api)
    if (exit.needsLogin) registerMemberLogin(api)
    installSameSheetScanServer(page)

    if (exit.needsLogin) await loginThroughVisibleUi(page, '/scan')
    else await page.goto('/scan?stage=start')
    // 结果条目之前必须是一条**非 /scan** 的条目（见上面的判据说明）。
    // 用 pushState + popstate 在同一个 document 里插，理由和 landOnCompletedScan 一样：
    // page.goto 是整页加载，会把内存里的登录态一起抹掉，documents 那一条就跑不了了。
    await page.evaluate(() => {
      window.history.pushState({}, '', '/print-scan')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await expect(page).toHaveURL(/\/print-scan$/)

    // landOnCompletedScan 同样用 pushState，所以历史里确实多出 `/scan?stage=result`
    // 这一条 —— 正是要证明它离开之后不再可达的那一条。
    await landOnCompletedScan(page)
    expect(new URL(page.url()).searchParams.get('stage')).toBe('result')

    await page.getByRole('button', { name: exit.button }).first().click()
    await expect(page).toHaveURL(exit.url)

    /* ① 落点必须**立刻就能用**那份文件。
     *
     * replace 换掉的是扫描结果那一条历史，不是落点这一条：路由 state 原样送达。
     * 这条断言防的是「为了清干净把落点也一起清掉」—— 那样打印确认页会退回
     * 「未知文件」、解析页拿不到 fileId，用户扫完的东西当场就废了。 */
    const handedOverState = await page.evaluate(() => {
      const usr = (window.history.state as { usr?: unknown } | null)?.usr ?? null
      return usr === null ? null : JSON.stringify(usr)
    })
    if (exit.carriesFile) {
      expect(handedOverState, '带文件的去向必须在落点那一条历史里收到 fileId').toContain(SAME_SHEET_FILE.fileId)
    }

    // ② 后退：越过整条扫描流程，第一站就是扫描之前那一页。
    await page.goBack()
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 5_000 }).toBe('/print-scan')
    await expect(page.getByText(SAME_SHEET_FILE.filename, { exact: false })).toHaveCount(0)
    await expect(page.getByText('扫描完成', { exact: true })).toHaveCount(0)

    // ③ 前进：落点还是落点（它靠路由 state 拿文件，这一点必须保住），
    //    但前进链路上同样没有结果屏那一条。
    await page.goForward()
    await expect(page).toHaveURL(exit.url)
    expect(new URL(page.url()).searchParams.get('stage')).toBeNull()

    // ④ 再后退一次，仍然是扫描之前那一页；并且历史条目的 state 里没有那枚控制凭证。
    await page.goBack()
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 5_000 }).toBe('/print-scan')
    const historyResidue = await page.evaluate(
      (token) => JSON.stringify(window.history.state ?? null).includes(token),
      PRIOR_CONTROL_TOKEN,
    )
    expect(historyResidue, '历史条目的 state 里不许还留着上一场的控制凭证').toBe(false)

    expect(errors).toEqual([])
  })
}

/* ══ 换人：下一位登录，继承不到上一位游客那场无人认领的扫描 ══════════════════
 *
 * login() 的老规则是「只清别人的」：`current && current.id !== next.id` 才清场，
 * 游客（current 为 null）中途登录一个字节都不清。对打印材料这条产品判断成立，
 * 对扫描不成立 —— 扫描件是上一位的身份证 / 简历原件，登记里还带着那一场的
 * controlToken 明文。
 *
 * 真实链路：上一位游客扫完走了（没按任何出口，所以本机登记还在，隐私空闲也没到点）→
 * 下一位走上来，一碰屏幕就把空闲计时重置了 → 他去登录 → 老规则不清 →
 * 他现在是「会员」，而本机登记里躺着上一位的扫描件。
 *
 * ## 为什么是 fail-closed，而不是找一个延续标记
 *
 * 「同一人继续办理」只有在**这条流程自己把人送去登录**时才说得过去。扫描流程今天
 * 没有这样的入口，这一点是可查的而不是假设的：结果页未登录时那颗「前往我的文档」
 * 是禁用的（`disabled={!file || !isLoggedIn}`，文案写「本次不进入我的文档」），
 * 选类型页明写「本屏无登录步骤」，顶栏返回与底栏三项都先 `leaveScanFlow`
 * （撤服务端任务 + 清本机登记）再走人。也就是说一个真正在办事的游客走到 /login 时，
 * 他的扫描早就被他自己那一次离开清掉了 —— 这条闸门对他是空操作。
 * 既然没有可信的延续标记，就在接受新身份之前先收掉扫描。
 *
 * ## 范围只到扫描（下面断言 ⑤ 钉住这一条）
 *
 * 「游客中途登录视为同一人继续办理，打印材料仍在」这条产品判断依然有效。
 * 本闸门不碰打印材料 / AI 简历 / 面试工作台；把它们一起清掉就是借着修隐私洞
 * 顺手改掉一条产品行为。 */
test('a later member cannot reopen the previous guest scan @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrintScanHub(api)
  registerScanCapabilities(api)
  registerMemberLogin(api)
  const server = installSameSheetScanServer(page)

  // 上一位是**游客**：先落到完成态，再确认登记确实还在（否则这条用例会假绿）。
  await page.goto('/scan?stage=start')
  await landOnCompletedScan(page)
  // 同时种一份**打印材料**会话：它代表「游客中途登录视为同一人继续办理」那条产品判断，
  // 必须在这次登录之后活下来。少了它，这条用例就只证明「清得掉」，
  // 证明不了「没有清过头」。
  await page.evaluate(() => {
    window.sessionStorage.setItem(
      'ai-job-print:current-print-material-check',
      JSON.stringify({ file: { fileId: 'guest-print-material', name: '游客打印材料.pdf' } }),
    )
  })
  const guestRegistry = await page.evaluate((key) => window.sessionStorage.getItem(key), SCAN_SESSION_KEY)
  expect(guestRegistry, '前置条件：游客那场扫描此刻确实还在本机登记里').toContain(PRIOR_CONTROL_TOKEN)

  // 下一位在同一台机器上登录。整页加载只抹内存态，sessionStorage 照样活着 ——
  // 这正是现场的真实形状，也是这条闸门唯一的着力点。
  await loginThroughVisibleUi(page, '/scan')

  // ① 登记必须已经没了。
  const afterLogin = await page.evaluate((key) => window.sessionStorage.getItem(key), SCAN_SESSION_KEY)
  expect(afterLogin).toBeNull()
  // ② 落在选类型那一屏，看不到上一位的结果与文件。
  await expect(page.getByText('下一步会创建真实扫描会话', { exact: false }).first()).toBeVisible()
  await expect(page.getByText(SAME_SHEET_FILE.filename, { exact: false })).toHaveCount(0)
  await expect(page.getByText('扫描完成', { exact: true })).toHaveCount(0)
  // ③ 任何存储里都不许再有那枚控制凭证。
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
  /* ⑤ 但**只**清扫描：打印材料必须原样活着。
   *
   * 这一条和 ①–③ 是一对，缺了它这条用例就只证明「清得掉」。「游客中途登录视为同一人
   * 继续办理」是一条现存的产品判断，借着修隐私洞把它一起改掉，属于越界。 */
  const printMaterial = await page.evaluate(
    () => window.sessionStorage.getItem('ai-job-print:current-print-material-check'),
  )
  expect(printMaterial, '闸门范围只到扫描：游客的打印材料不许被这次登录清掉').toContain('guest-print-material')

  // ⑥ 这位会员自己开的那一场不许继承上一位的重扫血缘。
  await page.getByRole('button', { name: /下一步/ }).click()
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()
  expect(server.creates).toHaveLength(1)
  expect(server.creates[0]!.body.retryOfScanTaskId).toBeUndefined()
  expect(server.creates[0]!.headers['x-scan-retry-control']).toBeUndefined()

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

  /* ④ 出路必须是**能按下去并且真的管用**的那一个。
   *
   * 「不自动降级」和「不给出路」是两件事，早先的实现把它们混成了一件：这一屏只有
   * 「安全返回扫描首页」，主行动是灰掉的「未创建扫描任务」。而这一屏最常见的来源恰恰是
   * 上一场根本没走到取件 —— 服务端那种情况从不铸授权，必然 403。于是最常见的失败路径上，
   * 主行动注定失败，用户得原路退回重选一次类型再来一遍。 */
  await expect(page.getByRole('button', { name: '安全返回扫描首页' }).first()).toBeVisible()
  const restart = page.getByRole('button', { name: '重新开始一次扫描', exact: true })
  await expect(restart).toBeVisible()
  await expect(page.getByText(/可能按重复件拒收/).first()).toBeVisible()

  // ⑤ 按下去要真的发出一次**普通**创建（不带两半），而不是被 fail-closed 闸门再判一次，
  //    也不是给那个已经 reject 的 promise 再挂一遍处置（那样按钮按下去毫无反应）。
  await restart.click()
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()
  expect(server.creates).toHaveLength(2)
  expect(server.creates[1]!.body.retryOfScanTaskId).toBeUndefined()
  expect(server.creates[1]!.headers['x-scan-retry-control']).toBeUndefined()
  // ⑥ 这一场的性质要如实标注：是用户自己选的普通会话，不是本页悄悄降级的。
  await expect(page.getByText(/你已确认这一次不是安全同字节重扫/).first()).toBeVisible()

  expect(errors).toEqual([])
})

/* ══ 延迟取用：意图还在、凭据已经不在了，一个请求都不许发 ══════════════════════
 *
 * `rescanCredentialsLost` 是**挂载那一刻**算一次的（必须如此，否则正常重扫路径上
 * 授权一被取走就会把自己判成 fail-closed）。但真正取用可能晚几十秒：终端会话换票时
 * 本页停在 checking 等着，等完才创建。这中间本地 15 分钟窗口会走完。
 *
 * 那一刻取用返回 null，而登记里那笔意图还在。没有闸门的话，页面会照常发一个
 * **不带签名**的普通创建 —— 用户按的是「同一份材料」，手里还是同一张纸，
 * 回传时撞上服务端两小时的同字节去重，任务停在 waiting 直到过期。
 *
 * 这条用例是上面「a stale safe rescan is refused at click time」够不着的那一半：
 * 那条里用户还没离开结果页，这条里创建流程已经开始、只是被终端换票拖住了。 */
test('a rescan deferred past its local window sends no unsigned create @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)

  // 换票挂住不放，本页就会停在 checking —— 这正是「取用被推迟」的真实成因。
  let openRefresh: () => void = () => undefined
  const refreshGate = new Promise<void>((resolve) => { openRefresh = resolve })
  let markRefreshArrived: () => void = () => undefined
  const refreshArrived = new Promise<void>((resolve) => { markRefreshArrived = resolve })
  api.respondWith('POST', '/api/v1/terminals/session-token/refresh', async () => {
    markRefreshArrived()
    await refreshGate
    return { status: 200, json: { sessionToken: 'rotated-terminal-session-token' } }
  })

  // 时钟装在导航之前（clock 只能这样用）。装完是暂停的，由用例自己推进。
  await page.clock.install()
  await landOnFailedPriorScan(page)

  // 先让续期在飞，再按「重试扫描（同一份材料）」：设置页挂载时状态就是 checking，
  // 创建 effect 在终端分支早退，授权还原封不动躺在内存槽位里。
  await page.evaluate(() => {
    const hooks = (window as unknown as { __terminalSessionE2E?: { startRefresh: () => void } }).__terminalSessionE2E
    if (!hooks) throw new Error('terminalAuth 的 E2E 测试缝缺失，无法驱动终端会话状态')
    hooks.startRefresh()
  })
  await refreshArrived

  await page.getByRole('button', { name: '重试扫描（同一份材料）', exact: true }).dispatchEvent('click')
  await page.waitForURL(/\/scan\?stage=settings/)
  await expect(page.getByText('正在做终端安全校验', { exact: true }).first()).toBeVisible()
  expect(server.creates, '换票没出结果之前一个创建请求都不许发').toHaveLength(0)

  // 等在 checking 的这段时间里，本地那 15 分钟窗口走完了。
  await page.clock.setSystemTime(new Date(Date.now() + 16 * 60 * 1000))
  openRefresh()

  // ① 取不到凭据 ⇒ 什么都不发。旧实现会在这里发出一个不带两半的普通创建。
  await expect(page.getByText('安全重扫凭据已经不在本机', { exact: true }).first()).toBeVisible()
  expect(server.creates, '意图还在却取不到凭据时，一个请求都不许发').toHaveLength(0)
  // ② 不伪造会话。
  await expect(page.getByText('扫描任务已创建', { exact: true })).toHaveCount(0)
  // ③ 成因要说全，不能写死成「本页重载过」——这条路径压根没重载。
  await expect(page.getByText(/超过 15 分钟/).first()).toBeVisible()

  /* ④ 出路仍然是用户显式按下的那一个，而且它发出去的是**普通**创建。
   *
   * 这里只断到请求层，不断「扫描任务已创建」上屏 —— 不是放水，是时钟的算术：
   * 共用的服务端夹具按 **Node 侧真实时钟** 铸 `expiresAt = now + 10min`，而页面的时钟
   * 已经被推到 +16min，于是那个 expiresAt 在页面看来早就过期了，
   * `isValidCreatedSession` 会（正确地）拒收它。那是夹具与假时钟的交互，
   * 不是本条要证的东西。这颗按钮端到端能建出会话，由上一条
   * （a refused rescan authority…）在不动时钟的情况下证。 */
  await page.getByRole('button', { name: '重新开始一次扫描', exact: true }).click()
  await expect.poll(() => server.creates.length, { timeout: 5_000 }).toBe(1)
  expect(server.creates[0]!.body.retryOfScanTaskId).toBeUndefined()
  expect(server.creates[0]!.headers['x-scan-retry-control']).toBeUndefined()

  expect(errors).toEqual([])
})

/* ══ 一次「证明不了服务端消费过」的失败，不许烧掉那枚一次性授权 ═══════════════
 *
 * 取用必须排在请求发出之前（并发双击、effect 重跑都得撞空槽位），所以失败回来时
 * 本机那一份已经不在槽位里了。而服务端那一半的消费（retryConsumedAt 的 CAS）在
 * scan-tasks.service.ts 的 $transaction **内部**，限流（12 次/分）与终端态检查更在
 * 事务之前就抛 —— 429 / SCAN_TERMINAL_BUSY / 断网 / 5xx 回来时，服务端那枚授权
 * 原封没动，只有本机把它自己扔了。
 *
 * 扔掉的代价不是「少一个便利功能」。授权只在任务 matched 之后才铸，而 matched 同时
 * 写下 lastAttemptHash —— 那正是两小时同字节去重的键。两个条件必然同时成立，所以只要
 * 曾经有过授权，同一张纸走普通会话就**必定**撞 SCAN_FILE_PREVIOUSLY_ATTEMPTED：
 * Agent 把文件隔离进 _unclaimed 且不重试，服务端任务停在 waiting，用户在机器前
 * 白等到十分钟轮询上限，屏幕上一句解释都没有。
 *
 * 旧实现在这条路径上是一条死路：结果快照已被 beginScanRescan 抹掉（回不去重新登记）、
 * 主按钮是 disabled、唯一能按的「安全返回扫描首页」还会推进代次把残留意图也清掉。
 */

/** 走到「安全重扫的创建失败了」那一屏，并返回这一次用的服务端桩。 */
async function landOnInterruptedRescan(
  page: Page,
  server: ReturnType<typeof installSameSheetScanServer>,
  failure: { kind: 'offline' } | { status: number; code: string; message: string },
): Promise<void> {
  await landOnFailedPriorScan(page)
  server.failNextCreate(failure)
  await page.getByRole('button', { name: '重试扫描（同一份材料）', exact: true }).click()
  await page.waitForURL(/\/scan\?stage=settings/)
}

const INTERRUPTED_CREATES = [
  {
    key: 'rate-limited',
    failure: { status: 429, code: 'RATE_LIMITED', message: '请求过于频繁' } as const,
    title: '请求过于频繁',
  },
  {
    key: 'terminal-busy',
    failure: { status: 409, code: 'SCAN_TERMINAL_BUSY', message: '该终端当前有正在进行的扫描' } as const,
    title: '本机正在扫描中',
  },
  /* 2026-09-14：'offline' 从这张表里搬走了，因为它**不再**属于这一类。
   *
   * 这张表管的是「服务端回过话」的失败（429 / 409）：结论确定，本机不许自动重发，
   * 处置是原样放回授权 + 用户手动按那颗仍然成对的按钮。
   *
   * 断网是「连服务端收没收到都不知道」，而那正是本轮要主动收回的那条路径 ——
   * 它现在会自动重放同一对请求。两条新用例在下面：一条证明重放把会话领了回来，
   * 一条证明网络一直不通时它有界收工并如实说不知道。 */
] as const

for (const attempt of INTERRUPTED_CREATES) {
  test(`a ${attempt.key} create keeps the safe rescan and the retry stays paired @scan-safety`, async ({ page, api }) => {
    const errors = collectRuntimeErrors(page)
    registerShell(api)
    registerScanCapabilities(api)
    const server = installSameSheetScanServer(page)

    await landOnInterruptedRescan(page, server, attempt.failure)

    // ① 如实说明这一次失败了，而且**没有**把它压成「安全重扫授权已失效」——
    //    服务端根本没说过那句话。
    await expect(page.getByText(attempt.title, { exact: true }).first()).toBeVisible()
    await expect(page.getByText('安全重扫授权已失效', { exact: true })).toHaveCount(0)
    await expect(page.getByText('安全重扫凭据已经不在本机', { exact: true })).toHaveCount(0)

    // ② 不伪造会话。
    await expect(page.getByText('扫描任务已创建', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '我已操作，开始等待' })).toHaveCount(0)

    // ③ 不自动重发：发出去几次由用户按，本页不循环。
    await page.waitForTimeout(1_200)
    expect(server.creates).toHaveLength(1)

    /* ④ 凭据还在，而且页面**把这件事说出来**了。只给按钮不给这两句，用户会以为
     *    同一份材料已经扫不成了，转头去开一场注定被同字节去重拒收的普通会话。 */
    await expect(page.getByTestId('scan-rescan-still-held')).toBeVisible()
    await expect(page.getByText(/这次失败没有用掉你的安全重扫凭据/).first()).toBeVisible()
    await expect(page.getByText(/重试不会延长/).first()).toBeVisible()

    /* ⑤ 主行动是「再试一次安全重扫」，不是降级成普通会话，也不是灰掉的死路。
     *    这一屏上绝不能出现「重新开始一次扫描」—— 那会把用户往去重拒收上推。 */
    const retry = page.getByRole('button', { name: '再试一次安全重扫', exact: true })
    await expect(retry).toBeVisible()
    await expect(retry).toBeEnabled()
    await expect(page.getByRole('button', { name: '重新开始一次扫描', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '未创建扫描任务' })).toHaveCount(0)

    /* ⑥ 这一条是整条用例的结论：第二次创建仍然是**成对**的（body 里的 prior id +
     *    X-Scan-Retry-Control 头），绝不是一个无签名的普通创建。 */
    await retry.click()
    await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()
    expect(server.creates).toHaveLength(2)
    expect(server.creates[1]!.body.retryOfScanTaskId).toBe(PRIOR_TASK_ID)
    expect(server.creates[1]!.headers['x-scan-retry-control']).toBe(PRIOR_CONTROL_TOKEN)

    // ⑦ 成功之后这一场的性质要如实标注：服务端确实放行了同一份材料。
    await expect(page.getByText(/服务端已放行同一份材料再扫一次/).first()).toBeVisible()

    // ⑧ 而且这一次真的能把同一张纸扫回来（桩只对配对创建回 completed）。
    await page.getByRole('button', { name: '我已操作，开始等待' }).click()
    await expect(page.getByText('扫描完成', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(SAME_SHEET_FILE.filename, { exact: false }).first()).toBeVisible()

    expect(errors).toEqual([])
  })
}

/* ── 断网：唯一走自动重放的那一类（2026-09-14） ─────────────────────────────
 *
 * 这两条接替了上面那张表里原来的 'offline' 行。原来那一行断言的是「落到
 * 无法确认扫描任务状态 + 等用户手动按」，那正是本轮判定为 P1 的旧行为：
 * 第一次 POST 可能已经提交了 child，本机就此不管，服务端留下一条没人看着的
 * waiting 去接下一位用户的面板扫描。 */

test('an offline paired create is recovered automatically without any unsigned fallback @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)

  // 请求根本没落地那一种（route.abort）。浏览器侧和「落地了但回话丢了」一模一样，
  // 所以本机的动作必须相同：重放同一对，问到有答案为止。
  await landOnInterruptedRescan(page, server, { kind: 'offline' })

  // ① 自动重放，并且屏幕如实改口（不说「正在建扫描会话」——那一刻这句可能是假的）。
  await expect(page.getByTestId('scan-create-replay-notice')).toBeVisible({ timeout: 10_000 })
  // ② 重放把这一场建了起来，用户不需要按任何东西。
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible({ timeout: 20_000 })
  expect(server.creates).toHaveLength(2)
  // ③ 两次都成对 —— 自动重放绝不许退化成无签名的普通创建。
  for (const create of server.creates) {
    expect(create.body.retryOfScanTaskId).toBe(PRIOR_TASK_ID)
    expect(create.headers['x-scan-retry-control']).toBe(PRIOR_CONTROL_TOKEN)
  }
  // ④ 只落成一场，而且如实标注它是安全重扫。
  expect(server.childIds()).toHaveLength(1)
  await expect(page.getByText('安全重扫：服务端已放行同一份材料再扫一次')).toBeVisible()

  // ⑤ 同一张纸真的扫得回来（桩只对配对创建回 completed）。
  await page.getByRole('button', { name: '我已操作，开始等待' }).click()
  await expect(page.getByText('扫描完成', { exact: true }).first()).toBeVisible({ timeout: 20_000 })

  expect(errors).toEqual([])
})

test('a network that never comes back ends bounded and says so honestly @scan-safety', async ({ page, api }) => {
  // 整张退避表跑满约 24.8 秒，这条用例要真的等完 —— 「有界」正是它要证明的东西。
  test.setTimeout(90_000)
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)

  await landOnFailedPriorScan(page)
  // 创建端点整条断掉：第一次和后续每一次重放都拿不到 HTTP 应答。
  await page.route('**/api/v1/scan/sessions', async (route) => {
    if (route.request().method() !== 'POST') { await route.fallback(); return }
    await route.abort('connectionfailed')
  })
  await page.getByRole('button', { name: '重试扫描（同一份材料）', exact: true }).click()

  // ① 重放到头就收工，不会一直转 —— 屏幕上给出确定的结论。
  await expect(page.getByText('还是没能确认这次扫描会话', { exact: true }).first())
    .toBeVisible({ timeout: 60_000 })

  // ② 不许对一件本机并不知道的事下结论：既不说建成了，也不说没建成。
  await expect(page.getByText('扫描任务已创建', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '我已操作，开始等待' })).toHaveCount(0)
  await expect(page.getByText('安全重扫授权已失效', { exact: true })).toHaveCount(0)

  /* ③ 授权被**原样放回**（重放到头是 outcomeUnknown，不是服务端拒绝），
   *    所以出路仍然是那颗成对的按钮，而不是把用户推去开一场注定撞去重的普通会话。 */
  await expect(page.getByRole('button', { name: '再试一次安全重扫', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '重新开始一次扫描', exact: true })).toHaveCount(0)
  // ④ 必须解释为什么再按一次是安全的，并且不许再说「本页不会自动重发」——已经发过了。
  await expect(page.getByText(/不会多建一场/).first()).toBeVisible()
  await expect(page.getByText(/本页不会自动重发/)).toHaveCount(0)

  expect(errors).toEqual([])
})

test('a server refusal after an interrupted create still only offers a plain restart @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)

  // 第一次限流（服务端没消费）→ 凭据放回；第二次服务端明确不认（它在别处被用掉了）。
  await landOnInterruptedRescan(page, server, { status: 429, code: 'RATE_LIMITED', message: '请求过于频繁' })
  await expect(page.getByTestId('scan-rescan-still-held')).toBeVisible()
  server.consumeAuthorityUpfront()
  await page.getByRole('button', { name: '再试一次安全重扫', exact: true }).click()

  // 403 之后必须换口径：授权是真的没了，这一次不许再挂「还能重试」的承诺。
  await expect(page.getByText('安全重扫授权已失效', { exact: true }).first()).toBeVisible()
  await expect(page.getByTestId('scan-rescan-still-held')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '再试一次安全重扫' })).toHaveCount(0)

  // 出路只剩显式的普通新会话，且它必须真的发得出去。
  const restart = page.getByRole('button', { name: '重新开始一次扫描', exact: true })
  await expect(restart).toBeVisible()
  await restart.click()
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()
  expect(server.creates).toHaveLength(3)
  expect(server.creates[2]!.body.retryOfScanTaskId).toBeUndefined()
  expect(server.creates[2]!.headers['x-scan-retry-control']).toBeUndefined()
  await expect(page.getByText(/你已确认这一次不是安全同字节重扫/).first()).toBeVisible()

  expect(errors).toEqual([])
})

test('leaving after an interrupted create never resurrects the rescan authority @scan-safety', async ({ page, api }) => {
  const errors = collectRuntimeErrors(page)
  registerShell(api)
  registerPrintScanHub(api)
  registerScanCapabilities(api)
  const server = installSameSheetScanServer(page)

  await landOnInterruptedRescan(page, server, { status: 429, code: 'RATE_LIMITED', message: '请求过于频繁' })
  await expect(page.getByTestId('scan-rescan-still-held')).toBeVisible()

  // 用户走了。代次推进，寄存格和槽位一起被扔掉 —— 下一位绝不能继承这枚授权。
  await page.getByRole('button', { name: '安全返回扫描首页', exact: true }).click()
  await expect(page.getByText('下一步会创建真实扫描会话', { exact: false }).first()).toBeVisible()

  // 下一位在这台机器上从头选类型开一场：必须是干净的普通创建，一个字节的血缘都不许带。
  await page.getByRole('button', { name: /下一步/ }).click()
  await expect(page.getByText('扫描任务已创建', { exact: true })).toBeVisible()
  expect(server.creates).toHaveLength(2)
  expect(server.creates[1]!.body.retryOfScanTaskId).toBeUndefined()
  expect(server.creates[1]!.headers['x-scan-retry-control']).toBeUndefined()
  // 也不许把这一场说成安全重扫。
  await expect(page.getByText(/服务端已放行同一份材料再扫一次/)).toHaveCount(0)

  const residue = await page.evaluate(
    (token) => JSON.stringify(Object.fromEntries(
      Array.from({ length: window.sessionStorage.length }, (_, i) => window.sessionStorage.key(i))
        .filter((key): key is string => key !== null)
        .map((key) => [key, window.sessionStorage.getItem(key) ?? '']),
    )).includes(token),
    PRIOR_CONTROL_TOKEN,
  )
  expect(residue).toBe(false)

  expect(errors).toEqual([])
})
