const app = getApp();
const api = require('../../utils/api');
const history = require('../../utils/history');

Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    loadError: '',
    pageId: '',
    policy: {
      category: '就业补贴',
      title: '2026年深圳市高校毕业生就业补贴实施办法',
      org: '深圳市人力资源和社会保障局',
      date: '2026-01-15',
      syncTime: '2026-07-24 08:00',
      aiSummary: '本政策面向在深圳首次就业的应届高校毕业生，按学历层次提供一次性补贴，最高可领 6000 元，申领窗口截至 2026-12-31。',
      targetGroup: '在深圳市首次就业且签订 1 年以上劳动合同并缴纳社保的应届高校毕业生（毕业年度为 2026 年）。',
      subsidies: [
        { type: '专科毕业生', amount: '2000 元' },
        { type: '本科毕业生', amount: '3000 元' },
        { type: '硕士研究生', amount: '5000 元' },
        { type: '博士研究生', amount: '6000 元' },
      ],
      steps: [
        '在深圳就业并完成社保参保登记',
        '登录"深圳就业"小程序或前往就业服务窗口申报',
        '上传毕业证、劳动合同、社保缴纳记录',
        '审核通过后，补贴发放至本人银行账户',
      ],
      officialUrl: 'https://hrss.sz.gov.cn/notice/2026-001',
    },
  },

  onLoad(opts) {
    const { statusBarHeight } = app.globalData;
    const id = (opts && opts.id) || '';
    this.setData({ statusBarHeight: statusBarHeight || 20, pageId: id });
    this.loadDetail(id);
  },

  loadDetail(id) {
    this.setData({ loading: true, loadError: '' });
    api.getPolicyDetail(id).then((policy) => {
      this.setData({ policy, loading: false });
      history.recordView('policy', { id, title: policy.title, source: policy.org });
    }).catch((err) => {
      const msg = err && err.statusCode === 404 ? '未找到该内容，可能已下线' : (err && err.message) || '加载失败';
      this.setData({ loading: false, loadError: msg });
    });
  },

  reload() {
    this.loadDetail(this.data.pageId);
  },

  goBack() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } });
  },

  tapPrint() {
    // 合规:打印服务未接入,不得展示"已加入打印队列"成功态
    wx.showToast({ title: '打印服务待接入', icon: 'none' });
    // TODO: 接入打印服务
  },

  tapOfficial() {
    const p = this.data.policy || {};
    history.recordJump('policy', { id: this.data.pageId, title: p.title, source: p.org });
    wx.showToast({ title: '将跳转至官方原文', icon: 'none', duration: 2000 });
    // TODO: wx.openEmbeddedMiniProgram 或 webview
  },

  onShareAppMessage() {
    return {
      title: (this.data.policy && this.data.policy.title) || '政策详情',
      path: '/pages/policy-detail/policy-detail?id=' + this.data.pageId,
    };
  },
});
