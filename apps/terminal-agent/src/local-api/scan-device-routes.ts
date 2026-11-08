/**
 * local-api/scan-device-routes.ts — 屏上扫描的本机接口
 *
 * 只在开关打开、调度器已创建时由 qr-login-server 分发进来。
 * 令牌、方法、查询参数、请求体的检查顺序与本机打印唤醒一致。
 * 不提供按任务号查询状态的接口：一体机看云端会话，每条命令的响应里已经带上状态。
 */

import type { IncomingMessage, ServerResponse } from 'http'
import type { URL } from 'url'
import { isLocalBridgeTokenValid } from './origin-guard'
import type { LocalBridgeSessionStore } from './bridge-session'
import type { LocalApiError } from './types'
import { LocalScanError, type ScanDeviceView } from '../agent/scan-device/scan-device-runner'
import type { ScanDeviceHealthSnapshot } from '../agent/scan-device/scan-device-health'
import { SCAN_TASK_ID_PATTERN } from '../agent/scan-device/scan-temp-dir'

const MAX_BODY_BYTES = 8 * 1024

const POST_ROUTES = new Set([
  '/local/scan/start',
  '/local/scan/next-page',
  '/local/scan/finish',
  '/local/scan/abort',
])

export interface ScanDeviceHttpRuntime {
  start(scanTaskId: string): Promise<ScanDeviceView>
  nextPage(scanTaskId: string): Promise<ScanDeviceView>
  finish(scanTaskId: string): Promise<ScanDeviceView>
  abort(scanTaskId: string): Promise<ScanDeviceView>
  probe(): Promise<ScanDeviceHealthSnapshot>
}

export interface ScanDeviceRouteHooks {
  sendJson(res: ServerResponse, status: number, error: LocalApiError, origin?: string): void
  sendEnvelope<T>(res: ServerResponse, status: number, data: T, origin: string): void
}

interface ScanBodyError {
  status: number
  error: LocalApiError
}

function fail(status: number, code: string, message: string): ScanBodyError {
  return { status, error: { code, message } }
}

async function readScanBody(req: IncomingMessage): Promise<{ bytes: number; body: Record<string, unknown> }> {
  let bytes = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_BODY_BYTES) throw fail(400, 'LOCAL_SCAN_BODY_INVALID', '请求体过大')
    chunks.push(buffer)
  }
  if (bytes === 0) return { bytes, body: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw fail(400, 'LOCAL_SCAN_BAD_JSON', '请求 JSON 格式无效')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw fail(400, 'LOCAL_SCAN_BAD_JSON', '请求 JSON 必须是对象')
  }
  return { bytes, body: parsed as Record<string, unknown> }
}

function scanTaskIdFrom(body: Record<string, unknown>): string {
  const keys = Object.keys(body)
  if (keys.some((key) => key !== 'scanTaskId')) {
    throw fail(400, 'LOCAL_SCAN_BODY_INVALID', '请求体含有不认识的字段')
  }
  const scanTaskId = body['scanTaskId']
  if (typeof scanTaskId !== 'string' || !SCAN_TASK_ID_PATTERN.test(scanTaskId)) {
    throw fail(400, 'LOCAL_SCAN_TASK_ID_INVALID', '扫描任务号无效')
  }
  return scanTaskId
}

function dataOf(view: ScanDeviceView): ScanDeviceView {
  const data: ScanDeviceView = { state: view.state, pageCount: view.pageCount, errorCode: view.errorCode }
  if (view.purged !== undefined) data.purged = view.purged
  return data
}

function sendLocalScanError(
  hooks: ScanDeviceRouteHooks,
  res: ServerResponse,
  origin: string,
  error: LocalScanError,
): void {
  hooks.sendJson(res, error.httpStatus, {
    code: error.code,
    message: error.message,
    state: error.snapshot.state,
    pageCount: error.snapshot.pageCount,
    errorCode: error.snapshot.errorCode,
    ...(error.snapshot.purged !== undefined ? { purged: error.snapshot.purged } : {}),
  }, origin)
}

export async function handleScanDeviceRoute(input: {
  req: IncomingMessage
  res: ServerResponse
  origin: string
  url: URL
  bridgeToken: string | undefined
  bridgeSessions: LocalBridgeSessionStore
  runtime: ScanDeviceHttpRuntime
  hooks: ScanDeviceRouteHooks
}): Promise<void> {
  const { req, res, origin, url, bridgeToken, bridgeSessions, runtime, hooks } = input
  if (
    !isLocalBridgeTokenValid(req.headers['x-local-bridge-token'], bridgeToken) &&
    !bridgeSessions.validate(req.headers['x-local-bridge-token'], origin)
  ) {
    hooks.sendJson(res, 403, { code: 'LOCAL_SCAN_BRIDGE_TOKEN_INVALID', message: '本机扫描令牌校验失败' }, origin)
    return
  }

  const pathname = url.pathname
  const isProbe = pathname === '/local/scan/probe'
  const isPost = POST_ROUTES.has(pathname)
  if (!isProbe && !isPost) {
    hooks.sendJson(res, 404, { code: 'LOCAL_SCAN_NOT_FOUND', message: '本机扫描接口不存在' }, origin)
    return
  }
  const methodOk = isProbe ? req.method === 'GET' : req.method === 'POST'
  if (!methodOk) {
    hooks.sendJson(res, 405, { code: 'LOCAL_SCAN_METHOD_NOT_ALLOWED', message: '本机扫描接口不支持这个方法' }, origin)
    return
  }
  if (url.search.length > 0) {
    hooks.sendJson(res, 400, { code: 'LOCAL_SCAN_QUERY_NOT_ALLOWED', message: '本机扫描接口不接受查询参数' }, origin)
    return
  }

  if (isProbe) {
    const { bytes } = await readScanBody(req)
    if (bytes > 0) {
      hooks.sendJson(res, 400, { code: 'LOCAL_SCAN_BODY_INVALID', message: '本机扫描探测不接受请求体' }, origin)
      return
    }
    const snapshot = await runtime.probe()
    hooks.sendEnvelope(res, 200, { state: snapshot.health, pageCount: 0, errorCode: null }, origin)
    return
  }

  const { body } = await readScanBody(req)
  const scanTaskId = scanTaskIdFrom(body)
  try {
    const view = pathname === '/local/scan/start'
      ? await runtime.start(scanTaskId)
      : pathname === '/local/scan/next-page'
        ? await runtime.nextPage(scanTaskId)
        : pathname === '/local/scan/finish'
          ? await runtime.finish(scanTaskId)
          : await runtime.abort(scanTaskId)
    hooks.sendEnvelope(res, 200, dataOf(view), origin)
  } catch (error) {
    if (error instanceof LocalScanError) {
      sendLocalScanError(hooks, res, origin, error)
      return
    }
    throw error
  }
}
