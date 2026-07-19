/**
 * terminal-utils.ts
 *
 * Pure utility functions shared between TerminalAgentService and TerminalAdminService.
 * No NestJS dependencies, no Prisma calls — safe to import in any layer.
 */

import crypto from 'crypto'
import { BadRequestException } from '@nestjs/common'
import { DEFAULT_SMART_CAMPUS_MODULES, type SmartCampusModules } from '../smart-campus/smart-campus.types'

// ── Constants ─────────────────────────────────────────────────────────────────

export const CONFIG_REFRESH_INTERVAL_MS = 5 * 60 * 1000
export const DEFAULT_BIND_CODE_TTL_MINUTES = 10
export const BIND_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

// ── PrintJobParams ─────────────────────────────────────────────────────────────

export interface PrintJobParams {
  copies: number
  colorMode: 'black_white' | 'color'
  duplex: 'simplex' | 'duplex_long_edge' | 'duplex_short_edge'
  paperSize: 'A4'
  orientation: 'auto' | 'portrait' | 'landscape'
  quality: 'draft' | 'standard' | 'high'
  scale: 'fit' | 'actual'
  pagesPerSheet: 1 | 2 | 4
  pageRange?: string
}

export const DEFAULT_PARAMS: PrintJobParams = {
  copies: 1,
  colorMode: 'black_white',
  duplex: 'simplex',
  paperSize: 'A4',
  orientation: 'auto',
  quality: 'standard',
  scale: 'fit',
  pagesPerSheet: 1,
}

// ── String helpers ─────────────────────────────────────────────────────────────

export function cleanNullable(value: string | null | undefined): string | null | undefined {
  if (value === null) return null
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeMacAddress(value: string | null | undefined): string | null | undefined {
  const cleaned = cleanNullable(value)
  if (cleaned === null || cleaned === undefined) return cleaned
  const hex = cleaned.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
  if (hex.length !== 12) {
    throw new BadRequestException({ error: { code: 'INVALID_MAC_ADDRESS', message: 'MAC 地址格式不正确' } })
  }
  return hex.match(/.{1,2}/g)!.join(':')
}

export function tryNormalizeMacAddress(value: string | null | undefined): string | null | undefined {
  try {
    return normalizeMacAddress(value)
  } catch {
    return undefined
  }
}

export function isMacUniqueConstraintError(error: unknown): boolean {
  const maybe = error as { code?: string; meta?: { target?: unknown } }
  if (maybe.code !== 'P2002') return false
  const target = maybe.meta?.target
  return Array.isArray(target)
    ? target.includes('macAddress')
    : typeof target === 'string' && target.includes('macAddress')
}

export function exceptionErrorCode(error: unknown): string | undefined {
  const maybe = error as { getResponse?: () => unknown; response?: unknown }
  const response = typeof maybe.getResponse === 'function' ? maybe.getResponse() : maybe.response
  if (!response || typeof response !== 'object') return undefined
  const nested = (response as { error?: { code?: unknown } }).error?.code
  return typeof nested === 'string' ? nested : undefined
}

export function parseSmartCampusModules(json: string): SmartCampusModules {
  try {
    const raw = JSON.parse(json) as Partial<SmartCampusModules> | null
    return {
      welcome: !!raw?.welcome,
      bigdata: false,
      luggage: !!raw?.luggage,
      panorama: !!raw?.panorama,
    }
  } catch {
    return { ...DEFAULT_SMART_CAMPUS_MODULES }
  }
}

export function hashBindCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim(), 'utf8').digest('hex')
}

/** 常量时间比较 agentToken，避免逐字节比较泄露时序信息。 */
export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = crypto.createHash('sha256').update(a).digest()
  const bufB = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(bufA, bufB)
}

export function makeBindCode(): string {
  let out = ''
  for (let i = 0; i < 20; i++) {
    out += BIND_CODE_ALPHABET[crypto.randomInt(0, BIND_CODE_ALPHABET.length)]
  }
  return out
}

/**
 * C5-3 出纸门控（paid 后才 claim 出纸）。默认关闭，由 PRINT_REQUIRE_PAID_BEFORE_CLAIM=true 显式开启。
 */
export function requirePaidBeforeClaim(): boolean {
  return process.env['PRINT_REQUIRE_PAID_BEFORE_CLAIM'] === 'true'
}

/**
 * Fail closed: the test print task is available only to an explicitly opted-in development process.
 */
export function shouldSeedTestPrintTask(): boolean {
  return process.env['NODE_ENV'] === 'development' && process.env['ENABLE_TEST_PRINT_TASK_SEED'] === 'true'
}

const AGENT_HEARTBEAT_STATUSES = new Set(['online', 'offline', 'error', 'agent_degraded'])

export function normalizeHeartbeatStatus(status: string | undefined): string | null {
  if (!status) return null
  return AGENT_HEARTBEAT_STATUSES.has(status) ? status : null
}

// fileName suffix → MIME（仅覆盖 Agent print() 支持的可打印类型）
const EXT_TO_MIME: Record<string, string> = {
  '.pdf':  'application/pdf',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.bmp':  'image/bmp',
  '.tif':  'image/tiff',
  '.tiff': 'image/tiff',
}

/** 由原始文件名后缀推断 MIME（无法判断时返回 undefined，交由 Agent 回退）。 */
export function inferMimeFromFileName(fileName: string | undefined): string | undefined {
  if (!fileName) return undefined
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return undefined
  const ext = fileName.slice(dot).toLowerCase()
  return EXT_TO_MIME[ext]
}

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} environment variable is required`)
  }
  return value
}
