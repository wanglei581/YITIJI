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
      icon: 'file-text', label: '', accent: 'slate', title: '', summary: '', paragraphs: [],
      tag: '', tagTone: '', audience: '', publishedDate: '', sourceOrg: '', syncTime: '',
      externalUrl: '',
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
      // 后端对「不存在 / 未发布」返回 data:null（与 job-fairs/:id 同口径，
      // 不区分两者以免泄露未发布政策的存在性）。这里必须先判空：
      // 直接读 policy.title 会抛 TypeError 掉进 catch，把「已下线」显示成「加载失败」。
      if (!policy) {
        this.setData({ loading: false, loadError: '未找到该政策，可能已下线' });
        return;
      }
      this.setData({ policy, loading: false });
      history.recordView('policy', { id, title: policy.title, source: policy.sourceOrg });
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

  tapOfficial() {
    const p = this.data.policy || {};
    if (this.data.loading || this.data.loadError || !p.externalUrl) {
      wx.showToast({ title: '官方原文链接暂不可用', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: p.externalUrl,
      success: () => history.recordJump('policy', { id: this.data.pageId, title: p.title, source: p.sourceOrg }),
    });
  },

  onShareAppMessage() {
    return {
      title: (this.data.policy && this.data.policy.title) || '政策详情',
      path: '/pages/policy-detail/policy-detail?id=' + this.data.pageId,
    };
  },
});
