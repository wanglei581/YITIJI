#!/usr/bin/env node
/**
 * verify:kiosk-session-reporting —— 服务人次上报的接线（上报器本身的行为由
 * scripts/tests/kiosk-session-reporting.test.mjs 真跑覆盖，package 脚本两者一起跑）。
 *
 * 这里钉的是「挂在哪儿」，全部用 TypeScript AST 取证，不读注释：
 *   1. KioskPrivacyGuard 调 useKioskSessionReporting(pathname)；
 *      硬清场（endKioskUse）与进屏保清场（clearToScreensaver）都经 runEndKioskUse，endVisit 接 endKioskVisit，
 *      hold(...) 只在最后一步 leave 里；
 *      交给超时提醒页的 hardClear 是包过一层的（按钮 onClick 不能把点击事件当原因传进来）。
 *   2. 接线文件在演示模式与浏览器测试构建里关闭上报；请求走终端身份封装、带 keepalive。
 *   3. 全仓一体机源码只有接线文件拼 /kiosk/session/ 地址 —— 不许在页面里散落调用。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
let failures = 0
const pass = (m) => console.log(`  ✓ ${m}`)
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`) }

function parse(rel) {
  const text = readFileSync(join(kioskRoot, rel), 'utf8')
  return ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}

function walk(node, visit) {
  visit(node)
  ts.forEachChild(node, (child) => walk(child, visit))
}

/** `const name = useCallback(<fn>, deps)` 或 `const name = <fn>` 的函数体节点。 */
function declaredFunction(sf, name) {
  let found = null
  walk(sf, (n) => {
    if (found || !ts.isVariableDeclaration(n) || n.name.getText(sf) !== name || !n.initializer) return
    let init = n.initializer
    if (ts.isCallExpression(init) && init.expression.getText(sf) === 'useCallback') init = init.arguments[0]
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) found = init
  })
  return found
}

/** 函数体内按出现顺序列出的调用（callee 文本 + 第一个参数文本）。 */
function callsIn(sf, node) {
  const calls = []
  walk(node, (n) => {
    if (ts.isCallExpression(n)) calls.push({ callee: n.expression.getText(sf), arg0: n.arguments[0]?.getText(sf) ?? '', pos: n.getStart(sf) })
  })
  return calls.sort((a, b) => a.pos - b.pos)
}

// ── 1. KioskPrivacyGuard ──────────────────────────────────────────
{
  const rel = 'src/auth/KioskPrivacyGuard.tsx'
  const sf = parse(rel)
  const guard = declaredFunction(sf, 'KioskPrivacyGuard')
  let guardFn = guard
  if (!guardFn) {
    walk(sf, (n) => { if (!guardFn && ts.isFunctionDeclaration(n) && n.name?.text === 'KioskPrivacyGuard') guardFn = n })
  }
  if (!guardFn) fail(`${rel}: 找不到 KioskPrivacyGuard`)
  else {
    const hookCall = callsIn(sf, guardFn).find((c) => c.callee === 'useKioskSessionReporting')
    if (!hookCall || hookCall.arg0 !== 'pathname') fail('KioskPrivacyGuard 没有调用 useKioskSessionReporting(pathname)')
    else pass('KioskPrivacyGuard 挂了 useKioskSessionReporting(pathname)')
  }

  /* 2026-09-29（统一清场）：四步（结束人次 → 清本机 → 退出登录 → 离开）的顺序只写在
   * kioskEndUse.ts 的 runEndKioskUse 里（scripts/tests/kiosk-end-use.test.mjs 真跑断言顺序）。
   * 守卫里每条清场路径都必须调 runEndKioskUse，把 endVisit 接到 endKioskVisit，
   * 并且「整页重载 / 进屏保」只能写在最后一步 leave 里的 hold(...) 中。 */
  const stepProp = (call, prop) => {
    const obj = call.arguments[1]
    if (!obj || !ts.isObjectLiteralExpression(obj)) return null
    return obj.properties.find((p) => p.name?.getText(sf) === prop) ?? null
  }
  for (const [name, reasonRule] of [
    ['endKioskUse', (arg) => arg === 'reason'],
    ['clearToScreensaver', (arg) => arg === "'idle_timeout'"],
  ]) {
    const fn = declaredFunction(sf, name)
    if (!fn) { fail(`${rel}: 找不到清场函数 ${name}`); continue }
    let run = null
    walk(fn, (n) => { if (!run && ts.isCallExpression(n) && n.expression.getText(sf) === 'runEndKioskUse') run = n })
    if (!run) { fail(`${name} 没有经 runEndKioskUse 清场：这一次使用可能不会被记为结束`); continue }
    const reason = run.arguments[0]?.getText(sf) ?? ''
    const endVisit = stepProp(run, 'endVisit')
    const leave = stepProp(run, 'leave')
    if (!reasonRule(reason)) fail(`${name} 的结束原因不对：${reason}`)
    else if (!endVisit || !ts.isPropertyAssignment(endVisit) || endVisit.initializer.getText(sf) !== 'endKioskVisit') {
      fail(`${name} 的 endVisit 没有接到 endKioskVisit：这一次使用永远不会被记为结束`)
    } else if (!leave || !callsIn(sf, leave).some((c) => c.callee === 'hold')) {
      fail(`${name} 的整页重载 / 进屏保必须写在 leave 里、经 hold(...)（在结束人次之后）`)
    } else pass(`${name} 经 runEndKioskUse(${reason})：先 endKioskVisit，最后才 hold 交接`)
  }

  // 公开的清场出口都经 endKioskUse，不能绕过它另起一条不上报的清场。
  for (const name of ['endKioskUseFromPage', 'hardClear']) {
    const fn = declaredFunction(sf, name)
    if (!fn || !callsIn(sf, fn).some((c) => c.callee === 'endKioskUse')) fail(`${name} 没有经 endKioskUse 清场`)
  }

  let ctxHardClear = null
  walk(sf, (n) => {
    if (ts.isPropertyAssignment(n) && n.name.getText(sf) === 'hardClear' && ts.isObjectLiteralExpression(n.parent)) ctxHardClear = n.initializer.getText(sf)
  })
  if (ctxHardClear !== 'hardClearFromWarning') fail(`交给超时提醒页的 hardClear 应是 hardClearFromWarning，实际 ${ctxHardClear}`)
  else pass('超时提醒页拿到的 hardClear 已包一层，按到点与否区分 idle_timeout / user_exit')
}

// ── 2. 接线文件 ────────────────────────────────────────────────
{
  const rel = 'src/auth/useKioskSessionReporting.ts'
  const sf = parse(rel)
  let enabledExpr = ''
  walk(sf, (n) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'REPORTING_ENABLED' && n.initializer) enabledExpr = n.initializer.getText(sf)
  })
  if (!/API_MODE\s*===\s*'http'/.test(enabledExpr) || !/!IS_E2E_BUILD/.test(enabledExpr)) {
    fail(`演示模式 / 浏览器测试构建必须关闭上报，实际 REPORTING_ENABLED = ${enabledExpr || '（未定义）'}`)
  } else pass(`上报开关：${enabledExpr}`)

  const calls = callsIn(sf, sf)
  const create = calls.find((c) => c.callee === 'createKioskVisitReporter')
  if (!create) fail('接线文件没有用 createKioskVisitReporter 建上报器')
  let createArgs = []
  walk(sf, (n) => {
    if (ts.isCallExpression(n) && n.expression.getText(sf) === 'createKioskVisitReporter') createArgs = n.arguments.map((a) => a.getText(sf))
  })
  if (createArgs[1] !== 'REPORTING_ENABLED') fail(`createKioskVisitReporter 第二个参数应为 REPORTING_ENABLED，实际 ${createArgs[1]}`)

  const send = declaredFunction(sf, 'sendVisit')
  let sendFn = send
  if (!sendFn) walk(sf, (n) => { if (!sendFn && ts.isFunctionDeclaration(n) && n.name?.text === 'sendVisit') sendFn = n })
  if (!sendFn) fail('找不到 sendVisit')
  else {
    const text = sendFn.getText(sf)
    if (!callsIn(sf, sendFn).some((c) => c.callee === 'terminalProtectedFetch')) fail('上报没有走终端身份封装 terminalProtectedFetch')
    if (!/keepalive:\s*true/.test(text)) fail('上报请求缺 keepalive：清场整页重载会把 end 掐掉')
    if (!/'x-terminal-id'/.test(text)) fail('上报请求没有显式带 x-terminal-id')
    if (!/\/kiosk\/session\/\$\{endpoint\}/.test(text)) fail('上报地址不是 /kiosk/session/${endpoint}')
    pass('上报走 terminalProtectedFetch，带 x-terminal-id 与 keepalive')
  }
}

// ── 3. 不许散落调用 ─────────────────────────────────────────────
{
  const offenders = []
  const stack = [join(kioskRoot, 'src')]
  while (stack.length) {
    const dir = stack.pop()
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      if (statSync(abs).isDirectory()) { stack.push(abs); continue }
      if (!/\.(ts|tsx)$/.test(name)) continue
      const rel = relative(kioskRoot, abs)
      if (rel === join('src', 'auth', 'useKioskSessionReporting.ts')) continue
      const sf = ts.createSourceFile(rel, readFileSync(abs, 'utf8'), ts.ScriptTarget.ES2022, true, name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      walk(sf, (n) => {
        if ((ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && /\/kiosk\/session\//.test(n.text)) offenders.push(rel)
      })
    }
  }
  if (offenders.length) fail(`这些文件自己拼了 /kiosk/session/ 地址：${[...new Set(offenders)].join(', ')}`)
  else pass('只有接线文件发服务人次上报')
}

if (failures > 0) {
  console.error(`\n❌ verify:kiosk-session-reporting  ${failures} 项失败`)
  process.exit(1)
}
console.log('\n✅ verify:kiosk-session-reporting 接线通过')
