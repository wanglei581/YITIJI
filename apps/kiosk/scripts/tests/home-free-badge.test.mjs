// 首页「免费使用」该不该显示：开关、价目、配置缺失都要参与，缺一则关。
// 取配置、取价目、定时重读在不依赖 React 的函数里，用真的 unitCentsFor 和假计时器测。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (path) => readFileSync(join(root, path), 'utf8')

function load(path, resolve) {
  const output = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  new Function('exports', 'module', 'require', output)(module.exports, module, resolve)
  return module.exports
}

const priceApi = load('src/services/print/priceConfigApi.ts', (name) => {
  if (name === 'react') return { useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined], useEffect: () => undefined }
  if (name === '../api/client') return { API_BASE_URL: '/api/v1', API_MODE: 'http' }
  throw new Error(`Unexpected dependency ${name}`)
})

const realUnitCentsFor = priceApi.unitCentsFor
let unitCentsCalls = 0
priceApi.unitCentsFor = (config, mode) => {
  unitCentsCalls += 1
  return realUnitCentsFor(config, mode)
}

const reader = load('src/hooks/kioskHomeFreeBadgeReader.ts', (name) => {
  if (name === '../services/print/priceConfigApi') return priceApi
  if (name === '../services/api/terminalConfig') {
    return {
      getTerminalId: () => { throw new Error('测试必须注入 getTerminalId') },
      peekCachedKioskTerminalConfig: () => null,
      getCachedKioskTerminalConfig: async () => { throw new Error('测试必须注入 loadConfig') },
    }
  }
  throw new Error(`Unexpected dependency ${name}`)
})

function priceView(bw, color) {
  return {
    billingEnabled: true,
    items: [
      { serviceKey: 'print_bw_page', unitCents: bw, unit: 'page', description: '黑白' },
      { serviceKey: 'print_color_page', unitCents: color, unit: 'page', description: '彩色' },
    ],
  }
}

const switchedOn = { homeFreeBadge: true }

async function flush() {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve))
}

test('纯判定：开关开且两种单价都是 0 才显示', () => {
  const { kioskHomeFreeBadgeVisible } = reader
  assert.equal(kioskHomeFreeBadgeVisible({
    config: switchedOn,
    priceStatus: 'ready',
    bwCents: 0,
    colorCents: 0,
  }), true)
  assert.equal(kioskHomeFreeBadgeVisible({
    config: { homeFreeBadge: false },
    priceStatus: 'ready',
    bwCents: 0,
    colorCents: 0,
  }), false)
})

test('纯判定：任一价大于 0、价目未就绪、配置没有这一项，都不显示', () => {
  const { kioskHomeFreeBadgeVisible } = reader
  assert.equal(kioskHomeFreeBadgeVisible({ config: switchedOn, priceStatus: 'ready', bwCents: 20, colorCents: 0 }), false)
  assert.equal(kioskHomeFreeBadgeVisible({ config: switchedOn, priceStatus: 'ready', bwCents: 0, colorCents: 50 }), false)
  assert.equal(kioskHomeFreeBadgeVisible({ config: switchedOn, priceStatus: 'error', bwCents: 0, colorCents: 0 }), false)
  assert.equal(kioskHomeFreeBadgeVisible({ config: switchedOn, priceStatus: 'loading', bwCents: 0, colorCents: 0 }), false)
  assert.equal(kioskHomeFreeBadgeVisible({ config: {}, priceStatus: 'ready', bwCents: 0, colorCents: 0 }), false)
  assert.equal(kioskHomeFreeBadgeVisible({ config: null, priceStatus: 'ready', bwCents: 0, colorCents: 0 }), false)
  assert.equal(kioskHomeFreeBadgeVisible({ config: switchedOn, priceStatus: 'ready', bwCents: null, colorCents: 0 }), false)
})

test('钩子接线只启动轮询，不自己读价目、不用 window 定时器', () => {
  const hook = read('src/hooks/useKioskHomeFreeBadge.ts')
  assert.match(hook, /startKioskHomeFreeBadgePolling\(setVisible\)/)
  assert.match(hook, /export \{ kioskHomeFreeBadgeVisible, REFRESH_MS, startKioskHomeFreeBadgePolling \}/)
  assert.doesNotMatch(hook, /usePrintPriceConfig/)
  assert.doesNotMatch(hook, /window\.setInterval|window\.clearInterval/)
  assert.equal(reader.REFRESH_MS, 5 * 60 * 1000)
})

function startPolling({ config, price, terminalId = 'term-1' }) {
  const seen = []
  const calls = { config: 0, price: 0 }
  let configValue = config
  let priceValue = price
  const stop = reader.startKioskHomeFreeBadgePolling((visible) => { seen.push(visible) }, {
    getTerminalId: () => terminalId,
    peekConfig: () => null,
    loadConfig: async () => {
      calls.config += 1
      const value = typeof configValue === 'function' ? configValue() : configValue
      if (value instanceof Error) throw value
      return value
    },
    loadPrice: async () => {
      calls.price += 1
      const value = typeof priceValue === 'function' ? priceValue() : priceValue
      if (value instanceof Error) throw value
      return value
    },
  })
  return {
    seen,
    calls,
    stop,
    setConfig: (value) => { configValue = value },
    setPrice: (value) => { priceValue = value },
  }
}

test('钩子：开关开且两种单价都是 0 → 该显示', async () => {
  const polling = startPolling({ config: switchedOn, price: priceView(0, 0) })
  try {
    await flush()
    assert.equal(polling.seen.at(-1), true)
    assert.ok(unitCentsCalls > 0, '轮询必须调用 priceConfigApi.unitCentsFor，不能自抄一份')
  } finally {
    polling.stop()
  }
})

test('钩子：任一价大于 0 → 不显示', async () => {
  const bw = startPolling({ config: switchedOn, price: priceView(20, 0) })
  const color = startPolling({ config: switchedOn, price: priceView(0, 50) })
  try {
    await flush()
    assert.equal(bw.seen.at(-1), false)
    assert.equal(color.seen.at(-1), false)
  } finally {
    bw.stop()
    color.stop()
  }
})

test('钩子：价目读失败 → 不显示', async () => {
  const polling = startPolling({ config: switchedOn, price: new Error('价目读失败') })
  try {
    await flush()
    assert.equal(polling.seen.at(-1), false)
  } finally {
    polling.stop()
  }
})

test('钩子：配置没有这一项 → 不显示', async () => {
  const missing = startPolling({ config: { smartCampus: { enabled: false } }, price: priceView(0, 0) })
  const noTerminal = startPolling({ config: switchedOn, price: priceView(0, 0), terminalId: null })
  try {
    await flush()
    assert.equal(missing.seen.at(-1), false)
    assert.equal(noTerminal.seen.at(-1), false)
    assert.equal(noTerminal.calls.price, 0, '没有终端时不要拿上一轮价目凑结果')
  } finally {
    missing.stop()
    noTerminal.stop()
  }
})

test('定时重读价目与配置', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const cleared = []
  const mockedClear = globalThis.clearInterval
  globalThis.clearInterval = (id) => {
    cleared.push(id)
    return mockedClear(id)
  }
  const polling = startPolling({ config: switchedOn, price: priceView(0, 0) })
  try {
    await flush()
    assert.equal(polling.seen.at(-1), true, '开着且两价 0 → 显示')

    polling.setPrice(priceView(10, 0))
    const priceCalls = polling.calls.price
    t.mock.timers.tick(reader.REFRESH_MS - 1)
    await flush()
    assert.equal(polling.calls.price, priceCalls, '没到下一轮不能提前重读')
    assert.equal(polling.seen.at(-1), true)

    t.mock.timers.tick(1)
    assert.equal(polling.seen.at(-1), true, '重读还没返回时沿用这一轮，不能先当成读不到')
    await flush()
    assert.equal(polling.seen.at(-1), false, '价目重读变成黑白 10 分 → 下一轮不显示')

    polling.setPrice(priceView(0, 0))
    t.mock.timers.tick(reader.REFRESH_MS)
    await flush()
    assert.equal(polling.seen.at(-1), true)

    polling.setPrice(new Error('价目重读失败'))
    t.mock.timers.tick(reader.REFRESH_MS)
    await flush()
    assert.equal(polling.seen.at(-1), false, '价目重读失败 → 不显示，不能沿用上一次的 0 元')

    polling.setPrice(priceView(0, 0))
    t.mock.timers.tick(reader.REFRESH_MS)
    await flush()
    assert.equal(polling.seen.at(-1), true)

    polling.setConfig(new Error('配置重读失败'))
    t.mock.timers.tick(reader.REFRESH_MS)
    await flush()
    assert.equal(polling.seen.at(-1), false, '配置重读失败 → 不显示')

    const callsAfterStop = polling.calls.price
    polling.stop()
    assert.equal(cleared.length, 1, '停止必须清掉定时器')
    t.mock.timers.tick(reader.REFRESH_MS * 3)
    await flush()
    assert.equal(polling.calls.price, callsAfterStop, '停止后不再有定时器')
  } finally {
    polling.stop()
    t.mock.timers.reset()
  }
})
