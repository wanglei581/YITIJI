const app = getApp();
const api = require('../../utils/api');
const history = require('../../utils/history');
const favorites = require('../../utils/favorites');

Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    loadError: '',
    pageId: '',
    faved: false,
    fair: {
      status: '', statusText: '', statusLabel: '', title: '', name: '', org: '', host: '',
      time: '', date: '', format: '', companyCount: '', targetGroup: '', target: '',
      sourceOrg: '', externalId: '', syncTime: '', intro: '', booths: [], externalUrl: '',
    },
  },

  onLoad(opts) {
    const { statusBarHeight } = app.globalData;
    const id = (opts && opts.id) || '';
    // 提前用本机收藏初始化 faved,避免加载期间图标先显未收藏再闪成已收藏
    this.setData({ statusBarHeight: statusBarHeight || 20, pageId: id, faved: favorites.isFaved('fair', id) });
    this.loadDetail(id);
  },

  onShow() {
    // navigateBack 只触发 onShow 不触发 onLoad;从收藏页取消后返回需重新同步 faved
    if (this.data.pageId && !this.data.loading && !this.data.loadError) {
      this.setData({ faved: favorites.isFaved('fair', this.data.pageId) });
    }
  },

  loadDetail(id) {
    this.setData({ loading: true, loadError: '' });
    api.getFairDetail(id).then((fair) => {
      this.setData({ fair, loading: false, faved: favorites.isFaved('fair', id) });
      history.recordView('fair', { id, title: fair.title || fair.name, source: fair.sourceOrg });
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

  tapFav() {
    const id = this.data.pageId;
    const f = this.data.fair || {};
    if (!id || this.data.loading || this.data.loadError) {
      wx.showToast({ title: '内容加载后可收藏', icon: 'none' });
      return;
    }
    // 招聘会标题常带年份前缀,首字无辨识度,用固定类别字「会」
    const item = {
      id,
      initial: '会',
      title: f.title || f.name || '招聘会',
      sub: f.org || f.sourceOrg || '',
      salary: '',
      tag: f.statusLabel || '',
      tagTone: '',
      tone: 'wheat',
    };
    const faved = favorites.toggle('fair', item);
    this.setData({ faved });
    wx.showToast({ title: faved ? '已收藏' : '已取消收藏', icon: 'none', duration: 1400 });
  },

  tapExternalBook() {
    const f = this.data.fair || {};
    if (this.data.loading || this.data.loadError || !f.externalUrl) {
      wx.showToast({ title: '来源链接暂不可用', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: f.externalUrl,
      success: () => history.recordJump('fair', { id: this.data.pageId, title: f.title || f.name, source: f.sourceOrg }),
    });
  },

  onShareAppMessage() {
    const f = this.data.fair || {};
    return {
      title: f.title || f.name || '招聘会详情',
      path: '/pages/fair-detail/fair-detail?id=' + this.data.pageId,
    };
  },
});
