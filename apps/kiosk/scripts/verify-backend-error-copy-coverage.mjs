#!/usr/bin/env node
/**
 * verify:backend-error-copy-coverage —— 后端排雷这一路新增的错误码，一体机都有一句人话。
 *
 * 分工（总指挥 2026-09-29）：谁新增的码，谁补各端文案。一体机码表由后端窗口维护；
 * 取件码那组由 verify:pickup-claim-error-coverage 管，这里不重复。
 *
 * 两组断言，全部锚在代码上（TypeScript AST 抽服务端的码 / esbuild 真编译一体机模块再调用），不读注释：
 *   A. 账号类：从服务端换绑与短信额度源码里抽出所有机器码，逐个真调一体机 accountErrorMessage，
 *      必须拿到码表里登记的那句，而不是调用方兜底；REBIND_UNAVAILABLE 的换绑恢复必须是「从旧号重来」。
 *   B. AI 类：码清单里凡是在服务端源码里真出现的（未合入的 PR 带来的码，合入后自动纳入），
 *      真调一体机 userMessageOf 必须命中共享码表，而不是兜底或 5xx 通用句。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(kioskRoot, '../..')
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8')

let failures = 0
const pass = (m) => console.log(`  ✓ ${m}`)
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`) }

const MACHINE_CODE = /^[A-Z][A-Z0-9_]+$/

/** `new XxxException(...)` 参数里出现的机器码：字符串参数本身，或对象里 `code:` 的取值。 */
function exceptionCodes(rel) {
  const sf = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const codes = new Set()
  const collect = (n) => {
    if (ts.isStringLiteralLike(n) && MACHINE_CODE.test(n.text)) codes.add(n.text)
    else if (ts.isBinaryExpression(n) || ts.isConditionalExpression(n) || ts.isParenthesizedExpression(n)) ts.forEachChild(n, collect)
  }
  const visitArg = (n) => {
    if (ts.isStringLiteralLike(n)) { collect(n); return }
    if (ts.isPropertyAssignment(n) && n.name.getText() === 'code') { collect(n.initializer); return }
    ts.forEachChild(n, visitArg)
  }
  const walk = (n) => {
    if (ts.isNewExpression(n) && /Exception$/.test(n.expression.getText())) for (const arg of n.arguments ?? []) visitArg(arg)
    ts.forEachChild(n, walk)
  }
  walk(sf)
  return codes
}

async function compileKiosk() {
  const require = createRequire(join(kioskRoot, 'package.json'))
  const { build } = createRequire(require.resolve('vite'))('esbuild')
  const dir = await mkdtemp(join(tmpdir(), 'backend-error-copy-'))
  const outfile = join(dir, 'bundle.mjs')
  await build({
    stdin: {
      contents: [
        "export * as account from './src/pages/auth/accountUserMessage.ts';",
        "export * as auth from './src/services/auth/memberAuthApi.ts';",
        "export * as shared from './src/services/api/userErrorMessage.ts';",
      ].join('\n'),
      resolveDir: kioskRoot,
    },
    bundle: true, format: 'esm', platform: 'browser', outfile, logLevel: 'silent',
    define: { 'import.meta.env': JSON.stringify({ VITE_API_MODE: 'http', VITE_API_BASE_URL: '/api/v1' }), 'process.env.NODE_ENV': '"production"' },
  })
  return { mod: await import(pathToFileURL(outfile).href), cleanup: () => rm(dir, { recursive: true, force: true }) }
}

/** services/api/src 里是否出现该码的字符串字面量。 */
function serverSourceHasCode(code) {
  const needle = new RegExp(`['"\`]${code}['"\`]`)
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'generated' || name === '__tests__') continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { if (walk(full)) return true; continue }
      if (full.endsWith('.ts') && needle.test(readFileSync(full, 'utf8'))) return true
    }
    return false
  }
  return walk(join(repoRoot, 'services/api/src'))
}

console.log('\n=== 后端新增错误码的一体机文案覆盖 ===')
const { mod, cleanup } = await compileKiosk()
try {
  const SENTINEL = '〔调用方兜底句〕'
  // ── A. 账号类 ──────────────────────────────────────────────────────
  const accountFiles = [
    'services/api/src/member-auth/member-phone-rebind.service.ts',
    'services/api/src/member-auth/sms/sms-budget.ts',
  ]
  const accountCodes = new Set()
  for (const rel of accountFiles) {
    if (!existsSync(join(repoRoot, rel))) { fail(`找不到 ${rel}（服务端改名或挪位，先更新本门禁）`); continue }
    for (const c of exceptionCodes(rel)) accountCodes.add(c)
  }
  // 阳性对照：抽取器坏了会抽出空集，「全都有登记」就会空转变绿。
  for (const must of ['PHONE_CONFLICT', 'REBIND_CODE_INVALID', 'SMS_DAILY_TOTAL_LIMIT', 'SMS_TERMINAL_DAILY_LIMIT', 'SMS_BUDGET_UNAVAILABLE']) {
    if (!accountCodes.has(must)) fail(`抽取器没从服务端源码抽到 ${must}（抽取器坏了或服务端改名，先查这里）`)
  }
  pass(`账号类从服务端抽到 ${accountCodes.size} 个码：${[...accountCodes].sort().join(', ')}`)
  const { MemberApiError } = mod.auth
  for (const code of [...accountCodes].sort()) {
    // 服务端 message 故意给英文：一体机只在「中文且干净」时显示原话，这里验的是码表那一层。
    const shown = mod.account.accountErrorMessage(new MemberApiError(code, 'Service Unavailable', 503), SENTINEL)
    if (shown === SENTINEL) fail(`一体机 accountUserMessage 没有登记 ${code}：用户只会看到调用方兜底句`)
    else pass(`${code} → ${shown}`)
  }
  if (serverSourceHasCode('REBIND_UNAVAILABLE')) {
    const recovery = mod.account.phoneRebindRecovery(new MemberApiError('REBIND_UNAVAILABLE', 'x', 503))
    if (recovery !== 'restart') fail(`REBIND_UNAVAILABLE（手机号没改、登录仍有效）应从旧号重来，实际 ${recovery}`)
    else pass('REBIND_UNAVAILABLE → 换绑从旧号重来（不让人重新登录）')
  } else {
    console.log('  · REBIND_UNAVAILABLE 尚未出现在服务端源码（#1081 未合入），换绑恢复断言跳过')
  }
  // 反向对照：未知 5xx 仍重新登录核对（不能因为加了一条就把所有失败都当「从旧号重来」）。
  if (mod.account.phoneRebindRecovery(new MemberApiError('SOMETHING_ELSE', 'x', 503)) !== 'relogin') fail('未知 5xx 的换绑恢复不应变成「从旧号重来」')
  else pass('未知 5xx 的换绑恢复仍是重新登录核对')

  // ── B. AI 类 ───────────────────────────────────────────────────────
  const aiCodes = ['AI_ENDPOINT_NOT_ALLOWED', 'AI_BUDGET_EXHAUSTED', 'AI_BUDGET_UNAVAILABLE', 'AI_PROVIDER_NOT_CONFIGURED']
  // 2026-10-04 无人值守：5xx 固定句改为「服务暂时不可用，请稍后重试」加标准句 1。
  // 没有服务联系方式缓存时，电话片段是隐私政策里的联系方式。
  const GENERIC_5XX = '服务暂时不可用，请稍后重试。需要帮助？查看《隐私政策》里的联系方式'
  let checked = 0
  for (const code of aiCodes) {
    if (!serverSourceHasCode(code)) { console.log(`  · ${code} 尚未出现在服务端源码（对应 PR 未合入），跳过`); continue }
    checked += 1
    const shown = mod.shared.userMessageOf({ code }, SENTINEL)
    if (shown === SENTINEL || shown === GENERIC_5XX) fail(`一体机 userErrorMessage 没有登记 ${code}：用户只会看到兜底句`)
    else pass(`${code} → ${shown}`)
  }
  if (checked === 0) fail('AI 类一个码都没在服务端源码里找到：扫描坏了（AI_PROVIDER_NOT_CONFIGURED 早已存在）')
} finally {
  await cleanup()
}

if (failures > 0) {
  console.error(`\n✗ verify:backend-error-copy-coverage：${failures} 项失败`)
  process.exit(1)
}
console.log('\n✓ verify:backend-error-copy-coverage 通过')
