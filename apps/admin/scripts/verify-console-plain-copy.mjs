// 两个后台的用户可见文案不得带工程词、Markdown 星号或原始状态码。
// 只扫 .tsx 的字符串字面量与 JSX 文本，跳过注释。
// 另外真执行 auditActionLabels.ts：审计契约里的每个动作都有中文名，未知动作显示「其他操作」。

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import vm from 'node:vm'

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(adminRoot, '../..')
const scanRoots = [join(adminRoot, 'src'), join(repoRoot, 'apps/partner/src')]
const labelsPath = join(adminRoot, 'src/lib/auditActionLabels.ts')
const auditTypesPath = join(repoRoot, 'services/api/src/audit/audit.types.ts')

const FORBIDDEN = [
  'CLOSED_MODE',
  'fail-closed',
  'info-only',
  '不直接对应前端页面',
  'contentTrustStatus=',
  '系统不回显姓名',
  '**',
]

const failures = []
function fail(message) {
  failures.push(message)
  console.error(`  FAIL ${message}`)
}

function walkTsx(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const path = join(dir, name)
    const info = statSync(path)
    if (info.isDirectory()) walkTsx(path, out)
    else if (name.endsWith('.tsx')) out.push(path)
  }
  return out
}

function literalTexts(sourceFile) {
  const texts = []
  function take(value, pos) {
    if (value) texts.push({ value, pos })
  }
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      take(node.text, node.getStart(sourceFile))
    } else if (ts.isTemplateExpression(node)) {
      take(node.head.text, node.head.getStart(sourceFile))
      for (const span of node.templateSpans) take(span.literal.text, span.literal.getStart(sourceFile))
    } else if (ts.isJsxText(node)) {
      take(node.text, node.getStart(sourceFile))
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return texts
}

console.log('\n=== 后台可见文案（工程词 / Markdown 星号）===')
for (const file of scanRoots.flatMap((dir) => walkTsx(dir))) {
  const source = readFileSync(file, 'utf8')
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  for (const { value, pos } of literalTexts(sourceFile)) {
    const hit = FORBIDDEN.find((token) => value.includes(token))
    if (!hit) continue
    const { line } = sourceFile.getLineAndCharacterOfPosition(pos)
    fail(`${relative(repoRoot, file)}:${line + 1} 含有「${hit}」`)
  }
}
if (failures.length === 0) console.log('  PASS 管理员与合作机构页面的可见文案没有工程词或 Markdown 星号')

console.log('\n=== 终端与设备批次 W-06 文案 ===')
const batchFiles = [
  join(adminRoot, 'src/routes/devices/index.tsx'),
  join(adminRoot, 'src/routes/devices/TerminalFleetOverview.tsx'),
  join(adminRoot, 'src/routes/terminals/index.tsx'),
  join(adminRoot, 'src/routes/terminals/TerminalDetailDrawer.tsx'),
  join(adminRoot, 'src/routes/terminals/TerminalLifecycleActions.tsx'),
  join(adminRoot, 'src/routes/terminals/ReleaseObservationPanel.tsx'),
  join(adminRoot, 'src/routes/printers/index.tsx'),
  join(adminRoot, 'src/routes/peripherals/index.tsx'),
  join(adminRoot, 'src/routes/peripherals/PeripheralDrawer.tsx'),
  join(adminRoot, 'src/routes/peripherals/peripheralViews.ts'),
  join(adminRoot, 'src/routes/screensaver/index.tsx'),
  join(adminRoot, 'src/routes/screensaver/AssetsTab.tsx'),
  join(adminRoot, 'src/routes/screensaver/PlaylistsTab.tsx'),
  join(adminRoot, 'src/routes/screensaver/TerminalsTab.tsx'),
  join(adminRoot, 'src/routes/smart-campus/index.tsx'),
  join(repoRoot, 'apps/partner/src/routes/terminals/index.tsx'),
  join(repoRoot, 'apps/partner/src/routes/smart-campus/index.tsx'),
  join(repoRoot, 'apps/partner/src/routes/Page.tsx'),
]
const batchForbidden = ['Terminal Agent 心跳上报', 'printerStatus', 'orgId', 'Kiosk']
for (const file of batchFiles) {
  const source = readFileSync(file, 'utf8')
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const visible = literalTexts(sourceFile).map(({ value }) => value).join('\n')
  for (const token of batchForbidden) {
    if (visible.includes(token)) fail(`${relative(repoRoot, file)} 可见文案仍含「${token}」`)
  }
}
if (!failures.length) console.log('  PASS 本批页面可见文案没有 Terminal Agent 心跳上报 / printerStatus / orgId / Kiosk')

console.log('\n=== 智慧校园管理员视角文案 ===')
const adminSmartCampus = readFileSync(join(adminRoot, 'src/routes/smart-campus/index.tsx'), 'utf8')
for (const phrase of [
  '按终端配置「智慧校园」模块的显示开关。',
  '保存后一体机首页按开关显示或隐藏「智慧校园」',
  '学校账号在机构后台只能配置本校终端',
  '迎新内容 / 使用统计',
  '校园大数据',
]) {
  if (!adminSmartCampus.includes(phrase)) fail(`管理员智慧校园页缺少正向文案「${phrase}」`)
}
if (!failures.length) console.log('  PASS 智慧校园文案明确管理员按终端配置，并保留学校账号与未开放模块说明')

console.log('\n=== 审计动作中文名 ===')
const auditTypes = readFileSync(auditTypesPath, 'utf8')
const actionBlock = auditTypes.slice(
  auditTypes.indexOf('export type AuditAction'),
  auditTypes.indexOf('export type AuditTargetType'),
)
const actions = [...actionBlock.matchAll(/'([^']+)'/g)].map((match) => match[1])
if (actions.length < 40) fail(`审计契约动作抽取过少（${actions.length}），门禁可能扫错了文件`)

const transpiled = ts.transpileModule(readFileSync(labelsPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const module = { exports: {} }
vm.runInNewContext(transpiled, {
  exports: module.exports,
  module,
  require(spec) {
    throw new Error(`auditActionLabels.ts 不应依赖 ${spec}`)
  },
})
const getAuditActionLabel = module.exports.getAuditActionLabel
if (typeof getAuditActionLabel !== 'function') fail('auditActionLabels.ts 未导出 getAuditActionLabel')
else {
  for (const action of actions) {
    const label = getAuditActionLabel(action)
    if (typeof label !== 'string' || !/[\u4e00-\u9fff]/.test(label) || label === action || label === '其他操作') {
      fail(`动作 ${action} 没有中文名（实际：${label}）`)
    }
  }
  const unknown = getAuditActionLabel('not.a.real.action')
  if (unknown !== '其他操作') fail(`未知动作应显示「其他操作」，实际：${unknown}`)
  else console.log(`  PASS 契约内 ${actions.length} 个动作都有中文名，未知动作显示「其他操作」`)
  for (const [action, label] of [
    ['policy.publish', '政策发布'],
    ['terminal.bind_code.exchange', '终端绑定码兑换'],
    ['legal_doc.create', '新建法务文档版本'],
  ]) {
    if (getAuditActionLabel(action) !== label) fail(`${action} 应显示「${label}」`)
  }
}


console.log('\n=== 第二批页面实际渲染文案 ===')
// VM 运行原组件/列定义，替换请求与 hook 的数据源；只取渲染树 children，title 中的核对码不算可见文字。
const jsx = (type, props = {}) => ({ type, props })
const runtime = { jsx, jsxs: jsx, Fragment: 'fragment' }
function textOf(node) {
  if (node == null || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (typeof node !== 'object') return String(node)
  if (typeof node.type === 'function') return textOf(node.type(node.props))
  return textOf(node.props?.children)
}
const ui = {
  StatusBadge: ({ label }) => label,
  ConsoleTable: ({ items, columns }) => items.map((item) => columns.map((column) => column.cell(item))),
  Card: ({ children }) => children,
  Drawer: ({ open, children }) => open ? children : null,
  EmptyState: ({ title, description }) => [title, description],
  LoadingState: () => '加载中', ErrorState: () => '加载失败',
}
function runFile(rel, imports = {}, append = '') {
  const file = join(repoRoot, rel)
  const output = ts.transpileModule(readFileSync(file, 'utf8') + append, {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const mod = { exports: {} }
  vm.runInNewContext(output, { exports: mod.exports, module: mod, require(id) {
    if (id === 'react/jsx-runtime') return runtime
    if (!(id in imports)) throw new Error(`${rel}: 未登记依赖 ${id}`)
    return imports[id]
  } })
  return mod.exports
}
function hooks(values) {
  const states = [...values]
  return { useState: () => [states.shift(), () => {}], useCallback: (fn) => fn,
    useEffect: () => {}, useRef: (current) => ({ current }) }
}
const nums = runFile('packages/shared/src/formatNumber.ts')
const shared = { ...nums, formatDateTime: () => '2026-09-30 12:00' }
const errors = runFile('apps/admin/src/lib/printErrorText.ts')
const honesty = runFile('apps/admin/src/routes/orders/orderHonestyCopy.ts')
const display = runFile('apps/admin/src/routes/orders/orderDisplay.ts', { '@ai-job-print/shared': shared, './orderHonestyCopy': honesty })
const cols = runFile('apps/admin/src/routes/orders/orderColumns.tsx', {
  '@ai-job-print/ui': ui, '../../lib/printErrorText': errors, './orderDisplay': display, './orderHonestyCopy': honesty,
}).orderColumns(() => {})
for (const id of ['order', 'terminal']) {
  const column = cols.find((c) => c.id === id)
  const cell = column?.cell({ orderNo: 'ORD-20260930-962BD6AB', terminalCode: 'WALK-001' })
  if (!column || column.truncate || !column.cellClassName?.includes('whitespace-nowrap') || /truncate|line-clamp|break-/.test(cell?.props?.className ?? '')) fail(`订单${id}编号必须完整且不折行`)
}
if (cols.length !== 8 || cols.some((c) => c.id === 'channel') || !textOf(cols.find((c) => c.id === 'user')?.cell({ ownerType: 'anonymous', userLabel: '游客', channel: 'kiosk' })).includes('一体机现场')) fail('渠道必须合在用户列，保留八列')
const forbiddenBatchCopy = ['Terminal Agent 回报落库', 'resume_export', 'print_bw_page', 'print_color_page', '匿名(Kiosk)', 'diff']
function cleanText(where, tree) {
  const visible = textOf(tree)
  for (const word of forbiddenBatchCopy) if (visible.includes(word)) fail(`${where} 可见文字出现 ${word}`)
  return visible
}
for (const code of ['PRINTER_ERROR', 'PRINT_JOB_UNCONFIRMED', 'PAPER_EMPTY', 'printer_jam', 'PARTIAL_OUTPUT', 'UNKNOWN_PRINT_CODE']) {
  const order = { ownerType: 'anonymous', userLabel: '游客', amountCents: 0, currency: 'CNY', payStatus: 'paid', taskStatus: 'failed', errorCode: code, channel: 'kiosk' }
  const visible = cleanText('订单列表', cols.map((column) => column.cell(order)))
  if (visible.includes(code) || !visible.includes(errors.printErrorText(code))) fail(`订单列表未正确翻译 ${code}`)
  if (!visible.includes('¥0.00（免费）') || visible.includes('游客 · 游客')) fail('订单免费金额 / 身份文案不正确')
}
if (errors.printErrorText('UNKNOWN_PRINT_CODE') !== '打印失败（未归类）') fail('未知打印码必须显示未归类')
if (errors.printErrorText('UNKNOWN_SCAN_CODE', 'scan') !== '扫描失败（未归类）') fail('未知扫描码必须显示扫描失败（未归类）')
for (const code of ['PRINTER_ERROR', 'PAPER_EMPTY', 'printer_jam']) {
  if (errors.printErrorText(code, 'scan') !== errors.printErrorText(code)) fail(`已登记原因不得随订单类型变化：${code}`)
}
const drawer = runFile('apps/admin/src/routes/orders/OrderDetailDrawer.tsx', {
  '@ai-job-print/ui': ui, './orderDisplay': display, './orderHonestyCopy': honesty, '../../lib/printErrorText': errors,
  './OrderAftercare': { OrderAftercare: () => null }, './OrderPaymentActions': { OrderPaymentActions: () => null },
})
const scanOrder = { type: 'scan', ownerType: 'anonymous', userLabel: '游客', amountCents: 0, currency: 'CNY', payStatus: 'paid', taskStatus: 'failed', errorCode: 'UNKNOWN_SCAN_CODE', statusLogs: [{ errorCode: 'UNKNOWN_SCAN_CODE' }], print: null }
const scanListText = textOf(cols.map((column) => column.cell(scanOrder)))
const scanDetailText = textOf(drawer.OrderDetailDrawer({ controls: { detailState: 'ready', detail: scanOrder } }))
if (!scanListText.includes('扫描失败（未归类）') || !scanDetailText.includes('扫描失败（未归类）') || scanListText.includes('打印失败') || scanDetailText.includes('打印失败')) fail('扫描订单列表、详情和流转记录不得说成打印失败')
// W-105：执行真实列与详情组件，覆盖有页数、null、缺字段和指定范围。
const noPageDetail = { ...scanOrder, type: 'print', errorCode: null, statusLogs: [], print: { pageRange: null } }
const amountColumn = cols.find((column) => column.id === 'amount')
function detailText(detail) {
  return textOf(drawer.OrderDetailDrawer({ controls: { detailState: 'ready', detail } }))
}
for (const billablePages of [null, undefined]) {
  const order = { ...noPageDetail, billablePages, copies: 2 }
  if (/\d+\s*页/.test(textOf(amountColumn.cell(order)))) fail('缺计费页数时列表不得显示 0 页或推算页数')
  const visible = detailText(order)
  if (!visible.includes('计费页数 —') || !visible.includes('页范围 未记录') || visible.includes('全部页面')) fail('缺页范围和计费页数时详情必须写 — / 未记录')
}
for (const [copies, expected] of [[null, '4 页'], [1, '4 页'], [2, '4 页 × 2 份']]) {
  const visible = textOf(amountColumn.cell({ ...noPageDetail, billablePages: 4, copies }))
  if (!visible.includes(expected) || (copies !== 2 && visible.includes('×'))) fail('列表内容页数与份数必须分别展示')
}
const counted = { ...noPageDetail, billablePages: 4, copies: 2 }
// 订单级没记页范围时，前端分不出单文件（=全部页面）与多文件打包单（=各文件所选页数之和），两种都不能被说错。
for (const printTaskId of ['ptask_single', null]) {
  const text = detailText({ ...counted, printTaskId })
  if (!text.includes('计费页数 4 页') || !text.includes('页范围 未单独记录（见计费页数）') || text.includes('全部页面') || text.includes('各文件合计')) fail('没记页范围时页范围写未单独记录（见计费页数），不得断言全部页面或各文件合计')
}
for (const billablePages of [4, null]) {
  if (!detailText({ ...counted, billablePages, print: { pageRange: '1-2' } }).includes('页范围 1-2')) fail('指定页范围不得被计费页数覆盖')
}
if (display.pageRangeText('  ', 4) !== '未单独记录（见计费页数）' || display.pageRangeText('all', 4) !== '全部' || display.pageRangeText(null, null) !== '未记录') fail('空白与 all 页范围保留既有解析口径；没记范围时按有无计费页数写未单独记录 / 未记录')
console.log('  PASS W-105 原值页数 / 份数 / null / 未记录 / 未单独记录 / 指定范围真实组件展示')
if (display.orderUserText({ ownerType: 'member', userLabel: '13812345678' }).includes('13812345678')) fail('用户不得显示完整手机号')
const common = { '@ai-job-print/ui': ui, '@ai-job-print/shared': shared, '../Page': { Page: (p) => [p.title, p.subtitle, p.children] },
  '../components/FilterChip': { FilterChip: () => null }, 'lucide-react': {} }
let billingStates = []
const billingHooks = { ...hooks([]), useState: () => [billingStates.shift(), () => {}] }
const billing = runFile('apps/admin/src/routes/billing/index.tsx', {
  ...common, react: billingHooks,
  '../../services/api/adminBilling': {},
}, '\nexport { PriceConfigSection, ReconciliationSection }\n')
billingStates = ['price']
// 页头直接展开 Page，避免继续调用尚无数据的子区块。
const billingTree = billing.default()
cleanText('计费页头', [billingTree.props.title, billingTree.props.subtitle])
billingStates = [[{ serviceKey: 'resume_export', unitCents: 0, description: '测试说明', active: true }, { serviceKey: 'print_bw_page', unitCents: 20, active: true }, { serviceKey: 'print_color_page', unitCents: 50, active: false }], null, {}, {}, null]
const priceText = cleanText('价目表', billing.PriceConfigSection())
if (!priceText.includes('简历导出（每次）') || !priceText.includes('黑白打印（每页）') || !priceText.includes('彩色打印（每页）')) fail('价目表未实际渲染中文价目名')
billingStates = [{ summary: { grossPaidCents: 0, refundedCents: 0, netCents: 0, refundingCount: 0, paidOrderCount: 0, refundedOrderCount: 0 }, discrepancies: [], attention: { latePaid: [], reconciled: [] } }, null, false]
const reconciliationText = cleanText('本地对账', billing.ReconciliationSection())
if (!reconciliationText.includes('渠道账单仍需使用真实商户账单另行核对。')) fail('本地对账必须说明真实渠道账单另行核对')
const print = runFile('apps/admin/src/routes/print-scan/index.tsx', {
  ...common, react: hooks([]), 'react-router-dom': { Link: (p) => p.children }, '../../lib/printErrorText': errors,
  './CapabilityCenter': {}, './CloseUnpaidPrintTaskForm': {}, '../../services/api/printScan': {}, './PrintRetryButton': { PrintRetryButton: () => null },
}, '\nexport { taskColumns, TaskDetailBody, CommercialControls }\n')
for (const code of ['PRINTER_ERROR', 'PRINT_JOB_UNCONFIRMED', 'PAPER_EMPTY', 'printer_jam', 'PARTIAL_OUTPUT', 'UNKNOWN_PRINT_CODE']) {
  const item = { type: 'print', status: 'failed', ownerType: 'member', errorCode: code, taskId: 'ptask_test', fileName: '测试.pdf', statusLogs: [{ errorCode: code, fromStatus: 'printing', toStatus: 'failed' }], closeUnpaidEligible: false }
  const visible = cleanText('打印任务列表', print.taskColumns(() => {}).map((column) => column.cell(item)))
  if (visible.includes(code) || visible.includes(item.taskId) || !visible.includes(errors.printErrorText(code))) fail(`打印列表裸露编号或错误码 ${code}`)
  const detailText = cleanText('打印任务详情', print.TaskDetailBody({ detail: item }))
  if (detailText.includes(code) || !detailText.includes('任务编号') || !detailText.includes(errors.printErrorText(code))) fail(`任务详情未翻译 ${code}`)
}
const scanTask = { type: 'scan', status: 'failed', ownerType: 'anonymous', errorCode: 'UNKNOWN_SCAN_CODE', statusLogs: [{ errorCode: 'UNKNOWN_SCAN_CODE' }] }
for (const tree of [print.taskColumns(() => {}).map((column) => column.cell(scanTask)), print.TaskDetailBody({ detail: scanTask })]) {
  const visible = textOf(tree)
  if (!visible.includes('扫描失败（未归类）') || visible.includes('打印失败')) fail('扫描运维列表、详情和流转记录不得说成打印失败')
}
cleanText('商业化控制', print.CommercialControls())
const fileMeta = runFile('apps/admin/src/routes/files/fileMeta.ts', { '@ai-job-print/shared': shared })
const retentionMeta = runFile('apps/admin/src/routes/files/retentionMeta.ts')
let selectedFileId = null
const files = runFile('apps/admin/src/routes/files/FileTable.tsx', {
  '@ai-job-print/shared': shared, '@ai-job-print/ui': ui,
  react: { useState: () => [selectedFileId, () => {}] }, './fileMeta': fileMeta, './retentionMeta': retentionMeta,
})
for (const endUserId of [null, 'cmu_test_account']) {
  const view = fileMeta.toViewFile({ id: 'test_file', filename: '测试.pdf', sizeBytes: 0, purpose: 'print_doc', sensitiveLevel: 'normal', endUserId, uploaderId: null, expiresAt: null, deletedAt: null }, 0)
  selectedFileId = view.raw.id
  const visible = cleanText('文件列表和详情', files.FileTable({ files: [view], total: 1, page: 1, pageSize: 20 }))
  if (visible.includes('cmu_test_account')) fail('文件表不得裸露账号 ID')
  if (!visible.includes(endUserId ? '会员' : '匿名（一体机）')) fail('文件身份必须使用中文')
  for (const label of ['策略来源', '同意时间', '同意版本', '来源']) if (!visible.includes(label)) fail(`文件详情缺少 ${label}`)
}
// 页头 / 静态 JSX 的文字也检查，跳过 title 及非展示的内部键、条件比较。
for (const dir of ['orders', 'print-scan', 'billing', 'files', 'job-materials', 'import-batches']) {
  for (const file of walkTsx(join(adminRoot, 'src/routes', dir))) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    function visibleLiterals(node) {
      if (ts.isJsxAttribute(node) && ['title', 'className', 'key', 'value'].includes(node.name.getText(source))) return
      if (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
        for (const { value } of literalTexts(ts.createSourceFile(file, node.getText(source), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX))) for (const word of forbiddenBatchCopy) if (value.includes(word)) fail(`${relative(repoRoot, file)} 可见 JSX 出现 ${word}`)
      } else ts.forEachChild(node, visibleLiterals)
    }
    function findJsx(node) {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) visibleLiterals(node)
      else ts.forEachChild(node, findJsx)
    }
    findJsx(source)
  }
}
if (failures.length === 0) console.log('  PASS 第二批原组件 / 列定义：可见文案无工程词、打印原因中文、0 元如实、任务编号在详情')

console.log('\n=== 打印错误原因与服务端告警同一口径 ===')
{
  const mapSrc = readFileSync(join(repoRoot, 'apps/admin/src/lib/printErrorText.ts'), 'utf8')
  if (/kiosk\//.test(mapSrc.replace(/^\s*\/\/.*$/gm, ''))) fail('后台打印错误原因不得引用一体机源码')
  const serverSrc = readFileSync(join(repoRoot, 'services/api/src/admin-ops/derived-alerts.ts'), 'utf8')
  const block = serverSrc.match(/const PRINT_FAILED_ALERT_REASONS[^{]*\{([\s\S]*?)\n\}/)
  if (!block) fail('找不到服务端 PRINT_FAILED_ALERT_REASONS，门禁需要跟着更新')
  const serverCodes = block ? [...block[1].matchAll(/^\s*([A-Za-z_]+):/gm)].map((m) => m[1]) : []
  if (serverCodes.length < 5) fail(`服务端错误码只解析出 ${serverCodes.length} 个，解析规则可能失效`)
  for (const code of serverCodes) {
    const text = errors.printErrorText(code)
    if (text === '打印失败（未归类）' || text.includes(code)) fail(`后台缺少服务端已登记错误码的中文原因：${code}`)
  }
  if (failures.length === 0) console.log(`  PASS 服务端登记的 ${serverCodes.length} 个错误码后台都有中文原因，且不引用一体机源码`)
}

if (failures.length > 0) {
  console.error(`\n${failures.length} 项未通过`)
  process.exit(1)
}
console.log('\nverify:console-plain-copy passed')
