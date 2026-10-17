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

/** JWT 的 sub。后端 member-auth.service.ts 用 user.id 签发。 */
function tokenSubject(token) {
  if (typeof token !== 'string') return '';
  const parts = token.split('.');
  if (parts.length !== 3) return '';
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1]));
    return payload && payload.sub != null ? String(payload.sub) : '';
  } catch (_) {
    return '';
  }
}

/**
 * token 与 user 是不是同一个人。
 *
 * 两格是两次独立的写：其中一次失败或被安静丢掉，盘上就会一格留着 A、另一格换成 B。
 * 本次运行内有撤销位兜着，但**冷启动后撤销位没了**，只剩这两格——页面显示 A 的资料，
 * 请求却带着 B 的 token。证明不了同一个人就当没有会话（每次读都现算，
 * 因此即使 clearSession 的删除失败，下一次读仍然是关着的）。
 */
function identityProven(token) {
  const subject = tokenSubject(token);
  const user = storage.get(storage.KEYS.USER, null);
  const id = user && user.id != null ? String(user.id) : '';
  return !!subject && subject === id;
}

function getToken() {
  // 撤销位在存储之前:登出/换号没落盘干净时,旧身份不得再被读出来。
  if (sessionRevoked) return null;
  const token = storage.get(storage.KEYS.TOKEN);
  if (!token) return null;
  if (isTokenExpired(token) || !identityProven(token)) {
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
  if (!identityProven(storage.get(storage.KEYS.TOKEN))) {
    clearSession();
    return null;
  }
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

/**
 * 恢复资格作废位（本次运行内，FLOW1b）。资格与本机资料认的不是同一位时置起：
 * 存储的删除可能抛、也可能安静没删，只靠删存储挡不住「清掉资料后再读一次又认出上一位」。
 * 下一次显式登录、资格确认写成新的那一位时才放下。
 */
let eligibilityRevoked = false;
/** 删不掉旧资格时写进去的作废标记：冷启动后也不会被当成可恢复。 */
const ELIGIBILITY_VOID = '!';

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
    // 恢复资格先于会话落盘（FLOW1b）：必须确认已改成这一位，或确认已删掉；两样都做不到就不写新会话。
    // 否则盘上会出现「会话是 B、恢复资格还是 A」，令牌过期后被恢复成 A（Codex 冷审 P1）。
    if (!recordRestorableMember(data.user)) return false;
  }

  if (data.token) storage.set(storage.KEYS.TOKEN, data.token);
  if (data.user) storage.set(storage.KEYS.USER, data.user);

  // 写完读回：存不下的会话等于没有会话，对不上就维持 fail-closed
  // （显式登录保持撤销位，补签由调用方按失败处理）。
  const usable = !!data.token && storage.get(storage.KEYS.TOKEN) === data.token
    && (!data.user || sameJson(storage.get(storage.KEYS.USER, null), data.user))
    && identityProven(data.token);
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
  if (eligibilityRevoked) return false;
  const raw = storage.get(storage.KEYS.RESIGNIN_ELIGIBLE);
  return !!raw && raw !== ELIGIBILITY_VOID;
}

/**
 * 显式登录时记下恢复资格（FLOW1b）：登录成功即取得补签资格，直到用户主动登出为止；
 * 资格里记的是「哪位会员」，过期后补签只认这一位，绝不把短信登录的 B 静默换成这个微信绑定的 A。
 * 补签成功是同一个人续签，不改它。
 *
 * 写完读回：确认已是这一位才算记下；记不下就删掉旧资格并**读回确认已删**（宁可不自动恢复，
 * 也不留下上一位的资格）。两样都确认不了返回 false，调用方不得再写新会话。
 * 存储的 set / remove 可能抛、也可能安静丢操作，返回值盖不住后者，只认读回。
 */
function recordRestorableMember(user) {
  const memberId = user && user.id != null && user.id !== '' ? String(user.id) : '';
  if (memberId) {
    storage.set(storage.KEYS.RESIGNIN_ELIGIBLE, memberId);
    if (storage.get(storage.KEYS.RESIGNIN_ELIGIBLE) === memberId) {
      eligibilityRevoked = false;
      return true;
    }
  }
  storage.remove(storage.KEYS.RESIGNIN_ELIGIBLE);
  return !storage.get(storage.KEYS.RESIGNIN_ELIGIBLE);
}

/**
 * 作废恢复资格：本次运行内立即失效（内存旗子），存储里删掉；删不掉就写作废标记。
 * 两样都失败时存储整体坏了，本机资料也删不掉，冷启动时 reconcileEligibility 会再认出不一致。
 */
function revokeEligibility() {
  eligibilityRevoked = true;
  storage.remove(storage.KEYS.RESIGNIN_ELIGIBLE);
  if (storage.get(storage.KEYS.RESIGNIN_ELIGIBLE)) storage.set(storage.KEYS.RESIGNIN_ELIGIBLE, ELIGIBILITY_VOID);
}

/**
 * 对账（FLOW1b，Codex 冷审）：恢复资格认的会员必须就是本机资料这一位；对不上（撕裂写、旧版本残留）
 * 就按不可恢复处理并作废，不能只返回 null——清掉本机资料之后就再也认不出来了，第二次读会又认出上一位。
 * 所以 restorableMemberId 和 clearSession（销毁本机资料的地方）都先对账，调用顺序怎么排都一样。
 */
function reconcileEligibility() {
  const raw = storage.get(storage.KEYS.RESIGNIN_ELIGIBLE);
  if (!raw || raw === 1 || raw === '1' || raw === true || raw === ELIGIBILITY_VOID) return;
  const user = storage.get(storage.KEYS.USER, null);
  const userId = user && user.id != null && user.id !== '' ? String(user.id) : '';
  if (userId && userId !== String(raw)) revokeEligibility();
}

/**
 * 上次**明确登录**的会员 id（补签只认这一位）；没有、或认不出是谁时返回 null。
 *
 * 只读存储，不调 getToken：令牌过期时 getToken 会顺手清掉 zyd_user，而旧版本的资格只记了「1」，
 * 认人要靠 zyd_user。所以调用方要**先**调它，再碰 getToken / isLoggedIn。
 * 旧值 1：本机资料还在就以它的 id 为准、就地改写成 id；不在就认不出人，删掉旧值、不自动恢复。
 */
function restorableMemberId() {
  if (sessionRevoked || eligibilityRevoked) return null;
  reconcileEligibility();
  if (eligibilityRevoked) return null;
  const raw = storage.get(storage.KEYS.RESIGNIN_ELIGIBLE);
  if (raw === null || raw === undefined || raw === '' || raw === 0 || raw === false || raw === ELIGIBILITY_VOID) return null;
  if (raw === 1 || raw === '1' || raw === true) {
    const user = storage.get(storage.KEYS.USER, null);
    const id = user && user.id != null && user.id !== '' ? String(user.id) : '';
    if (id) {
      storage.set(storage.KEYS.RESIGNIN_ELIGIBLE, id);
      return id;
    }
    storage.remove(storage.KEYS.RESIGNIN_ELIGIBLE);
    return null;
  }
  // 一致性：本机资料还在时上面的对账已经核过；资料不在时（令牌过期已被清掉）靠两点保证——
  // saveSession 在新会话落盘前已确认资格是这一位或已删除；clearSession 清资料前先对账。
  return String(raw);
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
  // 清资料前先对账（FLOW1b）：这里是销毁「本机是哪一位」的地方，清掉之后不一致就再也认不出来了。
  reconcileEligibility();
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
      fail() {
        reject(new Error('微信登录没有成功，请再试一次'));
      },
    });
  });
}

module.exports = {
  canSilentResignin,
  restorableMemberId,
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
