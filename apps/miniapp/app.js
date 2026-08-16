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
  },
});
