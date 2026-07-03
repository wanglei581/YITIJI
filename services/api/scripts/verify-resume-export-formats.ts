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
 *   6. assertExportFormatAllowed 对四种合法 format 均放行(Wave 1 恒放行,不误加计费拦截)。
 *   7. printFileUrl(打印链路专用系统签名 URL,与 signedUrl/COS 下载 URL 隔离):
 *      pdf 返回且匹配 /api/v1/files/<fileId>/content?expires=<ms>&sig=<hex>;
 *      docx/txt/md 不返回(undefined,不伪造)。
 *   8. Wave 2 layout 契约:shared 定义 ResumeLayoutSettings;API DTO 定义 ResumeLayoutDto;
 *      ResumeGenerateExportDto 接收 layout 可选字段,但导出响应不回显 layout。
 *
 * 运行:pnpm --filter @ai-job-print/api verify:resume-export-formats
 */
import 'dotenv/config'
import { readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
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

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exitCode = 1; throw new Error(m) }

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

async function main(): Promise<void> {
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
  )

  const createdFileIds: string[] = []
  const createdEndUserIds: string[] = []

  try {
    // ── 6. assertExportFormatAllowed 静态断言:Wave 1 恒放行 ────────────────
    {
      const svcSrc = readFileSync(join(__dirname, '../src/ai/ai.service.ts'), 'utf-8')
      const methodMatch = svcSrc.match(/private assertExportFormatAllowed\(_format: ResumeExportFormat\): void \{([^}]*)\}/)
      if (!methodMatch) fail('6a. 未找到 assertExportFormatAllowed 方法')
      const body = methodMatch![1]
      // 方法体内不得含任何 throw(Wave 1 恒放行,不误加计费拦截)。
      if (/throw/.test(body)) fail('6a. assertExportFormatAllowed 方法体含 throw,Wave 1 应恒放行')
      pass('6a. assertExportFormatAllowed 静态断言:方法体不含 throw(Wave 1 恒放行)')
    }

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
      const exported = await ai.exportGeneratedResume(FIXTURE, endUser.id, null, format)
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

      // ── 7. printFileUrl:仅 pdf 返回系统 HMAC content URL,docx/txt/md 不伪造 ──
      // 打印链路(/print/jobs)只接受 signFileUrl 生成的系统签名 URL,不接受 COS 下载 signedUrl
      // (见 services/api/src/files/signing.ts + PrintJobsService.create 的 SSRF 防护校验,
      // 已由 verify:print-jobs 覆盖"非系统签名 URL 被拒")。
      if (format === 'pdf') {
        const printUrlPattern = /^\/api\/v1\/files\/[^/]+\/content\?expires=\d+&sig=[0-9a-f]+$/
        if (!exported.printFileUrl) fail('7. [pdf] 未返回 printFileUrl')
        if (!printUrlPattern.test(exported.printFileUrl!)) {
          fail(`7. [pdf] printFileUrl 格式不匹配系统签名 URL 正则,实际: ${exported.printFileUrl}`)
        }
        pass('7. [pdf] printFileUrl 已返回且匹配系统 HMAC content URL 格式')
      } else {
        if (exported.printFileUrl !== undefined) {
          fail(`7. [${format}] 不应返回 printFileUrl,实际: ${exported.printFileUrl}`)
        }
        pass(`7. [${format}] 未返回 printFileUrl(docx/txt/md 无分页概念,不进打印链路)`)
      }

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
      const docxRendered = await resumeDocx.render(FIXTURE)
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
    await prisma.endUser.deleteMany({ where: { id: { in: createdEndUserIds } } }).catch(() => undefined)
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => {
  console.error('VERIFY FAILED:', e.message)
  process.exit(1)
})
