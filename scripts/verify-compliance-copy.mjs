#!/usr/bin/env node
/**
 * 合规文案禁词门禁 —— 扫 apps/{admin,kiosk,partner}/src 全量 .ts/.tsx。
 *
 * 背景(2026-08-01):`COMPLIANCE_FORBIDDEN_TERMS` 自建立起是**死常量**,零消费者;
 * 真正在跑的禁词检查散落在 46 个 verify 脚本里各自硬编码,清单互不一致 ——
 * 「一键报名」0/46 覆盖,「投递简历」13/46。本门禁把 SSOT 接上唯一的全量消费者。
 *
 * 两条设计约束:
 *
 * 1. 用文本解析而非 import 读 SSOT。`packages/shared` 只导出裸 TS(exports → ./src/index.ts,
 *    无 dist、无 build),而根 verify 脚本在纯 `node` 下跑,import 不了。解析失败一律 fail,
 *    不允许静默放行(fail-closed)。
 *
 * 2. 命中禁词 ≠ 违规。实测 `平台内?投递` 在业务源码命中 33 处、其中 30 处合规:
 *    「去来源平台投递」是白名单文案本身,「不参与平台内投递」是边界声明。
 *    因此命中后要看命中位置前的上下文标记(否定式 / 指向站外)再判定。
 *
 * 扫描范围只含前端用户可见代码。services/api/src 故意排除:那里的禁词是 7 个运行时
 * 守卫的正则/数组**数据**,以及告诉 LLM 不要输出这些词的 prompt 文本,属合法持有。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const SSOT = path.join(root, 'packages/shared/src/types/complianceCopy.ts')
const SCAN_DIRS = ['apps/admin/src', 'apps/kiosk/src', 'apps/partner/src']
const EXTS = new Set(['.ts', '.tsx'])

let failures = 0

function fail(message) {
  console.error(`  ❌ ${message}`)
  failures += 1
}

function pass(message) {
  console.log(`  ✅ ${message}`)
}

/** fail-closed:解析不到就退出,绝不降级为"跳过检查"。 */
function hardFail(message) {
  console.error(`\n❌ SSOT 解析失败(fail-closed): ${message}`)
  console.error(`   请检查 ${path.relative(root, SSOT)} 是否改了常量格式。\n`)
  process.exit(1)
}

// ---------- 1. 从 SSOT 解析禁词与豁免标记 ----------

/**
 * 取出 `export const NAME<可选类型标注> = <open>...<close>` 的字面量体。
 * 必须从 `=` 之后再找 open:类型标注 `readonly RegExp[]` 自带 `[`,
 * 直接 indexOf('[') 会落在类型里,切出空串。
 */
function sliceBlock(source, exportName, open, close) {
  const decl = source.indexOf(`export const ${exportName}`)
  if (decl === -1) hardFail(`找不到 export const ${exportName}`)
  const eq = source.indexOf('=', decl)
  if (eq === -1) hardFail(`${exportName} 缺少 = 赋值`)
  const from = source.indexOf(open, eq)
  const to = source.indexOf(close, from)
  if (from === -1 || to === -1) hardFail(`${exportName} 缺少 ${open}...${close} 结构`)
  return source.slice(from + 1, to)
}

const ssotSource = fs.readFileSync(SSOT, 'utf8')

const terms = [
  ...sliceBlock(ssotSource, 'COMPLIANCE_FORBIDDEN_TERMS', '[', ']').matchAll(/'([^']+)'/g),
].map((m) => m[1])
if (terms.length === 0) hardFail('COMPLIANCE_FORBIDDEN_TERMS 解析出 0 项')

const patternBody = sliceBlock(ssotSource, 'COMPLIANCE_FORBIDDEN_TERM_PATTERNS', '[', ']')
const patterns = [...patternBody.matchAll(/\/((?:[^/\\\n]|\\.)+)\//g)].map(
  (m) => new RegExp(m[1], 'g')
)
if (patterns.length === 0) hardFail('COMPLIANCE_FORBIDDEN_TERM_PATTERNS 解析出 0 项')
if (patterns.length !== terms.length) {
  hardFail(`禁词 ${terms.length} 项与正则 ${patterns.length} 项数量不一致,可能漏配变体`)
}

const markerBody = sliceBlock(ssotSource, 'COMPLIANCE_EXEMPTION_MARKERS', '{', '\n}')
const markers = [...markerBody.matchAll(/'([^']+)'/g)].map((m) => m[1])
if (markers.length === 0) hardFail('COMPLIANCE_EXEMPTION_MARKERS 解析出 0 项')

const banBody = sliceBlock(ssotSource, 'COMPLIANCE_BAN_DECLARATION_MARKERS', '[', ']')
const banMarkers = [...banBody.matchAll(/'([^']+)'/g)].map((m) => m[1])
if (banMarkers.length === 0) hardFail('COMPLIANCE_BAN_DECLARATION_MARKERS 解析出 0 项')

const lookbehindMatch = ssotSource.match(/export const COMPLIANCE_EXEMPTION_LOOKBEHIND\s*=\s*(\d+)/)
if (!lookbehindMatch) hardFail('找不到 COMPLIANCE_EXEMPTION_LOOKBEHIND')
const LOOKBEHIND = Number(lookbehindMatch[1])

console.log(`\n📋 合规文案禁词门禁`)
console.log(`   SSOT: ${path.relative(root, SSOT)}`)
console.log(
  `   禁词 ${terms.length} 项 / 正则 ${patterns.length} 项 / 豁免标记 ${markers.length} 项 / 禁用声明标记 ${banMarkers.length} 项`
)
console.log(`   扫描: ${SCAN_DIRS.join(' ')}\n`)

// ---------- 2. 递归收集待扫文件 ----------

function collect(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      collect(full, acc)
    } else if (EXTS.has(path.extname(entry.name))) {
      acc.push(full)
    }
  }
  return acc
}

const files = []
for (const rel of SCAN_DIRS) {
  const abs = path.join(root, rel)
  if (!fs.existsSync(abs)) hardFail(`扫描目录不存在: ${rel}`)
  collect(abs, files)
}
if (files.length === 0) hardFail('扫描目录下 0 个 .ts/.tsx,范围配置可能失效')

// ---------- 3. 逐行判定 ----------

/**
 * 合规判定:
 * - 整行是禁用声明(在禁止这些词) → 合规;
 * - 命中位置前 LOOKBEHIND 字符内出现否定式 / 站外标记 → 合规。
 */
function isExempt(line, index) {
  if (banMarkers.some((marker) => line.includes(marker))) return true
  const before = line.slice(Math.max(0, index - LOOKBEHIND), index)
  return markers.some((marker) => before.includes(marker))
}

const violations = []
let hits = 0
let exempted = 0

for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const pattern of patterns) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(line)) !== null) {
        hits += 1
        if (isExempt(line, match.index)) {
          exempted += 1
          continue
        }
        violations.push({
          file: path.relative(root, file),
          line: i + 1,
          term: match[0],
          text: line.trim().slice(0, 100),
        })
      }
    }
  })
}

console.log(`  扫描 ${files.length} 个文件,禁词命中 ${hits} 处,豁免 ${exempted} 处\n`)

if (violations.length === 0) {
  pass(`1. apps/*/src 无违规禁词文案(${terms.length} 项禁词全覆盖)`)
} else {
  fail(`1. 发现 ${violations.length} 处违规禁词文案:`)
  for (const v of violations) {
    console.error(`       ${v.file}:${v.line}  「${v.term}」`)
    console.error(`         ${v.text}`)
  }
  console.error(`\n     改写参考:使用 COMPLIANCE_PREFERRED_TERMS 白名单文案`)
  console.error(
    `     (查看岗位 / 去来源平台投递 / 扫码投递 / 查看招聘会 / 去来源平台预约 / 扫码预约)`
  )
}

// ---------- 4. 自检:豁免机制不能形同虚设,也不能过宽 ----------

if (exempted > 0) {
  pass(`2. 豁免机制生效(${exempted} 处合规用法未误报)`)
} else {
  fail(`2. 豁免命中 0 处 —— 实测应有约 30 处合规用法,豁免标记可能已失效`)
}

const probe = [
  { text: '去来源平台投递', shouldPass: true },
  { text: '不提供平台内投递,不接收简历', shouldPass: true },
  { text: '本后台不涉及简历接收与候选人管理', shouldPass: true },
  { text: '一键投递到企业', shouldPass: false },
  { text: '立即投递,无需注册', shouldPass: false },
  { text: '点此投递简历给企业', shouldPass: false },
  { text: '招聘会一键报名', shouldPass: false },
  // 以下 5 条是"单字否定标记"会漏放的真实句式,故意长期钉在用例里:
  // 若有人把 NEGATED 改回单字「不」「无」「非」,这些用例立刻失败。
  { text: '不用注册,一键投递到企业', shouldPass: false },
  { text: '无需注册,一键投递到企业', shouldPass: false },
  { text: '非常快,立即投递', shouldPass: false },
  { text: '无限次一键报名', shouldPass: false },
  { text: '无门槛投递简历', shouldPass: false },
  // 禁用声明:连续列举多个禁词,最后一个已超出回看窗口,靠整行标记豁免
  { text: '素材文案禁止出现「一键投递 / 立即投递 / 平台投递」等违规用语。', shouldPass: true },
  { text: '文案不得出现一键报名', shouldPass: true },
]

let probeFailures = 0
for (const item of probe) {
  let flagged = false
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(item.text)) !== null) {
      if (!isExempt(item.text, match.index)) flagged = true
    }
  }
  const ok = item.shouldPass ? !flagged : flagged
  if (!ok) {
    console.error(
      `     用例失败:「${item.text}」预期${item.shouldPass ? '合规' : '违规'},实际${flagged ? '违规' : '合规'}`
    )
    probeFailures += 1
  }
}

if (probeFailures === 0) {
  pass(`3. 判定逻辑自检通过(${probe.length} 条用例,含否定式豁免与"不用注册+一键投递"反例)`)
} else {
  fail(`3. 判定逻辑自检失败 ${probeFailures}/${probe.length} 条`)
}

// ---------- 结果 ----------

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 —— 合规文案禁词门禁未通过\n`)
  process.exit(1)
}
console.log(`\n✅ ALL PASS —— 合规文案禁词门禁通过\n`)
