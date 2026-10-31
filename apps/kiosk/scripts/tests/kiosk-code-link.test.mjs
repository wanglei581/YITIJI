/**
 * 一体机手机码改短链（2026-10-29）：出码地址与场景码兑换。
 * 转译真源码来跑；node 里装不起来的依赖（client 的 import.meta.env、httpAdapter、会员会话事件）换成替身。
 *
 * 钉四件事：
 * - 上传码：回执带合格场景码 → <公网域名>/k/u/<场景码>，码里不再有会话号与上传令牌；没带或格式不对 → 照旧长链。
 * - 登录码：qrUrl 里取得到合格票据 → <公网基址>/k/l/<票据>；取不到 → 照旧。
 * - 兑换：POST /upload-sessions/scene/resolve {scene}，不带会员令牌；同一场景码同时只发一次，结束后可再发。
 * - 失效码 UPLOAD_SCENE_UNUSABLE 与原有失效句同一句。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const ENV = '__kioskCodeLinkEnv'

function transpile(relativePath, replacements) {
  const absolutePath = join(kioskRoot, relativePath)
  let out = ts.transpileModule(readFileSync(absolutePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: absolutePath,
  }).outputText.replaceAll('import.meta.env', `globalThis.${ENV}`)
  for (const [specifier, url] of Object.entries(replacements)) {
    out = out.split(`'${specifier}'`).join(`'${url}'`).split(`"${specifier}"`).join(`"${url}"`)
  }
  const leftover = [...out.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]).filter((s) => !s.startsWith('data:'))
  assert.deepEqual(leftover, [], `${relativePath} 还有没替换的运行时依赖：${leftover.join(', ')}`)
  return toDataUrl(out)
}

globalThis[ENV] = {}
globalThis.window = { location: { origin: 'https://kiosk.local' } }

const clientStub = toDataUrl('export const API_BASE_URL = "/api/v1"')
const httpStub = toDataUrl(`export class ApiHttpError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; this.name = 'ApiHttpError' }
}`)
const memberEventsStub = toDataUrl('export const isMemberSessionInvalidError = () => false; export const notifyMemberSessionExpired = () => {}')
const memberAuthStub = toDataUrl(`export class MemberApiError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status }
}`)

const { ApiHttpError } = await import(httpStub)
const uploads = await import(transpile('src/services/api/uploadSessions.ts', {
  '../auth/memberSessionEvents': memberEventsStub,
  './client': clientStub,
  './httpAdapter': httpStub,
}))
const qrLogin = await import(transpile('src/services/auth/memberQrLoginApi.ts', {
  '../api/client': clientStub,
  './memberAuthApi': memberAuthStub,
}))

const SCENE = 'SNtynYMXmy7P4MSNE8uMi-yL'
const SESSION_ID = '3b11df71204546f987edf95409cefa49'
const UPLOAD_TOKEN = 'uT0kEn_uT0kEn_uT0kEn_uT0kEn_uT0kEn_uT0kEn_0'
const TICKET = 'Tk3_ticket-0123456789abcdefghijk'
const created = (sceneToken) => ({
  sessionId: SESSION_ID,
  uploadUrl: 'https://zhiyida.example.cn/upload/phone',
  uploadToken: UPLOAD_TOKEN,
  controlToken: 'control-token-never-in-qr',
  expiresAt: '2099-01-01T00:00:00.000Z',
  ...(sceneToken === undefined ? {} : { sceneToken }),
})

test('上传码：合格场景码出 /k/u/<场景码>，域名取回执 uploadUrl，码里没有会话号与令牌', () => {
  const url = uploads.buildPhoneUploadQrUrl(created(SCENE), 'print_doc')
  assert.equal(url, `https://zhiyida.example.cn/k/u/${SCENE}`)
  for (const secret of [SESSION_ID, UPLOAD_TOKEN, 'control-token-never-in-qr', 'print_doc', '#']) {
    assert.ok(!url.includes(secret), `短链不该带 ${secret}`)
  }
  const relative = uploads.buildPhoneUploadQrUrl({ ...created(SCENE), uploadUrl: '/upload/phone' })
  assert.equal(relative, `https://kiosk.local/k/u/${SCENE}`, '相对 uploadUrl 按当前页面域名补全')
})

test('上传码：回执没带场景码（旧后端）或格式不对，照旧出带 fragment 的长链', () => {
  const legacy = uploads.buildPhoneUploadUrl(created().uploadUrl, SESSION_ID, UPLOAD_TOKEN, 'print_doc')
  assert.match(legacy, /^https:\/\/zhiyida\.example\.cn\/upload\/phone#sessionId=/)
  for (const bad of [undefined, '', 'short-scene', 'x'.repeat(33), 'has/slash-0123456789ab', 'has space 0123456789ab', '中文场景码中文场景码中文场景码中文']) {
    assert.equal(uploads.buildPhoneUploadQrUrl(created(bad), 'print_doc'), legacy, `场景码 ${JSON.stringify(bad)} 要回落长链`)
  }
  assert.equal(uploads.isUploadSceneToken(SCENE), true)
  assert.equal(uploads.isUploadSceneToken('a'.repeat(16)), true)
  assert.equal(uploads.isUploadSceneToken('a'.repeat(15)), false)
  assert.equal(uploads.isUploadSceneToken(null), false)
})

test('上传码：签名图与原三用途都走短链，缺场景码仍保留网页兜底', () => {
  for (const purpose of ['signature_image', 'resume_upload', 'print_doc', 'contract_upload']) {
    assert.equal(uploads.buildPhoneUploadQrUrl(created(SCENE), purpose), `https://zhiyida.example.cn/k/u/${SCENE}`)
  }
  const url = uploads.buildPhoneUploadQrUrl(created(undefined), 'signature_image')
  assert.match(url, /^https:\/\/zhiyida\.example\.cn\/upload\/phone#/)
  const fragment = new URLSearchParams(new URL(url).hash.slice(1))
  assert.equal(fragment.get('sessionId'), SESSION_ID)
  assert.equal(fragment.get('token'), UPLOAD_TOKEN)
  assert.equal(fragment.get('purpose'), 'signature_image')
  assert.ok(!url.includes('control-token-never-in-qr'))
})

test('登录码：qrUrl 里取得到合格票据出 <公网基址>/k/l/<票据>，取不到照旧', () => {
  globalThis[ENV] = { VITE_QR_LOGIN_PUBLIC_BASE_URL: 'https://zhiyida.example.cn' }
  try {
    assert.equal(qrLogin.buildQrLoginUrl(`/member/qr-login?ticketId=${TICKET}`), `https://zhiyida.example.cn/k/l/${TICKET}`)
    assert.equal(
      qrLogin.buildQrLoginUrl(`http://127.0.0.1:9527/member/qr-login?ticketId=${TICKET}`),
      `https://zhiyida.example.cn/k/l/${TICKET}`,
      '本机 Agent 给的绝对地址也换成公网短链',
    )
    assert.equal(qrLogin.buildQrLoginUrl('/member/qr-login?ticketId=short'), 'https://zhiyida.example.cn/member/qr-login?ticketId=short')
    assert.equal(
      qrLogin.buildQrLoginUrl(`/member/qr-login?ticketId=${TICKET.slice(0, 20)}%2F${TICKET.slice(20)}`),
      `https://zhiyida.example.cn/member/qr-login?ticketId=${TICKET.slice(0, 20)}%2F${TICKET.slice(20)}`,
      '票据里有路径字符就不拼进路径',
    )
    assert.equal(qrLogin.buildQrLoginUrl('/member/qr-login'), 'https://zhiyida.example.cn/member/qr-login')
    globalThis[ENV] = {}
    assert.equal(qrLogin.buildQrLoginUrl(`/member/qr-login?ticketId=${TICKET}`), `https://kiosk.local/k/l/${TICKET}`, '没配公网基址时用当前页面域名')
  } finally {
    globalThis[ENV] = {}
  }
  assert.equal(qrLogin.isQrLoginTicketId(TICKET), true)
  assert.equal(qrLogin.isQrLoginTicketId('a'.repeat(31)), false)
  assert.equal(qrLogin.isQrLoginTicketId('a'.repeat(97)), false)
})

test('兑换：POST {scene}，不带会员令牌；同一场景码同时只发一次，结束后可再发', async () => {
  const original = globalThis.fetch
  const calls = []
  let release
  globalThis.fetch = (url, init) => {
    calls.push({ url: String(url), init })
    return new Promise((resolve) => {
      release = () => resolve(new Response(JSON.stringify({ success: true, data: {
        sessionId: SESSION_ID, purpose: 'print_doc', mode: 'temporary', expiresAt: '2099-01-01T00:00:00.000Z', uploadToken: UPLOAD_TOKEN,
      } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    })
  }
  try {
    const first = uploads.resolveUploadScene(SCENE)
    assert.equal(uploads.resolveUploadScene(SCENE), first, '同时进来的第二次复用同一个请求')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://kiosk.local/api/v1/upload-sessions/scene/resolve')
    assert.equal(calls[0].init.method, 'POST')
    assert.deepEqual(JSON.parse(calls[0].init.body), { scene: SCENE })
    assert.equal(new Headers(calls[0].init.headers).get('Authorization'), null)
    release()
    assert.equal((await first).uploadToken, UPLOAD_TOKEN)
    const again = uploads.resolveUploadScene(SCENE)
    assert.notEqual(again, first)
    assert.equal(calls.length, 2)
    release()
    await again
  } finally {
    globalThis.fetch = original
  }
})

test('兑换失败：断网合成 NETWORK_ERROR；服务端 UPLOAD_SCENE_UNUSABLE 原样带出', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
    await assert.rejects(uploads.resolveUploadScene(SCENE), (error) => error.code === 'NETWORK_ERROR' && error.status === 0)
    globalThis.fetch = async () => new Response(JSON.stringify({ success: false, error: { code: 'UPLOAD_SCENE_UNUSABLE', message: '二维码已失效，请回到一体机重新生成' } }), { status: 404 })
    await assert.rejects(uploads.resolveUploadScene(SCENE), (error) => error.code === 'UPLOAD_SCENE_UNUSABLE' && error.status === 404)
  } finally {
    globalThis.fetch = original
  }
})

test('UPLOAD_SCENE_UNUSABLE 用与原失效码同一句', () => {
  const expired = uploads.uploadSessionUserMessage(new ApiHttpError('UPLOAD_SESSION_EXPIRED', 'x', 410))
  assert.equal(expired, '二维码已失效或已使用，请回到一体机刷新二维码。')
  assert.equal(uploads.uploadSessionUserMessage(new ApiHttpError('UPLOAD_SCENE_UNUSABLE', '服务端原话不上屏', 404)), expired)
})
