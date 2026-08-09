import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ContractReportPrintLifecycleService } from '../../files/contract-report-print-lifecycle.service'
import { PrintPageCountService } from '../../print-jobs/print-page-count.service'
import { signFileUrl } from '../../files/signing'

process.env['FILE_SIGNING_SECRET'] ||= 'contract-print-lifecycle-secret-0123456789'

type TaskRow = { id: string; status: string; fileId: string | null }
type FileRow = { id: string; purpose: string; deletedAt: Date | null; createdAt: Date }

test('terminal print completion deletes its contract report immediately', async () => {
  const harness = createHarness({
    tasks: [{ id: 'print-1', status: 'completed', fileId: 'report-1' }],
    files: [report('report-1')],
  })

  await harness.service.cleanupTerminalTask('print-1')

  assert.deepEqual(harness.deleted, ['report-1'])
})

test('active print tasks protect the report from another terminal task cleanup', async () => {
  const harness = createHarness({
    tasks: [
      { id: 'print-terminal', status: 'failed', fileId: 'report-shared' },
      { id: 'print-active', status: 'printing', fileId: 'report-shared' },
    ],
    files: [report('report-shared')],
  })

  await harness.service.cleanupTerminalTask('print-terminal')

  assert.deepEqual(harness.deleted, [])
})

test('reconciler retries terminal contract reports but ignores unrelated files', async () => {
  const harness = createHarness({
    tasks: [
      { id: 'print-failed', status: 'failed', fileId: 'report-retry' },
      { id: 'print-other', status: 'completed', fileId: 'ordinary-file' },
    ],
    files: [report('report-retry'), {
      id: 'ordinary-file', purpose: 'print_doc', deletedAt: null, createdAt: new Date(),
    }],
  })

  await harness.service.handleReconcile()

  assert.deepEqual(harness.deleted, ['report-retry'])
  assert.equal(harness.findManyTake, 100)
})

test('quote and create page counting reject a contract report with less than thirty minutes left', async () => {
  const fileId = 'report-too-close-to-expiry'
  let storageReads = 0
  const service = new PrintPageCountService({
    fileObject: {
      async findUnique() {
        return {
          id: fileId,
          purpose: 'contract_review_report',
          status: 'active',
          deletedAt: null,
          expiresAt: new Date(Date.now() + 29 * 60 * 1000),
          mimeType: 'application/pdf',
          storageKey: 'private/report.pdf',
          bucket: 'private-files',
        }
      },
    },
  } as never, {
    async getObject() {
      storageReads += 1
      return Buffer.from('%PDF-1.4')
    },
  } as never)

  await assert.rejects(
    service.resolveBillablePages(signFileUrl(fileId).url),
    /PRINT_PAGE_COUNT_UNAVAILABLE/u,
  )
  assert.equal(storageReads, 0)
})

function report(id: string): FileRow {
  return { id, purpose: 'contract_review_report', deletedAt: null, createdAt: new Date() }
}

function createHarness(input: { tasks: TaskRow[]; files: FileRow[] }) {
  const tasks = new Map(input.tasks.map((row) => [row.id, row]))
  const files = new Map(input.files.map((row) => [row.id, row]))
  const deleted: string[] = []
  let findManyTake = 0
  const terminal = new Set(['completed', 'failed', 'cancelled', 'abandoned'])
  const active = new Set(['pending', 'claimed', 'printing'])
  const prisma = {
    printTask: {
      async findUnique(args: { where: { id: string } }) {
        return tasks.get(args.where.id) ?? null
      },
      async findFirst(args: { where: { fileId: string } }) {
        return [...tasks.values()].find(
          (row) => row.fileId === args.where.fileId && active.has(row.status),
        ) ?? null
      },
    },
    fileObject: {
      async findUnique(args: { where: { id: string } }) {
        return files.get(args.where.id) ?? null
      },
      async findMany(args: { take: number }) {
        findManyTake = args.take
        const candidateIds = new Set(
          [...tasks.values()]
            .filter((row) => row.fileId && terminal.has(row.status))
            .map((row) => row.fileId as string),
        )
        return [...files.values()]
          .filter((row) => (
            row.purpose === 'contract_review_report' && !row.deletedAt && candidateIds.has(row.id)
          ))
          .slice(0, args.take)
          .map(({ id }) => ({ id }))
      },
    },
  }
  const fileService = {
    async systemDeleteSensitive(fileId: string) {
      deleted.push(fileId)
      const row = files.get(fileId)
      if (row) row.deletedAt = new Date()
    },
  }
  return {
    service: new ContractReportPrintLifecycleService(prisma as never, fileService as never),
    deleted,
    get findManyTake() { return findManyTake },
  }
}
