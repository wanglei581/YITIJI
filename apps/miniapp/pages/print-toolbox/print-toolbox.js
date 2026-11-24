// pages/print-toolbox/print-toolbox.js
// 求职材料轻工具箱：用途水印、正反合一 A4、证件照参考拼版。
// 仅调用已声明的 wx.chooseMedia，绝不调用未声明的相册写入接口；
// 图片在手机本地画布合成，用户主动点击「上传并去终端打印」后才上传为 print_doc。

const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const canvasMath = require('../../utils/material-canvas')
const {
  createLifecycleGuard,
  memberIdentityKey,
  isMemberIdentity,
} = require('../../utils/page-guard')
const { userErrorMessage } = require('../../utils/user-error')

const TOOLS = [
  { key: 'watermark', title: '用途水印',   sub: '给复印件加斜向用途说明' },
  { key: 'duplex',    title: '正反合一 A4', sub: '两面居中合进一页 A4' },
  { key: 'photo',     title: '证件照拼版', sub: '一寸 8 张 / 二寸 4 张' },
]

function loadCanvasImage(canvas, src) {
  return new Promise((resolve, reject) => {
    const img = canvas.createImage()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片读取失败，请重新选择'))
    img.src = src
  })
}

function queryCanvasNode(page) {
  return new Promise((resolve, reject) => {
    wx.createSelectorQuery()
      .in(page)
      .select('#matCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const node = res && res[0] && res[0].node
        if (!node) reject(new Error('画布初始化失败，请重试'))
        else resolve(node)
      })
  })
}

function exportCanvasJpg(canvas, width, height) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      width,
      height,
      destWidth: width,
      destHeight: height,
      fileType: 'jpg',
      quality: 0.92,
      success: (res) => {
        if (res && res.tempFilePath) resolve(res.tempFilePath)
        else reject(new Error('成品导出失败，请重试'))
      },
      fail: () => reject(new Error('成品导出失败，请重试')),
    })
  })
}

function drawWatermarkOverlay(ctx, width, height, rawText, opacityKey) {
  const spec = canvasMath.computeWatermarkSpec(width, height, rawText)
  if (!spec.text || !spec.points.length) return
  const alpha = canvasMath.alphaForOpacityKey(opacityKey)
  ctx.save()
  ctx.font = `600 ${spec.fontSize}px sans-serif`
  ctx.fillStyle = `rgba(17, 33, 28, ${alpha})`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  spec.points.forEach((pt) => {
    ctx.save()
    ctx.translate(pt.x, pt.y)
    ctx.rotate(spec.angleRad)
    ctx.fillText(spec.text, 0, 0)
    ctx.restore()
  })
  ctx.restore()
}

Page({
  data: {
    statusBarHeight: 20,
    tools: TOOLS,
    activeTool: 'watermark',
    watermarkPresets: canvasMath.WATERMARK_PRESETS,
    opacityLevels: canvasMath.OPACITY_LEVELS,
    photoModes: canvasMath.PHOTO_MODES,
    watermarkText: canvasMath.WATERMARK_PRESETS[0],
    opacityKey: 'std',
    duplexWatermarkOn: true,
    photoModeKey: 'one_inch',
    frontPath: '',
    backPath: '',
    previewPath: '',
    rendering: false,
    uploading: false,
    renderError: '',
  },

  onLoad() {
    this._guard = createLifecycleGuard()
    this.setData({
      statusBarHeight: (app && app.globalData && app.globalData.statusBarHeight) || 20,
    })
    if (typeof auth.subscribeSessionChange === 'function') {
      this._unsubSession = auth.subscribeSessionChange(() => {
        if (this._guard) this._guard.setIdentity(memberIdentityKey(auth))
        this._clearSensitivePreviews()
      })
    }
  },

  onShow() {
    this._guard.activate()
    const key = memberIdentityKey(auth)
    if (this._guard.setIdentity(key)) {
      this._clearSensitivePreviews()
    }
  },

  onHide() {
    this._guard.deactivate()
    if (this.data.rendering || this.data.uploading) {
      this.setData({ rendering: false, uploading: false })
    }
  },

  onUnload() {
    this._guard.deactivate()
    if (typeof this._unsubSession === 'function') {
      this._unsubSession()
      this._unsubSession = null
    }
    this._clearSensitivePreviews()
  },

  _clearSensitivePreviews() {
    if (this._guard) {
      this._guard.issue('pick:front')
      this._guard.issue('pick:back')
      this._guard.issue('canvas')
      this._guard.issue('upload')
    }
    this.setData({
      frontPath: '',
      backPath: '',
      previewPath: '',
      rendering: false,
      uploading: false,
      renderError: '',
    })
  },

  goBack() {
    wx.navigateBack({
      fail() { wx.switchTab({ url: '/pages/print/print' }) },
    })
  },

  tapTool(e) {
    const key = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || ''
    if (!key || key === this.data.activeTool) return
    this._guard.issue('canvas')
    this.setData({
      activeTool: key,
      previewPath: '',
      renderError: '',
      rendering: false,
    }, () => {
      if (this._canRender()) this._renderPreview()
    })
  },

  tapWatermarkPreset(e) {
    const text = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.text) || ''
    this.setData({ watermarkText: canvasMath.sanitizeWatermarkText(text) }, () => {
      if (this._canRender()) this._renderPreview()
    })
  },

  onWatermarkInput(e) {
    const val = canvasMath.sanitizeWatermarkText(e && e.detail && e.detail.value)
    if (val === this.data.watermarkText) return
    if (this._guard) this._guard.issue('canvas')
    this.setData({ watermarkText: val, previewPath: '', rendering: false, renderError: '' })
  },

  onWatermarkBlur() {
    if (this._canRender()) this._renderPreview()
  },

  tapOpacity(e) {
    const key = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || 'std'
    if (key === this.data.opacityKey) return
    this.setData({ opacityKey: key }, () => {
      if (this._canRender()) this._renderPreview()
    })
  },

  toggleDuplexWatermark() {
    this.setData({ duplexWatermarkOn: !this.data.duplexWatermarkOn }, () => {
      if (this._canRender()) this._renderPreview()
    })
  },

  tapPhotoMode(e) {
    const key = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || 'one_inch'
    if (key === this.data.photoModeKey) return
    this.setData({ photoModeKey: key }, () => {
      if (this._canRender()) this._renderPreview()
    })
  },

  chooseSlot(e) {
    const slot = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.slot) || 'front'
    if (this.data.uploading) return
    const token = this._guard.issue(`pick:${slot}`)
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['original', 'compressed'],
      success: (res) => {
        if (!this._guard.accepts(token, memberIdentityKey(auth))) return
        const file = res && res.tempFiles && res.tempFiles[0]
        const path = file && file.tempFilePath
        if (!path) return
        const patch = slot === 'back'
          ? { backPath: path, renderError: '' }
          : { frontPath: path, renderError: '' }
        this.setData(patch, () => {
          if (this._canRender()) this._renderPreview()
        })
      },
      fail: (err) => {
        if (!this._guard.accepts(token, memberIdentityKey(auth))) return
        const msg = String((err && err.errMsg) || '')
        if (msg.includes('cancel')) return
        wx.showToast({ title: '未能读取选中的图片，请重试', icon: 'none' })
      },
    })
  },

  tapClearImages() {
    this._clearSensitivePreviews()
  },

  _canRender() {
    if (this.data.activeTool === 'duplex') {
      return Boolean(this.data.frontPath && this.data.backPath)
    }
    return Boolean(this.data.frontPath)
  },

  tapRefreshPreview() {
    if (!this._canRender()) {
      wx.showToast({ title: this.data.activeTool === 'duplex' ? '请先选择正反两面图片' : '请先选择一张图片', icon: 'none' })
      return
    }
    this._renderPreview()
  },

  async _renderPreview() {
    if (!this._canRender()) return
    const token = this._guard.issue('canvas')
    this.setData({ rendering: true, previewPath: '', renderError: '' })
    try {
      const canvas = await queryCanvasNode(this)
      if (!this._guard.accepts(token, memberIdentityKey(auth))) return
      const ctx = canvas.getContext('2d')
      const tool = this.data.activeTool
      let outW = canvasMath.A4_WIDTH
      let outH = canvasMath.A4_HEIGHT

      if (tool === 'watermark') {
        const img = await loadCanvasImage(canvas, this.data.frontPath)
        if (!this._guard.accepts(token, memberIdentityKey(auth))) return
        const size = canvasMath.computeSingleCanvasSize(img.width, img.height)
        outW = size.width
        outH = size.height
        canvas.width = outW
        canvas.height = outH
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, outW, outH)
        ctx.drawImage(img, 0, 0, outW, outH)
        drawWatermarkOverlay(ctx, outW, outH, this.data.watermarkText, this.data.opacityKey)
      } else if (tool === 'duplex') {
        const slots = canvasMath.computeDuplexSlots()
        outW = slots.width
        outH = slots.height
        canvas.width = outW
        canvas.height = outH
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, outW, outH)
        const [frontImg, backImg] = await Promise.all([
          loadCanvasImage(canvas, this.data.frontPath),
          loadCanvasImage(canvas, this.data.backPath),
        ])
        if (!this._guard.accepts(token, memberIdentityKey(auth))) return
        const r1 = canvasMath.computeContainRect(frontImg.width, frontImg.height, slots.front.x, slots.front.y, slots.front.w, slots.front.h)
        const r2 = canvasMath.computeContainRect(backImg.width, backImg.height, slots.back.x, slots.back.y, slots.back.w, slots.back.h)
        ctx.drawImage(frontImg, r1.x, r1.y, r1.w, r1.h)
        ctx.drawImage(backImg, r2.x, r2.y, r2.w, r2.h)
        if (this.data.duplexWatermarkOn) {
          drawWatermarkOverlay(ctx, outW, outH, this.data.watermarkText, this.data.opacityKey)
        }
      } else {
        const grid = canvasMath.computePhotoGrid(this.data.photoModeKey)
        outW = grid.width
        outH = grid.height
        canvas.width = outW
        canvas.height = outH
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, outW, outH)
        const img = await loadCanvasImage(canvas, this.data.frontPath)
        if (!this._guard.accepts(token, memberIdentityKey(auth))) return
        ctx.strokeStyle = '#C9D3CE'
        ctx.lineWidth = 2
        grid.cells.forEach((cell) => {
          const crop = canvasMath.computeCoverCrop(img.width, img.height, cell.w, cell.h)
          ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, cell.x, cell.y, cell.w, cell.h)
          ctx.strokeRect(cell.x, cell.y, cell.w, cell.h)
        })
      }

      const tempFilePath = await exportCanvasJpg(canvas, outW, outH)
      if (!this._guard.accepts(token, memberIdentityKey(auth))) return
      this.setData({ previewPath: tempFilePath, rendering: false, renderError: '' })
    } catch (err) {
      if (!this._guard.accepts(token, memberIdentityKey(auth))) return
      this.setData({
        rendering: false,
        previewPath: '',
        renderError: (err && err.message) || '本地画布合成失败，请更换图片后重试',
      })
    }
  },

  tapPreviewFull() {
    if (!this.data.previewPath) return
    wx.previewImage({ urls: [this.data.previewPath], current: this.data.previewPath })
  },

  tapUploadToPrint() {
    if (this.data.uploading || this.data.rendering) return
    if (!this.data.previewPath || this.data.renderError) {
      wx.showToast({ title: '请先选择图片生成预览', icon: 'none' })
      return
    }
    const currentKey = memberIdentityKey(auth)
    if (!isMemberIdentity(currentKey)) {
      wx.showModal({
        title: '需要登录',
        content: '上传并进入打印流程需要登录本人账号，文件会归入你的「我的文档」。',
        confirmText: '去登录',
        cancelText: '稍后再说',
        success: (r) => {
          if (r && r.confirm) wx.navigateTo({ url: '/pages/launch/launch' })
        },
      })
      return
    }

    const displayName = canvasMath.safeExportFilename(this.data.activeTool, this.data.photoModeKey)
    const token = this._guard.issue('upload')
    this.setData({ uploading: true })
    wx.showLoading({ title: '正在上传至打印队列…', mask: true })

    return api.uploadPrintFile(this.data.previewPath, displayName).then((res) => {
      wx.hideLoading()
      if (!this._guard.accepts(token, memberIdentityKey(auth))) return
      this.setData({ uploading: false })
      const fileId = (res && (res.fileId || res.id)) || ''
      if (!fileId) {
        wx.showToast({ title: '服务端未返回文件编号，请重试', icon: 'none' })
        return
      }
      const finalName = (res && res.filename) || displayName
      const url = `/pages/print-upload/print-upload?fileId=${encodeURIComponent(fileId)}&name=${encodeURIComponent(finalName)}`
      wx.navigateTo({ url })
    }).catch((err) => {
      wx.hideLoading()
      if (!this._guard.accepts(token, memberIdentityKey(auth))) return
      this.setData({ uploading: false })
      wx.showToast({ title: userErrorMessage(err, '上传失败，请稍后重试'), icon: 'none', duration: 2500 })
    })
  },
})
