/**
 * 会员服务单钩子跨用户/登出分页竞态与打印实付扣减单测（P2c2b）：
 *   1. 直接转译运行真实 src/pages/profile/me/orders/useMemberServiceOrders.ts（极简 React Hook 夹具 + 可控 Promise）：
 *      - S1：A 发起 loadMore → 切到 B → B 首页先返回 → 释放 A 旧分页，断言绝不混入 A 单且 serviceTotal 不被覆盖；
 *      - S2：A 发起 loadMore → 登出（isLoggedIn=false）→ 释放旧响应，列表保持空且 total=0；
 *      - S3：getToken 引用恒定（模拟 AuthProvider useCallback(..., [])），仅 user.id A→B 切换时同步清空并立即重拉 B，绝不残留 A 单；
 *      - S4：组件卸载后释放挂起响应，不写入状态、不抛错。
 *   2. 直接转译运行 orderInvoiceCopy.ts，断言 effectivePrintPayableCents 部分抵扣与全额抵扣口径。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const transpile = (rel) => ts.transpileModule(readFileSync(join(kioskRoot, rel), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: rel,
}).outputText

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function makeOrder(id, createdAt = '2026-11-21T05:00:00.000Z') {
  return {
    id,
    serviceKey: 'resume_optimize',
    serviceName: 'AI 简历优化',
    status: 'paid',
    amountCents: 100,
    paidAt: createdAt,
    settledAt: null,
    refundedAt: null,
    refundReason: null,
    createdAt,
    canInvoice: true,
    invoiceStatus: 'none',
    invoiceRequestId: null,
  }
}

async function flushMicrotasks(rounds = 8) {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve()
}

// 1) 编译真实 orderInvoiceCopy.ts（仅替换外部 helper）
const copyUrl = toDataUrl(
  transpile('src/pages/profile/me/orders/orderInvoiceCopy.ts')
    .replaceAll(
      "from '../../../../hooks/kioskHomeFreeBadgeReader'",
      `from '${toDataUrl('export function kioskEffectivePricesCharged(c) { return Boolean(c?.pricing?.effective?.resume_optimize > 0) }')}'`,
    ),
)
const copyMod = await import(copyUrl)

// 2) 编译真实 useMemberServiceOrders.ts（按全局 env 路由 React / API，每次测试隔离）
const bridgeKey = '__P2C2B_RACE_HARNESS__'
const hookUrl = toDataUrl(
  transpile('src/pages/profile/me/orders/useMemberServiceOrders.ts')
    .replaceAll("from 'react'", `from '${toDataUrl(`
      const h = () => globalThis.${bridgeKey}.react
      export const useCallback = (...a) => h().useCallback(...a)
      export const useEffect = (...a) => h().useEffect(...a)
      export const useRef = (...a) => h().useRef(...a)
      export const useState = (...a) => h().useState(...a)
    `)}'`)
    .replaceAll("from '../../../../services/api/memberServiceOrders'", `from '${toDataUrl(`
      export const getMyServiceOrders = (...a) => globalThis.${bridgeKey}.getMyServiceOrders(...a)
    `)}'`)
    .replaceAll("from '../../../../services/api/terminalConfig'", `from '${toDataUrl(`
      export const getTerminalId = () => globalThis.${bridgeKey}.getTerminalId()
      export const getCachedKioskTerminalConfig = (...a) => globalThis.${bridgeKey}.getCachedKioskTerminalConfig(...a)
    `)}'`)
    .replaceAll("from './orderInvoiceCopy'", `from '${copyUrl}'`),
)
const { useMemberServiceOrders } = await import(hookUrl)

function createHarness(onGetMyServiceOrders) {
  let cursor = 0
  const slots = []
  const pendingEffects = []
  const cleanups = new Map()
  let latest = null
  let unmounted = false
  let currentProps = { isLoggedIn: false, getToken: () => null, reloadKey: 0, endUserId: null }

  function depsChanged(prev, next) {
    if (!prev || !next) return true
    if (prev.length !== next.length) return true
    for (let i = 0; i < prev.length; i += 1) if (!Object.is(prev[i], next[i])) return true
    return false
  }

  let rendering = false
  let dirty = false
  function render() {
    if (unmounted) return latest
    if (rendering) { dirty = true; return latest }
    rendering = true
    try {
      do {
        dirty = false
        cursor = 0
        latest = useMemberServiceOrders(
          currentProps.isLoggedIn,
          currentProps.getToken,
          currentProps.reloadKey,
          currentProps.endUserId,
        )
        while (pendingEffects.length > 0) {
          const eff = pendingEffects.shift()
          const prevCleanup = cleanups.get(eff.idx)
          if (typeof prevCleanup === 'function') prevCleanup()
          cleanups.set(eff.idx, eff.fn())
        }
      } while (dirty && !unmounted)
    } finally {
      rendering = false
    }
    return latest
  }

  globalThis[bridgeKey] = {
    react: {
      useState(init) {
        const idx = cursor++
        if (slots[idx] === undefined) slots[idx] = typeof init === 'function' ? init() : init
        const setState = (val) => {
          if (unmounted) return
          const next = typeof val === 'function' ? val(slots[idx]) : val
          if (!Object.is(next, slots[idx])) {
            slots[idx] = next
            render()
          }
        }
        return [slots[idx], setState]
      },
      useRef(init) {
        const idx = cursor++
        if (slots[idx] === undefined) slots[idx] = { current: init }
        return slots[idx]
      },
      useCallback(fn, deps) {
        const idx = cursor++
        if (!slots[idx] || depsChanged(slots[idx].deps, deps)) slots[idx] = { fn, deps }
        return slots[idx].fn
      },
      useEffect(fn, deps) {
        const idx = cursor++
        if (!slots[idx] || depsChanged(slots[idx].deps, deps)) {
          slots[idx] = { deps }
          pendingEffects.push({ idx, fn })
        }
      },
    },
    getMyServiceOrders: onGetMyServiceOrders,
    getTerminalId: () => 'KSK-001',
    getCachedKioskTerminalConfig: async () => ({ pricing: { effective: { resume_optimize: 100 } } }),
  }

  return {
    update(props) {
      currentProps = { ...currentProps, ...props }
      return render()
    },
    state: () => latest,
    unmount() {
      unmounted = true
      for (const cleanup of cleanups.values()) if (typeof cleanup === 'function') cleanup()
      cleanups.clear()
    },
  }
}

test('S1：A 发起 loadMore → 切到 B → B 首页先回 → 释放 A 旧分页，绝不混入 A 单且不覆盖 total', async () => {
  const aPage2 = deferred()
  let activeToken = 'tok-A'
  const stableGetToken = () => activeToken
  const calls = []

  const h = createHarness((token, opts) => {
    calls.push({ token, cursor: opts?.cursor ?? null })
    if (token === 'tok-A' && !opts?.cursor) {
      return Promise.resolve({ items: [makeOrder('A-1')], nextCursor: 'cur-A-1', total: 2 })
    }
    if (token === 'tok-A' && opts?.cursor === 'cur-A-1') {
      return aPage2.promise
    }
    if (token === 'tok-B' && !opts?.cursor) {
      return Promise.resolve({ items: [makeOrder('B-1')], nextCursor: null, total: 1 })
    }
    throw new Error(`unexpected call ${token} ${opts?.cursor}`)
  })

  try {
    h.update({ isLoggedIn: true, getToken: stableGetToken, reloadKey: 0, endUserId: 'user-A' })
    await flushMicrotasks()
    assert.deepEqual(h.state().serviceOrders.map((x) => x.id), ['A-1'])
    assert.equal(h.state().serviceTotal, 2)

    // A 发起 loadMoreServices（请求挂起）
    h.state().loadMoreServices()
    assert.equal(h.state().loadingMoreServices, true)

    // 切到 B（同引用 getToken，endUserId 与返回值切换）
    activeToken = 'tok-B'
    h.update({ isLoggedIn: true, getToken: stableGetToken, reloadKey: 0, endUserId: 'user-B' })
    await flushMicrotasks()
    assert.deepEqual(h.state().serviceOrders.map((x) => x.id), ['B-1'])
    assert.equal(h.state().serviceTotal, 1)
    assert.equal(h.state().loadingMoreServices, false)

    // 释放 A 的晚到分页响应：绝不可混入 B 列表或篡改 total
    aPage2.resolve({ items: [makeOrder('A-2-PRIVATE')], nextCursor: null, total: 99 })
    await flushMicrotasks()
    assert.deepEqual(h.state().serviceOrders.map((x) => x.id), ['B-1'])
    assert.equal(h.state().serviceTotal, 1)
    assert.equal(h.state().serviceNextCursor, null)
    assert.equal(calls.length, 3)
  } finally {
    h.unmount()
  }
})

test('S2：A 发起 loadMore → 登出 → 释放旧响应，列表保持空且不复活 A 单', async () => {
  const aPage2 = deferred()
  let activeToken = 'tok-A'
  const stableGetToken = () => activeToken

  const h = createHarness((token, opts) => {
    if (token === 'tok-A' && !opts?.cursor) {
      return Promise.resolve({ items: [makeOrder('A-1')], nextCursor: 'cur-A-1', total: 2 })
    }
    if (token === 'tok-A' && opts?.cursor === 'cur-A-1') return aPage2.promise
    throw new Error(`unexpected call ${token}`)
  })

  try {
    h.update({ isLoggedIn: true, getToken: stableGetToken, reloadKey: 0, endUserId: 'user-A' })
    await flushMicrotasks()
    h.state().loadMoreServices()
    assert.equal(h.state().loadingMoreServices, true)

    // 登出：立即清空
    activeToken = null
    h.update({ isLoggedIn: false, getToken: stableGetToken, reloadKey: 0, endUserId: null })
    assert.deepEqual(h.state().serviceOrders, [])
    assert.equal(h.state().serviceTotal, 0)
    assert.equal(h.state().loadingMoreServices, false)

    // 释放 A 晚到响应：严禁复活
    aPage2.resolve({ items: [makeOrder('A-AFTER-LOGOUT')], nextCursor: null, total: 2 })
    await flushMicrotasks()
    assert.deepEqual(h.state().serviceOrders, [])
    assert.equal(h.state().serviceTotal, 0)
  } finally {
    h.unmount()
  }
})

test('S3：稳定 getToken 引用下仅 user.id A→B 切换，立即重拉且绝不残留 A 单', async () => {
  let activeToken = 'tok-SAME-STABLE'
  const stableGetToken = () => activeToken
  let fetchCount = 0

  const h = createHarness(() => {
    fetchCount += 1
    if (fetchCount === 1) {
      return Promise.resolve({ items: [makeOrder('A-STABLE-PRIVATE')], nextCursor: null, total: 1 })
    }
    return Promise.resolve({ items: [makeOrder('B-FRESH')], nextCursor: null, total: 1 })
  })

  try {
    h.update({ isLoggedIn: true, getToken: stableGetToken, reloadKey: 0, endUserId: 'user-A' })
    await flushMicrotasks()
    assert.deepEqual(h.state().serviceOrders.map((x) => x.id), ['A-STABLE-PRIVATE'])
    assert.equal(fetchCount, 1)

    // 仅切换 endUserId（甚至假设 token 值与 getToken 函数引用都没变）
    h.update({ isLoggedIn: true, getToken: stableGetToken, reloadKey: 0, endUserId: 'user-B' })
    // 切换首帧即同步清空 A 列表
    assert.deepEqual(h.state().serviceOrders, [])
    await flushMicrotasks()
    assert.equal(fetchCount, 2, '换人时必须重新请求 B 首页')
    assert.deepEqual(h.state().serviceOrders.map((x) => x.id), ['B-FRESH'])
  } finally {
    h.unmount()
  }
})

test('S4：effectivePrintPayableCents 严格消费后端真源 payableAmountCents，不在前端推算', () => {
  assert.equal(copyMod.effectivePrintPayableCents({ payableAmountCents: 100 }), 100)
  assert.equal(copyMod.effectivePrintPayableCents({ payableAmountCents: 0 }), 0)
  assert.equal(copyMod.effectivePrintPayableCents({ amountCents: 200, discountCents: 100 }), null)
  assert.equal(copyMod.effectivePrintPayableCents({ payableAmountCents: undefined }), null)
  assert.equal(
    copyMod.canShowPrintOrderInvoiceButton({ amountCents: 200, discountCents: 100, payableAmountCents: 100, canInvoice: true, orderId: 'o1' }),
    true,
  )
  assert.equal(
    copyMod.canShowPrintOrderInvoiceButton({ amountCents: 200, discountCents: 200, payableAmountCents: 0, canInvoice: false, orderId: 'o2' }),
    false,
  )
  assert.equal(
    copyMod.canShowPrintOrderInvoiceButton({ amountCents: 200, discountCents: 200, payableAmountCents: 0, canInvoice: true, orderId: 'o3' }),
    false,
  )
})
