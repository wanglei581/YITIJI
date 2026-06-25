import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { RedisService } from '../common/redis/redis.service'
import { TerminalsService } from '../terminals/terminals.service'
import { MemberAuthService, type MemberLoginResult } from './member-auth.service'

const QR_TICKET_TTL = 180
const QR_CLAIMED_TTL = 300

type QrTicketStatus = 'pending' | 'confirmed'

interface QrTicketPayload {
  status: QrTicketStatus
  claimTokenHash: string
  terminalId: string
  deviceId?: string
  deviceLabel?: string
  returnTo: string
  createdAt: string
  user?: MemberLoginResult['user']
}

export interface CreateQrLoginResult {
  ticketId: string
  claimToken: string
  qrUrl: string
  expiresInSeconds: number
}

export interface QrLoginStatusResult {
  status: QrTicketStatus
  deviceLabel?: string
  returnTo: string
  expiresInSeconds: number
}

export interface ConfirmQrLoginResult {
  status: 'confirmed'
}

@Injectable()
export class MemberQrLoginService {
  constructor(
    private readonly redis: RedisService,
    private readonly memberAuth: MemberAuthService,
    private readonly terminals: TerminalsService,
  ) {}

  async create(
    input: { deviceId?: string; deviceLabel?: string; returnTo?: string },
    terminalId: string | undefined,
    authHeader: string | undefined,
  ): Promise<CreateQrLoginResult> {
    const validatedTerminalId = await this.validateTerminal(terminalId, authHeader)
    const ticketId = randomToken(24)
    const claimToken = randomToken(32)
    const payload: QrTicketPayload = {
      status: 'pending',
      claimTokenHash: hashToken(claimToken),
      terminalId: validatedTerminalId,
      deviceId: cleanOptional(input.deviceId),
      deviceLabel: cleanOptional(input.deviceLabel),
      returnTo: normalizeReturnTo(input.returnTo),
      createdAt: new Date().toISOString(),
    }

    await this.redis.setEx(this.ticketKey(ticketId), QR_TICKET_TTL, JSON.stringify(payload))

    return {
      ticketId,
      claimToken,
      qrUrl: `/member/qr-login?ticketId=${encodeURIComponent(ticketId)}`,
      expiresInSeconds: QR_TICKET_TTL,
    }
  }

  async status(ticketId: string): Promise<QrLoginStatusResult> {
    const payload = await this.readTicket(ticketId)
    return {
      status: payload.status,
      deviceLabel: payload.deviceLabel,
      returnTo: payload.returnTo,
      expiresInSeconds: await this.remainingTtl(ticketId),
    }
  }

  async confirm(
    ticketId: string,
    input: { phone: string; code: string; deviceId?: string; ip: string },
  ): Promise<ConfirmQrLoginResult> {
    const payload = await this.readTicket(ticketId)
    if (payload.status === 'confirmed') {
      throw new ConflictException({ error: { code: 'QR_LOGIN_ALREADY_CONFIRMED', message: '扫码登录已确认' } })
    }

    const user = await this.memberAuth.verifySmsCodeForUser(input.phone, input.code)
    const confirmed: QrTicketPayload = {
      ...payload,
      status: 'confirmed',
      user,
    }
    const updated = await this.redis.setExistingWithCurrentTtl(this.ticketKey(ticketId), JSON.stringify(confirmed))
    if (updated === 'missing') {
      throw new NotFoundException({ error: { code: 'QR_LOGIN_NOT_FOUND', message: '扫码登录已过期或不存在' } })
    }

    return { status: 'confirmed' }
  }

  async claim(
    ticketId: string,
    claimToken: string,
    terminalId: string | undefined,
    authHeader: string | undefined,
  ): Promise<MemberLoginResult> {
    const validatedTerminalId = await this.validateTerminal(terminalId, authHeader)
    const payload = await this.readTicket(ticketId)
    if (payload.terminalId !== validatedTerminalId) {
      throw new UnauthorizedException({ error: { code: 'QR_LOGIN_TERMINAL_MISMATCH', message: '扫码登录终端不匹配' } })
    }
    if (payload.status !== 'confirmed' || !payload.user) {
      throw new UnauthorizedException({ error: { code: 'QR_LOGIN_NOT_CONFIRMED', message: '扫码登录尚未确认' } })
    }
    if (!matchesToken(claimToken, payload.claimTokenHash)) {
      throw new UnauthorizedException({ error: { code: 'QR_LOGIN_CLAIM_INVALID', message: '扫码登录凭证无效' } })
    }

    const raw = await this.redis.getDelAndSetEx(
      this.ticketKey(ticketId),
      this.claimedKey(ticketId),
      QR_CLAIMED_TTL,
      '1',
    )
    if (!raw) {
      if (await this.redis.get(this.claimedKey(ticketId))) {
        throw new GoneException({ error: { code: 'QR_LOGIN_ALREADY_CLAIMED', message: '扫码登录已被领取' } })
      }
      throw new NotFoundException({ error: { code: 'QR_LOGIN_NOT_FOUND', message: '扫码登录已过期或不存在' } })
    }

    const current = this.parsePayload(raw)
    if (
      current.status !== 'confirmed' ||
      !current.user ||
      current.terminalId !== validatedTerminalId ||
      !matchesToken(claimToken, current.claimTokenHash)
    ) {
      throw new UnauthorizedException({ error: { code: 'QR_LOGIN_CLAIM_INVALID', message: '扫码登录凭证无效' } })
    }

    return this.memberAuth.issueLoginForUser(current.user)
  }

  private async readTicket(ticketId: string): Promise<QrTicketPayload> {
    this.assertTicketId(ticketId)
    const raw = await this.redis.get(this.ticketKey(ticketId))
    if (!raw) {
      if (await this.redis.get(this.claimedKey(ticketId))) {
        throw new GoneException({ error: { code: 'QR_LOGIN_ALREADY_CLAIMED', message: '扫码登录已被领取' } })
      }
      throw new NotFoundException({ error: { code: 'QR_LOGIN_NOT_FOUND', message: '扫码登录已过期或不存在' } })
    }
    return this.parsePayload(raw)
  }

  private parsePayload(raw: string): QrTicketPayload {
    try {
      const payload = JSON.parse(raw) as QrTicketPayload
      if ((payload.status === 'pending' || payload.status === 'confirmed') && payload.claimTokenHash && payload.terminalId) return payload
    } catch {
      // fall through to normalized 404-style response below
    }
    throw new NotFoundException({ error: { code: 'QR_LOGIN_NOT_FOUND', message: '扫码登录已过期或不存在' } })
  }

  private async remainingTtl(ticketId: string): Promise<number> {
    const ttl = await this.redis.ttl(this.ticketKey(ticketId))
    if (ttl > 0) return ttl
    throw new NotFoundException({ error: { code: 'QR_LOGIN_NOT_FOUND', message: '扫码登录已过期或不存在' } })
  }

  private async validateTerminal(terminalId: string | undefined, authHeader: string | undefined): Promise<string> {
    if (!terminalId) {
      throw new UnauthorizedException({ error: { code: 'AUTH_TOKEN_INVALID', message: '缺少 x-terminal-id header' } })
    }
    await this.terminals.validateTerminalToken(terminalId, authHeader)
    return terminalId
  }

  private assertTicketId(ticketId: string): void {
    if (!/^[A-Za-z0-9_-]{32,96}$/.test(ticketId)) {
      throw new BadRequestException({ error: { code: 'QR_LOGIN_TICKET_INVALID', message: '扫码登录票据格式无效' } })
    }
  }

  private ticketKey(ticketId: string): string {
    return `member:qr:${ticketId}`
  }

  private claimedKey(ticketId: string): string {
    return `member:qr:claimed:${ticketId}`
  }
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function matchesToken(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function normalizeReturnTo(value: string | undefined): string {
  const returnTo = value?.trim() || '/'
  let decoded = returnTo
  try {
    decoded = decodeURIComponent(returnTo)
  } catch {
    throw invalidReturnTo()
  }

  if (
    !returnTo.startsWith('/') ||
    returnTo.startsWith('//') ||
    returnTo.includes('\\') ||
    decoded.startsWith('//') ||
    decoded.includes('\\') ||
    /https?:\/\//i.test(decoded) ||
    containsControlCharacter(decoded)
  ) {
    throw invalidReturnTo()
  }

  return returnTo
}

function invalidReturnTo(): BadRequestException {
  return new BadRequestException({ error: { code: 'QR_LOGIN_RETURN_TO_INVALID', message: '扫码登录回跳地址无效' } })
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.charCodeAt(0)
    return code <= 31 || code === 127
  })
}
