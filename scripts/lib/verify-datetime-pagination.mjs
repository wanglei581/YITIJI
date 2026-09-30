import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildPageList } from '../../packages/ui/src/components/consolePageList.ts'

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
export function datetimeSliceViolations(source) {
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


export function runDatetimeSliceChecks({ pass, fail }) {
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
}

export function runPaginationTableGuards({ repoRoot, pass, fail }) {
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
  
}
