/**
 * 首页岗位磁贴四态合同。
 *
 * 生产上招聘会卡会说「暂无场次」，岗位卡却写死「第三方来源」——接口 total=0
 * 时用户要点三下才知道没有岗位。本门禁钉的是行为，不是某句中文：
 *
 * 1. jobCopy 对 loading / ready / empty / error 各有文案分支，且 error ≠ empty
 *    （「没取到」不得显示成「确实没有」）。
 *    变异：把 error 文案改成与 empty 相同 → 红。
 * 2. useHomeJobHighlight 不得再读 reviewStatus / publishStatus
 *    （公开列表 DTO 不下发这两个字段，客户端一比就全员不合格）。
 *    变异：对 response.data 按 item.reviewStatus 过滤 → 红。
 * 3. hook 必须调用列表页同一个 getJobs，且**不按 category 收窄**（卡片覆盖整个岗位域），pageSize 只取计数，
 *    只读 pagination.total；不得另写 fetch。
 *    变异：改成 fetch(...) 或丢掉 getJobs 导入 → 红。
 *
 * 运行：pnpm --filter @ai-job-print/kiosk verify:home-jobs-availability
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const read = (abs) => readFileSync(abs, 'utf8')

const VIEW_PATH = join(SRC, 'pages/home/components/QxHomeView.tsx')
const HOOK_PATH = join(SRC, 'pages/home/hooks/useHomeJobHighlight.ts')
const HOME_PATH = join(SRC, 'pages/home/HomePage.tsx')
const LIST_PATH = join(SRC, 'pages/jobs/JobsPage.tsx')

let failed = 0
function pass(msg) {
  console.log(`  PASS ${msg}`)
}
function fail(msg) {
  console.error(`  FAIL ${msg}`)
  failed++
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1')
}

function indexOfMatchingParen(src, openIndex) {
  let depth = 0
  for (let i = openIndex; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function indexOfFunctionBody(src, name) {
  const start = src.search(new RegExp(`function\\s+${name}\\s*\\(`))
  if (start < 0) return -1
  const openParen = src.indexOf('(', start)
  const closeParen = indexOfMatchingParen(src, openParen)
  if (closeParen < 0) return -1
  let i = closeParen + 1
  while (i < src.length && /\s/.test(src[i])) i++
  if (src[i] === ':') {
    i++
    let typeDepth = 0
    let startedObjectType = false
    while (i < src.length) {
      const ch = src[i]
      if (ch === '{') {
        if (!startedObjectType && typeDepth === 0) {
          const rest = src.slice(i + 1, i + 80)
          if (/^\s*(if|return|const|let|var|void)\b/.test(rest)) return i
          startedObjectType = true
        }
        typeDepth++
      } else if (ch === '}') {
        typeDepth--
        if (startedObjectType && typeDepth === 0) {
          i++
          while (i < src.length && /\s/.test(src[i])) i++
          return src[i] === '{' ? i : -1
        }
      }
      i++
    }
    return -1
  }
  return src[i] === '{' ? i : -1
}

function extractNamedFunction(src, name) {
  const start = src.search(new RegExp(`function\\s+${name}\\s*\\(`))
  const brace = indexOfFunctionBody(src, name)
  if (start < 0 || brace < 0) return null
  let depth = 0
  let inSingle = false
  let inDouble = false
  let inTemplate = false
  let escaped = false
  for (let i = brace; i < src.length; i++) {
    const ch = src[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\' && (inSingle || inDouble || inTemplate)) {
      escaped = true
      continue
    }
    if (inSingle) {
      if (ch === "'") inSingle = false
      continue
    }
    if (inDouble) {
      if (ch === '"') inDouble = false
      continue
    }
    if (inTemplate) {
      if (ch === '`') inTemplate = false
      continue
    }
    if (ch === "'") {
      inSingle = true
      continue
    }
    if (ch === '"') {
      inDouble = true
      continue
    }
    if (ch === '`') {
      inTemplate = true
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return null
}

function extractObjectLiteral(src, fromIndex) {
  const start = src.indexOf('{', fromIndex)
  if (start < 0) return null
  let depth = 0
  let inSingle = false
  let inDouble = false
  let inTemplate = false
  let escaped = false
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\' && (inSingle || inDouble || inTemplate)) {
      escaped = true
      continue
    }
    if (inSingle) {
      if (ch === "'") inSingle = false
      continue
    }
    if (inDouble) {
      if (ch === '"') inDouble = false
      continue
    }
    if (inTemplate) {
      if (ch === '`') inTemplate = false
      continue
    }
    if (ch === "'") {
      inSingle = true
      continue
    }
    if (ch === '"') {
      inDouble = true
      continue
    }
    if (ch === '`') {
      inTemplate = true
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return null
}

function parseReturnFields(objSrc) {
  const desc = objSrc.match(/description\s*:\s*((?:`[\s\S]*?`|'[^']*'|"[^"]*"|[^,}\n]+))/)
  const badge = objSrc.match(/badge\s*:\s*((?:`[\s\S]*?`|'[^']*'|"[^"]*"|[^,}\n]+))/)
  return {
    descriptionRaw: desc ? desc[1].trim() : null,
    badgeRaw: badge ? badge[1].trim() : null,
  }
}

function quotedValue(raw) {
  if (!raw) return null
  const t = raw.trim()
  if (t.startsWith('`') && t.endsWith('`')) return t.slice(1, -1)
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1)
  }
  return t
}

function parseJobCopyBranches(fnSrc) {
  const branches = {}
  const ifRe = /if\s*\(\s*state\.status\s*===\s*'(ready|loading|error|empty)'\s*\)/g
  const matches = [...fnSrc.matchAll(ifRe)]
  for (let i = 0; i < matches.length; i++) {
    const status = matches[i][1]
    const afterIf = matches[i].index + matches[i][0].length
    const nextIf = i + 1 < matches.length ? matches[i + 1].index : fnSrc.length
    const returnIdx = fnSrc.indexOf('return', afterIf)
    if (returnIdx < 0 || returnIdx > nextIf) continue
    const obj = extractObjectLiteral(fnSrc, returnIdx)
    if (obj) branches[status] = parseReturnFields(obj)
  }
  if (!branches.empty && matches.length > 0) {
    let searchFrom = 0
    let lastReturnIdx = -1
    let lastObj = null
    while (true) {
      const idx = fnSrc.indexOf('return', searchFrom)
      if (idx < 0) break
      const obj = extractObjectLiteral(fnSrc, idx)
      if (obj) {
        lastReturnIdx = idx
        lastObj = obj
      }
      searchFrom = idx + 6
    }
    const lastIfReturn = fnSrc.indexOf('return', matches[matches.length - 1].index)
    if (lastObj && lastReturnIdx > lastIfReturn) {
      branches.empty = parseReturnFields(lastObj)
    }
  }
  return branches
}

function findGetJobsImport(src, fromFile) {
  const re = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g
  for (const match of src.matchAll(re)) {
    const names = match[1].split(',').map((part) => part.trim().split(/\s+as\s+/)[0].trim())
    if (names.includes('getJobs')) {
      const spec = match[2]
      if (spec.startsWith('.')) return normalize(join(dirname(fromFile), spec))
      return spec
    }
  }
  return null
}

function resolveTsModule(resolved) {
  for (const ext of ['', '.ts', '/index.ts']) {
    const candidate = resolved + ext
    if (existsSync(candidate)) return candidate
  }
  return null
}

function sameJobsModule(listResolved, hookResolved) {
  if (listResolved === hookResolved) return true
  const [a, b] = [listResolved, hookResolved].sort()
  if (b !== `${a}/jobs`) return false
  const barrelFile = resolveTsModule(a)
  if (!barrelFile) return false
  return /export\s+\*\s+from\s+['"]\.\/jobs['"]/.test(read(barrelFile))
}

function extractGetJobsObject(src) {
  const calls = [...src.matchAll(/getJobs\(\s*(\{)/g)]
  return calls.map((match) => extractObjectLiteral(src, match.index + match[0].length - 1))
}

console.log('\n=== 首页岗位磁贴四态合同 ===')

const viewSrc = read(VIEW_PATH)
const hookSrc = read(HOOK_PATH)
const homeSrc = read(HOME_PATH)
const listSrc = read(LIST_PATH)
const viewCode = stripComments(viewSrc)
const hookCode = stripComments(hookSrc)
const listCode = stripComments(listSrc)

const jobCopyFn = extractNamedFunction(viewCode, 'jobCopy')
if (!jobCopyFn) {
  fail('1. QxHomeView 缺少 jobCopy()')
} else {
  pass('1. QxHomeView 定义了 jobCopy()')
  const branches = parseJobCopyBranches(jobCopyFn)
  for (const status of ['loading', 'ready', 'empty', 'error']) {
    if (branches[status]?.descriptionRaw) pass(`1.${status} 有独立 description 分支`)
    else fail(`1.${status} 缺少独立 description 分支`)
  }
  const loadingDesc = quotedValue(branches.loading?.descriptionRaw)
  const emptyDesc = quotedValue(branches.empty?.descriptionRaw)
  const errorDesc = quotedValue(branches.error?.descriptionRaw)
  if (errorDesc && emptyDesc && errorDesc !== emptyDesc) {
    pass('1.error 文案 ≠ empty 文案（没取到 ≠ 确实没有）')
  } else {
    fail(`1.error 文案必须不同于 empty（error=${JSON.stringify(errorDesc)} empty=${JSON.stringify(emptyDesc)}）`)
  }
  if (loadingDesc && emptyDesc && loadingDesc !== emptyDesc) {
    pass('1.loading 文案 ≠ empty 文案（不得先显示暂无再跳变）')
  } else {
    fail(`1.loading 文案必须不同于 empty（loading=${JSON.stringify(loadingDesc)} empty=${JSON.stringify(emptyDesc)}）`)
  }
  const readyBadge = branches.ready?.badgeRaw ?? ''
  if (/\btotal\b/.test(readyBadge)) pass('1.ready 徽章引用接口 total，不写死数量')
  else fail('1.ready 徽章必须引用 total（写死「12 个在招」或「第三方来源」会红）')
}

if (/jobCopy\s*\(\s*jobs\s*\)/.test(viewCode) && /\{job\.description\}/.test(viewSrc) && /\{job\.badge\}/.test(viewSrc)) {
  pass('1.岗位卡实际渲染 jobCopy 的 description / badge')
} else {
  fail('1.岗位卡必须渲染 jobCopy(jobs) 的 description 与 badge（只定义函数不接线会红）')
}

if (/\.reviewStatus\b|\.publishStatus\b|\[['"]reviewStatus['"]\]|\[['"]publishStatus['"]\]/.test(hookCode)) {
  fail('2. hook 读取了 reviewStatus / publishStatus（公开列表 DTO 不下发这两个字段）')
} else {
  pass('2. hook 不读取 reviewStatus / publishStatus')
}

const listImport = findGetJobsImport(listSrc, LIST_PATH)
const hookImport = findGetJobsImport(hookSrc, HOOK_PATH)
if (!listImport) fail('3. JobsPage 未从模块导入 getJobs')
else pass('3. JobsPage 导入 getJobs')
if (!hookImport) fail('3. useHomeJobHighlight 未从模块导入 getJobs')
else pass('3. useHomeJobHighlight 导入 getJobs')
if (listImport && hookImport && sameJobsModule(listImport, hookImport)) {
  pass('3. hook 与列表页导入的是同一个 getJobs 模块')
} else {
  fail(`3. hook 必须复用列表页 getJobs（list=${listImport} hook=${hookImport}）`)
}

if (/\bfetch\s*\(/.test(hookCode)) fail('3. hook 另写了 fetch，没有走列表页 getJobs')
else pass('3. hook 没有另写 fetch')

const listObjects = extractGetJobsObject(listCode).filter((obj) => obj && /category\s*:/.test(obj))
const hookObjects = extractGetJobsObject(hookCode)
const listListQuery = listObjects[0]
const hookQuery = hookObjects[0]
if (!listListQuery) fail('3. JobsPage 列表查询没有带 category 的 getJobs 调用')
else pass('3. JobsPage 列表查询把 category 传给 getJobs')
if (!hookQuery) fail('3. hook 没有 getJobs({...}) 调用')
else pass('3. hook 通过对象参数调用 getJobs')

// 卡片覆盖整个岗位域（服务台下有全职/实习/兼职/全部四个入口），
// 因此 hook **不得**按 category 收窄 —— 只数其中一类，另一类有内容时
// 卡片会写「暂无岗位」，用户就不点了，比不显示还糟。
if (hookQuery && /category\s*:/.test(hookQuery)) {
  fail(`3. hook 不得按 category 收窄（卡片代表整个岗位域，服务台下有全职/实习/兼职/全部四个入口）。实际: ${hookQuery}`)
} else {
  pass('3. hook 不按 category 收窄,与「全部岗位」同构')
}

// pageSize 不参与 total 计算（服务端 count 独立于 skip/take），
// 所以只要求它「小」——首页为显示一个数字不该把整页数据拉回来。
const hookPageSize = Number(hookQuery?.match(/pageSize\s*:\s*(\d+)/)?.[1] ?? NaN)
if (Number.isFinite(hookPageSize) && hookPageSize <= 5) {
  pass(`3. hook pageSize=${hookPageSize}（只取计数,不拉整页）`)
} else {
  fail(`3. hook 只需要 pagination.total,pageSize 应 ≤5;实际 ${hookQuery}`)
}

if (/pagination\s*\.\s*total/.test(hookCode)) pass('3. hook 只按 pagination.total 判断有无岗位')
else fail('3. hook 必须读 pagination.total（改用 data.length 或自估数量会红）')

if (homeSrc.includes('useHomeJobHighlight()') && homeSrc.includes('jobs={jobs}')) {
  pass('3. HomePage 接入 useHomeJobHighlight 并传给 QxHomeView')
} else {
  fail('3. HomePage 必须调用 useHomeJobHighlight() 且 jobs={jobs}（写死 empty 会红）')
}

if (failed > 0) {
  console.error(`\n=== FAILED (${failed} 项) ===`)
  process.exit(1)
}

console.log('\n=== ALL PASS ===')
