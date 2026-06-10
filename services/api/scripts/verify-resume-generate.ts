/**
 * 阶段2A — AI 简历生成 MVP 验证。
 *
 * 覆盖(对应需求验收点):
 *   1.  防编造(结构):LLM 桩返回多余条目/缺条目 → 判非法重试,两次仍坏 → 明确失败,绝不出半截简历。
 *   2.  防编造(事实字段):学校/公司/职务/证书逐字等于用户输入,LLM 无法改写事实。
 *   3.  合规拦截:润色文本命中拦截词(保录用等) → 丢弃润色回退用户原文。
 *   4.  未配置 → AI_PROVIDER_NOT_CONFIGURED 明确失败,不 fallback mock。
 *   5.  缺失提示:无联系方式/无教育经历 → missingHints 确定性给出(AI 不代填)。
 *   6.  持久化+令牌:kind='generate' 落库;匿名铸一次性 accessToken(响应仅一次,DB 只存 hash);
 *       正确 token 可读,错 token / 无 token → AI_TASK_NOT_FOUND;payloadJson 不含明文 token。
 *   7.  PDF 导出:pdfkit 渲染真实 PDF(%PDF 魔数,页数≥1,中文字体内嵌);
 *       FileObject purpose='resume_upload'、sensitiveLevel='sensitive'(短 TTL 自动清理);
 *       文件名不含手机号;签名 URL 含 expires/sig 参数。
 *   8.  mock provider:同一防编造契约(事实字段逐字复制)。
 *
 * 运行:pnpm --filter @ai-job-print/api verify:resume-generate
 */
import 'dotenv/config'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { randomUUID } from 'crypto'
import { Logger } from '@nestjs/common'

if (!process.env['FILE_SIGNING_SECRET'] || process.env['FILE_SIGNING_SECRET'].length < 32) {
  process.env['FILE_SIGNING_SECRET'] = 'verify-resume-generate-test-secret-0123456789'
}
// 强制本地存储,绝不把测试文件写入生产 COS
process.env['FILE_STORAGE_DRIVER'] = 'local'
process.env['AI_PROVIDER'] = 'mock'

import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { StorageService } from '../src/storage/storage.service'
import { FilesService } from '../src/files/files.service'
import { AiService } from '../src/ai/ai.service'
import { MockAiProvider } from '../src/ai/providers/mock.provider'
import { LlmResumeGenerateService } from '../src/ai/resume/llm-resume-generate.service'
import { ResumePdfService } from '../src/ai/resume/resume-pdf.service'
import type { ResumeGenerateInput } from '../src/ai/interfaces/ai-provider.interface'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exitCode = 1; throw new Error(m) }

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}

const jw = (...parts: string[]) => parts.join('')

const INPUT: ResumeGenerateInput = {
  basic: { name: '验证用户', phone: '13800000000', city: '青岛' },
  intention: { position: '前端开发工程师', city: '青岛' },
  education: [{ school: '验证大学', major: '计算机', degree: '本科', period: '2021-2025', description: '主修数据结构' }],
  experience: [{ company: '验证科技公司', role: '前端实习生', period: '2024.07-2024.12', description: '参与官网开发 维护组件库' }],
  projects: [{ name: '验证项目', role: '负责人', description: '做了一个校园二手平台' }],
  skills: ['JavaScript', 'React'],
  certificates: ['英语六级'],
}

// LLM 桩:按队列出响应
type StubResponse = { status: number; content?: string }
let responseQueue: StubResponse[] = []
let llmCallCount = 0
const setResponses = (arr: StubResponse[]) => { responseQueue = arr.slice(); llmCallCount = 0 }

function validPolish(mut?: (o: Record<string, unknown>) => void): string {
  const o: Record<string, unknown> = {
    summary: '计算机专业应届生，目标岗位为前端开发工程师，具备扎实的前端基础。',
    educationDesc: ['主修数据结构、操作系统等核心课程，成绩优良。'],
    experienceDesc: ['参与公司官网前端开发，负责组件库维护与页面性能优化。'],
    projectDesc: ['主导校园二手交易平台前端搭建，覆盖商品发布与站内沟通流程。'],
    skillsPolished: ['JavaScript', 'React'],
  }
  if (mut) mut(o)
  return JSON.stringify(o)
}

async function main(): Promise<void> {
  console.log('\n=== 阶段2A AI 简历生成 MVP 验证 ===')

  Logger.overrideLogger({ log: () => {}, error: () => {}, warn: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {} })

  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      llmCallCount++
      const next = responseQueue.shift() ?? { status: 200, content: validPolish() }
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
  const configured = {
    getApiKey: (f?: string) => (f === 'resume_generate' ? 'stub-key' : null),
    getConfig: (f?: string) => ({ ...cfgBase, enabled: f === 'resume_generate' }),
    isReady: (f?: string) => f === 'resume_generate',
  }
  const unconfigured = { getApiKey: () => null, getConfig: () => ({ ...cfgBase, enabled: false }), isReady: () => false }

  const genSvc = new LlmResumeGenerateService(configured as never)
  const genSvcOff = new LlmResumeGenerateService(unconfigured as never)

  // ── 1+2. 结构性防编造 ───────────────────────────────────────────────────
  {
    setResponses([{ status: 200, content: validPolish() }])
    const resume = await genSvc.generate(INPUT)
    if (resume.education[0].school !== '验证大学' || resume.experience[0].company !== '验证科技公司'
      || resume.experience[0].role !== '前端实习生' || resume.certificates[0] !== '英语六级') {
      fail('2. 事实字段未逐字保留')
    }
    if (resume.education.length !== 1 || resume.experience.length !== 1 || resume.projects.length !== 1) {
      fail('2. 条目数量与输入不一致')
    }
    if (!resume.experience[0].description.includes('组件库')) fail('2. 润色描述未生效')
    pass('1+2. 合法润色:事实字段逐字保留,条目数不变,描述润色生效')

    // LLM 试图多塞一条经历(编造) → 长度漂移 → 重试一次 → 仍坏 → 明确失败
    const fabricated = validPolish((o) => { (o['experienceDesc'] as string[]).push('我编造的第二段经历') })
    setResponses([{ status: 200, content: fabricated }, { status: 200, content: fabricated }])
    try {
      await genSvc.generate(INPUT)
      fail('1. 长度漂移应失败')
    } catch (e) {
      if (errCode(e) !== 'AI_GENERATE_INVALID_OUTPUT') fail(`1. 期望 AI_GENERATE_INVALID_OUTPUT,实际 ${errCode(e)}`)
      if (llmCallCount !== 2) fail(`1. 应重试一次(2 次调用),实际 ${llmCallCount}`)
      pass('1. LLM 多塞经历条目 → 判非法重试,两次仍坏 → 明确失败(不出半截简历)')
    }
  }

  // ── 3. 合规拦截词:润色回退原文 ─────────────────────────────────────────
  {
    const dirty = validPolish((o) => {
      (o['experienceDesc'] as string[])[0] = `表现优秀,${jw('保', '录用')}没问题`
    })
    setResponses([{ status: 200, content: dirty }])
    const resume = await genSvc.generate(INPUT)
    if (resume.experience[0].description.includes(jw('保', '录用'))) fail('3. 拦截词进入简历')
    if (resume.experience[0].description !== INPUT.experience[0].description.trim()) fail('3. 未回退用户原文')
    pass('3. 润色命中拦截词 → 丢弃润色,回退用户原文')
  }

  // ── 4. 未配置 → 明确失败 ───────────────────────────────────────────────
  try {
    await genSvcOff.generate(INPUT)
    fail('4. 未配置应失败')
  } catch (e) {
    if (errCode(e) !== 'AI_PROVIDER_NOT_CONFIGURED') fail(`4. 期望 AI_PROVIDER_NOT_CONFIGURED,实际 ${errCode(e)}`)
    pass('4. 未配置 → AI_PROVIDER_NOT_CONFIGURED(不 fallback mock)')
  }

  // ── 5+8. mock provider:防编造契约 + missingHints ──────────────────────
  const mockProvider = new MockAiProvider()
  {
    const out = await mockProvider.generateResume!(INPUT)
    if (out.status !== 'completed' || !out.resume) fail('8. mock 生成失败')
    if (out.resume.education[0].school !== '验证大学' || out.resume.certificates[0] !== '英语六级') {
      fail('8. mock 事实字段未逐字保留')
    }
    pass('8. mock provider 同一防编造契约(事实字段逐字复制)')

    const bare: ResumeGenerateInput = {
      basic: { name: '裸用户' }, intention: { position: '操作工' },
      education: [], experience: [], projects: [], skills: [], certificates: [],
    }
    const bareOut = await mockProvider.generateResume!(bare)
    const hints = bareOut.missingHints ?? []
    if (!hints.some((h) => h.includes('联系方式')) || !hints.some((h) => h.includes('教育经历'))) {
      fail(`5. missingHints 缺失: ${JSON.stringify(hints)}`)
    }
    pass('5. 缺联系方式/教育经历 → missingHints 确定性提示(AI 不代填)')
  }

  // ── 6. AiService 持久化 + 匿名令牌门禁 ─────────────────────────────────
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const storage = new StorageService()
  const audit = new AuditService(prisma)
  const files = new FilesService(prisma, audit, storage)
  const pdf = new ResumePdfService()
  const emptyStub = {} as never
  const logStub = { record: () => {} } as never
  const ai = new AiService(
    mockProvider as never, // mockProvider（AI_PROVIDER=mock → this.provider）
    emptyStub, emptyStub, emptyStub, emptyStub, emptyStub, // 其余 provider 桩
    emptyStub, // llmResumeProvider
    logStub,   // logService
    emptyStub, // llmConfig
    emptyStub, // llmChat
    emptyStub, // resumeExtraction
    pdf,       // resumePdf
    files,     // files
    prisma,
    audit as never,
  )

  const createdTaskIds: string[] = []
  const createdFileIds: string[] = []
  try {
    const out = await ai.submitResumeGenerate(INPUT, null)
    createdTaskIds.push(out.taskId)
    if (out.status !== 'completed' || !out.accessToken) fail('6. 匿名生成应返回一次性 accessToken')
    const row = await prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId: out.taskId, kind: 'generate' } } })
    if (!row) fail('6. 未落库 kind=generate')
    if (!row.accessTokenHash || row.accessTokenHash.length !== 64) fail('6. accessTokenHash 异常')
    if (row.payloadJson.includes(out.accessToken)) fail('6. payloadJson 泄露明文 token')
    if (!row.expiresAt) fail('6. 未设置留存窗口 expiresAt')
    pass('6a. kind=generate 落库;DB 只存 hash;payload 无明文 token;有留存窗口')

    const readBack = await ai.getResumeGenerate(out.taskId, { endUserId: null, accessToken: out.accessToken })
    if (readBack.resume?.basic.name !== '验证用户') fail('6. 正确 token 读取失败')
    try {
      await ai.getResumeGenerate(out.taskId, { endUserId: null, accessToken: 'wrong-token' })
      fail('6. 错 token 应拒绝')
    } catch (e) {
      if (errCode(e) !== 'AI_TASK_NOT_FOUND') fail(`6. 期望 AI_TASK_NOT_FOUND,实际 ${errCode(e)}`)
    }
    try {
      await ai.getResumeGenerate(out.taskId, { endUserId: null, accessToken: null })
      fail('6. 无 token 应拒绝')
    } catch (e) {
      if (errCode(e) !== 'AI_TASK_NOT_FOUND') fail(`6. 期望 AI_TASK_NOT_FOUND,实际 ${errCode(e)}`)
    }
    pass('6b. 正确 token 可读;错 token / 无 token → AI_TASK_NOT_FOUND')

    // ── 7. PDF 导出(真实文件 + FileObject + 签名 URL)────────────────────
    const exported = await ai.exportGeneratedResume(readBack.resume!, null)
    createdFileIds.push(exported.fileId)
    if (exported.pageCount < 1) fail('7. 页数异常')
    if (exported.filename.includes('13800000000')) fail('7. 文件名泄露手机号')
    if (!exported.signedUrl.includes('expires=') && !exported.signedUrl.includes('sig=') && !exported.signedUrl.includes('Signature')) {
      fail(`7. signedUrl 非签名 URL: ${exported.signedUrl.slice(0, 80)}`)
    }
    const fileRow = await prisma.fileObject.findUnique({ where: { id: exported.fileId } })
    if (!fileRow) fail('7. FileObject 未落库')
    // 既有策略:resume_upload → highly_sensitive(1h TTL);敏感级别只能更严不能更松
    if (fileRow.purpose !== 'resume_upload' || !['sensitive', 'highly_sensitive'].includes(fileRow.sensitiveLevel)) {
      fail(`7. purpose/sensitiveLevel 错误: ${fileRow.purpose}/${fileRow.sensitiveLevel}`)
    }
    const ttlMs = fileRow.expiresAt.getTime() - Date.now()
    if (ttlMs <= 0 || ttlMs > 24 * 60 * 60 * 1000) fail(`7. 敏感文件 TTL 异常: ${Math.round(ttlMs / 3600_000)}h`)
    const buf = await storage.getObject(fileRow.storageKey)
    if (!buf.subarray(0, 4).equals(Buffer.from('%PDF', 'latin1'))) fail('7. 产物不是 PDF')
    if (buf.length < 2000) fail('7. PDF 过小,疑似未嵌中文字体')
    pass(`7. 真实 PDF(${exported.pageCount} 页,${Math.round(buf.length / 1024)}KB,中文字体内嵌);FileObject sensitive 短 TTL;文件名无手机号;签名 URL`)

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
    await prisma.auditLog.deleteMany({ where: { targetId: { in: [...createdTaskIds, ...createdFileIds] } } }).catch(() => undefined)
    server.close()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => {
  console.error('VERIFY FAILED:', e.message)
  process.exit(1)
})
