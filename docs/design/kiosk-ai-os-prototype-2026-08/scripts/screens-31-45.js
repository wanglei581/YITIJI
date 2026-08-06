;(function (P) {
  P.add({
    id: 31,
    title: '打印材料检查',
    section: 'print',
    template: 'document',
    kicker: '打印 · 第 1 步',
    summary: '文件安全、页面和隐私风险先于打印参数。',
    goal: '避免格式错误、空白页和敏感信息误印。',
    action: '确认检查结果并预览',
    mapping: '保留独屏；AI 预检成为检查结果的一部分，不另加 AI 横幅。',
    task: '检查个人简历.pdf',
    taskStatus: '3 页已检查 · 1 项需要本人确认',
    primary: { label: '确认检查结果并预览', to: '64', confirm: true },
    secondary: { label: '更换文件', to: '02' },
    sections: [
      {
        title: '文件检查',
        caption: '服务端实际结果',
        kind: 'metrics',
        items: [
          ['格式', 'PDF 可处理'],
          ['页面', '3 页'],
          ['幅面', 'A4 适配'],
        ],
      },
      {
        title: '需要确认',
        caption: '系统不会自动遮挡原文件',
        kind: 'rows',
        items: [
          {
            title: '第 2 页检测到身份证号样式',
            text: '请确认是否需要打印原文或先返回修改',
            state: '本人确认',
          },
          { title: '第 3 页底部留白较多', text: '不影响打印，可继续' },
        ],
      },
      {
        title: '页面预览',
        caption: '检查页面顺序与方向',
        kind: 'document',
        heading: '个人简历 · 第 1 页',
        body: '姓名、求职目标、教育经历和联系方式预览。\n\n正式打印前还会进入完整页面预览。',
      },
    ],
    rail: [
      {
        kind: 'warning',
        title: '不会自动改原文件',
        text: '隐私遮挡、页面删除和内容修改都需要本人明确选择。',
      },
    ],
  })

  P.add({
    id: 32,
    title: '订单支付',
    section: 'print',
    template: 'workbench',
    kicker: '打印 · 支付确认',
    summary: '价格、权益、退款规则和支付状态在扫码前说明。',
    goal: '完成真实支付并避免重复扫码。',
    action: '扫码支付并等待服务端确认',
    mapping: '保留独屏；双栏卡片改为价格清单 + 支付凭证区。',
    task: '订单 O-20260805-0102',
    taskStatus: '待支付 · 尚未创建打印任务',
    primary: { label: '我已支付，检查结果', to: '32' },
    secondary: { label: '退出支付', to: '65', confirm: true },
    sections: [
      {
        title: '费用明细',
        caption: '服务端报价版本 PR-0821',
        kind: 'rows',
        items: [
          { title: '黑白打印 · 3 页 x 2 份', text: '单价 0.50 元 / 页', state: '3.00 元' },
          { title: '双面长边', text: '本项不额外收费', state: '0.00 元' },
          { title: '可用权益抵扣', text: '当前订单未使用', state: '0.00 元' },
        ],
      },
      {
        title: '支付二维码',
        caption: '请使用微信或支付宝扫描',
        kind: 'qr',
        text: '原型二维码不可支付\n真实环境由支付渠道返回',
      },
      {
        title: '支付结果',
        caption: '等待服务端与渠道回调',
        kind: 'timeline',
        items: [
          { title: '订单已创建', text: '打印任务尚未创建', status: 'done' },
          { title: '等待支付确认', text: '请勿重复扫码', status: 'active' },
          { title: '创建打印任务', text: '仅 paid 状态通过后执行', status: 'pending' },
        ],
      },
    ],
    rail: [
      {
        kind: 'task',
        pairs: [
          ['订单金额', '3.00 元'],
          ['支付状态', '待确认'],
          ['超时时间', '04:37'],
          ['打印任务', '尚未创建'],
        ],
      },
      {
        kind: 'warning',
        title: '付款不等于出纸',
        text: '支付成功只允许进入履约，完成仍以 Agent 与现场结果为准。',
      },
    ],
  })

  P.add({
    id: 33,
    title: '打印完成',
    section: 'print',
    template: 'progress',
    kicker: '打印 · 结果确认',
    summary: '只有收到真实完成事件才显示完成。',
    goal: '核对纸张、保存凭证并结束公共终端会话。',
    action: '确认取走全部材料',
    mapping: '保留独屏；取件凭证按后端可见性显示，不静态伪造。',
    task: '打印任务 P-20260805-0043',
    taskStatus: 'Agent 已回报完成 · 等待本人核对纸张',
    primary: { label: '已取走全部材料', to: '01', confirm: true },
    secondary: { label: '缺页或质量问题', to: '22' },
    sections: [
      {
        title: '完成状态',
        caption: '18:11:26 收到 Agent 完成事件',
        kind: 'progress',
        headline: '请核对并取走纸张',
        text: '预计 2 份、共 6 面；请确认没有缺页、卡纸或残留材料。',
      },
      {
        title: '任务摘要',
        caption: '用于现场核验',
        kind: 'metrics',
        items: [
          ['文件', '个人简历.pdf'],
          ['份数', '2 份'],
          ['费用', '3.00 元'],
        ],
      },
      {
        title: '结束前检查',
        caption: '共享设备安全',
        kind: 'rows',
        items: [
          { title: '取走全部纸张', text: '检查出纸口与周边台面' },
          { title: '拔出 U 盘或带走原件', text: '如本次使用了外接介质或扫描原件' },
          { title: '退出本人账号', text: '清除本机临时会话与敏感状态' },
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        title: '售后凭任务号核验',
        text: '缺页、错印或重复扣费请关联本订单提交反馈。',
      },
    ],
  })

  P.add({
    id: 34,
    title: '扫描材料类型',
    section: 'print',
    template: 'directory',
    kicker: '材料扫描 · 第 1 步',
    summary: '材料类型只影响后续用途与保存策略。',
    goal: '选择正确的扫描结果用途。',
    action: '选择类型并查看面板指引',
    mapping: '保留独屏；不承诺网页远程启动扫描。',
    task: '材料扫描',
    taskStatus: '等待选择材料类型',
    primary: { label: '扫描简历', to: '35' },
    secondary: { label: '返回打印扫描', to: '02' },
    sections: [
      {
        title: '本次扫描什么',
        caption: '选择后仍需在设备面板操作',
        kind: 'rows',
        items: [
          { title: '纸质简历', text: '扫描后可进入 OCR 与简历诊断', to: '35' },
          { title: '普通文档', text: '扫描为 PDF 或图片后保存、下载或打印', to: '35' },
          { title: '证件材料', text: '短期保存并显示敏感信息提醒', to: '35', state: '敏感' },
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        title: '当前真实方式',
        text: '放置原件后，在打印机面板选择已配置的扫描到本机位置。',
      },
    ],
  })

  P.add({
    id: 35,
    title: '扫描面板指引',
    section: 'print',
    template: 'workbench',
    kicker: '材料扫描 · 第 2 步',
    summary: '网页负责建会话和等待文件，扫描动作在设备面板完成。',
    goal: '让用户按真实硬件路径完成扫描。',
    action: '完成面板操作后开始等待',
    mapping: '保留独屏；“扫描设置”改为面板操作说明。',
    task: '扫描纸质简历',
    taskStatus: '扫描会话已创建 · 尚未收到文件',
    primary: { label: '我已在面板开始扫描', to: '36', confirm: true },
    secondary: { label: '取消扫描会话', to: '34', confirm: true },
    sections: [
      {
        title: '设备面板四步',
        caption: '不同设备文字可能略有差异',
        kind: 'timeline',
        items: [
          { title: '放置原件', text: '单页放玻璃稿台，多页按现场指引使用输稿器', status: 'active' },
          {
            title: '在面板选择扫描',
            text: '选择扫描到网络或本机已配置接收位置',
            status: 'pending',
          },
          { title: '确认格式并开始', text: '建议 PDF；页数与方向在面板核对', status: 'pending' },
          { title: '回到本屏等待', text: '文件到达后系统会继续处理', status: 'pending' },
        ],
      },
      {
        title: '本次会话',
        caption: '只接收本次任务文件',
        kind: 'metrics',
        items: [
          ['会话号', 'S-0821'],
          ['类型', '纸质简历'],
          ['状态', '等待文件'],
        ],
      },
    ],
    rail: [
      {
        kind: 'warning',
        title: '不要离开原件',
        text: '扫描结束后立即取走纸质材料；本机不会远程控制打印机面板。',
      },
    ],
  })

  P.add({
    id: 36,
    title: '等待扫描文件',
    section: 'print',
    template: 'progress',
    kicker: '材料扫描 · 第 3 步',
    summary: '等待真实文件到达，不显示假进度条。',
    goal: '明确等待状态、超时与恢复方式。',
    action: '继续等待或返回检查面板',
    mapping: '并入流程状态；保留独立可恢复路由。',
    task: '扫描会话 S-0821',
    taskStatus: '等待接收目录出现新文件',
    primary: { label: '检查是否收到文件', to: '36' },
    secondary: { label: '返回面板指引', to: '35' },
    sections: [
      {
        title: '当前状态',
        caption: '已等待 42 秒',
        kind: 'progress',
        headline: '尚未收到扫描文件',
        text: '如果设备面板显示失败，请回到指引检查接收位置与网络。',
      },
      {
        title: '等待事件',
        caption: '以实际文件与服务端记录为准',
        kind: 'timeline',
        items: [
          { title: '扫描会话已创建', text: '会话与终端已绑定', status: 'done' },
          { title: '等待文件到达', text: '接收目录尚无新文件', status: 'active' },
          { title: '文件安全检查', text: '收到文件后执行', status: 'pending' },
          { title: '生成扫描结果', text: '检查完成后才展示', status: 'pending' },
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        title: '超时不会伪造成功',
        text: '长时间未收到文件时保持等待或失败，不生成假 FileObject。',
      },
    ],
  })

  P.add({
    id: 37,
    title: '扫描结果',
    section: 'print',
    template: 'document',
    kicker: '材料扫描 · 第 4 步',
    summary: '先检查页数和方向，再决定保存、打印或识别。',
    goal: '把真实扫描文件交给后续流程。',
    action: '选择结果去向',
    mapping: '保留独屏；临时保存和长期保存不再混用。',
    task: '扫描结果 S-0821.pdf',
    taskStatus: '已收到 3 页 PDF · 等待本人确认',
    primary: { label: '作为简历进入诊断', to: '27', confirm: true },
    secondary: { label: '进入打印预览', to: '64' },
    sections: [
      {
        title: '扫描预览',
        caption: '3 页 · PDF',
        kind: 'document',
        heading: '扫描文件第 1 页',
        body: '请检查文字方向、页面边缘和是否缺页。\n\n确认后可进入 OCR、打印或本人文档。',
      },
      {
        title: '结果去向',
        caption: '每个动作有独立数据归宿',
        kind: 'rows',
        items: [
          { title: 'AI 简历识别', text: '创建简历解析任务，不覆盖原扫描件', to: '27' },
          { title: '打印扫描件', text: '进入统一预览、参数和支付流程', to: '64' },
          { title: '保存到我的文档', text: '需要登录并选择允许的保存期限', to: '17' },
        ],
      },
    ],
    rail: [
      {
        kind: 'warning',
        title: '临时文件会清理',
        text: '未登录或未主动保存时，扫描文件按短期策略自动删除。',
      },
    ],
  })

  P.add({
    id: 38,
    title: '模拟面试设置',
    section: 'interview',
    template: 'workbench',
    kicker: 'AI 面试训练 · 准备',
    summary: '只收集影响出题的四项信息，其他设置使用合理默认值。',
    goal: '快速开始私密练习。',
    action: '确认场景并开始练习',
    mapping: '保留独屏；原超长选项表单收敛为岗位、面试官、难度、时长。',
    task: '行政专员模拟面试',
    taskStatus: '场景已配置 · 等待开始',
    primary: { label: '确认场景并开始练习', to: '39', confirm: true },
    secondary: { label: '查看面试技巧', to: '41' },
    sections: [
      {
        title: '岗位场景',
        caption: '用于生成练习问题',
        kind: 'form',
        fields: [
          { label: '目标岗位', value: '行政专员' },
          { label: '经验阶段', value: '1-3 年' },
        ],
      },
      {
        title: '面试官',
        caption: '选择本次关注重点',
        kind: 'segments',
        items: ['HR 初筛', '业务主管', '终面负责人'],
        selected: 0,
      },
      {
        title: '难度',
        caption: '不使用“录用概率”或企业评分',
        kind: 'segments',
        items: ['轻松练习', '标准练习', '压力练习'],
        selected: 1,
      },
      {
        title: '时长',
        caption: '短时练习更适合公共终端',
        kind: 'segments',
        items: ['3 分钟', '5 分钟', '8 分钟'],
        selected: 1,
      },
      {
        title: '简历',
        caption: '可选 · 仅用于本次出题',
        kind: 'choices',
        items: [
          { title: '使用行政专员简历 v2', text: '本人已授权用于本次练习', selected: true },
          { title: '不使用简历', text: '按通用岗位问题练习' },
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        title: '练习结果仅本人可见',
        text: '不提供企业端查看，不参与筛选、邀约或录用。',
      },
    ],
  })

  P.add({
    id: 39,
    title: '模拟面试',
    section: 'interview',
    template: 'workbench',
    kicker: 'AI 面试训练 · 第 2 / 5 题',
    summary: '问题、作答和控制项保持单一焦点。',
    goal: '完成一轮可恢复的文字或语音练习。',
    action: '确认本题作答',
    mapping: '保留独屏；删除多状态叠加和装饰性聊天气泡。',
    task: '行政专员 · HR 初筛',
    taskStatus: '第 2 题作答中 · 已自动保存草稿',
    primary: { label: '确认本题并继续', to: '39', confirm: true },
    secondary: { label: '暂存并退出', to: '42', confirm: true },
    sections: [
      {
        title: '问题 02',
        caption: '请用 1-2 分钟回答',
        kind: 'text',
        paragraphs: ['请介绍一次你协调多个部门完成任务的经历。你遇到了什么阻力，最后如何处理？'],
      },
      {
        title: '你的回答',
        caption: '可使用文字或已授权语音',
        kind: 'form',
        fields: [
          {
            label: '作答内容',
            value:
              '在一次校招活动中，我负责协调四个部门。开始时材料提交时间不一致，我先建立统一清单，再逐项跟进……',
            wide: true,
            textarea: true,
          },
        ],
      },
      {
        title: '本题检查',
        caption: '提交前由规则快速检查',
        kind: 'rows',
        items: [
          { title: '情境与任务', text: '已说明' },
          { title: '个人动作', text: '建议再具体一点', state: '可补充' },
          { title: '结果', text: '尚未说明', state: '待补充' },
        ],
      },
    ],
    rail: [
      {
        kind: 'task',
        pairs: [
          ['进度', '2 / 5 题'],
          ['草稿', '已保存'],
          ['网络', '可用'],
          ['录音', '仅本次会话'],
        ],
      },
      {
        kind: 'assistant',
        title: '只给提示，不代答',
        text: 'AI 可以指出回答缺口，但不会生成一段让你照读的虚假经历。',
      },
    ],
  })

  P.add({
    id: 40,
    title: '面试练习报告',
    section: 'interview',
    template: 'document',
    kicker: 'AI 面试训练 · 本人复盘',
    summary: '用行为证据和等级描述，不使用企业评分仪表盘。',
    goal: '帮助用户找到下一次练习重点。',
    action: '保存报告或再次练习',
    mapping: '保留独屏；分数仪表盘改为证据、风险和行动建议。',
    task: '行政专员模拟面试报告',
    taskStatus: '报告已完成 · 仅本人可见',
    primary: { label: '保存到我的文档', to: '17', confirm: true },
    secondary: { label: '重新练习', to: '38' },
    sections: [
      {
        title: '本轮结论',
        caption: '基于 5 道回答与确认后的文本',
        kind: 'metrics',
        items: [
          ['表达结构', '良好'],
          ['岗位匹配表达', '需加强'],
          ['事实完整性', '良好'],
        ],
      },
      {
        title: '证据与建议',
        caption: '每条结论可回到回答',
        kind: 'rows',
        items: [
          { title: '能说明跨部门协调动作', text: '第 2 题提到统一清单和逐项跟进' },
          {
            title: '结果表达不足',
            text: '第 2、4 题没有说明量化结果或最终影响',
            state: '优先练习',
          },
          { title: '回答偏长', text: '第 3 题前置信息占比过高', state: '建议压缩' },
        ],
      },
      {
        title: '下一次练习',
        caption: '只给本人行动建议',
        kind: 'rows',
        items: [
          { title: '结果量化专项', text: '用 3 道题练习结果表达' },
          { title: 'STAR 结构复习', text: '查看 5 个高频场景示例', to: '41' },
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        title: '不是招聘结果',
        text: '等级和建议只用于本人练习，不代表企业评价或录用判断。',
      },
    ],
  })

  P.add({
    id: 41,
    title: '面试技巧',
    section: 'interview',
    template: 'collection',
    kicker: '练习前参考',
    summary: '技巧按场景组织，并能直接进入练习。',
    goal: '在短时间内掌握可练习的方法。',
    action: '查看技巧并开始练习',
    mapping: '保留独屏；知识列表不包装成 AI 生成卡片。',
    task: '准备行政专员面试',
    taskStatus: '正在查看表达结构技巧',
    primary: { label: '按 STAR 结构开始练习', to: '38' },
    secondary: { label: '打印技巧清单', to: '64' },
    sections: [
      {
        title: '高频技巧',
        caption: '精选 5 个场景',
        kind: 'rows',
        items: [
          { title: 'STAR 结构', text: '情境、任务、行动、结果；重点放在个人动作' },
          { title: '一分钟自我介绍', text: '岗位方向、两项证据、求职动机' },
          { title: '离职与转岗', text: '保持事实、避免贬低前单位' },
          { title: '薪资沟通', text: '先确认岗位范围和结构，再表达期望' },
          { title: '向面试官提问', text: '围绕岗位目标、协作方式和成长路径' },
        ],
      },
    ],
    rail: [
      {
        kind: 'assistant',
        title: '把技巧变成练习',
        text: '选择一个场景后，AI 只负责出题和反馈，不代替本人回答。',
      },
    ],
  })

  P.add({
    id: 42,
    title: '历史面试报告',
    section: 'interview',
    template: 'collection',
    kicker: '本人练习记录',
    summary: '历史记录、恢复中的会话和空态分开呈现。',
    goal: '继续未完成练习或复盘报告。',
    action: '打开报告或恢复练习',
    mapping: '保留独屏；不在一屏同时堆空态与有数据状态。',
    task: '查看模拟面试记录',
    taskStatus: '1 个未完成 · 3 份报告',
    primary: { label: '继续未完成练习', to: '39' },
    secondary: { label: '开始新练习', to: '38' },
    sections: [
      {
        title: '继续练习',
        caption: '草稿仍在有效期内',
        kind: 'rows',
        items: [
          {
            title: '行政专员 · HR 初筛',
            text: '已完成 2 / 5 题 · 8 月 5 日 17:40',
            to: '39',
            state: '可恢复',
          },
        ],
      },
      {
        title: '历史报告',
        caption: '仅本人可见',
        kind: 'rows',
        items: [
          { title: '行政专员 · 标准练习', text: '8 月 3 日 · 5 题 · 结果表达需加强', to: '40' },
          { title: '校园活动运营 · 轻松练习', text: '7 月 28 日 · 3 题 · 表达结构良好', to: '40' },
          { title: '通用 HR 初筛', text: '7 月 20 日 · 5 题', to: '40' },
        ],
      },
    ],
    rail: [
      {
        kind: 'warning',
        title: '公共终端语音清理',
        text: '录音和临时转写按保存策略清理，报告只保留本人确认后的内容。',
      },
    ],
  })

  P.add({
    id: 43,
    title: '招聘会签到入口',
    section: 'fairs',
    template: 'detail',
    kicker: '来源平台办理',
    summary: '只展示主办方签到入口与步骤，不假装平台能确认签到。',
    goal: '安全打开主办方签到方式。',
    action: '扫码前往来源平台签到',
    mapping: '保留独屏；签到成功状态删除，外跳记录只写“打开来源”。',
    task: '夏季高校毕业生招聘会',
    taskStatus: '签到入口可查看 · 第三方结果不可见',
    primary: {
      label: '扫码前往来源平台签到',
      to: '43',
      confirm: true,
      tone: 'source',
      external: true,
    },
    secondary: { label: '返回招聘会详情', to: '11' },
    sections: [
      {
        title: '主办方签到方式',
        caption: '请使用手机扫码',
        kind: 'qr',
        text: '来源平台签到码示意\n原型不可扫码',
      },
      {
        title: '三步说明',
        caption: '在来源平台完成',
        kind: 'timeline',
        items: [
          { title: '手机扫描签到码', text: '打开主办方页面', status: 'active' },
          { title: '核实场次与个人信息', text: '按来源平台要求填写', status: 'pending' },
          { title: '查看来源平台结果', text: '本机不接收结果回流', status: 'pending' },
        ],
      },
    ],
    rail: [
      {
        kind: 'task',
        pairs: [
          ['来源', '招聘会主办方'],
          ['外部 ID', 'FAIR-2071'],
          ['更新时间', '2026-08-05 16:20'],
          ['平台记录', '仅打开来源'],
        ],
      },
    ],
  })

  P.add({
    id: 44,
    title: '参展企业',
    section: 'fairs',
    template: 'collection',
    kicker: '招聘会公开信息',
    summary: '企业、展位、行业和岗位数量使用可扫描列表。',
    goal: '快速找到值得到访的展位。',
    action: '查看展位企业详情',
    mapping: '保留独屏；筛选保持最少必要项。',
    task: '规划招聘会展位路线',
    taskStatus: '已筛选现代服务业 · 18 家企业',
    primary: { label: '查看已选企业', to: '45' },
    secondary: { label: '查看场馆导览', to: '46' },
    sections: [
      {
        title: '筛选企业',
        caption: '信息由主办方同步',
        kind: 'form',
        fields: [
          { label: '行业', value: '现代服务业' },
          { label: '关键词', value: '行政' },
        ],
      },
      {
        title: '企业与展位',
        caption: '18 家符合条件',
        kind: 'rows',
        items: [
          { title: '某科技服务公司 · A12', text: '信息技术 · 5 个公开岗位', to: '45' },
          { title: '某连锁服务企业 · B08', text: '生活服务 · 8 个公开岗位', to: '45' },
          { title: '某供应链公司 · C21', text: '物流服务 · 4 个公开岗位', to: '45' },
        ],
      },
    ],
    rail: [
      {
        kind: 'assistant',
        title: '生成参会准备单',
        text: '选择本人简历后，可把关注企业与材料清单整理成一页准备单。',
      },
    ],
  })

  P.add({
    id: 45,
    title: '展位企业详情',
    section: 'fairs',
    template: 'detail',
    kicker: '主办方同步企业',
    summary: '企业介绍、展位和公开岗位分层展示。',
    goal: '判断是否值得到访并查看来源岗位。',
    action: '查看企业岗位来源',
    mapping: '保留独屏；一个企业只有一个清晰来源动作。',
    task: '查看 A12 展位企业',
    taskStatus: '企业与岗位信息已加载',
    primary: { label: '查看来源平台岗位', to: '09' },
    secondary: { label: '加入参会准备单', to: '48' },
    sections: [
      {
        title: '某科技服务公司',
        caption: '展位 A12 · 信息技术',
        kind: 'metrics',
        items: [
          ['公开岗位', '5 个'],
          ['展位', 'A12'],
          ['来源', '主办方同步'],
        ],
      },
      {
        title: '企业介绍',
        caption: '来源公开内容',
        kind: 'text',
        paragraphs: [
          '面向企业提供数字化运营与客户服务。',
          '本场公开岗位包括行政专员、客户支持与项目助理。',
        ],
      },
      {
        title: '公开岗位',
        caption: '详情以来源平台为准',
        kind: 'rows',
        items: [
          { title: '行政专员', text: '5-7K · 1-3 年', to: '09' },
          { title: '客户支持', text: '5-8K · 经验不限', to: '09' },
        ],
      },
    ],
    rail: [
      {
        kind: 'task',
        pairs: [
          ['展位', 'A12'],
          ['来源机构', '招聘会主办方'],
          ['同步时间', '2026-08-05 15:50'],
          ['外部 ID', 'COMP-1021'],
        ],
      },
      { kind: 'truth', title: '不收简历', text: '本机不代收简历，也不向企业推荐或回传候选人。' },
    ],
  })
})(window.KioskPrototype)
