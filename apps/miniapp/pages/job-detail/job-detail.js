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
    // 先用同步的保守值渲染（本机收藏或已热的服务端缓存），再由 _syncFaved 用账号
    // 数据纠正。同步值只会「少显示已收藏」，不会凭空显示成已收藏。
    this.setData({ statusBarHeight: statusBarHeight || 20, pageId: id, faved: favorites.isFaved('job', id) });
    if (!id) {
      // 深链 / 分享进来没带 id：不发空参请求，直接给可读提示（codex 第 17 轮审出）。
      this.setData({ loading: false, loadError: '缺少内容参数，请从列表页进入' });
      return;
    }
    this._syncFaved();
    this.loadDetail(id);
  },

  onShow() {
    // navigateBack 只触发 onShow 不触发 onLoad;从收藏页取消后返回需重新同步 faved
    this._syncFaved();
  },

  // 以账号为准回填收藏状态。读取失败时保留当前值——宁可显示旧状态，也不谎报"未收藏"。
  _syncFaved() {
    const id = this.data.pageId;
    if (!id) return;
    favorites.resolveFaved('job', id)
      .then((faved) => { if (this.data.pageId === id) this.setData({ faved }); })
      .catch(() => {});
  },

  loadDetail(id) {
    this.setData({ loading: true, loadError: '' });
    api.getJobDetail(id).then((job) => {
      // 后端对「不存在 / 未发布」返回 data:null（与 policy-detail 同口径）：不判空会 TypeError 掉进 catch，
      // 把原始 JS 错误文案显示给用户（第 17 轮真调复现）。
      if (!job) {
        this.setData({ loading: false, loadError: '未找到该内容，可能已下线' });
        return;
      }
      this.setData({ job, loading: false });
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
    if (this._favBusy) return;
    // 只存列表渲染所需展示字段(§10 允许记录本人「收藏」;不涉及投递结果)。
    // 登录态下这些字段只用于未登录降级视图——服务端收藏只保存 targetId + 标题快照。
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
    this._favBusy = true;
    favorites.toggle('job', item).then((res) => {
      this._favBusy = false;
      this.setData({ faved: res.faved });
      const title = res.hint || (res.faved ? '已收藏' : '已取消收藏');
      wx.showToast({ title, icon: 'none', duration: res.hint ? 1800 : 1400 });
    }).catch((err) => {
      // 服务端写入失败就保持原状态，不假装收藏成功
      this._favBusy = false;
      wx.showToast({ title: (err && err.message) || '收藏失败，请稍后重试', icon: 'none', duration: 1800 });
    });
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
