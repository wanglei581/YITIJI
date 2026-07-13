/**
 * 岗位匹配决策报告打印 — RED/回归门禁。
 *
 * 约束：报告只由服务端 PDF 生成并以内部 HMAC printFileUrl 进入既有打印确认链路；
 * 不返回对象存储 signedUrl，不改价格或 paid-before-claim。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:job-fit-print
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'

type Reporter = { pass: (message: string) => void; fail: (message: string) => void }

const root = process.cwd()
let passed = 0
let failed = 0
const pass = (message: string) => { passed += 1; console.log(`  PASS ${message}`) }
const fail = (message: string) => { failed += 1; console.error(`  FAIL ${message}`) }

function source(relativePath: string, label: string): string | null {
  const path = join(root, relativePath)
  if (!existsSync(path)) {
    fail(`${label} 缺失：${relativePath}`)
    return null
  }
  return readFileSync(path, 'utf8')
}

function requireAll(text: string | null, snippets: string[], label: string): boolean {
  if (!text) return false
  const missing = snippets.filter((snippet) => !text.includes(snippet))
  if (missing.length > 0) {
    fail(`${label} 缺少：${missing.join('；')}`)
    return false
  }
  pass(label)
  return true
}

function between(text: string, start: number, end: number): string {
  return text.slice(start, end >= 0 ? end : text.length)
}

function staticChecks(reporter: Reporter): boolean {
  const controller = source('src/ai/job-fit.controller.ts', 'JobFitController')
  const service = source('src/ai/resume/job-fit.service.ts', 'JobFitService')
  const pdf = source('src/ai/resume/job-fit-pdf.service.ts', 'JobFitPdfService')
  let complete = true

  const printRoute = controller?.indexOf("@Post(':taskId/print')") ?? -1
  const latestRoute = controller?.indexOf("@Get(':taskId')") ?? -1
  if (printRoute < 0 || latestRoute < 0 || printRoute > latestRoute) {
    reporter.fail('POST /resume/job-fit/:taskId/print 必须存在且位于 GET :taskId 前，避免被参数路由吞掉')
    complete = false
  } else {
    reporter.pass('打印路由存在且先于 GET :taskId')
  }
  const controllerPrint = controller && printRoute >= 0 ? between(controller, printRoute, latestRoute) : null
  complete = requireAll(controllerPrint, ['this.service.printReport(taskId, await this.requesterOf(req))'], '打印路由沿用 Bearer/x-resume requesterOf 归属') && complete

  complete = requireAll(service, [
    "import { FilesService } from '../../files/files.service'",
    "import { signFileUrl } from '../../files/signing'",
    "import { JobFitPdfService } from './job-fit-pdf.service'",
    'private readonly files: FilesService',
    'private readonly pdf: JobFitPdfService',
    'async printReport(taskId: string, requester: JobFitRequester)',
    'await this.authorizeParseForJobFit(taskId, requester)',
    "kind: 'job_fit'",
    "code: 'JOB_FIT_NOT_FOUND'",
    "purpose: 'print_doc'",
    "createdBy: 'job_fit'",
    "action: 'resume.job_fit_print'",
    'printFileUrl: signFileUrl(uploaded.fileId).url',
  ], 'JobFitService 报告生成、归属、文件与审计契约') && complete

  const printMethodStart = service?.indexOf('async printReport(taskId: string, requester: JobFitRequester)') ?? -1
  const printMethod = service && printMethodStart >= 0 ? service.slice(printMethodStart) : null
  if (!printMethod) {
    reporter.fail('printReport 方法缺失，不能验证输出 URL 契约')
    complete = false
  } else {
    const banned = ['signedUrl:', 'signedUrlExpiresAt:', 'getDownloadUrl(', 'storage.get']
    const leaked = banned.filter((item) => printMethod.includes(item))
    if (leaked.length > 0) {
      reporter.fail(`printReport 不得返回或构造对象存储直链：${leaked.join('；')}`)
      complete = false
    } else {
      reporter.pass('printReport 不返回 signedUrl 或对象存储直链')
    }
    if (!printMethod.includes('decisionSupport')) {
      reporter.fail('printReport 必须显式处理缺少 decisionSupport 的旧 job_fit 缓存，不能伪造决策字段')
      complete = false
    } else {
      reporter.pass('printReport 显式兼容旧缓存缺 decisionSupport')
    }
  }

  const commerceBoundary = [
    'PrintJobsService',
    'PrintJobService',
    'PrintJobsModule',
    'PriceConfig',
    'OrderService',
    'OrderModule',
    'PaymentService',
    'PaymentModule',
    'paid-before-claim',
    'paidBeforeClaim',
  ]
  const commerceLeaks = [
    ['JobFitController', controller],
    ['JobFitService', service],
  ].flatMap(([label, text]) => commerceBoundary
    .filter((term) => typeof text === 'string' && text.includes(term))
    .map((term) => `${label}.${term}`))
  if (commerceLeaks.length > 0) {
    reporter.fail(`岗位匹配打印不得直连 PrintJobs/价格/订单/支付/paid-before-claim：${commerceLeaks.join('；')}`)
    complete = false
  } else {
    reporter.pass('岗位匹配只生成 printFileUrl；价格、订单、支付与 paid-before-claim 留在既有 /print/confirm')
  }

  complete = requireAll(pdf, [
    'class JobFitPdfService',
    'new PDFDocument',
    'async render(',
    '岗位匹配决策报告',
    '仅供本人参考',
    '不构成任何就业、薪资或录用承诺',
  ], '真实 PDF 的标题、免责声明与渲染器') && complete
  return complete
}

async function runtimeChecks(): Promise<void> {
  // 静态门禁全部满足后才加载新模块；在 RED 阶段不能把“文件尚未创建”伪装成运行时模块错误。
  process.env['FILE_SIGNING_SECRET'] = process.env['FILE_SIGNING_SECRET'] || 'job-fit-print-runtime-secret-at-least-32-bytes'
  const { JobFitPdfService } = await import(join(root, 'src/ai/resume/job-fit-pdf.service.ts')) as {
    JobFitPdfService: new () => {
      render: (meta: unknown, payload: unknown) => Promise<{ buffer: Buffer; pageCount: number }>
    }
  }
  const { JobFitService } = await import(join(root, 'src/ai/resume/job-fit.service.ts')) as {
    JobFitService: new (...args: unknown[]) => {
      printReport: (taskId: string, requester: { endUserId: string | null; accessToken: string | null }) => Promise<Record<string, unknown>>
    }
  }

  const legacyPayload = {
    fitLevel: 'reference_medium',
    summary: '报告仅基于现有材料提供岗位匹配参考。',
    matchPoints: [{ point: '具备行政事务经验', evidence: '负责档案管理' }],
    gapPoints: [{ gap: '缺少跨部门协调案例', suggestion: '补充真实协作经历' }],
    targetedSuggestions: ['补充真实项目中的协作职责'],
    // 注意：故意不带 decisionSupport，覆盖旧缓存的诚实降级路径。
  }
  const pdf = new JobFitPdfService()
  const rendered = await pdf.render(
    {
      date: '2026-07-12',
      job: { id: 'job_runtime', title: '行政专员', company: '示例企业', sourceName: '示例来源', sourceUrl: 'https://example.com/job', externalId: 'runtime' },
      decisionSupport: undefined,
    },
    legacyPayload,
  )
  if (!Buffer.isBuffer(rendered.buffer) || rendered.buffer.slice(0, 4).toString() !== '%PDF' || rendered.pageCount < 1) {
    throw new Error('真实 PDF render 必须返回 %PDF 字节与正页数')
  }
  pass('真实 JobFitPdfService 可渲染旧缓存（无 decisionSupport）为 PDF')

  const now = new Date(Date.now() + 60_000)
  const uploaded: Array<Record<string, unknown>> = []
  const audits: Array<Record<string, unknown>> = []
  const runtimeAccessToken = 'unused-by-runtime-fake'
  const parse = {
    endUserId: null,
    accessTokenHash: createHash('sha256').update(runtimeAccessToken, 'utf8').digest('hex'),
    expiresAt: now,
    jobAiConsentVersion: null,
    jobAiConsentGrantedAt: null,
    jobAiConsentRevokedAt: null,
  }
  const result = {
    expiresAt: now,
    updatedAt: new Date('2026-07-12T00:00:00.000Z'),
    payloadJson: JSON.stringify({
      job: { id: 'job_runtime', title: '行政专员', company: '示例企业', sourceName: '示例来源', sourceUrl: 'https://example.com/job', externalId: 'runtime' },
      payload: legacyPayload,
      providerName: 'llm:runtime',
    }),
  }
  const prisma = {
    aiResumeResult: {
      findUnique: async ({ where }: { where: { taskId_kind: { kind: string } } }) => where.taskId_kind.kind === 'parse' ? parse : result,
    },
  }
  const files = {
    upload: async (args: Record<string, unknown>) => {
      uploaded.push(args)
      return {
        fileId: 'job_fit_print_runtime',
        filename: String(args.filename),
        sizeBytes: (args.buffer as Buffer).length,
        signedUrl: 'https://storage.example.invalid/never-return-this',
        signedUrlExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      }
    },
  }
  const audit = { write: async (entry: Record<string, unknown>) => { audits.push(entry) } }
  const service = new JobFitService(prisma, {} as never, {} as never, files, pdf, audit)
  const printed = await service.printReport('job_fit_runtime_task', { endUserId: null, accessToken: runtimeAccessToken })
  const expectedKeys = ['fileId', 'filename', 'pageCount', 'printFileUrl', 'sizeBytes']
  if (JSON.stringify(Object.keys(printed).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error(`打印响应必须严格只含 ${expectedKeys.join(', ')}，实际为 ${Object.keys(printed).sort().join(', ')}`)
  }
  if (!/^\/api\/v1\/files\/job_fit_print_runtime\/content\?expires=\d+&sig=[0-9a-f]{64}$/.test(String(printed.printFileUrl))) {
    throw new Error(`printFileUrl 必须是内部 HMAC URL，实际为 ${String(printed.printFileUrl)}`)
  }
  const upload = uploaded[0] ?? {}
  if (upload.purpose !== 'print_doc' || upload.createdBy !== 'job_fit' || upload.mimeType !== 'application/pdf') {
    throw new Error('报告上传必须使用 purpose=print_doc、createdBy=job_fit 与 application/pdf')
  }
  const record = audits[0] ?? {}
  if (record.action !== 'resume.job_fit_print' || record.targetId !== 'job_fit_runtime_task') {
    throw new Error('打印审计必须记录 resume.job_fit_print 与 taskId')
  }
  if (JSON.stringify(record.payload ?? {}).includes(legacyPayload.summary) || JSON.stringify(record.payload ?? {}).includes('负责档案管理')) {
    throw new Error('打印审计 payload 不得记录岗位匹配正文或简历证据')
  }
  pass('内存 fake：严格响应、内部 HMAC URL、print_doc/job_fit 上传与安全审计')
}

async function main() {
  const staticComplete = staticChecks({ pass, fail })
  if (staticComplete && failed === 0) {
    try {
      await runtimeChecks()
    } catch (error) {
      fail(`运行时打印契约：${error instanceof Error ? error.message : String(error)}`)
    }
  } else {
    console.error('  INFO 当前为 RED：跳过运行时加载，避免将缺失实现误报为模块错误')
  }

  if (failed > 0) {
    console.error(`\nverify:job-fit-print RED — ${failed} 个门禁尚未满足（${passed} 个已满足）`)
    process.exitCode = 1
    return
  }
  console.log(`\nverify:job-fit-print passed — ${passed} checks`)
}

main().catch((error) => {
  console.error('verify:job-fit-print 环境/脚本错误', error)
  process.exitCode = 1
})
