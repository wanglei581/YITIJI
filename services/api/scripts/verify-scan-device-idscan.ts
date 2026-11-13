/**
 * 屏上扫描证件 PDF（B3）。
 *
 * 只在服务端核实过的 device 会话放行证件 PDF：startMode=device、origin=device、
 * deviceState 可投递、页数 ≥ 1（assertScanDeliverOriginAllowed 通过之后签发的凭据）。
 * 面板扫描、一体机上传、直传意图仍只收图片。W3b 的断言在 verify-scan-tasks.ts，这里不改它。
 *
 * 还钉住：证件 4 页 / 10 MiB、其余屏上扫描 20 页 / 18 MiB；超页数与超大小有各自的错误码；
 * 个人信息检查按用途不按 MIME；留存仍是 system_short；租约 device 段带 maxPages / maxBytes，
 * 面板租约不多字段。
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:scan-device-idscan
 */
import 'reflect-metadata'
process.env['SCAN_TERMINAL_QUIET_PERIOD_SECONDS'] = '0'
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-scan-device-idscan-secret-0123456789'
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-scan-device-idscan-admin-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-scan-device-idscan-action-0123456789'

import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { AuditService } from '../src/audit/audit.service'
import {
  PURPOSE_POLICY,
  SCAN_DEVICE_ID_MAX_PAGES,
  SCAN_DEVICE_OTHER_MAX_BYTES,
  SCAN_DEVICE_OTHER_MAX_PAGES,
  scanDeviceLeaseLimits,
} from '../src/files/file-validation'
import { FilesService } from '../src/files/files.service'
import { allowedPoliciesForFile, defaultRetentionForUpload } from '../src/files/retention-policy'
import { PrismaService } from '../src/prisma/prisma.service'
import { StorageService } from '../src/storage/storage.service'
import {
  countPdfPages,
  recognizeStoredPageCount,
  setPdfPageCountParserUnavailableForTest,
} from '../src/files/file-page-count.util'
import {
  extractTextForPiiScan,
  HIGH_RISK_PII_PURPOSES,
  PII_SCAN_OCR_PAGE_LIMIT_DEFAULT,
  piiScanOcrPageLimit,
} from '../src/materials/pii-scan.util'
import { materialCheckRequired, PII_SCAN_REQUIRED_PURPOSES } from '../src/print-jobs/material-check-policy'
import { ScanDeviceSessionsService } from '../src/scan-tasks/scan-device-sessions.service'
import { ScanTasksService } from '../src/scan-tasks/scan-tasks.service'
import {
  TerminalCapabilitiesService,
  setPrintScanCapabilityModeForTest,
} from '../src/terminals/terminal-capabilities.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const MIB = 1024 * 1024
const ID_TOO_LARGE = '这份扫描文件太大，收不了。请少扫几页，分成几次办理。'
const ID_TOO_MANY = '页数超过这次扫描的上限。请少扫几页，分成几次办理。'
const PAGE_COUNT_UNREADABLE = '这份扫描件的页数没能读出来，请重新扫描。'
const PANEL_ID_PDF = '这次扫出来的文件格式不收：证件扫描请在打印机屏幕上选图片格式（JPG）后重扫。'
const PANEL_LEASE_KEYS = ['deliveryLease', 'expiresAt', 'notBefore', 'scanTaskId', 'serverNow']

function pass(label: string): void {
  console.log(`  PASS ${label}`)
}

type HttpLike = { getStatus?: () => number; getResponse?: () => unknown }
function httpErrorOf(error: unknown): { status: number | undefined; code: string | undefined; message: string } {
  const e = error as HttpLike
  const body = e.getResponse?.() as { error?: { code?: string; message?: string } } | undefined
  return { status: e.getStatus?.(), code: body?.error?.code, message: String(body?.error?.message ?? '') }
}

async function expectHttp(
  run: () => Promise<unknown>,
  status: number,
  code: string,
  label: string,
): Promise<string> {
  try {
    await run()
  } catch (error) {
    const got = httpErrorOf(error)
    assert.equal(got.status, status, `${label}：HTTP 状态应为 ${status}，实际 ${String(got.status)}（${got.code}）`)
    assert.equal(got.code, code, `${label}：错误码应为 ${code}，实际 ${String(got.code)}`)
    assert.equal(got.message.includes('找工作人员'), false, `${label}：文案不能出现「找工作人员」`)
    pass(`${label}（${status} ${code}）`)
    return got.message
  }
  return assert.fail(`${label}：应当被拒绝（${status} ${code}），实际放行了`)
}

async function pdfWithPages(pageCount: number, text: string): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage([595, 842])
    page.drawText(`${text} page ${i + 1} ABCDEFGHIJKLMNOPQRSTUVWXYZ`, { x: 48, y: 720, size: 12, font })
  }
  return Buffer.from(await doc.save())
}

function padPdf(pdf: Buffer, bytes: number): Buffer {
  assert.ok(pdf.length < bytes, '夹具 PDF 必须小于目标字节数')
  const out = Buffer.alloc(bytes)
  pdf.copy(out)
  return out
}

/** 只有整页色块、没有文字层。每页颜色不同，渲染结果不该是同一张图。 */
async function imageOnlyPdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage([200, 200])
    const channel = (i + 1) / (pageCount + 1)
    page.drawRectangle({ x: 0, y: 0, width: 200, height: 200, color: rgb(channel, 0, 1 - channel) })
  }
  return Buffer.from(await doc.save())
}

function countingOcr() {
  const calls: Array<{ mimeType: string; sha256: string }> = []
  return {
    calls,
    recognize: async (input: { buffer: Buffer; mimeType: string }) => {
      calls.push({
        mimeType: input.mimeType,
        sha256: createHash('sha256').update(input.buffer).digest('hex'),
      })
      return { ok: true as const, text: `ocr-page-${calls.length}` }
    },
  }
}

async function main(): Promise<void> {
  assertIsolatedVerificationDatabase()
  setPrintScanCapabilityModeForTest('managed')

  const suffix = randomBytes(4).toString('hex')
  const storageDir = mkdtempSync(join(tmpdir(), 'verify-scan-idscan-'))
  const originalStorageDir = process.env['FILE_STORAGE_DIR']
  process.env['FILE_STORAGE_DIR'] = storageDir
  const apiSrc = join(__dirname, '../src')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const capabilities = new TerminalCapabilitiesService(prisma)
  const files = new FilesService(prisma, new AuditService(prisma), new StorageService())
  const scanSvc = new ScanTasksService(prisma, files, capabilities)
  const deviceSvc = new ScanDeviceSessionsService(prisma, capabilities)
  const terminalIds: string[] = []

  async function makeTerminal(tag: string) {
    const id = `t_idsc_${tag}_${suffix}`
    await prisma.terminal.create({
      data: {
        id,
        terminalCode: `IDSC-${tag}-${suffix}`.toUpperCase(),
        agentToken: `idsc-${tag}-${randomBytes(8).toString('hex')}`,
        deviceFingerprint: `verify-scan-idscan-${suffix}`,
        enabled: true,
      },
    })
    terminalIds.push(id)
    await capabilities.upsert(id, 'scan_device', 'available', undefined, 'verify-scan-device-idscan')
    return id
  }

  async function openSession(tag: string, scanType: 'id' | 'document', startMode: 'device' | 'panel') {
    const terminalId = await makeTerminal(tag)
    const created = await scanSvc.create(
      startMode === 'device'
        ? { scanType, terminalId, startMode: 'device', source: 'flatbed', colorMode: 'gray' }
        : { scanType, terminalId },
      null,
    )
    await scanSvc.ack(created.scanTaskId, null, created.controlToken, terminalId)
    return { terminalId, ...created }
  }

  async function readyToDeliver(tag: string, scanType: 'id' | 'document', pageCount = 1) {
    const session = await openSession(tag, scanType, 'device')
    await deviceSvc.report(session.terminalId, session.scanTaskId, { state: 'scanning', pageCount })
    await deviceSvc.report(session.terminalId, session.scanTaskId, { state: 'composing' })
    const lease = await scanSvc.getScanDeliveryLease(session.terminalId)
    return { ...session, lease }
  }

  function deliver(
    session: { terminalId: string; scanTaskId: string; lease: { deliveryLease: string } },
    buffer: Buffer,
    origin: 'device' | 'watcher' | undefined,
    filename = 'scan.pdf',
  ) {
    return scanSvc.deliverScanFile({
      terminalId: session.terminalId,
      scanTaskId: session.scanTaskId,
      deliveryLease: session.lease.deliveryLease,
      buffer,
      filename,
      mimeType: 'application/pdf',
      observedAt: new Date().toISOString(),
      ...(origin ? { origin } : {}),
    })
  }

  async function assertNotStored(buffer: Buffer, label: string): Promise<void> {
    const sha256 = createHash('sha256').update(buffer).digest('hex')
    const row = await prisma.fileObject.findFirst({ where: { sha256 }, select: { id: true } })
    assert.equal(row, null, `${label}：被拒的文件不得落库`)
  }

  try {
    console.log('\n-- A. 常量、凭据与公共入口 --')
    assert.equal(SCAN_DEVICE_ID_MAX_PAGES, 4)
    assert.equal(SCAN_DEVICE_OTHER_MAX_PAGES, 20)
    assert.equal(SCAN_DEVICE_OTHER_MAX_BYTES, 18 * MIB)
    assert.equal(PURPOSE_POLICY.id_scan.maxBytes, 10 * MIB)
    assert.deepEqual(scanDeviceLeaseLimits('id'), { maxPages: 4, maxBytes: PURPOSE_POLICY.id_scan.maxBytes })
    assert.deepEqual(scanDeviceLeaseLimits('document'), { maxPages: 20, maxBytes: 18 * MIB })
    assert.equal(PURPOSE_POLICY.id_scan.mimes.includes('application/pdf'), false, '公共用途策略里证件仍只有图片')
    assert.ok(SCAN_DEVICE_ID_MAX_PAGES <= PII_SCAN_OCR_PAGE_LIMIT_DEFAULT, '证件屏上扫描页数上限必须 ≤ OCR 默认识别页数')
    assert.equal(PII_SCAN_OCR_PAGE_LIMIT_DEFAULT, 5)
    const validationSrc = readFileSync(join(apiSrc, 'files/file-validation.ts'), 'utf8')
    assert.match(validationSrc, /SCAN_PDF_MAX_BYTES/)
    assert.match(validationSrc, /scan-pdf-compose\.ts/)
    pass('证件 4 页 / 10 MiB，其余 20 页 / 18 MiB；4 ≤ OCR 默认 5；18 MiB 注明终端程序来源')

    assert.equal(materialCheckRequired({ purpose: 'id_scan', assetCategory: 'original', derivationKind: null }), true)
    assert.equal(PII_SCAN_REQUIRED_PURPOSES.has('id_scan'), true)
    assert.equal(HIGH_RISK_PII_PURPOSES.includes('id_scan'), true)
    const policySrc = readFileSync(join(apiSrc, 'print-jobs/material-check-policy.ts'), 'utf8')
    assert.match(policySrc, /export function materialCheckRequired\(file: MaterialCheckSubject\)/)
    assert.equal(policySrc.includes('mime'), false, '材料检查按用途判定，入参与函数体都不看 MIME')
    const materialsSrc = readFileSync(join(apiSrc, 'materials/materials.service.ts'), 'utf8')
    const piiAt = materialsSrc.indexOf("if (kind === 'pii_scan')")
    assert.ok(piiAt >= 0)
    const piiWindow = materialsSrc.slice(piiAt, piiAt + 2500)
    assert.match(piiWindow, /extractTextForPiiScan\(buffer, sourceFile\.mimeType, this\.ocr, sourceFile\.purpose\)/)
    assert.doesNotMatch(piiWindow, /mimeType\s*===|mimeType\s*!==/)
    const retention = defaultRetentionForUpload({
      purpose: 'id_scan',
      sensitiveLevel: 'highly_sensitive',
      ownerType: 'system',
      endUserId: null,
    })
    assert.equal(retention.retentionPolicy, 'system_short')
    assert.deepEqual(allowedPoliciesForFile({ purpose: 'id_scan', assetCategory: 'original' }), ['system_short'])
    pass('证件 PDF 与图片证件同一套个人信息检查（按用途），留存只允许 system_short')

    const fourPage = await pdfWithPages(4, `pii ${suffix}`)
    const extracted = await extractTextForPiiScan(fourPage, 'application/pdf', {
      recognize: async () => {
        throw new Error('text-layer pdf must not fall through to OCR')
      },
    })
    assert.equal(extracted.outcome, 'ok')
    assert.equal(extracted.truncated, false)
    assert.equal(extracted.pages.length, 4, '4 页证件 PDF 每一页都要进同一套文字提取')
    pass('4 页 PDF 走 extractTextForPiiScan 的 PDF 路径，四页都抽到，没有按 MIME 跳过')

    const filesSrc = readFileSync(join(apiSrc, 'files/files.service.ts'), 'utf8')
    const uploadBody = filesSrc.slice(filesSrc.indexOf('async upload(args: FileUploadArgs)'), filesSrc.indexOf('async uploadVerifiedDeviceScan'))
    assert.doesNotMatch(uploadBody, /validateVerifiedDeviceScanUpload|devicePageLimit|clearance/)
    const scanSrc = readFileSync(join(apiSrc, 'scan-tasks/scan-tasks.service.ts'), 'utf8')
    assert.match(scanSrc, /const deviceClearance = assertScanDeliverOriginAllowed\(/)
    assert.match(scanSrc, /deviceClearance\s*\?\s*await this\.files\.uploadVerifiedDeviceScan\(\{ \.\.\.uploadArgs, clearance: deviceClearance \}\)/)
    assert.match(scanSrc, /:\s*await this\.files\.upload\(uploadArgs\)/)
    for (const rel of [
      'files/files.controller.ts',
      'files/dto/upload-options.dto.ts',
      'files/dto/kiosk-upload-options.dto.ts',
      'files/dto/create-upload-intent.dto.ts',
    ]) {
      const text = readFileSync(join(apiSrc, rel), 'utf8')
      assert.doesNotMatch(text, /uploadVerifiedDeviceScan|allowIdScanPdf|skipValidation/)
    }
    pass('公共 upload 不放行；投递只在凭据为真时走专用入口；控制器和 DTO 碰不到这个入口')

    const onePage = await pdfWithPages(1, `reject ${suffix}`)
    await expectHttp(
      () => files.upload({ buffer: onePage, filename: 'id.pdf', mimeType: 'application/pdf', purpose: 'id_scan', uploaderId: null }),
      400,
      'FILE_MIME_NOT_ALLOWED',
      'FilesService.upload 证件 PDF',
    )
    await expectHttp(
      () => files.upload({
        buffer: onePage,
        filename: 'id.pdf',
        mimeType: 'application/pdf',
        purpose: 'id_scan',
        uploaderId: null,
        clearance: true,
      } as never),
      400,
      'FILE_MIME_NOT_ALLOWED',
      'upload() 多带 clearance 也不能放行证件 PDF',
    )
    await expectHttp(
      () => files.uploadVerifiedDeviceScan({
        buffer: onePage,
        filename: 'id.pdf',
        mimeType: 'application/pdf',
        purpose: 'id_scan',
        uploaderId: null,
        clearance: { kind: 'verified-device-scan-delivery' },
      }),
      400,
      'FILE_MIME_NOT_ALLOWED',
      '伪造凭据退回普通上传',
    )
    await expectHttp(
      () => files.createUploadIntent({
        body: { purpose: 'id_scan', filename: 'id.pdf', mimeType: 'application/pdf', sizeBytes: onePage.length },
        uploaderId: null,
      }),
      400,
      'FILE_MIME_NOT_ALLOWED',
      '直传意图证件 PDF',
    )
    pass('一体机上传与直传意图仍拒绝证件 PDF')

    console.log('\n-- B. 屏上证件 PDF 放行，伪造来源与面板仍拒绝 --')
    {
      const session = await readyToDeliver('idok', 'id', 1)
      assert.equal(session.lease.startMode, 'device')
      assert.equal(session.lease.device?.maxPages, 4)
      assert.equal(session.lease.device?.maxBytes, 10 * MIB)
      const pdf = await pdfWithPages(1, `ok ${suffix}`)
      const delivered = await deliver(session, pdf, 'device', 'id.pdf')
      const status = await scanSvc.getStatus(session.scanTaskId, null, session.controlToken)
      assert.equal(status.status, 'completed')
      assert.equal(status.file?.fileId, delivered.fileId)
      const row = await prisma.fileObject.findUniqueOrThrow({ where: { id: delivered.fileId } })
      assert.equal(row.purpose, 'id_scan')
      assert.equal(row.mimeType, 'application/pdf')
      assert.equal(row.pageCount, 1)
      assert.equal(row.sensitiveLevel, 'highly_sensitive')
      assert.equal(row.retentionPolicy, 'system_short')
      assert.ok(row.expiresAt && row.expiresAt.getTime() <= Date.now() + 2 * 60 * 60 * 1000, '证件仍是短 TTL，不是长期保存')
      assert.equal(materialCheckRequired({ purpose: row.purpose, assetCategory: row.assetCategory, derivationKind: row.derivationKind }), true)
      pass('屏上证件 1 页 PDF 通过，用途 id_scan，留存 system_short，材料检查仍要做')
    }
    {
      const session = await readyToDeliver('id4', 'id', 4)
      const pdf = await pdfWithPages(4, `four ${suffix}`)
      const delivered = await deliver(session, pdf, 'device', 'id.pdf')
      const row = await prisma.fileObject.findUniqueOrThrow({ where: { id: delivered.fileId } })
      assert.equal(row.pageCount, 4)
      assert.equal(row.purpose, 'id_scan')
      assert.equal(row.retentionPolicy, 'system_short')
      pass('屏上证件 4 页 PDF 通过（正好等于上限）')
    }
    {
      const session = await openSession('panelorigin', 'document', 'panel')
      const lease = await scanSvc.getScanDeliveryLease(session.terminalId)
      const pdf = await pdfWithPages(1, `forge ${suffix}`)
      await expectHttp(
        () => deliver({ ...session, lease }, pdf, 'device'),
        409,
        'SCAN_DELIVER_ORIGIN_MISMATCH',
        '面板任务带 origin=device',
      )
      const row = await prisma.scanTask.findUniqueOrThrow({ where: { id: session.scanTaskId } })
      assert.equal(row.status, 'waiting', '来源错配发生在抢占之前，任务仍是 waiting')
      assert.equal(row.fileId, null)
    }
    {
      const session = await openSession('notready', 'id', 'device')
      const lease = await scanSvc.getScanDeliveryLease(session.terminalId)
      const pdf = await pdfWithPages(1, `ready ${suffix}`)
      await expectHttp(
        () => deliver({ ...session, lease }, pdf, 'device', 'id.pdf'),
        409,
        'SCAN_DEVICE_STATE_NOT_DELIVERABLE',
        'device 任务还在 ready',
      )
      const row = await prisma.scanTask.findUniqueOrThrow({ where: { id: session.scanTaskId } })
      assert.equal(row.status, 'waiting')
      assert.equal(row.deviceState, 'ready')
    }
    {
      const session = await readyToDeliver('watcher', 'id', 1)
      const pdf = await pdfWithPages(1, `watch ${suffix}`)
      await expectHttp(
        () => deliver(session, pdf, undefined, 'id.pdf'),
        409,
        'SCAN_DELIVER_ORIGIN_MISMATCH',
        'device 任务不带 origin（按 watcher）',
      )
    }
    {
      const session = await openSession('panelid', 'id', 'panel')
      const lease = await scanSvc.getScanDeliveryLease(session.terminalId)
      assert.deepEqual(Object.keys(lease).sort(), PANEL_LEASE_KEYS, '面板租约不能多字段')
      assert.equal('device' in lease, false)
      assert.equal('maxPages' in lease, false)
      assert.equal('maxBytes' in lease, false)
      const pdf = await pdfWithPages(1, `panel ${suffix}`)
      await expectHttp(
        () => deliver({ ...session, lease }, pdf, undefined, 'id.pdf'),
        400,
        'FILE_MIME_NOT_ALLOWED',
        '面板路线证件 PDF 抛给终端程序的仍是类型不符',
      )
      const status = await scanSvc.getStatus(session.scanTaskId, null, session.controlToken)
      assert.equal(status.status, 'failed')
      assert.equal(status.errorCode, 'SCAN_FILE_TYPE_NOT_ALLOWED')
      assert.equal(status.errorMessage, PANEL_ID_PDF)
      await assertNotStored(pdf, '面板证件 PDF')
      pass('面板路线证件 PDF 仍被拒，用户看到的仍是 W3b 那句 JPG 说明')
    }

    console.log('\n-- C. 页数与大小上限 --')
    {
      const session = await openSession('report5', 'id', 'device')
      const before = await prisma.scanTask.findUniqueOrThrow({ where: { id: session.scanTaskId } })
      const message = await expectHttp(
        () => deviceSvc.report(session.terminalId, session.scanTaskId, { state: 'scanning', pageCount: 5 }),
        409,
        'SCAN_DEVICE_TOO_MANY_PAGES',
        '证件 device-report 5 页',
      )
      assert.equal(message, '这次最多扫 4 页。请少扫几页，分成几次办理。')
      const after = await prisma.scanTask.findUniqueOrThrow({ where: { id: session.scanTaskId } })
      assert.equal(after.deviceState, before.deviceState)
      assert.equal(after.devicePageCount, before.devicePageCount)
      const accepted = await deviceSvc.report(session.terminalId, session.scanTaskId, { state: 'scanning', pageCount: 4 })
      assert.equal(accepted.devicePageCount, 4)
      pass('证件回报 4 页收下、5 页 409，被拒时库里不变')
    }
    {
      const session = await openSession('doc21', 'document', 'device')
      await expectHttp(
        () => deviceSvc.report(session.terminalId, session.scanTaskId, { state: 'scanning', pageCount: 21 }),
        409,
        'SCAN_DEVICE_TOO_MANY_PAGES',
        '非证件 device-report 21 页',
      )
      await expectHttp(
        () => deviceSvc.report(session.terminalId, session.scanTaskId, { state: 'scanning', pageCount: 201 }),
        400,
        'SCAN_DEVICE_REPORT_INVALID',
        'pageCount 201 仍是报文格式错误',
      )
      const row = await prisma.scanTask.findUniqueOrThrow({ where: { id: session.scanTaskId } })
      assert.equal(row.devicePageCount, 0)
      pass('非证件 21 页 409；超过 200 仍是 400 SCAN_DEVICE_REPORT_INVALID')
    }
    {
      const session = await readyToDeliver('id5file', 'id', 1)
      const pdf = await pdfWithPages(5, `five ${suffix}`)
      const message = await expectHttp(
        () => deliver(session, pdf, 'device', 'id.pdf'),
        409,
        'SCAN_DEVICE_TOO_MANY_PAGES',
        '投递 5 页证件 PDF（回报只说了 1 页）',
      )
      assert.equal(message, '这次最多扫 4 页。请少扫几页，分成几次办理。')
      const status = await scanSvc.getStatus(session.scanTaskId, null, session.controlToken)
      assert.equal(status.status, 'failed')
      assert.equal(status.errorCode, 'SCAN_DEVICE_TOO_MANY_PAGES')
      assert.equal(status.errorMessage, ID_TOO_MANY)
      assert.equal(status.file, null)
      await assertNotStored(pdf, '超页数证件 PDF')
      pass('投递时按文件服务认出的页数再拦，任务失败且文件不落库')
    }
    {
      const session = await readyToDeliver('unread', 'id', 1)
      const pdf = Buffer.from(`%PDF-1.4\n%${suffix}\nnot a real pdf\n%%EOF\n`, 'latin1')
      const message = await expectHttp(
        () => deliver(session, pdf, 'device', 'id.pdf'),
        409,
        'SCAN_DEVICE_PAGE_COUNT_UNREADABLE',
        '证件 PDF 页数读不出来',
      )
      assert.equal(message, PAGE_COUNT_UNREADABLE)
      const status = await scanSvc.getStatus(session.scanTaskId, null, session.controlToken)
      assert.equal(status.status, 'failed')
      assert.equal(status.errorCode, 'SCAN_DEVICE_PAGE_COUNT_UNREADABLE')
      assert.equal(status.errorMessage, PAGE_COUNT_UNREADABLE)
      assert.notEqual(status.errorMessage, ID_TOO_MANY)
      await assertNotStored(pdf, '读不出页数的证件 PDF')
      pass('证件 PDF 读不出页数：投递与 getStatus 都是 SCAN_DEVICE_PAGE_COUNT_UNREADABLE，不说成超限')
    }
    {
      const session = await readyToDeliver('docunread', 'document', 1)
      const pdf = Buffer.from(`%PDF-1.4\n%${suffix}-doc\nnot a real pdf\n%%EOF\n`, 'latin1')
      const message = await expectHttp(
        () => deliver(session, pdf, 'device'),
        409,
        'SCAN_DEVICE_PAGE_COUNT_UNREADABLE',
        '非证件 PDF 页数读不出来',
      )
      assert.equal(message, PAGE_COUNT_UNREADABLE)
      const status = await scanSvc.getStatus(session.scanTaskId, null, session.controlToken)
      assert.equal(status.status, 'failed')
      assert.equal(status.errorCode, 'SCAN_DEVICE_PAGE_COUNT_UNREADABLE')
      assert.equal(status.errorMessage, PAGE_COUNT_UNREADABLE)
      await assertNotStored(pdf, '读不出页数的非证件 PDF')
      pass('非证件屏上 PDF 读不出页数也拒，不再按未知页数落库')
    }
    {
      const session = await readyToDeliver('idbig', 'id', 1)
      const pdf = padPdf(await pdfWithPages(1, `big ${suffix}`), 10 * MIB + 1)
      await expectHttp(
        () => deliver(session, pdf, 'device', 'id.pdf'),
        400,
        'FILE_TOO_LARGE',
        '证件超过 10 MiB 时抛给终端程序的仍是文件服务的 FILE_TOO_LARGE',
      )
      const status = await scanSvc.getStatus(session.scanTaskId, null, session.controlToken)
      assert.equal(status.status, 'failed')
      assert.equal(status.errorCode, 'SCAN_FILE_TOO_LARGE')
      assert.equal(status.errorMessage, ID_TOO_LARGE)
      assert.notEqual(status.errorCode, 'SCAN_UPLOAD_FAILED')
      await assertNotStored(pdf, '超大小证件 PDF')
      pass('证件超 10 MiB 落成 SCAN_FILE_TOO_LARGE，不是 SCAN_UPLOAD_FAILED')
    }
    {
      const session = await openSession('panelbig', 'document', 'panel')
      const lease = await scanSvc.getScanDeliveryLease(session.terminalId)
      const pdf = padPdf(await pdfWithPages(1, `panelbig ${suffix}`), 16 * MIB)
      await expectHttp(
        () => deliver({ ...session, lease }, pdf, undefined),
        400,
        'FILE_TOO_LARGE',
        '面板超大小抛出 FILE_TOO_LARGE',
      )
      const status = await scanSvc.getStatus(session.scanTaskId, null, session.controlToken)
      assert.equal(status.errorCode, 'SCAN_FILE_TOO_LARGE')
      assert.equal(status.errorMessage, ID_TOO_LARGE)
      pass('面板扫描超大小同样落成 SCAN_FILE_TOO_LARGE')
    }
    {
      const session = await readyToDeliver('doc16', 'document', 1)
      const pdf = padPdf(await pdfWithPages(1, `sixteen ${suffix}`), 16 * MIB)
      const delivered = await deliver(session, pdf, 'device')
      const row = await prisma.fileObject.findUniqueOrThrow({ where: { id: delivered.fileId } })
      assert.equal(row.purpose, 'print_doc')
      assert.equal(row.sizeBytes, 16 * MIB)
      pass('非证件屏上扫描 16 MiB 通过（不受代理上传 15 MiB 天花板约束）')
    }
    {
      const session = await readyToDeliver('doc18', 'document', 1)
      const pdf = padPdf(await pdfWithPages(1, `eighteen ${suffix}`), 18 * MIB + 1)
      await expectHttp(() => deliver(session, pdf, 'device'), 400, 'FILE_TOO_LARGE', '非证件超过 18 MiB')
      const status = await scanSvc.getStatus(session.scanTaskId, null, session.controlToken)
      assert.equal(status.errorCode, 'SCAN_FILE_TOO_LARGE')
      assert.equal(status.errorMessage, ID_TOO_LARGE)
      pass('非证件屏上扫描超过 18 MiB 落成 SCAN_FILE_TOO_LARGE')
    }
    {
      const session = await readyToDeliver('doc2', 'document', 2)
      const pdf = await pdfWithPages(2, `two ${suffix}`)
      const delivered = await deliver(session, pdf, 'device')
      const row = await prisma.fileObject.findUniqueOrThrow({ where: { id: delivered.fileId } })
      assert.equal(row.pageCount, 2)
      assert.equal(row.purpose, 'print_doc')
      pass('非证件 2 页 PDF 通过，页数按文件服务认出的写入')
    }
    {
      const session = await readyToDeliver('doc21file', 'document', 1)
      const pdf = await pdfWithPages(21, `twentyone ${suffix}`)
      await expectHttp(
        () => deliver(session, pdf, 'device'),
        409,
        'SCAN_DEVICE_TOO_MANY_PAGES',
        '投递 21 页非证件 PDF',
      )
      const status = await scanSvc.getStatus(session.scanTaskId, null, session.controlToken)
      assert.equal(status.errorCode, 'SCAN_DEVICE_TOO_MANY_PAGES')
      assert.equal(status.errorMessage, ID_TOO_MANY)
      await assertNotStored(pdf, '21 页非证件 PDF')
      pass('非证件投递超过 20 页被拒')
    }

    console.log('\n-- C2. 解析器不可用时不改信字节正则 --')
    {
      const buf = Buffer.from(
        `%PDF-1.4\n% ${suffix} regex\n1 0 obj\n<< /Type /Page >>\nendobj\n2 0 obj\n<< /Type /Page >>\nendobj\n%%EOF\n`,
        'latin1',
      )
      assert.equal(countPdfPages(buf), 2, '夹具必须能被字节正则数成 2 页，否则测不到「退回正则仍放行」')
      setPdfPageCountParserUnavailableForTest(true)
      let panelFileId: string | null = null
      try {
        assert.equal(await recognizeStoredPageCount(buf, 'application/pdf'), 2, '面板用的识别函数仍接受字节正则')

        const idSession = await readyToDeliver('regexid', 'id', 1)
        await expectHttp(
          () => deliver(idSession, buf, 'device', 'id.pdf'),
          409,
          'SCAN_DEVICE_PAGE_COUNT_UNREADABLE',
          '证件 PDF 只剩字节正则计数',
        )
        const idStatus = await scanSvc.getStatus(idSession.scanTaskId, null, idSession.controlToken)
        assert.equal(idStatus.errorCode, 'SCAN_DEVICE_PAGE_COUNT_UNREADABLE')
        assert.equal(idStatus.errorMessage, PAGE_COUNT_UNREADABLE)
        await assertNotStored(buf, '字节正则能数的证件 PDF')

        const docSession = await readyToDeliver('regexdoc', 'document', 1)
        await expectHttp(
          () => deliver(docSession, buf, 'device'),
          409,
          'SCAN_DEVICE_PAGE_COUNT_UNREADABLE',
          '非证件 PDF 只剩字节正则计数',
        )
        await assertNotStored(buf, '字节正则能数的非证件 PDF')
        pass('解析器不可用、字节正则能数到 2 页时，证件与非证件屏上扫描都拒')

        const uploaded = await files.upload({
          buffer: buf,
          filename: 'panel-regex.pdf',
          mimeType: 'application/pdf',
          purpose: 'print_doc',
          uploaderId: null,
        })
        panelFileId = uploaded.fileId
        const panelRow = await prisma.fileObject.findUniqueOrThrow({ where: { id: uploaded.fileId } })
        assert.equal(panelRow.pageCount, 2)
        pass('解析器不可用时，普通上传仍按字节正则记下 2 页')
      } finally {
        setPdfPageCountParserUnavailableForTest(false)
        if (panelFileId) await prisma.fileObject.delete({ where: { id: panelFileId } }).catch(() => undefined)
      }
    }

    console.log('\n-- D. 租约上限 --')
    {
      const idSession = await openSession('leaseid', 'id', 'device')
      const idLease = await scanSvc.getScanDeliveryLease(idSession.terminalId)
      assert.deepEqual(idLease.device, { source: 'flatbed', colorMode: 'gray', maxPages: 4, maxBytes: 10 * MIB })
      const docSession = await openSession('leasedoc', 'document', 'device')
      const docLease = await scanSvc.getScanDeliveryLease(docSession.terminalId)
      assert.deepEqual(docLease.device, { source: 'flatbed', colorMode: 'gray', maxPages: 20, maxBytes: 18 * MIB })
      const panel = await openSession('leasepanel', 'id', 'panel')
      const panelLease = await scanSvc.getScanDeliveryLease(panel.terminalId)
      assert.deepEqual(Object.keys(panelLease).sort(), PANEL_LEASE_KEYS)
      pass('证件租约 4 页 / 10 MiB，其余 20 页 / 18 MiB，面板租约不多字段')
    }

    console.log('\n-- E. 证件 PDF 每一页都走 OCR --')
    {
      const imagePdf = await imageOnlyPdf(4)
      const ocr = countingOcr()
      const extracted = await extractTextForPiiScan(imagePdf, 'application/pdf', ocr, 'id_scan')
      assert.equal(extracted.outcome, 'ok')
      assert.equal(extracted.truncated, false)
      assert.equal(extracted.pages.length, 4)
      assert.deepEqual(extracted.pages.map((page) => page.pageNumber), [1, 2, 3, 4])
      assert.equal(ocr.calls.length, 4)
      assert.ok(ocr.calls.every((call) => call.mimeType === 'image/png'))
      assert.equal(new Set(ocr.calls.map((call) => call.sha256)).size, 4, '四次识别的图片应当来自不同页')
      assert.ok(extracted.pages.every((page) => page.text.startsWith('ocr-page-')))
      pass('id_scan 四页纯图片 PDF：四页各识别一次')
    }
    {
      const textPdf = await pdfWithPages(4, `layer ${suffix}`)
      const ocr = countingOcr()
      const extracted = await extractTextForPiiScan(textPdf, 'application/pdf', ocr, 'id_scan')
      assert.equal(ocr.calls.length, 4)
      assert.equal(extracted.outcome, 'ok')
      assert.equal(extracted.truncated, false)
      assert.equal(extracted.pages.length, 4)
      assert.ok(extracted.pages.every((page) => !page.text.includes('ABCDEFG')), '有文字层也不许把文字层当检查结果')
      assert.ok(extracted.pages.every((page) => page.items === undefined), 'OCR 路径不带文字层坐标')
      pass('id_scan 四页文字层 PDF：四页仍都走 OCR')
    }
    {
      let failedCalls = 0
      const failed = await extractTextForPiiScan(await imageOnlyPdf(4), 'application/pdf', {
        recognize: async () => {
          failedCalls += 1
          return { ok: false, errorCode: 'OCR_FAILED' as const }
        },
      }, 'id_scan')
      assert.equal(failedCalls, 1)
      assert.equal(failed.outcome, 'degraded')
      assert.equal(failed.pages.length, 0)
      pass('id_scan 证件 PDF 某一页 OCR 失败：整份降级，不把已识别页当成查完')
    }
    {
      const previous = process.env['PII_SCAN_MAX_OCR_PAGES']
      process.env['PII_SCAN_MAX_OCR_PAGES'] = '1'
      try {
        assert.equal(piiScanOcrPageLimit('id_scan'), SCAN_DEVICE_ID_MAX_PAGES)
        assert.equal(piiScanOcrPageLimit('print_doc'), 1)
        const four = await imageOnlyPdf(4)
        const idOcr = countingOcr()
        const idExtracted = await extractTextForPiiScan(four, 'application/pdf', idOcr, 'id_scan')
        assert.equal(idOcr.calls.length, 4)
        assert.equal(idExtracted.truncated, false)
        assert.equal(idExtracted.pages.length, 4)
        pass('PII_SCAN_MAX_OCR_PAGES=1 时，id_scan 四页仍各识别一次')

        const fiveOcr = countingOcr()
        const five = await extractTextForPiiScan(await imageOnlyPdf(5), 'application/pdf', fiveOcr, 'id_scan')
        assert.equal(fiveOcr.calls.length, 4)
        assert.equal(five.truncated, true)
        assert.equal(five.scannedPages, 4)
        assert.equal(five.totalPages, 5)
        pass('PII_SCAN_MAX_OCR_PAGES=1 时，超过 4 页的证件 PDF 只识别 4 页并标截断')

        const otherOcr = countingOcr()
        const other = await extractTextForPiiScan(four, 'application/pdf', otherOcr, 'print_doc')
        assert.equal(otherOcr.calls.length, 1)
        assert.equal(other.truncated, true)
        assert.equal(other.scannedPages, 1)
        assert.equal(other.totalPages, 4)
        pass('PII_SCAN_MAX_OCR_PAGES=1 时，非证件图片 PDF 仍只识别 1 页')
      } finally {
        if (previous === undefined) delete process.env['PII_SCAN_MAX_OCR_PAGES']
        else process.env['PII_SCAN_MAX_OCR_PAGES'] = previous
      }
    }

    console.log('\nPASS verify-scan-device-idscan')
  } finally {
    setPrintScanCapabilityModeForTest(null)
    if (originalStorageDir === undefined) delete process.env['FILE_STORAGE_DIR']
    else process.env['FILE_STORAGE_DIR'] = originalStorageDir
    const tasks = await prisma.scanTask.findMany({ where: { terminalId: { in: terminalIds } }, select: { fileId: true } }).catch(() => [])
    const fileIds = tasks.map((task) => task.fileId).filter((id): id is string => Boolean(id))
    await prisma.scanTask.deleteMany({ where: { terminalId: { in: terminalIds } } }).catch(() => undefined)
    if (fileIds.length > 0) await prisma.fileObject.deleteMany({ where: { id: { in: fileIds } } }).catch(() => undefined)
    await prisma.terminalCapability.deleteMany({ where: { terminalId: { in: terminalIds } } }).catch(() => undefined)
    await prisma.terminal.deleteMany({ where: { id: { in: terminalIds } } }).catch(() => undefined)
    await prisma.onModuleDestroy().catch(() => undefined)
    rmSync(storageDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
