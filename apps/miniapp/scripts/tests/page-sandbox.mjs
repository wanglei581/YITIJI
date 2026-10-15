/**
 * 小程序页面沙箱：在 node:vm 里**真实执行**页面源码，拿到 Page() 配置后实例化成一个带
 * setData 的对象。原先只写在 page-lifecycle.test.mjs 里；price-confirmation.test.mjs
 * 也要真跑 print-pay / package-confirm，而 `node:test` 文件一 import 就会把它的全部用例
 * 注册进来，没法直接复用 —— 所以把这几个纯函数原样抽到这里，两个测试共用同一份。
 *
 * 只含与具体页面无关的部分：可控 Promise、flush、页面加载器、带路径的 setData。
 * wx / auth / api 替身仍由各测试自己给（每个测试要控制的故障不一样）。
 *
 * 注入版本时，开关和路由表要成套给（variantModules）：测的就是真实会发布的那一组，
 * 不是「开关关掉、路由表仍是另一版」这种发不出去的组合。
 *
 * 放在 scripts/tests/ 下：scripts/project-graph/gates.mjs 把这里排除在「门禁脚本」之外。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))

function readVariantName() {
  try {
    const text = fs.readFileSync(path.join(MINIAPP, 'utils/build-variant.js'), 'utf8')
    return (text.match(/VARIANT:\s*'([^']+)'/) || [])[1] || ''
  } catch {
    return ''
  }
}

/** 完整路由表：目录是不含 AI 版时原件在 stash，否则就是当前的 utils/ai-entries.js。 */
function fullAiEntriesFile() {
  if (readVariantName() === 'no-ai') {
    return path.join(MINIAPP, 'review-variants/stash/utils/ai-entries.js')
  }
  return path.join(MINIAPP, 'utils/ai-entries.js')
}

/**
 * 从完整路由表派生空路由表。规则与 verify-review-variant.mjs 的 entryKeyProblems
 * 对生成结果的要求一致：键不变；函数恒返回空串；数组换成空数组；其余换成 null。
 */
function emptyAiEntries(full) {
  const empty = {}
  for (const key of Object.keys(full)) {
    const value = full[key]
    if (typeof value === 'function') empty[key] = function emptyHref() { return '' }
    else if (Array.isArray(value)) empty[key] = []
    else empty[key] = null
  }
  return empty
}

/**
 * 成套版本替身。注入时开关和路由表一起给，测的就是真实发布的组合。
 * @param {'full'|'no-ai'} name
 */
export function variantModules(name) {
  if (name !== 'full' && name !== 'no-ai') {
    throw new Error(`variantModules 只接受 'full' 或 'no-ai'，收到 ${JSON.stringify(name)}`)
  }
  const full = requireMiniapp(fullAiEntriesFile())
  return {
    'build-variant': name === 'full'
      ? { VARIANT: 'full', AI_ENABLED: true }
      : { VARIANT: 'no-ai', AI_ENABLED: false },
    'ai-entries': name === 'full' ? full : emptyAiEntries(full),
  }
}

// ⚠ vm.createContext 建的是**另一个 realm**：沙箱里造出来的数组 / 对象不是宿主
//   Array、Object 的实例。所以断言一律用 length / 字段比较，不要用 deepStrictEqual
//   去比 `[]` —— 那会因为原型不同而恒红，看起来像被测代码有问题。

/** 可控 Promise：测试自己决定什么时候、按什么顺序完成它。 */
export function deferred() {
  const d = {}
  d.promise = new Promise((resolve, reject) => { d.resolve = resolve; d.reject = reject })
  // 未处理的 rejection 不该让整个测试进程炸掉 —— 被守卫丢弃的响应正是这种形态。
  d.promise.catch(() => {})
  return d
}

/** 让所有已 resolve 的微任务跑完（页面回调是链在 Promise 上的）。 */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * 不含 AI 版要停放的页面目录。完整版返回 null：停放页只随完整版发布，
 * 完整版下走不到后面的 stash 替换。
 */
function noAiParkedFolders() {
  let variant = ''
  try {
    const text = fs.readFileSync(path.join(MINIAPP, 'utils/build-variant.js'), 'utf8')
    variant = (text.match(/VARIANT:\s*'([^']+)'/) || [])[1] || ''
  } catch {
    return null
  }
  if (variant !== 'no-ai') return null
  const all = JSON.parse(fs.readFileSync(path.join(MINIAPP, 'review-variants/variants.json'), 'utf8'))
  const spec = all[variant]
  return new Set((spec && spec.aiPages) || [])
}

function pageFolder(relPath) {
  const norm = String(relPath).split(path.sep).join('/')
  return (norm.match(/^pages\/([^/]+)\//) || [])[1] || ''
}

/** 页面 require 的是不是 utils 下的模块（不含更深层的路径）。 */
function isUtilsModuleId(id) {
  const norm = String(id).split('\\').join('/')
  return /(?:^|\/)utils\/[^/]+$/.test(norm)
}

/**
 * 在沙箱里真实执行一个页面源码，返回 Page() 收到的配置对象。
 * @param {string} relPath 相对 apps/miniapp 的路径
 * @param {string} [source] 给了就跑这份源码（变异测试用），相对 require 仍按 relPath 的目录解析
 */
export function loadPageDefinition(relPath, { wx, modules, timers = [], source }) {
  const src = typeof source === 'string' ? source : fs.readFileSync(path.join(MINIAPP, relPath), 'utf8')
  // 停放页拿 stash 里的完整版 utils；在包里的页不换，用目录当前版本。
  const parkedFolders = noAiParkedFolders()
  const useStash = parkedFolders !== null && parkedFolders.has(pageFolder(relPath))
  let pageDef = null
  const sandbox = {
    console,
    wx,
    Page: (def) => { pageDef = def },
    getApp: () => ({ globalData: { statusBarHeight: 20 } }),
    require: (id) => {
      // 页面自己目录下的模块（如 print-pickup/pickup-state.js）：按页面目录解析，用真实实现。
      if (id.startsWith('./')) return requireMiniapp(path.join(MINIAPP, path.dirname(relPath), id))
      const name = id.replace(/^.*\//, '').replace(/\.js$/, '')
      // 测试注入的替身仍然最高，stash 不能盖过它。
      if (Object.prototype.hasOwnProperty.call(modules, name)) return modules[name]
      // stash 只替换本页直接 require 的 utils 模块。停放页自己目录下以 ./ 开头的辅助模块
      // 走的是上面 Node 自己的 require，它们自己再引用关键模块时不经过这里的替换
      // （现在这样的文件有 pages/self-explore/append-print.js）。
      // 后果只会是不含 AI 状态下相关用例变红，不会变成假的通过。
      if (useStash && isUtilsModuleId(id)) {
        const stashed = path.join(MINIAPP, 'review-variants/stash/utils', `${name}.js`)
        if (fs.existsSync(stashed)) return requireMiniapp(stashed)
      }
      // 其余一律用真实实现（它们都是无 wx 依赖的纯模块）。
      return requireMiniapp(`../utils/${name}.js`)
    },
    module: { exports: {} },
    exports: {},
    // 沙箱里的定时器**只登记不触发**。print-pickup 会每 3 秒轮询一次订单状态，
    // 用真的 setTimeout 会让这条链一直排下去，node:test 永远等不到事件循环清空
    // （实测：整个测试文件挂死，2 分钟超时）。测试要验的是回调里的判定，
    // 不是定时器本身，需要时由测试自己调 timers.run()。
    setTimeout: (fn) => { timers.push(fn); return timers.length },
    clearTimeout: () => {},
    setInterval: (fn) => { timers.push(fn); return timers.length },
    clearInterval: () => {},
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: relPath })
  assert.ok(pageDef, `${relPath} 没有调用 Page()`)
  return pageDef
}

/**
 * 写一个带路径的 setData 键，例如 `'fee.total'` / `'files[0].name'`。
 * 真机 setData 支持这种写法；替身若只做 Object.assign，就会在 data 上造出一个
 * **名字里带点的普通键**，页面读 `data.fee.total` 永远是旧值 —— 测试会把一个
 * 好端端的实现判成"金额没写进去"。
 */
function setByPath(target, path, value) {
  const keys = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let cursor = target
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i]
    if (cursor[key] === null || typeof cursor[key] !== 'object') {
      cursor[key] = /^\d+$/.test(keys[i + 1]) ? [] : {}
    }
    cursor = cursor[key]
  }
  cursor[keys[keys.length - 1]] = value
}

/** Page 配置 → 可调用的页面实例（带一个真会合并的 setData）。 */
export function instantiate(def) {
  const page = Object.assign(Object.create(null), def)
  page.data = JSON.parse(JSON.stringify(def.data || {}))
  page.setData = function setData(patch, callback) {
    for (const key of Object.keys(patch || {})) {
      if (key.indexOf('.') >= 0 || key.indexOf('[') >= 0) setByPath(this.data, key, patch[key])
      else this.data[key] = patch[key]
    }
    if (typeof callback === 'function') callback()
  }
  return page
}
