// 首页「免费使用」该不该显示：开关、价目、配置缺失都要参与，缺一则关。
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

function price(status, bw, color) {
  return {
    status,
    config: status === 'ready'
      ? {
          billingEnabled: true,
          items: [
            { serviceKey: 'print_bw_page', unitCents: bw, unit: 'page', description: '黑白' },
            { serviceKey: 'print_color_page', unitCents: color, unit: 'page', description: '彩色' },
          ],
        }
      : null,
  }
}

function loadHook({ config, priceState, terminalId = 'term-1' }) {
  const react = {
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined],
    useEffect: () => undefined,
  }
  return load('src/hooks/useKioskHomeFreeBadge.ts', (name) => {
    if (name === 'react') return react
    if (name === '../services/api/terminalConfig') {
      return {
        getTerminalId: () => terminalId,
        peekCachedKioskTerminalConfig: () => config,
        getCachedKioskTerminalConfig: async () => config,
      }
    }
    if (name === '../services/print/priceConfigApi') {
      return {
        usePrintPriceConfig: () => priceState,
        unitCentsFor: (cfg, mode) => {
          if (!cfg) return null
          const key = mode === 'color' ? 'print_color_page' : 'print_bw_page'
          const item = cfg.items.find((row) => row.serviceKey === key)
          return item && Number.isInteger(item.unitCents) && item.unitCents >= 0 ? item.unitCents : null
        },
      }
    }
    throw new Error(`Unexpected dependency ${name}`)
  })
}

const readyFree = price('ready', 0, 0)
const switchedOn = { homeFreeBadge: true }

test('纯判定：开关开且两种单价都是 0 才显示', () => {
  const { kioskHomeFreeBadgeVisible } = loadHook({ config: switchedOn, priceState: readyFree })
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
  const { kioskHomeFreeBadgeVisible } = loadHook({ config: switchedOn, priceState: readyFree })
  assert.equal(kioskHomeFreeBadgeVisible({ config: switchedOn, priceStatus: 'ready', bwCents: 20, colorCents: 0 }), false)
  assert.equal(kioskHomeFreeBadgeVisible({ config: switchedOn, priceStatus: 'ready', bwCents: 0, colorCents: 50 }), false)
  assert.equal(kioskHomeFreeBadgeVisible({ config: switchedOn, priceStatus: 'error', bwCents: 0, colorCents: 0 }), false)
  assert.equal(kioskHomeFreeBadgeVisible({ config: switchedOn, priceStatus: 'loading', bwCents: 0, colorCents: 0 }), false)
  assert.equal(kioskHomeFreeBadgeVisible({ config: {}, priceStatus: 'ready', bwCents: 0, colorCents: 0 }), false)
  assert.equal(kioskHomeFreeBadgeVisible({ config: null, priceStatus: 'ready', bwCents: 0, colorCents: 0 }), false)
  assert.equal(kioskHomeFreeBadgeVisible({ config: switchedOn, priceStatus: 'ready', bwCents: null, colorCents: 0 }), false)
})

test('钩子：开关开且两种单价都是 0 → 该显示', () => {
  const { useKioskHomeFreeBadge } = loadHook({ config: switchedOn, priceState: readyFree })
  assert.equal(useKioskHomeFreeBadge(), true)
})

test('钩子：任一价大于 0 → 不显示', () => {
  const bw = loadHook({ config: switchedOn, priceState: price('ready', 20, 0) })
  const color = loadHook({ config: switchedOn, priceState: price('ready', 0, 50) })
  assert.equal(bw.useKioskHomeFreeBadge(), false)
  assert.equal(color.useKioskHomeFreeBadge(), false)
})

test('钩子：价目读失败 → 不显示', () => {
  const { useKioskHomeFreeBadge } = loadHook({ config: switchedOn, priceState: price('error', 0, 0) })
  assert.equal(useKioskHomeFreeBadge(), false)
})

test('钩子：配置没有这一项 → 不显示', () => {
  const missing = loadHook({ config: { smartCampus: { enabled: false } }, priceState: readyFree })
  const noTerminal = loadHook({ config: switchedOn, priceState: readyFree, terminalId: null })
  assert.equal(missing.useKioskHomeFreeBadge(), false)
  assert.equal(noTerminal.useKioskHomeFreeBadge(), false)
})
