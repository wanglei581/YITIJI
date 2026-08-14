// utils/api.js
// 业务 API 门面。页面统一通过此层取数,不直接调 wx.request。
// USE_MOCK=true → 返回本地 mock(带模拟延迟);false → 走真实 request(baseUrl+apiPrefix)。
// 切换后端时:只改 utils/config.js 的 baseUrl / USE_MOCK,页面代码零改动。

const config = require('./config');
const { request, uploadFile } = require('./request');
const mock = require('./mock-data');
const N = require('./normalize');

/**
 * 对列表逐项做字段适配,并保留挂在数组上的分页元数据。
 * 直接 list.map() 会丢掉 .pagination / .nextCursor / .total。
 */
function adaptList(p, fn) {
  return p.then(list => {
    if (!Array.isArray(list)) return [];
    const out = list.map(fn);
    try {
      if (list.pagination) out.pagination = list.pagination;
      if (list.nextCursor !== undefined) out.nextCursor = list.nextCursor;
      if (list.total !== undefined) out.total = list.total;
    } catch (_) {}
    return out;
  });
}

/**
 * 归一化列表结果。页面直接对返回值调 .map(),必须保证拿到数组。
 *
 * 后端各列表端点形态不统一(已对线上逐个实测):
 *   /jobs、/job-fairs → { data: [...], pagination: { page, pageSize, total, totalPages } }
 *   /policies         → { data: [...] }
 *   /companies        → { data: { items: [...], nextCursor, total }, success }   ← cursor 分页
 * request.js 的 unwrapEnvelope 已剥掉外层 data,故此处收到的是
 * 数组(前三者)或 { items, nextCursor, total }(companies)。
 *
 * 分页元数据挂到返回数组的 .pagination / .nextCursor / .total 上,
 * 页面做"加载更多"时按需读取;不需要则完全无感。
 *
 * @param {Promise} p request() 返回的 Promise
 * @returns {Promise<Array>} 恒为数组
 */
function unwrapList(p) {
  return p.then(res => {
    let list = [];
    let meta = null;

    if (Array.isArray(res)) {
      list = res;
    } else if (res && typeof res === 'object') {
      if (Array.isArray(res.items)) {
        list = res.items;
        meta = res;
      } else if (Array.isArray(res.data)) {
        list = res.data;
        meta = res;
      }
    }

    if (!Array.isArray(list)) return [];

    try {
      if (res && res.pagination) list.pagination = res.pagination;
      if (meta && meta.nextCursor !== undefined) list.nextCursor = meta.nextCursor;
      if (meta && meta.total !== undefined) list.total = meta.total;
    } catch (_) {
      // 极端情况(数组被冻结)忽略,调用方仍拿到列表本体
    }
    return list;
  });
}

// mock 模式下,包一层 Promise + 延迟,模拟真实网络时序(让 loading 态可见)
function mockResolve(value) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (value === null || value === undefined) {
        const e = new Error('未找到对应数据');
        e.statusCode = 404;
        reject(e);
      } else {
        resolve(value);
      }
    }, config.mockDelay);
  });
}

/**
 * mock 模式下 AI 类接口一律拒绝,不回落假报告。
 * 假评分/假建议看起来像"能用",但会让用户拿着不存在的结论去改简历、去打印,
 * 这比直接报错有害得多。离线调试 AI 链路请把 config.USE_MOCK 置 false。
 */
function mockUnavailable(what) {
  const e = new Error(`${what}需连接真实后端,当前为本地演示数据模式`);
  e.statusCode = 501;
  return e;
}

/** 简历类任务的匿名读取凭证 */
function tokenHeader(accessToken) {
  return accessToken ? { 'x-resume-access-token': accessToken } : {};
}

/** 面试会话的匿名凭证,与简历的是两套独立 token,不能混用 */
function interviewHeader(accessToken) {
  return accessToken ? { 'x-interview-access-token': accessToken } : {};
}

const api = {
  // ---------- 岗位 ----------
  getJobs(params = {}) {
    if (config.USE_MOCK) return mockResolve(mock.jobList());
    return adaptList(unwrapList(request('/jobs', { method: 'GET', data: params, needAuth: false })), N.job);
  },
  getJobDetail(id) {
    if (config.USE_MOCK) return mockResolve(mock.jobById(id));
    return request(`/jobs/${id}`, { method: 'GET', needAuth: false }).then(N.jobDetail);
  },

  // ---------- 招聘会 ----------
  getFairs(params = {}) {
    if (config.USE_MOCK) return mockResolve(mock.fairList());
    return adaptList(unwrapList(request('/job-fairs', { method: 'GET', data: params, needAuth: false })), N.fair);
  },
  getFairDetail(id) {
    if (config.USE_MOCK) return mockResolve(mock.fairById(id));
    return request(`/job-fairs/${id}`, { method: 'GET', needAuth: false }).then(N.fairDetail);
  },

  // ---------- 企业 ----------
  getCompanies(params = {}) {
    if (config.USE_MOCK) return mockResolve(mock.companyList());
    return adaptList(unwrapList(request('/companies', { method: 'GET', data: params, needAuth: false })), N.company);
  },
  getCompanyDetail(id) {
    if (config.USE_MOCK) return mockResolve(mock.companyById(id));
    return request(`/companies/${id}`, { method: 'GET', needAuth: false });
  },

  // ---------- 政策 ----------
  getPolicies(params = {}) {
    if (config.USE_MOCK) return mockResolve(mock.policyList());
    return adaptList(unwrapList(request('/policies', { method: 'GET', data: params, needAuth: false })), N.policy);
  },
  getPolicyDetail(id) {
    if (config.USE_MOCK) return mockResolve(mock.policyById(id));
    return request(`/policies/${id}`, { method: 'GET', needAuth: false }).then(N.policyDetail);
  },

  // ---------- 法务协议版本 ----------
  /** 读取当前激活的法务文档；没有正式激活版本时 fail-closed。 */
  getLegalDocument(docType) {
    const allowed = ['terms_of_service', 'privacy_policy'];
    if (!allowed.includes(docType)) return Promise.reject(new Error('不支持的法律文档类型'));
    if (config.USE_MOCK) return Promise.reject(new Error('演示数据模式不提供正式法律文档'));
    return request(`/kiosk/legal/${docType}`, { method: 'GET', needAuth: false }).then(doc => {
      if (!doc || !doc.version || !doc.content) {
        const e = new Error('正式法律文档尚未发布');
        e.code = 'LEGAL_DOC_UNAVAILABLE';
        throw e;
      }
      return doc;
    });
  },

  /**
   * 取当前有效协议版本。无激活版本时回落草拟哨兵,与服务端 resolveActiveLegalVersions 口径一致。
   * 注意:线上目前两份文档均无激活版本,实际会拿到 'draft-pending-legal-review'。
   */
  getLegalVersions() {
    const FALLBACK = 'draft-pending-legal-review';
    const fetchOne = (docType) =>
      request(`/kiosk/legal/${docType}`, { method: 'GET', needAuth: false })
        .then(doc => {
          const v = doc && doc.version;
          return typeof v === 'string' && v.trim() ? v.trim() : FALLBACK;
        })
        .catch(() => FALLBACK);
    return Promise.all([
      fetchOne('terms_of_service'),
      fetchOne('privacy_policy'),
    ]).then(([termsVersion, privacyVersion]) => ({ termsVersion, privacyVersion }));
  },

  // ---------- 鉴权 ----------
  // C 端会员走 /api/v1/member/* (EndUser 体系),与内部 /api/v1/auth/* (admin/partner) 完全隔离。
  // 后端已上线可用:member/auth/sms-code、member/auth/login。

  /** 发送短信验证码。deviceId 用于设备维度频控,可省略。 */
  sendOtp(phone, deviceId) {
    // 后端端点已上线;mock 模式下不伪造"已发送",如实说明是本地演示数据模式所致。
    if (config.USE_MOCK) {
      const e = new Error('当前为演示数据模式,登录需切真实后端');
      e.statusCode = 501;
      return Promise.reject(e);
    }
    const data = deviceId ? { phone, deviceId } : { phone };
    return request('/member/auth/sms-code', { method: 'POST', data, needAuth: false });
  },

  /**
   * 手机号 + 验证码登录。
   * termsVersion / privacyVersion 必填且须与服务端当前有效版本一致,否则 400 LEGAL_VERSION_STALE。
   * 这里先取版本再登录,与 Kiosk 的 fetchLegalConsentVersions 口径一致。
   */
  loginBySms(phone, code, deviceId) {
    if (config.USE_MOCK) {
      const e = new Error('当前为演示数据模式,登录需切真实后端');
      e.statusCode = 501;
      return Promise.reject(e);
    }
    return this.getLegalVersions().then(v => {
      const data = {
        phone,
        code,
        termsVersion: v.termsVersion,
        privacyVersion: v.privacyVersion,
      };
      if (deviceId) data.deviceId = deviceId;
      return request('/member/auth/login', { method: 'POST', data, needAuth: false });
    });
  },

  /** 当前登录会员(boot 时校验会话)。 */
  getMe() {
    if (config.USE_MOCK) {
      const e = new Error('当前为演示数据模式,登录需切真实后端');
      e.statusCode = 501;
      return Promise.reject(e);
    }
    return request('/member/me', { method: 'GET', needAuth: true });
  },

  logout() {
    if (config.USE_MOCK) return Promise.resolve({ loggedOut: true });
    return request('/member/auth/logout', { method: 'POST', needAuth: true });
  },

  /**
   * 读取 QR 登录票据状态与设备信息（无需登录）。
   * 用于小程序扫码后展示终端名称、确认前核验票据是否仍有效。
   * 返回 { status: 'pending'|'confirmed', deviceLabel?, returnTo, expiresInSeconds }
   */
  getQrLoginStatus(ticketId) {
    if (config.USE_MOCK) {
      const e = new Error('当前为演示数据模式，扫码登录需切真实后端');
      e.statusCode = 501;
      return Promise.reject(e);
    }
    return request(`/member/auth/qr/${encodeURIComponent(ticketId)}/status`, {
      method: 'GET',
      needAuth: false,
    });
  },

  /**
   * 小程序已登录用户扫码后凭 JWT 直接确认 Kiosk QR 票据。
   * 无需再次输入手机号或验证码；一体机侧会在下一次 poll 时感知到已确认并自动完成登录。
   * 返回 { status: 'confirmed' }
   */
  confirmQrLoginByToken(ticketId) {
    if (config.USE_MOCK) {
      const e = new Error('当前为演示数据模式，扫码登录需切真实后端');
      e.statusCode = 501;
      return Promise.reject(e);
    }
    return request(`/member/auth/qr/${encodeURIComponent(ticketId)}/confirm-by-token`, {
      method: 'POST',
      needAuth: true,
    });
  },

  /**
   * 微信小程序一键登录（getPhoneNumber 按钮授权）。
   *
   * 调用时机：用户点击 open-type="getPhoneNumber" 按钮，在组件 bindgetphonenumber
   * 事件回调里取 e.detail.code 传入此函数。
   *
   * 后端流程（全在服务端，appSecret 零前端暴露）：
   *   1. jscode2session(code)   → openid（微信身份标识）
   *   2. access_token + phoneCode → getPhoneNumber → 真实手机号
   *   3. find/create EndUser by phoneHash，写入 wxOpenId
   *   4. issueLoginForUser → { token, user }
   *
   * @param {string} phoneCode  getPhoneNumber 事件的 detail.code
   * @returns {Promise<{token, user}>}  调用方收到后负责 saveSession(result)
   */
  loginByPhone(phoneCode) {
    if (config.USE_MOCK) {
      const e = new Error('演示数据模式不支持微信登录，请切换真实后端');
      e.statusCode = 501;
      return Promise.reject(e);
    }
    // wx.login() 换 code（标识微信身份），与 getLegalVersions() 并发
    const codeP = new Promise((resolve, reject) => {
      wx.login({
        success: res => {
          if (res.code) resolve(res.code);
          else reject(new Error('wx.login 未返回 code'));
        },
        fail: err => reject(Object.assign(new Error('wx.login 调用失败'), { detail: err })),
      });
    });
    return Promise.all([codeP, this.getLegalVersions()]).then(([code, v]) => {
      return request('/member/auth/wx-login', {
        method: 'POST',
        data: {
          code,
          phoneCode,
          termsVersion: v.termsVersion,
          privacyVersion: v.privacyVersion,
        },
        needAuth: false,
      });
    });
  },

  // ---------- AI 简历诊断(已接真实后端,2026-08-01 实测通过) ----------
  /**
   * 上传简历文件。免登录可用(后端 resolveOptionalEndUser),限流 20 次 / 60s。
   * 后端会按 purpose 自行推断敏感级别,前端不得传 sensitiveLevel。
   * 返回的文件有效期约 30 分钟(fileExpiresAt),必须尽快提交解析。
   * @param {string} filePath wx.chooseMessageFile 给出的本地临时路径
   * @param {string} purpose resume_upload | resume_scan(其余场景见后端白名单)
   * @returns {Promise<{fileId,filename,sizeBytes,mimeType,sha256,signedUrl,signedUrlExpiresAt,fileExpiresAt}>}
   */
  uploadResumeFile(filePath, purpose = 'resume_upload') {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('简历上传'));
    return uploadFile('/files/kiosk-upload', filePath, {
      name: 'file',
      formData: { purpose },
      needAuth: true, // 已登录则带 token 归属到本人,未登录走匿名
    });
  },

  /** 上传本人通用打印文件；后端 print_doc 仅接受 PDF/JPG/PNG 并按真实 MIME/魔数校验。 */
  uploadPrintFile(filePath) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('打印文件上传'));
    return uploadFile('/files/kiosk-upload', filePath, {
      name: 'file',
      formData: { purpose: 'print_doc' },
      needAuth: true,
    });
  },

  /**
   * 提交 AI 解析 + 诊断。返回**裸响应**(顶层直接是 taskId/status/report)。
   * 实测线上 providerName='llm',单次耗时 20~40s,且常常同步就返回 completed。
   * 匿名调用时响应里会带 accessToken,是后续读取报告的唯一凭证,只在此处下发一次,
   * 丢了就只能重新上传重新解析(等于重复扣一次模型费用),必须先落地再渲染。
   * @param {object} p { fileId, fileName, fileFormat, source, selectedDimensions?, targetContext? }
   */
  parseResume(p) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('AI 简历诊断'));
    return request('/resume/parse', {
      method: 'POST',
      data: p,
      needAuth: true,
      timeout: config.aiTimeout,
    });
  },

  /**
   * 读取解析结果(轮询用)。返回裸响应,形态同 parseResume。
   * 匿名必须带 x-resume-access-token;缺失或错误一律 404 AI_TASK_NOT_FOUND
   * (后端刻意不区分"不存在"与"无权访问",避免探测他人任务)。
   * @param {string} taskId
   * @param {string} accessToken 匿名场景必传;已登录会员可留空
   */
  getResumeRecord(taskId, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('AI 简历诊断'));
    const header = {};
    if (accessToken) header['x-resume-access-token'] = accessToken;
    return request(`/resume/records/${taskId}`, { method: 'GET', header, needAuth: true });
  },

  // ── 以下 AI 能力都挂在解析任务 taskId 上,凭 RESUME_TASK 里的 accessToken 读取 ──

  /**
   * 简历优化。服务端先读取本人已持久化的 completed optimize 结果；命中缓存时直接返回，
   * 不再次调用模型。只有尚无成功结果但 parse 任务仍有效时才会调用 LLM。
   * 后端有防编造校验(事实串必须逐字出现在简历原文),命中即返回 status:'failed'。
   * 因此生成失败后的重试仍必须由用户主动触发，页面绝不能自动轮询。
   */
  getResumeOptimize(taskId, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('AI 简历优化'));
    return request(`/resume/records/${taskId}/optimize`, {
      method: 'GET', header: tokenHeader(accessToken), needAuth: !accessToken, timeout: config.aiTimeout,
    });
  },

  /**
   * 生成职业规划(POST 触发,同步返回)。服务端内部最多重试 2 次模型调用,
   * 所以慢的时候是两次调用叠加,页面不要写死"约 N 秒"。限流 6 次/分钟。
   *
   * 三种失败要分开处理,不能都当"网络错误":
   *   1. 200 + status:'failed' + failReason —— 简历原文已按隐私策略清理,要重新上传简历
   *   2. 503 AI_CAREER_PLAN_FAILED       —— 两次模型调用都没过校验,可手动重试
   *   3. 404 CAREER_PLAN_NOT_FOUND       —— 只会出现在 GET/print,不会出现在这里
   */
  generateCareerPlan(taskId, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('AI 职业规划'));
    return request(`/resume/career-plan/${taskId}`, {
      method: 'POST', header: tokenHeader(accessToken), needAuth: true, timeout: config.aiTimeout,
    });
  },

  /**
   * 读取已生成的职业规划(不触发新生成)。
   * 没有记录或已过 TTL 时后端 404 CAREER_PLAN_NOT_FOUND —— 这是正常空态,不是错误。
   */
  getCareerPlan(taskId, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('AI 职业规划'));
    return request(`/resume/career-plan/${taskId}`, {
      method: 'GET', header: tokenHeader(accessToken), needAuth: true,
    });
  },

  /**
   * 把已生成的规划渲染成 PDF 并入库,返回
   * { fileId, filename, sizeBytes, pageCount, signedUrl, expiresAt, printFileUrl }。
   * 服务端 purpose:'print_doc' 落 FileObject —— 也就是说这一步本身就进了「我的文档」,
   * 不需要再单独做一个"保存到我的文档"。但**生成文件不等于已打印**,页面不得声称已打印。
   * 无结果时 404 CAREER_PLAN_NOT_FOUND。
   */
  printCareerPlan(taskId, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('AI 职业规划'));
    return request(`/resume/career-plan/${taskId}/print`, {
      method: 'POST', header: tokenHeader(accessToken), needAuth: true, timeout: 60000,
    });
  },

  /**
   * 岗位匹配授权状态。匿名授权只认 x-resume-access-token,
   * 带 Bearer 会被后端 400(ANONYMOUS_CONSENT_TOKEN_REQUIRED),所以这三个
   * consent 接口一律 needAuth:false,不能顺手带上会员 token。
   */
  getJobFitConsent(taskId, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('岗位匹配参考'));
    return request(`/resume/job-fit/consent/${taskId}`, {
      method: 'GET', header: tokenHeader(accessToken), needAuth: false,
    });
  },

  /** 授予岗位匹配授权(用户明确同意用简历原文做匹配分析后才可调用) */
  grantJobFitConsent(taskId, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('岗位匹配参考'));
    return request('/resume/job-fit/consent', {
      method: 'POST', data: { taskId }, header: tokenHeader(accessToken), needAuth: false,
    });
  },

  /** 撤销岗位匹配授权 */
  revokeJobFitConsent(taskId, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('岗位匹配参考'));
    return request(`/resume/job-fit/consent/${taskId}`, {
      method: 'DELETE', header: tokenHeader(accessToken), needAuth: false,
    });
  },

  /**
   * 会员岗位 AI 授权。会员授权是账号级 job_ai scope，不得复用匿名任务 consent。
   * 页面拿到的统一 active 字段只用于展示分流，服务端仍保留原始授权版本与时间。
   */
  getMemberJobFitConsent() {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('岗位匹配参考'));
    return request('/me/ai-consents/status', { method: 'GET', needAuth: true }).then((list) => {
      const item = Array.isArray(list) ? list.find((v) => v && v.scope === 'job_ai') : null;
      return item ? { ...item, active: item.granted === true } : { scope: 'job_ai', active: false };
    });
  },

  grantMemberJobFitConsent() {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('岗位匹配参考'));
    return request('/me/ai-consents', {
      method: 'POST', data: { scope: 'job_ai' }, needAuth: true,
    }).then((item) => ({ ...item, active: !!(item && item.granted) }));
  },

  revokeMemberJobFitConsent() {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('岗位匹配参考'));
    return request('/me/ai-consents/job_ai/revoke', {
      method: 'POST', needAuth: true,
    }).then((item) => ({ ...item, active: !!(item && item.granted) }));
  },

  /**
   * 岗位匹配分析。实测 6~37s 波动很大(同一份简历两次分别 37s / 6s),
   * 页面按最坏情况提示,不要写死"约 N 秒"。
   * 未先授权会 403 JOB_FIT_ANONYMOUS_CONSENT_REQUIRED。
   * @param {object} p { taskId, jobId? , manualJob?: { title, requirements? } } jobId 与 manualJob 二选一
   */
  analyzeJobFit(p, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('岗位匹配参考'));
    return request('/resume/job-fit', {
      method: 'POST', data: p, header: tokenHeader(accessToken), needAuth: !accessToken, timeout: config.aiTimeout,
    });
  },

  /** 读取已生成的岗位匹配结果(不触发新分析) */
  getJobFit(taskId, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('岗位匹配参考'));
    return request(`/resume/job-fit/${taskId}`, {
      method: 'GET', header: tokenHeader(accessToken), needAuth: !accessToken,
    });
  },

  /**
   * 把已有的匹配结果渲染成 PDF 并入库,返回 { fileId, filename, sizeBytes, pageCount, printFileUrl }。
   * 这是真的生成文件,不是占位;但**生成文件不等于已下单打印**,页面不得声称已打印。
   * 无结果时后端 404 JOB_FIT_NOT_FOUND。
   */
  printJobFitReport(taskId, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('岗位匹配参考'));
    return request(`/resume/job-fit/${taskId}/print`, {
      method: 'POST', header: tokenHeader(accessToken), needAuth: !accessToken, timeout: 60000,
    });
  },

  // ── 模拟面试。信封是 { success, data },与上面 resume 系列的裸响应不同 ──

  /**
   * 创建面试会话。匿名时响应带 accessToken,只下发一次,是后续所有回合的凭证,
   * 必须立刻落地(同 RESUME_TASK 的道理)。
   * @param {object} p { interviewerType, industry, position, experience, difficulty, durationMin, resumeFileId?, interactionMode? }
   */
  createInterview(p) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('模拟面试'));
    return request('/mock-interviews', { method: 'POST', data: p, needAuth: true, timeout: config.aiTimeout });
  },

  /** 开始面试,返回第一题 */
  startInterview(sessionId, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('模拟面试'));
    return request(`/mock-interviews/${sessionId}/start`, {
      method: 'POST', header: interviewHeader(accessToken), needAuth: true, timeout: config.aiTimeout,
    });
  },

  /**
   * 提交本回合回答,返回**下一题**。
   * 后端不返回本题得分也不返回点评——评价只在面试结束后整体产出,
   * 所以答题页不得展示任何逐题评分。
   * @param {object} p { answer?, skip?, inputMode?, transcriptText?, transcriptEdited?, answerDurationSec? }
   */
  answerInterview(sessionId, p, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('模拟面试'));
    return request(`/mock-interviews/${sessionId}/answer`, {
      method: 'POST', data: p, header: interviewHeader(accessToken), needAuth: true, timeout: config.aiTimeout,
    });
  },

  /** 结束面试。实测 27s,直接返回完整报告(与 getInterviewReport 同形) */
  endInterview(sessionId, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('模拟面试'));
    return request(`/mock-interviews/${sessionId}/end`, {
      method: 'POST', header: interviewHeader(accessToken), needAuth: true, timeout: config.aiTimeout,
    });
  },

  /** 读取面试报告(已结束的会话,秒回) */
  getInterviewReport(sessionId, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('模拟面试'));
    return request(`/mock-interviews/${sessionId}/report`, {
      method: 'GET', header: interviewHeader(accessToken), needAuth: true,
    });
  },

  /** 会话详情(含已答回合),用于中断恢复 */
  getInterviewSession(sessionId, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('模拟面试'));
    return request(`/mock-interviews/${sessionId}`, {
      method: 'GET', header: interviewHeader(accessToken), needAuth: true,
    });
  },

  /**
   * 将面试复盘报告渲染为 PDF 并入库,返回 { fileId, filename, sizeBytes, pageCount, signedUrl }。
   * 首次调用约需数秒；已渲染则秒回。
   */
  printInterviewReport(sessionId, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('模拟面试'));
    return request(`/mock-interviews/${sessionId}/report/print`, {
      method: 'POST', header: interviewHeader(accessToken), needAuth: true, timeout: config.aiTimeout,
    });
  },

  // ---------- 我的资产 ----------

  /**
   * 本人简历列表（需登录）。返回 MemberResumeItem[] 数组，附 .total。
   * 后端: GET /api/v1/me/resumes?cursor=&pageSize=
   * 响应信封: { success, data: { items, total, nextCursor } } → unwrapList → items[]
   */
  getMyResumes(params = {}) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('我的简历'));
    return unwrapList(request('/me/resumes', { method: 'GET', data: params, needAuth: true }));
  },

  /** 本人文档元数据列表。访问文件内容时仍须通过后端短时签名端点。 */
  getMyDocuments(params = {}) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('我的文档'));
    return unwrapList(request('/me/documents', { method: 'GET', data: params, needAuth: true }));
  },

  /**
   * 本人文件的服务端精确打印报价。
   *
   * 两步都复用现有后端安全边界：
   *   1. GET /files/:id/preview-url 校验会员本人归属，并签发短时 printFileUrl；
   *   2. POST /orders/quote 由服务端识别真实页数并按 PriceConfig 计价。
   *
   * 页面不得传 pages / billablePages / amountCents，也不得把公开单价乘法当成最终报价。
   */
  quoteMyPrintOrder(fileId, params) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('打印报价'));
    const id = String(fileId || '').trim();
    if (!id) return Promise.reject(new Error('缺少打印文件'));
    return request(`/files/${encodeURIComponent(id)}/preview-url`, {
      method: 'GET',
      needAuth: true,
    }).then((access) => {
      const fileUrl = access && access.printFileUrl;
      if (!fileUrl) throw new Error('服务端未返回可打印文件凭证');
      return request('/orders/quote', {
        method: 'POST',
        data: { fileUrl, params },
        needAuth: false,
      });
    });
  },

  /** 删除本人文档：服务端校验归属，物理删除对象并保留删除审计。 */
  deleteMyDocument(fileId) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('删除文档'));
    return request(`/files/${encodeURIComponent(fileId)}?reason=${encodeURIComponent('member self delete')}`, {
      method: 'DELETE',
      needAuth: true,
    });
  },

  /** 本人权益列表，只读；不在前端推断会员、折扣或可核销状态。 */
  getMyBenefits(params = {}) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('我的权益'));
    return unwrapList(request('/me/benefits', { method: 'GET', data: params, needAuth: true }));
  },

  /** 本人通知列表，返回 items 并保留 total/unreadCount 分页元数据。 */
  getMyNotifications(params = {}) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('消息通知'));
    return request('/me/notifications', { method: 'GET', data: params, needAuth: true });
  },

  markAllNotificationsRead() {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('消息通知'));
    return request('/me/notifications/read-all', { method: 'PATCH', needAuth: true });
  },

  markNotificationRead(kind, id) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('消息通知'));
    return request(`/me/notifications/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/read`, {
      method: 'PATCH',
      needAuth: true,
    });
  },

  /** 本人浏览记录；仅表示浏览或打开来源入口，不表示投递/预约结果。 */
  getMyBrowseLogs(params = {}) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('浏览记录'));
    return unwrapList(request('/me/browse-logs', { method: 'GET', data: params, needAuth: true }));
  },

  deleteMyBrowseLog(id) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('删除浏览记录'));
    return request(`/me/browse-logs/${encodeURIComponent(id)}`, { method: 'DELETE', needAuth: true });
  },

  /**
   * 本人 AI 服务记录（需登录）。返回 MemberAiRecordItem[] 数组，附 .total。
   * kind 取值: parse | optimize | generate | job_fit | career_plan | fair_visit_plan
   * 后端: GET /api/v1/me/ai-records?cursor=&pageSize=
   */
  getMyAiRecords(params = {}) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('AI 服务记录'));
    return unwrapList(request('/me/ai-records', { method: 'GET', data: params, needAuth: true }));
  },

  /** 删除本人 AI 服务记录；parse 记录的派生结果由服务端按既有规则级联删除。 */
  deleteMyAiRecord(recordId) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('删除 AI 服务记录'));
    return request(`/me/ai-records/${encodeURIComponent(recordId)}`, {
      method: 'DELETE',
      needAuth: true,
    });
  },

  // ── AI 助手 ──

  /**
   * 小青对话。无需 auth，支持匿名使用。
   * 后端返回裸响应 { sessionId, reply, intent, actions?: [{label, route}] }。
   * 前端传入 sessionId 时后端延续上下文，否则新建会话。
   * @param {string} message 用户输入
   * @param {string} [sessionId] 续传上下文；首次省略
   * @returns {{ sessionId: string, reply: string, intent: string, actions?: Array<{label:string,route:string}> }}
   */
  assistantChat(message, sessionId) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('AI 助手'));
    const body = { message };
    if (sessionId) body.sessionId = sessionId;
    return request('/assistant/chat', { method: 'POST', data: body, needAuth: false, timeout: config.aiTimeout });
  },

  // ---------- 打印订单 ----------

  /**
   * 公开打印价目（无需登录）。
   * 后端运行时从 PriceConfig 读取，返回
   * { billingEnabled, items: [{ serviceKey, unitCents, unit, description }] }。
   * 页面不得在失败时回退硬编码价，避免展示价和最终扣费漂移。
   */
  getPrintPriceConfig() {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('打印报价'));
    return request('/print/price-config', { method: 'GET', needAuth: false });
  },

  /**
   * 本人打印订单列表（需登录）。游标分页。
   * 后端: GET /api/v1/me/print-orders?cursor=&pageSize=
   * unwrapList 后返回 MemberPrintOrderItem[] 数组，附 .nextCursor / .total
   */
  getMyPrintOrders(params = {}) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('打印订单'));
    return unwrapList(request('/me/print-orders', { method: 'GET', data: params, needAuth: true }));
  },

  /** M2 第一片：本人文件预提交为 Order-only，付款前不会创建 PrintTask。 */
  createCloudPrintOrder(data) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('云打印预提交'));
    return request('/me/print-orders', { method: 'POST', data, needAuth: true });
  },

  /** Order-only 待到机订单列表。 */
  getMyCloudPrintOrders() {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('云打印订单'));
    return request('/me/print-orders/cloud', { method: 'GET', needAuth: true });
  },

  getCloudPrintOrder(orderId) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('云打印订单'));
    return request(`/me/print-orders/${encodeURIComponent(orderId)}`, { method: 'GET', needAuth: true });
  },

  cancelCloudPrintOrder(orderId, reason) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('云打印订单'));
    return request(`/me/print-orders/${encodeURIComponent(orderId)}/cancel`, {
      method: 'POST', data: reason ? { reason } : {}, needAuth: true,
    });
  },

  /** 打印前隐私检查；会员 token 保证只能检查本人文件。 */
  createPrintPiiScan(fileId) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('打印隐私检查'));
    return request('/materials/tasks', {
      method: 'POST', data: { kind: 'pii_scan', sourceFileId: fileId }, needAuth: true, timeout: config.aiTimeout,
    });
  },

  decidePrintPiiFindings(taskId, decisions) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('打印隐私检查'));
    return request(`/materials/tasks/${encodeURIComponent(taskId)}/pii-findings/decisions`, {
      method: 'POST', data: { decisions }, needAuth: true, timeout: config.aiTimeout,
    });
  },

  /**
   * C 端公开终端列表（无需登录）。
   * 后端: GET /api/v1/terminals/public
   * 返回 PublicTerminalView[]：{ id, displayName, locationLabel, isOnline, lastSeenAt }
   */
  getPublicTerminals() {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('终端列表'));
    return request('/terminals/public', { method: 'GET', needAuth: false });
  },
};

module.exports = api;
