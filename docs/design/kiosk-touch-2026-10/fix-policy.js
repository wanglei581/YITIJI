/* fix-policy.js：查政策与受控扩展。类名一律 fy-。新屏 policy-check / contract-wait / campus-welcome 也在这里。 */
(function () {
  const css = document.createElement('style');
  css.textContent = `
.body.fy{justify-content:flex-start;gap:12px;padding:14px 40px 12px;overflow:hidden}
.fy-stack{display:flex;flex-direction:column;gap:12px;flex:none}
.fy-h{margin:0;font:700 26px/1.3 var(--sans)}
.fy-card{background:var(--card);border:1.5px solid var(--edge);border-radius:24px;padding:16px 18px;display:flex;flex-direction:column;gap:8px;flex:none}
.fy-card h3{margin:0;font:700 28px/1.3 var(--serif)}
.fy-li{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.fy-li li{font-size:24px;line-height:1.35;color:var(--ink);padding-left:1.1em;position:relative}
.body.fy-detail .fy-li{gap:4px}
.body.fy-detail .fy-li li{line-height:1.3}
.fy-li li::before{content:"";position:absolute;left:0;top:.55em;width:8px;height:8px;border-radius:50%;background:var(--teal)}
.fy-row{flex:none;min-height:104px;width:100%;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:4px;padding:12px 16px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge);text-align:left;color:var(--ink)}
.fy-row b{font-size:26px;line-height:1.3;font-weight:700}
.fy-row small,.fy-row span{font-size:22px;line-height:1.35;color:var(--ink-2);font-weight:500}
.fy-row .go{margin-top:2px;font-size:22px;font-weight:700;color:var(--teal-ink)}
.fy-row:active{transform:scale(.985)}
.fy-row[disabled],.fy-row[aria-disabled="true"]{opacity:.72}
.fy-off{background:var(--well);border-style:dashed;color:var(--ink-2)}
.fy-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.fy-tabs{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;flex:none}
.fy-tab{min-height:72px;border-radius:16px;background:var(--card);border:1.5px solid var(--edge);font-size:22px;font-weight:700;color:var(--ink);padding:6px}
.fy-tab.on{background:var(--deep);color:var(--cream);display:flex;align-items:center;justify-content:center}
.fy-ident{min-height:72px;width:100%;border-radius:16px;background:var(--card);border:1.5px solid var(--edge);display:flex;align-items:center;justify-content:space-between;padding:0 16px;font-size:24px;font-weight:700;text-align:left;flex:none}
.fy-opts{display:flex;flex-direction:column;gap:10px;flex:none}
.fy-opt{flex:none;min-height:112px;border-radius:18px;background:var(--card);border:1.5px solid var(--edge);font-size:26px;font-weight:700;text-align:left;padding:8px 18px;color:var(--ink)}
.fy-opt.on{background:var(--teal-wash);border-color:var(--teal);color:var(--teal-ink)}
.fy-opt:active,.fy-tab:active,.fy-ident:active,.fy-big:active{transform:scale(.985)}
.fy-steps{display:flex;flex-direction:column;gap:10px;flex:none}
.fy-step{flex:none;min-height:118px;display:flex;align-items:center;gap:14px;padding:10px 16px;border-radius:18px;background:var(--card);border:1.5px solid var(--edge)}
.fy-step.on{background:var(--teal-wash);border-color:var(--teal)}
.fy-step i{flex:none;width:48px;height:48px;border-radius:50%;background:var(--deep);color:var(--cream);display:grid;place-items:center;font-style:normal;font-weight:700;font-size:22px}
.fy-step.fy-mini{min-height:0;padding:6px 12px;gap:8px}
.fy-step.fy-mini i{width:40px;height:40px;font-size:20px}
.fy-step b{display:block;font-size:24px}
.fy-step small{display:block;font-size:20px;color:var(--ink-3);font-weight:500}
.fy-sk{flex:none;min-height:132px;border-radius:22px;background:var(--well);border:1.5px dashed var(--edge);display:flex;align-items:center;padding:0 22px;font-size:24px;font-weight:700;color:var(--ink-3)}
.fy-cap{font-style:normal;display:inline-flex;align-items:center;height:32px;padding:0 12px;border-radius:16px;background:var(--well);border:1px solid var(--edge);font-size:20px;color:var(--ink-2);font-weight:700}
.fy-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:20px;color:var(--ink-3)}
.fy-prog{display:grid;grid-template-columns:repeat(9,1fr);gap:8px;flex:none}
.fy-prog b{height:64px;border-radius:16px;background:var(--well);border:1.5px solid var(--edge);display:grid;place-items:center;font-size:22px;color:var(--ink-3)}
.fy-prog b.on{background:var(--deep);color:var(--cream);border-color:var(--deep)}
.fy-prog b.done{background:var(--teal-wash);color:var(--teal-ink);border-color:var(--teal)}
.fy-up{display:grid;grid-template-columns:210px 1fr;gap:16px;align-items:center;min-height:300px;padding:16px;border-radius:24px;background:var(--card);border:1.5px solid var(--edge);flex:none}
.fy-up .v{min-height:250px;border-radius:18px;background:var(--well);display:grid;place-items:center}
.fy-up b{font-size:28px;line-height:1.3}
.fy-up p{margin:6px 0 0;font-size:22px;line-height:1.4;color:var(--ink-2)}
.fy-big{display:grid;grid-template-columns:210px 1fr;gap:16px;align-items:center;min-height:300px;width:100%;padding:14px 16px;border-radius:28px;background:var(--card);border:1.5px solid var(--edge);text-align:left;flex:none}
.fy-big .v{min-height:240px;border-radius:20px;background:var(--well);display:grid;place-items:center}
.fy-big b{display:block;font:700 36px/1.25 var(--serif)}
.fy-big span{display:block;margin-top:8px;font-size:24px;line-height:1.4;color:var(--ink-2)}
.fy-big em{display:block;margin-top:10px;font-style:normal;font-size:22px;font-weight:700;color:var(--teal-ink)}
.fy-offgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.fy-offtile{min-height:148px;border-radius:22px;background:var(--well);border:1.5px dashed var(--edge);padding:14px 16px;display:flex;flex-direction:column;justify-content:center;gap:6px}
.fy-offtile b{font-size:24px;line-height:1.3}
.fy-offtile small{font-size:20px;color:var(--ink-3)}
.fy-warn{background:var(--cin-wash);border-radius:18px;padding:14px 16px;font-size:24px;line-height:1.45;color:var(--cinnabar);flex:none}
.fy-ok{background:var(--teal-wash);border-radius:18px;padding:14px 16px;font-size:24px;line-height:1.45;color:var(--teal-ink);flex:none}
.fy-kv{display:flex;justify-content:space-between;gap:12px;min-height:52px;align-items:center;font-size:24px;border-top:1px solid var(--line)}
.fy-kv b{font-weight:700}
.fy-layer .fy-scrim{position:absolute;inset:0;z-index:1;background:transparent}
.fy-layer .dialog,.fy-layer .sheet{z-index:2}
.fy-layer .dialog{width:min(920px,calc(100% - 80px));text-align:left;align-items:stretch}
.fy-layer .dialog h2{text-align:left}
.body.fy .btn.pri,.body.fy .btn.sec{min-height:72px}
.body.fy-hub .fy-row{min-height:168px}
.body.fy-hub-tight .fy-row{min-height:140px}
.body.fy-list .fy-row{min-height:118px}
.body.fy-hits .fy-row{min-height:100px}
.body.fy-detail .fy-row{min-height:96px}
.body.fy-wait .fy-step{min-height:188px}
.body.fy-welcome .fy-step{min-height:148px}
.body.fy-welcome .fy-row{min-height:92px}
.body.fy-campus .fy-row{min-height:158px}
.body.fy-mods .fy-big .v{min-height:0;height:168px;align-self:center}
.body.fy-doc .fy-up{min-height:430px}
.body.fy-box .fy-up{min-height:360px}
.body.fy-result .fy-stack{gap:8px}
.body.fy-off .fy-big{min-height:300px}
.body.fy-short .fy-big{min-height:348px}
.fy-bring{min-height:78px;border-radius:16px;background:var(--well);padding:8px 14px;font-size:28px;line-height:1.45;font-weight:700;display:flex;align-items:center}
.fy-row.on{background:var(--teal-wash);border-color:var(--teal)}
`;
  document.head.appendChild(css);

  const { icon, band, dock, nav, qr, checklist, phone, scanPaper, idcard, report, resume, stack, usb } = UI;
  const S = () => window.S || {};
  const HELP = '需要帮助？拨打服务电话 183-6916-1921';
  const PHONE_NOTE = '号码与服务时间从后台读，读不到不显示';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => icon(n, s || 28, 2);

  function F(o) {
    const foot = o.dock === false ? '' : (o.dockHtml || dock(o.dock || {}));
    const bottom = o.nav === false ? '' : nav(o.nav || 'home');
    const cls = 'body fy' + (o.cls ? ' ' + o.cls : '');
    return (o.band ? band(o.band) : '') + `<main class="${cls}">${o.body || ''}</main>` + foot + bottom;
  }
  function bar(o) {
    const back = o.back === false ? '' : `<button class="btn sec" ${o.backGo ? `data-go="${o.backGo}"` : 'data-act="back"'}>${ic('chevL', 30)}${esc(o.backLabel || '返回')}</button>`;
    const ask = o.ask === false ? '' : `<button class="askq" data-go="xq" data-ctx="${esc(o.ask || '')}"><span class="mic">${ic('mic', 30)}</span><span>${esc(o.ask || '问小青：这一步怎么办？')}</span></button>`;
    let pri = '';
    if (o.pri) {
      const p = o.pri;
      const attrs = p.disabled ? 'disabled' : (p.fy ? `data-fy="${p.fy}"` : (p.go ? `data-go="${p.go}"` : ''));
      pri = `<button class="btn ${p.kind || 'pri'}" ${attrs}>${esc(p.label)}${ic('arrowR', 28)}</button>`;
    }
    return `<footer class="dock">${back}${ask}${pri}</footer>`;
  }
  function stPill(text, warn) { return { text, warn: !!warn }; }
  function layer(inner) {
    return `<div class="overlay fy-layer"><button class="fy-scrim" data-fy="close" aria-label="关闭"></button>${inner}</div>`;
  }
  function dialog(title, body, buttons) {
    return layer(`<div class="dialog" role="dialog"><h2>${esc(title)}</h2>${body}<div class="btns">${buttons}</div></div>`);
  }
  function sheet(title, body) {
    return layer(`<div class="sheet" role="dialog"><div class="grab"></div><h2>${esc(title)}</h2>${body}</div>`);
  }
  function cap() { return '<i class="fy-cap">示例</i>'; }
  function remind(text, name) {
    return `<div class="remind">${ic(name || 'call', 34)}<span>${text}</span></div>`;
  }
  function fine(text) { return `<p class="fine">${text}</p>`; }
  function sk(label, h) {
    return `<div class="fy-sk" style="${h ? `min-height:${h}px` : ''}">${esc(label || '正在读取')}</div>`;
  }
  function bullets(list) {
    return `<ul class="fy-li">${list.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
  }
  function bigGo(o) {
    const h = o.h ? ` style="min-height:${o.h}px"` : '';
    const attrs = o.fy ? `data-fy="${o.fy}"${o.arg ? ` data-arg="${esc(o.arg)}"` : ''}` : `data-go="${o.go}"`;
    return `<button class="fy-big"${h} ${attrs}><div class="v">${o.vis || ''}</div><div><b>${esc(o.t)}</b><span>${esc(o.d)}</span><em>${esc(o.goLabel || '进入')}</em></div></button>`;
  }
  function offTile(title, desc, h) {
    return `<div class="fy-offtile" style="${h ? `min-height:${h}px` : ''}" role="group" aria-disabled="true"><b>${esc(title)}</b><small>本机暂未开通</small>${desc ? `<small>${esc(desc)}</small>` : ''}</div>`;
  }

  const AUDS = [['all', '全部'], ['graduate', '高校毕业生'], ['flexible', '灵活就业'], ['migrant', '返乡务工'], ['startup', '创业人员'], ['hardship', '困难群体']];
  const audName = (k) => (AUDS.find((a) => a[0] === (k || 'all')) || AUDS[0])[1];
  const TABS = [['policy', '就业政策'], ['eligibility', '条件核对'], ['social', '社保指南'], ['register', '就业登记'], ['notice', '政策公告']];

  function P(id, aud, title, summary, status, published, sync, conditions, materials, steps, url) {
    return { id, audiences: aud, title, summary, status, published, sync, conditions, materials, steps, officialUrl: url || '', sourceName: '合作机构发布' };
  }
  const LIB = [
    P('ex-housing', ['graduate'], '青年人才住房补贴申领说明', '在本地就业的全日制毕业生，按当季说明准备住房补贴材料。', '申报进行中', '2026-09-01', '2026-09-12',
      ['全日制大专及以上，毕业年限符合当季说明', '在本地单位就业，并正在缴纳社保', '在本地无自有住房', '劳动合同剩余期限达到发布方要求', '在规定批次内申报，逾期不补报'],
      ['身份证', '毕业证或学历备案表', '劳动合同', '社保缴纳证明', '本人银行卡'],
      ['阅读来源说明和申报时间', '按清单准备材料', '从来源入口提交', '结果以发布方审核为准'],
      'https://rsj.example.gov.cn/guide/housing'),
    P('ex-flexible', ['flexible'], '灵活就业人员社保补贴告知', '说明灵活就业登记、缴费记录和补贴材料从哪里看，不代为申领。', '长期可查', '2026-08-01', '2026-08-20',
      ['已办理就业或失业登记', '以灵活就业身份缴纳社会保险', '毕业年限或就业困难身份符合当地范围', '缴费记录连续，中间没有未说明的中断', '是否纳入补贴对象以发布方清单为准'],
      ['身份证', '就业或失业登记信息', '社保缴费记录', '灵活就业承诺或证明', '本人银行卡'],
      ['核对登记和缴费记录', '按发布方清单备齐材料', '从来源渠道查询或申请', '到账与否以经办结果为准'],
      ''),
    P('ex-startup', ['startup'], '初次创业一次性补贴告知', '初次创办小微企业或个体工商户的人，查看补贴材料和来源入口。', '本季截止 10 月 31 日', '2026-07-15', '2026-07-28',
      ['创业主体为本人初次注册', '注册地在发布方规定的区域', '注册时间落在政策规定的年限内', '正常经营并按规定缴纳社保', '未领过同一项一次性创业补贴'],
      ['身份证', '营业执照', '社保缴费记录', '场地租赁或经营材料', '对公或本人银行账户'],
      ['确认主体和注册时间', '准备经营与社保材料', '从来源入口提交', '按发布方公示等待审核'],
      'https://hrss.example.gov.cn/startup'),
    P('ex-skill', ['general'], '职业技能评价补贴申领说明', '取得符合要求的职业资格或技能等级证书后，查看申领期限和材料。', '长期可查', '2026-06-01', '2026-06-18',
      ['证书纳入人社部门公布的评价目录', '取证时间在规定的申领期限内', '证书信息可在指定渠道核验', '申领时的就业或参保状态符合要求', '同一证书未重复申领'],
      ['身份证', '职业资格或技能等级证书', '证书查询核验页', '社保或就业状态材料', '本人银行卡'],
      ['核对证书是否在目录内', '确认还在申领期限', '准备证书和身份材料', '从来源入口提交'],
      'https://www.12333.gov.cn/job/?channel=12333'),
    P('ex-intern', ['graduate'], '就业见习补贴告知', '离校未就业毕业生参加见习的，查看见习协议和补贴材料。', '申报进行中', '2026-05-12', '2026-05-30',
      ['见习人员为离校未就业高校毕业生', '见习单位在发布方公布的名单内', '见习期限达到规定月数', '按月留存考勤和指导记录', '见习期间未同时领取失业金'],
      ['身份证', '毕业证', '见习协议', '考勤与指导记录', '见习单位开具的证明'],
      ['确认见习单位在名单内', '核对协议和见习月数', '整理考勤与证明', '由见习单位从来源入口申报'],
      'https://rsj.example.gov.cn/guide/intern'),
    P('ex-hardship', ['hardship'], '就业困难人员社保补贴告知', '经认定为就业困难人员后，查看社保补贴需要的登记和缴费材料。', '长期可查', '2026-04-08', '2026-04-22',
      ['已取得就业困难人员认定', '认定仍在有效期内', '以灵活就业或单位吸纳方式参保', '补贴期限未超过当地上限', '未与其他互斥补贴同时领取'],
      ['身份证', '就业困难人员认定材料', '社保缴费记录', '就业登记信息', '本人银行卡'],
      ['核对认定是否有效', '打印或下载缴费记录', '按清单备齐材料', '从来源入口查询或申请'],
      ''),
    P('ex-migrant', ['migrant'], '返乡入乡创业补贴说明', '返乡创办项目的人，查看场地、带动就业和补贴材料。', '即将截止', '2026-03-02', '2026-03-19',
      ['户籍或常住地符合返乡入乡范围', '项目在当地注册并实际经营', '带动就业人数达到当季要求', '场地和投入有可核对的凭证', '在截止日前提交'],
      ['身份证', '户口或居住证明', '营业执照', '场地合同或产权材料', '带动就业的劳动合同或证明'],
      ['确认是否还在申报期', '核对带动就业人数', '准备场地和主体材料', '从来源入口提交'],
      'https://rsj.example.gov.cn/guide/return'),
    P('ex-train', ['hardship', 'general'], '失业人员职业培训告知', '登记失业后参加目录内培训的，查看培训机构和补贴材料。', '长期可查', '2026-02-10', '2026-02-26',
      ['已办理失业登记', '培训项目在当季目录内', '培训机构具备相应资质', '结业或取证时间可核验', '培训期间的身份状态符合要求'],
      ['身份证', '失业登记信息', '培训协议或录取通知', '结业证或评价结果', '本人银行卡'],
      ['先看当季培训目录', '选定机构并保留协议', '完成培训或评价', '从来源入口申领或查询'],
      'https://www.12333.gov.cn/')
  ];
  const BUILTIN = [
    { id: 'builtin-job-subsidy', audiences: ['graduate', 'hardship'], title: '一次性求职创业补贴', summary: '毕业学年内有就业意愿、并符合困难条件的，先对照条件再准备材料。', conditions: ['毕业学年学生，或当地规定的高校毕业生', '有就业或创业意愿', '符合困难家庭、残疾、助学贷款等条件之一', '在学校或发布方公布的申报周期内', '同一学年未重复领取'], materials: ['身份证', '学生身份或毕业信息证明', '困难类型证明', '本人银行卡或学校要求的账户', '申报表（按学校样本）'], steps: ['阅读申报时间和条件', '按学校或发布方准备材料', '从来源入口或学校渠道提交', '等待发布方审核'], officialUrl: 'https://gjzwfw.www.gov.cn/col/col1110/', sourceName: '综合整理 · 参照国家政务服务平台的公开说明' },
    { id: 'builtin-flexible-social', audiences: ['flexible'], title: '灵活就业社保补贴', summary: '说明灵活就业登记、社保缴纳和补贴材料，以及官方查询入口。', conditions: ['已完成就业或失业登记', '以灵活就业人员身份缴纳社会保险', '符合毕业年限或就业困难认定范围', '缴费月份达到当地要求', '未超过当地补贴期限'], materials: ['身份证', '就业或失业登记信息', '灵活就业承诺或证明', '社保缴费记录', '本人银行卡'], steps: ['先完成就业或失业登记', '确认社保缴费记录', '核对材料清单', '扫码打开来源入口'], officialUrl: 'https://hrss.qingdao.gov.cn/', sourceName: '综合整理 · 参考入口：青岛人社（其他地区请查询当地人社平台）' },
    { id: 'builtin-housing-talent', audiences: ['graduate'], title: '高校毕业生住房 / 安家政策', summary: '住房补贴、安家费、青年人才保障房等事项的常见材料和入口。', conditions: ['学历、毕业年限符合当地政策', '就业地与社保缴纳状态符合要求', '住房或租赁情况按当地口径提供', '政策可能按批次和年度预算执行', '最终资格以发布方审核为准'], materials: ['身份证', '毕业证或学位证', '劳动合同或就业证明', '社保缴纳证明', '住房或租赁材料（按当地要求）'], steps: ['确认城市和毕业时间', '查看发布方的事项说明', '准备学历和就业材料', '扫码打开来源入口'], officialUrl: 'https://hrsswb.qingdao.gov.cn/qddbbl/pages/gx.html', sourceName: '综合整理 · 参考入口：青岛人才服务（其他地区请查询当地平台）' },
    { id: 'builtin-skill-training', audiences: ['general'], title: '职业技能培训 / 技能提升补贴', summary: '补贴性培训、技能评价证书、申领期限和官方查询入口。', conditions: ['参加人社部门认可的培训或评价', '取得符合要求的证书或结果', '在规定期限内提出', '证书可在指定渠道核验', '按发布方渠道申请，不在本机代办'], materials: ['身份证', '培训或评价证明', '职业资格或技能等级证书', '社保或就业状态材料', '本人银行卡'], steps: ['查询本地培训目录', '确认机构和补贴标准', '完成培训或评价', '从来源入口申领或查询'], officialUrl: 'https://www.12333.gov.cn/job/?channel=12333', sourceName: '综合整理 · 人社培训补贴的公开说明' },
    { id: 'builtin-startup-loan', audiences: ['startup', 'graduate'], title: '创业担保贷款 / 创业补贴', summary: '准备创业或已注册的人，查看贷款、一次性资助和场租材料。', conditions: ['创业主体、注册年限符合当地政策', '社保缴纳和吸纳就业情况符合要求', '贷款以官方审批和银行授信为准', '补贴以财政资金安排为准', '本机不发放补贴或贷款'], materials: ['身份证', '营业执照或创业主体材料', '社保缴费记录', '场地租赁或经营材料', '银行账户信息（按经办要求）'], steps: ['确认主体和政策类型', '准备经营和社保材料', '扫码打开来源入口', '按公布的流程提交'], officialUrl: 'https://hrss.qingdao.gov.cn/', sourceName: '综合整理 · 参考入口：青岛人社（其他地区请查询当地人社平台）' }
  ];
  const SOCIAL = [
    { key: 'query', title: '参保信息查询', desc: '查询社保参保状态、缴费年限和账户余额。', steps: ['手机扫码打开来源入口', '首次使用需要实名认证', '选择参保证明或缴费记录', '在线查看或下载'], entry: '扫码查询', officialUrl: 'https://si.12333.gov.cn/' },
    { key: 'proof', title: '参保证明打印', desc: '参保证明、缴纳记录，用于贷款、落户等场合。', steps: ['来源平台可下载电子参保证明', '需要纸质盖章件时，带身份证去社保经办窗口', '窗口和出证方式以当地社保机构公布为准', '本机只打印你自己带来的材料'], entry: '上传自备材料打印', offline: '电子证明可在来源平台下载。纸质盖章件由社保经办窗口开具。' },
    { key: 'medical', title: '医保异地就医备案', desc: '跨省就医建议提前备案。报销规则以医保部门规定为准。', steps: ['打开国家医保服务平台', '登录后选择异地就医备案', '填写就医地和参保信息', '审核方式和时长以平台提示为准'], entry: '扫码打开国家医保服务平台', officialUrl: 'https://fuwu.nhsa.gov.cn/' },
    { key: 'card', title: '社保卡办理 / 补换', desc: '首次申领、挂失补办、换发新卡。', steps: ['带身份证去合作银行或社保网点', '填写社保卡申请表', '现场采集照片和信息', '制卡、领卡时间以网点告知为准'], entry: '上传自备材料打印', offline: '社保卡由银行或社保网点受理。本机不代办。' }
  ];
  const REGISTER = [
    { key: 'unemployment', title: '失业登记', purpose: '领取失业保险金、享受就业援助前，通常要先登记。', location: '户籍地或常住地的就业服务大厅', materials: ['身份证原件及复印件', '户口本或居住证', '解除或终止劳动合同证明', '本人银行卡', '证件照（规格按当地要求）'] },
    { key: 'employment', title: '就业创业登记', purpose: '办理就业扶持、把就业情况记入档案前使用。', location: '就业服务大厅综合受理窗口', materials: ['身份证原件及复印件', '劳动合同或营业执照', '证件照（如需变更信息，规格按当地要求）', '学历证明（按窗口要求）'] },
    { key: 'archive', title: '人事档案转移', purpose: '把档案转到新单位或人才服务中心。', location: '人才服务中心档案窗口（是否预约以当地为准）', materials: ['身份证原件', '接收单位的档案接收函（盖章）', '原存档机构出具的档案清单', '调动或离职相关证明（按窗口要求）'] }
  ];
  const NOTICE = {
    id: 'ex-notice',
    title: '秋季现场招聘会入场说明',
    paras: ['2026 年 9 月 20 日（周日）9:00–15:00，市人才市场一楼大厅举办秋季现场招聘会。', '入场请携带本人身份证，并准备纸质简历 5 份。8:30 开始检录，15:00 停止入场。', '岗位目录和展位图以当天发放的纸质手册为准。本机不代投递，也不预留席位。'],
    bring: ['本人身份证原件', '纸质简历 5 份', '学历证明复印件（如招聘单位要求）', '笔和笔记本', '提前 10 分钟到达检录口'],
    sourceName: '合作机构发布',
    sync: '2026-09-18',
    url: 'https://rsj.example.gov.cn/notice/fair'
  };

  const QUESTIONS = [
    { key: 'employment_status', label: '现在状态', sensitive: false, options: [['seeking_after_leaving', '离职找工作中'], ['employed_switching', '在职想换工作'], ['fresh_graduate', '应届毕业生'], ['starting_business', '想创业 / 已创业'], ['unsure', '不确定']] },
    { key: 'household_social', label: '户籍社保', sensitive: true, options: [['local_household', '本市户籍'], ['nonlocal_with_local_insurance', '外地 · 本市缴社保'], ['nonlocal_without_insurance', '外地 · 未缴社保'], ['unsure', '不确定']] },
    { key: 'unemployed_duration', label: '离职多久', sensitive: false, options: [['within_1_month', '1 个月内'], ['months_1_to_6', '1–6 个月'], ['over_6_months', '6 个月以上'], ['never_employed', '没工作过'], ['unsure', '不确定']] },
    { key: 'age_range', label: '年龄段', sensitive: true, options: [['age_16_24', '16–24 岁'], ['age_25_35', '25–35 岁'], ['age_36_45', '36–45 岁'], ['age_46_plus', '46 岁以上'], ['unsure', '不确定']] },
    { key: 'graduation_year', label: '毕业年份', sensitive: false, options: [['current_year', '本年度应届'], ['within_2_years', '毕业 2 年内'], ['over_2_years', '毕业超过 2 年'], ['not_applicable', '不适用'], ['unsure', '不确定']] },
    { key: 'unemployment_registration', label: '失业登记', sensitive: true, options: [['registered', '已办'], ['not_registered', '没办'], ['unsure', '不确定']] },
    { key: 'social_insurance_months', label: '连续缴费', sensitive: true, options: [['none', '未缴'], ['under_3_months', '不满 3 个月'], ['at_least_3_months', '满 3 个月以上'], ['unsure', '不确定']] },
    { key: 'separation_reason', label: '离职原因', sensitive: true, options: [['layoff_or_contract_end', '裁员 / 合同到期'], ['voluntary_resignation', '本人主动辞职'], ['other', '其他'], ['unsure', '不确定']] },
    { key: 'prior_subsidy', label: '领过同类补贴', sensitive: false, options: [['never_received', '没领过'], ['received', '领过'], ['unsure', '不确定']] }
  ];
  const PRIVACY = '你填写的答案只用于本次条件比对，不保存、不上传给任何政府或第三方系统，结果只在这次办理里展示；任何一项都可以不填，不填的条件会标为「无法判定」。';
  const DISCLAIM = '本结果是把你填写的信息与已录入的政策条件做机械比对，不是资格认定。本机不做资格认定、不代办、不收费；能不能办以经办窗口审核为准。';
  const COPY_NONE = '政策库里还没有可核对的政策条目。这是内容还没录入完，不是你的核对结果，也不代表你不符合任何政策。可以先看就业政策里的办事指引，或向经办窗口咨询。';
  const COPY_NORULES = '已发布的政策还没有录入可逐条比对的申领条件，因此这次不做比对。这是录入进度，不是你的核对结果。具体条件请看政策原文，或向经办窗口核对。';
  const COPY_CONFLICT = '按你填写的信息，本次比对的政策每条都至少有 1 项已录入条件不一致。可以逐条看差在哪一项。本结果不是资格认定，能不能办以经办窗口审核为准。';

  const TYPES = [['labor', '劳动合同', '正式用工合同'], ['intern', '实习协议', '在校生实习用'], ['noncompete', '竞业限制协议', '含竞业或保密条款'], ['offer', '录用通知书', 'Offer Letter']];
  const STAGES = [['extracting', 'OCR 文字提取', '识别合同页面中的文字'], ['awaiting_confirmation', '提取完成确认', '请确认页数和内容是否盖全'], ['rule_checking', '规则集检测', '对照劳动用工常见条款逐条看'], ['ai_analyzing', 'AI 深度分析', '结合上下文标出要核对的条款'], ['safety_reviewing', '安全门审核', '做最后一遍合规核验']];
  const FINDINGS = [
    { id: 'f1', priority: 'priority_check', cat: '试用期', title: '试用期长于合同期限的常见上限', page: '第 2 页', excerpt: '「试用期为六个月，合同期为一年」', ask: '试用期是否超过这份合同期限允许的长度？' },
    { id: 'f2', priority: 'attention', cat: '岗位与工作地点', title: '工作地点约定过宽', page: '第 3 页', excerpt: '「工作地点可根据经营需要调整」', ask: '调整的范围和提前通知有没有写明？' },
    { id: 'f3', priority: 'insufficient_info', cat: '薪酬待遇', title: '工资构成一栏识别不清', page: '第 5 页', excerpt: '该栏对比度不足，没有形成可核对的原文', ask: '请对照纸质原件看清工资构成。' }
  ];
  const FILE_NAME = '劳动合同-星海科技-2026.pdf';

  const BOX = [
    { key: 'guide', mode: 'internal', title: '就业办事指南', desc: '查看本机上架的办事说明', go: 'help', badge: '站内', cta: '进入服务' },
    { key: 'qr', mode: 'qr', title: '材料领取码', desc: '用手机扫码查看领取方式', badge: '扫码', host: 'pickup.example.com', cta: '扫码获取' },
    { key: 'ext', mode: 'external', title: '外部办事入口', desc: '离开本机前会先请你确认', badge: '外部应用', host: 'service.example.com', cta: '打开' },
    { key: 'soon', mode: 'soon', title: '更多扩展', desc: '还没上架，暂时不能进入', badge: '即将上线', cta: '' }
  ];

  const CAMPUS = {
    'campus-card': { title: '校园卡办理', sub: '新生办卡、补卡、挂失', summary: '新生办卡、补卡、挂失，目前到校园卡服务中心办理。', itemsTitle: '办理事项', items: ['新生首次办卡', '卡片遗失补办', '挂失与解挂', '信息变更换卡'], materials: ['录取通知书或学生证', '本人身份证原件', '近期一寸免冠照片', '学号（补卡、换卡时）'], location: '校园卡服务中心 / 一卡通中心。具体位置以学校迎新指引为准。', note: '校园卡线上办理还没开放。请带上材料，到校园卡服务中心办理。' + HELP },
    'all-in-one': { title: '一卡通开通', sub: '食堂、门禁、图书馆', summary: '开通食堂、门禁、图书馆等校园通行权限。', itemsTitle: '开通权限', items: ['食堂与校内消费', '宿舍和教学楼门禁', '图书馆借阅', '自助圈存与充值'], materials: ['已办理的校园卡', '本人学号', '初始密码（随录取材料发放）'], location: '一卡通服务中心或校内自助圈存机。具体位置以学校迎新指引为准。', note: '一卡通开通还不能在这台机器上办理。请到一卡通服务中心或自助圈存机激活。' + HELP },
    'campus-network': { title: '校园网开通', sub: '校园无线网、宿舍网络', summary: '激活校园无线网、宿舍网络和上网账号。', itemsTitle: '开通内容', items: ['校园无线网上网账号', '宿舍有线网络', '上网认证账号激活', '流量和套餐选择'], materials: ['本人学号', '初始密码（随录取材料发放）', '宿舍楼栋与房间号'], location: '网络服务中心，或校园网自助服务平台。具体位置以学校迎新指引为准。', note: '校园网开通还不能在这台机器上办理。请用校园网自助平台，或到网络服务中心激活。' + HELP },
    luggage: { title: '行李帮运', sub: '服务点、路线、现场协助', summary: '行李帮运的通用说明。是否提供、服务点在哪，以学校现场指引为准。', itemsTitle: '服务内容', items: ['新生行李短驳', '宿舍楼栋路线', '服务点排队说明', '异常件怎么处理'], materials: ['录取通知书或学生证', '本人联系电话', '行李件数', '目标宿舍楼栋'], location: '迎新行李服务点。具体位置以学校现场指引为准。', note: '本机不代收费用，也不登记个人证件。有没有这项服务、服务点和是否收费，都以学校现场指引为准。' },
    panorama: { title: 'VR校园', sub: '全景导览、场馆介绍', summary: '校园全景导览。全景内容需要学校提供后才能看。', itemsTitle: '导览内容', items: ['校园主干路线', '教学楼与实验楼', '图书馆、食堂、体育馆', '宿舍区与服务中心'], materials: ['不需要材料'], location: '就在这台机器的智慧校园里查看。', note: '这里只做导览。实地参观请以学校官方导览为准。' }
  };
  const MOD_KEYS = { welcome: 1, luggage: 1, panorama: 1 };
  const FLOW = [['线上预报到', '到学校迎新官网或公众号确认个人信息'], ['学院报到', '到所在学院迎新点核验、领取材料'], ['宿舍入住', '领钥匙和校园卡，办水电网'], ['校园卡激活', '食堂、门禁、图书馆通用']];

  function api() { return S().fyApi === 'down' ? 'down' : (S().fyApi === 'checking' ? 'checking' : 'ready'); }
  function offlineRoute(route) { return route === 'social' || route === 'register' || route === 'home'; }
  function blockReason(route) {
    const a = api();
    if (a === 'ready' || offlineRoute(route)) return '';
    return a === 'down' ? '在线服务当前不可用' : '正在确认在线服务';
  }
  function matchAud(item, sel) {
    const s = sel || 'all';
    if (s === 'all') return true;
    return item.audiences.indexOf(s) >= 0 || item.audiences.indexOf('general') >= 0;
  }
  function findItem(id) { return LIB.concat(BUILTIN).find((x) => x.id === id) || null; }
  function currentItem() {
    const hit = findItem(S().fyId);
    if (hit) return hit;
    return S().fyKind === 'builtin' ? BUILTIN[0] : LIB[0];
  }
  function isBuiltin(item) { return item.id.indexOf('builtin-') === 0; }
  function answers() { return S().fyAns || {}; }
  function answeredCount() {
    const a = answers();
    return QUESTIONS.filter((q) => a[q.key] && a[q.key] !== 'unsure').length;
  }
  function modsOn() { return S().fyMods !== false; }
  function featureOff() { return !!S().fyOff; }
  function goList(tab) {
    S().fyTab = tab || 'policy';
    S().fyOpen = '';
    S().fyFocus = '';
    S().fyPage = 0;
    window.go('policy-list');
  }
  function refresh() { if (window.__proto) window.__proto.refresh(); }
  function closeLayers() {
    S().fyAudOpen = false;
    S().fyQr = '';
    S().fyModal = '';
    S().fyBoxQr = '';
    if (S().fyBoxExt === 'ask') S().fyBoxExt = '';
    if (S().fySave === 'ask') S().fySave = '';
  }

  function tabs(cur) {
    return `<div class="fy-tabs">${TABS.map(([id, name]) => id === cur
      ? `<div class="fy-tab on">${esc(name)}</div>`
      : `<button class="fy-tab" data-fy="tab" data-arg="${id}">${esc(name)}</button>`).join('')}</div>`;
  }
  function identBtn() {
    return `<button class="fy-ident" data-fy="aud-open"><span>身份：${esc(audName(S().fyAud))}</span><span>更换</span></button>`;
  }
  function audSheet() {
    if (!S().fyAudOpen) return '';
    const cur = S().fyAud || 'all';
    return sheet('选身份', `<div class="fy-opts">${AUDS.map(([k, n]) => `<button class="fy-opt ${k === cur ? 'on' : ''}" data-fy="aud" data-arg="${k}">${esc(n)}</button>`).join('')}</div>`);
  }
  function qrLayer(title, url) {
    if (!S().fyQr) return '';
    return dialog('扫码打开来源链接', `<p>${qr(7, 220)}</p><p class="fy-meta">${cap()} 这个码只作示意，扫不出来。</p><p class="fy-h" style="font-size:22px">${esc(url || '发布方还没有提供链接')}</p><p style="font-size:22px;line-height:1.45;margin:0">来源入口由发布方提供。扫码前请核对机构和域名。</p><p style="font-size:22px;margin:0">${esc(title || '')}</p>`, `<button class="btn sec" data-fy="close">关闭</button>`);
  }
  function goalBtn(route, title, desc, fy) {
    const why = blockReason(route);
    if (why) return `<div class="fy-row fy-off" role="group" aria-disabled="true"><b>${esc(title)}</b><span>${esc(why)}</span></div>`;
    return `<button class="fy-row" data-fy="${fy}" data-arg="${route}"><b>${esc(title)}</b><span>${esc(desc)}</span><span class="go">进入</span></button>`;
  }

  function renderPolicy() {
    const a = api();
    const pill = a === 'down' ? '在线服务不可用' : (a === 'checking' ? '正在确认在线服务' : '能力与设备状态以办理时确认为准');
    const notice = a === 'down'
      ? '在线服务暂不可用。需要联网的入口先停用；社保指南、就业登记和回首页仍可进入。'
      : (a === 'checking' ? '正在确认在线服务。确认完成前，需要联网的入口先不开放。' : '先选要办的事。进入之后再确认来源和条件，这一页不预报名额或结果。');
    const goals = [['policy', '找就业政策', '就业、创业和灵活就业'], ['eligibility', '核对申领条件', '一次一问，共 9 项，不作资格认定'], ['social', '查社保材料', '参保、证明、备案和社保卡'], ['register', '看登记档案', '失业登记、就业登记和档案转移']];
    const quick = [['activity', '浏览记录', '最近看过的政策', 'my-activity'], ['ai-records', 'AI 服务记录', '本人的 AI 办理记录', 'my-ai'], ['fav', '政策收藏', '你收藏过的政策', 'my-fav'], ['home', '全部服务', '返回服务目录', 'home']];
    const goalHtml = goals.map(([route, title, desc]) => goalBtn(route, title, desc, route === 'eligibility' ? 'gocheck' : 'golist')).join('');
    const main = goalBtn('policy', '查政策与公告', '就业政策和公告都在下一页，按分区查看', 'golist');
    const quickHtml = quick.map(([route, title, desc, go]) => {
      const why = blockReason(route);
      if (why) return `<div class="fy-row fy-off" role="group" aria-disabled="true"><b>${esc(title)}</b><span>${esc(why)}</span></div>`;
      return `<button class="fy-row" data-go="${go}"><b>${esc(title)}</b><span>${esc(desc)}</span><span class="go">进入</span></button>`;
    }).join('');
    const retry = a === 'down' ? `<button class="fy-row" data-fy="recheck-api"><b>重新检测</b><span>再确认一次在线服务，不会直接变成可用</span></button>` : '';
    return F({
      cls: a === 'down' ? 'fy-hub fy-hub-tight' : 'fy-hub',
      band: { eyebrow: '政策服务', title: '看来源、查条件、备材料', sub: '就业政策、社保和档案登记，以来源内容为准。', seal: null, status: stPill(pill, a !== 'ready') },
      body: `<div class="fy-stack">${remind(notice, a === 'ready' ? 'book' : 'alert')}${retry}${main}<div class="fy-grid2">${goalHtml}</div><div class="sec-t">常用入口</div><div class="fy-grid2">${quickHtml}</div>${fine('政策内容以来源发布为准。这里不判断你能不能领。')}</div>`,
      dockHtml: bar({ backGo: 'home', backLabel: '返回首页', ask: '问小青：这一步怎么看来源？' }),
      nav: 'home'
    });
  }

  function listFrame(tab) {
    const read = S().fyRead || '';
    const aud = S().fyAud || 'all';
    const visible = LIB.filter((x) => matchAud(x, aud));
    if (S().fyFocus && (tab === 'policy' || tab === 'notice')) {
      const map = { checking: ['正在打开', '正在打开你点的那一条。'], missing: ['这条打不开', '这条现在打不开。可以看其他政策，或回到收藏。'], failed: ['这次没打开', '这次没有打开。可以再试一次，或先看其他政策。'] };
      const hit = map[S().fyFocus] || map.failed;
      return { title: TABS.find((t) => t[0] === tab)[1], sub: hit[1], pill: hit[0], warn: true };
    }
    if (tab === 'eligibility') return { title: '条件核对', sub: '一次只问一项，共 9 项。不判断你能不能领。', pill: '按原文比对', warn: false };
    if (tab === 'social') return { title: '社保指南', sub: '查询、证明、异地就医备案和社保卡。办理以对应平台为准。', pill: '办事指引', warn: false };
    if (tab === 'register') return { title: '就业登记', sub: '地点和材料以当地最新说明为准。不代办。', pill: '材料指引', warn: false };
    if (tab === 'notice') {
      if (read === 'loading') return { title: '政策公告', sub: '公告和政策一起读取。', pill: '正在读取', warn: false };
      if (read === 'error') return { title: '政策公告', sub: '这次没有读到公告。', pill: '读取失败', warn: true };
      if (S().fyNotice === 'empty') return { title: '政策公告', sub: '当前没有公告。', pill: '暂无公告', warn: true };
      return { title: '政策公告', sub: '合作机构发布，正文和来源链接照原文展示。', pill: '公告', warn: false };
    }
    if (read === 'loading') return { title: '就业政策', sub: '政策和公告一起读取。', pill: '正在读取', warn: false };
    if (read === 'error') return { title: '就业政策', sub: '这次没有读到。请再试一次。', pill: '读取失败', warn: true };
    if (read === 'empty') return { title: '就业政策', sub: '当前没有已发布的政策。下面是办事参考。', pill: '暂无已发布政策', warn: true };
    if (aud !== 'all' && visible.length === 0) return { title: '就业政策', sub: `「${audName(aud)}」下没有已发布的政策。办事参考仍可看。`, pill: '没有匹配', warn: true };
    return { title: '就业政策', sub: '已发布的政策和本机整理的办事参考分开列。', pill: '政策与办事指引', warn: false };
  }

  function libBtn(p) {
    return `<button class="fy-row" data-fy="open-detail" data-arg="${p.id}"><b>${esc(p.title)}</b><span class="fy-meta">${cap()} ${esc(p.status)} · 发布于 ${esc(p.published)} · 看原文</span></button>`;
  }
  function guideBtn(p, h) {
    return `<button class="fy-row" data-fy="open-detail" data-arg="${p.id}" style="min-height:${h || 152}px"><b>${esc(p.title)}</b><small>${esc(p.summary)}</small><span class="fy-meta">办事参考 · 查看</span></button>`;
  }
  function libTall(p, h) {
    const cond = (p.conditions || []).slice(0, 2).join('；');
    return `<button class="fy-big" style="min-height:${h}px" data-fy="open-detail" data-arg="${p.id}"><div class="v">${checklist(130)}</div><div><div class="fy-meta">${cap()} ${esc(p.status)} · 发布于 ${esc(p.published)}</div><b>${esc(p.title)}</b><span>${esc(p.summary)}</span><span>${esc(cond)}</span><em>看原文</em></div></button>`;
  }
  function libMid(p, h) {
    const cond = (p.conditions || []).slice(0, 2).join('；');
    return `<button class="fy-row" style="min-height:${h}px" data-fy="open-detail" data-arg="${p.id}"><b>${esc(p.title)}</b><small>${esc(p.summary)}</small><small>${esc(cond)}</small><span class="fy-meta">${cap()} ${esc(p.status)} · 发布于 ${esc(p.published)} · 看原文</span></button>`;
  }

  function renderList() {
    const tab = S().fyTab || 'policy';
    const fr = listFrame(tab);
    const read = S().fyRead || '';
    const aud = S().fyAud || 'all';
    let inner = '';
    let pri = { label: '上传自备材料打印', go: 'print-src' };
    let ask = '问小青：这一条来源在哪？';
    let foot = '需要纸质件时，上传你自己带来的材料再打印。';
    let note = remind('仅信息指引，不代办。本机不代申请、不收费，也不承诺补贴到账。', 'book');
    if (tab === 'eligibility') {
      pri = { label: '开始核对', go: 'policy-check' };
      ask = '问小青别的问题，不判断能不能办';
      foot = '打印核对清单暂不可用。作答不保存，印不出来。';
      note = remind('不判断你能不能领。答案只用于这次比对，离开后不保存。', 'book');
      inner = `${bigGo({ go: 'policy-check', t: '开始核对', d: '共 9 项，一次一问。先检查有没有可比对的政策，再请你填写。', vis: checklist(160), h: 460 })}
        ${bigGo({ fy: 'golist', arg: 'policy', t: '先看就业政策', d: '想先读原文和材料清单，从这里进入。', vis: report(150), h: 400 })}`;
    } else if ((tab === 'policy' || tab === 'notice') && S().fyFocus) {
      const phase = S().fyFocus;
      const title = phase === 'checking' ? '正在打开这条政策' : (phase === 'missing' ? '这条政策现在打不开' : '这次没有打开这条政策');
      const copy = phase === 'checking' ? '先确认这条还在。确认之前，不用别的政策顶上。' : (phase === 'missing' ? '收藏还在，但这条已经不在可查看的政策里，可能已经撤回。不会用另一条顶上。' : '这次没有读到。再试一次仍打不开时，先看其他政策。');
      const retry = phase === 'failed' ? `<button class="fy-row" data-fy="focus-retry"><b>再试一次</b><span>再读一次这一条。点了只回到「正在打开」。</span></button>` : '';
      inner = `<div class="fy-card"><h3>${esc(title)}</h3><p style="margin:0;font-size:24px;line-height:1.45">${esc(copy)}</p></div>${retry}
        <button class="fy-row" data-fy="focus-clear"><b>看看其他政策</b><span>先看现在能打开的</span></button>
        <button class="fy-row" data-go="my-fav"><b>返回我的收藏</b><span>这条收藏还留着</span></button>
        ${bigGo({ fy: 'golist', arg: 'social', t: '看社保指南', d: '社保步骤是本机整理的，不受这条打不开的影响。', vis: idcard(180), h: phase === 'failed' ? 390 : 500 })}`;
      foot = '打不开时，不会改用另一条政策。';
    } else if ((tab === 'policy' || tab === 'notice') && read === 'loading') {
      inner = `${sk('正在读取政策标题', 150)}${sk('正在读取来源和日期', 150)}${sk('正在读取摘要', 150)}${sk('正在读取公告', 140)}
        <button class="fy-row" data-fy="tab" data-arg="eligibility"><b>去条件核对</b><span>不必等这次读取</span></button>
        <button class="fy-row" data-fy="tab" data-arg="social"><b>看社保指南</b><span>本机整理的步骤，现在就能看</span></button>`;
      foot = '读完之前不显示标题和条数。打印你自己的材料不受影响。';
    } else if ((tab === 'policy' || tab === 'notice') && read === 'error') {
      pri = { label: '重新读取', fy: 'reread' };
      note = remind(HELP);
      inner = `${bigGo({ fy: 'tab', arg: 'eligibility', t: '去条件核对', d: '条件核对不依赖刚才那次读取。', vis: checklist(160), h: 400 })}
        ${bigGo({ fy: 'tab', arg: 'social', t: '看社保指南', d: '社保步骤是本机整理的，现在就能看。', vis: idcard(180), h: 360 })}
        <button class="fy-row" data-go="print-src"><b>上传自备材料</b><span>只处理你带来的文件</span></button>`;
      foot = '这次没读到，不代表库里没有政策。';
    } else if (tab === 'social') {
      const pick = SOCIAL.some((g) => g.key === S().fyPick) ? S().fyPick : SOCIAL[0].key;
      const g = SOCIAL.find((x) => x.key === pick);
      const picks = SOCIAL.map((s) => `<button class="fy-row ${s.key === pick ? 'on' : ''}" style="min-height:86px" data-fy="pick" data-arg="${s.key}"><b>${esc(s.title)}</b><small>${esc(s.desc)}</small></button>`).join('');
      const action = g.officialUrl
        ? `<button class="fy-row" style="min-height:86px" data-fy="qr" data-arg="${esc(g.officialUrl)}"><b>${esc(g.entry)}</b><span class="go">打开二维码</span></button>`
        : `<button class="fy-row" style="min-height:86px" data-go="print-src"><b>${esc(g.entry)}</b><small>${esc(g.offline || '')}</small></button>`;
      inner = `${picks}<div class="fy-card"><h3>${esc(g.title)}</h3><p style="margin:0;font-size:22px;line-height:1.35;color:var(--ink-2)">${esc(g.desc)}</p><div class="fy-steps">${g.steps.map((s, i) => `<div class="fy-step fy-mini"><i>${i + 1}</i><div><b>${esc(s)}</b></div></div>`).join('')}</div>${action}</div>`;
      note = remind('本机只整理步骤和入口，不代查询，也不代开盖章证明。', 'book');
      foot = '办理以对应平台为准。';
    } else if (tab === 'register') {
      const pick = REGISTER.some((g) => g.key === S().fyPick) ? S().fyPick : REGISTER[0].key;
      const g = REGISTER.find((x) => x.key === pick);
      const picks = REGISTER.map((s) => `<button class="fy-row ${s.key === pick ? 'on' : ''}" data-fy="pick" data-arg="${s.key}"><b>${esc(s.title)}</b><small>${esc(s.purpose)}</small></button>`).join('');
      inner = `${picks}<div class="fy-card"><h3>${esc(g.title)}</h3><p style="margin:0;font-size:22px;line-height:1.35">${esc(g.purpose)}</p><p style="margin:0;font-size:22px">办理地点：${esc(g.location)}</p>${g.materials.map((t) => `<div class="fy-bring">${esc(t)}</div>`).join('')}</div>`;
      note = remind('证件照本机不能现场拍摄，请自带电子照，或到照相馆办理。', 'alert');
      foot = '不代办。线上入口未配置时，按当地公布的渠道办理。';
    } else if (tab === 'notice') {
      if (S().fyNotice === 'empty') {
        note = remind(HELP);
        inner = `${bigGo({ fy: 'golist', arg: 'policy', t: '看就业政策', d: '公告是空的，已发布的政策仍可查看。', vis: report(150), h: 460 })}
          ${bigGo({ go: 'print-src', t: '上传自备材料', d: '公告不能下载。要出纸，请上传你自己的文件。', vis: phone(120), h: 420 })}`;
        foot = '没有公告，不影响打印你带来的材料。';
      } else {
        inner = `<div class="fy-card"><div class="fy-meta">${cap()} ${esc(NOTICE.sourceName)} · 同步于 ${esc(NOTICE.sync)}</div><h3>${esc(NOTICE.title)}</h3>${NOTICE.paras.map((p) => `<p style="margin:0;font-size:24px;line-height:1.45">${esc(p)}</p>`).join('')}</div>
          <div class="fy-card"><h3>入场请带上</h3>${NOTICE.bring.map((t) => `<div class="fy-bring">${esc(t)}</div>`).join('')}</div>
          <button class="fy-row" data-fy="qr" data-arg="${esc(NOTICE.url)}"><b>打开来源二维码</b><span>扫码前核对机构和域名</span><span class="go">打开</span></button>`;
        foot = `${NOTICE.sourceName} · 同步于 ${NOTICE.sync}`;
      }
    } else {
      const emptyLib = read === 'empty';
      const rows = emptyLib ? [] : LIB.filter((x) => matchAud(x, aud));
      const guides = BUILTIN.filter((x) => matchAud(x, aud));
      const page = S().fyPage || 0;
      const pageSize = 6;
      const shown = rows.slice(page * pageSize, page * pageSize + pageSize);
      const more = !emptyLib && (page + 1) * pageSize < rows.length;
      const prev = page > 0;
      const inlineGuides = emptyLib || rows.length === 0;
      const showGuides = !!S().fyGuide && !inlineGuides;
      const libs = showGuides ? '' : (shown.length <= 2 && shown.length > 0
        ? shown.map((p) => libTall(p, 360)).join('')
        : shown.length === 3
          ? shown.map((p) => libMid(p, 226)).join('')
          : shown.length === 4
            ? shown.map((p) => libMid(p, 182)).join('')
            : shown.map(libBtn).join(''));
      const guideToggle = guides.length && !inlineGuides && !showGuides && shown.length > 2 ? `<button class="fy-row" data-fy="guide"><b>通用办事参考</b><small>本机整理 · ${guides.length} 条 · 不是已发布的政策</small><span class="go">展开</span></button>` : '';
      const guideBack = showGuides ? `<button class="fy-row" style="min-height:88px" data-fy="guide"><b>返回已发布政策</b><small>回到合作机构发布的列表</small></button>` : '';
      const guideH = emptyLib ? 160 : 152;
      const guideRows = (inlineGuides || showGuides) ? guides.map((g) => guideBtn(g, guideH)).join('') : '';
      const pager = showGuides ? '' : `${prev ? '<button class="fy-row" data-fy="less"><b>上一页</b><span>回到前面的政策</span></button>' : ''}${more ? `<button class="fy-row" data-fy="more"><b>加载更多</b><span>还有 ${rows.length - (page + 1) * pageSize} 条</span></button>` : ''}`;
      if (emptyLib || rows.length === 0) {
        note = remind(emptyLib ? '当前没有已发布的政策。下面是本机整理的办事参考，不是已发布政策。' : `「${audName(aud)}」下没有已发布的政策。下面的办事参考仍可查看。`, 'book');
      }
      inner = `${libs}${pager}${guideToggle}${guideRows}${guideBack}`;
      foot = emptyLib ? '办事参考不能当作已发布政策。' : `已发布政策来自合作机构。当前显示第 ${page + 1} 页。`;
    }
    return F({
      cls: 'fy-list fy-hits',
      band: { kind: 'compact', eyebrow: '政策服务', title: fr.title, sub: fr.sub, seal: null, status: stPill(fr.pill, fr.warn), back: true },
      body: `<div class="fy-stack">${tabs(tab)}${identBtn()}${inner}${note}${fine(foot)}</div>${audSheet()}${qrLayer('', S().fyQr)}`,
      dockHtml: bar({ backGo: 'policy', backLabel: '返回政策服务', ask, pri }),
      nav: 'home'
    });
  }

  function renderDetail() {
    const item = currentItem();
    const builtin = isBuiltin(item);
    const guard = S().fyGuard || '';
    const guardCopy = guard === 'withdrawn' ? '这条政策已经撤下，不再提供来源入口' : (guard === 'unconfirmed' ? '这次没有确认这条还在，先不打开来源入口。' : (guard === 'checking' ? '正在确认这条还在' : ''));
    const canQr = !!item.officialUrl && !guard;
    const fav = !builtin && S().fyFav && S().fyFav[item.id];
    const src = builtin ? item.sourceName : `合作机构发布 · 发布于 ${item.published || '日期未提供'} · 同步于 ${item.sync || '日期未提供'}`;
    const qrBtn = canQr
      ? `<button class="fy-row" data-fy="qr" data-arg="${esc(item.officialUrl)}"><b>打开来源二维码</b><span>扫码前核对机构和域名</span></button>`
      : `<button class="fy-row" disabled><b>来源二维码暂不可用</b><span>${esc(item.officialUrl ? guardCopy : '发布方没有提供来源地址')}</span></button>`;
    const favBtn = builtin ? '' : `<button class="fy-row" data-fy="fav" data-arg="${item.id}" style="min-height:72px"><b>${fav ? '已收藏，再点取消' : '收藏这条'}</b><small>只记在这台机器的这次办理里</small></button>`;
    const head = builtin
      ? remind('这是本机整理的办事参考，不是已发布的政策。', 'book')
      : remind('小青还不能解释这条政策。看原文、扫码和条件核对都可以继续。', 'sparkle');
    return F({
      cls: 'fy-list fy-detail',
      band: { kind: 'compact', eyebrow: builtin ? '办事指引' : '就业政策', title: item.title, sub: builtin ? '办事参考' : '合作机构发布', seal: null, status: stPill(builtin ? '办事参考' : (guard ? (guard === 'checking' ? '正在确认' : '来源暂不可用') : item.status || '来源内容'), !!guard), back: true },
      body: `<div class="fy-stack"><div class="fy-card"><div class="fy-meta">${builtin ? '办事参考' : cap()}</div>${favBtn}<h3>先看是否符合</h3>${bullets(item.conditions)}<h3>需要准备的材料</h3>${bullets(item.materials)}<h3>建议怎么办</h3>${bullets(item.steps)}<p style="margin:0;font-size:24px;line-height:1.4">${esc(item.summary)}</p>${builtin ? '<p style="margin:0;font-size:24px;line-height:1.4">金额、名额和截止日期以当地最新说明为准。这份说明只把材料和入口放在一起，不在这里代申请。</p>' : ''}</div>${head}${qrBtn}<button class="fy-row" data-go="print-src"><b>上传自备材料打印</b><span>只处理你自己带来的材料</span></button>${fine(src)}</div>${qrLayer(item.title, item.officialUrl)}`,
      dockHtml: bar({ backGo: 'policy-list', backLabel: '返回列表', ask: '问小青别的问题，不判断能不能办', pri: { label: '核对条件', go: 'policy-check' } }),
      nav: 'home'
    });
  }

  function checkExits(h) {
    return `${bigGo({ fy: 'golist', arg: 'policy', t: '去看就业政策', d: '政策条目和办事指引', vis: report(150), h: h || 420 })}
      ${bigGo({ fy: 'golist', arg: 'social', t: '看社保指南', d: '查询、证明和备案', vis: idcard(180), h: (h || 420) - 40 })}
      <button class="fy-row" data-go="print-src"><b>上传自备材料</b><span>只处理你带来的文件</span></button>`;
  }
  function renderCheck() {
    const phase = S().fyEl || 'ask';
    const qIndex = Math.max(0, Math.min(QUESTIONS.length - 1, S().fyQ || 0));
    const q = QUESTIONS[qIndex];
    const a = answers();
    const ask = '问小青别的问题，不判断能不能办';
    if (phase === 'probe') {
      return F({
        cls: 'fy-list',
        band: { kind: 'compact', eyebrow: '条件核对', title: '正在检查有没有可比对的政策', sub: '确认之前，先不填写户籍、年龄或参保信息。', seal: null, status: stPill('正在读取'), back: true },
        body: `<div class="fy-stack">${sk('正在读取政策', 182)}${sk('正在读取申领条件', 182)}${sk('正在读取第 1 项', 182)}${sk('正在读取选项', 174)}${sk('正在读取选项', 174)}${sk('正在读取比对规则', 174)}${fine('读完才会出现题目。这一步不使用小青。')}</div>`,
        dockHtml: bar({ backGo: 'policy-list', backLabel: '返回列表', ask, pri: { label: '正在检查', disabled: true } }),
        nav: 'home'
      });
    }
    if (phase === 'offline' || phase === 'nopolicies' || phase === 'norules' || phase === 'fail') {
      const map = {
        offline: ['本机现在做不了条件核对', '暂时连不上政策服务。本机不会自己编问题和结论，也没有收集你的信息。', '连不上政策服务'],
        nopolicies: ['暂时没有可核对的政策', COPY_NONE, '没有可核对条目'],
        norules: ['还没录入可比对的条件', COPY_NORULES, '未录入条件'],
        fail: ['这次核对没有成功', '这次没有拿到结果，所以不显示任何结论。失败不等于不符合。你选过的内容只留在这一页，离开后不保存。', '核对没有成功']
      };
      const hit = map[phase];
      return F({
        cls: 'fy-list',
        band: { kind: 'compact', eyebrow: '条件核对', title: hit[0], sub: '可以先办别的，或稍后再试。', seal: null, status: stPill(hit[2], true), back: true },
        body: `<div class="fy-stack"><div class="fy-card"><p style="margin:0;font-size:24px;line-height:1.45">${esc(hit[1])}</p></div>${checkExits(phase === 'offline' ? 470 : 416)}${remind(HELP)}</div>`,
        dockHtml: bar({ backGo: 'policy-list', backLabel: '返回列表', ask, pri: { label: '重新检查', fy: 'reprobe' } }),
        nav: 'home'
      });
    }
    if (phase === 'submit') {
      return F({
        cls: 'fy-list',
        band: { kind: 'compact', eyebrow: '条件核对', title: '正在比对', sub: '按政策原文逐条看。结果出来前，不显示相符或不相符。', seal: null, status: stPill('正在比对'), back: true },
        body: `<div class="fy-stack">${sk('正在读取比对结果', 188)}${sk('正在读取下一条', 188)}${sk('正在读取下一条', 188)}${sk('正在汇总相符的条件', 180)}${sk('正在汇总不一致的条件', 180)}${sk('正在汇总无法判定的条件', 180)}${fine(`已填 ${answeredCount()} / ${QUESTIONS.length} 项。` + DISCLAIM)}</div>`,
        dockHtml: bar({ backGo: 'policy-list', backLabel: '返回列表', ask, pri: { label: '正在比对', disabled: true } }),
        nav: 'home'
      });
    }
    if (phase === 'result') {
      const out = S().fyOut || 'matched';
      const samples = out === 'conflict'
        ? [{ title: '青年人才住房补贴申领说明', text: '按你填写的信息，有 1 条与已录入条件不一致；另有 0 条相符、1 条无法判定。', tone: '不符' }, { title: '灵活就业人员社保补贴告知', text: '按你填写的信息，有 1 条与已录入条件不一致；另有 0 条相符、0 条无法判定。', tone: '不符' }]
        : (out === 'unknown'
          ? [{ title: '青年人才住房补贴申领说明', text: '按你填写的信息，有 1 条与已录入条件相符，1 条无法判定，需人工核对。', tone: '无法判定' }]
          : [{ title: '青年人才住房补贴申领说明', text: '按你填写的信息，已录入的 2 条条件都相符；是否能办仍以经办窗口审核为准。', tone: '相符' }, { title: '灵活就业人员社保补贴告知', text: '按你填写的信息，已录入的 1 条条件都相符；是否能办仍以经办窗口审核为准。', tone: '相符' }]);
      const headline = out === 'conflict' ? COPY_CONFLICT : (out === 'unknown'
        ? '本次比对了 1 条已录入条件的政策：0 条全部相符、0 条存在不一致、1 条还有无法判定的条件。结果不是资格认定，能不能办以经办窗口审核为准。'
        : `本次比对了 ${samples.length} 条已录入条件的政策：${samples.length} 条已录入条件全部相符、0 条存在不一致、0 条还有无法判定的条件。结果不是资格认定，能不能办以经办窗口审核为准。`);
      const cards = samples.map((s) => `<div class="fy-card"><div class="fy-meta">${cap()} 合作机构发布</div><h3>${esc(s.title)}</h3><p style="margin:0;font-size:24px;line-height:1.45"><b>${esc(s.tone)}</b> ${esc(s.text)}</p><p style="margin:0;font-size:22px;line-height:1.4;color:var(--ink-2)">差在哪一项，以政策原文为准。这里只提示要核对的点。</p></div>`).join('');
      const heroH = samples.length > 1 ? 400 : 620;
      return F({
        cls: 'fy-list',
        band: { kind: 'compact', eyebrow: '本次比对说明', title: '核对结果只供对照', sub: '不是资格认定。能不能办，以经办窗口审核为准。', seal: null, status: stPill('仅供对照'), back: true },
        body: `<div class="fy-stack"><div class="fy-up" style="min-height:${heroH}px"><div class="v">${report(samples.length > 1 ? 120 : 180)}</div><div><div class="fy-meta">${cap()}</div><b>${samples.map((s) => s.tone).filter((v, i, a) => a.indexOf(v) === i).join(' · ')}</b><p>${esc(headline)}</p></div></div>${cards}<button class="fy-row" data-fy="restart"><b>重新填写并再比对一次</b><span>清掉本页作答，回到第一问</span></button><button class="fy-row" disabled><b>打印核对清单（暂不可用）</b><span>作答不保存，暂时印不出来。</span></button>${remind(DISCLAIM, 'book')}</div>`,
        dockHtml: bar({ backGo: 'policy-list', backLabel: '返回列表', ask, pri: { label: '重新填写', fy: 'restart' } }),
        nav: 'home'
      });
    }
    const picked = a[q.key] || '';
    const last = qIndex === QUESTIONS.length - 1;
    const enough = answeredCount() > 0;
    const nOpt = q.options.length;
    const optH = nOpt >= 5 ? 172 : 196;
    const opts = q.options.map(([v, lab]) => `<button class="fy-opt ${picked === v ? 'on' : ''}" style="min-height:${optH}px" data-fy="opt" data-arg="${q.key}:${v}" aria-pressed="${picked === v ? 'true' : 'false'}">${esc(lab)}</button>`).join('');
    const shortHelp = nOpt >= 5 ? '' : (nOpt === 4
      ? `<div class="fy-card"><p style="margin:0;font-size:24px;line-height:1.45">对不上、或不想说，选「不确定」。不填和选不确定一样，都会标成「无法判定」，不算不符合。</p></div>`
      : `<div class="fy-up" style="min-height:280px"><div class="v">${checklist(150)}</div><div><b>这项可以不填</b><p>选「不确定」等于没填，标成「无法判定」，不算不符合。九项里至少要有一项不是「不确定」。</p></div></div>`);
    const prog = `<div class="fy-prog">${QUESTIONS.map((item, i) => `<b class="${i === qIndex ? 'on' : (a[item.key] ? 'done' : '')}">${i + 1}</b>`).join('')}</div>`;
    const prev = qIndex > 0 ? `<button class="btn sec" data-fy="prev">上一项</button>` : `<button class="btn sec" data-go="policy-list">返回列表</button>`;
    const pri = last
      ? { label: enough ? '按政策原文逐条比对' : '至少选 1 项', fy: enough ? 'submit' : '', disabled: !enough }
      : { label: '下一项', fy: 'next' };
    const hint = enough ? '选「不确定」等于没填，会标成「无法判定」，不算不符合。' : '请至少选 1 项（不含「不确定」），否则每条都会是「无法判定」。';
    return F({
      cls: 'fy-list',
      band: { kind: 'compact', eyebrow: `条件核对 · 第 ${qIndex + 1} 项 / 共 ${QUESTIONS.length} 项${q.sensitive ? ' · 这项可以不填' : ''}`, title: q.label, sub: q.sensitive ? '这项可以不填。不填或选「不确定」，都会标成「无法判定」。' : '选一项就行。选「不确定」等于这一项没填。', seal: null, status: stPill('正在填写'), back: true },
      body: `<div class="fy-stack">${prog}${remind(PRIVACY, 'book')}<div class="fy-opts">${opts}</div>${shortHelp}${fine(`已填 ${answeredCount()} / ${QUESTIONS.length} 项。${hint}`)}</div>`,
      dockHtml: `<footer class="dock">${prev}<button class="askq" data-go="xq" data-ctx="${esc(ask)}"><span class="mic">${ic('mic', 30)}</span><span>${esc(ask)}</span></button><button class="btn pri" ${pri.disabled ? 'disabled' : `data-fy="${pri.fy}"`}>${esc(pri.label)}${ic('arrowR', 28)}</button></footer>`,
      nav: 'home'
    });
  }

  function unavailable(spec) {
    const rows = Math.ceil(spec.items.length / 2);
    const tileH = rows >= 3 ? 150 : 176;
    const bigH = rows >= 3 ? 272 : 348;
    return F({
      cls: rows >= 3 ? 'fy-off' : 'fy-short',
      band: { eyebrow: spec.eye, title: spec.title, sub: '这项还没在这台机器上开通。下面这些去处不受影响。', seal: null, status: stPill('本机暂未开通', true), back: false },
      body: `<div class="fy-stack"><div class="fy-offgrid">${spec.items.map((it) => offTile(it[0], it[1], tileH)).join('')}</div><div class="sec-t">这些不受影响</div>
        ${bigGo({ go: 'print', t: '打印扫描', d: '打印和扫描照常可用', vis: scanPaper(150), h: bigH })}
        ${bigGo({ go: 'policy', t: '查政策', d: '查看已发布的政策和办事说明', vis: checklist(150), h: bigH - 10 })}
        ${remind(HELP)}</div>`,
      dockHtml: bar({ backGo: 'home', backLabel: '回首页', ask: spec.ask || '问小青：这里没开通还能办什么？' }),
      nav: false
    });
  }
  const OFF = {
    contract: { eye: 'AI 签约风险提示', title: '签约风险提示还没开通', ask: '问小青：合同可以自己看吗？', items: [['劳动合同', '上传后分析'], ['实习协议', '上传后分析'], ['竞业限制协议', '上传后分析'], ['录用通知书', '上传后分析'], ['手机扫码上传', '单个不超过 10MB'], ['开始风险分析', '分析前需勾选同意']] },
    'contract-wait': { eye: 'AI 签约风险提示', title: '签约风险提示还没开通', ask: '问小青：分析到一半怎么办？', items: [['识别合同文字', ''], ['确认提取结果', ''], ['规则集检测', ''], ['风险分析', ''], ['安全门审核', ''], ['取消审查', '']] },
    'contract-result': { eye: 'AI 签约风险提示', title: '签约风险提示还没开通', ask: '问小青：结果存在哪里？', items: [['查看优先核查', ''], ['查看需关注的条款', ''], ['查看信息不足', ''], ['保存到我的文档', ''], ['结束并删除', ''], ['重新审查', '']] },
    toolbox: { eye: '百宝箱', title: '百宝箱还没开通', ask: '问小青：扩展服务是什么？', items: [['站内办事指南', ''], ['扫码领取材料', ''], ['外部办事入口', ''], ['更多扩展', '']] },
    'smart-campus': { eye: '智慧校园', title: '智慧校园还没开通', ask: '问小青：报到去哪看？', items: [['迎新指引', ''], ['行李帮运', ''], ['VR校园', ''], ['校园卡办理', ''], ['一卡通开通', ''], ['校园网开通', '']] },
    'campus-welcome': { eye: '智慧校园', title: '迎新指引还没开通', ask: '问小青：报到要准备什么？', items: [['报到流程', ''], ['办事窗口', ''], ['入学材料打印', ''], ['第一份简历', ''], ['校园卡办理', '']] }
  };
  function svcOffItems(key) {
    const info = CAMPUS[key] || CAMPUS['campus-card'];
    return [[info.title, info.sub], ['查看办理事项', ''], ['查看所需材料', ''], ['查看办理地点', '']];
  }

  function renderContract() {
    if (featureOff()) return unavailable(OFF.contract);
    const type = S().fyCt || 'labor';
    const consent = S().fyConsent || 'ok';
    const aiDown = S().ai === 'down';
    const file = !!S().fyFile;
    const agree = !!S().fyAgree;
    const uploading = !!S().fyUp;
    const can = file && agree && consent === 'ok' && !uploading && !aiDown;
    const types = `<div class="fy-grid2">${TYPES.map(([k, n, h]) => k === type
      ? `<div class="fy-row" style="background:var(--teal-wash);border-color:var(--teal)"><b>${esc(n)}</b><small>${esc(h)}</small><small>当前选择</small></div>`
      : `<button class="fy-row" data-fy="type" data-arg="${k}"><b>${esc(n)}</b><small>${esc(h)}</small></button>`).join('')}</div>`;
    let consentHtml = '';
    if (consent === 'loading') consentHtml = `<div class="fy-card"><h3>正在读取知情同意</h3>${sk('正在读取说明', 148)}<p style="margin:0;font-size:22px">读完之前不能开始分析。</p></div>`;
    else if (consent === 'fail') consentHtml = `<div class="fy-warn">无法加载知情同意信息，请稍后重试</div><button class="fy-row" data-fy="consent-retry"><b>重新读取知情同意</b><span>回到读取中，不视为已经同意</span></button>`;
    else consentHtml = `<div class="fy-card"><p style="margin:0;font-size:22px;line-height:1.45"><b>本服务仅作条款风险提示，请自行核对原文。</b>重大争议请咨询律师或官方机构。</p><p style="margin:0;font-size:22px;line-height:1.45">合同原件只短期用于识别和风险分析，发给模型前会脱敏，结束时优先删除，最长保存 2 小时。不向招聘企业或合作机构回传。PDF 不超过 50 页，识别不超过 20 页。手机单个文件不超过 10MB。</p><button class="fy-opt ${agree ? 'on' : ''}" data-fy="agree" aria-pressed="${agree ? 'true' : 'false'}">我已阅读上述说明，同意本次合同文件用于 AI 签约风险分析</button></div>`;
    const upStyle = aiDown ? ' style="min-height:410px"' : '';
    const fileHtml = file
      ? `<div class="fy-up"${upStyle}><div class="v">${resume(130)}</div><div><div class="fy-meta">${cap()}</div><b>${esc(FILE_NAME)}</b><p>1.8 MB · 已从手机传到这台机器</p><button class="btn sec" data-fy="rmfile" style="min-height:72px;margin-top:10px">移除文件</button></div></div>`
      : `<div class="fy-up"${upStyle}><div class="v">${phone(120)}</div><div><b>手机扫码上传合同</b><p>手机只负责把文件传上来。这台机器确认后才开始分析。单个不超过 10MB。文件没到之前，不能开始分析。</p><div style="margin-top:8px">${qr(4, 148)}</div></div></div>`;
    const aiHtml = aiDown ? `<div class="fy-warn">AI 现在停用，签约风险提示暂时做不了。合同原件可以到打印扫描里直接打印。</div>${bigGo({ go: 'print', t: '去打印扫描', d: '不用 AI，也可以先把合同打出来自己看。', vis: scanPaper(140), h: 220 })}` : '';
    const err = S().fyErr ? `<div class="fy-warn">${esc(S().fyErr)}</div>` : '';
    const stages = aiDown ? '' : `<div class="fy-card"><h3>开始之后会经过</h3>${bullets(STAGES.map((s) => s[1] + '：' + s[2]))}</div>`;
    const pri = uploading ? { label: '上传中', disabled: true } : (can ? { label: '开始风险分析', fy: 'start' } : { label: '开始风险分析', disabled: true });
    const consentPad = consent === 'fail'
      ? `<div class="fy-card"><h3>读到同意书之后才能开始</h3><p style="margin:0;font-size:24px;line-height:1.45">同意书说明：原件只用于这次风险分析，结束时优先删除。没读到之前，不会开始分析。</p></div>`
      : '';
    return F({
      cls: 'fy-doc',
      band: { kind: 'compact', eyebrow: 'AI 签约风险提示', title: '上传合同后再分析', sub: '仅作条款风险提示，请自行核对原文', seal: null, status: stPill(aiDown ? 'AI 现在停用' : '等待上传', aiDown), path: ['上传合同', 'AI 分析', '查看结果'], pathLabel: '三步' },
      body: `<div class="fy-stack">${fileHtml}${types}${consentHtml}${consentPad}${aiHtml}${err}${stages}${fine('报告可保存 90 天。合同原件最长保留 2 小时，两件事分开算。')}</div>`,
      dockHtml: bar({ backGo: 'resume', backLabel: '返回简历服务', ask: '问小青：上传前要看什么？', pri }),
      nav: false
    });
  }

  function renderWait() {
    if (featureOff()) return unavailable(OFF['contract-wait']);
    if (S().fyWait === 'nosession') {
      return F({
        cls: 'fy-short',
        band: { kind: 'compact', eyebrow: 'AI 签约风险提示', title: '这次没有可以继续的审查', sub: '请回到上传页重新开始，或先去打印。', seal: null, status: stPill('没有进行中的审查', true), back: false },
        body: `<div class="fy-stack">${bigGo({ go: 'contract', t: '返回上传页', d: '重新选择合同类型并上传文件。', vis: resume(140), h: 576 })}
          ${bigGo({ go: 'print', t: '去打印扫描', d: '合同原件可以先打印出来自己看。', vis: scanPaper(150), h: 536 })}
          ${remind(HELP)}${fine('还没有开始分析，也没有生成结果。')}</div>`,
        dockHtml: bar({ backGo: 'contract', backLabel: '返回上传页', ask: '问小青：没开始还能打印吗？' }),
        nav: false
      });
    }
    const stage = Math.max(0, Math.min(STAGES.length - 1, S().fyStage || 0));
    const wait = S().fyWait || '';
    if (wait === 'fail' || wait === 'timeout' || wait === 'poll') {
      const msg = wait === 'timeout' ? '审查任务已超时，请重新上传合同' : (wait === 'poll' ? '获取任务状态失败，请稍后重试' : '审查任务失败，请重新上传合同');
      const deleting = S().fyCancel === 'deleting';
      const asked = S().fyCancel === 'ask';
      const failHero = S().ai === 'down' ? 130 : 498;
      const failSteps = STAGES.map((s, i) => `<div class="fy-step" style="min-height:122px"><i>${i + 1}</i><div><b>未完成 · ${esc(s[1])}</b><small>${esc(s[2])}</small></div></div>`).join('');
      const failBody = `<div class="fy-stack"><div class="fy-warn">${esc(S().fyDelErr || msg)}</div>${deleting ? '<div class="fy-card"><h3>正在删除本次任务</h3><p style="margin:0;font-size:24px">删完再回简历服务。</p></div>' : `<div class="fy-up" style="min-height:${failHero}px"><div class="v">${scanPaper(120)}</div><div><b>${esc(FILE_NAME)}</b><p>这次没有生成审查结果。可以删除任务后重新上传，或到打印扫描里自己看合同。</p></div></div>`}<div class="fy-steps">${failSteps}</div>${S().ai === 'down' ? bigGo({ go: 'print', t: '去打印扫描', d: 'AI 现在停用。可以删掉这次任务，合同到打印扫描里直接打印。', vis: scanPaper(140), h: 220 }) : ''}${fine('删除之后才离开。这一页不会把失败显示成已有结果。')}</div>`;
      return F({
        cls: 'fy-wait',
        band: { kind: 'compact', eyebrow: 'AI 签约风险提示', title: '审查未完成', sub: S().fyDelErr || msg, seal: null, status: stPill('审查未完成', true) },
        body: failBody,
        dockHtml: bar({
          back: false,
          ask: '问小青：失败了还能打印吗？',
          pri: deleting ? { label: '正在删除', disabled: true } : { label: asked ? '再点一次确认删除并返回' : '删除任务并返回简历服务', fy: asked ? 'cancel-yes' : 'cancel' }
        }),
        nav: false
      });
    }
    const steps = STAGES.map((s, i) => `<div class="fy-step ${i === stage ? 'on' : ''}"><i>${i + 1}</i><div><b>${i < stage ? '完成 · ' : (i === stage ? '进行中 · ' : '')}${esc(s[1])}</b><small>${esc(s[2])}</small></div></div>`).join('');
    const pages = S().fyPages ? '已识别 6 / 8 页' : '页数还没出来';
    const asked = S().fyCancel === 'ask';
    const deleting = S().fyCancel === 'deleting';
    const modal = S().fyModal === 'extract' ? dialog('确认文件提取结果', `<p style="margin:0;font-size:22px">文字提取完成，请确认下面的信息后再继续分析。</p><div class="fy-warn">部分页面识别置信度偏低，建议确认原件图像清晰度。</div><div class="fy-kv"><span>识别页数</span><b>6 / 8 页</b></div><div class="fy-kv"><span>识别质量</span><b>低</b></div><p class="fy-meta">${cap()}</p><p style="margin:0;font-size:22px">确认后继续检查条款。</p>`, `<button class="btn sec" data-fy="cancel">取消审查</button><button class="btn pri" data-fy="confirm-go">确认，开始分析</button>`) : '';
    return F({
      cls: 'fy-wait',
      band: { kind: 'compact', eyebrow: 'AI 签约风险提示', title: STAGES[stage][1], sub: pages + '。完成后请你确认，再进入下一步。', seal: null, status: stPill(deleting ? '正在取消' : '分析中') },
      body: `<div class="fy-stack"><div class="fy-up"><div class="v">${scanPaper(160)}</div><div><div class="fy-meta">${cap()}</div><b>${esc(FILE_NAME)}</b><p>${esc(pages)} · ${esc(STAGES[stage][2])}</p></div></div><div class="fy-steps">${steps}</div>${S().fyDelErr ? `<div class="fy-warn">${esc(S().fyDelErr)}</div>` : ''}${fine('可以取消。取消后会删除这次任务，再回简历服务。')}</div>${modal}`,
      dockHtml: bar({
        back: false,
        ask: '问小青：这一步在等什么？',
        pri: deleting ? { label: '正在取消', disabled: true } : { label: asked ? '再点一次确认取消' : '取消审查', fy: asked ? 'cancel-yes' : 'cancel' }
      }),
      nav: false
    });
  }

  function findingsOf() {
    if (S().fyCr === 'zero' || S().fyCr === 'missing') return [];
    return FINDINGS;
  }
  function renderResult() {
    if (featureOff()) return unavailable(OFF['contract-result']);
    if (S().fyCr === 'missing') {
      return F({
        cls: 'fy-short',
        band: { kind: 'compact', eyebrow: 'AI 签约风险提示', title: '未找到审查结果', sub: S().fyDelErr || '请重新上传合同进行审查', seal: null, status: stPill('没有结果', true) },
        body: `<div class="fy-stack">${bigGo({ go: 'contract', t: '重新上传', d: '回到上传页，重新选择文件。', vis: resume(140), h: 576 })}
          ${bigGo({ go: 'print', t: '去打印扫描', d: '没有结果时，仍可以把合同打印出来自己看。', vis: scanPaper(150), h: 536 })}
          ${remind(HELP)}${fine('直接打开这一页、或中途离开后，可能已经没有结果。')}</div>`,
        dockHtml: bar({ backGo: 'contract', backLabel: '重新上传', ask: '问小青：没有结果怎么办？' }),
        nav: false
      });
    }
    const list = findingsOf();
    const priN = list.filter((f) => f.priority === 'priority_check').length;
    const attN = list.filter((f) => f.priority === 'attention').length;
    const infoN = list.filter((f) => f.priority === 'insufficient_info').length;
    const zero = list.length === 0;
    const typeName = (TYPES.find((t) => t[0] === (S().fyCt || 'labor')) || TYPES[0])[1];
    const rows = zero
      ? `<div class="fy-up" style="min-height:720px"><div class="v">${report(200)}</div><div><h3 class="fy-h">未发现明显风险项</h3><p>AI 未在本合同中发现明显风险条款，但仍建议您仔细阅读全文，重要条款请咨询专业律师。</p><p>优先核查 0 项，关注 0 项，信息不足 0 项。这不表示合同没有约定，只表示这次没有标出需要单独核对的条款。</p><div class="fy-kv"><span>优先核查</span><b>0 项</b></div><div class="fy-kv"><span>关注</span><b>0 项</b></div><div class="fy-kv"><span>信息不足</span><b>0 项</b></div></div></div>`
      : list.map((f) => {
        const open = S().fyFind === f.id;
        const lab = f.priority === 'priority_check' ? '优先核查' : (f.priority === 'attention' ? '关注' : '信息不足');
        return `<button class="fy-row" data-fy="find" data-arg="${f.id}"><b>${esc(f.title)}</b><span class="fy-meta">${esc(lab)} · ${esc(f.page)} ${cap()}</span><small>${esc(f.excerpt)}</small><small>${esc(f.ask)}</small><small>AI 生成，仅供参考</small>${open ? `<small>${esc(f.cat)}</small><span class="go">收起</span>` : '<span class="go">展开</span>'}</button>`;
      }).join('');
    const groups = zero ? '' : `<p class="fy-meta" style="font-size:22px;color:var(--ink)">优先核查 ${priN} 项 · 关注 ${attN} 项 · 信息不足 ${infoN} 项</p>`;
    const logged = !!S().logged;
    const saved = !!S().fySaved;
    const saveTerms = logged ? '<div class="fy-card"><p style="margin:0;font-size:24px;line-height:1.4">保存后仅本人可在「我的文档」查看，期限 90 天，可随时删除。报告不可打印，也不会进入收费。</p></div>' : '';
    const saveBtn = !logged
      ? `<button class="fy-row" disabled><b>保存到我的文档</b><span>保存到「我的文档」需要先登录本人会员账号</span></button><button class="fy-row" data-go="login"><b>去登录</b><span>登录后才能保存 90 天</span></button>`
      : (saved
        ? `<button class="fy-row" disabled><b>已保存到我的文档</b><span>保存期限 90 天，可随时删除</span></button>`
        : `<button class="fy-row" data-fy="save-open"><b>保存到我的文档</b><span>先看保存说明，确认后才提交</span></button>`);
    const delAsked = S().fyDel === 'ask';
    const deling = S().fyDel === 'deleting';
    const reAsked = S().fyRe === 'ask';
    const reing = S().fyRe === 'deleting';
    const saveModal = S().fySave === 'ask' || S().fySave === 'saving' ? dialog('保存到我的文档', `<p style="margin:0;font-size:22px;line-height:1.45">保存后仅本人可在「我的文档」查看，保存期限 90 天，可随时删除。报告不会进入打印，也不会发给企业或合作机构。合同原件仍按短期策略删除。</p><div class="fy-kv"><span>保存位置</span><b>我的文档（仅本人）</b></div><div class="fy-kv"><span>保存期限</span><b>90 天，可随时删除</b></div><div class="fy-kv"><span>打印</span><b>不可打印</b></div>${S().fySave === 'saving' ? '<p style="margin:0;font-size:22px">正在保存。失败不会进入打印或收费。</p>' : ''}`, S().fySave === 'saving' ? `<button class="btn sec" disabled>正在保存</button>` : `<button class="btn sec" data-fy="save-no">暂不保存</button><button class="btn pri" data-fy="save-yes">确认保存 90 天</button>`) : '';
    const alert = S().fyExpire
      ? `<div class="fy-warn">这次办理已到期。刷新、关闭页面或切换用户会结束本次查看，当前合同和结果无法从此终端恢复。</div>`
      : '';
    const err = S().fySaveErr || S().fyDelErr;
    const trunc = S().fyCr === 'partial' ? '合同页数超出分析上限，本次分析为部分覆盖，请对照纸质原件核查后续条款。' : '刷新、关闭页面或切换用户会结束本次查看，当前合同和结果无法从此终端恢复。';
    return F({
      cls: 'fy-result',
      band: { kind: 'compact', eyebrow: '审查结果', title: '请核对标出的条款', sub: `${typeName} · ${FILE_NAME} · 8 页`, seal: null, status: stPill(zero ? '未发现明显风险项' : '请核对条款') },
      body: `<div class="fy-stack">${alert}${err ? `<div class="fy-warn">${esc(err)}</div>` : ''}${remind('<b>本结果由 AI 生成，仅供参考，只提示需要核对的条款。</b> 重大争议请咨询律师或官方机构。点「结束并删除」会请求清理合同原件。', 'sparkle')}${groups}<div class="fy-meta">${cap()}</div>${rows}${saveTerms}${saveBtn}${deling ? '<button class="fy-row" disabled><b>正在删除</b><span>删完后回简历服务</span></button>' : `<button class="fy-row" data-fy="${delAsked ? 'del-yes' : 'del'}"><b>${delAsked ? '再点一次确认删除' : '结束并删除'}</b><span>${delAsked ? '确认后才请求删除' : '合同和结果一起删，回到简历服务'}</span></button>`}${delAsked ? '<button class="btn sec" data-fy="del-no" style="min-height:72px">取消</button>' : ''}${fine(trunc)}</div>${saveModal}`,
      dockHtml: bar({
        back: false,
        ask: '问小青：哪一条要先核对？',
        pri: reing ? { label: '正在删除', disabled: true } : { label: reAsked ? '再点一次确认重新审查' : '重新审查', fy: reAsked ? 'recheck-yes' : 'recheck' }
      }),
      nav: false
    });
  }

  function renderToolbox() {
    if (featureOff()) return unavailable(OFF.toolbox);
    if (S().fyGate === 'checking') {
      return F({
        band: { kind: 'compact', eyebrow: '百宝箱', title: '正在读取上架的服务', sub: '读完之前不显示服务名称，也不能进入。', seal: null, status: stPill('正在读取'), back: false },
        body: `<div class="fy-stack">${sk('正在读取服务名称', 164)}${sk('正在读取打开方式', 164)}${sk('正在读取说明', 164)}${sk('正在读取上架状态', 156)}${sk('正在读取入口', 156)}${sk('正在读取说明文字', 156)}${sk('正在读取打开方式', 156)}${sk('正在读取上架范围', 148)}${fine('读完才会出现可以进入的服务。')}</div>`,
        dock: false,
        nav: false
      });
    }
    if (S().fyBox === 'empty') {
      return F({
        cls: 'fy-short',
        band: { eyebrow: '百宝箱', title: '还没有上架的服务', sub: '上架之后会出现在这里。', seal: null, status: stPill('待配置'), back: false },
        body: `<div class="fy-stack"><div class="fy-card"><h3>待配置</h3><p style="margin:0;font-size:24px;line-height:1.45">后续功能上线后将在这里展示。进入第三方服务前会有明确提示，本机不记录你在第三方页面的办理结果。</p></div>
          ${bigGo({ go: 'print', t: '打印扫描', d: '打印和扫描照常可用', vis: scanPaper(150), h: 460 })}
          ${bigGo({ go: 'policy', t: '查政策', d: '查看已发布的政策和办事说明', vis: checklist(150), h: 420 })}
          ${remind(HELP)}</div>`,
        dockHtml: bar({ backGo: 'home', backLabel: '返回首页', ask: '问小青：这里为什么是空的？' }),
        nav: false
      });
    }
    const cards = BOX.map((it) => {
      if (it.mode === 'soon') return `<button class="fy-row" disabled><b>${esc(it.title)}</b><small>${esc(it.desc)}</small><span class="fy-meta">${cap()} 即将上线</span></button>`;
      const attrs = it.mode === 'internal' ? `data-go="${it.go}"` : `data-fy="${it.mode === 'qr' ? 'box-qr' : 'box-ext'}"`;
      return `<button class="fy-row" ${attrs}><b>${esc(it.title)}</b><small>${esc(it.desc)}</small><span class="fy-meta">${cap()} ${esc(it.badge)}</span><span class="go">${esc(it.cta)}</span></button>`;
    }).join('');
    let over = '';
    if (S().fyBoxQr) {
      const it = BOX[1];
      over = dialog(it.title, `<p style="margin:0;font-size:22px">${esc(it.desc)}。请用手机扫码继续。</p><p>${qr(9, 220)}</p><div class="fy-meta">${cap()} 请核对域名 ${esc(it.host)}</div><p style="margin:0;font-size:22px;line-height:1.45">请优先在本人手机上完成。本机不记录你在第三方页面的办理结果。</p>`, `<button class="btn sec" data-fy="close">关闭</button>`);
    } else if (S().fyBoxExt === 'ask') {
      const it = BOX[2];
      over = dialog('即将进入第三方服务', `<p style="margin:0;font-size:22px;line-height:1.45">${esc(it.title)} 由外部服务方提供。请核对域名 ${esc(it.host)}。</p><p class="fy-meta">${cap()}</p><p style="margin:0;font-size:22px;line-height:1.45">本机不收集你在第三方页面输入的信息，也不记录办理结果。如果要输入账号、验证码、身份证号或支付信息，建议改用本人手机。</p>`, `<button class="btn sec" data-go="home">返回首页</button><button class="btn pri" data-fy="leave">继续打开</button>`);
    }
    const left = S().fyBoxExt === 'left' ? `<div class="fy-ok"><b>已确认离开本机办理</b><p style="margin:6px 0 0">第三方页面不会在这里打开，这一步也不代表已经办成。</p></div>` : '';
    return F({
      cls: 'fy-list fy-box',
      band: { eyebrow: '百宝箱', title: '选一个已上架的服务', sub: '经审核后才出现在这里。', seal: null, status: stPill('按本机配置'), back: false },
      body: `<div class="fy-stack"><div class="fy-up"${S().fyBoxExt === 'left' ? ' style="min-height:300px"' : ''}><div class="v">${stack(150, 3)}</div><div><b>本机已上架的扩展服务</b><p>站内服务直接进入。扫码的用手机继续。外部入口会先请你确认再离开。</p></div></div>${cards}${left}${remind('进入第三方前会有明确提示。本机不记录你在第三方页面的办理结果。', 'book')}${fine('名称和入口随本机上架内容变化。')}</div>${over}`,
      dockHtml: bar({ backGo: 'home', backLabel: '返回首页', ask: '问小青：外链和扫码有什么不同？' }),
      nav: false
    });
  }

  function campusCards() {
    const mods = modsOn();
    const cards = [];
    if (mods) {
      cards.push(['welcome', '迎新指引', '报到流程、办事窗口、入学准备', 'campus-welcome']);
      cards.push(['luggage', '行李帮运', '服务点、路线和现场说明', 'luggage']);
      cards.push(['panorama', 'VR校园', '全景导览和场馆介绍', 'panorama']);
    }
    cards.push(['campus-card', '校园卡办理', '新生办卡、补卡、挂失', 'campus-card']);
    cards.push(['all-in-one', '一卡通开通', '食堂、门禁、图书馆', 'all-in-one']);
    cards.push(['campus-network', '校园网开通', '校园无线网和宿舍网络', 'campus-network']);
    return cards;
  }
  function renderCampus() {
    if (featureOff()) return unavailable(OFF['smart-campus']);
    if (S().fyGate === 'checking') {
      return F({
        band: { kind: 'compact', eyebrow: '智慧校园', title: '正在读取校园服务', sub: '读完之前不显示服务，也不能进入。', seal: null, status: stPill('正在读取'), back: false },
        body: `<div class="fy-stack">${sk('正在读取迎新与行李', 174)}${sk('正在读取校园卡', 174)}${sk('正在读取一卡通', 174)}${sk('正在读取校园网', 174)}${sk('正在读取导览', 170)}${sk('正在读取办事窗口', 170)}${sk('正在读取开通范围', 156)}${sk('正在读取说明', 156)}${fine('读完才显示可以进入的服务。')}</div>`,
        dock: false,
        nav: false
      });
    }
    const cards = campusCards();
    const showExt = S().fyExt !== false;
    const badge = showExt ? `可查看 ${cards.length} 项 · 另有 1 个入口` : `可查看 ${cards.length} 项`;
    const grid = cards.map(([, title, desc, dest]) => {
      if (dest === 'campus-welcome') return `<button class="fy-row" data-go="campus-welcome"><b>${esc(title)}</b><small>${esc(desc)}</small><span class="go">进入</span></button>`;
      return `<button class="fy-row" data-fy="svc" data-arg="${dest}"><b>${esc(title)}</b><small>${esc(desc)}</small><span class="go">进入</span></button>`;
    }).join('');
    const ext = showExt ? `<button class="fy-row" data-go="help"><b>校园办事说明</b><small>经审核后上架的说明</small><span class="fy-meta">${cap()}</span><span class="go">进入</span></button>` : '';
    const closed = '';
    const gridHtml = modsOn() ? grid : cards.map(([, title, desc, dest]) => {
      return `<button class="fy-big" style="min-height:316px" data-fy="svc" data-arg="${dest}"><div class="v">${dest === 'campus-card' ? idcard(160) : (dest === 'campus-network' ? phone(110) : checklist(140))}</div><div><b>${esc(title)}</b><span>${esc(desc)}</span><em>进入</em></div></button>`;
    }).join('');
    return F({
      cls: modsOn() ? 'fy-list fy-campus' : 'fy-list fy-mods',
      band: { kind: 'compact', eyebrow: '智慧校园', title: '选一项校园服务', sub: `按本机开通的范围开放 · ${badge}`, seal: null, status: stPill('按本机配置'), back: false },
      body: `<div class="fy-stack">${modsOn() ? grid : gridHtml}${closed}${ext}${remind('只做说明和指引，不在这台机器上采集个人信息。具体办理以学校通知为准。', 'book')}${fine('统计数字暂不在这里展示。实际办理请到学校窗口或学校自己的平台。')}</div>`,
      dockHtml: bar({ backGo: 'home', backLabel: '返回首页', ask: '问小青：报到流程去哪看？' }),
      nav: false
    });
  }

  function renderSvc() {
    if (featureOff()) return unavailable({ eye: '智慧校园', title: '这项校园服务还没开通', ask: '问小青：校园卡去哪办？', items: svcOffItems(S().fySvc || 'campus-card') });
    if (S().fyGate === 'checking') return renderCampus();
    const key = S().fySvc || 'campus-card';
    if (!CAMPUS[key]) {
      return F({
        cls: 'fy-short',
        band: { kind: 'compact', eyebrow: '智慧校园', title: '没有这项服务', sub: '请回到智慧校园，选一项已开通的。', seal: null, status: stPill('未找到', true), back: false },
        body: `<div class="fy-stack">${bigGo({ go: 'smart-campus', t: '返回智慧校园', d: '校园卡、行李帮运、校园网等已开通的项目，从这里再选一次。', vis: idcard(180), h: 620 })}
          ${bigGo({ go: 'home', t: '回首页', d: '打印、扫描和政策查询不受这项影响，可以先回首页接着办。', vis: stack(150, 3), h: 560 })}
          ${remind(HELP)}</div>`,
        dockHtml: bar({ backGo: 'smart-campus', backLabel: '返回智慧校园', ask: '问小青：有哪些校园服务？' }),
        nav: false
      });
    }
    if (MOD_KEYS[key] && !modsOn()) {
      return unavailable({ eye: '智慧校园', title: '这项校园服务还没开通', ask: '问小青：这项去哪办？', items: svcOffItems(key) });
    }
    const info = CAMPUS[key];
    const photo = key === 'campus-card' ? `<div class="fy-grid2"><button class="fy-row" disabled><b>证件照排版打印</b><small>即将上线。可用手机照片自助打印。</small></button><button class="fy-row" data-go="print-src"><b>入学材料打印</b><small>报到表、申请表，上传后打印</small></button></div>` : '';
    const vis = key === 'campus-network' ? phone(120) : (key === 'luggage' ? stack(150, 3) : (key === 'panorama' ? report(140) : idcard(190)));
    const upH = key === 'panorama' ? 560 : (key === 'campus-network' ? 400 : (key === 'luggage' ? 400 : (key === 'all-in-one' ? 470 : 300)));
    return F({
      cls: 'fy-list',
      band: { kind: 'compact', eyebrow: '办理指引', title: info.title, sub: info.sub, seal: null, status: stPill('到窗口办理') },
      body: `<div class="fy-stack"><div class="fy-up" style="min-height:${upH}px"><div class="v">${vis}</div><div><b>${esc(info.summary)}</b><p>${esc(info.location)}</p></div></div>
        <div class="fy-card"><h3>${esc(info.itemsTitle)}</h3>${bullets(info.items)}</div>
        <div class="fy-card"><h3>所需材料</h3>${bullets(info.materials)}</div>
        ${photo}
        <button class="fy-row" data-go="smart-campus"><b>返回智慧校园</b><span class="go">返回</span></button>
        <button class="fy-row" data-go="campus-welcome"><b>查看迎新报到指引</b><span class="go">进入</span></button>
        ${remind(info.note, 'book')}${fine('不代表某一所学校的安排。地点、材料和流程以学校通知为准。')}</div>`,
      dockHtml: bar({ backGo: 'smart-campus', backLabel: '返回智慧校园', ask: '问小青：这一项要带什么？' }),
      nav: false
    });
  }

  function renderWelcome() {
    if (featureOff()) return unavailable(OFF['campus-welcome']);
    if (S().fyGate === 'checking') return renderCampus();
    if (!modsOn()) {
      return unavailable({ eye: '智慧校园', title: '迎新指引还没开通', ask: '问小青：报到要准备什么？', items: OFF['campus-welcome'].items });
    }
    const steps = FLOW.map((s, i) => `<div class="fy-step"><i>${i + 1}</i><div><b>${esc(s[0])}</b><small>${esc(s[1])}</small></div></div>`).join('');
    return F({
      cls: 'fy-welcome',
      band: { kind: 'compact', eyebrow: '智慧校园', title: '迎新报到怎么走', sub: '通用流程，具体以学校通知为准。', seal: null, status: stPill('通用参考'), back: false },
      body: `<div class="fy-stack"><div class="fy-card"><h3>报到流程</h3><div class="fy-steps">${steps}</div></div>
        <div class="fy-grid2">
          <div class="fy-row fy-off" role="group" aria-disabled="true"><b>证件照排版打印</b><small>即将上线。可用手机照片自助打印。</small></div>
          <button class="fy-row" data-go="print-src"><b>入学材料打印</b><small>报到表、承诺书，上传后打印</small></button>
          <button class="fy-row" data-go="resume"><b>第一份简历</b><small>实习求职从诊断简历开始</small></button>
          <button class="fy-row" data-fy="svc" data-arg="campus-card"><b>校园卡办理</b><small>新生办卡、补卡、挂失</small></button>
        </div>
        <div class="fy-card"><h3>办事窗口</h3><p style="margin:0;font-size:24px;line-height:1.4">窗口名单还没公布。请看学校的迎新指南或官方公众号。</p>${bullets(['学院迎新点', '宿舍入住', '校园卡与一卡通', '缴费与体检（以学校名单为准）'])}</div>
        ${remind('本机不采集个人信息。报到登记请到学校自己的系统办理。', 'book')}${fine('缴费、宿舍分配以学校通知为准。本机可帮你打印材料和看简历。')}</div>`,
      dockHtml: bar({ backGo: 'smart-campus', backLabel: '返回智慧校园', ask: '问小青：报到要准备什么？' }),
      nav: false
    });
  }

  const R = {
    policy: renderPolicy,
    'policy-list': renderList,
    'policy-detail': renderDetail,
    'policy-check': renderCheck,
    contract: renderContract,
    'contract-wait': renderWait,
    'contract-result': renderResult,
    toolbox: renderToolbox,
    'smart-campus': renderCampus,
    'campus-svc': renderSvc,
    'campus-welcome': renderWelcome
  };

  function act(id, fy, arg) {
    if (fy === 'close') { closeLayers(); refresh(); return; }
    if (fy === 'golist') { goList(arg || 'policy'); return; }
    if (fy === 'gocheck') { window.go('policy-check'); return; }
    if (fy === 'recheck-api') { S().fyApi = 'checking'; refresh(); return; }
    if (fy === 'tab') { S().fyTab = arg; S().fyOpen = ''; S().fyFocus = ''; S().fyPage = 0; S().fyPick = ''; refresh(); return; }
    if (fy === 'pick') { S().fyPick = arg; refresh(); return; }
    if (fy === 'aud-open') { S().fyAudOpen = true; refresh(); return; }
    if (fy === 'aud') { S().fyAud = arg; S().fyAudOpen = false; S().fyPage = 0; refresh(); return; }
    if (fy === 'guide') { S().fyGuide = !S().fyGuide; refresh(); return; }
    if (fy === 'more') { S().fyPage = (S().fyPage || 0) + 1; refresh(); return; }
    if (fy === 'less') { S().fyPage = Math.max(0, (S().fyPage || 0) - 1); refresh(); return; }
    if (fy === 'toggle') { S().fyOpen = S().fyOpen === arg ? '' : arg; refresh(); return; }
    if (fy === 'open-detail') { S().fyId = arg; S().fyKind = arg.indexOf('builtin-') === 0 ? 'builtin' : 'library'; S().fyGuard = ''; window.go('policy-detail'); return; }
    if (fy === 'qr') { S().fyQr = arg || '1'; refresh(); return; }
    if (fy === 'fav') {
      const bag = Object.assign({}, S().fyFav || {});
      if (bag[arg]) delete bag[arg]; else bag[arg] = 1;
      S().fyFav = bag; refresh(); return;
    }
    if (fy === 'reread') { S().fyRead = 'loading'; refresh(); return; }
    if (fy === 'focus-clear') { S().fyFocus = ''; refresh(); return; }
    if (fy === 'focus-retry') { S().fyFocus = 'checking'; refresh(); return; }
    if (fy === 'reprobe') { S().fyEl = 'probe'; S().fyOut = ''; refresh(); return; }
    if (fy === 'opt') {
      const p = arg.split(':');
      const bag = Object.assign({}, answers());
      if (bag[p[0]] === p[1]) delete bag[p[0]]; else bag[p[0]] = p[1];
      S().fyAns = bag; refresh(); return;
    }
    if (fy === 'next') { S().fyQ = Math.min(QUESTIONS.length - 1, (S().fyQ || 0) + 1); refresh(); return; }
    if (fy === 'prev') { S().fyQ = Math.max(0, (S().fyQ || 0) - 1); refresh(); return; }
    if (fy === 'submit') { if (answeredCount() < 1) return; S().fyEl = 'submit'; refresh(); return; }
    if (fy === 'restart') { S().fyAns = {}; S().fyQ = 0; S().fyEl = 'ask'; S().fyOut = ''; refresh(); return; }
    if (fy === 'type') { S().fyCt = arg; refresh(); return; }
    if (fy === 'agree') { S().fyAgree = !S().fyAgree; refresh(); return; }
    if (fy === 'rmfile') { S().fyFile = false; S().fyUp = false; refresh(); return; }
    if (fy === 'start') { S().fyUp = true; S().fyErr = ''; refresh(); return; }
    if (fy === 'consent-retry') { S().fyConsent = 'loading'; S().fyAgree = false; refresh(); return; }
    if (fy === 'cancel') { S().fyCancel = 'ask'; refresh(); return; }
    if (fy === 'cancel-yes') { S().fyCancel = 'deleting'; S().fyDelErr = ''; refresh(); return; }
    if (fy === 'confirm-go') { S().fyModal = ''; S().fyStage = 2; refresh(); return; }
    if (fy === 'save-open') { S().fySave = 'ask'; S().fySaveErr = ''; refresh(); return; }
    if (fy === 'save-no') { S().fySave = ''; refresh(); return; }
    if (fy === 'save-yes') { S().fySave = 'saving'; refresh(); return; }
    if (fy === 'del') { S().fyDel = 'ask'; refresh(); return; }
    if (fy === 'del-no') { S().fyDel = ''; refresh(); return; }
    if (fy === 'del-yes') { S().fyDel = 'deleting'; S().fyDelErr = ''; refresh(); return; }
    if (fy === 'recheck') { S().fyRe = 'ask'; refresh(); return; }
    if (fy === 'recheck-yes') { S().fyRe = 'deleting'; S().fyDelErr = ''; refresh(); return; }
    if (fy === 'svc') { S().fySvc = arg; window.go(arg === 'campus-welcome' ? 'campus-welcome' : 'campus-svc'); return; }
    if (fy === 'box-qr') { S().fyBoxQr = true; S().fyBoxExt = ''; refresh(); return; }
    if (fy === 'box-ext') { S().fyBoxExt = 'ask'; S().fyBoxQr = false; refresh(); return; }
    if (fy === 'leave') { S().fyBoxExt = 'left'; refresh(); return; }
    if (fy === 'find') { S().fyFind = S().fyFind === arg ? '' : arg; refresh(); return; }
  }

  function applyDemo(id, ev) {
    if (id === 'policy') {
      if (ev === 'up') delete S().fyApi;
      if (ev === 'down') S().fyApi = 'down';
      if (ev === 'checking') S().fyApi = 'checking';
      refresh(); return;
    }
    if (id === 'policy-list') {
      if (ev === 'read-ok') delete S().fyRead;
      if (ev === 'read-fail') S().fyRead = 'error';
      if (ev === 'read-empty') S().fyRead = 'empty';
      if (ev === 'focus-open') { S().fyFocus = ''; window.go('policy-detail'); return; }
      if (ev === 'focus-missing') S().fyFocus = 'missing';
      if (ev === 'focus-failed') S().fyFocus = 'failed';
      if (ev === 'focus-checking') S().fyFocus = 'checking';
      refresh(); return;
    }
    if (id === 'policy-detail') {
      if (ev === 'src-ok') S().fyGuard = '';
      if (ev === 'src-withdrawn') S().fyGuard = 'withdrawn';
      if (ev === 'src-unconfirmed') S().fyGuard = 'unconfirmed';
      if (ev === 'src-checking') S().fyGuard = 'checking';
      refresh(); return;
    }
    if (id === 'policy-check') {
      if (ev === 'up') S().fyEl = 'ask';
      if (ev === 'empty') S().fyEl = 'nopolicies';
      if (ev === 'norules') S().fyEl = 'norules';
      if (ev === 'offline') S().fyEl = 'offline';
      if (ev === 'matched' || ev === 'conflict' || ev === 'unknown') { S().fyEl = 'result'; S().fyOut = ev; }
      if (ev === 'fail') S().fyEl = 'fail';
      refresh(); return;
    }
    if (id === 'contract') {
      if (ev === 'uploaded') { S().fyFile = true; S().fyErr = ''; }
      if (ev === 'consent-ok') S().fyConsent = 'ok';
      if (ev === 'consent-fail') S().fyConsent = 'fail';
      if (ev === 'format-fail') { S().fyUp = false; S().fyErr = '创建审查任务失败，请检查文件格式后重试'; }
      if (ev === 'accepted') {
        S().fyUp = false; S().fyStarted = true; S().fyStage = 0; S().fyWait = ''; S().fyModal = ''; S().fyCancel = '';
        window.go('contract-wait'); return;
      }
      refresh(); return;
    }
    if (id === 'contract-wait') {
      if (ev === 'confirm') { S().fyStarted = true; S().fyModal = 'extract'; S().fyStage = 1; S().fyPages = 1; S().fyWait = ''; }
      if (ev === 'done') { window.go('contract-result'); return; }
      if (ev === 'fail') { S().fyStarted = true; S().fyWait = 'fail'; S().fyModal = ''; }
      if (ev === 'timeout') { S().fyStarted = true; S().fyWait = 'timeout'; S().fyModal = ''; }
      if (ev === 'poll-fail') { S().fyStarted = true; S().fyWait = 'poll'; S().fyModal = ''; }
      if (ev === 'del-fail') { S().fyDelErr = '删除失败，合同仍可能处于短期保留状态，请重试。'; S().fyCancel = ''; }
      if (ev === 'cancelled' && S().fyCancel === 'deleting') { window.go('resume'); return; }
      refresh(); return;
    }
    if (id === 'contract-result') {
      if (ev === 'saved') { S().fySaved = true; S().fySave = ''; S().fySaveErr = ''; }
      if (ev === 'save-fail') { S().fySave = ''; S().fySaveErr = '保存失败。请确认已登录后重试。当前不会进入打印或收费流程。'; }
      if (ev === 'del-fail') { S().fyDel = ''; S().fyRe = ''; S().fyDelErr = '立即删除失败，合同仍可能处于短期保留状态。请重试；系统仍会按最长保留时限自动清理。'; }
      if (ev === 'deleted' && S().fyDel === 'deleting') { window.go('resume'); return; }
      if (ev === 'deleted' && S().fyRe === 'deleting') { S().fyStarted = false; S().fyFile = false; window.go('contract'); return; }
      refresh();
    }
  }

  function demo(id) {
    const D = {
      policy: [['演示：在线服务可用', 'up'], ['演示：在线服务不可用', 'down'], ['演示：仍在检查', 'checking']],
      'policy-list': [['演示：政策读回来了', 'read-ok'], ['演示：这次没读到', 'read-fail'], ['演示：政策库是空的', 'read-empty'], ['演示：这条打开了', 'focus-open'], ['演示：这条打不开', 'focus-missing'], ['演示：这次没打开', 'focus-failed'], ['演示：正在打开这条', 'focus-checking']],
      'policy-detail': [['演示：来源确认还在', 'src-ok'], ['演示：这条撤下了', 'src-withdrawn'], ['演示：这次没确认', 'src-unconfirmed'], ['演示：正在确认来源', 'src-checking']],
      'policy-check': [['演示：有可比对的政策', 'up'], ['演示：库里没有政策', 'empty'], ['演示：还没录入条件', 'norules'], ['演示：连不上', 'offline'], ['演示：比对结果相符', 'matched'], ['演示：比对结果不符', 'conflict'], ['演示：信息不够', 'unknown'], ['演示：比对失败', 'fail']],
      contract: [['演示：手机传来合同', 'uploaded'], ['演示：同意书加载好了', 'consent-ok'], ['演示：同意书加载失败', 'consent-fail'], ['演示：上传已受理', 'accepted'], ['演示：文件格式不对', 'format-fail']],
      'contract-wait': [['演示：提取好了，请确认', 'confirm'], ['演示：审查完成', 'done'], ['演示：审查失败', 'fail'], ['演示：审查超时', 'timeout'], ['演示：状态没读到', 'poll-fail'], ['演示：已取消并删除', 'cancelled'], ['演示：删除失败', 'del-fail']],
      'contract-result': [['演示：保存好了', 'saved'], ['演示：保存失败', 'save-fail'], ['演示：删除完成', 'deleted'], ['演示：删除失败', 'del-fail']]
    };
    return (D[id] || []).map(([label, ev]) => ({ label, ev }));
  }

  function mount(id, el) {
    const onClick = (e) => {
      const b = e.target.closest('[data-fy]');
      if (!b || !el.contains(b) || b.disabled) return;
      e.stopPropagation();
      e.preventDefault();
      act(id, b.dataset.fy, b.dataset.arg || '');
    };
    const onDemo = (e) => applyDemo(id, e.detail);
    el.addEventListener('click', onClick);
    el.addEventListener('proto-demo', onDemo);
    return () => { el.removeEventListener('click', onClick); el.removeEventListener('proto-demo', onDemo); };
  }

  window.FY = { render: (id) => (R[id] ? R[id]() : ''), mount, demo };

  const keepPhone = PHONE_NOTE + '。普通页闲置 3 分钟清除；条件核对结果与合同结果页 1 分 30 秒。稿不画倒计时，也不在倒计时结束时自动成功。刷新页面即清本地作答。';
  window.SCREENS.push({
    id: 'policy-check', group: '查政策', name: '条件核对',
    notes: {
      does: '运行页 /renshi?tab=eligibility。默认帧画第 1 题（现在状态，五个选项，下一项）。读取中是 fyEl=probe：浅灰条写「正在读取」，不先要户籍和年龄。提交后等演示事件才进结果。结果口径：相符、不符、无法判定。不判断能不能办，不使用 AI。',
      motion: '选项按下缩小。检查中和提交中不自动跳结果。',
      keep: '屏上不写问项版本号 policy-eligibility-questions-v1。连不上、没有政策、没录入条件、比对失败各自留在本屏，出口是就业政策、社保指南、上传自备材料和重新检查。打印核对清单停用。AI 停用也不影响本屏。深链与列表入口已在政策服务台和详情。' + keepPhone
    },
    demo: () => window.FY.demo('policy-check'),
    render: () => window.FY.render('policy-check'),
    mount: (el) => window.FY.mount('policy-check', el)
  });
  window.SCREENS.push({
    id: 'contract-wait', group: '受控与扩展', name: 'AI 签约风险提示：处理中',
    notes: {
      does: '运行页 /contract-review/processing。默认画开通后的五阶段进行中（OCR 文字提取、提取完成确认、规则集检测、AI 深度分析、安全门审核）。提取确认弹层可以取消或确认后继续，确认不跳结果。',
      motion: '当前阶段用底色区分。不画百分比，不在倒计时结束时自动成功。',
      keep: '运行页深链在机构未开通时回首页，稿的默认帧不跳。未开通变体 fyOff：五阶段和取消审查逐项「本机暂未开通」，出口是打印扫描、查政策、回首页。没有会话是 fyWait=nosession，出口为返回上传页和去打印扫描。失败、超时、状态没读到停在本屏，删除任务后等演示事件回简历服务。AI 停用时失败页给出「去打印扫描」。' + keepPhone
    },
    demo: () => window.FY.demo('contract-wait'),
    render: () => window.FY.render('contract-wait'),
    mount: (el) => window.FY.mount('contract-wait', el)
  });
  window.SCREENS.push({
    id: 'campus-welcome', group: '受控与扩展', name: '智慧校园：迎新指引',
    notes: {
      does: '运行页 /smart-campus/welcome。默认画开通后的四步报到、办事窗口、入学材料（print-src）和第一份简历（resume）。证件照即将上线，不可点。',
      motion: '步骤依次排开，按下缩小。',
      keep: '运行页深链在总开关关闭时回首页，稿的默认帧不跳。未开通变体 fyOff，以及模块关闭 fyMods=0：报到流程、办事窗口、入学材料、简历、校园卡逐项「本机暂未开通」，出口是打印扫描、查政策、回首页。不写具体楼栋，不写校方审核。屏上不写「未接入」。AI 停用时简历入口仍在，由简历服务台退化。' + keepPhone
    },
    render: () => window.FY.render('campus-welcome'),
    mount: (el) => window.FY.mount('campus-welcome', el)
  });

  function moveAfter(id, afterId) {
    const list = window.SCREENS;
    const from = list.findIndex((s) => s.id === id);
    if (from < 0) return;
    const [item] = list.splice(from, 1);
    const at = list.findIndex((s) => s.id === afterId);
    list.splice(at < 0 ? list.length : at + 1, 0, item);
  }
  moveAfter('policy-check', 'policy-detail');
  moveAfter('contract-wait', 'contract');
  moveAfter('campus-welcome', 'smart-campus');
})();
