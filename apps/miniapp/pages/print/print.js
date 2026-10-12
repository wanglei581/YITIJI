// pages/print/print.js
const { SUPPORT_HINT } = require('../../utils/user-error')
const api = require('../../utils/api')
const { resolveSupportView, supportFields, callSupportPhone } = require('../../utils/support-contact')
const app = getApp()
const { AI_ENABLED } = require('../../utils/build-variant')
const aiEntries = require('../../utils/ai-entries')
const { syncTabBar } = require('../../utils/tab-bar-index')

// 底部「打印」Tab。原「求职」Tab 的位置在无人力资源服务许可证期间让给打印：
// 小程序首发按非招聘类目提审（compliance-boundary.md §1.1），线上下单、到机码、
// 订单与售后是小程序该承担的线上部分，一体机负责现场出纸。
function printPaths() {
  const head = [
    { id: 'docs',     icon: 'folder',    accent: 'teal',  title: '从我的文档打印', badge: '推荐', desc: '选已上传的简历或文档，设好参数后生成到机码', flow: '选文档 · 选参数 · 选终端' },
    { id: 'package',  icon: 'folder',    accent: 'clay',  title: '材料包', desc: '多份材料一次组包，拿到机码到终端打印', flow: '选材料 · 选服务点 · 拿到机码' },
    { id: 'orders',   icon: 'history',   accent: 'clay',  title: '打印订单', desc: '查看到机码和出纸状态', flow: '订单 · 状态 · 到机码' },
  ]
  const tail = [
    { id: 'bind',     icon: 'scan',      accent: 'teal',  title: '扫码登录一体机', desc: '用微信扫描一体机屏幕上的二维码，快速完成手机与终端绑定', flow: '扫一体机二维码 · 手机确认 · 终端已登录' },
    { id: 'usb',      icon: 'printer',   accent: 'slate', title: 'U盘打印指引', desc: '携带 U盘到一体机现场打印，查看操作步骤', flow: '插 U盘 · 一体机导入 · 出纸' },
  ]
  if (AI_ENABLED && aiEntries.printDailyPath) return head.concat([aiEntries.printDailyPath], tail)
  return head.concat(tail)
}

Page({
  data: {
    // 现场无人值守：需要帮助只有服务电话（utils/user-error.js SUPPORT_HINT）
    supportHint: SUPPORT_HINT,
    supportPhone: '',
    canCallPhone: false,
    supportHoursText: '',
    statusBarHeight: 20,
    // 首期真实流程：本人文件 → 选终端 → 到机核验 → 机端支付与打印。
    steps: [
      { n: '1', label: '选择文件' },
      { n: '2', label: '选终端' },
      { n: '3', label: '到机完成' },
    ],
    // 材料包、今日提醒原在「AI 工具」页的「到机器前办」一组，挪到这里后那一组删掉，
    // 同一个入口不在两个 Tab 各放一份。
    paths: printPaths(),
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    this._loadSupport()
  },

  _loadSupport() {
    if (this._supportOnce) return
    this._supportOnce = true
    if (typeof api.getSupportContact !== 'function') return
    let pending
    try { pending = api.getSupportContact() } catch (_) { return }
    if (!pending || typeof pending.then !== 'function') return
    pending.then((data) => {
      this.setData(supportFields(resolveSupportView(data)))
    }, () => {})
  },

  callSupport() { callSupportPhone(this.data.supportPhone) },

  onShow() {
    syncTabBar(this, '/pages/print/print')
  },

  tapPath(e) {
    const id = e.currentTarget.dataset.id
    const routes = {
      docs:    '/pages/documents/documents',
      package: '/pages/package-create/package-create',
      orders:  '/pages/orders/orders',
      daily:   aiEntries.dailyReportUrl,
      bind:    '/pages/kiosk-login/kiosk-login',
      usb:     '/pages/usb-import/usb-import',
    }
    if (!AI_ENABLED && id === 'daily') return
    if (!routes[id]) return
    wx.navigateTo({ url: routes[id] })
  },

  onShareAppMessage() {
    return {
      title: '在线打印 · 简历文档一键打印',
      path: '/pages/print/print',
    }
  },
})
