/**
 * Admin 招聘类页面 3.15 停放门禁 —— 管理员侧只留查看、紧急下架与熔断，停放的写控件不被挂载。
 *
 * ── 它挡的是哪一类缺陷 ──────────────────────────────────────────────────────
 *
 * 托管 a 下本平台不代建、不代审、不代发、不代改招聘类内容。3.15 起管理员后台的这些写控件
 * **不论托管开关一律停放**：源码搬进各页同目录的停放文件，不注册、不 import、不打包。
 * 停放最容易坏在两处：
 *   1. 有人为了「恢复一个小功能」把停放文件 import 回页面 —— 页面上又出现一排代审代发按钮；
 *   2. 合作机构类型下拉重新列出企业数据来源 / 招聘会主办方 —— 管理员选了必被服务端 ORG_TYPE_PARKED 拒绝，
 *      或更糟：前后端清单漂移，一边放行一边拒。
 *
 * ── 为什么不只做字符串匹配 ──────────────────────────────────────────────────
 *
 *   - 下拉选项：把 routes/partners/orgTypeOptions.ts 真的**加载起来**求值，并以服务端
 *     services/api/src/orgs/parked-org-types.ts 的清单为 oracle 比对；再用 AST 核对两个 <select>
 *     的选项确实来自这两个函数，而不是 Object.entries(PARTNER_TYPE_LABELS)。
 *   - 工作台招聘类存量：把 routes/dashboard/recruitmentStock.ts 加载起来，在托管开 / 关 × 有 / 无存量 ×
 *     读取失败上逐一求值，断言关闭时不出现「待审核 / 去审核」，开启时也不把管理员写成审核人。
 *   - 停放文件：扫描整个 admin src 的真实 import 语句（去掉注释后），不许出现任何停放文件的导出名。
 *
 * ── 运行 ────────────────────────────────────────────────────────────────────
 *   pnpm --filter @ai-job-print/admin verify:source-publish-actions
 * （挂在该 npm script 的链上执行，与 verify-admin-content-trust-ui.mjs 同样的挂法，ci.yml 无需新增行。
 *   需要 node_modules 里的 typescript，该 CI step 位于 pnpm install 之后，前置成立。）
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(adminRoot, '..', '..')
const R = (p) => join(adminRoot, 'src/routes', p)

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
/** 去掉注释，只看会执行的代码（停放说明里会提到被停放的名字）。 */
function codeOnly(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
function sourceFile(path, text) {
  return ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
}
function collect(node, predicate, out = []) {
  if (predicate(node)) out.push(node)
  // forEachChild 遇到回调返回真值就停；collect 返回数组（真值），必须包一层不返回值
  node.forEachChild((child) => { collect(child, predicate, out) })
  return out
}
/** 把一个 TS 模块 transpile 成 CommonJS 并求值；stubs 提供它 import 的依赖。 */
function loadModule(path, stubs = {}) {
  const text = readOrFail(path)
  const js = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const mod = { exports: {} }
  try {
    new Function('exports', 'require', 'module', js)(
      mod.exports,
      (spec) => {
        if (spec in stubs) return stubs[spec]
        fail(`${rel(path)} import 了门禁未预期的模块 ${spec}（本门禁要在纯 node 下求值）`)
      },
      mod,
    )
  } catch (error) {
    fail(`${rel(path)} 无法在纯 node 下求值：${error instanceof Error ? error.message : String(error)}`)
  }
  return mod.exports
}
function sameSet(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x))
}

console.log('\n=== Admin 招聘类页面 3.15 停放验证 ===')

// ---------------------------------------------------------------------------
// 1. 合作机构类型下拉：停放类型不能新建、不能改成（与服务端同一清单）
// ---------------------------------------------------------------------------
{
  const serverText = readOrFail(join(repoRoot, 'services/api/src/orgs/parked-org-types.ts'))
  const serverList = [...(serverText.match(/export const PARKED_ORG_TYPES = \[([^\]]*)\] as const/)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  if (serverList.length === 0) fail('服务端 parked-org-types.ts 里抽不到 PARKED_ORG_TYPES，oracle 已失配')
  if (!serverText.includes("export const ORG_TYPE_PARKED = 'ORG_TYPE_PARKED'")) fail('服务端停放错误码不再是 ORG_TYPE_PARKED')

  const sharedText = readOrFail(join(repoRoot, 'packages/shared/src/types/partner.ts'))
  const labelsBlock = sharedText.match(/export const PARTNER_TYPE_LABELS: Record<PartnerType, string> = \{([\s\S]*?)\n\}/)?.[1] ?? ''
  const labels = Object.fromEntries([...labelsBlock.matchAll(/^\s*([a-z_]+):\s*'([^']+)'/gm)].map((m) => [m[1], m[2]]))
  if (Object.keys(labels).length < 5) fail('抽不到 PARTNER_TYPE_LABELS 的五类机构，oracle 已失配')

  const opts = loadModule(R('partners/orgTypeOptions.ts'))
  if (!sameSet([...opts.PARKED_ORG_TYPES], serverList)) {
    fail(`前端停放清单 [${opts.PARKED_ORG_TYPES}] 与服务端 [${serverList}] 不一致 —— 一边放行一边拒`)
  }
  const active = Object.keys(labels).filter((t) => !serverList.includes(t))
  const createValues = opts.createOrgTypeOptions(labels).map((o) => o.value)
  if (!sameSet(createValues, active)) {
    fail(`新建下拉应恰好是非停放类型 [${active}]，实际 [${createValues}]`)
  }
  for (const current of Object.keys(labels)) {
    const values = opts.editOrgTypeOptions(labels, current).map((o) => o.value)
    const expected = serverList.includes(current) ? [...active, current] : active
    if (!sameSet(values, expected)) {
      fail(`编辑 ${current} 时下拉应为 [${expected}]（存量停放类型只保留自身，不能改成另一停放类型），实际 [${values}]`)
    }
  }
  const parkedLabel = opts.editOrgTypeOptions(labels, serverList[0]).find((o) => o.value === serverList[0])?.label ?? ''
  if (!parkedLabel.includes('已停放')) fail(`存量停放类型在下拉里没有标「已停放」：${parkedLabel}`)
  pass(`下拉选项求值：新建只给 ${active.length} 类非停放类型；编辑存量停放类型只保留自身并标「已停放」；清单与服务端一致`)

  // 两个 <select> 真的用了这两个函数（改回 Object.entries(PARTNER_TYPE_LABELS) 会在这里红）
  const pagePath = R('partners/index.tsx')
  if (!/<CreateOrgDrawer[\s/>]/.test(readOrFail(pagePath)) || !/<OrgDetailDrawer[\s/>]/.test(readOrFail(pagePath))) fail('机构新建与详情抽屉必须仍由原页面渲染')
  const page = ['CreateOrgDrawer.tsx', 'OrgDetailDrawer.tsx'].map((f) => readOrFail(R(`partners/${f}`))).join('\n')
  const ast = sourceFile(pagePath, page)
  const typeSelects = collect(ast, (n) => ts.isJsxElement(n) && n.openingElement.tagName.getText() === 'select' &&
    n.openingElement.attributes.properties.some((a) => ts.isJsxAttribute(a) && a.name.getText() === 'value' && /form\.type\b/.test(a.initializer?.getText() ?? '')))
  if (typeSelects.length !== 2) fail(`${rel(pagePath)} 里绑定 form.type 的 <select> 应为 2 个（新建 / 编辑），实际 ${typeSelects.length}`)
  const sources = typeSelects.map((el) => el.children.map((c) => c.getText()).join(''))
  if (!sources.some((t) => t.includes('createOrgTypeOptions(PARTNER_TYPE_LABELS)')) ||
      !sources.some((t) => /editOrgTypeOptions\(PARTNER_TYPE_LABELS,\s*detail\.type\)/.test(t))) {
    fail(`${rel(pagePath)} 的机构类型下拉没有分别用 createOrgTypeOptions / editOrgTypeOptions 生成选项`)
  }
  if (sources.some((t) => t.includes('Object.entries(PARTNER_TYPE_LABELS)'))) {
    fail(`${rel(pagePath)} 的机构类型下拉仍直接遍历 PARTNER_TYPE_LABELS —— 停放类型会重新出现在下拉里`)
  }
  pass(`${rel(pagePath)} 新建 / 编辑两个机构类型下拉都经停放过滤生成`)
}

// ---------------------------------------------------------------------------
// 2. 停放文件：带停放头、不被任何文件 import（写入小节只许被停放编辑器引用）
// ---------------------------------------------------------------------------
const PARKED_FILES = [
  ['fairs/components/EditFairDrawer.tsx', 'EditFairDrawer'],
  ['fairs/components/CompaniesTabEditor.tsx', 'CompaniesTabEditor'],
  ['fairs/components/ZonesTabEditor.tsx', 'ZonesTabEditor'],
  ['fairs/components/MaterialsTabEditor.tsx', 'MaterialsTabEditor'],
  ['fairs/VenueGuideTabEditor.tsx', 'VenueGuideTabEditor'],
  ['companies/components/CreateCompanyDrawer.tsx', 'CreateCompanyDrawer'],
  ['companies/components/CompanyDetailDrawerEditor.tsx', 'CompanyDetailDrawerEditor'],
  ['sync-sources/SyncSourceWriteActions.tsx', 'SyncSourceWriteActions'],
]
/** 只许被停放编辑器引用的写入小节 */
const PARKED_ONLY_FROM = {
  ReviewPublishSection: 'companies/components/CompanyDetailDrawerEditor.tsx',
  LinkedJobsSection: 'companies/components/CompanyDetailDrawerEditor.tsx',
}
{
  for (const [file] of PARKED_FILES) {
    if (!readOrFail(R(file)).startsWith('// 【停放，')) fail(`${rel(R(file))} 缺少停放文件头注释`)
  }
  for (const file of ['companies/components/ReviewPublishSection.tsx', 'companies/components/LinkedJobsSection.tsx']) {
    if (!readOrFail(R(file)).startsWith('// 【停放，')) fail(`${rel(R(file))} 缺少停放文件头注释`)
  }
  const offenders = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!/\.(tsx?|jsx?)$/.test(name)) continue
      const code = codeOnly(readFileSync(full, 'utf8'))
      const importsName = (exported) =>
        new RegExp(`import\\s+(?:type\\s+)?\\{[^}]*\\b${exported}\\b[^}]*\\}\\s*from`).test(code) ||
        new RegExp(`import\\([^)]*${exported}`).test(code)
      for (const [, exported] of PARKED_FILES) {
        if (importsName(exported)) offenders.push(`${rel(full)} → ${exported}`)
      }
      for (const [exported, allowed] of Object.entries(PARKED_ONLY_FROM)) {
        if (importsName(exported) && full !== R(allowed)) offenders.push(`${rel(full)} → ${exported}`)
      }
    }
  }
  walk(join(adminRoot, 'src'))
  if (offenders.length > 0) fail(`停放文件被挂回了页面：${offenders.join(' , ')}`)
  pass(`${PARKED_FILES.length} 个停放文件与 2 个写入小节都带停放头，且没有被页面 import`)
}

// ---------------------------------------------------------------------------
// 3. 挂着的页面上没有写接口调用（只留查看、紧急下架、熔断）
// ---------------------------------------------------------------------------
{
  const LIVE = [
    {
      files: ['fairs/index.tsx', 'fairs/components/CompaniesTab.tsx', 'fairs/components/ZonesTab.tsx', 'fairs/components/MaterialsTab.tsx', 'fairs/VenueGuideTab.tsx'],
      banned: ['updateFair', 'createCompany', 'updateCompany', 'deleteCompany', 'createZone', 'updateZone', 'deleteZone',
        'saveVenueGuide', 'deleteVenueGuide', 'uploadMaterial', 'updateMaterial', 'publishMaterial', 'deleteMaterial', 'readOnly'],
      takedowns: [['fairs/index.tsx', "targetType: 'job_fair'"], ['fairs/index.tsx', "targetType: 'fair_material'"], ['fairs/components/MaterialsTab.tsx', '紧急下架']],
    },
    {
      files: ['companies/index.tsx', 'companies/components/CompanyDetailDrawer.tsx'],
      banned: ['createCompany', 'updateCompany', 'reviewCompany', 'publishCompany', 'linkJobs', 'unlinkJob', 'listLinkableJobs', '新增企业', 'readOnly'],
      takedowns: [['companies/index.tsx', "targetType: 'company'"]],
    },
    {
      files: ['sync-sources/index.tsx'],
      banned: ['/trigger', '/enabled', '/response-config', '/unpublish-content', '/impact', 'hosting.writable', '审批并启用', '立即同步', '批量下架内容'],
      takedowns: [['sync-sources/index.tsx', "scope: 'source'"]],
    },
  ]
  for (const group of LIVE) {
    for (const file of group.files) {
      const code = codeOnly(readOrFail(R(file)))
      for (const token of group.banned) {
        if (code.includes(token)) fail(`${rel(R(file))} 仍含 ${token} —— 3.15 起这类写操作应只在停放文件里`)
      }
    }
    for (const [file, token] of group.takedowns) {
      if (!codeOnly(readOrFail(R(file))).includes(token)) fail(`${rel(R(file))} 丢了处置入口（${token}）`)
    }
  }
  pass('招聘会管理（含各页签）、企业展示、数据接入通道的挂载代码里没有写接口调用，紧急下架 / 熔断入口仍在')
}

// ---------------------------------------------------------------------------
// 4. 工作台招聘类存量：托管开 / 关 × 有 / 无存量 × 读取失败，逐一求值
// ---------------------------------------------------------------------------
{
  const icons = { BriefcaseIcon: 'Briefcase', PrinterIcon: 'Printer' }
  const stock = loadModule(R('dashboard/recruitmentStock.ts'), { 'lucide-react': icons })
  const ban = (text, where) => {
    for (const word of ['待审核', '去审核', '审核通过后', '管理员审核']) {
      if (text.includes(word)) fail(`工作台${where}出现「${word}」—— 管理员不再审核招聘类内容`)
    }
  }
  const printers = { ready: 2, total: 3 }
  // 托管关闭 + 有存量
  const closedKpi = stock.recruitmentStockKpi({ hostingOpen: false, jobs: 5, fairs: 2, printers })
  const closedTodo = stock.recruitmentStockTodo({ hostingOpen: false, jobs: 5, fairs: 2 })
  if (closedKpi.label !== '招聘类存量' || closedKpi.value !== '7' || closedKpi.failed) fail(`托管关闭有存量时指标卡应为「招聘类存量 7」，实际 ${JSON.stringify(closedKpi)}`)
  if (!closedTodo || closedTodo.title !== '招聘类存量 7 条（托管关闭，不再审核）' || closedTodo.href !== '/job-sources') {
    fail(`托管关闭有存量时待办应为「招聘类存量 7 条（托管关闭，不再审核）」并链到岗位信息源，实际 ${JSON.stringify(closedTodo)}`)
  }
  const fairOnly = stock.recruitmentStockTodo({ hostingOpen: false, jobs: 0, fairs: 3 })
  if (fairOnly?.href !== '/fair-sources') fail('只有招聘会存量时应链到招聘会信息源（能逐条紧急下架的页面）')
  ban(JSON.stringify([closedKpi, closedTodo]), '（托管关闭）')
  // 托管关闭 + 无存量：待办不出现，指标卡换成打印机就绪
  const emptyKpi = stock.recruitmentStockKpi({ hostingOpen: false, jobs: 0, fairs: 0, printers })
  if (stock.recruitmentStockTodo({ hostingOpen: false, jobs: 0, fairs: 0 }) !== null) fail('托管关闭且无存量时不应出现招聘类待办')
  if (emptyKpi.label.includes('招聘') || emptyKpi.value !== '2') fail(`托管关闭且无存量时指标卡不应再讲招聘，实际 ${JSON.stringify(emptyKpi)}`)
  if (!stock.recruitmentStockKpi({ hostingOpen: false, jobs: 0, fairs: 0, printers: null }).failed) fail('打印机数据没读到时不能显示成 0 台就绪')
  // 读取失败：按失败显示，不猜 0
  if (!stock.recruitmentStockKpi({ hostingOpen: false, jobs: null, fairs: 2, printers }).failed) fail('岗位来源读取失败时指标卡应为失败态，不能按 0 计')
  // 托管打开：不把管理员写成审核人
  const openKpi = stock.recruitmentStockKpi({ hostingOpen: true, jobs: 4, fairs: 0, printers })
  const openTodo = stock.recruitmentStockTodo({ hostingOpen: true, jobs: 4, fairs: 0 })
  if (openKpi.label !== '招聘类内容' || !openKpi.sub.includes('发布机构')) fail(`托管打开时指标卡应写「招聘类内容 … 由发布机构自审自发」，实际 ${JSON.stringify(openKpi)}`)
  if (!openTodo?.title.includes('由发布机构自审自发')) fail(`托管打开时待办应写由发布机构自审自发，实际 ${JSON.stringify(openTodo)}`)
  ban(JSON.stringify([openKpi, openTodo]), '（托管打开）')

  const dashPath = R('dashboard/index.tsx')
  const dash = codeOnly(readOrFail(dashPath))
  for (const word of ['待审核数据', '待办审核', '去审核']) {
    if (dash.includes(word)) fail(`${rel(dashPath)} 仍出现「${word}」`)
  }
  if (!/hosting\.status === 'ready' && hosting\.enabled/.test(dash)) fail(`${rel(dashPath)} 没有按「读到且打开」判托管状态（读取中 / 失败应按关闭处理）`)
  if (!dash.includes('recruitmentStockKpi(') || !dash.includes('recruitmentStockTodo(')) fail(`${rel(dashPath)} 没有用 recruitmentStock.ts 生成招聘类存量两处`)
  if (!/alert\.type === 'feedback_pending' \? '\/member-feedback\?category=ai_content' : '\/alerts'/.test(dash)) {
    fail(`${rel(dashPath)} 的意见反馈告警行没有链到 /member-feedback?category=ai_content`)
  }
  if (!/alert\.type === 'feedback_pending'\s*\?\s*`意见反馈 · /.test(dash)) fail(`${rel(dashPath)} 的意见反馈告警行仍显示终端号（会落成「未知终端」）`)
  pass('工作台：托管关闭只在有存量时写「招聘类存量 N 条（托管关闭，不再审核）」并链到可紧急下架的页；打开时写由发布机构自审自发；意见反馈行链到反馈页')
}

// ---------------------------------------------------------------------------
// 5. AI 大模型：依赖招聘托管的三项在托管关闭时不标「已接入」
// ---------------------------------------------------------------------------
{
  const path = R('ai-config/index.tsx')
  const code = codeOnly(readOrFail(path))
  const set = code.match(/RECRUITMENT_HOSTED_FEATURES[^=]*=\s*new Set<AiModelFeatureKey>\(\[([^\]]*)\]\)/)?.[1] ?? ''
  const keys = [...set.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  if (!sameSet(keys, ['fair_visit_plan', 'job_recommend', 'job_explain'])) fail(`${rel(path)} 的托管依赖功能清单应为三项，实际 [${keys}]`)
  if (!code.includes('托管关闭，不可用') || !/hosting\.status === 'ready' && !hosting\.enabled/.test(code)) {
    fail(`${rel(path)} 没有在托管关闭时把这三项标成「托管关闭，不可用」`)
  }
  pass(`${rel(path)} 托管关闭时招聘会行程 / 岗位推荐 / 岗位解读标「托管关闭，不可用」`)
}

console.log('\nALL PASS')
