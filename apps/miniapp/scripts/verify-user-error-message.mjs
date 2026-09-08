/**
 * 小程序「用户可见错误文案」回归门禁。
 *
 * 钉死 2026-09-08 走查实测发现的缺陷：服务端 error.message 在设计上不面向用户
 * （机器码原样填 message、人类可读原文一律折叠成「服务器内部错误」，见
 * services/api 的 verify:http-exception-filter），而小程序 request.js 曾把它直接
 * 当 err.message 抛给页面。页面写法是 `(err && err.message) || '中文兜底句'`，
 * 机器码是非空串 → 中文兜底一次都执行不到，求职者手机上看到 PRICE_CONFIG_UNAVAILABLE。
 *
 * 本门禁用小程序**真实的** utils/request.js 跑，不复制实现，避免断言与实现漂移。
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MINIAPP = path.resolve(HERE, '..')

let failed = 0
function assert(cond, msg) {
  if (cond) { console.log(`  PASS  ${msg}`) } else { failed++; console.log(`  FAIL  ${msg}`) }
}

// 最小 wx 桩：只提供 request.js 会碰到的 API。
let current = null
globalThis.wx = {
  request(o) { setTimeout(() => o.success({ statusCode: current.status, data: current.body }), 0) },
  getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
  showToast() {}, showModal() {}, hideLoading() {}, showLoading() {},
  getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
  reLaunch() {}, navigateTo() {}, login(o) { o.success({ code: 'stub' }) },
}
globalThis.getApp = () => ({})

const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))
const { request } = requireMiniapp('./request.js')
const { SERVER_GENERIC_MESSAGE, PASSTHROUGH_MESSAGE_CODES } = requireMiniapp('./user-error.js')

// 判据由门禁自己持有，不复用被测模块的 isMachineErrorCode：那个函数本身也在
// 被测范围内，用它做断言会让「判据坏掉」和「实现坏掉」互相掩护。
const looksLikeMachineCode = (v) => typeof v === 'string' && /^[A-Z][A-Z0-9_]+$/.test(v)

async function errorOf(status, body) {
  current = { status, body }
  try { await request({ url: '/gate-probe', method: 'POST' }); return null }
  catch (e) { return e }
}

console.log('\n=== 小程序用户可见错误文案门禁 ===\n')

// A. 机器码不得成为用户可见文案
console.log('A. 服务端机器码')
for (const code of ['PRICE_CONFIG_UNAVAILABLE', 'PAYMENT_SESSION_REQUIRED', 'ORDER_ALREADY_PAID']) {
  const e = await errorOf(400, { success: false, error: { code, message: code } })
  const shown = (e && e.message) || '页面兜底句'
  assert(!looksLikeMachineCode(shown), `${code} 不会作为 toast 文案出现（实际展示「${shown}」）`)
  assert(e.code === code, `${code} 的 error.code 仍完整保留，页面可据此分支`)
}

// B. 服务端通用折叠句不得成为用户可见文案
console.log('\nB. 服务端通用折叠句')
{
  const e = await errorOf(404, { success: false, error: { code: 'Not Found', message: SERVER_GENERIC_MESSAGE } })
  const shown = (e && e.message) || '页面兜底句'
  assert(shown !== SERVER_GENERIC_MESSAGE, `404 不会把「${SERVER_GENERIC_MESSAGE}」甩给用户（实际展示「${shown}」）`)
}

// C. 页面兜底句必须真的能执行到
console.log('\nC. 页面兜底句可达性')
{
  const e = await errorOf(400, { success: false, error: { code: 'SOME_UNKNOWN_BIZ_CODE', message: 'SOME_UNKNOWN_BIZ_CODE' } })
  assert(!e.message, '未登记错误码时 err.message 为空，页面 `|| 中文兜底` 得以生效')
  assert(e.serverMessage === 'SOME_UNKNOWN_BIZ_CODE', '服务端原文留档在 err.serverMessage，供排查但不展示')
}

// D. 已登记的透传码保留服务端中文（这些文案比页面兜底句更有信息量）
console.log('\nD. 透传白名单')
{
  const e = await errorOf(400, { success: false, error: { code: 'PRINT_TERMINAL_OFFLINE', message: '目标终端当前离线，请稍后重试' } })
  assert(e.message === '目标终端当前离线，请稍后重试', 'PRINT_TERMINAL_OFFLINE 保留服务端中文')
  assert(PASSTHROUGH_MESSAGE_CODES.length > 0, '透传白名单非空')
}

// E. 共享技术码给统一中文
console.log('\nE. 共享技术码')
{
  const e = await errorOf(401, { success: false, error: { code: 'MEMBER_SESSION_EXPIRED', message: 'MEMBER_SESSION_EXPIRED' } })
  assert(/登录/.test(e.message || ''), `登录失效给出中文提示（实际「${e.message}」）`)
}

// F. 200 包体内的失败标记同样收敛
console.log('\nF. HTTP 200 但业务失败')
{
  const e = await errorOf(200, { code: 40001, message: 'PACKAGE_ORDER_UNAVAILABLE' })
  const shown = (e && e.message) || '页面兜底句'
  assert(!looksLikeMachineCode(shown), `200 包体里的机器码同样不外泄（实际展示「${shown}」）`)
}

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 条失败\n`)
process.exit(failed === 0 ? 0 : 1)
