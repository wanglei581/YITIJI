// utils/user-error.js
// 「给用户看的错误文案」在小程序侧的唯一收敛点。
//
// 起因（2026-09-08 走查实测）：服务端 `error.message` 在设计上就**不是**面向用户的
// —— `services/api/src/common/filters/http-exception.filter.ts` 对人类可读原文一律
// 折叠成「服务器内部错误」以防泄漏内部细节，对机器码则把 code 原样填进 message
// （该行为被 `verify:http-exception-filter` 钉死，是有意为之，不应改服务端）。
//
// 但小程序 `utils/request.js` 此前把 `body.error.message` 直接当作 `err.message`
// 抛给页面，而页面普遍写成：
//
//     wx.showToast({ title: (err && err.message) || '中文兜底句' })
//
// 由于机器码是**非空字符串**，`||` 右侧那句准备好的中文一次都执行不到，求职者
// 会在手机上看到 `PRICE_CONFIG_UNAVAILABLE` 这样的技术串。实测复现：
// 服务端返回 code=message=PRICE_CONFIG_UNAVAILABLE 时，toast 标题即该机器码。
//
// 一体机侧同型问题已于 2026-08-19 由 `apps/kiosk/src/services/api/userErrorMessage.ts`
// 收敛，本模块沿用它那套判据，不另造一套：
//
//   1. 判据是**错误码白名单**，不是「message 里有没有汉字」。
//      后者已被证伪——服务端存在「服务器缺少可用中文字体，请配置 …_FONT_PATH」
//      这类中文但面向运维的文案，含中文不等于面向用户。
//   2. 未登记的错误码一律回退到**调用方兜底句**，对披露 fail-closed。
//   3. 已知代价如实记录：服务端个别有价值的中文提示会被替换成页面兜底句，
//      回收方式是把对应错误码逐个登记进下面的白名单。

/** 服务端机器错误码形如 PRICE_CONFIG_UNAVAILABLE / ORDER_NOT_FOUND。 */
function isMachineErrorCode(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]+$/.test(value);
}

/**
 * 服务端过滤器对「人类可读原文」的统一折叠结果。它表示「服务端不打算把这句
 * 原文给出去」，因此同样不能当用户文案——即便它是中文。
 */
const SERVER_GENERIC_MESSAGE = '服务器内部错误';

/**
 * 跨页面通用的技术性失败：这些码与「用户此刻在做什么」无关，可以给统一文案。
 * 与具体业务有关的失败一律留给调用方兜底句——那里才知道用户是在导出还是在下单。
 */
const SHARED_USER_MESSAGES = {
  NETWORK_ERROR: '网络连接失败，请检查网络后重试',
  RATE_LIMITED: '尝试过于频繁，请稍后再试',
  FILE_TOO_LARGE: '文件过大，请压缩后重试',
  MEMBER_MISSING_TOKEN: '登录已失效，请重新登录',
  MEMBER_SESSION_EXPIRED: '登录已失效，请重新登录',
  AUTH_REQUIRED: '请先登录后再操作',
  VALIDATION_FAILED: '提交内容有误，请检查后重试',

  // ── AI 使用门禁与合规（服务端 ai-access.service.ts、llm-guard.ts、legal-docs-published-guard.ts）──
  // 这几句不透传服务端原话：LEGAL_DOCS_NOT_PUBLISHED 服务端写的是「请联系现场工作人员」，
  // 那是对一体机说的，手机上没有现场工作人员；其余几句服务端是短句，这里补上下一步。
  AI_LOGIN_REQUIRED: '用 AI 之前需要先用手机号登录',
  AI_DECLARATION_REQUIRED: '年龄或录音确认没有记上，请稍后再试',
  AI_BUDGET_EXHAUSTED: '今天的 AI 额度已用完，明天恢复；这一步可以先用模板手动填写，打印照常可用',
  AI_BUDGET_UNAVAILABLE: 'AI 暂时用不了，请稍后再试；这一步可以先手动填写，打印照常可用',
  AI_PAUSED: 'AI 服务暂停中，打印等其他功能照常可以用',
  // 后端 9/29 交付：生产缺 AI 配置时 AI 路由 503；换绑手机号时没能先清掉旧登录 503（手机号没改）。
  AI_PROVIDER_NOT_CONFIGURED: 'AI 服务暂未开通，本次没有生成结果；打印等其他功能照常',
  REBIND_UNAVAILABLE: '暂时无法换绑，手机号没有改动，请稍后重试',
  MAINTENANCE_MODE: '系统维护中，请稍后再来',
  AI_CONTENT_BLOCKED: 'AI 不能处理这段内容，请换个说法或修改后再试',
  LEGAL_DOCS_NOT_PUBLISHED: '服务协议还没有正式发布，暂时不能登录',
  // 小程序自己的两句（utils/ai-access.js 在用户选「未满」或「改用手打」时抛出）。
  AI_AGE_NOT_DECLARED: '未满 14 周岁需要监护人同意后才能使用，小程序暂时办不了',
  AI_VOICE_NOT_CONSENTED: '没有同意录音，这一步请改用文字输入',
  AI_RESUME_NOT_CONSENTED: '没有同意使用简历 AI，内容没有发给 AI。想用时再点一次，同意后继续',
  USER_AI_CONSENT_REQUIRED: '需要先确认 AI 使用授权，才能继续',
};

/**
 * 允许原样透传服务端文案的错误码。
 *
 * 登记标准（逐条核对过服务端源码里的实际文案，不是按码名猜的）：服务端为该码写的
 * 就是面向求职者的中文，且比页面兜底句更有信息量——例如「验证码发送过于频繁,请
 * 60 秒后再试」带着用户需要的等待秒数，页面兜底句给不出。
 *
 * 不在此表的码一律回退页面兜底句。新增前必须实际读一遍服务端那句文案，确认它不是
 * 写给运维看的（反例：「服务器缺少可用中文字体，请配置 …_FONT_PATH」——中文，但
 * 面向运维）。
 */
const PASSTHROUGH_MESSAGE_CODES = [
  'PRINT_TERMINAL_OFFLINE',      // 目标终端当前离线，请稍后重试
  'PRINT_TERMINAL_NOT_ACTIVE',   // 目标终端当前不接收打印订单
  'PRINT_ORDER_NOT_CANCELLABLE', // 订单当前状态不能取消
  'PICKUP_CODE_EXPIRED',         // 到机码已过期，请在小程序重新下单
  'PRINT_JOB_TOO_LARGE',         // 每单最多打印 100 面，请分几单打印（#1146；此前落到兜底「无法核定页数和金额」）
  'PRINT_TERMINAL_QUEUE_HALTED', // 这台终端暂停接打印单，暂不能下单，请稍后再试或换一台终端（#1150；老码 PRINTER_UNAVAILABLE 仍不放行）

  // ── 登录 / 认证链路 ────────────────────────────────────────────────
  // 2026-09-08 回归修复：本模块首版把这些码一并挡在 fail-closed 之外，
  // 结果**登录彻底说不清为什么失败**。最严重的是 LEGAL_VERSION_STALE ——
  // 服务端说「协议版本已更新，请重新阅读并勾选后再登录」，用户只看到页面兜底的
  // 「登录失败，请重试」，于是一直重试一直失败，永远不知道要重新勾协议。
  // request.js 里 401 分支的注释当初就写明了这一点：
  //   「401 不都是同一回事：MEMBER_LEGAL_VERSION_STALE 要告诉用户……
  //     丢掉响应体，这道合规闸门的告知意图就永远到不了用户面前」
  // 首版没读到那段注释就收紧了判据。**登录失败必须说得出原因**，否则用户
  // 没有任何可执行的下一步。以下每条都逐字核对过服务端源码里的实际文案。
  'LEGAL_VERSION_STALE',         // 协议版本已更新，请重新阅读并勾选后再登录
  'SMS_CODE_INVALID',            // 验证码不正确，请重新输入
  'SMS_TOO_FREQUENT',            // 验证码发送过于频繁,请 60 秒后再试
  'SMS_SEND_FAILED',             // 短信发送失败，请稍后再试
  // 发送量限制（走查 9/29：此前不在放行表，一律显示成笼统的「发送失败」，用户不知道要等多久）
  'SMS_IP_LIMIT',                // 当前网络请求过于频繁,请稍后再试
  'SMS_DAILY_LIMIT',             // 今日验证码请求次数过多,请明天再试
  'SMS_DEVICE_LIMIT',            // 当前设备请求过于频繁,请稍后再试
  'SMS_DAILY_TOTAL_LIMIT',       // 今天的短信验证码发送量已达上限，请明天再试
  'SMS_TERMINAL_DAILY_LIMIT',    // 这台机器今天发出的短信验证码已达上限，请明天再试
  'SMS_BUDGET_UNAVAILABLE',      // 短信发送量暂时无法核对……先暂停发送，请稍后再试
  'WX_CONFIG_MISSING',           // 微信小程序登录暂不可用，请使用短信验证码登录
  'WX_CODE_INVALID',             // 微信登录凭证无效或已过期，请重试
  'WX_CODE2SESSION_FAILED',      // 微信登录服务异常，请稍后再试
  'WX_TOKEN_FAILED',             // 微信服务暂不可用，请稍后再试
  'WX_PHONE_FAILED',             // 无法获取手机号，请使用短信验证码登录
  'WX_PHONE_INVALID',            // 无法获取手机号，请使用短信验证码登录
  'MEMBER_SESSION_EXPIRED',      // 会话已失效,请重新登录（同时在 SHARED 里有统一文案）
  'PHONE_ALREADY_BOUND',         // 该手机号已绑定其他账号
  'PHONE_CONFLICT',              // 该手机号已绑定其他账号，无法换绑
  'PHONE_NOT_BOUND',             // 当前账号未绑定登录手机号
  'PHONE_BIND_TICKET_INVALID',   // 绑定请求已失效，请重新获取验证码
  'PHONE_BIND_CONFLICT',         // 账号手机号状态已变化，请重新登录后再试
  'PHONE_SELF_ALREADY_BOUND',    // 当前账号已绑定手机号，请刷新页面确认状态

  // 扫码登录一体机：这些码直接对应用户眼前那台机器的状态，
  // 换成页面兜底句会让人不知道是码过期了、被别人扫了、还是扫错了机器。
  'QR_LOGIN_NOT_FOUND',          // 扫码登录已过期或不存在
  'QR_LOGIN_ALREADY_CLAIMED',    // 扫码登录已被领取
  'QR_LOGIN_ALREADY_CONFIRMED',  // 扫码登录已确认
  'QR_LOGIN_TICKET_INVALID',     // 扫码登录票据格式无效
  'QR_LOGIN_CLAIM_INVALID',      // 扫码登录凭证无效
  'QR_LOGIN_TERMINAL_MISMATCH',  // 扫码登录终端不匹配
  'QR_LOGIN_NOT_CONFIRMED',      // 扫码登录尚未确认

  // 数据导出与账号注销（隐私与数据页）：这些码说的就是用户眼前这一步为什么没成，
  // 原话由后端窗口 2026-10-04 逐句给出（member-privacy、member-step-up）。
  'STEP_UP_TOKEN_INVALID',           // 二次验证凭证无效或已过期
  'ACCOUNT_UNAVAILABLE',             // 账号当前不可用
  'DATA_REQUEST_INVALID_TRANSITION', // 只能撤回尚未执行的注销申请 / 申请状态已变化
  'DATA_REQUEST_NOT_FOUND',          // 数据请求不存在
];

/**
 * 判断服务端下发的 message 是否可以直接展示给用户。
 * fail-closed：机器码、通用折叠句、空值一律不可展示。
 */
function displayableServerMessage(message, code) {
  if (typeof message !== 'string') return '';
  const text = message.trim();
  if (!text) return '';
  if (isMachineErrorCode(text)) return '';
  if (text === SERVER_GENERIC_MESSAGE) return '';
  if (code && PASSTHROUGH_MESSAGE_CODES.indexOf(code) >= 0) return text;
  return '';
}

/**
 * 页面取用户文案的入口。
 *
 * @param {*} err 被 reject 的错误对象（带 code / message / statusCode）
 * @param {string} fallback 与当前操作相关的中文句子。未知错误码一律落到它，
 *                          所以它必须写成「导出失败，请稍后重试」这种具体句子，
 *                          而不是「操作失败」。
 * @returns {string}
 */
function userMessageOf(err, fallback) {
  const code = err && err.code;
  if (code && Object.prototype.hasOwnProperty.call(SHARED_USER_MESSAGES, code)) {
    return SHARED_USER_MESSAGES[code];
  }
  const passthrough = displayableServerMessage(err && err.message, code);
  if (passthrough) return passthrough;
  if (err && err.statusCode === 429) return SHARED_USER_MESSAGES.RATE_LIMITED;
  if (err && err.statusCode === -1) return SHARED_USER_MESSAGES.NETWORK_ERROR;
  return fallback;
}

/** 模拟面试、小青没有「先用模板手动填写」这条退路，额度两码只说事实（走查 MP-K18-6）。 */
const AI_QUOTA_PLAIN_MESSAGES = {
  AI_BUDGET_EXHAUSTED: '今天的 AI 次数用完了，明天恢复。',
  AI_BUDGET_UNAVAILABLE: 'AI 暂时用不了，请稍后再试。',
};

/** 同 userMessageOf，只是额度两码换成不提模板的说法。 */
function plainAiMessageOf(err, fallback) {
  const code = err && err.code;
  if (code && Object.prototype.hasOwnProperty.call(AI_QUOTA_PLAIN_MESSAGES, code)) return AI_QUOTA_PLAIN_MESSAGES[code];
  return userMessageOf(err, fallback);
}

/**
 * 现场没有工作人员（2026-10-04 产品负责人：全程自助、自动）。需要人帮忙时只有一条出路：服务电话。
 * 号码从后端公开接口读（GET /api/v1/public/support-contact?terminalId=）；读不到时用这一句，不写死。
 */
const SUPPORT_HINT = '需要帮助可拨打服务电话，号码在首页底部「经营者信息」里。'

module.exports = {
  isMachineErrorCode,
  SUPPORT_HINT,
  displayableServerMessage,
  userMessageOf,
  plainAiMessageOf,
  AI_QUOTA_PLAIN_MESSAGES,
  SERVER_GENERIC_MESSAGE,
  SHARED_USER_MESSAGES,
  PASSTHROUGH_MESSAGE_CODES,
};
