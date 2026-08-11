const api = require('../../utils/api')
const pricing = require('../../utils/print-pricing')

Page({
  data: {
    statusBarHeight: 20,
    // 文件名/页数/大小由上游真实选择的文件带入(opts.name)。
    // 兜底不使用虚构人名，避免出现他人姓名这类 PII 占位。
    file: { name: '未选择文件', pages: 0, size: '—' },
    // 上游已在服务端生成的真实文件 id(如岗位匹配报告),为空表示还没有真实文件
    fileId: '',
    hasFile: false,
    hasPageCount: false,
    color: 'bw',
    duplex: 'single',
    copies: 1,
    priceStatus: 'loading', // loading | ready | unavailable
    priceError: '',
    priceCents: null,
    priceLabels: { bw: '读取中…', color: '读取中…' },
    total: '—'
  },
  onLoad(opts) {
    this.setData({ statusBarHeight: getApp().globalData.statusBarHeight || 20 });
    const o = opts || {};
    if (o.name) {
      this.setData({ 'file.name': decodeURIComponent(o.name) });
    }
    // 上游(如岗位匹配报告)已生成真实文件时会带 fileId + 真实页数,
    // 必须用真实页数,不能让下面的默认值 2 覆盖掉真实值。
    if (o.fileId) this.setData({ fileId: o.fileId, hasFile: true });
    const pages = parseInt(o.pages, 10);
    if (pages > 0) this.setData({ 'file.pages': pages, hasPageCount: true });
    this._loadPricing();
  },
  _loadPricing() {
    this.setData({ priceStatus: 'loading', priceError: '', total: '—' })
    api.getPrintPriceConfig()
      .then(raw => {
        const view = pricing.normalizePriceConfig(raw)
        this.setData({
          priceStatus: 'ready',
          priceCents: view.cents,
          priceLabels: view.labels,
        })
        this.calc()
      })
      .catch(err => {
        this.setData({
          priceStatus: 'unavailable',
          priceError: (err && err.message) || '价格暂不可用',
          priceCents: null,
          priceLabels: { bw: '价格暂不可用', color: '价格暂不可用' },
          total: '—',
        })
      })
  },
  calc() {
    const { color, copies, file, priceCents, priceStatus } = this.data;
    if (priceStatus !== 'ready' || !this.data.hasPageCount) {
      this.setData({ total: '—' });
      return;
    }
    const total = pricing.estimateText(priceCents, color, file.pages, copies);
    this.setData({ total });
  },
  pickColor(e) {
    this.setData({ color: e.currentTarget.dataset.v });
    this.calc();
  },
  pickDuplex(e) {
    this.setData({ duplex: e.currentTarget.dataset.v });
  },
  minus() {
    if (this.data.copies > 1) {
      this.setData({ copies: this.data.copies - 1 });
      this.calc();
    }
  },
  plus() {
    if (this.data.copies < 99) {
      this.setData({ copies: this.data.copies + 1 });
      this.calc();
    }
  },
  preview() {
    const { color, duplex, copies, total, file, fileId } = this.data;
    if (!fileId) {
      wx.showToast({ title: '请先从“我的文档”选择真实文件', icon: 'none' });
      return;
    }
    if (!this.data.hasPageCount) {
      wx.showToast({ title: '服务端尚未返回文件页数', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages/print-preview/print-preview?fileId=${encodeURIComponent(fileId)}&color=${color}&duplex=${duplex}&copies=${copies}&total=${total}&pages=${file.pages}&name=${encodeURIComponent(file.name)}`
    });
  },
  tapFile() {
    if (this.data.hasFile) this.preview();
    else this.chooseSource();
  },
  chooseSource() {
    wx.navigateTo({ url: '/pages/documents/documents' });
  },
  toStore() {
    if (this.data.priceStatus !== 'ready') {
      wx.showToast({ title: this.data.priceStatus === 'loading' ? '正在读取价目' : '价格暂不可用，请稍后重试', icon: 'none' });
      return;
    }
    if (!this.data.fileId) {
      wx.showModal({
        title: '尚未选择文件',
        content: '本版本只允许从本人已上传文档或真实 AI 成果进入打印，不能用占位文件建单。',
        confirmText: '选择文档',
        success: (res) => { if (res.confirm) this.chooseSource(); },
      });
      return;
    }
    if (!this.data.hasPageCount) {
      wx.showModal({
        title: '暂时无法估价',
        content: '当前文档接口尚未返回可信页数。本版本不会把未知页数按 0 页计价，请在终端现场导入，或选择已生成页数的 AI 报告。',
        showCancel: false,
      });
      return;
    }
    const { color, duplex, copies, total, file, fileId } = this.data;
    wx.navigateTo({
      url: `/pages/print-store/print-store?fileId=${encodeURIComponent(fileId)}&color=${color}&duplex=${duplex}&copies=${copies}&total=${total}&pages=${file.pages}&name=${encodeURIComponent(file.name)}`
    });
  },
  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }); }
});
