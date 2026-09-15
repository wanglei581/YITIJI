import { BadRequestException, ConflictException } from '@nestjs/common'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export interface ScanDeliveryLeasePayload {
  terminalId: string
  scanTaskId: string
  taskCreatedAtEpoch: number
  leaseEpoch: number
  notBeforeEpoch: number
  expiresAtEpoch: number
  nonce: string
}

export interface ScanDeliveryLeaseResult {
  scanTaskId: string
  serverNow: string
  notBefore: string
  expiresAt: string
  deliveryLease: string
}

/** 5 秒的时钟漂移容差，覆盖 Agent 与 API 服务端 NTP 同步微小抖动 */
export const SCAN_LEASE_CLOCK_TOLERANCE_MS = 5_000

/** 扫描投递租约默认有效期：60 秒短期签名凭据 */
export const SCAN_LEASE_DEFAULT_TTL_MS = 60_000

/**
 * 获取服务端租约签名密钥。
 * 复用现有的终端动作令牌密钥 / 文件签名密钥，仅在服务端持有，绝不向 Kiosk 暴露。
 */
export function getScanLeaseSecret(): string {
  const secret =
    process.env['SCAN_LEASE_SECRET'] ||
    process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||
    process.env['FILE_SIGNING_SECRET']
  if (!secret || secret.length < 16) {
    throw new Error('Scan lease secret must be configured (>= 16 chars)')
  }
  return secret
}

/**
 * 签发扫描任务投递租约。
 * 绑定 terminalId + scanTaskId + taskCreatedAtEpoch + leaseEpoch + notBeforeEpoch + expiresAtEpoch。
 */
export function signScanDeliveryLease(payload: ScanDeliveryLeasePayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', getScanLeaseSecret())
    .update(encodedPayload)
    .digest('base64url')
  return `${encodedPayload}.${signature}`
}

/**
 * 校验扫描任务投递租约签名及有效性。
 * 严格按给定的 terminalId 和 scanTaskId 核实归属。
 * 注意：payload 中的 nonce 仅作为短期签名签发熵源，服务端当前未在持久层或缓存中消费记录该 nonce。
 * 租约到期前凭据本身可重放，但实际影响由精确 task/status/CAS（以及内容哈希查重）严格限制；
 * 切勿声称 nonce 具备防重放能力；本轮不扩大数据库状态模型。
 */
export function verifyScanDeliveryLease(
  lease: string | undefined | null,
  expectedTerminalId: string,
  expectedScanTaskId: string,
  nowMs: number = Date.now(),
): ScanDeliveryLeasePayload {
  if (!lease || typeof lease !== 'string' || !lease.trim()) {
    throw new BadRequestException({
      error: { code: 'SCAN_LEASE_MISSING', message: '缺少有效的扫描投递租约(deliveryLease)' },
    })
  }

  const parts = lease.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new BadRequestException({
      error: { code: 'SCAN_LEASE_INVALID', message: '扫描投递租约格式无效' },
    })
  }

  const [encodedPayload, signature] = parts
  const expectedSig = createHmac('sha256', getScanLeaseSecret())
    .update(encodedPayload)
    .digest('base64url')

  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expectedSig)
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new ConflictException({
      error: { code: 'SCAN_LEASE_INVALID', message: '扫描投递租约签名无效或已被篡改' },
    })
  }

  let payload: ScanDeliveryLeasePayload
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
  } catch {
    throw new BadRequestException({
      error: { code: 'SCAN_LEASE_INVALID', message: '扫描投递租约内容解析失败' },
    })
  }

  if (payload.terminalId !== expectedTerminalId) {
    throw new ConflictException({
      error: { code: 'SCAN_LEASE_INVALID', message: '扫描投递租约终端不匹配' },
    })
  }

  if (payload.scanTaskId !== expectedScanTaskId) {
    throw new ConflictException({
      error: { code: 'SCAN_LEASE_INVALID', message: '扫描投递租约任务ID不匹配' },
    })
  }

  if (nowMs > payload.expiresAtEpoch) {
    throw new ConflictException({
      error: { code: 'SCAN_LEASE_EXPIRED', message: '扫描投递租约已过期' },
    })
  }

  if (nowMs < payload.notBeforeEpoch - SCAN_LEASE_CLOCK_TOLERANCE_MS) {
    throw new ConflictException({
      error: { code: 'SCAN_LEASE_INVALID', message: '扫描投递租约尚未生效' },
    })
  }

  return payload
}

/**
 * 构造用于签发给 Agent 的完整租约对象。
 */
export function buildScanDeliveryLease(args: {
  terminalId: string
  scanTaskId: string
  taskCreatedAt: Date
  taskExpiresAt: Date
  now?: Date
  ttlMs?: number
}): ScanDeliveryLeaseResult {
  const now = args.now ?? new Date()
  const ttlMs = args.ttlMs ?? SCAN_LEASE_DEFAULT_TTL_MS
  const expiresAtMs = Math.min(args.taskExpiresAt.getTime(), now.getTime() + ttlMs)
  const taskCreatedAtEpoch = args.taskCreatedAt.getTime()
  const payload: ScanDeliveryLeasePayload = {
    terminalId: args.terminalId,
    scanTaskId: args.scanTaskId,
    taskCreatedAtEpoch,
    leaseEpoch: now.getTime(),
    notBeforeEpoch: taskCreatedAtEpoch,
    expiresAtEpoch: expiresAtMs,
    nonce: randomBytes(16).toString('hex'),
  }

  return {
    scanTaskId: args.scanTaskId,
    serverNow: now.toISOString(),
    notBefore: args.taskCreatedAt.toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    deliveryLease: signScanDeliveryLease(payload),
  }
}
