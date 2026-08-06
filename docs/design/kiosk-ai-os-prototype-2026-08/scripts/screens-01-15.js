;(function (P) {
  P.add({
    id: 1,
    title: '首页',
    section: 'foundation',
    template: 'home',
    kicker: '今天在本机完成什么',
    summary: '从目标或六个定版服务入口开始，不先选择一堆工具。',
    goal: '让第一次使用的人在十秒内找到正确起点。',
    action: '说出目标或选择一个服务',
    mapping: '保留独屏；移除 8 卡墙和重复 AI 标签，改为目标输入 + 六项服务目录。',
    task: '还没有开始办理',
    taskStatus: '可直接选择服务，也可以让 AI 帮你判断顺序',
    primary: { label: '确认目标并生成办理步骤', to: '13', confirm: true },
    secondary: { label: '先登录同步本人记录', to: '15' },
    helper: 'AI 只生成建议步骤，不会自动付款、投递或出纸。',
    sections: [
      {
        title: '把目标说清楚',
        caption: '一句话即可，后续由你确认',
        kind: 'form',
        fields: [
          { label: '我今天想办', value: '周五参加招聘会，想先优化简历并打印 5 份', wide: true },
        ],
      },
      {
        title: '六项核心服务',
        caption: '入口名称保持稳定',
        kind: 'rows',
        items: [
          {
            title: '打印扫描',
            text: '上传、检查、支付、打印与材料扫描',
            to: '02',
            domain: 'local',
            layoutSlot: 'primary-print',
          },
          {
            title: 'AI 简历服务',
            text: '诊断、优化、生成、模板与求职材料',
            to: '05',
            domain: 'ai',
            layoutSlot: 'anchor-resume',
          },
          {
            title: '岗位信息',
            text: '查看第三方来源岗位与本人匹配参考',
            to: '08',
            domain: 'source',
            layoutSlot: 'support-jobs',
          },
          {
            title: '招聘会',
            text: '场次、企业、场馆导览与参会准备',
            to: '10',
            domain: 'source',
            layoutSlot: 'support-fairs',
          },
          {
            title: 'AI 面试训练',
            text: '私密练习、逐题反馈与历史报告',
            to: '38',
            domain: 'ai',
            layoutSlot: 'support-interview',
          },
          {
            title: '政策服务',
            text: '官方政策、材料清单与办理来源',
            to: '12',
            domain: 'source',
            layoutSlot: 'support-policy',
          },
        ],
      },
    ],
    rail: [
      { kind: 'photo', caption: '招聘会前可在本机准备简历、材料清单并完成打印。' },
      {
        kind: 'truth',
        title: '设备能力正在检查',
        text: '未取得实时上报前，不显示“在线、纸张充足、可彩打”等结论。',
      },
    ],
  })

  P.add({
    id: 2,
    title: '打印扫描服务',
    section: 'print',
    template: 'directory',
    kicker: '打印与扫描',
    summary: '按用户任务分组，未开放能力不占主视线。',
    goal: '让用户从文件来源和最终产物选择正确流程。',
    action: '选择文档打印或材料扫描',
    mapping: '保留独屏；七张能力卡改为两条主流程与三项辅助工具。',
    task: '打印扫描',
    taskStatus: '等待选择文件处理方式',
    primary: { label: '开始文档打印', to: '31' },
    secondary: { label: '开始材料扫描', to: '34' },
    sections: [
      {
        title: '主要办理',
        caption: '现场最常用的两条链路',
        kind: 'rows',
        items: [
          { title: '文档打印', text: '本机文件、手机扫码或 U 盘导入后，先检查再打印', to: '31' },
          { title: '材料扫描', text: '按设备面板指引扫描，文件到达后再处理', to: '34' },
        ],
      },
      {
        title: '文件工具',
        caption: '只在需要时进入',
        kind: 'rows',
        items: [
          { title: '图片合并 PDF', text: '排序多张图片并生成一份 PDF', to: '66' },
          { title: '签名盖章排版', text: '图片叠加，不是 CA 电子签', to: '67' },
          { title: '证件照排版', text: '当前能力未开放，展示替代路径', to: '68', state: '未开放' },
        ],
      },
    ],
    rail: [
      {
        kind: 'task',
        pairs: [
          ['设备', '等待真实状态'],
          ['纸张', '等待现场确认'],
          ['幅面', '仅展示设备上报能力'],
        ],
      },
      {
        kind: 'truth',
        title: '扫描不是云端遥控',
        text: '当前流程按打印机面板 + 本机接收目录执行。',
      },
    ],
  })

  P.add({
    id: 3,
    title: '打印参数',
    section: 'print',
    template: 'workbench',
    kicker: '打印 · 第 4 步',
    summary: '一次只显示可验证的设备参数，费用由服务端重新报价。',
    goal: '用清晰控件完成份数、单双面、方向和范围设置。',
    action: '确认参数并重新核价',
    mapping: '保留独屏；删除 7 步拥挤圆点，费用与设备状态移入办理单侧栏。',
    task: '打印个人简历.pdf',
    taskStatus: '材料已检查，正在设置参数',
    primary: { label: '确认参数并重新核价', to: '65', confirm: true },
    secondary: { label: '返回预览', to: '64' },
    sections: [
      {
        title: '打印份数与页面',
        caption: '3 页 · 当前选择全部页面',
        kind: 'form',
        fields: [
          { label: '打印份数', value: '2' },
          { label: '页码范围', value: '全部 1-3 页' },
        ],
      },
      {
        title: '打印方式',
        caption: '只展示设备明确支持的选项',
        kind: 'segments',
        items: ['黑白', '彩色待确认', '自动'],
        selected: 0,
      },
      {
        title: '单双面',
        caption: '长边翻页适合普通文档',
        kind: 'segments',
        items: ['单面', '双面长边', '双面短边'],
        selected: 1,
      },
      {
        title: '页面布局',
        caption: 'A4 · 适合页面',
        kind: 'segments',
        items: ['自动方向', '纵向', '横向'],
        selected: 0,
      },
    ],
    rail: [
      {
        kind: 'task',
        pairs: [
          ['文件', '个人简历.pdf'],
          ['页数', '3 页'],
          ['预计用纸', '3 张'],
          ['价格', '待服务端核价'],
        ],
      },
      {
        kind: 'warning',
        title: '彩色能力待设备确认',
        text: '不能因为打印机支持彩色就假定开放 API 的 mode 值。',
      },
    ],
  })

  P.add({
    id: 4,
    title: '打印进度',
    section: 'print',
    template: 'progress',
    kicker: '打印 · 实时履约',
    summary: '只展示服务端与 Agent 已确认的状态，不用固定百分比假装实时。',
    goal: '让用户知道任务处于哪里、是否需要等待或寻求帮助。',
    action: '查看已确认的任务阶段',
    mapping: '保留独屏；进度改为事件时间线，移除静态“正在打印”承诺。',
    task: '打印任务 P-20260805-0043',
    taskStatus: '等待 Agent 最新回报',
    primary: { label: '刷新任务状态', to: '04' },
    secondary: { label: '遇到问题', to: '22' },
    sections: [
      {
        title: '任务状态',
        caption: '最后更新 18:08:12',
        kind: 'progress',
        headline: '已进入本机队列',
        text: '打印是否开始，以 Agent 最新回报和现场出纸为准。',
      },
      {
        title: '处理记录',
        caption: '按事件顺序显示',
        kind: 'timeline',
        items: [
          { title: '订单已确认', text: '服务端已确认订单与参数', status: 'done' },
          { title: '任务已领取', text: '本机 Agent 已领取任务', status: 'done' },
          { title: '等待打印机回报', text: '尚未收到完成事件', status: 'active' },
          { title: '完成取件', text: '收到真实完成事件后才点亮', status: 'pending' },
        ],
      },
    ],
    rail: [
      {
        kind: 'task',
        pairs: [
          ['份数', '2 份'],
          ['模式', '黑白 · 双面'],
          ['费用', '3.00 元'],
          ['文件清理', '任务完成后按策略执行'],
        ],
      },
      {
        kind: 'truth',
        title: '不要提前离开',
        text: '看到纸张完整出纸后再取走；状态超时可凭任务号反馈。',
      },
    ],
  })

  P.add({
    id: 5,
    title: '简历来源与目标',
    section: 'resume',
    template: 'workbench',
    kicker: 'AI 简历 · 第 1 步',
    summary: '先确认简历来源与求职目标，再进入解析。',
    goal: '把上传、扫描、生成三条来源合并为一次明确选择。',
    action: '确认文件与诊断目标',
    mapping: '保留独屏；文件来源和目标方向同屏，AI 说明只保留一处。',
    task: 'AI 简历诊断',
    taskStatus: '已选择手机上传文件，等待确认目标',
    primary: { label: '确认并开始解析', to: '27', confirm: true },
    secondary: { label: '没有简历，去生成', to: '25' },
    sections: [
      {
        title: '选择简历来源',
        caption: '只读取你主动选择的文件',
        kind: 'choices',
        items: [
          { title: '手机扫码上传', text: '一次性上传令牌，不携带登录态', selected: true },
          { title: 'U 盘选择文件', text: '离开前记得拔出 U 盘' },
          { title: '纸质简历扫描', text: '进入本机面板扫描指引', to: '34' },
        ],
      },
      {
        title: '诊断目标',
        caption: 'AI 只调整建议顺序，不修改事实',
        kind: 'form',
        fields: [
          { label: '目标岗位', value: '行政专员' },
          { label: '经验阶段', value: '1-3 年' },
          { label: '希望重点改善', value: '项目经历与成果表达', wide: true },
        ],
      },
    ],
    rail: [
      {
        kind: 'task',
        pairs: [
          ['文件', '王雨晴-行政专员.pdf'],
          ['格式', 'PDF · 486 KB'],
          ['来源', '手机扫码上传'],
          ['保存', '本次服务临时文件'],
        ],
      },
      {
        kind: 'assistant',
        title: 'AI 将做什么',
        text: '解析结构、检查完整性并给出修改建议；不会新增未经你确认的经历。',
      },
    ],
  })

  P.add({
    id: 6,
    title: '简历诊断',
    section: 'resume',
    template: 'document',
    kicker: 'AI 简历 · 诊断结果',
    summary: '先给结论和证据，再给下一步，不用仪表盘堆满分数。',
    goal: '帮助用户看懂最优先的三项问题。',
    action: '选择一个问题进入优化',
    mapping: '保留独屏；雷达图和八块评分改为证据清单与优先级。',
    task: '行政专员简历诊断',
    taskStatus: '诊断完成，等待本人选择优化项',
    primary: { label: '优化最优先问题', to: '07' },
    secondary: { label: '查看岗位匹配参考', to: '55' },
    sections: [
      {
        title: '诊断概览',
        caption: '基于当前文件内容',
        kind: 'metrics',
        items: [
          ['完整性', '良好'],
          ['岗位针对性', '需加强'],
          ['可读性', '良好'],
        ],
      },
      {
        title: '修改优先级',
        caption: '先处理影响最大的内容',
        kind: 'rows',
        items: [
          {
            title: '01 项目经历缺少结果证据',
            text: '“负责活动执行”没有说明规模、动作和结果',
            state: '优先',
          },
          {
            title: '02 求职目标与经历关键词脱节',
            text: '目标岗位强调流程与协调，简历中没有集中呈现',
            state: '建议',
          },
          { title: '03 联系方式与日期格式不统一', text: '属于快速修复项', state: '快速修复' },
        ],
      },
      {
        title: '原文证据',
        caption: 'AI 建议必须能回到原文',
        kind: 'document',
        heading: '项目经历',
        body: '负责校招活动执行，与多个部门沟通，完成现场安排和材料整理。',
      },
    ],
    rail: [
      {
        kind: 'assistant',
        title: '建议先改项目经历',
        text: '这个问题同时影响经历表达和岗位关键词，但仍需要你补充真实数据。',
      },
      {
        kind: 'truth',
        title: '诊断不是录用判断',
        text: '报告只帮助本人改进材料，不代表企业筛选或录用结果。',
      },
    ],
  })

  P.add({
    id: 7,
    title: '优化对比',
    section: 'resume',
    template: 'document',
    kicker: 'AI 简历 · 本人确认',
    summary: '每条修改单独采纳，不用一键覆盖整份简历。',
    goal: '让用户掌控 AI 改写并核实事实。',
    action: '逐条采纳后保存新版本',
    mapping: '保留独屏；双栏只用于真正的内容比较，操作集中到修改条目。',
    task: '行政专员简历优化',
    taskStatus: '3 条建议中已确认 1 条',
    primary: { label: '确认内容并保存新版本', to: '28', confirm: true },
    secondary: { label: '返回诊断', to: '06' },
    sections: [
      {
        title: '项目经历 · 第 1 条',
        caption: '必须核实人数与结果',
        kind: 'compare',
        before: '负责校招活动执行，与多个部门沟通，完成现场安排。',
        after: '协调 4 个部门完成校招活动筹备，整理 120 份现场材料并跟进问题闭环。',
      },
      {
        title: '本人确认',
        caption: 'AI 不得替你补造事实',
        kind: 'choices',
        items: [
          { title: '采纳这条修改', text: '人数和材料数量均真实，可保存', selected: true },
          { title: '编辑后再采纳', text: '数字或表达需要调整' },
          { title: '保留原文', text: '不使用这条 AI 建议' },
        ],
      },
    ],
    rail: [
      {
        kind: 'task',
        pairs: [
          ['当前版本', '原始版 v1'],
          ['保存为', '优化版 v2'],
          ['已确认', '1 / 3 条'],
          ['可撤回', '保存前均可'],
        ],
      },
      {
        kind: 'warning',
        title: '请核实所有数字',
        text: '学校、公司、时间、证书、人数与业绩必须来自本人真实经历。',
      },
    ],
  })

  P.add({
    id: 8,
    title: '岗位信息',
    section: 'jobs',
    template: 'collection',
    kicker: '第三方来源信息',
    summary: '先筛来源和岗位，再进入详情；AI 匹配仅作为本人参考。',
    goal: '快速浏览可信来源岗位并识别更新时间。',
    action: '查看岗位详情',
    mapping: '保留独屏；减少筛选 chip，来源、更新时间和类型进入固定列。',
    task: '查找行政类岗位',
    taskStatus: '已按城市与岗位关键词筛选',
    primary: { label: '查看已选岗位', to: '09' },
    secondary: { label: '查看线下招聘机构', to: '75' },
    sections: [
      {
        title: '筛选条件',
        caption: '已发布且来源可追溯',
        kind: 'form',
        fields: [
          { label: '岗位关键词', value: '行政专员' },
          { label: '城市', value: '杭州市' },
        ],
      },
      {
        title: '岗位结果',
        caption: '共 12 条 · 示例只表达字段结构',
        kind: 'rows',
        items: [
          {
            title: '行政专员 · 某科技服务公司',
            text: '5-7K · 全职 · 来源：市就业服务平台 · 更新于今日',
            to: '09',
            state: '线上来源',
          },
          {
            title: '前台客服 · 某连锁服务企业',
            text: '4.5-6K · 全职 · 来源：线下招聘机构 · 更新于昨日',
            to: '74',
            state: '线下机构',
          },
          {
            title: '行政助理 · 某制造企业',
            text: '5-6K · 全职 · 来源：大学就业网 · 更新于 2 天前',
            to: '09',
            state: '官方来源',
          },
        ],
      },
    ],
    rail: [
      {
        kind: 'assistant',
        title: '需要匹配参考？',
        text: '登录并选择本人简历后，可查看“较高 / 中等 / 偏低”三档参考。',
      },
      {
        kind: 'truth',
        title: '本平台不接收简历',
        text: '投递必须前往来源平台，平台不记录投递结果。',
      },
    ],
  })

  P.add({
    id: 9,
    title: '岗位详情',
    section: 'jobs',
    template: 'detail',
    kicker: '第三方来源岗位',
    summary: '把岗位事实、来源证据和外部动作分开呈现。',
    goal: '帮助用户理解岗位并安全前往来源平台。',
    action: '确认后去来源平台投递',
    mapping: '保留独屏；匹配与收藏降级为次要动作，来源信息固定在右侧。',
    task: '查看行政专员岗位',
    taskStatus: '岗位信息已加载，尚未打开来源平台',
    primary: { label: '去来源平台投递', to: '09', confirm: true, tone: 'source', external: true },
    secondary: { label: '打印岗位信息', to: '64' },
    boundary: '平台只记录“打开来源”动作，不知道用户是否完成投递。',
    sections: [
      {
        title: '行政专员',
        caption: '5-7K · 全职 · 杭州市',
        kind: 'metrics',
        items: [
          ['经验', '1-3 年'],
          ['学历', '大专及以上'],
          ['行业', '信息技术'],
        ],
      },
      {
        title: '职责与要求',
        caption: '来源内容整理展示',
        kind: 'text',
        paragraphs: [
          '负责办公用品采购、会议与档案管理。',
          '协助跨部门流程跟进，完成行政事务协调。',
          '要求沟通清晰，熟悉常用办公软件。',
        ],
      },
      {
        title: '下一步准备',
        caption: '只作用于本人',
        kind: 'rows',
        items: [
          { title: '查看岗位匹配参考', text: '使用本人简历生成三档参考', to: '55' },
          { title: '针对该岗位优化简历', text: '回到 AI 简历流程并由本人确认修改', to: '05' },
        ],
      },
    ],
    rail: [
      {
        kind: 'task',
        pairs: [
          ['来源机构', '市就业服务平台'],
          ['同步时间', '2026-08-05 17:40'],
          ['外部 ID', 'JOB-88231'],
          ['来源状态', '可访问'],
        ],
      },
      {
        kind: 'truth',
        title: '外部平台独立办理',
        text: '打开后请在来源平台核实账号、隐私与投递结果。',
      },
    ],
  })

  P.add({
    id: 10,
    title: '招聘会列表',
    section: 'fairs',
    template: 'collection',
    kicker: '招聘会信息',
    summary: '按时间与来源排序，结束场次不与可参加场次混在一起。',
    goal: '帮助用户找到下一场可信招聘会。',
    action: '查看招聘会详情',
    mapping: '保留独屏；状态改成清晰列，不用多色标签堆叠。',
    task: '查找本周招聘会',
    taskStatus: '已筛选杭州市与本周场次',
    primary: { label: '查看本周招聘会', to: '11' },
    sections: [
      {
        title: '筛选条件',
        caption: '信息来自主办方或官方来源',
        kind: 'form',
        fields: [
          { label: '时间', value: '本周' },
          { label: '地区', value: '杭州市' },
        ],
      },
      {
        title: '场次',
        caption: '3 场可查看',
        kind: 'rows',
        items: [
          {
            title: '2026 年夏季高校毕业生招聘会',
            text: '8 月 9 日 · 市人才市场 · 来源：市就业服务中心',
            to: '11',
            state: '报名中',
          },
          {
            title: '现代服务业专场招聘会',
            text: '8 月 12 日 · 人社服务大厅 · 来源：主办方',
            to: '11',
            state: '即将开始',
          },
          {
            title: '先进制造业双选会',
            text: '8 月 3 日 · 已结束 · 仅可查看公开资料',
            to: '11',
            state: '已结束',
          },
        ],
      },
    ],
    rail: [
      {
        kind: 'assistant',
        title: '参会前可准备',
        text: '选择场次后，AI 可以基于本人简历和公开信息生成材料清单。',
      },
      { kind: 'truth', title: '预约去来源平台', text: '平台不记录预约或签到结果。' },
    ],
  })

  P.add({
    id: 11,
    title: '招聘会详情',
    section: 'fairs',
    template: 'detail',
    kicker: '官方来源招聘会',
    summary: '时间地点先于现场功能，外部预约与本机服务明确分区。',
    goal: '让用户完成行前判断并准备材料。',
    action: '准备参会材料或去来源预约',
    mapping: '保留独屏；五 Tab 合并为详情导航，主动作只保留两类。',
    task: '夏季高校毕业生招聘会',
    taskStatus: '场次信息已加载，尚未预约',
    primary: { label: '生成参会准备单', to: '48' },
    secondary: { label: '去来源平台预约', to: '11', confirm: true, tone: 'source', external: true },
    sections: [
      {
        title: '场次概览',
        caption: '8 月 9 日 09:00-16:00',
        kind: 'photo',
        captionText: '市人才市场一层 · 主办方提供的公开场次信息',
      },
      {
        title: '现场服务',
        caption: '按需要进入',
        kind: 'rows',
        items: [
          { title: '参展企业与展位', text: '查看主办方同步的企业与展位号', to: '44' },
          { title: '场馆导览', text: '查看平面图和公开路线提示', to: '46' },
          { title: '活动资料', text: '查看并逐份选择打印', to: '47' },
          { title: '现场数据', text: '只展示主办方公开聚合数据', to: '49' },
        ],
      },
    ],
    rail: [
      {
        kind: 'task',
        pairs: [
          ['主办方', '市人力资源和社会保障局'],
          ['场地', '市人才市场一层'],
          ['企业数', '主办方同步 120 家'],
          ['更新时间', '2026-08-05 16:20'],
        ],
      },
      {
        kind: 'truth',
        title: '预约与签到在来源平台',
        text: '本机只提供入口，不知道第三方办理结果。',
      },
    ],
  })

  P.add({
    id: 12,
    title: '政策服务',
    section: 'interview',
    template: 'collection',
    kicker: '公共就业政策',
    summary: '政策原文、适用对象、材料清单和官方入口分层展示。',
    goal: '帮助用户找到官方政策并理解准备材料。',
    action: '查看政策原文或打印材料清单',
    mapping: '保留独屏；三类政策卡改为可扫描列表，AI 解读不替代原文。',
    task: '查询高校毕业生就业政策',
    taskStatus: '已按身份和地区筛选',
    primary: { label: '查看政策详情', to: '12' },
    secondary: { label: '打印材料清单', to: '64' },
    sections: [
      {
        title: '筛选条件',
        caption: 'AI 可帮助缩小范围',
        kind: 'form',
        fields: [
          { label: '身份', value: '离校 2 年内高校毕业生' },
          { label: '地区', value: '杭州市' },
        ],
      },
      {
        title: '相关政策',
        caption: '以官方原文为准',
        kind: 'rows',
        items: [
          {
            title: '高校毕业生灵活就业社保补贴',
            text: '适用对象、申请条件与材料清单 · 来源：市人社局',
            state: '有效',
          },
          {
            title: '一次性求职创业补贴',
            text: '申请批次与资格以学校通知为准 · 来源：省政务服务网',
            state: '批次办理',
          },
          {
            title: '就业见习岗位政策',
            text: '见习期限、补贴与官方岗位入口 · 来源：市就业服务中心',
            state: '有效',
          },
        ],
      },
    ],
    rail: [
      {
        kind: 'assistant',
        title: 'AI 可以帮你读',
        text: '先引用官方原文，再解释材料和办理顺序；不承诺补贴到账。',
      },
      { kind: 'truth', title: '官方渠道办理', text: '政策申请、审核和结果均由官方平台处理。' },
    ],
  })

  P.add({
    id: 13,
    title: 'AI 顾问',
    section: 'foundation',
    template: 'workbench',
    kicker: 'AI 任务编排',
    summary: '不是聊天页，而是把目标整理成可确认的办理单。',
    goal: '用自然语言直达已有功能，并让用户确认每个关键动作。',
    action: '确认办理步骤',
    mapping: '保留三 Tab；页面从聊天机器人套壳改为“目标—缺口—步骤—确认”工作台。',
    task: '招聘会行前准备',
    taskStatus: 'AI 已整理建议，等待本人确认',
    activeTab: 'assistant',
    primary: { label: '按此步骤开始办理', to: '08', confirm: true },
    secondary: { label: '调整目标', to: '13' },
    sections: [
      {
        title: '你想完成什么',
        caption: '可打字或使用已授权的语音咨询',
        kind: 'form',
        fields: [{ label: '目标', value: '周五参加招聘会，想优化简历并打印 5 份', wide: true }],
      },
      {
        title: '系统确认到的信息',
        caption: '需要你核对',
        kind: 'metrics',
        items: [
          ['目标', '参加招聘会'],
          ['已有材料', '1 份简历'],
          ['当前缺口', '岗位方向未确认'],
        ],
      },
      {
        title: '建议办理步骤',
        caption: '规则优先，模型只补充解释',
        kind: 'timeline',
        items: [
          { title: '选择目标岗位', text: '先确定简历要针对的方向', status: 'active' },
          { title: '诊断并确认修改', text: 'AI 给建议，本人逐条确认', status: 'pending' },
          { title: '预览、核价并支付', text: '支付后才可进入打印', status: 'pending' },
          { title: '现场确认出纸', text: '以设备真实回报和纸张为准', status: 'pending' },
        ],
      },
    ],
    rail: [
      {
        kind: 'assistant',
        title: '为什么先选岗位',
        text: '当前任务缺少明确方向，直接改写容易得到泛化内容。',
      },
      {
        kind: 'warning',
        title: '高风险动作不会自动执行',
        text: '付款、出纸、删除、外跳都必须再次确认。',
      },
    ],
  })

  P.add({
    id: 14,
    title: '我的',
    section: 'account',
    template: 'collection',
    kicker: '本人数据与服务记录',
    summary: '只显示本人资产、当前任务和支持入口，不再复制首页服务墙。',
    goal: '快速继续未完成任务或管理本人记录。',
    action: '继续任务或查看对应资产',
    mapping: '保留独屏；删除 8 个常用服务重复入口，资产按业务去向组织。',
    task: '个人服务中心',
    taskStatus: '已登录 · 共享终端会话将在退出时清理',
    activeTab: 'profile',
    primary: { label: '继续简历优化任务', to: '07' },
    secondary: { label: '账号与隐私设置', to: '23' },
    sections: [
      {
        title: '继续办理',
        caption: '1 个未完成任务',
        kind: 'rows',
        items: [
          {
            title: '行政专员简历优化',
            text: '已确认 1 / 3 条建议 · 18 分钟前更新',
            to: '07',
            state: '进行中',
          },
        ],
      },
      {
        title: '我的服务记录',
        caption: '明细进入对应业务页',
        kind: 'rows',
        items: [
          { title: '简历与 AI 结果', text: '原始简历、优化版本与诊断报告', to: '16' },
          { title: '文档与打印订单', text: '文件保存期限、订单、进度与售后', to: '17' },
          { title: '收藏与浏览', text: '岗位、招聘会、政策和来源打开记录', to: '20' },
          { title: '权益与活动', text: '本人券、次数与活动领取记录', to: '21' },
          { title: '通知与反馈', text: '真实服务通知和问题反馈', to: '22' },
        ],
      },
    ],
    rail: [
      {
        kind: 'task',
        pairs: [
          ['登录账号', '138****6608'],
          ['简历', '3 份'],
          ['打印订单', '7 笔'],
          ['未读通知', '2 条'],
        ],
      },
      {
        kind: 'truth',
        title: '公共终端隐私',
        text: '退出后清除本机会话；长期数据按本人账号和保存策略管理。',
      },
    ],
  })

  P.add({
    id: 15,
    title: '登录',
    section: 'foundation',
    template: 'workbench',
    kicker: '本人身份',
    summary: '扫码登录优先，手机号登录作为真实降级方式。',
    goal: '建立本人会话并在完成后安全清场。',
    action: '扫码或手机号登录',
    mapping: '保留独屏；登录方式保持两种，游客仅进入不需本人数据的公开页面。',
    task: '登录并继续刚才的任务',
    taskStatus: '安全草稿已暂存，登录后返回原步骤',
    primary: { label: '我已扫码，检查登录状态', to: '14' },
    secondary: { label: '暂不登录，返回首页', to: '01' },
    sections: [
      {
        title: '微信扫码登录',
        caption: '二维码为一次性会话凭证',
        kind: 'qr',
        text: '原型二维码不可扫码\n真实环境由服务端生成',
      },
      {
        title: '手机号登录',
        caption: '扫码失败时使用',
        kind: 'form',
        fields: [
          { label: '手机号', value: '138****6608' },
          { label: '验证码', value: '••••••' },
        ],
      },
    ],
    rail: [
      {
        kind: 'task',
        pairs: [
          ['返回任务', '招聘会行前准备'],
          ['草稿状态', '仅本机临时保存'],
          ['会话', '到时自动退出'],
          ['清理', '退出后删除本机敏感状态'],
        ],
      },
      {
        kind: 'truth',
        title: '登录不等于同意 AI 处理',
        text: '涉及本人简历的 AI 功能会另行说明用途并取得授权。',
      },
    ],
  })
})(window.KioskPrototype)
