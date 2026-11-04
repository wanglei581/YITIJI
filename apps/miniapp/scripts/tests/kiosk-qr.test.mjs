/**
 * utils/kiosk-qr.js：认一体机屏幕上的二维码（新旧四种）。
 *
 * 新码是一体机直接出的普通链接，微信「扫普通链接二维码打开小程序」规则直达：
 *   https://<域名>/k/u/<scene>      scene    16–32 位 [A-Za-z0-9_-]
 *   https://<域名>/k/l/<ticketId>   ticketId 32–96 位 [A-Za-z0-9_-]
 * 旧码照旧要认：上传 `…#sessionId=…&token=…`（参数在 # 后面），登录 `…?ticketId=…`。
 * 不按域名认（私有化部署域名不同）；只认 http/https 或 /k/ 开头的相对路径。
 *
 * 由 verify:page-lifecycle 拉起，并因此进入 verify:static。纯函数，不发网络请求。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))
const { parseKioskCode } = requireMiniapp('../utils/kiosk-qr.js')

// 18 字节 base64url → 24 位（后端 upload-scene.ts 现发的长度）
const SCENE = 'q7Lw2mXa9_KdVb3T-pRz8nYc'
// 24 字节 base64url → 32 位（member-qr-login.service.ts 的 randomToken(24)）
const TICKET = 'Zx9vQ2Lm7KpA4wRt_Bn8YcHe-5DsUo1J'
const SESSION = '3f9c2a7be4d1458a9c06b7e2d5f81a34'
const TOKEN = 'mT4qZ8rW1xY6vB3nK9pL2sD7fG0hJ5cA-uE_iO8wQ1z'

/** 只比字段，不用 deepStrictEqual 比对象（被测模块在 Node 里正常加载，这里只为写法统一）。 */
function same(actual, expected, label) {
  assert.ok(actual, `${label}：应认出 ${JSON.stringify(expected)}，实际 null`)
  for (const k of Object.keys(expected)) assert.equal(actual[k], expected[k], `${label}：${k}`)
  assert.equal(Object.keys(actual).length, Object.keys(expected).length, `${label}：不该多出字段`)
}

test('新传文件码：/k/u/<scene>，容忍末尾 / ? #，不看域名', () => {
  const want = { kind: 'upload-scene', scene: SCENE }
  for (const raw of [
    `https://zlixc.com/k/u/${SCENE}`,
    `https://zlixc.com/k/u/${SCENE}/`,
    `https://zlixc.com/k/u/${SCENE}?scancode_time=1761700000`,
    `https://zlixc.com/k/u/${SCENE}#from-kiosk`,
    `https://zlixc.com/k/u/${SCENE}/?a=1#b`,
    `http://192.168.10.21:8080/k/u/${SCENE}`,
    `HTTPS://Jobs.Example-Edu.cn/k/u/${SCENE}`,
    `/k/u/${SCENE}`,
    `  https://zlixc.com/k/u/${SCENE}\n`,
  ]) same(parseKioskCode(raw), want, raw)
  // 长度边界 16 / 32
  same(parseKioskCode(`https://zlixc.com/k/u/${'a'.repeat(16)}`), { kind: 'upload-scene', scene: 'a'.repeat(16) }, '16 位')
  same(parseKioskCode(`https://zlixc.com/k/u/${'Z'.repeat(32)}`), { kind: 'upload-scene', scene: 'Z'.repeat(32) }, '32 位')
})

test('新登录码：/k/l/<ticketId>，32–96 位', () => {
  same(parseKioskCode(`https://zlixc.com/k/l/${TICKET}`), { kind: 'login', ticketId: TICKET }, '32 位')
  same(parseKioskCode(`https://zlixc.com/k/l/${TICKET}/?scancode_time=1`), { kind: 'login', ticketId: TICKET }, '带后缀')
  same(parseKioskCode(`/k/l/${TICKET}`), { kind: 'login', ticketId: TICKET }, '相对路径')
  const long = `${TICKET}${TICKET}${TICKET}`
  same(parseKioskCode(`https://zlixc.com/k/l/${long}`), { kind: 'login', ticketId: long }, '96 位')
})

test('旧传文件码：参数在 # 后面，顺序不限，取值会解码一次', () => {
  const want = { kind: 'upload-session', sessionId: SESSION, token: TOKEN }
  for (const raw of [
    `https://kiosk.example.cn/upload/phone#sessionId=${SESSION}&token=${TOKEN}`,
    `https://kiosk.example.cn/upload/phone#sessionId=${SESSION}&token=${TOKEN}&purpose=print_doc`,
    `https://kiosk.example.cn/upload/phone?from=qr#token=${TOKEN}&sessionId=${SESSION}`,
    `https://kiosk.example.cn/upload/phone#sessionId=${SESSION}&token=${TOKEN.replace('_', '%5F')}`,
  ]) same(parseKioskCode(raw), want, raw)
  // 小程序此前认的最短取值（8 位）照旧认
  same(
    parseKioskCode('https://kiosk.example.cn/upload/phone#sessionId=sess-12345678&token=upload-token-abcdefgh'),
    { kind: 'upload-session', sessionId: 'sess-12345678', token: 'upload-token-abcdefgh' },
    '旧测试样例',
  )
})

test('旧登录码：?ticketId=', () => {
  same(parseKioskCode(`https://kiosk.example.cn/member/qr-login?ticketId=${TICKET}`), { kind: 'login', ticketId: TICKET }, '旧登录码')
  same(parseKioskCode(`https://kiosk.example.cn/member/qr-login?from=kiosk&ticketId=${TICKET}#x`), { kind: 'login', ticketId: TICKET }, '带别的参数')
  // 20 位是旧规则下限
  const t20 = 'tkt_Abcdefghijklmnop'
  same(parseKioskCode(`https://kiosk.example.cn/member/qr-login?ticketId=${t20}`), { kind: 'login', ticketId: t20 }, '20 位')
})

test('畸形与别的码一律不认', () => {
  const bad = [
    // 新码字符集、长度、路径
    `https://zlixc.com/k/u/${SCENE.slice(0, 15)}`,
    `https://zlixc.com/k/u/${'a'.repeat(33)}`,
    `https://zlixc.com/k/u/${SCENE.slice(0, 20)}.pdf`,
    `https://zlixc.com/k/u/${SCENE.slice(0, 20)}%2F12`,
    `https://zlixc.com/k/u/${SCENE.slice(0, 20)}+abc`,
    `https://zlixc.com/k/u/${SCENE.slice(0, 20)}====`,
    `https://zlixc.com/k/u/${SCENE}/extra`,
    `https://zlixc.com/k/u//${SCENE}`,
    `https://zlixc.com/k/x/${SCENE}`,
    `https://zlixc.com/kk/u/${SCENE}`,
    `https://zlixc.com/K/U/${SCENE}`,
    `https://zlixc.com/app/k/u/${SCENE}`,
    `https://zlixc.com/k/l/${TICKET.slice(0, 31)}`,
    `https://zlixc.com/k/l/${'a'.repeat(97)}`,
    `https://zlixc.com/k/l/${TICKET.slice(0, 30)}"><`,
    `https://zlixc.com/k/u/${SCENE.slice(0, 10)} ${SCENE.slice(10)}`,
    // 协议与形态
    `javascript:alert(1)//k/u/${SCENE}`,
    `javascript:location='/k/u/${SCENE}'`,
    `ftp://zlixc.com/k/u/${SCENE}`,
    `wxp://f2f0abcdefg/k/u/${SCENE}`,
    `//zlixc.com/k/u/${SCENE}`,
    `k/u/${SCENE}`,
    `pages/kiosk-send/kiosk-send?scene=${SCENE}`,
    `/pages/kiosk-login/kiosk-login?ticketId=${TICKET}`,
    SCENE,
    TICKET,
    `https://`,
    `https:///k/u/${SCENE}`,
    '',
    '   ',
    `https://zlixc.com/k/u/${SCENE}?x=${'y'.repeat(2100)}`,
    // 旧码：参数位置、缺项、重复、解码
    `https://kiosk.example.cn/upload/phone?sessionId=${SESSION}&token=${TOKEN}`,
    `https://kiosk.example.cn/upload/phone#sessionId=${SESSION}`,
    `https://kiosk.example.cn/upload/phone#token=${TOKEN}`,
    `https://kiosk.example.cn/upload/phone#sessionId=${SESSION}&sessionId=other-session-id&token=${TOKEN}`,
    `https://kiosk.example.cn/upload/phone#sessionId=${SESSION}&token=%E0%A4%A`,
    `https://kiosk.example.cn/upload/phone#sessionId=short&token=${TOKEN}`,
    `https://kiosk.example.cn/upload/phone#sessionId=${SESSION}&token=${TOKEN}%20%3Cscript%3E`,
    `/upload/phone#sessionId=${SESSION}&token=${TOKEN}`,
    `https://kiosk.example.cn/member/qr-login#ticketId=${TICKET}`,
    `https://kiosk.example.cn/member/qr-login?ticketId=short_ticket`,
    `https://kiosk.example.cn/member/qr-login?ticketId=${TICKET}%2F..`,
    `/member/qr-login?ticketId=${TICKET}`,
    'https://example.com/?foo=bar',
  ]
  for (const raw of bad) assert.equal(parseKioskCode(raw), null, `不该认：${raw.slice(0, 120)}`)
  for (const raw of [null, undefined, 42, {}, [], true]) assert.equal(parseKioskCode(raw), null, `不该认：${String(raw)}`)
})

test('新码优先：路径已经是 /k/u/ 的，# 后面再带旧参数也按新码认', () => {
  same(
    parseKioskCode(`https://zlixc.com/k/u/${SCENE}#sessionId=${SESSION}&token=${TOKEN}`),
    { kind: 'upload-scene', scene: SCENE },
    '新码 + 旧参数',
  )
})

test('模块顶层不碰 wx（node 里直接 require 不会炸）', () => {
  assert.equal(typeof globalThis.wx, 'undefined')
  assert.equal(typeof parseKioskCode, 'function')
})
