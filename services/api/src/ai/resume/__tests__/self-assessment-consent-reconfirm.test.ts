// ============================================================
// 已存自我探索记分再送进新的职业规划生成之前，同意必须仍是当前版本；不是就这次不纳入，规划照常生成。
//
// 单独成文件：self-assessment-consent.test.ts 已经超过 600 行，这里走的是
// CareerPlanService.generate，不是自我探索提交。不放进职业规划自己的门禁脚本：
// 这条口径要和版本化同意一起跑，仍挂在 verify:self-assessment-consent，
// 不新增门禁名，也不改 CI。
//
// 纯内存 + mock，不连库、不调模型。
// ============================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

process.env['FILE_SIGNING_SECRET'] ??= 'test-file-signing-secret-at-least-32-chars'

import { CareerPlanService } from '../career-plan.service'
import { SELF_ASSESSMENT_CONSENT_VERSION } from '../self-assessment.types'

const PREVIOUS_VERSION = 'sa-consent-v1.2026-09-29'
const LEGACY_VERSION = 'sa-consent-v1.2026-08-16'
const ANON_TOKEN = 'anon-self-assessment-token'
const ANON_HASH = createHash('sha256').update(ANON_TOKEN, 'utf8').digest('hex')

interface Dim {
  key: string
  label: string
  strength: number
}

type Stored = { present: false } | { present: true; consentVersion: string | null; dimensions: Dim[] }

function makePlan(stored: Stored, anonymous = false) {
  const builds: Array<{ selfAssessment: { dimensions: Dim[] } | null }> = []
  const upserts: unknown[] = []
  const scoreDims: Dim[] = [{ key: 'interest', label: '兴趣偏好', strength: 4 }]
  const sa = stored.present
    ? {
        payloadJson: JSON.stringify({
          dimensions: stored.dimensions,
          consentVersion: stored.consentVersion,
        }),
        expiresAt: new Date(Date.now() + 3_600_000),
        createdAt: new Date(),
      }
    : null
  const parseRow = {
    endUserId: anonymous ? null : 'member-1',
    accessTokenHash: anonymous ? ANON_HASH : null,
    expiresAt: new Date(Date.now() + 3_600_000),
    payloadJson: JSON.stringify({ fileId: 'resume-file-1' }),
  }
  const prisma = {
    aiResumeResult: {
      findUnique: async ({ where }: { where: { taskId_kind: { kind: string } } }) =>
        where.taskId_kind.kind === 'parse' ? parseRow : null,
      findFirst: async ({ where }: { where: { kind?: string } }) => {
        if (where && Object.prototype.hasOwnProperty.call(where, 'kind') && String(where.kind).includes('self_')) {
          return sa
        }
        return null
      },
      upsert: async (args: unknown) => {
        upserts.push(args)
        return { id: 'plan-1' }
      },
    },
    mockInterviewSession: { findFirst: async () => null },
  }
  const llm = {
    build: async (ctx: { selfAssessment: { dimensions: Dim[] } | null }) => {
      builds.push({ selfAssessment: ctx.selfAssessment })
      return {
        summary: '仅供参考',
        currentSnapshot: [],
        directions: [],
        skillPlan: [],
        actionChecklist: [],
      }
    },
  }
  const extraction = { extractResumeText: async () => ({ ok: true as const, text: '做过行政工作三年' }) }
  const files = {
    upload: async (args: { filename: string; buffer: Buffer }) => ({
      fileId: 'printed-1',
      filename: args.filename,
      sizeBytes: args.buffer.length,
      signedUrl: 'https://obj.example/printed-1',
      signedUrlExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    }),
  }
  const degradedPdf = { render: async () => ({ buffer: Buffer.from('%PDF-1.4'), pageCount: 1 }) }
  const audit = { write: async () => undefined }
  const aiLog = { record: () => undefined }
  const service = new CareerPlanService(
    prisma as never,
    llm as never,
    extraction as never,
    files as never,
    {} as never,
    audit as never,
    aiLog as never,
    degradedPdf as never,
  )
  const requester = anonymous
    ? { endUserId: null, accessToken: ANON_TOKEN }
    : { endUserId: 'member-1', accessToken: null }
  return { service, requester, builds, upserts, scoreDims }
}

async function assertNotIncluded(stored: Stored, anonymous = false): Promise<void> {
  const { service, requester, builds, upserts } = makePlan(stored, anonymous)
  const out = await service.generate('task-1', requester)
  assert.equal(out.status, 'completed', '职业规划照常生成，不因旧同意整单拒绝')
  assert.equal((out as { selfAssessmentExcluded?: string | null }).selfAssessmentExcluded, 'consent_outdated', '如实标出没纳入的原因，不悄悄降级')
  assert.equal(builds.length, 1)
  assert.equal(builds[0]!.selfAssessment, null, '旧版本同意的记分不得送进模型')
  assert.equal(upserts.length, 1)
  const saved = JSON.parse((upserts[0] as { create: { payloadJson: string } }).create.payloadJson) as { basedOn?: { selfAssessment?: string | null } }
  assert.equal(saved.basedOn?.selfAssessment ?? null, null, '依据栏如实不写自我探索')
}

test('R1 #1119 版本、更早版本和未版本化同意：规划照常生成，但不纳入自我探索记分', async () => {
  const dims: Dim[] = [{ key: 'interest', label: '兴趣偏好', strength: 4 }]
  await assertNotIncluded({ present: true, consentVersion: PREVIOUS_VERSION, dimensions: dims })
  await assertNotIncluded({ present: true, consentVersion: LEGACY_VERSION, dimensions: dims })
  await assertNotIncluded({ present: true, consentVersion: null, dimensions: dims })
})

test('R1b 匿名路径上的旧版本记分同样不纳入', async () => {
  await assertNotIncluded(
    { present: true, consentVersion: PREVIOUS_VERSION, dimensions: [{ key: 'interest', label: '兴趣偏好', strength: 2 }] },
    true,
  )
})

test('R2 当前版本的记分可以送进模型', async () => {
  const { service, requester, builds, upserts } = makePlan({
    present: true,
    consentVersion: SELF_ASSESSMENT_CONSENT_VERSION,
    dimensions: [{ key: 'interest', label: '兴趣偏好', strength: 4 }],
  })
  const out = await service.generate('task-1', requester)
  assert.equal(out.status, 'completed')
  assert.equal(builds.length, 1)
  assert.equal(builds[0]!.selfAssessment?.dimensions[0]?.key, 'interest')
  assert.equal(builds[0]!.selfAssessment?.dimensions[0]?.strength, 4)
  assert.equal((out as { selfAssessmentExcluded?: string | null }).selfAssessmentExcluded, null, '当前版本纳入时不带排除标记')
  assert.equal(upserts.length, 1)
})

test('R3 没有记录或没有记分时照常生成', async () => {
  for (const stored of [
    { present: false } as Stored,
    { present: true, consentVersion: PREVIOUS_VERSION, dimensions: [] } as Stored,
  ]) {
    const { service, requester, builds } = makePlan(stored)
    const out = await service.generate('task-1', requester)
    assert.equal(out.status, 'completed')
    assert.equal(builds.length, 1)
    assert.equal(builds[0]!.selfAssessment, null)
    assert.equal((out as { selfAssessmentExcluded?: string | null }).selfAssessmentExcluded, null, '本来就没有可用记分时不是「因说明更新没纳入」')
  }
})

test('R4 旧版本记分仍可打降级纸（不调模型）', async () => {
  const { service, requester, builds, upserts } = makePlan({
    present: true,
    consentVersion: LEGACY_VERSION,
    dimensions: [{ key: 'style', label: '工作风格', strength: 3 }],
  })
  const printed = await service.printPlan('task-1', requester)
  assert.equal(printed.variant, 'degraded')
  assert.match(printed.printFileUrl, /^\/api\/v1\/files\/.+\/content\?expires=\d+&sig=[0-9a-f]{64}$/)
  assert.equal(builds.length, 0, '降级纸不得调用模型')
  assert.equal(upserts.length, 0)
})

test('R5 当前版本判定只写在生成里，读回和打印那段源码不调用', () => {
  const src = readFileSync(resolve(__dirname, '../career-plan.service.ts'), 'utf8')
  const generateAt = src.indexOf('async generate(')
  const latestAt = src.indexOf('async getLatest(')
  assert.ok(generateAt >= 0 && latestAt > generateAt)
  const generateBody = src.slice(generateAt, latestAt)
  const afterRead = src.slice(latestAt)
  assert.match(generateBody, /selfAssessmentForNewAi\(/)
  assert.equal(afterRead.includes('selfAssessmentForNewAi('), false)
})
