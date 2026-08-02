import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ContractReviewCleanupTask } from '../contract-review.cleanup.task'

const NOW = new Date('2026-08-01T12:00:00.000Z')

type TaskRow = {
  id: string
  status: string
  expiresAt: Date
  sourceFileId: string
  resultFileId: string | null
}

type FileRow = { id: string; deletedAt: Date | null }

test('keeps an expired task after one file deletion fails and retries it next run', async () => {
  const task = expiredTask('task-retry', 'source-retry')
  let attempts = 0
  const harness = createHarness([task], [{ id: task.sourceFileId, deletedAt: null }], {
    async deleteFile(fileId) {
      attempts += 1
      if (attempts === 1) throw new Error(`storage failure for ${fileId}`)
      harness.fileRows.get(fileId)!.deletedAt = NOW
    },
  })

  const first = await harness.cleanup.runOnce(NOW)
  assert.equal(first.failedTasks, 1)
  assert.equal(harness.taskRows.get(task.id)?.status, 'expired')

  const second = await harness.cleanup.runOnce(NOW)
  assert.equal(second.deletedTasks, 1)
  assert.equal(attempts, 2)
  assert.equal(harness.taskRows.has(task.id), false)
})

test('defers physical deletion for a file shared by another unexpired contract task', async () => {
  const expired = expiredTask('task-expired', 'shared-source')
  const active = {
    ...expiredTask('task-active', 'shared-source'),
    status: 'completed',
    expiresAt: new Date('2026-08-01T13:00:00.000Z'),
  }
  const harness = createHarness([expired, active], [{ id: 'shared-source', deletedAt: null }])

  const result = await harness.cleanup.runOnce(NOW)

  assert.equal(result.sharedFiles, 1)
  assert.equal(harness.deleteCalls.length, 0)
  assert.equal(harness.taskRows.has(expired.id), false)
  assert.equal(harness.taskRows.has(active.id), true)
})

test('treats a file already deleted by generic cleanup as idempotently complete', async () => {
  const task = expiredTask('task-already-deleted', 'source-already-deleted')
  const harness = createHarness(
    [task],
    [{ id: task.sourceFileId, deletedAt: new Date('2026-08-01T11:00:00.000Z') }]
  )

  const result = await harness.cleanup.runOnce(NOW)

  assert.equal(result.deletedTasks, 1)
  assert.equal(harness.deleteCalls.length, 0)
  assert.equal(harness.taskRows.has(task.id), false)
})

test('deletes a distinct result file and de-duplicates repeated file ids', async () => {
  const taskWithResult = expiredTask('task-result', 'source-file', 'result-file')
  const duplicate = expiredTask('task-deduplicated', 'same-file', 'same-file')
  const harness = createHarness(
    [taskWithResult, duplicate],
    [
      { id: 'source-file', deletedAt: null },
      { id: 'result-file', deletedAt: null },
      { id: 'same-file', deletedAt: null },
    ]
  )

  const result = await harness.cleanup.runOnce(NOW)

  assert.equal(result.deletedFiles, 3)
  assert.deepEqual(harness.deleteCalls.sort(), ['result-file', 'same-file', 'source-file'])
})

test('processes at most one hundred expired tasks per batch with status CAS', async () => {
  const tasks = Array.from({ length: 101 }, (_, index) =>
    expiredTask(`task-${index}`, `missing-file-${index}`, null, 'completed')
  )
  const harness = createHarness(tasks, [])

  const result = await harness.cleanup.runOnce(NOW)

  assert.equal(harness.findManyArgs[0]?.take, 100)
  assert.equal(result.scanned, 100)
  assert.equal(result.deletedTasks, 100)
  assert.equal(harness.taskRows.size, 1)
  assert.equal(harness.casWrites.length, 100)
  assert.equal(harness.casWrites.every((write) => write.where.status === 'completed'), true)
  assert.equal(harness.casWrites.every((write) => write.data.status === 'expired'), true)
})

test('after deletion throws, only a database deleted marker counts as success', async () => {
  const deletedAfterThrow = expiredTask('task-deleted-after-throw', 'deleted-after-throw')
  const missingAfterThrow = expiredTask('task-missing-after-throw', 'missing-after-throw')
  const harness = createHarness(
    [deletedAfterThrow, missingAfterThrow],
    [
      { id: deletedAfterThrow.sourceFileId, deletedAt: null },
      { id: missingAfterThrow.sourceFileId, deletedAt: null },
    ],
    {
      async deleteFile(fileId) {
        if (fileId === deletedAfterThrow.sourceFileId) {
          harness.fileRows.get(fileId)!.deletedAt = NOW
        } else {
          harness.fileRows.delete(fileId)
        }
        throw new Error('sensitive storage details')
      },
    }
  )

  const result = await harness.cleanup.runOnce(NOW)

  assert.equal(result.deletedTasks, 1)
  assert.equal(result.failedTasks, 1)
  assert.equal(harness.taskRows.has(deletedAfterThrow.id), false)
  assert.equal(harness.taskRows.get(missingAfterThrow.id)?.status, 'expired')
})

test('a file database read failure keeps that task but does not stop the batch', async () => {
  const failing = expiredTask('task-read-failure', 'read-failure')
  const following = expiredTask('task-following', 'already-gone')
  const harness = createHarness([failing, following], [{ id: 'read-failure', deletedAt: null }], {
    async readFile(fileId, rows) {
      if (fileId === failing.sourceFileId) throw new Error('database endpoint details')
      return rows.get(fileId) ?? null
    },
  })

  const result = await harness.cleanup.runOnce(NOW)

  assert.equal(result.failedTasks, 1)
  assert.equal(result.deletedTasks, 1)
  assert.equal(harness.taskRows.get(failing.id)?.status, 'expired')
  assert.equal(harness.taskRows.has(following.id), false)
})

test('cleanup logs contain only fixed codes, counts and irreversible task digests', async () => {
  const taskId = 'task-secret-370101199001011234'
  const fileId = 'file-secret-370101199001011234'
  const harness = createHarness([expiredTask(taskId, fileId)], [{ id: fileId, deletedAt: null }], {
    async deleteFile() {
      throw new Error('contract.pdf at private/contracts/member-token')
    },
  })

  await harness.cleanup.runOnce(NOW)
  const output = harness.logs.join('\n')

  assert.doesNotMatch(output, new RegExp(taskId))
  assert.doesNotMatch(output, new RegExp(fileId))
  assert.doesNotMatch(output, /contract\.pdf|private\/contracts|member-token/u)
  assert.match(output, /code=CONTRACT_REVIEW_CLEANUP_FILE_FAILED/u)
  assert.match(output, /task=[a-f0-9]{12}/u)
})

function expiredTask(
  id: string,
  sourceFileId: string,
  resultFileId: string | null = null,
  status = 'expired'
): TaskRow {
  return {
    id,
    status,
    expiresAt: new Date('2026-08-01T11:00:00.000Z'),
    sourceFileId,
    resultFileId,
  }
}

function createHarness(
  tasks: TaskRow[],
  files: FileRow[],
  options: {
    deleteFile?(fileId: string): Promise<void>
    readFile?(fileId: string, rows: Map<string, FileRow>): Promise<FileRow | null>
  } = {}
) {
  const taskRows = new Map(tasks.map((row) => [row.id, { ...row }]))
  const fileRows = new Map(files.map((row) => [row.id, { ...row }]))
  const deleteCalls: string[] = []
  const logs: string[] = []
  const findManyArgs: Array<{ take: number }> = []
  const casWrites: Array<{ where: { status: string }; data: { status: string } }> = []

  const prisma = {
    contractReviewTask: {
      async findMany(args: { where: { expiresAt: { lte: Date } }; take: number }) {
        findManyArgs.push(args)
        return [...taskRows.values()]
          .filter((row) => row.expiresAt.getTime() <= args.where.expiresAt.lte.getTime())
          .slice(0, args.take)
      },
      async updateMany(args: {
        where: { id: string; status: string; expiresAt: { lte: Date } }
        data: { status: string; errorCode?: string | null; errorMessage?: string | null }
      }) {
        casWrites.push(args)
        const row = taskRows.get(args.where.id)
        if (
          !row ||
          row.status !== args.where.status ||
          row.expiresAt.getTime() > args.where.expiresAt.lte.getTime()
        ) return { count: 0 }
        row.status = args.data.status
        return { count: 1 }
      },
      async findFirst(args: {
        where: {
          id: { not: string }
          expiresAt: { gt: Date }
          OR: Array<{ sourceFileId?: string; resultFileId?: string }>
        }
      }) {
        return (
          [...taskRows.values()].find(
            (row) =>
              row.id !== args.where.id.not &&
              row.expiresAt.getTime() > args.where.expiresAt.gt.getTime() &&
              args.where.OR.some(
                (condition) =>
                  condition.sourceFileId === row.sourceFileId ||
                  condition.resultFileId === row.resultFileId
              )
          ) ?? null
        )
      },
      async deleteMany(args: { where: { id: string; status: string } }) {
        const row = taskRows.get(args.where.id)
        if (!row || row.status !== args.where.status) return { count: 0 }
        taskRows.delete(row.id)
        return { count: 1 }
      },
    },
    fileObject: {
      async findUnique(args: { where: { id: string } }) {
        if (options.readFile) return options.readFile(args.where.id, fileRows)
        return fileRows.get(args.where.id) ?? null
      },
    },
  }

  const filesService = {
    async systemDeleteSensitive(fileId: string) {
      deleteCalls.push(fileId)
      if (options.deleteFile) return options.deleteFile(fileId)
      const row = fileRows.get(fileId)
      if (row) row.deletedAt = NOW
    },
  }
  const cleanup = new ContractReviewCleanupTask(prisma as never, filesService as never)
  ;(cleanup as unknown as { logger: { log(value: string): void; warn(value: string): void } })
    .logger = {
      log: (value) => logs.push(value),
      warn: (value) => logs.push(value),
    }
  return { cleanup, taskRows, fileRows, deleteCalls, logs, findManyArgs, casWrites }
}
