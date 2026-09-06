import { Inject, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { randomBytes } from 'crypto'
import { tryRedis } from '../common/redis/redis-degradation'
import { RedisService } from '../common/redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'

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
    await this.assertCurrent(payload)
    return this.issue(payload)
  }

  async refresh(terminalId: string | undefined, sessionToken: string | undefined) {
    if (!terminalId?.trim() || !sessionToken?.trim()) throw this.invalid()
    const raw = await this.read(this.sessionKey(sessionToken))
    if (!raw) throw this.invalid()
    const payload = this.parse(raw)
    if (payload.terminalId !== terminalId) throw this.invalid()
    await this.assertCurrent(payload)
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
    await this.assertCurrent(payload)
  }

  private async issue(payload: TerminalSessionPayload) {
    const sessionToken = token()
    await this.write(this.sessionKey(sessionToken), SESSION_TTL_SECONDS, {
      ...payload,
      issuedAt: new Date().toISOString(),
    })
    return { sessionToken, expiresInSeconds: SESSION_TTL_SECONDS }
  }

  private async assertCurrent(payload: TerminalSessionPayload): Promise<void> {
    const terminal = await this.prisma.terminal.findUnique({
      where: { id: payload.terminalId },
      select: { enabled: true, credentialGeneration: true },
    })
    if (!terminal?.enabled || terminal.credentialGeneration !== payload.generation) throw this.invalid()
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
