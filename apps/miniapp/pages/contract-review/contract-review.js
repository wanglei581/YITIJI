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

  /** 轮询到可出报告为止。失败不静默——用户需要知道是没结果还是没跑完。 */
  _poll(id, tries = 0) {
    if (tries > 40) { this.setData({ busy: false, error: '分析超时，请稍后在记录中查看' }); return }
    return api.getContractReview(id).then(r => {
      if (r.status === 'failed') { this.setData({ busy: false, error: r.message || '分析失败' }); return }
      if (r.status === 'ready' || r.status === 'completed') return this._report(id)
      this.setData({ statusText: r.statusText || '正在分析…' })
      return new Promise(res => setTimeout(res, 2000)).then(() => this._poll(id, tries + 1))
    })
  },

  _report(id) {
    return api.getContractReviewReport(id)
      .then(report => this.setData({ report, step: 'report', busy: false }))
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
