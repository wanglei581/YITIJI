// pages/usb-import/usb-import.js  P16 U盘打印指引（纯指引页，无手机端硬件能力）
// 口径按一体机实际能力写（2026-10-06 核对）：
// - Terminal Agent 只列 U 盘最外层和下一层文件夹里的 .pdf/.jpg/.jpeg/.png，单份 ≤15MB
//   （apps/terminal-agent/src/usb/usb-files.ts；产品负责人 10/6 定「保留多读一层，文字统一改成只看最外层和下一层文件夹」）；
//   Word 不出现在 U 盘列表里，一体机提示「另存为 PDF」；TIFF / OFD / PDF/A 不支持。
// - U 盘导入（usb_import）、彩色（color_print）、双面（duplex_print）都按终端逐台开通，默认关闭；
//   没开通时一体机显示「暂未开通」，彩色、双面会被改回黑白、单面。
// - 入口名以一体机为准：首页「打印扫描」→「U 盘导入打印」。
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    steps: [
      { n: '1', title: '准备文件', desc: '只能打印 PDF、JPG、PNG；Word 请先另存为 PDF。一体机只看 U 盘最外层和下一层文件夹，文件不要放得更深；单份不超过 15MB。' },
      { n: '2', title: '在一体机上打开「U 盘导入打印」', desc: '在一体机首页点「打印扫描」→「U 盘导入打印」，按屏幕提示插入 U 盘，终端会列出能打印的文件。' },
      { n: '3', title: '选文件、设参数、打印', desc: '勾选要打印的文件，设好份数后确认出纸。彩色、双面按每台机器开通，没开通的会显示「暂未开通」，只能黑白、单面打印。' },
    ],
    formats: ['PDF', 'JPG', 'PNG'],
    formatNote: 'Word（.doc / .docx）请先另存为 PDF 再放进 U 盘；TIFF、OFD 等其他格式在 U 盘导入里打不了。',
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
