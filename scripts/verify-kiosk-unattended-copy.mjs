#!/usr/bin/env node
/**
 * verify:kiosk-unattended-copy
 *
 * 2026-10-04：一体机现场不安排工作人员。apps/kiosk/src 的字符串字面量与 JSX 文本
 * （不含注释）不得再出现禁用说法。TypeScript 的 .text 会解开 \u 转义，所以转义写不出门。
 *
 * 白名单必须为空（2026-10-06 合并候选后核对）。
 * 原先放过的注销三句是旧文案，里面有「找现场工作人员」：
 * - MySettingsPage：「注销账号、复制个人信息，请找现场工作人员，或按《隐私政策》里的电话、邮箱联系我们申请。我们核实是你本人后，15 个工作日内处理。」
 * - ProfilePage / MyPrivacyRequestsPage：「当前可撤回 AI 使用授权；注销账号、复制个人信息，请找现场工作人员或按《隐私政策》的联系方式申请。」
 * 候选侧定稿后这三处都不含工作人员，统一为「注销账号、复制个人信息，请按《隐私政策》里的电话、邮箱联系我们申请。我们核实是你本人后，15 个工作日内处理。」
 * 所以不再放过。取件凭证码白名单仍为空。
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
  // 10/6 总指挥：四个词整体禁用（不只「联系 / 找」开头的组合），注释与测试不算。
  '现场工作人员',
  '服务台',
  '值守',
  '缺纸时一体机会自动停止接单',
  '找人补纸',
  '取件凭证码',
]

/** 必须为空。注销统一句不含禁用词，取件凭证码方案也不再单列放过。 */
const ALLOWLIST = []

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
    // 退款句只许出现在「金额大于 0」的分支里：没有守卫的调用，免费单也会看到退款。
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'refundApplyLine'
      && !isUnderPaidGuard(sf, node)) {
      pushStatic(hits, rel, lineOf(sf, node), 'refundApplyLine 没有放在「金额大于 0」的分支里')
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

/** 「付过钱」的条件：直接比金额，或用本文件里叫 paid 的布尔量（不带取反）。 */
function isPaidGuard(src) {
  return isPaidCondition(src) || /(?:^|[^!\w.])paid\b/.test(src)
}

function isUnderPaidGuard(sf, call, depth = 0) {
  for (let child = call, parent = call.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isConditionalExpression(parent) || ts.isIfStatement(parent)) {
      const cond = conditionSource(sf, branchCondition(parent))
      const whenTrue = ts.isConditionalExpression(parent) ? parent.whenTrue : parent.thenStatement
      const whenFalse = ts.isConditionalExpression(parent) ? parent.whenFalse : parent.elseStatement
      if (whenTrue === child && isPaidGuard(cond)) return true
      // 免费分支的另一侧：c.free ? 求助句 : 退款句。
      if (whenFalse === child && isFreeCondition(cond)) return true
    }
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      && parent.right === child && isPaidGuard(conditionSource(sf, parent.left))) return true
    // 包在本文件的小函数里：看这个函数的每个调用点是不是都有守卫。
    if (ts.isFunctionDeclaration(parent) && parent.name && depth < 2) {
      const sites = []
      const collect = (n) => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === parent.name.text) sites.push(n)
        ts.forEachChild(n, collect)
      }
      collect(sf)
      return sites.length > 0 && sites.every((site) => isUnderPaidGuard(sf, site, depth + 1))
    }
  }
  return false
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

if (ALLOWLIST.length !== 0) {
  fail(`白名单必须为空，当前 ${ALLOWLIST.length} 条。注销统一句不含工作人员，不再放过。`)
}

const probe = { violations: [], allowed: 0, used: new Set() }
scanSource('apps/kiosk/src/probe.tsx', "export const probe = '请联系现场工作人员'\n", probe)
if (probe.violations.length !== 1) {
  fail('反向探针没有拦住「请联系现场工作人员」')
}

// 退款句守卫：没守卫的要拦住，有守卫的（比金额、paid 布尔量、免费分支另一侧）不能误拦。
const refundProbe = { violations: [], allowed: 0, used: new Set() }
scanSource('apps/kiosk/src/refund-probe.tsx', 'export const bad = (c) => refundApplyLine(c)\n', refundProbe)
if (refundProbe.violations.length !== 1) {
  fail('反向探针没有拦住不带金额守卫的 refundApplyLine')
}
const refundOkProbe = { violations: [], allowed: 0, used: new Set() }
scanSource(
  'apps/kiosk/src/refund-ok-probe.tsx',
  'export const a = (c, amountCents) => amountCents > 0 ? refundApplyLine(c) : null\n'
    + 'export const b = (c, paid) => paid && refundApplyLine(c)\n'
    + 'export const d = (c, x) => x.free ? null : refundApplyLine(c)\n',
  refundOkProbe,
)
if (refundOkProbe.violations.length !== 0) {
  fail('退款句守卫规则把有守卫的写法误判成不合格')
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

if (hits.violations.length > 0) {
  for (const hit of hits.violations) {
    console.error(`${hit.rel}:${hit.line}  [${hit.phrases.join('、')}]  ${hit.text}`)
  }
  fail(`无人值守文案 ${hits.violations.length} 处仍不合格`)
}

if (process.exitCode) {
  process.exit(process.exitCode)
}
console.log(`✓ verify:kiosk-unattended-copy 通过（白名单 ${ALLOWLIST.length}）`)
