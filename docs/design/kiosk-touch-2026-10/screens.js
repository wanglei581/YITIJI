/* 页面定义：每屏 = 意图带（看）+ 内容（选）+ 按区（按）+ 导航。notes 写给说明栏。 */
(function () {
  const { icon, band, dock, nav, slab, tile } = UI;
  const S = () => window.S;
  const F = (o) => (o.band ? band(o.band) : '') + (o.pre || '') + `<main class="body ${o.cls || ''}">${o.body}</main>` + (o.dock === false ? '' : (o.dockHtml || dock(o.dock || {}))) + (o.nav === false ? '' : (o.navAdvisor ? nav(o.nav).replace('<span>问小青</span>', '<span>AI 顾问</span>') : nav(o.nav)));
  const RAIL = {
    resume: ['上传与方向', 'AI 解析', '诊断报告', '优化打印'],
    iv: ['岗位与经验', '面试官与时长', '核对开始'],
    print: ['选文件', '材料检查', '预览与参数', '核对价格'],
    scan: ['选类型', '在打印机上扫', '等回传', '用扫描件'],
    pick: ['输到机码', '核对订单', '取件']
  };
  const fine = (t) => `<p class="fine">${t}</p>`;
  const sec = (t, s) => `<div class="sec-t rise" style="--i:3">${t}${s ? `<small>${s}</small>` : ''}</div>`;
  const aiOff = () => S().ai === 'down';
  const printerOff = () => S().printer === 'down';
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  if (typeof document !== 'undefined' && !document.getElementById('d3-style')) {
    const st = document.createElement('style');
    st.id = 'd3-style';
    st.textContent = `
.d3-id{display:flex;align-items:center;gap:12px;min-height:72px}
.d3-id .d3-note{flex:1;min-width:0;margin:0;font-size:20px;line-height:1.45;color:var(--ink-2);text-align:left}
.d3-id .d3-acts{display:flex;gap:10px;flex:none}
.d3-mini{height:64px;min-width:64px;padding:0 16px;border-radius:20px;background:var(--card);border:1.5px solid var(--edge);font:700 22px/1 var(--sans);color:var(--ink);display:inline-flex;align-items:center;justify-content:center}
.d3-mini:active{transform:scale(.97)}
.d3-mini.d3-cin{background:transparent;color:var(--cinnabar);border:2px solid var(--cinnabar)}
.d3-go{display:flex;align-items:center;gap:16px;min-height:88px;padding:10px 12px 10px 18px;border-radius:24px;background:var(--teal-wash);color:var(--teal-ink)}
.d3-go .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;text-align:left}
.d3-go .tx b{font-size:26px;line-height:1.3}
.d3-go .tx small{font-size:20px;line-height:1.35;font-weight:600;color:var(--ink)}
.d3-go .d3-mini{background:var(--deep);color:var(--cream);border-color:transparent;min-width:148px;font-size:24px}
.d3-home.body{gap:16px;padding-top:18px;padding-bottom:8px}
.d3-home .task{min-height:340px;padding:14px 16px 12px;gap:4px}
.d3-home .task .ic{width:64px;height:64px;border-radius:18px}
.d3-home .task h3{font-size:34px;margin-top:0}
.d3-home .task p{line-height:1.3;max-width:none;padding-right:158px}
.d3-home .footline .icp{font-size:20px}
.d3-home.d3-on .task{min-height:300px}
.d3-home.d3-on .tiles3 .tile{min-height:120px;padding:12px 14px}
.d3-sub{display:block;max-width:70%;font-size:20px;line-height:1.35;color:var(--ink-2)}
.d3-print.body{gap:10px;padding-top:14px;padding-bottom:10px;overflow:hidden;justify-content:flex-start}
.d3-print.print-off .remind{min-height:0;padding:10px 16px;font-size:22px}
.d3-print.print-off .d3-tools .tile{min-height:104px;padding:8px 10px}
.d3-print.print-off .task{padding:10px 14px 8px}
.d3-print .task{min-height:248px;padding:16px 18px 12px;gap:4px}
.d3-print .task h3{font-size:32px;margin-top:0}
.d3-print .task .ic{width:64px;height:64px;border-radius:18px}
.d3-print .task p{max-width:none;padding-right:0}
.d3-print .task .mini{transform:none}
.d3-print .task:has(.d3-mfpmini) p{padding-right:108px}
.d3-print .task:has(.codeart) p,.d3-print .task:has(.codeart) .take{padding-right:164px}
.d3-print .d3-mfpmini,.d3-print .d3-mfpmini svg{width:96px;height:92px}
.d3-print .codeart{grid-template-columns:repeat(4,28px);gap:5px}
.d3-print .codeart i{height:34px}
.d3-print .grid2{flex:1;min-height:0}
.d3-print .grid2>.task{height:100%}
.d3-tools{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.d3-tools .tile{flex-direction:column;align-items:flex-start;min-height:118px;padding:12px 14px;gap:6px}
.d3-tools .tile .chev{display:none}
.d3-tools .tile .ic{width:64px;height:64px;border-radius:18px}
.d3-tools .tile b{font-size:24px;line-height:1.25}
.d3-tools .tile small{font-size:20px;line-height:1.3;margin-top:2px}
.d3-tools .tile:disabled{opacity:.72}
.d3-legal{display:flex;align-items:flex-start;gap:12px}
.d3-legal details{flex:1;min-width:0;background:var(--well);border-radius:22px;padding:0 18px}
.d3-legal summary{min-height:64px;display:flex;align-items:center;font-size:22px;font-weight:700;color:var(--teal-ink);list-style:none}
.d3-legal summary::-webkit-details-marker{display:none}
.d3-legal details p{font-size:20px;line-height:1.45;color:var(--ink-2);margin:0 0 12px}
.d3-legal .d3-mini{flex:none}
.d3-src.body{gap:12px;padding-top:14px;padding-bottom:10px;justify-content:flex-start}
.d3-src .slab.row{flex:1}
.d3-src .slab.row{min-height:200px;padding:12px 20px}
.d3-src .slab.row .vis{min-height:140px}
.d3-finds{display:flex;flex-direction:column;gap:12px}
.d3-find{display:flex;align-items:center;gap:14px;min-height:120px;padding:12px 14px;border-radius:26px;background:var(--card);border:1.5px solid var(--edge)}
.d3-find .tx{flex:1;min-width:0;text-align:left}
.d3-find b{display:block;font-size:26px;line-height:1.3}
.d3-find small{display:block;font-size:20px;line-height:1.35;color:var(--ink-3);margin-top:4px}
.d3-find .acts{display:flex;gap:10px;flex:none}
.d3-choice{min-width:120px;height:80px;padding:0 18px;border-radius:22px;border:2px solid var(--edge);background:var(--card);font:700 28px/1 var(--sans);color:var(--ink)}
.d3-choice[aria-pressed="true"]{background:var(--deep);color:var(--cream);border-color:var(--deep)}
.d3-choice:active{transform:scale(.97)}
.d3-batch{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.d3-batch .btn{width:100%;height:80px}
.d3-pii.body{gap:12px;padding-top:16px;padding-bottom:12px}
.d3-pii .preview{display:flex;align-items:center;justify-content:flex-start;gap:22px;padding:14px 20px}
.d3-pii .preview b{display:block;font-size:26px}
.d3-pii .preview span{display:block;font-size:22px;color:var(--ink-3);margin-top:6px}
.d3-stepx{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.d3-stepx button{min-width:64px;height:72px;padding:0 10px;border-radius:20px;background:var(--well);font:700 24px/1 var(--sans);display:grid;place-items:center}
.d3-stepx button:active{transform:scale(.96)}
.d3-stepx button:disabled{opacity:.42}
.d3-stepx output{min-width:64px;text-align:center;font:700 34px var(--sans);font-variant-numeric:tabular-nums}
.d3-cap{font-size:21px;color:var(--ink-3)}
.d3-paper,.d3-ro{min-height:64px;display:flex;align-items:center;padding:0 16px;border-radius:20px;background:var(--well);font-size:24px;font-weight:700;color:var(--ink)}
.d3-suggest{margin:0;font-size:22px;line-height:1.4;color:var(--ink-2);text-align:left}
.d3-more{min-height:72px;width:100%;border-radius:22px;background:var(--well);border:1.5px solid var(--edge);font:700 24px/1 var(--sans);color:var(--ink);display:flex;align-items:center;justify-content:space-between;padding:0 20px}
.d3-more:active{transform:scale(.98)}
.d3-range{height:72px;width:100%;margin-top:8px;border-radius:18px;border:1.5px solid var(--edge);background:#fff;padding:0 16px;font:500 24px/1 var(--sans);color:var(--ink)}
.d3-prev.body{gap:10px;padding-top:12px;padding-bottom:10px}
.d3-prev .params{gap:8px;padding:12px 14px}
.d3-prev .preview{padding:10px}
.d3-more-on .preview{padding:4px}
.d3-more-on .seg button{min-height:64px;font-size:22px}
.d3-more-on .d3-range{height:64px;margin-top:4px}
.d3-more-on .params{gap:6px;padding:8px 12px}
.d3-more-on .pager{gap:10px}
.d3-paybox{width:380px;min-height:520px;border-radius:28px;background:var(--well);display:flex;align-items:center;justify-content:center;text-align:center;padding:28px}
.d3-paybox b{display:block;font:700 30px/1.35 var(--serif);color:var(--ink)}
.d3-paybox span{display:block;margin-top:10px;font-size:22px;line-height:1.45;color:var(--ink-2)}
.d3-dest{margin:0;min-height:72px;display:flex;align-items:center;justify-content:center;padding:12px 20px;border-radius:22px;background:var(--well);font-size:24px;font-weight:700;line-height:1.4;color:var(--ink);text-align:center}
.d3-done .tiles3 .tile{min-height:168px}
.d3-pickrow{display:flex;gap:12px;justify-content:center}
.d3-pickrow .d3-mini{height:72px;min-width:200px;font-size:24px;padding:0 18px}
.d3-code10{gap:8px}
.d3-code10 i{width:76px;height:108px;font-size:36px}
.d3-note2{margin:0;font-size:20px;line-height:1.4;color:var(--ink-3);text-align:center}
.d3-ok .cthumb{min-height:560px;display:flex;align-items:center;justify-content:center}
.d3-ok .process{min-height:200px;align-items:center}
.d3-ok .process .ps{min-height:280px}
.d3-edge{margin:-2px 0 0 138px}
.d3-hold{background:var(--well)!important;border-style:dashed!important}
.d3-hold:disabled{opacity:1}
.d3-hold:active{transform:none}
.d3-mfpmini{display:block;width:112px;height:108px}
.d3-mfpmini svg{width:112px;height:108px;display:block}
.d3-fmt3{grid-template-columns:repeat(3,1fr)}
.d3-fname{white-space:nowrap;word-break:keep-all}
.d3-ext,.sumcard .r b .d3-ext{white-space:nowrap;font-size:inherit;color:inherit;font-weight:inherit}
.d3-up.body{justify-content:flex-start;gap:12px;padding-top:12px;padding-bottom:10px}
.d3-up .qr-card{margin-top:0;padding:14px 16px 16px;gap:8px}
.d3-up .d3-qrbox{width:360px;height:360px}
.d3-up .steps3{flex:1;min-height:0;grid-template-rows:1fr}
.d3-up .steps3 .s{height:100%;justify-content:center}
.d3-drop{height:160px;min-height:160px;max-height:160px}
.d3-usb.body{justify-content:flex-start;gap:12px;padding-top:14px;padding-bottom:12px}
.d3-usbhead{display:flex;align-items:center;gap:16px;min-height:72px}
.d3-usbhead b{flex:1;font-size:26px;line-height:1.3;text-align:left}
.d3-usb .stack{flex:1;min-height:0}
.d3-usb .filecard{flex:1}
.d3-pii.body{justify-content:flex-start;gap:10px;padding-top:12px;padding-bottom:10px}
.d3-pii .d3-finds{flex:1;min-height:0}
.d3-pii .d3-find{flex:1;min-height:0}
.d3-count{margin:0;font-size:24px;font-weight:700;color:var(--ink);text-align:left}
.d3-opt{margin:0;font-size:22px;line-height:1.4;color:var(--ink-2);text-align:left}
.d3-prev.body{justify-content:flex-start;gap:8px}
.d3-prev .params{flex:1;min-height:0}
.d3-sug{display:flex;align-items:center;gap:14px;padding:10px 12px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge);text-align:left}
.d3-sug .tx{flex:1;min-width:0}
.d3-sug b{display:block;font-size:24px;line-height:1.3}
.d3-sug p{margin:2px 0 0;font-size:20px;line-height:1.35;color:var(--ink-2)}
.d3-sug-items{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
.d3-sug-items span{font-size:20px;font-weight:700;color:var(--teal-ink);background:var(--teal-wash);border-radius:14px;padding:4px 10px}
.d3-facts{display:flex;gap:10px}
.d3-facts b{flex:1;min-height:56px;display:flex;align-items:center;justify-content:center;padding:6px 10px;border-radius:18px;background:var(--well);font-size:22px}
.d3-more-on .d3-sug p{display:none}
.d3-more-on .d3-facts b{min-height:48px}
.d3-offnote{margin:0;font-size:22px;line-height:1.4;color:var(--clay-ink);text-align:left}
.d3-printing.body{justify-content:flex-start;gap:12px;padding-top:12px;padding-bottom:10px}
.d3-printing .printer{width:660px;height:640px;transform:none;margin:0;flex:none}
.d3-printing .printer svg{width:660px;height:640px}
.d3-psteps{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;flex:none}
.d3-psteps .s{display:flex;flex-direction:column;justify-content:flex-start;gap:6px;min-height:230px;padding:18px 16px;border-radius:24px;background:var(--well)}
.d3-psteps small{font-size:20px;line-height:1.4;color:var(--ink-3)}
.d3-psteps em{font-style:normal;font-size:20px;font-weight:700;color:var(--ink-3)}
.d3-psteps .s.on em{color:var(--teal-ink)}
.d3-psteps .s.now{background:var(--card);border:2px solid var(--teal)}
.d3-psteps .s.now em{color:var(--teal-ink)}
.d3-psec{display:flex;align-items:baseline;gap:14px;font-size:26px}
.d3-psec span{font-size:21px;color:var(--ink-3)}
.d3-pend{margin:0;padding:16px 22px;border-radius:20px;background:var(--well);font-size:22px;color:var(--ink-2);text-align:center}
.d3-printing .printer-wrap{flex:1;min-height:0;display:grid;place-items:center}
.d3-psteps .n{width:48px;height:48px;border-radius:50%;background:var(--deep);color:var(--cream);display:grid;place-items:center;font-weight:700;font-size:22px}
.d3-psteps b{font-size:24px;line-height:1.3}
.d3-psteps .s.on{background:var(--teal-wash)}
.d3-psteps .s.on .n{background:var(--teal)}
.d3-done.body{justify-content:flex-start;gap:12px;padding-top:16px;padding-bottom:12px}
.d3-done .takebox{flex:1;background:var(--card);border:1.5px solid var(--edge);border-radius:30px;min-height:0}
.d3-ok.body{justify-content:space-evenly;gap:18px;padding-top:16px;padding-bottom:16px}
.d3-oknote{display:flex;gap:18px;align-items:flex-start;padding:24px 28px;border-radius:26px;background:var(--well);color:var(--ink-2);font-size:24px;line-height:1.55}
.d3-oknote b{display:block;font-size:26px;color:var(--ink);margin-bottom:4px}
.d3-ok .confgrid{flex:none;align-items:stretch;grid-template-columns:340px 1fr}
.d3-ok .d3-okside{min-height:0;display:flex;flex-direction:column}
.d3-ok .d3-okside .sumcard{flex:1}
.d3-ok .sumcard .r{grid-template-columns:1fr;min-height:150px;padding:20px 28px;gap:6px;align-content:center}
.d3-ok .sumcard .r b{font-size:30px}
.d3-ok .sumcard .r b.d3-amt{font-size:44px;color:var(--deep)}
.d3-ok .sumcard .r b{word-break:normal;overflow-wrap:normal}
.d3-ok .cthumb{min-height:0;height:100%;background:var(--well);border-radius:30px;overflow:hidden}
.d3-ok .process{min-height:0}
.d3-ok .process .ps{min-height:220px;justify-content:center}
.d3-cashier.body{justify-content:flex-start;gap:12px;padding-top:12px;padding-bottom:10px}
.d3-cashier .d3-qrframe{flex:1;min-height:280px;min-width:0}
.d3-cashier .sumcard .r{grid-template-columns:140px minmax(0,1fr) auto}
.d3-cashier .sumcard .r b{word-break:normal;min-width:0}
.d3-qrframe{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:14px;border-radius:28px;background:var(--card);border:1.5px solid var(--edge)}
.d3-qrframe p,.d3-qrframe b{margin:0;font-size:22px;line-height:1.4;color:var(--ink-2);text-align:center}
.d3-qrframe b{font-size:28px;color:var(--ink)}
.d3-qrframe .d3-qrt{font:700 34px var(--serif);color:var(--deep)}
.d3-chline{margin:0;font-size:24px;line-height:1.45;text-align:left}
.d3-chline b{display:block;font-size:24px}
.d3-pass{display:flex;align-items:center;gap:12px;min-height:72px}
.d3-pass>b{flex:none;font-size:24px;line-height:1.3}
.d3-pass .d3-mini{flex:1;height:72px;font-size:24px}
.d3-drop{background:var(--well)}
.d3-up .livebox{min-height:72px;padding:10px 16px}
.d3-up .btn.sec{align-self:flex-start;min-width:240px;height:72px}
.d3-confirm.body{justify-content:flex-start;gap:14px;padding-top:16px;padding-bottom:12px}
.d3-confirm .confgrid{flex:1;min-height:0;align-items:stretch}
.d3-confirm .cthumb{height:100%;min-height:0}
.d3-cashier .sumcard .r{min-height:84px;padding:14px 22px}
.d3-cashier .seg button{min-height:72px}
`;
    document.head.appendChild(st);
  }

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
    notes: { does: '运行页首页 QxHomeView（/）。只回答两件事：这里能办什么、从哪开始。问小青是纸面上的第一主操作。身份与状态在页脚边界句上方（下按区）。继续上次在问小青和四张大卡之间，对应 ContinuePanel。', motion: '光带缓慢流动；四张卡依次浮入（每张晚 45 毫秒）；按下缩小 2%。', keep: '四项主任务与第三行三块不变，底部导航中间一项是「AI 顾问」。AI 角标写能力词。岗位、招聘会入口不出现（托管 a）。清除时长用普通页 3 分钟，结果页 1 分 30 秒。打印机正常写「打印机在线」。不显示姓名和手机号，不写「进入我的」。官方渠道只在本机构渠道数大于 0 时出现，为 0 时这一行只剩两块。百宝箱、智慧校园只在机构开通时出现在这一行。语音没开（构建变量 VITE_USE_TRTC_CALL 不为 true）时文案是「问小青：打一句你想办的事」且不画麦克风；为 true 时才是说话入口并画麦克风。本屏按没开画。收费点位页脚多一句「收费以现场公示为准」（两边单价都读到、且有一边大于 0 才加；读不到不写，也不写免费）。继续上次只在已登录、并且有进行中的打印订单（pending / claimed / printing）或已诊断未优化的简历时出现，接口失败当没有。运行页打印标题是「打印任务进行中」，副行是「文件名 · 状态」，按钮「查看进度」去 /me/print-orders（本屏 my-orders）。示例文件名「毕业生就业推荐表（已填写）.pdf」，状态按进行中写成「正在打印」。简历那条是「上次诊断的简历，可继续优化」，按钮「去优化」。未登录不出现这条。已登录两行大卡最小高度约 300px，字号和小样与未登录相同。练面试说明只用「回答常见问题，当场看反馈，不做录用判断」。未登录左边原文「这台机器上没有待继续的办理 · 不会显示上一位的资料」；已登录左边「有人登录着」（不是按钮），「结束上一位的使用」走清除，「设备状态」去 offline 屏。' },
    render: () => {
      const logged = !!S().logged;
      const T = (o) => `<button class="task ${o.dark ? 'dark' : ''} rise" style="--i:${o.i}" data-go="${o.go}">
        <div class="top"><span class="ic">${icon(o.ic, 40, 2)}</span><span class="chip ${o.ck || ''} ${o.ai ? 'ai' : ''}">${o.chip}</span></div>
        <h3>${o.t}</h3><p>${o.d}</p><div class="take">${icon('check', 24, 2.6)}${o.take}</div><div class="mini">${o.vis}</div></button>`;
      return `<header class="band hero flowing">${UI.flowLines(700)}<div class="halo"></div>${UI.header({ back: false, status: printerOff() ? { text: '打印机离线', warn: 1 } : { text: '打印机在线' } })}
        <div class="greet">${UI.seal('idle', 'xl')}<div><div class="eyebrow" data-greet>下午好</div><h1>我是小青</h1><p>今天想办哪件事？下面选一项，或者直接问我</p></div></div></header>`
        + `<button class="xq-bar rise" style="--i:0" data-go="xq"><span class="orb">${icon('message', 46, 2.2)}</span><span><b>问小青：打一句你想办的事</b><small></small></span><span class="chip ai">AI 数字人</span></button>`
        + `<main class="body d3-home${logged ? ' d3-on' : ''}">
          ${logged ? `<div class="d3-go rise" style="--i:0"><span class="ic">${icon('printer', 32, 2)}</span><span class="tx"><b>打印任务进行中</b><small>毕业生就业推荐表（已填写）.pdf · 打印中</small></span><button class="d3-mini" data-go="my-orders">查看进度</button></div>` : ''}
          <div class="grid2 tasks">
            ${T({ i: 1, go: 'resume', ic: 'file', chip: 'AI 诊断改写', ai: 1, t: '改简历', d: '上传或扫描，诊断、优化或生成新简历，<br>改不改你定', take: '带走：新简历', vis: UI.resume(150, 'annot') })}
            ${T({ i: 2, go: 'interview', ic: 'mic', chip: 'AI 模拟面试', ai: 1, t: '练面试', d: '回答常见问题，当场看反馈，不做录用判断', take: '带走：面试反馈', vis: UI.report(150) })}
            ${T({ i: 3, go: 'print', dark: 1, ic: 'printer', chip: printerOff() ? '打印机离线' : '先选材料再出纸 · 带走：打印件', ck: printerOff() ? 'clay' : 'ghost', t: '打印 · 扫描', d: '手机扫码传文件、插 U 盘，或扫描原件', take: '开始选择材料', vis: UI.stack(132, 3) })}
            ${T({ i: 4, go: 'policy', ic: 'landmark', chip: '官方发布', ck: 'slate', t: '查政策', d: '补贴、社保怎么办，要带哪些材料，以官方发布为准', take: '查看政策说明', vis: UI.checklist(150) })}
          </div>
          <div class="tiles3">
            ${tile({ i: 5, go: 'pickup', icon: 'ticket', title: '到机取件', desc: '手机上下了单，来这里取' })}
            ${tile({ i: 6, go: 'official', icon: 'qr', tone: 'slate', title: '本机构官方渠道', desc: '公众号、官网，扫码看' })}
            ${tile({ i: 7, go: 'help', icon: 'help', tone: 'clay', title: '帮助', desc: '常见问题、服务电话' })}
          </div>
          <div class="d3-id">
            <p class="d3-note">${logged ? '有人登录着' : '这台机器上没有待继续的办理 · 不会显示上一位的资料'}</p>
            <div class="d3-acts">
              ${logged ? '<button class="d3-mini d3-cin" data-act="clear">结束上一位的使用</button>' : '<button class="d3-mini" data-go="login">登录后查看本人记录</button>'}
              <button class="d3-mini" data-go="offline">设备状态</button>
            </div>
          </div>
          <div class="footline rise" style="--i:8"><p class="fine">AI 生成的内容都会标明，仅供参考 · 本机不替你投递 · 离开 3 分钟无操作自动退出登录 · 打开本人文档、诊断报告或优化结果后 1 分 30 秒无操作自动退出</p><span class="icp">鲁ICP备2026023517号-2 · 鲁公网安备37021402007308号</span></div>
        </main>` + nav('home').replace('<span>问小青</span>', '<span>AI 顾问</span>');
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
  const bindResumeIntent = (el) => {
    const onClick = (e) => {
      const b = e.target.closest('[data-go="resume-src"]');
      if (!b) return;
      S().intent = b.dataset.arg === 'optimize' ? 'optimize' : 'diagnose';
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  };
  const deadHub = (o) => `<div class="d4-dead rise" style="--i:${o.i}"><div class="slab row off" role="group" aria-disabled="true"><div class="vis">${o.vis}</div><div class="txt"><span class="chip ai">${o.chip}</span><h3>${o.title}</h3><p>${o.desc}</p><span class="lock">AI能力当前不可用</span></div></div><button class="d4-outlink" data-go="${o.go}">${o.exit}</button></div>`;
  const deadTile = (o) => `<div class="tile off rise" style="--i:${o.i}" role="group" aria-disabled="true"><span class="ic">${icon(o.icon, 34, 2)}</span><span class="tx"><b>${o.title}</b><small>AI能力当前不可用</small></span></div>`;

  add('resume', '改简历', '简历入口', {
    before: 'resume',
    notes: { does: '运行页 /resume-service，QxServiceHubPage hub=resume。正常态两张主卡：有简历去 /resume/source（本稿 resume-src，data-arg=diagnose），没有去 /resume/generate（本稿 scratch）。?ai=down 只停 kind===ai 的入口。', motion: '两张主卡依次浮入；按下缩小。停用的卡按下不动。', keep: '屏上问题用第 3 版「你手上有简历吗？」，副题「有就帮你诊断改写，没有就一步步写一份。」。运行页标题「把简历这件事，做得更清楚」、副题「从来源选择、诊断优化到生成、材料与打印，按你的目标进入对应步骤。」写在规格 serviceHubSpecs.ts，不画在意图带上。底栏中间一项是「AI 顾问」。页脚三句是规格原文 truthTitle / truth / note，排成一行到两行。顶栏胶囊是就绪句「能力与设备状态以办理时确认为准」，不报打印机。合同风险提示卡只在 VITE_ENABLE_CONTRACT_REVIEW==="true" 时出现，默认关，这一帧不画。要 AI 的项（kind ai）：两张主卡（AI简历诊断、从零生成简历）、职业规划、简历对照，以及展开里的 AI简历诊断、AI简历优化。不要 AI、?ai=down 仍可点：求职材料（info）、自我探索（info）、简历素材库（info）、简历打印（device）、我的简历（account）、AI服务记录（account，名字带 AI 但 kind 不是 ai）。两张主卡停用时的出路：有简历「可以先打印原件」去 print；没有简历「可以先看简历素材库」去 templates。后端整站不可用是 st-unavailable，不是这一变体。四张常用卡同一路由不在展开里再列。自我探索卡上写规格句「完成职业倾向参考」。' },
    render: () => {
      const down = aiOff();
      const mains = down
        ? `${deadHub({ i: 0, chip: 'AI 诊断改写', title: '有，帮我改一改', desc: '上传后做诊断或优化，改不改你定', vis: UI.resume(150, 'annot'), go: 'print', exit: '可以先打印原件' })}
           ${deadHub({ i: 1, chip: 'AI 起草', title: '没有，帮我写一份', desc: '从零生成一份可核对的草稿', vis: UI.resume(150, 'blank'), go: 'templates', exit: '可以先看简历素材库' })}`
        : `${slab({ i: 0, go: 'resume-src', arg: 'diagnose', chip: 'AI 诊断改写', ai: 1, title: '有，帮我改一改', desc: '上传后做诊断或优化，改不改你定', take: '问题清单和改法', vis: UI.resume(150, 'annot') })}
           ${slab({ i: 1, go: 'scratch', chip: 'AI 起草', ai: 1, title: '没有，帮我写一份', desc: '从零生成一份可核对的草稿', take: '一份新简历', vis: UI.resume(150, 'blank') })}`;
      const career = down ? deadTile({ i: 5, icon: 'map', title: '职业规划' }) : tile({ i: 5, go: 'career', icon: 'map', title: '职业规划', desc: '带走下一步可以做的事' });
      const fit = down ? deadTile({ i: 7, icon: 'target', title: '简历对照' }) : tile({ i: 7, go: 'jobfit', icon: 'target', title: '简历对照', desc: '填一份岗位要求，AI 对照你的简历' });
      return F({
        band: { eyebrow: 'AI简历服务', title: '你手上有简历吗？', sub: '有就帮你诊断改写，没有就一步步写一份。', seal: 'idle', place: ' ', status: { text: '能力与设备状态以办理时确认为准' } },
        cls: 'tight d4-hub',
        body: `${mains}
          <div class="fgroup"><div class="sec-t rise" style="--i:3">也可以直接用<small>不用先诊断</small><button class="more" data-go="resume-more">其余 6 项 ${icon('chevR', 24, 2.4)}</button></div>
          <div class="grid2">
            ${tile({ i: 4, go: 'materials', icon: 'clipboard', title: '求职材料', desc: '按模板套填，带走求职信和自我介绍' })}
            ${career}
            ${tile({ i: 6, go: 'sa-intro', icon: 'compass', title: '自我探索', desc: '完成职业倾向参考' })}
            ${fit}
          </div></div>
          ${fine('简历用不用，由你本人决定。系统不代投、不替企业筛选或邀约。生成的内容会标明供参考，不会覆盖原文件。')}`,
        dock: { ask: '问小青：我该选哪一个？' }, nav: 'home', navAdvisor: 1
      });
    },
    mount: bindResumeIntent
  });

  add('resume-more', '改简历', '全部简历服务（展开）', {
    notes: { does: '展开服务台上还没摆出来的规格项。名字和说明逐字来自 serviceHubSpecs.ts capabilities / quickLinks。', motion: '面板从下往上滑出（320 毫秒），背景变暗。', keep: '本页四张常用卡（求职材料、职业规划、自我探索、简历对照）和主卡「没有，帮我写一份」（从零生成简历 → /resume/generate）不在这里再列。AI简历诊断 data-arg=diagnose，AI简历优化 data-arg=optimize（规格 29–30 行的 intent）。点进 resume-src 时写入 S().intent，诊断方向屏据此预选两条路之一。简历打印徽标「依赖打印机」，去 /print/upload?source=resume（本稿 print-src）。我的简历说明「查看你名下的简历」，去 /me/resumes。AI服务记录说明「查看诊断与优化记录」，去 /me/ai-records。?ai=down 时只有 kind ai 的两行停用，文案「AI能力当前不可用」；简历素材库、简历打印、我的简历、AI服务记录照常可点。后端整站不可用见 st-unavailable。' },
    render: () => {
      const down = aiOff();
      const rows = [
        ['sparkle', 'AI简历诊断', '带走问题清单和改法', 'AI 诊断改写', 'resume-src', 'diagnose', true],
        ['pen', 'AI简历优化', '对着你的方向逐条看改写', 'AI 优化改写', 'resume-src', 'optimize', true],
        ['layout', '简历素材库', '按分类查看真实模板、标签与适用场景', '模板目录', 'templates', '', false],
        ['printer', '简历打印', '选择文件、核价后在本机打印', '依赖打印机', 'print-src', '', false],
        ['user', '我的简历', '查看你名下的简历', '', 'my-resumes', '', false],
        ['sparkle', 'AI服务记录', '查看诊断与优化记录', '', 'my-ai', '', false]
      ];
      const item = (r) => {
        const chip = r[3] ? ` <span class="chip ${r[3].startsWith('AI') ? 'ai' : 'slate'}" style="height:34px;font-size:20px;vertical-align:4px">${r[3]}</span>` : '';
        if (down && r[6]) return `<div class="tile off" role="group" aria-disabled="true" style="min-height:104px"><span class="ic">${icon(r[0], 32, 2)}</span><span class="tx"><b>${r[1]}${chip}</b><small>AI能力当前不可用</small></span></div>`;
        return `<button class="tile" data-go="${r[4]}"${r[5] ? ` data-arg="${r[5]}"` : ''} style="min-height:104px"><span class="ic">${icon(r[0], 32, 2)}</span><span class="tx"><b>${r[1]}${chip}</b><small>${r[2]}</small></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button>`;
      };
      return screens.find(s => s.id === 'resume').render() + `<div class="scrim" data-go="resume"></div><div class="sheet"><div class="grab"></div><h2>其余简历服务</h2>
        ${rows.map(item).join('')}
        <button class="btn sec" data-go="resume" style="width:100%">收起</button></div>`;
    },
    mount: bindResumeIntent
  });

  add('resume-src', '改简历', '简历在哪', {
    notes: { does: '运行页 /resume/source，ResumeSourcePage。一体机默认打开手机扫码面板（同页的 UploadSessionQrPanel），U 盘是同页的 ResumeUsbImportPanel，不另开路由。', motion: '点「在手机里 / 在 U 盘里」只切换本页面板（opacity）。二维码外圈用已有脉冲，不表示上传进度。', keep: '纸质去扫描工作台：与诊断失败屏 ResumeReportStates.tsx「扫描纸质简历」同一去向 /scan（desc「在打印机面板上扫描，存成 PDF」）。本稿落到 scan-type。本页不能点选已存简历。未登录句是「当前未登录 · 这次按临时上传处理」加「去登录」。已登录只去 my-resumes。Word 默认 wordToPdf=false，句为「Word 转换暂未开放，请另存为 PDF 再上传」；能力打开才收 DOC/DOCX。文件确认前主按钮禁用，文案「请先上传简历文件」；确认后去 resume-direction，不直接解析。会话 600 秒，不写死剩余钟点，不写手机是否连上，也不写号码后四位。U 盘未开通、确认不了、读取失败是别的态，这一帧是「等待插入U盘」。' },
    render: () => F({
      band: { kind: 'compact', eyebrow: 'AI 简历诊断', title: '你的简历在哪里？', rail: { labels: RAIL.resume, now: 0 }, seal: 'idle', place: ' ', status: { text: '等待简历文件' } },
      cls: 'tight d4-fill d4-srcpage',
      body: `<div class="d4-srcs" role="group" aria-label="简历从哪儿来">
          <button class="d4-src" data-d4-src="phone" data-act="seg" aria-pressed="true"><span class="d4-ico">${icon('phone', 40, 2)}</span><b>在手机里</b><small>用手机扫码选择简历文件，再回到一体机确认</small></button>
          <button class="d4-src" data-d4-src="usb" data-act="seg" aria-pressed="false"><span class="d4-ico">${icon('usb', 40, 2)}</span><b>在 U 盘里</b><small>从已插入的 U 盘里选一份。只读取你点的那份</small></button>
          <button class="d4-src" data-d4-src="paper" data-go="scan-type" aria-pressed="false"><span class="d4-ico">${icon('scan', 40, 2)}</span><b>是纸质的</b><small>在打印机面板上扫描，存成 PDF</small></button>
        </div>
        <div class="d4-panel" data-d4-panel="phone">
          <b>请用手机微信或浏览器扫码</b>
          <div class="d4-qr">${UI.qr(6, 360)}</div>
          <p>二维码有效期从生成时起算，10 分钟 · 文件最大 10MB</p>
          <div class="d4-ops">
            <button data-act="toast" data-arg="刷新二维码">刷新二维码</button>
            <button data-act="toast" data-arg="取消这次扫码">取消</button>
          </div>
          <div class="steps3 d4-ministep" aria-label="怎么把文件传过来"><div class="s"><span class="n">1</span><b>扫码</b></div><div class="s"><span class="n">2</span><b>在手机上选文件、点上传</b></div><div class="s"><span class="n">3</span><b>回到这台机器点确认</b></div></div>
          <div class="dropzone d4-drop">${icon('file', 36, 1.8)}<span>传过来的文件会出现在这里</span></div>
        </div>
        <div class="d4-panel" data-d4-panel="usb" hidden>
          <b>等待插入U盘</b>
          <p>插好后列出 10MB 以内的 PDF、JPG、PNG。只读取你主动选择的文件，上传完成后即可拔出 U 盘。</p>
          <button class="btn sec" data-act="toast" data-arg="重新检测">重新检测</button>
        </div>
        ${S().logged
          ? `<button class="d4-link" data-go="my-resumes">${icon('user', 28, 2)}<span>保存过的简历在『我的简历』里看</span>${icon('chevR', 28, 2.2)}</button>`
          : `<button class="d4-link" data-go="login">${icon('user', 28, 2)}<span>当前未登录 · 这次按临时上传处理 · 去登录</span>${icon('chevR', 28, 2.2)}</button>`}
        <div class="d4-links">
          <button data-go="scratch">没有电子简历？让 AI 帮你写一份</button>
          <button data-go="print">只想打印原件</button>
        </div>
        ${fine('Word 转换暂未开放，请另存为 PDF 再上传。')}`,
      dock: { backLabel: '上一步', ask: '问小青：帮我选诊断重点 →', pri: { label: '请先上传简历文件', disabled: true } }, nav: 'home', navAdvisor: 1
    }),
    mount: (el) => {
      const sync = () => {
        const on = el.querySelector('.d4-srcs [aria-pressed="true"]');
        const id = on && on.dataset.d4Src === 'usb' ? 'usb' : 'phone';
        el.querySelectorAll('[data-d4-panel]').forEach((p) => { p.hidden = p.dataset.d4Panel !== id; });
      };
      const onClick = () => queueMicrotask(sync);
      el.addEventListener('click', onClick);
      return () => el.removeEventListener('click', onClick);
    }
  });
  add('upload', '改简历', '手机扫码传文件', {
    notes: { does: '手机扫码传文件。打印来路（S.ctx 为 print）和简历来路（resume）都走这一屏。大屏不感知扫没扫，只等系统收到文件。', motion: '等待时二维码外圈扩散。不自己演到下一步。', keep: '意图带不画步骤条，二维码放在意图带下方，边长 360。两路都画三步：扫码 → 在手机上选文件、点上传 → 回到这台机器点确认。等待句「等你在手机上传文件 · 传好后会显示在下面，再点确认」。占位「传好的文件会出现在这里」。有「取消这次上传」（打印回 print-src，简历回 resume-src）。不写手机连接状态，不自动进入下一步。有效期从生成时起算，10 分钟；能刷新二维码。确认按钮在文件出现前不可点。' },
    render: () => {
      const forPrint = S().ctx === 'print';
      return F({
        band: { eyebrow: forPrint ? '文档打印' : 'AI 简历诊断', title: forPrint ? '用手机扫描下方二维码' : '请用手机微信或浏览器扫码', seal: null, place: ' ', status: forPrint ? (printerOff() ? { text: '打印机离线', warn: 1 } : { text: '打印机在线' }) : { text: '等待简历文件' } },
        cls: 'tight d3-up',
        body: `<div class="qr-card waiting" id="qrWrap"><div class="qr-box d3-qrbox"><i class="pulse"></i><i class="pulse p2"></i>${UI.qr(9, 360)}</div><span style="font-size:21px;color:var(--ink-3)" id="qrExp">二维码有效期从生成时起算，10 分钟 · 文件最大 10MB · <u data-act="toast" data-arg="刷新二维码">刷新二维码</u></span></div>
          <div class="steps3 rise" style="--i:1" id="steps"><div class="s"><span class="n">1</span><b>扫码</b><small>相机或微信</small></div><div class="s"><span class="n">2</span><b>在手机上选文件、<br>点上传</b><small>PDF、JPG、PNG</small></div><div class="s"><span class="n">3</span><b>回到这台机器点确认</b><small>传好后再点下面的确认</small></div></div>
          <div class="livebox rise" style="--i:2" id="upLive"><span class="spin"></span><div><b>等你在手机上传文件 · 传好后会显示在下面，再点确认</b></div></div>
          <div id="upFile"><div class="dropzone d3-drop">${icon('file', 40, 1.8)}<span>传好的文件会出现在这里</span></div></div>
          <button class="btn sec" data-go="${forPrint ? 'print-src' : 'resume-src'}">取消这次上传</button>
          ${fine(forPrint ? '结束办理或闲置超时会清除本机临时信息；已上传文件按留存期限管理。' : '未登录临时上传约 1 小时；登录后简历默认保存 90 天。')}`,
        dock: { backLabel: '上一步', ask: forPrint ? '问小青：怎么检查' : '问小青：选诊断重点', pri: { label: forPrint ? '确认使用这份文件' : '确认', go: forPrint ? 'pii' : 'reading', disabled: true, id: 'upNext' } }, nav: 'home', navAdvisor: 1
      });
    }
  });

  add('usb', '改简历', 'U 盘选文件', {
    notes: { does: '列出当次根目录里能用的文件。没插上时不能写已经读到。打印来路和简历来路都走这一屏。', motion: '文件列表依次浮入。', keep: '列表上方写「U 盘根目录里能用的文件（3 个）」和「重新检测」（运行页 U 盘面板有重新检测）。只显示文件名和大小，不显示页数，不列出 Word。拔盘句只写「导入完成后可以直接拔出 U 盘」。读不出来可以换 USB 口或改用手机。底部导航中间一项是「AI 顾问」。' },
    render: () => F({
      band: { eyebrow: S().ctx === 'print' ? '文档打印' : 'AI 简历诊断', title: '挑一份就行', sub: '只读根目录，不进子文件夹。', rail: { labels: S().ctx === 'print' ? RAIL.print : RAIL.resume, now: 0 }, seal: null, place: ' ', status: S().ctx === 'print' ? (printerOff() ? { text: '打印机离线', warn: 1 } : { text: '打印机在线' }) : { text: '等待简历文件' } },
      cls: 'd3-usb',
      body: `<div class="d3-usbhead rise" style="--i:0"><b>U 盘根目录里能用的文件（${D.usbFiles.length} 个）</b><button class="d3-mini" data-act="toast" data-arg="重新检测">重新检测</button></div>
        <div class="stack">${D.usbFiles.map((f, i) => `<button class="filecard rise" style="--i:${i};text-align:left;width:100%" data-go="${S().ctx === 'print' ? 'pii' : 'reading'}"><span class="ft ${f.t === 'JPG' ? 'img' : ''}">${f.t}</span><div style="min-width:0"><b>${f.n}</b><small>${f.s}</small></div><span style="margin-left:auto;color:var(--ink-3)">${icon('chevR', 34, 2.2)}</span></button>`).join('')}</div>
        <div class="remind rise" style="--i:5">${icon('usb', 34, 2)}<span>只读取你主动选择的文件。导入完成后可以直接拔出 U 盘。</span></div>
        ${fine('Word 转换暂未开放，请另存为 PDF 再上传。读不出来可以换一个 USB 口，或者改用手机传。')}`,
      dock: { backLabel: '上一步', ask: S().ctx === 'print' ? '问小青：怎么检查' : '问小青：选诊断重点' }, nav: null, navAdvisor: 1
    })
  });
  add('reading', '改简历', '读简历', {
    notes: { does: '运行页 /resume/parse 的等待态（ResumeParseOutcomeNote waiting）。标题和副标题用等待文案，不预报时长。?ai=down 不画等待：运行页小青停用时诊断失败直接到报告失败态，这一变体改画 st-ai-down 的内容（render 时取 window.SCREENS 里 st-ai-down 的 render）。地址仍是 reading。', motion: '圆章和转圈只表示在进行（transform / opacity），不表示百分比，也没有扫描线。四条说明不打勾、不播报阶段。', keep: '四条是处理内容说明：读取上传文件、识别可解析文字、提取简历结构、生成诊断报告。「处理内容」只在列头标一次。运行页解析页没有底部导航；本稿壳子仍留三格导航，中间一项是「AI 顾问」，这三格不计入本屏可点。底栏是返回上一步和问小青（问小青：解析没完成怎么办）。返回句用 ResumeParsePage.tsx 717：「返回仅停止本机等待，不会撤回已提交的服务请求」。简历原文不会发送给企业，也不进入平台候选人简历库。发给 AI 之前会先遮住手机号、身份证号、邮箱、住址等个人信息；代码里 mask 还包含银行卡号和姓名。等待中没有打印原件，也没有「读完了」。六维名称只读，来自 RESUME_SCORING_DIMENSIONS。' },
    render: () => {
      if (aiOff()) {
        const fail = (window.SCREENS || []).find((s) => s.id === 'st-ai-down');
        if (fail) return fail.render();
      }
      const dims = ['基础信息完整度', '求职目标清晰度', '经历表达清晰度', '成果量化程度', '岗位关键词覆盖', '版式与可读性'];
      return F({
        band: { kind: 'compact', eyebrow: 'AI 解析', title: '文件收到了，正在等最终解析结果。', sub: '解析是一次出结果的处理，中间没有阶段可以播报。', rail: { labels: RAIL.resume, now: 1 }, seal: 'think', place: ' ', status: { text: '正在解析 · 一次性出结果' } },
        cls: 'tight d4-fill d4-read',
        body: `<div class="readgrid d4-grow">
            <div class="reader">${UI.resume(520, 'plain').replace('paper-shadow', '')}</div>
            <div class="rcol">
              <div class="livebox"><span class="spin"></span><div><b>在进行</b><small>以下是这次要处理的内容，不代表实时进度</small></div></div>
              <div class="d4-h">处理内容</div>
              <div class="d4-steps" aria-label="本次处理内容说明">
                ${[['读取上传文件', '校验格式与页数'], ['识别可解析文字', '图片 / 扫描件经 OCR 识别'], ['提取简历结构', '识别教育、经历、技能等分区'], ['生成诊断报告', '6 个评分维度 + 风险表述 + 优先级建议']].map((s, i) => `<div class="d4-step"><i>${i + 1}</i><span><b>${s[0]}</b><small>${s[1]}</small></span></div>`).join('')}
              </div>
              <div class="d4-dimro"><b>报告将评估的维度</b><div class="d4-rochips">${dims.map((d) => `<span>${d}</span>`).join('')}</div></div>
              <div class="why">${icon('shield', 28, 2)}<span>返回仅停止本机等待，不会撤回已提交的服务请求。简历原文不会发送给企业，也不进入平台候选人简历库。</span></div>
              <div class="why">${icon('shield', 28, 2)}<span>发给 AI 之前会先遮住手机号、身份证号、邮箱、住址等个人信息。</span></div>
            </div>
          </div>`,
        dock: { backLabel: '返回上一步', ask: '问小青：解析没完成怎么办' }, nav: null, navAdvisor: 1
      });
    }
  });
  add('diagnosis', '改简历', '诊断报告', {
    notes: { does: '运行页 /resume/report。默认是报告已读、尚未导出（REPORT_STATUS.report「报告已读取」）。点「导出 PDF」后 S().repExported 为真，切到 export-ready（胶囊「导出已生成」）。问题条数、六维分数、依据、影响、可以怎么改都从本次报告读。这一帧 4 条问题和分数是示例。', motion: '六维横条用 scaleX 摆好长度，不播进度。没有扫描线。导出后重绘，不播进度。', keep: '意图带是「AI 生成，仅供参考，请对照原文核对」和「问题 N 处」。六维各写一句人话（resume-report-model DIM_ABOUT），不求和，写明「这不是录取分」。档位：八成及以上较强、一半到八成中等、不足一半偏弱，满分 10。先改这几处最多 3 条。不画简历标注小样，横条不做成按钮。带走区默认只有「导出 PDF」。这一帧是 0 元单，价目写「免费试运营，本单 0 元」；运行页价格条常量只有「免费试运营」。收费时「收费导出需登录会员账号并核销 1 次权益」，按钮不可用。价目停用时「简历导出当前不可用（价目已停用，不是免费）」，不是免费。价目没读到时导出不可点。打印这份报告、扫码带走只在 S().repExported 之后出现；运行页扫码按钮原文是「生成二维码带走」。两个小链接去简历对照（/resume/job-fit，本稿 jobfit）和自我探索（sa-intro）。主按钮「查看优化建议（N 条）」，N 是可改条数。' },
    render: () => {
      const dims = [
        ['基础信息完整度', '8', '较强', .8, 'teal', '看姓名、联系方式、求职意向是否齐全好找。'],
        ['求职目标清晰度', '6', '中等', .6, 'teal', '看有没有写明目标岗位，全篇是否围绕它。'],
        ['经历表达清晰度', '5', '中等', .5, 'teal', '看每段经历有没有交代做法与结果。'],
        ['成果量化程度', '3', '偏弱', .3, 'clay', '看成果有没有用可核实的数字说明。'],
        ['岗位关键词覆盖', '6', '中等', .6, 'teal', '看用词与目标岗位的常见表述是否对得上。'],
        ['版式与可读性', '8', '较强', .8, 'teal', '看分区、留白与长度是否便于快速阅读。']
      ];
      const top = [
        ['工作经历', '成果量化程度', '负责学院公众号的选题、撰写和排版。', '招聘的人看不出做了多少、做成了什么。', '只在原文已有的事实上补周期和篇数，没有的数字不要写上。'],
        ['求职目标', '求职目标清晰度', '希望找一份稳定的工作。', '全篇没有岗位名，后面的经历对不上具体职位。', '写成目标岗位，并让经历围着它写。'],
        ['项目经历', '经历表达清晰度', '参与迎新志愿服务。', '只有活动名，没有你具体做了什么。', '补上你负责的那一段，不新加没做过的项目。']
      ];
      const exported = S().repExported === true;
      return F({
        band: { kind: 'compact', eyebrow: 'AI 生成，仅供参考，请对照原文核对', title: '问题 4 处', rail: { labels: RAIL.resume, now: 2 }, seal: 'idle', place: ' ', status: { text: exported ? '导出已生成' : '报告已读取' } },
        cls: 'tight d4-fill d4-diag',
        body: `<div class="d4-rep d4-grow">
            <section class="d4-dims" aria-label="六个维度">
              <div class="d4-h">六个维度<small>这不是录取分 · 不求和</small></div>
              ${dims.map((d) => `<div class="d4-dim"><span><b>${d[0]}</b><small>${d[5]}</small></span><em class="${d[4]}">${d[1]} · ${d[2]}</em><i class="${d[4]}" style="--p:${d[3]}"></i></div>`).join('')}
            </section>
            <section class="d4-prios" aria-label="先改这几处">
              <div class="d4-h">先改这几处<small>最多 3 条</small></div>
              ${top.map((c, i) => `<article class="d4-card"><b>${i + 1} ${c[0]}</b><small>${c[1]}</small><p><u>依据</u>「${c[2]}」</p><p><u>影响</u>${c[3]}</p><p><u>可以怎么改</u>${c[4]}</p></article>`).join('')}
            </section>
          </div>
          <details class="d4-all" open>
            <summary>全部问题（4）</summary>
            <p>1 工作经历 · 2 求职目标 · 3 项目经历 · 上面三张</p>
            <article class="d4-card"><b>4 技能</b><small>岗位关键词覆盖</small><p><u>依据</u>「熟悉办公软件。」</p><p><u>影响</u>看不出会哪些工具。</p><p><u>可以怎么改</u>写成你真的用过的软件名，例如 Excel、Word。</p></article>
          </details>
          <section class="d4-take" aria-label="带走这份报告">
            <b>带走这份报告</b>
            <span class="d4-price">免费试运营，本单 0 元</span>
            <button type="button" id="d4RepExport">导出 PDF</button>
            ${exported ? '<button data-go="confirm" data-arg="resume">打印这份报告</button><button data-act="toast" data-arg="扫码带走">扫码带走</button>' + UI.qr(4, 112) : ''}
          </section>
          <div class="d4-links">
            <button data-go="jobfit">简历对照</button>
            <button data-go="sa-intro">自我探索</button>
          </div>`,
        dock: { ask: '问小青：先改哪几处', pri: { label: '查看优化建议（4 条）', go: 'optimize' } }, nav: null, navAdvisor: 1
      });
    },
    mount: (el) => {
      const onClick = (e) => {
        if (!e.target.closest('#d4RepExport')) return;
        S().repExported = true;
        window.__proto.refresh();
      };
      el.addEventListener('click', onClick);
      return () => el.removeEventListener('click', onClick);
    }
  });

  add('optimize', '改简历', '改动清单', {
    notes: { does: '运行页 /resume/optimize 的总览（OptimizeOverview）。标题「这份简历有 N 处可以改」，N、每条模块名和原句摘要从优化结果读。这一帧 4 条是示例。', motion: '无循环动画。点胶囊只切换 aria-pressed。', keep: '统计是用改写、保留原文、只能手改、待确认事实，数字随选择变，初始是用改写 2/3、保留原文 1、只能手改 1、待确认事实 1。每条可切换的有「用改写」「保留原文」，加「打开」去 compare。项目经历这一条对不上改写，只能手改，没有那两颗胶囊。批量：全部用改写、全部保留原文、清空选择。运行页总览的第三颗是「逐条确认或自己写」；「清空全部选择」在对照页 ResumeCompareBatchBar。任务要求清单上有清空选择，所以画在这里，并在对照页不再重复。副标题两句用运行页原意。主按钮「逐条看（从第 1 条）」。次按钮「编辑简历」去 resume-edit，「回诊断报告」去 diagnosis。标识用「AI 建议稿」加上优化对照原句「AI 生成，仅供参考，请自行核对」。打开任意一条在本稿都落到 compare 的第 4 条（带未确认事实）；运行页按条号打开。' },
    render: () => F({
      band: { kind: 'compact', eyebrow: 'AI 建议稿 · AI 生成，仅供参考，请自行核对', title: '这份简历有 4 处可以改', sub: '建议只改表达，事实由你确认，随时可以保留原文。不新增学校、公司、证书、时间、薪资、获奖。', rail: { labels: RAIL.resume, now: 3 }, seal: null, place: ' ', status: { text: '逐条确认' } },
      cls: 'tight d4-fill d4-opt',
      body: `<div class="d4-stats" aria-label="当前选择">
          <span><u>用改写</u><b><i id="d4cOpt">2</i><small> / 3</small></b></span>
          <span><u>保留原文</u><b id="d4cKeep">1</b></span>
          <span><u>只能手改</u><b>1</b></span>
          <span><u>待确认事实</u><b>1</b></span>
        </div>
        <div class="d4-batch">
          <button data-d4-batch="opt"><b>全部用改写</b><small>有待确认事实的，导出前仍要逐项确认</small></button>
          <button data-d4-batch="keep"><b>全部保留原文</b><small>这几条都换回你原来的句子</small></button>
          <button data-d4-batch="clear"><b>清空选择</b><small>三条的用改写、保留原文都清掉</small></button>
        </div>
        <p class="d4-draft">选择还没写进简历，在『编辑』里生效</p>
        <div class="d4-rows">
          <div class="d4-row">
            <div class="d4-rowtx"><b>求职目标</b><small>原文：希望找一份稳定的工作。</small></div>
            <div class="d4-seg" data-d4-dec role="group" aria-label="求职目标用哪一版"><button data-act="seg" data-d4-which="opt" aria-pressed="false">用改写</button><button data-act="seg" data-d4-which="keep" aria-pressed="true">保留原文</button></div>
            <button class="d4-open" data-go="compare">打开</button>
          </div>
          <div class="d4-row">
            <div class="d4-rowtx"><b>项目经历</b><small>原文：参与迎新志愿服务。这一条只能在编辑区里改。</small></div>
            <span class="d4-hand">只能手改</span>
            <button class="d4-open" data-go="compare">打开</button>
          </div>
          <div class="d4-row">
            <div class="d4-rowtx"><b>自我评价</b><small>原文：性格开朗，学习能力强。</small></div>
            <div class="d4-seg" data-d4-dec role="group" aria-label="自我评价用哪一版"><button data-act="seg" data-d4-which="opt" aria-pressed="true">用改写</button><button data-act="seg" data-d4-which="keep" aria-pressed="false">保留原文</button></div>
            <button class="d4-open" data-go="compare">打开</button>
          </div>
          <div class="d4-row">
            <div class="d4-rowtx"><b>工作经历</b><small>原文：负责学院公众号的选题、撰写和排版。待确认：周更 2 篇</small></div>
            <div class="d4-seg" data-d4-dec role="group" aria-label="工作经历用哪一版"><button data-act="seg" data-d4-which="opt" aria-pressed="true">用改写</button><button data-act="seg" data-d4-which="keep" aria-pressed="false">保留原文</button></div>
            <button class="d4-open" data-go="compare">打开</button>
          </div>
        </div>
        <div class="d4-exits">
          <button class="btn sec" data-go="resume-edit">编辑简历</button>
          <button class="btn sec" data-go="diagnosis">回诊断报告</button>
        </div>`,
      dock: { ask: '问小青：这句还能怎么改 →', pri: { label: '逐条看（从第 1 条）', go: 'compare' } }, nav: null, navAdvisor: 1
    }),
    mount: (el) => {
      const paint = () => {
        let opt = 0, keep = 0;
        el.querySelectorAll('[data-d4-dec]').forEach((g) => {
          const on = g.querySelector('[aria-pressed="true"]');
          if (!on) return;
          if (on.dataset.d4Which === 'opt') opt += 1;
          else if (on.dataset.d4Which === 'keep') keep += 1;
        });
        const o = el.querySelector('#d4cOpt'), k = el.querySelector('#d4cKeep');
        if (o) o.textContent = String(opt);
        if (k) k.textContent = String(keep);
      };
      const onClick = (e) => {
        const b = e.target.closest('[data-d4-batch]');
        if (b) {
          const k = b.dataset.d4Batch;
          el.querySelectorAll('[data-d4-dec] button').forEach((btn) => {
            const which = btn.dataset.d4Which;
            btn.setAttribute('aria-pressed', k === 'clear' ? 'false' : String(which === k));
          });
        }
        queueMicrotask(paint);
      };
      el.addEventListener('click', onClick);
      return () => el.removeEventListener('click', onClick);
    }
  });

  add('compare', '改简历', '逐条选择', {
    notes: { does: '运行页 /resume/optimize/compare 的最后一条。标题「第 n / N 条 · 模块名」。这一帧是第 4 / 4 条 · 工作经历，用来同时看见「去编辑」和未确认的新增事实。', motion: '无循环动画。勾上事实后，「用改写」才可点。未勾时框是白底描边，整行可点。', keep: '左右是原文和改写，图例是删掉、加上、换写法。五格统计来自 ResumeOptimizeComparePage.tsx 193–195：全部 / 已采纳 / 保留原文 / 自己写 / 待定。这一帧示例数字是 4 / 2 / 1 / 0 / 1，写死，不跟当前这一条的按钮连动（当前条画的是「自己写」按下，统计里自己写仍是 0）。三个决定：用改写、保留原文、自己写。自己写展开输入，点了走屏上键盘（data-act=type），不画数字键盘。改写里的「周更 2 篇」原文没有，勾「周更 2 篇是我的真实信息」之后才能用改写；运行页复选框是「{新增内容}是我的真实信息」。上一条留在本帧提示，不假装已经翻页。最后一条没有下一条，主按钮是「去编辑」。意图带用「选择还没写进简历，在『编辑』里生效」。正文另写运行页 UNSAVED_NOTICE：「选择是阅读决策，未保存、未生成文件；返回优化页时可以选择是否应用到编辑区。只有编辑区的内容会进入导出。」不画只看改后，不去打印。批量清空在改动清单，这一页不重复。改写栏标识「AI 生成，仅供参考，请自行核对」。' },
    render: () => F({
      band: { kind: 'compact', eyebrow: '逐条选择', title: '第 4 / 4 条 · 工作经历', sub: '选择还没写进简历，在『编辑』里生效', rail: { labels: RAIL.resume, now: 3 }, seal: null, place: ' ', status: { text: '待本人选择' } },
      cls: 'tight d4-fill d4-cmp',
      body: `<div class="d4-top">
          <button class="d4-prev" data-act="toast" data-arg="上一条">上一条</button>
          <div class="d4-legend" aria-label="对照图例"><span><del>删掉</del> 删除</span><span><ins>加上</ins> 新增</span><span class="d4-swap">换写法</span><span>普通文字 保留</span></div>
        </div>
        <div class="d4-stats5" aria-label="改写选择统计"><span><u>全部</u><b>4</b></span><span><u>已采纳</u><b>2</b></span><span><u>保留原文</u><b>1</b></span><span><u>自己写</u><b>0</b></span><span><u>待定</u><b>1</b></span></div>
        <div class="d4-batch" aria-label="批量处理"><button data-act="toast" data-arg="可采纳的已全部采纳"><b>可采纳的全部采纳</b><small>跳过有待确认事实的那几条</small></button><button data-act="toast" data-arg="其余已记为保留原文"><b>其余保留原文</b><small>把还没决定的都记为保留</small></button><button data-act="toast" data-arg="已全部回到待定"><b>清空全部选择</b><small>全部回到待定</small></button></div>
        <p class="d4-draft">选择是阅读决策，未保存、未生成文件；返回优化页时可以选择是否应用到编辑区。只有编辑区的内容会进入导出。</p>
        <div class="d4-cols">
          <section class="d4-col"><b>原文</b><p>负责学院公众号的选题、撰写和排版。</p><small>摘自本次简历原文</small></section>
          <section class="d4-col d4-diff"><b>改写</b><p><del>负责</del><span class="d4-swap">独立运营</span>学院公众号的选题、撰写和排版，<ins>周更 2 篇</ins>。</p><small>AI 生成，仅供参考，请自行核对</small></section>
        </div>
        <p class="d4-metrics">字数 17 → 26 · 删除 2 字 · 新增 11 字</p>
        <label class="d4-fact"><input id="d4Fact" type="checkbox"><span>周更 2 篇是我的真实信息</span></label>
        <div class="d4-seg d4-dec" role="group" aria-label="这一条用哪一版">
          <button id="d4Use" data-act="seg" data-d4-choice="opt" aria-pressed="false" disabled>用改写</button>
          <button data-act="seg" data-d4-choice="keep" aria-pressed="false">保留原文</button>
          <button data-act="seg" data-d4-choice="custom" aria-pressed="true">自己写</button>
        </div>
        <div class="d4-custom" id="d4Custom"><b class="d4-cl">自己写这一条</b><button class="d4-ta" data-act="type">在这里写你自己的这一句</button><p class="d4-cn">这段只留在本页，刷新后不保留。要放进新简历，请回编辑区填写。</p><div class="d4-ca"><button class="btn sm mint" data-act="toast" data-arg="已用这段">用这段</button><button class="btn sm sec" data-act="toast" data-arg="已取消">取消</button></div></div>`,
      dock: { backLabel: '返回', ask: '问小青：这句还能怎么改 →', pri: { label: '去编辑', go: 'resume-edit' } }, nav: null, navAdvisor: 1
    }),
    mount: (el) => {
      const sync = () => {
        const box = el.querySelector('#d4Fact');
        const use = el.querySelector('#d4Use');
        const self = el.querySelector('[data-d4-choice="custom"][aria-pressed="true"]');
        const field = el.querySelector('#d4Custom');
        if (use && box) use.disabled = !box.checked;
        if (field) field.hidden = !self;
      };
      const onClick = () => queueMicrotask(sync);
      el.addEventListener('click', onClick);
      el.addEventListener('change', onClick);
      return () => { el.removeEventListener('click', onClick); el.removeEventListener('change', onClick); };
    }
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
    notes: { does: '运行页打印扫描服务台 PrintScanHomePage / QxPrintHubView（/print-scan）。问句用 HUB_ASK：在线「你的文件，现在在哪？」，打印机离线「这台机器出不了纸。」。', motion: '卡片依次浮入。状态只在顶部胶囊说一次。隐私长文默认折叠。', keep: '眉题「打印扫描服务」。正常胶囊「能力与设备状态以办理时确认」。离线胶囊「打印机离线 · 出纸类暂停」（printerLabel + 出纸类暂停）。意图带四步「选文件 → 材料检查 → 预览与参数 → 核对价格」，不标当前步。运行页服务台现在是三步轴，10/26 产品负责人定统一成这四步，改程序时一起改。复印卡名「复印」，说明：在打印机屏幕上点「复印」「身份证复印」或「票据复印」；不经过这台一体机下单，也不进打印订单。到机码右上胶囊「不是取件码」，说明一行「凭码办理，不登录也能核销 · 8 位数字（历史 10 位码也支持）」，带走「订单里的打印件」，右下 8 个空格，不写示例码。离线时打印文件、扫描纸质材料呈浅底虚线，徽标写原因；照片打印同样停。手机扫码上传、U 盘导入仍可进，细行「先传、稍后打印」。复印仍可点，说明「打印机离线时复印可能也用不了，以打印机屏幕为准」。到机码离线说明「这台机器现在出不了纸，核销完也拿不到纸；订单还在，请稍后再来。」底部故障句用标准句。服务电话 183-6916-1921。号码与服务时间从后台读，读不到不显示。不写换一台。彩色、双面写「本机暂未开通」。其他工具 3×2：照片打印去 print-src，照片合成 PDF，证件照去 feature-info，签名默认「本机暂未开通」，我的文档、打印订单登录后查看。反馈是当场提示，不进入要登录的意见反馈页。' },
    render: () => {
      const off = printerOff();
      const mfp = `<span class="d3-mfpmini">${UI.mfp()}</span>`;
      return F({
        band: { eyebrow: '打印扫描服务', title: off ? '这台机器出不了纸。' : '你的文件，现在在哪？', seal: 'idle', place: ' ', status: off ? { text: '打印机离线 · 出纸类暂停', warn: 1 } : { text: '能力与设备状态以办理时确认' }, rail: { labels: RAIL.print, now: -1 } },
        body: `<div class="grid2">
            ${slabMini({ i: 0, go: off ? '' : 'print-src', held: off, badge: off ? '打印机离线' : '', ic: 'printer', t: '打印文件', d: off ? '这次出不了纸' : '手机、U 盘或我的文档', take: '打印件', vis: off ? '' : UI.stack(96, 3) })}
            ${slabMini({ i: 1, go: off ? '' : 'scan-type', held: off, badge: off ? '一起停' : '', ic: 'scan', t: '扫描纸质材料', d: off ? '扫描和打印是同一台机器，<span class="d3-ext">一起停</span>' : '扫成 PDF，可以存、<span class="d3-ext">可以打</span>', take: '扫描件', vis: off ? '' : UI.scanPaper(110) })}
            ${slabMini({ i: 2, go: 'copy', ic: 'copy', t: '复印', d: off ? '打印机离线时复印可能也用不了，以打印机屏幕为准' : '在打印机屏幕上点<span class="d3-ext">「复印」</span><span class="d3-ext">「身份证复印」</span>或<span class="d3-ext">「票据复印」</span>；不经过这台一体机下单，也不进打印订单', take: '复印件', vis: mfp })}
            ${slabMini({ i: 3, go: 'pickup', badge: '不是取件码', badgeKind: 'slate', ic: 'ticket', t: '到机码核销', d: off ? '这台机器现在出不了纸，<br>核销完也拿不到纸；<br>订单还在，请稍后再来。' : '凭码办理，<br>不登录也能核销<br>· 8 位数字（历史 10 位码也<span class="d3-ext">支持）</span>', take: '订单里的打印件', vis: codeArt() })}
          </div>
          ${off ? `<div class="remind rise" style="--i:4">${icon('alert', 34, 2)}<span>这台机器暂时打不了，我们已经收到提醒，会尽快处理。你可以稍后再来；需要帮助请拨打服务电话 183-6916-1921。</span></div>` : '<p class="fine" style="margin:0">按 A4 出纸 · 彩色 / 双面 · 本机暂未开通</p>'}
          ${sec('其他工具')}
          <div class="d3-tools">
            ${off ? '<button class="tile off rise" style="--i:5" disabled><span class="ic">' + icon('image', 34, 2) + '</span><span class="tx"><b>照片打印</b><small>打印机离线</small></span></button>' : tile({ i: 5, go: 'print-src', icon: 'image', title: '照片打印', desc: '按照片出纸' })}
            ${tile({ i: 6, go: 'img2pdf', icon: 'layers', title: '照片合成 PDF', desc: '几张照片拼成一个文件' })}
            ${tile({ i: 7, go: 'feature-info', icon: 'idcard', tone: 'clay', title: '证件照', desc: '本机尚未开放 · 看说明' })}
            <button class="tile off" style="--i:8" disabled><span class="ic">${icon('pen', 34, 2)}</span><span class="tx"><b>签名</b><small>本机暂未开通</small></span></button>
            ${tile({ i: 9, go: 'my-docs', icon: 'folder', tone: 'slate', title: '我的文档', desc: '登录后查看' })}
            ${tile({ i: 10, go: 'my-orders', icon: 'receipt', tone: 'slate', title: '打印订单', desc: '登录后查看' })}
          </div>
          ${off ? `<div class="d3-pass rise" style="--i:11"><b>先传、稍后打印</b><button class="d3-mini" data-go="upload" data-arg="print">手机扫码上传</button><button class="d3-mini" data-go="usb" data-arg="print">U 盘导入</button></div>` : ''}
          ${fine('可用服务，以办理时显示为准。')}
          <div class="d3-legal">
            <details>
              <summary>隐私与电子签说明 ›</summary>
              <p>证件照、身份证等敏感文件仅用于本次打印/扫描,完成后按隐私策略自动清理,不长期留存;打印前隐私检查时,扫描件/图片可能通过第三方 OCR 服务识别文字。</p>
              <p>签名仅用于个人材料整理与打印辅助，不提供 CA 电子签、电子认证或合同签署服务；仅为图片合成预览，不具备法律认证效力，正式法律文件请通过具备资质的电子签名服务办理。</p>
            </details>
            <button class="d3-mini" data-act="toast" data-arg="不用登录也能反馈。写完留在这一页。">反馈问题</button>
          </div>`,
        cls: off ? 'print-off d3-print' : 'd3-print',
        dock: { backLabel: '上一步', ask: '问小青：怎么选打印方式 →' }, nav: 'home', navAdvisor: 1
      });
    }
  });
  function codeArt() { return `<div class="codeart" aria-hidden="true">${'<i></i>'.repeat(8)}</div>`; }
  function slabMini(o) {
    const held = !!o.held;
    const chip = o.badge ? `<span class="chip ${o.badgeKind || (held ? 'clay' : 'slate')}">${o.badge}</span>` : '';
    const attr = held && !o.go ? 'disabled' : `data-go="${o.go}"`;
    return `<button class="task rise${held ? ' d3-hold' : ''}" style="--i:${o.i}" ${attr}><div class="top"><span class="ic">${icon(o.ic, 40, 2)}</span>${chip}</div><h3>${o.t}</h3><p>${o.d}</p><div class="take">${icon('check', 24, 2.6)}带走：${o.take}</div>${o.vis ? `<div class="mini">${o.vis}</div>` : ''}</button>`;
  }

  add('print-src', '打印扫描', '文件在哪', {
    notes: { does: '运行页文档打印选文件 PrintUploadPage / FileSourceView（/print/upload）。一个问题：文件在哪。第三张大卡是纸质原件，去扫描工作台 scan-type（运行页 /scan）。我的文档收成下面的细行。', motion: '卡片依次浮入。', keep: '大小行写「手机上传不超过 10MB · U 盘不超过 15MB」。一体机隐藏本机选文件（PrintUploadPage.tsx:202-203），这一屏不写本机。能打印的文件三列：PDF、图片、Word（转换暂未开放），不留空的第 4 格。不写 HEIC。我的文档本页就能点，登录门在下一页。' },
    render: () => F({
      band: { eyebrow: '文档打印', title: '文件在哪里？', rail: { labels: RAIL.print, now: 0 }, seal: 'idle', place: ' ', status: printerOff() ? { text: '打印机离线', warn: 1 } : { text: '打印机在线' } },
      body: `${slab({ i: 0, row: 1, go: 'upload', arg: 'print', title: '手机扫码上传', desc: '不用登录、不用装软件。单份不超过 10MB', vis: UI.phone(78) })}
        ${slab({ i: 1, row: 1, go: 'usb', arg: 'print', title: 'U 盘导入', desc: '只读根目录，只读取你主动选择的文件', vis: UI.usb(120) })}
        ${slab({ i: 2, row: 1, go: 'scan-type', title: '是纸质的 · 放到打印机上扫描', desc: '扫描纸质原件，扫成 PDF 后可以存、可以打', vis: UI.scanPaper(120) })}
        <button class="rowlink rise" style="--i:3" data-go="my-docs">${icon('folder', 32, 2)}<span><b>我的文档</b> <small>· 最近打印。登录后查看</small></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button>
        <div class="fmt rise" style="--i:4"><div class="olist-t">能打印的文件</div><div class="fmtrow d3-fmt3"><span><b>PDF</b><small>.pdf</small></span><span><b>图片</b><small>.jpg  .png</small></span><span class="no"><b>Word</b><small>转换暂未开放，请另存为 PDF</small></span></div><small>手机上传不超过 10MB · U 盘不超过 15MB</small></div>
        ${fine('结束办理或闲置超时会清除本机临时信息；已上传文件按留存期限管理。')}`,
      cls: 'd3-src',
      dock: { backLabel: '上一步', ask: '问小青：这份文件怎么检查 →' }, nav: 'home', navAdvisor: 1
    })
  });
  add('pii', '打印扫描', '隐私确认', {
    notes: { does: '运行页材料检查 PrintMaterialCheckPage / MaterialCheckPresentation（打印流程第 2 步）。有命中时逐处选择遮挡或保留。示例 2 处：第 1 页身份证号（高风险）370202********2316、第 2 页手机号（中风险）138****5621。处数、页码、掩码都从检查结果读。', motion: '无循环动画。点遮挡或保留后按钮压下，没决定完主按钮保持禁用。', keep: '上方预检写「格式、大小、页数、图片清晰度已检查 · 不做 AI 判断」。未决定时写「还没决定 · 请选择保留或遮挡，下一步可以逐页核对」。计数「已决定 0 / 2 · 保留 0 处 · 遮挡 0 处」和「还有 2 处等你决定」随选择变。解释用运行页原句：「保留：这一处原样印在纸上。」「遮挡：另生成一份把这一处涂黑的文件，打印用这一份；你上传的原文件不变。」批量按钮「按风险建议处理」：高、中风险标遮挡，低风险标保留。示例两处都不是低风险，所以两处都遮挡。旁边是「全部保留」。主按钮「下一步：预览与参数」在没决定完时禁用。不印完整证件号。' },
    render: () => {
      const rows = [
        ['第 1 页 · 370202********2316', '还没决定 · 请选择保留或遮挡，下一步可以逐页核对'],
        ['第 2 页 · 138****5621', '还没决定 · 请选择保留或遮挡，下一步可以逐页核对']
      ];
      if (!Array.isArray(S().pii) || S().pii.length !== rows.length) S().pii = rows.map(() => '');
      const pick = S().pii;
      const kept = pick.filter(v => v === 'keep').length;
      const redacted = pick.filter(v => v === 'redact').length;
      const decided = kept + redacted;
      const left = rows.length - decided;
      const choice = (i, v, label) => `<button class="d3-choice" data-d3="pii" data-i="${i}" data-v="${v}" aria-pressed="${pick[i] === v ? 'true' : 'false'}">${label}</button>`;
      const stateLine = (i) => pick[i] === 'redact' ? '已选遮挡' : pick[i] === 'keep' ? '已选保留' : rows[i][1];
      return F({
        band: { kind: 'compact', eyebrow: '材料检查', title: '有 2 处要你拿主意', sub: '第 2 步 / 共 4 步 · 逐处选择遮挡或保留', rail: { labels: RAIL.print, now: 1 }, seal: null, place: ' ', status: left ? { text: `还有 ${left} 处待确认`, warn: 1 } : { text: '每一处都已决定' } },
        cls: 'd3-pii',
        body: `<div class="howto">${icon('shield', 34, 2)}<span>格式、大小、页数、图片清晰度已检查 · 不做 AI 判断</span></div>
          <div class="preview">${UI.resume(120, 'plain')}<div><b class="d3-fname">毕业生就业推荐表（已填写）<span class="d3-ext">.pdf</span></b><span>共 2 页 · 186 KB</span></div></div>
          <div class="d3-finds">${rows.map((r, i) => `<div class="d3-find"><div class="tx"><b>${r[0]}</b><small>${stateLine(i)}</small></div><div class="acts">${choice(i, 'keep', '保留')}${choice(i, 'redact', '遮挡')}</div></div>`).join('')}</div>
          <p class="d3-count">已决定 ${decided} / ${rows.length} · 保留 ${kept} 处 · 遮挡 ${redacted} 处</p>
          <p class="d3-opt">${left ? `还有 ${left} 处等你决定` : '每一处都已决定，可以去预览与参数'}</p>
          <p class="d3-opt">保留：这一处原样印在纸上。</p>
          <p class="d3-opt">遮挡：另生成一份把这一处涂黑的文件，打印用这一份；你上传的原文件不变。</p>
          <div class="d3-batch"><button class="btn sec" data-d3="pii-suggest">按风险建议处理</button><button class="btn sec" data-d3="pii-keep">全部保留</button></div>`,
        dock: { backLabel: '上一步', ask: '问小青：怎么遮挡', pri: { label: '下一步：预览与参数', go: 'preview', disabled: left > 0 } }, nav: null, navAdvisor: 1
      });
    },
    mount: (el) => {
      const on = (e) => {
        const b = e.target.closest('[data-d3]');
        if (!b || !el.contains(b)) return;
        e.stopPropagation();
        const kind = b.dataset.d3;
        if (kind === 'pii') S().pii[+b.dataset.i] = b.dataset.v;
        else if (kind === 'pii-suggest') S().pii = S().pii.map(() => 'redact');
        else if (kind === 'pii-keep') S().pii = S().pii.map(() => 'keep');
        else return;
        window.__proto.refresh();
      };
      el.addEventListener('click', on);
      return () => el.removeEventListener('click', on);
    }
  });
  add('preview', '打印扫描', '预览与设置', {
    notes: { does: '运行页预览与参数 PrintPreviewPage（打印流程第 3 步）。预览在上，份数 1–99，−10 / −1 / +1 / +10。彩色和双面本机没开通就不可点。', motion: '设置切换 120 毫秒。展开更多设置时预览缩小，避免挤出这一屏。', keep: '参数建议卡标题「按文件事实给出的参数建议」，说明「按文件页数和纸张计算；采用后仍可修改。」建议项示例「颜色 · 黑白」「单双面 · 单面」「份数 · 1 份」，按钮「采用这些建议」。双面没开通，不写「双面更省纸」，也不把建议收成双面。「双面比单面预计少用 N 张纸」只在选了双面时出现。只读「总打印面」「预计用纸」，示例 2 页 1 份单面为 2 面、2 张，随份数变。更多设置方向是自动 / 纵向 / 横向，默认自动。页码自定义输入框只在选「自定义」时出现。打印机离线时主按钮上方写「这台机器暂时打不了，需要帮助请拨打服务电话 183-6916-1921」。号码与服务时间从后台读，读不到不显示。文件名中文可以断，「.pdf」不单独掉到下一行。份数这一屏自己计 1–99。app.js 的 copies 动作仍封顶 10，这四颗按钮不走那个动作。纸张只写「A4（这台机器只打 A4）」。只读「1 版 / 页」。双面未开通，默认不出现翻页边；duplex 为 double 时出「长边翻页」「短边翻页」。' },
    render: () => {
      const p = S().print, off = printerOff();
      if (!p.orient) p.orient = 'auto';
      if (!p.scale) p.scale = 'fit';
      if (!p.rangeMode) p.rangeMode = 'all';
      if (!p.edge) p.edge = 'long';
      const more = !!S().more;
      const n = p.copies || 1;
      const pages = 2;
      const faces = pages * n;
      const sheets = p.duplex === 'double' ? Math.ceil(pages / 2) * n : pages * n;
      const save = (pages - Math.ceil(pages / 2)) * n;
      const seg = (k, v, label) => `<button data-act="pset" data-arg="${k}:${v}" aria-pressed="${p[k] === v ? 'true' : 'false'}">${label}</button>`;
      return F({
        band: { kind: 'compact', eyebrow: '预览与参数', title: '部分打印能力暂未开通', sub: '第 3 步 / 共 4 步 · 核对内容与参数，下一步看价格', rail: { labels: RAIL.print, now: 2 }, seal: null, place: ' ', status: off ? { text: '打印机离线', warn: 1 } : { text: '打印机在线' } },
        cls: 'tight d3-prev' + (more ? ' d3-more-on' : ''),
        body: `<div class="preview"><div style="display:flex;gap:24px;align-items:center">${UI.resume(more ? 96 : 150, 'plain')}<div style="display:flex;flex-direction:column;gap:8px;font-size:22px;color:var(--ink-2)"><b class="d3-fname">毕业生就业推荐表（已填写）<span class="d3-ext">.pdf</span></b><span>共 2 页 · 186 KB</span></div></div></div>
          <div class="d3-sug">
            <div class="tx"><b>按文件事实给出的参数建议</b><p>按文件页数和纸张计算；采用后仍可修改。</p><div class="d3-sug-items"><span>颜色 · 黑白</span><span>单双面 · 单面</span><span>份数 · 1 份</span></div></div>
            <button class="d3-mini" data-d3="adopt">采用这些建议</button>
          </div>
          <div class="d3-facts"><b>总打印面 ${faces} 面</b><b>预计用纸 ${sheets} 张</b></div>
          ${p.duplex === 'double' ? `<p class="d3-opt">双面比单面预计少用 ${save} 张纸</p>` : ''}
          <div class="pager"><button aria-label="上一页">${icon('chevL', 30, 2.4)}</button><span>第 1 页 / 共 2 页</span><button aria-label="下一页">${icon('chevR', 30, 2.4)}</button></div>
          <div class="params">
            <div class="prow"><span>份数</span><div class="d3-stepx"><button data-d3="copies" data-arg="-10" aria-label="少十份" ${n <= 1 ? 'disabled' : ''}>−10</button><button data-d3="copies" data-arg="-1" aria-label="少一份" ${n <= 1 ? 'disabled' : ''}>${icon('minus', 34, 2.6)}</button><output id="copies">${n}</output><button data-d3="copies" data-arg="1" aria-label="多一份" ${n >= 99 ? 'disabled' : ''}>${icon('plus', 34, 2.6)}</button><button data-d3="copies" data-arg="10" aria-label="多十份" ${n >= 99 ? 'disabled' : ''}>+10</button><span class="d3-cap">可选 1–99 份</span></div></div>
            <div class="prow"><span>颜色</span><div class="seg"><button aria-pressed="${p.color !== 'color'}">黑白</button><button disabled>彩色</button></div></div>
            <p class="why-off">彩色：本机暂未开通</p>
            <div class="prow"><span>单双面</span><div class="seg"><button aria-pressed="${p.duplex !== 'double'}">单面</button><button disabled aria-pressed="${p.duplex === 'double'}">双面</button></div></div>
            <p class="why-off">双面：本机暂未开通</p>
            ${p.duplex === 'double' ? `<div class="prow"><span>翻页</span><div class="seg">${seg('edge', 'long', '长边翻页')}${seg('edge', 'short', '短边翻页')}</div></div>` : ''}
            <div class="prow"><span>纸张</span><div class="d3-paper">A4（这台机器只打 A4）</div></div>
            <div class="prow"><span>版面</span><div class="d3-ro">1 版 / 页</div></div>
            <button class="d3-more" data-d3="more" aria-expanded="${more ? 'true' : 'false'}">更多设置<span>${more ? '收起' : '展开'}</span></button>
            ${more ? `<div class="prow"><span>方向</span><div class="seg">${seg('orient', 'auto', '自动')}${seg('orient', 'portrait', '纵向')}${seg('orient', 'landscape', '横向')}</div></div>
            <div class="prow"><span>缩放</span><div class="seg">${seg('scale', 'fit', '适合页面')}${seg('scale', 'actual', '实际大小')}</div></div>
            <div class="prow"><span>页码</span><div><div class="seg">${seg('rangeMode', 'all', '全部')}${seg('rangeMode', 'custom', '自定义')}</div>${p.rangeMode === 'custom' ? `<input class="d3-range" aria-label="自定义页码" placeholder="例如 1-3, 5" value="${esc(p.range || '')}">` : ''}</div></div>` : ''}
          </div>
          ${off ? '<p class="d3-offnote">这台机器暂时打不了，需要帮助请拨打服务电话 183-6916-1921</p>' : ''}`,
        dock: { backLabel: '上一步', ask: '问小青：选参数', pri: { label: off ? '打印机离线' : '下一步：核对价格', go: 'confirm', disabled: off } }, nav: null, navAdvisor: 1
      });
    },
    mount: (el) => {
      const on = (e) => {
        const b = e.target.closest('[data-d3]');
        if (!b || !el.contains(b)) return;
        e.stopPropagation();
        if (b.dataset.d3 === 'copies') {
          const n = Math.min(99, Math.max(1, (S().print.copies || 1) + (+b.dataset.arg)));
          S().print.copies = n;
          window.__proto.refresh();
        } else if (b.dataset.d3 === 'more') {
          S().more = !S().more;
          window.__proto.refresh();
        } else if (b.dataset.d3 === 'adopt') {
          S().print.copies = 1;
          S().print.color = 'bw';
          S().print.duplex = 'single';
          window.__proto.refresh();
        }
      };
      const onInput = (e) => { if (e.target.classList && e.target.classList.contains('d3-range')) S().print.range = e.target.value; };
      el.addEventListener('click', on);
      el.addEventListener('input', onInput);
      return () => { el.removeEventListener('click', on); el.removeEventListener('input', onInput); };
    }
  });

  add('confirm', '打印扫描', '核对并打印', {
    notes: { does: '运行页核对价格 PrintConfirmPage。直接打开这一屏时 S.ctx 默认是简历来路，示例走简历是正常的。本屏画的是 0 元单：核对打印内容，确认后直接打印。', motion: '无循环动画。', keep: '只有这一态写「免费试运营，本单 0 元」。不逐行改，退回用「返回修改」。问小青写「问小青：核对这单」，避免被截断。打印机离线时按钮写「打印机离线」。另外三种状态本屏不画，运行页有：非 0 元才有权益，核销失败时按钮是「去我的权益 / 按实际原价继续」（PrintConfirmPage.tsx:600-603）。本机没开通的彩色或双面会改成黑白或单面再报价，并逐项说明。同一份交接已经建过单时不再建第二单，已建单那一屏给「我的打印订单」和「回到这一单」。' },
    render: () => {
      const p = S().print, ctx = S().ctx, off = printerOff();
      const name = ctx === 'report' ? '面试练习报告-新媒体运营.pdf' : ctx === 'resume' ? '李佳怡-简历（改后）.pdf' : ctx === 'policy' ? '材料清单-高校毕业生一次性求职创业补贴.pdf' : '毕业生就业推荐表（已填写）.pdf';
      const pages = ctx === 'report' ? 2 : ctx === 'resume' || ctx === 'policy' ? 1 : 2;
      const sheets = p.duplex === 'double' ? Math.ceil(pages / 2) * p.copies : pages * p.copies;
      const art = ctx === 'report' ? UI.report(300) : ctx === 'policy' ? UI.checklist(300) : UI.resume(300, ctx === 'resume' ? 'fixed' : 'plain');
      return F({
        band: { eyebrow: '核对价格', title: '确认打印', rail: { labels: RAIL.print, now: 3 }, seal: null, place: ' ', status: off ? { text: '打印机离线', warn: 1 } : { text: '打印机在线' } },
        cls: 'even d3-confirm',
        body: `<div class="confgrid rise" style="--i:0"><div class="cthumb">${art}<span>第 1 页</span></div>
          <div class="sumcard">
            <div class="r"><span>文件</span><b>${name}</b><span></span></div>
            <div class="r"><span>页数</span><b>${pages} 页 × ${p.copies} 份</b><span></span></div>
            <div class="r"><span>设置</span><b>${p.color === 'bw' ? '黑白' : '彩色'} · ${p.duplex === 'double' ? '双面' : '单面'} · A4</b><span></span></div>
            <div class="r"><span>用纸</span><b>${sheets} 张</b><span></span></div></div></div>
          <div class="fee rise" style="--i:1"><div><b>费用</b><div style="font-size:22px;color:var(--ink-2)">免费试运营，本单 0 元</div></div><span class="num">0 元</span></div>
          <div class="remind rise" style="--i:2;background:var(--teal-wash);color:var(--teal-ink)">${icon('printer', 34, 2)}<span>提交后请留在机器旁，任务确认后自动开始打印。</span></div>
          ${fine('隐私检查仅用于本次打印前确认，扫描件 / 图片可能经第三方 OCR 识别文字。')}`,
        dock: { backLabel: '返回修改', ask: '问小青：核对这单', pri: { label: off ? '打印机离线' : '确认并打印', go: 'printing', kind: 'pri wide', disabled: off } }, nav: null, navAdvisor: 1
      });
    }
  });
  add('printing', '打印扫描', '出纸中', {
    notes: { does: '运行页打印进度。进页先说正在确认任务状态。只有服务端回报正在打印才写正在出纸。', motion: '插画只保留机身，不做出纸动画，不自己走到完成。', keep: '四段是提交任务、排队等待、打印中、完成取件。当前段是「提交任务」，完成段在进行中不点亮。说明「纸从打印机出纸口出来。超过 45 秒没有新进度，这里会说明下一步怎么办。」文件卡写「2 张 · 黑白 · 单面 · 1 份」和订单号 ORD-20261026-0418，都从这一单读。底部导航中间一项是「AI 顾问」。' },
    render: () => F({
      band: { kind: 'compact', eyebrow: '打印进度', title: '正在确认任务状态', sub: '任务已提交，正在读取终端状态，请留在机器旁', seal: null, place: ' ', status: { text: '正在确认任务状态' } },
      cls: 'printing d3-printing',
      body: `<div class="d3-psec"><b>打印进度</b><span>状态来自打印服务，每 3 秒更新</span></div>
        <div class="d3-psteps" id="pst"><div class="s on"><span class="n">1</span><b>提交任务</b><em>完成</em><small>已创建打印任务，本次无需支付</small></div><div class="s now"><span class="n">2</span><b>排队等待</b><em>确认中</em><small>正在确认这台机器有没有领到任务</small></div><div class="s"><span class="n">3</span><b>打印中</b><em>未开始</em><small>终端开始打印后才会出纸</small></div><div class="s"><span class="n">4</span><b>完成取件</b><em>未开始</em><small>确认完成后自动转到取件核对</small></div></div>
        <div class="printer-wrap"><div class="printer">${UI.mfp()}</div></div>
        <p class="d3-pend">任务还没打完，完成后才能结束清空。这一页不会自己报成功。</p>
        <p class="fine" id="pmsg">纸从打印机出纸口出来。超过 45 秒没有新进度，这里会说明下一步怎么办。</p>
        <div class="filecard"><span class="ft">PDF</span><div><b class="d3-fname">毕业生就业推荐表（已填写）<span class="d3-ext">.pdf</span></b><small>2 张 · 黑白 · 单面 · 1 份 · 订单号 ORD-20261026-0418</small></div></div>`,
      dock: { back: false, ask: '问小青：取纸或异常怎么办' }, nav: null, navAdvisor: 1
    })
  });

  add('done', '打印扫描', '取件', {
    notes: { does: '运行页打印完成 PrintDonePage。打好了先核对，再从出纸口取走。「我拿走了，结束使用」按一下就结束本次使用（10/26 产品负责人定；运行页现在是两步 endArmed「再按一次，确认结束使用」，改程序时改成一步）。倒计时 60 秒，点屏幕重置。', motion: '对勾保留。圆环按 60 秒走，点屏幕回到 60。', keep: '意图带副题「文件已从出纸口送出，请核对页数后取走」，不和卡片标题复读。次按钮「再印一份」。本屏是 0 元单，小字「重新选文件后再确认。免费试运营。」到机码来的单改成一句「要再打一份请在手机上重新下单」。收费单小字「重新选文件、核对价格后再付款。」页脚「不再点屏幕，60 秒后结束本次使用；点一下屏幕重新计时」。60 秒是这一页的真值，不是结果页闲置的 1 分 30 秒。查看打印订单、使用帮助、反馈问题仍在。反馈是当场提示，不进入要登录的意见反馈页。已登录写「这单在手机『我的 → 打印订单』里能看到」（只有 hasEndUser 为真才显示；小程序发布前这句不显示）。未登录写「本次打印未关联账号」。服务电话 183-6916-1921。号码与服务时间从后台读，读不到不显示。问小青「问小青：怎么取纸」。' },
    render: () => F({
      band: { eyebrow: '打印完成', title: '都打好了，拿走前核一下', sub: '文件已从出纸口送出，请核对页数后取走', sealHtml: `<svg class="big-check" viewBox="0 0 150 150" style="width:130px;height:130px;flex:none" aria-hidden="true"><circle cx="75" cy="75" r="68" fill="none" stroke="#2ee6a8" stroke-width="7"/><path d="M46 77l20 20 40-42" fill="none" stroke="#2ee6a8" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>`, place: ' ', status: { text: '已在本机出纸' } },
      cls: 'even d3-done',
      body: `<div class="takebox rise" style="--i:0"><div>${UI.stack(200, 2, '')}</div><div class="tt"><b>从出纸口取走</b><span>拿走前记得核一下页数。</span></div></div>
        <div class="tray-arrow">${icon('arrowD', 72, 2.4)}<span>出纸口在下面</span></div>
        <p class="d3-dest">${S().logged ? '这单在手机『我的 → 打印订单』里能看到' : '本次打印未关联账号'}</p>
        <div class="tiles3">
          ${tile({ go: 'my-orders', icon: 'receipt', title: '查看打印订单', desc: '这一单的记录' })}
          ${tile({ go: 'help', icon: 'help', title: '使用帮助', desc: '常见问题、服务电话' })}
          ${tile({ act: 'toast', arg: '不用登录也能反馈。写完留在这一页。', icon: 'message', tone: 'slate', title: '反馈问题', desc: '不用登录也能写' })}
        </div>
        <button class="btn sec" data-go="print-src" style="height:80px">再印一份</button>
        <p class="fine" style="margin-top:-6px">重新选文件后再确认。免费试运营。</p>
        ${fine('需要帮助？拨打服务电话 183-6916-1921。不再点屏幕，60 秒后结束本次使用；点一下屏幕重新计时。')}`,
      dock: { back: false, ask: '问小青：怎么取纸', left: `<div class="cdring">${UI.ring(1, 96, 8)}<b id="cd">60</b></div>`, mid: `<button class="btn danger wide" id="endUse" style="flex:1">${icon('erase', 32, 2.2)}我拿走了，结束使用</button>` }, nav: null, navAdvisor: 1
    }),
    mount: (el) => {
      let n = 60, stopped = false;
      const b = el.querySelector('#cd'), arc = el.querySelector('.cdring .arc'), end = el.querySelector('#endUse');
      const C = parseFloat(arc.getAttribute('stroke-dasharray'));
      const paint = () => { b.textContent = String(n); arc.setAttribute('stroke-dashoffset', String(C * (1 - n / 60))); };
      paint();
      const t = setInterval(() => { if (stopped) return; n -= 1; paint(); if (n <= 0) { stopped = true; clearInterval(t); window.doClear(); } }, 1000);
      const onDown = () => { if (!stopped) { n = 60; paint(); } };
      const onClick = (e) => {
        if (!end || !end.contains(e.target)) return;
        e.stopPropagation();
        stopped = true;
        window.doClear();
      };
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('click', onClick);
      return () => { clearInterval(t); el.removeEventListener('pointerdown', onDown); el.removeEventListener('click', onClick); };
    }
  });
  add('unconfirmed', '打印扫描', '结果未确认', {
    notes: { does: '运行页 /print/done 未确认态（PRINT_JOB_UNCONFIRMED）。和状态样式板 st-unconfirmed 是同一个运行页状态，render 直接复用那一屏。', motion: '三步静止展开。不做成功对勾，也不做倒计时演完自动结束。', keep: '版式与 st-unconfirmed 一致，说明栏各自保留。眉题「打印结果」，大标题「这次打印结果未确认。」，副句「系统已明确登记，等待人工核查」，胶囊「打印结果未确认」。三步见那一屏。服务电话只出现在第 3 步，示例号 183-6916-1921。号码与服务时间从后台读，读不到不显示。底部返回位「返回首页」。内容区「查看订单说明」「反馈问题」。主按钮「使用帮助」（运行页主按钮是现场核查口径，本屏改成使用帮助）。问小青「取纸或异常怎么办」。「查看打印订单」是细行，登录后才有本人订单。底部小字「这次结果已登记，等待人工核查；订单保留。」订单号从这一单读，示例 ORD-20261026-0418。' },
    render: () => {
      const st = (window.SCREENS || []).find((s) => s.id === 'st-unconfirmed');
      return st ? st.render() : '';
    }
  });
  add('pickup', '打印扫描', '输入到机码', {
    notes: { does: '运行页到机码核销 PrintPickupClaimPage。屏上数字键盘输入到机码，输满后确认校验。键盘下方有「历史 10 位码」切换和「用扫码枪扫」说明。', motion: '每输一位格子亮起；码不对时格子左右轻晃两下（320 毫秒）。', keep: '胶囊「到机码验证」（PrintPickupClaimPage.tsx:283）。不写演示口令，不把说明卡上的数字画成可核销的码。不引导未发布的小程序路径。原句「这一步不收钱 · 输错可以改，不作废」放在键盘下方。历史码运行页是「输入历史码」，10 位，字母不含 0、O、1、I、L，按钮「← 回到 8 位新码键盘」。整副字母键盘会挤出这一屏，只做 10 格切换和一行说明，数字键仍可输入。app.js 的 key 动作把长度封在 8，历史码这一态在本屏截下按键，自己计到 10 位。扫码说明用运行页原句：不用手输，把手机上的码对准机身侧面的扫码区；手机亮度调高，再凑近扫码区（PrintPickupClaimPage.tsx:473-475）。点「用扫码枪扫」在说明卡里展开这句，不另加一块高度。' },
    render: () => {
      const legacy = !!S().legacy, hid = !!S().hid, n = legacy ? 10 : 8;
      return F({
        band: { kind: 'compact', eyebrow: '到机码核销', title: legacy ? '输入历史码' : '输入你的到机码', rail: { labels: RAIL.pick, now: 0 }, seal: null, place: ' ', status: { text: '到机码验证' } },
        cls: 'tight',
        body: `<div class="codebox${legacy ? ' d3-code10' : ''}" id="codebox">${'<i></i>'.repeat(n)}</div>
          <p class="fine" id="codeMsg" style="margin:0"></p>
          <div class="codehint rise" style="--i:1"><div class="phonemock" aria-hidden="true"><div class="pm-top">打印订单</div><div class="pm-card"><small>到机码</small><b></b><span></span></div><div class="pm-line"></div><div class="pm-line s"></div></div>
            <div class="ch-tx">${hid ? '<b>用扫码枪扫</b><span>不用手输：把手机上的码，对准机身侧面的扫码区。手机亮度调高，再凑近扫码区。</span>' : '<b>对着屏幕上的格子输入</b><span>输满后核对订单；有效性以校验结果为准。</span>'}</div></div>
          <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => `<button data-act="key" data-arg="${d}">${d}</button>`).join('')}<button class="fn" data-act="key" data-arg="clr">清空</button><button data-act="key" data-arg="0">0</button><button class="fn" data-act="key" data-arg="del">删一位</button></div>
          <div class="d3-pickrow">
            <button class="d3-mini" data-d3="legacy" aria-pressed="${legacy ? 'true' : 'false'}">${legacy ? '← 回到 8 位新码键盘' : '历史 10 位码'}</button>
            <button class="d3-mini" data-d3="hid" aria-pressed="${hid ? 'true' : 'false'}">用扫码枪扫</button>
          </div>
          ${legacy ? '<p class="d3-note2">历史码 10 位，字母不含 0、O、1、I、L。这一屏不铺整副字母键盘。</p>' : ''}
          <p class="fine">这一步不收钱 · 输错可以改，不作废</p>`,
        dock: { ask: '问小青：到机码怎么找 →', pri: { label: '确认校验', act: 'code', id: 'codeGo', disabled: true } }, nav: null, navAdvisor: 1
      });
    },
    mount: (el) => {
      S().code = '';
      const paint = () => {
        const boxes = el.querySelectorAll('#codebox i');
        boxes.forEach((box, i) => { box.textContent = S().code[i] || ''; box.classList.toggle('cur', i === S().code.length); });
        const g = el.querySelector('#codeGo');
        if (g) g.disabled = S().code.length !== (S().legacy ? 10 : 8);
      };
      const on = (e) => {
        const d3 = e.target.closest('[data-d3]');
        if (d3 && el.contains(d3)) {
          e.stopPropagation();
          if (d3.dataset.d3 === 'legacy') { S().legacy = !S().legacy; S().code = ''; }
          else S().hid = !S().hid;
          window.__proto.refresh();
          return;
        }
        if (!S().legacy) return;
        const keyBtn = e.target.closest('[data-act="key"], #codeGo');
        if (!keyBtn || !el.contains(keyBtn)) return;
        e.stopPropagation();
        if (keyBtn.id === 'codeGo') {
          if (S().code.length !== 10) return;
          if (S().code === '0000000000') {
            const cb = el.querySelector('#codebox');
            cb.classList.remove('shake'); void cb.offsetWidth; cb.classList.add('shake');
            el.querySelector('#codeMsg').innerHTML = '<span style="color:var(--cinnabar);font-weight:700">这个码不对，请核对后重输</span>';
            S().code = ''; paint();
          } else window.go('pickup-ok');
          return;
        }
        const arg = keyBtn.dataset.arg;
        if (arg === 'clr') S().code = '';
        else if (arg === 'del') S().code = S().code.slice(0, -1);
        else if (S().code.length < 10) S().code += arg;
        paint();
      };
      el.addEventListener('click', on, true);
      return () => el.removeEventListener('click', on, true);
    }
  });
  add('pickup-ok', '打印扫描', '核对订单', {
    notes: { does: '运行页验码成功 pickupClaimModel / PrintPickupClaimPage。按订单状态换主按钮。本屏默认画未付款：主按钮「进入现场支付」，去收银台。', motion: '订单卡浮入。', keep: '胶囊「到机码验证」。摘要写订单号和「文件名 · 金额」，示例「订单号 ORD-20261026-0418」「毕业生就业推荐表（已填写）.pdf · 金额 2.00 元」。订单号、文件名、金额从订单读，示例不代表价目。不写订单归属人和下单时间。「不是我的订单，重新输入」和底部返回重复，只留底部「重新输入」。其余几态的标题：已完成「这一单已经打印完成」、正在出纸「正在出纸」、排队「已进入打印队列」、没打成「这一单没有打成」。没打成那态运行页是现场联系口径，本屏按无人值守写成「需要帮助？拨打服务电话 183-6916-1921」。号码与服务时间从后台读，读不到不显示。排队或正在出纸时主按钮「查看打印进度」；已完成时「查看打印结果」。未支付不直接出纸。' },
    render: () => {
      const st = S().pickupState || 'unpaid';
      const pri = st === 'queued' || st === 'printing'
        ? { label: '查看打印进度', go: 'printing', kind: 'pri wide' }
        : st === 'done'
          ? { label: '查看打印结果', go: 'done', kind: 'pri wide' }
          : { label: '进入现场支付', go: 'cashier', kind: 'pri wide' };
      const sub = st === 'done'
        ? '这笔订单已经打完。'
        : st === 'queued' || st === 'printing'
          ? '这笔订单在排队或正在出纸。'
          : '这笔订单还没支付。付款成功后才会开始打印，不会提前出纸。';
      return F({
        band: { kind: 'compact', eyebrow: '到机码核销', title: '订单核验成功', sub, rail: { labels: RAIL.pick, now: 1 }, seal: null, place: ' ', status: { text: '到机码验证' } },
        cls: 'even d3-ok',
        body: `<div class="confgrid rise" style="--i:0"><div class="cthumb">${UI.stack(360, 3, '')}</div><div class="d3-okside"><div class="sumcard"><div class="r"><span>订单号</span><b>ORD-20261026-0418</b></div><div class="r"><span>文件</span><b>毕业生就业推荐表（已填写）<span class="d3-ext">.pdf</span></b></div><div class="r"><span>金额</span><b class="d3-amt">2.00 元</b></div></div></div></div>
          <div class="d3-oknote rise" style="--i:2">${icon('refresh', 34, 2)}<span><b>同一个到机码可以接着打</b>没打完？回到出纸失败的那台机器上，再输一次同一个到机码就能接着打，每单最多 2 次。</span></div>
          <div class="process rise" style="--i:1">${(st === 'done' ? [['check', '订单已核对'], ['printer', '已经出纸'], ['eye', '查看打印结果']] : st === 'queued' || st === 'printing' ? [['check', '订单已核对'], ['clock', '排队或正在出纸'], ['eye', '查看打印进度']] : [['check', '订单已核对'], ['receipt', '去收银台现场支付'], ['printer', '支付完成开始打印']]).map((p, k) => `<div class="ps"><span class="n">${k + 1}</span><span class="pi">${icon(p[0], 34, 2)}</span><b>${p[1]}</b></div>`).join(`<span class="pa">${icon('arrowR', 28, 2.4)}</span>`)}</div>`,
        dock: { backLabel: '重新输入', ask: '问小青：码在哪', pri }, nav: null, navAdvisor: 1
      });
    }
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
