import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startQrLoginLocalServer } from '../src/local-api/qr-login-server'
import {
  MAX_USB_FILE_BYTES,
  consumeUsbFile,
  enumerateDriveFiles,
  getUsbStatus,
  refreshUsbFileList,
  resetUsbRegistryForTest,
  type UsbDriveInfo,
} from '../src/usb/usb-files'
import type { AgentConfig } from '../src/agent/types'

// 本脚本分两部分：
//   1. 直接调用 usb-files.ts 的导出函数（注入假驱动根目录），验证枚举白名单 /
//      隐藏文件过滤 / 一次性消费的真实行为——这部分不依赖 Windows，用真实临时
//      目录 + 真实 fixture 文件跑，不是 mock。
//   2. 起真实本地 HTTP 服务 + 后端 stub，验证 /local/usb/* 路由的鉴权、错误码
//      和转发契约——Origin/令牌校验、上传转发、404/410 都是真实 HTTP 请求。
//
// Windows CIM/PowerShell 真实可移动磁盘检测（detectRemovableDrive /
// listHiddenOrSystemNames 的 win32 分支）在 macOS 开发环境无法真实调用，
// 该部分保持"未验证"，需要 Windows 真机验收覆盖，不在本脚本中伪装通过。

const ALLOWED_ORIGIN = 'http://localhost:5173'
const DENIED_ORIGIN = 'http://evil.example'
const BRIDGE_TOKEN = 'bridge-token-abcdefghijklmnopqrstuvwxyz012345'

interface RecordedRequest {
  method: string
  url: string
  authorization?: string
  terminalId?: string
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function startBackendStub(): Promise<{
  baseUrl: string
  records: RecordedRequest[]
  close: () => Promise<void>
}> {
  const records: RecordedRequest[] = []
  const server = http.createServer((req, res) => {
    void (async () => {
      const body = await readBody(req)
      records.push({
        method: req.method ?? '',
        url: req.url ?? '',
        authorization: req.headers.authorization,
        terminalId: req.headers['x-terminal-id'] as string | undefined,
      })

      if (req.method === 'POST' && req.url === '/api/v1/files/kiosk-upload') {
        assert.ok(body.includes('print_doc'), 'multipart body must carry purpose=print_doc')
        assert.ok(body.includes('usb-sample.pdf'), 'multipart body must carry the original filename')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          data: {
            fileId: 'file_usb_1',
            filename: 'usb-sample.pdf',
            sizeBytes: 13,
            mimeType: 'application/pdf',
            sha256: 'deadbeef',
            signedUrl: 'http://localhost:3000/api/v1/files/file_usb_1/content?sig=x',
            signedUrlExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
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

async function callJson<T>(
  url: string,
  method: 'GET' | 'POST',
  opts: { origin?: string; bridgeToken?: string; body?: unknown } = {},
): Promise<{ status: number; json: T }> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.origin) headers['Origin'] = opts.origin
  if (opts.bridgeToken) headers['X-Local-Bridge-Token'] = opts.bridgeToken
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  return { status: response.status, json: (await response.json()) as T }
}

// ── Part 1: usb-files.ts 直接单元验证（真实临时目录，不经 HTTP） ────────────

function verifyUsbFilesUnit(): void {
  const dir = mkdtempSync(join(tmpdir(), 'usb-import-verify-'))
  try {
    writeFileSync(join(dir, 'resume.pdf'), '%PDF-1.4 valid document')
    writeFileSync(join(dir, 'photo.jpg'), Buffer.from([0xff, 0xd8, 0xff]))
    writeFileSync(join(dir, 'notes.txt'), 'unsupported extension, must be filtered out')
    writeFileSync(join(dir, '.hidden-unix.pdf'), 'dotfile must be filtered out')
    writeFileSync(join(dir, '$RECYCLE.BIN.pdf'), 'dollar-prefixed must be filtered out')
    writeFileSync(join(dir, 'secret-hidden.pdf'), 'windows-hidden must be filtered out via provider')
    writeFileSync(join(dir, 'oversized.png'), Buffer.alloc(MAX_USB_FILE_BYTES + 1024, 1))

    // enumerateDriveFiles: 纯 fs 枚举，扩展名白名单 + 命名黑名单，尚未应用隐藏文件过滤
    const raw = enumerateDriveFiles(dir)
    const rawNames = raw.map((f) => f.filename).sort()
    assert.deepEqual(
      rawNames,
      ['photo.jpg', 'resume.pdf', 'secret-hidden.pdf'].sort(),
      'enumerateDriveFiles must keep only whitelisted extensions and drop dotfiles/$-prefixed/oversized/unsupported names',
    )

    // refreshUsbFileList: 注入假驱动 + 假隐藏文件 provider，验证隐藏文件过滤生效、safeId 生成
    const driveProvider = (): UsbDriveInfo => ({ rootPath: dir, label: 'TEST-USB' })
    const hiddenNamesProvider = () => new Set(['secret-hidden.pdf'])
    const listed = refreshUsbFileList(driveProvider, hiddenNamesProvider)
    assert.equal(listed.present, true)
    assert.equal(listed.driveLabel, 'TEST-USB')
    const listedNames = listed.files.map((f) => f.filename).sort()
    assert.deepEqual(listedNames, ['photo.jpg', 'resume.pdf'], 'hidden file must be excluded once flagged by hiddenNamesProvider')
    listed.files.forEach((f) => assert.match(f.safeId, /^[0-9a-f-]{36}$/, 'safeId must be a UUID, never an absolute path'))

    // consumeUsbFile: 一次性消费
    const target = listed.files.find((f) => f.filename === 'resume.pdf')
    assert.ok(target, 'resume.pdf must be present in the listing')
    const consumed = consumeUsbFile(target!.safeId)
    assert.ok(consumed, 'first consume must succeed')
    assert.equal(consumed!.filename, 'resume.pdf')
    assert.equal(consumed!.buffer.toString('utf-8'), '%PDF-1.4 valid document')

    const replay = consumeUsbFile(target!.safeId)
    assert.equal(replay, null, 'safeId must not be reusable after first consume (replay must fail)')

    // refreshUsbFileList 重新枚举必须让旧一轮 safeId 全部失效（哪怕文件本身还在）
    const otherTarget = listed.files.find((f) => f.filename === 'photo.jpg')!
    refreshUsbFileList(driveProvider, hiddenNamesProvider)
    const staleConsume = consumeUsbFile(otherTarget.safeId)
    assert.equal(staleConsume, null, 'safeId from a previous listing snapshot must be invalidated by a fresh refresh')

    // getUsbStatus 轻量查询不触碰注册表
    resetUsbRegistryForTest()
    const listed2 = refreshUsbFileList(driveProvider, hiddenNamesProvider)
    const anyId = listed2.files[0]!.safeId
    const status = getUsbStatus(driveProvider)
    assert.equal(status.present, true)
    assert.equal(status.driveLabel, 'TEST-USB')
    const stillConsumable = consumeUsbFile(anyId)
    assert.ok(stillConsumable, 'getUsbStatus must not invalidate safeIds issued by the prior refresh')

    // 无驱动时的行为
    const noDrive = refreshUsbFileList(() => null)
    assert.deepEqual(noDrive, { present: false, driveLabel: null, files: [] })
    assert.deepEqual(getUsbStatus(() => null), { present: false, driveLabel: null })

    console.log('PASS usb-files.ts unit checks (enumeration whitelist / hidden filter / one-time safeId)')
  } finally {
    resetUsbRegistryForTest()
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── Part 2: 真实本地 HTTP 服务 — 鉴权 + 路由契约 ─────────────────────────────

async function verifyLocalHttpRoutes(): Promise<void> {
  const backend = await startBackendStub()
  const config: AgentConfig = {
    apiBaseUrl: backend.baseUrl,
    terminalCode: 'T-LOCAL-USB',
    printerName: 'Test Printer',
    agentVersion: 'verify',
    terminalId: 'terminal-usb-1',
    agentToken: 'agent-token-secret',
    localApiPort: 0,
    localApiAllowedOrigins: [ALLOWED_ORIGIN],
    localApiBridgeToken: BRIDGE_TOKEN,
  }

  const handle = startQrLoginLocalServer(config)
  assert.ok(handle, 'local server should start with terminal credentials')
  await new Promise((resolve) => setTimeout(resolve, 50))
  const address = handle.server.address()
  assert.ok(typeof address === 'object' && address, 'local server must expose an address')
  const localBase = `http://127.0.0.1:${address.port}`

  try {
    // Origin 校验：错误来源必须 403，且错误码是 USB 专属（不是复用 QR 的错误码）
    const wrongOrigin = await callJson<{ success: false; error: { code: string } }>(
      `${localBase}/local/usb/status`,
      'GET',
      { origin: DENIED_ORIGIN, bridgeToken: BRIDGE_TOKEN },
    )
    assert.equal(wrongOrigin.status, 403)
    assert.equal(wrongOrigin.json.error.code, 'LOCAL_USB_ORIGIN_FORBIDDEN')

    // 令牌校验：来源正确但令牌缺失/错误必须 403
    const missingToken = await callJson<{ success: false; error: { code: string } }>(
      `${localBase}/local/usb/status`,
      'GET',
      { origin: ALLOWED_ORIGIN },
    )
    assert.equal(missingToken.status, 403)
    assert.equal(missingToken.json.error.code, 'LOCAL_USB_BRIDGE_TOKEN_INVALID')

    const wrongToken = await callJson<{ success: false; error: { code: string } }>(
      `${localBase}/local/usb/status`,
      'GET',
      { origin: ALLOWED_ORIGIN, bridgeToken: 'wrong-token-wrong-token-wrong-token-000' },
    )
    assert.equal(wrongToken.status, 403)
    assert.equal(wrongToken.json.error.code, 'LOCAL_USB_BRIDGE_TOKEN_INVALID')

    // status / files：本机（macOS 测试环境）没有真实可移动磁盘，present 必须为 false，
    // 这是真实调用 detectRemovableDrive() 得到的结果，不是伪造的固定返回值。
    const status = await callJson<{ success: true; data: { present: boolean; driveLabel: string | null } }>(
      `${localBase}/local/usb/status`,
      'GET',
      { origin: ALLOWED_ORIGIN, bridgeToken: BRIDGE_TOKEN },
    )
    assert.equal(status.status, 200)
    assert.equal(status.json.data.present, false)

    const files = await callJson<{ success: true; data: { present: boolean; files: unknown[] } }>(
      `${localBase}/local/usb/files`,
      'GET',
      { origin: ALLOWED_ORIGIN, bridgeToken: BRIDGE_TOKEN },
    )
    assert.equal(files.status, 200)
    assert.equal(files.json.data.present, false)
    assert.deepEqual(files.json.data.files, [])

    // upload：safeId 缺失 → 400
    const missingSafeId = await callJson<{ success: false; error: { code: string } }>(
      `${localBase}/local/usb/upload`,
      'POST',
      { origin: ALLOWED_ORIGIN, bridgeToken: BRIDGE_TOKEN, body: {} },
    )
    assert.equal(missingSafeId.status, 400)
    assert.equal(missingSafeId.json.error.code, 'LOCAL_USB_SAFE_ID_REQUIRED')

    // upload：safeId 不存在（未枚举过 / 已用过）→ 410
    const unknownSafeId = await callJson<{ success: false; error: { code: string } }>(
      `${localBase}/local/usb/upload`,
      'POST',
      { origin: ALLOWED_ORIGIN, bridgeToken: BRIDGE_TOKEN, body: { safeId: 'does-not-exist' } },
    )
    assert.equal(unknownSafeId.status, 410)
    assert.equal(unknownSafeId.json.error.code, 'LOCAL_USB_FILE_EXPIRED')

    // upload：真实一次性消费 + 转发到后端 stub 的完整契约。
    // 通过直接调用 refreshUsbFileList 注入假驱动来产生一个真实 safeId（同一进程内
    // 与本地服务共享同一个 usb-files.ts 模块级注册表），再对正式 HTTP 路由发起上传。
    const dir = mkdtempSync(join(tmpdir(), 'usb-import-verify-upload-'))
    try {
      writeFileSync(join(dir, 'usb-sample.pdf'), '%PDF-1.4 sample')
      const listed = refreshUsbFileList(() => ({ rootPath: dir, label: 'UPLOAD-TEST' }), () => new Set())
      const target = listed.files.find((f) => f.filename === 'usb-sample.pdf')
      assert.ok(target, 'fixture file must appear in the injected listing')

      const uploaded = await callJson<{ success: true; data: { fileId: string; fileUrl: string | null } }>(
        `${localBase}/local/usb/upload`,
        'POST',
        { origin: ALLOWED_ORIGIN, bridgeToken: BRIDGE_TOKEN, body: { safeId: target!.safeId } },
      )
      assert.equal(uploaded.status, 200)
      assert.equal(uploaded.json.data.fileId, 'file_usb_1')
      assert.ok(uploaded.json.data.fileUrl, 'upload response must carry a signed content URL for the print flow to reuse')

      const forwarded = backend.records.find((r) => r.url === '/api/v1/files/kiosk-upload')
      assert.ok(forwarded, 'agent must forward the file to /files/kiosk-upload')
      assert.equal(forwarded!.authorization, 'Bearer agent-token-secret')
      assert.equal(forwarded!.terminalId, 'terminal-usb-1')

      // 同一 safeId 二次上传必须 410（一次性消费，不可重放）
      const replay = await callJson<{ success: false; error: { code: string } }>(
        `${localBase}/local/usb/upload`,
        'POST',
        { origin: ALLOWED_ORIGIN, bridgeToken: BRIDGE_TOKEN, body: { safeId: target!.safeId } },
      )
      assert.equal(replay.status, 410)
      assert.equal(replay.json.error.code, 'LOCAL_USB_FILE_EXPIRED')
    } finally {
      resetUsbRegistryForTest()
      rmSync(dir, { recursive: true, force: true })
    }

    console.log('PASS local /local/usb/* HTTP route checks (origin / bridge token / upload forwarding / one-time consume)')
  } finally {
    await handle.close()
    await backend.close()
  }
}

// ── 未覆盖事项声明（不得静默假装已验证） ─────────────────────────────────────

function verifyPlatformGapDisclosure(): void {
  console.log(
    'NOTE: detectRemovableDrive()/listHiddenOrSystemNames() Windows CIM/PowerShell 分支未在本脚本中真实调用' +
      '（当前运行环境非 win32）。真实可移动磁盘检测、Windows 隐藏/系统属性判定，需 Windows 真机验收覆盖，' +
      '不得据本脚本通过就宣称 U 盘导入已完成真机验证。',
  )
}

async function main(): Promise<void> {
  verifyUsbFilesUnit()
  await verifyLocalHttpRoutes()
  verifyPlatformGapDisclosure()
  console.log('verify-usb-import-agent: ok')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
