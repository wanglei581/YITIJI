// 执行 admin 真实 logout()：转译 src/services/auth/index.ts 后在沙箱里调用。
// Playwright 看不到 fetch 的 keepalive 选项，这里桩掉 fetch，断言传给真实函数的选项。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createContext, Script } from 'node:vm'
import ts from 'typescript'
import { loadAuthSecondFactorModule } from './support/auth-second-factor-module.mjs'

const adminRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const STORAGE_KEY = 'admin_auth_v1'

function responseOk() {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ data: { loggedOut: true } }),
  }
}

function loadLogout(apiMode, fetchImpl) {
  const source = readFileSync(join(adminRoot, 'src/services/auth/index.ts'), 'utf8')
  const storage = new Map([
    [STORAGE_KEY, JSON.stringify({
      token: 'unit-logout-token',
      user: { id: 'admin-1', name: 'Admin', role: 'admin', orgId: null },
    })],
  ])
  const calls = []
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, String(value)) },
    removeItem: (key) => { storage.delete(key) },
  }
  const window = { location: { href: 'http://admin.local/', pathname: '/' } }
  const fetch = fetchImpl ?? ((url, init) => {
    calls.push({ url, init })
    return Promise.resolve(responseOk())
  })
  const module = { exports: {} }
  const context = createContext({
    module,
    exports: module.exports,
    require: (specifier) => {
      if (specifier === '../api/client') return { API_BASE_URL: '/api/v1', API_MODE: apiMode }
      if (specifier === './secondFactor') return loadAuthSecondFactorModule(adminRoot)
      throw new Error(`Unexpected module: ${specifier}`)
    },
    fetch,
    localStorage,
    window,
  })
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'auth/index.ts',
  })
  new Script(transpiled.outputText, { filename: 'auth/index.js' }).runInContext(context)
  return { logout: module.exports.logout, calls, storage, window }
}

async function settled(harness) {
  const start = Date.now()
  while (harness.storage.has(STORAGE_KEY)) {
    if (Date.now() - start > 1000) throw new Error('logout 没有在 1 秒内清掉本地登录态')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('http 模式的真实 logout() 把 keepalive: true 传给 fetch', async () => {
  const harness = loadLogout('http')
  harness.logout()
  await settled(harness)
  assert.equal(harness.calls.length, 1)
  assert.equal(harness.calls[0].url, '/api/v1/auth/logout')
  assert.equal(harness.calls[0].init.method, 'POST')
  assert.equal(harness.calls[0].init.keepalive, true)
  assert.equal(harness.calls[0].init.credentials, 'include')
  assert.equal(harness.calls[0].init.headers.Accept, 'application/json')
  assert.equal(harness.calls[0].init.headers.Authorization, 'Bearer unit-logout-token')
  assert.equal(harness.window.location.href, '/login')
})

test('退出进行中再次调用不重复发请求', async () => {
  let release
  const pending = new Promise((resolve) => { release = resolve })
  const calls = []
  const harness = loadLogout('http', (url, init) => {
    calls.push({ url, init })
    return pending
  })
  harness.logout()
  harness.logout()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].init.keepalive, true)
  release(responseOk())
  await settled(harness)
  assert.equal(calls.length, 1)
})

test('mock 模式不发请求，仍然清本地并跳登录页', async () => {
  const harness = loadLogout('mock')
  harness.logout()
  await settled(harness)
  assert.equal(harness.calls.length, 0)
  assert.equal(harness.window.location.href, '/login')
})
