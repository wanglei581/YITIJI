;(function (P) {
  P.add({
    id: 16,
    title: '我的简历',
    section: 'account',
    template: 'collection',
    kicker: '本人简历资产',
    summary: '按简历版本组织诊断、优化和打印去向。',
    goal: '继续使用本人简历，而不是重新上传。',
    action: '选择简历版本',
    mapping: '保留独屏；诊断和优化记录归入版本时间线。',
    task: '管理我的简历',
    taskStatus: '已加载本人 3 份简历',
    activeTab: 'profile',
    primary: { label: '查看行政专员简历', to: '06' },
    secondary: { label: '导入新简历', to: '05' },
    sections: [
      {
        title: '简历版本',
        caption: '最近更新优先',
        kind: 'rows',
        items: [
          {
            title: '行政专员 · 优化版 v2',
            text: '8 月 5 日更新 · 已完成诊断与 3 条优化',
            to: '07',
            state: '当前使用',
          },
          { title: '行政专员 · 原始版 v1', text: '8 月 5 日上传 · PDF · 3 页', to: '06' },
          {
            title: '校园活动运营 · 生成版',
            text: '7 月 28 日生成 · 待核实 1 项',
            to: '26',
            state: '待核实',
          },
        ],
      },
      {
        title: '可继续的动作',
        caption: '作用于当前选中版本',
        kind: 'rows',
        items: [
          { title: '查看诊断报告', text: '回看问题与原文证据', to: '06' },
          { title: '针对岗位优化', text: '选择目标岗位后逐条确认修改', to: '08' },
          { title: '预览并打印', text: '进入统一打印链路', to: '64' },
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        title: '本人数据',
        text: '简历只用于本人服务，不提供企业查看、筛选或邀约。',
      },
    ],
  })

  P.add({
    id: 17,
    title: '我的文档',
    section: 'account',
    template: 'collection',
    kicker: '本人文件',
    summary: '文件状态、保存期限和后续动作在同一行说明。',
    goal: '安全管理可打印文件。',
    action: '预览、打印或调整保存期限',
    mapping: '保留独屏；删除装饰卡片，用文件列表承载真实状态。',
    task: '管理本人文档',
    taskStatus: '已加载 4 个可用文件',
    activeTab: 'profile',
    primary: { label: '预览当前文件', to: '64' },
    secondary: { label: '上传新文件', to: '31' },
    sections: [
      {
        title: '可用文件',
        caption: '按保存期限排序',
        kind: 'rows',
        items: [
          {
            title: '行政专员简历-优化版.pdf',
            text: 'PDF · 3 页 · 长期保存 · 8 月 5 日更新',
            to: '64',
            state: '可用',
          },
          {
            title: '招聘会参会准备单.pdf',
            text: 'PDF · 2 页 · 90 天后到期',
            to: '64',
            state: '可用',
          },
          {
            title: '身份证复印件.png',
            text: '敏感文件 · 24 小时后自动清理',
            to: '64',
            state: '临时',
          },
          { title: '旧扫描件.pdf', text: '签名链接已过期，需要重新获取', state: '需刷新' },
        ],
      },
      {
        title: '文件操作',
        caption: '删除需要二次确认',
        kind: 'rows',
        items: [
          { title: '再次打印', text: '进入预览、参数和服务端核价', to: '64' },
          { title: '签名盖章排版', text: '图片叠加，不是 CA 电子签', to: '67' },
          { title: '调整保存期限', text: '仅显示服务端允许的策略' },
        ],
      },
    ],
    rail: [
      {
        kind: 'warning',
        title: '敏感文件短期保留',
        text: '证件和匿名上传文件不能设置为长期保存。',
      },
    ],
  })

  P.add({
    id: 18,
    title: '打印订单',
    section: 'account',
    template: 'collection',
    kicker: '本人订单与履约',
    summary: '支付、打印、失败和退款状态使用同一状态机。',
    goal: '查询真实进度并找到售后入口。',
    action: '查看订单详情',
    mapping: '保留独屏；取件码仅在后端允许时展示。',
    task: '查看打印订单',
    taskStatus: '已加载最近 7 笔订单',
    activeTab: 'profile',
    primary: { label: '查看进行中订单', to: '04' },
    secondary: { label: '提交异常反馈', to: '22' },
    sections: [
      {
        title: '订单状态',
        caption: '最近 30 天',
        kind: 'rows',
        items: [
          {
            title: 'O-20260805-0102 · 个人简历',
            text: '3.00 元 · 任务已领取 · 最后更新 18:08',
            to: '04',
            state: '进行中',
          },
          {
            title: 'O-20260802-0088 · 招聘会资料',
            text: '2.00 元 · Agent 已确认完成',
            to: '33',
            state: '已完成',
          },
          {
            title: 'O-20260729-0061 · 扫描件',
            text: '支付失败 · 未创建打印任务',
            to: '32',
            state: '支付失败',
          },
          { title: 'O-20260721-0033 · 简历', text: '退款处理中 · 预计原路返回', state: '退款中' },
        ],
      },
    ],
    rail: [
      {
        kind: 'task',
        pairs: [
          ['进行中', '1 笔'],
          ['已完成', '4 笔'],
          ['退款中', '1 笔'],
          ['异常', '1 笔'],
        ],
      },
      {
        kind: 'truth',
        title: '完成以真实事件为准',
        text: '前端轮询、付款成功或预计时间都不能单独证明已出纸。',
      },
    ],
  })

  P.add({
    id: 19,
    title: 'AI 服务记录',
    section: 'account',
    template: 'collection',
    kicker: '本人 AI 结果',
    summary: '按任务类型和成果去向组织，不保存公共终端闲聊。',
    goal: '回看、继续或删除本人 AI 结果。',
    action: '打开结果并继续处理',
    mapping: '保留独屏；聊天记录不进入长期资产。',
    task: '查看 AI 服务记录',
    taskStatus: '已加载本人可见结果',
    activeTab: 'profile',
    primary: { label: '查看最近诊断', to: '06' },
    secondary: { label: '管理 AI 授权', to: '23' },
    sections: [
      {
        title: '最近结果',
        caption: '仅本人可见',
        kind: 'rows',
        items: [
          {
            title: '行政专员简历诊断',
            text: '完成 · 8 月 5 日 · 已生成优化版',
            to: '06',
            state: '完成',
          },
          { title: '模拟面试练习报告', text: '完成 · 8 月 3 日 · 5 道题', to: '40', state: '完成' },
          {
            title: '招聘会参会准备单',
            text: '完成 · 8 月 1 日 · 已保存到文档',
            to: '48',
            state: '完成',
          },
          { title: '岗位匹配参考', text: '本人已删除 · 不再可恢复', state: '已删除' },
        ],
      },
    ],
    rail: [
      {
        kind: 'warning',
        title: '删除不可恢复',
        text: '删除 AI 结果需要再次确认，不会由 AI 自动执行。',
      },
    ],
  })

  P.add({
    id: 20,
    title: '收藏与浏览',
    section: 'account',
    template: 'collection',
    kicker: '岗位、招聘会与政策',
    summary: '收藏、浏览和打开来源分开记录。',
    goal: '回到曾经关注的信息并识别其来源状态。',
    action: '查看收藏详情',
    mapping: '保留独屏；不把来源打开记录写成投递或预约结果。',
    task: '查看收藏与浏览',
    taskStatus: '已加载本人最近记录',
    activeTab: 'profile',
    primary: { label: '查看收藏岗位', to: '09' },
    sections: [
      {
        title: '我的收藏',
        caption: '3 个类型',
        kind: 'rows',
        items: [
          {
            title: '行政专员 · 某科技服务公司',
            text: '岗位 · 来源仍可访问 · 8 月 5 日收藏',
            to: '09',
          },
          { title: '夏季高校毕业生招聘会', text: '招聘会 · 8 月 9 日举行', to: '11' },
          { title: '灵活就业社保补贴', text: '政策 · 官方原文 7 月更新', to: '12' },
        ],
      },
      {
        title: '最近打开来源',
        caption: '仅记录打开动作',
        kind: 'rows',
        items: [
          { title: '市就业服务平台岗位页', text: '8 月 5 日 17:50 · 不知道是否投递' },
          { title: '招聘会官方预约页', text: '8 月 4 日 19:12 · 不知道是否预约' },
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        title: '第三方结果不可见',
        text: '平台不读取来源平台账号，也不回流投递、预约或签到结果。',
      },
    ],
  })

  P.add({
    id: 21,
    title: '我的权益',
    section: 'account',
    template: 'collection',
    kicker: '本人可用权益',
    summary: '显示来源、有效期、适用范围和冻结状态。',
    goal: '让用户知道订单可以使用什么权益。',
    action: '查看权益使用规则',
    mapping: '保留独屏；资格提示不包装成已领取或已到账。',
    task: '查看我的权益',
    taskStatus: '2 项可用 · 1 项即将到期',
    activeTab: 'profile',
    primary: { label: '查看可参与活动', to: '24' },
    sections: [
      {
        title: '可用权益',
        caption: '核销结果以服务端为准',
        kind: 'rows',
        items: [
          {
            title: '黑白打印 5 页',
            text: '来源：高校毕业生服务活动 · 8 月 31 日到期',
            state: '可用',
          },
          {
            title: 'AI 简历诊断 1 次',
            text: '来源：首次登录权益 · 8 月 12 日到期',
            state: '即将到期',
          },
          { title: '模拟面试体验 1 次', text: '退款处理中，暂不可使用', state: '冻结' },
        ],
      },
      {
        title: '资格提示',
        caption: '不代表已审核通过',
        kind: 'rows',
        items: [
          {
            title: '高校毕业生就业服务资格',
            text: '可能符合条件，请前往官方渠道核验材料与结果',
            state: '待核验',
          },
        ],
      },
    ],
    rail: [
      {
        kind: 'warning',
        title: '权益不是现金承诺',
        text: '资格、补贴和活动领取均以服务端或官方审核结果为准。',
      },
    ],
  })

  P.add({
    id: 22,
    title: '通知与反馈',
    section: 'account',
    template: 'collection',
    kicker: '真实服务消息',
    summary: '消息关联具体任务，反馈关联具体订单或设备。',
    goal: '处理异常并保留可追踪的服务记录。',
    action: '查看消息或提交反馈',
    mapping: '保留独屏；通知和反馈在同一入口内分区，不再做重复卡片。',
    task: '通知与售后',
    taskStatus: '2 条未读 · 1 个反馈处理中',
    activeTab: 'profile',
    primary: { label: '提交打印问题反馈', to: '22', confirm: true },
    sections: [
      {
        title: '服务通知',
        caption: '与真实对象关联',
        kind: 'rows',
        items: [
          {
            title: '打印任务状态已更新',
            text: '订单 O-20260805-0102 · 等待 Agent 回报',
            to: '04',
            state: '未读',
          },
          {
            title: 'AI 简历诊断已完成',
            text: '行政专员简历 · 可查看报告',
            to: '06',
            state: '未读',
          },
          { title: '退款申请已受理', text: '预计按原支付渠道处理', state: '已读' },
        ],
      },
      {
        title: '我的反馈',
        caption: '可上传现场凭证',
        kind: 'rows',
        items: [
          {
            title: '订单 O-20260729-0061 · 缺页',
            text: '已受理 · 工作人员核验中',
            state: '处理中',
          },
        ],
      },
    ],
    rail: [
      {
        kind: 'task',
        pairs: [
          ['关联订单', '可选'],
          ['问题类型', '打印 / 扫描 / 支付'],
          ['现场凭证', '可上传'],
          ['处理结果', '消息通知'],
        ],
      },
    ],
  })

  P.add({
    id: 23,
    title: '账号与隐私设置',
    section: 'account',
    template: 'workbench',
    kicker: '公共终端账户安全',
    summary: '只提供已实现的设置、授权和退出能力。',
    goal: '管理本人会话和 AI 数据授权。',
    action: '保存授权设置或安全退出',
    mapping: '保留独屏；未完成的换绑和注销不显示可用按钮。',
    task: '账号设置',
    taskStatus: '当前账号 138****6608',
    activeTab: 'profile',
    primary: { label: '保存设置', to: '23', confirm: true },
    secondary: { label: '退出并清理本机会话', to: '01', confirm: true },
    sections: [
      {
        title: '账号状态',
        caption: '只读信息',
        kind: 'metrics',
        items: [
          ['手机号', '138****6608'],
          ['登录方式', '微信扫码'],
          ['会话', '24 分钟后到期'],
        ],
      },
      {
        title: 'AI 数据授权',
        caption: '按用途分别管理',
        kind: 'choices',
        items: [
          { title: '简历诊断与优化', text: '允许处理本人选中的简历文件', selected: true },
          { title: '岗位匹配参考', text: '允许使用本人简历与已发布岗位', selected: true },
          { title: '模拟面试', text: '只处理本次作答与确认后的转写', selected: false },
        ],
      },
      {
        title: '个人信息请求',
        caption: '导出与删除按工单处理',
        kind: 'rows',
        items: [
          { title: '查看隐私政策与保存期限', text: '打开正式法律文档', to: '59' },
          { title: '提交本人数据请求', text: '进入可追踪的处理流程' },
        ],
      },
    ],
    rail: [
      {
        kind: 'warning',
        title: '撤回后的影响',
        text: '撤回授权会阻止新的相关 AI 请求，不自动删除既有合法结果。',
      },
    ],
  })

  P.add({
    id: 24,
    title: '权益活动',
    section: 'account',
    template: 'collection',
    kicker: '可验证活动',
    summary: '活动来源、适用人群、有效期和领取条件清楚展示。',
    goal: '领取真实权益并进入本人权益记录。',
    action: '查看活动详情',
    mapping: '保留独屏；移除套餐和凭证占位，只展示后台已发布活动。',
    task: '浏览权益活动',
    taskStatus: '2 个活动可查看',
    activeTab: 'profile',
    primary: { label: '查看毕业生服务活动', to: '72' },
    sections: [
      {
        title: '当前活动',
        caption: '由运营审核发布',
        kind: 'rows',
        items: [
          {
            title: '高校毕业生求职材料服务',
            text: 'AI 诊断 1 次 + 黑白打印 5 页 · 8 月 31 日结束',
            to: '72',
            state: '进行中',
          },
          {
            title: '招聘会现场打印支持',
            text: '仅限指定场次与指定终端 · 8 月 9 日',
            to: '72',
            state: '限场次',
          },
        ],
      },
      {
        title: '我的领取记录',
        caption: '权益进入本人账户后才算领取成功',
        kind: 'rows',
        items: [
          {
            title: '首次登录 AI 诊断权益',
            text: '已领取 · 可在“我的权益”查看',
            to: '21',
            state: '已领取',
          },
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        title: '无真实结果不显示成功',
        text: '按钮点击、加载动画或前端缓存都不能证明权益已经发放。',
      },
    ],
  })

  P.add({
    id: 25,
    title: 'AI 简历生成',
    section: 'resume',
    template: 'workbench',
    kicker: 'AI 简历 · 从真实信息开始',
    summary: '分段填写，不要求一次完成超长表单。',
    goal: '帮助没有电子简历的用户形成可核实初稿。',
    action: '确认真实信息并生成初稿',
    mapping: '保留独屏；长表单分段，AI 不编造空缺字段。',
    task: '生成行政专员简历',
    taskStatus: '基本信息已完成 · 经历待补充',
    primary: { label: '确认信息并生成初稿', to: '26', confirm: true },
    secondary: { label: '保存草稿', to: '25' },
    sections: [
      {
        title: '求职目标',
        caption: '决定内容顺序，不决定录用结果',
        kind: 'form',
        fields: [
          { label: '目标岗位', value: '行政专员' },
          { label: '所在城市', value: '杭州市' },
        ],
      },
      {
        title: '基本信息',
        caption: '仅填写愿意出现在简历上的内容',
        kind: 'form',
        fields: [
          { label: '姓名', value: '王雨晴' },
          { label: '联系方式', value: '138****6608' },
          { label: '最高学历', value: '本科' },
          { label: '专业', value: '行政管理' },
        ],
      },
      {
        title: '经历素材',
        caption: '先写事实，AI 再帮助组织表达',
        kind: 'form',
        fields: [
          {
            label: '一段真实经历',
            value: '负责校招活动材料与现场协调，共整理 120 份材料。',
            wide: true,
          },
        ],
      },
    ],
    rail: [
      {
        kind: 'assistant',
        title: '缺什么就停在哪里',
        text: 'AI 会标记需要本人补充的事实，不用占位内容凑成完整简历。',
      },
    ],
  })

  P.add({
    id: 26,
    title: '生成预览',
    section: 'resume',
    template: 'document',
    kicker: 'AI 简历 · 初稿核实',
    summary: '先核实内容，再选模板和生成打印文件。',
    goal: '发现错误并按段修改。',
    action: '确认内容并进入导出',
    mapping: '保留独屏；“点击任意文字”改为明确段落编辑入口。',
    task: '行政专员简历初稿',
    taskStatus: '初稿已生成 · 1 项待核实',
    primary: { label: '内容核实完成，继续', to: '28', confirm: true },
    secondary: { label: '返回补充信息', to: '25' },
    sections: [
      {
        title: '简历初稿',
        caption: '当前为内容预览，不是最终 PDF',
        kind: 'document',
        heading: '王雨晴 · 行政专员',
        body: '行政管理本科，具备校招活动材料整理与跨部门协调经验。\n\n项目经历：协调 4 个部门完成活动筹备，整理 120 份现场材料。',
      },
      {
        title: '待本人核实',
        caption: '确认后才能导出',
        kind: 'rows',
        items: [
          { title: '“协调 4 个部门”是否准确', text: '来源于你填写的经历素材', state: '待确认' },
          { title: '联系方式是否用于本版简历', text: '138****6608', state: '已确认' },
        ],
      },
    ],
    rail: [
      {
        kind: 'task',
        pairs: [
          ['内容版本', '初稿 v1'],
          ['待核实', '1 项'],
          ['模板', '尚未选择'],
          ['PDF', '尚未生成'],
        ],
      },
    ],
  })

  P.add({
    id: 27,
    title: '简历解析',
    section: 'resume',
    template: 'progress',
    kicker: 'AI 简历 · 解析中',
    summary: '显示真实任务阶段，允许取消和失败恢复。',
    goal: '减少等待不确定性。',
    action: '等待、取消或失败后重试',
    mapping: '并入流程状态；旧路由保留，作为解析任务的可恢复页面。',
    task: '解析王雨晴-行政专员.pdf',
    taskStatus: '服务端任务处理中',
    primary: { label: '刷新解析状态', to: '27' },
    secondary: { label: '取消解析', to: '05', confirm: true },
    sections: [
      {
        title: '当前阶段',
        caption: '任务 AI-20260805-0218',
        kind: 'progress',
        headline: '正在识别简历结构',
        text: '页面关闭后任务仍可在本人 AI 服务记录中继续查看。',
      },
      {
        title: '处理步骤',
        caption: '不使用假百分比',
        kind: 'timeline',
        items: [
          { title: '文件安全检查', text: '格式与大小已通过', status: 'done' },
          { title: '文字与结构识别', text: '正在处理', status: 'active' },
          { title: '低置信度字段确认', text: '如有问题将请本人校对', status: 'pending' },
          { title: '生成诊断任务', text: '解析完成后才创建', status: 'pending' },
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        title: '失败可以恢复',
        text: '网络中断不应丢失已上传文件与任务 ID；重试不能重复扣权益。',
      },
    ],
  })

  P.add({
    id: 28,
    title: '导出与去向',
    section: 'resume',
    template: 'workbench',
    kicker: 'AI 简历 · 成果交付',
    summary: '先选成果格式，再选择下载、保存或打印。',
    goal: '让收费、权益和文件去向透明。',
    action: '确认格式与去向',
    mapping: '保留独屏；不预先展示不存在的下载文件。',
    task: '导出行政专员简历 v2',
    taskStatus: '内容已确认 · 等待选择格式',
    primary: { label: '确认生成 PDF', to: '64', confirm: true },
    secondary: { label: '选择简历模板', to: '29' },
    sections: [
      {
        title: '成果格式',
        caption: '格式能力以服务端实际支持为准',
        kind: 'choices',
        items: [
          { title: 'PDF', text: '预览与打印使用同一版式', selected: true },
          { title: 'DOCX', text: '可编辑派生文件，不保证还原原件版式' },
          { title: '纯文本', text: '用于继续编辑内容' },
        ],
      },
      {
        title: '成果去向',
        caption: '收费与权益在确认前展示',
        kind: 'choices',
        items: [
          { title: '本机预览并打印', text: '进入统一打印链路', selected: true },
          { title: '保存到我的文档', text: '需要登录并确认保存期限' },
          { title: '手机扫码下载', text: '使用短时下载凭证' },
        ],
      },
    ],
    rail: [
      {
        kind: 'task',
        pairs: [
          ['当前权益', 'PDF 导出 1 次'],
          ['生成费用', '待服务端报价'],
          ['打印费用', '进入打印参数后核价'],
          ['保存期限', '由本人选择'],
        ],
      },
      {
        kind: 'warning',
        title: '同一成果避免重复扣费',
        text: '需以后端成果版本和订单记录判断，不能依赖前端按钮状态。',
      },
    ],
  })

  P.add({
    id: 29,
    title: '简历模板',
    section: 'resume',
    template: 'collection',
    kicker: '简历版式',
    summary: '模板按内容承载能力分类，不做装饰性缩略图墙。',
    goal: '选择与内容长度和岗位场景匹配的版式。',
    action: '预览并应用模板',
    mapping: '保留独屏；2x3 彩色模板卡改为版式对比表。',
    task: '选择行政专员简历模板',
    taskStatus: '当前内容预计 2 页',
    primary: { label: '应用标准单栏模板', to: '26' },
    secondary: { label: '返回内容预览', to: '26' },
    sections: [
      {
        title: '推荐版式',
        caption: '根据页数和内容结构排序',
        kind: 'rows',
        items: [
          { title: '标准单栏', text: '适合行政、财务和通用岗位 · 预计 2 页', state: '推荐' },
          { title: '紧凑双栏', text: '信息密度高 · 需检查小字号可读性' },
          { title: '应届生重点版', text: '教育和校园经历优先 · 预计 1 页' },
        ],
      },
      {
        title: '版式检查',
        caption: '应用后仍需本人预览',
        kind: 'metrics',
        items: [
          ['预计页数', '2 页'],
          ['最小字号', '10.5 pt'],
          ['打印幅面', 'A4'],
        ],
      },
    ],
    rail: [
      { kind: 'truth', title: '模板不改变事实', text: '版式只调整顺序与排版，不自动新增内容。' },
    ],
  })

  P.add({
    id: 30,
    title: '求职材料库',
    section: 'resume',
    template: 'directory',
    kicker: '本人求职材料',
    summary: '按真实用途选择求职信、介绍稿、清单和封面。',
    goal: '生成可保存和打印的辅助材料。',
    action: '选择材料类型',
    mapping: '保留独屏；与简历模板彻底分开。',
    task: '生成求职辅助材料',
    taskStatus: '等待选择材料类型',
    primary: { label: '生成求职信', to: '30', confirm: true },
    secondary: { label: '查看我的文档', to: '17' },
    sections: [
      {
        title: '材料类型',
        caption: '生成结果进入本人文档',
        kind: 'rows',
        items: [
          { title: '岗位定向求职信', text: '基于本人简历和目标岗位，由本人确认后生成' },
          { title: '一分钟自我介绍', text: '用于面试练习，不发送给企业' },
          { title: '招聘会材料清单', text: '按场次公开信息生成', to: '48' },
          { title: '作品集封面', text: '只生成版式和本人确认的文字' },
        ],
      },
      {
        title: '已有材料',
        caption: '2 个可继续使用',
        kind: 'rows',
        items: [
          { title: '行政专员求职信.pdf', text: '8 月 1 日生成 · 90 天后到期', to: '64' },
          { title: '招聘会准备清单.pdf', text: '7 月 30 日生成 · 已打印', to: '64' },
        ],
      },
    ],
    rail: [
      {
        kind: 'assistant',
        title: 'AI 从真实输入开始',
        text: '未选择本人简历或岗位时，先补齐输入，不生成空泛材料。',
      },
    ],
  })
})(window.KioskPrototype)
