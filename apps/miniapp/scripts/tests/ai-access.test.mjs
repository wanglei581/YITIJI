/**
 * 用 AI 之前的两项声明（C6）与登录提示（C7）的**时序**测试：真跑 utils/request.js、
 * utils/ai-access.js、utils/api-legal-consent.js（以及 api.js 的合并），只有 wx 是替身。
 *
 * 要证明的不是「守卫代码在」，而是这几件事真的成立：
 *   - 确认之前请求不发出去；选「未满 / 改用手打」请求根本不发；
 *   - 未登录的请求带声明头，带会员令牌的不带（服务端对会员只认 /me/ai-consents，
 *     带了头会让别处撤回的录音同意被本机旧记录绕过去）；
 *   - 会员新声明先写服务端再发 AI 请求；
 *   - 服务端说缺声明时以服务端为准：清掉本机记录重新问，只重发一次，不打转；
 *   - 登录档位拒绝时弹一次登录提示，从没登录过的人不去静默补签；
 *   - 同时发出的两个 AI 请求只弹一个框；
 *   - 登录后对账尊重在别处的撤回；正式版取不到已发布的协议就不回落草稿。
 *
 * 末尾一组是反向变异：在内存里摘掉一处防护，断言对应场景判红（且红的是断言，不是崩溃）。
 * 由 `verify:ai-access` 拉起，串在 verify:static 里。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const UTILS = path.join(MINIAPP, 'utils')

const flush = async (rounds = 3) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

async function settle(promise, timeoutMs = 400) {
  let timer = null
  const watchdog = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: { code: 'TIMEOUT' } }), timeoutMs)
  })
  const settled = promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }))
  const result = await Promise.race([settled, watchdog])
  clearTimeout(timer)
  return result
}

function fakeToken(sub, ttlSeconds = 3600) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub, exp: Math.floor(Date.now() / 1000) + ttlSeconds })}.sig`
}

function createWx(envVersion) {
  const store = new Map()
  const calls = { request: [], upload: [], modal: [], nav: [], login: [] }
  const clone = (v) => JSON.parse(JSON.stringify(v))
  return {
    store,
    calls,
    getStorageSync: (key) => (store.has(key) ? store.get(key) : ''),
    setStorageSync: (key, value) => { store.set(key, clone(value)) },
    removeStorageSync: (key) => { store.delete(key) },
    request: (o) => { calls.request.push(o) },
    uploadFile: (o) => { calls.upload.push(o) },
    login: (o) => { calls.login.push(o) },
    showModal: (o) => { calls.modal.push(o) },
    navigateTo: (o) => { calls.nav.push(o && o.url) },
    getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
    getFileSystemManager: () => ({}),
  }
}

function createRuntime({ mutate, envVersion = 'release' } = {}) {
  const wx = createWx(envVersion)
  const sandbox = { wx, console, setTimeout, clearTimeout, getApp: () => ({ globalData: {} }) }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  const cache = new Map()
  const load = (name) => {
    if (cache.has(name)) return cache.get(name).exports
    const file = path.join(UTILS, `${name}.js`)
    let source = fs.readFileSync(file, 'utf8')
    if (mutate) source = mutate(name, source)
    const mod = { exports: {} }
    cache.set(name, mod)
    const compiled = vm.compileFunction(source, ['module', 'exports', 'require'], { parsingContext: sandbox, filename: file })
    compiled(mod, mod.exports, (spec) => load(String(spec).replace(/^\.\//, '').replace(/\.js$/, '')))
    return mod.exports
  }
  const ctx = {
    wx,
    auth: load('auth'),
    ai: load('ai-access'),
    net: load('request'),
    legal: load('api-legal-consent'), // 加载即向 request.js 注册 AI 前后置
    load,
  }
  ctx.aiCalls = () => wx.calls.request.filter((c) => !c.url.includes('/me/ai-consents'))
  ctx.consentCalls = () => wx.calls.request.filter((c) => c.url.includes('/me/ai-consents'))
  return ctx
}

const reply = (call, statusCode, body) => call.success({ statusCode, data: body })
const replyUpload = (call, statusCode, body) => call.success({ statusCode, data: JSON.stringify(body) })
const answer = (modal, confirm) => modal.success({ confirm, cancel: !confirm })
const header = (call, name) => (call && call.header ? call.header[name] : undefined)

function loginAs(ctx, sub = 'A') {
  assert.equal(ctx.auth.saveSession({ token: fakeToken(sub), user: { id: sub } }), true)
}

// ── 场景 ────────────────────────────────────────────────────────────────

/** 未登录：先问年龄，确认后才发；请求带年龄声明头、不带录音头，不写服务端。 */
async function anonymousGenerateAsksAgeThenSendsHeaders(opts) {
  const ctx = createRuntime(opts)
  const pending = settle(ctx.net.request('/resume/parse', { method: 'POST', ai: 'generate', needAuth: true }))
  await flush()
  assert.equal(ctx.wx.calls.modal.length, 1, '先弹年龄确认')
  assert.match(ctx.wx.calls.modal[0].title, /14 周岁/)
  assert.equal(ctx.aiCalls().length, 0, '确认之前不发请求')
  answer(ctx.wx.calls.modal[0], true)
  await flush()
  const call = ctx.aiCalls()[0]
  assert.ok(call, '确认后发出请求')
  assert.equal(header(call, 'X-Age-14-Plus'), 'declared')
  assert.equal(header(call, 'X-Age-14-Plus-Version'), 'age-14-plus-v1')
  assert.equal(header(call, 'X-Voice-Recording'), undefined, '生成类请求不带录音声明')
  assert.equal(header(call, 'Authorization'), undefined)
  reply(call, 200, { ok: 1 })
  const result = await pending
  assert.equal(result.ok, true)
  assert.equal(ctx.consentCalls().length, 0, '未登录不写 /me/ai-consents')
  assert.equal(ctx.ai.isDeclared('age_14_plus'), true, '本机记下声明')
}

/** 选「未满」：请求根本不发，给出小程序自己的说明。 */
async function declineBlocksRequest(opts) {
  const ctx = createRuntime(opts)
  const pending = settle(ctx.net.request('/resume/parse', { method: 'POST', ai: 'generate' }))
  await flush()
  answer(ctx.wx.calls.modal[0], false)
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'AI_AGE_NOT_DECLARED')
  assert.match(result.error.message, /监护人/)
  assert.equal(ctx.ai.isDeclined(result.error), true)
  assert.equal(ctx.wx.calls.request.length, 0, '一个请求都不发')
  assert.equal(ctx.ai.isDeclared('age_14_plus'), false)
}

/** 会员：新声明先写服务端再发 AI 请求；AI 请求带令牌、不带声明头。 */
async function memberGrantsFirstAndSendsNoHeaders(opts) {
  const ctx = createRuntime(opts)
  loginAs(ctx)
  const pending = settle(ctx.net.request('/resume/parse', { method: 'POST', ai: 'generate', needAuth: true }))
  await flush()
  answer(ctx.wx.calls.modal[0], true)
  await flush()
  const grant = ctx.consentCalls()[0]
  assert.ok(grant, '会员新声明要写服务端')
  assert.equal(grant.method, 'POST')
  assert.equal(grant.data.scope, 'age_14_plus')
  assert.match(header(grant, 'Authorization') || '', /^Bearer /)
  assert.equal(ctx.aiCalls().length, 0, '服务端记下之前不发 AI 请求')
  reply(grant, 200, { data: { scope: 'age_14_plus', granted: true } })
  await flush()
  const call = ctx.aiCalls()[0]
  assert.ok(call)
  assert.match(header(call, 'Authorization') || '', /^Bearer /)
  assert.equal(header(call, 'X-Age-14-Plus'), undefined, '带会员令牌的请求不带声明头')
  assert.equal(header(call, 'X-Age-14-Plus-Version'), undefined)
  reply(call, 200, { ok: 1 })
  assert.equal((await pending).ok, true)
}

/** 语音：先年龄、后录音，各问一次；录音同意写全五件事；两组头都带上。 */
async function voiceAsksBothInOrder(opts) {
  const ctx = createRuntime(opts)
  const pending = settle(ctx.net.uploadFile('/resume/voice/transcribe', 'wxfile://a.wav', { name: 'audio', ai: 'voice' }))
  await flush()
  assert.equal(ctx.wx.calls.modal.length, 1)
  assert.match(ctx.wx.calls.modal[0].title, /14 周岁/)
  answer(ctx.wx.calls.modal[0], true)
  await flush()
  assert.equal(ctx.wx.calls.modal.length, 2, '年龄之后再问录音')
  const consent = ctx.wx.calls.modal[1]
  assert.match(consent.title, /录音/)
  for (const must of ['转成文字', '腾讯云', '转完即删', '声纹', '撤回']) {
    assert.ok(consent.content.includes(must), `录音同意要写到「${must}」`)
  }
  assert.equal(ctx.wx.calls.upload.length, 0)
  answer(consent, true)
  await flush()
  const call = ctx.wx.calls.upload[0]
  assert.equal(header(call, 'X-Age-14-Plus'), 'declared')
  assert.equal(header(call, 'X-Voice-Recording'), 'granted')
  assert.equal(header(call, 'X-Voice-Recording-Version'), 'voice-recording-v1')
  replyUpload(call, 200, { text: '你好' })
  assert.equal((await pending).ok, true)
}

/** 服务端说缺录音同意：以服务端为准，只清录音、只问录音、只重发一次。 */
async function declarationRequiredRecoversOnce(opts) {
  const ctx = createRuntime(opts)
  ctx.ai.markDeclared('age_14_plus')
  ctx.ai.markDeclared('voice_recording')
  const pending = settle(ctx.net.uploadFile('/resume/voice/transcribe', 'wxfile://a.wav', { name: 'audio', ai: 'voice' }))
  await flush()
  assert.equal(ctx.wx.calls.modal.length, 0, '本机已声明，先不问')
  replyUpload(ctx.wx.calls.upload[0], 403, {
    success: false,
    error: { code: 'AI_DECLARATION_REQUIRED', message: '使用 AI 前请先完成必要声明', details: ['voice_recording'] },
  })
  await flush()
  assert.equal(ctx.wx.calls.modal.length, 1, '只补问缺的那一项')
  assert.match(ctx.wx.calls.modal[0].title, /录音/)
  assert.equal(ctx.ai.isDeclared('age_14_plus'), true, '没缺的不清')
  answer(ctx.wx.calls.modal[0], true)
  await flush()
  assert.equal(ctx.wx.calls.upload.length, 2, '问完重发一次')
  replyUpload(ctx.wx.calls.upload[1], 403, {
    success: false,
    error: { code: 'AI_DECLARATION_REQUIRED', message: 'x', details: ['voice_recording'] },
  })
  const result = await pending
  assert.equal(result.ok, false, '第二次仍被拒就把错误交给页面')
  assert.equal(result.error.code, 'AI_DECLARATION_REQUIRED')
  assert.equal(ctx.wx.calls.upload.length, 2, '不打转')
  assert.match(result.error.message, /没有记上/)
}

/** 服务端没说缺哪项（过滤器丢了 missing）：按这一类请求本该有的几项全部重问。 */
async function declarationRequiredWithoutDetails(opts) {
  const ctx = createRuntime(opts)
  ctx.ai.markDeclared('age_14_plus')
  const pending = settle(ctx.net.request('/assistant/chat', { method: 'POST', ai: 'generate' }))
  await flush()
  reply(ctx.aiCalls()[0], 403, { success: false, error: { code: 'AI_DECLARATION_REQUIRED', message: 'x' } })
  await flush()
  assert.equal(ctx.wx.calls.modal.length, 1)
  assert.match(ctx.wx.calls.modal[0].title, /14 周岁/)
  answer(ctx.wx.calls.modal[0], true)
  await flush()
  reply(ctx.aiCalls()[1], 200, { reply: 'ok' })
  assert.equal((await pending).ok, true)
}

/** 登录档位拒绝：从没登录过的人不补签；弹一次登录提示，点「去登录」进登录页。 */
async function loginRequiredPromptsOnce(opts) {
  const ctx = createRuntime(opts)
  ctx.ai.markDeclared('age_14_plus')
  const pending = settle(ctx.net.request('/assistant/chat', { method: 'POST', ai: 'generate', needAuth: false }))
  await flush()
  reply(ctx.aiCalls()[0], 401, { success: false, error: { code: 'AI_LOGIN_REQUIRED', message: '为了按规定核实使用者' } })
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'AI_LOGIN_REQUIRED')
  assert.match(result.error.message, /登录/)
  assert.equal(ctx.wx.calls.login.length, 0, '没登录过就不去静默补签')
  assert.equal(ctx.aiCalls().length, 1, '不重发')
  assert.equal(ctx.wx.calls.modal.length, 1, '弹一次登录提示')
  assert.match(ctx.wx.calls.modal[0].title, /登录/)
  answer(ctx.wx.calls.modal[0], true)
  await flush()
  assert.equal(ctx.wx.calls.nav[0], '/pages/launch/launch')
}

/** 页面同时发两个 AI 请求：只弹一个框，确认后两个都发。 */
async function concurrentRequestsShareOnePrompt(opts) {
  const ctx = createRuntime(opts)
  const a = settle(ctx.net.request('/mock-interviews', { method: 'POST', ai: 'generate' }))
  const b = settle(ctx.net.request('/assistant/chat', { method: 'POST', ai: 'generate' }))
  await flush()
  assert.equal(ctx.wx.calls.modal.length, 1, '同一项声明只弹一个框')
  answer(ctx.wx.calls.modal[0], true)
  await flush()
  assert.equal(ctx.aiCalls().length, 2)
  ctx.aiCalls().forEach((call) => reply(call, 200, { ok: 1 }))
  assert.equal((await a).ok, true)
  assert.equal((await b).ok, true)
}

/** 登录后对账：服务端记着录音同意已撤回 → 清本机、不重新同意；年龄照写。 */
async function syncRespectsRevocationElsewhere(opts) {
  const ctx = createRuntime(opts)
  ctx.ai.markDeclared('voice_recording')
  loginAs(ctx)
  const done = settle(ctx.legal.syncAiDeclarationsAfterLogin())
  await flush()
  const status = ctx.consentCalls()[0]
  assert.ok(status.url.endsWith('/me/ai-consents/status'))
  reply(status, 200, { data: [
    { scope: 'voice_recording', granted: false, revokedAt: '2026-09-29T08:00:00.000Z' },
  ] })
  await flush()
  const grants = ctx.consentCalls().filter((c) => c.method === 'POST')
  assert.equal(grants.length, 1, '只补写年龄')
  assert.equal(grants[0].data.scope, 'age_14_plus')
  assert.equal(ctx.ai.isDeclared('voice_recording'), false, '以撤回为准，清掉本机旧记录')
  assert.equal(ctx.ai.isDeclared('age_14_plus'), true, '登录勾选行即年龄声明')
  reply(grants[0], 200, { data: { granted: true } })
  assert.equal((await done).ok, true)
}

/** 登录后对账：服务端没有记录、本机有 → 两项都补写。 */
async function syncPushesLocalDeclarations(opts) {
  const ctx = createRuntime(opts)
  ctx.ai.markDeclared('voice_recording')
  loginAs(ctx)
  const done = settle(ctx.legal.syncAiDeclarationsAfterLogin())
  await flush()
  reply(ctx.consentCalls()[0], 200, { data: [] })
  await flush()
  const scopes = ctx.consentCalls().filter((c) => c.method === 'POST').map((c) => c.data.scope).sort()
  assert.equal(scopes.join(','), 'age_14_plus,voice_recording')
  ctx.consentCalls().filter((c) => c.method === 'POST').forEach((c) => reply(c, 200, { data: {} }))
  assert.equal((await done).ok, true)
}

/** 撤回录音同意：服务端撤成功才清本机；撤失败本机照留、错误交给页面。 */
async function revokeVoiceClearsOnlyOnSuccess(opts) {
  const ctx = createRuntime(opts)
  loginAs(ctx)
  ctx.ai.markDeclared('voice_recording')
  const failed = settle(ctx.legal.revokeVoiceConsent())
  await flush()
  const first = ctx.consentCalls()[0]
  assert.ok(first.url.endsWith('/me/ai-consents/voice_recording/revoke'))
  reply(first, 500, { success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: '服务器内部错误' } })
  assert.equal((await failed).ok, false)
  assert.equal(ctx.ai.isDeclared('voice_recording'), true, '服务端没撤掉，本机不能先说撤了')
  const ok = settle(ctx.legal.revokeVoiceConsent())
  await flush()
  reply(ctx.consentCalls()[1], 200, { data: { revoked: true, count: 1 } })
  assert.equal((await ok).ok, true)
  assert.equal(ctx.ai.isDeclared('voice_recording'), false)
}

/** 正式版：协议没发布就拦（C4），网络失败照实失败；开发版照旧回落草稿版本号。 */
async function legalVersionsStrictOnlyInRelease(opts) {
  const rel = createRuntime(Object.assign({}, opts, { envVersion: 'release' }))
  const r1 = settle(rel.legal.getLegalVersions())
  await flush()
  rel.wx.calls.request.forEach((c) => reply(c, 200, { success: true, data: null }))
  const out1 = await r1
  assert.equal(out1.ok, false)
  assert.equal(out1.error.code, 'LEGAL_DOCS_NOT_PUBLISHED')

  const r2 = settle(rel.legal.getLegalVersions())
  await flush()
  rel.wx.calls.request.slice(2).forEach((c) => c.fail({ errMsg: 'request:fail timeout' }))
  const out2 = await r2
  assert.equal(out2.ok, false, '网络失败不拿草稿去顶')
  assert.notEqual(out2.error.code, 'LEGAL_DOCS_NOT_PUBLISHED')

  const dev = createRuntime(Object.assign({}, opts, { envVersion: 'develop' }))
  const r3 = settle(dev.legal.getLegalVersions())
  await flush()
  dev.wx.calls.request.forEach((c) => reply(c, 200, { success: true, data: null }))
  const out3 = await r3
  assert.equal(out3.ok, true)
  assert.equal(out3.value.termsVersion, 'draft-pending-legal-review')

  const r4 = settle(rel.legal.getLegalVersions())
  await flush()
  const [terms, privacy] = rel.wx.calls.request.slice(4)
  reply(terms, 200, { success: true, data: { version: '2026-10-pilot-1', content: 'x' } })
  reply(privacy, 200, { success: true, data: { version: '2026-10-pilot-1', content: 'y' } })
  const out4 = await r4
  assert.equal(out4.ok, true)
  assert.equal(out4.value.privacyVersion, '2026-10-pilot-1')
}

/** api 门面：小青带 channel=miniapp（C12），并走 AI 前置；法务门面方法并进了 api。 */
async function assistantChatSendsMiniappChannel(opts) {
  const ctx = createRuntime(opts)
  const api = ctx.load('api')
  assert.equal(typeof api.getLegalDocument, 'function', 'api-legal-consent 的方法并进了 api')
  assert.equal(typeof api.ensureVoiceConsent, 'function')
  ctx.ai.markDeclared('age_14_plus')
  const pending = settle(api.assistantChat('简历怎么改'))
  await flush()
  const call = ctx.aiCalls()[0]
  assert.ok(call.url.endsWith('/assistant/chat'))
  assert.equal(call.data.channel, 'miniapp')
  assert.equal(header(call, 'X-Age-14-Plus'), 'declared', '经过 AI 前置')
  reply(call, 200, { sessionId: 's1', reply: '好' })
  assert.equal((await pending).ok, true)
}

const CONSENT_403 = { success: false, error: { code: 'USER_AI_CONSENT_REQUIRED', message: '请先确认简历 AI 服务授权' } }

/** 会员已声明年龄，先把本机记录备好，场景只看简历 AI 授权这一层。 */
function memberWithAge(opts) {
  const ctx = createRuntime(opts)
  loginAs(ctx)
  assert.equal(ctx.ai.markDeclared('age_14_plus'), true)
  return ctx
}

/**
 * 会员调简历类 AI，服务端回 USER_AI_CONSENT_REQUIRED（9/06 起强制 resume_ai）：
 * 问一次「确认使用简历 AI」→ 同意 → 先写账号授权 resume_ai → 再重发一次 → 成功。
 */
async function resumeAiConsentRecoversOnce(opts) {
  const ctx = memberWithAge(opts)
  // 本文件第一个场景，冷启动加上五轮来回，机器忙时会超过 settle 默认的 400ms，
  // 看门狗先到就报 ok=false（2026-10-06 实测单跑约 1/20）。这里只放宽这一处；
  // 默认值不动，因为别的场景就是靠它等到超时的。
  const pending = settle(ctx.net.request('/resume/parse', { method: 'POST', ai: 'generate', resumeAi: true, needAuth: true }), 2000)
  await flush()
  assert.equal(ctx.aiCalls().length, 1)
  reply(ctx.aiCalls()[0], 403, CONSENT_403)
  await flush()
  assert.equal(ctx.wx.calls.modal.length, 1, '弹一次简历 AI 授权')
  assert.match(ctx.wx.calls.modal[0].title, /简历 AI/)
  assert.match(ctx.wx.calls.modal[0].content, /不会发送给企业/)
  assert.equal(ctx.aiCalls().length, 1, '同意之前不重发')
  answer(ctx.wx.calls.modal[0], true)
  await flush()
  const grant = ctx.consentCalls()[0]
  assert.ok(grant, '同意后写账号授权')
  assert.equal(grant.data.scope, 'resume_ai')
  assert.equal(ctx.aiCalls().length, 1, '账号授权写成之前不重发')
  reply(grant, 200, { data: { scope: 'resume_ai', granted: true } })
  await flush()
  assert.equal(ctx.aiCalls().length, 2, '重发一次')
  reply(ctx.aiCalls()[1], 200, { data: { taskId: 't1' } })
  const result = await pending
  assert.equal(result.ok, true)
  assert.equal(result.value.taskId, 't1')
}

/** 选「暂不使用」：不写授权、不重发，给出说明（isDeclined 可判）。 */
async function resumeAiDeclineStopsHere(opts) {
  const ctx = memberWithAge(opts)
  const pending = settle(ctx.net.request('/resume/parse', { method: 'POST', ai: 'generate', resumeAi: true, needAuth: true }))
  await flush()
  reply(ctx.aiCalls()[0], 403, CONSENT_403)
  await flush()
  answer(ctx.wx.calls.modal[0], false)
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'AI_RESUME_NOT_CONSENTED')
  assert.match(result.error.message, /没有发给 AI/)
  assert.equal(ctx.ai.isDeclined(result.error), true)
  assert.equal(ctx.consentCalls().length, 0, '不写授权')
  assert.equal(ctx.aiCalls().length, 1, '不重发')
}

/** 没标 resumeAi 的请求（岗位类 job_ai 自己有授权页）收到同一个 403：原样交给页面，不弹简历 AI 框。 */
async function consent403OutsideResumePassesThrough(opts) {
  const ctx = memberWithAge(opts)
  const pending = settle(ctx.net.request('/resume/job-fit', { method: 'POST', ai: 'generate', needAuth: true }))
  await flush()
  reply(ctx.aiCalls()[0], 403, CONSENT_403)
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'USER_AI_CONSENT_REQUIRED')
  assert.equal(ctx.wx.calls.modal.length, 0)
  assert.equal(ctx.consentCalls().length, 0)
}

/** 同一页并发两个简历请求都被拦：只弹一个框，同意一次。 */
async function resumeAiConcurrentSharesOnePrompt(opts) {
  const ctx = memberWithAge(opts)
  const a = settle(ctx.net.request('/resume/records/t1/draft', { method: 'GET', ai: 'read', resumeAi: true, needAuth: true }))
  const b = settle(ctx.net.request('/resume/records/t1/optimize', { method: 'GET', ai: 'generate', resumeAi: true, needAuth: true }))
  await flush()
  assert.equal(ctx.aiCalls().length, 2)
  reply(ctx.aiCalls()[0], 403, CONSENT_403)
  reply(ctx.aiCalls()[1], 403, CONSENT_403)
  await flush()
  assert.equal(ctx.wx.calls.modal.length, 1, '只弹一个框')
  answer(ctx.wx.calls.modal[0], true)
  await flush()
  ctx.consentCalls().forEach((c) => reply(c, 200, { data: { scope: 'resume_ai', granted: true } }))
  await flush()
  ctx.aiCalls().slice(2).forEach((c) => reply(c, 200, { data: {} }))
  assert.equal((await a).ok, true)
  assert.equal((await b).ok, true)
}

const RESUME_AI_FIRST_SENTENCE = '简历诊断、优化、生成，以及用到这份简历的版式调整、职业规划和模拟面试，会把你上传或填写的简历内容发送到系统里的 AI 进行分析。'

/**
 * 职业规划也把简历原文发给 AI（第八次起服务端对它查 resume_ai）：经 api.generateCareerPlan
 * 真发，会员没授权被 403 → 弹同一个确认框（第一句点到职业规划）→ 同意 → 写账号 → 重发一次。
 */
async function careerPlanAsksResumeAiOn403(opts) {
  const ctx = memberWithAge(opts)
  const api = ctx.load('api')
  const pending = settle(api.generateCareerPlan('t1', ''), 2000)
  await flush()
  const first = ctx.aiCalls()[0]
  assert.ok(first && first.url.endsWith('/resume/career-plan/t1'), '生成请求发出')
  assert.equal(first.method, 'POST')
  reply(first, 403, CONSENT_403)
  await flush()
  assert.equal(ctx.wx.calls.modal.length, 1, '职业规划被拒也弹简历 AI 授权')
  assert.match(ctx.wx.calls.modal[0].title, /简历 AI/)
  assert.ok(ctx.wx.calls.modal[0].content.startsWith(RESUME_AI_FIRST_SENTENCE), '第一句是合规定的新句，点到职业规划')
  assert.match(ctx.wx.calls.modal[0].content, /不会发送给企业或合作机构/)
  assert.equal(ctx.aiCalls().length, 1, '同意之前不重发')
  answer(ctx.wx.calls.modal[0], true)
  await flush()
  const grant = ctx.consentCalls()[0]
  assert.ok(grant, '同意后写账号授权')
  assert.equal(grant.data.scope, 'resume_ai')
  reply(grant, 200, { data: { scope: 'resume_ai', granted: true } })
  await flush()
  assert.equal(ctx.aiCalls().length, 2, '重发一次')
  reply(ctx.aiCalls()[1], 200, { status: 'completed', summary: '规划' })
  const result = await pending
  assert.equal(result.ok, true)
  assert.equal(ctx.wx.calls.modal.length, 1, '全程只问一次')
}

/** 职业规划被拒后点「暂不使用」：不写授权、不重发、不再弹；交给页面的是可判的「没同意」。 */
async function careerPlanDeclineStopsHere(opts) {
  const ctx = memberWithAge(opts)
  const api = ctx.load('api')
  const pending = settle(api.generateCareerPlan('t1', ''))
  await flush()
  reply(ctx.aiCalls()[0], 403, CONSENT_403)
  await flush()
  assert.equal(ctx.wx.calls.modal.length, 1)
  answer(ctx.wx.calls.modal[0], false)
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'AI_RESUME_NOT_CONSENTED')
  assert.equal(ctx.ai.isDeclined(result.error), true)
  assert.match(result.error.message, /没有发给 AI/)
  await flush()
  assert.equal(ctx.consentCalls().length, 0, '不写授权')
  assert.equal(ctx.aiCalls().length, 1, '不重发')
  assert.equal(ctx.wx.calls.modal.length, 1, '不反复弹')
}

/** 读已有规划、导出 PDF 不触发模型生成，不挂简历 AI 标记：收到同一个 403 原样交给页面，不弹框。 */
async function careerPlanReadDoesNotPrompt(opts) {
  const ctx = memberWithAge(opts)
  const api = ctx.load('api')
  const pending = settle(api.getCareerPlan('t1', ''))
  await flush()
  reply(ctx.aiCalls()[0], 403, CONSENT_403)
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'USER_AI_CONSENT_REQUIRED')
  assert.equal(ctx.wx.calls.modal.length, 0)
}

const SCENARIOS = {
  careerPlanAsksResumeAiOn403,
  careerPlanDeclineStopsHere,
  careerPlanReadDoesNotPrompt,
  resumeAiConsentRecoversOnce,
  resumeAiDeclineStopsHere,
  consent403OutsideResumePassesThrough,
  resumeAiConcurrentSharesOnePrompt,
  anonymousGenerateAsksAgeThenSendsHeaders,
  declineBlocksRequest,
  memberGrantsFirstAndSendsNoHeaders,
  voiceAsksBothInOrder,
  declarationRequiredRecoversOnce,
  declarationRequiredWithoutDetails,
  loginRequiredPromptsOnce,
  concurrentRequestsShareOnePrompt,
  syncRespectsRevocationElsewhere,
  syncPushesLocalDeclarations,
  revokeVoiceClearsOnlyOnSuccess,
  legalVersionsStrictOnlyInRelease,
  assistantChatSendsMiniappChannel,
}

for (const [name, run] of Object.entries(SCENARIOS)) {
  test(name, () => run())
}

// ── 反向变异：摘掉一处防护，对应场景必须判红（红在断言，不在崩溃） ─────────────

function swap(file, from, to, ...more) {
  return (name, source) => {
    if (name !== file) return source
    const pairs = [[from, to]]
    for (let i = 0; i < more.length; i += 2) pairs.push([more[i], more[i + 1]])
    return pairs.reduce((src, [a, b]) => {
      assert.ok(src.includes(a), `变异锚点不在 ${file}：${a}`)
      return src.replace(a, b)
    }, source)
  }
}

const MUTATIONS = [
  ['会员请求也带声明头', 'memberGrantsFirstAndSendsNoHeaders',
    swap('request', '  if (header.Authorization) return header;\n', '')],
  ['补问前不清本机记录', 'declarationRequiredRecoversOnce',
    swap('api-legal-consent', '    scopes.forEach((scope) => aiAccess.clearDeclared(scope));\n', '')],
  // 「只弹一个框」由两道等价的保护共同保证（同项直接共用、另一项排队后复查），只摘一道测不出，
  // 所以这一条把整个单飞一起摘掉。
  ['提示框不再单飞', 'concurrentRequestsShareOnePrompt',
    swap('ai-access',
      '  if (pending && pending.scope === scope) return pending.promise;\n', '',
      '  const before = pending ? pending.promise.catch(() => null) : Promise.resolve();\n', '  const before = Promise.resolve();\n',
      '    if (isDeclared(scope)) return false;\n    return askScope(scope)', '    return askScope(scope)')],
  ['对账无视撤回', 'syncRespectsRevocationElsewhere',
    swap('api-legal-consent', "if (scope === aiAccess.VOICE_SCOPE && row && row.revokedAt) {", 'if (false) {')],
  ['正式版也回落草稿', 'legalVersionsStrictOnlyInRelease',
    swap('api-legal-consent', "const strict = config.envVersion === 'release';", 'const strict = false;')],
  ['会员新声明不写服务端', 'memberGrantsFirstAndSendsNoHeaders',
    swap('api-legal-consent', 'if (fresh && auth.isLoggedIn()) return grantAiConsent(scope).catch(() => null);', 'if (false) return null;')],
  ['拒绝后照发请求', 'declineBlocksRequest',
    swap('ai-access', '      if (!agreed) throw declinedError(scope);\n', '')],
  ['小青不带渠道', 'assistantChatSendsMiniappChannel',
    swap('api', "const body = { message, channel: 'miniapp' };", 'const body = { message };')],
  ['简历授权 403 不接', 'resumeAiConsentRecoversOnce',
    swap('api-legal-consent', "if (err && err.code === 'USER_AI_CONSENT_REQUIRED' && resumeAi && auth.isLoggedIn()) {", 'if (false) {')],
  ['简历授权不看标记', 'consent403OutsideResumePassesThrough',
    swap('api-legal-consent', "const resumeAi = !!(options && options.resumeAi);", 'const resumeAi = true;')],
  ['同意后不写账号就重发', 'resumeAiConsentRecoversOnce',
    swap('api-legal-consent', "        .then(() => grantAiConsent(aiAccess.RESUME_AI_SCOPE))\n", '')],
  ['拒绝简历授权照样重发', 'resumeAiDeclineStopsHere',
    swap('ai-access', "    if (!agreed) throw declinedError(RESUME_AI_SCOPE);\n", '')],
  ['简历授权框不单飞', 'resumeAiConcurrentSharesOnePrompt',
    swap('ai-access', '  if (resumeAiPending) return resumeAiPending;\n', '')],
  ['职业规划不挂简历授权标记', 'careerPlanAsksResumeAiOn403',
    swap('api', "timeout: config.aiTimeout, ai: 'generate', resumeAi: true,\n    });\n  },\n\n  /**\n   * 读取已生成的职业规划", "timeout: config.aiTimeout, ai: 'generate',\n    });\n  },\n\n  /**\n   * 读取已生成的职业规划")],
  ['确认框第一句退回旧句', 'careerPlanAsksResumeAiOn403',
    swap('ai-access', "content: '简历诊断、优化、生成，以及用到这份简历的版式调整、职业规划和模拟面试，会把", "content: '诊断、优化和生成会把")],
  ['职业规划拒绝后照样重发', 'careerPlanDeclineStopsHere',
    swap('ai-access', "    if (!agreed) throw declinedError(RESUME_AI_SCOPE);\n", '')],
  ['登录档位拒绝不提示', 'loginRequiredPromptsOnce',
    swap('api-legal-consent', "if (err && err.code === 'AI_LOGIN_REQUIRED') aiAccess.promptLogin();", '')],
]

for (const [label, scenario, mutate] of MUTATIONS) {
  test(`变异：${label} → ${scenario} 判红`, async () => {
    await assert.rejects(() => SCENARIOS[scenario]({ mutate }), (err) => {
      assert.equal(err && err.code, 'ERR_ASSERTION', `应当是断言失败，实际：${err && err.stack}`)
      return true
    })
  })
}
