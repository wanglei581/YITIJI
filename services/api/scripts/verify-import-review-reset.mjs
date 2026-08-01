#!/usr/bin/env node
/**
 * verify-import-review-reset.mjs
 *
 * 静态分析：确认 Partner/Excel 主动导入的 upsert update 块
 * 一律包含 reviewStatus:'pending' + publishStatus:'draft'（强制重审），
 * 并清空 rejectReason/reviewedBy/reviewedAt 审核元数据。
 *
 * ⚠️ 关于 job-sync.service.ts 的反向断言（务必读完再改）
 *
 * 本脚本断言 job-sync（API 定时拉取）的 update 块**不含**无条件重置。
 * 这条断言**不是**在声明当前实现正确，而是把一个**已登记的 P0 缺口**冻结住：
 *
 *   现状缺口：自动拉取会改写已 approved+published 记录的 title/company/
 *   description/sourceUrl 等展示字段，却保留审核发布态，因此内容变更后
 *   继续对外公开而不重新过审。详见 docs/governance/standards-index.md 第十一节。
 *
 * 断言存在的理由：防止有人为"统一风格"把这里改成**无条件** pending 重置——
 * 那会让每晚 Cron 把全部已审记录退回待审，压垮审核队列。
 *
 * 👉 如果你正在实施正解（按内容哈希判定：内容未变只更新 syncTime、
 *    展示字段变化才退审），那么这条断言需要同步放开——请改这里，
 *    不要绕过门禁，也不要简单删掉断言了事。
 *
 * 退出码：0 = 全部通过  1 = 有失败（fail-closed：目标文件/块缺失也算失败）
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dir = fileURLToPath(new URL('.', import.meta.url))
const SRC = resolve(__dir, '../src/jobs')

// 期望库存：数量变化即失败，避免"删掉一处 upsert 后剩余块仍全部通过"的漏网
const EXPECTED = {
  'jobs-partner.service.ts': 3, // importJobs / importJobsFromWebhook / importFairs
  'jobs-excel.service.ts': 2, // confirmExcelImport: tx.job + tx.jobFair
  'job-sync.service.ts': 2, // upsertJobs / upsertFairs（反向断言）
}

// ──────────────────────────────────────────────────────────────────────────────
// 工具：提取文件中所有 update:{ } 块（在 .upsert( 调用内）
// ──────────────────────────────────────────────────────────────────────────────
/**
 * 规范化源码，解决两个误判来源（保留换行，行号与原文件一致）：
 *   1. **注释整体剥除** —— 注释掉的 `// reviewStatus: 'pending'` 不能再被当成通过；
 *   2. **字符串内的花括号中和** —— `description: '}'` 不能再提前终止 brace-depth 扫描。
 *
 * 注意：字符串的其余内容必须保留，否则 `reviewStatus: 'pending'` 这类
 * 字面量判定会连带失效（只中和 `{` `}`，不清空整个字符串）。
 */
function stripCommentsAndStrings(src) {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const c2 = src[i + 1]
    // 行注释
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++ }
      continue
    }
    // 块注释
    if (c === '/' && c2 === '*') {
      out += '  '; i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' '
        i++
      }
      out += '  '; i += 2
      continue
    }
    // 字符串 / 模板字符串
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      i++
      let body = ''
      while (i < n) {
        if (src[i] === '\\') { body += src[i] + (src[i + 1] ?? ''); i += 2; continue }
        if (src[i] === quote) break
        body += src[i]
        i++
      }
      // 只有「单纯 token 形态」的短字面量保留内容（状态值就是这种形态：pending / draft），
      // 其余一律抹成空格。这是为了同时挡住两类误判：
      //   · 保留内容是必须的 —— 否则 reviewStatus: 'pending' 的字面量判定会失效；
      //   · 但只要含冒号/空白/花括号，就可能是伪装成赋值的诱饵字符串，例如
      //     description: "reviewStatus: 'pending' publishStatus: 'draft' …"
      //     —— 对 Prisma 完全无效，却能骗过整块正则。已用对抗用例复现。
      const tokenLike = /^[\w.\-/]{0,64}$/.test(body)
      out += quote
      out += tokenLike ? body : body.replace(/[^\n]/g, ' ')
      if (i < n) { out += quote; i++ }
      continue
    }
    out += c
    i++
  }
  return out
}

/**
 * 本脚本是**词法级**静态守卫，不是 AST 分析。已知的处理边界：
 * 含引号的正则字面量（如 `/['"]/`）会被误判成字符串起点，从而吞掉后续源码
 * 造成静默漏判。这里主动探测该形态并抛错（fail-closed），而不是装作没事。
 */
function assertLexicallySupported(raw, filepath) {
  // 逐行找 “正则字面量里带引号” 的形态；只做保守探测，误报可通过改写该行消除
  const lines = raw.split('\n')
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln]
    // /..."或'.../ 后跟正则 flag 或右括号，且不在 // 注释里
    const m = line.match(/(?<![:/\w)\]])\/(?![/*])[^/\n]*['"][^/\n]*\/[gimsuyd]*/)
    if (m) {
      throw new Error(
        `${filepath.split('/').pop()}:${ln + 1} 出现含引号的正则字面量 \`${m[0].trim()}\`。\n` +
          '      本脚本的词法处理不支持该形态（会被当成字符串起点而吞掉后续源码，导致静默漏判）。\n' +
          '      请改写该行（把引号提到正则外的常量里），或把本门禁升级为 TypeScript AST 分析。'
      )
    }
  }
}

function extractUpsertUpdateBlocks(filepath) {
  return analyzeSource(readFileSync(filepath, 'utf8'), filepath)
}

/**
 * 纯函数分析入口（不读盘），供 --self-test 用内存变体做对抗测试。
 * @param {string} raw 源码文本
 * @param {string} filepath 仅用于报错信息里的文件名
 */
function analyzeSource(raw, filepath) {
  assertLexicallySupported(raw, filepath)
  // 全程在剥离后的源码上做结构与字段判定；行号仍与原文件一致（换行已保留）
  const src = stripCommentsAndStrings(raw)
  const blocks = []

  // 只匹配带审核字段的内容模型：job / jobFair
  // （刻意排除 fieldMappingRule 等无 reviewStatus 字段的模型）
  const upsertRe = /\.(job|jobFair)\.upsert\s*\(/g
  let upsertMatch
  while ((upsertMatch = upsertRe.exec(src)) !== null) {
    const upsertStart = upsertMatch.index
    const modelName = upsertMatch[1]

    // ① 先按圆括号配平求出**本次 upsert 调用的真实范围**。
    // 早期版本用「向后找第一个 update:{ 且距离 < 3000 字符」，
    // 当本次 upsert 写成 `update: SOME_CONST`（无字面量花括号）时，
    // 会错误借用**下一个** upsert 的 update 块而判为通过。
    const openParen = upsertStart + upsertMatch[0].length - 1 // 指向 '('
    let pDepth = 1
    let pEnd = openParen + 1
    while (pEnd < src.length && pDepth > 0) {
      if (src[pEnd] === '(') pDepth++
      else if (src[pEnd] === ')') pDepth--
      pEnd++
    }
    if (pDepth !== 0) {
      throw new Error(
        `${filepath.split('/').pop()} 的 ${modelName}.upsert( 圆括号未配平（起始偏移 ${upsertStart}）——源码被截断或词法处理失效`
      )
    }
    const callRange = src.slice(upsertStart, pEnd)

    // ② 只在本次调用范围内找 update: {
    const updateMatch = /\bupdate\s*:\s*\{/.exec(callRange)
    if (!updateMatch) {
      throw new Error(
        `${filepath.split('/').pop()} 的 ${modelName}.upsert( 内未找到字面量 \`update: {\`（起始偏移 ${upsertStart}）。\n` +
          '      可能写成了 `update: 常量` / 展开运算符 —— 本门禁无法判定其内容，按失败处理。'
      )
    }

    // ③ 追踪花括号深度，提取 update:{...} 的内容；未配平即失败
    const openBrace = upsertStart + updateMatch.index + updateMatch[0].length - 1 // 指向 '{'
    let depth = 1
    let i = openBrace + 1
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      i++
    }
    if (depth !== 0) {
      throw new Error(
        `${filepath.split('/').pop()} 的 ${modelName}.upsert( 内 update 块花括号未配平（起始偏移 ${openBrace}）`
      )
    }
    const blockContent = src.slice(openBrace, i)
    // 向前扫全文，取最后一个出现在 upsert 之前的 async 方法名作为上下文标签
    let fnName = '(unknown)'
    const fnRe = /async\s+(\w+)\s*\(/g
    let fnMatch
    while ((fnMatch = fnRe.exec(src)) !== null && fnMatch.index < upsertStart) {
      fnName = fnMatch[1]
    }
    const line = src.slice(0, upsertStart).split('\n').length
    blocks.push({ filepath, fnName, modelName, line, content: blockContent })
  }
  return blocks
}

// ──────────────────────────────────────────────────────────────────────────────
// 检查规则
// ──────────────────────────────────────────────────────────────────────────────
/**
 * 只保留 update 块**第一层**的文本，嵌套子对象内容全部抹掉。
 *
 * 不做这一步会有真实的假通过：把五项重置搬进 `meta: { reviewStatus: 'pending', ... }`
 * 这类嵌套子对象后，字段对 Prisma 而言完全无效（甚至会报错），但整块正则仍能匹配到，
 * 门禁照样放行。已用对抗用例复现过。
 */
function topLevelOnly(blockContent) {
  let out = ''
  let depth = 0
  for (const ch of blockContent) {
    if (ch === '{') {
      depth++
      out += depth === 1 ? ch : ' '
      continue
    }
    if (ch === '}') {
      out += depth === 1 ? ch : ' '
      depth--
      continue
    }
    out += depth === 1 ? ch : ch === '\n' ? '\n' : ' '
  }
  return out
}

const HAS_REVIEW = /reviewStatus\s*:\s*['"]pending['"]/
const HAS_PUBLISH = /publishStatus\s*:\s*['"]draft['"]/

// 退审同时必须清空上一次的审核元数据，否则会出现
// 「当前 pending 却仍显示上次审核人/时间/拒绝原因」的脏状态
const CLEARS_META = [
  ["rejectReason:null", /rejectReason\s*:\s*null/],
  ["reviewedBy:null", /reviewedBy\s*:\s*null/],
  ["reviewedAt:null", /reviewedAt\s*:\s*null/],
]

function checkMustReset(blocks, label) {
  let pass = 0,
    fail = 0
  for (const b of blocks) {
    const site = `${b.fnName}() · ${b.modelName}.upsert @L${b.line}`
    // 只认第一层字段：搬进嵌套子对象的重置对 Prisma 无效，不能算通过
    const top = topLevelOnly(b.content)
    const missing = [
      !HAS_REVIEW.test(top) && "reviewStatus:'pending'",
      !HAS_PUBLISH.test(top) && "publishStatus:'draft'",
      ...CLEARS_META.map(([name, re]) => !re.test(top) && name),
    ].filter(Boolean)
    if (missing.length === 0) {
      console.log(
        `  ✅  ${label} · ${site} · update 块含 pending+draft 退审 & 已清空审核元数据`
      )
      pass++
    } else {
      console.error(`  ❌  ${label} · ${site} · update 块缺少 ${missing.join(', ')}`)
      fail++
    }
  }
  return { pass, fail }
}

function checkMustNotReset(blocks, label) {
  let pass = 0,
    fail = 0
  for (const b of blocks) {
    // 反向断言同样只看第一层：嵌套里的字段对 Prisma 无效，不构成"无条件重置"
    const top = topLevelOnly(b.content)
    const hasR = HAS_REVIEW.test(top)
    const hasP = HAS_PUBLISH.test(top)
    const site = `${b.fnName}() · ${b.modelName}.upsert @L${b.line}`
    if (!hasR && !hasP) {
      console.log(
        `  ⚠️  ${label} · ${site} · 无条件重置缺席（符合断言）` +
          ' —— 注意这是【已登记 P0 缺口冻结态】，不代表当前实现无问题'
      )
      pass++
    } else {
      const unexpected = [hasR && "reviewStatus:'pending'", hasP && "publishStatus:'draft'"]
        .filter(Boolean)
        .join(', ')
      console.error(
        `  ❌  ${label} · ${site} · 自动同步 update 块出现 ${unexpected}\n` +
          '      如果这是"无条件重置"：会让每晚 Cron 把全部已审记录退回待审，压垮审核队列 → 请回退。\n' +
          '      如果你正在实施正解（按内容哈希退审：内容未变只更新 syncTime，展示字段变化才退审）：\n' +
          '      请改本脚本的这条断言，不要绕过门禁、也不要直接删断言。\n' +
          '      背景：docs/governance/standards-index.md 第十一节「审核控制不随内容变更重新生效」。'
      )
      fail++
    }
  }
  return { pass, fail }
}

// ──────────────────────────────────────────────────────────────────────────────
// 自测：对抗用例（全内存，不写盘）
//
// 门禁自己也可能有假通过。这四个用例是 codex 复审时点出的绕过形态，逐个复现过：
//   A 把 update:{...} 改成常量引用   → 早期版本会借用下一个 upsert 的块判为通过
//   B 注入含引号的正则字面量         → 早期版本词法失效、吞掉后续源码而静默漏判
//   C 字符串诱饵冒充赋值             → 早期版本保留全部字符串内容而被骗过
//   D 重置搬进嵌套子对象             → 早期版本整块匹配，对 Prisma 无效却算通过
// 四者都必须被判为失败；任一"通过"即说明门禁本身退化。
// ──────────────────────────────────────────────────────────────────────────────
const RESET_BLOCK = [
  "            reviewStatus: 'pending',",
  "            publishStatus: 'draft',",
  '            rejectReason: null,',
  '            reviewedBy: null,',
  '            reviewedAt: null,',
].join('\n')

function selfTest() {
  const partnerPath = resolve(SRC, 'jobs-partner.service.ts')
  const raw = readFileSync(partnerPath, 'utf8')
  if (!raw.includes(RESET_BLOCK)) {
    console.error('  ❌  自测夹具失效：jobs-partner.service.ts 中未找到预期的五项重置块，请同步更新 RESET_BLOCK')
    return 1
  }

  // 每个用例返回 true 表示"被门禁判为失败"（期望值）
  const cases = [
    ['A update:{...} → 常量引用', () => {
      const i = raw.indexOf('update: {')
      let d = 1, j = i + 'update: {'.length
      while (d > 0) { d += raw[j] === '{' ? 1 : raw[j] === '}' ? -1 : 0; j++ }
      return raw.slice(0, i) + 'update: RESET_FIELDS' + raw.slice(j)
    }],
    ['B 含引号的正则字面量', () => {
      const anchor = 'export class JobsPartnerService {'
      const i = raw.indexOf(anchor) + anchor.length
      return raw.slice(0, i) + `\n  private static readonly DECOY = 'x'.replace(/['"]/g, '')\n` + raw.slice(i)
    }],
    ['C 字符串诱饵冒充赋值', () =>
      raw.replace(
        RESET_BLOCK,
        `            description: "reviewStatus: 'pending' publishStatus: 'draft' rejectReason: null reviewedBy: null reviewedAt: null",`
      )],
    ['D 重置搬进嵌套子对象', () =>
      raw.replace(
        RESET_BLOCK,
        "            meta: { reviewStatus: 'pending', publishStatus: 'draft', rejectReason: null, reviewedBy: null, reviewedAt: null },"
      )],
  ]

  let leaked = 0
  for (const [name, mutate] of cases) {
    let caught = false
    try {
      const blocks = analyzeSource(mutate(), 'jobs-partner.service.ts')
      // 未抛错：则必须至少有一处被判缺字段，否则就是漏判
      if (blocks.length !== EXPECTED['jobs-partner.service.ts']) caught = true
      else {
        for (const b of blocks) {
          const top = topLevelOnly(b.content)
          if (!HAS_REVIEW.test(top) || !HAS_PUBLISH.test(top) || CLEARS_META.some(([, re]) => !re.test(top))) {
            caught = true
            break
          }
        }
      }
    } catch {
      caught = true // 解析期抛错 = fail-closed，符合期望
    }
    if (caught) console.log(`  ✅  自测 ${name} · 被正确判为失败`)
    else {
      console.error(`  ❌  自测 ${name} · 未被拦住 —— 门禁存在漏判，修好后再提交`)
      leaked++
    }
  }
  return leaked
}

// ──────────────────────────────────────────────────────────────────────────────
// 主逻辑
// ──────────────────────────────────────────────────────────────────────────────
console.log('\n🔍  verify-import-review-reset — Partner/Excel 强制重审验证\n')

let totalPass = 0,
  totalFail = 0

/**
 * fail-closed 库存核对：块数与 EXPECTED 不一致即失败。
 * 少于预期 = 有 upsert 被删/改写成别的调用形式，剩余块全过也不能算通过；
 * 多于预期 = 新增了未登记的写入点，必须显式登记后才放行。
 */
function runFile(fileLabel, filepath, checker, checkerLabel) {
  console.log(`── ${fileLabel}`)
  const expected = EXPECTED[fileLabel]
  let blocks
  try {
    blocks = extractUpsertUpdateBlocks(filepath)
  } catch (err) {
    console.error(`  ❌  无法解析 ${fileLabel}：${err.message}`)
    totalFail++
    return
  }
  if (blocks.length !== expected) {
    console.error(
      `  ❌  ${fileLabel} · 提取到 ${blocks.length} 个 upsert update 块，登记值为 ${expected}。\n` +
        '      少于登记值 = 写入点被删除或改写成非 upsert 形式（门禁会失去覆盖），\n' +
        '      多于登记值 = 新增了未登记的导入写入点。\n' +
        '      两种情况都必须人工确认后同步更新脚本顶部的 EXPECTED。'
    )
    totalFail++
    if (blocks.length === 0) return
  }
  const r = checker(blocks, checkerLabel)
  totalPass += r.pass
  totalFail += r.fail
}

// ① Partner 手动 API 导入 / Webhook / 招聘会导入
runFile(
  'jobs-partner.service.ts',
  resolve(SRC, 'jobs-partner.service.ts'),
  checkMustReset,
  'partner'
)

// ② Excel 确认导入
console.log('')
runFile('jobs-excel.service.ts', resolve(SRC, 'jobs-excel.service.ts'), checkMustReset, 'excel')

// ③ 反向断言：API 自动拉取不得出现【无条件】重置（已登记 P0 缺口冻结，见文件头 ⚠️）
console.log('')
runFile(
  'job-sync.service.ts',
  resolve(__dir, '../src/job-sync/job-sync.service.ts'),
  checkMustNotReset,
  'sync'
)

// ④ 门禁自测：四类已知绕过形态必须全被拦住（全内存，不写盘）
console.log('\n── 门禁自测（对抗用例，全内存不写盘）')
const leaked = selfTest()
if (leaked > 0) totalFail += leaked
else totalPass += 4

// ──────────────────────────────────────────────────────────────────────────────
// 摘要
// ──────────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60))
console.log(
  `总计  ${totalPass + totalFail} 项  ✅ ${totalPass} PASS  ${totalFail > 0 ? '❌' : ''} ${totalFail} FAIL`
)
if (totalFail > 0) {
  console.error('\n⛔  verify-import-review-reset FAILED — Partner/Excel 导入存在审核绕过风险\n')
  process.exit(1)
} else {
  console.log('\n✅  verify-import-review-reset ALL PASS\n')
}
