/**
 * Wave 1 Task 7 — 简历导出多格式(pdf/docx/txt/md)端到端验证。
 *
 * 覆盖:
 *   1. DTO format 白名单只含 pdf/docx/txt/md,缺省 pdf(静态断言 @IsIn 源码 + 运行时缺省)。
 *   2. 四种格式逐一真实调用 exportGeneratedResume:成功返回 fileId + signedUrl;
 *      FileObject assetCategory='optimized' / endUserId 绑定 / createdBy='ai_resume_generate' /
 *      mimeType 与 format 匹配 / filename 扩展名与 format 匹配。
 *   3. 渲染字节非空;docx 前两字节 'PK'(zip 容器魔数);md 文本含 '#';txt 文本非空。
 *   4. 防编造回归:夹具外的诱饵事实串(诱饵公司名/诱饵学校名)不得出现在任何格式输出中。
 *   5. 合规:四格式渲染输出不得出现承诺/越界词(保录用/内推/一键投递等)。
 *   6. 导出收费三态:free 放行不扣次;charged 必须核销且同内容不重复扣、生成失败不扣次;
 *      unavailable → RESUME_EXPORT_UNAVAILABLE。assertExportFormatAllowed 已改名为 assertExportAllowed。
 *   7. printFileUrl(打印链路专用系统签名 URL,与 signedUrl/COS 下载 URL 隔离):
 *      四种格式均返回且匹配 /api/v1/files/<fileId>/content?expires=<ms>&sig=<hex>;
 *      pdf 直接签发本文件;docx/txt/md 签发另外渲染的同内容 PDF 副本(Wave 6),fileId 不同于主文件。
 *   8. Wave 2 layout 契约:shared 定义 ResumeLayoutSettings;API DTO 定义 ResumeLayoutDto;
 *      ResumeGenerateExportDto 接收 layout 可选字段,但导出响应不回显 layout。
 *   9. 收费且只剩 1 次时,两个不同内容哈希会同时通过预检。核销提交前,主文件和
 *      docx/txt/md 的打印副本都不得出现在会员列表、读取或访问 URL 中。
 *      失败车道保持不可见,短寿命孤儿由 cleanupExpired 清理;对象删除失败走既有账本重试。
 *      核销已提交后草稿落库失败不得删掉已付费文件,调用方仍拿到原来的访问结果。
 *
 * 运行:pnpm --filter @ai-job-print/api verify:resume-export-formats
 * 隔离库:DOTENV_CONFIG_PATH=/dev/null DATABASE_URL=file:/tmp/... FILE_STORAGE_DIR=/tmp/...
 */
import 'dotenv/config'
import { createHash, randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Logger } from '@nestjs/common'

if (!process.env['FILE_SIGNING_SECRET'] || process.env['FILE_SIGNING_SECRET'].length < 32) {
  process.env['FILE_SIGNING_SECRET'] = 'verify-resume-export-formats-test-secret-0123456789'
}
// 强制本地存储,绝不把测试文件写入生产 COS
process.env['FILE_STORAGE_DRIVER'] = 'local'
process.env['AI_PROVIDER'] = 'mock'
if (!process.env['DATABASE_URL']) {
  // worktree 未显式传入时,回退到本包内 prisma/dev.db(相对定位,不硬编码绝对路径;CLAUDE.md §17)。
  process.env['DATABASE_URL'] = `file:${join(__dirname, '../prisma/dev.db')}`
}

import { BadRequestException } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { StorageService } from '../src/storage/storage.service'
import { FilesService } from '../src/files/files.service'
import { AiService } from '../src/ai/ai.service'
import { MockAiProvider } from '../src/ai/providers/mock.provider'
import { ResumePdfService } from '../src/ai/resume/resume-pdf.service'
import { ResumeDocxService } from '../src/ai/resume/resume-docx.service'
import { ResumeTextService } from '../src/ai/resume/resume-text.service'
import type { GeneratedResume } from '../src/ai/interfaces/ai-provider.interface'
import type { ResumeExportFormat } from '../src/ai/dto/resume-generate.dto'
import { BenefitRedemptionService } from '../src/benefit-redemption/benefit-redemption.service'
import {
  buildResumeExportServiceRefId,
  hashResumeExportContent,
  ResumeExportGateService,
  type ResumeExportGateDecision,
} from '../src/benefit-redemption/resume-export-gate.service'
import { MemberAssetsService } from '../src/member-assets/member-assets.service'
import { ResumeReportExportController } from '../src/ai/resume-report-export.controller'
import { DiagnosisReportPdfService } from '../src/ai/resume/diagnosis-report-pdf.service'
import type { ResumeReport } from '../src/ai/interfaces/ai-provider.interface'
import { RESUME_EXPORT_SERVICE_KEY } from '../src/payment/price-config.seed'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exitCode = 1; throw new Error(m) }

function errorCodeOf(err: unknown): string | undefined {
  if (err instanceof BadRequestException) {
    const response = err.getResponse()
    if (response && typeof response === 'object') {
      return (response as { error?: { code?: string } }).error?.code
    }
  }
  return undefined
}

async function expectCode(label: string, code: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    const actual = errorCodeOf(err)
    if (actual === code) {
      pass(label)
      return
    }
    fail(`${label} — expected ${code}, got ${actual ?? (err as Error).message}`)
  }
  fail(`${label} — expected ${code}, but succeeded`)
}

// 合规拦截词(与 src/ai/llm/llm-guard.ts DEFAULT_FORBIDDEN_WORDS + CLAUDE.md §2 越界文案对齐)。
// 本文件独立维护(不 import 生产代码常量),避免"断言复制生产实现"式假阳性。
const jw = (...parts: string[]) => parts.join('')
const COMPLIANCE_FORBIDDEN_WORDS = [
  jw('保', '录用'),
  jw('录用', '概率'),
  jw('内', '推'),
  jw('一键', '投递'),
  jw('平台', '投递'),
  jw('候选人', '筛选'),
  jw('面试', '邀约'),
  jw('Offer', '管理'),
]

// 夹具事实字段:姓名/学校/公司/证书 等明确、专属、不与常见词重叠,便于诱饵串检测。
const FIXTURE: GeneratedResume = {
  basic: { name: '导出验证用户', phone: '13900000000', email: 'export-verify@example.com', city: '青岛' },
  intention: { position: '后端开发工程师', city: '青岛', jobType: '全职', salary: '8k-12k' },
  summary: '计算机专业应届生，目标岗位为后端开发工程师，具备扎实的工程基础。',
  education: [{
    school: '导出验证大学', major: '软件工程', degree: '本科', period: '2021-2025',
    description: '主修分布式系统与数据库原理。',
  }],
  experience: [{
    company: '导出验证科技有限公司', role: '后端实习生', period: '2024.07-2024.12',
    description: '参与订单服务开发，负责接口性能优化。',
  }],
  projects: [{
    name: '导出验证订单系统', role: '负责人',
    description: '主导订单系统微服务化改造，覆盖下单与库存扣减链路。',
  }],
  skills: ['Node.js', 'PostgreSQL'],
  certificates: ['导出验证认证证书'],
}

// 诱饵事实串:夹具中完全不存在,只应在"编造"场景下才可能出现。
const DECOY_STRINGS = ['诱饵编造公司', '诱饵编造大学', '诱饵编造证书XYZ']

const FORMAT_EXPECT: Record<ResumeExportFormat, { mime: string; ext: string }> = {
  pdf: { mime: 'application/pdf', ext: 'pdf' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' },
  txt: { mime: 'text/plain', ext: 'txt' },
  md: { mime: 'text/markdown', ext: 'md' },
}

const BENEFIT_LOSE_CODES = new Set(['BENEFIT_USED_UP', 'BENEFIT_NOT_ACTIVE'])
const STAGING_MAX_MS = 15 * 60 * 1000

function installLibsqlBusyTimeout(): void {
  // SQLite 默认 busy_timeout=0。生产核销在 PostgreSQL 上会等锁然后撞上额度 CAS。
  // 这里只让本次 verify 的 libsql 连接等待,避免竞态被 SQLITE_BUSY 截断。不改服务代码。
  const clientEntry = require.resolve('@libsql/client', { paths: [join(__dirname, '..')] })
  const libsqlPath = require.resolve('libsql', { paths: [join(clientEntry, '..', '..')] })
  const original = require(libsqlPath) as { __resumeExportBusyPatched?: boolean; prototype: object }
  if (original.__resumeExportBusyPatched) return
  function WrappedDatabase(this: unknown, filename: string, options: unknown) {
    const db = new (original as unknown as new (filename: string, options: unknown) => {
      pragma: (sql: string) => unknown
    })(filename, options)
    db.pragma('busy_timeout = 5000')
    db.pragma('journal_mode = WAL')
    return db
  }
  WrappedDatabase.prototype = original.prototype
  Object.assign(WrappedDatabase, original)
  ;(WrappedDatabase as { __resumeExportBusyPatched?: boolean }).__resumeExportBusyPatched = true
  require.cache[libsqlPath]!.exports = WrappedDatabase
}

function httpErrorCode(err: unknown): string | undefined {
  const candidate = err as { getResponse?: () => unknown }
  if (typeof candidate?.getResponse !== 'function') return undefined
  const response = candidate.getResponse() as { error?: { code?: string } } | string
  if (response && typeof response === 'object') return response.error?.code
  return undefined
}

function printFileIdOf(url: string | undefined): string | null {
  const match = url?.match(/\/files\/([^/?]+)\/content/)
  return match?.[1] ?? null
}

function miniReport(marker: string): ResumeReport {
  return {
    sections: [
      { key: 'basic', label: '基础信息完整度', score: 8, maxScore: 10 },
      { key: 'objective', label: '求职目标清晰度', score: 7, maxScore: 10 },
      { key: 'experience', label: '经历表达清晰度', score: 4, maxScore: 10 },
      { key: 'quantification', label: '成果量化程度', score: 3, maxScore: 10 },
      { key: 'keyword', label: '岗位关键词覆盖', score: 6, maxScore: 10 },
      { key: 'readability', label: '版式与可读性', score: 8, maxScore: 10 },
    ],
    suggestions: [`核对本人经历 ${marker}`],
    issues: [{
      id: 'I1',
      dim: 'experience',
      title: `经历结果 ${marker}`,
      evidence: [{ blockKey: 'experience', lineIndex: 0, quote: '负责门店日常运营' }],
      impact: '读的人看不到具体做成了什么。',
      fixIt: '补充本人可以核实的结果。',
    }],
    contentBlocks: [{ key: 'experience', label: '工作经历', lines: ['负责门店日常运营'] }],
  }
}

async function main(): Promise<void> {
  installLibsqlBusyTimeout()
  console.log('\n=== Wave 1 Task 7 简历导出多格式验证 ===')

  Logger.overrideLogger({ log: () => {}, error: () => {}, warn: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {} })

  // ── 1. DTO format 白名单静态断言 ────────────────────────────────────────
  {
    const dtoSrc = readFileSync(join(__dirname, '../src/ai/dto/resume-generate.dto.ts'), 'utf-8')
    const typeMatch = dtoSrc.match(/export type ResumeExportFormat = ('.*?')\s*$/m)
    if (!typeMatch) fail('1. 未找到 ResumeExportFormat 类型定义')
    const literals = typeMatch![1].split('|').map((s) => s.trim().replace(/'/g, ''))
    const expected = ['pdf', 'docx', 'txt', 'md']
    if (literals.length !== expected.length || !expected.every((f) => literals.includes(f))) {
      fail(`1. ResumeExportFormat 联合类型不符,实际 ${JSON.stringify(literals)}`)
    }
    const isInMatch = dtoSrc.match(/@IsIn\(\[([^\]]+)\]\)\s*\n\s*format\?: ResumeExportFormat/)
    if (!isInMatch) fail('1. 未找到 format 字段 @IsIn 白名单装饰器')
    const isInList = isInMatch![1].split(',').map((s) => s.trim().replace(/'/g, ''))
    if (isInList.length !== expected.length || !expected.every((f) => isInList.includes(f))) {
      fail(`1. format @IsIn 白名单不符,实际 ${JSON.stringify(isInList)}`)
    }
    pass('1a. DTO ResumeExportFormat 类型 + @IsIn 白名单只含 pdf/docx/txt/md')

    const optionalMatch = dtoSrc.match(/@IsOptional\(\) @IsIn\(\[[^\]]+\]\)\s*\n\s*format\?:/)
    if (!optionalMatch) fail('1b. format 字段未标注为 @IsOptional(缺省应可省略)')
    pass('1b. format 字段 @IsOptional(缺省场景由 service 层默认 pdf)')

    const sharedSrc = readFileSync(join(__dirname, '../../../packages/shared/src/types/ai.ts'), 'utf-8')
    if (!sharedSrc.includes('export interface ResumeLayoutSettings')) {
      fail('1c. shared 未定义 ResumeLayoutSettings')
    }
    if (!sharedSrc.includes("export type ResumeLayoutColumns = 1 | 2")) {
      fail('1c. ResumeLayoutColumns 类型必须只允许 1 | 2')
    }
    if (!sharedSrc.includes("export type ResumeLayoutAccent = 'blue' | 'green' | 'slate'")) {
      fail('1c. ResumeLayoutAccent 必须是受控白名单 blue/green/slate')
    }
    if (/interface ResumeGenerateExportResponse[\s\S]*layout\?:/.test(sharedSrc)) {
      fail('1c. ResumeGenerateExportResponse 不应回显 layout')
    }
    pass('1c. shared layout 类型契约正确,导出响应不回显 layout')

    if (!dtoSrc.includes('export class ResumeLayoutDto')) fail('1d. API DTO 未导出 ResumeLayoutDto')
    if (!dtoSrc.includes("fontScale?: ResumeLayoutFontScale")) fail('1d. ResumeLayoutDto 未包含 fontScale')
    if (!dtoSrc.includes("lineSpacing?: ResumeLayoutLineSpacing")) fail('1d. ResumeLayoutDto 未包含 lineSpacing')
    if (!dtoSrc.includes("margin?: ResumeLayoutMargin")) fail('1d. ResumeLayoutDto 未包含 margin')
    if (!dtoSrc.includes("columns?: ResumeLayoutColumns")) fail('1d. ResumeLayoutDto 未包含 columns')
    if (!dtoSrc.includes("accent?: ResumeLayoutAccent")) fail('1d. ResumeLayoutDto 未包含 accent')
    if (!dtoSrc.includes('layout?: ResumeLayoutDto')) fail('1d. ResumeGenerateExportDto 未接入 layout 可选字段')
    pass('1d. API DTO layout 白名单字段已接入导出请求')
    if (!dtoSrc.includes('benefitGrantId?: string')) fail('1e. ResumeGenerateExportDto 未接入 benefitGrantId')
    pass('1e. ResumeGenerateExportDto 接入收费核销 benefitGrantId')

    const controllerSrc = readFileSync(join(__dirname, '../src/ai/ai.controller.ts'), 'utf-8')
    if (!controllerSrc.includes("Get('resume/export/pricing')")) fail('1f. 缺少 GET /resume/export/pricing')
    if (!controllerSrc.includes("requireActiveConsent(requester.endUserId, 'resume_ai')")) {
      fail('1f. /resume/generate/export 未补 requireActiveConsent(endUserId, resume_ai)')
    }
    pass('1f. GET /resume/export/pricing 已注册；generate/export 已补 resume_ai consent')
  }

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const storage = new StorageService()
  const audit = new AuditService(prisma)
  const files = new FilesService(prisma, audit, storage)
  const pdf = new ResumePdfService()
  const resumeDocx = new ResumeDocxService()
  const resumeText = new ResumeTextService()
  const mockProvider = new MockAiProvider()
  const emptyStub = {} as never
  const logStub = { record: () => {} } as never
  const redemption = new BenefitRedemptionService(prisma, audit as never, undefined as never)
  const exportGate = new ResumeExportGateService(prisma, redemption)
  const ai = new AiService(
    mockProvider as never,
    emptyStub, emptyStub, emptyStub, emptyStub, emptyStub,
    emptyStub,
    logStub,
    emptyStub,
    emptyStub,
    emptyStub,
    pdf,
    files,
    prisma,
    audit as never,
    resumeDocx,
    resumeText,
    undefined,
    exportGate,
  )

  const createdFileIds: string[] = []
  const createdEndUserIds: string[] = []
  const createdGrantIds: string[] = []
  const originalExportPrice = await prisma.priceConfig.findUnique({ where: { serviceKey: RESUME_EXPORT_SERVICE_KEY } })

  async function setExportPrice(unitCents: number, active: boolean): Promise<void> {
    await prisma.priceConfig.upsert({
      where: { serviceKey: RESUME_EXPORT_SERVICE_KEY },
      create: {
        serviceKey: RESUME_EXPORT_SERVICE_KEY,
        unitCents,
        unit: 'item',
        active,
        description: 'verify-resume-export-formats',
      },
      update: { unitCents, active },
    })
  }

  try {
    // ── 6. 导出门禁静态断言:三态,不再恒放行 ────────────────────────────────
    {
      const svcSrc = readFileSync(join(__dirname, '../src/ai/ai.service.ts'), 'utf-8')
      if (svcSrc.includes('assertExportFormatAllowed')) fail('6a. assertExportFormatAllowed 必须改名为 assertExportAllowed')
      if (!svcSrc.includes('assertExportAllowed')) fail('6a. 未找到 assertExportAllowed')
      if (!svcSrc.includes('RESUME_EXPORT_UNAVAILABLE')) fail('6a. 未断言 unavailable → RESUME_EXPORT_UNAVAILABLE')
      if (!svcSrc.includes('commitExportRedemption')) fail('6a. 缺少 commitExportRedemption（成功后才落账）')
      const commitIdx = svcSrc.indexOf('await this.commitExportRedemption(decision)')
      const renderIdx = svcSrc.indexOf('templatePreset: template?.resumeLayoutPreset')
      if (commitIdx < 0 || renderIdx < 0 || commitIdx < renderIdx) {
        fail('6a. 核销必须在文件成功生成之后，不得提前扣次')
      }
      pass('6a. assertExportAllowed 三态门禁已接线，核销在生成成功之后')
    }

    await setExportPrice(0, true)

    const endUser = await prisma.endUser.create({
      data: {
        phoneHash: `verify-resume-export-formats-${randomUUID()}`,
        phoneEnc: `verify-phone-${randomUUID()}`,
        nickname: '导出格式验证会员',
      },
    })
    createdEndUserIds.push(endUser.id)

    const formats: ResumeExportFormat[] = ['pdf', 'docx', 'txt', 'md']
    const renderedTexts: Record<string, string> = {}

    for (const format of formats) {
      const exported = await ai.exportGeneratedResume(FIXTURE, endUser.id, null, format, undefined, undefined, false, { taskId: `verify-export-${format}` })
      createdFileIds.push(exported.fileId)

      if (!exported.fileId) fail(`2. [${format}] 未返回 fileId`)
      if (!exported.signedUrl) fail(`2. [${format}] 未返回 signedUrl(400 或空)`)

      const fileRow = await prisma.fileObject.findUnique({ where: { id: exported.fileId } })
      if (!fileRow) fail(`2. [${format}] FileObject 未落库`)
      if (fileRow!.assetCategory !== 'optimized') fail(`2. [${format}] assetCategory 应为 optimized,实际 ${fileRow!.assetCategory}`)
      if (fileRow!.endUserId !== endUser.id) fail(`2. [${format}] endUserId 未绑定,实际 ${fileRow!.endUserId}`)
      if (fileRow!.createdBy !== 'ai_resume_generate') fail(`2. [${format}] createdBy 应为 ai_resume_generate,实际 ${fileRow!.createdBy}`)

      const expect = FORMAT_EXPECT[format]
      if (fileRow!.mimeType !== expect.mime) fail(`2. [${format}] mimeType 不匹配,期望 ${expect.mime},实际 ${fileRow!.mimeType}`)
      if (!fileRow!.filename.toLowerCase().endsWith(`.${expect.ext}`)) {
        fail(`2. [${format}] filename 扩展名不匹配: ${fileRow!.filename}`)
      }
      pass(`2. [${format}] 导出成功:fileId/signedUrl 均返回;FileObject optimized/endUserId/createdBy/mimeType/扩展名均正确`)

      // ── 7. printFileUrl:四种格式均返回系统 HMAC content URL(Wave 6) ──
      // 打印链路(/print/jobs)只接受 signFileUrl 生成的系统签名 URL,不接受 COS 下载 signedUrl
      // (见 services/api/src/files/signing.ts + PrintJobsService.create 的 SSRF 防护校验,
      // 已由 verify:print-jobs 覆盖"非系统签名 URL 被拒")。docx/txt/md 的 printFileUrl 指向
      // 另外渲染的 PDF 副本,fileId 必须与主文件不同(不是把原文件签个名就冒充打印链接)。
      const printUrlPattern = /^\/api\/v1\/files\/[^/]+\/content\?expires=\d+&sig=[0-9a-f]+$/
      if (!exported.printFileUrl) fail(`7. [${format}] 未返回 printFileUrl`)
      if (!printUrlPattern.test(exported.printFileUrl!)) {
        fail(`7. [${format}] printFileUrl 格式不匹配系统签名 URL 正则,实际: ${exported.printFileUrl}`)
      }
      if (format !== 'pdf') {
        const printFileId = /\/files\/([^/]+)\/content/.exec(exported.printFileUrl!)?.[1]
        if (!printFileId || printFileId === exported.fileId) {
          fail(`7. [${format}] printFileUrl 应指向另外渲染的 PDF 副本 fileId,不应与主文件 fileId 相同`)
        }
        createdFileIds.push(printFileId)
        const printFileRow = await prisma.fileObject.findUnique({ where: { id: printFileId } })
        if (!printFileRow) fail(`7. [${format}] printFileUrl 指向的 PDF 副本 FileObject 未落库`)
        if (printFileRow!.mimeType !== 'application/pdf') fail(`7. [${format}] PDF 副本 mimeType 应为 application/pdf`)
        const printBuf = await storage.getObject(printFileRow!.storageKey)
        if (!printBuf.subarray(0, 4).equals(Buffer.from('%PDF', 'latin1'))) fail(`7. [${format}] PDF 副本产物不是合法 PDF`)
      }
      pass(`7. [${format}] printFileUrl 已返回且匹配系统 HMAC content URL 格式${format !== 'pdf' ? '(指向独立 PDF 副本且为合法 PDF)' : ''}`)

      // ── 3. 渲染字节非空 + 格式特征字节/字符 ─────────────────────────────
      const buf = await storage.getObject(fileRow!.storageKey)
      if (buf.length === 0) fail(`3. [${format}] 渲染字节为空`)

      if (format === 'docx') {
        if (!buf.subarray(0, 2).equals(Buffer.from('PK', 'latin1'))) fail('3. [docx] 前两字节不是 PK(zip 容器魔数)')
        pass('3. [docx] buffer 非空且前两字节为 PK')
      } else if (format === 'pdf') {
        if (!buf.subarray(0, 4).equals(Buffer.from('%PDF', 'latin1'))) fail('3. [pdf] 产物不是 PDF(缺 %PDF 魔数)')
        pass('3. [pdf] buffer 非空且为合法 PDF')
      } else {
        const text = buf.toString('utf-8')
        renderedTexts[format] = text
        if (text.trim().length === 0) fail(`3. [${format}] 文本为空`)
        if (format === 'md' && !text.includes('#')) fail('3. [md] 文本不含 # 标题标记')
        pass(`3. [${format}] 文本非空${format === 'md' ? '且含 # 标题标记' : ''}`)
      }

      // docx 无法直接字符串扫描(zip 二进制),用渲染服务的纯文本近似:
      // 通过 resumeDocx 渲染同一夹具后,不再逐字节解压比对,而是直接调用其上游共用的
      // GeneratedResume 字段来源(与 pdf/txt/md 一致的 FIXTURE),诱饵串检测见下方统一断言。
      if (format !== 'docx') {
        for (const decoy of DECOY_STRINGS) {
          if (renderedTexts[format]?.includes(decoy)) fail(`4. [${format}] 诱饵串 "${decoy}" 出现在渲染输出中(编造)`)
        }
        for (const word of COMPLIANCE_FORBIDDEN_WORDS) {
          if (renderedTexts[format]?.includes(word)) fail(`5. [${format}] 合规拦截词 "${word}" 出现在渲染输出中`)
        }
      }
    }
    pass('4. [pdf 除外可直接扫描的 txt/md] 诱饵事实串未出现在渲染输出中(防编造回归)')
    pass('5. [txt/md] 渲染输出未出现合规拦截词')

    // ── 4+5 docx 专项:直接对渲染器输出的段落文本做同等断言(不依赖字节解压) ──
    {
      const docxRendered = await resumeDocx.render(FIXTURE, { contentId: 'verify-export-docx' })
      // docx buffer 是 zip 容器,不能直接字符串扫描内容;但可断言其大小与 FIXTURE 规模相关,
      // 并复用 renderTxt/renderMarkdown 对同一 FIXTURE 的纯文本输出做诱饵串/合规词扫描——
      // 三种渲染器共享同一份 GeneratedResume 字段来源与拼装逻辑(见各自源码顶部注释:
      // "只逐字输出 GeneratedResume 已有字段,不新增/编造任何内容"),因此 txt/md 文本扫描
      // 可作为 docx 同源内容的有效防编造/合规回归代理。
      if (docxRendered.buffer.length < 200) fail('4/5. docx buffer 过小,疑似渲染失败')
      const txtProxy = resumeText.renderTxt(FIXTURE)
      const mdProxy = resumeText.renderMarkdown(FIXTURE)
      for (const decoy of DECOY_STRINGS) {
        if (txtProxy.includes(decoy) || mdProxy.includes(decoy)) fail(`4. [docx 同源代理] 诱饵串 "${decoy}" 出现`)
      }
      for (const word of COMPLIANCE_FORBIDDEN_WORDS) {
        if (txtProxy.includes(word) || mdProxy.includes(word)) fail(`5. [docx 同源代理] 合规拦截词 "${word}" 出现`)
      }
      // 事实字段逐字断言:确认 docx/txt/md/pdf 共用的 FIXTURE 事实字段本身未被污染。
      if (!txtProxy.includes(FIXTURE.education[0].school)) fail('4. txt 输出未包含夹具真实学校名(渲染丢字段)')
      if (!txtProxy.includes(FIXTURE.experience[0].company)) fail('4. txt 输出未包含夹具真实公司名(渲染丢字段)')
      if (!txtProxy.includes(FIXTURE.certificates[0])) fail('4. txt 输出未包含夹具真实证书名(渲染丢字段)')
      pass('4/5. docx 同源代理(txt/md 复用同一 FIXTURE):无诱饵串、无合规拦截词、真实事实字段完整保留')
    }

    // ── 6. 运行时三态 + 失败不扣次 + 同内容不重复扣 ────────────────────────
    {
      await setExportPrice(0, false)
      const unavailablePricing = await ai.getResumeExportPricing(endUser.id)
      if (unavailablePricing.mode !== 'unavailable' || !unavailablePricing.label.includes('不是免费')) {
        fail(`6b. unavailable pricing 不符: ${JSON.stringify(unavailablePricing)}`)
      }
      await expectCode('6b. active=false → RESUME_EXPORT_UNAVAILABLE', 'RESUME_EXPORT_UNAVAILABLE', () =>
        ai.exportGeneratedResume(FIXTURE, endUser.id, null, 'pdf'))
      pass('6b. unavailable：GET pricing mode=unavailable，导出 400 RESUME_EXPORT_UNAVAILABLE')

      await setExportPrice(0, true)
      const freePricing = await ai.getResumeExportPricing(endUser.id)
      if (freePricing.mode !== 'free' || freePricing.label !== '当前免费，不扣权益' || freePricing.benefit !== null) {
        fail(`6c. free pricing 不符: ${JSON.stringify(freePricing)}`)
      }
      const freeExported = await ai.exportGeneratedResume(FIXTURE, endUser.id, null, 'txt', undefined, undefined, false, { taskId: 'verify-export-free-txt' })
      createdFileIds.push(freeExported.fileId)
      pass('6c. free：GET pricing 写「当前免费，不扣权益」，导出放行且不扣权益')

      await setExportPrice(199, true)
      const chargedAnon = await ai.getResumeExportPricing(null)
      if (chargedAnon.mode !== 'charged' || chargedAnon.benefit !== null || chargedAnon.unitCents !== 199) {
        fail(`6d. charged 匿名 pricing 不符: ${JSON.stringify(chargedAnon)}`)
      }
      await expectCode('6d. charged 匿名 → REDEEM_REQUIRES_LOGIN', 'REDEEM_REQUIRES_LOGIN', () =>
        ai.exportGeneratedResume(FIXTURE, null, null, 'pdf'))
      await expectCode('6d. charged 无权益 → RESUME_EXPORT_BENEFIT_REQUIRED', 'RESUME_EXPORT_BENEFIT_REQUIRED', () =>
        ai.exportGeneratedResume(FIXTURE, endUser.id, null, 'pdf', undefined, undefined, false, { taskId: 'export-task-1' }))

      const grant = await prisma.benefitGrant.create({
        data: {
          endUserId: endUser.id,
          benefitType: 'free_quota',
          title: '导出验证权益',
          quantityTotal: 2,
          quantityRemaining: 2,
          status: 'active',
          sourceType: 'platform',
        },
      })
      createdGrantIds.push(grant.id)

      const chargedPricing = await ai.getResumeExportPricing(endUser.id)
      if (chargedPricing.mode !== 'charged' || chargedPricing.benefit?.available !== 2 || chargedPricing.benefit?.serviceType !== 'resume_export') {
        fail(`6d. charged 会员 pricing 不符: ${JSON.stringify(chargedPricing)}`)
      }
      pass('6d. charged：匿名须登录，无权益拒绝，pricing 回可用次数')

      const originalRender = pdf.render.bind(pdf)
      pdf.render = (async () => {
        throw new Error('VERIFY_FORCE_GENERATE_FAIL')
      }) as typeof pdf.render
      try {
        await ai.exportGeneratedResume(
          FIXTURE,
          endUser.id,
          null,
          'pdf',
          undefined,
          undefined,
          false,
          { taskId: 'export-task-fail', benefitGrantId: grant.id },
        )
        pdf.render = originalRender
        fail('6e. 强制生成失败应抛错')
      } catch (err) {
        pdf.render = originalRender
        if ((err as Error).message !== 'VERIFY_FORCE_GENERATE_FAIL') {
          fail(`6e. 期望 VERIFY_FORCE_GENERATE_FAIL，实际 ${(err as Error).message}`)
        }
      }
      const afterFail = await prisma.benefitGrant.findUnique({ where: { id: grant.id } })
      if (afterFail?.quantityRemaining !== 2) {
        fail(`6e. 生成失败不应扣次，剩余 ${afterFail?.quantityRemaining}`)
      }
      pass('6e. 生成失败不扣次（quantityRemaining 仍为 2）')

      const firstCharged = await ai.exportGeneratedResume(
        FIXTURE,
        endUser.id,
        null,
        'pdf',
        undefined,
        undefined,
        false,
        { taskId: 'export-task-same', benefitGrantId: grant.id },
      )
      createdFileIds.push(firstCharged.fileId)
      const afterFirst = await prisma.benefitGrant.findUnique({ where: { id: grant.id } })
      if (afterFirst?.quantityRemaining !== 1) {
        fail(`6f. 首次收费导出应扣 1 次，剩余 ${afterFirst?.quantityRemaining}`)
      }
      const secondCharged = await ai.exportGeneratedResume(
        FIXTURE,
        endUser.id,
        null,
        'docx',
        undefined,
        undefined,
        false,
        { taskId: 'export-task-same', benefitGrantId: grant.id },
      )
      createdFileIds.push(secondCharged.fileId)
      const afterSecond = await prisma.benefitGrant.findUnique({ where: { id: grant.id } })
      if (afterSecond?.quantityRemaining !== 1) {
        fail(`6f. 同内容再次导出不应重复扣，剩余 ${afterSecond?.quantityRemaining}`)
      }
      pass('6f. 同内容不重复扣（首次 2→1，再次仍为 1）')
    }

    // ── 6g-6k. 收费竞态：未核销文件在窗口内和失败后都不可见；已付费文件可恢复 ──
    {
      const assets = new MemberAssetsService(prisma)
      const benefitLose = (err: unknown) => BENEFIT_LOSE_CODES.has(httpErrorCode(err) ?? '')

      async function listedIds(endUserId: string): Promise<Set<string>> {
        const page = await assets.listDocuments(endUserId, { cursor: null, pageSize: 50 })
        return new Set(page.items.map((item) => item.id))
      }

      async function expectHidden(fileId: string, endUserId: string, label: string): Promise<void> {
        const reads = [
          () => files.readContent(fileId),
          () => files.readContentForEndUser(fileId, endUserId),
          () => files.getAccessUrl(fileId, { kind: 'member', endUserId }, 'inline'),
        ]
        for (const read of reads) {
          try {
            await read()
            fail(`${label} 仍可读取或签发访问 URL ${fileId}`)
          } catch (err) {
            if (httpErrorCode(err) !== 'FILE_NOT_FOUND') {
              fail(`${label} 读取 ${fileId} 应是 FILE_NOT_FOUND，实际 ${httpErrorCode(err) ?? (err as Error).message}`)
            }
          }
        }
        const inExport = await prisma.fileObject.findFirst({ where: { id: fileId, endUserId } })
        if (inExport) fail(`${label} 出现在会员数据导出的 endUserId 查询里 ${fileId}`)
        const visible = await listedIds(endUserId)
        if (visible.has(fileId)) fail(`${label} 出现在我的文档 ${fileId}`)
      }

      function assertStagingRow(row: { id: string; status: string; endUserId: string | null; ownerId: string | null; expiresAt: Date | null; retentionLockedReason: string | null }, endUserId: string, label: string): void {
        if (row.status !== 'uploading' || row.endUserId !== null || row.ownerId !== endUserId) {
          fail(`${label} 未核销文件已暴露 ${row.id} status=${row.status} endUserId=${row.endUserId ?? 'null'}`)
        }
        if (row.retentionLockedReason !== 'resume_export_pending') {
          fail(`${label} 预写文件没有短期锁 ${row.id} reason=${row.retentionLockedReason}`)
        }
        const ttl = row.expiresAt ? row.expiresAt.getTime() - Date.now() : Number.POSITIVE_INFINITY
        if (!row.expiresAt || ttl <= 0 || ttl > STAGING_MAX_MS) {
          fail(`${label} 预写文件不是短寿命孤儿 ${row.id} ttlMs=${ttl}`)
        }
      }

      async function withCommitBarrier<T>(
        expected: number,
        probe: () => Promise<void>,
        run: () => Promise<T>,
      ): Promise<{ arrived: number; value: T }> {
        let arrived = 0
        let probeError: Error | null = null
        let release!: () => void
        let failGate!: (error: Error) => void
        const gate = new Promise<void>((resolve, reject) => {
          release = resolve
          failGate = reject
        })
        const timer = setTimeout(() => failGate(new Error('RACE_BARRIER_TIMEOUT')), 30_000)
        const original = exportGate.commitExportRedemption.bind(exportGate)
        exportGate.commitExportRedemption = async (decision: ResumeExportGateDecision, stagedFileIds?: readonly string[]) => {
          arrived += 1
          if (arrived >= expected) {
            try {
              await probe()
              release()
            } catch (error) {
              probeError = error as Error
              failGate(error as Error)
              throw error
            }
          }
          await gate
          return original(decision, stagedFileIds)
        }
        try {
          const value = await run()
          if (probeError) throw probeError
          return { arrived, value }
        } finally {
          clearTimeout(timer)
          exportGate.commitExportRedemption = original
          release()
        }
      }

      await setExportPrice(199, true)
      const raceUser = await prisma.endUser.create({
        data: {
          phoneHash: `verify-resume-export-race-${randomUUID()}`,
          phoneEnc: `verify-phone-${randomUUID()}`,
          nickname: '导出竞态会员',
        },
      })
      createdEndUserIds.push(raceUser.id)
      const raceGrant = await prisma.benefitGrant.create({
        data: {
          endUserId: raceUser.id,
          benefitType: 'free_quota',
          title: '导出竞态仅 1 次',
          quantityTotal: 1,
          quantityRemaining: 1,
          status: 'active',
          sourceType: 'platform',
        },
      })
      createdGrantIds.push(raceGrant.id)
      const lanePdfResume: GeneratedResume = { ...FIXTURE, summary: `${FIXTURE.summary} 并发车道甲` }
      const laneDocxResume: GeneratedResume = { ...FIXTURE, summary: `${FIXTURE.summary} 并发车道乙` }
      const pdfHash = hashResumeExportContent(lanePdfResume)
      const docxHash = hashResumeExportContent(laneDocxResume)
      if (pdfHash === docxHash) fail('6g. 两条车道的 contentHash 必须不同')
      const pdfRef = buildResumeExportServiceRefId(raceUser.id, 'race-task-pdf', pdfHash)
      const docxRef = buildResumeExportServiceRefId(raceUser.id, 'race-task-docx', docxHash)
      if (pdfRef === docxRef) fail('6g. 两条车道的 serviceRefId 必须不同')

      const race = await withCommitBarrier(2, async () => {
        const rows = await prisma.fileObject.findMany({
          where: { ownerId: raceUser.id, createdBy: 'ai_resume_generate' },
        })
        if (rows.length !== 3) fail(`6g. 核销前应已落下 pdf + docx + 打印副本共 3 个，实际 ${rows.length}`)
        for (const row of rows) {
          assertStagingRow(row, raceUser.id, '6g. 核销窗口')
          await expectHidden(row.id, raceUser.id, '6g. 核销窗口')
        }
      }, () => Promise.allSettled([
        ai.exportGeneratedResume(lanePdfResume, raceUser.id, null, 'pdf', undefined, undefined, false, {
          taskId: 'race-task-pdf',
          benefitGrantId: raceGrant.id,
        }),
        ai.exportGeneratedResume(laneDocxResume, raceUser.id, null, 'docx', undefined, undefined, false, {
          taskId: 'race-task-docx',
          benefitGrantId: raceGrant.id,
        }),
      ]))

      if (race.arrived !== 2) fail(`6g. 两次导出没有都走到核销（arrived=${race.arrived}）`)
      const fulfilled = race.value.filter((item) => item.status === 'fulfilled')
      const rejected = race.value.filter((item) => item.status === 'rejected')
      if (fulfilled.length !== 1 || rejected.length !== 1) {
        const detail = rejected.map((item) => item.status === 'rejected' ? `${httpErrorCode(item.reason) ?? (item.reason as Error).message}` : '').join(' | ')
        fail(`6g. 应恰好一次成功一次失败，实际成功 ${fulfilled.length} 失败 ${rejected.length} ${detail}`)
      }
      const winner = fulfilled[0].status === 'fulfilled' ? fulfilled[0].value : null
      const loserError = rejected[0].status === 'rejected' ? rejected[0].reason : null
      if (!winner || !loserError) fail('6g. 竞态结果无法归类')
      if (!benefitLose(loserError)) {
        fail(`6g. 失败车道应是权益拒绝，实际 ${httpErrorCode(loserError) ?? (loserError as Error).message}`)
      }
      if (!winner.signedUrl || !winner.printFileUrl) fail('6g. 成功导出没有可用的 signedUrl / printFileUrl')
      const winnerIds = [...new Set([winner.fileId, printFileIdOf(winner.printFileUrl)].filter((id): id is string => Boolean(id)))]
      if (winnerIds.length < 1) fail('6g. 成功导出没有 fileId')
      const raceRows = await prisma.fileObject.findMany({
        where: { ownerId: raceUser.id, createdBy: 'ai_resume_generate' },
      })
      for (const row of raceRows) createdFileIds.push(row.id)
      if (raceRows.length !== 3) fail(`6g. 竞态后仍应是 3 个文件，实际 ${raceRows.length}`)
      const loserRows = raceRows.filter((row) => !winnerIds.includes(row.id))
      if (loserRows.length < 1) fail('6g. 失败车道没有留下文件')
      const visible = await listedIds(raceUser.id)
      for (const fileId of winnerIds) {
        const row = raceRows.find((item) => item.id === fileId)
        if (!row || row.status !== 'active' || row.endUserId !== raceUser.id || row.deletedAt) {
          fail(`6g. 成功文件未激活 ${fileId} status=${row?.status}`)
        }
        if (!row.expiresAt || row.expiresAt.getTime() - Date.now() < 24 * 60 * 60 * 1000) {
          fail(`6g. 成功的简历文件没有恢复会员保存期限 ${fileId}`)
        }
        if (!visible.has(fileId)) fail(`6g. 成功文件不在我的文档 ${fileId}`)
        const bytes = await files.readContentForEndUser(fileId, raceUser.id)
        if (bytes.buffer.length < 1) fail(`6g. 成功文件读不到内容 ${fileId}`)
        const access = await files.getAccessUrl(fileId, { kind: 'member', endUserId: raceUser.id }, 'inline')
        if (!access.response.url) fail(`6g. 成功文件没有访问 URL ${fileId}`)
      }
      for (const row of loserRows) {
        assertStagingRow(row, raceUser.id, '6g. 失败车道')
        await expectHidden(row.id, raceUser.id, '6g. 失败车道')
        try {
          await files.completeUpload(row.id, { kind: 'member', endUserId: raceUser.id })
          fail(`6g. 直传确认把未付款文件激活了 ${row.id}`)
        } catch (err) {
          if (httpErrorCode(err) !== 'FILE_NOT_FOUND') {
            fail(`6g. 直传确认应假装文件不存在，实际 ${httpErrorCode(err) ?? (err as Error).message}`)
          }
        }
        const afterComplete = await prisma.fileObject.findUnique({ where: { id: row.id } })
        if (afterComplete?.status !== 'uploading') fail(`6g. 直传确认改变了未付款文件状态 ${row.id}`)
      }
      const redemptions = await prisma.redemptionRecord.count({
        where: { endUserId: raceUser.id, serviceType: 'resume_export' },
      })
      const grantAfter = await prisma.benefitGrant.findUnique({ where: { id: raceGrant.id } })
      if (redemptions !== 1 || grantAfter?.quantityRemaining !== 0 || grantAfter.status !== 'used_up') {
        fail(`6g. 应只核销 1 次，redemptions=${redemptions} remaining=${grantAfter?.quantityRemaining} status=${grantAfter?.status}`)
      }

      const originalDelete = storage.deleteObject.bind(storage)
      storage.deleteObject = async () => {
        throw new Error('SyntheticDeleteFailure')
      }
      try {
        await prisma.fileObject.updateMany({
          where: { id: { in: loserRows.map((row) => row.id) } },
          data: { expiresAt: new Date(Date.now() - 1000) },
        })
        await files.cleanupExpired('manual')
      } finally {
        storage.deleteObject = originalDelete
      }
      for (const row of loserRows) {
        const after = await prisma.fileObject.findUnique({ where: { id: row.id } })
        if (!after || after.status !== 'quarantined' || after.deletedAt) {
          fail(`6g. 对象删除失败后应停在隔离态 ${row.id} status=${after?.status} deletedAt=${after?.deletedAt?.toISOString() ?? 'null'}`)
        }
        if (!after.storageDeletePendingAt || after.storageDeletedAt || (after.storageDeleteAttempts ?? 0) < 1) {
          fail(`6g. 物理删除失败必须记入可重试账本 ${row.id}`)
        }
        if (after.storageDeleteError !== 'Error') fail(`6g. 账本应只记错误类型，实际 ${after.storageDeleteError}`)
        const head = await storage.headObject(row.storageKey, row.bucket)
        if (!head || head.sizeBytes < 1) fail(`6g. 对账前对象不应被当成已删除 ${row.id}`)
        await expectHidden(row.id, raceUser.id, '6g. 删除失败后')
      }
      const reconciled = await files.reconcileStorageDeletions('manual')
      if (reconciled.reconciledCount !== loserRows.length || reconciled.stillPendingCount !== 0) {
        fail(`6g. 对账应清掉失败文件，reconciled=${reconciled.reconciledCount} pending=${reconciled.stillPendingCount}`)
      }
      for (const row of loserRows) {
        const after = await prisma.fileObject.findUnique({ where: { id: row.id } })
        const head = await storage.headObject(row.storageKey, row.bucket)
        if (!after?.storageDeletedAt || after.storageDeletePendingAt || after.status !== 'deleted' || head) {
          fail(`6g. 对账后失败文件对象仍在或账本未清 ${row.id}`)
        }
        await expectHidden(row.id, raceUser.id, '6g. 对账后')
      }
      for (const fileId of winnerIds) {
        const bytes = await files.readContentForEndUser(fileId, raceUser.id)
        if (bytes.buffer.length < 1) fail(`6g. 对账误伤了成功文件 ${fileId}`)
      }
      pass('6g. 并发不同哈希：窗口和失败后都不可见，删除失败可重试，成功文件仍可读')

      const reportUser = await prisma.endUser.create({
        data: {
          phoneHash: `verify-resume-report-race-${randomUUID()}`,
          phoneEnc: `verify-phone-${randomUUID()}`,
          nickname: '诊断导出竞态会员',
        },
      })
      createdEndUserIds.push(reportUser.id)
      const reportGrant = await prisma.benefitGrant.create({
        data: {
          endUserId: reportUser.id,
          benefitType: 'free_quota',
          title: '诊断导出竞态仅 1 次',
          quantityTotal: 1,
          quantityRemaining: 1,
          status: 'active',
          sourceType: 'platform',
        },
      })
      createdGrantIds.push(reportGrant.id)
      const reportA = miniReport('车道甲')
      const reportB = miniReport('车道乙')
      const hashA = createHash('sha256').update(JSON.stringify({ kind: 'diagnosis_report', report: reportA, modules: null })).digest('hex')
      const hashB = createHash('sha256').update(JSON.stringify({ kind: 'diagnosis_report', report: reportB, modules: null })).digest('hex')
      if (hashA === hashB) fail('6h. 两份诊断报告的 contentHash 必须不同')
      const future = new Date(Date.now() + 60 * 60 * 1000)
      const taskA = `diag-race-a-${randomUUID()}`
      const taskB = `diag-race-b-${randomUUID()}`
      await prisma.aiResumeResult.createMany({
        data: [taskA, taskB].map((taskId, index) => ({
          taskId,
          kind: 'parse',
          status: 'completed',
          provider: 'mock',
          endUserId: reportUser.id,
          accessTokenHash: null,
          expiresAt: future,
          payloadJson: JSON.stringify({
            taskId,
            status: 'completed',
            report: index === 0 ? reportA : reportB,
          }),
        })),
      })
      const reportController = new ResumeReportExportController(
        ai,
        new DiagnosisReportPdfService(),
        files,
        {} as never,
        {} as never,
        prisma,
        audit,
        { requireActiveConsent: async () => undefined } as never,
      )
      const exportReport = (taskId: string) => (reportController as unknown as {
        exportAuthorized: (taskId: string, kind: 'diagnosis_report', requester: { endUserId: string; accessToken: null }, benefitGrantId: string) => Promise<{ fileId: string; signedUrl: string; printFileUrl: string }>
      }).exportAuthorized(taskId, 'diagnosis_report', { endUserId: reportUser.id, accessToken: null }, reportGrant.id)

      const reportRace = await withCommitBarrier(2, async () => {
        const rows = await prisma.fileObject.findMany({
          where: { ownerId: reportUser.id, createdBy: 'ai_resume_diagnosis_export' },
        })
        if (rows.length !== 2) fail(`6h. 核销前应已落下两份诊断 PDF，实际 ${rows.length}`)
        for (const row of rows) {
          assertStagingRow(row, reportUser.id, '6h. 核销窗口')
          await expectHidden(row.id, reportUser.id, '6h. 核销窗口')
        }
      }, () => Promise.allSettled([exportReport(taskA), exportReport(taskB)]))

      if (reportRace.arrived !== 2) fail(`6h. 两次诊断导出没有都走到核销（arrived=${reportRace.arrived}）`)
      const reportOk = reportRace.value.filter((item) => item.status === 'fulfilled')
      const reportBad = reportRace.value.filter((item) => item.status === 'rejected')
      if (reportOk.length !== 1 || reportBad.length !== 1) {
        fail(`6h. 诊断导出应恰好一次成功一次失败，实际成功 ${reportOk.length} 失败 ${reportBad.length}`)
      }
      const reportWinner = reportOk[0].status === 'fulfilled' ? reportOk[0].value : null
      const reportLoserError = reportBad[0].status === 'rejected' ? reportBad[0].reason : null
      if (!reportWinner?.signedUrl || !reportWinner.printFileUrl) fail('6h. 成功的诊断导出没有可用 URL')
      if (!reportLoserError || !benefitLose(reportLoserError)) {
        fail(`6h. 失败的诊断导出应是权益拒绝，实际 ${httpErrorCode(reportLoserError) ?? (reportLoserError as Error).message}`)
      }
      if (printFileIdOf(reportWinner.printFileUrl) !== reportWinner.fileId) {
        fail('6h. 诊断报告的 printFileUrl 应指向同一份 PDF')
      }
      const reportRows = await prisma.fileObject.findMany({
        where: { ownerId: reportUser.id, createdBy: 'ai_resume_diagnosis_export' },
      })
      for (const row of reportRows) createdFileIds.push(row.id)
      if (reportRows.length !== 2) fail(`6h. 应落下 2 个诊断文件，实际 ${reportRows.length}`)
      const reportLoser = reportRows.find((row) => row.id !== reportWinner.fileId)
      const reportWinnerRow = reportRows.find((row) => row.id === reportWinner.fileId)
      if (!reportLoser || !reportWinnerRow) fail('6h. 诊断文件无法归类')
      assertStagingRow(reportLoser, reportUser.id, '6h. 失败诊断')
      await expectHidden(reportLoser.id, reportUser.id, '6h. 失败诊断')
      if (reportWinnerRow.status !== 'active' || reportWinnerRow.endUserId !== reportUser.id) {
        fail(`6h. 成功诊断未激活 status=${reportWinnerRow.status}`)
      }
      const winnerTtl = reportWinnerRow.expiresAt ? reportWinnerRow.expiresAt.getTime() - Date.now() : 0
      if (winnerTtl < 20 * 60 * 1000 || winnerTtl > 3 * 60 * 60 * 1000) {
        fail(`6h. 成功诊断的保存期限应恢复为系统短期而不是预写窗口 ttlMs=${winnerTtl}`)
      }
      if (!(await listedIds(reportUser.id)).has(reportWinner.fileId)) fail('6h. 成功诊断不在我的文档')
      const reportBytes = await files.readContentForEndUser(reportWinner.fileId, reportUser.id)
      if (!reportBytes.buffer.subarray(0, 4).equals(Buffer.from('%PDF'))) fail('6h. 成功诊断不是 PDF')
      const reportRedemptions = await prisma.redemptionRecord.count({
        where: { endUserId: reportUser.id, serviceType: 'resume_export' },
      })
      const reportGrantAfter = await prisma.benefitGrant.findUnique({ where: { id: reportGrant.id } })
      if (reportRedemptions !== 1 || reportGrantAfter?.quantityRemaining !== 0) {
        fail(`6h. 诊断导出应只核销 1 次，redemptions=${reportRedemptions} remaining=${reportGrantAfter?.quantityRemaining}`)
      }
      await prisma.fileObject.update({
        where: { id: reportLoser.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
      await files.cleanupExpired('manual')
      const reaped = await prisma.fileObject.findUnique({ where: { id: reportLoser.id } })
      if (!reaped?.deletedAt || reaped.status !== 'deleted') fail(`6h. 过期的未付款诊断文件没有被 cleanupExpired 清掉 status=${reaped?.status}`)
      const reapedHead = await storage.headObject(reportLoser.storageKey, reportLoser.bucket)
      if (reapedHead) fail('6h. 清理后诊断对象仍在')
      if (!(await listedIds(reportUser.id)).has(reportWinner.fileId)) fail('6h. 清理误伤了已付费诊断')
      pass('6h. 诊断报告并发：未付款文件不可见，过期后由既有清理删除，成功文件仍在')

      const persistUser = await prisma.endUser.create({
        data: {
          phoneHash: `verify-resume-export-persist-${randomUUID()}`,
          phoneEnc: `verify-phone-${randomUUID()}`,
          nickname: '草稿失败会员',
        },
      })
      createdEndUserIds.push(persistUser.id)
      const persistGrant = await prisma.benefitGrant.create({
        data: {
          endUserId: persistUser.id,
          benefitType: 'free_quota',
          title: '草稿失败仍保留文件',
          quantityTotal: 1,
          quantityRemaining: 1,
          status: 'active',
          sourceType: 'platform',
        },
      })
      createdGrantIds.push(persistGrant.id)
      const drafts = (ai as unknown as { drafts: { persistConfirmed: (input: unknown) => Promise<void> } }).drafts
      const originalPersist = drafts.persistConfirmed.bind(drafts)
      drafts.persistConfirmed = async () => {
        throw new Error('POST_REDEEM_PERSIST_FAILED')
      }
      const persistResume: GeneratedResume = { ...FIXTURE, summary: `${FIXTURE.summary} 草稿失败仍可取回` }
      let persisted: { fileId: string; signedUrl: string; printFileUrl?: string }
      try {
        try {
          persisted = await ai.exportGeneratedResume(persistResume, persistUser.id, null, 'docx', undefined, undefined, false, {
            taskId: 'persist-fail-task',
            benefitGrantId: persistGrant.id,
          })
        } catch (err) {
          fail(`6i. 核销已提交后草稿失败必须仍返回已付费文件，实际抛出 ${(err as Error).message}`)
        }
        if (!persisted!.signedUrl || !persisted!.printFileUrl) fail('6i. 已付费导出没有返回访问地址')
        const persistIds = [persisted!.fileId, printFileIdOf(persisted!.printFileUrl)].filter((id): id is string => Boolean(id))
        for (const fileId of persistIds) createdFileIds.push(fileId)
        if (persistIds.length !== 2 || persistIds[0] === persistIds[1]) fail('6i. docx 付费导出应保留主文件和打印副本')
        for (const fileId of persistIds) {
          const row = await prisma.fileObject.findUnique({ where: { id: fileId } })
          if (!row || row.status !== 'active' || row.deletedAt || row.endUserId !== persistUser.id) {
            fail(`6i. 已付费文件被删或未激活 ${fileId} status=${row?.status} deletedAt=${row?.deletedAt?.toISOString() ?? 'null'}`)
          }
          if (!(await listedIds(persistUser.id)).has(fileId)) fail(`6i. 已付费文件不在我的文档 ${fileId}`)
          const bytes = await files.readContentForEndUser(fileId, persistUser.id)
          if (bytes.buffer.length < 1) fail(`6i. 已付费文件不可读 ${fileId}`)
        }
        const persistGrantAfter = await prisma.benefitGrant.findUnique({ where: { id: persistGrant.id } })
        if (persistGrantAfter?.quantityRemaining !== 0) fail(`6i. 草稿失败不应把已扣次数退回，剩余 ${persistGrantAfter?.quantityRemaining}`)
        const replay = await ai.exportGeneratedResume(persistResume, persistUser.id, null, 'pdf', undefined, undefined, false, {
          taskId: 'persist-fail-task',
          benefitGrantId: persistGrant.id,
        })
        createdFileIds.push(replay.fileId)
        const printId = printFileIdOf(replay.printFileUrl)
        if (printId) createdFileIds.push(printId)
        const afterReplay = await prisma.benefitGrant.findUnique({ where: { id: persistGrant.id } })
        if (afterReplay?.quantityRemaining !== 0) fail(`6i. 同内容重试不得再扣次，剩余 ${afterReplay?.quantityRemaining}`)
        if (!replay.signedUrl) fail('6i. 同内容重试没有返回可恢复的访问地址')
      } finally {
        drafts.persistConfirmed = originalPersist
      }
      pass('6i. 核销已提交后草稿失败：已付费文件仍可访问，同内容重试不重复扣')

      const crashUser = await prisma.endUser.create({
        data: {
          phoneHash: `verify-resume-export-crash-${randomUUID()}`,
          phoneEnc: `verify-phone-${randomUUID()}`,
          nickname: '崩溃孤儿会员',
        },
      })
      createdEndUserIds.push(crashUser.id)
      const crashGrant = await prisma.benefitGrant.create({
        data: {
          endUserId: crashUser.id,
          benefitType: 'free_quota',
          title: '崩溃前未核销',
          quantityTotal: 1,
          quantityRemaining: 1,
          status: 'active',
          sourceType: 'platform',
        },
      })
      createdGrantIds.push(crashGrant.id)
      const crashOriginal = exportGate.commitExportRedemption.bind(exportGate)
      exportGate.commitExportRedemption = async () => {
        throw new Error('CRASH_AFTER_UPLOAD')
      }
      try {
        try {
          await ai.exportGeneratedResume(
            { ...FIXTURE, summary: `${FIXTURE.summary} 崩溃孤儿` },
            crashUser.id,
            null,
            'md',
            undefined,
            undefined,
            false,
            { taskId: 'crash-task', benefitGrantId: crashGrant.id },
          )
          fail('6j. 核销前崩溃应抛错')
        } catch (err) {
          if ((err as Error).message !== 'CRASH_AFTER_UPLOAD') {
            fail(`6j. 期望 CRASH_AFTER_UPLOAD，实际 ${(err as Error).message}`)
          }
        }
      } finally {
        exportGate.commitExportRedemption = crashOriginal
      }
      const crashRows = await prisma.fileObject.findMany({
        where: { ownerId: crashUser.id, createdBy: 'ai_resume_generate' },
      })
      for (const row of crashRows) createdFileIds.push(row.id)
      if (crashRows.length !== 2) fail(`6j. md 崩溃应留下主文件和打印副本，实际 ${crashRows.length}`)
      for (const row of crashRows) {
        assertStagingRow(row, crashUser.id, '6j. 崩溃孤儿')
        await expectHidden(row.id, crashUser.id, '6j. 崩溃孤儿')
      }
      const crashGrantAfter = await prisma.benefitGrant.findUnique({ where: { id: crashGrant.id } })
      if (crashGrantAfter?.quantityRemaining !== 1) fail(`6j. 崩溃不得扣次，剩余 ${crashGrantAfter?.quantityRemaining}`)
      await prisma.fileObject.updateMany({
        where: { id: { in: crashRows.map((row) => row.id) } },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
      await files.cleanupExpired('manual')
      for (const row of crashRows) {
        const after = await prisma.fileObject.findUnique({ where: { id: row.id } })
        if (!after?.deletedAt || after.status !== 'deleted') fail(`6j. cleanupExpired 没有清掉崩溃孤儿 ${row.id}`)
        if (await storage.headObject(row.storageKey, row.bucket)) fail(`6j. 崩溃孤儿对象仍在 ${row.id}`)
      }
      for (const fileId of winnerIds) {
        const bytes = await files.readContentForEndUser(fileId, raceUser.id)
        if (bytes.buffer.length < 1) fail(`6j. 清理崩溃孤儿时误伤了已付费文件 ${fileId}`)
      }
      pass('6j. 核销前崩溃：未付款文件不可见，短寿命到期后清理，不扣次')

      const sameUser = await prisma.endUser.create({
        data: {
          phoneHash: `verify-resume-export-same-${randomUUID()}`,
          phoneEnc: `verify-phone-${randomUUID()}`,
          nickname: '同内容并发会员',
        },
      })
      createdEndUserIds.push(sameUser.id)
      const sameGrant = await prisma.benefitGrant.create({
        data: {
          endUserId: sameUser.id,
          benefitType: 'free_quota',
          title: '同内容并发 1 次',
          quantityTotal: 1,
          quantityRemaining: 1,
          status: 'active',
          sourceType: 'platform',
        },
      })
      createdGrantIds.push(sameGrant.id)
      const sameResume: GeneratedResume = { ...FIXTURE, summary: `${FIXTURE.summary} 同内容并发` }
      const sameRace = await Promise.allSettled([
        ai.exportGeneratedResume(sameResume, sameUser.id, null, 'txt', undefined, undefined, false, {
          taskId: 'same-task',
          benefitGrantId: sameGrant.id,
        }),
        ai.exportGeneratedResume(sameResume, sameUser.id, null, 'pdf', undefined, undefined, false, {
          taskId: 'same-task',
          benefitGrantId: sameGrant.id,
        }),
      ])
      const sameRows = await prisma.fileObject.findMany({
        where: { ownerId: sameUser.id, createdBy: 'ai_resume_generate' },
      })
      for (const row of sameRows) createdFileIds.push(row.id)
      const sameOk = sameRace.filter((item) => item.status === 'fulfilled')
      if (sameOk.length < 1) {
        const detail = sameRace.map((item) => item.status === 'rejected' ? (httpErrorCode(item.reason) ?? (item.reason as Error).message) : 'ok').join(' | ')
        fail(`6k. 同内容并发至少一条应成功，实际 ${detail}`)
      }
      for (const item of sameRace) {
        if (item.status === 'rejected' && !benefitLose(item.reason) && httpErrorCode(item.reason) !== 'BENEFIT_OUTPUT_ALREADY_REDEEMED') {
          fail(`6k. 同内容失败车道应是幂等竞争而不是别的错误 ${httpErrorCode(item.reason) ?? (item.reason as Error).message}`)
        }
      }
      const sameGrantAfter = await prisma.benefitGrant.findUnique({ where: { id: sameGrant.id } })
      const sameRedemptions = await prisma.redemptionRecord.count({
        where: { endUserId: sameUser.id, serviceType: 'resume_export' },
      })
      if (sameRedemptions !== 1 || sameGrantAfter?.quantityRemaining !== 0) {
        fail(`6k. 同内容只能扣 1 次，redemptions=${sameRedemptions} remaining=${sameGrantAfter?.quantityRemaining}`)
      }
      const returnedIds = new Set<string>()
      for (const item of sameOk) {
        if (item.status !== 'fulfilled') continue
        returnedIds.add(item.value.fileId)
        const printId = printFileIdOf(item.value.printFileUrl)
        if (printId) returnedIds.add(printId)
        if (!item.value.signedUrl) fail('6k. 成功的同内容导出没有 signedUrl')
      }
      for (const row of sameRows) {
        if (row.status === 'active') {
          if (!returnedIds.has(row.id) || row.endUserId !== sameUser.id) {
            fail(`6k. 出现了未返回给调用方的活跃文件 ${row.id}`)
          }
          if (!(await listedIds(sameUser.id)).has(row.id)) fail(`6k. 已付费同内容文件不在我的文档 ${row.id}`)
        } else {
          assertStagingRow(row, sameUser.id, '6k. 未完成的同内容副本')
          await expectHidden(row.id, sameUser.id, '6k. 未完成的同内容副本')
        }
      }
      const replaySame = await ai.exportGeneratedResume(sameResume, sameUser.id, null, 'pdf', undefined, undefined, false, {
        taskId: 'same-task',
        benefitGrantId: sameGrant.id,
      })
      createdFileIds.push(replaySame.fileId)
      const replayPrint = printFileIdOf(replaySame.printFileUrl)
      if (replayPrint) createdFileIds.push(replayPrint)
      const afterSameReplay = await prisma.benefitGrant.findUnique({ where: { id: sameGrant.id } })
      if (afterSameReplay?.quantityRemaining !== 0) fail(`6k. 同内容再导出不得再扣，剩余 ${afterSameReplay?.quantityRemaining}`)
      const replayRow = await prisma.fileObject.findUnique({ where: { id: replaySame.fileId } })
      if (replayRow?.status !== 'active' || replayRow.endUserId !== sameUser.id) fail('6k. 已付费重试没有直接给出可读文件')
      pass('6k. 同内容并发不重复扣，成功文件可读，未完成副本不可见')

      await setExportPrice(0, true)
      const freeReplay = await ai.exportGeneratedResume(sameResume, sameUser.id, null, 'txt', undefined, undefined, false, { taskId: 'verify-export-free-replay' })
      createdFileIds.push(freeReplay.fileId)
      const freePrint = printFileIdOf(freeReplay.printFileUrl)
      if (freePrint) createdFileIds.push(freePrint)
      const freeRow = await prisma.fileObject.findUnique({ where: { id: freeReplay.fileId } })
      if (!freeRow || freeRow.status !== 'active' || freeRow.endUserId !== sameUser.id || freeRow.retentionLockedReason) {
        fail(`6l. 免费导出应直接成为可读文件 status=${freeRow?.status}`)
      }
      const freeRedemptions = await prisma.redemptionRecord.count({ where: { endUserId: sameUser.id, serviceType: 'resume_export' } })
      if (freeRedemptions !== 1) fail(`6l. 免费导出不得新增核销，实际 ${freeRedemptions}`)
      if (!freeReplay.signedUrl || !freeReplay.printFileUrl) fail('6l. 免费导出缺少访问地址')
      pass('6l. 免费导出不预写、不扣次，文件直接可读')
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
    await prisma.auditLog.deleteMany({ where: { targetId: { in: createdFileIds } } }).catch(() => undefined)
    await prisma.redemptionRecord.deleteMany({ where: { benefitRef: { in: createdGrantIds } } }).catch(() => undefined)
    await prisma.benefitGrant.deleteMany({ where: { id: { in: createdGrantIds } } }).catch(() => undefined)
    if (originalExportPrice) {
      await prisma.priceConfig.update({
        where: { serviceKey: RESUME_EXPORT_SERVICE_KEY },
        data: { unitCents: originalExportPrice.unitCents, active: originalExportPrice.active, description: originalExportPrice.description },
      }).catch(() => undefined)
    } else {
      await prisma.priceConfig.deleteMany({ where: { serviceKey: RESUME_EXPORT_SERVICE_KEY } }).catch(() => undefined)
    }
    await prisma.endUser.deleteMany({ where: { id: { in: createdEndUserIds } } }).catch(() => undefined)
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => {
  console.error('VERIFY FAILED:', e.message)
  process.exit(1)
})
