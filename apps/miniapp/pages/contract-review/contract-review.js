// pages/contract-review/contract-review.js
// 合同审查。后端 services/api/src/contract-review 已实现完整闭环。
//
// 合规要点（不要为了简化流程而绕过）：
//   1. 全流程强制登录：6 个端点都按会员身份设计，未登录时服务端走匿名路径，
//      需要 x-contract-review-source-file-proof / x-contract-review-access-token
//      两个请求头，小程序不具备 → 未登录整条链必然 404。
//   2. 同意页展示的披露项一律取服务端 disclosures 渲染，不在前端硬编码——
//      硬编码会在服务端改版后悄悄变成「展示的和实际生效的不一致」。
//   3. create 必须回传 consent-scope 返回的 consentVersion / consentedAt /
//      consentScopeHash / disclaimer.version，服务端据此校验用户看过当前版本告知。
//   4. 会员路径还要求服务端有 contract_review 授权事件，且授权时间不早于
//      当前免责声明发布时间；只在前端点「同意」不算数，会 403。
//   5. 合同属敏感个人信息，用户中途放弃时主动 DELETE，不留到自动清理。
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const uploadNames = require('../../utils/upload-name')

const SELF_ROUTE = '/pages/contract-review/contract-review'
const POLL_MS = 2000
// 轮询上限已改为按内容体量动态推算，见 _estimate() 与 _poll()。
// 保留此常量仅作为 etaSec 尚未就绪时的兜底下限参考。

/**
 * 「从微信聊天选文件」的扩展名白名单。
 *
 * 这不是抄 print_doc 的白名单，是服务端两道闸门的**交集**：
 *   1. 上传闸门 file-validation.ts:104 —— contract_upload 的 mimes 是 PDF_DOC_IMG，
 *      即 pdf / doc / docx / jpg / jpeg / png / webp；
 *   2. 提取闸门 contract-review-extraction.service.ts:167-177 resolveSupportedKind()
 *      只认 pdf / docx / jpg / jpeg / png / webp，并在 :176 对
 *      `mime === DOC_MIME || extension === '.doc'` 显式 return null → :214
 *      抛 CONTRACT_UNSUPPORTED_FILE_TYPE。
 *
 * 所以 .doc 是「传得上去、审不了」：放进选择器等于让用户走完同意流程、上传、
 * 建任务，再在提取阶段失败。宁可在选择器里就不给它，也不制造这种白等。
 * 反过来 webp 两道闸门都明确支持（:175），故保留。
 */
const CHAT_FILE_EXTENSIONS = ['pdf', 'docx', 'jpg', 'jpeg', 'png', 'webp']

/** 给用户看的格式说明，必须与 CHAT_FILE_EXTENSIONS 同步，别让提示和实际能选的不一致。 */
const FORMAT_HINT = 'PDF、DOCX 或 JPG / PNG / WEBP 图片'

/**
 * 上传大小上限。/files/kiosk-upload 是服务端代理上传，实际生效的是
 * min(contract_upload 的 20MB, PROXY_MAX_BYTES 15MB) = 15MB
 * （file-validation.ts:123 与 :203-204）。按 20MB 提示会让用户白传一次。
 */
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

/** 用户主动取消不是失败，不该在页面上留一行红字。 */
function isCancel(err) {
  return /cancel/i.test((err && err.errMsg) || '')
}

// 服务端状态机的真实阶段。进度条按「第 N 步 / 共 5 步」推进，
// 不用假的百分比动画——没有真实进度数据时，编一个匀速前进的条
// 等于伪造能力（§9）。用户看到的每一次前进，都对应服务端一次真实状态变化。
const STAGES = [
  { key: 'queued',           label: '排队中',     note: '任务已提交，等待处理' },
  { key: 'extracting',       label: '识别文字',   note: '正在从文件中提取合同文本' },
  { key: 'rule_checking',    label: '比对条款',   note: '按规则库逐条比对' },
  { key: 'ai_analyzing',     label: 'AI 分析',    note: '模型正在逐条判断风险，这一步最慢' },
  { key: 'safety_reviewing', label: '复核结果',   note: '校验结论是否可靠' },
]
// uploaded 归入 queued，二者对用户是同一件事
const STAGE_INDEX = { uploaded: 0, queued: 0, extracting: 1, rule_checking: 2, ai_analyzing: 3, safety_reviewing: 4 }

const STAGE_TEXT = {
  uploaded:          '已上传，排队中…',
  queued:            '排队中…',
  extracting:        '正在识别文字…',
  rule_checking:     '正在比对条款…',
  ai_analyzing:      '正在分析…',
  safety_reviewing:  '正在复核结果…',
}

// 服务端 ContractReviewPriority 三值。直接把 priority_check 这种内部值
// 显示给用户没有意义，在此映射为中文与样式类。
const PRIORITY = {
  priority_check:     { label: '重点核对', cls: 'p1' },
  attention:          { label: '留意',     cls: 'p2' },
  insufficient_info:  { label: '信息不足', cls: 'p3' },
}

const TYPE_LABELS = {
  labor_contract:       '劳动合同',
  internship_agreement: '实习协议',
  non_compete:          '竞业限制',
  offer:                'offer / 录用通知',
}

// 服务端 CONTRACT_REVIEW_CONSENT_DISCLOSURES 里的机器码 → 中文。
// 查不到的码原样显示：宁可露出一个陌生英文码，也不能让服务端新增的披露项
// 在页面上悄悄消失——那正是「展示的和实际生效的不一致」。
const DISCLOSURE_TEXT = {
  provided_by_active_disclaimer:          '见下方免责声明全文',
  contract_risk_notice:                   '提示合同中需要留意的条款',
  ocr_extraction:                         '文字识别（OCR）',
  deterministic_rules:                    '固定规则比对',
  domestic_llm_analysis:                  '境内大模型分析',
  source_file:                            '你上传的合同原件',
  ocr_text:                               '识别出的合同文字',
  ai_review_result:                       '分析结果',
  baidu_ocr_as_ocr_processor:             '百度智能云（受托进行文字识别）',
  domestic_llm_as_ai_inference_processor: '境内大模型服务商（受托进行分析推理）',
  access:                                 '查看',
  delete:                                 '删除',
  withdraw_consent:                       '撤回同意',
}

function label(code) {
  return DISCLOSURE_TEXT[code] || String(code)
}

function joinCodes(value) {
  return Array.isArray(value) ? value.map(label).join('、') : ''
}

/** 把服务端 disclosures 摊平成可渲染的行。字段缺失就不出这一行，绝不补默认值。 */
function buildScopeRows(d) {
  if (!d || typeof d !== 'object') return []
  const rows = []
  const push = (k, v) => { if (v) rows.push({ k, v }) }
  push('处理者', typeof d.processorIdentityAndContact === 'string' ? label(d.processorIdentityAndContact) : '')
  push('处理目的与方式', joinCodes(d.processingPurposeAndMethod))
  push('涉及数据', joinCodes(d.dataCategories))
  push('委托处理方', joinCodes(d.entrustedProcessingRoles))
  const r = d.retention
  if (r && typeof r === 'object') {
    const parts = []
    const hours = Number(r.maximumHours)
    if (Number.isFinite(hours) && hours > 0) parts.push(`最长 ${hours} 小时`)
    if (r.sessionDeletionFirst === true) parts.push('本次会话结束即删除')
    push('保留时长', parts.join('，'))
  }
  push('你的权利', joinCodes(d.dataSubjectRights))
  return rows
}

Page({
  data: {
    statusBarHeight: 20,
    step: 'pick',
    stages: STAGES,
    stageIdx: -1,
    waitedSec: 0,
    etaSec: 0,          // pick → consent → running → confirm → running → report
    // 页面上的格式说明直接取常量，避免文案和实际能选的扩展名各改各的。
    formatHint: FORMAT_HINT,
    types: [],
    contractType: '',
    filePath: '',
    fileName: '',          // 送给服务端落库的可读文件名，见 utils/upload-name.js
    // consent-scope 拆开后的展示字段（顶层没有 disclaimerVersion，版本在 disclaimer.version）
    scopeRows: [],
    consentVersion: '',
    disclaimerVersion: '',
    disclaimerText: '',
    sensitiveRequired: false,
    sensitiveNecessity: false,
    sensitiveAgreed: false,
    // 分析范围确认
    pages: null,
    okCoverage: false,
    okPersonal: false,
    reviewId: '',
    statusText: '',
    report: null,
    error: '',
    busy: false,
  },

  onLoad() {
    this.setData({ statusBarHeight: (getApp().globalData || {}).statusBarHeight || 20 })
    this._stopped = false
    this._scope = null     // consent-scope 原样返回，只在提交时读，不进 data
    this._pending = null   // 待确认的分析范围，必须与服务端逐字段相等
    if (!auth.isLoggedIn()) { this._toLogin(); return }
    this.setData({
      types: (api.CONTRACT_TYPES || []).map(v => ({ value: v, label: TYPE_LABELS[v] || v })),
    })
  },

  /**
   * 本页 6 个端点都按会员身份设计，未登录必然走不通，所以在入口就引导登录，
   * 而不是让用户拍完照、看完告知再撞 404。
   */
  _toLogin() {
    wx.redirectTo({
      url: `/pages/launch/launch?returnTo=${encodeURIComponent(SELF_ROUTE)}`,
      fail: () => wx.switchTab({ url: '/pages/home/home' }),
    })
  },

  onUnload() {
    // 停掉轮询链：不加这个标志，页面已经退出后 setTimeout 仍会继续跑，
    // 在别的页面上弹提示、对已销毁的页面 setData。
    this._stopped = true
    // 用户直接返回也视为放弃：合同不该留在服务端等自动清理
    if (this.data.reviewId && !this.data.report) this._discard()
  },

  back() { wx.navigateBack({ delta: 1 }) },

  pickType(e) { this.setData({ contractType: e.currentTarget.dataset.value, error: '' }) },

  /**
   * 原来只有 wx.chooseMedia 一条路径，等于要求「合同必须是纸的」。
   * 现实里劳动合同、offer、竞业协议多半本来就是电子版 PDF/DOCX，躺在微信聊天里；
   * 只给拍照就是逼用户把屏幕拍成照片再让 OCR 去猜——既多一道损耗，也更容易低置信度。
   * 补一条 wx.chooseMessageFile 路径（小程序没有直接调起手机文件管理器的能力，
   * 「微信聊天」是唯一可选已有文件的通道），后端 purpose=contract_upload 对来源无假设，
   * 不需要改服务端。
   */
  pickFile() {
    if (!this.data.contractType) { this.setData({ error: '请先选择合同类型' }); return }
    wx.showActionSheet({
      itemList: ['拍照或从相册选择', '从微信聊天中选择文件'],
      success: (res) => {
        if (res.tapIndex === 0) this._pickFromCamera()
        else this._pickFromChat()
      },
      fail: (err) => {
        if (isCancel(err)) return
        this.setData({ error: '无法打开选择菜单，请重试' })
      },
    })
  },

  _pickFromCamera() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['camera', 'album'],
      sizeType: ['original'],   // 合同要 OCR，压缩会吃掉小字
      success: (res) => {
        const f = (res.tempFiles || [])[0]
        if (!f || !f.tempFilePath) { this.setData({ error: '未取到照片，请重试' }); return }
        // 拍照/相册的临时文件叫 tmp_8a3f… 这类系统名，没有「原始文件名」可言，
        // 按来源和时间生成可读名不是伪造，是如实描述它是什么时候拍的。
        // 扩展名必须沿用真实临时文件的扩展名：后端既校验扩展名与 MIME 一致
        // （FILE_EXT_MISMATCH），又对真实字节做魔数校验（content-sniff.ts）。
        const ext = uploadNames.extOf(f.tempFilePath) || 'jpg'
        this._accept(f.tempFilePath, uploadNames.cameraFileName(ext), f.size)
      },
      fail: (err) => {
        if (isCancel(err)) return
        this.setData({ error: '无法打开相机或相册，请在微信设置里确认已允许访问' })
      },
    })
  },

  _pickFromChat() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: CHAT_FILE_EXTENSIONS,
      success: (res) => {
        const f = (res.tempFiles || [])[0]
        if (!f || !f.path) { this.setData({ error: '未取到文件，请重试' }); return }
        // f.name 才是用户在聊天里看到的真实文件名；f.path 是 tmp_xxx 临时名。
        // 提取阶段按「mimeType + 扩展名」配对判定，所以文件名必须原样带到服务端。
        const named = uploadNames.pickedFileName(f.name, f.path)
        const ext = uploadNames.extOf(named) || uploadNames.extOf(f.path)
        // extension 过滤在个别客户端/来源上不生效，这里按最终文件名再判一次：
        // 与其让用户等到上传 400 或提取阶段 CONTRACT_UNSUPPORTED_FILE_TYPE，
        // 不如当场说清楚不支持哪种格式。
        if (CHAT_FILE_EXTENSIONS.indexOf(ext) < 0) {
          this.setData({
            error: `暂不支持${ext ? ` .${ext} ` : '该'}格式，请选择 ${FORMAT_HINT}`,
          })
          return
        }
        this._accept(f.path, named, f.size)
      },
      fail: (err) => {
        if (isCancel(err)) return
        this.setData({ error: '无法打开微信聊天文件，请重试' })
      },
    })
  },

  /**
   * 选中文件后的统一入口。本地能判死的先判掉——超限和空文件不拦，
   * 用户会走完整个同意流程再撞上传失败，白填一遍。
   */
  _accept(filePath, fileName, sizeBytes) {
    const size = Number(sizeBytes)
    if (Number.isFinite(size) && size > MAX_UPLOAD_BYTES) {
      const mb = (size / 1024 / 1024).toFixed(1)
      this.setData({ error: `文件 ${mb}MB，超出 15MB 上限，请压缩后再传，或分次上传` })
      return
    }
    if (Number.isFinite(size) && size <= 0) {
      this.setData({ error: '这个文件是空的，请重新选择' })
      return
    }
    this.setData({ filePath, fileName, error: '' })
    this._loadScope()
  },

  /** 取同意范围。取不到就不往下走——没有它 create 必然 400，且用户也没被真正告知。 */
  _loadScope() {
    this._stopped = false   // discard() 停过一次轮询链后，重新发起要能继续
    this.setData({ busy: true, error: '' })
    api.getContractConsentScope()
      .then((scope) => {
        if (this._stopped) return
        const disclaimer = (scope && scope.disclaimer) || {}
        if (!scope || !scope.consentVersion || !scope.consentScopeHash || !disclaimer.version) {
          this.setData({ busy: false, error: '告知内容不完整，暂时无法开始，请稍后重试' })
          return
        }
        this._scope = scope
        const sensitive = (scope.disclosures && scope.disclosures.sensitivePersonalInformation) || null
        this.setData({
          scopeRows: buildScopeRows(scope.disclosures),
          consentVersion: scope.consentVersion,
          disclaimerVersion: disclaimer.version,
          disclaimerText: disclaimer.content || '',
          sensitiveRequired: !!(sensitive && sensitive.separateConsentRequired === true),
          sensitiveNecessity: !!(sensitive && sensitive.necessityAndImpactNoticeRequired === true),
          sensitiveAgreed: false,
          step: 'consent',
          busy: false,
        })
      })
      .catch(e => {
        if (this._stopped) return
        this.setData({ busy: false, error: e.message || '暂时无法获取告知内容，请稍后重试' })
      })
  },

  toggleSensitive() {
    this.setData({ sensitiveAgreed: !this.data.sensitiveAgreed, error: '' })
  },

  agree() {
    const { filePath, fileName, contractType, sensitiveRequired, sensitiveAgreed } = this.data
    const scope = this._scope
    if (!scope || this.data.busy) return
    if (sensitiveRequired && !sensitiveAgreed) {
      this.setData({ error: '请先单独确认同意处理合同中的敏感个人信息' })
      return
    }
    // 会话在停留期间过期（enduser JWT 30 分钟）：直接回登录，别让用户白跑一趟上传。
    if (!auth.isLoggedIn()) { this._toLogin(); return }

    this._stopped = false
    this.setData({ busy: true, step: 'running', statusText: '正在确认授权…', error: '' })

    this._ensureConsent(scope)
      .then(() => {
        if (this._stopped) return null
        this.setData({ statusText: '正在上传合同…' })
        return api.uploadContractFile(filePath, fileName)
      })
      .then((up) => {
        if (this._stopped || !up) return null
        const fileId = up.fileId || up.id
        if (!fileId) throw new Error('上传未返回文件标识')
        this.setData({ statusText: '正在创建审查任务…' })
        return api.createContractReview({
          sourceFileId:      fileId,
          contractType,
          consentVersion:    scope.consentVersion,
          consentedAt:       new Date().toISOString(),
          consentScopeHash:  scope.consentScopeHash,
          disclaimerVersion: scope.disclaimer.version,
        })
      })
      .then((r) => {
        if (this._stopped || !r) return null
        this.setData({ reviewId: r.id, statusText: '已上传，排队中…' })
        return this._poll(r.id)
      })
      .catch((e) => {
        if (this._stopped) return
        const msg = (e && e.message) || '提交失败，请重试'
        // 任务已经建出来才失败（多半是轮询断了）：必须删掉再回第一步，
        // 否则用户重试会再建一个任务，第一份合同留在服务端没人管。
        if (this.data.reviewId) { this._reset(msg); return }
        this.setData({ busy: false, step: 'consent', error: msg })
      })
  },

  /**
   * 会员路径必须在服务端留下 contract_review 授权事件（create 走
   * requireActiveConsentInTransaction），只在前端点同意会 403。
   * 且服务端要求授权时间不早于当前免责声明发布时间，所以 granted=true
   * 也可能不够——必须拿 grantedAt 与 disclaimer.publishedAt 比对。
   */
  _ensureConsent(scope) {
    const publishedAt = Date.parse((scope.disclaimer && scope.disclaimer.publishedAt) || '')
    return api.getMemberContractConsent().then((s) => {
      const grantedAt = Date.parse((s && s.grantedAt) || '')
      const fresh = !!(s && s.granted === true) &&
        Number.isFinite(grantedAt) && Number.isFinite(publishedAt) &&
        grantedAt >= publishedAt
      return fresh ? null : api.grantMemberContractConsent()
    })
  },

  /**
   * 轮询。status 取值以服务端 ContractReviewStatus 联合类型为准：
   *   uploaded / queued / extracting / awaiting_confirmation / rule_checking /
   *   ai_analyzing / safety_reviewing / completed / failed / cancelled / expired
   * 注意没有 'ready'。awaiting_confirmation 是必经的用户确认关口——
   * 服务端识别出页数后要用户确认分析范围，不确认就不会继续。
   * 结论也只在这里拿：completed 时 result.findings 即审查结果。
   */
  /**
   * 预计耗时：按识别页数推算，不写死常量。
   * 依据 2026-08-17 实测：单页合同文本调用 deepseek-v4-pro 约 13 秒，
   * 加排队与文字识别的固定开销。这是给用户的预期，不是硬上限——
   * 成败以服务端状态为准。
   */
  _estimate(pages) {
    const p = Number.isFinite(pages) && pages > 0 ? pages : 1
    return 20 + p * 15
  },

  _poll(id, tries = 0) {
    if (this._stopped) return Promise.resolve()
    // 上限随内容体量伸缩，不用常量。仍保留上限是因为：服务端若既不返回
    // completed 也不返回 failed，页面不能无限转圈——那时如实告知已超预期。
    const eta = this.data.etaSec || this._estimate(1)
    const maxTries = Math.ceil((eta * 4) / (POLL_MS / 1000))
    if (tries > maxTries) {
      // 放弃等待时一并删除：任务还在服务端跑，合同原件也还在，不能只丢掉页面状态。
      this._reset('分析用时超出预期，请稍后重新发起', true)
      return Promise.resolve()
    }
    return api.getContractReview(id).then(t => {
      if (this._stopped) return
      if (t.status === 'completed') return this._showResult(t)
      if (t.status === 'failed') {
        // 不替服务端猜原因。failed 可能来自：文件格式无法提取（如 .doc）、
        // OCR 置信度过低、AI provider 调用失败、安全网关拒绝等。
        // 一律说成「照片不清楚」会把用户引向错误的自救动作——反复重拍
        // 一份本来就没问题的文件。真实原因由服务端给，前端只负责如实转达。
        const why = t.failureReason || t.failureCode || t.message
          || (t.error && (t.error.message || t.error.code)) || ''
        this._reset(why
          ? `分析失败：${why}`
          : '分析失败。服务端已记录原因但当前未随任务返回，请把这次时间告知运维。', true)
        return
      }
      if (t.status === 'cancelled') { this._reset('任务已取消'); return }
      if (t.status === 'expired')   { this._reset('任务已过期，请重新发起'); return }
      if (t.status === 'awaiting_confirmation') return this._toConfirm(t)
      const idx = STAGE_INDEX[t.status]
      this.setData({
        statusText: STAGE_TEXT[t.status] || '正在处理…',
        stageIdx: idx === undefined ? this.data.stageIdx : idx,
        waitedSec: tries * 2,
      })
      return new Promise(r => setTimeout(r, POLL_MS)).then(() => this._poll(id, tries + 1))
    })
  },

  /**
   * 进入分析范围确认。截断时必须让用户知道只分析了前 N 页——
   * 直接替用户确认，等于把「只看了一部分」说成「全看了」。
   * 页数三个字段必须与服务端逐字段相等（assertConfirmation 的 matchesExtraction），
   * 所以原样带走，不做任何兜底填充。
   */
  _toConfirm(t) {
    this.setData({ etaSec: this._estimate(t.analyzedPages || t.totalPages || 1) })
    if (!Number.isSafeInteger(t.totalPages) || t.totalPages < 1) {
      // 页数对不上就无法通过服务端的 matchesExtraction 校验，这条任务走不下去了。
      this._reset('未能识别出合同页数，请换更清晰的照片或合同原始文件重试')
      return
    }
    this._pending = {
      id: t.id,
      contractType:  t.contractType,
      totalPages:    t.totalPages,
      analyzedPages: t.analyzedPages,
      truncated:     !!t.truncated,
    }
    this.setData({
      step: 'confirm',
      busy: false,
      okCoverage: false,
      okPersonal: false,
      pages: {
        total:     t.totalPages,
        analyzed:  t.analyzedPages,
        truncated: !!t.truncated,
        lowOcr:    t.ocrConfidence === 'low',
      },
    })
  },

  toggleOk(e) {
    const k = e.currentTarget.dataset.k
    if (k === 'coverage') this.setData({ okCoverage: !this.data.okCoverage, error: '' })
    else if (k === 'personal') this.setData({ okPersonal: !this.data.okPersonal, error: '' })
  },

  submitConfirm() {
    const p = this._pending
    if (!p || this.data.busy) return
    // ocrCoverageConfirmed / personalUseConfirmed 是服务端 @Equals(true) 的必填项。
    // 这两个值代表用户的确认，必须由用户真的勾选后才发 true。
    if (!this.data.okCoverage || !this.data.okPersonal) {
      this.setData({ error: '请先逐条确认后再继续' })
      return
    }
    this._stopped = false
    this.setData({ busy: true, step: 'running', statusText: '正在比对条款…', error: '' })
    api.confirmContractReview(p.id, {
      contractType:          p.contractType,
      totalPages:            p.totalPages,
      analyzedPages:         p.analyzedPages,
      truncated:             p.truncated,
      ocrCoverageConfirmed:  true,
      personalUseConfirmed:  true,
    })
      .then(() => this._poll(p.id))
      .catch((e) => {
        if (this._stopped) return
        this.setData({ busy: false, step: 'confirm', error: (e && e.message) || '确认失败，请重试' })
      })
  },

  /**
   * 展示结果。findings 只在轮询响应的 result 里，POST /:id/report 返回的是
   * 报告 PDF 的文件元数据（没有 findings），而且会删掉合同原文——不要去调它。
   */
  _showResult(t) {
    const r = t.result
    // 没拿到 result 就不能进结果页：空 findings 会被渲染成「未识别到需要提示的条款」，
    // 那是把「没拿到结果」说成「没有问题」。
    if (!r || !Array.isArray(r.findings)) {
      this._reset('未能取回审查结果，请稍后重新发起')
      return
    }
    const findings = r.findings.map(f => {
      const m = PRIORITY[f.priority] || { label: f.priority, cls: 'p2' }
      return Object.assign({}, f, { _label: m.label, _cls: m.cls })
    })
    this.setData({
      step: 'report',
      busy: false,
      report: {
        findings,
        priorityCheckCount:    Number(r.priorityCheckCount) || 0,
        attentionCount:        Number(r.attentionCount) || 0,
        insufficientInfoCount: Number(r.insufficientInfoCount) || 0,
        truncated:             r.coverage === 'truncated',
        lowOcr:                r.ocrConfidence === 'low',
        analyzed:              t.analyzedPages,
        total:                 t.totalPages,
        disclaimerVersion:     r.disclaimerVersion || '',
      },
    })
  },

  _discard() {
    const id = this.data.reviewId
    if (id) api.deleteContractReview(id).catch(() => { /* 放弃清理失败不打断返回 */ })
  },

  /**
   * 停轮询 + 回到第一步。message 非空时把原因留在页面上。
   *
   * keepTask=true 用于「分析失败」：此时不删服务端任务。
   * 原因是任务记录里存着 errorCode（服务端已正确写入 ContractReviewTask.errorCode），
   * 删掉它等于把「为什么失败」的唯一证据一并销毁——本轮排查就因此只剩一条历史记录。
   * 合同原件的清理由服务端保留策略负责（contract_upload 为 highly_sensitive，
   * 系统锁定短期过期），不依赖客户端删除，所以保留任务不会让原件多留。
   *
   * 用户主动放弃（取消 / 返回）仍然立即删除——那是用户的意思，且无排查价值。
   */
  _reset(message, keepTask) {
    this._stopped = true
    if (!keepTask) this._discard()
    this._pending = null
    this.setData({
      step: 'pick', reviewId: '', report: null, filePath: '', fileName: '', error: message || '',
      pages: null, okCoverage: false, okPersonal: false, sensitiveAgreed: false, busy: false,
    })
  },

  discard() { this._reset('') },
})
