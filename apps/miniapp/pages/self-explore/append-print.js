// 自我探索结果页：把附录合并进本人 PDF 简历。
// 选择器留在本页，不跳「我的文档」，也不走 opener 事件通道。
const api = require('../../utils/api')
const auth = require('../../utils/auth')

const SELECTABLE_PURPOSES = ['resume_upload', 'resume_scan']
const RESUME_PAGE_SIZE = 50
const RESUME_PAGE_CAP = 10

function trimmed(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : ''
}

function isSelectableResume(item) {
  if (!item) return false
  const mime = String(item.mimeType || '').split(';')[0].trim().toLowerCase()
  return mime === 'application/pdf' && SELECTABLE_PURPOSES.indexOf(item.purpose) !== -1
}

function formatResumeTime(value) {
  if (value === null || value === undefined || value === '') return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function mapResumeOption(item) {
  const pages = Number(item.pageCount)
  return {
    id: String(item.id || ''),
    name: item.filename || item.originalFilename || '未命名简历',
    pages: pages > 0 ? pages : 0,
    time: formatResumeTime(item.createdAt),
  }
}

const methods = {
  onShow() {
    if (this.data.appendConfirmed && this.data.canManage && !this.data.appending) {
      this._loadResumeOptions()
    }
  },

  toggleAppendConfirmed() {
    if (!this.data.canManage || this.data.appending) return
    const next = !this.data.appendConfirmed
    if (next && !auth.isLoggedIn()) {
      wx.showModal({
        title: '请先登录',
        content: '选择本人简历需要登录后读取你的文档。登录后请返回本页继续操作。',
        confirmText: '去登录',
        success: (modal) => { if (modal.confirm) wx.navigateTo({ url: '/pages/launch/launch' }) },
      })
      return
    }
    this.setData({
      appendConfirmed: next,
      selectedResumeId: next ? this.data.selectedResumeId : '',
    })
    if (next) this._loadResumeOptions()
  },

  retryResumeOptions() {
    if (!this.data.canManage || !this.data.appendConfirmed || this.data.appending) return
    this._loadResumeOptions()
  },

  _loadResumeOptions() {
    if (this._resumeLoading) return
    this._resumeLoading = true
    this.setData({ resumePickerLoading: true, resumePickerError: '' })
    const collected = []
    let pagesLoaded = 0
    const loadPage = (cursor) => {
      pagesLoaded += 1
      return api.getMyDocuments({ pageSize: RESUME_PAGE_SIZE, ...(cursor ? { cursor } : {}) })
        .then((items) => {
          const page = items || []
          for (let i = 0; i < page.length; i += 1) {
            if (!isSelectableResume(page[i])) continue
            const option = mapResumeOption(page[i])
            if (option.id) collected.push(option)
          }
          const nextCursor = page.nextCursor
          if (nextCursor && pagesLoaded < RESUME_PAGE_CAP) return loadPage(nextCursor)
          return { truncated: Boolean(nextCursor) }
        })
    }
    loadPage(null)
      .then((meta) => {
        this._resumeLoading = false
        if (this._gone) return
        const options = collected.filter((item) => item && item.id)
        const selectedStillThere = options.some((item) => item.id === this.data.selectedResumeId)
        this.setData({
          resumePickerLoading: false,
          resumePickerError: '',
          resumeOptions: options,
          resumePickerTruncated: Boolean(meta && meta.truncated),
          selectedResumeId: selectedStillThere ? this.data.selectedResumeId : '',
        })
      })
      .catch((err) => {
        this._resumeLoading = false
        if (this._gone) return
        this.setData({
          resumePickerLoading: false,
          resumePickerError: (err && err.message) || '加载本人简历失败，请稍后重试',
          resumeOptions: [],
        })
      })
  },

  selectResumeForAppend(e) {
    if (!this.data.appendConfirmed || this.data.appending) return
    const id = trimmed(e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id)
    if (!id) return
    const found = (this.data.resumeOptions || []).some((item) => item.id === id)
    if (!found) return
    this.setData({ selectedResumeId: id })
  },

  goUploadResumeForAppend() {
    if (this.data.appending) return
    wx.navigateTo({ url: '/pages/resume-upload/resume-upload' })
  },

  confirmAppendToResume() {
    if (!this.data.canManage || this.data.appending) return
    if (!this.data.appendConfirmed) {
      wx.showToast({ title: '请先确认是否随简历带去', icon: 'none' })
      return
    }
    const id = trimmed(this.data.selectedResumeId)
    const file = (this.data.resumeOptions || []).find((item) => item.id === id)
    if (!file) {
      wx.showToast({ title: '请先选择一份本人 PDF 简历', icon: 'none' })
      return
    }
    this._appendToResume(file)
  },

  _appendToResume(file) {
    const resumeFileId = trimmed(file && file.id)
    if (!resumeFileId || !this.data.appendConfirmed || this.data.appending || !this.data.taskId) return
    this.setData({ appending: true })
    wx.showLoading({ title: '正在合并…', mask: true })
    api.appendSelfAssessmentToResume(this.data.taskId, resumeFileId, this._token)
      .then((res) => {
        wx.hideLoading()
        if (this._gone) return
        this.setData({ appending: false })
        const fileId = trimmed(res && res.fileId)
        if (!fileId) throw new Error('服务端未返回合并后的文件')
        const name = encodeURIComponent(trimmed(res && res.filename) || '简历-自我探索附录.pdf')
        const pages = (res && res.pageCount) || ''
        wx.navigateTo({ url: `/pages/print-upload/print-upload?name=${name}&fileId=${encodeURIComponent(fileId)}&pages=${pages}` })
      })
      .catch((err) => {
        wx.hideLoading()
        if (this._gone) return
        this.setData({ appending: false })
        wx.showModal({
          title: '合并失败',
          content: (err && err.message) || '请确认选择的是本人 PDF 简历后重试',
          showCancel: false,
          confirmText: '知道了',
        })
      })
  },
}

module.exports = {
  SELECTABLE_PURPOSES,
  isSelectableResume,
  mapResumeOption,
  methods,
}
