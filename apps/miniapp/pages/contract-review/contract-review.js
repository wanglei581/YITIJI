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

const SELF_ROUTE = '/pages/contract-review/contract-review'
const POLL_MS = 2000
const MAX_POLLS = 150   // 约 5 分钟；OCR + 规则 + 模型串行，比单次 AI 调用长得多

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
    step: 'pick',          // pick → consent → running → confirm → running → report
    types: [],
    contractType: '',
    filePath: '',
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

  pickType(e) { this.setData({ contractType: e.currentTarget.dataset.value, error: '' }) },

  pickFile() {
    if (!this.data.contractType) { this.setData({ error: '请先选择合同类型' }); return }
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['camera', 'album'],
      sizeType: ['original'],   // 合同要 OCR，压缩会吃掉小字
      success: (res) => {
        const f = (res.tempFiles || [])[0]
        if (!f || !f.tempFilePath) return
        this.setData({ filePath: f.tempFilePath })
        this._loadScope()
      },
    })
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
    const { filePath, contractType, sensitiveRequired, sensitiveAgreed } = this.data
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
        return api.uploadContractFile(filePath)
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
  _poll(id, tries = 0) {
    if (this._stopped) return Promise.resolve()
    if (tries > MAX_POLLS) {
      // 放弃等待时一并删除：任务还在服务端跑，合同原件也还在，不能只丢掉页面状态。
      this._reset('分析用时超出预期，已删除本次上传，请稍后重新发起')
      return Promise.resolve()
    }
    return api.getContractReview(id).then(t => {
      if (this._stopped) return
      if (t.status === 'completed') return this._showResult(t)
      if (t.status === 'failed')    { this._reset('分析失败，请重新上传更清晰的照片'); return }
      if (t.status === 'cancelled') { this._reset('任务已取消'); return }
      if (t.status === 'expired')   { this._reset('任务已过期，请重新发起'); return }
      if (t.status === 'awaiting_confirmation') return this._toConfirm(t)
      this.setData({ statusText: STAGE_TEXT[t.status] || '正在处理…' })
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
    if (!Number.isSafeInteger(t.totalPages) || t.totalPages < 1) {
      // 页数对不上就无法通过服务端的 matchesExtraction 校验，这条任务走不下去了。
      this._reset('未能识别出合同页数，请重新拍摄更清晰的照片')
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

  /** 停轮询 + 删服务端任务 + 回到第一步。message 非空时把原因留在页面上。 */
  _reset(message) {
    this._stopped = true
    this._discard()
    this._pending = null
    this.setData({
      step: 'pick', reviewId: '', report: null, filePath: '', error: message || '',
      pages: null, okCoverage: false, okPersonal: false, sensitiveAgreed: false, busy: false,
    })
  },

  discard() { this._reset('') },
})
