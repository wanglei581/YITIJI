#!/usr/bin/env node
// ============================================================
// 夹具定时炸弹门禁。
//
// ## 防的是什么
//
// 2026-09-01T09:00Z 那一刻，两条门禁同时对所有人恒红，起因是 verify 脚本里
// 写死了一个"未来"日期当作"尚未结束"的夹具：
//   verify-publish-expiry-completeness.ts  fairRow 默认 endAt = 2026-09-01T09:00Z
//   verify-content-trust-publish-gate.ts   同一个日期，同一份夹具
// 该时刻一过，"未结束"的招聘会变成"已结束"，断言拿到空数组。
// 修一条露一条：第二条被依赖门禁挡在后面，直到第一条修好才现形。
//
// 同一文件第 60 行的注释**已经写明了正确做法**（"固定夹具取远早于/远晚于今天的
// 两端"），第 62 行的 FUTURE 却写成 2026-12-31 —— 作者写下规则又在两行后破了它。
// 这就是为什么这条必须上机械层：约定和 review 已经实弹失效过。
//
// ## 为什么不看时钟
//
// 一个"凡是晚于 Date.now() 的字面量就报警"的扫描器有两个致命处：
//   1. 已经爆掉的雷现在是过去时间，它会放行；
//   2. 它自己的判定依赖运行日期 —— 同一个 commit 今天和明天结论不同，
//      正是它要治的那个病。
// 所以本门禁全程不调用任何时间 API，判据只有写死的年份边界。
//
// ## 覆盖范围（刻意有限，且这是设计不是遗漏）
//
// 只检查**自己定义了时间端点常量**的 verify 脚本 —— 定义这类常量，意味着作者
// 已经意识到"被测服务用真实 new Date() 判有效期"。给一个新文件加上这类常量，
// 就等于把它纳入本门禁。不定义常量的脚本不在射程内：全仓 14 处危险带字面量里
// 大多数是 mock 时钟或惰性过去数据，一刀切会误伤一片，那种门禁会被直接删掉。
// ============================================================

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SCAN_DIRS = ['services/api/scripts', 'apps/kiosk/scripts', 'scripts']

/** 端点常量的名字。定义了其中任意一个，本文件即纳入检查。 */
const ENDPOINT_NAMES = /\b(PAST|FUTURE|FAR_PAST|FAR_FUTURE)\b/

/** 受真实时钟影响的时效字段。 */
const VALIDITY_FIELDS = ['startAt', 'endAt', 'validFrom', 'validUntil', 'expiresAt']

/**
 * 安全带边界。≤2001 永远是过去，≥2098 在本项目生命周期内永远是未来。
 * 中间那一段是"危险带"：今天是过去还是未来取决于你哪天读它。
 */
const SAFE_PAST_MAX = 2001
const SAFE_FUTURE_MIN = 2098

/** 单行豁免：行尾或上一行写 `time-bomb-ok: <理由>`。 */
const EXEMPT = /time-bomb-ok:/

/**
 * 文件级豁免：整份脚本对 mock 时钟判定（时间从参数注入，不读真实 new Date()）。
 * 这类文件里所有日期常量的相对关系都与运行日期无关，逐行标注是错误的粒度。
 * 写法：文件任意处出现 `time-bomb-ok-file: <理由>`。
 * 代价明写：加了它就等于对整份文件关掉本门禁 —— 所以理由必须说清"时间从哪来"，
 * 而不是"我检查过了"。
 */
const EXEMPT_FILE = /time-bomb-ok-file:/


/**
 * 日期构造的年份识别。**必须覆盖所有写法** —— 只认一种写法的门禁等于没有门禁：
 *   new Date('2026-…')  new Date("2026-…")  new Date(`2026-…`)
 *   Date.parse('2026-…')                     new Date(2026, 8, 1)
 * 初版只写了 new Date\('，双引号一写就整条绕过（已实测复现）。这是本仓库
 * 反复出现的同一类缺陷：门禁只认作者自己习惯的那种写法。
 *
 * 返回该片段里出现的所有年份（数字）。
 */
const DATE_YEAR_PATTERNS = [
  /new Date\(\s*['"`](\d{4})-/g,
  /Date\.parse\(\s*['"`](\d{4})-/g,
  /new Date\(\s*(\d{4})\s*,/g,
]

function dateYears(text) {
  const years = []
  for (const re of DATE_YEAR_PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, 'g'))) years.push(Number(m[1]))
  }
  return years
}

/** 年份是否落在"危险带"（今天是过去还是未来，取决于你哪天读它）。 */
function inDangerZone(year) {
  return year > SAFE_PAST_MAX && year < SAFE_FUTURE_MIN
}

let failed = 0
let checkedFiles = 0
let checkedSites = 0
const exemptedFiles = []

function fail(msg, detail) {
  failed += 1
  console.log(`  ✗ ${msg}${detail ? ` — ${detail}` : ''}`)
}
function pass(msg) {
  console.log(`  ✓ ${msg}`)
}

function walk(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(full))
    else if (/\.(ts|mjs)$/.test(e.name)) out.push(full)
  }
  return out
}

console.log('\n=== verify fixture time bombs ===\n')

const files = SCAN_DIRS.flatMap((d) => walk(join(REPO_ROOT, d)))
if (files.length < 50) {
  fail('扫到的脚本数异常偏少（断言可能空跑）', String(files.length))
}

for (const full of files) {
  const src = readFileSync(full, 'utf-8')
  if (!ENDPOINT_NAMES.test(src)) continue
  const rel = relative(REPO_ROOT, full).split('\\').join('/')
  // 本门禁自己的源码里写着这些指令字符串（在说明文档里），不能因此把自己豁免掉 ——
  // 「意外自我豁免」是门禁被悄悄掏空的典型方式。
  if (rel === 'scripts/verify-fixture-time-bombs.mjs') continue
  if (EXEMPT_FILE.test(src)) {
    exemptedFiles.push(rel)
    continue
  }
  checkedFiles += 1
  const lines = src.split('\n')

  // ── 规则 1：端点常量本身必须够远 ────────────────────────────────
  for (const m of src.matchAll(
    /const\s+(PAST|FAR_PAST|FUTURE|FAR_FUTURE)\s*=\s*([^\n]+)/g,
  )) {
    const [, name, expr] = m
    const years = dateYears(expr)
    if (years.length === 0) continue
    checkedSites += 1
    const year = years[0]
    const isPast = name.endsWith('PAST')
    const ok = isPast ? year <= SAFE_PAST_MAX : year >= SAFE_FUTURE_MIN
    // 豁免同样适用于端点常量：mock 时钟的脚本里，端点是相对脚本自己的 NOW 取值的
    // （例如 FUTURE = NOW + 1h 并显式传给被测函数），与真实运行日期无关。
    // 静态分析分不清这一类，只能要求作者具名声明 —— 这也是唯一诚实的做法。
    const declLine = src.slice(0, m.index).split('\n').length
    const around = lines.slice(Math.max(0, declLine - 5), declLine).join('\n')
    if (!ok && EXEMPT.test(around)) continue
    if (!ok) {
      fail(
        `${rel} 的 ${name} 端点不够远`,
        `${year}；${isPast ? `应 ≤${SAFE_PAST_MAX}` : `应 ≥${SAFE_FUTURE_MIN}`}（它自己就是定时炸弹）`,
      )
    }
  }

  // ── 规则 2：时效字段不许写危险带字面量 ──────────────────────────
  lines.forEach((line, i) => {
    for (const field of VALIDITY_FIELDS) {
      const at = line.search(new RegExp(`\\b${field}:`))
      if (at === -1) continue
      const years = dateYears(line.slice(at))
      if (years.length === 0) continue
      checkedSites += 1
      const year = years.find(inDangerZone)
      if (year === undefined) continue
      if (EXEMPT.test(line) || EXEMPT.test(lines[i - 1] ?? '')) continue
      fail(
        `${rel}:${i + 1} 的 ${field} 写死危险带日期`,
        `${year} 年；改用端点常量，或加 \`time-bomb-ok: <理由>\` 注释说明为何不会随运行日期失效`,
      )
    }
  })
}

if (checkedFiles === 0) fail('没有文件被检查（断言空跑）')
if (checkedSites === 0) fail('没有站点被检查（断言空跑）')

console.log('')
if (failed === 0) {
  pass(`${checkedFiles} 个文件 / ${checkedSites} 处站点，无定时炸弹`)
  if (exemptedFiles.length) {
    console.log(`  · 整份豁免（mock 时钟）：${exemptedFiles.join(', ')}`)
  }
  console.log('\nALL PASS: fixture time bombs\n')
  process.exit(0)
}
console.log(`\n结果: ${failed} FAIL（${checkedFiles} 个文件 / ${checkedSites} 处站点）\n`)
process.exit(1)
