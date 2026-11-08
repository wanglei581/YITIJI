/**
 * 小程序「扫码登录一体机」确认链路的真执行测试。
 *
 * 服务端 confirmByToken 只把票据标成 confirmed，手机拿不到任何登录态；一体机要自己
 * 轮询到 confirmed 再 claim 才真正登录，而 claim 会失败。所以手机端最多只能说
 * 「已确认，请回一体机查看登录结果」，不能说「登录成功 / 已在该机完成登录」。
 *
 * request.js 会把 2xx 的 `{}`、`{ data: null }` 解包成兑现 —— 兑现本身不是确认。
 * 只有回执就是 { status: 'confirmed' } 才算已确认；断网、超时、5xx、看不懂的回执都是
 * 结果未知：不许再确认一次，只能重读这张二维码的状态。status 缺 deviceLabel 时如实说
 * 没有名称，不编机器名。扫码登录与扫码上传分流，票据只留在内存，换人之后旧结果作废。
 *
 * 口径来源：docs/design/kiosk-redesign-2026-08/51-phone-relay.html 的 qr-login 分屏。
 *
 * 2026-10-29 起：微信扫一扫直接扫一体机的登录码（https://<域名>/k/l/<ticketId>）进本页，整条码在 q；
 * q 是传文件码就转给 kiosk-send。扫码时没登录、去登录再回来，票据还是这一张，换新代号重读状态；
 * 已登录换成另一个人、或退出，仍按换人清场。扫码直达时本页在栈底，返回回首页。
 *
 * 由 verify:page-lifecycle 拉起，并因此进入 verify:static。不发网络请求。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deferred, flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PAGE = 'pages/kiosk-login/kiosk-login.js'
const WXML = fs.readFileSync(path.join(MINIAPP, 'pages/kiosk-login/kiosk-login.wxml'), 'utf8')
const TICKET = 'tkt_Abcdefghijklmnopqrstuvwxyz0123456789'
const LOGIN_CODE = `https://kiosk.example.cn/member/qr-login?ticketId=${TICKET}`
const UPLOAD_CODE = 'https://kiosk.example.cn/upload/phone#sessionId=sess-12345678&token=upload-token-abcdefgh'

const OVERCLAIM = /登录成功|完成登录|已登录|已进入|自动登录|自动完成/
const NOT_KIOSK_COPY = '这不是一体机上的二维码，请确认扫的是终端屏幕上的登录码或上传码'

// 一体机新出的普通链接码：登录票据 24 字节 base64url = 32 位；传文件 scene 18 字节 = 24 位
const NEW_TICKET = 'Zx9vQ2Lm7KpA4wRt_Bn8YcHe-5DsUo1J'
const NEW_LOGIN_LINK = `https://zlixc.com/k/l/${NEW_TICKET}`
const NEW_UPLOAD_LINK = 'https://zlixc.com/k/u/q7Lw2mXa9_KdVb3T-pRz8nYc'
/** 微信「扫普通链接二维码打开小程序」：整条码编码一次放在 q 里，另带 scancode_time。 */
const viaWechatScan = (raw) => ({ q: encodeURIComponent(raw), scancode_time: '1761700000' })

function pending(overrides = {}) {
  return { status: 'pending', deviceLabel: '人才市场 1 号机', returnTo: '/', expiresInSeconds: 142, ...overrides }
}

function httpError(statusCode, code, message = '') {
  const err = new Error(message)
  err.statusCode = statusCode
  if (code) err.code = code
  return err
}

function harness({
  status = () => Promise.resolve(pending()),
  confirm = () => Promise.resolve({ status: 'confirmed' }),
  loggedIn = true,
  options = {},
  redirectFails = false,
} = {}) {
  const session = { loggedIn, gen: 1 }
  const calls = { status: [], confirm: [], navigate: [], redirect: [], back: 0, tab: [], modal: 0 }
  let scanResult = LOGIN_CODE
  const wx = {
    scanCode(opts) { opts.success({ result: scanResult }) },
    navigateTo(opts) { calls.navigate.push(opts.url) },
    redirectTo(opts) {
      calls.redirect.push(opts.url)
      if (redirectFails && opts.fail) opts.fail({ errMsg: 'redirectTo:fail' })
    },
    // 扫码直达时本页在栈底：navigateBack 失败，交给 fail 回调
    navigateBack(opts) {
      calls.back += 1
      if (opts && opts.fail) opts.fail({ errMsg: 'navigateBack:fail cannot navigate back at first page' })
    },
    switchTab(opts) { calls.tab.push(opts.url) },
    // 旧实现用系统弹窗确认；新实现应在页面里确认。为了让旧实现也能走完（从而在断言上判红
    // 而不是在替身上崩掉），这里照样给一个一律点「确认」的弹窗。
    showModal(opts) { calls.modal += 1; opts.success({ confirm: true }) },
  }
  const auth = {
    isLoggedIn: () => session.loggedIn,
    sessionGeneration: () => session.gen,
    isSameSession: (g) => g === session.gen,
  }
  const api = {
    getQrLoginStatus(ticketId) { calls.status.push(ticketId); return status(ticketId, calls.status.length) },
    confirmQrLoginByToken(ticketId) { calls.confirm.push(ticketId); return confirm(ticketId, calls.confirm.length) },
  }
  const page = instantiate(loadPageDefinition(PAGE, { wx, modules: { api, auth } }))
  page.onLoad(options)
  page.onShow()
  return {
    page,
    calls,
    session,
    setScan(raw) { scanResult = raw },
    async scan() { page.scanCode(); await flush() },
    /** 扫码并在页面上点确认（旧实现走弹窗，已经自己确认过了，这里不再点）。 */
    async scanAndConfirm() {
      page.scanCode()
      await flush()
      if (page.data.phase === 'ready') {
        page.confirmLogin()
        await flush()
      }
    },
    /** 登录页登完 navigateBack 回到本页：代号推进、onShow。 */
    loginAs(nextLoggedIn = true) {
      session.loggedIn = nextLoggedIn
      session.gen += 1
      page.onShow()
    },
  }
}

function assertNoTicketInData(page) {
  assert.equal(JSON.stringify(page.data).includes(TICKET), false, '票据不得进入页面 data')
}

/**
 * 取 wxml 里 `wx:elif="{{phase === '<phase>'}}"` 那一块，断言它的静态文案。
 * 只认分支属性本身：顶栏的三元表达式里也会出现 phase === '...'，按裸文本找会切错块。
 * 分支内部不嵌套 <block>，所以切到下一个 </block> 就是整块。
 */
function phaseBlock(phase) {
  const start = WXML.search(new RegExp(`wx:(?:el)?if="\\{\\{phase === '${phase}'\\}\\}"`))
  assert.ok(start >= 0, `wxml 里找不到 phase === '${phase}' 分支`)
  const end = WXML.indexOf('</block>', start)
  assert.ok(end > start, `phase === '${phase}' 分支没有闭合`)
  return WXML.slice(start, end)
}

test('只有 { status: confirmed } 回执才算已确认，文案只说「回一体机看结果」', async () => {
  const env = harness()
  await env.scanAndConfirm()
  assert.equal(env.page.data.phase, 'confirmed')
  assert.equal(env.calls.confirm.length, 1)
  assert.equal(env.calls.confirm[0], TICKET)
  assert.equal(env.page.data.deviceLabel, '人才市场 1 号机')
  assertNoTicketInData(env.page)
  const block = phaseBlock('confirmed')
  assert.match(block, /已确认/)
  assert.match(block, /回一体机/)
  assert.equal(OVERCLAIM.test(block), false, `confirmed 分支不得宣称已登录：${block}`)
  assert.equal(OVERCLAIM.test(JSON.stringify(env.page.data)), false)
  assert.equal(OVERCLAIM.test(WXML), false, 'kiosk-login.wxml 任何地方都不得写登录成功')
})

test('空回执、缺字段、非 confirmed 回执都是结果未知，不是已确认', async () => {
  for (const body of [undefined, null, {}, { data: null }, { status: 'pending' }, { ok: true }, 'confirmed']) {
    const env = harness({ confirm: () => Promise.resolve(body) })
    await env.scanAndConfirm()
    assert.equal(env.page.data.phase, 'unknown', `回执 ${JSON.stringify(body)}`)
    assert.equal(env.calls.confirm.length, 1)
  }
})

test('断网、超时、5xx 是结果未知：不再确认，只能重读状态', async () => {
  for (const err of [httpError(-1, undefined, 'request:fail timeout'), httpError(500), httpError(502), httpError(503, 'SERVICE_UNAVAILABLE')]) {
    const env = harness({ confirm: () => Promise.reject(err) })
    await env.scanAndConfirm()
    assert.equal(env.page.data.phase, 'unknown', `错误 ${err.statusCode}`)
    // 结果未知这一屏上再点确认不能再发一次
    env.page.confirmLogin()
    await flush()
    assert.equal(env.calls.confirm.length, 1, '结果未知时不得盲发第二次确认')
    assert.equal(/confirmLogin/.test(phaseBlock('unknown')), false, 'unknown 分支不得渲染确认按钮')
    assert.match(phaseBlock('unknown'), /bindtap="recheck"/)
  }
})

test('结果未知后重读状态：仍 pending 才回到确认屏，由本人再决定', async () => {
  const env = harness({
    status: (_t, n) => Promise.resolve(pending(n === 1 ? {} : { expiresInSeconds: 61 })),
    confirm: () => Promise.reject(httpError(-1)),
  })
  await env.scanAndConfirm()
  assert.equal(env.page.data.phase, 'unknown')
  env.page.recheck()
  await flush()
  assert.equal(env.calls.status.length, 2)
  assert.equal(env.page.data.phase, 'ready')
  assert.equal(env.page.data.remainSeconds, 61)
  assert.ok(env.page.data.note, '回到确认屏时要说明上一次确认没有生效')
  assert.equal(env.calls.confirm.length, 1, '重读状态本身不得发确认')
})

test('结果未知后重读：已确认 / 已领取 / 已过期都送回一体机，不给重试', async () => {
  const outcomes = [
    () => Promise.resolve(pending({ status: 'confirmed' })),
    () => Promise.reject(httpError(410, 'QR_LOGIN_ALREADY_CLAIMED')),
    () => Promise.reject(httpError(404, 'QR_LOGIN_NOT_FOUND')),
  ]
  for (const second of outcomes) {
    const env = harness({
      status: (t, n) => (n === 1 ? Promise.resolve(pending()) : second()),
      confirm: () => Promise.reject(httpError(-1)),
    })
    await env.scanAndConfirm()
    env.page.recheck()
    await flush()
    assert.equal(env.page.data.phase, 'ticket-dead')
    env.page.recheck()
    env.page.confirmLogin()
    await flush()
    assert.equal(env.calls.status.length, 2, '票据已死之后不得再读同一张票据')
    assert.equal(env.calls.confirm.length, 1)
  }
})

test('结果未知后重读也失败：留在结果未知，不退回可确认的屏', async () => {
  const env = harness({
    status: (t, n) => (n === 1 ? Promise.resolve(pending()) : Promise.reject(httpError(-1))),
    confirm: () => Promise.reject(httpError(-1)),
  })
  await env.scanAndConfirm()
  env.page.recheck()
  await flush()
  assert.equal(env.page.data.phase, 'unknown')
  assert.ok(env.page.data.note)
})

test('服务端明确说票据不能再确认 → 回一体机；其它 4xx → 服务端拒绝了这一次', async () => {
  for (const code of ['QR_LOGIN_ALREADY_CONFIRMED', 'QR_LOGIN_NOT_FOUND', 'QR_LOGIN_ALREADY_CLAIMED', 'QR_LOGIN_TICKET_INVALID']) {
    const env = harness({ confirm: () => Promise.reject(httpError(409, code)) })
    await env.scanAndConfirm()
    assert.equal(env.page.data.phase, 'ticket-dead', code)
  }
  const env = harness({ confirm: () => Promise.reject(httpError(429, 'RATE_LIMITED', '尝试过于频繁，请稍后再试')) })
  await env.scanAndConfirm()
  assert.equal(env.page.data.phase, 'rejected')
  assert.equal(env.page.data.errorMsg, '尝试过于频繁，请稍后再试')
  assert.equal(OVERCLAIM.test(env.page.data.errorMsg), false)
})

test('status 缺 deviceLabel 时不编机器名，确认前也不走系统弹窗', async () => {
  for (const label of [undefined, '', '   ', null, 42]) {
    const env = harness({ status: () => Promise.resolve(pending({ deviceLabel: label })) })
    await env.scan()
    assert.equal(env.page.data.phase, 'ready', `deviceLabel=${JSON.stringify(label)}`)
    assert.equal(env.page.data.deviceLabel, '')
    assert.equal(env.calls.modal, 0, '确认要在页面上做，不能藏进一个不写机器名的系统弹窗')
    assert.equal(JSON.stringify(env.page.data).includes('就业服务终端'), false, '不得编造机器名')
    assert.match(env.page.data.dev.name, /名称未提供/)
    env.page.confirmLogin()
    await flush()
    assert.equal(env.page.data.phase, 'confirmed')
    assert.equal(JSON.stringify(env.page.data).includes('就业服务终端'), false)
  }
  const src = fs.readFileSync(path.join(MINIAPP, PAGE), 'utf8')
  assert.equal(src.includes('就业服务终端'), false, 'kiosk-login.js 不得保留编造的机器名兜底')
})

test('剩余秒数只认 status 回来的合法值', async () => {
  for (const [value, expected] of [[142, 142], [0, 0], [-3, 0], [999, 0], ['60', 0], [12.5, 0], [undefined, 0]]) {
    const env = harness({ status: () => Promise.resolve(pending({ expiresInSeconds: value })) })
    await env.scan()
    assert.equal(env.page.data.remainSeconds, expected, `expiresInSeconds=${JSON.stringify(value)}`)
  }
})

test('状态读不到或回执看不懂 → 可重读；读到已确认 → 回一体机；都不发确认', async () => {
  for (const body of [undefined, null, {}, { status: 'claimed' }]) {
    const env = harness({ status: () => Promise.resolve(body) })
    await env.scan()
    assert.equal(env.page.data.phase, 'status-error', JSON.stringify(body))
  }
  for (const err of [httpError(-1), httpError(500), httpError(429)]) {
    const env = harness({ status: () => Promise.reject(err) })
    await env.scan()
    assert.equal(env.page.data.phase, 'status-error', String(err.statusCode))
    env.page.confirmLogin()
    await flush()
    assert.equal(env.calls.confirm.length, 0)
  }
  const dead = harness({ status: () => Promise.resolve(pending({ status: 'confirmed' })) })
  await dead.scanAndConfirm()
  assert.equal(dead.page.data.phase, 'ticket-dead')
  assert.equal(dead.calls.confirm.length, 0)
  assert.equal(dead.calls.modal, 0)
})

test('确认中连点只发一次', async () => {
  const d = deferred()
  const env = harness({ confirm: () => d.promise })
  await env.scan()
  env.page.confirmLogin()
  env.page.confirmLogin()
  env.page.confirmLogin()
  assert.equal(env.page.data.phase, 'confirming')
  assert.equal(env.calls.confirm.length, 1)
  d.resolve({ status: 'confirmed' })
  await flush()
  assert.equal(env.page.data.phase, 'confirmed')
})

test('扫码登录与扫码上传分流', async () => {
  const up = harness()
  up.setScan(UPLOAD_CODE)
  await up.scan()
  assert.equal(up.calls.navigate.length, 1)
  assert.match(up.calls.navigate[0], /^\/pages\/kiosk-send\/kiosk-send\?sessionId=sess-12345678&token=upload-token-abcdefgh$/)
  assert.equal(up.calls.status.length, 0)
  assert.equal(up.calls.confirm.length, 0)

  const login = harness()
  await login.scanAndConfirm()
  assert.equal(login.calls.navigate.length, 0)

  const other = harness()
  other.setScan('https://example.com/?foo=bar')
  await other.scan()
  assert.equal(other.page.data.phase, 'scan-error')
  assert.equal(other.calls.status.length, 0)
})

test('换人之后：未发出的确认不再发，在途结果不落到新账号的屏上', async () => {
  // ① 确认屏上换了账号，再点确认 → 不发
  const a = harness()
  await a.scan()
  assert.equal(a.page.data.phase, 'ready')
  a.session.gen = 2
  a.page.onShow()
  assert.equal(a.page.data.phase, 'idle')
  assert.equal(a.page.data.deviceLabel, '')
  a.page.confirmLogin()
  await flush()
  assert.equal(a.calls.confirm.length, 0)

  // ② 确认在途时换了账号 → 晚到的「已确认」不显示给新账号
  const d = deferred()
  const b = harness({ confirm: () => d.promise })
  await b.scan()
  b.page.confirmLogin()
  b.session.gen = 2
  d.resolve({ status: 'confirmed' })
  await flush()
  assert.notEqual(b.page.data.phase, 'confirmed')
  assert.equal(b.page.data.deviceLabel, '')

  // ③ 重新扫码后，上一张票据晚到的状态被丢弃
  const late = deferred()
  const c = harness({ status: (t, n) => (n === 1 ? late.promise : Promise.resolve(pending({ deviceLabel: '二号机' }))) })
  c.page.scanCode()
  c.page.scanCode()
  await flush()
  late.resolve(pending({ deviceLabel: '一号机' }))
  await flush()
  assert.equal(c.page.data.deviceLabel, '二号机')
})

test('确认被 401 拒绝：不算已确认，页面回到当前登录态', async () => {
  const env = harness({
    confirm: () => {
      // request.js 补签失败时会 logoutIfSameSession：代际推进、登录态消失
      env.session.loggedIn = false
      env.session.gen = 2
      return Promise.reject(httpError(401, undefined, '登录已失效,请重新登录'))
    },
  })
  await env.scanAndConfirm()
  assert.notEqual(env.page.data.phase, 'confirmed')
  assert.equal(env.page.data.isLoggedIn, false)
})

// ══════════════════════════════════════════════════════════════════════
// 2026-10-29：微信扫一扫直达（q）、登录回来不丢票据、栈底返回
// ══════════════════════════════════════════════════════════════════════

test('q 是一体机的新登录码：直接读这张票据，核对后在页面上确认', async () => {
  const env = harness({ options: viaWechatScan(NEW_LOGIN_LINK) })
  await flush()
  assert.equal(env.calls.status.length, 1)
  assert.equal(env.calls.status[0], NEW_TICKET)
  assert.equal(env.page.data.phase, 'ready')
  assert.equal(env.calls.redirect.length, 0)
  assert.equal(JSON.stringify(env.page.data).includes(NEW_TICKET), false, '票据不得进入页面 data')
  env.page.confirmLogin()
  await flush()
  assert.equal(env.calls.confirm.length, 1)
  assert.equal(env.calls.confirm[0], NEW_TICKET)
  assert.equal(env.page.data.phase, 'confirmed')

  // 旧登录码经 q 进来同样认；带后缀的新码也认
  for (const raw of [LOGIN_CODE, `${NEW_LOGIN_LINK}/`, `${NEW_LOGIN_LINK}?from=kiosk`]) {
    const e2 = harness({ options: viaWechatScan(raw) })
    await flush()
    assert.equal(e2.page.data.phase, 'ready', raw)
    assert.equal(e2.calls.status.length, 1, raw)
  }
})

test('q 是传文件码：整条码原样转给传文件页，本页不读票据', async () => {
  for (const raw of [NEW_UPLOAD_LINK, UPLOAD_CODE]) {
    const env = harness({ options: viaWechatScan(raw) })
    await flush()
    assert.equal(env.calls.status.length, 0, raw)
    assert.equal(env.calls.redirect.length, 1, raw)
    const url = env.calls.redirect[0]
    assert.equal(url, `/pages/kiosk-send/kiosk-send?q=${encodeURIComponent(raw)}`)
    assert.equal(decodeURIComponent(url.slice(url.indexOf('?q=') + 3)), raw)
  }
  // 打不开传文件页：说清楚，可以重新扫码
  const failing = harness({ options: viaWechatScan(NEW_UPLOAD_LINK), redirectFails: true })
  assert.equal(failing.page.data.phase, 'scan-error')
  assert.match(failing.page.data.errorMsg, /传文件页/)
})

test('q 不是一体机的码：现有 scan-error 说法；没登录也直接说，不先逼人登录', async () => {
  for (const loggedIn of [true, false]) {
    for (const q of [
      encodeURIComponent('https://example.com/?foo=bar'),
      encodeURIComponent(`https://zlixc.com/k/l/${NEW_TICKET.slice(0, 20)}`),
      encodeURIComponent(`javascript:alert(1)//k/l/${NEW_TICKET}`),
      '%E0%A4%A',
    ]) {
      const env = harness({ loggedIn, options: { q } })
      await flush()
      assert.equal(env.page.data.phase, 'scan-error', q)
      assert.equal(env.page.data.errorMsg, NOT_KIOSK_COPY)
      assert.equal(env.calls.status.length, 0)
      assert.equal(env.calls.redirect.length, 0)
    }
  }
  const loginBlock = WXML.match(/<block wx:if="\{\{(!isLoggedIn[^"]*)\}\}">/)
  assert.ok(loginBlock, '找不到未登录分支')
  assert.match(loginBlock[1], /phase !== 'scan-error'/, '码不对时不该把人挡在「请先登录」后面')
})

test('小程序内扫码：新传文件码带 q 跳传文件页，新登录码读票据', async () => {
  const up = harness()
  up.setScan(NEW_UPLOAD_LINK)
  await up.scan()
  assert.equal(up.calls.navigate.length, 1)
  assert.equal(up.calls.navigate[0], `/pages/kiosk-send/kiosk-send?q=${encodeURIComponent(NEW_UPLOAD_LINK)}`)
  assert.equal(up.calls.status.length, 0)

  const login = harness()
  login.setScan(`  ${NEW_LOGIN_LINK}\n`)
  await login.scanAndConfirm()
  assert.equal(login.calls.navigate.length, 0)
  assert.equal(login.calls.status[0], NEW_TICKET)
  assert.equal(login.calls.confirm[0], NEW_TICKET)
  assert.equal(login.page.data.phase, 'confirmed')
})

test('没登录扫的码：页面明确先登录再确认；登录回来票据还在、换新代号重读，没过期就到确认屏', async () => {
  const env = harness({
    loggedIn: false,
    options: viaWechatScan(NEW_LOGIN_LINK),
    status: (_t, n) => Promise.resolve(pending(n === 1 ? {} : { expiresInSeconds: 95 })),
  })
  await flush()
  assert.equal(env.calls.status.length, 1)
  assert.equal(env.page.data.isLoggedIn, false)
  // 没登录时确认按钮不渲染，模板落在「请先登录小程序」那一支；硬点确认也不发
  const loginBlock = WXML.slice(WXML.indexOf('<block wx:if="{{!isLoggedIn'), WXML.indexOf('</block>', WXML.indexOf('<block wx:if="{{!isLoggedIn')))
  assert.match(loginBlock, /请先登录小程序/)
  assert.match(loginBlock, /bindtap="goLogin"/)
  assert.equal(/phase !== 'ready'/.test(loginBlock), false, '待确认这一屏没登录时要先登录')
  env.page.confirmLogin()
  await flush()
  assert.equal(env.calls.confirm.length, 0)

  env.page.goLogin()
  assert.equal(env.calls.navigate[0], '/pages/launch/launch')
  // 在登录页没登成就回来：什么都不变
  env.page.onShow()
  await flush()
  assert.equal(env.calls.status.length, 1)

  env.loginAs(true)
  await flush()
  assert.equal(env.calls.status.length, 2, '登录回来要重读这张票据')
  assert.equal(env.calls.status[1], NEW_TICKET)
  assert.equal(env.page.data.isLoggedIn, true)
  assert.equal(env.page.data.phase, 'ready')
  assert.equal(env.page.data.remainSeconds, 95)
  assertNoTicketInData(env.page)
  env.page.confirmLogin()
  await flush()
  assert.equal(env.calls.confirm.length, 1)
  assert.equal(env.calls.confirm[0], NEW_TICKET)
  assert.equal(env.page.data.phase, 'confirmed')
})

test('没登录扫的码、登录回来时已过期或已被确认：进「回一体机」那一屏，不给确认', async () => {
  for (const second of [
    () => Promise.reject(httpError(404, 'QR_LOGIN_NOT_FOUND', '扫码登录已过期或不存在')),
    () => Promise.resolve(pending({ status: 'confirmed' })),
  ]) {
    const env = harness({
      loggedIn: false,
      options: viaWechatScan(NEW_LOGIN_LINK),
      status: (_t, n) => (n === 1 ? Promise.resolve(pending()) : second()),
    })
    await flush()
    env.loginAs(true)
    await flush()
    assert.equal(env.calls.status.length, 2)
    assert.equal(env.page.data.phase, 'ticket-dead')
    env.page.confirmLogin()
    env.page.recheck()
    await flush()
    assert.equal(env.calls.confirm.length, 0)
    assert.equal(env.calls.status.length, 2)
  }

  // 登录之前就读到这张码不能再确认：直接说（不先逼人登录），登录回来也还停在这一屏
  const dead = harness({
    loggedIn: false,
    options: viaWechatScan(NEW_LOGIN_LINK),
    status: () => Promise.reject(httpError(404, 'QR_LOGIN_NOT_FOUND', '扫码登录已过期或不存在')),
  })
  await flush()
  assert.equal(dead.page.data.phase, 'ticket-dead')
  dead.loginAs(true)
  await flush()
  assert.equal(dead.page.data.phase, 'ticket-dead')
  assert.equal(dead.page.data.isLoggedIn, true)
  assert.equal(dead.calls.status.length, 1)
})

test('票据还在读、人已经去登录了：晚到的旧结果丢掉，用新代号重读', async () => {
  const slow = deferred()
  const env = harness({
    loggedIn: false,
    options: viaWechatScan(NEW_LOGIN_LINK),
    status: (_t, n) => (n === 1 ? slow.promise : Promise.resolve(pending({ deviceLabel: '人社局大厅 2 号机', expiresInSeconds: 120 }))),
  })
  assert.equal(env.page.data.phase, 'checking')
  // 登录页上登完，旧的状态读取才回来（本页这时还在后台，onShow 还没跑）
  env.session.loggedIn = true
  env.session.gen += 1
  slow.resolve(pending({ deviceLabel: '登录前读到的机器' }))
  await flush()
  assert.equal(env.calls.status.length, 2, '旧代号的结果不用，拿新代号重读')
  assert.equal(env.page.data.phase, 'ready')
  assert.equal(env.page.data.deviceLabel, '人社局大厅 2 号机')
  env.page.onShow()
  await flush()
  assert.equal(env.calls.status.length, 2, '已经接上了，回到前台不再重读')
  env.page.confirmLogin()
  await flush()
  assert.equal(env.calls.confirm[0], NEW_TICKET)
})

test('已登录 A 换成 B、或退出登录：照旧清场，票据作废；再登录也不会接回旧票据', async () => {
  // A → B
  const ab = harness({ options: viaWechatScan(NEW_LOGIN_LINK) })
  await flush()
  assert.equal(ab.page.data.phase, 'ready')
  ab.loginAs(true)
  await flush()
  assert.equal(ab.page.data.phase, 'idle')
  assert.equal(ab.page.data.deviceLabel, '')
  assert.equal(ab.calls.status.length, 1, '换了人不重读上一个人的票据')
  ab.page.confirmLogin()
  await flush()
  assert.equal(ab.calls.confirm.length, 0)

  // A → 退出 → 再登录
  const out = harness({ options: viaWechatScan(NEW_LOGIN_LINK) })
  await flush()
  out.loginAs(false)
  await flush()
  assert.equal(out.page.data.phase, 'idle')
  assert.equal(out.page.data.isLoggedIn, false)
  out.loginAs(true)
  await flush()
  assert.equal(out.page.data.phase, 'idle')
  assert.equal(out.calls.status.length, 1)
  out.page.confirmLogin()
  await flush()
  assert.equal(out.calls.confirm.length, 0)
})

test('返回键：扫码直达时本页在栈底，回首页', () => {
  const env = harness({ options: viaWechatScan(NEW_LOGIN_LINK) })
  env.page.goBack()
  assert.equal(env.calls.back, 1)
  assert.equal(env.calls.tab.length, 1)
  assert.equal(env.calls.tab[0], '/pages/home/home')
})
