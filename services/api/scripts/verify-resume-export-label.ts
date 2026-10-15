/**
 * verify:resume-export-label — C8 简历导出显式标识与「不带标识」申请（标识办法第四条、第九条）
 *
 * 守这些事，渲染项全部真渲染后按页抽文字断言（CJK 不在 PDF 原始字节里，不能按字节搜）：
 *   1. 默认（两个开关都没设）：AI 简历 PDF / DOCX / TXT / MD 都不印标识 —— 与合入前逐字一致；
 *      代码缺省仍是「没配环境变量就不印」。样例 .env.example 按 2026-10-06 拍板写成默认印。
 *   2. RESUME_EXPORT_VISIBLE_LABEL=true：PDF 每一页、DOCX 页脚、TXT / MD 末尾都有标识，
 *      一页的简历加页脚后仍是一页；原样草稿永不印；不带标识选项没开时 unlabeled 无效；
 *   3. 两个开关都开 + unlabeled：不印显式标识，但隐式 AIGC 元数据照旧；
 *   4. 准入：匿名、草稿、没同意**当前生效**正式协议的会员一律不放行；TXT / MD 申请不印
 *      一律 format_not_eligible，照印、不报错；放行时先写 writeRequired 留痕，actorId 为空、
 *      会员 ID 在 payload；留痕写失败则整个请求失败（不导出）；
 *   5. 控制器把「准入后的结果」而不是请求原值交给导出服务，准入在导出之前，
 *      去标识时最终导出审计也必须写成功；导出响应带回印没印和没放行的原因；
 *   6. 走真实 AiService.exportGeneratedResume：docx / txt 主文件与另渲染的打印用 PDF 副本
 *      在「带标识」「去标识」两档下一致（副本最容易漏）；
 *   7. 价格接口 unlabeledOptionAvailable 只看两个开关，四种组合；
 *   8. 两条审计 payload 带 terminalCode（有终端身份为该编号，无为 null），且不含手机号；
 *   9. 审计保留：标识办法第九条要求留存不少于六个月（方案 04b 第 5 节）。
 *      静态扫描 services/api/src 与 services/worker。现在没有任何代码删除或更新 AuditLog。
 *      以后若有人加清理，同一文件必须点名排除 resume.export_unlabeled_requested 与
 *      resume.generate_exported，并写出不少于 180 天的保留常量，否则本门禁变红。
 *
 * 不触网。第 1–5、7–9 项不碰 DB（准入用桩）；第 6 项用本地 SQLite 与本地文件存储，结束即清理。
 * 依赖系统 CJK 字体（CI 已装 fonts-noto-cjk）。
 * 运行：pnpm --filter @ai-job-print/api verify:resume-export-label
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { join } from 'path'
import { Logger } from '@nestjs/common'
import { AiService } from '../src/ai/ai.service'
import { MockAiProvider } from '../src/ai/providers/mock.provider'
import { AuditService } from '../src/audit/audit.service'
import { FilesService } from '../src/files/files.service'
import { parseContentFileId } from '../src/files/signing'
import { StorageService } from '../src/storage/storage.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { ResumePdfService } from '../src/ai/resume/resume-pdf.service'
import { ResumeDocxService } from '../src/ai/resume/resume-docx.service'
import { ResumeTextService } from '../src/ai/resume/resume-text.service'
import { decideUnlabeledExport, lookupExportTerminalCode, prepareUnlabeledExport, publicDeniedReason, visibleLabelForDecision, type UnlabeledExportPublicDeniedReason } from '../src/ai/resume/resume-unlabeled-export'
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
function consentPrisma(row: ConsentRow, activeTermsId: string | null = 'doc-terms-1') {
  return {
    memberLegalConsent: { findFirst: async () => row },
    legalDocVersion: { findFirst: async () => (activeTermsId ? { id: activeTermsId } : null) },
  } as never
}

async function admissionChecks(): Promise<void> {
  const accepted: ConsentRow = { termsVersion: 'v1.0', termsDocVersionId: 'doc-terms-1' }
  const eligible = { requested: true, draft: false, endUserId: 'm1', format: 'pdf' }
  setSwitches(true, false)
  const optionOff = await decideUnlabeledExport(consentPrisma(accepted), eligible)
  check('admit:option-off', optionOff.applied === false && optionOff.reason === 'option_off', '选项关时放行了')
  check('response:option-off', publicDeniedReason(optionOff) === 'option_off' && visibleLabelForDecision(false, optionOff) === true, '选项关、页脚开：应照印，原因 option_off')
  const txtWhileOff = await decideUnlabeledExport(consentPrisma(accepted), { ...eligible, format: 'txt' })
  check('admit:format-after-option', !txtWhileOff.applied && txtWhileOff.reason === 'option_off', '选项关时格式不该盖过 option_off')

  setSwitches(undefined, undefined)
  const switchesOff = await decideUnlabeledExport(consentPrisma(accepted), eligible)
  check(
    'response:switches-off',
    !switchesOff.applied && publicDeniedReason(switchesOff) === 'option_off' && visibleLabelForDecision(false, switchesOff) === false,
    '两个开关都关时申请不印：原因应是 option_off，且这一份不印',
  )

  setSwitches(true, true)
  const reasonOf = async (row: ConsentRow, input: { requested: boolean; draft: boolean; endUserId: string | null; format: string }) => {
    const decision = await decideUnlabeledExport(consentPrisma(row), input)
    return decision.applied ? 'applied' : decision.reason
  }
  check('admit:not-requested', (await reasonOf(accepted, { ...eligible, requested: false })) === 'not_requested', '没申请也被判成放行')
  const notRequested = await decideUnlabeledExport(consentPrisma(accepted), { ...eligible, requested: false })
  check('response:not-requested', publicDeniedReason(notRequested) === null && visibleLabelForDecision(false, notRequested) === true, '没申请时原因必须是 null，且页脚开着就照印')
  check('admit:draft', (await reasonOf(accepted, { ...eligible, draft: true })) === 'draft', '草稿不应走去标识')
  const draftDecision = await decideUnlabeledExport(consentPrisma(accepted), { ...eligible, draft: true })
  check('response:draft', publicDeniedReason(draftDecision) === 'draft' && visibleLabelForDecision(true, draftDecision) === false, '草稿申请不印：原因 draft，且草稿本来就不印')
  check('admit:anonymous', (await reasonOf(accepted, { ...eligible, endUserId: null })) === 'anonymous', '匿名导出放行了（没有提供对象可记）')
  const anonymous = await decideUnlabeledExport(consentPrisma(accepted), { ...eligible, endUserId: null })
  check('response:anonymous', publicDeniedReason(anonymous) === 'anonymous' && visibleLabelForDecision(false, anonymous) === true, '匿名未放行应照印，原因 anonymous')
  check('admit:no-consent', (await reasonOf(null, eligible)) === 'terms_not_accepted', '没有协议同意记录却放行了')
  const noConsent = await decideUnlabeledExport(consentPrisma(null), eligible)
  check('response:terms-not-accepted', publicDeniedReason(noConsent) === 'terms_not_accepted' && visibleLabelForDecision(false, noConsent) === true, '没同意协议应照印')
  check('admit:draft-terms', (await reasonOf({ termsVersion: 'draft', termsDocVersionId: null }, eligible)) === 'terms_not_accepted', '只同意过草稿兜底协议却放行了')
  const outdated = await decideUnlabeledExport(consentPrisma(accepted, 'doc-terms-2'), eligible)
  check('admit:terms-outdated', !outdated.applied && outdated.reason === 'terms_outdated', '协议已改版、会员还没同意新版却放行了')
  check('response:terms-outdated', publicDeniedReason(outdated) === 'terms_outdated' && visibleLabelForDecision(false, outdated) === true, '协议过期应照印')
  const noActive = await decideUnlabeledExport(consentPrisma(accepted, null), eligible)
  check('admit:no-active-terms', !noActive.applied && noActive.reason === 'terms_outdated', '当前没有生效协议却放行了')
  check('admit:applied', (await reasonOf(accepted, eligible)) === 'applied', '已同意正式协议的会员没放行')
  const applied = await decideUnlabeledExport(consentPrisma(accepted), eligible)
  check('response:applied', applied.applied && publicDeniedReason(applied) === null && visibleLabelForDecision(false, applied) === false, '放行后不印显式标识，原因是 null')
  check('admit:docx', (await reasonOf(accepted, { ...eligible, format: 'docx' })) === 'applied', 'Word（docx）应可以申请不印')

  const text = new ResumeTextService()
  for (const format of ['txt', 'md'] as const) {
    const decision = await decideUnlabeledExport(consentPrisma(accepted), { ...eligible, format })
    const visible = visibleLabelForDecision(false, decision)
    check(`admit:${format}`, !decision.applied && decision.reason === 'format_not_eligible', `${format} 申请不印被放行了`)
    check(`response:${format}`, publicDeniedReason(decision) === 'format_not_eligible' && visible === true, `${format} 应照印，原因 format_not_eligible`)
    const body = format === 'txt'
      ? text.renderTxt(SHORT as never, { visibleLabel: visible })
      : text.renderMarkdown(SHORT as never, { visibleLabel: visible })
    check(`response:${format}-printed`, body.includes(AIGC_VISIBLE_FOOTER), `${format} 未放行时正文没有显式标识`)
  }

  const calls: Array<{ actorId: string | null; action: string; payload?: Record<string, unknown> }> = []
  const audit = { writeRequired: async (_tx: unknown, args: { actorId: string | null; action: string; payload?: Record<string, unknown> }) => { calls.push(args); return 'audit-ref-1' } }
  const meta = { ipAddress: null, userAgent: 'kiosk Mozilla/5.0; phone 13800138000', requestId: null }
  const input = { requested: true, draft: false, endUserId: 'm1', taskId: 'task-1', format: 'pdf', terminalCode: ' KSK-001 ' }
  const plan = await prepareUnlabeledExport({ prisma: consentPrisma(accepted), audit: audit as never }, input, meta)
  const first = calls[0]
  check('trace:written', plan.applied && calls.length === 1 && first?.action === 'resume.export_unlabeled_requested', '放行时没有先写留痕')
  check('trace:actor', first?.actorId === null && first?.payload?.['endUserId'] === 'm1' && first?.payload?.['termsDocVersionId'] === 'doc-terms-1', 'actorId 必须为空（外键指向运营账号），会员 ID 与协议版本放 payload')
  const payloadKeys = Object.keys(first?.payload ?? {}).sort().join(',')
  check('trace:keys', payloadKeys === ['endUserId', 'format', 'taskId', 'terminalCode', 'termsDocVersionId', 'termsVersion'].join(','), `留痕 payload 键不对：${payloadKeys}`)
  check('trace:terminal', first?.payload?.['terminalCode'] === 'KSK-001' && plan.terminalCode === 'KSK-001' && plan.auditPayload['terminalCode'] === 'KSK-001', '放行留痕的 terminalCode 应为去掉空白后的终端编号')
  const payloadJson = JSON.stringify(first?.payload ?? {})
  check('trace:no-phone', !payloadJson.includes('13800138000') && !payloadJson.toLowerCase().includes('phone'), '留痕 payload 含了手机号')
  check('trace:linked', plan.auditPayload['unlabeledRequestRef'] === 'audit-ref-1', '导出审计没有关联到留痕记录')
  check('response:plan-applied', plan.visibleLabelApplied === false && plan.unlabeledDeniedReason === null, '放行计划应是不印、原因为 null')
  const failingAudit = { writeRequired: async () => { throw new Error('db down') } }
  let rejected = false
  await prepareUnlabeledExport({ prisma: consentPrisma(accepted), audit: failingAudit as never }, input, meta).catch(() => { rejected = true })
  check('trace:required', rejected, '留痕写失败时仍然放行了去标识导出')
  calls.length = 0
  const denied = await prepareUnlabeledExport({ prisma: consentPrisma(accepted), audit: audit as never }, { ...input, endUserId: null }, meta)
  const deniedKeys = Object.keys(denied.auditPayload).sort().join(',')
  check('trace:denied', !denied.applied && calls.length === 0 && denied.auditPayload['unlabeledDeniedReason'] === 'anonymous', '拒绝时应只在导出审计里记原因，不写留痕')
  check(
    'trace:denied-keys',
    deniedKeys === ['terminalCode', 'unlabeledApplied', 'unlabeledDeniedReason', 'unlabeledRequested'].join(',')
      && denied.auditPayload['terminalCode'] === 'KSK-001'
      && denied.visibleLabelApplied === true
      && denied.unlabeledDeniedReason === 'anonymous',
    `拒绝审计字段不对：${deniedKeys}`,
  )
  const quietBefore = calls.length
  const notRequestedPlan = await prepareUnlabeledExport(
    { prisma: consentPrisma(accepted), audit: audit as never },
    { ...input, requested: false, terminalCode: null },
    meta,
  )
  const notRequestedKeys = Object.keys(notRequestedPlan.auditPayload).sort().join(',')
  check(
    'trace:not-requested',
    calls.length === quietBefore
      && notRequestedKeys === 'terminalCode'
      && notRequestedPlan.auditPayload['terminalCode'] === null
      && notRequestedPlan.unlabeledDeniedReason === null
      && notRequestedPlan.visibleLabelApplied === true,
    `没申请时导出审计应只有 terminalCode：${notRequestedKeys}`,
  )
  const blankCode = await prepareUnlabeledExport(
    { prisma: consentPrisma(accepted), audit: audit as never },
    { ...input, terminalCode: '   ' },
    { ipAddress: null, userAgent: null, requestId: null },
  )
  check('trace:blank-terminal', blankCode.applied && blankCode.terminalCode === null && calls.at(-1)?.payload?.['terminalCode'] === null, '空白终端编号应记成 null，且仍然放行')

  const lookups: Array<{ where: unknown; select: unknown }> = []
  const found = await lookupExportTerminalCode({
    terminal: {
      findUnique: async (args: { where: unknown; select: unknown }) => {
        lookups.push(args)
        return { terminalCode: ' KSK-009 ' }
      },
    },
  } as never, 'term-1')
  check('lookup:code', found === 'KSK-009', `查到的终端编号应为去掉空白后的值，实际 ${String(found)}`)
  check('lookup:select', lookups.length === 1 && JSON.stringify(lookups[0]) === JSON.stringify({ where: { id: 'term-1' }, select: { terminalCode: true } }), `查询应只 select terminalCode，实际 ${JSON.stringify(lookups[0])}`)
  const missing = await lookupExportTerminalCode({ terminal: { findUnique: async () => null } } as never, 'term-missing')
  check('lookup:missing', missing === null, '查不到终端应是 null')
  const thrown = await lookupExportTerminalCode({ terminal: { findUnique: async () => { throw new Error('db') } } } as never, 'term-throw')
  check('lookup:throw', thrown === null, '查询失败应是 null，不能挡住导出')
  const blankRow = await lookupExportTerminalCode({ terminal: { findUnique: async () => ({ terminalCode: '  ' }) } } as never, 'term-blank')
  check('lookup:blank', blankRow === null, '空编号应是 null')
  let lookupCalled = false
  const noId = await lookupExportTerminalCode({
    terminal: { findUnique: async () => { lookupCalled = true; return { terminalCode: 'KSK-009' } } },
  } as never, null)
  check('lookup:no-id', noId === null && lookupCalled === false, '没有终端身份时不应查询')
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
  check('controller:final-required', handler.includes('if (unlabeledPlan.applied) await this.audit.writeRequired(this.prisma, exportAudit)'), '去标识导出的最终审计（带文件编号）必须用 writeRequired')
  check('controller:print-copy', handler.includes('printFileId: result.printFileUrl ? parseContentFileId(result.printFileUrl) : null'), '导出审计没有记打印用 PDF 副本的编号')
  check('controller:terminal', handler.includes('lookupExportTerminalCode(this.prisma, await this.verifiedQuotaTerminal(req))'), '终端编号必须从已验签的一体机身份取')
  check('controller:response', handler.includes('visibleLabelApplied: unlabeledPlan.visibleLabelApplied') && handler.includes('unlabeledDeniedReason: unlabeledPlan.unlabeledDeniedReason'), '导出响应必须带回印没印和没放行的原因')
  check('controller:terminal-field', handler.includes('terminalCode: unlabeledPlan.terminalCode'), '导出审计必须带终端编号，且用准入计划里的值')
  const payloadStart = handler.indexOf('payload: {')
  const payloadEnd = handler.indexOf('ipAddress:', payloadStart)
  const payloadBlock = payloadStart >= 0 && payloadEnd > payloadStart ? handler.slice(payloadStart, payloadEnd) : ''
  check('controller:no-phone', payloadBlock.length > 0 && !payloadBlock.toLowerCase().includes('phone'), '导出审计 payload 不得含手机号')
  const service = readFileSync(join(__dirname, '../src/ai/ai.service.ts'), 'utf8')
  check('service:txt-md', service.includes('renderTxt(resume, { visibleLabel })') && service.includes('renderMarkdown(resume, { visibleLabel })'), 'TXT / MD 导出没有按同一判定加标识')
  check('service:echo', service.includes('visibleLabelApplied: visibleLabel') && service.includes('unlabeledDeniedReason: charge?.unlabeledDeniedReason ?? null'), '导出服务必须按渲染判定回印没印，并原样带回未放行原因')
  check('service:pricing-flag', service.includes('const unlabeledOptionAvailable = resumeUnlabeledOptionEnabled()'), '价格接口的可选不印标志必须来自两个开关，不能写死')
  const example = readFileSync(join(__dirname, '../.env.example'), 'utf8')
  check('env:visible-true', /^RESUME_EXPORT_VISIBLE_LABEL=true$/m.test(example), '.env.example 的显式标识缺省应为 true')
  check('env:option-false', /^RESUME_EXPORT_UNLABELED_OPTION=false$/m.test(example), '.env.example 的不印选项应保持 false')
  check('env:comment', example.includes('2026-10-06') && example.includes('默认印') && example.includes('第九条') && example.includes('等律师答复第 21 问、新用户协议上线后再开'), '.env.example 注释没有写成 10/6 新口径')
  check('env:no-staff', !example.includes('工作人员'), '.env.example 出现了「工作人员」')
  const aigc = readFileSync(join(__dirname, '../src/common/pdf/aigc-label.ts'), 'utf8')
  check('default:code', aigc.includes("return process.env['RESUME_EXPORT_VISIBLE_LABEL'] === 'true'") && aigc.includes("return resumeVisibleLabelEnabled() && process.env['RESUME_EXPORT_UNLABELED_OPTION'] === 'true'"), '代码缺省必须仍是没配环境变量就不印；样例文件改成 true 不得改运行时缺省')
  const shared = readFileSync(join(__dirname, '../../../packages/shared/src/types/ai.ts'), 'utf8')
  const reasonType = shared.slice(shared.indexOf('export type ResumeUnlabeledDeniedReason'), shared.indexOf('export interface ResumeExportPricing'))
  const pricingIface = shared.slice(shared.indexOf('export interface ResumeExportPricing'), shared.indexOf('export interface ResumeGenerateExportResponse'))
  const exportIface = shared.slice(shared.indexOf('export interface ResumeGenerateExportResponse'), shared.indexOf('export interface JobFitRequest'))
  const reasonCodes = ['option_off', 'format_not_eligible', 'draft', 'anonymous', 'terms_not_accepted', 'terms_outdated']
  check('types:reasons', reasonCodes.every((code) => reasonType.includes(`'${code}'`)) && !reasonType.includes('not_requested'), '共享原因码必须是六个公开码，不含 not_requested')
  check('types:pricing', pricingIface.includes('unlabeledOptionAvailable: boolean'), '价格类型缺少 unlabeledOptionAvailable')
  check('types:export', exportIface.includes('visibleLabelApplied: boolean') && exportIface.includes('unlabeledDeniedReason: ResumeUnlabeledDeniedReason | null') && !exportIface.includes('layout?:'), '导出响应类型缺少印没印或未放行原因')
}

async function pricingChecks(): Promise<void> {
  const price = (visible: boolean | undefined, option: boolean | undefined) => {
    setSwitches(visible, option)
    return AiService.prototype.getResumeExportPricing.call({ exportGate: undefined }, null)
  }
  check('pricing:both-unset', (await price(undefined, undefined)).unlabeledOptionAvailable === false, '两个开关都没设时不应可选不印')
  check('pricing:visible-only', (await price(true, false)).unlabeledOptionAvailable === false, '只开页脚标识时不应可选不印')
  check('pricing:option-only', (await price(false, true)).unlabeledOptionAvailable === false, '页脚标识关着时，只开不印选项也不应可选')
  check('pricing:both-on', (await price(true, true)).unlabeledOptionAvailable === true, '两个开关都开时应可选不印')
  const gate = {
    getPricing: async () => ({ mode: 'charged' as const, unitCents: 100, unit: 'item', benefit: { available: 1, serviceType: 'resume_export' as const }, label: '付费' }),
  }
  setSwitches(true, true)
  const chargedOn = await AiService.prototype.getResumeExportPricing.call({ exportGate: gate }, 'm1')
  check('pricing:gate-on', chargedOn.mode === 'charged' && chargedOn.unitCents === 100 && chargedOn.unlabeledOptionAvailable === true, '价目结果上的标志没有跟着两个开关都开变成 true')
  setSwitches(true, false)
  const chargedOff = await AiService.prototype.getResumeExportPricing.call({ exportGate: gate }, 'm1')
  check('pricing:gate-off', chargedOff.mode === 'charged' && chargedOff.unlabeledOptionAvailable === false, '价目结果上的标志在选项关时仍是 true')
}

/**
 * 标识办法第九条要求留存提供对象等日志不少于六个月（方案 04b 第 5 节）。
 * 扫描 services/api/src 与 services/worker：现在不得删除或更新 AuditLog。
 * 若同一文件出现 auditLog 的 delete / update（或原生 SQL DELETE FROM "AuditLog"），
 * 该文件必须同时写出 resume.export_unlabeled_requested、resume.generate_exported，
 * 以及不少于 180 天的保留常量，否则本门禁变红。
 * 天数只认带 retention / 保留 名字的常量、或「N天 / N days」、或「N * 24 * 60 * 60」，
 * 避免把无关的 limit: 500 当成保留期。反例字符串放在本脚本（scripts/ 不在扫描范围内）。
 */
const AUDIT_LABEL_ACTIONS = ['resume.export_unlabeled_requested', 'resume.generate_exported'] as const
const AUDIT_RETENTION_MIN_DAYS = 180
const AUDIT_RETENTION_COUNTEREXAMPLE = `
await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } })
`
const AUDIT_RETENTION_COMPLIANT = `
const RESUME_LABEL_AUDIT_RETENTION_DAYS = 180
await prisma.auditLog.deleteMany({
  where: { action: { notIn: ['resume.export_unlabeled_requested', 'resume.generate_exported'] } },
})
`
const AUDIT_RETENTION_TOO_SHORT = `
const RESUME_LABEL_AUDIT_RETENTION_DAYS = 30
await prisma.auditLog.deleteMany({
  where: { action: { notIn: ['resume.export_unlabeled_requested', 'resume.generate_exported'] } },
})
`

function stripSourceComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function auditRetentionDays(source: string): number {
  let max = 0
  for (const match of source.matchAll(/(?:retention|RETENTION|保留)[A-Za-z0-9_]*\s*=\s*(\d+)/g)) max = Math.max(max, Number(match[1]))
  for (const match of source.matchAll(/(\d+)\s*(?:天|days)\b/giu)) max = Math.max(max, Number(match[1]))
  for (const match of source.matchAll(/(\d+)\s*\*\s*24\s*\*\s*60\s*\*\s*60/g)) max = Math.max(max, Number(match[1]))
  return max
}

function resumeLabelAuditRetentionOk(source: string): boolean {
  const stripped = stripSourceComments(source)
  const mutates = /auditLog\s*\??\.\s*(?:deleteMany|delete|updateMany|update)\s*\(/u.test(stripped)
    || /DELETE\s+FROM\s+"AuditLog"/iu.test(stripped)
  if (!mutates) return true
  const namesBoth = AUDIT_LABEL_ACTIONS.every((name) => stripped.includes(name))
  return namesBoth && auditRetentionDays(stripped) >= AUDIT_RETENTION_MIN_DAYS
}

function walkSourceFiles(dir: string, out: string[]): void {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === 'coverage') continue
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) walkSourceFiles(full, out)
    else if (/\.(?:ts|tsx|js|mjs|cjs|sql)$/u.test(name)) out.push(full)
  }
}

function retentionChecks(): void {
  check('retention:counterexample', resumeLabelAuditRetentionOk(AUDIT_RETENTION_COUNTEREXAMPLE) === false, '反例夹具（不排除两类动作的 deleteMany）没有变红')
  check('retention:compliant', resumeLabelAuditRetentionOk(AUDIT_RETENTION_COMPLIANT) === true, '同文件写了两个动作名和 180 天保留常量的清理应放行')
  check('retention:too-short', resumeLabelAuditRetentionOk(AUDIT_RETENTION_TOO_SHORT) === false, '只保留 30 天应被拒绝')
  check('retention:delete', resumeLabelAuditRetentionOk(`await prisma.auditLog.delete({ where: { id: 'x' } })`) === false, '裸 delete 应红')
  check('retention:update', resumeLabelAuditRetentionOk(`await prisma.auditLog.update({ where: { id: 'x' }, data: {} })`) === false, '裸 update 应红')
  check('retention:updateMany', resumeLabelAuditRetentionOk('await prisma.auditLog.updateMany({ data: {} })') === false, '裸 updateMany 应红')
  check('retention:sql', resumeLabelAuditRetentionOk(`await prisma.$executeRawUnsafe('DELETE FROM "AuditLog"')`) === false, '原生 DELETE FROM "AuditLog" 应红')
  check('retention:comment', resumeLabelAuditRetentionOk('// await prisma.auditLog.deleteMany({})\nconst kept = 1') === true, '注释里的删除不应当成真调用')
  const files: string[] = []
  walkSourceFiles(join(__dirname, '../src'), files)
  walkSourceFiles(join(__dirname, '../../worker'), files)
  const bad = files.filter((file) => !resumeLabelAuditRetentionOk(readFileSync(file, 'utf8')))
  check('retention:tree', bad.length === 0, bad.length === 0 ? 'ok' : `这些文件删改 AuditLog，但没有同时排除两类动作并保留不少于 ${AUDIT_RETENTION_MIN_DAYS} 天：${bad.join(', ')}`)
}

async function exportServiceChecks(): Promise<void> {
  if (!process.env['DATABASE_URL']) process.env['DATABASE_URL'] = `file:${join(__dirname, '../prisma/dev.db')}`
  if (!process.env['FILE_SIGNING_SECRET'] || process.env['FILE_SIGNING_SECRET'].length < 32) {
    process.env['FILE_SIGNING_SECRET'] = 'verify-resume-export-label-secret-0123456789'
  }
  if (!process.env['FILE_STORAGE_DRIVER']) process.env['FILE_STORAGE_DRIVER'] = 'local'
  if (!process.env['FILE_STORAGE_DIR']?.trim()) process.env['FILE_STORAGE_DIR'] = join(tmpdir(), 'resume-export-label')
  process.env['AI_PROVIDER'] = 'mock'
  Logger.overrideLogger({ log: () => {}, error: () => {}, warn: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {} })

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const storage = new StorageService()
  const files = new FilesService(prisma, new AuditService(prisma), storage)
  const emptyStub = {} as never
  // 位置参数与 verify-ai-safety-aigc 的 assertResumeExportProduceId 一致；这里多传真实 ResumeTextService 以覆盖 txt。
  const ai = new AiService(
    new MockAiProvider() as never,
    emptyStub, emptyStub, emptyStub, emptyStub, emptyStub,
    emptyStub,
    { record: () => {} } as never,
    emptyStub, emptyStub, emptyStub,
    new ResumePdfService(),
    files,
    prisma,
    new AuditService(prisma) as never,
    new ResumeDocxService(),
    new ResumeTextService(),
  )
  const created: string[] = []
  const load = async (fileId: string) => {
    const row = await prisma.fileObject.findUnique({ where: { id: fileId } })
    if (!row) throw new Error(`FileObject ${fileId} 未落库`)
    created.push(row.id)
    return { row, buffer: await storage.getObject(row.storageKey, row.bucket) }
  }
  const exportOnce = async (
    format: 'docx' | 'txt' | 'md',
    charge: { unlabeled?: boolean; unlabeledDeniedReason?: UnlabeledExportPublicDeniedReason | null },
  ) => {
    const exported = await ai.exportGeneratedResume(SHORT as never, null, null, format, undefined, undefined, false, charge)
    const primary = await load(exported.fileId)
    const printId = exported.printFileUrl ? parseContentFileId(exported.printFileUrl) : null
    if (!printId) throw new Error(`${format} 导出没有打印用 PDF 副本`)
    const print = await load(printId)
    const printPages = await pages(print.buffer)
    const printAigc = parseAigcLabelJson((await readPdfInfo(print.buffer))['AIGC'] ?? '')
    const primaryHasLabel = format === 'docx'
      ? (await docxParts(primary.buffer)).footers.includes(AIGC_VISIBLE_FOOTER)
      : primary.buffer.toString('utf-8').includes(AIGC_VISIBLE_FOOTER)
    return {
      primaryHasLabel,
      printHasLabel: printPages.every((page) => page.includes(LABEL)),
      printImplicit: Boolean(printAigc),
      visibleLabelApplied: exported.visibleLabelApplied,
      unlabeledDeniedReason: exported.unlabeledDeniedReason,
    }
  }
  try {
    setSwitches(true, true)
    for (const format of ['docx', 'txt'] as const) {
      const labeled = await exportOnce(format, { unlabeled: false })
      check(`service:${format}:labeled`, labeled.primaryHasLabel && labeled.printHasLabel && labeled.visibleLabelApplied === true && labeled.unlabeledDeniedReason === null, `${format} 带标识导出：主文件 ${labeled.primaryHasLabel}、打印副本 ${labeled.printHasLabel}、响应 ${String(labeled.visibleLabelApplied)}/${String(labeled.unlabeledDeniedReason)}`)
      const bare = await exportOnce(format, { unlabeled: true })
      check(`service:${format}:unlabeled`, !bare.primaryHasLabel && !bare.printHasLabel && bare.printImplicit && bare.visibleLabelApplied === false && bare.unlabeledDeniedReason === null, `${format} 去标识导出：主文件 ${bare.primaryHasLabel}、打印副本 ${bare.printHasLabel}、副本隐式标识 ${bare.printImplicit}、响应 ${String(bare.visibleLabelApplied)}/${String(bare.unlabeledDeniedReason)}`)
    }
    for (const format of ['txt', 'md'] as const) {
      const denied = await exportOnce(format, { unlabeled: false, unlabeledDeniedReason: 'format_not_eligible' })
      check(`service:${format}:format-denied`, denied.primaryHasLabel && denied.printHasLabel && denied.visibleLabelApplied === true && denied.unlabeledDeniedReason === 'format_not_eligible', `${format} 申请不印未放行：主文件 ${denied.primaryHasLabel}、打印副本 ${denied.printHasLabel}、响应 ${String(denied.visibleLabelApplied)}/${String(denied.unlabeledDeniedReason)}`)
    }
    setSwitches(undefined, undefined)
    const plain = await exportOnce('docx', { unlabeled: false })
    check('service:default', !plain.primaryHasLabel && !plain.printHasLabel && plain.visibleLabelApplied === false && plain.unlabeledDeniedReason === null, '默认配置下经导出服务的 DOCX 或打印副本印了标识，或响应说印了')
  } finally {
    for (const id of created) {
      const row = await prisma.fileObject.findUnique({ where: { id } })
      if (row) {
        try { await storage.deleteObject(row.storageKey, row.bucket) } catch { /* 清理失败不掩盖断言 */ }
      }
    }
    if (created.length > 0) await prisma.fileObject.deleteMany({ where: { id: { in: created } } })
    await prisma.onModuleDestroy()
  }
}

void (async () => {
  const saved = [process.env['RESUME_EXPORT_VISIBLE_LABEL'], process.env['RESUME_EXPORT_UNLABELED_OPTION']] as const
  try {
    await renderChecks()
    await admissionChecks()
    await pricingChecks()
    staticChecks()
    retentionChecks()
    await exportServiceChecks()
  } catch (error) {
    fail('runtime', error instanceof Error ? error.message : String(error))
  } finally {
    setSwitches(saved[0] === undefined ? undefined : saved[0] === 'true', saved[1] === undefined ? undefined : saved[1] === 'true')
  }
  console.log(failed === 0 ? '\n简历导出显式标识：PASS' : `\n简历导出显式标识：${failed} FAIL`)
  process.exit(failed === 0 ? 0 : 1)
})()
