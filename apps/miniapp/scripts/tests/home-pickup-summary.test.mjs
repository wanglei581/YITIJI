/**
 * 首页「待取件」卡片的归并规则（pages/home/pickup-summary.js）。真跑模块，api 是替身。
 *
 * 钉住的是会让用户白跑一趟或看错单的几件事：
 *   - 一体机历史任务（带 PrintTask.status）不算待取件；已过期、已核销、没下发码的不算；
 *   - 单件与材料包合在一起数，「最近一单」按到期时间最早的那一张；
 *   - 两处接口一处失败不连坐，两处都失败才算读不到（首页据此不出卡片）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../pages/home/pickup-summary.js')

function load(apiStub) {
  const mod = { exports: {} }
  const sandbox = { console }
  vm.createContext(sandbox)
  const fn = vm.compileFunction(fs.readFileSync(FILE, 'utf8'), ['module', 'exports', 'require'], { parsingContext: sandbox })
  fn(mod, mod.exports, () => apiStub)
  return mod.exports
}

const NOW = Date.parse('2026-09-29T10:00:00+08:00')
const iso = (hours) => new Date(NOW + hours * 3600 * 1000).toISOString()

test('只有未核销、未过期、服务端下发了码的单才算待取件', () => {
  const { collect } = load({})
  const cloud = [
    { id: 'o1', pickupStatus: 'pending', pickupCode: '12345678', pickupCodeExpiresAt: iso(48), createdAt: iso(-2), terminalDisplayName: '图书馆一楼' },
    { id: 'o2', pickupStatus: 'pending', pickupCode: '22345678', pickupCodeExpiresAt: iso(-1), createdAt: iso(-3) },
    { id: 'o3', pickupStatus: 'claimed', pickupCode: null, pickupCodeExpiresAt: iso(48), createdAt: iso(-1) },
    { id: 't1', status: 'pending', pickupStatus: 'pending', pickupCode: '32345678', pickupCodeExpiresAt: iso(48), createdAt: iso(-1) },
  ]
  const pkgs = [
    { orderId: 'p1', pickupStatus: 'pending', pickupCode: '42345678', expiresAt: iso(5), createdAt: iso(-4) },
    { orderId: 'p2', pickupStatus: 'pending', pickupCode: null, expiresAt: iso(5), createdAt: iso(-4) },
  ]
  const sum = collect(cloud, pkgs, NOW)
  assert.equal(sum.pendingCount, 2, '只算 o1 与 p1')
  assert.equal(sum.nearest.orderId, 'p1', '最近一单按最早到期')
  assert.equal(sum.nearest.kind, 'package')
  assert.equal(sum.nearest.remain, '5 小时后到期')
})

test('没有待取件时给最近订单日期，完全没有订单时什么都不给', () => {
  const { collect } = load({})
  const sum = collect([{ id: 'o3', pickupStatus: 'used', createdAt: '2026-09-20T02:00:00Z' }], [], NOW)
  assert.equal(sum.pendingCount, 0)
  assert.equal(sum.nearest, null)
  assert.equal(sum.latestAt, '9 月 20 日')
  const empty = collect([], [], NOW)
  assert.equal(empty.latestAt, '')
})

test('单件与材料包各去各的取件页，都只带 orderId', () => {
  const { pickupUrl } = load({})
  assert.equal(pickupUrl({ kind: 'print', orderId: 'a b' }), '/pages/print-pickup/print-pickup?orderId=a%20b')
  assert.equal(pickupUrl({ kind: 'package', orderId: 'p1' }), '/pages/package-code/package-code?orderId=p1')
  assert.equal(pickupUrl(null), '')
})

test('一处接口失败不连坐，两处都失败才算读不到', async () => {
  const future = new Date(Date.now() + 48 * 3600 * 1000).toISOString()
  const oneFails = load({
    getMyCloudPrintOrders: () => Promise.reject(new Error('x')),
    getPackageOrders: () => Promise.resolve({ items: [{ orderId: 'p1', pickupStatus: 'pending', pickupCode: '1', expiresAt: future }] }),
  })
  const sum = await oneFails.load()
  assert.equal(sum.pendingCount, 1)
  const bothFail = load({
    getMyCloudPrintOrders: () => Promise.reject(new Error('x')),
    getPackageOrders: () => Promise.reject(new Error('y')),
  })
  await assert.rejects(() => bothFail.load())
})
