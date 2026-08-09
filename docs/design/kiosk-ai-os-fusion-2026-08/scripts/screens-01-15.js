;(function (P) {
  /* ── 01 首页：目标输入 + 六项定版服务 + 今日任务 ─────────── */
  P.add({
    id: 1,
    title: '首页',
    section: 'foundation',
    template: 'home',
    kicker: '今天想办什么',
    summary: '说出目标，或直接选择一项服务。每个入口都有完整办理链路。',
    goal: '让第一次使用的人十秒内找到起点，并让老用户直接继续上次办理。',
    action: '输入目标或选择六项服务之一',
    mapping: '融合旧 01 首页任务台；AI 能力内化为「目标识别 → 建议顺序」，不再做成独立聊天框。',
    task: '还没有开始办理',
    taskKicker: '当前事项',
    taskStatus: '可以选择服务，也可以让系统根据目标推荐办理顺序',
    steps: [],
    deviceState: '打印机在线 · 纸量正常',
    deviceOk: true,
    primary: { label: '根据目标生成办理步骤', to: '13', confirm: true },
    secondary: { label: '先登录同步本人记录', to: '15' },
    activeTab: 'home',
    sections: [
      {
        title: '把目标说清楚',
        caption: '一句话即可，后续由你确认',
        kind: 'form',
        fields: [
          {
            label: '我今天想办',
            value: '周五参加招聘会，想先优化简历并打印 5 份',
            wide: true,
            hint: '系统会识别目标并给出建议办理顺序',
            hintIcon: 'sparkles',
          },
        ],
      },
      {
        title: '六项核心服务',
        caption: '入口名称保持稳定',
        kind: 'rows',
        headless: true,
        items: [
          { title: '打印扫描', text: '上传、检查、支付、打印与材料扫描', to: '02', state: '可办理' },
          { title: 'AI 简历服务', text: '诊断、优化、生成、模板与求职材料', to: '05', state: '可办理' },
          { title: '岗位信息', text: '第三方来源岗位与本人匹配参考', to: '08', state: '可查看' },
          { title: '招聘会', text: '场次、企业、场馆导览与参会准备', to: '10', state: '可查看' },
          { title: 'AI 面试训练', text: '私密练习、逐题反馈与历史报告', to: '38', state: '可办理' },
          { title: '政策服务', text: '官方政策、材料清单与办理来源', to: '12', state: '可查看' },
        ],
      },
    ],
    rail: [
      {
        kind: 'photo',
        captionText: '招聘会前可在本机准备简历、材料清单并完成打印。',
      },
      {
        kind: 'truth',
        title: '当前设备状态',
        text: '打印机在线、纸量正常；扫描与双面能力在办理阶段检测。未确认前页面不显示假就绪。',
      },
    ],
  })

  /* ── 02 打印扫描中心：目录 ─────────────────────────────── */
  P.add({
    id: 2,
    title: '打印扫描中心',
    section: 'print',
    template: 'directory',
    kicker: '打印扫描',
    summary: '文档打印、纸质扫描与常用文件工具，全程在本机办理。',
    goal: '按用途找到正确入口，入口后每项都有完整办理链路。',
    action: '选择要办理的服务',
    mapping: '融合旧 02 打印扫描中心与 30/31/66/67/68 文件工具；目录只保留真实能力。',
    task: '打印扫描服务',
    taskKicker: '服务目录',
    taskStatus: '设备能力按真实状态显示',
    steps: [
      { label: '选择服务', active: true },
      { label: '准备文件' },
      { label: '确认支付' },
      { label: '取件' },
    ],
    deviceState: '打印机在线 · 纸量正常',
    deviceOk: true,
    primary: { label: '开始文档打印', to: '03', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '主要办理',
        caption: '高频服务',
        kind: 'rows',
        items: [
          { title: '文档打印', text: '本机文件、手机上传或 U 盘 → 参数 → 支付 → 出纸', to: '03', state: '可办理' },
          { title: '纸质扫描', text: 'ADF 扫描 → 预览 → AI 识别 → 保存 / 打印', to: '34', state: '可办理' },
        ],
      },
      {
        title: '文件工具',
        caption: '格式与排版',
        kind: 'rows',
        items: [
          { title: '图片合并 PDF', text: '多张图片按顺序合并为一个 PDF 后打印', to: '66', state: '可办理' },
          { title: '签名盖章排版', text: '在文件上排版签名与盖章区域后打印', to: '67', state: '可办理' },
          { title: '证件照排版', text: '按证件照规格排版后打印', to: '68', state: '即将上线' },
        ],
      },
      {
        title: '办理须知',
        caption: '扫描不是云端遥控',
        kind: 'notice',
        headless: true,
        tone: 'warn',
        icon: 'scan-line',
        text: '本机扫描与打印只在本机完成；扫描结果按你选择的方式保存，不会自动上传到第三方。金额以现场公示价为准。',
      },
    ],
    rail: [
      {
        kind: 'metric',
        title: '本机状态',
        items: [
          ['打印机', '在线'],
          ['纸张', '充足'],
        ],
      },
      {
        kind: 'notice',
        tone: 'info',
        icon: 'receipt-text',
        text: '打印订单、我的文档、扫描记录都可在「我的」对应页面查看、继续或删除。',
      },
    ],
  })

  /* ── 03 打印参数工作台：预览为主 + 参数 + 核价 ─────────── */
  P.add({
    id: 3,
    title: '打印参数',
    section: 'print',
    template: 'workbench',
    kicker: '文档打印',
    summary: '确认文件、份数与页面设置，价格由服务端实时核价。',
    goal: '让用户在真实预览上确认内容，参数一目了然，价格真实可核。',
    action: '设置参数并进入确认',
    mapping: '融合旧 03 打印参数 / 64 打印预览 / 31 材料检查；文件窗口完整显示，不截断。',
    task: '打印 简历-2026-08.pdf',
    taskKicker: '当前文件',
    taskStatus: '系统已完成文件与敏感信息检查，可继续',
    steps: [
      { label: '选择文件', done: true },
      { label: '设置参数', active: true },
      { label: '确认支付' },
      { label: '取件' },
    ],
    deviceState: '打印机在线 · 双面可用',
    deviceOk: true,
    primary: { label: '下一步：确认打印', to: '65', confirm: false },
    secondary: { label: '更换文件', to: '02' },
    helper: '价格以服务端实时核价为准；彩色能力由设备实际能力决定。',
    activeTab: 'home',
    sections: [
      {
        title: '文件预览',
        caption: '完整显示，不截断',
        kind: 'document',
        fileName: '简历-2026-08.pdf',
        fileMeta: 'PDF · 3 页 · 380 KB',
        activePage: 0,
        pages: [1, 2, 3],
        body: '王小明\n求职意向：产品经理\n\n教育经历\n某大学 信息管理与信息系统 本科 2022-2026\n\n项目经历\n校园就业服务平台 产品实习生\n负责需求梳理与原型设计，推动 3 个版本迭代上线\n\n技能\nAxure / Figma / SQL / 数据分析',
      },
      {
        title: '材料检查结果',
        caption: '办理前自动完成',
        kind: 'checklist',
        headless: true,
        items: [
          { title: '文件可正常打印', text: '3 页 · A4 · 无缺页', missing: false },
          { title: '未发现敏感信息', text: '手机号、证件号等已按页面显示规则处理', missing: false },
          { title: '页面范围', text: '默认全部 1-3 页，可修改', missing: false },
        ],
      },
    ],
    rail: [
      {
        kind: 'segments',
        title: '份数',
        items: ['1 份', '2 份', '3 份', '5 份'],
        selected: 1,
      },
      {
        kind: 'segments',
        title: '单双面',
        items: ['单面', '双面长边'],
        selected: 1,
      },
      {
        kind: 'segments',
        title: '页面',
        items: ['全部', '自选范围'],
        selected: 0,
      },
      {
        kind: 'price',
        label: '预计费用（3 页 × 2 份 · 双面）',
        amount: '¥3.60',
        note: '金额以服务端实时核价为准；权益抵扣在确认页显示。',
      },
      {
        kind: 'truth',
        text: '彩色能力由设备实际能力决定；未知彩色 mode 不做假设。',
      },
    ],
  })

  /* ── 04 打印进度：实时履约 ─────────────────────────────── */
  P.add({
    id: 4,
    title: '打印进度',
    section: 'print',
    template: 'progress',
    kicker: '文档打印',
    summary: '任务状态实时回传，完成后凭取件码取件。',
    goal: '让用户知道任务在哪一步，不提前离开，异常可恢复。',
    action: '查看进度或处理异常',
    mapping: '融合旧 04 打印进度 / 33 完成取件；状态来自 Agent 与打印机真实回传。',
    task: '打印 简历-2026-08.pdf · 2 份',
    taskKicker: '进行中任务',
    taskStatus: '已支付，正在排队打印',
    steps: [
      { label: '选择文件', done: true },
      { label: '设置参数', done: true },
      { label: '确认支付', done: true },
      { label: '打印取件', active: true },
    ],
    deviceState: '打印机在线 · 处理中',
    deviceOk: true,
    primary: { label: '查看完成页', to: '33', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '任务状态',
        caption: '来自设备真实回传',
        kind: 'progress',
        symbol: '印',
        headline: '正在打印 第 2/3 页',
        text: '预计很快完成；打印完成后请在本机下方取件口取件。',
        animate: true,
      },
      {
        title: '处理记录',
        caption: '全程可追溯',
        kind: 'timeline',
        items: [
          { title: '订单已确认', text: '订单 JY-20260807-0012 · 已支付 ¥3.60', status: 'done' },
          { title: '任务已领取', text: '本机 01 号终端已领取任务', status: 'done' },
          { title: '正在打印', text: '第 2/3 页，等待打印机回报', status: 'active' },
          { title: '完成取件', text: '完成后显示取件码', status: 'pending' },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'warn',
        icon: 'timer',
        text: '请在本机旁等待；离开前未确认出纸，不能视为已完成。',
      },
      {
        kind: 'notice',
        tone: 'info',
        icon: 'life-buoy',
        text: '打印异常时不要重复提交；在订单详情反馈，现场工作人员会协助核查。',
      },
    ],
  })

  /* ── 05 简历来源与目标 ─────────────────────────────────── */
  P.add({
    id: 5,
    title: '简历来源与目标',
    section: 'resume',
    template: 'workbench',
    kicker: 'AI 简历服务',
    summary: '选择简历来源与本次目标，系统据此安排后续步骤。',
    goal: '明确材料来源与目标岗位，后续诊断、优化、匹配才有真实依据。',
    action: '选择来源并确认目标',
    mapping: '融合旧 05 简历来源 / 27 简历解析入口；来源选项对应真实上传链路。',
    task: 'AI 简历服务',
    taskKicker: '开始办理',
    taskStatus: '先确认来源与目标，再进入识别与诊断',
    steps: [
      { label: '来源与目标', active: true },
      { label: '识别检查' },
      { label: '诊断报告' },
      { label: '优化与导出' },
    ],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '确认并开始识别', to: '06', confirm: false },
    secondary: { label: '稍后办理', to: '01' },
    activeTab: 'home',
    sections: [
      {
        title: '选择简历来源',
        caption: '公共终端离场自动清空',
        kind: 'choices',
        items: [
          { title: '本机已有文件', text: '从本机文件中选择简历', selected: true },
          { title: '手机扫码上传', text: '手机扫码后上传，需联网', selected: false },
          { title: 'U 盘导入', text: '插入 U 盘后选择文件', selected: false },
          { title: '纸质扫描识别', text: '用本机扫描仪扫描纸质简历', selected: false },
        ],
      },
      {
        title: '本次目标',
        caption: '决定后续步骤',
        kind: 'choices',
        items: [
          { title: '简历诊断', text: '检查影响投递准备的主要问题', selected: true },
          { title: '简历优化', text: '在诊断基础上生成优化建议稿', selected: false },
          { title: '目标岗位匹配参考', text: '对照岗位要求给出三档参考', selected: false },
          { title: '职业规划', text: '基于现状生成规划建议单', selected: false },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'info',
        icon: 'shield-check',
        text: '简历内容只在本次会话使用；未登录的公共终端最长保留 24 小时，离场清空。',
      },
      {
        kind: 'truth',
        text: '岗位匹配只给出「较高 / 中等 / 偏低」三档参考，不显示百分比或录用概率。',
      },
    ],
  })

  /* ── 06 简历识别与检查：处理中 ─────────────────────────── */
  P.add({
    id: 6,
    title: '正在识别简历',
    section: 'resume',
    template: 'progress',
    kicker: 'AI 简历服务',
    summary: '系统正在识别文件内容并检查完整性，稍候自动进入诊断。',
    goal: '让用户知道识别进度，OCR 失败时能重新上传而不是卡住。',
    action: '等待识别完成',
    mapping: '融合旧 06 诊断入口 / 27 简历解析；识别结果来自真实 OCR 与解析服务。',
    task: '识别 简历-2026-08.pdf',
    taskKicker: '处理中',
    taskStatus: '正在识别内容，完成后自动进入诊断',
    steps: [
      { label: '来源与目标', done: true },
      { label: '识别检查', active: true },
      { label: '诊断报告' },
      { label: '优化与导出' },
    ],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '查看诊断报告', to: '06', confirm: false, disabled: true },
    activeTab: 'home',
    sections: [
      {
        title: '识别进度',
        caption: '真实处理中',
        kind: 'progress',
        symbol: '识',
        headline: '正在读取文件内容',
        text: '正在解析文字与结构，页数、敏感信息和字段完整性将同步检查。',
        animate: true,
      },
      {
        title: '本次检查项',
        caption: '完成后逐项显示',
        kind: 'checklist',
        headless: true,
        items: [
          { title: '文件可读', text: 'PDF / 图片可正常解析', missing: false },
          { title: '关键字段完整', text: '教育、经历、技能等字段', missing: false },
          { title: '敏感信息提示', text: '识别后按规则提示处理', missing: false },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'info',
        icon: 'clock',
        text: '识别通常在 10-30 秒内完成；如果长时间无结果，可取消后重试。',
      },
    ],
  })

  /* ── 07 简历诊断报告：结果沉淀 ─────────────────────────── */
  P.add({
    id: 7,
    title: '简历诊断报告',
    section: 'resume',
    template: 'detail',
    kicker: 'AI 简历服务',
    summary: '诊断结果与修改建议，可继续优化、打印或沉淀到我的简历。',
    goal: '诊断结果可读、可执行、可沉淀，不只是一次性结论。',
    action: '继续优化 / 打印 / 保存',
    mapping: '融合旧 06 简历诊断报告；结果进入 AI 服务记录与我的简历，可回看可删除。',
    task: '简历-2026-08.pdf 诊断',
    taskKicker: '已完成',
    taskStatus: '诊断完成，结果已保存到本人 AI 服务记录',
    steps: [
      { label: '来源与目标', done: true },
      { label: '识别检查', done: true },
      { label: '诊断报告', active: true },
      { label: '优化与导出' },
    ],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '继续优化简历', to: '07', confirm: false },
    secondary: { label: '打印诊断报告', to: '03' },
    helper: 'AI 生成内容仅供参考；不会代你投递，也不会承诺录用。',
    activeTab: 'home',
    sections: [
      {
        title: '总体结论',
        caption: 'AI 生成 · 仅供参考',
        kind: 'metrics',
        items: [
          ['可读性', '良好'],
          ['完整度', '中等'],
          ['重点突出', '待提升'],
          ['建议动作', '3 项'],
        ],
      },
      {
        title: '主要发现与建议',
        caption: '按影响程度排序',
        kind: 'checklist',
        headless: true,
        items: [
          { title: '项目经历缺少量化结果', text: '建议补充「提升 30% 转化」这类可验证结果', missing: true },
          { title: '求职意向与岗位关键词不匹配', text: '可按目标岗位要求调整关键词', missing: true },
          { title: '整体结构清晰', text: '教育与技能部分可直接使用', missing: false },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'ok',
        icon: 'database',
        text: '诊断结果已保存；在「我的简历 / AI 服务记录」可回看、继续优化或删除。',
      },
      {
        kind: 'truth',
        text: '诊断不承诺录用或通过率；所有建议均可由你确认后采用。',
      },
    ],
  })

  /* ── 08 岗位列表：来源信息入口 ─────────────────────────── */
  P.add({
    id: 8,
    title: '岗位信息',
    section: 'jobs',
    template: 'collection',
    kicker: '岗位信息',
    summary: '第三方来源岗位，按类型与来源筛选；投递始终在来源平台完成。',
    goal: '快速找到相关岗位，看清来源，按合规方式去来源平台投递。',
    action: '浏览、收藏或去来源平台',
    mapping: '融合旧 08 岗位列表 / 78 线上招聘平台；只保留来源入口，不形成站内投递。',
    task: '浏览岗位',
    taskKicker: '来源信息',
    taskStatus: '岗位来自已审核的第三方或官方来源',
    steps: [],
    deviceState: '内容服务正常',
    deviceOk: true,
    activeTab: 'home',
    sections: [
      {
        title: '全部岗位',
        caption: '来源：腾讯招聘官方公开数据 · 2026-08-07 同步',
        kind: 'rows',
        items: [
          { title: '产品经理（校园招聘）', text: '深圳 · 某互联网公司 · 来源平台可投递', to: '09', state: '去来源平台投递' },
          { title: '前端开发工程师', text: '广州 · 某科技公司 · 来源平台可投递', to: '09', state: '去来源平台投递' },
          { title: '数据分析师（实习）', text: '上海 · 某咨询公司 · 来源平台可投递', to: '09', state: '去来源平台投递' },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'warn',
        icon: 'external-link',
        text: '本终端不代收简历、不做投递；「去来源平台投递」会打开来源平台页面。',
      },
      {
        kind: 'truth',
        text: '浏览、收藏与打开来源入口会被记录；不记录投递结果。',
      },
    ],
  })

  /* ── 09 岗位详情：来源卡 + 合规按钮 ────────────────────── */
  P.add({
    id: 9,
    title: '产品经理（校园招聘）',
    section: 'jobs',
    template: 'detail',
    kicker: '岗位信息',
    summary: '岗位详情、来源信息与合规投递入口。',
    goal: '让用户完整了解岗位并看清来源，按合规方式前往来源平台。',
    action: '查看详情 / 去来源平台投递',
    mapping: '融合旧 09 岗位详情；数据来源卡、同步时间、外部 ID 完整展示。',
    task: '查看岗位详情',
    taskKicker: '来源信息',
    taskStatus: '岗位来自第三方来源，投递在来源平台完成',
    steps: [],
    deviceState: '内容服务正常',
    deviceOk: true,
    primary: { label: '去来源平台投递', to: '09', confirm: true, external: true, tone: 'source' },
    secondary: { label: '收藏岗位', to: '09', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '岗位信息',
        caption: '来自来源平台公开数据',
        kind: 'text',
        paragraphs: [
          '负责校园招聘产品的需求分析、原型设计与迭代；协同运营与研发推进版本交付。',
          '要求：2026 届本科及以上；有产品实习经历；熟悉 Axure / Figma；对数据敏感。',
        ],
      },
      {
        title: '数据来源',
        caption: '来源信息完整展示',
        kind: 'checklist',
        headless: true,
        items: [
          { title: '来源平台', text: '腾讯招聘官方公开信息 · 外部 ID：TENCENT-2026-PM-018', missing: false },
          { title: '同步时间', text: '2026-08-07 09:00 自动同步', missing: false },
          { title: '平台边界', text: '本终端不代投递，需前往来源平台完成', missing: false },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'warn',
        icon: 'external-link',
        text: '打开来源平台前会先显示离站确认；平台不会通过本终端接收你的简历。',
      },
      {
        kind: 'truth',
        text: '岗位匹配参考只在简历诊断后可用，且只展示三档参考。',
      },
    ],
  })

  /* ── 10 招聘会列表 ─────────────────────────────────────── */
  P.add({
    id: 10,
    title: '招聘会',
    section: 'fairs',
    template: 'collection',
    kicker: '招聘会',
    summary: '近期招聘会场次，含来源、状态与场馆信息。',
    goal: '按场次、状态与场馆找到目标招聘会。',
    action: '查看场次详情',
    mapping: '融合旧 10 招聘会列表 / 50 校园招聘入口；预约始终在来源平台完成。',
    task: '浏览招聘会',
    taskKicker: '来源信息',
    taskStatus: '场次来自官方或第三方公开来源',
    steps: [],
    deviceState: '内容服务正常',
    deviceOk: true,
    activeTab: 'home',
    sections: [
      {
        title: '近期场次',
        caption: '来源：广州市人社局 / 高校就业中心',
        kind: 'rows',
        items: [
          { title: '2026 夏季综合招聘会', text: '8 月 15 日 09:00-15:00 · 广州国际会展中心', to: '11', state: '可预约' },
          { title: '高校应届毕业生专场', text: '8 月 20 日 09:00-14:00 · 某大学体育馆', to: '11', state: '可预约' },
          { title: '现代服务业人才招聘会', text: '8 月 28 日 09:30-16:00 · 琶洲展馆', to: '11', state: '即将开始' },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'warn',
        icon: 'external-link',
        text: '「扫码预约」为来源平台预约入口；本终端不记录预约结果。',
      },
      {
        kind: 'notice',
        tone: 'info',
        icon: 'map-pinned',
        text: '选择场次后可查看场馆导览与参会准备。',
      },
    ],
  })

  /* ── 11 招聘会详情 ─────────────────────────────────────── */
  P.add({
    id: 11,
    title: '2026 夏季综合招聘会',
    section: 'fairs',
    template: 'detail',
    kicker: '招聘会',
    summary: '场次详情、展位企业、场馆导览与参会准备。',
    goal: '了解场次关键信息，并进入导览、企业、材料准备等下一步。',
    action: '预约 / 查看展位 / 准备材料',
    mapping: '融合旧 11 详情 / 44-45 展位企业 / 46 导览 / 47-48 参会准备。',
    task: '2026 夏季综合招聘会',
    taskKicker: '场次详情',
    taskStatus: '8 月 15 日 09:00-15:00 · 广州国际会展中心',
    steps: [],
    deviceState: '内容服务正常',
    deviceOk: true,
    primary: { label: '去来源平台预约', to: '11', confirm: true, external: true, tone: 'source' },
    secondary: { label: '准备参会材料', to: '48' },
    activeTab: 'home',
    sections: [
      {
        title: '场次信息',
        caption: '官方或第三方公开来源',
        kind: 'text',
        paragraphs: [
          '面向 2026 届应届毕业生及社会求职者，参展企业约 200 家，覆盖先进制造、现代服务与数字经济等行业。',
          '现场设综合服务台、打印服务点与无障碍通道；具体以主办方现场公示为准。',
        ],
      },
      {
        title: '现场服务',
        caption: '本机提供',
        kind: 'rows',
        items: [
          { title: '场馆导览', text: '平面图与展位索引', to: '46', state: '可查看' },
          { title: '参会准备单', text: '按你的目标生成材料清单并打印', to: '48', state: '可办理' },
          { title: '展位企业', text: '参展企业与在招岗位', to: '44', state: '可查看' },
        ],
      },
    ],
    rail: [
      {
        kind: 'photo',
        captionText: '招聘会现场公开服务信息。',
      },
      {
        kind: 'truth',
        text: '本终端不代收简历、不代预约；预约与投递都在来源平台完成。',
      },
    ],
  })

  /* ── 12 政策服务 ───────────────────────────────────────── */
  P.add({
    id: 12,
    title: '政策服务',
    section: 'interview',
    template: 'collection',
    kicker: '政策服务',
    summary: '官方政策、材料清单与办理来源，信息只读展示。',
    goal: '让用户找到相关官方政策并了解材料要求。',
    action: '查看政策详情',
    mapping: '融合旧 12 政策服务；政策详情路由与材料清单打印按真实能力接线。',
    task: '浏览政策',
    taskKicker: '官方信息',
    taskStatus: '政策来自官方公开来源，仅作信息展示',
    steps: [],
    deviceState: '内容服务正常',
    deviceOk: true,
    activeTab: 'home',
    sections: [
      {
        title: '政策分类',
        caption: '来源：政府公开信息',
        kind: 'rows',
        items: [
          { title: '就业补贴政策', text: '一次性求职创业补贴 · 申领条件与材料', to: '12', state: '可查看' },
          { title: '社保与公积金', text: '灵活就业参保指南 · 官方办理来源', to: '12', state: '可查看' },
          { title: '档案与登记', text: '档案转递、就业登记 · 官方指引', to: '12', state: '可查看' },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'info',
        icon: 'landmark',
        text: '政策信息仅作展示；实际申领以官方窗口与最新政策为准。',
      },
      {
        kind: 'truth',
        text: '政策详情页与材料清单打印按真实内容服务能力开放。',
      },
    ],
  })

  /* ── 13 AI 顾问：任务计划板（非聊天） ──────────────────── */
  P.add({
    id: 13,
    title: 'AI 顾问',
    section: 'foundation',
    template: 'home',
    kicker: 'AI 顾问',
    summary: '基于你的目标整理办理顺序；每步都由你确认后才执行。',
    goal: '把「说清目标 → 建议顺序 → 逐步确认」做成可执行任务板，不用聊天框。',
    action: '确认或调整办理顺序',
    mapping: '融合旧 13 AI 顾问 / 76 AI 方案确认；AI 只整理信息与顺序，不自动执行高风险动作。',
    task: '周五参加招聘会，优化简历并打印 5 份',
    taskKicker: '本次目标',
    taskStatus: '系统已识别目标，建议按以下顺序办理',
    steps: [
      { label: '说清目标', done: true },
      { label: '确认计划', active: true },
      { label: '逐步办理' },
      { label: '结果沉淀' },
    ],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '按此顺序开始办理', to: '05', confirm: true },
    secondary: { label: '重新描述目标', to: '01' },
    activeTab: 'advisor',
    sections: [
      {
        title: '建议办理计划',
        caption: 'AI 只整理信息，动作由你确认',
        kind: 'plan',
        headless: true,
        items: [
          {
            title: '优化简历',
            status: '下一步',
            next: true,
            text: '先完成简历诊断，再按建议稿确认优化；结果保存到我的简历。',
            actions: [{ label: '开始', to: '05' }],
          },
          {
            title: '生成参会准备单',
            status: '待办理',
            text: '按目标岗位与招聘会生成材料清单，可打印带走。',
            actions: [{ label: '查看准备单', to: '48' }],
          },
          {
            title: '打印简历 5 份',
            status: '待办理',
            text: '优化版简历确认后进入打印参数与支付；打印完成前不会出纸。',
            actions: [{ label: '去打印', to: '03' }],
          },
          {
            title: '查看场馆导览',
            status: '可选',
            text: '了解展位分布与服务点，现场可随时回看。',
            actions: [{ label: '查看导览', to: '46' }],
          },
        ],
      },
    ],
    rail: [
      {
        kind: 'photo',
        advisor: true,
        captionText: '小青：求职顾问 · 只整理信息，不替你决定。',
      },
      {
        kind: 'truth',
        text: 'AI 不会自动支付、打印、删除文件或打开第三方来源；每个动作都需你确认。',
      },
    ],
  })

  /* ── 14 我的：个人中心入口与概览 ───────────────────────── */
  P.add({
    id: 14,
    title: '我的',
    section: 'account',
    template: 'directory',
    kicker: '我的',
    summary: '本人服务入口与概览；明细归位到对应业务页面。',
    goal: '快速进入本人简历、文档、订单、权益等入口，概览真实数量。',
    action: '选择要查看的板块',
    mapping: '融合旧 14 我的主页；明细归位对应业务页，不在本页堆叠资产中心。',
    task: '本人服务',
    taskKicker: '个人中心',
    taskStatus: '已登录 · 手机号 138****5678',
    steps: [],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '继续上次办理', to: '04', confirm: false },
    secondary: { label: '切换账号', to: '15' },
    activeTab: 'account',
    sections: [
      {
        title: '概览',
        caption: '来自真实数据',
        kind: 'metrics',
        items: [
          ['我的简历', '3 份'],
          ['我的文档', '8 份'],
          ['打印订单', '2 笔'],
          ['AI 服务记录', '5 条'],
        ],
      },
      {
        title: '服务入口',
        caption: '明细归位对应业务页',
        kind: 'rows',
        items: [
          { title: '我的简历', text: '诊断、生成、优化记录', to: '16', state: '可查看' },
          { title: '我的文档', text: '文件保存期限与签名盖章', to: '17', state: '可查看' },
          { title: '我的打印订单', text: '进行中与历史订单', to: '18', state: '可查看' },
          { title: '我的收藏', text: '岗位、招聘会、政策收藏', to: '20', state: '可查看' },
          { title: '我的权益', text: '数字与终端权益', to: '21', state: '可查看' },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'info',
        icon: 'shield-check',
        text: '公共终端隐私保护：离场或超时将自动清空本次会话。',
      },
      {
        kind: 'notice',
        tone: 'warn',
        icon: 'timer',
        text: '进行中订单 1 笔：打印 简历-2026-08.pdf，请勿提前离开。',
      },
    ],
  })

  /* ── 15 登录 ───────────────────────────────────────────── */
  P.add({
    id: 15,
    title: '登录 / 注册',
    section: 'foundation',
    template: 'state',
    kicker: '本人服务',
    summary: '手机号验证码或手机扫码登录，公共终端使用后自动清场。',
    goal: '安全登录本人账号，登录后同步本人简历、订单与权益。',
    action: '输入手机号并获取验证码',
    mapping: '融合旧 15 登录 / 62-63 手机接力；登录成功回原页面。',
    task: '登录本人账号',
    taskKicker: '身份确认',
    taskStatus: '登录后可使用本人资产与继续办理',
    steps: [],
    deviceState: '短信服务正常',
    deviceOk: true,
    primary: { label: '获取验证码并登录', to: '14', confirm: false },
    secondary: { label: '手机扫码登录', to: '62' },
    activeTab: 'account',
    sections: [
      {
        title: '手机号登录',
        caption: '登录即同意用户协议与隐私政策',
        kind: 'form',
        fields: [
          { label: '手机号', value: '', hint: '仅用于本次登录，公共终端不保存' },
          { label: '验证码', value: '', hint: '6 位数字验证码', hintIcon: 'message-circle' },
        ],
      },
      {
        title: '隐私说明',
        caption: '公共终端',
        kind: 'notice',
        headless: true,
        tone: 'info',
        icon: 'shield-check',
        text: '公共终端登录信息只在内存会话中使用；离场、超时或切换账号后自动清空，不写入长期浏览器存储。',
      },
    ],
    rail: [
      {
        kind: 'qr',
        title: '手机扫码登录',
        caption: '用已登录小程序扫码，无需输入验证码。',
        text: '二维码示意\n仅承接当前一体机会话',
      },
      {
        kind: 'truth',
        text: '不显示完整手机号；验证码由服务端短信真实发送。',
      },
    ],
  })
})(window.KioskPrototype)
