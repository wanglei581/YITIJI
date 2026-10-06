#!/usr/bin/env node
/**
 * verify:kiosk-unattended-copy
 *
 * 2026-10-04：一体机现场不安排工作人员。apps/kiosk/src 的字符串字面量与 JSX 文本
 * （不含注释）不得再出现禁用说法。TypeScript 的 .text 会解开 \u 转义，所以转义写不出门。
 *
 * 取件凭证码白名单已清空（方案②，2026-10-06）。
 * 只留 A 包标准句 6 点名不改的注销 / 复制个人信息三句：那三句含「找现场工作人员」，
 * 任务包禁止改写，所以不能从扫描里消失。上限 3，不许增加。
 *
 * 另外两道能静态判的条件：
 * - 金额为 0 / free 的分支里出现「退款」就红。
 * - 「换一台机器」只许出现在 otherOnlineTerminalNearby 为真的分支里。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const scanRoot = join(repoRoot, 'apps/kiosk/src')

const FORBIDDEN = [
  '联系现场工作人员',
  '联系工作人员',
  '找现场工作人员',
  '找工作人员',
  '交给工作人员',
  '工作人员核查',
  '向工作人员出示',
  '向现场工作人员出示',
  '出示给现场工作人员',
  '出示给工作人员',
  '去服务台',
  '缺纸时一体机会自动停止接单',
  '找人补纸',
  '取件凭证码',
]

/** A 包标准句 6：PR #1257 定稿，本任务不改。上限 3。 */
const CLOSURE_ALLOWLIST_CAP = 3
const CLOSURE_ALLOWLIST = [
  { file: 'apps/kiosk/src/pages/profile/me/MySettingsPage.tsx', text: '注销账号、复制个人信息，请找现场工作人员，或按《隐私政策》里的电话、邮箱联系我们申请。我们核实是你本人后，15 个工作日内处理。' },
  { file: 'apps/kiosk/src/pages/profile/ProfilePage.tsx', text: '当前可撤回 AI 使用授权；注销账号、复制个人信息，请找现场工作人员或按《隐私政策》的联系方式申请。' },
  { file: 'apps/kiosk/src/pages/profile/me/MyPrivacyRequestsPage.tsx', text: '当前可撤回 AI 使用授权；注销账号、复制个人信息，请找现场工作人员或按《隐私政策》的联系方式申请。' },
]

const ALLOWLIST = [...CLOSURE_ALLOWLIST]

function squash(text) {
  return text.replace(/\s+/g, '')
}

function allowed(rel, text) {
  const compact = squash(text)
  return ALLOWLIST.some((entry) => entry.file === rel && compact.includes(squash(entry.text)))
}

function forbiddenIn(text) {
  return FORBIDDEN.filter((phrase) => text.includes(phrase))
}

function consider(rel, text, line, hits) {
  const phrases = forbiddenIn(text)
  if (phrases.length === 0) return
  if (allowed(rel, text)) {
    hits.allowed += 1
    const compact = squash(text)
    for (const entry of ALLOWLIST) {
      if (entry.file === rel && compact.includes(squash(entry.text))) hits.used.add(entry)
    }
    return
  }
  hits.violations.push({ rel, line, phrases, text: text.replace(/\s+/g, ' ').trim().slice(0, 180) })
}

/** IfStatement 的条件是 expression；三元表达式的条件才是 condition。 */
function branchCondition(node) {
  return ts.isIfStatement(node) ? node.expression : node.condition
}

function conditionSource(sf, node) {
  return sf.text.slice(node.getStart(sf), node.getEnd())
}

function literalHas(node, needle) {
  let found = false
  const visit = (current) => {
    if (found) return
    if (ts.isIdentifier(current) && current.text === 'refundApplyLine' && needle === '退款') {
      found = true
      return
    }
    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current) || ts.isJsxText(current)) {
      if (current.text.includes(needle)) found = true
      return
    }
    if (ts.isTemplateHead(current) || ts.isTemplateMiddle(current) || ts.isTemplateTail(current)) {
      if (current.text.includes(needle)) found = true
    }
    ts.forEachChild(current, visit)
  }
  visit(node)
  return found
}

function isFreeCondition(src) {
  return /(?:amountCents|amount|flowAmountCents)\s*===\s*0/.test(src)
    || /(?:^|[^\w])(?:fact|payment|paymentSource|freePricing)\s*===\s*['"]free['"]/.test(src)
    || /\.fact\s*===\s*['"]free['"]/.test(src)
    || /\.free\b/.test(src)
    || /(?:^|[^\w])isFree\b/.test(src)
}

function isPaidCondition(src) {
  return /(?:amountCents|amount|flowAmountCents)\s*>\s*0/.test(src)
}

/** @returns {'positive' | 'negated' | null} */
function nearbyPolarity(src) {
  const stripped = src.replace(/['"`][^'"`]*['"`]/g, '')
  if (!stripped.includes('otherOnlineTerminalNearby')) return null
  const negated = /!\s*(?:\w+\.)?otherOnlineTerminalNearby/.test(stripped)
  const positive = /(?:^|[^!\w])(?:\w+\.)?otherOnlineTerminalNearby\b/.test(stripped)
  if (negated && !positive) return 'negated'
  if (positive && !negated) return 'positive'
  return null
}

function lineOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
}

function pushStatic(hits, rel, line, text) {
  hits.violations.push({ rel, line, phrases: ['条件文案'], text })
}

function checkBranches(sf, rel, hits) {
  const visit = (node) => {
    if (ts.isConditionalExpression(node) || ts.isIfStatement(node)) {
      const cond = conditionSource(sf, branchCondition(node))
      const whenTrue = ts.isConditionalExpression(node) ? node.whenTrue : node.thenStatement
      const whenFalse = ts.isConditionalExpression(node) ? node.whenFalse : node.elseStatement
      const free = isFreeCondition(cond)
      const paid = isPaidCondition(cond)
      if (free && literalHas(whenTrue, '退款')) {
        pushStatic(hits, rel, lineOf(sf, whenTrue), '金额为 0 或免费的分支里出现了「退款」')
      }
      if (paid && whenFalse && literalHas(whenFalse, '退款')) {
        pushStatic(hits, rel, lineOf(sf, whenFalse), '金额不大于 0 的分支里出现了「退款」')
      }
      const polarity = nearbyPolarity(cond)
      if (polarity === 'positive' && whenFalse && literalHas(whenFalse, '换一台机器')) {
        pushStatic(hits, rel, lineOf(sf, whenFalse), 'otherOnlineTerminalNearby 为假时出现了「换一台机器」')
      }
      if (polarity === 'negated' && literalHas(whenTrue, '换一台机器')) {
        pushStatic(hits, rel, lineOf(sf, whenTrue), 'otherOnlineTerminalNearby 为假时出现了「换一台机器」')
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const cond = conditionSource(sf, node.left)
      if (isFreeCondition(cond) && literalHas(node.right, '退款')) {
        pushStatic(hits, rel, lineOf(sf, node.right), '金额为 0 或免费的分支里出现了「退款」')
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

function checkSwitchMachineLiterals(sf, rel, hits) {
  const visit = (node) => {
    const text = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)
      ? node.text
      : null
    if (text && text.includes('换一台机器')) {
      let parent = node.parent
      let guarded = false
      while (parent) {
        if (ts.isConditionalExpression(parent) || ts.isIfStatement(parent)) {
          const polarity = nearbyPolarity(conditionSource(sf, branchCondition(parent)))
          const inTrue = ts.isConditionalExpression(parent)
            ? parent.whenTrue === node || isInside(parent.whenTrue, node)
            : parent.thenStatement === node || isInside(parent.thenStatement, node)
          const inFalse = ts.isConditionalExpression(parent)
            ? parent.whenFalse === node || isInside(parent.whenFalse, node)
            : Boolean(parent.elseStatement && (parent.elseStatement === node || isInside(parent.elseStatement, node)))
          if (polarity === 'positive' && inTrue) guarded = true
          if (polarity === 'negated' && inFalse) guarded = true
        }
        parent = parent.parent
      }
      if (!guarded) {
        pushStatic(hits, rel, lineOf(sf, node), `「换一台机器」没有挂在 otherOnlineTerminalNearby 为真的分支上：${text.slice(0, 80)}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

function isInside(ancestor, node) {
  let current = node
  while (current) {
    if (current === ancestor) return true
    current = current.parent
  }
  return false
}

function scanSource(rel, source, hits) {
  const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, kind)
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      consider(rel, node.text, lineOf(sf, node), hits)
    } else if (ts.isTemplateExpression(node)) {
      consider(rel, node.head.text, lineOf(sf, node.head), hits)
      for (const span of node.templateSpans) consider(rel, span.literal.text, lineOf(sf, span.literal), hits)
    } else if (ts.isJsxText(node)) {
      consider(rel, node.text, lineOf(sf, node), hits)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  checkBranches(sf, rel, hits)
  checkSwitchMachineLiterals(sf, rel, hits)
}

function walk(dir, hits) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const stat = statSync(abs)
    if (stat.isDirectory()) {
      walk(abs, hits)
      continue
    }
    if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue
    const rel = relative(repoRoot, abs).split('\\').join('/')
    scanSource(rel, readFileSync(abs, 'utf8'), hits)
  }
}

function fail(message) {
  console.error(`✗ ${message}`)
  process.exitCode = 1
}

if (CLOSURE_ALLOWLIST.length > CLOSURE_ALLOWLIST_CAP) {
  fail(`注销 / 复制个人信息白名单 ${CLOSURE_ALLOWLIST.length} 条，超过上限 ${CLOSURE_ALLOWLIST_CAP}（A 包标准句 6，本任务不改）。`)
}

const probe = { violations: [], allowed: 0, used: new Set() }
scanSource('apps/kiosk/src/probe.tsx', "export const probe = '请联系现场工作人员'\n", probe)
if (probe.violations.length !== 1) {
  fail('反向探针没有拦住「请联系现场工作人员」')
}

const switchProbe = { violations: [], allowed: 0, used: new Set() }
scanSource(
  'apps/kiosk/src/switch-probe.tsx',
  "export const bad = '请换一台机器'\nexport const free = amountCents === 0 ? '如需退款' : '继续'\n",
  switchProbe,
)
if (switchProbe.violations.length < 2) {
  fail('反向探针没有同时拦住裸写的「换一台机器」和免费分支里的「退款」')
}

const hits = { violations: [], allowed: 0, used: new Set() }
walk(scanRoot, hits)

for (const entry of ALLOWLIST) {
  if (!hits.used.has(entry)) {
    fail(`白名单条目没有命中，请删掉或改回原文：${entry.file} :: ${entry.text}`)
  }
}

if (hits.violations.length > 0) {
  for (const hit of hits.violations) {
    console.error(`${hit.rel}:${hit.line}  [${hit.phrases.join('、')}]  ${hit.text}`)
  }
  fail(`无人值守文案 ${hits.violations.length} 处仍不合格`)
}

if (process.exitCode) {
  process.exit(process.exitCode)
}
console.log(`✓ verify:kiosk-unattended-copy 通过（取件白名单 0；注销三句放过 ${hits.allowed} 处）`)
