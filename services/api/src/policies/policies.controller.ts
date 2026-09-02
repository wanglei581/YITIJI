import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { PoliciesService } from './policies.service'
import { PolicyEligibilityService } from './policy-eligibility.service'
import {
  CreatePolicyPostDto,
  PolicyEligibilityCheckDto,
  PolicyEligibilityPreviewDto,
  ReplacePolicyEligibilityRulesDto,
  UpdatePolicyPostDto,
} from './dto/policy.dto'
import { POLICY_RULE_MANUAL_MODE, type PolicyRuleMatchMode } from './policy-eligibility.types'
import { ReviewActionDto } from '../jobs/dto/review.dto'
import { PublishActionDto } from '../jobs/dto/publish.dto'

/**
 * 政策服务(阶段1D)。
 *
 * 路由表(全部含 /api/v1 前缀):
 *   Kiosk(公开,只读 approved+published):
 *     GET    /policies?kind=&audience=&category=
 *     GET    /policies/eligibility-questions      条件核对问项字典(P21)
 *     POST   /policies/eligibility-check          条件核对(P21,纯计算不落库)
 *   Partner(Bearer + partner,本机构):
 *     GET    /partner/policies
 *     POST   /partner/policies                    新增(默认 pending+draft)
 *     PATCH  /partner/policies/:id                编辑(强制回 pending+draft 重审)
 *     GET    /partner/policies/:id/eligibility-rules
 *     PUT    /partner/policies/:id/eligibility-rules  整组替换(强制回 pending+draft)
 *     POST   /partner/policies/:id/eligibility-preview 录入面试算(与公开核对同一判定路径)
 *     PATCH  /partner/policies/:id/publish        下架(unpublish)
 *     DELETE /partner/policies/:id                删除(留审计)
 *   Admin(Bearer + admin):
 *     GET    /admin/policy-sources                全量(含审核/发布状态)
 *     GET    /admin/policy-sources/:id/eligibility-rules  只读复核
 *     PATCH  /admin/policy-sources/:id/review     审核(approve/reject/reviewing)
 *     PATCH  /admin/policy-sources/:id/publish    发布/下架
 *
 * 合规:info-only;政策内容只做说明 + 官方入口,不承诺补贴到账、不代申请。
 * P21 条件核对是**参考**不是裁定:只给出「已录入条件的比对结果」,
 * 不出现「您符合申领资格」这类结论式表述;判定依据必须追回入库的政策原文摘录。
 */
@Controller()
export class PoliciesController {
  constructor(
    private readonly policies: PoliciesService,
    private readonly eligibility: PolicyEligibilityService,
  ) {}

  // ── Kiosk(公开)──────────────────────────────────────────────────────────

  @Get('policies')
  getPolicies(
    @Query('kind') kind?: string,
    @Query('audience') audience?: string,
    @Query('category') category?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.policies.getPublishedPolicies({ kind, audience, category, page, pageSize })
  }

  /**
   * P21 问项字典。前端不得自己硬编码问项与取值 —— 取值一旦漂移,
   * 已录入的政策条件会静默失配,判定结果全变「无法判定」而没人发现。
   *
   * 路由注册在 `policies/:id` 之类的通配路由之前不存在冲突问题:
   * 本控制器没有 `GET /policies/:id`。
   */
  @Get('policies/eligibility-questions')
  getEligibilityQuestions() {
    return this.eligibility.getQuestions()
  }

  /**
   * P21 条件核对。免登录(与 GET /policies 同口径,一体机主要是匿名使用)。
   *
   * 作答**不落库、不进审计、不进日志**,见 PolicyEligibilityService 的隐私口径。
   * 用 POST 而非 GET:作答含户籍/参保/失业登记等个人信息,
   * 不得出现在 URL query 里(会进网关与访问日志)。
   */
  @Post('policies/eligibility-check')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  checkEligibility(@Body() dto: PolicyEligibilityCheckDto) {
    return this.eligibility.checkEligibility({ answers: dto.answers, policyIds: dto.policyIds })
  }

  /**
   * 政策详情。此前只有列表端点，详情页一直是 404。
   *
   * **这个装饰器的位置是有意义的**：必须排在 policies/eligibility-questions 与
   * policies/eligibility-check 之后。Nest 按声明顺序匹配，放前面会把
   * `policies/eligibility-questions` 当成 `:id` 吃掉。
   *
   * 与 job-fairs/:id 同口径：查不到返回 data:null 而不是抛 404，
   * 前端据此落空态。不区分「不存在」与「未发布」——区分了就泄露未发布政策的存在性。
   */
  @Get('policies/:id')
  getPolicyById(@Param('id') id: string) {
    return this.policies.getPublishedPolicyById(id)
  }

  // ── Partner ─────────────────────────────────────────────────────────────────

  @Get('partner/policies')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  getPartnerPolicies(@CurrentUser() user: AuthedUser) {
    return this.policies.getPartnerPolicies(user)
  }

  @Post('partner/policies')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  createPartnerPolicy(@Body() dto: CreatePolicyPostDto, @CurrentUser() user: AuthedUser) {
    return this.policies.createPartnerPolicy(dto, user)
  }

  @Patch('partner/policies/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  updatePartnerPolicy(@Param('id') id: string, @Body() dto: UpdatePolicyPostDto, @CurrentUser() user: AuthedUser) {
    return this.policies.updatePartnerPolicy(id, dto, user)
  }

  @Get('partner/policies/:id/eligibility-rules')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  getPartnerEligibilityRules(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return this.eligibility.getPartnerRules(id, user)
  }

  /** 整组替换申领条件。与编辑正文同口径:替换后强制回 pending+draft 重审。 */
  @Put('partner/policies/:id/eligibility-rules')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  replacePartnerEligibilityRules(
    @Param('id') id: string,
    @Body() dto: ReplacePolicyEligibilityRulesDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.eligibility.replacePartnerRules(
      id,
      dto.rules.map((r) => {
        const matchMode = (['all', 'any', POLICY_RULE_MANUAL_MODE].includes(r.matchMode)
          ? r.matchMode
          : 'all') as PolicyRuleMatchMode
        return {
          label: r.label,
          sourceText: r.sourceText,
          matchMode,
          // 「只能人工核对」一律丢弃子句：写入校验会拒非空子句，
          // 这里不做静默清洗，把非法输入原样送进校验，让机构看到明确报错。
          clauses: (r.clauses ?? []).map((c) => ({
            questionKey: c.questionKey,
            satisfiedValues: c.satisfiedValues,
            conflictValues: c.conflictValues ?? [],
          })),
        }
      }),
      user,
    )
  }

  /**
   * 录入面「试算」：拿一组假想作答，预览这条政策会被判成什么。
   *
   * 与公开 POST /policies/eligibility-check 走**同一条**判定路径
   * （PolicyEligibilityService.evaluateRow），差别只在取数门槛：
   * 这里按机构取本机构政策、不要求已审已发（草稿状态下正要试算）。
   *
   * 假想作答同样不落库、不进审计（与公开核对同口径）。
   */
  @Post('partner/policies/:id/eligibility-preview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  previewPartnerEligibility(
    @Param('id') id: string,
    @Body() dto: PolicyEligibilityPreviewDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.eligibility.previewPartnerRules(id, { answers: dto.answers }, user)
  }

  @Patch('partner/policies/:id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  unpublishPartnerPolicy(@Param('id') id: string, @Body() _dto: PublishActionDto, @CurrentUser() user: AuthedUser) {
    return this.policies.unpublishPartnerPolicy(id, user)
  }

  @Delete('partner/policies/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  deletePartnerPolicy(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return this.policies.deletePartnerPolicy(id, user)
  }

  // ── Admin ───────────────────────────────────────────────────────────────────

  @Get('admin/policy-sources')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getPolicySources() {
    return this.policies.getAllPolicySources()
  }

  /** Admin 只读复核已录入的申领条件(审核前要能看到条件与原文摘录)。 */
  @Get('admin/policy-sources/:id/eligibility-rules')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getAdminEligibilityRules(@Param('id') id: string) {
    return this.eligibility.getAdminRules(id)
  }

  @Patch('admin/policy-sources/:id/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  reviewPolicy(@Param('id') id: string, @Body() dto: ReviewActionDto, @CurrentUser() user: AuthedUser) {
    return this.policies.reviewPolicy(id, dto.action, dto.reason, user)
  }

  @Patch('admin/policy-sources/:id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  publishPolicy(@Param('id') id: string, @Body() dto: PublishActionDto, @CurrentUser() user: AuthedUser) {
    return this.policies.publishPolicy(id, dto.action, user)
  }
}
