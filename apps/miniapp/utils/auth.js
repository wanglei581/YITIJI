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
  if (data.token) {
    storage.set(storage.KEYS.TOKEN, data.token);
    // 登录成功即取得补签资格，直到用户主动登出为止
    storage.set(storage.KEYS.RESIGNIN_ELIGIBLE, 1);
  }
  if (data.user) storage.set(storage.KEYS.USER, data.user);
}

/**
 * 是否允许 401 静默补签。
 *
 * 必须与「当前有没有可用 token」解耦：getToken() 在 JWT 过期时会
 * 先 clearSession() 再返回 null，因此「自然过期」和「主动登出」
 * 在 token 维度上完全同形。只用 token 判断会二选一地出错——
 * 要么过期后补不了签（原始 401 问题原样存在），
 * 要么登出后被自动登回（共用设备上的隐私问题）。
 */
function canSilentResignin() {
  return !!storage.get(storage.KEYS.RESIGNIN_ELIGIBLE);
}

/** 用户主动登出：连补签资格一并撤销。 */
function logout() {
  clearSession();
  storage.remove(storage.KEYS.RESIGNIN_ELIGIBLE);
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
  canSilentResignin,
  logout,
  getToken,
  isLoggedIn,
  getUser,
  saveSession,
  clearSession,
  wxLogin,
};
