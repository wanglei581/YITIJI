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
const malformed = await llmFetchJson('http://test', { method: 'POST', headers: {}, body: 'not-json' }, { timeoutMs: 5000, gate: new LlmConcurrencyGate(2), fetchImpl, contentModeration: { forbiddenWords: ['输入禁词'] } })
assert.equal(malformed.ok, true)
const root = join(process.cwd(), 'src'); const files: string[] = []
function walk(dir: string) { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.ts')) files.push(p) } }
walk(root)
for (const file of files) { const s = readFileSync(file, 'utf8'); if (s.includes('chat/completions') && !s.includes('llmFetchJson(') && !file.endsWith('llm-http.ts') && !file.endsWith('llm-presets.ts') && !file.includes('__tests__') && !file.includes('/trtc/') && !file.includes('contract-review-provider.service.ts')) throw new Error(`LLM call bypasses moderation底座: ${file}`) }
console.log(`verify:ai-content-moderation passed (${files.length} source files scanned)`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
