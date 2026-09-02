const app = getApp();

// 骨架：路由与四件套先落地，保证静态门禁在整批开发期间始终为绿。
// 真实实现由本批次对应负责人填入；在填入之前页面如实显示"正在接入"，不伪造内容。
Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    loadError: '',
    fairId: '',
  },

  onLoad(opts) {
    const { statusBarHeight } = app.globalData;
    this.setData({
      statusBarHeight: statusBarHeight || 20,
      fairId: (opts && opts.fairId) || '',
      loading: false,
    });
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },
});
