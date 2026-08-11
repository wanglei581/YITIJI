import 'reflect-metadata'

import assert from 'node:assert/strict'
import { ServiceUnavailableException } from '@nestjs/common'
import { AiService } from '../src/ai/ai.service'

const REPORT = {
  sections: [{ key: 'basic', label: '基础信息', score: 8, maxScore: 10 }],
  suggestions: ['补齐联系方式'],
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof ServiceUnavailableException)) return undefined
  const response = error.getResponse() as { error?: { code?: string } }
  return response.error?.code
}

function makeHarness(options: { failPersist: boolean; seedParse?: boolean }) {
  const rows = new Map<string, Record<string, unknown>>()
  if (options.seedParse) {
    rows.set('task-optimize:parse', {
      taskId: 'task-optimize',
      kind: 'parse',
      status: 'completed',
      payloadJson: JSON.stringify({
        taskId: 'task-optimize',
        status: 'completed',
        fileId: 'file-1',
        report: REPORT,
      }),
      provider: 'mock',
      expiresAt: new Date(Date.now() + 60_000),
      endUserId: 'member-1',
      accessTokenHash: null,
    })
  }

  const prisma = {
    aiResumeResult: {
      findUnique: async ({ where }: { where: { taskId_kind: { taskId: string; kind: string } } }) =>
        rows.get(`${where.taskId_kind.taskId}:${where.taskId_kind.kind}`) ?? null,
      upsert: async (args: {
        where: { taskId_kind: { taskId: string; kind: string } }
        create: Record<string, unknown>
        update: Record<string, unknown>
      }) => {
        if (options.failPersist) throw new Error('controlled database write failure')
        const key = `${args.where.taskId_kind.taskId}:${args.where.taskId_kind.kind}`
        const existing = rows.get(key)
        const row = existing ? { ...existing, ...args.update } : { ...args.create }
        rows.set(key, row)
        return row
      },
    },
  }

  const provider = {
    name: 'mock',
    parseResume: async () => ({
      taskId: 'task-parse',
      status: 'completed' as const,
      report: REPORT,
    }),
    optimizeResume: async (taskId: string) => ({
      taskId,
      status: 'completed' as const,
      modules: [{ title: '表达优化', before: '原文', after: '优化文' }],
    }),
    generateResume: async () => ({
      taskId: 'task-generate',
      status: 'completed' as const,
      resume: {
        basic: { name: '测试用户' },
        intention: { position: '测试岗位' },
        summary: '测试简介',
        education: [],
        experience: [],
        projects: [],
        skills: [],
        certificates: [],
      },
      missingHints: [],
    }),
  }
  const logEntries: Array<{ status?: string; operation?: string }> = []
  const logService = {
    record: (entry: { status?: string; operation?: string }) => logEntries.push(entry),
  }
  const unused = {} as never

  process.env['AI_PROVIDER'] = 'mock'
  const service = new AiService(
    provider as never,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    logService as never,
    unused,
    unused,
    unused,
    unused,
    unused,
    prisma as never,
    unused,
    unused,
    unused
  )
  return { service, rows, logEntries }
}

async function expectPersistenceFailure(
  action: () => Promise<unknown>,
  label: string
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.equal(errorCode(error), 'AI_RESULT_PERSISTENCE_FAILED', label)
    return true
  })
}

async function main(): Promise<void> {
  const normal = makeHarness({ failPersist: false })
  const parsed = await normal.service.submitResumeParse(
    {
      fileId: 'file-1',
      fileName: 'resume.pdf',
      fileFormat: 'pdf',
      source: 'upload',
    },
    'member-1'
  )
  assert.equal(parsed.status, 'completed')
  assert.ok(normal.rows.has('task-parse:parse'))

  const parseFailure = makeHarness({ failPersist: true })
  await expectPersistenceFailure(
    () =>
      parseFailure.service.submitResumeParse(
        {
          fileId: 'file-1',
          fileName: 'resume.pdf',
          fileFormat: 'pdf',
          source: 'upload',
        },
        'member-1'
      ),
    'parse must not report an unpersisted result as success'
  )
  assert.equal(parseFailure.logEntries.at(-1)?.status, 'failed')

  const optimizeFailure = makeHarness({ failPersist: true, seedParse: true })
  await expectPersistenceFailure(
    () =>
      optimizeFailure.service.getResumeOptimize('task-optimize', {
        endUserId: 'member-1',
        accessToken: null,
      }),
    'optimize must not report an unpersisted result as success'
  )
  assert.equal(optimizeFailure.logEntries.at(-1)?.status, 'failed')

  const generateFailure = makeHarness({ failPersist: true })
  await expectPersistenceFailure(
    () =>
      generateFailure.service.submitResumeGenerate(
        {
          basic: { name: '测试用户' },
          intention: { position: '测试岗位' },
          education: [],
          experience: [],
          projects: [],
          skills: [],
          certificates: [],
        },
        'member-1'
      ),
    'generate must not report an unpersisted result as success'
  )
  assert.equal(generateFailure.logEntries.at(-1)?.status, 'failed')

  console.log('PASS: AI completed results are returned only after durable persistence')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
