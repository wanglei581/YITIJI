// U 盘导入专用上传的终端身份与能力拒绝。
// 令牌比较不在这里做：交给 TerminalsService.assertAgentAuthorized
// （与心跳 / 认领任务同一套）。这里只读头、翻译能力拒绝码。
// 拒绝响应不得带原始文件名。

import { ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common'
import type { TerminalsService } from '../terminals/terminals.service'

export const USB_IMPORT_UNAVAILABLE_CODE = 'USB_IMPORT_UNAVAILABLE'
export const USB_IMPORT_UNAVAILABLE_MESSAGE = '这台终端暂不支持从 U 盘导入，请改用手机扫码上传'

const CAPABILITY_DENIAL_CODES = new Set(['CAPABILITY_UNAVAILABLE', 'CAPABILITY_NOT_CONFIGURED'])

type HeaderBag = Record<string, string | string[] | undefined>

function headerValue(headers: HeaderBag, name: string): string | undefined {
  const raw = headers[name]
  const value = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function errorCodeOf(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const error = (body as { error?: { code?: unknown } }).error
  return typeof error?.code === 'string' ? error.code : undefined
}

/**
 * 已验证的终端 Agent。令牌在 X-Terminal-Agent-Token，不占用 Authorization
 * （简历上传的会员令牌仍走 Authorization）。缺头或校验失败一律 401，不落文件。
 * 缺终端号时不交给校验器，避免它把「没给终端号」报成 404。
 */
export async function assertUsbImportAgent(
  terminals: TerminalsService,
  headers: HeaderBag,
): Promise<string> {
  const terminalId = headerValue(headers, 'x-terminal-id')
  const agentToken = headerValue(headers, 'x-terminal-agent-token')
  if (!terminalId || !agentToken) {
    throw new UnauthorizedException({ error: { code: 'AUTH_TOKEN_INVALID', message: 'agentToken 无效' } })
  }
  await terminals.assertAgentAuthorized(terminalId, `Bearer ${agentToken}`)
  return terminalId
}

/** 只翻译能力门禁的两个码。终端停用等其它错误原样抛出。 */
export function rethrowUsbImportUnavailable(error: unknown): never {
  if (error instanceof HttpException && CAPABILITY_DENIAL_CODES.has(errorCodeOf(error.getResponse()) ?? '')) {
    throw new ForbiddenException({
      error: { code: USB_IMPORT_UNAVAILABLE_CODE, message: USB_IMPORT_UNAVAILABLE_MESSAGE },
    })
  }
  throw error
}
