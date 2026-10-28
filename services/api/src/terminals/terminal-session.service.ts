import { Inject, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { randomBytes } from 'crypto'
import { tryRedis } from '../common/redis/redis-degradation'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'
import { assertOrgMaySignSessions } from '../licenses/license-gate'

export interface TerminalTokenValidator {
  validateTerminalToken(terminalId: string, authHeader: string | undefined): Promise<void>
}

export const TERMINAL_TOKEN_VALIDATOR = Symbol('TERMINAL_TOKEN_VALIDATOR')

const BOOT_TICKET_TTL_SECONDS = 60
const SESSION_TTL_SECONDS = 30 * 60

interface TerminalSessionPayload {
  terminalId: string
  generation: number
  issuedAt: string
}

@Injectable()
export class TerminalSessionService {
  private readonly logger = new Logger(TerminalSessionService.name)

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    @Inject(TERMINAL_TOKEN_VALIDATOR) private readonly terminals: TerminalTokenValidator,
  ) {}

  async createBootTicket(terminalId: string | undefined, authorization: string | undefined) {
    if (!terminalId?.trim()) throw this.invalid()
    await this.terminals.validateTerminalToken(terminalId, authorization)
    const terminal = await this.prisma.terminal.findUnique({
      where: { id: terminalId },
      select: { enabled: true, credentialGeneration: true },
    })
    if (!terminal?.enabled) throw this.invalid()
    const ticket = token()
    const payload: TerminalSessionPayload = {
      terminalId,
      generation: terminal.credentialGeneration,
      issuedAt: new Date().toISOString(),
    }
    await this.write(this.bootKey(ticket), BOOT_TICKET_TTL_SECONDS, payload)
    return { bootTicket: ticket, expiresInSeconds: BOOT_TICKET_TTL_SECONDS }
  }

  async exchangeBootTicket(ticket: string) {
    const raw = await this.readAndDelete(this.bootKey(ticket))
    if (!raw) throw this.invalid()
    const payload = this.parse(raw)
    await this.assertCurrent(payload, { issuing: true })
    return this.issue(payload)
  }

  async refresh(terminalId: string | undefined, sessionToken: string | undefined) {
    if (!terminalId?.trim() || !sessionToken?.trim()) throw this.invalid()
    const raw = await this.read(this.sessionKey(sessionToken))
    if (!raw) throw this.invalid()
    const payload = this.parse(raw)
    if (payload.terminalId !== terminalId) throw this.invalid()
    await this.assertCurrent(payload, { issuing: true })
    // Keep the prior short session until its own TTL. A request that raced the
    // periodic refresh can still refresh instead of becoming a false 401.
    // Every token remains bounded by 30 minutes and is checked against enabled
    // plus credentialGeneration on every protected request.
    return this.issue(payload)
  }

  async validate(terminalId: string | undefined, sessionToken: string | undefined): Promise<void> {
    if (!terminalId?.trim() || !sessionToken?.trim()) throw this.invalid()
    const raw = await this.read(this.sessionKey(sessionToken))
    if (!raw) throw this.invalid()
    const payload = this.parse(raw)
    if (payload.terminalId !== terminalId) throw this.invalid()
    // 校验已签发的会话：不看软件使用授权。授权到期只拦「新会话签发」（换票、续期），
    // 正在办事的会话照常用到自然过期（≤ 30 分钟），不掐断群众手头的事。
    await this.assertCurrent(payload, { issuing: false })
  }

  private async issue(payload: TerminalSessionPayload) {
    const sessionToken = token()
    await this.write(this.sessionKey(sessionToken), SESSION_TTL_SECONDS, {
      ...payload,
      issuedAt: new Date().toISOString(),
    })
    return { sessionToken, expiresInSeconds: SESSION_TTL_SECONDS }
  }

  private async assertCurrent(payload: TerminalSessionPayload, options: { issuing: boolean }): Promise<void> {
    const terminal = await this.prisma.terminal.findUnique({
      where: { id: payload.terminalId },
      select: { enabled: true, credentialGeneration: true, orgId: true },
    })
    if (!terminal?.enabled || terminal.credentialGeneration !== payload.generation) throw this.invalid()
    // 签发新会话（换票、续期）前核对所属机构的软件使用授权：机构需要授权且不可用时拒绝
    // （403 TERMINAL_LICENSE_INACTIVE）。不管控的机构（所有现有机构的默认）一条查询就放行。
    if (options.issuing) await assertOrgMaySignSessions(this.prisma, terminal.orgId)
  }

  private async read(key: string): Promise<string | null> {
    const result = await tryRedis(`terminal-session:get:${key.slice(0, 18)}`, () => this.redis.get(key), this.logger)
    if (!result.ok) throw this.retryable()
    return result.value
  }

  private async readAndDelete(key: string): Promise<string | null> {
    const result = await tryRedis(`terminal-session:getdel:${key.slice(0, 18)}`, () => this.redis.getDel(key), this.logger)
    if (!result.ok) throw this.retryable()
    return result.value
  }

  private async write(key: string, ttl: number, payload: TerminalSessionPayload): Promise<void> {
    const result = await tryRedis(`terminal-session:set:${key.slice(0, 18)}`, () => this.redis.setEx(key, ttl, JSON.stringify(payload)), this.logger)
    if (!result.ok) throw this.retryable()
  }

  private parse(raw: string): TerminalSessionPayload {
    try {
      const value = JSON.parse(raw) as Partial<TerminalSessionPayload>
      if (typeof value.terminalId === 'string' && Number.isInteger(value.generation) && typeof value.issuedAt === 'string') {
        return value as TerminalSessionPayload
      }
    } catch {
      // An invalid Redis value is never a valid session.
    }
    throw this.invalid()
  }

  bootKey(ticket: string): string { return `term:boot:${ticket}` }
  sessionKey(sessionToken: string): string { return `term:session:${sessionToken}` }

  private invalid(): UnauthorizedException {
    return new UnauthorizedException({ error: { code: 'TERMINAL_SESSION_INVALID', message: '终端安全会话无效' } })
  }

  private retryable(): ServiceUnavailableException {
    return new ServiceUnavailableException({ error: { code: 'TERMINAL_SESSION_RETRYABLE', message: '终端安全校验暂时不可用' } })
  }
}

function token(): string { return randomBytes(32).toString('base64url') }
