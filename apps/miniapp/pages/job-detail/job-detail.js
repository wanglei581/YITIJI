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
      title: '后端开发工程师（Node.js）',
      salary: '15k–25k',
      company: '某科技有限公司',
      tags: ['全职', '本科', '3–5年', '深圳·南山'],
      sourceOrg: '深圳市公共就业服务中心',
      externalId: 'JOB-2026-087634',
      syncTime: '2026-07-24 09:12',
      externalUrl: 'https://example.com/job/087634',
      duties: [
        '负责后端业务逻辑开发与接口设计',
        '参与系统架构设计与技术选型',
        '编写技术文档，保障代码质量',
        '配合前端与测试团队完成产品迭代',
      ],
      requirements: [
        '3年以上 Node.js 后端开发经验',
        '熟悉 PostgreSQL / MySQL / Redis',
        '有 NestJS / Express 框架经验优先',
        '本科及以上学历，计算机相关专业',
      ],
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
      // 真实拿到内容后才记录浏览(不记录 loading/错误态的默认 mock)
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

  tapAiMatch() {
    const j = this.data.job || {};
    const id = this.data.pageId || j.id || '';
    if (!id) {
      wx.showToast({ title: '岗位信息不可用', icon: 'none' });
      return;
    }
    // M1 接入岗位匹配前保持诚实提示
    wx.showToast({ title: '岗位匹配将在 M1 上线', icon: 'none' });
  },

  tapScanApply() {
    wx.showToast({ title: '请对准屏幕上的二维码扫码投递', icon: 'none', duration: 2500 });
  },

  tapExternalApply() {
    const j = this.data.job || {};
    // 只记录「打开了来源平台」这一跳转动作,投递结果在来源平台完成,本机不记录
    history.recordJump('job', { id: this.data.pageId, title: j.title, source: j.sourceOrg });
    wx.showToast({ title: '将跳转至来源平台，在来源平台完成投递', icon: 'none', duration: 2500 });
    // TODO: wx.openEmbeddedMiniProgram 或 打开 externalUrl
  },

  onShareAppMessage() {
    return {
      title: (this.data.job && this.data.job.title) || '岗位详情',
      path: '/pages/job-detail/job-detail?id=' + this.data.pageId,
    };
  },
});
