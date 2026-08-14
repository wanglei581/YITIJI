// utils/auth.js
// 会话/登录状态管理。前端只持有后端下发的 token 与脱敏用户信息。
// ⚠️ 合规:appSecret / 手机号解密 只能在后端完成。前端仅把微信下发的临时 code
//    传给后端换取会话,绝不在前端解密手机号,绝不在前端保存 appSecret。

const storage = require('./storage');

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const EXPIRY_SAFETY_MS = 5000;

function decodeBase64Url(segment) {
  const normalized = String(segment || '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/g, '');
  let output = '';
  let buffer = 0;
  let bits = 0;

  for (const char of normalized) {
    const value = BASE64_ALPHABET.indexOf(char);
    if (value < 0) throw new Error('invalid base64url');
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
      buffer &= bits ? (1 << bits) - 1 : 0;
    }
  }
  return output;
}

function tokenExpiresAt(token) {
  if (typeof token !== 'string') return 0;
  const parts = token.split('.');
  if (parts.length !== 3) return 0;
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1]));
    const exp = Number(payload && payload.exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0;
  } catch (_) {
    return 0;
  }
}

function isTokenExpired(token, nowMs = Date.now()) {
  const expiresAt = tokenExpiresAt(token);
  return !expiresAt || expiresAt <= nowMs + EXPIRY_SAFETY_MS;
}

function getToken() {
  const token = storage.get(storage.KEYS.TOKEN);
  if (!token) return null;
  if (isTokenExpired(token)) {
    clearSession();
    return null;
  }
  return token;
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
