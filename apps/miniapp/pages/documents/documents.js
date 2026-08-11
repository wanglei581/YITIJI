// 本人文档：只展示服务端返回的真实元数据，不在小程序保存文件内容或伪造样例。
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')

function formatSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatExpiry(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `有效至 ${formatTime(value)}`
}

function toView(item) {
  const filename = item.filename || '未命名文件'
  const ext = filename.includes('.') ? filename.split('.').pop().slice(0, 5).toUpperCase() : 'FILE'
  const mime = String(item.mimeType || '')
  const kind = mime.startsWith('image/') ? 'img' : (mime === 'application/pdf' ? 'pdf' : 'doc')
  return {
    id: String(item.id || ''),
    name: filename,
    kind,
    ext,
    size: formatSize(item.sizeBytes),
    time: formatTime(item.createdAt),
    type: item.assetCategory || 'original',
    expire: formatExpiry(item.expiresAt),
    pages: Number(item.pageCount) > 0 ? Number(item.pageCount) : 0,
  }
}

Page({
  data: {
    statusBarHeight: 20,
    activeFilter: 'all',
    filters: [
      { key: 'all', label: '全部' },
      { key: 'original', label: '原始文件' },
      { key: 'optimized', label: '优化成果' },
      { key: 'derived', label: '派生成果' },
    ],
    all: [],
    filtered: [],
    loading: true,
    loadError: '',
    uploading: false,
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    if (!auth.isLoggedIn()) {
      wx.redirectTo({ url: '/pages/launch/launch' })
      return
    }
    this.loadDocuments()
  },

  loadDocuments() {
    this.setData({ loading: true, loadError: '' })
    api.getMyDocuments({ pageSize: 50 })
      .then((items) => {
        const all = (items || []).map(toView)
        this.setData({ all, loading: false })
        this.applyFilter(this.data.activeFilter, all)
      })
      .catch((err) => this.setData({
        loading: false,
        loadError: (err && err.message) || '加载文档失败，请稍后重试',
      }))
  },

  applyFilter(key, source) {
    const all = source || this.data.all
    this.setData({ filtered: key === 'all' ? all : all.filter((item) => item.type === key) })
  },

  setFilter(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ activeFilter: key })
    this.applyFilter(key)
  },

  openDoc(e) {
    const item = this.data.all.find((entry) => entry.id === String(e.currentTarget.dataset.id || ''))
    if (!item) return
    wx.navigateTo({
      url: `/pages/print-upload/print-upload?fileId=${encodeURIComponent(item.id)}&name=${encodeURIComponent(item.name)}&pages=${item.pages}`,
    })
  },

  more(e) {
    const id = String(e.currentTarget.dataset.id || '')
    const item = this.data.all.find((entry) => entry.id === id)
    if (!item) return
    wx.showActionSheet({
      itemList: ['发起打印', '删除文件'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.openDoc({ currentTarget: { dataset: { id } } })
          return
        }
        wx.showModal({
          title: '删除文件',
          content: `确认删除“${item.name}”？文件内容将被删除，系统仅保留必要的删除审计。`,
          confirmText: '删除',
          confirmColor: '#b5643c',
          success: (modal) => {
            if (!modal.confirm) return
            api.deleteMyDocument(id)
              .then(() => {
                wx.showToast({ title: '已删除', icon: 'success' })
                this.loadDocuments()
              })
              .catch((err) => wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' }))
          },
        })
      },
    })
  },

  upload() {
    if (this.data.uploading) return
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['pdf', 'jpg', 'jpeg', 'png'],
      success: (res) => {
        const file = (res.tempFiles || [])[0]
        if (!file || !file.path) return
        this.setData({ uploading: true })
        wx.showLoading({ title: '正在上传…', mask: true })
        api.uploadPrintFile(file.path)
          .then(() => {
            wx.hideLoading()
            this.setData({ uploading: false })
            wx.showToast({ title: '文件已上传', icon: 'success' })
            this.loadDocuments()
          })
          .catch((err) => {
            wx.hideLoading()
            this.setData({ uploading: false })
            wx.showModal({
              title: '上传失败',
              content: (err && err.message) || '网络异常，请稍后重试',
              showCancel: false,
            })
          })
      },
    })
  },
  back() { wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
