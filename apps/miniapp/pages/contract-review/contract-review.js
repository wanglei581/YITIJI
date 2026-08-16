// pages/contract-review/contract-review.js
// 合同审查。后端 services/api/src/contract-review 已实现完整闭环，此前小程序零引用。
//
// 合规要点（不要为了简化流程而绕过）：
//   1. create 必须回传 consent-scope 返回的 consentVersion / consentedAt /
//      consentScopeHash / disclaimerVersion，服务端据此校验用户看过当前版本告知。
//   2. 同意页展示的披露项一律取服务端返回值，不在前端硬编码——
//      硬编码会在服务端改版后悄悄变成「展示的和实际生效的不一致」。
//   3. 合同属敏感文件，用户中途放弃时主动 DELETE，不留到自动清理。
const api = require('../../utils/api')

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

Page({
  data: {
    step: 'pick',          // pick → consent → running → report
    types: [],
    contractType: '',
    filePath: '',
    scope: null,           // consent-scope 原样返回
    reviewId: '',
    statusText: '',
    report: null,
    error: '',
    busy: false,
  },

  onLoad() {
    this.setData({
      types: (api.CONTRACT_TYPES || []).map(v => ({ value: v, label: TYPE_LABELS[v] || v })),
    })
  },

  onUnload() {
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
    this.setData({ busy: true, error: '' })
    api.getContractConsentScope()
      .then(scope => this.setData({ scope, step: 'consent', busy: false }))
      .catch(e => this.setData({ busy: false, error: e.message || '暂时无法获取告知内容，请稍后重试' }))
  },

  agree() {
    const { scope, filePath, contractType } = this.data
    if (!scope) return
    this.setData({ busy: true, step: 'running', statusText: '正在上传合同…', error: '' })

    api.uploadPrintFile(filePath, 'contract.jpg')
      .then(up => {
        const fileId = up && (up.fileId || up.id)
        if (!fileId) throw new Error('上传未返回文件标识')
        this.setData({ statusText: '正在识别与分析…' })
        return api.createContractReview({
          sourceFileId:     fileId,
          contractType,
          consentVersion:   scope.consentVersion,
          consentedAt:      new Date().toISOString(),
          consentScopeHash: scope.consentScopeHash,
          disclaimerVersion: scope.disclaimerVersion,
        })
      })
      .then(r => { this.setData({ reviewId: r.id }); return this._poll(r.id) })
      .catch(e => this.setData({ busy: false, step: 'consent', error: e.message || '提交失败，请重试' }))
  },

  /**
   * 轮询。status 取值以服务端 ContractReviewStatus 联合类型为准：
   *   uploaded / queued / extracting / awaiting_confirmation / rule_checking /
   *   ai_analyzing / safety_reviewing / completed / failed / cancelled / expired
   * 注意没有 'ready'。awaiting_confirmation 是必经的用户确认关口——
   * 服务端识别出页数后要用户确认分析范围，不确认就不会继续，
   * 只轮询不 confirm 会一直卡在这个状态直到超时。
   */
  _poll(id, tries = 0) {
    if (tries > 60) { this.setData({ busy: false, error: '分析超时，请稍后重试' }); return }
    return api.getContractReview(id).then(t => {
      if (t.status === 'completed') return this._report(id)
      if (t.status === 'failed')    { this.setData({ busy: false, error: '分析失败，请重新上传更清晰的照片' }); return }
      if (t.status === 'cancelled') { this.setData({ busy: false, error: '任务已取消' }); return }
      if (t.status === 'expired')   { this.setData({ busy: false, error: '任务已过期，请重新发起' }); return }
      if (t.status === 'awaiting_confirmation') return this._askConfirm(t)
      this.setData({ statusText: STAGE_TEXT[t.status] || '正在处理…' })
      return new Promise(r => setTimeout(r, 2000)).then(() => this._poll(id, tries + 1))
    })
  },

  /**
   * 确认分析范围。截断时必须让用户知道只分析了前 N 页——
   * 直接替用户确认，等于把「只看了一部分」说成「全看了」。
   */
  _askConfirm(t) {
    const total = t.totalPages == null ? '未知' : t.totalPages
    const msg = t.truncated
      ? `共识别到 ${total} 页，本次只分析前 ${t.analyzedPages} 页。未分析的部分不会出现在结果里。`
      : `共识别到 ${total} 页，将全部分析。`
    return new Promise(resolve => {
      wx.showModal({
        title: '确认分析范围',
        content: msg + (t.ocrConfidence === 'low' ? '\n\n照片清晰度较低，建议重拍以提高准确性。' : ''),
        confirmText: '继续分析',
        cancelText: '取消',
        success: (r) => {
          if (!r.confirm) { this._discard(); this.setData({ busy: false, step: 'pick' }); resolve(); return }
          this.setData({ statusText: '正在分析条款…' })
          resolve(api.confirmContractReview(t.id, {
            contractType:  t.contractType,
            totalPages:    t.totalPages == null ? t.analyzedPages : t.totalPages,
            analyzedPages: t.analyzedPages,
            truncated:     t.truncated,
          }).then(() => this._poll(t.id)))
        },
      })
    })
  },

  _report(id) {
    return api.getContractReviewReport(id).then(report => {
      const findings = (report && report.findings ? report.findings : []).map(f => {
        const m = PRIORITY[f.priority] || { label: f.priority, cls: 'p2' }
        return Object.assign({}, f, { _label: m.label, _cls: m.cls })
      })
      this.setData({ report: Object.assign({}, report, { findings }), step: 'report', busy: false })
    })
  },

  _discard() {
    const id = this.data.reviewId
    if (id) api.deleteContractReview(id).catch(() => { /* 放弃清理失败不打断返回 */ })
  },

  discard() {
    this._discard()
    this.setData({ step: 'pick', reviewId: '', report: null, filePath: '', error: '' })
  },
})
