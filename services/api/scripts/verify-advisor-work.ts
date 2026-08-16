import 'dotenv/config'
import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { createClient } from '@libsql/client'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { AiLogService } from '../src/ai/ai-log.service'
import { AdvisorService } from '../src/advisor/advisor.service'
import { AdvisorRetentionTask } from '../src/advisor/advisor-retention.task'
import { AdvisorArtifactService } from '../src/advisor/advisor-artifact.service'
import { AdvisorPdfService } from '../src/advisor/advisor-pdf.service'
import { LlmAdvisorService } from '../src/advisor/llm-advisor.service'
import {
  classifySkillByKeyword,
  deriveStatus,
  missingRequiredSlots,
  nextSlotKey,
  parseSlots,
  slotViews,
} from '../src/advisor/advisor-skills'
import type { AdvisorArtifactPayload } from '../src/advisor/advisor-artifact.types'

// ============================================================
// S3-3 · P26 顾问作业面（/ai/plan）后端验证。
//
// 本脚本的每一项都是**反向验证**：先构造应当失败的输入、确认它真的被拦下（FAIL 证明），
// 再构造合法输入、确认它通过（PASS 证明）。只证明「能过」不算验证 ——
// 一个恒返回 true 的守卫也能让正向用例全绿。
//
// 覆盖：
//   A. 输入槽状态机（纯函数）：换型不丢已填、缺项如实回报、状态推导
//   B. 归属门禁：会员跨用户 / 匿名错 token / 过期 → 一律 NOT_FOUND
//   C. 会话闭环：建会话 → 分次填槽 → 缺项拒绝出活 → 补齐 → 出活 → 产物落库可查
//   D. 继续回答：同会话第二轮带上文；对话不落库（无 turn 表、库里查不到问答原文）
//   E. 防编造守卫：编造数字 / 禁用词 / 自称查库 / 比对证据对不上 —— 逐条先证 FAIL 再证 PASS
//   F. PII 脱敏：送模型的 body 里不得出现手机号 / 身份证号
//   G. 真实产物：三种产物都能渲染出真实 PDF；打印路径不调模型（AI 全挂也能打印）
//   H. 诚实降级：模型不可用时 availability 如实回报，且已有内容仍可读
//
// 运行：pnpm --filter @ai-job-print/api verify:advisor-work
// ============================================================

const fallbackDbName = process.env['DATABASE_URL'] ? null : `verify-advisor-${randomUUID().slice(0, 8)}.db`
if (fallbackDbName) process.env['DATABASE_URL'] = `file:./prisma/${fallbackDbName}`
process.env['SECRET_ENCRYPTION_KEY'] ??= 'verify-advisor-secret-key-0123456789abcdef'
process.env['JWT_SECRET'] ??= 'verify-advisor-jwt-secret-0123456789abcdef'
process.env['FILE_SIGNING_SECRET'] ??= 'verify-advisor-file-signing-secret-0123456789abcdef'

let passCount = 0
function pass(message: string) { passCount += 1; console.log(`  PASS ${message}`) }
function fail(message: string): never { console.error(`  FAIL ${message}`); process.exit(1) }
function section(title: string) { console.log(`\n-- ${title}`) }

function assert(condition: boolean, message: string) {
  condition ? pass(message) : fail(message)
}

async function expectReject(code: string, label: string, fn: () => Promise<unknown>) {
  try {
    await fn()
    fail(`${label} — 期望 ${code}，实际成功返回（守卫没生效）`)
  } catch (error) {
    const body = (error as { getResponse?: () => unknown; response?: unknown }).getResponse?.()
      ?? (error as { response?: unknown }).response
    const actual = (body as { error?: { code?: string } } | undefined)?.error?.code
    if (actual === code) pass(label)
    else fail(`${label} — 期望 ${code}，实际 ${actual ?? (error as Error).message}`)
  }
}

// ── 可编排的假模型 ────────────────────────────────────────────
//
// 直接替换 global.fetch，因此走的是 LlmAdvisorService 里**真实的**传输、解析与守卫代码，
// 只有上游返回值是我们给的。这样守卫是被真的执行了，而不是被 mock 掉。

interface CapturedCall { body: string }
const captured: CapturedCall[] = []
let nextReplies: string[] = []

const realFetch = global.fetch
function installFakeLlm(replies: string[]) {
  captured.length = 0
  nextReplies = [...replies]
  global.fetch = (async (_url: string, init?: { body?: string }) => {
    captured.push({ body: init?.body ?? '' })
    const content = nextReplies.shift() ?? '{}'
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
    }
  }) as unknown as typeof fetch
}
function restoreFetch() { global.fetch = realFetch }

/** 已配置的假 LlmConfigService（advisor_work 功能位可用）。 */
const readyConfig = {
  isReady: () => true,
  getApiKey: () => 'verify-only-fake-key',
  getConfig: () => ({
    vendor: 'fakevendor', model: 'fake-model-v1', baseURL: 'https://llm.invalid/v1',
    systemPrompt: '', roleScope: '', forbiddenWords: [], temperature: 0.6, enabled: true,
  }),
} as unknown as ConstructorParameters<typeof LlmAdvisorService>[0]

/** 未配置的假 LlmConfigService（AI 不可用，用于诚实降级验证）。 */
const downConfig = {
  isReady: () => false,
  getApiKey: () => null,
  getConfig: () => ({
    vendor: 'fakevendor', model: 'fake-model-v1', baseURL: 'https://llm.invalid/v1',
    systemPrompt: '', roleScope: '', forbiddenWords: [], temperature: 0.6, enabled: false,
  }),
} as unknown as ConstructorParameters<typeof LlmAdvisorService>[0]

async function main() {
  console.log('\n=== S3-3 · P26 顾问作业面后端验证 ===')
  if (fallbackDbName) await initFallbackDb()

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const aiLog = new AiLogService(prisma)
  const pdf = new AdvisorPdfService()

  // FilesService / AuditService 用替身：本脚本验的是顾问模块自己的逻辑，
  // 文件存储链路已有 verify:end-user-assets 等既有脚本覆盖，不在这里重复。
  const uploaded: Array<{ filename: string; bytes: number; endUserId: string | null }> = []
  const filesStub = {
    upload: async (args: { buffer: Buffer; filename: string; endUserId?: string | null }) => {
      uploaded.push({ filename: args.filename, bytes: args.buffer.length, endUserId: args.endUserId ?? null })
      const fileId = `file_${randomUUID().slice(0, 8)}`
      return {
        fileId, filename: args.filename, sizeBytes: args.buffer.length,
        signedUrl: `https://verify.invalid/${fileId}`, signedUrlExpiresAt: new Date().toISOString(),
      }
    },
  } as unknown as ConstructorParameters<typeof AdvisorArtifactService>[2]

  const s = randomUUID().replace(/-/g, '').slice(0, 10)
  const userA = `eu_adv_a_${s}`
  const userB = `eu_adv_b_${s}`
  const sessionIds: string[] = []

  async function cleanup() {
    await prisma.advisorSession.deleteMany({ where: { id: { in: sessionIds } } })
    await prisma.auditLog.deleteMany({ where: { targetId: { in: sessionIds } } })
    await prisma.endUser.deleteMany({ where: { id: { in: [userA, userB] } } })
  }

  try {
    await cleanup()
    for (const id of [userA, userB]) {
      await prisma.endUser.create({ data: { id, phoneHash: `adv-${id}`, phoneEnc: `adv-enc-${id}`, nickname: id } })
    }

    // ══ A. 输入槽状态机（纯函数，先反向再正向）══════════════════
    section('A. 输入槽状态机')
    {
      const empty = parseSlots('{}')
      assert(missingRequiredSlots('slot_fill', empty).length === 3,
        'A1 反向：填槽型空会话必填缺 3 项（若守卫失效会是 0）')
      assert(deriveStatus('slot_fill', empty, false) === 'collecting',
        'A2 反向：必填未齐时状态为 collecting，不是 ready')

      const partial = parseSlots(JSON.stringify({
        current_role: { value: '机械设计六年', filledAt: new Date().toISOString() },
      }))
      assert(nextSlotKey('slot_fill', partial) === 'best_achievement',
        'A3 下一问按必填顺序推进')

      const full = parseSlots(JSON.stringify({
        current_role: { value: '机械设计六年', filledAt: new Date().toISOString() },
        best_achievement: { value: '主导产线工装改造', filledAt: new Date().toISOString() },
        why_this_job: { value: '想做非标自动化', filledAt: new Date().toISOString() },
      }))
      assert(missingRequiredSlots('slot_fill', full).length === 0 && deriveStatus('slot_fill', full, false) === 'ready',
        'A4 正向：必填齐了状态转 ready')

      // 换型不丢：同一份 slots 换到 compare 型，slot_fill 的三项仍在 map 里
      assert(Object.keys(full).length === 3 && missingRequiredSlots('compare', full).length === 2,
        'A5 换型后原槽位仍在存储中（只是当前型不读它们）')
      const backViews = slotViews('slot_fill', full)
      assert(backViews.filter((v) => v.filled).length === 3
        && backViews.find((v) => v.key === 'current_role')?.value === '机械设计六年'
        && backViews.find((v) => v.key === 'extra_note')?.filled === false,
        'A6 换回原型后已填值原样回读、未填的仍标未填 —— 这就是「换型不丢」')

      assert(classifySkillByKeyword('我够不够格投这个岗').skill === 'compare', 'A7 关键词兜底：够不够格 → 比对型')
      assert(classifySkillByKeyword('我不会写自我介绍').skill === 'slot_fill', 'A8 关键词兜底：我不会写 → 填槽型')
      assert(classifySkillByKeyword('空窗期要不要解释').skill === 'qa', 'A9 关键词兜底：拿不准的判断 → 问答型')
    }

    // ══ E. 防编造守卫（先证 FAIL 再证 PASS）════════════════════
    // 放在会话闭环之前跑：守卫不成立的话，后面的闭环验证没有意义。
    section('E. 防编造守卫（逐条先反向后正向）')
    {
      const llm = new LlmAdvisorService(readyConfig)
      const slots = parseSlots(JSON.stringify({
        current_role: { value: '机械设计，六年', filledAt: new Date().toISOString() },
        best_achievement: { value: '主导过 3 条产线的工装改造', filledAt: new Date().toISOString() },
        why_this_job: { value: '想做非标自动化方向', filledAt: new Date().toISOString() },
      }))
      const keys = ['current_role', 'best_achievement', 'why_this_job', 'extra_note']

      // E1 编造数字：用户只说过「六年」「3 条」，模型却写出「2019」「8 人」。
      // ⚠️ 这条 fixture 刻意**不含百分比、不含禁用词**：否则会被 findViolation 先拦下，
      // 用例就变成在验别的守卫了（本脚本第一版正是如此，靠变异测试才发现）。
      const invented = JSON.stringify({
        draft: '我做机械设计六年，2019 年入职后带过 8 人团队，主导过 3 条产线的工装改造。',
        blanks: [], summary: '成稿',
      })
      installFakeLlm([invented, invented])
      await expectReject('ADVISOR_DRAFT_FAILED', 'E1 反向：成稿编造用户没说过的数字 → 整篇作废（连续 2 次后诚实报错）',
        () => llm.draft(slots, keys))

      // E1' 正向：只用用户说过的数字
      installFakeLlm([JSON.stringify({
        draft: '我做机械设计六年，主导过 3 条产线的工装改造。我想做的方向是 ____。',
        blanks: ['具体方向'], summary: '还差一句方向',
      })])
      const okDraft = await llm.draft(slots, keys)
      assert(okDraft.draft.includes('3 条') && okDraft.blanks.length === 1,
        'E1 正向：只用用户提供过的数字 → 通过，留白如实标出')

      // E2 自称查库（C0 事实冻结抓到过的原型问题）
      const lookupClaim = JSON.stringify({
        answer: '我帮你查了系统里的记录，这类岗位一般不用解释空窗期。',
        evidenceLevel: 'E1', sourceNote: '逐条查库得出',
      })
      installFakeLlm([lookupClaim, lookupClaim])
      await expectReject('ADVISOR_ANSWER_FAILED', 'E2 反向：自称「帮你查了 / 逐条查库」→ 拦下（本层没有任何检索能力）',
        () => llm.answer('空窗期要不要写', []))

      // E3 禁用词 / 承诺
      const banned = JSON.stringify({
        answer: '按这个写通过率能到九成，可以一键投递。',
        evidenceLevel: 'E3', sourceNote: '经验判断',
      })
      installFakeLlm([banned, banned])
      await expectReject('ADVISOR_ANSWER_FAILED', 'E3 反向：命中「通过率 / 一键投递」→ 拦下',
        () => llm.answer('这样写行吗', []))

      // E3' 正向 + 证据分级不得谎报 E2
      installFakeLlm([JSON.stringify({
        answer: '三个月一般不用专门解释，简历上留白很常见。',
        evidenceLevel: 'E2', sourceNote: '这是通行做法，本机没有你所在行业的具体数据',
      })])
      const okAnswer = await llm.answer('离职三个月要写原因吗', [])
      assert(okAnswer.evidenceLevel === 'E3',
        'E4 反向：模型自报 E2（本层没有来源事实输入）→ 服务端降级为 E3，不让证据分级变装饰')
      assert(okAnswer.disclaimer === 'AI 判断，仅供参考', 'E5 正向：输出恒带「AI 判断，仅供参考」')

      // E6 比对证据对不上原文 → 降级为「没写到」，不拿编的原文当证据
      installFakeLlm([JSON.stringify({
        items: [
          { requirement: '熟悉非标夹具设计', verdict: 'covered', evidence: '主导 3 条产线工装改造' },
          { requirement: '会用 PDM 系统', verdict: 'covered', evidence: '精通 PDM 与 PLM 全流程管理' },
          { requirement: '学历不限', verdict: 'not_a_capability', evidence: '这条不卡你' },
        ],
        extras: [], summary: '逐条比对结果',
      })])
      const cmp = await llm.compare('主导 3 条产线工装改造，负责结构设计', '熟悉非标夹具设计；会用 PDM 系统；学历不限')
      const covered = cmp.items.filter((i) => i.verdict === 'covered')
      assert(covered.length === 1 && covered[0]!.requirement === '熟悉非标夹具设计',
        'E6 反向：covered 的 evidence 在材料里核对不上 → 降级为「没写到」（不拿编的原文当证据）')
      assert(cmp.items.some((i) => i.verdict === 'missing' && i.requirement === '会用 PDM 系统'),
        'E7 正向：核对不上的那条如实落到 missing')
      assert(cmp.items.some((i) => i.verdict === 'not_a_capability'),
        'E8 正向：非能力项单独归类，不算进「你缺什么」')

      // E9 比对不得给裁决
      const verdictish = JSON.stringify({
        items: [{ requirement: 'A', verdict: 'covered', evidence: '主导 3 条产线工装改造' }],
        extras: [], summary: '综合看你的录用概率不低，建议投。',
      })
      installFakeLlm([verdictish, verdictish])
      await expectReject('ADVISOR_COMPARE_FAILED', 'E9 反向：比对结论里出现「录用概率」→ 拦下（AI 只排序解释，不裁决）',
        () => llm.compare('主导 3 条产线工装改造', 'A'))

      // ── F. PII 脱敏（送模型前）──
      section('F. PII 脱敏')
      installFakeLlm([JSON.stringify({
        items: [{ requirement: 'A', verdict: 'missing', evidence: '找不到' }], extras: [], summary: '比对结果',
      })])
      await llm.compare('王磊 手机 13800138000 身份证 110101199001011234 主导产线改造', 'A')
      const sent = captured.map((c) => c.body).join('\n')
      assert(!sent.includes('13800138000'), 'F1 反向：手机号不出现在送模型的 body 里')
      assert(!sent.includes('110101199001011234'), 'F2 反向：身份证号不出现在送模型的 body 里')
      assert(sent.includes('主导产线改造'), 'F3 正向：正常业务内容仍然送达（不是把整段吞掉）')

      restoreFetch()
    }

    // ══ B/C/D. 会话闭环 ════════════════════════════════════════
    section('B/C/D. 会话闭环（归属 / 分次填槽 / 继续回答 / 真实产物）')
    {
      const llm = new LlmAdvisorService(readyConfig)
      const artifacts = new AdvisorArtifactService(prisma, pdf, filesStub, audit)
      const svc = new AdvisorService(prisma, llm, artifacts, audit, aiLog)

      // C1 建会话（判型走真实模型路径）
      installFakeLlm([JSON.stringify({ skill: 'slot_fill', reason: '你说的是「我不会写」，所以按填槽型办。' })])
      const created = await svc.createSession('帮我写一段自我介绍', { endUserId: userA, accessToken: null })
      sessionIds.push(created.sessionId)
      assert(created.skill === 'slot_fill' && created.skillSource === 'llm', 'C1 建会话并由模型判型')
      assert(created.status === 'collecting' && created.missingSlotKeys.length === 3,
        'C2 新会话状态 collecting，如实回报还缺 3 项')
      assert(created.slots.every((slot) => slot.key !== 'question'),
        'C2b 填槽型不读 question 槽（虽然它已被开场诉求预填，槽位表是全局的）')
      assert(created.conversationPersistence === 'not_saved', 'C3 会话视图如实透出「对话不保存」口径')

      // B. 归属门禁（三条反向）
      const owner = { endUserId: userA, accessToken: null }
      await expectReject('ADVISOR_SESSION_NOT_FOUND', 'B1 反向：另一会员读他人会话 → NOT_FOUND',
        () => svc.getSession(created.sessionId, { endUserId: userB, accessToken: null }))
      await expectReject('ADVISOR_SESSION_NOT_FOUND', 'B2 反向：匿名 token 读会员会话 → NOT_FOUND',
        () => svc.getSession(created.sessionId, { endUserId: null, accessToken: 'whatever' }))
      assert((await svc.getSession(created.sessionId, owner)).sessionId === created.sessionId,
        'B3 正向：本人可读')

      // C4 出活前缺项拒绝
      await expectReject('ADVISOR_SLOTS_INCOMPLETE', 'C4 反向：必填没答完就出活 → 拒绝并回报缺哪几项',
        () => svc.run(created.sessionId, owner))

      // C5 分次填槽
      await svc.fillSlot(created.sessionId, 'current_role', '机械设计，六年', owner)
      const afterOne = await svc.fillSlot(created.sessionId, 'best_achievement', '主导过 3 条产线的工装改造', owner)
      assert(afterOne.status === 'collecting' && afterOne.nextSlotKey === 'why_this_job',
        'C5 分次补充：已填留存，下一问正确推进')
      const ready = await svc.fillSlot(created.sessionId, 'why_this_job', '想做非标自动化方向', owner)
      assert(ready.status === 'ready' && ready.canRun, 'C6 必填齐了 → ready 且 canRun')

      // C7 换型不丢已填（跨请求验证，不只是纯函数）
      const switched = await svc.switchSkill(created.sessionId, 'compare', owner)
      assert(switched.skill === 'compare' && switched.skillSource === 'user_override',
        'C7 用户改型生效并标记来源为 user_override')
      const switchedBack = await svc.switchSkill(created.sessionId, 'slot_fill', owner)
      assert(switchedBack.slots.filter((s) => s.filled).length === 3,
        'C8 反向验证「换型不丢」：来回换型后 3 项已填内容原样还在')

      // C9 出活 → 真实产物落库
      installFakeLlm([JSON.stringify({
        draft: '我做机械设计六年，主导过 3 条产线的工装改造。我想做的方向是 ____。',
        blanks: ['具体方向'], summary: '还差一句方向',
      })])
      const ran = await svc.run(created.sessionId, owner)
      assert(ran.status === 'completed' && ran.artifacts.length === 1, 'C9 出活成功并落一份产物')
      const artifact = ran.artifacts[0]!
      assert(artifact.kind === 'slot_draft' && artifact.provider.startsWith('llm:'),
        'C10 产物带 provider 标签（前端据此区分真实模型产物）')

      // C11 真实产物 = 可查：换一个 service 实例重新读，仍在
      const svc2 = new AdvisorService(prisma, llm, new AdvisorArtifactService(prisma, pdf, filesStub, audit), audit, aiLog)
      const reread = await svc2.getSession(created.sessionId, owner)
      assert(reread.artifacts.length === 1 && reread.artifacts[0]!.payload !== null,
        'C11 产物跨实例可查（真落库，不是只在内存里）')

      // D. 继续回答（问答型多轮）
      const qa = await (async () => {
        installFakeLlm([JSON.stringify({ skill: 'qa', reason: '拿不准的判断题。' })])
        const row = await svc.createSession('离职三个月要不要写原因', { endUserId: userA, accessToken: null })
        sessionIds.push(row.sessionId)
        return row
      })()
      installFakeLlm([JSON.stringify({
        answer: '三个月一般不用专门解释。', evidenceLevel: 'E1', sourceNote: '通行做法',
      })])
      const turn1 = await svc.ask(qa.sessionId, '离职三个月要不要写原因', owner)
      assert(turn1.persistence === 'not_saved', 'D1 问答响应如实标注本轮不会被保存')

      installFakeLlm([JSON.stringify({
        answer: '超过半年建议给一行交代，写你这段时间做了什么。', evidenceLevel: 'E1', sourceNote: '通行做法',
      })])
      await svc.ask(qa.sessionId, '那超过半年呢', owner)
      const secondBody = captured[0]!.body
      assert(secondBody.includes('三个月一般不用专门解释'),
        'D2 正向：第二轮带上了第一轮的上下文（「那超过半年呢」能接住前文）')

      // D3 反向：对话确实没落库
      const rawSession = await prisma.advisorSession.findUnique({ where: { id: qa.sessionId } })
      const dumped = JSON.stringify(rawSession)
      assert(!dumped.includes('三个月一般不用专门解释') && !dumped.includes('那超过半年呢'),
        'D3 反向：问答原文与模型回答均未落库（兑现「对话不保存」）')

      // D4 问答型产物 = 钉住的条目；没钉住就不给产物（不编内容顶上）
      await expectReject('ADVISOR_NO_PINS', 'D4 反向：一条都没钉住就出活 → 拒绝，不拿对话内容凑一份产物',
        () => svc.run(qa.sessionId, owner))
      await expectReject('ADVISOR_EVIDENCE_INVALID', 'D5 反向：证据分级传非法值 → 400',
        () => svc.pin(qa.sessionId, { content: 'x', evidenceLevel: 'E9' }, owner))
      await svc.pin(qa.sessionId, {
        content: '三个月的空窗期一般不用专门解释', evidenceLevel: 'E3', sourceNote: '通行做法，本机没有行业数据',
      }, owner)
      const qaRan = await svc.run(qa.sessionId, owner)
      assert(qaRan.artifacts.length === 1 && qaRan.artifacts[0]!.kind === 'qa_pins',
        'D6 正向：钉住后可出产物（钉住的能打成纸）')
      assert(qaRan.artifacts[0]!.provider === 'server:pins',
        'D7 问答产物 provider 标为 server:pins —— 它不调模型，不能冒充模型产物')

      // ══ G. 真实 PDF + 打印路径不调模型 ══════════════════════
      section('G. 产物 PDF 与打印路径')
      restoreFetch()
      // 把 fetch 换成会抛错的实现：任何模型调用都会立刻炸 → 能打印就证明打印不依赖模型
      global.fetch = (async () => { throw new Error('LLM must not be called during print') }) as unknown as typeof fetch
      const printed = await svc.printArtifact(created.sessionId, artifact.artifactId, owner)
      assert(printed.pageCount >= 1 && printed.fileId.startsWith('file_'),
        'G1 反向：模型全挂时打印仍然成功 → 打印路径确实不调模型')
      assert(uploaded.length === 1 && uploaded[0]!.bytes > 1000 && uploaded[0]!.endUserId === userA,
        'G2 产物真的生成了 PDF 字节并按本人归属入库（可保存到我的文档）')

      const payloads: AdvisorArtifactPayload[] = [
        { kind: 'qa_pins', pins: [{ content: '空窗期不用专门解释', evidenceLevel: 'E3', sourceNote: '通行做法' }] },
        { kind: 'slot_draft', draft: '我做机械设计六年。', blanks: ['方向'], summary: '还差一句', basedOn: [{ slotKey: 'current_role', prompt: '你现在做什么', value: '机械设计六年' }] },
        { kind: 'compare_report', items: [{ requirement: '熟悉夹具', verdict: 'covered', evidence: '主导工装改造' }], extras: [], summary: '比对结果' },
      ]
      for (const payload of payloads) {
        const out = await pdf.render({ date: '2026-08-16', providerLabel: 'llm:fake:v1' }, payload)
        assert(out.buffer.subarray(0, 4).toString() === '%PDF' && out.pageCount >= 1,
          `G3 ${payload.kind} 渲染出真实 PDF`)
      }
      restoreFetch()
    }

    // ══ H. 诚实降级 ════════════════════════════════════════════
    section('H. AI 不可用时的诚实降级')
    {
      const downLlm = new LlmAdvisorService(downConfig)
      const artifacts = new AdvisorArtifactService(prisma, pdf, filesStub, audit)
      const svc = new AdvisorService(prisma, downLlm, artifacts, audit, aiLog)

      const availability = svc.availability()
      assert(availability.available === false && availability.providerLabel === null,
        'H1 反向：未配置时 available=false，且不给出假的 provider 标签')
      assert(typeof availability.reason === 'string' && availability.degradedCapabilities.length > 0,
        'H2 如实说明不可用原因与「还剩什么能用」')

      // 判型在模型不可用时退关键词兜底，而不是让用户开不了工
      const created = await svc.createSession('我够不够格投这个岗', { endUserId: null, accessToken: null })
      sessionIds.push(created.sessionId)
      assert(created.skill === 'compare' && created.skillSource === 'fallback',
        'H3 正向：模型不可用时仍能建会话，判型退关键词并如实标 fallback')
      assert(typeof created.accessToken === 'string' && created.accessToken.length >= 32,
        'H4 匿名会话铸出 accessToken（明文只回传一次）')
      assert(created.aiAvailable === false, 'H5 会话视图如实透出 aiAvailable=false')

      const anon = { endUserId: null, accessToken: created.accessToken! }
      const reread = await svc.getSession(created.sessionId, anon)
      assert(reread.sessionId === created.sessionId,
        'H6 正向：AI 挂着也能读回已有会话与进度（作业面停在当前进度，不是整页瘫痪）')
      await expectReject('ADVISOR_SESSION_NOT_FOUND', 'H7 反向：错误的匿名 token → NOT_FOUND',
        () => svc.getSession(created.sessionId, { endUserId: null, accessToken: 'wrong-token-value' }))
    }

    // ══ I. 留存清理：过期的用户原话必须被物理删除 ════════════════
    //
    // 合规背景（CLAUDE.md §11）：topic / slotsJson / AdvisorPin.content 落的是
    // 用户**未脱敏的原话**。在 AdvisorRetentionTask 之前，expiresAt 只在
    // loadOwned() 读路径挡人，行本身永久留库 —— 用户看不到也删不掉，但明文还在。
    //
    // 先反向（证明过期行确实还在库里、只是读不到），再正向（证明清理真的删掉它），
    // 再反向（证明**没过期**的会话不会被误删 —— 这是「不得破坏现有功能」的证据）。
    section('I. 留存清理（过期原话物理删除）')
    {
      const retention = new AdvisorRetentionTask(prisma, audit)
      const svc = new AdvisorService(
        prisma,
        new LlmAdvisorService(readyConfig),
        new AdvisorArtifactService(prisma, pdf, filesStub, audit),
        audit,
        aiLog,
      )
      const secretTopic = `我叫王某某手机13800138000_留存标记${s}`

      const expiredId = `adv_expired_${s}`
      await prisma.advisorSession.create({
        data: {
          id: expiredId, endUserId: userA, skill: 'qa', status: 'completed',
          topic: secretTopic, slotsJson: '{}',
          expiresAt: new Date(Date.now() - 60_000),
        },
      })
      sessionIds.push(expiredId)
      await prisma.advisorPin.create({
        data: { sessionId: expiredId, idx: 0, content: secretTopic, evidenceLevel: 'E1' },
      })
      await prisma.advisorArtifact.create({
        data: {
          sessionId: expiredId, kind: 'qa_pins', payloadJson: JSON.stringify({ topic: secretTopic }),
          provider: 'llm:verify:stub', expiresAt: new Date(Date.now() - 60_000),
        },
      })

      const liveId = `adv_live_${s}`
      await prisma.advisorSession.create({
        data: {
          id: liveId, endUserId: userA, skill: 'qa', status: 'collecting',
          topic: `未过期会话_${s}`, slotsJson: '{}',
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      })
      sessionIds.push(liveId)

      // I1 反向：清理跑之前，过期行确实还躺在库里（这正是本批次查出来的缺口）
      assert(await prisma.advisorSession.findUnique({ where: { id: expiredId } }) !== null,
        'I1 反向：过期会话在清理前仍然物理存在（读不到 ≠ 已删除）')
      await expectReject('ADVISOR_SESSION_NOT_FOUND', 'I2 反向：过期会话对本人也已读不到',
        () => svc.getSession(expiredId, { endUserId: userA, accessToken: null }))

      const result = await retention.cleanupExpired('manual')
      assert(result.deletedSessions >= 1, 'I3 正向：清理任务报告删除了过期会话')

      assert(await prisma.advisorSession.findUnique({ where: { id: expiredId } }) === null,
        'I4 正向：过期会话已被物理删除')
      assert(await prisma.advisorPin.count({ where: { sessionId: expiredId } }) === 0,
        'I5 正向：过期会话的钉住条目原文一并消失')
      assert(await prisma.advisorArtifact.count({ where: { sessionId: expiredId } }) === 0,
        'I6 正向：过期会话的产物一并消失')

      // I7 是「不得破坏现有功能」的硬证据：清理只碰过期行
      assert(await prisma.advisorSession.findUnique({ where: { id: liveId } }) !== null,
        'I7 反向：未过期会话不受影响（清理不是无差别删表）')
      const stillReadable = await svc.getSession(liveId, { endUserId: userA, accessToken: null })
      assert(stillReadable.topic === `未过期会话_${s}`,
        'I8 正向：未过期会话本人仍读得到，且拿回的是自己写的原话而不是占位符')

      // I9：删除必须留痕（CLAUDE.md §11），但痕里不许有原话
      const auditRow = await prisma.auditLog.findFirst({
        where: { action: 'advisor_session.cleanup_expired' },
        orderBy: { createdAt: 'desc' },
      })
      assert(auditRow !== null, 'I9 正向：清理写了系统审计行')
      assert(!!auditRow && !auditRow.payloadJson.includes(secretTopic),
        'I10 反向：审计 payload 里不含被删掉的用户原话')
      if (auditRow) await prisma.auditLog.deleteMany({ where: { id: auditRow.id } })
    }

    console.log(`\n=== 顾问作业面验证通过：${passCount} PASS ===\n`)
  } finally {
    restoreFetch()
    await cleanup()
    await prisma.onModuleDestroy()
  }
}

async function initFallbackDb(): Promise<void> {
  const client = createClient({ url: process.env['DATABASE_URL']! })
  try {
    await client.batch([
      `CREATE TABLE "EndUser" ("id" TEXT NOT NULL PRIMARY KEY, "phoneHash" TEXT NOT NULL, "phoneEnc" TEXT NOT NULL, "wxOpenId" TEXT, "nickname" TEXT, "enabled" BOOLEAN NOT NULL DEFAULT true, "status" TEXT NOT NULL DEFAULT 'active', "statusChangedAt" DATETIME, "closingRequestedAt" DATETIME, "anonymizedAt" DATETIME, "lastLoginAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE UNIQUE INDEX "EndUser_phoneHash_key" ON "EndUser"("phoneHash")`,
      `CREATE TABLE "AuditLog" ("id" TEXT NOT NULL PRIMARY KEY, "actorId" TEXT, "actorRole" TEXT NOT NULL, "action" TEXT NOT NULL, "targetType" TEXT NOT NULL, "targetId" TEXT, "payloadJson" TEXT NOT NULL DEFAULT '{}', "ipAddress" TEXT, "userAgent" TEXT, "requestId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE "AiServiceLog" ("id" TEXT NOT NULL PRIMARY KEY, "operation" TEXT NOT NULL, "provider" TEXT, "status" TEXT NOT NULL, "latencyMs" INTEGER, "errorCode" TEXT, "tokenUsageJson" TEXT NOT NULL DEFAULT '{}', "estimatedCostCny" REAL, "terminalId" TEXT, "endUserId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE "AdvisorSession" ("id" TEXT NOT NULL PRIMARY KEY, "endUserId" TEXT, "accessTokenHash" TEXT, "skill" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'collecting', "topic" TEXT NOT NULL, "skillReason" TEXT, "skillSource" TEXT NOT NULL DEFAULT 'llm', "slotsJson" TEXT NOT NULL DEFAULT '{}', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" DATETIME NOT NULL)`,
      `CREATE INDEX "AdvisorSession_endUserId_createdAt_idx" ON "AdvisorSession"("endUserId","createdAt")`,
      `CREATE TABLE "AdvisorPin" ("id" TEXT NOT NULL PRIMARY KEY, "sessionId" TEXT NOT NULL, "idx" INTEGER NOT NULL, "content" TEXT NOT NULL, "evidenceLevel" TEXT NOT NULL, "sourceNote" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AdvisorPin_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AdvisorSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE)`,
      `CREATE INDEX "AdvisorPin_sessionId_idx_idx" ON "AdvisorPin"("sessionId","idx")`,
      `CREATE TABLE "AdvisorArtifact" ("id" TEXT NOT NULL PRIMARY KEY, "sessionId" TEXT NOT NULL, "kind" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'completed', "payloadJson" TEXT NOT NULL, "provider" TEXT NOT NULL, "fileId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" DATETIME NOT NULL, CONSTRAINT "AdvisorArtifact_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AdvisorSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE)`,
      `CREATE INDEX "AdvisorArtifact_sessionId_createdAt_idx" ON "AdvisorArtifact"("sessionId","createdAt")`,
    ])
  } finally {
    client.close()
  }
}

main().catch((error) => {
  console.error('\n验证脚本异常：', error)
  process.exit(1)
})
