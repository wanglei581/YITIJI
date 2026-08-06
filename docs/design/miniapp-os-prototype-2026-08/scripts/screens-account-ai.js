;(function () {
  const p = window.Proto
  const add = (screen) => p.screens.push(screen)

  add({
    id: 'U01',
    phase: 'M0',
    group: '我的',
    name: '我的',
    meta: '我的 Tab · 账户与服务状态',
    goal: '聚合本人订单、权益和服务入口',
    cta: '查看订单',
    states: '未登录、资料不全、权益临期',
    render: () =>
      p.screen({
        className: 'service-account',
        title: '我的',
        right: '设置',
        tab: 'mine',
        body: `<div class="scroll"><header class="account-head"><div class="account-person"><span>李</span><div><h1>李明</h1><p>微信已绑定 · 手机尾号 2456</p></div></div><button>编辑资料</button></header><section class="account-ledger"><header><div><small>需要处理</small><h2>2 项未完成服务</h2></div><span>按截止时间排列</span></header><button class="ledger-obligation ledger-obligation-urgent" data-go="U02"><span class="ledger-mark">01</span><span><small>18 小时内 · 已付款</small><strong>明日招聘会材料包</strong><em>到机码 824 619 · 查看履约状态</em></span>${p.icon('arrow')}</button><button class="ledger-obligation" data-go="U04"><span class="ledger-mark">02</span><span><small>系统处理中 · 72%</small><strong>产品运营面试报告</strong><em>完成后通知你，不需要留在页面等待</em></span>${p.icon('arrow')}</button></section><section class="account-facts"><header><b>账户事实</b><span>不需要每天打开</span></header><div><button data-go="U03"><small>可用权益</small><strong>6 项</strong><em>AI 与打印额度</em>${p.icon('arrow')}</button><button data-go="U04"><small>未读消息</small><strong>3 条</strong><em>任务与服务通知</em>${p.icon('arrow')}</button></div></section><section class="account-utilities"><div><h2>账户与支持</h2><span>低频设置集中在这里</span></div><button data-go="U05">${p.icon('message')}<span><b>反馈与售后</b><small>关联订单或任务提交问题</small></span>${p.icon('arrow')}</button><button data-go="U06">${p.icon('settings')}<span><b>账号设置</b><small>手机号、个人资料与退出</small></span>${p.icon('arrow')}</button><button data-go="U07">${p.icon('lock')}<span><b>隐私与数据</b><small>授权、导出、删除与注销</small></span>${p.icon('arrow')}</button></section></div>`,
      }),
  })

  add({
    id: 'U02',
    phase: 'M0',
    group: '我的',
    name: '我的订单',
    meta: '统一订单与退款列表',
    goal: '支持用户找回履约状态并降低客服成本',
    cta: '查看订单详情',
    states: '空、待支付、待到机、失败、退款',
    render: () =>
      p.screen({
        className: 'order-list-screen',
        title: '我的订单',
        right: '筛选',
        body: `<div class="scroll no-tab"><section class="section order-filter"><div class="segmented" style="--cols:4"><button class="active">全部</button><button>待支付</button><button>待到机</button><button>售后</button></div></section>${p.section('当前办理', `<article class="active-order-journey" data-go="M15" role="button" tabindex="0"><header><span>今天 · 已付款</span>${p.badge('待到机', 'coral')}</header><h2>明日招聘会材料包</h2><div class="order-route"><span><small>手机</small><b>订单已建立</b></span><i></i><span><small>服务点</small><b>城东就业服务站</b></span></div><footer><span>到机码还有 18 小时有效</span><em>824 619　›</em></footer></article>`)}${p.section('历史凭证', `<div class="order-history"><button data-go="M15"><time>08.02</time><span><b>产品运营简历 · 3份</b><small>大学生就业服务中心 · ¥4.80</small></span><em>已完成</em>${p.icon('arrow')}</button><button data-go="M15"><time>08.02</time><span><b>政策材料打印</b><small>支付后终端能力异常</small></span><em>已退款</em>${p.icon('arrow')}</button></div>`)}${p.notice('“再打一次”只会用原材料和参数预填一笔新订单，仍需重新报价、支付和到机确认。', 'warning')}</div>`,
      }),
  })

  add({
    id: 'U03',
    phase: 'M0',
    group: '我的',
    name: '我的权益',
    meta: '数字权益与终端权益',
    goal: '解释价值、减少争议并促进合理复购',
    cta: '查看使用规则',
    states: '空、冻结、即将过期、已用尽',
    render: () =>
      p.screen({
        className: 'benefit-ledger',
        title: '我的权益',
        right: '记录',
        body: `<div class="scroll no-tab"><div class="benefit-balance"><div class="benefit-index">05 / 服务凭证</div><small>当前可用权益</small><b><span>6</span> 项</b><p class="page-subtitle">数字服务与终端服务分开核算，失败按规则返还。</p></div>${p.section('即将到期', `<div class="panel benefit-expiry">${p.row({ iconName: 'print', tone: 'coral', title: 'A4 黑白打印', sub: '终端权益 · 仅限指定可用服务点', value: '2 页' })}</div>`)}${p.notice('2 页打印权益将在 7 天后到期。权益不代表排队优先，也不影响终端现场安全核验。', 'warning')}${p.section('数字权益', `<div class="panel benefit-digital">${p.row({ iconName: 'spark', title: 'AI 简历服务', sub: '诊断、优化或生成可用', value: '3 次' })}${p.row({ iconName: 'message', tone: 'blue', title: '模拟面试', sub: '语音练习与报告', value: '1 次' })}</div>`)}</div>`,
      }),
  })

  add({
    id: 'U04',
    phase: 'M0',
    group: '我的',
    name: '消息中心',
    meta: '真实任务与订单通知',
    goal: '让用户及时完成任务并返回服务闭环',
    cta: '查看关联任务',
    states: '空、未读、对象已删除、授权提示',
    render: () =>
      p.screen({
        className: 'message-center-screen',
        title: '消息中心',
        right: '全部已读',
        body: `<div class="scroll no-tab"><section class="section"><div class="message-item urgent unread" data-go="M14"><span class="icon-tile coral">${p.icon('print')}</span><div><div class="row-title">到机码还有 18 小时有效</div><p>订单 PT20260805-8246 尚未释放，请按计划前往城东就业服务站。</p><div class="message-time">今天 15:02</div></div></div><div class="message-item result unread" data-go="M04"><span class="icon-tile">${p.icon('spark')}</span><div><div class="row-title">简历诊断报告已生成</div><p>发现 2 个高优先问题，结果已保存到你的材料库。</p><div class="message-time">今天 14:21</div></div></div><div class="message-item settled"><span class="icon-tile blue">${p.icon('message')}</span><div><div class="row-title">退款已原路返回</div><p>¥3.20 已提交微信支付退款，到账时间以支付渠道为准。</p><div class="message-time">8月2日 17:10</div></div></div></section>${p.notice('订阅消息需要你在具体场景中单次授权；关闭授权不会影响站内消息。')}</div>`,
      }),
  })

  add({
    id: 'U05',
    phase: 'M0',
    group: '我的',
    name: '反馈与售后',
    meta: '关联订单或任务的真实问题入口',
    goal: '将异常变成可追踪工单而非孤立留言',
    cta: '提交反馈',
    states: '无关联订单、上传凭证、提交失败、已受理',
    render: () =>
      p.screen({
        className: 'support-form-screen',
        title: '反馈与售后',
        body: `<div class="scroll no-tab"><section class="section"><label class="field"><span>关联服务 *</span><div class="fake-input"><span>订单 PT20260805-8246</span>${p.icon('arrow')}</div></label><label class="field"><span>问题类型 *</span><div class="fake-input"><span>打印质量 / 缺页</span>${p.icon('arrow')}</div></label><label class="field"><span>问题说明 *</span><div class="fake-input" style="min-height:88px;align-items:flex-start;padding-top:12px;color:var(--muted)">请说明实际情况，不要填写无关敏感信息</div></label><label class="field"><span>现场照片（可选）</span><div class="fake-input"><span>上传最多 3 张</span>${p.icon('upload')}</div></label></section>${p.section('处理说明', p.notice('已进入打印中的任务不会自动重打。工作人员将核对订单记录、打印进度和设备状态后处理。', 'warning'))}</div>`,
        action: p.actionbar('提交反馈', 'U02'),
      }),
  })

  add({
    id: 'U06',
    phase: 'M0',
    group: '我的',
    name: '账号设置',
    meta: '基础资料、手机号与登录状态',
    goal: '维护可信身份和个性化所需的最小资料',
    cta: '保存设置',
    states: '手机未绑定、保存失败、退出确认',
    render: () =>
      p.screen({
        className: 'account-settings-screen',
        title: '账号设置',
        body: `<div class="scroll no-tab">${p.section('账号信息', `<div class="panel identity-ledger">${p.row({ iconName: 'user', title: '头像与昵称', sub: '李明', value: '修改' })}${p.row({ iconName: 'message', tone: 'blue', title: '绑定手机号', sub: '138 **** 2456', value: '已绑定' })}</div>`)}${p.section('求职偏好', `<div class="preference-ledger"><label class="field"><span>目标方向</span><div class="fake-input"><span>产品运营</span>${p.icon('arrow')}</div></label><label class="field"><span>意向城市</span><div class="fake-input"><span>江城</span>${p.icon('arrow')}</div></label>${p.notice('偏好只用于你的信息浏览和 AI 建议，不提供给企业或招聘方。')}</div>`)}${p.section('登录状态', `<div class="panel exit-ledger">${p.row({ iconName: 'lock', title: '退出当前账号', sub: '退出不会删除本人云端资产', value: '退出' })}</div>`)}</div>`,
        action: p.actionbar('保存设置', 'U01'),
      }),
  })

  add({
    id: 'U07',
    phase: 'M0',
    group: '我的',
    name: '隐私与数据',
    meta: '授权撤回、数据导出与注销',
    goal: '满足微信审核和个人信息权利要求',
    cta: '管理授权',
    states: '撤回授权、导出处理中、注销冷静期、失败',
    render: () =>
      p.screen({
        className: 'privacy-data-screen',
        title: '隐私与数据',
        body: `<div class="scroll no-tab">${p.section('授权边界', `<div class="panel authorization-ledger"><div class="setting-row"><div><b>AI 使用我的简历</b><small>已授权 · 可随时撤回</small></div><span class="toggle on"></span></div><div class="setting-row"><div><b>订阅服务通知</b><small>按具体场景单次申请</small></div><span class="toggle"></span></div></div>`)}${p.section('文件生命周期', `<div class="panel retention-ledger">${p.row({ iconName: 'file', title: '材料保存期限', sub: '当前选择：长期保存至本人删除', value: '管理' })}${p.row({ iconName: 'print', tone: 'coral', title: '打印临时文件', sub: '按订单进度与保存期限自动清理', value: '说明' })}</div>`)}${p.section('个人信息权利', `<div class="panel rights-ledger">${p.row({ iconName: 'upload', tone: 'blue', title: '导出我的数据', sub: '提交后进入真实处理流程', value: '申请' })}${p.row({ iconName: 'lock', tone: 'gold', title: '注销账号', sub: '检查未完成订单和退款后处理', value: '申请' })}</div>`)}${p.notice('数据导出和账号注销将在完成身份与状态核验后执行，请以最终处理结果为准。', 'warning')}</div>`,
      }),
  })

  add({
    id: 'A01',
    phase: 'M1',
    group: 'AI 操作系统',
    name: '小青助手',
    meta: '全局 Sheet / 复杂任务全屏态',
    goal: '用自然语言编排受控白名单能力',
    cta: '发送消息',
    states: '未登录、模型不可用、敏感意图拦截、转人工',
    render: () =>
      `<section class="mini-screen assistant-notes">${p.statusbar()}<div class="assistant-sheet"><div class="assistant-top"><div class="assistant-index">02 / 行前准备</div><h2>小青的行前批注</h2><p>整理材料和安排下一步，不会替你投递。</p></div><div class="assistant-journal"><div class="assistant-query"><small>你的问题</small><p>明天去招聘会，我还缺什么？</p></div><div class="assistant-note"><span>01</span><div><b>先补齐现场材料包</b><p>你已收藏“夏季高校毕业生招聘会”，也有一份 2 页简历。当前还未确认打印份数和服务点。</p></div></div><div class="intent-actions"><button data-go="M09"><span>01</span>组装招聘会材料包${p.icon('arrow')}</button><button data-go="D05"><span>02</span>核对招聘会详情${p.icon('arrow')}</button><button data-go="M04"><span>03</span>检查最近简历${p.icon('arrow')}</button></div><div class="assistant-footnote">这些动作来自系统允许范围。支付、打印和外部跳转仍需你再次确认。</div></div><div class="composer"><div class="fake-input">继续问小青</div><button aria-label="发送">${p.icon('arrow')}</button></div></div></section>`,
  })

  add({
    id: 'A02',
    phase: 'M3',
    group: 'AI 操作系统',
    name: '模拟面试设置',
    meta: '私密语音练习前置配置',
    goal: '建立明确岗位与权限范围的练习任务',
    cta: '开始练习',
    states: '麦克风拒绝、权益不足、岗位缺失',
    render: () =>
      p.screen({
        className: 'interview-setup-screen',
        title: '模拟面试',
        body: `<div class="scroll no-tab">${p.pageBand('私密练习 · AI 生成', '准备一场产品运营面试', '预计 15 分钟，共 8 题；结束后生成本人练习报告。', 'tint-green')}<section class="section"><label class="field"><span>目标岗位 *</span><div class="fake-input"><span>产品运营专员</span>${p.icon('arrow')}</div></label><label class="field"><span>难度</span><div class="segmented" style="--cols:3"><button>基础</button><button class="active">标准</button><button>进阶</button></div></label><label class="field"><span>回答方式</span><div class="segmented"><button class="active">语音</button><button>文字</button></div></label></section>${p.section('开始前', `<div class="panel">${p.row({ iconName: 'message', title: '麦克风仅在答题时使用', sub: '拒绝授权可切换文字模式' })}${p.row({ iconName: 'lock', tone: 'blue', title: '报告仅保存到本人账户', sub: '不向任何招聘方发送' })}</div>`)}${p.notice('AI 提问与反馈仅供练习，不代表真实招聘方标准或面试结果。')}</div>`,
        action: p.actionbar('开始练习', 'A03'),
      }),
  })

  add({
    id: 'A03',
    phase: 'M3',
    group: 'AI 操作系统',
    name: '模拟面试',
    meta: '分轮语音答题与中断恢复',
    goal: '提供可完成、可恢复的私密练习体验',
    cta: '提交本题',
    states: 'ASR失败、网络中断、退出恢复、完成',
    render: () =>
      p.screen({
        className: 'interview-session-screen',
        title: '模拟面试',
        right: '退出',
        body: `<div class="scroll no-tab"><section class="section"><div class="progress"><i style="width:38%"></i></div><p class="page-subtitle">第 3 / 8 题 · 项目复盘</p></section><section class="section"><div class="question-box">请讲一个你通过数据发现问题并推动改进的真实经历。</div><div class="mic">${p.icon('message')}</div><p style="text-align:center;color:var(--muted);font-size:10px">按住回答 · 已获得本次麦克风授权</p></section>${p.section('回答提示', `<div class="badge-row">${p.badge('背景')}${p.badge('你的行动')}${p.badge('真实结果')}</div>`)}${p.notice('网络中断时保存当前题号和已确认文字，不保存未完成的原始录音。')}</div>`,
        action: p.actionbar('提交本题', 'A04', '改用文字', ''),
      }),
  })

  add({
    id: 'A04',
    phase: 'M3',
    group: 'AI 操作系统',
    name: '面试报告',
    meta: '证据化反馈进入本人材料',
    goal: '沉淀练习价值并驱动下一次改进',
    cta: '保存到材料',
    states: '生成中、失败、仅供参考、删除',
    render: () =>
      p.screen({
        className: 'interview-report',
        title: '面试报告',
        body: `<div class="scroll no-tab">${p.pageBand('AI 练习报告 · 仅供参考', '表达结构清楚，证据可更具体', '已完成 8 题，建议重点练习数据复盘和追问。', 'tint-green')}<section class="section"><div class="metric-row"><div class="metric"><b>78</b><span>结构</span></div><div class="metric"><b>72</b><span>证据</span></div><div class="metric"><b>85</b><span>清晰度</span></div></div></section>${p.section('优先改进', `<div class="panel"><div class="issue"><div class="issue-head"><b>结果缺少对比基线</b>${p.badge('第3题', 'coral')}</div><p>你提到活跃度提升，但没有说明提升前后的口径。</p></div><div class="issue"><div class="issue-head"><b>可以更早说明个人贡献</b>${p.badge('第6题', 'gold')}</div><p>建议在回答前 20 秒明确你负责的范围。</p></div><div class="issue"><div class="issue-head"><b>追问时先确认问题范围</b>${p.badge('第8题')}</div><p>遇到开放问题时，可先复述目标，再选择一项真实经历作答。</p></div></div>`)}${p.notice('报告是练习反馈，不构成录用概率、人才评价或招聘方意见。')}</div>`,
        action: p.actionbar('保存到材料', 'M01', '再练一次', 'A02'),
      }),
  })

  add({
    id: 'A05',
    phase: 'M3',
    group: 'AI 操作系统',
    name: '职业规划',
    meta: '个人目标与阶段行动清单',
    goal: '建立长期任务连续性和复访理由',
    cta: '生成行动规划',
    states: '信息不足、生成中、失败、版本历史',
    render: () =>
      p.screen({
        className: 'career-plan-screen',
        title: '职业规划',
        body: `<div class="scroll no-tab">${p.pageBand('AI 规划建议 · 仅供参考', '把目标拆成可执行的 90 天', '基于你的真实经历和目标方向生成阶段行动，不保证就业结果。', 'tint-green')}<section class="section"><label class="field"><span>目标方向 *</span><div class="fake-input">产品运营</div></label><label class="field"><span>当前阶段 *</span><div class="fake-input">应届毕业，正在准备秋招</div></label><label class="field"><span>每周可投入时间</span><div class="fake-input">8 小时</div></label></section>${p.section('将生成', `<div class="panel">${p.row({ iconName: 'check', title: '30 / 60 / 90 天行动', sub: '每阶段 2–4 个可执行任务' })}${p.row({ iconName: 'file', tone: 'blue', title: '能力差距与验证方式', sub: '基于当前材料，不虚构经历' })}</div>`)}${p.notice('规划不构成职业、教育或投资建议。重要决定请结合真实情况判断。')}</div>`,
        action: p.actionbar('生成行动规划', 'M01'),
      }),
  })

  add({
    id: 'A06',
    phase: 'M4',
    group: 'AI 操作系统',
    name: 'Offer 对比',
    meta: '低风险个人决策微应用',
    goal: '提供可收费的结构化个人决策工具',
    cta: '生成对比',
    states: '隐私同意、字段缺失、权益不足、仅供参考',
    render: () =>
      p.screen({
        className: 'offer-compare-screen',
        title: 'Offer 对比',
        body: `<div class="scroll no-tab">${p.pageBand('AI 微应用 · 仅供参考', '把两个选择放在同一张表里', '信息只用于你的个人比较，不会发送给公司或第三方。', 'tint-green')}<section class="section"><div class="offer-table"><div class="offer-row head"><span>项目</span><span>Offer A</span><span>Offer B</span></div><div class="offer-row"><b>税前月薪</b><span>8,000</span><span>9,000</span></div><div class="offer-row"><b>工作城市</b><span>江城</span><span>海城</span></div><div class="offer-row"><b>通勤</b><span>35 分钟</span><span>70 分钟</span></div><div class="offer-row"><b>培养机制</b><span>导师制</span><span>未确认</span></div></div></section>${p.section('你的优先级', `<div class="chip-row"><button class="chip active">成长机会</button><button class="chip">收入</button><button class="chip">生活平衡</button></div>`)}${p.notice('系统不判断公司好坏，也不保证职业结果。劳动合同和法律问题应咨询专业人士。', 'warning')}</div>`,
        action: p.actionbar('生成对比', 'M01'),
      }),
  })
})()
