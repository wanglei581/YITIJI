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
 *   G. 两后台 JSX 里的相对时间，所在元素（同一行或上一行开标签）必须带 title=
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
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
import { buildPageList } from '../packages/ui/src/components/consolePageList.ts'

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

const weekday = formatDateTime('2026-09-29T16:00:00.000Z', { style: 'zh-date-weekday' })
if (weekday === '2026年9月30日 星期三') pass(`带星期的中文长日期 → ${weekday}`)
else fail(`zh-date-weekday 得到 ${weekday}，期望 2026年9月30日 星期三`)
if (sharedSrc.includes('getUTCDay()')) pass('星期取自上海墙钟的 getUTCDay')
else fail('星期必须按 Asia/Shanghai 的 getUTCDay 计算，不能用本地 getDay')

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
]

/** 拆成驼峰词和下划线词之后，词本身是这些才算日期时间。子串不算（candidate、update、validate 不中）。 */
const DATE_TIME_WORDS = new Set(['at', 'date', 'time', 'day', 'datetime', 'timestamp'])

/** 穿过这些方法继续往左，它们不代表右边是日期。toISOString() 不在此列。 */
const PASSTHROUGH_METHODS = new Set([
  'toString',
  'trim',
  'trimStart',
  'trimEnd',
  'substring',
  'substr',
  'toLowerCase',
  'toUpperCase',
  'valueOf',
  'normalize',
])

function skipWsLeft(source, index) {
  let i = index
  while (i >= 0 && /\s/.test(source[i])) i -= 1
  return i
}

function matchParen(source, closeAt) {
  let depth = 0
  for (let i = closeAt; i >= 0; i -= 1) {
    const ch = source[i]
    if (ch === ')') depth += 1
    else if (ch === '(') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** 反引号模板：取 ${} 里的表达式。没有这段时，.slice 左边停在反引号上，收成空串。 */
function templateExpressionsEndingAt(source, endBacktick) {
  let i = endBacktick - 1
  let depth = 0
  let start = 0
  while (i >= 0) {
    const ch = source[i]
    if (ch === '`' && source[i - 1] !== '\\' && depth === 0) {
      start = i
      break
    }
    if (ch === '}') depth += 1
    else if (ch === '{' && source[i - 1] === '$') {
      if (depth > 0) depth -= 1
      i -= 1
    }
    i -= 1
  }
  const literal = source.slice(start, endBacktick + 1)
  const exprs = []
  let cursor = 0
  while (cursor < literal.length) {
    if (literal[cursor] === '$' && literal[cursor + 1] === '{') {
      cursor += 2
      const exprStart = cursor
      let braces = 1
      while (cursor < literal.length && braces > 0) {
        if (literal[cursor] === '{') braces += 1
        else if (literal[cursor] === '}') braces -= 1
        if (braces > 0) cursor += 1
      }
      exprs.push(literal.slice(exprStart, cursor))
      cursor += 1
    } else {
      cursor += 1
    }
  }
  return exprs.join(' ')
}

/**
 * `.method(` 才算方法链。String(...) / (expr) 没有点，返回 null，调用方改看括号里。
 * continueFrom 落在点（或 ?.）左边那个字符上。
 */
function methodCallBefore(source, openParen) {
  let j = skipWsLeft(source, openParen - 1)
  if (j < 0 || !/[\w$]/.test(source[j])) return null
  const end = j + 1
  while (j >= 0 && /[\w$]/.test(source[j])) j -= 1
  const name = source.slice(j + 1, end)
  const dot = skipWsLeft(source, j)
  if (dot < 0 || source[dot] !== '.') return null
  const continueFrom = dot - 1 >= 0 && source[dot - 1] === '?' ? dot - 2 : dot - 1
  return { name, continueFrom }
}

function readMember(source, index) {
  const end = index + 1
  let i = index
  while (i >= 0 && /[\w$.?[\]'"]/.test(source[i])) i -= 1
  return source.slice(i + 1, end)
}

/** 只看 .slice 左边那个表达式。方法链、模板、String() 和括号会继续往左拆。 */
function receiverBeforeSlice(source, sliceAt) {
  return readReceiver(source, sliceAt - 1)
}

function readReceiver(source, index) {
  const i = skipWsLeft(source, index)
  if (i < 0) return ''
  if (source[i] === '`') return templateExpressionsEndingAt(source, i)
  if (source[i] === ')') {
    const open = matchParen(source, i)
    if (open < 0) return ''
    const method = methodCallBefore(source, open)
    if (method && PASSTHROUGH_METHODS.has(method.name)) {
      return readReceiver(source, method.continueFrom)
    }
    if (method) return readMember(source, method.continueFrom) + source.slice(method.continueFrom + 1, i + 1)
    return source.slice(open + 1, i).trim()
  }
  return readMember(source, i)
}

function dateTimeWords(name) {
  const words = []
  for (const part of name.split(/_+/)) {
    if (!part) continue
    const pieces = part
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/\s+/)
    for (const piece of pieces) {
      if (piece) words.push(piece.toLowerCase())
    }
  }
  return words
}

function nameIsDateTime(name) {
  return dateTimeWords(name).some((word) => DATE_TIME_WORDS.has(word))
}

function sliceTargetsDateTime(receiver) {
  if (/toISOString\s*\(/.test(receiver)) return true
  const names = receiver.match(/[A-Za-z_$][\w$]*/g) ?? []
  return names.some((name) => nameIsDateTime(name))
}

/** 只拦对日期时间字段或 toISOString() 结果做 slice(0, 10)。编号前缀不算。 */
function datetimeSliceViolations(source) {
  const hits = []
  const re = /\.slice\s*\(\s*0\s*,\s*10\s*\)/g
  let match
  while ((match = re.exec(source))) {
    const receiver = receiverBeforeSlice(source, match.index)
    if (!sliceTargetsDateTime(receiver)) continue
    const line = source.slice(0, match.index).split('\n').length
    hits.push({ line, receiver })
  }
  return hits
}

const benignSlice = [
  'const prefix = orderNo.slice(0, 10)',
  'const head = serial.slice(0, 10)',
  'const code = candidateCode.slice(0, 10)',
  'const batch = updateBatchNo.slice(0, 10)',
  'const token = validateToken.slice(0, 10)',
]
const datedSlice = [
  'const day = createdAt.slice(0, 10)',
  'const iso = value.toISOString().slice(0, 10)',
  'const start = row.startDate.slice(0, 10)',
  'const seen = updatedAt?.slice(0, 10)',
  'const tpl = `${row.createdAt}`.slice(0, 10)',
  'const str = item.createdAt.toString().slice(0, 10)',
  'const snake = row.created_at.slice(0, 10)',
  'const cast = String(x.updatedAt).slice(0, 10)',
  "const nil = (row.updatedAt ?? '').slice(0, 10)",
  'const trimmed = row.updatedAt.trim().slice(0, 10)',
  'const cut = item.loginTime.substring(0, 20).slice(0, 10)',
]
const benignHits = datetimeSliceViolations(benignSlice.join('\n'))
const datedHits = datetimeSliceViolations(datedSlice.join('\n'))
if (benignHits.length === 0) pass('普通字符串 slice(0, 10)（编号前缀，含 candidate / update / validate）不误报')
else fail(`普通编号前缀被误报：${benignHits.map((hit) => hit.receiver).join(', ')}`)
if (datedHits.length === datedSlice.length) pass(`日期字段与 toISOString() 的 slice(0, 10) 仍会拦（${datedSlice.length} 处）`)
else fail(`日期字段 slice 应拦 ${datedSlice.length} 处，实际 ${datedHits.length}：${datedHits.map((hit) => hit.receiver).join(' | ')}`)

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
    for (const hit of datetimeSliceViolations(stripped)) {
      localHits.push(`${rel}:${hit.line} · 对日期时间做 slice(0, 10)（${hit.receiver}）`)
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
if (
  formatYuan(-0.004) === '¥0.00' &&
  formatYuan(-0.004, { precision: 4 }) === '-¥0.0040' &&
  formatCents(-0.4) === '¥0.00' &&
  formatCents(-40) === '-¥0.40' &&
  formatCount(-0.5) === '0' &&
  formatCount(-1.2) === '-1'
) {
  pass('取整后为 0 不带负号，金额可指定 4 位小数')
} else {
  fail(`负零或精度异常：${formatYuan(-0.004)} / ${formatYuan(-0.004, { precision: 4 })} / ${formatCents(-0.4)} / ${formatCount(-0.5)}`)
}

const relativeCallers = [
  'apps/admin/src/routes/dashboard/index.tsx',
  'apps/admin/src/routes/account-settings/index.tsx',
  'apps/admin/src/routes/printers/index.tsx',
  'apps/admin/src/routes/peripherals/index.tsx',
  'apps/admin/src/routes/terminals/index.tsx',
  'apps/partner/src/routes/terminals/terminalOpsFormat.ts',
]
for (const rel of relativeCallers) {
  const src = readFileSync(join(repoRoot, rel), 'utf8')
  if (src.includes('formatRelativeTime(')) pass(`${rel} 相对时间走 formatRelativeTime`)
  else fail(`${rel} 仍在本地计算相对时间`)
}

console.log('\n── F. 分页页码与表格固定列 ────────────────────────────────────')

const pageCases = [
  [7, 1, '1,2,3,4,5,6,7'],
  [7, 2, '1,2,3,4,5,6,7'],
  [7, 4, '1,2,3,4,5,6,7'],
  [7, 7, '1,2,3,4,5,6,7'],
  [8, 1, '1,2,3,4,5,ellipsis,8'],
  [8, 2, '1,2,3,4,5,ellipsis,8'],
  [8, 4, '1,2,3,4,5,ellipsis,8'],
  [8, 8, '1,ellipsis,4,5,6,7,8'],
  [20, 1, '1,2,3,4,5,ellipsis,20'],
  [20, 2, '1,2,3,4,5,ellipsis,20'],
  [20, 4, '1,2,3,4,5,ellipsis,20'],
  [20, 10, '1,ellipsis,9,10,11,ellipsis,20'],
  [20, 20, '1,ellipsis,16,17,18,19,20'],
]
let pageMismatch = 0
for (const [total, current, expectedPages] of pageCases) {
  const gotPages = buildPageList(current, total).join(',')
  if (gotPages !== expectedPages) {
    pageMismatch += 1
    fail(`buildPageList(${current}, ${total}) = ${gotPages}，期望 ${expectedPages}`)
  }
}
if (pageMismatch === 0) pass(`页码列表 ${pageCases.length} 组（7/8/20 页的首页、第 2 页、第 4 页、中间、末页）`)

const tableSrc = readFileSync(join(repoRoot, 'packages/ui/src/components/ConsoleTable.tsx'), 'utf8')
const stickyLines = tableSrc.split('\n').filter((line) => line.includes('column.sticky'))
const inheritLine = stickyLines.find((line) => line.includes('bg-inherit'))
if (inheritLine && inheritLine.includes('border-neutral-900/[0.06]') && !inheritLine.includes('bg-surface')) {
  pass('固定列继承行背景，并用现有淡分隔')
} else {
  fail(`固定列背景不符合：${inheritLine ?? stickyLines.join(' | ')}`)
}
if (tableSrc.includes("column.truncate && 'max-w-64 truncate'") && !tableSrc.includes('max-w-[16rem]')) {
  pass('截断写在单元格内层 div 的 max-w-64')
} else {
  fail('截断应是内层 div 的 max-w-64，而不是单元格上的任意宽度')
}

console.log('\n── G. 相对时间悬停要带完整时间 ────────────────────────────────')

const RELATIVE_TIME_FNS = new Set(['relTime', 'relativeTime', 'formatLoginTime', 'formatRelativeTime'])

function relativeCallName(expr) {
  if (ts.isIdentifier(expr)) return expr.text
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text
  return ''
}

function insideJsx(node) {
  let current = node.parent
  while (current) {
    if (
      ts.isJsxExpression(current)
      || ts.isJsxElement(current)
      || ts.isJsxSelfClosingElement(current)
      || ts.isJsxFragment(current)
    ) return true
    current = current.parent
  }
  return false
}

function lineHasTitle(line) {
  return /\btitle\s*=/.test(line)
}

/** JSX 里的相对时间：同一行或上一行开标签必须写 title=。函数体和普通字符串不算。 */
function relativeTimeTitleViolations(fileName, source) {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const lines = source.split('\n')
  const hits = []
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const name = relativeCallName(node.expression)
      if (RELATIVE_TIME_FNS.has(name) && insideJsx(node)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        const same = lines[line] ?? ''
        const prev = line > 0 ? (lines[line - 1] ?? '') : ''
        if (!lineHasTitle(same) && !lineHasTitle(prev)) hits.push({ line: line + 1, name })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

function expectTitleHits(label, source, expected) {
  const hits = relativeTimeTitleViolations('sample.tsx', source)
  if (hits.length === expected) pass(label)
  else fail(`${label}：期望 ${expected} 处，实际 ${hits.length}`)
}

expectTitleHits(
  '相对时间开标签带 title 不报',
  '<span title={formatDateTime(log.createdAt)}>\n  {relTime(log.createdAt)}\n</span>',
  0,
)
expectTitleHits(
  '去掉相对时间外层 title 会报出这一处',
  '<span>\n  {relTime(log.createdAt)}\n</span>',
  1,
)
expectTitleHits(
  '同一行开标签带 title 不报',
  '<p title={formatDateTime(row.at)}>{relativeTime(row.at)}</p>',
  0,
)
expectTitleHits(
  '函数体和拼进普通字符串的相对时间不按 JSX 检查',
  'function relTime(iso: string) {\n  return formatRelativeTime(iso)\n}\nconst sub = `意见 · ${relTime(alert.occurredAt)}`',
  0,
)

let titleFiles = 0
const titleHits = []
for (const spec of CONSOLE_DIRS) {
  const files = walk(join(repoRoot, spec.dir), spec.exts)
  if (files.length === 0) {
    fail(`${spec.dir} 扫描到 0 个文件（相对时间 title 门禁失效）`)
    continue
  }
  titleFiles += files.length
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const rel = relative(repoRoot, file)
    for (const hit of relativeTimeTitleViolations(rel, source)) {
      titleHits.push(`${rel}:${hit.line} · JSX 里的 ${hit.name}() 所在元素没有 title=`)
    }
  }
}
if (titleHits.length === 0) pass(`管理员与合作机构 ${titleFiles} 个文件里，JSX 中的相对时间都带 title=`)
else for (const hit of titleHits) fail(hit)

if (failures > 0) {
  console.error(`\n❌ verify:datetime-honesty  ${failures} 项失败`)
  process.exit(1)
}
console.log('\nALL PASS')
