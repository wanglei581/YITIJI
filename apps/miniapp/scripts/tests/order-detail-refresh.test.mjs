import assert from 'node:assert/strict'
import test from 'node:test'
import { deferred, flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const pendingOrder = {
  id: 'order-A', taskStatus: 'pending_release', payStatus: 'unpaid',
  pickupStatus: 'pending', pickupCode: '12345678', fileName: 'synthetic.pdf', amountCents: 0,
}
const cancelled = { ...pendingOrder, taskStatus: 'cancelled', pickupCode: null, pickupStatus: 'expired' }

function setup() {
  const requests = [], timers = [], cancellations = []
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
  page.onLoad({ orderId: 'order-A' }); page.onShow()
  return { page, requests, timers, cancellations, setUser: next => { user = next } }
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

test('network failure exposes retry and does not spin; manual retry resumes refresh', async () => {
  const { page, requests, timers } = setup()
  requests[0].resolve(pendingOrder); await flush()
  timers[0](); requests[1].reject(new Error('暂时无法查询')); await flush()
  assert.equal(page.data.error, '暂时无法查询')
  assert.equal(page.data.loading, false)
  assert.equal(timers.length, 1)
  page.retry(); requests[2].resolve(pendingOrder); await flush()
  assert.equal(page.data.error, '')
  assert.equal(timers.length, 2)
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
