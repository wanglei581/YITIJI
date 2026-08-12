// pages/print/print.js
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    // 首期真实流程：本人文件 → 选终端 → 到机核验 → 机端支付与打印。
    steps: [
      { n: '1', label: '选择文件' },
      { n: '2', label: '选终端' },
      { n: '3', label: '到机完成' },
    ],
    paths: [
      { id: 'docs',     icon: 'folder',    accent: 'teal',  title: '从我的文档打印', badge: '推荐', desc: '只使用本人服务端真实文件，不用占位文件建单', flow: '选文档 → 选参数 → 选终端' },
      { id: 'usb',      icon: 'printer',   accent: 'slate', title: 'U盘打印指引', desc: '携带 U盘到一体机现场打印，查看操作步骤', flow: '插 U盘 → 一体机导入 → 出纸' },
      { id: 'bind',     icon: 'link',                       title: '扫码登录一体机', desc: '用微信扫描一体机屏幕上的二维码，快速完成手机与终端绑定', flow: '扫一体机二维码 → 手机确认 → 终端已登录' },
      { id: 'orders',   icon: 'history',   accent: 'clay',  title: '打印订单', desc: '查看本人服务端订单与真实打印状态', flow: '订单 → 状态 → 取件码' },
    ],
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  back() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/ai/ai' }) } })
  },

  tapPath(e) {
    const id = e.currentTarget.dataset.id
    const routes = {
      docs:   '/pages/documents/documents',
      usb:    '/pages/usb-import/usb-import',
      bind:   '/pages/kiosk-login/kiosk-login',
      orders: '/pages/orders/orders',
    }
    if (routes[id]) { wx.navigateTo({ url: routes[id] }); return }
  },

  tapScan() {
    wx.navigateTo({ url: '/pages/kiosk-login/kiosk-login' })
  },

  onShareAppMessage() {
    return {
      title: '在线打印 · 简历文档一键打印',
      path: '/pages/print/print',
    }
  },
})
