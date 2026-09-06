/**
 * S0-1 / 风险 R1：助手 mock 回落必须可被识别。
 *
 * 为什么需要这条守门：
 *   `AiService.chatWithAssistant` 是全站**唯一**在功能位未就绪时会回落到
 *   `this.provider`（mock provider 有 5 段预置话术）的 AI 路径。回落时用户看到的
 *   仍然是一段像模像样的「回答」。若响应里没有 provider 标签，前端无从分辨，
 *   P25/P26 就是一个会说话的假 AI —— 正面违反 CLAUDE.md §9「不伪造能力」。
 *
 * 覆盖：
 *   1. isLlmProviderLabel 的判定边界（只认 `llm:` 前缀，其余一律 false）
 *   2. 运行时：功能位就绪 → providerLabel=`llm:<vendor>` 且 aiGenerated=true
 *   3. 运行时：功能位未就绪（mock 回落）→ providerLabel=provider 名且 aiGenerated=false
 *   4. 运行时：回落时 reply 非空（回落本身仍要给用户内容），但**不得**被标成 AI 生成
 *   5. AiServiceLog 记的 provider 与响应透出的 providerLabel 是同一个值
 *   6. 静态：DTO 响应类型是 AssistantChatResult（带 providerLabel/aiGenerated），
 *      不是裸 ChatOutput —— 防止有人把字段从对外契约上摘掉
 *   7. 静态：审计不再把 provider 记成恒定的 getProviderName()
 *
 * 不触网、不碰 DB（logService 用 stub）。
 * 运行：pnpm --filter @ai-job-print/api verify:assistant-provider-label
 */
import { createServer } from 'http'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { AiService } from '../src/ai/ai.service'
import {
  LlmChatService,
  assistantOwnerKey,
  MAX_ASSISTANT_SESSIONS,
  MAX_ASSISTANT_SESSIONS_PER_OWNER,
} from '../src/ai/llm/llm-chat.service'
import { isLlmProviderLabel } from '../src/ai/interfaces/ai-provider.interface'
import type { ChatInput, ChatOutput } from '../src/ai/interfaces/ai-provider.interface'

const ROOT = join(__dirname, '..')

let passCount = 0
let failCount = 0

function pass(msg: string) { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string) { failCount += 1; console.error(`  FAIL ${msg}`) }

function read(rel: string): string {
  const path = join(ROOT, rel)
  if (!existsSync(path)) { fail(`文件不存在: ${rel}`); return '' }
  return readFileSync(path, 'utf8')
}

function assertContains(src: string, pattern: string | RegExp, label: string) {
  const ok = typeof pattern === 'string' ? src.includes(pattern) : pattern.test(src)
  ok ? pass(label) : fail(label)
}

function assertNotContains(src: string, pattern: string | RegExp, label: string) {
  const bad = typeof pattern === 'string' ? src.includes(pattern) : pattern.test(src)
  bad ? fail(label) : pass(label)
}

// ─── 1. isLlmProviderLabel 判定边界 ──────────────────────────────────────────

for (const [label, expected] of [
  ['llm:deepseek', true],
  ['llm:qwen', true],
  ['llm:', true],
  ['mock', false],
  ['llm-deepseek', false],
  ['x-llm:deepseek', false],
  ['LLM:deepseek', false],
  ['', false],
] as const) {
  const actual = isLlmProviderLabel(label)
  if (actual === expected) pass(`isLlmProviderLabel("${label}") = ${String(expected)}`)
  else fail(`isLlmProviderLabel("${label}") 应为 ${String(expected)}，实际 ${String(actual)}`)
}

// ─── 2–5. 运行时：真实模型 vs mock 回落 ─────────────────────────────────────
//
// chatWithAssistant 只用到 llmConfig / provider / llmChat / logService 四个依赖，
// 而 AiService 的构造函数需要 17 个 DI 参数（含 Prisma / Files / Audit）。
// 这里用 Object.create(prototype) + 直接装配这四个依赖，
// 精确覆盖被测分支，且不拉起 DI 图、不连库、不触网。

type LoggedCall = { provider: string; operation: string; status: string }

function makeService(ready: boolean, vendor: string, fallbackProviderName: string) {
  const logged: LoggedCall[] = []
  const svc = Object.create(AiService.prototype) as AiService & Record<string, unknown>
  svc['llmConfig'] = {
    isReady: (feature: string) => feature === 'assistant_chat' && ready,
    getConfig: () => ({ vendor }),
  }
  svc['llmChat'] = {
    chat: async (input: ChatInput): Promise<ChatOutput> => ({
      sessionId: input.sessionId!,
      reply: '真实模型回答',
    }),
  }
  svc['provider'] = {
    name: fallbackProviderName,
    chatAssistant: async (input: ChatInput): Promise<ChatOutput> => ({
      sessionId: input.sessionId!,
      reply: '这是 mock provider 的预置话术，看起来同样像一段 AI 回答。',
    }),
  }
  svc['logService'] = {
    record: (entry: LoggedCall) => { logged.push(entry) },
  }
  return { svc: svc as AiService, logged }
}

async function runtimeChecks(): Promise<void> {
  // 2. 功能位就绪 → 真实模型
  {
    const { svc, logged } = makeService(true, 'deepseek', 'mock')
    const out = await svc.chatWithAssistant({ message: '你好', sessionId: 's-llm' })
    if (out.providerLabel === 'llm:deepseek') pass('运行时: 就绪时 providerLabel=llm:deepseek')
    else fail(`运行时: 就绪时 providerLabel 应为 llm:deepseek，实际 ${String(out.providerLabel)}`)
    if (out.aiGenerated === true) pass('运行时: 就绪时 aiGenerated=true')
    else fail(`运行时: 就绪时 aiGenerated 应为 true，实际 ${String(out.aiGenerated)}`)
    if (logged[0]?.provider === out.providerLabel) pass('运行时: 就绪时 AiServiceLog.provider 与响应一致')
    else fail(`运行时: 日志 provider=${String(logged[0]?.provider)} 与响应 ${String(out.providerLabel)} 不一致`)
  }

  // 3 + 4. 功能位未就绪 → mock 回落，必须如实标记
  {
    const { svc, logged } = makeService(false, 'deepseek', 'mock')
    const out = await svc.chatWithAssistant({ message: '你好', sessionId: 's-mock' })
    if (out.providerLabel === 'mock') pass('运行时: 回落时 providerLabel=mock')
    else fail(`运行时: 回落时 providerLabel 应为 mock，实际 ${String(out.providerLabel)}`)
    if (out.aiGenerated === false) pass('运行时: 回落时 aiGenerated=false（不冒充 AI 回答）')
    else fail(`运行时: 回落时 aiGenerated 应为 false，实际 ${String(out.aiGenerated)}`)
    if (isLlmProviderLabel(out.providerLabel)) fail('运行时: 回落 providerLabel 不得被判为真实模型')
    else pass('运行时: 回落 providerLabel 不被判为真实模型')
    // 回落仍要给用户内容（不是白屏），但内容不得被当成 AI 生成
    if (out.reply.length > 0) pass('运行时: 回落仍返回可用文案（功能退化不瘫痪）')
    else fail('运行时: 回落 reply 为空')
    if (logged[0]?.provider === 'mock') pass('运行时: 回落时 AiServiceLog.provider=mock')
    else fail(`运行时: 回落日志 provider 应为 mock，实际 ${String(logged[0]?.provider)}`)
  }

  // 其它 stub provider 名同样不得被判为 AI
  {
    const { svc } = makeService(false, 'deepseek', 'qwen')
    const out = await svc.chatWithAssistant({ message: '你好', sessionId: 's-stub' })
    if (out.aiGenerated === false && out.providerLabel === 'qwen') {
      pass('运行时: stub provider 名（qwen）不被误判为 llm:qwen')
    } else {
      fail(`运行时: stub provider 判定错误 label=${String(out.providerLabel)} ai=${String(out.aiGenerated)}`)
    }
  }
}

// ─── 6–7. 静态契约 ──────────────────────────────────────────────────────────

const iface = read('src/ai/interfaces/ai-provider.interface.ts')
assertContains(iface, 'export interface AssistantChatResult', '契约: 声明 AssistantChatResult')
assertContains(iface, 'providerLabel: string', '契约: AssistantChatResult 含 providerLabel')
assertContains(iface, 'aiGenerated: boolean', '契约: AssistantChatResult 含 aiGenerated')

const dto = read('src/ai/dto/assistant-chat.dto.ts')
assertContains(dto, 'AssistantChatResponseDto = AssistantChatResult', '契约: 对外响应类型带 provider 标签')
assertNotContains(dto, /AssistantChatResponseDto\s*=\s*ChatOutput/, '契约: 对外响应未退回裸 ChatOutput')

const ctrl = read('src/ai/ai.controller.ts')
assertContains(ctrl, 'providerName: result.providerLabel', '审计: provider 记本次实际生效的标签')
assertContains(ctrl, 'aiGenerated: result.aiGenerated', '审计: 记录是否 AI 生成')

const shared = readFileSync(join(ROOT, '..', '..', 'packages', 'shared', 'src', 'types', 'ai.ts'), 'utf8')
assertContains(shared, 'providerLabel?: string', 'shared: AssistantChatResponse 透出 providerLabel（可选）')
assertContains(shared, 'aiGenerated?: boolean', 'shared: AssistantChatResponse 透出 aiGenerated（可选）')

const chatSrc = read('src/ai/llm/llm-chat.service.ts')
assertContains(chatSrc, 'randomBytes', '会话 id 由服务端 randomBytes 铸造')
assertContains(chatSrc, 'ownerKey', '会话绑定归属')
assertContains(chatSrc, 'MAX_ASSISTANT_SESSIONS', '会话 Map 有上限')
if (MAX_ASSISTANT_SESSIONS >= 32 && MAX_ASSISTANT_SESSIONS <= 1024) {
  pass(`MAX_ASSISTANT_SESSIONS=${MAX_ASSISTANT_SESSIONS} 在合理区间`)
} else {
  fail(`MAX_ASSISTANT_SESSIONS 异常: ${MAX_ASSISTANT_SESSIONS}`)
}
if (MAX_ASSISTANT_SESSIONS_PER_OWNER >= 4 && MAX_ASSISTANT_SESSIONS_PER_OWNER <= 64) {
  pass(`MAX_ASSISTANT_SESSIONS_PER_OWNER=${MAX_ASSISTANT_SESSIONS_PER_OWNER} 在合理区间`)
} else {
  fail(`MAX_ASSISTANT_SESSIONS_PER_OWNER 异常: ${MAX_ASSISTANT_SESSIONS_PER_OWNER}`)
}
if (assistantOwnerKey('u1', '1.1.1.1') !== assistantOwnerKey('u2', '1.1.1.1')) {
  pass('会员归属键按 endUserId 隔离')
} else fail('会员归属键未按 endUserId 隔离')
if (assistantOwnerKey(null, '10.0.0.1') !== assistantOwnerKey(null, '10.0.0.2')) {
  pass('匿名归属键按 IP 摘要隔离')
} else fail('匿名归属键未按 IP 隔离')

async function sessionIsolationChecks(): Promise<void> {
  const bodies: string[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += String(c) })
    req.on('end', () => {
      bodies.push(body)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => resolve()) })
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  const chat = new LlmChatService({
    getApiKey: () => 'stub-key',
    getConfig: () => ({
      vendor: 'deepseek',
      model: 'stub',
      baseURL: `http://127.0.0.1:${port}`,
      systemPrompt: 'sys',
      roleScope: '',
      forbiddenWords: [],
      temperature: 0,
      enabled: true,
    }),
  } as never)
  try {
    const a = await chat.chat({ message: 'SECRET_SESSION_A' }, undefined, 'ip:aaa')
    const b = await chat.chat({ message: 'probe', sessionId: a.sessionId }, undefined, 'ip:bbb')
    if (b.sessionId === a.sessionId) fail('两个匿名归属不得共用 sessionId')
    else pass('两个匿名 sessionId 互不可见：归属不同则另铸 id')
    if ((bodies[1] ?? '').includes('SECRET_SESSION_A')) fail('B 的请求不得带上 A 的对话')
    else pass('两个匿名 sessionId 互不可见：B 的 prompt 不含 A 的原文')
    const a2 = await chat.chat({ message: 'followup', sessionId: a.sessionId }, undefined, 'ip:aaa')
    if (a2.sessionId !== a.sessionId) fail('同一归属应延续原 sessionId')
    else pass('同一归属可续聊')
    if (!(bodies[2] ?? '').includes('SECRET_SESSION_A')) fail('续聊应带上本人历史')
    else pass('续聊带上本人历史')

    type SessionStore = Map<string, { updatedAt: number; ownerKey: string }>
    const store = (chat as unknown as { sessions: SessionStore }).sessions

    let stallNext = false
    let stallRelease = () => { /* set below */ }
    const stall = new Promise<void>((resolve) => { stallRelease = resolve })
    server.removeAllListeners('request')
    server.on('request', (req, res) => {
      let body = ''
      req.on('data', (c) => { body += String(c) })
      req.on('end', () => {
        bodies.push(body)
        const finish = () => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
        }
        if (stallNext) {
          void stall.then(finish)
          return
        }
        finish()
      })
    })
    const t0 = store.get(a.sessionId)?.updatedAt ?? 0
    await new Promise((resolve) => setTimeout(resolve, 20))
    stallNext = true
    const continued = chat.chat({ message: 'keep-alive', sessionId: a.sessionId }, undefined, 'ip:aaa')
    await new Promise((resolve) => setTimeout(resolve, 30))
    const during = store.get(a.sessionId)?.updatedAt ?? 0
    if (during <= t0) fail('命中已有会话应在 LLM 返回前刷新 updatedAt')
    else pass('命中已有会话在 LLM 期间已刷新 updatedAt')
    stallNext = false
    stallRelease()
    await continued

    const other = await chat.chat({ message: 'keep-other' }, undefined, 'ip:other')
    const floodOwner = 'ip:flood'
    for (let i = 0; i < MAX_ASSISTANT_SESSIONS_PER_OWNER + 2; i += 1) {
      await chat.chat({ message: `flood-${i}` }, undefined, floodOwner)
    }
    const floodCount = [...store.values()].filter((s) => s.ownerKey === floodOwner).length
    if (floodCount > MAX_ASSISTANT_SESSIONS_PER_OWNER) {
      fail(`同一归属会话不得超过 ${MAX_ASSISTANT_SESSIONS_PER_OWNER}，实际 ${floodCount}`)
    } else {
      pass(`同一归属会话上限生效（${floodCount}/${MAX_ASSISTANT_SESSIONS_PER_OWNER}）`)
    }
    if (!store.has(other.sessionId)) fail('其他归属的会话不应被匿名洪水挤掉')
    else pass('其他归属的会话未被同归属 LRU 挤掉')
  } finally {
    server.close()
  }
}

// ─── 结果 ────────────────────────────────────────────────────────────────────

void (async () => {
  try {
    await runtimeChecks()
    await sessionIsolationChecks()
  } catch (error) {
    fail(`运行时检查异常: ${error instanceof Error ? error.message : String(error)}`)
  }
  console.log(`\nS0-1 助手 provider 可识别验证: ${passCount} PASS, ${failCount} FAIL`)
  if (failCount > 0) process.exit(1)
})()
