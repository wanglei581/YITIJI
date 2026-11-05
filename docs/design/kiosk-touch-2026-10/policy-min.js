/* policy-min.js：政策最小闭环（2026-11-05 定稿：产品负责人在方案页点「按方案开工」，批准最小闭环、
 * 停放 7 处、改触屏稿政策几屏，试点先保持所有终端都显示）。
 * 在第 5 版稿之上覆盖 policy / policy-list / policy-detail 三屏，另加 policy-empty。
 * 画法沿用 10/25 产品负责人认可的触屏稿第 3 版（density-1025 screens.js 774–811），
 * 改两处：类别换成机构发布时必填的「适用人群」六类；详情去掉「核对条件」，加「收藏到我的」。
 * 显示范围是所有终端，所以首页与空态不写「本机构」，每条政策各写自己的发布机构。
 * 打印确认沿用 confirm 屏的 ctx=policy（app.js:94）。条件核对、社保指南、就业登记等屏留在 fix-policy.js 作参考，程序里已停放。 */
(function () {
  const { icon, band, dock, nav, tile, qr, checklist } = UI;
  const S = () => window.S;
  const F = (o) => (o.band ? band(o.band) : '') + `<main class="body ${o.cls || ''}">${o.body}</main>` + (o.dock === false ? '' : (o.dockHtml || dock(o.dock || {}))) + (o.nav === false ? '' : nav(o.nav));
  const fine = (t) => `<p class="fine">${t}</p>`;
  const ORG = '某大学就业指导中心';
  const CATS = [
    { t: '应届高校毕业生', n: 4, last: '高校毕业生一次性求职创业补贴', ic: 'book' },
    { t: '创业扶持', n: 2, last: '创业担保贷款贴息', ic: 'sparkle' },
    { t: '灵活就业人员', n: 1, last: '灵活就业人员社会保险补贴', ic: 'clock' },
    { t: '困难群体就业援助', n: 1, last: '就业困难人员认定与援助', ic: 'shield' },
    { t: '返乡务工人员', n: 0, last: '', ic: 'map' },
    { t: '通用', n: 1, last: '职业技能培训补贴', ic: 'clipboard' }
  ];
  const LIST = [
    { t: '高校毕业生一次性求职创业补贴', sum: '毕业学年内、家庭困难等几类毕业生；材料 4 项', date: '11 月 5 日', tags: ['有材料清单', '可扫码看原文'] },
    { t: '离校未就业高校毕业生就业见习', sum: '离校两年内未就业，可报名到见习单位参加见习', date: '11 月 3 日', tags: ['有材料清单', '可扫码看原文'] },
    { t: '高校毕业生到基层就业学费补偿', sum: '到中西部和艰苦边远地区基层单位就业的毕业生', date: '10 月 28 日', tags: ['有材料清单'] },
    { t: '求职创业补贴申报常见问题', sum: '申报时间、材料补交和办理进度怎么查', date: '10 月 21 日', tags: ['可扫码看原文'] }
  ];
  const card = (c, i) => {
    const off = c.n === 0;
    return `<button class="cat rise" style="--i:${i};${off ? 'opacity:.55' : ''}" data-go="${off ? 'policy' : 'policy-list'}"><span class="ic">${icon(c.ic, 38, 2)}</span><b>${c.t}</b><small>${off ? '还没有机构发布' : `${c.n} 条 · 最近：${c.last}`}</small></button>`;
  };
  const R = {};
  R.policy = () => F({
    band: { eyebrow: '查政策 · 由各发布机构自行审核发布', title: '你想看哪一类？', sub: '每条都写了条件、材料和去哪办，可以打印成一页清单。', seal: 'idle', path: ['选类别', '看条件和材料', '打印清单或扫码看原文'], pathLabel: '查一条政策' },
    body: `<div class="grid2">${CATS.map(card).join('')}</div>
      <button class="rowlink rise" style="--i:7" data-go="policy-detail">${icon('bell', 32, 2)}<span><b>最近更新</b> <small>· 高校毕业生一次性求职创业补贴 · 11 月 5 日</small></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button>
      <button class="rowlink rise" style="--i:8" data-go="policy-list">${icon('message', 32, 2)}<span><b>机构公告</b> <small>· 2 条 · 只在有公告时出现</small></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button>
      ${fine('示例内容 · 条数从发布数据读；政策由发布机构自行审核发布，以官方原文为准')}`,
    dock: { ask: '问小青：这些政策怎么看？' }, nav: 'home'
  });
  R['policy-list'] = () => F({
    band: { eyebrow: '查政策 · 应届高校毕业生', title: '4 条政策', sub: '按更新时间排列 · 每条写明发布机构', seal: null },
    body: `<div class="stack">${LIST.map((p, i) => `<button class="pol rise" style="--i:${i}" data-go="policy-detail"><b>${p.t}</b><span class="sum">${p.sum}</span><div class="meta"><span>${icon('landmark', 22, 2)} ${ORG}</span><span>更新于 ${p.date}</span>${p.tags.map((t) => `<span class="chip slate" style="height:36px;font-size:20px">${t}</span>`).join('')}</div></button>`).join('')}</div>
      ${fine('示例内容 · 一页 4 条，多了点「再看 4 条」；以发布机构原文为准')}`,
    dock: { ask: '问小青：政策原文怎么看？' }, nav: 'home'
  });
  R['policy-detail'] = () => {
    const aiOff = S().ai === 'down';
    const ask = aiOff
      ? tile({ act: 'toast', arg: '小青暂时不可用；条件、材料、打印清单、扫码看原文都照常', icon: 'sparkle', title: '小青暂时不可用', desc: '条件、材料、打印、扫码照常' })
      : tile({ go: 'xq', icon: 'sparkle', title: '问小青这条', desc: '按这条原文解释，不判断能不能领' });
    const fav = S().logged
      ? tile({ act: 'toast', arg: '已存进「我的 · 收藏」', icon: 'folder', title: '收藏到「我的」', desc: '下次登录在「我的」里找到' })
      : tile({ go: 'login', icon: 'folder', title: '收藏到「我的」', desc: '先登录，存进本人账号' });
    return F({
      band: { kind: 'compact', eyebrow: `${ORG}发布 · 11 月 5 日`, title: '高校毕业生一次性求职创业补贴', seal: null },
      cls: 'tight',
      body: `<div class="dsec rise" style="--i:0"><h4>${icon('user', 30, 2)}谁可以申请</h4><ul><li>毕业学年内的普通高校毕业生</li><li>属于城乡低保家庭、脱贫家庭、残疾或获得国家助学贷款等情形之一</li><li>完整条件以发布机构原文为准</li></ul></div>
        <div class="dsec check rise" style="--i:1"><h4>${icon('clipboard', 30, 2)}要准备的材料</h4><ul><li>本人身份证</li><li>学生证或学籍证明</li><li>对应困难类型的证明材料</li><li>本人银行卡</li></ul></div>
        <div class="dsec rise" style="--i:2;display:flex;gap:26px;align-items:center"><div style="flex:1"><h4>${icon('landmark', 30, 2)}去哪办、看原文</h4><ul><li>学校就业指导中心统一申报（学生活动中心二楼）</li><li>补贴标准和申报时间以原文为准</li><li>扫码打开原文；链接发布时已核对属于发布机构登记的官方网站</li></ul></div><div style="display:flex;flex-direction:column;align-items:center;gap:6px">${qr(21, 200)}<span class="chip clay" style="height:34px;font-size:20px">示例码</span></div></div>
        <div class="grid2">${ask}${fav}</div>`,
      dock: { ask: false, pri: { label: '打印办事清单（1 页）', go: 'confirm', kind: 'pri wide' } }, nav: null
    });
  };
  R['policy-empty'] = () => F({
    band: { eyebrow: '查政策', title: '这里还没有发布的政策', sub: '机构在后台审核发布后，这里按类别列出，每条写清条件、材料和去哪办。', seal: 'idle', path: ['机构在后台发布', '这里按类别列出', '打印清单或扫码看原文'], pathLabel: '有政策以后' },
    body: `<div class="dsec rise" style="--i:0;display:flex;gap:30px;align-items:center;min-height:700px"><div style="flex:1"><h4>${icon('landmark', 30, 2)}政策由谁发布</h4><ul><li>政策由发布机构在机构后台自己审核、发布，并对内容负责</li><li>本机不自己编写政策，也不拿别处的内容顶替</li><li>有了政策，可以在这里打印一页办事清单带走，或扫码看原文</li></ul></div><div style="display:flex;flex-direction:column;align-items:center;gap:10px">${checklist(300)}<span class="chip slate" style="height:36px;font-size:20px">有政策后可打印这样一页</span></div></div>
      <div class="grid2"><button class="cat rise" style="--i:1" data-go="xq"><span class="ic">${icon('sparkle', 38, 2)}</span><b>问小青</b><small>问通用问题；不解释具体政策，不判断能不能领</small></button><button class="cat rise" style="--i:2" data-go="home"><span class="ic">${icon('home', 38, 2)}</span><b>回首页办别的事</b><small>打印、扫描、改简历、练面试照常</small></button></div>
      ${fine('空态照实写；全库为 0 条时整屏换成这一屏，不显示类别卡')}`,
    dock: { ask: false }, nav: 'home'
  });
  const NOTES = {
    policy: { does: '先选类别（机构发布时必填的适用人群六类），卡上写真实条数和最近一条；0 条的类别变灰、写「还没有机构发布」。最近更新一条；机构公告只在有公告时出现。', motion: '类别卡依次浮入。', keep: '条数、标题都从发布数据读；全库为 0 时整屏换成 policy-empty。不放条件核对、社保指南、就业登记、本机整理的办事参考。' },
    'policy-list': { does: '一类下面的政策，每条写发布机构、更新时间、一句摘要。一页 4 条，多了点「再看 4 条」；少于 3 条时下方放「可以打印一页办事清单」小样补位，不拉空卡。', motion: '列表依次浮入。', keep: '发布机构和更新时间常驻每一条。' },
    'policy-detail': { does: '谁可以申请 / 要准备的材料 / 去哪办看原文三块，来自机构发布时填的三栏；主按钮打印一页办事清单；问小青按这条原文解释；收藏进本人账号。', motion: '三块依次浮入。', keep: '没有原文链接时二维码换成「发布机构没有提供原文链接」；小青不可用时其他照常；不判断能不能领。' },
    'policy-empty': { does: '还没有任何机构发布政策时的整屏空态。', motion: '无。', keep: '照实写空，不拿内置内容顶替；给两条出路。' }
  };
  const list = window.SCREENS;
  for (const id of ['policy', 'policy-list', 'policy-detail']) {
    const s = list.find((x) => x.id === id);
    if (s) { s.render = R[id]; s.notes = NOTES[id]; delete s.mount; delete s.demo; s.name = s.name + '（最小闭环）'; }
  }
  list.push({ id: 'policy-empty', group: '查政策', name: '政策空态（最小闭环）', notes: NOTES['policy-empty'], render: R['policy-empty'] });
})();
