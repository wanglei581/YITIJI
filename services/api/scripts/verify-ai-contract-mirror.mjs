#!/usr/bin/env node
/**
 * AI 契约「手抄副本」一致性门禁。
 *
 * ── 这道门禁防的是什么 ────────────────────────────────────────────────────
 * services/api/src/ai/interfaces/ai-provider.interface.ts 是
 * packages/shared/src/types/ai.ts 的**手抄副本**：两边各写一遍同一批类型，
 * 靠 `// 改动须两处同步` 这句注释维持一致 —— 也就是靠人记得。
 *
 * 这与 `duplex` 丢失是同一类病（docs/reviews/field-gap-audit-2026-09-02.md 第一节）：
 * 写入侧改了、读取侧没改，两边各自 typecheck 都绿，缺口要等用户看不到字段才暴露。
 * 本脚本把「记得同步」变成可执行断言。
 *
 * ── 怎么比对 ─────────────────────────────────────────────────────────────
 * 1. 剥掉两份源码里的注释（副本允许各写各的注释，只有**结构**必须一致）；
 * 2. 按 `export interface/type/const/function/enum <Name>` 切出顶层声明；
 * 3. 归一化：去掉全部空白，并把联合类型的前导 `|` 抹平
 *    （`= | 'a' | 'b'` 与 `= 'a' | 'b'` 在 TS 里等价，只是排版差异）；
 * 4. 三条断言：
 *    A. 从若干**根类型**出发做引用闭包（ResumeReport → ResumeIssue → …），
 *       两边闭包的**名字集合**必须相同，且每个声明逐字相同。
 *       新增一个被 ResumeReport 引用的类型却只加在一侧 → 这里红。
 *    B. 两份文件里**同名**的声明，一律必须逐字相同（覆盖根闭包之外的手抄面）。
 *    C. 每个根类型两边都必须存在（catch 单侧删除）。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:ai-contract-mirror
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const repo = resolve(here, '../../..')

const SHARED = 'packages/shared/src/types/ai.ts'
const MIRROR = 'services/api/src/ai/interfaces/ai-provider.interface.ts'

/**
 * 引用闭包的根。选取标准：**跨进程传输的契约**（前端读得到的报告 / 结果结构）。
 * 只在服务端存在的 provider 入参出参（ParseResumeInput 等）不是手抄面，不设根。
 */
const ROOTS = [
  'AiTaskStatus',
  'AiProviderName',
  'ResumeReport',
  'ResumeTargetContext',
  'ResumeOptimizeModule',
  'ResumeGenerateInput',
  'GeneratedResume',
  'ResumeLayoutSettings',
  'AssistantIntent',
  'AssistantSkill',
  'AssistantAction',
]

let failed = 0
function check(condition, message) {
  if (condition) console.log(`  PASS ${message}`)
  else { console.error(`  FAIL ${message}`); failed++ }
}

/** 剥注释：识别 '、"、` 三种字符串，避免误伤字符串里的 // 与 /*。 */
function stripComments(src) {
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      out += ch
      i++
      while (i < src.length) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue }
        out += src[i]
        if (src[i] === quote) { i++; break }
        i++
      }
      continue
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += ch
    i++
  }
  return out
}

const DECL_RE = /^export\s+(?:declare\s+)?(?:abstract\s+)?(interface|type|const|function|enum|class)\s+([A-Za-z_$][\w$]*)/gm

/** 切出顶层 export 声明：从声明起始位置到下一个顶层 export（或文件末尾）。 */
function declarations(source) {
  const src = stripComments(source)
  const starts = []
  DECL_RE.lastIndex = 0
  let m
  while ((m = DECL_RE.exec(src)) !== null) starts.push({ index: m.index, name: m[2] })
  const map = new Map()
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].index : src.length
    map.set(starts[i].name, src.slice(starts[i].index, end).trim())
  }
  return map
}

/** 归一化：去空白 + 抹平联合类型的前导竖线（排版差异不算漂移）。 */
function normalize(text) {
  return text.replace(/\s+/g, '').replace(/=\|/g, '=')
}

/** 声明体里引用到的、且在同一文件里有定义的名字。 */
function referencedNames(text, known) {
  const out = new Set()
  for (const token of text.match(/[A-Za-z_$][\w$]*/g) ?? []) {
    if (known.has(token)) out.add(token)
  }
  return out
}

/** 从根出发的引用闭包（含根本身）。 */
function closureOf(root, decls) {
  const seen = new Set()
  const queue = [root]
  while (queue.length > 0) {
    const name = queue.pop()
    if (!name || seen.has(name) || !decls.has(name)) continue
    seen.add(name)
    for (const ref of referencedNames(decls.get(name), decls)) {
      if (!seen.has(ref)) queue.push(ref)
    }
  }
  return seen
}

const sharedDecls = declarations(readFileSync(resolve(repo, SHARED), 'utf8'))
const mirrorDecls = declarations(readFileSync(resolve(repo, MIRROR), 'utf8'))

console.log('\n=== AI 契约手抄副本一致性（shared/types/ai.ts ↔ ai-provider.interface.ts）===')
check(
  sharedDecls.size > 0 && mirrorDecls.size > 0,
  `两份文件都解析出顶层声明（shared=${sharedDecls.size} / mirror=${mirrorDecls.size}）`,
)

// ── A + C：根类型存在性 与 引用闭包一致性 ────────────────────────────────
for (const root of ROOTS) {
  if (!sharedDecls.has(root) || !mirrorDecls.has(root)) {
    check(false, `根类型 ${root} 两侧都存在（shared=${sharedDecls.has(root)} / mirror=${mirrorDecls.has(root)}）`)
    continue
  }
  const sharedClosure = [...closureOf(root, sharedDecls)].sort()
  const mirrorClosure = [...closureOf(root, mirrorDecls)].sort()
  const onlyShared = sharedClosure.filter((n) => !mirrorClosure.includes(n))
  const onlyMirror = mirrorClosure.filter((n) => !sharedClosure.includes(n))
  check(
    onlyShared.length === 0 && onlyMirror.length === 0,
    `${root} 引用闭包名字集合一致（${sharedClosure.length} 个）`
      + (onlyShared.length ? ` — 只在 shared: ${onlyShared.join(',')}` : '')
      + (onlyMirror.length ? ` — 只在 mirror: ${onlyMirror.join(',')}` : ''),
  )
}

// ── B：所有同名声明必须逐字一致（注释与排版差异已归一化掉）────────────────
const drifted = []
let comparedCount = 0
for (const [name, sharedText] of sharedDecls) {
  const mirrorText = mirrorDecls.get(name)
  if (mirrorText === undefined) continue // 只在一侧存在的（HTTP DTO / provider 接口）不是手抄面
  comparedCount++
  if (normalize(sharedText) !== normalize(mirrorText)) drifted.push(name)
}
check(comparedCount >= ROOTS.length, `同名声明比对覆盖 ${comparedCount} 个类型`)
check(drifted.length === 0, `同名声明结构一致，无手抄漂移${drifted.length ? ` — 漂移：${drifted.join(', ')}` : ''}`)

if (drifted.length > 0) {
  for (const name of drifted) {
    console.error(`\n  ── ${name} ──`)
    console.error(`  ${SHARED}\n    ${normalize(sharedDecls.get(name))}`)
    console.error(`  ${MIRROR}\n    ${normalize(mirrorDecls.get(name))}`)
  }
}

if (failed > 0) {
  console.error(`\n=== FAILED (${failed}) ===\n`)
  process.exit(1)
}
console.log('\n=== ALL PASS ===\n')
