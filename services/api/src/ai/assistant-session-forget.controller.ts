import { Body, Controller, Post, Req } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { AiUseExempt } from '../ai-access/ai-access.decorator'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { resolveClientIp } from '../common/client-ip'
import { RedisService } from '../common/redis/redis.service'
import { TerminalScopedThrottle } from '../common/throttler/terminal-throttle'
import { PrismaService } from '../prisma/prisma.service'
import { AssistantSessionsForgetDto } from './dto/assistant-sessions-forget.dto'
import { assistantOwnerKey, LlmChatService } from './llm/llm-chat.service'

interface ReqLike {
  headers: Record<string, string | string[] | undefined>
  ip?: string
  socket?: { remoteAddress?: string }
}

function authOf(req: ReqLike): string | undefined {
  const auth = req.headers.authorization
  if (typeof auth === 'string') return auth
  if (Array.isArray(auth)) return auth[0]
  return undefined
}

/**
 * 一体机清场：丢掉这一人次自己的小青对话内存。
 * 不调模型、不扣次数、不进 AI 使用闸门。找不到或不是自己的会话都当已经清掉。
 */
@Controller()
export class AssistantSessionForgetController {
  constructor(
    private readonly chat: LlmChatService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('assistant/sessions/forget')
  @TerminalScopedThrottle(12)
  @AiUseExempt('清掉本机这一人次的小青对话内存，不调模型；AI 暂停期间也必须能删')
  async forget(
    @Body() dto: AssistantSessionsForgetDto,
    @Req() req: ReqLike,
  ): Promise<{ forgotten: number }> {
    const member = await resolveOptionalEndUser(authOf(req), this.jwt, this.redis, this.prisma)
    const ownerKey = assistantOwnerKey(member?.endUserId ?? null, resolveClientIp(req))
    let forgotten = 0
    for (const sessionId of dto.sessionIds) {
      if (this.chat.forgetSession(sessionId, ownerKey)) forgotten += 1
    }
    return { forgotten }
  }
}
