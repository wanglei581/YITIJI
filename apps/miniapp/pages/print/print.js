// pages/print/print.js
const app = getApp()

// 底部「打印」Tab。原「求职」Tab 的位置在无人力资源服务许可证期间让给打印：
// 小程序首发按非招聘类目提审（compliance-boundary.md §1.1），线上下单、到机码、
// 订单与售后是小程序该承担的线上部分，一体机负责现场出纸。
Page({
  data: {
    statusBarHeight: 20,
    // 首期真实流程：本人文件 → 选终端 → 到机核验 → 机端支付与打印。
    steps: [
      { n: '1', label: '选择文件' },
      { n: '2', label: '选终端' },
      { n: '3', label: '到机完成' },
    ],
    // 材料包、今日提醒原在「AI 工具」页的「到机器前办」一组，挪到这里后那一组删掉，
    // 同一个入口不在两个 Tab 各放一份。
    paths: [
      { id: 'docs',     icon: 'folder',    accent: 'teal',  title: '从我的文档打印', badge: '推荐', desc: '选已上传的简历或文档，设好参数后生成到机码', flow: '选文档 · 选参数 · 选终端' },
      { id: 'package',  icon: 'folder',    accent: 'clay',  title: '材料包', desc: '多份材料一次组包，到机器前付款打印', flow: '选材料 · 选服务点 · 拿到机码' },
      { id: 'orders',   icon: 'history',   accent: 'clay',  title: '打印订单', desc: '查看到机码和出纸状态', flow: '订单 · 状态 · 到机码' },
      { id: 'daily',    icon: 'file-text', accent: 'wheat', title: '今日提醒', desc: '即将过期的到机码和平台通知', flow: '登录后查看' },
      { id: 'bind',     icon: 'scan',      accent: 'teal',  title: '扫码登录一体机', desc: '用微信扫描一体机屏幕上的二维码，快速完成手机与终端绑定', flow: '扫一体机二维码 · 手机确认 · 终端已登录' },
      { id: 'usb',      icon: 'printer',   accent: 'slate', title: 'U盘打印指引', desc: '携带 U盘到一体机现场打印，查看操作步骤', flow: '插 U盘 · 一体机导入 · 出纸' },
    ],
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
  },

  tapPath(e) {
    const id = e.currentTarget.dataset.id
    const routes = {
      docs:    '/pages/documents/documents',
      package: '/pages/package-create/package-create',
      orders:  '/pages/orders/orders',
      daily:   '/pages/daily-report/daily-report',
      bind:    '/pages/kiosk-login/kiosk-login',
      usb:     '/pages/usb-import/usb-import',
    }
    if (routes[id]) wx.navigateTo({ url: routes[id] })
  },

  onShareAppMessage() {
    return {
      title: '在线打印 · 简历文档一键打印',
      path: '/pages/print/print',
    }
  },
})
