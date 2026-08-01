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
 * 那会让每 30 分钟一次的 Cron（见 job-sync.scheduler.ts:19 的 @Cron 表达式）
 * 把全部已审记录退回待审，压垮审核队列。
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
 * 规范化源码，解决三个误判来源（保留换行，行号与原文件一致）：
 *   1. **注释整体剥除** —— 注释掉的 `// reviewStatus: 'pending'` 不能再被当成通过；
 *   2. **正则字面量整体抹除** —— `/['"]/g` 里的引号不能再被当成字符串起点
 *      （否则会吞掉后续源码造成静默漏判）。正则内不可能出现 Prisma 字段，抹掉无损；
 *   3. **字符串内的花括号中和** —— `description: '}'` 不能再提前终止 brace-depth 扫描。
 *
 * 字符串内容不是无条件保留：只有「单纯 token 形态」（`/^[\w.\-/]{0,64}$/`，
 * pending / draft 就是这种形态）才保留原文，用来支撑 `reviewStatus: 'pending'`
 * 的字面量判定；一旦含冒号、空白或花括号就整体抹成空格，否则
 * `description: "reviewStatus: 'pending'"` 这种对 Prisma 无效的诱饵字符串
 * 会骗过整块正则。两类误判都有对抗用例（见 selfTest 用例 C）。
 */
function stripCommentsAndStrings(src) {
  let out = ''
  let i = 0
  const n = src.length
  // 上一个「有效字符」，用于判断 `/` 是正则起点还是除号
  let prevSig = ''
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
    // 正则字面量：只在**明确允许正则的位置**才进入（保守；歧义时按除号处理，
    // 残留的引号会被下面 assertLexicallySupported 兜住 → fail-closed）
    if (c === '/' && REGEX_ALLOWED_PREV.has(prevSig)) {
      let j = i + 1
      let inClass = false
      let closed = false
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === '[') inClass = true
        else if (src[j] === ']') inClass = false
        else if (src[j] === '/' && !inClass) { closed = true; break }
        j++
      }
      if (closed) {
        j++ // 越过收尾 '/'
        while (j < n && /[gimsuyd]/.test(src[j])) j++ // flags
        out += ' '.repeat(j - i)
        i = j
        prevSig = 'r' // 正则求值结果是个值，后面的 `/` 应按除号处理
        continue
      }
      // 未闭合 → 不是正则，按普通字符继续
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
      prevSig = 's'
      continue
    }
    out += c
    if (!/\s/.test(c)) prevSig = c
    i++
  }
  return out
}

// `/` 出现在这些字符之后才可能是正则字面量起点（否则视为除号）。
// 空串代表文件开头。刻意保守：漏判会退化成旧行为并被 fail-closed 兜住。
const REGEX_ALLOWED_PREV = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^'])

/**
 * 本脚本是**词法级**静态守卫，不是 AST 分析。
 *
 * 上面的 lexer 已能跳过「明确位置」上的正则字面量，因此含引号的正则通常无害。
 * 但正则与除号在语法上本就歧义，lexer 保守放过的那部分若含引号，仍会把后续源码
 * 当成字符串吞掉 → 静默漏判。本函数在**已剥离**的源码上做残留探测：
 * 注释与已正确跳过的正则此时都已成空白，不会误报（早期版本在 raw 上跑，
 * 会把注释里的 `// example: /['"]/g` 判成危险形态，属假阳性，已修）。
 */
function assertLexicallySupported(stripped, filepath) {
  const lines = stripped.split('\n')
  for (let ln = 0; ln < lines.length; ln++) {
    const m = lines[ln].match(/(?<![:/\w)\]])\/(?![/*])[^/\n]*['"][^/\n]*\/[gimsuyd]*/)
    if (m) {
      throw new Error(
        `${filepath.split('/').pop()}:${ln + 1} 出现词法上无法安全处理的含引号正则 \`${m[0].trim()}\`。\n` +
          '      该位置正则/除号歧义，lexer 未跳过它，引号会被当成字符串起点吞掉后续源码 → 静默漏判。\n' +
          '      请改写该行（把引号提到正则外的常量里），或把本门禁升级为 TypeScript AST 分析。'
      )
    }
  }
}

/**
 * update 块第一层出现展开运算符时必须失败：`{ …五项重置…, ...overrides }`
 * 里的 overrides 完全可能把 reviewStatus 覆写回 approved，静态无法判定其内容。
 * 已用对抗用例复现（原实现放行）。
 */
function assertNoTopLevelSpread(top, site, filepath) {
  if (/\.\.\./.test(top)) {
    throw new Error(
      `${filepath.split('/').pop()} 的 ${site} 的 update 块第一层出现展开运算符 \`...\`。\n` +
        '      展开对象可能把 reviewStatus/publishStatus 覆写回已审已发布，静态无法判定 → 按失败处理。\n' +
        '      请把重置五项写成字面量并放在展开之后，或改为不使用展开。'
    )
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
/**
 * 在 `.upsert(` 调用文本里定位**实参对象第一层**的 `update: {`。
 *
 * 必须限定第一层：`create: { nested: { update: {…} } }` 里的嵌套 update 若被取走，
 * 门禁就会去检查一个 Prisma 根本不读的块，而真正的顶层 update 逃过检查。
 *
 * @returns {{braceIndex:number}|null} braceIndex 是 `{` 相对 callRange 起点的偏移
 */
function findTopLevelUpdate(callRange) {
  // callRange 形如 `.job.upsert({ … })`：先定位实参对象的 `{`
  const argOpen = callRange.indexOf('{')
  if (argOpen < 0) return null
  let depth = 0
  for (let i = argOpen; i < callRange.length; i++) {
    const ch = callRange[i]
    if (ch === '{') {
      depth++
      continue
    }
    if (ch === '}') {
      depth--
      if (depth === 0) break
      continue
    }
    // 只在实参对象第一层（depth === 1）识别 update 键
    if (depth === 1 && ch === 'u') {
      const m = /^update\s*:\s*\{/.exec(callRange.slice(i))
      if (m && !/[\w$]/.test(callRange[i - 1] ?? ' ')) {
        return { braceIndex: i + m[0].length - 1 }
      }
    }
  }
  return null
}

function analyzeSource(raw, filepath) {
  // 全程在剥离后的源码上做结构与字段判定；行号仍与原文件一致（换行已保留）
  const src = stripCommentsAndStrings(raw)
  assertLexicallySupported(src, filepath) // 剥离后再查残留，避免注释误报
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

    // ② 在调用范围内找 update: { —— 但**必须是实参对象的第一层**。
    // 早期版本取「范围内第一个 update: {」，可被 `create: { nested: { update: {…五项…} } }`
    // 抢位：嵌套块凑齐五项即放行，真正的顶层 update 完全没被检查。已用对抗用例复现。
    const updateMatch = findTopLevelUpdate(callRange)
    if (!updateMatch) {
      throw new Error(
        `${filepath.split('/').pop()} 的 ${modelName}.upsert( 实参第一层未找到字面量 \`update: {\`（起始偏移 ${upsertStart}）。\n` +
          '      可能写成了 `update: 常量` / 展开运算符 / 嵌套位置 —— 本门禁无法判定其内容，按失败处理。'
      )
    }

    // ③ 追踪花括号深度，提取 update:{...} 的内容；未配平即失败
    const openBrace = upsertStart + updateMatch.braceIndex // 指向 '{'
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

// 值必须是**完整字面量并紧跟分隔符**（`,` 或块尾 `}`）。
// 早期只写 `:\s*null` 会把 `rejectReason: nullFlag ? undefined : 'kept'` 判为通过
// （`null` 是 `nullFlag` 的前缀）；`'pending' + suffix`、`x ? a : 'pending'` 同理。
// 已用对抗用例复现。
const HAS_REVIEW = /reviewStatus\s*:\s*['"]pending['"]\s*[,}]/
const HAS_PUBLISH = /publishStatus\s*:\s*['"]draft['"]\s*[,}]/

// 退审同时必须清空上一次的审核元数据，否则会出现
// 「当前 pending 却仍显示上次审核人/时间/拒绝原因」的脏状态
const CLEARS_META = [
  ["rejectReason:null", /rejectReason\s*:\s*null\s*[,}]/],
  ["reviewedBy:null", /reviewedBy\s*:\s*null\s*[,}]/],
  ["reviewedAt:null", /reviewedAt\s*:\s*null\s*[,}]/],
]

function checkMustReset(blocks, label) {
  let pass = 0,
    fail = 0
  for (const b of blocks) {
    const site = `${b.fnName}() · ${b.modelName}.upsert @L${b.line}`
    // 只认第一层字段：搬进嵌套子对象的重置对 Prisma 无效，不能算通过
    const top = topLevelOnly(b.content)
    assertNoTopLevelSpread(top, site, b.filepath)
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
          '      如果这是"无条件重置"：会让每 30 分钟一次的 Cron 把全部已审记录退回待审，压垮审核队列 → 请回退。\n' +
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
// 门禁自己也可能有假通过。以下用例都是 codex 复审点出、并已实际复现过的形态：
//   A 把 update:{...} 改成常量引用     → 早期版本借用下一个 upsert 的块判为通过
//   B 明确位置上的含引号正则           → 现已被 lexer 正确跳过，**必须仍能正常分析**
//   B′ 歧义位置上的含引号正则          → lexer 保守放过，必须由残留探测抛错（fail-closed）
//   C 字符串诱饵冒充赋值               → 早期版本保留全部字符串内容而被骗过
//   D 重置搬进嵌套子对象               → 早期版本整块匹配，对 Prisma 无效却算通过
//   E 嵌套 update 抢位                 → 早期版本取"第一个 update:{"，真顶层块逃过检查
//   F update 第一层出现展开运算符      → 可能把状态覆写回已审，静态不可判 → 必须抛错
//   G 正则含单侧括号 + 重置齐全        → **必须通过**（防过度收紧造成假阳性）
//   G′ 正则含单侧括号 + 缺重置         → 必须失败
//   H 值是表达式而非完整字面量         → `rejectReason: nullFlag ? …` 早期被当成 null 通过
//   I 自动同步出现无条件重置           → 反向断言必须失败（防审核队列被压垮）
//
// 两条设计约束（codex 指出的自测不可靠形态，已修）：
//   · 不能"抛任何错都算拦住" —— 每个 throw 用例都要匹配**预期错误形态**；
//   · 不能"任一块失败就算拦住" —— 必须确认失败的是**被改动的那个块**。
// 自测只是回归烟测：它与被测实现共用同一套 lexer，能防退化，不构成解析正确性的证明。
// ──────────────────────────────────────────────────────────────────────────────
const RESET_BLOCK = [
  "            reviewStatus: 'pending',",
  "            publishStatus: 'draft',",
  '            rejectReason: null,',
  '            reviewedBy: null,',
  '            reviewedAt: null,',
].join('\n')

/** 合成夹具：单个 upsert，便于精确断言"失败的就是被改动的那个块" */
function synth(updateInner, model = 'job', fn = 'importJobs') {
  return `class T {
  async ${fn}() {
    await this.prisma.${model}.upsert({
      where: { k: 1 },
      create: { title: 'x', reviewStatus: 'pending', publishStatus: 'draft' },
${updateInner}
    })
  }
}
`
}

const RESET_INLINE = [
  "        reviewStatus: 'pending',",
  "        publishStatus: 'draft',",
  '        rejectReason: null,',
  '        reviewedBy: null,',
  '        reviewedAt: null,',
].join('\n')

function selfTest() {
  const partnerPath = resolve(SRC, 'jobs-partner.service.ts')
  const raw = readFileSync(partnerPath, 'utf8')
  if (!raw.includes(RESET_BLOCK)) {
    console.error('  ❌  自测夹具失效：jobs-partner.service.ts 中未找到预期的五项重置块，请同步更新 RESET_BLOCK')
    return 1
  }

  // expect: 'fail'  → 必须被判缺字段，且失败的块函数名须匹配 site
  //         'throw' → 必须抛错，且错误信息匹配 errRe
  //         'pass'  → 必须正常通过（防过度收紧导致假阳性）
  const cases = [
    {
      name: 'A update:{...} → 常量引用',
      expect: 'throw',
      errRe: /未找到字面量/,
      src: () => {
        const i = raw.indexOf('update: {')
        let d = 1, j = i + 'update: {'.length
        while (d > 0) { d += raw[j] === '{' ? 1 : raw[j] === '}' ? -1 : 0; j++ }
        return raw.slice(0, i) + 'update: RESET_FIELDS' + raw.slice(j)
      },
    },
    {
      name: 'B 明确位置的含引号正则（应被正确跳过）',
      expect: 'pass',
      src: () => {
        const anchor = 'export class JobsPartnerService {'
        const i = raw.indexOf(anchor) + anchor.length
        return raw.slice(0, i) + `\n  private static readonly DECOY = 'x'.replace(/['"]/g, '')\n` + raw.slice(i)
      },
    },
    {
      name: "B′ 歧义位置的含引号正则（应 fail-closed）",
      expect: 'throw',
      // 两条 fail-closed 路径都可接受：残留探测直接命中，或引号吞掉源码后由括号配平兜住。
      // 关键是必须抛错而非静默漏判 —— 但不能"抛任何错都算过"，故仍限定这两种形态。
      errRe: /无法安全处理的含引号正则|圆括号未配平/,
      src: () => synth(`      update: {\n        title: a /['"]/ b,\n${RESET_INLINE}\n      },`),
    },
    {
      name: 'C 字符串诱饵冒充赋值',
      expect: 'fail',
      site: /importJobs/,
      src: () => synth(
        `      update: {\n        description: "reviewStatus: 'pending' publishStatus: 'draft' rejectReason: null reviewedBy: null reviewedAt: null",\n      },`
      ),
    },
    {
      name: 'D 重置搬进嵌套子对象',
      expect: 'fail',
      site: /importJobs/,
      src: () => synth(
        "      update: {\n        meta: { reviewStatus: 'pending', publishStatus: 'draft', rejectReason: null, reviewedBy: null, reviewedAt: null },\n      },"
      ),
    },
    {
      name: 'E 嵌套 update 抢位（真 update 在后）',
      expect: 'fail',
      site: /importJobs/,
      src: () => `class T {
  async importJobs() {
    await this.prisma.job.upsert({
      where: { k: 1 },
      create: { nested: { update: {\n${RESET_INLINE}\n      } } },
      update: { title: item.title, syncTime: sync },
    })
  }
}
`,
    },
    {
      name: 'F update 第一层出现展开运算符',
      expect: 'throw',
      errRe: /展开运算符/,
      src: () => synth(`      update: {\n${RESET_INLINE}\n        ...overrides,\n      },`),
    },
    {
      name: 'G 正则含单侧括号 + 重置齐全（应通过）',
      expect: 'pass',
      src: () => synth(`      update: {\n        title: item.title.replace(/\\(/g, ''),\n${RESET_INLINE}\n      },`),
    },
    {
      name: "G′ 正则含单侧括号 + 缺重置",
      expect: 'fail',
      site: /importJobs/,
      src: () => synth(`      update: {\n        title: item.title.replace(/\\(/g, ''),\n        syncTime: sync,\n      },`),
    },
    {
      name: 'H 值是表达式而非完整字面量',
      expect: 'fail',
      site: /importJobs/,
      src: () => synth(
        `      update: {\n        reviewStatus: 'pending',\n        publishStatus: 'draft',\n        rejectReason: nullFlag ? undefined : 'kept',\n        reviewedBy: nullish ?? prev.reviewedBy,\n        reviewedAt: nullOr(prev.reviewedAt),\n      },`
      ),
    },
    {
      name: 'I 自动同步出现无条件重置（反向断言）',
      expect: 'reverse-fail',
      src: () => synth(`      update: {\n${RESET_INLINE}\n        syncTime: sync,\n      },`, 'job', 'upsertJobs'),
    },
  ]

  let leaked = 0
  const total = cases.length
  for (const c of cases) {
    let verdict, detail = ''
    try {
      const blocks = analyzeSource(c.src(), 'selftest.ts')
      if (c.expect === 'reverse-fail') {
        // 反向断言：无条件重置出现 → checkMustNotReset 必须报失败
        const bad = blocks.filter((b) => {
          const top = topLevelOnly(b.content)
          return HAS_REVIEW.test(top) || HAS_PUBLISH.test(top)
        })
        verdict = bad.length > 0 ? 'reverse-fail' : 'pass'
      } else {
        const failed = blocks.filter((b) => {
          const top = topLevelOnly(b.content)
          // 刻意不在这里 catch：展开运算符走的是 fail-closed 抛错路径，
          // 若在此吞掉就会把 throw 用例误记成普通 fail，掩盖真实行为。
          assertNoTopLevelSpread(top, 'x', 'selftest.ts')
          return !HAS_REVIEW.test(top) || !HAS_PUBLISH.test(top) || CLEARS_META.some(([, re]) => !re.test(top))
        })
        verdict = failed.length > 0 ? 'fail' : 'pass'
        // 必须是被改动的那个块失败，不能是"别处顺带失败"
        if (verdict === 'fail' && c.site && !failed.some((b) => c.site.test(b.fnName))) {
          verdict = 'fail-wrong-block'
          detail = `失败块是 ${failed.map((b) => b.fnName).join('/')}，期望匹配 ${c.site}`
        }
      }
    } catch (e) {
      verdict = 'throw'
      detail = String(e.message).split('\n')[0]
      // 必须是预期的错误形态，不能是"随便抛个错也算拦住"
      if (c.expect === 'throw' && c.errRe && !c.errRe.test(detail)) {
        verdict = 'throw-wrong-reason'
      }
    }

    if (verdict === c.expect) {
      const how = { fail: '被正确判为失败', throw: '被正确 fail-closed 抛错', pass: '被正确放行（无假阳性）', 'reverse-fail': '反向断言正确报失败' }[c.expect]
      console.log(`  ✅  自测 ${c.name} · ${how}`)
    } else {
      console.error(
        `  ❌  自测 ${c.name} · 期望 ${c.expect}，实际 ${verdict}` +
          (detail ? `（${detail}）` : '') +
          ' —— 门禁已退化，修好后再提交'
      )
      leaked++
    }
  }
  return { leaked, total }
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

// ④ 门禁自测：已知绕过形态必须全被拦住，且不得产生假阳性（全内存，不写盘）
console.log('\n── 门禁自测（对抗用例，全内存不写盘）')
const { leaked, total: selfTotal } = selfTest()
totalFail += leaked
totalPass += selfTotal - leaked

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
