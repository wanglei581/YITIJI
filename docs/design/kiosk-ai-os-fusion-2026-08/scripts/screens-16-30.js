;(function (P) {
  /* ── 16 我的简历 ───────────────────────────────────────── */
  P.add({
    id: 16,
    title: '我的简历',
    section: 'account',
    template: 'collection',
    kicker: '我的',
    summary: '本人简历版本与 AI 处理记录，可继续优化、打印或删除。',
    goal: '管理简历版本，从记录继续下一步动作。',
    action: '选择简历继续处理',
    mapping: '归位旧 16 我的简历；明细按真实数据展示，不造假数据。',
    task: '本人简历',
    taskKicker: '个人中心',
    taskStatus: '3 份简历 · 按更新时间排序',
    steps: [],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '新建简历', to: '25', confirm: false },
    activeTab: 'account',
    sections: [
      {
        title: '简历列表',
        caption: '本人真实数据',
        kind: 'rows',
        items: [
          { title: '简历-2026-08.pdf', text: '已优化 · 2026-08-07 09:12 · 3 页', to: '16', state: '可打印' },
          { title: '简历-校园版.pdf', text: '已诊断 · 2026-08-01 · 2 页', to: '16', state: '可继续优化' },
          { title: '简历-通用版.pdf', text: '仅识别 · 2026-07-28 · 1 页', to: '16', state: '待诊断' },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'info',
        icon: 'file-user',
        text: '简历文件按保存期限策略管理；可在本页查看期限或删除。',
      },
      {
        kind: 'truth',
        text: 'AI 结果与简历原文分开存储，展示时明确标注来源。',
      },
    ],
  })

  /* ── 17 我的文档 ───────────────────────────────────────── */
  P.add({
    id: 17,
    title: '我的文档',
    section: 'account',
    template: 'collection',
    kicker: '我的',
    summary: '本人文档与文件生命周期，可预览、打印、续期或删除。',
    goal: '让文件可见、可管理、可继续使用。',
    action: '选择文档操作',
    mapping: '归位旧 17 我的文档；保存期限与签名盖章按真实能力显示。',
    task: '本人文档',
    taskKicker: '个人中心',
    taskStatus: '8 份文档 · 含保存期限信息',
    steps: [],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '上传新文件', to: '03', confirm: false },
    activeTab: 'account',
    sections: [
      {
        title: '文档列表',
        caption: '本人真实数据',
        kind: 'rows',
        items: [
          { title: '优化版简历.pdf', text: 'AI 生成成果 · 保存至 2026-11-05', to: '17', state: '可打印' },
          { title: '求职信.pdf', text: '求职材料生成 · 保存至 2026-11-02', to: '17', state: '可打印' },
          { title: '扫描-身份证.pdf', text: '高敏文件 · 保存至 2026-08-21', to: '17', state: '临期' },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'warn',
        icon: 'timer',
        text: '高敏文件保存期限更短；到期后按既有清理策略删除。',
      },
      {
        kind: 'truth',
        text: '文件预览使用短时签名 URL，不写入长期浏览器存储。',
      },
    ],
  })

  /* ── 18 我的打印订单 ───────────────────────────────────── */
  P.add({
    id: 18,
    title: '我的打印订单',
    section: 'account',
    template: 'collection',
    kicker: '我的',
    summary: '进行中与历史打印订单，可追踪、反馈与再次办理。',
    goal: '订单状态真实可见，异常可反馈可恢复。',
    action: '查看订单状态',
    mapping: '归位旧 18 我的打印订单；状态来自 PrintTask 与 Order 真实回传。',
    task: '打印订单',
    taskKicker: '个人中心',
    taskStatus: '进行中 1 笔 · 历史 1 笔',
    steps: [],
    deviceState: '打印机在线 · 处理中',
    deviceOk: true,
    activeTab: 'account',
    sections: [
      {
        title: '进行中',
        caption: '真实状态',
        kind: 'rows',
        items: [
          { title: '简历-2026-08.pdf · 2 份', text: '订单 JY-20260807-0012 · 正在打印', to: '04', state: '进行中' },
        ],
      },
      {
        title: '历史订单',
        caption: '已完成',
        kind: 'rows',
        items: [
          { title: '求职信.pdf · 1 份', text: '订单 JY-20260728-0081 · 已完成 · 取件码 4821', to: '18', state: '已完成' },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'info',
        icon: 'life-buoy',
        text: '异常订单可从原订单发起反馈，不另建孤立售后系统。',
      },
      {
        kind: 'truth',
        text: '未确认出纸前不会显示「已完成」；金额以服务端核价为准。',
      },
    ],
  })

  /* ── 19 AI 服务记录 ────────────────────────────────────── */
  P.add({
    id: 19,
    title: 'AI 服务记录',
    section: 'account',
    template: 'collection',
    kicker: '我的',
    summary: '诊断、优化、匹配、规划等 AI 服务记录，可回看、删除。',
    goal: '让 AI 结果可追溯、可管理。',
    action: '查看或删除记录',
    mapping: '归位旧 19 AI 服务记录；只展示真实服务结果。',
    task: 'AI 服务记录',
    taskKicker: '个人中心',
    taskStatus: '5 条记录 · 按时间排序',
    steps: [],
    deviceState: '本机服务正常',
    deviceOk: true,
    activeTab: 'account',
    sections: [
      {
        title: '记录列表',
        caption: '本人真实数据',
        kind: 'rows',
        items: [
          { title: '简历优化', text: '简历-2026-08.pdf · 2026-08-07 09:12', to: '19', state: '可查看' },
          { title: '岗位匹配参考', text: '产品经理（校园招聘）· 参考：较高', to: '19', state: '可查看' },
          { title: '职业规划', text: '建议单已生成 · 2026-08-01', to: '19', state: '可打印' },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'info',
        icon: 'database',
        text: 'AI 生成内容标注「AI 生成 / 仅供参考」，支持查看、继续处理、打印和删除。',
      },
      {
        kind: 'truth',
        text: '记录不包含投递结果；平台不接收、不转交简历给企业。',
      },
    ],
  })

  /* ── 20 我的收藏 ───────────────────────────────────────── */
  P.add({
    id: 20,
    title: '我的收藏',
    section: 'account',
    template: 'collection',
    kicker: '我的',
    summary: '收藏的岗位、招聘会与政策，可快速回到来源页面。',
    goal: '收藏内容可回看、可取消收藏。',
    action: '打开收藏内容',
    mapping: '归位旧 20 我的收藏；收藏与浏览记录按真实数据展示。',
    task: '我的收藏',
    taskKicker: '个人中心',
    taskStatus: '岗位 3 · 招聘会 1 · 政策 1',
    steps: [],
    deviceState: '内容服务正常',
    deviceOk: true,
    activeTab: 'account',
    sections: [
      {
        title: '收藏列表',
        caption: '本人真实数据',
        kind: 'rows',
        items: [
          { title: '产品经理（校园招聘）', text: '岗位 · 腾讯招聘官方公开信息', to: '09', state: '查看' },
          { title: '2026 夏季综合招聘会', text: '招聘会 · 8 月 15 日', to: '11', state: '查看' },
          { title: '就业补贴政策', text: '政策 · 政府公开信息', to: '12', state: '查看' },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'info',
        icon: 'star',
        text: '收藏只保留来源入口；投递、预约结果不会被记录。',
      },
    ],
  })

  /* ── 21 我的权益 ───────────────────────────────────────── */
  P.add({
    id: 21,
    title: '我的权益',
    section: 'account',
    template: 'collection',
    kicker: '我的',
    summary: '数字权益与终端权益，含额度、期限与使用条件。',
    goal: '权益真实可见、可核销、可追踪。',
    action: '查看权益详情',
    mapping: '归位旧 21 我的权益；权益预占、核销与返还按真实规则。',
    task: '我的权益',
    taskKicker: '个人中心',
    taskStatus: '可用权益 2 项 · 1 项即将到期',
    steps: [],
    deviceState: '本机服务正常',
    deviceOk: true,
    activeTab: 'account',
    sections: [
      {
        title: '权益列表',
        caption: '真实额度与期限',
        kind: 'rows',
        items: [
          { title: 'AI 简历优化次数', text: '剩余 2 次 · 有效期至 2026-09-30', to: '21', state: '可用' },
          { title: '打印页数额度', text: '剩余 20 页 · 有效期至 2026-08-30', to: '21', state: '即将到期' },
          { title: '现场材料包折扣', text: '指定服务点 · 有效期至 2026-12-31', to: '21', state: '可用' },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'warn',
        icon: 'timer',
        text: '打印页数额度将在 2026-08-30 到期，请留意使用。',
      },
      {
        kind: 'truth',
        text: '权益抵扣以服务端核销为准；不使用 best-effort 日志计费。',
      },
    ],
  })

  /* ── 22 我的通知 ───────────────────────────────────────── */
  P.add({
    id: 22,
    title: '我的通知',
    section: 'account',
    template: 'collection',
    kicker: '我的',
    summary: '订单、AI 任务与服务通知。',
    goal: '关键状态变化能及时看到。',
    action: '查看通知',
    mapping: '归位旧 22 我的通知；只展示真实服务通知。',
    task: '我的通知',
    taskKicker: '个人中心',
    taskStatus: '3 条未读',
    steps: [],
    deviceState: '本机服务正常',
    deviceOk: true,
    activeTab: 'account',
    sections: [
      {
        title: '通知列表',
        caption: '真实服务通知',
        kind: 'rows',
        items: [
          { title: '打印任务已领取', text: '订单 JY-20260807-0012 · 正在打印', to: '04', state: '未读' },
          { title: '简历优化已完成', text: '简历-2026-08.pdf 优化稿已生成', to: '19', state: '已读' },
          { title: '权益即将到期', text: '打印页数额度 8 月 30 日到期', to: '21', state: '已读' },
        ],
      },
    ],
  })

  /* ── 23 我的设置 ───────────────────────────────────────── */
  P.add({
    id: 23,
    title: '我的设置',
    section: 'account',
    template: 'directory',
    kicker: '我的',
    summary: '账号只读状态、协议入口与退出。',
    goal: '让用户能查看账号状态、协议并安全退出。',
    action: '选择设置项',
    mapping: '归位旧 23 我的设置；只读状态 + 协议入口 + 退出，不做换绑/注销假完成。',
    task: '我的设置',
    taskKicker: '个人中心',
    taskStatus: '已登录 · 手机号 138****5678',
    steps: [],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '退出登录', to: '15', confirm: true },
    activeTab: 'account',
    sections: [
      {
        title: '账号',
        caption: '只读状态',
        kind: 'rows',
        items: [
          { title: '当前账号', text: '手机号 138****5678 · 会员', to: '23', state: '已登录' },
          { title: '用户协议与隐私政策', text: '版本与同意记录', to: '59', state: '查看' },
          { title: '隐私请求', text: '数据导出、注销与授权撤回', to: '23', state: '可申请' },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'warn',
        icon: 'shield-check',
        text: '公共终端退出或超时后自动清空本次会话与敏感内容。',
      },
    ],
  })

  /* ── 24 权益活动 ───────────────────────────────────────── */
  P.add({
    id: 24,
    title: '权益活动',
    section: 'account',
    template: 'collection',
    kicker: '活动',
    summary: '可领取的权益活动，领取后进入我的权益。',
    goal: '活动真实可领、领取有结果。',
    action: '查看或领取活动',
    mapping: '融合旧 24 活动 / 71 我的活动 / 72 活动详情；不含支付套餐。',
    task: '权益活动',
    taskKicker: '服务',
    taskStatus: '进行中 2 场',
    steps: [],
    deviceState: '本机服务正常',
    deviceOk: true,
    activeTab: 'account',
    sections: [
      {
        title: '活动列表',
        caption: '真实活动',
        kind: 'rows',
        items: [
          { title: '求职季 AI 服务体验', text: '领取 1 次简历优化 · 有效期 30 天', to: '24', state: '可领取' },
          { title: '校园打印额度赠送', text: '新用户领取 10 页打印额度', to: '24', state: '已领取' },
        ],
      },
    ],
  })

  /* ── 25 AI 简历生成：信息表单 ──────────────────────────── */
  P.add({
    id: 25,
    title: 'AI 简历生成',
    section: 'resume',
    template: 'workbench',
    kicker: 'AI 简历服务',
    summary: '填写基础信息，系统按模板生成简历初稿。',
    goal: '从零生成可用简历初稿，字段完整、可预览、可修改。',
    action: '填写信息并生成预览',
    mapping: '融合旧 25 生成 / 26 生成预览；生成的 PDF 进入我的文档。',
    task: '生成新简历',
    taskKicker: 'AI 简历服务',
    taskStatus: '信息完整度 80% · 可生成',
    steps: [
      { label: '填写信息', active: true },
      { label: '选择模板' },
      { label: '生成预览' },
      { label: '保存导出' },
    ],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '生成简历预览', to: '26', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '基础信息',
        caption: '带 * 为必填',
        kind: 'form',
        fields: [
          { label: '姓名 *', value: '王小明' },
          { label: '求职意向 *', value: '产品经理' },
          { label: '教育经历 *', value: '某大学 信息管理与信息系统 本科 2022-2026', wide: true },
          { label: '项目经历', value: '校园就业服务平台 产品实习生', wide: true, hint: '建议补充量化结果，如「提升 30% 转化」', hintIcon: 'lightbulb' },
          { label: '技能', value: 'Axure / Figma / SQL', wide: true },
        ],
      },
      {
        title: '生成说明',
        caption: '诚实声明',
        kind: 'notice',
        headless: true,
        tone: 'info',
        icon: 'sparkles',
        text: '系统根据你填写的信息生成简历初稿，标注「AI 生成 / 请核对」；所有内容由你确认后使用。',
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'info',
        icon: 'layout-template',
        text: '可在预览页切换模板版式；模板库只读展示。',
      },
      {
        kind: 'truth',
        text: '生成结果进入本人简历与我的文档；不伪造工作经历或学历。',
      },
    ],
  })

  /* ── 26 简历生成预览 ───────────────────────────────────── */
  P.add({
    id: 26,
    title: '简历预览',
    section: 'resume',
    template: 'workbench',
    kicker: 'AI 简历服务',
    summary: '确认内容与版式，保存后进入我的简历。',
    goal: '生成结果可预览、可编辑、可保存。',
    action: '保存或返回修改',
    mapping: '融合旧 26 预览 / 28 导出；导出 PDF 进入我的文档。',
    task: '新简历 · 王小明',
    taskKicker: 'AI 简历服务',
    taskStatus: 'AI 生成初稿，请核对后保存',
    steps: [
      { label: '填写信息', done: true },
      { label: '选择模板', done: true },
      { label: '生成预览', active: true },
      { label: '保存导出' },
    ],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '保存到我的简历', to: '16', confirm: true },
    secondary: { label: '返回修改', to: '25' },
    activeTab: 'home',
    sections: [
      {
        title: '简历预览',
        caption: 'AI 生成 · 请核对',
        kind: 'document',
        fileName: '新简历-王小明.pdf',
        fileMeta: 'PDF · 1 页 · 预览稿',
        activePage: 0,
        pages: [1],
        body: '王小明\n求职意向：产品经理\n\n教育经历\n某大学 信息管理与信息系统 本科 2022-2026\n\n项目经历\n校园就业服务平台 产品实习生\n负责需求梳理与原型设计，推动 3 个版本迭代上线\n\n技能\nAxure / Figma / SQL / 数据分析',
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'ok',
        icon: 'circle-check-big',
        text: '保存后可在「我的简历」继续优化或打印；生成内容标注 AI 生成。',
      },
      {
        kind: 'truth',
        text: '保存不意味着投递；简历只属于本人资产。',
      },
    ],
  })

  /* ── 27 简历解析（并入识别流程，保留编号映射） ─────────── */
  P.add({
    id: 27,
    title: '简历解析',
    section: 'resume',
    template: 'progress',
    kicker: 'AI 简历服务',
    summary: '旧 27 简历解析已并入 06 识别流程，本页保留为流程映射。',
    goal: '保持编号可追溯，不重复造入口。',
    action: '查看识别结果',
    mapping: '功能已并入 06「正在识别简历」；编号 27 仅为兼容映射。',
    task: '简历解析',
    taskKicker: '流程映射',
    taskStatus: '已并入识别流程',
    steps: [
      { label: '来源与目标', done: true },
      { label: '识别检查', active: true },
      { label: '诊断报告' },
      { label: '优化与导出' },
    ],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '前往识别流程', to: '06', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '映射说明',
        caption: '不新增重复页面',
        kind: 'notice',
        headless: true,
        tone: 'info',
        icon: 'git-merge',
        text: '为避免重复入口，解析能力已并入「识别检查」流程；从旧入口进入会跳转到 06 屏。',
      },
    ],
  })

  /* ── 28 简历导出（并入预览/文档，保留编号） ────────────── */
  P.add({
    id: 28,
    title: '简历导出',
    section: 'resume',
    template: 'progress',
    kicker: 'AI 简历服务',
    summary: '导出结果进入我的文档，可打印或保存。',
    goal: '成果可带走的闭环。',
    action: '导出或打印',
    mapping: '功能并入 26 保存 / 03 打印；编号 28 仅为兼容映射。',
    task: '简历导出',
    taskKicker: '流程映射',
    taskStatus: '已并入保存与打印流程',
    steps: [],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '前往我的文档', to: '17', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '映射说明',
        caption: '不新增重复页面',
        kind: 'notice',
        headless: true,
        tone: 'info',
        icon: 'git-merge',
        text: '导出 PDF 已并入「保存到我的简历 / 我的文档」，打印并入打印流程；旧入口跳转到对应页面。',
      },
    ],
  })

  /* ── 29 简历模板库 ─────────────────────────────────────── */
  P.add({
    id: 29,
    title: '简历模板',
    section: 'resume',
    template: 'collection',
    kicker: 'AI 简历服务',
    summary: '只读模板素材，选择后引导进入生成流程。',
    goal: '模板只读展示，不伪造生成结果。',
    action: '选择模板',
    mapping: '融合旧 29 简历模板；模板类只引导 AI 生成，不就地生成假简历。',
    task: '简历模板',
    taskKicker: '素材库',
    taskStatus: '内置模板 6 套 · 只读',
    steps: [],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '用此模板生成简历', to: '25', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '模板列表',
        caption: '只读素材',
        kind: 'rows',
        items: [
          { title: '清新简约', text: '适合应届生 · 单栏', to: '25', state: '推荐' },
          { title: '商务稳重', text: '适合社招 · 双栏', to: '25', state: '可选' },
          { title: '校园清新', text: '适合校招 · 单栏', to: '25', state: '可选' },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'info',
        icon: 'layout-template',
        text: '模板版权与字段白名单按既有治理规则执行。',
      },
    ],
  })

  /* ── 30 求职材料 ───────────────────────────────────────── */
  P.add({
    id: 30,
    title: '求职材料',
    section: 'resume',
    template: 'collection',
    kicker: 'AI 简历服务',
    summary: '求职信、感谢信、材料清单等生成与打印。',
    goal: '材料生成真实闭环，结果进入我的文档。',
    action: '生成求职材料',
    mapping: '融合旧 30 求职材料；真实表单生成 PDF，进入我的文档与打印。',
    task: '求职材料',
    taskKicker: 'AI 简历服务',
    taskStatus: '可生成 4 类材料',
    steps: [],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '生成求职信', to: '30', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '材料类型',
        caption: '生成后进入我的文档',
        kind: 'rows',
        items: [
          { title: '求职信', text: '根据岗位与简历生成', to: '30', state: '可生成' },
          { title: '感谢信', text: '面试后的跟进材料', to: '30', state: '可生成' },
          { title: '作品集封面', text: '规范封面排版', to: '30', state: '可生成' },
          { title: '材料清单', text: '按场景生成清单', to: '30', state: '可生成' },
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        text: '生成 PDF 为真实文件；同一未修改成果不重复扣同一导出权益。',
      },
    ],
  })
})(window.KioskPrototype)
