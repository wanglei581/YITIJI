/**
 * 开票扫码会话的场景码。只存 sha256，明文只在创建和兑换时出现。
 * 前缀与扫码上传分开，避免开票码被小程序「扫普通链接」的 /k/u/、/k/l/ 规则吞掉。
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'

export const INVOICE_SESSION_TTL_SECONDS = 10 * 60
const SCENE_BYTES = 18
const SCENE_PATTERN = /^[A-Za-z0-9_-]{16,32}$/
const SCENE_INDEX_PREFIX = 'invoice_session_scene:'
const SESSION_PREFIX = 'invoice_session:'
const LOCK_PREFIX = 'invoice_session_lock:'

export interface InvoiceRedis {
  get(key: string): Promise<string | null>
  setEx(key: string, ttlSeconds: number, value: string): Promise<void>
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>
  del(key: string): Promise<void>
}

export function mintInvoiceSceneToken(): string {
  return randomBytes(SCENE_BYTES).toString('base64url')
}

export function isWellFormedInvoiceScene(scene: unknown): scene is string {
  return typeof scene === 'string' && SCENE_PATTERN.test(scene)
}

export function invoiceSceneIndexKey(scene: string): string {
  return `${SCENE_INDEX_PREFIX}${createHash('sha256').update(scene).digest('hex')}`
}

export function invoiceSessionKey(sessionId: string): string {
  return `${SESSION_PREFIX}${sessionId}`
}

export function invoiceSubmitLockKey(sessionId: string): string {
  return `${LOCK_PREFIX}${sessionId}`
}

export function hashInvoiceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function invoiceTokensEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export function deriveInvoiceSubmitToken(sessionId: string, scene: string): string {
  const secret = process.env['FILE_SIGNING_SECRET']
  if (!secret || secret.length < 32) {
    throw new Error('FILE_SIGNING_SECRET environment variable must be set (≥ 32 chars)')
  }
  return createHmac('sha256', secret)
    .update(`invoice-scene-token:v1:${sessionId}:${scene}`)
    .digest('base64url')
}

export function invoiceCodeUrl(origin: string, scene: string): string {
  const base = origin.endsWith('/') ? origin : `${origin}/`
  return new URL(`k/i/${scene}`, base).toString()
}
