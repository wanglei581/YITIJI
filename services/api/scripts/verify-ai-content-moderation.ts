import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { AiContentBlockedError } from '../src/ai/llm/llm-guard'
import { llmFetchJson, LlmConcurrencyGate } from '../src/ai/llm/llm-http'
async function main() {
const response = (body: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => body }) as Response
let calls = 0
const fetchImpl = async (_url: string, init: RequestInit) => { calls++; let request: any = {}; try { request = JSON.parse(String(init.body)) } catch {} return response({ choices: [{ message: { content: calls === 1 ? '输出禁词' : '干净回复' } }] }) }
await assert.rejects(llmFetchJson('http://test', { method: 'POST', headers: {}, body: JSON.stringify({ messages: [{ role: 'user', content: '输入禁词' }] }) }, { timeoutMs: 5000, gate: new LlmConcurrencyGate(2), fetchImpl, contentModeration: { feature: 'verify', forbiddenWords: ['输入禁词'] } }), (e: unknown) => e instanceof AiContentBlockedError && e.direction === 'input')
assert.equal(calls, 0)
await assert.rejects(llmFetchJson('http://test', { method: 'POST', headers: {}, body: JSON.stringify({ messages: [{ role: 'user', content: '正常' }] }) }, { timeoutMs: 5000, gate: new LlmConcurrencyGate(2), fetchImpl, contentModeration: { feature: 'verify', forbiddenWords: ['输出禁词'] } }), (e: unknown) => e instanceof AiContentBlockedError && e.direction === 'output')
assert.equal(calls, 1)
const clean = await llmFetchJson('http://test', { method: 'POST', headers: {}, body: JSON.stringify({ messages: [{ role: 'user', content: '正常' }] }) }, { timeoutMs: 5000, gate: new LlmConcurrencyGate(2), fetchImpl, contentModeration: { forbiddenWords: [] } })
assert.equal((clean.data as any).choices[0].message.content, '干净回复')
// 只查最新一条用户消息：历史里的旧消息不再二次拦截（词表热更新后也不会锁死会话）
const history = JSON.stringify({ messages: [{ role: 'user', content: '旧话含输入禁词' }, { role: 'assistant', content: '好' }, { role: 'user', content: '新的一句' }] })
const beforeHistory = calls
await llmFetchJson('http://test', { method: 'POST', headers: {}, body: history }, { timeoutMs: 5000, gate: new LlmConcurrencyGate(2), fetchImpl, contentModeration: { forbiddenWords: ['输入禁词'] } })
assert.equal(calls, beforeHistory + 1, '历史里的旧消息命中不应再拦本轮')
const latestHit = JSON.stringify({ messages: [{ role: 'user', content: '旧话' }, { role: 'assistant', content: '好' }, { role: 'user', content: '新的一句含输入禁词' }] })
await assert.rejects(llmFetchJson('http://test', { method: 'POST', headers: {}, body: latestHit }, { timeoutMs: 5000, gate: new LlmConcurrencyGate(2), fetchImpl, contentModeration: { forbiddenWords: ['输入禁词'] } }), (e: unknown) => e instanceof AiContentBlockedError && e.direction === 'input')
const malformed = await llmFetchJson('http://test', { method: 'POST', headers: {}, body: 'not-json' }, { timeoutMs: 5000, gate: new LlmConcurrencyGate(2), fetchImpl, contentModeration: { forbiddenWords: ['输入禁词'] } })
assert.equal(malformed.ok, true)
// 小青：命中给礼貌拒答、不报错；输入侧命中的原话不能留在会话历史里——
// 否则下一轮带着整段历史再发，检查点再次命中，这个会话之后每句都会被拒答。
const { LlmChatService } = await import('../src/ai/llm/llm-chat.service')
const chatConfig = { vendor: 'openai', model: 'm', baseURL: 'http://llm.invalid/v1', systemPrompt: '你是就业服务助手', roleScope: '', forbiddenWords: ['违禁词甲'], temperature: 0, enabled: true }
const chat = new LlmChatService({ getApiKey: () => 'verify-key', getConfig: () => chatConfig } as never)
const sentBodies: string[] = []
let modelReply = '好的，我们继续看简历。'
const savedFetch = globalThis.fetch
;(globalThis as { fetch: unknown }).fetch = async (_url: string, init: RequestInit) => { sentBodies.push(String(init.body)); return response({ choices: [{ message: { content: modelReply } }] }) }
try {
  const first = await chat.chat({ message: '请帮我写违禁词甲', channel: 'kiosk' } as never)
  assert.equal(sentBodies.length, 0, '输入命中时不应调模型')
  assert.ok(first.reply.length > 0 && !first.reply.includes('违禁词甲'), '输入命中应给礼貌拒答')
  const second = await chat.chat({ message: '帮我看看简历怎么写', sessionId: first.sessionId, channel: 'kiosk' } as never)
  assert.equal(sentBodies.length, 1, '同一会话下一句正常话应当照常调模型（被拦的原话不能毒化会话）')
  assert.equal(second.reply, '好的，我们继续看简历。')
  // 系统提示词里本来就列着「禁用词列表」，只看用户消息
  const userTexts = (JSON.parse(sentBodies[0]!) as { messages: Array<{ role: string; content: string }> }).messages
    .filter((message) => message.role === 'user').map((message) => message.content)
  assert.ok(userTexts.every((text) => !text.includes('违禁词甲')), '发给模型的历史里不应再有被拦的那句')
  modelReply = '这里讲讲违禁词甲'
  const third = await chat.chat({ message: '再详细说说', sessionId: first.sessionId, channel: 'kiosk' } as never)
  assert.ok(!third.reply.includes('违禁词甲'), '输出命中应给礼貌拒答')
  modelReply = '正常回答'
  const fourth = await chat.chat({ message: '继续', sessionId: first.sessionId, channel: 'kiosk' } as never)
  assert.equal(fourth.reply, '正常回答', '输出命中也不应毒化会话')
  // 词表热更新：早先说过的话后来成了禁词，之后的新消息仍应照常回答（不能永久锁死会话）
  chatConfig.forbiddenWords.push('继续')
  const fifth = await chat.chat({ message: '那就这样吧', sessionId: first.sessionId, channel: 'kiosk' } as never)
  assert.equal(fifth.reply, '正常回答', '历史里的旧话命中新加的禁词，不应让本轮合规的新消息被拒答')
  chatConfig.forbiddenWords.pop()
  // C12：托管关闭时，一体机渠道的动作里不出现岗位类入口；托管开启时保持原样
  const savedHosting = process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED']
  process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
  const offJob = await chat.chat({ message: '我想找份工作', channel: 'kiosk' } as never)
  assert.ok(!(offJob.actions ?? []).some((action: { route: string }) => /^\/(jobs|job-fairs|companies)(\/|$)/.test(action.route)), '托管关闭时一体机动作里不应有岗位类入口')
  process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'true'
  const onJob = await chat.chat({ message: '我想找份工作', channel: 'kiosk' } as never)
  assert.ok((onJob.actions ?? []).some((action: { route: string }) => action.route === '/jobs'), '托管开启时一体机动作保持原样（有查看岗位）')
  if (savedHosting === undefined) delete process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED']; else process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = savedHosting
} finally {
  ;(globalThis as { fetch: unknown }).fetch = savedFetch
}
const root = join(process.cwd(), 'src'); const files: string[] = []
function walk(dir: string) { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.ts')) files.push(p) } }
walk(root)
for (const file of files) { const s = readFileSync(file, 'utf8'); if (s.includes('chat/completions') && !s.includes('llmFetchJson(') && !file.endsWith('llm-http.ts') && !file.endsWith('llm-presets.ts') && !file.includes('__tests__') && !file.includes('/trtc/') && !file.includes('contract-review-provider.service.ts')) throw new Error(`LLM call bypasses moderation底座: ${file}`) }
console.log(`verify:ai-content-moderation passed (${files.length} source files scanned)`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
