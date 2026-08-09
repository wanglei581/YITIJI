;(function () {
  const sections = [
    { id: 'foundation', label: '入口与系统' },
    { id: 'print', label: '打印扫描' },
    { id: 'resume', label: '简历材料' },
    { id: 'jobs', label: '岗位企业' },
    { id: 'fairs', label: '招聘会校园' },
    { id: 'interview', label: '面试与政策' },
    { id: 'account', label: '我的' },
  ]

  const prototype = {
    sections,
    screens: [],
    add(screen) {
      this.screens.push({
        activeTab: 'home',
        task: '本次办理',
        taskKicker: '当前事项',
        taskStatus: '等待选择下一步',
        steps: [],
        boundary: '页面只表达可验证状态；动态数据必须来自真实接口或硬件上报。',
        helper: '关键动作由你确认后才会继续。',
        sections: [],
        rail: [],
        ...screen,
        id: String(screen.id).padStart(2, '0'),
      })
    },
    get(id) {
      return this.screens.find((screen) => screen.id === String(id).padStart(2, '0'))
    },
  }

  window.KioskPrototype = prototype
})()
