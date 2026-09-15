/**
 * W6 集成契约 —— 验证器自身的看门测试。
 *
 * ## 2026-09-15：这条测试为什么一直是红的
 *
 * 它此前钉的是验证器的一句**输出文案**：`check('86/86 routes')`。
 * 那个数字是 2026-07-25 那天 main 的路由条数快照，不是任何人定过的产品约束；
 * 验证器随后一路 `87/87`…`108/108`，最后在 ebd9b9ba7（2026-09-10，#1012）
 * 连同 `PRODUCTION_ROUTE_QUOTA` 一起改成集合相等：`router matches frozen route manifest`。
 * 这条测试从落地当天（09947a454）起就没再被改过一个字，于是它从 2026-07-25 起
 * 一直失败，而 `node --test scripts/tests/*.test.mjs` 通配一跑就红。
 *
 * 它当时判红的不是缺陷，是**它自己钉住了一个会随时间过期的常量**。
 *
 * ## 改成钉什么
 *
 * 真实不变量只有一条：**router 声明的路由集合 ≡ 冻结的 route manifest**
 * （重定向同理：源 → 目标一一对应）。条数从 manifest 现算，加一条路由是常态，
 * 不该有任何一处需要人工抬数字。
 *
 * 所以下面三条：
 *   1. 验证器整体绿，且一条 `FAIL` 都不打印 —— **不钉任何 check 文案**，
 *      改名不再把这条测试拖红（那正是它烂掉的原因）；
 *   2. 同一份不变量**独立算一遍**：直接用 verify-fusion-baseline 共用的那套
 *      AST 抽取器读 `src/routes/index.tsx` 与 `tests/visual/route-manifest.ts`，
 *      断言两边排序后逐字相等。只断言集合，不断言条数；
 *   3. 阴性对照：把 manifest / router 的源码在内存里各改一个字，
 *      断言第 2 条的比较**必然转红** —— 否则第 2 条就只是一句永远为真的话。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  extractDeclaredRedirects,
  extractDeclaredRoutePatterns,
  extractManifestRedirects,
  extractManifestRoutePatterns,
} from '../lib/fusion-baseline-contract.mjs'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const verifier = join(kioskRoot, 'scripts', 'verify-fusion-w6.mjs')
const ROUTER_PATH = join(kioskRoot, 'src', 'routes', 'index.tsx')
const MANIFEST_PATH = join(kioskRoot, 'tests', 'visual', 'route-manifest.ts')

const readRouter = () => readFileSync(ROUTER_PATH, 'utf8')
const readManifest = () => readFileSync(MANIFEST_PATH, 'utf8')

/**
 * 把两份源码算成同一形状，供比较。
 *
 * 抽取器和 verify-fusion-baseline 用的是同一套（AST 解析，不是正则），所以这里
 * 既不是把验证器的实现抄一遍，也不会因为验证器内部重构而失真。
 */
function routeContract(routerSource, manifestSource) {
  return {
    router: [...extractDeclaredRoutePatterns(routerSource)].sort(),
    manifest: [...extractManifestRoutePatterns(manifestSource)].sort(),
    routerRedirects: extractDeclaredRedirects(routerSource),
    manifestRedirects: extractManifestRedirects(manifestSource),
  }
}

test('W6 验证器整体通过，且一条 FAIL 都不打印', () => {
  const result = spawnSync(process.execPath, [verifier], {
    cwd: kioskRoot,
    encoding: 'utf8',
    env: process.env,
  })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`

  assert.equal(result.status, 0, output)
  // 只按 FAIL / 总结行判，不逐条钉 check 文案：文案会随实现改名，而这条测试
  // 2026-07-25 起整整烂了七周，烂在它钉了一句会过期的文案上。
  const failures = output.split('\n').filter((line) => line.startsWith('FAIL '))
  assert.deepEqual(failures, [], output)
  assert.match(output, /^ALL PASS fusion W6 integration contract$/m, output)
  // 验证器必须真的跑出过检查项，否则「零 FAIL」可以由一个空跑的脚本免费拿到。
  const passes = output.split('\n').filter((line) => line.startsWith('PASS '))
  assert.ok(passes.length >= 8, `验证器只打印了 ${passes.length} 条 PASS，疑似空跑：\n${output}`)
})

test('router 声明的路由与重定向，逐条等于冻结的 route manifest', () => {
  const contract = routeContract(readRouter(), readManifest())

  // 条数从 manifest 现算。这里**不写任何字面量条数** —— 加一条路由是常态，
  // 「一体机不该超过 N 条路由」从来没有人定过（见 lib/fusion-baseline-contract.mjs 顶部）。
  assert.deepEqual(contract.router, contract.manifest)
  assert.deepEqual(contract.routerRedirects, contract.manifestRedirects)
  assert.ok(contract.manifest.length > 0, 'manifest 抽不出任何路由 = 抽取器坏了，不是「全都一致」')
  assert.equal(
    new Set(contract.router).size,
    contract.router.length,
    'router 里有重复路由：集合相等会把重复悄悄吃掉',
  )
})

test('阴性对照：manifest 或 router 任一侧偷改一个字，上面那条比较必然转红', () => {
  const routerSource = readRouter()
  const manifestSource = readManifest()

  // ① manifest 偷加一条 router 里没有的路由（lib 顶部记录的那条复现配方）。
  const sneakedManifest = manifestSource.replace(
    'export const productionRoutePatterns = [',
    "export const productionRoutePatterns = [\n  '/zz-sneaked-route',",
  )
  assert.notEqual(sneakedManifest, manifestSource, '变异没有落地：manifest 的声明写法变了')
  const sneaked = routeContract(routerSource, sneakedManifest)
  assert.throws(
    () => assert.deepEqual(sneaked.router, sneaked.manifest),
    assert.AssertionError,
    'manifest 多出一条路由却没被判红 —— 集合相等这条断言是假的',
  )

  // ② router 侧删掉一条真实存在的路由（登录页，全站都要用）。
  const droppedRouter = routerSource.replace("path: '/login'", "path: '/zz-renamed-login'")
  assert.notEqual(droppedRouter, routerSource, '变异没有落地：router 里 /login 的写法变了')
  const dropped = routeContract(droppedRouter, manifestSource)
  assert.throws(
    () => assert.deepEqual(dropped.router, dropped.manifest),
    assert.AssertionError,
    'router 改了一条路由却没被判红',
  )

  // ③ 重定向目标被改掉也要红（只比较源的话，改 to 就是一条静默的错误跳转）。
  const firstSource = Object.keys(routeContract(routerSource, manifestSource).manifestRedirects)[0]
  assert.ok(firstSource, 'manifest 里一条兼容重定向都没有 = 抽取器坏了')
  const rewiredManifest = manifestSource.replace(
    new RegExp(`('${firstSource.replace(/[.*+?^$(){}|[\\\]\\\\]/g, '\\\\$&')}':\\s*)'[^']*'`),
    "$1'/zz-rewired-target'",
  )
  assert.notEqual(rewiredManifest, manifestSource, '变异没有落地：兼容重定向的写法变了')
  const rewired = routeContract(routerSource, rewiredManifest)
  assert.throws(
    () => assert.deepEqual(rewired.routerRedirects, rewired.manifestRedirects),
    assert.AssertionError,
    '重定向目标被改却没被判红',
  )
})
