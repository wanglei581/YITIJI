import 'reflect-metadata'
process.env['FILE_SIGNING_SECRET'] ||= 'contract-report-test-signing-secret-0123456789'

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { HttpException, NotFoundException } from '@nestjs/common'
import { PDFDocument } from 'pdf-lib'
import { ContractReviewReportFileService } from '../contract-review-report-file.service'
import { ContractReviewReportPdfService } from '../contract-review-report-pdf.service'
import { ContractReviewReportService } from '../contract-review-report.service'
import { signContractReportAbandonToken, verifyContractReportAbandonToken } from '../../files/signing'
import type {
  ContractReviewReportView,
  ContractReviewResult,
  ContractReviewTaskRow,
} from '../contract-review.types'

const RESULT: ContractReviewResult = {
  priorityCheckCount: 1,
  attentionCount: 0,
  insufficientInfoCount: 0,
  coverage: 'complete',
  ocrConfidence: 'high',
  disclaimerVersion: 'disclaimer-v1',
  rulePackVersion: 'cn-labor-p0-v1',
  generatedByAi: true,
  findings: [{
    id: 'finding-1',
    category: 'probation',
    priority: 'priority_check',
    title: '试用期约定需要核对',
    evidence: { pageNumber: 2, excerpt: '试用期六个月', charStart: 10, charEnd: 17 },
    explanation: '请结合合同期限核对试用期约定。',
    basisRef: '劳动合同法相关条款',
    verificationQuestion: '合同期限与试用期期限是否匹配？',
    uncertainty: '需以合同完整上下文为准。',
    source: 'rule_and_ai',
  }],
}

const TASK: ContractReviewTaskRow = {
  id: 'task-1',
  sourceFileId: 'source-1',
  resultFileId: null,
  endUserId: 'member-1',
  accessTokenHash: null,
  contractType: 'labor_contract',
  status: 'completed',
  analyzedPages: 2,
  totalPages: 2,
  truncated: false,
  ocrConfidence: 'high',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  resultJson: JSON.stringify(RESULT),
  extractionFingerprint: 'a'.repeat(64),
  confirmedAt: new Date(),
  errorCode: null,
}

test('PDF renderer emits a parseable A4 report with explicit AI metadata', async () => {
  const rendered = await new ContractReviewReportPdfService().render({
    taskId: TASK.id,
    result: RESULT,
    generatedAt: new Date('2026-08-09T08:00:00.000Z'),
  })
  assert.match(rendered.buffer.subarray(0, 8).toString('latin1'), /^%PDF-/u)
  assert.ok(rendered.buffer.length > 1_000)
  const pdf = await PDFDocument.load(rendered.buffer)
  assert.equal(pdf.getPageCount(), rendered.pageCount)
  assert.equal(pdf.getTitle(), 'AI 签约风险提示')
  assert.match(pdf.getSubject() ?? '', /AI/u)
  assert.ok(rendered.pageCount >= 1)
})

test('dedicated report file service persists a private locked PDF and revalidates it before reuse', async () => {
  const source = await PDFDocument.create()
  source.addPage()
  const buffer = Buffer.from(await source.save())
  let record: Record<string, unknown> | null = null
  const prisma = {
    fileObject: {
      async create({ data }: { data: Record<string, unknown> }) {
        record = { ...data, deletedAt: null }
        return record
      },
      async update({ data }: { data: Record<string, unknown> }) {
        Object.assign(record!, data)
        return record
      },
      async updateMany() { return { count: 1 } },
      async findUnique() { return record },
    },
  }
  const storage = {
    defaultBucket: 'private-files',
    defaultRegion: 'local',
    driver: 'local',
    async putObject() {
      return { sizeBytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') }
    },
    async headObject() { return { sizeBytes: buffer.length, contentType: 'application/pdf' } },
    async getObject() { return buffer },
    async deleteObject() {},
  }
  const service = new ContractReviewReportFileService(prisma as never, storage as never)
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000)
  const created = await service.create({
    buffer,
    pageCount: 1,
    endUserId: 'member-1',
    sourceFileId: 'source-1',
    expiresAt,
  })

  assert.equal(record?.['purpose'], 'contract_review_report')
  assert.equal(record?.['sensitiveLevel'], 'highly_sensitive')
  assert.equal(record?.['visibility'], 'private')
  assert.equal(record?.['retentionPolicy'], 'system_short')
  assert.equal(record?.['retentionLockedReason'], 'contract_review_session_only')
  assert.equal(record?.['status'], 'active')
  assert.match(created.printFileUrl, /^\/api\/v1\/files\//u)
  const printUrlExpiresAt = Number(new URL(created.printFileUrl, 'http://internal.local').searchParams.get('expires'))
  assert.ok(printUrlExpiresAt <= expiresAt.getTime())
  assert.equal(verifyContractReportAbandonToken(created.fileId, created.abandonToken), true)
  assert.ok(new Date(created.abandonTokenExpiresAt).getTime() <= expiresAt.getTime())
  const reused = await service.getAvailable({
    fileId: created.fileId,
    endUserId: 'member-1',
    sourceFileId: 'source-1',
  })
  assert.ok(reused)
  assert.deepEqual(
    { ...reused, printFileUrl: '<signed>' },
    { ...created, printFileUrl: '<signed>' },
  )
  assert.match(reused.printFileUrl, /^\/api\/v1\/files\//u)
  assert.equal(await service.getAvailable({
    fileId: created.fileId,
    endUserId: 'member-2',
    sourceFileId: 'source-1',
  }), null)
})

test('report generation is disabled unless its backend flag is explicitly enabled', async () => {
  const harness = reportHarness(false)
  await assert.rejects(
    harness.service.create({ task: TASK, result: RESULT }),
    fixedHttpError(503, 'REPORT_NOT_AVAILABLE'),
  )
  assert.equal(harness.pdfCalls(), 0)
  assert.deepEqual(harness.deleted(), [])
})

test('report generation fails before rendering when the task has too little lifetime left', async () => {
  const harness = reportHarness(true)
  await assert.rejects(
    harness.service.create({
      task: { ...TASK, expiresAt: new Date(Date.now() + 5 * 60 * 1000) },
      result: RESULT,
    }),
    fixedHttpError(503, 'REPORT_NOT_AVAILABLE'),
  )
  assert.equal(harness.pdfCalls(), 0)
})

test('report is attached once, re-used idempotently, and source deletion is retried safely', async () => {
  const harness = reportHarness(true, { failFirstSourceDelete: true })
  await assert.rejects(
    harness.service.create({ task: TASK, result: RESULT }),
    fixedHttpError(503, 'CONTRACT_REVIEW_SOURCE_DELETE_RETRY'),
  )
  assert.equal(harness.pdfCalls(), 1)
  assert.ok(harness.task().resultFileId)

  const retryTask = { ...TASK, resultFileId: harness.task().resultFileId }
  const report = await harness.service.create({ task: retryTask, result: RESULT })
  assert.equal(report.fileId, harness.task().resultFileId)
  assert.equal(harness.pdfCalls(), 1, 'retry must reuse the persisted report')
  assert.equal(harness.deleted().filter((id) => id === TASK.sourceFileId).length, 2)
  assert.equal(harness.auditCalls().at(-1)?.payload.reused, true)
})

test('concurrent report requests keep one winner and delete the losing derived file', async () => {
  let release!: () => void
  const bothRendering = new Promise<void>((resolve) => { release = resolve })
  const harness = reportHarness(true, {
    async beforeRender(call) {
      if (call === 2) release()
      await bothRendering
    },
  })

  const [left, right] = await Promise.all([
    harness.service.create({ task: { ...TASK }, result: RESULT }),
    harness.service.create({ task: { ...TASK }, result: RESULT }),
  ])
  assert.equal(left.fileId, right.fileId)
  assert.equal(harness.pdfCalls(), 2)
  assert.equal(harness.artifactIds().length, 2)
  const loser = harness.artifactIds().find((id) => id !== left.fileId)
  assert.ok(loser)
  assert.ok(harness.deleted().includes(loser))
  assert.equal(harness.task().resultFileId, left.fileId)
})

test('abandon capability deletes an unsubmitted report and is idempotent', async () => {
  const fileId = 'report-abandon-1'
  const deleted: string[] = []
  let deletedAt: Date | null = null
  const service = abandonHarness({
    fileId,
    read: () => ({ id: fileId, purpose: 'contract_review_report', deletedAt }),
    deleteFile: async (id) => {
      deleted.push(id)
      deletedAt = new Date()
    },
  })
  const token = signContractReportAbandonToken(fileId).token

  assert.deepEqual(await service.abandon(fileId, token), {
    fileId, deleted: true, protectedByPrintTask: false,
  })
  assert.deepEqual(await service.abandon(fileId, token), {
    fileId, deleted: true, protectedByPrintTask: false,
  })
  assert.deepEqual(deleted, [fileId])
})

test('abandon capability is enumeration-safe and never deletes after a print task exists', async () => {
  const fileId = 'report-protected-1'
  const service = abandonHarness({
    fileId,
    hasPrintTask: true,
    read: () => ({ id: fileId, purpose: 'contract_review_report', deletedAt: null }),
  })
  await assert.rejects(
    service.abandon(fileId, 'invalid'),
    fixedHttpError(404, 'CONTRACT_REVIEW_REPORT_NOT_FOUND'),
  )
  const token = signContractReportAbandonToken(fileId).token
  assert.deepEqual(await service.abandon(fileId, token), {
    fileId, deleted: false, protectedByPrintTask: true,
  })
})

function reportHarness(enabled: boolean, options: {
  failFirstSourceDelete?: boolean
  beforeRender?: (call: number) => Promise<void>
} = {}) {
  const task = { ...TASK }
  const artifacts = new Map<string, ContractReviewReportView>()
  const deletedIds: string[] = []
  const auditEntries: Array<{ payload: Record<string, unknown> }> = []
  let pdfCalls = 0
  let sourceDeleteCalls = 0

  const prisma = {
    contractReviewTask: {
      async updateMany(args: {
        where: { id: string; status?: string; resultFileId?: string | null; expiresAt?: { gt: Date } }
        data: { resultFileId: string | null }
      }) {
        const matches =
          args.where.id === task.id &&
          (args.where.status === undefined || args.where.status === task.status) &&
          (args.where.resultFileId === undefined || args.where.resultFileId === task.resultFileId) &&
          (args.where.expiresAt === undefined || task.expiresAt > args.where.expiresAt.gt)
        if (!matches) return { count: 0 }
        task.resultFileId = args.data.resultFileId
        return { count: 1 }
      },
      async findUnique() {
        return { ...task }
      },
    },
  }
  const pdf = {
    async render() {
      pdfCalls += 1
      await options.beforeRender?.(pdfCalls)
      return { buffer: Buffer.from(`pdf-${pdfCalls}`), pageCount: 1 }
    },
  }
  const reportFiles = {
    async create() {
      const fileId = `report-${artifacts.size + 1}`
      const report: ContractReviewReportView = {
        fileId,
        filename: '合同风险提示报告.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        pages: 1,
        expiresAt: task.expiresAt.toISOString(),
        printFileUrl: `/api/v1/files/${fileId}/content?expires=1&sig=test`,
        abandonToken: '1.test',
        abandonTokenExpiresAt: task.expiresAt.toISOString(),
      }
      artifacts.set(fileId, report)
      return report
    },
    async getAvailable(args: { fileId: string }) {
      return deletedIds.includes(args.fileId) ? null : artifacts.get(args.fileId) ?? null
    },
  }
  const files = {
    async systemDeleteSensitive(fileId: string) {
      deletedIds.push(fileId)
      if (fileId === TASK.sourceFileId) {
        sourceDeleteCalls += 1
        if (options.failFirstSourceDelete && sourceDeleteCalls === 1) throw new Error('storage unavailable')
        if (sourceDeleteCalls > 1 && !options.failFirstSourceDelete) {
          throw new NotFoundException({ error: { code: 'FILE_NOT_FOUND' } })
        }
      }
      return { id: fileId }
    },
  }
  const audit = {
    async write(entry: { payload: Record<string, unknown> }) {
      auditEntries.push(entry)
      return 'audit-1'
    },
  }
  const service = new ContractReviewReportService(
    prisma as never,
    pdf as never,
    reportFiles as never,
    files as never,
    audit as never,
    enabled,
  )
  return {
    service,
    task: () => ({ ...task }),
    pdfCalls: () => pdfCalls,
    deleted: () => [...deletedIds],
    artifactIds: () => [...artifacts.keys()],
    auditCalls: () => [...auditEntries],
  }
}

function abandonHarness(options: {
  fileId: string
  hasPrintTask?: boolean
  read(): { id: string; purpose: string; deletedAt: Date | null } | null
  deleteFile?(fileId: string): Promise<void>
}) {
  const prisma = {
    fileObject: { async findUnique() { return options.read() } },
    printTask: { async findFirst() { return options.hasPrintTask ? { id: 'print-1' } : null } },
  }
  const files = {
    async systemDeleteSensitive(fileId: string) { await options.deleteFile?.(fileId) },
  }
  const audit = { async write() { return 'audit-1' } }
  return new ContractReviewReportService(
    prisma as never,
    {} as never,
    {} as never,
    files as never,
    audit as never,
    true,
  )
}

function fixedHttpError(status: number, code: string) {
  return (error: unknown) => {
    if (!(error instanceof HttpException) || error.getStatus() !== status) return false
    const response = error.getResponse() as { error?: { code?: string } }
    return response.error?.code === code
  }
}
