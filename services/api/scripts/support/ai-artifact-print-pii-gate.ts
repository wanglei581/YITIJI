/**
 * 商用收口 P0-5 第一批（2026-09-28）：生产隐私闸门开着时，AI 生成的打印稿不得被拒单。
 *
 * 生产强制 PRINT_REQUIRE_PII_SCAN=true（src/config/production-runtime-gates.ts）。建单闸门
 * （src/print-jobs/pii-scan-gate.ts）对用途在 PII_SCAN_REQUIRED_PURPOSES 里、资产类别不是
 * derived / optimized 的文件，要求已完成的隐私检查；隐私检查任务只由一体机的材料检查创建。
 * 下面 6 处服务端生成 PDF 时用途是 print_doc，旧代码没传资产类别（默认 original），
 * 前端又直达报价确认页、从不经过材料检查 —— 生产上点「确认」就被拒。
 * 建单服务的注释写明 AI 生成的报告本意就是放行（它们是派生产物，不是用户手里的原件）。
 *
 * 本模块由 verify-print-jobs.ts 调用，分三段：
 *   1. 静态：用 TypeScript 语法树（不是正则）取出这 6 处 files.upload({...}) 的实参，
 *      断言用途仍是 print_doc、资产类别是 derived。
 *   2. 静态扫描：服务端源码里凡是「用途字面量落在闸门清单里、却没标派生」的上传，一律报出 ——
 *      防第 7 处 AI 产物再掉进同一个坑。用户本人原件的上传（扫描、手机传、U 盘、一体机上传）
 *      用途都是运行时变量，不会被这里误伤。
 *   3. 运行时：用第 1 段从源码里取出来的实参，经真实 FilesService.upload 建 FileObject，
 *      在 PRINT_REQUIRE_PII_SCAN=true 下经真实 PrintJobsService.create 建单 —— 必须成功。
 *      阳性对照：一份没做隐私检查的 print_doc 原件，同样条件下必须被拒、错误码
 *      PRINT_PII_SCAN_REQUIRED —— 证明这一段里闸门确实开着，前面的「成功」不是空转。
 *
 * 第 3 段用的是源码里的实参，所以哪一处删掉 assetCategory，运行时就会真的被拒单，
 * 不只是静态断言变红。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import ts from 'typescript'
import type { FilesService } from '../../src/files/files.service'
import type { FileAssetCategory, FilePurpose } from '../../src/files/file.types'
import { signFileUrl } from '../../src/files/signing'
import { PII_SCAN_REQUIRED_PURPOSES } from '../../src/print-jobs/pii-scan-gate'
import type { PrintJobsService } from '../../src/print-jobs/print-jobs.service'
import type { PrismaService } from '../../src/prisma/prisma.service'

/** 6 处 AI 生成打印稿的上传点。createdBy 用来在同一方法里认准是哪一次上传。 */
export const AI_ARTIFACT_PRINT_UPLOAD_SITES = [
  { label: '岗位匹配报告', file: 'src/ai/resume/job-fit.service.ts', method: 'printReport', createdBy: 'job_fit' },
  { label: '职业规划', file: 'src/ai/resume/career-plan.service.ts', method: 'printPlan', createdBy: 'career_plan' },
  { label: '模拟面试报告', file: 'src/mock-interview/mock-interview.service.ts', method: 'printReport', createdBy: 'mock_interview_report' },
  { label: '模拟面试题目单', file: 'src/mock-interview/mock-interview.service.ts', method: 'printPracticeSheet', createdBy: 'mock_interview_practice_sheet' },
  { label: '小青作业', file: 'src/advisor/advisor-artifact.service.ts', method: 'print', createdBy: 'advisor_work' },
  { label: '参会准备单', file: 'src/ai/resume/fair-visit-plan.service.ts', method: 'printPlan', createdBy: 'fair_visit_plan' },
] as const

type UploadSite = (typeof AI_ARTIFACT_PRINT_UPLOAD_SITES)[number]

const DERIVED_CATEGORIES = new Set(['derived', 'optimized'])

interface UploadCall {
  file: string
  line: number
  method: string | null
  /** 实参对象里写成字符串字面量的字段；变量、带插值的模板串、展开一律不收。 */
  literals: Map<string, string>
  hasSpread: boolean
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name)) return name.text
  return null
}

/** 取出一个源文件里所有 `<…>files.upload({ … })` 调用，记下所在方法与字面量实参。 */
function collectUploadCalls(apiRoot: string, file: string): UploadCall[] {
  const text = readFileSync(join(apiRoot, file), 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const calls: UploadCall[] = []
  const visit = (node: ts.Node, method: string | null): void => {
    const current = ts.isMethodDeclaration(node) ? (propertyNameText(node.name) ?? method) : method
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'upload'
      && /(?:^|\.)files(?:Service)?$/.test(node.expression.expression.getText(source))
    ) {
      const arg = node.arguments[0]
      if (arg && ts.isObjectLiteralExpression(arg)) {
        const literals = new Map<string, string>()
        let hasSpread = false
        for (const property of arg.properties) {
          if (ts.isSpreadAssignment(property)) {
            hasSpread = true
            continue
          }
          if (!ts.isPropertyAssignment(property)) continue
          const name = propertyNameText(property.name)
          const init = property.initializer
          if (name && (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init))) literals.set(name, init.text)
        }
        calls.push({
          file,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          method: current,
          literals,
          hasSpread,
        })
      }
    }
    ts.forEachChild(node, (child) => visit(child, current))
  }
  visit(source, null)
  return calls
}

function listSourceFiles(apiRoot: string, dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(apiRoot, dir))) {
    const rel = join(dir, entry)
    if (entry === '__tests__' || entry === 'generated' || entry === 'node_modules') continue
    if (statSync(join(apiRoot, rel)).isDirectory()) out.push(...listSourceFiles(apiRoot, rel))
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !/\.(?:spec|test)\.ts$/.test(entry)) out.push(rel)
  }
  return out
}

export interface SiteUploadArgs {
  site: UploadSite
  line: number
  purpose: string | undefined
  assetCategory: string | undefined
  createdBy: string
  mimeType: string | undefined
}

/** 第 1 段：从源码里认出这 6 处上传；认不准（缺失或同一方法里不止一处）直接算失败。 */
export function readAiArtifactUploadArgs(apiRoot: string, problems: string[]): SiteUploadArgs[] {
  const found: SiteUploadArgs[] = []
  for (const site of AI_ARTIFACT_PRINT_UPLOAD_SITES) {
    if (!existsSync(join(apiRoot, site.file))) {
      problems.push(`${site.label}：源文件不存在 ${site.file}`)
      continue
    }
    const matches = collectUploadCalls(apiRoot, site.file)
      .filter((call) => call.method === site.method && call.literals.get('createdBy') === site.createdBy)
    if (matches.length !== 1) {
      problems.push(`${site.label}：在 ${site.file} 的 ${site.method}() 里应恰好找到 1 处 createdBy='${site.createdBy}' 的 files.upload，实际 ${matches.length} 处`)
      continue
    }
    const call = matches[0]!
    found.push({
      site,
      line: call.line,
      purpose: call.literals.get('purpose'),
      assetCategory: call.literals.get('assetCategory'),
      createdBy: site.createdBy,
      mimeType: call.literals.get('mimeType'),
    })
  }
  return found
}

/**
 * 第 2 段：用途字面量在闸门清单里、却没标派生的服务端上传。
 * 这类上传要么是 AI / 服务端生成物（必须标 derived 或 optimized），要么是用户本人原件
 * —— 后者不该在服务端写死用途，应当由材料检查把关。两种都不能悄悄以 original 落库。
 */
export function findUnmarkedGeneratedPrintUploads(apiRoot: string): string[] {
  const offenders: string[] = []
  for (const file of listSourceFiles(apiRoot, 'src')) {
    for (const call of collectUploadCalls(apiRoot, file)) {
      const purpose = call.literals.get('purpose')
      if (!purpose || !PII_SCAN_REQUIRED_PURPOSES.has(purpose)) continue
      const category = call.literals.get('assetCategory')
      if (category && DERIVED_CATEGORIES.has(category)) continue
      offenders.push(
        `${call.file}:${call.line}（${call.method ?? '顶层'}()，purpose='${purpose}'，assetCategory=${category ? `'${category}'` : '未传，默认 original'}${call.hasSpread ? '，另有展开实参' : ''}）`,
      )
    }
  }
  return offenders
}

interface RegressionContext {
  apiRoot: string
  prisma: PrismaService
  files: FilesService
  printJobs: PrintJobsService
  terminalId: string
  pdfBytes: Buffer
  trackFile: (fileId: string, storageKey: string) => void
  trackTask: (taskId: string) => void
  pass: (message: string) => void
  fail: (message: string) => never
}

function errorCodeOf(error: unknown): string {
  const ex = error as { getResponse?: () => unknown; response?: unknown; message?: string }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code ?? ex.message ?? String(error)
}

export async function verifyAiArtifactPrintPiiGate(ctx: RegressionContext): Promise<void> {
  const problems: string[] = []

  // ── 1. 这 6 处上传的实参（从源码取）──
  const sites = readAiArtifactUploadArgs(ctx.apiRoot, problems)
  for (const args of sites) {
    const where = `${args.site.file}:${args.line}`
    if (args.purpose !== 'print_doc') {
      problems.push(`${args.site.label}（${where}）：用途应仍是 print_doc（只补资产类别，不改用途），实际 ${String(args.purpose)}`)
    } else if (args.assetCategory !== 'derived') {
      problems.push(`${args.site.label}（${where}）：AI 生成的打印稿必须带 assetCategory: 'derived'，实际 ${args.assetCategory ? `'${args.assetCategory}'` : '未传（默认 original）'}`)
    } else {
      ctx.pass(`P0-5a. ${args.site.label}（${where}）上传带 assetCategory: 'derived'，用途仍是 print_doc`)
    }
  }

  // ── 2. 防第 7 处 ──
  const offenders = findUnmarkedGeneratedPrintUploads(ctx.apiRoot)
  if (offenders.length === 0) {
    ctx.pass('P0-5b. 服务端源码里没有「用途字面量受隐私闸门管、却没标派生」的上传')
  } else {
    problems.push(`服务端生成物以隐私闸门管的用途上传却没标派生（生产上会被拒单）：\n      ${offenders.join('\n      ')}`)
  }

  // ── 3. 生产开关下真实建单 ──
  const previous = process.env['PRINT_REQUIRE_PII_SCAN']
  process.env['PRINT_REQUIRE_PII_SCAN'] = 'true'
  try {
    const uploadFixture = async (args: {
      filename: string
      purpose: FilePurpose
      assetCategory?: FileAssetCategory
      createdBy: string
      mimeType?: string
    }) => {
      const uploaded = await ctx.files.upload({
        buffer: ctx.pdfBytes,
        filename: args.filename,
        mimeType: args.mimeType ?? 'application/pdf',
        purpose: args.purpose,
        ...(args.assetCategory ? { assetCategory: args.assetCategory } : {}),
        uploaderId: null,
        endUserId: null,
        createdBy: args.createdBy,
      })
      const record = await ctx.prisma.fileObject.findUnique({
        where: { id: uploaded.fileId },
        select: { storageKey: true, assetCategory: true, purpose: true },
      })
      if (!record) ctx.fail(`P0-5 夹具：FilesService.upload 返回 ${uploaded.fileId}，库里却没有这条 FileObject`)
      ctx.trackFile(uploaded.fileId, record.storageKey)
      return { fileId: uploaded.fileId, record }
    }
    const tryCreate = async (fileId: string, fileName: string): Promise<{ ok: true } | { ok: false; code: string }> => {
      try {
        const created = await ctx.printJobs.create(
          { fileUrl: signFileUrl(fileId, 30 * 60 * 1000).url, fileName },
          { ipAddress: '127.0.0.1', userAgent: 'verify-p05', endUserId: null, terminalId: ctx.terminalId },
        )
        ctx.trackTask(created.taskId)
        return { ok: true }
      } catch (error) {
        return { ok: false, code: errorCodeOf(error) }
      }
    }

    // 阳性对照：同一条件下，没做隐私检查的 print_doc 原件必须被拒。
    const control = await uploadFixture({ filename: 'p05-original-control.pdf', purpose: 'print_doc', createdBy: 'verify_p05_original_control' })
    if (control.record.assetCategory !== 'original') {
      problems.push(`阳性对照夹具的资产类别应为 original，实际 ${control.record.assetCategory}（对照失效）`)
    }
    const controlResult = await tryCreate(control.fileId, 'p05-original-control.pdf')
    if (!controlResult.ok && controlResult.code === 'PRINT_PII_SCAN_REQUIRED') {
      ctx.pass('P0-5c. 阳性对照：PRINT_REQUIRE_PII_SCAN=true 下，未做隐私检查的 print_doc 原件建单被拒 PRINT_PII_SCAN_REQUIRED')
    } else {
      problems.push(`阳性对照：未做隐私检查的 print_doc 原件应被拒 PRINT_PII_SCAN_REQUIRED，实际 ${controlResult.ok ? '建单成功（闸门没开，本段的「成功」都不作数）' : controlResult.code}`)
    }

    // 6 类 AI 产物：按源码里的上传实参建文件，同一条件下建单必须成功。
    for (const args of sites) {
      const artifact = await uploadFixture({
        filename: `p05-${args.createdBy}.pdf`,
        purpose: (args.purpose ?? 'print_doc') as FilePurpose,
        assetCategory: args.assetCategory as FileAssetCategory | undefined,
        createdBy: args.createdBy,
        mimeType: args.mimeType,
      })
      const result = await tryCreate(artifact.fileId, `p05-${args.createdBy}.pdf`)
      if (result.ok) {
        ctx.pass(`P0-5d. ${args.site.label}：按源码上传实参建的文件（${artifact.record.purpose} · ${artifact.record.assetCategory}），生产开关下建单成功`)
      } else {
        problems.push(`${args.site.label}：按源码上传实参建的文件（${artifact.record.purpose} · ${artifact.record.assetCategory}），生产开关下建单被拒 ${result.code}`)
      }
    }
  } finally {
    if (previous === undefined) delete process.env['PRINT_REQUIRE_PII_SCAN']
    else process.env['PRINT_REQUIRE_PII_SCAN'] = previous
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`  FAIL P0-5 ${problem}`)
    ctx.fail(`P0-5 生产隐私闸门 × AI 产物打印：${problems.length} 项未满足（见上）`)
  }
}
