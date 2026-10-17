/**
 * VIS3c（10/17）：
 *   - 待到机订单的详情只有「去我的文档打印」，没有直接看到机码的主操作（候选 ed73304 实图 14）；
 *   - 自我探索其余页面文字露出「服务端」（实图 29）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { deferred, flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MINIAPP, rel), 'utf8')
const stripComments = (src) => src.replace(/<!--[\s\S]*?-->/g, '')
const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))

const pendingOrder = {
  id: 'order-A', taskStatus: 'pending_release', payStatus: 'unpaid',
  pickupStatus: 'pending', pickupCode: '12345678', fileName: '王同学简历.pdf', amountCents: 0,
}

async function openDetail(raw) {
  const calls = { navigateTo: [] }
  const wx = { showModal() {}, showToast() {}, navigateTo: (o) => calls.navigateTo.push(o.url) }
  const requests = []
  const api = {
    getCloudPrintOrder() { const d = deferred(); requests.push(d); return d.promise },
    cancelCloudPrintOrder() { return deferred().promise },
  }
  const auth = { isLoggedIn: () => true, getUser: () => ({ id: 'A' }) }
  const page = instantiate(loadPageDefinition('pages/order-detail/order-detail.js', { wx, modules: { api, auth }, timers: [] }))
  page.onLoad({ orderId: 'order-A' })
  page.onShow()
  requests[0].resolve(raw)
  await flush()
  return { page, calls }
}

test('订单详情：待到机时有「查看到机码」，去取件页只带 orderId，码不进 URL', async () => {
  const { page, calls } = await openDetail(pendingOrder)
  assert.ok(page.data.detail.pickup, '待到机要有到机码')
  page.toPickup()
  assert.deepEqual([...calls.navigateTo], ['/pages/print-pickup/print-pickup?orderId=order-A&source=order-detail'])
  assert.doesNotMatch(calls.navigateTo[0], /12345678|12-34-56-78/)
})

test('订单详情：允许同码续打时同样给「查看到机码」', async () => {
  const { page } = await openDetail({ ...pendingOrder, taskStatus: 'completed', pickupStatus: 'used', reprintAllowed: true, pickupCode: '87654321' })
  assert.ok(page.data.detail.pickup, '允许续打时有到机码')
})

test('订单详情：没有到机码时不给「查看到机码」；没有 orderId 时不跳转', async () => {
  const { page, calls } = await openDetail({ ...pendingOrder, taskStatus: 'cancelled', pickupCode: null, pickupStatus: 'expired' })
  assert.equal(page.data.detail.pickup, '')
  page._orderId = ''
  page.toPickup()
  assert.equal(calls.navigateTo.length, 0)
})

test('订单详情模板：有码时「查看到机码」是主按钮、「去我的文档打印」降为次按钮；可取消时三个按钮并存，竖排', async () => {
  const { page } = await openDetail(pendingOrder)
  assert.equal(page.data.detail.canCancel, true, '待到机且可取消：三个按钮会同时出现')
  const wxml = stripComments(read('pages/order-detail/order-detail.wxml'))
  const acts = wxml.slice(wxml.indexOf('<view class="od-actions">'), wxml.indexOf('</view>', wxml.indexOf('<view class="od-actions">')))
  const cancel = acts.indexOf('bindtap="cancelOrder"')
  const docs = acts.indexOf('bindtap="toPrint"')
  const pickup = acts.indexOf('bindtap="toPickup"')
  assert.ok(cancel > 0 && docs > cancel && pickup > docs, '顺序：取消 → 去我的文档打印 → 查看到机码（主按钮放最后，沿用原写法）')
  assert.match(acts, /class="btn \{\{detail\.pickup \? 'ghost-ink' : 'primary'\}\} block tap"[^>]*bindtap="toPrint">去我的文档打印/)
  assert.match(acts, /<button wx:if="\{\{detail\.pickup\}\}" class="btn primary block tap"[^>]*bindtap="toPickup">查看到机码<\/button>/)
  const rule = read('pages/order-detail/order-detail.wxss').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(rule, /\.od-actions \{[^}]*flex-direction:\s*column/, '按钮竖排，不会横向挤压')
})

test('从订单详情进取件页：不算「从订单列表来」，返回按页面栈退一页回到详情', () => {
  const pickupState = requireMiniapp('../pages/print-pickup/pickup-state.js')
  assert.equal(pickupState.backDeltaPastOrderFlow(['pages/orders/orders', 'pages/order-detail/order-detail', 'pages/print-pickup/print-pickup']), 1)
  assert.match(read('pages/print-pickup/print-pickup.js'), /fromOrders: q\.source === 'orders'/)
})

test('自我探索：页面自己写的文字和提示里不再出现「服务端」；删除审计和不可恢复的说法保留', () => {
  const wxml = stripComments(read('pages/self-explore/self-explore.wxml'))
  const js = read('pages/self-explore/self-explore.js')
  const print = read('pages/self-explore/append-print.js')
  assert.equal((wxml.match(/服务端/g) || []).length, 0)
  const literals = (src) => (src.match(/'[^'\n]*'/g) || []).join('\n')
  assert.doesNotMatch(literals(js), /服务端/)
  assert.doesNotMatch(literals(print), /服务端/)
  for (const kept of ['并留下一条删除审计记录', '删除不可恢复', '并留有删除审计记录']) {
    assert.ok(wxml.includes(kept) || js.includes(kept), kept)
  }
  assert.match(wxml, /五维强度按固定权重算出，五段解读由 AI 生成/)
  assert.match(wxml, /'未记录版本号'/)
})
