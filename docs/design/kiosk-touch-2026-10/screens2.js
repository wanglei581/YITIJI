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

  /* ═════════ 公共 / 系统 ═════════ */
  add('session-resume', '公共', '继续打印任务', {
    notes: { does: '登录后先告诉人：还有几个打印任务没办完，点一下接着办。首页和「我的」用同一页。', motion: '卡片依次浮入。', keep: '只列本人未完成的打印任务；待付款去收银台，其余去打印进度；支付处理中不判成功或失败；这页不新建、不删除订单。' },
    render: () => gate({ eyebrow: '继续打印任务', what: '没办完的打印' }) || F({
      band: { eyebrow: '继续打印任务', title: '你还有 2 个打印可以接着办', sub: '只显示你本人的打印任务；不能继续的会写明', seal: 'idle' },
      body: `<div class="stack">
          ${row({ cls: 'big', lead: lead('ticket', 'teal'), t: '简历（改后）.pdf、成绩单.pdf', m: '等待领取 · 3 张 · 订单尾号 0927 · 今天 13:48', tail: '<span class="chip">等待领取</span>', extra: acts([{ l: '去打印进度', k: 'pri', go: 'printing', i: 'arrowR' }]) })}
          ${row({ cls: 'big', lead: lead('clock', 'clay'), t: '毕业生就业推荐表.pdf', m: '支付处理中 · 2 张 · 今天 13:20 · 付款结果以系统确认为准', tail: '<span class="chip clay">支付处理中</span>', extra: acts([{ l: '去看付款结果', k: 'pri', go: 'cashier', i: 'arrowR' }]) })}
          ${row({ cls: 'big mute', lead: lead('alert', 'mute'), t: '成绩单.pdf', m: '不可继续 · 1 张 · 订单尾号 0911 · 10 月 23 日 · 要打印请重新传文件', tail: '<span class="chip mute">不可继续</span>', extra: acts([{ l: '不能继续', dis: 1 }]) })}
        </div>
        <div class="howto">${icon('clock', 34, 2)}<span>已经完成的订单不在这里，在「我的 → 打印订单」里。这一页不会替你重新下单，也不会删订单。</span></div>
        <div class="grid2">${tile({ go: 'print', icon: 'printer', title: '直接办新的', desc: '去打印扫描' })}${tile({ go: 'pickup', icon: 'ticket', tone: 'slate', title: '手机上已经下过单', desc: '输入到机码取件' })}</div>
        ${fine('示例数据')}`,
      dock: { ask: '问小青：刚下的单怎么看不到？' }, nav: 'me'
    })
  });

  add('offline', '公共', '机器状态（网络断了）', {
    notes: { does: '网络或设备出问题时，逐项说清哪一项好、哪一项坏、哪一项读不到，以及现在还能办什么。', motion: '「正在自动重连」的圆圈转动；连上后回到刚才那一页。', keep: '真正检测的只有联网和打印机，其余写「随办理时确认」或「暂未开通」；读不到不写成离线，也不写成正常；不预告恢复时间；已交的打印不取消，到机码照常有效。' },
    render: () => F({
      band: { eyebrow: '机器状态', title: '和服务器连不上', sub: '我们已经收到提醒。已经交给打印机的任务不会取消。', seal: null, status: { text: '网络中断', warn: 1 } },
      body: `<div class="statgrid">${[['联网', '连不上', 'cin'], ['本机程序', '正常运行', ''], ['打印机', '这次没读到', 'clay'], ['扫描件的存放', '办理时确认', 'ghost2'], ['U 盘读取', '暂未开通', 'ghost2'], ['付款', '办理时确认', 'ghost2'], ['AI 服务', '现在用不了', 'clay'], ['机构官方渠道', '现在用不了', 'clay']].map(s => `<div class="sti"><span>${s[0]}</span><b class="${s[2]}">${s[1]}</b></div>`).join('')}</div>
        <div class="remind">${icon('alert', 34, 2.2)}<span>现在用不了：传文件、算价格、AI。到机码照常有效，已交的打印任务会接着出纸。</span></div>
        <div class="grid2">${tile({ go: 'copy', icon: 'copy', title: '复印证件', desc: '在打印机面板上操作，不需要网络' })}${tile({ go: 'help', icon: 'help', title: '帮助与求助', desc: '常见问题、服务电话' })}</div>
        <div class="livebox"><span class="spin"></span><div><b>正在自动重新检测</b><small>连上后回到你刚才那一页；不预告什么时候好</small></div></div>
        ${fine('需要帮助：服务电话 183-6916-1921（工作日 9:00–18:00）')}`,
      dock: { back: false, ask: false, left: `<button class="btn sec" data-act="toast" data-arg="演示：重新检测">${icon('refresh', 30, 2.2)}重新检测</button>`, pri: { label: '回到首页', go: 'home', kind: 'pri wide' } }, nav: 'home'
    })
  });

  add('route-error', '公共', '这一页打不开', {
    notes: { does: '任何一页出错、或者从旧链接进到不存在的入口时显示：说清这次没办完，给两条自助出路。', motion: '静止，不做提醒动画。', keep: '只说「这次操作没有完成」，不猜原因、不说已保存；出错页和「页面不存在」共用这一屏；重新打开和回首页都要有；不写找工作人员。' },
    render: () => F({
      band: { eyebrow: '页面出错', title: '这一页暂时打不开', sub: '这次操作没有完成。已经交给打印机的任务会照常出纸。', seal: null, status: { text: '页面出错', warn: 1 } },
      body: `${slab({ i: 0, row: 1, act: 'toast', arg: '演示：重新打开这一页', title: '重新打开这一页', desc: '多数情况重新打开就好', take: '回到刚才那一步', vis: `<div class="errvis teal">${icon('refresh', 72, 2)}</div>` })}
        ${slab({ i: 1, row: 1, go: 'home', title: '回到首页重新选', desc: '从旧链接或收藏进来的，入口可能已经调整', take: '首页的四件事', vis: `<div class="errvis slate">${icon('home', 72, 2)}</div>` })}
        <div class="howto">${icon('help', 34, 2)}<span>重新打开还是不行：换一种方式办（比如改用手机传文件），或者问小青、打服务电话。</span></div>
        <div class="grid2">${tile({ go: 'help', icon: 'help', title: '帮助与求助', desc: '常见问题、服务电话' })}${tile({ go: 'offline', icon: 'wifi', tone: 'slate', title: '看机器状态', desc: '联网、打印机逐项看' })}</div>
        ${fine('需要帮助：服务电话 183-6916-1921（工作日 9:00–18:00）')}`,
      dock: { back: false, ask: '问小青：刚才那一步怎么办？' }, nav: 'home'
    })
  });

  add('legal', '公共', '用户服务协议 / 隐私政策', {
    notes: { does: '大字读协议：左边章节、右边当前一章，翻章节不翻页面。', motion: '切换章节时正文淡入。', keep: '只有「用户服务协议」「隐私政策」两份；正文从后台取，取到之前不显示条款；取不到时说取不到、可以重试；本机留存文本要标「不作为正式版本」。' },
    render: () => F({
      band: { kind: 'compact', eyebrow: '协议与政策', title: '用户服务协议', sub: '共 7 章 · 版本和发布日期以后台正式版本为准（下面是示意文字）', seal: null },
      body: `<div class="seg"><button aria-pressed="true">用户服务协议</button><button aria-pressed="false" data-act="seg">隐私政策</button></div>
        <div class="legal">
          <div class="toc">${['一、我们是谁', '二、在这台机器上能做什么', '三、你交来的文件怎么处理', '四、AI 生成的内容', '五、费用', '六、你的权利', '七、联系我们'].map((t, i) => `<button class="${i === 2 ? 'on' : ''}" data-act="toast" data-arg="演示：跳到${t}">${t}</button>`).join('')}</div>
          <div class="ltext"><span class="chip clay">示意文字，不是正式条款</span><h3>三、你交来的文件怎么处理</h3>
            <p>你通过手机、U 盘或扫描交给这台机器的文件，只用于你这一次办理的事。</p>
            <p>办完、点「结束本次办理」，或者离开一段时间没有操作，这台机器上的文件和记录会被清除。</p>
            <p>登录后保存到「我的」的简历和文档，按保存期限保留，你也可以随时删除。</p></div></div>
        <div class="pager"><button data-act="toast" data-arg="演示：上一章" aria-label="上一章">${icon('chevL', 30, 2.4)}</button><span>第 3 章 / 共 7 章</span><button data-act="toast" data-arg="演示：下一章" aria-label="下一章">${icon('chevR', 30, 2.4)}</button></div>`,
      dock: { ask: '问小青：这一章是什么意思？' }, nav: null
    })
  });

  const phone = (o) => `<div class="phonepage"><div class="pcap"><div class="eyebrow">${o.k}</div><h1>${o.t}</h1><p>${o.s}</p></div>
    <div class="pframe"><div class="pscreen"><div class="ptop"><span class="pm">职</span><b>职易达</b><span class="pc">${o.top}</span></div><div class="pbody">${o.body}</div></div></div></div>`;
  add('phone-upload', '公共', '手机上：传文件', {
    notes: { does: '手机扫一体机上的码后看到的页面：选文件、看上传进度，传完回一体机确认。', motion: '上传进度条按真实进度走；传完出现对勾。', keep: '写明 PDF、JPG、PNG，单个 10MB；码过期、格式不对、结果不确定各有说法；手机页只说「已传到一体机」，不说打印好了。不计入一体机竖屏页数。' },
    render: () => phone({ k: '手机上的页面 · 扫一体机屏幕上的码后打开', t: '把文件传到一体机', s: '这一页在用户自己的手机上显示（390×844），这里放大展示。', top: '9:12 后失效',
      body: `<div class="pcard ok"><b>已连接一体机</b><small>就业服务大厅 · 传完回到一体机继续</small></div>
        <button class="ppick" data-act="toast" data-arg="演示：打开手机文件选择">${icon('plus', 26, 2.4)}选择手机里的文件</button>
        <p class="pnote">支持 PDF、JPG、PNG，单个不超过 10MB。Word、WPS、手机 HEIC 照片请先转成 PDF 或 JPG。</p>
        <div class="pfile"><span class="ft">PDF</span><div><b>毕业生就业推荐表（已填写）.pdf</b><small>312 KB · 已传到一体机</small><i class="pbar"><i style="width:100%"></i></i></div><span class="pok">${icon('check', 20, 3)}</span></div>
        <div class="pcard"><b>请回到一体机屏幕</b><small>确认要不要用这份文件。还要传别的可以接着选。</small></div>
        <div class="pfoot">文件只用于这次办理，办完会清除</div>` })
  });
  add('phone-login', '公共', '手机上：确认登录', {
    notes: { does: '手机扫一体机上的登录码后，在手机上输手机号和验证码确认。', motion: '发送验证码后按钮显示倒计时。', keep: '验证码发送有次数限制；码过期、旧码要说清楚；手机页不说「一体机已登录」，只说「已提交，回一体机看结果」。' },
    render: () => phone({ k: '手机上的页面 · 扫一体机上的登录码后打开', t: '在手机上确认登录', s: '这一页在用户自己的手机上显示（390×844），这里放大展示。', top: '4:51 后失效',
      body: `<div class="pcard"><b>你正在登录一体机</b><small>就业服务大厅 · 只管这一次，离开会自动退出</small></div>
        <label class="plab">手机号</label><div class="pinput">138 0000 6721</div>
        <label class="plab">验证码</label><div class="prow2"><div class="pinput">5 2 8 1 _ _</div><button class="pbtn ghost" data-act="toast" data-arg="演示：验证码倒计时">已发送 48s</button></div>
        <label class="pchk"><i>${icon('check', 16, 3)}</i>我已阅读并同意《用户服务协议》《隐私政策》</label>
        <button class="pbtn" data-act="toast" data-arg="演示：提交后回一体机看结果">确认登录</button>
        <div class="pcard"><b>提交后请回到一体机</b><small>一体机屏幕上会显示是否登录成功。</small></div>` })
  });

  /* ═════════ 我的 ═════════ */
  add('notifications', '我的', '消息通知', {
    notes: { does: '本人的消息：打印、AI 服务、反馈、维护、公告、系统六类；没有的类写「暂无」。', motion: '未读圆点；标为已读时淡出。', keep: '只显示已经发生的事；不造消息、不推广告；只有反馈回复能跳到反馈页，其余消息只能标已读或删除。' },
    render: () => gate({ eyebrow: '我的 · 消息', what: '消息' }) || F({
      band: { eyebrow: '我的 · 消息', title: '2 条未读消息', sub: '只有你本人能看到', seal: null },
      body: `<div class="kinds">${[['printer', '打印', 1], ['sparkle', 'AI 服务', 1], ['message', '反馈', 1], ['clock', '维护', 1], ['landmark', '公告', 0], ['shield', '系统', 1]].map(k => `<div class="kd ${k[2] ? '' : 'none'}"><span>${icon(k[0], 30, 2)}</span><b>${k[1]}</b><small>${k[2] ? k[2] + ' 条' : '暂无'}</small></div>`).join('')}</div>
        <div class="stack">${[['printer', '打印完成', '简历（改后）.pdf 已出纸 1 张', '今天 14:12', 1, ''], ['message', '你的反馈有回复', '「U 盘读不出来」：已处理，可以再试一次', '今天 11:05', 1, 'feedback'], ['sparkle', '简历诊断报告已生成', '「李佳怡-简历-2026秋招」：找到 5 处可以改的地方', '今天 10:31', 0, ''], ['clock', '系统维护', '10 月 28 日上午维护约 1 小时', '10 月 21 日', 0, ''], ['shield', '隐私请求', '撤回 AI 使用授权已记录', '10 月 20 日', 0, '']].map(n => row({ cls: n[4] ? 'unread' : '', lead: lead(n[0]), t: n[1], m: n[2], tail: `<span class="rt">${n[3]}</span>`, extra: n[5] ? acts([{ l: '去看看', go: n[5] }]) : '' })).join('')}</div>
        ${fine('示例数据')}`,
      dock: { ask: false, pri: { label: '全部标为已读', act: 'toast', arg: '演示：全部标为已读', noArrow: 1 } }, nav: 'me'
    })
  });

  add('my-resumes', '我的', '我的简历', {
    notes: { does: '保存的简历分两类：上传诊断的、AI 生成的；各自能做的事不同。', motion: '卡片依次浮入；删除要再点一次确认。', keep: '列表不显示简历原文和诊断正文；生成的简历只能「查看并打印」，对照前要先导出再上传诊断；写清保存期限。' },
    render: () => gate({ eyebrow: '我的 · 简历', what: '简历' }) || F({
      band: { eyebrow: '我的 · 简历', title: '你保存的 3 份简历', sub: '只显示名称和状态，不在列表里显示简历内容', seal: null },
      body: `<div class="stack">
          ${row({ cls: 'big', lead: `<div class="rthumb">${icon('file', 56, 1.6)}</div>`, t: '李佳怡-简历-2026秋招', m: '上传诊断 · 已完成 · 保留至 2027 年 1 月 23 日', tail: '<span class="chip">已完成</span>', extra: acts([{ l: '查看报告', k: 'pri', go: 'diagnosis' }, { l: '继续优化', go: 'optimize' }, { l: '简历对照', go: 'jobfit' }, { l: '删除', i: 'erase' }]) })}
          ${row({ cls: 'big', lead: `<div class="rthumb">${icon('sparkle', 56, 1.6)}</div>`, t: '新媒体运营-生成的简历', m: 'AI 生成 · 已完成 · 保留至 2027 年 1 月 20 日', tail: '<span class="chip">已完成</span>', extra: acts([{ l: '查看并打印', k: 'pri', go: 'gen-preview' }, { l: '简历对照', dis: 1 }, { l: '删除', i: 'erase' }]) + '<p class="rsum">生成的简历要先导出、再上传诊断，才能做对照</p>' })}
          ${row({ cls: 'big', lead: `<div class="rthumb">${icon('file', 56, 1.6)}</div>`, t: '简历-旧版（拍照）', m: '上传诊断 · 失败 · 这次没读出文字，可以换清楚一点的文件再传', tail: '<span class="chip clay">失败</span>', extra: acts([{ l: '重新上传', k: 'pri', go: 'resume-src' }, { l: '删除', i: 'erase' }]) })}
        </div>
        <button class="addrow" data-go="resume-src">${icon('plus', 34, 2.4)}<span><b>再传一份简历</b><small>手机、U 盘或纸质扫描</small></span></button>
        <div class="howto">${icon('clock', 34, 2)}<span>到期后自动删除，不再保留副本。也可以随时自己删除。</span></div>
        ${fine('示例数据')}`,
      dock: { ask: '问小青：哪一份更好？' }, nav: 'me'
    })
  });

  add('my-orders', '我的', '我的打印订单', {
    notes: { does: '本人的打印订单：状态、张数、付款摘要；能看详单、反馈问题。', motion: '进行中的订单每 5 秒自动刷新，状态胶囊颜色区分。', keep: '状态只写系统记录（排队中、已领取、打印中、已完成、失败、已取消）；0 元写「0 元（免费试运营）」；没有实付记录写「未记录」，不推算；再打印会新建订单。' },
    render: () => gate({ eyebrow: '我的 · 打印订单', what: '打印订单' }) || F({
      band: { eyebrow: '我的 · 打印订单', title: '你的 3 笔打印订单', sub: '进行中的订单会自动刷新', seal: null },
      body: `<div class="seg"><button aria-pressed="true">全部</button><button aria-pressed="false" data-act="seg">进行中</button><button aria-pressed="false" data-act="seg">已完成</button><button aria-pressed="false" data-act="seg">失败</button><button aria-pressed="false" data-act="seg">已取消</button></div>
        <div class="stack">
          ${row({ cls: 'big', lead: lead('printer', 'teal'), t: '简历（改后）.pdf · 1 份 · 黑白', m: '订单尾号 0927 · 0 元（免费试运营）· 今天 13:48', tail: '<span class="chip">打印中</span>', extra: acts([{ l: '看详单' }, { l: '反馈问题', go: 'feedback' }]) })}
          ${row({ cls: 'big', lead: lead('check'), t: '毕业生就业推荐表.pdf · 1 份 · 黑白', m: '订单尾号 0911 · 0 元（免费试运营）· 今天 11:20', tail: '<span class="chip">已完成</span>', extra: acts([{ l: '看详单' }, { l: '再打一份', go: 'confirm' }]) })}
          ${row({ cls: 'big', lead: lead('alert', 'clay'), t: '面试练习报告.pdf · 1 份 · 黑白', m: '订单尾号 0876 · 10 月 22 日 · 打印机报告失败', tail: '<span class="chip clay">失败</span>', extra: acts([{ l: '看详单' }, { l: '反馈问题', go: 'feedback' }]) })}
        </div>
        <div class="howto">${icon('refresh', 34, 2)}<span>进行中的订单每 5 秒自动刷新一次。再打一份会新建一张订单。</span></div>
        ${fine('示例数据 · 到机码在详单里 · 在手机「我的 → 打印订单」里也能看到')}`,
      dock: { ask: '问小青：失败的订单怎么办？', pri: { label: '去打印', go: 'print' } }, nav: 'me'
    })
  });

  add('my-docs', '我的', '我的文档', {
    notes: { does: '保存的文档：查看、打印、改保存期限、删除。', motion: '缩略图浮入；删除要再点一次确认。', keep: '保存期限写清楚（3 个月、6 个月、长期等）；到期后不能恢复；没登录时生成的文件不会进来。' },
    render: () => gate({ eyebrow: '我的 · 文档', what: '文档' }) || F({
      band: { eyebrow: '我的 · 文档', title: '你保存的 4 个文档', sub: '没登录时生成的文件不会存到这里', seal: null },
      body: `<div class="grid2">${[['成绩单-扫描件.pdf', 'PDF · 412 KB · 保存 3 个月', UI.stack(140, 2)], ['获奖证书-合成.pdf', 'PDF · 1.6 MB · 保存 6 个月', UI.stack(140, 3)], ['求职信-新媒体运营.pdf', 'PDF · 96 KB · 保存 3 个月', UI.resume(112, 'plain')], ['材料清单-求职补贴.pdf', 'PDF · 64 KB · 短期保存', UI.checklist(112)]].map((d, i) => `<div class="doccard rise" style="--i:${i}"><div class="dthumb">${d[2]}</div><b>${d[0]}</b><small>${d[1]}</small>${acts([{ l: '打印', k: 'pri', go: 'confirm', i: 'printer' }, { l: '期限' }, { l: '删除', i: 'erase' }])}</div>`).join('')}</div>
        ${fine('示例数据 · 到期自动清理，清理后不能恢复')}`,
      dock: { ask: '问小青：保存期限怎么选？' }, nav: 'me'
    })
  });

  add('my-ai', '我的', 'AI 服务记录', {
    notes: { does: '本人用过哪些 AI 服务、什么时候、保留到哪天；可以删除。', motion: '列表浮入；删除要再点一次确认。', keep: '列表不显示原文、提示词和 AI 输出；托管 a 下不列岗位 AI 和招聘会准备单；模拟面试报告在练习记录里。' },
    render: () => gate({ eyebrow: '我的 · AI 服务记录', what: 'AI 服务记录' }) || F({
      band: { eyebrow: '我的 · AI 服务记录', title: '你用过 5 次 AI 服务', sub: '这里只记次数和时间，不显示内容', seal: null },
      body: `<div class="kinds">${[['sparkle', '简历诊断', 1], ['target', '简历对照', 1], ['map', '职业规划', 1], ['compass', '自我探索', 1], ['message', '小青作业', 1], ['mic', '模拟面试', 2]].map(k => `<div class="kd"><span>${icon(k[0], 30, 2)}</span><b>${k[1]}</b><small>${k[2]} 次</small></div>`).join('')}</div>
        <div class="stack">${[['sparkle', '简历诊断', '今天 13:30', '保留至 11 月 24 日'], ['target', '简历对照', '今天 13:52', '保留至 11 月 24 日'], ['map', '职业规划建议', '10 月 24 日', '保留至 11 月 23 日'], ['compass', '自我探索', '10 月 22 日', '保留至 11 月 21 日'], ['message', '小青作业', '10 月 22 日', '保留至 11 月 21 日']].map(r => row({ cls: 'mid', lead: lead(r[0]), t: r[1], m: r[2] + ' · 已完成 · ' + r[3], tail: `<button class="btn sec sm" data-act="toast" data-arg="演示：再点一次确认删除">${icon('erase', 26, 2.2)}删除</button>` })).join('')}</div>
        ${fine('示例数据 · 模拟面试的报告在「练面试 → 我的练习记录」')}`,
      dock: { ask: false }, nav: 'me'
    })
  });

  add('my-activity', '我的', '浏览与跳转记录', {
    notes: { does: '本人看过的内容、打开过的来源入口；求职进度是本人自己填的，入口还在建设。', motion: '列表浮入。', keep: '托管 a 下只留政策相关记录；只记浏览和打开，不记你在别的平台办了什么；空就是空。' },
    render: () => gate({ eyebrow: '我的 · 浏览记录', what: '浏览记录' }) || F({
      band: { eyebrow: '我的 · 浏览记录', title: '你看过的和打开过的', sub: '只记录浏览和打开，不记录你在别的平台办了什么', seal: null },
      body: `<div class="seg"><button aria-pressed="true">浏览记录</button><button aria-pressed="false" data-act="seg">外部跳转记录</button><button aria-pressed="false" data-act="seg">求职进度（本人自填）</button></div>
        <div class="stack">${[['高校毕业生一次性求职创业补贴', '浏览 · 政策 · 市人社局 · 今天 14:02'], ['离校未就业高校毕业生就业见习', '浏览 · 政策 · 市人社局 · 10 月 24 日'], ['灵活就业人员社保补贴', '浏览 · 政策 · 区就业服务中心 · 10 月 22 日']].map(r => row({ lead: lead('landmark', 'slate'), t: r[0], m: r[1], extra: acts([{ l: '再看一次', go: 'policy-detail' }, { l: '记录详情' }]) })).join('')}</div>
        <div class="howto">${icon('shield', 34, 2)}<span>这些记录只有你能看到。求职进度要你自己填，手填入口还在建设中。</span></div>
        ${fine('示例数据')}`,
      dock: { ask: false }, nav: 'me'
    })
  });

  add('my-fav', '我的', '我的收藏', {
    notes: { does: '收藏的内容。托管 a 下只剩政策，没有岗位、招聘会。', motion: '列表浮入。', keep: '不含投递或预约结果；空就是空；本机不代收简历。' },
    render: () => gate({ eyebrow: '我的 · 收藏', what: '收藏' }) || F({
      band: { eyebrow: '我的 · 收藏', title: '你收藏的 3 条政策', sub: '收藏只是方便下次再找', seal: null },
      body: `<div class="stack">${[['高校毕业生一次性求职创业补贴', '政策 · 收藏于 10 月 25 日'], ['离校未就业高校毕业生就业见习', '政策 · 收藏于 10 月 24 日'], ['灵活就业人员社会保险补贴', '政策 · 收藏于 10 月 22 日']].map(r => row({ cls: 'big', lead: lead('landmark', 'slate'), t: r[0], m: r[1], extra: acts([{ l: '查看政策', k: 'pri', go: 'policy-detail' }, { l: '取消收藏' }]) })).join('')}</div>
        <div class="howto">${icon('help', 34, 2)}<span>这台机器上只收藏政策。岗位、招聘会信息请看本机构官方渠道。</span></div>
        <div class="grid2">${tile({ go: 'policy', icon: 'landmark', tone: 'slate', title: '查看政策', desc: '本机构发布的' })}${tile({ go: 'official', icon: 'qr', tone: 'slate', title: '本机构官方渠道', desc: '扫码在手机上看' })}</div>
        ${fine('示例数据')}`,
      dock: { ask: false }, nav: 'me'
    })
  });

  add('my-benefits', '我的', '我的权益', {
    notes: { does: '本人领到的权益：名称、来源、有效期、还剩多少；只读。', motion: '卡片浮入。', keep: '不造券、不预判能不能用；抵扣功能尚未开放；补贴类只给政策说明和官方入口，不等于补贴已发放；没有权益也照常能用打印、AI 简历、政策指引。' },
    render: () => gate({ eyebrow: '我的 · 权益', what: '权益' }) || F({
      band: { eyebrow: '我的 · 权益', title: '你有 2 项权益', sub: '只读 · 抵扣功能尚未开放', seal: null },
      body: `<div class="stack">
          ${row({ cls: 'big', lead: lead('ticket', 'teal'), t: '免费打印次数', m: '来源：合作机构 · 有效期至 12 月 31 日 · 还剩 8 次 / 共 10 次', tail: '<span class="chip">可用</span>' })}
          ${row({ cls: 'big', lead: lead('landmark', 'slate'), t: '求职创业补贴资格提示', m: '来源：政府 · 不适用 · 仅提供政策说明、材料清单与官方入口', tail: '<span class="chip slate">只读</span>', extra: acts([{ l: '看政策说明', go: 'policy-detail' }]) })}
        </div>
        <div class="manual"><div class="olist-t" style="padding:0">没有权益也照常可用</div>${['打印与扫描', 'AI 简历服务', '就业政策与补贴指引'].map(t => `<div><i></i>${t}</div>`).join('')}</div>
        <button class="rowlink" data-go="activities">${icon('sparkle', 32, 2)}<span><b>看看有哪些活动</b> <small>· 领取权益</small></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button>
        ${fine('示例数据 · 权益不等于补贴已发放 · 是否收费以活动说明为准')}`,
      dock: { ask: false }, nav: 'me'
    })
  });

  add('activities', '我的', '权益活动', {
    notes: { does: '可以领取的权益活动列表；领取要登录。', motion: '卡片浮入；库存状态用胶囊区分。', keep: '活动只用于本机服务和打印辅助；不代表报名、签到或投递结果；未发布、已结束、已下架的不出现。' },
    render: () => F({
      band: { eyebrow: '权益活动', title: '现在可以领的 3 个活动', sub: '只用于这台机器的服务和打印', seal: 'idle' },
      body: `<div class="stack">${[['合作机构', '免费次数', '可领取', '秋招季免费打印 10 次', '登录后领取，在这台机器打印简历和材料时使用。', '至 12 月 31 日', 'teal'], ['校园', '套餐额度', '即将领完', '应届生材料打印套餐', '求职材料、成绩单等打印额度，剩余不多。', '至 11 月 30 日', 'clay'], ['平台', 'AI 次数', '可领取', 'AI 简历诊断加 3 次', '登录后领取，在这台机器上做简历诊断时使用。', '至 12 月 31 日', 'teal']].map((a, i) => `<button class="actcard rise" style="--i:${i}" data-go="activity-detail"><div class="chips2"><span class="chip slate">${a[0]}</span><span class="chip">${a[1]}</span><span class="chip ${a[6]}">${a[2]}</span></div><b>${a[3]}</b><span>${a[4]}</span><small>有效期 ${a[5]}</small><span class="go">${icon('arrowR', 30, 2.4)}</span></button>`).join('')}</div>
        <div class="howto">${icon('help', 34, 2)}<span>领到的权益在「我的 → 权益」里看。领取不代表报名、签到或投递。</span></div>
        <button class="rowlink" data-go="my-benefits">${icon('ticket', 32, 2)}<span><b>我的权益</b> <small>· 已领取的</small></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button>
        ${fine('示例数据')}`,
      dock: { ask: false, pri: S().logged ? null : { label: '登录后领取', go: 'login' } }, nav: 'me'
    })
  });

  add('activity-detail', '我的', '活动详情与领取', {
    notes: { does: '活动的额度、有效期、规则；领取后去「我的权益」。', motion: '领取成功出现对勾。', keep: '第 2 步写明「抵扣功能尚未开放」，不能画成下单时已能抵扣；不代表报名、签到、投递、面试或录用。' },
    render: () => F({
      band: { eyebrow: '权益活动 · 合作机构 · 免费次数', title: '秋招季免费打印 10 次', sub: '剩余 126 份 · 领取后在「我的 → 权益」查看', seal: null },
      body: `<div class="grid2"><div class="bigstat"><small>权益额度</small><b>10 次</b><span>每次打印用 1 次</span></div><div class="bigstat"><small>活动有效期</small><b>12 月 31 日</b><span>到期后未用完的作废</span></div></div>
        <div class="report-col"><h4>${icon('clipboard', 30, 2)}活动规则</h4><ul><li>每人限领一次，需要登录</li><li>只在这台机器使用</li><li>不能兑换现金，不能转让</li></ul></div>
        <div class="howto">${icon('help', 34, 2)}<span>领取成功后会加入「我的 → 权益」。现在还不能在下单时抵扣。</span></div>
        <div class="process">${[['check', '领取权益', '登录后点领取'], ['clock', '等待抵扣开放', '抵扣功能尚未开放'], ['eye', '查看余量', '在「我的 → 权益」']].map((p, k) => `<div class="ps"><span class="n">${k + 1}</span><span class="pi">${icon(p[0], 34, 2)}</span><b>${p[1]}</b><small>${p[2]}</small></div>`).join(`<span class="pa">${icon('arrowR', 28, 2.4)}</span>`)}</div>
        ${fine('示例数据 · 不代表报名、签到、投递或录用')}`,
      dock: { ask: false, pri: { label: S().logged ? '立即领取' : '登录后领取', go: S().logged ? 'my-benefits' : 'login' } }, nav: 'me'
    })
  });

  add('feedback', '我的', '意见反馈', {
    notes: { does: '登录后提交反馈，右边看处理进度和回复。', motion: '提交后出现对勾和「已提交」。', keep: '要登录；分类五种（设备使用、打印服务、文件处理、一般建议、AI 内容投诉）；AI 投诉写明答复期限，其他反馈不承诺结论和时限。' },
    render: () => gate({ eyebrow: '我的 · 意见反馈', what: '反馈记录' }) || F({
      band: { eyebrow: '我的 · 意见反馈', title: '遇到什么问题了？', sub: '处理进度和回复会发到「消息」里', seal: null },
      body: `<div class="fgroup">${sec('关于哪一类')}<div class="chips">${['设备使用', '打印服务', '文件处理', '一般建议', 'AI 内容投诉'].map((c, i) => `<button aria-pressed="${i === 0}" data-act="chip">${c}</button>`).join('')}</div></div>
        <div class="fgroup">${sec('说说情况', '可以说话填写')}<div class="txtarea">U 盘插上以后，屏幕一直显示「正在读取」，等了两分钟也没有出来。<button class="mic" data-act="toast" data-arg="演示：说话填写">${icon('mic', 36, 2.2)}</button></div></div>
        <div class="formgrid"><div class="ff"><label>标题 <em class="opt">选填</em></label><div class="fv">U 盘读不出来</div></div><div class="ff"><label>电话 <em class="opt">选填</em></label><div class="fv ph">方便回电时留，可以不填</div></div></div>
        <div class="fgroup">${sec('之前的反馈')}${row({ lead: lead('message'), t: '打印出来的字有点淡', m: '打印服务 · 10 月 22 日', tail: '<span class="chip">已回复</span>' })}${row({ lead: lead('message'), t: '希望能打印 A3', m: '一般建议 · 10 月 18 日', tail: '<span class="chip slate">已关闭</span>' })}</div>
        ${fine('着急的事请拨打服务电话 183-6916-1921（工作日 9:00–18:00）')}`,
      dock: { ask: false, pri: { label: '提交反馈', act: 'toast', arg: '演示：已提交，进度会发到「消息」' } }, nav: 'me'
    })
  });

  add('settings', '我的', '账号设置', {
    notes: { does: '只放已经做好的设置：换绑手机号、换一个账号登录、隐私与数据请求、AI 授权、协议、结束使用。', motion: '无。', keep: '读不到 AI 授权时不写成「未授权」；手机号只显示前三后四；注销和复制个人信息按《隐私政策》联系、15 个工作日内处理，一体机上不能直接提交。' },
    render: () => F({
      band: { eyebrow: '我的 · 账号设置', title: '账号设置', sub: S().logged ? '本人账号 138****6721 · 只在这台机器上有效' : '没有登录：下面几项登录后可用', seal: null },
      body: `${grp('账号', `<div class="glist">${gi({ icon: 'phone', t: '换绑手机号', d: S().logged ? '验证新号码后换绑' : '登录后可用', off: !S().logged })}${gi({ icon: 'user', t: '换一个账号登录', d: S().logged ? '会先退出当前账号' : '登录后可用', off: !S().logged })}${gi({ go: 'privacy', icon: 'lock', tone: 'slate', t: '隐私与数据请求', d: '撤回 AI 授权；导出、注销去哪办' })}</div>`)}
        ${grp('AI 使用授权', `<div class="glist">${S().logged ? `<div class="gi"><span class="ic">${icon('sparkle', 34, 2)}</span><span class="tx"><b>已授权 · 10 月 25 日</b><small>诊断、对照、规划会用到，随时可以撤回</small></span><span class="gacts"><button class="btn sec sm" data-act="toast" data-arg="演示：重新读取授权状态">${icon('refresh', 26, 2.2)}重新读取</button><button class="btn sec sm" data-go="privacy">撤回</button></span></div>` : gi({ icon: 'sparkle', t: '登录后可看', d: '读不到时不会写成「未授权」', off: 1 })}</div>`)}
        ${grp('协议', `<div class="grid2">${tile({ go: 'legal', icon: 'book', title: '用户服务协议', desc: '看全文' })}${tile({ go: 'legal', icon: 'shield', title: '隐私政策', desc: '看全文' })}</div>`)}
        <div class="howto">${icon('help', 34, 2)}<span>结束使用后：这台机器上的文件、记录和登录状态会清除；保存到「我的」的内容按保存期限保留。</span></div>
        ${fine('注销账号、复制个人信息请按《隐私政策》联系我们，15 个工作日内处理')}`,
      dock: { ask: '问小青：怎么注销账号？', mid: S().logged ? `<button class="btn danger" data-act="clear">${icon('logout', 30, 2.2)}结束使用并退出</button>` : '' }, nav: 'me'
    })
  });

  add('privacy', '我的', '隐私与数据请求', {
    notes: { does: '撤回 AI 使用授权当场记录；导出资料、注销账号在一体机上暂未开放，写清去哪办。', motion: '撤回时弹确认层；成功后状态变化。', keep: '一体机不提交导出、不下载、不注销；撤回不会删除简历、文档、订单、收藏；失败不提前显示成功；不造请求记录。' },
    render: () => gate({ eyebrow: '我的 · 隐私与数据请求', what: '隐私与数据请求' }) || F({
      band: { eyebrow: '我的 · 隐私与数据请求', title: '你的信息由你决定', sub: '撤回 AI 授权可以在这里办；其余两项按《隐私政策》联系我们', seal: null },
      body: `${row({ cls: 'big', lead: lead('sparkle', 'teal'), t: '撤回 AI 使用授权', m: '撤回后，用到 AI 的功能会停用', extra: acts([{ l: '撤回授权', k: 'danger', toast: '演示：确认撤回 AI 使用授权' }]) })}
        <div class="benefits">${[['sparkle', '撤回范围', '诊断、对照、规划等停用；简历、文档、订单、收藏都不删'], ['refresh', '再次使用', '以后再用 AI 功能，会重新请你同意'], ['clipboard', '记录', '每次撤回都会留一条申请记录']].map(b => `<div><span>${icon(b[0], 38, 2)}</span><b>${b[1]}</b><small>${b[2]}</small></div>`).join('')}</div>
        <div class="grid2">${tile({ act: 'toast', arg: '一体机未开放：请按《隐私政策》联系我们', icon: 'folder', title: '导出我的资料清单', desc: '一体机未开放', off: 1 })}${tile({ act: 'toast', arg: '暂未开放：请按《隐私政策》联系我们', icon: 'logout', title: '账号注销', desc: '暂未开放', off: 1 })}</div>
        <div class="fgroup">${sec('申请记录')}${row({ lead: lead('shield'), t: '撤回 AI 使用授权', m: '10 月 20 日申请', tail: '<span class="chip">已完成</span>' })}</div>
        <div class="howto">${icon('call', 34, 2)}<span>导出和注销：拨打服务电话 183-6916-1921，或按《隐私政策》里的邮箱联系，15 个工作日内处理。</span></div>
        ${fine('示例数据')}`,
      dock: { ask: '问小青：撤回授权会怎样？' }, nav: 'me'
    })
  });

  /* ═════════ 改简历：工具 ═════════ */
  add('templates', '改简历', '简历模板', {
    notes: { does: '先看版式和分区顺序，再决定去优化、去生成，还是直接打印现有简历。', motion: '选中时边框变绿、出现对勾；右侧说明淡入。', keep: '只是版式参考：不保存、不应用、不生成简历；模板来自后台发布，不拿内置模板顶替；不用示例图冒充你的简历预览。' },
    render: () => F({
      band: { eyebrow: '改简历 · 模板', title: '先看看版式', sub: '只是版式参考：不会替你生成或改动简历', seal: null },
      body: `<div class="seg"><button aria-pressed="true">全部 6</button><button aria-pressed="false" data-act="seg">简历模板</button><button aria-pressed="false" data-act="seg">通用</button></div>
        <div class="tplgrid">${[['清爽单栏', '应届生常用', 'plain', 1], ['左栏信息', '双栏 · 信息多也不挤', 'fixed', 0], ['正式', '单栏 · 适合有经验', 'plain', 0], ['紧凑', '一页放得下', 'fixed', 0], ['技能突出', '技术岗常用', 'plain', 0], ['作品优先', '设计、运营', 'plain', 0]].map((t, i) => `<button class="tpl rise ${t[3] ? 'on' : ''}" style="--i:${i}" data-act="toast" data-arg="演示：选中「${t[0]}」"><div class="tthumb">${UI.resume(140, t[2])}</div><b>${t[0]}</b><small>${t[1]}</small>${t[3] ? `<span class="tick">${icon('check', 26, 3)}</span>` : ''}</button>`).join('')}</div>
        <div class="howto">${icon('layout', 34, 2)}<span>「清爽单栏」的分区顺序：基本信息 → 个人总结 → 教育经历 → 实习经历 → 项目经历 → 技能 → 证书</span></div>`,
      dock: { ask: '问小青：哪个版式适合我？', mid: `<button class="btn sec" data-go="optimize">去优化</button>`, pri: { label: '用它生成新简历', go: 'scratch' } }, nav: null
    })
  });

  add('gen-preview', '改简历', '简历预览与核对', {
    notes: { does: '生成后先核对：整页预览 + 需要你确认的几处；确认了再打印或保存。', motion: '需要核对的地方依次高亮。', keep: '读回之前不显示简历内容；标「AI 建议稿」；没提供的经历不会出现；导出链接过期可以重新生成；导出失败说失败。' },
    render: () => F({
      band: { kind: 'compact', eyebrow: '从零写简历 · 第 6 步 / 共 6 步', title: '核对内容后带走', rail: { labels: ['想找的工作', '教育', '实习与工作', '校园经历', '技能证书', '核对生成'], now: 5 }, seal: null },
      body: `<div class="confgrid" style="grid-template-columns:420px 1fr"><div class="cthumb">${UI.resume(380, 'fixed')}<span>AI 建议稿 · 1 页 · 清爽单栏</span></div>
          <div class="manual"><div class="olist-t" style="padding:0">打印前请确认这几处属实</div>${['学校和在校时间', '实习单位、时间和你做的事', '推文数量：你填的是 48 篇', '技能：剪映、Excel'].map(t => `<div><i></i>${t}</div>`).join('')}<p class="fine left" style="margin:6px 0 0">都是你前面填写或说出来的内容，AI 只调整了说法</p></div></div>
        <div class="fgroup">${sec('带走的格式')}<div class="seg"><button aria-pressed="true">PDF</button><button aria-pressed="false" data-act="seg">打印纸质版</button></div></div>
        <div class="grid2">${tile({ go: 'scratch-1', icon: 'pen', title: '回去改', desc: '回到任意一步' })}${tile({ go: S().logged ? 'my-resumes' : 'login', icon: 'folder', tone: 'slate', title: '打开我的简历', desc: S().logged ? '已自动保存' : '需要登录' })}</div>
        ${fine('AI 不可用时，也能把你填的原话排成简历打印')}`,
      dock: { ask: '问小青：还能怎么写？', pri: { label: '核对好了，去打印', go: 'confirm', arg: 'resume' } }, nav: null
    })
  });

  add('materials', '改简历', '求职材料', {
    notes: { does: '选一种材料模板，填几项本人信息，生成 PDF。', motion: '选中模板时出现对勾。', keep: '按你填的内容套固定模板，不标成 AI 撰写；至少填姓名和目标岗位；没有真实文件不能进打印；没登录不进「我的文档」。' },
    render: () => F({
      band: { eyebrow: '改简历 · 求职材料', title: '要准备哪种材料？', sub: '选一个模板，填几项，生成 PDF 带走', seal: 'idle' },
      body: `<div class="chips">${['全部', '求职信', '感谢信', '作品集', '材料清单', '校招', '社招'].map((c, i) => `<button aria-pressed="${i === 1}" data-act="chip">${c}</button>`).join('')}</div>
        <div class="grid2">${[['求职信 · 校招通用', '一页 · 写给用人单位的自我介绍', 1], ['求职信 · 有实习经历', '一页 · 突出一段实习', 0], ['求职信 · 转行说明', '一页 · 说清为什么换方向', 0], ['求职信 · 简洁版', '半页 · 只写最关键的三点', 0]].map((t, i) => `<button class="tpl rise ${t[2] ? 'on' : ''}" style="--i:${i};flex-direction:row;text-align:left;gap:20px;align-items:center;min-height:196px" data-act="toast" data-arg="演示：选中模板"><div class="tthumb" style="flex:none;height:156px;width:128px">${UI.resume(120, 'plain')}</div><div><b>${t[0]}</b><small style="display:block">${t[1]}</small></div>${t[2] ? `<span class="tick">${icon('check', 26, 3)}</span>` : ''}</button>`).join('')}</div>
        <div class="formgrid">${[['姓名', '李佳怡', 1], ['目标岗位', '新媒体运营', 1], ['目标单位', '可以不填', 0], ['你的优势', '公众号运营、剪映剪辑', 0], ['备注', '想写进去的其他话，可以不填', 0]].map((f, k) => `<div class="ff" style="${k === 4 ? 'grid-column:1/-1' : ''}"><label>${f[0]}${f[2] ? ' <em>必填</em>' : ''}</label><div class="fv ${f[2] ? '' : 'ph'}">${f[1]}</div></div>`).join('')}</div>
        ${fine('按你填的内容套模板生成，不是 AI 撰写 · 可以说话填写')}`,
      dock: { ask: '问小青：求职信写什么？', pri: { label: '生成 PDF', go: 'materials-result' } }, nav: null
    })
  });

  add('materials-result', '改简历', '求职材料：生成结果', {
    notes: { does: '真实文件生成后给文件卡：页数、大小、链接有效期、保留期限；可以打印或存到我的文档。', motion: '文件卡从上方落入。', keep: '没有真实文件时写「演示结果 · 无真实文件」，不能进打印；不标 AI 撰写。' },
    render: () => F({
      band: { eyebrow: '求职材料 · 已生成', title: '求职信生成好了', sub: '按你填的内容套模板生成', seal: null, sealHtml: `<svg class="big-check" viewBox="0 0 150 150" style="width:120px;height:120px;flex:none" aria-hidden="true"><circle cx="75" cy="75" r="68" fill="none" stroke="#2ee6a8" stroke-width="7"/><path d="M46 77l20 20 40-42" fill="none" stroke="#2ee6a8" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>` },
      body: `<div class="confgrid" style="grid-template-columns:380px 1fr"><div class="cthumb fly">${UI.resume(340, 'plain')}<span>求职信 · 1 页</span></div>
          <div class="sumcard"><div class="r"><span>文件</span><b>求职信-新媒体运营.pdf</b><span></span></div><div class="r"><span>大小</span><b>1 页 · 96 KB</b><span></span></div><div class="r"><span>类型</span><b>求职信 · 校招通用模板</b><span></span></div><div class="r"><span>链接</span><b>30 分钟内有效</b><span></span></div><div class="r"><span>打印凭证</span><b>已生成，可以直接打印</b><span></span></div><div class="r"><span>保留</span><b>${S().logged ? '存到「我的文档」3 个月' : '不登录：办完就清除'}</b><span></span></div></div></div>
        <div class="howto">${icon('help', 34, 2)}<span>按你填的内容套模板生成，不是 AI 撰写。打印前请再读一遍。</span></div>
        <div class="grid2">${tile({ go: 'materials', icon: 'pen', title: '改一改再生成', desc: '回到填写' })}${tile({ go: S().logged ? 'my-docs' : 'login', icon: 'folder', tone: 'slate', title: '存到我的文档', desc: S().logged ? '已保存' : '需要登录' })}</div>
        ${fine('示例数据')}`,
      dock: { ask: false, pri: { label: '打印这份材料', go: 'confirm', arg: 'resume' } }, nav: null
    })
  });

  add('jobfit', '改简历', '简历对照：填岗位要求', {
    notes: { does: '把你看中的岗位要求填进来（托管 a 下只能自己填），和简历逐条对一对。', motion: '说话时麦克风外圈扩散。', keep: '只用你自己填的岗位要求，不用系统岗位库；先同意再分析；不打分、不给百分比、不分档；不提供给企业。' },
    render: () => F({
      band: { eyebrow: '改简历 · 简历对照 · AI', title: '你想对照哪个岗位的要求？', sub: '把招聘信息里的「岗位要求」说出来或贴进来', seal: 'idle' },
      body: `<div class="fgroup">${sec('岗位名称')}<div class="field"><input id="jfRole" value="新媒体运营"><button class="mic" data-act="toast" data-arg="演示：说话填写">${icon('mic', 38, 2.2)}</button></div></div>
        <div class="fgroup">${sec('岗位要求', '可以说话填写')}<div class="txtarea tall">1. 本科及以上学历，新闻、中文、市场营销相关专业；<br>2. 有公众号或短视频运营经验；<br>3. 会用剪映等剪辑工具，有数据分析意识；<br>4. 文字功底好，能独立策划选题。<button class="mic" data-act="toast" data-arg="演示：说话填写">${icon('mic', 36, 2.2)}</button></div></div>
        <div class="fgroup">${sec('用哪份简历')}<div class="seg"><button aria-pressed="true">刚改好的这份</button><button aria-pressed="false" data-act="seg">我保存的简历</button></div></div>
        <label class="consent"><i>${icon('check', 22, 3)}</i><span>我同意把这份简历和岗位要求交给 AI 分析（发送前会遮住手机号和身份证号）</span></label>
        ${fine('只对照你填的内容，不打分、不预测录用、不提供给任何单位')}`,
      dock: { ask: false, pri: { label: '开始对照', go: 'jobfit-result' } }, nav: null
    })
  });

  add('jobfit-result', '改简历', '简历对照：结果', {
    notes: { does: '两栏：简历里已经写到的要求（附原文依据）、还没体现的要求；下面三个下一步。', motion: '两栏依次浮入；关键词胶囊淡入。', keep: '不分档、不打分、不给百分比；没有的栏写「本次未提供」；标「AI 生成 · 仅供参考」。' },
    render: () => F({
      band: { eyebrow: '简历对照 · AI 生成，仅供参考', title: '4 条已经写到，3 条还没体现', sub: '岗位：新媒体运营 · 对照你填的 4 条要求', seal: null },
      body: `<div class="reqlist">
          <div class="rqh ok">${icon('check', 30, 2.6)}简历里已经写到的<small>4 条 · 右边是原文依据</small></div>
          ${[['中文相关专业', '教育经历 · 汉语言文学'], ['公众号运营经验', '实习经历第 1 条'], ['会用剪映', '技能'], ['文字功底', '校园经历 · 公众号推文 48 篇']].map(r => `<div class="rq ok"><i>${icon('check', 24, 3)}</i><b>${r[0]}</b><small>依据：${r[1]}</small></div>`).join('')}
          <div class="rqh gap">${icon('alert', 30, 2.2)}简历里还没体现的<small>3 条</small></div>
          ${['数据分析意识', '独立策划选题', '短视频账号运营'].map(r => `<div class="rq gap"><i>${icon('plus', 24, 3)}</i><b>${r}</b><small>简历里没找到相关内容</small></div>`).join('')}
        </div>
        <div class="kwrow">${['中文专业', '公众号', '剪映'].map(k => `<span class="chip">已具备 · ${k}</span>`).join('')}${['数据分析', '选题策划', '短视频'].map(k => `<span class="chip clay">待补足 · ${k}</span>`).join('')}</div>
        <div class="process">${[['clipboard', '查看行动清单', '逐条怎么准备', 'jobfit-actions'], ['pen', '去简历优化', '把能写的补上', 'optimize'], ['folder', '整理佐证材料', '作品、证书', 'my-docs']].map((p, k) => `<button class="ps" data-go="${p[3]}" style="text-align:left"><span class="n">${k + 1}</span><span class="pi">${icon(p[0], 34, 2)}</span><b>${p[1]}</b><small>${p[2]}</small></button>`).join(`<span class="pa">${icon('arrowR', 28, 2.4)}</span>`)}</div>
        ${fine('只对照你填的岗位要求 · 不代表录用结果')}`,
      dock: { ask: '问小青：数据分析怎么写？', pri: { label: '查看行动清单', go: 'jobfit-actions' } }, nav: null
    })
  });

  add('jobfit-actions', '改简历', '简历对照：行动清单', {
    notes: { does: '逐条列出还没体现的要求：差距、依据、怎么准备；可以打印带走。', motion: '条目依次浮入。', keep: '有对照结果才有清单；不补造行动项；打印成功前不写已出纸。' },
    render: () => F({
      band: { eyebrow: '简历对照 · 行动清单 · AI 生成，仅供参考', title: '3 件事，可以先准备起来', sub: '岗位：新媒体运营', seal: null },
      body: `<div class="stack">${[['数据分析意识', '简历里没写看过哪些数据', '把公众号后台的阅读量、涨粉写进实习经历；面试时准备一个「看数据改选题」的例子'], ['独立策划选题', '只写了「负责」', '挑一篇你自己策划的推文，写清选题怎么来的、结果怎样'], ['短视频账号运营', '只写了剪辑', '如果管过账号，写清楚是哪个账号、做了什么；没有就不写']].map((a, i) => `<div class="issue rise" style="--i:${i}"><span class="no">${i + 1}</span><div><b>${a[0]}</b><small style="font-size:22px">差距：${a[1]}</small><small style="font-size:23px;color:var(--teal-ink);margin-top:8px">怎么准备：${a[2]}</small></div></div>`).join('')}</div>
        <div class="howto">${icon('shield', 34, 2)}<span>只写你真实做过的事；没做过的不要写进简历。</span></div>
        <div class="grid2">${tile({ go: 'optimize', icon: 'pen', title: '准备好了，去改简历', desc: '把能写的补上' })}${tile({ go: 'iv-1', icon: 'mic', title: '练一场面试', desc: '把例子讲顺' })}</div>
        ${fine('打印的是这份清单，不是你的简历')}`,
      dock: { backLabel: '回到结果', ask: false, pri: { label: '打印行动清单', go: 'confirm', arg: 'report' } }, nav: null
    })
  });

  add('career', '改简历', '职业规划建议', {
    notes: { does: '有简历才生成：已有材料、目标与方向、尚需准备、执行计划四栏；可以打印求职参考单。', motion: '四栏依次浮入。', keep: '没有本人简历不生成个人结论；不承诺录用或收入；AI 停用时给「不靠 AI 也能自己看的三件事」并写明是通用建议。' },
    render: () => F({
      band: { eyebrow: '职业规划 · AI 生成，仅供参考', title: '新媒体运营方向，接下来三个月', sub: '依据：你的简历诊断、简历对照', seal: null },
      body: `<div class="grid2" style="align-items:stretch">${[['已有材料', ['汉语言文学专业', '学院公众号运营经历', '一段新媒体实习'], '依据：简历诊断'], ['目标与方向', ['为什么适合：写作和沟通是你的长处', '第一步：补一个数据复盘的例子'], '依据：简历诊断、简历对照'], ['尚需准备', ['数据分析的基础方法', '一份作品集（3–5 篇推文）'], '依据：简历对照 · 3 条还没体现'], ['执行计划', ['第 1 个月：整理作品集', '第 2 个月：练两场面试', '第 3 个月：集中投递和复盘'], '依据：模拟面试表现（10 月 24 日）']].map((c, i) => `<div class="report-col rise" style="--i:${i}"><h4>${c[0]}</h4><ul>${c[1].map(x => `<li>${x}</li>`).join('')}</ul><small class="ev">${c[2]}</small></div>`).join('')}</div>
        <div class="howto">${icon('book', 34, 2)}<span>依据：你的简历诊断（今天 13:30）、简历对照（今天 13:52）。没有你的简历，这一页不会给个人建议。</span></div>
        <div class="grid2">${tile({ go: 'optimize', icon: 'pen', title: '去优化简历', desc: '先把能写的补上' })}${tile({ go: 'jobfit', icon: 'target', title: '简历对照', desc: '对照一个岗位的要求' })}${tile({ go: 'iv-1', icon: 'mic', title: '练一场模拟面试', desc: 'AI 面试官，仅供练习' })}${tile({ go: 'sa-intro', icon: 'compass', title: '做一次自我探索', desc: '25 道选择题' })}</div>
        ${fine('不承诺录用或收入 · 只依据你自己的材料')}`,
      dock: { ask: '问小青：作品集怎么准备？', pri: { label: '打印求职参考单', go: 'confirm', arg: 'report' } }, nav: null
    })
  });

  add('sa-intro', '改简历', '自我探索：开始前', {
    notes: { does: '说清要做什么、多久、结果给谁看；勾选同意后开始。', motion: '无。', keep: '25 题、每题 3 个选项、约 6 分钟；同意条款从后台取，取不到不能开始；不是心理或人格测评，不贴类型标签，不说适合哪类岗位。' },
    render: () => F({
      band: { eyebrow: '改简历 · 自我探索', title: '花 6 分钟，看看自己的倾向', sub: '25 道选择题，没有对错；结果只给你自己看', seal: 'idle', path: ['同意开始', '25 道题', '复核提交', '看结果'], pathLabel: '一共' },
      body: `<div class="benefits">${[['clock', '约 6 分钟', '每题 3 个选项'], ['user', '可以不登录', '结果只在这一次显示'], ['shield', '只给你看', '不发给任何单位']].map(b => `<div><span>${icon(b[0], 38, 2)}</span><b>${b[1]}</b><small>${b[2]}</small></div>`).join('')}</div>
        <div class="dims"><div class="olist-t" style="padding:0 0 4px">会从这五个方向整理 · 每个方向 5 题</div>${[['兴趣偏好', '更愿意把时间和精力花在哪类事情上'], ['工作风格', '遇到陌生任务、多件事并行时习惯怎么做'], ['团队偏好', '开会、协作、有分歧时你更常怎么做'], ['价值取向', '选工作、看成果、平衡生活时更看重什么'], ['求职动机', '这一轮求职最想推进什么、最想得到什么']].map((d, k) => `<div class="dm"><span class="n">${k + 1}</span><b>${d[0]}</b><small>${d[1]}</small></div>`).join('')}</div>
        <div class="howto">${icon('sparkle', 34, 2)}<span>AI 分工：五个方向的强度按你的选择计算；整体解读由 AI 写，会标「AI 生成」。AI 用不了时只给强度和题号。</span></div>
        <label class="consent"><i>${icon('check', 22, 3)}</i><span>我已阅读说明：结果仅供自我参考，不评分、不排名，不替代能力证明</span></label>
        ${fine('不是心理测评，不生成人格类型，不说你适合哪类岗位')}`,
      dock: { ask: false, mid: `<button class="btn sec" data-go="sa-history">看这次的记录</button>`, pri: { label: '开始作答', go: 'sa-q' } }, nav: null
    })
  });

  add('sa-q', '改简历', '自我探索：答题', {
    notes: { does: '一屏一题，三个大选项；不能跳题，最后统一复核。', motion: '选中后高亮再切到下一题；进度条按真实题数走。', keep: '进度是真实题数；提交前有复核页；提交后答题页关闭；答案原文不入库。' },
    render: () => F({
      band: { kind: 'compact', eyebrow: '自我探索 · 第 1 题 / 共 25 题 · 兴趣偏好', title: '在日常学习中，你更愿意花时间深入了解哪类内容？', seal: null },
      body: `<div class="stack">${['解决具体的工程问题', '与不同岗位背景的人沟通协作', '梳理数据并得出结论'].map((c, k) => `<button class="choice rise ${k === 1 ? 'on' : ''}" style="--i:${k}" data-act="toast" data-arg="演示：选中后到下一题"><span class="ck">${'ABC'[k]}</span><b>${c}</b>${k === 1 ? `<span class="tick">${icon('check', 34, 3)}</span>` : ''}</button>`).join('')}</div>
        <div class="qgrid"><div class="olist-t" style="padding:0">25 道题 · 答完可以统一检查再提交</div><div class="qg">${Array.from({ length: 25 }, (_, k) => `<i class="${k === 0 ? 'now' : ''}">${k + 1}</i>`).join('')}</div></div>
        <div class="howto">${icon('help', 34, 2)}<span>凭第一感觉选就行，没有对错。不能跳题，选完点「下一题」。</span></div>
        ${fine('中途离开会提醒；没登录的话，离开后答案清除')}`,
      dock: { backLabel: '上一题', ask: false, pri: { label: '下一题', go: 'sa-result' } }, nav: null
    })
  });

  add('sa-result', '改简历', '自我探索：结果', {
    notes: { does: '五个方向各写强度和依据题号；整体解读单独标 AI；可以生成 PDF 去打印，或撤回这次探索。', motion: '五个方向依次浮入。', keep: '不生成人格类型，不说适合哪类岗位；AI 解读缺失时只留强度和题号并写明；记录编号、同意时间、保留期限要显示。' },
    render: () => F({
      band: { eyebrow: '自我探索 · 结果 · 仅供自我参考', title: '这是你这次的选择整理', sub: '记录编号 SA-1025-0412 · 10 月 25 日 14:20 同意 · 保留至 11 月 24 日', seal: null },
      body: `<div class="olist"><div class="olist-t">五个方向的强度与依据</div>${[['兴趣偏好', 4, '第 1、6、11 题'], ['工作风格', 3, '第 2、7、12 题'], ['团队偏好', 4, '第 3、8、13 题'], ['价值取向', 2, '第 4、9、14 题'], ['求职动机', 3, '第 5、10、15 题']].map(d => `<div class="dimrow"><b>${d[0]}</b><span class="dots5">${[1, 2, 3, 4, 5].map(k => `<i class="${k <= d[1] ? 'on' : ''}"></i>`).join('')}</span><span class="n">${d[1]} / 5</span><small>依据：${d[2]}</small></div>`).join('')}</div>
        <div class="aiblock"><div class="lab">${icon('sparkle', 26, 2)}整体解读 · AI 生成，仅供参考</div><p>你更愿意和不同背景的人沟通协作，也在意把事情做出看得见的结果。可以把校园活动和公众号的经历写得更具体。</p></div>
        <div class="grid2">${tile({ go: 'career', icon: 'map', title: '拿去做职业规划', desc: '结合你的简历' })}${tile({ act: 'toast', arg: '演示：撤回本次探索', icon: 'erase', tone: 'clay', title: '撤回这次探索', desc: '结果一起删除' })}</div>
        ${fine('不评分、不排名、不替代能力证明')}`,
      dock: { ask: '问小青：这个结果怎么用？', pri: { label: '生成 PDF 去打印', go: 'confirm', arg: 'report' } }, nav: null
    })
  });

  add('sa-history', '改简历', '自我探索：这次的记录', {
    notes: { does: '只显示这台机器上这一次的记录；不编历次列表、不做跨次对比。', motion: '无。', keep: '没有记录时写「这里还没有可查看的记录」；去 AI 服务记录看次数。' },
    render: () => F({
      band: { eyebrow: '自我探索 · 记录', title: '这一次的探索记录', sub: '只显示这台机器上这一次，不做历次对比', seal: null },
      body: `<div class="grid2">${[['记录编号', 'SA-1025-0412', '以后查询、撤回时用'], ['同意时间', '10 月 25 日 14:20', '开始作答前勾选同意'], ['方向', '5 个', '兴趣、风格、团队、价值、动机'], ['保留至', '11 月 24 日', '到期后自动删除']].map(s => `<div class="bigstat sm"><small>${s[0]}</small><b>${s[1]}</b><span>${s[2]}</span></div>`).join('')}</div>
        <div class="emptybox" style="min-height:330px">${icon('compass', 64, 1.6)}<b>以前的记录不在这里</b><span>登录后，在「我的 → AI 服务记录」里能看到你做过几次。</span></div>
        <div class="grid2">${tile({ go: 'sa-result', icon: 'eye', title: '回看这次结果', desc: '五个方向' })}${tile({ go: S().logged ? 'my-ai' : 'login', icon: 'sparkle', tone: 'slate', title: 'AI 服务记录', desc: S().logged ? '看次数和时间' : '需要登录' })}</div>
        ${fine('不编造历史记录')}`,
      dock: { backLabel: '返回说明', ask: false }, nav: null
    })
  });

  /* ═════════ 练面试：补充 ═════════ */
  add('iv-tips', '练面试', '面试技巧', {
    notes: { does: '公开的准备方法：准备清单（可勾选）、讲经历的结构、常见题、自我介绍长短三版。', motion: '勾选时对勾画出；展开问答时内容淡入。', keep: '通用内容，不装成按你简历生成的 AI 建议；在线服务不可用时「设置一场练习」灰掉并写原因。' },
    render: () => F({
      band: { eyebrow: '练面试 · 面试技巧', title: '先把准备方法练熟', sub: '通用方法，人人适用', seal: null },
      body: `<div class="grid2" style="align-items:stretch">
          <div class="report-col"><h4>${icon('clipboard', 30, 2)}准备清单 <small style="font-weight:400;color:var(--ink-3)">已完成 2 / 6</small></h4><div class="manual" style="padding:0;background:none">${['打印 2 份简历', '带上证件和作品', '查一查这家单位做什么', '想好自我介绍', '准备 2 个想问的问题', '提前 15 分钟到'].map((t, k) => `<div><i class="${k < 2 ? 'on' : ''}">${k < 2 ? icon('check', 18, 3) : ''}</i>${t}</div>`).join('')}</div></div>
          <div class="report-col"><h4>${icon('book', 30, 2)}讲经历的结构</h4><ul><li><b>情况和任务</b>：当时要做成什么</li><li><b>你的行动</b>：你具体做了哪几步</li><li><b>结果</b>：做成了什么，有数字更好</li></ul></div></div>
        <div class="olist"><div class="olist-t">常见题（共 8 道）</div>${[['介绍一下你自己', '专业 → 一段最相关的经历 → 为什么想做这份工作'], ['你最大的缺点是什么', '说一个真实的小缺点，再说你在怎么改'], ['为什么选我们', '说你了解到的一两点，和你的打算']].map((q, k) => `<div class="qrow" style="grid-template-columns:44px 1fr;min-height:96px"><span class="no">${k + 1}</span><div><b style="display:block;white-space:normal">${q[0]}</b><small style="color:var(--ink-3);font-weight:400">${q[1]}</small></div></div>`).join('')}</div>
        <div class="fgroup">${sec('自我介绍怎么说')}<div class="seg"><button aria-pressed="false" data-act="seg">30 秒</button><button aria-pressed="true">1 分钟</button><button aria-pressed="false" data-act="seg">3 分钟</button></div></div>`,
      dock: { ask: '问小青：自我介绍怎么说？', pri: { label: '设置一场练习', go: 'iv-1' } }, nav: null
    })
  });

  add('iv-reports', '练面试', '我的练习记录', {
    notes: { does: '只看自己的练习报告；没生成报告的不能看。', motion: '列表浮入；删除要再点一次确认。', keep: '没登录的记录大约保留 2 小时，登录后保留 7 天；加载时不放示例记录；报告没生成的写「报告未生成」并灰掉。' },
    render: () => F({
      band: { eyebrow: '练面试 · 练习记录', title: '只查看自己的报告', sub: S().logged ? '登录后本人的记录保留 7 天' : '没登录的记录大约保留 2 小时；登录后保留 7 天', seal: null },
      body: `<div class="stack">${(S().logged ? [['HR 面试 · 新媒体运营', '今天 14:30 · 互联网 · 5 分钟', 1], ['校招面试官 · 新媒体运营', '今天 11:40 · 互联网 · 3 分钟', 1], ['业务主管 · 新媒体运营', '昨天 16:20 · 互联网 · 8 分钟', 0], ['HR 面试 · 内容编辑', '10 月 21 日 10:05 · 文化传媒 · 5 分钟', 1]] : [['HR 面试 · 新媒体运营', '15 分钟前 · 互联网 · 5 分钟', 1], ['校招面试官 · 新媒体运营', '50 分钟前 · 互联网 · 3 分钟', 1], ['业务主管 · 新媒体运营', '1 小时 30 分钟前 · 互联网 · 8 分钟', 0]]).map(r => row({ cls: 'big', lead: `<div class="rthumb">${UI.report(96)}</div>`, t: r[0], m: r[1], extra: acts(r[2] ? [{ l: '查看', k: 'pri', go: 'iv-report' }, { l: '删除', i: 'erase' }] : [{ l: '报告未生成', dis: 1 }, { l: '删除', i: 'erase' }]) })).join('')}</div>
        ${S().logged ? '' : `<button class="rowlink" data-go="login">${icon('user', 32, 2)}<span><b>手机号登录</b> <small>· 记录保留 7 天</small></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button>`}
        <div class="howto">${icon('refresh', 34, 2)}<span>同一个岗位多练几次，对比反馈，进步会更明显。</span></div>
        ${fine('示例数据')}`,
      dock: { ask: false, pri: { label: '再练一场', go: 'iv-1' } }, nav: null
    })
  });

  /* ═════════ 打印扫描：补充 ═════════ */
  add('feature-info', '打印扫描', '证件照（本机尚未开放）', {
    notes: { does: '还没开放的功能如实说明，给出两条现在就能办的替代办法；「规划」写明不是承诺。', motion: '无。', keep: '证件照不做裁切、换底、排版、成品；规划三条标「规划，不是承诺」。' },
    render: () => F({
      band: { eyebrow: '打印扫描 · 证件照', title: '证件照：本机尚未开放', sub: '这台机器现在不能拍照，也不能换底色、排版', seal: null, status: { text: '证件照尚未开放', warn: 1 } },
      body: `<div class="emptybox" style="min-height:220px">${icon('idcard', 64, 1.6)}<b>证件照暂时办不了</b><span>不能拍照、不能换底色、不能按尺寸排版。</span></div>
        <div class="fgroup">${sec('现在可以这样办')}<div class="stack">${row({ cls: 'mid', lead: lead('image', 'teal'), t: '已有证件照文件：按普通照片打印', m: '手机传过来，选好张数打印', extra: acts([{ l: '先用照片打印', k: 'pri', go: 'print-src' }]) })}${row({ cls: 'mid', lead: lead('scan'), t: '纸质照片：到打印机面板上扫描', m: '扫成 PDF 后可以存、可以打', extra: acts([{ l: '看扫描步骤', go: 'scan-guide' }]) })}</div></div>
        <div class="manual"><div class="olist-t" style="padding:0">规划，不是承诺</div>${['常用尺寸的排版打印', '换底色', '电子版证件照'].map(t => `<div><i></i>${t}</div>`).join('')}</div>
        ${fine('开放以后会在这里说明')}`,
      dock: { ask: '问小青：证件照怎么办？' }, nav: null
    })
  });

  add('cashier', '打印扫描', '订单支付（收费点位）', {
    notes: { does: '运行页收银台 PrintCashierPage / CashierQxView 的等待支付态（cashierQxModel pending-qr）。金额大于 0 才到这一屏。', motion: '不演出付款成功。切换方式只改说明，出示付款码时屏幕不回显那串码。', keep: '胶囊「等待支付 · 未确认」。通道行「这台机器只启用了一个支付通道，已自动采用」加「测试支付通道 · 非真实收款」。这句只在沙箱通道出现（CashierPaymentPanel.tsx:327-331）。正式通道显示「{通道名} · 支付结果以实际到账为准」。多通道时由用户自己选，绝不默认第一项（PrintCashierPage.tsx:185-195）。扫码方式两选，「我用手机扫码付」默认选中。收款码下写「这张码属于本次订单，支付主体与金额以手机端展示为准」和「收款码 5 分钟内有效」。有效期从服务端读，默认 300 秒。订单摘要示例「订单号 ORD-20261026-0418」「内容 毕业生就业推荐表（已填写）.pdf · 2 张 · 黑白」「应付 2.00 元」。金额和订单号从订单读，示例不代表价目。底部返回位「返回确认页」；出过码后这一颗变「改参数需重新下单」（PrintCashierPage.tsx:471-475）。「退出支付」放弃这次支付回首页，和返回是两件事（545-569）。主按钮「刷新付款结果」。不预画微信或支付宝按钮。成功只认系统确认的付款结果。' },
    render: () => {
      const mode = S().payMode === 'code' ? 'code' : 'qr';
      return F({
        band: { kind: 'compact', eyebrow: '打印文件 · 订单支付', title: '请完成这笔支付', sub: '选择已开通的支付通道；确认到账后才会开始打印', seal: null, place: ' ', status: { text: '等待支付 · 未确认', warn: 1 } },
        cls: 'd3-cashier',
        body: `<p class="d3-chline"><b>这台机器只启用了一个支付通道，已自动采用</b>测试支付通道 · 非真实收款</p>
          <div class="seg">
            <button aria-pressed="${mode === 'qr' ? 'true' : 'false'}" data-d3="pay" data-v="qr">我用手机扫码付</button>
            <button aria-pressed="${mode === 'code' ? 'true' : 'false'}" data-d3="pay" data-v="code">出示付款码给机器扫</button>
          </div>
          <div class="sumcard"><div class="r"><span>订单号</span><b>ORD-20261026-0418</b><span></span></div><div class="r"><span>内容</span><b>毕业生就业推荐表（已填写）<span class="d3-ext">.pdf</span> · 2 张 · 黑白</b><span></span></div><div class="r"><span>应付</span><b>2.00 元</b><span></span></div></div>
          ${mode === 'qr'
            ? `<div class="d3-qrframe waiting"><b class="d3-qrt">请扫码支付</b>${UI.qr(11, 400)}<b>这张码属于本次订单，支付主体与金额以手机端展示为准</b><p>支付尝试已经创建。请勿切换方式、重复付款或重新下单。收款码 5 分钟内有效。</p></div>`
            : '<div class="d3-qrframe"><b>请把付款码对准扫码区</b><p>机器扫你的付款码。屏幕不回显这串码。</p></div>'}
          <button class="btn sec" data-go="home" style="height:80px;align-self:flex-start;min-width:240px">退出支付</button>`,
        dock: { back: false, left: `<button class="btn sec" data-go="confirm">${icon('chevL', 30, 2.4)}返回确认页</button>`, ask: '问小青：这笔账看不懂', pri: { label: '刷新付款结果', act: 'toast', arg: '正在向支付渠道核实这一次的结果' } }, nav: null, navAdvisor: 1
      });
    },
    mount: (el) => {
      const on = (e) => {
        const b = e.target.closest('[data-d3="pay"]');
        if (!b || !el.contains(b)) return;
        e.stopPropagation();
        window.S.payMode = b.dataset.v;
        window.__proto.refresh();
      };
      el.addEventListener('click', on);
      return () => el.removeEventListener('click', on);
    }
  });

  add('sign', '打印扫描', '签名（默认关闭）', {
    notes: { does: '本机构开通后才有：把本人手写签名照片放到自己的 PDF 上，合成新文件再去检查打印。', motion: '选位置时九宫格高亮；大小切换时签名缩放。', keep: '默认关闭；要登录；原 PDF 不超过 15MB、1–30 页；签名照只收 JPG、PNG；不是电子签名，不收单位公章和圆章；授权句要原样勾选。' },
    render: () => F({
      band: { kind: 'compact', eyebrow: '签名 · 本机构开通后才显示', title: '选好位置和大小', rail: { labels: ['选 PDF', '传签名照片', '位置和大小', '授权合成'], now: 2 }, seal: null },
      body: `<div class="signgrid"><div class="cthumb" style="position:relative">${UI.resume(360, 'plain')}<span class="sigbox">李佳怡</span><span>第 1 页 / 共 2 页</span></div>
          <div class="stack"><div class="fgroup">${sec('放在哪')}<div class="nine">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(k => `<button class="${k === 8 ? 'on' : ''}" data-act="toast" data-arg="演示：选位置" aria-label="位置 ${k + 1}"></button>`).join('')}</div></div>
            <div class="fgroup">${sec('大小', '占页宽')}<div class="seg"><button aria-pressed="false" data-act="seg">小 15%</button><button aria-pressed="true">中 25%</button><button aria-pressed="false" data-act="seg">大 35%</button></div></div>
            ${tile({ act: 'toast', arg: '演示：再加一处', icon: 'plus', title: '再加一处', desc: '比如第 2 页' })}</div></div>
        <div class="howto">${icon('clock', 34, 2)}<span>签名照片约 1 小时后自动清除，不进「我的文档」；合成后的新文件要先过隐私检查再打印。</span></div>
        <label class="consent"><i>${icon('check', 22, 3)}</i><span>我确认本人拥有该签名/印章图片的使用授权，仅用于本人材料的版式整理</span></label>
        ${fine('这是把签名图片放到文件上，不是电子签名；原文件不会被改写')}`,
      dock: { ask: false, pri: { label: '合成新文件', go: 'pii' } }, nav: null
    })
  });

  /* ═════════ 受控与扩展 ═════════ */
  add('contract', '受控与扩展', 'AI 签约风险提示（默认关闭）', {
    notes: { does: '机构开通后才有：选合同类型、上传合同、同意后分析。', motion: '处理中扫描光扫过合同。', keep: '默认关闭，关闭时整页不出现；先同意再上传；不是法律意见、不是律师审查；报告不进打印，也不发给企业。' },
    render: () => F({
      band: { eyebrow: 'AI 签约风险提示 · 本机构开通后才显示', title: '签之前，看看要问清哪些条款', sub: '不是法律意见，也不是律师审查', seal: 'idle', path: ['上传合同', 'AI 分析', '查看结果'], pathLabel: '三步' },
      body: `<div class="fgroup">${sec('是什么合同')}<div class="seg"><button aria-pressed="true">劳动合同</button><button aria-pressed="false" data-act="seg">实习协议</button><button aria-pressed="false" data-act="seg">竞业限制</button><button aria-pressed="false" data-act="seg">录用通知书</button></div></div>
        ${slab({ i: 0, row: 1, go: 'upload', title: '手机扫码传合同', desc: '拍照或 PDF，单个不超过 10MB', take: '要问清的条款清单', vis: UI.phone(86) })}
        <div class="manual"><div class="olist-t" style="padding:0">会帮你看的条款（共 14 类，举几例）</div>${['合同期限和试用期', '工作内容和工作地点', '工资和社保', '违约金和竞业限制'].map(t => `<div><i></i>${t}</div>`).join('')}</div>
        <label class="consent"><i>${icon('check', 22, 3)}</i><span>我同意把合同交给 AI 分析（发送前遮住身份证号和手机号）；结果可以随时删除</span></label>
        ${fine('合同原件按短期策略删除 · 报告不打印、不发给企业')}`,
      dock: { ask: false, pri: { label: '开始风险分析', go: 'contract-result' } }, nav: 'home'
    })
  });

  add('contract-result', '受控与扩展', 'AI 签约风险提示：结果', {
    notes: { does: '分「优先核查、关注、信息不足」三类列出条款，每条附页码摘录和建议追问；可以存到我的文档或立即删除。', motion: '条目依次浮入。', keep: '不写法律意见、不写合同有效；报告不进打印；存到我的文档保留 90 天；看不清的单列「信息不足」请本人核对。' },
    render: () => F({
      band: { eyebrow: 'AI 签约风险提示 · AI 生成，不是法律意见', title: '有 3 处建议你问清楚', sub: '劳动合同 · 4 页', seal: null },
      body: `<div class="kwrow"><span class="chip cin">优先核查 1</span><span class="chip clay">关注 2</span><span class="chip slate">信息不足 1</span></div>
        <div class="stack">${[['cin', '试用期 6 个月', '第 2 页：「合同期限 2 年，试用期 6 个月」', '建议追问：试用期工资是多少？'], ['clay', '岗位「根据需要调整」', '第 2 页：没写调整的范围和条件', '建议追问：可能调到哪里、做什么？'], ['clay', '违约金 2 万元', '第 3 页：没写在什么情况下要付', '建议追问：什么情况下要付？']].map((r, i) => `<div class="issue rise" style="--i:${i}"><span class="no" style="background:var(--${r[0] === 'cin' ? 'cinnabar' : 'clay'})">${i + 1}</span><div><b>${r[1]}</b><small style="font-size:22px">${r[2]}</small><small style="font-size:22px;color:var(--teal-ink)">${r[3]}</small></div></div>`).join('')}
          <div class="issue" style="border-style:dashed"><span class="no" style="background:var(--slate)">?</span><div><b>第 4 页有一处看不清</b><small style="font-size:22px">AI 没有判断，请你自己看一下。</small></div></div></div>
        <div class="grid2">${tile({ act: 'toast', arg: '演示：已立即删除', icon: 'erase', tone: 'clay', title: '立即删除', desc: '合同和结果一起删' })}${tile({ act: 'toast', arg: '演示：重新上传', icon: 'refresh', title: '重新上传', desc: '换一份合同' })}</div>
        ${fine('不构成法律意见 · 拿不准的请咨询劳动保障部门或律师')}`,
      dock: { ask: false, pri: { label: '存到我的文档（90 天）', act: 'toast', arg: S().logged ? '演示：已保存 90 天' : '需要先登录才能保存' } }, nav: 'home'
    })
  });

  add('toolbox', '受控与扩展', '百宝箱（按机构配置）', {
    notes: { does: '本机构配置并审核上架的扩展服务：站内服务直接进，扫码或外链先提示离开。', motion: '卡片浮入；外链确认层从下往上滑出。', keep: '只显示真实配置项，不画具体应用名单；不替第三方推荐或背书；不记录第三方办理结果；没配置时整页写「待配置」。' },
    render: () => F({
      band: { eyebrow: '百宝箱 · 本机构配置', title: '本机已配置的扩展服务', sub: '经本机构审核后上架；下面的名称是示意', seal: null },
      body: `<div class="grid2 toolgrid">${[['layout', '站内服务（示意）', '在这台机器上办', '进入服务'], ['qr', '扫码获取（示意）', '在你的手机上办', '扫码获取'], ['arrowR', '外部链接（示意）', '会提示你即将离开', '打开'], ['clipboard', '办事指南（示意）', '图文说明', '进入服务']].map((t, i) => `<div class="doccard rise" style="--i:${i};min-height:390px;justify-content:center"><span class="ic big">${icon(t[0], 44, 2)}</span><b>${t[1]}</b><small>${t[2]}</small>${acts([{ l: t[3], k: 'pri' }])}</div>`).join('')}</div>
        <div class="process">${[['qr', '点开一项服务', '站内的直接进'], ['alert', '先看离开提示', '扫码或外链都会先问你'], ['phone', '在手机或新页面办', '这台机器不记录办理结果']].map((p, k) => `<div class="ps"><span class="n">${k + 1}</span><span class="pi">${icon(p[0], 34, 2)}</span><b>${p[1]}</b><small>${p[2]}</small></div>`).join(`<span class="pa">${icon('arrowR', 28, 2.4)}</span>`)}</div>
        ${fine('没有配置时，这一页写「待配置：后续功能上线后将在这里展示」')}`,
      dock: { ask: false }, nav: 'home'
    })
  });

  add('smart-campus', '受控与扩展', '智慧校园（按机构开通）', {
    notes: { does: '学校开通后才有：迎新指引、校园卡、一卡通、校园网等办理指引；实际办理去现场或学校官方平台。', motion: '卡片浮入。', keep: '只是办理指引，未接线上办理；不画成某校真实安排；校园大数据暂未开放，不展示统计；没开通时写「本机暂未开启智慧校园服务」。' },
    render: () => F({
      band: { eyebrow: '智慧校园 · 学校开通后才显示', title: '入学要办的事，先看指引', sub: '办理指引 · 实际办理去现场或学校官方平台', seal: 'idle' },
      body: `<div class="grid2">${[['compass', '迎新指引', '报到四步和要准备的东西', 'campus-svc'], ['idcard', '校园卡办理', '材料、地点、注意事项', 'campus-svc'], ['ticket', '一卡通开通', '怎么开通、怎么充值', 'campus-svc'], ['wifi', '校园网开通', '账号、套餐和报修', 'campus-svc'], ['folder', '行李帮运', '时间和地点', 'campus-svc'], ['image', 'VR 校园', '提前看看校园', 'campus-svc']].map((t, i) => `<button class="cat rise" style="--i:${i};min-height:250px" data-go="${t[3]}"><span class="ic" style="background:var(--teal-wash);color:var(--teal-ink)">${icon(t[0], 36, 2)}</span><b>${t[1]}</b><small>${t[2]}</small></button>`).join('')}</div>
        <div class="howto">${icon('landmark', 34, 2)}<span>以学校迎新指南或官方公众号为准。这里不收集你的个人信息。</span></div>
        ${fine('可查看指引 6 项 · 校园大数据暂未开放')}`,
      dock: { ask: '问小青：报到要带什么？' }, nav: 'home'
    })
  });

  add('campus-svc', '受控与扩展', '智慧校园：校园卡办理指引', {
    notes: { does: '单项办理指引：摘要、事项、材料、地点、现场说明；能顺手打印入学材料。', motion: '各块依次浮入。', keep: '徽章写「办理指引 · 未接线上办理」；证件照「即将上线」不能点；不画线上办结、收费代收或具体学校窗口。' },
    render: () => F({
      band: { eyebrow: '智慧校园 · 办理指引 · 未接线上办理', title: '校园卡办理', sub: '通用参考，以学校通知为准', seal: null },
      body: `<div class="dsec"><h4>${icon('clipboard', 30, 2)}要做的事</h4><ul><li>领取校园卡，激活后可以吃饭、进门、借书</li><li>挂失和补办按学校规定</li></ul></div>
        <div class="dsec check"><h4>${icon('folder', 30, 2)}要准备的材料</h4><ul><li>本人身份证</li><li>录取通知书</li><li>证件照（按学校要求）</li></ul></div>
        <div class="dsec"><h4>${icon('landmark', 30, 2)}去哪办</h4><ul><li>以学校迎新指南或官方公众号公布的地点为准</li></ul></div>
        <div class="dsec"><h4>${icon('help', 30, 2)}到了现场</h4><ul><li>一般要本人到场，带好原件</li><li>照片规格、办理时间以学校通知为准</li></ul></div>
        <div class="grid2">${tile({ go: 'print-src', icon: 'printer', title: '打印入学材料、表格', desc: '手机传过来打印' })}${tile({ act: 'toast', arg: '证件照即将上线', icon: 'image', title: '证件照', desc: '即将上线', off: 1 })}</div>`,
      dock: { ask: '问小青：校园卡丢了怎么办？' }, nav: 'home'
    })
  });

  window.SCREEN_GROUPS = ['公共', '改简历', '练面试', '打印扫描', '查政策', '我的', '受控与扩展'];
})();
