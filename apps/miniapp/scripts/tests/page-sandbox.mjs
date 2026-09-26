/**
 * 小程序页面沙箱：在 node:vm 里**真实执行**页面源码，拿到 Page() 配置后实例化成一个带
 * setData 的对象。原先只写在 page-lifecycle.test.mjs 里；price-confirmation.test.mjs
 * 也要真跑 print-pay / package-confirm，而 `node:test` 文件一 import 就会把它的全部用例
 * 注册进来，没法直接复用 —— 所以把这几个纯函数原样抽到这里，两个测试共用同一份。
 *
 * 只含与具体页面无关的部分：可控 Promise、flush、页面加载器、带路径的 setData。
 * wx / auth / api 替身仍由各测试自己给（每个测试要控制的故障不一样）。
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
 * 在沙箱里真实执行一个页面源码，返回 Page() 收到的配置对象。
 * @param {string} relPath 相对 apps/miniapp 的路径
 */
export function loadPageDefinition(relPath, { wx, modules, timers = [] }) {
  const src = fs.readFileSync(path.join(MINIAPP, relPath), 'utf8')
  let pageDef = null
  const sandbox = {
    console,
    wx,
    Page: (def) => { pageDef = def },
    getApp: () => ({ globalData: { statusBarHeight: 20 } }),
    require: (id) => {
      const name = id.replace(/^.*\//, '').replace(/\.js$/, '')
      if (Object.prototype.hasOwnProperty.call(modules, name)) return modules[name]
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
