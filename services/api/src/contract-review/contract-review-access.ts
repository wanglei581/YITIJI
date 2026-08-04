import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const ACCESS_TOKEN_BYTES = 32
const ACCESS_TOKEN_LENGTH = 43
const SHA256_BYTES = 32
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/

export interface IssuedAnonymousAccessToken {
  accessToken: string
  accessTokenHash: string
}

export function hashAnonymousAccessToken(accessToken: string): string {
  return createHash('sha256').update(accessToken, 'utf8').digest('hex')
}

export function issueAnonymousAccessToken(): IssuedAnonymousAccessToken {
  const accessToken = randomBytes(ACCESS_TOKEN_BYTES).toString('base64url')
  return { accessToken, accessTokenHash: hashAnonymousAccessToken(accessToken) }
}

function validAccessToken(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length !== ACCESS_TOKEN_LENGTH ||
    !BASE64URL_PATTERN.test(value)
  ) {
    return false
  }
  try {
    const decoded = Buffer.from(value, 'base64url')
    return decoded.length === ACCESS_TOKEN_BYTES && decoded.toString('base64url') === value
  } catch {
    return false
  }
}

function storedHashBuffer(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) {
    return value.length === SHA256_BYTES ? Buffer.from(value) : null
  }
  if (typeof value !== 'string' || !SHA256_HEX_PATTERN.test(value)) return null
  const decoded = Buffer.from(value, 'hex')
  return decoded.length === SHA256_BYTES ? decoded : null
}

export function verifyAnonymousAccessToken(
  accessToken: unknown,
  storedAccessTokenHash: unknown
): boolean {
  if (!validAccessToken(accessToken)) return false
  const expected = storedHashBuffer(storedAccessTokenHash)
  if (!expected) return false
  const actual = Buffer.from(hashAnonymousAccessToken(accessToken), 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
