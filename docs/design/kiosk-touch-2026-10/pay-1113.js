/* pay-1113.js：收费显示与付款（2026-11-13 补稿，只画稿）
 * 1.00 元是演示数字，不是定价；真实价格每台机器在管理员后台设，不进仓库。
 *
 * 只在「收费点位」开着、且不是「公共就业点位」时，往现有屏上加字。
 * 两个开关都关（或只开公共就业点位）时，被包住的屏原样返回，一个字都不改。
 * 新容器默认 display:none，要显示时再加 .on。
 *
 * 复用（不改原样式）：
 *   收银台骨架 screens2.js:315-340（.d3-cashier / .d3-qrframe / .sumcard）
 *   二维码 ui.js:180 UI.qr
 *   手机接着办 fix-flow-1111.js:713-754（意图带右侧二维码 + 三步 path）
 *   按钮 .btn（index.html:332，高 88px）
 * 打印收银台本身不重画。到机取件未付款仍去 cashier。
 */
(function () {
  'use strict';

  const S = () => window.S || {};
  const charge = () => !!S().fee;
  const paid = (k) => !!(S().pyPaid && S().pyPaid[k]);
  const find = (id) => (window.SCREENS || []).find((s) => s.id === id);
  const YUAN = '1.00 元';

  /* 公共就业点位开着时，让已有稿里所有 S.fee 判断都看成没收费。
     不改 app.js 里「收费点位」那个开关的处理函数。 */
  let feeWanted = false;
  function mask(obj) {
    if (!obj || obj.__pyMask) return;
    feeWanted = !!obj.fee;
    try { delete obj.fee; } catch (e) { /* 还没有这个字段 */ }
    Object.defineProperty(obj, 'fee', {
      configurable: true,
      enumerable: false,
      get() { return !!(feeWanted && !obj.publicSite); },
      set(v) { feeWanted = !!v; }
    });
    Object.defineProperty(obj, 'feeWanted', {
      configurable: true,
      enumerable: false,
      get() { return feeWanted; },
      set(v) { feeWanted = !!v; }
    });
    Object.defineProperty(obj, '__pyMask', { value: true, enumerable: false });
    if (new URLSearchParams(location.search).get('public') === '1') obj.publicSite = true;
  }
  try {
    Object.defineProperty(window, 'S', {
      configurable: true,
      get() { return window.__pyS || null; },
      set(v) { window.__pyS = v; mask(v); }
    });
  } catch (e) { /* 已经有 S 时补戴上面具 */ if (window.S) mask(window.S); }

  const css = document.createElement('style');
  css.textContent = `
.py-home,.py-bar,.py-refund,.py-done,.py-bill,.py-qrb,.py-fields{display:none}
.py-home.on{display:block;margin-top:2px;font:800 22px/1.25 var(--sans);color:var(--teal-ink)}
.task.dark .py-home.on{color:var(--glow)}
.d3-home .task:has(.py-home){min-height:300px;gap:8px;padding:22px 26px 16px}
.d3-home .task:has(.py-home) h3{margin-top:0;font-size:36px}
.d3-home .task:has(.py-home) p{font-size:21px;line-height:1.35}
.py-bar.on,.py-refund.on{display:flex;flex-direction:column;gap:2px;margin:0 40px 6px;padding:8px 18px;border-radius:20px;background:var(--card);border:1.5px solid var(--edge)}
.py-bar.on b,.py-refund.on b{font:800 26px/1.25 var(--sans);color:var(--deep)}
.py-bar.on span,.py-refund.on span{font-size:20px;line-height:1.35;color:var(--ink-2)}
.py-refund.on{background:#fff6df;border-color:#e6d3a1}
.py-buy{height:64px;min-height:64px;width:100%;margin-top:6px}
.screen:has(.py-bar) > main.body.tight,.screen:has(.py-refund) > main.body.tight{gap:8px;padding-top:12px;padding-bottom:8px}
.screen:has(.st3-aidown) > .py-bar.on{margin:0 28px 4px;padding:6px 14px}
.screen:has(.st3-aidown) .py-buy{height:56px;min-height:56px;margin-top:4px}
.screen:has(.py-bar) > main.body.st3-aidown{gap:4px;padding:4px 40px 2px}
.screen:has(.py-bar) .st3-aidown .howto{padding:6px 12px}
.screen:has(.py-bar) .st3-aidown .d4-exgroup{gap:4px}
.screen:has(.py-bar) .st3-aidown .d4-exgroup .slab.row{padding:4px 10px;gap:10px}
.screen:has(.py-bar) .st3-aidown .d4-exgroup .slab.row .vis{min-height:60px;width:72px}
.screen:has(.py-bar) .st3-aidown .d4-exgroup .slab.row h3{font-size:28px;line-height:1.2}
.screen:has(.py-bar) .st3-aidown .d4-exgroup .slab.row p{font-size:20px;line-height:1.3}
.screen:has(.py-bar) .st3-aidown .olist{padding:8px 12px;gap:2px}
.screen:has(.py-bar) .st3-aidown .st3-check{min-height:40px;font-size:20px;line-height:1.3}
.screen:has(.py-bar) .st3-aidown .st3-check i{width:32px;height:32px;font-size:20px}
.py-done.on{flex:1;display:flex;flex-direction:column;gap:14px;min-height:0}
.py-step{flex:1;display:flex;gap:16px;align-items:center;min-height:88px;padding:16px 22px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge)}
.py-step i{flex:none;width:56px;height:56px;border-radius:18px;background:var(--deep);color:var(--cream);display:grid;place-items:center;font:800 26px/1 var(--sans)}
.py-step b{display:block;font-size:28px;line-height:1.3;color:var(--ink)}
.py-step span{display:block;margin-top:2px;font-size:22px;line-height:1.4;color:var(--ink-2)}
.py-pay .d3-qrframe{flex:1}
.py-bill.on{display:flex;flex-direction:column;gap:6px;padding:12px 16px}
.py-bill.on .py-invbtn{height:64px;min-height:64px;min-width:180px;align-self:flex-start}
.py-qrb.on{display:flex;align-items:center;justify-content:center}
.py-invbody{justify-content:flex-start;gap:16px}
.py-fields.on{flex:1;display:flex;flex-direction:column;gap:14px;min-height:0}
.py-fields.on div{flex:1;display:flex;flex-direction:column;justify-content:center;gap:6px;min-height:112px;padding:18px 24px;border-radius:24px;background:var(--card);border:1.5px solid var(--edge)}
.py-fields.on b{font-size:30px;line-height:1.3}
.py-fields.on span{font-size:24px;line-height:1.4;color:var(--ink-2)}
`;
  document.head.appendChild(css);

  function cents(key) {
    const z = S().pyZero || {};
    return z[key] ? 0 : 100;
  }
  function money(c) { return (c / 100).toFixed(2) + ' 元'; }
  function homeLine(key, prefix) {
    const c = cents(key);
    return c ? prefix + money(c) : '免费';
  }
  function priceSpan(text) { return `<span class="py-home on">${text}</span>`; }
  function bar(title, desc, extra) {
    return `<div class="py-bar on"><b>${title}</b><span>${desc}</span>${extra || ''}</div>`;
  }
  const REFUND = '<div class="py-refund on" role="status"><b>这次没做成，付的钱会自动退回原付款账户</b><span>这一次已经付过。钱退回原来的付款账户。</span></div>';
  function beforeDock(h, html) {
    const i = h.lastIndexOf('<footer class="dock">');
    if (i >= 0) return h.slice(0, i) + html + h.slice(i);
    const j = h.lastIndexOf('</main>');
    if (j < 0) return h;
    return h.slice(0, j) + html + h.slice(j);
  }
  function retarget(h, label, extra) {
    const i = h.indexOf('>' + label);
    if (i < 0) return null;
    const start = h.lastIndexOf('<button', i);
    if (start < 0) return null;
    let open = h.slice(start, i).replace(/\sdata-go="[^"]*"/g, '').replace(/\sdata-act="[^"]*"/g, '').replace(/\sdata-arg="[^"]*"/g, '');
    open = open.replace(/\s+$/, '') + ' ' + extra;
    return h.slice(0, start) + open + h.slice(i);
  }
  function wrapRender(id, fn) {
    const d = find(id); if (!d) return;
    const r0 = d.render;
    d.render = () => { const h = r0(); return charge() ? fn(h) : h; };
  }
  function wrapMount(id, fn) {
    const d = find(id); if (!d) return;
    const m0 = d.mount;
    d.mount = (el) => {
      const c0 = m0 ? m0(el) : null;
      const c1 = charge() ? fn(el) : null;
      return () => { if (c1) c1(); if (c0) c0(); };
    };
  }
  function addDemo(id, extra) {
    const d = find(id); if (!d) return;
    const d0 = d.demo;
    d.demo = () => {
      const base = typeof d0 === 'function' ? (d0() || []) : (d0 || []);
      if (!charge()) return base;
      const more = typeof extra === 'function' ? extra() : extra;
      return (more || []).concat(base);
    };
  }

  const NAME = { resume: 'AI 简历优化', interview: 'AI 模拟面试', scan: '扫描' };
  function whatName() { return NAME[S().pyWhat] || NAME.resume; }

  function beginPay(what, back, next, after) {
    const s = S();
    s.pyWhat = what;
    s.pyBack = back;
    s.pyNext = next;
    s.pyAfter = after;
    s.pyState = 'wait';
    s.pyCheck = 0;
    window.go('pay-service');
  }
  function arrive() {
    const s = S();
    const what = s.pyWhat || 'resume';
    const after = s.pyAfter || '';
    if (!s.pyPaid) s.pyPaid = {};
    s.pyPaid[what === 'interview' ? 'interview' : what === 'scan' ? 'scan' : 'resume'] = true;
    if (after === 'start-scan') {
      s.fsGuide = 'ack';
      s.fsRescan = false;
      s.fsLeft = 600;
      s.fsPreview = false;
      delete s.fsResult;
      delete s.fsWait;
      window.go(s.pyNext || 'scan-guide');
      return;
    }
    if (after === 'start-interview') {
      s.fiCreating = 1;
      s.fiStartFail = 0;
      s.fiConsent = '';
      s.fiErr = '';
      window.go('iv-3');
      return;
    }
    if (after === 'retry-fit') { s.b2v = 'loading'; s.b2vOwner = 'jobfit'; window.go('jobfit'); return; }
    if (after === 'retry-compare') { s.b2v = 'regen'; s.b2vOwner = 'compare'; window.go('compare'); return; }
    if (after === 'retry-diagnose') { delete s.b2v; delete s.b2vOwner; window.go('reading'); return; }
    window.go(s.pyNext || 'home');
  }

  /* ── 1 首页短价 ── */
  wrapRender('home', (h) => {
    let n = h;
    n = n.replace('<h3>改简历</h3>', '<h3>改简历</h3>' + priceSpan(homeLine('resume', '每次 ')));
    n = n.replace('<h3>练面试</h3>', '<h3>练面试</h3>' + priceSpan(homeLine('interview', '每次 ')));
    n = n.replace('<h3>打印 · 扫描</h3>', '<h3>打印 · 扫描</h3>' + priceSpan('打印 ' + homeLine('print', '黑白每页 ')) + priceSpan('扫描 ' + homeLine('scan', '每次 ')));
    const foot = '离开 3 分钟无操作自动退出登录';
    if (n.indexOf(foot) >= 0 && n.indexOf('收费以现场公示为准') < 0) n = n.replace(foot, foot + ' · 收费以现场公示为准');
    return n;
  });
  addDemo('home', [
    { label: '演示：扫描这一项是免费', ev: 'py-zero-scan' },
    { label: '演示：四项都按 1.00 元', ev: 'py-zero-off' }
  ]);
  wrapMount('home', (el) => {
    const on = (e) => {
      if (e.detail === 'py-zero-scan') S().pyZero = { scan: 1 };
      else if (e.detail === 'py-zero-off') S().pyZero = {};
      else return;
      window.__proto.refresh();
    };
    el.addEventListener('proto-demo', on);
    return () => el.removeEventListener('proto-demo', on);
  });

  /* ── 2 改简历：诊断报告上的「查看优化建议」是开始改之前那一步 ── */
  wrapRender('diagnosis', (h) => {
    if (paid('resume')) return h;
    const n = retarget(h, '查看优化建议（4 条）', 'data-go="pay-service" data-set="pyWhat=resume;pyBack=diagnosis;pyNext=optimize;pyAfter=start-resume;pyState=wait"');
    if (!n) return h;
    return beforeDock(n.replace('>查看优化建议（4 条）', '>付 ' + YUAN + '并开始'), bar('这一次 ' + YUAN, 'AI 简历优化。付好了才开始改。没生成出来，钱会退回原付款账户。'));
  });

  /* ── 3 练面试：核对开始屏。年龄确认仍先问，问完再付款，避免未满 14 周岁先扣钱。 ── */
  wrapRender('iv-3', (h) => {
    const s = S();
    if (s.fiStartFail && paid('interview')) return beforeDock(h, REFUND);
    if (s.ai === 'down' || s.fiCreating || paid('interview')) return h;
    if (h.indexOf('>创建并开始练习') < 0) return h;
    return beforeDock(h.replace('>创建并开始练习', '>付 ' + YUAN + '开始练'), bar('这一次 ' + YUAN, 'AI 模拟面试。先确认年满 14 周岁，再付款。付好了才开始练。没练成，钱会退回原付款账户。'));
  });
  wrapMount('iv-3', (el) => {
    const on = (e) => {
      if (!charge() || paid('interview') || S().ai === 'down') return;
      const yes = e.target.closest('[data-fi="age-yes"]');
      if (yes && el.contains(yes)) {
        e.preventDefault();
        e.stopPropagation();
        S().fiAgeOk = 1;
        S().fiConsent = '';
        beginPay('interview', 'iv-3', 'iv-3', 'start-interview');
        return;
      }
      const b = e.target.closest('#fiStart');
      if (!b || !el.contains(b) || b.disabled || !S().fiAgeOk) return;
      e.preventDefault();
      e.stopPropagation();
      beginPay('interview', 'iv-3', 'iv-3', 'start-interview');
    };
    el.addEventListener('click', on, true);
    return () => el.removeEventListener('click', on, true);
  });

  /* ── 4 扫描开始前：选类型屏的主按钮。结果页那句「本页不给价格」只在收费时改成明码。 ── */
  wrapRender('scan-type', (h) => {
    if (paid('scan')) return h;
    const n = retarget(h, '下一步 · 建立这次扫描', 'data-go="pay-service" data-set="pyWhat=scan;pyBack=scan-type;pyNext=scan-guide;pyAfter=start-scan;pyState=wait"');
    if (!n) return h;
    return beforeDock(n.replace('>下一步 · 建立这次扫描', '>付 ' + YUAN + '开始扫描'), bar('这一次 ' + YUAN, '扫描。付好了才建立这次扫描。没扫成，钱会退回原付款账户。打印另按页计价。'));
  });
  wrapRender('scan-result', (h) => {
    const kind = S().fsResult;
    const fail = kind === 'timeout' || kind === 'incomplete' || kind === 'nofile';
    if (fail) return paid('scan') ? beforeDock(h, REFUND) : h;
    const sentence = '先检查文件和个人信息。金额由系统报价，本页不给价格。';
    if (h.indexOf(sentence) < 0) return h;
    const yuan = '<span style="white-space:nowrap">' + YUAN + '</span>';
    const next = paid('scan')
      ? '先检查文件和个人信息。打印另按页计价，到核对价格再看。扫描这一次已经付过 ' + yuan + '。'
      : '先检查文件和个人信息。扫描这一次 ' + yuan + '。打印另按页计价，到核对价格再看。';
    return h.replace(sentence, next);
  });

  /* ── 6 次数用完：多一个「付 1.00 元再用一次」 ── */
  function withBuy(h, set, backName) {
    if (h.indexOf('明天 0 点恢复') < 0 && h.indexOf('明天恢复') < 0) return h;
    if (h.indexOf('付 ' + YUAN + '再用一次') >= 0) return h;
    const btn = `<button class="btn pri py-buy" type="button" data-go="pay-service" data-set="${set}">付 ${YUAN}再用一次</button>`;
    return beforeDock(h, bar('再用一次 ' + YUAN, '今天的次数用完了。再付 ' + YUAN + '，可以用一次' + backName + '。只卖这一次。', btn));
  }
  wrapRender('jobfit', (h) => withBuy(h, 'pyWhat=resume;pyBack=jobfit;pyNext=jobfit;pyAfter=retry-fit;pyState=wait', '对照'));
  wrapRender('compare', (h) => withBuy(h, 'pyWhat=resume;pyBack=compare;pyNext=compare;pyAfter=retry-compare;pyState=wait', '换写法'));
  wrapRender('st-ai-down', (h) => {
    if (h.indexOf('明天 0 点恢复') < 0 && h.indexOf('明天恢复') < 0) return h;
    const set = 'pyWhat=resume;pyBack=st-ai-down;pyNext=reading;pyAfter=retry-diagnose;pyState=wait';
    const btn = `<button class="btn pri py-buy" type="button" data-go="pay-service" data-set="${set}">付 ${YUAN}再用一次</button>`;
    const lead = paid('resume')
      ? '<b>这次没做成，付的钱会自动退回原付款账户</b><span>这一次已经付过。钱退回原来的付款账户。再用一次 ' + YUAN + '，可以用一次诊断。只卖这一次。</span>'
      : '<b>再用一次 ' + YUAN + '</b><span>今天的次数用完了。再付 ' + YUAN + '，可以用一次诊断。只卖这一次。</span>';
    return beforeDock(h, `<div class="py-bar on">${lead}${btn}</div>`);
  });

  /* ── 7 到机取件：未付款先说明，再进现有收银台 ── */
  wrapRender('pickup-ok', (h) => {
    const st = S().pickupState || 'unpaid';
    if (st !== 'unpaid') return h;
    if (h.indexOf('进入现场支付') < 0) return h;
    return beforeDock(h, bar('这台机器打印收费，本单 2.00 元，付完就出纸', '下一步进收银台。付好了才开始打印。没出纸，钱会退回原付款账户。'));
  });

  /* ── 8 没做成就退 ── */
  wrapRender('st-unconfirmed', (h) => (paid('print') ? beforeDock(h, REFUND) : h));
  wrapRender('resume-preview', (h) => (S().b2v === 'error' && paid('resume') && h.indexOf('成品没排出来') >= 0 ? beforeDock(h, REFUND) : h));
  wrapRender('iv-run', (h) => (paid('interview') && (S().fiRunErr || '').indexOf('报告生成失败') >= 0 ? beforeDock(h, REFUND) : h));

  /* ── 9 订单：开发票、已退款、发票已开 ── */
  function invoiceHtml() {
    const qr = `<div class="py-qrb on">${window.UI.qr(21, 220)}</div>`;
    return window.UI.band({
      kind: 'std',
      back: true,
      eyebrow: '我的 · 订单',
      title: '用手机扫码填写开票信息',
      sub: '这一单 ' + YUAN + '。开好后，电子发票发到你填的邮箱。',
      sealHtml: qr,
      status: { text: '等手机填写' },
      path: ['手机扫码', '填写开票信息', '发票发到邮箱'],
      pathLabel: '三步'
    }) + `<main class="body py-invbody"><div class="py-fields on">
        <div><b>抬头</b><span>个人写姓名，单位写单位名称。</span></div>
        <div><b>税号</b><span>单位才要填。个人不用填税号。</span></div>
        <div><b>接收邮箱</b><span>电子发票发到这个邮箱。这台屏幕不保存税号。</span></div>
      </div><p class="fine">在手机上填写并提交。没付成或已退款的单，开不了发票。</p></main>`
      + window.UI.dock({
        back: false,
        left: `<button class="btn sec" type="button" data-py="inv-close">${window.UI.icon('chevL', 30, 2.4)}返回订单</button>`,
        ask: '问小青：发票发到哪',
        pri: { label: '填好了，返回订单', id: 'pyInvDone' }
      }) + window.UI.nav('me');
  }
  wrapRender('my-orders', (h) => {
    if (S().pyInv) return invoiceHtml();
    const i = h.indexOf('<div class="fe-rows');
    if (i < 0) return h;
    const j = h.indexOf('>', i);
    const rows = `<div class="fe-line py-bill on"><b>AI 简历优化</b><small>已付款 · ${YUAN}</small><button class="btn pri py-invbtn" type="button" data-py="inv">开发票</button></div>`
      + `<div class="fe-line py-bill on"><b>扫描</b><small>已退款 · ${YUAN} · 钱会退回原付款账户</small></div>`
      + `<div class="fe-line py-bill on"><b>练面试</b><small>发票已开 · ${YUAN} · 电子发票已发到邮箱</small></div>`;
    return h.slice(0, i) + '<div class="fe-rows is-scroll' + h.slice(i + '<div class="fe-rows'.length, j + 1) + rows + h.slice(j + 1);
  });
  wrapMount('my-orders', (el) => {
    const on = (e) => {
      const b = e.target.closest('[data-py="inv"], [data-py="inv-close"], #pyInvDone');
      if (!b || !el.contains(b)) return;
      e.preventDefault();
      e.stopPropagation();
      S().pyInv = b.dataset.py === 'inv';
      window.__proto.refresh();
    };
    el.addEventListener('click', on, true);
    return () => el.removeEventListener('click', on, true);
  });

  /* ── 5 付款页 ── */
  function steps(list) {
    return `<div class="py-done on">${list.map((s, i) => `<div class="py-step"><i>${i + 1}</i><div><b>${s[0]}</b><span>${s[1]}</span></div></div>`).join('')}</div>`;
  }
  function payHtml() {
    if (!charge()) {
      return window.UI.band({
        kind: 'compact', eyebrow: '这一次', title: '这台机器不向个人收费',
        sub: '公共就业点位，以及没打开收费的机器，这一次都不用付钱。',
        seal: null, place: ' ', status: { text: '不收费' }
      }) + `<main class="body d3-cashier">${steps([['直接办就行', '不用扫码，也不会扣钱。'], ['四个功能照旧', '改简历、练面试、打印、扫描都按这台机器不收费来办。']])}</main>`
        + window.UI.dock({ back: false, left: '<button class="btn sec" data-go="home">返回首页</button>', ask: '问小青：哪些不用付钱', pri: { label: '回首页', go: 'home' } })
        + window.UI.nav('home');
    }
    const st = S().pyState || 'wait';
    const name = whatName();
    const back = S().pyBack || 'home';
    const backBtn = `<button class="btn sec" data-go="${back}">${window.UI.icon('chevL', 30, 2.4)}不付了，返回</button>`;
    let body = '';
    let pri = null;
    const sum = `<div class="sumcard"><div class="r"><span>这一次</span><b>${name}</b><span></span></div><div class="r"><span>金额</span><b>${YUAN}</b><span></span></div><div class="r"><span>换来</span><b>只办这一次</b><span></span></div></div>`;
    if (st === 'ok') {
      body = sum + steps([
        ['付好了，马上开始', '这一次：' + name + ' · ' + YUAN + '。已经付好，马上开始。'],
        ['只办这一次', '这一次用完就没有了。'],
        ['没做成会退', '没生成、没扫成或没出纸，钱会自动退回原付款账户。']
      ]);
      pri = { label: '马上开始', id: 'pyGo' };
    } else if (st === 'owned') {
      body = steps([
        ['这次直接用', '你在手机上买过 1 次 ' + name + '，这次直接用。'],
        ['不再扫码', '这一次不用再付 ' + YUAN + '，屏上不出收款码。'],
        ['用完就没有了', '点「用这一次」之后，手机上买的这一次就用掉。']
      ]);
      pri = { label: '用这一次', id: 'pyUse' };
    } else if (st === 'fail' || st === 'timeout') {
      const title = st === 'timeout' ? '等了 5 分钟，这一次没有付成' : '这次没付成';
      body = sum + steps([
        [title, '钱没有扣。'],
        ['可以再试', '再出一张码，或返回。返回之后这一次还没开始。'],
        ['不会开始办理', '没付成就不会开始' + name + '。']
      ]);
      pri = { label: '再出一张码', id: 'pyRetry' };
    } else {
      const check = S().pyCheck ? '<p class="fine">正在向支付渠道核实这一次的结果。这一次还没有确认到账。</p>' : '';
      body = `<p class="d3-chline"><b>请用微信或支付宝扫这张码</b>微信、支付宝都能扫。这张码只收这一次 ${YUAN}。</p>${sum}`
        + `<div class="d3-qrframe waiting"><b class="d3-qrt">请扫码支付</b>${window.UI.qr(11, 340)}<b>这一次：${name} · ${YUAN}</b><p>收款码 5 分钟内有效。还剩 5:00。付好了才会开始。</p>${check}</div>`;
      pri = { label: '刷新付款结果', id: 'pyRefresh' };
    }
    const sub = st === 'ok' ? '付好了，马上开始' : st === 'owned' ? '手机上买过这一次' : st === 'timeout' ? '等待超时，钱没有扣' : st === 'fail' ? '没付成，钱没有扣' : '付好了才会开始';
    return window.UI.band({
      kind: 'compact', eyebrow: '这一次 · ' + name, title: '请完成这一次支付', sub,
      seal: null, place: ' ', status: { text: sub, warn: st === 'fail' || st === 'timeout' ? 1 : 0 }
    }) + `<main class="body d3-cashier py-pay">${body}</main>`
      + window.UI.dock({ back: false, left: backBtn, ask: '问小青：这一次怎么付', pri })
      + window.UI.nav('home');
  }

  window.SCREENS.push({
    id: 'pay-service',
    group: '打印扫描',
    name: '付款（AI 与扫描）',
    notes: {
      does: 'AI 简历优化、AI 模拟面试、扫描共用的付款页，样子照打印收银台（screens2.js 的 cashier）。1.00 元是演示数字，不是定价；真实价格每台机器在管理员后台设，不进仓库。状态：等待付款、付款成功、超时、没付成、手机上已经买过这一次。公共就业点位或收费关掉时，这一屏只写不收费。',
      motion: '付款成功在稿上停 1.6 秒再进入下一步（?shot=1 时停住，方便看这一态）。不自己演变成已付款。',
      keep: '微信、支付宝都能扫同一张码。没付成或超时：钱没有扣，可以再出一张码或返回。手机上买过：不出码，按钮「用这一次」。只卖单次。打印仍走原来的收银台，不在这屏重画。'
    },
    render: payHtml,
    demo: () => (charge() ? [
      { label: '演示：付款成功', ev: 'py-ok' },
      { label: '演示：付款没成功', ev: 'py-fail' },
      { label: '演示：等待超时', ev: 'py-timeout' },
      { label: '演示：手机上已经买过这一次', ev: 'py-owned' }
    ] : []),
    mount: (el) => {
      const on = (e) => {
        const again = e.target.closest('#pyRetry');
        const refresh = e.target.closest('#pyRefresh');
        const go = e.target.closest('#pyUse, #pyGo');
        if (again && el.contains(again)) { e.preventDefault(); e.stopPropagation(); S().pyState = 'wait'; S().pyCheck = 0; window.__proto.refresh(); return; }
        if (refresh && el.contains(refresh)) { e.preventDefault(); e.stopPropagation(); S().pyCheck = (S().pyCheck || 0) + 1; window.__proto.refresh(); return; }
        if (go && el.contains(go)) { e.preventDefault(); e.stopPropagation(); arrive(); }
      };
      const onDemo = (e) => {
        const map = { 'py-ok': 'ok', 'py-fail': 'fail', 'py-timeout': 'timeout', 'py-owned': 'owned' };
        if (!map[e.detail]) return;
        S().pyState = map[e.detail];
        window.__proto.refresh();
      };
      el.addEventListener('click', on);
      el.addEventListener('proto-demo', onDemo);
      let t = 0;
      if (S().pyState === 'ok' && new URLSearchParams(location.search).get('shot') !== '1') t = setTimeout(arrive, 1600);
      return () => { el.removeEventListener('click', on); el.removeEventListener('proto-demo', onDemo); if (t) clearTimeout(t); };
    }
  });

  function applyQuery() {
    const q = new URLSearchParams(location.search);
    const s = S();
    if (!s) return false;
    let dirty = false;
    if (q.get('py')) { s.pyState = q.get('py'); dirty = true; }
    if (q.get('what')) { s.pyWhat = q.get('what'); dirty = true; }
    if (q.get('back')) { s.pyBack = q.get('back'); dirty = true; }
    if (q.get('next')) { s.pyNext = q.get('next'); dirty = true; }
    if (q.get('after')) { s.pyAfter = q.get('after'); dirty = true; }
    if (q.get('b2v')) { s.b2v = q.get('b2v'); s.b2vOwner = (location.hash || '').replace('#', ''); dirty = true; }
    if (q.get('fsResult')) { s.fsResult = q.get('fsResult'); dirty = true; }
    if (q.get('fiStartFail') === '1') { s.fiStartFail = 1; dirty = true; }
    if (q.get('fiRunErr')) { s.fiRunErr = q.get('fiRunErr'); dirty = true; }
    if (q.get('paid')) {
      s.pyPaid = s.pyPaid || {};
      q.get('paid').split(',').forEach((k) => { if (k) s.pyPaid[k] = true; });
      dirty = true;
    }
    if (q.get('pyInv') === '1') { s.pyInv = true; dirty = true; }
    if (q.get('pyzero')) {
      s.pyZero = {};
      q.get('pyzero').split(',').forEach((k) => { if (k) s.pyZero[k] = 1; });
      dirty = true;
    }
    if (q.get('pickup')) { s.pickupState = q.get('pickup'); dirty = true; }
    return dirty;
  }
  function boot() {
    const s = window.S;
    if (!s) return;
    const dirty = applyQuery();
    const feeBtn = document.getElementById('tg-fee');
    const row = feeBtn && feeBtn.parentElement;
    if (row && !document.getElementById('tg-public')) {
      const b = document.createElement('button');
      b.className = 'tg';
      b.id = 'tg-public';
      b.type = 'button';
      b.textContent = '公共就业点位';
      b.setAttribute('aria-pressed', s.publicSite ? 'true' : 'false');
      b.addEventListener('click', () => {
        s.publicSite = !s.publicSite;
        b.setAttribute('aria-pressed', s.publicSite ? 'true' : 'false');
        if (feeBtn) feeBtn.setAttribute('aria-pressed', s.feeWanted ? 'true' : 'false');
        if (window.__proto) window.__proto.refresh();
      });
      row.appendChild(b);
    }
    if (feeBtn && !feeBtn.dataset.pyHook) {
      feeBtn.dataset.pyHook = '1';
      feeBtn.addEventListener('click', (e) => {
        if (!window.S || !window.S.publicSite) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        window.S.feeWanted = !window.S.feeWanted;
        feeBtn.setAttribute('aria-pressed', window.S.feeWanted ? 'true' : 'false');
        if (window.__proto) window.__proto.refresh();
      }, true);
      const fix = () => {
        if (!window.S || typeof window.S.feeWanted !== 'boolean') return;
        const want = window.S.feeWanted ? 'true' : 'false';
        if (feeBtn.getAttribute('aria-pressed') !== want) feeBtn.setAttribute('aria-pressed', want);
      };
      new MutationObserver(fix).observe(feeBtn, { attributes: true, attributeFilter: ['aria-pressed'] });
      fix();
    }
    if (dirty && window.__proto) window.__proto.refresh();
  }
  if (document.readyState === 'complete') setTimeout(boot, 0);
  else window.addEventListener('load', () => setTimeout(boot, 0));
})();
