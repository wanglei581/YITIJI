import { BadRequestException, ForbiddenException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { AuditService } from '../audit/audit.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { readClientDeclaration } from '../common/privacy/client-declaration'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../common/redis/redis.service'
import { aiPlatformBlockFor } from '../config/ai-platform-config'
import { AiBudgetService } from '../ai/usage/ai-budget.service'

export type AiLoginGate = 'off' | 'before_export' | 'before_generate'
export interface AiAccessConfig { loginGate: AiLoginGate; declarationEnforced: boolean; paused: boolean; maintenance: boolean }
export interface AccessRequest { headers?: Record<string, string | string[] | undefined> }
const KEYS = { loginGate: 'system:ai-access:loginGate', declaration: 'system:ai-access:declarationEnforced', paused: 'system:ai-access:paused', maintenance: 'system:ai-access:maintenance' } as const
const ON = new Set(['1', 'true', 'yes', 'on'])
const envBool = (name: string) => ON.has((process.env[name] ?? '').trim().toLowerCase())
const envGate = (): AiLoginGate => {
  const value = (process.env.AI_LOGIN_GATE ?? 'off').trim().toLowerCase()
  return value === 'before_export' || value === 'before_generate' ? value : 'off'
}

@Injectable()
export class AiAccessService {
  private readonly logger = new Logger(AiAccessService.name)
  private cache: { value: AiAccessConfig; expiresAt: number } | null = null
  // budget 在生产由 Nest 注入（未标 @Optional，缺了启动即报错）；形参可省只为兼容门禁里按旧签名手动构造。
  constructor(private readonly redis: RedisService, private readonly audit: AuditService, private readonly jwt: JwtService, private readonly prisma: PrismaService, private readonly budget?: AiBudgetService) {}

  async getConfig(): Promise<AiAccessConfig> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.value
    const fallback = { loginGate: envGate(), declarationEnforced: envBool('AI_DECLARATION_ENFORCEMENT'), paused: envBool('AI_PAUSED'), maintenance: envBool('MAINTENANCE_MODE') }
    try {
      const values = await Promise.all(Object.values(KEYS).map((key) => this.redis.get(key)))
      const value: AiAccessConfig = {
        // 后台显式切到 off 也要认（此前只认两档，off 会被当成没设置、回落到环境变量）
        loginGate: values[0] === 'off' || values[0] === 'before_export' || values[0] === 'before_generate' ? values[0] : fallback.loginGate,
        declarationEnforced: values[1] == null ? fallback.declarationEnforced : values[1] === 'on',
        paused: values[2] == null ? fallback.paused : values[2] === 'on',
        maintenance: values[3] == null ? fallback.maintenance : values[3] === 'on',
      }
      this.cache = { value, expiresAt: Date.now() + 30_000 }
      return value
    } catch (error) {
      this.logger.warn(`AI access config Redis read failed; using environment defaults: ${(error as Error).message}`)
      this.cache = { value: fallback, expiresAt: Date.now() + 30_000 }
      return fallback
    }
  }

  clearCache(): void { this.cache = null }

  async update(patch: Partial<AiAccessConfig>, actorId: string, reason: string, ipAddress?: string | null): Promise<AiAccessConfig> {
    if (!reason?.trim()) throw new BadRequestException({ error: { code: 'REASON_REQUIRED', message: '请填写切换事由' } })
    const before = await this.getConfig()
    const after: AiAccessConfig = { ...before, ...patch }
    await this.prisma.$transaction(async (tx) => {
      await this.audit.writeRequired(tx, { actorId, actorRole: 'admin', action: 'ai.access_switch_changed', targetType: 'system', targetId: 'ai-access', payload: { before, after, reason: reason.trim().slice(0, 200) }, ipAddress })
    })
    const entries: Array<[string, string]> = []
    if (patch.loginGate) entries.push([KEYS.loginGate, patch.loginGate])
    if (patch.declarationEnforced !== undefined) entries.push([KEYS.declaration, patch.declarationEnforced ? 'on' : 'off'])
    if (patch.paused !== undefined) entries.push([KEYS.paused, patch.paused ? 'on' : 'off'])
    if (patch.maintenance !== undefined) entries.push([KEYS.maintenance, patch.maintenance ? 'on' : 'off'])
    try {
      await Promise.all(entries.map(([key, value]) => this.redis.setEx(key, 60 * 60 * 24 * 365, value)))
    } catch (error) {
      // 审计已写「要切换」，Redis 没写进去：补一条失败记录，免得台账与线上状态对不上
      await this.audit.write({ actorId, actorRole: 'admin', action: 'ai.access_switch_failed', targetType: 'system', targetId: 'ai-access', payload: { attempted: after, reason: 'redis_write_failed' }, ipAddress })
      throw error
    } finally { this.clearCache() }
    return this.getConfig()
  }

  async enforce(kind: import('./ai-access.decorator').AiUseKind | undefined, maintenanceBlocked: boolean, req: AccessRequest, config?: AiAccessConfig): Promise<void> {
    if (!kind && !maintenanceBlocked) return
    const current = config ?? await this.getConfig()
    if (current.maintenance && (maintenanceBlocked || (kind && kind !== 'read'))) throw new ServiceUnavailableException({ error: { code: 'MAINTENANCE_MODE', message: '设备维护中，请稍后再来' } })
    if (!kind || kind === 'read') return
    const notConfigured = aiPlatformBlockFor(kind); if (notConfigured) throw new ServiceUnavailableException({ error: notConfigured }) // F-11 生产缺 AI 配置：如实 503，绝不回退 mock
    if (current.paused) throw new ServiceUnavailableException({ error: { code: 'AI_PAUSED', message: 'AI 服务暂停中，打印扫描照常' } })
    // P1-2a 每日金额硬上限：与 AI 暂停同一层，只拦会花钱的生成 / 语音；导出不调模型，不拦。
    // 超限 503 AI_BUDGET_EXHAUSTED；读不到当日花费 503 AI_BUDGET_UNAVAILABLE（失败关闭）。
    if (kind === 'generate' || kind === 'voice') await this.budget?.assertWithinBudget()
    // 「开始 AI 前」是更严的一档，导出与打印同样要登录
    const needsLogin = (current.loginGate === 'before_generate' && (kind === 'generate' || kind === 'voice' || kind === 'export'))
      || (current.loginGate === 'before_export' && kind === 'export')
    const declaration = current.declarationEnforced && (kind === 'generate' || kind === 'voice')
    if (!needsLogin && !declaration) return
    const auth = req.headers?.authorization
    const rawAuth = Array.isArray(auth) ? auth[0] : auth
    const member = await resolveOptionalEndUser(rawAuth, this.jwt, this.redis, this.prisma)
    if (needsLogin && !member) throw new UnauthorizedException({ error: { code: 'AI_LOGIN_REQUIRED', message: '为了按规定核实使用者，AI 功能需要先用手机号登录' } })
    if (declaration) {
      const headers = readClientDeclaration(req.headers)
      const missing: string[] = []
      if (headers.age14.status !== 'declared' && !(member && await this.hasConsent(member.endUserId, 'age_14_plus'))) missing.push('age_14_plus')
      if (kind === 'voice' && headers.voiceRecording.status !== 'declared' && !(member && await this.hasConsent(member.endUserId, 'voice_recording'))) missing.push('voice_recording')
      // 全局错误过滤器只透传字符串数组 details，不透传 missing；两处都给，客户端读哪个都行（小程序窗口 9/29 报）。
      if (missing.length) throw new ForbiddenException({ error: { code: 'AI_DECLARATION_REQUIRED', missing, details: missing, message: '使用 AI 前请先完成必要声明' } })
    }
  }
  private async hasConsent(endUserId: string, scope: string): Promise<boolean> {
    const row = await this.prisma.userAiConsent.findFirst({ where: { endUserId, scope, revokedAt: null }, orderBy: { grantedAt: 'desc' } })
    return Boolean(row)
  }
}
