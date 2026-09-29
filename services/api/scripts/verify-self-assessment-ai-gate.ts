/**
 * verify:self-assessment-ai-gate —— 自我探索「维度打分」与「AI 解读」拆开：AI 被拦时打分照常出
 *
 * 规格（AI 是加速器不是前置条件）：
 *   - 维度打分是纯函数（固定权重记分），不经过模型；AI 暂停 / 额度用完 / 未开通 / 声明缺失 /
 *     登录档位拦下时，POST /resume/self-assessment 仍返回 5 维打分并落库，
 *     只有模型写的解读如实缺席：note 全 null、summary null、interpretationAvailable=false、
 *     aiUnavailableReason=闸门给的码；绝不回 mock 解读、一次也不调模型、不落 AI 账。
 *   - 全机维护照旧拦（那不是 AI 闸门，是设备停办）。
 *   - 下游：读回、打印报告、附加到简历在「只有打分」时照常可用，且文件不带 AIGC 标识
 *     （里面一个字都不是模型写的，标成 AI 产物是失真）；含 AI 解读的记录，打印 / 附加照旧过 AI 闸门。
 *
 * 做法：真控制器 + 真 AiAccessGuard + 真 AiAccessService（桩 Redis / Prisma）+ 真 SelfAssessmentService
 *   + 真 PDF 渲染；库、对象存储、审计、模型用内存桩。「额度用完」「未开通」两个码在本基线上还没有
 *   （P1-2a / P1-18 未合），这里按它们合入后在 AiAccessService.enforce 里的位置与作用范围模拟抛出 ——
 *   本改动让提交接口直接调同一个 enforce，合入后自动覆盖。
 *
 * 不触网、不连库、不连 Redis。运行：pnpm --filter @ai-job-print/api verify:self-assessment-ai-gate
 */
import 'reflect-metadata'
import { ServiceUnavailableException } from '@nestjs/common'
import { MODULE_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { PDFDocument } from 'pdf-lib'

process.env['FILE_SIGNING_SECRET'] ??= 'verify-self-assessment-ai-gate-signing-secret-0123'

import { AiAccessGuard } from '../src/ai-access/ai-access.guard'
import { AiAccessService, type AiAccessConfig } from '../src/ai-access/ai-access.service'
import { AiAccessModule } from '../src/ai-access/ai-access.module'
import type { AiUseKind } from '../src/ai-access/ai-access.decorator'
import { AiModule } from '../src/ai/ai.module'
import { SelfAssessmentController } from '../src/ai/self-assessment.controller'
import { SelfAssessmentService } from '../src/ai/resume/self-assessment.service'
import { AppendedSelfAssessmentService } from '../src/ai/resume/appended-self-assessment.service'
import { SelfAssessmentPdfService } from '../src/ai/resume/self-assessment-pdf.service'
import { LlmSelfAssessmentService } from '../src/ai/resume/llm-self-assessment.service'
import { scoreSelfAssessment } from '../src/ai/resume/self-assessment-scoring'
import { SELF_ASSESSMENT_QUESTIONS_V1 } from '../src/ai/resume/self-assessment-questions'
import { AIGC_VISIBLE_HEADER, AIGC_RULE_SCORE_NOTICE, readPdfInfo } from '../src/common/pdf/aigc-label'
import { openUnpdfDocument } from '../src/common/pdf/pdfjs-document'

// unpdf 只发 ESM/CJS 混合包，与 verify-ai-safety-aigc.ts 同样用 require 取
// eslint-disable-next-line @typescript-eslint/no-require-imports
const unpdf = require('unpdf') as {
  extractText: (pdf: unknown, options: { mergePages: boolean }) => Promise<{ text: string | string[] }>
}

let failed = 0
let passed = 0
function check(id: string, ok: boolean, detail = ''): void {
  if (ok) { passed += 1; console.log(`  PASS ${id}`) } else { failed += 1; console.error(`  FAIL ${id}${detail ? ` —— ${detail}` : ''}`) }
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return 'PASS'
  } catch (error) {
    const body = (error as { getResponse?: () => { error?: { code?: string } } }).getResponse?.()
    return body?.error?.code ?? (error instanceof Error ? error.message : String(error))
  }
}

async function visibleText(buffer: Buffer): Promise<string> {
  const doc = await openUnpdfDocument(new Uint8Array(buffer))
  const extracted = await unpdf.extractText(doc, { mergePages: true })
  const text = Array.isArray(extracted.text) ? extracted.text.join('\n') : extracted.text
  return text.replace(/\s+/gu, '')
}
const squash = (s: string) => s.replace(/\s+/gu, '')

async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i += 1) doc.addPage([300, 400])
  return Buffer.from(await doc.save())
}

// ── 桩 ─────────────────────────────────────────────────────────────────────
const jwt = new JwtService({ secret: 'verify-self-assessment-ai-gate-0123456789' })
const OFF: AiAccessConfig = { loginGate: 'off', declarationEnforced: false, paused: false, maintenance: false }

interface Row { id: string; taskId: string; kind: string; status: string; provider: string; payloadJson: string; endUserId: string | null; accessTokenHash: string | null; expiresAt: Date }

/** 未合入的两个闸门码，按合入后 enforce 里的作用范围模拟（见文件头）。 */
type Simulated = 'AI_BUDGET_EXHAUSTED' | 'AI_PROVIDER_NOT_CONFIGURED' | null
const SIMULATED_KINDS: Record<Exclude<Simulated, null>, AiUseKind[]> = {
  AI_BUDGET_EXHAUSTED: ['generate', 'voice'], // P1-2a：只拦会花钱的生成 / 语音
  AI_PROVIDER_NOT_CONFIGURED: ['generate', 'voice', 'export'], // P1-18：生成、语音与带 AIGC 标识的导出
}

function makeWorld(opts: { config?: AiAccessConfig; simulate?: Simulated; realLlmUnconfigured?: boolean } = {}) {
  const rows: Row[] = []
  const audits: Array<{ action: string; payload: Record<string, unknown> }> = []
  const aiLogs: unknown[] = []
  const uploads: Array<{ filename: string; buffer: Buffer }> = []
  let llmCalls = 0

  const prisma = {
    aiResumeResult: {
      create: async ({ data }: { data: Omit<Row, 'id'> }) => { const row = { id: `row-${rows.length + 1}`, ...data }; rows.push(row); return row },
      findUnique: async ({ where }: { where: { taskId_kind: { taskId: string; kind: string } } }) =>
        rows.find((r) => r.taskId === where.taskId_kind.taskId && r.kind === where.taskId_kind.kind) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row },
    },
    fileObject: { findUnique: async () => ({ id: 'resume-1', filename: 'resume.pdf', mimeType: 'application/pdf', endUserId: null, deletedAt: null }) },
    endUser: { findUnique: async () => ({ enabled: true, status: 'active' }) },
    userAiConsent: { findFirst: async () => null },
  }
  const audit = { write: async (e: { action: string; payload: Record<string, unknown> }) => { audits.push(e) } }
  const files = {
    upload: async (args: { buffer: Buffer; filename: string }) => {
      uploads.push({ filename: args.filename, buffer: args.buffer })
      return { fileId: `file-${uploads.length}`, filename: args.filename, sizeBytes: args.buffer.length, signedUrl: 'https://obj.example/x', signedUrlExpiresAt: new Date(Date.now() + 300_000).toISOString() }
    },
    readContent: async () => ({ buffer: await makePdf(1) }),
  }
  const log = { record: (row: unknown) => { aiLogs.push(row) } }
  const llm = opts.realLlmUnconfigured
    ? (() => {
        const real = new LlmSelfAssessmentService({
          getConfig: () => ({ vendor: 'deepseek', model: 'deepseek-chat', enabled: false, baseURL: 'https://api.deepseek.com', temperature: 0.3, forbiddenWords: [] }),
          getApiKey: () => null,
        } as never)
        const summarize = real.summarize.bind(real)
        return { summarize: async (input: Parameters<typeof summarize>[0]) => { llmCalls += 1; return summarize(input) } }
      })()
    : {
        summarize: async ({ scored }: { scored: { dimensions: Array<Record<string, unknown>> } }) => {
          llmCalls += 1
          return { status: 'completed' as const, dimensions: scored.dimensions.map((d) => ({ ...d, note: `${String(d['label'])}的陈述式解读` })), summary: '整体陈述式解读', providerName: 'deepseek' }
        },
      }

  const service = new SelfAssessmentService(prisma as never, llm as never, new SelfAssessmentPdfService(), files as never, audit as never, log as never)
  const append = new AppendedSelfAssessmentService(prisma as never, service, files as never, audit as never)

  const redis = new Proxy({}, { get: () => async () => null })
  const access = new AiAccessService(redis as never, { writeRequired: async () => 'a' } as never, jwt, prisma as never)
  let config = opts.config ?? OFF
  ;(access as unknown as { getConfig: () => Promise<AiAccessConfig> }).getConfig = async () => config
  if (opts.simulate) {
    const code = opts.simulate
    const realEnforce = access.enforce.bind(access)
    access.enforce = async (kind, maintenanceBlocked, req, cfg) => {
      const current = cfg ?? config
      if (!current.maintenance && kind && SIMULATED_KINDS[code].includes(kind)) {
        throw new ServiceUnavailableException({ error: { code, message: '模拟' } })
      }
      return realEnforce(kind, maintenanceBlocked, req, cfg)
    }
  }
  const guard = new AiAccessGuard(new Reflector(), access)
  const Ctl = SelfAssessmentController as unknown as new (...args: unknown[]) => SelfAssessmentController
  const controller = new Ctl(service, append, jwt, redis, prisma, access)

  /** 走一遍真实守卫再进控制器方法（线上顺序）。 */
  async function call<T>(method: 'submit' | 'latest' | 'print' | 'appendToResume' | 'withdraw', req: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
    const ctx = {
      getHandler: () => (SelfAssessmentController.prototype as unknown as Record<string, unknown>)[method],
      getClass: () => SelfAssessmentController,
      switchToHttp: () => ({ getRequest: () => req }),
    }
    await guard.canActivate(ctx as never)
    return run()
  }

  return {
    rows, audits, aiLogs, uploads, controller, call,
    llmCalls: () => llmCalls,
    setConfig: (next: AiAccessConfig) => { config = next },
  }
}

function answers() {
  const dims = ['interest', 'style', 'team', 'value', 'motivation'] as const
  // 每维选不同选项，让强度不全相同，免得「全 0 / 全 5」碰巧对上
  return dims.flatMap((dim, d) => Array.from({ length: 5 }, (_, idx) => ({ dim, idx, choice: (idx + d) % 2 === 0 ? 'a' : 'b' })))
}
const BODY = { answers: answers(), consent: { nonSensitive: true, sensitive: false } }
const EXPECTED = scoreSelfAssessment({ answers: BODY.answers, questions: SELF_ASSESSMENT_QUESTIONS_V1 }).dimensions

type SubmitResult = Awaited<ReturnType<SelfAssessmentController['submit']>> & {
  interpretationAvailable?: unknown
  aiUnavailableReason?: unknown
}

const anonReq = (headers: Record<string, string> = {}) => ({ headers, ip: '127.0.0.1' })

// ── 一、四种闸门状态（+ 登录档位）下提交：打分照常，解读如实缺席 ──────────────
async function gateStates(): Promise<void> {
  const states: Array<{ label: string; code: string; world: () => ReturnType<typeof makeWorld> }> = [
    { label: 'AI 暂停', code: 'AI_PAUSED', world: () => makeWorld({ config: { ...OFF, paused: true } }) },
    { label: '额度用完（模拟 P1-2a）', code: 'AI_BUDGET_EXHAUSTED', world: () => makeWorld({ simulate: 'AI_BUDGET_EXHAUSTED' }) },
    { label: '未开通（模拟 P1-18）', code: 'AI_PROVIDER_NOT_CONFIGURED', world: () => makeWorld({ simulate: 'AI_PROVIDER_NOT_CONFIGURED' }) },
    { label: '声明缺失', code: 'AI_DECLARATION_REQUIRED', world: () => makeWorld({ config: { ...OFF, declarationEnforced: true } }) },
    { label: '开始 AI 前须登录', code: 'AI_LOGIN_REQUIRED', world: () => makeWorld({ config: { ...OFF, loginGate: 'before_generate' } }) },
  ]
  for (const state of states) {
    const w = state.world()
    const req = anonReq()
    let res: SubmitResult | null = null
    const code = await codeOf(async () => { res = await w.call('submit', req, () => w.controller.submit(BODY as never, req)) as SubmitResult })
    const tag = `提交·${state.label}`
    check(`${tag}：接口不被 AI 闸门拦（照常 200）`, code === 'PASS', `实际 ${code}`)
    if (!res) continue
    const r = res as SubmitResult
    check(`${tag}：5 维打分照常，且等于纯函数记分`, r.status === 'completed' && r.dimensions.length === 5
      && r.dimensions.every((d, i) => d.key === EXPECTED[i]!.key && d.strength === EXPECTED[i]!.strength),
      JSON.stringify(r.dimensions.map((d) => [d.key, d.strength])))
    check(`${tag}：解读如实缺席（note 全 null、summary null，不回 mock）`, r.dimensions.every((d) => d.note === null) && r.summary === null)
    check(`${tag}：interpretationAvailable=false、aiUnavailableReason=${state.code}`,
      r.interpretationAvailable === false && r.aiUnavailableReason === state.code,
      `实际 ${String(r.interpretationAvailable)} / ${String(r.aiUnavailableReason)}`)
    check(`${tag}：providerName=llm_unavailable（现有一体机 / 小程序据此显示「AI 解读缺失」）`, r.providerName === 'llm_unavailable', String(r.providerName))
    check(`${tag}：一次也没调模型、不落 AI 账`, w.llmCalls() === 0 && w.aiLogs.length === 0, `调了 ${w.llmCalls()} 次，落账 ${w.aiLogs.length} 条`)
    const row = w.rows[0]
    const stored = row ? JSON.parse(row.payloadJson) as { dimensions: Array<{ strength: number }>; aiUnavailableReason?: string } : null
    check(`${tag}：落库（completed，5 维强度，记下原因码，匿名带持有凭证）`, w.rows.length === 1 && row!.status === 'completed'
      && stored!.dimensions.length === 5 && stored!.aiUnavailableReason === state.code
      && typeof r.accessToken === 'string' && row!.accessTokenHash !== null && row!.provider === 'llm_unavailable')
    const created = w.audits.find((a) => a.action === 'resume.self_assessment_create')
    check(`${tag}：创建审计照写（只记原因码，不记作答）`, created?.payload['status'] === 'completed'
      && created?.payload['aiUnavailableReason'] === state.code && !JSON.stringify(created?.payload).includes('"choice"'))

    // 下游：读回 / 打印 / 附加到简历 —— 仍在同一闸门状态下
    const reader = anonReq({ 'x-resume-access-token': String(r.accessToken) })
    let latest: SubmitResult | null = null
    const latestCode = await codeOf(async () => { latest = await w.call('latest', reader, () => w.controller.latest(r.taskId, reader)) as SubmitResult })
    check(`${tag}：读回照常且字段一致`, latestCode === 'PASS' && (latest as SubmitResult | null)?.interpretationAvailable === false
      && (latest as SubmitResult | null)?.aiUnavailableReason === state.code && (latest as SubmitResult | null)?.dimensions.length === 5, `实际 ${latestCode}`)

    let printed: { printFileUrl?: string } | null = null
    const printCode = await codeOf(async () => { printed = await w.call('print', reader, () => w.controller.print(r.taskId, reader)) })
    check(`${tag}：只有打分的报告照常能打印（拿到打印链接）`, printCode === 'PASS' && Boolean((printed as { printFileUrl?: string } | null)?.printFileUrl), `实际 ${printCode}`)
    const pdf = w.uploads.find((u) => u.filename.startsWith('self-assessment-'))
    if (pdf) {
      const info = await readPdfInfo(pdf.buffer)
      const text = await visibleText(pdf.buffer)
      check(`${tag}：打印件不带 AIGC 标识（AIGenerated=false、无 /AIGC、无「AI 生成」页眉）`,
        info['AIGenerated'] === 'false' && !info['AIGC'] && !text.includes(squash(AIGC_VISIBLE_HEADER)),
        `AIGenerated=${info['AIGenerated']} AIGC=${info['AIGC'] ? '有' : '无'} 页眉=${text.includes(squash(AIGC_VISIBLE_HEADER))}`)
      check(`${tag}：打印件写明规则打分、未含 AI 解读`, text.includes(squash(AIGC_RULE_SCORE_NOTICE)) && text.includes('未含AI解读'))
    } else check(`${tag}：打印件已生成`, false, '没有上传报告 PDF')

    let appended: { printFileUrl?: string } | null = null
    const appendCode = await codeOf(async () => {
      appended = await w.call('appendToResume', { ...reader, body: { resumeFileId: 'resume-1' } }, () => w.controller.appendToResume(r.taskId, { resumeFileId: 'resume-1' } as never, reader))
    })
    check(`${tag}：只有打分时附加到简历照常`, appendCode === 'PASS' && Boolean((appended as { printFileUrl?: string } | null)?.printFileUrl), `实际 ${appendCode}`)
    const merged = w.uploads.find((u) => u.filename.startsWith('self-assessment-append-'))
    if (merged) {
      const info = await readPdfInfo(merged.buffer)
      check(`${tag}：附加件不写 AIGC 标识`, !info['AIGC'] && info['AIGenerated'] !== 'true', `AIGenerated=${info['AIGenerated']} AIGC=${info['AIGC'] ? '有' : '无'}`)
    } else check(`${tag}：附加件已生成`, false, '没有上传合并 PDF')
  }
}

// ── 二、正常态：照常调模型、解读在；含 AI 解读的文件照旧过 AI 闸门 ─────────────
async function normalState(): Promise<void> {
  const w = makeWorld()
  const req = anonReq()
  const r = await w.call('submit', req, () => w.controller.submit(BODY as never, req)) as SubmitResult
  check('正常：调模型一次、解读在', w.llmCalls() === 1 && r.dimensions.every((d) => typeof d.note === 'string') && r.summary === '整体陈述式解读')
  check('正常：interpretationAvailable=true、aiUnavailableReason=null', r.interpretationAvailable === true && r.aiUnavailableReason === null,
    `实际 ${String(r.interpretationAvailable)} / ${String(r.aiUnavailableReason)}`)
  check('正常：providerName 为真实服务商', r.providerName === 'deepseek', String(r.providerName))
  check('正常：打分与纯函数一致', r.dimensions.every((d, i) => d.strength === EXPECTED[i]!.strength))

  const reader = anonReq({ 'x-resume-access-token': String(r.accessToken) })
  await w.call('print', reader, () => w.controller.print(r.taskId, reader))
  const pdf = w.uploads.find((u) => u.filename.startsWith('self-assessment-'))!
  const info = await readPdfInfo(pdf.buffer)
  check('正常：含 AI 解读的打印件照旧带 AIGC 标识', info['AIGenerated'] === 'true' && Boolean(info['AIGC']))

  // 含 AI 内容的记录，AI 暂停 / 未开通时打印、附加照旧被拦（不借「手动路径」绕过去）
  w.setConfig({ ...OFF, paused: true })
  check('正常记录·AI 暂停：打印含 AI 解读的报告仍被拦（AI_PAUSED）', (await codeOf(() => w.call('print', reader, () => w.controller.print(r.taskId, reader)))) === 'AI_PAUSED')
  check('正常记录·AI 暂停：附加含 AI 解读的报告仍被拦（AI_PAUSED）',
    (await codeOf(() => w.call('appendToResume', reader, () => w.controller.appendToResume(r.taskId, { resumeFileId: 'resume-1' } as never, reader)))) === 'AI_PAUSED')
  check('正常记录·AI 暂停：读回照常', (await codeOf(() => w.call('latest', reader, () => w.controller.latest(r.taskId, reader)))) === 'PASS')

  const nc = makeWorld({ simulate: 'AI_PROVIDER_NOT_CONFIGURED' })
  const ncRes = await nc.call('submit', req, () => nc.controller.submit(BODY as never, req)).catch(() => null) as SubmitResult | null
  if (ncRes) {
    // 把这条记录改成「含 AI 解读」，证明打印闸门看的是文件内容而不是提交时的状态
    const row = nc.rows[0]!
    const payload = JSON.parse(row.payloadJson) as { summary: string | null }
    payload.summary = '整体陈述式解读'
    row.payloadJson = JSON.stringify(payload)
    const ncReader = anonReq({ 'x-resume-access-token': String(ncRes.accessToken) })
    check('未开通：含 AI 解读的记录导出仍被拦（AI_PROVIDER_NOT_CONFIGURED）',
      (await codeOf(() => nc.call('print', ncReader, () => nc.controller.print(ncRes.taskId, ncReader)))) === 'AI_PROVIDER_NOT_CONFIGURED')
  } else check('未开通：提交照常', false, '提交被拦')
}

// ── 三、维护模式照旧拦；撤回照旧不拦 ───────────────────────────────────────
async function maintenance(): Promise<void> {
  const w = makeWorld({ config: { ...OFF, maintenance: true } })
  const req = anonReq()
  check('维护：提交被拦（MAINTENANCE_MODE，设备停办不是 AI 闸门）', (await codeOf(() => w.call('submit', req, () => w.controller.submit(BODY as never, req)))) === 'MAINTENANCE_MODE')
  check('维护：打印被拦', (await codeOf(() => w.call('print', req, async () => null))) === 'MAINTENANCE_MODE')
  check('维护：附加被拦', (await codeOf(() => w.call('appendToResume', req, async () => null))) === 'MAINTENANCE_MODE')
  check('维护：撤回不拦（删除本人数据）', (await codeOf(() => w.call('withdraw', req, async () => null))) === 'PASS')
  check('维护：读回不拦', (await codeOf(() => w.call('latest', req, async () => null))) === 'PASS')
}

// ── 四、模型本身调不通（旧降级路径）也给原因码；旧记录读回可推断 ─────────────────
async function llmFailureAndLegacy(): Promise<void> {
  const w = makeWorld({ realLlmUnconfigured: true })
  const req = anonReq()
  const r = await w.call('submit', req, () => w.controller.submit(BODY as never, req)) as SubmitResult
  check('模型未配置：闸门放行、调到解读服务一次', w.llmCalls() === 1)
  check('模型未配置：打分照常、解读缺席、原因码 AI_NOT_CONFIGURED',
    r.dimensions.length === 5 && r.dimensions.every((d) => d.note === null) && r.interpretationAvailable === false && r.aiUnavailableReason === 'AI_NOT_CONFIGURED',
    `实际 ${String(r.interpretationAvailable)} / ${String(r.aiUnavailableReason)}`)

  // 旧记录（改动前落的库，没有 aiUnavailableReason 字段）
  const row = w.rows[0]!
  const payload = JSON.parse(row.payloadJson) as Record<string, unknown>
  delete payload['aiUnavailableReason']
  row.payloadJson = JSON.stringify(payload)
  const reader = anonReq({ 'x-resume-access-token': String(r.accessToken) })
  const legacy = await w.controller.latest(r.taskId, reader) as SubmitResult
  check('旧记录无解读：读回 interpretationAvailable=false 且原因码非空（AI_INTERPRETATION_UNAVAILABLE）',
    legacy.interpretationAvailable === false && legacy.aiUnavailableReason === 'AI_INTERPRETATION_UNAVAILABLE', `实际 ${String(legacy.aiUnavailableReason)}`)
  payload['summary'] = '旧的整体解读'
  row.payloadJson = JSON.stringify(payload)
  const legacyAi = await w.controller.latest(r.taskId, reader) as SubmitResult
  check('旧记录有解读：读回 interpretationAvailable=true、原因码 null', legacyAi.interpretationAvailable === true && legacyAi.aiUnavailableReason === null)
}

// ── 五、装配：AiModule 能注入 AiAccessService ─────────────────────────────────
function wiring(): void {
  const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, AiModule) ?? []) as unknown[]
  check('装配：AiModule 导入 AiAccessModule（控制器要注入 AiAccessService）', imports.includes(AiAccessModule))
  const params = (Reflect.getMetadata('design:paramtypes', SelfAssessmentController) ?? []) as unknown[]
  check('装配：SelfAssessmentController 注入 AiAccessService', params.includes(AiAccessService))
}

void (async () => {
  try {
    await gateStates()
    await normalState()
    await maintenance()
    await llmFailureAndLegacy()
    wiring()
  } catch (error) {
    failed += 1
    console.error(`  FAIL runtime —— ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  }
  console.log(`\nverify:self-assessment-ai-gate：${passed} PASS，${failed} FAIL`)
  process.exit(failed === 0 ? 0 : 1)
})()
