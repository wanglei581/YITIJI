#!/usr/bin/env node
/**
 * verify:kiosk-unattended-copy
 *
 * 2026-10-04：一体机现场不安排工作人员。apps/kiosk/src 的字符串字面量与 JSX 文本
 * （不含注释）不得再出现下列说法。TypeScript 的 .text 会解开 \u 转义，所以转义写不出门。
 *
 * 两份冻结白名单，上限不许增加：
 * - 取件凭证码：待产品负责人定取件凭证码方案后清掉
 * - 注销 / 复制个人信息三句：PR #1257 定稿，本任务不改
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
  '出示给现场工作人员',
  '出示给工作人员',
  '去服务台',
]

/**
 * 待产品负责人定取件凭证码方案后清掉。
 * 上限 14。只许减少，不许加条目。
 */
const PICKUP_ALLOWLIST_CAP = 14
const PICKUP_ALLOWLIST = [
  { file: 'apps/kiosk/src/pages/print/pickupClaimModel.ts', text: '本机输码暂时停用，过一段时间会自动解除；着急请找现场工作人员' },
  { file: 'apps/kiosk/src/pages/print/pickupClaimModel.ts', text: '这台机器暂时不能取件，请找现场工作人员' },
  { file: 'apps/kiosk/src/pages/print/pickupClaimModel.ts', text: '这笔订单正在处理，请等几秒再输一次；仍不行请找现场工作人员' },
  { file: 'apps/kiosk/src/pages/print/pickupClaimModel.ts', text: '这台终端暂停接打印单，你的到机码没有作废，请稍后再来这台终端输码，或找现场工作人员' },
  { file: 'apps/kiosk/src/pages/print/pickupClaimModel.ts', text: '这台终端的打印机暂不可用，你的到机码没有作废，请稍后再来这台终端输码，或找现场工作人员' },
  { file: 'apps/kiosk/src/pages/print/pickupClaimModel.ts', text: '这个到机码已经用过，不能再次取件。要再打一份，请在手机上重新下单；没拿到纸请找现场工作人员' },
  { file: 'apps/kiosk/src/pages/print/pickupClaimModel.ts', text: '这份文件的隐私检查还没完成，暂时不能打印。请过一会儿再输一次，或找现场工作人员' },
  { file: 'apps/kiosk/src/pages/print/pickupClaimModel.ts', text: '这台机器暂时不能打印这笔订单，请找现场工作人员' },
  { file: 'apps/kiosk/src/pages/print/pickupClaimModel.ts', text: '到机码校验没有完成，请重试或联系现场工作人员' },
  { file: 'apps/kiosk/src/pages/print/pickupClaimModel.ts', text: '这台机器的安全校验没通过，请找现场工作人员' },
  { file: 'apps/kiosk/src/pages/print/pickupClaimModel.ts', text: '这一单没有打成。请联系现场工作人员，不要在出纸口空等。' },
  { file: 'apps/kiosk/src/pages/print/pickupClaimModel.ts', text: '找工作人员处理' },
  { file: 'apps/kiosk/src/pages/print/components/PickupHidGuide.tsx', text: '取纸时出示给工作人员，不在本页输入。' },
  { file: 'apps/kiosk/src/services/api/userErrorMessage.ts', text: '这个到机码对应的文件暂时不可用，请联系现场工作人员' },
]

/** PR #1257 定稿，本任务不改。上限 3。 */
const CLOSURE_ALLOWLIST_CAP = 3
const CLOSURE_ALLOWLIST = [
  { file: 'apps/kiosk/src/pages/profile/me/MySettingsPage.tsx', text: '注销账号、复制个人信息，请找现场工作人员，或按《隐私政策》里的电话、邮箱联系我们申请。我们核实是你本人后，15 个工作日内处理。' },
  { file: 'apps/kiosk/src/pages/profile/ProfilePage.tsx', text: '当前可撤回 AI 使用授权；注销账号、复制个人信息，请找现场工作人员或按《隐私政策》的联系方式申请。' },
  { file: 'apps/kiosk/src/pages/profile/me/MyPrivacyRequestsPage.tsx', text: '当前可撤回 AI 使用授权；注销账号、复制个人信息，请找现场工作人员或按《隐私政策》的联系方式申请。' },
]

const ALLOWLIST = [...PICKUP_ALLOWLIST, ...CLOSURE_ALLOWLIST]

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
  hits.violations.push({ rel, line, phrases, text: text.replace(/\s+/g, ' ').trim().slice(0, 160) })
}

function scanSource(rel, source, hits) {
  const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, kind)
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      consider(rel, node.text, lineOf(node), hits)
    } else if (ts.isTemplateExpression(node)) {
      consider(rel, node.head.text, lineOf(node.head), hits)
      for (const span of node.templateSpans) consider(rel, span.literal.text, lineOf(span.literal), hits)
    } else if (ts.isJsxText(node)) {
      consider(rel, node.text, lineOf(node), hits)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
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

if (PICKUP_ALLOWLIST.length > PICKUP_ALLOWLIST_CAP) {
  fail(`取件凭证码白名单 ${PICKUP_ALLOWLIST.length} 条，超过上限 ${PICKUP_ALLOWLIST_CAP}。待产品负责人定取件凭证码方案后清掉，不许增加。`)
}
if (CLOSURE_ALLOWLIST.length > CLOSURE_ALLOWLIST_CAP) {
  fail(`注销 / 复制个人信息白名单 ${CLOSURE_ALLOWLIST.length} 条，超过上限 ${CLOSURE_ALLOWLIST_CAP}（PR #1257 定稿，本任务不改）。`)
}

const probe = { violations: [], allowed: 0, used: new Set() }
scanSource('apps/kiosk/src/probe.tsx', "export const probe = '请联系现场工作人员'\n", probe)
if (probe.violations.length !== 1) {
  fail('反向探针没有拦住「请联系现场工作人员」')
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
  fail(`无人值守文案 ${hits.violations.length} 处仍让用户去找现场的人`)
}

if (process.exitCode) {
  process.exit(process.exitCode)
}
console.log(`✓ verify:kiosk-unattended-copy 通过（白名单放过 ${hits.allowed} 处，取件 ${PICKUP_ALLOWLIST.length}/${PICKUP_ALLOWLIST_CAP}，注销 ${CLOSURE_ALLOWLIST.length}/${CLOSURE_ALLOWLIST_CAP}）`)
