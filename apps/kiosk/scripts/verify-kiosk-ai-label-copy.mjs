import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// ============================================================
// verify:kiosk-ai-label-copy — 一体机 AI 可见标识与合同审查对外文案（next-tasks 3.5c）
//
// 需求来源（本门禁的每条期望都从这里取，不从当前页面输出取）：
//   · docs/reviews/2026-09-26-ai-label-copy-prompt-audit.md（下称「审计」）表一、表二，
//     以及文末「建议新增的门禁断言」第 1、3 条；
//   · docs/compliance/compliance-boundary.md §1.2 A「数字人形象与声音」。
//
// 为了让「期望来自审计」可以被机器核对，门禁运行时读审计表：先按功能名 / 文件名找到那一行，
// 确认本门禁写死的句子确实出现在那一行里，再拿这句去核对代码。审计改了口径而门禁没跟上、
// 或门禁里的句子不是审计写的，都会红。失败信息里带「表几#第几行（审计文件行号）」。
//
// 四组断言，都对着源码字符串，不启动服务、不连库：
//   A. 共享文案 packages/shared 的 AI_LABEL_COPY / COMPLIANCE_COPY 取值逐字等于审计给的句子；
//      一体机 AIGC 标识（AigcMark）与优化 / 生成页徽标都绑在这套共享文案上。
//   B. 审计列出的一体机 AI 结果面：屏上可见文字里同时有「AI 生成」和「仅供参考」，
//      挂的是审计那一行要求的那句，审计引用的旧说法已经不在。
//   C. 合同审查目录与 advisorScenes.ts 的可见文字不含「法律意见」「律师审查」「判断合同有效」「合同有效」，
//      并且用了审计给的替换句。
//   D. 语音通话面板在五态共用的页头里明说「小青是 AI 数字人，形象与声音由 AI 生成」。
//
// 「可见文字」按 TypeScript AST 取：字符串字面量、模板串、JSX 文本（按 JSX 规则折行）、
// JSX 属性值，以及对共享文案常量的引用（解析成取值）。注释不是节点，所以不算可见文字。
// 简历对照（jobFit/**、JobFit*.tsx）与岗位 / 招聘会 / 首页 / 我的 由另一路改，不在本门禁范围。
// ============================================================

const KIOSK = fileURLToPath(new URL('..', import.meta.url))
const REPO = join(KIOSK, '../..')
const AUDIT_PATH = 'docs/reviews/2026-09-26-ai-label-copy-prompt-audit.md'
const BOUNDARY_PATH = 'docs/compliance/compliance-boundary.md'
const SHARED_COPY_PATH = 'packages/shared/src/types/complianceCopy.ts'

const failures = []
let passed = 0

function check(ok, message) {
  if (ok) {
    passed += 1
    console.log(`  PASS ${message}`)
  } else {
    failures.push(message)
    console.error(`  FAIL ${message}`)
  }
}

/** 解析不到就立即红，不允许静默放行（fail-closed）。 */
function hardFail(message) {
  console.error(`verify-kiosk-ai-label-copy: ${message}`)
  process.exit(1)
}

const readRepo = (relativePath) => readFileSync(join(REPO, relativePath), 'utf8')

// ── 审计与合规文档 ─────────────────────────────────────────────────────────

const auditSource = readRepo(AUDIT_PATH)
const auditLines = auditSource.split('\n')

function parseAuditTable(heading, expectedColumns) {
  const headingIndex = auditLines.findIndex((line) => line.includes(heading))
  if (headingIndex === -1) hardFail(`${AUDIT_PATH} 找不到表格标题 ${heading}`)
  let cursor = headingIndex + 1
  while (cursor < auditLines.length && !auditLines[cursor].startsWith('|')) cursor += 1
  const header = auditLines[cursor]?.split('|').slice(1, -1).map((cell) => cell.trim()) ?? []
  if (header.join('|') !== expectedColumns.join('|')) {
    hardFail(`${heading} 表头变了（实测 ${header.join(' / ')}），先对齐本门禁的列定义`)
  }
  const rows = []
  for (let lineIndex = cursor + 2; lineIndex < auditLines.length && auditLines[lineIndex].startsWith('|'); lineIndex += 1) {
    const cells = auditLines[lineIndex].split('|').slice(1, -1).map((cell) => cell.trim())
    if (cells.length !== expectedColumns.length) hardFail(`${heading} 第 ${rows.length + 1} 行列数不对（L${lineIndex + 1}）`)
    rows.push({ table: heading, index: rows.length + 1, line: lineIndex + 1, cells })
  }
  if (rows.length === 0) hardFail(`${heading} 没有数据行`)
  return rows
}

const TABLE_ONE = parseAuditTable('**表一「AI 标识覆盖」**', ['功能', '展示或导出位置（文件:行）', '显式标识', '隐式标识', '建议'])
const TABLE_TWO = parseAuditTable('**表二「冲突文案」**', ['端', '文件:行', '原文', '问题', '建议改成'])

function tag(row, name) {
  const table = row.table.includes('表一') ? '表一' : '表二'
  return `[审计${table}#${row.index}「${name}」L${row.line}]`
}

/** 表一按「功能」列精确找行。 */
function tableOneRow(feature) {
  const row = TABLE_ONE.find((candidate) => candidate.cells[0] === feature)
  if (!row) hardFail(`审计表一没有「${feature}」这一行`)
  return { row, label: tag(row, feature), current: row.cells[2], advice: row.cells[4] }
}

/** 表二按「端 = 一体机」+「文件:行」列里的文件名找行。 */
function tableTwoRow(fileName) {
  const row = TABLE_TWO.find((candidate) => candidate.cells[0] === '一体机' && candidate.cells[1].includes(fileName))
  if (!row) hardFail(`审计表二没有一体机「${fileName}」这一行`)
  return { row, label: tag(row, fileName), current: row.cells[2], advice: row.cells[4] }
}

/** 本门禁写死的期望句必须就是审计那一行写的 —— 期望来自审计，不来自当前代码。 */
function adviceSays(auditRow, sentence) {
  check(auditRow.advice.includes(sentence), `${auditRow.label} 审计建议栏写的就是「${sentence}」`)
  return sentence
}

/** 要退场的旧说法必须是审计那一行引用过的原文。 */
function auditQuotes(auditRow, oldWording) {
  check(auditRow.current.includes(`「${oldWording}」`), `${auditRow.label} 审计原文栏引用过旧说法「${oldWording}」`)
  return oldWording
}

const boundaryLines = readRepo(BOUNDARY_PATH).split('\n')
const digitalHumanLineIndex = boundaryLines.findIndex((line) => line.startsWith('| 数字人形象与声音 |'))
if (digitalHumanLineIndex === -1) hardFail(`${BOUNDARY_PATH} §1.2 A 找不到「数字人形象与声音」行`)
const DIGITAL_HUMAN_TAG = `[compliance-boundary §1.2 A「数字人形象与声音」L${digitalHumanLineIndex + 1}]`

const bannedRuleLineIndex = auditLines.findIndex((line) => line.startsWith('3. 合同审查对外文案'))
if (bannedRuleLineIndex === -1) hardFail(`${AUDIT_PATH}「建议新增的门禁断言」找不到第 3 条（合同审查对外文案）`)
const BANNED_RULE_TAG = `[审计「建议新增的门禁断言」第 3 条 L${bannedRuleLineIndex + 1}]`

// ── TypeScript AST 工具 ──────────────────────────────────────────────────

function parse(absolutePath) {
  const kind = absolutePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(absolutePath, readFileSync(absolutePath, 'utf8'), ts.ScriptTarget.Latest, true, kind)
}

function unwrap(expression) {
  let current = expression
  while (current && (ts.isAsExpression(current) || ts.isParenthesizedExpression(current) || ts.isSatisfiesExpression(current))) {
    current = current.expression
  }
  return current
}

function findConstInitializer(sourceFile, name) {
  let found = null
  const visit = (node) => {
    if (found) return
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      found = node.initializer
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function stringObject(sourceFile, name) {
  const initializer = unwrap(findConstInitializer(sourceFile, name))
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) return null
  const map = new Map()
  for (const property of initializer.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    if (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name)) continue
    const value = unwrap(property.initializer)
    map.set(property.name.text, ts.isStringLiteralLike(value) ? value.text : null)
  }
  return map
}

// ── A. 共享文案 ──────────────────────────────────────────────────────────

const sharedSource = parse(join(REPO, SHARED_COPY_PATH))
const SHARED = {
  AI_LABEL_COPY: stringObject(sharedSource, 'AI_LABEL_COPY'),
  COMPLIANCE_COPY: stringObject(sharedSource, 'COMPLIANCE_COPY'),
}
for (const [name, map] of Object.entries(SHARED)) {
  if (!map) hardFail(`${SHARED_COPY_PATH} 找不到 export const ${name} 对象字面量`)
}

function isSharedAccess(expression, objectName, key) {
  const node = unwrap(expression)
  return Boolean(
    node &&
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === objectName &&
      (key === undefined || node.name.text === key),
  )
}

function resolveText(expression, bindings) {
  const node = unwrap(expression)
  if (!node) return null
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text
    for (const span of node.templateSpans) text += (resolveText(span.expression, bindings) ?? '') + span.literal.text
    return text
  }
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && SHARED[node.expression.text]) {
    return SHARED[node.expression.text].get(node.name.text) ?? null
  }
  if (ts.isIdentifier(node) && Object.hasOwn(bindings, node.text)) return bindings[node.text]
  return null
}

// AigcMark 显示的是 AiEvidence.tsx 的 AIGC_MARK_TEXT，它必须绑在共享底句上。
const aiEvidenceSource = parse(join(KIOSK, 'src/ai/AiEvidence.tsx'))
const aigcMarkInitializer = findConstInitializer(aiEvidenceSource, 'AIGC_MARK_TEXT')
const AIGC_MARK_TEXT = aigcMarkInitializer ? resolveText(aigcMarkInitializer, {}) : null

/** JSX 文本按 JSX 规则折行：带换行的空白收成一个空格，首尾整行空白去掉。 */
function normalizeJsxText(raw) {
  const lines = raw.split(/\r?\n/)
  if (lines.length === 1) return raw
  return lines
    .map((line, index) => {
      let text = line
      if (index > 0) text = text.replace(/^[ \t]+/, '')
      if (index < lines.length - 1) text = text.replace(/[ \t]+$/, '')
      return text
    })
    .filter((text) => text.length > 0)
    .join(' ')
}

function jsxTagName(node) {
  const opening = ts.isJsxElement(node) ? node.openingElement : node
  return opening.tagName.getText()
}

function jsxTextContent(node, bindings) {
  if (ts.isJsxText(node)) return normalizeJsxText(node.text)
  if (ts.isJsxExpression(node)) return node.expression ? (resolveText(node.expression, bindings) ?? '') : ''
  if (ts.isJsxElement(node) || ts.isJsxFragment(node)) return node.children.map((child) => jsxTextContent(child, bindings)).join('')
  if (ts.isJsxSelfClosingElement(node)) return jsxTagName(node) === 'AigcMark' ? (AIGC_MARK_TEXT ?? '') : ''
  return ''
}

/**
 * 收集一段源码（整文件或某个 JSX 子树）里用户看得到的文字，以及它引用了哪些共享文案键、渲染了哪些组件。
 *
 * - `units`：拼好的文字单元（整个 JSX 元素的文字、整条模板串、属性值…），用来判断「有没有」。
 *   同一处文字会出现在多个单元里（外层元素包含内层），所以**不能拿 units 计数**。
 * - `sites`：每个源码位置只记一次的叶子（字符串、模板片段、JSX 文本、共享文案引用、绑定常量、AigcMark），
 *   用来判断「出现了几处」。
 */
function collectVisible(root, bindings = {}) {
  const units = []
  const sites = []
  const sharedRefs = []
  const tags = []
  const site = (node, text) => {
    if (text) sites.push({ pos: node.getStart(), text })
  }
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isLiteralTypeNode(node)) return
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      units.push(node.text)
      site(node, node.text)
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      site(node, node.text)
    } else if (ts.isTemplateExpression(node)) {
      units.push(resolveText(node, bindings) ?? '')
    } else if (ts.isJsxText(node)) {
      site(node, normalizeJsxText(node.text).trim())
    } else if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && SHARED[node.expression.text]) {
      sharedRefs.push(`${node.expression.text}.${node.name.text}`)
      const value = SHARED[node.expression.text].get(node.name.text)
      if (typeof value === 'string') {
        units.push(value)
        site(node, value)
      }
    } else if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      units.push(jsxTextContent(node, bindings))
    } else if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
      const value = resolveText(node.initializer.expression, bindings)
      if (value) units.push(value)
    } else if (ts.isJsxExpression(node) && node.expression && ts.isIdentifier(node.expression) && Object.hasOwn(bindings, node.expression.text)) {
      units.push(bindings[node.expression.text])
      site(node, bindings[node.expression.text])
    }
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const name = node.tagName.getText()
      tags.push(name)
      if (name === 'AigcMark' && AIGC_MARK_TEXT) {
        units.push(AIGC_MARK_TEXT)
        site(node, AIGC_MARK_TEXT)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(root)
  return { units: units.filter((unit) => unit.length > 0), sites, sharedRefs, tags }
}

const visibleCache = new Map()
function visibleOf(relativeKioskPath, bindings = {}) {
  const key = `${relativeKioskPath}::${JSON.stringify(bindings)}`
  if (!visibleCache.has(key)) visibleCache.set(key, collectVisible(parse(join(KIOSK, relativeKioskPath)), bindings))
  return visibleCache.get(key)
}

const AI_GENERATED = 'AI 生成'
const FOR_REFERENCE = '仅供参考'

console.log('\n=== 一体机 AI 可见标识与合同审查对外文案（next-tasks 3.5c）===')
console.log('\n-- A. 共享文案取值逐字来自审计 --')

const diagnosisRow = tableOneRow('简历诊断（屏）')
const optimizeRow = tableOneRow('简历优化对照（屏）')
const careerRow = tableOneRow('职业规划（屏）')
const selfAssessRow = tableOneRow('自我探索（屏）')
const interviewReportRow = tableOneRow('模拟面试报告（一体机）')
const interviewSessionRow = tableOneRow('面试进行中')
const assistantRow = tableOneRow('AI 助手（一体机对话）')
const cockpitRow = tableOneRow('顾问作业舱 / 语音条')
const contractRow = tableOneRow('合同审查（一体机 + PDF）')
const contractHomeRow = tableTwoRow('ContractReviewHomePage.tsx')
const contractResultRow = tableTwoRow('ContractReviewResultPage.tsx')
const contractProcessingRow = tableTwoRow('ContractReviewProcessingPage.tsx')
const advisorScenesRow = tableTwoRow('advisorScenes.ts')

const EXPECTED_AI_LABELS = {
  BASE: { sentence: adviceSays(assistantRow, 'AI 生成，仅供参考'), source: assistantRow.label },
  RESUME_DIAGNOSIS: { sentence: adviceSays(diagnosisRow, 'AI 生成，仅供参考，请对照原文核对'), source: diagnosisRow.label },
  RESUME_OPTIMIZE: { sentence: adviceSays(optimizeRow, 'AI 生成，仅供参考，请自行核对'), source: optimizeRow.label },
  INTERVIEW_REPORT: { sentence: adviceSays(interviewReportRow, 'AI 生成，仅供参考，只用于本人练习复盘'), source: interviewReportRow.label },
  INTERVIEW_SESSION: { sentence: adviceSays(interviewSessionRow, '题目由 AI 生成，仅供参考'), source: interviewSessionRow.label },
  CONTRACT_REVIEW_RESULT: { sentence: adviceSays(contractResultRow, '本结果由 AI 生成，仅供参考，只提示需要核对的条款'), source: contractResultRow.label },
}
// 职业规划与作业舱的建议栏说的是「同一句」，这句就是底句。
adviceSays(careerRow, EXPECTED_AI_LABELS.BASE.sentence)
check(cockpitRow.advice.includes('同一句'), `${cockpitRow.label} 审计要求语音条与作业舱用同一句`)
check(selfAssessRow.advice === '保持', `${selfAssessRow.label} 审计结论是「保持」现有标识`)
check(contractRow.advice.includes('保留 AI 标识'), `${contractRow.label} 审计要求合同审查保留 AI 标识`)

const DIGITAL_HUMAN_SENTENCE = '小青是 AI 数字人，形象与声音由 AI 生成'
check(boundaryLines[digitalHumanLineIndex].includes(`「${DIGITAL_HUMAN_SENTENCE}」`), `${DIGITAL_HUMAN_TAG} 合规表写的就是「${DIGITAL_HUMAN_SENTENCE}」`)

for (const [key, { sentence, source }] of Object.entries(EXPECTED_AI_LABELS)) {
  const actual = SHARED.AI_LABEL_COPY.get(key)
  check(actual === sentence, `${source} AI_LABEL_COPY.${key} 逐字等于「${sentence}」（实测 ${JSON.stringify(actual)}）`)
  check(
    typeof actual === 'string' && actual.includes(AI_GENERATED) && actual.includes(FOR_REFERENCE),
    `${source} AI_LABEL_COPY.${key} 同时含「${AI_GENERATED}」与「${FOR_REFERENCE}」`,
  )
}
check(
  SHARED.AI_LABEL_COPY.get('DIGITAL_HUMAN') === DIGITAL_HUMAN_SENTENCE,
  `${DIGITAL_HUMAN_TAG} AI_LABEL_COPY.DIGITAL_HUMAN 逐字等于「${DIGITAL_HUMAN_SENTENCE}」`,
)

const CONTRACT_SCOPE = adviceSays(contractHomeRow, '仅作条款风险提示，请自行核对原文')
const CONTRACT_PROCESSING = adviceSays(contractProcessingRow, '本次结果仅作风险提示，请自行核对原文')
const ADVISOR_PERSONAL_CHECK = adviceSays(advisorScenesRow, '仅供个人核对，不代替专业人士判断')
check(
  SHARED.COMPLIANCE_COPY.get('KIOSK_CONTRACT_REVIEW_SCOPE') === CONTRACT_SCOPE,
  `${contractHomeRow.label} COMPLIANCE_COPY.KIOSK_CONTRACT_REVIEW_SCOPE 逐字等于「${CONTRACT_SCOPE}」`,
)
check(
  SHARED.COMPLIANCE_COPY.get('KIOSK_CONTRACT_REVIEW_PROCESSING') === CONTRACT_PROCESSING,
  `${contractProcessingRow.label} COMPLIANCE_COPY.KIOSK_CONTRACT_REVIEW_PROCESSING 逐字等于「${CONTRACT_PROCESSING}」`,
)

// AigcMark：常量绑在共享底句上，组件真的把它渲染出来（不是只声明）。
check(
  isSharedAccess(aigcMarkInitializer, 'AI_LABEL_COPY', 'BASE'),
  `${careerRow.label} AiEvidence.tsx 的 AIGC_MARK_TEXT 绑定 AI_LABEL_COPY.BASE（AigcMark 与各页说同一句）`,
)
let aigcMarkRendersText = false
const findAigcRender = (node) => {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'AigcMark') {
    const inner = (child) => {
      if (ts.isJsxExpression(child) && child.expression && ts.isIdentifier(child.expression) && child.expression.text === 'AIGC_MARK_TEXT') aigcMarkRendersText = true
      ts.forEachChild(child, inner)
    }
    inner(node)
  }
  ts.forEachChild(node, findAigcRender)
}
findAigcRender(aiEvidenceSource)
check(aigcMarkRendersText, `${careerRow.label} AigcMark 组件把 {AIGC_MARK_TEXT} 渲染到屏上`)

// 优化 / 生成预览页徽标：AIGC_SCREEN_MARK 绑在共享句上，徽标组件把它渲染出来。
const deliverConstants = parse(join(KIOSK, 'src/pages/resume/components/resume-deliver/constants.ts'))
check(
  isSharedAccess(findConstInitializer(deliverConstants, 'AIGC_SCREEN_MARK'), 'AI_LABEL_COPY', 'RESUME_OPTIMIZE'),
  `${optimizeRow.label} resume-deliver/constants.ts 的 AIGC_SCREEN_MARK 绑定 AI_LABEL_COPY.RESUME_OPTIMIZE`,
)
const AIGC_SCREEN_MARK = resolveText(findConstInitializer(deliverConstants, 'AIGC_SCREEN_MARK'), {}) ?? ''

// ── B. AI 结果面 ─────────────────────────────────────────────────────────

console.log('\n-- B. 审计列出的一体机 AI 结果面挂同一套标识 --')

/**
 * @typedef Surface
 * @property {{label: string, current: string}} audit 审计行
 * @property {string} file 一体机源码（相对 apps/kiosk）
 * @property {string} [labelKey] 该面必须引用的 AI_LABEL_COPY 键
 * @property {boolean} [aigcMark] 该面必须渲染 <AigcMark />
 * @property {Record<string, string>} [bindings] 该面 JSX 里渲染的本地常量 → 取值
 * @property {string[]} [retired] 审计原文栏引用、必须退场的旧说法
 */
/** @type {Surface[]} */
const SURFACES = [
  { audit: diagnosisRow, file: 'src/pages/resume/ResumeReportPage.tsx', labelKey: 'RESUME_DIAGNOSIS', retired: ['供本人修改简历时参考'] },
  { audit: optimizeRow, file: 'src/pages/resume/components/resume-compare/ResumeCompareCard.tsx', labelKey: 'RESUME_OPTIMIZE', retired: ['AI 生成，仅供本人核对'] },
  {
    audit: optimizeRow,
    file: 'src/pages/resume/components/resume-deliver/ResumeAigcBadge.tsx',
    bindings: { AIGC_SCREEN_MARK },
    rendersBinding: 'AIGC_SCREEN_MARK',
    retired: ['请自行核对后再带走'],
  },
  { audit: careerRow, file: 'src/pages/resume/CareerPlanPage.tsx', aigcMark: true },
  { audit: careerRow, file: 'src/pages/resume/components/career-plan/CareerPlanSection.tsx', labelKey: 'BASE' },
  { audit: selfAssessRow, file: 'src/pages/resume/SelfAssessmentFlow.tsx', aigcMark: true },
  { audit: interviewReportRow, file: 'src/pages/interview/InterviewReportPage.tsx', labelKey: 'INTERVIEW_REPORT', retired: ['仅供本人面试练习'] },
  { audit: interviewSessionRow, file: 'src/pages/interview/session/InterviewSessionPanels.tsx', labelKey: 'INTERVIEW_SESSION', retired: ['模拟练习，仅供参考'] },
  { audit: assistantRow, file: 'src/pages/assistant/AssistantPage.tsx', labelKey: 'BASE' },
  { audit: cockpitRow, file: 'src/pages/assistant/AdvisorCockpit.tsx', aigcMark: true },
  { audit: cockpitRow, file: 'src/pages/assistant/AssistantCallPanel.tsx', labelKey: 'BASE', retired: ['AI 内容仅供参考'] },
  { audit: contractResultRow, file: 'src/pages/contract-review/ContractReviewResultPage.tsx', labelKey: 'CONTRACT_REVIEW_RESULT' },
]

for (const surface of SURFACES) {
  const { units, sharedRefs, tags } = visibleOf(surface.file, surface.bindings)
  const where = `${surface.audit.label} ${surface.file}`

  // 题面要求：屏上可见文字里同时出现「AI 生成」和「仅供参考」，而且在同一句里。
  check(
    units.some((unit) => unit.includes(AI_GENERATED) && unit.includes(FOR_REFERENCE)),
    `${where} 可见文字里有一句同时含「${AI_GENERATED}」与「${FOR_REFERENCE}」`,
  )

  if (surface.labelKey) {
    const sentence = EXPECTED_AI_LABELS[surface.labelKey].sentence
    check(sharedRefs.includes(`AI_LABEL_COPY.${surface.labelKey}`), `${where} 引用共享标识 AI_LABEL_COPY.${surface.labelKey}`)
    check(units.some((unit) => unit.includes(sentence)), `${where} 屏上是审计要求的那句「${sentence}」`)
  }
  if (surface.aigcMark) {
    check(tags.includes('AigcMark'), `${where} 渲染 <AigcMark />（标识为「${AIGC_MARK_TEXT}」）`)
  }
  if (surface.rendersBinding) {
    const sentence = EXPECTED_AI_LABELS.RESUME_OPTIMIZE.sentence
    check(units.some((unit) => unit.includes(sentence)), `${where} 徽标渲染 {${surface.rendersBinding}}，屏上是「${sentence}」`)
  }
  for (const oldWording of surface.retired ?? []) {
    auditQuotes(surface.audit, oldWording)
    check(!units.some((unit) => unit.includes(oldWording)), `${where} 审计引用的旧说法「${oldWording}」已退场`)
  }
}

// ── C. 合同审查对外文案 ─────────────────────────────────────────────────

console.log('\n-- C. 合同审查与顾问场景不写「法律意见」类说法 --')

const BANNED_LEGAL_PHRASES = ['法律意见', '律师审查', '判断合同有效', '合同有效']
for (const phrase of BANNED_LEGAL_PHRASES) {
  check(auditLines[bannedRuleLineIndex].includes(`「${phrase}」`), `${BANNED_RULE_TAG} 审计把「${phrase}」列为合同审查对外禁用说法`)
}

const contractDir = 'src/pages/contract-review'
const contractFiles = readdirSync(join(KIOSK, contractDir))
  .filter((name) => /\.(ts|tsx)$/.test(name))
  .sort()
  .map((name) => `${contractDir}/${name}`)
check(contractFiles.length >= 3, `${BANNED_RULE_TAG} 合同审查目录至少扫到三页（实测 ${contractFiles.length} 个源文件）`)

const LEGAL_SCAN_FILES = [...contractFiles, 'src/pages/assistant/advisorScenes.ts']
for (const file of LEGAL_SCAN_FILES) {
  const { units } = visibleOf(file)
  // 比对前去掉空白：JSX 折行不能把「法律 意见」拆开放行。
  const flattened = units.map((unit) => unit.replace(/\s+/g, ''))
  for (const phrase of BANNED_LEGAL_PHRASES) {
    const hit = flattened.find((unit) => unit.includes(phrase))
    check(!hit, `${BANNED_RULE_TAG} ${file} 可见文字不含「${phrase}」${hit ? `（命中：${hit.slice(0, 40)}…）` : ''}`)
  }
}

// 审计这一行引用了两处（页头副标题与知情同意首句），按源码位置计数，一处只算一次。
const homeVisible = visibleOf(`${contractDir}/ContractReviewHomePage.tsx`)
const homeScopeSites = homeVisible.sites.filter((entry) => entry.text.includes(CONTRACT_SCOPE)).length
check(homeScopeSites >= 2, `${contractHomeRow.label} 首页页头与知情同意两处都写「${CONTRACT_SCOPE}」（实测 ${homeScopeSites} 处）`)
check(
  visibleOf(`${contractDir}/ContractReviewProcessingPage.tsx`).units.some((unit) => unit.includes(CONTRACT_PROCESSING)),
  `${contractProcessingRow.label} 分析中页写「${CONTRACT_PROCESSING}」`,
)
check(
  visibleOf(`${contractDir}/ContractReviewResultPage.tsx`).units.some((unit) => unit.includes(EXPECTED_AI_LABELS.CONTRACT_REVIEW_RESULT.sentence)),
  `${contractResultRow.label} 结果页免责横幅写「${EXPECTED_AI_LABELS.CONTRACT_REVIEW_RESULT.sentence}」`,
)

// 顾问场景：审计引用了 Offer 对比（欢迎语与免责）和 HR 知识问答（免责）。
const scenesSource = parse(join(KIOSK, 'src/pages/assistant/advisorScenes.ts'))
const scenes = unwrap(findConstInitializer(scenesSource, 'TOOLBOX_ASSISTANT_SCENES'))
if (!scenes || !ts.isObjectLiteralExpression(scenes)) hardFail('advisorScenes.ts 找不到 TOOLBOX_ASSISTANT_SCENES 对象字面量')
function sceneField(sceneKey, field) {
  const scene = scenes.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText() === sceneKey)
  if (!scene || !ts.isObjectLiteralExpression(unwrap(scene.initializer))) return null
  const entry = unwrap(scene.initializer).properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText() === field)
  return entry ? resolveText(entry.initializer, {}) : null
}
for (const [sceneKey, field] of [['offer_compare', 'welcome'], ['offer_compare', 'disclaimer'], ['hr_qa', 'disclaimer']]) {
  const text = sceneField(sceneKey, field)
  check(
    typeof text === 'string' && text.includes(ADVISOR_PERSONAL_CHECK),
    `${advisorScenesRow.label} ${sceneKey}.${field} 写「${ADVISOR_PERSONAL_CHECK}」`,
  )
}

// ── D. 数字人披露 ────────────────────────────────────────────────────────

console.log('\n-- D. 语音通话明说小青是 AI 数字人 --')

const callPanelPath = 'src/pages/assistant/AssistantCallPanel.tsx'
const callPanelSource = parse(join(KIOSK, callPanelPath))
let voiceHeader = null
const findHeader = (node) => {
  if (voiceHeader) return
  if (ts.isJsxElement(node) && jsxTagName(node) === 'header') {
    const className = node.openingElement.attributes.properties.find(
      (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === 'className',
    )
    if (className?.initializer && ts.isStringLiteral(className.initializer) && className.initializer.text.split(/\s+/).includes('assistant-voice-header')) {
      voiceHeader = node
      return
    }
  }
  ts.forEachChild(node, findHeader)
}
findHeader(callPanelSource)
check(Boolean(voiceHeader), `${DIGITAL_HUMAN_TAG} ${callPanelPath} 找到语音对话框页头 <header className="assistant-voice-header">`)

if (voiceHeader) {
  const headerVisible = collectVisible(voiceHeader)
  check(
    headerVisible.sharedRefs.includes('AI_LABEL_COPY.DIGITAL_HUMAN'),
    `${DIGITAL_HUMAN_TAG} 语音对话框页头引用 AI_LABEL_COPY.DIGITAL_HUMAN`,
  )
  check(
    headerVisible.units.some((unit) => unit.includes(DIGITAL_HUMAN_SENTENCE)),
    `${DIGITAL_HUMAN_TAG} 语音对话框页头写「${DIGITAL_HUMAN_SENTENCE}」`,
  )
  // 页头必须五态共用：从页头往上到 return 之间不能夹条件渲染，否则某一态会看不到披露。
  let conditional = null
  for (let parent = voiceHeader.parent; parent && !ts.isReturnStatement(parent); parent = parent.parent) {
    if (ts.isConditionalExpression(parent) || (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)) {
      conditional = parent
      break
    }
  }
  check(!conditional, `${DIGITAL_HUMAN_TAG} 披露所在页头不在条件分支里（开麦确认 / 连接中 / 通话中 / 只听 / 失败五态都看得到）`)
}

// ── 汇总 ────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\nverify-kiosk-ai-label-copy failed: ${failures.length} FAIL, ${passed} PASS`)
  process.exit(1)
}
console.log(`\nverify-kiosk-ai-label-copy passed (${passed} checks, ${SURFACES.length} AI result surfaces, ${LEGAL_SCAN_FILES.length} files scanned for legal wording)`)
