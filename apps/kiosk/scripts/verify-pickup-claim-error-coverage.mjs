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
import { readFileSync, readdirSync } from 'node:fs'
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
  'services/api/src/terminals/printer-availability.ts',
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
for (const must of ['PICKUP_CODE_ALREADY_USED', 'PICKUP_CODE_INVALID', 'PICKUP_CODE_EXPIRED', 'ORDER_REFUNDED', 'PICKUP_CLAIM_LOCKED', 'CAPABILITY_UNAVAILABLE', 'PRINTER_UNAVAILABLE', 'PRINT_TERMINAL_QUEUE_HALTED']) {
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
// userErrorMessage 现在从 copy/unattendedCopy 取无人值守标准句（该文件自身无依赖），原样转译后接上，不另抄。
const userErrorUrl = transpile('apps/kiosk/src/services/api/userErrorMessage.ts', {
  './httpAdapter': httpAdapterStub,
  '../../copy/unattendedCopy': transpile('apps/kiosk/src/copy/unattendedCopy.ts'),
})
const cashierUrl = transpile('apps/kiosk/src/pages/print/cashierStatus.ts')
const unattendedUrl = transpile('apps/kiosk/src/copy/unattendedCopy.ts')
const miniappUrl = transpile('apps/kiosk/src/copy/miniappLinkCopy.ts', {
  './unattendedCopy': unattendedUrl,
})
const modelUrl = transpile('apps/kiosk/src/pages/print/pickupClaimModel.ts', {
  '@ai-job-print/shared': sharedStub,
  '../../copy/unattendedCopy': unattendedUrl,
  '../../copy/miniappLinkCopy': miniappUrl,
  '../../services/api/httpAdapter': httpAdapterStub,
  './cashierStatus': cashierUrl,
  '../../services/api/userErrorMessage': userErrorUrl,
})
const model = await import(modelUrl)
const userMessages = await import(userErrorUrl)
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

// 订单不可用、已退款、不能付款：开关关着不点名小程序，开着保持原句。不传联系方式等于关着。
{
  const published = { servicePhone: null, serviceHours: null, otherOnlineTerminalNearby: false, miniappPublished: true }
  const unpublished = { ...published, miniappPublished: false }
  const switched = [
    ['PICKUP_CODE_UNAVAILABLE',
      '这个到机码已经不能使用。请在手机上「我的 → 打印订单」查看这笔订单，需要的话重新下单',
      '这个到机码已经不能使用。请在手机小程序「我的 → 打印订单」查看这笔订单，需要的话重新下单'],
    ['ORDER_REFUNDED',
      '本单已退款，不再出纸。款项按原路退回，可在手机上「我的 → 打印订单」查看退款进度',
      '本单已退款，不再出纸。款项按原路退回，可在小程序「我的 → 打印订单」查看退款进度'],
    ['ORDER_PAYMENT_UNAVAILABLE',
      '这笔订单已经不能付款（可能已关闭）。请在手机上「我的 → 打印订单」查看，需要的话重新下单',
      '这笔订单已经不能付款（可能已关闭）。请在手机小程序「我的 → 打印订单」查看，需要的话重新下单'],
  ]
  for (const [code, off, on] of switched) {
    const err = new ApiHttpError(code, 'server says', 400)
    const omitted = model.pickupClaimMessage(err)
    const closed = model.pickupClaimMessage(err, null)
    const offSaid = model.pickupClaimMessage(err, unpublished)
    const onSaid = model.pickupClaimMessage(err, published)
    if (omitted !== off || closed !== off || offSaid !== off) fail(`${code} 开关关着仍点名小程序或丢了原句：${offSaid}`)
    else if (/小程序/.test(offSaid)) fail(`${code} 开关关着的句子含「小程序」：${offSaid}`)
    else if (onSaid !== on) fail(`${code} 开关开着不是原句：${onSaid}`)
    else if (!/小程序/.test(onSaid)) fail(`${code} 开关开着应点名小程序：${onSaid}`)
    else if (table[code] !== off) fail(`${code} 码表默认句应是开关关着的那句`)
    else pass(`${code}：开关关着只说在手机上，开着保持原句`)
  }
  const claimPage = read('apps/kiosk/src/pages/print/PrintPickupClaimPage.tsx')
  if (!/pickupClaimMessage\(err,\s*supportContact\)/.test(claimPage)) fail('取件页没有把发布开关交给失败文案')
  else pass('取件页失败文案读取当次的小程序发布开关')
}

// 打印机拒绝不是输错码或终态；原话合格时原样显示，不合格才用取件场景固定句。
for (const code of ['PRINT_TERMINAL_QUEUE_HALTED', 'PRINTER_UNAVAILABLE']) {
  assert.equal(model.classifyClaimFailure(new ApiHttpError(code, 'x', 400)), 'printer')
  assert.match(table[code], /到机码没有作废/)
  assert.doesNotMatch(table[code], /换一台/)
}
const clean = '这台终端暂停接打印单，你的到机码没有作废，请稍后再来这台终端输码'
assert.equal(model.pickupClaimMessage(new ApiHttpError('PRINT_TERMINAL_QUEUE_HALTED', clean, 400)), clean)
const staffOriginal = '这台终端暂停接打印单，你的到机码没有作废，请稍后再来这台终端输码，或找现场工作人员'
assert.equal(model.pickupClaimMessage(new ApiHttpError('PRINT_TERMINAL_QUEUE_HALTED', staffOriginal, 400)), table.PRINT_TERMINAL_QUEUE_HALTED)
for (const bad of ['queue_cleanup_failed', 'HTTP 400 错误', '请求失败（400）', '故障'.repeat(40), '']) {
  assert.equal(model.pickupClaimMessage(new ApiHttpError('PRINT_TERMINAL_QUEUE_HALTED', bad, 400)), table.PRINT_TERMINAL_QUEUE_HALTED)
}
pass('打印机拒绝保持可恢复分类；合格原话透传、不合格回退取件原话')

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
  // 10/4 起现场无人值守：问小青、按《隐私政策》联系方式求助也是出路（「工作人员」留着，等全量替换线收掉）。
  if (!/手机|工作人员|小程序|小青|联系方式/.test(said)) fail(`${code}：文案「${said}」没有给出路（回手机、问小青或联系方式）`)
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

// W-45：出纸后再输到机码，服务端回 completed 时不能再说「留在出纸口旁」。
{
  const done = model.claimSuccessCopy(true, 'completed')
  const queued = model.claimSuccessCopy(true, 'pending')
  const printing = model.claimSuccessCopy(true, 'printing')
  const unpaid = model.claimSuccessCopy(false, 'completed')
  if (!done.line.includes('这一单已经打印完成') || !done.title.includes('这一单已经打印完成')) {
    fail(`completed 没有如实说已经打印完成：${done.title} / ${done.line}`)
  } else if (/出纸口旁|进入队列|去付款/.test(`${done.title}${done.line}${done.cta}`)) {
    fail('completed 仍在叫人留在出纸口或去付款')
  } else {
    pass('completed：这一单已经打印完成，并给出路')
  }
  if (!/打印任务已进入队列/.test(queued.line) || queued.cta !== '查看打印进度') {
    fail('还在队列时必须仍说进入队列、去看进度')
  } else pass('pending：仍请留在出纸口旁看进度')
  if (!/正在出纸/.test(printing.line)) fail('printing 没有说正在出纸')
  else pass('printing：正在出纸')
  if (unpaid.cta !== '进入现场支付') fail('未付款不能因为状态字段跳过收银台')
  else pass('未放行仍去现场支付')
  if (model.claimSuccessDestination({ released: true, printTaskStatus: 'completed', taskId: 'ptask_1' }) !== '/print/done') {
    fail('completed 且有任务时应去打印结果页')
  } else if (model.claimSuccessDestination({ released: true, printTaskStatus: 'completed' }) !== '/me/print-orders') {
    fail('completed 但没有任务号时应去我的打印订单')
  } else if (model.claimSuccessDestination({ released: true, printTaskStatus: 'pending', taskId: 'ptask_1' }) !== '/print/progress') {
    fail('还在队列时应去打印进度')
  } else if (model.claimSuccessDestination({ released: false, printTaskStatus: 'completed', taskId: 'ptask_1' }) !== '/print/cashier') {
    fail('未付款应去收银台')
  } else pass('认领成功的去向按真实状态分流')
  const page = read('apps/kiosk/src/pages/print/PrintPickupClaimPage.tsx')
  if (!/claimSuccessCopy\(result\.released,\s*result\.printTaskStatus\)/.test(page)) {
    fail('取件页没有把 printTaskStatus 交给文案')
  } else if (!/claimSuccessDestination\(result\)/.test(page)) {
    fail('取件页没有按真实状态选择去向')
  } else pass('取件页使用 printTaskStatus 分流')
}

// W-117：执行真实显示表达式，失败码仅能用于内存重试，不能出现在公共屏幕码格。
{
  const page = read('apps/kiosk/src/pages/print/PrintPickupClaimPage.tsx')
  const expression = /const display = ([^\n]+)/.exec(page)?.[1]
  if (!expression) fail('到机码页缺少码格显示表达式')
  else {
    const display = new Function('state', 'failure', 'code', `return (${expression})`)
    for (const value of ['28491703', 'AB23456789']) {
      if (display('error', { code: value }, value) !== '') fail('失败屏泄露刚提交的到机码')
      else pass(`失败屏不显示 ${value.length} 位到机码`)
      if (display('idle', null, value) !== value) fail('正常输入态不能隐藏本人当前输入')
    }
  }
  if (!/handleClaim\(failure\.code\)/.test(page)) fail('重试必须仍使用内存原码')
}

// 方案②：三个续打错误码的句子与分类。
// 次数用尽要给回手机重新下单的下一步；出纸未确认说清过 5 分钟后再输同一个码，符合条件时才整份重打，按可恢复处理。
// 已经出过一部分纸的旧句仍归 closed，不放进 CLOSED_REQUIRED（那一句没有手机 / 小程序出路）。
{
  const limit = '这单已经接着打过 2 次，不能再打了。还要打，请在手机上重新下单'
  const unconfirmed = '这单的出纸结果还没确认。请过 5 分钟后回到这台机器，再输一次同一个到机码，按屏幕提示办理；符合条件时可以整份重打。'
  const partial = '这单已经出了一部分纸，不能整单重打'
  const already = '这个到机码已经用过，这单已经交给打印机，不能再次取件。要再打一份，请重新下单；没拿到纸，可以问小青，或查看《隐私政策》里的联系方式。'
  const resume = '没打完？回到出纸失败的那台机器上，再输一次同一个到机码就能接着打，每单最多 2 次。'
  for (const [code, sentence, kind] of [
    ['PICKUP_RESUME_LIMIT_REACHED', limit, 'closed'],
    ['PICKUP_RESUME_UNCONFIRMED', unconfirmed, 'other'],
    ['PICKUP_RESUME_PARTIAL_OUTPUT', partial, 'closed'],
  ]) {
    const err = new ApiHttpError(code, 'server says', 409)
    if (model.pickupClaimMessage(err) !== sentence) fail(`${code} 取件文案不对：${model.pickupClaimMessage(err)}`)
    else if (model.classifyClaimFailure(err) !== kind) fail(`${code} 应分类为 ${kind}，实际 ${model.classifyClaimFailure(err)}`)
    else pass(`${code}：${kind}，取件文案是屏上该说的那句`)
  }
  if (table.PICKUP_CODE_ALREADY_USED !== already) fail('PICKUP_CODE_ALREADY_USED 没有改成不找人的说法')
  else pass('PICKUP_CODE_ALREADY_USED：出路是重新下单或问小青，不找现场工作人员、不叫原地重输')
  if (model.PICKUP_SAME_CODE_RESUME_NOTE !== resume) fail('到机码页续打说明丢了或改了次数以外的承诺')
  else pass('到机码页续打说明只承诺每单最多 2 次')
  const panel = read('apps/kiosk/src/pages/profile/me/printOrders/PickupCodePanel.tsx')
  if (!panel.includes('还要打，请在手机上重新下单')) fail('订单面板次数用尽没有给出回手机重新下单的下一步')
  else pass('次数用尽：认领页和订单面板都告诉人回手机重新下单')
}

// 付费异常待退回、文件失效、程序太旧、当天额度、过期码。抽取器看不到这几个码（不在 new Exception 字面量里），这里逐个钉死。
{
  const refund = '这单没有打完，退款待处理，输码时不会当场退款。请不要再输这个到机码；需要帮助请查看《隐私政策》里的联系方式。'
  const refundErr = new ApiHttpError('PICKUP_RESUME_REFUND_PENDING', 'server says', 409)
  if (!Object.prototype.hasOwnProperty.call(table, 'PICKUP_RESUME_REFUND_PENDING')) fail('取件码表没有登记 PICKUP_RESUME_REFUND_PENDING')
  else if (!userMessages.SHARED_USER_MESSAGE_CODES.includes('PICKUP_RESUME_REFUND_PENDING')) fail('共享码表没有登记 PICKUP_RESUME_REFUND_PENDING')
  else if (model.pickupClaimMessage(refundErr) !== refund) fail(`退款待处理的取件文案不是登记句：${model.pickupClaimMessage(refundErr)}`)
  else if (userMessages.userMessageOf(refundErr, '兜底') !== refund) fail('共享码表的退款待处理文案和取件码表不一致')
  else if (model.classifyClaimFailure(refundErr) !== 'closed') fail('退款待处理应分类为 closed，避免叫人再输这个码')
  else if (model.pickupClaimMessage(refundErr) === model.PICKUP_CLAIM_FALLBACK_MESSAGE) fail('退款待处理落到了「请重试」兜底')
  else if (/已退款/.test(refund)) fail('退款待处理写成了「已退款」')
  else if (/重试|重新输入|再试/.test(refund)) fail('退款待处理仍叫人重试')
  else pass('PICKUP_RESUME_REFUND_PENDING：两张码表同一句，closed，不写已退款')

  const fileSentence = '这笔订单的文件现在无法用于打印。请在手机上重新上传文件、重新下单。'
  const agentSentence = '这台机器暂时不能用同一个到机码接着打。还要打，请在手机上重新下单。'
  for (const [code, sentence] of [
    ['PRINT_RETRY_FILE_UNAVAILABLE', fileSentence],
    ['PRINT_RETRY_AGENT_VERSION', agentSentence],
  ]) {
    const err = new ApiHttpError(code, 'server says', 409)
    const said = model.pickupClaimMessage(err)
    if (!Object.prototype.hasOwnProperty.call(table, code)) fail(`${code} 没有登记，会落到请重试`)
    else if (said !== sentence) fail(`${code} 文案不是定稿：${said}`)
    else if (model.classifyClaimFailure(err) !== 'closed') fail(`${code} 应分类为 closed`)
    else if (/0\.4\.13|免费|请重试|版本|升级/.test(said)) fail(`${code} 把后端维护句带上了屏：${said}`)
    else pass(`${code}：closed，给出回手机的下一步，不写版本号`)
  }

  const rejected = userMessages.PICKUP_CODE_REJECTED_COPY
  const onlyRecheck = '到机码无效或已过期，请核对后重新输入'
  for (const code of ['PICKUP_CODE_INVALID', 'PICKUP_CODE_EXPIRED', 'PICKUP_TERMINAL_MISMATCH']) {
    const err = new ApiHttpError(code, '到机码已过期，请在小程序重新下单', 404)
    const said = model.pickupClaimMessage(err)
    if (said !== rejected) fail(`${code} 被本地码表盖成了别的句子：${said}`)
    else if (said === onlyRecheck || said === `${onlyRecheck}。`) fail(`${code} 只剩「请核对后重新输入」，没有下一步`)
    else if (!/请在手机上查看这笔订单/.test(said) || !/重新下单/.test(said)) fail(`${code} 没有回手机查看或重新下单`)
    else if (model.classifyClaimFailure(err) !== 'invalid') fail(`${code} 应与无效码同一屏，实际 ${model.classifyClaimFailure(err)}`)
    else pass(`${code}：同一句防试探，并给出回手机的下一步`)
  }
  if (userMessages.userMessageOf(new ApiHttpError('PICKUP_CODE_EXPIRED', '到机码已过期，请在小程序重新下单', 404), '兜底') !== rejected) {
    fail('共享码表的过期句和取件码表不一致')
  } else pass('过期码：共享码表与取件码表同一句，不再被短句盖住')

  const otherTerminalSentence = '这单是在别的机器上下的，请到下单时选的那台机器取件'
  const otherErr = new ApiHttpError('PICKUP_CODE_OTHER_TERMINAL', 'server says', 404)
  const otherSaid = model.pickupClaimMessage(otherErr)
  if (otherSaid !== otherTerminalSentence) fail(`走错机器的取件文案不是定稿：${otherSaid}`)
  else if (model.classifyClaimFailure(otherErr) !== 'other') fail(`走错机器应归 other，实际 ${model.classifyClaimFailure(otherErr)}`)
  else if (userMessages.userMessageOf(otherErr, '兜底') !== otherTerminalSentence) fail('共享码表的走错机器文案和取件码表不一致')
  else if (otherSaid === rejected) fail('走错机器被并进了「到机码无效」那句')
  else pass('PICKUP_CODE_OTHER_TERMINAL：单独一句，归 other，不和无效码同一屏')

  // 当天额度沿用批次上的共享短句：不进到机码表，认领页与确认页同一句，次要按钮是「输另一个到机码」。
  for (const [code, expected] of [
    ['PRINT_TERMINAL_DAILY_QUOTA_REACHED', '这台机器今天的免费打印量已用完，明天 0 点恢复'],
    ['PRINT_MEMBER_DAILY_QUOTA_REACHED', '你今天的免费打印量已达上限，明天 0 点恢复'],
  ]) {
    const err = new ApiHttpError(code, 'server says', 429)
    const said = model.pickupClaimMessage(err)
    const shared = userMessages.userMessageOf(err, '兜底')
    if (Object.prototype.hasOwnProperty.call(table, code)) fail(`${code} 不该登记进到机码表，原话在共享码表`)
    else if (model.classifyClaimFailure(err) !== 'other') fail(`${code} 应分类为 other，实际 ${model.classifyClaimFailure(err)}`)
    else if (said !== shared) fail(`${code} 认领页没有沿用共享短句：${said}`)
    else if (!said.includes(expected)) fail(`${code} 共享短句不是批次原话：${said}`)
    else if (!said.includes('免费')) fail(`${code} 丢掉了「免费」：${said}`)
    else if (!said.includes('需要帮助？')) fail(`${code} 共享短句丢了求助句`)
    else pass(`${code}：不进到机码表，认领页与确认页同一句共享短句`)
  }
  const memberLimited = userMessages.userMessageOf({ code: 'PRINT_MEMBER_DAILY_QUOTA_REACHED', details: { limit: 50 } }, '兜底')
  if (!memberLimited.includes('你今天已免费打印 50 面')) fail(`会员当天额度带面数时不是批次原话：${memberLimited}`)
  else pass('会员当天额度：有面数时写出免费打印了多少面')
}
{
  const rel = 'apps/kiosk/src/pages/print/components/PickupHidGuide.tsx'
  const sf = parse(rel)
  let quotaBranch = null
  const walk = (n) => {
    if (!quotaBranch && ts.isIfStatement(n) && /quotaExit === 'login' \|\| quotaExit === 'wait'/.test(n.expression.getText())) quotaBranch = n.thenStatement
    ts.forEachChild(n, walk)
  }
  walk(sf)
  if (!quotaBranch) fail(`${rel}：额度被拒没有单独的按钮分支`)
  else {
    const text = quotaBranch.getText(sf)
    if (!text.includes('输另一个到机码')) fail('当天额度用完的次要按钮不是「输另一个到机码」')
    else if (/求助/.test(text)) fail('当天额度用完的次要按钮被改成了「求助」')
    else if (!/onReset/.test(text)) fail('次要按钮没有接到重新输入')
    else pass('当天额度用完：主按钮回首页，次要按钮是输另一个到机码')
  }
}

// 方案②口径：一体机源码的字符串字面量与 JSX 文本不得再出现旧说法。
// 扫的是 apps/kiosk/src，不扫注释、测试和门禁脚本（否定断言要保留这几个词）。
// 阳性对照：扫不到「两种码，别搞混」或续打说明，说明遍历坏了，不能算通过。
{
  const banned = ['取件凭证码', '出示给工作人员', '出示给现场工作人员']
  const hits = []
  let sawTwoCodes = false
  let sawResumeNote = false
  const resumeNote = '没打完？回到出纸失败的那台机器上，再输一次同一个到机码就能接着打，每单最多 2 次。'
  const textsOf = (sf) => {
    const texts = []
    const visit = (node) => {
      if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) {
        texts.push(node.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
    return texts
  }
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, ent.name)
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === 'dist') continue
        walk(abs)
        continue
      }
      if (!/\.tsx?$/.test(ent.name) || ent.name.endsWith('.d.ts')) continue
      const sf = ts.createSourceFile(abs, readFileSync(abs, 'utf8'), ts.ScriptTarget.ES2022, true, ent.name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      for (const text of textsOf(sf)) {
        if (text.includes('两种码，别搞混')) sawTwoCodes = true
        if (text.includes(resumeNote)) sawResumeNote = true
        for (const phrase of banned) {
          if (text.includes(phrase)) hits.push(`${abs.slice(kioskRoot.length + 1)} 含「${phrase}」`)
        }
      }
    }
  }
  walk(join(kioskRoot, 'src'))
  if (!sawTwoCodes || !sawResumeNote) fail('口径扫描没有扫到「两种码，别搞混」或续打说明（遍历坏了，不能算通过）')
  else if (hits.length) fail(`一体机源码仍有旧说法：${hits.slice(0, 8).join('；')}`)
  else pass('一体机源码的字符串与 JSX 文本不再出现取件凭证码或出示给工作人员')
}

if (failures > 0) {
  console.error(`\n❌ verify:pickup-claim-error-coverage  ${failures} 项失败`)
  process.exit(1)
}
console.log('\n✅ verify:pickup-claim-error-coverage 通过')
