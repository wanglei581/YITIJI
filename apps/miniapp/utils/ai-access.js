// utils/ai-access.js
// 用 AI、录音和上传简历之前的两项本人声明（C6），以及 AI 登录档位的登录提示（C7），
// 在小程序这一端的唯一落点。只管三件事：本机记下的声明、随请求带的声明头、三个提示框。
// 写服务端的那一半（/me/ai-consents）在 utils/api-legal-consent.js —— 端点只出现在
// api 门面里，契约门禁才读得到。本模块只依赖 storage，request.js 可以直接引用它而不成环。
//
// 服务端口径（services/api/src/ai-access/ai-access.service.ts、
// services/api/src/common/privacy/client-declaration.ts）：
//   - 未登录：随请求带四个声明头。AI_DECLARATION_ENFORCEMENT 关着时只记「未声明」，
//     打开后缺头即拒：403 AI_DECLARATION_REQUIRED，error.missing 列出缺哪几项。
//   - 已登录：服务端只认 /me/ai-consents 里的 age_14_plus / voice_recording，
//     请求头不入库。所以带着会员令牌的请求不带声明头 —— 否则在别处撤回的录音同意
//     会被本机一条旧记录绕过去。
//   - AI_LOGIN_GATE=before_generate 时，未登录的生成、语音、导出请求 401 AI_LOGIN_REQUIRED。
//
// 声明只问一次、记在本机；版本号换代（服务端 CURRENT_*_CONSENT_VERSION 改了）就重新问。

const storage = require('./storage');
const { SHARED_USER_MESSAGES } = require('./user-error');

const AGE_SCOPE = 'age_14_plus';
const VOICE_SCOPE = 'voice_recording';

/** 与服务端 member-privacy.service.ts 的 CURRENT_*_CONSENT_VERSION 逐字一致。 */
const SCOPES = {
  [AGE_SCOPE]: {
    version: 'age-14-plus-v1',
    header: 'X-Age-14-Plus',
    flag: 'declared',
    versionHeader: 'X-Age-14-Plus-Version',
  },
  [VOICE_SCOPE]: {
    version: 'voice-recording-v1',
    header: 'X-Voice-Recording',
    flag: 'granted',
    versionHeader: 'X-Voice-Recording-Version',
  },
};

/**
 * 请求要先有哪几项声明。与服务端 @AiUse 的标记对齐：
 *   generate / voice 由服务端强制；upload 是小程序自己加的一道（上传简历等本人文件也是
 *   处理个人信息，未满 14 周岁要监护人同意，小程序办不了）；export 只受登录档位约束。
 */
const KIND_SCOPES = {
  generate: [AGE_SCOPE],
  voice: [AGE_SCOPE, VOICE_SCOPE],
  upload: [AGE_SCOPE],
  export: [],
};

/**
 * 录音单独同意：五件事写全（用途、交给谁、保存多久、不做什么、怎么撤回）。
 * 「交给谁」「保存多久」照法务试运行版隐私政策第二、三条的写法；后台发布的正式版改了，这里跟着改。
 */
const VOICE_CONSENT_ITEMS = [
  '只把你说的话转成文字，用于语音说简历、模拟面试作答和向小青提问。',
  '录音交给受托的语音识别服务商腾讯云转成文字。',
  '转完即删，不保存录音。',
  '不做声纹识别，不拿去训练模型。',
  '可以随时在「我的 → 账号设置 → 隐私与数据」撤回，撤回后改用手打。',
];

/** 用户选「未满」或「改用手打」时抛出的码；文案在 utils/user-error.js 的 SHARED_USER_MESSAGES。 */
const DECLINED_CODES = {
  [AGE_SCOPE]: 'AI_AGE_NOT_DECLARED',
  [VOICE_SCOPE]: 'AI_VOICE_NOT_CONSENTED',
};

function readAll() {
  const value = storage.get(storage.KEYS.AI_DECLARATIONS, null);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** 本机是否已按当前版本声明过。旧版本的记录不算。 */
function isDeclared(scope) {
  const meta = SCOPES[scope];
  const item = readAll()[scope];
  return !!meta && !!item && item.version === meta.version;
}

/** @returns {boolean} 写进去并读回来才算记下 */
function markDeclared(scope) {
  const meta = SCOPES[scope];
  if (!meta) return false;
  const next = Object.assign({}, readAll(), { [scope]: { version: meta.version, at: Date.now() } });
  return storage.set(storage.KEYS.AI_DECLARATIONS, next) && isDeclared(scope);
}

function clearDeclared(scope) {
  const all = readAll();
  if (!all[scope]) return true;
  const next = Object.assign({}, all);
  delete next[scope];
  return storage.set(storage.KEYS.AI_DECLARATIONS, next);
}

/** 本机已声明的那几项对应的请求头。只给不带会员令牌的请求用（见文件头）。 */
function declarationHeaders() {
  const out = {};
  Object.keys(SCOPES).forEach((scope) => {
    if (!isDeclared(scope)) return;
    const meta = SCOPES[scope];
    out[meta.header] = meta.flag;
    out[meta.versionHeader] = meta.version;
  });
  return out;
}

function scopesFor(kind) {
  return (KIND_SCOPES[kind] || []).slice();
}

/** 服务端 missing 里认得的那几项；一项都认不出来，就按这一类请求本该有的补。 */
function scopesFromMissing(missing, kind) {
  const known = Array.isArray(missing) ? missing.filter((s) => !!SCOPES[s]) : [];
  return known.length ? known : scopesFor(kind);
}

function declinedError(scope) {
  const code = DECLINED_CODES[scope];
  const e = new Error(SHARED_USER_MESSAGES[code]);
  e.code = code;
  e.scope = scope;
  return e;
}

function isDeclined(err) {
  return !!err && (err.code === DECLINED_CODES[AGE_SCOPE] || err.code === DECLINED_CODES[VOICE_SCOPE]);
}

// ── 提示框。同一时刻只开一个：页面同时发两个 AI 请求时，不能叠两层同样的问题。 ──

let pending = null;

function showModal(options) {
  return new Promise((resolve) => {
    wx.showModal(Object.assign({}, options, {
      success: (r) => resolve(!!(r && r.confirm)),
      fail: () => resolve(false),
    }));
  });
}

function askScope(scope) {
  if (scope === AGE_SCOPE) {
    return showModal({
      title: '你已年满 14 周岁吗？',
      content: '使用 AI 分析、语音转文字和上传简历之前需要确认。未满 14 周岁的，需要监护人同意后才能使用，小程序暂时办不了。',
      confirmText: '已满',
      cancelText: '未满',
    });
  }
  return showModal({
    title: '录音单独同意',
    content: VOICE_CONSENT_ITEMS.map((line, i) => `${i + 1}. ${line}`).join('\n'),
    confirmText: '同意录音',
    cancelText: '改用手打',
  });
}

/**
 * 问一项声明。已声明直接过；同意就记在本机。
 * @returns {Promise<boolean>} true = 这一次新声明的（调用方据此决定要不要写服务端）；
 *   早已声明过返回 false；拒绝则 reject（code 见 DECLINED_CODES，isDeclined 可判）。
 */
function promptScope(scope) {
  if (!SCOPES[scope]) return Promise.resolve(false);
  if (isDeclared(scope)) return Promise.resolve(false);
  if (pending && pending.scope === scope) return pending.promise;
  // 另一项正在问：等它问完再问这一项，两层提示框不叠在一起。
  const before = pending ? pending.promise.catch(() => null) : Promise.resolve();
  const run = before.then(() => {
    if (isDeclared(scope)) return false;
    return askScope(scope).then((agreed) => {
      if (!agreed) throw declinedError(scope);
      markDeclared(scope);
      return true;
    });
  });
  const entry = { scope, promise: run };
  pending = entry;
  const release = () => { if (pending === entry) pending = null; };
  run.then(release, release);
  return run;
}

let loginPromptOpen = false;

/**
 * AI_LOGIN_REQUIRED 的登录提示。只提示、不替用户跳：他可能正填着一张表，
 * 点「去登录」才走；登录页登完会回到当前这一页。
 */
function promptLogin() {
  if (loginPromptOpen) return;
  loginPromptOpen = true;
  showModal({
    title: '先登录再用 AI',
    content: '按规定，用 AI 生成、语音转文字和导出 AI 材料之前，需要先用手机号登录。登录后回到这一页继续。',
    confirmText: '去登录',
    cancelText: '稍后',
  }).then((go) => {
    loginPromptOpen = false;
    if (go) wx.navigateTo({ url: '/pages/launch/launch' });
  });
}

module.exports = {
  AGE_SCOPE,
  VOICE_SCOPE,
  SCOPES,
  VOICE_CONSENT_ITEMS,
  DECLINED_CODES,
  isDeclined,
  isDeclared,
  markDeclared,
  clearDeclared,
  declarationHeaders,
  scopesFor,
  scopesFromMissing,
  promptScope,
  promptLogin,
};
