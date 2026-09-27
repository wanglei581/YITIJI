/**
 * 小程序首发提审前的三项后端合同：
 * 1. 简历对照不再产出等级，提示词去掉投递引导，违规词命中后沿用丢弃重试。
 * 2. age_14_plus / voice_recording 同意可授予、撤回、重复授予；未登录声明写入任务日志。
 * 3. /assistant/chat 的 miniapp 渠道只返回已注册页面，回复兜底；kiosk 不变。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:miniapp-review-backend
 */
require('dotenv').config()

import { createServer, type Server } from 'http'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { inflateSync } from 'zlib'
import { Logger } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { AiLogService } from '../src/ai/ai-log.service'
import { LlmJobFitService, JOB_FIT_SYSTEM_PROMPT } from '../src/ai/resume/llm-job-fit.service'
import { JobFitPdfService } from '../src/ai/resume/job-fit-pdf.service'
import {
  MemberPrivacyService,
  CURRENT_AGE_14_PLUS_CONSENT_VERSION,
  CURRENT_VOICE_RECORDING_CONSENT_VERSION,
  VOICE_RECORDING_CONSENT_COPY,
} from '../src/member-privacy/member-privacy.service'
import {
  readClientDeclaration,
  runWithClientDeclaration,
  CLIENT_DECLARATION_DECLARED,
  CLIENT_DECLARATION_UNDECLARED,
} from '../src/common/privacy/client-declaration'
import {
  MINIAPP_REGISTERED_PAGES,
  applyAssistantChannel,
  miniappChannelConstraint,
} from '../src/ai/llm/assistant-channel'

let passCount = 0
function pass(msg: string) { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string): never { console.error(`  FAIL ${msg}`); throw new Error(`VERIFY FAILED: ${msg}`) }

Logger.overrideLogger({ log() {}, error() {}, warn() {}, debug() {}, verbose() {} })

function utf16Hex(hex: string): string {
  const clean = hex.replace(/\s+/g, '')
  if (!clean || clean.length % 4 !== 0) return ''
  let text = ''
  for (let i = 0; i < clean.length; i += 4) text += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16))
  return text
}

function pdfStreams(buffer: Buffer): string[] {
  const source = buffer.toString('latin1')
  const streams: string[] = []
  const marker = /stream\r?\n/g
  let match: RegExpExecArray | null
  while ((match = marker.exec(source))) {
    const start = match.index + match[0].length
    const end = source.indexOf('endstream', start)
    if (end < 0) continue
    const raw = Buffer.from(source.slice(start, end), 'latin1')
    try { streams.push(inflateSync(raw).toString('latin1')) } catch { streams.push(raw.toString('latin1')) }
  }
  return streams
}

function pdfText(buffer: Buffer): string {
  const streams = pdfStreams(buffer)
  const cmap = new Map<number, string>()
  for (const stream of streams) {
    for (const block of stream.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const range of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g)) {
        const from = parseInt(range[1], 16)
        const to = parseInt(range[2], 16)
        if (range[3]) {
          let code = parseInt(range[3], 16)
          for (let cid = from; cid <= to; cid += 1) cmap.set(cid, String.fromCharCode(code++))
        } else {
          const values = [...range[4].matchAll(/<([0-9A-Fa-f]+)>/g)].map((item) => utf16Hex(item[1]))
          values.forEach((value, index) => cmap.set(from + index, value))
        }
      }
    }
    for (const block of stream.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const item of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        cmap.set(parseInt(item[1], 16), utf16Hex(item[2]))
      }
    }
  }
  const chunks: string[] = []
  for (const stream of streams) {
    for (const hex of stream.matchAll(/<([0-9A-Fa-f]+)>/g)) {
      const clean = hex[1]
      if (clean.length < 4 || clean.length % 4 !== 0) continue
      let text = ''
      for (let i = 0; i < clean.length; i += 4) {
        const cid = parseInt(clean.slice(i, i + 4), 16)
        text += cmap.get(cid) ?? ''
      }
      if (text) chunks.push(text)
    }
    for (const literal of stream.matchAll(/\((?:\\\)|\\.|[^\\)])+\)/g)) {
      chunks.push(literal[0].slice(1, -1))
    }
  }
  return chunks.join('\n')
}

function pagesFromAppJson(raw: string): string[] {
  const app = JSON.parse(raw) as {
    pages?: string[]
    subpackages?: Array<{ root: string; pages: string[] }>
  }
  const pages = [...(app.pages ?? [])]
  for (const pack of app.subpackages ?? []) {
    for (const page of pack.pages) pages.push(`${pack.root}/${page}`.replace(/\/+/g, '/'))
  }
  return pages.sort()
}

const RESUME = '负责档案管理与会议安排，熟练使用Office办公软件。'
const CLEAN = {
  fitLevel: 'reference_high',
  summary: '简历原文写了档案管理，没有写跨部门协调。',
  matchPoints: [{ requirement: '熟悉档案管理', point: '写了档案管理', evidence: '负责档案管理与会议安排' }],
  gapPoints: [{ requirement: '跨部门协调', gap: '还没写协调经历', suggestion: '如有真实协调经历可以补上' }],
  targetedSuggestions: ['把档案管理写在靠前的位置'],
}

function startStub(queue: string[], seen: string[]): Promise<{ server: Server; url: string }> {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        seen.push(body)
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({
          choices: [{ message: { content: queue.shift() ?? '{}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }))
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolvePromise({ server, url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}` })
    })
  })
}

async function main() {
  const appJsonPath = resolve(__dirname, '../../../apps/miniapp/app.json')
  const fromApp = pagesFromAppJson(readFileSync(appJsonPath, 'utf8'))
  const fromConst = [...MINIAPP_REGISTERED_PAGES].sort()
  if (fromApp.join('\n') !== fromConst.join('\n')) {
    fail(`小程序页面常量与 app.json 不一致：app=${fromApp.length} const=${fromConst.length}`)
  }
  pass('1. 小程序页面常量与 app.json（含分包）一致')

  if (JOB_FIT_SYSTEM_PROMPT.includes('投递请引导用户前往岗位来源平台')) fail('2. 提示词仍有第 4 条')
  if (JOB_FIT_SYSTEM_PROMPT.includes('优先选择更匹配的岗位')) fail('2. 提示词仍有第 5 条')
  if (JOB_FIT_SYSTEM_PROMPT.includes('fitLevel') || JOB_FIT_SYSTEM_PROMPT.includes('总评')) fail('2. 提示词仍要求等级或总评')
  pass('2. 对照提示词不再含投递引导两条，也不再要求等级或总评')

  const queue: string[] = []
  const seen: string[] = []
  const stub = await startStub(queue, seen)
  const llm = new LlmJobFitService({
    getApiKey: () => 'stub-key',
    getConfig: () => ({ vendor: 'deepseek', model: 'stub', baseURL: stub.url, systemPrompt: '', roleScope: '', forbiddenWords: [], temperature: 0, enabled: true, apiKeyEncrypted: 'x' }),
  } as never)
  const job = { title: '行政专员', company: null, description: '负责公司日常行政事务与跨部门协调', requirements: '熟悉档案管理' }
  try {
    queue.push(JSON.stringify(CLEAN))
    const clean = await llm.analyze(RESUME, job)
    if ('fitLevel' in clean.payload) fail('3. 干净输出仍返回了 fitLevel')
    if (JSON.stringify(clean.payload).includes('reference_high')) fail('3. 响应里仍有等级')
    const sent = seen[0] ?? ''
    if (!sent.includes('不要输出等级、百分比或通过率')) fail('3. 实际请求没发新提示词')
    if (sent.includes('录用概率')) fail('3. 提示词不应再写出录用概率这四个字')
    if (sent.includes('投递请引导用户前往岗位来源平台') || sent.includes('优先选择更匹配的岗位')) {
      fail('3. 实际请求仍含已删除的两条')
    }
    pass('3. 模型输出里的等级被丢掉，实际提示词不再含那两条')

    queue.push(JSON.stringify({ ...CLEAN, summary: '建议投递，参考等级较高。', fitLevel: 'reference_high' }))
    queue.push(JSON.stringify({ ...CLEAN, gapPoints: [{ gap: '差距', suggestion: '适合投递' }] }))
    try {
      await llm.analyze(RESUME, job)
      fail('4. 违规词应导致失败')
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('VERIFY FAILED')) throw error
      const body = JSON.stringify((error as { getResponse?: () => unknown }).getResponse?.() ?? error)
      if (!body.includes('AI_JOB_FIT_FAILED')) fail(`4. 失败码不符: ${body}`)
      if (body.includes('建议投递') || body.includes('reference_high') || body.includes('适合投递')) {
        fail('4. 失败响应仍带出违规词或等级')
      }
    }
    pass('4. 建议投递 / 适合投递命中后丢弃重试，最终 AI_JOB_FIT_FAILED，响应不含这些词')
  } finally {
    stub.server.close()
  }

  const pdf = new JobFitPdfService()
  const rendered = await pdf.render(
    {
      date: '2026-09-26',
      job: { title: '行政专员', company: null, sourceName: null, sourceUrl: null, externalId: null },
      decisionSupport: undefined,
      contentId: 'verify-miniapp-review',
    },
    {
      summary: '建议投递。参考等级较高。总评很好。匹配度很高。',
      matchPoints: [{ point: '胜任这项工作', evidence: '负责档案管理与会议安排' }],
      gapPoints: [{ gap: '适合投递', suggestion: '建议投递' }],
      targetedSuggestions: ['匹配度很高就去'],
    },
  )
  const text = pdfText(rendered.buffer)
  if (!text.includes('简历里已经写到的要求') || !text.includes('简历里还没体现的要求')) {
    fail('5. PDF 文本提取失败或两栏标题没写上')
  }
  for (const term of ['建议投递', '适合投递', '胜任', '匹配度', '参考等级', '总评', 'reference_high', 'reference_medium', 'reference_low']) {
    if (text.includes(term)) fail(`5. PDF 文本仍含 ${term}`)
  }
  pass('5. PDF 不印参考等级，违规词被改写后也不出现')

  const prisma = new PrismaService()
  const suffix = Date.now().toString(36)
  const endUserId = `mpback_consent_${suffix}`
  const privacy = new MemberPrivacyService(prisma)
  const aiLog = new AiLogService(prisma)
  try {
    await prisma.endUser.create({ data: { id: endUserId, phoneHash: `h_${suffix}`, phoneEnc: `e_${suffix}` } })
    const first = await privacy.grantConsent(endUserId, 'age_14_plus', null)
    if (!first.granted || first.consentVersion !== CURRENT_AGE_14_PLUS_CONSENT_VERSION || first.revokedAt) {
      fail('6. 首次授予 age_14_plus 未写入版本')
    }
    await privacy.grantConsent(endUserId, 'age_14_plus', null)
    const ageRows = await prisma.userAiConsent.findMany({ where: { endUserId, scope: 'age_14_plus' } })
    if (ageRows.length !== 2 || ageRows.some((row) => row.consentVersion !== CURRENT_AGE_14_PLUS_CONSENT_VERSION)) {
      fail('6. 重复授予没有各写一条版本')
    }
    const revoked = await privacy.revokeConsent(endUserId, 'age_14_plus')
    if (revoked.count !== 2 || revoked.revoked !== true) fail('6. 撤回没有写满 revokedAt')
    const afterRevoke = (await privacy.getConsentStatus(endUserId)).find((item) => item.scope === 'age_14_plus')
    if (!afterRevoke || afterRevoke.granted || !afterRevoke.revokedAt) fail('6. 撤回后仍显示有效')
    const voice = await privacy.grantConsent(endUserId, 'voice_recording', null)
    await privacy.revokeConsent(endUserId, 'voice_recording')
    const voiceAgain = await privacy.grantConsent(endUserId, 'voice_recording', null)
    if (voice.consentVersion !== CURRENT_VOICE_RECORDING_CONSENT_VERSION || !voiceAgain.granted || voiceAgain.revokedAt) {
      fail('6. voice_recording 重复授予后版本或状态不对')
    }
    if (!VOICE_RECORDING_CONSENT_COPY.includes('语音识别') || !VOICE_RECORDING_CONSENT_COPY.includes('声纹') || !VOICE_RECORDING_CONSENT_COPY.includes('撤回')) {
      fail('6. 录音同意文案缺少用途、识别方或撤回')
    }
    const voiceRows = await prisma.userAiConsent.findMany({ where: { endUserId, scope: 'voice_recording' } })
    if (!voiceRows.some((row) => row.revokedAt) || !voiceRows.every((row) => row.consentVersion === CURRENT_VOICE_RECORDING_CONSENT_VERSION)) {
      fail('6. 录音同意版本或撤回时间没落库')
    }
    pass('6. 登录态授予、重复授予、撤回都写入版本和 revokedAt')

    const declaredHeaders = {
      'x-age-14-plus': 'declared',
      'x-age-14-plus-version': 'age-14-plus-v1',
      'x-voice-recording': 'granted',
      'x-voice-recording-version': 'voice-recording-v1',
    }
    const provider = `llm:mpback-${suffix}`
    const baseLog = {
      taskId: `mpback_${suffix}`,
      provider,
      operation: 'chatAssistant' as const,
      latencyMs: 1,
      status: 'success' as const,
      endUserId: null,
    }
    runWithClientDeclaration(readClientDeclaration(declaredHeaders), () => {
      aiLog.record({ ...baseLog, taskId: `mpback_on_${suffix}` })
    })
    runWithClientDeclaration(readClientDeclaration({}), () => {
      aiLog.record({ ...baseLog, taskId: `mpback_off_${suffix}` })
    })
    runWithClientDeclaration(readClientDeclaration(declaredHeaders), () => {
      aiLog.record({ ...baseLog, taskId: `mpback_member_${suffix}`, endUserId })
    })
    await aiLog.flush()
    const mine = await prisma.aiServiceLog.findMany({
      where: { provider, operation: 'chatAssistant' },
      orderBy: { createdAt: 'asc' },
    })
    const withHeaders = mine.find((row) => row.clientDeclarationJson?.includes('age-14-plus-v1'))
    const withoutHeaders = mine.find((row) => row.clientDeclarationJson?.includes(CLIENT_DECLARATION_UNDECLARED) && !row.endUserId)
    const memberRow = mine.find((row) => row.endUserId === endUserId)
    if (!withHeaders?.clientDeclarationJson?.includes(CLIENT_DECLARATION_DECLARED) || !withHeaders.clientDeclarationJson.includes('voice-recording-v1')) {
      fail(`7. 带头请求没有写下版本: ${withHeaders?.clientDeclarationJson}`)
    }
    if (withHeaders.endUserId) fail('7. 未登录声明日志写了个人身份')
    if (!withoutHeaders) fail('7. 不带头请求没有记成未声明')
    const absent = JSON.parse(withoutHeaders.clientDeclarationJson ?? '{}') as {
      age14?: { status?: string; version?: string | null }
      voiceRecording?: { status?: string; version?: string | null }
    }
    if (absent.age14?.status !== CLIENT_DECLARATION_UNDECLARED || absent.age14.version !== null) fail('7. 缺头的年满14不是未声明')
    if (absent.voiceRecording?.status !== CLIENT_DECLARATION_UNDECLARED || absent.voiceRecording.version !== null) {
      fail('7. 缺头的录音不是未声明')
    }
    if (memberRow?.clientDeclarationJson) fail('7. 已登录任务把声明写进了带身份的日志')
    pass('7. 未登录带头写入版本，不带头记未声明，已登录行不写这份快照')

    const sample = {
      reply: '你可以去看看招聘会，也可以查看岗位信息和企业资料。',
      actions: [
        { label: '查看岗位', route: '/jobs' },
        { label: '查看招聘会', route: '/job-fairs' },
        { label: '上传简历', route: '/resume/source' },
        { label: '人社专区', route: '/renshi' },
      ],
    }
    const kiosk = applyAssistantChannel(sample, undefined)
    if (kiosk !== sample) fail('8. kiosk 缺省应保持原对象')
    if (!kiosk.actions?.some((action) => action.route === '/jobs')) fail('8. kiosk 丢了岗位跳转')
    if (!kiosk.reply.includes('招聘会')) fail('8. kiosk 回复被改写了')
    const mini = applyAssistantChannel(sample, 'miniapp')
    if (mini.reply.includes('招聘会') || mini.reply.includes('岗位信息') || mini.reply.includes('企业资料') || mini.reply.includes('政策')) {
      fail(`8. miniapp 回复兜底没拦住: ${mini.reply}`)
    }
    for (const action of mini.actions ?? []) {
      const page = action.route.replace(/^\//, '').split('?')[0]
      if (!fromConst.includes(page)) fail(`8. miniapp action 不在页面清单: ${action.route}`)
    }
    if (mini.actions?.some((action) => /jobs|job-fairs|renshi|岗位|招聘会|企业/.test(`${action.route}${action.label}`))) {
      fail('8. miniapp 仍返回岗位、招聘会或企业跳转')
    }
    if (!mini.actions?.some((action) => action.route === '/pages/resume-upload/resume-upload')) {
      fail('8. 已注册的简历上传页被滤掉了')
    }
    if (!miniappChannelConstraint().includes('不要引导用户查看岗位、招聘会或企业资料')) fail('8. 小程序提示词约束缺失')
    if (miniappChannelConstraint().includes('可以继续帮助整理简历') === false) fail('8. 小程序提示词约束不完整')
    pass('8. miniapp 只留已注册页面且回复被兜底，kiosk 跳转和回复不变')
  } finally {
    await prisma.userAiConsent.deleteMany({ where: { endUserId } }).catch(() => undefined)
    await prisma.aiServiceLog.deleteMany({ where: { OR: [{ endUserId }, { provider: `llm:mpback-${suffix}` }] } }).catch(() => undefined)
    await prisma.endUser.deleteMany({ where: { id: endUserId } }).catch(() => undefined)
    await prisma.onModuleDestroy()
  }

  console.log(`\nALL PASS (${passCount})`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
