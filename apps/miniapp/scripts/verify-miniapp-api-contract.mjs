#!/usr/bin/env node
/**
 * 小程序 ↔ 后端 API 契约门禁
 *
 * 存在的理由：小程序是原生 JS，跨 apps/miniapp → services/api 的调用没有任何类型检查。
 * 另一条 lane 改名、挪走或删掉一个端点时，小程序不会编译失败，只会在用户手里静默 404。
 * 这个门禁把那条缝变成 CI 里的一条红线。
 *
 * 做三件事：
 *   1. 从 apps/miniapp/utils/api.js 抽出小程序真实发起的 (method, path)。
 *   2. 从 services/api/src 的控制器装饰器算出后端真实提供的路由集合。
 *   3. 和 contract/api-contract.json 快照比对，报告三类问题：
 *      - BROKEN：快照里承诺可用、现在后端没有了  →  另一条 lane 拆了小程序（必须红）
 *      - UNDECLARED：小程序新调了端点但没进快照   →  小程序 lane 自己漏更新（必须红）
 *      - STALE：快照里的豁免项后端已经补上了     →  提示把豁免删掉（必须红，防豁免长草）
 *
 * 已知缺口写在快照的 knownMissing 里，每条必须带原因，不允许空理由豁免。
 *
 * 用法：
 *   node apps/miniapp/scripts/verify-miniapp-api-contract.mjs           # 校验
 *   node apps/miniapp/scripts/verify-miniapp-api-contract.mjs --write   # 重新生成快照
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const API_JS = join(REPO, 'apps/miniapp/utils/api.js')
const API_SRC = join(REPO, 'services/api/src')
const SNAPSHOT = join(HERE, 'api-contract.json')

/** 路径参数名不参与契约身份：/jobs/${id} 和 /jobs/:jobId 是同一个端点 */
const normalize = (p) =>
  ('/' + p.replace(/^\/+/, ''))
    .replace(/\$\{[^}]*\}/g, ':p')   // 小程序模板字面量
    .replace(/:[A-Za-z0-9_]+/g, ':p') // Nest 路由参数
    .replace(/\/+$/, '')
    .replace(/\/{2,}/g, '/') || '/'

const key = (m, p) => `${m} ${normalize(p)}`

/**
 * 段级匹配，而不是字符串相等。
 * 小程序写死的字面量段（/me/ai-consents/job_ai/revoke 的 job_ai）要能命中
 * 后端的参数段（@Post(':scope/revoke')）；反过来，小程序传变量的段（:p）
 * 只能命中后端同样是参数的段——否则等于放行一个后端并不接受的动态路径。
 */
function routeMatches(callKey, routeKey) {
  const [cm, cp] = callKey.split(' ')
  const [rm, rp] = routeKey.split(' ')
  if (cm !== rm) return false
  const cs = cp.split('/')
  const rs = rp.split('/')
  if (cs.length !== rs.length) return false
  return cs.every((seg, i) => seg === rs[i] || (rs[i] === ':p' && seg !== ':p') || (rs[i] === ':p' && seg === ':p'))
}

const servedBy = (routes, callKey) =>
  routes.has(callKey) || [...routes].some((r) => routeMatches(callKey, r))

// ---------- 1. 小程序侧 ----------

function collectMiniappCalls() {
  const src = readFileSync(API_JS, 'utf8')
  const found = new Map() // key -> Set(行号)

  // request('/x', {...})  /  request(`/x/${id}`, {...})  /  uploadFile('/x', file, {...})
  const re = /\b(request|uploadFile)\(\s*(['"`])([^'"`]*?)\2/g
  let m
  while ((m = re.exec(src)) !== null) {
    const fn = m[1]
    const path = m[3]
    if (!path.startsWith('/')) continue // 变量拼接的路径抓不到，交给下面的兜底告警

    const line = src.slice(0, m.index).split('\n').length
    // uploadFile 恒为 POST；request 从紧随其后的 options 对象里读 method（默认 GET）
    let method = 'POST'
    if (fn === 'request') {
      const tail = src.slice(m.index, m.index + 400)
      const mm = /method:\s*['"]([A-Za-z]+)['"]/.exec(tail)
      method = (mm ? mm[1] : 'GET').toUpperCase()
    }
    const k = key(method, path)
    if (!found.has(k)) found.set(k, new Set())
    found.get(k).add(line)
  }
  return found
}

// ---------- 2. 后端侧 ----------

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (p.endsWith('.controller.ts')) out.push(p)
  }
  return out
}

function collectApiRoutes() {
  const routes = new Set()
  for (const file of walk(API_SRC)) {
    const src = readFileSync(file, 'utf8')
    // 一个文件可以有多个 @Controller 类；按 @Controller 出现位置切段
    const ctrlRe = /@Controller\(\s*(?:(['"])([^'"]*)\1)?\s*\)/g
    const segs = []
    let c
    while ((c = ctrlRe.exec(src)) !== null) segs.push({ prefix: c[2] || '', at: c.index })
    if (segs.length === 0) continue
    for (let i = 0; i < segs.length; i++) {
      const body = src.slice(segs[i].at, i + 1 < segs.length ? segs[i + 1].at : src.length)
      const mRe = /@(Get|Post|Put|Patch|Delete)\(\s*(?:(['"`])([^'"`]*)\2)?\s*\)/g
      let r
      while ((r = mRe.exec(body)) !== null) {
        const method = r[1].toUpperCase()
        const sub = r[3] || ''
        routes.add(key(method, `${segs[i].prefix}/${sub}`))
      }
    }
  }
  return routes
}

// ---------- 3. 比对 ----------

const calls = collectMiniappCalls()
const routes = collectApiRoutes()

if (calls.size === 0) {
  console.error('✗ 从 api.js 抽不出任何调用 —— 抽取逻辑已失效，不要当作通过')
  process.exit(1)
}
if (routes.size === 0) {
  console.error('✗ 从 services/api/src 抽不出任何路由 —— 抽取逻辑已失效，不要当作通过')
  process.exit(1)
}

const WRITE = process.argv.includes('--write')

if (WRITE) {
  const prev = (() => { try { return JSON.parse(readFileSync(SNAPSHOT, 'utf8')) } catch { return {} } })()
  const knownMissing = prev.knownMissing || {}
  const endpoints = [...calls.keys()].sort()
  const missing = endpoints.filter((k) => !servedBy(routes, k))
  for (const k of missing) if (!knownMissing[k]) knownMissing[k] = '待填写：为什么后端还没有这个端点'
  for (const k of Object.keys(knownMissing)) if (!missing.includes(k)) delete knownMissing[k]
  writeFileSync(
    SNAPSHOT,
    JSON.stringify(
      {
        _README:
          '小程序依赖的后端端点契约快照。任何 lane 改动 services/api 路由导致这里的端点消失，CI 会红。' +
          '新增小程序调用后跑 --write 更新；knownMissing 里的每一条都必须写清原因。',
        generatedFrom: 'apps/miniapp/utils/api.js + services/api/src/**/*.controller.ts',
        endpoints,
        knownMissing,
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`✓ 快照已写入 ${SNAPSHOT}`)
  console.log(`  端点 ${endpoints.length} 个，其中后端尚未提供 ${missing.length} 个`)
  process.exit(0)
}

let snap
try {
  snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
} catch {
  console.error(`✗ 读不到快照 ${SNAPSHOT}；先跑 --write 生成`)
  process.exit(1)
}

const declared = new Set(snap.endpoints || [])
const knownMissing = snap.knownMissing || {}
const problems = []

// BROKEN：快照承诺可用、后端却没有了 —— 别的 lane 拆了小程序
for (const k of declared) {
  if (!servedBy(routes, k) && !(k in knownMissing)) {
    problems.push(['BROKEN', k, '小程序依赖此端点，但 services/api 已无对应路由（被改名/挪走/删除？）'])
  }
}
// UNDECLARED：小程序新调了端点但没更新快照
for (const k of calls.keys()) {
  if (!declared.has(k)) {
    const lines = [...calls.get(k)].join(',')
    problems.push(['UNDECLARED', k, `api.js:${lines} 新增了调用，但未进快照；跑 --write 并检查后端是否已提供`])
  }
}
// STALE：豁免项后端已补上，豁免该删了
for (const k of Object.keys(knownMissing)) {
  if (servedBy(routes, k)) problems.push(['STALE', k, '后端已提供此端点，请从 knownMissing 移除（跑 --write）'])
}
// 空理由的豁免不算豁免
for (const [k, why] of Object.entries(knownMissing)) {
  if (!why || /待填写/.test(why)) problems.push(['NOREASON', k, 'knownMissing 缺少真实原因，不接受空理由豁免'])
}

const missingWithReason = Object.keys(knownMissing).filter((k) => !servedBy(routes, k))
console.log(`小程序调用端点 ${calls.size} 个 · 后端路由 ${routes.size} 条 · 已知缺口 ${missingWithReason.length} 个`)
for (const k of missingWithReason) console.log(`  ○ 未开放  ${k}  —— ${knownMissing[k]}`)

if (problems.length) {
  console.error(`\n✗ 契约门禁失败，${problems.length} 项：`)
  for (const [kind, k, why] of problems) console.error(`  [${kind}] ${k}\n            ${why}`)
  process.exit(1)
}
console.log('\n✓ 小程序 ↔ 后端 API 契约一致')
