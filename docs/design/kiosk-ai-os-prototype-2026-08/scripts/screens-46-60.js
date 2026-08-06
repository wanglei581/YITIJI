;(function (P) {
  P.add({
    id: 46,
    title: '场馆导览',
    section: 'fairs',
    template: 'detail',
    kicker: '招聘会现场',
    summary: '使用真实平面图时显示分区与服务点；缺图时诚实回退。',
    goal: '帮助用户找到展位和公共服务点。',
    action: '查看目标展位位置',
    mapping: '保留独屏；CSS 假地图改为“真实图片 / 无图回退”两种状态。',
    task: '前往 A12 展位',
    taskStatus: '当前场次已提供平面图',
    primary: { label: '查看 A12 展位说明', to: '45' },
    secondary: { label: '返回招聘会详情', to: '11' },
    sections: [
      {
        title: '场馆平面图',
        caption: '主办方提供 · 更新于 8 月 5 日',
        kind: 'document',
        heading: '一层展区示意',
        body: '入口区  ->  综合服务台  ->  A 区（数字经济）\n\nB 区（现代服务）  ->  C 区（先进制造）  ->  出口\n\n目标展位：A12，靠近 A 区咨询台。',
      },
      {
        title: '现场服务点',
        caption: '仅展示公开位置',
        kind: 'rows',
        items: [
          { title: '综合服务台', text: '入口右侧 · 咨询与失物登记' },
          { title: '打印服务点', text: 'A 区入口附近 · 以现场标识为准' },
          { title: '无障碍通道', text: '西侧入口 · 以主办方指引为准' },
        ],
      },
    ],
    rail: [
      {
        kind: 'warning',
        title: '没有实时定位',
        text: '本机不跟踪用户位置，路线仅依据主办方平面图。',
      },
    ],
  })

  P.add({
    id: 47,
    title: '招聘会活动资料',
    section: 'fairs',
    template: 'collection',
    kicker: '主办方公开资料',
    summary: '逐份选择、检查页数和费用后进入统一打印。',
    goal: '安全打印真正需要的招聘会资料。',
    action: '选择资料并打印',
    mapping: '保留独屏；“批量打印”改为逐份勾选并统一核价。',
    task: '选择招聘会资料',
    taskStatus: '已选 2 份 · 共 6 页',
    primary: { label: '预览已选资料', to: '64' },
    secondary: { label: '返回招聘会详情', to: '11' },
    sections: [
      {
        title: '可用资料',
        caption: '来源文件状态已检查',
        kind: 'rows',
        items: [
          { title: '参展企业与展位索引.pdf', text: '4 页 · 主办方提供 · 今日更新', state: '已选' },
          { title: '场馆服务指南.pdf', text: '2 页 · 主办方提供 · 今日更新', state: '已选' },
          { title: '往届活动回顾.pdf', text: '8 页 · 非本次参会必需', state: '未选' },
        ],
      },
      {
        title: '选择摘要',
        caption: '打印前仍需检查与核价',
        kind: 'metrics',
        items: [
          ['文件', '2 份'],
          ['页数', '6 页'],
          ['价格', '待核价'],
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        title: '来源文件不自动更新打印单',
        text: '如果文件版本变化，打印前必须提示重新预览与报价。',
      },
    ],
  })

  P.add({
    id: 48,
    title: 'AI 参会准备单',
    section: 'fairs',
    template: 'document',
    kicker: '招聘会行前准备',
    summary: '基于本人简历与本场公开信息，生成可核实的行动清单。',
    goal: '把目标企业、材料和现场路线整理在一页。',
    action: '确认清单并保存',
    mapping: '保留独屏；清单不记录签到或投递结果。',
    task: '夏季高校毕业生招聘会准备单',
    taskStatus: 'AI 初稿已生成 · 等待本人确认',
    primary: { label: '确认并保存准备单', to: '17', confirm: true },
    secondary: { label: '打印准备单', to: '64' },
    sections: [
      {
        title: '准备单预览',
        caption: '本人简历 v2 + 主办方公开信息',
        kind: 'document',
        heading: '8 月 9 日参会准备单',
        body: '重点展位：A12 某科技服务公司、B08 某连锁服务企业。\n\n携带材料：行政专员简历 5 份、作品材料 1 份、身份证件。\n\n现场顺序：入口服务台 -> A 区 -> B 区 -> 打印服务点。',
      },
      {
        title: '需要本人确认',
        caption: '不自动推断行程',
        kind: 'rows',
        items: [
          { title: '简历打印 5 份', text: '数量由本人确认', state: '待确认' },
          { title: '重点企业 A12 / B08', text: '来自本人选择', state: '已确认' },
          { title: '身份证件', text: '请核对主办方官方要求', state: '待核对' },
        ],
      },
    ],
    rail: [
      {
        kind: 'assistant',
        title: 'AI 只整理信息',
        text: '不替你预约、签到、投递，也不向企业发送这份准备单。',
      },
    ],
  })

  P.add({
    id: 49,
    title: '招聘会现场数据',
    section: 'fairs',
    template: 'collection',
    kicker: '主办方公开聚合数据',
    summary: '只展示可追溯、达到最小样本阈值的公开统计。',
    goal: '帮助用户理解场次规模，不展示个人行为。',
    action: '查看公开统计来源',
    mapping: '保留独屏；删除“签到进度”和假准实时数据。',
    task: '查看招聘会公开数据',
    taskStatus: '数据定时更新 · 最后同步 16:20',
    primary: { label: '返回招聘会详情', to: '11' },
    sections: [
      {
        title: '场次规模',
        caption: '主办方同步',
        kind: 'metrics',
        items: [
          ['参展企业', '120 家'],
          ['公开岗位', '380 个'],
          ['计划招聘', '1,120 人'],
        ],
      },
      {
        title: '行业分布',
        caption: '聚合数据',
        kind: 'rows',
        items: [
          { title: '现代服务业', text: '38 家企业 · 主办方分类' },
          { title: '先进制造业', text: '31 家企业 · 主办方分类' },
          { title: '数字经济', text: '27 家企业 · 主办方分类' },
        ],
      },
      {
        title: '本机服务统计',
        caption: '只统计本机公开动作',
        kind: 'rows',
        items: [
          { title: '招聘会详情浏览', text: '聚合计数，不展示个人身份' },
          { title: '活动资料打印', text: '只统计完成订单数量' },
          { title: '打开来源入口', text: '不等于预约、签到或投递' },
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        title: '不展示个人明细',
        text: '合作机构和企业不能看到谁浏览、谁打印或谁打开过岗位。',
      },
    ],
  })

  P.add({
    id: 50,
    title: '校园招聘专区',
    section: 'fairs',
    template: 'directory',
    kicker: '学校授权专区',
    summary: '招聘会、企业、地图与服务共用一个场次上下文。',
    goal: '在校园场景下快速进入已开通服务。',
    action: '选择校园招聘服务',
    mapping: '保留沉浸页；五 Tab 不复制五份页面内容。',
    task: '某大学校园招聘专区',
    taskStatus: '学校已开通 4 项校园招聘服务',
    primary: { label: '查看校园双选会', to: '10' },
    secondary: { label: '返回首页', to: '01' },
    sections: [
      {
        title: '本校招聘服务',
        caption: '由学校与终端后台开关控制',
        kind: 'rows',
        items: [
          { title: '校园双选会', text: '场次、参展企业与场馆导览', to: '10' },
          { title: '校招岗位', text: '学校或第三方来源岗位', to: '08' },
          { title: 'AI 参会准备', text: '基于本人简历生成准备单', to: '48' },
          { title: '打印求职材料', text: '进入统一打印流程', to: '02' },
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        title: '校招仍是来源入口',
        text: '学校或来源平台负责投递与招聘结果，本机不建立候选人闭环。',
      },
    ],
  })

  P.add({
    id: 51,
    title: '智慧校园',
    section: 'fairs',
    template: 'directory',
    kicker: '学校授权服务',
    summary: '只展示本校当前开通且已有真实去向的服务。',
    goal: '进入学校授权的公共服务。',
    action: '选择已开通服务',
    mapping: '保留独屏；“6 项服务可用”改为后端能力清单。',
    task: '智慧校园服务',
    taskStatus: '正在读取学校授权配置',
    primary: { label: '查看迎新服务', to: '69' },
    secondary: { label: '返回首页', to: '01' },
    sections: [
      {
        title: '已开通服务',
        caption: '示例状态需由后台真实返回',
        kind: 'rows',
        items: [
          { title: '迎新服务', text: '报到流程、窗口与材料指引', to: '69', state: '已开通' },
          { title: '校园卡办理指引', text: '查看学校官方办理路径', to: '52', state: '已开通' },
          { title: '校园招聘专区', text: '招聘会与校招岗位来源入口', to: '50', state: '已开通' },
          { title: '校园大数据', text: '本期不开放个人数据视图', to: '70', state: '未开放' },
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        title: '默认关闭',
        text: '终端未绑定学校、配置加载失败或学校未授权时，入口不应显示。',
      },
    ],
  })

  P.add({
    id: 52,
    title: '校园服务办理指引',
    section: 'fairs',
    template: 'workbench',
    kicker: '学校官方流程',
    summary: '用步骤、材料和窗口说明替代假在线办理。',
    goal: '帮助学生准备线下办理材料。',
    action: '查看官方窗口与材料',
    mapping: '保留代表屏；不宣称本机可完成未接入的校园业务。',
    task: '校园卡办理指引',
    taskStatus: '官方指引已加载 · 本机不受理申请',
    primary: { label: '打印材料清单', to: '64' },
    secondary: { label: '返回智慧校园', to: '51' },
    sections: [
      {
        title: '办理材料',
        caption: '以学校最新通知为准',
        kind: 'rows',
        items: [
          { title: '本人有效证件', text: '现场核验，不上传到本平台' },
          { title: '录取或在校证明', text: '按学校通知准备' },
          { title: '证件照', text: '规格以学校通知为准，本机证件照排版未开放' },
        ],
      },
      {
        title: '办理步骤',
        caption: '线下窗口办理',
        kind: 'timeline',
        items: [
          { title: '准备材料', text: '先核对学校通知', status: 'active' },
          { title: '前往校园服务中心', text: '一号窗口办理', status: 'pending' },
          { title: '由学校系统处理', text: '结果以学校系统为准', status: 'pending' },
        ],
      },
    ],
    rail: [
      {
        kind: 'task',
        pairs: [
          ['来源', '学校迎新办公室'],
          ['窗口', '校园服务中心一号窗'],
          ['开放时间', '工作日 09:00-16:30'],
          ['本机能力', '信息与打印'],
        ],
      },
    ],
  })

  P.add({
    id: 53,
    title: '找企业',
    section: 'jobs',
    template: 'collection',
    kicker: '来源企业导览',
    summary: '企业作为岗位来源和公开展示对象，不是招聘企业后台。',
    goal: '按行业、地区和来源找到企业。',
    action: '查看企业详情',
    mapping: '保留独屏；企业统计和筛选归入固定表头。',
    task: '查找现代服务业企业',
    taskStatus: '已筛选杭州市 · 28 家企业',
    primary: { label: '查看已选企业', to: '54' },
    secondary: { label: '查看岗位列表', to: '08' },
    sections: [
      {
        title: '筛选企业',
        caption: '所有企业必须有来源',
        kind: 'form',
        fields: [
          { label: '关键词', value: '科技服务' },
          { label: '行业', value: '现代服务业' },
          { label: '地区', value: '杭州市' },
          { label: '来源', value: '全部已审核来源' },
        ],
      },
      {
        title: '企业结果',
        caption: '显示 3 / 28',
        kind: 'rows',
        items: [
          { title: '某科技服务公司', text: '信息技术 · 5 个来源岗位 · 市就业服务平台', to: '54' },
          { title: '某供应链公司', text: '物流服务 · 4 个来源岗位 · 招聘会主办方', to: '54' },
          { title: '某连锁服务企业', text: '生活服务 · 8 个来源岗位 · 线下招聘机构', to: '54' },
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        title: '企业展示不是招聘平台',
        text: '不提供企业收简历、筛选候选人、邀约或 Offer 管理。',
      },
    ],
  })

  P.add({
    id: 54,
    title: '企业详情',
    section: 'jobs',
    template: 'detail',
    kicker: '来源企业公开信息',
    summary: '公开介绍、来源岗位和来源证据清晰分区。',
    goal: '理解企业并查看来源岗位。',
    action: '查看企业来源岗位',
    mapping: '保留独屏；宣传媒体只有真实资源存在时展示。',
    task: '查看某科技服务公司',
    taskStatus: '企业公开信息已加载',
    primary: { label: '查看来源岗位', to: '08' },
    secondary: { label: '返回企业列表', to: '53' },
    sections: [
      {
        title: '某科技服务公司',
        caption: '信息技术 · 杭州市',
        kind: 'metrics',
        items: [
          ['来源岗位', '5 个'],
          ['企业类型', '民营企业'],
          ['信息来源', '市就业服务平台'],
        ],
      },
      {
        title: '企业公开介绍',
        caption: '来源内容',
        kind: 'text',
        paragraphs: [
          '为企业提供数字化运营、客户服务和项目支持。',
          '本平台不核实来源平台以外的雇佣承诺，请在投递前自行确认。',
        ],
      },
      {
        title: '在招岗位',
        caption: '去来源平台查看与投递',
        kind: 'rows',
        items: [
          { title: '行政专员', text: '5-7K · 1-3 年', to: '09' },
          { title: '项目助理', text: '6-8K · 经验不限', to: '09' },
          { title: '客户支持', text: '5-8K · 全职', to: '09' },
        ],
      },
    ],
    rail: [
      {
        kind: 'task',
        pairs: [
          ['来源机构', '市就业服务平台'],
          ['同步时间', '2026-08-05 17:40'],
          ['外部 ID', 'COMP-5521'],
          ['媒体', '无可用宣传片'],
        ],
      },
    ],
  })

  P.add({
    id: 55,
    title: '岗位匹配参考',
    section: 'jobs',
    template: 'document',
    kicker: '本人求职参考',
    summary: '只给较高、中等、偏低三档和可解释证据。',
    goal: '帮助本人准备材料，不预测录用。',
    action: '根据差距继续优化简历',
    mapping: '保留独屏；移除百分比与“成功率”暗示。',
    task: '行政专员岗位匹配参考',
    taskStatus: '本人授权有效 · 结果仅本人可见',
    primary: { label: '针对差距优化简历', to: '07' },
    secondary: { label: '返回岗位详情', to: '09' },
    sections: [
      {
        title: '匹配结论',
        caption: '三档参考，不代表企业判断',
        kind: 'metrics',
        items: [
          ['综合参考', '中等'],
          ['可解释匹配点', '3 项'],
          ['主要差距', '2 项'],
        ],
      },
      {
        title: '匹配证据',
        caption: '来自本人简历与岗位原文',
        kind: 'rows',
        items: [
          { title: '办公软件与材料整理', text: '本人简历和岗位要求均有明确描述', state: '匹配' },
          { title: '跨部门协调', text: '简历有经历，但结果证据不足', state: '部分匹配' },
          { title: '档案管理经验', text: '岗位要求提及，简历未体现', state: '差距' },
        ],
      },
      {
        title: '准备动作',
        caption: '由本人决定是否采用',
        kind: 'rows',
        items: [
          { title: '补充真实档案管理经历', text: '没有相关经历时不要编造' },
          { title: '量化跨部门协调结果', text: '回到简历优化逐条确认', to: '07' },
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        title: '无录用概率',
        text: '结果不发送给企业，不参与筛选、邀约或 Offer 决策。',
      },
    ],
  })

  P.add({
    id: 56,
    title: '职业规划',
    section: 'jobs',
    template: 'document',
    kicker: '本人行动计划',
    summary: '用阶段目标和可执行任务替代宏大职业叙事。',
    goal: '形成可回看、可修改的行动计划。',
    action: '确认并保存行动计划',
    mapping: '保留独屏；建议必须注明依据与不确定性。',
    task: '行政方向 90 天行动计划',
    taskStatus: 'AI 初稿已生成 · 等待本人确认',
    primary: { label: '确认并保存计划', to: '17', confirm: true },
    secondary: { label: '调整目标', to: '56' },
    sections: [
      {
        title: '当前依据',
        caption: '本人简历与自我评估',
        kind: 'metrics',
        items: [
          ['目标方向', '行政支持'],
          ['经验阶段', '1-3 年'],
          ['计划周期', '90 天'],
        ],
      },
      {
        title: '阶段计划',
        caption: '每一步都可调整',
        kind: 'timeline',
        items: [
          {
            title: '第 1-2 周 · 材料收口',
            text: '完成一份目标岗位简历和 3 个项目证据',
            status: 'active',
          },
          { title: '第 3-6 周 · 面试练习', text: '每周完成 2 次短时练习并复盘', status: 'pending' },
          {
            title: '第 7-12 周 · 信息与行动',
            text: '持续查看来源岗位和招聘会，记录本人行动',
            status: 'pending',
          },
        ],
      },
      {
        title: '不确定性',
        caption: '计划不是结果承诺',
        kind: 'rows',
        items: [
          { title: '岗位市场会变化', text: '应依据真实来源信息定期调整' },
          { title: '本人时间与选择会变化', text: '计划支持版本更新，不追求一次定稿' },
        ],
      },
    ],
    rail: [
      {
        kind: 'assistant',
        title: 'AI 只编排行动',
        text: '不代投岗位、不承诺录用，也不把计划发送给企业。',
      },
    ],
  })

  P.add({
    id: 57,
    title: '待机宣传屏',
    section: 'foundation',
    template: 'state',
    kicker: '待机状态',
    summary: '播放后台审核素材，触摸后回到安全首页。',
    goal: '在无人使用时展示真实公共服务信息。',
    action: '触摸唤醒',
    mapping: '保留独屏；素材加载失败时显示品牌与触摸提示，不显示假活动。',
    task: '待机',
    taskStatus: '没有活跃用户会话',
    state: {
      code: '18:08',
      title: '求职材料，现场准备',
      body: '触摸屏幕开始使用。岗位与招聘会信息来自第三方或官方来源。',
    },
    primary: { label: '触摸开始使用', to: '01' },
    secondary: { label: '无障碍帮助', to: '58' },
  })

  P.add({
    id: 58,
    title: '帮助中心',
    section: 'foundation',
    template: 'collection',
    kicker: '现场帮助',
    summary: '按当前任务给恢复步骤，不写未上线能力。',
    goal: '快速解决常见阻塞并找到工作人员。',
    action: '选择问题类型',
    mapping: '保留独屏；FAQ 与现场协助分区。',
    task: '帮助中心',
    taskStatus: '当前没有关联异常任务',
    primary: { label: '联系现场工作人员', to: '58', confirm: true },
    secondary: { label: '返回首页', to: '01' },
    sections: [
      {
        title: '常见问题',
        caption: '只描述已上线流程',
        kind: 'rows',
        items: [
          { title: '手机上传后没有看到文件', text: '检查一次性上传会话是否过期' },
          { title: '支付后状态没有变化', text: '不要重复扫码，先刷新订单状态', to: '32' },
          { title: '打印缺页或卡纸', text: '保留纸张和任务号，提交反馈', to: '22' },
          { title: '扫描文件没有到达', text: '返回设备面板指引', to: '35' },
          { title: '如何退出并清理数据', text: '进入账号设置安全退出', to: '23' },
        ],
      },
      {
        title: '现场信息',
        caption: '由部署点配置',
        kind: 'metrics',
        items: [
          ['设备编号', '01 号机'],
          ['服务台', '大厅入口右侧'],
          ['服务时间', '以现场公示为准'],
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        title: '帮助不绕过安全门控',
        text: '工作人员也不能绕过支付、本人授权或设备状态强制完成任务。',
      },
    ],
  })

  P.add({
    id: 59,
    title: '法律与隐私',
    section: 'foundation',
    template: 'document',
    kicker: '正式文档',
    summary: '版本、发布日期、适用范围与正文清晰呈现。',
    goal: '让用户理解公共终端的数据处理方式。',
    action: '阅读并返回原任务',
    mapping: '保留独屏；不复制占位法律文本。',
    task: '查看隐私政策',
    taskStatus: '版本 2026-07 · 只读',
    primary: { label: '阅读完成，返回设置', to: '23' },
    secondary: { label: '调整字号', to: '59' },
    sections: [
      {
        title: '隐私政策',
        caption: '版本 2026-07 · 发布于 2026-07-15',
        kind: 'document',
        heading: '公共终端个人信息处理说明',
        body: '本终端仅在用户主动选择和授权后处理文件、简历与服务记录。\n\n公共终端会话到期或退出后清理本机敏感状态；长期数据按本人账号与保存期限管理。\n\n岗位和招聘会外部办理结果不回流本平台。',
      },
      {
        title: '相关文档',
        caption: '正式版本',
        kind: 'rows',
        items: [
          { title: '用户服务协议', text: '版本 2026-07' },
          { title: '文件保存期限说明', text: '按文件用途和本人选择执行' },
          { title: 'AI 服务说明', text: '用途、授权、结果与限制' },
        ],
      },
    ],
    rail: [
      {
        kind: 'truth',
        title: '同意必须版本化',
        text: '登录同意、AI 用途授权和文件长期保存是不同的确认。',
      },
    ],
  })

  P.add({
    id: 60,
    title: '会话超时',
    section: 'foundation',
    template: 'state',
    kicker: '共享终端安全',
    summary: '倒计时结束后退出账号并清理本机敏感状态。',
    goal: '防止上一位用户的数据被下一位看到。',
    action: '继续使用或立即退出',
    mapping: '保留系统态；显示可恢复对象，不把密码等敏感输入保存。',
    task: '会话安全提醒',
    taskStatus: '21 秒后自动退出',
    state: {
      code: '21',
      title: '还在使用吗？',
      body: '已安全暂存简历优化草稿和任务 ID。继续使用会延长会话；退出将清理本机登录态、上传选择和临时输入。',
    },
    primary: { label: '继续使用', to: '07' },
    secondary: { label: '立即退出并清理', to: '01', confirm: true },
  })
})(window.KioskPrototype)
