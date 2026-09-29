// utils/api-legal-consent.js
// api 门面的一段：用户用服务之前要看清、要确认的东西 —— 法务文档（C1）、登录前的协议
// 版本（C4）、AI 授权与两项声明（C6），以及带 ai 标记的请求的前后置（C6 / C7）。
//
// 为什么单独成文件：utils/api.js 已超过 1000 行（CLAUDE.md §8：只减不增），而这一段
// 自成一体。api.js 把这里的方法并进同一个 api 对象，页面照旧 `api.xxx` 调用；
// 契约门禁 scripts/verify-miniapp-api-contract.mjs 同时读 api.js 与本文件。

const config = require('./config');
const { request, configureAiRunner } = require('./request');
const auth = require('./auth');
const aiAccess = require('./ai-access');
const { SHARED_USER_MESSAGES } = require('./user-error');

/** 服务端 LEGAL_DOC_TYPES 里小程序会读的四种；标题只在服务端没给标题时兜底。 */
const LEGAL_DOC_TITLES = {
  terms_of_service: '用户服务协议',
  privacy_policy: '隐私政策',
  ai_disclaimer: 'AI 服务说明',
  operator_info: '经营者信息',
};

/** 与服务端 LEGAL_DRAFT_FALLBACK_VERSION 同一个哨兵。只在开发版、体验版用。 */
const LEGAL_DRAFT_FALLBACK_VERSION = 'draft-pending-legal-review';

function mockUnavailable(what) {
  const e = new Error(`${what}需连接真实后端,当前为本地演示数据模式`);
  e.statusCode = 501;
  return e;
}

function legalDocsNotPublished() {
  const e = new Error(SHARED_USER_MESSAGES.LEGAL_DOCS_NOT_PUBLISHED);
  e.code = 'LEGAL_DOCS_NOT_PUBLISHED';
  return e;
}

// ---------- AI 授权与两项声明（/me/ai-consents，需登录） ----------

/** 本人各项授权的当前状态：[{ scope, consentVersion, granted, grantedAt, revokedAt }]。 */
function getAiConsentStatus() {
  if (config.USE_MOCK) return Promise.reject(mockUnavailable('AI 授权'));
  return request('/me/ai-consents/status', { method: 'GET', needAuth: true })
    .then((list) => (Array.isArray(list) ? list : []));
}

function grantAiConsent(scope) {
  if (config.USE_MOCK) return Promise.reject(mockUnavailable('AI 授权'));
  return request('/me/ai-consents', { method: 'POST', data: { scope }, needAuth: true });
}

function revokeAiConsent(scope) {
  if (config.USE_MOCK) return Promise.reject(mockUnavailable('AI 授权'));
  return request(`/me/ai-consents/${encodeURIComponent(scope)}/revoke`, { method: 'POST', needAuth: true });
}

/**
 * 逐项问声明。新声明的、且当前登录着，就顺手写服务端：服务端对会员只认这里的记录。
 * 写失败不拦这一次（开关没开时本就不需要）；开关打开后服务端会拒，走 runAi 里的补问。
 */
function ensureScopes(scopes) {
  return scopes.reduce((chain, scope) => chain.then(() => aiAccess.promptScope(scope).then((fresh) => {
    if (fresh && auth.isLoggedIn()) return grantAiConsent(scope).catch(() => null);
    return null;
  })), Promise.resolve());
}

/**
 * 带 ai 标记的请求发出之前、之后要做的事（request.js 在发请求时回调这里）。
 *   - 发出之前：按这一类请求要的声明逐项问一次（已声明的不再问）。
 *   - 403 AI_DECLARATION_REQUIRED：服务端说缺，就以服务端为准 —— 本机那条记录可能早于
 *     在别处的撤回，清掉重新问，问完只重发一次。
 *   - 401 AI_LOGIN_REQUIRED：登录档位打开了，弹一次登录提示；错误照常交给页面。
 */
function runAi(kind, send) {
  const afterSend = (err) => {
    if (err && err.code === 'AI_LOGIN_REQUIRED') aiAccess.promptLogin();
    throw err;
  };
  return ensureScopes(aiAccess.scopesFor(kind)).then(() => send().catch((err) => {
    if (!err || err.code !== 'AI_DECLARATION_REQUIRED') return afterSend(err);
    // 服务端的 missing 目前会被全局异常过滤器丢掉（只透传 code / message / details），
    // 两处都读；都没有就按这一类请求本该有的那几项补问。
    const scopes = aiAccess.scopesFromMissing(err.missing || err.details, kind);
    scopes.forEach((scope) => aiAccess.clearDeclared(scope));
    return ensureScopes(scopes).then(() => send()).catch(afterSend);
  }));
}

configureAiRunner(runAi);

const legalConsentApi = {
  // ---------- 法务文档（C1）与登录前协议版本（C4） ----------

  LEGAL_DOC_TITLES,

  /**
   * 读取某类法务文档当前激活的版本。服务端没有激活版本时回 data:null ——
   * 这不是出错，是「还没发布」，抛 LEGAL_DOC_UNAVAILABLE 让页面如实说暂未发布。
   */
  getLegalDocument(docType) {
    if (!Object.prototype.hasOwnProperty.call(LEGAL_DOC_TITLES, docType)) {
      return Promise.reject(new Error('不支持的法律文档类型'));
    }
    if (config.USE_MOCK) return Promise.reject(new Error('演示数据模式不提供正式法律文档'));
    return request(`/kiosk/legal/${docType}`, { method: 'GET', needAuth: false }).then((doc) => {
      if (!doc || !doc.version || !doc.content) {
        const e = new Error('正式版本暂未发布');
        e.code = 'LEGAL_DOC_UNAVAILABLE';
        throw e;
      }
      return doc;
    });
  },

  /**
   * 登录要提交的两份协议版本号。
   *
   * 正式版（release）不回落（C4 / P0-7）：没有已发布的版本就抛 LEGAL_DOCS_NOT_PUBLISHED，
   * 网络失败就照实失败 —— 不能让用户勾着一份没发布的草稿去登录。服务端生产环境也会拒
   * （legal-docs-published-guard.ts），这里先拦，是为了在用户点「微信一键登录」交出手机号之前
   * 就说清楚。代价（有意为之）：服务端的应急开关 LEGAL_DOCS_REQUIRE_PUBLISHED=false 对小程序正式版无效。
   * 开发版、体验版照旧回落草稿哨兵，与服务端 resolveActiveLegalVersions 口径一致。
   */
  getLegalVersions() {
    const strict = config.envVersion === 'release';
    const fetchOne = (docType) =>
      request(`/kiosk/legal/${docType}`, { method: 'GET', needAuth: false }).then(
        (doc) => {
          const v = doc && typeof doc.version === 'string' ? doc.version.trim() : '';
          if (v) return v;
          if (strict) throw legalDocsNotPublished();
          return LEGAL_DRAFT_FALLBACK_VERSION;
        },
        (err) => {
          if (strict) throw err;
          return LEGAL_DRAFT_FALLBACK_VERSION;
        },
      );
    return Promise.all([
      fetchOne('terms_of_service'),
      fetchOne('privacy_policy'),
    ]).then(([termsVersion, privacyVersion]) => ({ termsVersion, privacyVersion }));
  },

  // ---------- AI 授权（账号级） ----------

  getAiConsentStatus,
  grantAiConsent,
  revokeAiConsent,

  /**
   * 会员岗位 AI 授权。会员授权是账号级 job_ai scope，不得复用匿名任务 consent。
   * 页面拿到的统一 active 字段只用于展示分流，服务端仍保留原始授权版本与时间。
   */
  getMemberJobFitConsent() {
    return getAiConsentStatus().then((list) => {
      const item = list.find((v) => v && v.scope === 'job_ai');
      return item ? { ...item, active: item.granted === true } : { scope: 'job_ai', active: false };
    });
  },

  grantMemberJobFitConsent() {
    return grantAiConsent('job_ai').then((item) => ({ ...item, active: !!(item && item.granted) }));
  },

  revokeMemberJobFitConsent() {
    return revokeAiConsent('job_ai').then((item) => ({ ...item, active: !!(item && item.granted) }));
  },

  // ---------- 两项声明（C6） ----------

  /**
   * 录音开始之前问（不是录完上传时才问）：年满 14 周岁 + 录音单独同意。
   * 同意则 resolve；选「未满」或「改用手打」则 reject（aiAccess.isDeclined 可判）。
   */
  ensureVoiceConsent() {
    return ensureScopes(aiAccess.scopesFor('voice'));
  },

  /**
   * 页面自己已经用勾选框问过录音同意（语音说简历的同意页）：录音同意直接记下，
   * 年满 14 周岁仍要问一次（没声明过的话）。登录着就写账号，与模拟面试、小青共用这一次。
   */
  confirmVoiceConsent() {
    return ensureScopes([aiAccess.AGE_SCOPE]).then(() => {
      const fresh = !aiAccess.isDeclared(aiAccess.VOICE_SCOPE);
      aiAccess.markDeclared(aiAccess.VOICE_SCOPE);
      if (fresh && auth.isLoggedIn()) return grantAiConsent(aiAccess.VOICE_SCOPE).catch(() => null);
      return null;
    });
  },

  /**
   * 登录成功之后对一次账：登录页的勾选行写着「并确认已年满 14 周岁」，登录即声明。
   *   - 服务端已同意 → 本机也记上；
   *   - 服务端记着录音同意已撤回 → 以撤回为准，清掉本机旧记录，不替用户重新同意；
   *   - 服务端没有记录、本机有 → 补写服务端（用户未登录时在本机同意过）。
   * 失败不影响登录本身：开关打开后缺的那一项会在下一次用 AI 时补问。
   */
  syncAiDeclarationsAfterLogin() {
    aiAccess.markDeclared(aiAccess.AGE_SCOPE);
    if (config.USE_MOCK) return Promise.resolve();
    return getAiConsentStatus().then((rows) => Promise.all(
      [aiAccess.AGE_SCOPE, aiAccess.VOICE_SCOPE].map((scope) => {
        const row = rows.find((r) => r && r.scope === scope);
        if (row && row.granted) {
          aiAccess.markDeclared(scope);
          return null;
        }
        if (scope === aiAccess.VOICE_SCOPE && row && row.revokedAt) {
          aiAccess.clearDeclared(scope);
          return null;
        }
        return aiAccess.isDeclared(scope) ? grantAiConsent(scope).catch(() => null) : null;
      }),
    )).catch(() => null);
  },

  /**
   * 撤回录音同意。登录着先撤服务端，撤成功才清本机；没登录只有本机那一条。
   * 撤回之后，录音入口会重新问，不问就只能手打。
   */
  revokeVoiceConsent() {
    const clearLocal = (res) => {
      aiAccess.clearDeclared(aiAccess.VOICE_SCOPE);
      return res || { revoked: true };
    };
    if (config.USE_MOCK || !auth.isLoggedIn()) return Promise.resolve(clearLocal());
    return revokeAiConsent(aiAccess.VOICE_SCOPE).then(clearLocal);
  },
};

module.exports = legalConsentApi;
