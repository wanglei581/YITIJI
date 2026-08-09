;(function (P) {
  /* ── 46 场馆导览 ───────────────────────────────────────── */
  P.add({
    id: 46,
    title: '场馆导览',
    section: 'fairs',
    template: 'workbench',
    kicker: '招聘会',
    summary: '场馆平面图、服务点与展位索引。',
    goal: '现场快速定位展位与服务点。',
    action: '查看平面图或服务点',
    mapping: '融合旧 46 场馆导览；平面图按真实场馆素材展示，不伪造定位。',
    task: '场馆导览',
    taskKicker: '2026 夏季综合招聘会',
    taskStatus: '平面图与服务点索引',
    steps: [],
    deviceState: '内容服务正常',
    deviceOk: true,
    primary: { label: '生成参会准备单', to: '48', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '场馆平面图',
        caption: '按主办方公布信息绘制',
        kind: 'photo',
        captionText: '平面图示意：A 区 1-60 号 · B 区 61-120 号 · C 区 121-200 号',
      },
      {
        title: '现场服务点',
        caption: '主办方公布信息',
        kind: 'checklist',
        headless: true,
        items: [
          { title: '综合服务台', text: '入口右侧 · 咨询与失物', missing: false },
          { title: '打印服务点', text: 'B 区入口旁 · 本机同款服务', missing: false },
          { title: '无障碍通道', text: '北门与东门 · 全程无台阶', missing: false },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'info',
        icon: 'map-pinned',
        text: '本机无实时定位能力时，只展示静态平面图，不显示「您在这里」。',
      },
      {
        kind: 'truth',
        text: '平面图与服务点以主办方公布信息为准；现场临时调整以现场公示为准。',
      },
    ],
  })

  /* ── 47 参会材料（并入 48 准备单，保留映射） ───────────── */
  P.add({
    id: 47,
    title: '参会材料',
    section: 'fairs',
    template: 'progress',
    kicker: '招聘会',
    summary: '旧 47 参会材料已并入参会准备单，本页保留映射。',
    goal: '材料清单与准备单统一入口。',
    action: '前往参会准备单',
    mapping: '功能并入 48；编号 47 仅为兼容映射。',
    task: '参会材料',
    taskKicker: '流程映射',
    taskStatus: '已并入参会准备单',
    steps: [],
    deviceState: '内容服务正常',
    deviceOk: true,
    primary: { label: '前往参会准备单', to: '48', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '映射说明',
        caption: '不新增重复页面',
        kind: 'notice',
        headless: true,
        tone: 'info',
        icon: 'git-merge',
        text: '活动资料与个人材料清单合并为「参会准备单」，避免两套入口。',
      },
    ],
  })

  /* ── 48 参会准备单：AI 整理 + 打印 ─────────────────────── */
  P.add({
    id: 48,
    title: '参会准备单',
    section: 'fairs',
    template: 'workbench',
    kicker: '招聘会',
    summary: '按你的目标生成材料清单，可预览并打印带走。',
    goal: '把「该带什么、先去哪」整理成可打印清单。',
    action: '确认清单并打印',
    mapping: '融合旧 47 参会材料 / 48 准备单；AI 只整理信息，来源文件不自动更新打印单。',
    task: '2026 夏季综合招聘会',
    taskKicker: '参会准备',
    taskStatus: '已按目标岗位整理，等待确认',
    steps: [
      { label: '选择场次', done: true },
      { label: '整理清单', active: true },
      { label: '确认打印' },
      { label: '取件' },
    ],
    deviceState: '打印机在线',
    deviceOk: true,
    primary: { label: '打印准备单（1 页）', to: '03', confirm: true },
    secondary: { label: '调整目标', to: '11' },
    helper: 'AI 只整理信息；清单内容由你确认后打印。',
    activeTab: 'home',
    sections: [
      {
        title: '准备单预览',
        caption: 'AI 整理 · 请核对',
        kind: 'document',
        fileName: '参会准备单-2026夏季综合招聘会.pdf',
        fileMeta: 'PDF · 1 页 · 预览稿',
        activePage: 0,
        pages: [1],
        body: '参会准备单 · 2026 夏季综合招聘会\n\n推荐携带\n1. 优化版简历 5 份（可先在本机打印）\n2. 身份证件\n3. 目标岗位清单：A12 / B08 / C03\n\n建议顺序\n1. 先到 A 区重点企业\n2. 综合服务台领取会场资料\n3. 离场前核对企业联系方式\n\n备注\nAI 只整理公开信息，不代投递、不代预约。',
      },
      {
        title: '来源说明',
        caption: '信息来源可追溯',
        kind: 'checklist',
        headless: true,
        items: [
          { title: '企业清单', text: '来源：招聘会主办方公布信息', missing: false },
          { title: '展位位置', text: '来源：场馆导览平面图', missing: false },
          { title: '个人目标', text: '你确认的目标岗位与简历', missing: false },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'info',
        icon: 'lightbulb',
        text: '来源文件更新不会自动改动已确认的准备单；如需更新请重新生成。',
      },
      {
        kind: 'truth',
        text: '准备单只整理信息；不代收简历、不记录投递结果。',
      },
    ],
  })

  /* ── 49 招聘会现场统计（脱敏） ─────────────────────────── */
  P.add({
    id: 49,
    title: '招聘会现场数据',
    section: 'fairs',
    template: 'detail',
    kicker: '招聘会',
    summary: '本机对场次的公开服务统计，不展示个人明细。',
    goal: '现场服务情况透明可见。',
    action: '查看统计',
    mapping: '融合旧 49 现场统计；只展示聚合统计，不展示个人明细。',
    task: '现场数据',
    taskKicker: '2026 夏季综合招聘会',
    taskStatus: '本机公开统计',
    steps: [],
    deviceState: '内容服务正常',
    deviceOk: true,
    activeTab: 'home',
    sections: [
      {
        title: '本机服务统计',
        caption: '聚合脱敏',
        kind: 'metrics',
        items: [
          ['招聘会详情浏览', '128'],
          ['活动资料打印', '46'],
          ['打开来源入口', '32'],
          ['参会准备单打印', '18'],
        ],
      },
      {
        title: '隐私说明',
        caption: '数据边界',
        kind: 'notice',
        headless: true,
        tone: 'info',
        icon: 'shield-check',
        text: '统计只展示聚合数字，不展示个人浏览、打印或投递明细。',
      },
    ],
  })

  /* ── 50 校园招聘专区 ───────────────────────────────────── */
  P.add({
    id: 50,
    title: '校园招聘专区',
    section: 'fairs',
    template: 'collection',
    kicker: '校园',
    summary: '本校与周边高校的招聘会与校招岗位，来源入口。',
    goal: '校园场景的招聘信息来源聚合。',
    action: '查看校招内容',
    mapping: '融合旧 50 校园招聘；校招仍是第三方/官方来源入口。',
    task: '校园招聘',
    taskKicker: '来源信息',
    taskStatus: '本校就业中心 · 官方公开信息',
    steps: [],
    deviceState: '内容服务正常',
    deviceOk: true,
    activeTab: 'home',
    sections: [
      {
        title: '校招内容',
        caption: '来源：本校就业中心',
        kind: 'rows',
        items: [
          { title: '校园双选会', text: '9 月 10 日 · 本校体育馆', to: '11', state: '可预约' },
          { title: '校招岗位', text: '面向 2027 届的校园招聘岗位', to: '08', state: '可查看' },
          { title: 'AI 参会准备', text: '为双选会生成材料清单', to: '48', state: '可办理' },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'warn',
        icon: 'external-link',
        text: '校招预约与投递都在来源平台完成；本终端不代收简历。',
      },
    ],
  })

  /* ── 51 智慧校园（后台开关控制） ───────────────────────── */
  P.add({
    id: 51,
    title: '智慧校园',
    section: 'fairs',
    template: 'collection',
    kicker: '校园',
    summary: '已开通的校园服务入口，按后台开关显示。',
    goal: '校园服务真实开通才显示，不配置不渲染。',
    action: '选择校园服务',
    mapping: '融合旧 51 智慧校园 / 69 迎新 / 70 新生洞察；开关由后台控制。',
    task: '智慧校园',
    taskKicker: '校园专区',
    taskStatus: '已开通服务 4 项',
    steps: [],
    deviceState: '内容服务正常',
    deviceOk: true,
    activeTab: 'home',
    sections: [
      {
        title: '已开通服务',
        caption: '后台配置',
        kind: 'rows',
        items: [
          { title: '迎新服务', text: '报到流程与办理指引', to: '52', state: '可查看' },
          { title: '校园卡办理指引', text: '办卡材料与地点', to: '52', state: '可查看' },
          { title: '校园招聘专区', text: '双选会与校招岗位', to: '50', state: '可查看' },
          { title: '校园大数据', text: '公开统计 · 不展示个人明细', to: '49', state: '可查看' },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'info',
        icon: 'settings',
        text: '智慧校园为后台开关控制的专区；未配置的模块整卡不渲染。',
      },
    ],
  })

  /* ── 52 校园服务办理指引 ───────────────────────────────── */
  P.add({
    id: 52,
    title: '校园卡办理指引',
    section: 'fairs',
    template: 'detail',
    kicker: '校园',
    summary: '办理材料、地点与流程，信息只读。',
    goal: '让用户知道带什么、去哪里办。',
    action: '查看指引',
    mapping: '融合旧 52 校园服务；指引信息按学校公布内容展示。',
    task: '校园服务',
    taskKicker: '智慧校园',
    taskStatus: '信息只读 · 按学校公布为准',
    steps: [],
    deviceState: '内容服务正常',
    deviceOk: true,
    activeTab: 'home',
    sections: [
      {
        title: '办理材料',
        caption: '按学校公布信息',
        kind: 'checklist',
        headless: true,
        items: [
          { title: '本人有效证件', text: '身份证或录取通知书', missing: false },
          { title: '录取或在读证明', text: '新生携带录取通知书', missing: false },
          { title: '办理地点', text: '学生事务中心 1 楼 3 号窗口', missing: false },
        ],
      },
      {
        title: '说明',
        caption: '数据边界',
        kind: 'notice',
        headless: true,
        tone: 'info',
        icon: 'landmark',
        text: '指引仅为信息展示；实际办理以学校窗口和最新通知为准。',
      },
    ],
  })

  /* ── 53 找企业 ─────────────────────────────────────────── */
  P.add({
    id: 53,
    title: '找企业',
    section: 'jobs',
    template: 'collection',
    kicker: '岗位信息',
    summary: '来源企业导览，可查看企业详情与其在招岗位。',
    goal: '按企业维度找岗位，不构成招聘平台。',
    action: '查看企业',
    mapping: '融合旧 53 找企业 / 54 企业详情；企业信息为来源公开数据。',
    task: '找企业',
    taskKicker: '来源信息',
    taskStatus: '来源企业 · 公开信息',
    steps: [],
    deviceState: '内容服务正常',
    deviceOk: true,
    activeTab: 'home',
    sections: [
      {
        title: '企业列表',
        caption: '来源公开数据',
        kind: 'rows',
        items: [
          { title: '某互联网公司', text: '12 个在招岗位 · 来源平台公开信息', to: '54', state: '查看' },
          { title: '某智能制造企业', text: '8 个在招岗位 · 来源平台公开信息', to: '54', state: '查看' },
          { title: '某咨询公司', text: '6 个在招岗位 · 来源平台公开信息', to: '54', state: '查看' },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'warn',
        icon: 'building-2',
        text: '企业展示定位为「来源企业导览」；不收简历、无平台内投递。',
      },
    ],
  })

  /* ── 54 企业详情 ───────────────────────────────────────── */
  P.add({
    id: 54,
    title: '某互联网公司',
    section: 'jobs',
    template: 'detail',
    kicker: '岗位信息',
    summary: '企业简介、在招岗位与来源说明。',
    goal: '了解企业与在招岗位，来源清晰。',
    action: '查看在招岗位',
    mapping: '融合旧 54 企业详情；岗位联动既有岗位详情。',
    task: '企业详情',
    taskKicker: '来源企业导览',
    taskStatus: '来源平台公开信息',
    steps: [],
    deviceState: '内容服务正常',
    deviceOk: true,
    primary: { label: '查看在招岗位', to: '08', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '企业简介',
        caption: '来源公开数据',
        kind: 'text',
        paragraphs: [
          '某互联网公司，业务覆盖内容社区与效率工具；在校招中开放产品、运营、设计与研发岗位。',
        ],
      },
      {
        title: '在招岗位',
        caption: '来源平台公开信息',
        kind: 'rows',
        items: [
          { title: '产品经理（校园招聘）', text: '深圳 · 来源平台', to: '09', state: '查看' },
          { title: '前端开发工程师', text: '深圳 · 来源平台', to: '09', state: '查看' },
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        text: '企业数据来自已审核的第三方或官方来源；本终端不建立企业端。',
      },
    ],
  })

  /* ── 55 岗位匹配参考 ───────────────────────────────────── */
  P.add({
    id: 55,
    title: '岗位匹配参考',
    section: 'jobs',
    template: 'detail',
    kicker: '岗位信息',
    summary: '对照岗位要求与简历内容，给出三档匹配参考。',
    goal: '让用户看懂匹配依据与差距，而不是一个分数。',
    action: '查看依据或继续优化',
    mapping: '融合旧 55 岗位匹配；只展示三档参考，不显示百分比或录用概率。',
    task: '岗位匹配参考',
    taskKicker: 'AI 简历服务',
    taskStatus: '参考结论：较高 · 仅供参考',
    steps: [
      { label: '选择岗位', done: true },
      { label: '对照分析', active: true },
      { label: '结果沉淀' },
    ],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '按此岗位优化简历', to: '07', confirm: false },
    secondary: { label: '查看岗位详情', to: '09' },
    activeTab: 'home',
    sections: [
      {
        title: '匹配结论',
        caption: '三档参考 · 不承诺录用',
        kind: 'metrics',
        items: [
          ['参考结论', '较高'],
          ['匹配依据', '3 项'],
          ['建议改进', '2 项'],
          ['有效期', '2026-08-14'],
        ],
      },
      {
        title: '匹配依据与差距',
        caption: '岗位原文要求 ↔ 简历证据',
        kind: 'checklist',
        headless: true,
        items: [
          { title: '产品实习经历', text: '简历有 1 段产品实习，与岗位要求对应', missing: false },
          { title: '工具技能', text: 'Axure / Figma 与岗位要求一致', missing: false },
          { title: '数据敏感度', text: '简历缺少可量化的数据成果', missing: true },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'warn',
        icon: 'scale',
        text: '匹配参考只基于简历原文与岗位原文，不展示百分比、录用概率或人格评分。',
      },
      {
        kind: 'truth',
        text: '结果保存到 AI 服务记录；可删除、可打印。',
      },
    ],
  })

  /* ── 56 职业规划 ───────────────────────────────────────── */
  P.add({
    id: 56,
    title: '职业规划',
    section: 'jobs',
    template: 'detail',
    kicker: 'AI 简历服务',
    summary: '基于现状生成规划建议单，可打印沉淀。',
    goal: '规划建议真实基于本人现状，可打印带走。',
    action: '查看或打印建议单',
    mapping: '融合旧 56 职业规划；建议单 PDF 进入我的文档。',
    task: '职业规划',
    taskKicker: 'AI 简历服务',
    taskStatus: '建议单已生成 · 已保存',
    steps: [],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '打印建议单', to: '03', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '规划建议',
        caption: 'AI 生成 · 仅供参考',
        kind: 'text',
        paragraphs: [
          '基于你的简历与岗位匹配情况，建议优先补齐「可量化的项目结果」，再以目标岗位关键词调整简历表达。',
          '未来 3-6 个月：完成 2 轮模拟面试训练，参加 1-2 场招聘会，沉淀 1 份可复用的材料包。',
        ],
      },
      {
        title: '依据说明',
        caption: '不编造现状',
        kind: 'checklist',
        headless: true,
        items: [
          { title: '依据：简历诊断', text: '2026-08-07 诊断报告', missing: false },
          { title: '依据：岗位匹配', text: '产品经理（校园招聘）匹配参考', missing: false },
          { title: '边界', text: '不承诺就业结果，不代投递', missing: false },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'ok',
        icon: 'database',
        text: '建议单已保存到我的文档与 AI 服务记录，可回看或打印。',
      },
    ],
  })

  /* ── 57 屏保 ───────────────────────────────────────────── */
  P.add({
    id: 57,
    title: '屏保',
    section: 'foundation',
    template: 'state',
    kicker: '系统',
    summary: '无人使用时自动进入屏保，点击任意位置唤醒。',
    goal: '公共终端闲时保护屏幕与隐私。',
    action: '点击唤醒',
    mapping: '融合旧 57 屏保；唤醒后回到安全首页，不残留上一位用户内容。',
    task: '系统状态',
    taskKicker: '公共终端',
    taskStatus: '空闲状态',
    steps: [],
    bottomNav: false,
    deviceState: '本机在线',
    deviceOk: true,
    primary: { label: '点击唤醒', to: '01', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '屏保',
        caption: '点击任意位置唤醒',
        kind: 'progress',
        symbol: '职',
        headline: '职易达 · 就业服务终端',
        text: '空闲时自动进入屏保；唤醒后回到首页，上次会话已按规则清理。',
        animate: false,
      },
    ],
  })

  /* ── 58 帮助中心 ───────────────────────────────────────── */
  P.add({
    id: 58,
    title: '帮助中心',
    section: 'foundation',
    template: 'collection',
    kicker: '帮助',
    summary: '常见问题与操作指引，覆盖已上线能力。',
    goal: '用户能自助解决常见问题。',
    action: '查看帮助条目',
    mapping: '融合旧 58 帮助中心；只描述已上线能力。',
    task: '帮助中心',
    taskKicker: '服务',
    taskStatus: '常见问题',
    steps: [],
    deviceState: '本机服务正常',
    deviceOk: true,
    activeTab: 'home',
    sections: [
      {
        title: '常见问题',
        caption: '覆盖已上线能力',
        kind: 'rows',
        items: [
          { title: '如何上传手机文件？', text: '打印页选择「手机扫码上传」', to: '58', state: '查看' },
          { title: '打印异常怎么办？', text: '不要重复提交，在订单详情反馈', to: '58', state: '查看' },
          { title: '文件保存多久？', text: '未登录 24 小时；登录按保存期限策略', to: '58', state: '查看' },
        ],
      },
    ],
  })

  /* ── 59 法务文档 ───────────────────────────────────────── */
  P.add({
    id: 59,
    title: '法务文档',
    section: 'foundation',
    template: 'detail',
    kicker: '法务',
    summary: '用户协议、隐私政策与版本化同意记录。',
    goal: '协议可见、可读、可追溯。',
    action: '阅读协议',
    mapping: '融合旧 59 法务文档；协议版本与同意记录真实展示。',
    task: '法务文档',
    taskKicker: '法律文本',
    taskStatus: '最新版本',
    steps: [],
    deviceState: '本机服务正常',
    deviceOk: true,
    activeTab: 'account',
    sections: [
      {
        title: '文档列表',
        caption: '版本化',
        kind: 'rows',
        items: [
          { title: '用户协议', text: 'V3.2 · 2026-07-01 生效', to: '59', state: '阅读' },
          { title: '隐私政策', text: 'V3.1 · 2026-07-01 生效', to: '59', state: '阅读' },
          { title: '个人信息处理规则', text: 'V2.0 · 2026-06-15 生效', to: '59', state: '阅读' },
        ],
      },
    ],
  })

  /* ── 60 会话超时 ───────────────────────────────────────── */
  P.add({
    id: 60,
    title: '会话即将超时',
    section: 'foundation',
    template: 'state',
    kicker: '系统',
    summary: '为保护隐私，会话即将结束；可续期或安全退出。',
    goal: '超时前给用户明确选择，不突然清空正在输入的内容。',
    action: '续期或退出',
    mapping: '融合旧 60 会话超时；续期在安全范围内，退出立即清场。',
    task: '系统状态',
    taskKicker: '公共终端',
    taskStatus: '距自动退出 60 秒',
    steps: [],
    deviceState: '本机在线',
    deviceOk: true,
    primary: { label: '继续使用', to: '01', confirm: false },
    secondary: { label: '安全退出并清场', to: '01', confirm: true },
    activeTab: 'home',
    sections: [
      {
        title: '会话即将超时',
        caption: '隐私保护',
        kind: 'progress',
        symbol: '时',
        headline: '60 秒后自动结束本次会话',
        text: '未保存的输入会被清理；继续使用可保留当前会话，退出会立即清空本次会话的敏感内容。',
        animate: false,
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'warn',
        icon: 'shield-check',
        text: '公共终端超时后自动清空内存会话，不写入长期浏览器存储。',
      },
    ],
  })
})(window.KioskPrototype)
