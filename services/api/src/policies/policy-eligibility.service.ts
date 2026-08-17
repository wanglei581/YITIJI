import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import {
  buildCheckResult,
  evaluatePolicy,
  sanitizeAnswers,
  validatePolicyEligibilityRules,
} from './policy-eligibility.engine'
import {
  POLICY_ELIGIBILITY_DISCLAIMER,
  POLICY_ELIGIBILITY_PRIVACY_NOTICE,
  POLICY_ELIGIBILITY_QUESTIONS,
  POLICY_ELIGIBILITY_QUESTION_SET_VERSION,
  POLICY_RULE_MANUAL_MODE,
  isManualRuleMode,
  type PolicyEligibilityCheckItem,
  type PolicyEligibilityCheckResult,
  type PolicyEligibilityClause,
  type PolicyEligibilityRuleInput,
  type PolicyEligibilityRuleRecord,
  type PolicyRuleMatchMode,
  type PolicySourceRef,
} from './policy-eligibility.types'

// ============================================================
// P21 政策条件核对（S3-2）—— 服务层
//
// 职责三件事：
//   1. 下发问项字典（前端不得自己硬编码问项与取值）。
//   2. 读写政策的结构化申领条件（Partner 录入 / Admin 只读复核）。
//   3. 按用户当次作答与已录入条件做确定性比对，返回三态结果。
//
// ── 隐私口径（红线）────────────────────────────────────────────────────────
// 用户填写的核对条件（户籍、参保、失业登记、毕业年份、年龄段…）属于个人信息。
// 本服务对作答**零持久化**：
//   - checkEligibility() 全程只读库（政策与条件），不写任何表；
//   - 不落 AuditLog —— 审计的目的是追踪对数据的处置，这里没有处置，
//     为审计而把用户答案写进日志表反而制造了一份新的敏感数据副本；
//   - 日志只打条数（政策数 / 已答项数），不打任何 key-value 作答；
//   - 未采纳的问项只回传**键名**，不回传取值。
// 因此「我的记录」里不会有这次核对 —— 这是取舍：为了不留档，放弃可回看历史。
// 若日后产品要求可回看，只允许存判定结果与时间，不得存原始条件值。
// ============================================================

interface PolicyRowForCheck {
  id: string
  title: string
  kind: string
  audience: string | null
  category: string | null
  sourceOrgId: string
  sourceName: string
  externalId: string | null
  externalUrl: string | null
  syncTime: Date
  reviewStatus: string
  publishStatus: string
  eligibilityRules: {
    id: string
    orderIndex: number
    label: string
    sourceText: string
    matchMode: string
    clauses: string
  }[]
}

/** 单次核对最多比对多少条政策（一体机一屏装不下更多，也防批量拉取）。 */
const MAX_POLICIES_PER_CHECK = 50

@Injectable()
export class PolicyEligibilityService {
  private readonly logger = new Logger(PolicyEligibilityService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── 1. 问项字典（公开）────────────────────────────────────────────────────

  getQuestions() {
    return {
      questionSetVersion: POLICY_ELIGIBILITY_QUESTION_SET_VERSION,
      questions: POLICY_ELIGIBILITY_QUESTIONS,
      privacyNotice: POLICY_ELIGIBILITY_PRIVACY_NOTICE,
      disclaimer: POLICY_ELIGIBILITY_DISCLAIMER,
    }
  }

  // ── 2. 条件核对（公开，纯计算，零落库）────────────────────────────────────

  async checkEligibility(input: {
    answers?: Record<string, unknown>
    policyIds?: string[]
  }): Promise<PolicyEligibilityCheckResult> {
    const { answers, ignoredQuestionKeys } = sanitizeAnswers(input.answers ?? {})

    const requestedIds = (input.policyIds ?? []).slice(0, MAX_POLICIES_PER_CHECK)
    const rows = (await this.prisma.policyPost.findMany({
      where: {
        // 只比对已审核通过且已发布的政策 —— 未过审内容不得进入核对面
        reviewStatus: 'approved',
        publishStatus: 'published',
        ...(requestedIds.length > 0
          ? { id: { in: requestedIds } }
          : // 未指定时只取「政策扶持条目」：notice 是公告，没有申领条件
            { kind: 'policy_guide' }),
      },
      orderBy: [{ publishedDate: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      take: MAX_POLICIES_PER_CHECK,
      include: { eligibilityRules: { orderBy: { orderIndex: 'asc' } } },
    })) as unknown as PolicyRowForCheck[]

    const items = rows.map((row) => this.evaluateRow(row, answers))

    // 只打条数，不打任何作答内容
    this.logger.log(
      `checkEligibility: policies=${items.length} answered=${
        Object.keys(answers).length
      } ignored=${ignoredQuestionKeys.length}`,
    )

    return buildCheckResult(items, answers, ignoredQuestionKeys, new Date())
  }

  /**
   * 录入面「试算」：拿一组假想作答，看这条政策会被判成什么。
   *
   * ⚠️ 这里**没有**第二套判定逻辑。preview 与 checkEligibility 都只经
   * `this.evaluateRow()` 这一条路（verify:policy-eligibility-authoring 的
   * 静态 + 运行时双重断言守着）。理由：录入面若自己在前端或服务端另算一遍，
   * 运营看到的「绿灯」和用户实际拿到的结论就可能不一致 —— 那比没有预览更糟。
   *
   * 与公开核对的唯一差别是**取数门槛**：预览按机构取本机构的政策，
   * 不要求 approved+published（草稿状态下正要试算），公开核对则只取
   * approved+published。判定本身一模一样。
   *
   * 隐私同口径：不写任何表、不落 AuditLog、日志不打作答。
   */
  async previewPartnerRules(
    policyId: string,
    input: { answers?: Record<string, unknown> },
    user: AuthedUser,
  ): Promise<PolicyEligibilityCheckResult> {
    const row = (await this.prisma.policyPost.findUnique({
      where: { id: policyId },
      include: { eligibilityRules: { orderBy: { orderIndex: 'asc' } } },
    })) as unknown as PolicyRowForCheck | null

    if (!row || !user.orgId || row.sourceOrgId !== user.orgId) {
      throw new NotFoundException({
        error: { code: 'POLICY_NOT_FOUND', message: `Policy ${policyId} not found` },
      })
    }

    const { answers, ignoredQuestionKeys } = sanitizeAnswers(input.answers ?? {})
    const item = this.evaluateRow(row, answers)

    this.logger.log(
      `previewPartnerRules: policy=1 rules=${item.summary.total} answered=${
        Object.keys(answers).length
      } ignored=${ignoredQuestionKeys.length}`,
    )

    return buildCheckResult([item], answers, ignoredQuestionKeys, new Date())
  }

  /**
   * 唯一的判定入口。公开核对与录入面预览都必须经这里 ——
   * 谁再写第二条判定路径，预览就不再等于真实判定。
   */
  private evaluateRow(
    row: PolicyRowForCheck,
    answers: Readonly<Record<string, string>>,
  ): PolicyEligibilityCheckItem {
    return evaluatePolicy(
      {
        id: row.id,
        title: row.title,
        kind: row.kind,
        audience: row.audience,
        category: row.category,
        source: this.toSourceRef(row),
      },
      row.eligibilityRules.map((r) => this.toRuleRecord(r)),
      answers,
    )
  }

  // ── 3. 条件读写 ───────────────────────────────────────────────────────────

  async getPartnerRules(policyId: string, user: AuthedUser): Promise<PolicyEligibilityRuleRecord[]> {
    const post = await this.prisma.policyPost.findUnique({ where: { id: policyId } })
    if (!post || !user.orgId || post.sourceOrgId !== user.orgId) {
      throw new NotFoundException({
        error: { code: 'POLICY_NOT_FOUND', message: `Policy ${policyId} not found` },
      })
    }
    return this.loadRules(policyId)
  }

  async getAdminRules(policyId: string): Promise<PolicyEligibilityRuleRecord[]> {
    const post = await this.prisma.policyPost.findUnique({ where: { id: policyId } })
    if (!post) {
      throw new NotFoundException({
        error: { code: 'POLICY_NOT_FOUND', message: `Policy ${policyId} not found` },
      })
    }
    return this.loadRules(policyId)
  }

  /**
   * 整组替换某条政策的申领条件。
   *
   * 替换后强制回 pending + draft 重审 —— 与 updatePartnerPolicy 同口径。
   * 理由：条件是政策对外口径的一部分，改条件等于改政策怎么被核对；
   * 若允许在 approved+published 状态下改条件，机构就能绕过审核改变判定结果。
   */
  async replacePartnerRules(
    policyId: string,
    rules: PolicyEligibilityRuleInput[],
    user: AuthedUser,
  ): Promise<PolicyEligibilityRuleRecord[]> {
    if (!user.orgId) {
      throw new BadRequestException({
        error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' },
      })
    }
    const post = await this.prisma.policyPost.findUnique({ where: { id: policyId } })
    if (!post || post.sourceOrgId !== user.orgId) {
      throw new NotFoundException({
        error: { code: 'POLICY_NOT_FOUND', message: `Policy ${policyId} not found` },
      })
    }

    const invalid = validatePolicyEligibilityRules(rules)
    if (invalid) {
      throw new BadRequestException({ error: invalid })
    }

    await this.prisma.$transaction([
      this.prisma.policyEligibilityRule.deleteMany({ where: { policyPostId: policyId } }),
      ...rules.map((rule, index) =>
        this.prisma.policyEligibilityRule.create({
          data: {
            policyPostId: policyId,
            orderIndex: index,
            label: rule.label.trim(),
            sourceText: rule.sourceText.trim(),
            matchMode: rule.matchMode,
            clauses: JSON.stringify(rule.clauses),
          },
        }),
      ),
      this.prisma.policyPost.update({
        where: { id: policyId },
        data: {
          reviewStatus: 'pending',
          publishStatus: 'draft',
          rejectReason: null,
          reviewedBy: null,
          reviewedAt: null,
          syncTime: new Date(),
        },
      }),
    ])

    await this.audit.write({
      actorId: user.userId,
      actorRole: 'partner',
      action: 'policy.eligibility_rules_replace',
      targetType: 'policy',
      targetId: policyId,
      // 只记条数与状态迁移，不记条件正文
      payload: {
        ruleCount: rules.length,
        fromReviewStatus: post.reviewStatus,
        fromPublishStatus: post.publishStatus,
      },
    })

    return this.loadRules(policyId)
  }

  // ── 内部 helpers ──────────────────────────────────────────────────────────

  private async loadRules(policyId: string): Promise<PolicyEligibilityRuleRecord[]> {
    const rows = await this.prisma.policyEligibilityRule.findMany({
      where: { policyPostId: policyId },
      orderBy: { orderIndex: 'asc' },
    })
    return rows.map((r) => this.toRuleRecord(r))
  }

  private toRuleRecord(row: {
    id: string
    orderIndex: number
    label: string
    sourceText: string
    matchMode: string
    clauses: string
  }): PolicyEligibilityRuleRecord {
    // 「只能人工核对」不解析子句：它本来就零子句，
    // 走 parseClauses 会拿到那个恒 unknown 的损坏哨兵，回给录入面反而看不懂。
    if (isManualRuleMode(row.matchMode)) {
      return {
        id: row.id,
        orderIndex: row.orderIndex,
        label: row.label,
        sourceText: row.sourceText,
        matchMode: POLICY_RULE_MANUAL_MODE,
        clauses: [],
      }
    }
    return {
      id: row.id,
      orderIndex: row.orderIndex,
      label: row.label,
      sourceText: row.sourceText,
      matchMode: (row.matchMode === 'any' ? 'any' : 'all') as PolicyRuleMatchMode,
      clauses: parseClauses(row.clauses),
    }
  }

  private toSourceRef(row: {
    sourceOrgId: string
    sourceName: string
    externalId: string | null
    externalUrl: string | null
    syncTime: Date
    reviewStatus: string
    publishStatus: string
  }): PolicySourceRef {
    return {
      sourceOrgId: row.sourceOrgId,
      sourceName: row.sourceName,
      externalId: row.externalId ?? null,
      sourceUrl: row.externalUrl ?? null,
      syncTime: row.syncTime.toISOString(),
      reviewStatus: row.reviewStatus,
      publishStatus: row.publishStatus,
    }
  }
}

/**
 * clauses 是库里的 JSON 文本。解析失败或结构不对时返回空数组 ——
 * 空 clauses 会被 evaluateRule 的 'all' 分支判成 matched，所以调用方
 * 绝不能拿空数组去判定：这里返回空数组的唯一后果是该条件产出一个
 * 恒 matched 的结论，那是错的。因此解析失败必须落到 unknown 一侧。
 * 实现方式：解析失败时塞一个引用了不存在问项的子句，
 * evaluateClause 找不到问项就一定判 unknown。
 */
function parseClauses(raw: string): PolicyEligibilityClause[] {
  const broken: PolicyEligibilityClause[] = [
    { questionKey: '__unparseable__', satisfiedValues: [], conflictValues: [] },
  ]
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.length === 0) return broken
    const clauses: PolicyEligibilityClause[] = []
    for (const entry of parsed) {
      const c = entry as Partial<PolicyEligibilityClause>
      if (typeof c?.questionKey !== 'string') return broken
      clauses.push({
        questionKey: c.questionKey,
        satisfiedValues: Array.isArray(c.satisfiedValues) ? c.satisfiedValues.filter((v) => typeof v === 'string') : [],
        conflictValues: Array.isArray(c.conflictValues) ? c.conflictValues.filter((v) => typeof v === 'string') : [],
      })
    }
    return clauses
  } catch {
    return broken
  }
}
