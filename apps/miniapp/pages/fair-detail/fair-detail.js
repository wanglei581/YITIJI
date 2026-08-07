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
      status: 'active', // active | upcoming
      statusLabel: '进行中',
      title: '2026 深圳春季综合招聘会',
      org: '深圳市人力资源和社会保障局',
      time: '2026-07-25 09:00–17:00',
      format: '线下（现场招聘）',
      companyCount: '168 家',
      targetGroup: '应届生 / 社会人才',
      sourceOrg: '深圳市公共就业服务中心',
      externalId: 'FAIR-2026-041',
      syncTime: '2026-07-24 08:00',
      intro: '本次招聘会汇聚制造业、科技、服务等各类企业，现场提供就业咨询、简历打印等配套服务。',
      booths: [
        { zone: 'A', zoneClass: 'zone-a', name: '华为技术有限公司', pos: 'A-01' },
        { zone: 'B', zoneClass: 'zone-b', name: '比亚迪股份有限公司', pos: 'B-07' },
        { zone: 'C', zoneClass: 'zone-c', name: '腾讯科技（深圳）有限公司', pos: 'C-03' },
        { zone: 'S', zoneClass: 'zone-s', name: '招商银行股份有限公司', pos: 'S-02' },
      ],
      externalUrl: 'https://example.com/fair/041',
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

  tapFairMap() {
    // 场馆导览图在后续版本接入
    wx.showToast({ title: '场馆导览图将在后续版本上线', icon: 'none' });
  },

  tapScanBook() {
    wx.showToast({ title: '请对准屏幕上的二维码扫码预约', icon: 'none', duration: 2500 });
  },

  tapExternalBook() {
    const f = this.data.fair || {};
    history.recordJump('fair', { id: this.data.pageId, title: f.title || f.name, source: f.sourceOrg });
    wx.showToast({ title: '将跳转至来源平台，在来源平台完成预约', icon: 'none', duration: 2500 });
    // TODO: 打开 externalUrl
  },

  onShareAppMessage() {
    const f = this.data.fair || {};
    return {
      title: f.title || f.name || '招聘会详情',
      path: '/pages/fair-detail/fair-detail?id=' + this.data.pageId,
    };
  },
});
