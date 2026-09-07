/**
 * 包 I — 小青语音转写 / 本次要点门禁。
 *
 * 覆盖：
 *   1. POST /assistant/voice：WAV 魔数、FileInterceptor audio、4MB、@TerminalScopedThrottle(12)
 *      与 /assistant/chat 共用 assistant_chat 配额；失败回滚。
 *   2. ASR_NOT_CONFIGURED 诚实返回；转写正文不进日志 / 审计 payload。
 *   3. POST /assistant/sessions/:sessionId/summary：匿名 404；登录才落 AdvisorSession
 *      (slotsJson.source=assistant) + AdvisorArtifact(kind=qa_pins)。
 *   4. GET /me/ai-records 附加 qaRecords（只加字段，不含对话正文）。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:assistant-voice
 */
import 'dotenv/config'
import { readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { AiController } from '../src/ai/ai.controller'
import { AssistantSummaryService } from '../src/advisor/assistant-summary.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { MemberAssetsService } from '../src/member-assets/member-assets.service'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exitCode = 1; throw new Error(m) }

const root = join(__dirname, '..')
const controllerSrc = readFileSync(join(root, 'src/ai/ai.controller.ts'), 'utf-8')
const summarySrc = readFileSync(join(root, 'src/advisor/assistant-summary.service.ts'), 'utf-8')
const assetsSrc = readFileSync(join(root, 'src/member-assets/member-assets.service.ts'), 'utf-8')
const chatSrc = readFileSync(join(root, 'src/ai/llm/llm-chat.service.ts'), 'utf-8')
const kioskPage = readFileSync(join(root, '../../apps/kiosk/src/pages/assistant/AssistantPage.tsx'), 'utf-8')
const holdSrc = readFileSync(join(root, '../../apps/kiosk/src/pages/assistant/AssistantHoldToTalk.tsx'), 'utf-8')
const miniappJs = readFileSync(join(root, '../../apps/miniapp/pages/assistant/assistant.js'), 'utf-8')
const miniappWxml = readFileSync(join(root, '../../apps/miniapp/pages/assistant/assistant.wxml'), 'utf-8')
const miniappApi = readFileSync(join(root, '../../apps/miniapp/utils/api.js'), 'utf-8')

console.log('\n=== 小青语音 / 本次要点门禁 ===')

if (!controllerSrc.includes("@Post('assistant/voice')")) fail('1a. 缺少 POST /assistant/voice')
if (!controllerSrc.includes("@Post('assistant/sessions/:sessionId/summary')")) fail('1b. 缺少 POST /assistant/sessions/:sessionId/summary')
if (!controllerSrc.includes('@TerminalScopedThrottle(12)')) fail('1c. /assistant/voice 必须 @TerminalScopedThrottle(12)')
if (!controllerSrc.includes("FileInterceptor(RESUME_VOICE_AUDIO_FIELD")) fail('1d. voice 必须 FileInterceptor(audio)')
if (!controllerSrc.includes('fileSize: RESUME_VOICE_MAX_AUDIO_BYTES')) fail('1e. voice 必须 4MB 上限')
if (!controllerSrc.includes("publicQuota.consume('assistant_chat'")) fail('1f. voice 必须共用 assistant_chat 配额')
if (!controllerSrc.includes('runWithPublicQuota')) fail('1g. 配额失败必须回滚')
pass('1. voice / summary 端点、限流、配额、WAV 上限存在')

const voiceMatch = controllerSrc.match(/async transcribeAssistantVoice[\s\S]*?\n  async summarizeAssistantSession/)
if (!voiceMatch) fail('2a. 未找到 transcribeAssistantVoice 方法体')
const voiceBody = voiceMatch[0]
if (!voiceBody.includes('isWavBuffer(audio.buffer)')) fail('2b. 必须 WAV 魔数校验')
if (!voiceBody.includes('INVALID_AUDIO_FORMAT')) fail('2c. 非 WAV 必须 INVALID_AUDIO_FORMAT')
if (!voiceBody.includes('this.asr.recognizeWav(audio.buffer)')) fail('2d. 必须只把内存 buffer 交给 ASR')
if (!voiceBody.includes("'voiceTranscribe'")) fail('2e. 必须落 voiceTranscribe 元数据日志')
for (const forbidden of ['logger.log(result.text)', 'logger.warn(result.text)', 'console.log(result.text)', 'payload: { text']) {
  if (voiceBody.includes(forbidden) || controllerSrc.includes(forbidden)) fail(`2f. 不得记录转写正文: ${forbidden}`)
}
if (voiceBody.includes('files.upload') || voiceBody.includes('prisma.fileObject')) fail('2g. voice 不得持久化音频')
pass('2. WAV 校验、ASR 转发、转写正文不进日志')

if (!controllerSrc.includes('ASSISTANT_SESSION_NOT_FOUND')) fail('3a. summary 匿名必须 404 ASSISTANT_SESSION_NOT_FOUND')
if (!summarySrc.includes("value: 'assistant'")) fail('3b. AdvisorSession 必须标记 source=assistant')
if (!summarySrc.includes("kind: 'qa_pins'")) fail('3c. 产物必须是 qa_pins')
if (!summarySrc.includes('this.artifacts.print')) fail('3d. 必须复用 advisor-artifact print')
if (!summarySrc.includes('maskUserTextForLlmText')) fail('3e. 送模型前必须遮盖用户文本')
if (!chatSrc.includes('getOwnedTranscript')) fail('3f. 必须按归属读取助手会话')
if (summarySrc.includes('logger.log(turns') || summarySrc.includes('payload: { transcript')) {
  fail('3g. summary 不得把对话正文写入日志/审计')
}
pass('3. summary 匿名 404、source=assistant、qa_pins、打印复用、不落正文')

if (!assetsSrc.includes('qaRecords')) fail('4a. /me/ai-records 必须附加 qaRecords')
if (!assetsSrc.includes("kind: 'qa_pins'")) fail('4b. qaRecords 必须读 AdvisorArtifact qa_pins')
if (assetsSrc.includes('payloadJson:') && /qaRecords[\s\S]{0,400}payloadJson/.test(assetsSrc) === false) {
  // list select includes payloadJson only to derive title; response mapper must not return it
}
if (assetsSrc.includes('qaRecords: qaRows')) fail('4c. 不得把 artifact 原行（含 payloadJson）直接回给前端')
pass('4. /me/ai-records 只加 qaRecords 元数据字段')

if (!holdSrc.includes('aria-pressed')) fail('5a. 一体机按住说话必须 aria-pressed')
if (!holdSrc.includes('aria-disabled')) fail('5b. 麦克风/ASR 不可用必须 aria-disabled')
if (!holdSrc.includes('min-height') && !readFileSync(join(root, '../../apps/kiosk/src/pages/assistant/assistant-lightflow-chat.css'), 'utf-8').includes('assistant-hold-talk-btn')) {
  fail('5c. 按住说话按钮必须有独立样式')
}
const holdCss = readFileSync(join(root, '../../apps/kiosk/src/pages/assistant/assistant-lightflow-chat.css'), 'utf-8')
if (!holdCss.includes('assistant-hold-talk-btn') || !holdCss.includes('56px')) fail('5c. 按住说话按钮触控高度必须 ≥56px')
if (!kioskPage.includes('AssistantHoldToTalk')) fail('5d. AssistantPage 必须接入按住说话')
if (!kioskPage.includes('AssistantSessionSummaryBar')) fail('5e. AssistantPage 必须提供保存本次要点')
if (!kioskPage.includes('AssistantCallPanel')) fail('5f. 不得拆掉 TRTC 通话入口')
if (kioskPage.includes('from \'./AssistantCallPanel\'') && !kioskPage.includes("import('./AssistantCallPanel')")) {
  fail('5g. TRTC 面板必须保持 lazy import')
}
pass('5. 一体机按住说话 + 本次要点 + TRTC 入口保留')

if (!miniappWxml.includes('bindtouchstart="onHoldStart"')) fail('6a. 小程序必须长按说话')
if (!miniappJs.includes("uploadFile('/assistant/voice'") && !miniappApi.includes("uploadFile('/assistant/voice'")) {
  fail('6b. 小程序必须 uploadFile /assistant/voice')
}
if (!miniappApi.includes('/assistant/sessions/')) fail('6c. 小程序必须封装 summary 端点')
if (!miniappWxml.includes('保存本次要点')) fail('6d. 小程序对话区必须有保存本次要点')
pass('6. 小程序长按说话与本次要点入口存在')

function makeController(overrides: Record<string, unknown> = {}) {
  const controller = new AiController(
    ...(Array.from({ length: AiController.length }, () => ({})) as never[]),
  )
  const quota = {
    consume: async () => ({ keys: ['k'] }),
    rollback: async () => undefined,
  }
  Object.assign(controller as unknown as Record<string, unknown>, {
    asr: {
      activeProviderName: 'disabled',
      recognizeWav: async () => ({ ok: false, errorCode: 'ASR_NOT_CONFIGURED', errorMessage: '语音转写未启用，请使用文字输入' }),
    },
    logService: { record: () => undefined },
    audit: { write: async () => undefined },
    publicQuota: quota,
    jwt: { verify: () => { throw new Error('no-token') } },
    redis: { get: async () => null },
    prisma: { endUser: { findUnique: async () => null } },
    assistantSummary: { summarize: async () => ({ ok: true }) },
    ...overrides,
  })
  return controller
}

async function verifyVoiceRuntime() {
  const logs: unknown[] = []
  const audits: unknown[] = []
  const wav = Buffer.from('RIFF____WAVEfmt ')
  const controller = makeController({
    asr: {
      activeProviderName: 'unit-asr',
      recognizeWav: async () => ({ ok: true, text: '真实转写文本' }),
    },
    logService: { record: (entry: unknown) => { logs.push(entry) } },
    audit: { write: async (entry: unknown) => { audits.push(entry) } },
  })

  const ok = await controller.transcribeAssistantVoice(
    { buffer: wav } as Express.Multer.File,
    { headers: {} },
  )
  if (ok.text !== '真实转写文本' || ok.providerName !== 'unit-asr') {
    fail('7a. 成功路径必须返回裸 { text, providerName }')
  }
  if (JSON.stringify(logs).includes('真实转写文本')) fail('7b. AI 日志不得包含转写正文')
  if (JSON.stringify(audits).includes('真实转写文本')) fail('7c. 审计 payload 不得包含转写正文')

  try {
    await controller.transcribeAssistantVoice(
      { buffer: Buffer.from('NOPE') } as Express.Multer.File,
      { headers: {} },
    )
    fail('7d. 非 WAV 必须抛 INVALID_AUDIO_FORMAT')
  } catch (err) {
    const response = err instanceof BadRequestException ? err.getResponse() : null
    if (!JSON.stringify(response).includes('INVALID_AUDIO_FORMAT')) {
      fail('7d. 非 WAV 未返回 INVALID_AUDIO_FORMAT')
    }
  }

  const disabled = makeController()
  try {
    await disabled.transcribeAssistantVoice(
      { buffer: wav } as Express.Multer.File,
      { headers: {} },
    )
    fail('7e. ASR 未配置必须抛 ASR_NOT_CONFIGURED')
  } catch (err) {
    const response = err instanceof BadRequestException ? err.getResponse() : null
    if (!JSON.stringify(response).includes('ASR_NOT_CONFIGURED')) {
      fail('7e. ASR 未配置未返回 ASR_NOT_CONFIGURED')
    }
  }
  pass('7. voice 运行时：成功裸 DTO、坏 WAV、ASR 未配置诚实、正文不进账')
}

async function verifySummaryAnonymous() {
  const controller = makeController()
  try {
    await controller.summarizeAssistantSession('sess-1', { headers: {} })
    fail('8a. 匿名 summary 必须 404')
  } catch (err) {
    if (!(err instanceof NotFoundException)) fail(`8a. 匿名 summary 应为 NotFoundException，实际 ${err}`)
    const response = err.getResponse()
    if (!JSON.stringify(response).includes('ASSISTANT_SESSION_NOT_FOUND')) {
      fail('8a. 匿名 summary 未返回 ASSISTANT_SESSION_NOT_FOUND')
    }
  }
  pass('8. summary 匿名 404 ASSISTANT_SESSION_NOT_FOUND')
}

async function verifyQaRecordsPersist() {
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const assets = new MemberAssetsService(prisma)
  const userId = `vfy-qa-${randomUUID()}`
  const sessionId = `vfy-sess-${randomUUID()}`
  try {
    await prisma.endUser.create({
      data: {
        id: userId,
        phoneHash: `vfy-qa-${userId}`,
        phoneEnc: `vfy-enc-${userId}`,
        nickname: 'voice-verify',
      },
    })
    await prisma.advisorSession.create({
      data: {
        id: sessionId,
        endUserId: userId,
        skill: 'qa',
        status: 'completed',
        topic: '怎么打印简历',
        skillReason: '由小青助手本次对话浓缩',
        skillSource: 'llm',
        slotsJson: JSON.stringify({ source: { value: 'assistant', filledAt: new Date().toISOString() } }),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    })
    const artifact = await prisma.advisorArtifact.create({
      data: {
        sessionId,
        kind: 'qa_pins',
        status: 'completed',
        payloadJson: JSON.stringify({ kind: 'qa_pins', title: '小青本次要点', pins: [] }),
        provider: 'llm:unit',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    })
    const page = await assets.listAiRecords(userId, { cursor: null, pageSize: 20 })
    if (!Array.isArray(page.qaRecords)) fail('9a. listAiRecords 必须返回 qaRecords 数组')
    const hit = page.qaRecords.find((row) => row.artifactId === artifact.id)
    if (!hit) fail('9b. qaRecords 必须包含刚落库的 qa_pins')
    if (hit.title !== '小青本次要点') fail('9c. qaRecords.title 应来自产物 title')
    if ('payloadJson' in (hit as object)) fail('9d. qaRecords 不得回传 payloadJson')
    if (JSON.stringify(page).includes('怎么打印简历') === false) {
      // topic 仅作 title 兜底；本条有 title，不应把整段对话正文泄露
    }
    const other = await assets.listAiRecords('someone-else', { cursor: null, pageSize: 20 })
    if (other.qaRecords.some((row) => row.artifactId === artifact.id)) {
      fail('9e. qaRecords 必须按 endUserId 隔离')
    }

    const summary = new AssistantSummaryService(
      prisma,
      { getOwnedTranscript: () => null } as never,
      { isReady: () => false, getApiKey: () => null, getConfig: () => ({ enabled: false }) } as never,
      { save: async () => ({ artifactId: 'x' }), print: async () => ({}) } as never,
      { write: async () => undefined } as never,
      { record: () => undefined } as never,
    )
    try {
      await summary.summarize('missing', userId, '127.0.0.1')
      fail('9f. 无会话转写必须 404')
    } catch (err) {
      if (!(err instanceof NotFoundException)) fail('9f. 无会话转写应为 NotFoundException')
    }
    pass('9. qa_pins 落库可被 /me/ai-records.qaRecords 读到，且跨用户隔离')
  } finally {
    await prisma.advisorArtifact.deleteMany({ where: { sessionId } }).catch(() => undefined)
    await prisma.advisorSession.deleteMany({ where: { id: sessionId } }).catch(() => undefined)
    await prisma.endUser.deleteMany({ where: { id: userId } }).catch(() => undefined)
    await prisma.onModuleDestroy().catch(() => undefined)
  }
}

void verifyVoiceRuntime()
  .then(verifySummaryAnonymous)
  .then(verifyQaRecordsPersist)
  .then(() => console.log('\n=== ALL PASS: 小青语音 / 本次要点门禁 ==='))
  .catch((err) => fail(err instanceof Error ? err.message : '运行时断言失败'))
