const app = getApp();
const api = require('../../utils/api');
const history = require('../../utils/history');
const favorites = require('../../utils/favorites');
const reminders = require('../../utils/reminders');

Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    loadError: '',
    pageId: '',
    faved: false,
    reminded: false,
    fair: {
      title: '', description: '', organizer: '', venue: '', city: '', theme: '',
      startTime: '', endTime: '', tag: '', tagTone: '', boothCount: null, jobCount: null,
      expectedAttendance: null, trafficInfo: '', sourceOrg: '', externalId: '', syncTime: '',
      externalUrl: '', dataSourceNote: '', hasManagedData: false,
    },
  },

  onLoad(opts) {
    const { statusBarHeight } = app.globalData;
    const id = (opts && opts.id) || '';
    // 先用同步的保守值渲染（本机收藏或已热的服务端缓存），再由 _syncFaved 用账号
    // 数据纠正。同步值只会「少显示已收藏」，不会凭空显示成已收藏。
    this.setData({ statusBarHeight: statusBarHeight || 20, pageId: id, faved: favorites.isFaved('fair', id), reminded: reminders.isSet(id) });
    this._syncFaved();
    this.loadDetail(id);
  },

  onShow() {
    // navigateBack 只触发 onShow 不触发 onLoad;从收藏页取消后返回需重新同步 faved/reminded
    this._syncFaved();
    if (this.data.pageId) this.setData({ reminded: reminders.isSet(this.data.pageId) });
  },

  // 以账号为准回填收藏状态。读取失败时保留当前值——宁可显示旧状态，也不谎报"未收藏"。
  _syncFaved() {
    const id = this.data.pageId;
    if (!id) return;
    favorites.resolveFaved('fair', id)
      .then((faved) => { if (this.data.pageId === id) this.setData({ faved }); })
      .catch(() => {});
  },

  loadDetail(id) {
    this.setData({ loading: true, loadError: '' });
    api.getFairDetail(id).then((fair) => {
      this.setData({ fair, loading: false, reminded: reminders.isSet(id) });
      history.recordView('fair', { id, title: fair.title || fair.name, source: fair.sourceOrg });
    }).catch((err) => {
      const msg = err && err.statusCode === 404 ? '未找到该内容，可能已下线' : (err && err.message) || '加载失败';
      this.setData({ loading: false, loadError: msg });
    });
  },

  reload() {
    this.loadDetail(this.data.pageId);
  },

  // 现场助手四个入口。fairId 是这四页的必需参数,取不到就不跳——
  // 与其跳进去让下游页面报「缺少招聘会参数」,不如在这里就不给点。
  _openFairPage(page) {
    const id = this.data.pageId
    if (!id) return
    wx.navigateTo({ url: `/pages/${page}/${page}?fairId=${encodeURIComponent(id)}` })
  },
  tapVenue()     { this._openFairPage('fair-venue') },
  tapCompanies() { this._openFairPage('fair-companies') },
  tapMaterials() { this._openFairPage('fair-materials') },
  tapVisitPlan() { this._openFairPage('fair-visit-plan') },

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
    if (this._favBusy) return;
    // 招聘会标题常带年份前缀,首字无辨识度,用固定类别字「会」。
    // 这些展示字段只用于未登录降级视图——服务端收藏只保存 targetId + 标题快照。
    const item = {
      id,
      initial: '会',
      title: f.title || f.name || '招聘会',
      sub: f.organizer || f.sourceOrg || '',
      salary: '',
      tag: f.tag || '',
      tagTone: '',
      tone: 'wheat',
    };
    this._favBusy = true;
    favorites.toggle('fair', item).then((res) => {
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

  tapRemind() {
    const id = this.data.pageId;
    const f = this.data.fair || {};
    if (!id || this.data.loading || this.data.loadError) {
      wx.showToast({ title: '内容加载后可设置提醒', icon: 'none' });
      return;
    }
    const nowSet = reminders.toggle({ id, title: f.title || '招聘会', startTime: f.startTime || '', venue: f.venue || '' });
    this.setData({ reminded: nowSet });
    wx.showToast({ title: nowSet ? '提醒已设置' : '提醒已取消', icon: 'none', duration: 1400 });
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
