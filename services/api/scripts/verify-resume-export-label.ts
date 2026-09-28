/**
 * verify:resume-export-label — C8 简历导出显式标识与「不带标识」申请（标识办法第四条、第九条）
 *
 * 守五件事，全部真渲染后按页抽文字断言（CJK 不在 PDF 原始字节里，不能按字节搜）：
 *   1. 默认（两个开关都没设）：AI 简历 PDF / DOCX / TXT / MD 都不印标识 —— 与合入前逐字一致；
 *   2. RESUME_EXPORT_VISIBLE_LABEL=true：PDF 每一页、DOCX 页脚、TXT / MD 末尾都有标识，
 *      一页的简历加页脚后仍是一页；原样草稿永不印；不带标识选项没开时 unlabeled 无效；
 *   3. 两个开关都开 + unlabeled：不印显式标识，但隐式 AIGC 元数据照旧；
 *   4. 准入：匿名、草稿、没同意正式协议的会员一律不放行；放行时先写 writeRequired 留痕，
 *      actorId 为空、会员 ID 在 payload；留痕写失败则整个请求失败（不导出）；
 *   5. 控制器把「准入后的结果」而不是请求原值交给导出服务，且准入在导出之前。
 *
 * 不触网、不碰 DB（准入用桩）。依赖系统 CJK 字体（CI 已装 fonts-noto-cjk）。
 * 运行：pnpm --filter @ai-job-print/api verify:resume-export-label
 */
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'
import { ResumePdfService } from '../src/ai/resume/resume-pdf.service'
import { ResumeDocxService } from '../src/ai/resume/resume-docx.service'
import { ResumeTextService } from '../src/ai/resume/resume-text.service'
import { decideUnlabeledExport, prepareUnlabeledExport } from '../src/ai/resume/resume-unlabeled-export'
import {
  AIGC_VISIBLE_FOOTER,
  parseAigcLabelJson,
  readPdfInfo,
  resumeExportShowsVisibleLabel,
  resumeUnlabeledOptionEnabled,
} from '../src/common/pdf/aigc-label'
import { openUnpdfDocument } from '../src/common/pdf/pdfjs-document'

const unpdf = createRequire(__filename)('unpdf') as {
  extractText: (pdf: unknown, options: { mergePages: boolean }) => Promise<{ text: string | string[] }>
}

let failed = 0
function pass(id: string) { console.log(`  ASSERT ${id} PASS`) }
function fail(id: string, detail: string) {
  failed += 1
  console.error(`  ASSERT ${id} FAIL ${detail}`)
}
function check(id: string, ok: boolean, detail: string) { if (ok) pass(id); else fail(id, detail) }

const LABEL = AIGC_VISIBLE_FOOTER.replace(/\s+/gu, '')
const squash = (value: string) => value.replace(/\s+/gu, '')

async function pages(buffer: Buffer): Promise<string[]> {
  const doc = await openUnpdfDocument(new Uint8Array(buffer))
  const extracted = await unpdf.extractText(doc, { mergePages: false })
  return (Array.isArray(extracted.text) ? extracted.text : [extracted.text]).map(squash)
}

async function docxParts(buffer: Buffer): Promise<{ footers: string; body: string; aigcProduceId: string | null }> {
  const docxRequire = createRequire(require.resolve('docx'))
  const JSZip = docxRequire('jszip') as {
    loadAsync: (buf: Buffer) => Promise<{ files: Record<string, unknown>; file: (name: string) => { async: (type: 'string') => Promise<string> } | null }>
  }
  const zip = await JSZip.loadAsync(buffer)
  const read = async (name: string) => (await zip.file(name)?.async('string')) ?? ''
  const footerNames = Object.keys(zip.files).filter((name) => /^word\/footer\d*\.xml$/u.test(name))
  const footers = (await Promise.all(footerNames.map(read))).join('\n')
  const customXml = await read('docProps/custom.xml')
  const match = customXml.match(/name="AIGC"[\s\S]*?<vt:lpwstr>([\s\S]*?)<\/vt:lpwstr>/)
  const decoded = (match?.[1] ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  return { footers, body: await read('word/document.xml'), aigcProduceId: parseAigcLabelJson(decoded)?.ProduceID ?? null }
}

function setSwitches(visible: boolean | undefined, unlabeledOption: boolean | undefined) {
  if (visible === undefined) delete process.env['RESUME_EXPORT_VISIBLE_LABEL']
  else process.env['RESUME_EXPORT_VISIBLE_LABEL'] = String(visible)
  if (unlabeledOption === undefined) delete process.env['RESUME_EXPORT_UNLABELED_OPTION']
  else process.env['RESUME_EXPORT_UNLABELED_OPTION'] = String(unlabeledOption)
}

const SHORT = {
  basic: { name: '示例', phone: '', email: '', city: '' },
  intention: { position: '后端开发' },
  summary: '熟悉服务端开发，做过两个校园项目。',
  education: [], experience: [], projects: [], skills: [], certificates: [],
}
const LONG = {
  ...SHORT,
  experience: Array.from({ length: 14 }, (_, index) => ({
    company: `示例公司${index + 1}`,
    role: '后端开发实习生',
    period: '2025.07 - 2025.09',
    description: '负责接口开发与联调，编写单元测试，整理上线文档，配合测试同事复现并修复缺陷。'.repeat(3),
  })),
}

async function renderChecks(): Promise<void> {
  const pdf = new ResumePdfService()
  const docx = new ResumeDocxService()
  const text = new ResumeTextService()

  // 1. 默认：什么都不印
  setSwitches(undefined, undefined)
  check('default:helper', !resumeExportShowsVisibleLabel({}), '两个开关都没设时判定成了要印')
  const defaultPdf = await pdf.render(LONG as never, { contentId: 'task-default' })
  check('default:pdf', (await pages(defaultPdf.buffer)).every((page) => !page.includes(LABEL)), '默认配置下简历 PDF 印了标识（应与合入前一致）')
  const defaultDocx = await docxParts((await docx.render(SHORT as never, { contentId: 'task-default-docx' })).buffer)
  check('default:docx', !defaultDocx.footers.includes(AIGC_VISIBLE_FOOTER) && !defaultDocx.body.includes(AIGC_VISIBLE_FOOTER), '默认配置下简历 DOCX 印了标识')
  check('default:txt-md', !text.renderTxt(SHORT as never).includes(AIGC_VISIBLE_FOOTER) && !text.renderMarkdown(SHORT as never).includes(AIGC_VISIBLE_FOOTER), '默认 TXT / MD 出现了标识')

  // 2. 页脚标识开：每页都有、单页不变两页、草稿不印、选项没开时 unlabeled 无效
  setSwitches(true, undefined)
  const shortPdf = await pdf.render(SHORT as never, { contentId: 'task-short' })
  const shortPages = await pages(shortPdf.buffer)
  check('visible:single-page', shortPdf.pageCount === 1 && shortPages.length === 1, `加页脚后一页简历变成了 ${shortPages.length} 页`)
  check('visible:single-page-label', shortPages[0]?.includes(LABEL) === true, '一页简历没有页脚标识')
  const longPdf = await pdf.render(LONG as never, { contentId: 'task-long' })
  const longPages = await pages(longPdf.buffer)
  const missing = longPages.map((page, index) => (page.includes(LABEL) ? 0 : index + 1)).filter(Boolean)
  check('visible:every-page', longPages.length >= 2 && missing.length === 0, longPages.length < 2 ? `多页夹具只渲染出 ${longPages.length} 页` : `第 ${missing.join('、')} 页缺页脚标识`)
  const draftPdf = await pdf.render(LONG as never, { draft: true })
  const draftInfo = await readPdfInfo(draftPdf.buffer)
  check('visible:draft', (await pages(draftPdf.buffer)).every((page) => !page.includes(LABEL)) && draftInfo['AIGenerated'] === 'false', '原样草稿被印了 AI 标识')
  const ignoredPdf = await pdf.render(SHORT as never, { contentId: 'task-ignored', unlabeled: true })
  check('visible:unlabeled-ignored-pdf', (await pages(ignoredPdf.buffer))[0]?.includes(LABEL) === true, '不带标识选项没开，unlabeled 却去掉了 PDF 页脚')
  const visibleDocx = await docxParts((await docx.render(SHORT as never, { contentId: 'task-visible-docx', unlabeled: true })).buffer)
  check('visible:docx', visibleDocx.footers.includes(AIGC_VISIBLE_FOOTER), 'DOCX 页脚没有标识（或选项没开时 unlabeled 生效了）')
  const draftDocx = await docxParts((await docx.render(SHORT as never, { draft: true })).buffer)
  check('visible:docx-draft', !draftDocx.footers.includes(AIGC_VISIBLE_FOOTER), '原样草稿 DOCX 被印了 AI 标识')
  check('visible:txt-md', text.renderTxt(SHORT as never, { visibleLabel: true }).endsWith(AIGC_VISIBLE_FOOTER) && text.renderMarkdown(SHORT as never, { visibleLabel: true }).includes(AIGC_VISIBLE_FOOTER), 'TXT / MD 末尾没有标识')

  // 3. 两个开关都开 + unlabeled：显式标识去掉，隐式元数据保留
  setSwitches(true, true)
  const unlabeledPdf = await pdf.render(SHORT as never, { contentId: 'task-unlabeled', unlabeled: true })
  const unlabeledInfo = parseAigcLabelJson((await readPdfInfo(unlabeledPdf.buffer))['AIGC'] ?? '')
  check('unlabeled:pdf', (await pages(unlabeledPdf.buffer)).every((page) => !page.includes(LABEL)), '申请不带标识后 PDF 仍有页脚')
  check('unlabeled:pdf-implicit', unlabeledInfo?.ProduceID === 'task-unlabeled', '去掉显式标识时把隐式 AIGC 元数据也去掉了')
  const unlabeledDocx = await docxParts((await docx.render(SHORT as never, { contentId: 'task-unlabeled-docx', unlabeled: true })).buffer)
  check('unlabeled:docx', !unlabeledDocx.footers.includes(AIGC_VISIBLE_FOOTER) && unlabeledDocx.aigcProduceId === 'task-unlabeled-docx', 'DOCX 去标识不对（页脚仍在或隐式标识丢了）')
  const notRequested = await pdf.render(SHORT as never, { contentId: 'task-not-requested' })
  check('unlabeled:not-requested', (await pages(notRequested.buffer))[0]?.includes(LABEL) === true, '没申请去标识也被去掉了')

  // 4. 选项开、页脚标识关：选项不生效
  setSwitches(undefined, true)
  check('option-needs-visible', !resumeUnlabeledOptionEnabled(), '页脚标识没开时不带标识选项不应生效')
}

type ConsentRow = { termsVersion: string; termsDocVersionId: string | null } | null
function consentPrisma(row: ConsentRow) {
  return { memberLegalConsent: { findFirst: async () => row } } as never
}

async function admissionChecks(): Promise<void> {
  const accepted: ConsentRow = { termsVersion: 'v1.0', termsDocVersionId: 'doc-terms-1' }
  setSwitches(true, false)
  check('admit:option-off', (await decideUnlabeledExport(consentPrisma(accepted), { requested: true, draft: false, endUserId: 'm1' })).applied === false, '选项关时放行了')
  setSwitches(true, true)
  const reasonOf = async (row: ConsentRow, input: { requested: boolean; draft: boolean; endUserId: string | null }) => {
    const decision = await decideUnlabeledExport(consentPrisma(row), input)
    return decision.applied ? 'applied' : decision.reason
  }
  check('admit:not-requested', (await reasonOf(accepted, { requested: false, draft: false, endUserId: 'm1' })) === 'not_requested', '没申请也被判成放行')
  check('admit:draft', (await reasonOf(accepted, { requested: true, draft: true, endUserId: 'm1' })) === 'draft', '草稿不应走去标识')
  check('admit:anonymous', (await reasonOf(accepted, { requested: true, draft: false, endUserId: null })) === 'anonymous', '匿名导出放行了（没有提供对象可记）')
  check('admit:no-consent', (await reasonOf(null, { requested: true, draft: false, endUserId: 'm1' })) === 'terms_not_accepted', '没有协议同意记录却放行了')
  check('admit:draft-terms', (await reasonOf({ termsVersion: 'draft', termsDocVersionId: null }, { requested: true, draft: false, endUserId: 'm1' })) === 'terms_not_accepted', '只同意过草稿兜底协议却放行了')
  check('admit:applied', (await reasonOf(accepted, { requested: true, draft: false, endUserId: 'm1' })) === 'applied', '已同意正式协议的会员没放行')

  const calls: Array<{ actorId: string | null; action: string; payload?: Record<string, unknown> }> = []
  const audit = { writeRequired: async (_tx: unknown, args: { actorId: string | null; action: string; payload?: Record<string, unknown> }) => { calls.push(args); return 'audit-ref-1' } }
  const meta = { ipAddress: null, userAgent: null, requestId: null }
  const input = { requested: true, draft: false, endUserId: 'm1', taskId: 'task-1', format: 'pdf' }
  const plan = await prepareUnlabeledExport({ prisma: consentPrisma(accepted), audit: audit as never }, input, meta)
  const first = calls[0]
  check('trace:written', plan.applied && calls.length === 1 && first?.action === 'resume.export_unlabeled_requested', '放行时没有先写留痕')
  check('trace:actor', first?.actorId === null && first?.payload?.['endUserId'] === 'm1' && first?.payload?.['termsDocVersionId'] === 'doc-terms-1', 'actorId 必须为空（外键指向运营账号），会员 ID 与协议版本放 payload')
  check('trace:linked', plan.auditPayload['unlabeledRequestRef'] === 'audit-ref-1', '导出审计没有关联到留痕记录')
  const failingAudit = { writeRequired: async () => { throw new Error('db down') } }
  let rejected = false
  await prepareUnlabeledExport({ prisma: consentPrisma(accepted), audit: failingAudit as never }, input, meta).catch(() => { rejected = true })
  check('trace:required', rejected, '留痕写失败时仍然放行了去标识导出')
  calls.length = 0
  const denied = await prepareUnlabeledExport({ prisma: consentPrisma(accepted), audit: audit as never }, { ...input, endUserId: null }, meta)
  check('trace:denied', !denied.applied && calls.length === 0 && denied.auditPayload['unlabeledDeniedReason'] === 'anonymous', '拒绝时应只在导出审计里记原因，不写留痕')
}

function staticChecks(): void {
  const controller = readFileSync(join(__dirname, '../src/ai/ai.controller.ts'), 'utf8')
  const handlerStart = controller.indexOf("@Post('resume/generate/export')")
  const handler = controller.slice(handlerStart, controller.indexOf('@Post(', handlerStart + 10))
  const prepareAt = handler.indexOf('prepareUnlabeledExport(')
  const exportAt = handler.indexOf('this.aiService.exportGeneratedResume(')
  check('controller:order', prepareAt > 0 && exportAt > prepareAt, '准入与留痕必须在导出之前')
  check('controller:applied-only', handler.includes('unlabeled: unlabeledPlan.applied') && !/unlabeled:\s*unlabeled\b/u.test(handler) && !handler.includes('unlabeled: unlabeled ==='), '交给导出服务的必须是准入后的结果，不是请求原值')
  check('controller:actor', !/actorId:\s*(requester\.endUserId|unlabeled)/u.test(handler), '导出审计的 actorId 不能填会员 ID（外键指向运营账号，写入会被静默吞掉）')
  const service = readFileSync(join(__dirname, '../src/ai/ai.service.ts'), 'utf8')
  check('service:txt-md', service.includes('renderTxt(resume, { visibleLabel })') && service.includes('renderMarkdown(resume, { visibleLabel })'), 'TXT / MD 导出没有按同一判定加标识')
}

void (async () => {
  const saved = [process.env['RESUME_EXPORT_VISIBLE_LABEL'], process.env['RESUME_EXPORT_UNLABELED_OPTION']] as const
  try {
    await renderChecks()
    await admissionChecks()
    staticChecks()
  } catch (error) {
    fail('runtime', error instanceof Error ? error.message : String(error))
  } finally {
    setSwitches(saved[0] === undefined ? undefined : saved[0] === 'true', saved[1] === undefined ? undefined : saved[1] === 'true')
  }
  console.log(failed === 0 ? '\n简历导出显式标识：PASS' : `\n简历导出显式标识：${failed} FAIL`)
  process.exit(failed === 0 ? 0 : 1)
})()
