// utils/request.js
// 统一网络请求封装:Promise 化、自动附带 token、统一错误处理、超时。
// 真实请求走 wx.request;是否走真实请求由 api 层根据 config.USE_MOCK 决定。

const config = require('./config');
const auth = require('./auth');

/**
 * 底层请求。仅在 config.USE_MOCK=false 时被 api 层调用。
 * @param {string} path 形如 '/jobs' 或 '/jobs/j1',会自动拼 apiPrefix
 * @param {object} options { method, data, header, needAuth, timeout }
 * @returns {Promise<any>} resolve 业务 data;reject Error(带 statusCode/code)
 */
/**
 * 401 静默补签。
 *
 * 背景:enduser JWT 只有 30 分钟(member-print-orders.module.ts 签发 expiresIn:'30m'),
 * 且服务端全仓没有 refresh 机制。用户中午下单、下午走到一体机前打开取件页,
 * 必然已经掉线 → 取件页 401 进错误态。取件是这条业务链最关键的一刻。
 *
 * 为什么不能用 wx-login 补签:该端点要求 phoneCode,而 phoneCode 只能由用户
 * 亲手点 open-type="getPhoneNumber" 按钮产生,拦到 401 时无法静默取得。
 * 因此走 /member/auth/wx-resignin —— 只凭 wx.login 的 code 换 openid,
 * 为已绑定手机号的存量账号重签,全程无感、不建号、不削弱鉴权。
 */
let resigninInflight = null;

function silentResignin() {
  // single-flight:并发 401 只触发一次 wx.login。
  // 微信的 code 是一次性的,并发换取会互相作废。
  if (resigninInflight) return resigninInflight;

  const done = () => { resigninInflight = null; };
  resigninInflight = new Promise((resolve, reject) => {
    wx.login({
      success: (r) => (r && r.code ? resolve(r.code) : reject(makeError('wx.login 未返回 code', -1))),
      fail: () => reject(makeError('wx.login 调用失败', -1)),
    });
  })
    .then((code) => rawRequest('/member/auth/wx-resignin', {
      method: 'POST',
      data: { code },
      needAuth: false,
    }))
    .then((res) => {
      const token = res && res.token;
      if (!token) throw makeError('续签未返回 token', -1);
      auth.saveSession({ token, user: res.user });
      done();
      return token;
    })
    .catch((e) => { done(); throw e; });

  return resigninInflight;
}

/**
 * 对外请求入口:在 rawRequest 之上加一层 401 静默补签重试。
 * 只重试一次;补签失败则清理本地会话并抛出原始 401,让页面走登录引导。
 */
function request(path, options = {}) {
  return rawRequest(path, options).catch((err) => {
    // 准入依据是「曾登录过且未主动登出」，不是「当前有没有 token」。
    // 后者会二选一地出错：getToken() 在 JWT 过期时先 clearSession
    // 再返回 null，使「自然过期」与「主动登出」完全同形——
    // 用 token 判断要么让过期补不了签（原始 401 问题原样存在），
    // 要么让登出的用户被自动登回（共用设备隐私问题）。
    const retriable = err && err.statusCode === 401
      && options.needAuth !== false
      && !options._retried
      && auth.canSilentResignin();
    if (!retriable) throw err;

    return silentResignin().then(
      () => rawRequest(path, Object.assign({}, options, { _retried: true })),
      () => { auth.logout(); throw err; },
    );
  });
}

function rawRequest(path, options = {}) {
  const { method = 'GET', data = {}, header = {}, needAuth = true, timeout } = options;

  const finalHeader = { 'content-type': 'application/json', ...header };
  if (needAuth) {
    const token = auth.getToken();
    if (token) finalHeader.Authorization = `Bearer ${token}`;
  }

  const url = `${config.baseUrl}${config.apiPrefix}${path}`;

  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      data,
      header: finalHeader,
      timeout: timeout || config.timeout,
      success(res) {
        const { statusCode } = res;
        const body = res.data;

        if (statusCode >= 200 && statusCode < 300) {
          // 显式失败标记优先(success:false / code 非成功值)
          if (body && typeof body === 'object') {
            if ('success' in body && body.success === false) {
              reject(extractError(body, statusCode));
              return;
            }
            if ('code' in body && body.code !== 0 && body.code !== 200) {
              reject(makeError(body.message || '请求失败', statusCode, body.code));
              return;
            }
          }
          resolve(unwrapEnvelope(body));
        } else if (statusCode === 401) {
          // 不在此处清会话:外层 request() 会先尝试静默补签,
          // 补签失败才清。否则一次可恢复的过期会把用户直接踢下线。
          reject(makeError('登录已失效,请重新登录', 401));
        } else {
          reject(extractError(body, statusCode));
        }
      },
      fail(err) {
        reject(makeError(err.errMsg || '网络连接失败,请稍后重试', -1));
      },
    });
  });
}

/**
 * 解包后端信封。本项目后端实际存在多种形态(已实测):
 *   /jobs、/job-fairs        → { data, pagination }
 *   /companies               → { data, success }
 *   /policies                → { data }
 *   /kiosk/legal/*           → { success, data }
 *   /files/kiosk-upload      → { success, data }
 *   /resume/parse            → **裸响应**,顶层直接是 { taskId, status, report, ... }
 *   /resume/records/:taskId  → **裸响应**,同上
 * 统一口径:出现 data 键就取 data;若同时有 pagination 且 data 是数组,
 * 把 pagination 挂到数组的 .pagination 上,避免分页元数据在解包时丢失。
 * 裸响应没有 data 键,会原样透传(下面第一个 return),不需要额外分支。
 * 注意:失败体仍是 { success:false, error:{...} } 包装形态,由 extractError 处理。
 */
function unwrapEnvelope(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  if (!('data' in body)) return body;

  const inner = body.data;
  if (Array.isArray(inner) && body.pagination) {
    try {
      inner.pagination = body.pagination;
    } catch (_) {
      // 数组被冻结等极端情况:忽略,调用方仍拿到列表本体
    }
  }
  return inner;
}

/**
 * 文件上传。wx.request 不能传文件,必须走 wx.uploadFile,差异有三处:
 *   1. 请求体是 multipart,文件字段名由 name 指定(后端 kiosk-upload 用 'file')
 *   2. 附加字段走 formData,且值只能是 string(后端 purpose 走这里)
 *   3. res.data 是**字符串**,不会自动 JSON.parse,必须手动解析
 * @param {string} path 形如 '/files/kiosk-upload'
 * @param {string} filePath 本地临时文件路径(wx.chooseMessageFile 等给出)
 * @param {object} options { name, formData, header, needAuth }
 * @returns {Promise<any>} resolve 解包后的业务 data;reject Error(带 statusCode/code)
 */
function uploadFile(path, filePath, options = {}) {
  const { name = 'file', formData = {}, header = {}, needAuth = true } = options;

  const finalHeader = { ...header };
  if (needAuth) {
    const token = auth.getToken();
    if (token) finalHeader.Authorization = `Bearer ${token}`;
  }

  const url = `${config.baseUrl}${config.apiPrefix}${path}`;

  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url,
      filePath,
      name,
      formData,
      header: finalHeader,
      timeout: config.uploadTimeout || config.timeout,
      success(res) {
        const { statusCode } = res;

        let body = res.data;
        if (typeof body === 'string') {
          try {
            body = JSON.parse(body);
          } catch (_) {
            // 网关返回 HTML 错误页等情况:保留原文用于判断,不当成业务数据
            reject(makeError(`上传响应无法解析(${statusCode})`, statusCode));
            return;
          }
        }

        if (statusCode >= 200 && statusCode < 300) {
          if (body && typeof body === 'object' && body.success === false) {
            reject(extractError(body, statusCode));
            return;
          }
          resolve(unwrapEnvelope(body));
        } else if (statusCode === 401) {
          // 与 rawRequest 一致：不在此清会话。上传是合同审查等流程的
          // 第一个鉴权调用，过期即清会话会让用户「上传失败还被登出」。
          reject(makeError('登录已失效,请重新登录', 401));
        } else {
          reject(extractError(body, statusCode));
        }
      },
      fail(err) {
        reject(makeError(err.errMsg || '文件上传失败,请检查网络后重试', -1));
      },
    });
  });
}

function makeError(message, statusCode, code) {
  const e = new Error(message);
  e.statusCode = statusCode;
  if (code !== undefined) e.code = code;
  return e;
}

/**
 * 后端错误体形如 { error: { code, message } }(NestJS HttpException 约定),
 * 校验失败也可能是 { message: [...] }。抽出可展示文案与业务错误码。
 */
function extractError(body, statusCode) {
  if (body && typeof body === 'object') {
    if (body.error && typeof body.error === 'object') {
      return makeError(body.error.message || `服务异常(${statusCode})`, statusCode, body.error.code);
    }
    if (Array.isArray(body.message)) {
      return makeError(body.message[0] || `服务异常(${statusCode})`, statusCode);
    }
    if (typeof body.message === 'string' && body.message) {
      return makeError(body.message, statusCode);
    }
  }
  return makeError(`服务异常(${statusCode})`, statusCode);
}

module.exports = { request, uploadFile };
