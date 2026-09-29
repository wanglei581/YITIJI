const app = getApp()
const api = require('../../utils/api')

// 四类文档都由管理员后台「法务文档」发布，一体机与小程序读同一份（C1）。
// 标题只在服务端没给标题时兜底，类型表见 utils/api-legal-consent.js。
const TYPES = api.LEGAL_DOC_TITLES

// 「还没发布」不是出错：如实说没发布，并说清发布后这里会写什么。
const UNPUBLISHED_DESC = {
  terms_of_service: '正式版本发布之前，小程序暂时不能登录。不登录也可以看使用帮助和打印指引。',
  privacy_policy: '正式版本发布之前，小程序暂时不能登录。不登录也可以看使用帮助和打印指引。',
  ai_disclaimer: '发布后，这里会写明本服务用到的大模型名称与备案号，以及 AI 能做什么、不能做什么。',
  operator_info: '发布后，这里会写明经营者名称、证照信息和联系方式。',
}

// 章节标题的认法与一体机一致（apps/kiosk/src/pages/legal/legalDocModel.ts 的 headingOf）：
// Markdown 标题，或 30 字以内、不以标点结尾的「第X章 / 一、」式短行。两端读同一份后台正文，
// 认法不一样，同一份协议在两端就分成不同的章。
const ORDINAL_HEADING = /^(?:第[一二三四五六七八九十百零〇\d]+[章节条部分]|[一二三四五六七八九十]+、)/

function headingOf(line) {
  const markdown = line.match(/^#{1,6}\s+(.+)$/)
  if (markdown) return markdown[1].trim()
  if (line.length <= 30 && ORDINAL_HEADING.test(line) && !/[。；;，,]$/.test(line)) return line
  return ''
}

// 章节定位：其他页面链接到某一章（自我探索同意书 → 隐私政策「未成年人」专章）。
// 先按服务端随链接下发的章节标题找「标题包含它」的那一章（与一体机同一依据，律师改标题只改服务端）；
// 找不到再按语义锚点兜底；都找不到就从头显示，不报错。按标题认、不按第几章：后台调章节顺序也不会指错。
const ANCHOR_HEADINGS = {
  minors: /未成年/,
}

function anchorBlockKey(blocks, anchor, section) {
  const headings = blocks.filter(b => b.kind === 'heading')
  const bySection = section ? headings.find(b => b.text.indexOf(section) >= 0) : null
  if (bySection) return bySection.key
  const pattern = ANCHOR_HEADINGS[anchor]
  const byAnchor = pattern ? headings.find(b => pattern.test(b.text)) : null
  return byAnchor ? byAnchor.key : ''
}

// 页面参数可能仍是编码过的原样（小程序不保证替页面解码）；解不开就用原值。
function decodeParam(v) {
  if (typeof v !== 'string' || !v) return ''
  try { return decodeURIComponent(v) } catch (e) { return v }
}

function parseBlocks(content) {
  return String(content || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const heading = headingOf(line)
      if (heading) return { key: `h-${index}`, kind: 'heading', text: heading }
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
    // loading | ready | unpublished | error
    state: 'loading',
    error: '',
    unpublishedDesc: '',
  },

  onLoad(options) {
    const type = TYPES[options.type] ? options.type : 'terms_of_service'
    this._type = type
    this._anchor = options.anchor || ''
    this._section = decodeParam(options.section)
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      title: TYPES[type],
    })
    this.loadDoc()
  },

  loadDoc() {
    this.setData({ state: 'loading', error: '' })
    api.getLegalDocument(this._type)
      .then(doc => {
        const publishedAt = doc.publishedAt
          ? new Date(doc.publishedAt).toLocaleDateString('zh-CN')
          : ''
        const blocks = parseBlocks(doc.content)
        const anchorKey = anchorBlockKey(blocks, this._anchor, this._section)
        this.setData({
          title: doc.title || TYPES[this._type],
          version: doc.version || '',
          publishedAt,
          blocks,
          state: 'ready',
        }, () => {
          if (anchorKey) wx.pageScrollTo({ selector: `#${anchorKey}`, duration: 0 })
        })
      })
      .catch(err => {
        // 服务端还不认识这一类（旧版本没有「经营者信息」）同样是「还没发布」，不是加载失败。
        if (err && (err.code === 'LEGAL_DOC_UNAVAILABLE' || err.code === 'LEGAL_DOC_TYPE_INVALID')) {
          this.setData({ state: 'unpublished', unpublishedDesc: UNPUBLISHED_DESC[this._type] || '' })
          return
        }
        this.setData({
          state: 'error',
          error: (err && err.message) || '法律文档加载失败，请稍后重试',
        })
      })
  },

  back() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } })
  },
})
