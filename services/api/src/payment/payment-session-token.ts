import { createHmac, timingSafeEqual } from 'crypto'

const TOKEN_VERSION = 'pst_v1'
const CLAIM_VERSION = 1
const SIGNING_DOMAIN = `${TOKEN_VERSION}|payment-session|`
const DEFAULT_TTL_MS = 30 * 60 * 1000
const MIN_SECRET_LENGTH = 32

export type PaymentSessionErrorCode =
  | 'PAYMENT_SESSION_REQUIRED'
  | 'PAYMENT_SESSION_INVALID'
  | 'PAYMENT_SESSION_EXPIRED'
  | 'PAYMENT_SESSION_MISMATCH'

export interface PaymentSessionSubject {
  orderId: string
  orderNo: string
  terminalId: string | null
  amountCents: number
  printTaskId?: string | null
}

interface PaymentSessionClaims {
  v: 1
  orderId: string
  orderNo: string
  terminalId: string
  amountCents: number
  printTaskId: string | null
  iat: number
  exp: number
}

export type PaymentSessionVerifyResult =
  | { ok: true; claims: PaymentSessionClaims }
  | { ok: false; code: PaymentSessionErrorCode }

function fallbackSecretForNonProduction(): string | undefined {
  if (process.env['NODE_ENV'] === 'production') return undefined
  return process.env['JWT_SECRET'] || process.env['FILE_SIGNING_SECRET']
}

function getSecret(): string {
  const secret = process.env['PAYMENT_SESSION_SECRET'] || fallbackSecretForNonProduction()
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`PAYMENT_SESSION_SECRET_INVALID: PAYMENT_SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} chars`)
  }
  return secret
}

export function assertPaymentSessionSecretConfigured(): void {
  getSecret()
}

function ttlMsFromEnv(): number {
  const raw = Number(process.env['PAYMENT_SESSION_TTL_SECONDS'])
  if (!Number.isFinite(raw) || raw < 60 || raw > 24 * 3600) return DEFAULT_TTL_MS
  return Math.floor(raw) * 1000
}

function encodeClaims(value: PaymentSessionClaims): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeClaims(payload: string): PaymentSessionClaims | null {
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<PaymentSessionClaims>
    if (
      parsed.v !== CLAIM_VERSION ||
      typeof parsed.orderId !== 'string' ||
      typeof parsed.orderNo !== 'string' ||
      typeof parsed.terminalId !== 'string' ||
      typeof parsed.amountCents !== 'number' ||
      !Number.isInteger(parsed.amountCents) ||
      !(typeof parsed.printTaskId === 'string' || parsed.printTaskId === null) ||
      typeof parsed.iat !== 'number' ||
      typeof parsed.exp !== 'number'
    ) {
      return null
    }
    return parsed as PaymentSessionClaims
  } catch {
    return null
  }
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(`${SIGNING_DOMAIN}${payload}`).digest('base64url')
}

function signatureMatches(payload: string, signature: string): boolean {
  const expected = sign(payload)
  const actualBuffer = Buffer.from(signature, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  if (actualBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(actualBuffer, expectedBuffer)
}

function normalizeTerminalId(terminalId: string | null): string {
  return terminalId?.trim() ?? ''
}

function sameSubject(claims: PaymentSessionClaims, expected: PaymentSessionSubject): boolean {
  return (
    claims.orderId === expected.orderId &&
    claims.orderNo === expected.orderNo &&
    claims.terminalId === normalizeTerminalId(expected.terminalId) &&
    claims.amountCents === expected.amountCents &&
    claims.printTaskId === (expected.printTaskId ?? null)
  )
}

export function createPaymentSessionToken(input: PaymentSessionSubject): string {
  const terminalId = normalizeTerminalId(input.terminalId)
  if (!terminalId) throw new Error('PAYMENT_SESSION_TERMINAL_REQUIRED')

  const now = Date.now()
  const payload = encodeClaims({
    v: CLAIM_VERSION,
    orderId: input.orderId,
    orderNo: input.orderNo,
    terminalId,
    amountCents: input.amountCents,
    printTaskId: input.printTaskId ?? null,
    iat: now,
    exp: now + ttlMsFromEnv(),
  })
  return `${TOKEN_VERSION}.${payload}.${sign(payload)}`
}

export function verifyPaymentSessionToken(
  token: string | undefined,
  expected: PaymentSessionSubject,
  nowMs = Date.now(),
): PaymentSessionVerifyResult {
  if (!token?.trim()) return { ok: false, code: 'PAYMENT_SESSION_REQUIRED' }

  const [version, payload, signature, extra] = token.trim().split('.')
  if (version !== TOKEN_VERSION || !payload || !signature || extra !== undefined) {
    return { ok: false, code: 'PAYMENT_SESSION_INVALID' }
  }
  if (!signatureMatches(payload, signature)) return { ok: false, code: 'PAYMENT_SESSION_INVALID' }

  const claims = decodeClaims(payload)
  if (!claims) return { ok: false, code: 'PAYMENT_SESSION_INVALID' }
  if (claims.exp <= nowMs) return { ok: false, code: 'PAYMENT_SESSION_EXPIRED' }
  if (!sameSubject(claims, expected)) return { ok: false, code: 'PAYMENT_SESSION_MISMATCH' }

  return { ok: true, claims }
}
