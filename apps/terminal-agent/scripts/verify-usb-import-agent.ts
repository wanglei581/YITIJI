import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
        const contentType = req.headers['content-type'] ?? ''
        assert.match(String(contentType), /^multipart\/form-data; boundary=/, 'forwarded upload must be multipart with a boundary')
        const text = body.toString('utf-8')
        assert.ok(text.includes('name="file"'), 'multipart body must carry the file field under name="file"')
        assert.ok(text.includes('filename="usb-sample.pdf"'), 'multipart body must carry the original filename')
        assert.ok(text.includes('Content-Type: application/pdf'), 'multipart file part must declare the guessed mime type')
        assert.ok(text.includes('%PDF-1.4 sample'), 'multipart body must carry the real file bytes')
        assert.ok(text.includes('name="purpose"') && text.includes('print_doc'), 'multipart body must carry purpose=print_doc')
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

async function verifyUsbFilesUnit(): Promise<void> {
  // 大小上限必须独立断言为后端 kiosk-upload 实际生效值（proxy 模式 PROXY_MAX_BYTES=15MB），
  // 不能只用实现导出的常量自证：实现改错成 20MB/30MB 时这里必须失败。
  assert.equal(MAX_USB_FILE_BYTES, 15 * 1024 * 1024, 'USB size cap must match backend kiosk-upload proxy limit (15MB)')

  const dir = mkdtempSync(join(tmpdir(), 'usb-import-verify-'))
  try {
    writeFileSync(join(dir, 'resume.pdf'), '%PDF-1.4 valid document')
    writeFileSync(join(dir, 'photo.jpg'), Buffer.from([0xff, 0xd8, 0xff]))
    writeFileSync(join(dir, 'notes.txt'), 'unsupported extension, must be filtered out')
    writeFileSync(join(dir, '.hidden-unix.pdf'), 'dotfile must be filtered out')
    writeFileSync(join(dir, '$RECYCLE.BIN.pdf'), 'dollar-prefixed must be filtered out')
    writeFileSync(join(dir, 'secret-hidden.pdf'), 'windows-hidden must be filtered out via provider')
    writeFileSync(join(dir, 'oversized.png'), Buffer.alloc(MAX_USB_FILE_BYTES + 1024, 1))
    // 符号链接指向盘外文件:枚举必须拒绝(lstat 非常规文件),防链接把读取导向 U 盘外
    const outsideTarget = join(tmpdir(), 'usb-import-verify-outside.pdf')
    writeFileSync(outsideTarget, '%PDF-1.4 outside the drive')
    symlinkSync(outsideTarget, join(dir, 'link-escape.pdf'))

    // enumerateDriveFiles: 纯 fs 枚举，扩展名白名单 + 命名黑名单，尚未应用隐藏文件过滤
    const raw = enumerateDriveFiles(dir)
    const rawNames = raw.map((f) => f.filename).sort()
    assert.deepEqual(
      rawNames,
      ['photo.jpg', 'resume.pdf', 'secret-hidden.pdf'].sort(),
      'enumerateDriveFiles must keep only whitelisted extensions and drop dotfiles/$-prefixed/oversized/unsupported/symlink names',
    )

    // refreshUsbFileList: 注入假驱动 + 假隐藏文件 provider，验证隐藏文件过滤生效、safeId 生成
    const driveProvider = (): UsbDriveInfo => ({ rootPath: dir, label: 'TEST-USB' })
    const hiddenNamesProvider = () => new Set(['secret-hidden.pdf'])
    const listed = await refreshUsbFileList(driveProvider, hiddenNamesProvider)
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

    // 枚举与读取之间文件被替换（大小变化）:消费必须拒绝
    const swapped = listed.files.find((f) => f.filename === 'photo.jpg')
    assert.ok(swapped, 'photo.jpg must be present in the listing')
    writeFileSync(join(dir, 'photo.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]))
    const swappedConsume = consumeUsbFile(swapped!.safeId)
    assert.equal(swappedConsume, null, 'consume must reject a file whose size changed since enumeration')

    // refreshUsbFileList 重新枚举必须让旧一轮 safeId 全部失效（哪怕文件本身还在）
    const listedAgain = await refreshUsbFileList(driveProvider, hiddenNamesProvider)
    const otherTarget = listedAgain.files.find((f) => f.filename === 'photo.jpg')!
    await refreshUsbFileList(driveProvider, hiddenNamesProvider)
    const staleConsume = consumeUsbFile(otherTarget.safeId)
    assert.equal(staleConsume, null, 'safeId from a previous listing snapshot must be invalidated by a fresh refresh')

    // getUsbStatus 轻量查询不触碰注册表
    resetUsbRegistryForTest()
    const listed2 = await refreshUsbFileList(driveProvider, hiddenNamesProvider)
    const anyId = listed2.files[0]!.safeId
    const status = await getUsbStatus(driveProvider)
    assert.equal(status.present, true)
    assert.equal(status.driveLabel, 'TEST-USB')
    const stillConsumable = consumeUsbFile(anyId)
    assert.ok(stillConsumable, 'getUsbStatus must not invalidate safeIds issued by the prior refresh')

    // 无驱动时的行为
    const noDrive = await refreshUsbFileList(() => null)
    assert.deepEqual(noDrive, { present: false, driveLabel: null, files: [] })
    assert.deepEqual(await getUsbStatus(() => null), { present: false, driveLabel: null })

    console.log('PASS usb-files.ts unit checks (enumeration whitelist / hidden filter / one-time safeId / size re-check)')
  } finally {
    resetUsbRegistryForTest()
    rmSync(dir, { recursive: true, force: true })
    rmSync(join(tmpdir(), 'usb-import-verify-outside.pdf'), { force: true })
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

    // upload：JSON 非法 → 400 且错误码是 USB 专属（不是复用 QR 的 LOCAL_QR_BAD_JSON）
    const badJsonResponse = await fetch(`${localBase}/local/usb/upload`, {
      method: 'POST',
      headers: {
        Origin: ALLOWED_ORIGIN,
        'X-Local-Bridge-Token': BRIDGE_TOKEN,
        'Content-Type': 'application/json',
      },
      body: '{not-json',
    })
    assert.equal(badJsonResponse.status, 400)
    const badJson = (await badJsonResponse.json()) as { error: { code: string } }
    assert.equal(badJson.error.code, 'LOCAL_USB_BAD_JSON')

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
      const listed = await refreshUsbFileList(() => ({ rootPath: dir, label: 'UPLOAD-TEST' }), () => new Set())
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

// ── Part 3: Agent 侧未配置令牌 → 整个 /local/usb/* 分支 fail-closed ──────────
// （Part 2 只测了客户端漏传/传错 header；这里测服务端根本没配置令牌的实例，
//   即使客户端带上"正确"的令牌也必须 403，且 QR 路由不受影响。）

async function verifyUnconfiguredTokenFailClosed(): Promise<void> {
  const backend = await startBackendStub()
  const config: AgentConfig = {
    apiBaseUrl: backend.baseUrl,
    terminalCode: 'T-LOCAL-USB-NOTOKEN',
    printerName: 'Test Printer',
    agentVersion: 'verify',
    terminalId: 'terminal-usb-2',
    agentToken: 'agent-token-secret',
    localApiPort: 0,
    localApiAllowedOrigins: [ALLOWED_ORIGIN],
    // localApiBridgeToken 故意不配置
  }

  const handle = startQrLoginLocalServer(config)
  assert.ok(handle, 'local server should start even without a bridge token')
  await new Promise((resolve) => setTimeout(resolve, 50))
  const address = handle.server.address()
  assert.ok(typeof address === 'object' && address, 'local server must expose an address')
  const localBase = `http://127.0.0.1:${address.port}`

  try {
    const denied = await callJson<{ success: false; error: { code: string } }>(
      `${localBase}/local/usb/status`,
      'GET',
      { origin: ALLOWED_ORIGIN, bridgeToken: BRIDGE_TOKEN },
    )
    assert.equal(denied.status, 403, 'unconfigured bridge token must fail closed even with a client-side token')
    assert.equal(denied.json.error.code, 'LOCAL_USB_BRIDGE_TOKEN_INVALID')

    // QR 路由不受未配置 USB 令牌影响（错误码属于 QR 分支自身逻辑，而非被 403 挡下）
    const qr = await callJson<{ success: false; error: { code: string } }>(
      `${localBase}/local/qr-login/create`,
      'POST',
      { origin: ALLOWED_ORIGIN, body: {} },
    )
    assert.notEqual(qr.json.error?.code, 'LOCAL_USB_BRIDGE_TOKEN_INVALID', 'QR routes must not be gated by the USB bridge token')

    console.log('PASS unconfigured-token instance fail-closed checks (server-side missing token → 403, QR unaffected)')
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
  await verifyUsbFilesUnit()
  await verifyLocalHttpRoutes()
  await verifyUnconfiguredTokenFailClosed()
  verifyPlatformGapDisclosure()
  console.log('verify-usb-import-agent: ok')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
