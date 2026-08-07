// utils/api.js（M0.2：登录与法务协议接口；后续批次按需扩展）
// 敏感凭证只允许存在于后端；前端只传 wx.login code / getPhoneNumber code。
const config = require('./config')
const request = require('./request')

/** 取当前有效协议版本。无激活版本时回落草拟哨兵（与服务端口径一致）。 */
function getLegalVersions() {
  const FALLBACK = 'draft-pending-legal-review'
  const fetchOne = (docType) =>
    request(`/kiosk/legal/${docType}`, { method: 'GET', needAuth: false })
      .then((doc) => {
        const v = doc && doc.version
        return typeof v === 'string' && v.trim() ? v.trim() : FALLBACK
      })
      .catch(() => FALLBACK)
  return Promise.all([fetchOne('terms_of_service'), fetchOne('privacy_policy')]).then(
    ([termsVersion, privacyVersion]) => ({ termsVersion, privacyVersion })
  )
}

/** 发送短信验证码。deviceId 用于设备维度频控，可省略。 */
function sendOtp(phone, deviceId) {
  if (config.USE_MOCK) return Promise.reject(Object.assign(new Error('当前为演示数据模式，登录需切真实后端'), { statusCode: 501 }))
  const data = deviceId ? { phone, deviceId } : { phone }
  return request('/member/auth/sms-code', { method: 'POST', data, needAuth: false })
}

/** 手机号 + 验证码登录；先取协议版本，版本不一致后端拒登。 */
function loginBySms(phone, code, deviceId) {
  if (config.USE_MOCK) return Promise.reject(Object.assign(new Error('当前为演示数据模式，登录需切真实后端'), { statusCode: 501 }))
  return getLegalVersions().then((v) => {
    const data = { phone, code, termsVersion: v.termsVersion, privacyVersion: v.privacyVersion }
    if (deviceId) data.deviceId = deviceId
    return request('/member/auth/login', { method: 'POST', data, needAuth: false })
  })
}

/**
 * 微信一键登录（getPhoneNumber 授权）。
 * e.detail.code（phoneCode）+ wx.login code → POST /member/auth/wx-login。
 * 后端完成 code2session 与手机号解密，appSecret 零前端暴露。
 */
function loginByPhone(phoneCode) {
  if (config.USE_MOCK) return Promise.reject(Object.assign(new Error('演示数据模式不支持微信登录，请切换真实后端'), { statusCode: 501 }))
  const codeP = new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (res.code) resolve(res.code)
        else reject(new Error('wx.login 未返回 code'))
      },
      fail: (err) => reject(Object.assign(new Error('wx.login 调用失败'), { detail: err })),
    })
  })
  return Promise.all([codeP, getLegalVersions()]).then(([code, v]) =>
    request('/member/auth/wx-login', {
      method: 'POST',
      data: { code, phoneCode, termsVersion: v.termsVersion, privacyVersion: v.privacyVersion },
      needAuth: false,
    })
  )
}

/** 当前登录会员（boot 时校验会话）。 */
function getMe() {
  if (config.USE_MOCK) return Promise.reject(Object.assign(new Error('当前为演示数据模式，登录需切真实后端'), { statusCode: 501 }))
  return request('/member/me', { method: 'GET', needAuth: true })
}

function logout() {
  if (config.USE_MOCK) return Promise.resolve({ loggedOut: true })
  return request('/member/auth/logout', { method: 'POST', needAuth: true })
}

module.exports = {
  getLegalVersions,
  sendOtp,
  loginBySms,
  loginByPhone,
  getMe,
  logout,
}
