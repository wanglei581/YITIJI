/**
 * 小程序「传文件到一体机」从「我的文档」选的真执行测试（从 kiosk-send-receipt.test.mjs 拆出）。
 *
 * 2026-10-29 起文件多了一个来源「从我的文档选」（要登录，POST /upload-sessions/:id/member-file），
 * 去登录再回来令牌还在页面内存里；换了账号只清列表。说法与一体机同一句。
 * 回执的判法与聊天文件那条路同一套：完整回执才算已收到，结果说不清的不能再递。
 * 共用的页面沙箱与替身在 kiosk-send-harness.mjs。
 *
 * 由 verify:page-lifecycle 拉起，并因此进入 verify:static。不发网络请求。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  MINIAPP, SESSION, TOKEN, FILE, UNKNOWN_COPY, BUSY_COPY, DEAD_COPY, REJECT_FALLBACK,
  DOC_NOT_FOUND_COPY, DOC_TOO_LARGE_COPY, MEMBER_MISMATCH_COPY, LOGIN_EXPIRED_COPY, UPLOAD_LINK,
  DOCS,
  myDoc, listOf, tap, receipt, httpError, harness, assertTokenStaysInMemory, assertUnknown,
  deferred, flush,
} from './kiosk-send-harness.mjs'

// kiosk-send-receipt.test.mjs「成功按钮是回一体机继续，页面不再提供再传一份」那条注释里说的「下面的用例」就是这条。
test('聊天文件这条路不要求登录：没登录照样能递，也不去拉我的文档', async () => {
  const env = harness(() => Promise.resolve(receipt()), { loggedIn: false })
  env.openDirect()
  await flush()
  assert.equal(env.page.data.docState, 'login')
  assert.equal(env.docCalls.length, 0)
  env.wx.setChosen(FILE)
  env.page.chooseAndSend()
  await flush()
  assert.equal(env.uploads.length, 1)
  assert.equal(env.page.data.phase, 'done')
  assert.equal(env.wx.calls.navigate.length, 0, '递文件不该把人带去登录')
})

test('已登录：列「我的文档」，过期的不列，超过 10MB 的列出但不能选，有下一页就说只列了最近 50 份', async () => {
  const env = harness(() => Promise.reject(new Error('should not upload')), {
    loggedIn: true,
    docs: () => Promise.resolve(listOf(DOCS, 'cursor-page-2')),
  })
  env.openDirect()
  await flush()
  assert.equal(env.docCalls.length, 1)
  assert.equal(env.docCalls[0].pageSize, 50)
  assert.equal(env.page.data.docState, 'list')
  assert.equal(env.page.data.docTruncated, true)
  const docs = env.page.data.docs
  assert.equal(docs.map((d) => d.id).join(','), 'file-resume-v3,file-degree,file-portfolio,file-exact-10mb,file-photo')
  assert.equal(docs.some((d) => d.id === 'file-old-id'), false, '已过期的不列')
  const byId = Object.fromEntries(docs.map((d) => [d.id, d]))
  assert.equal(byId['file-resume-v3'].name, '王晓雯-2026届-简历.pdf')
  assert.equal(byId['file-resume-v3'].meta, '262 KB · 2026-10-20')
  assert.equal(byId['file-degree'].meta, '1.7 MB · 2026-10-18')
  assert.equal(byId['file-portfolio'].tooLarge, true)
  assert.equal(byId['file-exact-10mb'].tooLarge, false, '正好 10MB 能传')
  assert.equal(byId['file-photo'].meta, '94 KB', '日期读不出来就不写日期')
  assertTokenStaysInMemory(env.page)

  // 超过 10MB 的点了没反应：不弹确认、不发请求
  env.page.pickDoc(tap('file-portfolio'))
  env.page.pickDoc(tap('file-old-id'))
  env.page.pickDoc(tap('not-in-list'))
  assert.equal(env.wx.calls.modal.length, 0)
  assert.equal(env.memberCalls.length, 0)

  // 取消确认：不发
  env.wx.setModalConfirm(false)
  env.page.pickDoc(tap('file-degree'))
  assert.equal(env.wx.calls.modal[0], '把《学位证书扫描件.pdf》传给这台一体机？')
  assert.equal(env.memberCalls.length, 0)
  assert.equal(env.page.data.phase, 'idle')

  const wxml = fs.readFileSync(path.join(MINIAPP, 'pages/kiosk-send/kiosk-send.wxml'), 'utf8')
  assert.match(wxml, /超过 10MB，这一单收不了/)
  assert.match(wxml, /只列了最近 50 份/)
  assert.match(wxml, /我的文档里还没有能传的文件/)
  assert.match(wxml, /bindtap="chooseAndSend">从微信聊天选文件</)
  assert.match(wxml, /bindtap="goLogin">登录后从我的文档选</)
})

test('我的文档：没有能传的（全过期或空）就如实说，没有下一页就不提 50 份', async () => {
  for (const items of [[], [DOCS[2]], listOf([DOCS[2]], null)]) {
    const env = harness(() => Promise.resolve(receipt()), { loggedIn: true, docs: () => Promise.resolve(items) })
    env.openDirect()
    await flush()
    assert.equal(env.page.data.docState, 'empty')
    assert.equal(env.page.data.docs.length, 0)
    assert.equal(env.page.data.docTruncated, false)
  }
  // 没读到：可以重新读取；读到之前不能递
  let n = 0
  const env = harness(() => Promise.resolve(receipt()), {
    loggedIn: true,
    docs: () => { n += 1; return n === 1 ? Promise.reject(httpError(500, 'INTERNAL', '服务器内部错误')) : Promise.resolve(DOCS.slice(0, 2)) },
  })
  env.openDirect()
  await flush()
  assert.equal(env.page.data.docState, 'error')
  assert.equal(env.page.data.docNote, '我的文档这次没读到，可以重新读取。')
  env.page.pickDoc(tap('file-resume-v3'))
  assert.equal(env.memberCalls.length, 0)
  env.page.reloadDocs()
  await flush()
  assert.equal(env.docCalls.length, 2)
  assert.equal(env.page.data.docState, 'list')
  assert.equal(env.page.data.docNote, '')
})

test('从我的文档递：确认后用内存里的令牌递过去，完整回执才算收到，说法与一体机同一句', async () => {
  const env = harness(() => Promise.reject(new Error('should not upload')), {
    loggedIn: true,
    docs: () => Promise.resolve(DOCS),
    member: () => Promise.resolve(receipt({ purpose: 'resume_upload', file: { fileId: 'copy-of-resume', filename: '王晓雯-2026届-简历.pdf' } })),
  })
  env.openDirect()
  await flush()
  env.page.pickDoc(tap('file-resume-v3'))
  assert.equal(env.wx.calls.modal[0], '把《王晓雯-2026届-简历.pdf》传给这台一体机？')
  await flush()
  assert.equal(env.memberCalls.length, 1)
  assert.equal(env.memberCalls[0][0], SESSION)
  assert.equal(env.memberCalls[0][1], TOKEN)
  assert.equal(env.memberCalls[0][2], 'file-resume-v3')
  assert.equal(env.uploads.length, 0, '我的文档那条路不走聊天文件上传')
  assert.equal(env.page.data.phase, 'done')
  assert.equal(env.page.data.sent.length, 1)
  assert.equal(env.page.data.sent[0].name, '王晓雯-2026届-简历.pdf')
  assert.equal(env.wx.calls.loading, 1)
  assert.equal(env.wx.calls.hide, 1)
  assertTokenStaysInMemory(env.page)
  const wxml = fs.readFileSync(path.join(MINIAPP, 'pages/kiosk-send/kiosk-send.wxml'), 'utf8')
  assert.match(wxml, /已传给这台一体机：《\{\{sent\[0\]\.name\}\}》/)
  assert.match(wxml, /请回到一体机屏幕确认后继续。/)

  // 回执不完整 / 别的会话 / 非上传成功态：结果未知，不能说收到，也不能再递
  for (const body of [null, {}, { status: 'uploaded' }, receipt({ sessionId: 'sess-other' }), receipt({ file: { fileId: '' } }), receipt({ status: 'pending' }), receipt({ purpose: 'signature_image' })]) {
    const e2 = harness(() => Promise.resolve(receipt()), { loggedIn: true, docs: () => Promise.resolve(DOCS), member: () => Promise.resolve(body) })
    e2.openDirect()
    await flush()
    e2.page.pickDoc(tap('file-degree'))
    await flush()
    assertUnknown(e2.page)
    e2.page.pickDoc(tap('file-resume-v3'))
    e2.wx.setChosen(FILE)
    e2.page.chooseAndSend()
    await flush()
    assert.equal(e2.memberCalls.length, 1, JSON.stringify(body))
    assert.equal(e2.uploads.length, 0)
  }
})

test('一张码只收一份：哪条路收到了，两条路都不再递', async () => {
  // 我的文档递成了
  const a = harness(() => Promise.resolve(receipt()), { loggedIn: true, docs: () => Promise.resolve(DOCS) })
  a.openDirect()
  await flush()
  a.page.pickDoc(tap('file-resume-v3'))
  await flush()
  assert.equal(a.page.data.phase, 'done')
  a.page.pickDoc(tap('file-degree'))
  a.page._sendMemberFile({ id: 'file-degree', name: '学位证书扫描件.pdf' })
  a.wx.setChosen(FILE)
  a.page.chooseAndSend()
  a.page._send(FILE)
  a.page.retry()
  await flush()
  assert.equal(a.memberCalls.length, 1)
  assert.equal(a.uploads.length, 0)
  assert.equal(a.wx.calls.choose, 0)
  assert.equal(a.page.data.sent.length, 1)
  assert.equal(a.page.data.sent[0].name, '王晓雯-2026届-简历.pdf')

  // 聊天文件递成了
  const b = harness(() => Promise.resolve(receipt()), { loggedIn: true, docs: () => Promise.resolve(DOCS) })
  b.openDirect()
  await flush()
  b.page._send(FILE)
  await flush()
  assert.equal(b.page.data.phase, 'done')
  b.page.pickDoc(tap('file-resume-v3'))
  b.page._sendMemberFile({ id: 'file-resume-v3', name: '王晓雯-2026届-简历.pdf' })
  await flush()
  assert.equal(b.memberCalls.length, 0)
  assert.equal(b.wx.calls.modal.length, 0)

  // 递的途中再点：只发一次
  const pending = deferred()
  const c = harness(() => Promise.resolve(receipt()), { loggedIn: true, docs: () => Promise.resolve(DOCS), member: () => pending.promise })
  c.openDirect()
  await flush()
  c.page.pickDoc(tap('file-resume-v3'))
  c.page.pickDoc(tap('file-degree'))
  c.page._sendMemberFile({ id: 'file-degree', name: '学位证书扫描件.pdf' })
  c.wx.setChosen(FILE)
  c.page.chooseAndSend()
  assert.equal(c.memberCalls.length, 1)
  assert.equal(c.uploads.length, 0)
  assert.equal(c.page.data.phase, 'uploading')
  pending.resolve(receipt())
  await flush()
  assert.equal(c.page.data.phase, 'done')
})

test('没登录：先去登录，回来自动列我的文档，这一单的令牌和会话都还在', async () => {
  const env = harness(() => Promise.reject(new Error('should not upload')), {
    loggedIn: false,
    docs: () => Promise.resolve(DOCS.slice(0, 2)),
  })
  env.openLink(UPLOAD_LINK)
  await flush()
  assert.equal(env.page.data.phase, 'idle')
  assert.equal(env.page.data.docState, 'login')
  assert.equal(env.docCalls.length, 0)
  env.page.pickDoc(tap('file-resume-v3'))
  assert.equal(env.memberCalls.length, 0)
  env.page.goLogin()
  assert.equal(env.wx.calls.navigate.length, 1)
  assert.equal(env.wx.calls.navigate[0], '/pages/launch/launch')

  // 在登录页没登成就回来：什么都不变
  env.page.onShow()
  await flush()
  assert.equal(env.docCalls.length, 0)
  assert.equal(env.page.data.docState, 'login')

  // 登录页登完 navigateBack：本页实例还在
  env.loginAs(true)
  await flush()
  assert.equal(env.docCalls.length, 1)
  assert.equal(env.page.data.docState, 'list')
  assert.equal(env.page.data.docs.length, 2)
  assert.equal(env.sceneCalls.length, 1, '回来不再兑换')
  assert.equal(env.page.data.sessionId, SESSION)
  assertTokenStaysInMemory(env.page)
  env.page.pickDoc(tap('file-resume-v3'))
  await flush()
  assert.equal(env.memberCalls.length, 1)
  assert.equal(env.memberCalls[0][1], TOKEN)
  assert.equal(env.page.data.phase, 'done')
})

test('本页期间换了账号：上一个账号的列表清掉、按新账号重拉；读到一半换人，晚到的旧列表不落屏', async () => {
  const A = [myDoc('a-1', '王晓雯-2026届-简历.pdf', 268412)]
  const B = [myDoc('b-1', '李梓涵-求职材料.pdf', 523311), myDoc('b-2', '李梓涵-成绩单.pdf', 302114)]
  const slowA = deferred()
  const env = harness(() => Promise.resolve(receipt()), {
    loggedIn: true,
    docs: (_p, n) => (n === 1 ? slowA.promise : Promise.resolve(B)),
  })
  env.openDirect()
  // A 的列表还在路上，换成 B
  env.session.gen += 1
  env.page.onShow()
  await flush()
  assert.equal(env.docCalls.length, 2)
  assert.equal(env.page.data.docs.map((d) => d.id).join(','), 'b-1,b-2')
  slowA.resolve(A)
  await flush()
  assert.equal(env.page.data.docs.map((d) => d.id).join(','), 'b-1,b-2', 'A 的列表晚到也不能落到 B 的屏上')
  assert.equal(JSON.stringify(env.page.data).includes('王晓雯'), false)

  // 再换回列表：先清空，再拉
  const later = deferred()
  env.setDocs(() => later.promise)
  env.session.gen += 1
  env.page.onShow()
  assert.equal(env.page.data.docs.length, 0, '换人那一刻就清掉上一个账号的列表')
  assert.equal(env.page.data.docState, 'loading')
  later.resolve(A)
  await flush()
  assert.equal(env.page.data.docs.map((d) => d.id).join(','), 'a-1')

  // 列表还在路上、本页还没回到前台（onShow 没跑）就换了人：A 的列表不落屏，按现在的账号重拉
  const inFlight = deferred()
  env.setDocs((_p, k) => (k === 4 ? inFlight.promise : Promise.resolve(B)))
  env.session.gen += 1
  env.page.onShow()
  env.session.gen += 1
  inFlight.resolve(A)
  await flush()
  await flush()
  assert.equal(env.docCalls.length, 5)
  assert.equal(env.page.data.docs.map((d) => d.id).join(','), 'b-1,b-2', '换人之后读回来的上一份列表不能落屏')

  // 退出登录：列表清掉，回到「登录后从我的文档选」，不再请求
  env.loginAs(false)
  await flush()
  assert.equal(env.page.data.docState, 'login')
  assert.equal(env.page.data.docs.length, 0)
  assert.equal(env.docCalls.length, 5)
  // 账号怎么变，这一单的令牌都还在
  assertTokenStaysInMemory(env.page)
})

test('我的文档那份没递成：找不到 / 超 10MB / 类型不收都回到能重选，各说一句', async () => {
  // FILE_NOT_FOUND：重拉列表，换一份能递
  let n = 0
  const notFound = harness(() => Promise.resolve(receipt()), {
    loggedIn: true,
    docs: () => Promise.resolve(DOCS),
    member: () => { n += 1; return n === 1 ? Promise.reject(httpError(404, 'FILE_NOT_FOUND', 'FILE_NOT_FOUND')) : Promise.resolve(receipt()) },
  })
  notFound.openDirect()
  await flush()
  notFound.page.pickDoc(tap('file-degree'))
  await flush()
  assert.equal(notFound.page.data.phase, 'idle')
  assert.equal(notFound.page.data.docNote, DOC_NOT_FOUND_COPY)
  assert.equal(notFound.docCalls.length, 2, '找不到说明列表旧了，重拉一次')
  assert.equal(notFound.page.data.docState, 'list')
  notFound.page.pickDoc(tap('file-resume-v3'))
  await flush()
  assert.equal(notFound.memberCalls.length, 2)
  assert.equal(notFound.page.data.phase, 'done')
  assert.equal(notFound.page.data.sent[0].name, '王晓雯-2026届-简历.pdf')

  // FILE_TOO_LARGE：那一行改成不能选，别的照常
  const tooLarge = harness(() => Promise.resolve(receipt()), {
    loggedIn: true,
    docs: () => Promise.resolve([myDoc('no-size', '毕业设计-终稿.pdf', null), ...DOCS.slice(0, 2)]),
    member: (_s, _t, fileId) => (fileId === 'no-size' ? Promise.reject(httpError(400, 'FILE_TOO_LARGE', '文件超过 10MB，这台一体机这一单收不了')) : Promise.resolve(receipt())),
  })
  tooLarge.openDirect()
  await flush()
  assert.equal(tooLarge.page.data.docs[0].meta, '大小未知 · 2026-10-20')
  tooLarge.page.pickDoc(tap('no-size'))
  await flush()
  assert.equal(tooLarge.page.data.phase, 'idle')
  assert.equal(tooLarge.page.data.docNote, DOC_TOO_LARGE_COPY)
  assert.equal(tooLarge.page.data.docs[0].tooLarge, true)
  tooLarge.page.pickDoc(tap('no-size'))
  assert.equal(tooLarge.memberCalls.length, 1, '同一份不再递')
  tooLarge.page.pickDoc(tap('file-degree'))
  await flush()
  assert.equal(tooLarge.memberCalls.length, 2)
  assert.equal(tooLarge.page.data.phase, 'done')

  // 类型不被这一单收、限流：照 userMessageOf 说，不露机器码，能换一份
  for (const [err, copy] of [
    [httpError(400, 'FILE_MIME_NOT_ALLOWED', 'FILE_MIME_NOT_ALLOWED'), REJECT_FALLBACK],
    [httpError(400, 'VALIDATION_FAILED', 'VALIDATION_FAILED'), '提交内容有误，请检查后重试'],
    [httpError(429, 'RATE_LIMITED', '尝试过于频繁，请稍后再试'), '尝试过于频繁，请稍后再试'],
  ]) {
    let m = 0
    const env = harness(() => Promise.resolve(receipt()), {
      loggedIn: true,
      docs: () => Promise.resolve(DOCS),
      member: () => { m += 1; return m === 1 ? Promise.reject(err) : Promise.resolve(receipt()) },
    })
    env.openDirect()
    await flush()
    env.page.pickDoc(tap('file-degree'))
    await flush()
    assert.equal(env.page.data.phase, 'idle', err.code)
    assert.equal(env.page.data.docNote, copy)
    assert.equal(/FILE_|VALIDATION|RATE_/.test(env.page.data.docNote), false)
    env.page.pickDoc(tap('file-resume-v3'))
    await flush()
    assert.equal(env.memberCalls.length, 2, err.code)
    assert.equal(env.page.data.phase, 'done')
  }
})

test('一体机登录的是另一个账号：这张码不能再从我的文档递，换账号也不解开；聊天文件照旧', async () => {
  const env = harness(() => Promise.resolve(receipt()), {
    loggedIn: true,
    docs: () => Promise.resolve(DOCS),
    member: () => Promise.reject(httpError(403, 'UPLOAD_SESSION_MEMBER_MISMATCH', '这台一体机现在登录的是另一个账号，不能把你的文档传进去')),
  })
  env.openDirect()
  await flush()
  env.page.pickDoc(tap('file-resume-v3'))
  await flush()
  assert.equal(env.page.data.phase, 'idle')
  assert.equal(env.page.data.docState, 'blocked')
  assert.equal(env.page.data.docNote, MEMBER_MISMATCH_COPY)
  assert.equal(env.page.data.docs.length, 0)
  env.page.pickDoc(tap('file-degree'))
  env.page._sendMemberFile({ id: 'file-degree', name: '学位证书扫描件.pdf' })
  await flush()
  assert.equal(env.memberCalls.length, 1)

  env.session.gen += 1
  env.page.onShow()
  await flush()
  assert.equal(env.page.data.docState, 'blocked')
  env.page._sendMemberFile({ id: 'file-degree', name: '学位证书扫描件.pdf' })
  await flush()
  assert.equal(env.memberCalls.length, 1)

  env.wx.setChosen(FILE)
  env.page.chooseAndSend()
  await flush()
  assert.equal(env.uploads.length, 1)
  assert.equal(env.page.data.phase, 'done')
})

test('递的时候登录失效（401）：这份没传过去，回到「登录后从我的文档选」，登录回来接着用这一单', async () => {
  const env = harness(() => Promise.resolve(receipt()), { loggedIn: true, docs: () => Promise.resolve(DOCS.slice(0, 2)) })
  env.setMember(() => {
    // request.js 补签失败会 logoutIfSameSession：代号推进、登录态消失
    env.session.loggedIn = false
    env.session.gen += 1
    return Promise.reject(httpError(401, 'MEMBER_SESSION_EXPIRED', '会话已失效,请重新登录'))
  })
  env.openDirect()
  await flush()
  env.page.pickDoc(tap('file-resume-v3'))
  await flush()
  assert.equal(env.page.data.phase, 'idle')
  assert.equal(env.page.data.docState, 'login')
  assert.equal(env.page.data.docNote, LOGIN_EXPIRED_COPY)
  assert.equal(env.page.data.docs.length, 0)
  env.page.pickDoc(tap('file-degree'))
  assert.equal(env.memberCalls.length, 1)
  // 回到前台（没重新登录）：不反复请求
  env.page.onShow()
  await flush()
  assert.equal(env.docCalls.length, 1)

  env.setMember(() => Promise.resolve(receipt()))
  env.loginAs(true)
  await flush()
  assert.equal(env.page.data.docState, 'list')
  env.page.pickDoc(tap('file-degree'))
  await flush()
  assert.equal(env.memberCalls.length, 2)
  assert.equal(env.memberCalls[1][1], TOKEN)
  assert.equal(env.page.data.phase, 'done')

  // 没被登出、但服务端说 401：同样回到登录这一步
  const still = harness(() => Promise.resolve(receipt()), {
    loggedIn: true,
    docs: () => Promise.resolve(DOCS.slice(0, 2)),
    member: () => Promise.reject(httpError(401, 'MEMBER_AUTH_REQUIRED', '请先登录')),
  })
  still.openDirect()
  await flush()
  still.page.pickDoc(tap('file-resume-v3'))
  await flush()
  assert.equal(still.page.data.docState, 'login')
  assert.equal(still.page.data.docNote, LOGIN_EXPIRED_COPY)
  still.wx.setChosen(FILE)
  still.page.chooseAndSend()
  await flush()
  assert.equal(still.uploads.length, 1, '聊天文件那条路不受影响')
})

test('我的文档那份：码已不能再传、正在收、结果说不清，都不给再递', async () => {
  const cases = [
    ...['UPLOAD_SESSION_EXPIRED', 'UPLOAD_SESSION_NOT_PENDING', 'UPLOAD_SESSION_NOT_FOUND', 'UPLOAD_TOKEN_INVALID'].map((code) => [httpError(code === 'UPLOAD_TOKEN_INVALID' ? 403 : 400, code, code), 'error', DEAD_COPY]),
    [httpError(400, 'UPLOAD_SESSION_UPLOAD_IN_PROGRESS', '该二维码正在上传中,请稍候'), 'unknown', BUSY_COPY],
    [httpError(-1, 'NETWORK_ERROR', '网络连接失败，请检查网络后重试'), 'unknown', UNKNOWN_COPY],
    [httpError(500, 'INTERNAL', '服务器内部错误'), 'unknown', UNKNOWN_COPY],
    [httpError(408, '', ''), 'unknown', UNKNOWN_COPY],
    [new Error('socket hang up'), 'unknown', UNKNOWN_COPY],
  ]
  for (const [err, phase, copy] of cases) {
    const env = harness(() => Promise.resolve(receipt()), { loggedIn: true, docs: () => Promise.resolve(DOCS), member: () => Promise.reject(err) })
    env.openDirect()
    await flush()
    env.page.pickDoc(tap('file-resume-v3'))
    await flush()
    assert.equal(env.page.data.phase, phase, String(err.code))
    assert.equal(env.page.data.errorMsg, copy)
    assert.equal(env.page.data.canRetry, false)
    assert.equal(env.page.data.sent.length, 0)
    env.page.retry()
    env.page.pickDoc(tap('file-degree'))
    env.page._sendMemberFile({ id: 'file-degree', name: '学位证书扫描件.pdf' })
    env.wx.setChosen(FILE)
    env.page.chooseAndSend()
    await flush()
    assert.equal(env.memberCalls.length, 1, String(err.code))
    assert.equal(env.uploads.length, 0)
    assert.equal(env.page.data.phase, phase)
  }
})
