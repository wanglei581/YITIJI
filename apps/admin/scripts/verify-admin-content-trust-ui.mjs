/**
 * Admin「内容可信」控件门禁 —— 发布闸门的人工入口必须真的存在、行为与服务端一致。
 *
 * ── 它挡的是哪一类缺陷 ──────────────────────────────────────────────────────
 *
 * 2026-08-17 发布闸门（services/api/src/common/content-trust.ts）上生产：任何内容
 * 要发布，其来源机构必须 contentTrustStatus === 'active' && archivedAt == null。
 * 端点 PATCH /admin/orgs/:id/content-trust 当天就有，AdminOrgsController 也挂着
 * @Roles('admin')。**但 Admin 前端一个控件都没有。**
 *
 * 更糟的是 apps/admin/src/routes/components/BulkPublishButton.tsx 的预览提示写着
 * 「再到『合作机构』把该机构标记为内容可信」—— 它指向的控件当时根本不存在。
 * 运营照着这句话找不到东西，只能连数据库或跑维护脚本，绕过审计留痕。
 *
 * ── 为什么不用字符串匹配 ────────────────────────────────────────────────────
 *
 * 「页面里有『内容可信』四个字」证明不了控件能用，也证明不了它和服务端同一套判据。
 * 本门禁因此：
 *   - 提交守卫：把 apps/admin/src/routes/partners/contentTrustRules.ts 真的**加载起来**，
 *     在 4 状态 × 3 种理由 × 2 种归档 = 24 个用例上求值，与**从服务端源码里抽出来的
 *     两处 throw 守卫条件**逐一比对。锚点是 services/api，不是前端自己那份声明。
 *   - 控件存在：走 TypeScript AST 找 setContentTrust / getContentTrust 的真实调用点，
 *     并要求提交按钮的 disabled 真的绑在守卫结果上（规则存在但 UI 不用 = 白写）。
 *   - 指路文案：要求 BulkPublishButton 引用同源常量 CONTENT_TRUST_UI_PATH_TEXT，
 *     并逐段核对这条路径在导航 / 抽屉 / 小节标题上确实渲染得出来。
 *
 * ── 运行 ────────────────────────────────────────────────────────────────────
 *   pnpm --filter @ai-job-print/admin verify:source-publish-actions
 * （本脚本挂在该 npm script 后半段执行；它需要 node_modules 里的 typescript，
 *   而该 CI step 位于 `pnpm install --frozen-lockfile` 之后，前置成立。
 *   后续如果给它单独开一个 verify:* 名字，必须同时往 ci.yml 加对应行，
 *   否则 verify:ci-gate-coverage 会因「门禁未被任何 CI job 执行」直接转红。）
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(adminRoot, '..', '..')

const RULES = join(adminRoot, 'src/routes/partners/contentTrustRules.ts')
const PANEL = join(adminRoot, 'src/routes/partners/OrgContentTrustPanel.tsx')
const PARTNERS_PAGE = join(adminRoot, 'src/routes/partners/index.tsx')
const BULK_BUTTON = join(adminRoot, 'src/routes/components/BulkPublishButton.tsx')
const NAV = join(adminRoot, 'src/layouts/AdminLayoutWrapper.tsx')
const SERVER_SERVICE = join(repoRoot, 'services/api/src/orgs/admin-org-content-trust.service.ts')
const SERVER_CONTROLLER = join(repoRoot, 'services/api/src/orgs/admin-orgs.controller.ts')

function fail(message) {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

function pass(message) {
  console.log(`  PASS ${message}`)
}

function rel(path) {
  return path.replace(`${repoRoot}/`, '')
}

function readOrFail(path) {
  if (!existsSync(path)) fail(`文件不存在: ${rel(path)}`)
  return readFileSync(path, 'utf8')
}

function sourceFile(path, text) {
  return ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
}

function walk(node, visit) {
  visit(node)
  node.forEachChild((child) => walk(child, visit))
}

function collect(node, predicate) {
  const found = []
  walk(node, (n) => {
    if (predicate(n)) found.push(n)
  })
  return found
}

console.log('\n=== Admin「内容可信」控件验证（发布闸门的人工入口）===')

// ---------------------------------------------------------------------------
// 0. 加载前端规则模块（同时证明它零 import —— 门禁必须能在纯 node 下加载它）
// ---------------------------------------------------------------------------
const rulesText = readOrFail(RULES)
const transpiled = ts.transpileModule(rulesText, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const rulesModule = { exports: {} }
try {
  new Function('exports', 'require', 'module', transpiled)(
    rulesModule.exports,
    (spec) => fail(`${rel(RULES)} 不得 import 任何模块（本门禁要在纯 node 下加载它），实际 import 了 ${spec}`),
    rulesModule,
  )
} catch (error) {
  if (error?.__gateExit) throw error
  fail(`${rel(RULES)} 无法在纯 node 下求值：${error instanceof Error ? error.message : String(error)}`)
}
const rules = rulesModule.exports

for (const name of [
  'ORG_CONTENT_TRUST_STATUSES',
  'CONTENT_TRUST_UI_PATH',
  'CONTENT_TRUST_UI_PATH_TEXT',
  'contentTrustSubmitBlock',
  'contentTrustPublishable',
]) {
  if (rules[name] === undefined) fail(`${rel(RULES)} 未导出 ${name}`)
}
pass(`${rel(RULES)} 可在纯 node 下加载，且导出了 5 个契约符号`)

// ---------------------------------------------------------------------------
// 1. 从**服务端**源码里抽出两处 throw 守卫，作为提交守卫的唯一 oracle
// ---------------------------------------------------------------------------
const serverText = readOrFail(SERVER_SERVICE)
const serverAst = sourceFile(SERVER_SERVICE, serverText)

const setMethod = collect(
  serverAst,
  (n) => ts.isMethodDeclaration(n) && n.name && n.name.getText() === 'setContentTrust',
)[0]
if (!setMethod) fail(`${rel(SERVER_SERVICE)} 里找不到 setContentTrust 方法，本门禁的 oracle 抽取已失配`)

// 服务端先 `const reason = (dto.reason ?? '').trim()`，条件里的 reason 因此是 trim 过的。
// 这一步必须机器确认，否则下面把 trim 过的值喂进条件就是我们自己在替服务端做假设。
const trimsReason = collect(
  setMethod,
  (n) =>
    ts.isVariableDeclaration(n) &&
    n.name.getText() === 'reason' &&
    !!n.initializer &&
    n.initializer.getText().includes('.trim()'),
).length
if (trimsReason !== 1) {
  fail(`${rel(SERVER_SERVICE)} 的 setContentTrust 里没有唯一的 \`const reason = ....trim()\`（实际 ${trimsReason} 处），oracle 抽取已失配`)
}

const CODE_TO_BLOCK = {
  CONTENT_TRUST_REASON_REQUIRED: 'reason_required',
  ORG_ARCHIVED: 'archived',
}

/** 服务端守卫，按源码顺序。[{ block, condition }] */
const serverGuards = []
for (const node of collect(setMethod, (n) => ts.isIfStatement(n))) {
  const body = node.thenStatement.getText()
  for (const [code, block] of Object.entries(CODE_TO_BLOCK)) {
    if (body.includes(`'${code}'`) || body.includes(`"${code}"`)) {
      serverGuards.push({ block, condition: node.expression.getText() })
    }
  }
}

for (const block of Object.values(CODE_TO_BLOCK)) {
  const hits = serverGuards.filter((g) => g.block === block)
  if (hits.length !== 1) {
    fail(`${rel(SERVER_SERVICE)} 的 setContentTrust 里「${block}」守卫抽取到 ${hits.length} 处，预期 1 处 —— 服务端结构已变，请同步本门禁而不是绕开它`)
  }
}
pass(`${rel(SERVER_SERVICE)} 抽出 ${serverGuards.length} 处发布前置守卫作为 oracle：${serverGuards.map((g) => `${g.block}(${g.condition})`).join(' , ')}`)

const serverEvaluators = serverGuards.map(({ block, condition }) => {
  let fn
  try {
    fn = new Function('status', 'reason', 'org', `return Boolean(${condition})`)
  } catch (error) {
    fail(`服务端守卫条件无法求值: ${condition} (${error instanceof Error ? error.message : String(error)})`)
  }
  return { block, condition, fn }
})

/** 服务端 oracle：给定输入，服务端会以哪个 block 拒绝（null = 放行）。 */
function serverBlockFor({ status, reason, archived }) {
  const org = { archivedAt: archived ? new Date('2026-08-01T00:00:00.000Z') : null }
  for (const guard of serverEvaluators) {
    if (guard.fn(status, reason.trim(), org)) return guard.block
  }
  return null
}

// ---------------------------------------------------------------------------
// 2. 前端提交守卫 × 服务端 oracle，全矩阵比对
// ---------------------------------------------------------------------------
const REASONS = ['', '   ', '合作协议 HZ-2026-041']
const ARCHIVED = [false, true]
let cases = 0
for (const status of rules.ORG_CONTENT_TRUST_STATUSES) {
  for (const reason of REASONS) {
    for (const archived of ARCHIVED) {
      const input = { status, reason, archived }
      const actual = rules.contentTrustSubmitBlock(input) ?? null
      const expected = serverBlockFor(input)
      if (actual !== expected) {
        fail(
          `提交守卫与服务端不一致\n` +
            `       用例: status=${status}, reason=${JSON.stringify(reason)}, archived=${archived}\n` +
            `       服务端会: ${expected ?? '放行'}\n` +
            `       前端判为: ${actual ?? '放行'}`,
        )
      }
      cases += 1
    }
  }
}
if (cases !== rules.ORG_CONTENT_TRUST_STATUSES.length * REASONS.length * ARCHIVED.length) {
  fail(`矩阵用例数异常（${cases}），断言可能空转`)
}
// 事故本体的具名回归：空理由标 active 必须被挡；归档机构标 active 必须被挡。
if (rules.contentTrustSubmitBlock({ status: 'active', reason: '   ', archived: false }) !== 'reason_required') {
  fail('空白理由标 active 未被前端挡住 —— 这正是「凭什么信任这个来源」被跳过的形态')
}
if (rules.contentTrustSubmitBlock({ status: 'active', reason: '有依据', archived: true }) !== 'archived') {
  fail('已归档机构标 active 未被前端挡住 —— 运营会以为标了就能发')
}
pass(`提交守卫在 ${cases} 个用例上与服务端 ${rel(SERVER_SERVICE)} 的守卫完全一致（含空理由 / 已归档两条具名回归）`)

// 发布判据（active && 未归档）也要和 services/api/src/common/content-trust.ts 同源
for (const status of [...rules.ORG_CONTENT_TRUST_STATUSES, null, 'unknown']) {
  for (const archived of ARCHIVED) {
    const expected = status === 'active' && !archived
    if (rules.contentTrustPublishable(status, archived) !== expected) {
      fail(`contentTrustPublishable(${String(status)}, ${archived}) 与闸门判据不符（应为 ${expected}）`)
    }
  }
}
pass('contentTrustPublishable 与 content-trust.ts 的「active 且未归档」判据一致（含 null / 未知取值）')

// ---------------------------------------------------------------------------
// 3. 控件真的存在、真的接线
// ---------------------------------------------------------------------------
const panelText = readOrFail(PANEL)
const panelAst = sourceFile(PANEL, panelText)
const pageText = readOrFail(PARTNERS_PAGE)
const pageAst = sourceFile(PARTNERS_PAGE, pageText)

function calledMethods(ast, methodName) {
  return collect(
    ast,
    (n) =>
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.getText() === methodName,
  )
}

if (calledMethods(panelAst, 'setContentTrust').length === 0) {
  fail(`${rel(PANEL)} 没有任何 setContentTrust 调用 —— 运营依然只能连数据库或跑维护脚本来标记内容可信`)
}
if (calledMethods(panelAst, 'getContentTrust').length === 0) {
  fail(`${rel(PANEL)} 没有读取内容信任状态（getContentTrust），状态「能改不能看」等于没有留痕可查`)
}
pass(`${rel(PANEL)} 同时接上 GET / PATCH /admin/orgs/:id/content-trust`)

// 控件必须挂进既有「机构详情」抽屉，而不是漂在某个没人进得去的组件里
if (!collect(pageAst, (n) => ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)).some(
  (n) => n.tagName.getText() === 'OrgContentTrustPanel',
)) {
  fail(`${rel(PARTNERS_PAGE)} 没有渲染 OrgContentTrustPanel —— 控件没有入口就等于不存在`)
}
pass(`${rel(PARTNERS_PAGE)} 在既有机构详情抽屉里渲染了该控件（未新增路由 / 页面）`)

// 提交按钮的 disabled 必须真的绑在守卫结果上：规则存在但按钮不看它 = 白写
const blockBindings = collect(
  panelAst,
  (n) =>
    ts.isVariableDeclaration(n) &&
    !!n.initializer &&
    ts.isCallExpression(n.initializer) &&
    n.initializer.expression.getText() === 'contentTrustSubmitBlock',
).map((n) => n.name.getText())
if (blockBindings.length !== 1) {
  fail(`${rel(PANEL)} 里 contentTrustSubmitBlock 的绑定有 ${blockBindings.length} 处，预期 1 处`)
}
const blockVar = blockBindings[0]

const disabledAttrs = collect(
  panelAst,
  (n) => ts.isJsxAttribute(n) && n.name.getText() === 'disabled',
).map((n) => (n.initializer ? n.initializer.getText() : ''))
if (!disabledAttrs.some((text) => text.includes(blockVar))) {
  fail(
    `${rel(PANEL)} 的提交按钮 disabled 没有引用守卫结果 \`${blockVar}\`；` +
      `实际的 disabled 表达式：${disabledAttrs.join(' | ') || '（一个都没有）'}`,
  )
}
// 而且提交动作本身也要 early-return，不能只靠按钮禁用（键盘/程序化触发绕过）
const submitGuarded = collect(
  panelAst,
  (n) => ts.isIfStatement(n) && n.expression.getText().includes(blockVar) && n.thenStatement.getText().includes('return'),
).length
if (submitGuarded === 0) {
  fail(`${rel(PANEL)} 的提交函数没有对 \`${blockVar}\` 做 early return —— 只禁用按钮挡不住程序化触发`)
}
pass(`${rel(PANEL)} 提交按钮 disabled 与提交函数 early-return 都绑在守卫结果 \`${blockVar}\` 上`)

// ---------------------------------------------------------------------------
// 4. 归档态必须在 UI 上可区分（判据是两条，只显示 active 会误导）
// ---------------------------------------------------------------------------
for (const [label, ast, path] of [
  ['详情面板', panelAst, PANEL],
  ['机构列表', pageAst, PARTNERS_PAGE],
]) {
  const usesArchived = collect(ast, (n) => ts.isIdentifier(n) && n.text === 'archived').length > 0
  const usesPublishable = collect(
    ast,
    (n) => ts.isCallExpression(n) && n.expression.getText() === 'contentTrustPublishable',
  ).length
  if (!usesArchived) fail(`${label}（${rel(path)}）没有引用 archived，归档机构会被显示成「标了就能发」`)
  if (usesPublishable === 0) {
    fail(`${label}（${rel(path)}）没有用 contentTrustPublishable 表达「现在到底发不发得出去」`)
  }
}
pass('详情面板与机构列表都按「active 且未归档」两条判据表达可发布性，归档态单独可见')

// ---------------------------------------------------------------------------
// 5. 权限口径：服务端 @Roles('admin')，前端按同一口径显示/隐藏
// ---------------------------------------------------------------------------
const controllerText = readOrFail(SERVER_CONTROLLER)
const controllerAst = sourceFile(SERVER_CONTROLLER, controllerText)
const controllerClass = collect(
  controllerAst,
  (n) =>
    ts.isClassDeclaration(n) &&
    n.members.some((m) => ts.isMethodDeclaration(m) && m.name?.getText() === 'setContentTrust'),
)[0]
if (!controllerClass) fail(`${rel(SERVER_CONTROLLER)} 里找不到声明 setContentTrust 的 controller 类`)

const classDecorators = (ts.getDecorators(controllerClass) ?? []).map((d) => d.getText())
const rolesDecorator = classDecorators.find((text) => text.startsWith('@Roles('))
if (!rolesDecorator || !/@Roles\(\s*'admin'\s*\)/.test(rolesDecorator)) {
  fail(
    `${rel(SERVER_CONTROLLER)} 的 content-trust controller 不再是 @Roles('admin')（实际装饰器：${classDecorators.join(' ') || '无'}）。` +
      `前端的显示口径以它为准，服务端改了就必须同步前端，而不是让前端继续按旧口径显示。`,
  )
}
pass(`${rel(SERVER_CONTROLLER)} 的 content-trust 端点限定 @Roles('admin')`)

const canEditBindings = collect(
  panelAst,
  (n) =>
    ts.isVariableDeclaration(n) &&
    !!n.initializer &&
    n.initializer.getText().includes('getUser()') &&
    n.initializer.getText().includes("'admin'"),
).map((n) => n.name.getText())
if (canEditBindings.length !== 1) {
  fail(`${rel(PANEL)} 没有唯一一处「当前账号是不是 admin」的判定（实际 ${canEditBindings.length} 处），无法与服务端口径对齐`)
}
const canEditVar = canEditBindings[0]
const gatesOnRole = collect(
  panelAst,
  (n) => ts.isJsxExpression(n) && !!n.expression && n.expression.getText().includes(canEditVar),
).length
if (gatesOnRole === 0) {
  fail(`${rel(PANEL)} 判定了 \`${canEditVar}\` 却没有用它控制渲染 —— 非管理员会看到一个点下去必然 403 的按钮`)
}
pass(`${rel(PANEL)} 按 \`${canEditVar}\`（getUser().role === 'admin'）控制变更控件的显示，与服务端口径一致`)

// ---------------------------------------------------------------------------
// 6. 指路文案必须引用同源常量，且路径每一段都真的渲染得出来
// ---------------------------------------------------------------------------
const bulkText = readOrFail(BULK_BUTTON)
const bulkAst = sourceFile(BULK_BUTTON, bulkText)

const importsPathConst = collect(bulkAst, (n) => ts.isImportDeclaration(n)).some((n) => {
  const spec = n.moduleSpecifier.getText()
  return spec.includes('contentTrustRules') && n.getText().includes('CONTENT_TRUST_UI_PATH')
})
if (!importsPathConst) {
  fail(
    `${rel(BULK_BUTTON)} 没有从 contentTrustRules 引入 CONTENT_TRUST_UI_PATH* —— ` +
      `指路文案又变回手写，可以再一次指向不存在的控件（2026-08-17 就是这么发生的）`,
  )
}
const trustHintUsesConst = collect(
  bulkAst,
  (n) => ts.isJsxExpression(n) && !!n.expression && n.expression.getText().includes('CONTENT_TRUST_UI_PATH'),
).length
if (trustHintUsesConst === 0) {
  fail(`${rel(BULK_BUTTON)} 引入了路径常量却没有渲染它，提示里的位置仍然是手写的`)
}
pass(`${rel(BULK_BUTTON)} 的 orgTrustInactive 提示引用同源常量 CONTENT_TRUST_UI_PATH_TEXT`)

const [navSegment, drawerSegment, sectionSegment] = rules.CONTENT_TRUST_UI_PATH
const navText = readOrFail(NAV)
if (!navText.includes(navSegment)) {
  fail(`指路第 1 段「${navSegment}」在 ${rel(NAV)} 的导航里不存在`)
}
if (!pageText.includes(drawerSegment)) {
  fail(`指路第 2 段「${drawerSegment}」在 ${rel(PARTNERS_PAGE)} 里不存在`)
}
// 第 3 段是控件小节标题，必须由常量派生而不是另手写一份，否则两边会各自漂移
const derivesSectionTitle = collect(
  panelAst,
  (n) => ts.isElementAccessExpression(n) && n.expression.getText() === 'CONTENT_TRUST_UI_PATH',
).length
if (derivesSectionTitle === 0) {
  fail(`${rel(PANEL)} 的小节标题没有从 CONTENT_TRUST_UI_PATH 派生，指路文案与真实标题会各自漂移`)
}
if (rules.CONTENT_TRUST_UI_PATH_TEXT.split(' → ').length !== 3) {
  fail(`CONTENT_TRUST_UI_PATH_TEXT 不是三段路径：${rules.CONTENT_TRUST_UI_PATH_TEXT}`)
}
pass(`指路路径「${rules.CONTENT_TRUST_UI_PATH_TEXT}」三段逐一核对：导航 / 抽屉 / 小节标题都真的渲染得出来（第 3 段 "${sectionSegment}" 由常量派生）`)

console.log('\nALL PASS')
