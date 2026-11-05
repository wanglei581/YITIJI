/* fix-fairs.js：私有化部署（b）版「校园招聘」与招聘会各屏。一律 bOnly。类名前缀 fk-。 */
(function () {
  const { icon, band, dock, nav, qr } = UI;
  const S = () => window.S;
  const GROUP = '私有化版 · 校园招聘';
  const PHONE = '183-6916-1921';
  const HELP = '需要帮助？拨打服务电话 ' + PHONE;
  const CAMPUS_RE = /校园|校招|高校|大学|学院|应届|毕业生|双选|研究生|校企/;
  /* 白名单整句（去来源平台投递、扫码前往来源平台预约等）照运行页原文整句写；边界说明用运行页原句。 */
  const L = {
    goApply: '去来源平台投递',
    lineApply: '用手机扫码，在来源平台投递',
    lineBook: '用手机扫码，在来源平台预约',
    titleBook: '扫码前往来源平台预约',
    titleCheck: '扫码前往来源平台签到',
  };
  const BAN = '禁止说明：屏上不用这些独立说法——一键投递、立即投递、平台投递、收简历、候选人、在线投递、投简历、在线预约、平台预约。白名单整句仍按运行页显示。';
  const TAIL = '号码与服务时间从后台读，读不到不显示。本屏闲置 3 分钟清除。底部导航中间一项是「AI 顾问」。只在说明栏打开「显示私有化版页面」后出现。二维码直接编码来源平台链接，不经过我方域名中转。';

  const css = document.createElement('style');
  css.textContent = `
.body.fk{justify-content:flex-start;gap:8px;padding:12px 36px 8px}
.fk-card{background:var(--card);border:1.5px solid var(--edge);border-radius:26px;padding:14px 16px;text-align:left;display:flex;flex-direction:column;gap:6px;min-width:0}
.fk-card h3{margin:0;font:700 28px/1.25 var(--serif)}
.fk-sub{margin:0;font-size:22px;line-height:1.4;color:var(--ink-2)}
.fk-fine{margin:0;font-size:20px;line-height:1.45;color:var(--ink-3)}
.fk-row{min-height:76px;width:100%;display:flex;align-items:center;gap:12px;padding:8px 14px;border-radius:20px;background:var(--well);text-align:left}
.fk-row .tx{flex:1;min-width:0}
.fk-row b{display:block;font-size:24px;line-height:1.3}
.fk-row small{display:block;font-size:20px;line-height:1.35;color:var(--ink-2)}
.fk-row em{font-style:normal;font-size:20px;font-weight:700;color:var(--teal-ink);flex:none}
.fk-fair{min-height:168px;width:100%;display:flex;flex-direction:column;gap:4px;padding:14px 16px;border-radius:26px;background:var(--card);border:1.5px solid var(--edge);text-align:left}
.fk-fair b{font:700 28px/1.25 var(--serif)}
.fk-fair small{font-size:20px;line-height:1.35;color:var(--ink-2)}
.fk-top{display:flex;align-items:center;gap:8px}
.fk-top b{flex:1;min-width:0}
.fk-tag{flex:none;height:36px;padding:0 12px;border-radius:18px;background:var(--teal-wash);color:var(--teal-ink);font-size:20px;font-weight:700;display:inline-flex;align-items:center}
.fk-tag.wheat{background:var(--clay-wash);color:var(--clay-ink)}
.fk-tag.slate{background:var(--slate-wash);color:var(--slate-ink)}
.fk-tag.bad{background:var(--cin-wash);color:var(--cinnabar)}
.fk-fav{min-height:64px;min-width:96px;padding:0 16px;border-radius:18px;font-size:22px;font-weight:700;background:var(--slate-wash);color:var(--slate-ink)}
.fk-fav.on{background:var(--teal-wash);color:var(--teal-ink)}
.fk-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.fk-metric{min-height:96px;padding:10px 12px;border-radius:20px;background:var(--card);border:1.5px solid var(--edge);text-align:left}
.fk-metric b{display:block;font:700 32px/1.1 var(--serif)}
.fk-metric span{display:block;margin-top:2px;font-size:20px;color:var(--ink-2)}
.fk-metric small{display:block;margin-top:2px;font-size:20px;line-height:1.3;color:var(--ink-3)}
.fk-kv{display:grid;grid-template-columns:148px 1fr;gap:4px 10px;font-size:22px;line-height:1.35}
.fk-kv i{font-style:normal;color:var(--ink-3)}
.fk-kv b{font-weight:700;min-width:0}
.fk-tabs{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.fk-tabs button,.fk-seg button{min-height:72px;border-radius:18px;background:var(--card);border:1.5px solid var(--edge);font-size:22px;font-weight:700;padding:6px 4px}
.fk-tabs button[aria-pressed="true"],.fk-seg button[aria-pressed="true"],.fk-chips button[aria-pressed="true"]{background:var(--deep);color:var(--cream);border-color:var(--deep)}
.fk-seg{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.fk-split{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.fk-go{min-height:132px;padding:14px 14px;border-radius:24px;background:var(--card);border:1.5px solid var(--edge);text-align:left;display:flex;flex-direction:column;gap:4px}
.fk-go b{font:700 26px/1.25 var(--serif)}
.fk-go small{font-size:20px;line-height:1.35;color:var(--ink-2)}
.fk-go em{margin-top:auto;font-style:normal;font-size:20px;font-weight:700;color:var(--teal-ink)}
.fk-chips{display:flex;flex-wrap:wrap;gap:8px}
.fk-chips button{min-height:64px;min-width:64px;padding:0 14px;border-radius:18px;background:var(--card);border:1.5px solid var(--edge);font-size:22px;font-weight:700}
.fk-search{min-height:72px;width:100%;border-radius:22px;background:var(--card);border:1.5px solid var(--edge);text-align:left;padding:0 16px;font-size:22px;color:var(--ink-3)}
.fk-actions{display:flex;flex-direction:column;gap:8px}
.fk-actions .btn,.fk-duo .btn{flex:1;min-height:72px;height:auto}
.fk-duo{display:flex;gap:8px}
.fk-duo .btn{min-width:0;padding:0 12px;font-size:24px}
.fk-duo .btn[aria-disabled="true"],.fk-go[aria-disabled="true"]{opacity:.45}
.fk-state{flex:1;display:flex;flex-direction:column;gap:12px;min-height:0}
.fk-statecard{flex:1;display:flex;flex-direction:column;justify-content:center}
.fk-statein{display:flex;flex-direction:column;gap:12px}
.fk-list{flex:1;display:flex;flex-direction:column;gap:10px;min-height:0}
.fk-list>.fk-card,.fk-list>.fk-fair,.fk-list>.fk-split{flex:1}
.fk-campus{flex:1;display:flex;flex-direction:column;gap:10px;min-height:0}
.fk-campus .fk-fairs{flex:1.15;display:flex;flex-direction:column;gap:10px;min-height:0}
.fk-campus .fk-fairs>.fk-fair{flex:1}
.fk-campus .fk-split{flex:.9;min-height:0}
.fk-campus .fk-split>.fk-go{height:100%;min-height:0}
.fk-cgo{flex-direction:row;align-items:center;gap:12px;justify-content:flex-start}
.fk-cgo .ic{width:72px;height:72px;border-radius:20px;background:var(--teal-wash);color:var(--teal-ink);display:grid;place-items:center;flex:none}
.fk-cgo .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;text-align:left}
.fk-cgo em{margin-top:2px}
.fk-counthead{flex-direction:row;align-items:center;gap:16px}
.fk-counthead .fk-big{flex:none;min-width:108px;font:700 72px/1 var(--serif);color:var(--teal-ink);text-align:center}
.fk-nosign{flex-direction:row;align-items:center;gap:16px}
.fk-nosign .fk-ill{flex:none;width:148px;display:grid;place-items:center}
.fk-planbox{flex:1;display:flex;flex-direction:column;gap:8px;min-height:0}
.fk-planbox>.fk-card{flex:1;display:flex;flex-direction:column;min-height:0}
.fk-planbox>.fk-lock{flex:none}
.fk-planbox>.fk-split{flex:none}
.fk-rows{flex:1;display:flex;flex-direction:column;gap:8px;min-height:0}
.fk-rows>.fk-row{flex:1}
.fk-plan-hug{display:flex;flex-direction:column;gap:10px}
.fk-plan-hug>.fk-card{flex:none}
.fk-cos{display:flex;flex-direction:column;gap:8px}
.fk-co{min-height:198px;padding:14px 16px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge);text-align:left;display:flex;flex-direction:column;justify-content:center;gap:2px}
.fk-co b{font:700 26px/1.3 var(--serif)}
.fk-co small{font-size:20px;line-height:1.35;color:var(--ink-2)}
.fk-exits{grid-template-columns:1fr 1fr 1fr}
.fk-exits .fk-go{min-height:198px;justify-content:flex-start}
.fk-exits .ic{width:64px;height:64px;border-radius:18px;background:var(--teal-wash);color:var(--teal-ink);display:grid;place-items:center}
.fk-files{display:flex;flex-direction:column;gap:8px}
.fk-file{display:flex;align-items:center;gap:14px;min-height:198px;padding:12px 14px;border-radius:24px;background:var(--card);border:1.5px solid var(--edge);text-align:left}
.fk-fileic{width:120px;height:120px;flex:none;display:grid;place-items:center}
.fk-fileic svg{width:112px;height:112px}
.fk-file .tx{flex:1;min-width:0}
.fk-file b{display:block;font:700 26px/1.3 var(--serif)}
.fk-file small{display:block;font-size:20px;line-height:1.35;color:var(--ink-2)}
.fk-file .btn{flex:none;height:72px;min-width:120px;padding:0 16px;font-size:24px}
.fk-src .fk-kv{font-size:22px;line-height:1.55;gap:8px 12px}
.fk-col{display:flex;flex-direction:column;gap:8px;min-height:0}
.fk-split.fk-tall{flex:1;min-height:0;grid-template-rows:1fr 1fr}
.fk-split.fk-tall>.fk-go{height:100%;min-height:0}
.fk-mapcard{flex:none;display:flex;flex-direction:column}
.fk-mapcard .fk-map{flex:none;height:248px}
button.fk-card{width:100%}
.fk-bars{display:flex;flex-direction:column;gap:8px}
.fk-bar{display:grid;grid-template-columns:132px 1fr 88px;gap:8px;align-items:center;min-height:36px;font-size:20px}
.fk-bar i{display:block;height:12px;border-radius:6px;background:var(--well);position:relative}
.fk-bar i::after{content:"";position:absolute;inset:0 auto 0 0;width:var(--p);border-radius:6px;background:var(--teal)}
.fk-plan{display:grid;grid-template-columns:1.1fr .9fr;gap:8px;min-height:0}
.fk-ai{display:inline-flex;align-items:center;height:36px;padding:0 12px;border-radius:18px;background:var(--teal-wash);color:var(--teal-ink);font-size:20px;font-weight:700;width:max-content}
.fk-map{display:grid;grid-template-columns:1.15fr .85fr 1fr;gap:8px;min-height:168px}
.fk-zone{border-radius:18px;padding:12px;text-align:left;display:flex;flex-direction:column;gap:4px;min-height:148px}
.fk-zone b{font-size:22px}
.fk-zone small{font-size:20px;line-height:1.3}
.fk-zone.a{background:var(--teal-wash);color:var(--teal-ink)}
.fk-zone.b{background:var(--slate-wash);color:var(--slate-ink)}
.fk-zone.c{background:var(--clay-wash);color:var(--clay-ink)}
.fk-h{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.fk-h span{font-size:20px;color:var(--ink-3)}
.dialog.fk-dlg{width:820px;align-items:stretch;text-align:left;gap:12px;padding:28px 32px 24px}
.dialog.fk-dlg h2{font-size:40px;text-align:center}
.dialog.fk-dlg .fk-qrbox{display:flex;flex-direction:column;align-items:center;gap:6px}
.sheet.fk-sheet{gap:10px;padding:14px 36px 24px}
.sheet.fk-sheet h2{font-size:36px;margin:0}
.fk-lab{font-size:22px;font-weight:700}
`;
  document.head.appendChild(css);

  const FAIRS = [
    { id: 'cj-2026a', name: '澄江学院 2026 届秋季双选会', theme: 'campus', status: 'ongoing', start: '2026-10-18 09:00', end: '2026-10-18 16:30', date: '2026-10-18', city: '澄江', venue: '澄江学院大学生活动中心一层', address: '澄江市学府路 18 号', organizer: '澄江学院就业指导中心', sourceName: '澄江学院就业网', host: 'career.chengjiang.example', path: '/fairs/2026-autumn', externalId: 'CJ-FAIR-2026-A18', sync: '2026-10-16 09:42', checkin: true, companies: 46, jobs: 128, expect: 1800, head: 186, desc: '面向 2026 届毕业生的校园双选，展位与岗位由学院就业网同步。', traffic: '地铁 2 号线学府路站 B 口，步行约 6 分钟，从活动中心西门进。', admit: '凭学生证或身份证件，先在来源平台预约再入场。', services: '简历咨询 · 展位问询', note: '本机仅展示来源信息，信息以来源平台为准。', navHost: 'geo.chengjiang.example' },
    { id: 'ql-mfg', name: '青岚高职临港制造专场', theme: 'campus_corp', status: 'upcoming', start: '2026-11-06 13:30', end: '2026-11-06 17:00', date: '2026-11-06', city: '临港', venue: '青岚职业技术学院临港校区体育馆', address: '临港新区职教路 7 号', organizer: '青岚职业技术学院校企合作处', sourceName: '青岚高职就业信息服务', host: 'job.qinglan.example', path: '/fair/1106', externalId: 'QL-CORP-2026-1106', sync: '2026-10-20 14:18', checkin: false, companies: 22, jobs: 61, expect: 600, head: 90, desc: '校企合作的制造类专场，只面向本校在校生和应届毕业生。', traffic: '公交临港职教园区站下车，体育馆东门。', admit: '在来源平台预约后，凭学生证从东门进。', services: '专业对口咨询', note: '本机仅展示来源信息，信息以来源平台为准。', navHost: 'geo.qinglan.example' },
    { id: 'yh-grad', name: '砚湖大学研究生专场', theme: 'campus', status: 'ended', start: '2026-09-12 09:00', end: '2026-09-12 15:00', date: '2026-09-12', city: '砚湖', venue: '砚湖大学研究生院报告厅', address: '砚湖市文澜路 3 号', organizer: '砚湖大学研究生院', sourceName: '砚湖大学研究生就业栏目', host: 'yjs.yanhu.example', path: '/fair/0912', externalId: 'YH-GRAD-2026-0912', sync: '2026-09-11 18:05', checkin: true, companies: 18, jobs: 40, expect: 320, head: 48, desc: '研究生双选，场次已结束，资料仍可查看。', traffic: '公交文澜路站，报告厅在研究生院一楼。', admit: '这场已经结束。', services: '无', note: '本机仅展示来源信息，信息以来源平台为准。', navHost: 'geo.yanhu.example' },
    { id: 'cw-ind', name: '澄湾产业园秋季专场', theme: 'industry', status: 'upcoming', start: '2026-10-24 09:00', end: '2026-10-24 15:00', date: '2026-10-24', city: '澄湾', venue: '澄湾会展中心 B 馆', address: '澄湾市港城大道 200 号', organizer: '澄湾产业园服务中心', sourceName: '澄湾会展发布栏', host: 'expo.chengwan.example', path: '/fairs/1024', externalId: 'CW-IND-2026-1024', sync: '2026-10-15 11:26', checkin: true, companies: 73, jobs: 210, expect: 4000, head: 640, desc: '产业园综合专场，主题按行业组织。', traffic: '公交澄湾会展中心站，B 馆北门。', admit: '在来源平台预约后换入场凭证。', services: '引导台', note: '本机仅展示来源信息，信息以来源平台为准。', navHost: 'geo.chengwan.example' },
    { id: 'mb-gen', name: '麦埠街道综合招聘会', theme: 'general', status: 'upcoming', start: '2026-11-02 09:30', end: '2026-11-02 12:00', date: '2026-11-02', city: '麦埠', venue: '麦埠街道便民服务中心二楼', address: '麦埠街道青石巷 12 号', organizer: '麦埠街道公共就业服务', sourceName: '麦埠就业发布', host: 'job.maibu.example', path: '/fair/1102', externalId: 'MB-GEN-2026-1102', sync: '2026-10-22 08:11', checkin: false, companies: 15, jobs: 36, expect: 200, head: 40, desc: '街道综合场，主题为通用。', traffic: '步行从青石巷北口进服务中心。', admit: '来源平台没有放入场链接。', services: '政策咨询', note: '本机仅展示来源信息，信息以来源平台为准。', navHost: 'geo.maibu.example' },
  ];
  const COS = {
    'cj-2026a': [
      { id: 'nanzhi', name: '南枝仪器', booth: 'A12', industry: '智能制造', zone: '智能制造展区', host: 'hr.nanzhi.example', path: '/campus/2026', externalId: 'NZ-CJ-A12', sync: '2026-10-16 09:40', brief: '实验仪器和产线检测，展位在 A 区靠西门。', note: '展位与岗位由澄江学院就业网同步，办理在来源平台完成。', jobs: [{ id: 'nz1', title: '工艺工程师', pay: '来源标注面议' }, { id: 'nz2', title: '现场应用专员', pay: '来源标注面议' }] },
      { id: 'boyun', name: '泊云网络', booth: 'B07', industry: '互联网', zone: '数字服务展区', host: 'careers.boyun.example', path: '/join/campus', externalId: 'BY-CJ-B07', sync: '2026-10-16 09:41', brief: '做企业协作软件，这场只收 2026 届。', note: '展位与岗位由澄江学院就业网同步，办理在来源平台完成。', jobs: [{ id: 'by1', title: '后端开发', pay: '来源标注面议' }, { id: 'by2', title: '产品运营', pay: '来源标注面议' }] },
      { id: 'hefeng', name: '禾风医疗', booth: 'C03', industry: '医疗健康', zone: '健康与教育展区', host: 'join.hefeng.example', path: '/hire/2026', externalId: 'HF-CJ-C03', sync: '2026-10-15 17:22', brief: '医疗器械临床支持，不在本机留下申请。', note: '展位与岗位由澄江学院就业网同步，办理在来源平台完成。', jobs: [{ id: 'hf1', title: '临床支持专员', pay: '来源标注面议' }] },
    ],
    'ql-mfg': [
      { id: 'luhe', name: '芦禾装备', booth: 'M04', industry: '智能制造', zone: '装备展区', host: 'job.luhe.example', path: '/fair/ql', externalId: 'LH-QL-M04', sync: '2026-10-20 14:10', brief: '数控装备装配，接受高职实习。', note: '由青岚高职就业信息服务同步。', jobs: [{ id: 'lh1', title: '数控工艺员', pay: '来源标注面议' }] },
      { id: 'jinshu', name: '津枢物流', booth: 'M11', industry: '物流', zone: '装备展区', host: 'hr.jinshu.example', path: '/campus', externalId: 'JS-QL-M11', sync: '2026-10-20 14:12', brief: '港区仓储调度。', note: '由青岚高职就业信息服务同步。', jobs: [{ id: 'js1', title: '仓储调度', pay: '来源标注面议' }] },
    ],
    'yh-grad': [
      { id: 'qingce', name: '青策咨询', booth: 'G02', industry: '专业服务', zone: '报告厅前区', host: 'hire.qingce.example', path: '/grad', externalId: 'QC-YH-G02', sync: '2026-09-11 18:01', brief: '研究助理岗位，这场已结束。', note: '由砚湖大学研究生就业栏目同步。', jobs: [{ id: 'qc1', title: '研究助理', pay: '来源标注面议' }] },
    ],
    'cw-ind': [
      { id: 'gangqi', name: '港栖新材料', booth: 'B-18', industry: '新材料', zone: '材料展区', host: 'hr.gangqi.example', path: '/fair/1024', externalId: 'GQ-CW-B18', sync: '2026-10-15 11:20', brief: '澄湾产业园内的材料企业。', note: '由澄湾会展发布栏同步。', jobs: [{ id: 'gq1', title: '质量工程师', pay: '来源标注面议' }, { id: 'gq2', title: '设备维护', pay: '来源标注面议' }] },
      { id: 'yeke', name: '野柯软件', booth: 'B-06', industry: '互联网', zone: '数字展区', host: 'jobs.yeke.example', path: '/open', externalId: 'YK-CW-B06', sync: '2026-10-15 11:21', brief: '产业园软件服务。', note: '由澄湾会展发布栏同步。', jobs: [{ id: 'yk1', title: '实施顾问', pay: '来源标注面议' }] },
    ],
    'mb-gen': [
      { id: 'shili', name: '石里便利', booth: '2-03', industry: '生活服务', zone: '服务展区', host: 'join.shili.example', path: '/store', externalId: 'SL-MB-203', sync: '2026-10-22 08:08', brief: '街道门店店员。', note: '由麦埠就业发布同步。', jobs: [{ id: 'sl1', title: '门店店员', pay: '来源标注面议' }] },
    ],
  };
  const ZONES = {
    'cj-2026a': [
      { id: 'a', name: '智能制造展区', hall: 'A 区', cls: 'a', booths: 18, desc: '仪器、装备，靠西门' },
      { id: 'b', name: '数字服务展区', hall: 'B 区', cls: 'b', booths: 14, desc: '软件和运营，场馆中部' },
      { id: 'c', name: '健康与教育展区', hall: 'C 区', cls: 'c', booths: 14, desc: '医疗与教研，靠东门' },
    ],
    'ql-mfg': [
      { id: 'm', name: '装备展区', hall: '体育馆东侧', cls: 'a', booths: 22, desc: '制造企业沿跑道排列' },
    ],
    'yh-grad': [
      { id: 'g', name: '报告厅前区', hall: '一楼门厅', cls: 'b', booths: 18, desc: '桌位沿门厅两侧' },
    ],
    'cw-ind': [
      { id: 'mat', name: '材料展区', hall: 'B 馆北', cls: 'c', booths: 30, desc: '新材料与装备' },
      { id: 'dig', name: '数字展区', hall: 'B 馆南', cls: 'b', booths: 24, desc: '软件与服务' },
    ],
    'mb-gen': [
      { id: 'sv', name: '服务展区', hall: '二楼大厅', cls: 'a', booths: 15, desc: '生活服务岗位' },
    ],
  };
  const MATS = {
    'cj-2026a': [
      { id: 'm1', name: '秋季双选会参会手册.pdf', type: '手册', pages: 12, size: '1.8 MB', print: true },
      { id: 'm2', name: '参展企业名册.pdf', type: '名册', pages: 6, size: '860 KB', print: true },
      { id: 'm3', name: '活动中心一层导览.pdf', type: '导览图', pages: 2, size: '420 KB', print: true },
      { id: 'm4', name: '现场流程说明.pdf', type: '说明', pages: 1, size: '180 KB', print: false },
    ],
    'ql-mfg': [
      { id: 'q1', name: '临港制造专场名册.pdf', type: '名册', pages: 4, size: '640 KB', print: true },
    ],
    'yh-grad': [],
    'cw-ind': [
      { id: 'c1', name: '澄湾产业园参会手册.pdf', type: '手册', pages: 8, size: '1.2 MB', print: true },
      { id: 'c2', name: 'B 馆导览.pdf', type: '导览图', pages: 1, size: '360 KB', print: true },
    ],
    'mb-gen': [],
  };
  const INDUSTRY = {
    'cj-2026a': [['智能制造', 16], ['互联网', 12], ['医疗健康', 9], ['教育', 9]],
    'ql-mfg': [['智能制造', 14], ['物流', 8]],
    'yh-grad': [['专业服务', 7], ['科研', 6], ['教育', 5]],
    'cw-ind': [['新材料', 22], ['互联网', 18], ['装备', 17], ['物流', 16]],
    'mb-gen': [['生活服务', 9], ['零售', 6]],
  };
  const GROUPS = [
    { name: '澄江学院就业网', sync: '2026-10-16 09:42', fairs: 2, companies: 64, listing: 40, fairPos: 56, months: [['2026年9月', 1], ['2026年10月', 1]] },
    { name: '青岚高职就业信息服务', sync: '2026-10-20 14:18', fairs: 1, companies: 22, listing: 19, fairPos: 42, months: [['2026年11月', 1]] },
    { name: '砚湖大学研究生就业栏目', sync: '2026-09-11 18:05', fairs: 1, companies: 18, listing: 12, fairPos: 28, months: [['2026年9月', 1]] },
  ];

  function fairBy(id) { return FAIRS.find((f) => f.id === id) || FAIRS[0]; }
  function curFair() { return fairBy(S().fkFair); }
  function isCampus(f) { return f.theme === 'campus' || f.theme === 'campus_corp' || CAMPUS_RE.test(f.name + ' ' + f.organizer + ' ' + f.desc + ' ' + f.sourceName); }
  function statusLabel(st, campus) {
    if (st === 'ongoing') return '进行中';
    if (st === 'ended') return '已结束';
    return campus ? '未开始' : '即将开始';
  }
  function saved() { const v = S().fkSaved; return Array.isArray(v) ? v : []; }
  function companiesOf(id) { return COS[id] || []; }
  function zonesOf(id) { return ZONES[id] || []; }
  function matsOf(id) { return MATS[id] || []; }
  function coBy() {
    const list = companiesOf(curFair().id);
    return list.find((c) => c.id === S().fkCo) || list[0];
  }
  function urlOf(host, path) { return 'https://' + host + path; }
  function pill(text, warn) { return { text: text, warn: warn ? 1 : 0 }; }
  function shell(bandOpts, body, foot, extra) {
    return band(bandOpts) + '<main class="body fk">' + body + '</main>' + foot + nav(null) + (extra || '');
  }
  function bandOf(title, sub, status, eyebrow) {
    return { kind: 'compact', eyebrow: eyebrow || '私有化部署', title: title, sub: sub || '', seal: null, status: status };
  }
  function kv(rows) {
    return '<div class="fk-kv">' + rows.map((r) => '<i>' + r[0] + '</i><b>' + r[1] + '</b>').join('') + '</div>';
  }
  function sourceBlock(f) {
    return '<section class="fk-card"><div class="fk-h"><h3>信息来源</h3><span>以来源平台为准</span></div>' + kv([
      ['来源机构', f.sourceName],
      ['同步时间', f.sync],
      ['外部 ID', f.externalId],
      ['来源链接', f.host + f.path],
      ['来源说明', f.note],
    ]) + '</section>';
  }
  function helpLine() { return '<p class="fk-fine">' + HELP + '</p>'; }
  function boundary(t) { return '<p class="fk-fine">' + t + '</p>'; }
  function goBtn(cls, go, set, title, desc, em) {
    return '<button class="' + cls + '" data-go="' + go + '"' + (set ? ' data-set="' + set + '"' : '') + '><b>' + title + '</b><small>' + desc + '</small>' + (em ? '<em>' + em + '</em>' : '') + '</button>';
  }
  function stateCards(title, paras, actions) {
    return '<div class="fk-state"><section class="fk-card fk-statecard"><div class="fk-statein"><h3>' + title + '</h3>' + paras.map((p) => '<p class="fk-sub">' + p + '</p>').join('') + helpLine() + (actions ? '<div class="fk-actions">' + actions + '</div>' : '') + '</div></section></div>';
  }
  function dockAsk(ask) {
    return '<button class="askq" data-go="xq"><span class="mic">' + icon('mic', 30, 2.2) + '</span><span>' + ask + '</span></button>';
  }
  function dockBack(label, go, set) {
    const attr = go ? ' data-go="' + go + '"' + (set ? ' data-set="' + set + '"' : '') : ' data-act="back"';
    return '<button class="btn sec"' + attr + '>' + icon('chevL', 30, 2.4) + (label || '返回') + '</button>';
  }
  function qrLayer() {
    const kind = S().fkQr;
    if (!kind) return '';
    const f = curFair();
    const co = coBy();
    let title = L.titleBook, host = f.host, line = L.lineBook, sub = f.name;
    if (kind === 'checkin') { title = L.titleCheck; line = '用手机扫码，在来源平台签到'; host = f.host; }
    else if (kind === 'apply' && co) { title = '扫码投递'; line = L.lineApply; host = co.host; sub = co.name; }
    else if (kind === 'nav') { title = '扫码在手机上导航'; line = '用手机扫码，在手机地图里打开场馆位置'; host = f.navHost; sub = f.venue; }
    const seed = host.split('').reduce((n, ch, i) => n + ch.charCodeAt(0) * (i + 1), 3);
    return '<div class="overlay" role="dialog" aria-modal="true"><div class="dialog fk-dlg"><h2>' + title + '</h2><p class="fk-sub" style="text-align:center">' + sub + '</p><div class="fk-qrbox">' + qr(seed, 260) + '<b>示例码，不能扫</b><span class="fk-fine">' + host + '</span></div><p class="fk-sub">' + line + '</p>' + kv([['来源机构', kind === 'apply' && co ? co.name : f.sourceName], ['外部 ID', kind === 'apply' && co ? co.externalId : f.externalId]]) + '<button class="btn pri" data-fk="close">关闭</button></div></div>';
  }
  function bind(el, fn) {
    const onClick = (e) => {
      const t = e.target.closest('[data-fk]');
      if (!t || !el.contains(t)) return;
      e.preventDefault();
      e.stopPropagation();
      fn(t.getAttribute('data-fk'), t.getAttribute('data-arg') || '');
    };
    const onDemo = (e) => fn('demo', e.detail || '');
    el.addEventListener('click', onClick);
    el.addEventListener('proto-demo', onDemo);
    return () => { el.removeEventListener('click', onClick); el.removeEventListener('proto-demo', onDemo); };
  }
  function refresh() { window.__proto.refresh(); }
  function add(id, name, def) {
    def.bOnly = true;
    def.notes = def.notes || {};
    def.notes.keep = (def.notes.keep || '') + BAN + TAIL;
    window.SCREENS.push(Object.assign({ id: id, group: GROUP, name: name }, def));
  }

  function campusList() { return FAIRS.filter(isCampus); }
  function themeNow() { return S().bFairTheme || ''; }
  function themed() {
    const t = themeNow();
    if (t === 'campus') return FAIRS.filter(isCampus);
    if (t === 'social') return FAIRS.filter((f) => !isCampus(f));
    return FAIRS.slice();
  }
  function filtered() {
    return themed().filter((f) => {
      if (S().fkFav && saved().indexOf(f.id) < 0) return false;
      if (S().fkStatus && f.status !== S().fkStatus) return false;
      if (S().fkRegion && f.city !== S().fkRegion) return false;
      if (S().fkDate && f.date !== S().fkDate) return false;
      return true;
    });
  }

  /* ---------- 1 校园招聘 ---------- */
  add('b-campus', '校园招聘', {
    notes: {
      does: '运行页 /campus（CampusPage.tsx:147）。主问题是挑一场校园招聘会。场次来自 GET /job-fairs 后按校园规则过滤，不新增字段。',
      motion: '无循环动画。',
      keep: '运行页另有 /campus/welcome 空白占位（当前没有独立迎新招聘内容），不画。改程序时首页两块从「岗位信息 / 招聘会」改成「社会招聘 / 校园招聘」。校园范围：theme 为 campus 或 campus_corp，或名称、主办方、简介、来源命中校园、校招、高校、大学、学院、应届、毕业生、双选、研究生、校企。改程序时按这条规则给招聘会列表加范围，不加新字段。空态去全部招聘会或问 AI 顾问。读取失败可重新加载，不展示上一次缓存。校招岗位、实习岗位链到 b-jobs。',
    },
    demo: [
      { label: '演示：读到了场次', ev: 'ok' },
      { label: '演示：没有校园招聘会', ev: 'empty' },
      { label: '演示：读取失败', ev: 'err' },
    ],
    render: () => {
      const st = S().fkCampus || '';
      let body, status;
      if (st === 'loading') {
        status = pill('正在读取校园招聘会');
        body = stateCards('正在读取校园招聘会', ['未返回前不显示场次名称、时间地点和来源。', '不预估剩余时间，也不拿示例场次把这一页填上。'], '');
      } else if (st === 'empty' || st === 'error') {
        const bad = st === 'error';
        status = pill(bad ? '校园招聘会这次没取到' : '还没有校园招聘会', 1);
        body = stateCards(
          bad ? '校园招聘会这次没取到' : '还没有校园招聘会',
          bad ? ['请求失败了。本机不显示上一次的缓存场次，避免按已经结束的时间地点白跑。'] : ['来源机构还没有已发布的校园场次。本机不会拿往期活动充数。'],
          '<button class="btn sec" data-fk="campus-retry">重新加载</button>' + goBtn('fk-go', 'b-fairs', 'bFairTheme=', '看全部招聘会', '社会场次和校园场次都在列表里', '查看招聘会') + goBtn('fk-go', 'xq', '', '问 AI 顾问', '小青不可用时，仍可自己看名单和打印', '去问'),
        );
      } else {
        status = pill('按来源原文展示');
        const cards = campusList().slice(0, 3).map((f) => {
          return '<button class="fk-fair" data-go="b-campus-fair" data-set="fkFair=' + f.id + ';fkTab=overview"><div class="fk-top"><b>' + f.name + '</b><span class="fk-tag' + (f.status === 'upcoming' ? ' wheat' : f.status === 'ended' ? ' slate' : '') + '">' + statusLabel(f.status, true) + '</span></div><small>' + f.start + ' – ' + f.end.slice(11) + '</small><small>' + f.city + ' · ' + f.venue + '</small><small>' + f.address + '</small><small>主办 ' + f.organizer + '</small><small>来源 ' + f.sourceName + ' · 同步 ' + f.sync + '</small><small>' + f.companies + ' 家企业 · ' + f.jobs + ' 个岗位 · 主办方预计 ' + f.expect + ' 人</small></button>';
        }).join('');
        const campusGo = (go, set, ic, title, desc, em) => '<button class="fk-go fk-cgo" data-go="' + go + '"' + (set ? ' data-set="' + set + '"' : '') + '><span class="ic">' + icon(ic, 48, 2) + '</span><span class="tx"><b>' + title + '</b><small>' + desc + '</small><em>' + em + '</em></span></button>';
        body = '<div class="fk-campus"><div class="fk-fairs">' + cards + '</div><div class="fk-split">'
          + campusGo('b-jobs', 'bJobCat=campus', 'clipboard', '校招岗位', '只看岗位类别里的校招。办理在来源平台，这一页只负责挑到名单。', '查看岗位')
          + campusGo('b-jobs', 'bJobCat=intern', 'clock', '实习岗位', '只看岗位类别里的实习。到岗城市和是否收本届，看来源上的原文。', '查看岗位')
          + campusGo('b-campus-stats', '', 'layers', '校园招聘数据', '按来源机构看场次、企业和月份。不是录用结果。', '查看')
          + campusGo('b-fairs', 'bFairTheme=campus', 'map', '全部校园招聘会', '主题或名称符合校园规则的场次，社会场次不混进来。', '查看招聘会')
          + '</div></div>' + boundary('预约与办理都在来源平台完成。本机不代预约，也不做签到。');
      }
      const campusFoot = (st === 'loading' || st === 'empty' || st === 'error')
        ? dock({ ask: '问小青：怎么挑一场' })
        : '<footer class="dock">' + dockBack('返回') + dockAsk('问小青：怎么挑一场') + '<button class="btn pri" data-go="b-fairs" data-set="bFairTheme=campus">全部校园招聘会' + icon('arrowR', 30, 2.4) + '</button></footer>';
      return shell(
        bandOf('挑一场校园招聘会', '从已发布的校园场次里选一场，再看企业、展位和资料', status, '校园招聘'),
        body,
        campusFoot,
      );
    },
    mount: (el) => bind(el, (act, arg) => {
      if (act === 'campus-retry') S().fkCampus = '';
      else if (act === 'demo') S().fkCampus = arg === 'empty' ? 'empty' : arg === 'err' ? 'error' : '';
      else return;
      refresh();
    }),
  });

  /* ---------- 2 校园招聘会专区 ---------- */
  add('b-campus-fair', '校园招聘会专区', {
    notes: {
      does: '仍是运行页 /campus，选中一场之后的五个页签（CampusTabs.tsx）：企业速览、参展企业、导览图、AI 求职、打印。预约二维码标题用运行页「' + L.titleBook + '」（CampusPage.tsx:252）。详情页不放「去来源平台预约」按钮。',
      motion: '无循环动画。页签只切换本屏状态。',
      keep: 'AI 求职三项去 resume（诊断、优化）和 interview（模拟面试）。打印两项去 print-src、resume-src，活动资料去 b-fair-materials。小青不可用时名单、展位、资料打印照常能用。已结束的场次不再放预约。参展企业「查看全部」去 b-fair-companies，导览图去 b-fair-map。',
    },
    render: () => {
      const f = curFair();
      const tab = S().fkTab || 'overview';
      const tabs = [['overview', '企业速览'], ['companies', '参展企业'], ['map', '导览图'], ['ai', 'AI 求职'], ['print', '打印']].map((t) => {
        return '<button data-fk="tab" data-arg="' + t[0] + '" aria-pressed="' + (tab === t[0]) + '">' + t[1] + '</button>';
      }).join('');
      const cos = companiesOf(f.id);
      let panel = '';
      if (tab === 'overview') {
        const hot = cos.slice(0, 2).map((c) => '<div class="fk-row"><div class="tx"><b>' + c.name + '</b><small>' + c.booth + ' · ' + c.industry + ' · ' + c.jobs.length + ' 个岗位 · ' + c.jobs.map((p) => p.title).join('、') + '</small></div></div>').join('');
        const endedBits = f.status === 'ended'
          ? kv([['主办', f.organizer], ['交通', f.traffic], ['现场服务', f.services]]) + '<p class="fk-sub">这场已经结束，不再开放预约。名单、展位和参会回顾仍可查看。资料按主办方上传的文件打印。</p><p class="fk-fine">入场方式以当时的安排为准：' + f.admit + '</p>'
          : '';
        panel = '<div class="fk-metrics"><div class="fk-metric"><b>' + f.companies + '</b><span>参展企业</span></div><div class="fk-metric"><b>' + f.jobs + '</b><span>招聘岗位</span></div><div class="fk-metric"><b>' + (f.theme === 'campus_corp' ? '校企' : '双选') + '</b><span>活动类型</span></div><div class="fk-metric"><b>' + (INDUSTRY[f.id] || []).length + '</b><span>行业覆盖</span></div></div>'
          + '<section class="fk-card"><div class="fk-h"><h3>活动信息</h3><span>以来源平台为准</span></div>' + kv([['举办时间', f.start + ' – ' + f.end.slice(11)], ['举办地点', f.address + ' ' + f.venue], ['现场服务', f.services], ['入场方式', f.admit]]) + endedBits + (f.status === 'ended' ? '' : '<button class="btn pri" data-fk="qr" data-arg="book">扫码预约</button>') + '</section>'
          + '<section class="fk-card"><div class="fk-h"><h3>热门企业</h3><span>按在招岗位数</span></div>' + hot + goBtn('fk-go', 'b-fair-companies', 'fkFair=' + f.id, '查看全部 ' + f.companies + ' 家', '名单在参展企业页，行上再进详情', '查看') + '</section>'
          + sourceBlock(f)
          + boundary('本专区展示来源平台上的校招信息。预约在来源平台办理，不在本机完成。');
      } else if (tab === 'companies') {
        panel = '<div class="fk-list"><section class="fk-card fk-counthead"><b class="fk-big">' + cos.length + '</b><div><div class="fk-h"><h3>已同步的参展企业</h3><span>主办方登记 ' + f.companies + ' 家</span></div><p class="fk-sub">' + f.name + ' · 名单由 ' + f.sourceName + ' 在 ' + f.sync + ' 同步。其余企业在参展企业页。</p></div></section>'
          + cos.map((c) => '<section class="fk-card"><div class="fk-h"><h3>' + c.name + '</h3><span class="fk-tag">' + c.booth + '</span></div><p class="fk-sub">' + c.industry + ' · ' + c.zone + '</p><p class="fk-sub">' + c.brief + '</p><p class="fk-fine">在招 ' + c.jobs.map((p) => p.title).join('、') + ' · 同步 ' + c.sync + '</p></section>').join('')
          + goBtn('fk-go', 'b-fair-companies', 'fkFair=' + f.id, '查看全部参展企业', '搜索、展区和每一家的详情在下一页', '查看')
          + '<p class="fk-fine">名单以主办方回传为准；本机不代收简历，也不在平台内投递。</p></div>';
      } else if (tab === 'map') {
        const zones = zonesOf(f.id);
        const zoneHtml = zones.map((z) => {
          const names = cos.filter((c) => c.zone === z.name).map((c) => c.name + ' ' + c.booth).join('、') || '这一区在示例名单里还没有企业';
          return '<div class="fk-zone ' + z.cls + '"><b>' + z.hall + '</b><small>' + z.name + '</small><small>' + z.booths + ' 个展位 · ' + z.desc + '</small><small>' + names + '</small></div>';
        }).join('');
        const who = cos.map((c) => c.jobs.map((p) => '<div class="fk-row"><div class="tx"><b>' + c.booth + ' ' + c.name + ' · ' + p.title + '</b><small>' + c.zone + ' · ' + c.brief + '</small></div></div>').join('')).join('');
        panel = '<div class="fk-planbox"><section class="fk-card fk-lock"><h3>场馆与展位</h3><p class="fk-sub">' + f.address + ' · ' + f.venue + '</p><p class="fk-fine">' + f.traffic + '</p><div class="fk-map">' + zoneHtml + '</div><div class="fk-duo"><button class="btn sec" data-fk="qr" data-arg="nav">扫码在手机上导航</button>' + goBtn('fk-go', 'b-fair-map', 'fkFair=' + f.id, '查看完整导览图', '有图看图，没有图看展区索引', '') + '</div></section><section class="fk-card"><h3>展位上的企业</h3><div class="fk-rows">' + who + '</div></section></div>';
      } else if (tab === 'ai') {
        const down = S().ai === 'down';
        const names = cos.map((c) => '<div class="fk-row"><div class="tx"><b>' + c.booth + ' ' + c.name + '</b><small>' + c.industry + ' · ' + c.jobs.map((p) => p.title).join('、') + '</small></div></div>').join('');
        panel = '<div class="fk-planbox"><section class="fk-card fk-lock"><div class="fk-h"><h3>AI 求职</h3><span class="fk-ai">AI 生成，仅供参考</span></div>'
          + (down ? '<p class="fk-sub">小青暂时不可用。名单、展位和资料打印不经过小青，照常能用。简历和面试仍可进入，由那两页改成手动。</p>' : '<p class="fk-sub">诊断、模拟面试和优化都走已经有的能力，这一页不另调岗位模型。</p>')
          + '</section><section class="fk-card"><h3>先看这几家再决定练什么</h3><div class="fk-rows">' + names + '</div></section><div class="fk-split">'
          + goBtn('fk-go', 'resume', '', '简历诊断', '用本人简历做诊断，结论只给本人参考。', '开始诊断')
          + goBtn('fk-go', 'interview', '', '模拟面试', '仿真练习和点评，不写成录用。', '开始模拟')
          + goBtn('fk-go', 'resume', '', '简历优化', '只改表达，不补充虚构经历。', '开始优化')
          + goBtn('fk-go', 'b-jobs', 'bJobCat=campus', '查看岗位', '浏览来源岗位，办理在来源平台。', '查看岗位')
          + '</div></div>';
      } else {
        const files = matsOf(f.id);
        const fileRows = (files.length ? files : [{ name: '这场还没有上传活动资料', type: '空', pages: 0, size: '—' }]).map((m) => '<div class="fk-row"><div class="tx"><b>' + m.name + '</b><small>' + m.type + (m.pages ? ' · ' + m.pages + ' 页 · ' + m.size : '') + '</small></div></div>').join('');
        panel = '<div class="fk-planbox"><section class="fk-card fk-lock"><h3>自助打印</h3><p class="fk-sub">简历和活动资料可以现场打。活动资料只打印主办方上传的文件，不在这里编一份。</p></section><section class="fk-card"><h3>' + f.name + ' 的资料</h3><div class="fk-rows">' + fileRows + '</div></section><div class="fk-split">'
          + goBtn('fk-go', 'print-src', '', '上传文件打印', '简历、证件、通知单，手机或 U 盘。', '去打印')
          + goBtn('fk-go', 'resume-src', '', '从简历服务来', '解析、诊断、优化之后再打。', '去简历')
          + goBtn('fk-go', 'b-fair-materials', 'fkFair=' + f.id, '活动资料打印', '手册、名册、导览图，逐份选。', '去选资料')
          + '</div></div>';
      }
      const ended = f.status === 'ended';
      return shell(
        bandOf(f.name, f.city + ' · ' + f.venue + ' · ' + statusLabel(f.status, true), pill(ended ? '这场已经结束' : '按来源原文展示', ended), '校园招聘会'),
        '<div class="fk-tabs">' + tabs + '</div>' + panel,
        dock({ ask: '问小青：这场怎么看' }),
        qrLayer(),
      );
    },
    mount: (el) => bind(el, (act, arg) => {
      if (act === 'tab') S().fkTab = arg;
      else if (act === 'qr') S().fkQr = arg;
      else if (act === 'close') S().fkQr = '';
      else return;
      refresh();
    }),
  });

  /* ---------- 3 校园招聘数据 ---------- */
  add('b-campus-stats', '校园招聘数据', {
    notes: {
      does: '运行页 /campus/freshman-insights（FreshmanInsightsPage.tsx:11）。GET /kiosk/campus/recruitment-stats。不是生成式 AI。',
      motion: '无循环动画。',
      keep: '空态对应 reason=no_published_campus_records，不展示示例数字。岗位板块关闭（fkNoJobs）时不显示岗位库计数，只显示场内岗位。查看招聘会去 b-fairs 且范围为校园。',
    },
    demo: [
      { label: '演示：统计返回了', ev: 'ok' },
      { label: '演示：没有经核验数据', ev: 'empty' },
      { label: '演示：读取失败', ev: 'err' },
    ],
    render: () => {
      const st = S().fkStats || '';
      let body, status;
      if (st === 'loading') {
        status = pill('正在读取经核验的校园招聘统计');
        body = stateCards('正在读取经核验的校园招聘统计', ['返回前不显示场次、企业和岗位数字。', '不会先放一组示例数字。'], '');
      } else if (st === 'error' || st === 'empty') {
        const bad = st === 'error';
        status = pill(bad ? '校园招聘统计暂时无法读取' : '暂无经核验的校园招聘统计', 1);
        body = stateCards(
          bad ? '校园招聘统计暂时无法读取' : '暂无经核验的校园招聘统计',
          bad ? ['没有编造数字。可以稍后重新加载，或去看具体招聘会。'] : ['当前没有经核验的校园招聘聚合统计。不会展示示例数据。'],
          (bad ? '<button class="btn sec" data-fk="stats-retry">重新加载</button>' : '') + goBtn('fk-go', 'b-fairs', 'bFairTheme=campus', '查看招聘会', '去看已经发布的校园场次', '查看招聘会'),
        );
      } else {
        const noJobs = !!S().fkNoJobs;
        status = pill(noJobs ? '岗位板块关闭，不计岗位库' : '经核验来源的聚合统计');
        body = '<p class="fk-fine">本页只聚合已审核且已发布的校园招聘会与校招岗位，每个数字都带来源机构与同步时间。不含招聘结果类指标；本平台无法证实录用、签约或候选人规模。无经核验数据时返回空集合，不使用示例数字。</p><div class="fk-list">'
          + GROUPS.map((g) => {
            const jobCell = noJobs
              ? '<div class="fk-metric"><b>' + g.fairPos + '</b><span>场内岗位</span><small>只统计招聘会场内岗位</small></div>'
              : '<div class="fk-metric"><b>' + (g.listing + g.fairPos) + '</b><span>在招岗位</span><small>校招岗位 ' + g.listing + ' · 场内岗位 ' + g.fairPos + '</small></div>';
            return '<section class="fk-card"><div class="fk-h"><h3>' + g.name + '</h3><span>来源机构</span></div>' + kv([['同步时间', g.sync]])
              + '<div class="fk-metrics"><div class="fk-metric"><b>' + g.fairs + '</b><span>招聘会场次</span></div><div class="fk-metric"><b>' + g.companies + '</b><span>参会企业</span></div>' + jobCell + '<div class="fk-metric"><b>' + g.months.length + '</b><span>有场次的月份</span><small>' + g.months.map((m) => m[0] + ' ' + m[1] + ' 场').join(' · ') + '</small></div></div></section>';
          }).join('') + '</div>';
      }
      const statsFoot = '<footer class="dock">' + dockBack('返回校园招聘', 'b-campus') + dockAsk('问小青：数字怎么读') + '<button class="btn pri" data-go="b-fairs" data-set="bFairTheme=campus">查看招聘会' + icon('arrowR', 30, 2.4) + '</button></footer>';
      return shell(
        bandOf('这些数字从哪来', '按来源机构汇总已发布的校园场次，不是录用结果', status, '校园招聘数据'),
        body,
        statsFoot,
      );
    },
    mount: (el) => bind(el, (act, arg) => {
      if (act === 'stats-retry') S().fkStats = '';
      else if (act === 'demo') S().fkStats = arg === 'empty' ? 'empty' : arg === 'err' ? 'error' : '';
      else return;
      if (act === 'demo' && arg === 'ok') S().bFairTheme = S().bFairTheme;
      refresh();
    }),
  });

  /* ---------- 4 招聘会列表 ---------- */
  function fairCard(f, rich) {
    const mark = saved().indexOf(f.id) >= 0 ? ' · 已收藏' : '';
    const extra = rich
      ? '<small>' + f.address + '</small><small>主办 ' + f.organizer + '</small><small>' + f.traffic + '</small><small>' + f.companies + ' 家企业 · ' + f.jobs + ' 个岗位 · 预计 ' + f.expect + ' 人</small><small>' + f.admit + '</small>'
      : '<small>' + f.companies + ' 家企业 · ' + f.jobs + ' 个岗位</small>';
    return '<button class="fk-fair" data-go="b-fair" data-set="fkFair=' + f.id + '"><div class="fk-top"><b>' + f.name + '</b><span class="fk-tag' + (f.status === 'ongoing' ? '' : ' wheat') + '">' + statusLabel(f.status, false) + '</span></div><small>' + f.start + ' – ' + f.end.slice(11) + '</small><small>' + f.city + ' · ' + f.venue + '</small><small>来源 ' + f.sourceName + ' · 同步 ' + f.sync + mark + '</small>' + extra + '</button>';
  }
  function filterSheet() {
    if (!S().fkFilter) return '';
    const cities = [];
    FAIRS.forEach((f) => { if (cities.indexOf(f.city) < 0) cities.push(f.city); });
    const dates = [];
    FAIRS.forEach((f) => { if (dates.indexOf(f.date) < 0) dates.push(f.date); });
    const chip = (act, arg, on, label) => '<button data-fk="' + act + '" data-arg="' + arg + '" aria-pressed="' + on + '">' + label + '</button>';
    return '<button class="scrim" data-fk="filter-close" aria-label="关闭筛选"></button><div class="sheet fk-sheet" role="dialog"><div class="grab"></div><h2>筛选场次</h2>'
      + '<button class="fk-search" data-act="toast" data-arg="演示：弹出屏上键盘">搜场次名称、企业或地点</button>'
      + '<p class="fk-fine">关键字和状态会按全部场次来查；地区、日期和收藏只在这次已经加载出来的场次里筛选，不代表全部结果。屏上键盘弹出后才能输入，这里不代填。</p>'
      + '<div class="fk-lab">场次状态</div><div class="fk-chips">'
      + chip('fst', '', !S().fkStatus, '全部')
      + chip('fst', 'upcoming', S().fkStatus === 'upcoming', '即将开始')
      + chip('fst', 'ongoing', S().fkStatus === 'ongoing', '进行中')
      + chip('fst', 'ended', S().fkStatus === 'ended', '已结束')
      + '</div><div class="fk-lab">地区</div><div class="fk-chips">'
      + chip('fregion', '', !S().fkRegion, '全部')
      + cities.map((c) => chip('fregion', c, S().fkRegion === c, c)).join('')
      + '</div><div class="fk-lab">日期</div><div class="fk-chips">'
      + chip('fdate', '', !S().fkDate, '全部')
      + dates.map((d) => chip('fdate', d, S().fkDate === d, d)).join('')
      + '</div><button class="btn pri" data-fk="filter-close">看这些场次</button></div>';
  }
  add('b-fairs', '招聘会列表', {
    notes: {
      does: '运行页 /job-fairs（JobFairsPage.tsx:39）。标题随 bFairTheme：空为全部招聘会，social 为社会招聘会，campus 为校园招聘会。范围是本屏状态，改程序时按校园识别规则过滤，不加新字段。',
      motion: '无循环动画。筛选在抽屉里改状态。',
      keep: '关键字用演示：弹出屏上键盘。底部说明照运行页：扫码后在来源平台预约或签到，本机不保存结果。查看入场入口去 b-fair-checkin，看校园招聘去 b-campus。收藏要登录。读取失败不显示缓存场次。运行页错误态还有企业目录，本区没有约定的屏编号，不另造入口。改程序时按校园识别规则给列表加范围，不加新字段。',
    },
    demo: [
      { label: '演示：场次返回了', ev: 'ok' },
      { label: '演示：没有场次', ev: 'empty' },
      { label: '演示：读取失败', ev: 'err' },
    ],
    render: () => {
      const st = S().fkFairs || '';
      const theme = themeNow();
      const title = theme === 'social' ? '社会招聘会' : theme === 'campus' ? '校园招聘会' : '全部招聘会';
      const seg = '<div class="fk-seg">'
        + '<button data-fk="theme" data-arg="" aria-pressed="' + (theme === '') + '">全部</button>'
        + '<button data-fk="theme" data-arg="social" aria-pressed="' + (theme === 'social') + '">社会招聘会</button>'
        + '<button data-fk="theme" data-arg="campus" aria-pressed="' + (theme === 'campus') + '">校园招聘会</button></div>';
      let body, status;
      if (st === 'loading') {
        status = pill('正在取场次名单');
        body = seg + stateCards('正在取场次名单', ['未返回前不显示条数。', '只显示整体等待，不显示分步进度，也不预估剩余时间。'], '');
      } else if (st === 'error') {
        status = pill('场次名单这次没取到', 1);
        body = seg + stateCards('场次名单这次没取到', ['请求失败了。本机不显示上一次的缓存场次，避免按已经结束的时间地点白跑。'], '<button class="btn sec" data-fk="fairs-retry">重新加载</button>' + goBtn('fk-go', 'b-jobs', '', '岗位信息', '岗位和招聘会不是同一份名单', '查看岗位'));
      } else if (st === 'empty') {
        status = pill('近期没有已发布的场次');
        body = seg + stateCards('近期没有已发布的场次', ['主办方还没有发布匹配的场次。本机不会拿往期活动充数，也不会写一个不存在的日期。'], goBtn('fk-go', 'b-fair-checkin', '', '到场指引', '已经预约过的场次，可以先看当天怎么走', '查看') + goBtn('fk-go', 'print-src', '', '先把简历打印好', '下次赶上招聘会，材料是现成的', '去打印'));
      } else {
        const list = filtered();
        const favEmpty = !!S().fkFav && saved().length === 0;
        if (!list.length && favEmpty) {
          status = pill('还没有收藏的场次');
          body = seg + '<div class="fk-duo"><button class="btn sec" data-fk="filter">筛选</button><button class="btn sec" data-fk="fav" aria-pressed="true">只看收藏</button></div>'
            + stateCards('还没有收藏的招聘会', ['收藏只是这台终端的浏览辅助，不代表已预约或已签到。'], '<button class="btn sec" data-fk="fav-off">查看全部场次</button>' + goBtn('fk-go', 'b-fair-checkin', '', '到场指引', '已预约过的场次可以先看当天怎么走', '查看'));
        } else if (!list.length) {
          status = pill('没有符合当前条件的场次');
          body = seg + '<div class="fk-duo"><button class="btn sec" data-fk="filter">筛选</button><button class="btn sec" data-fk="fav" aria-pressed="' + (!!S().fkFav) + '">只看收藏</button></div>'
            + stateCards('没有符合当前条件的招聘会', ['可以改状态、地区、日期，或关掉只看收藏。本机不拿别的场次来凑。'], '<button class="btn sec" data-fk="clear-filter">清除筛选</button>');
        } else {
          const up = list.filter((f) => f.status === 'upcoming').length;
          const on = list.filter((f) => f.status === 'ongoing').length;
          const endedN = list.filter((f) => f.status === 'ended').length;
          const companies = list.reduce((n, f) => n + f.companies, 0);
          status = pill('按来源原文展示');
          const page = S().fkPage || 0;
          const size = list.length > 4 ? 4 : list.length;
          const pages = Math.max(1, Math.ceil(list.length / size));
          const p = Math.min(page, pages - 1);
          const slice = list.slice(p * size, p * size + size);
          const rich = slice.length <= 3;
          body = seg + '<div class="fk-duo"><button class="btn sec" data-fk="filter">筛选</button><button class="btn sec" data-fk="fav" aria-pressed="' + (!!S().fkFav) + '">只看收藏</button></div>'
            + '<div class="fk-metrics"><div class="fk-metric"><b>' + list.length + '</b><span>查到的场次</span></div><div class="fk-metric"><b>' + companies + '</b><span>参展企业</span></div><div class="fk-metric"><b>' + (on + up) + '</b><span>进行中或即将开始</span></div><div class="fk-metric"><b>' + endedN + '</b><span>已结束</span></div></div>'
            + '<p class="fk-fine">这页 ' + slice.length + ' 场。</p>'
            + '<div class="' + (rich ? 'fk-list' : 'fk-block') + '">' + slice.map((f) => fairCard(f, rich)).join('') + '</div>'
            + (pages > 1 ? '<div class="fk-duo"><button class="btn sec" data-fk="page" data-arg="-1"' + (p === 0 ? ' disabled' : '') + '>上一页</button><button class="btn sec" data-fk="page" data-arg="1"' + (p >= pages - 1 ? ' disabled' : '') + '>下一页</button></div>' : '')
            + boundary('扫码后在来源平台预约或签到；本机不保存结果。只展示已审核发布、来源完整的场次。');
        }
      }
      const foot = '<footer class="dock"><button class="btn sec" data-act="back">' + icon('chevL', 30, 2.4) + '返回</button><button class="askq" data-go="xq"><span class="mic">' + icon('mic', 30, 2.2) + '</span><span>问小青</span></button><button class="btn sec" data-go="b-fair-checkin">查看入场入口</button><button class="btn pri" data-go="b-campus">看校园招聘' + icon('arrowR', 30, 2.4) + '</button></footer>';
      return shell(bandOf(title, '预约在来源平台完成。关键字、状态、地区和日期在筛选里', status, '招聘会'), body, foot, filterSheet());
    },
    mount: (el) => bind(el, (act, arg) => {
      if (act === 'theme') { S().bFairTheme = arg; S().fkPage = 0; }
      else if (act === 'filter') S().fkFilter = true;
      else if (act === 'filter-close') S().fkFilter = false;
      else if (act === 'fav') {
        if (!S().logged) { window.go('login'); return; }
        S().fkFav = !S().fkFav; S().fkPage = 0;
      } else if (act === 'fav-off') { S().fkFav = false; S().fkPage = 0; }
      else if (act === 'fst') { S().fkStatus = arg; S().fkPage = 0; }
      else if (act === 'fregion') { S().fkRegion = arg; S().fkPage = 0; }
      else if (act === 'fdate') { S().fkDate = arg; S().fkPage = 0; }
      else if (act === 'clear-filter') { S().fkStatus = ''; S().fkRegion = ''; S().fkDate = ''; S().fkFav = false; S().fkPage = 0; }
      else if (act === 'page') S().fkPage = Math.max(0, (S().fkPage || 0) + (arg === '1' ? 1 : -1));
      else if (act === 'fairs-retry') S().fkFairs = '';
      else if (act === 'demo') S().fkFairs = arg === 'empty' ? 'empty' : arg === 'err' ? 'error' : '';
      else return;
      refresh();
    }),
  });

  /* ---------- 5 招聘会详情 ---------- */
  add('b-fair', '招聘会详情', {
    notes: {
      does: '运行页 /job-fairs/:id（JobFairDetailPage.tsx:51）。时间地点、来源四项、收藏、五个子入口。底栏只有扫码签到、扫码预约；没有「去来源平台预约」。没有签到链接时不画扫码签到。',
      motion: '无循环动画。收藏未登录去 login，已登录在本屏切换。',
      keep: '五个入口：参展企业 b-fair-companies、展位图 b-fair-map、资料打印 b-fair-materials、AI 参会准备 b-fair-plan、现场数据 b-fair-stats。读取失败回列表，不展示半截详情。已被来源方下架并进这一帧（演示：来源下架了），不单开一屏。没有「去来源平台预约」。',
    },
    demo: [
      { label: '演示：详情返回了', ev: 'ok' },
      { label: '演示：详情没取到', ev: 'err' },
      { label: '演示：来源下架了', ev: 'down' },
    ],
    render: () => {
      const st = S().fkDetail || '';
      if (st === 'loading') {
        return shell(bandOf('正在取这场的详情', '返回前不显示时间、地点和来源', pill('正在取这场的详情'), '招聘会'), stateCards('正在取这场的详情', ['未返回前不写出举办时间和来源机构。'], ''), dock({ ask: '问小青：这场怎么走' }));
      }
      if (st === 'error' || st === 'down') {
        const down = st === 'down';
        return shell(bandOf(down ? '这场已被来源方下架' : '这场的详情没取到', '不显示上一次打开时留下的时间地点', pill(down ? '已被来源方下架' : '详情这次没取到', 1), '招聘会'), stateCards(down ? '已被来源方下架' : '详情这次没取到', down ? ['来源不再公开这场。本机不保留半截时间地点，也不再给出扫码。'] : ['可以重新加载。列表里的其他场次不受这场影响。'], (down ? '' : '<button class="btn sec" data-fk="detail-retry">重新加载</button>') + goBtn('fk-go', 'b-fairs', '', '回场次列表', '看看还有哪些场次', '查看招聘会')), dock({ ask: '问小青：这场怎么走' }), '');
      }
      const f = curFair();
      const on = saved().indexOf(f.id) >= 0;
      const ended = f.status === 'ended';
      const rows = [
        ['b-fair-companies', '参展企业名单', '主办方已提供 ' + f.companies + ' 家，可看展位号并进入企业详情'],
        ['b-fair-map', '展位分布', '有主办方给的图或展位号才显示；没有就看展区索引'],
        ['b-fair-materials', '活动物料', matsOf(f.id).length ? matsOf(f.id).length + ' 份，可现场打印带走' : '这场还没有可下载的物料'],
        ['b-fair-plan', ended || S().fkEnded ? 'AI 参会回顾' : 'AI 参会准备', ended || S().fkEnded ? '基于本人简历梳理后续；不承诺结果' : '需要确认本人简历；不排路线、不承诺结果'],
        ['b-fair-stats', '现场统计', '主办方已回传的数字不由本机估算；没回传就空着'],
      ].map((r) => goBtn('fk-row', r[0], 'fkFair=' + f.id, r[1], r[2], '查看')).join('');
      const checkinBtn = f.checkin ? '<button class="btn sec" data-fk="qr" data-arg="checkin">扫码签到</button>' : '';
      const foot = '<footer class="dock"><button class="btn sec" data-act="back">' + icon('chevL', 30, 2.4) + '返回</button><button class="askq" data-go="xq"><span class="mic">' + icon('mic', 30, 2.2) + '</span><span>问小青</span></button>' + checkinBtn + '<button class="btn pri" data-fk="qr" data-arg="book">扫码预约' + icon('arrowR', 30, 2.4) + '</button></footer>';
      const body = '<section class="fk-card"><div class="fk-h"><h3>' + f.organizer + '</h3><button class="fk-fav' + (on ? ' on' : '') + '" data-fk="fav">' + (on ? '已收藏' : '收藏') + '</button></div>'
        + kv([['举办时间', f.start + ' – ' + f.end], ['举办地点', f.city + ' · ' + f.venue], ['详细地址', f.address], ['交通', f.traffic]])
        + '<p class="fk-sub">' + f.desc + '</p><p class="fk-fine">参展企业 ' + f.companies + ' 家 · 招聘岗位 ' + f.jobs + ' 个 · 主办方预计参会 ' + f.expect + ' 人</p></section>'
        + sourceBlock(f)
        + '<section class="fk-card"><div class="fk-h"><h3>可以办的五件事</h3><span>按主办方提供</span></div>' + rows + '<button class="btn sec" data-fk="qr" data-arg="nav">扫码在手机上导航</button></section>'
        + boundary('时间、地点与来源由主办方发布，本机不代预约。预约在来源平台完成，本机也拿不到预约结果。');
      return shell(bandOf(f.name, '来源 · ' + f.sourceName + ' · 信息以来源平台为准', pill(ended ? '这场已经结束' : '场次与参展名单由主办方发布', ended), '招聘会详情'), body, foot, qrLayer());
    },
    mount: (el) => bind(el, (act, arg) => {
      if (act === 'fav') {
        if (!S().logged) { window.go('login'); return; }
        const id = curFair().id;
        const set = saved();
        S().fkSaved = set.indexOf(id) >= 0 ? set.filter((x) => x !== id) : set.concat(id);
      } else if (act === 'qr') S().fkQr = arg;
      else if (act === 'close') S().fkQr = '';
      else if (act === 'detail-retry') S().fkDetail = '';
      else if (act === 'demo') S().fkDetail = arg === 'err' ? 'error' : arg === 'down' ? 'down' : '';
      else return;
      refresh();
    }),
  });

  /* ---------- 6 参展企业 ---------- */
  add('b-fair-companies', '参展企业', {
    notes: {
      does: '运行页 /job-fairs/:id/companies（FairCompaniesPage.tsx:25）。搜索、展区筛选、企业名单。点行去 b-fair-company。',
      motion: '无循环动画。搜索是屏上键盘。',
      keep: '边界照运行页意思：名单以主办方回传为准，不在平台内投递。读取失败、空名单分开。空名单不编企业。',
    },
    demo: [
      { label: '演示：名单返回了', ev: 'ok' },
      { label: '演示：还没有名单', ev: 'empty' },
      { label: '演示：名单没取到', ev: 'err' },
    ],
    render: () => {
      const f = curFair();
      const st = S().fkCos || '';
      let body, status;
      if (st === 'loading') {
        status = pill('正在取参展名单');
        body = stateCards('正在取参展名单', ['未返回前不显示企业名和展位号。'], '');
      } else if (st === 'error') {
        status = pill('参展名单没取到', 1);
        body = stateCards('参展名单没取到', ['可以重新加载。招聘会的时间地点还在详情里。'], '<button class="btn sec" data-fk="cos-retry">重新加载</button>' + goBtn('fk-go', 'b-fair', 'fkFair=' + f.id, '返回招聘会', '时间地点仍然可以查看', '返回'));
      } else if (st === 'empty') {
        status = pill('主办方还没有提供名单');
        body = stateCards('主办方还没有提供名单', ['本机不编一家企业来凑。物料里有时有纸质名册。'], goBtn('fk-go', 'b-fair-materials', 'fkFair=' + f.id, '看看活动物料', '名册如果有，可以打印', '查看') + goBtn('fk-go', 'b-fair', 'fkFair=' + f.id, '返回招聘会', '时间地点仍然可以查看', '返回'));
      } else {
        const zone = S().fkZone || '';
        const zones = [];
        companiesOf(f.id).forEach((c) => { if (zones.indexOf(c.zone) < 0) zones.push(c.zone); });
        const list = companiesOf(f.id).filter((c) => !zone || c.zone === zone);
        status = pill('场次与参展名单由主办方发布');
        const rows = list.length ? list.map((c) => '<button class="fk-card" data-go="b-fair-company" data-set="fkFair=' + f.id + ';fkCo=' + c.id + '"><div class="fk-h"><h3>' + c.name + '</h3><span class="fk-tag">' + c.booth + '</span></div><p class="fk-sub">' + c.industry + ' · ' + c.zone + ' · 在招 ' + c.jobs.length + ' 个岗位</p><p class="fk-sub">' + c.brief + '</p><p class="fk-fine">' + c.jobs.map((p) => p.title).join('、') + ' · 同步 ' + c.sync + '</p><em class="fk-fine">查看</em></button>').join('') : '<section class="fk-card"><h3>这个展区没有企业</h3><p class="fk-sub">换一个展区，或看全部。本机不把别的区的企业挪过来。</p></section>';
        body = '<button class="fk-search" data-act="toast" data-arg="演示：弹出屏上键盘">搜企业名、展位号或行业</button>'
          + '<div class="fk-chips"><button data-fk="zone" data-arg="" aria-pressed="' + (!zone) + '">全部展区</button>'
          + zones.map((z) => '<button data-fk="zone" data-arg="' + z + '" aria-pressed="' + (zone === z) + '">' + z + '</button>').join('') + '</div>'
          + '<p class="fk-fine">这场 ' + f.name + ' · 名单 ' + list.length + ' 家 · 来源 ' + f.sourceName + '</p>'
          + '<div class="fk-list">' + rows + '</div>'
          + boundary('名单以主办方回传为准；本机不代收简历，也不在平台内投递。');
      }
      return shell(bandOf('先看哪家参展企业', f.name + ' · 名单由主办方提供', status, '参展企业'), body, dock({ ask: '问小青：这家企业', pri: { label: '返回招聘会', go: 'b-fair' } }));
    },
    mount: (el) => bind(el, (act, arg) => {
      if (act === 'zone') S().fkZone = arg;
      else if (act === 'cos-retry') S().fkCos = '';
      else if (act === 'demo') S().fkCos = arg === 'empty' ? 'empty' : arg === 'err' ? 'error' : '';
      else return;
      refresh();
    }),
  });

  /* ---------- 7 参展企业详情 ---------- */
  add('b-fair-company', '参展企业详情', {
    notes: {
      does: '运行页 /job-fairs/:id/companies/:companyId（FairCompanyDetailPage.tsx:47）。展位、现场岗位、来源四项。岗位行是扫码投递和' + L.goApply + '，一体机上都打开二维码层。有企业简介时可去 b-company。',
      motion: '无循环动画。',
      keep: '来源不全时两个办理按钮置灰并写原因，不点了没反应。打印企业资料走 fair_company，运行页进 /print/desk?step=preview，稿上接到 preview。岗位清单同样进 preview。不在本机留下申请结果。',
    },
    render: () => {
      const f = curFair();
      const c = coBy();
      if (!c) {
        return shell(bandOf('这家企业没有返回', f.name, pill('主办方还没有提供名单'), '参展企业'), stateCards('名单里没有这家企业', ['回到名单重新选。'], goBtn('fk-go', 'b-fair-companies', 'fkFair=' + f.id, '返回参展企业列表', '按展区再找一家', '返回')), dock({ ask: '问小青：这家企业' }));
      }
      const noPos = !!S().fkNoPos;
      const sourceOk = !S().fkNoSrc && !!(c.host && c.path && c.externalId && c.sync);
      const jobs = noPos ? [] : c.jobs;
      const dis = sourceOk ? '' : ' aria-disabled="true"';
      const jobHtml = jobs.length ? jobs.map((p) => {
        return '<section class="fk-card"><div class="fk-h"><h3>' + p.title + '</h3><span>' + p.pay + '</span></div><p class="fk-fine">' + c.name + ' · 展位 ' + c.booth + '</p><div class="fk-duo"><button class="btn sec" data-fk="qr" data-arg="apply"' + dis + '>扫码投递</button><button class="btn pri" data-fk="qr" data-arg="apply"' + dis + '>' + L.goApply + '</button></div></section>';
      }).join('') : '<section class="fk-card"><h3>这家企业没有返回岗位清单</h3><p class="fk-sub">名单里有这家企业，但岗位清单是空的。本机不替它编现场岗位。到展位看岗位牌，不要把口头信息写成已经发布的岗位。</p></section>';
      const posDis = jobs.length ? '' : ' aria-disabled="true"';
      const body = '<div class="fk-list"><section class="fk-card"><div class="fk-h"><h3>' + c.name + '</h3><span class="fk-tag">' + c.booth + '</span></div>'
        + '<div class="fk-metrics"><div class="fk-metric"><b>' + c.booth + '</b><span>展位号</span></div><div class="fk-metric"><b>' + jobs.length + '</b><span>现场岗位</span></div><div class="fk-metric"><b>' + c.industry + '</b><span>所属行业</span></div><div class="fk-metric"><b>' + (sourceOk ? '已提供' : '未返回') + '</b><span>来源链接</span></div></div>'
        + '<p class="fk-sub">' + c.brief + '</p><p class="fk-fine">' + (sourceOk ? (c.zone + ' · ' + f.name) : ('来源链接没有返回，扫码投递和' + L.goApply + '先不能点。')) + '</p></section>'
        + '<section class="fk-card"><h3>信息来源</h3>' + kv([['来源机构', f.sourceName], ['同步时间', c.sync || '来源平台未提供'], ['外部 ID', c.externalId || '来源平台未提供'], ['来源链接', sourceOk ? c.host + c.path : '来源平台未提供'], ['来源说明', c.note]]) + '</section>'
        + jobHtml
        + '<div class="fk-split">'
        + goBtn('fk-go', 'b-company', 'fkCo=' + c.id, '查看企业资料', '简介、在招岗位和来源在企业页', '查看')
        + goBtn('fk-go', 'preview', '', '打印企业资料', '免检查，先看预览再定参数', '去预览')
        + '<button class="fk-go" data-go="preview"' + posDis + '><b>打印岗位清单</b><small>' + (jobs.length ? '按这家企业返回的岗位打印，先看预览' : '岗位清单是空的，这一份先不打') + '</small><em>' + (jobs.length ? '去预览' : '先不打') + '</em></button>'
        + '</div>'
        + boundary('本机不接收简历、不代投递。二维码按读到的来源链接生成，办完请关掉，别把账号留在这台机器上。') + '</div>';
      return shell(bandOf(c.name, '展位 ' + c.booth + ' · ' + f.venue, pill(sourceOk ? '可以扫码投递' : '暂不能扫码投递', sourceOk ? 0 : 1), '参展企业'), body, dock({ ask: '问小青：这家企业', pri: { label: '返回名单', go: 'b-fair-companies' } }), qrLayer());
    },
    mount: (el) => bind(el, (act, arg) => {
      if (act === 'qr') { if (!S().fkNoSrc) S().fkQr = arg; }
      else if (act === 'close') S().fkQr = '';
      else return;
      refresh();
    }),
  });

  /* ---------- 8 展位图 ---------- */
  add('b-fair-map', '展位图', {
    notes: {
      does: '运行页 /job-fairs/:id/map（FairMapPage.tsx:57）。有图时画展位图，fkNoMap 时只画展区索引。查看可打印导览资料去 b-fair-materials，查看企业详情去 b-fair-company。',
      motion: '无循环动画。色块是示意，不是实拍，也不在没有图时自己画一张路线。',
      keep: '空态：主办方没有提供展位图或展位索引，不放灰色占位。错误：这次没取到，不等于主办方没有提供。两条路都保留打印导览资料。',
    },
    demo: [
      { label: '演示：展位返回了', ev: 'ok' },
      { label: '演示：没有展位数据', ev: 'empty' },
      { label: '演示：展位没取到', ev: 'err' },
    ],
    render: () => {
      const f = curFair();
      const st = S().fkMap || '';
      if (st === 'loading') {
        return shell(bandOf('正在取展位', f.name, pill('正在取展位'), '展位分布'), stateCards('正在取展位', ['返回前不显示展位号。展位号错一位就会白跑，所以还没取到时先不显示。'], ''), dock({ ask: '问小青：展位怎么看', pri: { label: '查看可打印导览资料', go: 'b-fair-materials' } }));
      }
      if (st === 'error' || st === 'empty') {
        const bad = st === 'error';
        return shell(
          bandOf(bad ? '展位信息没取到' : '没有展位图或展位索引', f.name, pill(bad ? '展位信息没取到' : '没有展位图或展位索引', bad), '展位分布'),
          stateCards(bad ? '展位信息没取到' : '暂无场馆导览数据', bad ? ['取不到时先不显示。这不代表主办方没有提供，是这次没取到。'] : ['主办方没有提供展位图或展位索引。本机不放灰色占位，也不自己画一张示意图。'], (bad ? '<button class="btn sec" data-fk="map-retry">重新加载</button>' : '') + goBtn('fk-go', 'b-fair-companies', 'fkFair=' + f.id, '看参展名单', '到场前可以先按名单挑几家', '查看') + goBtn('fk-go', 'b-fair-materials', 'fkFair=' + f.id, '查看可打印导览资料', '纸质手册仍可能能打', '查看')),
          dock({ ask: '问小青：展位怎么看' }),
        );
      }
      const zones = zonesOf(f.id);
      const zid = S().fkZoneId || '';
      const zone = zones.find((z) => z.id === zid) || null;
      const shown = companiesOf(f.id).filter((c) => !zone || c.zone === zone.name);
      const zoneBlocks = '<div class="fk-map">' + zones.map((z) => {
        const names = companiesOf(f.id).filter((c) => c.zone === z.name).map((c) => c.name + ' ' + c.booth).join('、') || '示例名单里这一区还没有企业';
        return '<div class="fk-zone ' + z.cls + '"><b>' + z.hall + '</b><small>' + z.name + '</small><small>' + z.booths + ' 个展位 · ' + z.desc + '</small><small>' + names + '</small></div>';
      }).join('') + '</div>';
      const diagram = S().fkNoMap
        ? '<p class="fk-sub">主办方这次没有给展位图。下面是展区索引：展区名、厅位和展位数。这里不标推荐路线。</p>' + zoneBlocks
        : '<p class="fk-fine">主办方展位图，用色块标出展区。不是实拍，也不能当导航路线。</p>' + zoneBlocks;
      const body = '<section class="fk-card fk-mapcard"><h3>' + f.venue + '</h3><p class="fk-fine">' + f.address + ' · ' + f.traffic + '</p>' + diagram + '<div class="fk-chips"><button data-fk="zoneid" data-arg="" aria-pressed="' + (!zone) + '">全部展区</button>' + zones.map((z) => '<button data-fk="zoneid" data-arg="' + z.id + '" aria-pressed="' + (zone && zone.id === z.id) + '">' + z.name + '</button>').join('') + '</div></section>'
        + '<div class="fk-list">' + (shown.length ? shown.map((c) => '<button class="fk-card" data-go="b-fair-company" data-set="fkFair=' + f.id + ';fkCo=' + c.id + '"><div class="fk-h"><h3>' + c.name + '</h3><span class="fk-tag">' + c.booth + '</span></div><p class="fk-sub">' + c.zone + ' · ' + c.industry + '</p><p class="fk-fine">' + c.brief + ' 在招 ' + c.jobs.map((p) => p.title).join('、') + '</p><em class="fk-fine">查看企业详情</em></button>').join('') : '<section class="fk-card"><h3>这一区还没有企业</h3><p class="fk-sub">换一个展区，或看全部。本机不把别的区的企业挪过来。</p></section>') + '</div>'
        + boundary('有主办方给的图或展位号才显示。本机不标推荐路线。');
      return shell(bandOf(S().fkNoMap ? '按展区找' : '展位在哪一块', f.name + ' · ' + f.venue, pill(S().fkNoMap ? '没有展位图，只有展区索引' : '主办方提供了展位图'), '展位分布'), body, dock({ ask: '问小青：展位怎么看', pri: { label: '查看可打印导览资料', go: 'b-fair-materials' } }));
    },
    mount: (el) => bind(el, (act, arg) => {
      if (act === 'zoneid') S().fkZoneId = arg;
      else if (act === 'map-retry') S().fkMap = '';
      else if (act === 'demo') S().fkMap = arg === 'empty' ? 'empty' : arg === 'err' ? 'error' : '';
      else return;
      refresh();
    }),
  });

  /* ---------- 9 资料打印 ---------- */
  add('b-fair-materials', '资料打印', {
    notes: {
      does: '运行页 /job-fairs/:id/materials（FairMaterialsPage.tsx:70）。资料名、类型、打印。POST …/print-url 成功后 useStartPrintHandoff，来源 fair_material 免隐私检查，入口是 /print/confirm。稿上接到 confirm。',
      motion: '无循环动画。打印失败不自动重试成功。',
      keep: '看参展名单去 b-fair-companies，返回招聘会去 b-fair。空态可去打印自己的材料（print-src）。链接过期与这次没取到分成两种说法。不可打印的资料只写「该资料暂不开放打印」，不给一个点了没反应的按钮。现成核对页的文件名不读本区状态，会显示打印流自己的示例文件名。',
    },
    demo: [
      { label: '演示：物料返回了', ev: 'ok' },
      { label: '演示：还没有物料', ev: 'empty' },
      { label: '演示：物料没取到', ev: 'err' },
      { label: '演示：链接过期了', ev: 'expired' },
      { label: '演示：打印链接没准备好', ev: 'fail' },
    ],
    render: () => {
      const f = curFair();
      const st = S().fkMat || '';
      const foot = '<footer class="dock">' + dockBack('返回招聘会', 'b-fair', 'fkFair=' + f.id) + dockAsk('问小青：打印哪一份') + '<button class="btn pri" data-go="b-fair-companies" data-set="fkFair=' + f.id + '">看参展名单' + icon('arrowR', 30, 2.4) + '</button></footer>';
      if (st === 'loading') {
        return shell(bandOf('正在取活动物料', '未返回前不显示份数', pill('正在取活动物料'), '活动物料'), stateCards('正在取活动物料', ['未返回前不显示文件名和页数。'], ''), foot);
      }
      if (st === 'fail') {
        return shell(bandOf('这次打印没有成功', '打印文件必须读到真实链接', pill('这次打印没有成功', 1), '活动物料'), stateCards('这次打印没有成功', ['打印链接没有准备好。回到列表可以再试一次，不会在这一页假装已经出纸。'], '<button class="btn sec" data-fk="mat-back">回到物料列表</button>' + helpLine()), foot);
      }
      if (st === 'error' || st === 'expired') {
        const exp = st === 'expired';
        return shell(
          bandOf(exp ? '物料链接已过期' : '活动物料这次没取到', f.name, pill(exp ? '物料链接已过期' : '活动物料这次没取到', 1), '活动物料'),
          stateCards(exp ? '物料链接已过期' : '活动物料这次没取到', exp ? ['限时链接过了有效期。重新获取一次，内容还是主办方那一份，不能用旧链接直接打。'] : ['这次没有取到列表。不是链接过期，重新加载若仍失败，就不要当成同一份文件还能打。'], '<button class="btn sec" data-fk="mat-retry">重新加载</button>' + goBtn('fk-go', 'print-src', '', '打印你自己的材料', '简历和证件材料照常可以打', '去打印')),
          foot,
        );
      }
      const mats = st === 'empty' ? [] : matsOf(f.id);
      if (!mats.length) {
        return shell(bandOf('这场还没有可下载的物料', f.name, pill('这场还没有可下载的物料'), '活动物料'), stateCards('这场还没有可下载的物料', ['主办方还没有上传可打印的文件。可以先看参展名单，或打印自己的简历。'], goBtn('fk-go', 'b-fair-companies', 'fkFair=' + f.id, '看参展名单', '名单是另一页', '查看') + goBtn('fk-go', 'print-src', '', '打印你自己的材料', '简历、证件材料照常可以打', '去打印')), foot);
      }
      const list = mats.map((m) => {
        const act = m.print ? '<button class="btn pri" data-go="confirm">打印</button>' : '<span class="fk-tag slate">该资料暂不开放打印</span>';
        return '<section class="fk-file"><div class="fk-fileic">' + UI.scanPaper(112) + '</div><div class="tx"><b>' + m.name + '</b><small>' + m.type + ' · ' + m.pages + ' 页 · ' + m.size + '</small><small>主办方上传的文件</small></div>' + act + '</section>';
      }).join('');
      const body = '<div class="fk-files">' + list + '</div>'
        + sourceBlock(f).replace('<section class="fk-card">', '<section class="fk-card fk-src">')
        + boundary('资料由主办方上传。可打印的进入核对；份数和单双面在打印页选，费用以下单时报价为准。链接过期后要重新获取。');
      return shell(bandOf('要打印哪一份资料', '下载链接临时有效', pill('场次与参展名单由主办方发布'), '活动物料'), body, foot);
    },
    mount: (el) => bind(el, (act, arg) => {
      if (act === 'mat-retry' || act === 'mat-back') S().fkMat = '';
      else if (act === 'demo') S().fkMat = arg === 'ok' ? '' : arg;
      else return;
      refresh();
    }),
  });

  /* ---------- 10 AI 参会准备 ---------- */
  function planExits(f) {
    const item = (go, ic, title, desc, em) => '<button class="fk-go" data-go="' + go + '" data-set="fkFair=' + f.id + '"><span class="ic">' + icon(ic, 34, 2) + '</span><b>' + title + '</b><small>' + desc + '</small><em>' + em + '</em></button>';
    return item('b-fair-companies', 'landmark', '看参展名单', '名单和 AI 清单是两条线', '查看')
      + item('b-fair-map', 'map', '看展位索引', '按展位号自己排顺序', '查看')
      + item('b-fair-materials', 'printer', '打印活动资料', '纸质名单不经过 AI', '打印');
  }
  function planManual(f, top) {
    const rows = companiesOf(f.id).map((c) => '<button class="fk-co" data-go="b-fair-company" data-set="fkFair=' + f.id + ';fkCo=' + c.id + '"><b>' + c.booth + ' · ' + c.name + '</b><small>' + c.industry + ' · ' + c.zone + '</small><small>' + c.brief + '</small><small>在招 ' + c.jobs.map((p) => p.title).join('、') + '</small></button>').join('');
    return '<div class="fk-plan-hug">' + top + '<section class="fk-card"><h3>这场可以先看的企业</h3><p class="fk-fine">' + f.start + ' · ' + f.venue + ' · 名单不经过 AI</p><div class="fk-cos">' + rows + '</div></section><div class="fk-split fk-exits">' + planExits(f) + '</div></div>';
  }
  add('b-fair-plan', 'AI 参会准备', {
    notes: {
      does: '运行页 /job-fairs/:id/visit-plan（FairVisitPlanPage.tsx:99）。未结束是 AI 参会准备单，已结束或 fkEnded 是 AI 参会回顾。要登录，要本人简历。生成中等演示事件 plan-done / plan-fail，屏上不自己跳到成功。',
      motion: '无循环动画。不倒计时演完自动成功。',
      keep: 'AI 生成的清单标「AI 生成，仅供参考」。小青不可用时写明名单、展位、资料打印不经过 AI（FairVisitPlanPage.tsx:269、337）。打印准备单在打印版生成后进 /print/confirm（来源 fair_visit_plan，免检查），稿上接到 confirm。没有简历去 resume。未登录去 login。',
    },
    demo: [
      { label: '演示：开始生成', ev: 'plan-wait' },
      { label: '演示：生成好了', ev: 'plan-done' },
      { label: '演示：生成失败', ev: 'plan-fail' },
    ],
    render: () => {
      const f = curFair();
      const review = !!S().fkEnded || f.status === 'ended';
      const title = review ? 'AI 参会回顾' : 'AI 参会准备单';
      const gen = review ? '生成参会回顾' : '生成参会准备单';
      const plan = S().fkPlan || '';
      const down = S().ai === 'down';
      let body, status, pri = null;
      if (plan === 'gen') {
        status = pill('已提交，等结果返回');
        body = stateCards('已提交，等结果返回', ['生成不保证成功。失败会说明原因，不会给一份空清单。', '这一页不会自己跳到完成。'], goBtn('fk-go', 'b-fair', 'fkFair=' + f.id, '返回招聘会', '可以先去看时间地点', '返回'));
      } else if (down && plan !== 'ready') {
        status = pill('AI 不可用，浏览与打印不受影响', 1);
        body = planManual(f, '<section class="fk-card fk-lock"><h3>小青暂时不能生成' + (review ? '回顾' : '准备单') + '</h3><p class="fk-sub">AI 不可用不影响你逛名单、查展位和打印资料。这三件事不经过 AI。</p><p class="fk-fine">等小青恢复后，仍要先登录并确认本人简历，才会重新出现生成。</p>' + helpLine() + '</section>');
      } else if (!S().logged) {
        status = pill('先登录并准备好简历', 1);
        body = planManual(f, '<section class="fk-card fk-lock"><h3>先登录，才能生成' + (review ? '回顾' : '准备单') + '</h3><p class="fk-sub">要用本人简历和这场的参展企业。名单、展位和资料打印不需要 AI，也不看登录状态。</p><button class="btn pri" data-go="login">去登录</button></section>');
      } else if (S().fkNoResume && plan !== 'ready') {
        status = pill('先登录并准备好简历', 1);
        body = planManual(f, '<section class="fk-card fk-lock"><h3>' + (review ? '先上传简历，再生成参会回顾' : '先上传简历，再生成参会准备单') + '</h3><p class="fk-sub">本机还没有确认过本人简历。简历文件名要等你在简历页选中之后才有，这里不编一个名字。</p>' + goBtn('fk-go', 'resume', '', '选择本人简历', '从已有简历里确认是本人的那份', '去选') + '</section>');
        pri = { label: '选择本人简历', go: 'resume' };
      } else if (plan === 'fail') {
        status = pill('本次生成失败', 1);
        body = stateCards('这次没有生成', ['生成未完成。可以再试一次，或换一份简历。不会留下一份空清单当作结果。'], '<button class="btn sec" data-fk="gen">再试一次</button>' + goBtn('fk-go', 'resume', '', '换一份简历再试', '回到简历页重新确认', '去简历') + '<div class="fk-split">' + planExits(f) + '</div>');
      } else if (plan === 'ready') {
        status = pill('清单已经生成');
        const cos = companiesOf(f.id);
        const names = cos.map((c) => c.name);
        const prep = review
          ? [
              '对照来源平台看这几家是否还在招，再决定要不要重新准备材料。',
              '本机没有你在这场招聘会打开来源投递入口的记录。',
              '下次可先问到岗城市、是否接收本届、展位当天是否还在。',
              '本系统不记录你是否到场，也不记录你在现场取得的材料；以下内容仅基于本机记录的浏览与跳转行为，以及该场招聘会的公开信息。',
            ]
          : [
              '带上本人简历的纸质版，页数以你确认的那份为准。',
              '先按展位号看 ' + (names[0] || '第一家') + '，再决定下一家。本机不排路线。',
              '问清到岗城市和是否接收本届。回答以来源平台和现场为准。',
              '现场提醒：' + f.services + '。' + f.traffic,
              '本场看点：' + f.venue + '，' + f.companies + ' 家企业，' + f.jobs + ' 个岗位。',
            ];
        body = '<div class="fk-planbox"><section class="fk-card fk-lock"><div class="fk-h"><h3>' + (review ? '仍可继续跟进的企业' : '现场优先了解的企业') + '</h3><span class="fk-ai">AI 生成，仅供参考</span></div><p class="fk-fine">' + (review ? '按与简历方向的匹配来排。是否仍在招聘以来源平台为准。' : '按与简历方向的匹配来排，不是入场顺序。') + '</p><div class="fk-col">'
          + names.map((n, i) => '<div class="fk-row"><div class="tx"><b>' + (i + 1) + ' ' + n + '</b><small>' + cos[i].booth + ' · ' + cos[i].industry + ' · ' + cos[i].brief + '</small></div></div>').join('')
          + '</div></section><section class="fk-card"><div class="fk-h"><h3>' + (review ? '后续可做的跟进' : '参会前准备') + '</h3><span class="fk-ai">AI 生成，仅供参考</span></div><div class="fk-rows">'
          + prep.map((t) => '<div class="fk-row"><div class="tx"><b>' + t + '</b></div></div>').join('')
          + '</div>' + kv([['使用的简历', '本人在本机确认的简历（文件名没有一并返回）'], ['参展名单版本', f.companies + ' 家企业 / ' + f.jobs + ' 个岗位'], ['是否已保存', '以实际记录为准，本页不代为确认']])
          + '</section></div>';
        pri = { label: review ? '打印回顾' : '打印准备单', go: 'confirm' };
      } else {
        status = pill('简历已确认，还没有生成过清单');
        body = planManual(f, '<section class="fk-card fk-lock"><h3>' + (review ? '这场已结束，可以生成回顾' : '简历已确认，还没有准备单') + '</h3><p class="fk-sub">' + (review ? '该场招聘会已结束，以下为后续跟进参考。' : '基于本人简历与本场公开信息生成。') + ' 生成不保证成功。</p><p class="fk-fine">使用 AI 即表示你已年满 14 周岁。没有生成也可以逛。</p><button class="btn pri" data-fk="gen">' + gen + '</button></section>');
      }
      return shell(bandOf(title, review ? '该场招聘会已结束，以下为后续跟进参考' : '基于本人简历与本场招聘会公开信息', status, '参会准备'), body, dock({ ask: '问小青：准备单怎么用', pri: pri }), '');
    },
    mount: (el) => bind(el, (act, arg) => {
      if (act === 'gen') {
        if (S().ai === 'down') S().fkPlan = '';
        else S().fkPlan = 'gen';
      } else if (act === 'demo') {
        if (arg === 'plan-wait') { if (S().logged && !S().fkNoResume) S().fkPlan = 'gen'; }
        else if (arg === 'plan-done') { if (S().logged && !S().fkNoResume) S().fkPlan = 'ready'; }
        else if (arg === 'plan-fail') S().fkPlan = 'fail';
      } else return;
      refresh();
    }),
  });

  /* ---------- 11 现场数据 ---------- */
  add('b-fair-stats', '现场数据', {
    notes: {
      does: '运行页 /job-fairs/:id/stats（FairStatsPage.tsx:52）。企业数、岗位数、预计人数、行业分布。签到和服务行为没有回传时写空态原句。',
      motion: '无循环动画。',
      keep: '数值由主办方回传，本机不估算。空态「主办方还没有回传统计」。签到块原句「暂无统计 · 未接入可证明的服务数据源。」以及「没有回传就显示为空，不会拿估算值补上。」看参展名单、活动物料、返回招聘会都在。',
    },
    demo: [
      { label: '演示：统计返回了', ev: 'ok' },
      { label: '演示：还没有回传', ev: 'empty' },
      { label: '演示：统计没取到', ev: 'err' },
    ],
    render: () => {
      const f = curFair();
      const st = S().fkSt || '';
      if (st === 'loading') {
        return shell(bandOf('正在取现场统计', f.name, pill('正在取现场统计'), '现场统计'), stateCards('正在取现场统计', ['返回前不显示企业数和岗位数，也不用 0 代替还没回传的数字。'], ''), dock({ ask: '问小青：这些数怎么来' }));
      }
      if (st === 'error' || st === 'empty') {
        const bad = st === 'error';
        return shell(
          bandOf(bad ? '统计数据没取到' : '主办方还没有回传统计', f.name, pill(bad ? '统计数据没取到' : '主办方还没有回传统计', bad), '现场统计'),
          stateCards(bad ? '统计数据没取到' : '主办方还没有回传统计', bad ? ['这次没有读到。不沿用上一次的数字。'] : ['没有回传就显示为空，不会拿估算值补上。'], (bad ? '<button class="btn sec" data-fk="st-retry">重新加载</button>' : '') + goBtn('fk-go', 'b-fair-companies', 'fkFair=' + f.id, '看参展名单', '名单是另一页，可能还能打开', '查看') + goBtn('fk-go', 'b-fair', 'fkFair=' + f.id, '返回招聘会', '时间、地点与来源还在', '返回')),
          dock({ ask: '问小青：这些数怎么来' }),
        );
      }
      const ind = INDUSTRY[f.id] || [];
      const max = ind.reduce((m, r) => Math.max(m, r[1]), 1);
      const bars = ind.map((r) => '<div class="fk-bar"><span>' + r[0] + '</span><i style="--p:' + Math.round(r[1] / max * 100) + '%"></i><span>' + r[1] + ' 家</span></div>').join('');
      const body = '<div class="fk-metrics"><div class="fk-metric"><b>' + f.companies + '</b><span>参展单位</span></div><div class="fk-metric"><b>' + f.jobs + '</b><span>提供岗位</span></div><div class="fk-metric"><b>' + f.head + '</b><span>计划招聘</span><small>人，主办方回传</small></div><div class="fk-metric"><b>' + f.expect + '</b><span>主办方预计参会</span><small>人</small></div></div>'
        + '<div class="fk-list"><section class="fk-card"><h3>这些数字是怎么来的</h3><p class="fk-sub">全部来自主办方回传的统计。本机不做人流统计、不接摄像头，也不按签到推算。没有回传就显示为空，不会拿估算值补上。</p>' + kv([['提供方', '主办方回传'], ['怎么算', '按主办方回传的规则；本机不重新计算'], ['更新时间', f.sync], ['这场', f.name + ' · ' + f.venue]]) + '</section>'
        + '<section class="fk-card fk-nosign"><div class="fk-ill">' + UI.checklist(132) + '</div><div><div class="fk-h"><h3>签到人数</h3><span>不含个人信息</span></div><p class="fk-sub">签到人数：来源平台没有回传，这里不显示。</p><p class="fk-fine">打开二维码不等于已经签到。这台机器没有留下这场的服务记录。</p></div></section>'
        + '<section class="fk-card"><div class="fk-h"><h3>参展企业行业分布</h3><span>按已录 ' + f.companies + ' 家</span></div><div class="fk-bars">' + bars + '</div><p class="fk-fine">行业名称来自主办方名单上的分类，本机不合并、不改名。</p></section></div>'
        + '<div class="fk-split">' + goBtn('fk-go', 'b-fair-companies', 'fkFair=' + f.id, '看参展名单', '数字背后的单位清单', '查看') + goBtn('fk-go', 'b-fair-materials', 'fkFair=' + f.id, '看活动物料', '主办方的总结材料如果有，也在这里', '查看') + '</div>'
        + boundary('数值由主办方提供。活动办理结果以来源平台和现场为准。');
      return shell(bandOf('这场的现场数字', f.name + ' · 主办方回传', pill('数值由主办方提供'), '现场统计'), body, dock({ ask: '问小青：这些数怎么来', pri: { label: '返回招聘会', go: 'b-fair' } }));
    },
    mount: (el) => bind(el, (act, arg) => {
      if (act === 'st-retry') S().fkSt = '';
      else if (act === 'demo') S().fkSt = arg === 'empty' ? 'empty' : arg === 'err' ? 'error' : '';
      else return;
      refresh();
    }),
  });

  /* ---------- 12 招聘会签到 ---------- */
  function checkinFairs() { return FAIRS.filter((f) => f.checkin && f.status !== 'ended'); }
  add('b-fair-checkin', '招聘会签到', {
    notes: {
      does: '运行页 /job-fairs/checkin（JobFairCheckinPage.tsx:120）。只列进行中或即将开始、且带来源入场链接的场次。二维码、路线说明。按钮是扫码签到、查看详情、查看招聘会。',
      motion: '无循环动画。',
      keep: '运行页原句：本机不做签到，也拿不到签到结果。这里只列出有入场入口的场次，不查个人预约记录。扫码说明：请使用手机扫码前往来源平台签到。本系统不记录签到结果，请以来源平台显示为准。来源四项不全时扫码签到仍在，但置灰且不出码（fkBadTrust，缺外部 ID）。已结束的场次不进这张列表。',
    },
    demo: [
      { label: '演示：入场入口返回了', ev: 'ok' },
      { label: '演示：没有入场入口', ev: 'empty' },
      { label: '演示：列表没取到', ev: 'err' },
    ],
    render: () => {
      const st = S().fkIn || '';
      if (st === 'loading') {
        return shell(bandOf('正在取入场入口', '返回前不显示哪一场有码', pill('正在取入场入口'), '到场指引'), stateCards('正在取入场入口', ['不显示缓存二维码，也不判断预约或签到状态。'], ''), dock({ ask: '问小青：怎么签到', pri: { label: '查看招聘会', go: 'b-fairs' } }));
      }
      if (st === 'error') {
        return shell(bandOf('入场入口列表这次没取到', '所以无法判断哪些场次有码', pill('入场入口列表这次没取到', 1), '到场指引'), stateCards('入场入口列表这次没取到', ['招聘会列表这次没读到。本机不显示缓存二维码，也不判断你的预约或签到状态。'], '<button class="btn sec" data-fk="in-retry">重新加载</button>' + goBtn('fk-go', 'b-fairs', 'bFairTheme=', '回场次列表', '换一场看看时间地点', '查看招聘会') + goBtn('fk-go', 'print-src', '', '先去打印简历', '参数在打印页选', '去打印')), dock({ ask: '问小青：怎么签到' }));
      }
      const list = st === 'empty' ? [] : checkinFairs();
      if (!list.length) {
        return shell(bandOf('暂无开放入场二维码的场次', '已结束或没有入场链接的场次不在这里', pill('暂无开放入场二维码的场次'), '到场指引'), stateCards('暂无开放入场二维码的场次', ['本机不做签到，也拿不到签到结果。没有链接的场次不会编一个码。'], goBtn('fk-go', 'b-fairs', 'bFairTheme=', '查看招聘会', '先看时间地点和参展名单', '查看招聘会') + goBtn('fk-go', 'print-src', '', '先去打印简历', '材料可以提前准备', '去打印')), dock({ ask: '问小青：怎么签到' }));
      }
      const cards = list.map((f) => {
        const blocked = !!S().fkBadTrust && f.id === list[0].id;
        const ext = blocked ? '来源平台未提供' : f.externalId;
        const why = blocked ? '<p class="fk-fine">缺外部 ID。来源对不上这场，先不出码。</p>' : '';
        return '<section class="fk-card"><div class="fk-h"><h3>' + f.name + '</h3><span class="fk-tag' + (f.status === 'ongoing' ? '' : ' wheat') + '">' + statusLabel(f.status, false) + '</span></div>'
          + kv([['时间', f.start], ['地点', f.city + ' · ' + f.venue], ['来源', f.sourceName], ['外部 ID', ext], ['同步', f.sync]])
          + '<p class="fk-sub">路线：' + f.traffic + '</p><p class="fk-sub">' + f.admit + '</p>' + why
          + '<p class="fk-fine">请使用手机扫码前往来源平台签到。本系统不记录签到结果，请以来源平台显示为准。</p>'
          + '<div class="fk-duo"><button class="btn pri" data-fk="open-qr" data-arg="' + f.id + '"' + (blocked ? ' aria-disabled="true"' : '') + '>扫码签到</button>' + goBtn('fk-go', 'b-fair', 'fkFair=' + f.id, '查看详情', '时间地点和五个入口', '查看') + '</div></section>';
      }).join('');
      const body = '<p class="fk-sub"><b>本机不做签到，也拿不到签到结果。</b>这里只列出进行中或即将开始、且来源平台提供了入场入口的场次；不查个人预约记录。</p><div class="fk-list">' + cards + '</div>' + boundary('来源平台负责预约、签到与凭证，本机只提供对应场次的来源入口。');
      return shell(bandOf('哪一场可以扫码签到', '本机不做签到，也拿不到签到结果；这一页只帮你找凭证、讲清路线', pill(S().fkQr === 'checkin' ? '来源入场码已就绪' : '本机不做签到，只给到场指引', 1), '到场指引'), body, dock({ ask: '问小青：怎么签到', pri: { label: '查看招聘会', go: 'b-fairs' } }), qrLayer());
    },
    mount: (el) => bind(el, (act, arg) => {
      if (act === 'open-qr') {
        const first = checkinFairs()[0];
        if (S().fkBadTrust && first && arg === first.id) return;
        S().fkFair = arg; S().fkQr = 'checkin';
      }
      else if (act === 'close') S().fkQr = '';
      else if (act === 'in-retry') S().fkIn = '';
      else if (act === 'demo') { S().fkIn = arg === 'empty' ? 'empty' : arg === 'err' ? 'error' : ''; if (arg === 'ok') S().fkQr = ''; }
      else return;
      refresh();
    }),
  });

  if (window.SCREEN_GROUPS.indexOf(GROUP) < 0) window.SCREEN_GROUPS.push(GROUP);
})();
