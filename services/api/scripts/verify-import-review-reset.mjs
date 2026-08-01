#!/usr/bin/env node
/**
 * verify-import-review-reset.mjs
 *
 * 静态分析：确认 Partner/Excel 主动导入的 upsert update 块
 * 一律包含 reviewStatus:'pending' + publishStatus:'draft'（强制重审）。
 *
 * 同时反向验证 job-sync.service.ts（API自动拉取）的 update 块
 * 不含这两个字段——那是故意的"不覆写"设计，防止自动同步绕审。
 *
 * 退出码：0 = 全部通过  1 = 有失败
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dir = fileURLToPath(new URL('.', import.meta.url))
const SRC = resolve(__dir, '../src/jobs')

// ──────────────────────────────────────────────────────────────────────────────
// 工具：提取文件中所有 update:{ } 块（在 .upsert( 调用内）
// ──────────────────────────────────────────────────────────────────────────────
function extractUpsertUpdateBlocks(filepath) {
  const src = readFileSync(filepath, 'utf8')
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

function checkMustReset(blocks, label) {
  let pass = 0,
    fail = 0
  for (const b of blocks) {
    const hasR = HAS_REVIEW.test(b.content)
    const hasP = HAS_PUBLISH.test(b.content)
    const site = `${b.fnName}() · ${b.modelName}.upsert @L${b.line}`
    if (hasR && hasP) {
      console.log(
        `  ✅  ${label} · ${site} · update 块含 reviewStatus:'pending' + publishStatus:'draft'`
      )
      pass++
    } else {
      const missing = [!hasR && "reviewStatus:'pending'", !hasP && "publishStatus:'draft'"]
        .filter(Boolean)
        .join(', ')
      console.error(`  ❌  ${label} · ${site} · update 块缺少 ${missing}`)
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
        `  ✅  ${label} · ${site} · update 块正确不覆写 reviewStatus/publishStatus（自动同步保护）`
      )
      pass++
    } else {
      const unexpected = [hasR && "reviewStatus:'pending'", hasP && "publishStatus:'draft'"]
        .filter(Boolean)
        .join(', ')
      console.error(
        `  ❌  ${label} · ${site} · 自动同步 update 块意外包含 ${unexpected}（会导致每次自动拉取重置审核状态）`
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

// ① Partner 手动 API 导入（3处）
console.log('── jobs-partner.service.ts (Partner 主动导入)')
const partnerBlocks = extractUpsertUpdateBlocks(resolve(SRC, 'jobs-partner.service.ts'))
if (partnerBlocks.length === 0) {
  console.error('  ❌  未找到任何 upsert update 块，请检查脚本对文件的解析')
  totalFail++
} else {
  const r = checkMustReset(partnerBlocks, 'partner')
  totalPass += r.pass
  totalFail += r.fail
}

// ② Excel 确认导入（2处）
console.log('\n── jobs-excel.service.ts (Excel 确认导入)')
const excelBlocks = extractUpsertUpdateBlocks(resolve(SRC, 'jobs-excel.service.ts'))
if (excelBlocks.length === 0) {
  console.error('  ❌  未找到任何 upsert update 块，请检查脚本对文件的解析')
  totalFail++
} else {
  const r = checkMustReset(excelBlocks, 'excel')
  totalPass += r.pass
  totalFail += r.fail
}

// ③ 反向验证：API 自动拉取 sync worker 不得覆写（保护"不覆写"设计）
const syncPath = resolve(__dir, '../src/job-sync/job-sync.service.ts')
console.log('\n── job-sync.service.ts (API 自动拉取，反向验证——不应覆写)')
const syncBlocks = extractUpsertUpdateBlocks(syncPath)
if (syncBlocks.length === 0) {
  console.log('  ⚠️   未找到 upsert update 块（sync worker 改用 update 而非 upsert？跳过反向检查）')
} else {
  const r = checkMustNotReset(syncBlocks, 'sync')
  totalPass += r.pass
  totalFail += r.fail
}

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
