// ============================================================================
// 门禁：DeepSeek 思考模式统一关闭（verify:llm-thinking-off）
//
// 守的是 2026-09-29 查出的两件事：
//   ① 10 个调用点各自写 `model.startsWith('deepseek-v4')` 才关思考。DeepSeek 官方
//      推荐名已是 `deepseek-flash`（不带 v4），管理员按官方推荐改名后思考就悄悄
//      重新打开 —— 多等、按输出价多计费，而且没有任何报错。
//   ② 另有 3 个调用点（小青对话要点、岗位推荐/解读、模拟面试）根本没关，
//      默认模型 deepseek-v4-flash 下一直在思考模式里跑；数字人小青（TRTC）的
//      LLMConfig 也没关。
// 官方依据见 src/ai/llm/deepseek-thinking.ts 文件头（带链接与访问日期）。
//
// 断言分三类：
//   运行时 R：共用函数对四个 DeepSeek 名字返回关闭思考、对千问等返回空；
//            TRTC 默认 LLMConfig 带 ExtraBody 关闭思考、覆盖 JSON 原样不改；
//            真起一个本地假上游，驱动岗位解读服务，抓到的请求体里确有 thinking=disabled。
//   静态 S（派生式，不硬编码文件名）：
//     「LLM 调用点」= services/api/src 下（去注释后）出现 chat/completions 的非测试文件。
//     S1 每个调用点文件里，每个 `JSON.stringify({ ... })` 请求体（同时含 model 与
//        messages 键）都展开了 `...deepseekThinkingOff(<同一个 model 表达式>)`；
//        不用 JSON.stringify 组体的调用点必须在 DELEGATES / EXEMPT 里写明理由。
//     S2 src 下不许再出现 `startsWith('deepseek-v4…')`。
//     S3 src 下（去注释）不许手写 `thinking: { type: … }`，只许共用函数一处。
//
// 反向变异（已实测）：共用函数改回只认 deepseek-v4 → 红在 R1；
// 任一调用点去掉 deepseekThinkingOff → 红在 S1；TRTC 去掉 ExtraBody → 红在 R4。
// ============================================================================
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { deepStrictEqual } from 'node:assert/strict'

import { deepseekThinkingOff, isDeepseekModel } from '../src/ai/llm/deepseek-thinking'
import { buildTrtcLlmConfigJson } from '../src/trtc/trtc.service'
import { JobAiLlmService } from '../src/job-ai/job-ai-llm.service'
import type { LlmConfigService } from '../src/ai/llm/llm-config.service'

process.exitCode = 1
const watchdog = setTimeout(() => {
  console.log('  FAIL  门禁超过 60 秒未跑完，按失败处理')
  process.exit(1)
}, 60_000)

let passed = 0
let failed = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (ok) { passed += 1; console.log(`  PASS  ${label}`) }
  else { failed += 1; console.log(`  FAIL  ${label}${detail ? ` —— ${detail}` : ''}`) }
}
function deepEq(a: unknown, b: unknown): boolean {
  try { deepStrictEqual(a, b); return true } catch { return false }
}

const OFF = { thinking: { type: 'disabled' } }

// ── R1 / R2：共用函数 ────────────────────────────────────────────────────────
console.log('── R1 DeepSeek 系一律关闭思考 ──')
// 这四个名字是规格：官方推荐名、旧名、Pro、大小写变体（管理员手填常见）。
for (const name of ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro', 'DeepSeek-Flash', '  deepseek-flash  ']) {
  check(deepEq(deepseekThinkingOff(name), OFF), `deepseekThinkingOff(${JSON.stringify(name)}) = thinking disabled`,
    JSON.stringify(deepseekThinkingOff(name)))
}

console.log('── R2 非 DeepSeek 不改请求体 ──')
// 为什么期望为空：千问 qwen-plus 官方默认不开思考、开关字段是 enable_thinking，
// 塞 DeepSeek 专有字段只会多一个被上游拒收的面；非字符串/空串不是任何厂商。
for (const name of ['qwen-plus', 'MiniMax-M2', 'hunyuan-turbo', '', undefined, 42] as unknown[]) {
  check(deepEq(deepseekThinkingOff(name), {}), `deepseekThinkingOff(${JSON.stringify(name)}) = {}`,
    JSON.stringify(deepseekThinkingOff(name)))
}
check(isDeepseekModel('deepseek-flash') && !isDeepseekModel('qwen-plus'), 'isDeepseekModel 与 deepseekThinkingOff 口径一致')
{
  const a = deepseekThinkingOff('deepseek-flash') as { thinking: { type: string } }
  a.thinking.type = 'enabled'
  check(deepEq(deepseekThinkingOff('deepseek-flash'), OFF), '每次返回新对象：改一次返回值不污染下一次')
}

// ── R4：TRTC 小青默认 LLMConfig ──────────────────────────────────────────────
console.log('── R4 TRTC 小青 LLMConfig ──')
const trtcBase = { llmType: 'openai', apiKey: 'test-key', apiUrl: 'https://api.deepseek.com/v1/chat/completions', systemPrompt: 'sp' }
const LEGACY_KEYS = ['LLMType', 'Model', 'APIKey', 'APIUrl', 'SystemPrompt', 'History', 'Streaming']
for (const model of ['deepseek-v4-flash', 'deepseek-flash']) {
  const cfg = JSON.parse(buildTrtcLlmConfigJson({ ...trtcBase, model })) as Record<string, unknown>
  check(deepEq(cfg['ExtraBody'], OFF), `默认 LLMConfig（${model}）带 ExtraBody.thinking=disabled`, JSON.stringify(cfg['ExtraBody']))
  check(cfg['Model'] === model && cfg['Streaming'] === true && cfg['History'] === 5, `默认 LLMConfig（${model}）其余字段不变`)
}
{
  // 为什么期望没有 ExtraBody：非 DeepSeek 的默认配置必须与改动前逐字段相同。
  const cfg = JSON.parse(buildTrtcLlmConfigJson({ ...trtcBase, model: 'qwen-plus' })) as Record<string, unknown>
  check(deepEq(Object.keys(cfg), LEGACY_KEYS), '非 DeepSeek（qwen-plus）默认 LLMConfig 与改动前字段完全相同', Object.keys(cfg).join(','))
}
{
  // 覆盖 JSON 是运维自己写的整份配置，代码不改一个字节（覆盖者自负其责，.env.example 有说明）。
  const override = '{"LLMType":"openai","Model":"deepseek-flash","APIKey":"x","APIUrl":"u"}'
  check(buildTrtcLlmConfigJson({ ...trtcBase, model: 'deepseek-flash' }, override) === override, 'TRTC_LLM_CONFIG_JSON 覆盖时原样返回、不被改写')
}

// ── S：静态扫描 ──────────────────────────────────────────────────────────────
const API_ROOT = join(__dirname, '..')
const SRC_ROOT = join(API_ROOT, 'src')
const HELPER = 'src/ai/llm/deepseek-thinking.ts'

function listTs(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'generated' || entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...listTs(full))
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) out.push(full)
  }
  return out
}

/** 去掉 // 与 /* *\/ 注释（保留字符串内容；足够应付本仓库写法）。 */
function stripComments(src: string): string {
  let out = ''
  let i = 0
  let quote: string | null = null
  while (i < src.length) {
    const c = src[i]!
    const n = src[i + 1]
    if (quote) {
      out += c
      if (c === '\\') { out += n ?? ''; i += 2; continue }
      if (c === quote) quote = null
      i += 1
      continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i += 1; continue }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 2; continue }
    out += c
    i += 1
  }
  return out
}

/** 从 `{` 起取平衡的对象字面量文本。 */
function balancedObject(src: string, openIdx: number): string {
  let depth = 0
  for (let i = openIdx; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(openIdx, i + 1) }
  }
  return src.slice(openIdx)
}

// 不用 JSON.stringify 组体、而是交给专门构造函数的调用点：写明它必须满足什么。
const DELEGATES: Record<string, { mustContain: string[]; why: string }> = {
  'src/trtc/trtc.service.ts': {
    mustContain: ['buildTrtcLlmConfigJson(', 'deepseekThinkingOff(input.model)'],
    why: 'LLMConfig 由腾讯云转发给大模型，关闭写在 ExtraBody（运行时 R4 已断言）',
  },
}
// 有意不关思考的调用点：必须写明理由，且理由指向的事实仍成立（文件在、仍是调用点）。
const EXEMPT: Record<string, string> = {
  'src/contract-review/contract-review-provider.service.ts':
    '合同审查按设计锁定推理模型 deepseek-v4-pro（见 contract-review-timing.ts / verify:contract-review:timeout），'
    + '是否在这里也关思考属于审查质量取舍，已列为待产品负责人拍板，拍板前保持原状。',
}

const files = listTs(SRC_ROOT)
const rel = (f: string) => relative(API_ROOT, f).split('\\').join('/')
const code = new Map(files.map((f) => [rel(f), stripComments(readFileSync(f, 'utf8'))]))
const callSites = [...code.entries()].filter(([, src]) => src.includes('chat/completions')).map(([f]) => f).sort()

console.log(`── S1 调用点请求体都引用共用函数（派生出 ${callSites.length} 个调用点文件）──`)
// 阳性对照：派生规则失明（比如路径拼法变了）时不能静默全绿。今天是 14 个。
check(callSites.length >= 12, `派生出的调用点文件不少于 12 个（实际 ${callSites.length}）`)
let bodyCount = 0
for (const f of callSites) {
  const src = code.get(f)!
  if (EXEMPT[f]) { check(true, `${f} 豁免：${EXEMPT[f]}`); continue }
  const bodies: string[] = []
  for (const m of src.matchAll(/JSON\.stringify\(\s*\{/g)) {
    const obj = balancedObject(src, m.index! + m[0].length - 1)
    if (/\bmodel\b\s*[:,]/.test(obj) && /\bmessages\b/.test(obj)) bodies.push(obj)
  }
  if (bodies.length === 0) {
    const d = DELEGATES[f]
    check(Boolean(d) && d!.mustContain.every((s) => src.includes(s)),
      `${f} 不用 JSON.stringify 组体：${d ? d.why : '未登记在 DELEGATES，无法证明它关了思考'}`)
    continue
  }
  check(/import\s*\{[^}]*\bdeepseekThinkingOff\b[^}]*\}\s*from\s*'[./]+(?:ai\/)?(?:llm\/)?deepseek-thinking'/.test(src),
    `${f} 从 deepseek-thinking 引入共用函数`)
  bodies.forEach((obj, i) => {
    bodyCount += 1
    const explicit = obj.match(/\bmodel\s*:\s*([\w.]+)/)
    const modelExpr = explicit ? explicit[1] : 'model'
    const spread = obj.match(/\.\.\.deepseekThinkingOff\(\s*([\w.]+)\s*\)/)
    check(Boolean(spread) && spread![1] === modelExpr,
      `${f} 请求体 #${i + 1} 展开 deepseekThinkingOff(${modelExpr})`,
      spread ? `实际传的是 ${spread[1]}` : '没有展开共用函数')
  })
}
check(bodyCount >= 12, `扫到的 JSON 请求体不少于 12 处（实际 ${bodyCount}）`)
for (const f of Object.keys(EXEMPT)) {
  check(existsSync(join(API_ROOT, f)) && callSites.includes(f), `豁免项 ${f} 仍存在且仍是调用点（豁免不许过期）`)
}

console.log('── S2 不许再按 deepseek-v4 前缀判断 ──')
const v4Hits = [...code.entries()].filter(([, s]) => /startsWith\(\s*['"`]deepseek-v4/i.test(s)).map(([f]) => f)
check(v4Hits.length === 0, 'src 下没有 startsWith(\'deepseek-v4…\')', v4Hits.join(', '))

console.log('── S3 关闭思考只许写在共用函数一处 ──')
const handRolled = [...code.entries()].filter(([f, s]) => f !== HELPER && /\bthinking\s*:\s*\{\s*type\s*:/.test(s)).map(([f]) => f)
check(handRolled.length === 0, 'src 下（去注释）没有手写 thinking: { type: … }', handRolled.join(', '))

// ── R3：真实驱动一个调用点，抓上游收到的请求体 ────────────────────────────────
async function captureJobExplainBody(model: string): Promise<Record<string, unknown> | null> {
  let captured: Record<string, unknown> | null = null
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      try { captured = JSON.parse(raw) as Record<string, unknown> } catch { captured = null }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: '{"responsibilities":["整理资料"],"mustHaveRequirements":["细心"],"niceToHaveRequirements":[],"preparationTips":[]}' } }] }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  const config = {
    getApiKey: () => 'test-key-not-real',
    getConfig: () => ({ enabled: true, vendor: 'deepseek', model, baseURL: `http://127.0.0.1:${port}/v1`, temperature: 0.3, forbiddenWords: [] }),
  } as unknown as LlmConfigService
  try {
    await new JobAiLlmService(config).explain({
      jobId: 'j1', title: '行政助理', company: '示例公司', city: '青岛', sourceName: '示例来源',
      description: '整理资料', requirements: '细心', skills: [],
    } as unknown as Parameters<JobAiLlmService['explain']>[0])
  } catch { /* 只关心请求体，结果成败无关 */ } finally {
    await new Promise<void>((r) => server.close(() => r()))
  }
  return captured
}

async function main(): Promise<void> {
  console.log('── R3 真实驱动岗位解读（此前没关思考的调用点）──')
  const ds = await captureJobExplainBody('deepseek-flash')
  check(deepEq(ds?.['thinking'], OFF['thinking']), '模型 deepseek-flash：上游收到 thinking.type=disabled', JSON.stringify(ds?.['thinking']))
  const qw = await captureJobExplainBody('qwen-plus')
  check(qw !== null && !('thinking' in qw), '模型 qwen-plus：上游请求体里没有 thinking 字段', JSON.stringify(qw && Object.keys(qw)))

  clearTimeout(watchdog)
  console.log(`\n${failed === 0 ? 'PASSED' : 'FAILED'}  verify:llm-thinking-off  ${passed} 通过 / ${failed} 失败`)
  process.exitCode = failed === 0 ? 0 : 1
}

void main()
