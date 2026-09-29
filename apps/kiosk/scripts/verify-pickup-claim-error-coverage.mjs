#!/usr/bin/env node
/**
 * verify:pickup-claim-error-coverage —— 到机码认领的每个失败码，一体机都有一句能照着做的话。
 *
 * 起因（2026-09-29）：服务端对「已用过、超过 10 分钟再输」的码回 PICKUP_CODE_ALREADY_USED，
 * 一体机映射里没有这个码，落到兜底「请重试」。用户照着重输只会占限流配额，后面的人也用不了。
 *
 * 三段断言，全部锚在代码上（TypeScript AST / 真跑模块），不读注释：
 *   1. 从服务端认领链路源码里抽出所有机器错误码（pickup-order.service.ts 全文件 ——
 *      claim() 会调 release() 与各 assert*；外加它调用的文件完整性、隐私检查与
 *      assertUserTaskAllowed），逐个断言一体机 PICKUP_CLAIM_MESSAGES 有登记，
 *      且 pickupClaimMessage() 真返回登记的那句，而不是兜底。
 *   2. 终态码（已用过、已退款、文件失效、订单不能付款、码不可用）：分类必须是 closed，
 *      文案不得含「重试」「重新输入」。
 *   3. 失败面板里 closed 分支的主按钮回首页，整个分支不引用 onRetry；页面真用
 *      pickupClaimMessage / classifyClaimFailure。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(kioskRoot, '../..')
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8')

let failures = 0
const pass = (m) => console.log(`  ✓ ${m}`)
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`) }

const MACHINE_CODE = /^[A-Z][A-Z0-9_]+$/

function parse(rel) {
  return ts.createSourceFile(rel, read(rel), ts.ScriptTarget.ES2022, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}

/** `new XxxException(...)` 参数里出现的机器码：字符串参数本身，或对象里 `code:` 的取值（含 `a ?? 'X'`）。 */
function exceptionCodes(node) {
  const codes = new Set()
  const collectLiterals = (n) => {
    if (ts.isStringLiteralLike(n) && MACHINE_CODE.test(n.text)) codes.add(n.text)
    else if (ts.isBinaryExpression(n) || ts.isConditionalExpression(n) || ts.isParenthesizedExpression(n)) ts.forEachChild(n, collectLiterals)
  }
  const visitArg = (n) => {
    if (ts.isStringLiteralLike(n)) { collectLiterals(n); return }
    if (ts.isPropertyAssignment(n) && n.name.getText() === 'code') { collectLiterals(n.initializer); return }
    ts.forEachChild(n, visitArg)
  }
  const walk = (n) => {
    if (ts.isNewExpression(n) && /Exception$/.test(n.expression.getText())) {
      for (const arg of n.arguments ?? []) visitArg(arg)
    }
    // 静态常量里的拒绝体（CLAIM_REJECTION = { error: { code: ... } }）
    if (ts.isPropertyDeclaration(n) && n.initializer) visitArg(n.initializer)
    ts.forEachChild(n, walk)
  }
  walk(node)
  return codes
}

function methodNode(sf, name) {
  let found = null
  const walk = (n) => {
    if (!found && ts.isMethodDeclaration(n) && n.name.getText() === name) found = n
    ts.forEachChild(n, walk)
  }
  walk(sf)
  return found
}

// ── 1. 服务端认领链路的码 ─────────────────────────────────────────
const serverCodes = new Set()
for (const rel of [
  'services/api/src/print-jobs/pickup-order.service.ts',
  'services/api/src/print-jobs/pii-scan-gate.ts',
  'services/api/src/files/file-content-integrity.ts',
]) {
  for (const c of exceptionCodes(parse(rel))) serverCodes.add(c)
}
{
  const caps = parse('services/api/src/terminals/terminal-capabilities.service.ts')
  const m = methodNode(caps, 'assertUserTaskAllowed')
  if (!m) fail('terminal-capabilities.service.ts 找不到 assertUserTaskAllowed（认领链路会调它）')
  else for (const c of exceptionCodes(m)) serverCodes.add(c)
}

// 阳性对照：抽取器坏了会抽出空集，后面的「全都有登记」就会空转变绿。
for (const must of ['PICKUP_CODE_ALREADY_USED', 'PICKUP_CODE_INVALID', 'PICKUP_CODE_EXPIRED', 'ORDER_REFUNDED', 'PICKUP_CLAIM_LOCKED', 'CAPABILITY_UNAVAILABLE']) {
  if (!serverCodes.has(must)) fail(`抽取器没从服务端源码抽到 ${must}（抽取器坏了或服务端改名，先查这里）`)
}
const pickupCodeCount = [...serverCodes].filter((c) => c.startsWith('PICKUP_CODE_')).length
if (pickupCodeCount < 3) fail(`只抽到 ${pickupCodeCount} 个 PICKUP_CODE_* 码，抽取器可能坏了`)
else pass(`从服务端认领链路抽到 ${serverCodes.size} 个错误码（其中 PICKUP_CODE_* ${pickupCodeCount} 个）`)

// ── 真跑一体机的映射模块 ─────────────────────────────────────────
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
function transpile(rel, replacements = {}) {
  let out = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: rel,
  }).outputText
  for (const [spec, url] of Object.entries(replacements)) {
    out = out.split(`'${spec}'`).join(`'${url}'`).split(`"${spec}"`).join(`"${url}"`)
  }
  const leftover = [...out.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]).filter((s) => !s.startsWith('data:'))
  assert.deepEqual(leftover, [], `${rel} 还有没替换的运行时依赖：${leftover.join(', ')}`)
  return toDataUrl(out)
}

// ApiHttpError 与 httpAdapter 同形（真实类在 httpAdapter.ts，那个文件还依赖 client 配置，不整个拉进来）。
const httpAdapterStub = toDataUrl(`export class ApiHttpError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; this.name = 'ApiHttpError' }
}`)
{
  const src = read('apps/kiosk/src/services/api/httpAdapter.ts')
  if (!/export class ApiHttpError extends Error[\s\S]{0,200}public readonly code: string[\s\S]{0,80}public readonly status: number/.test(src)) {
    fail('httpAdapter.ts 的 ApiHttpError 形状变了，本门禁里的替身要跟着改')
  }
}
const sharedStub = toDataUrl(`export const LEGACY_PICKUP_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const PICKUP_CODE_LENGTH = 8
export const PICKUP_CODE_MAX_INPUT_LENGTH = 10`)
const userErrorUrl = transpile('apps/kiosk/src/services/api/userErrorMessage.ts', { './httpAdapter': httpAdapterStub })
const cashierUrl = transpile('apps/kiosk/src/pages/print/cashierStatus.ts')
const modelUrl = transpile('apps/kiosk/src/pages/print/pickupClaimModel.ts', {
  '@ai-job-print/shared': sharedStub,
  '../../services/api/httpAdapter': httpAdapterStub,
  './cashierStatus': cashierUrl,
  '../../services/api/userErrorMessage': userErrorUrl,
})
const model = await import(modelUrl)
const { ApiHttpError } = await import(httpAdapterStub)

const table = model.PICKUP_CLAIM_MESSAGES
if (!table || typeof table !== 'object') fail('pickupClaimModel 没有导出 PICKUP_CLAIM_MESSAGES')

const missing = []
for (const code of [...serverCodes].sort()) {
  const registered = Object.prototype.hasOwnProperty.call(table ?? {}, code)
  const said = model.pickupClaimMessage(new ApiHttpError(code, 'server says', 400))
  if (!registered) missing.push(code)
  else if (said !== table[code]) fail(`${code}：pickupClaimMessage 没有返回登记的文案（实际「${said}」）`)
  else if (said === model.PICKUP_CLAIM_FALLBACK_MESSAGE) fail(`${code}：登记的文案等于兜底句`)
}
if (missing.length) fail(`一体机取件页没有登记这些认领失败码：${missing.join(', ')}`)
else pass('服务端认领链路的每个码，一体机都有取件场景的登记文案')

// ── 2. 终态码：分类 closed，文案不引人重输 ──────────────────────────
const CLOSED_REQUIRED = [
  'PICKUP_CODE_ALREADY_USED',
  'PICKUP_CODE_UNAVAILABLE',
  'ORDER_REFUNDED',
  'ORDER_PAYMENT_UNAVAILABLE',
  'PRINT_FILE_EXPIRED',
]
for (const code of CLOSED_REQUIRED) {
  const err = new ApiHttpError(code, 'server says', 400)
  const kind = model.classifyClaimFailure(err)
  const said = model.pickupClaimMessage(err)
  if (kind !== 'closed') fail(`${code}：应分类为 closed（码已是终态），实际 ${kind}`)
  if (/重试|重新输入|再试/.test(said)) fail(`${code}：文案「${said}」叫人重试，但这个码重输不会有别的结果`)
  if (!/手机|工作人员|小程序/.test(said)) fail(`${code}：文案「${said}」没有给出路（回手机或找工作人员）`)
}
if (model.failureScreen('closed') !== 'closed') fail('closed 失败没有映射到独立的 closed 屏')
pass(`终态码 ${CLOSED_REQUIRED.length} 个：分类 closed、文案不含「重试」、给出路`)

// 反向对照：可恢复的码不许被误归到 closed（否则网络抖一下就把人赶回首页）。
for (const [code, status, want] of [
  ['PICKUP_CODE_INVALID', 404, 'invalid'],
  ['PICKUP_CLAIM_LOCKED', 403, 'locked'],
  ['NETWORK_ERROR', 0, 'network'],
  ['PICKUP_CLAIM_RATE_LIMITED', 429, 'other'],
]) {
  const got = model.classifyClaimFailure(new ApiHttpError(code, 'x', status))
  if (got !== want) fail(`${code}：应分类为 ${want}，实际 ${got}`)
}
{
  const said401 = model.pickupClaimMessage(new ApiHttpError('SOMETHING_NEW', 'x', 401))
  if (/登录/.test(said401)) fail(`未登记的 401 落成了「${said401}」—— 取件页没有会员登录`)
}
pass('可恢复的码分类不变；未登记 401 不说「登录」')

// ── 3. 面板与页面接线（AST，跳过注释） ─────────────────────────────
{
  const rel = 'apps/kiosk/src/pages/print/components/PickupHidGuide.tsx'
  const sf = parse(rel)
  let closedBranch = null
  const walk = (n) => {
    if (!closedBranch && ts.isIfStatement(n) && /failure\s*===\s*'closed'/.test(n.expression.getText())) closedBranch = n.thenStatement
    ts.forEachChild(n, walk)
  }
  walk(sf)
  if (!closedBranch) fail(`${rel}：PickupFailurePanel 没有 failure === 'closed' 分支`)
  else {
    const text = closedBranch.getText(sf)
    if (/onRetry/.test(text)) fail('closed 分支引用了 onRetry：终态码不能给「重试」')
    const primary = /<button[^>]*data-testid="arrival-code-primary"[^>]*>/.exec(text)?.[0] ?? ''
    if (!/onClick=\{onHome\}/.test(primary)) fail(`closed 分支的主按钮不是回首页：${primary || '（没有主按钮）'}`)
    if (/重试/.test(text)) fail('closed 分支按钮文字含「重试」')
    if (!/onRetry|重试/.test(text) && /onClick=\{onHome\}/.test(primary)) pass('closed 分支：主按钮回首页，不给重试')
  }
}
{
  const rel = 'apps/kiosk/src/pages/print/PrintPickupClaimPage.tsx'
  const sf = parse(rel)
  const calls = new Set()
  const walk = (n) => {
    if (ts.isCallExpression(n)) calls.add(n.expression.getText(sf))
    ts.forEachChild(n, walk)
  }
  walk(sf)
  for (const fn of ['pickupClaimMessage', 'classifyClaimFailure', 'failureScreen']) {
    if (!calls.has(fn)) fail(`${rel} 没有调用 ${fn}`)
  }
  if (calls.has('userMessageOf')) fail(`${rel} 直接调用 userMessageOf，绕过了取件场景的码表`)
  pass('取件页经 pickupClaimMessage / classifyClaimFailure 出错误文案与屏')
}

if (failures > 0) {
  console.error(`\n❌ verify:pickup-claim-error-coverage  ${failures} 项失败`)
  process.exit(1)
}
console.log('\n✅ verify:pickup-claim-error-coverage 通过')
