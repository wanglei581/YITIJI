;(function (P) {
  P.add({
    id: 61,
    title: '网络或设备异常',
    section: 'foundation',
    template: 'state',
    kicker: '诚实异常状态',
    summary: '说明受影响能力、保留内容和恢复动作。',
    goal: '让用户知道能否继续以及数据是否安全。',
    action: '重试或返回仍可用功能',
    mapping: '保留系统态；网络、API、设备异常按影响范围展示。',
    task: '打印任务状态检查',
    taskStatus: '暂时无法连接服务端',
    state: {
      code: '!',
      title: '暂时无法继续打印',
      body: '当前无法确认订单与设备状态，因此不会创建新的打印任务。已上传文件和订单 ID 将按服务端记录恢复；请稍后重试或联系现场工作人员。',
    },
    primary: { label: '重新检查连接', to: '61' },
    secondary: { label: '返回首页', to: '01' },
  })

  P.add({
    id: 62,
    title: '手机上传',
    section: 'print',
    template: 'state',
    kicker: '手机接力页 · 390x844',
    summary: '一次性上传凭证，不携带一体机登录态。',
    goal: '从手机选择文件并安全回到当前一体机任务。',
    action: '选择文件上传',
    mapping: '保留手机独立页；嵌入 390x844 预览，不改为 Kiosk 页面。',
    task: '上传到 01 号机',
    taskStatus: '一次性会话 08:31 后过期',
    mobile: {
      title: '上传到 01 号机',
      body: '打印支持 PDF、JPG、PNG；简历另支持 DOC、DOCX。单个文件最大 20MB。',
      rows: ['选择手机文件', '查看上传进度', '回到一体机确认文件'],
      action: '选择文件',
    },
    primary: { label: '返回一体机预览', to: '31' },
    secondary: { label: '取消上传', to: '02' },
  })

  P.add({
    id: 63,
    title: '手机登录确认',
    section: 'foundation',
    template: 'state',
    kicker: '手机接力页 · 390x844',
    summary: '手机确认本次一体机会话，不共享密码与长期凭证。',
    goal: '完成扫码登录并回到原任务。',
    action: '确认登录 01 号机',
    mapping: '保留手机独立页；显示设备与任务摘要防止误确认。',
    task: '登录 01 号机',
    taskStatus: '一次性登录请求等待确认',
    mobile: {
      title: '确认登录一体机',
      body: '设备：就业服务大厅 01 号机。确认后仅建立当前公共终端会话，退出或超时后自动清理。',
      rows: ['核对设备与地点', '阅读服务协议与隐私政策', '确认并返回一体机'],
      action: '确认登录',
    },
    primary: { label: '返回一体机', to: '14' },
    secondary: { label: '拒绝登录', to: '15' },
  })

  P.add({
    id: 64,
    title: '打印预览',
    section: 'print',
    template: 'document',
    kicker: '打印 · 第 2 步',
    summary: '页面缩略图、当前页和页码范围形成明确层级。',
    goal: '在设置参数前发现错页、方向和内容问题。',
    action: '确认页面并设置参数',
    mapping: '保留独屏；缩略图只用于导航，不与参数和支付混在一页。',
    task: '预览个人简历.pdf',
    taskStatus: '3 页已加载 · 当前第 1 页',
    primary: { label: '页面确认，设置打印参数', to: '03' },
    secondary: { label: '返回材料检查', to: '31' },
    sections: [
      {
        title: '文档预览',
        caption: '3 页 · PDF',
        kind: 'document',
        heading: '王雨晴 · 行政专员',
        body: '求职目标、教育经历、项目经历与联系方式。\n\n页面缩放仅影响屏幕预览，不改变打印比例。',
      },
      {
        title: '页面范围',
        caption: '默认全部页面',
        kind: 'segments',
        items: ['全部 1-3 页', '仅当前页', '自定义'],
        selected: 0,
      },
    ],
    rail: [
      {
        kind: 'task',
        pairs: [
          ['文件', '个人简历.pdf'],
          ['页数', '3 页'],
          ['方向', '纵向'],
          ['预检', '1 项已确认'],
        ],
      },
      {
        kind: 'truth',
        title: 'Word 需先服务端转换',
        text: '只有生成可预览文件后才能进入本页，不直接假装浏览器可打印 Word。',
      },
    ],
  })

  P.add({
    id: 65,
    title: '确认打印',
    section: 'print',
    template: 'workbench',
    kicker: '打印 · 第 5 步',
    summary: '文件、参数、隐私确认和服务端报价在支付前最后核对。',
    goal: '防止错文件、错参数和过期报价进入支付。',
    action: '确认订单并进入支付',
    mapping: '保留独屏；把参数复核做成一张确认单，不再重复所有控件。',
    task: '确认个人简历打印单',
    taskStatus: '参数已确认 · 报价有效 04:37',
    primary: { label: '确认订单并进入支付', to: '32', confirm: true },
    secondary: { label: '返回修改参数', to: '03' },
    sections: [
      {
        title: '打印确认单',
        caption: '报价 PR-0821',
        kind: 'metrics',
        items: [
          ['文件', '个人简历.pdf'],
          ['份数', '2 份'],
          ['页数', '3 页'],
        ],
      },
      {
        title: '参数摘要',
        caption: '来自本人刚才的选择',
        kind: 'rows',
        items: [
          { title: '黑白 · 双面长边', text: 'A4 · 自动方向 · 适合页面' },
          { title: '全部 1-3 页', text: '预计使用 3 张纸' },
          { title: '服务端报价', text: '3.00 元 · 报价过期后需重新获取', state: '3.00 元' },
        ],
      },
      {
        title: '最后检查',
        caption: '继续前必须确认',
        kind: 'choices',
        items: [
          { title: '文件和页码正确', text: '已查看完整预览', selected: true },
          { title: '敏感信息已确认', text: '按原文件打印，不自动遮挡', selected: true },
          {
            title: '理解付款后仍需等待真实出纸',
            text: '完成以 Agent 与现场结果为准',
            selected: true,
          },
        ],
      },
    ],
    rail: [
      {
        kind: 'warning',
        title: '报价变化需重新确认',
        text: '参数、文件版本或价格规则变化后，不得沿用旧报价直接支付。',
      },
    ],
  })

  P.add({
    id: 66,
    title: '图片合并 PDF',
    section: 'print',
    template: 'workbench',
    kicker: '文件工具',
    summary: '添加、排序、方向和生成动作按顺序完成。',
    goal: '把多张图片生成一份可检查的 PDF。',
    action: '确认顺序并生成 PDF',
    mapping: '保留独屏；不与打印动作绑定，生成后再选择去向。',
    task: '图片合并 PDF',
    taskStatus: '已添加 4 张图片 · 等待确认顺序',
    primary: { label: '确认顺序并生成 PDF', to: '64', confirm: true },
    secondary: { label: '继续添加图片', to: '66' },
    sections: [
      {
        title: '图片顺序',
        caption: '最多 20 张',
        kind: 'rows',
        items: [
          { title: '01 · 成绩单正面.jpg', text: '1080x1440 · 1.2MB', state: '首张' },
          { title: '02 · 成绩单背面.jpg', text: '1080x1440 · 1.1MB' },
          { title: '03 · 证书 1.jpg', text: '1440x1080 · 980KB' },
          { title: '04 · 证书 2.jpg', text: '1440x1080 · 1.0MB', state: '末张' },
        ],
      },
      {
        title: '页面设置',
        caption: '生成后仍需预览',
        kind: 'segments',
        items: ['保持原方向', '统一纵向', '统一横向'],
        selected: 0,
      },
      {
        title: '输出摘要',
        caption: '尚未生成',
        kind: 'metrics',
        items: [
          ['图片', '4 张'],
          ['预计 PDF', '4 页'],
          ['文件状态', '待生成'],
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        title: '生成不等于保存',
        text: '生成文件先作为临时成果；登录并确认保存后才进入我的文档。',
      },
    ],
  })

  P.add({
    id: 67,
    title: '签名盖章排版',
    section: 'print',
    template: 'document',
    kicker: '文件工具 · 非 CA 电子签',
    summary: '选择文件、图片、位置和页码后生成派生 PDF。',
    goal: '完成透明、可预览的版式合成。',
    action: '确认位置并生成派生文件',
    mapping: '保留独屏；法律声明固定可见，生成前二次确认。',
    task: '给证明材料添加签名图片',
    taskStatus: '位置已设置 · 等待本人确认',
    primary: { label: '确认并生成合成 PDF', to: '64', confirm: true },
    secondary: { label: '返回我的文档', to: '17' },
    sections: [
      {
        title: '文件预览',
        caption: '证明材料.pdf · 第 1 页',
        kind: 'document',
        heading: '证明材料',
        body: '签名图片将放置在第 1 页右下角。\n\n请核对图片内容、大小、位置与适用页码。',
      },
      {
        title: '合成设置',
        caption: '按钮式定位，暂不支持自由拖拽',
        kind: 'form',
        fields: [
          { label: '签名图片', value: '本人签名.png' },
          { label: '应用页码', value: '仅第 1 页' },
          { label: '位置', value: '右下角' },
          { label: '大小', value: '中' },
        ],
      },
      {
        title: '用途确认',
        caption: '必须明确同意',
        kind: 'choices',
        items: [{ title: '我有权使用该图片', text: '并理解这只是图片版式合成', selected: true }],
      },
    ],
    rail: [
      {
        kind: 'warning',
        title: '不具备 CA 法律认证效力',
        text: '正式合同签署请使用具备资质的电子签名服务。',
      },
    ],
  })

  P.add({
    id: 68,
    title: '证件照排版说明',
    section: 'print',
    template: 'state',
    kicker: '功能未开放',
    summary: '明确当前能力和可用替代路径。',
    goal: '避免用户误以为本机可以拍摄或自动制作证件照。',
    action: '使用照片打印替代路径',
    mapping: '诚实禁用；保留说明路由，不在主目录强调。',
    task: '证件照排版',
    taskStatus: '当前终端未开放该能力',
    state: {
      code: '—',
      title: '证件照排版暂未开放',
      body: '本机目前不提供拍摄、抠图、换底色或自动排版。已有合规证件照文件时，可使用普通照片打印流程；规格和用途请先向办理机构确认。',
    },
    primary: { label: '使用照片打印', to: '31' },
    secondary: { label: '返回打印扫描', to: '02' },
  })

  P.add({
    id: 69,
    title: '迎新服务',
    section: 'fairs',
    template: 'directory',
    kicker: '学校授权迎新专区',
    summary: '报到流程、窗口和材料指引来自学校配置。',
    goal: '帮助新生完成线下报到准备。',
    action: '查看已开通迎新服务',
    mapping: '保留独屏；不显示未接入的在线办理结果。',
    task: '某大学新生报到',
    taskStatus: '学校已发布 3 项迎新指引',
    primary: { label: '查看校园卡办理', to: '52' },
    secondary: { label: '返回智慧校园', to: '51' },
    sections: [
      {
        title: '报到流程',
        caption: '以学校现场安排为准',
        kind: 'timeline',
        items: [
          { title: '身份核验', text: '前往学院报到点', status: 'active' },
          { title: '宿舍与校园卡', text: '按学校窗口分流办理', status: 'pending' },
          { title: '材料归档', text: '由学校系统处理', status: 'pending' },
        ],
      },
      {
        title: '已开通指引',
        caption: '由学校后台配置',
        kind: 'rows',
        items: [
          { title: '校园卡办理', text: '材料与窗口指引', to: '52' },
          { title: '报到材料清单', text: '可查看并打印', to: '64' },
          { title: '校园招聘准备', text: '进入校园招聘专区', to: '50' },
          { title: '证件照拍摄', text: '本机未开放，查看替代说明', to: '68', state: '未开放' },
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        title: '学校系统负责办理结果',
        text: '本机只展示指引和打印材料，不写“已报到、已办卡”。',
      },
    ],
  })

  P.add({
    id: 70,
    title: '校园数据说明',
    section: 'fairs',
    template: 'state',
    kicker: '本期不开放',
    summary: '个人学生数据和校园大数据功能保持冻结。',
    goal: '明确隐私边界并避免占位图表误导。',
    action: '返回智慧校园',
    mapping: '诚实禁用；不开发个人明细或假大屏。',
    task: '校园数据',
    taskStatus: '功能冻结',
    state: {
      code: '锁',
      title: '校园数据功能未开放',
      body: '当前版本不采集或展示学生个人明细，也不向学校或合作机构提供个人求职、简历、打印或浏览数据。后续如需聚合统计，必须完成独立合规与最小样本审查。',
    },
    primary: { label: '返回智慧校园', to: '51' },
  })

  P.add({
    id: 71,
    title: '我的活动记录',
    section: 'account',
    template: 'collection',
    kicker: '本人权益活动记录',
    summary: '领取、使用、冻结和过期状态可追踪。',
    goal: '查看活动产生的真实权益记录。',
    action: '打开活动或权益详情',
    mapping: '保留独屏；与活动列表分开，避免把浏览写成领取。',
    task: '查看活动记录',
    taskStatus: '1 项已领取 · 1 项已过期',
    activeTab: 'profile',
    primary: { label: '查看已领取活动', to: '72' },
    secondary: { label: '浏览当前活动', to: '24' },
    sections: [
      {
        title: '活动记录',
        caption: '来自真实 BenefitGrant',
        kind: 'rows',
        items: [
          {
            title: '高校毕业生求职材料服务',
            text: '8 月 1 日领取 · 权益仍可用',
            to: '72',
            state: '已领取',
          },
          { title: '首次登录体验活动', text: '7 月 10 日领取 · 已使用', to: '72', state: '已使用' },
          {
            title: '招聘会打印支持',
            text: '场次已结束 · 未使用权益已过期',
            to: '72',
            state: '已过期',
          },
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        title: '浏览不是领取',
        text: '只有服务端成功创建本人权益记录后才显示“已领取”。',
      },
    ],
  })

  P.add({
    id: 72,
    title: '活动详情',
    section: 'account',
    template: 'detail',
    kicker: '运营审核活动',
    summary: '权益内容、适用范围、领取条件和使用去向完整展示。',
    goal: '确认活动并领取真实权益。',
    action: '确认领取活动权益',
    mapping: '保留独屏；领取按钮等待真实服务端结果。',
    task: '高校毕业生求职材料服务',
    taskStatus: '符合展示条件 · 尚未领取',
    activeTab: 'profile',
    primary: { label: '确认领取权益', to: '21', confirm: true },
    secondary: { label: '返回活动列表', to: '24' },
    sections: [
      {
        title: '活动权益',
        caption: '2026 年 8 月 1 日至 31 日',
        kind: 'metrics',
        items: [
          ['AI 诊断', '1 次'],
          ['黑白打印', '5 页'],
          ['有效期', '领取后 30 天'],
        ],
      },
      {
        title: '适用条件',
        caption: '最终资格以服务端规则为准',
        kind: 'rows',
        items: [
          { title: '本人账号登录', text: '权益只发放到当前本人账号' },
          { title: '高校毕业生服务范围', text: '需要按活动规则核验' },
          { title: '每人限领一次', text: '重复请求必须幂等处理' },
        ],
      },
      {
        title: '使用去向',
        caption: '领取后从原业务入口使用',
        kind: 'rows',
        items: [
          { title: 'AI 简历诊断', text: '从 AI 简历服务进入', to: '05' },
          { title: '文档打印', text: '在订单核价时选择可用权益', to: '02' },
        ],
      },
    ],
    rail: [
      {
        kind: 'warning',
        title: '领取失败不显示成功',
        text: '网络失败、并发重复或资格不符时保留明确错误和重试方式。',
      },
    ],
  })

  P.add({
    id: 73,
    title: '语音咨询',
    section: 'interview',
    template: 'workbench',
    kicker: 'AI 顾问 · 语音模式',
    summary: '真人照片顾问、实时字幕和通话控制服务于任务澄清。',
    goal: '在用户明确授权后完成短时语音咨询。',
    action: '确认字幕并生成办理步骤',
    mapping: '保留独屏；语音是输入方式，不是新的业务系统。',
    task: '招聘会材料语音咨询',
    taskStatus: '通话中 · 实时字幕仅本次会话',
    primary: { label: '结束语音并整理步骤', to: '13', confirm: true },
    secondary: { label: '静音', to: '73' },
    sections: [
      {
        title: '本次咨询',
        caption: '已进行 01:42',
        kind: 'photo',
        advisor: true,
        captionText: '小青正在听你说明目标；需要确认的内容会显示为字幕。',
      },
      {
        title: '实时字幕',
        caption: '请及时纠正识别错误',
        kind: 'text',
        paragraphs: [
          '我周五参加招聘会，已经有一份简历，想针对行政岗位优化，再打印五份。',
          '系统理解：目标场次已确定；目标岗位待选择；已有简历一份。',
        ],
      },
      {
        title: '通话控制',
        caption: '均为本人主动操作',
        kind: 'segments',
        items: ['麦克风开启', '暂停字幕', '转文字输入'],
        selected: 0,
      },
    ],
    rail: [
      {
        kind: 'warning',
        title: '语音授权按次使用',
        text: '拒绝麦克风后仍可使用文字输入；网络中断需保留已确认的任务摘要。',
      },
    ],
  })

  P.add({
    id: 74,
    title: '线下机构岗位详情',
    section: 'jobs',
    template: 'detail',
    kicker: '线下招聘机构来源',
    summary: '岗位、门店、来源和到店咨询边界清楚呈现。',
    goal: '帮助用户判断是否到店咨询并打印岗位信息。',
    action: '查看来源机构门店',
    mapping: '保留独屏；禁止预约登记、代收简历和代收费用。',
    task: '查看前台客服岗位',
    taskStatus: '岗位与门店信息已加载',
    primary: { label: '查看来源机构门店', to: '75' },
    secondary: { label: '打印岗位信息带走', to: '64' },
    sections: [
      {
        title: '前台客服',
        caption: '4.5-6K · 全职 · 服务业',
        kind: 'metrics',
        items: [
          ['经验', '经验不限'],
          ['学历', '中专及以上'],
          ['来源', '线下招聘机构'],
        ],
      },
      {
        title: '职责与要求',
        caption: '来源机构提供',
        kind: 'text',
        paragraphs: ['负责门店接待、来访登记与基础咨询。', '要求沟通清晰，能适应排班安排。'],
      },
      {
        title: '机构门店',
        caption: '到店前建议电话确认',
        kind: 'rows',
        items: [
          {
            title: '诚安人力资源 · 城西门店',
            text: '拱墅区祥园路 329 号 · 营业状态以门店为准',
            to: '75',
          },
          { title: '到店咨询指引', text: '携带本人材料，自主决定是否咨询；平台不收取费用' },
        ],
      },
    ],
    rail: [
      {
        kind: 'task',
        pairs: [
          ['来源机构', '诚安人力资源'],
          ['来源类型', '线下招聘机构'],
          ['更新时间', '2026-08-05 15:30'],
          ['外部 ID', 'JOB-87960'],
        ],
      },
      {
        kind: 'truth',
        title: '只做信息导览',
        text: '平台不代收简历、不代收费用、不做预约登记或候选人推荐。',
      },
    ],
  })

  P.add({
    id: 75,
    title: '线下招聘机构',
    section: 'jobs',
    template: 'collection',
    kicker: '来源机构导览',
    summary: '门店地址、公开电话、服务范围和来源岗位可追溯。',
    goal: '找到真实机构并核对到店信息。',
    action: '查看机构或来源岗位',
    mapping: '保留独屏；距离和营业状态没有真实数据时不显示确定结论。',
    task: '查找线下招聘机构',
    taskStatus: '已按杭州市筛选 · 距离未授权',
    primary: { label: '查看诚安人力资源', to: '74' },
    secondary: { label: '返回岗位信息', to: '08' },
    sections: [
      {
        title: '筛选机构',
        caption: '不使用假距离',
        kind: 'form',
        fields: [
          { label: '地区', value: '杭州市' },
          { label: '服务范围', value: '综合招聘服务' },
        ],
      },
      {
        title: '机构门店',
        caption: '来源与更新时间可查',
        kind: 'rows',
        items: [
          {
            title: '诚安人力资源 · 城西门店',
            text: '拱墅区 · 综合招聘服务 · 更新于今日',
            to: '74',
            state: '状态待确认',
          },
          {
            title: '启航人才服务 · 滨江门店',
            text: '滨江区 · 制造与技术岗位 · 更新于昨日',
            to: '74',
            state: '状态待确认',
          },
          {
            title: '汇才就业服务 · 下沙门店',
            text: '钱塘区 · 校招与实习岗位 · 更新于 2 天前',
            to: '74',
            state: '状态待确认',
          },
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        title: '到店前请再次确认',
        text: '营业时间、服务范围和岗位有效性以机构公开信息或电话确认为准。',
      },
      {
        kind: 'warning',
        title: '不代收费用或简历',
        text: '如机构提出收费，请自行核实其资质、项目和合同。',
      },
    ],
  })
})(window.KioskPrototype)
