import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AgentConfig } from '../src/agent/types'
import { startQrLoginLocalServer } from '../src/local-api/qr-login-server'

const ALLOWED_ORIGIN = 'https://kiosk.example.test'
const DENIED_ORIGIN = 'https://not-kiosk.example.test'
const BRIDGE_TOKEN = 'bridge-token-for-local-print-wake-verify'

async function requestJson<T>(
  url: string,
  options: {
    method?: string
    origin?: string | null
    bridgeToken?: string | null
    body?: string
  } = {},
): Promise<{ status: number; json: T; headers: Headers }> {
  const origin = options.origin === undefined ? ALLOWED_ORIGIN : options.origin
  const bridgeToken = options.bridgeToken === undefined ? BRIDGE_TOKEN : options.bridgeToken
  const headers: Record<string, string> = {}
  if (origin) headers['Origin'] = origin
  if (bridgeToken) headers['X-Local-Bridge-Token'] = bridgeToken
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(url, {
    method: options.method ?? 'POST',
    headers,
    ...(options.body !== undefined ? { body: options.body } : {}),
  })
  return {
    status: response.status,
    json: (await response.json()) as T,
    headers: response.headers,
  }
}

async function main(): Promise<void> {
  const config: AgentConfig = {
    apiBaseUrl: 'http://127.0.0.1:1/api/v1',
    terminalCode: 'T-PRINT-WAKE-VERIFY',
    printerName: 'Configured Test Printer',
    agentVersion: 'verify',
    terminalId: 'terminal-print-wake-verify',
    agentToken: 'agent-token-not-used-by-local-wake',
    localApiPort: 0,
    localApiAllowedOrigins: [ALLOWED_ORIGIN],
    localApiBridgeToken: BRIDGE_TOKEN,
  }

  let wakeCalls = 0
  let wakeAccepted = true
  const handle = startQrLoginLocalServer(config, {
    wakePrintQueue: () => {
      wakeCalls += 1
      return { accepted: wakeAccepted, coalesced: wakeCalls > 1 }
    },
  })
  assert.ok(handle)
  if (!handle.server.listening) await once(handle.server, 'listening')
  const address = handle.server.address()
  assert.ok(typeof address === 'object' && address)
  assert.equal(address.address, '127.0.0.1')
  const wakeUrl = `http://127.0.0.1:${address.port}/local/print/wake`
  const sessionUrl = `http://127.0.0.1:${address.port}/local/bridge/session`

  try {
    const deniedOrigin = await requestJson<{ error: { code: string } }>(wakeUrl, {
      origin: DENIED_ORIGIN,
    })
    assert.equal(deniedOrigin.status, 403)
    assert.equal(deniedOrigin.json.error.code, 'LOCAL_PRINT_ORIGIN_FORBIDDEN')

    const missingOrigin = await requestJson<{ error: { code: string } }>(wakeUrl, { origin: null })
    assert.equal(missingOrigin.status, 403)
    assert.equal(missingOrigin.json.error.code, 'LOCAL_PRINT_ORIGIN_FORBIDDEN')

    const missingToken = await requestJson<{ error: { code: string } }>(wakeUrl, {
      bridgeToken: null,
    })
    assert.equal(missingToken.status, 403)
    assert.equal(missingToken.json.error.code, 'LOCAL_PRINT_BRIDGE_TOKEN_INVALID')

    const wrongToken = await requestJson<{ error: { code: string } }>(wakeUrl, {
      bridgeToken: 'wrong-token',
    })
    assert.equal(wrongToken.status, 403)
    assert.equal(wrongToken.json.error.code, 'LOCAL_PRINT_BRIDGE_TOKEN_INVALID')

    const wrongMethod = await requestJson<{ error: { code: string } }>(wakeUrl, { method: 'GET' })
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.json.error.code, 'LOCAL_PRINT_METHOD_NOT_ALLOWED')

    const body = await requestJson<{ error: { code: string } }>(wakeUrl, { body: '{}' })
    assert.equal(body.status, 400)
    assert.equal(body.json.error.code, 'LOCAL_PRINT_BODY_NOT_ALLOWED')

    const query = await requestJson<{ error: { code: string } }>(`${wakeUrl}?taskId=forbidden`)
    assert.equal(query.status, 400)
    assert.equal(query.json.error.code, 'LOCAL_PRINT_QUERY_NOT_ALLOWED')

    const preflight = await fetch(wakeUrl, {
      method: 'OPTIONS',
      headers: {
        Origin: ALLOWED_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Private-Network': 'true',
      },
    })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN)
    assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true')

    const first = await requestJson<{
      success: true
      data: { accepted: true; coalesced: boolean }
    }>(wakeUrl)
    assert.equal(first.status, 202)
    assert.deepEqual(first.json.data, { accepted: true, coalesced: false })

    const second = await requestJson<{
      success: true
      data: { accepted: true; coalesced: boolean }
    }>(wakeUrl)
    assert.equal(second.status, 202)
    assert.deepEqual(second.json.data, { accepted: true, coalesced: true })

    const session = await requestJson<{
      success: true
      data: { token: string; expiresInSeconds: number }
    }>(sessionUrl, { bridgeToken: null })
    assert.equal(session.status, 200)
    assert.equal(session.json.data.expiresInSeconds, 300)
    const dynamic = await requestJson<{
      success: true
      data: { accepted: true; coalesced: boolean }
    }>(wakeUrl, { bridgeToken: session.json.data.token })
    assert.equal(dynamic.status, 202)
    assert.deepEqual(dynamic.json.data, { accepted: true, coalesced: true })

    wakeAccepted = false
    const unavailable = await requestJson<{ error: { code: string } }>(wakeUrl)
    assert.equal(unavailable.status, 503)
    assert.equal(unavailable.json.error.code, 'LOCAL_PRINT_WAKE_UNAVAILABLE')
    assert.equal(wakeCalls, 4)
  } finally {
    await handle.close()
  }

  console.log('verify-local-print-wake: ok')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
