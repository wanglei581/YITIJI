;(function () {
  const p = window.Proto
  const add = (screen) => p.screens.push(screen)

  add({
    id: 'D01',
    phase: 'M0',
    group: '发现',
    name: '发现',
    meta: '发现 Tab · 官方信息与线下服务入口',
    goal: '连接真实信息来源并触发行前准备',
    cta: '查看招聘会',
    states: '内容为空、来源不可用、更新延迟',
    render: () =>
      p.screen({
        className: 'intelligence-desk',
        title: '发现',
        tab: 'discover',
        body: `<div class="scroll"><header class="brief-head"><div><small>江城 · 8月5日更新</small><h1>本地就业情报</h1><p>先看值得行动的来源，再决定是否打开外部平台。</p></div><button aria-label="搜索来源">${p.icon('search')}</button></header><article class="lead-brief" data-go="D05" role="button" tabindex="0"><time><span>8月</span><b>08</b></time><div><small>官方发布 · 线下活动</small><h2>2026 夏季高校毕业生招聘会</h2><p>09:00–15:00 · 市人力资源市场</p><footer><span>86 家参会单位</span><b>查看并准备材料 ${p.icon('arrow')}</b></footer></div></article><section class="intelligence-stream"><header><b>现在值得看</b><span>按新鲜度与行动成本排序</span></header><button class="stream-item stream-job" data-go="D02"><span class="stream-index">1</span><span><small>岗位信息 · 今日更新</small><strong>128 条来源岗位</strong><em>产品运营 · 应届生 · 本地</em></span><b>浏览 ${p.icon('arrow')}</b></button><button class="stream-item stream-fair" data-go="D04"><span class="stream-index">2</span><span><small>招聘会 · 12 场活动</small><strong>本周线下日程</strong><em>官方与高校来源</em></span><b>查看 ${p.icon('arrow')}</b></button><button class="stream-item stream-policy" data-go="D06"><span class="stream-index">3</span><span><small>就业政策 · 今日更新</small><strong>公共就业服务</strong><em>按地区查看官方原文</em></span><b>阅读 ${p.icon('arrow')}</b></button><button class="stream-item stream-agency" data-go="D08"><span class="stream-index">4</span><span><small>服务机构 · 线下入口</small><strong>找到可办理的地方</strong><em>地址、时间与营业状态</em></span><b>导航 ${p.icon('arrow')}</b></button></section><button class="ai-margin-note" data-go="D10">${p.icon('spark')}<span><b>决策工具</b><small>Offer 对比与求职问答 · 结果仅供参考</small></span>${p.icon('arrow')}</button></div>`,
      }),
  })

  add({
    id: 'D02',
    phase: 'M0',
    group: '发现',
    name: '岗位列表',
    meta: '第三方来源岗位浏览',
    goal: '帮助用户发现信息并转向合规来源平台',
    cta: '查看岗位详情',
    states: '加载、空、筛选无结果、来源过期',
    render: () =>
      p.screen({
        className: 'job-list-screen',
        title: '岗位信息',
        right: '筛选',
        body: `<div class="scroll no-tab"><section class="section"><div class="searchbar">${p.icon('search')}职位、公司或关键词</div><div class="chip-row" style="margin-top:9px"><button class="chip active">推荐浏览</button><button class="chip">应届生</button><button class="chip">产品运营</button><button class="chip">本地</button></div></section>${p.section('共 128 条来源信息', `<div class="content-card" data-go="D03"><h3>产品运营专员</h3><p>江城数科有限公司 · 本科 · 经验不限</p><div class="content-meta"><span class="salary">6–9K</span><span>市人才网 · 今天更新　›</span></div></div><div class="content-card"><h3>新媒体运营</h3><p>青禾文化 · 本科 · 应届生</p><div class="content-meta"><span class="salary">5–8K</span><span>高校就业网 · 1天前　›</span></div></div><div class="content-card"><h3>用户增长助理</h3><p>云帆科技 · 本科 · 经验不限</p><div class="content-meta"><span class="salary">7–10K</span><span>官方公共就业平台 · 2天前　›</span></div></div>`)}${p.notice('列表排序是信息浏览参考，不代表平台推荐给企业，也不代表录用概率。')}</div>`,
      }),
  })

  add({
    id: 'D03',
    phase: 'M0',
    group: '发现',
    name: '岗位详情',
    meta: '来源证据、风险提示与外部跳转',
    goal: '帮助用户理解岗位后安全前往来源平台',
    cta: '去来源平台投递',
    states: '来源信息、更新时间、外链风险确认',
    render: () =>
      p.screen({
        className: 'job-detail-screen',
        title: '岗位详情',
        body: `<div class="scroll no-tab"><article class="section article"><div class="badge-row">${p.badge('官方来源', 'green')}${p.badge('应届生')}</div><h1 style="margin-top:12px">产品运营专员</h1><p class="lead">江城数科有限公司<br><span class="salary">6–9K</span> · 本科 · 经验不限</p>${p.source('市人才公共服务网', '2026-08-05 10:20', 'JOB-2026-1842')}<h3>岗位职责</h3><p>协助产品内容运营、用户活动执行与数据复盘；维护基础运营报表。</p><h3>任职要求</h3><p>具备清晰的沟通与文字表达能力，能熟练使用办公软件。具体要求以来源平台原文为准。</p></article>${p.section('AI 匹配参考', `<div class="panel green">${p.row({ iconName: 'spark', title: '基于我的简历查看差距', sub: '仅供个人准备，不向企业发送简历', go: 'M04' })}</div>`)}${p.notice('即将离开小程序。平台只记录“打开来源入口”，不记录投递结果、面试或 Offer。', 'warning')}</div>`,
        action: p.actionbar('去来源平台投递', '', '加入收藏', ''),
      }),
  })

  add({
    id: 'D04',
    phase: 'M0',
    group: '发现',
    name: '招聘会列表',
    meta: '官方招聘会信息浏览',
    goal: '驱动行前准备和线下材料服务',
    cta: '查看招聘会详情',
    states: '加载、空、已结束、来源更新',
    render: () =>
      p.screen({
        className: 'fair-list-screen',
        title: '招聘会',
        right: '筛选',
        body: `<div class="scroll no-tab"><section class="section fair-filter"><div class="chip-row"><button class="chip active">近期</button><button class="chip">高校</button><button class="chip">综合</button><button class="chip">线上来源</button></div><p>按活动日期排列 · 信息以来源方最新通知为准</p></section>${p.section('本周日程', `<div class="fair-schedule"><article class="fair-entry current" data-go="D05" role="button" tabindex="0"><time><small>8月</small><b>08</b></time><div><div class="badge-row">${p.badge('官方发布', 'green')}${p.badge('线下', 'coral')}</div><h3>2026 夏季高校毕业生招聘会</h3><p><b>09:00–15:00</b> · 市人力资源市场</p><footer><span>86 家参会单位</span><em>查看并准备材料</em></footer></div></article><article class="fair-entry"><time><small>8月</small><b>12</b></time><div><div class="badge-row">${p.badge('高校发布', 'blue')}</div><h3>江城大学秋招预热双选会</h3><p><b>13:30–17:00</b> · 大学生活动中心</p><footer><span>官方预约入口</span><em>查看详情</em></footer></div></article></div>`)}${p.notice('参会单位、展位和活动安排可能由来源方调整，请以官方最新通知为准。')}</div>`,
      }),
  })

  add({
    id: 'D05',
    phase: 'M0',
    group: '发现',
    name: '招聘会详情',
    meta: '场馆、来源入口与行前助手',
    goal: '把信息浏览转化为真实材料准备和到机服务',
    cta: '准备参会材料',
    states: '官方来源、已结束、导览缺失、外部预约',
    render: () =>
      p.screen({
        className: 'fair-detail-screen',
        title: '招聘会详情',
        right: '收藏',
        body: `<div class="scroll no-tab"><div class="page-band tint-coral"><div class="badge-row">${p.badge('官方发布', 'green')}${p.badge('线下活动', 'coral')}</div><h1 class="page-title" style="margin-top:10px">2026 夏季高校毕业生招聘会</h1><p class="page-subtitle">8月8日 09:00–15:00<br>市人力资源市场 A、B 展厅</p></div>${p.section('行前准备', `<div class="panel green">${p.row({ iconName: 'spark', title: '小青建议准备 3 项材料', sub: '简历 5 份、作品集摘要、身份证明复印件', go: 'M09' })}<button class="primary-button button-block" data-go="M09">准备参会材料</button></div>`)}${p.section('活动信息', `<div class="panel">${p.row({ iconName: 'map', title: '场馆与展位导览', sub: '查看官方导览图与公共服务区' })}${p.row({ iconName: 'compass', tone: 'coral', title: '去来源平台预约', sub: '将在确认后打开官方入口' })}</div>`)}${p.source('市人力资源和社会保障局', '2026-08-04 18:00', 'FAIR-2026-041')}</div>`,
        action: p.actionbar('准备参会材料', 'M09', '去来源平台预约', ''),
      }),
  })

  add({
    id: 'D06',
    phase: 'M0',
    group: '发现',
    name: '政策列表',
    meta: '公共就业政策与办事材料',
    goal: '提供权威信息入口并产生真实材料需求',
    cta: '查看政策',
    states: '加载、空、地域筛选、已失效',
    render: () =>
      p.screen({
        className: 'policy-list-screen',
        title: '就业政策',
        right: '地区',
        body: `<div class="scroll no-tab"><section class="section"><div class="searchbar">${p.icon('search')}搜索补贴、档案、创业政策</div><div class="chip-row" style="margin-top:9px"><button class="chip active">最新</button><button class="chip">高校毕业生</button><button class="chip">就业补贴</button></div></section>${p.section('最新政策', `<div class="content-card" data-go="D07"><div class="badge-row">${p.badge('市级', 'green')}${p.badge('申报中', 'coral')}</div><h3 style="margin-top:8px">高校毕业生一次性求职创业补贴申领指南</h3><p>说明申请对象、材料清单和官方办理入口。</p><div class="content-meta"><span>市人社局 · 8月3日</span><span>查看　›</span></div></div><div class="content-card"><div class="badge-row">${p.badge('档案服务', 'blue')}</div><h3 style="margin-top:8px">流动人员人事档案接收与转递须知</h3><p>以官方办理流程和材料要求为准。</p><div class="content-meta"><span>公共就业服务中心</span><span>查看　›</span></div></div>`)}${p.notice('政策内容可能调整，办理资格和结果由官方部门认定。')}</div>`,
      }),
  })

  add({
    id: 'D07',
    phase: 'M0',
    group: '发现',
    name: '政策详情',
    meta: '官方原文摘要与材料操作',
    goal: '帮助用户理解政策并进入官方办理路径',
    cta: '去官方来源查看',
    states: '来源原文、更新时间、附件不可用',
    render: () =>
      p.screen({
        className: 'policy-detail-screen',
        title: '政策详情',
        right: '收藏',
        body: `<div class="scroll no-tab"><article class="section article"><div class="badge-row">${p.badge('市级政策', 'green')}${p.badge('2026年度')}</div><h1 style="margin-top:12px">高校毕业生一次性求职创业补贴申领指南</h1><p class="lead">符合条件的毕业生可按官方要求准备材料并申请。资格和结果以主管部门审核为准。</p>${p.source('市人力资源和社会保障局', '2026-08-03 09:00', 'POLICY-2026-022')}<h3>申请对象</h3><p>本市高校符合官方规定条件的毕业生。具体身份范围请查看来源原文。</p><h3>材料清单</h3><p>申请表、身份证明及官方要求的相关佐证材料。</p></article>${p.section('材料操作', `<div class="panel">${p.row({ iconName: 'file', title: '保存官方附件到材料库', sub: '仅保存来源方公开文件' })}${p.row({ iconName: 'print', tone: 'coral', title: '加入打印材料包', sub: '进入统一打印流程', go: 'M09' })}</div>`)}</div>`,
        action: p.actionbar('去官方来源查看', '', '加入材料包', 'M09'),
      }),
  })

  add({
    id: 'D08',
    phase: 'M0',
    group: '发现',
    name: '服务机构',
    meta: '线下公共就业服务入口',
    goal: '让用户找到真实、可到达的服务机构',
    cta: '查看机构',
    states: '加载、空、营业状态未知',
    render: () =>
      p.screen({
        className: 'agency-list-screen',
        title: '线下服务机构',
        right: '筛选',
        body: `<div class="scroll no-tab"><section class="section"><div class="searchbar">${p.icon('search')}机构名称或服务区域</div></section>${p.section('公共就业服务', `<div class="service-item" data-go="D09"><div class="service-title"><b>市公共就业服务中心</b>${p.badge('开放中', 'green')}</div><p>职业指导、档案咨询、政策服务</p><div class="service-facts"><span>官方机构</span><span>08:30–17:30</span></div></div><div class="service-item"><div class="service-title"><b>青山区就业服务驿站</b>${p.badge('营业状态未知', 'gold')}</div><p>就业咨询、简历服务、活动信息</p><div class="service-facts"><span>来源资料待更新</span></div></div>`)}${p.notice('未建立真实坐标的数据不计算距离，也不会按“附近”排序。')}</div>`,
      }),
  })

  add({
    id: 'D09',
    phase: 'M0',
    group: '发现',
    name: '机构详情',
    meta: '真实地址、服务与来源说明',
    goal: '将线上查询转化为可信线下服务',
    cta: '导航前往',
    states: '地址/电话缺失、闭馆、来源说明',
    render: () =>
      p.screen({
        className: 'agency-detail-screen',
        title: '机构详情',
        right: '收藏',
        body: `<div class="scroll no-tab"><div class="map-block"><span class="map-pin">${p.icon('map')}</span></div>${p.section('市公共就业服务中心', `<div class="badge-row">${p.badge('官方机构', 'green')}${p.badge('开放中')}</div><p class="page-subtitle">长江大道 108 号公共服务大楼<br>周一至周五 08:30–17:30</p>`)}${p.section('公开服务', `<div class="panel">${p.row({ iconName: 'user', title: '职业指导', sub: '现场服务以机构安排为准' })}${p.row({ iconName: 'file', tone: 'blue', title: '档案与政策咨询', sub: '办理结果由官方机构认定' })}</div>`)}${p.source('市公共就业服务中心', '2026-08-02 16:30', 'AGENCY-001')}</div>`,
        action: p.actionbar('导航前往', '', '拨打公开电话', ''),
      }),
  })

  add({
    id: 'D10',
    phase: 'M4',
    group: '发现',
    name: 'AI 微应用',
    meta: '受控、可熔断的低风险 AI 服务',
    goal: '以低风险工具增加数字服务收入和留存',
    cta: '开始使用',
    states: '未发布、熔断、权益不足、仅供参考',
    render: () =>
      p.screen({
        className: 'ai-catalog-screen',
        title: 'AI 服务',
        body: `<div class="scroll no-tab">${p.pageBand('受控 AI 微应用', '为个人决策提供参考', '每项能力都经过审核、定价和成本控制，不向企业提供候选人服务。', 'tint-green')}<section class="section"><div class="panel">${p.row({ iconName: 'spark', title: 'Offer 对比', sub: '比较薪资、发展和工作条件', value: '1次', go: 'A06' })}${p.row({ iconName: 'message', tone: 'coral', title: '薪资沟通练习', sub: '生成沟通话术并模拟问答', value: '1次' })}${p.row({ iconName: 'file', tone: 'blue', title: 'HR 常识问答', sub: '劳动流程常识，仅供参考', value: '免费' })}</div></section>${p.section('权益说明', `<div class="price-line"><span>当前 AI 服务权益</span><strong style="font-size:18px"><small>剩余</small> 3 次</strong></div>`)}${p.notice('未完成安全与合规审核的服务不会在此展示。')}</div>`,
        action: p.actionbar('开始使用', 'A06'),
      }),
  })
})()
