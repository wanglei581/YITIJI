/** 政策原文按轮现读、不可见不调模型；只写显式隔离库，fetch 替身不触网。 */
import 'dotenv/config'
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { NestFactory } from '@nestjs/core'
import { MODULE_METADATA } from '@nestjs/common/constants'
import { AiService } from '../src/ai/ai.service'
import { AiModule } from '../src/ai/ai.module'
import { LlmConfigService } from '../src/ai/llm/llm-config.service'
import { LlmChatService } from '../src/ai/llm/llm-chat.service'
import { AssistantChatRequestDto } from '../src/ai/dto/assistant-chat.dto'
import { AI_POLICY_ANSWER_CONSTRAINT } from '../src/ai/safety/policy-constraint'
import { AI_POLICY_EXPLAIN_CONSTRAINT } from '../src/ai/safety/policy-explain-constraint'
import { AssistantPolicyContextService, POLICY_UNAVAILABLE_REPLY } from '../src/ai/llm/assistant-policy-context'
import { PrismaService } from '../src/prisma/prisma.service'
import type { ChatInput } from '../src/ai/interfaces/ai-provider.interface'
import { ANONYMOUS_AI_CALLER, lazyAiRequestContext, runWithAiRequestContext } from '../src/ai/usage/ai-usage-context'
import { consumeSafetyRefund } from '../src/ai/safety/block-log'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

process.env.AI_PROVIDER = 'mock'
process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED = 'false'
let passed = 0
function check(label: string, fn: () => void) { fn(); passed++; console.log(`PASS ${label}`) }

async function main() {
  assertIsolatedVerificationDatabase()
  const prisma = new PrismaService()
  const orgId = `verify-policy-${randomUUID()}`
  const savedFetch = globalThis.fetch
  const sent: Array<{ messages: Array<{ role: string; content: string }> }> = []
  let ready = true
  let fallbackCalls = 0
  let upstreamStatus = 200
  const config = {
    isReady: () => ready,
    getApiKey: () => 'verify-only-key',
    getConfig: () => ({
      vendor: 'openai', model: 'verify', baseURL: 'http://127.0.0.1/v1', enabled: true,
      systemPrompt: `你是小青。\n${AI_POLICY_ANSWER_CONSTRAINT}`, roleScope: '', forbiddenWords: [], temperature: 0,
    }),
  }
  // 从真实 AiModule 取注册项，用最小上下文验证 Nest 确实注入只读政策服务（不启动 HTTP/Redis）。
  const registered = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AiModule) as unknown[]
  check('真实 AiModule 注册政策读取服务与聊天服务', () => {
    assert.ok(registered.includes(AssistantPolicyContextService) && registered.includes(LlmChatService))
  })
  const context = await NestFactory.createApplicationContext({
    module: class PolicyContextVerificationModule {},
    providers: [
      ...registered.filter(item => item === AssistantPolicyContextService || item === LlmChatService),
      { provide: PrismaService, useValue: prisma }, { provide: LlmConfigService, useValue: config },
    ],
  }, { logger: false })
  const chat = context.get(LlmChatService)
  const svc = Object.assign(Object.create(AiService.prototype) as AiService, {
    llmConfig: config, llmChat: chat,
    provider: { name: 'mock', chatAssistant: async () => { fallbackCalls++; return { sessionId: 'mock-session', reply: 'mock reply' } } },
    logService: { record: () => undefined },
  })
  globalThis.fetch = async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify(upstreamStatus === 200
      ? { choices: [{ message: { content: '原文中的名词可在正文部分核对。请以官方原文和经办窗口为准。' } }] }
      : { error: { message: 'verify unavailable' } }), { status: upstreamStatus, headers: { 'Content-Type': 'application/json' } })
  }
  const turn = (input: ChatInput) => runWithAiRequestContext(lazyAiRequestContext(async () => ({ ...ANONYMOUS_AI_CALLER })), async () => {
    const result = await svc.chatWithAssistant(input, 'verify-policy-owner')
    return { result, refund: consumeSafetyRefund() }
  })
  const system = () => sent.at(-1)?.messages.find(m => m.role === 'system')?.content ?? ''
  try {
    await prisma.organization.create({ data: {
      id: orgId, name: '验证发布机构', type: 'government',
      verifiedOfficialDomainsJson: JSON.stringify([{ domain: 'mohrss.gov.cn', verifiedAt: new Date().toISOString(), verifiedBy: 'verify' }]),
    } })
    const row = await prisma.policyPost.create({ data: {
      sourceOrgId: orgId, sourceName: '验证发布机构', title: '验证政策原文',
      summary: '验证摘要', content: '原文正文：验证名词解释段落',
      whoCanApply: '原文申请人群段', requiredMaterials: '原文材料段', whereToApply: '原文办理窗口段',
      publishedDate: new Date('2026-11-05T00:00:00Z'), externalUrl: 'https://www.mohrss.gov.cn/verify-original?private=never-in-prompt',
      reviewStatus: 'approved', publishStatus: 'published',
    } })
    const active = await turn({ message: '这个名词是什么意思', policyId: row.id, skill: 'hr_qa',
      context: { content: '前端伪造正文', whoCanApply: '前端伪造人群' } })
    check('已发布政策送模型：原文、三栏、机构与日期来自隔离库，前端正文不受信任', () => {
      assert.equal(active.result.aiGenerated, true)
      assert.equal(sent.length, 1)
      for (const text of ['本次对话要讲解的政策原文', '验证政策原文', '验证发布机构', '2026-11-05', '验证摘要', '原文正文：验证名词解释段落',
        '谁可以申请', '原文申请人群段', '要准备的材料', '原文材料段', '去哪办', '原文办理窗口段', 'www.mohrss.gov.cn']) assert.ok(system().includes(text), text)
      assert.ok(!system().includes('前端伪造'))
      assert.ok(!system().includes('private=never-in-prompt'))
    })
    check('讲解约束与 10/8 定稿全文各恰好一次（含 HR 技能的多层守卫）', () => {
      for (const rule of [AI_POLICY_EXPLAIN_CONSTRAINT, AI_POLICY_ANSWER_CONSTRAINT]) assert.equal(system().split(rule).length - 1, 1)
    })
    await prisma.policyPost.update({ where: { id: row.id }, data: { content: '已更新的本轮原文', whereToApply: '已更新的窗口段' } })
    await turn({ message: '再说说这里', sessionId: active.result.sessionId, policyId: row.id })
    check('同一会话每轮重新读取原文与三栏，不缓存上轮正文', () => {
      assert.ok(system().includes('已更新的本轮原文') && system().includes('已更新的窗口段'))
      assert.ok(!system().includes('原文正文：验证名词解释段落'))
    })
    for (const externalUrl of ['https://unverified.example/path', 'http://www.mohrss.gov.cn/path', null]) {
      await prisma.policyPost.update({ where: { id: row.id }, data: { externalUrl } })
      await turn({ message: '讲讲名词', policyId: row.id })
      check(`未核验/缺失链接不写域名：${externalUrl ?? '空'}`, () => {
        assert.ok(!system().includes('原文网址域名'))
        assert.ok(!system().includes('unverified.example'))
      })
    }
    await prisma.policyPost.update({ where: { id: row.id }, data: { externalUrl: 'https://www.mohrss.gov.cn/path' } })
    await prisma.organization.update({ where: { id: orgId }, data: { verifiedOfficialDomainsJson: '[]' } })
    await turn({ message: '讲讲名词', policyId: row.id })
    check('机构当前撤销核验后立即停止注入域名', () => assert.ok(!system().includes('原文网址域名')))
    await prisma.policyPost.update({ where: { id: row.id }, data: { content: '长'.repeat(13000), summary: null, whoCanApply: null } })
    await turn({ message: '原文哪一部分有说明', policyId: row.id })
    check('长正文明确截断；空字段不伪造内容', () => {
      assert.ok(system().includes('[已截断]'))
      assert.ok(!system().includes('长'.repeat(12001)))
      assert.ok(system().includes('"谁可以申请":"原文没有写"'))
    })
    for (const status of ['draft', 'unpublished', 'expired']) {
      await prisma.policyPost.update({ where: { id: row.id }, data: { publishStatus: status } })
      const before = sent.length
      const unavailable = await turn({ message: '接着讲', policyId: row.id, sessionId: active.result.sessionId })
      check(`${status}：固定原话、非模型标识、未调用模型/回落、退公网次数`, () => {
        assert.equal(unavailable.result.reply, POLICY_UNAVAILABLE_REPLY)
        assert.equal(unavailable.result.aiGenerated, false)
        assert.equal(unavailable.result.providerLabel, 'fixed:policy-unavailable')
        assert.equal(sent.length, before)
        assert.equal(fallbackCalls, 0)
        assert.equal(unavailable.refund, true)
      })
    }
    await prisma.policyPost.update({ where: { id: row.id }, data: { publishStatus: 'published', reviewStatus: 'pending' } })
    const reject = async (id: string, label: string) => {
      const before = sent.length
      const { result } = await turn({ message: '接着讲', policyId: id, sessionId: active.result.sessionId })
      check(label, () => { assert.equal(result.reply, POLICY_UNAVAILABLE_REPLY); assert.equal(result.aiGenerated, false); assert.equal(sent.length, before) })
    }
    await reject(row.id, '未审核通过也不可见')
    await prisma.policyPost.update({ where: { id: row.id }, data: { reviewStatus: 'approved' } })
    await prisma.recruitmentEmergencyHold.create({ data: {
      targetType: 'policy', targetId: row.id, orgId, reasonCode: 'verify', reasonText: 'verify', actorId: 'verify',
    } })
    await reject(row.id, '紧急下架后同一会话立即拒绝，不调模型')
    ready = false
    await reject(row.id, '提供方不可用时，下架政策仍固定回复、不调 mock 回落')
    await reject('verify-policy-does-not-exist', '不存在的政策不调模型')
    const ordinary = await turn({ message: '你好' })
    check('不带 policyId 的 mock 回落行为不变', () => { assert.equal(ordinary.result.providerLabel, 'mock'); assert.equal(fallbackCalls, 1) })
    ready = true
    await turn({ message: '你好', sessionId: active.result.sessionId })
    check('取消政策后恢复普通聊天，没有原文/讲解约束及上一条政策历史', () => {
      assert.ok(!system().includes('本次对话要讲解的政策原文'))
      assert.ok(!system().includes(AI_POLICY_EXPLAIN_CONSTRAINT))
      assert.equal(system().split(AI_POLICY_ANSWER_CONSTRAINT).length - 1, 1)
      assert.deepEqual(sent.at(-1)?.messages.filter(m => m.role !== 'system'), [{ role: 'user', content: '你好' }])
    })
    await prisma.recruitmentEmergencyHold.deleteMany({ where: { targetType: 'policy', targetId: row.id } })
    upstreamStatus = 503
    await assert.rejects(turn({ message: '讲讲名词', policyId: row.id }))
    check('可见政策上游不可用仍走既有失败处理，不伪造回答', () => assert.equal(sent.at(-1)?.messages.some(m => m.content.includes('本次对话要讲解的政策原文')), true))
    for (const policyId of ['x'.repeat(65), 123]) {
      check('DTO 拒绝超长或非字符串 policyId', () => assert.ok(validateSync(plainToInstance(AssistantChatRequestDto, { message: '你好', policyId })).some(e => e.property === 'policyId')))
    }
    check('DTO 接受 64 字编号和普通聊天', () => {
      assert.equal(validateSync(plainToInstance(AssistantChatRequestDto, { message: '你好', policyId: 'x'.repeat(64) })).length, 0)
      assert.equal(validateSync(plainToInstance(AssistantChatRequestDto, { message: '你好' })).length, 0)
    })
  } finally {
    globalThis.fetch = savedFetch
    const rows = await prisma.policyPost.findMany({ where: { sourceOrgId: orgId }, select: { id: true } })
    await prisma.recruitmentEmergencyHold.deleteMany({ where: { targetType: 'policy', targetId: { in: rows.map(r => r.id) } } })
    await prisma.policyPost.deleteMany({ where: { sourceOrgId: orgId } })
    await prisma.organization.deleteMany({ where: { id: orgId } })
    await context.close()
  }
  console.log(`verify:assistant-policy-context PASS ${passed}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
