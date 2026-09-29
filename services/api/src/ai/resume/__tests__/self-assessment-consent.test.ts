// ============================================================
// 自我探索 · 版本化同意 + 记录追加 —— 门禁（S3-CONSENT）
//
// 本门禁只守两件会造成实质合规/数据事故的事，其余交给既有门禁：
//
//  A. 【版本化同意】旧版本同意**不得**被当成新版本同意。
//     只存一个布尔 `consented:true` 的系统，在同意书改版后会把用户对旧说明的
//     同意当成对新说明的同意 —— 用户从未看过新条款，系统却按「已同意」放行。
//     这里逐条钉死：已提交的非当前版本一律拒绝（没有旧版本清单）、缺省版本
//     不被静默升级、回读不粉饰。已落库的旧版本仍可查看、打印、撤回。
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
import { readFileSync, readdirSync, statSync } from 'node:fs'
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
import { SelfAssessmentController } from '../../self-assessment.controller'
import { SELF_ASSESSMENT_CONSENT_VERSION } from '../self-assessment.types'

const repoRoot = resolve(__dirname, '../../../../../..')
const CURRENT = SELF_ASSESSMENT_CONSENT_VERSION
/** 冻结的当前版本。测试不得改用导入常量，否则把常量改回旧值时请求会跟着变绿。 */
const NEW_VERSION = 'sa-consent-v2.2026-09-29'
/** #1119 下发过的版本。取消过渡期后，用它提交必须 400。 */
const PREVIOUS_VERSION = 'sa-consent-v1.2026-09-29'
/** 更早的一体机版本。同样必须 400，不能再进白名单。 */
const LEGACY_VERSION = 'sa-consent-v1.2026-08-16'
const AGE_ITEM = '本工具面向年满 14 周岁的用户；未满 14 周岁的，请在监护人同意并陪同下使用。'
const CHECKBOX_LABEL =
  '我已阅读上述说明和《隐私政策》中的未成年人个人信息处理规则，确认本人已满 14 周岁；未满 14 周岁的，已取得监护人同意并由监护人陪同。'
const CONSENT_LINK = {
  label: '《隐私政策》中的未成年人个人信息处理规则',
  legalDocType: 'privacy_policy' as const,
  sectionTitle: '未满十四周岁未成年人个人信息处理规则',
}
const STALE_MESSAGE = '知情同意说明已更新，请重新阅读并确认后再提交'
/** 一个从未下发过的版本。它必须永远打不开门。 */
const STALE = 'sa-consent-v0.2026-01-01'

function resultTtlMs(): number {
  const raw = Number(process.env['AI_RESUME_RESULT_TTL_HOURS'])
  const hours = Number.isFinite(raw) && raw > 0 ? raw : 24
  return hours * 60 * 60 * 1000
}

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
  createdAt: Date
}

interface AuditEvent {
  action: string
  targetId: string
  payload: unknown
}

function makeHarness(opts: { resumePages?: number; reportPages?: number; llm?: 'ok' | 'rejected' | 'throw' } = {}) {
  const resumePages = opts.resumePages ?? 1
  const reportPages = opts.reportPages ?? 2
  const rows: StoredRow[] = []
  const audits: AuditEvent[] = []
  const aiLogs: Array<Record<string, unknown>> = []
  const uploads: Array<{ fileId: string; filename: string; buffer: Buffer }> = []
  let uploadSeq = 0

  const prisma = {
    aiResumeResult: {
      create: async ({ data }: { data: Omit<StoredRow, 'id' | 'createdAt'> & { createdAt?: Date } }) => {
        const row: StoredRow = {
          id: `row-${rows.length + 1}`,
          ...data,
          createdAt: data.createdAt ?? new Date(),
        }
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
    readContent: async () => ({ buffer: await makePdf(resumePages) }),
  }

  const llm = {
    summarize: async (input: {
      scored: { dimensions: unknown[] }
      onLlmCall?: (meta: { provider: string; tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number } }) => void
    }) => {
      if (opts.llm === 'throw') throw new Error('boom')
      input.onLlmCall?.({ provider: 'mock-llm', tokenUsage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 } })
      if (opts.llm === 'rejected') {
        return {
          status: 'rejected' as const,
          failReason: '本次解读未能生成合规结果，请重新作答或稍后重试',
          dimensions: [],
          summary: null,
          providerName: 'mock-llm',
        }
      }
      return {
        status: 'completed' as const,
        dimensions: input.scored.dimensions,
        summary: '解读摘要',
        providerName: 'mock-llm',
      }
    },
  }

  const pdf = { render: async () => ({ buffer: await makePdf(reportPages), pageCount: reportPages }) }
  const log = { record: (row: Record<string, unknown>) => { aiLogs.push(row) } }

  const service = new SelfAssessmentService(
    prisma as never, llm as never, pdf as never, files as never, audit as never, log as never,
  )
  const appendService = new AppendedSelfAssessmentService(
    prisma as never, service, files as never, audit as never,
  )
  return { service, appendService, rows, audits, uploads, aiLogs }
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

function assertAnonymousShortRetention(row: StoredRow, label: string): void {
  assert.equal(row.endUserId, null, `${label}：endUserId 必须为空`)
  assert.ok(row.expiresAt.getTime() > row.createdAt.getTime(), `${label}：保存期必须为正`)
  assert.ok(
    row.expiresAt.getTime() <= row.createdAt.getTime() + resultTtlMs(),
    `${label}：expiresAt 不得超过 createdAt + AI_RESUME_RESULT_TTL_HOURS`,
  )
  const payload = JSON.parse(row.payloadJson) as Record<string, unknown>
  for (const key of ['terminalId', 'memberId', 'memberNo', 'endUserId', 'phone', 'answers']) {
    assert.equal(Object.prototype.hasOwnProperty.call(payload, key), false, `${label}：payload 不得含 ${key}`)
  }
  assert.equal(JSON.stringify(payload).includes('long_term'), false, `${label}：不得进长期保存`)
  assert.equal(JSON.stringify(payload).includes('months_6'), false, `${label}：不得进延长期限`)
}

function readConstStrings(src: string, name: string): string[] {
  const matched = src.match(new RegExp(`(?:export\\s+)?const\\s+${name}\\b[\\s\\S]*?=\\s*\\[([\\s\\S]*?)\\n\\]`))
  assert.ok(matched, `必须能读到 ${name}`)
  const items = [...matched![1]!.matchAll(/'([^'\\]*)'/g)].map((item) => item[1]!)
  assert.ok(items.length > 0, `${name} 不能是空数组`)
  return items
}

function readStringConst(src: string, name: string): string {
  const matched = src.match(new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*'([^']*)'`))
  assert.ok(matched, `必须能读到 ${name}`)
  return matched![1]!
}

function readConsentLinks(src: string): Array<{ label: string; legalDocType: string; sectionTitle: string }> {
  const matched = src.match(/const\s+SELF_ASSESSMENT_CONSENT_LINKS\b[\s\S]*?=\s*\[([\s\S]*?)\n\]/)
  assert.ok(matched, '必须能读到 SELF_ASSESSMENT_CONSENT_LINKS')
  return [...matched![1]!.matchAll(/\{([\s\S]*?)\}/g)].map((hit) => {
    const body = hit[1]!
    const pick = (key: string) => {
      const field = body.match(new RegExp(`${key}\\s*:\\s*'([^']*)'`))
      assert.ok(field, `链接缺少 ${key}`)
      return field![1]!
    }
    return { label: pick('label'), legalDocType: pick('legalDocType'), sectionTitle: pick('sectionTitle') }
  })
}

function listMiniappSources(): string[] {
  const root = resolve(repoRoot, 'apps/miniapp')
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name === 'miniprogram_npm') continue
      const full = resolve(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(js|ts|json|wxml)$/.test(name)) out.push(full)
    }
  }
  walk(root)
  return out
}

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

test('A1b 不是当前版本的字符串一律 400，不能因为「看起来更早」就收下', async () => {
  const outsiders = [
    'sa-consent-v1.2026-08-15',
    'sa-consent-v1.2020-01-01',
    'sa-consent-v1.2026-09-28',
    'sa-consent-v1.2026-09-30',
    `${LEGACY_VERSION}.1`,
    LEGACY_VERSION.toUpperCase(),
  ]
  for (const version of outsiders) {
    const { service, rows } = makeHarness()
    await assert.rejects(
      () => service.submit(anon, {
        answers: answers(),
        consent: { nonSensitive: true, sensitive: false, consentVersion: version },
      }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException)
        assert.match(JSON.stringify(error.getResponse()), /SELF_ASSESSMENT_CONSENT_VERSION_STALE/)
        return true
      },
      `${version} 不是当前版本，必须 400`,
    )
    assert.equal(rows.length, 0, `${version} 不得落库`)
  }
})

test('A2 新版本提交通过，并按新版本落库', async () => {
  const { service, rows } = makeHarness()
  const ok = await service.submit(anon, {
    answers: answers(),
    consent: { nonSensitive: true, sensitive: false, consentVersion: NEW_VERSION },
  })
  assert.equal(ok.status, 'completed')
  assert.equal(ok.consentVersion, NEW_VERSION)
  assert.equal(ok.consentCurrent, true)
  assert.equal(CURRENT, NEW_VERSION, '服务端当前版本常量必须等于冻结的新版本')
  const stored = JSON.parse(rows[0]!.payloadJson) as { consentVersion: string }
  assert.equal(stored.consentVersion, NEW_VERSION, '落库存的必须是实际提交的新版本')
  assertAnonymousShortRetention(rows[0]!, '新版本匿名')
})

test('A2b #1119 版本与更早版本一律 400，不落库、不写创建审计', async () => {
  for (const version of [PREVIOUS_VERSION, LEGACY_VERSION]) {
    const { service, rows, audits } = makeHarness()
    await assert.rejects(
      () => service.submit(anon, {
        answers: answers(),
        consent: { nonSensitive: true, sensitive: false, consentVersion: version },
      }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException, `${version} 必须是 400`)
        const body = error.getResponse() as { error?: { code?: string; message?: string } }
        assert.equal(body.error?.code, 'SELF_ASSESSMENT_CONSENT_VERSION_STALE')
        assert.equal(body.error?.message, STALE_MESSAGE)
        return true
      },
      `${version} 已不是当前版本，必须拒绝`,
    )
    assert.equal(rows.length, 0, `${version} 不得留下任何结果行`)
    assert.equal(
      audits.filter((event) => event.action === 'resume.self_assessment_create').length,
      0,
      `${version} 不得产生 create 审计`,
    )
  }
})

test('A3 缺版本号、空字符串、带首尾空格的当前版本一律 400，不落库（走真实 submit）', async () => {
  const { service, rows } = makeHarness()
  const cases: Array<{ label: string; consent: { nonSensitive: boolean; sensitive: boolean; consentVersion?: string } }> = [
    { label: '缺版本号', consent: { nonSensitive: true, sensitive: false } },
    { label: '空字符串', consent: { nonSensitive: true, sensitive: false, consentVersion: '' } },
    { label: '前后带空格的当前版本', consent: { nonSensitive: true, sensitive: false, consentVersion: ` ${CURRENT} ` } },
    { label: '大小写不同的当前版本', consent: { nonSensitive: true, sensitive: false, consentVersion: CURRENT.toUpperCase() } },
  ]
  for (const c of cases) {
    await assert.rejects(
      () => service.submit(anon, { answers: answers(), consent: c.consent }),
      (error: unknown) => {
        const body = (error as { getResponse?: () => unknown }).getResponse?.() as { error?: { code?: string } } | undefined
        assert.equal((error as { getStatus?: () => number }).getStatus?.(), 400, c.label)
        assert.equal(body?.error?.code, 'SELF_ASSESSMENT_CONSENT_VERSION_STALE', c.label)
        return true
      },
    )
  }
  assert.equal(rows.length, 0, '被拒的提交一条都不落库')
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

test('A4c 会员名下的旧版本记录仍可查看、打印、撤回', async () => {
  const member = { endUserId: 'member-1', accessToken: null }
  const h = makeHarness()
  await h.service.submit(member, {
    answers: answers(),
    consent: { nonSensitive: true, sensitive: false, consentVersion: NEW_VERSION },
  })
  const row = h.rows[0]!
  const payload = JSON.parse(row.payloadJson) as Record<string, unknown>
  payload['consentVersion'] = PREVIOUS_VERSION
  row.payloadJson = JSON.stringify(payload)

  const read = await h.service.getLatest(row.taskId, member)
  assert.equal(read.consentVersion, PREVIOUS_VERSION, '查看必须回报存下来的旧版本')
  assert.equal(read.consentCurrent, false)

  const printed = await h.service.printReport(row.taskId, member)
  assert.match(printed.printFileUrl, /^\/api\/v1\/files\/.+\/content\?expires=\d+&sig=[0-9a-f]{64}$/)

  const withdrawn = await h.service.withdraw(row.taskId, member)
  assert.deepEqual(withdrawn, { deleted: true })
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

test(
  'A6 一体机、小程序、shared、服务端四处版本号全部相等',
  {
    skip: '等一体机与小程序同批升版后开启：一体机仍写死旧版本，本批不改 apps。打开前须确认两端版本与条款都等于服务端当前版本，且页面用题目接口下发的 consentLinks、consentCheckboxLabel 渲染。小程序源码里没有写死版本号时，本断言不会因此变红，不能单独当成页面已升版。',
  },
  () => {
    const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8')
    const pick = (src: string, file: string) => {
      const m = src.match(/SELF_ASSESSMENT_CONSENT_VERSION\s*=\s*'([^']+)'/)
      assert.ok(m, `${file} 必须声明 SELF_ASSESSMENT_CONSENT_VERSION`)
      return m![1]
    }
    const sharedSrc = read('packages/shared/src/types/selfAssessment.ts')
    const apiSrc = read('services/api/src/ai/resume/self-assessment.types.ts')
    const kioskSrc = read('apps/kiosk/src/pages/resume/selfAssessmentSession.ts')
    const shared = pick(sharedSrc, 'packages/shared')
    const api = pick(apiSrc, 'services/api')
    const kiosk = pick(kioskSrc, 'apps/kiosk')
    assert.equal(shared, NEW_VERSION)
    assert.equal(api, NEW_VERSION)
    assert.equal(kiosk, NEW_VERSION, '一体机版本必须等于当前版本')
    assert.equal(api, shared)

    const sharedItems = readConstStrings(sharedSrc, 'SELF_ASSESSMENT_CONSENT_ITEMS')
    assert.deepEqual(readConstStrings(apiSrc, 'SELF_ASSESSMENT_CONSENT_ITEMS'), sharedItems)
    assert.deepEqual(readConstStrings(kioskSrc, 'CONSENT_ITEMS'), sharedItems, '一体机条款必须与 shared 逐字相同')

    const versionRe = /sa-consent-v\d+\.\d{4}-\d{2}-\d{2}/g
    for (const file of listMiniappSources()) {
      const text = readFileSync(file, 'utf8')
      for (const hit of text.match(versionRe) ?? []) {
        assert.equal(hit, NEW_VERSION, `小程序写死的同意版本 ${hit} 必须等于当前版本`)
      }
    }
  },
)

test('A6b shared 与服务端的版本、条款、链接、勾选框文字逐字一致，并随题目下发', () => {
  const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8')
  const sharedSrc = read('packages/shared/src/types/selfAssessment.ts')
  const apiSrc = read('services/api/src/ai/resume/self-assessment.types.ts')
  assert.equal(readStringConst(sharedSrc, 'SELF_ASSESSMENT_CONSENT_VERSION'), NEW_VERSION)
  assert.equal(readStringConst(apiSrc, 'SELF_ASSESSMENT_CONSENT_VERSION'), NEW_VERSION)
  assert.equal(CURRENT, NEW_VERSION, '运行中的服务端常量必须等于冻结的当前版本')

  const sharedItems = readConstStrings(sharedSrc, 'SELF_ASSESSMENT_CONSENT_ITEMS')
  const apiItems = readConstStrings(apiSrc, 'SELF_ASSESSMENT_CONSENT_ITEMS')
  assert.deepEqual(apiItems, sharedItems, '服务端条款必须与 shared 逐字相同')
  assert.equal(sharedItems.at(-1), AGE_ITEM)
  assert.equal(sharedItems.length, 6)
  assert.equal(readStringConst(sharedSrc, 'SELF_ASSESSMENT_CONSENT_CHECKBOX_LABEL'), CHECKBOX_LABEL)
  assert.equal(readStringConst(apiSrc, 'SELF_ASSESSMENT_CONSENT_CHECKBOX_LABEL'), CHECKBOX_LABEL)
  assert.deepEqual(readConsentLinks(sharedSrc), [CONSENT_LINK])
  assert.deepEqual(readConsentLinks(apiSrc), [CONSENT_LINK])

  const legalSrc = read('services/api/src/legal/legal.service.ts')
  const legalController = read('services/api/src/legal/legal.controller.ts')
  assert.match(legalSrc, /'privacy_policy'/, 'privacy_policy 必须是现有法务文档类型')
  assert.match(legalController, /@Controller\('kiosk\/legal'\)/)

  const controller = new SelfAssessmentController(
    null as never, null as never, null as never, null as never, null as never, null as never,
  )
  const questions = controller.questions()
  assert.equal(questions.consentVersion, NEW_VERSION, '链接和勾选框必须配当前版本下发')
  assert.deepEqual([...questions.consentItems], sharedItems)
  assert.deepEqual(questions.consentLinks, [CONSENT_LINK])
  assert.equal(questions.consentCheckboxLabel, CHECKBOX_LABEL)
})

test('A8 题目接口下发的 consentItems 等于 shared 当前条款，且含年龄这一条', () => {
  const controller = new SelfAssessmentController(
    null as never, null as never, null as never, null as never, null as never, null as never,
  )
  const questions = controller.questions()
  const sharedSrc = readFileSync(resolve(repoRoot, 'packages/shared/src/types/selfAssessment.ts'), 'utf8')
  const sharedItems = readConstStrings(sharedSrc, 'SELF_ASSESSMENT_CONSENT_ITEMS')
  assert.equal(questions.consentVersion, NEW_VERSION)
  assert.deepEqual([...questions.consentItems], sharedItems)
  assert.ok(questions.consentItems.includes(AGE_ITEM), '下发条款必须含年龄这一条')
})

test('A9 模型整体拒答：会员落完成行，只回打分，审计记码', async () => {
  const h = makeHarness({ llm: 'rejected' })
  const res = await h.service.submit(
    { endUserId: 'member-1', accessToken: null },
    { answers: answers(), consent: { nonSensitive: true, sensitive: false, consentVersion: NEW_VERSION } },
  )
  assert.equal(res.status, 'completed')
  assert.equal(res.interpretationAvailable, false)
  assert.equal(res.aiUnavailableReason, 'COMPLIANCE_REJECT')
  assert.equal(res.failReason, undefined)
  assert.equal(res.providerName, 'llm_unavailable')
  assert.equal(res.summary, null)
  assert.equal(res.dimensions.length, 5)
  assert.ok(res.dimensions.every((d) => d.note === null && d.strength >= 0))
  assert.equal(JSON.stringify(res).includes('请重新作答'), false)
  assert.equal(h.rows.length, 1)
  assert.equal(h.rows[0]!.status, 'completed')
  assert.equal(h.rows[0]!.endUserId, 'member-1')
  const stored = JSON.parse(h.rows[0]!.payloadJson) as { dimensions: unknown[]; aiUnavailableReason?: string }
  assert.equal(stored.dimensions.length, 5, '不得改用模型返回的空维度')
  assert.equal(stored.aiUnavailableReason, 'COMPLIANCE_REJECT')
  const created = h.audits.find((a) => a.action === 'resume.self_assessment_create')
  const payload = created?.payload as { status?: string; aiUnavailableReason?: string }
  assert.equal(payload.status, 'completed')
  assert.equal(payload.aiUnavailableReason, 'COMPLIANCE_REJECT')
  assert.equal(h.aiLogs[0]?.['status'], 'failed')
  assert.equal(h.aiLogs[0]?.['errorCode'], 'COMPLIANCE_REJECT')
  const printed = await h.service.printReport(res.taskId, { endUserId: 'member-1', accessToken: null })
  assert.match(printed.printFileUrl, /^\/api\/v1\/files\/.+\/content\?expires=\d+&sig=[0-9a-f]{64}$/)
})

test('A10 模型整体拒答：匿名按 TTL 短期保存，拿到打分和打印凭证', async () => {
  const h = makeHarness({ llm: 'rejected' })
  const res = await h.service.submit(anon, {
    answers: answers(),
    consent: { nonSensitive: true, sensitive: false, consentVersion: NEW_VERSION },
  })
  assert.equal(res.status, 'completed')
  assert.equal(res.aiUnavailableReason, 'COMPLIANCE_REJECT')
  assert.equal(res.dimensions.length, 5)
  assert.equal(typeof res.accessToken, 'string')
  assert.notEqual(res.expiresAt, null)
  assertAnonymousShortRetention(h.rows[0]!, '合规拒答匿名')
  assert.equal(h.rows[0]!.status, 'completed')
  const printed = await h.service.printReport(res.taskId, { endUserId: null, accessToken: res.accessToken! })
  assert.ok(printed.printFileUrl)
})

test('A11 模型抛错仍是未完成，不伪装成合规拒答的打分结果', async () => {
  const h = makeHarness({ llm: 'throw' })
  const res = await h.service.submit(anon, {
    answers: answers(),
    consent: { nonSensitive: true, sensitive: false, consentVersion: NEW_VERSION },
  })
  assert.equal(res.status, 'rejected')
  assert.equal(res.expiresAt, null)
  assert.equal(res.accessToken, undefined)
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
  const out = await h.appendService.appendToResume({
    taskId, requester: { endUserId: null, accessToken }, resumeFileId: 'resume-file-1',
  })
  const merged = await PDFDocument.load(h.uploads.at(-1)!.buffer)
  // mock 简历 1 页 + mock 报告 2 页；页数变少即说明发生了替换而非追加。
  assert.equal(merged.getPageCount(), 3, '合并结果必须包含简历与报告全部页面')
  assert.equal(out.pageCount, 3, '响应 pageCount 必须是合并后总页数，不能是附录页数')
  assert.equal(out.pageCount, merged.getPageCount(), '响应 pageCount 必须与合并 PDF 实际页数一致')
  assert.equal(out.appendixPageCount, 2, 'appendixPageCount 才是附录页数')
})

test('B5 简历 2 页 + 附录 1 页时 pageCount 为 3，而不是附录的 1', async () => {
  const h = makeHarness({ resumePages: 2, reportPages: 1 })
  const { taskId, accessToken } = await seedAssessment(h)
  const out = await h.appendService.appendToResume({
    taskId, requester: { endUserId: null, accessToken }, resumeFileId: 'resume-file-1',
  })
  const merged = await PDFDocument.load(h.uploads.at(-1)!.buffer)
  assert.equal(out.pageCount, 3, '2 页简历 + 1 页附录必须回报 3，回报 1 会按 1 页报价')
  assert.equal(out.pageCount, 2 + 1, 'pageCount == 简历页数 + 附录页数')
  assert.equal(out.pageCount, merged.getPageCount())
  assert.equal(out.appendixPageCount, 1, '附录页数另字段给出，不改 pageCount 语义')
  const printAudit = [...h.audits].reverse().find((a) => a.action === 'resume.self_assessment_print')
  assert.ok(printAudit, 'append 必须写打印审计')
  const payload = printAudit.payload as { saPageCount?: number; mode?: string }
  assert.equal(payload.mode, 'append')
  assert.equal(payload.saPageCount, 1, '审计 saPageCount 仍是附录页数，语义不变')
})
