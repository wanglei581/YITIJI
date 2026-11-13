import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { deferred, flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const pendingOrder = {
  id: 'order-A', taskStatus: 'pending_release', payStatus: 'unpaid',
  pickupStatus: 'pending', pickupCode: '12345678', fileName: 'synthetic.pdf', amountCents: 0,
}
const cancelled = { ...pendingOrder, taskStatus: 'cancelled', pickupCode: null, pickupStatus: 'expired' }

function setup() {
  const requests = [], timers = [], cancellations = [], delays = []
  let user = { id: 'A' }
  const auth = { isLoggedIn: () => !!user, getUser: () => user }
  const api = {
    getCloudPrintOrder(id) {
      assert.equal(id, 'order-A')
      const d = deferred(); requests.push(d); return d.promise
    },
    cancelCloudPrintOrder() {
      const d = deferred(); cancellations.push(d); return d.promise
    },
  }
  const page = instantiate(loadPageDefinition('pages/order-detail/order-detail.js', {
    wx: { showModal() {} }, modules: { api, auth }, timers,
  }))
  const queuePoll = page._queuePoll
  page._queuePoll = function (delay) { delays.push(delay); queuePoll.call(this, delay) }
  page.onLoad({ orderId: 'order-A' }); page.onShow()
  return { page, requests, timers, cancellations, delays, setUser: next => { user = next } }
}

test('visible detail follows the same order through printing and completion without loading flicker', async () => {
  const { page, requests, timers } = setup()
  requests[0].resolve(pendingOrder); await flush()
  assert.equal(page.data.detail.pickup, '12-34-56-78')
  timers[0]()
  assert.equal(page.data.loading, false)
  assert.equal(requests.length, 2)
  requests[1].resolve({ ...pendingOrder, taskStatus: 'printing', pickupCode: null }); await flush()
  assert.equal(page.data.detail.statusLabel, '打印中')
  timers[1]()
  requests[2].resolve({ ...pendingOrder, taskStatus: 'completed', pickupCode: null }); await flush()
  assert.equal(page.data.detail.statusLabel, '已完成')
  assert.equal(timers.length, 2)
  timers[0](); timers[1]()
  assert.equal(requests.length, 3, 'stale timers cannot resurrect polling after completion')
})

for (const lifecycle of ['onHide', 'onUnload']) {
  test(`${lifecycle} invalidates queued timer and clears order data`, async () => {
    const { page, requests, timers } = setup()
    requests[0].resolve(pendingOrder); await flush()
    page[lifecycle](); timers[0]()
    assert.equal(requests.length, 1)
    assert.equal(page.data.detail, null)
  })
}

test('hide/show invalidates an old timer even after the page becomes active again', async () => {
  const { page, requests, timers } = setup()
  requests[0].resolve(pendingOrder); await flush()
  page.onHide(); page.onShow()
  requests[1].resolve(pendingOrder); await flush()
  timers[0]()
  assert.equal(requests.length, 2)
  timers[1]()
  assert.equal(requests.length, 3)
})

for (const nextUser of [null, { id: 'B' }]) {
  test(`poll stops and clears credentials after ${nextUser ? 'account switch' : 'logout'}`, async () => {
    const { page, requests, timers, setUser } = setup()
    requests[0].resolve(pendingOrder); await flush()
    setUser(nextUser); timers[0]()
    assert.equal(requests.length, 1)
    assert.equal(page.data.detail, null)
  })
}

for (const retryState of [{ reprintAllowed: true }, { reprintAllowed: false, reprintNotice: 'may_have_printed' }]) {
  test(`failed order keeps refreshing when retry can resume: ${JSON.stringify(retryState)}`, async () => {
    const { page, requests, timers } = setup()
    requests[0].resolve({ ...pendingOrder, taskStatus: 'failed', ...retryState }); await flush()
    assert.equal(timers.length, 1)
    timers[0]()
    requests[1].resolve({ ...pendingOrder, taskStatus: 'printing' }); await flush()
    assert.equal(page.data.detail.statusLabel, '打印中')
  })
}

for (const status of ['cancelled', 'expired', 'abandoned', 'failed']) {
  test(`${status} without retry authority stops automatic refresh`, async () => {
    const { requests, timers } = setup()
    requests[0].resolve({ ...pendingOrder, taskStatus: status }); await flush()
    assert.equal(timers.length, 0)
  })
}

test('transient poll failure preserves detail with stale-data notice and recovers automatically', async () => {
  const { page, requests, timers } = setup()
  requests[0].resolve(pendingOrder); await flush()
  timers[0](); requests[1].reject({ statusCode: -1, message: '暂时无法查询' }); await flush()
  assert.equal(page.data.error, '')
  assert.equal(page.data.detail.pickup, '12-34-56-78')
  assert.match(page.data.refreshNotice, /上次查询结果/)
  assert.equal(page.data.loading, false)
  assert.equal(timers.length, 2)
  timers[1]()
  assert.match(page.data.refreshNotice, /上次查询结果/, 'retry in flight must retain stale-data notice')
  requests[2].resolve(pendingOrder); await flush()
  assert.equal(page.data.refreshNotice, '')
  assert.equal(timers.length, 3)
})

test('cancel success invalidates in-flight polling and cannot restore a cancelled pickup code', async () => {
  const { page, requests, timers, cancellations } = setup()
  requests[0].resolve(pendingOrder); await flush()
  timers[0](); page._submitCancel()
  cancellations[0].resolve(cancelled); await flush()
  requests[1].resolve(pendingOrder); await flush()
  timers[0]()
  assert.equal(page.data.detail.statusLabel, '已取消')
  assert.equal(page.data.detail.pickup, '')
  assert.equal(requests.length, 2)
})

test('cancel failure releases the lock and refreshes authoritative order state', async () => {
  const { page, requests, timers, cancellations } = setup()
  requests[0].resolve(pendingOrder); await flush()
  page._submitCancel(); timers[0]()
  assert.equal(requests.length, 1)
  cancellations[0].reject(new Error('取消失败')); await flush()
  assert.equal(page._cancelLock, false)
  assert.equal(requests.length, 2)
  requests[1].resolve(pendingOrder); await flush()
  assert.equal(timers.length, 2)
})


test('an old poll response cannot overwrite completion after hide/show', async () => {
  const { page, requests, timers } = setup()
  requests[0].resolve(pendingOrder); await flush()
  timers[0](); page.onHide(); page.onShow()
  requests[2].resolve({ ...pendingOrder, taskStatus: 'completed', pickupCode: null }); await flush()
  requests[1].resolve(pendingOrder); await flush()
  assert.equal(page.data.detail.statusLabel, '已完成')
  assert.equal(page.data.detail.pickup, '')
  assert.equal(timers.length, 1)
})

test('backend retry authority may change during cooldown before the same order completes', async () => {
  const { page, requests, timers } = setup()
  requests[0].resolve({ ...pendingOrder, taskStatus: 'failed', pickupStatus: 'redeemed',
    pickupCode: null, reprintAllowed: false, reprintNotice: 'may_have_printed' }); await flush()
  assert.equal(page.data.detail.pickup, '')
  timers[0]()
  requests[1].resolve({ ...pendingOrder, taskStatus: 'failed', pickupStatus: 'redeemed',
    reprintAllowed: true, reprintNotice: 'may_have_printed' }); await flush()
  assert.equal(page.data.detail.pickup, '12-34-56-78')
  timers[1]()
  requests[2].resolve({ ...pendingOrder, taskStatus: 'printing', pickupCode: null }); await flush()
  timers[2]()
  requests[3].resolve({ ...pendingOrder, taskStatus: 'completed', pickupCode: null }); await flush()
  assert.equal(page.data.detail.statusLabel, '已完成')
  assert.equal(timers.length, 3)
})


test('repeated transient failures have bounded exponential backoff and manual recovery', async () => {
  const { page, requests, timers, delays } = setup()
  requests[0].resolve(pendingOrder); await flush()
  for (let i = 0; i < 4; i += 1) {
    timers[i](); requests[i + 1].reject({ statusCode: 503, message: 'busy' }); await flush()
  }
  assert.deepEqual(delays, [3000, 6000, 12000, 24000])
  assert.equal(timers.length, 4)
  assert.equal(page.data.error, '')
  assert.match(page.data.refreshNotice, /点此刷新/)
  page.retry(); requests[5].resolve(pendingOrder); await flush()
  assert.equal(page.data.refreshNotice, '')
  assert.equal(timers.length, 5)
})

test('permission failure never starts automatic network retry', async () => {
  const { page, requests, timers } = setup()
  requests[0].resolve(pendingOrder); await flush()
  timers[0](); requests[1].reject({ statusCode: 403, message: '无权查看' }); await flush()
  assert.equal(page.data.error, '无权查看')
  assert.equal(timers.length, 1)
})

for (const taskStatus of ['', 'unknown_state', 'refunded']) {
  test(`unknown/non-active task status ${taskStatus} does not poll`, async () => {
    const { requests, timers } = setup()
    requests[0].resolve({ ...pendingOrder, taskStatus }); await flush()
    assert.equal(timers.length, 0)
  })
}

test('automatic polling has a per-view budget; manual retry starts a new budget', async () => {
  const { page, requests, timers } = setup()
  requests[0].resolve(pendingOrder); await flush()
  for (let i = 0; i < 200; i += 1) {
    timers[i](); requests[i + 1].resolve(pendingOrder); await flush()
  }
  assert.equal(timers.length, 200)
  assert.match(page.data.refreshNotice, /自动刷新已暂停/)
  timers[199]()
  assert.equal(requests.length, 201)
  page.retry(); requests[201].resolve(pendingOrder); await flush()
  assert.equal(timers.length, 201)
})

test('cancel across hide/show cannot leave cancelling stuck after refresh fails', async () => {
  const { page, requests, timers, cancellations } = setup()
  requests[0].resolve(pendingOrder); await flush()
  page._submitCancel(); page.onHide(); page.onShow()
  requests[1].resolve(pendingOrder); await flush()
  assert.equal(page.data.cancelling, true)
  assert.equal(timers.length, 1, 'no poll scheduled while cancel is in flight')
  cancellations[0].reject(new Error('cancel failed')); await flush()
  requests[2].reject({ statusCode: 503 }); await flush()
  assert.equal(page._cancelLock, false)
  assert.equal(page.data.cancelling, false)
  assert.match(page.data.refreshNotice, /上次查询结果/)
})

test('silent cancellation recovery without detail still renders loading', async () => {
  const { page, requests, cancellations } = setup()
  requests[0].resolve(pendingOrder); await flush()
  page._submitCancel(); page.onHide(); page.onShow()
  cancellations[0].reject(new Error('cancel failed')); await flush()
  assert.equal(page.data.detail, null)
  assert.equal(page.data.loading, true)
  requests[2].reject({ statusCode: 503 }); await flush()
  assert.equal(page.data.cancelling, false)
  assert.equal(page.data.loading, false)
})


test('manual refresh from a stale-data notice keeps the arrival code even while offline', async () => {
  const { page, requests, timers } = setup()
  requests[0].resolve(pendingOrder); await flush()
  for (let i = 0; i < 4; i += 1) {
    timers[i](); requests[i + 1].reject({ statusCode: 503 }); await flush()
  }
  const notice = page.data.refreshNotice
  page.refreshDetail()
  assert.equal(page.data.loading, false)
  assert.equal(page.data.detail.pickup, '12-34-56-78')
  assert.equal(page.data.refreshNotice, notice)
  assert.equal(page._pollCount, 0)
  assert.equal(page._pollErrors, 0)
  requests[5].reject({ statusCode: -1, message: 'offline' }); await flush()
  assert.equal(page.data.error, '')
  assert.equal(page.data.detail.pickup, '12-34-56-78')
  assert.match(page.data.refreshNotice, /上次查询结果/)
  assert.equal(timers.length, 5)
})

test('manual stale-data refresh still fails closed after an account switch', async () => {
  const { page, requests, setUser } = setup()
  requests[0].resolve(pendingOrder); await flush()
  setUser({ id: 'B' }); page.refreshDetail()
  assert.equal(requests.length, 1)
  assert.equal(page.data.detail, null)
})

test('notice template uses quiet refresh while the error card retains full retry', async () => {
  const { readFileSync } = await import('node:fs')
  const template = readFileSync(new URL('../../pages/order-detail/order-detail.wxml', import.meta.url), 'utf8')
  assert.match(template, /wx:if="\{\{refreshNotice\}\}" bindtap="refreshDetail"/)
  assert.match(template, /wx:elif="\{\{error\}\}" bindtap="retry"/)
  assert.match(template, /这单有问题，去反馈/)
  assert.match(template, /bindtap="toFeedback"/)
})

const FREE_PENDING = {
  id: 'order-free', orderNo: 'NO-FREE', payStatus: 'paid', paymentSource: 'free',
  amountCents: 0, paidAt: '2026-11-01T00:00:00.000Z', pickupStatus: 'pending',
  printTaskId: null, pickupCode: '12345678', fileName: 'free.pdf', taskStatus: 'pending_release',
}

function detailWith(raw, extraWx) {
  const requests = []
  const modals = []
  const nav = []
  const cancels = []
  const auth = { isLoggedIn: () => true, getUser: () => ({ id: 'A' }) }
  const api = {
    getCloudPrintOrder() { const d = deferred(); requests.push(d); return d.promise },
    cancelCloudPrintOrder(id) { cancels.push(id); return Promise.resolve({ ...raw, pickupStatus: 'cancelled', taskStatus: 'cancelled', pickupCode: null }) },
  }
  const wx = Object.assign({
    showModal(opts) { modals.push(opts) },
    navigateTo(opts) { nav.push(opts && opts.url) },
    navigateBack() {},
  }, extraWx)
  const page = instantiate(loadPageDefinition('pages/order-detail/order-detail.js', { wx, modules: { auth, api } }))
  page.onLoad({ orderId: raw.id })
  page.onShow()
  return { page, requests, modals, nav, cancels }
}

test('免费且还没取的单能取消；确认句不写付款或退款；确认后刷新', async () => {
  const { page, requests, modals, cancels } = detailWith(FREE_PENDING)
  requests[0].resolve(FREE_PENDING); await flush()
  assert.equal(page.data.detail.canCancel, true)
  page.cancelOrder()
  assert.equal(modals.length, 1)
  assert.match(modals[0].content, /确定取消这张免费订单/)
  assert.doesNotMatch(modals[0].content, /付款|退款/)
  modals[0].success({ confirm: true })
  await flush()
  assert.deepEqual(cancels, ['order-free'])
  assert.equal(page.data.detail.canCancel, false, '取消回包落地后按钮收起')
})

test('未付款待取件仍可取消，确认句仍是未付款；已取、已有任务、非免费已付、已收款的关单不能取消', async () => {
  const unpaid = { ...FREE_PENDING, id: 'order-unpaid', payStatus: 'unpaid', paymentSource: null, paidAt: null, amountCents: 100 }
  const open = detailWith(unpaid)
  open.requests[0].resolve(unpaid); await flush()
  assert.equal(open.page.data.detail.canCancel, true)
  open.page.cancelOrder()
  assert.match(open.modals[0].content, /确定取消这张未付款订单/)

  const blocked = [
    { ...FREE_PENDING, pickupStatus: 'claimed' },
    { ...FREE_PENDING, printTaskId: 'task-1' },
    { ...FREE_PENDING, payStatus: 'paid', paymentSource: 'offline', amountCents: 0 },
    { ...FREE_PENDING, payStatus: 'paid', paymentSource: 'free', amountCents: 100 },
    { ...FREE_PENDING, payStatus: 'closed', paidAt: '2026-11-01T00:00:00.000Z', paymentSource: 'offline', amountCents: 100 },
    { ...FREE_PENDING, status: 'completed', payStatus: 'paid' },
  ]
  for (const raw of blocked) {
    const box = detailWith(raw)
    box.requests[0].resolve(raw); await flush()
    assert.equal(box.page.data.detail.canCancel, false, JSON.stringify({
      pay: raw.payStatus, source: raw.paymentSource, pickup: raw.pickupStatus, task: raw.printTaskId, status: raw.status,
    }))
  }

  const closedUnpaid = { ...FREE_PENDING, payStatus: 'closed', paidAt: null, paymentSource: null, amountCents: 100 }
  const closed = detailWith(closedUnpaid)
  closed.requests[0].resolve(closedUnpaid); await flush()
  assert.equal(closed.page.data.detail.canCancel, true, '关单但从未收款、还没取，可以取消')
  closed.page.cancelOrder()
  assert.doesNotMatch(closed.modals[0].content, /付款|退款/)
})

test('订单详情去反馈带上订单号；反馈页显示订单号，不放进输入框', async () => {
  const { page, requests, nav } = detailWith(FREE_PENDING)
  requests[0].resolve(FREE_PENDING); await flush()
  page.toFeedback()
  assert.equal(nav.length, 1)
  assert.match(nav[0], /\/pages\/feedback\/feedback\?/)
  assert.match(nav[0], /category=print/)
  assert.match(nav[0], /orderNo=NO-FREE/)

  const auth = { isLoggedIn: () => true }
  const feedback = instantiate(loadPageDefinition('pages/feedback/feedback.js', {
    wx: { showToast() {}, navigateTo() {}, navigateBack() {}, switchTab() {} },
    modules: { auth, api: { getMyFeedback: () => Promise.resolve([]) } },
  }))
  feedback.onLoad({ category: 'print', orderNo: 'NO-FREE' })
  assert.equal(feedback.data.category, 'print')
  assert.equal(feedback.data.content, '')
  assert.match(feedback.data.orderNo, /NO-FREE/)
  assert.match(feedback.data.title, /NO-FREE/)
  assert.equal(feedback.data.title, '订单 NO-FREE')
  assert.doesNotMatch(feedback.data.content, /付款|退款/)
  assert.doesNotMatch(feedback.data.orderNo, /付款|退款/)
  const wxml = readFileSync(new URL('../../pages/feedback/feedback.wxml', import.meta.url), 'utf8')
  const noteAt = wxml.indexOf('<view class="fb-note" wx:if="{{orderNo}}">这单：订单 {{orderNo}}</view>')
  const areaAt = wxml.indexOf('<textarea class="fb-area"')
  assert.ok(noteAt >= 0, '只读说明用 fb-note 写出这单和订单号')
  assert.ok(areaAt > noteAt, '订单号说明在输入框上方')
  assert.doesNotMatch(wxml, /contentPrefill|订单号已写在开头/)
})

test('订单列表：免费待取单能取消，确认后用回包刷新这一行', async () => {
  const modals = []
  const cancels = []
  const auth = { isLoggedIn: () => true, getUser: () => ({ id: 'A' }) }
  const refreshed = { ...FREE_PENDING, pickupStatus: 'cancelled', taskStatus: 'cancelled', pickupCode: null }
  const api = {
    getMyCloudPrintOrders: () => Promise.resolve([FREE_PENDING]),
    getMyPrintOrders: () => Promise.resolve([]),
    getPackageOrders: () => Promise.resolve({ items: [], total: 0 }),
    cancelCloudPrintOrder(id) { cancels.push(id); return Promise.resolve(refreshed) },
  }
  const wx = { showModal(opts) { modals.push(opts) }, stopPullDownRefresh() {}, navigateTo() {}, navigateBack() {}, switchTab() {} }
  const page = instantiate(loadPageDefinition('pages/orders/orders.js', { wx, modules: { auth, api } }))
  page.onLoad(); page.onShow(); await flush()
  const row = page.data.filtered.find((item) => item.id === 'order-free')
  assert.equal(row.canCancel, true)
  page.cancelOrder({ currentTarget: { dataset: { id: 'order-free' } } })
  assert.match(modals[0].content, /免费订单/)
  assert.doesNotMatch(modals[0].content, /付款|退款/)
  modals[0].success({ confirm: false })
  assert.equal(cancels.length, 0, '再想想不取消')
  modals[0].success({ confirm: true })
  await flush()
  assert.deepEqual(cancels, ['order-free'])
  const next = page.data.orders.find((item) => item.id === 'order-free')
  assert.equal(next.canCancel, false)
  assert.equal(next.statusLabel, '已取消')
})

function extractFunction(rel, name) {
  const src = readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
  const start = src.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `${rel} 里要有 ${name}`)
  let depth = 0
  let end = -1
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    const ch = src[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) { end = i; break }
    }
  }
  assert.ok(end > start, `${rel} 的 ${name} 没有成对括号`)
  return vm.runInNewContext(`${src.slice(start, end + 1)}\n${name}`)
}

// 照抄 member-print-order-create.service.ts cancel()（约 383–387 行）的放行条件。
// 能取消：没有打印任务、取件仍是 pending，并且是未付款、免费已入账，或关单但从未收款。
function serverCanCancel(order) {
  const freeOrder = order.amountCents === 0 && order.payStatus === 'paid' && order.paymentSource === 'free'
  const closedUnpaid = order.payStatus === 'closed' && !order.paidAt
  if (order.printTaskId || order.pickupStatus !== 'pending' || (order.payStatus !== 'unpaid' && !freeOrder && !closedUnpaid)) {
    return false
  }
  return true
}

test('列表页和详情页的取消放行与服务端 cancel() 同一组输入结论一致', () => {
  const listCan = extractFunction('pages/orders/orders.js', 'canCancelCloudOrder')
  const detailCan = extractFunction('pages/order-detail/order-detail.js', 'canCancelCloudOrder')
  const listSrc = readFileSync(new URL('../../pages/orders/orders.js', import.meta.url), 'utf8')
  const detailSrc = readFileSync(new URL('../../pages/order-detail/order-detail.js', import.meta.url), 'utf8')
  assert.match(listSrc, /canCancel:\s*canCancelCloudOrder\(item\)/)
  assert.match(detailSrc, /canCancel:\s*canCancelCloudOrder\(raw\)/)

  const printTaskIds = [null, 'task-1']
  const pickupStatuses = ['pending', 'claimed', 'cancelled', 'expired']
  const amounts = [0, 100]
  const payStatuses = ['unpaid', 'paid', 'closed', 'paying']
  const sources = [null, 'free', 'offline']
  const paidAts = [null, '2026-11-01T00:00:00.000Z']
  let n = 0
  for (const printTaskId of printTaskIds) {
    for (const pickupStatus of pickupStatuses) {
      for (const amountCents of amounts) {
        for (const payStatus of payStatuses) {
          for (const paymentSource of sources) {
            for (const paidAt of paidAts) {
              const input = { printTaskId, pickupStatus, amountCents, payStatus, paymentSource, paidAt }
              const server = serverCanCancel(input)
              assert.equal(listCan(input), server, `列表 ${JSON.stringify(input)}`)
              assert.equal(detailCan(input), server, `详情 ${JSON.stringify(input)}`)
              n += 1
            }
          }
        }
      }
    }
  }
  assert.equal(n, 384)

  // 列表把云订单和历史 PrintTask 拼在一起。PrintTask 行带 status，云订单视图不返回 status。
  // 服务端 cancel() 只接收 Order，不看 status。小程序用 status 排除这些历史行。
  const historical = {
    printTaskId: null,
    pickupStatus: 'pending',
    amountCents: 0,
    payStatus: 'paid',
    paymentSource: 'free',
    paidAt: '2026-11-01T00:00:00.000Z',
    status: 'completed',
  }
  assert.equal(serverCanCancel(historical), true)
  assert.equal(listCan(historical), false)
  assert.equal(detailCan(historical), false)
})

test('订单反馈：订单号不在输入框里，不满 10 字不能提交', async () => {
  const toasts = []
  const sent = []
  const auth = { isLoggedIn: () => true }
  const feedback = instantiate(loadPageDefinition('pages/feedback/feedback.js', {
    wx: { showToast(o) { toasts.push(o) }, navigateTo() {}, navigateBack() {}, switchTab() {} },
    modules: {
      auth,
      api: {
        getMyFeedback: () => Promise.resolve([]),
        createFeedback(body) { sent.push(body); return Promise.resolve({ id: 'fb-1' }) },
      },
    },
  }))
  const orderNo = 'ZYD202611120001'
  feedback.onLoad({ category: 'print', orderNo })
  const prefix = `订单 ${orderNo} 有问题：`
  assert.match(prefix, new RegExp(orderNo))
  assert.match(feedback.data.orderNo, new RegExp(orderNo))
  assert.equal(feedback.data.content, '')
  assert.ok(prefix.length >= 10, '订单号说明本身已经超过 10 字')
  assert.equal(feedback.data.contentLen, 0)
  assert.equal(feedback.data.canSubmit, false)
  feedback.submit()
  assert.equal(sent.length, 0)
  assert.equal(toasts[0].title, '请写一下遇到的问题')

  const nine = '一二三四五六七八九'
  assert.equal(nine.length, 9)
  feedback.onContent({ detail: { value: nine } })
  assert.equal(feedback.data.contentLen, nine.length)
  assert.equal(feedback.data.canSubmit, false)
  feedback.submit()
  assert.equal(sent.length, 0)

  const ten = '一二三四五六七八九十'
  assert.equal(ten.length, 10)
  feedback.onContent({ detail: { value: ten } })
  assert.equal(feedback.data.contentLen, ten.length)
  assert.equal(feedback.data.canSubmit, true)

  const own = '到机后没有出纸，屏幕停在取件'
  assert.ok(own.length >= 10)
  feedback.onContent({ detail: { value: own } })
  assert.equal(feedback.data.contentLen, own.length)
  assert.equal(feedback.data.canSubmit, true)
  feedback.submit()
  await flush()
  assert.equal(sent.length, 1)
  assert.equal(sent[0].content, prefix + own)
  assert.match(sent[0].content, new RegExp(orderNo))
  assert.equal(sent[0].category, 'print')
  assert.equal(sent[0].title, `订单 ${orderNo}`)
})
