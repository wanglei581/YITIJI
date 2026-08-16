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
      category: '', title: '', org: '', date: '', syncTime: '', aiSummary: '',
      targetGroup: '', subsidies: [], steps: [], officialUrl: '',
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

  tapOfficial() {
    const p = this.data.policy || {};
    if (this.data.loading || this.data.loadError || !p.officialUrl) {
      wx.showToast({ title: '官方原文链接暂不可用', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: p.officialUrl,
      success: () => history.recordJump('policy', { id: this.data.pageId, title: p.title, source: p.org }),
    });
  },

  onShareAppMessage() {
    return {
      title: (this.data.policy && this.data.policy.title) || '政策详情',
      path: '/pages/policy-detail/policy-detail?id=' + this.data.pageId,
    };
  },
});
