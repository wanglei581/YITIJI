// ============================================================
// AiConfigController — 管理员后台「AI 大模型配置」端点
//
// GET  /api/v1/admin/ai-config        读取功能级配置（apiKey 只回 configured 布尔）
// PUT  /api/v1/admin/ai-config        更新指定功能配置（可含 apiKey 明文，加密落盘）
// POST /api/v1/admin/ai-config/test   指定功能连通性测试，返回样例回复或错误
//
// 合规：apiKey 绝不回显；仅服务端保存。
//
// 审计（2026-09-02 补齐）：所有配置写操作都落 AuditLog。
//   在此之前，换厂商 / 换模型 / **换 apiKey** / 关停某个 AI 能力全部无痕 ——
//   岗位审核、机构管理、打印扫描都写审计，AI 密钥与开关反而是空白。
//   审计写在 controller 层：actor 只有请求上下文知道，而 LlmConfigService 是
//   零依赖纯配置存储（四个 verify 脚本直接 `new LlmConfigService()`），
//   不能往它构造函数里塞 provider。写法对齐 admin-toolbox.controller.ts
//   的 toolbox_config.update。
// ============================================================

import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../../common/decorators/current-user.decorator'
import { AuditService } from '../../audit/audit.service'
import { resolveClientIp } from '../../common/client-ip'
import { LlmConfigService, type AiModelFeatureKey, type LlmConfigView } from './llm-config.service'
import { LlmChatService } from './llm-chat.service'
import { LLM_PRESETS, isLlmVendor } from './llm-presets'
import { buildAiConfigAuditPayload, didToggleEnabled } from './ai-config-audit'
import { PaidAiThrottle } from '../../common/throttler/terminal-throttle'
import { assertPublicLlmBaseUrl } from './llm-base-url'

/**
 * 审计动作名。
 *
 * 刻意与 toolbox_app.* 一样以裸字符串登场：AuditService.write 的 action 是
 * `AuditAction | string`，而把新动作写进枚举要同时改 services/api/src/audit/audit.types.ts
 * 与 packages/shared/src/types/audit.ts（两份手抄副本由 verify:backend-p0-contracts
 * 逐字比对），不在本次改动的文件预算内。
 * 未登记的后果只有一个：Admin 审计页 ACTION_LABELS 没有中文标签，
 * 会原样显示动作名（该页 `ACTION_LABELS[r.action] ?? r.action` 已有回退），
 * **不影响记录、查询与筛选**。登记为后续项。
 */
const AI_CONFIG_UPDATE_ACTION = 'ai_model_config.update'
/** 启停某个 AI 能力：额外落一条可单独按 action 筛出来的记录（见 applyAiConfigUpdate）。 */
const AI_CONFIG_TOGGLE_ACTION = 'ai_model_config.toggle'
const AI_CONFIG_TARGET_TYPE = 'ai_model_config'

interface AuditReq {
  headers: Record<string, string | string[] | undefined>
  requestId?: string
  ip?: string
  socket?: { remoteAddress?: string }
}

function uaOf(req: AuditReq): string | null {
  const ua = req.headers['user-agent']
  if (typeof ua === 'string') return ua.slice(0, 256)
  if (Array.isArray(ua) && ua[0]) return ua[0].slice(0, 256)
  return null
}

interface UpdateAiConfigDto {
  feature?:      string
  vendor?:       string
  model?:        string
  baseURL?:      string
  systemPrompt?: string
  roleScope?:    string
  forbiddenWords?: string[]
  temperature?:  number
  enabled?:      boolean
  apiKey?:       string
}

interface TestAiConfigDto {
  feature?: string
}

/** 请求体 → service patch。两个 controller 共用，避免两份不同步的白名单。 */
function toConfigPatch(body: UpdateAiConfigDto): Parameters<LlmConfigService['update']>[0] {
  const patch: Parameters<LlmConfigService['update']>[0] = {}
  if (body.vendor !== undefined && isLlmVendor(body.vendor)) patch.vendor = body.vendor
  if (body.model !== undefined)        patch.model = body.model
  if (body.baseURL !== undefined)      patch.baseURL = body.baseURL
  if (body.systemPrompt !== undefined) patch.systemPrompt = body.systemPrompt
  if (body.roleScope !== undefined)    patch.roleScope = body.roleScope
  if (Array.isArray(body.forbiddenWords)) patch.forbiddenWords = body.forbiddenWords
  if (typeof body.temperature === 'number') patch.temperature = body.temperature
  if (typeof body.enabled === 'boolean')    patch.enabled = body.enabled
  if (body.apiKey !== undefined)       patch.apiKey = body.apiKey
  if (patch.baseURL !== undefined) assertPublicLlmBaseUrl(patch.baseURL)
  return patch
}

/**
 * 执行配置更新并落审计。
 *
 * 顺序刻意是「先快照 → 再改 → 再快照 → 后写审计」：
 *   - 前后快照都已脱敏（不含密钥物料、不含提示词全文），见 ai-config-audit.ts；
 *   - 密钥动作必须在 update() **之前**判定，否则现值已被覆盖，分不出首配 / 轮换；
 *   - 审计在业务动作成功之后写（AuditService 的调用方约定），写失败只 log 不抛。
 *
 * 无论是否真的改动了字段都落一条 update 记录（changedFields 可能为空数组）：
 * 「谁在什么时候动过 AI 配置页」本身就是要留痕的事实，而不是只在有 diff 时才记。
 * 若 enabled 发生翻转，再额外落一条 toggle 记录 —— 关停一个 AI 能力是独立的
 * 安全事件，运营/安全同学应该只用 action 就能筛出来，不必去 grep payload JSON。
 */
async function applyAiConfigUpdate(
  deps: { config: LlmConfigService; audit: AuditService },
  feature: AiModelFeatureKey,
  body: UpdateAiConfigDto,
  user: AuthedUser,
  req: AuditReq,
): Promise<LlmConfigView> {
  const patch = toConfigPatch(body)
  const before = deps.config.getAuditSnapshot(feature)
  const apiKeyAction = deps.config.describeApiKeyChange(feature, patch.apiKey)

  const view = deps.config.update(patch, feature)

  const after = deps.config.getAuditSnapshot(feature)
  const context = {
    actorId: user.userId,
    actorRole: user.role,
    targetType: AI_CONFIG_TARGET_TYPE,
    targetId: feature,
    ipAddress: resolveClientIp(req),
    userAgent: uaOf(req),
    requestId: req.requestId ?? null,
  }
  await deps.audit.write({
    ...context,
    action: AI_CONFIG_UPDATE_ACTION,
    payload: buildAiConfigAuditPayload(feature, before, after, apiKeyAction),
  })
  if (didToggleEnabled(before, after)) {
    await deps.audit.write({
      ...context,
      action: AI_CONFIG_TOGGLE_ACTION,
      payload: { feature, from: before.enabled, to: after.enabled },
    })
  }
  return view
}

@Controller('admin/ai-config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AiConfigController {
  constructor(
    private readonly config: LlmConfigService,
    private readonly chat: LlmChatService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  get() {
    return {
      config:   this.config.getView('assistant_chat'),
      configs:  this.config.getViews(),
      features: this.config.getFeatures(),
      presets:  Object.values(LLM_PRESETS),
    }
  }

  @Put()
  async update(
    @Body() body: UpdateAiConfigDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ): Promise<LlmConfigView> {
    // 旧接口兼容：未带 feature → assistant_chat；带了非法 feature → 400（不静默回落）。
    const feature = body.feature === undefined ? 'assistant_chat' : this.config.assertValidFeatureKey(body.feature)
    return await applyAiConfigUpdate({ config: this.config, audit: this.audit }, feature, body, user, req)
  }
  @PaidAiThrottle(4)

  @Post('test')
  async test(@Body() body: TestAiConfigDto) {
    const feature = body.feature === undefined ? 'assistant_chat' : this.config.assertValidFeatureKey(body.feature)
    assertPublicLlmBaseUrl(this.config.getConfig(feature).baseURL)
    return this.chat.test(feature)
  }
}

@Controller('admin/ai-configs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AiConfigsController {
  constructor(
    private readonly config: LlmConfigService,
    private readonly chat: LlmChatService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  getAll() {
    return {
      config:   this.config.getView('assistant_chat'),
      configs:  this.config.getViews(),
      features: this.config.getFeatures(),
      presets:  Object.values(LLM_PRESETS),
    }
  }

  @Get(':featureKey')
  getOne(@Param('featureKey') featureKey: string) {
    return {
      config: this.config.getView(this.config.assertValidFeatureKey(featureKey)),
      presets: Object.values(LLM_PRESETS),
    }
  }

  @Put(':featureKey')
  async updateOne(
    @Param('featureKey') featureKey: string,
    @Body() body: UpdateAiConfigDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ): Promise<LlmConfigView> {
    const feature = this.config.assertValidFeatureKey(featureKey)
    return await applyAiConfigUpdate({ config: this.config, audit: this.audit }, feature, body, user, req)
  }
  @PaidAiThrottle(4)

  @Post(':featureKey/test')
  async testOne(@Param('featureKey') featureKey: string) {
    const feature = this.config.assertValidFeatureKey(featureKey)
    assertPublicLlmBaseUrl(this.config.getConfig(feature).baseURL)
    return this.chat.test(feature)
  }
}
