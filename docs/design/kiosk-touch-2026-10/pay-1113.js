/* pay-1113.js：收费显示与付款（2026-11-14 第三版，只画稿）
 * 产品负责人 11/13 对第一版核图回「都按推荐」：
 * 1. 能重试的失败，同一单免费再试一次；不再试、离开，或再试还不成，钱自动退回原付款账户。
 * 2. 付一次管这一趟。收费机器上不再卖「次数用完再付一次」；这一趟里的子功能不扣每日次数。
 * 3. 简历诊断免费，开始改写之前收。
 * 4. 排版失败不退款（原稿「也不计次数」），只有 AI 真没做成才退。
 * 第三版只修越框和收费开时的矛盾用词：诊断价格说明放进「带走这份报告」，不另插一条把卡片压扁。
 * 1.00 元是演示数字，不是定价。真实价格每台机器在管理员后台设，不进仓库。
 *
 * 只在「收费点位」开着、且不是「公共就业点位」时改画面。
 * 两个开关都关（或只开公共就业点位）时，被包住的屏原样返回。
 * 新容器默认 display:none，要显示时再加 .on。
 *
 * 复用：收银台 .d3-cashier / .d3-qrframe / .sumcard，UI.qr，.b2a-bqr，.olist，.st3-check。
 * 打印收银台不重画。到机取件未付款仍去 cashier。取件示例单仍是 2.00 元。
 */
(function () {
  'use strict';

  const S = () => window.S || {};
  const charge = () => !!S().fee;
  const paid = (k) => !!(S().pyPaid && S().pyPaid[k]);
  const find = (id) => (window.SCREENS || []).find((s) => s.id === id);
  const YUAN = '1.00 元';
  const CHANNEL = '到账时间以支付渠道为准';
  const BACK = '自动退回原付款账户，' + CHANNEL;
  const RETRY = '这一次没做成。可以免费再试一次；不试了或再不成，钱' + BACK + '。';
  const CHECK_PAPER = '核查确认没出纸后，钱' + BACK + '。';
  const TIMEOUT_FULL = '没收到这一次的钱；万一已经扣了，会' + BACK + '。';
  const WAIT_BACK = '返回后，万一已经付了，会' + BACK + '。';

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
.py-home,.py-bar,.py-sample{display:none}
.py-keep{white-space:nowrap}
.overview .ov-item > span{color:var(--desk-ink)}
.py-home.on{display:block;margin-top:2px;font:800 22px/1.25 var(--sans);color:var(--teal-ink);white-space:nowrap}
.d3-home .task .py-home.on{padding-right:158px}
.task.dark .py-home.on{color:var(--glow)}
.d3-home .task:has(.py-home){min-height:300px;gap:8px;padding:22px 26px 16px}
.d3-home .task:has(.py-home) h3{margin-top:0;font-size:36px}
.d3-home .task:has(.py-home) p{font-size:21px;line-height:1.35}
.py-bar.on{flex:none;display:flex;flex-direction:column;gap:2px;margin:8px 0 0;padding:8px 18px;border-radius:20px;background:var(--card);border:1.5px solid var(--edge)}
.py-bar.on b{font:800 26px/1.25 var(--sans);color:var(--deep)}
.py-bar.on span{font-size:20px;line-height:1.35;color:var(--ink-2)}
.py-pay.d3-cashier .d3-qrframe{flex:none;justify-content:flex-start;min-height:0;gap:8px;padding:12px 16px}
.py-pay .sumcard{flex:none}
.py-pay .sumcard .r{min-height:72px;padding:10px 22px}
.py-sample.on{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;overflow:hidden}
/* 简历样张下半截是浅灰线，门禁不算墨。拉到一半高时空白会过 320，收到 46% 且不超过 580。 */
.py-sample.on svg{height:46%;max-height:580px;width:auto;max-width:100%;flex:none}
.py-sample.scan svg{height:33.33%;max-height:420px}
.d4-take.py-take{flex-wrap:wrap;align-items:center;align-content:center;min-height:120px;flex-shrink:0}
.d4-take.py-take>.fine{flex:1 0 100%;line-height:1.35}
.py-invbody{justify-content:flex-start;gap:12px;padding-top:16px;padding-bottom:12px}
.py-invqr.b2a-bqr{width:320px;height:320px;padding:20px}
.py-invqr.b2a-bqr svg{width:280px;height:280px}
.band:has(.py-invqr) .ask{align-items:center}
.band:has(.py-invqr) .ask .t{min-width:0}
.fe-line.py-bill{flex-direction:row;align-items:center;gap:12px}
.fe-line.py-bill .tx{flex:1;min-width:0}
.fe-line.py-bill>.btn{align-self:center;flex:none;width:auto;min-width:168px;height:72px;min-height:72px;padding:0 22px}
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
  function priceSpan(text) { return '<span class="py-home on">' + text + '</span>'; }
  function bar(title, desc) {
    return '<div class="py-bar on"><b>' + title + '</b><span>' + desc + '</span></div>';
  }
  /* 放进正文末尾，和同屏卡片一样宽（正文左右留白各屏不一样，不能再写死 40）。 */
  function beforeDock(h, html) {
    const j = h.lastIndexOf('</main>');
    if (j >= 0) return h.slice(0, j) + html + h.slice(j);
    const i = h.lastIndexOf('<footer class="dock">');
    if (i >= 0) return h.slice(0, i) + html + h.slice(i);
    return h;
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
  function wrapCharge(id, fn) {
    const d = find(id); if (!d) return;
    const r0 = d.render;
    d.render = () => { if (!charge()) return r0(); return fn(r0); };
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
  function moveBlockBefore(h, blockStart, beforeMark) {
    const start = h.indexOf(blockStart);
    if (start < 0) return h;
    const end = h.indexOf('</div>', start);
    if (end < 0) return h;
    const line = h.slice(start, end + 6);
    const rest = h.slice(0, start) + h.slice(end + 6);
    const bi = rest.indexOf(beforeMark);
    if (bi < 0) return h;
    const bstart = rest.lastIndexOf('<div class="fe-line"', bi);
    if (bstart < 0) return h;
    return rest.slice(0, bstart) + line + rest.slice(bstart);
  }
  function replaceLine(h, id, html) {
    const mark = 'data-arg="' + id + '"';
    const i = h.indexOf(mark);
    if (i < 0) return h;
    const start = h.lastIndexOf('<div class="fe-line"', i);
    const end = h.indexOf('</div>', i);
    if (start < 0 || end < 0) return h;
    return h.slice(0, start) + html + h.slice(end + 6);
  }
  /* 收费机器上「次数用完」这一态不出现：先按原稿默认样子画，再把次数说法换成这一趟。 */
  function withoutQuota(r0) {
    const s = S();
    if (s.b2v !== 'quota') return r0();
    const prev = s.b2v;
    s.b2v = '';
    try { return r0(); }
    finally { s.b2v = prev; }
  }

  const NAME = { resume: 'AI 简历优化', interview: 'AI 模拟面试', scan: '扫描' };
  const TRIP = {
    resume: '付一次管这一趟：改写、对照岗位、换写法都包含，不再另收费。打印另按页计价。',
    interview: '付一次管这一趟：这一场练习包含，不再另收费。',
    scan: '付一次管这一趟：这一次扫描包含，不再另收费。打印另按页计价。'
  };
  const MISS = { resume: '没生成出来', interview: '没练成', scan: '没扫成' };
  function whatKey() {
    const w = S().pyWhat;
    return w === 'interview' || w === 'scan' ? w : 'resume';
  }
  function whatName() { return NAME[whatKey()]; }
  function tripText() { return TRIP[whatKey()]; }
  function sampleOf(key) {
    const ui = window.UI;
    const scan = key === 'scan';
    const a = scan ? ui.scanPaper(420) : key === 'interview' ? ui.report(420) : ui.resume(420);
    const b = scan ? ui.scanPaper(420) : key === 'interview' ? ui.report(420) : ui.resume(420, 'annot');
    const c = scan ? ui.scanPaper(420) : '';
    return '<div class="py-sample on' + (scan ? ' scan' : '') + '" aria-hidden="true">' + a + b + c + '</div>';
  }

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

  /* ── 首页短价。页脚那句用整词不换行，只在收费时补上。 ── */
  wrapCharge('home', (r0) => {
    let n = r0();
    const resumeTxt = cents('resume') ? ('每次 ' + money(cents('resume')) + ' · 诊断免费') : '免费';
    n = n.replace('<h3>改简历</h3>', '<h3>改简历</h3>' + priceSpan(resumeTxt));
    n = n.replace('<h3>练面试</h3>', '<h3>练面试</h3>' + priceSpan(homeLine('interview', '每次 ')));
    n = n.replace('<h3>打印 · 扫描</h3>', '<h3>打印 · 扫描</h3>' + priceSpan('打印 ' + homeLine('print', '黑白每页 ')) + priceSpan('扫描 ' + homeLine('scan', '每次 ')));
    const foot = '离开 3 分钟无操作自动退出登录';
    if (n.indexOf(foot) >= 0 && n.indexOf('收费以现场公示为准') < 0) {
      n = n.replace(foot, foot + ' · <span class="py-keep">收费以现场公示为准</span>');
    }
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

  /* ── 诊断免费。开始改之前那颗按钮才收款。价格说明放进「带走」卡，不再另插一条把右侧卡片压扁。 ── */
  wrapCharge('diagnosis', (r0) => {
    let h = r0().replace('免费试运营，本单 0 元', '导出不另收钱');
    if (paid('resume')) return h;
    const n = retarget(h, '查看优化建议（4 条）', 'data-go="pay-service" data-set="pyWhat=resume;pyBack=diagnosis;pyNext=optimize;pyAfter=start-resume;pyState=wait"');
    if (!n) return h;
    h = n.replace('>查看优化建议（4 条）', '>付 ' + YUAN + '并开始');
    const note = '这一次 ' + YUAN + '，AI 简历优化。诊断免费，付好了才开始改。没做成可免费再试一次；再不成，钱' + BACK + '。';
    h = h.replace('<section class="d4-take" aria-label="带走这份报告">', '<section class="d4-take py-take" aria-label="带走这份报告">');
    h = h.replace('<span class="d4-price">导出不另收钱</span>', '<span class="d4-price">导出不另收钱</span><p class="fine left">' + note + '</p>');
    return h;
  });

  /* ── 练面试：年龄确认仍先问。没创建成且已付过，主按钮是免费再试。 ── */
  wrapCharge('iv-3', (r0) => {
    let h = r0();
    const s = S();
    if (s.fiStartFail && paid('interview')) {
      h = h.replace('可以直接再点一次「创建并开始练习」。', RETRY);
      h = h.replace('>创建并开始练习', '>免费再试一次');
      return h;
    }
    if (s.ai === 'down' || s.fiCreating || paid('interview')) return h;
    if (h.indexOf('>创建并开始练习') < 0) return h;
    const n = retarget(h, '创建并开始练习', 'data-go="pay-service" data-set="pyWhat=interview;pyBack=iv-3;pyNext=iv-3;pyAfter=start-interview;pyState=wait"');
    if (!n) return h;
    return beforeDock(n.replace('>创建并开始练习', '>付 ' + YUAN + '开始练'), bar('这一次 ' + YUAN, 'AI 模拟面试。先确认年满 14 周岁，再付款。付好了才开始练。没练成可免费再试一次；再不成，钱' + BACK + '。'));
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

  /* ── 扫描：开始前收款。没付过的完成页不标价（不付钱扫不了）。失败且已付，免费再试。 ── */
  wrapCharge('scan-type', (r0) => {
    const h = r0();
    if (paid('scan')) return h;
    const n = retarget(h, '下一步 · 建立这次扫描', 'data-go="pay-service" data-set="pyWhat=scan;pyBack=scan-type;pyNext=scan-guide;pyAfter=start-scan;pyState=wait"');
    if (!n) return h;
    return beforeDock(n.replace('>下一步 · 建立这次扫描', '>付 ' + YUAN + '开始扫描'), bar('这一次 ' + YUAN, '扫描。付好了才建立这次扫描。没扫成可免费再试一次；再不成，钱' + BACK + '。打印另按页计价。'));
  });
  wrapCharge('scan-result', (r0) => {
    let h = r0();
    const kind = S().fsResult;
    const fail = kind === 'timeout' || kind === 'incomplete' || kind === 'nofile';
    if (fail) {
      if (!paid('scan')) return h;
      h = h.split('重试扫描（同一份材料）').join('免费再试一次');
      const endFacts = '</div></div><p class="fs-help">';
      if (h.indexOf(endFacts) >= 0) h = h.replace(endFacts, '</div></div><p class="fs-p">' + RETRY + '</p><p class="fs-help">');
      return h;
    }
    const sentence = '先检查文件和个人信息。金额由系统报价，本页不给价格。';
    if (!paid('scan') || h.indexOf(sentence) < 0) return h;
    const yuan = '<span style="white-space:nowrap">' + YUAN + '</span>';
    h = h.replace('<div class="fs-card fs-grow">', '<div class="fs-card fs-grow py-paidscan">');
    return h.replace(sentence, '先检查文件和个人信息。打印另按页计价，到核对价格再看。扫描这一次已经付过 ' + yuan + '。');
  });

  /* ── 这一趟里的对照、换写法不另收费，也不再卖「再用一次」。不收费时仍走原稿。 ── */
  wrapCharge('jobfit', (r0) => {
    let h = withoutQuota(r0);
    if (paid('resume') && h.indexOf('这次没对照出来') >= 0) {
      h = h.split('>再试一次<').join('>免费再试一次<');
      h = h.replace('这次不计次数。', '这次不计次数。' + RETRY);
    }
    return h;
  });
  wrapCharge('compare', (r0) => {
    let h = withoutQuota(r0);
    if (paid('resume') && h.indexOf('这次没换成') >= 0) {
      h = h.replace('再试一次</button>', '免费再试一次</button>');
      h = h.replace('算 1 次 · 今天还剩 17 次', RETRY);
    }
    h = h.split('算 1 次 · 今天还剩 17 次').join('这一趟已包含，不再另收费');
    h = h.split('用了 1 次 · 今天还剩 16 次').join('这一条已经换过，这一趟不再另收费');
    return h;
  });
  /* 收费机器上不演示「今天次数用完」。对照那一屏的演示按钮去掉；不收费时仍是原稿。 */
  (function () {
    const d = find('jobfit'); if (!d) return;
    const d0 = d.demo;
    d.demo = () => {
      const base = typeof d0 === 'function' ? (d0() || []) : (d0 || []);
      if (!charge()) return base;
      return base.filter((x) => !x || String(x.label || '').indexOf('今天次数用完') < 0);
    };
  })();
  /* 收费开时，这四屏不再写和收费矛盾的旧句。关着时原样返回。 */
  wrapCharge('me', (r0) => r0().split('免费试运营，本单 0 元').join('已付款 · ' + YUAN));
  wrapCharge('resume-export', (r0) => r0().split('免费试运营，本单 0 元').join('导出不另收钱'));
  wrapCharge('done', (r0) => r0().replace('重新选文件后再确认。免费试运营。', '重新选文件后再确认。'));
  wrapCharge('gen-preview', (r0) => r0().split('收费导出需登录会员账号并核销 1 次权益').join('导出不另收钱'));

  /* ── 没诊断出来：不缩字，不卖再用一次。付过才在副标题里写退款。 ── */
  wrapCharge('st-ai-down', (r0) => {
    const old = '今天的 AI 次数用完了，明天恢复；可以先打印原件。';
    const next = paid('resume')
      ? '这次没有生成诊断结论。付过的钱会' + BACK + '。可以先打印原件。'
      : '这次没有生成诊断结论，可以先打印原件。';
    return r0().replace(old, next);
  });

  /* ── 到机取件未付款，以及结果未确认：都要等核查确认没出纸，才退。 ── */
  wrapCharge('pickup-ok', (r0) => {
    const h = r0();
    if ((S().pickupState || 'unpaid') !== 'unpaid') return h;
    if (h.indexOf('进入现场支付') < 0) return h;
    return beforeDock(h, bar('这台机器打印收费，本单 2.00 元，付完就出纸', '下一步进收银台。付好了才开始打印。' + CHECK_PAPER));
  });
  wrapCharge('st-unconfirmed', (r0) => {
    const h = r0();
    if (!paid('print')) return h;
    return beforeDock(h, bar('核查之后才退', CHECK_PAPER));
  });

  /* 排版失败不包：原稿「也不计次数 / 再排一次」保持不变，不写退钱。 */

  /* ── 报告没生成：主按钮改成免费再试，不再另加一条互相矛盾的退款条。 ── */
  wrapCharge('iv-run', (r0) => {
    let h = r0();
    if (!paid('interview') || (S().fiRunErr || '').indexOf('报告生成失败') < 0) return h;
    h = h.replace('报告生成失败，请重试', '报告没生成。可以免费再试一次；不试了或再不成，钱' + BACK + '。');
    h = h.replace('>提交回答', '>免费再试一次');
    return h;
  });

  /* ── 订单与开发票 ── */
  function bill(title, small, btn) {
    return '<div class="fe-line py-bill"><span class="tx"><b>' + title + '</b><small>' + small + '</small></span>' + (btn || '') + '</div>';
  }
  function freeInvoice() {
    return window.UI.band({
      kind: 'compact',
      eyebrow: '我的 · 订单',
      title: '这台机器免费，没有需要开发票的订单',
      seal: null,
      place: ' ',
      status: { text: '不收费' }
    }) + '<main class="body d3-cashier py-pay">' + sampleOf('resume') + '</main>'
      + window.UI.dock({ back: false, ask: false, pri: { label: '返回', go: 'my-orders' } })
      + window.UI.nav('me');
  }
  function invoiceHtml() {
    if (!charge()) return freeInvoice();
    const qr = '<div class="b2a-bqr py-invqr">' + window.UI.qr(21, 280) + '</div>';
    const list = '<div class="olist"><div class="olist-t">手机上要填的三项</div>'
      + '<div class="st3-check"><i>1</i><span>抬头。个人写姓名，单位写单位名称。</span></div>'
      + '<div class="st3-check"><i>2</i><span>税号。单位才要填。个人不用填税号。</span></div>'
      + '<div class="st3-check"><i>3</i><span>接收邮箱。电子发票发到这个邮箱。这台屏幕不保存税号。</span></div>'
      + '</div>';
    return window.UI.band({
      kind: 'compact',
      back: true,
      eyebrow: '我的 · 订单',
      title: '用手机扫码填写开票信息',
      sub: '这一单 ' + YUAN + '。开好后，电子发票发到你填的邮箱。',
      sealHtml: qr,
      status: { text: '等手机填写' },
      path: ['手机扫码', '填写开票信息', '发票发到邮箱'],
      pathLabel: '三步'
    }) + '<main class="body py-invbody">' + list
      + '<p class="fine">在手机上填写并提交。没付成或已退款的单，开不了发票。</p>'
      + sampleOf('resume') + '</main>'
      + window.UI.dock({
        back: false,
        left: '<button class="btn sec" type="button" data-py="inv-close" data-go="my-orders">' + window.UI.icon('chevL', 30, 2.4) + '返回订单</button>',
        ask: '问小青：发票发到哪',
        pri: { label: '填好了，返回订单', id: 'pyInvDone', go: 'my-orders' }
      }) + window.UI.nav('me');
  }
  wrapCharge('my-orders', (r0) => {
    if (S().pyInv) return invoiceHtml();
    let h = r0();
    if (h.indexOf('data-arg="o5"') < 0) {
      h = h.replace('<h1>登录后看你的打印订单</h1>', '<h1>我的订单</h1>');
      h = h.replace('<h1>打印订单</h1>', '<h1>我的订单</h1>');
      h = h.replace('我的 · 打印订单', '我的 · 订单');
      return h;
    }
    h = replaceLine(h, 'o5', bill('AI 简历优化', '已付款 · ' + YUAN + ' · 今天 13:40', '<button type="button" class="btn pri sm" data-py="inv">开发票</button>'));
    h = h.replace('<h1>打印订单</h1>', '<h1>我的订单</h1>');
    h = moveBlockBefore(h, '<div class="fe-line py-bill"><span class="tx"><b>AI 简历优化</b>', 'data-arg="o4"');
    h = replaceLine(h, 'o2', bill('扫描', '已退款 · ' + YUAN + ' · 已退回原付款账户，' + CHANNEL + ' · 今天 11:20'));
    h = replaceLine(h, 'o7', bill('AI 模拟面试', '发票已开 · ' + YUAN + ' · 电子发票已发到邮箱 · 昨天 15:02'));
    h = h.split('0 元（免费试运营） · 免费').join('已付款 · ' + YUAN);
    h = h.split('0 元（免费试运营） · 待退款').join('待退款');
    h = h.split('<p class="fe-p">免费试运营，本单 0 元。</p>').join('');
    h = h.replace('共 7 条已产生打印任务的单', '共 7 条');
    h = h.replace('我的 · 打印订单', '我的 · 订单');
    return h;
  });
  wrapMount('my-orders', (el) => {
    const on = (e) => {
      const b = e.target.closest('[data-py="inv"], [data-py="inv-close"], #pyInvDone');
      if (!b || !el.contains(b)) return;
      e.preventDefault();
      e.stopPropagation();
      S().pyInv = b.getAttribute('data-py') === 'inv';
      window.__proto.refresh();
    };
    el.addEventListener('click', on, true);
    return () => el.removeEventListener('click', on, true);
  });
  window.SCREENS.push({
    id: 'my-orders-invoice',
    group: '我的',
    name: '开发票',
    notes: {
      does: '订单里点「开发票」之后的那一屏，单独挂出来，总览里也能看到。码套白底码框。抬头、税号、邮箱在手机上填，屏上并成一张清单。',
      motion: '无。',
      keep: '1.00 元是演示数字。没付成或已退款的单开不了发票。这台屏幕不保存税号。'
    },
    render: invoiceHtml,
    mount: (el) => {
      const on = (e) => {
        const b = e.target.closest('[data-py="inv-close"], #pyInvDone');
        if (!b || !el.contains(b)) return;
        if (S()) S().pyInv = false;
      };
      el.addEventListener('click', on, true);
      return () => el.removeEventListener('click', on, true);
    }
  });

  /* ── 付款页。公共点位或这一项是 0 元时，只留一句免费和一颗返回。 ── */
  function freePay() {
    const back = S().pyBack || 'home';
    return window.UI.band({
      kind: 'compact',
      eyebrow: '这一次',
      title: '这台机器这项服务免费，不用付款',
      seal: null,
      place: ' ',
      status: { text: '不收费' }
    }) + '<main class="body d3-cashier py-pay">' + sampleOf(whatKey()) + '</main>'
      + window.UI.dock({ back: false, ask: false, pri: { label: '返回', go: back } })
      + window.UI.nav('home');
  }
  function payHtml() {
    if (!charge() || cents(whatKey()) === 0) return freePay();
    const st = S().pyState || 'wait';
    const key = whatKey();
    const name = NAME[key];
    const back = S().pyBack || 'home';
    const leave = '<button class="btn sec" data-go="' + back + '">' + window.UI.icon('chevL', 30, 2.4) + '返回</button>';
    const abort = '<button class="btn sec" data-go="' + back + '">' + window.UI.icon('chevL', 30, 2.4) + '不付了，返回</button>';
    const sum = '<div class="sumcard"><div class="r"><span>这一次</span><b>' + name + '</b><span></span></div>'
      + '<div class="r"><span>金额</span><b>' + YUAN + '</b><span></span></div>'
      + '<div class="r"><span>换来</span><b>这一趟</b><span></span></div></div>';
    const miss = '要是' + MISS[key] + '，可以免费再试一次；不试了或再不成，钱' + BACK + '。';
    let title = '请完成这一次支付';
    let sub = '付好了才会开始';
    let left = abort;
    let body = '';
    let pri = { label: '刷新付款结果', id: 'pyRefresh' };
    let warn = 0;
    if (st === 'ok') {
      title = '付好了，马上开始';
      sub = '这一次已经付好';
      left = leave;
      body = sum + '<p class="fine">' + tripText() + '</p><p class="fine">' + miss + '</p>' + sampleOf(key);
      pri = { label: '马上开始', id: 'pyGo' };
    } else if (st === 'owned') {
      title = '这次不用再付';
      sub = '手机上买过这一次';
      left = leave;
      body = '<p class="d3-chline"><b>手机上买过这一次</b>这次直接用，屏上不出收款码。点「用这一次」之后，这一趟就开始。</p>'
        + '<p class="fine">' + tripText() + '</p>' + sampleOf(key);
      pri = { label: '用这一次', id: 'pyUse' };
    } else if (st === 'fail') {
      title = '这次没付成';
      sub = '没付成，钱没有扣';
      warn = 1;
      const sp = name.charAt(0) === 'A' ? ' ' : '';
      body = sum + '<p class="fine">钱没有扣。没付成就不会开始' + sp + name + '。可以再出一张码，或返回。返回之后这一次还没开始。</p>' + sampleOf(key);
      pri = { label: '再出一张码', id: 'pyRetry' };
    } else if (st === 'timeout') {
      title = '等了 5 分钟，这一次没有付成';
      sub = '没收到这一次的钱';
      warn = 1;
      body = sum + '<p class="fine">' + TIMEOUT_FULL + '可以再出一张码，或返回。</p>' + sampleOf(key);
      pri = { label: '再出一张码', id: 'pyRetry' };
    } else {
      const check = S().pyCheck ? '<p class="fine">正在向支付渠道核实这一次的结果。这一次还没有确认到账。</p>' : '';
      body = '<p class="d3-chline"><b>请用微信或支付宝扫这张码</b>这一次 ' + YUAN + '。' + tripText() + '</p>' + sum
        + '<div class="d3-qrframe"><b class="d3-qrt">请扫码支付</b>' + window.UI.qr(11, 280)
        + '<b>这一次：' + name + ' · ' + YUAN + '</b><p>收款码 5 分钟内有效。还剩 5:00。付好了才会开始。' + WAIT_BACK + '</p>'
        + check + '</div>' + sampleOf(key);
    }
    return window.UI.band({
      kind: 'compact',
      eyebrow: '这一次 · ' + name,
      title: title,
      sub: sub,
      seal: null,
      place: ' ',
      status: { text: sub, warn: warn }
    }) + '<main class="body d3-cashier py-pay">' + body + '</main>'
      + window.UI.dock({ back: false, left: left, ask: '问小青：这一次怎么付', pri })
      + window.UI.nav('home');
  }

  window.SCREENS.push({
    id: 'pay-service',
    group: '打印扫描',
    name: '付款（AI 与扫描）',
    notes: {
      does: 'AI 简历优化、AI 模拟面试、扫描共用的付款页，样子照打印收银台。1.00 元是演示数字，不是定价。状态：等待、正在核实、付好了、没付成、超时、手机上已经买过这一次。公共就业点位或这一项是 0 元时，只写不用付款。',
      motion: '付款成功在稿上停 1.6 秒再进入下一步（?shot=1 时停住）。不自己演变成已付款。等待页的剩余时间停在 5:00。',
      keep: '请用微信或支付宝扫这张码，不再重复「都能扫」。付一次管这一趟。确认没付成才写「钱没有扣」。超时不写死没扣：没收到这一次的钱，万一已经扣了会自动退回。返回时写明万一已经付了会退。付好了的标题是「付好了，马上开始」，左键是「返回」。手机上买过的标题是「这次不用再付」。打印仍走原来的收银台。'
    },
    render: payHtml,
    demo: () => (charge() && cents(whatKey()) > 0 ? [
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
    if (q.get('pyCheck') === '1') { s.pyCheck = 1; dirty = true; }
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
