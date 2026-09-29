/**
 * verify:resume-export-draft-source — 简历「按原样导出」的正文来源（#1105 追加，总指挥 9/29 裁定 A+B）
 *
 * 背景：按原样导出（POST /resume/generate/export，draft=true）不查简历 AI 授权、不被 AI 闸门挡，
 * 产物不带 AI 标识、元数据写「非 AI」。如果 draft 标记完全信任客户端，客户端就能把本系统生成的
 * AI 内容谎报成草稿，拿到一份不带标识的 AI 简历（《人工智能生成合成内容标识办法》显式 / 隐式标识）。
 *
 * 本门禁全部走真实 HTTP（整套 AppModule + 真库 + 真 Redis），只把 mock 模型换成一个
 * 「真的会改写文字」的桩——现成 mock 只在句尾补句号，规范化后与原文相同，测不出任何东西。
 *
 *   A  带 taskId：导出的必须是生成时留存的原始填写，客户端传来的正文一个字都不用；
 *      取不到（不是本人 / 不存在）拒绝，带下一步。
 *   B  不带 taskId：正文里任何一段与比对范围内的 AI 结果逐字相同（或规范化后相同）→ 409 + 下一步；
 *      会员比本人结果，匿名比本台一体机本次使用（没有使用记录退到本台，不在一体机上退到全部）。
 *   短句（规范化后不足 20 个汉字当量）不比，真手填、AI 原样照抄用户原话的段落照常导出。
 *
 * 用独立 SQLite 库与私有 Redis 库号（由环境变量给），不触网。
 * 运行：pnpm --filter @ai-job-print/api verify:resume-export-draft-source
 */
import 'reflect-metadata'
import { randomBytes } from 'crypto'
import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { ThrottlerStorage } from '@nestjs/throttler'

process.env['FILE_STORAGE_DRIVER'] = 'local'
process.env['AI_PROVIDER'] = 'mock'
if (!process.env['FILE_SIGNING_SECRET'] || process.env['FILE_SIGNING_SECRET'].length < 32) {
  process.env['FILE_SIGNING_SECRET'] = 'verify-resume-draft-source-signing-secret-32'
}

import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { installBodyParsers } from '../src/config/body-parsers'
import { memberSessionKey } from '../src/common/guards/end-user-auth.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { FilesService } from '../src/files/files.service'
import { MockAiProvider } from '../src/ai/providers/mock.provider'
import { MemberAssetsService } from '../src/member-assets/member-assets.service'
import { CURRENT_RESUME_AI_CONSENT_VERSION } from '../src/member-privacy/member-privacy.service'
import type { GenerateResumeOutput, ResumeGenerateInput } from '../src/ai/interfaces/ai-provider.interface'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

let failed = 0
function check(id: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`  PASS ${id}`)
  else { failed += 1; console.error(`  FAIL ${id}${detail ? ` —— ${detail}` : ''}`) }
}

// ── 桩模型产出的「AI 文字」：与用户原话明显不同，长度都在 20 个汉字当量以上 ──
const AI_SUMMARY = '具备扎实的前端工程基础，能够独立完成组件设计与性能优化，善于跨团队沟通协作并推动项目落地。'
const AI_EXP = '主导公司官网前端重构，沉淀可复用的 React 组件库，线上缺陷率下降 40%。'
/** 规范化后与 AI_EXP 相同：全角字母数字、换了标点、插了空格。 */
const AI_EXP_NORMALIZED_VARIANT = '主导 公司官网 前端重构 沉淀可复用的ＲＥＡＣＴ组件库——线上缺陷率下降４０％'
/** 短句：规范化后不足 20 个汉字当量，不比（防误伤「熟练使用 Office」这类常见短句）。 */
const AI_SHORT = '熟练使用 Office 办公软件'
/** 用户原话，桩模型原样照抄（真实模型在合规拦截或无可润色时也会这样）。 */
const OWN_PROJECT = '独立完成校园二手交易平台的前后端开发并上线运行三个月'

function inputFor(name: string): ResumeGenerateInput {
  return {
    basic: { name, city: '青岛' },
    intention: { position: '前端开发工程师' },
    education: [{ school: '青岛验证大学', major: '计算机', degree: '本科', period: '2021-2025' }],
    experience: [{ company: '验证科技公司', role: '前端实习生', period: '2024.07-2024.12', description: '参与公司官网的前端开发工作，维护内部组件库并修复线上缺陷问题' }],
    projects: [{ name: '校园二手平台', role: '负责人', description: OWN_PROJECT }],
    skills: ['JavaScript'],
    certificates: [],
    selfIntro: '我喜欢写代码',
  }
}

/** 客户端导出体：以原始填写为底，按需覆盖若干栏目。 */
function exportBody(input: ResumeGenerateInput, patch: { name?: string; summary?: string; expDesc?: string; eduDesc?: string } = {}) {
  return {
    basic: { ...input.basic, ...(patch.name ? { name: patch.name } : {}) },
    intention: input.intention,
    summary: patch.summary ?? input.selfIntro ?? '',
    education: input.education.map((e) => ({ ...e, ...(patch.eduDesc ? { description: patch.eduDesc } : {}) })),
    experience: input.experience.map((e) => ({ ...e, ...(patch.expDesc ? { description: patch.expDesc } : {}) })),
    projects: input.projects,
    skills: input.skills,
    certificates: input.certificates,
    format: 'txt',
    draft: true,
  }
}

interface Res { status: number; body: { fileId?: string; taskId?: string; accessToken?: string; error?: { code?: string; message?: string; details?: string[]; nextAction?: string } } }

void (async () => {
  assertIsolatedVerificationDatabase() // 本门禁写库（会员、一体机、AI 结果），只许打到测试库
  const { AppModule } = await import('../src/app.module')
  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false })
  installBodyParsers(app as never)
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: () => new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: '请求参数校验失败' } }),
  }))
  app.useGlobalFilters(new HttpExceptionFilter())
  // 本门禁一口气发十几次导出；限流另有门禁（verify:ai-throttle-dimension），这里放开计数。
  const throttler = app.get(ThrottlerStorage as unknown as string) as { increment: (...args: unknown[]) => Promise<unknown> }
  throttler.increment = async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 })
  // 换成会改写文字的桩：summary / 工作经历描述 / 教育描述换成 AI 文字，项目描述原样照抄。
  const mock = app.get(MockAiProvider)
  mock.generateResume = async (input: ResumeGenerateInput): Promise<GenerateResumeOutput> => ({
    taskId: `gen-verify-${randomBytes(6).toString('hex')}`,
    status: 'completed',
    resume: {
      basic: { ...input.basic },
      intention: { ...input.intention },
      summary: AI_SUMMARY,
      education: input.education.map((e) => ({ ...e, description: AI_SHORT })),
      experience: input.experience.map((e) => ({ ...e, description: AI_EXP })),
      projects: input.projects.map((p) => ({ ...p })),
      skills: [...input.skills],
      certificates: [...input.certificates],
    },
  })
  await app.listen(0, '127.0.0.1')
  const address = app.getHttpServer().address()
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/v1`
  const prisma = app.get(PrismaService)
  const redis = app.get(RedisService)
  const jwt = app.get(JwtService)
  const files = app.get(FilesService)

  const suffix = randomBytes(4).toString('hex')
  const post = async (path: string, body: unknown, headers: Record<string, string> = {}): Promise<Res> => {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Res['body'] }
  }
  const member = async (tag: string) => {
    const user = await prisma.endUser.create({ data: { phoneHash: `draft-src-${tag}-${suffix}`, phoneEnc: `enc-${tag}-${suffix}` } })
    await prisma.userAiConsent.create({ data: { endUserId: user.id, scope: 'resume_ai', consentVersion: CURRENT_RESUME_AI_CONSENT_VERSION } })
    const jti = `draft-src-${tag}-${suffix}`
    await redis.setEx(memberSessionKey(jti), 1800, user.id)
    return { id: user.id, headers: { authorization: `Bearer ${jwt.sign({ sub: user.id, jti }, { audience: 'enduser' })}` } }
  }
  /** 已验签的一体机：Terminal 行 + Redis 终端会话票 + 一条进行中的使用记录。 */
  const kiosk = async (tag: string) => {
    const id = `T-draft-${tag}-${suffix}`
    await prisma.terminal.create({ data: { id, terminalCode: id, agentToken: `agent-${id}`, deviceFingerprint: `fp-${id}` } })
    const token = `ts-${tag}-${randomBytes(8).toString('hex')}`
    await redis.setEx(`term:session:${token}`, 1800, JSON.stringify({ terminalId: id, generation: 0, issuedAt: new Date().toISOString() }))
    const session = await prisma.kioskSession.create({ data: { terminalId: id, clientSessionId: `cs-${tag}-${suffix}`, expiresAt: new Date(Date.now() + 30 * 60_000) } })
    return { id, sessionId: session.id, headers: { 'x-terminal-id': id, 'x-terminal-session-token': token } }
  }
  const textOf = async (fileId: string | undefined) => fileId ? (await files.readContent(fileId)).buffer.toString('utf8') : ''
  const rejected = (res: Res, code: string) => res.status === 409 && res.body.error?.code === code

  try {
    const alice = await member('alice')
    const bob = await member('bob')
    const aliceInput = inputFor(`原始填写甲${suffix}`)
    const gen = await post('/resume/generate', aliceInput, alice.headers)
    check('准备：会员生成成功并拿到任务号', gen.status === 201 && typeof gen.body.taskId === 'string', `status=${gen.status} code=${gen.body.error?.code}`)
    const taskId = gen.body.taskId ?? 'missing'

    // ── A：带任务号时一律用生成时留存的原始填写 ──
    const clientName = `客户端乙${suffix}`
    const a = await post('/resume/generate/export', { ...exportBody(aliceInput, { name: clientName, summary: AI_SUMMARY, expDesc: AI_EXP }), taskId }, alice.headers)
    const aText = await textOf(a.body.fileId)
    check('A：带任务号按原样导出成功', a.status === 201, `status=${a.status} code=${a.body.error?.code}`)
    check('A：导出内容是生成时留存的原始填写（姓名、工作经历原话都在）',
      aText.includes(aliceInput.basic.name) && aText.includes(aliceInput.experience[0]!.description), `text=${aText.slice(0, 120)}`)
    check('A：客户端传来的正文一个字都没用上（客户端姓名、AI 润色段都不在文件里）',
      !aText.includes(clientName) && !aText.includes(AI_SUMMARY.slice(0, 12)) && !aText.includes('沉淀可复用'), `text=${aText.slice(0, 120)}`)
    const aOther = await post('/resume/generate/export', { ...exportBody(aliceInput, { summary: AI_SUMMARY }), taskId }, bob.headers)
    check('A：别人的任务号取不到原始填写 → 拒绝，带下一步',
      aOther.status === 404 && aOther.body.error?.code === 'RESUME_DRAFT_SOURCE_NOT_FOUND' && aOther.body.error?.nextAction === 'export_draft_from_form',
      `status=${aOther.status} code=${aOther.body.error?.code} next=${aOther.body.error?.nextAction}`)
    const aMissing = await post('/resume/generate/export', { ...exportBody(aliceInput), taskId: `gen-does-not-exist-${suffix}` }, alice.headers)
    check('A：不存在的任务号 → 拒绝', aMissing.status === 404 && aMissing.body.error?.code === 'RESUME_DRAFT_SOURCE_NOT_FOUND', `status=${aMissing.status} code=${aMissing.body.error?.code}`)
    const rowsOf = (id: string) => prisma.aiResumeResult.findMany({ where: { taskId: id }, select: { kind: true, endUserId: true, expiresAt: true, terminalId: true } })
    const aliceRows = await rowsOf(taskId)
    const aliceGen = aliceRows.find((r) => r.kind === 'generate')
    const aliceIn = aliceRows.find((r) => r.kind === 'generate_input')
    check('留存：原始填写与生成结果同一条留存（同归属、同到期时间，不单独延长）',
      Boolean(aliceGen && aliceIn && aliceIn.endUserId === alice.id && aliceGen.expiresAt?.getTime() === aliceIn.expiresAt?.getTime()),
      JSON.stringify(aliceRows))

    // ── B：不带任务号，会员比本人近期 AI 结果 ──
    const bVerbatim = await post('/resume/generate/export', exportBody(aliceInput, { summary: AI_SUMMARY }), alice.headers)
    check('B 会员：个人简介逐字等于本人 AI 结果 → 409', rejected(bVerbatim, 'RESUME_DRAFT_CONTAINS_AI_OUTPUT'), `status=${bVerbatim.status} code=${bVerbatim.body.error?.code}`)
    check('B 会员：409 带前端可用的下一步标识（导出 AI 版）', bVerbatim.body.error?.nextAction === 'export_ai_labeled', `next=${bVerbatim.body.error?.nextAction}`)
    check('B 会员：409 说人话并指出是哪一栏', (bVerbatim.body.error?.message ?? '').includes('AI 润色过的段落') && (bVerbatim.body.error?.details ?? []).includes('个人简介'),
      `message=${bVerbatim.body.error?.message} details=${JSON.stringify(bVerbatim.body.error?.details)}`)
    const bNorm = await post('/resume/generate/export', exportBody(aliceInput, { expDesc: AI_EXP_NORMALIZED_VARIANT }), alice.headers)
    check('B 会员：规范化后相同（全角、换标点、加空格）→ 409', rejected(bNorm, 'RESUME_DRAFT_CONTAINS_AI_OUTPUT'), `status=${bNorm.status} code=${bNorm.body.error?.code}`)
    const bShort = await post('/resume/generate/export', exportBody(aliceInput, { eduDesc: AI_SHORT }), alice.headers)
    check('短句不误伤：与 AI 结果相同的短句（不足 20 个汉字当量）照常导出', bShort.status === 201, `status=${bShort.status} code=${bShort.body.error?.code}`)
    const bOwn = await post('/resume/generate/export', exportBody(aliceInput), alice.headers)
    check('本人原话不误伤：AI 原样照抄的用户原话段落，按原样导出照常成功', bOwn.status === 201, `status=${bOwn.status} code=${bOwn.body.error?.code}`)
    const bobInput = inputFor(`手填丙${suffix}`)
    const bobHand = await post('/resume/generate/export', exportBody(bobInput, { summary: '本人从事前端开发两年，负责过公司多个业务系统的界面开发与维护工作' }), bob.headers)
    check('真手填（会员，无任务号、没有任何 AI 历史）照常导出', bobHand.status === 201, `status=${bobHand.status} code=${bobHand.body.error?.code}`)

    // ── B：匿名在一体机上，比本台本次使用里生成过的 AI 结果 ──
    const k1 = await kiosk('k1')
    const anonInput = inputFor(`匿名丁${suffix}`)
    const anonGen = await post('/resume/generate', anonInput, k1.headers)
    check('准备：匿名在一体机上生成成功', anonGen.status === 201, `status=${anonGen.status} code=${anonGen.body.error?.code}`)
    const anonTask = anonGen.body.taskId ?? 'missing'
    const anonRows = await rowsOf(anonTask)
    check('留存：匿名结果与原始填写都记下已验签的一体机编号', anonRows.length === 2 && anonRows.every((r) => r.terminalId === k1.id && r.endUserId === null), JSON.stringify(anonRows))
    const anonA = await post('/resume/generate/export', { ...exportBody(anonInput, { summary: AI_SUMMARY }), taskId: anonTask }, { ...k1.headers, 'x-resume-access-token': anonGen.body.accessToken ?? '' })
    const anonAText = await textOf(anonA.body.fileId)
    check('A 匿名：凭一次性令牌带任务号导出，内容是留存的原始填写', anonA.status === 201 && anonAText.includes(anonInput.basic.name) && !anonAText.includes(AI_SUMMARY.slice(0, 12)), `status=${anonA.status} code=${anonA.body.error?.code}`)
    const anonANoToken = await post('/resume/generate/export', { ...exportBody(anonInput), taskId: anonTask }, k1.headers)
    check('A 匿名：不带令牌取不到原始填写 → 拒绝', anonANoToken.status === 404 && anonANoToken.body.error?.code === 'RESUME_DRAFT_SOURCE_NOT_FOUND', `status=${anonANoToken.status} code=${anonANoToken.body.error?.code}`)
    const anonVerbatim = await post('/resume/generate/export', exportBody(anonInput, { expDesc: AI_EXP }), k1.headers)
    check('B 匿名：工作经历逐字等于本次使用里生成的 AI 结果 → 409', rejected(anonVerbatim, 'RESUME_DRAFT_CONTAINS_AI_OUTPUT'), `status=${anonVerbatim.status} code=${anonVerbatim.body.error?.code}`)
    const anonNorm = await post('/resume/generate/export', exportBody(anonInput, { summary: AI_SUMMARY.replace(/，/g, ',').replace(/。/g, '') }), k1.headers)
    check('B 匿名：规范化后相同 → 409', rejected(anonNorm, 'RESUME_DRAFT_CONTAINS_AI_OUTPUT'), `status=${anonNorm.status} code=${anonNorm.body.error?.code}`)
    const anonNoHeaders = await post('/resume/generate/export', exportBody(anonInput, { expDesc: AI_EXP }), {})
    check('B 匿名：不带一体机身份时比对范围放到最宽，照样 409', rejected(anonNoHeaders, 'RESUME_DRAFT_CONTAINS_AI_OUTPUT'), `status=${anonNoHeaders.status} code=${anonNoHeaders.body.error?.code}`)
    const forged = await post('/resume/generate/export', exportBody(anonInput, { expDesc: AI_EXP }), { 'x-terminal-id': k1.id, 'x-terminal-session-token': 'forged' })
    check('B 匿名：伪造终端票不算已验签，照样 409', rejected(forged, 'RESUME_DRAFT_CONTAINS_AI_OUTPUT'), `status=${forged.status} code=${forged.body.error?.code}`)

    // 下一位使用者：上一段使用结束、新的使用开始，上一位的 AI 结果不在比对范围里。
    await prisma.kioskSession.update({ where: { id: k1.sessionId }, data: { endedAt: new Date(), endReason: 'user_exit' } })
    await new Promise((r) => setTimeout(r, 20))
    await prisma.kioskSession.create({ data: { terminalId: k1.id, clientSessionId: `cs-k1b-${suffix}`, expiresAt: new Date(Date.now() + 30 * 60_000) } })
    const nextPerson = await post('/resume/generate/export', exportBody(inputFor(`下一位${suffix}`), { expDesc: AI_EXP }), k1.headers)
    check('B 匿名：比对范围是本次使用——下一位使用者不被上一位的 AI 结果挡住', nextPerson.status === 201, `status=${nextPerson.status} code=${nextPerson.body.error?.code}`)

    const k2 = await kiosk('k2')
    const hand = await post('/resume/generate/export', exportBody(inputFor(`手填戊${suffix}`), { summary: '在社区超市做过两年收银员，熟悉日常盘点与顾客接待工作流程' }), k2.headers)
    check('真手填（匿名，无任务号、这台一体机这次使用没有任何 AI 历史）照常导出', hand.status === 201, `status=${hand.status} code=${hand.body.error?.code}`)

    // ── 本人管理：原始填写不进「AI 服务记录」，删生成记录时一并删掉 ──
    const assets = app.get(MemberAssetsService)
    const records = await assets.listAiRecords(alice.id, { cursor: null, pageSize: 50 })
    check('本人管理：原始填写不在「AI 服务记录」里单独成行', records.items.filter((r) => r.taskId === taskId).length === 1, JSON.stringify(records.items.map((r) => [r.taskId, r.kind])))
    const genRow = await prisma.aiResumeResult.findUniqueOrThrow({ where: { taskId_kind: { taskId, kind: 'generate' } }, select: { id: true } })
    await assets.deleteAiRecord(alice.id, genRow.id)
    check('本人管理：删除生成记录时原始填写一并删除', (await rowsOf(taskId)).length === 0, JSON.stringify(await rowsOf(taskId)))
  } catch (error) {
    failed += 1
    console.error(`  FAIL runtime —— ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  } finally {
    await app.close()
  }
  console.log(failed === 0 ? '\nverify:resume-export-draft-source：ALL PASS' : `\nverify:resume-export-draft-source：${failed} FAIL`)
  process.exit(failed === 0 ? 0 : 1)
})()
