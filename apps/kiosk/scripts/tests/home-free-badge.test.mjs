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
  // 终端号变化走现成的身份订阅。默认不发通知，要测换终端的用例自己注入。
  if (name === '../services/api/screensaver') {
    return { subscribeTerminalIdentity: () => () => {} }
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
    // 新一轮已经开始、价目和配置都还没回来：不能继续显示上一轮的免费。
    // 收费机器上挂着「免费使用」，就是这一下没清掉。
    assert.equal(polling.seen.at(-1), false, '重读还没返回时先不显示，不能沿用上一轮')
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

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject, settled: false }
}

function enqueue(queue) {
  const job = deferred()
  const wrapped = job.promise.then((value) => {
    job.settled = true
    return value
  }, (error) => {
    job.settled = true
    throw error
  })
  job.promise = wrapped
  queue.push(job)
  return wrapped
}

test('上一轮已经显示，这一轮价目回到 10 分而配置还挂着，立刻不显示', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const configs = []
  const prices = []
  const seen = []
  const stop = reader.startKioskHomeFreeBadgePolling((visible) => { seen.push(visible) }, {
    getTerminalId: () => 'term-1',
    loadConfig: () => enqueue(configs),
    loadPrice: () => enqueue(prices),
  })
  try {
    configs[0].resolve(switchedOn)
    prices[0].resolve(priceView(0, 0))
    await flush()
    assert.equal(seen.at(-1), true)

    t.mock.timers.tick(reader.REFRESH_MS)
    assert.equal(seen.at(-1), false, '新一轮开始还没回齐，不能沿用上一轮的显示')
    prices[1].resolve(priceView(10, 0))
    await flush()
    assert.equal(configs[1].settled, false, '配置这一边还没回来')
    assert.equal(seen.at(-1), false, '价目已经是 10 分，不能等配置一起到了再关掉')
  } finally {
    stop()
    t.mock.timers.reset()
  }
})

test('价目失败而配置还挂着，立刻不显示', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const configs = []
  const prices = []
  const seen = []
  const stop = reader.startKioskHomeFreeBadgePolling((visible) => { seen.push(visible) }, {
    getTerminalId: () => 'term-1',
    loadConfig: () => enqueue(configs),
    loadPrice: () => enqueue(prices),
  })
  try {
    configs[0].resolve(switchedOn)
    prices[0].resolve(priceView(0, 0))
    await flush()
    assert.equal(seen.at(-1), true)

    t.mock.timers.tick(reader.REFRESH_MS)
    prices[1].reject(new Error('价目读失败'))
    await flush()
    assert.equal(configs[1].settled, false, '配置这一边还没回来')
    assert.equal(seen.at(-1), false, '价目失败就是不该显示，不能等另一边')
  } finally {
    stop()
    t.mock.timers.reset()
  }
})

test('一轮超过 30 秒没回齐，按失败处理，之后才到的成功也不再显示', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const configs = []
  const prices = []
  const seen = []
  const stop = reader.startKioskHomeFreeBadgePolling((visible) => { seen.push(visible) }, {
    getTerminalId: () => 'term-1',
    loadConfig: () => enqueue(configs),
    loadPrice: () => enqueue(prices),
  })
  try {
    assert.equal(reader.HOME_FREE_BADGE_ROUND_TIMEOUT_MS, 30 * 1000)
    t.mock.timers.tick(reader.HOME_FREE_BADGE_ROUND_TIMEOUT_MS - 1)
    await flush()
    assert.equal(seen.includes(true), false, '没到 30 秒、也还没回齐，不能显示')
    t.mock.timers.tick(1)
    configs[0].resolve(switchedOn)
    prices[0].resolve(priceView(0, 0))
    await flush()
    assert.equal(seen.includes(true), false, '超时之后两边才都满足，这一轮已经按失败处理')
  } finally {
    stop()
    t.mock.timers.reset()
  }
})

test('旧一轮迟到的「显示」不能覆盖新一轮', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const configs = []
  const prices = []
  const seen = []
  const stop = reader.startKioskHomeFreeBadgePolling((visible) => { seen.push(visible) }, {
    getTerminalId: () => 'term-1',
    loadConfig: () => enqueue(configs),
    loadPrice: () => enqueue(prices),
  })
  try {
    t.mock.timers.tick(reader.REFRESH_MS)
    const afterNewRound = seen.length
    configs[0].resolve(switchedOn)
    prices[0].resolve(priceView(0, 0))
    await flush()
    assert.equal(seen.slice(afterNewRound).includes(true), false, '上一轮的成功是旧轮次，不能把新一轮改成显示')
    configs[1].resolve(switchedOn)
    prices[1].resolve(priceView(0, 0))
    await flush()
    assert.equal(seen.at(-1), true, '新一轮自己两边都满足，仍然可以显示')
  } finally {
    stop()
    t.mock.timers.reset()
  }
})

test('终端号从 A 换成 B 后，A 的结果丢掉，即使这一轮还没被换掉', async () => {
  let terminalId = 'A'
  const configs = []
  const prices = []
  const seen = []
  const stop = reader.startKioskHomeFreeBadgePolling((visible) => { seen.push(visible) }, {
    getTerminalId: () => terminalId,
    loadConfig: () => enqueue(configs),
    loadPrice: () => enqueue(prices),
    // 订阅不响。只改当前终端号，专门看结果回来时的核对，不靠轮次作废。
    subscribeIdentity: () => () => {},
  })
  try {
    terminalId = 'B'
    configs[0].resolve(switchedOn)
    prices[0].resolve(priceView(0, 0))
    await flush()
    assert.equal(seen.includes(true), false, '这批结果属于 A，B 上不能显示免费')
    assert.equal(configs.length, 1, '没收到身份通知时，这一下只核对、不另起一轮')
  } finally {
    stop()
  }
})

test('订阅到终端号变化后立刻不显示并重读，旧终端的成功不能发布', async () => {
  let terminalId = 'A'
  let listener = () => {}
  const configs = []
  const prices = []
  const seen = []
  const stop = reader.startKioskHomeFreeBadgePolling((visible) => { seen.push(visible) }, {
    getTerminalId: () => terminalId,
    loadConfig: () => enqueue(configs),
    loadPrice: () => enqueue(prices),
    subscribeIdentity: (next) => {
      listener = next
      return () => { listener = () => {} }
    },
  })
  try {
    terminalId = 'B'
    listener()
    assert.equal(seen.at(-1), false, '终端号一变就先不显示')
    assert.equal(configs.length, 2, '终端号变了要按新终端重读')
    configs[0].resolve(switchedOn)
    prices[0].resolve(priceView(0, 0))
    await flush()
    assert.equal(seen.at(-1), false, 'A 还在路上的成功不能发布到 B')
    configs[1].resolve(switchedOn)
    prices[1].resolve(priceView(0, 0))
    await flush()
    assert.equal(seen.at(-1), true, 'B 自己的配置和价目都满足才显示')
  } finally {
    stop()
  }
})

test('停止时还有请求在途，回来后不再发布', async () => {
  const configs = []
  const prices = []
  const seen = []
  const stop = reader.startKioskHomeFreeBadgePolling((visible) => { seen.push(visible) }, {
    getTerminalId: () => 'term-1',
    loadConfig: () => enqueue(configs),
    loadPrice: () => enqueue(prices),
  })
  const published = seen.length
  stop()
  configs[0].resolve(switchedOn)
  prices[0].resolve(priceView(0, 0))
  await flush()
  assert.equal(seen.length, published, '停止之后的结果不能再发布')
  assert.equal(seen.includes(true), false)
})

test('默认取价目走 fetchPrintPriceConfig，再用 unitCentsFor 判断是不是 0 元', async () => {
  const previous = globalThis.fetch
  const callsBefore = unitCentsCalls
  const seen = []
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/print\/price-config$/)
    return {
      ok: true,
      json: async () => priceView(0, 0),
    }
  }
  // 不传 loadPrice。价目必须从价目接口的真实形状进来，再进 unitCentsFor。
  const stop = reader.startKioskHomeFreeBadgePolling((visible) => { seen.push(visible) }, {
    getTerminalId: () => 'term-1',
    loadConfig: async () => switchedOn,
  })
  try {
    await flush()
    assert.ok(unitCentsCalls >= callsBefore + 2, '黑白和彩色都要经过 priceConfigApi.unitCentsFor')
    assert.equal(seen.at(-1), true, '接口返回两种单价都是 0，并且开关开着，才显示')
  } finally {
    stop()
    globalThis.fetch = previous
  }
})
