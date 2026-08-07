// utils/auth.js
// 会话/登录状态管理。前端只持有后端下发的 token 与脱敏用户信息。
// ⚠️ 合规:appSecret / 手机号解密 只能在后端完成。前端仅把微信下发的临时 code
//    传给后端换取会话,绝不在前端解密手机号,绝不在前端保存 appSecret。

const storage = require('./storage');

function getToken() {
  return storage.get(storage.KEYS.TOKEN);
}

function isLoggedIn() {
  return !!getToken();
}

function getUser() {
  return storage.get(storage.KEYS.USER, null);
}

/**
 * 保存后端下发的会话。data: { token, user }
 */
function saveSession(data = {}) {
  if (data.token) storage.set(storage.KEYS.TOKEN, data.token);
  if (data.user) storage.set(storage.KEYS.USER, data.user);
}

function clearSession() {
  storage.remove(storage.KEYS.TOKEN);
  storage.remove(storage.KEYS.USER);
}

/**
 * 拉起微信登录,拿到临时 code(供后端 code2session)。
 * 真正换 openid/session_key 在后端做。
 * @returns {Promise<string>} wx.login 的 code
 */
function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        if (res.code) resolve(res.code);
        else reject(new Error('微信登录失败:未获取到 code'));
      },
      fail(err) {
        reject(new Error(err.errMsg || '微信登录失败'));
      },
    });
  });
}

module.exports = {
  getToken,
  isLoggedIn,
  getUser,
  saveSession,
  clearSession,
  wxLogin,
};
