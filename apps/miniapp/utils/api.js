// utils/api.js
// 业务 API 门面。页面统一通过此层取数,不直接调 wx.request。
// USE_MOCK=true → 返回本地 mock(带模拟延迟);false → 走真实 request(baseUrl+apiPrefix)。
// 切换后端时:只改 utils/config.js 的 baseUrl / USE_MOCK,页面代码零改动。

const config = require('./config');
const { request, uploadFile } = require('./request');
const mock = require('./mock-data');
const N = require('./normalize');
const uploadNames = require('./upload-name');

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

  // ---------- 招聘会现场助手 ----------
  // 这一组端点后端早就为一体机建好了（apps/kiosk 已在消费），小程序此前一条都没接。
  // 响应结构以 packages/shared 的 FairCompanyDTO / FairZoneDTO / FairVenueGuideDTO /
  // FairMaterialDTO / FairVisitPlanResponse 为准，前端不得自行猜测字段。

  /**
   * 参会企业列表。分页响应，走 unwrapList。
   * 合规：DTO 不含企业联系人和 HR 邮箱——后端就没返回，前端也不要显示任何"联系方式"占位。
   */
  getFairCompanies(fairId, params = {}) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('参会企业'));
    return adaptList(unwrapList(request(`/job-fairs/${fairId}/companies`, {
      method: 'GET', data: params, needAuth: false,
    })), N.fairCompanyLike);
  },

  /**
   * 参会企业详情。
   * 合规：响应里的 applyNote 是**必须展示**的合规提示文字，页面不得省略或改写。
   */
  getFairCompanyDetail(fairId, companyId) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('参会企业'));
    return request(`/job-fairs/${fairId}/companies/${companyId}`, { method: 'GET', needAuth: false })
      .then(N.fairCompanyLike);
  },

  /** 展区列表（FairZoneDTO[]）。未发布或无数据时后端可能给 null，调用方要兜空数组。 */
  getFairZones(fairId) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('展区导览'));
    return request(`/job-fairs/${fairId}/zones`, { method: 'GET', needAuth: false })
      .then((list) => (Array.isArray(list) ? list.map(N.fairZoneLike) : []));
  },

  /**
   * 展位平面数据 { zones, booths }。
   * 后端在未发布/无数据时会返回 data:null，这里统一兜成空集合，
   * 让页面落到空态而不是在 .map 上崩掉。
   */
  getFairMap(fairId) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('展位导览'));
    return request(`/job-fairs/${fairId}/map`, { method: 'GET', needAuth: false })
      .then((d) => ({
        // mapImageUrl 是主办方上传的真实平面图,早先这里把它丢了,页面就算有图也看不到。
        mapImageUrl: (d && d.mapImageUrl) || null,
        zones: ((d && d.zones) || []).map(N.fairZoneLike),
        // 服务端当前恒返回空数组(jobs-kiosk.service.ts 的返回类型写死 booths: [])。
        // 保留这条链路,等真有展位数据时页面不用改。
        booths: (d && d.booths) || [],
      }));
  },

  /** 会场导览（展厅 + 设施点位）。无配置时后端返回 null，属正常空态不是错误。 */
  getFairVenueGuide(fairId) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('会场导览'));
    return request(`/job-fairs/${fairId}/venue-guide`, { method: 'GET', needAuth: false });
  },

  /** 活动资料列表。previewUrl 是 2 小时签名 URL，不要缓存也不要拼接原始存储路径。 */
  getFairMaterials(fairId, params = {}) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('活动资料'));
    return unwrapList(request(`/job-fairs/${fairId}/materials`, {
      method: 'GET', data: params, needAuth: false,
    }));
  },

  /**
   * 活动资料按需打印：生成短期派生文件，返回 { fileId, filename, pageCount, printFileUrl, ... }。
   * **生成文件不等于已打印**——拿到响应只能进入打印下单流程，页面不得声称已打印。
   */
  prepareFairMaterialPrint(fairId, materialId) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('活动资料打印'));
    return request(`/job-fairs/${fairId}/materials/${materialId}/print-url`, {
      method: 'POST', needAuth: true, timeout: 60000,
    });
  },

  /**
   * 参会企业资料按需打印。variant: 'profile' 企业资料 / 'positions' 岗位清单。
   * 与活动资料不同，这里没有预置文件，服务端按库内展示字段实时渲染 PDF，
   * 所以 pageCount / sizeBytes 来自真实渲染结果，前端不要估算。
   */
  prepareFairCompanyPrint(fairId, companyId, variant) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('企业资料打印'));
    // variant 必须拼进 query string:后端是 @Query('variant')(jobs.controller.ts),
    // 放进 POST body 会拿到 undefined 并抛 400「variant 只能是 profile 或 positions」。
    const q = encodeURIComponent(variant || '');
    return request(`/job-fairs/${fairId}/companies/${companyId}/print-url?variant=${q}`, {
      method: 'POST', needAuth: true, timeout: 60000,
    });
  },

  /**
   * 招聘会统计。
   * 合规：DTO 里 checkedInCompanies / browseCount / scanCount / printCount / checkinCount
   * 为 null 时表示**无可证明的统计源**，页面必须渲染「暂无数据」，**不得显示 0**。
   */
  getFairStats(fairId) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('招聘会数据'));
    return request(`/job-fairs/${fairId}/stats`, { method: 'GET', needAuth: false });
  },

  /**
   * 生成 AI 参会准备单（付费 AI 服务，限流 6 次/分钟，与职业规划同一条权益扣次通道）。
   * 依赖本人已有简历任务 taskId——没有简历就没有这个能力，页面要先引导去上传简历。
   * 服务端按招聘会 endAt 判定 mode：未结束 preparation / 已结束 review，前端只读不猜。
   */
  generateFairVisitPlan(fairId, taskId, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('AI 参会准备单'));
    return request(`/job-fairs/${fairId}/visit-plan/${taskId}`, {
      method: 'POST', header: tokenHeader(accessToken), needAuth: true, timeout: config.aiTimeout,
    });
  },

  /** 读取已生成的参会准备单（不触发新生成）。无记录时后端 404，属正常空态。 */
  getFairVisitPlan(fairId, taskId, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('AI 参会准备单'));
    return request(`/job-fairs/${fairId}/visit-plan/${taskId}`, {
      method: 'GET', header: tokenHeader(accessToken), needAuth: true,
    });
  },

  /** 把准备单渲染成 PDF 入库。同 printCareerPlan：进了「我的文档」，但不等于已打印。 */
  printFairVisitPlan(fairId, taskId, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('AI 参会准备单'));
    return request(`/job-fairs/${fairId}/visit-plan/${taskId}/print`, {
      method: 'POST', header: tokenHeader(accessToken), needAuth: true, timeout: 60000,
    });
  },

  // ---------- 企业 ----------
  getCompanies(params = {}) {
    if (config.USE_MOCK) return mockResolve(mock.companyList());
    return adaptList(unwrapList(request('/companies', { method: 'GET', data: params, needAuth: false })), N.company);
  },
  getCompanyDetail(id) {
    if (config.USE_MOCK) return mockResolve(mock.companyById(id));
    return request(`/companies/${id}`, { method: 'GET', needAuth: false }).then(N.companyDetail);
  },
  getCompanyJobs(id, params = {}) {
    if (config.USE_MOCK) {
      const detail = mock.companyById(id);
      return mockResolve(detail && Array.isArray(detail.jobs) ? detail.jobs : []);
    }
    return adaptList(
      unwrapList(request(`/companies/${id}/jobs`, { method: 'GET', data: params, needAuth: false })),
      N.companyJob,
    );
  },

  // ---------- 政策 ----------
  getPolicies(params = {}) {
    if (config.USE_MOCK) return mockResolve(mock.policyList());
    return adaptList(unwrapList(request('/policies', { method: 'GET', data: params, needAuth: false })), N.policy);
  },
  /**
   * 政策条件自测问项。免登录（与 GET /policies 同口径）。
   * 返回 { questionSetVersion, questions, privacyNotice, disclaimer }。
   * questions[].sensitive 为真表示敏感个人信息——页面必须就地提示「这项可以不填」，
   * 而不是默默收集。
   */
  getPolicyEligibilityQuestions() {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('政策条件自测'));
    return request('/policies/eligibility-questions', { method: 'GET', needAuth: false });
  },

  /**
   * 政策条件核对。免登录、纯计算、**服务端零落库**——作答不进库、不进审计、不进日志
   * （policy-eligibility.service.ts 的隐私口径）。
   *
   * 用 POST 而不是 GET 是刻意的：作答含户籍/参保/失业登记等个人信息，
   * 放进 URL query 会进网关与访问日志。同理前端也不得把作答写进
   * Storage 或页面路由参数。
   *
   * 结果里的 overallLabel 是服务端给定的合规措辞（「已录入条件的比对结果」），
   * **必须原样展示**：写成「你符合申领资格」就把机械比对说成了资格认定。
   * evidenceLevel 恒为 E2（来源方事实），不得出现「AI 判断」字样。
   */
  checkPolicyEligibility(answers, policyIds) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('政策条件自测'));
    const data = { answers: answers || {} };
    if (Array.isArray(policyIds) && policyIds.length) data.policyIds = policyIds;
    return request('/policies/eligibility-check', { method: 'POST', data, needAuth: false });
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
  /**
   * 上传本人简历文件。
   *
   * displayName 与 uploadPrintFile 同理：wx.uploadFile 固定取 filePath 的
   * basename 作为 multipart 文件名，直传临时路径会让服务端存下 tmp_xxx，
   * 简历记录里显示的就是那串英文数字。走同一套改名副本方案。
   */
  uploadResumeFile(filePath, purpose = 'resume_upload', displayName) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('简历上传'));
    return uploadNames.prepareNamedFile(filePath, displayName).then((prepared) =>
      uploadFile('/files/kiosk-upload', prepared.filePath, {
        name: 'file',
        formData: { purpose },
        needAuth: true, // 已登录则带 token 归属到本人,未登录走匿名
      }).then(
        (res) => { prepared.cleanup(); return res; },
        (err) => { prepared.cleanup(); throw err; }
      )
    );
  },

  /**
   * 上传本人通用打印文件；后端 print_doc 仅接受 PDF/JPG/PNG 并按真实 MIME/魔数校验。
   *
   * 文件名只能走 multipart 文件段本身（wx.uploadFile 取 filePath 的 basename），
   * 绝不能塞进 formData：后端 KioskUploadOptionsDto 只白名单了 purpose 一个字段，
   * 配合 main.ts 全局 whitelist + forbidNonWhitelisted，多传字段会整体
   * 400 VALIDATION_FAILED。旧实现的 originalFilename 形参正是这个陷阱
   * （所幸从未被调用方传值，否则上传必失败）。
   *
   * @param {string} filePath 本地临时路径
   * @param {string} [displayName] 期望服务端落库的文件名；见 utils/upload-name.js
   */
  uploadPrintFile(filePath, displayName) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('打印文件上传'));
    return uploadNames.prepareNamedFile(filePath, displayName).then((prepared) =>
      uploadFile('/files/kiosk-upload', prepared.filePath, {
        name: 'file',
        formData: { purpose: 'print_doc' },
        needAuth: true,
      }).then(
        (res) => { prepared.cleanup(); return res; },
        (err) => { prepared.cleanup(); throw err; }
      )
    );
  },

  /** 获取本人文件的预览 URL（短时签名，仅用于预览/打印报价）。 */
  getFilePreviewUrl(fileId) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('文件预览'));
    return request(`/files/${encodeURIComponent(fileId)}/preview-url`, {
      method: 'GET',
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
  /**
   * 打印报价。
   *
   * 常规路径：拿 fileId 去换 printFileUrl 再报价。这条路要求文件属于本人
   * （canAccessFile 对会员只认 `record.endUserId === requester.endUserId`）。
   *
   * presetFileUrl 是给「服务端已经把 printFileUrl 交到手上」的场景用的：
   * 招聘会活动资料和参会企业资料是共享派生文件，创建时 uploaderId / endUserId
   * 都是 null（ownerType 落成 'system'），会员拿 fileId 去 preview-url 必吃
   * 403 FILE_ACCESS_DENIED。而 prepareFair*Print 的响应里本来就带 printFileUrl，
   * 后端注释也写明「前端据此进入正常打印流程」——透传即可，不必再换一次。
   *
   * 注意这里不放宽任何访问策略：presetFileUrl 只能来自服务端刚刚下发的响应，
   * 前端不构造、不缓存、不复用。
   */
  quoteMyPrintOrder(fileId, params, presetFileUrl) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('打印报价'));
    const quoteWith = (fileUrl) => request('/orders/quote', {
      method: 'POST',
      data: { fileUrl, params },
      needAuth: false,
    });

    const preset = String(presetFileUrl || '').trim();
    if (preset) return quoteWith(preset);

    const id = String(fileId || '').trim();
    if (!id) return Promise.reject(new Error('缺少打印文件'));
    return request(`/files/${encodeURIComponent(id)}/preview-url`, {
      method: 'GET',
      needAuth: true,
    }).then((access) => {
      const fileUrl = access && access.printFileUrl;
      if (!fileUrl) throw new Error('服务端未返回可打印文件凭证');
      return quoteWith(fileUrl);
    });
  },

  /**
   * 修改本人文件的保存期限。
   *
   * 可选项**只能用服务端在 /me/documents 里给出的 allowedRetentionPolicies**，
   * 前端不自行推算：证件照 / 签名 / 合同上传与审查报告被锁死在 system_short，
   * 原始文件不允许 long_term——这些规则在 retention-policy.ts 里，
   * 前端复制一份必然漂移，漂移的结果是用户点了却被后端打回。
   *
   * months_6 与 long_term 属于延长保存，服务端要求 consentVersion；
   * 缺了回 RETENTION_CONSENT_REQUIRED，版本不对回 RETENTION_CONSENT_INVALID。
   * 所以调用方必须**先向用户出示保存条款并取得确认**，再带上版本号——
   * 在这里默认补一个版本号等于替用户签字。
   */
  updateFileRetention(fileId, retentionPolicy, consentVersion) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('修改保存期限'));
    const data = { retentionPolicy };
    if (consentVersion) data.consentVersion = consentVersion;
    return request(`/files/${encodeURIComponent(fileId)}/retention`, {
      method: 'PATCH', data, needAuth: true,
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

  /** 本人外部跳转记录；只表示打开过来源平台/官方入口，不表示投递或预约结果。 */
  getMyJumpLogs(params = {}) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('跳转记录'));
    return unwrapList(request('/me/external-jump-logs', { method: 'GET', data: params, needAuth: true }));
  },

  deleteMyJumpLog(id) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('删除跳转记录'));
    return request(`/me/external-jump-logs/${encodeURIComponent(id)}`, { method: 'DELETE', needAuth: true });
  },

  /**
   * 上报一次浏览。后端 ActivityController 为可选登录：匿名会诚实返回
   * { recorded:false, reason:'LOGIN_REQUIRED' } 且不落库，故调用方只在登录态发。
   * body 只收 targetType/targetId/terminalId，来源名称与外链一律由服务端从
   * 「已审核+已发布」目标补齐，前端伪造不了；目标未发布 → 404。
   * @param {{targetType:string,targetId:string}} payload targetType ∈
   *        job | job_fair | policy | company_profile | fair_company
   */
  recordBrowseActivity(payload) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('浏览记录上报'));
    return request('/activity/browse', { method: 'POST', data: payload, needAuth: true });
  },

  /**
   * 上报一次「打开来源平台 / 官方入口」。action 必须与 targetType 匹配，否则 400：
   *   job / fair_company        → external_apply
   *   job_fair                  → external_appointment | external_checkin_open
   *   policy / company_profile  → external_open
   */
  recordJumpActivity(payload) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('跳转记录上报'));
    return request('/activity/external-jump', { method: 'POST', data: payload, needAuth: true });
  },

  /**
   * 本人收藏列表。type ∈ job | job_fair | policy（后端 FAVORITE_TARGET_TYPES，
   * 没有企业）；缺省返回全部。返回数组附 .nextCursor / .total。
   * 条目字段只有 { id, targetType, targetId, title|null, createdAt }。
   */
  getMyFavorites(params = {}) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('我的收藏'));
    return unwrapList(request('/me/favorites', { method: 'GET', data: params, needAuth: true }));
  },

  /**
   * 新增收藏（服务端 upsert 幂等）。AddFavoriteDto 走 whitelist +
   * forbidNonWhitelisted，多传任何字段都会 400；title 服务端一律忽略并从
   * 「已审核+已发布」目标重新派生，所以这里不传。目标未发布 → 404。
   */
  addMyFavorite(targetType, targetId) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('我的收藏'));
    return request('/me/favorites', {
      method: 'POST',
      data: { targetType, targetId },
      needAuth: true,
    });
  },

  /** 取消收藏（幂等，未收藏也返回 { removed:false } 而不是报错）。 */
  removeMyFavorite(targetType, targetId) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('我的收藏'));
    return request(
      `/me/favorites/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`,
      { method: 'DELETE', needAuth: true },
    );
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

  // ---------- 自我探索 · 倾向参考 ----------
  // 注意命名：后端本身就叫「自我探索 · 倾向参考」。**不要叫「职业测评」**——
  // 「测评 / 性格 / 适合岗位」是资格判定口吻，这里只是本人倾向的参考描述。

  /**
   * 题目下发（5 维 × 5 题）。免登录。
   * 小程序原生 JS 无构建，导不进 packages/shared 的题库模块，所以由服务端下发；
   * 下发的正是服务端用来计分的那一份，不存在「题目与计分口径不一致」。
   */
  getSelfAssessmentQuestions() {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('自我探索'));
    return request('/resume/self-assessment/questions', { method: 'GET', needAuth: false });
  },

  /**
   * 提交作答。付费 AI 服务（PaidAiThrottle 6 次/分钟）。
   *
   * consent.nonSensitive 为必填：为 false 服务端直接拒绝
   * （SELF_ASSESSMENT_CONSENT_REQUIRED）。consentVersion 必须用服务端
   * questions 接口下发的那个值，不在前端写死——写死会在版本换代时静默失配。
   *
   * 隐私：答案原文**不入库也不送 LLM**，服务端只持久化
   * answersHash + dimensions + summary + note，送模型的只有维度
   * key/label/strength 与证据题号。
   *
   * 结果里的 strength 是**纯函数评分**（5 题 weight 累加归一化），
   * LLM 只写 note；LLM 不可用或命中合规词时 note 为 null 而 strength 不变。
   * 所以图表只能画 strength，绝不能拿 note 反推分数。
   */
  submitSelfAssessment(answers, consent, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('自我探索'));
    return request('/resume/self-assessment', {
      method: 'POST',
      data: { answers, consent },
      header: tokenHeader(accessToken),
      needAuth: true,
      timeout: config.aiTimeout,
    });
  },

  /** 读取已生成的结果（不触发新生成）。无记录时 404 属正常空态。 */
  getSelfAssessment(taskId, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('自我探索'));
    return request(`/resume/self-assessment/${encodeURIComponent(taskId)}`, {
      method: 'GET', header: tokenHeader(accessToken), needAuth: true,
    });
  },

  /** 渲染报告 PDF 入库。同 printCareerPlan：进了「我的文档」，但不等于已打印。 */
  printSelfAssessment(taskId, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('自我探索'));
    return request(`/resume/self-assessment/${encodeURIComponent(taskId)}/print`, {
      method: 'POST', header: tokenHeader(accessToken), needAuth: true, timeout: 60000,
    });
  },

  /** 本人撤回该次结果（服务端删除并留审计）。 */
  withdrawSelfAssessment(taskId, accessToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('自我探索'));
    return request(`/resume/self-assessment/${encodeURIComponent(taskId)}`, {
      method: 'DELETE', header: tokenHeader(accessToken), needAuth: true,
    });
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

  // ---------- 材料包打印订单（小程序专用）----------

  /**
   * 创建材料包打印订单（一体机现场取件）
   * @param {object} data { terminalId, files: [{ fileId, filename, pageCount }], params: { colorMode, duplex, copies }, totalAmount }
   * @returns {Promise<{ orderId, pickupCode, qrCodeUrl, expiresAt }>}
   */
  createPackageOrder(data) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('材料包订单'));
    return request('/orders/package', { method: 'POST', data, needAuth: true });
  },

  /**
   * 获取材料包订单详情
   * @param {string} orderId
   */
  getPackageOrder(orderId) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('订单详情'));
    return request(`/orders/package/${encodeURIComponent(orderId)}`, { method: 'GET', needAuth: true });
  },

  /**
   * 取消材料包订单
   * @param {string} orderId
   * @param {string} reason
   */
  cancelPackageOrder(orderId, reason) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('取消订单'));
    return request(`/orders/package/${encodeURIComponent(orderId)}/cancel`, {
      method: 'POST',
      data: { reason },
      needAuth: true
    });
  },

  // ---------- 职业圈动态 ----------


  /**
   * 获取动态详情
   * @param {string} id
   */
  getFeedDetail(id) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('动态详情'));
    return request(`/community/feeds/${encodeURIComponent(id)}`, { method: 'GET', needAuth: false });
  },

  /**
   * 点赞动态
   * @param {string} id
   */
  likeFeed(id) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('点赞'));
    return request(`/community/feeds/${encodeURIComponent(id)}/like`, { method: 'POST', needAuth: true });
  },

  /**
   * 取消点赞
   * @param {string} id
   */
  unlikeFeed(id) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('取消点赞'));
    return request(`/community/feeds/${encodeURIComponent(id)}/like`, { method: 'DELETE', needAuth: true });
  },

  /**
   * 获取动态评论列表
   * @param {string} feedId
   * @param {object} params { cursor, pageSize }
   */
  getFeedComments(feedId, params = {}) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('评论列表'));
    return unwrapList(request(`/community/feeds/${encodeURIComponent(feedId)}/comments`, {
      method: 'GET',
      data: params,
      needAuth: false
    }));
  },

  /**
   * 发表评论
   * @param {string} feedId
   * @param {object} data { content, replyToCommentId? }
   */
  commentFeed(feedId, data) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('发表评论'));
    return request(`/community/feeds/${encodeURIComponent(feedId)}/comments`, {
      method: 'POST',
      data,
      needAuth: true
    });
  },

  /**
   * 点赞评论
   * @param {string} commentId
   */
  likeComment(commentId) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('点赞评论'));
    return request(`/community/comments/${encodeURIComponent(commentId)}/like`, {
      method: 'POST',
      needAuth: true
    });
  },

  /**
   * 取消点赞评论
   * @param {string} commentId
   */
  unlikeComment(commentId) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('取消点赞评论'));
    return request(`/community/comments/${encodeURIComponent(commentId)}/like`, {
      method: 'DELETE',
      needAuth: true
    });
  },

  // ---------- 今日早报 ----------

  /**
   * 职业圈动态 / 今日早报。
   *
   * ⚠️ 服务端 /community/feeds 与 /assistant/daily-report 目前均不存在。
   * 保留这两个方法不是因为它们能用，而是 pages/community/ 与
   * pages/daily-report/ 这两个在制页面仍在调用，删掉会直接打断
   * 主仓正在进行的工作。等那两页连同后端一起落地或一起废弃时再处理。
   * AI 百宝箱首页已不再引用（见 e2d8dcfb1）。
   */
  getCommunityFeeds(params = {}) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('职业圈动态'));
    return unwrapList(request('/community/feeds', { method: 'GET', data: params, needAuth: false }));
  },

  getDailyReport() {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('今日早报'));
    return request('/assistant/daily-report', { method: 'POST', needAuth: false, timeout: config.aiTimeout });
  },

  // ---------- 合同审查（后端 contract-review.controller.ts 已实现） ----------
  /**
   * 合同类型白名单，与服务端 dto/contract-review.dto.ts 的 CONTRACT_TYPES 一一对应。
   * 服务端用 @IsIn 强校验，前端传错值会 400，因此不要在页面里另写字面量。
   */
  CONTRACT_TYPES: ['labor_contract', 'internship_agreement', 'non_compete', 'offer'],

  /**
   * 上传待审查合同原件。purpose 必须是 contract_upload，不能借用 print_doc：
   *   1. contract-review.service.ts:178 只认 contract_upload，别的 purpose 一律
   *      404 CONTRACT_REVIEW_SOURCE_NOT_FOUND（extraction 侧还有第二道拦截）；
   *   2. 该 purpose 在服务端被判为 highly_sensitive，并由 retention-policy 锁定
   *      两小时寿命（retentionLockedReason=contract_review_session_only），
   *      换成别的 purpose 等于把合同按普通打印件留存。
   * formData 只能带 purpose：KioskUploadOptionsDto 只白名单了 purpose 一个字段，
   * 全局 forbidNonWhitelisted:true 会把 originalFilename 之类的多余字段直接 400。
   *
   * displayName 与 uploadPrintFile / uploadResumeFile 同理：wx.uploadFile 固定取
   * filePath 的 basename 作为 multipart 文件名，直传临时路径会让服务端存下 tmp_xxx。
   * 对合同尤其要紧——提取阶段的 resolveSupportedKind()
   * （contract-review-extraction.service.ts:167）是拿 mimeType **和文件扩展名**
   * 配对判定的，文件名丢了扩展名会直接 CONTRACT_UNSUPPORTED_FILE_TYPE。
   *
   * 注意 prepareNamedFile 会在 USER_DATA_PATH 留一份改名副本，合同属敏感个人信息，
   * 因此 cleanup() 在成功与失败两条路径上都必须调用，不能只写 then。
   *
   * @param {string} filePath 本地临时路径
   * @param {string} [displayName] 期望服务端落库的文件名；见 utils/upload-name.js
   */
  uploadContractFile(filePath, displayName) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('合同审查'));
    return uploadNames.prepareNamedFile(filePath, displayName).then((prepared) =>
      uploadFile('/files/kiosk-upload', prepared.filePath, {
        name: 'file',
        formData: { purpose: 'contract_upload' },
        needAuth: true,
      }).then(
        (res) => { prepared.cleanup(); return res; },
        (err) => { prepared.cleanup(); throw err; }
      )
    );
  },

  /**
   * 取同意范围。必须先调这个：create 需要回传 consentVersion / consentScopeHash /
   * disclaimerVersion，服务端据此校验用户确实看过当前版本的告知内容。
   * 这是一道刻意设置的合规闸门，不能在前端伪造这几个值绕过去。
   *
   * 返回形状（contract-review-consent.service.ts:79-89 的 ContractReviewPublicConsentScope）：
   *   { consentVersion, consentScopeHash,
   *     disclaimer: { id, version, content, publishedAt },
   *     disclosures: {...} }
   * ⚠️ 顶层没有 disclaimerVersion，版本号在 disclaimer.version。
   */
  getContractConsentScope() {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('合同审查'));
    return request('/contract-reviews/consent-scope', { method: 'GET', needAuth: true });
  },

  /**
   * 会员合同审查 AI 授权状态。/me/ai-consents/status 返回全部 scope 的数组。
   * 注意 granted=true 还不够：create 会额外要求授权事件的 grantedAt 不早于
   * 当前生效免责声明的 publishedAt（contract-review.service.ts:232-239），
   * 所以调用方必须再拿 grantedAt 与 consent-scope 的 disclaimer.publishedAt 比对。
   */
  getMemberContractConsent() {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('合同审查'));
    return request('/me/ai-consents/status', { method: 'GET', needAuth: true }).then((list) => {
      const item = Array.isArray(list) ? list.find((v) => v && v.scope === 'contract_review') : null;
      return item || { scope: 'contract_review', granted: false, grantedAt: null };
    });
  },

  /**
   * 授予合同审查 AI 授权。会员路径的 create 走 requireActiveConsentInTransaction，
   * 服务端没有授权记录就 403 USER_AI_CONSENT_REQUIRED —— 只在前端弹窗点"同意"没用。
   * 服务端是 append-only 事件表，每次调用写一条新授权时间，不覆盖历史。
   */
  grantMemberContractConsent() {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('合同审查'));
    return request('/me/ai-consents', {
      method: 'POST', data: { scope: 'contract_review' }, needAuth: true,
    });
  },

  /**
   * 建审查任务。sourceFileId 来自 uploadContractFile() 的上传结果；
   * consent* 四个字段原样透传 getContractConsentScope() 的返回，不要自行构造，
   * 其中 disclaimerVersion 取 scope.disclaimer.version。
   * @param {{sourceFileId:string, contractType:string, consentVersion:string,
   *          consentedAt:string, consentScopeHash:string, disclaimerVersion:string}} payload
   */
  createContractReview(payload) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('合同审查'));
    // 建任务要落库并校验同意快照，15 秒默认值偏紧。
    return request('/contract-reviews', { method: 'POST', data: payload, needAuth: true, timeout: config.aiTimeout });
  },

  /**
   * 轮询任务状态。这也是**唯一**能拿到审查结论的地方：
   * status='completed' 时 result 里带 findings 与各优先级计数
   * （contract-review.types.ts:153-168 的 ContractReviewTaskView）。
   */
  getContractReview(id) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('合同审查'));
    return request(`/contract-reviews/${encodeURIComponent(id)}`, { method: 'GET', needAuth: true });
  },

  /**
   * 确认解析范围。totalPages / analyzedPages / truncated 必须与轮询响应逐字段相等
   * （lifecycle 的 assertConfirmation 做 matchesExtraction 比对，不等就 400）。
   * ocrCoverageConfirmed / personalUseConfirmed 是两个 @Equals(true) 必填项，
   * 代表用户确认了识别范围与个人用途——页面必须真的让用户勾选，不能默认写死。
   * @param {{contractType:string,totalPages:number,analyzedPages:number,
   *          truncated:boolean,ocrCoverageConfirmed:true,personalUseConfirmed:true}} payload
   */
  confirmContractReview(id, payload) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('合同审查'));
    return request(`/contract-reviews/${encodeURIComponent(id)}/confirm`, {
      method: 'POST', data: payload, needAuth: true,
      // 确认后服务端要做状态机切换与入队，实测会超过 15 秒默认值。
      timeout: config.aiTimeout,
    });
  },

  // ⚠️ 故意不提供 POST /contract-reviews/:id/report 的封装。
  // 该端点返回的是**报告 PDF 的文件元数据**（ContractReviewReportView），里面没有
  // findings；结论一直在 getContractReview() 的 result 里。而调用它会有两个副作用：
  // 服务端 deleteSource 删掉合同原文，且生成一份带 abandonToken 的高敏 PDF——
  // 不消费 abandonToken 就没人回收。将来要做"打印审查报告"再单独设计整条回收链路。

  /** 删除审查记录。合同属敏感文件，用户放弃时应即时清除而非留存。 */
  deleteContractReview(id) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('合同审查'));
    return request(`/contract-reviews/${encodeURIComponent(id)}`, { method: 'DELETE', needAuth: true });
  },

  // ---------- 会员二次验证（step-up） ----------
  // 契约来源（逐字段核对，勿凭字段名猜）：
  //   services/api/src/member-auth/member-auth.controller.ts  POST member/auth/step-up/sms-code | verify
  //   services/api/src/member-auth/dto/member-step-up.dto.ts  请求体白名单
  //   services/api/src/member-auth/member-step-up.types.ts    action 白名单
  //   services/api/src/member-auth/member-step-up.service.ts  返回结构与错误码
  // 全局 ValidationPipe 开了 forbidNonWhitelisted，请求体多一个字段就 400 VALIDATION_FAILED，
  // 因此下面两个方法只允许送 DTO 里存在的键。
  //
  // deviceId 一律不送：它在服务端只做两件事 —— 设备维度小时频控，以及审计里的
  // deviceMatched 布尔。小程序没有终端号，编一个塞进去会污染审计；两侧都不送时
  // deviceDigest 恒为 null，consumeGrant 比对 null === null 仍判定 matched。
  // 同理不送 x-terminal-id（该头在服务端就是被当作 deviceId 用的）。

  /**
   * 为敏感动作发送二次验证短信，发到账号已绑定的手机号（前端无从选择号码）。
   * @param {'export_data_request'|'export_data_download'|'close_account'|'phone_rebind'} action
   * @returns {Promise<{challengeId:string, phoneMasked:string, expiresInSeconds:number, cooldownSeconds:number}>}
   *   已知错误码：STEP_UP_SEND_TOO_FREQUENT / STEP_UP_RATE_LIMITED(429)、
   *   ACCOUNT_UNAVAILABLE(403)、SMS_SEND_FAILED(502)。
   */
  sendMemberStepUpCode(action) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('二次验证'));
    return request('/member/auth/step-up/sms-code', {
      method: 'POST', data: { action }, needAuth: true,
    });
  },

  /**
   * 校验二次验证码，换一次性 stepUpToken。
   * token 与 action 绑定、单次消费、有效期即 expiresInSeconds（服务端默认 300s）。
   * @returns {Promise<{stepUpToken:string, action:string, expiresInSeconds:number}>}
   *   已知错误码：STEP_UP_CHALLENGE_INVALID / STEP_UP_CODE_INVALID(401)、ACCOUNT_UNAVAILABLE(403)。
   */
  verifyMemberStepUp(challengeId, code) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('二次验证'));
    return request('/member/auth/step-up/verify', {
      method: 'POST', data: { challengeId, code }, needAuth: true,
    });
  },

  // ---------- 会员数据权利请求 ----------
  // 契约来源：services/api/src/member-privacy/member-privacy.controller.ts
  //           services/api/src/member-privacy/member-data-request.service.ts
  //           services/api/src/member-privacy/member-privacy.types.ts

  /**
   * 我的数据权利请求列表（倒序）。
   * @returns {Promise<{items:Array, nextCursor:string|null, capabilities:{accountClosureAvailable:boolean}}>}
   *   item: { id, requestType, status, requestedAt, handledAt, executionStep,
   *           exportExpiresAt, failureCode, canRetry, canDownload }
   *   status ∈ pending|handling|ready|completed|expired|failed|rejected|cancelled
   *   ⚠️ capabilities.accountClosureAvailable 是服务端对「账号注销是否开放」的唯一真话，
   *      当前实现恒为 false（create 对 requestType='delete' 固定抛 ACCOUNT_CLOSURE_NOT_AVAILABLE）。
   */
  listMemberDataRequests() {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('数据权利请求'));
    return request('/me/data-requests', { method: 'GET', needAuth: true });
  },

  /**
   * 创建数据权利请求。
   * @param {'export'|'delete'|'revoke_consent'} requestType
   * @param {{idempotencyKey:string, stepUpToken?:string}} opts
   *   idempotencyKey 必填且必须是 UUID 形态，服务端正则 [1-8] 版本位 + [89ab] variant 位，
   *   全局唯一：重试必须复用同一个 key，换 key 会被当成新请求。
   *   stepUpToken 仅 export 需要（action=export_data_request），走 header 而非 body。
   */
  createMemberDataRequest(requestType, opts = {}) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('数据权利请求'));
    const header = { 'idempotency-key': opts.idempotencyKey };
    if (opts.stepUpToken) header['x-member-step-up-token'] = opts.stepUpToken;
    return request('/me/data-requests', {
      method: 'POST', data: { requestType }, header, needAuth: true,
    });
  },

  /**
   * 为已 ready 的导出请求换一次性下载授权。
   * 需要 action=export_data_download 的 stepUpToken（与创建时那张不是同一张）。
   * @returns {Promise<{requestId:string, downloadUrl:string, expiresAt:string}>}
   *   downloadUrl 是一个网页地址，ticket 放在 URL fragment 里，见 pages/privacy/export-file.js。
   *   已知错误码：DATA_EXPORT_DOWNLOAD_UNAVAILABLE(404)、
   *   DATA_EXPORT_DOWNLOAD_CONFIG_UNAVAILABLE / DATA_EXPORT_DOWNLOAD_SERVICE_UNAVAILABLE(503)。
   */
  authorizeMemberDataExportDownload(requestId, stepUpToken) {
    if (config.USE_MOCK) return Promise.reject(mockUnavailable('数据导出下载'));
    return request(`/me/data-requests/${encodeURIComponent(requestId)}/download-authorizations`, {
      method: 'POST', data: {}, header: { 'x-member-step-up-token': stepUpToken }, needAuth: true,
    });
  },
};


module.exports = api;
