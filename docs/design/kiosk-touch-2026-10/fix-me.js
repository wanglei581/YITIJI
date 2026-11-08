/* fix-me.js：本区（我的与权益）样式、示例数据与 14 屏的画面。类名一律 fe-。
   第二轮只改屏上的样子和字：去掉说明卡网格，列表用真实条目撑满，状态页照样式板。 */
(function () {
  const { icon, band, dock, nav } = UI;
  const S = () => window.S;
  const F = (o) => (o.band ? band(o.band) : '')
    + `<main class="body ${o.cls || ''}">${o.body}</main>`
    + (o.dock === false ? '' : dock(o.dock || {}))
    + (o.nav === false ? '' : nav(o.nav || 'me'));

  const css = document.createElement('style');
  css.textContent = `
.fe-fill{justify-content:flex-start;gap:10px;padding:12px 40px 12px}
.fe-p{margin:0;font-size:24px;line-height:1.45;color:var(--ink-2)}
.fe-id{display:flex;flex-direction:column;gap:4px;padding:14px 18px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge)}
.fe-id b{font:700 36px/1.25 var(--serif)}
.fe-id span,.fe-sync{font-size:22px;line-height:1.45;color:var(--ink-2)}
.fe-sync{margin:0;padding:12px 16px;border-radius:18px;background:var(--teal-wash);color:var(--teal-ink);font-weight:700}
.fe-counts{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.fe-count{min-height:116px;padding:10px 14px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge);text-align:left;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:2px}
.fe-count b{font:700 40px/1 var(--sans);font-variant-numeric:tabular-nums}
.fe-count em{font-style:normal;font-size:20px;font-weight:700;margin-left:4px}
.fe-count span{font-size:22px;font-weight:700}
.fe-count small{font-size:20px;color:var(--ink-3);font-weight:600}
.fe-seg{display:flex;gap:8px;flex-wrap:wrap}
.fe-seg-b{flex:1 1 0;min-height:64px;min-width:0;padding:8px 8px;border-radius:16px;background:var(--card);border:1.5px solid var(--edge);font-size:22px;font-weight:700;color:var(--ink-2);line-height:1.2}
.fe-seg-b.on,.fe-seg-b[disabled]{background:var(--deep);color:var(--cream);opacity:1}
.fe-line{display:flex;flex-direction:column;gap:6px;width:100%;text-align:left;padding:12px 16px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge)}
.fe-line .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.fe-line b{display:block;font-size:26px;line-height:1.3}
.fe-line small{display:block;font-size:21px;line-height:1.4;color:var(--ink-3);font-weight:600}
.fe-jump{flex-direction:row;align-items:center;gap:14px;min-height:88px}
.fe-jump .fe-ic{width:64px;height:64px;border-radius:18px;background:var(--well);display:grid;place-items:center;flex:none;color:var(--teal-ink)}
.fe-static{display:flex;flex-direction:column;justify-content:center;gap:4px;padding:12px 16px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge)}
.fe-static b{font-size:26px;line-height:1.3}
.fe-static small{font-size:21px;line-height:1.4;color:var(--ink-3)}
.fe-acts{display:flex;flex-wrap:wrap;gap:8px}
.fe-acts .btn.pri,.fe-acts .btn.sec,.fe-acts .btn.danger{min-width:0;white-space:normal}
.fe-acts .btn.sm{height:64px}
.fe-reason{margin:0;font-size:22px;line-height:1.4;color:var(--clay-ink);font-weight:700}
.fe-ai{display:inline-flex;align-items:center;align-self:flex-start;height:36px;padding:0 12px;border-radius:18px;background:var(--teal-wash);color:var(--teal-ink);font-size:20px;font-weight:700}
.fe-k{font-size:22px;color:var(--ink);font-weight:700}
.fe-open{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:4px;width:100%;min-height:64px;min-width:64px;text-align:left;background:transparent;border:0;padding:0}
.fe-line>.btn{align-self:stretch;height:64px;min-height:64px;min-width:0}
.fe-more{width:100%;min-height:64px}
.fe-chips{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.fe-act{gap:6px}
.fe-act>.btn{height:64px;min-height:64px;min-width:0;align-self:stretch}
.fe-stack{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px}
.fe-rows{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}
.fe-rows>.fe-line,.fe-rows>.fe-static,.fe-rows>.fe-skel{flex:1 1 auto;min-height:min-content}
.fe-rows.is-scroll{overflow:auto}
.fe-rows.is-scroll>.fe-line,.fe-rows.is-scroll>.fe-static{flex:0 0 auto}
.fe-rows.few>.fe-line,.fe-rows.few>.fe-static{flex:0 0 auto}
.fe-login{display:grid;grid-template-columns:188px minmax(0,1fr);gap:16px;align-items:center;background:var(--card);border:1.5px solid var(--edge);border-radius:26px;padding:14px 18px}
.fe-login .vis{display:grid;place-items:center;min-height:168px}
.fe-login b{font:700 32px/1.3 var(--serif)}
.fe-can{display:flex;gap:14px;align-items:center;padding:10px 14px;background:var(--card);border:1.5px solid var(--edge);border-radius:22px;min-height:84px}
.fe-can .fe-ic{width:64px;height:64px;border-radius:18px;background:var(--teal-wash);color:var(--teal-ink);display:grid;place-items:center;flex:none}
.fe-can b{display:block;font-size:26px;line-height:1.3}
.fe-can span{display:block;font-size:22px;line-height:1.35;color:var(--ink-2)}
.fe-exit{flex:1;min-height:0;display:flex;gap:16px;align-items:center;text-align:left;background:var(--card);border:1.5px solid var(--edge);border-radius:26px;padding:14px 16px}
.fe-exit svg{width:132px;height:auto;max-height:100%;flex:none}
.fe-exit.fe-tall svg{width:240px;max-height:78%}
.fe-exit b{display:block;font:700 32px/1.25 var(--serif)}
.fe-exit span{display:block;margin-top:6px;font-size:24px;line-height:1.4;color:var(--ink-2)}
.fe-hero{flex:1;min-height:0;display:flex;gap:16px;align-items:center;background:var(--card);border:1.5px solid var(--edge);border-radius:26px;padding:16px 18px}
.fe-hero svg{width:200px;height:auto;max-height:86%;flex:none}
.fe-links{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:1fr;gap:8px}
.fe-links>.fe-line{min-height:0}
.fe-hero b{display:block;font:700 32px/1.3 var(--serif);margin-bottom:8px}
.fe-skel{display:flex;flex-direction:column;justify-content:center;gap:8px;padding:12px 16px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge)}
.fe-skel b{font-size:22px;color:var(--ink-3);font-weight:700}
.fe-skel i{display:block;height:16px;border-radius:8px;background:var(--well)}
.fe-skel i.short{width:58%}
.fe-kinds{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.fe-kinds div{min-height:84px;padding:12px 14px;border-radius:18px;background:var(--card);border:1.5px solid var(--edge);display:flex;flex-direction:column;justify-content:center;gap:2px}
.fe-kinds b{font-size:24px}
.fe-kinds span{font-size:20px;color:var(--ink-3);font-weight:700}
.fe-rule{display:flex;gap:12px;align-items:flex-start;font-size:24px;line-height:1.4}
.fe-rule i{flex:none;width:40px;height:40px;border-radius:50%;background:var(--teal-wash);color:var(--teal-ink);display:grid;place-items:center;font-style:normal;font-weight:700;font-size:22px}
.fe-ghost{color:var(--ink-3)!important;font:700 28px/1.2 var(--sans)!important}
.fe-trio{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.fe-trio .fe-line{min-height:88px;justify-content:center}
.fe-hero.is-pin{flex:0 0 auto}
.fe-split{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px}
.fe-split>.fe-hero{flex:1 1 0;min-height:0}
.fe-pin{flex:0 0 auto}
.fe-block{display:flex;flex-direction:column;gap:8px;flex:none}
`;
  document.head.appendChild(css);

  const HELP = '需要帮助？拨打服务电话 183-6916-1921';
  const CHROME = new Set(['notifications', 'my-resumes', 'my-fav', 'my-ai', 'my-activity', 'my-docs', 'my-orders']);
  const NEED = new Set(['notifications', 'my-resumes', 'my-orders', 'my-docs', 'my-ai', 'my-activity', 'my-fav', 'my-benefits', 'feedback', 'privacy']);
  const REC = [['my-resumes', '简历'], ['my-fav', '收藏'], ['my-ai', 'AI 记录'], ['my-activity', '足迹']];
  const ASSET = [['my-docs', '文档'], ['my-orders', '订单']];

  const person = () => (window.D && window.D.me) || { name: '李佳怡', phone: '138****6721' };
  const miniOn = () => S().feMiniapp !== false;
  const gone = (id) => !!(S().feGone && S().feGone[id]);
  const alive = (list) => list.filter((x) => !gone(x.id));
  const mode = () => {
    const s = S();
    if (s.feError) return 'error';
    if (s.feLoading) return 'loading';
    if (s.feEmpty) return 'empty';
    return 'ready';
  };
  function bag(page) {
    const s = S();
    if (!s.feUi || typeof s.feUi !== 'object') s.feUi = {};
    if (!s.feUi[page] || typeof s.feUi[page] !== 'object') s.feUi[page] = {};
    return s.feUi[page];
  }
  function chromeStatus() {
    const p = S().printer;
    if (p === 'down') return { text: '打印机离线', warn: 1 };
    if (p === 'unbound') return { text: '设备未绑定', warn: 1 };
    if (p === 'unknown') return { text: '状态未知' };
    return { text: '打印机在线' };
  }
  function wipe() {
    const s = S();
    ['feEmpty', 'feError', 'feLoading', 'feHandover', 'feUi', 'feMiniapp', 'feTodo', 'feClaim', 'feClaimMap', 'feConsent', 'feGone', 'feRead', 'feAllRead', 'feSheet', 'feOrd', 'feSent', 'feCat', 'feWithdraw', 'feRebind', 'feMore', 'feSvc', 'feOpen', 'feArm', 'feAct', 'feKeep', 'feView', 'feConvert', 'feRefresh', 'feReply', 'feExtra', 'feClosed', 'feShut', 'feDelNote', 'feReq', 'feFilt'].forEach((k) => { delete s[k]; });
  }
  function endUse() { wipe(); window.doClear(); }
  function refresh() { window.__proto.refresh(); }
  function openOf(page, fallback) {
    const b = bag(page);
    if (b.open === undefined && fallback) b.open = fallback;
    return b.open || '';
  }

  function frame(page, o) {
    const st = o.status !== undefined ? o.status : (CHROME.has(page) ? chromeStatus() : undefined);
    return F({
      band: { kind: 'compact', eyebrow: o.eye || '', title: o.title, sub: o.sub || '', seal: null, status: st, back: o.back !== false },
      cls: 'fe-fill',
      body: o.body,
      dock: o.dock,
      nav: o.nav === false ? false : 'me',
    });
  }
  function seg(items, cur, fe) {
    return `<div class="fe-seg">${items.map(([id, label]) => {
      const on = id === cur;
      return `<button type="button" class="fe-seg-b${on ? ' on' : ''}" ${on ? 'disabled' : `data-fe="${fe}" data-arg="${id}"`}>${label}</button>`;
    }).join('')}</div>`;
  }
  function tabs(list, cur) { return seg(list, cur, 'noop'); }
  function goTabs(list, cur) {
    return `<div class="fe-seg">${list.map(([id, label]) => `<button type="button" class="fe-seg-b${id === cur ? ' on' : ''}" ${id === cur ? 'disabled' : `data-go="${id}"`}>${label}</button>`).join('')}</div>`;
  }
  function exitCard(attrs, illus, title, desc) {
    const tall = attrs.indexOf('fe-tall') >= 0;
    const clean = attrs.replace(/\s*class="fe-tall"/, '');
    return `<button type="button" class="fe-exit${tall ? ' fe-tall' : ''}" ${clean}><div>${illus}</div><div><b>${title}</b><span>${desc}</span></div></button>`;
  }
  function hero(illus, title, text) {
    return `<div class="fe-hero">${illus}<div><b>${title}</b><p class="fe-p">${text}</p></div></div>`;
  }
  function canRow(ic, title, desc) {
    return `<div class="fe-can"><span class="fe-ic">${icon(ic, 32, 2)}</span><div><b>${title}</b><span>${desc}</span></div></div>`;
  }
  function loginCard(title, text) {
    return `<div class="fe-login"><div class="vis">${UI.phone(96)}</div><div><b>${title}</b><p class="fe-p">${text}</p></div></div>`;
  }
  function helpRemind() {
    return `<div class="remind">${icon('call', 34, 2)}<span>${HELP}</span></div>`;
  }
  function skel(n) {
    return `<div class="fe-rows">${Array.from({ length: n }, () => '<div class="fe-skel"><b>正在读取</b><i></i><i class="short"></i></div>').join('')}</div>`;
  }
  function btn(cls, attrs, label) {
    return `<button type="button" class="${cls}" ${attrs}>${label}</button>`;
  }
  function dialog(title, text, buttons) {
    return `<div class="overlay"><div class="dialog" role="dialog"><h2>${title}</h2><p>${text}</p><div class="btns">${buttons}</div></div></div>`;
  }
  function layer() {
    const s = S();
    const sheet = s.feSheet || '';
    if (sheet === 'retain') {
      return dialog('改保存期限', '可选 3 个月或 6 个月。短期保存不能从这里改回去。到期后不能恢复。', `${btn('btn pri', 'data-fe="keep" data-arg="months_3"', '保存 3 个月')}${btn('btn sec', 'data-fe="keep" data-arg="months_6"', '保存 6 个月')}${btn('btn ghost', 'data-fe="close"', '取消')}`);
    }
    if (sheet === 'rebind1') {
      return dialog('先验证现在的手机号', `${person().phone}。验证码发出去要等一会儿。`, `${btn('btn sec', 'data-act="toast" data-arg="演示：弹出屏上键盘"', '发送验证码')}${btn('btn pri', 'data-fe="rebind2"', '下一步：验证新号码')}${btn('btn ghost', 'data-fe="close"', '取消')}`);
    }
    if (sheet === 'rebind2') {
      return dialog('再验证新的手机号', '新号码验证通过后才提交换绑。', `${btn('btn sec', 'data-act="toast" data-arg="演示：弹出屏上键盘"', '发送验证码')}${btn('btn pri', 'data-fe="rebind-go"', '确认换绑')}${btn('btn ghost', 'data-fe="close"', '取消')}`);
    }
    if (sheet === 'switch') {
      return dialog('换一个账号登录', '会先结束这一位的使用，再去登录。', `${btn('btn danger', 'data-fe="switch-go"', '结束并去登录')}${btn('btn ghost', 'data-fe="close"', '取消')}`);
    }
    if (sheet === 'end') {
      return dialog('结束使用', '这会退出登录，并清掉这台机器上这一次的临时信息。已保存的简历和文档按保存期限保留。', `${btn('btn danger', 'data-fe="end-yes"', '确认结束使用')}${btn('btn ghost', 'data-fe="close"', '取消')}`);
    }
    if (sheet === 'wd-set') {
      return dialog('撤回 AI 使用授权', '撤回后，不会继续基于该授权处理您的简历。再次使用相关 AI 辅助时，需要重新确认授权。', `${btn('btn danger', 'data-fe="wd-go"', '确认撤回')}${btn('btn ghost', 'data-fe="close"', '取消')}`);
    }
    if (sheet === 'wd') {
      return dialog('撤回 AI 使用授权', '撤回不会删除简历、文档、打印订单或收藏；也不等于账号注销。', `${btn('btn danger', 'data-fe="wd-go"', '确认撤回')}${btn('btn ghost', 'data-fe="close"', '取消')}`);
    }
    if (s.feView) {
      const name = s.feView;
      return dialog('查看文件', `只预览名称，不在这里展开正文。${name}`, btn('btn pri', 'data-fe="close"', '关闭'));
    }
    return '';
  }
  function idleShort(page) {
    return page === 'my-docs' ? '离开 1 分 30 秒没操作会自动退出。' : '离开 3 分钟没操作会自动退出。';
  }
  const CAN = {
    notifications: [['bell', '看未读和已读', '可以只看未读，也可以看全部'], ['check', '标成已读', '一条一条标，或全部标为已读'], ['erase', '删掉不需要的', '先点删除，再点一次确认']],
    'my-resumes': [['file', '看处理结果和保留期限', '完成、处理中、失败都会写在每一份上'], ['eye', '打开诊断、优化或生成结果', '还在处理或失败的，暂时打不开'], ['erase', '删掉不需要的一份', '先点删除，再点一次确认']],
    'my-orders': [['receipt', '看打印进度和到机码', '进行中的订单能看到取件用的到机码'], ['folder', '去我的文档再打一份', '会新建一张打印任务，不改原来那张'], ['ticket', '手机上下的到店单，输码取件', '还没核销的到店单，不在订单列表里']],
    'my-docs': [['folder', '看文件名和保存期限', '每份文件写着大小、时间和能保存多久'], ['printer', '选一份去打印', 'PDF、JPG、PNG 可以直接打'], ['clock', '改保存期限', '3 个月或 6 个月，到期后不能恢复']],
    'my-ai': [['sparkle', '打开已经生成的结果', '诊断、优化、生成、规划和模拟面试'], ['clock', '看还在处理或失败的原因', '打不开的会写明为什么'], ['erase', '删掉不需要的记录', '小青作业只能删除']],
    'my-activity': [['book', '看浏览过的政策', '只记你在这台机器上看过的'], ['arrowR', '看打开过的来源', '点一条可以再打开那条政策'], ['clock', '按时间排好', '最近看的在最前面']],
    'my-fav': [['book', '看收藏的政策', '只收藏政策，方便下次再找'], ['eye', '点一条打开政策', '打开的是这条政策本身'], ['x', '取消收藏在政策页里', '这一页不能取消']],
    'my-benefits': [['check', '看每项现在能不能用', '可用、已用完、已过期、已撤销都会写明'], ['landmark', '看补贴说明', '说明不等于补贴已经发放'], ['printer', '没有权益也能去办事', '打印、简历和政策照样能办']],
    feedback: [['message', '选类型并提交', '设备、打印、文件、建议，或 AI 内容投诉'], ['clock', '看以前的处理进度', '已提交、处理中、已回复、已关闭'], ['pen', '补充回复或关闭工单', '关闭前会再问一次']],
    privacy: [['shield', '撤回 AI 使用授权', '不影响简历、打印、收藏和已保存的文件'], ['clipboard', '看申请记录', '提交之后，进度出现在这一页'], ['file', '导出和注销不在这台机器上', '按《隐私政策》里的联系方式申请']],
  };
  function gateExits(page) {
    const xs = [
      ['print', UI.usb(120), '打印扫描', '不登录也能打印、扫描'],
      ['policy', UI.checklist(108), '查政策', '看本机构发布的就业政策'],
    ];
    if (page === 'my-benefits') xs.push(['activities', UI.stack(108, 3), '先看看有哪些活动', '活动列表现在就能看']);
    if (S().ctx === 'print' && page === 'my-docs') xs.unshift(['print-src', UI.scanPaper(120), '返回选文件', '回到刚才的打印']);
    return xs;
  }
  function gate(page, o) {
    const cans = (CAN[page] || CAN.notifications).map((c) => canRow(c[0], c[1], c[2])).join('');
    const exits = gateExits(page).map((e) => exitCard(`data-go="${e[0]}"`, e[1], e[2], e[3])).join('');
    return frame(page, {
      eye: o.eye,
      title: '登录后看你的' + o.what,
      sub: '只有你本人能看到',
      body: `${loginCard('登录后看你的' + o.what, '用手机号和验证码，或在手机上扫码确认。登录后会回到这一页。')}
        <p class="fe-k">登录后在这一页能</p>
        ${cans}
        <div class="fe-stack"><p class="fe-k">不登录也能办</p>${exits}</div>
        <p class="fine">${idleShort(page)}${HELP}</p>`,
      dock: { ask: o.ask, pri: { label: '去登录', go: 'login' } },
      nav: o.nav,
    });
  }
  function err(page, o) {
    const label = page === 'me' ? '重新读取' : '重新加载';
    const title = page === 'me' ? '账号数据这次没取到' : '这次没读到';
    const sentence = page === 'me'
      ? '数量和待办这次没有取到。记录还在，可以重新读取。'
      : '这次没有读到列表。记录还在，可以重新加载。';
    const st = page === 'me'
      ? { text: '请重新读取账号数据', warn: 1 }
      : (CHROME.has(page) ? chromeStatus() : { text: '这次没读到', warn: 1 });
    return frame(page, {
      eye: o.eye,
      title,
      sub: '可以再试一次',
      status: st,
      body: `<p class="fe-p">${sentence}</p>
        <div class="fe-stack">
          ${exitCard('data-fe="reload"', UI.report(140), label, '再读一次。刚才没出来的内容会重新显示。')}
          ${exitCard('data-go="home"', UI.resume(140), '先去办别的', '回到首页。打印、扫描和查政策都可以继续。')}
        </div>
        ${helpRemind()}`,
      dock: { ask: o.ask, mid: btn('btn pri', 'data-fe="reload"', label) },
      nav: o.nav,
    });
  }
  function loading(page, o) {
    const st = page === 'me'
      ? { text: '正在读取数量与待办' }
      : (CHROME.has(page) ? chromeStatus() : { text: '正在读取' });
    let body = '';
    if (page === 'me') {
      const names = ['我的简历', '我的文档', '打印订单', '我的收藏', '我的权益', 'AI 服务记录'];
      body = `<div class="fe-id"><b>正在读取</b><span>请稍等</span></div>
        <div class="fe-counts">${names.map((t) => `<div class="fe-count"><span>${t}</span><b class="fe-ghost">正在读取</b></div>`).join('')}</div>
        ${skel(6)}`;
    } else if (page === 'activity-detail') {
      body = `${hero(UI.checklist(140), '正在读取', '活动名称、适用范围和领取规则还在读取。').replace('class="fe-hero"', 'class="fe-hero is-pin"')}
        ${skel(6)}`;
    } else if (page === 'settings' || page === 'privacy' || page === 'feedback') {
      const what = page === 'settings' ? '账号设置还在读取。' : (page === 'privacy' ? '隐私请求还在读取。' : '反馈记录还在读取。');
      body = `${hero(UI.checklist(130), '正在读取', what).replace('class="fe-hero"', 'class="fe-hero is-pin"')}
        ${skel(6)}`;
    } else {
      body = skel(8);
    }
    return frame(page, {
      eye: o.eye,
      title: page === 'me' ? '我的' : '正在读取',
      sub: page === 'me' ? '正在读取数量与待办' : '请稍等',
      status: st,
      body,
      dock: { ask: o.ask },
      nav: o.nav,
    });
  }
  function shell(page, o) {
    if (NEED.has(page) && !S().logged) return gate(page, o);
    const m = mode();
    if (m === 'error') return err(page, o);
    if (m === 'loading') return loading(page, o);
    return null;
  }
  function moreBtn() {
    const m = S().feMore;
    if (m === 'ing') return btn('btn sec sm', 'disabled', '正在加载更多…');
    if (m === 'fail') return `<p class="fe-reason">还有记录这次没载入。</p>${btn('btn sec sm', 'data-fe="more"', '再加载一次')}`;
    return btn('btn sec sm', 'data-fe="more"', '加载更多');
  }
  function delBtns(id) {
    if (S().feArm === id) {
      return `${btn('btn danger sm', `data-fe="del" data-arg="${id}"`, '再点一次确认删除')}${btn('btn sec sm', 'data-fe="unarm"', '取消')}`;
    }
    return btn('btn sec sm', `data-fe="arm" data-arg="${id}"`, '删除');
  }
  function deletedNote() {
    return S().feDelNote ? `<p class="fe-p">已删除。列表少了这一条。</p>` : '';
  }
  function delFail() {
    return S().feDelFail ? `<p class="fe-reason">这次没删掉，列表还在。</p>` : '';
  }

  const RESUMES = [
    { id: 'rs1', kind: 'parse', title: '上传诊断简历 · 2026-10-25 · a1c3e907', st: '已完成', opt: '未优化', exp: '2026-11-24', sub: '上传简历后生成的诊断记录', ok: true },
    { id: 'rs5', kind: 'parse', title: '上传诊断简历 · 2026-10-21 · e88c04d2', st: '已完成', opt: '已生成优化版', exp: '2026-11-20', sub: '上传简历后生成的诊断记录', ok: true },
    { id: 'rs4', kind: 'parse', title: '上传诊断简历 · 2026-10-26 · d41aa208', st: '处理中', exp: '2026-11-25', sub: '正在处理，完成后可打开', ok: false },
    { id: 'rs2', kind: 'gen', title: 'AI 生成简历 · 2026-10-24 · b7d21e04', st: '已完成', exp: '2026-11-23', sub: 'AI 引导生成的简历版本', ok: true },
    { id: 'rs6', kind: 'gen', title: 'AI 生成简历 · 2026-10-20 · f03b77c1', st: '待处理', exp: '2026-11-19', sub: '还没开始生成，没有可打开的结果', ok: false },
    { id: 'rs3', kind: 'parse', title: '上传诊断简历 · 2026-10-22 · c90f11ab', st: '失败', exp: '2026-11-21', sub: '这次处理未完成，没有可打开的结果', ok: false },
    { id: 'rs7', kind: 'parse', title: '上传诊断简历 · 2026-10-18 · 09ab61ee', st: '已完成', opt: '未优化', exp: '2026-11-17', sub: '上传简历后生成的诊断记录', ok: true },
  ];
  const DOCS = [
    { id: 'd1', name: '毕业生就业推荐表.pdf', meta: 'PDF · 468 KB · 今天 14:12', policy: 'system_short', purpose: 'print_doc', ext: 'pdf', pages: '2 页' },
    { id: 'd2', name: '个人简历-秋招.pdf', meta: 'PDF · 186 KB · 10 月 24 日', policy: 'months_3', purpose: 'resume_upload', ext: 'pdf', pages: '1 页' },
    { id: 'd5', name: '成绩单-2026春.pdf', meta: 'PDF · 890 KB · 10 月 23 日', policy: 'months_6', purpose: 'print_doc', ext: 'pdf', pages: '3 页' },
    { id: 'd3', name: '求职信-新媒体运营.docx', meta: 'DOCX · 54 KB · 10 月 23 日', policy: 'months_3', purpose: 'cover_letter', ext: 'docx', pages: '' },
    { id: 'd6', name: '证件照-蓝底.jpg', meta: 'JPG · 240 KB · 10 月 21 日', policy: 'months_3', purpose: 'print_doc', ext: 'jpg', pages: '1 页' },
    { id: 'd7', name: '实习协议扫描.png', meta: 'PNG · 1.2 MB · 10 月 19 日', policy: 'long_term', purpose: 'print_doc', ext: 'png', pages: '4 页' },
    { id: 'd4', name: '合同风险审查报告.pdf', meta: 'PDF · 220 KB · 10 月 20 日', policy: 'months_3', purpose: 'risk_report', ext: 'pdf', reprint: false, pages: '4 页' },
  ];
  const ORDERS = [
    { id: 'o1', name: '毕业生就业推荐表.pdf', when: '今天 14:12', copies: '1 份', pages: '2 页', st: '打印中', bucket: 'doing', pay: '0 元（免费试运营） · 免费', cents: 0, code: '48291736' },
    { id: 'o4', name: '成绩单-2026春.pdf', when: '今天 13:05', copies: '2 份', pages: '3 页', st: '排队中', bucket: 'doing', pay: '0 元（免费试运营） · 免费', cents: 0, code: '19364028' },
    { id: 'o5', name: '个人简历-秋招.pdf', when: '今天 09:40', copies: '1 份', pages: '1 页', st: '已领取', bucket: 'doing', pay: '0 元（免费试运营） · 免费', cents: 0 },
    { id: 'o2', name: '求职信-新媒体运营.pdf', when: '昨天 16:22', copies: '1 份', pages: '1 页', st: '已完成', bucket: 'done', pay: '0 元（免费试运营） · 免费', cents: 0 },
    { id: 'o7', name: '身份证复印件.jpg', when: '10 月 18 日', copies: '1 份', pages: '1 页', st: '已完成', bucket: 'done', pay: '0 元（免费试运营） · 免费', cents: 0 },
    { id: 'o6', name: '实习协议扫描.png', when: '10 月 23 日', copies: '1 份', pages: '4 页', st: '已取消', bucket: 'cancel', pay: '暂无支付信息', cents: null },
    { id: 'o3', name: '合同风险审查报告.pdf', when: '10 月 22 日', copies: '1 份', pages: '4 页', st: '失败', bucket: 'fail', pay: '0 元（免费试运营） · 待退款', cents: 0, refund: true },
  ];
  const NOTES = [
    { id: 'n1', kind: '打印', title: '打印完成', body: '毕业生就业推荐表.pdf 已出纸 1 张', time: '今天 14:12', unread: true },
    { id: 'n2', kind: '反馈', title: '你的反馈有回复', body: '「打印出来字偏淡」有了回复', time: '今天 11:05', unread: true, fb: true },
    { id: 'n4', kind: '维护', title: '今晚 22:00 短暂停机维护', body: '维护期间这台机器暂停打印，大约 20 分钟', time: '今天 09:00', unread: true },
    { id: 'n3', kind: 'AI 服务', title: '简历诊断已生成', body: '上传诊断简历 · 2026-10-25 · a1c3e907', time: '今天 10:31', unread: false, ai: true },
    { id: 'n5', kind: '公告', title: '秋招季打印辅助可以领取', body: '在权益活动里查看，领取后用于本机打印', time: '昨天 18:20', unread: false },
    { id: 'n6', kind: '系统', title: '手机号验证已通过', body: '这次登录已确认，离开后会自动退出', time: '昨天 15:02', unread: false },
    { id: 'n7', kind: '打印', title: '有一张订单没有出纸', body: '合同风险审查报告.pdf 已确认未出纸', time: '10 月 22 日', unread: false },
  ];
  const AIS = [
    { id: 'ai1', kind: '简历诊断', go: 'diagnosis', st: '已完成', when: '今天 13:30', exp: '2026-11-24', ai: true, ok: true },
    { id: 'ai2', kind: '简历优化', go: 'optimize', st: '已完成', when: '今天 13:40', exp: '2026-11-24', ai: true, ok: true },
    { id: 'ai3', kind: '简历生成', go: 'gen-preview', st: '已完成', when: '今天 13:48', exp: '2026-11-24', ai: true, ok: true },
    { id: 'ai4', kind: '模拟面试', go: 'iv-report', st: '已完成', when: '今天 15:02', exp: '2026-11-24', ai: true, ok: true },
    { id: 'ai5', kind: '小青作业', go: '', st: '已完成', when: '10 月 22 日', exp: '2026-11-21', ok: false, onlyDel: true },
    { id: 'ai6', kind: '简历对照', go: 'jobfit', st: '处理中', when: '今天 16:10', exp: '2026-11-24', ok: false, why: '正在处理，完成后可打开' },
    { id: 'ai7', kind: '职业规划', go: 'career', st: '已完成', when: '10 月 24 日', exp: '2026-11-23', ai: true, ok: true },
    { id: 'ai8', kind: '自我探索', go: 'sa-result', st: '已完成', when: '10 月 22 日', exp: '2026-11-21', ai: true, ok: true },
  ];
  const BROWSE = [
    { id: 'b1', t: '高校毕业生一次性求职创业补贴', m: '浏览 · 政策 · 市人社局 · 今天 14:02' },
    { id: 'b2', t: '离校未就业高校毕业生就业见习', m: '浏览 · 政策 · 市人社局 · 10 月 24 日' },
    { id: 'b3', t: '灵活就业人员社保补贴', m: '浏览 · 政策 · 区就业服务中心 · 10 月 22 日' },
    { id: 'b4', t: '职业技能培训补贴', m: '浏览 · 政策 · 市人社局 · 10 月 20 日' },
    { id: 'b5', t: '创业担保贷款贴息', m: '浏览 · 政策 · 区就业服务中心 · 10 月 16 日' },
    { id: 'b6', t: '就业困难人员社保补贴', m: '浏览 · 政策 · 市人社局 · 10 月 12 日' },
    { id: 'b7', t: '见习基地名录（2026 秋）', m: '浏览 · 政策 · 市人社局 · 10 月 08 日' },
  ];
  const JUMPS = [
    { id: 'j1', t: '高校毕业生一次性求职创业补贴', m: '外部跳转 · 政策原文 · 今天 14:06' },
    { id: 'j2', t: '离校未就业高校毕业生就业见习', m: '外部跳转 · 政策原文 · 10 月 24 日' },
    { id: 'j3', t: '职业技能培训补贴申请须知', m: '外部跳转 · 政策原文 · 10 月 20 日' },
    { id: 'j4', t: '创业担保贷款办事指南', m: '外部跳转 · 政策原文 · 10 月 16 日' },
    { id: 'j5', t: '灵活就业社保补贴办事入口', m: '外部跳转 · 政策原文 · 10 月 12 日' },
    { id: 'j6', t: '就业困难人员认定说明', m: '外部跳转 · 政策原文 · 10 月 09 日' },
    { id: 'j7', t: '见习基地名录办事页', m: '外部跳转 · 政策原文 · 10 月 08 日' },
  ];
  const FAVS = [
    { id: 'f1', t: '高校毕业生一次性求职创业补贴', m: '政策 · 收藏于 10 月 25 日' },
    { id: 'f2', t: '离校未就业高校毕业生就业见习', m: '政策 · 收藏于 10 月 24 日' },
    { id: 'f3', t: '灵活就业人员社会保险补贴', m: '政策 · 收藏于 10 月 22 日' },
    { id: 'f4', t: '职业技能培训补贴', m: '政策 · 收藏于 10 月 20 日' },
    { id: 'f5', t: '创业担保贷款贴息', m: '政策 · 收藏于 10 月 16 日' },
    { id: 'f6', t: '就业困难人员社保补贴', m: '政策 · 收藏于 10 月 12 日' },
    { id: 'f7', t: '见习基地名录（2026 秋）', m: '政策 · 收藏于 10 月 08 日' },
  ];
  const BENS = [
    { t: '打印辅助', type: '免费次数', src: '合作机构', st: '可用', d: '一次性权益，可在本机打印简历和材料时使用。' },
    { t: '求职创业补贴说明', type: '补贴说明', src: '政府', st: '只读', d: '不适用。仅提供政策说明、材料清单与官方入口，不等于补贴已发放。' },
    { t: '材料打印辅助', type: '服务额度', src: '校园', st: '已用完', d: '这项权益已经用完。' },
    { t: '简历诊断辅助', type: '免费次数', src: '平台', st: '已过期', d: '过期后不能再当可用。' },
    { t: '一次打印辅助', type: '免费次数', src: '合作机构', st: '已撤销', d: '这项权益已经撤销。' },
    { t: '证件复印辅助', type: '服务额度', src: '平台', st: '可用', d: '可在本机复印证件时使用。' },
  ];
  const ACTS = [
    { id: 'a1', src: '合作机构', type: '免费次数', stock: '可领取', title: '秋招季打印辅助', desc: '登录后领取，在这台机器打印简历和材料时使用。', scope: '这台机器上的简历和求职材料打印', validity: '2026-10-01 至 2026-12-31', quantityText: '一次性，每人 1 次', rules: ['每人限领一次，需要登录', '只在这台机器使用', '不能兑换现金，不能转让'] },
    { id: 'a2', src: '校园', type: '服务额度', stock: '即将领完', title: '应届生材料打印', desc: '求职材料、成绩单这类打印额度，剩余不多。', scope: '成绩单、推荐表、求职信', validity: '2026-11-30 前', quantityText: '剩余 20 次', rules: [] },
    { id: 'a3', src: '平台', type: '免费次数', stock: '已领取', title: '简历诊断辅助', desc: '已经领过，到我的权益里查看。', scope: '简历诊断', validity: '2026-09-01 至 2026-10-31', quantityText: '一次性，每人 1 次', claimed: true, rules: [] },
    { id: 'a4', src: '合作机构', type: '服务额度', stock: '已结束', title: '春季打印辅助', desc: '活动已结束，不能再领。', scope: '本机简历打印', validity: '2026-03-01 至 2026-05-31', quantityText: '一次性，每人 1 次', ended: true, rules: [] },
    { id: 'a5', src: '校园', type: '免费次数', stock: '已领完', title: '材料复印辅助', desc: '名额已经领完。', scope: '本机证件和材料复印', validity: '2026-10-01 至 2026-10-31', quantityText: '一次性，每人 1 次', soldout: true, rules: [] },
  ];

  function keepLabel(doc) {
    const over = S().feKeep && S().feKeep[doc.id];
    const p = over || doc.policy;
    if (p === 'system_short') return '短期保存，约 24 小时';
    if (p === 'months_3') return '保存 3 个月';
    if (p === 'months_6') return '保存 6 个月';
    if (p === 'long_term') return '长期保存';
    return '保存期限未注明';
  }
  function printable(doc) {
    if (doc.reprint === false) return false;
    return doc.ext === 'pdf' || doc.ext === 'jpg' || doc.ext === 'png';
  }
  function signable(doc) {
    return doc.ext === 'pdf' && ['print_doc', 'resume_upload', 'resume_scan', 'cover_letter'].indexOf(doc.purpose) >= 0;
  }

  function meStatus() {
    if (!S().logged) return { text: '未登录' };
    if (S().feError) return { text: '请重新读取账号数据', warn: 1 };
    if (S().feLoading) return { text: '正在读取数量与待办' };
    if (S().feHandover) return { text: '待确认是不是你', warn: 1 };
    if (S().feTodo === 'paper') return { text: '有文件正在出纸', warn: 1 };
    if (S().feEmpty || S().feTodo === 'none') return { text: '已登录' };
    return { text: '有订单待付款', warn: 1 };
  }
  function count(n) { return (mode() === 'loading' || S().feLoading) ? '—' : String(n); }
  function todoCard() {
    const none = S().feEmpty || S().feTodo === 'none';
    if (none) {
      const extra = S().feEmpty ? '这个账号还没有保存过简历、生成过文档，也没有下过打印订单。' : '可以去首页选择要办理的服务。';
      return `<div class="fe-static"><b>这台机器上没有待继续的办理</b><small>${extra}</small>${btn('btn sec sm', 'data-go="home"', '去首页开始')}</div>`;
    }
    if (S().feTodo === 'paper') {
      return `<div class="fe-static"><b>你的文件正在打印</b><small>毕业生就业推荐表.pdf · 免费试运营，本单 0 元。纸出完前不要离开取件口。</small>${btn('btn pri sm', 'data-go="printing"', '看出纸进度')}</div>`;
    }
    return `<div class="fe-static"><b>有一份文件还没付款</b><small>毕业生就业推荐表.pdf · 免费试运营，本单 0 元。付款前不会开始出纸。</small>${btn('btn pri sm', 'data-go="cashier"', '继续付款')}</div>`;
  }
  function loginJump(back, ic, title, desc) {
    return btn('fe-line fe-jump', `data-go="login" data-set="fmLoginBack=${back}"`, `<span class="fe-ic">${icon(ic, 32, 2)}</span><span class="tx"><b>${title}</b><small>${desc}</small></span>${icon('chevR', 28, 2.2)}`);
  }
  function rowBox(html, n, open) {
    const few = n > 0 && n < 5 && !open;
    return `<div class="fe-rows${few ? ' few' : ''}${open ? ' is-scroll' : ''}">${html}</div>`;
  }
  function emptyPack(sentence, cards) {
    return `<p class="fe-p">${sentence}</p><div class="fe-stack">${cards}</div>${helpRemind()}`;
  }
  function pageMe() {
    if (S().logged && S().feHandover) {
      return frame('me', {
        eye: '继续使用前',
        title: '还是你吗？',
        sub: '离开屏幕超过 30 秒后再进来，会先问这一句',
        status: { text: '待确认是不是你', warn: 1 },
        back: false,
        body: `<p class="fe-p">确认之前不会显示上一位的文件和订单。</p>
          <div class="fe-stack">
            ${exitCard('class="fe-tall" data-fe="me-yes"', UI.resume(220), '是我，继续', '接着看简历、文档和订单。')}
            ${exitCard('class="fe-tall" data-fe="me-no"', UI.phone(140), '不是我，结束上一位的使用', '退出登录，并清掉这台机器上这一次的临时信息。')}
          </div>`,
        dock: { back: false, ask: '问小青：这一页是什么意思？' },
      });
    }
    if (!S().logged) {
      return frame('me', {
        title: '我的',
        sub: '简历、文档、订单、收藏与权益都在这里。',
        status: { text: '未登录' },
        body: `${loginCard('这台机器是公共终端', '不登录不会显示任何人的记录。用手机号和验证码，或在手机上扫码确认。')}
          <p class="fe-k">登录后可以看</p>
          ${loginJump('my-resumes', 'file', '简历与文档', '看保存的简历和文件')}
          ${loginJump('my-orders', 'receipt', '打印订单', '看打印进度和到机码')}
          ${loginJump('my-benefits', 'check', '权益', '看能不能用，以及有哪些活动')}
          <div class="fe-stack"><p class="fe-k">不登录也能办</p>
            ${exitCard('data-go="print"', UI.usb(120), '打印扫描', '不登录也能打印、扫描')}
            ${exitCard('data-go="policy"', UI.checklist(108), '查政策', '看本机构发布的就业政策')}
          </div>
          <p class="fine">离开 3 分钟没操作会自动退出。${HELP}</p>`,
        dock: { backLabel: '返回首页', ask: '问小青：不登录能办什么？', pri: { label: '去登录', go: 'login' } },
      });
    }
    const pre = shell('me', { eye: '我的', what: '记录', ask: '问小青：我的记录在哪里找？' });
    if (pre && mode() !== 'empty') return pre;
    const p = person();
    const empty = mode() === 'empty';
    const n = empty
      ? { resumes: 0, docs: 0, orders: 0, fav: 0, ben: 0, ai: 0 }
      : { resumes: alive(RESUMES).length, docs: alive(DOCS).length, orders: ORDERS.length, fav: FAVS.length, ben: BENS.length, ai: alive(AIS).length };
    const counts = [
      ['my-resumes', '我的简历', '这次要用哪一份', n.resumes],
      ['my-docs', '我的文档', '传上来和生成的文件', n.docs],
      ['my-orders', '打印订单', '进度和到机码', n.orders],
      ['my-fav', '我的收藏', '收藏的政策', n.fav],
      ['my-benefits', '我的权益', '能不能用', n.ben],
      ['my-ai', 'AI 服务记录', '诊断、生成和面试', n.ai],
    ];
    const sync = miniOn() ? '<p class="fe-sync">和手机小程序是同一个账号：简历、文档、AI 记录、打印订单、消息两边都能看到</p>' : '';
    const links = [
      ['my-activity', '浏览与跳转记录', '你看过的政策，和打开过的来源'],
      ['notifications', '消息通知', '打印、反馈和公告'],
      ['help', '帮助中心', '常见问题与服务电话'],
      ['feedback', '意见反馈', '提交后能看到处理状态'],
      ['privacy', '隐私请求', '可撤回 AI 使用授权'],
      ['settings', '账号设置', '换绑、协议、结束使用'],
    ];
    const starters = empty ? `<div class="fe-trio">
      ${btn('fe-line', 'data-go="resume-src"', '<b>上传或扫描简历</b><small>解析完可以诊断</small>')}
      ${btn('fe-line', 'data-go="print"', '<b>打印带来的文件</b><small>U 盘、手机或扫描</small>')}
      ${btn('fe-line', 'data-go="policy"', '<b>看看就业政策</b><small>以官方原文为准</small>')}
    </div>` : '';
    return frame('me', {
      title: '我的',
      sub: '简历、文档、订单、收藏与权益都在这里。',
      status: meStatus(),
      body: `<div class="fe-id"><b>${p.name}</b><span>${p.phone} · 公共终端不显示完整个人信息</span></div>
        ${sync}
        <div class="fe-counts">${counts.map((c) => `<button type="button" class="fe-count" data-go="${c[0]}"><span>${c[1]}</span><small>${c[2]}</small><b>${count(c[3])}<em>条</em></b></button>`).join('')}</div>
        ${todoCard()}
        ${starters}
        <div class="${empty ? 'fe-links' : 'fe-rows'}">${links.map((c) => btn('fe-line', `data-go="${c[0]}"`, `<b>${c[1]}</b><small>${c[2]}</small>`)).join('')}</div>`,
      dock: { backLabel: '返回首页', ask: '问小青：我的记录在哪里找？', mid: btn('btn danger', 'data-fe="end"', '结束使用') },
    });
  }

  function tail(n, open, html) {
    if (!html || n >= 5 || open) return '';
    return `<div class="fe-stack">${html}</div>`;
  }
  function pageNotes() {
    const pre = shell('notifications', { eye: '我的 · 消息', what: '消息', ask: '问小青：未读消息在哪里？' });
    if (pre) return pre;
    const filt = bag('notifications').filt || S().feFilt || 'all';
    if (filt !== 'all' && filt !== 'unread') bag('notifications').filt = 'all';
    const cur = (bag('notifications').filt === 'unread' || S().feFilt === 'unread') ? 'unread' : 'all';
    const read = (id) => S().feAllRead || (S().feRead && S().feRead[id]);
    let rows = alive(NOTES).map((n) => Object.assign({}, n, { unread: n.unread && !read(n.id) }));
    if (mode() === 'empty') rows = [];
    const shown = cur === 'unread' ? rows.filter((n) => n.unread) : rows;
    const unreadN = rows.filter((n) => n.unread).length;
    const kinds = ['打印', 'AI 服务', '反馈', '维护', '公告', '系统'];
    const open = openOf('notifications');
    let main = '';
    if (!rows.length) {
      main = `<p class="fe-p">还没有消息。</p>
        <div class="fe-kinds">${kinds.map((k) => `<div><b>${k}</b><span>暂无</span></div>`).join('')}</div>
        <div class="fe-stack">
          ${exitCard('data-go="print"', UI.usb(120), '去打印', '打印和扫描不需要先有消息')}
          ${exitCard('data-go="feedback"', UI.checklist(120), '去提反馈', '设备、打印或文件上的问题可以写在这里')}
        </div>
        ${helpRemind()}`;
    } else if (!shown.length) {
      main = `<p class="fe-p">未读里没有消息。</p>
        <div class="fe-stack">
          ${exitCard('data-fe="filt" data-arg="all"', UI.checklist(120), '查看全部', '已读的消息也在全部里')}
          ${exitCard('data-go="print"', UI.usb(120), '去打印', '打印和扫描现在就能办')}
        </div>`;
    } else {
      const list = shown.map((n) => {
        const chip = n.ai ? '<span class="fe-ai">AI 生成，仅供参考</span>' : '';
        const acts = open === n.id ? `<div class="fe-acts">${n.fb ? btn('btn sec sm', 'data-go="feedback"', '查看相关反馈') : ''}${n.unread ? btn('btn sec sm', `data-fe="read" data-arg="${n.id}"`, '已读') : ''}${delBtns(n.id)}</div>` : '';
        return `<div class="fe-line">${btn('fe-open', `data-fe="open" data-arg="${n.id}"`, `<b>${n.unread ? '未读 · ' : ''}${n.title}</b><small>${n.kind} · ${n.body} · ${n.time}</small>${chip}`)}${acts}</div>`;
      }).join('');
      main = `${deletedNote()}${delFail()}${rowBox(list, shown.length, !!open)}${moreBtn()}
        ${tail(shown.length, !!open, `${exitCard('data-go="feedback"', UI.checklist(110), '去提反馈', '打印或设备上的问题可以写下来')}${exitCard('data-go="print"', UI.usb(110), '去打印', '不看消息也能打印、扫描')}`)}`;
    }
    return frame('notifications', {
      eye: '我的 · 消息',
      title: !rows.length ? '还没有消息' : (unreadN ? (unreadN + ' 条未读') : '消息都看过了'),
      sub: '只有你本人能看到',
      body: `${seg([['all', '全部'], ['unread', '未读']], cur, 'filt')}${main}`,
      dock: { ask: '问小青：未读消息在哪里？', mid: unreadN ? btn('btn pri', 'data-fe="readall"', '全部标为已读') : btn('btn pri', 'disabled', '全部已读') },
    });
  }

  function pageResumes() {
    const pre = shell('my-resumes', { eye: '我的 · 简历', what: '简历', ask: '问小青：哪一份还能打开？' });
    if (pre) return pre;
    const rows = mode() === 'empty' ? [] : alive(RESUMES);
    const open = openOf('my-resumes');
    let main = '';
    if (!rows.length) {
      main = emptyPack('这个账号还没有简历记录。', [
        exitCard('data-go="resume-src"', UI.resume(120), '上传一份简历', '从手机或 U 盘选一份，接着做诊断'),
        exitCard('data-go="scan-guide"', UI.scanPaper(120), '扫描纸质简历', '把纸质简历扫进来'),
        exitCard('data-go="scratch"', UI.checklist(110), '从零生成', '没有旧简历也可以做'),
      ].join(''));
    } else {
      const list = rows.map((r) => {
        const acts = open === r.id ? `<div class="fe-acts">${r.kind === 'parse'
          ? `${btn('btn pri sm', r.ok ? 'data-go="diagnosis"' : 'disabled', '查看报告')}${btn('btn sec sm', r.ok ? 'data-go="optimize"' : 'disabled', r.opt === '已生成优化版' ? '查看优化版' : '继续优化')}${btn('btn sec sm', r.ok ? 'data-go="jobfit"' : 'disabled', '简历对照')}`
          : `${btn('btn pri sm', r.ok ? 'data-go="gen-preview"' : 'disabled', '查看并打印')}${btn('btn sec sm', 'disabled', '简历对照')}`}${delBtns(r.id)}</div>
          ${r.kind === 'gen' ? '<p class="fe-reason">生成简历暂不能直接对照；请先导出，再上传诊断。</p>' : ''}
          ${r.ok ? '' : `<p class="fe-reason">${r.sub}</p>`}` : '';
        return `<div class="fe-line">${btn('fe-open', `data-fe="open" data-arg="${r.id}"`, `<b>${r.title}</b><small>${r.st}${r.opt ? ' · ' + r.opt : ''} · 保留至 ${r.exp}</small><small>${r.sub}</small>`)}${acts}</div>`;
      }).join('');
      main = `${deletedNote()}${delFail()}${rowBox(list, rows.length, !!open)}${moreBtn()}
        <p class="fine">到期日写在每一份上。原始简历不向企业提供，也不投递。离开 3 分钟没操作会自动退出。</p>`;
    }
    return frame('my-resumes', {
      eye: '我的 · 简历',
      title: '我的简历',
      sub: rows.length ? ('共 ' + rows.length + ' 条 · 不显示简历原文') : '这个账号还没有简历记录',
      body: `${goTabs(REC, 'my-resumes')}${main}`,
      dock: { ask: '问小青：哪一份还能打开？', pri: { label: '去上传简历', go: 'resume-src' } },
    });
  }

  function orderView() {
    const o = S().feOrd;
    return ORDERS.map((row) => {
      if (row.id === 'o1' && o === 'queue') return Object.assign({}, row, { st: '排队中', bucket: 'doing' });
      if (row.id === 'o1' && o === 'got') return Object.assign({}, row, { st: '已领取', bucket: 'doing' });
      if (row.id === 'o3' && o === 'cancel') return Object.assign({}, row, { st: '已取消', bucket: 'cancel', refund: false, pay: '暂无支付信息' });
      return row;
    });
  }
  function pageOrders() {
    const pre = shell('my-orders', { eye: '我的 · 打印订单', what: '打印订单', ask: '问小青：失败的订单怎么办？' });
    if (pre) return pre;
    const filt = bag('my-orders').filt || 'all';
    const all = mode() === 'empty' ? [] : orderView();
    const rows = filt === 'all' ? all : all.filter((r) => r.bucket === filt);
    const open = openOf('my-orders');
    const pickup = miniOn() && all.length ? btn('fe-line', 'data-go="pickup"', '<b>手机上下的到店单，到机器上输到机码取件</b><small>还没核销出打印任务的单，不在下面的列表里</small>') : '';
    const filters = seg([['all', '全部'], ['doing', '进行中'], ['done', '已完成'], ['fail', '失败'], ['cancel', '已取消']], filt, 'filt');
    let main = '';
    if (!all.length) {
      main = emptyPack('还没有打印订单。没登录时在这台机器上打的单不会进这个账号。', [
        exitCard('data-go="print"', UI.usb(120), '去打印', 'U 盘、手机或扫描都可以'),
        miniOn()
          ? exitCard('data-go="pickup"', UI.phone(96), '输到机码取件', '手机上下的到店单，到机器上输入到机码')
          : exitCard('data-go="my-docs"', UI.stack(120, 3), '看看我的文档', '选一份已保存的文件再打'),
      ].join(''));
    } else if (!rows.length) {
      main = emptyPack('这个筛选下没有订单。', [
        exitCard('data-fe="filt" data-arg="all"', UI.checklist(120), '查看全部', '全部订单都在「全部」里'),
        exitCard('data-go="print"', UI.usb(120), '去打印', '打一份新的，会新建一张打印任务'),
      ].join(''));
    } else {
      const list = rows.map((r) => {
        let money = '';
        if (r.pay === '暂无支付信息') money = '<p class="fe-p">暂无支付信息</p>';
        else if (r.cents === 0) money = '<p class="fe-p">免费试运营，本单 0 元。</p>';
        else money = '<p class="fe-p">实付：未记录。</p>';
        const detail = open === r.id ? `<div class="fe-acts">${btn('btn pri sm', 'data-go="my-docs"', '去我的文档再打印')}${(r.bucket === 'done' || r.bucket === 'fail') ? btn('btn sec sm', 'data-fe="to-fb"', '反馈问题') : ''}</div>
          <p class="fe-p">${r.copies} · ${r.pages}</p>
          ${money}
          ${r.code ? `<p class="fe-p">到机码 ${r.code}。在到机码页输入，用来取件。订单完成或退款后，这里不再显示。</p>` : ''}
          ${r.refund ? '<p class="fe-reason">待退款。本单已确认未出纸。退款会按支付渠道处理，到账时间以支付渠道为准。</p>' : ''}
          <p class="fe-p">再打印从「我的文档」重新选择文件发起，将创建新的打印任务与订单。</p>` : '';
        return `<div class="fe-line">${btn('fe-open', `data-fe="open" data-arg="${r.id}"`, `<b>${r.name}</b><small>${r.st} · ${r.when} · ${r.pay}${r.code ? ' · 到机码' : ''}</small>`)}${detail}</div>`;
      }).join('');
      const note = S().feRefresh === 'fail'
        ? '刚才这次刷新没成功，过一会儿会再试。没登录时在这台机器上打的单不会进这个账号。'
        : '进行中的订单会自动刷新。没登录时在这台机器上打的单不会进这个账号。';
      main = `${rowBox(list, rows.length, !!open)}${moreBtn()}
        <div class="remind">${icon('alert', 34, 2)}<span>${note}</span></div>
        ${tail(rows.length, !!open, `${exitCard('data-go="print"', UI.usb(110), '去打印', '打一份新的，会新建一张打印任务')}${exitCard('data-go="my-docs"', UI.stack(110, 3), '去我的文档', '从已保存的文件里再选一份')}`)}`;
    }
    return frame('my-orders', {
      eye: '我的 · 打印订单',
      title: '打印订单',
      sub: all.length ? ('共 ' + all.length + ' 条已产生打印任务的单') : '还没有归入账号的打印任务',
      body: `${goTabs(ASSET, 'my-orders')}${pickup}${filters}${main}`,
      dock: { ask: '问小青：失败的订单怎么办？', pri: { label: '去打印', go: 'print' } },
    });
  }

  function pageDocs() {
    const picking = S().ctx === 'print';
    const pre = shell('my-docs', { eye: '我的 · 文档', what: '文档', ask: '问小青：哪一种文件能打？' });
    if (pre) return pre;
    let rows = mode() === 'empty' ? [] : alive(DOCS);
    if (picking) rows = rows.slice().sort((a, b) => (printable(a) === printable(b) ? 0 : printable(a) ? -1 : 1));
    const open = openOf('my-docs');
    const back = picking
      ? { back: false, left: btn('btn sec', 'data-go="print-src"', '返回'), ask: '问小青：哪一种文件能打？' }
      : { ask: '问小青：哪一种文件能打？', pri: { label: '去打印', go: 'print' } };
    let main = '';
    if (!rows.length) {
      const sentence = '登录后上传的文档才会出现在这里。游客上传的文件不会自动归入你的账号。' + (miniOn() ? '在手机小程序登录后传的文件也会出现在这里。' : '');
      main = emptyPack(sentence, [
        picking
          ? exitCard('class="fe-tall" data-go="print-src"', UI.resume(200), '返回选文件', '回到刚才的打印')
          : exitCard('class="fe-tall" data-go="print"', UI.phone(160), '去打印', 'U 盘、手机或扫描都可以'),
        exitCard('class="fe-tall" data-go="my-orders"', UI.report(180), '看看打印订单', '已经打过的，进度在订单里'),
      ].join(''));
    } else {
      const list = rows.map((d) => {
        const can = printable(d);
        const reason = d.reprint === false ? '该报告仅可查看，不可打印' : (can ? '' : '该文件格式暂不支持打印');
        const conv = d.ext === 'docx';
        const converted = S().feConvert && S().feConvert[d.id];
        const acts = open === d.id ? `<div class="fe-acts">
          ${can ? btn('btn pri sm', 'data-go="pii"', '打印') : btn('btn pri sm', 'disabled', '打印')}
          ${btn('btn sec sm', `data-fe="view" data-arg="${d.name}"`, '查看')}
          ${d.policy === 'system_short' || d.policy === 'months_3' || d.policy === 'months_6' ? btn('btn sec sm', `data-fe="retain" data-arg="${d.id}"`, '改保存期限') : ''}
          ${signable(d) ? (S().controlsOn ? btn('btn sec sm', 'data-go="sign"', '签名') : btn('btn sec sm', 'disabled', '签名 · 本机暂未开通')) : ''}
          ${conv ? (converted ? btn('btn sec sm', 'disabled', '转 PDF') : btn('btn sec sm', `data-fe="convert" data-arg="${d.id}"`, '转 PDF')) : ''}
          ${delBtns(d.id)}
        </div>
        ${reason ? `<p class="fe-reason">${reason}</p>` : ''}
        ${conv && converted ? '<p class="fe-reason">Word 转换暂未开放，请另存为 PDF 上传</p>' : ''}` : (reason ? `<p class="fe-reason">${reason}</p>` : '');
        return `<div class="fe-line">${btn('fe-open', `data-fe="open" data-arg="${d.id}"`, `<b>${d.name}</b><small>${d.meta}${d.pages ? ' · ' + d.pages : ''} · ${keepLabel(d)}</small>`)}${acts}</div>`;
      }).join('');
      main = `${picking ? '<p class="fe-p">能打印的排在前面。选一份，接着做材料检查。</p>' : ''}
        ${deletedNote()}${delFail()}${rowBox(list, rows.length, !!open)}${moreBtn()}
        <p class="fine">PDF、JPG、PNG 可以直接打印。Word 请另存为 PDF。原始简历、求职材料登录后默认保存 90 天。离开 1 分 30 秒没操作会自动退出。</p>`;
    }
    return frame('my-docs', {
      eye: '我的 · 文档',
      title: picking ? '选一份来打印' : '我的文档',
      sub: picking ? '点一份文档的「打印」，接着做材料检查' : (rows.length ? '文件名、大小、上传时间和保存期限' : '这里还没有文档'),
      body: `${goTabs(ASSET, 'my-docs')}${main}`,
      dock: back,
    }) + layer();
  }

  function pageAi() {
    const pre = shell('my-ai', { eye: '我的 · AI 服务记录', what: 'AI 服务记录', ask: '问小青：打不开的记录怎么办？' });
    if (pre) return pre;
    const rows = mode() === 'empty' ? [] : alive(AIS);
    const open = openOf('my-ai');
    const down = S().ai === 'down';
    let main = '';
    if (!rows.length) {
      main = emptyPack(down
        ? '还没有 AI 服务记录。小青这次不可用，打印和政策不受影响。'
        : '还没有 AI 服务记录。做过诊断、优化、生成、规划或模拟面试之后，会出现在这里。', [
        down
          ? exitCard('data-go="print"', UI.usb(120), '去打印', '打印不需要小青')
          : exitCard('data-go="resume"', UI.resume(120), '去做简历诊断', '上传一份简历，先做诊断'),
        exitCard('data-go="policy"', UI.checklist(110), '查政策', '看本机构发布的就业政策'),
      ].join(''));
    } else {
      const list = rows.map((r) => {
        const chip = r.ai ? '<span class="fe-ai">AI 生成，仅供参考</span>' : '';
        const acts = open === r.id ? `<div class="fe-acts">${r.onlyDel ? '' : (r.ok ? btn('btn pri sm', `data-go="${r.go}"`, r.kind === '模拟面试' ? '打开报告' : '打开') : btn('btn pri sm', 'disabled', '打开'))}${delBtns(r.id)}</div>${r.why ? `<p class="fe-reason">${r.why}</p>` : ''}` : '';
        return `<div class="fe-line">${btn('fe-open', `data-fe="open" data-arg="${r.id}"`, `<b>${r.kind}</b><small>${r.st} · ${r.when} · 保留至 ${r.exp}</small>${chip}`)}${acts}</div>`;
      }).join('');
      main = `${down ? '<p class="fe-reason">小青这次不可用。已经生成的记录还可以打开；新的诊断要等服务恢复。</p>' : ''}
        ${deletedNote()}${delFail()}${rowBox(list, rows.length, !!open)}
        ${btn('btn sec sm', 'data-go="iv-reports"', '看全部模拟面试练习记录')}
        <p class="fine">诊断、优化、生成、对照、规划、自我探索和模拟面试都在这里。离开 3 分钟没操作会自动退出。</p>`;
    }
    return frame('my-ai', {
      eye: '我的 · AI 服务记录',
      title: 'AI 服务记录',
      sub: '列表不显示原文、提示词和输出全文',
      body: `${goTabs(REC, 'my-ai')}${main}`,
      dock: { ask: '问小青：打不开的记录怎么办？', pri: { label: '去做简历诊断', go: 'resume' } },
    });
  }

  function pageActivity() {
    const pre = shell('my-activity', { eye: '我的 · 浏览记录', what: '浏览与跳转记录', ask: '问小青：这些记录会发给企业吗？' });
    if (pre) return pre;
    const sub = bag('my-activity').sub || 'browse';
    const map = { browse: BROWSE, jump: JUMPS, job: [] };
    const rows = mode() === 'empty' ? [] : (map[sub] || BROWSE);
    let body = goTabs(REC, 'my-activity') + seg([['browse', '浏览'], ['jump', '外部跳转']].concat(S().feJobs ? [['job', '求职进度']] : []), sub, 'sub');
    if (sub === 'job') {
      const stats = [['意向中', '还在考虑，还没投'], ['已投递', '已经投出去了'], ['面试中', '约了面试'], ['已拿Offer', '拿到了录用'], ['已拒绝', '没有继续']];
      body += `<p class="fe-p">求职进度是本人自己填的。手填还在建设，现在不能填。</p>
        ${btn('btn sec', 'disabled', '待建设')}
        ${rowBox(stats.map((s) => `<div class="fe-static"><b>${s[0]}</b><small>${s[1]}</small></div>`).join(''), 5, false)}
        <div class="fe-stack">${exitCard('data-go="policy"', UI.checklist(120), '查看政策', '进度不能填的时候，可以先看政策')}</div>`;
    } else if (!rows.length) {
      body += emptyPack('这里还没有记录。只记你在这台机器上浏览和打开的来源。', [
        exitCard('data-go="policy"', UI.checklist(120), '查看政策', '看本机构发布的就业政策'),
        exitCard('data-go="print"', UI.usb(120), '去打印', '打印和扫描现在就能办'),
      ].join(''));
    } else {
      body += rowBox(rows.map((r) => btn('fe-line', 'data-go="policy-detail"', `<b>${r.t}</b><small>${r.m}</small>`)).join(''), rows.length, false);
      body += '<p class="fine">只记你在这台机器上看过的政策。取消收藏在政策页里。离开 3 分钟没操作会自动退出。</p>';
    }
    return frame('my-activity', {
      eye: '我的 · 浏览记录',
      title: '浏览与跳转记录',
      sub: '只记录浏览和打开，不记录你在别的平台办了什么',
      body,
      dock: { ask: '问小青：这些记录会发给企业吗？', pri: { label: '查看政策', go: 'policy' } },
    });
  }

  function pageFav() {
    const pre = shell('my-fav', { eye: '我的 · 收藏', what: '收藏', ask: '问小青：收藏的政策在哪里看？' });
    if (pre) return pre;
    const rows = mode() === 'empty' ? [] : FAVS;
    const main = rows.length
      ? `${rowBox(rows.map((r) => btn('fe-line', 'data-go="policy-detail"', `<b>${r.t}</b><small>${r.m}</small>`)).join(''), rows.length, false)}
        <p class="fine">点一条打开政策。取消收藏在政策页里。离开 3 分钟没操作会自动退出。</p>`
      : emptyPack('还没有收藏。收藏只是方便下次再找，不含投递结果。', [
        exitCard('class="fe-tall" data-go="policy"', UI.checklist(160), '查看政策', '看本机构发布的就业政策'),
        exitCard('class="fe-tall" data-go="print"', UI.phone(160), '去打印', '打印和扫描现在就能办'),
      ].join(''));
    return frame('my-fav', {
      eye: '我的 · 收藏',
      title: rows.length ? ('你收藏的 ' + rows.length + ' 条政策') : '还没有收藏',
      sub: '只收藏政策',
      body: `${goTabs(REC, 'my-fav')}${main}`,
      dock: { ask: '问小青：收藏的政策在哪里看？', pri: { label: '查看政策', go: 'policy' } },
    });
  }

  function pageBenefits() {
    const pre = shell('my-benefits', { eye: '我的 · 权益', what: '权益', ask: '问小青：权益现在能抵扣吗？', nav: 'me' });
    if (pre) return pre;
    const rows = mode() === 'empty' ? [] : BENS;
    const tabs = goTabs([['my-benefits', '我的权益'], ['activities', '可参加的活动']], 'my-benefits');
    const main = rows.length
      ? `${rowBox(rows.map((b) => `<div class="fe-static"><b>${b.t}</b><small>${b.type} · ${b.src} · ${b.st}</small><small>${b.d}</small></div>`).join(''), rows.length, false)}
        <div class="fe-block">
          ${btn('fe-line', 'data-go="print"', '<b>打印与扫描</b><small>没有权益也能办</small>')}
          ${btn('fe-line', 'data-go="resume"', '<b>AI 简历服务</b><small>没有权益也能办</small>')}
          ${btn('fe-line', 'data-go="policy"', '<b>就业政策与补贴指引</b><small>说明不等于补贴已发放</small>')}
        </div>
        <p class="fine">能不能用由系统判定，这里不能领取。离开 3 分钟没操作会自动退出。</p>`
      : emptyPack('还没有权益。没有权益也照常能打印、做简历、查政策。', [
        exitCard('data-go="print"', UI.usb(110), '打印与扫描', '没有权益也能办'),
        exitCard('data-go="resume"', UI.resume(110), 'AI 简历服务', '没有权益也能办'),
        exitCard('data-go="policy"', UI.checklist(100), '就业政策与补贴指引', '说明不等于补贴已发放'),
      ].join(''));
    return frame('my-benefits', {
      eye: '我的 · 权益',
      title: rows.length ? ('你有 ' + rows.length + ' 项权益') : '还没有权益',
      sub: '能不能用由系统判定',
      status: { text: rows.length ? '已登录' : '还没有权益' },
      body: `${tabs}${main}`,
      dock: { ask: '问小青：权益现在能抵扣吗？', pri: { label: '看看活动', go: 'activities' } },
    });
  }

  function actBtn(a) {
    if (a.ended) return btn('btn sec', 'disabled', '已结束');
    if (a.soldout) return btn('btn sec', 'disabled', '已领完');
    if (a.claimed) return btn('btn pri sm', 'data-go="my-benefits"', '查看我的权益');
    if (!S().logged) return btn('btn pri sm', 'data-go="login"', '登录后领取');
    return btn('btn pri sm', `data-fe="open-act" data-arg="${a.id}"`, '查看活动');
  }
  function pageActivities() {
    const m = mode();
    if (m === 'error') return err('activities', { eye: '权益活动', ask: '问小青：领取代表报名了吗？', nav: false });
    if (m === 'loading') return loading('activities', { eye: '权益活动', ask: '问小青：领取代表报名了吗？', nav: false });
    const rows = m === 'empty' ? [] : ACTS;
    const main = rows.length
      ? `${rowBox(rows.map((a) => `<div class="fe-line fe-act"><div class="fe-chips"><span class="chip">${a.src}</span><span class="chip slate">${a.type}</span><span class="chip${a.ended || a.soldout ? ' clay' : ''}">${a.stock}</span></div><b>${a.title}</b><small>${a.desc}</small><small>${a.scope} · ${a.validity} · ${a.quantityText}</small>${actBtn(a)}</div>`).join(''), rows.length, false)}
        <p class="fine">领取不代表报名、签到或投递。没登录也可以先看。</p>`
      : emptyPack('现在没有可参加的活动。', [
        exitCard('class="fe-tall" data-go="print"', UI.phone(180), '去打印', '没有活动也能打印、扫描'),
        exitCard('class="fe-tall" data-go="policy"', UI.checklist(160), '查政策', '看本机构发布的就业政策'),
      ].join(''));
    return frame('activities', {
      eye: '权益活动',
      title: rows.length ? '现在可以看的活动' : '现在没有活动',
      sub: '只用于这台机器的服务和打印',
      status: { text: rows.length ? '可以先看再领' : '现在没有活动' },
      nav: false,
      body: `${btn('btn sec sm', 'data-go="my-benefits"', '我的权益')}${main}`,
      dock: { ask: '问小青：领取代表报名了吗？' },
    });
  }

  function claimState(id) {
    const map = S().feClaimMap || {};
    if (map[id]) return map[id];
    if ((S().feAct || 'a1') === id && typeof S().feClaim === 'string') return S().feClaim;
    return '';
  }
  function qtyText(a) {
    if (a.quantityText) return a.quantityText;
    return '一次性权益';
  }
  function pageActDetail() {
    const m = mode();
    if (m === 'error') return err('activity-detail', { eye: '权益活动', ask: '问小青：领了之后在哪里看？', nav: false });
    if (m === 'loading') return loading('activity-detail', { eye: '权益活动', ask: '问小青：领了之后在哪里看？', nav: false });
    const id = S().feAct || 'a1';
    const a = ACTS.filter((x) => x.id === id)[0] || ACTS[0];
    const st = claimState(a.id);
    let action = '';
    if (a.ended) action = btn('btn sec', 'disabled', '已结束');
    else if (a.soldout) action = btn('btn sec', 'disabled', '已领完');
    else if (a.claimed || st === 'ok') action = `<p class="fe-p">已领取。还在这一页。</p>${btn('btn pri', 'data-go="my-benefits"', '查看我的权益')}`;
    else if (!S().logged) action = btn('btn pri', 'data-go="login"', '登录后领取');
    else if (st === 'ing') action = btn('btn pri', 'disabled', '领取中…');
    else if (st === 'fail') action = `<p class="fe-reason">这次没有领到，还在这一页。</p>${btn('btn pri', 'data-fe="claim"', '再试一次')}`;
    else action = btn('btn pri', 'data-fe="claim"', '立即领取');
    const rules = a.rules && a.rules.length
      ? `<div class="fe-static fe-pin"><b>活动规则</b>${a.rules.map((t, i) => `<div class="fe-rule"><i>${i + 1}</i><span>${t}</span></div>`).join('')}</div>`
      : '';
    const top = `<div class="fe-hero">${UI.checklist(150)}<div>
      <div class="fe-chips"><span class="chip">${a.src}</span><span class="chip slate">${a.type}</span><span class="chip${a.ended || a.soldout ? ' clay' : ''}">${a.stock}</span></div>
      <b>${a.title}</b>
      <p class="fe-p">${a.desc}</p>
      <p class="fe-p">适用范围：${a.scope}</p>
      <p class="fe-p">有效期：${a.validity} · 额度：${qtyText(a)}</p>
    </div></div>`;
    const after = `<div class="fe-hero">${UI.stack(130, 3)}<div>
      <b>领了之后</b>
      <p class="fe-p">余量在我的权益里看。</p>
      <p class="fe-p">领取不代表报名或投递，只在这台机器使用。</p>
      <p class="fe-p">抵扣功能尚未开放。</p>
    </div></div>`;
    return frame('activity-detail', {
      eye: '权益活动 · ' + a.src + ' · ' + a.type,
      title: a.title,
      sub: a.stock + ' · 领取后仍留在这一页',
      status: { text: a.stock, warn: !!(a.ended || a.soldout) },
      nav: false,
      body: `<div class="fe-split">${top}${rules}${after}</div>${action}`,
      dock: { ask: '问小青：领了之后在哪里看？', mid: btn('btn sec', 'data-go="my-benefits"', '我的权益') },
    });
  }

  function pageFeedback() {
    const pre = shell('feedback', { eye: '我的 · 意见反馈', what: '反馈', ask: '问小青：投诉 AI 内容怎么写？' });
    if (pre) return pre;
    const cat = S().feCat || 'print';
    const cats = [['device', '设备使用'], ['print', '打印服务'], ['file', '文件处理'], ['idea', '一般建议'], ['ai', 'AI 内容投诉']];
    const ai = cat === 'ai';
    const sent = S().feSent === true || S().feSent === 1 || S().feSent === '1';
    const fail = S().feSent === 'fail';
    const svc = !!S().feSvc;
    const closed = !!S().feClosed;
    const extra = !!S().feExtra;
    const hist = `<div class="fe-rows">
      <div class="fe-line"><b>打印出来的字有点淡</b><small>打印服务 · 10 月 22 日 · ${closed ? '已关闭' : '已回复'}</small>
        <p class="fe-p">${extra ? '已补充：今天 14:12 又打了一张，字还是偏淡。' : '回复：已经记下，下次维护时会检查。你也可以在我的文档里再打一份。'}</p>
        ${closed ? '' : `<div class="fe-acts">${extra ? '' : btn('btn sec sm', 'data-fe="extra"', '补充回复')}${S().feShut ? btn('btn danger sm', 'data-fe="shut"', '再点一次确认关闭') : btn('btn sec sm', 'data-fe="shut"', '关闭工单')}</div>`}</div>
      <div class="fe-line"><b>希望能打印 A3</b><small>一般建议 · 10 月 18 日 · 处理中</small>
        <p class="fe-p">已收到。这台机器目前按 A4 出纸，更大的纸张这次办不了。</p>
        <p class="fe-p">文件可以先留在我的文档里，用 A4 再打。</p></div>
    </div>`;
    let head = '';
    let heroBlock = '';
    if (svc) {
      heroBlock = hero(UI.scanPaper(150), '反馈服务这次不可用', '已填写的内容还在。这不是简历功能停用。') + btn('btn pri sm', 'data-fe="svc-clear"', '重新提交');
    } else if (sent) {
      heroBlock = hero(UI.checklist(140), '已提交', ai
        ? '对 AI 生成的内容有异议，我们在 5 个工作日内答复。答复在消息里查看。'
        : '其他反馈不承诺受理结论或回复时限。') + btn('btn sec sm', 'data-go="notifications"', '到消息里看进度');
    } else {
      const draft = cat === 'print'
        ? '打印出来的字偏淡，今天 14:12 打的毕业生就业推荐表，等了两分钟也没有重打入口。'
        : (ai ? '写清是哪个功能、大概什么时间、哪段内容有问题。' : '写清是什么时候、在哪一步遇到的。标题和电话可以不填。');
      const lead = ai
        ? '对 AI 生成的内容有异议，写清是哪个功能、大概什么时间、哪段内容有问题。我们在 5 个工作日内答复。'
        : '本人工单，不承诺回复时限。';
      head = seg(cats, cat, 'cat');
      heroBlock = `<div class="fe-hero">${UI.scanPaper(180)}<div><b>情况</b><p class="fe-p">${lead}</p>${fail ? '<p class="fe-reason">这次没提交成功，内容还在，可以再提交。</p>' : ''}<p class="fe-p">${draft}</p><div class="fe-acts">${btn('btn sec sm', 'data-act="toast" data-arg="演示：弹出屏上键盘"', '填写标题（选填）')}${btn('btn sec sm', 'data-act="toast" data-arg="演示：弹出屏上键盘"', '填写电话（选填）')}</div></div></div>`;
    }
    return frame('feedback', {
      eye: '我的 · 意见反馈',
      title: sent ? '反馈已提交' : (svc ? '反馈这次提交不了' : '遇到什么问题了？'),
      sub: ai ? 'AI 内容投诉 5 个工作日内答复' : '其他反馈不承诺回复时限',
      status: { text: ai ? '5 个工作日内答复' : '不承诺回复时限' },
      body: `${head}<div class="fe-split">${heroBlock}${hist}</div>`,
      dock: {
        ask: '问小青：投诉 AI 内容怎么写？',
        mid: sent || svc ? '' : btn('btn pri', 'data-fe="send"', '提交反馈'),
      },
    });
  }

  function consentView() {
    const c = S().feConsent;
    if (!S().logged) return { cap: { text: '未登录' }, title: '登录后查看', text: '登录后可以查看 AI 使用授权。', retry: false };
    if (c === 'loading' || c === 'query') return { cap: { text: '正在读取' }, title: '正在读取', text: '正在读取你的 AI 使用授权。', retry: false };
    if (c === 'error') return { cap: { text: '这次没读到', warn: 1 }, title: '这次没读到', text: '这次没有读到授权结果，可以重新读取。', retry: true };
    if (c === 'not-granted') return { cap: { text: '未授权', warn: 1 }, title: '未授权', text: '你还没有同意用 AI 辅助处理简历。', retry: false };
    return { cap: { text: '已授权' }, title: '已授权', text: '你已经同意用 AI 辅助处理简历。', retry: false };
  }
  function pageSettings() {
    if (mode() === 'error') return err('settings', { eye: '我的 · 账号设置', ask: '问小青：怎么注销账号？' });
    if (mode() === 'loading') return loading('settings', { eye: '我的 · 账号设置', ask: '问小青：怎么注销账号？' });
    const logged = !!S().logged;
    const v = consentView();
    const rebind = S().feRebind;
    const rebindBit = rebind === 'ing'
      ? '<p class="fe-p">正在提交换绑。</p>'
      : (rebind === 'ok' ? `<p class="fe-p">换绑已提交，请退出并重新登录。</p>${btn('btn pri sm', 'data-fe="switch-go"', '退出并重新登录')}` : '');
    const wd = S().feWithdraw === 'ing' ? '<p class="fe-p">正在提交撤回。</p>' : '';
    const rows = logged
      ? `<div class="fe-block">
          ${btn('fe-line', 'data-fe="rebind"', '<b>换绑手机号</b><small>先验证现在的号码，再验证新号码</small>')}
          ${btn('fe-line', 'data-fe="switch"', '<b>换一个账号登录</b><small>会先结束当前这一位的使用</small>')}
          ${btn('fe-line', 'data-go="privacy"', '<b>隐私与数据请求</b><small>可以撤回 AI 使用授权</small>')}
        </div>`
      : `<div class="fe-block">
          ${btn('fe-line', 'disabled', '<b>换绑手机号</b><small>登录后可用</small>')}
          ${btn('fe-line', 'disabled', '<b>换一个账号登录</b><small>登录后可用</small>')}
          ${btn('fe-line', 'data-go="privacy"', '<b>隐私与数据请求</b><small>登录后可以办理</small>')}
        </div>`;
    const consent = `<div class="fe-hero">${UI.checklist(150)}<div>
      <b>${v.title}</b>
      <p class="fe-p">${v.text}</p>
      ${logged ? rebindBit + wd : ''}
      ${logged ? `<div class="fe-acts">${v.retry ? btn('btn sec sm', 'data-fe="consent-retry"', '重新读取') : btn('btn sec sm', 'disabled', '重新读取')}${btn('btn sec sm', 'data-fe="wd-set"', '撤回')}</div>` : ''}
    </div></div>`;
    const legal = `<div class="fe-hero">${UI.resume(140)}<div>
      <b>协议与注销</b>
      <p class="fe-p">用户服务协议和隐私政策不登录也能看。注销账号、复制个人信息，请按《隐私政策》里的电话、邮箱联系我们申请。我们核实是你本人后，15 个工作日内处理。一体机上不能直接注销。</p>
      <div class="fe-acts">${btn('btn sec sm', 'data-go="legal"', '用户服务协议')}${btn('btn sec sm', 'data-go="legal"', '隐私政策')}</div>
    </div></div>`;
    return frame('settings', {
      eye: '我的 · 账号设置',
      title: '账号设置',
      sub: logged ? (person().phone + ' · 只在这台机器上有效') : '当前是游客',
      status: v.cap,
      body: `${rows}<div class="fe-split">${consent}${legal}</div>`,
      dock: logged
        ? { ask: '问小青：怎么注销账号？', mid: btn('btn danger', 'data-fe="end-ask"', '结束使用') }
        : { ask: '问小青：怎么注销账号？', pri: { label: '去登录', go: 'login' } },
    }) + layer();
  }

  function pagePrivacy() {
    const pre = shell('privacy', { eye: '我的 · 隐私与数据请求', what: '隐私与数据请求', ask: '问小青：撤回授权会怎样？' });
    if (pre) return pre;
    const ing = S().feWithdraw === 'ing';
    const rec = S().feReq;
    const left = `<div class="fe-hero">${UI.resume(150)}<div>
      <b>撤回 AI 使用授权</b>
      <p class="fe-p">不影响简历诊断、打印、收藏或已保存的文件。</p>
      <p class="fe-p">撤回不会删除简历、文档、打印订单或收藏，也不等于注销。</p>
      ${ing ? '<p class="fe-p">正在提交撤回。</p>' : btn('btn danger sm', 'data-fe="wd"', '撤回授权')}
    </div></div>`;
    const right = `<div class="fe-hero">${UI.checklist(150)}<div>
      <b>导出、注销和申请记录</b>
      ${btn('btn sec sm', 'disabled', '导出资料清单')}
      <p class="fe-p">一体机未开放。按《隐私政策》里的联系方式申请。</p>
      ${btn('btn sec sm', 'disabled', '账号注销')}
      <p class="fe-p">暂未开放。一体机上不能直接注销。</p>
      <p class="fe-p">${rec ? ('撤回 AI 使用授权 · ' + rec) : '还没有申请记录。'}</p>
      ${btn('fe-line', 'data-go="legal"', '<b>查看《隐私政策》</b><small>电话和邮箱写在政策里</small>')}
    </div></div>`;
    return frame('privacy', {
      eye: '我的 · 隐私与数据请求',
      title: '你的信息由你决定',
      sub: '撤回可以在这里办；导出和注销不在这台机器上提交',
      status: { text: rec ? '有申请记录' : '已登录' },
      body: `<div class="fe-split">${left}${right}</div>`,
      dock: { ask: '问小青：撤回授权会怎样？' },
    }) + layer();
  }

  const pages = {
    me: pageMe,
    notifications: pageNotes,
    'my-resumes': pageResumes,
    'my-orders': pageOrders,
    'my-docs': pageDocs,
    'my-ai': pageAi,
    'my-activity': pageActivity,
    'my-fav': pageFav,
    'my-benefits': pageBenefits,
    activities: pageActivities,
    'activity-detail': pageActDetail,
    feedback: pageFeedback,
    settings: pageSettings,
    privacy: pagePrivacy,
  };

  function onAct(page, fe, arg) {
    const s = S();
    const b = bag(page);
    if (fe === 'reload') {
      s.feError = false; s.feLoading = false; s.feEmpty = false; s.feMore = ''; s.feDelFail = false;
    } else if (fe === 'me-yes') s.feHandover = false;
    else if (fe === 'me-no') { endUse(); return; }
    else if (fe === 'end') { endUse(); return; }
    else if (fe === 'end-yes') { endUse(); return; }
    else if (fe === 'end-ask') s.feSheet = 'end';
    else if (fe === 'close') { s.feSheet = ''; s.feView = ''; }
    else if (fe === 'open') b.open = b.open === arg ? false : arg;
    else if (fe === 'filt') b.filt = arg;
    else if (fe === 'sub') b.sub = arg;
    else if (fe === 'arm') s.feArm = arg;
    else if (fe === 'unarm') s.feArm = '';
    else if (fe === 'del') {
      if (s.feDelFail) { /* 演示失败时这一下不删 */ }
      else {
        if (!s.feGone) s.feGone = {};
        s.feGone[arg] = 1;
        s.feArm = '';
        s.feDelNote = 1;
        if (b.open === arg) b.open = false;
      }
    } else if (fe === 'read') { if (!s.feRead) s.feRead = {}; s.feRead[arg] = 1; }
    else if (fe === 'readall') s.feAllRead = 1;
    else if (fe === 'more') s.feMore = 'ing';
    else if (fe === 'retain') { s.feSheet = 'retain'; s.feKeepId = arg; }
    else if (fe === 'keep') { if (!s.feKeep) s.feKeep = {}; s.feKeep[s.feKeepId] = arg; s.feSheet = ''; }
    else if (fe === 'view') s.feView = arg;
    else if (fe === 'convert') { if (!s.feConvert) s.feConvert = {}; s.feConvert[arg] = 1; }
    else if (fe === 'to-fb') { s.feCat = 'print'; window.go('feedback'); return; }
    else if (fe === 'open-act') { s.feAct = arg; window.go('activity-detail'); return; }
    else if (fe === 'claim') {
      if (!s.feClaimMap) s.feClaimMap = {};
      const id = s.feAct || 'a1';
      s.feClaimMap[id] = 'ing';
      s.feClaim = 'ing';
    } else if (fe === 'cat') s.feCat = arg;
    else if (fe === 'send') s.feSent = 1;
    else if (fe === 'extra') s.feExtra = 1;
    else if (fe === 'shut') { if (s.feShut) { s.feClosed = 1; s.feShut = 0; } else s.feShut = 1; }
    else if (fe === 'svc-clear') s.feSvc = false;
    else if (fe === 'rebind') s.feSheet = 'rebind1';
    else if (fe === 'rebind2') s.feSheet = 'rebind2';
    else if (fe === 'rebind-go') { s.feRebind = 'ing'; s.feSheet = ''; }
    else if (fe === 'switch') s.feSheet = 'switch';
    else if (fe === 'switch-go') { endUse(); window.go('login'); return; }
    else if (fe === 'wd-set') s.feSheet = 'wd-set';
    else if (fe === 'wd') s.feSheet = 'wd';
    else if (fe === 'wd-go') { s.feWithdraw = 'ing'; s.feSheet = ''; }
    else if (fe === 'consent-retry') s.feConsent = 'loading';
    else if (fe === 'noop') return;
    refresh();
  }

  function onDemo(page, ev) {
    const s = S();
    if (ev === 'empty') { s.feEmpty = true; s.feError = false; s.feLoading = false; }
    else if (ev === 'error') { s.feError = true; s.feEmpty = false; s.feLoading = false; }
    else if (ev === 'loading') { s.feLoading = true; s.feError = false; s.feEmpty = false; }
    else if (ev === 'ready') { s.feEmpty = false; s.feError = false; s.feLoading = false; s.feHandover = false; s.feMore = ''; }
    else if (ev === 'handover') { s.logged = true; s.feHandover = true; s.feError = false; s.feLoading = false; }
    else if (ev === 'pay') s.feTodo = 'pay';
    else if (ev === 'paper') s.feTodo = 'paper';
    else if (ev === 'none') s.feTodo = 'none';
    else if (ev === 'done') {
      if (page === 'activity-detail') {
        if (!s.feClaimMap) s.feClaimMap = {};
        const id = s.feAct || 'a1';
        s.feClaimMap[id] = 'ok';
        s.feClaim = 'ok';
      } else if (page === 'privacy') {
        s.feWithdraw = '';
        s.feReq = '待处理';
        s.feSheet = '';
      } else if (page === 'settings') {
        s.feRebind = 'ok';
        s.feSheet = '';
      }
    } else if (ev === 'claimfail') {
      if (!s.feClaimMap) s.feClaimMap = {};
      const id = s.feAct || 'a1';
      s.feClaimMap[id] = 'fail';
      s.feClaim = 'fail';
    } else if (ev === 'morefail') s.feMore = 'fail';
    else if (ev === 'refreshfail') s.feRefresh = 'fail';
    else if (ev === 'consent-miss') s.feConsent = 'error';
    else if (ev === 'consent-no') s.feConsent = 'not-granted';
    else if (ev === 'rebind-ok') { s.feRebind = 'ok'; s.feSheet = ''; }
    else if (ev === 'queue') s.feOrd = 'queue';
    else if (ev === 'got') s.feOrd = 'got';
    else if (ev === 'cancel') s.feOrd = 'cancel';
    else if (ev === 'svc') { s.feSvc = 1; s.feSent = 0; }
    else if (ev === 'submitfail') s.feSent = 'fail';
    else if (ev === 'delfail') s.feDelFail = 1;
    refresh();
  }

  const PHONE_NOTE = '号码与服务时间从后台读，读不到不显示。';
  const MINI_NOTE = '「手机上也能看到」这类句子在小程序发布前由开关 support.miniappPublished 收起。稿上默认画出；!feMiniapp=0 收起。收藏、浏览记录、权益不要写成手机上也能看。';
  const GATE_NOTE = '未登录画登录闸：去登录（稿上写「去登录」，运行页按钮原文是「手机号登录」）。运行页登录后带回这一页；本稿登录演示在 app.js 里固定回到 me，这里不改 app.js。出错去本屏错误态，重新加载清掉 feError。AI 不可用时列表仍在，不改去停用页。';

  const notes = {
    me: {
      does: '运行页 /profile。未登录不画二维码；已登录是六个计数、待办、足迹、消息、帮助、反馈、隐私、设置。已登录且 S().feHandover 时先问「还是你吗？」（运行页 KioskHandoverGate，离开超过 30 秒）。',
      motion: '沿用现成浮入，只动透明度和位移。确认之后整页换成本人内容，不自动跳成功。',
      keep: '计数单位一律「条」，数字来自 useMemberAssetCounts，加载中是「—」。待办只来自 getPendingTasks：待付款去 cashier，出纸中去 printing；金额从订单读，示例是 0 元。空态三条起步。错误态主按钮「重新读取」，状态句「请重新读取账号数据」。顶栏不报打印机。结束使用直接清场。问小青：「问小青：我的记录在哪里找？」。足迹、收藏、权益的运行页入口在记录页签和资产页签，稿上从这里进。' + MINI_NOTE + PHONE_NOTE,
    },
    notifications: {
      does: '运行页 /notifications 与 /me/notifications，同一组件。有消息时不画六类计数；空列表才六行「暂无」。筛选全部 / 未读。',
      motion: '已读、全部已读、删除都是本屏状态。删除两步。',
      keep: '反馈且带 relatedId 才有「查看相关反馈」去 feedback。其余消息只能已读或删除。顶栏是打印机胶囊：在线「打印机在线」，离线「打印机离线」。' + GATE_NOTE + '大约 3 分钟。' + PHONE_NOTE,
    },
    'my-resumes': {
      does: '运行页 /me/resumes。行标题是「上传诊断简历 / AI 生成简历 · 日期 · taskId 后 8 位」，不是文件名。',
      motion: '点一行展开动作。删除两步后列表少一条。',
      keep: '状态有待处理、处理中、已完成、失败；示例画了已完成和失败。优化标记「未优化 / 已生成优化版」。失败不是重新上传，原因是「这次处理未完成，没有可打开的结果」。生成简历对照禁用，并写「生成简历暂不能直接对照；请先导出，再上传诊断。」保留至来自 expiresAt，日期是示例。空态：上传 resume-src、扫描 scan-guide、生成 scratch。有数据时主按钮「去上传简历」。记录页四页签。' + GATE_NOTE + PHONE_NOTE,
    },
    'my-orders': {
      does: '运行页 /me/print-orders。只画已经产生打印任务的单。',
      motion: '筛选、展开详单、加载更多是本屏状态。刷新失败用演示事件，屏幕上不倒计时跳成功。',
      keep: '0 元且有支付状态写「0 元（免费试运营） · 免费」。无支付记录写「暂无支付信息」。实付没有独立字段时写「未记录」。缺彩色、双面不展示。不写单号后四位。取件码只在订单带回 pickupCode 时显示，示例只有进行中的这一单有 8 位到机码；没有就不画。待退款原句含现场岗位，稿改成无人值守说明。反馈只在已完成或失败，并带打印分类去 feedback。再打印按钮原文「去我的文档再打印」，去 my-docs。刷新起步 5 秒，失败加倍，最长 60 秒。顶部到店单条去 pickup，受小程序开关；未登录打的单写在空态。资产页两页签。排队中、已领取、已取消用演示事件 queue / got / cancel。' + GATE_NOTE + MINI_NOTE + PHONE_NOTE,
    },
    'my-docs': {
      does: '运行页 /me/documents。S().ctx 为 print 时是「选一份来打印」，返回 print-src。打印去 pii。',
      motion: '查看是弹层。改保存期限是选择层。删除两步。转 PDF 在未开放时变成不可用说明，不假装转好。',
      keep: '打印件「短期保存，约 24 小时」（代码常量文案是「短期保存」）。简历类「保存 3 个月」。可改成 3 个月或 6 个月。不要来源角标。PDF、JPG、PNG 可打；其它写「该文件格式暂不支持打印」。Word 未开放写「Word 转换暂未开放，请另存为 PDF 上传」。风险报告「该报告仅可查看，不可打印」。签名只在机构开通且用途在白名单的 PDF 上可点，否则「本机暂未开通」。空态原句加小程序句，受开关。闲置约 1 分 30 秒。页脚原始简历默认 90 天。' + GATE_NOTE + MINI_NOTE + PHONE_NOTE,
    },
    'my-ai': {
      does: '运行页 /me/ai-records。诊断、优化、生成、对照、规划、自我探索、小青作业、模拟面试都在本页。',
      motion: '打开去对应结果屏。模拟面试去 iv-report；列表下面「看全部模拟面试练习记录」去 iv-reports（运行页 AI 服务记录里模拟面试一类进练习记录）。删除两步。小青作业只能删。',
      keep: '打不开写原因：「正在处理，完成后可打开」或失败句。AI 正文旁写「AI 生成，仅供参考」。托管关闭不列岗位 AI 和招聘会准备单。AI 不可用时列表仍可看，不跳停用页。记录页四页签。' + GATE_NOTE + PHONE_NOTE,
    },
    'my-activity': {
      does: '运行页 /me/activity 的三页签：浏览、外部跳转、求职进度。求职进度是本人自填的记事（经产品负责人授权，compliance §4.4A），手填入口运行页还在建设：稿上默认不显示这个页签（可配开关 feJobs，地址 !feJobs=1 看样子），手填上线后再打开。详情路由全仓没有入链，这里不造按钮。',
      motion: '行整卡进入来源。托管关闭时来源是 policy-detail。',
      keep: '求职手填是「待建设」，不可点。意向中、已投递、面试中、已拿Offer、已拒绝只是图例。主按钮「查看政策」。没有记录详情，没有取消收藏。大约 3 分钟。' + GATE_NOTE + PHONE_NOTE,
    },
    'my-fav': {
      does: '运行页 /me/favorites。托管关闭时只剩政策。',
      motion: '行整卡去 policy-detail。',
      keep: '取消收藏在政策详情，不在列表，本区不改那一屏。没有官方渠道卡。主按钮「查看政策」。空就是空。' + GATE_NOTE + PHONE_NOTE,
    },
    'my-benefits': {
      does: '运行页 /me/benefits。行不可点。页签「我的权益 / 可参加的活动」。',
      motion: '三行服务是真入口：打印、AI 简历、政策。',
      keep: '类型里的套餐在本页也写「服务额度」。状态画了可用、只读补贴、已用完、已过期、已撤销。补贴行没有「看政策说明」按钮。副题不写抵扣尚未开放。托管关闭不画招聘会来源。没有权益也能走那三行。' + GATE_NOTE + PHONE_NOTE,
    },
    activities: {
      does: '运行页 /activities。列表不强制登录。没有底部三项导航。',
      motion: '未领的进 activity-detail。已领的按钮去 my-benefits，文案「查看我的权益」。已结束、已领完禁用。',
      keep: '类型写「服务额度」，不写套餐额度。额度用 quantityText，空则「一次性权益」。不写死 10 次和 12 月 31 日。未登录领取去 login；运行页会带回活动 id，稿的登录演示固定回 me。' + PHONE_NOTE,
    },
    'activity-detail': {
      does: '运行页 /activities/:id。领取调用之后留在本页。没有底部三项导航。',
      motion: '点「立即领取」只到「领取中…」。演示 done 变已领取，演示 claimfail 变失败。不自动跳我的权益。',
      keep: '第 2 步写「抵扣功能尚未开放」。规则只在示例活动自带 rulesText 时出现，空则不画。已领取后按钮「查看我的权益」。' + PHONE_NOTE,
    },
    feedback: {
      does: '运行页 /me/feedback。默认分类是打印服务。五类。没有麦克风。',
      motion: '提交变成已提交。关闭工单两步。补充回复记在本屏。服务不可用用演示 svc，提交失败用演示 submitfail，都留在本页。',
      keep: 'AI 内容投诉写 5 个工作日内答复，其它不承诺回复时限。进度有已提交、处理中、已回复、已关闭。顶栏不报打印机。' + GATE_NOTE + PHONE_NOTE,
    },
    settings: {
      does: '运行页 /me/settings。未登录副题「当前是游客」。协议不登录也能看。',
      motion: '换绑两步，确认后「正在提交」，演示 rebind-ok 才出现退出并重新登录。结束使用先确认再清场。撤回用设置页自己的确认句。',
      keep: '授权徽章只有查询中、已授权、未授权、本次未取到，无日期。重新读取只在本次未取到时可点。未授权只在 !feConsent=not-granted 或演示 consent-no。注销句用 ACCOUNT_CLOSURE_NOTE，一体机不能直接注销。验证码秒数不写死，发码是「演示：」开头的屏上键盘。顶栏不报打印机。',
    },
    privacy: {
      does: '运行页 /me/privacy-requests。导出、注销不可点。',
      motion: '撤回先确认，再「正在提交」。演示 done 才记一条「待处理」。不预造已完成。',
      keep: '页上写「不影响简历诊断、打印、收藏或已保存文件」。确认层写「撤回不会删除简历、文档、打印订单或收藏；也不等于账号注销」。不写死电话，联系方式去隐私政策。状态八种只作图例。范围说明里的现场岗位句不照贴。' + GATE_NOTE,
    },
  };

  function demo(page) {
    const base = [
      { label: '演示：列表是空的', ev: 'empty' },
      { label: '演示：读取失败', ev: 'error' },
      { label: '演示：正在读取', ev: 'loading' },
      { label: '演示：读取好了', ev: 'ready' },
    ];
    if (page === 'me') base.push(
      { label: '演示：还是你吗', ev: 'handover' },
      { label: '演示：待付款', ev: 'pay' },
      { label: '演示：出纸中', ev: 'paper' },
      { label: '演示：没有待办', ev: 'none' },
    );
    if (page === 'my-orders') base.push(
      { label: '演示：排队中', ev: 'queue' },
      { label: '演示：已领取', ev: 'got' },
      { label: '演示：已取消', ev: 'cancel' },
      { label: '演示：刷新失败', ev: 'refreshfail' },
    );
    if (page === 'activity-detail') base.push(
      { label: '演示：领取成功', ev: 'done' },
      { label: '演示：领取失败', ev: 'claimfail' },
    );
    if (page === 'privacy' || page === 'settings') base.push({ label: '演示：提交有回音', ev: 'done' });
    if (page === 'settings') base.push(
      { label: '演示：授权没取到', ev: 'consent-miss' },
      { label: '演示：明确未授权', ev: 'consent-no' },
      { label: '演示：换绑已提交', ev: 'rebind-ok' },
    );
    if (page === 'feedback') base.push(
      { label: '演示：服务不可用', ev: 'svc' },
      { label: '演示：提交失败', ev: 'submitfail' },
    );
    if (page === 'my-docs' || page === 'my-resumes' || page === 'my-ai' || page === 'notifications') {
      base.push({ label: '演示：还有下一页没载入', ev: 'morefail' }, { label: '演示：删除失败', ev: 'delfail' });
    }
    return base;
  }

  window.FE = {
    page(id) { return (pages[id] || pageMe)() + ''; },
    mount(el, page) {
      const onClick = (e) => {
        const b = e.target.closest('[data-fe]');
        if (!b || !el.contains(b) || b.disabled) return;
        e.preventDefault();
        e.stopPropagation();
        onAct(page, b.dataset.fe, b.dataset.arg || '');
      };
      const onDemoEv = (e) => onDemo(page, e.detail);
      el.addEventListener('click', onClick);
      el.addEventListener('proto-demo', onDemoEv);
      return () => {
        el.removeEventListener('click', onClick);
        el.removeEventListener('proto-demo', onDemoEv);
      };
    },
    demo,
    notes,
  };
})();
