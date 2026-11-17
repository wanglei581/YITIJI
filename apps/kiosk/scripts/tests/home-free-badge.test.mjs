// 首页「免费使用」该不该显示：开关和本机五个生效价都要参与，缺一则关。
// 取配置、定时重读在不依赖 React 的函数里测。价在配置的 pricing 上，不再另读价目接口。
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

const reader = load('src/hooks/kioskHomeFreeBadgeReader.ts', (name) => {
  if (name === '@ai-job-print/shared') {
    return {
      TERMINAL_CHARGE_SERVICE_KEYS: ['resume_optimize', 'mock_interview', 'print_bw_page', 'print_color_page', 'scan'],
    }
  }
  if (name === '../services/api/terminalConfig') {
    return {
      getTerminalId: () => { throw new Error('测试必须注入 getTerminalId') },
      peekCachedKioskTerminalConfig: () => null,
      getCachedKioskTerminalConfig: async () => { throw new Error('测试必须注入 loadConfig') },
    }
  }
  if (name === '../services/api/screensaver') {
    return { subscribeTerminalIdentity: () => () => {} }
  }
  throw new Error(`Unexpected dependency ${name}`)
})

function configWith(cents, homeFreeBadge = true) {
  return {
    homeFreeBadge,
    pricing: {
      personalChargeEnabled: false,
      userChargeMode: 'org_pays',
      isPublicSite: false,
      effective: {
        resume_optimize: cents.resume_optimize ?? 0,
        mock_interview: cents.mock_interview ?? 0,
        print_bw_page: cents.print_bw_page ?? 0,
        print_color_page: cents.print_color_page ?? 0,
        scan: cents.scan ?? 0,
      },
    },
  }
}

const allFree = configWith({})

async function flush() {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve))
}

test('纯判定：开关开且五个生效价都是 0 才显示', () => {
  const { kioskHomeFreeBadgeVisible } = reader
  assert.equal(kioskHomeFreeBadgeVisible({ config: allFree }), true)
  assert.equal(kioskHomeFreeBadgeVisible({ config: configWith({}, false) }), false)
})

test('配置里没有 homeFreeBadge、五个价全 0 → 不显示', () => {
  const { kioskHomeFreeBadgeVisible } = reader
  const config = configWith({})
  delete config.homeFreeBadge
  assert.equal(kioskHomeFreeBadgeVisible({ config }), false)
})

test('纯判定：任一价大于 0、价读不齐、配置没有开关，都不显示', () => {
  const { kioskHomeFreeBadgeVisible } = reader
  assert.equal(kioskHomeFreeBadgeVisible({ config: configWith({ print_bw_page: 20 }) }), false)
  assert.equal(kioskHomeFreeBadgeVisible({ config: configWith({ print_color_page: 50 }) }), false)
  assert.equal(kioskHomeFreeBadgeVisible({ config: configWith({ resume_optimize: 100 }) }), false)
  assert.equal(kioskHomeFreeBadgeVisible({ config: configWith({ mock_interview: 100 }) }), false)
  assert.equal(kioskHomeFreeBadgeVisible({ config: { homeFreeBadge: true } }), false)
  assert.equal(kioskHomeFreeBadgeVisible({ config: { homeFreeBadge: true, pricing: { effective: { print_bw_page: 0, print_color_page: 0 } } } }), false)
  assert.equal(kioskHomeFreeBadgeVisible({ config: null }), false)
})

test('扫描价大于 0 时不显示', () => {
  const { kioskHomeFreeBadgeVisible } = reader
  assert.equal(kioskHomeFreeBadgeVisible({ config: configWith({ scan: 100 }) }), false)
  assert.equal(kioskHomeFreeBadgeVisible({ config: configWith({ scan: 100, print_bw_page: 0, print_color_page: 0 }) }), false)
})

test('钩子接线只启动轮询，不自己读价目、不用 window 定时器', () => {
  const hook = read('src/hooks/useKioskHomeFreeBadge.ts')
  assert.match(hook, /startKioskHomeFreeBadgePolling\(setVisible\)/)
  assert.match(hook, /export \{ kioskHomeFreeBadgeVisible, REFRESH_MS, startKioskHomeFreeBadgePolling \}/)
  assert.doesNotMatch(hook, /usePrintPriceConfig/)
  assert.doesNotMatch(hook, /window\.setInterval|window\.clearInterval/)
  assert.equal(reader.REFRESH_MS, 5 * 60 * 1000)
})

function startPolling({ config, terminalId = 'term-1' }) {
  const seen = []
  const calls = { config: 0 }
  let configValue = config
  const stop = reader.startKioskHomeFreeBadgePolling((visible) => { seen.push(visible) }, {
    getTerminalId: () => terminalId,
    peekConfig: () => null,
    loadConfig: async () => {
      calls.config += 1
      const value = typeof configValue === 'function' ? configValue() : configValue
      if (value instanceof Error) throw value
      return value
    },
  })
  return {
    seen,
    calls,
    stop,
    setConfig: (value) => { configValue = value },
  }
}

test('钩子：开关开且五个生效价都是 0 → 该显示', async () => {
  const polling = startPolling({ config: allFree })
  try {
    await flush()
    assert.equal(polling.seen.at(-1), true)
    assert.equal(polling.calls.config, 1)
  } finally {
    polling.stop()
  }
})

test('钩子：任一价大于 0 → 不显示', async () => {
  const bw = startPolling({ config: configWith({ print_bw_page: 20 }) })
  const scan = startPolling({ config: configWith({ scan: 100 }) })
  try {
    await flush()
    assert.equal(bw.seen.at(-1), false)
    assert.equal(scan.seen.at(-1), false)
  } finally {
    bw.stop()
    scan.stop()
  }
})

test('钩子：配置读失败 → 不显示', async () => {
  const polling = startPolling({ config: new Error('配置读失败') })
  try {
    await flush()
    assert.equal(polling.seen.at(-1), false)
  } finally {
    polling.stop()
  }
})

test('钩子：配置没有这一项、没有终端 → 不显示', async () => {
  const missing = startPolling({ config: { smartCampus: { enabled: false } } })
  const noTerminal = startPolling({ config: allFree, terminalId: null })
  try {
    await flush()
    assert.equal(missing.seen.at(-1), false)
    assert.equal(noTerminal.seen.at(-1), false)
    assert.equal(noTerminal.calls.config, 0, '没有终端时不要拿上一轮配置凑结果')
  } finally {
    missing.stop()
    noTerminal.stop()
  }
})

test('定时重读配置', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const cleared = []
  const mockedClear = globalThis.clearInterval
  globalThis.clearInterval = (id) => {
    cleared.push(id)
    return mockedClear(id)
  }
  const polling = startPolling({ config: allFree })
  try {
    await flush()
    assert.equal(polling.seen.at(-1), true, '开着且五价 0 → 显示')

    polling.setConfig(configWith({ print_bw_page: 10 }))
    const configCalls = polling.calls.config
    t.mock.timers.tick(reader.REFRESH_MS - 1)
    await flush()
    assert.equal(polling.calls.config, configCalls, '没到下一轮不能提前重读')
    assert.equal(polling.seen.at(-1), true)

    t.mock.timers.tick(1)
    assert.equal(polling.seen.at(-1), false, '重读还没返回时先不显示，不能沿用上一轮')
    await flush()
    assert.equal(polling.seen.at(-1), false, '重读变成黑白 10 分 → 下一轮不显示')

    polling.setConfig(allFree)
    t.mock.timers.tick(reader.REFRESH_MS)
    await flush()
    assert.equal(polling.seen.at(-1), true)

    polling.setConfig(new Error('配置重读失败'))
    t.mock.timers.tick(reader.REFRESH_MS)
    await flush()
    assert.equal(polling.seen.at(-1), false, '配置重读失败 → 不显示，不能沿用上一次的 0 元')

    polling.setConfig(allFree)
    t.mock.timers.tick(reader.REFRESH_MS)
    await flush()
    assert.equal(polling.seen.at(-1), true)

    const callsAfterStop = polling.calls.config
    polling.stop()
    assert.equal(cleared.length, 1, '停止必须清掉定时器')
    t.mock.timers.tick(reader.REFRESH_MS * 3)
    await flush()
    assert.equal(polling.calls.config, callsAfterStop, '停止后不再有定时器')
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
  return { promise, resolve, reject }
}

function enqueue(queue) {
  const job = deferred()
  queue.push(job)
  return job.promise
}

test('一轮超过 30 秒没回来，按失败处理，之后才到的成功也不再显示', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const configs = []
  const seen = []
  const stop = reader.startKioskHomeFreeBadgePolling((visible) => { seen.push(visible) }, {
    getTerminalId: () => 'term-1',
    loadConfig: () => enqueue(configs),
  })
  try {
    assert.equal(reader.HOME_FREE_BADGE_ROUND_TIMEOUT_MS, 30 * 1000)
    t.mock.timers.tick(reader.HOME_FREE_BADGE_ROUND_TIMEOUT_MS - 1)
    await flush()
    assert.equal(seen.includes(true), false, '没到 30 秒、也还没回来，不能显示')
    t.mock.timers.tick(1)
    configs[0].resolve(allFree)
    await flush()
    assert.equal(seen.includes(true), false, '超时之后才满足，这一轮已经按失败处理')
  } finally {
    stop()
    t.mock.timers.reset()
  }
})

test('旧一轮迟到的「显示」不能覆盖新一轮', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const configs = []
  const seen = []
  const stop = reader.startKioskHomeFreeBadgePolling((visible) => { seen.push(visible) }, {
    getTerminalId: () => 'term-1',
    loadConfig: () => enqueue(configs),
  })
  try {
    t.mock.timers.tick(reader.REFRESH_MS)
    const afterNewRound = seen.length
    configs[0].resolve(allFree)
    await flush()
    assert.equal(seen.slice(afterNewRound).includes(true), false, '上一轮的成功是旧轮次，不能把新一轮改成显示')
    configs[1].resolve(allFree)
    await flush()
    assert.equal(seen.at(-1), true, '新一轮自己满足，仍然可以显示')
  } finally {
    stop()
    t.mock.timers.reset()
  }
})

test('终端号从 A 换成 B 后，A 的结果丢掉', async () => {
  let terminalId = 'A'
  const configs = []
  const seen = []
  const stop = reader.startKioskHomeFreeBadgePolling((visible) => { seen.push(visible) }, {
    getTerminalId: () => terminalId,
    loadConfig: () => enqueue(configs),
    subscribeIdentity: () => () => {},
  })
  try {
    terminalId = 'B'
    configs[0].resolve(allFree)
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
  const seen = []
  const stop = reader.startKioskHomeFreeBadgePolling((visible) => { seen.push(visible) }, {
    getTerminalId: () => terminalId,
    loadConfig: () => enqueue(configs),
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
    configs[0].resolve(allFree)
    await flush()
    assert.equal(seen.at(-1), false, 'A 还在路上的成功不能发布到 B')
    configs[1].resolve(allFree)
    await flush()
    assert.equal(seen.at(-1), true, 'B 自己的配置满足才显示')
  } finally {
    stop()
  }
})

test('停止时还有请求在途，回来后不再发布', async () => {
  const configs = []
  const seen = []
  const stop = reader.startKioskHomeFreeBadgePolling((visible) => { seen.push(visible) }, {
    getTerminalId: () => 'term-1',
    loadConfig: () => enqueue(configs),
  })
  const published = seen.length
  stop()
  configs[0].resolve(allFree)
  await flush()
  assert.equal(seen.length, published, '停止之后的结果不能再发布')
  assert.equal(seen.includes(true), false)
})

test('展示价读本机 pricing 的黑白和彩色，读不到就失败', async () => {
  const priceApi = load('src/services/print/priceConfigApi.ts', (name) => {
    if (name === 'react') return { useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined], useEffect: () => undefined }
    if (name === '../api/client') return { API_MODE: 'http' }
    if (name === '../api/terminalConfig') {
      return {
        getTerminalId: () => 'term-1',
        getCachedKioskTerminalConfig: async () => configWith({ print_bw_page: 0, print_color_page: 0, scan: 100 }),
      }
    }
    throw new Error(`Unexpected dependency ${name}`)
  })
  const view = await priceApi.fetchPrintPriceConfig()
  assert.equal(priceApi.unitCentsFor(view, 'black_white'), 0)
  assert.equal(priceApi.unitCentsFor(view, 'color'), 0)
  assert.equal(view.items.length, 2)

  const missing = load('src/services/print/priceConfigApi.ts', (name) => {
    if (name === 'react') return { useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined], useEffect: () => undefined }
    if (name === '../api/client') return { API_MODE: 'http' }
    if (name === '../api/terminalConfig') {
      return { getTerminalId: () => null, getCachedKioskTerminalConfig: async () => ({}) }
    }
    throw new Error(`Unexpected dependency ${name}`)
  })
  await assert.rejects(() => missing.fetchPrintPriceConfig(), /missing terminal id/)

  const unreadable = load('src/services/print/priceConfigApi.ts', (name) => {
    if (name === 'react') return { useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined], useEffect: () => undefined }
    if (name === '../api/client') return { API_MODE: 'http' }
    if (name === '../api/terminalConfig') {
      return {
        getTerminalId: () => 'term-1',
        getCachedKioskTerminalConfig: async () => ({ pricing: { effective: {} } }),
        refreshKioskTerminalConfig: async () => { throw new Error('不该走强制刷新') },
      }
    }
    throw new Error(`Unexpected dependency ${name}`)
  })
  await assert.rejects(() => unreadable.fetchPrintPriceConfig(), /machine price missing/)
})

test('配置对象整个没有 pricing 时按读不到价处理，不当成 0 元', async () => {
  const noPricing = load('src/services/print/priceConfigApi.ts', (name) => {
    if (name === 'react') return { useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined], useEffect: () => undefined }
    if (name === '../api/client') return { API_MODE: 'http' }
    if (name === '../api/terminalConfig') {
      return {
        getTerminalId: () => 'term-1',
        getCachedKioskTerminalConfig: async () => ({ homeFreeBadge: true, terminalId: 'term-1' }),
        refreshKioskTerminalConfig: async () => { throw new Error('不该走强制刷新') },
      }
    }
    throw new Error(`Unexpected dependency ${name}`)
  })
  await assert.rejects(() => noPricing.fetchPrintPriceConfig(), /machine price missing/)
  await assert.rejects(async () => {
    const view = await noPricing.fetchPrintPriceConfig()
    return noPricing.unitCentsFor(view, 'black_white')
  }, /machine price missing/)
})

test('强制重读不走缓存', async () => {
  let cached = 0
  let refreshed = 0
  const priceApi = load('src/services/print/priceConfigApi.ts', (name) => {
    if (name === 'react') return { useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined], useEffect: () => undefined }
    if (name === '../api/client') return { API_MODE: 'http' }
    if (name === '../api/terminalConfig') {
      return {
        getTerminalId: () => 'term-1',
        getCachedKioskTerminalConfig: async () => {
          cached += 1
          return configWith({ print_bw_page: 20, print_color_page: 50 })
        },
        refreshKioskTerminalConfig: async () => {
          refreshed += 1
          return configWith({ print_bw_page: 30, print_color_page: 60 })
        },
      }
    }
    throw new Error(`Unexpected dependency ${name}`)
  })
  const first = await priceApi.fetchPrintPriceConfig()
  assert.equal(priceApi.unitCentsFor(first, 'black_white'), 20)
  assert.equal(cached, 1)
  assert.equal(refreshed, 0)
  const second = await priceApi.fetchPrintPriceConfig({ force: true })
  assert.equal(priceApi.unitCentsFor(second, 'black_white'), 30)
  assert.equal(priceApi.unitCentsFor(second, 'color'), 60)
  assert.equal(cached, 1)
  assert.equal(refreshed, 1)
})

test('更早发出的缓存请求不能盖掉强制刷新', async () => {
  const pending = []
  const previousWindow = globalThis.window
  globalThis.window = { location: { origin: 'http://kiosk.local' } }
  try {
    const terminalConfig = load('src/services/api/terminalConfig.ts', (name) => {
      if (name === '@ai-job-print/shared') return { DEFAULT_SMART_CAMPUS_MODULES: {} }
      if (name === './client') return { API_MODE: 'http', API_BASE_URL: '/api/v1' }
      if (name === './httpAdapter') return { ApiHttpError: class ApiHttpError extends Error {} }
      if (name === './screensaver') return { getTerminalCode: () => null, getTerminalId: () => 'term-1' }
      if (name === '../terminalAuth') {
        return {
          terminalProtectedFetch: () => {
            let resolve
            const gate = new Promise((done) => { resolve = done })
            pending.push(resolve)
            return gate.then((body) => ({ ok: true, json: async () => body }))
          },
        }
      }
      throw new Error(`Unexpected dependency ${name}`)
    })
    const slow = terminalConfig.getCachedKioskTerminalConfig('term-1')
    const fresh = terminalConfig.refreshKioskTerminalConfig('term-1')
    assert.equal(pending.length, 2)
    pending[1]({ configVersion: 'fresh' })
    assert.equal((await fresh).configVersion, 'fresh')
    pending[0]({ configVersion: 'stale' })
    assert.equal((await slow).configVersion, 'stale')
    assert.equal(terminalConfig.peekCachedKioskTerminalConfig('term-1').configVersion, 'fresh')
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})
