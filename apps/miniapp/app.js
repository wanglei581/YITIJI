// app.js
const reminders = require('./utils/reminders');

App({
  globalData: {
    statusBarHeight: 20,
    navBarHeight: 44,
    menuButtonRect: null,
  },
  onLaunch() {
    try {
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const statusBarHeight = win.statusBarHeight || 20;
      this.globalData.statusBarHeight = statusBarHeight;

      // 胶囊按钮位置，用于自定义导航栏对齐
      if (wx.getMenuButtonBoundingClientRect) {
        const rect = wx.getMenuButtonBoundingClientRect();
        this.globalData.menuButtonRect = rect;
        // 导航栏高度 = 胶囊上下间距对称 + 胶囊高度
        this.globalData.navBarHeight =
          (rect.top - statusBarHeight) * 2 + rect.height;
      }
    } catch (e) {
      // 兜底：使用默认值
    }

    // 检查 24h 内有无即将开始的招聘会提醒，弹 Modal 提示
    try {
      const upcoming = reminders.getUpcoming();
      if (upcoming.length > 0) {
        const first = upcoming[0];
        const extra = upcoming.length > 1 ? `，还有 ${upcoming.length - 1} 场` : '';
        wx.showModal({
          title: '招聘会提醒',
          content: `「${first.title}」即将开始${extra}，记得准时参加！`,
          confirmText: '查看详情',
          cancelText: '知道了',
          success(res) {
            if (res.confirm) {
              wx.navigateTo({ url: `/pages/fair-detail/fair-detail?id=${first.id}` });
            }
          },
        });
      }
    } catch (_) {}
  },
});
