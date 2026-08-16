// pages/usb-import/usb-import.js  P16 U盘打印指引（纯指引页，无手机端硬件能力）
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    steps: [
      { n: '1', title: '插入 U盘', desc: '在一体机屏幕右下方 USB 接口插入你的 U盘，终端会自动识别。' },
      { n: '2', title: '选择「U盘导入」', desc: '在一体机首页点「打印扫描 → U盘导入」，浏览并勾选要打印的文件。' },
      { n: '3', title: '设置参数并打印', desc: '选择黑白/彩色、份数、单双面后确认，一体机直接出纸。' },
    ],
    formats: ['PDF', 'Word', 'JPG / PNG', 'TIFF', 'OFD', 'PDF/A'],
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
