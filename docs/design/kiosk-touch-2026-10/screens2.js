/* 第二批：其余功能页。页面事实来自 Grok 对 main@0b4b5770b 源码的逐页提取（density-1025/grok-pages-out.md），Claude 按新版版式重画。 */
(function () {
  const { icon, band, dock, nav, slab, tile } = UI;
  const S = () => window.S;
  const F = (o) => (o.band ? band(o.band) : '') + (o.pre || '') + `<main class="body ${o.cls || ''}">${o.body}</main>` + (o.dock === false ? '' : (o.dockHtml || dock(o.dock || {}))) + (o.nav === false ? '' : (o.navAdvisor ? nav(o.nav).replace('<span>问小青</span>', '<span>AI 顾问</span>') : nav(o.nav)));
  const fine = (t) => `<p class="fine">${t}</p>`;
  const sec = (t, s) => `<div class="sec-t">${t}${s ? `<small>${s}</small>` : ''}</div>`;
  const add = (id, group, name, def) => window.SCREENS.push(Object.assign({ id, group, name }, def));
  const needLogin = (what) => `${slab({ i: 0, go: 'login', title: '登录后才能看' + what, desc: '用手机微信扫一扫，几秒钟；只有你本人能看到', take: '本人记录', vis: UI.qr(3, 180) })}
    <div class="lockprev"><div class="olist-t" style="padding:0">登录后，这里会列出你的${what}</div>${[1, 2, 3].map(k => `<div class="lp"><i></i><span><b></b><small></small></span>${icon('lock', 26, 2)}</div>`).join('')}</div>
    <div class="benefits">${[['printer', '不登录也能打印', '手机、U 盘、扫描'], ['file', '不登录也能改简历', '离开后自动清除'], ['landmark', '不登录也能查政策', '本机构发布']].map(b => `<div><span>${icon(b[0], 38, 2)}</span><b>${b[1]}</b><small>${b[2]}</small></div>`).join('')}</div>
    ${fine('登录只管这一次，离开 60 秒没操作会自动退出')}`;
  const gate = (o) => !S().logged ? F({ band: { eyebrow: o.eyebrow, title: '登录后看你的' + o.what, sub: '只有你本人能看到', seal: null }, body: needLogin(o.what), dock: { ask: false, pri: { label: '去登录', go: 'login' } }, nav: 'me' }) : null;
  const row = (o) => `<div class="rec ${o.cls || ''}">${o.lead || ''}<div class="rc"><b>${o.t}</b><small>${o.m}</small>${o.extra || ''}</div>${o.tail || ''}</div>`;
  const acts = (list) => `<div class="racts">${list.map(a => `<button class="btn ${a.k || 'sec'} sm" ${a.dis ? 'disabled' : ''} ${a.go ? `data-go="${a.go}"` : `data-act="toast" data-arg="${a.toast || '演示：' + a.l}"`}>${a.i ? icon(a.i, 26, 2.2) : ''}${a.l}</button>`).join('')}</div>`;
  const lead = (ic, tone) => `<span class="rl ${tone || ''}">${icon(ic, 38, 2)}</span>`;
  const gi = (o) => `<button class="gi ${o.off ? 'off' : ''}" ${o.go ? `data-go="${o.go}"` : `data-act="toast" data-arg="${o.arg || '演示：' + o.t}"`}><span class="ic ${o.tone || ''}">${icon(o.icon, 34, 2)}</span><span class="tx"><b>${o.t}</b><small>${o.d}</small></span><span class="chev">${icon('chevR', 30, 2.2)}</span></button>`;
  const grp = (title, inner, sub) => `<div class="fgroup">${sec(title, sub)}${inner}</div>`;

  /* ═════════ 公共 / 系统（本区屏：逻辑在 fix-public.js） ═════════ */
  add('session-resume', '公共', '继续打印任务', {
    notes: { does: '运行页 /session-resume。全库没有 navigate 进这一页，只能手敲地址。未登录时运行页会直接去登录；这一页停住并给「去登录」，登录成功回到这一页。未登录画登录说明、「登录后在这一页能」三行（看没办完的打印、接着付款或取件、不能继续的会写原因）和「不登录也能办」两块。', motion: '重新读取进入读取中。结果等演示事件，不自己变成已办成。', keep: '运行页无入口，改程序时由产品负责人定接到哪。已登录列表按内容高度，写「共 N 条」并标小胶囊「示例」，条数从 getPendingTasks 来。等待领取去 printing，支付处理中去 cashier，并写「支付正在处理，本页不判定成功或失败」。空列表才有打印、到机码、我的动态、帮助。不可继续写原因，不写价钱。号码与服务时间从后台读，读不到不显示。' },
    demo: [{ label: '演示：正在读取', ev: 'load' }, { label: '演示：没有未完成', ev: 'empty' }, { label: '演示：列表没读到', ev: 'down' }, { label: '演示：列表回来了', ev: 'list' }],
    render: () => window.FP.resume(),
    mount: (el) => window.FP.mountResume(el)
  });

  add('offline', '公共', '机器状态', {
    notes: { does: '运行页 /error-offline，在 KioskRoot 外。四态：未检测、检测中、部分取不到、断网。入口是首页「设备状态」和帮助里的「看设备状态」。屏上是一张状态清单加机器插画，不是八张状态块。', motion: '重新检测先变成检测中。结果等演示事件，不弹提示，也不自己跳走。', keep: '读不到写「暂时读不到」。U 盘写「暂未开通」。不画复印。不把没探到的写成好或坏。断网才用机器故障句，其余态用求助句。号码与服务时间从后台读，读不到不显示。自动再测间隔 10、20、40、封顶 60 秒只写在 notes，屏上不写间隔，本页不走表，也不自己跳走。' },
    demo: [{ label: '演示：还没检测', ev: 'unknown' }, { label: '演示：检测中', ev: 'checking' }, { label: '演示：部分取不到', ev: 'partial' }, { label: '演示：连不上', ev: 'offline' }],
    render: () => window.FP.offline(),
    mount: (el) => window.FP.mountOffline(el)
  });

  add('route-error', '公共', '页面不存在', {
    notes: { does: '运行页 errorElement，以及未知路径。默认标题「页面不存在」。失败态标题按 10/27 写「这一页打不开」（运行页原文是「页面暂时无法显示」）。屏上只显示当前这一态，不把另一句标题也摆出来。', motion: '重新打开重新渲染本屏，并记下次数。不演成已经办成。', keep: '只有重新打开和回首页。求助用标准电话句，不链到帮助页，不提供设备状态或问小青。不判断打印是否在出。出错留在本屏；回首页是出口。号码与服务时间从后台读，读不到不显示。' },
    demo: [{ label: '演示：这一页打不开', ev: 'fail' }, { label: '演示：页面不存在', ev: 'missing' }],
    render: () => window.FP.routeError(),
    mount: (el) => window.FP.mountRoute(el)
  });

  add('legal', '公共', '用户服务协议 / 隐私政策', {
    notes: { does: '运行页 /legal/:doc。默认三章，屏上只标小胶囊「示例」。目录切换是本屏换章。失败后才能点开本机留存，并标明「不是最新正式版本」。入口来自登录和手机确认页的协议链接，以及帮助里的隐私政策。', motion: '换章、换文档立刻换正文。重新读取进入读取中，等演示事件。', keep: '屏上不写「运行时」「以后台正式版本为准」。当前章和当前文档不可再点。看不懂这一章：正式正文去 xq，留存态这颗按钮停用。没有这份文档时给两张带插画的文档卡。读取失败留在本屏，可重试、看留存或改看另一份。号码与服务时间从后台读，读不到不显示。' },
    demo: [{ label: '演示：正文没取回', ev: 'error' }, { label: '演示：正文回来了', ev: 'ready' }, { label: '演示：看留存文本', ev: 'fallback' }, { label: '演示：正在读取', ev: 'load' }, { label: '演示：没有这份文档', ev: 'missing' }],
    render: () => window.FP.legal(),
    mount: (el) => window.FP.mountLegal(el)
  });

  add('phone-upload', '公共', '手机上：传文件', {
    notes: { does: '运行页 /upload/phone，在用户自己的手机上。默认还没选文件。成功句是「系统已收到这份文件，请回一体机确认」。时限自生成起 10 分钟，页上不显示已经过去的秒数。', motion: '选文件是系统文件界面。选中、已收到、结果未知、人在一体机上打开，都等演示事件。本页不自己走到已收到。', keep: '不出现连接状态。结果未知不许再传，回一体机看。人在一体机上打开不能选文件。格式芯片是 PDF、JPG、PNG。屏上写「Word 等格式，看这台机器当时能不能收。」单个 10MB。这一页不从登录进来。入口要加在上传屏二维码处。' },
    demo: [{ label: '演示：系统已收到', ev: 'got' }, { label: '演示：结果未知', ev: 'unknown' }, { label: '演示：已选文件', ev: 'picked' }, { label: '演示：人在一体机上', ev: 'kiosk' }, { label: '演示：回到待选', ev: 'ready' }],
    render: () => window.FP.phoneUpload(),
    mount: (el) => window.FP.mountUpload(el)
  });

  add('phone-login', '公共', '手机上：确认登录', {
    notes: { does: '运行页 /member/qr-login，在用户自己的手机上。不预填手机号和验证码。票据 180 秒，重发 60 秒，都不走表。稿上从登录屏扫码态的「看手机上的确认页」进来；运行时这一页在手机上打开。', motion: '确认进入正在提交。成功只由演示事件变成「已确认，请回一体机继续」。结果未知后不能再确认。', keep: '必须先勾选协议。协议去 legal 并带上对应文档，屏上写「打开后可以阅读全文」。本页不宣布一体机已经登录。发码失败、次数用完等留在说明里，不在这一帧假装已经登录。' },
    demo: [{ label: '演示：键盘已写入', ev: 'typed' }, { label: '演示：验证码已请求', ev: 'sent' }, { label: '演示：已确认', ev: 'ok' }, { label: '演示：结果未知', ev: 'unknown' }],
    render: () => window.FP.phoneLogin(),
    mount: (el) => window.FP.mountPhoneLogin(el)
  });

  /* ═════════ 我的 ═════════ */
  add('notifications', '我的', '消息通知', {
    notes: {
      get does() { return window.FE.notes['notifications'].does; },
      get motion() { return window.FE.notes['notifications'].motion; },
      get keep() { return window.FE.notes['notifications'].keep; },
    },
    demo() { return window.FE.demo('notifications'); },
    render() { return window.FE.page('notifications'); },
    mount(el) { return window.FE.mount(el, 'notifications'); },
  });

  add('my-resumes', '我的', '我的简历', {
    notes: {
      get does() { return window.FE.notes['my-resumes'].does; },
      get motion() { return window.FE.notes['my-resumes'].motion; },
      get keep() { return window.FE.notes['my-resumes'].keep; },
    },
    demo() { return window.FE.demo('my-resumes'); },
    render() { return window.FE.page('my-resumes'); },
    mount(el) { return window.FE.mount(el, 'my-resumes'); },
  });

  add('my-orders', '我的', '我的打印订单', {
    notes: {
      get does() { return window.FE.notes['my-orders'].does; },
      get motion() { return window.FE.notes['my-orders'].motion; },
      get keep() { return window.FE.notes['my-orders'].keep; },
    },
    demo() { return window.FE.demo('my-orders'); },
    render() { return window.FE.page('my-orders'); },
    mount(el) { return window.FE.mount(el, 'my-orders'); },
  });

  add('my-docs', '我的', '我的文档', {
    notes: {
      get does() { return window.FE.notes['my-docs'].does; },
      get motion() { return window.FE.notes['my-docs'].motion; },
      get keep() { return window.FE.notes['my-docs'].keep; },
    },
    demo() { return window.FE.demo('my-docs'); },
    render() { return window.FE.page('my-docs'); },
    mount(el) { return window.FE.mount(el, 'my-docs'); },
  });

  add('my-ai', '我的', 'AI 服务记录', {
    notes: {
      get does() { return window.FE.notes['my-ai'].does; },
      get motion() { return window.FE.notes['my-ai'].motion; },
      get keep() { return window.FE.notes['my-ai'].keep; },
    },
    demo() { return window.FE.demo('my-ai'); },
    render() { return window.FE.page('my-ai'); },
    mount(el) { return window.FE.mount(el, 'my-ai'); },
  });

  add('my-activity', '我的', '浏览与跳转记录', {
    notes: {
      get does() { return window.FE.notes['my-activity'].does; },
      get motion() { return window.FE.notes['my-activity'].motion; },
      get keep() { return window.FE.notes['my-activity'].keep; },
    },
    demo() { return window.FE.demo('my-activity'); },
    render() { return window.FE.page('my-activity'); },
    mount(el) { return window.FE.mount(el, 'my-activity'); },
  });

  add('my-fav', '我的', '我的收藏', {
    notes: {
      get does() { return window.FE.notes['my-fav'].does; },
      get motion() { return window.FE.notes['my-fav'].motion; },
      get keep() { return window.FE.notes['my-fav'].keep; },
    },
    demo() { return window.FE.demo('my-fav'); },
    render() { return window.FE.page('my-fav'); },
    mount(el) { return window.FE.mount(el, 'my-fav'); },
  });

  add('my-benefits', '我的', '我的权益', {
    notes: {
      get does() { return window.FE.notes['my-benefits'].does; },
      get motion() { return window.FE.notes['my-benefits'].motion; },
      get keep() { return window.FE.notes['my-benefits'].keep; },
    },
    demo() { return window.FE.demo('my-benefits'); },
    render() { return window.FE.page('my-benefits'); },
    mount(el) { return window.FE.mount(el, 'my-benefits'); },
  });

  add('activities', '我的', '权益活动', {
    notes: {
      get does() { return window.FE.notes['activities'].does; },
      get motion() { return window.FE.notes['activities'].motion; },
      get keep() { return window.FE.notes['activities'].keep; },
    },
    demo() { return window.FE.demo('activities'); },
    render() { return window.FE.page('activities'); },
    mount(el) { return window.FE.mount(el, 'activities'); },
  });

  add('activity-detail', '我的', '活动详情与领取', {
    notes: {
      get does() { return window.FE.notes['activity-detail'].does; },
      get motion() { return window.FE.notes['activity-detail'].motion; },
      get keep() { return window.FE.notes['activity-detail'].keep; },
    },
    demo() { return window.FE.demo('activity-detail'); },
    render() { return window.FE.page('activity-detail'); },
    mount(el) { return window.FE.mount(el, 'activity-detail'); },
  });

  add('feedback', '我的', '意见反馈', {
    notes: {
      get does() { return window.FE.notes['feedback'].does; },
      get motion() { return window.FE.notes['feedback'].motion; },
      get keep() { return window.FE.notes['feedback'].keep; },
    },
    demo() { return window.FE.demo('feedback'); },
    render() { return window.FE.page('feedback'); },
    mount(el) { return window.FE.mount(el, 'feedback'); },
  });

  add('settings', '我的', '账号设置', {
    notes: {
      get does() { return window.FE.notes['settings'].does; },
      get motion() { return window.FE.notes['settings'].motion; },
      get keep() { return window.FE.notes['settings'].keep; },
    },
    demo() { return window.FE.demo('settings'); },
    render() { return window.FE.page('settings'); },
    mount(el) { return window.FE.mount(el, 'settings'); },
  });

  add('privacy', '我的', '隐私与数据请求', {
    notes: {
      get does() { return window.FE.notes['privacy'].does; },
      get motion() { return window.FE.notes['privacy'].motion; },
      get keep() { return window.FE.notes['privacy'].keep; },
    },
    demo() { return window.FE.demo('privacy'); },
    render() { return window.FE.page('privacy'); },
    mount(el) { return window.FE.mount(el, 'privacy'); },
  });

  /* ═════════ 改简历：工具 ═════════ */
  add('templates', '改简历', '简历模板', {
    notes: { does: '看已发布版式。进入简历优化，或从其他出路去生成、打印、重读。', motion: '无循环动画。', keep: '路由简历模板库。示例三到四张，屏上只加「示例」胶囊，不写运行时读该模板、不写分区名。分区名只留在说明里，屏上不列。读取中、失败、0 条、分类为空分开。进入简历优化去 resume-src 且 intent=optimize。用它生成新简历去 scratch，不套用所选模板。打印现有简历去 print。演示事件 ready / fail。不探测打印机。号码与服务时间从后台读，读不到不显示。普通页 3 分钟清除。' },
    demo: () => window.FR.demo('templates'),
    render: () => window.FR.render('templates'),
    mount: (el) => window.FR.mount('templates', el)
  });
  add('gen-preview', '改简历', '简历预览与核对', {
    notes: { does: '核对这一次的生成结果，选格式后去导出。', motion: '无循环动画。', keep: '不是填写第 6 步。无结果、读回中、读回失败、结果已清除、认不出状态分开，都不拿示例冒充。认不出状态时屏上标题是「这一页暂时打不开」，返回写成回首页，和底栏实际回首页一致。事实未确认或价目挡住时，去导出不可用。价目停用写「简历导出当前不可用（价目已停用，不是免费）」。收费且未登录写「收费导出需登录会员账号并核销 1 次权益」。四种格式，只有 PDF 能打印。去导出到 resume-export，并写入 expFmt。页数和版式导出前不知道。回去改资料回 scratch。AI 不可用的导出原话在生成页，不在这页。号码与服务时间从后台读，读不到不显示。普通页 3 分钟清除。第二轮起不写字段、不写演成功，这些只留在说明里。' },
    demo: () => window.FR.demo('gen-preview'),
    render: () => window.FR.render('gen-preview'),
    mount: (el) => window.FR.mount('gen-preview', el)
  });
  add('materials', '改简历', '求职材料', {
    notes: { does: '未登录先登录。登录后选已发布模板，填姓名和目标岗位，再生成。', motion: '无循环动画。', keep: '未登录不生成。登录页目前回「我的」，回材料要别的区接。种类只有求职信、感谢信、作品集封面、材料清单。屏幕写「不使用 AI」；库字段 derivationKind 为 ai_generated，稿上不画成 AI 撰写。未登录画登录说明、四种材料和不登录也能办的去处，不写运行页会先记下草稿。生成中等演示事件 done 才去结果，失败留在本屏。读取中、失败、0 条分开。号码与服务时间从后台读，读不到不显示。普通页 3 分钟清除。第二轮起这些话只留在说明里，屏上不写。' },
    demo: () => window.FR.demo('materials'),
    render: () => window.FR.render('materials'),
    mount: (el) => window.FR.mount('materials', el)
  });
  add('materials-result', '改简历', '求职材料：生成结果', {
    notes: { does: '真实文件卡：文件名、页数、大小、查看链接、留存、打印凭证。', motion: '无循环动画。', keep: '未登录写登录后才能看到生成的文件，并给不登录也能办的去处。查看链接默认 5 分钟，打印凭证默认 30 分钟，会员求职信留存默认 90 天，这些时长只留在说明里。屏上写「今天 14:25 前可在这里查看」「保留到 2027 年 1 月 25 日」，不写真实文件、不写链接分钟数。有 printFileUrl 才去 pii。未保存的那一份不进我的文档、不能打印。预览失败只说预览。重新生成回填写。结果页 1 分 30 秒清除。号码与服务时间从后台读，读不到不显示。第二轮起这些话只留在说明里，屏上不写。' },
    demo: () => window.FR.demo('materials-result'),
    render: () => window.FR.render('materials-result'),
    mount: (el) => window.FR.mount('materials-result', el)
  });
  add('jobfit', '改简历', '简历对照', {
    notes: { does: '先要有简历任务。有任务才填岗位要求，授权后等待对照。', motion: '无循环动画。', keep: '默认空态：一句说明加三张行动卡，去上传简历 resume-src、打印现有简历 print、扫描 scan-type。不画系统岗位、麦克风、换简历。托管 a 下不出现岗位库，这句话只留在说明里。授权：未登录用「确认岗位匹配授权」，已登录用「开启岗位 AI 辅助」。同意后等待，演示事件 done 去结果，fail 到 AI 不可用出路。不打分、不提供给单位，只在屏上留一行小字。会话结束写「这次办理已结束」。号码与服务时间从后台读，读不到不显示。普通页 3 分钟清除。第二轮起这些话只留在说明里，屏上不写。' },
    demo: () => window.FR.demo('jobfit'),
    render: () => window.FR.render('jobfit'),
    mount: (el) => window.FR.mount('jobfit', el)
  });
  add('jobfit-result', '改简历', '简历对照：结果', {
    notes: { does: '两栏对照。主按钮去优化简历。打印先生成打印版。', motion: '无循环动画。', keep: '条数和关键词是示例，运行时读这次结果，屏上只加「示例」胶囊，不写示例条数。没有的不画成固定 4 和 3。整理佐证材料去 materials。换个岗位分析回 jobfit。不画查看岗位、不画练面试。打印报告先等待，演示事件 print-ready 才去 pii，失败留在本屏。AI 不可用仍可自己改、打印现有简历。底栏返回填写，顶栏回简历服务。结果页 1 分 30 秒清除。号码与服务时间从后台读，读不到不显示。第二轮起这些话只留在说明里，屏上不写。' },
    demo: () => window.FR.demo('jobfit-result'),
    render: () => window.FR.render('jobfit-result'),
    mount: (el) => window.FR.mount('jobfit-result', el)
  });
  add('jobfit-actions', '改简历', '简历对照：行动清单', {
    notes: { does: '两组建议。空数组在栏内写本次未提供。', motion: '无循环动画。', keep: '没有练面试。运行页的行动清单不进面试练习，这句话只留在说明里，屏上不写。去简历优化带 intent=optimize。去材料工坊去 materials。生成打印版等演示事件 print-ready 再去 pii。AI 不可用仍可自己改、打印现有简历。空清单和 AI 不可用各自给去优化、去材料工坊、打印现有简历。底栏回结果，顶栏回简历服务。入口只从结果页来。普通页 3 分钟清除。号码与服务时间从后台读，读不到不显示。第二轮起副题不写示例条数。' },
    demo: () => window.FR.demo('jobfit-actions'),
    render: () => window.FR.render('jobfit-actions'),
    mount: (el) => window.FR.mount('jobfit-actions', el)
  });
  add('career', '改简历', '求职方案', {
    notes: { does: '没有简历任务不给个人结论。有任务才生成四栏方案。', motion: '无循环动画。', keep: '缺任务时一句说明加三张行动卡，去 resume-src、print、scan-type。生成等演示事件 done，失败留在本屏。AI 不可用且还没有方案时，只给运行页那三件通用事，并标明不是针对这份简历；不写冒充。已有方案时 AI 再停，方案仍在，重新生成停用。打印降级件先确认，确认前不进 pii；打印件等演示事件 print-ready。四条下一步只在方案页：优化、对照、面试设置、自我探索。不承诺录用或收入，屏上只留一行小字。不写固定月数。方案页按结果页 1 分 30 秒，生成前 3 分钟。号码与服务时间从后台读，读不到不显示。第二轮起这些话只留在说明里，屏上不写。' },
    demo: () => window.FR.demo('career'),
    render: () => window.FR.render('career'),
    mount: (el) => window.FR.mount('career', el)
  });
  add('sa-intro', '改简历', '自我探索：开始前', {
    notes: { does: '条款从后台读。勾选后才能开始。约 6 分钟、25 题。', motion: '无循环动画。', keep: '读取中、失败不能开始。条款从后台读，屏上写成用户能读的四条，不标示例条款，不写从后台读。敏感题勾选不改变这 25 题。同意勾选的动作键是 termsyes，避免和简历 AI 同意的 agree 撞车。不在底栏放看记录。隐私政策去 legal。开始后进 sa-q。60 秒无操作清会话并回首页（useSelfAssessmentIdleExit.ts），屏上只留这一句，不画倒计时。有终端编号时显示编号，读不到显示设备未绑定；这一区没有终端编号。返回简历服务。号码与服务时间从后台读，读不到不显示。第二轮起这些话只留在说明里，屏上不写。' },
    demo: () => window.FR.demo('sa-intro'),
    render: () => window.FR.render('sa-intro'),
    mount: (el) => window.FR.mount('sa-intro', el)
  });
  add('sa-q', '改简历', '自我探索：答题', {
    notes: { does: '一题三选。下一题逐题走，最后一题进复核，复核确认后才进结果。', motion: '选中只改透明度与边框，不自动跳题。', keep: '未同意直接打开时先回说明：一句「先看完说明并勾选同意，才能开始作答」加一张返回说明的行动卡，不放六张说明卡。作答已关闭时写这次作答已经结束。题干和选项用题库原文。不能跳过未答题。答过的维度可以回去改。进度是已答 n/25。确认提交才去结果。60 秒无操作清会话（useSelfAssessmentIdleExit.ts）。不评分、不排名、不贴类型。号码与服务时间从后台读，读不到不显示。第二轮起这些话只留在说明里，屏上不写。' },
    demo: () => window.FR.demo('sa-q'),
    render: () => window.FR.render('sa-q'),
    mount: (el) => window.FR.mount('sa-q', el)
  });
  add('sa-result', '改简历', '自我探索：结果', {
    notes: { does: '五个方向的强度和依据题号。AI 解读单独标出。可生成 PDF、撤回。', motion: '无循环动画。', keep: '强度是示例，运行时按选择计算，屏上只写依据题号，不写记录编号，不写运行时按选择计算。AI 不可用只留强度和题号，并给「重新作答（约 5 分钟）」；介绍页时长用约 6 分钟，两处不一致。保留 24 小时。撤回两步确认后物理删除，屏上写「这次结果会删掉，不能恢复」，回到说明页。没有访问凭证时不能生成打印件、不能撤回，屏上不写访问凭证。有凭证且打印版返回后才去 pii。查看记录去 sa-history 并记上这一次。不画拿去做职业规划。60 秒无操作清会话。第二轮起这些话只留在说明里，屏上不写。' },
    demo: () => window.FR.demo('sa-result'),
    render: () => window.FR.render('sa-result'),
    mount: (el) => window.FR.mount('sa-result', el)
  });
  add('sa-history', '改简历', '自我探索：这次的记录', {
    notes: { does: '只显示这一次。没有记录就写没有。', motion: '无循环动画。', keep: '空态照空列表：一句说明加两张行动卡，开始一次自我探索、AI 服务记录。不写本稿、不写记录编号。有记录才能回看结果，答案原文没有保存。AI 服务记录始终去 my-ai，登录与否由那一页说明。底栏回说明，顶栏回简历服务。入口要加在简历枢纽，不在说明页底栏。60 秒无操作清会话。有终端编号时显示编号，读不到显示设备未绑定。第二轮起这些话只留在说明里，屏上不写。' },
    demo: () => window.FR.demo('sa-history'),
    render: () => window.FR.render('sa-history'),
    mount: (el) => window.FR.mount('sa-history', el)
  });

  /* ═════════ 练面试：补充 ═════════ */
  add('iv-tips', '练面试', '面试技巧', {
    notes: {
      does: '运行页 /interview/tips（InterviewTipsPage）。公开准备方法：清单 6 项、STAR、自我介绍三档、高频问题 8 道。',
      motion: '按下缩小。展开一道题只换固定高度的说明区，不把整页撑高。勾选只改这一项。',
      keep: '清单从 0/6 起，不预勾。八道题的结构、考察、别这样答、建议从运行页文案读，点按在本屏展开收起，不是提示。闸门看 S().fiHub，不看 ?ai=down：检查中「正在确认在线服务…」，不可达「在线服务当前不可用…」。这两档「设置一场练习」禁用。重新检测只在 fiHub=down，回到检查中；演示 hub-ready 才恢复。?ai=down 不关这页，设置一场练习仍去 iv-1。不把固定技巧说成按简历生成。普通页 3 分钟清除。不报打印机。'
    },
    render: () => window.FI.tips(),
    mount: (el) => window.FI.bind(el),
    demo: () => window.FI.demo('iv-tips')
  });

  add('iv-reports', '练面试', '练习记录', {
    notes: {
      does: '运行页 /interview/reports（InterviewReportsPage）。未登录是登录闸，不套别的屏的登录骨架。已登录才读本人列表。',
      motion: '按下缩小。删除先变成「再次确认删除」，再点才从列表拿掉。',
      keep: '未登录不列历史。文案：大约保留 2 小时；登录之后本人记录保留 7 天。手机号登录去 login。已登录空列表写「还没有练习报告」，主按钮「开始模拟面试」。读取中写「正在读取本人练习报告」，不放示例行。失败写「暂时无法加载练习报告」，重试加载回到读取中，不直接变成有记录。示例两行只在已登录且列表就绪时出现，都标「示例」，不写共几场。有报告的「查看」写下这一场的记录编号再去 iv-report；没有报告的按钮禁用，写「报告未生成」。删除两步；演示 del-fail 写「删除失败，请稍后重试」，记录还在。AI服务记录去 my-ai。先看面试技巧去 iv-tips。有列表时主按钮「开始新练习」。普通页 3 分钟清除。不报打印机。'
    },
    render: () => window.FI.reports(),
    mount: (el) => window.FI.bind(el),
    demo: () => window.FI.demo('iv-reports')
  });

  /* ═════════ 打印扫描：补充 ═════════ */
  add('feature-info', '打印扫描', '证件照（本机尚未开放）', {
    notes: {
      does: '对应 /print-scan/feature/id-photo。只有说明和两条替代。fsFeat=unknown 是不认识的能力名。',
      motion: '无。',
      keep: '不做裁切、底色、排版、成品。不写不能拍照。屏上是证件照插画加「本机暂未开放证件照」，两张大行动卡：已经有证件照文件去 print-src（运行页还带 category=photo，本区不改那一屏）；只有纸质照片去 scan-type，不是指引页。以后会做三条写成紧凑列表，标「规划，不是承诺」，并保留敏感文件原句。主按钮「先用照片打印」和第一条是同一去向。小青不可用时两条路仍在。不读打印机。号码与服务时间从后台读，读不到不显示。无操作约 3 分钟清除。'
    },
    render: () => window.FS.feature(),
    mount: (el) => window.FS.mount(el)
  });

  add('cashier', '打印扫描', '订单支付（收费点位）', {
    notes: { does: '运行页收银台 PrintCashierPage / CashierQxView 的等待支付态（cashierQxModel pending-qr）。金额大于 0 才到这一屏。演示事件 paid 去 printing。演示事件 expired 留在本屏，画收款码过期。', motion: '不演出付款成功。切换方式只改说明，出示付款码时屏幕不回显那串码。屏上不倒计时演到过期。', keep: '默认胶囊「等待支付 · 未确认」。通道行「这台机器只启用了一个支付通道，已自动采用」加「测试支付通道 · 非真实收款」。这句只在沙箱通道出现（CashierPaymentPanel.tsx:327-331）。正式通道显示「{通道名} · 支付结果以实际到账为准」。多通道时由用户自己选，绝不默认第一项（PrintCashierPage.tsx:185-195）。扫码方式两选，「我用手机扫码付」默认选中。收款码下写「这张码属于本次订单，支付主体与金额以手机端展示为准」和「收款码 5 分钟内有效」。有效期从服务端读，默认 300 秒。订单摘要示例「订单号 ORD-20261026-0418」「内容 毕业生就业推荐表（已填写）.pdf · 2 张 · 黑白」「应付 2.00 元」。金额和订单号从订单读，示例不代表价目。底部返回位「返回确认页」；出过码后这一颗变「改参数需重新下单」（PrintCashierPage.tsx:471-475）。「退出支付」放弃这次支付回首页，和返回是两件事（545-569）。主按钮默认「刷新付款结果」：点了在码下面写「正在向支付渠道核实这一次的结果。这一次还没有确认到账。」，不报成功。S().fmCash 为 expired 时胶囊「收款码已过期」，不再出可扫的码。说明用 cashierQxModel 过期态：标题「屏上收款码已过期」；「已经确认这张收款码已经失效。订单本身还在，可以重新出一张码。」；「这和「订单已超时关闭」不是一回事：那种情况订单已经关了，不能再出码。」；锁定句「这一单已经创建过支付尝试：金额沿用本单已建订单的结果，不会重新报价；要改打印参数，只能重新下单，从选文件那一步重走一遍。」芯片「收款码过期 / 订单未关闭 / 可重新出码 / 金额已锁定」。主按钮「重新发起支付」，回到等待扫码，不自动付款。不预画微信或支付宝按钮。成功只认演示事件 paid 代表的系统确认。' },
    render: () => {
      const mode = S().payMode === 'code' ? 'code' : 'qr';
      const expired = S().fmCash === 'expired';
      const checks = S().fmPayCheck || 0;
      const payN = S().fmPayN || 0;
      const checkLine = checks ? `<p class="fm-check" data-fm-n="${checks}">正在向支付渠道核实这一次的结果。这一次还没有确认到账。</p>` : '';
      const frame = expired
        ? `<div class="d3-qrframe fm-exp"><b class="d3-qrt">屏上收款码已过期</b><p>已经确认这张收款码已经失效。<b>订单本身还在，可以重新出一张码。</b></p><p>这和「订单已超时关闭」不是一回事：那种情况订单已经关了，不能再出码。</p><p>这一单<b>已经创建过支付尝试</b>：金额沿用本单已建订单的结果，不会重新报价；要改打印参数，只能<b>重新下单</b>，从选文件那一步重走一遍。</p><div class="kwrow"><span class="chip clay">收款码过期</span><span class="chip">订单未关闭</span><span class="chip">可重新出码</span><span class="chip">金额已锁定</span></div><div class="fm-facts"><div><span>收款码状态</span><b>已过期（已经确认）</b></div><div><span>订单状态</span><b>未关闭，可重新出码</b></div><div><span>金额</span><b>沿用本单已建订单，不会重新报价</b></div></div></div>`
        : (mode === 'qr'
          ? `<div class="d3-qrframe waiting"><b class="d3-qrt">请扫码支付</b>${UI.qr(11, 400)}<b>这张码属于本次订单，支付主体与金额以手机端展示为准</b><p>支付尝试已经创建。请勿切换方式、重复付款或重新下单。收款码 5 分钟内有效。</p>${checkLine}</div>`
          : `<div class="d3-qrframe"><b>请把付款码对准扫码区</b><p>机器扫你的付款码。屏幕不回显这串码。</p>${checkLine}</div>`);
      return F({
        band: { kind: 'compact', eyebrow: '打印文件 · 订单支付', title: '请完成这笔支付', sub: '选择已开通的支付通道；确认到账后才会开始打印', seal: null, place: ' ', status: expired ? { text: '收款码已过期', warn: 1 } : { text: '等待支付 · 未确认', warn: 1 } },
        cls: 'd3-cashier',
        body: `<p class="d3-chline"><b>这台机器只启用了一个支付通道，已自动采用</b>测试支付通道 · 非真实收款</p>
          <div class="seg" data-fm-n="${payN}">
            <button aria-pressed="${mode === 'qr' ? 'true' : 'false'}" data-d3="pay" data-v="qr">我用手机扫码付</button>
            <button aria-pressed="${mode === 'code' ? 'true' : 'false'}" data-d3="pay" data-v="code">出示付款码给机器扫</button>
          </div>
          <div class="sumcard"><div class="r"><span>订单号</span><b>ORD-20261026-0418</b><span></span></div><div class="r"><span>内容</span><b>毕业生就业推荐表（已填写）<span class="d3-ext">.pdf</span> · 2 张 · 黑白</b><span></span></div><div class="r"><span>应付</span><b>2.00 元</b><span></span></div></div>
          ${frame}
          <button class="btn sec" data-go="home" style="height:80px;align-self:flex-start;min-width:240px">退出支付</button>`,
        dock: { back: false, left: `<button class="btn sec" data-go="confirm">${icon('chevL', 30, 2.4)}返回确认页</button>`, ask: '问小青：这笔账看不懂', pri: expired ? { label: '重新发起支付', id: 'fmReissue' } : { label: '刷新付款结果', id: 'fmRefresh' } }, nav: null, navAdvisor: 1
      });
    },
    demo: [{ label: '演示：付款成功', ev: 'paid' }, { label: '演示：收款码过期', ev: 'expired' }],
    mount: (el) => {
      const on = (e) => {
        const b = e.target.closest('[data-d3="pay"]');
        if (b && el.contains(b)) {
          e.stopPropagation();
          S().payMode = b.dataset.v;
          S().fmPayN = (S().fmPayN || 0) + 1;
          window.__proto.refresh();
          return;
        }
        if (e.target.closest('#fmRefresh') && el.contains(e.target)) {
          e.stopPropagation();
          S().fmPayCheck = (S().fmPayCheck || 0) + 1;
          window.__proto.refresh();
          return;
        }
        if (e.target.closest('#fmReissue') && el.contains(e.target)) {
          e.stopPropagation();
          S().fmCash = '';
          S().fmPayCheck = 0;
          window.__proto.refresh();
        }
      };
      const onDemo = (e) => {
        if (e.detail === 'paid') window.go('printing');
        else if (e.detail === 'expired') { S().fmCash = 'expired'; window.__proto.refresh(); }
      };
      el.addEventListener('click', on);
      el.addEventListener('proto-demo', onDemo);
      return () => { el.removeEventListener('click', on); el.removeEventListener('proto-demo', onDemo); };
    }
  });

  add('sign', '打印扫描', '签名（默认关闭）', {
    notes: {
      does: '对应 /print-scan/sign。controlsOn 为假时整页写本机暂未开通。开通且未登录先去登录。开通且已登录从选 PDF 开始。',
      motion: '签名大小用缩放，只动 transform。',
      keep: '关闭页照未开通：签名三步（选 PDF、传签名图、放置）都标「本机暂未开通」，去处是打印扫描和查政策，主按钮仍回 print，不进帮助页。屏上不写运行页标题。开通后：手机或我的文档选 PDF，手机传 JPG/PNG，放置页有页码、九宫格、15/25/35%、授权原句、电子签名声明。九宫格和大小收在「更多设置」。没勾授权不能生成。生成后等演示事件 done，不自己成功。结果「去材料检查」去 pii。再加一处会换成新 PDF 并清空签名图。原 PDF 永不改写。不收公章和圆章。U 盘按钮在但停用。不放固定人名；放置帧示例文件名只在这一步已经有上传时出现。登录过期、维护、未登记、读取中用 fsSign。小青不可用时手动路径仍在。号码与服务时间从后台读，读不到不显示。放置约 3 分钟、结果约 1 分 30 秒清除。'
    },
    demo: () => window.FS.signDemo(),
    render: () => window.FS.sign(),
    mount: (el) => window.FS.mount(el)
  });

  /* ═════════ 受控与扩展 ═════════ */
  add('contract', '受控与扩展', 'AI 签约风险提示（默认关闭）', {
    notes: {
      does: '运行页 /contract-review。机构开通后才从简历服务台「签约与权益」进来。选合同类型、手机扫码上传、勾选同意，开始分析后进入 contract-wait，不直接进结果。',
      motion: '文件到达、同意书加载、上传受理都等演示事件。开始风险分析只进入上传中，演示 accepted 才进处理中。',
      keep: '默认画开通后的上传页，不因 controlsOn 跳首页。运行页深链在未开通时回首页，只写在 notes。未开通变体 fyOff：四类合同、扫码上传、开始分析逐项「本机暂未开通」，出口是打印扫描、查政策、回首页。一体机只有手机通道，单个不超过 10MB；桌面 15MB 不在这页。PDF 不超过 50 页，OCR 不超过 20 页。原件最长 2 小时，报告 90 天，两套期限分开写。类型全称「竞业限制协议」。上传页不列 14 类，14 类只写在 notes。同意句是「我已阅读上述说明，同意本次合同文件用于 AI 签约风险分析」。AI 停用写「AI 现在停用，签约风险提示暂时做不了。合同原件可以到打印扫描里直接打印。」并给「去打印扫描」，开始分析保持不可用。问小青留在底栏；运行页这壳没有底栏导航，稿也不加导航。屏上不写开发用语。普通页 3 分钟。号码与服务时间从后台读，读不到不显示。'
    },
    demo: () => window.FY.demo('contract'),
    render: () => window.FY.render('contract'),
    mount: (el) => window.FY.mount('contract', el)
  });

  add('contract-result', '受控与扩展', 'AI 签约风险提示：结果', {
    notes: {
      does: '运行页 /contract-review/result。优先核查、关注、信息不足按本次结果数组计数。保存、结束并删除、重新审查都是本屏动作，等演示事件回报。',
      motion: '确认保存后停在「正在保存」。删除和重新审查都是再点一次确认，然后等删除回报，不在点击时宣布成功。',
      keep: '标识用原句「本结果由 AI 生成，仅供参考，只提示需要核对的条款」。零风险项写「未发现明显风险项」。部分覆盖写「合同页数超出分析上限，本次分析为部分覆盖，请对照纸质原件核查后续条款」。未找到结果时「未找到审查结果」，出口是重新上传和去打印扫描。未登录不能保存，句是「保存到「我的文档」需要先登录本人会员账号」，另给去登录。保存确认框是「暂不保存 / 确认保存 90 天」。保存失败不进打印或收费。删除失败写明仍可能处于短期保留。会话剩余时间按到期时刻算，稿不写死分钟，屏上不写倒计时；到期写「这次办理已到期」。条目旁只用胶囊「示例」。默认画开通后的结果。运行页深链在未开通时回首页，只写在 notes。未开通变体 fyOff 逐项「本机暂未开通」，出口是打印扫描、查政策、回首页。AI 停用时结果仍可看，问小青进 xq 由那一页退化。无底栏导航。结果页闲置 1 分 30 秒。号码与服务时间从后台读，读不到不显示。'
    },
    demo: () => window.FY.demo('contract-result'),
    render: () => window.FY.render('contract-result'),
    mount: (el) => window.FY.mount('contract-result', el)
  });

  add('toolbox', '受控与扩展', '百宝箱（按机构配置）', {
    notes: {
      does: '运行页 /toolbox。检查中没有任何按钮。未开启只有返回首页。已开启但没有条目是待配置。可启动项按 launchMode：站内进对应屏，二维码开层，外链先离场确认。',
      motion: '继续打开只把本屏改成「已确认离场」，不打开第三方，也不报已办理。',
      keep: '默认画开通后的四项。条目旁只用胶囊「示例」，屏上不写「运行时读机构配置」。就业办事指南进 help，材料领取码域名 pickup.example.com，外部办事入口域名 service.example.com，更多扩展停用并写即将上线。外链层写明不收集第三方页面信息、不记录办理结果。继续打开只显示「已确认离开本机办理」，不打开第三方，也不报已办理。运行页会匿名上报已确认离场，稿不模拟上报成功，这句话只写在 notes。检查中没有任何按钮，用浅灰条「正在读取」。空列表是待配置，出口为打印扫描、查政策、回首页。未开通变体 fyOff 逐项「本机暂未开通」。运行页深链在未开通时回首页，只写在 notes。问小青留在底栏；运行页无底栏导航，稿也不加。首页第三排要在机构开通时加「百宝箱」进这屏，本区不改首页。AI 停用时站内入口仍在，问小青进 xq 退化。未登录不挡浏览。普通页 3 分钟。号码与服务时间从后台读，读不到不显示。'
    },
    demo: () => window.FY.demo('toolbox'),
    render: () => window.FY.render('toolbox'),
    mount: (el) => window.FY.mount('toolbox', el)
  });

  add('smart-campus', '受控与扩展', '智慧校园（按机构开通）', {
    notes: {
      does: '运行页 /smart-campus。检查中没有任何按钮。未开启只有返回首页。六张卡去六个去处：迎新指引、行李帮运、VR校园、校园卡、一卡通、校园网。前三张看模块开关。',
      motion: '模块关闭时那三张不出现。扩展应用只在机构有配置时出现。',
      keep: '默认画开通后的六项。徽章按实际张数写「可查看 N 项」，有扩展才加「另有 1 个入口」，不写死 6。扩展进 help，旁只用胶囊「示例」。页底写「统计数字暂不在这里展示」和「实际办理请到学校窗口或学校自己的平台」。检查中没有任何按钮，用浅灰条「正在读取」。未开通变体 fyOff：六项逐项「本机暂未开通」，出口是打印扫描、查政策、回首页。运行页深链在未开通时回首页，只写在 notes。模块关闭时前三张不出现，并写明还没开通。问小青留在底栏；运行页没有问小青和底栏导航，稿只加这一句、不加导航。首页第三排要在机构开通时加「智慧校园」进这屏，本区不改首页。AI 停用、未登录都不挡指引。普通页 3 分钟。号码与服务时间从后台读，读不到不显示。'
    },
    demo: () => window.FY.demo('smart-campus'),
    render: () => window.FY.render('smart-campus'),
    mount: (el) => window.FY.mount('smart-campus', el)
  });

  add('campus-svc', '受控与扩展', '智慧校园：办理指引', {
    notes: {
      does: '运行页 /smart-campus/service/:key。同一屏用 fySvc 区分校园卡、一卡通、校园网、行李帮运、VR校园。未知 key 写「未找到该服务」。模块关闭时行李和 VR 进不去。',
      motion: '证件照是停用按钮，不导航。入学材料去 print-src，对应运行页 /print/upload。',
      keep: '默认画开通后的办理指引（校园卡）。校园卡、一卡通、校园网三页的协助句是「需要帮助？拨打服务电话 183-6916-1921」，号码与服务时间从后台读，读不到不显示，这句话只写在 notes、不上屏。不写具体楼栋，不写校方审核。眉题「办理指引」，不写「未接入」。未知 key 写「没有这项服务」，出口是返回智慧校园和回首页。总开关未开通是 fyOff，逐项「本机暂未开通」，出口是打印扫描、查政策、回首页。运行页深链在未开通时回首页，只写在 notes。模块关闭时行李和 VR 同样走未开通。迎新是另一屏 campus-welcome。问小青留在底栏，运行页没有这条，稿只加与本步相关的一句。无底栏导航。AI 停用仍可看指引。普通页 3 分钟。'
    },
    demo: () => window.FY.demo('campus-svc'),
    render: () => window.FY.render('campus-svc'),
    mount: (el) => window.FY.mount('campus-svc', el)
  });

  window.SCREEN_GROUPS = ['公共', '改简历', '练面试', '打印扫描', '查政策', '我的', '受控与扩展'];
})();
