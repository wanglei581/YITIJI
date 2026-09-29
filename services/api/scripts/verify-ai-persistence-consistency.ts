import 'reflect-metadata'

import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import { AiService, type ResumeParseIntentBinding } from '../src/ai/ai.service'

const REPORT = {
  sections: [{ key: 'basic', label: '基础信息', score: 8, maxScore: 10 }],
  suggestions: ['补齐联系方式'],
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined
  const response = error.getResponse() as { error?: { code?: string } }
  return response.error?.code
}

const PARSE_INPUT = {
  fileId: 'file-1',
  fileName: 'resume.pdf',
  fileFormat: 'pdf',
  source: 'upload' as const,
}
const INTENT_ID = createHash('sha256').update('intent').digest('hex')
const ANON_TOKEN = randomBytes(32).toString('base64url')

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function makeHarness(options: { failPersist: boolean; seedParse?: boolean; extractionFailure?: boolean }) {
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

  let providerCalls = 0
  const provider = {
    name: options.extractionFailure ? 'llm' : 'mock',
    parseResume: async () => {
      providerCalls += 1
      return {
        taskId: 'task-parse',
        status: 'completed' as const,
        report: REPORT,
      }
    },
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

  const extraction = {
    extractResumeText: async () => ({
      ok: false as const,
      errorCode: 'FILE_NOT_FOUND',
      errorMessage: '文件已失效',
    }),
  }
  process.env['AI_PROVIDER'] = options.extractionFailure ? 'llm' : 'mock'
  const service = new AiService(
    provider as never,
    unused,
    unused,
    unused,
    unused,
    unused,
    provider as never,
    logService as never,
    unused,
    unused,
    extraction as never,
    unused,
    unused,
    prisma as never,
    unused,
    unused,
    unused
  )
  return { service, rows, logEntries, providerCalls: () => providerCalls }
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
  assert.equal(parsed.taskId, 'task-parse')
  assert.equal(parsed.accessToken, undefined)
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

  const memberIntent = makeHarness({ failPersist: false })
  const memberBound: ResumeParseIntentBinding = { intentId: INTENT_ID, accessToken: null }
  const memberParsed = await memberIntent.service.submitResumeParse(PARSE_INPUT, 'member-1', memberBound)
  const memberRow = memberIntent.rows.get(`${INTENT_ID}:parse`)
  const memberPayload = JSON.parse(String(memberRow?.['payloadJson'])) as { taskId?: string; accessToken?: string }
  assert.equal(memberParsed.taskId, INTENT_ID)
  assert.equal(memberParsed.accessToken, undefined)
  assert.equal(memberIntent.rows.has('task-parse:parse'), false)
  assert.equal(memberRow?.['taskId'], INTENT_ID)
  assert.equal(memberRow?.['accessTokenHash'], null)
  assert.equal(memberPayload.taskId, INTENT_ID)
  assert.equal(memberPayload.accessToken, undefined)

  const anonIntent = makeHarness({ failPersist: false })
  const anonParsed = await anonIntent.service.submitResumeParse(PARSE_INPUT, null, {
    intentId: INTENT_ID,
    accessToken: ANON_TOKEN,
  })
  const anonRow = anonIntent.rows.get(`${INTENT_ID}:parse`)
  const anonPayloadJson = String(anonRow?.['payloadJson'])
  const anonPayload = JSON.parse(anonPayloadJson) as { taskId?: string; accessToken?: string }
  assert.equal(anonParsed.taskId, INTENT_ID)
  assert.equal(anonParsed.accessToken, ANON_TOKEN)
  assert.equal(anonRow?.['taskId'], INTENT_ID)
  assert.equal(anonRow?.['accessTokenHash'], sha256(ANON_TOKEN))
  assert.equal(anonPayload.taskId, INTENT_ID)
  assert.equal(anonPayload.accessToken, undefined)
  assert.equal(anonPayloadJson.includes(ANON_TOKEN), false)

  const intentPersistFailure = makeHarness({ failPersist: true })
  await expectPersistenceFailure(
    () => intentPersistFailure.service.submitResumeParse(PARSE_INPUT, 'member-1', memberBound),
    'intent parse must not report an unpersisted result as success',
  )
  assert.equal(intentPersistFailure.rows.has(`${INTENT_ID}:parse`), false)
  assert.equal(intentPersistFailure.logEntries.at(-1)?.status, 'failed')

  const extractFailure = makeHarness({ failPersist: false, extractionFailure: true })
  const extracted = await extractFailure.service.submitResumeParse(PARSE_INPUT, null, {
    intentId: INTENT_ID,
    accessToken: ANON_TOKEN,
  })
  const extractedRow = extractFailure.rows.get(`${INTENT_ID}:parse`)
  const extractedPayloadJson = String(extractedRow?.['payloadJson'])
  assert.equal(extractFailure.providerCalls(), 0)
  assert.equal(extracted.status, 'failed')
  assert.equal(extracted.taskId, INTENT_ID)
  assert.equal(extracted.accessToken, ANON_TOKEN)
  assert.equal(extractedRow?.['taskId'], INTENT_ID)
  assert.equal(JSON.parse(extractedPayloadJson).taskId, INTENT_ID)
  assert.equal(extractedRow?.['accessTokenHash'], sha256(ANON_TOKEN))
  assert.equal(extractedPayloadJson.includes(ANON_TOKEN), false)
  assert.equal(extractFailure.rows.has('task-parse:parse'), false)

  const nullToken = makeHarness({ failPersist: false })
  await assert.rejects(
    () => nullToken.service.submitResumeParse(PARSE_INPUT, null, { intentId: INTENT_ID, accessToken: null }),
    (error: unknown) => errorCode(error) === 'RESUME_PARSE_INTENT_BINDING_INVALID',
  )
  assert.equal(nullToken.providerCalls(), 0)
  assert.equal(nullToken.rows.size, 0)

  const badIntent = makeHarness({ failPersist: false })
  await assert.rejects(
    () => badIntent.service.submitResumeParse(PARSE_INPUT, null, { intentId: 'not-a-hash', accessToken: ANON_TOKEN }),
    (error: unknown) => errorCode(error) === 'RESUME_PARSE_INTENT_BINDING_INVALID',
  )
  assert.equal(badIntent.providerCalls(), 0)
  assert.equal(badIntent.rows.size, 0)

  console.log('PASS: AI completed results are returned only after durable persistence')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
