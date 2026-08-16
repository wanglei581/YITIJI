#!/usr/bin/env node
/**
 * 字号下限棘轮门禁（2026-08-16 建）
 *
 * ── 为什么是棘轮而不是硬门禁 ──────────────────────────────────────
 * PR #614 已把共享样式层的硬编码小字号从 23 处清到 4 处，产品内容 <13px 从
 * 181 处 / 36 页降到 16 处 / 5 页。剩下的 71 处散在 24 个文件里，其中绝大多数
 * 在各页自己的 <style> 块中——而这些页面本来就要在 V6 迁移里重写。
 * 现在清一遍、迁移时再重写一遍是白干。
 *
 * 但「先记下来、以后再说」等于不管：这个问题当初能长到 181 处，正是因为没人看着。
 *
 * 所以取中间路线：**冻结当前值，只在变多时失败**。
 *   · 变多 → FAIL，指出是哪个文件多了几处
 *   · 变少 → PASS，并提示可以下调基线（迁移完一页就顺手减掉那一页）
 *   · 新文件带违规 → FAIL（不允许悄悄开新债）
 * 债只会变少，不会变多。
 *
 * ── 为什么只管字号不管孤字 ────────────────────────────────────────
 * 字号是**可读性下限**：27 寸竖屏实测 0.311mm/px，站姿 600mm 下
 * 11px 只有 19.6 角分，是硬伤。孤字是排版讲究，不影响用户能不能看清、能不能操作。
 * 全量回归报的 507 条孤字如果塞进门禁，只会让门禁变成噪音，
 * 大家很快开始无脑加豁免——那时连字号这部分也一起失效了。
 * **门禁保护「能不能用」，不保护「排得好不好看」。**
 *
 * ── 豁免 ──────────────────────────────────────────────────────
 * 只豁免原型自带的开发工具条（状态切换器 / 主题切换器）。它们不是产品内容，
 * C0 事实冻结已裁定生产必须整体删除。豁免是**显式按选择器列出**的，不是通配忽略。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 下限：13px。依据见 styles/tokens.css 的角分换算注释。 */
const FLOOR_PX = 13

/** 匹配 font-size 小于 13px 的声明（含 12.5px 这类小数）。 */
const FONT_SIZE_RE = /font-size:\s*(\d+(?:\.\d+)?)px/g

/**
 * 显式豁免的选择器块。只有原型自带的开发工具条。
 * 命中判定：该 font-size 声明所在的规则块，选择器包含以下任一片段。
 */
const EXEMPT_SELECTORS = [
  '#ss',          // 状态切换器（默认 / 首次使用 / AI 不可用 / 设备离线）
  '.themebar',    // 主题切换器（暖玉纸 / 蜜杏暖橙 / 霜白玻璃）
  '.screen-name', // 原型页名标签
]

/**
 * 冻结基线：文件 → 允许的违规数。
 * 迁移完一页后请把该页减掉或删除条目；本文件是唯一可以调的地方。
 * 冻结时间 2026-08-16，基线 origin/main@1829a343d，总计 71 处 / 24 个文件。
 */
const BASELINE = {
  '31-contract-review.html': 9,
  '20-interview-pod.html': 7,
  '11-jobfit-compare.html': 7,
  '17-fair-desk.html': 6,
  '21-policy.html': 5,
  '18-campus.html': 4,
  '39-print-hub.html': 3,
  '22-career-plan.html': 3,
  '14-job-detail.html': 3,
  '13-jobs-desk.html': 3,
  '12-material-factory.html': 3,
  '10-resume-interview.html': 3,
  'styles/shell.css': 2,
  '29-id-photo.html': 2,
  '08-file-tools.html': 2,
  'styles/notebar.css': 1,
  'styles/components.css': 1,
  '45-fair-onsite.html': 1,
  '33-resume-templates.html': 1,
  '25-advisor.html': 1,
  '09-resume-workbench.html': 1,
  '06-print-workbench.html': 1,
  '01-home-v6.html': 1,
  '01-home-v5.html': 1,
}

function isExempt(source, matchIndex) {
  // 往回找最近的 `{`，取它之前那段作为选择器
  const openBrace = source.lastIndexOf('{', matchIndex)
  if (openBrace < 0) return false
  const prevBoundary = Math.max(
    source.lastIndexOf('}', openBrace),
    source.lastIndexOf(';', openBrace),
    0,
  )
  const selector = source.slice(prevBoundary, openBrace)
  return EXEMPT_SELECTORS.some((s) => selector.includes(s))
}

function countViolations(source) {
  let count = 0
  FONT_SIZE_RE.lastIndex = 0
  let m
  while ((m = FONT_SIZE_RE.exec(source)) !== null) {
    if (Number(m[1]) >= FLOOR_PX) continue
    if (isExempt(source, m.index)) continue
    count += 1
  }
  return count
}

function collectFiles() {
  const files = []
  for (const name of readdirSync(ROOT)) {
    if (/^\d.*\.html$/.test(name)) files.push(name)
  }
  for (const name of readdirSync(join(ROOT, 'styles'))) {
    if (name.endsWith('.css')) files.push(join('styles', name))
  }
  return files.sort()
}

const failures = []
const improvements = []
let total = 0

for (const rel of collectFiles()) {
  const source = readFileSync(join(ROOT, rel), 'utf8')
  const actual = countViolations(source)
  total += actual
  const allowed = BASELINE[rel] ?? 0
  if (actual > allowed) {
    failures.push(
      allowed === 0
        ? `${rel}: 新增 ${actual} 处 <${FLOOR_PX}px（该文件此前无违规，不允许悄悄开新债）`
        : `${rel}: ${actual} 处 <${FLOOR_PX}px，超出冻结基线 ${allowed} 处`,
    )
  } else if (actual < allowed) {
    improvements.push(`${rel}: ${allowed} → ${actual}，可把基线下调到 ${actual}`)
  }
}

const baselineTotal = Object.values(BASELINE).reduce((a, b) => a + b, 0)

console.log('=== V6 原型字号下限棘轮门禁 ===')
console.log(`下限 ${FLOOR_PX}px · 冻结基线 ${baselineTotal} 处 · 当前实测 ${total} 处`)

if (improvements.length) {
  console.log('\n✅ 以下文件已改善，请顺手下调基线：')
  for (const line of improvements) console.log(`   ${line}`)
}

if (failures.length) {
  console.log(`\n❌ 字号下限回退 ${failures.length} 处：`)
  for (const line of failures) console.log(`   ${line}`)
  console.log(
    '\n下限依据：27 寸竖屏 0.311mm/px，站姿 600mm 下 11px = 19.6 角分、13px = 23.2 角分。',
  )
  console.log('修法：改走 --fz-1 及以上的令牌，不要硬编码。豁免只给原型工具条，且须显式加进 EXEMPT_SELECTORS。')
  process.exit(1)
}

console.log('\n✅ 没有回退')
