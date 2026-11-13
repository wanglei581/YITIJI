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
  // 每单超过 100 面（#1146）：用户要知道「分几单打」，不能落到兜底的「服务端暂时无法核定页数和金额」
  const big = await errorOf(400, { success: false, error: { code: 'PRINT_JOB_TOO_LARGE', message: '每单最多打印 100 面，请分几单打印' } })
  assert(big.message === '每单最多打印 100 面，请分几单打印', `PRINT_JOB_TOO_LARGE 保留服务端中文（实际「${big.message || '(空→页面兜底句)'}」）`)
  // 终端暂停接打印单（#1150 新码）：原话原样到达；老码 PRINTER_UNAVAILABLE 的「本机…」仍被挡住
  const halted = await errorOf(400, { success: false, error: { code: 'PRINT_TERMINAL_QUEUE_HALTED', message: '这台终端暂停接打印单，暂不能下单，请稍后再试或换一台终端' } })
  assert(halted.message === '这台终端暂停接打印单，暂不能下单，请稍后再试或换一台终端', `PRINT_TERMINAL_QUEUE_HALTED 保留服务端中文（实际「${halted.message || '(空→页面兜底句)'}」）`)
  const oldCode = await errorOf(400, { success: false, error: { code: 'PRINTER_UNAVAILABLE', message: '本机打印机当前不可用（离线、缺纸或故障），暂不能下单，请联系工作人员' } })
  assert(!oldCode.message, 'PRINTER_UNAVAILABLE 仍不透传（「本机」是写给一体机现场的）')
}

// E. 共享技术码给统一中文
console.log('\nE. 共享技术码')
{
  const e = await errorOf(401, { success: false, error: { code: 'MEMBER_SESSION_EXPIRED', message: 'MEMBER_SESSION_EXPIRED' } })
  assert(/登录/.test(e.message || ''), `登录失效给出中文提示（实际「${e.message}」）`)
}

// AI 额度提示通过真实 request 链路到达所有共享错误映射的页面。
console.log('AI 额度：恢复时间和手动路径')
for (const [code, required] of [
  ['AI_BUDGET_EXHAUSTED', ['今天', '明天恢复', '模板', '手动填写', '打印照常']],
  ['AI_BUDGET_UNAVAILABLE', ['暂时', '稍后再试', '手动填写', '打印照常']],
]) {
  for (const message of [code, SERVER_GENERIC_MESSAGE, '服务端原文']) {
    const e = await errorOf(503, { success: false, error: { code, message } })
    assert(required.every(word => e.message?.includes(word)), `${code} 有下一步且不被原文覆盖：${e.message}`)
    assert(!/价格|购买|充值/.test(e.message || ''), `${code} 不引导付费`)
    assert(e.code === code, `${code} 保留错误码`)
  }
}

{
  const e = await errorOf(503, { success: false, error: { code: 'AI_PROVIDER_NOT_CONFIGURED', message: 'AI_PROVIDER_NOT_CONFIGURED' } })
  assert(e.message === 'AI 服务暂时不可用，本次没有生成结果；打印等其他功能照常', 'AI 未配置时如实提示没有生成结果，不出现付费或开通引导')
}

console.log('AI 次数：明天 0 点恢复，不引导付费')
{
  const sentence = '今天的 AI 次数用完了，明天 0 点恢复。'
  for (const message of ['AI_QUOTA_EXHAUSTED', SERVER_GENERIC_MESSAGE, sentence]) {
    const e = await errorOf(429, { success: false, error: { code: 'AI_QUOTA_EXHAUSTED', message } })
    assert(e.message === sentence, `AI_QUOTA_EXHAUSTED 最终显示恢复时间（实际「${e.message}」）`)
    assert(!/价格|购买|充值|套餐|开通|续费|权益|核销/.test(e.message || ''), 'AI 次数用完不引导付费')
  }
  const { plainAiMessageOf } = requireMiniapp('./user-error.js')
  const plain = plainAiMessageOf({ code: 'AI_QUOTA_EXHAUSTED', message: 'AI_QUOTA_EXHAUSTED' }, '兜底')
  assert(plain === sentence, `模拟面试和小青走 plainAiMessageOf 也是这句（实际「${plain}」）`)
}

console.log('打印额度：有面数的原话原样，会员那句不提手机屏幕')
{
  const cases = [
    ['PRINT_TERMINAL_DAILY_QUOTA_REACHED', '今天这台机器的免费打印量已用完，明天 0 点恢复。', '今天这台机器的免费打印量已用完，明天 0 点恢复。'],
    ['PRINT_GUEST_ORDER_QUOTA_EXCEEDED', '免登录每次最多打印 20 面。用手机号登录后，可以一次打更多。', '免登录每次最多打印 20 面。用手机号登录后，可以一次打更多。'],
    ['PRINT_ORDER_EXCEEDS_DAILY_FREE_SIDES', '这台终端今天还只能再打 1 份，这一份已经超过本机上限。', '这台终端今天还只能再打 1 份，这一份已经超过本机上限。'],
    ['PRINT_ORDER_EXCEEDS_DAILY_FREE_SIDES', '这台终端今天还只能再打 2 份，这一单 4 份已经超过本机上限。', '这台终端今天还只能再打 2 份，这一单 4 份已经超过本机上限。'],
    ['PRINT_ORDER_EXCEEDS_DAILY_FREE_SIDES', '你今天还只能再打 1 份，这一份已经超过个人上限。', '你今天还只能再打 1 份，这一份已经超过个人上限。'],
    ['PRINT_ORDER_EXCEEDS_DAILY_FREE_SIDES', '你今天还只能再打 3 份，这一单 5 份已经超过个人上限。', '你今天还只能再打 3 份，这一单 5 份已经超过个人上限。'],
  ]
  for (const [code, serverMessage, shown] of cases) {
    const e = await errorOf(400, { success: false, error: { code, message: serverMessage } })
    assert(e.message === shown, `${code} 最终显示「${shown}」（实际「${e.message || '(空)'}」）`)
  }
  const memberServer = '你今天已免费打印 50 面，达到每日上限，明天 0 点恢复。确有急用，可以拨打屏幕上的服务电话。'
  const memberShown = '你今天已免费打印 50 面，达到每日上限，明天 0 点恢复。需要帮助可拨打服务电话，号码在首页底部「经营者信息」里。'
  const member = await errorOf(400, { success: false, error: { code: 'PRINT_MEMBER_DAILY_QUOTA_REACHED', message: memberServer } })
  assert(member.message === memberShown, `PRINT_MEMBER_DAILY_QUOTA_REACHED 去掉一体机屏幕那半句（实际「${member.message || '(空)'}」）`)
  assert(!/屏幕上的服务电话/.test(member.message || ''), '会员额度不再说屏幕上的服务电话')
  assert(/50 面/.test(member.message || ''), '会员额度保留具体面数')
  const copyServer = '你今天已免费打印复印 50 面，达到每日上限，明天 0 点恢复。确有急用，可以拨打屏幕上的服务电话。'
  const copy = await errorOf(400, { success: false, error: { code: 'PRINT_MEMBER_DAILY_QUOTA_REACHED', message: copyServer } })
  assert(copy.message.startsWith('你今天已免费打印复印 50 面，达到每日上限，明天 0 点恢复。'), `复印同一码也去掉屏幕那半句（实际「${copy.message}」）`)
  assert(!/屏幕上的服务电话/.test(copy.message || ''), '复印额度不再说屏幕上的服务电话')
}

// G. 登录失败必须说得出原因
//
// 2026-09-08 回归：本模块首版把登录链路的码一并挡在 fail-closed 之外，用户在
// 「协议版本已更新，请重新阅读并勾选后再登录」时只看到页面兜底的「登录失败，请重试」，
// 于是一直重试一直失败，永远不知道要重新勾协议 —— 产品负责人报「无法正常登录」。
// request.js 里 401 分支的注释当初就写明过这个风险，首版没读到就收紧了判据。
//
// 判据不是「这些码现在在白名单里」（那等于照现状写断言），而是：**登录失败必须给出
// 用户可执行的下一步**。下面每条都断言服务端那句面向求职者的中文能原样到达用户。
console.log('\nG. 登录链路：失败必须说得出原因')
{
  const LOGIN_CASES = [
    ['LEGAL_VERSION_STALE', '协议版本已更新，请重新阅读并勾选后再登录'],
    ['SMS_CODE_INVALID', '验证码不正确，请重新输入'],
    ['SMS_TOO_FREQUENT', '验证码发送过于频繁,请 60 秒后再试'],
    ['WX_CONFIG_MISSING', '微信小程序登录暂不可用，请使用短信验证码登录'],
    ['QR_LOGIN_NOT_FOUND', '扫码登录已过期或不存在'],
    ['QR_LOGIN_ALREADY_CLAIMED', '扫码登录已被领取'],
    ['PHONE_ALREADY_BOUND', '该手机号已绑定其他账号'],
  ]
  for (const [code, serverMessage] of LOGIN_CASES) {
    const e = await errorOf(401, { success: false, error: { code, message: serverMessage } })
    assert(e.message === serverMessage, `${code} 的服务端中文原样到达用户（实际「${e.message || '(空→页面兜底句)'}」）`)
  }
  // 收口没有被整体放开。
  //
  // 这里**不能**拿机器码当样本：机器码会被更早的 isMachineErrorCode 拦住，
  // 就算把 fail-closed 默认改成全放开也照样绿 —— 首版断言就是这么写的，
  // 变异测试里「默认改成 return text」没红，暴露了这个盲区。
  // 要测默认，样本必须是**非机器码、且不面向用户**的字符串：
  // 用一体机 userErrorMessage.ts 记下的那个真实反例（中文，但在教运维配环境变量）。
  const opsFacing = '服务器缺少可用中文字体，无法生成求职材料 PDF；请配置 JOB_MATERIAL_PDF_FONT_PATH'
  const still = await errorOf(500, { success: false, error: { code: 'JOB_MATERIAL_PDF_FONT_MISSING', message: opsFacing } })
  assert(!still.message, 'fail-closed 默认仍然生效：未登记的码即便文案是中文也不透传（含中文≠面向用户）')
  const stillCode = await errorOf(400, { success: false, error: { code: 'SOME_INTERNAL_CODE', message: 'SOME_INTERNAL_CODE' } })
  assert(!stillCode.message, '未登记的机器码仍然被挡住')
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
