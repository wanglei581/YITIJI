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
    job: {
      title: '', salary: '', company: '', tags: [], sourceOrg: '', externalId: '',
      syncTime: '', externalUrl: '', duties: [], requirements: [],
    },
  },

  onLoad(opts) {
    const { statusBarHeight } = app.globalData;
    const id = (opts && opts.id) || '';
    // 提前用本机收藏初始化 faved,避免加载期间图标先显未收藏再闪成已收藏
    this.setData({ statusBarHeight: statusBarHeight || 20, pageId: id, faved: favorites.isFaved('job', id) });
    this.loadDetail(id);
  },

  onShow() {
    // navigateBack 只触发 onShow 不触发 onLoad;从收藏页取消后返回需重新同步 faved
    if (this.data.pageId && !this.data.loading && !this.data.loadError) {
      this.setData({ faved: favorites.isFaved('job', this.data.pageId) });
    }
  },

  loadDetail(id) {
    this.setData({ loading: true, loadError: '' });
    api.getJobDetail(id).then((job) => {
      this.setData({ job, loading: false, faved: favorites.isFaved('job', id) });
      // 真实拿到内容后才记录浏览，不记录 loading/错误态的空对象。
      history.recordView('job', { id, title: job.title, source: job.sourceOrg });
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
    const j = this.data.job || {};
    if (!id || this.data.loading || this.data.loadError) {
      wx.showToast({ title: '内容加载后可收藏', icon: 'none' });
      return;
    }
    // 只存列表渲染所需展示字段(§10 允许记录本人「收藏」;不涉及投递结果)
    const item = {
      id,
      initial: (j.title || '岗').slice(0, 1),
      title: j.title || '岗位',
      sub: j.company || '',
      salary: j.salary || '',
      tag: '',
      tagTone: '',
      tone: 'teal',
    };
    const faved = favorites.toggle('job', item);
    this.setData({ faved });
    wx.showToast({ title: faved ? '已收藏' : '已取消收藏', icon: 'none', duration: 1400 });
  },

  // 必须带上真实 jobId,否则 job-fit 只能退化成手填岗位,拿不到来源信息
  tapAiMatch() {
    const j = this.data.job || {};
    const id = this.data.pageId || j.id || '';
    if (!id) {
      wx.showToast({ title: '岗位信息不可用', icon: 'none' });
      return;
    }
    const title = encodeURIComponent(j.title || '');
    wx.navigateTo({ url: `/pages/job-fit/job-fit?jobId=${id}&jobTitle=${title}` });
  },

  tapExternalApply() {
    const j = this.data.job || {};
    if (this.data.loading || this.data.loadError || !j.externalUrl) {
      wx.showToast({ title: '来源链接暂不可用', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: j.externalUrl,
      success: () => history.recordJump('job', { id: this.data.pageId, title: j.title, source: j.sourceOrg }),
    });
  },

  onShareAppMessage() {
    return {
      title: (this.data.job && this.data.job.title) || '岗位详情',
      path: '/pages/job-detail/job-detail?id=' + this.data.pageId,
    };
  },
});
