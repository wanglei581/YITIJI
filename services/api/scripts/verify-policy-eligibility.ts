/**
 * P21 政策条件核对（S3-2）验证。
 *
 * 这一能力的价值全在「不编造」上，所以断言重点不是「能不能出结果」，
 * 而是「在信息不足时会不会硬给结论」。覆盖：
 *
 *   1. 问项字典自身的性质：每个问项都有「不确定」；取值稳定（无中文主键）。
 *   2. 条件写入校验：'unsure' 不得进相符/不符集合；取值必须在字典内；
 *      原文摘录必填；相符/不符集合不得相交。
 *   3. 三态判定：未答 / 「不确定」/ 取值未被条件覆盖 → 一律 unknown，
 *      绝不折叠成 conflict（**先破后立**：反向断言若折叠成布尔会被抓到）。
 *   4. 多子句 Kleene 合取：all / any 两种模式都不把 unknown 吃成 conflict。
 *   5. 依据可追溯：每条判定都原样带回入库的 sourceText，一字不改。
 *   6. 来源标识齐全（CLAUDE.md §10）：sourceOrgId / externalId / sourceName /
 *      sourceUrl / syncTime / reviewStatus / publishStatus。
 *   7. 证据分级恒为 E2，绝不出现 E3 / 「AI 判断」——判定不调模型。
 *   8. 合规文案：不得出现「符合申领资格」这类结论式表述。
 *   9. 隐私：核对全程零落库（作答不进任何表、不进 AuditLog）。
 *  10. 门禁面：未过审 / 未发布政策不得进入核对；改条件强制回 pending+draft。
 *  11. 静态守卫：policies 模块不得引入 LLM / AiLogService。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:policy-eligibility
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { PoliciesService } from '../src/policies/policies.service'
import { PolicyEligibilityService } from '../src/policies/policy-eligibility.service'
import {
  evaluateRule,
  sanitizeAnswers,
  validatePolicyEligibilityRules,
} from '../src/policies/policy-eligibility.engine'
import {
  POLICY_ELIGIBILITY_QUESTIONS,
  POLICY_ELIGIBILITY_UNSURE,
  type PolicyEligibilityRuleInput,
  type PolicyEligibilityRuleRecord,
} from '../src/policies/policy-eligibility.types'
import { PolicyEligibilityCheckDto } from '../src/policies/dto/policy.dto'
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

/** 造一条规则记录（绕过库，直接喂引擎）。 */
function rule(
  id: string,
  matchMode: 'all' | 'any',
  clauses: { questionKey: string; satisfiedValues: string[]; conflictValues?: string[] }[],
): PolicyEligibilityRuleRecord {
  return {
    id,
    orderIndex: 0,
    label: `条件_${id}`,
    sourceText: `原文摘录_${id}`,
    matchMode,
    clauses: clauses.map((c) => ({
      questionKey: c.questionKey,
      satisfiedValues: c.satisfiedValues,
      conflictValues: c.conflictValues ?? [],
    })),
  }
}

async function main() {
  console.log('\n=== P21 政策条件核对（S3-2）验证 ===')

  // ── 1. 问项字典自身的性质 ───────────────────────────────────────────────
  {
    check(POLICY_ELIGIBILITY_QUESTIONS.length === 9, `1a. 问项共 9 项（实际 ${POLICY_ELIGIBILITY_QUESTIONS.length}）`)

    const missingUnsure = POLICY_ELIGIBILITY_QUESTIONS.filter(
      (q) => !q.options.some((o) => o.value === POLICY_ELIGIBILITY_UNSURE),
    )
    check(missingUnsure.length === 0, `1b. 每个问项都提供「不确定」选项${missingUnsure.length ? `（缺: ${missingUnsure.map((q) => q.key).join(',')}）` : ''}`)

    // 取值必须是稳定标识：中文当主键会随文案改动而把已录入条件打散
    const nonAscii = POLICY_ELIGIBILITY_QUESTIONS.flatMap((q) =>
      q.options.filter((o) => !/^[a-z0-9_]+$/.test(o.value)).map((o) => `${q.key}.${o.value}`),
    )
    check(nonAscii.length === 0, `1c. 取值全为稳定 ASCII 标识${nonAscii.length ? `（违例: ${nonAscii.join(',')}）` : ''}`)

    const keys = POLICY_ELIGIBILITY_QUESTIONS.map((q) => q.key)
    check(new Set(keys).size === keys.length, '1d. 问项 key 无重复')

    // 毕业年份不得写死年号（跨年会静默失配）
    const gradYear = POLICY_ELIGIBILITY_QUESTIONS.find((q) => q.key === 'graduation_year')
    const hasYearLiteral = (gradYear?.options ?? []).some((o) => /20\d\d/.test(o.value) || /20\d\d/.test(o.label))
    check(!hasYearLiteral, '1e. 毕业年份问项不含写死的年号')
  }

  // ── 2. 条件写入校验（三态地基）───────────────────────────────────────────
  {
    const okRule: PolicyEligibilityRuleInput = {
      label: '本市户籍或本市缴社保',
      sourceText: '申领对象为本市户籍或在本市缴纳社会保险的人员。',
      matchMode: 'all',
      clauses: [{
        questionKey: 'household_social',
        satisfiedValues: ['local_household', 'nonlocal_with_local_insurance'],
        conflictValues: ['nonlocal_without_insurance'],
      }],
    }
    check(validatePolicyEligibilityRules([okRule]) === null, '2a. 合法条件通过校验')

    const unsureRule = { ...okRule, clauses: [{ ...okRule.clauses[0], satisfiedValues: [POLICY_ELIGIBILITY_UNSURE] }] }
    check(
      validatePolicyEligibilityRules([unsureRule])?.code === 'POLICY_RULE_UNSURE_NOT_ALLOWED',
      '2b. 「不确定」写进相符集合被拒（三态守卫）',
    )
    const unsureConflict = { ...okRule, clauses: [{ ...okRule.clauses[0], conflictValues: [POLICY_ELIGIBILITY_UNSURE] }] }
    check(
      validatePolicyEligibilityRules([unsureConflict])?.code === 'POLICY_RULE_UNSURE_NOT_ALLOWED',
      '2c. 「不确定」写进不符集合被拒',
    )

    const noSource = { ...okRule, sourceText: '   ' }
    check(
      validatePolicyEligibilityRules([noSource])?.code === 'POLICY_RULE_SOURCE_TEXT_REQUIRED',
      '2d. 缺政策原文摘录被拒（判定必须可追溯）',
    )

    const badValue = { ...okRule, clauses: [{ ...okRule.clauses[0], satisfiedValues: ['made_up_value'] }] }
    check(
      validatePolicyEligibilityRules([badValue])?.code === 'POLICY_RULE_VALUE_UNKNOWN',
      '2e. 字典外取值被拒',
    )

    const badKey = { ...okRule, clauses: [{ questionKey: 'not_a_question', satisfiedValues: ['x'], conflictValues: [] }] }
    check(
      validatePolicyEligibilityRules([badKey])?.code === 'POLICY_RULE_QUESTION_UNKNOWN',
      '2f. 未登记问项被拒',
    )

    const overlap = {
      ...okRule,
      clauses: [{ questionKey: 'household_social', satisfiedValues: ['local_household'], conflictValues: ['local_household'] }],
    }
    check(
      validatePolicyEligibilityRules([overlap])?.code === 'POLICY_RULE_VALUE_CONFLICT',
      '2g. 同一取值同时相符与不符被拒',
    )

    const emptySatisfied = {
      ...okRule,
      clauses: [{ questionKey: 'household_social', satisfiedValues: [], conflictValues: ['local_household'] }],
    }
    check(
      validatePolicyEligibilityRules([emptySatisfied])?.code === 'POLICY_RULE_SATISFIED_VALUES_REQUIRED',
      '2h. 相符集合为空被拒',
    )
  }

  // ── 3. 三态判定：未答 / 不确定 / 未覆盖 → unknown ────────────────────────
  {
    const r = rule('r1', 'all', [{
      questionKey: 'unemployment_registration',
      satisfiedValues: ['registered'],
      conflictValues: ['not_registered'],
    }])

    const matched = evaluateRule(r, { unemployment_registration: 'registered' })
    check(matched.result === 'matched' && matched.reasonCode === 'ANSWER_MATCHES_RECORDED_CONDITION', '3a. 命中相符取值 → matched')

    const conflict = evaluateRule(r, { unemployment_registration: 'not_registered' })
    check(conflict.result === 'conflict', '3b. 命中不符取值 → conflict')

    const missing = evaluateRule(r, {})
    check(missing.result === 'unknown' && missing.reasonCode === 'ANSWER_MISSING', '3c. 未填写 → unknown（不是 conflict）')

    const unsure = evaluateRule(r, { unemployment_registration: POLICY_ELIGIBILITY_UNSURE })
    check(unsure.result === 'unknown' && unsure.reasonCode === 'ANSWER_UNSURE', '3d. 选「不确定」→ unknown（不是 conflict）')

    // 关键性质：取值只是「没被条件表达过」，不等于「不满足」
    const partial = rule('r2', 'all', [{ questionKey: 'age_range', satisfiedValues: ['age_16_24', 'age_25_35', 'age_36_45'] }])
    const uncovered = evaluateRule(partial, { age_range: 'age_46_plus' })
    check(
      uncovered.result === 'unknown' && uncovered.reasonCode === 'ANSWER_NOT_COVERED_BY_RECORDED_CONDITION',
      '3e. 取值未被条件覆盖 → unknown（绝不默认成 conflict）',
    )

    // 先破后立：若把三态折叠成布尔，3c/3d/3e 必然变成 conflict
    const results = [missing.result, unsure.result, uncovered.result]
    check(!results.includes('conflict'), '3f. 反向断言：三种「信息不足」全都不是 conflict')
    check(new Set([matched.result, conflict.result, missing.result]).size === 3, '3g. 三态确实是三个值，不是布尔')

    check(missing.basis[0].answerValue === null && missing.basis[0].answerLabel === null, '3h. 未填写时 basis 回显 null，不编造取值')
  }

  // ── 4. 多子句 Kleene 合取 ───────────────────────────────────────────────
  {
    const all = rule('r3', 'all', [
      { questionKey: 'unemployment_registration', satisfiedValues: ['registered'], conflictValues: ['not_registered'] },
      { questionKey: 'prior_subsidy', satisfiedValues: ['never_received'], conflictValues: ['received'] },
    ])
    check(evaluateRule(all, { unemployment_registration: 'registered', prior_subsidy: 'never_received' }).result === 'matched', '4a. all：全满足 → matched')
    check(evaluateRule(all, { unemployment_registration: 'registered' }).result === 'unknown', '4b. all：一项未答 → unknown（不是 matched，也不是 conflict）')
    check(evaluateRule(all, { unemployment_registration: 'not_registered' }).result === 'conflict', '4c. all：有明确不符 → conflict')

    const any = rule('r4', 'any', [
      { questionKey: 'age_range', satisfiedValues: ['age_16_24'] },
      { questionKey: 'graduation_year', satisfiedValues: ['current_year', 'within_2_years'], conflictValues: ['over_2_years'] },
    ])
    check(evaluateRule(any, { age_range: 'age_16_24' }).result === 'matched', '4d. any：任一满足 → matched')
    check(evaluateRule(any, { graduation_year: 'over_2_years' }).result === 'unknown', '4e. any：一项不符 + 一项未答 → unknown（不是 conflict）')
    check(
      evaluateRule(any, { age_range: 'age_46_plus', graduation_year: 'over_2_years' }).result === 'unknown',
      '4f. any：一项未覆盖 + 一项不符 → unknown',
    )
    const allConflict = rule('r5', 'any', [
      { questionKey: 'unemployment_registration', satisfiedValues: ['registered'], conflictValues: ['not_registered'] },
      { questionKey: 'prior_subsidy', satisfiedValues: ['never_received'], conflictValues: ['received'] },
    ])
    check(
      evaluateRule(allConflict, { unemployment_registration: 'not_registered', prior_subsidy: 'received' }).result === 'conflict',
      '4g. any：全部子句都明确不符才 conflict',
    )
  }

  // ── 5. sanitizeAnswers：丢弃非法输入且不回传取值 ─────────────────────────
  {
    const { answers, ignoredQuestionKeys } = sanitizeAnswers({
      household_social: 'local_household',
      age_range: 'not_a_real_option',
      made_up_key: 'whatever',
      unemployment_registration: 42,
    })
    check(Object.keys(answers).length === 1 && answers['household_social'] === 'local_household', '5a. 只保留字典内的合法作答')
    check(
      ignoredQuestionKeys.sort().join(',') === ['age_range', 'made_up_key', 'unemployment_registration'].sort().join(','),
      '5b. 非法作答只回传键名',
    )
    // 回传的是键名，不含任何用户填的取值
    const serialized = JSON.stringify(ignoredQuestionKeys)
    check(!serialized.includes('not_a_real_option') && !serialized.includes('whatever'), '5c. 忽略项不回传用户填的取值（隐私）')
  }

  // ── 6+ 端到端（落库路径）───────────────────────────────────────────────
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const policies = new PoliciesService(prisma, audit)
  const eligibility = new PolicyEligibilityService(prisma, audit)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const orgA = `org_pe_a_${suffix}`
  const orgB = `org_pe_b_${suffix}`
  await prisma.organization.createMany({
    data: [
      // contentTrustStatus='active':发布闸门要求来源机构已通过内容信任核验(见 src/common/content-trust.ts)
      { id: orgA, name: `政策机构A_${suffix}`, type: 'public_employment_service', contentTrustStatus: 'active' },
      { id: orgB, name: `政策机构B_${suffix}`, type: 'public_employment_service', contentTrustStatus: 'active' },
    ],
  })
  const partnerARow = await prisma.user.create({
    data: { username: `pe_pa_${suffix}`, passwordHash: 'x', name: 'A机构账号', role: 'partner', orgId: orgA },
  })
  const partnerBRow = await prisma.user.create({
    data: { username: `pe_pb_${suffix}`, passwordHash: 'x', name: 'B机构账号', role: 'partner', orgId: orgB },
  })
  const adminRow = await prisma.user.create({
    data: { username: `pe_admin_${suffix}`, passwordHash: 'x', name: '验证管理员', role: 'admin' },
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
      {
        kind: 'policy_guide',
        title: `一次性求职创业补贴_${suffix}`,
        audience: 'graduate',
        summary: '验证用条目',
        externalUrl: 'https://example.gov.cn/policy/1',
        externalId: `人社〔2026〕14 号_${suffix}`,
      },
      partnerA,
    )
    check(post.externalId === `人社〔2026〕14 号_${suffix}`, '6a. PolicyPost 落地 externalId（补齐 §10 外部ID）')

    const inputRules: PolicyEligibilityRuleInput[] = [
      {
        label: '本市户籍或本市缴社保',
        sourceText: '申领对象为本市户籍，或以非本市户籍身份在本市缴纳社会保险的人员。',
        matchMode: 'all',
        clauses: [{
          questionKey: 'household_social',
          satisfiedValues: ['local_household', 'nonlocal_with_local_insurance'],
          conflictValues: ['nonlocal_without_insurance'],
        }],
      },
      {
        label: '已办失业登记',
        sourceText: '申领人须已在本市办理失业登记。',
        matchMode: 'all',
        clauses: [{ questionKey: 'unemployment_registration', satisfiedValues: ['registered'], conflictValues: ['not_registered'] }],
      },
      {
        label: '本年度未领过同类补贴',
        sourceText: '每人每年限领一次，同一年度已领同类补贴的不再受理。',
        matchMode: 'all',
        clauses: [{ questionKey: 'prior_subsidy', satisfiedValues: ['never_received'], conflictValues: ['received'] }],
      },
    ]

    // 越权：他机构不得读写本机构条件
    await expectCode(() => eligibility.getPartnerRules(post.id, partnerB), 'POLICY_NOT_FOUND', '6b. 他机构读条件被拒')
    await expectCode(() => eligibility.replacePartnerRules(post.id, inputRules, partnerB), 'POLICY_NOT_FOUND', '6c. 他机构写条件被拒')

    const saved = await eligibility.replacePartnerRules(post.id, inputRules, partnerA)
    check(saved.length === 3 && saved[0].orderIndex === 0 && saved[2].orderIndex === 2, '6d. 条件整组写入并保序')
    check(saved[0].clauses[0].questionKey === 'household_social', '6e. clauses JSON 往返无损')

    // 改条件强制回 pending+draft（不得绕过审核改变判定结果）
    const afterWrite = (await policies.getAllPolicySources()).find((p) => p.id === post.id)!
    check(afterWrite.reviewStatus === 'pending' && afterWrite.publishStatus === 'draft', '6f. 改条件强制回 pending+draft 重审')

    // 未过审 → 不进核对面
    const beforeApprove = await eligibility.checkEligibility({ policyIds: [post.id], answers: {} })
    check(beforeApprove.items.length === 0, '6g. 未过审政策不进入条件核对')

    await policies.reviewPolicy(post.id, 'approve', undefined, admin)
    await policies.publishPolicy(post.id, 'publish', admin)

    // ── 7. 核对结果契约 ───────────────────────────────────────────────────
    const mixed = await eligibility.checkEligibility({
      policyIds: [post.id],
      answers: {
        household_social: 'local_household',        // 相符
        unemployment_registration: 'not_registered', // 不符
        // prior_subsidy 故意不答 → 无法判定
      },
    })
    check(mixed.items.length === 1, '7a. 已发布政策进入核对')
    const item = mixed.items[0]
    check(
      item.summary.matched === 1 && item.summary.conflict === 1 && item.summary.unknown === 1,
      `7b. 三态各 1 条（实际 ${JSON.stringify(item.summary)}）`,
    )
    check(item.overall === 'some_conditions_conflict', '7c. 有不符项时 overall 为 some_conditions_conflict')
    check(item.manualReviewRequired === true, '7d. 存在无法判定 → manualReviewRequired')
    check(item.evidenceLevel === 'E2', '7e. 证据分级为 E2（确定性比对，不标 E3）')
    check(item.conditionsRecorded === true, '7f. conditionsRecorded 为真')

    // 依据可追溯：原文一字不改
    const byLabel = new Map(item.conditions.map((c) => [c.label, c]))
    const srcOk = inputRules.every((r) => byLabel.get(r.label)?.sourceText === r.sourceText)
    check(srcOk, '7g. 每条判定原样带回入库的政策原文摘录（一字不改）')

    const unknownCond = item.conditions.find((c) => c.result === 'unknown')!
    check(unknownCond.reasonCode === 'ANSWER_MISSING' && unknownCond.reason.includes('人工核对'), '7h. 无法判定条目明说需人工核对')

    // 来源标识齐全（§10）
    const s = item.source
    check(
      s.sourceOrgId === orgA && s.sourceName.length > 0 && s.externalId === `人社〔2026〕14 号_${suffix}` &&
        s.sourceUrl === 'https://example.gov.cn/policy/1' && typeof s.syncTime === 'string' &&
        s.reviewStatus === 'approved' && s.publishStatus === 'published',
      '7i. 来源六要素齐全（org/externalId/name/url/syncTime/review/publish）',
    )

    // 全部相符时也不得出现结论式表述
    const allMatched = await eligibility.checkEligibility({
      policyIds: [post.id],
      answers: {
        household_social: 'local_household',
        unemployment_registration: 'registered',
        prior_subsidy: 'never_received',
      },
    })
    const allItem = allMatched.items[0]
    check(allItem.overall === 'all_recorded_conditions_matched', '7j. 全相符时 overall = all_recorded_conditions_matched')
    check(allItem.manualReviewRequired === false, '7k. 全相符且无未知 → 不强制人工核对')

    const FORBIDDEN = ['符合申领资格', '符合资格', '资格认定通过', '可以领取', '一定能办', '审核通过']
    const wholeText = JSON.stringify(allMatched)
    const hit = FORBIDDEN.filter((w) => wholeText.includes(w))
    check(hit.length === 0, `7l. 响应不含结论式表述${hit.length ? `（命中: ${hit.join(',')}）` : ''}`)
    check(
      allMatched.disclaimer.includes('不是资格认定') && allMatched.disclaimer.includes('不代办'),
      '7m. 免责口径写明「不是资格认定 / 不代办」',
    )
    check(allMatched.method === 'deterministic_comparison', '7n. method 标明确定性比对')
    check(!wholeText.includes('AI 判断') && !wholeText.includes('AI判断') && !wholeText.includes('E3'), '7o. 响应不出现 E3 / 「AI 判断」')

    // 没录条件的政策：诚实说「未录入」，不给结论
    const bare = await policies.createPartnerPolicy(
      { kind: 'policy_guide', title: `无条件条目_${suffix}`, audience: 'graduate' },
      partnerA,
    )
    await policies.reviewPolicy(bare.id, 'approve', undefined, admin)
    await policies.publishPolicy(bare.id, 'publish', admin)
    const bareRes = await eligibility.checkEligibility({ policyIds: [bare.id], answers: { household_social: 'local_household' } })
    const bareItem = bareRes.items[0]
    check(bareItem.overall === 'no_recorded_conditions' && bareItem.conditionsRecorded === false, '7p. 未录条件 → no_recorded_conditions')
    check(bareItem.manualReviewRequired === true && bareItem.overallLabel.includes('人工核对'), '7q. 未录条件明说需人工核对，不给结论')

    // 一项都没答：所有条件 unknown，绝不出现 conflict
    const noAnswers = await eligibility.checkEligibility({ policyIds: [post.id], answers: {} })
    const noAnswerItem = noAnswers.items[0]
    check(
      noAnswerItem.summary.unknown === 3 && noAnswerItem.summary.conflict === 0 && noAnswerItem.summary.matched === 0,
      '7r. 一项未答 → 3 条全 unknown，0 条 conflict',
    )
    check(noAnswers.answeredCount === 0, '7s. answeredCount 为 0')

    // 全选「不确定」等价于没答
    const allUnsure = await eligibility.checkEligibility({
      policyIds: [post.id],
      answers: {
        household_social: POLICY_ELIGIBILITY_UNSURE,
        unemployment_registration: POLICY_ELIGIBILITY_UNSURE,
        prior_subsidy: POLICY_ELIGIBILITY_UNSURE,
      },
    })
    check(allUnsure.items[0].summary.unknown === 3, '7t. 全选「不确定」→ 全 unknown')
    check(allUnsure.answeredCount === 0, '7u. 「不确定」不计入 answeredCount')

    // ── 7v. 库里 clauses 损坏时必须落 unknown，绝不落 matched ────────────────
    // 'all' 模式下空 clauses 会被合取判成 matched —— 那是「零条件即全部满足」，
    // 是本能力最危险的一种错法。写入校验拦不住已损坏的存量行，故在读侧兜底。
    {
      const corrupt = await policies.createPartnerPolicy(
        { kind: 'policy_guide', title: `损坏条件_${suffix}`, audience: 'graduate' },
        partnerA,
      )
      await prisma.policyEligibilityRule.create({
        data: {
          policyPostId: corrupt.id,
          orderIndex: 0,
          label: '损坏的条件',
          sourceText: '原文摘录在，但 clauses 已损坏。',
          matchMode: 'all',
          clauses: '{ not valid json',
        },
      })
      await policies.reviewPolicy(corrupt.id, 'approve', undefined, admin)
      await policies.publishPolicy(corrupt.id, 'publish', admin)
      const res = await eligibility.checkEligibility({
        policyIds: [corrupt.id],
        answers: { household_social: 'local_household' },
      })
      const c = res.items[0].conditions[0]
      check(c.result === 'unknown', `7v. clauses 损坏 → unknown（实际 ${c.result}）`)
      check(res.items[0].summary.matched === 0, '7w. clauses 损坏绝不产出 matched')

      const emptyPolicy = await policies.createPartnerPolicy(
        { kind: 'policy_guide', title: `空条件_${suffix}`, audience: 'graduate' },
        partnerA,
      )
      await prisma.policyEligibilityRule.create({
        data: {
          policyPostId: emptyPolicy.id,
          orderIndex: 0,
          label: '空 clauses',
          sourceText: '原文摘录在，但 clauses 是空数组。',
          matchMode: 'all',
          clauses: '[]',
        },
      })
      await policies.reviewPolicy(emptyPolicy.id, 'approve', undefined, admin)
      await policies.publishPolicy(emptyPolicy.id, 'publish', admin)
      const emptyRes = await eligibility.checkEligibility({
        policyIds: [emptyPolicy.id],
        answers: { household_social: 'local_household' },
      })
      check(emptyRes.items[0].conditions[0].result === 'unknown', '7x. 空 clauses → unknown（不是「零条件即满足」）')
    }

    // ── 8. 隐私：核对全程零落库 ─────────────────────────────────────────────
    {
      const auditBefore = await prisma.auditLog.count()
      const ruleBefore = await prisma.policyEligibilityRule.count()
      await eligibility.checkEligibility({
        policyIds: [post.id],
        answers: { household_social: 'local_household', unemployment_registration: 'registered' },
      })
      const auditAfter = await prisma.auditLog.count()
      const ruleAfter = await prisma.policyEligibilityRule.count()
      check(auditAfter === auditBefore, '8a. 核对不写 AuditLog（作答不留档）')
      check(ruleAfter === ruleBefore, '8b. 核对不写任何条件行')

      // 静态守卫：service 的核对路径不得出现写操作
      const svcSrc = readFileSync(join(__dirname, '../src/policies/policy-eligibility.service.ts'), 'utf-8')
      const checkBody = svcSrc.slice(
        svcSrc.indexOf('async checkEligibility'),
        svcSrc.indexOf('// ── 3. 条件读写'),
      )
      check(checkBody.length > 0, '8c. 定位到 checkEligibility 方法体')
      const writeOps = ['.create(', '.createMany(', '.update(', '.updateMany(', '.upsert(', '.delete(', 'audit.write(']
      const writeHit = writeOps.filter((op) => checkBody.includes(op))
      check(writeHit.length === 0, `8d. 核对路径无任何写操作${writeHit.length ? `（命中: ${writeHit.join(',')}）` : ''}`)
      // 日志只打计数，不打作答
      check(checkBody.includes('policies=${') && !checkBody.includes('JSON.stringify(answers'), '8e. 日志只打条数，不打作答内容')
    }

    // ── 9. Admin 只读复核 ─────────────────────────────────────────────────
    {
      const adminRules = await eligibility.getAdminRules(post.id)
      check(adminRules.length === 3 && adminRules[0].sourceText.length > 0, '9a. Admin 可只读复核条件与原文摘录')
      await expectCode(() => eligibility.getAdminRules(`missing_${suffix}`), 'POLICY_NOT_FOUND', '9b. 不存在政策 → POLICY_NOT_FOUND')
    }

    // ── 10. DTO 白名单层 ──────────────────────────────────────────────────
    {
      const ok = plainToInstance(PolicyEligibilityCheckDto, { answers: { household_social: 'local_household' } })
      check((await validate(ok)).length === 0, '10a. DTO 接受合法作答')
      const bad = plainToInstance(PolicyEligibilityCheckDto, { answers: 'not-an-object' })
      check((await validate(bad)).some((e) => e.property === 'answers'), '10b. DTO 拒绝非对象 answers')
      const tooMany = plainToInstance(PolicyEligibilityCheckDto, { policyIds: Array.from({ length: 51 }, (_, i) => `p${i}`) })
      check((await validate(tooMany)).some((e) => e.property === 'policyIds'), '10c. DTO 拒绝超过 50 条 policyIds')
    }
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

  // ── 11. 静态守卫：政策模块不得引入 LLM / AI 日志 ─────────────────────────
  {
    const dir = join(__dirname, '../src/policies')
    const files: string[] = []
    const walk = (d: string) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, entry.name)
        if (entry.isDirectory()) walk(p)
        else if (entry.name.endsWith('.ts')) files.push(p)
      }
    }
    walk(dir)
    const banned = ['LlmConfigService', 'AiLogService', 'llm-config.service', 'ai-log.service', 'chatCompletion', 'llmProvider']
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf-8')
      for (const b of banned) if (src.includes(b)) offenders.push(`${f}:${b}`)
    }
    check(offenders.length === 0, `11a. policies 模块无 LLM / AI 日志依赖${offenders.length ? `（${offenders.join(', ')}）` : ''}`)

    // 引擎必须是纯的：不引 Nest / Prisma
    const engineSrc = readFileSync(join(dir, 'policy-eligibility.engine.ts'), 'utf-8')
    check(
      !engineSrc.includes("@nestjs/") && !engineSrc.includes('PrismaService') && !engineSrc.includes('process.env'),
      '11b. 判定引擎不引 Nest / Prisma / env（纯确定性）',
    )
  }

  // ── 12. 两份 schema 与迁移成对 ──────────────────────────────────────────
  {
    const sqliteSchema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf-8')
    const pgSchema = readFileSync(join(__dirname, '../prisma/postgres/schema.prisma'), 'utf-8')
    check(
      sqliteSchema.includes('model PolicyEligibilityRule') && pgSchema.includes('model PolicyEligibilityRule'),
      '12a. 两份 schema 都有 PolicyEligibilityRule',
    )
    const sqliteModels = (sqliteSchema.match(/^model /gm) ?? []).length
    const pgModels = (pgSchema.match(/^model /gm) ?? []).length
    check(sqliteModels === pgModels, `12b. 两份 schema 模型数一致（各 ${sqliteModels}）`)

    const migName = '20260816180000_policy_eligibility_rules'
    const sqliteMig = readFileSync(join(__dirname, `../prisma/migrations/${migName}/migration.sql`), 'utf-8')
    const pgMig = readFileSync(join(__dirname, `../prisma/postgres/migrations/${migName}/migration.sql`), 'utf-8')
    check(
      sqliteMig.includes('CREATE TABLE "PolicyEligibilityRule"') && pgMig.includes('CREATE TABLE "PolicyEligibilityRule"'),
      '12c. 两侧迁移成对存在',
    )
    check(
      sqliteMig.includes('ADD COLUMN "externalId"') && pgMig.includes('ADD COLUMN "externalId"'),
      '12d. 两侧迁移都补 PolicyPost.externalId',
    )
  }

  console.log(`\n=== P21 政策条件核对验证通过：${passed} PASS ===\n`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
