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
  // 撤销位在存储之前:登出/换号没落盘干净时,旧身份不得再被读出来。
  if (sessionRevoked) return null;
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
  if (sessionRevoked) return null;
  return storage.get(storage.KEYS.USER, null);
}

/**
 * 会话代际：本次运行内单调递增的身份计数，每换一次「人」就 +1。
 * 补签要走 wx.login + 一次网络往返，其间用户可能已登出或换号；代际给「我出发时是谁」
 * 一个可比较的值，让晚到的成功/失败当场被拒。只放内存：它作废的是在途 Promise，
 * 落盘会把「推进代际」变成一次可能失败的写。
 */
let generation = 1;

/**
 * 会话撤销位（本次运行内）。登出、或新会话没能写进去再读回来时置起，期间
 * getToken / getUser / isLoggedIn / canSilentResignin 一律按未登录处理 ——
 * storage.remove 可能抛、也可能安静没删，只清存储挡不住旧身份被读回。
 */
let sessionRevoked = false;

/** 当前会话代际。 */
function sessionGeneration() {
  return generation;
}

/** 在途请求/补签出发时的代际是否仍是当前会话。 */
function isSameSession(expected) {
  return generation === expected;
}

/** 推进代际：在途的一切按出发代际判定，自此一律失效。这一步不可能失败。 */
function bumpSessionGeneration() {
  generation += 1;
  return generation;
}

/** 写完读回是否一致。set 可能抛，也可能安静丢写——返回值盖不住后者。 */
function sameJson(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (_) {
    return false;
  }
}

/**
 * 保存后端下发的会话。data: { token, user }
 *
 * options.expectGeneration —— **在途补签专用**：代际仍等于该值才写入，且不推进代际
 * （同一个人续了一次签，不是换人）；代际已变说明这份成果属于一个已被顶掉的会话。
 * 不传 = 显式登录 / 换号：推进代际后写入，因此不能拿它顺手刷新用户资料。
 * @returns {boolean} 新会话是否真的可用（写进去、再读回来、且读回的就是刚写的那份）
 */
function saveSession(data = {}, options = {}) {
  const expect = options.expectGeneration;
  const isResignin = expect !== undefined && expect !== null;
  if (isResignin && !isSameSession(expect)) return false;

  if (!isResignin) {
    // 先推进代际、先置撤销位，再落盘：在途补签即刻失效，且「新会话还没确认可用」
    // 这段时间里上一个账号也读不出来。
    bumpSessionGeneration();
    sessionRevoked = true;
  }

  if (data.token) {
    storage.set(storage.KEYS.TOKEN, data.token);
    // 登录成功即取得补签资格，直到用户主动登出为止
    storage.set(storage.KEYS.RESIGNIN_ELIGIBLE, 1);
  }
  if (data.user) storage.set(storage.KEYS.USER, data.user);

  // 写完读回：存不下的会话等于没有会话，对不上就维持 fail-closed
  // （显式登录保持撤销位，补签由调用方按失败处理）。
  const usable = !!data.token && storage.get(storage.KEYS.TOKEN) === data.token
    && (!data.user || sameJson(storage.get(storage.KEYS.USER, null), data.user));
  if (!usable) return false;
  if (!isResignin) sessionRevoked = false;
  return true;
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
  if (sessionRevoked) return false;
  return !!storage.get(storage.KEYS.RESIGNIN_ELIGIBLE);
}

/** 用户主动登出：撤销会话与补签资格，并推进代际作废所有在途请求。 */
function logout() {
  // 先在内存里推进代际、置撤销位，再动存储：前两步不可能失败，
  // 即便下面的清理全军覆没，本次运行也读不回旧身份、也不会再补签。
  bumpSessionGeneration();
  sessionRevoked = true;
  clearSession();
  storage.remove(storage.KEYS.RESIGNIN_ELIGIBLE);
}

/**
 * 只在代际未变时登出：补签失败的回调同样会晚到，A 的失败可能在 B 登录之后才执行，
 * 无条件 logout() 就会把 B 踢下线。
 */
function logoutIfSameSession(expected) {
  // 形参不叫 generation:模块里那个 generation 是当前代际本身,同名会把两者读混。
  if (!isSameSession(expected)) return false;
  logout();
  return true;
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
  logoutIfSameSession,
  sessionGeneration,
  isSameSession,
  getToken,
  isLoggedIn,
  getUser,
  saveSession,
  clearSession,
  wxLogin,
};
