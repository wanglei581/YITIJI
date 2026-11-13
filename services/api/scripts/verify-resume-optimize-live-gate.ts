/** 真模型探针的离线自检：真实 optimize 编排 + 受控 fetch，不监听、不触网。 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { LIVE_SAMPLES, MAX_LLM_CALLS, PRIVATE_SENTENCE, createCallBudget, main } from './check-resume-optimize-live'

export async function verifyResumeOptimizeLiveGate(): Promise<void> {
  const source = readFileSync(join(__dirname, 'check-resume-optimize-live.ts'), 'utf8')
  const ast = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true)
  let sawCap = false
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      assert(!/Prisma|AiService|ai\.service|ai-usage-log|ai-budget/i.test(node.getText(ast)), '探针禁止导入数据库/应用/落账服务')
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'MAX_LLM_CALLS') {
      sawCap = node.initializer?.getText(ast) === '8'
    }
    if (ts.isCallExpression(node) && /^(console\.|write$)/.test(node.expression.getText(ast))) {
      assert(!node.arguments.some((arg) => /apiKey|secret|authorization/i.test(arg.getText(ast))), '禁止打印密钥变量或片段')
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert(sawCap && MAX_LLM_CALLS === 8, '上限必须写死为 8')
  assert(source.includes("import 'dotenv/config'"))
  assert(source.includes("getApiKey('resume_optimize')") && source.includes("getConfig('resume_optimize')"))
  assert(source.includes('样例${index + 1} 原件段:') && source.includes('合计 调用:${budget.calls}/8 估算花费:'))
  assert(source.indexOf('budget.beforeCall();') < source.indexOf('return transport(...args)'), '必须在发请求前计数')
  assert(LIVE_SAMPLES.length === 4 && LIVE_SAMPLES[3]!.text.length >= 4500 && LIVE_SAMPLES[3]!.text.length <= 5500)

  let requests = 0
  const marker = 'offline-key-marker-do-not-print'
  const config = {
    getApiKey: (feature: string) => { assert.equal(feature, 'resume_optimize'); return marker },
    getConfig: (feature: string) => {
      assert.equal(feature, 'resume_optimize')
      return { enabled: true, vendor: 'deepseek', model: 'deepseek-flash', baseURL: 'https://api.deepseek.com/v1', forbiddenWords: [] }
    },
  } as never
  const stub: typeof fetch = async (_url, init) => {
    requests++
    assert(!String(init?.body).includes('fiction@example.com'), '发出前必须遮盖样例邮箱')
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ resume: {
        basic: { name: '' }, intention: { position: '' }, summary: '', education: [], experience: [], projects: [], skills: [], certificates: [],
      }, modules: [] }) } }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const budget = createCallBudget()
  const lines: string[] = []
  assert.equal(await main({ config, fetch: stub, budget, write: (line) => lines.push(line) }), 0)
  assert.equal(requests, 8, '4 份各重试一次，共 8 次')
  assert.equal(lines.length, 5)
  const row = /^样例[1-4] 原件段:(?:[^=,:]+=\d+,?)+ 优化版:(?:[^=,:]+=\d+,?)+ 补回:.+ 截断:\d+ 清单:\d+\(保持原文 \d+\) 调用:[12] tokens:\d+\/\d+ 结果:通过$/
  lines.slice(0, 4).forEach((line) => assert.match(line, row))
  assert.match(lines[4]!, /^合计 调用:8\/8 估算花费:0\.0048元 结论:全部保留$/)
  assert(!lines.join('\n').includes(PRIVATE_SENTENCE), '输出不含样例正文长句')
  assert(!lines.join('\n').includes(marker) && !lines.join('\n').includes('fiction@example.com'))

  const capLines: string[] = []
  assert.equal(await main({ config, fetch: stub, budget, write: (line) => capLines.push(line) }), 1)
  assert.equal(requests, 8, '第 9 次必须在传输前被拒绝')
  assert(budget.rejected)
  assert(capLines[0]!.endsWith('结果:失败(PROBE_CALL_LIMIT)'))
  assert(capLines[4]!.endsWith('结论:有丢失'))

  const absent: string[] = []
  assert.equal(await main({ config: { ...config as object, getApiKey: () => null } as never, fetch: stub, write: (line) => absent.push(line) }), 1)
  assert.deepEqual(absent, ['未验证：缺少 resume_optimize 密钥'])
  assert.equal(requests, 8)
  const saved = LIVE_SAMPLES[1]!.text
  try {
    LIVE_SAMPLES[1]!.text += '\n编写资料说明'
    const lossLines: string[] = []
    const nonemptySkill: typeof fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ resume: {
        basic: {}, intention: {}, summary: '', education: [], experience: [], projects: [],
        skills: ['整理数据'], certificates: [],
      }, modules: [] }) } }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }), { status: 200 })
    // 模型只交回「整理数据」、其余段落是空的。经历和项目仍整段补回；技能少交的单行按原稿补回，不再算丢。
    // 样例 2 因此技能条数不少于原件（多出来的是模型那一条），探针结论改为全部保留。
    assert.equal(await main({ config, fetch: nonemptySkill, write: (line) => lossLines.push(line) }), 0)
    assert(lossLines[1]!.endsWith('结果:通过'), '技能少交后按原稿补回，条数不得少于原件')
    assert(lossLines[4]!.endsWith('结论:全部保留'))
  } finally {
    LIVE_SAMPLES[1]!.text = saved
  }
  const educationSaved = LIVE_SAMPLES[1]!.text
  try {
    const extraSchools = Array.from({ length: 12 }, (_, index) => `补${index}虚构大学 信息管理 本科 2010.09-2014.06`)
    LIVE_SAMPLES[1]!.text += `\n教育经历\n${extraSchools.join('\n')}`
    const droppedLines: string[] = []
    const emptyResume: typeof fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ resume: {
        basic: {}, intention: {}, summary: '', education: [], experience: [], projects: [], skills: [], certificates: [],
      }, modules: [] }) } }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }), { status: 200 })
    // 教育经历超过导出上限 12：补回后仍被收成 12 条，条数少于原件，必须判丢内容并退出 1。
    assert.equal(await main({ config, fetch: emptyResume, write: (line) => droppedLines.push(line) }), 1)
    assert(droppedLines[1]!.endsWith('结果:丢内容'), '教育条数少于原件时必须判丢内容')
    assert(droppedLines[4]!.endsWith('结论:有丢失'))
  } finally {
    LIVE_SAMPLES[1]!.text = educationSaved
  }
  const faultLines: string[] = []
  assert.equal(await main({ config, fetch: async () => { throw new Error(PRIVATE_SENTENCE + marker) }, write: (line) => faultLines.push(line) }), 1)
  assert(faultLines[0]!.endsWith('结果:失败(AI_OPTIMIZE_UNAVAILABLE)'))
  assert(!faultLines.join('\n').includes(PRIVATE_SENTENCE) && !faultLines.join('\n').includes(marker))
  console.log('=== ALL PASS — resume-optimize-live-gate（离线、8 次上限、输出无正文/密钥） ===')
}
if (require.main === module) {
  verifyResumeOptimizeLiveGate().catch(() => { console.error('VERIFY FAILED: resume-optimize-live-gate'); process.exitCode = 1 })
}
