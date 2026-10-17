/**
 * 会话时序测试的公共替身（从 session-generation.test.mjs 原样搬出，10/17）：真实 utils/auth.js、
 * utils/request.js、utils/storage.js 跑在只有 wx 替身的沙箱里。session-generation 与
 * flow1b-storage-faults 两份测试共用，避免各写一套 wx 替身后行为对不上。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

export const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const UTILS = path.join(MINIAPP, 'utils')

/** 跑完所有已排队的微任务（回调都挂在 Promise 上）。 */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * 不用 try/catch 包断言：拿到结果再判，避免把断言失败当成业务 reject。
 * 带看门狗：防护被变异摘掉后请求可能永远不落地（比如被拿去补签却没人喂 wx.login），
 * 没有它，变异用例会挂在事件循环上而不是判红。
 */
export async function settle(promise, timeoutMs = 300) {
  let timer = null
  const watchdog = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: { statusCode: 'TIMEOUT' } }), timeoutMs)
  })
  const settled = promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }))
  const result = await Promise.race([settled, watchdog])
  clearTimeout(timer)
  return result
}

export function fakeToken(sub, ttlSeconds = 3600) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub, exp })}.sig`
}

/** 没有 sub 的 JWT：证明不了持有者是谁。 */
export function tokenWithoutSubject(ttlSeconds = 3600) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ exp: Math.floor(Date.now() / 1000) + ttlSeconds })}.sig`
}

// sub 必须等于 user.id —— 后端 member-auth.service.ts 按 user.id 签 sub。
// 补签拿到的是同一个人的新 token，所以只换 exp 不换 sub。
export const TOKEN_A = fakeToken('A')
export const TOKEN_A2 = fakeToken('A', 7200)
export const TOKEN_B = fakeToken('B')
export const TOKEN_B2 = fakeToken('B', 7200)
export const USER_A = { id: 'A', maskedPhone: '183****0001' }
export const USER_B = { id: 'B', maskedPhone: '183****0002' }

// ── wx 替身 ────────────────────────────────────────────────────────────────
// faults.set / faults.remove:
//   'throw'  → 接口抛异常（storage.js 会捕获）
//   'silent' → 不抛，但什么也没写/没删（**返回值盖不住的那一种**）

export function createWx(seed) {
  // seed = 冷启动：换一个进程，但盘上的内容原样还在。
  const store = seed instanceof Map ? seed : new Map()
  // faults.key/keyMode 只让**某一格**写失败 —— 换号时的 torn write 就是这个形状。
  // faults.keys[key] = { set, remove, get } 按格分别坏（Codex 冷审 10/17：存储可以只坏资格那一格的写和删）；
  //   get: 'throw' 让那一格的读抛异常（storage.get 会捕获、退回默认值）。按格设置优先于上面的整体设置。
  const faults = { set: null, remove: null, key: null, keyMode: null, keys: {} }
  const calls = { login: [], request: [], upload: [], toast: [], nav: [], loading: [], modal: [] }
  const clone = (v) => {
    try {
      return JSON.parse(JSON.stringify(v))
    } catch (_) {
      return v
    }
  }
  return {
    store,
    faults,
    calls,
    getStorageSync(key) {
      const perKey = faults.keys[key]
      if (perKey && perKey.get === 'throw') throw new Error('getStorageSync failed')
      return store.has(key) ? store.get(key) : ''
    },
    setStorageSync(key, value) {
      const perKey = faults.keys[key]
      const mode = (perKey && perKey.set) || (faults.key === key ? faults.keyMode : faults.set)
      if (mode === 'throw') throw new Error('setStorageSync failed')
      if (mode === 'silent') return
      store.set(key, clone(value))
    },
    removeStorageSync(key) {
      const perKey = faults.keys[key]
      const mode = (perKey && perKey.remove) || faults.remove
      if (mode === 'throw') throw new Error('removeStorageSync failed')
      if (mode === 'silent') return
      store.delete(key)
    },
    login(opts) { calls.login.push(opts) },
    request(opts) { calls.request.push(opts) },
    uploadFile(opts) { calls.upload.push(opts) },
    getAccountInfoSync() { return { miniProgram: { envVersion: 'release' } } },
    // 页面用到的那几个：跳转一律只记录，不真的走。
    showToast(opts) { calls.toast.push((opts && opts.title) || '') },
    showLoading(opts) { calls.loading.push(['show', (opts && opts.title) || '']) },
    hideLoading() { calls.loading.push(['hide', '']) },
    switchTab(opts) { calls.nav.push(['switchTab', opts && opts.url]) },
    redirectTo(opts) { calls.nav.push(['redirectTo', opts && opts.url]) },
    navigateTo(opts) { calls.nav.push(['navigateTo', opts && opts.url]) },
    navigateBack() { calls.nav.push(['navigateBack', '']) },
    reLaunch(opts) { calls.nav.push(['reLaunch', opts && opts.url]) },
    showModal(opts) { calls.modal.push(opts) },
    getWindowInfo() { return { statusBarHeight: 20 } },
  }
}

/**
 * 真实模块装进一个只有 wx 替身的沙箱。
 * mutate(name, source) 可在**内存里**改写源码（磁盘上的生产源不动）。
 */
export function createRuntime({ mutate, store } = {}) {
  const wx = createWx(store)
  // 计时器由测试自己推进：launch.js 的「登录成功 → 600ms 后跳转」不能真等。
  // （vm 的新 realm 本来就没有 setTimeout，必须注入。）
  const timers = []
  const sandbox = {
    wx,
    console,
    setTimeout: (fn) => timers.push(fn),
    clearTimeout: () => {},
    setInterval: (fn) => timers.push(fn),
    clearInterval: () => {},
    getApp: () => ({ globalData: { statusBarHeight: 20 } }),
    getCurrentPages: () => [{ route: 'pages/launch/launch' }],
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)

  const cache = new Map()
  const load = (name) => {
    if (cache.has(name)) return cache.get(name).exports
    const file = path.join(UTILS, `${name}.js`)
    let source = fs.readFileSync(file, 'utf8')
    if (mutate) source = mutate(name, source)
    const mod = { exports: {} }
    cache.set(name, mod)
    const compiled = vm.compileFunction(source, ['module', 'exports', 'require'], {
      parsingContext: sandbox,
      filename: file,
    })
    compiled(mod, mod.exports, (spec) => load(String(spec).replace(/^\.\//, '').replace(/\.js$/, '')))
    return mod.exports
  }

  const ctx = { wx, storage: load('storage'), auth: load('auth'), net: load('request'), load }
  ctx.resigninCalls = () => wx.calls.request.filter((c) => c.url.includes('/wx-resignin'))
  ctx.runTimers = () => { timers.splice(0).forEach((fn) => fn()) }

  /**
   * 真跑一个页面：Page 配置由沙箱捕获后实例化成带 setData 的对象。
   * utils/auth 用的是上面那一份**真实**实例（页面与请求层共享同一个会话），
   * 只有 utils/api 是替身 —— 它是网络边界，和 wx 同类。
   */
  ctx.loadPage = (relPath, apiStub) => {
    const file = path.join(MINIAPP, relPath)
    let source = fs.readFileSync(file, 'utf8')
    if (mutate) source = mutate(relPath, source)
    let config = null
    sandbox.Page = (cfg) => { config = cfg }
    // 页面目录里的同级模块（如 print-pickup/pickup-state.js）也装进同一个沙箱，它们引用的 utils 走同一份实例。
    const local = new Map()
    const requireFrom = (dir) => (spec) => {
      const s = String(spec)
      if (s.startsWith('./')) {
        const target = path.join(dir, `${s.slice(2).replace(/\.js$/, '')}.js`)
        if (!local.has(target)) {
          const mod = { exports: {} }
          local.set(target, mod)
          vm.compileFunction(fs.readFileSync(target, 'utf8'), ['module', 'exports', 'require'], {
            parsingContext: sandbox,
            filename: target,
          })(mod, mod.exports, requireFrom(path.dirname(target)))
        }
        return local.get(target).exports
      }
      const name = s.replace(/^(\.\.\/)+utils\//, '').replace(/\.js$/, '')
      return name === 'api' ? apiStub : load(name)
    }
    const compiled = vm.compileFunction(source, ['module', 'exports', 'require'], {
      parsingContext: sandbox,
      filename: file,
    })
    compiled({ exports: {} }, {}, requireFrom(path.dirname(file)))
    assert.ok(config, `页面没有调用 Page()：${relPath}`)
    const page = Object.assign({}, config)
    page.data = JSON.parse(JSON.stringify(config.data))
    page.setData = function setData(patch) { Object.assign(this.data, patch) }
    return page
  }

  return ctx
}

export const authHeader = (call) => (call && call.header && call.header.Authorization) || null

export function mutator(target, pairs) {
  const file = target.includes('/') ? path.join(MINIAPP, target) : path.join(UTILS, `${target}.js`)
  const source = fs.readFileSync(file, 'utf8')
  for (const [from] of pairs) {
    assert.ok(source.includes(from), `变异锚点已失效（${target}）：${from.slice(0, 60)}`)
  }
  return (name, src) => {
    if (name !== target) return src
    let out = src
    for (const [from, to] of pairs) out = out.split(from).join(to)
    return out
  }
}

/** 变异必须让**断言**失败（ERR_ASSERTION），而不是把代码改崩。 */
export const assertionFailed = (err) => err && err.code === 'ERR_ASSERTION'
