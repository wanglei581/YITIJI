/* 演示数据（全部是示例，不连真实接口）+ 说明栏内容 */
window.D = {
  resume: { file: '李佳怡-简历-2026秋招.pdf', pages: 1, size: '186 KB', phoneTail: '6721' },
  issues: [
    { cat: '表达', title: '「负责学院公众号日常运营」只写了做什么', hint: '没写做成了什么，招聘方不好判断' },
    { cat: '结构', title: '教育经历排在最后', hint: '应届生把教育经历放前面更合适' },
    { cat: '缺少', title: '技能里没写你用过的工具', hint: '实习经历里提到过剪映和 Excel' },
    { cat: '表达', title: '迎新晚会只写了「组织」', hint: '可以写清规模和你负责的部分' },
    { cat: '措辞', title: '自我评价比较空泛', hint: '换成具体的事，或者删掉' }
  ],
  sugg: [
    { cat: '表达', kind: 'text', old: '负责学院公众号的日常运营。',
      neu: '负责学院公众号的选题、撰写与排版，累计发布推文 <span class="blank" data-blank>▢</span> 篇。',
      why: '招聘方更关心你做成了什么。▢ 处请填你的真实数字，没有就删掉这半句。' },
    { cat: '结构', kind: 'reorder', before: ['个人信息', '实习经历', '校园经历', '技能', '教育经历'], after: ['个人信息', '教育经历', '实习经历', '校园经历', '技能'],
      why: '应届生的学历是招聘方最先看的。只调整顺序，内容一个字不改。' },
    { cat: '缺少', kind: 'text', old: '技能：熟练使用 Office。',
      neu: '技能：熟练使用 Office；会用剪映剪辑短视频，用 Excel 整理活动报名数据。',
      why: '这两项来自你实习经历里写过的内容，不是新加的。' },
    { cat: '表达', kind: 'text', old: '组织 2025 年迎新晚会，负责节目统筹。',
      neu: '牵头组织 2025 年学院迎新晚会，负责节目统筹，参加人数约 <span class="blank" data-blank>▢</span> 人。',
      why: '先写你负责的部分，再用真实数字说明规模。' },
    { cat: '措辞', kind: 'choice', old: '自我评价：性格开朗，有责任心，学习能力强。',
      why: '这类话几乎每份简历都有，招聘方很难记住。可以删掉，或者换成一件能说明你的事。' }
  ],
  roles: ['新媒体运营', '行政专员', '销售代表', '会计', '前端开发', '机械工程师'],
  industries: ['互联网', '教育培训', '制造业', '金融', '零售与消费'],
  exps: ['应届生', '1 年以内', '1–3 年', '3–5 年', '5 年以上', '转行求职'],
  interviewers: [
    { k: 'hr', l: 'HR 面试', d: '自我介绍 · 求职动机 · 稳定性', c: '#1f9e86', a: 'HR' , q: '你为什么想来我们公司？' },
    { k: 'mgr', l: '业务主管', d: '过往经历 · 岗位理解 · 执行', c: '#3f68b0', a: '主管' , q: '说说你做过最难的一件事。' },
    { k: 'tech', l: '技术面试官', d: '专业技能 · 项目细节', c: '#0f6e5c', a: '技术' , q: '这个项目里你具体负责哪部分？' },
    { k: 'campus', l: '校招面试官', d: '校园经历 · 学习能力 · 规划', c: '#b8683c', a: '校招' , q: '在学校里你做过什么让你有成就感？' },
    { k: 'final', l: '终面负责人', d: '价值观 · 长期发展', c: '#14453a', a: '终面' , q: '三年后你希望自己在做什么？' }
  ],
  diffs: [['easy', '轻松练习', '问题更基础'], ['standard', '标准面试', '接近真实节奏'], ['pressure', '压力面试', '更多追问']],
  durs: [[3, '3 分钟', '约 3–4 题'], [5, '5 分钟', '约 4–6 题'], [8, '8 分钟', '约 6–8 题']],
  questions: [
    '先用一分钟介绍一下你自己。',
    '说说你在学院公众号做过的、最有成就感的一件事。',
    '如果一篇推文发出去阅读量很低，你会怎么复盘？',
    '你为什么想做新媒体运营？',
    '最后，你有什么想问我们的吗？'
  ],
  transcript: '我负责过学院公众号的迎新专题，从选题到排版都是我做的，那一周……',
  report: {
    title: '表达清楚，例子还可以更具体',
    good: ['自我介绍有条理，先说专业，再说经历', '能讲出公众号运营的具体做法', '语速适中，没有明显卡顿'],
    better: ['第 2 题缺少数字：发了几篇、关注涨了多少', '第 3 题复盘只说了「找原因」，可以分三步讲', '反问环节可以问这个岗位每天具体做什么']
  },
  usbFiles: [
    { n: '实习证明-盖章版.pdf', t: 'PDF', p: 1, s: '1.2 MB' },
    { n: '毕业生就业推荐表（已填写）.docx', t: 'Word', p: 2, s: '86 KB', no: 'Word 文档这台机器现在打不了，请先转成 PDF' },
    { n: '个人作品集-新媒体运营.pdf', t: 'PDF', p: 12, s: '8.4 MB' },
    { n: '蓝底证件照.jpg', t: 'JPG', p: 1, s: '420 KB' }
  ],
  policyCats: [
    { k: '高校毕业生', d: '求职补贴、见习、基层项目', ic: 'book' },
    { k: '就业补贴', d: '吸纳就业、稳岗', ic: 'receipt' },
    { k: '社保补贴', d: '灵活就业人员社保', ic: 'shield' },
    { k: '创业扶持', d: '担保贷款、创业场地', ic: 'sparkle' },
    { k: '技能培训', d: '培训补贴、职业技能证书', ic: 'clipboard' },
    { k: '灵活就业', d: '登记、零工服务', ic: 'clock' }
  ],
  policies: [
    { t: '高校毕业生一次性求职创业补贴', sum: '面向毕业年度、家庭困难等几类毕业生；材料 4 项', org: '市人社局', date: '10 月 18 日', tags: ['可核对条件', '有材料清单'] },
    { t: '离校未就业高校毕业生就业见习', sum: '离校两年内未就业，可以报名到见习单位参加见习', org: '市人社局', date: '10 月 9 日', tags: ['有材料清单'] },
    { t: '小微企业吸纳高校毕业生社保补贴', sum: '由用人单位申请，求职者了解即可', org: '区就业服务中心', date: '9 月 26 日', tags: ['面向用人单位'] },
    { t: '高校毕业生基层服务项目报名指引', sum: '报名时间、条件和流程，报名在官方网站进行', org: '省人社厅', date: '9 月 12 日', tags: ['官方入口'] }
  ],
  me: { name: '李佳怡', phone: '138****6721', resumes: 2, docs: 5, orders: 3, ai: 6 }
};

/* 说明栏：功能怎么用（按「人走到机器前想办成的事」组织，依据 Codex 对 main@0b4b5770b 的梳理，Claude 核对过三处） */
window.GOALS = [
  { t: '打印手机里的文件', who: '手机里存着文件的人', path: ['print', 'print-src', 'upload', 'preview', 'confirm', 'printing', 'done'], take: '打印件', kiosk: '出纸', phone: '传文件' },
  { t: '打印 U 盘里的文件', who: '带 U 盘来的人', path: ['print', 'print-src', 'usb', 'pii', 'preview', 'confirm', 'printing', 'done'], take: '打印件、U 盘', kiosk: '读 U 盘、出纸', phone: '—' },
  { t: '手机下单，到机器取件', who: '在小程序里下过单的人', path: ['print', 'pickup', 'pickup-ok', 'printing', 'done'], take: '订单里的打印件', kiosk: '输到机码、出纸', phone: '下单、看订单' },
  { t: '扫描纸质材料', who: '拿着纸质材料的人', path: ['print', 'scan-type', 'scan-guide', 'scan-wait', 'scan-result'], take: '扫描件（PDF）', kiosk: '在打印机面板上扫', phone: '—' },
  { t: '复印证件', who: '带身份证、票据原件的人', path: ['print', 'copy'], take: '复印件和原件', kiosk: '全部在打印机面板上', phone: '—' },
  { t: '照片合成 PDF', who: '想把几张照片拼成一份文件的人', path: ['print', 'img2pdf'], take: 'PDF 或打印件', kiosk: '出纸', phone: '传照片' },
  { t: '带着简历来改', who: '有电子或纸质简历的人', path: ['resume', 'resume-src', 'upload', 'reading', 'diagnosis', 'optimize', 'compare', 'confirm', 'printing', 'done'], take: '本人确认过的新简历', kiosk: '扫描纸稿、出纸', phone: '长时间修改' },
  { t: '从零写一份简历', who: '还没有简历的人', path: ['resume', 'scratch', 'scratch-1', 'templates', 'gen-preview', 'confirm'], take: '可核对的简历', kiosk: '出纸', phone: '推荐：在手机上慢慢写' },
  { t: '模拟面试并打印报告', who: '想练表达的学生和求职者', path: ['interview', 'iv-1', 'iv-2', 'iv-3', 'iv-run', 'iv-report', 'confirm'], take: '练习反馈报告', kiosk: '报告出纸', phone: '练习准备' },
  { t: '查政策、看材料清单', who: '想了解补贴、社保的人', path: ['policy', 'policy-list', 'policy-detail'], take: '材料清单、官方入口', kiosk: '清单出纸', phone: '扫码看官方原文' },
  { t: '问小青', who: '不知道点哪儿、想问一步怎么办的人', path: ['xq'], take: '明确的下一步', kiosk: '—', phone: '长对话回到小程序' },
  { t: '登录与「我的」', who: '想找回简历、文档、订单的人', path: ['login', 'phone-login', 'me', 'my-resumes', 'my-orders', 'my-docs', 'privacy'], take: '本人记录', kiosk: '登录只管这一次', phone: '长期资料在手机上管' },
  { t: '求职材料、职业规划、自我探索、简历对照', who: '想写求职信、理清方向的人', path: ['materials', 'materials-result', 'jobfit', 'jobfit-result', 'career', 'sa-intro', 'sa-result'], take: '材料或建议（可打印）', kiosk: '出纸', phone: '可以先在手机准备' },
  { t: '公共层：待机、续办、离线、帮助、协议', who: '每一个走到机器前的人', path: ['standby', 'home', 'session-resume', 'offline', 'help', 'legal', 'cleared'], take: '安全退出、知道下一步', kiosk: '—', phone: '—' }
];

/* 说明栏：补充清单（他可能没考虑到的点；来源：cx=Codex 读代码，ag=agy 反方，gk=Grok 查资料，cl=Claude 实测线上页面） */
window.GAPS = [
  { src: ['cl', 'cx'], t: '线上还有「找现场工作人员」', d: '帮助页、打印页缺纸提示里仍有这句，和无人值守口径冲突。新版一律给：重试、换方式、服务电话、问小青。', how: '帮助页、打印机连不上状态' },
  { src: ['ag', 'gk'], t: '可点的东西要在够得着的高度', d: '深圳地方标准写「手触操作高度宜 105–150 cm」。屏幕上沿可能高于 150 cm，顶部只放看的东西。', how: '三区：上看、中选、下按' },
  { src: ['ag'], t: '卡片不能是空盒子', d: '空白太多会让人以为没加载完；卡片按内容定高，多出来的地方放「带走什么」的实物小样。', how: '首页四张卡、简历两张卡' },
  { src: ['cx', 'gk'], t: '出纸动画只能跟着真实张数走', d: '排队、打印机接单、正在出纸、结果未确认是四种状态；动画不能自己演完就说「打印成功」。', how: '出纸中、结果未确认' },
  { src: ['ag'], t: '人一看到纸就走了', d: '出完纸提醒取走，屏幕上倒计时结束办理；原件和 U 盘单独提醒一次。', how: '取件页、扫描结果页' },
  { src: ['cx'], t: '清场不等于取消', d: '倒计时清掉的是这台机器上的文件和登录；已经开始的打印照常出纸，要明说。', how: '无操作提醒、已清除' },
  { src: ['cx'], t: '身份证怎么放还没核实', d: '代码里身份证摆放、翻面仍标「待现场核实」，不能画成确定的动作示意，只指到打印机屏幕。', how: '复印证件页' },
  { src: ['ag', 'cx'], t: '软键盘会挡住输入框和按钮', d: '多字段输入改成点选为主、可以说话填写；必须打字时输入框和下一步要留在键盘上方。', how: '面试第 1 步、从零写简历' },
  { src: ['ag'], t: '身后排队的人能看到屏幕', d: '手机号、证件号默认打码；只在需要时点一下显示几秒。', how: '我的、核对页' },
  { src: ['ag', 'gk'], t: '扫码之后屏幕要马上有回应', d: '手机连上、文件到了都要在大屏上立刻变化，不能只转圈。', how: '手机传文件页' },
  { src: ['cx'], t: '登录早晚会影响东西存到哪', d: '没登录生成的文件不会自动进「我的文档」，要在开始前说清楚。', how: '简历入口、对比页' },
  { src: ['cx'], t: '小青不可用时，手动结果要保住', d: '简历能打印原话、面试能给通用题目单，但不能把手动结果画成 AI 报告。', how: '读简历页（小青不可用开关）' },
  { src: ['gk'], t: '超过 1 秒要说在干什么，超过 10 秒要给进度', d: 'Nielsen 三个响应时间界限；打印首页出纸常见 6–10 秒。', how: '读简历、出纸中' },
  { src: ['gk'], t: '待机屏不放商业广告，触摸立刻停', d: '深圳地方标准：不刊登商业广告；办理页不自动轮播。', how: '待机屏' },
  { src: ['ag', 'gk'], t: '动效要能关', d: '超过 5 秒的循环动画要能暂停（WCAG 2.2.2）；提供「减弱动效」，也跟随系统设置。', how: '左下角开关' },
  { src: ['cx'], t: '到机码要有屏上数字键盘', d: '全屏模式下系统键盘不一定弹；8 位新码、10 位旧码都要认。', how: '到机取件页' },
  { src: ['cl'], t: '一屏只放一句边界声明', d: '现在每页有三四行「以办理时确认为准」，七成文字小于 22px。新版每屏最多一句，放在底部。', how: '所有页面' }
];

/* 流程串：说明栏里显示「这一屏所在的流程」缩略图 */
window.FLOWS = [
  { n: '改简历', ids: ['resume', 'resume-src', 'upload', 'reading', 'diagnosis', 'optimize', 'compare', 'confirm', 'printing', 'done'] },
  { n: '从零写简历', ids: ['resume', 'scratch', 'scratch-1', 'templates', 'gen-preview', 'confirm'] },
  { n: '求职材料', ids: ['resume', 'materials', 'materials-result', 'confirm'] },
  { n: '简历对照与规划', ids: ['resume', 'jobfit', 'jobfit-result', 'jobfit-actions', 'career', 'confirm'] },
  { n: '自我探索', ids: ['resume', 'sa-intro', 'sa-q', 'sa-result', 'sa-history'] },
  { n: '全部简历服务', ids: ['resume', 'resume-more', 'templates', 'my-resumes', 'my-ai'] },
  { n: '练面试', ids: ['interview', 'iv-1', 'iv-2', 'iv-3', 'iv-run', 'iv-report', 'confirm', 'printing', 'done'] },
  { n: '面试准备与记录', ids: ['interview', 'iv-tips', 'iv-reports', 'iv-report'] },
  { n: '打印文件', ids: ['print', 'print-src', 'upload', 'phone-upload', 'pii', 'preview', 'confirm', 'cashier', 'printing', 'done', 'unconfirmed'] },
  { n: 'U 盘打印', ids: ['print', 'print-src', 'usb', 'pii', 'preview', 'confirm', 'printing', 'done'] },
  { n: '扫描', ids: ['print', 'scan-type', 'scan-guide', 'scan-wait', 'scan-result'] },
  { n: '到机取件', ids: ['print', 'pickup', 'pickup-ok', 'printing', 'done'] },
  { n: '复印与文件工具', ids: ['print', 'copy', 'img2pdf', 'sign', 'feature-info'] },
  { n: '查政策', ids: ['policy', 'policy-list', 'policy-detail', 'confirm'] },
  { n: '问小青', ids: ['home', 'xq'] },
  { n: '登录', ids: ['me', 'login', 'phone-login'] },
  { n: '我的', ids: ['me', 'my-resumes', 'my-docs', 'my-orders', 'my-ai', 'my-activity', 'my-fav', 'notifications', 'feedback', 'settings', 'privacy'] },
  { n: '权益与活动', ids: ['me', 'activities', 'activity-detail', 'my-benefits'] },
  { n: '系统与公共', ids: ['standby', 'home', 'session-resume', 'help', 'official', 'legal', 'offline', 'cleared'] },
  { n: '受控与扩展', ids: ['contract', 'contract-result', 'toolbox', 'smart-campus', 'campus-svc'] }
];
