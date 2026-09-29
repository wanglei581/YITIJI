#!/usr/bin/env node
/**
 * verify:datetime-honesty —— 三端时间展示不得再把 UTC ISO 切片当本地墙钟。
 *
 * 挡的是 launch-audit-2026-09-05 X-02 / JOB-01：
 *   - 后端 fmtSyncTime 曾输出无时区 UTC「YYYY-MM-DD HH:mm」
 *   - 三端 `.slice(0,16).replace('T',' ')` / `toISOString().slice` 把 UTC 当本地
 *   - Safari `new Date('2026-06-20 01:00')` 为 Invalid Date，岗位来源四要素误判缺失
 *
 * 本门禁：
 *   A. apps/{admin,kiosk,partner}/src 不得再出现上述切片写法
 *   B. fmtSyncTime 必须输出 ISO（含 Z）或带时区，不得再 slice/replace T
 *   C. 共享 formatDateTime 按 Asia/Shanghai 解析无时区串（当 UTC）与 ISO
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatDateTime,
  formatRelativeTime,
  fromDatetimeLocalValue,
  isParseableInstant,
  parseInstant,
  toDatetimeLocalValue,
} from '../packages/shared/src/formatDateTime.ts'
import {
  formatCents,
  formatCount,
  formatPercent,
  formatYuan,
} from '../packages/shared/src/formatNumber.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const SCAN_DIRS = [
  { dir: 'apps/admin/src', exts: ['.ts', '.tsx'] },
  { dir: 'apps/kiosk/src', exts: ['.ts', '.tsx'] },
  { dir: 'apps/partner/src', exts: ['.ts', '.tsx'] },
]

const FORBIDDEN = [
  {
    label: 'toISOString().slice',
    pattern: /toISOString\s*\(\s*\)\s*\.\s*slice\s*\(/,
  },
  {
    label: "toISOString().replace('T'",
    pattern: /toISOString\s*\(\s*\)\s*\.\s*replace\s*\(\s*['"]T['"]/,
  },
  {
    label: ".slice(0,16).replace('T'",
    pattern: /\.slice\s*\(\s*0\s*,\s*16\s*\)\s*\.\s*replace\s*\(\s*['"]T['"]/,
  },
  {
    label: ".replace('T',' ').slice(0,16)",
    pattern: /\.replace\s*\(\s*['"]T['"]\s*,\s*['"] ['"]\s*\)\s*\.\s*slice\s*\(\s*0\s*,\s*16\s*\)/,
  },
]

let failures = 0

function fail(message) {
  console.error(`  ❌ ${message}`)
  failures += 1
}

function pass(message) {
  console.log(`  ✅ ${message}`)
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function walk(dir, exts, acc = []) {
  if (!existsSync(dir)) return acc
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      walk(full, exts, acc)
    } else if (exts.includes(extname(entry.name))) {
      acc.push(full)
    }
  }
  return acc
}

console.log('── A. 三端禁止 UTC 切片当墙钟 ──────────────────────────────────')

let scanned = 0
const hits = []
for (const spec of SCAN_DIRS) {
  const abs = join(repoRoot, spec.dir)
  const files = walk(abs, spec.exts)
  if (files.length === 0) {
    fail(`${spec.dir} 扫描到 0 个文件（门禁失效）`)
    continue
  }
  scanned += files.length
  for (const file of files) {
    const stripped = stripComments(readFileSync(file, 'utf8'))
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(stripped)) {
        hits.push(`${relative(repoRoot, file)} · ${rule.label}`)
      }
    }
  }
}
if (hits.length === 0) {
  pass(`三端 ${scanned} 个文件无 toISOString().slice / .slice(0,16).replace('T'`)
} else {
  for (const hit of hits) fail(hit)
}

console.log('\n── B. fmtSyncTime 输出 ISO 或带时区 ────────────────────────────')

const jobsShared = readFileSync(join(repoRoot, 'services/api/src/jobs/jobs-shared.ts'), 'utf8')
const fmtMatch = jobsShared.match(/export function fmtSyncTime\([^)]*\)\s*:\s*string\s*\{([\s\S]*?)\n\}/)
if (!fmtMatch) {
  fail('找不到 export function fmtSyncTime')
} else {
  const body = fmtMatch[1]
  if (/\.slice\s*\(/.test(body) || /\.replace\s*\(\s*['"]T['"]/.test(body)) {
    fail('fmtSyncTime 仍在 slice / replace T，会输出无时区 UTC 墙钟')
  } else {
    pass('fmtSyncTime 不再 slice / replace T')
  }
  if (/toISOString\s*\(/.test(body) || /\+08:00/.test(body) || /Asia\/Shanghai/.test(body)) {
    pass('fmtSyncTime 输出 ISO 或带时区')
  } else {
    fail('fmtSyncTime 既不是 toISOString() 也未标注时区')
  }
}

const sharedSrc = readFileSync(join(repoRoot, 'packages/shared/src/formatDateTime.ts'), 'utf8')
if (sharedSrc.includes("DISPLAY_TIMEZONE = 'Asia/Shanghai'") && /8 \* 60 \* 60 \* 1000/.test(sharedSrc)) {
  pass('packages/shared formatDateTime 固定 Asia/Shanghai')
} else {
  fail('packages/shared/src/formatDateTime.ts 未固定 Asia/Shanghai')
}

console.log('\n── C. 解析与上海墙钟（含历史无时区 UTC 串） ────────────────────')

const utcIso = '2026-06-20T01:00:00.000Z'
const naiveUtc = '2026-06-20 01:00'
const shanghaiIso = '2026-06-20T09:00:00+08:00'

const nativeNaive = new Date(naiveUtc)
if (Number.isNaN(nativeNaive.getTime())) {
  pass(`宿主 new Date('${naiveUtc}') 为 Invalid Date（与 Safari 同类）`)
} else {
  pass(`宿主 new Date('${naiveUtc}') 能解析（Chrome 口径）；共享解析仍按 UTC 读`)
}

if (isParseableInstant(utcIso) && isParseableInstant(naiveUtc) && isParseableInstant(shanghaiIso)) {
  pass('ISO / 历史无时区串 / +08:00 均可 parseInstant')
} else {
  fail(`parseInstant 失败：iso=${isParseableInstant(utcIso)} naive=${isParseableInstant(naiveUtc)} +08=${isParseableInstant(shanghaiIso)}`)
}

const expected = '2026-06-20 09:00'
for (const sample of [utcIso, naiveUtc, shanghaiIso]) {
  const got = formatDateTime(sample)
  if (got === expected) pass(`formatDateTime(${JSON.stringify(sample)}) → ${got}`)
  else fail(`formatDateTime(${JSON.stringify(sample)}) 得到 ${got}，期望 ${expected}`)
}

if (!isParseableInstant('') && !isParseableInstant('从未同步') && formatDateTime('从未同步') === '从未同步') {
  pass('空串 / 「从未同步」不冒充已解析时间')
} else {
  fail('哨兵字符串被当成时间解析')
}

const local = toDatetimeLocalValue(utcIso)
if (local === '2026-06-20T09:00') pass(`toDatetimeLocalValue UTC 01:00 → ${local}`)
else fail(`toDatetimeLocalValue 得到 ${local}，期望 2026-06-20T09:00`)

const roundtrip = fromDatetimeLocalValue(local)
if (roundtrip === utcIso) pass(`datetime-local 往返仍是 ${roundtrip}`)
else fail(`fromDatetimeLocalValue 往返得到 ${roundtrip}，期望 ${utcIso}`)

const instant = parseInstant(naiveUtc)
if (instant && instant.toISOString() === utcIso) pass('历史无时区串按 UTC 读，Safari 可解析路径不再依赖空格格式')
else fail(`parseInstant('${naiveUtc}').toISOString() = ${instant?.toISOString()}`)

const sourceTrust = readFileSync(join(repoRoot, 'apps/kiosk/src/pages/jobs/utils/sourceTrust.ts'), 'utf8')
const hasDateFn = sourceTrust.match(/function hasDate\([\s\S]*?\n\}/)
if (!hasDateFn) {
  fail('sourceTrust.ts 找不到 hasDate')
} else if (!/isParseableInstant\s*\(/.test(hasDateFn[0]) || /new Date\s*\(/.test(hasDateFn[0])) {
  fail('sourceTrust.hasDate 必须走 parseInstant，不得再用 new Date(无时区串)（Safari Invalid Date 会停用外跳）')
} else {
  pass('sourceTrust.hasDate 走 isParseableInstant，Safari 不再因空格 UTC 串误判缺失')
}

console.log('\n── D. 两后台时间显示不走本地时区 ──────────────────────────────')

const CONSOLE_DIRS = [
  { dir: 'apps/admin/src', exts: ['.ts', '.tsx'] },
  { dir: 'apps/partner/src', exts: ['.ts', '.tsx'] },
]
const LOCAL_TIME_RULES = [
  { label: 'toLocaleDateString(', pattern: /toLocaleDateString\s*\(/ },
  { label: 'toLocaleTimeString(', pattern: /toLocaleTimeString\s*\(/ },
  { label: 'new Date(...).toLocaleString(', pattern: /new Date\([^)\n]*\)\.toLocaleString\s*\(/ },
  { label: 'toLocaleString(locale, options)', pattern: /toLocaleString\s*\(\s*['"][^'"]*['"]\s*,/ },
  { label: '.slice(0, 10) 截 ISO 当日期', pattern: /\.slice\s*\(\s*0\s*,\s*10\s*\)/ },
]

function intlConstructors(source) {
  const found = []
  const re = /new Intl\.DateTimeFormat\s*\(/g
  let match
  while ((match = re.exec(source))) {
    let index = match.index + match[0].length
    let depth = 1
    while (index < source.length && depth > 0) {
      const ch = source[index]
      if (ch === '(') depth += 1
      else if (ch === ')') depth -= 1
      index += 1
    }
    found.push(source.slice(match.index, index))
  }
  return found
}

let consoleFiles = 0
const localHits = []
for (const spec of CONSOLE_DIRS) {
  const files = walk(join(repoRoot, spec.dir), spec.exts)
  if (files.length === 0) {
    fail(`${spec.dir} 扫描到 0 个文件（门禁失效）`)
    continue
  }
  consoleFiles += files.length
  for (const file of files) {
    const stripped = stripComments(readFileSync(file, 'utf8'))
    const rel = relative(repoRoot, file)
    for (const rule of LOCAL_TIME_RULES) {
      if (rule.pattern.test(stripped)) localHits.push(`${rel} · ${rule.label}`)
    }
    for (const ctor of intlConstructors(stripped)) {
      if (!/timeZone\s*:/.test(ctor)) localHits.push(`${rel} · Intl.DateTimeFormat 未指定 timeZone`)
    }
  }
}
if (localHits.length === 0) {
  pass(`管理员与合作机构 ${consoleFiles} 个文件无本地时区时间显示（数字 toLocaleString 仍允许）`)
} else {
  for (const hit of localHits) fail(hit)
}

console.log('\n── E. 相对时间、金额、数量、百分比 ────────────────────────────')

const relativeNow = new Date('2026-06-20T01:03:00.000Z')
const relativeGot = formatRelativeTime('2026-06-20T01:00:00.000Z', relativeNow)
if (relativeGot === '3 分钟前') pass(`formatRelativeTime → ${relativeGot}`)
else fail(`formatRelativeTime 得到 ${relativeGot}，期望 3 分钟前`)

const futureGot = formatRelativeTime('2026-06-20T02:00:00.000Z', relativeNow)
if (futureGot === '2026-06-20 10:00') pass(`未来时间改为完整北京时间 ${futureGot}`)
else fail(`未来相对时间得到 ${futureGot}，期望 2026-06-20 10:00`)

if (formatYuan(1234.5) === '¥1,234.50' && formatYuan(0) === '¥0.00' && formatYuan(-2) === '-¥2.00') {
  pass('formatYuan 两位小数、千分位、¥')
} else {
  fail(`formatYuan 异常：${formatYuan(1234.5)} / ${formatYuan(0)} / ${formatYuan(-2)}`)
}
if (formatCents(199) === '¥1.99' && formatCents(123456) === '¥1,234.56') {
  pass('formatCents 分转元')
} else {
  fail(`formatCents 异常：${formatCents(199)} / ${formatCents(123456)}`)
}
if (formatCount(1234567) === '1,234,567' && formatCount(12.9) === '12') {
  pass('formatCount 千分位并向零取整')
} else {
  fail(`formatCount 异常：${formatCount(1234567)} / ${formatCount(12.9)}`)
}
if (formatPercent(1, 3) === '33.3%' && formatPercent(1, 2) === '50.0%') {
  pass('formatPercent 一位小数')
} else {
  fail(`formatPercent 异常：${formatPercent(1, 3)} / ${formatPercent(1, 2)}`)
}
if (formatPercent(5, 0) === '—' && formatPercent(5, 0, '暂无') === '暂无') {
  pass('分母为 0 时不给百分比')
} else {
  fail(`分母为 0 得到 ${formatPercent(5, 0)} / ${formatPercent(5, 0, '暂无')}`)
}

if (failures > 0) {
  console.error(`\n❌ verify:datetime-honesty  ${failures} 项失败`)
  process.exit(1)
}
console.log('\nALL PASS')
