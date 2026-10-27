/* 路由、切屏动效、演示交互、说明栏、总览 */
(function () {
  const S = window.S = { logged: false, printer: 'ok', ai: 'ok', ctx: 'resume', opt: 0, code: '', decided: [],
    iv: { role: '新媒体运营', industry: '互联网', exp: '应届生', who: 'hr', diff: 'standard', dur: 5, mode: 'voice', q: 0 },
    print: { copies: 1, color: 'bw', duplex: 'single' } };
  const byId = Object.fromEntries(SCREENS.map(s => [s.id, s]));
  const $ = (q, r = document) => r.querySelector(q);
  const app = $('#app'), stage = $('#stage'), wrap = $('#stageWrap'), vp = $('#viewport');
  let cur = null, cleanup = null; const hist = [];
  let tab = 'flows';

  /* 线上现状的实测数（2026-10-25 16:00，1080×1920，普通浏览器） */
  const LIVE_METRICS = {
    home: '可点 12 · 小于 22px 的字占 59%', resume: '可点 18 · 小于 22px 的字占 74%', interview: '可点 35（25 个小于 56px）· 一屏铺开 7 组设置',
    print: '可点 21 · 每张卡重复写状态', assistant: '可点 31 · 8 个 AI 专项 + 3 问 + 4 卡 + 输入区', policy: '可点 18 · 小于 22px 的字占 74%'
  };

  function stopMount() { if (cleanup) { try { cleanup(); } catch (e) { } cleanup = null; } }
  /* 私有化部署（b）版的屏（bOnly）一律在最上面加标识条：只在说明栏打开「显示私有化版页面」后出现，
     防止被当成我方云上的页面拿去演示或宣传。标识条由这里统一加，各屏自己不画。 */
  const B_RIBBON = '<div class="b-ribbon" role="note">私有化部署版 · 仅供持有人力资源服务许可证的客户自行运营 · 我方云上不出现 · 不得用于对外宣传</div>';
  function screenHtml(def) { return (def.bOnly ? B_RIBBON : '') + def.render(); }
  function render(id, dir = 'fwd') {
    const def = byId[id]; if (!def) return;
    stopMount();
    stage.querySelectorAll('.overlay,.toast').forEach(n => n.remove());
    const old = stage.querySelector('.screen:not(.leave)');
    const el = document.createElement('div');
    el.className = 'screen enter' + (dir === 'back' ? ' back' : '');
    el.dataset.id = id;
    el.innerHTML = screenHtml(def);
    stage.appendChild(el);
    if (old) { old.classList.remove('enter'); old.classList.add('leave'); setTimeout(() => old.remove(), 200); }
    setTimeout(() => el.classList.remove('enter', 'back'), 320);
    cur = id; tickClock(el);
    if (def.mount) cleanup = def.mount(el) || null;
    renderPanel(); updateZones(); renderDemo();
  }
  function refresh() {
    const el = stage.querySelector('.screen:not(.leave)'); if (!el) return;
    stopMount(); el.classList.add('norise'); el.innerHTML = screenHtml(byId[cur]); tickClock(el);
    if (byId[cur].mount) cleanup = byId[cur].mount(el) || null;
    renderPanel(); updateZones(); renderDemo();
  }
  /* 演示事件：屏定义里的 demo（数组，或按状态返回数组的函数）列出后台 / 硬件回报，例如手机传来文件、出纸完成。
     点了在当前屏上派发 proto-demo 事件，由那一屏的 mount 接住。屏上不画这些按钮，不演成功。 */
  function demoList(def) { const d = def && def.demo; return typeof d === 'function' ? (d() || []) : (d || []); }
  function fireDemo(ev) { const el = stage.querySelector('.screen:not(.leave)'); if (el) el.dispatchEvent(new CustomEvent('proto-demo', { detail: ev })); }
  window.protoDemo = fireDemo;
  function renderDemo() {
    const row = document.getElementById('demoRow'); if (!row) return;
    const list = demoList(byId[cur]);
    row.hidden = !list.length;
    row.innerHTML = list.map((d) => `<button class="tg" data-demo="${d.ev}">${d.label}</button>`).join('');
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('#demoRow [data-demo]'); if (b) fireDemo(b.dataset.demo); });
  /* 进登录前记住从哪来：登录成功回到那一页（运行页「登录后回到刚才那一步」）；从首页来的去「我的」。 */
  window.go = (id, o = {}) => { if (id === 'login' && cur && cur !== 'login') S.loginBack = cur; if (cur && cur !== id && !o.noHist) hist.push(cur); render(id, o.dir || 'fwd'); };
  window.afterLogin = () => { const b = S.fmLoginBack || S.loginBack; S.loginBack = null; S.fmLoginBack = null; return b && b !== 'home' && b !== 'login' ? b : 'me'; };
  function back() { const p = hist.pop(); render(p || 'home', 'back'); }

  /* 演示交互 */
  function toast(t) {
    stage.querySelectorAll('.toast').forEach(n => n.remove());
    const d = document.createElement('div'); d.className = 'toast'; d.textContent = t;
    d.style.cssText = 'position:absolute;left:50%;bottom:300px;transform:translateX(-50%);z-index:50;max-width:900px;padding:22px 34px;border-radius:999px;background:rgba(11,36,30,.92);color:#f6f3ea;font:600 25px/1.4 var(--sans);text-align:center;animation:fadein 200ms ease both';
    stage.appendChild(d); setTimeout(() => d.remove(), 2400);
  }
  window.doClear = () => { S.logged = false; S.opt = 0; S.code = ''; S.iv.q = 0; S.print = { copies: 1, color: 'bw', duplex: 'single' }; ['more', 'pii', 'legacy', 'hid', 'payMode', 'pickupState', 'directed', 'intent', 'layoutMore', 'factSheet', 'expDone', 'expFmt', 'repExported', 'aiAdjusted'].forEach((k) => { delete S[k]; }); syncToggles(); hist.length = 0; render('home'); };  /* 运行页 endKioskUse：结束人次 → 清本机数据 → 退出登录 → 回首页 */
  /* 运行页无操作到预警线时进 /session-timeout（稿屏 cleared）；那一屏自己倒计时、结束后清场回首页。 */
  function idle() { if (cur && cur !== 'cleared') S.fpFrom = cur; window.go('cleared'); }
  function xqReply(q, answer, card) {
    const chat = $('#chat', stage); if (!chat) return;
    const me = document.createElement('div'); me.className = 'bub me rise'; me.textContent = q; chat.appendChild(me);
    const xq = document.createElement('div'); xq.className = 'bub xq rise'; xq.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>'; chat.appendChild(xq);
    while (chat.children.length > 4) chat.removeChild(chat.firstChild);
    setTimeout(() => { xq.innerHTML = `<span class="ai">AI 生成 · 仅供参考</span>${answer}${card || ''}`; }, 1100);
  }
  const ANSWERS = {
    '身份证怎么复印？': ['在打印机屏幕上点「身份证复印」，按打印机上的图示放证件。复印不经过这块屏幕。', ['copy', 'idcard', '看复印步骤', '一共三步']],
    '我能领什么补贴？': ['要看你的身份和情况。我可以带你去看本机构发布的政策，每条都写了条件和材料，最后以官方原文为准。', ['policy', 'landmark', '去查政策', '按类别看']],
    '面试怎么做自我介绍？': ['一分钟左右：先说你是谁、学什么，再挑一段和岗位最相关的经历，最后说为什么想做这份工作。要不要练一次？', ['iv-1', 'mic', '练一场面试', '3 分钟起']],
    '我想打印手机里的文件': ['好的，用手机微信扫一扫屏幕上的码，就能把文件传过来。', ['print-src', 'printer', '去打印文件', '手机、U 盘都行']]
  };
  function card(c) { return `<button class="action" data-go="${c[0]}"><span class="ic">${UI.icon(c[1], 34, 2)}</span><span><b>${c[2]}</b><small>${c[3]}</small></span><span style="margin-left:auto;color:var(--teal-ink)">${UI.icon('arrowR', 32, 2.4)}</span></button>`; }

  stage.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act],[data-go]'); if (!t || !stage.contains(t)) return;
    const act = t.dataset.act, arg = t.dataset.arg, goId = t.dataset.go;
    if (goId) {
      if (goId === 'upload' || goId === 'usb') S.ctx = arg || (cur === 'print-src' ? 'print' : 'resume');
      if (goId === 'print-src') { S.ctx = 'print'; S.printDoc = null; S.pvPage = 1; }
      if (goId === 'resume-src') S.ctx = 'resume';
      if (goId === 'confirm') S.ctx = arg || (cur === 'policy-detail' ? 'policy' : cur === 'reading' || cur === 'compare' ? 'resume' : cur === 'iv-report' ? 'report' : 'print');
      if (goId === 'optimize' && arg === 'reset') { S.opt = 0; S.decided = []; }
      if (goId === 'iv-run') S.iv.q = 0;
      if (goId === 'scan-guide' && cur === 'resume-src') S.ctx = 'resume';
      /* data-set="键=值;键=值"：跳转前先改状态（例如进岗位列表前选好「校招」）。 */
      if (t.dataset.set) t.dataset.set.split(';').forEach((kv) => { const [k, v] = kv.split('='); if (k) S[k.trim()] = v === 'true' ? true : v === 'false' ? false : v; });
      window.go(goId); return;
    }
    switch (act) {
      case 'back': back(); break;
      case 'toast': toast(arg); break;
      case 'type': toast('演示：弹出系统触摸键盘，输入框会留在键盘上方'); break;
      case 'login': S.logged = true; syncToggles(); toast('已登录（示例账号）'); setTimeout(() => window.go(window.afterLogin()), 600); break;
      case 'clear': { const ov = stage.querySelector('.overlay'); if (ov && ov._t) clearInterval(ov._t); window.doClear(); break; }
      case 'idle-keep': { const ov = stage.querySelector('.overlay'); if (ov) { clearInterval(ov._t); ov.remove(); } break; }
      case 'ask': { const a = ANSWERS[arg]; xqReply(arg, a[0], card(a[1])); break; }
      case 'listen': {
        const scr = t.closest('.screen'); if (scr.classList.contains('listening')) break;
        scr.classList.add('listening'); const tr = $('#transcript', stage), lab = $('#micLabel', stage); tr.hidden = false; lab.textContent = '正在听…';
        const words = '我想打印手机里的文件'; let k = 0; tr.textContent = '';
        const iv = setInterval(() => { tr.textContent = words.slice(0, ++k); if (k >= words.length) { clearInterval(iv); setTimeout(() => { scr.classList.remove('listening'); lab.textContent = '按住说话'; tr.hidden = true; const a = ANSWERS[words]; xqReply(words, a[0], card(a[1])); }, 500); } }, 160);
        break;
      }
      case 'opt': { S.decided[S.opt] = arg === 'keep' ? '保留原文' : (D.sugg[S.opt].kind === 'choice' ? '已删掉' : '已采纳'); if (S.opt >= D.sugg.length - 1) { window.go('compare'); } else { S.opt++; window.go('optimize', { noHist: true }); } break; }
      case 'fill': { const bl = stage.querySelectorAll('[data-blank]'); bl.forEach(b => { b.textContent = S.opt === 0 ? '48' : '600'; b.classList.add('filled'); }); toast('演示：屏上数字键盘输入你的真实数字'); break; }
      case 'iv': { const [k, v] = arg.split(':'); S.iv[k] = k === 'dur' ? +v : v; refresh(); break; }
      case 'ivlisten': {
        const scr = t.closest('.screen'); if (scr.classList.contains('listening')) { scr.classList.remove('listening'); break; }
        scr.classList.add('listening'); const tx = $('#ivTx', stage); let k = 0; tx.textContent = '';
        const iv = setInterval(() => { tx.textContent = D.transcript.slice(0, ++k); if (k >= D.transcript.length) { clearInterval(iv); scr.classList.remove('listening'); } }, 90);
        break;
      }
      case 'ivnext': { if (S.iv.q >= 4) window.go('iv-report'); else { S.iv.q++; window.go('iv-run', { noHist: true }); } break; }
      case 'copies': { S.print.copies = Math.min(10, Math.max(1, S.print.copies + (+arg))); const o = $('#copies', stage); if (o) o.textContent = S.print.copies; break; }
      case 'pset': { const [k, v] = arg.split(':'); S.print[k] = v; refresh(); break; }
      case 'chip': t.setAttribute('aria-pressed', t.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); break;
      case 'seg': t.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b === t ? 'true' : 'false')); break;
      case 'key': {
        if (arg === 'clr') S.code = ''; else if (arg === 'del') S.code = S.code.slice(0, -1); else if (S.code.length < 8) S.code += arg;
        const boxes = stage.querySelectorAll('#codebox i'); boxes.forEach((b, i) => { b.textContent = S.code[i] || ''; b.classList.toggle('cur', i === S.code.length); });
        const g = $('#codeGo', stage); if (g) g.disabled = S.code.length !== 8; break;
      }
      case 'code': {
        if (S.code === '00000000') { const cb = $('#codebox', stage); cb.classList.remove('shake'); void cb.offsetWidth; cb.classList.add('shake'); $('#codeMsg', stage).innerHTML = '<span style="color:var(--cinnabar);font-weight:700">这个码不对，请核对后重输（还可以试 4 次）</span>'; S.code = ''; stage.querySelectorAll('#codebox i').forEach(b => b.textContent = ''); $('#codeGo', stage).disabled = true; }
        else window.go('pickup-ok');
        break;
      }
    }
  });
  stage.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button][data-go]')) { e.preventDefault(); e.target.click(); } });

  /* 时钟与问候 */
  function tickClock(root = stage) {
    const d = new Date(), h = d.getHours(), wk = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    root.querySelectorAll('[data-clock="t"]').forEach(n => n.textContent = `${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    root.querySelectorAll('[data-clock="d"]').forEach(n => n.textContent = `${d.getMonth() + 1}月${d.getDate()}日 周${wk}`);
    root.querySelectorAll('[data-greet]').forEach(n => n.textContent = h < 6 ? '夜深了' : h < 11 ? '上午好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好');
  }
  setInterval(() => tickClock(), 10000);

  /* 舞台缩放：舞台列宽按可用高度算，舞台贴满整列 */
  function fit() {
    if (app.classList.contains('shot')) { wrap.style.transform = 'none'; return; }
    const narrow = window.innerWidth <= 940;
    if (!narrow && !app.classList.contains('mode-wide')) {
      const h = app.clientHeight - 28;
      const w = Math.max(300, Math.floor(h * 1080 / 1920));
      if (app.style.getPropertyValue('--stage-w') !== w + 'px') app.style.setProperty('--stage-w', w + 'px');
    }
    const vw = vp.clientWidth, vh = vp.clientHeight;
    const s = Math.min(vw / 1080, vh / 1920) * 0.985;
    const x = (vw - 1080 * s) / 2, y = (vh - 1920 * s) / 2;
    wrap.style.transform = `translate(${x}px,${y}px) scale(${s})`;
    if ($('#overview').classList.contains('on')) sizeThumbs();
  }
  window.addEventListener('resize', fit);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(vp);

  /* 三区示意 */
  function updateZones() {
    stage.querySelectorAll('.zones').forEach(n => n.remove());
    if (!app.classList.contains('show-zones')) return;
    const el = stage.querySelector('.screen:not(.leave)'); if (!el) return;
    const band = el.querySelector('.band'), body = el.querySelector('.body'), dock = el.querySelector('.dock,.composer'), nav = el.querySelector('.nav');
    const z = document.createElement('div'); z.className = 'zones';
    const add = (top, h, label) => { if (h <= 0) return; const d = document.createElement('div'); d.className = 'zone'; d.style.top = top + 'px'; d.style.height = h + 'px'; d.innerHTML = `<span>${label}</span>`; z.appendChild(d); };
    const bandH = band ? band.offsetHeight : 0;
    const btmTop = dock ? dock.offsetTop : nav ? nav.offsetTop : 1920;
    add(0, bandH, '看：问题、进度、状态（不放要点的东西）');
    if (body) add(body.offsetTop, btmTop - body.offsetTop, '选：选项与内容');
    add(btmTop, 1920 - btmTop, '按：返回、问小青、主按钮（位置每屏不变）');
    stage.appendChild(z);
  }

  /* 密度读数：当前屏幕实测 */
  function measure() {
    const el = stage.querySelector('.screen:not(.leave)'); if (!el) return null;
    const vis = n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !n.closest('[hidden]'); };
    const taps = [...el.querySelectorAll('button,input,textarea,[role=button]')].filter(n => vis(n) && !n.closest('.nav'));
    const scale = wrap.getBoundingClientRect().width / 1080 || 1;
    const small = taps.filter(n => { const r = n.getBoundingClientRect(); return r.width / scale < 64 || r.height / scale < 64; }).length;
    let chars = 0, smallChars = 0, minFs = 99;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) { const tn = w.currentNode, s = tn.textContent.trim(); if (!s) continue; const p = tn.parentElement; if (!p || !vis(p) || p.closest('svg') || p.closest('[aria-hidden="true"]') || p.closest('.pframe')) continue; const fs = parseFloat(getComputedStyle(p).fontSize); chars += s.length; if (fs < 22) smallChars += s.length; minFs = Math.min(minFs, fs); }
    return { taps: taps.length, small, pct: chars ? Math.round(smallChars * 100 / chars) : 0, minFs: minFs === 99 ? '-' : Math.round(minFs) };
  }

  /* 说明栏 */
  const pbody = $('#pbody');
  const SRC = { cx: ['cx', 'Codex'], ag: ['ag', 'agy'], gk: ['gk', 'Grok'], cl: ['cl', 'Claude'] };
  const thumbCache = {};
  function flowOf(id) { return (window.FLOWS || []).find(f => f.ids.includes(id) && f.ids[0] !== id) || (window.FLOWS || []).find(f => f.ids.includes(id)); }
  function stripHtml(flow) {
    const key = flow.n + '|' + S.logged + S.printer + S.ai;
    if (!thumbCache[key]) thumbCache[key] = flow.ids.map(id => byId[id] ? `<div class="sitem" role="button" tabindex="0" data-open="${id}"><div class="th"><div class="stage static"><div class="screen">${screenHtml(byId[id])}</div></div></div><span>${byId[id].name}</span></div>` : '').join('<span class="arr">→</span>');
    return thumbCache[key];
  }
  function renderPanel() {
    if (tab === 'flows') {
      const def = byId[cur] || {}; const n = def.notes || {}; const flow = flowOf(cur);
      let h = `<h2>${def.name || ''} <span style="font-weight:400;font-size:13px;color:#7f938b">· ${def.group || ''}</span></h2><div class="meter" id="meter"></div>`;
      h += `<div class="note-grid">${n.does ? `<div class="note-card"><div class="k">这一屏只做一件事</div><div class="v">${n.does}</div></div>` : ''}${n.motion ? `<div class="note-card"><div class="k">动效</div><div class="v">${n.motion}</div></div>` : ''}${n.keep ? `<div class="note-card"><div class="k">必须保留</div><div class="v">${n.keep}</div></div>` : ''}</div>`;
      if (flow) h += `<h3>它在「${flow.n}」这条路上（点缩略图跳过去）</h3><div class="strip" id="strip">${stripHtml(flow).replace(`data-open="${cur}"`, `data-open="${cur}" aria-current="true"`)}</div>`;
      if (def.before && window.LIVE_SHOTS && LIVE_SHOTS[def.before]) h += `<h3>对照：现在线上的这一页</h3><div class="cmp2"><img src="${LIVE_SHOTS[def.before]}" alt="线上现状截图"><div class="t"><p class="big">现在：${LIVE_METRICS[def.before] || ''}</p><p class="big" id="nowNew"></p><p>线上截图取自 zyidai.cn，1080×1920，10 月 25 日 16:00；普通浏览器不是登记过的终端，所以打印页显示「状态无法确认」。</p></div></div>`;
      pbody.innerHTML = h;
      const st = $('#strip'); if (st) { const c = st.querySelector('[aria-current="true"]'); if (c) st.scrollLeft = Math.max(0, c.offsetLeft - 120); }
      requestAnimationFrame(() => { const m = measure(), box = $('#meter'); if (m && box) { box.innerHTML = `<span>可点 ${m.taps}</span><span>小于 64px 的可点 ${m.small}</span><span>最小字 ${m.minFs}px</span><span>小于 22px 的字 ${m.pct}%</span>`; const nn = $('#nowNew'); if (nn) nn.textContent = `新版：可点 ${m.taps} · 小于 22px 的字占 ${m.pct}%`; } });
    } else if (tab === 'all') {
      let h = `<h2>全部页面（${SCREENS.length} 屏）</h2><p>按业务分组。点名字直接打开那一屏；要一次看全部，用下面的「全部页面总览」。</p>`; let k = 0;
      SCREEN_GROUPS.forEach(g => { const list = SCREENS.filter(s => s.group === g && (!s.bOnly || S.showB)); if (!list.length) return; h += `<div class="flow-group">${g}（${list.length}）</div><div class="flow-list">` + list.map(s => `<button data-open="${s.id}" ${s.id === cur ? 'aria-current="true"' : ''}><span class="n">${String(++k).padStart(2, '0')}</span>${s.name}</button>`).join('') + '</div>'; });
      pbody.innerHTML = h;
    } else if (tab === 'goals') {
      pbody.innerHTML = `<p>按「一个人走到机器前想办成的事」排，不按页面排。依据：Codex 读 main 代码梳理的办理路径，Claude 抽查属实。点页面名直接跳过去。</p><div class="gap-list">` + GOALS.map(g => `<div class="note-card"><h3 style="margin:0 0 6px">${g.t}</h3><dl class="kv"><dt>谁会来</dt><dd>${g.who}</dd><dt>带走</dt><dd>${g.take}</dd><dt>离不开机器</dt><dd>${g.kiosk}</dd><dt>手机上</dt><dd>${g.phone}</dd></dl><div class="goal"><div class="path">路径：${g.path.map(p => byId[p] ? `<button data-open="${p}">${byId[p].name}</button>` : p).join(' → ')}</div></div></div>`).join('') + '</div>';
    } else if (tab === 'gaps') {
      pbody.innerHTML = `<p>你可能没考虑到的点，四家合起来的结果。标签是谁提的：<span class="tag cx">Codex</span>读代码、<span class="tag ag">agy</span>反方、<span class="tag gk">Grok</span>查资料、<span class="tag cl">Claude</span>实测线上。</p><div class="gap-list">` + GAPS.map((g, i) => `<div class="note-card"><div class="k">${i + 1} · ${g.src.map(s => `<span class="tag ${SRC[s][0]}">${SRC[s][1]}</span>`).join('')}</div><div class="v"><b>${g.t}</b></div><p>${g.d}</p><p style="margin:0">原型里看：${g.how}</p></div>`).join('') + '</div>';
    } else {
      pbody.innerHTML = RULES;
    }
  }
  const keyOpen = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button][data-open]')) { e.preventDefault(); e.target.click(); } };
  pbody.addEventListener('keydown', keyOpen); $('#ovGrid').addEventListener('keydown', keyOpen);
  pbody.addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (!b) return; closeOverview(); window.go(b.dataset.open); });
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false')); renderPanel(); pbody.scrollTop = 0; }));

  const RULES = `
    <h2>四条原则</h2>
    <div class="note-card"><div class="v"><b>1. 一屏一问。</b>每屏只问一个问题，给 2–4 个大选项和 1 个主按钮。现在的简历中心一屏 18 个可点、面试设置 35 个。</div></div>
    <div class="note-card"><div class="v"><b>2. 上看、中选、下按。</b>顶部深绿意图带只放问题、进度、状态和二维码（手机摄像头正好够得着）；中间放选项；底部放返回、问小青、主按钮，每屏位置不变。深圳地方标准：手触操作高度宜 105–150 cm。</div></div>
    <div class="note-card"><div class="v"><b>3. 空间给交付物，不给空盒子。</b>卡片按内容定高；多出来的地方放「带走什么」的实物小样（简历、报告、打印件），不撑空卡、不加说明。一屏只留一句边界声明，放在底部。</div></div>
    <div class="note-card"><div class="v"><b>4. 只有在干活的东西才动。</b>按下立刻有回应；读简历、等手机、出纸这种真在进行的事才有持续动画；其余都静止。可以一键减弱动效。</div></div>
    <h2>数字口径</h2>
    <dl class="kv"><dt>页面问题</dt><dd>宋体 44–48px（首页问候 60px，一屏只有一句）</dd><dt>选项标题</dt><dd>30–40px</dd><dt>正文</dt><dd>24px</dd><dt>辅助</dt><dd>20–22px，全站不小于 20px（备案号 18px）</dd><dt>可点区域</dt><dd>不小于 64×64px（约 20mm）；主按钮高 88px</dd><dt>每屏</dt><dd>可点不超过 7 个（不含底部导航）；说明最多 2 段、每段不超过 2 行</dd></dl>
    <p>字阶守 2.0 的口径（正文 22–24、卡片标题 28–30），只把「一屏一句」的问题放大，靠减少数量而不是放大字号来降密度。</p>
    <h2>动效时长</h2>
    <dl class="kv"><dt>按下</dt><dd>120ms 缩小 2–3%</dd><dt>进入下一屏</dt><dd>280ms 淡入 + 上移 16px</dd><dt>离开</dt><dd>160ms 淡出</dd><dt>返回上一屏</dt><dd>只淡入，不位移</dd><dt>内容浮入</dt><dd>每项晚 45ms</dd><dt>出纸</dt><dd>每张 760ms，跟打印机回报的张数走</dd><dt>待机轮播</dt><dd>6 秒一张，触摸立即停</dd><dt>闪烁</dt><dd>低于每秒 1 次（标准上限每秒 3 次）</dd></dl>
    <p>只动 transform 和 opacity；不用整屏模糊、粒子、视频背景、3D 翻转。低配 Windows 主机上也能稳在 60 帧。</p>
    <h3>依据</h3>
    <ul><li>深圳 DB4403/T 503.4—2024《政务服务自助服务终端一体化技术规范 第 4 部分：用户体验设计》：一页一种骨架、写明当前环节和剩余环节、硬件环节用引导动画、不刊登商业广告、手触高度 105–150 cm、办完不保留隐私。<b>Claude 已对原文核实。</b></li>
    <li>Nielsen 响应时间三个界限：0.1 秒、1 秒、10 秒（Grok 检索）。</li>
    <li>WCAG 2.2：2.2.2 超过 5 秒的动画要能暂停；2.3.1 每秒闪烁不超过 3 次；2.5.5 目标 44×44（Grok 检索）。</li>
    <li>Material 3 / 微软 WinUI 动效时长：进入 250–300ms、退出 150–200ms（Grok 检索）。</li></ul>
    <h3>这次没有采用的建议</h3>
    <ul><li>agy：「输入家人手机号提取材料」——会变成新功能，还涉及隐私，不做。</li>
    <li>agy：顶部常驻防窥开关——顶部够不着；改成打码默认开，点一下显示几秒。</li>
    <li>agy：扫描后强制等 8 秒才能点下一步——太打扰；改成醒目提醒。</li>
    <li>Codex 原型：异常页写「找工作人员」、往只读原稿里各注入一行脚本——前者违反无人值守，后者违反原稿只读，都不沿用。</li></ul>`;

  /* 总览 */
  const ov = $('#overview'), grid = $('#ovGrid');
  function buildOverview() {
    grid.innerHTML = '';
    SCREENS.filter(s => !s.bOnly || S.showB).forEach((s, i) => {
      const item = document.createElement('div'); item.className = 'ov-item'; item.dataset.open = s.id; item.setAttribute('role', 'button'); item.tabIndex = 0;
      item.innerHTML = `<div class="ov-thumb"><div class="stage static"><div class="screen">${screenHtml(s)}</div></div></div><span>${String(i + 1).padStart(2, '0')} · ${s.group} · ${s.name}</span>`;
      grid.appendChild(item);
    });
    tickClock(grid); sizeThumbs();
  }
  function sizeThumbs() { grid.querySelectorAll('.ov-thumb').forEach(t => { const st = t.firstElementChild; st.style.transform = `scale(${t.clientWidth / 1080})`; }); }
  grid.addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (!b) return; closeOverview(); window.go(b.dataset.open); });
  function closeOverview() { ov.classList.remove('on'); const mt = $('#maptable'); if (mt) mt.classList.remove('on'); app.classList.remove('mode-wide'); wrap.style.visibility = ''; $('#tg-overview').setAttribute('aria-pressed', 'false'); const m = $('#tg-map'); if (m) m.setAttribute('aria-pressed', 'false'); fit(); }

  /* 开关 */
  function syncToggles() {
    $('#tg-login').setAttribute('aria-pressed', S.logged); $('#tg-printer').setAttribute('aria-pressed', S.printer === 'down'); $('#tg-ai').setAttribute('aria-pressed', S.ai === 'down');
    const f = $('#tg-fee'); if (f) f.setAttribute('aria-pressed', !!S.fee);
    const c = $('#tg-ctrl'); if (c) c.setAttribute('aria-pressed', !!S.controlsOn);
    const bb = $('#tg-showb'); if (bb) bb.setAttribute('aria-pressed', !!S.showB);
  }
  const tg = (id, fn) => $(id).addEventListener('click', fn);
  tg('#tg-overview', () => { const on = !ov.classList.contains('on'); closeOverview(); if (!on) return; ov.classList.add('on'); app.classList.add('mode-wide'); wrap.style.visibility = 'hidden'; $('#tg-overview').setAttribute('aria-pressed', 'true'); buildOverview(); fit(); });
  tg('#tg-map', () => { const mt = $('#maptable'); const on = !mt.classList.contains('on'); closeOverview(); if (!on) return; mt.classList.add('on'); app.classList.add('mode-wide'); wrap.style.visibility = 'hidden'; $('#tg-map').setAttribute('aria-pressed', 'true'); if (window.renderMap) window.renderMap(mt); fit(); });
  tg('#tg-reduced', () => { const on = app.classList.toggle('reduced'); $('#tg-reduced').setAttribute('aria-pressed', on); });
  tg('#tg-zones', () => { const on = app.classList.toggle('show-zones'); $('#tg-zones').setAttribute('aria-pressed', on); updateZones(); });
  tg('#tg-hit', () => { const on = app.classList.toggle('show-hit'); $('#tg-hit').setAttribute('aria-pressed', on); });
  tg('#tg-login', () => { S.logged = !S.logged; syncToggles(); for (const k in thumbCache) delete thumbCache[k]; refresh(); });
  tg('#tg-printer', () => { S.printer = S.printer === 'down' ? 'ok' : 'down'; syncToggles(); refresh(); });
  tg('#tg-ai', () => { S.ai = S.ai === 'down' ? 'ok' : 'down'; syncToggles(); refresh(); });
  tg('#tg-fee', () => { S.fee = !S.fee; syncToggles(); refresh(); });
  tg('#tg-ctrl', () => { S.controlsOn = !S.controlsOn; syncToggles(); refresh(); });
  tg('#tg-showb', () => { S.showB = !S.showB; syncToggles(); refresh(); });
  tg('#tg-idle', () => { closeOverview(); idle(); });

  /* 启动：地址里带页面编号（如 #optimize）就直接打开那一屏 */
  const start = (location.hash || '').slice(1);
  const params = new URLSearchParams(location.search);
  if (params.get('reduced') === '1') app.classList.add('reduced');
  if (params.get('shot') === '1') { app.classList.add('shot'); document.body.style.padding = '0'; }
  if (params.get('login') === '1') S.logged = true;
  if (params.get('printer') === 'down') S.printer = 'down';
  if (params.get('ai') === 'down') S.ai = 'down';
  if (params.get('fee') === '1') S.fee = true;
  if (params.get('ctrl') === '1') S.controlsOn = true;
  if (params.get('b') === '1') S.showB = true;
  syncToggles();
  if (!window.renderMap) $('#tg-map').hidden = true;
  fit();
  render(byId[start] ? start : 'home');
  if (params.get('demo')) setTimeout(() => fireDemo(params.get('demo')), 500);
  if (params.get('overview') === '1') $('#tg-overview').click();
  if (params.get('map') === '1' && window.renderMap) $('#tg-map').click();
  window.__proto = { render, S, measure, refresh, idle, byId };
})();
