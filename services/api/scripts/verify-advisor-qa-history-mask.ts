import 'dotenv/config'
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { AiLogService } from '../src/ai/ai-log.service'
import { AdvisorService } from '../src/advisor/advisor.service'
import { AdvisorArtifactService } from '../src/advisor/advisor-artifact.service'
import { AdvisorPdfService } from '../src/advisor/advisor-pdf.service'
import { AdvisorQaMemory } from '../src/advisor/advisor-qa-memory'
import { LlmAdvisorService } from '../src/advisor/llm-advisor.service'
import { maskUserTextForLlmText } from '../src/common/pii/llm-input-mask'

// ============================================================
// 作业面追问：用户原话存进内存前遮盖，发给模型前再遮一遍。
//
// 比的是假模型收到的真实出站请求体（替换 global.fetch，传输层仍是 LlmAdvisorService）。
// 运行：pnpm --filter @ai-job-print/api verify:advisor-qa-history-mask
// ============================================================

const fallbackDbDir = process.env['DATABASE_URL'] ? null : mkdtempSync(join(tmpdir(), 'verify-advisor-qa-mask-'))
if (fallbackDbDir) process.env['DATABASE_URL'] = `file:${join(fallbackDbDir, 'verify-advisor-qa-mask.db')}`
process.on('exit', () => {
  if (fallbackDbDir) rmSync(fallbackDbDir, { recursive: true, force: true })
})
process.env['SECRET_ENCRYPTION_KEY'] ??= 'verify-advisor-qa-mask-key-0123456789abcdef'
process.env['JWT_SECRET'] ??= 'verify-advisor-qa-mask-jwt-0123456789abcdef'
process.env['FILE_SIGNING_SECRET'] ??= 'verify-advisor-qa-mask-file-0123456789abcdef'
process.env['AI_ENDPOINT_ALLOWLIST_EXTRA'] = [process.env['AI_ENDPOINT_ALLOWLIST_EXTRA'], 'llm.invalid']
  .filter(Boolean)
  .join(',')

/** 与既有遮盖门禁相同的固定测试号，不另造随机号码。 */
const PHONE = '13800138000'

/**
 * 进对话的标记不含数字。带连号数字的随机串会被遮盖当成手机号或银行卡改掉。
 */
function textMark(label: string): string {
  return `${label}${randomUUID().replace(/-/g, '').replace(/\d/g, (digit) => 'ghijklmnop'[Number(digit)]!)}`
}

let passCount = 0
function pass(message: string): void {
  passCount += 1
  console.log(`  PASS ${message}`)
}
function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  throw new Error(message)
}
function assert(condition: boolean, message: string): void {
  if (condition) pass(message)
  else fail(message)
}

interface CapturedCall { body: string }
const captured: CapturedCall[] = []
const realFetch = global.fetch

function installFakeLlm(content: string): void {
  captured.length = 0
  global.fetch = (async (_url: string, init?: { body?: string }) => {
    captured.push({ body: init?.body ?? '' })
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
    }
  }) as unknown as typeof fetch
}

function phoneTokens(text: string): string[] {
  return [...text.matchAll(/\[手机号_\d+\]/gu)].map((match) => match[0])
}

const readyConfig = {
  isReady: () => true,
  getApiKey: () => 'verify-only-fake-key',
  getConfig: () => ({
    vendor: 'fakevendor',
    model: 'fake-model-v1',
    baseURL: 'https://llm.invalid/v1',
    systemPrompt: '',
    roleScope: '',
    forbiddenWords: [],
    temperature: 0.6,
    enabled: true,
  }),
} as unknown as ConstructorParameters<typeof LlmAdvisorService>[0]

async function initFallbackDb(): Promise<void> {
  const client = createClient({ url: process.env['DATABASE_URL']! })
  try {
    await client.batch([
      `CREATE TABLE "EndUser" ("id" TEXT NOT NULL PRIMARY KEY, "phoneHash" TEXT NOT NULL, "phoneEnc" TEXT NOT NULL, "wxOpenId" TEXT, "nickname" TEXT, "enabled" BOOLEAN NOT NULL DEFAULT true, "status" TEXT NOT NULL DEFAULT 'active', "statusChangedAt" DATETIME, "closingRequestedAt" DATETIME, "anonymizedAt" DATETIME, "lastLoginAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE UNIQUE INDEX "EndUser_phoneHash_key" ON "EndUser"("phoneHash")`,
      `CREATE TABLE "AuditLog" ("id" TEXT NOT NULL PRIMARY KEY, "actorId" TEXT, "actorRole" TEXT NOT NULL, "action" TEXT NOT NULL, "targetType" TEXT NOT NULL, "targetId" TEXT, "payloadJson" TEXT NOT NULL DEFAULT '{}', "ipAddress" TEXT, "userAgent" TEXT, "requestId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE "AiServiceLog" ("id" TEXT NOT NULL PRIMARY KEY, "operation" TEXT NOT NULL, "provider" TEXT, "status" TEXT NOT NULL, "latencyMs" INTEGER, "errorCode" TEXT, "tokenUsageJson" TEXT NOT NULL DEFAULT '{}', "estimatedCostCny" REAL, "terminalId" TEXT, "endUserId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE "AdvisorSession" ("id" TEXT NOT NULL PRIMARY KEY, "endUserId" TEXT, "accessTokenHash" TEXT, "skill" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'collecting', "topic" TEXT NOT NULL, "skillReason" TEXT, "skillSource" TEXT NOT NULL DEFAULT 'llm', "slotsJson" TEXT NOT NULL DEFAULT '{}', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" DATETIME NOT NULL)`,
    ])
  } finally {
    client.close()
  }
}

async function main(): Promise<void> {
  console.log('\n=== 作业面追问历史遮盖 ===')
  const markHist = textMark('追问历史标记')
  const markNow = textMark('追问本轮标记')
  assert(!/\d/u.test(markHist) && !/\d/u.test(markNow), '自检：两个标记都不含数字')
  const alreadyMasked = `前文 [手机号_1] ${markHist}`
  assert(
    maskUserTextForLlmText(alreadyMasked, 'advisor_qa') === alreadyMasked,
    '自检：已经是 [手机号_1] 的文字再遮一遍，占位和标记都原样留下',
  )

  if (fallbackDbDir) await initFallbackDb()
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const aiLog = new AiLogService(prisma)
  const llm = new LlmAdvisorService(readyConfig)
  const artifacts = new AdvisorArtifactService(
    prisma,
    new AdvisorPdfService(),
    { upload: async () => { throw new Error('本门禁不上传文件') } } as unknown as ConstructorParameters<typeof AdvisorArtifactService>[2],
    audit,
  )
  const svc = new AdvisorService(prisma, llm, artifacts, audit, aiLog)
  const userId = `eu_qamask_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const owner = { endUserId: userId, accessToken: null }
  let sessionId = ''

  try {
    await prisma.endUser.create({
      data: { id: userId, phoneHash: `qamask-${userId}`, phoneEnc: `qamask-enc-${userId}`, nickname: userId },
    })
    installFakeLlm(JSON.stringify({ skill: 'qa', reason: '拿不准的判断题。' }))
    const created = await svc.createSession('我拿不准要不要解释空窗', owner)
    sessionId = created.sessionId
    assert(created.skill === 'qa', '建会话判成问答型')

    const firstQuestion = `${markHist}，离职要不要写原因，手机${PHONE}`
    const secondQuestion = `${markNow}，那超过半年呢，还是${PHONE}`
    const answerJson = JSON.stringify({
      answer: '三个月一般不用专门解释。',
      evidenceLevel: 'E1',
      sourceNote: '通行做法',
    })
    installFakeLlm(answerJson)
    await svc.ask(sessionId, firstQuestion, owner)
    installFakeLlm(answerJson)
    await svc.ask(sessionId, secondQuestion, owner)

    assert(captured.length === 1, '阳性：第二轮确实发出一次模型请求')
    const body = captured[0]!.body
    assert(body.includes(markHist), '阳性：第二轮出站请求带上了第一轮的标记（历史确实拼进去了）')
    assert(body.includes(markNow), '阳性：第二轮出站请求带上了本轮标记')
    assert(!body.includes(PHONE), '第二轮出站请求里没有原手机号')
    assert(body.includes('[手机号_'), '第二轮出站请求里有手机号占位')

    const userMessage = (JSON.parse(body) as { messages?: Array<{ role?: string; content?: string }> }).messages
      ?.find((message) => message.role === 'user')?.content ?? ''
    const splitAt = userMessage.indexOf('【用户这一问】')
    assert(splitAt > 0, '阳性：出站用户消息分成历史和本轮两段')
    const historyPart = userMessage.slice(0, splitAt)
    const currentPart = userMessage.slice(splitAt)
    assert(historyPart.includes(markHist) && currentPart.includes(markNow), '两段各自带上对应标记')
    const historyTokens = phoneTokens(historyPart)
    const currentTokens = phoneTokens(currentPart)
    // 只断言两轮都换成了占位、都不是原号。编号跨轮是否一致不作保证：存进内存时是按单轮编号的，
    // 多轮里两个不同号码可能共用同一个占位（不外发原号，只影响模型理解；已写进 PR 的已知局限）。
    assert(
      historyTokens.length === 1 && currentTokens.length === 1,
      `历史和本轮各有一个手机号占位、都不是原号（历史 ${historyTokens.join(',') || '无'}，本轮 ${currentTokens.join(',') || '无'}）`,
    )

    const turns = (svc as unknown as { qaMemory: AdvisorQaMemory }).qaMemory.read(sessionId)
    const userTurns = turns.filter((turn) => turn.role === 'user')
    assert(userTurns.length === 2, '阳性：内存里有两轮用户发言')
    assert(userTurns.every((turn) => !turn.content.includes(PHONE)), '内存里存的用户发言不含原手机号')
    assert(
      userTurns[0]!.content.includes(markHist) && userTurns[0]!.content.includes('[手机号_')
        && userTurns[1]!.content.includes(markNow) && userTurns[1]!.content.includes('[手机号_'),
      '阳性：内存里两轮都还在，而且已经是占位',
    )

    // 第二层单独防：绕过「存之前遮」，直接往内存里写一条带原号的历史再追问——发出去之前也要遮掉
    const memory = (svc as unknown as { qaMemory: AdvisorQaMemory }).qaMemory
    const markRaw = textMark('绕过第一层的原话标记')
    memory.append(sessionId, `${markRaw}，我的号是${PHONE}`, '好的。', `u:${userId}`)
    installFakeLlm(answerJson)
    await svc.ask(sessionId, `${textMark('第三轮标记')}，那还要注意什么`, owner)
    assert(captured.length === 1, '阳性：第三轮确实发出一次模型请求')
    const body3 = captured[0]!.body
    assert(body3.includes(markRaw), '阳性：直接写进内存的那条原话确实拼进了第三轮请求')
    assert(!body3.includes(PHONE), '第二层：内存里混进原话时，发出去之前也会遮掉')

    console.log(`\n=== 作业面追问历史遮盖通过：${passCount} PASS ===\n`)
  } finally {
    global.fetch = realFetch
    await aiLog.flush()
    if (sessionId) {
      await prisma.advisorSession.deleteMany({ where: { id: sessionId } })
      await prisma.auditLog.deleteMany({ where: { targetId: sessionId } })
    }
    await prisma.aiServiceLog.deleteMany({ where: { endUserId: userId } })
    await prisma.endUser.deleteMany({ where: { id: userId } })
    await prisma.onModuleDestroy()
  }
}

main().catch((error: unknown) => {
  console.error('\n验证脚本异常：', error instanceof Error ? error.message : error)
  process.exit(1)
})
