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
    // 字符串 / 模板字符串：只把花括号换成空格，其余内容原样保留
    // （保留内容是必须的——否则 reviewStatus: 'pending' 的字面量判定会失效）
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      out += quote; i++
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue }
        if (src[i] === quote) break
        out += src[i] === '{' || src[i] === '}' ? ' ' : src[i]
        i++
      }
      if (i < n) { out += quote; i++ }
      continue
    }
    out += c
    i++
  }
  return out
}

function extractUpsertUpdateBlocks(filepath) {
  const raw = readFileSync(filepath, 'utf8')
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
    // 在这次 upsert 调用内找 "update:" 子块
    // 先快速定位 "update:" 关键词（限制搜索范围到本次 upsert 区域）
    const searchFrom = upsertStart
    const updateRe = /\bupdate\s*:\s*\{/g
    updateRe.lastIndex = searchFrom
    const updateMatch = updateRe.exec(src)
    if (!updateMatch) continue
    // 确认 update: 确实在本次 upsert 调用范围内（距离不超过 3000 字符作为安全边界）
    if (updateMatch.index - upsertStart > 3000) continue

    // 追踪花括号深度，提取 update:{...} 的内容
    const openBrace = updateMatch.index + updateMatch[0].length - 1 // 指向 '{'
    let depth = 1
    let i = openBrace + 1
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      i++
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
    const missing = [
      !HAS_REVIEW.test(b.content) && "reviewStatus:'pending'",
      !HAS_PUBLISH.test(b.content) && "publishStatus:'draft'",
      ...CLEARS_META.map(([name, re]) => !re.test(b.content) && name),
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
    const hasR = HAS_REVIEW.test(b.content)
    const hasP = HAS_PUBLISH.test(b.content)
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
