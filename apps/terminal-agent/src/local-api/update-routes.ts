import type { IncomingMessage, ServerResponse } from 'node:http'
import type { URL } from 'node:url'
import type { AgentConfig } from '../agent/types'
import { isValidLocalUpdateControlToken } from '../agent/update-control-token'
import { isLocalBridgeTokenValid } from './origin-guard'
import type {
  LocalAgentPanelStatus,
  LocalApiError,
  LocalUpdateDrainStatus,
  LocalUpdateHealthStatus,
} from './types'

const MAX_BODY_BYTES = 8 * 1024
const UPDATE_CONTROL_TOKEN_HEADER = 'x-update-control-token'

export interface LocalUpdateRouteOptions {
  getPanelStatus?: () => LocalAgentPanelStatus
  getUpdateDrainStatus?: () => LocalUpdateDrainStatus
  beginUpdateDrain?: (timeoutMs: number) => Promise<LocalUpdateDrainStatus>
  cancelUpdateDrain?: () => LocalUpdateDrainStatus
  completeUpdateDrain?: () => LocalUpdateDrainStatus
}

/** Handle loopback-only updater routes before browser Origin/CORS processing. */
export async function handleLocalUpdateRoute(input: {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  config: AgentConfig
  options: LocalUpdateRouteOptions
}): Promise<boolean> {
  const { req, res, url, config, options } = input
  if (!url.pathname.startsWith('/local/update/')) return false

  if (!isUpdateControlTokenValid(req.headers[UPDATE_CONTROL_TOKEN_HEADER], config.localUpdateControlToken)) {
    sendLocalUpdateError(res, 403, {
      code: 'LOCAL_UPDATE_CONTROL_TOKEN_INVALID',
      message: '升级控制凭据无效',
    })
    return true
  }

  if (url.pathname === '/local/update/drain/status') {
    if (req.method !== 'GET' || url.search.length > 0) {
      sendLocalUpdateError(res, 400, {
        code: 'LOCAL_UPDATE_DRAIN_REQUEST_INVALID',
        message: '升级排空状态请求无效',
      })
      return true
    }
    const status = options.getUpdateDrainStatus?.()
    if (!status) {
      sendLocalUpdateError(res, 503, {
        code: 'LOCAL_UPDATE_DRAIN_UNAVAILABLE',
        message: '升级排空暂不可用',
      })
      return true
    }
    sendLocalUpdateEnvelope(res, 200, status)
    return true
  }

  if (url.pathname === '/local/update/drain/begin') {
    if (req.method !== 'POST' || url.search.length > 0) {
      sendLocalUpdateError(res, 400, {
        code: 'LOCAL_UPDATE_DRAIN_REQUEST_INVALID',
        message: '升级排空请求无效',
      })
      return true
    }
    await assertEmptyUpdateBody(req, 'LOCAL_UPDATE_DRAIN', '升级排空不接受请求体')
    const status = await options.beginUpdateDrain?.(120_000)
    if (!status) {
      sendLocalUpdateError(res, 503, {
        code: 'LOCAL_UPDATE_DRAIN_UNAVAILABLE',
        message: '升级排空暂不可用',
      })
      return true
    }
    sendLocalUpdateEnvelope(res, status.ready ? 200 : 409, status)
    return true
  }

  if (url.pathname === '/local/update/drain/cancel') {
    if (req.method !== 'POST' || url.search.length > 0) {
      sendLocalUpdateError(res, 400, {
        code: 'LOCAL_UPDATE_DRAIN_REQUEST_INVALID',
        message: '取消升级排空请求无效',
      })
      return true
    }
    await assertEmptyUpdateBody(req, 'LOCAL_UPDATE_DRAIN', '取消升级排空不接受请求体')
    const status = options.cancelUpdateDrain?.()
    if (!status) {
      sendLocalUpdateError(res, 503, {
        code: 'LOCAL_UPDATE_DRAIN_UNAVAILABLE',
        message: '升级排空暂不可用',
      })
      return true
    }
    sendLocalUpdateEnvelope(res, 200, status)
    return true
  }

  if (url.pathname === '/local/update/drain/complete') {
    if (req.method !== 'POST' || url.search.length > 0) {
      sendLocalUpdateError(res, 400, {
        code: 'LOCAL_UPDATE_DRAIN_REQUEST_INVALID',
        message: '完成升级排空请求无效',
      })
      return true
    }
    await assertEmptyUpdateBody(req, 'LOCAL_UPDATE_DRAIN', '完成升级排空不接受请求体')
    const status = options.completeUpdateDrain?.()
    if (!status) {
      sendLocalUpdateError(res, 503, {
        code: 'LOCAL_UPDATE_DRAIN_UNAVAILABLE',
        message: '升级排空暂不可用',
      })
      return true
    }
    if (status.acceptingClaims !== true) {
      sendLocalUpdateError(res, 409, {
        code: 'LOCAL_UPDATE_MAINTENANCE_CLEAR_FAILED',
        message: '升级维护状态未能安全清除，终端保持暂停领取',
      })
      return true
    }
    sendLocalUpdateEnvelope(res, 200, status)
    return true
  }

  if (url.pathname === '/local/update/health') {
    if (req.method !== 'GET' || url.search.length > 0) {
      sendLocalUpdateError(res, 400, {
        code: 'LOCAL_UPDATE_HEALTH_REQUEST_INVALID',
        message: '升级健康检查请求无效',
      })
      return true
    }
    const panelStatus = options.getPanelStatus?.()
    if (!panelStatus) {
      sendLocalUpdateError(res, 503, {
        code: 'LOCAL_UPDATE_HEALTH_UNAVAILABLE',
        message: '升级健康状态暂不可用',
      })
      return true
    }
    const status: LocalUpdateHealthStatus = {
      runtimeVersion: panelStatus.runtimeVersion,
      cloudConnected: panelStatus.cloudConnected,
      localTaskDatabaseAvailable: panelStatus.localTaskDatabaseAvailable,
      credentialStatus: panelStatus.credentialStatus,
    }
    sendLocalUpdateEnvelope(res, 200, status)
    return true
  }

  sendLocalUpdateError(res, 404, {
    code: 'LOCAL_UPDATE_NOT_FOUND',
    message: '本机升级控制接口不存在',
  })
  return true
}

export function sendLocalUpdateError(
  res: ServerResponse,
  status: number,
  error: LocalApiError,
): void {
  writeLoopbackJson(res, status, { success: false, error })
}

function sendLocalUpdateEnvelope<T>(res: ServerResponse, status: number, data: T): void {
  writeLoopbackJson(res, status, { success: true, data })
}

function writeLoopbackJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

async function assertEmptyUpdateBody(
  req: IncomingMessage,
  prefix: string,
  message: string,
): Promise<void> {
  let bytes = 0
  for await (const chunk of req) {
    bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk))
    if (bytes > MAX_BODY_BYTES) {
      throw {
        status: 413,
        error: { code: `${prefix}_BODY_TOO_LARGE`, message: '请求体过大' },
      }
    }
  }
  if (bytes > 0) {
    throw { status: 400, error: { code: `${prefix}_BODY_NOT_ALLOWED`, message } }
  }
}

function isUpdateControlTokenValid(
  headerValue: string | string[] | undefined,
  configuredToken: string | undefined,
): boolean {
  if (!isValidLocalUpdateControlToken(configuredToken)) return false
  return isLocalBridgeTokenValid(headerValue, configuredToken)
}
