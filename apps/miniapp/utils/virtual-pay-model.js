// utils/virtual-pay-model.js
// 会员已购服务次数汇总与微信小程序虚拟支付下单/调起/轮询确认逻辑（零硬编码价格/道具 ID/AppKey）。
// 严格遵循 p2d-verified.md §2（signData 字符串原样透传、callback 写法、mode=short_series_goods）与 §7（零外部付款引导）。

const { userMessageOf } = require('./user-error');

const VIRTUAL_PAY_MODE = 'short_series_goods';
const DEFAULT_MAX_CONFIRM_POLLS = 5;
const DEFAULT_CONFIRM_POLL_INTERVAL_MS = 2000;

const SERVICE_CATALOG = [
  {
    kind: 'resume_optimize',
    title: 'AI 简历优化',
    buyTitle: 'AI 简历优化（单次）',
    desc: '按次购买，在收费一体机登录同一账号后可直接使用 1 次',
  },
  {
    kind: 'mock_interview',
    title: 'AI 模拟面试',
    buyTitle: 'AI 模拟面试（单次）',
    desc: '按次购买，在收费一体机登录同一账号后可直接使用 1 次',
  },
];

const SERVICE_TITLE_BY_KIND = {
  resume_optimize: 'AI 简历优化',
  mock_interview: 'AI 模拟面试',
};

const VPAY_UNAVAILABLE_CODES = [
  'VPAY_DISABLED',
  'VPAY_GOODS_UNCONFIGURED',
  'VPAY_CONFIG_MISSING',
  'VPAY_SANDBOX_FORBIDDEN',
];

const VPAY_COPY = {
  pageTitle: '一体机服务次数',
  subtitle: '查看已购可用次数，按需单次购买',
  usageNotice: '在收费的职易达一体机上登录同一账号，进入对应服务时可直接使用，不用再次扫码付款。',
  sectionCredits: '当前可用次数',
  sectionBuy: '单次购买',
  sectionRecords: '可用次数明细',
  buyButton: '购买 1 次',
  buyingButton: '处理中…',
  unavailableTitle: '暂未开放手机端购买',
  unavailableNotice: '当前暂未开放手机端购买，请在一体机现场按屏上提示使用',
  unsupportedClientTitle: '微信版本暂不支持',
  unsupportedClientNotice: '当前微信版本过低，暂不支持小程序内虚拟支付，请升级微信到最新版本后再试。',
  confirmingNotice: '支付结果确认中，正在向服务端核对到账情况…',
  confirmDoneNotice: '已确认到账，可用服务次数已更新。',
  confirmPendingNotice: '已收到支付完成通知，到账确认可能有短暂延迟。请稍后下拉刷新查看最新可用次数。',
  emptyCreditsTitle: '暂无已购可用次数',
  emptyCreditsDesc: '当前账号下还没有待使用的一体机 AI 服务次数。',
  loginTitle: '请先登录小程序',
  loginDesc: '登录后可查看本人已购的一体机 AI 服务次数',
  switchedTitle: '账号已切换',
  switchedDesc: '当前账号已变更，已清空原账号的服务次数展示，请重新查看。',
  signedOutDesc: '登录已失效，请重新登录后查看服务次数。',
  loadError: '服务次数加载失败，请稍后重试',
  buyError: '暂时无法发起购买，请稍后重试',
  buyFooterNote: '单次购买由小程序内微信虚拟支付完成，实际到账以服务端核对结果为准。',
  accountUnavailable: '当前账号暂不可用，请确认账号状态后再试',
};

function isSupportedServiceKind(kind) {
  return kind === 'resume_optimize' || kind === 'mock_interview';
}

function isVpayUnavailableCode(code) {
  return typeof code === 'string' && VPAY_UNAVAILABLE_CODES.indexOf(code) >= 0;
}

function formatDateTimeLocal(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function summarizeCredits(raw) {
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw && raw.items) ? raw.items : []);
  const counts = { resume_optimize: 0, mock_interview: 0 };
  const records = [];
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    if (!row || typeof row !== 'object') continue;
    const kind = String(row.serviceKind || '');
    if (Object.prototype.hasOwnProperty.call(counts, kind)) {
      counts[kind] += 1;
    }
    records.push({
      id: `${kind || 'credit'}-${row.createdAt || i}-${i}`,
      serviceKind: kind,
      title: SERVICE_TITLE_BY_KIND[kind] || 'AI 服务',
      createdAtText: formatDateTimeLocal(row.createdAt),
    });
  }
  const summary = SERVICE_CATALOG.map((item) => ({
    kind: item.kind,
    title: item.title,
    count: counts[item.kind] || 0,
  }));
  return {
    total: records.length,
    counts,
    summary,
    records,
  };
}

function supportsVirtualPayment(wxObj) {
  return !!(wxObj && typeof wxObj.requestVirtualPayment === 'function');
}

/**
 * 校验并提取 wx.requestVirtualPayment 参数。
 * 严禁对 signData 做 JSON.parse / JSON.stringify，必须保持服务端下发的原始字节串。
 */
function buildVirtualPaymentOptions(orderRes) {
  if (!orderRes || typeof orderRes !== 'object') {
    const e = new Error(VPAY_COPY.buyError);
    e.code = 'VPAY_ORDER_INVALID';
    throw e;
  }
  const { signData, paySig, signature } = orderRes;
  const mode = orderRes.mode || VIRTUAL_PAY_MODE;
  if (typeof signData !== 'string' || !signData || typeof paySig !== 'string' || !paySig || typeof signature !== 'string' || !signature) {
    const e = new Error(VPAY_COPY.buyError);
    e.code = 'VPAY_ORDER_INVALID';
    throw e;
  }
  if (mode !== VIRTUAL_PAY_MODE) {
    const e = new Error(VPAY_COPY.buyError);
    e.code = 'VPAY_MODE_INVALID';
    throw e;
  }
  return {
    signData,
    paySig,
    signature,
    mode: VIRTUAL_PAY_MODE,
  };
}

function parseWxErrCode(err) {
  if (!err || typeof err !== 'object') return null;
  if (typeof err.errCode === 'number' && Number.isFinite(err.errCode)) return err.errCode;
  if (typeof err.errno === 'number' && Number.isFinite(err.errno)) return err.errno;
  if (typeof err.errMsg === 'string') {
    const m = err.errMsg.match(/(-15\d{3}|-2)\b/);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * 将 wx.requestVirtualPayment fail 回调映射为面向用户的安全中文提示，不暴露内部码或原始栈。
 */
function classifyVirtualPayFail(err) {
  const errCode = parseWxErrCode(err);
  const errMsg = (err && typeof err.errMsg === 'string') ? err.errMsg : '';
  if (errCode === -2 || /cancel/i.test(errMsg)) {
    return { outcome: 'cancelled', message: '你已取消本次支付' };
  }
  if (errCode === -15002 || errCode === -15012) {
    return { outcome: 'retry_reorder', message: '本次支付单已失效，请重新发起购买' };
  }
  if (errCode === -15007) {
    return { outcome: 'retry_session', message: '微信登录态已过期，请再试一次' };
  }
  if (errCode === -15020 || errCode === -15021) {
    return { outcome: 'rate_limited', message: '操作太频繁了，请稍后再试' };
  }
  if (errCode === -15008 || errCode === -15009 || errCode === -15010 || errCode === -15011 || errCode === -15014 || errCode === -15018) {
    return { outcome: 'unavailable', message: VPAY_COPY.unavailableNotice };
  }
  return { outcome: 'failed', message: '支付未完成，请稍后重试' };
}

function describeVpayError(err, fallback) {
  const code = err && err.code;
  if (isVpayUnavailableCode(code)) return VPAY_COPY.unavailableNotice;
  if (code === 'ACCOUNT_UNAVAILABLE') return userMessageOf(err, VPAY_COPY.accountUnavailable);
  return userMessageOf(err, fallback || VPAY_COPY.buyError);
}

function requestFreshWxLoginCode(wxObj) {
  return new Promise((resolve, reject) => {
    if (!wxObj || typeof wxObj.login !== 'function') {
      const e = new Error('当前环境无法获取微信登录凭证');
      e.code = 'WX_LOGIN_FAILED';
      reject(e);
      return;
    }
    wxObj.login({
      success(res) {
        if (res && typeof res.code === 'string' && res.code.trim()) {
          resolve(res.code);
        } else {
          const e = new Error('获取微信登录凭证失败，请稍后重试');
          e.code = 'WX_LOGIN_FAILED';
          reject(e);
        }
      },
      fail() {
        const e = new Error('获取微信登录凭证失败，请稍后重试');
        e.code = 'WX_LOGIN_FAILED';
        reject(e);
      },
    });
  });
}

/**
 * 回调方式调起 wx.requestVirtualPayment（p2d-verified.md §1.21 不支持 Promise）。
 */
function invokeVirtualPayment(wxObj, payOpts) {
  return new Promise((resolve, reject) => {
    wxObj.requestVirtualPayment({
      signData: payOpts.signData,
      paySig: payOpts.paySig,
      signature: payOpts.signature,
      mode: payOpts.mode,
      success(res) { resolve(res || {}); },
      fail(err) { reject(err || {}); },
    });
  });
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 完整单次购买流程：
 *   1. 检查基础库支持 wx.requestVirtualPayment；
 *   2. 每次重新调用 wx.login 取新 code；
 *   3. 下单取 signData / paySig / signature / mode；
 *   4. 原样透传 signData 字符串、回调方式调用 wx.requestVirtualPayment；
 *   5. 回调 success 后绝不伪造本地权益，而是轮询 GET /member/service-credits 最多 5 次确认。
 */
async function buyServiceCredit(options = {}) {
  const {
    serviceKind,
    baselineCounts = {},
    wxObj,
    api,
    isStale = () => false,
    onStatus = () => {},
    sleep = defaultSleep,
    maxPolls = DEFAULT_MAX_CONFIRM_POLLS,
    pollIntervalMs = DEFAULT_CONFIRM_POLL_INTERVAL_MS,
  } = options;

  if (!isSupportedServiceKind(serviceKind)) {
    return { status: 'error', code: 'VPAY_SERVICE_KIND_INVALID', message: '仅支持购买 AI 简历优化或 AI 模拟面试单次服务' };
  }
  if (!supportsVirtualPayment(wxObj)) {
    return { status: 'unsupported', code: 'VPAY_CLIENT_UNSUPPORTED', message: VPAY_COPY.unsupportedClientNotice };
  }
  if (isStale()) return { status: 'stale' };

  let code;
  try {
    code = await requestFreshWxLoginCode(wxObj);
  } catch (err) {
    if (isStale()) return { status: 'stale' };
    return { status: 'error', code: err && err.code, message: describeVpayError(err, '获取微信登录凭证失败，请稍后重试') };
  }
  if (isStale()) return { status: 'stale' };

  let orderRes;
  try {
    orderRes = await api.createVirtualPayOrder({ serviceKind, code });
  } catch (err) {
    if (isStale()) return { status: 'stale' };
    if (isVpayUnavailableCode(err && err.code)) {
      return { status: 'unavailable', code: err.code, message: VPAY_COPY.unavailableNotice };
    }
    return { status: 'error', code: err && err.code, message: describeVpayError(err, VPAY_COPY.buyError) };
  }
  if (isStale()) return { status: 'stale' };

  let payOpts;
  try {
    payOpts = buildVirtualPaymentOptions(orderRes);
  } catch (err) {
    return { status: 'error', code: err && err.code, message: VPAY_COPY.buyError };
  }

  try {
    await invokeVirtualPayment(wxObj, payOpts);
  } catch (err) {
    if (isStale()) return { status: 'stale' };
    const classified = classifyVirtualPayFail(err);
    if (classified.outcome === 'cancelled') return { status: 'cancelled', message: classified.message };
    if (classified.outcome === 'unavailable') return { status: 'unavailable', message: classified.message };
    return { status: 'failed', outcome: classified.outcome, message: classified.message };
  }
  if (isStale()) return { status: 'stale' };

  onStatus({ phase: 'confirming', message: VPAY_COPY.confirmingNotice });
  const baseCount = Number(baselineCounts[serviceKind]) || 0;
  let lastCredits = null;
  const totalAttempts = Math.max(1, Number(maxPolls) || DEFAULT_MAX_CONFIRM_POLLS);

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    if (isStale()) return { status: 'stale' };
    try {
      const fresh = await api.listServiceCredits();
      if (isStale()) return { status: 'stale' };
      lastCredits = summarizeCredits(fresh);
      if ((lastCredits.counts[serviceKind] || 0) > baseCount) {
        return {
          status: 'confirmed',
          credits: lastCredits,
          attempts: attempt,
          message: VPAY_COPY.confirmDoneNotice,
        };
      }
    } catch (_) {
      if (isStale()) return { status: 'stale' };
    }
    if (attempt < totalAttempts) {
      await sleep(pollIntervalMs);
      if (isStale()) return { status: 'stale' };
    }
  }

  return {
    status: 'pending_confirm',
    credits: lastCredits,
    attempts: totalAttempts,
    message: VPAY_COPY.confirmPendingNotice,
  };
}

module.exports = {
  VIRTUAL_PAY_MODE,
  DEFAULT_MAX_CONFIRM_POLLS,
  DEFAULT_CONFIRM_POLL_INTERVAL_MS,
  SERVICE_CATALOG,
  SERVICE_TITLE_BY_KIND,
  VPAY_UNAVAILABLE_CODES,
  VPAY_COPY,
  isSupportedServiceKind,
  isVpayUnavailableCode,
  summarizeCredits,
  supportsVirtualPayment,
  buildVirtualPaymentOptions,
  classifyVirtualPayFail,
  describeVpayError,
  requestFreshWxLoginCode,
  invokeVirtualPayment,
  buyServiceCredit,
};
