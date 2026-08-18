/**
 * 已结束招聘会 = 「参会回顾」而不是「参会准备」。行为门禁。
 *
 * 背景：AI参会准备单此前全链路对招聘会状态无感 —— 前端两个入口没有 !isEnded 守卫、
 * 目标页不取 fair 也不读 status、服务端查询只有 approved+published 没有 endAt。
 * 净效果：可以为上周就结束的场次生成并打印一份「出发前逐项核对」清单，还付一次 LLM 调用。
 *
 * 产品裁决（2026-08-18）：不隐藏按钮，改语义 —— 已结束场次产出「回顾 / 跟进」。
 *
 * 本门禁用内存假 Prisma + 真实 FairVisitPlanService 断言**行为**（不是源码字符串）：
 *   B1 已结束场次 → 回顾形态（有 followUpActions，无 preparationChecklist / onsiteTips）
 *   B2 未结束场次 → 参会准备形态原样不变（防止修复把正常路径改坏）
 *   B3 存量「准备单」在活动结束后再读 → 服务端拒发（覆盖直接敲 URL / 旧链接）
 *   B4 存量「准备单」在活动结束后再打印 → 服务端拒发（覆盖旧二维码；纸是带走的）
 *
 * 不连数据库、不起 HTTP，两个 CI job 都能跑。
 * Run: node -r @swc-node/register scripts/verify-fair-visit-review.ts
 */
import { createHash } from 'node:crypto'
import { FairVisitPlanService } from '../src/ai/resume/fair-visit-plan.service'
import { FairVisitPlanPdfService as RealPdfService, REVIEW_DISCLOSURE } from '../src/ai/resume/fair-visit-plan-pdf.service'
import { buildSystemPrompt } from '../src/ai/resume/llm-fair-visit-plan.service'
import type { PrismaService } from '../src/prisma/prisma.service'
import type { AuditService } from '../src/audit/audit.service'
import type { FilesService } from '../src/files/files.service'
import type { AiLogService } from '../src/ai/ai-log.service'
import type { ResumeExtractionService } from '../src/ai/resume/resume-extraction.service'
import type { FairVisitPlanPdfService } from '../src/ai/resume/fair-visit-plan-pdf.service'
import type { LlmFairVisitPlanService } from '../src/ai/resume/llm-fair-visit-plan.service'

// 门禁自身的环境前置：签名密钥只是让 printPlan 能走完，不参与任何断言。
// 不设它的话 printPlan 会因缺 env 抛错，B4 就会「因为环境坏了」而假绿 —— 
// 实测未修复代码下正是如此：pdfCalls 已经是 1（过期内容已进渲染器），
// 却因为 FILE_SIGNING_SECRET 缺失而看起来像被拒。
process.env['FILE_SIGNING_SECRET'] ||= 'verify-only-file-signing-secret-0123456789'

let passed = 0
let failed = 0
function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) { console.log(`  ✓ ${label}`); passed++ }
  else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

/** 取 Nest 异常里的业务错误码；取不到返回 null（用于区分「有意拒绝」与「意外错误」）。 */
function errorCodeOf(err: unknown): string | null {
  const res = (err as { getResponse?: () => unknown } | null)?.getResponse?.()
  const code = (res as { error?: { code?: unknown } } | undefined)?.error?.code
  return typeof code === 'string' ? code : null
}

const DAY = 24 * 60 * 60 * 1000
const ENDED_FAIR_ID = 'fair-ended'
const FUTURE_FAIR_ID = 'fair-future'

function fairRow(id: string, startAt: Date, endAt: Date) {
  return {
    id,
    title: `示例招聘会 ${id}`,
    sourceName: '示例公共就业服务网',
    sourceUrl: 'https://jobs.example.gov.cn/fairs/' + id,
    startAt,
    endAt,
    venue: '示例会展中心',
    city: '示例市',
    reviewStatus: 'approved',
    publishStatus: 'published',
    companies: [
      {
        name: '示例制造有限公司',
        industry: '智能制造',
        sourceUrl: 'https://jobs.example.gov.cn/companies/c1',
        positions: [
          { title: '前端工程师', requirements: '熟悉 TypeScript', education: '本科', location: '示例市', sortOrder: 1 },
        ],
      },
    ],
  }
}

/** 内存假 Prisma：只实现本服务真正用到的三个调用。 */
function makePrisma(results: Map<string, Record<string, unknown>>) {
  const fairs = [
    fairRow(ENDED_FAIR_ID, new Date(Date.now() - 9 * DAY), new Date(Date.now() - 7 * DAY)),
    fairRow(FUTURE_FAIR_ID, new Date(Date.now() + 7 * DAY), new Date(Date.now() + 8 * DAY)),
  ]
  const key = (taskId: string, kind: string) => `${taskId}::${kind}`
  return {
    jobFair: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const hit = fairs.find(
          (f) =>
            f.id === where['id'] &&
            f.reviewStatus === where['reviewStatus'] &&
            f.publishStatus === where['publishStatus'],
        )
        if (!hit) return null
        // 服务端若加了 endAt 条件，这里如实按条件过滤（回顾态不应因此被挡掉）。
        const endAt = where['endAt'] as { lt?: Date; gte?: Date } | undefined
        if (endAt?.lt && !(hit.endAt < endAt.lt)) return null
        if (endAt?.gte && !(hit.endAt >= endAt.gte)) return null
        return hit
      },
    },
    externalJumpLog: {
      // 本人在本机打开过来源投递入口的参展企业（fair_company + external_apply）。
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        if (where['endUserId'] !== 'user-1') return []
        if (where['targetType'] !== 'fair_company' || where['action'] !== 'external_apply') return []
        if (where['externalId'] !== ENDED_FAIR_ID) return []
        return [
          { targetTitle: '示例制造有限公司' },
          { targetTitle: '示例制造有限公司' },
          { targetTitle: '另一家示例公司' },
        ]
      },
    },
    aiResumeResult: {
      findUnique: async ({ where }: { where: { taskId_kind: { taskId: string; kind: string } } }) =>
        results.get(key(where.taskId_kind.taskId, where.taskId_kind.kind)) ?? null,
      upsert: async ({ where, update, create }: {
        where: { taskId_kind: { taskId: string; kind: string } }
        update: Record<string, unknown>
        create: Record<string, unknown>
      }) => {
        const k = key(where.taskId_kind.taskId, where.taskId_kind.kind)
        const existing = results.get(k)
        const row = existing ? { ...existing, ...update } : { ...create, updatedAt: new Date() }
        results.set(k, row)
        return row
      },
    },
  } as unknown as PrismaService
}

function makeService(results: Map<string, Record<string, unknown>>, capture: { pdfCalls: unknown[]; llmContexts: Record<string, unknown>[] }) {
  const prisma = makePrisma(results)
  // 桩 LLM：把「服务端要求的形态」原样回显，便于断言服务端到底点了哪一单。
  const llm = {
    build: async (ctx: Record<string, unknown>) => {
      capture.llmContexts.push(ctx)
      const mode = (ctx['mode'] as string | undefined) ?? 'preparation'
      const base = {
        summary: `桩总览(${mode})`,
        fairHighlights: ['桩看点'],
        priorityCompanies: [{ companyName: '示例制造有限公司', reason: '桩理由', sourceUrl: null }],
      }
      return mode === 'review'
        ? { ...base, followUpActions: ['桩跟进动作'], nextTimeQuestions: ['桩下次可准备的问题'] }
        : { ...base, preparationChecklist: ['桩准备项'], questionsToAsk: ['桩现场问题'], onsiteTips: ['桩现场提醒'] }
    },
  } as unknown as LlmFairVisitPlanService
  const extraction = {
    extractResumeText: async () => ({ ok: true as const, text: '示例简历原文' }),
  } as unknown as ResumeExtractionService
  const files = {
    upload: async () => ({
      fileId: 'file-1', filename: '招聘会.pdf', sizeBytes: 1024,
      signedUrl: 'https://example.invalid/s', signedUrlExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    }),
  } as unknown as FilesService
  const pdf = {
    render: async (meta: unknown, plan: unknown, mode?: unknown) => {
      capture.pdfCalls.push({ meta, plan, mode })
      return { buffer: Buffer.from('%PDF-1.4'), pageCount: 1, sections: [] }
    },
  } as unknown as FairVisitPlanPdfService
  const audit = { write: async () => undefined } as unknown as AuditService
  const aiLog = { record: () => undefined } as unknown as AiLogService
  return new FairVisitPlanService(prisma, llm, extraction, files, pdf, audit, aiLog)
}

/** 预置一条已授权的 parse 任务 + 可选的既有 fair_visit_plan 结果。 */
function seed(results: Map<string, Record<string, unknown>>, taskId: string) {
  results.set(`${taskId}::parse`, {
    endUserId: 'user-1',
    accessTokenHash: null,
    expiresAt: new Date(Date.now() + DAY),
    payloadJson: JSON.stringify({ fileId: 'resume-file-1' }),
  })
}

const requester = { endUserId: 'user-1', accessToken: null }

async function main() {
  console.log('\n=== 已结束招聘会 → 参会回顾 行为门禁 ===\n')

  // ── B1 已结束场次必须产出回顾形态 ────────────────────────────────────────────
  {
    const results = new Map<string, Record<string, unknown>>()
    const capture = { pdfCalls: [] as unknown[], llmContexts: [] as Record<string, unknown>[] }
    seed(results, 'task-ended')
    const svc = makeService(results, capture)
    let res: Record<string, unknown> | null = null
    let err: unknown = null
    try { res = (await svc.generate(ENDED_FAIR_ID, 'task-ended', requester)) as Record<string, unknown> }
    catch (e) { err = e }
    assert('B1.0 已结束场次仍可生成（回顾态不该被 404 挡掉）', !err && !!res,
      err ? String((err as Error).message) : 'no result')
    if (res) {
      assert('B1.1 已结束场次不得输出「参会前准备清单」', res['preparationChecklist'] === undefined,
        `preparationChecklist=${JSON.stringify(res['preparationChecklist'])}`)
      assert('B1.2 已结束场次不得输出「现场提醒」', res['onsiteTips'] === undefined,
        `onsiteTips=${JSON.stringify(res['onsiteTips'])}`)
      assert('B1.3 已结束场次不得输出「现场可咨询问题」', res['questionsToAsk'] === undefined,
        `questionsToAsk=${JSON.stringify(res['questionsToAsk'])}`)
      assert('B1.4 已结束场次必须输出「后续跟进动作」', Array.isArray(res['followUpActions']),
        `followUpActions=${JSON.stringify(res['followUpActions'])}`)
      assert('B1.5 响应必须自述形态为 review', res['mode'] === 'review', `mode=${String(res['mode'])}`)
    }
  }

  // ── B2 未结束场次的参会准备形态必须原样不变 ──────────────────────────────────
  {
    const results = new Map<string, Record<string, unknown>>()
    const capture = { pdfCalls: [] as unknown[], llmContexts: [] as Record<string, unknown>[] }
    seed(results, 'task-future')
    const svc = makeService(results, capture)
    const res = (await svc.generate(FUTURE_FAIR_ID, 'task-future', requester)) as Record<string, unknown>
    assert('B2.1 未结束场次仍输出参会前准备清单', Array.isArray(res['preparationChecklist']))
    assert('B2.2 未结束场次仍输出现场提醒', Array.isArray(res['onsiteTips']))
    assert('B2.3 未结束场次形态为 preparation', res['mode'] === 'preparation', `mode=${String(res['mode'])}`)
  }

  // ── B3/B4 存量准备单在活动结束后不得再被读出 / 打印 ───────────────────────────
  // 模拟：活动结束前生成了一份准备单，一周后用户拿旧链接 / 旧二维码回来。
  {
    const results = new Map<string, Record<string, unknown>>()
    const capture = { pdfCalls: [] as unknown[], llmContexts: [] as Record<string, unknown>[] }
    seed(results, 'task-stale')
    const staleFair = {
      id: ENDED_FAIR_ID,
      title: '示例招聘会 fair-ended',
      sourceName: '示例公共就业服务网',
      sourceUrl: 'https://jobs.example.gov.cn/fairs/fair-ended',
      startAt: new Date(Date.now() - 9 * DAY).toISOString(),
      endAt: new Date(Date.now() - 7 * DAY).toISOString(),
      venue: '示例会展中心',
      city: '示例市',
    }
    results.set('task-stale::fair_visit_plan', {
      taskId: 'task-stale',
      kind: 'fair_visit_plan',
      status: 'completed',
      updatedAt: new Date(Date.now() - 8 * DAY),
      expiresAt: new Date(Date.now() + DAY),
      endUserId: 'user-1',
      accessTokenHash: null,
      payloadJson: JSON.stringify({
        fair: staleFair,
        providerName: 'llm',
        basedOn: { resume: true, fairId: ENDED_FAIR_ID, fairName: staleFair.title, companyCount: 1, positionCount: 1 },
        // 活动结束前生成的「参会准备」形态
        payload: {
          summary: '旧总览',
          fairHighlights: ['旧看点'],
          priorityCompanies: [],
          preparationChecklist: ['出发前带齐简历'],
          questionsToAsk: ['现场问什么'],
          onsiteTips: ['现场路线提醒'],
        },
      }),
    })
    const svc = makeService(results, capture)

    let latest: Record<string, unknown> | null = null
    let latestErr: unknown = null
    try { latest = (await svc.getLatest(ENDED_FAIR_ID, 'task-stale', requester)) as Record<string, unknown> }
    catch (e) { latestErr = e }
    // 「抛错即通过」是第十种空转形态：环境坏了看起来会跟保护生效一模一样。
    // 所以这里既不接受任意异常，也要求异常必须是那条**有意**的判定。
    const latestErrCode = errorCodeOf(latestErr)
    const latestRefused = latestErrCode === 'FAIR_VISIT_PLAN_STALE_MODE'
      || (!latestErr && latest !== null
          && latest['preparationChecklist'] === undefined && latest['onsiteTips'] === undefined)
    assert(
      'B3. 活动已结束后，存量「参会准备」形态不得再被读出（直接敲 URL / 旧链接）',
      latestRefused,
      latestErr
        ? `拒绝了，但不是有意判定：${latestErrCode ?? String((latestErr as Error).message)}`
        : latest
          ? `仍返回 preparationChecklist=${JSON.stringify(latest['preparationChecklist'])} onsiteTips=${JSON.stringify(latest['onsiteTips'])}`
          : '',
    )

    let printErr: unknown = null
    try { await svc.printPlan(ENDED_FAIR_ID, 'task-stale', requester) }
    catch (e) { printErr = e }
    // 判据是「过期内容有没有抵达渲染器」，不是「有没有抛错」——
    // 抛错可能来自环境（缺密钥），那不构成任何保护。
    const renderedPayloads = JSON.stringify(capture.pdfCalls)
    assert(
      'B4. 活动已结束后，存量「参会准备」形态不得抵达 PDF 渲染器（旧二维码；纸是带走的）',
      capture.pdfCalls.length === 0,
      capture.pdfCalls.length > 0
        ? `渲染器被调用 ${capture.pdfCalls.length} 次${renderedPayloads.includes('出发前') ? '，且已把「出发前带齐简历」送进去' : ''}`
        : '',
    )
    assert(
      'B4b. 拒绝必须是服务端的有意判定，而不是缺环境变量之类的意外错误',
      errorCodeOf(printErr) === 'FAIR_VISIT_PLAN_STALE_MODE',
      printErr ? `实际错误：${errorCodeOf(printErr) ?? String((printErr as Error).message)}` : '未抛出任何拒绝',
    )
  }

  // ── B8 事实区：只放本机记录的动作，且绝不并进 LLM 上下文 ──────────────────────
  {
    const results = new Map<string, Record<string, unknown>>()
    const capture = { pdfCalls: [] as unknown[], llmContexts: [] as Record<string, unknown>[] }
    seed(results, 'task-records')
    const svc = makeService(results, capture)
    const res = (await svc.generate(ENDED_FAIR_ID, 'task-records', requester)) as Record<string, unknown>
    const local = res['localRecords'] as { openedCompanySourceEntries?: string[]; requiresLogin?: boolean } | undefined
    assert('B8.1 回顾态必须带「本机记录」事实区', !!local, `localRecords=${JSON.stringify(local)}`)
    assert('B8.2 事实区列出打开过来源投递入口的企业且去重',
      JSON.stringify(local?.openedCompanySourceEntries) === JSON.stringify(['示例制造有限公司', '另一家示例公司']),
      JSON.stringify(local?.openedCompanySourceEntries))

    // 最关键的一条：送进模型的 context 里不得出现任何到场类信号。
    const ctxJson = JSON.stringify(capture.llmContexts)
    const attendanceKeys = ['localRecords', 'openedCompanySourceEntries', 'checkin', 'external_checkin_open', '签到', '到场', '入场']
    const leaked = attendanceKeys.filter((k) => ctxJson.includes(k))
    assert('B8.3 LLM 上下文不得包含任何到场 / 本机记录信号', leaked.length === 0, leaked.join('、'))
    assert('B8.4 LLM 上下文必须自带服务端判定的 mode',
      capture.llmContexts[0]?.['mode'] === 'review', String(capture.llmContexts[0]?.['mode']))
  }

  // ── B9 未登录会员：如实说明无法关联，而不是显示「无记录」 ──────────────────────
  {
    const results = new Map<string, Record<string, unknown>>()
    const capture = { pdfCalls: [] as unknown[], llmContexts: [] as Record<string, unknown>[] }
    // 早前这条把「授权失败抛错」也算通过 —— 那样断言根本没落到 requiresLogin 上，
    // 是同一种「抛错即通过」的空转。改成给匿名任务一个真实可通过的 token 哈希，
    // 让它真的走完生成，断言才有判别力。
    const anonToken = 'anon-access-token'
    results.set('task-anon::parse', {
      endUserId: null,
      accessTokenHash: createHash('sha256').update(anonToken, 'utf8').digest('hex'),
      expiresAt: new Date(Date.now() + DAY),
      payloadJson: JSON.stringify({ fileId: 'resume-file-1' }),
    })
    const svc = makeService(results, capture)
    const anonRes = (await svc.generate(ENDED_FAIR_ID, 'task-anon', {
      endUserId: null, accessToken: anonToken,
    })) as Record<string, unknown>
    const anonLocal = anonRes['localRecords'] as { requiresLogin?: boolean; openedCompanySourceEntries?: string[] } | undefined
    assert('B9.1 未登录时如实标记 requiresLogin，而不是显示「无记录」',
      anonLocal?.requiresLogin === true, JSON.stringify(anonLocal))
    assert('B9.2 未登录时不得凭空列出任何企业记录',
      (anonLocal?.openedCompanySourceEntries ?? []).length === 0, JSON.stringify(anonLocal))
  }

  // ── B5 纸面：已结束场次印出来的小节必须跟着语义变 ────────────────────────────
  {
    const pdf = new RealPdfService()
    const meta = {
      date: '2026-08-18', fairName: '示例招聘会', sourceName: '示例来源',
      venue: '示例会展中心', sourceUrl: 'https://jobs.example.gov.cn/f/1',
    }
    const reviewPlan = {
      mode: 'review' as const,
      summary: '回顾总览',
      fairHighlights: ['概况'],
      priorityCompanies: [{ companyName: '示例制造有限公司', reason: '仍在招同方向岗位', sourceUrl: null }],
      followUpActions: ['去来源平台查看该企业在招岗位'],
      nextTimeQuestions: ['下次可提前准备的问题'],
    }
    const rendered = await pdf.render(meta, reviewPlan)
    const joined = (rendered.sections ?? []).join(' | ')
    assert('B5.1 回顾态纸面不得出现「参会前准备清单」', !joined.includes('参会前准备清单'), joined)
    assert('B5.2 回顾态纸面不得出现「现场提醒」', !joined.includes('现场提醒'), joined)
    assert('B5.3 回顾态纸面不得出现「现场可咨询问题」', !joined.includes('现场可咨询问题'), joined)
    assert('B5.4 回顾态纸面必须有「后续可做的跟进动作」', joined.includes('后续可做的跟进动作'), joined)
    assert('B5.5 回顾态纸面必须有「仍可继续跟进的企业」', joined.includes('仍可继续跟进的企业'), joined)

    const prepPlan = {
      mode: 'preparation' as const,
      summary: '准备总览', fairHighlights: ['看点'],
      priorityCompanies: [], preparationChecklist: ['带简历'],
      questionsToAsk: ['问什么'], onsiteTips: ['路线'],
    }
    const renderedPrep = await pdf.render(meta, prepPlan)
    const joinedPrep = (renderedPrep.sections ?? []).join(' | ')
    assert('B5.6 未结束场次纸面仍是参会准备形态（防止把正常路径改坏）',
      joinedPrep.includes('参会前准备清单') && joinedPrep.includes('现场提醒'), joinedPrep)
  }

  // ── B6 prompt：回顾态不得暗示到场，且不得携带任何到场信号 ─────────────────────
  {
    const reviewPrompt = buildSystemPrompt('review')
    const prepPrompt = buildSystemPrompt('preparation')
    assert('B6.1 回顾 prompt 明示活动已结束', reviewPrompt.includes('已经结束'))
    assert('B6.2 回顾 prompt 明确禁止假设/暗示到场',
      reviewPrompt.includes('不知道用户是否到过现场') && reviewPrompt.includes('不得暗示'))
    assert('B6.3 回顾 prompt 不得索取「出发前 / 现场」动作',
      !reviewPrompt.includes('"preparationChecklist"') && !reviewPrompt.includes('"onsiteTips"'), reviewPrompt.slice(0, 200))
    // 到场类词只允许以「禁止」的形式出现在回顾 prompt 里；
    // 准备态 prompt 里则根本不该出现签到 / 入场 / 出席这类流程状态词。
    const attendanceWords = ['签到', '入场', '出席', '到场打卡']
    const leaked = attendanceWords.filter((w) => prepPrompt.includes(w))
    assert('B6.4 准备态 prompt 不含签到/入场/出席等流程状态词', leaked.length === 0, leaked.join('、'))
    assert('B6.5 两态 prompt 均保留合规底线（不承诺就业结果）',
      reviewPrompt.includes('不承诺就业结果') && prepPrompt.includes('不承诺就业结果'))
  }

  // ── B7 诚实声明必须是常量并真的印在纸上 ──────────────────────────────────────
  {
    assert('B7.1 诚实声明写明不记录是否到场', REVIEW_DISCLOSURE.includes('不记录你是否到场'))
    assert('B7.2 诚实声明写明不记录现场取得的材料', REVIEW_DISCLOSURE.includes('不记录你在现场取得的材料'))
  }

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  if (failed > 0) { console.error('\n=== FAILED ===\n'); process.exit(1) }
  console.log('\n=== ALL PASS ===\n')
}

void main()
