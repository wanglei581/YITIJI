/**
 * verify:derivation-kind —— 1.8 P-1：转换件、签名件不得绕过打印前隐私检查（2026-09-29）
 *
 * 为什么新开一条门禁、不扩 verify:pii-manual-confirm：
 *   那条门禁只测「本人确认」这一步（纯库行 + 闸门函数）；本条要起真实的图片转 PDF、Word 转 PDF、
 *   签名合成、小程序单件建单、材料检查、「我的文档」列表服务，外加源码语法树扫描 —— 夹具与关注点
 *   都不同，塞进去会让那条门禁从 150 行涨到 500 行。verify:pii-manual-confirm 只同步改了一条
 *   按旧口径写的断言（「派生件不受影响」→「AI 生成件不受影响、转换件同样要确认」）。
 *
 * 按规格断言（不按旧行为）：
 *   [A] 复现（真实服务）：图片转 PDF、Word 转 PDF、签名合成的产物，没做隐私检查时小程序单件建单
 *       必须被拒 PRINT_PII_SCAN_REQUIRED（旧代码在这里放行，走到终端检查 PRINT_TERMINAL_NOT_FOUND）；
 *       阳性对照：同样条件下原件被拒、AI 生成件与隐私遮挡件放行（证明闸门开着、且豁免没被一并关掉）。
 *   [B] 转换件能做材料检查、走同一条本人确认：对图片转 PDF 产物真实建 pii_scan 任务；
 *       A-04 开关关（默认）时检查完即可建单；开关开时不完整结论要本人确认，确认后放行；
 *       转换件按本件 sha256 绑定，内容被换过报 PII_SCAN_STALE。
 *   [C] 列表与闸门同源：造齐所有 derivationKind（含 null、不认识的值）× 原件 / 派生 / 优化 × 多种用途，
 *       「我的文档」的 materialCheckRequired、建单闸门是否拦、规格表三者逐一相等。
 *   [D] 上传点写对：
 *       D1 运行时 —— [A] 三个真实服务落库的 derivationKind 分别是 format_conversion / format_conversion / signature；
 *       D2 静态 —— 服务端源码里所有 assetCategory 为 derived / optimized 的建文件调用，必须带 derivationKind
 *          字面量，且与下表逐处相等；多出、缺少、写错都红（新增派生上传点必须先在这里登记分类）。
 *       AI 生成的 6 处打印稿另由 verify:print-jobs 的 P0-5 段在生产开关下真实建单（带 derivationKind）。
 */
import 'reflect-metadata'
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import zlib from 'node:zlib'
import ts from 'typescript'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { buildRealPdf } from './support/minimal-pdf'

assertIsolatedVerificationDatabase()
process.env['FILE_SIGNING_SECRET'] ||= 'verify-derivation-kind-file-signing-secret-0123456789'
process.env['FILE_STORAGE_DRIVER'] ||= 'local'

const apiRoot = resolve(__dirname, '..')
let checks = 0
let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (ok) { console.log(`  ✅ ${name}`); return }
  failures += 1
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
}
function codeOf(error: unknown): string {
  const ex = error as { getResponse?: () => unknown; response?: unknown; message?: string }
  const body = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as { error?: { code?: string } } | undefined
  return body?.error?.code ?? ex.message ?? String(error)
}

// ── 夹具：真实可被 pdfkit 内嵌的最小 PNG ─────────────────────────────────────
const CRC = (() => {
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}
function makePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2
  const rowBytes = 1 + width * 3
  const raw = Buffer.alloc(rowBytes * height, 180)
  for (let y = 0; y < height; y++) raw[y * rowBytes] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ── [D2] 派生上传点登记表（规格：每处该是哪一类）────────────────────────────────
/** 键：源文件 + 所在方法 + 该方法内第几处。值：规格要求的 derivationKind。 */
const EXPECTED_DERIVED_SITES: Record<string, string> = {
  'src/print-conversion/print-conversion.service.ts#doConvert#1': 'format_conversion', // 图片 → PDF
  'src/document-conversion/document-conversion.service.ts#convertStoredFile#1': 'format_conversion', // Word → PDF
  'src/print-sign/print-sign.service.ts#doCompose#1': 'signature', // 签名 / 印章合成
  'src/materials/pii-redaction.service.ts#evaluate#1': 'pii_redaction', // 隐私遮挡产物
  'src/advisor/advisor-artifact.service.ts#print#1': 'ai_generated', // 小青作业
  'src/ai/ai.service.ts#exportGeneratedResume#1': 'ai_generated', // AI 简历导出（主格式）
  'src/ai/ai.service.ts#exportGeneratedResume#2': 'ai_generated', // AI 简历导出（打印用 PDF 副本）
  'src/ai/resume-report-export.controller.ts#exportAuthorized#1': 'ai_generated', // 简历诊断报告导出
  'src/ai/resume/career-plan.service.ts#printPlan#1': 'ai_generated', // 职业规划
  'src/ai/resume/job-fit.service.ts#printReport#1': 'ai_generated', // 岗位匹配报告
  'src/ai/resume/fair-visit-plan.service.ts#printPlan#1': 'ai_generated', // 参会准备单
  'src/mock-interview/mock-interview.service.ts#printReport#1': 'ai_generated', // 模拟面试报告
  'src/mock-interview/mock-interview.service.ts#printPracticeSheet#1': 'ai_generated', // 模拟面试题目单
  'src/mock-interview/interview-transcript-print.service.ts#print#1': 'ai_generated', // 本场作答记录（不调模型；闸门豁免与题目单相同）
  'src/job-materials/job-materials.service.ts#generate#1': 'ai_generated', // 求职材料模板生成
  'src/contract-review/contract-review-report-file.service.ts#create#1': 'ai_generated', // 合同风险提示报告
  'src/files/member-data-export-file.service.ts#create#1': 'ai_generated', // 会员本人数据导出
  'src/jobs/fair-company-print.service.ts#prepare#1': 'ai_generated', // 招聘会企业资料（系统排版）
  'src/jobs/fair-material-print-bridge.service.ts#prepare#1': 'ai_generated', // 招聘会资料打印副本（机构素材，系统转存）
}
/** assetCategory 不是字面量、而是透传的建文件调用：只允许 FilesService.upload 本身，且必须同时透传 derivationKind。 */
const PASS_THROUGH_SITES = new Set(['src/files/files.service.ts#upload#1'])

function listSources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'generated' || entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...listSources(full))
    else if (entry.endsWith('.ts') && !/\.(?:spec|test|d)\.ts$/.test(entry)) out.push(full)
  }
  return out
}

interface CreationSite { key: string; assetCategory: string; derivationKind: string | null; literalCategory: boolean }

/** 建文件的对象字面量：同时带 assetCategory 与 buffer / storageKey（上传实参或 fileObject.create 的 data）。 */
function scanCreationSites(): CreationSite[] {
  const sites: CreationSite[] = []
  for (const full of listSources(join(apiRoot, 'src'))) {
    const file = relative(apiRoot, full).split('\\').join('/')
    const source = ts.createSourceFile(file, readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true)
    const counters = new Map<string, number>()
    const visit = (node: ts.Node, method: string): void => {
      let current = method
      if ((ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name) current = node.name.getText(source)
      if (ts.isObjectLiteralExpression(node)) {
        const props = new Map<string, ts.Expression>()
        for (const p of node.properties) {
          if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) props.set(p.name.text, p.initializer)
          else if (ts.isShorthandPropertyAssignment(p)) props.set(p.name.text, p.name)
        }
        const category = props.get('assetCategory')
        const isCreation = category && (props.has('buffer') || props.has('storageKey'))
        const literal = category && (ts.isStringLiteral(category) || ts.isNoSubstitutionTemplateLiteral(category))
        const derivedLiteral = literal && ['derived', 'optimized'].includes((category as ts.StringLiteral).text)
        if (category && (derivedLiteral || (isCreation && !literal))) {
          const base = `${file}#${current}`
          const n = (counters.get(base) ?? 0) + 1
          counters.set(base, n)
          const kind = props.get('derivationKind')
          sites.push({
            key: `${base}#${n}`,
            assetCategory: category.getText(source),
            derivationKind: kind ? (ts.isStringLiteral(kind) ? kind.text : kind.getText(source)) : null,
            literalCategory: Boolean(literal),
          })
        }
      }
      ts.forEachChild(node, (child) => visit(child, current))
    }
    visit(source, '顶层')
  }
  return sites
}

async function main(): Promise<void> {
  const { PrismaService } = await import('../src/prisma/prisma.service')
  const { AuditService } = await import('../src/audit/audit.service')
  const { StorageService } = await import('../src/storage/storage.service')
  const { FilesService } = await import('../src/files/files.service')
  const { signFileUrl } = await import('../src/files/signing')
  const { PrintConversionService } = await import('../src/print-conversion/print-conversion.service')
  const { DocumentConversionService } = await import('../src/document-conversion/document-conversion.service')
  const { PrintSignService } = await import('../src/print-sign/print-sign.service')
  const { MemberPrintOrderCreateService } = await import('../src/member-print-orders/member-print-order-create.service')
  const { MaterialsService } = await import('../src/materials/materials.service')
  const { MaterialsManualConfirmationService } = await import('../src/materials/materials-manual-confirmation.service')
  const { MemberAssetsService } = await import('../src/member-assets/member-assets.service')
  const { assertPiiScanned, PII_SCAN_INCOMPLETE_MODES } = await import('../src/print-jobs/pii-scan-gate')
  const { DERIVATION_KINDS } = await import('../src/print-jobs/material-check-policy')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const files = new FilesService(prisma, audit, storage)
  const values = new Map<string, string>()
  const redis = {
    async get(k: string) { return values.get(k) ?? null },
    async setEx(k: string, _t: number, v: string) { values.set(k, v) },
    async setNxEx(k: string, _t: number, v: string) { if (values.has(k)) return false; values.set(k, v); return true },
    async del(k: string) { return values.delete(k) ? 1 : 0 },
    async incrWithTtl() { return 1 },
  }
  const capabilities = { assertUserTaskAllowed: async () => undefined }
  const savedSwitch = process.env['PRINT_PII_MANUAL_CONFIRM_ENFORCED']
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const user = await prisma.endUser.create({ data: { phoneHash: `verify-derivation-${suffix}`, phoneEnc: 'verify' } })
  const endUserId = user.id

  const orders = new MemberPrintOrderCreateService(prisma, {} as never, {} as never, {} as never, audit)
  /** 小程序「我的文档 → 打印」同一条后端路径。PRINT_TERMINAL_NOT_FOUND = 隐私闸门已放行、走到了终端检查。 */
  const memberOrder = async (fileId: string): Promise<string> => {
    try {
      await orders.create(endUserId, {
        fileId, terminalId: `verify-derivation-no-terminal-${suffix}`, copies: 1, colorMode: 'black_white', duplex: 'simplex',
      } as never, randomUUID())
      return 'CREATED'
    } catch (error) {
      return codeOf(error)
    }
  }
  const PASSED_GATE = 'PRINT_TERMINAL_NOT_FOUND'
  const upload = (buffer: Buffer, filename: string, mimeType: string, purpose: 'print_doc' | 'signature_image', extra: Record<string, unknown> = {}) =>
    files.upload({ buffer, filename, mimeType, purpose, uploaderId: null, endUserId, ...extra })
  const kindOf = async (fileId: string) => prisma.fileObject.findUnique({ where: { id: fileId }, select: { assetCategory: true, derivationKind: true, sourceFileId: true, purpose: true } })

  try {
    console.log('\n[A] 复现：转换件 / 签名件没做隐私检查时，小程序单件建单')
    const photo = await upload(makePng(40, 30), '身份证正面.png', 'image/png', 'print_doc')
    check('阳性对照：身份证照片原件直接下单被拒 PRINT_PII_SCAN_REQUIRED', (await memberOrder(photo.fileId)) === 'PRINT_PII_SCAN_REQUIRED')

    const conversion = new PrintConversionService(prisma, storage, audit, files, redis as never, capabilities as never)
    const imagePdf = await conversion.convertImagesToPdf({
      sources: [{ fileId: photo.fileId, fileAccessUrl: signFileUrl(photo.fileId, 600_000).url }], endUserId, terminalId: 'verify',
    })
    const imageOrder = await memberOrder(imagePdf.fileId)
    check('图片转 PDF 产物：没做隐私检查，建单被拒 PRINT_PII_SCAN_REQUIRED（旧代码放行）', imageOrder === 'PRINT_PII_SCAN_REQUIRED', imageOrder)

    const adapter = {
      engine: 'soffice' as const,
      probe: async () => ({ available: true }),
      convert: async (_input: string, dir: string) => { const out = join(dir, 'out.pdf'); await writeFile(out, buildRealPdf(1)); return out },
    }
    const documents = new DocumentConversionService(files, prisma, adapter, async () => true)
    await documents.onModuleInit()
    const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(256)])
    const wordId = randomUUID().replace(/-/g, '')
    await storage.putObject(`verify-derivation/${suffix}/${wordId}.docx`, docx, docxMime)
    await prisma.fileObject.create({ data: {
      id: wordId, storageKey: `verify-derivation/${suffix}/${wordId}.docx`, filename: '身份证复印件.docx', mimeType: docxMime,
      sizeBytes: docx.length, sha256: '', purpose: 'print_doc', endUserId, ownerType: 'user', ownerId: endUserId,
    } })
    const wordPdf = await documents.convertForPrint(wordId)
    const wordOrder = await memberOrder(wordPdf.fileId)
    check('Word 转 PDF 产物：没做隐私检查，建单被拒 PRINT_PII_SCAN_REQUIRED（旧代码放行）', wordOrder === 'PRINT_PII_SCAN_REQUIRED', wordOrder)

    const sign = new PrintSignService(prisma, storage, audit, files, redis as never, capabilities as never)
    const pdf = await upload(buildRealPdf(1), '身份证复印件.pdf', 'application/pdf', 'print_doc')
    const stamp = await upload(makePng(20, 10), '签名.png', 'image/png', 'signature_image')
    const signed = await sign.compose({
      terminalId: 'verify', document: { fileId: pdf.fileId, fileAccessUrl: '' }, stamp: { fileId: stamp.fileId, fileAccessUrl: '' },
      placement: { page: 1, position: 'bottom-right', size: 'medium' }, authorizationConfirmed: true, endUserId,
    })
    const signOrder = await memberOrder(signed.fileId)
    check('签名合成产物：没做隐私检查，建单被拒 PRINT_PII_SCAN_REQUIRED（旧代码放行）', signOrder === 'PRINT_PII_SCAN_REQUIRED', signOrder)

    const aiReport = await upload(buildRealPdf(1), '简历对照.pdf', 'application/pdf', 'print_doc', { assetCategory: 'derived', derivationKind: 'ai_generated', createdBy: 'job_fit' })
    const aiOrder = await memberOrder(aiReport.fileId)
    check('阳性对照：AI 生成件（ai_generated）不做隐私检查照样放行', aiOrder === PASSED_GATE, aiOrder)
    const redacted = await upload(buildRealPdf(1), '身份证复印件-隐私遮挡.pdf', 'application/pdf', 'print_doc', { assetCategory: 'derived', derivationKind: 'pii_redaction', sourceFileId: pdf.fileId })
    const redactedOrder = await memberOrder(redacted.fileId)
    check('阳性对照：隐私遮挡产物（pii_redaction）不做隐私检查照样放行', redactedOrder === PASSED_GATE, redactedOrder)

    console.log('\n[D1] 上传点写对（运行时，真实服务落库）')
    const imageRow = await kindOf(imagePdf.fileId)
    check('图片转 PDF 落库 derived · format_conversion', imageRow?.assetCategory === 'derived' && imageRow.derivationKind === 'format_conversion', JSON.stringify(imageRow))
    const wordRow = await kindOf(wordPdf.fileId)
    check('Word 转 PDF 落库 derived · format_conversion，血缘指回原件', wordRow?.assetCategory === 'derived' && wordRow.derivationKind === 'format_conversion' && wordRow.sourceFileId === wordId, JSON.stringify(wordRow))
    const signRow = await kindOf(signed.fileId)
    check('签名合成落库 derived · signature', signRow?.assetCategory === 'derived' && signRow.derivationKind === 'signature', JSON.stringify(signRow))

    console.log('\n[B] 转换件能做材料检查，并走同一条本人确认')
    const ocr = { recognize: async () => { throw new Error('verify: OCR 不可用') } }
    const materials = new MaterialsService(prisma, storage, ocr as never, {} as never)
    const confirmations = new MaterialsManualConfirmationService(prisma, audit, materials)
    const requester = { kind: 'member' as const, endUserId }
    const created = await materials.createTask({ sourceFileId: imagePdf.fileId, kind: 'pii_scan' } as never, requester).then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, code: codeOf(e) }))
    check('材料检查能对图片转 PDF 产物建隐私检查任务', created.ok, created.ok ? '' : created.code)
    if (created.ok) {
      const task = await prisma.documentProcessTask.findFirst({ where: { sourceFileId: imagePdf.fileId, kind: 'pii_scan' }, orderBy: { createdAt: 'desc' } })
      const mode = String((JSON.parse(task?.resultJson ?? '{}') as { mode?: unknown }).mode ?? '')
      check('识别不可用时结论是不完整（degraded），不冒充完整检查', PII_SCAN_INCOMPLETE_MODES.has(mode), mode)
      delete process.env['PRINT_PII_MANUAL_CONFIRM_ENFORCED']
      const afterScan = await memberOrder(imagePdf.fileId)
      check('A-04 开关默认关：检查完成即可建单（只多检查一步）', afterScan === PASSED_GATE, afterScan)
      process.env['PRINT_PII_MANUAL_CONFIRM_ENFORCED'] = 'true'
      const needConfirm = await memberOrder(imagePdf.fileId)
      check('A-04 开关开：不完整结论未确认被拒 PRINT_PII_MANUAL_CONFIRM_REQUIRED（与原件同一条路）', needConfirm === 'PRINT_PII_MANUAL_CONFIRM_REQUIRED', needConfirm)
      const confirmed = await confirmations.confirm(task!.id, requester).then(() => 'ok', (e) => codeOf(e))
      const afterConfirm = await memberOrder(imagePdf.fileId)
      check('A-04 开关开：本人确认后放行', confirmed === 'ok' && afterConfirm === PASSED_GATE, `${confirmed} / ${afterConfirm}`)
      delete process.env['PRINT_PII_MANUAL_CONFIRM_ENFORCED']
      await prisma.fileObject.update({ where: { id: imagePdf.fileId }, data: { sha256: 'f'.repeat(64) } })
      const stale = await memberOrder(imagePdf.fileId)
      check('转换件按本件 sha256 绑定：内容被换过报 PII_SCAN_STALE', stale === 'PII_SCAN_STALE', stale)
    }

    console.log('\n[C] 「我的文档」materialCheckRequired 与建单闸门逐一相等（并与规格表相等）')
    // 规格表：用途是否受管 × 类别 × 来源 → 是否要查。独立于实现手写，不从被测函数推导。
    const matrix: Array<{ purpose: string; assetCategory: string; derivationKind: string | null; expected: boolean }> = []
    const gatedPurposes = ['print_doc', 'resume_upload', 'resume_scan', 'id_scan']
    for (const purpose of [...gatedPurposes, 'cover_letter', 'contract_review_report']) {
      const gated = gatedPurposes.includes(purpose)
      matrix.push({ purpose, assetCategory: 'original', derivationKind: null, expected: gated })
      for (const assetCategory of ['derived', 'optimized']) {
        matrix.push({ purpose, assetCategory, derivationKind: null, expected: gated })
        matrix.push({ purpose, assetCategory, derivationKind: 'not_a_real_kind', expected: gated })
        for (const kind of DERIVATION_KINDS) {
          const exempt = kind === 'ai_generated' || kind === 'pii_redaction'
          matrix.push({ purpose, assetCategory, derivationKind: kind, expected: gated && !exempt })
        }
      }
    }
    check('规格表覆盖全部来源取值（4 种 + 空 + 不认识的值）', DERIVATION_KINDS.length === 4, String(DERIVATION_KINDS.length))
    const rows = [] as Array<{ id: string; label: string; expected: boolean }>
    for (const [i, entry] of matrix.entries()) {
      const row = await prisma.fileObject.create({ data: {
        storageKey: `verify-derivation/${suffix}/matrix-${i}`, filename: `matrix-${i}.pdf`, mimeType: 'application/pdf', sizeBytes: 10,
        sha256: 'e'.repeat(64), purpose: entry.purpose, assetCategory: entry.assetCategory, derivationKind: entry.derivationKind,
        endUserId, ownerType: 'user', ownerId: endUserId, status: 'active',
      } })
      rows.push({ id: row.id, label: `${entry.purpose}·${entry.assetCategory}·${entry.derivationKind ?? '空'}`, expected: entry.expected })
    }
    const assets = new MemberAssetsService(prisma)
    const listed = new Map<string, boolean>()
    let cursor: string | null = null
    for (let guard = 0; guard < 50; guard++) {
      const page = await assets.listDocuments(endUserId, { cursor, pageSize: 50 })
      for (const item of page.items) listed.set(item.id, item.materialCheckRequired)
      cursor = page.nextCursor
      if (!cursor) break
    }
    const mismatches: string[] = []
    for (const row of rows) {
      const fromList = listed.get(row.id)
      const gate = await assertPiiScanned({ prisma, fileId: row.id, requireCompleted: true, missingMessage: 'x', pendingMessage: 'x' })
        .then(() => false, (e) => codeOf(e) === 'PRINT_PII_SCAN_REQUIRED' ? true : `异常 ${codeOf(e)}`)
      if (fromList !== row.expected || gate !== row.expected) mismatches.push(`${row.label}：规格 ${row.expected} / 列表 ${String(fromList)} / 闸门 ${String(gate)}`)
    }
    check(`${rows.length} 种组合：列表、闸门、规格三者逐一相等`, mismatches.length === 0, mismatches.join('；'))
    check('列表确实返回了全部组合（不是空转）', rows.every((r) => listed.has(r.id)), `${rows.filter((r) => listed.has(r.id)).length}/${rows.length}`)

    console.log('\n[D2] 上传点写对（源码语法树扫描）')
    const sites = scanCreationSites()
    const found = new Map(sites.map((s) => [s.key, s]))
    for (const [key, kind] of Object.entries(EXPECTED_DERIVED_SITES)) {
      const site = found.get(key)
      check(`${key} → ${kind}`, site?.derivationKind === kind, site ? `实际 ${site.derivationKind ?? '未写'}` : '源码里没找到这处上传')
    }
    const unregistered = sites.filter((s) => !(s.key in EXPECTED_DERIVED_SITES) && !PASS_THROUGH_SITES.has(s.key))
    check('没有未登记的派生上传点（新增的必须先在本门禁登记分类）', unregistered.length === 0, unregistered.map((s) => `${s.key}（${s.assetCategory}，derivationKind=${s.derivationKind ?? '未写'}）`).join('；'))
    for (const key of PASS_THROUGH_SITES) {
      const site = found.get(key)
      check(`${key} 透传 assetCategory 时同时透传 derivationKind`, Boolean(site?.derivationKind?.includes('derivationKind')), site ? String(site.derivationKind) : '没找到')
    }
    const gateSource = readFileSync(join(apiRoot, 'src/print-jobs/pii-scan-gate.ts'), 'utf8')
    const listSource = readFileSync(join(apiRoot, 'src/member-assets/member-assets.service.ts'), 'utf8')
    check('闸门与列表都调用 material-check-policy 的 materialCheckRequired，不各写一份',
      /from '\.\/material-check-policy'/.test(gateSource) && /materialCheckRequired\(file\)/.test(gateSource)
      && /from '\.\.\/print-jobs\/material-check-policy'/.test(listSource) && /materialCheckRequired: materialCheckRequired\(f\)/.test(listSource)
      && !/'derived'|'optimized'/.test(gateSource))
  } finally {
    if (savedSwitch === undefined) delete process.env['PRINT_PII_MANUAL_CONFIRM_ENFORCED']
    else process.env['PRINT_PII_MANUAL_CONFIRM_ENFORCED'] = savedSwitch
    const owned = await prisma.fileObject.findMany({ where: { endUserId }, select: { id: true } })
    const ids = owned.map((f) => f.id)
    await prisma.piiFinding.deleteMany({ where: { task: { sourceFileId: { in: ids } } } }).catch(() => undefined)
    await prisma.documentProcessTask.deleteMany({ where: { sourceFileId: { in: ids } } })
    await prisma.orderSubmissionLedger.deleteMany({ where: { endUserId } }).catch(() => undefined)
    await prisma.fileObject.updateMany({ where: { id: { in: ids } }, data: { sourceFileId: null } })
    await prisma.fileObject.deleteMany({ where: { id: { in: ids } } })
    await prisma.endUser.delete({ where: { id: endUserId } }).catch(() => undefined)
    await prisma.onModuleDestroy()
  }
  console.log(`\nverify:derivation-kind：${checks - failures}/${checks} 通过`)
  if (failures > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
