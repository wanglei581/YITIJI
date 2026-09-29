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

if (failures.length > 0) {
  console.error(`\n${failures.length} 项未通过`)
  process.exit(1)
}
console.log('\nverify:console-plain-copy passed')
