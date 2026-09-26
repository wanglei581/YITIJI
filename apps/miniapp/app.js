// app.js
App({
  globalData: {
    statusBarHeight: 20,
    navBarHeight: 44,
    menuButtonRect: null,
    // 自定义顶栏右侧内容需要的右让（px）。见 onLaunch 里的计算与实测依据。
    capsuleInsetRight: 94,
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
        // 胶囊右让：自定义顶栏放在胶囊那一行的右侧内容，必须让开这么多。
        // 2026-09-03 实测：home/me/assistant 三页的顶栏右侧按钮**整个落在胶囊矩形内**
        // （390pt 上胶囊 [296,383]，铃钮 [329,374]），用户点不到——
        // 而模拟器截图上看起来完全正常，因为胶囊是系统绘制的另一层。
        // 8px 是与胶囊的呼吸间距；胶囊位置随机型/系统版本变，所以必须运行时算，
        // 不能在 wxss 里写死一个 rpx 值。
        const info = wx.getWindowInfo ? wx.getWindowInfo() : { windowWidth: 375 };
        this.globalData.capsuleInsetRight =
          Math.max(0, Math.round((info.windowWidth || 375) - rect.left + 8));
      }
    } catch (e) {
      // 兜底：使用默认值
    }
    // 启动时的「招聘会提醒」弹窗已随招聘会页一起停放（首发按非招聘类目提审，
    // 见 docs/compliance/compliance-boundary.md §1.1）。取得人力资源服务许可证、
    // 通过求职/招聘类目后，与 pages/fair-reminders 一起恢复。
  },
});
