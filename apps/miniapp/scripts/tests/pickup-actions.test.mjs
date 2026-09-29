/**
 * 到机码三个动作（utils/pickup-actions.js）。真跑模块，wx 与 api 是替身。
 *
 * 钉住的是会让人白跑一趟或让码流出去的几件事：
 *   - 复制、分享的都是原始码（服务端核销不去横杠，带横杠的串粘到别处核不上）；
 *   - 分享文字只有码、网点、有效期、怎么取，不带文件名、金额；
 *   - 作废换新码：用户点「先不换」一个请求都不发；换不了时说清为什么，不说成网络问题。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))

function load({ api, modalConfirm = true }) {
  const calls = { clipboard: [], modal: [], toast: [], loading: 0 }
  const wx = {
    setClipboardData: (o) => { calls.clipboard.push(o.data); if (o.success) o.success() },
    showModal: (o) => { calls.modal.push(o); if (o.success) o.success({ confirm: modalConfirm }) },
    showToast: (o) => { calls.toast.push(o.title) },
    showLoading: () => { calls.loading += 1 },
    hideLoading: () => {},
  }
  const sandbox = { console, wx }
  vm.createContext(sandbox)
  const file = path.join(MINIAPP, 'utils', 'pickup-actions.js')
  const mod = { exports: {} }
  const fn = vm.compileFunction(fs.readFileSync(file, 'utf8'), ['module', 'exports', 'require'], { parsingContext: sandbox })
  fn(mod, mod.exports, (id) => (id === './api' ? api : requireMiniapp(id)))
  return { m: mod.exports, calls }
}

test('复制的是原始码，不是屏幕上带横杠的那串', () => {
  const { m, calls } = load({ api: {} })
  m.copyCode('12-34-56-78')
  assert.equal(calls.clipboard[0], '12345678')
})

test('分享文字只有码、网点、有效期和取法', () => {
  const { m } = load({ api: {} })
  const text = m.shareText({ code: '12345678', outlet: '图书馆一楼', expiresText: '10 月 6 日 18:00' })
  assert.match(text, /12345678/)
  assert.match(text, /图书馆一楼/)
  assert.match(text, /用一次就失效/)
  assert.doesNotMatch(text, /元|\.pdf|简历/)
})

test('作废换新码：点「先不换」一个请求都不发', async () => {
  let called = 0
  const { m } = load({ api: { reissuePickupCode: () => { called += 1; return Promise.resolve({}) } }, modalConfirm: false })
  const out = await m.reissue('o1')
  assert.equal(out, null)
  assert.equal(called, 0)
})

test('作废换新码：确认后才请求；换不了时说清原因', async () => {
  const ok = load({ api: { reissuePickupCode: (id) => Promise.resolve({ id, pickupCode: '87654321' }) } })
  const order = await ok.m.reissue('o1')
  assert.equal(order.id, 'o1')
  assert.ok(ok.calls.toast.includes('已换成新码'))

  const refused = Object.assign(new Error('x'), { code: 'PICKUP_CODE_NOT_REISSUABLE', statusCode: 400 })
  const bad = load({ api: { reissuePickupCode: () => Promise.reject(refused) } })
  await assert.rejects(() => bad.m.reissue('o1'), (err) => {
    assert.match(err.message, /已在机器上核销|已开始出纸|已过期/)
    return true
  })
})
