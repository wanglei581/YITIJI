;(function (P) {
  /* ── 76 AI 方案确认（并入 13，保留映射） ───────────────── */
  P.add({
    id: 76,
    title: '办理方案确认',
    section: 'foundation',
    template: 'progress',
    kicker: 'AI 顾问',
    summary: '旧 76 方案确认已并入 AI 顾问任务板，本页保留映射。',
    goal: '方案确认与任务板合并，避免重复确认页。',
    action: '前往 AI 顾问',
    mapping: '功能并入 13 建议办理计划；编号 76 仅为兼容映射。',
    task: '办理方案',
    taskKicker: '流程映射',
    taskStatus: '已并入 AI 顾问',
    steps: [
      { label: '说清目标', done: true },
      { label: '确认计划', active: true },
      { label: '逐步办理' },
      { label: '结果沉淀' },
    ],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '前往 AI 顾问确认方案', to: '13', confirm: false },
    activeTab: 'advisor',
    sections: [
      {
        title: '映射说明',
        caption: '不新增重复页面',
        kind: 'notice',
        headless: true,
        tone: 'info',
        icon: 'git-merge',
        text: '方案确认作为 AI 顾问任务板的核心交互，每个步骤都可单独确认或调整。',
      },
    ],
  })

  /* ── 77 会话续接 ───────────────────────────────────────── */
  P.add({
    id: 77,
    title: '继续上次办理',
    section: 'foundation',
    template: 'state',
    kicker: '会话',
    summary: '检测到未完成的办理事项，可安全续接。',
    goal: '中断的办理可恢复，不丢上下文。',
    action: '继续或重新开始',
    mapping: '融合旧 77 会话续接；恢复使用安全会话机制，不写长期存储。',
    task: '继续上次办理',
    taskKicker: '会话恢复',
    taskStatus: '检测到 1 个未完成事项',
    steps: [],
    deviceState: '本机在线',
    deviceOk: true,
    primary: { label: '继续：打印简历 2 份', to: '03', confirm: false },
    secondary: { label: '重新开始', to: '01' },
    activeTab: 'home',
    sections: [
      {
        title: '未完成事项',
        caption: '仅本次会话',
        kind: 'checklist',
        headless: true,
        items: [
          { title: '打印 简历-2026-08.pdf · 2 份', text: '已设置参数，尚未支付', missing: false },
          { title: '简历优化建议稿', text: '已生成，尚未确认是否采用', missing: false },
        ],
      },
      {
        title: '隐私说明',
        caption: '公共终端',
        kind: 'notice',
        headless: true,
        tone: 'info',
        icon: 'shield-check',
        text: '续接仅恢复本次会话的安全状态；离场、超时或切换账号后自动清空。',
      },
    ],
  })

  /* ── 78 线上招聘平台 ───────────────────────────────────── */
  P.add({
    id: 78,
    title: '线上招聘平台',
    section: 'jobs',
    template: 'collection',
    kicker: '岗位信息',
    summary: '已审核的线上招聘平台入口，扫码前往。',
    goal: '来源平台入口清晰，离站前确认。',
    action: '选择平台前往',
    mapping: '融合旧 78 线上招聘平台；平台信息为第三方公开入口。',
    task: '线上招聘平台',
    taskKicker: '来源信息',
    taskStatus: '第三方平台入口',
    steps: [],
    deviceState: '内容服务正常',
    deviceOk: true,
    primary: { label: '扫码前往平台', to: '78', confirm: true, external: true, tone: 'source' },
    activeTab: 'home',
    sections: [
      {
        title: '平台列表',
        caption: '已审核来源',
        kind: 'rows',
        items: [
          { title: '腾讯招聘', text: '官方公开信息 · 岗位来源', to: '78', state: '扫码前往' },
          { title: '本地就业服务平台', text: '公共就业服务 · 官方来源', to: '78', state: '扫码前往' },
        ],
      },
      {
        title: '平台边界',
        caption: '合规说明',
        kind: 'notice',
        headless: true,
        tone: 'warn',
        icon: 'external-link',
        text: '前往来源平台前会显示离站确认；本终端不代投递、不记录投递结果。',
      },
    ],
  })
})(window.KioskPrototype)
