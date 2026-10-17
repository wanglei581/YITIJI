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
/**
 * 作废标记：资格删不掉时写进资格那一格；资格那一格连它也写不进时，写进本机资料那一格（zyd_user）。
 * 冷启动后两处任何一处是它，都不会被当成可恢复。
 */
const ELIGIBILITY_VOID = '!';

/** 恢复凭证的明文格式（与服务端 RESTORE_TOKEN_PATTERN 一致）：组号.密钥，base64url。 */
const RESTORE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/;

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
  recordRestoreCredential(data.user, data.restoreToken, isResignin);
  return true;
}

/**
 * 同设备恢复凭证（FLOW1c）跟着这次会话写下。写不进也不影响这次登录：只是访问令牌过期后
 * 这台手机要再登录一次（补签时旧凭证在宽限期内还能用，过了宽限期会被服务端判重放）。
 * 显式登录没带凭证（旧版 API、或请求没被认成小程序）：删掉旧的那一格，不留上一位的；
 * 删不掉也用不上——只认 memberId 等于上次明确登录的那一位。
 */
function recordRestoreCredential(user, token, isResignin) {
  const memberId = user && user.id != null && user.id !== '' ? String(user.id) : '';
  if (memberId && typeof token === 'string' && RESTORE_TOKEN_PATTERN.test(token)) {
    storage.set(storage.KEYS.RESTORE, { memberId, token });
    return;
  }
  if (!isResignin) storage.remove(storage.KEYS.RESTORE);
}

/**
 * 上次明确登录的那一位在这台手机上的恢复凭证（FLOW1c）。严格读：读失败与「确实没有」分开。
 * @param {string} expected restorableMember().id
 * @returns {{ ok: boolean, token: string | null }}
 *   ok=false —— 这一次读不出来，调用方按临时失败处理（不要改走微信补签：没绑微信的账号会被判确定失败而登出）；
 *   token=null —— 没有，或记的不是这一位（不用，也不删）。
 */
function restoreCredential(expected) {
  const read = storage.read(storage.KEYS.RESTORE);
  if (!read.ok) return { ok: false, token: null };
  const value = read.found ? read.value : null;
  if (!expected || !value || typeof value !== 'object' || String(value.memberId) !== String(expected)) {
    return { ok: true, token: null };
  }
  return { ok: true, token: typeof value.token === 'string' && RESTORE_TOKEN_PATTERN.test(value.token) ? value.token : null };
}

/** 这台手机上存着的恢复凭证（不论是哪一位）。主动退出时交服务端作废用。 */
function storedRestoreToken() {
  const value = storage.get(storage.KEYS.RESTORE, null);
  return value && typeof value === 'object' && typeof value.token === 'string' && RESTORE_TOKEN_PATTERN.test(value.token)
    ? value.token
    : null;
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
  const raw = storage.read(storage.KEYS.RESIGNIN_ELIGIBLE);
  // 这一格读不出来：说不清有没有资格，放行到补签——补签出发时认不清是谁，按临时失败处理（不登出、不删资格）。
  if (!raw.ok) return true;
  return raw.found && !!raw.value && raw.value !== ELIGIBILITY_VOID;
}

/**
 * 显式登录时记下恢复资格（FLOW1b）：登录成功即取得补签资格，直到用户主动登出为止；
 * 资格里记的是「哪位会员」，过期后补签只认这一位，绝不把短信登录的 B 静默换成这个微信绑定的 A。
 * 补签成功是同一个人续签，不改它。
 *
 * 写完读回：确认已是这一位才算记下；记不下就作废旧资格并**读回确认已作废**（删掉或写成作废标，
 * 宁可不自动恢复，也不留下上一位的资格）。两样都确认不了返回 false，调用方不得再写新会话。
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
  return revokeEligibility();
}

/**
 * 只读盘上判断资格（纯函数：不写存储、不看内存旗子）——冷启动后看到的就是这个结论。
 *   id       可恢复的会员 id（旧值「1」时取本机资料的 id），否则 null；
 *   mismatch 资格认的是一位确定的会员，但本机资料（或它的作废标）证明不是这一位。
 * 证据只会让结论更保守：本机资料对不上就不恢复。令牌不当证据——换号时令牌那一格写失败，
 * 剩下的旧令牌对不上是常态，而资格与本机资料两格一致才是这次登录的结果。
 */
function judgeEligibility(raw, user) {
  if (!raw || raw === ELIGIBILITY_VOID) return { id: null, mismatch: false, legacy: false };
  const legacy = raw === 1 || raw === '1' || raw === true;
  if (user === ELIGIBILITY_VOID) return { id: null, mismatch: true, legacy };
  const userId = user && user.id != null && user.id !== '' ? String(user.id) : '';
  const member = legacy ? userId : String(raw);
  if (!member) return { id: null, mismatch: false, legacy };
  if (userId && userId !== member) return { id: null, mismatch: true, legacy };
  return { id: member, mismatch: false, legacy };
}

/**
 * 资格或本机资料这一格读不出来（读接口抛了，storage.get 会退回默认值、看起来像「没有」）：
 * 认不清是不是同一位，这一次按临时失败——不恢复、不作废、不删任何东西（Codex 冷审：读失败不能当成已清理）。
 */
function readEligibility() {
  const user = storage.read(storage.KEYS.USER);
  const eligible = storage.read(storage.KEYS.RESIGNIN_ELIGIBLE);
  if (!user.ok || !eligible.ok) return { id: null, mismatch: false, legacy: false, unreadable: true, raw: null };
  const raw = eligible.found ? eligible.value : null;
  return Object.assign(judgeEligibility(raw, user.found ? user.value : null), { unreadable: false, raw });
}

/** 资格那一格**读得出来**，且为空或作废标。读不出来不算已作废。 */
function eligibilityCleared() {
  const raw = storage.read(storage.KEYS.RESIGNIN_ELIGIBLE);
  return raw.ok && (!raw.found || !raw.value || raw.value === ELIGIBILITY_VOID);
}

/**
 * 作废恢复资格：本次运行内立即失效（内存旗子），存储里删掉；删不掉就写作废标记。
 * @returns {boolean} 盘上是否已确认作废。存储可以**只坏这一格**（Codex 冷审反例：资格写删都失败，
 *   令牌与本机资料照常删得掉），返回 false 时冷启动还认不认得出来，全看另外两格——调用方不得销毁它们。
 */
function revokeEligibility() {
  eligibilityRevoked = true;
  storage.remove(storage.KEYS.RESIGNIN_ELIGIBLE);
  if (!eligibilityCleared()) storage.set(storage.KEYS.RESIGNIN_ELIGIBLE, ELIGIBILITY_VOID);
  return eligibilityCleared();
}

/**
 * 删本机资料之前先问：删掉之后，冷启动的结论会不会变宽（本来不可恢复，删完成了可恢复）。会就不删——
 * 它就是冷启动唯一还能认出不一致的证据（Codex 冷审反例：资格那一格写删都失败，本机资料却照常删得掉）。
 */
function removeUserUnlessLastEvidence() {
  const found = readEligibility();
  if (found.unreadable) return;
  // 旧版本的「1」只能靠本机资料认人：没能迁成会员 id（资格那一格写失败）时，它是唯一的认人依据，留着（Codex 冷审）。
  if (found.legacy && found.id) return;
  if (found.id === null && judgeEligibility(found.raw, null).id !== null) return;
  storage.remove(storage.KEYS.USER);
}

/**
 * 对账（FLOW1b，Codex 冷审）：恢复资格认的会员必须就是本机资料那一位；对不上（撕裂写、旧版本残留）
 * 就按不可恢复处理并作废，不能只返回 null。作废没能在盘上确认时，证据就是本机资料：
 * 删它一律经 removeUserUnlessLastEvidence，冷启动照样认得出来。
 *
 * 旧版本的资格只记了「1」、认人要靠本机资料：对得上就趁资料还在迁成会员 id。clearSession 也先走这里，
 * 所以哪个页面先调 getToken 都不会把升级上来的老用户清成「认不出人」、逼他再收一次短信（Codex 冷审）。
 */
function reconcileEligibility() {
  const found = readEligibility();
  if (found.mismatch) revokeEligibility();
  else if (found.legacy && found.id) storage.set(storage.KEYS.RESIGNIN_ELIGIBLE, found.id);
}

/**
 * 上次**明确登录**的会员（补签只认这一位）。{ id, unreadable }：
 *   id         会员 id；没有、或认不出是谁时为 null；
 *   unreadable 资格或本机资料这一次读不出来——认不清，调用方按临时失败处理（可重试），不当成「没有资格」去登录页。
 *
 * 只读存储，不调 getToken。旧值 1：本机资料还在就以它的 id 为准（对账时已就地迁成 id，迁不进去也照样认这一位）；
 * 不在就认不出人，删掉旧值、不自动恢复。
 */
function restorableMember() {
  if (sessionRevoked || eligibilityRevoked) return { id: null, unreadable: false };
  reconcileEligibility();
  if (eligibilityRevoked) return { id: null, unreadable: false };
  const found = readEligibility();
  if (found.unreadable) return { id: null, unreadable: true };
  if (found.legacy && !found.id) storage.remove(storage.KEYS.RESIGNIN_ELIGIBLE);
  return { id: found.id, unreadable: false };
}

/** 上次明确登录的会员 id；读不清时也是 null（要区分用 restorableMember）。 */
function restorableMemberId() {
  return restorableMember().id;
}

/**
 * 只看盘上（不看内存旗子）：能不能**确认**冷启动后既读不回令牌、也恢复不了。读不清的一律算不能确认。
 */
function logoutPersisted() {
  const token = storage.read(storage.KEYS.TOKEN);
  if (!token.ok) return false;
  if (token.found && !isTokenExpired(token.value) && identityProven(token.value)) return false;
  const found = readEligibility();
  if (!found.unreadable) return found.id === null;
  // 资格那一格读不出来：本机资料是作废标时，资格是什么都恢复不了；否则说不清。
  const user = storage.read(storage.KEYS.USER);
  return user.ok && user.found && user.value === ELIGIBILITY_VOID;
}

/**
 * 用户主动登出：撤销会话与补签资格，并推进代际作废所有在途请求。
 * @returns {boolean} 退出是否已落盘——冷启动后既读不回令牌、也恢复不了。false 时本次运行照样是退出状态
 *   （内存撤销位），只是存储坏得连作废标都写不进，调用方要如实告诉用户。
 */
function logout() {
  // 先在内存里推进代际、置撤销位，再动存储：前两步不可能失败，
  // 即便下面的清理全军覆没，本次运行也读不回旧身份、也不会再补签。
  bumpSessionGeneration();
  sessionRevoked = true;
  // 先作废资格。资格删不掉也写不进作废标时，本机资料换成作废标——冷启动靠它认出「已退出」；
  // 换不进去，删除也会被 removeUserUnlessLastEvidence 拦下，不销毁冷启动唯一还认得出的证据。
  if (!revokeEligibility()) storage.set(storage.KEYS.USER, ELIGIBILITY_VOID);
  storage.remove(storage.KEYS.TOKEN);
  // 令牌删不掉、而且还是一枚有效的会话：写成作废标，冷启动读不回来。
  const left = storage.get(storage.KEYS.TOKEN);
  if (left && !isTokenExpired(left) && identityProven(left)) storage.set(storage.KEYS.TOKEN, ELIGIBILITY_VOID);
  removeUserUnlessLastEvidence();
  // 恢复凭证（FLOW1c）：删掉；删不掉写作废标。留下也换不出会话——上面已经作废了恢复资格。
  storage.remove(storage.KEYS.RESTORE);
  if (storage.get(storage.KEYS.RESTORE)) storage.set(storage.KEYS.RESTORE, ELIGIBILITY_VOID);
  return logoutPersisted();
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
  // 资格作废没确认时，本机资料的删除会被拦下：它就是冷启动的拒绝依据。
  reconcileEligibility();
  storage.remove(storage.KEYS.TOKEN);
  removeUserUnlessLastEvidence();
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
  restorableMember,
  restorableMemberId,
  restoreCredential,
  storedRestoreToken,
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
