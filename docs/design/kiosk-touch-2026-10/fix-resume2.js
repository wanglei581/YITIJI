/* fix-resume2.js：第二轮只改屏上的样子和字，状态机和演示事件保留。类名一律 fr-。 */
(function () {
  const { icon, band, dock, nav } = UI;
  const S = () => window.S;
  const F = (o) => (o.band ? band(o.band) : '') + (o.pre || '') + `<main class="body ${o.cls || ''}">${o.body}</main>` + (o.dock === false ? '' : (o.dockHtml || dock(o.dock || {}))) + (o.nav === false ? '' : (o.navAdvisor ? nav(o.nav).replace('<span>问小青</span>', '<span>AI 顾问</span>') : nav(o.nav)));
  const HELP = '需要帮助？拨打服务电话 183-6916-1921';
  const STEPS = ['基本信息', '求职意向', '教育经历', '工作经历', '项目经历', '技能证书'];
  const DIMS = ['兴趣偏好', '工作风格', '团队偏好', '价值取向', '求职动机'];
  const SA = [
    ['在日常学习中，你更愿意花时间深入了解哪类内容？', '解决具体的工程问题', '与不同岗位背景的人沟通协作', '梳理数据并得出结论'],
    ['你更愿意花精力打磨哪种类型的产出？', '可运行的产品或代码', '清晰可读的文档或方案', '对外发布的稿件或讲解'],
    ['在团队合作中，你更喜欢扮演哪种角色？', '推动事情落实落地的执行者', '提出思路与可能性的探索者', '把控节奏与方向的协调者'],
    ['面对新工具、新框架，你的反应更接近？', '先跑通一个最小版本', '先读官方文档或权威说明', '观察他人使用后的反馈再决定'],
    ['什么样的工作内容会让你更愿意主动加班？', '用户反馈推动的迭代与上线', '某个长期项目的关键节点', '研究和学习新的技术方向'],
    ['面对一项陌生任务，你更习惯的处理方式是？', '先列出清单，再按顺序推进', '先尝试一种思路，不行再调整', '先了解背景与约束再动手'],
    ['你更喜欢的反馈方式是？', '书面、明确、可回看', '面对面、当场讨论', '每周一次的复盘节奏'],
    ['面对多个并行任务，你更倾向？', '先排好优先级，再依次推进', '把可合并的并行处理', '按截止日期自然推进'],
    ['你更喜欢的工作节奏是？', '有规律、有计划', '弹性、按状态切换', '短冲刺、目标驱动'],
    ['独立完成一件事和与他人合作，你更喜欢？', '可独立完成一段再到协作', '一直与他人并行协作', '视任务性质切换'],
    ['在团队会议里你更常扮演哪种角色？', '记录与跟进结论的执行者', '提出不同视角的提问者', '促成共识的协调者'],
    ['与不同背景的同事协作时，你更看重？', '清晰的责任边界', '充分的背景信息共享', '互相补位的灵活度'],
    ['出现分歧时你更愿意？', '用数据或事实讨论', '先认同动机再讨论方案', '由决策者拍板'],
    ['你更欣赏的团队文化是？', '目标清晰、节奏稳定', '鼓励尝试、容错度高', '信息透明、人人发言'],
    ['团队规模变大时你的适应方式？', '用流程保证一致性', '用文档沉淀信息', '和小范围伙伴保持紧密沟通'],
    ['工作中你更看重？', '把事做成的能力', '持续学习的空间', '被信任的归属感'],
    ['在选择工作机会时，你更看重？', '与日常生活的平衡', '成长速度与挑战', '稳定的长期发展'],
    ['你更认可的工作成果是？', '可量化、可衡量的产出', '对用户体验明显的改进', '为团队建立长期能力'],
    ['面对工作与生活冲突时你倾向？', '先稳住生活质量', '按阶段冲刺', '视重要性灵活切换'],
    ['你更看重什么样的认可？', '具体任务上的反馈', '长期能力的提升', '稳定的合作机会'],
    ['对这一轮求职，你当前最想推进的是？', '明确下一份工作的方向', '找到能长期投入的事业', '获得一次稳定的过渡机会'],
    ['下一份工作最希望给你带来？', '解决日常生计的稳定保障', '明确可感知的成长', '与背景相称的合适岗位'],
    ['回顾当前情况，你想改进的更多是？', '求职节奏与渠道', '简历表达与亮点提炼', '方向选择与判断'],
    ['你在意下一份工作的工作环境吗？', '在意具体的环境与作息', '在意合作氛围', '在意发展与晋升空间'],
    ['对未来的工作，你最希望？', '在熟悉领域继续深耕', '尝试一个相邻的新方向', '先积累一段时间再调整']
  ];
  const TPLS = [
    { name: '清爽单栏', cat: 'resume', desc: '单栏。经历不长时比较好读', cols: '单栏', sections: ['基本信息', '个人总结', '教育经历', '工作/实习经历', '项目经历', '技能', '证书'] },
    { name: '左栏信息', cat: 'resume', desc: '双栏。联系方式放在左栏', cols: '双栏', sections: ['基本信息', '技能', '证书', '教育经历', '工作/实习经历', '项目经历', '个人总结'] },
    { name: '正式单栏', cat: 'resume', desc: '单栏。经历比较多时用', cols: '单栏', sections: ['基本信息', '个人总结', '工作/实习经历', '项目经历', '教育经历', '技能', '证书'] },
    { name: '通用说明', cat: 'common', desc: '通用素材，不是简历版式', cols: '不分区', sections: ['基本信息', '个人总结'] }
  ];
  const MAT_TYPES = ['求职信', '感谢信', '作品集封面', '材料清单'];
  const MAT_TPL = {
    '求职信': [['校招通用', '一页，写给用人单位的自我介绍'], ['有实习经历', '突出一段实习，不编没写过的事'], ['简洁版', '只留最关键的三点']],
    '感谢信': [['一面之后', '写给当天见过的面试官'], ['实习结束', '离开一段实习时用'], ['简洁版', '短函，三五句']],
    '作品集封面': [['作品三则', '封面加三则作品名'], ['单页封面', '只做一页封面'], ['简洁版', '姓名、岗位、联系方式']],
    '材料清单': [['校招材料', '按校招常备材料列清单'], ['实习材料', '按实习申请列清单'], ['简洁版', '只列必须带的']]
  };
  const FILL = {
    name: ['frName', '周宁'], city: ['frCity', '青岛'], phone: ['frPhone', '13812346217'], mail: ['frMail', 'ning.zhou@foxmail.com'],
    pos: ['frPos', '内容运营'], icity: ['frICity', '青岛'], pay: ['frPay', '8k-12k'],
    school: ['frSchool', '青岛大学'], major: ['frMajor', '汉语言文学'], company: ['frCompany', '青岛海禾文化'], duty: ['frDuty', '新媒体实习生'],
    role: ['frRole', '内容运营'], req: ['frReq', '本科及以上，新闻、中文或市场营销相关；有公众号或短视频运营经验；能独立完成一条内容栏目。'],
    mname: ['frMName', '周宁'], mrole: ['frMRole', '内容运营'], morg: ['frMOrg', '青岛海禾文化'], mstr: ['frMStr', '做过学院公众号的选题和排版，能独立完成一条推送。'], mnote: ['frMNote', '希望参与内容栏目，不代写没做过的项目。']
  };
  const SELF3 = [
    '技能栏里没有事例撑着的词，先删掉 ——「团队协作」「项目管理」这类，正文里找不到对应的事就是虚的。这个判断不用 AI，你自己对着简历看一遍就知道。',
    '每段经历问自己一句「结果是什么」—— 写了做什么、没写做成什么，是最常见的一处。有数字写数字，没数字写变化。',
    '会做但简历里没写的，去简历工作台补上 —— 本机读不到的能力不是你不会，是简历没写。'
  ];

  const css = document.createElement('style');
  css.id = 'fr-style';
  css.textContent = `
.body.fr-page{justify-content:flex-start;align-items:stretch;gap:12px;padding:16px 40px 14px;overflow:hidden}
.body.fr-page>.fr-hero,.body.fr-page>.fr-acts,.body.fr-page>.fr-skels,.body.fr-page>.fr-tplgrid,.body.fr-page>.fr-wall,.body.fr-page>.fr-exits{flex:1;min-height:0}
.fr-kicker{flex:none;display:flex;align-items:center;gap:10px;min-height:40px}
.fr-hero,.fr-act,.fr-tpl,.fr-kind,.fr-login{background:var(--card);border:1.5px solid var(--edge);border-radius:28px;overflow:hidden;text-align:left}
.fr-hero{display:flex;flex-direction:column}
.fr-hero .art,.fr-act .vis,.fr-tpl .art,.fr-kind .vis,.fr-login .vis{position:relative;min-height:0;background:var(--well);overflow:hidden}
.fr-hero .art,.fr-tpl .art,.fr-kind .vis{flex:1}
.fr-hero .art svg,.fr-act .vis svg,.fr-tpl .art svg,.fr-kind .vis svg,.fr-login .vis svg{position:absolute;left:0;right:0;top:0;bottom:0;margin:auto;height:92%;width:auto;max-width:86%}
.fr-hero .tx,.fr-tpl .tx,.fr-kind .tx,.fr-login .tx{flex:none;display:flex;flex-direction:column;justify-content:center;gap:4px;padding:14px 20px 16px}
.fr-act .tx{flex:1;display:flex;flex-direction:column;justify-content:center;gap:8px;padding:22px 28px;min-width:0}
.fr-act .tx:has(.fr-go){flex-direction:row;align-items:center;justify-content:space-between;gap:20px}
.fr-act .tx:has(.fr-go)>div{min-width:0;flex:1}
.fr-go{display:block;flex:none;max-width:240px;font-size:22px;line-height:1.3;font-weight:700;color:var(--teal-ink);text-align:right}
.fr-hero .tx p,.fr-act .tx small,.fr-tpl .tx small,.fr-kind .tx small,.fr-login .tx small{margin:0;font-size:24px;line-height:1.35;color:var(--ink-2)}
.fr-k{display:block;margin:0;font-size:20px;line-height:1.3;color:var(--teal-ink);font-weight:700}
.fr-hero .tx .fr-name{font:700 40px/1.25 var(--serif);color:var(--ink)}
.fr-hero .tx .fr-name.fr-need{color:var(--clay-ink)}
.fr-name{margin:0;font:700 40px/1.25 var(--serif);overflow-wrap:anywhere}
.fr-name.fr-need,.fr-ph.fr-need{color:var(--clay-ink)}
.fr-acts{display:flex;flex-direction:column;gap:12px}
.fr-act{flex:1;min-height:0;display:flex;flex-direction:row;align-items:stretch;padding:0;width:100%}
.fr-act .vis{flex:none;width:280px;align-self:stretch}
.fr-acts.fr-n2 .fr-act .vis{width:400px}
.fr-acts.fr-solo .fr-act{flex-direction:column}
.fr-acts.fr-solo .fr-act .vis{width:auto;flex:1}
.fr-acts.fr-solo .fr-act .tx,.fr-exits .fr-act .tx{flex:none;width:auto}
.fr-acts.fr-solo .fr-act .tx:has(.fr-go){flex-direction:column;align-items:flex-start}
.fr-acts.fr-solo .fr-go{text-align:left;max-width:none}
.fr-act .tx b,.fr-tpl .tx b,.fr-kind .tx b,.fr-login .tx b{display:block;font:700 36px/1.25 var(--serif);overflow-wrap:anywhere}
.fr-act .tx small{display:block}
.fr-acts.fr-solo .fr-act .tx b{font-size:40px}
.fr-act:active,.fr-tpl:active,.fr-field:active,.fr-btn:active,.fr-choice:active,.fr-login:active,.fr-ben:active{transform:scale(.98)}
.fr-form{display:grid;grid-template-columns:1fr 1fr;gap:12px;flex:none}
.fr-field{min-height:88px;padding:10px 16px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge);text-align:left;display:flex;flex-direction:column;justify-content:center;gap:2px}
.fr-field.fr-wide{grid-column:1/-1}
.fr-field small{font-size:20px;color:var(--ink-3);line-height:1.3}
.fr-field b{font:700 26px/1.3 var(--serif);display:block;overflow-wrap:anywhere}
.fr-ph{color:var(--ink-3);font-family:var(--sans);font-weight:600;font-size:22px}
.fr-bad{border-color:var(--cinnabar)}
.fr-btn{min-height:72px;width:100%;border-radius:22px;background:var(--card);border:1.5px solid var(--edge);font:700 22px/1.3 var(--sans);padding:10px 16px;text-align:left;white-space:normal}
.fr-btn[aria-pressed="true"]{background:var(--deep);color:var(--cream);border-color:var(--deep)}
.fr-btn[disabled],.fr-act[disabled]{opacity:.42;pointer-events:none}
.fr-rowbtns{display:flex;gap:10px;flex:none}
.fr-rowbtns .fr-btn{flex:1;width:auto;text-align:center;min-height:80px}
.fr-skels{display:flex;flex-direction:column;gap:12px}
.fr-bar{flex:1;min-height:0;border-radius:22px;background:var(--well);display:flex;align-items:center;padding:0 24px;font-size:22px;color:var(--ink-3)}
.fr-tplgrid{display:grid;gap:12px}
.fr-tplgrid.fr-n1{grid-template-columns:1fr;grid-template-rows:1fr}
.fr-tplgrid.fr-n2{grid-template-columns:1fr 1fr;grid-template-rows:1fr}
.fr-tplgrid.fr-n3,.fr-tplgrid.fr-n4{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}
.fr-tplgrid.fr-n3 .fr-tpl:last-child{grid-column:1/-1}
.fr-tpl{min-height:0;display:flex;flex-direction:column;padding:0;width:100%}
.fr-tpl.on{box-shadow:inset 0 0 0 4px var(--teal)}
.fr-tpl .tx,.fr-kind .tx{padding:12px 16px 14px}
.fr-tags{display:flex;flex-wrap:wrap;gap:8px}
.fr-tag{display:inline-flex;align-items:center;min-height:36px;padding:0 12px;border-radius:18px;background:var(--teal-wash);color:var(--teal-ink);font-size:20px;font-weight:700}
.fr-warn{background:var(--clay-wash);color:var(--clay-ink)}
.fr-wall{display:flex;flex-direction:column;gap:12px}
.fr-kinds{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:12px}
.fr-kind{min-height:0;display:flex;flex-direction:column}
.fr-login{flex:none;display:flex;flex-direction:column;width:100%;padding:0}
.fr-login .vis{height:190px;flex:none}
.fr-bens{flex:none;display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.fr-ben{height:180px;border-radius:24px;background:var(--card);border:1.5px solid var(--edge);padding:16px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;text-align:left}
.fr-ben .ic{width:64px;height:64px;border-radius:18px;background:var(--teal-wash);color:var(--teal-ink);display:grid;place-items:center}
.fr-ben b{font-size:24px;line-height:1.3}
.fr-ben small{font-size:20px;line-height:1.3;color:var(--ink-2)}
.fr-rows{flex:none;display:flex;flex-direction:column;gap:8px}
.fr-row,.fr-rowbtn{min-height:80px;border-radius:20px;background:var(--card);border:1.5px solid var(--edge);padding:10px 16px;display:flex;flex-direction:column;justify-content:center;gap:2px;text-align:left;width:100%}
.fr-row b,.fr-rowbtn b{font-size:22px;line-height:1.3;font-weight:700}
.fr-row small,.fr-rowbtn small{font-size:20px;line-height:1.35;color:var(--ink-2)}
.fr-score{flex:none;min-height:84px;padding:8px 14px;border-radius:18px;background:var(--card);border:1.5px solid var(--edge);display:flex;flex-direction:column;gap:4px}
.fr-score .h{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.fr-score b{font-size:22px}
.fr-score .n{font-size:22px;font-weight:700;color:var(--teal-ink);flex:none}
.fr-score small{font-size:20px;color:var(--ink-2)}
.fr-meter{display:block;height:10px;border-radius:5px;background:var(--well);overflow:hidden}
.fr-meter i{display:block;height:100%;background:var(--teal);border-radius:5px}
.fr-note{flex:none;padding:12px 16px;border-radius:20px;background:var(--well);text-align:left}
.fr-note b{display:block;font-size:22px;line-height:1.3;margin-bottom:4px}
.fr-note span{display:block;font-size:22px;line-height:1.4;color:var(--ink-2)}
.fr-term{flex:none;min-height:76px;display:flex;gap:12px;align-items:center;padding:8px 14px;border-radius:18px;background:var(--card);border:1.5px solid var(--edge);text-align:left}
.fr-term .n{width:48px;height:48px;border-radius:50%;background:var(--teal-wash);color:var(--teal-ink);display:grid;place-items:center;font:700 22px var(--sans);flex:none}
.fr-term b{font-size:22px;line-height:1.35}
.fr-q{flex:none;display:flex;flex-direction:column;gap:12px}
.fr-choice{min-height:112px;display:flex;align-items:center;gap:14px;padding:12px 16px;border-radius:22px;background:var(--card);border:2px solid var(--edge);text-align:left}
.fr-choice .ck{width:64px;height:64px;border-radius:50%;background:var(--well);display:grid;place-items:center;font:700 26px var(--sans);flex:none}
.fr-choice b{font-size:24px;line-height:1.35}
.fr-choice.on{border-color:var(--teal);background:var(--teal-wash)}
.fr-choice.on .ck{background:var(--teal);color:#fff}
.fr-exits{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:12px}
.fr-exits .fr-act{height:100%;flex-direction:column}
.fr-exits .fr-act .vis{width:auto;flex:1}
.fr-phone{flex:none;height:180px;display:flex;align-items:center;justify-content:center;background:var(--well);border-radius:22px}
.fr-dialog{width:880px;max-height:1280px;overflow:auto;background:var(--card);border-radius:32px;padding:22px 24px;display:flex;flex-direction:column;gap:10px;text-align:left}
.fr-dialog h2{margin:0;font:700 36px/1.25 var(--serif)}
.fr-dialog p{margin:0;font-size:22px;line-height:1.4;color:var(--ink-2)}
.fr-actions{display:flex;gap:12px}
.fr-actions .btn{flex:1}
.fr-more[hidden]{display:none !important}
.fr-more{display:flex;flex-direction:column;gap:10px;flex:none}
`;
  document.head.appendChild(css);

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const on = (v) => v === true || (typeof v === 'string' && v.length > 0);
  const val = (key, sample) => { const v = S()[key]; if (v === true) return sample; if (typeof v === 'string' && v) return v; return ''; };
  const show = (fr) => { const pair = Object.values(FILL).find((p) => p[0] === fr); return val(fr, pair ? pair[1] : ''); };
  const PREFILL = { city: 1, phone: 1, mail: 1, icity: 1, pay: 1 };
  const shownByKey = (key) => {
    const pair = FILL[key];
    if (!pair) return '';
    const v = S()[pair[0]];
    if (v === false || v === '') return '';
    if (typeof v === 'string' && v) return v;
    if (v === true || PREFILL[key]) return pair[1];
    return '';
  };
  const qIndex = () => { const v = S().frQ; return typeof v === 'number' ? Math.max(0, Math.min(24, v)) : 0; };
  const ansMap = () => (S().frAns && typeof S().frAns === 'object' ? S().frAns : {});
  const IDLE = '60 秒没有操作会清除并回到首页。';
  const page = (o) => F({ band: o.band, pre: o.pre || '', cls: 'fr-page' + (o.cls ? ' ' + o.cls : ''), body: o.body, dock: o.dock, nav: null, navAdvisor: 1 });
  const bandOf = (eyebrow, title, sub, text, extra) => Object.assign({ kind: 'compact', eyebrow, title, sub, seal: null, status: text ? { text, warn: extra && extra.warn ? 1 : 0 } : { text: '状态未知' } }, extra || {});
  /* 自我探索四页运行时顶栏会显示终端位置；稿上按已绑定的正常机器画，不写「设备未绑定」。 */
  const saBand = (eyebrow, title, sub, text, extra) => bandOf(eyebrow, title, sub, text, extra);
  const foot = (extra) => `<p class="fine">${extra ? esc(extra) : ''}${HELP}</p>`;
  const howto = (text) => `<div class="howto">${icon('help', 34, 2)}<span>${esc(text)}</span></div>`;
  const remind = (text, attrs) => `<div class="remind"${attrs || ''}>${icon('alert', 34, 2)}<span>${esc(text)}</span></div>`;
  const cap = (t, warn) => `<span class="fr-tag${warn ? ' fr-warn' : ''}">${esc(t)}</span>`;
  const field = (key, label, emptyText, bad, wide) => {
    const text = shownByKey(key);
    const empty = !text;
    const bcls = empty ? 'fr-ph' + (emptyText === '必填' ? ' fr-need' : '') : '';
    return `<button class="fr-field${wide ? ' fr-wide' : ''}${bad && empty ? ' fr-bad' : ''}" data-act="type" data-fr="${key}"><small>${esc(label)}</small><b class="${bcls}">${esc(text || emptyText)}</b></button>`;
  };
  const hero = (vis, inner, side) => `<div class="fr-hero${side ? ' fr-side' : ''}"><div class="art">${vis}</div><div class="tx">${inner}</div></div>`;
  const bigAct = (o) => {
    const go = o.go ? ` data-go="${o.go}"` : '';
    const fr = o.fr ? ` data-fr="${o.fr}"` : '';
    const arg = o.arg != null && o.arg !== '' ? ` data-arg="${esc(String(o.arg))}"` : '';
    const foot = o.take ? `<span class="fr-go">${esc(o.take)}</span>` : '';
    return `<button class="fr-act"${go}${fr}${arg}${o.dis ? ' disabled' : ''}><div class="vis">${o.vis || ''}</div><div class="tx"><div><b>${esc(o.title)}</b>${o.desc ? `<small>${esc(o.desc)}</small>` : ''}</div>${foot}</div></button>`;
  };
  const acts = (items) => `<div class="fr-acts${items.length === 1 ? ' fr-solo' : items.length === 2 ? ' fr-n2' : ''}">${items.map(bigAct).join('')}</div>`;
  const exits = (items) => `<div class="fr-exits">${items.map(bigAct).join('')}</div>`;
  const GO3 = () => acts([
    { go: 'resume-src', title: '上传简历', desc: '从手机或 U 盘把简历交给这台机器', take: '交上来之后才能继续', vis: UI.resume(220) },
    { go: 'print', title: '打印现有简历', desc: '手上已经有文件，就直接去打印', take: '按这份文件出纸', vis: UI.report(200) },
    { go: 'scan-type', title: '扫描纸质简历', desc: '把纸质简历扫成一份文件', take: '扫成 PDF 再回来用', vis: UI.scanPaper(200) }
  ]);
  const loading = (label) => `<div class="fr-skels">${Array.from({ length: 8 }, (_, i) => `<div class="fr-bar">${i ? '' : esc(label || '正在读取')}</div>`).join('')}</div>`;
  const overlay = (inner) => `<div class="overlay"><div class="fr-dialog" role="dialog">${inner}</div></div>`;
  const actBtn = (label, fr, arg, dis) => `<button class="fr-btn" data-fr="${fr}"${arg != null && arg !== '' ? ` data-arg="${esc(String(arg))}"` : ''}${dis ? ' disabled' : ''}>${esc(label)}</button>`;
  const row = (title, desc) => `<div class="fr-row"><b>${esc(title)}</b>${desc ? `<small>${esc(desc)}</small>` : ''}</div>`;
  const rows = (list) => `<div class="fr-rows">${list.map((r) => row(r[0], r[1])).join('')}</div>`;
  const resumeName = () => { const n = S().frResumeName; return typeof n === 'string' && n ? n : '已上传的简历'; };
  const ben = (go, ic, title, desc) => `<button class="fr-ben" data-go="${go}"><span class="ic">${icon(ic, 34, 2)}</span><b>${esc(title)}</b><small>${esc(desc)}</small></button>`;
  const KIND_VIS = () => [UI.resume(120), UI.report(110), UI.stack(110), UI.checklist(110)];
  const KIND_DESC = ['写给用人单位', '面试或实习之后', '一页封面', '要带的材料'];

  function loginWall(band, desc) {
    const kinds = MAT_TYPES.map((t, i) => `<div class="fr-kind"><div class="vis">${KIND_VIS()[i]}</div><div class="tx"><b>${t}</b><small>${KIND_DESC[i]}</small></div></div>`).join('');
    const bens = [ben('print', 'printer', '打印', '打印现有简历'), ben('scan-type', 'scan', '扫描', '扫描纸质简历'), ben('policy', 'landmark', '查政策', '查看公开的政策')].join('');
    return page({
      band,
      body: `<div class="fr-wall"><button class="fr-login" data-go="login"><div class="vis">${UI.phone(100)}</div><div class="tx"><b>登录后继续</b><small>${esc(desc)}</small></div></button>
        <div class="sec-t">登录后能生成的四种材料</div><div class="fr-kinds">${kinds}</div>
        <div class="sec-t">不登录也能办</div><div class="fr-bens">${bens}</div></div>${foot()}`,
      dock: { ask: '问小青：不登录能办什么？', pri: { label: '去登录', go: 'login' } }
    });
  }
  function tplCard(o) {
    return `<button class="fr-tpl${o.on ? ' on' : ''}" data-fr="${o.fr}" data-arg="${esc(String(o.arg))}" aria-pressed="${o.on ? 'true' : 'false'}"><div class="art">${o.vis}</div><div class="tx"><span class="fr-tags">${cap('示例')}${o.on ? cap('已选') : ''}</span><b>${esc(o.name)}</b><small>${esc(o.desc)}</small>${o.extra ? `<small>${esc(o.extra)}</small>` : ''}</div></button>`;
  }
  function grid(cards) {
    const n = Math.max(1, Math.min(4, cards.length || 1));
    return `<div class="fr-tplgrid fr-n${n}">${cards.join('')}</div>`;
  }

  function scratchNote() {
    if (S().frDecline === true) return '未满 14 周岁需要监护人同意，这台机器暂时办不了 AI。打印、扫描和已有材料照常可办。';
    if (S().ai === 'down') return 'AI 暂时不可用。可以先导出并打印你已经填的内容。';
    if (S().frSkip === true) return '这次先不用 AI。可以导出并打印你已经填的内容。';
    return '';
  }

  function scratch() {
    const name = shownByKey('name');
    const aiDown = S().ai === 'down';
    const manual = aiDown || S().frDecline === true || S().frSkip === true;
    const note = scratchNote();
    const open = S().frConsent === 'open';
    const pre = open ? overlay(`<h2>确认使用简历 AI</h2>
      <p>诊断、优化和生成会把你上传或填写的简历内容发送到系统里的 AI 进行分析。</p>
      <p>结果只给你本人看，不会发送给企业或合作机构，也不进入平台候选人简历库。</p>
      <p>${S().logged ? '授权保存在你的会员账号中，可随时在隐私设置撤回。' : '本次确认只在本机这次使用期间有效，不会写入账号。'}</p>
      <p>使用 AI 即表示你已年满 14 周岁。</p>
      <div class="fr-actions"><button class="btn sec" data-fr="decline">暂不使用</button><button class="btn pri" data-fr="agree">同意并继续</button></div>`) : '';
    /* 预览卡在公共屏上把手机号、邮箱打码；输入框里是本人正在填的内容，照原样。 */
    const maskPhone = (v) => String(v || '').replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
    const maskMail = (v) => String(v || '').replace(/^(.)[^@]*(@.+)$/, '$1***$2');
    const top = hero(UI.resume(280), `<span class="fr-k">简历顶部会这样显示</span><p class="fr-name${name ? '' : ' fr-need'}">${esc(name || '必填')}</p><p>${esc(shownByKey('city'))} · ${esc(maskPhone(shownByKey('phone')))}</p><p>${esc(maskMail(shownByKey('mail')))}</p><small class="fr-k">公共屏上打码显示，导出的简历里是完整的</small>`, 1);
    return page({
      pre,
      band: bandOf('从零生成简历', '先留下能联系上你的方式', '这一步只有姓名必填。', aiDown ? 'AI 暂时不可用' : '第 1 步 / 共 6 步', { rail: { labels: STEPS, now: 0 }, warn: aiDown }),
      body: `<div class="fr-form">${field('name', '姓名', '必填', false, false)}${field('city', '所在城市', '可以空着', false, false)}${field('phone', '联系电话', '可以空着', false, true)}${field('mail', '邮箱', '可以空着', false, true)}</div>
        ${note ? remind(note) : ''}${top}
        ${manual ? actBtn(S().frExport === 'busy' ? '正在导出草稿…' : '导出并打印我填的内容（未经 AI 润色）', 'export', null, S().frExport === 'busy') : ''}
        ${foot()}`,
      dock: { ask: '问小青：这一步写什么？', pri: { label: '下一步：求职意向', id: 'frNext', act: 'fr:next', disabled: !name } }
    });
  }

  function scratch1() {
    const pos = shownByKey('pos');
    const job = typeof S().frJob === 'string' ? S().frJob : '';
    const aiDown = S().ai === 'down';
    const jobs = ['全职', '实习', '兼职'].map((j) => `<button class="fr-btn" data-fr="job" data-arg="${j}" aria-pressed="${job === j ? 'true' : 'false'}">${j}</button>`).join('');
    const top = hero(UI.resume(280), `<span class="fr-k">简历顶部会这样显示</span><p class="fr-name${pos ? '' : ' fr-need'}">${esc(pos || '必填')}</p><p>${esc(shownByKey('icity'))} · ${esc(shownByKey('pay'))}</p><p>工作类型：${esc(job || '不填写')}</p>`, 1);
    return page({
      band: bandOf('从零生成简历', '你想找什么方向的工作？', '这一步只有目标岗位必填。', aiDown ? 'AI 暂时不可用' : '第 2 步 / 共 6 步', { rail: { labels: STEPS, now: 1 }, warn: aiDown }),
      body: `<div class="fr-form">${field('pos', '目标岗位', '必填', false, true)}${field('icity', '意向城市', '可以空着', false, false)}${field('pay', '期望薪资', '如 8k-12k', false, false)}</div>
        <div class="fr-rowbtns">${jobs}</div>
        ${aiDown ? remind('AI 暂时不可用。可以先导出并打印你已经填的内容。') : ''}${top}
        ${aiDown ? actBtn(S().frExport === 'busy' ? '正在导出草稿…' : '导出并打印我填的内容（未经 AI 润色）', 'export', null, S().frExport === 'busy') : ''}
        ${foot()}`,
      dock: { backLabel: '上一步', ask: '问小青：岗位怎么写？', pri: { label: '下一步', id: 'frNext', act: 'fr:next2', disabled: !pos } }
    });
  }

  function templates() {
    const st = S().frTpl;
    const dockPri = { ask: '问小青：版式怎么选？', pri: { label: '进入简历优化', go: 'resume-src', arg: 'optimize' } };
    if (st === 'load') {
      return page({
        band: bandOf('改简历 · 模板', '正在读取版式', '读完才会列出版式。', '正在读取', { warn: 1 }),
        body: `${loading('正在读取')}${foot()}`,
        dock: dockPri
      });
    }
    if (st === 'err' || st === 'empty') {
      const err = st === 'err';
      return page({
        band: bandOf('改简历 · 模板', err ? '版式这次没读到' : '当前没有已发布的版式', err ? '可以再读一次，也可以先去优化或打印。' : '发布之后会出现在这里。', err ? '没读到版式' : '当前没有版式', { warn: 1 }),
        body: `${howto(err ? '版式这次没读到。可以再读一次，也可以先去优化或打印。' : '当前没有已发布的版式。')}${acts([
          { fr: 'reload', title: '重新读取', desc: '再要一次已发布的版式', vis: UI.checklist(150) },
          { go: 'scratch', title: '用它生成新简历', desc: '从基本信息写起，不套用版式', vis: UI.resume(150) },
          { go: 'print', title: '打印现有简历', desc: '手上有文件就直接去打印', vis: UI.report(140) }
        ])}${foot()}`,
        dock: dockPri
      });
    }
    const filter = S().frFilter || 'all';
    const names = { all: '全部', resume: '简历模板', common: '通用' };
    const more = S().frMore === true;
    const list = TPLS.filter((t) => filter === 'all' || t.cat === filter);
    const sel = typeof S().frSel === 'number' ? S().frSel : -1;
    const cur = sel >= 0 ? TPLS[sel] : null;
    const cards = list.map((t) => {
      const i = TPLS.indexOf(t);
      return tplCard({ on: sel === i, fr: 'sel', arg: i, vis: t.cat === 'resume' ? UI.resume(220) : UI.checklist(220), name: t.name, desc: t.desc });
    });
    const moreBox = `<div class="fr-more"${more ? '' : ' hidden'}>${actBtn('用它生成新简历', 'gennew')}${actBtn('打印现有简历', 'printhas')}${actBtn('重新读取', 'reload')}</div>`;
    const bodyMain = list.length ? grid(cards) : `${howto('这个分类里还没有模板。')}${acts([
      { fr: 'reload', title: '重新读取', desc: '再要一次已发布的版式', vis: UI.checklist(150) },
      { go: 'print', title: '打印现有简历', desc: '手上有文件就直接去打印', vis: UI.report(140) }
    ])}`;
    return page({
      band: bandOf('改简历 · 模板', cur ? '版式选好了' : '先挑一个版式', '只看已发布的版式。', cur ? '已选，尚未套用' : '已发布模板'),
      body: `${actBtn('分类：' + (names[filter] || '全部'), 'filter')}${bodyMain}${moreBox}${actBtn(more ? '收起其他出路' : '其他出路', 'more')}${foot(more ? '用它生成新简历不会套用所选模板。' : '选中不会套用到你的简历上。')}`,
      dock: dockPri
    });
  }

  function exportBlock() {
    if (S().frPrice === 'off') return '简历导出当前不可用（价目已停用，不是免费）';
    if (S().fee && !S().logged) return '收费导出需登录会员账号并核销 1 次权益';
    if (S().frPrice === 'none') return '当前没有可用的导出权益，导出按钮不可用';
    if (S().frConfirmed !== true) return '待本人确认：学校、专业、公司、职务';
    return '';
  }

  function preview() {
    const st = S().frPrev || 'ready';
    if (st === 'load') {
      return page({
        band: bandOf('从零生成 · 核对', '正在读取生成结果', '读回来之前，这里不显示简历内容。', '正在读取', { warn: 1 }),
        body: `${loading('正在读取')}<button class="fr-btn" data-go="my-resumes">返回我的简历</button>${foot()}`,
        dock: { backLabel: '回去改资料', ask: '问小青：哪里要改？' }
      });
    }
    if (st === 'none') {
      return page({
        band: bandOf('从零生成 · 核对', '没有可核对的简历', '这次进来没有带上生成结果。', '没有可核对的简历', { warn: 1 }),
        body: `${howto('这次进来没有可核对的简历。')}${acts([
          { go: 'my-resumes', title: '打开我的简历', desc: '看还留着的那一份', vis: UI.stack(140) },
          { go: 'scratch', title: '去填资料', desc: '从姓名和联系方式开始', vis: UI.resume(150) },
          { go: 'resume-src', title: '我已经有简历文件', desc: '上传或扫描一份现成的', vis: UI.scanPaper(140) }
        ])}${foot()}`,
        dock: { backLabel: '返回简历服务', ask: '问小青：从哪开始？', pri: { label: '去填资料', go: 'scratch' } }
      });
    }
    if (st === 'fail') {
      return page({
        band: bandOf('从零生成 · 核对', '这条记录没读回来', '可能已过留存期、不是本人，或者网络不通。', '这次没读回来', { warn: 1 }),
        body: `${howto('可能已过留存期、不是本人，或者网络不通。')}${acts([
          { fr: 'reread', title: '再读一次', desc: '只重试这一次', vis: UI.checklist(150), dis: S().frCanRetry === false },
          { go: 'my-resumes', title: '打开我的简历', desc: '看还留着的那一份', vis: UI.stack(140) }
        ])}${foot()}`,
        dock: { backLabel: '回去改资料', ask: '问小青：读不回来怎么办？', pri: { label: '重新填一份', go: 'scratch' } }
      });
    }
    if (st === 'lost') {
      return page({
        band: bandOf('从零生成 · 核对', '生成结果已经清除', '公共设备不保留刚才填的内容。', '结果已清除', { warn: 1 }),
        body: `${howto('生成结果已经清除。要看内容，需要重新填写。')}${acts([
          { go: 'scratch', title: '重新填一份', desc: '从姓名和联系方式开始', vis: UI.resume(160) },
          { go: 'home', title: '回首页', desc: '先去办打印、扫描或查政策', vis: UI.report(140) }
        ])}${foot()}`,
        dock: { backLabel: '回首页', ask: '问小青：要重填吗？', pri: { label: '重新填一份', go: 'scratch' } }
      });
    }
    if (st === 'bad') {
      return page({
        band: bandOf('从零生成 · 核对', '这一页暂时打不开', '可以回首页，或从第 1 步重新填写。', '暂时打不开', { warn: 1 }),
        body: `${howto('这一页暂时打不开。')}${acts([
          { go: 'home', title: '回首页', desc: '先去办别的', vis: UI.report(150) },
          { go: 'scratch', title: '从第 1 步开始', desc: '重新填写姓名和联系方式', vis: UI.resume(160) }
        ])}${foot()}`,
        dock: { backLabel: '回首页', ask: false, pri: { label: '从第 1 步开始', go: 'scratch' } }
      });
    }
    const fmt = S().frFmt || 'pdf';
    S().expFmt = fmt;
    const block = exportBlock();
    const more = S().frExMore === true;
    const school = show('frSchool'), major = show('frMajor'), company = show('frCompany'), duty = show('frDuty');
    const fact = (v) => v || '待本人确认';
    const pre = S().frFact === 'open' ? overlay(`<h2>核对这几处事实</h2>
      <p>学校、专业、公司和职务可以在这里改。学历、时间段、项目名和证书仍按你填的保留。</p>
      <div class="fr-form">${field('school', '学校', '点这里填写', false, false)}${field('major', '专业', '点这里填写', false, false)}${field('company', '公司', '点这里填写', false, false)}${field('duty', '职务', '点这里填写', false, false)}</div>
      <button class="fr-btn" data-fr="confirm" aria-pressed="${S().frConfirmed === true ? 'true' : 'false'}">${S().frConfirmed === true ? '已确认这几处属实' : '我确认这几处属实'}</button>
      <p>学校、专业、公司和职务改完就留在这一份上。学历、时间段、项目名和证书要改，得回填写页。</p>
      <button class="btn sec" data-fr="closefact">收起</button>`) : '';
    const fmts = [['pdf', 'PDF'], ['docx', 'DOCX'], ['txt', 'TXT'], ['md', 'MD']].map(([k, lab]) => `<button class="fr-btn" data-fr="fmt" data-arg="${k}" aria-pressed="${fmt === k ? 'true' : 'false'}">${lab}</button>`).join('');
    const layout = ['行距', '页边距', '主色'].map((k) => `<button class="fr-btn" data-fr="layout" data-arg="${k}" aria-pressed="${S().frLayout === k ? 'true' : 'false'}">${k}</button>`).join('');
    const relink = S().frRelink === 'busy' ? '正在重新生成下载链接' : S().frRelink === 'ready' ? '下载链接已重新生成' : '重新生成下载链接';
    const pdfLine = (S().logged ? '' : '还没登录时，文件不会进账号；') + (fmt === 'pdf' ? '只有 PDF 能接着打印。' : '这一格式暂不开放打印，仍可以导出。');
    return page({
      pre,
      band: bandOf('从零生成 · 核对', '核对这一次的结果', '事实请你本人确认。', '核对这一次'),
      body: `<div class="fr-rowbtns" data-fmt="${esc(fmt)}" data-n="${S().frFmtN || 0}">${fmts}</div>
        <div class="fr-kicker"><span class="fr-k">AI 生成，仅供参考</span>${cap('示例')}</div>
        ${hero(UI.resume(260), `<p class="fr-name">${esc(show('frName') || '周宁')}</p><p>学校 ${esc(fact(school))} · 专业 ${esc(fact(major))}</p><p>公司 ${esc(fact(company))} · 职务 ${esc(fact(duty))}</p>`, 1)}
        ${block ? remind(block) : ''}
        <div class="fr-rowbtns">${actBtn('改事实', 'facts')}${actBtn(more ? '收起更多' : '更多', 'xmore')}</div>
        <div class="fr-more"${more ? '' : ' hidden'}>
          <div class="fr-rowbtns">${layout}</div>
          <div class="fr-rowbtns">${actBtn(S().frHint === true ? '没有要补充的项' : '看缺失提示', 'hint')}${actBtn(S().frPhoneView === true ? '收起手机预览' : '手机上预览', 'phone')}${actBtn(relink, 'relink', null, S().frRelink === 'busy')}</div>
          ${S().frPhoneView === true ? `<div class="fr-phone">${UI.phone(90)}</div>` : ''}
        </div>
        ${foot(pdfLine)}`,
      dock: { backLabel: '回去改资料', ask: '问小青：哪里要改？', pri: { label: '内容没问题，去导出', go: block ? '' : 'resume-export', disabled: !!block } }
    });
  }

  function materials() {
    if (!S().logged) {
      return loginWall(bandOf('改简历 · 求职材料', '登录后才能生成', '填过的内容会留在这台机器上，登录后再生成。', '未登录', { warn: 1 }), '填过的内容会留在这台机器上，登录后再生成。');
    }
    const st = S().frMat || 'pick';
    if (st === 'load') {
      return page({
        band: bandOf('改简历 · 求职材料', '正在读取模板', '读完才会列出可以选的模板。', '正在读取', { warn: 1 }),
        body: `${loading('正在读取')}${foot()}`,
        dock: { ask: '问小青：材料怎么选？' }
      });
    }
    if (st === 'empty' || st === 'err') {
      const err = st === 'err';
      return page({
        band: bandOf('改简历 · 求职材料', err ? '模板这次没读到' : '当前没有已发布的模板', err ? '可以再读一次。' : '发布之后会出现在这里。', err ? '没读到模板' : '当前没有模板', { warn: 1 }),
        body: `${howto(err ? '模板这次没读到。' : '当前没有已发布的求职材料模板。')}${acts([
          { fr: 'reload', title: '重新读取', desc: '再要一次已发布的模板', vis: UI.checklist(150) },
          { go: 'print', title: '打印现有简历', desc: '手上有文件就直接去打印', vis: UI.report(150) }
        ])}${foot()}`,
        dock: { ask: '问小青：没有模板怎么办？' }
      });
    }
    if (st === 'busy') {
      return page({
        band: bandOf('改简历 · 求职材料', '正在生成', '好了才会出现文件。', '正在生成', { warn: 1 }),
        body: `${loading('正在生成')}${foot()}`,
        dock: { ask: '问小青：要等多久？' }
      });
    }
    if (st === 'fail') {
      return page({
        band: bandOf('改简历 · 求职材料', '这次没有生成', '可以再试一次，或返回修改。', '这次没生成', { warn: 1 }),
        body: `${howto('这次没有生成文件。')}${acts([
          { fr: 'retry', title: '再试一次', desc: '用刚才填的内容再生成', vis: UI.resume(150) },
          { fr: 'backform', title: '返回修改', desc: '回去改姓名、岗位或备注', vis: UI.checklist(140) }
        ])}${foot()}`,
        dock: { ask: '问小青：生成失败了怎么办？' }
      });
    }
    const type = MAT_TYPES.indexOf(S().frMatType) >= 0 ? S().frMatType : '求职信';
    if (st === 'form') {
      const name = show('frMName'), role = show('frMRole');
      const tried = S().frMatTry === true;
      const org = show('frMOrg');
      const letter = hero(UI.resume(240), `<span class="fr-k">求职信会这样开头</span><p class="fr-name${name ? '' : ' fr-need'}">${esc(name || '必填')}</p><p>${esc(org ? '写给 ' + org : '写给用人单位')} · ${esc(role || '目标岗位')}</p><p>${esc(show('frMStr') || '这里放你做过的事')}</p>`, 1);
      return page({
        band: bandOf('改简历 · 求职材料', '把这几项填实', '按固定模板生成，不使用 AI。', type + (S().frMatTpl ? ' · ' + S().frMatTpl : '')),
        body: `<div class="fr-form">${field('mname', '姓名', '必填', tried, false)}${field('mrole', '目标岗位', '必填', tried, false)}${field('morg', '目标单位', '可以不填', false, true)}${field('mstr', '你的优势', '只写做过的事', false, true)}${field('mnote', '备注', '可以不填', false, true)}</div>
          ${tried && (!name || !role) ? remind('姓名和目标岗位都要填。', ' data-fr-reason') : ''}${letter}${actBtn('换模板', 'backpick')}${foot()}`,
        dock: { backLabel: '返回选模板', ask: '问小青：优势怎么写？', pri: { label: '生成', id: 'frGen', act: 'fr:mgen', disabled: !(name && role) } }
      });
    }
    const picked = S().frMatTpl || '';
    const cards = (MAT_TPL[type] || []).map((t) => tplCard({ on: picked === t[0], fr: 'mtpl', arg: t[0], vis: UI.checklist(130), name: t[0], desc: t[1] }));
    return page({
      band: bandOf('改简历 · 求职材料', '要准备哪种材料？', '按固定模板生成，不使用 AI。', '固定模板'),
      body: `${actBtn('种类：' + type, 'mtype')}${grid(cards)}${foot()}`,
      dock: { ask: '问小青：选哪种？', pri: { label: '填写这项', act: 'fr:toform', disabled: !picked } }
    });
  }

  function materialsResult() {
    if (!S().logged) {
      return loginWall(bandOf('求职材料 · 结果', '登录后才能看到生成的文件', '填过的内容会留在这台机器上，登录后再生成。', '未登录', { warn: 1 }), '登录后才能看到生成的文件');
    }
    const kind = S().frFile || 'ok';
    const demoFile = kind === 'demo';
    const canPrint = kind === 'ok';
    const peek = S().frPeek;
    let note = '';
    if (peek === 'err') note = demoFile ? '预览没能打开。这一份没有保存，也不能打印。' : '预览没能打开。文件还在，可以再到我的文档里查看。';
    else if (demoFile) note = '这一份没有保存，也不能打印。';
    else if (!canPrint) note = '文件已经生成，但还不能打印。可以重新生成后再试。';
    const pre = peek === 'open' ? overlay(`<h2>只在这里看一眼</h2><p>求职信-内容运营.pdf · 2 页 · 186 KB</p>${demoFile ? '<p>这一份没有保存。</p>' : ''}<button class="btn sec" data-fr="closepeek">关闭</button>`) : '';
    const when = demoFile ? '这一份没有保存' : '今天 14:25 前可在这里查看';
    const keep = demoFile ? '不能打印' : '保留到 2027 年 1 月 25 日';
    return page({
      pre,
      band: bandOf('求职材料 · 结果', demoFile ? '这一份没有保存' : canPrint ? '文件已经生成' : '还不能打印', '按固定模板生成，不使用 AI。', demoFile ? '未保存' : canPrint ? '可以打印' : '还不能打印', { warn: !canPrint }),
      body: `${note ? remind(note) : ''}${hero(UI.report(240), `<span class="fr-tags">${cap('示例')}</span><p class="fr-name">求职信-内容运营.pdf</p><p>2 页 · 186 KB · PDF</p><p>${esc(when)}</p><p>${esc(keep)}</p>`, 1)}
        <div class="fr-rowbtns">${actBtn('重新生成', 'regen')}${actBtn('我的文档', 'docs', null, demoFile)}${actBtn('预览', 'peek')}</div>${foot()}`,
      dock: { backLabel: '返回填写', ask: '问小青：这份能打印吗？', pri: { label: '打印', go: canPrint ? 'pii' : '', disabled: !canPrint } }
    });
  }

  function jobfit() {
    if (S().frEnded === true) {
      return page({
        band: bandOf('改简历 · 简历对照', '这次办理已结束', '这一次的填写已经清掉。', '这次办理已结束', { warn: 1 }),
        body: `${howto('这次办理已结束，这一次的填写已经清掉。')}${acts([
          { go: 'resume', title: '回简历服务', desc: '从简历服务台重新开始', vis: UI.checklist(140) },
          { go: 'resume-src', title: '上传简历', desc: '再交一份简历进来', vis: UI.resume(150) },
          { go: 'print', title: '打印现有简历', desc: '手上有文件就直接去打印', vis: UI.report(140) }
        ])}${foot()}`,
        dock: { ask: '问小青：怎么重新开始？', pri: { label: '回简历服务', go: 'resume' } }
      });
    }
    if (!on(S().frFitTask)) {
      return page({
        band: bandOf('改简历 · 简历对照', '先补上简历', '没有简历，这里不对照。', '还没有简历', { warn: 1 }),
        body: `${howto('还没有可对照的简历。')}${GO3()}${foot('结果只给你自己看，不打分，也不提供给单位。')}`,
        dock: { ask: '问小青：简历放在哪？', pri: { label: '去上传简历', go: 'resume-src' } }
      });
    }
    const fit = S().frFit || 'form';
    const who = resumeName();
    if (fit === 'wait') {
      return page({
        band: bandOf('改简历 · 简历对照', '正在对照', '好了才会显示结果。', '正在对照', { warn: 1 }),
        body: `${loading('正在对照')}${foot('结果只给你自己看，不打分，也不提供给单位。')}`,
        dock: { ask: '问小青：对照要看什么？', pri: { label: '打印现有简历', go: 'print' } }
      });
    }
    if (fit === 'down') {
      return page({
        band: bandOf('改简历 · 简历对照', 'AI 暂时不可用', '这次没能对照。', 'AI 暂时不可用', { warn: 1 }),
        body: `${howto('AI 暂时不可用，这次没能对照。')}${acts([
          { go: 'print', title: '打印现有简历', desc: '不依赖这次对照', vis: UI.report(150) },
          { go: 'optimize', fr: 'intent', title: '自己改简历', desc: '按你自己的判断改', vis: UI.resume(150) }
        ])}${foot()}`,
        dock: { ask: '问小青：AI 停了怎么办？', pri: { label: '返回填写', act: 'fr:reform' } }
      });
    }
    const logged = !!S().logged;
    const aiDown = S().ai === 'down';
    const pre = fit === 'auth' ? overlay(logged ? `<h2>开启岗位 AI 辅助</h2>
      <p>基于本人简历与来源岗位内容生成参考建议，不代表录用结果。</p>
      <p>本系统会基于你的本人简历和岗位来源内容生成岗位解读、匹配参考和准备建议，结果仅供求职参考，不代表录用结果。</p>
      <p>分析结果只展示给当前登录的求职者本人。</p>
      <p>绝不向企业共享或推荐您的简历。</p>
      <p>不会提供平台内投递、企业端筛选流程或录用承诺。</p>
      <div class="fr-actions"><button class="btn sec" data-fr="noauth">取消</button><button class="btn pri" data-fr="yesauth">同意并继续</button></div>`
      : `<h2>确认岗位匹配授权</h2>
      <p>本次岗位匹配参考会使用本次简历诊断内容，帮助你准备简历和投递材料。</p>
      <p>分析结果和授权状态按简历诊断到期策略保存；你可随时撤回后续分析授权。</p>
      <p>分析结果仅供本人参考，不代表任何招聘结果，也不会向企业共享简历。</p>
      <div class="fr-actions"><button class="btn sec" data-fr="noauth">暂不授权</button><button class="btn pri" data-fr="yesauth">同意并继续</button></div>`) : '';
    return page({
      pre,
      band: bandOf('改简历 · 简历对照', '填一份岗位要求', '只用你填的要求。', '填岗位要求'),
      body: `<div class="fr-form">${field('role', '岗位名称', '如 内容运营', false, true)}${field('req', '岗位要求', '把招聘信息里的要求填在这里', false, true)}</div>
        ${aiDown ? remind('AI 暂时不可用。可以打印现有简历，或问顾问。结果只给你自己看，不打分，也不提供给单位。') : ''}
        ${hero(UI.resume(240), `<span class="fr-k">这次对照用的简历</span><p class="fr-name">${esc(who)}</p><p>岗位名称和岗位要求填在上面。</p>`, 1)}
        <button class="fr-btn" data-go="print">打印现有简历</button>
        ${aiDown ? foot() : foot('结果只给你自己看，不打分，也不提供给单位。')}`,
      dock: { ask: '问小青：要求怎么贴？', pri: { label: '继续并确认授权', act: 'fr:auth', disabled: aiDown } }
    });
  }

  function jobfitResult() {
    const rep = S().frRep || '';
    const aiDown = S().ai === 'down';
    if (rep === 'wait') {
      return page({
        band: bandOf('简历对照 · 结果', '正在生成打印版', '好了才会进入下一步。', '正在生成打印版', { warn: 1 }),
        body: `${loading('正在生成')}${foot()}`,
        dock: { backLabel: '返回填写', ask: '问小青：打印版是什么？' }
      });
    }
    const list = [
      ['已经写到 · 中文相关专业', '依据：教育经历 · 汉语言文学'],
      ['已经写到 · 公众号运营经验', '依据：实习经历 · 青岛海禾文化'],
      ['已经写到 · 会用剪映', '依据：技能'],
      ['已经写到 · 文字表达', '依据：学院公众号推送'],
      ['还没体现 · 数据分析', '简历里没找到相关内容'],
      ['还没体现 · 独立策划选题', '简历里没找到相关内容'],
      ['还没体现 · 短视频账号运营', '简历里没找到相关内容']
    ];
    let note = '';
    if (aiDown && rep === 'fail') note = 'AI 暂时不可用。已经返回的对照仍可查看。打印版这次没生成。';
    else if (aiDown) note = 'AI 暂时不可用。已经返回的对照仍可查看。';
    else if (rep === 'fail') note = '打印版这次没生成。对照结果还在，可以再生成一次。';
    return page({
      band: bandOf('简历对照 · 结果', '对照结果在这里', '不打分，也不提供给单位。', '对照已经返回', { warn: !!(aiDown || rep === 'fail') }),
      body: `<div class="fr-kicker"><span class="fr-k">AI 生成，仅供参考</span>${cap('示例')}</div>
        ${hero(UI.report(220), `<p class="fr-name">写到 4 条，还有 3 条没写到</p><p>下面按你填的岗位要求逐条对照。</p>`, 1)}
        ${note ? remind(note) : ''}${rows(list)}
        <div class="fr-tags">${cap('公众号')}${cap('剪映')}${cap('数据分析', true)}</div>
        <div class="fr-rowbtns">${actBtn('查看行动清单', 'actions')}${actBtn('整理佐证材料', 'materials')}${actBtn('换个岗位分析', 'again')}${actBtn(rep === 'fail' ? '再生成打印版' : '打印报告', 'printrep')}</div>
        ${aiDown ? '<button class="fr-btn" data-go="print">打印现有简历</button>' : ''}
        ${foot()}`,
      dock: { backLabel: '返回填写', ask: '问小青：哪条先改？', pri: { label: '优化简历', go: 'optimize', arg: 'optimize' } }
    });
  }

  function jobfitActions() {
    const st = S().frAct || 'ready';
    const aiDown = S().ai === 'down';
    if (st === 'wait') {
      return page({
        band: bandOf('简历对照 · 行动清单', '正在生成打印版', '好了才会进入下一步。', '正在生成打印版', { warn: 1 }),
        body: `${loading('正在生成')}${foot()}`,
        dock: { backLabel: '返回比对结果', ask: false }
      });
    }
    if (st === 'empty' || st === 'down') {
      return page({
        band: bandOf('简历对照 · 行动清单', '这次没有行动清单', st === 'down' ? 'AI 暂时不可用，这次没有行动清单。' : '可以先去改简历，或打印现有的。', st === 'down' ? 'AI 暂时不可用' : '这次没有清单', { warn: 1 }),
        body: `${howto(st === 'down' ? 'AI 暂时不可用，这次没有行动清单。' : '这次没有行动清单。')}${acts([
          { go: 'optimize', fr: 'intent', title: '去简历优化', desc: '按你自己的判断改', vis: UI.resume(150) },
          { go: 'materials', title: '去材料工坊', desc: '准备求职信或材料清单', vis: UI.checklist(140) },
          { go: 'print', title: '打印现有简历', desc: '手上有文件就直接去打印', vis: UI.report(140) }
        ])}${foot('仅供参考，不代表招聘结果。')}`,
        dock: { backLabel: '返回比对结果', ask: '问小青：先改哪句？' }
      });
    }
    const list = [
      ['准备 · 数据分析', '简历里没写看过哪些数据。把真实看过的阅读或涨粉写进经历；没看过就不写。'],
      ['准备 · 独立策划选题', '只写了负责。挑一件你自己定过题的事，写清结果。'],
      ['准备 · 短视频账号', '只写了剪辑。管过账号就写账号和你做的事；没有就不写。'],
      ['简历 · 实习描述', '补上结果，不改单位和时间。'],
      ['简历 · 技能栏', '删掉没有事例的词。']
    ];
    let note = '';
    if (aiDown && st === 'fail') note = 'AI 暂时不可用。清单还在。打印版这次没生成。';
    else if (aiDown) note = 'AI 暂时不可用。已经返回的清单仍可查看。';
    else if (st === 'fail') note = '打印版这次没生成。清单还在，可以再生成一次。';
    return page({
      band: bandOf('简历对照 · 行动清单', '可以先做这 5 件', '仅供参考，不代表招聘结果。', st === 'fail' ? '打印版没生成' : '清单已经返回', { warn: !!(note) }),
      body: `<div class="fr-kicker"><span class="fr-k">AI 生成，仅供参考</span>${cap('示例')}</div>
        ${hero(UI.checklist(220), `<p class="fr-name">可以先做这 5 件</p><p>做完再去改简历，或生成一份打印版。</p>`, 1)}
        ${note ? remind(note) : ''}${rows(list)}
        <div class="fr-rowbtns"><button class="fr-btn" data-go="optimize" data-fr="intent">去简历优化</button><button class="fr-btn" data-go="materials">去材料工坊</button>${actBtn(st === 'fail' ? '再生成打印版' : '生成打印版', 'printact')}</div>
        ${aiDown ? '<button class="fr-btn" data-go="print">打印现有简历</button>' : ''}
        ${foot()}`,
      dock: { backLabel: '返回比对结果', ask: '问小青：先改哪句？' }
    });
  }

  function career() {
    const task = on(S().frPlanTask);
    const plan = S().frPlan || '';
    const aiDown = S().ai === 'down';
    const promise = '不承诺录用或收入。';
    if (S().frPrintWait === 'wait') {
      return page({
        band: bandOf('改简历 · 求职方案', '正在准备打印件', '好了才会进入下一步。', '正在准备打印件', { warn: 1 }),
        body: `${loading('正在准备打印件')}${foot(promise)}`,
        dock: { ask: '问小青：打印的是哪一份？' }
      });
    }
    if (S().frPrintAsk === true) {
      return page({
        band: bandOf('改简历 · 求职方案', '这份是求职参考单', '里面没有方案正文。', '未含方案正文', { warn: 1 }),
        body: `${howto('打印出来的是求职参考单，里面没有方案正文。')}${acts([
          { fr: 'full', title: '重新生成完整版', desc: '等方案回来再看四栏', vis: UI.resume(150), dis: aiDown },
          { fr: 'printanyway', title: '仍然打印这份参考单', desc: '确认后才去打印', vis: UI.report(140) }
        ])}${foot(promise)}`,
        dock: { backLabel: '返回方案', ask: '问小青：两份有什么不同？' }
      });
    }
    if (!task) {
      return page({
        band: bandOf('改简历 · 求职方案', '先补上简历', '没有简历，这里不写针对你的结论。', '还没有简历', { warn: 1 }),
        body: `${howto('没有你的简历，这里不写针对你的结论。')}${GO3()}${foot(promise)}`,
        dock: { ask: '问小青：要先传什么？', pri: { label: '去上传简历', go: 'resume-src' } }
      });
    }
    if (plan === 'gen') {
      return page({
        band: bandOf('改简历 · 求职方案', '正在生成', '好了才会显示方案。', '正在生成', { warn: 1 }),
        body: `${loading('正在生成')}${foot(promise)}`,
        dock: { ask: '问小青：方案里有什么？', pri: { label: '正在生成…', disabled: true } }
      });
    }
    if (plan === 'fail') {
      return page({
        band: bandOf('改简历 · 求职方案', '这次没有生成方案', aiDown ? 'AI 暂时不可用。可以先打印求职参考单。' : '可以再生成一次，或先打印求职参考单。', '这次没生成', { warn: 1 }),
        body: `${howto(aiDown ? 'AI 暂时不可用。可以先打印求职参考单。' : '这次没有生成方案。可以再生成一次，或先打印求职参考单。')}${acts([
          { fr: 'cgen', title: '再生成一次', desc: '等方案回来再看四栏', vis: UI.resume(150), dis: aiDown },
          { fr: 'printask', title: '打印求职参考单', desc: '里面没有方案正文', vis: UI.report(140) }
        ])}${foot(promise)}`,
        dock: { ask: '问小青：失败了怎么办？' }
      });
    }
    const four = [
      ['已有材料 · 学校', '青岛大学 · 汉语言文学 · ' + (S().logged ? '来自我的简历' : '来自这次上传的简历')],
      ['已有材料 · 实习', '青岛海禾文化 · 新媒体实习生'],
      ['目标与方向', '内容运营'],
      ['尚需准备', '先补一段能核对的结果']
    ];
    const next4 = () => exits([
      { go: 'optimize', fr: 'intent', title: '去优化简历', desc: '按方案改已有内容', vis: UI.resume(130) },
      { go: 'jobfit', title: '简历对照', desc: '自己填一份岗位要求', vis: UI.checklist(120) },
      { go: 'iv-1', title: '设置一场练习', desc: '去面试设置，不代答', vis: UI.report(120) },
      { go: 'sa-intro', title: '自我探索', desc: '25 道选择题', vis: UI.stack(110) }
    ]);
    if (plan === 'ready') {
      return page({
        band: bandOf('改简历 · 求职方案', '求职方案在这里', '只供你自己参考。', '方案已经返回', { warn: aiDown }),
        body: `<div class="fr-kicker"><span class="fr-k">AI 生成，仅供参考</span>${cap('示例')}</div>
          ${aiDown ? remind('AI 暂时不可用。这份方案还在，重新生成先停着。') : ''}
          ${rows(four)}${next4()}${actBtn('重新生成', 'cgen', null, aiDown)}${foot(promise)}`,
        dock: { ask: '问小青：先做哪一件？', pri: { label: '打印建议单', act: 'fr:printplan' } }
      });
    }
    if (aiDown) {
      return page({
        band: bandOf('改简历 · 求职方案', '求职方案', 'AI 暂时不可用。下面三件不用 AI 也能做。', 'AI 暂时不可用', { warn: 1 }),
        body: `${remind('AI 暂时不可用。下面三件不用 AI 也能做，但不是按你这份简历写的。')}
          ${SELF3.map((t, i) => `<div class="fr-note"><b>第 ${i + 1} 件</b><span>${esc(t)}</span></div>`).join('')}
          ${acts([
            { go: 'optimize', fr: 'intent', title: '去简历工作台', desc: '自己改简历里的句子', vis: UI.resume(140) },
            { fr: 'printask', title: '打印求职参考单', desc: '里面没有方案正文', vis: UI.report(130) }
          ])}${foot(promise)}`,
        dock: { ask: '问小青：这三条怎么用？', pri: { label: '生成求职方案', disabled: true } }
      });
    }
    return page({
      band: bandOf('改简历 · 求职方案', '生成一份求职方案？', '生成之前，这里不写针对你的结论。', '还没有方案'),
      body: `${hero(UI.resume(260), `<span class="fr-k">生成之后会有这四栏</span><p>已有材料</p><p>目标与方向</p><p>尚需准备</p><p>执行计划</p>`, 1)}
        ${actBtn('打印求职参考单（未含 AI 规划）', 'printask')}${foot(promise)}`,
      dock: { ask: '问小青：方案依据是什么？', pri: { label: '生成求职方案', act: 'fr:genplan' } }
    });
  }

  function termsOk() { return S().frTerms !== 'load' && S().frTerms !== 'err'; }
  const TERMS = [
    '结果只给你自己看，不发给单位。',
    '不评分、不排名，不能当成能力证明。',
    '不是心理或人格测评，不贴类型。',
    '可以撤回，撤回后这次结果会删掉。'
  ];

  function saIntro() {
    const st = S().frTerms || 'ok';
    const agree = S().frAgree === true;
    const sens = S().frSens === true;
    const resubmit = S().frResubmit === true;
    const startLabel = resubmit ? '确认并重新提交' : '开始作答';
    const sub = st === 'load' ? '说明还在读取。' : st === 'err' ? '说明没有取到。' : agree ? (resubmit ? '已答的题都还在，确认后会重新提交。' : '现在可以开始作答。') : '看完下面四条，勾选同意后再开始。';
    const status = st === 'load' ? '正在读取' : st === 'err' ? '没读到说明' : agree ? '已同意' : '待同意';
    if (st === 'load') {
      return page({
        band: saBand('改简历 · 自我探索', '说明还在读取', '读完才能勾选同意。', '正在读取', { warn: 1 }),
        body: `${loading('正在读取')}${foot(IDLE)}`,
        dock: { backLabel: '返回简历服务', ask: '问小青：这是测评吗？', pri: { label: startLabel, act: 'fr:start', disabled: true } }
      });
    }
    if (st === 'err') {
      return page({
        band: saBand('改简历 · 自我探索', '说明没有取到', '重新读取之后才能开始。', '没读到说明', { warn: 1 }),
        body: `${howto('说明没有取到。重新读取之后才能勾选同意。')}${acts([
          { fr: 'terms', title: '重新读取', desc: '再取一次开始前的说明', vis: UI.checklist(180) },
          { go: 'resume', title: '返回简历服务', desc: '先去办打印、扫描或别的简历事', vis: UI.resume(170) }
        ])}${foot(IDLE)}`,
        dock: { backLabel: '返回简历服务', ask: '问小青：这是测评吗？', pri: { label: startLabel, act: 'fr:start', disabled: true } }
      });
    }
    const terms = TERMS.map((t, i) => `<div class="fr-term"><span class="n">${i + 1}</span><b>${esc(t)}</b></div>`).join('');
    return page({
      band: saBand('改简历 · 自我探索', '先看完这四条', sub, status, { warn: !agree }),
      body: `${S().frGone === true ? remind('刚才那次已经删除，不能恢复。') : ''}${hero(UI.checklist(220), '<span class="fr-k">约 6 分钟 · 25 题</span><p>兴趣偏好、工作风格、团队偏好、价值取向、求职动机。</p><p>不评分、不排名，结果只给你自己看。</p>', 1)}${terms}
        <button class="fr-btn" data-fr="termsyes" aria-pressed="${agree ? 'true' : 'false'}">${agree ? '已勾选同意' : '我已阅读并同意以上说明'}</button>
        <button class="fr-btn" data-fr="sens" aria-pressed="${sens ? 'true' : 'false'}">同意作答涉及偏好和风格的题（可选，不改变这 25 题）${sens ? '，已勾选' : ''}</button>
        <button class="fr-btn" data-go="legal">隐私政策</button>${foot(IDLE)}`,
      dock: { backLabel: '返回简历服务', ask: '问小青：这是测评吗？', pri: { label: startLabel, act: 'fr:start', disabled: !(agree && termsOk()) } }
    });
  }

  function saQ() {
    const phase = S().frPhase || 'quiz';
    if (S().frOk !== true || phase === 'closed') {
      const ended = S().frOk === true && phase === 'closed';
      return page({
        band: saBand('自我探索 · 作答', ended ? '这次作答已经结束' : '还不能作答', ended ? '要再做一次，请从说明页开始。' : '同意之后才能一题一题作答。', ended ? '这次已结束' : '未同意说明', { warn: 1 }),
        body: `${howto(ended ? '这次作答已经结束。' : '先看完说明并勾选同意，才能开始作答。')}${acts([{ go: 'sa-intro', title: '返回说明', desc: '看完四条说明，勾选同意后再来', vis: UI.checklist(180) }])}${foot(IDLE)}`,
        dock: { backLabel: '返回说明', ask: '问小青：为什么不能答？', pri: { label: '返回说明', go: 'sa-intro' } }
      });
    }
    const map = ansMap();
    const answered = SA.filter((_, i) => map[i]).length;
    if (phase === 'review') {
      const all = answered === 25;
      const dims = DIMS.map((d, i) => {
        const from = i * 5;
        const got = [0, 1, 2, 3, 4].filter((k) => map[from + k]).length;
        return got > 0
          ? `<button class="fr-rowbtn" data-fr="jump" data-arg="${from}"><b>${esc(d)}</b><small>已答 ${got}/5 · 点回去改</small></button>`
          : `<div class="fr-row"><b>${esc(d)}</b><small>还没答</small></div>`;
      }).join('');
      return page({
        band: saBand('自我探索 · 复核', '提交前再看一遍', '没答完不能提交。', '提交前复核'),
        body: `${hero(UI.checklist(200), `<span class="fr-k">已答 ${answered} / 25</span><p>${!all && S().frNeed === true ? '还有题没答。' : '答过的组可以点回去改。'}</p>`, 1)}<div class="fr-rows">${dims}</div>${foot(IDLE)}`,
        dock: { backLabel: '回到最后一题', ask: false, pri: { label: '确认提交', act: 'fr:submit', disabled: !all } }
      });
    }
    const i = qIndex();
    const q = SA[i];
    const picked = map[i];
    const choices = [0, 1, 2].map((k) => `<button class="fr-choice${picked === 'ABC'[k] ? ' on' : ''}" data-fr="pick" data-arg="${'ABC'[k]}"><span class="ck">${'ABC'[k]}</span><b>${esc(q[k + 1])}</b></button>`).join('');
    const last = i === 24;
    return page({
      band: saBand('自我探索 · ' + DIMS[Math.floor(i / 5)], esc(q[0]), '凭第一感觉选。不能跳过。', '已答 ' + answered + '/25'),
      body: `<div class="fr-q">${choices}</div>${hero(UI.checklist(200), `<span class="fr-k">第 ${i + 1} 题 / 共 25 题</span><p>${esc(DIMS[Math.floor(i / 5)])} · 本组第 ${i % 5 + 1} 题 / 5</p><p>已答 ${answered} / 25</p>`, 1)}${foot(IDLE)}`,
      dock: { backLabel: i === 0 ? '返回说明' : '上一题', ask: false, pri: { label: last ? '去复核' : '下一题', id: 'frNext', act: 'fr:nq', disabled: !picked } }
    });
  }

  function saResult() {
    const aiDown = S().ai === 'down';
    const token = S().frToken !== false;
    const pdf = S().frPdf || 'no';
    const ask = S().frWithdraw === 'ask';
    const pre = ask ? overlay('<h2>撤回这次探索</h2><p>这次结果会删掉，不能恢复。</p><div class="fr-actions"><button class="btn sec" data-fr="keep">再想想</button><button class="btn danger" data-fr="withdraw">确认撤回</button></div>') : '';
    const ready = pdf === 'ready' && token;
    const scores = [['兴趣偏好', 4, '第 1、3、4 题'], ['工作风格', 3, '第 6、8 题'], ['团队偏好', 4, '第 11、12、14 题'], ['价值取向', 2, '第 16、18 题'], ['求职动机', 3, '第 21、23、25 题']];
    const scoreHtml = scores.map((d) => `<div class="fr-score"><div class="h"><b>${d[0]}</b><span class="n">${d[1]} / 5</span></div><span class="fr-meter"><i style="width:${d[1] / 5 * 100}%"></i></span><small>依据：${d[2]}</small></div>`).join('');
    const showBlurb = !aiDown && token;
    let note = '';
    if (aiDown && !token) note = '这次没有生成解读。上面的选择整理还在。这次不能生成打印件，也不能撤回。到期后会自动清掉。';
    else if (aiDown) note = '这次没有生成解读。上面的选择整理还在。';
    else if (!token) note = '这次不能生成打印件，也不能撤回。到期后会自动清掉。';
    let pdfNote = '';
    if (pdf === 'busy') pdfNote = '正在生成，好了才能去打印。';
    else if (pdf === 'nocred' || (pdf === 'ready' && !token)) pdfNote = '还没有可打印的文件。';
    else if (ready) pdfNote = '可以去打印了。';
    return page({
      pre,
      band: saBand('自我探索 · 结果', '这是你这次的选择整理', '保留 24 小时。' + IDLE, '仅供自我参考'),
      body: `${showBlurb ? `<div class="fr-kicker"><span class="fr-k">AI 生成，仅供参考</span>${cap('示例')}</div>` : ''}
        ${hero(UI.report(240), `<span class="fr-k">保留 24 小时</span><p>五个方向各看你选了多少。</p>${showBlurb ? '<p>你更在意把事情做成看得见的结果。不贴类型，也不说适合哪类岗位。</p>' : ''}`, 1)}
        ${note ? remind(note) : ''}${scoreHtml}
        <div class="fr-rowbtns"><button class="fr-btn" data-go="sa-history" data-fr="rec">查看记录</button>${actBtn(pdf === 'busy' ? '正在生成 PDF 预览' : '生成 PDF 预览', 'pdf', null, !token || pdf === 'busy')}${actBtn('撤回', 'askw', null, !token)}</div>
        ${aiDown ? actBtn('重新作答（约 5 分钟）', 'retry5') : ''}${foot(pdfNote)}`,
      dock: { backLabel: '返回说明', ask: '问小青：结果怎么用？', pri: ready ? { label: '去打印工作台核价', go: 'pii' } : { label: '去打印工作台核价', disabled: true } }
    });
  }

  function saHistory() {
    const rec = S().frRec === true;
    if (!rec) {
      return page({
        band: saBand('自我探索 · 记录', '这里还没有可查看的记录', '只显示这台机器上这一次。', '还没有记录', { warn: 1 }),
        body: `${howto('这里还没有可查看的记录。')}${acts([
          { go: 'sa-intro', title: '开始一次自我探索', desc: '约 6 分钟，25 道选择题', take: '从四条说明开始', vis: UI.checklist(160) },
          { go: 'my-ai', title: 'AI 服务记录', desc: '登录后可以看次数', take: '去看次数和记录', vis: UI.stack(140) }
        ])}${foot(IDLE)}`,
        dock: { backLabel: '返回说明', ask: '问小青：记录在哪？', pri: { label: '开始一次自我探索', go: 'sa-intro' } }
      });
    }
    return page({
      band: saBand('自我探索 · 记录', '这一次的记录', '答案没有保存，不能回放选项。', '只保留这一次'),
      body: `${hero(UI.report(240), '<span class="fr-k">保留 24 小时</span><p>五个方向：兴趣、风格、团队、价值、动机。</p><p>答案没有保存。</p>', 1)}
        <div class="fr-rowbtns"><button class="fr-btn" data-go="sa-result">回看这次结果</button><button class="fr-btn" data-go="my-ai">AI 服务记录</button></div>${foot(IDLE)}`,
      dock: { backLabel: '返回说明', ask: '问小青：记录在哪？' }
    });
  }


  const screens = { scratch, 'scratch-1': scratch1, templates, 'gen-preview': preview, materials, 'materials-result': materialsResult, jobfit, 'jobfit-result': jobfitResult, 'jobfit-actions': jobfitActions, career, 'sa-intro': saIntro, 'sa-q': saQ, 'sa-result': saResult, 'sa-history': saHistory };

  function refresh() { if (window.__proto) window.__proto.refresh(); }
  function go(id) { window.go(id); }
  function prep(b) {
    if (b.dataset.fr === 'intent' || b.dataset.arg === 'optimize') S().intent = 'optimize';
    if (b.dataset.fr === 'rec') S().frRec = true;
    if (b.dataset.fr === 'again') S().frFit = 'form';
  }
  function onType(btn) {
    const pair = FILL[btn.dataset.fr];
    if (!pair) return;
    S()[pair[0]] = true;
    refresh();
  }
  function onFr(key, arg) {
    const s = S();
    if (key === 'next') {
      if (!show('frName')) return;
      if (s.ai !== 'down' && s.frConsent !== 'yes' && s.frDecline !== true && s.frSkip !== true) { s.frConsent = 'open'; refresh(); return; }
      go('scratch-1'); return;
    }
    if (key === 'next2') { if (show('frPos')) go('gen-preview'); return; }
    if (key === 'agree') { s.frConsent = 'yes'; s.frDecline = false; if (show('frName')) go('scratch-1'); else refresh(); return; }
    if (key === 'decline') { s.frConsent = ''; s.frSkip = true; refresh(); return; }
    if (key === 'export') { s.frExport = 'busy'; refresh(); return; }
    if (key === 'job') { s.frJob = s.frJob === arg ? '' : arg; refresh(); return; }
    if (key === 'filter') { const order = ['all', 'resume', 'common']; const i = order.indexOf(s.frFilter || 'all'); s.frFilter = order[(i + 1) % order.length]; refresh(); return; }
    if (key === 'sel') { const n = +arg; s.frSel = s.frSel === n ? -1 : n; refresh(); return; }
    if (key === 'more') { s.frMore = s.frMore !== true; refresh(); return; }
    if (key === 'xmore') { s.frExMore = s.frExMore !== true; refresh(); return; }
    if (key === 'reload') {
      const here = document.querySelector('#stage .screen:not(.leave)');
      const hid = here && here.dataset.id;
      if (hid === 'materials') s.frMat = 'load';
      else s.frTpl = 'load';
      refresh(); return;
    }
    if (key === 'gennew') { go('scratch'); return; }
    if (key === 'printhas' || key === 'printgo') { go('print'); return; }
    if (key === 'myres') { go('my-resumes'); return; }
    if (key === 'hasfile') { go('resume-src'); return; }
    if (key === 'reread') { s.frPrev = 'load'; refresh(); return; }
    if (key === 'fmt') { s.frFmt = arg; s.expFmt = arg; s.frFmtN = (typeof s.frFmtN === 'number' ? s.frFmtN : 0) + 1; refresh(); return; }
    if (key === 'facts') { s.frFact = 'open'; refresh(); return; }
    if (key === 'closefact') { s.frFact = ''; refresh(); return; }
    if (key === 'confirm') { s.frConfirmed = s.frConfirmed === true ? false : true; refresh(); return; }
    if (key === 'hint') { s.frHint = true; refresh(); return; }
    if (key === 'phone') { s.frPhoneView = s.frPhoneView === true ? false : true; refresh(); return; }
    if (key === 'relink') { s.frRelink = 'busy'; refresh(); return; }
    if (key === 'layout') { s.frLayout = arg; refresh(); return; }
    if (key === 'mtype') { const i = MAT_TYPES.indexOf(s.frMatType || '求职信'); s.frMatType = MAT_TYPES[(i + 1) % MAT_TYPES.length]; s.frMatTpl = ''; refresh(); return; }
    if (key === 'mtpl') { s.frMatTpl = s.frMatTpl === arg ? '' : arg; refresh(); return; }
    if (key === 'toform') { if (!s.frMatTpl) return; s.frMat = 'form'; refresh(); return; }
    if (key === 'backpick') { s.frMat = 'pick'; refresh(); return; }
    if (key === 'backform') { s.frMat = 'form'; refresh(); return; }
    if (key === 'mgen') {
      if (!show('frMName') || !show('frMRole')) { s.frMatTry = true; refresh(); return; }
      s.frMat = 'busy'; refresh(); return;
    }
    if (key === 'cgen') { if (s.ai === 'down' && s.frPlan !== 'ready') return; s.frPlan = 'gen'; s.frPrintAsk = false; refresh(); return; }
    if (key === 'retry') { s.frMat = 'busy'; refresh(); return; }
    if (key === 'regen') { s.frMat = 'form'; go('materials'); return; }
    if (key === 'docs') { if (s.frFile === 'demo') return; go('my-docs'); return; }
    if (key === 'peek') { s.frPeek = s.frFile === 'preview-fail' ? 'err' : 'open'; refresh(); return; }
    if (key === 'closepeek') { s.frPeek = ''; refresh(); return; }
    if (key === 'auth') { if (s.ai === 'down') { s.frFit = 'down'; refresh(); return; } s.frFit = 'auth'; refresh(); return; }
    if (key === 'noauth') { s.frFit = 'form'; refresh(); return; }
    if (key === 'yesauth') { s.frFit = 'wait'; refresh(); return; }
    if (key === 'reform') { s.frFit = 'form'; refresh(); return; }
    if (key === 'actions') { go('jobfit-actions'); return; }
    if (key === 'materials') { go('materials'); return; }
    if (key === 'again') { s.frFit = 'form'; s.frRep = ''; go('jobfit'); return; }
    if (key === 'printrep' || key === 'printact' || key === 'printplan') {
      if (key === 'printrep') s.frRep = 'wait';
      if (key === 'printact') s.frAct = 'wait';
      if (key === 'printplan') s.frPrintWait = 'wait';
      refresh(); return;
    }
    if (key === 'printask') { s.frPrintAsk = true; refresh(); return; }
    if (key === 'printanyway') { s.frPrintAsk = false; s.frPrintWait = 'wait'; refresh(); return; }
    if (key === 'full') { s.frPrintAsk = false; if (s.ai === 'down') { refresh(); return; } s.frPlan = 'gen'; refresh(); return; }
    if (key === 'genplan') { s.frPlan = 'gen'; refresh(); return; }
    if (key === 'terms') { s.frTerms = 'load'; refresh(); return; }
    if (key === 'termsyes') { s.frAgree = s.frAgree === true ? false : true; refresh(); return; }
    if (key === 'sens') { s.frSens = s.frSens === true ? false : true; refresh(); return; }
    if (key === 'start') {
      if (!(s.frAgree === true && termsOk())) return;
      s.frOk = true; s.frPhase = 'quiz'; if (typeof s.frQ !== 'number') s.frQ = 0; if (s.frResubmit === true && s.frAns) { go('sa-result'); return; }
      s.frQ = 0; s.frAns = {}; go('sa-q'); return;
    }
    if (key === 'pick') {
      const m = ansMap(); m[qIndex()] = arg; s.frAns = m;
      const b = document.querySelector('.screen:not(.leave) #frNext');
      document.querySelectorAll('.screen:not(.leave) .fr-choice').forEach((n) => n.classList.toggle('on', n.dataset.arg === arg));
      if (b) b.disabled = false;
      return;
    }
    if (key === 'nq') {
      const m = ansMap();
      const i = qIndex();
      if (!m[i]) return;
      if (i >= 24) { s.frPhase = 'review'; refresh(); return; }
      s.frQ = i + 1; refresh(); return;
    }
    if (key === 'jump') { s.frQ = +arg; s.frPhase = 'quiz'; refresh(); return; }
    if (key === 'submit') {
      const m = ansMap();
      if (SA.some((_, i) => !m[i])) { s.frNeed = true; refresh(); return; }
      s.frRec = true; s.frPhase = 'closed'; go('sa-result'); return;
    }
    if (key === 'pdf') { if (s.frToken === false) return; s.frPdf = 'busy'; refresh(); return; }
    if (key === 'askw') { if (s.frToken === false) return; s.frWithdraw = 'ask'; refresh(); return; }
    if (key === 'keep') { s.frWithdraw = ''; refresh(); return; }
    if (key === 'withdraw') {
      s.frRec = false; s.frOk = false; s.frPhase = ''; s.frAns = {}; s.frPdf = 'no'; s.frWithdraw = ''; s.frQ = 0; s.frAgree = false; s.frGone = true;
      go('sa-intro'); return;
    }
    if (key === 'retry5') { s.frOk = false; s.frPhase = ''; s.frQ = 0; s.frAns = {}; s.frPdf = 'no'; go('sa-intro'); return; }
  }

  function listen(el, id) {
    const onClick = (e) => {
      const btn = e.target.closest('button');
      if (!btn || !el.contains(btn)) return;
      if (btn.dataset.act === 'back') {
        let dest = '';
        const dock = !!btn.closest('.dock');
        if (id === 'scratch-1') dest = 'scratch';
        else if (id === 'gen-preview') dest = S().frPrev === 'none' ? 'resume' : S().frPrev === 'lost' || S().frPrev === 'bad' ? 'home' : 'scratch';
        else if (id === 'materials' && S().logged && (S().frMat === 'form')) dest = 'materials';
        else if (id === 'materials-result') dest = dock ? 'materials' : 'resume';
        else if (id === 'jobfit-result') dest = dock ? 'jobfit' : 'resume';
        else if (id === 'jobfit-actions') dest = dock ? 'jobfit-result' : 'resume';
        else if (id === 'sa-intro') dest = 'resume';
        else if (id === 'sa-result') dest = 'sa-intro';
        else if (id === 'sa-history') dest = dock ? 'sa-intro' : 'resume';
        else if (id === 'sa-q') {
          if (S().frOk === true && (S().frPhase || 'quiz') === 'quiz' && qIndex() > 0) { S().frQ = qIndex() - 1; e.stopPropagation(); refresh(); return; }
          if (S().frOk === true && S().frPhase === 'review') { S().frPhase = 'quiz'; S().frQ = 24; e.stopPropagation(); refresh(); return; }
          dest = 'sa-intro';
        } else if (id === 'career' && (S().frPrintAsk === true || S().frPrintWait === 'wait')) {
          S().frPrintAsk = false; S().frPrintWait = ''; e.stopPropagation(); refresh(); return;
        }
        if (id === 'materials' && dest === 'materials') { S().frMat = 'pick'; e.stopPropagation(); refresh(); return; }
        if (dest) { e.stopPropagation(); go(dest); }
        return;
      }
      if (btn.dataset.act === 'type') { onType(btn); return; }
      if (btn.dataset.go) { prep(btn); return; }
      const key = btn.dataset.fr || ((btn.dataset.act || '').startsWith('fr:') ? btn.dataset.act.slice(3) : '');
      if (!key) return;
      e.stopPropagation();
      onFr(key, btn.dataset.arg || '');
    };
    const onDemo = (e) => {
      const ev = e.detail;
      const s = S();
      if (id === 'scratch' || id === 'scratch-1') {
        if (ev === 'consent') { s.frConsent = 'open'; refresh(); }
        if (ev === 'draft' && s.frExport === 'busy') go('pii');
        if (ev === 'age') { s.frDecline = true; s.frConsent = ''; refresh(); }
      }
      if (id === 'templates') {
        if (ev === 'ready') { s.frTpl = ''; refresh(); }
        if (ev === 'fail') { s.frTpl = 'err'; refresh(); }
      }
      if (id === 'gen-preview') {
        if (ev === 'ready') { s.frPrev = ''; s.frRelink = s.frRelink === 'busy' ? 'ready' : s.frRelink; refresh(); }
        if (ev === 'fail') { s.frPrev = 'fail'; refresh(); }
      }
      if (id === 'materials') {
        if (ev === 'ready') { s.frMat = 'pick'; refresh(); }
        if (ev === 'done' && s.frMat === 'busy') { s.frFile = s.frFile || 'ok'; go('materials-result'); }
        if (ev === 'fail') { s.frMat = 'fail'; refresh(); }
      }
      if (id === 'jobfit') {
        if (ev === 'done' && s.frFit === 'wait') go('jobfit-result');
        if (ev === 'fail') { s.frFit = 'down'; refresh(); }
      }
      if (id === 'jobfit-result') {
        if (ev === 'print-ready' && s.frRep === 'wait') { s.frRep = ''; go('pii'); }
        if (ev === 'print-fail') { s.frRep = 'fail'; refresh(); }
      }
      if (id === 'jobfit-actions') {
        if (ev === 'print-ready' && s.frAct === 'wait') { s.frAct = 'ready'; go('pii'); }
        if (ev === 'print-fail') { s.frAct = 'fail'; refresh(); }
      }
      if (id === 'career') {
        if (ev === 'done' && s.frPlan === 'gen') { s.frPlan = 'ready'; refresh(); }
        if (ev === 'fail') { s.frPlan = 'fail'; refresh(); }
        if (ev === 'print-ready' && s.frPrintWait === 'wait') { s.frPrintWait = ''; go('pii'); }
        if (ev === 'print-fail') { s.frPrintWait = ''; s.frPlan = s.frPlan === 'ready' ? 'ready' : 'fail'; refresh(); }
      }
      if (id === 'sa-intro' && ev === 'ready') { s.frTerms = 'ok'; refresh(); }
      if (id === 'sa-intro' && ev === 'fail') { s.frTerms = 'err'; refresh(); }
      if (id === 'sa-result') {
        if (ev === 'print-ready' && s.frPdf === 'busy') { s.frPdf = s.frToken === false ? 'nocred' : 'ready'; refresh(); }
        if (ev === 'print-fail') { s.frPdf = 'nocred'; refresh(); }
      }
    };
    el.addEventListener('click', onClick);
    el.addEventListener('proto-demo', onDemo);
    return () => { el.removeEventListener('click', onClick); el.removeEventListener('proto-demo', onDemo); };
  }

  function demo(id) {
    if (id === 'scratch' || id === 'scratch-1') return [{ label: '演示：第一次使用 AI', ev: 'consent' }, { label: '演示：导出原话好了', ev: 'draft' }, { label: '演示：未满 14 周岁', ev: 'age' }];
    if (id === 'templates' || id === 'sa-intro') return [{ label: '演示：读取好了', ev: 'ready' }, { label: '演示：读取失败', ev: 'fail' }];
    if (id === 'gen-preview') return [{ label: '演示：读回来了', ev: 'ready' }, { label: '演示：没读回来', ev: 'fail' }];
    if (id === 'materials') return [{ label: '演示：目录好了', ev: 'ready' }, { label: '演示：生成好了', ev: 'done' }, { label: '演示：生成失败', ev: 'fail' }];
    if (id === 'jobfit') return [{ label: '演示：对照好了', ev: 'done' }, { label: '演示：对照失败', ev: 'fail' }];
    if (id === 'jobfit-result' || id === 'jobfit-actions' || id === 'sa-result') return [{ label: '演示：打印版好了', ev: 'print-ready' }, { label: '演示：打印版失败', ev: 'print-fail' }];
    if (id === 'career') return [{ label: '演示：方案好了', ev: 'done' }, { label: '演示：方案失败', ev: 'fail' }, { label: '演示：打印件好了', ev: 'print-ready' }];
    return [];
  }

  window.FR = {
    render: (id) => (screens[id] ? screens[id]() : ''),
    mount: (id, el) => listen(el, id),
    demo
  };
})();
