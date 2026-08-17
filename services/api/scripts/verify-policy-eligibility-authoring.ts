/**
 * P21 政策申领条件「录入面」验证（P21-PARTNER-UI）。
 *
 * verify:policy-eligibility 守的是**判定本身**不编造；本脚本守的是
 * **录入与预览**这一侧不编造。两条独立断言线，覆盖两件在录入面才会出错的事：
 *
 *  A.「只能人工核对」是真的判不了，不是换个说法的「不符合」
 *     —— 穷举九个问项的**每一个**取值 + 不作答，manual 条件恒为 unknown。
 *        这一条是本批次的核心：真实政策里「经街道办核实的困难家庭」这类条款
 *        机器判不了；若录入面不给这一档，运营只能硬塞一个与原文不符的规则，
 *        那就是替政策编口径。给了这一档，就必须保证它永远不产出结论。
 *
 *  B. 录入面看到的「试算」结果 = 用户在一体机上拿到的判定
 *     —— 运行时：同一条政策 + 同一组作答，preview 与公开 check 逐字段一致。
 *        静态：两条路径都只经 PolicyEligibilityService.evaluateRow()，
 *        且前端不含任何比对逻辑（否则录入面的绿灯是自己算的，与用户无关）。
 *
 * 另守：录入面不绕审核（保存条件强制回 pending+draft）、跨机构越权、
 * 预览零落库、演示模式不给假判定。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:policy-eligibility-authoring
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { PoliciesService } from '../src/policies/policies.service'
import { PolicyEligibilityService } from '../src/policies/policy-eligibility.service'
import { validatePolicyEligibilityRules } from '../src/policies/policy-eligibility.engine'
import {
  POLICY_ELIGIBILITY_QUESTIONS,
  POLICY_RULE_MANUAL_MODE,
  type PolicyEligibilityRuleInput,
} from '../src/policies/policy-eligibility.types'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'

let passed = 0
function pass(m: string) { passed += 1; console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }
function check(cond: boolean, m: string) { if (cond) pass(m); else fail(m) }

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}

async function expectCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望错误 ${code}，但调用成功`)
  } catch (e) {
    const c = errCode(e)
    if (c === code) pass(label)
    else fail(`${label} — 期望 ${code}，实际: ${c ?? (e as Error).message}`)
  }
}

const PARTNER_SRC = join(__dirname, '../../../apps/partner/src')
const readPartner = (rel: string) => readFileSync(join(PARTNER_SRC, rel), 'utf-8')

async function main() {
  console.log('\n=== P21 申领条件录入面验证（P21-PARTNER-UI）===')

  // ── 1. 写入校验：manual 的形状约束 ───────────────────────────────────────
  {
    const manual: PolicyEligibilityRuleInput = {
      label: '经街道办核实的困难家庭',
      sourceText: '申领对象须为经户籍所在地街道办事处核实的困难家庭成员。',
      matchMode: POLICY_RULE_MANUAL_MODE,
      clauses: [],
    }
    check(validatePolicyEligibilityRules([manual]) === null, '1a. 零子句的「只能人工核对」条件可入库')

    check(
      validatePolicyEligibilityRules([{ ...manual, sourceText: '  ' }])?.code === 'POLICY_RULE_SOURCE_TEXT_REQUIRED',
      '1b. 人工核对条件同样必须有政策原文摘录（不给原文＝没有依据）',
    )
    check(
      validatePolicyEligibilityRules([{
        ...manual,
        clauses: [{ questionKey: 'household_social', satisfiedValues: ['local_household'], conflictValues: [] }],
      }])?.code === 'POLICY_RULE_MANUAL_CLAUSES_NOT_ALLOWED',
      '1c. 人工核对条件不得再挂比对子句（不许「顺便也比一下」）',
    )
    check(
      validatePolicyEligibilityRules([{ ...manual, matchMode: 'sometimes' as never }])?.code === 'POLICY_RULE_MATCH_MODE_INVALID',
      '1d. 未登记的判定方式被拒',
    )
  }

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const policies = new PoliciesService(prisma, audit)
  const eligibility = new PolicyEligibilityService(prisma, audit)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const orgA = `org_pea_a_${suffix}`
  const orgB = `org_pea_b_${suffix}`
  await prisma.organization.createMany({
    data: [
      // contentTrustStatus='active':发布闸门要求来源机构已通过内容信任核验(见 src/common/content-trust.ts)
      { id: orgA, name: `录入面机构A_${suffix}`, type: 'public_employment_service', contentTrustStatus: 'active' },
      { id: orgB, name: `录入面机构B_${suffix}`, type: 'public_employment_service', contentTrustStatus: 'active' },
    ],
  })
  const partnerARow = await prisma.user.create({
    data: { username: `pea_pa_${suffix}`, passwordHash: 'x', name: 'A机构账号', role: 'partner', orgId: orgA },
  })
  const partnerBRow = await prisma.user.create({
    data: { username: `pea_pb_${suffix}`, passwordHash: 'x', name: 'B机构账号', role: 'partner', orgId: orgB },
  })
  const adminRow = await prisma.user.create({
    data: { username: `pea_admin_${suffix}`, passwordHash: 'x', name: '验证管理员', role: 'admin' },
  })
  const partnerA: AuthedUser = { userId: partnerARow.id, role: 'partner', orgId: orgA }
  const partnerB: AuthedUser = { userId: partnerBRow.id, role: 'partner', orgId: orgB }
  const admin: AuthedUser = { userId: adminRow.id, role: 'admin', orgId: null }

  const cleanup = async () => {
    await prisma.policyEligibilityRule.deleteMany({ where: { policy: { sourceOrgId: { in: [orgA, orgB] } } } })
    await prisma.policyPost.deleteMany({ where: { sourceOrgId: { in: [orgA, orgB] } } })
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [partnerA.userId, partnerB.userId, admin.userId] } } })
    await prisma.user.deleteMany({ where: { id: { in: [partnerA.userId, partnerB.userId, admin.userId] } } })
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } })
  }

  try {
    const post = await policies.createPartnerPolicy(
      { kind: 'policy_guide', title: `就业困难人员社保补贴_${suffix}`, audience: 'hardship' },
      partnerA,
    )

    const rules: PolicyEligibilityRuleInput[] = [
      {
        label: '本市户籍',
        sourceText: '申领对象为本市户籍人员。',
        matchMode: 'all',
        clauses: [{
          questionKey: 'household_social',
          satisfiedValues: ['local_household'],
          conflictValues: ['nonlocal_without_insurance'],
        }],
      },
      {
        label: '经街道办核实的困难家庭',
        sourceText: '申领对象须为经户籍所在地街道办事处核实的困难家庭成员。',
        matchMode: POLICY_RULE_MANUAL_MODE,
        clauses: [],
      },
    ]
    const saved = await eligibility.replacePartnerRules(post.id, rules, partnerA)

    // ── 2. manual 条件的库往返 ───────────────────────────────────────────
    {
      const manualRow = saved.find((r) => r.label === '经街道办核实的困难家庭')
      check(manualRow?.matchMode === POLICY_RULE_MANUAL_MODE, '2a. manual 判定方式原样落库并读回')
      check(manualRow?.clauses.length === 0, '2b. manual 条件读回时零子句（不返回损坏哨兵）')
      check(
        manualRow?.sourceText === '申领对象须为经户籍所在地街道办事处核实的困难家庭成员。',
        '2c. manual 条件的政策原文一字不改地读回',
      )
    }

    // ── 3. 保存条件不绕审核 ──────────────────────────────────────────────
    {
      const row = await prisma.policyPost.findUnique({ where: { id: post.id } })
      check(
        row?.reviewStatus === 'pending' && row?.publishStatus === 'draft',
        `3a. 保存条件后强制回 pending+draft（实际 ${row?.reviewStatus}+${row?.publishStatus}）`,
      )
      await expectCode(
        () => eligibility.replacePartnerRules(post.id, rules, partnerB),
        'POLICY_NOT_FOUND',
        '3b. 他机构不得替本机构改条件',
      )
    }

    // ── 4. 【核心】manual 条件在任何作答下都判不出结论 ────────────────────
    //
    // 穷举九个问项的每一个取值（含「不确定」）逐项单独作答，再加一次不作答，
    // 共 N+1 次预览。manual 那条必须次次 unknown —— 一次 matched 或 conflict
    // 就说明「只能人工核对」被偷偷当成了一个可比对的规则。
    {
      const cases: Record<string, string>[] = [{}]
      for (const q of POLICY_ELIGIBILITY_QUESTIONS) {
        for (const o of q.options) cases.push({ [q.key]: o.value })
      }
      // 再加一组「全填满」的极端作答
      const all: Record<string, string> = {}
      for (const q of POLICY_ELIGIBILITY_QUESTIONS) all[q.key] = q.options[0].value
      cases.push(all)

      const manualResults = new Set<string>()
      const manualReasons = new Set<string>()
      for (const answers of cases) {
        const res = await eligibility.previewPartnerRules(post.id, { answers }, partnerA)
        const manual = res.items[0].conditions.find((c) => c.label === '经街道办核实的困难家庭')
        if (!manual) fail(`4x. 预览里找不到人工核对条件（作答 ${JSON.stringify(Object.keys(answers))}）`)
        manualResults.add(manual.result)
        manualReasons.add(manual.reasonCode)
      }
      check(
        manualResults.size === 1 && manualResults.has('unknown'),
        `4a. 穷举 ${cases.length} 组作答，人工核对条件恒为 unknown（实际取值集合 ${[...manualResults].join(',')}）`,
      )
      check(
        manualReasons.size === 1 && manualReasons.has('MANUAL_REVIEW_ONLY'),
        '4b. 人工核对条件的原因码恒为 MANUAL_REVIEW_ONLY，不冒充「你没填」',
      )

      // 同一次预览里，可比对的那条必须照常给结论 ——
      // 否则「恒 unknown」可能只是判定整体坏掉了，而不是 manual 生效。
      const matched = await eligibility.previewPartnerRules(
        post.id,
        { answers: { household_social: 'local_household' } },
        partnerA,
      )
      const auto = matched.items[0].conditions.find((c) => c.label === '本市户籍')
      check(auto?.result === 'matched', '4c. 同一次预览里可比对条件照常判 matched（证明 4a 不是判定整体失灵）')
      check(matched.items[0].manualReviewRequired === true, '4d. 含人工核对条件的政策整体标记为需人工核对')
      check(matched.items[0].summary.unknown >= 1, '4e. 人工核对条件计入 unknown 而非 matched')
    }

    // ── 5. 【核心】预览与真实判定同路径 ──────────────────────────────────
    {
      await policies.reviewPolicy(post.id, 'approve', undefined, admin)
      await policies.publishPolicy(post.id, 'publish', admin)

      const answerSets: Record<string, string>[] = [
        {},
        { household_social: 'local_household' },
        { household_social: 'nonlocal_without_insurance' },
        { household_social: 'unsure' },
        { household_social: 'nonlocal_with_local_insurance' },
      ]
      for (const [i, answers] of answerSets.entries()) {
        const preview = await eligibility.previewPartnerRules(post.id, { answers }, partnerA)
        const real = await eligibility.checkEligibility({ policyIds: [post.id], answers })
        const same =
          JSON.stringify(preview.items[0].conditions) === JSON.stringify(real.items[0].conditions) &&
          preview.items[0].overall === real.items[0].overall &&
          preview.items[0].overallLabel === real.items[0].overallLabel &&
          preview.items[0].summary.matched === real.items[0].summary.matched &&
          preview.items[0].summary.conflict === real.items[0].summary.conflict &&
          preview.items[0].summary.unknown === real.items[0].summary.unknown
        check(same, `5a.${i} 预览与公开核对逐字段一致（作答 ${JSON.stringify(answers)}）`)
      }
      check(
        (await eligibility.previewPartnerRules(post.id, { answers: {} }, partnerA)).method === 'deterministic_comparison',
        '5b. 预览同样声明为确定性比对（不是模型推断）',
      )
    }

    // ── 6. 预览的取数门槛与越权 ──────────────────────────────────────────
    {
      // 草稿状态下必须能预览：条件正是在草稿阶段录的，不能要求先过审才能试算
      const draft = await policies.createPartnerPolicy(
        { kind: 'policy_guide', title: `草稿政策_${suffix}`, audience: 'graduate' },
        partnerA,
      )
      await eligibility.replacePartnerRules(draft.id, [rules[0]], partnerA)
      const draftPreview = await eligibility.previewPartnerRules(draft.id, { answers: {} }, partnerA)
      check(draftPreview.items.length === 1, '6a. 未审未发的草稿政策可以试算（录入阶段就要能看效果）')

      // 但公开核对绝不能看到它
      const publicCheck = await eligibility.checkEligibility({ policyIds: [draft.id], answers: {} })
      check(publicCheck.items.length === 0, '6b. 未审未发的草稿政策不进公开核对面')

      await expectCode(
        () => eligibility.previewPartnerRules(draft.id, { answers: {} }, partnerB),
        'POLICY_NOT_FOUND',
        '6c. 他机构不得试算本机构政策',
      )
    }

    // ── 7. 预览零落库 ────────────────────────────────────────────────────
    {
      const auditBefore = await prisma.auditLog.count()
      const ruleBefore = await prisma.policyEligibilityRule.count()
      const postBefore = await prisma.policyPost.findUnique({ where: { id: post.id } })
      await eligibility.previewPartnerRules(
        post.id,
        { answers: { household_social: 'local_household', age_range: 'age_25_35' } },
        partnerA,
      )
      const postAfter = await prisma.policyPost.findUnique({ where: { id: post.id } })
      check(await prisma.auditLog.count() === auditBefore, '7a. 试算不写 AuditLog（假想作答同样不留档）')
      check(await prisma.policyEligibilityRule.count() === ruleBefore, '7b. 试算不改任何条件行')
      check(
        postBefore?.reviewStatus === postAfter?.reviewStatus && postBefore?.publishStatus === postAfter?.publishStatus,
        '7c. 试算不改政策审核/发布状态（预览不是一次编辑）',
      )
    }
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

  // ── 8. 静态：服务端只有一条判定路径 ──────────────────────────────────────
  {
    const svc = readFileSync(join(__dirname, '../src/policies/policy-eligibility.service.ts'), 'utf-8')
    const body = svc.slice(svc.indexOf('export class PolicyEligibilityService'))
    // evaluatePolicy 只允许出现在 evaluateRow 一处（import 行在 class 之前，已被切掉）
    const directCalls = (body.match(/evaluatePolicy\(/g) ?? []).length
    check(directCalls === 1, `8a. evaluatePolicy 全类只被调用 1 次（实际 ${directCalls} 次，多于 1 次＝出现了第二条判定路径）`)

    const checkBody = body.slice(body.indexOf('async checkEligibility'), body.indexOf('async previewPartnerRules'))
    const previewBody = body.slice(body.indexOf('async previewPartnerRules'), body.indexOf('private evaluateRow'))
    check(checkBody.includes('this.evaluateRow('), '8b. 公开核对经 evaluateRow')
    check(previewBody.includes('this.evaluateRow('), '8c. 录入面预览经同一个 evaluateRow')
    const writeOps = ['.create(', '.createMany(', '.update(', '.updateMany(', '.upsert(', '.delete(', 'audit.write(']
    const hit = writeOps.filter((op) => previewBody.includes(op))
    check(hit.length === 0, `8d. 预览路径无任何写操作${hit.length ? `（命中: ${hit.join(',')}）` : ''}`)
  }

  // ── 9. 静态：前端不含判定逻辑 ────────────────────────────────────────────
  //
  // 用一条正交不变量代替脆弱的关键词黑名单：
  //   - 持有「用户作答」的文件（抽屉）绝不碰取值集合；
  //   - 碰取值集合的文件（条件编辑器）绝不持有作答。
  // 两边都碰不到对方，前端在结构上就无法自己比对一遍。
  {
    const drawer = readPartner('routes/policy/EligibilityRulesDrawer.tsx')
    const editor = readPartner('routes/policy/EligibilityRuleEditor.tsx')

    check(
      !drawer.includes('satisfiedValues') && !drawer.includes('conflictValues'),
      '9a. 持有试算作答的抽屉不碰任何取值集合',
    )
    check(!editor.includes('answers'), '9b. 编辑取值集合的编辑器不持有任何作答')
    check(
      drawer.includes('partnerPoliciesService.previewEligibility('),
      '9c. 试算结果来自服务端 previewEligibility，不是本地计算',
    )
    check(
      !drawer.includes('POLICY_ELIGIBILITY_QUESTIONS') && !editor.includes("questionKey: '"),
      '9d. 前端不硬编码问项字典（取值漂移会让已录条件静默失配）',
    )

    // 演示模式不得给假判定 / 假保存
    const api = readPartner('services/api/policies.ts')
    const mockStart = api.indexOf('const mockAdapter')
    const mockBody = api.slice(mockStart, api.indexOf('export const partnerPoliciesService'))
    for (const fn of ['getEligibilityQuestions', 'getEligibilityRules', 'replaceEligibilityRules', 'previewEligibility']) {
      const at = mockBody.indexOf(fn)
      const line = mockBody.slice(at, at + 120)
      check(at > 0 && line.includes('throw mockUnsupported()'), `9e.${fn} 演示模式如实拒绝，不返回假数据`)
    }

    // 录入面必须明说保存会重新提审（不绕审核，且不伪装成即时生效）
    check(
      drawer.includes('保存条件并重新提审') && drawer.includes('待审核'),
      '9f. 录入面明示保存后回到待审核，不伪装成即时生效',
    )
    // 「只能人工核对」必须是录入面的一等选项
    check(editor.includes('只能人工核对'), '9g. 录入面提供「只能人工核对」一档')
  }

  // ── 10. CI 注册（本门禁自己必须真的会被跑）──────────────────────────────
  {
    const cmd = 'pnpm --filter @ai-job-print/api verify:policy-eligibility-authoring'
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as {
      scripts: Record<string, string>
    }
    check(
      typeof pkg.scripts['verify:policy-eligibility-authoring'] === 'string',
      '10a. package.json 注册了 verify:policy-eligibility-authoring',
    )

    const ci = readFileSync(join(__dirname, '../../../.github/workflows/ci.yml'), 'utf-8')
    const lines = ci.split(/\r?\n/)
    // 数「本命令出现在哪些 job 下」，而不是数出现次数 —— 同一 job 里写两遍不算两个 job
    const jobs: string[] = []
    let currentJob = ''
    for (const line of lines) {
      const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
      if (m) currentJob = m[1]
      if (line.trim().replace(/^run:\s*/, '') === cmd && currentJob && !jobs.includes(currentJob)) {
        jobs.push(currentJob)
      }
    }
    check(jobs.length >= 2, `10b. 本门禁挂进了 ≥2 个 CI job（实际: ${jobs.join(', ') || '无'}）`)

    // 元门禁：把本门禁纳入「防漏跑」清单，否则将来有人从 CI 里删掉也没人知道
    const meta = readFileSync(join(__dirname, '../../../scripts/verify-ci-gate-coverage.mjs'), 'utf-8')
    check(meta.includes(cmd), '10c. 本门禁已纳入 verify-ci-gate-coverage 防漏跑清单')
  }

  console.log(`\n=== P21 申领条件录入面验证通过：${passed} PASS ===\n`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
