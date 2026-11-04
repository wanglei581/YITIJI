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
    notes: { does: '运行页 /screensaver，在 KioskRoot 外。点位名和宣传素材从后台读；读不到点位名时用「就业服务大厅」，这句话只写在 notes，屏上不解释点位名从哪来。', motion: '有素材时 6 秒换一张，只动 opacity。轻触整屏回首页。', keep: '屏上示例只标小胶囊「示例」。读取中、暂无素材用本区状态留下，运行页空或失败会直接回首页。页脚只有边界句。本屏不报打印机。' },
    demo: [{ label: '演示：暂无素材', ev: 'noads' }, { label: '演示：正在读取', ev: 'loading' }, { label: '演示：素材回来了', ev: 'ads' }],
    render: () => window.FP.standby(),
    mount: (el) => window.FP.mountStandby(el)
  });

  add('home', '公共', '首页', {
    before: 'home',
    notes: { does: '运行页首页 QxHomeView（/）。只回答两件事：这里能办什么、从哪开始。问小青是纸面上的第一主操作。身份与状态在页脚边界句上方（下按区）。继续上次在问小青和四张大卡之间，对应 ContinuePanel。', motion: '光带缓慢流动；四张卡依次浮入（每张晚 45 毫秒）；按下缩小 2%。', keep: '四项主任务与第三行三块不变，底部导航中间一项是「AI 顾问」。AI 角标写能力词。岗位、招聘会入口不出现（托管 a）。清除时长用普通页 3 分钟，结果页 1 分 30 秒。打印机正常写「打印机在线」。不显示姓名和手机号，不写「进入我的」。官方渠道只在本机构渠道数大于 0 时出现，为 0 时这一行只剩两块。百宝箱、智慧校园只在机构开通时出现在这一行（S().controlsOn，地址 ?ctrl=1）。开通后第三行改成两行五块：百宝箱去 toolbox，说明「按本机已上架的扩展服务进入」，带走「进入已开通的服务」，徽标「受控开放」；智慧校园去 smart-campus，说明「按本机开通范围进入校园服务」，带走「进入校园服务」，徽标「受控开放」。五块的字号和卡片最小高度不缩，高度从四张大卡的最小高度里匀。未开通时仍是现在这三块。语音没开（构建变量 VITE_USE_TRTC_CALL 不为 true）时文案是「问小青：打一句你想办的事」且不画麦克风；为 true 时才是说话入口并画麦克风。本屏按没开画。收费点位页脚多一句「收费以现场公示为准」（两边单价都读到、且有一边大于 0 才加；读不到不写，也不写免费）。继续上次只在已登录、并且有进行中的打印订单（pending / claimed / printing）或已诊断未优化的简历时出现，接口失败当没有。运行页打印标题是「打印任务进行中」，副行是「文件名 · 状态」，按钮「查看进度」去 /me/print-orders（本屏 my-orders）。示例文件名「毕业生就业推荐表（已填写）.pdf」，状态按进行中写成「正在打印」。简历那条是「上次诊断的简历，可继续优化」，按钮「去优化」。未登录不出现这条。已登录两行大卡最小高度约 300px，字号和小样与未登录相同。练面试说明只用「回答常见问题，当场看反馈，不做录用判断」。未登录左边原文「这台机器上没有待继续的办理 · 不会显示上一位的资料」；已登录左边「有人登录着」（不是按钮），「结束上一位的使用」走清除，「设备状态」去 offline 屏。私有化版（说明栏「显示私有化版页面」）：第三行把「本机构官方渠道」换成「社会招聘」「校园招聘」两块，去 b-social、b-campus；运行页 QxHomeView 在 recruitmentOpen 时是「岗位信息」「招聘会」两块，改程序时按这次的分法改名重排；页脚那句换成运行页 recruitmentOpen 时的原句。我方云上（默认）不出现这两块。' },
    render: () => {
      const logged = !!S().logged;
      const T = (o) => `<button class="task ${o.dark ? 'dark' : ''} rise" style="--i:${o.i}" data-go="${o.go}">
        <div class="top"><span class="ic">${icon(o.ic, 40, 2)}</span><span class="chip ${o.ck || ''} ${o.ai ? 'ai' : ''}">${o.chip}</span></div>
        <h3>${o.t}</h3><p>${o.d}</p><div class="take">${icon('check', 24, 2.6)}${o.take}</div><div class="mini">${o.vis}</div></button>`;
      return `<header class="band hero flowing${S().controlsOn || S().showB ? ' fm-hero' : ''}">${UI.flowLines(700)}<div class="halo"></div>${UI.header({ back: false, place: '就业服务大厅', status: printerOff() ? { text: '打印机离线', warn: 1 } : { text: '打印机在线' } })}
        <div class="greet">${UI.seal('idle', 'xl')}<div><div class="eyebrow" data-greet>下午好</div><h1>我是小青</h1><p>今天想办哪件事？下面选一项，或者直接问我</p></div></div></header>`
        + `<button class="xq-bar rise" style="--i:0" data-go="xq"><span class="orb">${icon('message', 46, 2.2)}</span><span><b>问小青：打一句你想办的事</b><small></small></span><span class="chip ai">AI 数字人</span></button>`
        + `<main class="body d3-home${logged ? ' d3-on' : ''}${S().controlsOn || S().showB ? ' fm-x' : ''}">
          ${logged ? `<div class="d3-go rise" style="--i:0"><span class="ic">${icon('printer', 32, 2)}</span><span class="tx"><b>打印任务进行中</b><small>毕业生就业推荐表（已填写）.pdf · 打印中</small></span><button class="d3-mini" data-go="my-orders">查看进度</button></div>` : ''}
          <div class="grid2 tasks">
            ${T({ i: 1, go: 'resume', ic: 'file', chip: 'AI 诊断改写', ai: 1, t: '改简历', d: '上传或扫描，诊断、优化或生成新简历，<br>改不改你定', take: '带走：新简历', vis: UI.resume(150, 'annot') })}
            ${T({ i: 2, go: 'interview', ic: 'mic', chip: 'AI 模拟面试', ai: 1, t: '练面试', d: '回答常见问题，当场看反馈，不做录用判断', take: '带走：面试反馈', vis: UI.report(150) })}
            ${T({ i: 3, go: 'print', dark: 1, ic: 'printer', chip: printerOff() ? '打印机离线' : '先选材料再出纸 · 带走：打印件', ck: printerOff() ? 'clay' : 'ghost', t: '打印 · 扫描', d: '手机扫码传文件、插 U 盘，或扫描原件', take: '开始选择材料', vis: UI.stack(132, 3) })}
            ${T({ i: 4, go: 'policy', ic: 'landmark', chip: '官方发布', ck: 'slate', t: '查政策', d: '补贴、社保怎么办，要带哪些材料，以官方发布为准', take: '查看政策说明', vis: UI.checklist(150) })}
          </div>
          <div class="tiles3${({ 4: ' fm-home4', 5: ' fm-home5', 6: ' fm-home6' })[3 + (S().showB ? 1 : 0) + (S().controlsOn ? 2 : 0)] || ''}">
            ${tile({ i: 5, go: 'pickup', icon: 'ticket', title: '到机取件', desc: '手机上下了单，来这里取' })}
            ${S().showB ? tile({ i: 6, go: 'b-social', icon: 'clipboard', tone: 'slate', title: '社会招聘', desc: '全职、兼职岗位和社会招聘会' }) + tile({ i: 6, go: 'b-campus', icon: 'book', tone: 'slate', title: '校园招聘', desc: '校园招聘会、校招和实习岗位' }) : tile({ i: 6, go: 'official', icon: 'qr', tone: 'slate', title: '本机构官方渠道', desc: '公众号、官网，扫码看' })}
            ${tile({ i: 7, go: 'help', icon: 'help', tone: 'clay', title: '帮助', desc: '常见问题、服务电话' })}
            ${S().controlsOn ? tile({ i: 8, go: 'toolbox', icon: 'layers', title: '百宝箱', desc: '按本机已上架的扩展服务进入' }) + tile({ i: 9, go: 'smart-campus', icon: 'landmark', tone: 'slate', title: '智慧校园', desc: '按本机开通范围进入校园服务' }) : ''}
          </div>
          <div class="d3-id">
            <p class="d3-note">${logged ? '有人登录着' : '这台机器上没有待继续的办理 · 不会显示上一位的资料'}</p>
            <div class="d3-acts">
              ${logged ? '<button class="d3-mini d3-cin" data-act="clear">结束上一位的使用</button>' : '<button class="d3-mini" data-go="login">登录后查看本人记录</button>'}
              <button class="d3-mini" data-go="offline">设备状态</button>
            </div>
          </div>
          <div class="footline rise" style="--i:8"><p class="fine">AI 生成的内容都会标明，仅供参考 · ${S().showB ? '岗位与招聘会仅展示第三方或官方来源，本终端只展示与跳转、不代收简历' : '本机不替你投递'} · 离开 3 分钟无操作自动退出登录 · 打开本人文档、诊断报告或优化结果后 1 分 30 秒无操作自动退出</p><span class="icp">鲁ICP备2026023517号-2 · 鲁公网安备37021402007308号</span></div>
        </main>` + nav('home').replace('<span>问小青</span>', '<span>AI 顾问</span>');
    }
  });

  add('xq', '公共', '问小青', {
    notes: { does: '运行页 /assistant。默认四主题，上面一行「最近办理 · 模拟面试 · HR 面试 5 分钟」标「示例」，可点去 iv-1。子入口在「这一主题还能去哪」。面试主题的动作去 iv-1。职场主题「政策服务」去 policy，「政策与材料说明」去 policy-list。手动入口去 print、help、policy、resume。投诉去 feedback。回答只在演示事件 done 之后出现一轮。', motion: '发送后停在等待。不倒计时演成功。语音开关关闭，不画麦克风和通话。', keep: 'AI 不可用时照 st-ai-down：四条手动入口仍在，重新检查和投诉在底栏，重新检查不把 AI 写成已恢复。岗位主题写「本终端未开放岗位与招聘会信息」。回复旁标「AI 生成，仅供参考」。未登录保存去 login。出错留在本屏重试。号码与服务时间从后台读，读不到不显示。' },
    demo: [{ label: '演示：键盘已写入', ev: 'typed' }, { label: '演示：生成好了', ev: 'done' }, { label: '演示：这一轮没连上', ev: 'fail' }, { label: '演示：不是 AI 回复', ev: 'notai' }, { label: '演示：检查仍不可用', ev: 'still' }],
    render: () => window.FP.xq(),
    mount: (el) => window.FP.mountXq(el)
  });
  add('help', '公共', '帮助', {
    notes: { does: '运行页 /help。分类是页内常量。托管 a 下岗位类 0 条，不画。政策分类的入口去 policy-list（运行页 /renshi?tab=policy），不是政策枢纽 policy。其余入口去 login（带来源）、settings、resume-src、print-src、scan-type、official、my-docs、legal。设备状态去 offline。', motion: '无循环。重新打开只增加「已重新打开」的次数，不假装内容已经回来。', keep: '去掉离开秒数和出纸口位置。不可用、分类对不上留在本屏。问小青仍在。备案号是一体机上的文字。号码与服务时间从后台读，读不到不显示。' },
    demo: [{ label: '演示：帮助没显示', ev: 'down' }, { label: '演示：没有这个分类', ev: 'miss' }, { label: '演示：帮助回来了', ev: 'ok' }],
    render: () => window.FP.help(),
    mount: (el) => window.FP.mountHelp(el)
  });
  add('official', '公共', '本机构官方渠道', {
    notes: { does: '运行页 /official-channels。状态 loading、items、empty、error。渠道名、域名、二维码从本机构配置读。空态去问小青、帮助、回首页。默认不分组，只列通用渠道。S().fpGroup（地址 !fpGroup=1）才按面向对象分组。', motion: '核对只改本屏说明。重新读取进入读取中，结果等演示事件。', keep: '屏上示例只标小胶囊「示例」，不写岗位数、企业名，也不出现「校园招聘」「社会招聘」「招聘」。默认一张清单。改程序时：官方渠道加一个『面向对象』字段（面向高校毕业生 / 面向社会求职者 / 通用，默认通用），机构端添加渠道的弹窗加一个选择，一体机按它分组；都没选（全是通用）就不分组，跟现在一样。二维码直接编码机构已核验官方域名的链接，不经过我方域名中转。约 1–2 人日、约 10 个文件（对照 out-F-jobs.md 第 5 节）。核对成功不写成已经确认还在。方向探索去 xq 并带 career_explore。托管关闭时的招聘说明页不是这一屏。本屏不报打印机。号码与服务时间从后台读，读不到不显示。' },
    demo: [{ label: '演示：正在读取', ev: 'load' }, { label: '演示：没有渠道', ev: 'empty' }, { label: '演示：读取失败', ev: 'error' }, { label: '演示：渠道回来了', ev: 'items' }, { label: '演示：核对没确认', ev: 'recheck' }, { label: '演示：核对通过', ev: 'recheck-ok' }, { label: '演示：撤下一条', ev: 'withdraw' }, { label: '演示：机构给渠道选了面向对象（按组显示 / 恢复不分组）', ev: 'group' }],
    render: () => window.FP.official(),
    mount: (el) => window.FP.mountOfficial(el)
  });
  add('login', '公共', '登录', {
    notes: { does: '运行页 /login。默认手机号；短信不可用、码过期、扫码是另外的态。成功只由演示事件 code-ok 或 scan-ok 触发，回到 S().fpFrom，没有就去 me。', motion: '不走 60 秒和 180 秒的表，也不把秒数走完演成登录成功。', keep: '必须先勾选协议。重发 60 秒，票据 180 秒。不登录能去 print、pickup、policy。发送失败去 help。键盘是系统界面。扫码页可打开 phone-login，运行时那一页在手机上。号码与服务时间从后台读，读不到不显示。' },
    demo: [{ label: '演示：键盘已写入', ev: 'typed' }, { label: '演示：验证码已发出', ev: 'sent' }, { label: '演示：验证码已填', ev: 'coded' }, { label: '演示：核验通过', ev: 'code-ok' }, { label: '演示：改用扫码', ev: 'scan' }, { label: '演示：扫码已确认', ev: 'scan-ok' }, { label: '演示：码过期', ev: 'expired' }, { label: '演示：短信不可用', ev: 'sms' }],
    render: () => window.FP.login(),
    mount: (el) => window.FP.mountLogin(el)
  });
  add('me', '公共', '我的', {
    notes: {
      get does() { return window.FE.notes['me'].does; },
      get motion() { return window.FE.notes['me'].motion; },
      get keep() { return window.FE.notes['me'].keep; },
    },
    demo() { return window.FE.demo('me'); },
    render() { return window.FE.page('me'); },
    mount(el) { return window.FE.mount(el, 'me'); },
  });

  add('cleared', '公共', '闲置提醒', {
    notes: { does: '运行页 /session-timeout，不是清完之后的结果页。说明栏「演示：无操作提醒」进入这一屏。倒计时 30 秒是没有预警时刻时的兜底，到 0 调 window.doClear() 回首页。截图参数 shot=1 时数字停在 30，不自动清场。', motion: '只改倒计时数字。不自动跳待机，也不在到 0 之前清场。', keep: '屏上写「30 秒后自动结束这次使用」。有 S().fpFrom 且不是本页时写「继续后回到刚才那一页」，否则写「继续后回到首页」。来源读不到的原因只写在 notes。「我还在，继续使用」回 fpFrom，没有就回首页；「现在结束使用」立即清场。匿名和已登录两套后果分开写。已经交出去的打印继续，账号文档和取件码不清。号码与服务时间从后台读，读不到不显示。' },
    render: () => window.FP.cleared(),
    mount: (el) => window.FP.mountCleared(el)
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
    notes: { does: '运行页 /resume-service，QxServiceHubPage hub=resume。正常态两张主卡：有简历去 /resume/source（本稿 resume-src，data-arg=diagnose），没有去 /resume/generate（本稿 scratch）。?ai=down 只停 kind===ai 的入口。', motion: '两张主卡依次浮入；按下缩小。停用的卡按下不动。机构开通时「其余」从本屏底部滑出，不另开一页。', keep: '屏上问题用第 3 版「你手上有简历吗？」，副题「有就帮你诊断改写，没有就一步步写一份。」。运行页标题「把简历这件事，做得更清楚」、副题「从来源选择、诊断优化到生成、材料与打印，按你的目标进入对应步骤。」写在规格 serviceHubSpecs.ts，不画在意图带上。底栏中间一项是「AI 顾问」。页脚三句是规格原文 truthTitle / truth / note，排成一行到两行。顶栏胶囊是就绪句「能力与设备状态以办理时确认为准」，不报打印机。合同风险提示不在 serviceHubSpecs.ts：运行页 QxServiceHubPage 在开关 VITE_ENABLE_CONTRACT_REVIEW==="true" 时另加一张，默认关。本稿用 S().controlsOn（?ctrl=1）表示这个开关打开。未打开时「其余 6 项」仍去 resume-more，常用四卡不动。打开后按钮写成「其余 7 项」，在本屏展开原来的 6 项，再加「AI签约风险提示」：说明「上传劳动合同、实习协议或 Offer，核查试用期、薪酬、竞业等条款风险」，徽标「AI · 仅供参考」，去 contract。?ai=down 时这一项和其他 kind ai 一样停用，文案「AI能力当前不可用」，不消失。要 AI 的项（kind ai）：两张主卡（AI简历诊断、从零生成简历）、职业规划、简历对照，以及展开里的 AI简历诊断、AI简历优化、AI签约风险提示。不要 AI、?ai=down 仍可点：求职材料（info）、自我探索（info）、简历素材库（info）、简历打印（device）、我的简历（account）、AI服务记录（account，名字带 AI 但 kind 不是 ai）。两张主卡停用时的出路：有简历「可以先打印原件」去 print；没有简历「可以先看简历素材库」去 templates。后端整站不可用是 st-unavailable，不是这一变体。四张常用卡同一路由不在展开里再列。自我探索卡上写规格句「完成职业倾向参考」。' },
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
          <div class="fgroup"><div class="sec-t rise" style="--i:3">也可以直接用<small>不用先诊断</small>${S().controlsOn ? `<button class="more" data-fm="hubmore">其余 7 项 ${icon('chevR', 24, 2.4)}</button>` : `<button class="more" data-go="resume-more">其余 6 项 ${icon('chevR', 24, 2.4)}</button>`}</div>
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
    mount: (el) => {
      const offIntent = bindResumeIntent(el);
      const paint = () => {
        el.querySelectorAll('.fm-hub').forEach((n) => n.remove());
        if (!(S().controlsOn && S().fmHubMore)) return;
        const wrap = document.createElement('div');
        wrap.className = 'fm-hub';
        wrap.innerHTML = window.FM.hubSheet();
        el.appendChild(wrap);
      };
      paint();
      const on = (e) => {
        const open = e.target.closest('[data-fm="hubmore"]');
        if (open && el.contains(open)) {
          e.stopPropagation();
          S().fmHubMore = true;
          paint();
          return;
        }
        const close = e.target.closest('[data-fm="hubclose"]');
        if (close && el.contains(close)) {
          e.stopPropagation();
          S().fmHubMore = false;
          paint();
        }
      };
      el.addEventListener('click', on);
      return () => { offIntent(); el.removeEventListener('click', on); };
    }
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
    notes: { does: '运行页 /resume/source，ResumeSourcePage。一体机默认打开手机扫码面板（同页的 UploadSessionQrPanel），U 盘是同页的 ResumeUsbImportPanel，不另开路由。', motion: '点「在手机里 / 在 U 盘里」只切换本页面板（opacity）。二维码外圈用已有脉冲，不表示上传进度。文件到了只换占位框里的文件卡，不自己跳到下一步。', keep: '纸质去扫描工作台：与诊断失败屏 ResumeReportStates.tsx「扫描纸质简历」同一去向 /scan（desc「在打印机面板上扫描，存成 PDF」）。本稿落到 scan-type。本页不能点选已存简历。未登录句是「当前未登录 · 这次按临时上传处理」加「去登录」。已登录只去 my-resumes。Word 默认 wordToPdf=false，句为「Word 转换暂未开放，请另存为 PDF 再上传」；能力打开才收 DOC/DOCX。文件确认前主按钮禁用，文案「请先上传简历文件」；确认后（S().fmFile，手机上传或 U 盘导入带回来，或本屏演示事件 file）主按钮「下一步：诊断方向」去 resume-direction，不直接解析。文件卡读 S().fmDoc，没有就用手机示例「李佳怡-产品运营-简历.pdf · 1 页 · 248 KB」。胶囊改为「系统已收到，等你确认」。刷新二维码只换这张码的种子，不报成功。取消后本屏写「这次扫码已取消」，再出一张码回到等待。U 盘面板「重新检测」读不到盘就写「刚刚重新检测过，还是没有插入 U 盘」，不假装插上了。会话 600 秒，不写死剩余钟点，不写手机是否连上，也不写号码后四位。U 盘未开通、确认不了、读取失败是别的态，这一帧是「等待插入U盘」。出错、小青不可用、未登录都不挡这一页：纸质去 scan-type，没有电子简历去 scratch，只打印去 print。' },
    render: () => {
      const got = !!S().fmFile;
      const doc = S().fmDoc || window.FM.resumeDoc;
      const scanOff = !!S().fmScanOff && !got;
      const noUsb = S().fmNoUsb || 0;
      const srcOn = S().fmSrc === 'usb' ? 'usb' : 'phone';
      return F({
      band: { kind: 'compact', eyebrow: 'AI 简历诊断', title: '你的简历在哪里？', rail: { labels: RAIL.resume, now: 0 }, seal: 'idle', place: ' ', status: got ? { text: '系统已收到，等你确认' } : { text: '等待简历文件' } },
      cls: 'tight d4-fill d4-srcpage',
      body: `<div class="d4-srcs" role="group" aria-label="简历从哪儿来">
          <button class="d4-src" data-d4-src="phone" data-act="seg" aria-pressed="${srcOn === 'phone' ? 'true' : 'false'}"><span class="d4-ico">${icon('phone', 40, 2)}</span><b>在手机里</b><small>用手机扫码选择简历文件，再回到一体机确认</small></button>
          <button class="d4-src" data-d4-src="usb" data-act="seg" aria-pressed="${srcOn === 'usb' ? 'true' : 'false'}"><span class="d4-ico">${icon('usb', 40, 2)}</span><b>在 U 盘里</b><small>从已插入的 U 盘里选一份。只读取你点的那份</small></button>
          <button class="d4-src" data-d4-src="paper" data-go="scan-type" aria-pressed="false"><span class="d4-ico">${icon('scan', 40, 2)}</span><b>是纸质的</b><small>在打印机面板上扫描，存成 PDF</small></button>
        </div>
        <div class="d4-panel" data-d4-panel="phone">
          ${scanOff ? `<div class="fm-cancel"><div>${UI.phone(200)}</div><div><b>这次扫码已取消</b><p>这张码已经作废。文件还没到这台机器，可以再出一张码。</p><button class="btn pri" data-fm="newscan">再出一张码</button></div></div>` : `<b>请用手机微信或浏览器扫码</b>
          <div class="d4-qr">${UI.qr(S().fmQrSrc || 6, 360)}</div>
          <p>二维码有效期从生成时起算，10 分钟 · 文件最大 10MB</p>
          <div class="d4-ops">
            <button data-fm="qrsrc">刷新二维码</button>
            <button data-fm="cancelscan">取消</button>
          </div>`}
          <div class="steps3 d4-ministep" aria-label="怎么把文件传过来"><div class="s"><span class="n">1</span><b>扫码</b></div><div class="s"><span class="n">2</span><b>在手机上选文件、点上传</b></div><div class="s"><span class="n">3</span><b>回到这台机器点确认</b></div></div>
          <div class="dropzone d4-drop${got ? ' fm-got' : ''}">${got ? window.FM.file(doc.name, doc.meta) : `${icon('file', 36, 1.8)}<span>传过来的文件会出现在这里</span>`}</div>
        </div>
        <div class="d4-panel" data-d4-panel="usb" hidden>
          <b>等待插入U盘</b>
          <p>插好后列出 10MB 以内的 PDF、JPG、PNG。只读取你主动选择的文件，上传完成后即可拔出 U 盘。</p>
          ${noUsb ? `<p class="fm-note" data-fm-n="${noUsb}">刚刚重新检测过，还是没有插入 U 盘。</p>` : ''}
          <button class="btn sec" data-fm="redetect">重新检测</button>
        </div>
        ${S().logged
          ? `<button class="d4-link" data-go="my-resumes">${icon('user', 28, 2)}<span>保存过的简历在『我的简历』里看</span>${icon('chevR', 28, 2.2)}</button>`
          : `<button class="d4-link" data-go="login">${icon('user', 28, 2)}<span>当前未登录 · 这次按临时上传处理 · 去登录</span>${icon('chevR', 28, 2.2)}</button>`}
        <div class="d4-links">
          <button data-go="scratch">没有电子简历？让 AI 帮你写一份</button>
          <button data-go="print">只想打印原件</button>
        </div>
        ${fine('Word 转换暂未开放，请另存为 PDF 再上传。')}`,
      dock: { backLabel: '上一步', ask: '问小青：帮我选诊断重点 →', pri: got ? { label: '下一步：诊断方向', go: 'resume-direction' } : { label: '请先上传简历文件', disabled: true } }, nav: 'home', navAdvisor: 1
    });
    },
    demo: [{ label: '演示：手机传来一份文件', ev: 'file' }],
    mount: (el) => {
      const sync = () => {
        const on = el.querySelector('.d4-srcs [aria-pressed="true"]');
        const id = on && on.dataset.d4Src === 'usb' ? 'usb' : 'phone';
        el.querySelectorAll('[data-d4-panel]').forEach((p) => { p.hidden = p.dataset.d4Panel !== id; });
      };
      sync();
      const onClick = (e) => {
        const src = e.target.closest('.d4-src');
        if (src && el.contains(src)) {
          if (src.dataset.d4Src === 'usb' || src.dataset.d4Src === 'phone') S().fmSrc = src.dataset.d4Src;
          if (src.getAttribute('aria-pressed') === 'true') src.setAttribute('data-fm-n', String((+src.getAttribute('data-fm-n') || 0) + 1));
        }
        const fm = e.target.closest('[data-fm]');
        if (fm && el.contains(fm)) {
          const k = fm.dataset.fm;
          if (k === 'qrsrc') { e.stopPropagation(); S().fmQrSrc = (S().fmQrSrc || 6) + 1; window.__proto.refresh(); return; }
          if (k === 'cancelscan') { e.stopPropagation(); S().fmScanOff = true; window.__proto.refresh(); return; }
          if (k === 'newscan') { e.stopPropagation(); S().fmScanOff = false; S().fmQrSrc = (S().fmQrSrc || 6) + 1; window.__proto.refresh(); return; }
          if (k === 'redetect') { e.stopPropagation(); S().fmSrc = 'usb'; S().fmNoUsb = (S().fmNoUsb || 0) + 1; window.__proto.refresh(); return; }
        }
        queueMicrotask(sync);
      };
      const onDemo = (e) => {
        if (e.detail !== 'file') return;
        S().fmFile = true;
        S().fmDoc = window.FM.resumeDoc;
        window.__proto.refresh();
      };
      el.addEventListener('click', onClick);
      el.addEventListener('proto-demo', onDemo);
      return () => { el.removeEventListener('click', onClick); el.removeEventListener('proto-demo', onDemo); };
    }
  });
  add('upload', '改简历', '手机扫码传文件', {
    notes: { does: '手机扫码传文件。打印来路（S.ctx 为 print）和简历来路（resume）都走这一屏。大屏不感知扫没扫，只等系统收到文件。演示事件 file（或 S().fmUp）表示系统已经收到。', motion: '等待时二维码外圈扩散。不自己演到下一步。收到文件后只换下面的文件卡和主按钮。', keep: '意图带不画步骤条，二维码放在意图带下方，边长 360。两路都画三步：扫码 → 在手机上选文件、点上传 → 回到这台机器点确认。等待句「等你在手机上传文件 · 传好后会显示在下面，再点确认」。占位「传好的文件会出现在这里」。收到后胶囊「系统已收到，等你确认」，框里画文件卡。打印来路示例「毕业生就业推荐表（已填写）.pdf · 2 页 · 186 KB」，主按钮「确认使用这份文件」去 pii。简历来路示例「李佳怡-产品运营-简历.pdf · 1 页 · 248 KB」，同一句按钮回 resume-src，并写上 S().fmFile 与 S().fmDoc。有「取消这次上传」（打印回 print-src，简历回 resume-src），取消清掉这次已收到的标记。不写手机连接状态，不自动进入下一步。有效期从生成时起算，10 分钟；刷新二维码只换种子。确认按钮在文件出现前不可点。文件名从这一次上传读，上面两个名字是示例。' },
    render: () => {
      const forPrint = S().ctx === 'print';
      const got = !!S().fmUp;
      const doc = forPrint ? window.FM.printDoc : window.FM.resumeDoc;
      const waitStatus = forPrint ? (printerOff() ? { text: '打印机离线', warn: 1 } : { text: '打印机在线' }) : { text: '等待简历文件' };
      return F({
        band: { eyebrow: forPrint ? '文档打印' : 'AI 简历诊断', title: forPrint ? '用手机扫描下方二维码' : '请用手机微信或浏览器扫码', seal: null, place: ' ', status: got ? { text: '系统已收到，等你确认' } : waitStatus },
        cls: 'tight d3-up',
        body: `<div class="qr-card waiting" id="qrWrap"><div class="qr-box d3-qrbox"><i class="pulse"></i><i class="pulse p2"></i>${UI.qr(S().fmQrUp || 9, 360)}</div><span style="font-size:21px;color:var(--ink-3)" id="qrExp">二维码有效期从生成时起算，10 分钟 · 文件最大 10MB · <u data-fm="qrup">刷新二维码</u></span></div>
          <div class="steps3 rise" style="--i:1" id="steps"><div class="s"><span class="n">1</span><b>扫码</b><small>相机或微信</small></div><div class="s"><span class="n">2</span><b>在手机上选文件、<br>点上传</b><small>PDF、JPG、PNG</small></div><div class="s"><span class="n">3</span><b>回到这台机器点确认</b><small>传好后再点下面的确认</small></div></div>
          <div class="livebox rise" style="--i:2" id="upLive">${got ? icon('check', 36, 2.4) : '<span class="spin"></span>'}<div><b>${got ? '系统已收到，等你确认' : '等你在手机上传文件 · 传好后会显示在下面，再点确认'}</b></div></div>
          <div id="upFile"><div class="dropzone d3-drop${got ? ' fm-got' : ''}">${got ? window.FM.file(doc.name, doc.meta) : `${icon('file', 40, 1.8)}<span>传好的文件会出现在这里</span>`}</div></div>
          <button class="btn sec" data-go="${forPrint ? 'print-src' : 'resume-src'}">取消这次上传</button>
          ${fine(forPrint ? '结束办理或闲置超时会清除本机临时信息；已上传文件按留存期限管理。' : '未登录临时上传约 1 小时；登录后简历默认保存 90 天。')}`,
        dock: { backLabel: '上一步', ask: forPrint ? '问小青：怎么检查' : '问小青：选诊断重点', pri: got ? { label: '确认使用这份文件', go: forPrint ? 'pii' : 'resume-src', id: 'upNext' } : { label: forPrint ? '确认使用这份文件' : '确认', go: forPrint ? 'pii' : 'reading', disabled: true, id: 'upNext' } }, nav: 'home', navAdvisor: 1
      });
    },
    demo: [{ label: '演示：手机传来一份文件', ev: 'file' }],
    mount: (el) => {
      const on = (e) => {
        const u = e.target.closest('[data-fm="qrup"]');
        if (u && el.contains(u)) {
          e.stopPropagation();
          S().fmQrUp = (S().fmQrUp || 9) + 1;
          window.__proto.refresh();
          return;
        }
        const next = e.target.closest('#upNext');
        if (next && el.contains(next) && !next.disabled && S().fmUp && S().ctx !== 'print') {
          S().fmFile = true;
          S().fmDoc = window.FM.resumeDoc;
        }
        const cancel = e.target.closest('button');
        if (cancel && el.contains(cancel) && (cancel.textContent || '').indexOf('取消这次上传') >= 0) S().fmUp = false;
      };
      const onDemo = (e) => {
        if (e.detail !== 'file') return;
        S().fmUp = true;
        window.__proto.refresh();
      };
      el.addEventListener('click', on);
      el.addEventListener('proto-demo', onDemo);
      return () => { el.removeEventListener('click', on); el.removeEventListener('proto-demo', onDemo); };
    }
  });

  add('usb', '改简历', 'U 盘选文件', {
    notes: { does: '列出当次根目录里能用的文件。没插上时不能写已经读到。打印来路和简历来路都走这一屏。点文件行只选中，主按钮出现后才导入。', motion: '文件列表依次浮入。选中只改这一行的底色。导入中不自己跳到下一步，等演示事件 imported。', keep: '列表上方写「U 盘根目录里能用的文件（3 个）」和「重新检测」（运行页 U 盘面板有重新检测）。重新检测清掉选中，写「刚刚重新读过这块 U 盘，根目录里还是这 3 个文件」，不假装读出新文件。只显示文件名和大小，不显示页数，不列出 Word。未选中时拔盘句只写「导入完成后可以直接拔出 U 盘」，底栏没有导入按钮。选中后主按钮「导入这份文件」（运行页按钮原文是「导入这一份」，本稿按这一轮任务用「导入这份文件」），说明用「只导入这一份，U 盘上其它文件不会被读走。导入完成前它还不是当前文件。」导入中写「正在导入选中的文件，请暂时不要拔出 U 盘。」以及「系统确认保存之前，当前文件仍然是空的。这期间别拔 U 盘。」导入完成：打印来路去 pii，简历来路回 resume-src 并带上 S().fmFile 与这份文件名、大小。读不出来可以换 USB 口或改用手机。底部导航中间一项是「AI 顾问」。' },
    render: () => {
      const forPrint = S().ctx === 'print';
      const idx = window.FM.usbIndex();
      const busy = !!S().fmUsbBusy;
      const reads = S().fmUsbReads || 0;
      const remind = busy
        ? '正在导入选中的文件，请暂时不要拔出 U 盘。系统确认保存之前，当前文件仍然是空的。这期间别拔 U 盘。'
        : idx >= 0
          ? '只导入这一份，U 盘上其它文件不会被读走。导入完成前它还不是当前文件。'
          : '只读取你主动选择的文件。导入完成后可以直接拔出 U 盘。';
      return F({
        band: { eyebrow: forPrint ? '文档打印' : 'AI 简历诊断', title: '挑一份就行', sub: '只读根目录，不进子文件夹。', rail: { labels: forPrint ? RAIL.print : RAIL.resume, now: 0 }, seal: null, place: ' ', status: forPrint ? (printerOff() ? { text: '打印机离线', warn: 1 } : { text: '打印机在线' }) : { text: '等待简历文件' } },
        cls: 'd3-usb',
        body: `<div class="d3-usbhead rise" style="--i:0"><b>U 盘根目录里能用的文件（${D.usbFiles.length} 个）</b><button class="d3-mini" data-fm="uread">重新检测</button></div>
        ${reads ? `<p class="fm-note" data-fm-n="${reads}">刚刚重新读过这块 U 盘，根目录里还是这 ${D.usbFiles.length} 个文件。</p>` : ''}
        <div class="stack">${D.usbFiles.map((f, i) => `<button class="filecard rise${idx === i ? ' fm-on' : ''}" style="--i:${i};text-align:left;width:100%" data-fm="usel" data-i="${i}"><span class="ft ${f.t === 'JPG' ? 'img' : ''}">${f.t}</span><div style="min-width:0"><b>${f.n}</b><small>${f.s}</small></div><span style="margin-left:auto;color:${idx === i ? 'var(--teal-ink)' : 'var(--ink-3)'}">${idx === i ? '已选中' : icon('chevR', 34, 2.2)}</span></button>`).join('')}</div>
        <div class="remind rise" style="--i:5">${icon('usb', 34, 2)}<span>${remind}</span></div>
        ${fine('Word 转换暂未开放，请另存为 PDF 再上传。读不出来可以换一个 USB 口，或者改用手机传。')}`,
        dock: Object.assign({ backLabel: '上一步', ask: forPrint ? '问小青：怎么检查' : '问小青：选诊断重点' }, idx >= 0 ? { pri: { label: busy ? '正在导入' : '导入这份文件', disabled: busy, id: 'fmUsbGo' } } : {}),
        nav: null, navAdvisor: 1
      });
    },
    demo: () => (S().fmUsbBusy ? [{ label: '演示：导入完成', ev: 'imported' }] : []),
    mount: (el) => {
      const on = (e) => {
        const row = e.target.closest('[data-fm="usel"]');
        if (row && el.contains(row)) {
          e.stopPropagation();
          if (S().fmUsbBusy) return;
          const i = +row.dataset.i;
          if (window.FM.usbIndex() === i) {
            row.setAttribute('data-fm-hit', String((+row.dataset.fmHit || 0) + 1));
            return;
          }
          S().fmUsbSel = i;
          window.__proto.refresh();
          return;
        }
        const again = e.target.closest('[data-fm="uread"]');
        if (again && el.contains(again)) {
          e.stopPropagation();
          delete S().fmUsbSel;
          S().fmUsbBusy = false;
          S().fmUsbReads = (S().fmUsbReads || 0) + 1;
          window.__proto.refresh();
          return;
        }
        const go = e.target.closest('#fmUsbGo');
        if (go && el.contains(go) && !go.disabled) {
          e.stopPropagation();
          S().fmUsbBusy = true;
          window.__proto.refresh();
        }
      };
      const onDemo = (e) => {
        if (e.detail !== 'imported' || !S().fmUsbBusy) return;
        const f = D.usbFiles[window.FM.usbIndex()];
        S().fmUsbBusy = false;
        delete S().fmUsbSel;
        if (S().ctx === 'print') { S().printDoc = f ? { name: f.n, meta: f.s } : null; window.go('pii'); return; }
        S().fmFile = true;
        S().fmDoc = f ? { name: f.n, meta: f.s } : window.FM.resumeDoc;
        window.go('resume-src');
      };
      el.addEventListener('click', on);
      el.addEventListener('proto-demo', onDemo);
      return () => { el.removeEventListener('click', on); el.removeEventListener('proto-demo', onDemo); };
    }
  });
  add('reading', '改简历', '读简历', {
    notes: { does: '运行页 /resume/parse 的等待态（ResumeParseOutcomeNote waiting）。标题和副标题用等待文案，不预报时长。?ai=down 不画等待：运行页小青停用时诊断失败直接到报告失败态，这一变体改画 st-ai-down 的内容（render 时取 window.SCREENS 里 st-ai-down 的 render）。地址仍是 reading。', motion: '圆章和转圈只表示在进行（transform / opacity），不表示百分比，也没有扫描线。四条说明不打勾、不播报阶段。不倒计时演完自动成功。', keep: '四条是处理内容说明：读取上传文件、识别可解析文字、提取简历结构、生成诊断报告。「处理内容」只在列头标一次。运行页解析页没有底部导航；本稿壳子仍留三格导航，中间一项是「AI 顾问」，这三格不计入本屏可点。底栏是返回上一步和问小青（问小青：解析没完成怎么办）。返回句用 ResumeParsePage.tsx 717：「返回仅停止本机等待，不会撤回已提交的服务请求」。简历原文不会发送给企业，也不进入平台候选人简历库。发给 AI 之前会先遮住手机号、身份证号、邮箱、住址等个人信息；代码里 mask 还包含银行卡号和姓名。等待中没有打印原件，也没有「读完了」。六维名称只读，来自 RESUME_SCORING_DIMENSIONS。演示事件 done（解析完成）去 diagnosis；fail（这次没解析出来）去 st-ai-down。小青已停用时 done 不前进，页面本身已经是失败态。返回上一步是不用 AI 的出口。' },
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
    },
    demo: [{ label: '演示：解析完成', ev: 'done' }, { label: '演示：这次没解析出来', ev: 'fail' }],
    mount: (el) => {
      const on = (e) => {
        if (e.detail === 'done') { if (S().ai !== 'down') window.go('diagnosis'); return; }
        if (e.detail === 'fail') window.go('st-ai-down');
      };
      el.addEventListener('proto-demo', on);
      return () => el.removeEventListener('proto-demo', on);
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
    notes: { does: '运行页 /resume/optimize/compare 的最后一条。标题「第 n / N 条 · 模块名」。这一帧是第 4 / 4 条 · 工作经历，用来同时看见「去编辑」和未确认的新增事实。', motion: '无循环动画。勾上事实后，「用改写」才可点。未勾时框是白底描边，整行可点。', keep: '左右是原文和改写，图例是删掉、加上、换写法。五格统计来自 ResumeOptimizeComparePage.tsx 193–195：全部 / 已采纳 / 保留原文 / 自己写 / 待定。这一帧示例数字是 4 / 2 / 1 / 0 / 1，写死，不跟当前这一条的按钮连动（当前条画的是「自己写」按下，统计里自己写仍是 0）。三个决定：用改写、保留原文、自己写。自己写展开输入，点了走屏上键盘（data-act=type），不画数字键盘。改写里的「周更 2 篇」原文没有，勾「周更 2 篇是我的真实信息」之后才能用改写；运行页复选框是「{新增内容}是我的真实信息」。上一条回到逐条确认的第 3 条（optimize）。批量处理、用这段、取消是本屏状态变化，统计跟着变。最后一条没有下一条，主按钮是「去编辑」。意图带用「选择还没写进简历，在『编辑』里生效」。正文另写运行页 UNSAVED_NOTICE：「选择是阅读决策，未保存、未生成文件；返回优化页时可以选择是否应用到编辑区。只有编辑区的内容会进入导出。」不画只看改后，不去打印。批量清空在改动清单，这一页不重复。改写栏标识「AI 生成，仅供参考，请自行核对」。' },
    render: () => { const c = Object.assign({ all: 4, opt: 2, keep: 1, own: 0, pend: 1, choice: 'custom', used: false, msg: '' }, S().cmp || {}); return F({
      band: { kind: 'compact', eyebrow: '逐条选择', title: '第 4 / 4 条 · 工作经历', sub: '选择还没写进简历，在『编辑』里生效', rail: { labels: RAIL.resume, now: 3 }, seal: null, place: ' ', status: { text: '待本人选择' } },
      cls: 'tight d4-fill d4-cmp',
      body: `<div class="d4-top">
          <button class="d4-prev" data-go="optimize" data-set="opt=2">上一条</button>
          <div class="d4-legend" aria-label="对照图例"><span><del>删掉</del> 删除</span><span><ins>加上</ins> 新增</span><span class="d4-swap">换写法</span><span>普通文字 保留</span></div>
        </div>
        <div class="d4-stats5" aria-label="改写选择统计"><span><u>全部</u><b>${c.all}</b></span><span><u>已采纳</u><b>${c.opt}</b></span><span><u>保留原文</u><b>${c.keep}</b></span><span><u>自己写</u><b>${c.own}</b></span><span><u>待定</u><b>${c.pend}</b></span></div>
        <div class="d4-batch" aria-label="批量处理"><button data-cmp="opt-all"><b>可采纳的全部采纳</b><small>跳过有待确认事实的那几条</small></button><button data-cmp="keep-rest"><b>其余保留原文</b><small>把还没决定的都记为保留</small></button><button data-cmp="clear"><b>清空全部选择</b><small>全部回到待定</small></button></div>
        <p class="d4-draft">${c.msg || '选择是阅读决策，未保存、未生成文件；返回优化页时可以选择是否应用到编辑区。只有编辑区的内容会进入导出。'}</p>
        <div class="d4-cols">
          <section class="d4-col"><b>原文</b><p>负责学院公众号的选题、撰写和排版。</p><small>摘自本次简历原文</small></section>
          <section class="d4-col d4-diff"><b>改写</b><p><del>负责</del><span class="d4-swap">独立运营</span>学院公众号的选题、撰写和排版，<ins>周更 2 篇</ins>。</p><small>AI 生成，仅供参考，请自行核对</small></section>
        </div>
        <p class="d4-metrics">字数 17 → 26 · 删除 2 字 · 新增 11 字</p>
        <label class="d4-fact"><input id="d4Fact" type="checkbox"><span>周更 2 篇是我的真实信息</span></label>
        <div class="d4-seg d4-dec" role="group" aria-label="这一条用哪一版">
          <button id="d4Use" data-act="seg" data-d4-choice="opt" aria-pressed="false" disabled>用改写</button>
          <button data-act="seg" data-d4-choice="keep" aria-pressed="${c.choice === 'keep'}">保留原文</button>
          <button data-act="seg" data-d4-choice="custom" aria-pressed="${c.choice === 'custom'}">自己写</button>
        </div>
        <div class="d4-custom" id="d4Custom"><b class="d4-cl">自己写这一条</b><button class="d4-ta" data-act="type">在这里写你自己的这一句</button><p class="d4-cn">这段只留在本页，刷新后不保留。要放进新简历，请回编辑区填写。</p><div class="d4-ca">${c.used ? '<b class="d4-cl">已用你写的这段</b>' : '<button class="btn sm mint" data-cmp="use-own">用这段</button>'}<button class="btn sm sec" data-cmp="cancel-own">取消</button></div></div>`,
      dock: { backLabel: '返回', ask: '问小青：这句还能怎么改 →', pri: { label: '去编辑', go: 'resume-edit' } }, nav: null, navAdvisor: 1
    }); },
    mount: (el) => {
      /* 批量处理、用这段、取消：本屏状态变化（统计跟着变），不弹提示条。 */
      const onCmp = (e) => {
        const t = e.target.closest('[data-cmp]'); if (!t || !el.contains(t)) return;
        const c = Object.assign({ all: 4, opt: 2, keep: 1, own: 0, pend: 1, choice: 'custom', used: false, msg: '' }, S().cmp || {});
        const k = t.dataset.cmp;
        if (k === 'opt-all') c.msg = '可以采纳的都已采纳；这一条有待你确认的新增内容（周更 2 篇），先跳过，仍是待定。';
        if (k === 'keep-rest') { c.keep += c.pend; c.pend = 0; c.choice = 'keep'; c.used = false; c.msg = '还没决定的都记为保留原文。'; }
        if (k === 'clear') Object.assign(c, { opt: 0, keep: 0, own: 0, pend: c.all, choice: '', used: false, msg: '全部回到待定，可以重新逐条选。' });
        if (k === 'use-own') { if (!c.used && c.pend > 0) { c.own += 1; c.pend -= 1; } c.used = true; c.msg = '这一条用你自己写的。要放进新简历，请回编辑区填写。'; }
        if (k === 'cancel-own') { if (c.used) { c.own -= 1; c.pend += 1; } Object.assign(c, { choice: '', used: false, msg: '' }); }
        S().cmp = c; window.__proto.refresh();
      };
      el.addEventListener('click', onCmp);
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
      return () => { el.removeEventListener('click', onCmp); el.removeEventListener('click', onClick); el.removeEventListener('change', onClick); };
    }
  });
  add('scratch', '改简历', '从零生成：基本信息', {
    notes: { does: '从零生成第 1 步，只问基本信息。姓名必填，城市和联系方式可空。', motion: '无循环动画。同意层淡入。', keep: '路由 /resume/generate 第 1 步。没有「在哪写」，也没有手机写。第一次用 AI 的同意层由演示事件 consent 打开，同意后进第 2 步。AI 不可用或暂不使用时，导出原话走演示事件 draft，好了才去 pii。未满 14 周岁由演示事件 age。号码与服务时间从后台读，读不到不显示。普通页 3 分钟清除。中间四步和复核页同一版式，这一轮不另画。第二轮起这些话只留在说明里，屏上不写：后面四步同一版式、教育 6 段、工作 8 段、项目 6 段、技能 20 项、证书 15 项、语音从教育描述开始。屏上是普通表单，姓名空着显示必填，城市、电话、邮箱写示例值。旁边是「简历顶部会这样显示」。' },
    demo: () => window.FR.demo('scratch'),
    render: () => window.FR.render('scratch'),
    mount: (el) => window.FR.mount('scratch', el)
  });
  add('scratch-1', '改简历', '从零生成：求职意向', {
    notes: { does: '第 2 步只问求职意向。目标岗位必填。下一步去核对页。', motion: '无循环动画。', keep: '运行页六步原名。工作类型不选即「不填写」。教育最多 6 段、工作 8、项目 6、技能 20、证书 15；语音从教育描述开始，先确认再写入。这两步不画语音。下一步按钮进 gen-preview，中间几步同一版式未另画。AI 不可用时可导出原话。号码与服务时间从后台读，读不到不显示。普通页 3 分钟清除。第二轮起这些话只留在说明里，屏上不写条数上限和语音。屏上是表单加意向预览，目标岗位空着显示必填，意向城市和期望薪资写示例值，工作类型空着显示不填写。' },
    demo: () => window.FR.demo('scratch-1'),
    render: () => window.FR.render('scratch-1'),
    mount: (el) => window.FR.mount('scratch-1', el)
  });
  add('interview', '练面试', '练面试服务台', {
    notes: {
      does: '运行页 /interview-service（serviceHubSpecs.interview + QxServiceHubPage）。主入口「马上练一场」去 iv-1，和运行页「开始模拟面试」都是 /interview/setup，不另画第二张卡。面试技巧去 iv-tips，训练报告去 iv-reports，职业自我探索去 sa-intro，职业规划建议去 career。其余四项去 interview-more。',
      motion: '按下缩小。停用的卡是 div，不是按钮。',
      keep: '顶栏胶囊只写在线服务：就绪「能力与设备状态以办理时确认为准」；S().fiHub=checking「正在确认在线服务」；fiHub=down「在线服务不可用」。不探测打印机，?printer=down 这页不变。kind ai 在 ?ai=down 或 fiHub=down 时写「AI能力当前不可用」，检查中写「正在确认AI能力状态」。训练报告要在线服务，不可达写「在线服务当前不可用」。面试技巧在离线白名单，仍可进。重新检测只在 fiHub=down，点了变成检查中，不在本屏演成已恢复（演示事件 hub-ready）。免责句用运行页：AI训练不是企业面试 / 不排名，不预测录用。普通页 3 分钟清除。问小青仍在，去 xq。'
    },
    render: () => window.FI.hub(),
    mount: (el) => window.FI.bind(el),
    demo: () => window.FI.demo('interview')
  });
  add('iv-1', '练面试', '设置 1：岗位与经验', {
    notes: {
      does: '运行页 /interview/setup 的岗位、行业、经验。产品负责人要求一屏一问，设置拆成三屏；改程序时运行页按这三步拆。这一屏只问岗位、行业、经验。',
      motion: '按下缩小。选中只改底色，不做循环动画。行业选择层淡入。',
      keep: '岗位六条示例从运行页读，不预填：前端开发工程师、行政专员、市场运营、机械工程师、会计、销售代表。自由输入是屏上键盘（演示：弹出系统触摸键盘），最多 50 字。行业是 GB/T 4754-2017 二十个门类，不预选、不推荐；点「选择行业 (20)」打开本屏选择层，不是提示。经验六档，再点一次取消。校验句照运行页：请先填写目标岗位，例如：前端开发工程师、行政专员 / 请先选择本次练习的行业，不会替你预选 / 请先选择你的经验情况，不会替你预选。过了才去 iv-2。先看面试技巧去 iv-tips。设置页没有麦克风。?ai=down 胶囊「AI 暂时不能出题」，这一屏仍可填。默认不改的话后面是 HR 面试、标准面试、5 分钟 / 6 题、文字回答。普通页 3 分钟清除。'
    },
    render: () => window.FI.iv1(),
    mount: (el) => window.FI.bind(el),
    demo: () => window.FI.demo('iv-1')
  });
  add('iv-2', '练面试', '设置 2：面试官与时长', {
    notes: {
      does: '运行页 /interview/setup 的面试官、难度、时长，拆成第 2 屏。运行页本身没有独立路由，改程序时从设置页拆出这一步。',
      motion: '按下缩小。选中出对勾。',
      keep: '面试官五类键是 hr / manager / tech / campus / final，说明句照运行页（HR 含薪资沟通），不写「常问」例句。难度：轻松练习、标准面试、压力面试，各带一句说明。时长写真值「3 分钟 / 4 题」「5 分钟 / 6 题」「8 分钟 / 8 题」。默认 HR、标准面试、5 分钟、文字回答；再点已选项也会改说明行，避免看起来没反应。到点不自动交卷。下一步去 iv-3。先看面试技巧去 iv-tips。?ai=down 只改胶囊「AI 暂时不能出题」。普通页 3 分钟清除。'
    },
    render: () => window.FI.iv2(),
    mount: (el) => window.FI.bind(el),
    demo: () => window.FI.demo('iv-2')
  });
  add('iv-3', '练面试', '设置 3：核对开始', {
    notes: {
      does: '运行页 /interview/setup 的核对、简历来源、年龄确认和创建会话。创建会话是后台结果：本屏先进入「正在为你准备面试官…」，演示事件 started 才去 iv-run；start-fail 留在本页。',
      motion: '按下缩小。确认层淡入。不倒计时演成功。',
      keep: '三项没填齐时主按钮只写出缺哪一项，不去下一屏。年龄确认、录音同意是本屏变体（演示 consent / voice-consent；开始录音时若还没同意，也弹出录音层）。未满 14 周岁进 age-block，不创建练习。手机扫码上传去 upload，U 盘导入去 usb，app.js 把 S().ctx 设为 resume。隐藏本机文件。已选用简历的文件名从上传结果读，示例「李佳怡-行政专员-简历.pdf」；移除是本屏状态。?ai=down 主按钮换成「打印通用题目单」，三项校验通过后去 pii，不经模型、不看年龄。运行页只有已经有 pendingSession 才印通用题目单；本稿按本轮设计决定，校验通过即可去 pii，改程序时一起改。创建中按钮禁用，不自动跳作答。上传失败、无法提取两句照运行页。使用 AI 即表示你已年满 14 周岁。普通页 3 分钟清除。号码不在这页。'
    },
    render: () => window.FI.iv3(),
    mount: (el) => window.FI.bind(el),
    demo: () => window.FI.demo('iv-3')
  });
  add('iv-run', '练面试', '作答', {
    notes: {
      does: '运行页 /interview/session/:sessionId（InterviewSessionPage、interviewWorkbenchModel、interviewAnswerRecovery）。直接打开这屏是一场进行中的示例；S().fiPhase=expired 是无会话或过期，回 iv-1 重新创建。',
      motion: '按下缩小。时钟不自动走，演示事件 timeup 才把剩余时间改成 0，并只改文案，不跳报告。录音不自动跳秒；演示事件 rec-full 表示录满 58 秒，只进入转写。',
      keep: '顶栏写「文字输入始终可用。题目、剩余时间和下一题，都按这场练习显示。」题目、题号、目标题数从本场会话读。目标题数按时长：3 分钟 4 题、5 分钟 6 题、8 分钟 8 题。题旁写「题目由 AI 生成，仅供参考」。默认文字作答。点按开始录音，不是按住；最长 58 秒，到点只停止录音。跳过此题不计入有效回答。不打印回答是开关。结束本场：没有非跳过回答就停在「这一场还没有记下的回答」，可继续答题或离开回服务台；有回答则本屏「正在生成练习报告…」，演示事件 report 才去 iv-report。演示 report 在没有回答时不跳。提交空稿写「请输入回答内容，或选择跳过此题」。提交失败留草稿。AI 停用：有已保存回答写「你的回答已保存，AI 恢复后可以接着生成报告」；没有则不说已保存。稍后再试只再问一次，不演成报告已生成。麦克风权限句改成「需要帮助？拨打服务电话 183-6916-1921」。号码与服务时间从后台读，读不到不显示。语音模式自动播一次当前题，不画「再听一遍」。不画「存到我的」。不报打印机。普通页 3 分钟清除。'
    },
    render: () => window.FI.run(),
    mount: (el) => window.FI.bind(el),
    demo: () => window.FI.demo('iv-run')
  });
  add('iv-report', '练面试', '练习报告', {
    notes: {
      does: '运行页 /interview/report/:sessionId（InterviewReportPage）。这一屏放综合概览、五组能力、风险。预测题、STAR、准备清单、问答摘录去 iv-report-more。',
      motion: '按下缩小。不自动跳打印。',
      keep: '不显示等级。标识用运行页原句「AI 生成，仅供参考，只用于本人练习复盘」。岗位、行业、面试官、能力栏、风险从报告读；这一帧句子标「示例」，空数组不补。不写死页数。「生成打印版」先变成「正在生成打印版…」，演示事件 print-ready 才把 S().ctx 设为 report 并去 pii；print-fail 留本页，写「打印版生成失败，请稍后重试」。查看历史报告去 iv-reports。重新练习去 iv-1。S().fiRep=loading / gone 不展示示例句子。结果页 1 分 30 秒清除。下游 confirm 仍写死 2 页和「新媒体运营」，不在本区改。'
    },
    render: () => window.FI.report(),
    mount: (el) => window.FI.bind(el),
    demo: () => window.FI.demo('iv-report')
  });
  add('print', '打印扫描', '打印 · 扫描 · 复印入口', {
    before: 'print',
    notes: { does: '运行页打印扫描服务台 PrintScanHomePage / QxPrintHubView（/print-scan）。问句用 HUB_ASK：在线「你的文件，现在在哪？」，打印机离线「这台机器出不了纸。」。', motion: '卡片依次浮入。状态只在顶部胶囊说一次。隐私长文默认折叠。', keep: '眉题「打印扫描服务」。正常胶囊「能力与设备状态以办理时确认」。离线胶囊「打印机离线 · 出纸类暂停」（printerLabel + 出纸类暂停）。意图带四步「选文件 → 材料检查 → 预览与参数 → 核对价格」，不标当前步。运行页服务台现在是三步轴，10/26 产品负责人定统一成这四步，改程序时一起改。复印卡名「复印」，说明：在打印机屏幕上点「复印」「身份证复印」或「票据复印」；不经过这台一体机下单，也不进打印订单。到机码右上胶囊「不是取件码」，说明一行「凭码办理，不登录也能核销 · 8 位数字（历史 10 位码也支持）」，带走「订单里的打印件」，右下 8 个空格，不写示例码。离线时打印文件、扫描纸质材料呈浅底虚线，徽标写原因；照片打印同样停。手机扫码上传、U 盘导入仍可进，细行「先传、稍后打印」。复印仍可点，说明「打印机离线时复印可能也用不了，以打印机屏幕为准」。到机码离线说明「这台机器现在出不了纸，核销完也拿不到纸；订单还在，请稍后再来。」底部故障句用标准句。服务电话 183-6916-1921。号码与服务时间从后台读，读不到不显示。不写换一台。彩色、双面写「本机暂未开通」。其他工具 3×2：照片打印去 print-src，照片合成 PDF，证件照去 feature-info，签名默认「本机暂未开通」，我的文档、打印订单登录后查看。反馈留在本屏一层里写，不进入要登录的意见反馈页。S().controlsOn 为真时签名改成可点卡，说明用运行页能力卡「放入本人手写签名」，去 sign；带走句「生成的新 PDF」写在这里，不画上卡。打印机离线时签名仍可点。未开通时灰卡一字不变。' },
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
            ${S().controlsOn ? tile({ i: 8, go: 'sign', icon: 'pen', tone: 'clay', title: '签名', desc: '放入本人手写签名' }) : `<button class="tile off" style="--i:8" disabled><span class="ic">${icon('pen', 34, 2)}</span><span class="tx"><b>签名</b><small>本机暂未开通</small></span></button>`}
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
            <button class="d3-mini" data-fm="fb">反馈问题</button>
          </div>`,
        cls: off ? 'print-off d3-print' : 'd3-print',
        dock: { backLabel: '上一步', ask: '问小青：怎么选打印方式 →' }, nav: 'home', navAdvisor: 1
      }) + (S().fmFeedback ? window.FM.feedback(S().fmFeedback) : '');
    },
    mount: (el) => {
      const on = (e) => {
        const b = e.target.closest('[data-fm]');
        if (b && el.contains(b)) {
          const k = b.getAttribute('data-fm');
          if (k === 'fb') { e.stopPropagation(); S().fmFeedback = true; window.__proto.refresh(); return; }
          if (k === 'fbsend') { e.stopPropagation(); S().fmFeedback = 'sent'; window.__proto.refresh(); return; }
          if (k === 'fbclose') { e.stopPropagation(); S().fmFeedback = false; window.__proto.refresh(); return; }
        }
        if (e.target.classList && e.target.classList.contains('overlay')) {
          e.stopPropagation();
          S().fmFeedback = false;
          window.__proto.refresh();
        }
      };
      el.addEventListener('click', on);
      return () => el.removeEventListener('click', on);
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
    notes: { does: '运行页文档打印选文件 PrintUploadPage / FileSourceView（/print/upload）。一个问题：文件在哪。第三张大卡是纸质原件，去扫描工作台 scan-type（运行页 /scan）。我的文档收成下面的细行。', motion: '卡片依次浮入。', keep: '大小行写「手机上传不超过 10MB · U 盘不超过 15MB」。一体机隐藏本机选文件（PrintUploadPage.tsx:202-203），这一屏不写本机。能打印的文件三列：PDF、图片、Word（转换暂未开放），不留空的第 4 格。不写 HEIC。细行说明是运行页事实「手机小程序里登录后传过的 PDF、图片，登录这台机器后在我的文档里选」。这句属「手机上能看到」，小程序发布前由开关 support.miniappPublished 收起，不显示。已登录去 my-docs，并写 S().ctx 为 print，让那一屏进「选一份来打印」。未登录去 login，并写 S().fmLoginBack 为 print-src，登录后回到这一页。本页不画多选文件盘。' },
    render: () => F({
      band: { eyebrow: '文档打印', title: '文件在哪里？', rail: { labels: RAIL.print, now: 0 }, seal: 'idle', place: ' ', status: printerOff() ? { text: '打印机离线', warn: 1 } : { text: '打印机在线' } },
      body: `${slab({ i: 0, row: 1, go: 'upload', arg: 'print', title: '手机扫码上传', desc: '不用登录、不用装软件。单份不超过 10MB', vis: UI.phone(78) })}
        ${slab({ i: 1, row: 1, go: 'usb', arg: 'print', title: 'U 盘导入', desc: '只读根目录，只读取你主动选择的文件', vis: UI.usb(120) })}
        ${slab({ i: 2, row: 1, go: 'scan-type', title: '是纸质的 · 放到打印机上扫描', desc: '扫描纸质原件，扫成 PDF 后可以存、可以打', vis: UI.scanPaper(120) })}
        <button class="rowlink rise fm-doc" style="--i:3" data-fm="docs" data-go="${S().logged ? 'my-docs' : 'login'}">${icon('folder', 32, 2)}<span><b>我的文档</b> <small>手机小程序里登录后传过的 PDF、图片，登录这台机器后在我的文档里选</small></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button>
        <div class="fmt rise" style="--i:4"><div class="olist-t">能打印的文件</div><div class="fmtrow d3-fmt3"><span><b>PDF</b><small>.pdf</small></span><span><b>图片</b><small>.jpg  .png</small></span><span class="no"><b>Word</b><small>转换暂未开放，请另存为 PDF</small></span></div><small>手机上传不超过 10MB · U 盘不超过 15MB</small></div>
        ${fine('结束办理或闲置超时会清除本机临时信息；已上传文件按留存期限管理。')}`,
      cls: 'd3-src',
      dock: { backLabel: '上一步', ask: '问小青：这份文件怎么检查 →' }, nav: 'home', navAdvisor: 1
    }),
    mount: (el) => {
      S().ctx = 'print';
      const on = (e) => {
        const row = e.target.closest('[data-fm="docs"]');
        if (!row || !el.contains(row)) return;
        if (S().logged) S().ctx = 'print';
        else S().fmLoginBack = 'print-src';
      };
      el.addEventListener('click', on);
      return () => el.removeEventListener('click', on);
    }
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
          <div class="preview">${UI.resume(120, 'plain')}<div>${window.FM.printName()}<span>${window.FM.printMeta()}</span></div></div>
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
        body: `<div class="preview"><div style="display:flex;gap:24px;align-items:center">${UI.resume(more ? 96 : 150, 'plain')}<div style="display:flex;flex-direction:column;gap:8px;font-size:22px;color:var(--ink-2)">${window.FM.printName()}<span>${window.FM.printMeta()}</span></div></div></div>
          <div class="d3-sug">
            <div class="tx"><b>按文件事实给出的参数建议</b><p>按文件页数和纸张计算；采用后仍可修改。</p><div class="d3-sug-items"><span>颜色 · 黑白</span><span>单双面 · 单面</span><span>份数 · 1 份</span></div></div>
            <button class="d3-mini" data-d3="adopt">采用这些建议</button>
          </div>
          <div class="d3-facts"><b>总打印面 ${faces} 面</b><b>预计用纸 ${sheets} 张</b></div>
          ${p.duplex === 'double' ? `<p class="d3-opt">双面比单面预计少用 ${save} 张纸</p>` : ''}
          <div class="pager"><button aria-label="上一页" data-d3="page" data-arg="-1" ${(S().pvPage || 1) <= 1 ? 'disabled' : ''}>${icon('chevL', 30, 2.4)}</button><span>第 ${S().pvPage || 1} 页 / 共 2 页</span><button aria-label="下一页" data-d3="page" data-arg="1" ${(S().pvPage || 1) >= 2 ? 'disabled' : ''}>${icon('chevR', 30, 2.4)}</button></div>
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
        } else if (b.dataset.d3 === 'page') {
          S().pvPage = Math.min(2, Math.max(1, (S().pvPage || 1) + (+b.dataset.arg)));
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
    notes: { does: '运行页核对价格 PrintConfirmPage。直接打开这一屏时 S.ctx 默认是简历来路，示例走简历是正常的。本屏默认画 0 元单：核对打印内容，确认后直接打印。S().fee 为真时画收费点位。', motion: '无循环动画。', keep: '0 元才写「免费试运营，本单 0 元」，主按钮「确认并打印」去 printing。S().fee 为真时费用行写「应付 2.00 元」，小字「金额以订单为准」，数字「2.00 元」，不写免费；金额从订单读，示例不代表价目。打印机在线且金额大于 0 时主按钮「去付款」去 cashier。打印机离线时按钮仍是「打印机离线」，不送去收银台。不逐行改，退回用「返回修改」。问小青写「问小青：核对这单」，避免被截断。另外三种状态本屏不画，运行页有：非 0 元才有权益，核销失败时按钮是「去我的权益 / 按实际原价继续」（PrintConfirmPage.tsx:600-603）。本机没开通的彩色或双面会改成黑白或单面再报价，并逐项说明。同一份交接已经建过单时不再建第二单，已建单那一屏给「我的打印订单」和「回到这一单」。' },
    render: () => {
      const p = S().print, ctx = S().ctx, off = printerOff(), charged = !!S().fee;
      const name = ctx === 'report' ? '面试练习报告-新媒体运营.pdf' : ctx === 'resume' ? '李佳怡-简历（改后）.pdf' : ctx === 'policy' ? '材料清单-高校毕业生一次性求职创业补贴.pdf' : (S().printDoc && S().printDoc.name) || '毕业生就业推荐表（已填写）.pdf';
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
          ${charged ? '<div class="fee rise" style="--i:1"><div><b>应付 2.00 元</b><div style="font-size:22px;color:var(--ink-2)">金额以订单为准</div></div><span class="num">2.00 元</span></div>' : '<div class="fee rise" style="--i:1"><div><b>费用</b><div style="font-size:22px;color:var(--ink-2)">免费试运营，本单 0 元</div></div><span class="num">0 元</span></div>'}
          <div class="remind rise" style="--i:2;background:var(--teal-wash);color:var(--teal-ink)">${icon('printer', 34, 2)}<span>提交后请留在机器旁，任务确认后自动开始打印。</span></div>
          ${fine('隐私检查仅用于本次打印前确认，扫描件 / 图片可能经第三方 OCR 识别文字。')}`,
        dock: { backLabel: '返回修改', ask: '问小青：核对这单', pri: { label: off ? '打印机离线' : (charged ? '去付款' : '确认并打印'), go: off || !charged ? 'printing' : 'cashier', kind: 'pri wide', disabled: off } }, nav: null, navAdvisor: 1
      });
    }
  });
  add('printing', '打印扫描', '出纸中', {
    notes: { does: '运行页打印进度。进页先说正在确认任务状态。只有服务端回报正在打印才写正在出纸。演示事件 done 去 done，unconfirmed 去 unconfirmed。45 秒没有新进度留在本屏。', motion: '插画只保留机身，不做出纸动画，不自己走到完成。', keep: '四段是提交任务、排队等待、打印中、完成取件。当前段是「提交任务」，完成段在进行中不点亮。默认说明「纸从打印机出纸口出来。超过 45 秒没有新进度，这里会说明下一步怎么办。」文件卡写「2 张 · 黑白 · 单面 · 1 份」和订单号 ORD-20261026-0418，都从这一单读。S().fmQuiet 为真时，进度条不改成失败，也不报成功。说明改成看出纸口，并给服务电话 183-6916-1921。号码与服务时间从后台读，读不到不显示。这一态不是失败，大约 10 分钟后由服务端收口。运行页原文在 printProgressModel.ts 第 235 到 236 行，其中的现场求助口径本稿不沿用。底部这一页没有导航。' },
    render: () => {
      const quiet = !!S().fmQuiet;
      return F({
        band: { kind: 'compact', eyebrow: '打印进度', title: '正在确认任务状态', sub: '任务已提交，正在读取终端状态，请留在机器旁', seal: null, place: ' ', status: { text: '正在确认任务状态' } },
        cls: 'printing d3-printing' + (quiet ? ' fm-q' : ''),
        body: `<div class="d3-psec"><b>打印进度</b><span>状态来自打印服务，每 3 秒更新</span></div>
        <div class="d3-psteps" id="pst"><div class="s on"><span class="n">1</span><b>提交任务</b><em>完成</em><small>已创建打印任务，本次无需支付</small></div><div class="s now"><span class="n">2</span><b>排队等待</b><em>确认中</em><small>正在确认这台机器有没有领到任务</small></div><div class="s"><span class="n">3</span><b>打印中</b><em>未开始</em><small>终端开始打印后才会出纸</small></div><div class="s"><span class="n">4</span><b>完成取件</b><em>未开始</em><small>确认完成后自动转到取件核对</small></div></div>
        <div class="printer-wrap"><div class="printer">${UI.mfp()}</div></div>
        ${quiet ? '<p class="d3-pend">超过 45 秒没有新进度。这一页不会把它记成失败，也不会自己报成功。</p><p class="fm-quiet" id="pmsg">这台机器暂时没有回报打印进度，请看出纸口。需要帮助？拨打服务电话 183-6916-1921。</p>' : '<p class="d3-pend">任务还没打完，完成后才能结束清空。这一页不会自己报成功。</p><p class="fine" id="pmsg">纸从打印机出纸口出来。超过 45 秒没有新进度，这里会说明下一步怎么办。</p>'}
        <div class="filecard"><span class="ft">PDF</span><div>${window.FM.printName()}<small>2 张 · 黑白 · 单面 · 1 份 · 订单号 ORD-20261026-0418</small></div></div>`,
        dock: { back: false, ask: '问小青：取纸或异常怎么办' }, nav: null, navAdvisor: 1
      });
    },
    demo: [{ label: '演示：出纸完成', ev: 'done' }, { label: '演示：打印机没有回报', ev: 'unconfirmed' }, { label: '演示：45 秒没有新进度', ev: 'quiet' }],
    mount: (el) => {
      const on = (e) => {
        if (e.detail === 'done') window.go('done');
        else if (e.detail === 'unconfirmed') window.go('unconfirmed');
        else if (e.detail === 'quiet') { S().fmQuiet = true; window.__proto.refresh(); }
      };
      el.addEventListener('proto-demo', on);
      return () => el.removeEventListener('proto-demo', on);
    }
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
          ${tile({ icon: 'message', tone: 'slate', title: '反馈问题', desc: '不用登录也能写' }).replace('<button ', '<button data-fl="fb" ')}
        </div>
        <button class="btn sec" data-go="print-src" style="height:80px">再印一份</button>
        <p class="fine" style="margin-top:-6px">重新选文件后再确认。免费试运营。</p>
        ${fine('需要帮助？拨打服务电话 183-6916-1921。不再点屏幕，60 秒后结束本次使用；点一下屏幕重新计时。')}`,
      dock: { back: false, ask: '问小青：怎么取纸', left: `<div class="cdring">${UI.ring(1, 96, 8)}<b id="cd">60</b></div>`, mid: `<button class="btn danger wide" id="endUse" style="flex:1">${icon('erase', 32, 2.2)}我拿走了，结束使用</button>` }, nav: null, navAdvisor: 1
    }) + window.FM.layerFor(['done']),
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
    notes: { does: '运行页到机码核销 PrintPickupClaimPage。屏上数字键盘输入到机码，输满后确认校验。键盘下方有「历史 10 位码」切换和「用扫码枪扫」说明。', motion: '每输一位格子亮起；码不对时格子左右轻晃两下（320 毫秒）。', keep: '胶囊「到机码验证」（PrintPickupClaimPage.tsx:283）。不写演示口令，不把说明卡上的数字画成可核销的码。原句「这一步不收钱 · 输错可以改，不作废」放在键盘下方，后面加手机到店单：「在手机小程序下的单，到这里输到机码取件；没付款的在这台机器上付」。这句属「手机上能看到」，小程序发布前由开关 support.miniappPublished 收起，不显示。运行页 PickupHidGuide.tsx 第 81 行「打开小程序里的到机码页面」目前没走这个开关，改程序时补上；这一句本稿不画在屏上。历史码运行页是「输入历史码」，10 位，字母不含 0、O、1、I、L，按钮「← 回到 8 位新码键盘」。整副字母键盘会挤出这一屏，只做 10 格切换和一行说明，数字键仍可输入。app.js 的 key 动作把长度封在 8，历史码这一态在本屏截下按键，自己计到 10 位。扫码说明用运行页原句：不用手输，把手机上的码对准机身侧面的扫码区；手机亮度调高，再凑近扫码区（PrintPickupClaimPage.tsx:473-475）。点「用扫码枪扫」在说明卡里展开这句，不另加一块高度。' },
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
          <p class="fine">这一步不收钱 · 输错可以改，不作废。在手机小程序下的单，到这里输到机码取件；没付款的在这台机器上付</p>`,
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
    notes: {
      does: '对应 /scan 选类型。三张卡只改选中：简历扫描、证件扫描、普通文档。主按钮才建立这次扫描。',
      motion: '无。',
      keep: '顶栏「可创建扫描任务 · 需面板操作」。正在确认、暂未开放、读不到用 fsGate；扫描到 U 盘整页用 fsUsb，并写暂未开通。不预告生成 PDF。未登录不进我的文档。直接打开本屏是放行态。从这里点下一步会把指引设成先确认授权。顶栏返回、问小青、底部导航离开时先记下要撤销未完成任务。小青不可用时仍可手动选。出错停在暂未开放或读不到，主路改去上传文件。号码与服务时间从后台读，读不到不显示。无操作约 3 分钟清除，屏上不演倒计时。'
    },
    demo: () => window.FS.scanTypeDemo(),
    render: () => window.FS.scanType(),
    mount: (el) => window.FS.mount(el)
  });
  add('scan-guide', '打印扫描', '扫描：扫描指引', {
    notes: {
      does: '对应 /scan?stage=settings。直接打开是已授权的面板步骤；从选类型进来先停在投递授权未确认。',
      motion: '有效期数字每秒改一格，只改文字，不循环高亮。',
      keep: '步骤用下发原文，菜单是「扫描到 SMB」。屏上「回到本屏幕」写成「回到这台机器」。屏上不放示意图，也不写改程序时统一；下发示意图的菜单名是「扫描到 网络文件夹」，和步骤不一致，改程序时统一。普通文档原文里的「自动生成 PDF」原样留在步骤里，屏上不再另写两句不一致；结果页不把 PDF 当保证。有效期 10 分钟。不写输稿器页数上限。创建中、创建失败、过期用 fsGuide。安全重扫只写带着凭据申请，不写已经放行。主按钮「我已操作，开始等待」。顶栏返回、问小青、底部导航离开会撤销未完成任务。小青不可用时仍按步骤手动操作。失败可重新建立或回选类型。号码与服务时间从后台读，读不到不显示。无操作约 3 分钟清除。'
    },
    demo: () => window.FS.scanGuideDemo(),
    render: () => window.FS.scanGuide(),
    mount: (el) => window.FS.mount(el)
  });
  add('scan-wait', '打印扫描', '扫描：等回传', {
    notes: {
      does: '对应 /scan?stage=progress。已授权时等待回传；取消和立即检查是本屏动作。',
      motion: '查询次数和已等待每 3 秒改数字，不跳结果，不循环高亮。',
      keep: '每 3 秒查一次，最长等 10 分钟。屏上只写这一句，不写页级进度、不写百分比。不写通常几十秒内能好。取消要再点一次才发出；系统没回之前不说已经取消。立即检查只加一次查询。查状态失败留在本屏，不改判。演示事件 done 进结果成功，timeout 进结果失败。授权未确认时主按钮是「再确认一次」，不给立即检查。顶栏返回、问小青、底部导航离开会撤销未完成任务。小青不可用时仍可等、查、取消。号码与服务时间从后台读，读不到不显示。无操作约 3 分钟清除。屏上不自己跳成功。'
    },
    demo: () => window.FS.scanWaitDemo(),
    render: () => window.FS.scanWait(),
    mount: (el) => window.FS.mount(el)
  });
  add('scan-result', '打印扫描', '扫描：扫描完成', {
    notes: {
      does: '对应 /scan?stage=result。直接打开是简历扫描成功；fsResult=timeout、incomplete、nofile 是三张失败帧。',
      motion: '无。',
      keep: '文件名、格式、大小、页数从结果读。示例：王晓婷-产品运营简历.pdf、居民身份证-正反面.jpg、实习证明-青序文化-2026.pdf。拿去打印去 pii（运行页 /print/desk?step=check）。简历才可点 AI 简历识别，去 reading；其他类型按钮停用但还在。未登录不去登录，文档按钮停用。重新扫描是普通新会话。失败帧同时给「重新开始一次扫描」和「重试扫描（同一份材料）」。两小时重复件拒收只写在失败说明。整屏查看可翻页、适宽；打不开不改判。顶栏返回、问小青、底部导航离开会撤销未完成任务。小青不可用时打印和重扫仍在，识别仍去 reading 由那一屏退化。成功页无操作约 1 分 30 秒清除。号码与服务时间从后台读，读不到不显示。'
    },
    demo: () => window.FS.scanResultDemo(),
    render: () => window.FS.scanResult(),
    mount: (el) => window.FS.mount(el)
  });
  add('copy', '打印扫描', '复印（在打印机上）', {
    notes: {
      does: '对应 /print-scan/feature/copy。五步和三条原件同时摆出，没有成功页。',
      motion: '无。',
      keep: '面板按钮名是复印、身份证复印、票据复印。开始是屏幕上的「复印」。双面写放回进纸口、不翻面。身份证怎么放、怎么翻面，屏上只写请看打印机屏幕上的图示。法律两句都在。取回原件用服务电话，不写现场岗位。主按钮「去打印文件」去 print-src。底栏回 print。不读打印机缺纸。小青不可用时五步仍可照做。能力名不认识不画在这里，在证件照屏 fsFeat=unknown。号码与服务时间从后台读，读不到不显示。无操作约 3 分钟清除。'
    },
    render: () => window.FS.copy(),
    mount: (el) => window.FS.mount(el)
  });
  add('img2pdf', '打印扫描', '照片合成 PDF', {
    notes: {
      does: '对应 /print-scan/convert。直接打开是空列表。编辑、上传中、合成中、结果、结果未知、冲突、未开通、U 盘未接线用 fsPdf。',
      motion: '无。',
      keep: '空列表：一句说明，手机扫码传图片（打开二维码层），U 盘导入停用并写「暂未开通」，一行小字「最多 20 张，单张不超过 10MB，只收 JPG、PNG」。不预放照片。手机扫码打开二维码层，不设「我已上传」。排序、删除是本屏真动作，删除要再点一次。旋转按钮在，且停用。上限：20 张，JPG/PNG，单张 10MB，合计 40MB，成品 15MB，单张 2500 万像素，合计 2 亿像素。U 盘未接线；运行页写「改用本机上传」，一体机没有本机文件框，稿上写「回到手机扫码」。合成靠演示事件 done 进结果，不自己跳。结果未知用同一标记再查。完成态未登录才出现「先登录再转换」，合成本身不用先登录。拿这份 PDF 去打印去 pii。页数等于张数，不写纸型。文件名用运行页「格式转换-N张图片.pdf」。小青不可用时仍可加图、合成。空列表主按钮停用。能力未开整页说明后回 print。号码与服务时间从后台读，读不到不显示。编辑约 3 分钟、结果约 1 分 30 秒清除。'
    },
    demo: () => window.FS.img2pdfDemo(),
    render: () => window.FS.img2pdf(),
    mount: (el) => window.FS.mount(el)
  });
  add('policy', '查政策', '政策服务台', {
    before: 'policy',
    notes: {
      does: '运行页 /policy-service。主入口「查政策与公告」进 policy-list 的就业政策分区；四个目标进同一页的对应分区（核对申领条件进 policy-check）。常用入口是浏览记录、AI 服务记录、政策收藏、全部服务。',
      motion: '在线检查中和不可用只改可点范围，不自动跳成可用。重新检测回到检查中，等演示事件 up 或 down。',
      keep: '对应 serviceHubSpecs 的政策服务台。七张能力卡不重复铺：就业政策与四个目标同一路由；政策公告在列表分区，不在本页另放按钮；打开 AI 顾问是底栏问小青和导航「AI 顾问」，AI 停用仍进 xq，由问小青页退化。政策收藏放进常用入口，避免丢掉这一张。没有六个政策类别，没有最近更新。社保指南、档案与登记、全部服务在在线服务检查中或不可用时仍可进，其余停，原因「正在确认在线服务」或「在线服务当前不可用」。重新检测只在不可用时出现。本页不探测打印机，打印机离线也不改文案。胶囊「能力与设备状态以办理时确认为准」。首页「查政策」已能进这屏。帮助中心的入口是 policy-list，不是这屏。出错留在本屏；空列表在 policy-list。登记目标屏上写「失业登记、就业登记和档案转移」，不写「托管」。屏上不写开发用语。普通页闲置 3 分钟清除。号码与服务时间从后台读，读不到不显示。'
    },
    demo: () => window.FY.demo('policy'),
    render: () => window.FY.render('policy'),
    mount: (el) => window.FY.mount('policy', el)
  });
  add('policy-list', '查政策', '政策列表', {
    notes: {
      does: '运行页 /renshi 的五个分区：就业政策、条件核对、社保指南、就业登记、政策公告。身份六种在本屏筛选。政策库条目进 policy-detail；内置指引单独收在「通用办事指引」。',
      motion: '分区和身份就地切换。读取、打开某一条、重新读取都停在本屏，等演示事件，不自己变成成功。',
      keep: '字从发布数据读：标题、摘要、来源、同步时间。眉题只写「政策服务」，不写路由。已发布条目旁只用胶囊「示例」，不写「示例，运行时读…」。来源行写「合作机构发布 · 发布于日期 · 同步于日期」。列表默认 5 条，加载更多翻到下一页，类型、日期、状态各不相同。读取中用浅灰条「正在读取」。读取失败、政策库空、筛选无命中、公告空用说明加行动卡，不拉空卡。点名打开的三态（正在打开、这条打不开、这次没打开）都在这屏。重新读取回到读取中。筛选无命中不是库空。办事参考标「办事参考」，不能收藏。浏览和外链记录是运行页副作用，稿不弹「已记录」。条件核对入口去 policy-check，不使用 AI，AI 停用仍可进。未登录不影响阅读。主按钮「上传自备材料打印」去 print-src，对应运行页 /print/upload。底栏「仅信息指引，不代办」。普通页 3 分钟。号码与服务时间从后台读，读不到不显示。'
    },
    demo: () => window.FY.demo('policy-list'),
    render: () => window.FY.render('policy-list'),
    mount: (el) => window.FY.mount('policy-list', el)
  });
  add('policy-detail', '查政策', '政策详情', {
    notes: {
      does: '运行页 /renshi 里展开的一条。先看是否符合、需要准备材料、建议办理路径。收藏、来源二维码、上传自备材料、核对条件都是真去处。',
      motion: '收藏在本屏切换。来源二维码打开层。来源守卫三态停在本屏。',
      keep: '没有「打印材料清单」。核对条件去 policy-check，不判断能不能办，不使用 AI。政策库条目可收藏，只记在这台机器本次办理，办事参考不能收藏。没有来源地址时按钮停用，文案「发布方没有提供来源地址」。撤下、未确认、正在确认来源时不打开二维码。二维码是示例，不能扫；层内写明来源入口由发布方提供、扫码前核对机构和域名。眉题「就业政策」（办事参考为「办事指引」）。来源一行写「合作机构发布 · 发布于日期 · 同步于日期」。屏上写「小青还不能解释这条政策」，不写「未接入」。条件、材料各 5 条左右，和路径合成一张按内容撑开的卡。问小青仍在底栏，预填「问小青别的问题，不判断能不能办」。AI 停用、未登录都不挡阅读和核对。返回列表。普通页 3 分钟。号码与服务时间从后台读，读不到不显示。'
    },
    demo: () => window.FY.demo('policy-detail'),
    render: () => window.FY.render('policy-detail'),
    mount: (el) => window.FY.mount('policy-detail', el)
  });

  window.SCREENS = screens;
  window.SCREEN_GROUPS = ['公共', '改简历', '练面试', '打印扫描', '查政策'];
})();
