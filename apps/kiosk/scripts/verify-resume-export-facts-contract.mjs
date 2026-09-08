// ============================================================
// 简历导出 factsConfirmedAt 契约守卫（verify:resume-export-facts-contract）
//
// WHY：登录会员漏发 factsConfirmedAt = 后端 assertFactsConfirmed 抛 400
// RESUME_FACTS_NOT_CONFIRMED；匿名早返回不受影响。所以这个 bug 只打会员，
// 走查里极易漏掉（游客导出看起来一切正常）。
//
// 保护不变量：
// 1. exportGeneratedResume 函数体（不含签名）发出 factsConfirmedAt
// 2. exportResumeRecord 函数体同样发出 factsConfirmedAt
// 3. ResumeGenerateExportDto.factsConfirmedAt 上方有 @IsOptional() 与 @IsISO8601
// 4. aiHttpAdapter 不再出现过期断言「DTO 尚无该字段」
//
// 必须剥注释、只看函数体：旧缺陷把字段写在注释和参数类型里，整文件扫描会假绿。
// ============================================================
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const kioskRoot = resolve(scriptDir, '..')
const repoRoot = resolve(kioskRoot, '..', '..')
const adapterRel = 'apps/kiosk/src/services/api/aiHttpAdapter.ts'
const dtoRel = 'services/api/src/ai/dto/resume-generate.dto.ts'
const adapterPath = resolve(repoRoot, adapterRel)
const dtoPath = resolve(repoRoot, dtoRel)

let failures = 0
const pass = (m) => console.log(`  PASS ${m}`)
const fail = (m) => {
  failures += 1
  console.error(`  FAIL ${m}`)
}

function read(absPath, rel) {
  if (!existsSync(absPath)) {
    fail(`找不到 ${rel}`)
    return ''
  }
  return readFileSync(absPath, 'utf8')
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '')
}

/** 取出 async method 的函数体（跳过参数类型里的 `{ ... }`）。 */
function extractAsyncMethodBody(source, name) {
  const marker = `async ${name}(`
  const start = source.indexOf(marker)
  if (start < 0) return null
  let i = start + marker.length - 1
  let depth = 0
  let quote = null
  for (; i < source.length; i += 1) {
    const c = source[i]
    const prev = i > 0 ? source[i - 1] : ''
    if (quote) {
      if (c === quote && prev !== '\\') quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      continue
    }
    if (c === '(' || c === '{' || c === '[') depth += 1
    else if (c === ')' || c === '}' || c === ']') {
      depth -= 1
      if (depth === 0 && c === ')') break
    }
  }
  if (depth !== 0) return null
  const bodyOpen = source.indexOf('{', i)
  if (bodyOpen < 0) return null
  depth = 0
  quote = null
  for (let j = bodyOpen; j < source.length; j += 1) {
    const c = source[j]
    const prev = j > 0 ? source[j - 1] : ''
    if (quote) {
      if (c === quote && prev !== '\\') quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      continue
    }
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) return source.slice(bodyOpen, j + 1)
    }
  }
  return null
}

function expectFactsInMethodBody(source, name, message) {
  const body = extractAsyncMethodBody(source, name)
  if (!body) {
    fail(`${message} — 找不到 async ${name}(`)
    return
  }
  if (/\bfactsConfirmedAt\b/.test(stripComments(body))) pass(message)
  else fail(`${message} — 函数体（剥注释后）没有 factsConfirmedAt`)
}

/** 收集字段声明正上方的装饰器行（跳过空行与 JSDoc）。 */
function decoratorsAboveField(source, fieldName) {
  const lines = source.split('\n')
  const idx = lines.findIndex((line) => new RegExp(`^\\s*${fieldName}\\?:`).test(line))
  if (idx < 0) return null
  const block = []
  for (let i = idx - 1; i >= 0; i -= 1) {
    const line = lines[i]
    if (/^\s*$/.test(line)) continue
    if (/^\s*\/\//.test(line) || /^\s*\*/.test(line) || /^\s*\/\*/.test(line)) continue
    if (/^\s*@/.test(line)) {
      block.unshift(line)
      continue
    }
    break
  }
  return block.join('\n')
}

console.log('\n=== 简历导出 factsConfirmedAt 契约守卫 ===')

const adapter = read(adapterPath, adapterRel)
const dto = read(dtoPath, dtoRel)

expectFactsInMethodBody(
  adapter,
  'exportGeneratedResume',
  'exportGeneratedResume 函数体发出 factsConfirmedAt（登录会员导出会带上）',
)
expectFactsInMethodBody(
  adapter,
  'exportResumeRecord',
  'exportResumeRecord 函数体发出 factsConfirmedAt',
)

{
  const decorators = dto ? decoratorsAboveField(dto, 'factsConfirmedAt') : null
  if (decorators == null) {
    fail('resume-generate.dto.ts 找不到 factsConfirmedAt 字段')
  } else {
    const hasOptional = /@IsOptional\(\)/.test(decorators)
    const hasIso = /@IsISO8601/.test(decorators)
    if (hasOptional && hasIso) {
      pass('factsConfirmedAt 字段上方有 @IsOptional() 和 @IsISO8601')
    } else {
      const missing = [
        hasOptional ? null : '@IsOptional()',
        hasIso ? null : '@IsISO8601',
      ].filter(Boolean)
      fail(`factsConfirmedAt 字段上方缺少 ${missing.join(' / ')}`)
    }
  }
}

if (adapter.includes("'DTO 尚无该字段'") || adapter.includes('DTO 尚无该字段')) {
  fail("aiHttpAdapter.ts 仍出现过期断言字符串 'DTO 尚无该字段'")
} else {
  pass("aiHttpAdapter.ts 不再出现旧的过期断言字符串 'DTO 尚无该字段'")
}

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — 简历导出 factsConfirmedAt 契约守卫未通过\n`)
  process.exit(1)
}
console.log('✅ ALL PASS — 简历导出 factsConfirmedAt 契约守卫通过\n')
