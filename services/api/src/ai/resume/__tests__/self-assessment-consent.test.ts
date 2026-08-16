// ============================================================
// 自我探索 · 版本化同意 + 记录追加 —— 门禁（S3-CONSENT）
//
// 本门禁只守两件会造成实质合规/数据事故的事，其余交给既有门禁：
//
//  A. 【版本化同意】旧版本同意**不得**被当成新版本同意。
//     只存一个布尔 `consented:true` 的系统，在同意书改版后会把用户对旧说明的
//     同意当成对新说明的同意 —— 用户从未看过新条款，系统却按「已同意」放行。
//     这里逐条钉死：显式旧版本被拒、缺省版本不被静默升级、回读不粉饰。
//
//  B. 【记录追加】`/append` 不得成为覆盖写，并发追加不得互相丢失。
//     并附带证明 append 产出带 `printFileUrl`（内部 HMAC URL），
//     否则「去打印工作台核价」是一个点了必然失败的按钮（PR #622 §一）。
//
// 运行：pnpm --filter @ai-job-print/api verify:self-assessment-consent
// 纯内存 + mock，不连库、不调 LLM、不写对象存储。
// ============================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BadRequestException } from '@nestjs/common'
import { PDFDocument } from 'pdf-lib'

process.env['FILE_SIGNING_SECRET'] ??= 'test-file-signing-secret-at-least-32-chars'

import {
  SelfAssessmentService,
  isConsentCurrent,
  type SelfAssessmentSubmitInput,
} from '../self-assessment.service'
import { AppendedSelfAssessmentService } from '../appended-self-assessment.service'
import { SELF_ASSESSMENT_CONSENT_VERSION } from '../self-assessment.types'

const repoRoot = resolve(__dirname, '../../../../../..')
const CURRENT = SELF_ASSESSMENT_CONSENT_VERSION
/** 一个「上一版同意书」的版本号。它必须永远打不开当前的门。 */
const STALE = 'sa-consent-v0.2026-01-01'

// ── mock 基础设施 ────────────────────────────────────────────────────

interface StoredRow {
  id: string
  taskId: string
  kind: string
  status: string
  payloadJson: string
  endUserId: string | null
  accessTokenHash: string | null
  expiresAt: Date
}

interface AuditEvent {
  action: string
  targetId: string
  payload: unknown
}

function makeHarness() {
  const rows: StoredRow[] = []
  const audits: AuditEvent[] = []
  const uploads: Array<{ fileId: string; filename: string; buffer: Buffer }> = []
  let uploadSeq = 0

  const prisma = {
    aiResumeResult: {
      create: async ({ data }: { data: Omit<StoredRow, 'id'> }) => {
        const row: StoredRow = { id: `row-${rows.length + 1}`, ...data }
        rows.push(row)
        return row
      },
      findUnique: async ({ where }: { where: { taskId_kind: { taskId: string; kind: string } } }) =>
        rows.find((r) => r.taskId === where.taskId_kind.taskId && r.kind === where.taskId_kind.kind) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<StoredRow> }) => {
        const row = rows.find((r) => r.id === where.id)
        if (row) Object.assign(row, data)
        return row
      },
    },
    fileObject: {
      findUnique: async () => ({
        id: 'resume-file-1',
        filename: 'resume.pdf',
        mimeType: 'application/pdf',
        endUserId: null,
        deletedAt: null,
      }),
    },
  }

  const audit = { write: async (e: AuditEvent) => { audits.push(e) } }

  const files = {
    upload: async (args: { buffer: Buffer; filename: string }) => {
      // 真实实现里 objectKey 由 randomUUID() 派生（files.service.ts:139），
      // 每次上传都是一行新 FileObject —— 这里如实建模「不按文件名覆盖」。
      uploadSeq += 1
      const fileId = `file-${uploadSeq}`
      uploads.push({ fileId, filename: args.filename, buffer: args.buffer })
      return {
        fileId,
        filename: args.filename,
        sizeBytes: args.buffer.length,
        signedUrl: `https://obj.example/${fileId}?sig=storage`,
        signedUrlExpiresAt: new Date(Date.now() + 300_000).toISOString(),
      }
    },
    readContent: async () => ({ buffer: await makePdf(1) }),
  }

  const llm = {
    summarize: async ({ scored }: { scored: { dimensions: unknown[] } }) => ({
      status: 'completed' as const,
      dimensions: scored.dimensions,
      summary: '解读摘要',
      providerName: 'mock-llm',
    }),
  }

  const pdf = { render: async () => ({ buffer: await makePdf(2), pageCount: 2 }) }
  const log = { record: () => {} }

  const service = new SelfAssessmentService(
    prisma as never, llm as never, pdf as never, files as never, audit as never, log as never,
  )
  const appendService = new AppendedSelfAssessmentService(
    prisma as never, service, files as never, audit as never,
  )
  return { service, appendService, rows, audits, uploads }
}

async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i += 1) doc.addPage([300, 400])
  return Buffer.from(await doc.save())
}

function answers(): SelfAssessmentSubmitInput['answers'] {
  const dims = ['interest', 'style', 'team', 'value', 'motivation'] as const
  return dims.flatMap((dim) =>
    Array.from({ length: 5 }, (_, idx) => ({ dim, idx, choice: 'a' as string })),
  )
}

const anon = { endUserId: null, accessToken: null }

// ════════════════════════════════════════════════════════════════════
// A. 版本化同意
// ════════════════════════════════════════════════════════════════════

test('A1 持旧版本同意的提交被拒绝，而不是静默放行', async () => {
  const { service, rows, audits } = makeHarness()

  await assert.rejects(
    () => service.submit(anon, {
      answers: answers(),
      consent: { nonSensitive: true, sensitive: false, consentVersion: STALE },
    }),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException, '必须是 400，不能当成正常提交')
      assert.match(JSON.stringify(error.getResponse()), /SELF_ASSESSMENT_CONSENT_VERSION_STALE/)
      return true
    },
    '旧版本同意必须被拒绝',
  )

  // 「被拒绝」必须是真的被拒绝：没有落库、没有产生完成审计，
  // 而不是抛了个错却已经把作答存进去了。
  assert.equal(rows.length, 0, '旧版本同意不得留下任何结果行')
  assert.equal(audits.length, 0, '旧版本同意不得产生 create 审计')
})

test('A2 旧版本同意不会被「就近升级」成当前版本', async () => {
  const { service } = makeHarness()
  // 反向证明：把当前版本号交进去可以通过 —— 说明 A1 的失败来自版本不符，
  // 而不是别的什么原因（比如答案格式）让所有提交都失败。
  const ok = await service.submit(anon, {
    answers: answers(),
    consent: { nonSensitive: true, sensitive: false, consentVersion: CURRENT },
  })
  assert.equal(ok.consentVersion, CURRENT)
  assert.equal(ok.consentCurrent, true)
  assert.notEqual(ok.consentVersion, STALE, '不得把旧版本号原样存下来当成有效同意')
})

test('A3 未带版本号的提交如实记为 null，不被补写成当前版本', async () => {
  const { service, rows } = makeHarness()
  // 现网 S2-7 前端只发两个布尔。这一条守的是最隐蔽的那个洞：
  // 服务端「顺手」把当前版本号补上，等于凭空制造一份用户没做过的同意。
  const res = await service.submit(anon, {
    answers: answers(),
    consent: { nonSensitive: true, sensitive: false },
  })

  assert.equal(res.consentVersion, null, '缺省版本必须记为 null')
  assert.notEqual(res.consentVersion, CURRENT, '缺省版本绝不能被补写成当前版本')
  assert.equal(res.consentCurrent, false, '未版本化同意不算「已同意当前说明」')
  assert.equal(res.consentedAt, null)

  const stored = JSON.parse(rows[0]!.payloadJson) as { consentVersion: string | null }
  assert.equal(stored.consentVersion, null, '落库里也必须是 null，不能是当前版本')
})

test('A4 回读旧版本记录时 consentCurrent=false（同意书改版后不继承）', async () => {
  const { service, rows } = makeHarness()
  const submitted = await service.submit(anon, {
    answers: answers(),
    consent: { nonSensitive: true, sensitive: false, consentVersion: CURRENT },
  })

  // 模拟「同意书改版」：库里那条同意是在上一版本下做出的。
  const row = rows[0]!
  const payload = JSON.parse(row.payloadJson) as Record<string, unknown>
  payload['consentVersion'] = STALE
  row.payloadJson = JSON.stringify(payload)

  const read = await service.getLatest(row.taskId, {
    endUserId: null,
    accessToken: submitted.accessToken!,
  })
  assert.equal(read.consentVersion, STALE, '必须如实回报存下来的旧版本')
  assert.equal(read.consentCurrent, false, '旧版本同意读回时必须判定为「非当前」')
})

test('A4b 回读「本次改动之前落库的老行」不得被粉饰成已同意当前版本', async () => {
  const { service, rows } = makeHarness()
  const submitted = await service.submit(anon, {
    answers: answers(),
    consent: { nonSensitive: true, sensitive: false, consentVersion: CURRENT },
  })

  // 生产库里**已经存在**的行根本没有 consentVersion 这个字段（本批之前写入）。
  // 这才是真正有风险的人群：回读时若用 `?? 当前版本` 兜底，等于凭空给他们
  // 补了一份对当前说明的同意。A4 用的是「显式旧版本」，覆盖不到这条路径。
  const row = rows[0]!
  const payload = JSON.parse(row.payloadJson) as Record<string, unknown>
  delete payload['consentVersion']
  delete payload['consentedAt']
  row.payloadJson = JSON.stringify(payload)

  const read = await service.getLatest(row.taskId, {
    endUserId: null,
    accessToken: submitted.accessToken!,
  })
  assert.equal(read.consentVersion, null, '缺字段的老行必须回 null，不得用当前版本兜底')
  assert.equal(read.consentCurrent, false, '老行不得被判定为「已同意当前说明」')
})

test('A5 版本判定是严格相等，不做前缀/大小写/子串兼容', () => {
  assert.equal(isConsentCurrent(CURRENT), true)
  for (const near of [
    null, undefined, '', STALE,
    CURRENT.toUpperCase(),
    CURRENT.slice(0, CURRENT.length - 1),   // 前缀
    `${CURRENT} `,                          // 尾随空格
    `${CURRENT}.1`,                         // 后缀
  ]) {
    assert.equal(isConsentCurrent(near as string | null), false, `${String(near)} 不得判为当前版本`)
  }
})

test('A6 同意版本号三处逐字相等（单一真源，不多处硬编码）', () => {
  const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8')
  const pick = (src: string, file: string) => {
    const m = src.match(/SELF_ASSESSMENT_CONSENT_VERSION\s*=\s*'([^']+)'/)
    assert.ok(m, `${file} 必须声明 SELF_ASSESSMENT_CONSENT_VERSION`)
    return m![1]
  }
  const shared = pick(read('packages/shared/src/types/selfAssessment.ts'), 'packages/shared')
  const api = pick(read('services/api/src/ai/resume/self-assessment.types.ts'), 'services/api')
  const kiosk = pick(read('apps/kiosk/src/pages/resume/selfAssessmentSession.ts'), 'apps/kiosk')

  assert.equal(api, shared, '服务端 CJS 镜像与 packages/shared 真源必须逐字相等')
  assert.equal(kiosk, shared, '前端同意版本号与 packages/shared 真源必须逐字相等')
  assert.equal(shared, CURRENT)
})

test('A7 审计只记「同意了哪个版本」，不记作答内容', async () => {
  const { service, audits } = makeHarness()
  await service.submit(anon, {
    answers: answers(),
    consent: { nonSensitive: true, sensitive: false, consentVersion: CURRENT },
  })
  const created = audits.find((a) => a.action === 'resume.self_assessment_create')
  assert.ok(created, '必须写创建审计')
  const body = JSON.stringify(created.payload)
  assert.match(body, /consentVersion/, '审计要能回答「同意的是哪一版」')
  // 作答内容（维度 key + 选项）绝不能出现在审计正文里。
  for (const leak of ['"choice"', 'interest', 'motivation', 'answersHash']) {
    assert.ok(!body.includes(leak), `审计正文不得含作答内容：${leak}`)
  }
})

// ════════════════════════════════════════════════════════════════════
// B. 记录追加
// ════════════════════════════════════════════════════════════════════

async function seedAssessment(h: ReturnType<typeof makeHarness>) {
  const res = await h.service.submit(anon, {
    answers: answers(),
    consent: { nonSensitive: true, sensitive: false, consentVersion: CURRENT },
  })
  return { taskId: res.taskId, accessToken: res.accessToken! }
}

test('B1 并发 append 互不覆盖，两次产出各自独立留存', async () => {
  const h = makeHarness()
  const { taskId, accessToken } = await seedAssessment(h)
  const requester = { endUserId: null, accessToken }

  const [a, b] = await Promise.all([
    h.appendService.appendToResume({ taskId, requester, resumeFileId: 'resume-file-1' }),
    h.appendService.appendToResume({ taskId, requester, resumeFileId: 'resume-file-1' }),
  ])

  assert.notEqual(a.fileId, b.fileId, '并发追加必须各自得到独立 fileId，不能互相覆盖')
  assert.equal(h.uploads.length, 2, '两次追加必须留下两份产出，不能只剩最后一份')
  const ids = new Set(h.uploads.map((u) => u.fileId))
  assert.equal(ids.size, 2, '产出 fileId 不得重复（重复即意味着覆盖写）')
  for (const u of h.uploads) assert.ok(u.buffer.length > 0, '任一份产出都不得为空')
})

test('B2 append 不修改自我探索原记录（追加不是覆盖）', async () => {
  const h = makeHarness()
  const { taskId, accessToken } = await seedAssessment(h)
  const before = h.rows[0]!.payloadJson

  await h.appendService.appendToResume({
    taskId, requester: { endUserId: null, accessToken }, resumeFileId: 'resume-file-1',
  })

  assert.equal(h.rows.length, 1, 'append 不得新增/替换自我探索结果行')
  assert.equal(h.rows[0]!.payloadJson, before, 'append 不得改写已有作答结果')
})

test('B3 append 产出带内部 HMAC printFileUrl，且不与预览 signedUrl 混用', async () => {
  const h = makeHarness()
  const { taskId, accessToken } = await seedAssessment(h)
  const out = await h.appendService.appendToResume({
    taskId, requester: { endUserId: null, accessToken }, resumeFileId: 'resume-file-1',
  })

  assert.ok(out.printFileUrl, '缺 printFileUrl ⇒ 打印工作台链路必然失败')
  assert.match(out.printFileUrl, /^\/api\/v1\/files\/.+\/content\?expires=\d+&sig=[0-9a-f]{64}$/,
    'printFileUrl 必须是内部 HMAC 签名 URL')
  assert.notEqual(out.printFileUrl, out.signedUrl, 'printFileUrl 与预览 signedUrl 是两条链路，不可互换')
  assert.ok(!out.signedUrl.includes('/api/v1/files/'), '预览 URL 不得冒充内部打印 URL')
})

test('B4 合并页数 = 简历页数 + 报告页数（内容真的被追加了）', async () => {
  const h = makeHarness()
  const { taskId, accessToken } = await seedAssessment(h)
  await h.appendService.appendToResume({
    taskId, requester: { endUserId: null, accessToken }, resumeFileId: 'resume-file-1',
  })
  const merged = await PDFDocument.load(h.uploads.at(-1)!.buffer)
  // mock 简历 1 页 + mock 报告 2 页；页数变少即说明发生了替换而非追加。
  assert.equal(merged.getPageCount(), 3, '合并结果必须包含简历与报告全部页面')
})
