/* 页面定义：每屏 = 意图带（看）+ 内容（选）+ 按区（按）+ 导航。notes 写给说明栏。 */
(function () {
  const { icon, band, dock, nav, slab, tile } = UI;
  const S = () => window.S;
  const F = (o) => (o.band ? band(o.band) : '') + (o.pre || '') + `<main class="body ${o.cls || ''}">${o.body}</main>` + (o.dock === false ? '' : (o.dockHtml || dock(o.dock || {}))) + (o.nav === false ? '' : nav(o.nav));
  const RAIL = {
    resume: ['选简历', '小青诊断', '逐条修改', '核对打印'],
    iv: ['岗位与经验', '面试官与时长', '核对开始'],
    print: ['选文件', '预览设置', '核对', '取件'],
    scan: ['选类型', '在打印机上扫', '等回传', '用扫描件'],
    pick: ['输到机码', '核对订单', '取件']
  };
  const fine = (t) => `<p class="fine">${t}</p>`;
  const sec = (t, s) => `<div class="sec-t rise" style="--i:3">${t}${s ? `<small>${s}</small>` : ''}</div>`;
  const aiOff = () => S().ai === 'down';
  const printerOff = () => S().printer === 'down';

  const screens = [];
  const add = (id, group, name, def) => screens.push(Object.assign({ id, group, name }, def));

  /* ═════════ 公共 ═════════ */
  add('standby', '公共', '待机屏', {
    notes: { does: '没人用的时候放「在这里能办什么」，轻触任何地方开始。', motion: '光带慢速流动（22 秒一个来回）、四张卡 6 秒淡入淡出轮换；一被触摸立即停。只有这一屏有长循环动画。', keep: '不放商业广告（深圳地方标准）；不显示上一位的任何资料。' },
    render: () => `<div class="standby" data-go="home" role="button" aria-label="轻触屏幕开始">
      <div class="halo"></div>${UI.flowLines(1920).replace('class="flow"', 'class="flow" style="position:absolute;inset:0"')}
      <div style="display:flex;justify-content:space-between;align-items:center"><div class="brand"><div class="mark">职</div><div><b>职易达</b><small>就业服务大厅</small></div></div><span class="status"><i class="dot"></i>可以使用</span></div>
      <div class="sb-time" style="margin-top:80px"><b data-clock="t">14:30</b><small data-clock="d">10月25日 周日</small></div>
      <div class="slides" id="slides">
        ${[
          ['带简历来', '小青帮你改好，<br>当场打印带走', '上传或扫描纸质简历，逐条看改法，每一处都由你决定。', UI.resume(250, 'fixed')],
          ['练一场面试', '3 分钟到 8 分钟，<br>练完拿一份反馈', '选岗位、选面试官，用说的或打字回答。', UI.report(250)],
          ['打印 · 扫描 · 复印', '手机和 U 盘的文件，<br>在这里打出来', '手机微信扫码就能传，不用装软件。', UI.stack(240, 3)],
          ['查政策', '补贴和社保怎么办，<br>要带哪些材料', '内容由本机构发布，可以打印材料清单。', UI.checklist(250)]
        ].map((s, i) => `<div class="slide ${i === 0 ? 'on' : ''}"><div class="k">${s[0]}</div><h2>${s[1]}</h2><p>${s[2]}</p><div class="art">${s[3]}</div></div>`).join('')}
      </div>
      <div class="sb-dots" id="sbDots"><i class="on"></i><i></i><i></i><i></i></div>
      <div class="touch-cta"><span class="ring">${icon('hand', 46, 2)}</span><span><b>轻触屏幕开始</b><small>不用登录，办完自动清除你的资料</small></span></div>
      <div class="sb-foot"><span>鲁ICP备2026023517号-2</span><span>需要帮助：服务电话 183-6916-1921</span></div>
    </div>`,
    mount: (el) => {
      let k = 0; const sl = el.querySelectorAll('.slide'), dots = el.querySelectorAll('#sbDots i');
      const t = setInterval(() => { sl[k].classList.remove('on'); dots[k].classList.remove('on'); k = (k + 1) % sl.length; sl[k].classList.add('on'); dots[k].classList.add('on'); }, 6000);
      return () => clearInterval(t);
    }
  });

  add('home', '公共', '首页', {
    before: 'home',
    notes: { does: '只回答两件事：这里能办什么、从哪开始。问小青是纸面上的第一主操作。', motion: '光带缓慢流动；四张卡依次浮入（每张晚 45 毫秒）；按下缩小 2%。', keep: '四项主任务与三项导航不变；AI 角标写能力词；岗位、招聘会入口不出现（托管 a）。' },
    render: () => {
      const T = (o) => `<button class="task ${o.dark ? 'dark' : ''} rise" style="--i:${o.i};min-height:376px" data-go="${o.go}">
        <div class="top"><span class="ic">${icon(o.ic, 40, 2)}</span><span class="chip ${o.ck || ''} ${o.ai ? 'ai' : ''}">${o.chip}</span></div>
        <h3>${o.t}</h3><p>${o.d}</p><div class="take">${icon('check', 24, 2.6)}带走：${o.take}</div><div class="mini">${o.vis}</div></button>`;
      return `<header class="band hero flowing">${UI.flowLines(700)}<div class="halo"></div>${UI.header({ back: false })}
        <div class="greet">${UI.seal('idle', 'xl')}<div><div class="eyebrow" data-greet>下午好</div><h1>今天想办哪件事？</h1><p>点下面一项，或者直接问小青</p></div></div></header>`
        + `<button class="xq-bar rise" style="--i:0" data-go="xq"><span class="orb">${icon('mic', 46, 2.2)}</span><span><b>按住说话，或者点这里打字</b><small>小青会带你去对应的功能，不替你做决定</small></span><span class="chip ai">AI 顾问</span></button>`
        + `<main class="body" style="padding-top:30px;gap:22px;justify-content:space-between">
          <div class="grid2 tasks">
            ${T({ i: 1, go: 'resume', ic: 'file', chip: 'AI 诊断改写', ai: 1, t: '改简历', d: '带电子或纸质简历来，找出问题，逐条改好', take: '改好的简历', vis: UI.resume(150, 'annot') })}
            ${T({ i: 2, go: 'interview', ic: 'mic', chip: 'AI 模拟面试', ai: 1, t: '练面试', d: '选岗位、选面试官，3 到 8 分钟练一场', take: '练习反馈报告', vis: UI.report(150) })}
            ${T({ i: 3, go: 'print', dark: 1, ic: 'printer', chip: printerOff() ? '打印机连不上' : '打印机就绪', ck: printerOff() ? 'clay' : 'ghost', t: '打印 · 扫描 · 复印', d: '手机、U 盘里的文件，纸质材料和证件', take: '打印件、扫描件', vis: UI.stack(132, 3) })}
            ${T({ i: 4, go: 'policy', ic: 'landmark', chip: '官方发布', ck: 'slate', t: '查政策', d: '补贴、社保怎么办，要带哪些材料', take: '材料清单', vis: UI.checklist(150) })}
          </div>
          <div class="tiles3">
            ${tile({ i: 5, go: 'pickup', icon: 'ticket', title: '到机取件', desc: '手机上下了单，来这里取' })}
            ${tile({ i: 6, go: 'official', icon: 'qr', tone: 'slate', title: '本机构官方渠道', desc: '公众号、官网，扫码看' })}
            ${tile({ i: 7, go: 'help', icon: 'help', tone: 'clay', title: '帮助', desc: '常见问题、服务电话' })}
          </div>
          <div class="footline rise" style="--i:8"><p class="fine">AI 生成的内容都会标明 · 本机不替你投递 · 离开 60 秒无操作会清除本次资料</p><span class="icp">鲁ICP备2026023517号-2 · 鲁公网安备37021402007308号</span></div>
        </main>` + nav('home');
    }
  });

  add('xq', '公共', '问小青', {
    before: 'assistant',
    notes: { does: '说一句想办的事，小青回一句话加一个去处。点选、说话优先，打字其次。', motion: '按住麦克风时外圈扩散、声波条跳动；小青回答前三个点闪烁；回答卡片浮入。静止时小青圆章不动。', keep: 'AI 标识、不用 AI 也能办的出口、投诉入口留在本屏；不保存录音，离开即清。' },
    render: () => {
      if (aiOff()) return F({
        band: { eyebrow: '问小青 · AI 顾问', title: '小青暂时不可用', sub: '这一页其余功能照常，下面可以直接去办。', sealHtml: '' },
        cls: 'big-tiles xl-tiles',
        body: `<div class="remind rise" style="--i:1">${icon('alert', 34, 2.2)}<span>网络或服务出了问题，稍后可以再试。不影响打印、扫描和查政策。</span></div>
            ${sec('不用 AI，直接去办')}
            <div class="grid2">${tile({ i: 4, go: 'print', icon: 'printer', title: '打印 · 扫描', desc: '文件、纸质材料' })}${tile({ i: 5, go: 'resume', icon: 'file', title: '改简历', desc: '可以先打印原件' })}${tile({ i: 6, go: 'policy', icon: 'landmark', tone: 'slate', title: '查政策', desc: '本机构发布的内容' })}${tile({ i: 7, go: 'help', icon: 'help', tone: 'clay', title: '帮助', desc: '常见问题、服务电话' })}</div>
            <div class="howto rise" style="--i:8">${icon('call', 34, 2)}<span>需要帮助：服务电话 183-6916-1921（工作日 9:00–18:00）</span></div>
            ${fine('小青恢复后，这里会自动变回对话')}`,
        dock: { ask: false, pri: { label: '回到首页', go: 'home' } }, nav: 'xq'
      });
      return F({
        band: { eyebrow: '问小青 · AI 顾问', title: '我是小青，你想办什么？', sub: '可以说话，也可以打字。我会带你去对应的功能。', sealHtml: UI.seal('idle', 'lg') },
        cls: 'tight',
        body: `<div class="chat" id="chat">
            <div class="bub xq rise" style="--i:0;max-width:100%"><span class="ai">小青 · AI 顾问</span>我能帮你做这几件事，直接说就行：
              <div class="caps">${[['file', '改简历', '找问题、逐条改'], ['mic', '练面试', '3–8 分钟一场'], ['printer', '打印扫描', '手机、U 盘、纸质'], ['landmark', '查政策', '条件和材料']].map(c => `<div class="cap"><span>${icon(c[0], 36, 2)}</span><b>${c[1]}</b></div>`).join('')}</div></div>
            <div class="bub me rise" style="--i:1">我想把简历改一下，再打出来</div>
            <div class="bub xq rise" style="--i:2"><span class="ai">AI 生成 · 仅供参考</span>可以。先把简历传给我，我帮你看看哪里能改，每一处都由你决定改不改。
              <button class="action" data-go="resume-src"><span class="ic">${icon('file', 34, 2)}</span><span><b>去改简历</b><small>手机传、U 盘，或者扫描纸质简历</small></span><span style="margin-left:auto;color:var(--teal-ink)">${icon('arrowR', 32, 2.4)}</span></button></div>
          </div>
          <div class="transcript" id="transcript" hidden></div>
          ${sec('试试这样问')}
          <div class="chips rise" style="--i:4"><button data-act="ask" data-arg="身份证怎么复印？">身份证怎么复印？</button><button data-act="ask" data-arg="我能领什么补贴？">我能领什么补贴？</button><button data-act="ask" data-arg="面试怎么做自我介绍？">面试怎么做自我介绍？</button></div>
          <button class="rowlink rise" style="--i:5" data-go="home">${icon('layers', 32, 2)}<span><b>不用 AI 也能办</b> <small>· 打印扫描 · 改简历 · 查政策</small></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button>
          ${fine('不保存你的录音和对话 · 对回答有疑问可以在「帮助」里反馈')}`,
        dockHtml: `<footer class="composer" id="composer">
            <button class="btn sec" data-act="type">${icon('keyboard', 32, 2)}打字</button>
            <div class="mic-wrap"><button class="mic-big" data-act="listen" aria-label="按住说话">${icon('mic', 64, 2.2)}</button><div class="wave" aria-hidden="true">${'<i></i>'.repeat(9)}</div><span id="micLabel">按住说话</span></div>
            <button class="btn sec" data-act="toast" data-arg="数字人通话：试点按机构开通">${icon('video', 32, 2)}通话</button>
          </footer>`,
        nav: 'xq'
      });
    }
  });
  add('help', '公共', '帮助', {
    notes: { does: '自己解决常见问题；解决不了就打服务电话或问小青。', motion: '无循环动画；条目依次浮入。', keep: '不出现「找现场工作人员」；电话号码和服务时间后台可改；机器故障说明「我们已收到提醒」。' },
    render: () => F({
      band: { eyebrow: '帮助', title: '遇到问题了？', sub: '先看看下面有没有你的情况。', seal: 'idle', path: ['看常见问题', '问小青', '打服务电话'], pathLabel: '自己就能办完' },
      body: `<div class="grid2">${[['打印出来的纸在哪里拿？', '出纸口在屏幕下方打印机的正面，打完屏幕会提示张数。'], ['手机扫码没反应？', '用微信「扫一扫」；码过期了，点「换一个码」。'], ['身份证怎么复印？', '在打印机屏幕上点「身份证复印」，按打印机上的图示放。'], ['打印到一半停了？', '先别重复点打印，看看出纸口，再拨打下面的服务电话。'], ['U 盘读不出来？', '换一个 USB 口再插；还不行就用手机传。'], ['我的资料会留在这里吗？', '不会。办完或离开 60 秒没操作，就会清除。']].map((q, i) => `<div class="qa rise" style="--i:${i}"><b>${q[0]}</b><span>${q[1]}</span></div>`).join('')}</div>
        <div class="me-card rise" style="--i:5;background:var(--teal-wash);border-color:transparent"><span class="ic" style="width:88px;height:88px;border-radius:26px;background:var(--teal);color:#fff;display:grid;place-items:center">${icon('call', 46, 2)}</span><div><div style="font-size:22px;color:var(--teal-ink);font-weight:700">服务电话（工作日 9:00–18:00）</div><div style="font:700 52px/1.2 var(--sans);font-variant-numeric:tabular-nums;color:var(--deep)">183-6916-1921</div><div style="font-size:21px;color:var(--ink-2)">打印机出问题时，我们会自动收到提醒</div></div></div>
        ${fine('这台机器没有现场工作人员，所有事情都可以自己办完')}`,
      dock: { ask: '问小青：我遇到的不在上面' }, nav: null
    })
  });

  add('official', '公共', '本机构官方渠道', {
    notes: { does: '把本机构自己的公众号、官网放成二维码，在手机上看。', motion: '无。', keep: '托管 a：只放本机构返回的真实渠道；没有就写「本机构还没有添加」，不画假码。' },
    render: () => F({
      band: { eyebrow: '本机构官方渠道', title: '扫码，在手机上看', sub: '这些渠道由本机构维护和发布。', sealHtml: '', path: ['打开微信扫一扫', '对准下面的码', '在手机上看'], pathLabel: '怎么看' },
      body: `<div class="grid2">${[['就业指导中心公众号', '通知公告 · 活动预告 · 办事指南'], ['就业服务官网', '办事指南 · 表格下载 · 政策原文']].map((c, i) => `<div class="qrc rise" style="--i:${i}">${UI.qr(11 + i, 380)}<b>${c[0]}</b><small>${c[1]}</small><span class="chip clay">示例码，不能扫</span></div>`).join('')}</div>
        <div class="howto rise" style="--i:3">${icon('phone', 34, 2)}<span>打开微信「扫一扫」，对准上面的码，在你自己的手机上看完整内容。</span></div>
        <div class="remind rise" style="--i:4;background:var(--slate-wash);color:var(--slate-ink)">${icon('landmark', 34, 2)}<span>岗位和招聘会信息请看本机构官方渠道。这台机器不收简历、不代投递。</span></div>
        ${fine('二维码由本机构在后台添加；还没添加时，这里会写明「本机构还没有添加」')}`,
      dock: { ask: '问小青：这些渠道能办什么？' }, nav: 'home'
    })
  });
  add('login', '公共', '登录', {
    notes: { does: '要保存、找回资料时才登录；扫码是第一选择，手机号是退路。', motion: '二维码外圈轻微扩散（等待扫码时）。', keep: '不登录也能打印、扫描、查政策；登录后回到刚才那一步；只管这一次，离开自动退出。' },
    render: () => F({
      band: { eyebrow: '登录', title: '用手机微信扫一扫', sub: '登录后，改好的简历和打印记录能在手机上找到。', sealHtml: '' },
      pre: `<div class="waiting" style="display:flex;justify-content:center"><div class="qr-card"><div class="qr-box"><i class="pulse"></i><i class="pulse p2"></i>${UI.qr(5, 360)}<span class="qr-tag">示例码</span></div><b style="font-size:26px">打开微信 → 扫一扫</b></div></div>`,
      body: `<button class="tile rise" style="--i:1" data-act="toast" data-arg="演示：弹出屏上数字键盘"><span class="ic slate">${icon('phone', 34, 2)}</span><span class="tx"><b>用手机号和验证码</b><small>屏幕上有数字键盘，不用系统键盘</small></span><span class="chev">${icon('chevR', 30, 2.2)}</span></button>
        <div class="benefits rise" style="--i:2">${[['file', '改好的简历', '下次接着用'], ['receipt', '打印订单', '手机上看进度'], ['sparkle', 'AI 记录', '回看诊断和反馈']].map(b => `<div><span>${icon(b[0], 38, 2)}</span><b>${b[1]}</b><small>${b[2]}</small></div>`).join('')}</div>
        <div class="remind rise" style="--i:3;background:var(--teal-wash);color:var(--teal-ink)">${icon('shield', 34, 2)}<span>不登录也能打印、扫描、查政策。离开 60 秒没操作会自动退出。</span></div>
        ${fine('登录即表示同意《用户协议》《隐私政策》')}`,
      dock: { ask: false, pri: { label: '演示：扫码成功', act: 'login' } }, nav: 'me'
    })
  });
  add('me', '公共', '我的', {
    notes: { does: '看本人的简历、文档、订单和 AI 记录；结束时退出并清除本机资料。', motion: '数字依次浮入；退出时整屏淡出到「已清除」。', keep: '手机号打码；明细归到各业务页；注销等长期事务引到手机或服务电话，不画成在线一键完成。' },
    render: () => {
      const m = D.me;
      if (!S().logged) return F({
        band: { eyebrow: '我的', title: '登录后才能看本人记录', sub: '简历、文档、打印订单和 AI 记录都在这里。', seal: null },
        body: `${slab({ i: 1, go: 'login', title: '扫码登录', desc: '用手机微信扫一扫，几秒钟', take: '本人记录', vis: UI.qr(3, 180) })}
          ${sec('登录后能看到')}
          <div class="grid2">${[['我的简历', '改好的简历和历史版本', 'file'], ['我的文档', '扫描件、合成的 PDF', 'folder'], ['打印订单', '进度和到机码', 'receipt'], ['AI 记录', '诊断、面试反馈', 'sparkle']].map((s, i) => `<div class="stat locked rise" style="--i:${i + 4}"><span style="color:var(--ink-3)">${icon(s[2], 34, 2)}</span><span>${s[0]}</span><small>${s[1]}</small><i class="lk">${icon('lock', 24, 2)}</i></div>`).join('')}</div>
          <div class="grid2">${tile({ i: 9, go: 'help', icon: 'help', title: '帮助', desc: '常见问题' })}${tile({ i: 10, go: 'official', icon: 'qr', tone: 'slate', title: '官方渠道', desc: '扫码看' })}</div>${fine('不登录也能打印、扫描、查政策')}`,
        dock: { ask: false, pri: { label: '去登录', go: 'login' } }, nav: 'me'
      });
      return F({
        band: { eyebrow: '我的', title: `${m.name}，你好`, sub: `手机号 ${m.phone} · 这次登录只在这台机器上有效`, seal: null },
        body: `<div class="grid2">${[['resumes', '我的简历', '份', 'file'], ['docs', '我的文档', '个', 'folder'], ['orders', '打印订单', '笔', 'receipt'], ['ai', 'AI 记录', '条', 'sparkle']].map((s, i) => `<button class="stat rise" style="--i:${i}" data-go="${{ resumes: 'my-resumes', docs: 'my-docs', orders: 'my-orders', ai: 'my-ai' }[s[0]]}"><span style="color:var(--teal-ink)">${icon(s[3], 36, 2)}</span><b>${m[s[0]]}<small style="font-size:22px;margin-left:4px">${s[2]}</small></b><span>${s[1]}</span></button>`).join('')}</div>
          <div class="stack"><div class="olist-t" style="padding:0">最近办理</div><div class="qrow" style="background:var(--well)"><span class="no">${icon('printer', 20, 2.4)}</span><b>改简历 · 打印 1 张</b><small>今天 14:12</small></div><div class="qrow" style="background:var(--well)"><span class="no">${icon('mic', 20, 2.4)}</span><b>模拟面试 · HR 面试 5 分钟</b><small>10 月 22 日</small></div></div>
          ${tile({ i: 5, go: 'privacy', icon: 'shield', title: '隐私与数据请求', desc: '撤回 AI 授权等' })}
          <div class="grid2">${tile({ i: 6, go: 'notifications', icon: 'bell', title: '消息', desc: '2 条未读' })}${tile({ i: 7, go: 'settings', icon: 'user', tone: 'slate', title: '账号设置', desc: '协议、换绑、退出' })}</div>
          ${fine('示例数据 · 记录保存期限按《隐私政策》')}`,
        dock: { ask: false, back: false, left: `<button class="btn danger wide" data-act="clear" style="flex:1">${icon('logout', 32, 2.2)}退出并清除本机资料</button>` }, nav: 'me'
      });
    }
  });

  add('cleared', '公共', '已清除', {
    notes: { does: '告诉下一个人和这个人：这台机器上已经没有你的东西了。', motion: '对勾一笔画出（0.7 秒）；3 秒后淡回待机屏。', keep: '明说「已经开始的打印照常出纸」，清场不等于取消。' },
    render: () => `<div class="standby" style="justify-content:center;align-items:center;text-align:center;gap:34px">
      <div class="halo"></div>
      <svg class="big-check" viewBox="0 0 150 150" aria-hidden="true"><circle cx="75" cy="75" r="68" fill="none" stroke="#2ee6a8" stroke-width="6"/><path d="M46 77l20 20 40-42" fill="none" stroke="#2ee6a8" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <h2 style="margin:0;font:700 68px var(--serif)">已清除本次资料</h2>
      <div style="display:flex;flex-direction:column;gap:14px;font-size:28px;color:var(--mint);text-align:left">
        ${['你传到这台机器的文件', '简历修改记录和草稿', '登录状态'].map(t => `<span style="display:flex;gap:14px;align-items:center">${icon('check', 30, 2.6)}${t}</span>`).join('')}
      </div>
      <p style="font-size:26px;color:rgba(191,233,216,.8);margin:20px 0 0">已经开始的打印会照常出纸 · 3 秒后回到待机画面</p>
    </div>`,
    mount: () => { const t = setTimeout(() => window.go && window.go('standby'), 3200); return () => clearTimeout(t); }
  });

  /* ═════════ 改简历 ═════════ */
  add('resume', '改简历', '简历入口', {
    before: 'resume',
    notes: { does: '一个问题：你手上有没有简历。两条路各自往下走；其他工具放在下面，不藏。', motion: '两张主卡依次浮入；按下缩小。', keep: '八项能力都还在（两条主路 + 四个工具 + 全部简历服务）；AI 只改表达不编经历；小青入口在底部。' },
    render: () => F({
      band: { eyebrow: '改简历', title: '你手上有简历吗？', sub: '有就帮你诊断改写，没有就一步步写一份。', seal: 'idle', path: ['选简历', '小青诊断', '逐条修改', '核对打印'], pathLabel: '改简历一共 4 步' },
      body: `${slab({ i: 0, go: 'resume-src', chip: 'AI 诊断改写', ai: 1, title: '有，帮我改一改', desc: '手机传、插 U 盘，或者把纸质简历放到打印机上扫描', take: '改好的简历，当场打印', vis: UI.resume(150, 'annot') })}
        ${slab({ i: 1, go: 'scratch', chip: 'AI 起草', ai: 1, title: '没有，帮我写一份', desc: '回答几组问题，生成后由你逐条核对', take: '一份新简历', vis: UI.resume(150, 'blank') })}
        <div class="fgroup"><div class="sec-t rise" style="--i:3">也可以直接用<small>不用先诊断</small><button class="more" data-go="resume-more">全部 8 项 ${icon('chevR', 24, 2.4)}</button></div>
        <div class="grid2">
          ${tile({ i: 4, go: 'materials', icon: 'clipboard', title: '求职材料', desc: '求职信、感谢信，套模板' })}
          ${tile({ i: 5, go: 'career', icon: 'map', title: '职业规划', desc: '下一步可以做什么' })}
          ${tile({ i: 6, go: 'sa-intro', icon: 'compass', title: '自我探索', desc: '25 道题，可以不登录' })}
          ${tile({ i: 7, go: 'jobfit', icon: 'target', title: '简历对照', desc: '对照你填的岗位要求' })}
        </div></div>
        ${fine('AI 只改表达，不替你编经历 · 改完由你确认')}`,
      dock: { ask: '问小青：我该选哪一个？' }, nav: 'home'
    })
  });

  add('resume-more', '改简历', '全部简历服务（展开）', {
    notes: { does: '把不常用的入口收进一张底部面板，常用的仍在入口页平铺。', motion: '面板从下往上滑出（320 毫秒），背景变暗。', keep: '模板、直接打印（不做诊断）、我的简历、AI 记录都能找到。' },
    render: () => screens.find(s => s.id === 'resume').render() + `<div class="scrim" data-go="resume"></div><div class="sheet"><div class="grab"></div><h2>全部简历服务</h2>
      ${[['layout', '简历模板', '先看版式，再决定怎么用', '', 'templates'], ['printer', '直接打印简历', '不做诊断，选文件就打', '', 'print-src'], ['clipboard', '求职材料', '求职信、感谢信、材料清单', '', 'materials'], ['map', '职业规划', '根据你的简历给行动建议', 'AI', 'career'], ['compass', '自我探索', '25 道题，了解自己的倾向', 'AI', 'sa-intro'], ['target', '简历对照', '对照你自己填的岗位要求', 'AI', 'jobfit'], ['user', '我的简历', '登录后看保存过的版本', '登录', 'my-resumes'], ['sparkle', 'AI 服务记录', '登录后看用过几次', '登录', 'my-ai']].map((r, i) => `<button class="tile" data-go="${r[4]}" style="min-height:104px"><span class="ic ${r[3] === '登录' ? 'slate' : ''}">${icon(r[0], 32, 2)}</span><span class="tx"><b>${r[1]}${r[3] ? ` <span class="chip ${r[3] === 'AI' ? 'ai' : 'slate'}" style="height:34px;font-size:20px;vertical-align:4px">${r[3]}</span>` : ''}</b><small>${r[2]}</small></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button>`).join('')}
      <button class="btn sec" data-go="resume" style="width:100%">收起</button></div>`
  });

  add('resume-src', '改简历', '简历在哪', {
    notes: { does: '一个问题：简历在哪。三条来源各一张卡。', motion: '卡片依次浮入。', keep: '只读这次给的文件；格式和大小写清楚（PDF、JPG、PNG，10MB 内）；纸质扫描留在大屏；登录后可以选保存过的简历。' },
    render: () => F({
      band: { eyebrow: '改简历', title: '你的简历在哪里？', rail: { labels: RAIL.resume, now: 0 }, seal: 'idle' },
      body: `${slab({ i: 0, row: 1, go: 'upload', arg: 'resume', title: '在手机里', desc: '微信扫一扫，把文件传到这台机器', take: 'PDF、JPG、PNG，10MB 以内', vis: UI.phone(86) })}
        ${slab({ i: 1, row: 1, go: 'usb', arg: 'resume', title: '在 U 盘里', desc: '插到机器的 USB 口，只读你选的那一份', take: '读完提醒你拔走', vis: UI.usb(140) })}
        ${slab({ i: 2, row: 1, go: 'scan-guide', title: '是纸质的', desc: '放到打印机上扫描，扫完自动识别', take: '纸稿也能改', vis: UI.scanPaper(140) })}
        ${S().logged ? slab({ i: 3, row: 1, go: 'reading', title: '我保存过的', desc: '你上次在这里改好的简历', take: '接着改', vis: UI.resume(96, 'fixed') }) : `<button class="rowlink rise" style="--i:3" data-go="login">${icon('user', 32, 2)}<span><b>选我保存过的简历</b> <small>· 需要先登录</small></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button>`}
        ${fine('Word 文档这台机器现在读不了，请先转成 PDF · 只读取你这次给的文件')}`,
      dock: { ask: '问小青：Word 文档怎么办？' }, nav: 'home'
    })
  });
  add('upload', '改简历', '手机扫码传文件', {
    notes: { does: '手机扫码传文件。手机连上、文件到了，大屏都立刻变化。', motion: '等待时二维码外圈扩散；连上后码上盖一层「已连接」；文件卡片从上方落入。', keep: '码有失效时间，能换一个码；只收这次的文件；「换个方式」随时可以走。' },
    render: () => {
      const forPrint = S().ctx === 'print';
      return F({
        band: { eyebrow: forPrint ? '打印文件' : '改简历', title: '用手机微信扫一扫', rail: { labels: forPrint ? RAIL.print : RAIL.resume, now: 0 }, seal: null },
        pre: `<div class="waiting" id="qrWrap" style="display:flex;justify-content:center"><div class="qr-card"><div class="qr-box big"><i class="pulse"></i><i class="pulse p2"></i>${UI.qr(9, 440)}<span class="qr-tag">示例码</span><div class="qr-ok"><div style="display:flex;flex-direction:column;align-items:center;gap:10px;color:var(--teal-ink)"><svg class="big-check" viewBox="0 0 150 150" style="width:120px;height:120px"><circle cx="75" cy="75" r="68" fill="none" stroke="#1f9e86" stroke-width="7"/><path d="M46 77l20 20 40-42" fill="none" stroke="#1f9e86" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg><b style="font-size:30px">手机已连接</b><span style="font-size:22px;color:var(--ink-2)">尾号 ${D.resume.phoneTail} · 请在手机上选文件</span></div></div></div><span style="font-size:21px;color:var(--ink-3)" id="qrExp">这个码 9:58 后失效 · <u data-act="toast" data-arg="演示：换一个码">换一个码</u></span></div></div>`,
        cls: 'tight',
        body: `<div class="steps3 rise" style="--i:1" id="steps"><div class="s on"><span class="n">1</span><b>扫码</b><small>微信扫一扫</small></div><div class="s"><span class="n">2</span><b>选文件</b><small>PDF、JPG、PNG</small></div><div class="s"><span class="n">3</span><b>点上传</b><small>传完这里会显示</small></div></div>
          <div class="livebox rise" style="--i:2" id="upLive"><span class="spin"></span><div><b>等你用手机扫码</b><small>扫码后不用装任何软件</small></div></div>
          <div id="upFile"><div class="dropzone">${icon('file', 40, 1.8)}<span>传过来的文件会出现在这里</span></div></div>
          ${fine('文件只用于这次办理 · 办完自动清除')}`,
        dock: { backLabel: '换个方式', ask: '问小青：扫不上怎么办？', pri: { label: forPrint ? '下一步' : '用这份简历', go: forPrint ? 'pii' : 'reading', disabled: true, id: 'upNext' } }, nav: 'home'
      });
    },
    mount: (el) => {
      const forPrint = S().ctx === 'print';
      const t1 = setTimeout(() => {
        el.querySelector('#qrWrap').classList.remove('waiting'); el.querySelector('#qrWrap').classList.add('connected');
        const st = el.querySelectorAll('#steps .s'); st[0].classList.replace('on', 'ok'); st[0].querySelector('.n').innerHTML = '✓'; st[1].classList.add('on');
        el.querySelector('#upLive').innerHTML = `<span class="spin"></span><div><b>手机已连接，等你选文件</b><small>尾号 ${D.resume.phoneTail}</small></div>`;
      }, 2600);
      const t2 = setTimeout(() => {
        const st = el.querySelectorAll('#steps .s'); st[1].classList.replace('on', 'ok'); st[1].querySelector('.n').innerHTML = '✓'; st[2].classList.add('ok'); st[2].querySelector('.n').innerHTML = '✓';
        el.querySelector('#upLive').innerHTML = `<span style="color:var(--teal)">${icon('check', 40, 2.6)}</span><div><b>收到 1 个文件</b><small>还要传别的，可以在手机上接着传</small></div>`;
        el.querySelector('#upFile').innerHTML = `<div class="filecard fly"><span class="ft">PDF</span><div><b>${forPrint ? '毕业生就业推荐表（已填写）.pdf' : D.resume.file}</b><small>${forPrint ? '2 页 · 312 KB' : '1 页 · 186 KB'} · 刚刚收到</small></div><span style="margin-left:auto;color:var(--teal)">${icon('check', 40, 2.6)}</span></div>`;
        const b = el.querySelector('#upNext'); if (b) b.disabled = false;
      }, 5200);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  });

  add('usb', '改简历', 'U 盘选文件', {
    notes: { does: '插 U 盘，选一份文件；打不了的文件直接写明原因。', motion: '文件列表依次浮入。', keep: '只读你选的那一份；Word、WPS 写明「这台机器现在打不了，请转成 PDF」；读不出来留在本屏，可以重读或改用手机；用完提醒拔走。' },
    render: () => F({
      band: { eyebrow: S().ctx === 'print' ? '打印文件' : '改简历', title: '选一份文件', sub: '已读到你的 U 盘。', rail: { labels: S().ctx === 'print' ? RAIL.print : RAIL.resume, now: 0 }, seal: null },
      body: `<div class="sec-t">U 盘里有 4 个文件 <small>能用的 3 个</small></div>
        <div class="stack">${D.usbFiles.map((f, i) => f.no ? `<div class="filecard off rise" style="--i:${i}"><span class="ft doc">${f.t}</span><div style="min-width:0"><b>${f.n}</b><small style="color:var(--clay-ink)">${f.no}</small></div></div>` : `<button class="filecard rise" style="--i:${i};text-align:left;width:100%" data-go="${S().ctx === 'print' ? 'pii' : 'reading'}"><span class="ft ${f.t === 'JPG' ? 'img' : ''}">${f.t}</span><div style="min-width:0"><b>${f.n}</b><small>${f.p} 页 · ${f.s}</small></div><span style="margin-left:auto;color:var(--ink-3)">${icon('chevR', 34, 2.2)}</span></button>`).join('')}</div>
        <div class="remind rise" style="--i:5">${icon('usb', 34, 2)}<span>办完记得拔走 U 盘。这台机器不会保存 U 盘里的其他文件。</span></div>
        ${fine('读不出来？换一个 USB 口再插，或者改用手机传')}`,
      dock: { backLabel: '换个方式', ask: '问小青：找不到我的文件' }, nav: null
    })
  });
  add('reading', '改简历', '小青读简历', {
    notes: { does: '告诉用户现在在干什么、小青会看什么；小青不可用时直接给退路。', motion: '扫描光在纸上来回扫；当前步骤的圆圈转动；小青圆章外圈转动表示在想。全部跟真实步骤走，没有假百分比。', keep: 'AI 不可用 → 打印原件、稍后再试，不整页瘫痪（AI 是加速器，不是前置条件）。' },
    render: () => {
      const off = aiOff();
      return F({
        band: { eyebrow: '改简历 · AI 诊断', title: off ? '小青暂时不可用' : '小青正在读你的简历', sub: off ? '你的简历还在，可以先打印原件。' : '通常不到 30 秒，读完自动进入诊断结果。', rail: { labels: RAIL.resume, now: 1 }, seal: off ? null : 'think' },
        body: off ? `<div class="readgrid"><div class="reader">${UI.resume(440, 'plain').replace('paper-shadow', '')}</div>
            <div class="rcol"><div class="remind">${icon('alert', 34, 2.2)}<span>网络或服务出了问题。不影响打印，几分钟后可以再试。</span></div>
            ${tile({ go: 'confirm', icon: 'printer', title: '打印原件', desc: '不做诊断，直接打' })}${tile({ act: 'toast', arg: '演示：重试', icon: 'refresh', title: '再试一次', desc: '通常几分钟就恢复' })}${tile({ go: 'resume-src', icon: 'file', title: '换一份简历', desc: '回到上一步' })}</div></div>
            <div class="manual"><div class="olist-t" style="padding:0">小青不在时，可以先自己对照看看</div>${['每段经历有没有写做成了什么、做了多少', '应届生的教育经历是不是放在前面', '技能里有没有写你真的会用的工具', '自我评价有没有一件具体的事'].map(t => `<div><i></i>${t}</div>`).join('')}</div>
            ${fine('AI 是加速器：它不在时，打印、扫描照常可用')}`
          : `<div class="readgrid">
            <div class="reader">${UI.resume(440, 'plain').replace('paper-shadow', '')}<div class="scanline"></div></div>
            <div class="rcol">
              <div class="stagelist">
                <div class="it ok rise" style="--i:0"><span class="ico">${icon('check', 24, 3)}</span>读到文件</div>
                <div class="it now rise" style="--i:1" id="st2"><span class="ico"></span>识别内容<small>1 页</small></div>
                <div class="it rise" style="--i:2" id="st3"><span class="ico">3</span>找出可以改的地方</div>
              </div>
              <div class="aspects rise" style="--i:3"><div class="olist-t">小青会看这四方面</div>${[['表达', '有没有写清做成了什么'], ['结构', '顺序方不方便招聘方看'], ['信息', '有没有漏掉重要内容'], ['措辞', '空话、套话多不多']].map(a => `<div class="asp"><b>${a[0]}</b><small>${a[1]}</small></div>`).join('')}</div>
            </div></div>
            <div class="why rise" style="--i:4">${icon('shield', 32, 2)}<span>发给 AI 之前，会先遮住你的手机号和身份证号。</span></div>
            <div class="grid2">${tile({ i: 5, go: 'confirm', icon: 'printer', title: '不等了，先打印原件', desc: '不做诊断，直接打' })}${tile({ i: 6, go: 'resume-src', icon: 'file', title: '换一份简历', desc: '回到上一步' })}</div>
            ${fine('诊断结果只给你看，不会发给任何单位')}`,
        dock: { backLabel: '取消', ask: false, pri: off ? null : { label: '演示：读完了', go: 'diagnosis' } }, nav: null
      });
    },
    mount: (el) => {
      if (aiOff()) return;
      const t1 = setTimeout(() => { const a = el.querySelector('#st2'), b = el.querySelector('#st3'); if (!a) return; a.className = 'it ok'; a.querySelector('.ico').innerHTML = icon('check', 24, 3); b.className = 'it now'; b.querySelector('.ico').innerHTML = ''; }, 2200);
      const t2 = setTimeout(() => window.go && window.go('diagnosis'), 5200);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  });
  add('diagnosis', '改简历', '诊断结果', {
    notes: { does: '先给结论（几处、哪几类），再给最重要的三处；主动作是逐条改。', motion: '五个编号依次在简历小样上亮起；问题卡依次浮入。', keep: '标「AI 生成 · 仅供参考」；诊断报告可以单独打印带走；原件不被覆盖。' },
    render: () => F({
      band: { eyebrow: '诊断结果 · AI 生成，仅供参考', title: '找到 5 处可以改得更好', sub: '表达 2 处 · 结构 1 处 · 缺少 1 处 · 措辞 1 处', rail: { labels: RAIL.resume, now: 1 }, seal: 'idle' },
      body: `<div style="display:grid;grid-template-columns:330px 1fr;gap:28px;align-items:start">
          <div style="display:flex;flex-direction:column;align-items:center;gap:12px;position:sticky;top:0">${UI.resume(330, 'annot')}<span class="fine">你的简历 · 1 页 · 编号对应右边</span></div>
          <div style="display:flex;flex-direction:column;gap:12px">${D.issues.map((x, i) => `<div class="issue rise" style="--i:${i}"><span class="no">${i + 1}</span><div><span class="chip clay">${x.cat}</span><b>${x.title}</b><small>${x.hint}</small></div></div>`).join('')}</div>
        </div>
        <button class="rowlink rise" style="--i:5" data-act="toast" data-arg="演示：打印诊断报告（1 页）">${icon('printer', 32, 2)}<span><b>打印诊断报告</b> <small>· 1 页，带走慢慢看</small></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button>
        ${fine('原件不会被覆盖 · 每一处改不改都由你决定')}`,
      dock: { ask: '问小青：为什么这么改？', pri: { label: '逐条改（5 处）', go: 'optimize', arg: 'reset' } }, nav: null
    })
  });

  add('optimize', '改简历', '逐条修改', {
    notes: { does: '一屏只看一处：原来怎么写、建议怎么写、为什么。三个按钮做一个决定。', motion: '换到下一处时内容淡入；结构类建议用色块移动演示顺序变化；空格填数字时变绿。', keep: '不替你编数字：需要数字的地方留空让你填；「换个改法」「跟小青说几句」在本屏；保留原文永远可选。' },
    render: () => {
      const st = S(), i = st.opt, s = D.sugg[i];
      const where = ['实习经历', '版面顺序', '技能', '校园经历', '自我评价'];
      const list = `<div class="olist rise" style="--i:0"><div class="olist-t">改动清单</div>${D.sugg.map((x, k) => `<div class="orow ${k < i ? 'ok' : k === i ? 'now' : ''}"><span class="no">${k < i ? icon('check', 22, 3) : k + 1}</span><span class="tx"><b>${where[k]}</b><small>${x.cat}</small></span><span class="st">${k < i ? (st.decided[k] || '已采纳') : k === i ? '正在看' : '待看'}</span></div>`).join('')}</div>`;
      let right = '';
      if (s.kind === 'reorder') {
        right = `<div class="reo2"><div class="reorder"><div class="olab">原来的顺序</div>${s.before.map(b => `<div class="blk ${b === '教育经历' ? 'hl' : ''}" style="background:var(--well)">${b}</div>`).join('')}</div>
          <div style="color:var(--teal);display:grid;place-items:center">${icon('arrowR', 44, 2.4)}</div>
          <div class="reorder" id="reo"><div class="olab" style="color:var(--teal-ink)">建议的顺序</div>${s.before.map(b => `<div class="blk ${b === '教育经历' ? 'hl' : ''}" data-b="${b}">${b}</div>`).join('')}</div></div>`;
      } else if (s.kind === 'choice') {
        right = `<div class="cmp"><div class="box old"><div class="lab">原来</div>${s.old}</div></div>
          <div style="display:flex;flex-direction:column;gap:14px">${['删掉这一段', '换成一件具体的事'].map((c, k) => `<button class="tile" data-act="toast" data-arg="演示：${c}" style="min-height:112px"><span class="ic">${icon(k ? 'mic' : 'erase', 32, 2)}</span><span class="tx"><b>${c}</b><small>${k ? '小青问你两三个问题，再帮你组织成一句话' : '删掉后这一段不再出现'}</small></span></button>`).join('')}</div>`;
      } else {
        right = `<div class="cmp"><div class="box old rise" style="--i:1"><div class="lab">原来</div>${s.old}</div>
          <div class="arrowdown">${icon('arrowD', 40, 2.4)}</div>
          <div class="box new rise" style="--i:2"><div class="lab">${icon('sparkle', 26, 2)}AI 建议稿</div><span id="neu">${s.neu}</span></div></div>`;
      }
      const mid = `<div class="optgrid">${list}<div class="optright">${right}<div class="why">${icon('help', 32, 2)}<span><b>为什么这样改：</b>${s.why}</span></div></div></div>`;
      const hasBlank = /data-blank/.test(s.neu || '');
      return F({
        band: { kind: 'compact', eyebrow: `第 ${i + 1} 处 / 共 5 处 · ${s.cat}`, title: s.kind === 'reorder' ? '把教育经历挪到前面，可以吗？' : s.kind === 'choice' ? '这一段怎么处理？' : '这句这样改，可以吗？', rail: { labels: RAIL.resume, now: 2 }, seal: null,
          sealHtml: '' },
        pre: '',
        body: `${mid}
          <div class="where">${UI.resume(110, 'annot').replace('paper-shadow', '')}<div><span>这一处在你的简历里</span><b>${['实习经历 · 第 1 条', '整份简历的版面顺序', '技能', '校园经历 · 第 2 条', '自我评价'][i]}</b><small>只改这一处，其他内容不动；改完可以在对比页整页核对</small></div></div>
          ${hasBlank ? `<div class="grid2"><button class="tile" data-act="fill" style="min-height:104px;border-color:rgba(184,104,60,.5)"><span class="ic clay">${icon('keyboard', 32, 2)}</span><span class="tx"><b>填写真实数字</b><small>屏上数字键盘</small></span></button><button class="tile" data-act="toast" data-arg="演示：AI 换一种写法" style="min-height:104px"><span class="ic">${icon('refresh', 32, 2)}</span><span class="tx"><b>换个改法</b><small>AI 再给一种写法</small></span></button></div>`
            : `<div class="grid2"><button class="tile" data-act="toast" data-arg="演示：AI 换一种写法" style="min-height:104px"><span class="ic">${icon('refresh', 32, 2)}</span><span class="tx"><b>换个改法</b><small>AI 再给一种写法</small></span></button><button class="tile" data-go="xq" style="min-height:104px"><span class="ic">${icon('mic', 32, 2)}</span><span class="tx"><b>跟小青说几句</b><small>说清楚再改</small></span></button></div>`}
          
          ${fine('不会替你编数字和经历 · 每一处都可以保留原文')}`,
        dockHtml: `<footer class="dock"><button class="btn sec" data-act="opt" data-arg="keep">保留原文</button><button class="btn sec" data-act="toast" data-arg="演示：自己改（大号输入框 + 可说话填写）">${icon('pen', 30, 2)}自己改</button><button class="btn pri wide" data-act="opt" data-arg="take">${s.kind === 'choice' ? '删掉这一段' : '采纳这一处'}${icon('check', 30, 2.6)}</button></footer>`,
        nav: null
      });
    },
    mount: (el) => {
      const s = D.sugg[S().opt];
      if (s.kind !== 'reorder') return;
      const t = setTimeout(() => {
        const reo = el.querySelector('#reo'); if (!reo) return;
        const blocks = [...reo.querySelectorAll('.blk')]; const h = 86;
        blocks.forEach(b => { const from = s.before.indexOf(b.dataset.b), to = s.after.indexOf(b.dataset.b); b.style.transform = `translateY(${(to - from) * h}px)`; });
      }, 700);
      return () => clearTimeout(t);
    }
  });

  add('compare', '改简历', '改前改后对比', {
    notes: { does: '对比独占一屏（他 8/18 说过：对比类要单独一页）。确认无误再去打印。', motion: '右侧改动处的绿色底色依次亮起。', keep: '标「AI 建议稿 · 已由你逐条确认」；没登录要说清楚：不登录不会存进「我的简历」。' },
    render: () => F({
      band: { kind: 'compact', eyebrow: '改简历', title: '改完了，对比看看', sub: '采纳 4 处，保留 1 处，2 个数字已由你填写', rail: { labels: RAIL.resume, now: 3 }, seal: null },
      body: `<div class="seg" role="group" aria-label="对比方式"><button aria-pressed="true">并排对比</button><button aria-pressed="false" data-act="toast" data-arg="演示：只看改后（整页放大）">只看改后</button></div>
        <div class="pair"><figure>${UI.resume(452, 'plain')}<figcaption>原来</figcaption></figure><figure>${UI.resume(452, 'fixed')}<figcaption style="color:var(--teal-ink)">改后 · AI 建议稿，已由你确认</figcaption></figure></div>
        ${S().logged ? '' : `<button class="rowlink" data-go="login">${icon('user', 32, 2)}<span><b>想下次接着用？</b> <small>· 登录后可以存进「我的简历」</small></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button>`}
        ${fine('不登录也能打印；离开后这台机器上的修改记录会被清除')}`,
      dock: { backLabel: '再改改', ask: '问小青：还能怎么改？', pri: { label: '去打印', go: 'confirm', arg: 'resume' } }, nav: null
    })
  });
  add('scratch', '改简历', '从零写：在哪写', {
    notes: { does: '长任务默认引到手机（10/10 定），大屏完整流程留作退路。', motion: '无循环动画。', keep: '上线条件：「用手机写」这张卡是开关——带 AI 的小程序上架、手机上真能办之前不显示，那时屏上只有「就在这台机器上写」。' },
    render: () => F({
      band: { eyebrow: '从零写简历', title: '在哪写比较方便？', sub: '写一份简历要 10 到 15 分钟，坐下来用手机写更轻松。', seal: 'idle', path: ['想找的工作', '教育', '经历', '技能', '核对生成'], pathLabel: '要写的' },
      body: `${slab({ i: 0, go: 'scratch-1', dark: 1, chip: '推荐', ck: 'ghost', title: '用手机写', desc: '扫码在手机上慢慢写，写好回到这台机器打印', take: '一份新简历', vis: UI.qr(4, 190) })}
        ${slab({ i: 2, go: 'scratch-1', chip: 'AI 起草', ai: 1, title: '就在这台机器上写', desc: '6 步，每步几个问题；可以说话填写，少打字', take: '一份新简历', vis: UI.resume(150, 'blank') })}
        <div class="manual rise" style="--i:3"><div class="olist-t" style="padding:0">写之前想一想这几样</div>${['学校、专业和在校时间', '实习或工作：在哪、做了什么、做成了什么', '校园活动、获奖和证书', '会用的工具和技能'].map(t => `<div><i></i>${t}</div>`).join('')}</div>
        ${fine('写的内容都由你提供，AI 只帮你组织语言')}`,
      dock: { ask: '问小青：写简历要准备什么？' }, nav: 'home'
    })
  });

  add('scratch-1', '改简历', '从零写：第 1 步', {
    notes: { does: '一步只问一类事；能点选的不让打字；可以说话填写；下面实时显示草稿。', motion: '说话时麦克风按钮外圈扩散；识别出的字逐字出现在输入框；草稿里新填的一行淡入。', keep: '姓名和目标岗位必填；语音转写要本人确认；AI 不可用时仍能把你填的原话导出打印。' },
    render: () => F({
      band: { kind: 'compact', eyebrow: '从零写简历 · 第 1 步 / 共 6 步', title: '你想找什么工作？', rail: { labels: ['想找的工作', '教育', '实习与工作', '校园经历', '技能证书', '核对生成'], now: 0 }, seal: null },
      cls: 'tight',
      body: `<div class="fgroup"><label class="sec-t" for="role">目标岗位 <small>必填，可以说话填</small></label>
        <div class="field"><input id="role" placeholder="例如：新媒体运营" value="新媒体运营"><button class="mic" data-act="toast" data-arg="演示：说话填写">${icon('mic', 38, 2.2)}</button></div>
        <div class="chips">${D.roles.slice(0, 5).map((r, i) => `<button aria-pressed="${i === 0}" data-act="chip">${r}</button>`).join('')}</div></div>
        <div class="fgroup"><div class="sec-t">想在哪个城市 <small>可以多选</small></div>
        <div class="chips">${['青岛', '济南', '烟台', '不限'].map((r, i) => `<button aria-pressed="${i === 0}" data-act="chip">${r}</button>`).join('')}</div></div>
        <div class="fgroup"><div class="sec-t">什么时候能到岗</div>
        <div class="seg"><button aria-pressed="true">毕业后</button><button aria-pressed="false" data-act="seg">一个月内</button><button aria-pressed="false" data-act="seg">随时</button></div></div>
        <div class="draft rise" style="--i:6"><div class="dleft">${UI.resume(120, 'blank')}</div><div class="kvs"><div class="olist-t" style="padding:0">简历草稿 · 边填边生成</div><div><span>目标岗位</span><b>新媒体运营</b></div><div><span>城市</span><b>青岛</b></div><div><span>到岗</span><b>毕业后</b></div><div><span>还差</span><b>教育、经历、技能 · 5 步</b></div></div></div>
        ${fine('需要打字时，输入框和「下一步」会留在键盘上方')}`,
      dock: { ask: '问小青：帮我说清楚', pri: { label: '下一步', act: 'toast', arg: '演示到这里：后面 5 步结构相同' } }, nav: null
    })
  });
  add('interview', '练面试', '练面试入口', {
    notes: { does: '一个主动作「马上练一场」，流程三步写清楚；技巧和记录放下面。', motion: '卡片浮入。', keep: '只供本人练习，不做录用判断；记录要登录；麦克风不行随时改打字。' },
    render: () => F({
      band: { eyebrow: '练面试 · AI 模拟面试', title: '想练一场面试吗？', sub: '选岗位和面试官，3 到 8 分钟，练完拿一份反馈。', seal: 'idle', path: ['三步设置', '回答问题', '拿到反馈'], pathLabel: '一场练习' },
      body: `${slab({ i: 0, go: 'iv-1', dark: 1, chip: 'AI 模拟面试', ck: 'ghost', title: '马上练一场', desc: '三步设置好，用说的或打字回答', take: '练习反馈报告（可打印）', vis: UI.report(160) })}
        <div class="process rise" style="--i:1">${[['clipboard', '三步设置', '岗位、面试官、时长'], ['mic', '回答问题', '说或者打字都行'], ['printer', '拿到反馈', '可以打印带走']].map((p, k) => `<div class="ps"><span class="n">${k + 1}</span><span class="pi">${icon(p[0], 36, 2)}</span><b>${p[1]}</b><small>${p[2]}</small></div>`).join(`<span class="pa">${icon('arrowR', 30, 2.4)}</span>`)}</div>
        <div class="grid2">${tile({ i: 2, go: 'iv-tips', icon: 'book', title: '面试技巧', desc: '常见问题怎么答' })}${tile({ i: 3, go: 'iv-reports', icon: 'receipt', tone: 'slate', title: '我的练习记录', desc: S().logged ? '共 2 场' : '没登录约保留 2 小时' })}</div>
        <div class="why rise" style="--i:4">${icon('mic', 32, 2)}<span>想用说的回答，开始前会先试一下麦克风；不行就打字，不影响练习。</span></div>
        ${fine('练习只供你自己参考，不代表录用结果')}`,
      dock: { ask: '问小青：第一次练选哪个？' }, nav: 'home'
    })
  });
  add('iv-1', '练面试', '设置 1：岗位与经验', {
    before: 'interview',
    notes: { does: '第 1 步只定「练哪个岗位、你的经验」。岗位能点选也能说。', motion: '选中时卡片底色过渡（120 毫秒）；步骤条填充。', keep: '岗位预设和自由输入都保留；行业须本人确认；上一步回来选择不丢。' },
    render: () => {
      const iv = S().iv;
      return F({
        band: { kind: 'compact', eyebrow: '练面试 · 第 1 步 / 共 3 步', title: '这次练哪个岗位？', rail: { labels: RAIL.iv, now: 0 }, seal: null },
        cls: 'tight',
        body: `<div class="fgroup"><div class="field"><input id="ivRole" value="${iv.role}" placeholder="说或者点下面的岗位"><button class="mic" data-act="toast" data-arg="演示：说话填写">${icon('mic', 38, 2.2)}</button></div>
          <div class="chips">${D.roles.map(r => `<button aria-pressed="${iv.role === r}" data-act="iv" data-arg="role:${r}">${r}</button>`).join('')}</div></div>
          <div class="fgroup"><div class="sec-t">行业 <small>根据岗位推荐，点一下确认</small></div>
          <div class="chips">${D.industries.map(r => `<button aria-pressed="${iv.industry === r}" data-act="iv" data-arg="industry:${r}">${r}</button>`).join('')}<button data-act="toast" data-arg="演示：完整行业清单（20 个）">更多行业 ›</button></div></div>
          <div class="fgroup"><div class="sec-t">你的工作经验</div>
          <div class="seg" style="flex-wrap:wrap">${D.exps.map(e => `<button style="flex:1 1 30%" aria-pressed="${iv.exp === e}" data-act="iv" data-arg="exp:${e}">${e}</button>`).join('')}</div></div>
          <div class="topics"><div class="olist-t" style="padding:0">这个岗位常练的方向（示例）</div><div class="row"><span>自我介绍</span><span>作品和数据</span><span>选题与复盘</span><span>求职动机</span><span>反问环节</span></div></div>
          <div class="sumline">${icon('check', 30, 2.6)}<span>后面两步不改的话：<b>HR 面试 · 标准难度 · 5 分钟 · 说出来</b></span></div>
          ${fine('需要打字时，输入框和「下一步」会留在键盘上方')}`,
        dock: { ask: '问小青：我不知道选哪个岗位', pri: { label: '下一步', go: 'iv-2' } }, nav: null
      });
    }
  });

  add('iv-2', '练面试', '设置 2：面试官与时长', {
    notes: { does: '第 2 步选面试官；难度和时长有默认值，不改也能走。', motion: '选中面试官时出现对勾、边框变绿。', keep: '五类面试官、三档难度、3/5/8 分钟全部保留。' },
    render: () => {
      const iv = S().iv;
      return F({
        band: { kind: 'compact', eyebrow: '练面试 · 第 2 步 / 共 3 步', title: '选一位面试官', rail: { labels: RAIL.iv, now: 1 }, seal: null },
        cls: 'tight',
        body: `<div class="plist">${D.interviewers.map((p, i) => `<button class="persona" aria-pressed="${iv.who === p.k}" data-act="iv" data-arg="who:${p.k}"><span class="av" style="background:${p.c}">${p.a}</span><span><b>${p.l}</b><small>${p.d}</small><em>常问：${p.q}</em></span><span class="tick">${icon('check', 36, 2.8)}</span></button>`).join('')}</div>
          <div class="sec-t">难度 <small>默认标准</small></div>
          <div class="seg tall">${D.diffs.map(d => `<button aria-pressed="${iv.diff === d[0]}" data-act="iv" data-arg="diff:${d[0]}">${d[1]}<small>${d[2]}</small></button>`).join('')}</div>
          <div class="sec-t">时长 <small>到点自动结束</small></div>
          <div class="seg tall">${D.durs.map(d => `<button aria-pressed="${iv.dur === d[0]}" data-act="iv" data-arg="dur:${d[0]}">${d[1]}<small>${d[2]}</small></button>`).join('')}</div>`,
        dock: { backLabel: '上一步', ask: false, pri: { label: '下一步', go: 'iv-3' }, mid: `<button class="askq" data-go="xq"><span class="mic">${icon('mic', 30, 2.2)}</span><span>问小青：选哪位？</span></button>` }, nav: null
      });
    }
  });

  add('iv-3', '练面试', '设置 3：核对开始', {
    notes: { does: '集中核对一次；哪项不对点「改」回到那一步，已选的不丢。', motion: '无循环动画。', keep: '回答方式进入后检测麦克风；不上传简历也能练；年满 14 周岁提示。' },
    render: () => {
      const iv = S().iv, who = D.interviewers.find(p => p.k === iv.who), dif = D.diffs.find(d => d[0] === iv.diff), dur = D.durs.find(d => d[0] === iv.dur);
      return F({
        band: { kind: 'compact', eyebrow: '练面试 · 第 3 步 / 共 3 步', title: '核对一下，就开始', rail: { labels: RAIL.iv, now: 2 }, seal: null },
        cls: 'tight',
        body: `<div class="sumcard">
            <div class="r"><span>岗位</span><b>${iv.role} · ${iv.industry} · ${iv.exp}</b><button class="edit" data-go="iv-1">改</button></div>
            <div class="r"><span>面试官</span><b>${who.l} · ${dif[1]}</b><button class="edit" data-go="iv-2">改</button></div>
            <div class="r"><span>时长</span><b>${dur[1]}（${dur[2]}）</b><button class="edit" data-go="iv-2">改</button></div></div>
          <div class="fgroup"><div class="sec-t">怎么回答</div>
          <div class="seg tall"><button aria-pressed="${iv.mode === 'voice'}" data-act="iv" data-arg="mode:voice">${icon('mic', 30, 2)} 说出来<small>开始前先试麦克风</small></button><button aria-pressed="${iv.mode === 'text'}" data-act="iv" data-arg="mode:text">${icon('keyboard', 30, 2)} 打字<small>任何时候都能用</small></button></div></div>
          <div class="fgroup"><div class="sec-t">带上简历 <small>可选，题目会更贴近你的经历</small></div>
          <div class="seg"><button aria-pressed="true">不用</button><button aria-pressed="false" data-act="toast" data-arg="演示：手机扫码传简历">手机传</button><button aria-pressed="false" data-act="toast" data-arg="演示：U 盘选简历">U 盘</button></div></div>
          <div class="process">${[['mic', '面试官出题', '可以再听一遍'], ['message', '你来回答', '答完点「下一题」'], ['clock', '时间到就结束', '马上出反馈']].map((p, k) => `<div class="ps"><span class="n">${k + 1}</span><span class="pi">${icon(p[0], 34, 2)}</span><b>${p[1]}</b><small>${p[2]}</small></div>`).join(`<span class="pa">${icon('arrowR', 28, 2.4)}</span>`)}</div>
          ${fine('练习只供你自己参考，不代表录用结果 · 使用 AI 即表示你已年满 14 周岁')}`,
        dock: { backLabel: '上一步', ask: false, pri: { label: '开始练习', go: 'iv-run', kind: 'pri wide' } }, nav: null
      });
    }
  });

  add('iv-run', '练面试', '面试进行中', {
    notes: { does: '题目放在最显眼处；回答区在手够得着的地方；倒计时一直可见。', motion: '面试官说话时圆章外圈扩散；回答时声波条跳动；倒计时圆环每秒走一格；时间到自动结束。', keep: '语音不可用随时切打字；到点硬结束；不录音保存。' },
    render: () => {
      const iv = S().iv, who = D.interviewers.find(p => p.k === iv.who), q = iv.q;
      return `<header class="band compact">${UI.flowLines(560)}<div class="halo"></div>${UI.header({ back: false })}
          <div class="ask" style="flex-direction:column;align-items:stretch;gap:22px;padding-bottom:44px">
            <div style="display:flex;align-items:center;gap:20px"><span class="seal sm listen" style="background:${who.c};font:700 24px var(--sans)">${who.a}</span><div style="flex:1"><div class="eyebrow">${who.l} · 第 ${q + 1} 题 / 约 5 题</div><div style="font-size:21px;color:var(--mint)">AI 面试官 · 仅供练习</div></div>
              <div class="timer" id="timer">${UI.ring(1, 132, 10, '#2ee6a8', 'rgba(255,255,255,.14)')}<b id="tleft">${iv.dur}:00</b><small>剩余</small></div></div>
            <p class="qtext">${D.questions[q]}</p></div></header>
        <main class="body ${iv.mode === 'voice' ? '' : ''}" id="ivBody">
          ${iv.mode === 'voice' ? `<div class="transcript" id="ivTx" style="min-height:540px;font-size:30px;line-height:1.7">按住下面的按钮开始回答，松开就停。</div>
            <div class="mic-wrap" style="margin-top:20px"><button class="mic-big" data-act="ivlisten" style="margin:0">${icon('mic', 64, 2.2)}</button><div class="wave">${'<i></i>'.repeat(11)}</div><span>按住回答</span></div>`
          : `<div class="fgroup"><label class="sec-t" for="ivText">你的回答</label><textarea id="ivText" style="height:860px;border-radius:28px;border:2px solid rgba(31,158,134,.55);padding:26px;font:500 28px/1.6 var(--sans);background:var(--card);color:var(--ink);resize:none" placeholder="在这里输入回答"></textarea></div>`}
          <div class="howto">${icon('book', 34, 2)}<span>可以按这四步说：当时的情况 → 你要做的事 → 你怎么做的 → 结果怎样</span></div>
          <div class="chips" style="justify-content:center"><button data-act="toast" data-arg="演示：再念一遍题目">${icon('sound', 26, 2)} 再听一遍题目</button><button data-act="iv" data-arg="mode:${iv.mode === 'voice' ? 'text' : 'voice'}">${icon(iv.mode === 'voice' ? 'keyboard' : 'mic', 26, 2)} 改成${iv.mode === 'voice' ? '打字' : '说话'}</button></div>
          ${fine('练习过程不录音保存 · 时间到会自动结束')}</main>
        ${dock({ back: false, left: `<button class="btn sec" data-act="toast" data-arg="演示：确认后结束，已答部分生成报告">结束练习</button>`, ask: false, pri: { label: q < 4 ? '回答完了，下一题' : '回答完了，看反馈', act: 'ivnext', kind: 'pri wide' } })}`;
    },
    mount: (el) => {
      const iv = S().iv; let left = iv.dur * 60 - 48 - iv.q * 40;
      const tl = el.querySelector('#tleft'), arc = el.querySelector('#timer .arc');
      const total = iv.dur * 60, C = parseFloat(arc.getAttribute('stroke-dasharray'));
      const upd = () => { const m = Math.floor(left / 60), s = left % 60; tl.textContent = `${m}:${String(s).padStart(2, '0')}`; arc.setAttribute('stroke-dashoffset', C * (1 - left / total)); };
      upd(); const t = setInterval(() => { left = Math.max(0, left - 1); upd(); if (!left) { clearInterval(t); window.go('iv-report'); } }, 1000);
      return () => clearInterval(t);
    }
  });

  add('iv-report', '练面试', '练习反馈', {
    notes: { does: '一句总评 + 做得好的三条 + 可以更好的三条 + 每题一句；主动作是打印报告。', motion: '两栏依次浮入。', keep: '标「AI 生成 · 仅供参考」；AI 不可用时给通用题目单，不能装成点评；报告只给本人。' },
    render: () => F({
      band: { eyebrow: '练习反馈 · AI 生成，仅供参考', title: D.report.title, sub: `${D.interviewers.find(p => p.k === S().iv.who).l} · ${S().iv.role} · 答了 5 题`, sealHtml: `<div style="flex:none">${UI.report(116)}</div>` },
      body: `<div class="grid2" style="align-items:stretch">
          <div class="report-col rise" style="--i:0"><h4 style="color:var(--teal-ink)">${icon('check', 30, 2.6)}做得好的</h4><ul>${D.report.good.map(g => `<li>${g}</li>`).join('')}</ul></div>
          <div class="report-col rise" style="--i:1"><h4 style="color:var(--clay-ink)">${icon('arrowR', 30, 2.4)}可以更好的</h4><ul>${D.report.better.map(g => `<li>${g}</li>`).join('')}</ul></div></div>
        <div class="olist rise" style="--i:2"><div class="olist-t">每一题</div>${D.questions.map((q, k) => `<div class="qrow"><span class="no">${k + 1}</span><b>${q}</b><small>${['清楚', '缺少数字', '步骤不全', '动机清楚', '可以多问'][k]}</small></div>`).join('')}</div>
        <div class="grid2">${tile({ i: 3, go: 'iv-1', icon: 'refresh', title: '再练一场', desc: '换个面试官' })}${tile({ i: 4, go: S().logged ? 'me' : 'login', icon: 'user', tone: 'slate', title: '存到我的', desc: S().logged ? '已登录' : '需要登录' })}</div>
        ${fine('练习只供你自己参考，不代表录用结果 · 报告 2 页')}`,
      dock: { backLabel: '回到入口', ask: '问小青：第 2 题怎么答更好？', pri: { label: '打印报告', go: 'confirm', arg: 'report' } }, nav: null
    })
  });
  add('print', '打印扫描', '打印 · 扫描 · 复印入口', {
    before: 'print',
    notes: { does: '先问要办哪件事：四件各一张卡；不常用的四个工具放下面一行。', motion: '卡片依次浮入；打印机状态点在就绪时静止，出问题时变色。', keep: '打印机状态只说真的（读不到就写读不到）；状态只在顶部说一次，不在每张卡上重复；到机码是独立入口。' },
    render: () => {
      const off = printerOff();
      return F({
        band: { eyebrow: '打印 · 扫描 · 复印', title: '要办哪件事？', sub: off ? '打印机暂时连不上：出纸和扫描先停，文件可以先传、先看。' : 'A4 · 黑白和彩色 · 自动双面 · 本机构免费', seal: 'idle', status: off ? { text: '打印机暂时连不上', warn: 1 } : undefined, path: ['选文件', '预览设置', '核对', '取件'], pathLabel: '打印文件一共 4 步' },
        body: `<div class="grid2">
            ${slabMini({ i: 0, go: 'print-src', ic: 'printer', t: '打印文件', d: '手机里、U 盘里的文件', take: '打印件', off, vis: UI.stack(110, 3) })}
            ${slabMini({ i: 1, go: 'scan-type', ic: 'scan', t: '扫描纸质材料', d: '扫成 PDF，可以存、可以打', take: '扫描件', off, vis: UI.scanPaper(130) })}
            ${slabMini({ i: 2, go: 'copy', ic: 'idcard', t: '复印证件', d: '身份证、票据，在打印机上复印', take: '复印件', off, vis: UI.idcard(140) })}
            ${slabMini({ i: 3, go: 'pickup', ic: 'ticket', t: '手机下单来取件', d: '输入小程序里的到机码', take: '订单里的打印件', off: false, note: off ? '订单还在，稍后再来取' : '', vis: codeArt() })}
          </div>
          ${off ? `<div class="remind rise" style="--i:4">${icon('call', 34, 2)}<span>我们已经收到提醒，会尽快处理。需要帮助请拨打服务电话 183-6916-1921（工作日 9:00–18:00）。</span></div>` : ''}
          ${sec('其他工具')}
          <div class="grid2">${tile({ i: 5, go: 'img2pdf', icon: 'image', title: '照片合成 PDF', desc: '几张照片拼成一个文件' })}${tile({ i: 6, go: 'sign', icon: 'pen', title: '签名', desc: '本机构暂未开通', off: 1 })}${tile({ i: 7, go: S().logged ? 'my-docs' : 'login', icon: 'folder', tone: 'slate', title: '我的文档', desc: '登录后选文件' })}${tile({ i: 8, go: S().logged ? 'my-orders' : 'login', icon: 'receipt', tone: 'slate', title: '打印订单', desc: '看进度和到机码' })}</div>
          ${fine('本机构的机器打印免费 · 文件办完自动清除')}`,
        cls: off ? 'print-off' : '',
        dock: { ask: '问小青：怎么选打印方式？' }, nav: 'home'
      });
    }
  });
  function codeArt() { return `<div class="codeart">${'38461207'.split('').map(d => `<i>${d}</i>`).join('')}</div>`; }
  function slabMini(o) {
    return `<button class="task rise" style="--i:${o.i};min-height:300px;${o.off ? 'opacity:.55' : ''}" ${o.off ? 'data-act="toast" data-arg="打印机连不上，这一项先停"' : `data-go="${o.go}"`}><div class="top"><span class="ic">${icon(o.ic, 40, 2)}</span>${o.off ? '<span class="chip clay">暂停</span>' : ''}</div><h3 style="font-size:36px">${o.t}</h3><p style="max-width:250px">${o.d}</p><div class="take">${icon('check', 24, 2.6)}带走：${o.take}</div>${o.note ? `<span class="chip clay">${o.note}</span>` : ''}${o.vis ? `<div class="mini">${o.vis}</div>` : ''}</button>`;
  }

  add('print-src', '打印扫描', '文件在哪', {
    notes: { does: '一个问题：文件在哪；能打什么、多大，在这一屏说清楚。', motion: '卡片依次浮入。', keep: '只能打 PDF、JPG、PNG，单个 10MB 以内（代码现状）；Word、WPS、手机 HEIC 照片要先转；登录后多一张「我的文档」。' },
    render: () => F({
      band: { eyebrow: '打印文件', title: '文件在哪里？', rail: { labels: RAIL.print, now: 0 }, seal: 'idle' },
      body: `${slab({ i: 0, row: 1, go: 'upload', arg: 'print', title: '在手机里', desc: '微信扫一扫，把文件传过来', take: '不用装软件', vis: UI.phone(86) })}
        ${slab({ i: 1, row: 1, go: 'usb', arg: 'print', title: '在 U 盘里', desc: '插到机器的 USB 口，选一份文件', take: '用完提醒你拔走', vis: UI.usb(140) })}
        ${S().logged ? slab({ i: 2, row: 1, go: 'me', title: '在「我的文档」里', desc: '你登录后保存过的文件', take: '直接选', vis: UI.stack(100, 2) }) : `<button class="rowlink rise" style="--i:2" data-go="login">${icon('folder', 32, 2)}<span><b>选我的文档</b> <small>· 需要先登录</small></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button>`}
        <div class="fmt rise" style="--i:3"><div class="olist-t">能打印的文件</div><div class="fmtrow">${[['PDF', '.pdf', ''], ['图片', '.jpg  .png', ''], ['Word', '.doc  .docx', 'no'], ['手机照片', '.heic', 'no']].map(f => `<span class="${f[2]}"><b>${f[0]}</b><small>${f[2] ? '先转成 PDF 或 JPG' : f[1]}</small></span>`).join('')}</div><small>单个文件不超过 10MB · A4 纸</small></div>
        ${fine('只读取你这次给的文件 · 办完自动清除')}`,
      dock: { ask: '问小青：Word 文档怎么转？' }, nav: 'home'
    })
  });
  add('pii', '打印扫描', '隐私确认', {
    notes: { does: '发现证件号这类信息时，先问一句：遮住还是保留。只在发现时出现。', motion: '遮挡条从左往右盖上（360 毫秒）。', keep: '隐私预检不能跳过，不依赖 AI；是本人证件才能选保留。' },
    render: () => F({
      band: { kind: 'compact', eyebrow: '打印文件 · 隐私检查', title: '第 1 页有身份证号码', sub: '公共打印机出纸后可能被别人看到。', rail: { labels: RAIL.print, now: 1 }, seal: null },
      body: `<div class="preview" style="padding:40px"><div class="docmock">
          <div class="dt">毕业生就业推荐表</div>
          <div>姓名：李佳怡　　性别：女</div><div>学院：文学院　专业：汉语言文学</div><div>身份证号：<span class="maskwrap">370 2●● ●●●● ●●●● 2●2X<span class="mask"></span></span></div><div>联系电话：138****6721</div><div>毕业时间：2026 年 6 月</div><div style="opacity:.45">……</div></div></div>
        <div class="grid2 big-tiles"><button class="tile" data-go="preview" style="border-color:var(--teal);border-width:2.5px"><span class="ic">${icon('eye', 34, 2)}</span><span class="tx"><b>遮住再打印</b><small>推荐 · 只遮身份证号这一处</small></span></button><button class="tile" data-act="toast" data-arg="演示：确认是本人证件后保留"><span class="ic clay">${icon('idcard', 34, 2)}</span><span class="tx"><b>这是我本人的，保留</b><small>需要再确认一次</small></span></button></div>
        <div class="howto">${icon('shield', 34, 2)}<span>每份要打印的文件都会检查：身份证号、银行卡号、完整手机号。</span></div>
        ${fine('这一步是按规则检查，不经过 AI')}`,
      dock: { ask: '问小青：为什么要遮？', pri: { label: '遮住，下一步', go: 'preview' } }, nav: null
    })
  });
  add('preview', '打印扫描', '预览与设置', {
    notes: { does: '预览占大半屏，常用的四项设置放在手够得着的下方；不常用的收进「更多设置」。', motion: '翻页时纸张横向淡入；设置切换 120 毫秒。', keep: '彩色、双面等全部参数都在；本机用不了的灰掉并写原因；份数用加减键。' },
    render: () => {
      const p = S().print;
      return F({
        band: { kind: 'compact', eyebrow: '打印文件', title: '看一下，再选怎么打', rail: { labels: RAIL.print, now: 1 }, seal: null },
        cls: 'tight',
        body: `<div class="preview" style="padding:20px"><div style="display:flex;gap:30px;align-items:center">${UI.resume(320, 'plain')}<div style="display:flex;flex-direction:column;gap:12px;font-size:22px;color:var(--ink-2);max-width:300px"><b style="font-size:25px;color:var(--ink);word-break:break-all">毕业生就业推荐表（已填写）.pdf</b><span>共 2 页 · A4</span><span class="chip">${icon('eye', 22, 2)}身份证号已遮住</span></div></div></div>
          <div class="pager"><button data-act="toast" data-arg="演示：上一页" aria-label="上一页">${icon('chevL', 30, 2.4)}</button><span>第 1 页 / 共 2 页</span><button data-act="toast" data-arg="演示：下一页" aria-label="下一页">${icon('chevR', 30, 2.4)}</button></div>
          <div class="params">
            <div class="prow"><span>份数</span><div class="step"><button data-act="copies" data-arg="-1" aria-label="少一份">${icon('minus', 34, 2.6)}</button><output id="copies">${p.copies}</output><button data-act="copies" data-arg="1" aria-label="多一份">${icon('plus', 34, 2.6)}</button><span style="font-size:21px;color:var(--ink-3)">最多 10 份</span></div></div>
            <div class="prow"><span>颜色</span><div class="seg"><button aria-pressed="${p.color === 'bw'}" data-act="pset" data-arg="color:bw">黑白</button><button aria-pressed="${p.color === 'color'}" data-act="pset" data-arg="color:color">彩色</button></div></div>
            <div class="prow"><span>单双面</span><div class="seg"><button aria-pressed="${p.duplex === 'single'}" data-act="pset" data-arg="duplex:single">单面</button><button aria-pressed="${p.duplex === 'double'}" data-act="pset" data-arg="duplex:double">双面</button></div></div>
            <div class="prow"><span>纸张</span><div class="seg"><button aria-pressed="true">A4</button><button disabled>A3</button></div></div>
            <p class="why-off">A3：这台打印机只能打 A4</p>
            <button class="rowlink" style="min-height:76px" data-act="toast" data-arg="演示：页码范围、方向、缩放">${icon('layers', 30, 2)}<span><b style="font-size:23px">更多设置</b> <small>· 页码范围、方向、缩放</small></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button>
          </div>`,
        dock: { backLabel: '上一步', ask: '问小青：要不要双面？', pri: { label: '下一步：核对', go: 'confirm' } }, nav: null
      });
    }
  });

  add('confirm', '打印扫描', '核对并打印', {
    notes: { does: '打印前集中核对一次：打的是哪份、几张、怎么打、多少钱。', motion: '无循环动画；按下「开始打印」后整屏换到出纸页。', keep: '费用按真实报价写（本机构免费写 0 元）；文件全名能看全；改哪项回到哪项；打印机连不上时按钮灰掉并写原因。' },
    render: () => {
      const p = S().print, ctx = S().ctx;
      const name = ctx === 'report' ? '面试练习报告-新媒体运营.pdf' : ctx === 'resume' ? '李佳怡-简历（改后）.pdf' : ctx === 'policy' ? '材料清单-高校毕业生一次性求职创业补贴.pdf' : '毕业生就业推荐表（已填写）.pdf';
      const pages = ctx === 'report' ? 2 : ctx === 'resume' || ctx === 'policy' ? 1 : 2;
      const sheets = p.duplex === 'double' ? Math.ceil(pages / 2) * p.copies : pages * p.copies;
      const art = ctx === 'report' ? UI.report(300) : ctx === 'policy' ? UI.checklist(300) : UI.resume(300, ctx === 'resume' ? 'fixed' : 'plain');
      return F({
        band: { eyebrow: ctx === 'report' ? '打印练习报告' : ctx === 'resume' ? '打印简历' : ctx === 'policy' ? '打印材料清单' : '打印文件', title: '核对一下，就开始打印', rail: { labels: RAIL.print, now: 2 }, seal: null },
        cls: 'even',
        body: `<div class="confgrid rise" style="--i:0"><div class="cthumb">${art}<span>第 1 页</span></div>
          <div class="sumcard">
            <div class="r"><span>文件</span><b>${name}</b><span></span></div>
            <div class="r"><span>页数</span><b>${pages} 页 × ${p.copies} 份</b><button class="edit" data-go="preview">改</button></div>
            <div class="r"><span>设置</span><b>${p.color === 'bw' ? '黑白' : '彩色'} · ${p.duplex === 'double' ? '双面' : '单面'} · A4</b><button class="edit" data-go="preview">改</button></div>
            <div class="r"><span>用纸</span><b>${sheets} 张</b><span></span></div></div></div>
          <div class="fee rise" style="--i:1"><div><b>费用</b><div style="font-size:22px;color:var(--ink-2)">本机构的机器打印免费</div></div><span class="num">0 元</span></div>
          <div class="remind rise" style="--i:2;background:var(--teal-wash);color:var(--teal-ink)">${icon('printer', 34, 2)}<span>打印开始后不能撤回。纸从屏幕下方打印机的出纸口出来。</span></div>
          ${fine('文件只用于这次打印 · 办完自动清除')}`,
        dock: { backLabel: '上一步', ask: false, pri: { label: printerOff() ? '打印机连不上，暂时不能打' : '开始打印', go: 'printing', kind: 'pri wide', disabled: printerOff() } }, nav: null
      });
    }
  });
  add('printing', '打印扫描', '出纸中', {
    notes: { does: '告诉用户现在到哪一步、出了几张、纸在哪。', motion: '状态胶囊依次点亮；出纸口光带闪烁；每出一张，纸张从出纸口落到托盘（跟着打印机回报的张数，不是自己演）。', keep: '排队、已接单、正在出纸、完成四种状态分开；超时不回报就转「结果未确认」，不能说成功。' },
    render: () => F({
      band: { kind: 'compact', eyebrow: '打印中', title: '正在出纸，请稍候', rail: { labels: RAIL.print, now: 3 }, seal: null },
      cls: 'printing',
      body: `<div class="states" id="pst"><i class="now">排队</i><i>打印机接单</i><i>正在出纸</i><i>完成</i></div>
        <div class="printer">${UI.mfp()}<div style="position:absolute;left:150px;top:262px;width:320px;height:260px;overflow:hidden" id="paperpath"></div></div>
        <div class="counter"><b id="pcount">0</b><span>/ 2 张</span></div>
        <p class="fine" id="pmsg" style="font-size:24px">第一张通常 10 秒内出来</p>
        <div class="filecard"><span class="ft">PDF</span><div><b>毕业生就业推荐表（已填写）.pdf</b><small>2 页 × 1 份 · 黑白 · 单面 · 身份证号已遮住</small></div></div>`,
      dock: { back: false, ask: '问小青：打印到一半停了怎么办？' }, nav: null
    }),
    mount: (el) => {
      const st = el.querySelectorAll('#pst i'), pp = el.querySelector('#paperpath'), cnt = el.querySelector('#pcount'), msg = el.querySelector('#pmsg');
      const T = [];
      const setSt = (k) => st.forEach((s, i) => s.className = i < k ? 'ok' : i === k ? 'now' : '');
      T.push(setTimeout(() => setSt(1), 900));
      T.push(setTimeout(() => { setSt(2); msg.textContent = '纸从出纸口出来，先别拿，等全部打完'; }, 1800));
      [0, 1].forEach(k => T.push(setTimeout(() => {
        const sh = document.createElement('div');
        sh.style.cssText = `position:absolute;left:0;top:0;width:320px;height:160px;border-radius:6px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.14);transform:translateY(-170px);transition:transform 760ms cubic-bezier(.2,.8,.2,1)`;
        sh.innerHTML = `<div style="margin:22px 26px;display:flex;flex-direction:column;gap:12px">${'<i style="display:block;height:8px;border-radius:4px;background:#e1e6e3"></i>'.repeat(5)}</div>`;
        pp.appendChild(sh); requestAnimationFrame(() => requestAnimationFrame(() => { sh.style.transform = `translateY(${89 - k * 5}px) rotate(${k ? -1.2 : .8}deg)`; }));
        cnt.textContent = k + 1;
      }, 2400 + k * 1300)));
      T.push(setTimeout(() => { setSt(3); }, 5200));
      T.push(setTimeout(() => window.go && window.go('done'), 6200));
      return () => T.forEach(clearTimeout);
    }
  });

  add('done', '打印扫描', '取件', {
    notes: { does: '一句话：去哪拿、拿几张；原件和 U 盘单独提醒；然后结束办理。', motion: '箭头上下轻动指向出纸口；对勾一笔画出；倒计时圆环走完自动结束。', keep: '结束办理用朱砂色（不可逆）；写明已清除什么；打印有问题给服务电话和问小青。' },
    render: () => F({
      band: { eyebrow: '打印完成', title: '请取走 2 张打印件', sub: '出纸口在屏幕下方打印机的正面。', sealHtml: `<svg class="big-check" viewBox="0 0 150 150" style="width:130px;height:130px;flex:none" aria-hidden="true"><circle cx="75" cy="75" r="68" fill="none" stroke="#2ee6a8" stroke-width="7"/><path d="M46 77l20 20 40-42" fill="none" stroke="#2ee6a8" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>` },
      cls: 'even',
      body: `<div class="takebox rise" style="--i:0"><div>${UI.stack(230, 2, '2 张')}</div><div class="tt"><b>在出纸口拿</b><span>纸是热的，属于正常现象。<br>数一下，应该是 2 张。</span></div></div>
        <div class="tray-arrow">${icon('arrowD', 84, 2.4)}<span>出纸口在下面</span></div>
        <div class="remind rise" style="--i:2">${icon('usb', 34, 2)}<span>用过 U 盘或放过原件？记得一起带走。</span></div>
        <div class="grid2">${tile({ i: 3, go: 'print-src', icon: 'printer', title: '再打一份', desc: '接着打别的文件' })}${tile({ i: 4, go: 'home', icon: 'home', title: '接着办别的', desc: '回到首页' })}</div>
        ${fine('打印有问题？拨打服务电话 183-6916-1921，或者问小青')}`,
      dock: { back: false, ask: false, left: `<div class="cdring">${UI.ring(1, 96, 8)}<b id="cd">20</b></div>`, mid: `<button class="btn danger wide" data-act="clear" style="flex:1">${icon('erase', 32, 2.2)}结束本次办理，清除资料</button>` }, nav: null
    }),
    mount: (el) => {
      let n = 20; const b = el.querySelector('#cd'), arc = el.querySelector('.cdring .arc'); const C = parseFloat(arc.getAttribute('stroke-dasharray'));
      const t = setInterval(() => { n--; b.textContent = n; arc.setAttribute('stroke-dashoffset', C * (1 - n / 20)); if (n <= 0) { clearInterval(t); window.doClear(); } }, 1000);
      return () => clearInterval(t);
    }
  });
  add('unconfirmed', '打印扫描', '结果未确认', {
    notes: { does: '打印机没回报结果时，诚实地说「不确定」，告诉人先看出纸口、别重复打。', motion: '无循环动画。', keep: '不能写成功也不能写失败；订单还在；不重复扣费、不自动重打；给服务电话。' },
    render: () => F({
      band: { eyebrow: '打印结果', title: '打印机没有回报结果', sub: '可能已经出纸，也可能卡住了。', seal: null, status: { text: '结果未确认', warn: 1 } },
      cls: 'even',
      body: `<div class="steps3 big" style="grid-template-columns:1fr"><div class="s"><span class="n">1</span><b>先看看出纸口有没有纸</b><small>有纸：数一下张数，对得上就点「拿到了」</small></div><div class="s"><span class="n">2</span><b>没有纸，不要再点打印</b><small>这单还在，不会重复打，也不会多收费</small></div><div class="s"><span class="n">3</span><b>拨打服务电话 183-6916-1921</b><small>工作日 9:00–18:00；我们也已经收到提醒</small></div></div>
        <div class="sumcard"><div class="r"><span>这一单</span><b>毕业生就业推荐表（已填写）.pdf</b><span></span></div><div class="r"><span>应出</span><b>2 张 · 黑白 · 单面</b><span></span></div></div>
        <div class="grid2">${tile({ go: 'done', icon: 'check', title: '拿到了', desc: '张数对得上' })}${tile({ go: 'help', icon: 'call', tone: 'clay', title: '没拿到', desc: '看看还能怎么办' })}</div>
        ${fine('这台机器没有现场工作人员 · 订单在手机「我的 → 打印订单」里也能看到')}`,
      dock: { back: false, ask: '问小青：现在该怎么办？' }, nav: null
    })
  });
  add('pickup', '打印扫描', '输入到机码', {
    notes: { does: '屏上数字键盘输 8 位码（旧的 10 位码也认）；中间告诉人到机码在手机哪里看。', motion: '每输一位格子亮起；码不对时格子左右轻晃两下（320 毫秒）。', keep: '不依赖系统键盘；新旧码都认；输错有次数提示；失败时不回显已输的码；小程序上架后才会有人用到。' },
    render: () => F({
      band: { kind: 'compact', eyebrow: '手机下单来取件', title: '输入到机码', rail: { labels: RAIL.pick, now: 0 }, seal: null },
      cls: 'tight',
      body: `<div class="codebox" id="codebox">${'<i></i>'.repeat(8)}</div>
        <p class="fine" id="codeMsg" style="margin:0">演示：输入任意 8 位数字；输 00000000 看输错的样子</p>
        <div class="codehint rise" style="--i:1"><div class="phonemock" aria-hidden="true"><div class="pm-top">打印订单</div><div class="pm-card"><small>到机码</small><b>3846 1207</b><span>2 份文件 · 3 张</span></div><div class="pm-line"></div><div class="pm-line s"></div></div>
          <div class="ch-tx"><b>到机码在哪看？</b><span>微信打开「职易达」小程序 → 我的 → 打印订单，订单里的 8 位数字就是到机码。</span></div></div>
        <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-act="key" data-arg="${n}">${n}</button>`).join('')}<button class="fn" data-act="key" data-arg="clr">清空</button><button data-act="key" data-arg="0">0</button><button class="fn" data-act="key" data-arg="del">删一位</button></div>`,
      dock: { ask: '问小青：到机码在哪看？', pri: { label: '核对订单', act: 'code', id: 'codeGo', disabled: true } }, nav: null
    }),
    mount: () => { S().code = ''; }
  });
  add('pickup-ok', '打印扫描', '核对订单', {
    notes: { does: '码对上以后先给人看是哪一单，确认了才出纸。', motion: '订单卡浮入。', keep: '验码成功不等于已出纸；未付的单先付款；姓名打码。' },
    render: () => F({
      band: { kind: 'compact', eyebrow: '手机下单来取件', title: '是这一单吗？', rail: { labels: RAIL.pick, now: 1 }, seal: null },
      cls: 'even',
      body: `<div class="confgrid rise" style="--i:0"><div class="cthumb">${UI.stack(220, 3, '3 张')}</div><div class="sumcard"><div class="r"><span>下单人</span><b>李** · 尾号 6721</b><span></span></div><div class="r"><span>文件</span><b>简历（改后）.pdf<br>成绩单.pdf</b><span></span></div><div class="r"><span>张数</span><b>3 张 · 黑白 · 单面</b><span></span></div><div class="r"><span>状态</span><b style="color:var(--teal-ink)">已付款（0 元）<br>还没出纸</b><span></span></div><div class="r"><span>下单时间</span><b>今天 13:48</b><span></span></div><div class="r"><span>订单尾号</span><b>…0927</b><span></span></div></div></div>
        <div class="process rise" style="--i:1">${[['check', '确认是这一单', '点下面的按钮'], ['printer', '开始出纸', '屏幕显示张数'], ['arrowD', '在出纸口取', '数一下张数']].map((p, k) => `<div class="ps"><span class="n">${k + 1}</span><span class="pi">${icon(p[0], 34, 2)}</span><b>${p[1]}</b><small>${p[2]}</small></div>`).join(`<span class="pa">${icon('arrowR', 28, 2.4)}</span>`)}</div>
        ${fine('不是你的订单？点「返回」重新输入')}`,
      dock: { ask: false, pri: { label: '是的，开始出纸', go: 'printing', kind: 'pri wide' } }, nav: null
    })
  });
  add('scan-type', '打印扫描', '扫描：选类型', {
    notes: { does: '先问扫成什么：简历扫完可以直接诊断。', motion: '卡片浮入。', keep: '网页不能远程启动扫描，要在打印机面板上按；三种类型都保留。' },
    render: () => F({
      band: { eyebrow: '扫描纸质材料', title: '要扫的是什么？', rail: { labels: RAIL.scan, now: 0 }, seal: 'idle' },
      cls: 'big-rows',
      body: `${slab({ i: 0, row: 1, go: 'scan-guide', title: '简历', desc: '扫完可以直接让小青诊断', take: '扫描件 + 诊断', vis: UI.resume(96, 'plain') })}
        ${slab({ i: 1, row: 1, go: 'scan-guide', title: '证件、证书', desc: '扫成 PDF，可以存、可以打', take: 'PDF 扫描件', vis: UI.idcard(130) })}
        ${slab({ i: 2, row: 1, go: 'scan-guide', title: '其他材料', desc: '表格、证明、成绩单', take: 'PDF 扫描件', vis: UI.stack(96, 2) })}
        ${fine('扫描件只用于这次办理 · 不登录不会存进「我的文档」')}`,
      dock: { ask: '问小青：扫描和复印有什么不同？' }, nav: 'home'
    })
  });

  add('scan-guide', '打印扫描', '扫描：在打印机上操作', {
    notes: { does: '把要在打印机面板上做的三步讲清楚，屏幕这边等着。', motion: '三步依次高亮循环，提示现在该做哪一步（4 秒换一步）。', keep: '本机扫描码有效期；扫描在面板上启动，屏幕不假装能远程启动；多页用自动输稿器（50 页）。' },
    render: () => F({
      band: { eyebrow: '扫描纸质材料', title: '在打印机上按三步', sub: '这台机器的扫描要在打印机面板上开始。', rail: { labels: RAIL.scan, now: 1 }, seal: null },
      cls: 'even',
      body: `<div class="sggrid"><div class="sgart">${UI.scanPaper(300)}</div>
          <div class="steps3 big" id="sgSteps" style="grid-template-columns:1fr"><div class="s on"><span class="n">1</span><b>掀开上盖，纸面朝下放</b><small>对齐玻璃左上角的箭头</small></div><div class="s"><span class="n">2</span><b>在面板上点「扫描」</b><small>选「扫描到电脑」</small></div><div class="s"><span class="n">3</span><b>按绿色开始键</b><small>扫完屏幕这边会自动显示</small></div></div></div>
        <div class="howto">${icon('layers', 34, 2)}<span>好几页？放进上方的自动输稿器，一次最多 50 页。</span></div>
        <div class="livebox">${icon('clock', 36, 2)}<div><b>屏幕在等打印机传回扫描件</b><small>这次扫描 7 分钟内有效</small></div></div>
        ${fine('扫完记得取回原件')}`,
      dock: { ask: '问小青：面板上找不到扫描', pri: { label: '演示：扫完了', go: 'scan-wait' } }, nav: null
    }),
    mount: (el) => { let k = 0; const s = el.querySelectorAll('#sgSteps .s'); const t = setInterval(() => { s[k].classList.remove('on'); k = (k + 1) % 3; s[k].classList.add('on'); }, 4000); return () => clearInterval(t); }
  });
  add('scan-wait', '打印扫描', '扫描：等回传', {
    notes: { does: '告诉人打印机已经在扫、文件正在传回来。', motion: '扫描光从上到下扫过纸面。', keep: '超时没回传 → 重扫或另建任务，两者区分清楚。' },
    render: () => F({
      band: { kind: 'compact', eyebrow: '扫描纸质材料', title: '正在接收扫描件', rail: { labels: RAIL.scan, now: 2 }, seal: null },
      cls: 'even',
      body: `<div class="reader" style="width:560px;height:792px">${UI.resume(560, 'plain').replace('paper-shadow', '')}<div class="scanline"></div></div>
        <div class="livebox"><span class="spin"></span><div><b>打印机正在把扫描件传过来</b><small>通常 10 秒左右</small></div></div>
        ${fine('超过 1 分钟没收到？可以重扫一次')}`,
      dock: { back: false, ask: false, pri: { label: '演示：收到了', go: 'scan-result', kind: 'pri wide' } }, nav: null
    }),
    mount: () => { const t = setTimeout(() => window.go && window.go('scan-result'), 3800); return () => clearTimeout(t); }
  });
  add('scan-result', '打印扫描', '扫描：用扫描件', {
    notes: { does: '先看扫得清不清楚，再选怎么用；不替人预先决定。', motion: '扫描件浮入；取回原件的提醒带一次轻微强调。', keep: '匿名扫描件不进「我的文档」；简历可直接诊断；取回原件提醒。' },
    render: () => F({
      band: { eyebrow: '扫描完成', title: '扫好了，要怎么用？', rail: { labels: RAIL.scan, now: 3 }, seal: null },
      body: `<div style="display:grid;grid-template-columns:360px 1fr;gap:28px;align-items:start"><div style="display:flex;flex-direction:column;align-items:center;gap:10px" class="fly">${UI.resume(360, 'plain')}<span class="fine">扫描件 · 1 页 · 清晰</span></div>
          <div style="display:flex;flex-direction:column;gap:14px">${tile({ go: 'reading', icon: 'sparkle', title: '让小青诊断', desc: '这是简历的话' })}${tile({ go: 'confirm', icon: 'printer', title: '打印出来', desc: '黑白或彩色' })}${tile({ go: S().logged ? 'me' : 'login', icon: 'folder', tone: 'slate', title: '存进我的文档', desc: '需要登录' })}${tile({ act: 'toast', arg: '演示：重扫一次', icon: 'refresh', title: '不清楚，重扫', desc: '换个位置再放' })}</div></div>
        <div class="howto">${icon('file', 34, 2)}<span>扫描件：1 页 · A4 · PDF 格式</span></div>
        <div class="remind">${icon('alert', 34, 2.2)}<span>原件还在打印机玻璃上，记得取回。</span></div>
        ${fine('不登录的话，扫描件办完就清除')}`,
      dock: { ask: '问小青：扫描件能发到手机吗？' }, nav: 'home'
    })
  });
  add('copy', '打印扫描', '复印（在打印机上）', {
    notes: { does: '复印全在打印机面板上做；屏幕只把五步和按钮名字讲清楚。', motion: '当前一步高亮，4 秒换一步。', keep: '复印不在屏幕下单、不进「我的打印订单」；身份证怎么放写「请看打印机屏幕提示」，不编按键；不得复印伪造的证件、印章、票据；提醒取回原件。' },
    render: () => F({
      band: { eyebrow: '复印 · 在打印机面板上操作', title: '怎么在打印机上复印', sub: '这一项不用在屏幕上操作，也不进打印订单', seal: null },
      body: `<div class="seg"><button aria-pressed="true">身份证</button><button aria-pressed="false" data-act="seg">发票收据</button><button aria-pressed="false" data-act="seg">正反两面</button></div>
        <div class="sggrid"><div class="sgart" style="flex-direction:column;gap:16px">${UI.idcard(240)}<span class="chip clay">示意图，不是摆放位置</span></div>
          <div class="steps3 big" id="cpSteps" style="grid-template-columns:1fr;gap:10px">${[['放原件', '身份证怎么放，请看打印机屏幕提示'], ['选功能', '在打印机屏幕上点「身份证复印」'], ['改设置', '份数、颜色；上一位可能改过'], ['开始复印', '按打印机上的开始键'], ['取走复印件和原件', '复印件从出纸口出来']].map((t, k) => `<div class="s ${k === 0 ? 'on' : ''}" style="min-height:118px"><span class="n">${k + 1}</span><b>${t[0]}</b><small>${t[1]}</small></div>`).join('')}</div></div>
        <div class="remind">${icon('alert', 34, 2.2)}<span>只能复印本人的真实证件和票据。复印完记得取回原件。</span></div>
        ${fine('复印不经过这台屏幕，也不保存证件图像')}`,
      dock: { ask: '问小青：复印要注意什么？', pri: { label: '复印好了', go: 'home' } }, nav: null
    }),
    mount: (el) => { let k = 0; const st = el.querySelectorAll('#cpSteps .s'); const t = setInterval(() => { st[k].classList.remove('on'); k = (k + 1) % st.length; st[k].classList.add('on'); }, 4000); return () => clearInterval(t); }
  });

  add('img2pdf', '打印扫描', '照片合成 PDF', {
    notes: { does: '几张照片排好顺序，合成一个 PDF。', motion: '调整顺序时照片平移到新位置。', keep: '最多 20 张、每张一页；只收 JPG、PNG；不显示假的进度百分比；不登录不进「我的文档」。' },
    render: () => F({
      band: { kind: 'compact', eyebrow: '照片合成 PDF', title: '排好顺序，合成一个文件', sub: '已收到 4 张照片 · 最多 20 张', seal: null },
      body: `<div class="grid2">${['成绩单第 1 页', '成绩单第 2 页', '获奖证书', '实习证明'].map((t, i) => `<div class="phcard rise" style="--i:${i}"><div class="ph">${icon('image', 64, 1.6)}<span class="pn">${i + 1}</span></div><b>${t}</b><div class="phb"><button class="btn sec sm" data-act="toast" data-arg="演示：往前挪" aria-label="往前挪">${icon('chevL', 28, 2.4)}</button><button class="btn sec sm" data-act="toast" data-arg="演示：往后挪" aria-label="往后挪">${icon('chevR', 28, 2.4)}</button><button class="btn ghost sm" data-act="toast" data-arg="演示：删除" aria-label="删除">${icon('erase', 28, 2)}</button></div></div>`).join('')}</div>
        <div class="howto">${icon('file', 34, 2)}<span>合成后：1 个 PDF · 4 页 · 每张照片一页 · A4</span></div>
        ${fine('不登录的话，合成的 PDF 办完就清除')}`,
      dock: { backLabel: '加照片', ask: false, pri: { label: '合成 PDF', go: 'confirm' } }, nav: null
    })
  });
  add('policy', '查政策', '政策分类', {
    before: 'policy',
    notes: { does: '先选类别；也可以直接问小青「我能领什么」。', motion: '类别卡依次浮入。', keep: '内容由本机构发布，以官方原文为准；不写「已申请」「可领取」。' },
    render: () => F({
      band: { eyebrow: '查政策 · 本机构发布', title: '想了解哪一类？', sub: '每条政策都写了条件、材料和官方来源。', seal: 'idle', path: ['选类别', '看条件和材料', '打印清单或扫码看原文'], pathLabel: '查一条政策' },
      body: `<div class="grid2">${D.policyCats.map((c, i) => `<button class="cat rise" style="--i:${i}" data-go="policy-list"><span class="ic">${icon(c.ic, 38, 2)}</span><b>${c.k}</b><small>${c.d}</small></button>`).join('')}</div>
        <button class="rowlink rise" style="--i:7" data-go="policy-detail">${icon('bell', 32, 2)}<span><b>最近更新</b> <small>· 高校毕业生一次性求职创业补贴 · 10 月 18 日</small></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button>
        ${fine('示例内容 · 政策以本机构发布和官方原文为准')}`,
      dock: { ask: '问小青：我能领什么补贴？' }, nav: 'home'
    })
  });
  add('policy-list', '查政策', '政策列表', {
    notes: { does: '一类下面的政策列表，每条写发布机构、更新时间和一句话说明。', motion: '列表依次浮入。', keep: '来源（发布机构）和更新时间常驻每一条。' },
    render: () => F({
      band: { eyebrow: '查政策 · 高校毕业生', title: '4 条政策', sub: '按更新时间排列', seal: null },
      body: `<div class="stack">${D.policies.map((p, i) => `<button class="pol rise" style="--i:${i}" data-go="policy-detail"><b>${p.t}</b><span class="sum">${p.sum}</span><div class="meta"><span>${icon('landmark', 22, 2)} ${p.org}</span><span>更新于 ${p.date}</span>${p.tags.map(t => `<span class="chip slate" style="height:36px;font-size:20px">${t}</span>`).join('')}</div></button>`).join('')}</div>
        ${fine('示例内容 · 以本机构发布为准')}`,
      dock: { ask: '问小青：这几条有什么区别？' }, nav: 'home'
    })
  });
  add('policy-detail', '查政策', '政策详情', {
    notes: { does: '条件、材料、去哪办、官方来源四块；主动作是打印材料清单。', motion: '四块依次浮入。', keep: '条件核对是按规则比对，不是资格认定，不调 AI；官方入口用二维码；补贴标准以官方为准。' },
    render: () => F({
      band: { kind: 'compact', eyebrow: '市人社局 · 更新于 10 月 18 日', title: '高校毕业生一次性求职创业补贴', seal: null },
      cls: 'tight',
      body: `<div class="dsec rise" style="--i:0"><h4>${icon('user', 30, 2)}谁可以申请</h4><ul><li>毕业年度内的高校毕业生，并且属于下面任意一类：</li><li>城乡低保家庭、脱贫家庭、残疾、获得国家助学贷款等（完整条件看官方原文）</li></ul></div>
        <div class="dsec check rise" style="--i:1"><h4>${icon('clipboard', 30, 2)}要准备的材料</h4><ul><li>本人身份证</li><li>学生证或学校出具的在读证明</li><li>对应类别的证明材料</li><li>本人银行卡</li></ul></div>
        <div class="dsec rise" style="--i:2;display:flex;gap:26px;align-items:center"><div style="flex:1"><h4>${icon('landmark', 30, 2)}去哪办、看原文</h4><ul><li>学校就业指导中心统一组织申报</li><li>补贴标准和申报时间以官方原文为准</li></ul></div><div style="display:flex;flex-direction:column;align-items:center;gap:6px">${UI.qr(21, 200)}<span class="chip clay" style="height:34px;font-size:20px">示例码</span></div></div>
        <div class="grid2">${tile({ act: 'toast', arg: '演示：按规则逐条核对（不调 AI）', icon: 'check', title: '核对条件', desc: '逐条问你，按规则比对' })}${tile({ go: 'xq', icon: 'sparkle', title: '问小青这条', desc: 'AI 解释，仅供参考' })}</div>`,
      dock: { ask: false, pri: { label: '打印材料清单（1 页）', go: 'confirm', kind: 'pri wide' } }, nav: null
    })
  });

  window.SCREENS = screens;
  window.SCREEN_GROUPS = ['公共', '改简历', '练面试', '打印扫描', '查政策'];
})();
