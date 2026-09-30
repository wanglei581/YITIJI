// 两个后台的用户可见文案不得带工程词、Markdown 星号或原始状态码。
// 只扫 .tsx 的字符串字面量与 JSX 文本，跳过注释。
// 另外真执行 auditActionLabels.ts：审计契约里的每个动作都有中文名，未知动作显示「其他操作」。

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

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

// 第 3 批：只看可见文本（title 与注释不算），技术状态判断和映射键不误判为正文。
console.log('\n=== AI 与内容来源批次可见文案 ===')
const contentRoutes = ['ai-services', 'ai-config', 'policy-sources', 'job-sources', 'fair-sources', 'fairs', 'companies']
const partnerContentRoutes = ['policy', 'jobs', 'fairs', 'companies']
const contentFiles = [
  ...contentRoutes.flatMap((route) => walkTsx(join(adminRoot, 'src/routes', route))),
  ...partnerContentRoutes.flatMap((route) => walkTsx(join(repoRoot, 'apps/partner/src/routes', route))),
]
const contentForbidden = ['元数据日志', 'Provider 状态', 'AI_PAUSED', 'MAINTENANCE_MODE', '运行链路消费', 'planned', 'parseResume', 'chatAssistant', 'ServiceUnavailableException', 'AI_PROVIDER_ERROR', 'ready', 'partial', 'insufficient', '（须在说明中写清）']
function contentVisibleLiterals(sourceFile) {
  const texts = []
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(sourceFile) === 'title') return
    if (ts.isJsxText(node)) texts.push(node.text)
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      let visible = false
      let internal = false
      for (let parent = node.parent; parent; parent = parent.parent) {
        // 比较用的状态码/内部标识不是展示文字，右侧结果分支仍照常扫描。
        if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(parent.operatorToken.kind)) internal = true
        if (ts.isJsxAttribute(parent) || ts.isJsxExpression(parent)) visible = true
      }
      if (visible && !internal) texts.push(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return texts.join('\n')
}
for (const file of contentFiles) {
  const source = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const visible = contentVisibleLiterals(sf)
  for (const word of contentForbidden) if (visible.includes(word)) fail(`${relative(repoRoot, file)} 第3批正文出现「${word}」`)
}

// 真执行显示映射与表格，再展开真实公共组件；不读取 title 当可见文字。
const batchRequire = createRequire(join(repoRoot, 'packages/ui/package.json'))
const fragment = Symbol.for('react.fragment')
const jsx = (type, props) => ({ type, props: props ?? {} })
const jsxRuntime = { jsx, jsxs: jsx, Fragment: fragment }
const batchCache = new Map()
function batchLoad(file) {
  if (batchCache.has(file)) return batchCache.get(file)
  const module = { exports: {} }
  batchCache.set(file, module.exports)
  const output = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  vm.runInNewContext(output, { module, exports: module.exports, console, require(id) {
    if (id === 'react/jsx-runtime') return jsxRuntime
    if (id === 'lucide-react') return new Proxy({}, { get: () => () => null })
    if (id === '@ai-job-print/shared') return {
      ...batchLoad(join(repoRoot, 'packages/shared/src/formatDateTime.ts')),
      ...batchLoad(join(repoRoot, 'packages/shared/src/formatNumber.ts')),
      ...batchLoad(join(repoRoot, 'packages/shared/src/types/admin.ts')),
    }
    if (id === '@ai-job-print/ui') return Object.assign({}, ...['Card', 'ConsoleTable', 'StatusBadge'].map((name) => batchLoad(join(repoRoot, `packages/ui/src/components/${name}.tsx`))))
    if (id.startsWith('.')) {
      const base = join(dirname(file), id)
      const path = ['.ts', '.tsx'].map((ext) => base + ext).find((candidate) => { try { return statSync(candidate).isFile() } catch { return false } })
      if (!path) throw new Error(`门禁无法加载 ${file} 的 ${id}`)
      return batchLoad(path)
    }
    return batchRequire(id)
  } }, { filename: file })
  return module.exports
}
function batchNodes(node) {
  if (node == null || typeof node === 'boolean') return []
  if (Array.isArray(node)) return node.flatMap(batchNodes)
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (node.type === fragment) return batchNodes(node.props.children)
  if (typeof node.type === 'function') return batchNodes(node.type(node.props))
  if (typeof node.type !== 'string') throw new Error(`未支持的渲染节点 ${String(node.type)}`)
  return [{ ...node, children: batchNodes(node.props.children) }]
}
function batchText(nodes) { return nodes.map((node) => typeof node === 'string' ? node : batchText(node.children)).join('') }
function allBatchNodes(nodes) { return nodes.flatMap((node) => typeof node === 'string' ? [] : [node, ...allBatchNodes(node.children)]) }
function assertBatchText(nodes, location) {
  const text = batchText(nodes)
  for (const word of contentForbidden) assert.ok(!text.includes(word), `${location} 可见渲染含「${word}」`)
  return text
}
try {
  const { AiLogsTable } = batchLoad(join(adminRoot, 'src/routes/ai-services/AiLogsTable.tsx'))
  const props = { logs: [
    { taskId: 'task-private-1', operation: 'parseResume', provider: 'llm:deepseek:deepseek-v4-flash', status: 'failed', errorCode: 'AI_PROVIDER_ERROR', latencyMs: 1234, createdAt: '2026-09-29T11:45:00Z' },
    { taskId: 'task-private-2', operation: 'chatAssistant', provider: 'llm:deepseek:deepseek-v4-flash', status: 'failed', errorCode: 'ServiceUnavailableException', latencyMs: 20, createdAt: '2026-09-29T11:45:00Z' },
  ], logsTotal: 2, logsOffset: 0, logsLoading: false, logsError: null, opFilter: 'all', statusFilter: 'all', applyOpFilter() {}, applyStatusFilter() {}, setLogsOffset() {} }
  const nodes = batchNodes(AiLogsTable(props))
  const text = assertBatchText(nodes, 'AI 调用日志')
  for (const phrase of ['简历解析', 'AI 对话', 'DeepSeek · deepseek-v4-flash', '模型厂商服务异常', 'AI 服务暂时不可用']) assert.ok(text.includes(phrase), `日志缺少中文展示 ${phrase}`)
  assert.ok(!text.includes('task-private-1'), '列表不能直接露出任务 ID')
  const titles = allBatchNodes(nodes).map((node) => node.props.title ?? '').join('\n')
  for (const raw of ['task-private-1', 'parseResume', 'AI_PROVIDER_ERROR', 'ServiceUnavailableException', 'llm:deepseek:deepseek-v4-flash']) assert.ok(titles.includes(raw), `悬停丢失原值 ${raw}`)
  assert.ok(allBatchNodes(nodes).some((node) => node.type === 'th' && batchText(node.children) === '服务类型'))
  assertBatchText(batchNodes(AiLogsTable({ ...props, logs: [], logsTotal: 0 })), '空日志')
  const { PolicyEmergencyNote } = batchLoad(join(repoRoot, 'apps/partner/src/routes/policy/PolicyEmergencyNote.tsx'))
  const note = batchText(batchNodes(PolicyEmergencyNote({ row: { emergencyReasonCode: 'other', emergencyReasonText: '等待机构核对', emergencyTakedownAt: '2026-09-29T11:45:00Z' } })))
  assert.ok(note.includes('事由：其他'), '政策下架展示须用「其他」')
  assert.ok(!note.includes('须在说明中写清'), '表单提示不能混入事由展示')
  for (const phrase of ['不能再编辑、审核或发布', '不能恢复', '由本机构审核发布']) assert.ok(note.includes(phrase), `冻结说明丢失 ${phrase}`)
  // 表单提示原样保留，与结果展示是两种用途。
  const reasons = batchLoad(join(repoRoot, 'packages/shared/src/types/admin.ts')).RECRUITMENT_EMERGENCY_REASON_LABELS
  assert.equal(reasons.other, '其他（须在说明中写清）')
  console.log('  PASS 第3批可见正文无工程词；日志中文与悬停原值、政策冻结展示与表单提示都保留')
} catch (error) { fail(error.message) }

if (failures.length > 0) {
  console.error(`\n${failures.length} 项未通过`)
  process.exit(1)
}
console.log('\nverify:console-plain-copy passed')
