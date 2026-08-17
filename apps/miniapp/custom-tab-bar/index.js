Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/home/home', icon: 'home', text: '首页' },
      { pagePath: '/pages/ai/ai', icon: 'robot', text: '职业生活圈' },
      { pagePath: '/pages/jobs/jobs', icon: 'solution', text: '求职' },
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
