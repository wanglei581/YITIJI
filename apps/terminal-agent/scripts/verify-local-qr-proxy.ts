import assert from 'node:assert/strict'
import http from 'node:http'
import { startQrLoginLocalServer } from '../src/local-api/qr-login-server'
import { allowedOrigins } from '../src/local-api/origin-guard'
import type { AgentConfig } from '../src/agent/types'

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
    agentVersion: 'verify',
    terminalId: 'terminal-qr-1',
    agentToken: 'agent-token-secret',
    localApiPort: 0,
    localApiAllowedOrigins: [ALLOWED_ORIGIN],
    localApiBridgeToken: BRIDGE_TOKEN,
  }

  const handle = startQrLoginLocalServer(config)
  assert.ok(handle, 'local QR server should start with terminal credentials')
  await new Promise((resolve) => setTimeout(resolve, 50))
  const address = handle.server.address()
  assert.ok(typeof address === 'object' && address, 'local QR server must expose an address')
  const localBase = `http://127.0.0.1:${address.port}`

  try {
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

// Agent 侧未配置令牌 → 整个 /local/qr-login/* 分支 fail-closed，
// 即使客户端带上"正确"的令牌也必须 403（对齐 verify-usb-import-agent.ts Part 3）。
async function verifyUnconfiguredTokenFailClosed(): Promise<void> {
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
  const localBase = `http://127.0.0.1:${address.port}`

  try {
    const denied = await postJson<{ success: false; error: { code: string } }>(
      `${localBase}/local/qr-login/create`,
      { returnTo: '/me' },
      { bridgeToken: BRIDGE_TOKEN },
    )
    assert.equal(denied.status, 403, 'unconfigured bridge token must fail closed even with a client-side token')
    assert.equal(denied.json.error.code, 'LOCAL_QR_BRIDGE_TOKEN_INVALID')

    console.log('verify-local-qr-proxy: unconfigured-token instance fail-closed ok')
  } finally {
    await handle.close()
    await backend.close()
  }
}

main()
  .then(() => verifyUnconfiguredTokenFailClosed())
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
