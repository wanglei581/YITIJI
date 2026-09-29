// 管理员登录短信第二步（P1-4）前端门禁：在沙箱里真跑 auth 适配器，外加登录页接线检查。
//
// 锁住的行为：
//   A. 密码通过后只拿到第二步凭证时，本地不落任何登录态；形状不对一律按无效响应处理。
//   B. 换凭证只发 { challengeTicket, code }（不带密码），成功才落盘；非 admin 角色不落盘。
//   C. 重发只发 { challengeTicket }；响应形状不对不当成功。
//   D. 失败分流：验证码错 / 过期 / 被锁留在第二步；凭证作废、开关关闭回到账号密码；
//      没绑手机、网络不在名单内回到账号密码并如实说明。
//   E. 登录页：第二步分支接到面板；验证码登录被拒（AUTH_ADMIN_SMS_LOGIN_REQUIRES_PASSWORD）切回密码登录；
//      凭证不进 localStorage / sessionStorage；超时回到账号密码。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createContext, Script } from 'node:vm'
import ts from 'typescript'
import { loadAuthSecondFactorModule } from './support/auth-second-factor-module.mjs'

const root = process.cwd()
const STORAGE_KEY = 'admin_auth_v1'
let failures = 0

function pass(message) {
  console.log(`  PASS ${message}`)
}

function fail(message) {
  failures += 1
  console.error(`  FAIL ${message}`)
}

function check(label, condition, detail = '') {
  if (condition) pass(label)
  else fail(detail ? `${label} — ${detail}` : label)
}

function read(rel) {
  return readFileSync(join(root, rel), 'utf8')
}

const authSource = read('src/services/auth/index.ts')
const sf = loadAuthSecondFactorModule(root)

const TICKET = `admin-1.${'A'.repeat(43)}`
const CHALLENGE = {
  secondFactorRequired: true,
  challengeTicket: TICKET,
  phoneMasked: '138****1234',
  codeSent: true,
  cooldownSeconds: 60,
  expiresInSeconds: 300,
}
const ADMIN_LOGIN = { token: 'real-token', user: { id: 'admin-1', name: '运营管理员', role: 'admin', orgId: null } }

function harness(responses) {
  const storage = new Map()
  const requests = []
  const fetch = async (url, init) => {
    requests.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined })
    const next = responses.shift()
    if (!next) throw new Error('Missing stubbed fetch response')
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      statusText: '',
      json: async () => next.body,
    }
  }
  const module = { exports: {} }
  const context = createContext({
    module,
    exports: module.exports,
    require: (specifier) => {
      if (specifier === '../api/client') return { API_BASE_URL: 'https://second-factor.invalid/api/v1', API_MODE: 'http' }
      if (specifier === './secondFactor') return sf
      throw new Error(`Unexpected module: ${specifier}`)
    },
    fetch,
    localStorage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    window: { location: { pathname: '/login', href: '' } },
  })
  const out = ts.transpileModule(authSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'auth/index.ts',
  })
  new Script(out.outputText, { filename: 'auth/index.js' }).runInContext(context)
  return { auth: module.exports, storage, requests }
}

const ok = (data) => ({ status: 200, body: { data } })
const err = (status, code, message) => ({ status, body: { error: { code, message } } })

// ─── A. 密码通过 → 第二步凭证 ────────────────────────────────────────────────
{
  const h = harness([ok(CHALLENGE)])
  const r = await h.auth.login('admin', 'Password123!')
  check('A1 第二步凭证被识别为 secondFactorRequired',
    r.ok === true && r.secondFactorRequired === true && r.challengeTicket === TICKET && r.phoneMasked === '138****1234',
    JSON.stringify(r))
  check('A2 只拿到第二步凭证时本地不落任何登录态', !h.storage.has(STORAGE_KEY))
  check('A3 密码登录仍按 portal=admin 发送', h.requests[0]?.url.endsWith('/auth/login') && h.requests[0]?.body?.portal === 'admin')
}
for (const [label, patch] of [
  ['手机号是明文', { phoneMasked: '13812341234' }],
  ['凭证缺分隔点', { challengeTicket: 'A'.repeat(50) }],
  ['有效期为 0', { expiresInSeconds: 0 }],
  ['codeSent 不是布尔', { codeSent: 'yes' }],
  ['冷却超界', { cooldownSeconds: 3600 }],
]) {
  const h = harness([ok({ ...CHALLENGE, ...patch })])
  const r = await h.auth.login('admin', 'Password123!')
  check(`A4 形状不对（${label}）按无效响应处理且不落盘`,
    r.ok === false && r.code === 'AUTH_RESPONSE_INVALID' && !h.storage.has(STORAGE_KEY), JSON.stringify(r))
}

// ─── B. 换凭证 ───────────────────────────────────────────────────────────────
{
  const h = harness([ok(ADMIN_LOGIN)])
  const r = await h.auth.completeAdminSecondFactor(TICKET, '123456')
  const req = h.requests[0]
  check('B1 换凭证打 /auth/login/second-factor', req?.url === 'https://second-factor.invalid/api/v1/auth/login/second-factor')
  check('B2 请求体只有 challengeTicket 与 code（不带密码）',
    JSON.stringify(Object.keys(req?.body ?? {}).sort()) === JSON.stringify(['challengeTicket', 'code']) && req.body.code === '123456',
    JSON.stringify(req?.body))
  const stored = JSON.parse(h.storage.get(STORAGE_KEY) ?? 'null')
  check('B3 成功后才落盘登录态', r.ok === true && r.user?.id === 'admin-1' && stored?.token === 'real-token')
}
{
  const h = harness([ok({ token: 't', user: { id: 'p-1', name: '机构', role: 'partner', orgId: 'o-1' } })])
  const r = await h.auth.completeAdminSecondFactor(TICKET, '123456')
  check('B4 非 admin 角色不落盘', r.ok === false && !h.storage.has(STORAGE_KEY), JSON.stringify(r))
}
{
  const h = harness([err(400, 'SMS_CODE_INVALID', '验证码不正确')])
  const r = await h.auth.completeAdminSecondFactor(TICKET, '000000')
  check('B5 服务端错误码与中文文案原样带回', r.ok === false && r.code === 'SMS_CODE_INVALID' && r.message === '验证码不正确')
  check('B6 失败不落盘', !h.storage.has(STORAGE_KEY))
}

// ─── C. 重发 ─────────────────────────────────────────────────────────────────
{
  const h = harness([ok({ codeSent: false, cooldownSeconds: 60 })])
  const r = await h.auth.resendAdminSecondFactor(TICKET)
  check('C1 重发打 /auth/login/second-factor/resend 且只带 challengeTicket',
    h.requests[0]?.url.endsWith('/auth/login/second-factor/resend')
      && JSON.stringify(Object.keys(h.requests[0]?.body ?? {})) === JSON.stringify(['challengeTicket']))
  check('C2 codeSent=false 如实带回（号码刚收过验证码，这次没新发）', r.ok === true && r.codeSent === false && r.cooldownSeconds === 60)
}
{
  const h = harness([ok({ sent: true })])
  const r = await h.auth.resendAdminSecondFactor(TICKET)
  check('C3 重发响应形状不对不当成功', r.ok === false && r.code === 'INVALID_RESPONSE', JSON.stringify(r))
}

// ─── D. 失败分流 ─────────────────────────────────────────────────────────────
const expected = {
  SMS_CODE_INVALID: 'retry',
  SMS_CODE_EXPIRED: 'retry',
  SMS_CODE_LOCKED: 'retry',
  SMS_SEND_FAILED: 'retry',
  NETWORK_ERROR: 'retry',
  AUTH_SECOND_FACTOR_CHALLENGE_INVALID: 'restart',
  AUTH_SECOND_FACTOR_DISABLED: 'restart',
  AUTH_SECOND_FACTOR_NOT_ENROLLED: 'blocked',
  AUTH_ADMIN_IP_FORBIDDEN: 'blocked',
  AUTH_ADMIN_IP_CONFIG_INVALID: 'blocked',
}
for (const [code, action] of Object.entries(expected)) {
  check(`D ${code} → ${action}`, sf.secondFactorFailureAction(code) === action, sf.secondFactorFailureAction(code))
}
check('D 兜底文案全是中文、无错误码原样上屏',
  Object.keys(expected).every((code) => /[一-龥]/.test(sf.secondFactorFallbackMessage(code)) && !sf.secondFactorFallbackMessage(code).includes(code)))

// ─── E. 登录页接线 ───────────────────────────────────────────────────────────
const page = read('src/routes/login/index.tsx')
const panel = read('src/routes/login/SecondFactorPanel.tsx')
const sfSource = read('src/services/auth/secondFactor.ts')
check('E1 密码登录的第二步分支接到 SecondFactorPanel',
  /'secondFactorRequired' in r\)\s*\{[\s\S]{0,120}setSecondFactor\(r\)/.test(page) && page.includes('<SecondFactorPanel'))
check('E2 只用短信验证码登录被拒时切回密码登录并说明（判定函数）',
  /function switchToPasswordIfSmsOnlyRejected[\s\S]{0,200}AUTH_ADMIN_SMS_LOGIN_REQUIRES_PASSWORD[\s\S]{0,80}setMode\('password'\)/.test(page))
check('E2b 发码与短信登录两处都走这个判定',
  (page.match(/!switchToPasswordIfSmsOnlyRejected\(r\)/g) ?? []).length === 2)
check('E3 面板用真实接口（completeAdminSecondFactor / resendAdminSecondFactor）',
  panel.includes('completeAdminSecondFactor(challenge.challengeTicket, code)') && panel.includes('resendAdminSecondFactor(challenge.challengeTicket)'))
check('E4 第二步凭证不进浏览器存储', !/localStorage|sessionStorage/.test(panel) && !/localStorage|sessionStorage/.test(sfSource))
check('E5 有效期走完回到账号密码', /expiresIn === 0\)\s*onRestart\(/.test(panel))
check('E6 失败按分流处理：retry 留在本步，其余回到账号密码',
  /secondFactorFailureAction\(failure\.code\) === 'retry'/.test(panel) && /onRestart\(message\)/.test(panel))
check('E7 面板有「返回重新输入账号密码」出口', panel.includes('返回重新输入账号密码') && panel.includes('onRestart(null)'))

if (failures > 0) {
  console.error(`\n${failures} FAIL`)
  process.exit(1)
}
console.log('\nALL PASS: 管理员登录短信第二步前端接线')
