/**
 * Admin「线下招聘机构」页门禁 —— 资质核验链路必须真的闭合，五态必须真的可分辨。
 *
 * ── 它挡的是哪一类缺陷 ──────────────────────────────────────────────────────
 *
 * 2026-09-02 给本页接上了资质核验（GovernanceDrawer + 8 条 recruitment-content
 * 只读端点），ReviewDialog 也加了「审核前先核资质」的指引。**但这条链路对新建机构
 * 是完全空转的**：AgencyForm 没有「来源机构」字段，OfflineAgencyInput 没有
 * sourceOrgId，于是本页新建的每一条机构 sourceOrgId 恒为 null，资质抽屉永远停在
 * 第五态「本机构没有来源机构，因此不存在可核验的资质档案」。
 * 后端 create-offline-agency.dto.ts / offline-agencies.service.ts 一直支持这一列 ——
 * 断的是前端这一截。能走到真实核验的只剩历史遗留行。
 *
 * 这类缺陷的共同特征是：**每个部件单独看都正常，只有把链路首尾接起来看才发现空转**。
 * 页面截图不会红，typecheck 不会红，lint 不会红。所以要有门禁。
 *
 * 另一类要挡的是「把没拿到说成没有」：抽屉里五种状态里有三种长得像「空」——
 * 没有来源机构 / 机构没有资质 / 接口失败。把接口失败渲染成「无资质」，会让管理员
 * 在数据根本没读到的情况下按「资质缺失」下审核结论。
 *
 * ── 为什么不用字符串匹配 ────────────────────────────────────────────────────
 *
 * 「文件里有『来源机构』四个字」证明不了字段被提交，也证明不了失败态和空态分得开。
 * 本门禁因此：
 *   - 后端做 oracle：从 services/api 源码里 AST 抽出 sourceOrgId 的 DTO 声明、
 *     adminCreate / adminUpdate 的写入、以及 adminPublish 闸门的真实条件。
 *     后端哪天不再支持这一列，本门禁红 —— 而不是让前端继续送一个被丢弃的字段。
 *   - 状态可分辨做成结构断言：把 ConfirmedEmpty / LoadFailed 的**渲染守卫表达式**
 *     取出来比对，要求「LoadFailed 的守卫必含 error」「ConfirmedEmpty 的守卫必不含
 *     error」。把失败态改渲染成空态，守卫文本立刻穿帮。
 *   - 取证路径做成禁令：整个页面目录里不允许出现拼 /files/ 的字符串，
 *     evidence-access 不允许出现在 useEffect 里（预取会给没真看过的材料留审计），
 *     且开窗必须发生在请求之前（窗口开不出来就不发请求 = 不留假审计）。
 *
 * ── 运行 ────────────────────────────────────────────────────────────────────
 *   pnpm --filter @ai-job-print/admin verify:admin-offline-agencies-ui
 *
 * 该 npm script 同时被 verify:source-publish-actions 串起来执行（与
 * verify-admin-content-trust-ui.mjs 同样的挂法），因此 ci.yml 无需新增行、
 * verify:ci-gate-coverage 的执行闭包也能覆盖到它。两者主题相邻：本页的发布闸门
 * 走的正是 assertOrgContentTrustActive。若将来给它在 ci.yml 单开一行，
 * 记得从 verify:source-publish-actions 里摘掉，避免同一批断言跑两遍。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(adminRoot, '..', '..')

const PAGE_DIR = join(adminRoot, 'src/routes/offline-agencies')
const FORM = join(PAGE_DIR, 'AgencyForm.tsx')
const DRAWER = join(PAGE_DIR, 'GovernanceDrawer.tsx')
const REVIEW = join(PAGE_DIR, 'ReviewDialog.tsx')
const INDEX = join(PAGE_DIR, 'index.tsx')
const SERVICE = join(adminRoot, 'src/services/api/offlineAgenciesAdmin.ts')
const GOV_SERVICE = join(adminRoot, 'src/services/api/offlineAgencyGovernance.ts')
const SERVER_DTO = join(repoRoot, 'services/api/src/offline-agencies/dto/create-offline-agency.dto.ts')
const SERVER_SERVICE = join(repoRoot, 'services/api/src/offline-agencies/offline-agencies.service.ts')

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

const jsxName = (n) => n.tagName.getText()
const isJsxEl = (n) => ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)
const jsxNamed = (ast, name) => collect(ast, (n) => isJsxEl(n) && jsxName(n) === name)

/** 找某个节点被**渲染出来的条件表达式**（最近的 `&&` 左operand / 三元条件）。 */
function guardOf(node) {
  let cur = node
  while (cur.parent) {
    const p = cur.parent
    if (
      ts.isBinaryExpression(p) &&
      p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      p.right === cur
    ) {
      return p.left.getText()
    }
    if (ts.isConditionalExpression(p)) {
      if (p.whenTrue === cur) return p.condition.getText()
      if (p.whenFalse === cur) return `!( ${p.condition.getText()} )`
    }
    cur = p
  }
  return null
}

/** 元素所在的 JSX 元素（自闭合取自身，开标签取其 JsxElement 父节点）的守卫。 */
function guardOfElement(el) {
  return guardOf(ts.isJsxOpeningElement(el) ? el.parent : el)
}

/** 找命名函数 / 箭头常量的声明体。 */
function findFunction(ast, name) {
  const fn = collect(
    ast,
    (n) =>
      (ts.isFunctionDeclaration(n) && n.name?.getText() === name) ||
      (ts.isVariableDeclaration(n) &&
        n.name.getText() === name &&
        !!n.initializer &&
        (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))),
  )[0]
  return fn ?? null
}

function callsMethod(ast, methodName) {
  return collect(
    ast,
    (n) =>
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.getText() === methodName,
  )
}

console.log('\n=== Admin「线下招聘机构」页验证（资质核验链路 / 状态可分辨 / 取证留痕）===')

const formText = readOrFail(FORM)
const formAst = sourceFile(FORM, formText)
const drawerText = readOrFail(DRAWER)
const drawerAst = sourceFile(DRAWER, drawerText)
const serviceText = readOrFail(SERVICE)
const serviceAst = sourceFile(SERVICE, serviceText)
readOrFail(REVIEW)
readOrFail(INDEX)
readOrFail(GOV_SERVICE)

// ---------------------------------------------------------------------------
// 1. 后端 oracle：sourceOrgId 真的可写、闸门真的以它为条件
// ---------------------------------------------------------------------------
const dtoText = readOrFail(SERVER_DTO)
const dtoAst = sourceFile(SERVER_DTO, dtoText)

const createDto = collect(
  dtoAst,
  (n) => ts.isClassDeclaration(n) && n.name?.getText() === 'CreateOfflineAgencyDto',
)[0]
if (!createDto) fail(`${rel(SERVER_DTO)} 里找不到 CreateOfflineAgencyDto`)

const dtoSourceOrgId = createDto.members.find(
  (m) => ts.isPropertyDeclaration(m) && m.name?.getText() === 'sourceOrgId',
)
if (!dtoSourceOrgId) {
  fail(
    `${rel(SERVER_DTO)} 的 CreateOfflineAgencyDto 不再声明 sourceOrgId —— ` +
      `ValidationPipe 开了 forbidNonWhitelisted，前端再送这个字段会被 400 拒掉。` +
      `请先确认后端口径，不要让表单继续提交一个不存在的字段。`,
  )
}
const dtoDecorators = (ts.getDecorators(dtoSourceOrgId) ?? []).map((d) => d.getText())
if (!dtoDecorators.some((d) => d.startsWith('@IsOptional'))) {
  fail(
    `${rel(SERVER_DTO)} 的 sourceOrgId 不再是 @IsOptional（实际：${dtoDecorators.join(' ') || '无装饰器'}）。` +
      `本页把「留空」作为合法业务状态提交 null，字段变必填会让所有自录机构保存失败。`,
  )
}
pass(`${rel(SERVER_DTO)} 的 CreateOfflineAgencyDto 声明 sourceOrgId 且为 @IsOptional（留空可提交）`)

const serverText = readOrFail(SERVER_SERVICE)
const serverAst = sourceFile(SERVER_SERVICE, serverText)

for (const methodName of ['adminCreate', 'adminUpdate']) {
  const method = collect(
    serverAst,
    (n) => ts.isMethodDeclaration(n) && n.name?.getText() === methodName,
  )[0]
  if (!method) fail(`${rel(SERVER_SERVICE)} 里找不到 ${methodName}，本门禁的 oracle 抽取已失配`)
  const writes = collect(
    method,
    (n) =>
      ts.isPropertyAssignment(n) &&
      n.name.getText() === 'sourceOrgId' &&
      n.initializer.getText().includes('dto.sourceOrgId'),
  ).length
  if (writes !== 1) {
    fail(
      `${rel(SERVER_SERVICE)} 的 ${methodName} 里 \`sourceOrgId: dto.sourceOrgId\` 有 ${writes} 处（预期 1 处）。` +
        `后端不再落这一列的话，表单上的「来源机构」就是又一个空转控件。`,
    )
  }
}
pass(`${rel(SERVER_SERVICE)} 的 adminCreate / adminUpdate 都把 dto.sourceOrgId 写进 data（表单提交不会被丢弃）`)

// 闸门条件：留空文案宣称「不套闸门」，这句话的真伪由服务端这一行决定
const publishMethod = collect(
  serverAst,
  (n) => ts.isMethodDeclaration(n) && n.name?.getText() === 'adminPublish',
)[0]
if (!publishMethod) fail(`${rel(SERVER_SERVICE)} 里找不到 adminPublish`)
const trustGuards = collect(
  publishMethod,
  (n) => ts.isIfStatement(n) && n.thenStatement.getText().includes('assertOrgContentTrustActive'),
)
if (trustGuards.length !== 1) {
  fail(`${rel(SERVER_SERVICE)} adminPublish 里 assertOrgContentTrustActive 守卫抽到 ${trustGuards.length} 处，预期 1 处`)
}
const trustCondition = trustGuards[0].expression.getText()
if (!trustCondition.includes('agency.sourceOrgId')) {
  fail(
    `${rel(SERVER_SERVICE)} adminPublish 的信任闸门条件不再依赖 agency.sourceOrgId（实际：${trustCondition}）。` +
      `表单上「留空 = 不套发布闸门」的说明会因此变成假话，必须同步改文案。`,
  )
}
pass(`${rel(SERVER_SERVICE)} adminPublish 的信任闸门条件为 \`${trustCondition}\`，与表单「留空不套闸门」的说明一致`)

// ---------------------------------------------------------------------------
// 2. 前端真的把这个字段送出去（本次事故的正面回归）
// ---------------------------------------------------------------------------
const inputInterface = collect(
  serviceAst,
  (n) => ts.isInterfaceDeclaration(n) && n.name.getText() === 'OfflineAgencyInput',
)[0]
if (!inputInterface) fail(`${rel(SERVICE)} 里找不到 OfflineAgencyInput`)
if (!inputInterface.members.some((m) => m.name?.getText() === 'sourceOrgId')) {
  fail(
    `${rel(SERVICE)} 的 OfflineAgencyInput 没有 sourceOrgId —— ` +
      `这正是 2026-09-02 的缺陷本体：后端支持、表单不送，新建机构的资质链路整条空转。`,
  )
}
pass(`${rel(SERVICE)} 的 OfflineAgencyInput 声明了 sourceOrgId`)

const formToInput = findFunction(formAst, 'formToInput')
if (!formToInput) fail(`${rel(FORM)} 里找不到 formToInput`)
const submittedProps = collect(
  formToInput,
  (n) => ts.isPropertyAssignment(n) && n.name.getText() === 'sourceOrgId',
)
if (submittedProps.length !== 1) {
  fail(
    `${rel(FORM)} 的 formToInput 返回体里 sourceOrgId 有 ${submittedProps.length} 处（预期 1 处）—— ` +
      `表单有字段但不提交，等于没有字段。`,
  )
}
// 必须映射成 null 而不是省略：省略在后端语义是「不修改」，那样解绑做不到
if (!/null|\?\?|\bs\(/.test(submittedProps[0].initializer.getText())) {
  fail(
    `${rel(FORM)} 的 formToInput 里 sourceOrgId 的取值 \`${submittedProps[0].initializer.getText()}\` ` +
      `看不出把空值映射成 null。传 undefined 在 adminUpdate 语义是「不修改」，已有的绑定将永远解不掉。`,
  )
}
pass(`${rel(FORM)} 的 formToInput 提交 sourceOrgId，且空值映射为 null（可解绑）`)

// mock 不得再替管理员偷偷绑一个来源机构
if (serviceText.includes('MOCK_SOURCE_ORG_ROTATION')) {
  fail(
    `${rel(SERVICE)} 仍在使用 MOCK_SOURCE_ORG_ROTATION 分配 sourceOrgId —— ` +
      `它会把「管理员明确留空」篡改成「系统替你绑了一个」，让 mock 下的验证结论失真。`,
  )
}
const mockCreate = collect(
  serviceAst,
  (n) =>
    ts.isPropertyAssignment(n) &&
    n.name.getText() === 'sourceOrgId' &&
    n.initializer.getText().includes('input.sourceOrgId'),
).length
if (mockCreate === 0) {
  fail(`${rel(SERVICE)} 的 mock createAgency 没有按 input.sourceOrgId 写入，mock 下无法验证本链路`)
}
pass(`${rel(SERVICE)} 的 mock createAgency 按表单实际选择写入 sourceOrgId（轮转兜底已移除）`)

// ---------------------------------------------------------------------------
// 3. 选择器复用既有端点，且不是裸 ID 输入框
// ---------------------------------------------------------------------------
if (callsMethod(formAst, 'listOrgs').length === 0) {
  fail(
    `${rel(FORM)} 没有调用 orgsAdminService.listOrgs —— ` +
      `来源机构候选必须复用既有的 GET /admin/orgs，不新增后端端点。`,
  )
}
for (const [path, ast] of [[FORM, formAst], [SERVICE, serviceAst]]) {
  const literals = collect(ast, (n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
  const orgsEndpoint = literals.filter((n) => n.text.includes('/admin/orgs'))
  if (orgsEndpoint.length > 0) {
    fail(
      `${rel(path)} 里直接出现了 /admin/orgs 端点字面量（${orgsEndpoint.map((n) => n.text).join(' , ')}）—— ` +
        `应通过 orgsAdminService 复用，避免本页各自拼一份端点与鉴权。`,
    )
  }
}
const selects = jsxNamed(formAst, 'select').filter((n) =>
  n.attributes.properties.some(
    (a) => ts.isJsxAttribute(a) && a.name.getText() === 'value' && a.initializer?.getText().includes('sourceOrgId'),
  ),
)
if (selects.length !== 1) {
  fail(
    `${rel(FORM)} 里绑定 sourceOrgId 的 <select> 有 ${selects.length} 个（预期 1 个）。` +
      `要求下拉选择而不是裸 ID 输入框：管理员必须能按名称认出机构。`,
  )
}
// 下拉里必须有「不绑定」的空值选项，否则字段事实上变成必填
const blankOption = jsxNamed(formAst, 'option').some((n) =>
  n.attributes.properties.some(
    (a) => ts.isJsxAttribute(a) && a.name.getText() === 'value' && a.initializer?.getText() === '""',
  ),
)
if (!blankOption) {
  fail(`${rel(FORM)} 的来源机构下拉没有 value="" 的「不绑定」选项，字段事实上成了必填`)
}
pass(`${rel(FORM)} 用 <select> 复用 orgsAdminService.listOrgs 的机构列表，并保留「不绑定」空值选项`)

// ---------------------------------------------------------------------------
// 4. 留空文案：如实写后果，不写「建议填写」
// ---------------------------------------------------------------------------
const emptyCopyNode = collect(
  formAst,
  (n) => ts.isConditionalExpression(n) && n.condition.getText().replace(/\s/g, '').includes("form.sourceOrgId===''"),
)[0]
if (!emptyCopyNode) {
  fail(`${rel(FORM)} 里找不到按 \`form.sourceOrgId === ''\` 分叉的说明文案 —— 留空的后果没有被单独说明`)
}
const emptyCopy = emptyCopyNode.whenTrue.getText()
for (const [needle, why] of [
  ['闸门', '没说清留空后发布闸门不生效'],
  ['资质', '没说清留空后不存在可核验的资质档案'],
]) {
  if (!emptyCopy.includes(needle)) {
    fail(`${rel(FORM)} 的留空说明缺少「${needle}」：${why}。当前文案：${emptyCopy.slice(0, 160)}…`)
  }
}
for (const banned of ['建议填写', '建议绑定', '推荐填写']) {
  if (emptyCopy.includes(banned)) {
    fail(`${rel(FORM)} 的留空说明出现「${banned}」这类没有信息量的话，必须如实写后果`)
  }
}
pass(`${rel(FORM)} 的留空说明写明了「不套发布闸门 / 无可核验资质档案」两项后果，未使用「建议填写」式空话`)

// ---------------------------------------------------------------------------
// 5. 机构列表「没拿到」≠「没有」（沿用本页 GovernanceDrawer 的口径）
// ---------------------------------------------------------------------------
const orgErrorGuards = []
const orgEmptyGuards = []
for (const el of collect(formAst, (n) => isJsxEl(n))) {
  const guard = guardOfElement(el)
  if (!guard || !guard.includes('orgs.kind')) continue
  if (guard.includes("orgs.kind === 'error'")) orgErrorGuards.push({ el, guard })
  if (guard.includes("orgs.kind === 'ready'") && /length\s*===\s*0/.test(guard)) orgEmptyGuards.push({ el, guard })
}
if (orgErrorGuards.length === 0) {
  fail(
    `${rel(FORM)} 没有 \`orgs.kind === 'error'\` 的独立分支 —— ` +
      `机构列表拉取失败会被渲染成一个空下拉，读起来就是「系统里没有机构可选」。`,
  )
}
if (orgEmptyGuards.length === 0) {
  fail(`${rel(FORM)} 没有「确认为空」（ready 且 length === 0）的独立分支，无法与拉取失败区分`)
}
// 失败态下不得渲染下拉：一个空 <select> 会把「没拿到」表达成「没有」
const selectGuard = guardOfElement(selects[0]) ?? ''
if (!selectGuard.includes("orgs.kind === 'ready'")) {
  fail(
    `${rel(FORM)} 的来源机构下拉守卫是 \`${selectGuard || '（无守卫，始终渲染）'}\`，` +
      `没有限定在 ready 态。加载失败时渲染空下拉 = 把「没拿到」说成「没有」。`,
  )
}
pass(`${rel(FORM)} 的机构列表「拉取失败 / 确认为空 / 有候选」三态互斥，失败态不渲染空下拉`)

// ---------------------------------------------------------------------------
// 6. 资质抽屉五态：都存在，且「失败」绝不渲染成「空」
// ---------------------------------------------------------------------------
const confirmedEmpty = jsxNamed(drawerAst, 'ConfirmedEmpty')
const loadFailed = jsxNamed(drawerAst, 'LoadFailed')
if (confirmedEmpty.length === 0 || loadFailed.length === 0) {
  fail(
    `${rel(DRAWER)} 缺少 ConfirmedEmpty(${confirmedEmpty.length}) / LoadFailed(${loadFailed.length}) —— ` +
      `「查过了就是没有」和「没查到」必须是两个不同的表达。`,
  )
}
for (const el of loadFailed) {
  const guard = guardOfElement(el) ?? ''
  if (!guard.includes('error')) {
    fail(`${rel(DRAWER)} 有一处 LoadFailed 的守卫不含 error：\`${guard}\` —— 正常数据被渲染成加载失败`)
  }
}
for (const el of confirmedEmpty) {
  const guard = guardOfElement(el) ?? ''
  if (guard.includes('error')) {
    fail(
      `${rel(DRAWER)} 有一处 ConfirmedEmpty 渲染在错误分支上：\`${guard}\` —— ` +
        `接口失败被写成「查过了，没有」，管理员会据此按「资质缺失」下审核结论。这是本门禁的头号目标。`,
    )
  }
}
pass(`${rel(DRAWER)} 的 ${loadFailed.length} 处 LoadFailed 全部挂在 error 守卫上，${confirmedEmpty.length} 处 ConfirmedEmpty 全部不在 error 守卫上`)

const drawerGuards = collect(drawerAst, (n) => isJsxEl(n)).map((el) => ({
  name: jsxName(el),
  guard: guardOfElement(el) ?? '',
}))
const REQUIRED_STATES = [
  {
    label: '① 没有来源机构（不发请求，也不算无资质）',
    match: (g) => g.name === 'ConfirmedEmpty' && /^!\(\s*organizationId\s*\)$/.test(g.guard.trim()),
  },
  {
    label: '② 来源机构在机构表中不存在（404，≠ 没有资质）',
    match: (g) =>
      g.guard.includes("quals.kind === 'error'") &&
      g.guard.includes('ORGANIZATION_NOT_FOUND_CODE') &&
      !g.guard.includes('!== ORGANIZATION_NOT_FOUND_CODE'),
  },
  {
    label: '③ 资质接口失败（其它错误码）',
    match: (g) =>
      g.name === 'LoadFailed' &&
      g.guard.includes("quals.kind === 'error'") &&
      g.guard.includes('!== ORGANIZATION_NOT_FOUND_CODE'),
  },
  {
    label: '④ 确认零资质（接口正常返回，可据此判定缺失）',
    match: (g) =>
      g.name === 'ConfirmedEmpty' &&
      g.guard.includes("quals.kind === 'ready'") &&
      /quals\.data\.length\s*===\s*0/.test(g.guard),
  },
  {
    label: '⑤ 有资质，逐条列出',
    match: (g) =>
      g.name === 'QualificationCard' ||
      (g.guard.includes("quals.kind === 'ready'") && /quals\.data\.length\s*>\s*0/.test(g.guard)),
  },
]
for (const state of REQUIRED_STATES) {
  if (!drawerGuards.some((g) => state.match(g))) {
    fail(`${rel(DRAWER)} 找不到状态「${state.label}」的渲染分支 —— 五态不再可分辨`)
  }
}
pass(`${rel(DRAWER)} 五态齐备且守卫互不重叠：${REQUIRED_STATES.map((s) => s.label.slice(0, 2)).join(' ')}`)

// ---------------------------------------------------------------------------
// 7. 取证只走 evidence-access 这一条留痕路径
// ---------------------------------------------------------------------------
if (callsMethod(drawerAst, 'getQualificationEvidence').length === 0) {
  fail(`${rel(DRAWER)} 没有调用 getQualificationEvidence —— 取证没有走会写审计的那条端点`)
}
// 页面目录里不允许自己拼文件端点（GET /files/:id/url 是 fail-open 审计，且不带
// qualificationId 上下文；后端刻意不返回 evidenceFileId 就是为了让前端拼不出来）
for (const [path, ast] of [[FORM, formAst], [DRAWER, drawerAst]]) {
  const literals = collect(ast, (n) =>
    ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n))
  const fileUrls = literals.filter((n) => n.getText().includes('/files/'))
  if (fileUrls.length > 0) {
    fail(
      `${rel(path)} 里出现直接拼 /files/ 的字符串（${fileUrls.map((n) => n.getText()).join(' , ')}）—— ` +
        `绕过 evidence-access 就绕过了 audit.writeRequired 的强制留痕（那条是 fail-closed，/files/ 是 fail-open）。`,
    )
  }
}
if (collect(drawerAst, (n) => ts.isIdentifier(n) && n.text === 'evidenceFileId').length > 0) {
  fail(`${rel(DRAWER)} 引用了 evidenceFileId —— 后端刻意不下发该字段，出现它意味着有人绕道拿到了文件 ID`)
}
// 不得预取：evidence-access 一次调用 = 一条审计，放进 useEffect 会给没真看过的材料留痕
for (const effect of callsMethod(drawerAst, 'useEffect').concat(
  collect(drawerAst, (n) => ts.isCallExpression(n) && n.expression.getText() === 'useEffect'),
)) {
  if (effect.getText().includes('getQualificationEvidence')) {
    fail(`${rel(DRAWER)} 在 useEffect 里调用 getQualificationEvidence —— 预取会给没真正查看过的材料留下审计记录`)
  }
}
// 开窗必须先于请求：窗口开不出来就不发请求，不留一条「其实没看到」的审计
const viewEvidence = findFunction(drawerAst, 'viewEvidence')
if (!viewEvidence) fail(`${rel(DRAWER)} 里找不到 viewEvidence`)
const openCall = collect(viewEvidence, (n) => ts.isCallExpression(n) && n.expression.getText() === 'openDeferredWindow')[0]
const evidenceCall = callsMethod(viewEvidence, 'getQualificationEvidence')[0]
if (!openCall) fail(`${rel(DRAWER)} 的 viewEvidence 没有先开窗（openDeferredWindow）`)
if (!evidenceCall) fail(`${rel(DRAWER)} 的 viewEvidence 里没有 getQualificationEvidence 调用`)
if (openCall.getStart() > evidenceCall.getStart()) {
  fail(
    `${rel(DRAWER)} 的 viewEvidence 先请求后开窗 —— ` +
      `弹窗被拦截时会留下一条「看过了」的审计，而管理员其实什么都没看到。`,
  )
}
const earlyReturn = collect(
  viewEvidence,
  (n) => ts.isIfStatement(n) && /^!\s*win$/.test(n.expression.getText().trim()) && n.thenStatement.getText().includes('return'),
).length
if (earlyReturn === 0) {
  fail(`${rel(DRAWER)} 的 viewEvidence 没有在开窗失败时 early return，仍会发出取证请求`)
}
pass(`${rel(DRAWER)} 取证只走 evidence-access：无 /files/ 拼接、无 evidenceFileId、无 useEffect 预取，且开窗失败即 early return`)

console.log('\nALL PASS')
