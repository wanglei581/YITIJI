const app = getApp()
const api = require('../../utils/api')

// 后端 kiosk-upload 接受的简历类型。doc/docx 能上传,但能否抽出文本取决于后端解析器,
// 抽不出时后端会走 extractionNotice 告知,不在前端假设成功。
const RESUME_EXT = ['pdf', 'doc', 'docx']

Page({
  data: {
    statusBarHeight: 20,
    // 合规:简历库必须来自后端本人文件列表。后端暂无 C 端「我的简历」列表端点,
    // 保持为空并走已有空态,不填示例简历(旧数据还用了真实姓名,属 PII)。
    myResumes: [],
    uploading: false,
  },
  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },
  onShow() {},
  goBack() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },

  /** 从扩展名推断 fileFormat(后端必填字段,最长 20 字符)。 */
  _extOf(name) {
    const m = /\.([A-Za-z0-9]+)$/.exec(name || '')
    return m ? m[1].toLowerCase() : ''
  },

  /**
   * 上传到后端拿 fileId,再进解析页。
   * 上传成功≠解析成功,所以这里只提示"已上传",诊断结论由解析页/报告页给出。
   */
  _upload(filePath, fileName, purpose) {
    if (this.data.uploading) return
    this.setData({ uploading: true })
    wx.showLoading({ title: '正在上传…', mask: true })

    api.uploadResumeFile(filePath, purpose)
      .then((res) => {
        wx.hideLoading()
        this.setData({ uploading: false })
        const fileId = res && res.fileId
        if (!fileId) throw new Error('上传成功但未返回文件标识,请重试')

        // 后端文件约 30 分钟过期,必须立刻进入解析,不做中间停留
        const q = [
          `fileId=${encodeURIComponent(fileId)}`,
          `fileName=${encodeURIComponent(res.filename || fileName)}`,
          `fileFormat=${encodeURIComponent(this._extOf(res.filename || fileName))}`,
          `source=${purpose === 'resume_scan' ? 'scan' : 'upload'}`,
        ].join('&')
        wx.navigateTo({ url: `/pages/resume-parse/resume-parse?${q}` })
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ uploading: false })
        // 限流(20 次/60s)与体积超限都会走到这里,直接把后端原因说清楚
        wx.showModal({
          title: '上传失败',
          content: (err && err.message) || '网络异常,请稍后重试',
          showCancel: false,
          confirmText: '知道了',
        })
      })
  },

  // 上传来源
  tapUploadFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: RESUME_EXT,
      success: (res) => {
        const f = (res.tempFiles || [])[0]
        if (!f || !f.path) return
        const ext = this._extOf(f.name)
        if (RESUME_EXT.indexOf(ext) === -1) {
          wx.showToast({ title: '请选择 PDF 或 Word 文件', icon: 'none' })
          return
        }
        this._upload(f.path, f.name, 'resume_upload')
      },
      fail() {},
    })
  },
  tapCamera() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera'],
      success: (res) => {
        const f = (res.tempFiles || [])[0]
        if (!f || !f.tempFilePath) return
        // 拍照件走 resume_scan:后端按此 purpose 判定敏感级别并走 OCR 抽取
        const name = `resume-photo-${Date.now()}.jpg`
        this._upload(f.tempFilePath, name, 'resume_scan')
      },
      fail() {},
    })
  },
})
