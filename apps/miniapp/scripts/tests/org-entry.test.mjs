/**
 * 「一机构一码」官方采购联名入口单元测试（utils/org-entry.js + pages/home/home.js）。
 *
 * 覆盖 Codex 审查清单中的核心边界：
 *   - ?orgId= / 编码与未编码 scene=o=<id> / 多参数 / 重复参数 / 畸形百分号编码 / 越界字符拦截
 *   - 终端置顶排序保持相对顺序且不隐藏其他可用终端
 *   - 首页冷启动、热切换机构、404/停服清空旧缓存、异步乱序旧响应丢弃、用户手动恢复默认首页
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function createMemoryWx() {
  const store = new Map()
  const toasts = []
  return {
    store,
    toasts,
    wx: {
      getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
      setStorageSync: (k, v) => { store.set(k, v) },
      removeStorageSync: (k) => { store.delete(k) },
      showToast: (opt) => { toasts.push(opt) },
      showActionSheet: () => {},
      showModal: () => {},
      navigateTo: () => {},
      switchTab: () => {},
    },
  }
}

function loadCommonJs(relPath, wx, customRequire) {
  const full = path.join(ROOT, relPath)
  const mod = { exports: {} }
  const sandbox = { console, wx, Date, Object, Array, Set, Map, RegExp, Error, Promise, decodeURIComponent, encodeURIComponent }
  vm.createContext(sandbox)
  const fn = vm.compileFunction(fs.readFileSync(full, 'utf8'), ['module', 'exports', 'require'], { parsingContext: sandbox })
  fn(mod, mod.exports, customRequire)
  return mod.exports
}

function loadOrgEntryUtil(wx) {
  const storage = loadCommonJs('utils/storage.js', wx, () => { throw new Error('unexpected require') })
  const util = loadCommonJs('utils/org-entry.js', wx, (id) => {
    if (id === './storage') return storage
    throw new Error(`unexpected require: ${id}`)
  })
  return { storage, util }
}

function loadHomePage(wx, orgApiStub) {
  const { storage, util } = loadOrgEntryUtil(wx)
  const pageGuard = loadCommonJs('utils/page-guard.js', wx, () => { throw new Error('unexpected') })
  let pageConfig = null
  const sandbox = {
    console,
    wx,
    Date,
    Object,
    Array,
    Set,
    Map,
    Promise,
    encodeURIComponent,
    decodeURIComponent,
    getApp: () => ({ globalData: { statusBarHeight: 44, capsuleInsetRight: 94 } }),
    Page: (cfg) => { pageConfig = cfg },
  }
  vm.createContext(sandbox)
  const fn = vm.compileFunction(
    fs.readFileSync(path.join(ROOT, 'pages/home/home.js'), 'utf8'),
    ['module', 'exports', 'require'],
    { parsingContext: sandbox },
  )
  const mod = { exports: {} }
  fn(mod, mod.exports, (id) => {
    if (id === '../../utils/api') return {}
    if (id === '../../utils/auth') return { isLoggedIn: () => false, getUser: () => null }
    if (id === '../../utils/storage') return storage
    if (id === '../../utils/org-entry') return util
    if (id === '../../utils/api-org-entry') return orgApiStub
    if (id === '../../utils/page-guard') return pageGuard
    if (id === './pickup-summary') return { load: () => Promise.resolve({ pendingCount: 0, nearest: null, latestAt: '' }) }
    if (id === '../../utils/resume-optimize-entry') return { OPTIMIZE_URL: '/pages/resume-optimize/resume-optimize', cancelEntry: () => {}, openEntry: () => {} }
    throw new Error(`unexpected require in home.js: ${id}`)
  })
  const inst = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    setData(patch) { Object.assign(this.data, patch) },
  })
  return { inst, util, storage }
}

test('parseOrgIdFromLaunch 支持直链、编码/未编码 scene、多参数，拦截非法字符与畸形编码', () => {
  const { wx } = createMemoryWx()
  const { util } = loadOrgEntryUtil(wx)

  assert.equal(util.parseOrgIdFromLaunch({ orgId: 'org_qd_01' }), 'org_qd_01')
  assert.equal(util.parseOrgIdFromLaunch({ orgId: ['org_qd_01', 'org_other'] }), 'org_qd_01')
  assert.equal(util.parseOrgIdFromLaunch({ scene: 'o%3Dorg_qd_02' }), 'org_qd_02')
  assert.equal(util.parseOrgIdFromLaunch({ scene: 'v=1&o=org_qd_03&x=2' }), 'org_qd_03')
  assert.equal(util.parseOrgIdFromLaunch({ scene: '%E0%A4%A' }), '')
  assert.equal(util.parseOrgIdFromLaunch({ orgId: '../admin' }), '')
  assert.equal(util.parseOrgIdFromLaunch({ scene: `o=${'a'.repeat(31)}` }), '')
  assert.equal(util.parseOrgIdFromLaunch(null), '')
})

test('prioritizeOrgTerminals 将本机构终端置顶并打标，保留其余终端且不隐藏', () => {
  const { wx } = createMemoryWx()
  const { util } = loadOrgEntryUtil(wx)

  const list = [
    { id: 't1', displayName: '其他点位 A' },
    { id: 't2', displayName: '本机构二号机' },
    { id: 't3', displayName: '其他点位 B' },
    { id: 't4', displayName: '本机构一号机' },
  ]
  const sorted = util.prioritizeOrgTerminals(list, ['t2', 't4'])
  assert.deepEqual(
    Array.from(sorted, (x) => [x.id, x.isOrgTerminal]),
    [
      ['t2', true],
      ['t4', true],
      ['t1', false],
      ['t3', false],
    ],
  )
})

test('首页：冷启动加载联名、热切机构防旧异步响应覆盖、404 清空旧缓存、手动恢复默认生效', async () => {
  const { wx, store } = createMemoryWx()
  const pending = new Map()
  const orgApiStub = {
    getPublicOrgEntry: (orgId) => new Promise((resolve, reject) => {
      pending.set(orgId, { resolve, reject })
    }),
  }

  const { inst, util, storage } = loadHomePage(wx, orgApiStub)

  // 1. 冷启动扫码进入机构 A
  inst.onLoad({ scene: 'o%3Dorg_a' })
  inst.onShow()
  assert.ok(pending.has('org_a'))

  // 2. 在机构 A 响应返回前，用户热扫码切到机构 B
  util.rememberLaunchOrgId('org_b')
  inst.onShow()
  assert.ok(pending.has('org_b'))

  // 机构 B 先返回
  pending.get('org_b').resolve({
    orgId: 'org_b',
    orgName: '市南就业中心',
    brandName: '市南就业',
    brandMark: '南',
    terminals: [{ id: 't-b1', displayName: '市南大厅1号机', locationLabel: '一楼', isOnline: true }],
  })
  await new Promise((r) => setImmediate(r))
  assert.equal(inst.data.orgEntry.orgId, 'org_b')
  assert.equal(inst.data.orgTopTerminalName, '市南大厅1号机')

  // 机构 A 迟到响应必须被丢弃，不能盖掉机构 B
  pending.get('org_a').resolve({
    orgId: 'org_a',
    orgName: '旧机构 A',
    brandName: '旧机构',
    brandMark: '旧',
    terminals: [],
  })
  await new Promise((r) => setImmediate(r))
  assert.equal(inst.data.orgEntry.orgId, 'org_b', '迟到的旧机构响应不得覆盖新机构')
  assert.equal(store.get(storage.KEYS.ORG_ENTRY_CONTEXT).orgId, 'org_b')

  // 3. 热切到已停用/404 机构 C：必须清空旧展示与旧持久化缓存
  util.rememberLaunchOrgId('org_c')
  inst.onShow()
  assert.equal(inst.data.orgEntry, null, '切换期间立即清掉上一家机构的展示')
  pending.get('org_c').reject(Object.assign(new Error('not found'), { statusCode: 404 }))
  await new Promise((r) => setImmediate(r))
  assert.equal(inst.data.orgEntry, null)
  assert.equal(store.has(storage.KEYS.ORG_ENTRY_CONTEXT), false, '404 停服后必须清除本机机构偏好')

  // 4. 恢复联名后再手动点「恢复职易达默认首页」：作废在途请求并清空
  util.rememberLaunchOrgId('org_d')
  inst.onShow()
  inst.clearOrgMode()
  pending.get('org_d').resolve({
    orgId: 'org_d',
    orgName: '机构 D',
    brandName: '机构 D',
    brandMark: 'D',
    terminals: [],
  })
  await new Promise((r) => setImmediate(r))
  assert.equal(inst.data.orgEntry, null, '手动恢复默认后，迟到响应不得复活联名态')
  assert.equal(store.has(storage.KEYS.ORG_ENTRY_CONTEXT), false)
})
