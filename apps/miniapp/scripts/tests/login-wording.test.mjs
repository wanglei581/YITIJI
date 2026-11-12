// 2026-11-12 提审被微信驳回：登录页和弹窗不能出现「微信」字样。
// 这里真跑登录页源码：手机号快捷登录、短信登录失败时，屏上的提示都不带「微信」。
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadPageDefinition, instantiate, flush } from './page-sandbox.mjs'

function makeWx() {
  const toasts = []
  return {
    toasts,
    wx: {
      showToast: (o) => { toasts.push(o.title) },
      showLoading: () => {},
      hideLoading: () => {},
      showModal: () => {},
      navigateTo: () => {},
      redirectTo: () => {},
      reLaunch: () => {},
      switchTab: () => {},
      navigateBack: () => {},
      getStorageSync: () => '',
      setStorageSync: () => {},
      removeStorageSync: () => {},
    },
  }
}

function loadLaunch(rejectWith) {
  const { wx, toasts } = makeWx()
  const fail = () => Promise.reject(rejectWith)
  const api = new Proxy({ loginByPhone: fail, loginBySms: fail, smsLogin: fail, loginWithSms: fail, syncAiDeclarationsAfterLogin: () => {} }, {
    get: (t, k) => (k in t ? t[k] : () => Promise.resolve({})),
  })
  const auth = new Proxy({ saveSession: () => true }, { get: (t, k) => (k in t ? t[k] : () => undefined) })
  const def = loadPageDefinition('pages/launch/launch.js', { wx, modules: { api, auth } })
  const page = instantiate(def)
  page.setData({ agreed: true, legalBlocked: false })
  return { page, toasts }
}

// [码, 服务端原话（带「微信」）, 登录页应显示的话]
const SERVER_WX_MESSAGES = [
  ['WX_CONFIG_MISSING', '微信小程序登录暂不可用，请使用短信验证码登录', '手机号快捷登录暂不可用，请使用短信验证码登录'],
  ['WX_CODE_INVALID', '微信登录凭证无效或已过期，请重试', '登录凭证无效或已过期，请重试'],
  ['WX_CODE2SESSION_FAILED', '微信登录服务异常，请稍后再试', '登录服务异常，请稍后再试'],
  ['WX_TOKEN_FAILED', '微信服务暂不可用，请稍后再试', '登录服务暂不可用，请稍后再试'],
  ['SOMETHING_NEW', '微信那边出了点问题', '登录没有成功，可以改用短信验证码'],
]

for (const [code, message, expected] of SERVER_WX_MESSAGES) {
  test(`手机号快捷登录失败（${code}）：提示不带「微信」，说「${expected}」`, async () => {
    const err = Object.assign(new Error(message), { code })
    const { page, toasts } = loadLaunch(err)
    page.onGetPhoneNumber({ detail: { code: 'phone-code' } })
    await flush()
    assert.ok(toasts.length > 0, '应有失败提示')
    for (const t of toasts) assert.doesNotMatch(t, /微信/, `提示带了「微信」：${t}`)
    assert.equal(toasts.at(-1), expected)
  })
}

test('手机号快捷登录失败、没有原话：提示是不带「微信」的通用句', async () => {
  const { page, toasts } = loadLaunch(new Error(''))
  page.onGetPhoneNumber({ detail: { code: 'phone-code' } })
  await flush()
  assert.equal(toasts.at(-1), '登录没有成功，可以改用短信验证码')
})

test('服务端原话不带「微信」时照原话显示（例如手机号拿不到）', async () => {
  const err = Object.assign(new Error('无法获取手机号，请使用短信验证码登录'), { code: 'WX_PHONE_FAILED' })
  const { page, toasts } = loadLaunch(err)
  page.onGetPhoneNumber({ detail: { code: 'phone-code' } })
  await flush()
  assert.equal(toasts.at(-1), '无法获取手机号，请使用短信验证码登录')
})

test('短信验证码登录失败、原话带「微信」：换成不带的通用句', async () => {
  const err = Object.assign(new Error('微信服务暂不可用，请稍后再试'), { code: 'SOMETHING_NEW' })
  const { page, toasts } = loadLaunch(err)
  page.setData({ phone: '138 0013 8000', code: '123456', submitting: false })
  page.confirmSms()
  await flush()
  assert.equal(toasts.at(-1), '登录失败，请重试')
})
