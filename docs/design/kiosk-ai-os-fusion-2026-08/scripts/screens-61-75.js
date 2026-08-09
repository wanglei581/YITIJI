;(function (P) {
  /* ── 61 断网 / 设备异常 ────────────────────────────────── */
  P.add({
    id: 61,
    title: '暂时无法继续打印',
    section: 'foundation',
    template: 'state',
    kicker: '系统',
    summary: '网络或设备异常，正在恢复；不影响已确认的订单安全。',
    goal: '异常时诚实说明，给用户恢复路径。',
    action: '重试或现场求助',
    mapping: '融合旧 61 断网异常 / 34A 扫描离线；不伪造在线状态。',
    task: '系统状态',
    taskKicker: '异常处理',
    taskStatus: '网络或设备异常',
    steps: [],
    bottomNav: false,
    deviceState: '网络异常',
    deviceErr: true,
    primary: { label: '重新检查', to: '61', confirm: false },
    secondary: { label: '联系现场工作人员', to: '58' },
    activeTab: 'home',
    sections: [
      {
        title: '异常说明',
        caption: '诚实状态',
        kind: 'progress',
        symbol: '！',
        headline: '网络或设备暂时不可用',
        text: '已确认的订单不会被重复扣款或重复出纸；网络恢复后任务继续，也可联系现场工作人员协助。',
        animate: false,
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'warn',
        icon: 'life-buoy',
        text: '请保留订单号；恢复后可在「我的打印订单」查看任务状态。',
      },
    ],
  })

  /* ── 62 手机上传（390×844 手机接力页） ─────────────────── */
  P.add({
    id: 62,
    title: '手机上传',
    section: 'foundation',
    template: 'state',
    kicker: '手机接力',
    summary: '手机扫码后上传文件到 01 号机，一次会话不建立第二套产品。',
    goal: '让手机安全地把文件交给当前一体机会话。',
    action: '扫码上传',
    mapping: '融合旧 62 手机上传 / 77 打印上传；只承接当前一体机会话。',
    task: '手机上传',
    taskKicker: '当前会话',
    taskStatus: '文件将上传到 01 号机本次会话',
    steps: [],
    bottomNav: false,
    deviceState: '本机在线',
    deviceOk: true,
    primary: { label: '扫码上传文件', to: '62', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '手机接力上传',
        caption: '仅本次会话',
        kind: 'qr',
        headless: true,
        title: '用手机扫码上传',
        caption: '上传的文件只进入 01 号机当前会话，离场自动清空。',
        text: '二维码示意\n上传到 01 号机',
      },
    ],
    rail: [
      {
        kind: 'truth',
        text: '手机页只承接当前一体机会话，不是微信小程序，也不建立第二套产品导航。',
      },
    ],
  })

  /* ── 63 手机登录确认（390×844 手机页） ─────────────────── */
  P.add({
    id: 63,
    title: '手机登录确认',
    section: 'foundation',
    template: 'state',
    kicker: '手机接力',
    summary: '在手机上确认登录本一体机，不输入密码到公共屏幕。',
    goal: '扫码后在手机确认，避免公共屏幕输入敏感信息。',
    action: '在手机确认登录',
    mapping: '融合旧 63 手机登录；确认后本机进入已登录会话。',
    task: '手机登录',
    taskKicker: '当前会话',
    taskStatus: '等待手机确认',
    steps: [],
    bottomNav: false,
    deviceState: '本机在线',
    deviceOk: true,
    primary: { label: '在手机上确认', to: '14', confirm: false },
    activeTab: 'account',
    sections: [
      {
        title: '手机确认登录',
        caption: '本机屏幕不显示验证码',
        kind: 'qr',
        headless: true,
        title: '扫码后在手机确认',
        caption: '确认后本机登录本人账号；公共终端会话自动清场。',
        text: '二维码示意\n手机确认登录',
      },
    ],
  })

  /* ── 64 打印预览（并入 03，保留映射） ──────────────────── */
  P.add({
    id: 64,
    title: '打印预览',
    section: 'print',
    template: 'progress',
    kicker: '打印扫描',
    summary: '旧 64 打印预览已并入打印参数工作台，本页保留映射。',
    goal: '预览与参数同屏，减少来回切换。',
    action: '前往打印参数',
    mapping: '功能并入 03 文件预览；编号 64 仅为兼容映射。',
    task: '打印预览',
    taskKicker: '流程映射',
    taskStatus: '已并入打印参数流程',
    steps: [],
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
        text: '文件预览完整显示在打印参数页主区，参数与价格同屏确认。',
      },
    ],
  })

  /* ── 65 打印确认单 ─────────────────────────────────────── */
  P.add({
    id: 65,
    title: '打印确认单',
    section: 'print',
    template: 'workbench',
    kicker: '文档打印',
    summary: '最后检查文件、参数与敏感信息，确认后进入支付。',
    goal: '不可逆动作前最后确认，避免误打。',
    action: '确认进入支付',
    mapping: '融合旧 65 打印确认；文件与页码正确、敏感信息确认后才放行。',
    task: '打印 简历-2026-08.pdf · 2 份',
    taskKicker: '最后检查',
    taskStatus: '等待确认',
    steps: [
      { label: '选择文件', done: true },
      { label: '设置参数', done: true },
      { label: '确认支付', active: true },
      { label: '取件' },
    ],
    deviceState: '打印机在线',
    deviceOk: true,
    primary: { label: '确认无误，进入支付', to: '32', confirm: true },
    secondary: { label: '返回修改', to: '03' },
    helper: '确认后进入服务端核价与支付；支付前不会出纸。',
    activeTab: 'home',
    sections: [
      {
        title: '确认清单',
        caption: '逐项核对',
        kind: 'checklist',
        headless: true,
        items: [
          { title: '文件和页码正确', text: '简历-2026-08.pdf · 全部 1-3 页', missing: false },
          { title: '参数已确认', text: '双面长边 · 2 份 · A4', missing: false },
          { title: '敏感信息已确认', text: '页面按规则显示，无未授权展示', missing: false },
          { title: '理解付款后仍需等待真实出纸', text: '支付不代表立即完成，需排队出纸', missing: false },
        ],
      },
    ],
    rail: [
      {
        kind: 'price',
        label: '预计费用',
        amount: '¥3.60',
        note: '权益抵扣在支付页确认；金额以服务端实时核价为准。',
      },
      {
        kind: 'truth',
        text: '确认动作会写入审计；不确认不出纸。',
      },
    ],
  })

  /* ── 66 图片合并 PDF ───────────────────────────────────── */
  P.add({
    id: 66,
    title: '图片合并 PDF',
    section: 'print',
    template: 'workbench',
    kicker: '打印扫描',
    summary: '多张图片按顺序合并为一个 PDF 后打印。',
    goal: '图片转 PDF 真实可用，缩略图可见。',
    action: '选择图片并合并',
    mapping: '融合旧 66 图片转 PDF；缩略图真实解码显示。',
    task: '图片合并 PDF',
    taskKicker: '文件工具',
    taskStatus: '已选 3 张图片',
    steps: [
      { label: '选择图片', active: true },
      { label: '合并预览' },
      { label: '打印或保存' },
    ],
    deviceState: '打印机在线',
    deviceOk: true,
    primary: { label: '合并并预览', to: '03', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '已选图片',
        caption: '可调整顺序',
        kind: 'rows',
        items: [
          { title: 'IMG_001.jpg', text: '2.1 MB · 竖版', to: '66', state: '可调整' },
          { title: 'IMG_002.jpg', text: '1.8 MB · 竖版', to: '66', state: '可调整' },
          { title: 'IMG_003.jpg', text: '2.4 MB · 横版', to: '66', state: '可调整' },
        ],
      },
      {
        title: '说明',
        caption: '转换说明',
        kind: 'notice',
        headless: true,
        tone: 'info',
        icon: 'repeat',
        text: '合并为 PDF 后可预览、打印或保存到我的文档；图片原文件不会被修改。',
      },
    ],
  })

  /* ── 67 签名盖章排版 ───────────────────────────────────── */
  P.add({
    id: 67,
    title: '签名盖章排版',
    section: 'print',
    template: 'workbench',
    kicker: '打印扫描',
    summary: '在文件上排版签名与盖章区域后打印。',
    goal: '排版结果真实可见，打印前确认。',
    action: '选择签名位置',
    mapping: '融合旧 67 签名盖章；排版不伪造电子签章效力。',
    task: '签名盖章排版',
    taskKicker: '文件工具',
    taskStatus: '已选择文件，等待排版',
    steps: [
      { label: '选择文件', active: true },
      { label: '排版确认' },
      { label: '打印' },
    ],
    deviceState: '打印机在线',
    deviceOk: true,
    primary: { label: '确认排版并打印', to: '03', confirm: true },
    activeTab: 'home',
    sections: [
      {
        title: '排版说明',
        caption: '适用范围',
        kind: 'notice',
        headless: true,
        tone: 'warn',
        icon: 'pen-line',
        text: '本工具只做签名/盖章区域的排版占位，不产生法律意义上的电子签章；正式签署以机构要求为准。',
      },
      {
        title: '排版设置',
        caption: '按真实能力',
        kind: 'segments',
        items: ['页脚签名区', '指定坐标', '骑缝章占位'],
        selected: 0,
      },
    ],
  })

  /* ── 68 证件照排版 ─────────────────────────────────────── */
  P.add({
    id: 68,
    title: '证件照排版',
    section: 'print',
    template: 'workbench',
    kicker: '打印扫描',
    summary: '按证件照规格排版后打印。',
    goal: '规格真实可选，排版可见。',
    action: '选择规格并排版',
    mapping: '融合旧 68 证件照；规格按常用证件尺寸。',
    task: '证件照排版',
    taskKicker: '文件工具',
    taskStatus: '即将上线',
    steps: [],
    deviceState: '打印机在线',
    deviceOk: true,
    primary: { label: '选择规格排版', to: '68', confirm: false, disabled: true },
    activeTab: 'home',
    sections: [
      {
        title: '规格选择',
        caption: '常用证件尺寸',
        kind: 'rows',
        items: [
          { title: '一寸（25×35mm）', text: '常用 · 打印 8 张 / 版', to: '68', state: '即将上线' },
          { title: '二寸（35×49mm）', text: '常用 · 打印 4 张 / 版', to: '68', state: '即将上线' },
        ],
      },
      {
        title: '说明',
        caption: '诚实状态',
        kind: 'notice',
        headless: true,
        tone: 'warn',
        icon: 'image',
        text: '证件照排版能力尚未开放；开放前不会做成可点击占位流程。',
      },
    ],
  })

  /* ── 69 校园迎新欢迎页（并入 51/52，保留映射） ─────────── */
  P.add({
    id: 69,
    title: '迎新服务',
    section: 'fairs',
    template: 'progress',
    kicker: '校园',
    summary: '旧 69 迎新欢迎页已并入智慧校园服务，本页保留映射。',
    goal: '迎新内容统一在智慧校园专区。',
    action: '前往智慧校园',
    mapping: '功能并入 51/52；编号 69 仅为兼容映射。',
    task: '迎新服务',
    taskKicker: '流程映射',
    taskStatus: '已并入智慧校园专区',
    steps: [],
    deviceState: '内容服务正常',
    deviceOk: true,
    primary: { label: '前往智慧校园', to: '51', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '映射说明',
        caption: '不新增重复页面',
        kind: 'notice',
        headless: true,
        tone: 'info',
        icon: 'git-merge',
        text: '迎新服务统一由智慧校园后台开关控制，避免重复欢迎页。',
      },
    ],
  })

  /* ── 70 新生洞察（并入 51，保留映射） ──────────────────── */
  P.add({
    id: 70,
    title: '新生洞察',
    section: 'fairs',
    template: 'progress',
    kicker: '校园',
    summary: '旧 70 新生洞察已并入智慧校园专区，本页保留映射。',
    goal: '洞察内容统一入口。',
    action: '前往智慧校园',
    mapping: '功能并入 51；编号 70 仅为兼容映射。',
    task: '新生洞察',
    taskKicker: '流程映射',
    taskStatus: '已并入智慧校园专区',
    steps: [],
    deviceState: '内容服务正常',
    deviceOk: true,
    primary: { label: '前往智慧校园', to: '51', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '映射说明',
        caption: '不新增重复页面',
        kind: 'notice',
        headless: true,
        tone: 'info',
        icon: 'git-merge',
        text: '新生洞察与校园服务合并展示，不单独占一个入口。',
      },
    ],
  })

  /* ── 71 我的活动 ───────────────────────────────────────── */
  P.add({
    id: 71,
    title: '我的活动',
    section: 'account',
    template: 'collection',
    kicker: '我的',
    summary: '已领取或参与的活动记录。',
    goal: '活动记录可回看。',
    action: '查看活动',
    mapping: '归位旧 71 我的活动；活动详情与领取结果真实展示。',
    task: '我的活动',
    taskKicker: '个人中心',
    taskStatus: '2 项记录',
    steps: [],
    deviceState: '本机服务正常',
    deviceOk: true,
    activeTab: 'account',
    sections: [
      {
        title: '活动记录',
        caption: '本人真实数据',
        kind: 'rows',
        items: [
          { title: '求职季 AI 服务体验', text: '已领取 1 次简历优化 · 有效期至 2026-09-06', to: '72', state: '查看' },
          { title: '校园打印额度赠送', text: '已领取 10 页 · 已使用 4 页', to: '72', state: '查看' },
        ],
      },
    ],
  })

  /* ── 72 活动详情 ───────────────────────────────────────── */
  P.add({
    id: 72,
    title: '求职季 AI 服务体验',
    section: 'account',
    template: 'detail',
    kicker: '活动',
    summary: '活动规则、领取状态与权益去向。',
    goal: '活动规则清楚，权益去向可查。',
    action: '查看权益',
    mapping: '归位旧 72 活动详情；领取后权益进入我的权益。',
    task: '活动详情',
    taskKicker: '权益活动',
    taskStatus: '已领取 · 权益已到账',
    steps: [],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '查看我的权益', to: '21', confirm: false },
    activeTab: 'account',
    sections: [
      {
        title: '活动规则',
        caption: '真实规则',
        kind: 'text',
        paragraphs: [
          '活动期间每位用户可领取 1 次免费简历优化，领取后 30 天内有效；未使用的权益按规则返还。',
        ],
      },
      {
        title: '领取状态',
        caption: '真实状态',
        kind: 'checklist',
        headless: true,
        items: [
          { title: '已领取', text: '2026-08-07 09:20 领取', missing: false },
          { title: '权益去向', text: '已进入「我的权益」AI 简历优化次数', missing: false },
          { title: '有效期', text: '至 2026-09-06', missing: false },
        ],
      },
    ],
  })

  /* ── 73 顾问通话（并入 13，保留映射） ──────────────────── */
  P.add({
    id: 73,
    title: '顾问通话',
    section: 'foundation',
    template: 'progress',
    kicker: 'AI 顾问',
    summary: '旧 73 顾问通话能力由 AI 顾问任务板承接，本页保留映射。',
    goal: '语音能力按设备与授权真实开放。',
    action: '前往 AI 顾问',
    mapping: '语音通话能力并入 13；编号 73 仅为兼容映射。',
    task: '顾问通话',
    taskKicker: '流程映射',
    taskStatus: '已并入 AI 顾问',
    steps: [],
    deviceState: '本机服务正常',
    deviceOk: true,
    primary: { label: '前往 AI 顾问', to: '13', confirm: false },
    activeTab: 'advisor',
    sections: [
      {
        title: '映射说明',
        caption: '不新增重复页面',
        kind: 'notice',
        headless: true,
        tone: 'info',
        icon: 'git-merge',
        text: '顾问交互统一在 AI 顾问任务板；语音会话按 TRTC 真实能力与授权开放。',
      },
    ],
  })

  /* ── 74 线下岗位详情 ───────────────────────────────────── */
  P.add({
    id: 74,
    title: '岗位详情（线下机构）',
    section: 'jobs',
    template: 'detail',
    kicker: '岗位信息',
    summary: '线下服务机构岗位，到店咨询指引与打印带走。',
    goal: '线下岗位只做信息展示与到店指引。',
    action: '查看机构信息',
    mapping: '融合旧 74 线下岗位详情 / 75 线下机构；不代收简历、不代收费用。',
    task: '岗位详情',
    taskKicker: '线下机构',
    taskStatus: '到店咨询 · 信息展示',
    steps: [],
    deviceState: '内容服务正常',
    deviceOk: true,
    primary: { label: '打印岗位信息带走', to: '03', confirm: false },
    activeTab: 'home',
    sections: [
      {
        title: '岗位信息',
        caption: '线下机构发布',
        kind: 'text',
        paragraphs: [
          'XX 人力资源服务中心发布的岗位信息；具体招聘流程与要求请到店咨询。',
        ],
      },
      {
        title: '机构信息',
        caption: '到店指引',
        kind: 'checklist',
        headless: true,
        items: [
          { title: '机构名称', text: 'XX 人力资源服务中心 · 门店地址：天河区 XX 路 88 号', missing: false },
          { title: '营业时间', text: '周一至周五 09:00-17:00', missing: false },
          { title: '服务边界', text: '本终端不代收简历、不代收费用、不做预约登记', missing: false },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'warn',
        icon: 'store',
        text: '线下机构仅信息展示 + 到店咨询 + 打印带走；不形成预约或投递闭环。',
      },
    ],
  })

  /* ── 75 线下机构 ───────────────────────────────────────── */
  P.add({
    id: 75,
    title: '线下服务机构',
    section: 'jobs',
    template: 'collection',
    kicker: '岗位信息',
    summary: '线下服务机构信息，到店咨询指引。',
    goal: '让用户找到附近线下服务机构。',
    action: '查看机构',
    mapping: '融合旧 75 线下机构；信息展示 + 到店指引。',
    task: '线下机构',
    taskKicker: '来源信息',
    taskStatus: '机构信息展示',
    steps: [],
    deviceState: '内容服务正常',
    deviceOk: true,
    activeTab: 'home',
    sections: [
      {
        title: '机构列表',
        caption: '公开机构信息',
        kind: 'rows',
        items: [
          { title: 'XX 人力资源服务中心', text: '天河区 XX 路 88 号 · 岗位信息到店咨询', to: '74', state: '查看' },
          { title: 'XX 就业服务站', text: '越秀区 XX 街 12 号 · 岗位信息到店咨询', to: '74', state: '查看' },
        ],
      },
    ],
    rail: [
      {
        kind: 'notice',
        tone: 'warn',
        icon: 'store',
        text: '机构信息只做展示；本终端不代收简历、不代收费用、不做预约登记。',
      },
    ],
  })
})(window.KioskPrototype)
