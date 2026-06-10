/**
 * 阶段2B — AI 简历优化真实化验证。
 *
 * 覆盖(对应需求验收点):
 *   1.  全链路:上传文本提取(受控桩) → 诊断(parse) → 优化(optimize) → 结构化优化版简历 + 新旧对比。
 *   2.  防编造(事实串):优化版中的学校/公司/证书必须出现在简历原文;LLM 返回原文不存在的
 *       学校 → 判非法重试,两次仍坏 → 诚实失败,且**失败不缓存**(下次可重试成功)。
 *   3.  防编造(对比稻草人):modules.before 不在原文 → 该条丢弃;在原文 → 保留。
 *   4.  承诺类拦截:after/描述命中"保录用"类词 → 判非法重试,第二次干净输出成功(2 次调用)。
 *   5.  联系方式防篡改:LLM 改写电话号码(原文不存在) → 该字段置空,不出错号简历。
 *   6.  归属门禁:优化行继承 parse 行 hash;正确 token 可读缓存,错 token → AI_TASK_NOT_FOUND。
 *   7.  缓存:成功结果落库(kind='optimize'),再读不再调 LLM。
 *   8.  原文清理后:提取失败 → 诚实失败(引导重新上传),不缓存。
 *   9.  未配置 → 诚实失败文案(不 fallback mock)。
 *   10. 优化版导出 PDF:真实 %PDF + FileObject(resume_upload,短 TTL)。
 *
 * 运行:pnpm --filter @ai-job-print/api verify:resume-optimize
 */
import 'dotenv/config'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { randomUUID } from 'crypto'
import { Logger } from '@nestjs/common'

if (!process.env['FILE_SIGNING_SECRET'] || process.env['FILE_SIGNING_SECRET'].length < 32) {
  process.env['FILE_SIGNING_SECRET'] = 'verify-resume-optimize-test-secret-0123456789'
}
process.env['FILE_STORAGE_DRIVER'] = 'local'
process.env['AI_PROVIDER'] = 'llm'

import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { StorageService } from '../src/storage/storage.service'
import { FilesService } from '../src/files/files.service'
import { AiService } from '../src/ai/ai.service'
import { LlmResumeProvider } from '../src/ai/providers/llm.provider'
import { LlmResumeService } from '../src/ai/resume/llm-resume.service'
import { LlmResumeGenerateService } from '../src/ai/resume/llm-resume-generate.service'
import { LlmResumeOptimizeService } from '../src/ai/resume/llm-resume-optimize.service'
import { ResumePdfService } from '../src/ai/resume/resume-pdf.service'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exitCode = 1; throw new Error(m) }

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}

const jw = (...parts: string[]) => parts.join('')

// 受控简历原文(提取桩返回):事实串都在这里
const RESUME_TEXT = [
  '姓名 王验证  电话 13800000000  邮箱 test@example.com',
  '求职意向 前端开发工程师',
  '教育经历 验证大学 计算机科学与技术 本科 2021-2025',
  '工作经历 验证科技公司 前端实习生 2024.07-2024.12 参与官网开发 维护组件库 首屏加载时间从4秒降到1.8秒',
  '技能 JavaScript React',
  '证书 英语六级',
].join('\n')

// LLM 桩
type StubResponse = { status: number; content?: string }
let responseQueue: StubResponse[] = []
let llmCallCount = 0
const setResponses = (arr: StubResponse[]) => { responseQueue = arr.slice(); llmCallCount = 0 }

function validDiagnosis(): string {
  return JSON.stringify({
    sections: [
      { key: 'basic', label: '基础信息完整度', score: 8, maxScore: 10 },
      { key: 'objective', label: '求职目标清晰度', score: 6, maxScore: 10 },
      { key: 'experience', label: '经历表达清晰度', score: 6, maxScore: 10 },
      { key: 'quantification', label: '成果量化程度', score: 5, maxScore: 10 },
      { key: 'keyword', label: '岗位关键词覆盖', score: 5, maxScore: 10 },
      { key: 'readability', label: '版式与可读性', score: 7, maxScore: 10 },
    ],
    suggestions: ['经历描述建议动词开头并量化成果'],
  })
}

function validOptimize(mut?: (o: Record<string, unknown>) => void): string {
  const o: Record<string, unknown> = {
    resume: {
      basic: { name: '王验证', phone: '13800000000', email: 'test@example.com', city: '' },
      intention: { position: '前端开发工程师', city: '' },
      summary: '具备前端开发实习经验,熟悉 React 组件化开发,注重性能优化。',
      education: [{ school: '验证大学', major: '计算机科学与技术', degree: '本科', period: '2021-2025', description: '主修计算机核心课程。' }],
      experience: [{ company: '验证科技公司', role: '前端实习生', period: '2024.07-2024.12', description: '负责官网改版前端开发与组件库维护,将首屏加载时间从4秒优化至1.8秒。' }],
      projects: [],
      skills: ['JavaScript', 'React'],
      certificates: ['英语六级'],
    },
    modules: [
      { title: '经历表达优化', before: '参与官网开发 维护组件库', after: '负责官网改版前端开发,持续维护组件库并优化首屏性能。' },
    ],
  }
  if (mut) mut(o)
  return JSON.stringify(o)
}

async function main(): Promise<void> {
  console.log('\n=== 阶段2B AI 简历优化真实化验证 ===')

  Logger.overrideLogger({ log: () => {}, error: () => {}, warn: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {} })

  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      llmCallCount++
      const next = responseQueue.shift() ?? { status: 200, content: validOptimize() }
      res.statusCode = next.status
      res.setHeader('Content-Type', 'application/json')
      res.end(next.status === 200 ? JSON.stringify({ choices: [{ message: { content: next.content } }] }) : '{"error":"stub"}')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`

  const cfgBase = {
    vendor: 'deepseek', model: 'stub', baseURL, systemPrompt: '', roleScope: '',
    forbiddenWords: [] as string[], temperature: 0.3, enabled: true,
  }
  const onFeatures = (features: string[]) => ({
    getApiKey: (f?: string) => (features.includes(f ?? '') ? 'stub-key' : null),
    getConfig: (f?: string) => ({ ...cfgBase, enabled: features.includes(f ?? '') }),
    isReady: (f?: string) => features.includes(f ?? ''),
  })
  const bothCfg = onFeatures(['resume_diagnosis', 'resume_optimize'])
  const diagOnlyCfg = onFeatures(['resume_diagnosis'])

  const makeProvider = (cfg: unknown) =>
    new LlmResumeProvider(
      new LlmResumeService(cfg as never),
      new LlmResumeGenerateService(cfg as never),
      new LlmResumeOptimizeService(cfg as never),
    )

  // 提取桩:默认成功返回受控原文;可按 fileId 注入失败
  const extractionByFileId = new Map<string, unknown>()
  const fakeExtraction = {
    extractResumeText: async ({ fileId }: { fileId: string }) =>
      extractionByFileId.get(fileId) ?? {
        ok: true, fileId, text: RESUME_TEXT, textSource: 'docx', confidence: 'high', charCount: RESUME_TEXT.length,
      },
  }

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const storage = new StorageService()
  const audit = new AuditService(prisma)
  const files = new FilesService(prisma, audit, storage)
  const pdf = new ResumePdfService()
  const emptyStub = {} as never
  const logStub = { record: () => {} } as never

  const build = (cfg: unknown) =>
    new AiService(
      emptyStub, emptyStub, emptyStub, emptyStub, emptyStub, emptyStub,
      makeProvider(cfg) as never, // llmResumeProvider（AI_PROVIDER=llm → this.provider）
      logStub,
      emptyStub, // llmConfig
      emptyStub, // llmChat
      fakeExtraction as never, // resumeExtraction
      pdf,
      files,
      prisma,
      audit as never,
    )
  const ai = build(bothCfg)
  const aiOptimizeOff = build(diagOnlyCfg)

  const createdTaskIds: string[] = []
  const createdFileIds: string[] = []
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8)

  const submitParse = async (svc: AiService, fileId: string) => {
    setResponses([{ status: 200, content: validDiagnosis() }])
    const out = await svc.submitResumeParse({ fileId, fileName: 'r.docx', fileFormat: 'docx', source: 'upload' } as never, null)
    createdTaskIds.push(out.taskId)
    if (out.status !== 'completed' || !out.accessToken) fail(`parse 失败: ${out.failReason}`)
    return { taskId: out.taskId, accessToken: out.accessToken }
  }

  try {
    // ── 1+2+6+7. 全链路 + 事实串保留 + 门禁 + 缓存 ───────────────────────
    {
      const { taskId, accessToken } = await submitParse(ai, `file_opt_a_${suffix}`)
      const parseRow = await prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId, kind: 'parse' } } })
      if (!parseRow || !parseRow.payloadJson.includes(`file_opt_a_${suffix}`)) fail('1. parse 行未落 fileId(优化重提原文依赖)')
      pass('1a. 上传→提取→诊断落库,parse 行含 fileId')

      setResponses([{ status: 200, content: validOptimize() }])
      const opt = await ai.getResumeOptimize(taskId, { endUserId: null, accessToken })
      if (opt.status !== 'completed' || !opt.optimizedResume) fail(`1. 优化失败: ${opt.failReason}`)
      if (opt.providerName !== 'llm') fail('1. providerName 应为 llm')
      const r = opt.optimizedResume
      if (r.education[0]?.school !== '验证大学' || r.experience[0]?.company !== '验证科技公司' || r.certificates[0] !== '英语六级') {
        fail('2. 事实串与原文不一致')
      }
      if (!r.experience[0].description.includes('1.8秒')) fail('2. 原文数字未保留')
      if ((opt.modules ?? []).length < 1) fail('1. 对比模块缺失')
      pass('1b+2a. 优化完成:学校/公司/证书与原文一致,数字保留,对比模块输出')

      const optRow = await prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId, kind: 'optimize' } } })
      if (!optRow || optRow.accessTokenHash !== parseRow.accessTokenHash) fail('6. optimize 行未继承 parse 行 hash')
      pass('6a. optimize 行落库且继承 parse 行 accessTokenHash')

      // 缓存:再读不调 LLM
      setResponses([])
      llmCallCount = 0
      const again = await ai.getResumeOptimize(taskId, { endUserId: null, accessToken })
      if (again.status !== 'completed' || llmCallCount !== 0) fail('7. 成功结果应走缓存,不再调 LLM')
      pass('7. 成功结果缓存,再次读取不调 LLM')

      try {
        await ai.getResumeOptimize(taskId, { endUserId: null, accessToken: 'wrong-token' })
        fail('6. 错 token 应拒绝')
      } catch (e) {
        if (errCode(e) !== 'AI_TASK_NOT_FOUND') fail(`6. 期望 AI_TASK_NOT_FOUND,实际 ${errCode(e)}`)
      }
      pass('6b. 错 token → AI_TASK_NOT_FOUND')
    }

    // ── 2b. 编造学校 → 重试仍坏 → 诚实失败,且失败不缓存 ───────────────────
    {
      const { taskId, accessToken } = await submitParse(ai, `file_opt_b_${suffix}`)
      const fabricated = validOptimize((o) => {
        const resume = o['resume'] as Record<string, unknown>
        resume['education'] = [{ school: '编造大学', major: '', degree: '', period: '', description: '' }]
      })
      setResponses([{ status: 200, content: fabricated }, { status: 200, content: fabricated }])
      const bad = await ai.getResumeOptimize(taskId, { endUserId: null, accessToken })
      if (bad.status !== 'failed') fail('2b. 编造学校应失败')
      if (llmCallCount !== 2) fail(`2b. 应重试一次(2 次调用),实际 ${llmCallCount}`)
      const cached = await prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId, kind: 'optimize' } } })
      if (cached) fail('2b. 失败结果不应缓存')
      pass('2b. LLM 编造学校 → 重试仍坏 → 诚实失败,失败不落库')

      // 失败后重试可成功(证明无失败缓存)
      setResponses([{ status: 200, content: validOptimize() }])
      const retry = await ai.getResumeOptimize(taskId, { endUserId: null, accessToken })
      if (retry.status !== 'completed') fail('2b. 失败后重试应可成功')
      pass('2c. 失败后再次请求成功(无失败缓存粘滞)')
    }

    // ── 3. 稻草人对比 before 不在原文 → 丢弃 ─────────────────────────────
    {
      const { taskId, accessToken } = await submitParse(ai, `file_opt_c_${suffix}`)
      const strawman = validOptimize((o) => {
        o['modules'] = [
          { title: '编的对比', before: '我从没写过这句话的原文', after: '看起来提升很大' },
          { title: '真实对比', before: '参与官网开发 维护组件库', after: '负责官网前端开发与组件库维护。' },
        ]
      })
      setResponses([{ status: 200, content: strawman }])
      const opt = await ai.getResumeOptimize(taskId, { endUserId: null, accessToken })
      if (opt.status !== 'completed') fail(`3. 优化失败: ${opt.failReason}`)
      if ((opt.modules ?? []).length !== 1 || opt.modules![0].title !== '真实对比') {
        fail(`3. 稻草人模块未被丢弃: ${JSON.stringify(opt.modules)}`)
      }
      pass('3. before 不在原文的对比模块被丢弃,真实片段保留')
    }

    // ── 4. 承诺类拦截词 → 判非法重试,第二次干净输出成功 ───────────────────
    {
      const { taskId, accessToken } = await submitParse(ai, `file_opt_d_${suffix}`)
      const promising = validOptimize((o) => {
        const resume = o['resume'] as Record<string, unknown>
        resume['summary'] = `优秀候选人,${jw('保', '录用')}没问题`
      })
      setResponses([{ status: 200, content: promising }, { status: 200, content: validOptimize() }])
      const opt = await ai.getResumeOptimize(taskId, { endUserId: null, accessToken })
      if (opt.status !== 'completed') fail(`4. 第二次干净输出应成功: ${opt.failReason}`)
      if (llmCallCount !== 2) fail(`4. 应重试一次(2 次调用),实际 ${llmCallCount}`)
      if (opt.optimizedResume!.summary.includes(jw('保', '录用'))) fail('4. 承诺词进入简历')
      pass('4. 承诺类表述 → 判非法重试,干净输出成功,简历无承诺词')
    }

    // ── 5. 电话被篡改(原文不存在) → 置空 ──────────────────────────────────
    {
      const { taskId, accessToken } = await submitParse(ai, `file_opt_e_${suffix}`)
      const tampered = validOptimize((o) => {
        const resume = o['resume'] as Record<string, unknown>
        ;(resume['basic'] as Record<string, unknown>)['phone'] = '13900009999'
      })
      setResponses([{ status: 200, content: tampered }])
      const opt = await ai.getResumeOptimize(taskId, { endUserId: null, accessToken })
      if (opt.status !== 'completed') fail(`5. 优化失败: ${opt.failReason}`)
      if (opt.optimizedResume!.basic.phone) fail(`5. 篡改电话应置空,实际 ${opt.optimizedResume!.basic.phone}`)
      pass('5. LLM 篡改电话号码 → 字段置空,不输出错号简历')
    }

    // ── 8. 原文已清理 → 诚实失败,不缓存 ──────────────────────────────────
    {
      const fileId = `file_opt_f_${suffix}`
      const { taskId, accessToken } = await submitParse(ai, fileId)
      extractionByFileId.set(fileId, { ok: false, fileId, errorCode: 'FILE_NOT_FOUND', errorMessage: '文件不存在' })
      const opt = await ai.getResumeOptimize(taskId, { endUserId: null, accessToken })
      if (opt.status !== 'failed' || !(opt.failReason ?? '').includes('重新上传')) {
        fail(`8. 应诚实失败并引导重新上传: ${opt.failReason}`)
      }
      const cached = await prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId, kind: 'optimize' } } })
      if (cached) fail('8. 提取失败不应缓存')
      pass('8. 原文已清理 → 诚实失败(引导重新上传),不缓存')
    }

    // ── 9. 未配置 resume_optimize → 诚实失败 ─────────────────────────────
    {
      const { taskId, accessToken } = await submitParse(aiOptimizeOff, `file_opt_g_${suffix}`)
      setResponses([])
      const opt = await aiOptimizeOff.getResumeOptimize(taskId, { endUserId: null, accessToken })
      if (opt.status !== 'failed' || !(opt.failReason ?? '').includes('尚未配置')) {
        fail(`9. 未配置应诚实失败: ${opt.failReason}`)
      }
      pass('9. 未配置 → 诚实失败(不 fallback mock)')
    }

    // ── 10. 优化版导出 PDF(真实文件链路) ─────────────────────────────────
    {
      setResponses([{ status: 200, content: validOptimize() }])
      const { taskId, accessToken } = await submitParse(ai, `file_opt_h_${suffix}`)
      setResponses([{ status: 200, content: validOptimize() }])
      const opt = await ai.getResumeOptimize(taskId, { endUserId: null, accessToken })
      const exported = await ai.exportGeneratedResume(opt.optimizedResume!, null)
      createdFileIds.push(exported.fileId)
      const fileRow = await prisma.fileObject.findUnique({ where: { id: exported.fileId } })
      if (!fileRow || fileRow.purpose !== 'resume_upload') fail('10. FileObject 异常')
      const buf = await storage.getObject(fileRow.storageKey)
      if (!buf.subarray(0, 4).equals(Buffer.from('%PDF', 'latin1'))) fail('10. 产物不是 PDF')
      if (exported.filename.includes('13800000000')) fail('10. 文件名泄露手机号')
      pass(`10. 优化版导出真实 PDF(${exported.pageCount} 页,${Math.round(buf.length / 1024)}KB),FileObject 短 TTL,文件名无手机号`)
    }

    console.log('\n=== ALL PASS ===')
  } finally {
    for (const fid of createdFileIds) {
      const row = await prisma.fileObject.findUnique({ where: { id: fid } })
      if (row) {
        await storage.deleteObject(row.storageKey).catch(() => undefined)
        await prisma.fileObject.delete({ where: { id: fid } }).catch(() => undefined)
      }
    }
    await prisma.aiResumeResult.deleteMany({ where: { taskId: { in: createdTaskIds } } }).catch(() => undefined)
    server.close()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => {
  console.error('VERIFY FAILED:', e.message)
  process.exit(1)
})
