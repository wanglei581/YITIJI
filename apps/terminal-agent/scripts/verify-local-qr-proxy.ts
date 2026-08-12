import assert from 'node:assert/strict'
import http from 'node:http'
import { startQrLoginLocalServer } from '../src/local-api/qr-login-server'
import { allowedOrigins } from '../src/local-api/origin-guard'
import type { AgentConfig } from '../src/agent/types'
import { sendHeartbeat } from '../src/agent/heartbeat'
import { AGENT_RUNTIME_VERSION } from '../src/runtime-version'

const ALLOWED_ORIGIN = 'http://localhost:5173'
const DENIED_ORIGIN = 'http://evil.example'
const TICKET_ID = 'qrtest_abcdefghijklmnopqrstuvwxyz012345'
const CLAIM_TOKEN = 'claim_token_abcdefghijklmnopqrstuvwxyz012345'
const BRIDGE_TOKEN = 'bridge-token-abcdefghijklmnopqrstuvwxyz012345'
const WRONG_BRIDGE_TOKEN = 'wrong-token-wrong-token-wrong-token-000'

interface RecordedRequest {
  method: string
  url: string
  authorization?: string
  terminalId?: string
  body: unknown
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as unknown)
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

async function startBackendStub(): Promise<{ baseUrl: string; records: RecordedRequest[]; close: () => Promise<void> }> {
  const records: RecordedRequest[] = []
  const server = http.createServer((req, res) => {
    void (async () => {
      const body = await readBody(req)
      records.push({
        method: req.method ?? '',
        url: req.url ?? '',
        authorization: req.headers.authorization,
        terminalId: req.headers['x-terminal-id'] as string | undefined,
        body,
      })

      if (req.method === 'POST' && req.url === '/api/v1/member/auth/qr/create') {
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          data: {
            ticketId: TICKET_ID,
            claimToken: CLAIM_TOKEN,
            qrUrl: `/member/qr-login?ticketId=${encodeURIComponent(TICKET_ID)}`,
            expiresInSeconds: 180,
          },
        }))
        return
      }

      if (req.method === 'POST' && req.url === `/api/v1/member/auth/qr/${encodeURIComponent(TICKET_ID)}/claim`) {
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          data: {
            token: 'member-token-from-backend',
            user: { id: 'user-1', phoneMasked: '138****1234', nickname: null },
          },
        }))
        return
      }

      if (req.method === 'PUT' && req.url === '/api/v1/terminals/terminal-qr-1/heartbeat') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ acknowledged: true }))
        return
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'not found' } }))
    })().catch((error) => {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, error: { code: 'STUB_ERROR', message: String(error) } }))
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(typeof address === 'object' && address, 'backend stub must bind to a TCP port')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/v1`,
    records,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

async function postJson<T>(
  url: string,
  body: unknown,
  opts: { origin?: string; bridgeToken?: string | null } = {},
): Promise<{ status: number; json: T }> {
  const origin = opts.origin ?? ALLOWED_ORIGIN
  // undefined → 默认合法令牌(多数用例走happy path);显式传 null 才是"不带令牌"。
  const bridgeToken = opts.bridgeToken === undefined ? BRIDGE_TOKEN : opts.bridgeToken
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: origin }
  if (bridgeToken) headers['X-Local-Bridge-Token'] = bridgeToken
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: response.status, json: (await response.json()) as T }
}

async function getJson<T>(
  url: string,
  origin = ALLOWED_ORIGIN,
): Promise<{ status: number; json: T; headers: Headers }> {
  const response = await fetch(url, { method: 'GET', headers: { Origin: origin } })
  return {
    status: response.status,
    json: (await response.json()) as T,
    headers: response.headers,
  }
}

async function preflight(url: string, origin = ALLOWED_ORIGIN): Promise<Response> {
  return fetch(url, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Private-Network': 'true',
    },
  })
}

async function main(): Promise<void> {
  assert.deepEqual(allowedOrigins(), [], 'local QR proxy must not allow dev origins unless explicitly configured')

  const backend = await startBackendStub()
  const config: AgentConfig = {
    apiBaseUrl: backend.baseUrl,
    terminalCode: 'T-LOCAL-QR',
    printerName: 'Test Printer',
    agentVersion: 'legacy-config-version',
    terminalId: 'terminal-qr-1',
    agentToken: 'agent-token-secret',
    localApiPort: 0,
    localApiAllowedOrigins: [ALLOWED_ORIGIN],
    localApiBridgeToken: BRIDGE_TOKEN,
  }

  const localServerOptions: NonNullable<Parameters<typeof startQrLoginLocalServer>[1]> = {
    getPanelStatus: () => ({
      runtimeVersion: '0.4.4',
      terminalCode: `${config.terminalCode}<script>alert(1)</script>`,
      serviceState: 'running',
      cloudConnected: true,
      lastHeartbeatAt: '2026-08-10T13:51:05.434Z',
      printerStatus: 'ready',
      localTaskDatabaseAvailable: true,
      scanInputStatus: 'ready',
      scanInputReason: 'ready',
      credentialStatus: 'ready',
    }),
  }
  const handle = startQrLoginLocalServer(config, localServerOptions)
  assert.ok(handle, 'local QR server should start with terminal credentials')
  await new Promise((resolve) => setTimeout(resolve, 50))
  const address = handle.server.address()
  assert.ok(typeof address === 'object' && address, 'local QR server must expose an address')
  assert.equal(address.address, '127.0.0.1', 'local API must bind only to IPv4 loopback')
  const localBase = `http://127.0.0.1:${address.port}`

  try {
    const panel = await fetch(`${localBase}/local/panel`)
    const panelHtml = await panel.text()
    assert.equal(panel.status, 200, 'local status panel must allow a top-level loopback GET without Origin')
    assert.match(panel.headers.get('content-type') ?? '', /^text\/html; charset=utf-8$/i)
    assert.equal(panel.headers.get('cache-control'), 'no-store')
    assert.equal(panel.headers.get('x-frame-options'), 'DENY')
    assert.equal(panel.headers.get('referrer-policy'), 'no-referrer')
    assert.match(panel.headers.get('content-security-policy') ?? '', /default-src 'none'/)
    for (const expected of [
      'AI Job Print Terminal',
      '0.4.4',
      'T-LOCAL-QR',
      '&lt;script&gt;alert(1)&lt;/script&gt;',
      '后台服务运行中',
    ]) {
      assert.ok(panelHtml.includes(expected), `local panel must render ${expected}`)
    }
    for (const secret of [
      config.agentToken!,
      config.terminalId!,
      config.apiBaseUrl,
      config.printerName,
      'claim_token_',
    ]) {
      assert.ok(!panelHtml.includes(secret), `local panel must not expose ${secret}`)
    }
    assert.ok(!panelHtml.includes('<script>alert(1)</script>'), 'local panel must escape dynamic text')

    const panelMutation = await fetch(`${localBase}/local/panel`, { method: 'POST' })
    assert.equal(panelMutation.status, 405, 'local panel must remain read-only')

    assert.equal(AGENT_RUNTIME_VERSION, '0.4.4', 'runtime version must come from the deployed package')
    assert.equal(await sendHeartbeat({ config }), true, 'heartbeat fixture must be acknowledged')
    const heartbeatRecord = backend.records.find((record) => record.url.endsWith('/heartbeat'))
    assert.ok(heartbeatRecord, 'heartbeat request should be recorded')
    assert.equal(
      (heartbeatRecord.body as { agentVersion?: string }).agentVersion,
      AGENT_RUNTIME_VERSION,
      'heartbeat must report the immutable runtime package version',
    )
    assert.notEqual(
      (heartbeatRecord.body as { agentVersion?: string }).agentVersion,
      config.agentVersion,
      'preserved legacy config must not overwrite the upgraded runtime version',
    )

    const deniedIdentity = await getJson<{ success: false; error: { code: string } }>(
      `${localBase}/local/terminal-identity`,
      DENIED_ORIGIN,
    )
    assert.equal(deniedIdentity.status, 403, 'terminal identity must reject a non-allowlisted Origin')
    assert.equal(deniedIdentity.json.error.code, 'LOCAL_QR_ORIGIN_FORBIDDEN')

    const identity = await getJson<{
      success: true
      data: Record<string, unknown>
    }>(`${localBase}/local/terminal-identity`)
    assert.equal(identity.status, 200, 'allowlisted Kiosk may read its local terminal identity')
    assert.equal(identity.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN)
    assert.deepEqual(Object.keys(identity.json.data).sort(), ['terminalCode', 'terminalId'])
    assert.deepEqual(identity.json.data, {
      terminalId: 'terminal-qr-1',
      terminalCode: 'T-LOCAL-QR',
    })

    const denied = await postJson<{ success: false; error: { code: string } }>(
      `${localBase}/local/qr-login/create`,
      { returnTo: '/me' },
      { origin: DENIED_ORIGIN },
    )
    assert.equal(denied.status, 403, 'wrong Origin must be rejected')
    assert.equal(denied.json.error.code, 'LOCAL_QR_ORIGIN_FORBIDDEN')

    const missingToken = await postJson<{ success: false; error: { code: string } }>(
      `${localBase}/local/qr-login/create`,
      { returnTo: '/me' },
      { bridgeToken: null },
    )
    assert.equal(missingToken.status, 403, 'missing bridge token must be rejected')
    assert.equal(missingToken.json.error.code, 'LOCAL_QR_BRIDGE_TOKEN_INVALID')

    const wrongToken = await postJson<{ success: false; error: { code: string } }>(
      `${localBase}/local/qr-login/create`,
      { returnTo: '/me' },
      { bridgeToken: WRONG_BRIDGE_TOKEN },
    )
    assert.equal(wrongToken.status, 403, 'wrong bridge token must be rejected')
    assert.equal(wrongToken.json.error.code, 'LOCAL_QR_BRIDGE_TOKEN_INVALID')

    const options = await preflight(`${localBase}/local/qr-login/create`)
    assert.equal(options.status, 204)
    assert.equal(options.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN)
    assert.equal(options.headers.get('access-control-allow-private-network'), 'true')

    const nullBody = await postJson<{ success: false; error: { code: string } }>(
      `${localBase}/local/qr-login/create`,
      null,
    )
    assert.equal(nullBody.status, 400)
    assert.equal(nullBody.json.error.code, 'LOCAL_QR_BAD_JSON')

    const arrayBody = await postJson<{ success: false; error: { code: string } }>(
      `${localBase}/local/qr-login/claim`,
      [],
    )
    assert.equal(arrayBody.status, 400)
    assert.equal(arrayBody.json.error.code, 'LOCAL_QR_BAD_JSON')

    const create = await postJson<{ success: true; data: { ticketId: string; qrUrl: string; expiresInSeconds: number }; claimToken?: string }>(
      `${localBase}/local/qr-login/create`,
      { deviceId: 'kiosk-browser', deviceLabel: '测试一体机', returnTo: '/me' },
    )
    assert.equal(create.status, 200)
    assert.equal(create.json.data.ticketId, TICKET_ID)
    assert.equal(create.json.data.expiresInSeconds, 180)
    assert.equal(create.json.data.qrUrl, `/member/qr-login?ticketId=${encodeURIComponent(TICKET_ID)}`)
    assert.equal(create.json.claimToken, undefined, 'local create response must not expose claimToken')

    const createRecord = backend.records.find((record) => record.url === '/api/v1/member/auth/qr/create')
    assert.ok(createRecord, 'backend create request should be recorded')
    assert.equal(createRecord.authorization, 'Bearer agent-token-secret')
    assert.equal(createRecord.terminalId, 'terminal-qr-1')

    const claim = await postJson<{ success: true; data: { token: string; user: { phoneMasked: string } } }>(
      `${localBase}/local/qr-login/claim`,
      { ticketId: TICKET_ID },
    )
    assert.equal(claim.status, 200)
    assert.equal(claim.json.data.token, 'member-token-from-backend')
    assert.equal(claim.json.data.user.phoneMasked, '138****1234')

    const claimRecord = backend.records.find((record) => record.url.includes('/claim'))
    assert.ok(claimRecord, 'backend claim request should be recorded')
    assert.deepEqual(claimRecord.body, { claimToken: CLAIM_TOKEN })
    assert.equal(claimRecord.authorization, 'Bearer agent-token-secret')
    assert.equal(claimRecord.terminalId, 'terminal-qr-1')

    const replay = await postJson<{ success: false; error: { code: string } }>(
      `${localBase}/local/qr-login/claim`,
      { ticketId: TICKET_ID },
    )
    assert.equal(replay.status, 410)
    assert.equal(replay.json.error.code, 'LOCAL_QR_CLAIM_MISSING')

    console.log('verify-local-qr-proxy: ok')
  } finally {
    await handle.close()
    await backend.close()
  }
}

// 新安装不需要在 MSI 中携带静态令牌：白名单 Origin 先领取短时本机会话，
// 再访问受保护路由；任意客户端自带的静态令牌仍必须 fail-closed。
async function verifyDynamicBridgeSession(): Promise<void> {
  const backend = await startBackendStub()
  const config: AgentConfig = {
    apiBaseUrl: backend.baseUrl,
    terminalCode: 'T-LOCAL-QR-NOTOKEN',
    printerName: 'Test Printer',
    agentVersion: 'verify',
    terminalId: 'terminal-qr-2',
    agentToken: 'agent-token-secret',
    localApiPort: 0,
    localApiAllowedOrigins: [ALLOWED_ORIGIN],
    // localApiBridgeToken 故意不配置
  }

  const handle = startQrLoginLocalServer(config)
  assert.ok(handle, 'local QR server should start even without a bridge token')
  await new Promise((resolve) => setTimeout(resolve, 50))
  const address = handle.server.address()
  assert.ok(typeof address === 'object' && address, 'local QR server must expose an address')
  assert.equal(address.address, '127.0.0.1', 'unconfigured-token local API must remain loopback-only')
  const localBase = `http://127.0.0.1:${address.port}`

  try {
    const identity = await getJson<{ success: true; data: { terminalId: string; terminalCode: string } }>(
      `${localBase}/local/terminal-identity`,
    )
    assert.equal(identity.status, 200, 'read-only identity does not depend on the optional bridge token')
    assert.deepEqual(identity.json.data, {
      terminalId: 'terminal-qr-2',
      terminalCode: 'T-LOCAL-QR-NOTOKEN',
    })

    const denied = await postJson<{ success: false; error: { code: string } }>(
      `${localBase}/local/qr-login/create`,
      { returnTo: '/me' },
      { bridgeToken: BRIDGE_TOKEN },
    )
    assert.equal(denied.status, 403, 'unconfigured bridge token must fail closed even with a client-side token')
    assert.equal(denied.json.error.code, 'LOCAL_QR_BRIDGE_TOKEN_INVALID')

    const deniedSession = await fetch(`${localBase}/local/bridge/session`, {
      method: 'POST',
      headers: { Origin: DENIED_ORIGIN },
    })
    assert.equal(deniedSession.status, 403, 'non-allowlisted Origin must not obtain a local session')

    const sessionResponse = await fetch(`${localBase}/local/bridge/session`, {
      method: 'POST',
      headers: { Origin: ALLOWED_ORIGIN },
    })
    assert.equal(sessionResponse.status, 200, 'allowlisted Origin may obtain a short-lived local session')
    const sessionEnvelope = await sessionResponse.json() as {
      success: true
      data: { token: string; expiresInSeconds: number }
    }
    assert.match(sessionEnvelope.data.token, /^[A-Za-z0-9_-]{40,}$/)
    assert.equal(sessionEnvelope.data.expiresInSeconds, 300)

    const created = await postJson<{ success: true; data: { ticketId: string } }>(
      `${localBase}/local/qr-login/create`,
      { returnTo: '/me' },
      { bridgeToken: sessionEnvelope.data.token },
    )
    assert.equal(created.status, 200, 'dynamic local session must authorize QR ticket creation')
    assert.equal(created.json.data.ticketId, TICKET_ID)

    console.log('verify-local-qr-proxy: dynamic Origin-bound bridge session ok')
  } finally {
    await handle.close()
    await backend.close()
  }
}

main()
  .then(() => verifyDynamicBridgeSession())
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
