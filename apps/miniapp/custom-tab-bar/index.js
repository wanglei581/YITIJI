Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/home/home', icon: 'home', text: '首页' },
      { pagePath: '/pages/ai/ai', icon: 'robot', text: 'AI 工具' },
      { pagePath: '/pages/print/print', icon: 'printer', text: '打印' },
      { pagePath: '/pages/me/me', icon: 'user', text: '我的' },
    ],
  },
  methods: {
    switchTab(e) {
      const idx = e.currentTarget.dataset.index;
      const path = this.data.list[idx].pagePath;
      wx.switchTab({ url: path });
    },
  },
});
