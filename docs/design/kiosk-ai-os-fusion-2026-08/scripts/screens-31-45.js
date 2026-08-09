;(function (P) {
  /* ── 31 材料检查（并入 03 工作台，保留编号映射） ───────── */
  P.add({
    id: 31,
    title: '材料检查',
    section: 'print',
    template: 'progress',
    kicker: '打印扫描',
    summary: '旧 31 材料检查已并入打印参数工作台，本页保留映射。',
    goal: '检查结果在打印前自动完成并展示。',
    action: '前往打印参数',
    mapping: '功能并入 03「材料检查结果」；编号 31 仅为兼容映射。',
    task: '材料检查',
    taskKicker: '流程映射',
    taskStatus: '已并入打印参数流程',
    steps: [
      { label: '选择文件', done: true },
      { label: '设置参数', active: true },
      { label: '确认支付' },
      { label: '取件' },
    ],
    deviceState: '打印机在线',
    deviceOk: true,
    primary: { label: '前往打印参数', to: '03', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '映射说明',
        caption: '不新增重复页面',
        kind: 'notice',
        headless: true,
        tone: 'info',
        icon: 'git-merge',
        text: '文件可读性、敏感信息与页面范围检查已在打印参数页内完成，避免重复步骤。',
      },
    ],
  })

  /* ── 32 收银台：报价与支付确认 ────────────────────────── */
  P.add({
    id: 32,
    title: '确认支付',
    section: 'print',
    template: 'workbench',
    kicker: '文档打印',
    summary: '最终报价、权益抵扣与支付方式，确认后生成订单。',
    goal: '支付前最后一次核对，金额与权益真实可查。',
    action: '确认支付',
    mapping: '融合旧 32 收银台 / 32A 支付失败；支付状态由服务端真实回调。',
    task: '打印 简历-2026-08.pdf · 2 份',
    taskKicker: '确认支付',
    taskStatus: '报价已生成，等待确认',
    steps: [
      { label: '选择文件', done: true },
      { label: '设置参数', done: true },
      { label: '确认支付', active: true },
      { label: '取件' },
    ],
    deviceState: '支付服务正常',
    deviceOk: true,
    primary: { label: '确认并支付 ¥2.60', to: '04', confirm: true },
    secondary: { label: '返回修改参数', to: '03' },
    helper: '支付成功后才进入打印队列；未支付不会出纸。',
    activeTab: 'home',
    sections: [
      {
        title: '订单摘要',
        caption: '服务端实时核价',
        kind: 'checklist',
        headless: true,
        items: [
          { title: '文件', text: '简历-2026-08.pdf · 3 页 · 2 份 · 双面', missing: false },
          { title: '原价', text: '¥3.60', missing: false },
          { title: '权益抵扣', text: '打印页数额度 -20 页（¥1.00）', missing: false },
          { title: '应付', text: '¥2.60', missing: false },
        ],
      },
      {
        title: '支付方式',
        caption: '扫码支付',
        kind: 'qr',
        headless: true,
        title: '微信扫码支付',
        caption: '支付完成后自动进入打印队列',
        text: '二维码示意\n¥2.60',
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'warn',
        icon: 'timer',
        text: '支付超时订单将自动关闭；已支付但未到机核验的订单按规则退款或返还权益。',
      },
      {
        kind: 'truth',
        text: '金额以服务端核价为准；支付、退款与权益核销均幂等、可对账。',
      },
    ],
  })

  /* ── 33 打印完成取件 ───────────────────────────────────── */
  P.add({
    id: 33,
    title: '打印完成',
    section: 'print',
    template: 'progress',
    kicker: '文档打印',
    summary: '出纸已确认，凭取件码取件，订单进入历史。',
    goal: '完成态真实可信，取件后可继续下一步。',
    action: '取件或继续办理',
    mapping: '融合旧 33 完成取件 / 4 完成页；只有真实出纸事件才显示完成。',
    task: '打印 简历-2026-08.pdf · 2 份',
    taskKicker: '已完成',
    taskStatus: '打印机已回传出纸完成',
    steps: [
      { label: '选择文件', done: true },
      { label: '设置参数', done: true },
      { label: '确认支付', done: true },
      { label: '打印取件', done: true },
    ],
    deviceState: '打印机在线 · 空闲',
    deviceOk: true,
    primary: { label: '继续优化简历', to: '07', confirm: false },
    secondary: { label: '查看订单', to: '18' },
    activeTab: 'home',
    sections: [
      {
        title: '已完成',
        caption: '真实出纸事件',
        kind: 'progress',
        symbol: '完',
        headline: '打印完成，请取件',
        text: '3 页 × 2 份 · 双面 · 本机下方取件口，凭订单号 JY-20260807-0012。',
        animate: false,
      },
      {
        title: '下一步建议',
        caption: '基于本人服务状态',
        kind: 'rows',
        headless: true,
        items: [
          { title: '继续优化简历', text: '刚打印的简历还有 3 项建议可优化', to: '07', state: '推荐' },
          { title: '准备参会材料', text: '周五招聘会材料清单可提前准备', to: '48', state: '可办理' },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'ok',
        icon: 'circle-check-big',
        text: '订单与取件记录已保存，可在「我的打印订单」回看。',
      },
      {
        kind: 'truth',
        text: '仅推荐基于真实服务状态的下一步；不推送投递或招聘结果内容。',
      },
    ],
  })

  /* ── 34 扫描开始 ───────────────────────────────────────── */
  P.add({
    id: 34,
    title: '纸质扫描',
    section: 'print',
    template: 'workbench',
    kicker: '打印扫描',
    summary: '确认扫描类型与去向，扫描在本机完成。',
    goal: '明确扫描目的与保存方式，避免误操作。',
    action: '开始扫描',
    mapping: '融合旧 34 开始 / 35 设置；扫描结果预览后选择保存/识别/打印。',
    task: '纸质扫描',
    taskKicker: '开始办理',
    taskStatus: '扫描在本机完成，不自动上传第三方',
    steps: [
      { label: '选择类型', active: true },
      { label: '扫描中' },
      { label: '预览结果' },
      { label: '保存 / 打印' },
    ],
    deviceState: '扫描仪在线',
    deviceOk: true,
    primary: { label: '开始扫描', to: '36', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '扫描类型',
        caption: '决定后续处理',
        kind: 'choices',
        items: [
          { title: '材料扫描', text: '普通文档扫描为 PDF', selected: true },
          { title: '证件复印', text: '身份证等证件扫描', selected: false },
          { title: 'AI 简历识别', text: '扫描后识别并进入简历诊断', selected: false },
        ],
      },
      {
        title: '扫描设置',
        caption: '按设备真实能力',
        kind: 'segments',
        items: ['单面', '双面'],
        selected: 0,
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'warn',
        icon: 'scan-line',
        text: '扫描不是云端遥控：扫描在本机完成，结果按你的选择保存、识别或打印。',
      },
      {
        kind: 'truth',
        text: '扫描结果属于本人；高敏文件保存期限更短。',
      },
    ],
  })

  /* ── 35 扫描设置（并入 34，保留编号映射） ─────────────── */
  P.add({
    id: 35,
    title: '扫描设置',
    section: 'print',
    template: 'progress',
    kicker: '打印扫描',
    summary: '旧 35 扫描设置已并入扫描开始页，本页保留映射。',
    goal: '设置与类型选择同屏完成。',
    action: '前往扫描开始',
    mapping: '功能并入 34；编号 35 仅为兼容映射。',
    task: '扫描设置',
    taskKicker: '流程映射',
    taskStatus: '已并入扫描开始流程',
    steps: [],
    deviceState: '扫描仪在线',
    deviceOk: true,
    primary: { label: '前往扫描', to: '34', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '映射说明',
        caption: '不新增重复页面',
        kind: 'notice',
        headless: true,
        tone: 'info',
        icon: 'git-merge',
        text: '扫描类型与单双面设置已合并到「纸质扫描」首页，减少无意义的中间步骤。',
      },
    ],
  })

  /* ── 36 扫描进度 ───────────────────────────────────────── */
  P.add({
    id: 36,
    title: '扫描中',
    section: 'print',
    template: 'progress',
    kicker: '打印扫描',
    summary: '扫描仪正在工作，完成后自动进入预览。',
    goal: '扫描进度真实显示，异常可重试。',
    action: '等待扫描完成',
    mapping: '融合旧 36 扫描进度；状态来自扫描仪真实回传。',
    task: '纸质扫描',
    taskKicker: '处理中',
    taskStatus: '正在扫描 第 2/3 页',
    steps: [
      { label: '选择类型', done: true },
      { label: '扫描中', active: true },
      { label: '预览结果' },
      { label: '保存 / 打印' },
    ],
    deviceState: '扫描仪在线 · 处理中',
    deviceOk: true,
    primary: { label: '查看扫描结果', to: '37', confirm: false, disabled: true },
    activeTab: 'home',
    sections: [
      {
        title: '扫描进度',
        caption: '设备真实回传',
        kind: 'progress',
        symbol: '扫',
        headline: '正在扫描 第 2/3 页',
        text: '请保持文件在进纸器内，扫描完成后自动进入结果预览。',
        animate: true,
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'info',
        icon: 'life-buoy',
        text: '卡纸或扫描失败时，请按提示取出文件后重试；不会重复计费。',
      },
    ],
  })

  /* ── 37 扫描结果 ───────────────────────────────────────── */
  P.add({
    id: 37,
    title: '扫描结果',
    section: 'print',
    template: 'workbench',
    kicker: '打印扫描',
    summary: '预览扫描结果，选择保存、AI 识别或打印。',
    goal: '结果可预览、可处理、有归宿。',
    action: '选择结果去向',
    mapping: '融合旧 37 扫描结果；AI 识别进入简历流程，保存进入我的文档。',
    task: '扫描结果',
    taskKicker: '已完成',
    taskStatus: '3 页扫描完成，请选择去向',
    steps: [
      { label: '选择类型', done: true },
      { label: '扫描中', done: true },
      { label: '预览结果', active: true },
      { label: '保存 / 打印' },
    ],
    deviceState: '扫描仪在线 · 空闲',
    deviceOk: true,
    primary: { label: '保存到我的文档', to: '17', confirm: true },
    secondary: { label: 'AI 简历识别', to: '05' },
    helper: '扫描结果只按你选择的方式处理。',
    activeTab: 'home',
    sections: [
      {
        title: '扫描预览',
        caption: '完整显示，不截断',
        kind: 'document',
        fileName: '扫描-20260807.pdf',
        fileMeta: 'PDF · 3 页 · 2.1 MB',
        activePage: 0,
        pages: [1, 2, 3],
        body: '扫描件第 1 页\n\n（本页为扫描预览示意）\n\n扫描结果按原样保留，不做 OCR 篡改；AI 识别仅在明确选择后进行。',
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'info',
        icon: 'file-user',
        text: '选择「AI 简历识别」后进入简历来源流程，识别结果可回看可删除。',
      },
      {
        kind: 'truth',
        text: '扫描件高敏处理：保存期限更短，到期按策略清理。',
      },
    ],
  })

  /* ── 38 面试设置 ───────────────────────────────────────── */
  P.add({
    id: 38,
    title: '面试设置',
    section: 'interview',
    template: 'workbench',
    kicker: 'AI 面试训练',
    summary: '选择岗位方向、难度与题量，生成私密模拟面试。',
    goal: '一次设置进入可执行的模拟面试，报告可沉淀。',
    action: '开始模拟面试',
    mapping: '融合旧 38 面试设置；会话私密、报告进入 AI 记录。',
    task: 'AI 面试训练',
    taskKicker: '开始办理',
    taskStatus: '设置完成后进入逐题会话',
    steps: [
      { label: '设置', active: true },
      { label: '逐题会话' },
      { label: '报告' },
      { label: '沉淀' },
    ],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '开始模拟面试', to: '39', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '岗位方向',
        caption: '决定提问内容',
        kind: 'form',
        fields: [
          { label: '目标岗位', value: '产品经理', hint: '系统按该岗位生成问题', hintIcon: 'sparkles' },
          { label: '面试轮次', value: '第一轮：业务面' },
        ],
      },
      {
        title: '难度与题量',
        caption: '可自由调整',
        kind: 'segments',
        items: ['容易', '标准', '困难'],
        selected: 1,
      },
      {
        title: '模式',
        caption: '私密练习',
        kind: 'choices',
        items: [
          { title: '文字作答', text: '逐题输入回答，适合安静环境', selected: true },
          { title: '语音作答', text: '朗读回答，语音识别后转文字', selected: false },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'info',
        icon: 'shield-check',
        text: '模拟面试内容私密保存；报告可查看、可删除、可打印。',
      },
      {
        kind: 'truth',
        text: '模拟练习仅供参考，不代表真实面试结果或录用承诺。',
      },
    ],
  })

  /* ── 39 面试会话 ───────────────────────────────────────── */
  P.add({
    id: 39,
    title: '面试进行中',
    section: 'interview',
    template: 'workbench',
    kicker: 'AI 面试训练',
    summary: '逐题作答，完成后生成报告。',
    goal: '一次一道题，进度清楚，可随时退出并保存。',
    action: '作答或下一题',
    mapping: '融合旧 39 面试会话；语音与文字模式按设备能力。',
    task: '产品经理 · 第一轮',
    taskKicker: '模拟面试',
    taskStatus: '第 2/5 题 · 剩余约 4 分钟',
    steps: [
      { label: '设置', done: true },
      { label: '逐题会话', active: true },
      { label: '报告' },
      { label: '沉淀' },
    ],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '完成并查看报告', to: '40', confirm: false },
    secondary: { label: '暂存退出', to: '38' },
    activeTab: 'home',
    sections: [
      {
        title: '第 2 题',
        caption: '产品经理 · 业务面',
        kind: 'text',
        paragraphs: [
          '请描述一次你从用户反馈中发现需求并推动产品迭代的经历；重点说明你的判断依据和最终结果。',
        ],
      },
      {
        title: '你的回答',
        caption: '仅本人可见',
        kind: 'form',
        fields: [
          { label: '回答', value: '', textarea: true, wide: true, hint: '建议按 STAR 法则组织：情境-任务-行动-结果', hintIcon: 'lightbulb' },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'info',
        icon: 'timer',
        text: '作答中途退出会保留草稿，可回到本次会话继续。',
      },
    ],
  })

  /* ── 40 面试报告 ───────────────────────────────────────── */
  P.add({
    id: 40,
    title: '面试报告',
    section: 'interview',
    template: 'detail',
    kicker: 'AI 面试训练',
    summary: '总分、四维度与逐题点评，报告可打印、可沉淀。',
    goal: '报告给出下一次最该改什么，而不是只展示分数。',
    action: '查看点评或打印报告',
    mapping: '融合旧 40 面试报告 / 42 历史报告；报告进入 AI 服务记录。',
    task: '产品经理 · 第一轮',
    taskKicker: '模拟面试',
    taskStatus: '已完成 · 报告已保存',
    steps: [
      { label: '设置', done: true },
      { label: '逐题会话', done: true },
      { label: '报告', active: true },
      { label: '沉淀' },
    ],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '打印报告', to: '03', confirm: false },
    secondary: { label: '再来一轮', to: '38' },
    activeTab: 'home',
    sections: [
      {
        title: '报告概览',
        caption: 'AI 生成 · 仅供参考',
        kind: 'metrics',
        items: [
          ['总分', '82'],
          ['表达', '良好'],
          ['逻辑', '良好'],
          ['岗位匹配', '中等'],
        ],
      },
      {
        title: '逐题点评',
        caption: '重点讲下一次怎么改',
        kind: 'checklist',
        headless: true,
        items: [
          { title: '第 1 题 · 回答完整', text: '情境与行动清晰，结果可补充量化数据', missing: false },
          { title: '第 2 题 · 建议补充', text: '可用「提升 30% 转化」类结果增强说服力', missing: true },
          { title: '第 3 题 · 结构待优化', text: '先结论后展开，控制 90 秒内', missing: true },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'ok',
        icon: 'database',
        text: '报告已保存到 AI 服务记录；可回看、删除或打印。',
      },
      {
        kind: 'truth',
        text: '面试评分仅供参考，不承诺真实面试结果或录用。',
      },
    ],
  })

  /* ── 41 面试技巧 ───────────────────────────────────────── */
  P.add({
    id: 41,
    title: '面试技巧',
    section: 'interview',
    template: 'collection',
    kicker: 'AI 面试训练',
    summary: 'STAR 法则等公开技巧手册，可打印带走。',
    goal: '离线可读的实用手册。',
    action: '查看或打印',
    mapping: '融合旧 41 面试技巧；内容为静态公开资料。',
    task: '面试技巧',
    taskKicker: '参考资料',
    taskStatus: '公开资料 · 可打印',
    steps: [],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '打印技巧手册', to: '03', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '技巧目录',
        caption: '公开资料',
        kind: 'rows',
        items: [
          { title: 'STAR 法则', text: '情境-任务-行动-结果 · 组织回答结构', to: '41', state: '可查看' },
          { title: '常见问题 20 问', text: '自我介绍、离职原因、职业规划等', to: '41', state: '可查看' },
          { title: '反问环节', text: '向面试官提问的注意事项', to: '41', state: '可查看' },
        ],
      },
    ],
  })

  /* ── 42 面试历史 ───────────────────────────────────────── */
  P.add({
    id: 42,
    title: '面试历史',
    section: 'interview',
    template: 'collection',
    kicker: 'AI 面试训练',
    summary: '历史模拟面试记录，可回看报告与继续训练。',
    goal: '历史记录可追溯、可复用。',
    action: '查看历史报告',
    mapping: '归位旧 42 面试历史；报告进入本人 AI 记录。',
    task: '面试历史',
    taskKicker: '模拟面试',
    taskStatus: '3 次记录',
    steps: [],
    deviceState: '本机服务正常',
    deviceOk: true,
    activeTab: 'home',
    sections: [
      {
        title: '历史记录',
        caption: '本人真实数据',
        kind: 'rows',
        items: [
          { title: '产品经理 · 第一轮', text: '2026-08-05 · 82 分', to: '40', state: '可查看' },
          { title: '产品经理 · 行为面', text: '2026-07-28 · 76 分', to: '40', state: '可查看' },
          { title: '前端开发 · 技术面', text: '2026-07-20 · 84 分', to: '40', state: '可查看' },
        ],
      },
    ],
  })

  /* ── 43 招聘会签到（并入详情，保留映射） ──────────────── */
  P.add({
    id: 43,
    title: '招聘会签到',
    section: 'fairs',
    template: 'progress',
    kicker: '招聘会',
    summary: '旧 43 签到已并入招聘会详情，本页保留映射。',
    goal: '签到只引导来源平台，不伪造签到结果。',
    action: '前往招聘会详情',
    mapping: '签到入口并入 11 详情；编号 43 仅为兼容映射。',
    task: '招聘会签到',
    taskKicker: '流程映射',
    taskStatus: '已并入来源预约入口',
    steps: [],
    deviceState: '内容服务正常',
    deviceOk: true,
    primary: { label: '前往招聘会详情', to: '11', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '映射说明',
        caption: '不伪造签到',
        kind: 'notice',
        headless: true,
        tone: 'info',
        icon: 'git-merge',
        text: '预约与签到均为来源平台入口；本终端不记录签到结果。',
      },
    ],
  })

  /* ── 44 展位企业列表 ───────────────────────────────────── */
  P.add({
    id: 44,
    title: '展位企业',
    section: 'fairs',
    template: 'collection',
    kicker: '招聘会',
    summary: '2026 夏季综合招聘会展位企业索引。',
    goal: '按展位快速找到目标企业。',
    action: '查看企业详情',
    mapping: '融合旧 44 展位企业 / 45 企业详情；企业信息为来源公开数据。',
    task: '展位企业',
    taskKicker: '2026 夏季综合招聘会',
    taskStatus: '200 家企业 · 可搜索',
    steps: [],
    deviceState: '内容服务正常',
    deviceOk: true,
    activeTab: 'home',
    sections: [
      {
        title: '企业索引',
        caption: '来源公开数据',
        kind: 'rows',
        items: [
          { title: 'A12 · 某互联网公司', text: '产品经理 / 运营 / 设计在招', to: '45', state: '查看' },
          { title: 'B08 · 某智能制造企业', text: '机械 / 电气 / 供应链在招', to: '45', state: '查看' },
          { title: 'C03 · 某咨询公司', text: '数据分析 / 咨询顾问在招', to: '45', state: '查看' },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'info',
        icon: 'map-pinned',
        text: '展位位置可在「场馆导览」中查看平面图。',
      },
      {
        kind: 'truth',
        text: '企业信息只做来源导览；本终端不收简历、不代投递。',
      },
    ],
  })

  /* ── 45 展位企业详情 ───────────────────────────────────── */
  P.add({
    id: 45,
    title: 'A12 · 某互联网公司',
    section: 'fairs',
    template: 'detail',
    kicker: '招聘会',
    summary: '企业简介、在招岗位与来源说明。',
    goal: '了解企业与在招岗位，按来源方式获取更多信息。',
    action: '查看岗位或来源信息',
    mapping: '融合旧 45 企业详情；岗位联动既有岗位详情。',
    task: '展位企业详情',
    taskKicker: '2026 夏季综合招聘会',
    taskStatus: '来源公开数据 · 展位 A12',
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
          '某互联网公司，业务覆盖内容社区与效率工具，参展岗位以产品、运营、设计为主。',
        ],
      },
      {
        title: '在招岗位',
        caption: '来源平台公开信息',
        kind: 'rows',
        items: [
          { title: '产品经理（校园招聘）', text: '深圳 · 可去来源平台查看', to: '09', state: '查看' },
          { title: '运营专员（校园招聘）', text: '深圳 · 可去来源平台查看', to: '09', state: '查看' },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'warn',
        icon: 'external-link',
        text: '现场投递以招聘会主办方规则为准；本终端不代收简历。',
      },
    ],
  })
})(window.KioskPrototype)
