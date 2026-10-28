/**
 * 小程序「传文件到一体机」上传回执的真执行测试。
 *
 * 页面拿到的是 utils/request.js 解包后的值：2xx 的 `{}` 和 `{ data: null }`
 * 都会变成兑现，而不是拒绝。只有 status=uploaded、file.fileId、真实会话用途，
 * 且 sessionId 就是这一次，才能说已收到。空的、缺字段的、别的会话的，都是结果未知。
 * 网络和 5xx 同样未知，不能再传一次；服务端明确拒收才允许重选。
 *
 * 2026-10-29 起：一体机出普通链接码（https://<域名>/k/u/<scene>），微信扫一扫直达本页、整条码在 q；
 * 兑换在会话有效期内可重复（同一张码换回同一把令牌），所以码失效不给重试、没回应可以重试。
 * 文件多了一个来源「从我的文档选」（要登录，POST /upload-sessions/:id/member-file），
 * 去登录再回来令牌还在页面内存里；换了账号只清列表。说法与一体机同一句。
 * 「从我的文档选」那批用例在 kiosk-send-docs.test.mjs；两份共用的页面沙箱与替身在 kiosk-send-harness.mjs。
 *
 * 由 verify:page-lifecycle 拉起，并因此进入 verify:static。不发网络请求。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  MINIAPP, PAGE, SESSION, TOKEN, FILE, BUSY_COPY, DEAD_COPY, REJECT_FALLBACK, OFFLINE_COPY,
  NOT_KIOSK_COPY, SCENE, UPLOAD_LINK, LOGIN_LINK,
  receipt, httpError, harness, assertTokenStaysInMemory, assertUnknown, send, deferred, flush,
} from './kiosk-send-harness.mjs'

test('完整回执才算已收到，令牌只留在内存', async () => {
  for (const purpose of ['resume_upload', 'print_doc', 'contract_upload']) {
    const env = await send(null, receipt({ purpose }))
    assert.equal(env.page.data.phase, 'done', purpose)
    assert.equal(env.page.data.canRetry, false)
    assert.equal(env.page.data.sent.length, 1)
    assert.equal(env.page.data.sent[0].name, FILE.name)
    assert.equal(env.page.data.errorMsg, '')
    assertTokenStaysInMemory(env.page)
    assert.deepEqual(env.uploads[0].slice(0, 2), [SESSION, TOKEN])
  }
})

test('空回执、缺字段、非上传成功态都不能说已收到', async () => {
  const cases = [
    null,
    undefined,
    {},
    { success: true },
    { status: 'uploaded' },
    receipt({ file: null }),
    receipt({ file: {} }),
    receipt({ file: { fileId: '' } }),
    receipt({ file: { fileId: '   ' } }),
    receipt({ file: { fileId: 1 } }),
    receipt({ purpose: 'signature_image' }),
    receipt({ purpose: 'not_a_purpose' }),
    receipt({ purpose: '' }),
    receipt({ status: 'pending' }),
    receipt({ status: 'uploading' }),
    receipt({ status: 'confirmed' }),
    receipt({ status: 'expired' }),
    receipt({ sessionId: '' }),
    receipt({ sessionId: 'sess-other' }),
  ]
  for (const body of cases) {
    const env = await send(null, body)
    assertUnknown(env.page)
    assert.equal(env.uploads.length, 1)
    assertTokenStaysInMemory(env.page)
  }
})

test('结果未知后重试和再选文件都不会第二次上传', async () => {
  const env = await send(null, {})
  assertUnknown(env.page)
  env.page.retry()
  env.wx.setChosen(FILE)
  env.page.chooseAndSend()
  env.page._send(FILE)
  await flush()
  assert.equal(env.uploads.length, 1)
  assert.equal(env.page.data.phase, 'unknown')
  assert.equal(env.wx.calls.choose, 0)
})

test('网络、5xx、408 和意外 401 都是结果未知，不提示登录或重传', async () => {
  const cases = [
    httpError(-1, '', 'uploadFile:fail timeout'),
    httpError(500, 'INTERNAL', '服务器内部错误'),
    httpError(408, '', ''),
    httpError(401, '', '登录已失效,请重新登录'),
    httpError(401, 'AUTH_REQUIRED', '请先登录后再操作'),
    httpError(401, 'MEMBER_SESSION_EXPIRED', '会话已失效,请重新登录'),
    new Error('socket hang up'),
  ]
  for (const err of cases) {
    const env = await send(null, err)
    assertUnknown(env.page)
    assert.equal(/uploadFile|timeout|登录|服务器内部错误|socket/.test(env.page.data.errorMsg), false)
    env.page.retry()
    env.page.chooseAndSend()
    assert.equal(env.uploads.length, 1)
  }
})

test('同一二维码正在上传时不重传', async () => {
  const env = await send(null, httpError(400, 'UPLOAD_SESSION_UPLOAD_IN_PROGRESS', '该二维码正在上传中,请稍候'))
  assertUnknown(env.page, BUSY_COPY)
  env.page.retry()
  env.page.chooseAndSend()
  assert.equal(env.uploads.length, 1)
})

test('会话已失效是可确认的失败，但不能用同一张码再传', async () => {
  for (const code of ['UPLOAD_SESSION_EXPIRED', 'UPLOAD_SESSION_NOT_PENDING', 'UPLOAD_SESSION_NOT_FOUND', 'UPLOAD_TOKEN_INVALID']) {
    const env = await send(null, httpError(400, code, code))
    assert.equal(env.page.data.phase, 'error', code)
    assert.equal(env.page.data.canRetry, false)
    assert.equal(env.page.data.sceneFailed, false)
    assert.equal(env.page.data.sent.length, 0)
    assert.equal(env.page.data.errorMsg, DEAD_COPY)
    assert.equal(env.page.data.errorMsg.includes(code), false)
    env.page.retry()
    env.page.chooseAndSend()
    env.page._send(FILE)
    assert.equal(env.page.data.phase, 'error')
    assert.equal(env.uploads.length, 1)
  }
})

test('服务端明确拒收才允许重选，且不展示机器码或运维原文', async () => {
  const tooBig = await send(null, httpError(400, 'FILE_TOO_LARGE', 'FILE_TOO_LARGE'))
  assert.equal(tooBig.page.data.phase, 'error')
  assert.equal(tooBig.page.data.canRetry, true)
  assert.equal(tooBig.page.data.errorMsg, '文件过大，请压缩后重试')
  assert.equal(tooBig.page.data.errorMsg.includes('FILE_TOO_LARGE'), false)

  const mime = await send(null, httpError(400, 'FILE_MIME_NOT_ALLOWED', 'FILE_MIME_NOT_ALLOWED'))
  assert.equal(mime.page.data.phase, 'error')
  assert.equal(mime.page.data.canRetry, true)
  assert.equal(mime.page.data.errorMsg, REJECT_FALLBACK)
  assert.equal(/FILE_|OSS_|存储桶/.test(mime.page.data.errorMsg), false)

  const ops = await send(null, httpError(400, 'FILE_REJECTED_INTERNAL', '存储桶配置错误，请检查 OSS_BUCKET'))
  assert.equal(ops.page.data.errorMsg, REJECT_FALLBACK)
  assert.equal(ops.page.data.errorMsg.includes('存储桶'), false)
  assert.equal(ops.page.data.errorMsg.includes('OSS_BUCKET'), false)
})

test('明确拒收后可以重选，下一次仍只用内存里的令牌', async () => {
  let next = Promise.reject(httpError(400, 'VALIDATION_FAILED', 'VALIDATION_FAILED'))
  const env = harness(() => next)
  env.openDirect()
  env.page._send(FILE)
  await flush()
  assert.equal(env.page.data.phase, 'error')
  assert.equal(env.page.data.canRetry, true)
  assert.equal(env.page.data.errorMsg, '提交内容有误，请检查后重试')
  assert.equal(env.page.data.errorMsg.includes('VALIDATION_FAILED'), false)
  env.page.retry()
  assert.equal(env.page.data.phase, 'idle')
  const second = deferred()
  next = second.promise
  env.wx.setChosen({ path: 'wxfile://tmp/b.pdf', name: 'b.pdf', size: 10 })
  env.page.chooseAndSend()
  assert.equal(env.uploads.length, 2)
  assert.deepEqual(env.uploads[1].slice(0, 2), [SESSION, TOKEN])
  assertTokenStaysInMemory(env.page)
  second.resolve(receipt({ purpose: 'contract_upload' }))
  await flush()
  assert.equal(env.page.data.phase, 'done')
  assert.equal(env.page.data.sent.length, 1)
  assert.equal(env.page.data.sent[0].name, 'b.pdf')
})

test('成功之后再选文件不会覆盖已收到，也不会再上传', async () => {
  const env = await send(null, receipt())
  assert.equal(env.page.data.phase, 'done')
  env.wx.setChosen({ path: 'wxfile://tmp/b.pdf', name: '另一份.pdf', size: 20 })
  env.page.chooseAndSend()
  env.page._send(FILE)
  env.page.retry()
  await flush()
  assert.equal(env.uploads.length, 1)
  assert.equal(env.page.data.phase, 'done')
  assert.equal(env.page.data.sent.length, 1)
  assert.equal(env.page.data.sent[0].name, FILE.name)
})

test('上传进行中不会叠第二次，迟到的失败也不会改写', async () => {
  const pending = deferred()
  const env = harness(() => pending.promise)
  env.openDirect()
  env.page._send(FILE)
  env.page._send({ path: 'wxfile://tmp/b.pdf', name: 'b.pdf', size: 20 })
  env.page.chooseAndSend()
  assert.equal(env.uploads.length, 1)
  assert.equal(env.page.data.phase, 'uploading')
  pending.reject(httpError(503, '', ''))
  await flush()
  assertUnknown(env.page)
  assert.equal(env.wx.calls.hide, 1)
})

test('本地就拦住的大文件没有发出去，仍可以重选', async () => {
  const env = harness(() => Promise.reject(new Error('should not upload')))
  env.openDirect()
  env.wx.setChosen({ path: 'wxfile://tmp/big.pdf', name: 'big.pdf', size: 10 * 1024 * 1024 + 1 })
  env.page.chooseAndSend()
  await flush()
  assert.equal(env.uploads.length, 0)
  assert.equal(env.page.data.phase, 'error')
  assert.equal(env.page.data.canRetry, true)
  assert.equal(/10MB/.test(env.page.data.errorMsg), true)
  env.page.retry()
  assert.equal(env.page.data.phase, 'idle')
})

// 2026-10-29 规则变更：原用例「scene 兑换失败或回执不完整都不重试兑换」。
// 兑换改成会话有效期内可重复（同一张码换回同一把令牌）后，只有 UPLOAD_SCENE_UNUSABLE（码本身不对）
// 不给重试；回执不完整说明这次没拿到结论，码可能还好好的，改为给「重试」。
test('scene 兑换说码失效（UNUSABLE）不给重试，说法与一体机同一句，令牌不进 data', async () => {
  const failed = harness(() => Promise.resolve(receipt()))
  failed.setScene(() => Promise.reject(httpError(400, 'UPLOAD_SCENE_UNUSABLE', '二维码已失效，请回到一体机重新生成')))
  failed.page.onLoad({ scene: encodeURIComponent('scene-once') })
  await flush()
  assert.equal(failed.sceneCalls.length, 1)
  assert.equal(failed.page.data.phase, 'error')
  assert.equal(failed.page.data.sceneFailed, true)
  assert.equal(failed.page.data.canRetry, false)
  assert.equal(failed.page.data.resolveRetry, false)
  assert.equal(failed.page.data.errorMsg, DEAD_COPY)
  assert.equal(failed.page._uploadToken || '', '')
  failed.page.retry()
  failed.page.chooseAndSend()
  await flush()
  assert.equal(failed.sceneCalls.length, 1)
  assert.equal(failed.uploads.length, 0)
  assert.equal(failed.wx.calls.choose, 0)

  // 只要服务端说 UPLOAD_SCENE_UNUSABLE，不论状态码是几，都不给重试
  for (const statusCode of [404, 410, 429, 503]) {
    const env = harness(() => Promise.resolve(receipt()))
    env.setScene(() => Promise.reject(httpError(statusCode, 'UPLOAD_SCENE_UNUSABLE', '二维码已失效，请回到一体机重新生成')))
    env.openLink(UPLOAD_LINK)
    await flush()
    assert.equal(env.page.data.sceneFailed, true, String(statusCode))
    assert.equal(env.page.data.resolveRetry, false, String(statusCode))
    assert.equal(env.page.data.errorMsg, DEAD_COPY)
    env.page.retry()
    assert.equal(env.sceneCalls.length, 1)
  }

  // 别的 4xx 也是码这一侧的问题：同样回一体机刷新，不给重试
  for (const err of [httpError(400, 'VALIDATION_FAILED', 'VALIDATION_FAILED'), httpError(403, '', ''), httpError(404, 'Not Found', '服务器内部错误')]) {
    const env = harness(() => Promise.resolve(receipt()))
    env.setScene(() => Promise.reject(err))
    env.page.onLoad({ scene: 'scene-4xx-case' })
    await flush()
    assert.equal(env.page.data.sceneFailed, true, String(err.statusCode))
    assert.equal(env.page.data.resolveRetry, false)
    assert.equal(env.page.data.errorMsg, DEAD_COPY)
    env.page.retry()
    assert.equal(env.sceneCalls.length, 1)
  }
})

test('scene 兑换回执不完整：没拿到结论，可以重试；令牌不进 data', async () => {
  for (const body of [null, {}, { sessionId: SESSION }, { uploadToken: TOKEN }]) {
    const env = harness(() => Promise.resolve(receipt()))
    env.setScene((_scene, n) => (n === 1 ? Promise.resolve(body) : Promise.resolve({ sessionId: SESSION, uploadToken: TOKEN, purpose: 'print_doc' })))
    env.page.onLoad({ scene: 'scene-empty' })
    await flush()
    assert.equal(env.page.data.sceneFailed, false, JSON.stringify(body))
    assert.equal(env.page.data.resolveRetry, true)
    assert.equal(env.page.data.canRetry, false)
    assert.equal(env.page.data.phase, 'error')
    assert.equal(env.page.data.errorMsg, OFFLINE_COPY)
    assert.equal(JSON.stringify(env.page.data).includes(TOKEN), false)
    // 没连上之前，聊天文件那条路也走不了
    env.wx.setChosen(FILE)
    env.page.chooseAndSend()
    assert.equal(env.uploads.length, 0)
    env.page.retry()
    assert.equal(env.sceneCalls.length, 2)
    assert.equal(env.sceneCalls[1], 'scene-empty')
    await flush()
    assert.equal(env.page.data.phase, 'idle')
    assertTokenStaysInMemory(env.page)
  }
})

test('scene 带回的用途提示不能当成上传成功', async () => {
  const env = harness(() => Promise.resolve(receipt({ purpose: 'signature_image' })))
  env.setScene(() => Promise.resolve({
    sessionId: SESSION,
    uploadToken: TOKEN,
    purpose: 'print_doc',
    mode: 'member',
  }))
  env.page.onLoad({ scene: 'scene-ok' })
  await flush()
  assert.equal(env.page.data.phase, 'idle')
  assertTokenStaysInMemory(env.page)
  env.page._send(FILE)
  await flush()
  assertUnknown(env.page)
  assert.equal(env.uploads.length, 1)
  assert.equal(env.page.data.phase !== 'done', true)
})

test('入口缺凭据时不上传，也不给出会再发一次的重试', () => {
  const env = harness(() => Promise.reject(new Error('should not upload')))
  env.page.onLoad({ sessionId: SESSION })
  assert.equal(env.page.data.phase, 'error')
  assert.equal(env.page.data.canRetry, false)
  env.page.retry()
  env.page.chooseAndSend()
  env.page._send(FILE)
  assert.equal(env.uploads.length, 0)
  assert.equal(env.page.data.phase, 'error')
})

test('成功按钮是回一体机继续，页面不再提供再传一份', () => {
  const wxml = fs.readFileSync(path.join(MINIAPP, 'pages/kiosk-send/kiosk-send.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(MINIAPP, PAGE), 'utf8')
  assert.equal(wxml.includes('再传一份'), false)
  assert.equal(js.includes('再传一份'), false)
  assert.match(wxml, /phase === 'done'[\s\S]*回一体机继续/)
  assert.equal(/phase === 'done'[\s\S]*bindtap="chooseAndSend"/.test(wxml), false)
  assert.match(wxml, /phase === 'unknown'[\s\S]*回一体机核对/)
  assert.match(wxml, /canRetry/)
  // 2026-10-29 规则变更：原断言「本页不 require auth」。本页多了「从我的文档选」（要登录），
  // 必须读登录态；「聊天文件这条路不要求登录」改由下面的用例按行为验证，并钉住 api 门面不带登录。
  const apiJs = fs.readFileSync(path.join(MINIAPP, 'utils/api.js'), 'utf8')
  const chatBlock = apiJs.slice(apiJs.indexOf('uploadToKioskSession(sessionId'), apiJs.indexOf('sendMemberFileToKioskSession(sessionId'))
  assert.match(chatBlock, /needAuth: false/)
  const memberBlock = apiJs.slice(apiJs.indexOf('sendMemberFileToKioskSession(sessionId'), apiJs.indexOf('uploadPrintFile(filePath'))
  assert.match(memberBlock, /\/member-file`/)
  assert.match(memberBlock, /needAuth: true/)
  assert.match(memberBlock, /data: \{ uploadToken, fileId \}/)
})

// 上面那条注释说的「下面的用例」（聊天文件这条路不要求登录：没登录照样能递，也不去拉我的文档）标题含「我的文档」，挪到了 kiosk-send-docs.test.mjs。

// ══════════════════════════════════════════════════════════════════════
// 2026-10-29：微信扫一扫直达（q）、兑换可重试；从「我的文档」选的那批在 kiosk-send-docs.test.mjs
// ══════════════════════════════════════════════════════════════════════

test('q 是一体机的新传文件码：解一次、按 scene 兑换，scene 和令牌都不进 data', async () => {
  const env = harness(() => Promise.resolve(receipt()))
  env.openLink(UPLOAD_LINK)
  await flush()
  assert.equal(env.sceneCalls.length, 1)
  assert.equal(env.sceneCalls[0], SCENE)
  assert.equal(env.page.data.phase, 'idle')
  assert.equal(env.page.data.sessionId, SESSION)
  assertTokenStaysInMemory(env.page)
  assert.equal(JSON.stringify(env.page.data).includes(SCENE), false, 'scene 也是凭据，不进 data')
  assert.equal(env.wx.calls.redirect.length, 0)
  // 回到前台不会自动再兑换
  env.page.onShow()
  await flush()
  assert.equal(env.sceneCalls.length, 1)

  // 带后缀的也认（微信另带 scancode_time；码末尾可能有 / ? #）
  for (const raw of [`${UPLOAD_LINK}/`, `${UPLOAD_LINK}?from=kiosk`, `${UPLOAD_LINK}#x`]) {
    const e2 = harness(() => Promise.resolve(receipt()))
    e2.openLink(raw)
    await flush()
    assert.equal(e2.sceneCalls[0], SCENE, raw)
    assert.equal(e2.page.data.phase, 'idle', raw)
  }
})

test('q 是旧传文件码（# 后面带 sessionId / token）：直接连上，不兑换', async () => {
  // 真实会话 id 是 32 位 hex；本文件其余用例的 'sess-1' 太短，旧码规则（≥8 位）不认
  const longSession = '3f9c2a7be4d1458a9c06b7e2d5f81a34'
  const env = harness(() => Promise.resolve(receipt({ sessionId: longSession })))
  env.openLink(`https://kiosk.example.cn/upload/phone#sessionId=${longSession}&token=${TOKEN}&purpose=print_doc`)
  await flush()
  assert.equal(env.sceneCalls.length, 0)
  assert.equal(env.page.data.phase, 'idle')
  assert.equal(env.page.data.sessionId, longSession)
  assertTokenStaysInMemory(env.page)
  env.page._send(FILE)
  await flush()
  assert.equal(env.uploads[0][0], longSession)
  assert.equal(env.uploads[0][1], TOKEN)
  assert.equal(env.page.data.phase, 'done')
})

test('q 是一体机的登录码：整条码原样转给扫码登录页，本页不兑换', async () => {
  const env = harness(() => Promise.resolve(receipt()))
  env.openLink(LOGIN_LINK)
  await flush()
  assert.equal(env.sceneCalls.length, 0)
  assert.equal(env.wx.calls.redirect.length, 1)
  const url = env.wx.calls.redirect[0]
  assert.equal(url, `/pages/kiosk-login/kiosk-login?q=${encodeURIComponent(LOGIN_LINK)}`)
  // 登录页照微信的规矩解一次就是原码
  assert.equal(decodeURIComponent(url.slice(url.indexOf('?q=') + 3)), LOGIN_LINK)
  assert.equal(env.page.data.phase, 'resolving')
  env.page.chooseAndSend()
  assert.equal(env.wx.calls.choose, 0)

  // 打不开登录页：说清楚，不留一个转圈的页面
  const failing = harness(() => Promise.resolve(receipt()))
  failing.wx.setRedirectFails(true)
  failing.openLink(LOGIN_LINK)
  assert.equal(failing.page.data.phase, 'error')
  assert.equal(failing.page.data.canRetry, false)
  assert.match(failing.page.data.errorMsg, /扫码登录页/)
})

test('q 不是一体机的码：直说不是，不兑换、不给重试', async () => {
  for (const q of [
    encodeURIComponent('https://example.com/?foo=bar'),
    encodeURIComponent(`https://zlixc.com/k/u/${SCENE.slice(0, 10)}`),
    encodeURIComponent(`javascript:alert(1)//k/u/${SCENE}`),
    '%E0%A4%A',
  ]) {
    const env = harness(() => Promise.resolve(receipt()))
    env.page.onLoad({ q })
    await flush()
    assert.equal(env.page.data.phase, 'error', q)
    assert.equal(env.page.data.errorMsg, NOT_KIOSK_COPY)
    assert.equal(env.page.data.canRetry, false)
    assert.equal(env.page.data.resolveRetry, false)
    env.page.retry()
    env.page.chooseAndSend()
    await flush()
    assert.equal(env.sceneCalls.length, 0)
    assert.equal(env.wx.calls.redirect.length, 0)
    assert.equal(env.uploads.length, 0)
  }
})

test('兑换没回应、超时、5xx：说「没连上终端，可以重试」，重试会用同一张码再兑换一次', async () => {
  const cases = [
    [httpError(-1, 'NETWORK_ERROR', '网络连接失败，请检查网络后重试'), OFFLINE_COPY],
    [httpError(408, '', ''), OFFLINE_COPY],
    [httpError(500, 'INTERNAL', '服务器内部错误'), OFFLINE_COPY],
    [httpError(502, '', ''), OFFLINE_COPY],
    [httpError(503, 'MAINTENANCE_MODE', ''), OFFLINE_COPY],
    [httpError(429, 'RATE_LIMITED', '尝试过于频繁，请稍后再试'), '尝试过于频繁，请稍后再试'],
    [new Error('socket hang up'), OFFLINE_COPY],
  ]
  for (const [err, copy] of cases) {
    const env = harness(() => Promise.resolve(receipt()))
    env.setScene((_s, n) => (n === 1 ? Promise.reject(err) : Promise.resolve({ sessionId: SESSION, uploadToken: TOKEN, purpose: 'resume_upload' })))
    env.openLink(UPLOAD_LINK)
    await flush()
    assert.equal(env.page.data.phase, 'error', String(err.statusCode))
    assert.equal(env.page.data.resolveRetry, true)
    assert.equal(env.page.data.sceneFailed, false)
    assert.equal(env.page.data.canRetry, false)
    assert.equal(env.page.data.errorMsg, copy)
    assert.equal(/socket|timeout|服务器内部错误|NETWORK_ERROR/.test(env.page.data.errorMsg), false)
    env.page.retry()
    assert.equal(env.page.data.phase, 'resolving')
    env.page.retry() // 兑换进行中连点不叠第二次
    assert.equal(env.sceneCalls.length, 2)
    assert.equal(env.sceneCalls[1], SCENE)
    await flush()
    assert.equal(env.page.data.phase, 'idle')
    assertTokenStaysInMemory(env.page)
    assert.equal(JSON.stringify(env.page.data).includes(SCENE), false)
  }
})

test('返回键：扫码直达时本页在栈底，回首页', () => {
  const env = harness(() => Promise.resolve(receipt()))
  env.openLink(UPLOAD_LINK)
  env.page.goBack()
  assert.equal(env.wx.calls.back, 1)
  assert.equal(env.wx.calls.tab, 1)
  assert.equal(env.wx.calls.tabUrl, '/pages/home/home')
})
