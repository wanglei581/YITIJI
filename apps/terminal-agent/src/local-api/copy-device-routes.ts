import type { IncomingMessage, ServerResponse } from 'http'
import type { URL } from 'url'
import { createHash } from 'crypto'
import { CopyError, type CopyAction, type CopyCommand, type CopyRuntime } from '../agent/copy-device/copy-types'
import type { AgentConfig } from '../agent/types'
import { isLocalBridgeTokenValid } from './origin-guard'
import type { LocalBridgeSessionStore } from './bridge-session'
import { handleScanDeviceRoute, type ScanDeviceHttpRuntime, type ScanDeviceRouteHooks } from './scan-device-routes'

export interface DeviceServerOptions {
  scanDevice?: ScanDeviceHttpRuntime
  copyDevice?: CopyRuntime
}
const ACTIONS = new Set(['start', 'next-page', 'finish', 'status', 'preview', 'print', 'abort', 'clear'])
const ID = /^[A-Za-z0-9_-]{1,64}$/

async function commandFrom(req: IncomingMessage, action: CopyAction): Promise<CopyCommand> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > 8192) throw new CopyError(413, 'COPY_BAD_REQUEST')
    chunks.push(bytes)
  }
  let body: Record<string, unknown>
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> } catch {
    throw new CopyError(400, 'COPY_BAD_REQUEST')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CopyError(400, 'COPY_BAD_REQUEST')
  const fields = ['copyId', 'generation', 'operationId', ...(action === 'start' ? ['source', 'scanColor'] : []),
    ...(action === 'preview' ? ['page'] : [])]
  if (Object.keys(body).some((k) => !fields.includes(k)) ||
    typeof body['copyId'] !== 'string' || !ID.test(body['copyId']) ||
    typeof body['operationId'] !== 'string' || !ID.test(body['operationId']) ||
    !Number.isSafeInteger(body['generation']) || Number(body['generation']) < 1 ||
    (action === 'start' && (!['flatbed', 'feeder'].includes(String(body['source'])) ||
      !['gray', 'color'].includes(String(body['scanColor'])))) ||
    (action === 'preview' && (!Number.isSafeInteger(body['page']) || Number(body['page']) < 1))) {
    throw new CopyError(400, 'COPY_BAD_REQUEST')
  }
  return { copyId: body['copyId'], generation: Number(body['generation']), operationId: body['operationId'],
    ...(action === 'start' ? { source: body['source'] as CopyCommand['source'], scanColor: body['scanColor'] as CopyCommand['scanColor'] } : {}),
    ...(action === 'preview' ? { page: Number(body['page']) } : {}) }
}

/** 两类会话仅共用 HTTP 安全边界，运行器、任务标识及临时目录完全分离。 */
export async function handleDeviceRoute(input: {
  req: IncomingMessage; res: ServerResponse; origin: string; url: URL
  bridgeToken: string | undefined; bridgeSessions: LocalBridgeSessionStore
  config: AgentConfig; options: DeviceServerOptions; hooks: ScanDeviceRouteHooks
}): Promise<boolean> {
  const { req, res, origin, url, bridgeToken, bridgeSessions, config, options, hooks } = input
  if (url.pathname.startsWith('/local/scan/') && options.scanDevice) {
    await handleScanDeviceRoute({ ...input, runtime: options.scanDevice })
    return true
  }
  if (!url.pathname.startsWith('/local/copy/')) return false
  try {
    if (config.copyDeviceEnabled !== true || !options.copyDevice) throw new CopyError(403, 'COPY_DISABLED')
    const token = req.headers['x-local-bridge-token']
    if (!isLocalBridgeTokenValid(token, bridgeToken) && !bridgeSessions.validate(token, origin)) {
      throw new CopyError(403, 'COPY_UNAUTHORIZED')
    }
    const action = url.pathname.slice('/local/copy/'.length) as CopyAction
    if (!ACTIONS.has(action)) throw new CopyError(404, 'COPY_NOT_FOUND')
    if (req.method !== 'POST') throw new CopyError(405, 'COPY_METHOD_NOT_ALLOWED')
    if (url.search) throw new CopyError(400, 'COPY_BAD_REQUEST')
    const command = await commandFrom(req, action)
    const owner = createHash('sha256').update(`${origin}\0${String(token)}`).digest('hex')
    const data = await options.copyDevice.command(action, command, owner)
    res.setHeader('Cache-Control', 'no-store, private')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (Buffer.isBuffer(data)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Private-Network', 'true')
      res.setHeader('Vary', 'Origin')
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': data.length })
      res.end(data)
    } else hooks.sendEnvelope(res, 200, data, origin)
  } catch (error) {
    const failure = error instanceof CopyError ? error : new CopyError(503, 'COPY_DEVICE_UNAVAILABLE')
    hooks.sendJson(res, failure.status, { code: failure.code, message: failure.code, ...failure.snapshot }, origin)
  }
  return true
}
