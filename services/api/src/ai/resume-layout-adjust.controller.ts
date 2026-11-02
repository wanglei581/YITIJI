import { Body, Controller, Optional, Param, Post, Req } from '@nestjs/common'
import { AiUse } from '../ai-access/ai-access.decorator'
import { PaidAiThrottle } from '../common/throttler/terminal-throttle'
import { JwtService } from '@nestjs/jwt'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { MemberPrivacyService } from '../member-privacy/member-privacy.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { resolveClientIp } from '../common/client-ip'
import { AiService, type AiResultRequester } from './ai.service'
import { ResumeLayoutAdjustDto } from './dto/resume-generate.dto'

interface ReqLike {
  requestId?: string
  headers: Record<string, string | string[] | undefined>
  ip?: string
  socket?: { remoteAddress?: string }
}

function ipOf(req: unknown): string | null {
  return resolveClientIp(req)
}

function uaOf(req: ReqLike): string | null {
  const ua = req.headers['user-agent']
  if (typeof ua === 'string') return ua.slice(0, 256)
  if (Array.isArray(ua) && ua[0]) return ua[0].slice(0, 256)
  return null
}

function authOf(req: ReqLike): string | undefined {
  const auth = req.headers.authorization
  if (typeof auth === 'string') return auth
  if (Array.isArray(auth)) return auth[0]
  return undefined
}

function resumeAccessTokenOf(req: ReqLike): string | null {
  const header = req.headers['x-resume-access-token']
  if (typeof header === 'string' && header.trim()) return header.trim()
  if (Array.isArray(header) && header[0]?.trim()) return header[0].trim()
  return null
}

/**
 * POST /api/v1/resume/records/:taskId/layout-adjust
 *
 * 从 AiController 拆出：那份文件已超过 800 行，不能再往里加授权检查。
 * 版式调整总会把简历原文送进模型，所以在调用 AiService 之前核 resume_ai。
 * 游客（endUserId 为空）由 requireActiveConsent 放行，与其它简历 AI 端点一致。
 */
@Controller()
export class ResumeLayoutAdjustController {
  constructor(
    private readonly aiService: AiService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    @Optional() private readonly privacy?: MemberPrivacyService,
  ) {}

  private async resolveAiResultRequester(req: ReqLike): Promise<AiResultRequester> {
    const member = await resolveOptionalEndUser(authOf(req), this.jwt, this.redis, this.prisma)
    if (member) return { endUserId: member.endUserId, accessToken: null }
    return { endUserId: null, accessToken: resumeAccessTokenOf(req) }
  }

  @Post('resume/records/:taskId/layout-adjust')
  @PaidAiThrottle(6)
  @AiUse('generate')
  async adjustResumeLayout(
    @Param('taskId') taskId: string,
    @Body() dto: ResumeLayoutAdjustDto,
    @Req() req: ReqLike,
  ) {
    const requester = await this.resolveAiResultRequester(req)
    if (this.privacy) await this.privacy.requireActiveConsent(requester.endUserId, 'resume_ai')
    const result = await this.aiService.adjustResumeLayout(taskId, dto.resume, dto.action, dto.layout, requester)
    await this.audit.write({
      actorId: null,
      actorRole: 'kiosk',
      action: 'resume.layout_adjusted',
      targetType: 'ai_task',
      targetId: taskId,
      payload: {
        action: dto.action,
        layout: dto.layout ? { columns: dto.layout.columns ?? 1, margin: dto.layout.margin ?? 'normal', fontScale: dto.layout.fontScale ?? 'standard', accent: dto.layout.accent ?? 'blue' } : null,
        warningCount: result.warnings.length,
        hasEndUser: requester.endUserId !== null,
      },
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
      requestId: req.requestId ?? null,
    })
    return result
  }
}
