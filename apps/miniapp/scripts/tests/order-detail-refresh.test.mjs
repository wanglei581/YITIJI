import assert from 'node:assert/strict'
import test from 'node:test'
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
})
