;(function () {
  const p = window.Proto
  const add = (screen) => p.screens.push(screen)

  add({
    id: 'G00',
    phase: 'M0',
    group: '全局入口',
    name: '微信登录',
    meta: '统一账号、协议与短信降级',
    goal: '建立可信的跨端本人账号',
    cta: '微信一键登录',
    states: '游客、授权拒绝、短信降级、协议未同意',
    render: () =>
      `<section class="mini-screen login-screen">${p.statusbar()}<div class="login-art"><div class="login-mark">青</div><h1>把求职准备，<br>变成清晰的下一步</h1><p>简历、材料、AI 建议和到机打印都归到你的账户。</p></div><div class="login-actions"><button class="primary-button button-block wechat-button" data-go="T01">微信一键登录</button><div class="login-links"><span>手机号登录</span><span>先看看公开信息</span></div>${p.notice('登录后才能保存简历、购买服务和查看本人订单。公开岗位与招聘会可游客浏览。')}<div class="agreement">登录即表示你已阅读并同意《用户协议》和《隐私政策》。AI 结果仅供参考，平台不提供简历投递或招聘撮合。</div></div></section>`,
  })

  add({
    id: 'T01',
    phase: 'M0',
    group: '今天',
    name: '今天',
    meta: '今天 Tab · 规则优先的下一步工作台',
    goal: '驱动用户完成最重要的真实任务并持续复访',
    cta: '继续优化简历',
    states: '无资产、AI处理中、待支付、待到机、异常',
    render: () =>
      `<section class="mini-screen today-command-center">${p.statusbar()}<div class="command-hero"><div class="topline"><span>青序 · 今天</span><button class="command-notice" data-go="U04"><span>${p.icon('bell')}</span><b>3</b></button></div><div class="command-label"><span>今天只做一件事</span><b>1 项待处理</b></div><h1>先把项目经历里的<br>结果证据补完整</h1><p>诊断发现两处描述缺少结果数据。修改后保存为新版本，不覆盖原简历。</p><button class="command-primary" data-go="M05">继续优化简历 ${p.icon('arrow')}</button><button class="ai-command" data-go="A01"><span class="ai-kicker">小青建议</span><span>明天招聘会，先准备 2 份简历和 1 份材料包</span>${p.icon('arrow')}</button></div><div class="scroll"><section class="obligation-stack"><header class="stack-head"><b>接下来</b><span>按需要你亲自完成的顺序</span></header><section class="obligation-primary" data-go="M14" role="button" tabindex="0"><div class="deadline-number"><b>18</b><span>小时内</span></div><div><small>已付款 · 等待到机</small><h2>明日招聘会材料包</h2><p>城东就业服务站 · 到机码 824 619</p></div>${p.icon('arrow')}</section><section class="obligation-secondary" data-go="A04" role="button" tabindex="0"><div><small>系统正在处理</small><h3>产品运营面试报告</h3><p>无需等待，完成后会通知你</p></div><b>72%</b><i><span style="width:72%"></span></i></section></section><section class="action-index"><header><b>还没有材料？</b><span>从这里开始，不打断当前任务</span></header><button class="action-row action-row-primary" data-go="M02"><span>1</span><strong>导入简历</strong><small>建立第一份材料资产</small>${p.icon('arrow')}</button><button class="action-row" data-go="M09"><span>2</span><strong>组材料包</strong><small>为到机打印准备文件</small>${p.icon('arrow')}</button><button class="action-row" data-go="D04"><span>3</span><strong>看招聘会</strong><small>只查看官方来源信息</small>${p.icon('arrow')}</button></section></div>${p.tabs('today')}${p.fab()}</section>`,
  })

  add({
    id: 'T02',
    phase: 'M2',
    group: '今天',
    name: '服务点详情',
    meta: '真实终端地址、状态与能力',
    goal: '降低用户到机履约的不确定性',
    cta: '导航前往',
    states: '在线、离线、地址缺失、能力不满足',
    render: () =>
      p.screen({
        className: 'service-point-detail',
        title: '服务点详情',
        body: `<div class="scroll no-tab">${p.section('城东就业服务站', `<div class="location-ledger"><span class="map-pin">${p.icon('map')}</span><div><small>到机地点</small><strong>青山区建设路 26 号</strong><span>一层服务大厅 · 08:30–17:30</span></div></div><div class="badge-row">${p.badge('终端在线', 'green')}${p.badge('支持 A4')}${p.badge('彩色能力已验收', 'blue')}</div>`)}${p.section('现场能力', `<div class="panel">${p.row({ iconName: 'print', title: '打印', sub: 'A4 · 单双面 · 黑白 / 已验收彩色' })}${p.row({ iconName: 'file', tone: 'blue', title: '扫描', sub: '由一体机现场操作，不支持手机远程控制' })}</div>`)}${p.section('履约说明', p.notice('只有你到一体机核验到机码并确认后，系统才会创建打印任务。', '', 'lock'))}</div>`,
        action: p.actionbar('导航前往', 'M14', '返回到机码', 'M14'),
      }),
  })

  add({
    id: 'M01',
    phase: 'M0',
    group: '材料',
    name: '材料库',
    meta: '材料 Tab · 简历、文档、报告与材料包',
    goal: '沉淀本人可复用资产并承接打印转化',
    cta: '导入材料',
    states: '空、加载失败、过期、处理中、可用',
    render: () =>
      p.screen({
        className: 'materials-workdesk',
        title: '材料',
        right: '选择',
        tab: 'materials',
        body: `<div class="scroll"><header class="workdesk-head"><div><small>求职资产 · 4 项</small><h1>材料工作桌</h1><p>先看主简历，再决定下一份要生成、诊断还是打印的材料。</p></div><button data-go="M02" aria-label="导入材料">${p.icon('plus')}<span>导入</span></button></header><section class="asset-filter"><button class="active">全部</button><button>简历</button><button>报告</button><button>材料包</button></section><section class="asset-focus"><button class="featured-document" data-go="M08"><div class="document-sheet"><span>简历 · 版本 3</span><b>李明</b><i></i><i></i><i></i><i></i></div><div><small>主简历 · 今天更新</small><h2>产品运营简历</h2><p>PDF · 2 页 · v3</p><strong>打开资产 ${p.icon('arrow')}</strong></div></button><aside><span>当前主资产</span><b>可直接使用</b><p>已通过解析，可继续做诊断、优化或加入材料包。</p></aside></section><section class="asset-register"><header><b>最近成果</b><span>按下一步动作排列</span></header><button class="register-row" data-go="M04"><span class="register-index">1</span><span><small>AI 报告</small><strong>简历诊断</strong></span><b>82 分</b>${p.icon('arrow')}</button><button class="register-row register-pack" data-go="M09"><span class="register-index">2</span><span><small>打印组合</small><strong>明日招聘会材料包</strong></span><b>待下单</b>${p.icon('arrow')}</button></section><section class="processing-dock" data-go="M03" role="button" tabindex="0"><span>${p.icon('file')}</span><div><small>新文件处理中 · 68%</small><b>微信文件 resume.pdf</b><i><em style="width:68%"></em></i></div>${p.icon('arrow')}</section></div>`,
      }),
  })

  add({
    id: 'M02',
    phase: 'M1',
    group: '简历与 AI',
    name: '导入简历',
    meta: '微信文件、手机文件、相册与拍照',
    goal: '以安全、低摩擦方式获取真实简历输入',
    cta: '选择微信文件',
    states: '授权拒绝、格式错误、超限、上传失败',
    render: () =>
      p.screen({
        className: 'resume-import-screen',
        title: '导入简历',
        body: `<div class="scroll no-tab">${p.pageBand('AI 简历', '从现有材料开始', '支持 PDF、DOCX 和清晰图片，系统会先解析并让你核对。', 'tint-green')}<section class="section"><div class="import-source-lead"><span>01</span><div><b>微信文件</b><small>支持 PDF、DOCX 和清晰图片</small></div></div><button class="secondary-button button-block">从手机文件选择</button></section>${p.section('也可以', `<div class="panel">${p.row({ iconName: 'file', title: '从我的材料选择', sub: '使用已保存的简历或文档', go: 'M03' })}${p.row({ iconName: 'upload', tone: 'blue', title: '拍照或相册导入', sub: '图片会使用真实 OCR 识别', go: 'M03' })}</div>`)}${p.section('隐私与限制', p.notice('文件只用于你选择的服务，使用短时访问链接并按保存策略清理。单个文件不超过 20 MB。'))}</div>`,
        action: p.actionbar('选择微信文件', 'M03'),
      }),
  })

  add({
    id: 'M03',
    phase: 'M1',
    group: '简历与 AI',
    name: '解析确认',
    meta: 'OCR 结果核对与低置信度提示',
    goal: '阻止错误解析直接污染 AI 结果',
    cta: '确认并开始诊断',
    states: '解析中、低置信度、需校对、失败',
    render: () =>
      p.screen({
        className: 'resume-verify-screen',
        title: '确认简历内容',
        body: `<div class="scroll no-tab"><section class="section">${p.steps(['上传', '解析', '确认', '诊断'], 2)}</section>${p.section('解析结果', `<div class="panel"><div class="row"><span class="icon-tile">${p.icon('file')}</span><div class="row-main"><div class="row-title">产品运营简历.pdf</div><div class="row-sub">2 页 · 已识别 1,248 字</div></div>${p.badge('需核对', 'gold')}</div></div>`)}${p.section('发现 2 处需要核对', `<div class="panel gold"><div class="issue"><div class="issue-head"><b>项目时间可能识别错误</b>${p.badge('第1页', 'gold')}</div><p>“2025.03–2025.08”识别置信度 72%，请对照原文件。</p></div><div class="issue"><div class="issue-head"><b>手机号已做隐私遮罩</b>${p.badge('已保护', 'green')}</div><p>显示为 138****2456，AI 不需要完整号码。</p></div></div>`)}${p.section('求职方向（可选）', `<div class="fake-input"><span>产品运营</span>${p.icon('arrow')}</div>`)}</div>`,
        action: p.actionbar('确认并开始诊断', 'M04', '返回修改', 'M02'),
      }),
  })

  add({
    id: 'M04',
    phase: 'M1',
    group: '简历与 AI',
    name: '简历诊断',
    meta: '证据化问题与下一步建议',
    goal: '交付可理解、可行动的 AI 服务价值',
    cta: '优化重点问题',
    states: '生成中、完成、失败、权益不足',
    render: () =>
      p.screen({
        className: 'diagnosis-report',
        title: '简历诊断',
        body: `<div class="scroll no-tab">${p.pageBand('AI 生成 · 仅供参考', '诊断完成', '建议先处理影响阅读效率的 3 个问题。', 'tint-green')}<section class="section"><div class="panel"><div style="display:flex;align-items:center;gap:18px"><div class="score-ring">82<small>综合参考</small></div><div class="row-main"><div class="row-title">基础信息完整</div><div class="row-sub">项目成果表达仍可加强</div><div class="badge-row" style="margin-top:8px">${p.badge('结构 90', 'green')}${p.badge('表达 74', 'gold')}</div></div></div></div></section>${p.section('优先处理', `<div class="panel"><div class="issue"><div class="issue-head"><b>项目结果缺少量化证据</b>${p.badge('高优先', 'coral')}</div><p>证据：第 1 页“负责社群运营与活动执行”。建议补充规模和结果。</p></div><div class="issue"><div class="issue-head"><b>技能与目标岗位关联弱</b>${p.badge('建议')}</div><p>可将“Excel”具体化为数据透视和周报分析场景。</p></div><div class="issue"><div class="issue-head"><b>个人简介信息重复</b>${p.badge('第1页')}</div><p>与项目经历重复的两句可删减，为关键成果留出阅读空间。</p></div></div>`)}${p.notice('诊断不代表招聘方评价或录用结果。请核对所有建议，不要补写不存在的经历。')}</div>`,
        action: p.actionbar('优化重点问题', 'M05', '加入材料包', 'M09'),
      }),
  })

  add({
    id: 'M05',
    phase: 'M1',
    group: '简历与 AI',
    name: '优化对比',
    meta: '逐条采纳并保留原版本',
    goal: '让用户掌控 AI 修改并形成新资产',
    cta: '保存为新版本',
    states: '未采纳、部分采纳、冲突、保存失败',
    render: () =>
      p.screen({
        className: 'diff-review-screen',
        title: '优化对比',
        right: '2/3',
        body: `<div class="scroll no-tab"><section class="section"><div class="progress"><i style="width:66%"></i></div><p class="page-subtitle">逐条核对，AI 不会自动覆盖你的原简历。</p></section>${p.section('项目经历 · 社群增长', `<div class="diff-card"><div class="diff-block"><div class="diff-label">原文</div><p>负责社群运营和活动执行，提升用户活跃度。</p></div><div class="diff-block after"><div class="diff-label">AI 建议稿 · 请核对数字</div><p>运营 6 个求职社群，策划 4 场线上活动；活动数据由你补充确认后再保存。</p></div></div>`)}<section class="section"><div class="button-row"><button class="secondary-button">保留原文</button><button class="primary-button">采纳并编辑</button></div></section>${p.section('为什么这样改', p.notice('把职责、动作和真实结果分开表达，阅读者更容易理解你的贡献。'))}</div>`,
        action: p.actionbar('保存为新版本', 'M08', '上一条', 'M04'),
      }),
  })

  add({
    id: 'M06',
    phase: 'M1',
    group: '简历与 AI',
    name: '简历生成',
    meta: '结构化真实信息生成初稿',
    goal: '帮助无简历用户建立第一份可核实初稿',
    cta: '生成简历初稿',
    states: '必填缺失、生成中、内容待核实、失败',
    render: () =>
      p.screen({
        className: 'resume-create-screen',
        title: '生成简历',
        body: `<div class="scroll no-tab">${p.pageBand('AI 辅助创作', '先把事实写清楚', '小青只会整理你提供的信息，不会替你编造经历。', 'tint-green')}<section class="section"><div class="form-grid"><label class="field"><span>求职方向 *</span><div class="fake-input">产品运营</div></label><label class="field"><span>工作年限 *</span><div class="fake-input">应届生</div></label></div><label class="field"><span>教育经历 *</span><div class="fake-input">江城大学 · 市场营销</div></label><label class="field"><span>项目或实习</span><div class="fake-input">填写真实经历</div></label></section>${p.section('生成范围', `<div class="panel">${p.row({ iconName: 'check', title: '整理结构与表达', sub: '不改变事实，不代填敏感信息' })}${p.row({ iconName: 'lock', tone: 'blue', title: '结果进入本人材料库', sub: '生成后必须逐项核对才能保存' })}</div>`)}${p.notice('AI 生成内容仅供参考。虚构教育、工作或项目经历可能产生严重后果。', 'warning')}</div>`,
        action: p.actionbar('生成简历初稿', 'M07'),
      }),
  })

  add({
    id: 'M07',
    phase: 'M1',
    group: '简历与 AI',
    name: '模板预览',
    meta: '打印友好模板与分页检查',
    goal: '将内容转为可打印、可保存的成果',
    cta: '应用此模板',
    states: '加载失败、分页警告、应用成功',
    render: () =>
      p.screen({
        className: 'template-select-screen',
        title: '选择模板',
        right: '预览',
        body: `<div class="scroll no-tab"><section class="section"><div class="segmented" style="--cols:3"><button class="active">通用</button><button>应届生</button><button>技术</button></div></section><section class="section"><div class="template-grid"><div class="template active"><div class="template-paper">${'<i></i>'.repeat(7)}</div><b>清晰单栏</b><small>2 页 · 打印友好</small></div><div class="template"><div class="template-paper">${'<i></i>'.repeat(8)}</div><b>紧凑双栏</b><small>2 页 · 信息较多</small></div></div></section>${p.section('版式检查', p.notice('当前内容可排为 2 页。项目经历第 2 段跨页，建议预览后确认。', 'warning'))}</div>`,
        action: p.actionbar('应用此模板', 'M08', '返回编辑', 'M06'),
      }),
  })

  add({
    id: 'M08',
    phase: 'M1',
    group: '材料',
    name: '材料详情',
    meta: '本人资产详情与统一后续动作',
    goal: '承接继续优化、打印、下载和删除',
    cta: '加入材料包',
    states: '文件过期、处理中、预览失败、删除确认',
    render: () =>
      p.screen({
        className: 'asset-detail-screen',
        title: '材料详情',
        right: '更多',
        body: `<div class="scroll no-tab"><div class="preview-stack">${p.paper()}<span class="page-count">1 / 2</span></div>${p.section('产品运营简历 · v3', `<div class="badge-row">${p.badge('本人材料', 'green')}${p.badge('AI 辅助优化', 'blue')}${p.badge('PDF · 2页')}</div><p class="page-subtitle">今天 14:20 保存 · 原版本仍保留</p>`)}${p.section('可继续处理', `<div class="panel">${p.row({ iconName: 'spark', title: '继续 AI 优化', sub: '基于当前版本生成新版本', go: 'M05' })}${p.row({ iconName: 'file', tone: 'blue', title: '更换模板', sub: '内容不变，只调整版式', go: 'M07' })}</div>`)}${p.notice('下载链接短时有效。删除后将影响尚未支付的材料包，已支付订单按履约规则处理。')}</div>`,
        action: p.actionbar('加入材料包', 'M09', '下载文件', ''),
      }),
  })

  add({
    id: 'M09',
    phase: 'M2',
    group: '打印履约',
    name: '材料包编辑',
    meta: '跨端核心交接对象',
    goal: '组合多份材料，提高一次履约客单与成功率',
    cta: '配置打印',
    states: '空包、锁定中、条目失效、报价变化',
    render: () =>
      p.screen({
        className: 'pack-editor-screen',
        title: '材料包',
        right: '添加',
        body: `<div class="scroll no-tab"><section class="section"><div class="fake-input"><span>明日招聘会材料包</span><span>可编辑</span></div></section>${p.section('包内材料', `<div class="panel"><div class="pack-item"><span class="drag">⋮⋮</span><div><div class="row-title">产品运营简历 · v3</div><div class="row-sub">PDF · 2页 · 每份 3 份</div></div><div class="quantity"><button>−</button>3<button>+</button></div></div><div class="pack-item"><span class="drag">⋮⋮</span><div><div class="row-title">作品集摘要</div><div class="row-sub">PDF · 4页 · 每份 1 份</div></div><div class="quantity"><button>−</button>1<button>+</button></div></div></div>`)}${p.section('当前预计', `<div class="metric-row"><div class="metric"><b>2</b><span>文件</span></div><div class="metric"><b>10</b><span>总页数</span></div><div class="metric"><b>4</b><span>总份数</span></div></div>`)}${p.notice('进入报价后材料包会短暂锁定。报价或建单失败时必须恢复可编辑状态。', 'warning')}</div>`,
        action: p.actionbar('配置打印', 'M10', '继续添加', 'M01'),
      }),
  })

  add({
    id: 'M10',
    phase: 'M2',
    group: '打印履约',
    name: '打印设置',
    meta: '基于真实终端能力配置参数',
    goal: '形成可履约参数并获取服务端报价',
    cta: '获取实时报价',
    states: '能力加载、参数不支持、报价失败',
    render: () =>
      p.screen({
        className: 'print-settings-screen',
        title: '打印设置',
        body: `<div class="scroll no-tab"><section class="section"><div class="setting-row"><div><b>纸张规格</b><small>当前设备已确认支持</small></div><span class="setting-value">A4</span></div><div class="setting-row"><div><b>单双面</b><small>长边翻转</small></div><span class="setting-value">双面</span></div><div class="setting-row"><div><b>颜色</b><small>以所选终端已验收能力为准</small></div><span class="setting-value">黑白</span></div><div class="setting-row"><div><b>份数</b><small>材料包内可分别设置</small></div><span class="setting-value">共 4 份</span></div></section>${p.section('页面范围', `<div class="segmented" style="--cols:2"><button class="active">全部页面</button><button>自定义</button></div>`)}${p.notice('不支持 A3。彩色选项仅在目标终端上报并验收对应能力后显示，不能硬编码打印机 mode。', 'warning')}</div>`,
        action: p.actionbar('获取实时报价', 'M11'),
      }),
  })

  add({
    id: 'M11',
    phase: 'M2',
    group: '打印履约',
    name: '打印预览',
    meta: '分页、边距与价格前置检查',
    goal: '降低错印、浪费和售后成本',
    cta: '选择服务点',
    states: '分页警告、文件失效、预览失败',
    render: () =>
      p.screen({
        className: 'print-preview-screen',
        title: '打印预览',
        body: `<div class="scroll no-tab"><div class="preview-stack">${p.paper()}<span class="page-count">材料 1 · 第 1 / 2 页</span></div>${p.section('预览检查', `<div class="panel">${p.row({ iconName: 'check', title: '页面尺寸正常', sub: 'A4 · 共 10 个印面', value: '通过' })}${p.row({ iconName: 'file', tone: 'gold', title: '作品集第 4 页边距较窄', sub: '可能靠近打印安全边界', value: '查看' })}</div>`)}${p.section('参数摘要', `<div class="badge-row">${p.badge('A4')}${p.badge('双面')}${p.badge('黑白')}${p.badge('4份')}</div>`)}${p.notice('预览为服务端生成的近似效果，最终版式以原文件和设备能力为准。')}</div>`,
        action: p.actionbar('选择服务点', 'M12', '返回设置', 'M10'),
      }),
  })

  add({
    id: 'M12',
    phase: 'M2',
    group: '打印履约',
    name: '选择服务点',
    meta: '绑定真实 terminalCode 与 locationLabel',
    goal: '选择可履约终端，不展示假距离和假等待',
    cta: '选定此服务点',
    states: '在线、离线、地址缺失、无可用点位',
    render: () =>
      p.screen({
        className: 'service-picker-screen',
        title: '选择服务点',
        right: '说明',
        body: `<div class="scroll no-tab"><section class="section"><div class="searchbar">${p.icon('search')}搜索服务点名称或地址</div></section>${p.section('可履约服务点', `<div class="service-item selected"><div class="service-title"><b>城东就业服务站</b>${p.badge('在线', 'green')}</div><p>青山区建设路 26 号 · 一层服务大厅</p><div class="service-facts"><span>终端 KSK-001</span><span>A4</span><span>08:30–17:30</span></div></div><div class="service-item"><div class="service-title"><b>大学生就业服务中心</b>${p.badge('暂不可选', 'danger')}</div><p>终端最新心跳异常，请选择其他服务点。</p><div class="service-facts"><span>终端 KSK-004</span><span>地址已核验</span></div></div>`)}${p.notice('当前未建立完整终端坐标和真实队列数据，因此不展示“附近”“空闲”或预计等待时间。', 'warning')}</div>`,
        action: p.actionbar('选定此服务点', 'M13', '查看详情', 'T02'),
      }),
  })

  add({
    id: 'M13',
    phase: 'M2',
    group: '打印履约',
    name: '确认订单',
    meta: '服务端报价、权益抵扣与微信支付',
    goal: '透明完成付费并建立 Order-only 待释放订单',
    cta: '确认支付 ¥6.40',
    states: '待支付、支付取消、回调中、支付失败',
    render: () =>
      p.screen({
        className: 'checkout-screen',
        title: '确认打印订单',
        body: `<div class="scroll no-tab">${p.section('履约信息', `<div class="panel">${p.row({ iconName: 'map', title: '城东就业服务站', sub: '终端 KSK-001 · 到机后核验打印', go: 'T02' })}${p.row({ iconName: 'print', tone: 'coral', title: '明日招聘会材料包', sub: 'A4 · 双面 · 黑白 · 共 10 个印面' })}</div>`)}${p.section('费用明细', `<div class="panel"><div class="price-line"><span>打印服务</span><b style="font-size:13px;color:var(--ink)">¥8.00</b></div><div class="divider"></div><div class="price-line"><span>权益抵扣 2 页</span><b style="font-size:13px;color:var(--green)">−¥1.60</b></div><div class="divider"></div><div class="price-line"><span>应付</span><strong><small>¥</small>6.40</strong></div></div>`)}${p.section('到机有效期', `<div class="fake-input"><span>支付后 24 小时内</span><span>超时自动退款</span></div>`)}<section class="section"><div class="check-row"><span class="check">${p.icon('check')}</span><span>我已确认文件、页数、打印参数、服务点和退款规则。支付并不代表已经出纸。</span></div></section></div>`,
        action: p.actionbar('确认支付 ¥6.40', 'M14'),
      }),
  })

  add({
    id: 'M14',
    phase: 'M2',
    group: '打印履约',
    name: '到机码',
    meta: '已支付但尚未创建打印任务',
    goal: '安全完成手机到一体机的履约交接',
    cta: '查看服务点与路线',
    states: '待到机、临期、过期退款、已释放',
    render: () =>
      p.screen({
        className: 'pickup-screen',
        title: '到机码',
        body: `<div class="scroll no-tab"><section class="handoff-console"><header><span>安全交接</span><b>18 小时内有效</b></header><div class="handoff-copy"><small>订单 PT20260805-8246</small><h1>本人到机交接</h1><p>支付已完成。只有在一体机现场核验后，系统才会创建打印任务。</p></div><div class="handoff-code"><small>输入到机码</small><b>824619</b><span>有效至 8月6日 09:40</span></div><button class="handoff-location" data-go="T02">${p.icon('map')}<span><b>城东就业服务站</b><small>建设路 26 号一层 · 终端 KSK-001</small></span><em>在线</em>${p.icon('arrow')}</button></section><section class="handoff-checklist"><div class="checklist-title"><span>现场将发生什么</span><small>支付不代表已经出纸</small></div><ol><li class="active"><b>1</b><span>输入码</span></li><li><b>2</b><span>核验订单</span></li><li><b>3</b><span>本人确认</span></li><li><b>4</b><span>创建打印任务</span></li></ol>${p.notice('不要把到机码转发给他人。未释放订单取消或到期后，按真实支付渠道原路退款或返还权益。')}</section></div>`,
        action: p.actionbar('查看服务点与路线', 'T02', '查看订单', 'M15'),
      }),
  })

  add({
    id: 'M15',
    phase: 'M2',
    group: '打印履约',
    name: '订单详情',
    meta: '队列、打印、失败与退款统一状态',
    goal: '真实追踪履约并承接异常处理',
    cta: '查看实时进度',
    states: '排队、打印中、完成、失败、退款中/完成',
    render: () =>
      p.screen({
        className: 'order-tracking-screen',
        title: '订单详情',
        right: '反馈',
        body: `<div class="scroll no-tab"><section class="print-monitor"><header><span>终端 KSK-001 · 实时</span><small>15:26 已更新</small></header><div class="monitor-state"><div><small>订单 PT20260805-8246</small><h1>正在出纸</h1><p>城东就业服务站</p></div><strong>4<small>/10</small></strong></div><div class="monitor-bar"><i style="width:40%"></i></div><footer><span>当前：第 4 个印面</span><b>设备执行中</b></footer></section><section class="monitor-events"><div class="event-head"><h2>状态记录</h2><span>真实终端回流</span></div><ol><li class="active"><time>15:26</time><div><b>打印任务执行中</b><span>第 4 / 10 个印面</span></div></li><li><time>15:25</time><div><b>一体机现场确认</b><span>本人已核验订单</span></div></li><li><time>14:40</time><div><b>微信支付成功</b><span>¥6.40</span></div></li></ol></section><section class="monitor-order"><h2>本次任务</h2><div><small>材料</small><b>明日招聘会材料包</b><span>2 文件 · A4 双面黑白 · 4份</span></div><button data-go="T02"><small>执行终端</small><b>城东就业服务站 · KSK-001</b>${p.icon('arrow')}</button>${p.notice('硬件失败不会自动换终端重打。系统会核查真实任务状态后，再决定补打或退款。', 'warning')}</section></div>`,
        action: p.actionbar('查看实时进度', 'M15', '反馈此订单', 'U05'),
      }),
  })
})()
