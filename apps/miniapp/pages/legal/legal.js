const app = getApp()
const api = require('../../utils/api')

const TYPES = {
  terms_of_service: '用户服务协议',
  privacy_policy: '隐私政策',
}

function parseBlocks(content) {
  return String(content || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const heading = line.match(/^#{1,6}\s+(.+)$/)
      if (heading) return { key: `h-${index}`, kind: 'heading', text: heading[1] }
      if (/^[-*]\s+/.test(line)) return { key: `b-${index}`, kind: 'bullet', text: line.replace(/^[-*]\s+/, '') }
      if (/^\d+[.)]\s+/.test(line)) return { key: `n-${index}`, kind: 'numbered', text: line }
      return { key: `p-${index}`, kind: 'paragraph', text: line }
    })
}

Page({
  data: {
    statusBarHeight: 20,
    title: '法律文档',
    version: '',
    publishedAt: '',
    blocks: [],
    loading: true,
    error: '',
  },

  onLoad(options) {
    const type = TYPES[options.type] ? options.type : 'terms_of_service'
    this._type = type
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      title: TYPES[type],
    })
    this.loadDoc()
  },

  loadDoc() {
    this.setData({ loading: true, error: '' })
    api.getLegalDocument(this._type)
      .then(doc => {
        const publishedAt = doc.publishedAt
          ? new Date(doc.publishedAt).toLocaleDateString('zh-CN')
          : ''
        this.setData({
          title: doc.title || TYPES[this._type],
          version: doc.version || '',
          publishedAt,
          blocks: parseBlocks(doc.content),
          loading: false,
        })
      })
      .catch(err => this.setData({
        loading: false,
        error: (err && err.message) || '法律文档加载失败，请稍后重试',
      }))
  },

  back() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },
})
