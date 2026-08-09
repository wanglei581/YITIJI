// app.js
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

      if (wx.getMenuButtonBoundingClientRect) {
        const rect = wx.getMenuButtonBoundingClientRect();
        this.globalData.menuButtonRect = rect;
        this.globalData.navBarHeight =
          (rect.top - statusBarHeight) * 2 + rect.height;
      }
    } catch (e) {
      // 兜底：使用默认值
    }
  },
});
