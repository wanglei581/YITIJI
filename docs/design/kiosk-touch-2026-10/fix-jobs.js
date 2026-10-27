/* fix-jobs.js：私有化部署（b）版「社会招聘」各屏。一律 bOnly。类名前缀 fj-。
   屏上避开按钮禁词子串（收简历 / 投简历 / 一键投递 / 立即投递 / 平台投递 / 候选人 / 在线投递）。
   运行页边界原句写在各屏 notes 里，合并时可逐字换回。 */
(function () {
  const { icon, band, dock, nav, qr } = UI;
  const S = () => window.S;
  const refresh = () => window.__proto.refresh();
  const F = (o) => {
    let html = (o.band ? band(o.band) : '') + (o.pre || '') + `<main class="body fj ${o.cls || ''}">${o.body}</main>` + (o.dock === false ? '' : dock(o.dock || {})) + (o.nav === false ? '' : nav(o.nav));
    if (o.dock !== false) html = html.replace('<footer class="dock">', '<footer class="dock fj-dock">');
    return html;
  };
  const add = (id, group, name, def) => window.SCREENS.push(Object.assign({ id, group, name, bOnly: true }, def));
  const G = '私有化版 · 社会招聘';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const HELP = '需要帮助？拨打服务电话 183-6916-1921';
  const HELP_NOTE = '号码与服务时间从后台读，读不到不显示。';
  const AI_MARK = 'AI 生成，仅供参考';
  const AGE = '使用 AI 即表示你已年满 14 周岁';
  const NO_SHARE = '选择一份本人已完成诊断的简历，从当前真实岗位中给出参考等级和理由；不向企业共享简历。';
  /* 屏上边界。notes 里保留运行页原句。 */
  const B_JOBS = '岗位与招聘会仅展示第三方或官方来源；本终端仅展示与跳转，不代收简历。';
  const B_LIST = '本机不代收简历、不代投递。岗位由来源平台发布，投递在来源平台完成。';
  const B_OFF = '本机只做机构信息展示、门店指引和材料打印：不代收简历、不代投递，也不记录你到店后的结果。';
  const B_CO = '本机只做来源企业与岗位导览：不收简历、不做筛选、不安排面试，投递在来源平台完成。';
  const SRC_NOTE = '信息来自第三方或官方来源平台，以来源平台原文为准。';
  const TRUST = '来源核验只说明该机构是否被允许在本系统发布信息，不构成本平台对该岗位真实性的背书。';
  const APPLY_MISS = '该来源未提供可用的投递链接，请到来源平台查询该职位';
  const PHONE = '183-6916-1921';

  const css = document.createElement('style');
  css.id = 'fj-style';
  css.textContent = `
.body.fj{justify-content:flex-start;gap:10px;padding:12px 40px 10px}
.fj-g2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.fj-span{grid-column:1/-1}
.fj-doors{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(4,minmax(0,1fr));gap:12px}
.fj-door{display:flex;align-items:center;gap:16px;min-height:0;min-width:0;padding:16px 18px;border-radius:28px;background:var(--card);border:1.5px solid var(--edge);text-align:left}
.fj-door .ic{width:96px;height:96px;border-radius:28px;background:var(--teal-wash);color:var(--teal-ink);display:grid;place-items:center;flex:none}
.fj-door .ic.slate{background:var(--slate-wash);color:var(--slate-ink)}
.fj-door .ic.clay{background:var(--clay-wash);color:var(--clay-ink)}
.fj-door .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.fj-door b{font:700 32px/1.25 var(--serif)}
.fj-door small{font-size:22px;line-height:1.4;color:var(--ink-2);font-weight:500}
.fj-door .chev{flex:none;color:var(--ink-3)}
.fj-hubhint{margin:0;font-size:22px;line-height:1.35;color:var(--ink-2);text-align:left}
.fj-ag,.fj-co{gap:10px}
.fj-facts{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.fj-facts .fj-kv{min-height:108px;padding:12px 14px}
.fj-facts .fj-kv b{font-size:24px;line-height:1.3}
.fj-co .fj-facts .fj-kv{min-height:80px;padding:8px 12px}
.fj-empty2{display:flex;flex-direction:column;gap:8px}
.fj-empty2 .fj-jobbig{min-height:172px;align-items:center}
.fj-jobbig{width:100%;min-height:0;display:flex;align-items:flex-start;gap:14px;padding:14px 16px;border-radius:24px;background:var(--card);border:1.5px solid var(--edge);text-align:left}
.fj-jobbig .ic{width:72px;height:72px;border-radius:20px;background:var(--teal-wash);color:var(--teal-ink);display:grid;place-items:center;flex:none}
.fj-jobbig b{display:block;font-size:26px;line-height:1.3}
.fj-jobbig small{display:block;font-size:20px;line-height:1.35;color:var(--ink-2)}
.fj-visit{display:grid;grid-template-columns:1fr;gap:8px}
.fj-visit div{padding:14px 16px;border-radius:22px;background:var(--well);text-align:left}
.fj-ul{margin:2px 0 0;padding-left:1.15em}
.fj-ul li{font-size:22px;line-height:1.4;color:var(--ink-2)}
.fj-visit b{display:block;font-size:24px;line-height:1.35}
.fj-visit small{display:block;margin-top:4px;font-size:20px;line-height:1.4;color:var(--ink-2)}
.fj-skel{display:flex;flex-direction:column;gap:8px}
.fj-skel i{display:flex;align-items:center;min-height:88px;padding:0 16px;border-radius:18px;background:var(--well);font-style:normal;font-size:22px;font-weight:700;color:var(--ink-3)}
.fj-card{background:var(--card);border:1.5px solid var(--edge);border-radius:24px;padding:12px 14px;text-align:left;min-width:0}
.fj-grow{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}
.fj-grow>.fj-card{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}
.fj h2,.fj-h{margin:0;font:700 28px/1.25 var(--serif);text-align:left}
.fj-sub{margin:0;font-size:20px;line-height:1.35;color:var(--ink-2);text-align:left}
.fj-note{margin:0;font-size:20px;line-height:1.4;color:var(--ink-2);text-align:left}
.fj-k{font-size:20px;color:var(--ink-3);font-weight:500}
.fj-chips{display:flex;flex-wrap:wrap;gap:8px}
.fj-chips button,.fj-mini{min-height:64px;min-width:64px;padding:0 16px;border-radius:18px;background:var(--card);border:1.5px solid var(--edge);font-size:22px;font-weight:700}
.fj-chips button[aria-pressed="true"]{background:var(--deep);color:var(--cream);border-color:var(--deep)}
.fj-tool{display:flex;gap:8px;align-items:stretch}
.fj-search{flex:1;min-height:64px;display:flex;align-items:center;gap:10px;padding:0 16px;border-radius:18px;background:var(--card);border:1.5px solid var(--edge);font-size:22px;font-weight:700;color:var(--ink-2);text-align:left}
.fj-meta{margin:0;font-size:20px;line-height:1.35;color:var(--ink-2);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.fj-row{display:flex;gap:8px;align-items:stretch}
.fj-main{flex:1;min-width:0;min-height:96px;display:flex;flex-direction:column;justify-content:center;gap:2px;padding:8px 12px;border-radius:20px;background:var(--card);border:1.5px solid var(--edge);text-align:left}
.fj-main b{font-size:24px;line-height:1.25}
.fj-main small{font-size:20px;line-height:1.3;color:var(--ink-2)}
.fj-fav{flex:none;min-width:88px;min-height:64px;padding:0 10px;border-radius:18px;background:var(--well);font-size:20px;font-weight:700}
.fj-fav[aria-pressed="true"]{background:var(--deep);color:var(--cream)}
.fj-kvs{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.fj-kvs.four{grid-template-columns:repeat(4,1fr)}
.fj-kv{min-height:64px;padding:8px 10px;border-radius:16px;background:var(--well);text-align:left;display:flex;flex-direction:column;justify-content:center}
.fj-kv b{font-size:22px;line-height:1.25;font-weight:700}
.fj-kv small{font-size:20px;color:var(--ink-3)}
.fj-cols{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.fj-kvs.stretch{flex:1;grid-auto-rows:1fr}
.fj-kvs.stretch .fj-kv{min-height:72px}
.fj-acts.three{grid-template-columns:1fr 1fr 1fr}
.fj-acts.three button,.fj-acts.three .fj-link{min-height:64px;font-size:20px}
.fj-cols ul{margin:4px 0 0;padding-left:1.1em}
.fj-cols li{font-size:20px;line-height:1.35;color:var(--ink-2)}
.fj-warn{margin:0;padding:8px 12px;border-radius:16px;background:var(--clay-wash);color:var(--clay-ink);font-size:20px;line-height:1.35;font-weight:700;text-align:left}
.fj-ai{margin:0;padding:8px 12px;border-radius:16px;background:var(--teal-wash);color:var(--teal-ink);font-size:20px;line-height:1.35;text-align:left}
.fj-acts{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.fj-acts button,.fj-link{min-height:72px;padding:8px 12px;border-radius:18px;background:var(--card);border:1.5px solid var(--edge);text-align:left;font-size:22px;font-weight:700}
.fj-acts small,.fj-link small{display:block;font-size:20px;font-weight:500;color:var(--ink-3);line-height:1.3}
.fj-link{display:flex;flex-direction:column;justify-content:center}
button[aria-disabled="true"],.fj-dead{opacity:.45}
.fj-pager{display:flex;gap:8px;align-items:center}
.fj-pager button{min-height:64px;min-width:96px;padding:0 14px;border-radius:16px;background:var(--well);font-size:20px;font-weight:700}
.fj-pager button[disabled]{opacity:.42}
.fj-tag{display:inline-block;margin-left:6px;padding:0 8px;border-radius:8px;background:var(--teal-wash);color:var(--teal-ink);font-size:20px;font-weight:700}
.fj-tag.clay{background:var(--clay-wash);color:var(--clay-ink)}
.fj-tag.slate{background:var(--slate-wash);color:var(--slate-ink)}
.overlay .fj-sheet{width:960px;max-height:1500px;overflow:auto;border-radius:32px;background:var(--paper);padding:22px 22px 18px;display:flex;flex-direction:column;gap:10px;text-align:left;align-items:stretch}
.fj-sheet h2{font:700 36px/1.25 var(--serif);margin:0}
.fj-sheet .fj-rowbtns{display:flex;gap:10px}
.fj-sheet .fj-rowbtns .btn{flex:1}
.fj-qrbox{display:flex;gap:16px;align-items:center}
.fj-qrbox .fj-cap{flex:1;display:flex;flex-direction:column;gap:6px}
.fj-host{font:700 28px/1.3 var(--serif)}
.fj-steps{margin:0;padding-left:1.2em}
.fj-steps li{font-size:22px;line-height:1.35}
.fj-metric{display:flex;gap:8px}
.fj-metric span{flex:1;min-height:72px;padding:8px 10px;border-radius:16px;background:var(--well);display:flex;flex-direction:column;justify-content:center}
.fj-metric b{font-size:24px}
.fj-metric small{font-size:20px;color:var(--ink-3)}
.fj-dock .btn{padding:0 16px;min-width:0;font-size:24px}
.fj-dock .btn.pri{min-width:0}
`;
  document.head.appendChild(css);

  const JOBS = [
    { id: 'j-wh', title: '仓储现场主管', company: '岭南津渡物流（示例）', companyId: 'co-jinnan', city: '佛山', salary: '7,500–9,800 元/月', salaryKnown: true, cat: 'fulltime', catLabel: '全职', industry: '交通物流', source: '澄海就业通（示例）', host: 'gangwei.chenghai-example.test', url: 'https://gangwei.chenghai-example.test/p/24081', ext: 'LN-FT-24081', sync: '2026-10-21 09:40', valid: '2026-12-31', head: '3 人', edu: '大专', exp: '1–3 年', duties: ['排夜班和白班的现场人手', '核对入库单据和异常件', '把当日货量记给来源机构'], reqs: ['能接受轮班', '有仓库现场带班经历', '会用手机填电子交接单'], skills: ['现场带班', '库存台账'], benefits: ['包工作餐', '夜班补贴'], trust: '已通过发布核验' },
    { id: 'j-nurse', title: '社区护理员', company: '澄湾康护服务社（示例）', companyId: 'co-chengwan', city: '珠海', salary: '6,200–7,400 元/月', salaryKnown: true, cat: 'parttime', catLabel: '兼职', industry: '医疗健康', source: '湾区岗位公示栏（示例）', host: 'jobs.wanqu-example.test', url: 'https://jobs.wanqu-example.test/n/18820', ext: 'WQ-PT-18820', sync: '2026-10-18 16:05', valid: '2026-11-30', head: '2 人', edu: '中专', exp: '不限', duties: ['按社区排班上门测血压和换药', '把服务记录交给护士长核对'], reqs: ['持护理员证或同等培训证明', '能接受周末班'], skills: ['基础护理'], benefits: ['按次结算'], trust: '已通过发布核验' },
    { id: 'j-cad', title: '机械制图员', company: '北岸精工坊（示例）', companyId: 'co-beian', city: '东莞', salary: '薪资面议', salaryKnown: false, cat: 'fulltime', catLabel: '全职', industry: '智能制造', source: '东岸制造名录（示例）', host: 'catalog.dongan-example.test', url: 'https://catalog.dongan-example.test/j/771', ext: 'DA-FT-0771', sync: '2026-10-12 11:26', valid: '2027-01-15', head: '来源平台未提供', edu: '大专', exp: '1 年', duties: ['按来料图纸出加工图', '改一版就把版次写在图框里'], reqs: ['会用一种常见制图软件', '能看懂公差'], skills: ['机械制图'], benefits: [], trust: '待核验' },
    { id: 'j-campus', title: '应届工艺技术员', company: '青禾新材实验社（示例）', companyId: 'co-qinghe', city: '惠州', salary: '8,000–10,500 元/月', salaryKnown: true, cat: 'campus', catLabel: '校招', industry: '新材料', source: '惠湾校招公告栏（示例）', host: 'campus.huiwan-example.test', url: 'https://campus.huiwan-example.test/g/552', ext: 'HW-CP-0552', sync: '2026-10-08 08:52', valid: '2026-11-20', head: '5 人', edu: '本科', exp: '应届', duties: ['跟着师傅跑中试线', '记录温度和收率'], reqs: ['材料、化工相关专业应届生'], skills: ['实验记录'], benefits: ['提供宿舍'], trust: '已通过发布核验' },
    { id: 'j-block', title: '夜班分拣员', company: '河口转运站（示例）', companyId: 'co-hekou', city: '江门', salary: '5,800–6,600 元/月', salaryKnown: true, cat: 'fulltime', catLabel: '全职', industry: '交通物流', source: '西江招工条（示例）', host: '', url: '', ext: '', sync: '2026-10-03 19:12', valid: '', head: '8 人', edu: '', exp: '', duties: ['按格口分拣包裹'], reqs: ['能上夜班'], skills: [], benefits: [], trust: '未标记', blocked: true },
    { id: 'j-intern', title: '门店陈列实习', company: '南风日用社（示例）', companyId: 'co-nanfeng', city: '中山', salary: '180–220 元/天', salaryKnown: true, cat: 'intern', catLabel: '实习', industry: '商贸零售', source: '南风门店布告（示例）', host: 'shop.nanfeng-example.test', url: 'https://shop.nanfeng-example.test/i/33', ext: 'NF-IN-0033', sync: '2026-09-30 14:18', valid: '2026-12-01', head: '1 人', edu: '在校', exp: '不限', duties: ['按陈列图上架', '收工前拍照留底'], reqs: ['每周至少到店 3 天'], skills: ['陈列'], benefits: ['日结'], trust: '已通过发布核验' }
  ];
  const CATS = [['', '全部'], ['fulltime', '全职'], ['intern', '实习'], ['campus', '校招'], ['parttime', '兼职']];
  const RESUME = { name: '周晚宁-仓储主管-简历.pdf', pages: '2 页', at: '2026-10-20 15:36' };

  const AGENCIES = [
    { id: 'ag-cheng', name: '澄湾公共就业服务站（示例）', type: '公共就业服务机构', typeKey: 'public_employment_service', district: '珠海香洲', address: '珠海市香洲区柠溪路 18 号一层', hours: '周一至周五 9:00–17:00', phone: '0756-000-1842', services: ['职业介绍', '政策咨询'], orgCode: 'CW-PES-018', status: '已发布', jobs: ['oj-1', 'oj-3'] },
    { id: 'ag-nan', name: '南岸持证人力服务处（示例）', type: '持证人力资源机构', typeKey: 'licensed_hr_agency', district: '佛山南海', address: '佛山市南海区桂城街道灯湖东路 6 号', hours: '周二至周日 10:00–18:30', phone: '0757-000-2260', services: ['到店咨询', '材料打印指引'], orgCode: 'NA-HR-226', status: '已发布', jobs: ['oj-2'] },
    { id: 'ag-bei', name: '北麓招聘服务点（示例）', type: '招聘服务机构', typeKey: 'recruitment', district: '东莞松山湖', address: '东莞市松山湖科技十路 2 号', hours: '服务时间以机构公示为准', phone: '0769-000-7731', services: ['岗位问询'], orgCode: 'BL-RC-077', status: '暂停收录', jobs: [] }
  ];
  const OJOBS = {
    'oj-1': { id: 'oj-1', agencyId: 'ag-cheng', title: '仓储夜班咨询岗', salary: '5,500–6,800 元/月', type: '全职', loc: '珠海香洲', edu: '到门店咨询', reqs: ['能接受夜班', '会基本加减和扫码'], duties: ['按组长安排分拣', '交接时当面点清数量'], ext: 'CW-OJ-110', sync: '2026-10-19 10:15', url: 'https://gangwei.chenghai-example.test/off/110', host: 'gangwei.chenghai-example.test' },
    'oj-2': { id: 'oj-2', agencyId: 'ag-nan', title: '门店理货咨询', salary: '4,800–5,600 元/月', type: '兼职', loc: '佛山南海', edu: '不限', reqs: ['能站满一个班次'], duties: ['按价签理货'], ext: 'NA-OJ-044', sync: '2026-10-11 13:40', url: 'https://shop.nanfeng-example.test/off/44', host: 'shop.nanfeng-example.test' },
    'oj-3': { id: 'oj-3', agencyId: 'ag-cheng', title: '档案整理协助', salary: '薪资面议', type: '以机构公示为准', loc: '珠海香洲', edu: '到门店咨询', reqs: [], duties: [], ext: '', sync: '', url: '', host: '', bad: true }
  };
  const COS = [
    { id: 'co-jinnan', name: '岭南津渡物流（示例）', type: '民营企业', industry: '交通物流', industryKey: '物流', province: '广东', city: '佛山', district: '南海', address: '佛山市南海区桂城灯湖西路 9 号', source: '澄海就业通（示例）', sourceKind: '第三方合规平台', kindKey: 'licensed_hr_agency', host: 'gangwei.chenghai-example.test', url: 'https://gangwei.chenghai-example.test/org/ln', ext: 'ORG-LN-019', sync: '2026-10-21 09:40', jobs: ['j-wh'], open: 1, scale: '100–199 人', fair: false, booth: '', recruit: ['fulltime'], desc: '做珠三角仓到店的短驳。', note: SRC_NOTE },
    { id: 'co-chengwan', name: '澄湾康护服务社（示例）', type: '民办机构', industry: '医疗健康', industryKey: '医疗', province: '广东', city: '珠海', district: '香洲', address: '珠海市香洲区人民东路 42 号', source: '湾区岗位公示栏（示例）', sourceKind: '人社平台', kindKey: 'public_employment_service', host: 'jobs.wanqu-example.test', url: 'https://jobs.wanqu-example.test/org/cw', ext: 'ORG-WQ-077', sync: '2026-10-18 16:05', jobs: ['j-nurse'], open: 1, scale: '20–49 人', fair: true, booth: 'A-12', recruit: ['parttime', 'fair'], desc: '社区护理到户。示例企业。', note: SRC_NOTE },
    { id: 'co-beian', name: '北岸精工坊（示例）', type: '专精特新', industry: '智能制造', industryKey: '制造', province: '广东', city: '东莞', district: '长安', address: '东莞市长安镇霄边大道 5 号', source: '东岸制造名录（示例）', sourceKind: '招聘会主办方', kindKey: 'fair_organizer', host: 'catalog.dongan-example.test', url: 'https://catalog.dongan-example.test/org/ba', ext: 'ORG-DA-210', sync: '2026-10-12 11:26', jobs: ['j-cad'], open: 1, scale: '50–99 人', fair: false, booth: '', recruit: ['fulltime'], desc: '小批量机加工。示例企业。', note: SRC_NOTE },
    { id: 'co-qinghe', name: '青禾新材实验社（示例）', type: '民办机构', industry: '新材料', industryKey: '材料', province: '广东', city: '惠州', district: '惠城', address: '惠州市惠城区河南岸大道 21 号', source: '惠湾校招公告栏（示例）', sourceKind: '大学就业网', kindKey: 'school_employment_center', host: 'campus.huiwan-example.test', url: 'https://campus.huiwan-example.test/org/qh', ext: 'ORG-HW-552', sync: '2026-10-08 08:52', jobs: ['j-campus'], open: 1, scale: '20–49 人', fair: false, booth: '', recruit: ['campus'], desc: '中试线工艺。', note: SRC_NOTE },
    { id: 'co-hekou', name: '河口转运站（示例）', type: '其他', industry: '交通物流', industryKey: '物流', province: '广东', city: '江门', district: '蓬江', address: '江门市蓬江区堤东路 3 号', source: '西江招工条（示例）', sourceKind: '第三方合规平台', kindKey: 'licensed_hr_agency', host: '', url: '', ext: '', sync: '2026-10-03 19:12', jobs: ['j-block'], open: 1, scale: '', fair: false, booth: '', recruit: ['fulltime'], desc: '夜班分拣。', note: SRC_NOTE },
    { id: 'co-nanfeng', name: '南风日用社（示例）', type: '民营企业', industry: '商贸零售', industryKey: '零售', province: '广东', city: '中山', district: '东区', address: '中山市东区博爱路 15 号', source: '南风门店布告（示例）', sourceKind: '第三方合规平台', kindKey: 'licensed_hr_agency', host: 'shop.nanfeng-example.test', url: 'https://shop.nanfeng-example.test/org/nf', ext: 'ORG-NF-033', sync: '2026-09-30 14:18', jobs: ['j-intern'], open: 1, scale: '20–49 人', fair: false, booth: '', recruit: ['intern'], desc: '门店陈列。', note: SRC_NOTE },
    { id: 'co-empty', name: '青柠图文社（示例）', type: '其他', industry: '文旅传媒', industryKey: '文旅', province: '广东', city: '中山', district: '石岐', address: '中山市石岐区孙文中路 7 号', source: '南风门店布告（示例）', sourceKind: '大学就业网', kindKey: 'school_employment_center', host: 'shop.nanfeng-example.test', url: 'https://shop.nanfeng-example.test/org/ql', ext: 'ORG-NF-003', sync: '2026-09-28 11:02', jobs: [], open: 0, scale: '', fair: false, booth: '', recruit: ['campus'], desc: '目前没有已发布岗位。示例企业。', note: SRC_NOTE }
  ];
  const CATL = { fulltime: '全职', intern: '实习', campus: '校招', parttime: '兼职' };
  const RECRUIT_L = { fulltime: '社招', campus: '校招', intern: '实习', parttime: '兼职', fair: '招聘会参展' };

  function jobBy(id) { return JOBS.find((j) => j.id === id) || JOBS[0]; }
  function cat() { const s = S(); return typeof s.fjCat === 'string' ? s.fjCat : (s.bJobCat || ''); }
  function saved() { const s = S(); if (!Array.isArray(s.fjSaved)) s.fjSaved = []; return s.fjSaved; }
  function hostOf(url) { const m = String(url || '').match(/^https?:\/\/([^/]+)/); return m ? m[1] : ''; }
  function missingOf(j) {
    const miss = [];
    if (!j.source) miss.push('来源机构');
    if (!j.sync) miss.push('同步时间');
    if (!j.ext) miss.push('外部ID');
    if (!j.url) miss.push('外部投递链接');
    return miss;
  }
  function blockReason(j) {
    const miss = missingOf(j);
    if (!miss.length) return '';
    if (miss.length === 1 && miss[0] === '外部投递链接') return APPLY_MISS;
    return '来源要素缺「' + miss.join('、') + '」，无法核对这条岗位的来源，本机暂不提供去来源平台的二维码；可到来源平台自行查询该职位。';
  }
  function ov(inner) { return `<div class="overlay" role="dialog" aria-modal="true"><div class="fj-sheet">${inner}</div></div>`; }
  function helpLine() { return `<p class="fj-note">${HELP}</p>`; }
  function aiMark() { return `<p class="fj-ai">${AI_MARK}</p>`; }

  function choice(o) {
    const set = o.set ? ` data-set="${o.set}"` : '';
    const span = o.span ? ' fj-span' : '';
    return `<button class="fj-door rise${span}" style="--i:${o.i || 0}" data-go="${o.go}"${set}><span class="ic ${o.tone || ''}">${icon(o.icon, 48, 2)}</span><span class="tx"><b>${o.title}</b><small>${o.desc}</small></span><span class="chev">${icon('chevR', 32, 2.2)}</span></button>`;
  }
  function goBtn(cls, label, go, set, extra) {
    const s = set ? ` data-set="${set}"` : '';
    return `<button class="${cls}" data-go="${go}"${s}${extra || ''}>${label}</button>`;
  }

  function mount(el, fn) {
    const onClick = (e) => {
      const b = e.target.closest('[data-fj]');
      if (!b || !el.contains(b) || b.dataset.go || b.dataset.act) return;
      if (b.getAttribute('aria-disabled') === 'true' || b.disabled) return;
      fn(b.dataset.fj, b.dataset.fjarg || '');
    };
    const onDemo = (e) => fn('demo:' + e.detail, '');
    el.addEventListener('click', onClick);
    el.addEventListener('proto-demo', onDemo);
    return () => { el.removeEventListener('click', onClick); el.removeEventListener('proto-demo', onDemo); };
  }

  /* ---------- b-social ---------- */
  add('b-social', G, '社会招聘', {
    demo: [],
    notes: {
      does: '私有化版社会招聘入口。运行页没有单独的「社会招聘」路由：内容取 serviceHubSpecs.ts 岗位服务（:48）和招聘会服务（:81）里属于社会招聘的入口。岗位匹配参考去 /resume/job-fit（稿屏 jobfit），问 AI 顾问去 /assistant（稿屏 xq）。',
      motion: '七块依次浮入，按下缩小。只动 transform 和 opacity。',
      keep: '改程序时：首页两块从「岗位信息 / 招聘会」改成「社会招聘 / 校园招聘」，两个服务台按这个重排；数据字段不变——岗位按 category（fulltime、parttime 归社会招聘），招聘会按 theme（general、industry 归社会招聘会）。实习、校招不在这扇门上，从岗位列表的类型芯片进。b-fairs 由校园招聘那一路新建，本副本点过去没有屏，是预期。入口要加在首页「社会招聘」块，本区不改 home。顶栏不报打印机。普通页 3 分钟清除。边界运行页原句：「岗位与招聘会仅展示第三方或官方来源；本终端仅展示与跳转，不代收简历。」屏上写成「不代收简历」。禁止按钮文案：一键投递、立即投递、平台投递、企业收简历、候选人管理、在线投递、投简历。线上招聘平台 / 官方与合作平台目录不在这 7 个去处里，放在岗位列表的「更多去处」。' + HELP_NOTE
    },
    render: () => F({
      cls: 'fj-hub',
      band: { kind: 'compact', eyebrow: '私有化版 · 社会招聘', title: '想找哪种工作？', sub: '全职和兼职从这里进。', seal: 'idle', place: ' ', status: { text: '社会招聘 · 来源信息入口' } },
      body: `<div class="fj-doors">
          ${choice({ i: 0, go: 'b-jobs', set: 'bJobCat=fulltime;fjCat=fulltime;fjPage=1;fjFavOnly=false;fjCity=;fjIndustry=;fjSource=;fjDrawer=;fjRec=;fjBoardOff=false;fjJobsErr=false;fjJobsLoad=false;fjJobsEmpty=false', icon: 'clipboard', title: '找全职', desc: '按城市、行业筛选已经发布的全职岗位' })}
          ${choice({ i: 1, go: 'b-jobs', set: 'bJobCat=parttime;fjCat=parttime;fjPage=1;fjFavOnly=false;fjCity=;fjIndustry=;fjSource=;fjDrawer=;fjRec=;fjBoardOff=false', icon: 'clock', title: '找兼职', desc: '看灵活就业的来源信息，办理在来源平台完成' })}
          ${choice({ i: 2, span: true, go: 'b-fairs', set: 'bFairTheme=social', icon: 'map', tone: 'slate', title: '社会招聘会', desc: '通用场次和行业场次，预约在来源平台办理' })}
          ${choice({ i: 3, go: 'b-companies', icon: 'landmark', title: '找企业', desc: '先看企业资料和在招岗位，再决定要不要去看来源' })}
          ${choice({ i: 4, go: 'b-agencies', icon: 'map', tone: 'clay', title: '线下招聘机构', desc: '看地址、营业时间和到店咨询，本机不代你去' })}
          ${choice({ i: 5, go: 'jobfit', icon: 'target', title: '岗位匹配参考', desc: '用简历和目标岗位逐项对照，只给你自己看' })}
          ${choice({ i: 6, go: 'xq', icon: 'sparkle', tone: 'slate', title: '问 AI 顾问', desc: '问岗位怎么看、材料怎么准备' })}
        </div>
        <p class="fj-hubhint">实习、校招岗位在『校园招聘』里。</p>`,
      dock: { ask: '问小青：社会招聘怎么选？' }, nav: ''
    })
  });

  /* ---------- b-jobs ---------- */
  function jobsFiltered() {
    const s = S();
    let list = JOBS.slice();
    const c = cat();
    if (c) list = list.filter((j) => j.cat === c);
    if (s.fjCity) list = list.filter((j) => j.city === s.fjCity);
    if (s.fjIndustry) list = list.filter((j) => j.industry === s.fjIndustry);
    if (s.fjSource) list = list.filter((j) => j.source === s.fjSource);
    if (s.fjFavOnly) list = list.filter((j) => saved().includes(j.id));
    list.sort((a, b) => {
      if (s.fjSort === 'salary') { const d = (b.salaryKnown ? 1 : 0) - (a.salaryKnown ? 1 : 0); if (d) return d; }
      return b.sync.localeCompare(a.sync);
    });
    return list;
  }
  function jobsOverlay() {
    const s = S();
    if (s.fjDrawer === 'filter') {
      const cities = [...new Set(JOBS.map((j) => j.city))];
      const inds = [...new Set(JOBS.map((j) => j.industry))];
      const srcs = [...new Set(JOBS.map((j) => j.source))];
      const chip = (k, v, cur, label) => `<button type="button" data-fj="${k}" data-fjarg="${esc(v)}" aria-pressed="${cur === v ? 'true' : 'false'}">${esc(label)}</button>`;
      return ov(`<h2>城市与行业筛选</h2><p class="fj-note">选项来自当前已同步的真实岗位；更完整的地区与行业名单还没接上。</p>
        <p class="fj-k">工作城市</p><div class="fj-chips">${chip('city', '', s.fjCity || '', '全部城市')}${cities.map((c) => chip('city', c, s.fjCity || '', c)).join('')}</div>
        <p class="fj-k">所属行业</p><div class="fj-chips">${chip('ind', '', s.fjIndustry || '', '全部行业')}${inds.map((c) => chip('ind', c, s.fjIndustry || '', c)).join('')}</div>
        <p class="fj-k">来源</p><div class="fj-chips">${chip('src', '', s.fjSource || '', '全部来源')}${srcs.map((c) => chip('src', c, s.fjSource || '', c)).join('')}</div>
        <p class="fj-k">排序</p><div class="fj-chips">${chip('sort', 'latest', s.fjSort || 'latest', '最新同步')}${chip('sort', 'salary', s.fjSort || 'latest', '薪资标注优先')}</div>
        <div class="fj-rowbtns"><button class="btn sec" type="button" data-fj="clear-filter">清除条件</button><button class="btn pri" type="button" data-fj="close">看这组岗位</button></div>`);
    }
    if (s.fjDrawer === 'more') {
      return ov(`<h2>更多去处</h2><p class="fj-note">这些不靠小青也能走。</p>
        <div class="fj-acts">
          ${goBtn('fj-link', '<b>找企业</b><small>来源企业与岗位导览</small>', 'b-companies')}
          ${goBtn('fj-link', '<b>官方与合作平台目录</b><small>手机扫码打开，本机不打开外链</small>', 'official')}
          ${goBtn('fj-link', '<b>浏览记录</b><small>看过的岗位和打开过的来源</small>', 'my-activity')}
          ${goBtn('fj-link', '<b>线下招聘机构</b><small>到店问，不在这里办理</small>', 'b-agencies')}
        </div>
        <button class="btn sec" type="button" data-fj="close">关闭</button>`);
    }
    if (s.fjDrawer === 'consent') {
      return ov(`<h2>开启岗位 AI 辅助</h2><p class="fj-note">基于本人简历与来源岗位内容生成参考建议，不代表录用结果。</p>
        <p class="fj-note">本系统会基于你的本人简历和岗位来源内容生成岗位解读、匹配参考和准备建议，结果仅供求职参考，不代表录用结果。</p>
        <p class="fj-note">分析结果只展示给当前登录的求职者本人。</p>
        <p class="fj-note">绝不向企业共享或推荐您的简历。</p>
        <p class="fj-note">不会提供平台内办理、企业端筛选流程或录用承诺。</p>
        <p class="fj-sub">${AGE}</p>
        <div class="fj-rowbtns"><button class="btn sec" type="button" data-fj="close">取消</button><button class="btn pri" type="button" data-fj="consent-ok">同意并继续</button></div>`);
    }
    if (s.fjDrawer === 'pick') {
      return ov(`<h2>选一份已诊断的简历</h2><p class="fj-note">${NO_SHARE}</p>
        <button class="fj-main" type="button" data-fj="use-resume"><b>${RESUME.name}</b><small>${RESUME.pages} · 诊断于 ${RESUME.at}</small></button>
        ${goBtn('fj-link', '<b>去准备简历</b><small>还没有诊断完成的简历</small>', 'resume')}
        <button class="btn sec" type="button" data-fj="close">取消</button>`);
    }
    return '';
  }
  function jobsBody() {
    const s = S();
    const c = cat();
    if (s.fjBoardOff) {
      return `<section class="fj-card fj-grow"><h2>本终端岗位板块已关闭</h2>
        <p class="fj-note">本机未开放岗位板块。岗位名单、岗位详情和岗位 AI 这次都不提供，不显示上一次的列表。</p>
        <p class="fj-note">找企业和招聘会不走这道开关。线下机构的岗位详情在板块关闭时也会被拒绝。</p>
        <div class="fj-acts">${goBtn('fj-link', '<b>找企业</b><small>企业资料仍可看</small>', 'b-companies')}${goBtn('fj-link', '<b>官方与合作平台目录</b><small>扫码到来源平台</small>', 'official')}</div>
        ${helpLine()}</section>`;
    }
    if (s.fjJobsLoad) {
      return `<section class="fj-card fj-grow"><h2>正在取岗位名单</h2><p class="fj-note">真实内容返回前不显示示例岗位，也不沿用上一次列表。不预估剩余时间。</p>
        <div class="fj-kvs stretch">${['职位', '单位', '城市', '薪资', '类型', '来源名', '同步时间', '外部 ID'].map((k) => `<div class="fj-kv"><small>${k}</small><b>取到才显示</b></div>`).join('')}</div>
        <p class="fj-note">${B_LIST}</p></section>`;
    }
    if (s.fjJobsErr) {
      return `<section class="fj-card fj-grow"><h2>岗位名单这次没取到</h2>
        <p class="fj-note">岗位信息暂时无法加载，请稍后重试。本机不拿上一次的名单当作这次的结果。</p>
        <div class="fj-acts"><button class="fj-link" type="button" data-fj="retry"><b>重新读取</b><small>再请求一次名单</small></button>${goBtn('fj-link', '<b>去帮助中心</b><small>常见问题，不找现场的人</small>', 'help')}</div>
        ${helpLine()}<p class="fj-note">${B_LIST}</p></section>`;
    }
    if (s.fjJobsEmpty) {
      return `<section class="fj-card fj-grow"><h2>本机暂未上架已审核的岗位</h2>
        <p class="fj-note">来源机构还没有可展示的岗位。本机不会拿示例岗位把列表填满，也不会显示未经审核的来源。</p>
        <button class="fj-link" type="button" data-fj="retry"><b>重新读取</b><small>再问一次有没有已发布岗位</small></button>
        ${helpLine()}</section>`;
    }
    const all = jobsFiltered();
    const page = Math.max(1, +(s.fjPage || 1));
    const pages = Math.max(1, Math.ceil(all.length / 3));
    const slice = all.slice((page - 1) * 3, page * 3);
    const latest = all.length ? all.map((j) => j.sync).sort().slice(-1)[0] : '暂无';
    const srcN = new Set(all.map((j) => j.source)).size;
    const chips = CATS.map(([v, lab], i) => `<button type="button" data-fj="cat" data-fjarg="${v}" aria-pressed="${c === v ? 'true' : 'false'}">${lab}</button>`).join('');
    const favBtn = (j) => {
      const on = saved().includes(j.id);
      if (!s.logged) return `<button class="fj-fav" type="button" data-go="login" aria-label="收藏岗位">收藏</button>`;
      return `<button class="fj-fav" type="button" data-fj="fav" data-fjarg="${j.id}" aria-pressed="${on ? 'true' : 'false'}">${on ? '已收藏' : '收藏'}</button>`;
    };
    const aiBtn = () => {
      if (s.fjRec === 'done' || s.fjRec === 'fail' || s.fjRec === 'load' || s.fjRec === 'empty') return `<button class="fj-link" type="button" data-fj="rec-clear"><b>退出 AI 推荐</b><small>回到岗位列表</small></button>`;
      if (!s.logged) return goBtn('fj-link', '<b>开始推荐</b><small>要先登录</small>', 'login');
      if (s.ai === 'down') return `<button class="fj-link" type="button" data-fj="ai-off"><b>开始推荐</b><small>小青这次不可用</small></button>`;
      if (s.fjNoResume) return goBtn('fj-link', '<b>开始推荐</b><small>还没有诊断完成的简历</small>', 'resume');
      return `<button class="fj-link" type="button" data-fj="rec-start"><b>开始推荐</b><small>用已诊断的简历</small></button>`;
    };
    let mid = '';
    if (s.fjRec === 'load') {
      mid = `<section class="fj-card"><h2>正在生成岗位 AI 参考…</h2><p class="fj-note">生成好之前不显示推荐等级。岗位列表先留在下面，扫码投递不受影响。</p><p class="fj-sub">${AGE}</p></section>`;
    } else if (s.fjRec === 'fail') {
      mid = `<section class="fj-card"><h2>这次没有生成推荐</h2><p class="fj-warn">${esc(s.fjRecMsg || 'AI 辅助暂时不可用，请稍后重试。')}</p><p class="fj-note">没有生成结果不影响你查看岗位列表，也不影响去来源平台投递。</p><button class="fj-mini" type="button" data-fj="rec-start">重试</button></section>`;
    } else if (s.fjRec === 'empty') {
      mid = `<section class="fj-card"><p class="fj-note">当前简历未匹配到更合适的岗位，请调整筛选条件或更新简历后再试。</p>${aiMark()}</section>`;
    } else if (s.fjRec === 'done') {
      const recs = [
        { id: 'j-wh', fit: '匹配参考：较高', sum: '简历里写过仓内带班和夜班交接，和这条岗位的现场主管职责对得上。' },
        { id: 'j-cad', fit: '匹配参考：偏低', sum: '简历没有制图软件的经历。这只是参考，不代表不能去看来源原文。' }
      ];
      mid = `<section class="fj-card"><h2>AI 岗位推荐</h2><p class="fj-sub">仅供参考，不代表录用结果。</p>${aiMark()}<p class="fj-note">${NO_SHARE}</p>
        ${recs.map((r) => { const j = jobBy(r.id); return `<div class="fj-row"><button class="fj-main" type="button" data-go="b-job" data-set="fjJob=${j.id};fjSrcBad=false"><b>${esc(j.title)}</b><small>${esc(j.company)} · ${esc(j.source)}</small><small>${r.fit} · ${r.sum}</small></button></div>`; }).join('')}</section>`;
    }
    const emptyList = !slice.length;
    const list = s.fjRec === 'done'
      ? `<p class="fj-note">上面是这次的推荐。点「退出 AI 推荐」后，按当前筛选继续看全部岗位。</p>`
      : emptyList
      ? `<section class="fj-card"><h2>${s.fjFavOnly ? '还没有收藏的岗位' : '这组条件下没有已发布的岗位'}</h2><p class="fj-note">${s.fjFavOnly ? '在岗位行点收藏，方便稍后查看。' : '本机不会拿示例岗位把列表填满，请调整关键词、城市、行业、类型或来源机构。'}</p><button class="fj-mini" type="button" data-fj="clear-filter">清空筛选</button></section>`
      : slice.map((j) => `<div class="fj-row"><button class="fj-main" type="button" data-go="b-job" data-set="fjJob=${j.id};fjSrcBad=${j.blocked ? 'true' : 'false'}"><b>${esc(j.title)} <span class="fj-tag">${esc(j.catLabel)}</span></b><small>${esc(j.company)} · ${esc(j.city)} · ${esc(j.salary)}</small><small>${esc(j.source)} · 同步 ${esc(j.sync)}</small></button>${favBtn(j)}</div>`).join('');
    const aiNote = s.ai === 'down' ? `<p class="fj-warn">小青这次不可用。岗位原文、筛选和扫码投递不受影响，推荐要等小青恢复后再做。</p>` : (s.fjAiOff ? `<p class="fj-warn">岗位 AI 需要连上服务后才能用。你可以继续看列表，或到岗位详情扫码。</p>` : '');
    return `${jobsOverlay()}
      <section class="fj-card"><div class="fj-row" style="align-items:center"><div style="flex:1"><b style="font-size:24px">用我的简历智能推荐</b><p class="fj-note">${NO_SHARE}</p><p class="fj-sub">${AGE}</p></div>${aiBtn()}</div>${aiNote}</section>
      <div class="fj-chips">${chips}</div>
      <div class="fj-tool"><button class="fj-search" type="button" data-act="toast" data-arg="演示：弹出屏上键盘">${icon('keyboard', 28, 2)}搜索职位 / 公司</button>
        <button class="fj-mini" type="button" data-fj="drawer" data-fjarg="filter">筛选${(s.fjCity || s.fjIndustry) ? '（' + ((s.fjCity ? 1 : 0) + (s.fjIndustry ? 1 : 0)) + '）' : ''}</button>
        <button class="fj-mini" type="button" data-fj="fav-only" aria-pressed="${s.fjFavOnly ? 'true' : 'false'}">只看收藏 ${saved().length}</button></div>
      <p class="fj-meta"><span>共 <b>${all.length}</b> 个岗位 · ${s.fjRec === 'done' ? '当前先看推荐' : `当前展示 <b>${slice.length}</b> 个`} · 来源机构 <b>${srcN}</b> 个 · 最新同步 <b>${esc(latest)}</b>${all.length > 3 && s.fjRec !== 'done' ? ` · 第 ${page}/${pages} 批` : ''}</span>
        <span class="fj-pager"><button type="button" data-fj="page" data-fjarg="-1" ${page <= 1 ? 'disabled' : ''}>上一批</button><button type="button" data-fj="page" data-fjarg="1" ${page >= pages ? 'disabled' : ''}>下一批</button></span></p>
      ${mid}
      <section class="fj-card fj-grow">${list}
        <p class="fj-note">第三方 / 官方来源信息入口。本系统不接收简历、不参与招聘闭环，请前往来源平台办理。${s.fjSource ? ' 当前来源：' + esc(s.fjSource) + '。' : ''}</p>
        <p class="fj-note">${B_LIST}</p>
        <div class="fj-acts"><button class="fj-link" type="button" data-fj="drawer" data-fjarg="more"><b>更多去处</b><small>找企业、官方目录、浏览记录</small></button>${goBtn('fj-link', '<b>线下招聘机构</b><small>到店问询</small>', 'b-agencies')}</div>
      </section>`;
  }
  function jobsStatus() {
    const s = S();
    if (s.fjBoardOff) return { text: '本终端岗位板块已关闭', warn: 1 };
    if (s.fjJobsLoad) return { text: '正在读取岗位名单' };
    if (s.fjJobsErr) return { text: '岗位名单这次没读到', warn: 1 };
    if (s.fjJobsEmpty || !jobsFiltered().length) return { text: '这组条件没有岗位', warn: 1 };
    return { text: '岗位与来源信息已读到' };
  }
  add('b-jobs', G, '岗位列表', {
    demo: () => {
      const s = S();
      const d = [{ label: '演示：推荐生成好了', ev: 'rec-done' }, { label: '演示：推荐没生成', ev: 'rec-fail' }, { label: '演示：没有对上的岗位', ev: 'rec-empty' }];
      if (s.fjJobsLoad || s.fjJobsErr) d.push({ label: '演示：名单重新取到', ev: 'reload-ok' }, { label: '演示：名单仍失败', ev: 'reload-fail' });
      return d;
    },
    notes: {
      does: '运行页 /jobs，JobsPage.tsx:33。类型芯片、搜索、城市与行业筛选、只看收藏、排序（最新同步 / 薪资标注优先）、来源、列表行、用我的简历智能推荐、线下招聘机构、官方与合作平台目录、找企业、浏览记录。',
      motion: '芯片和列表按下缩小。推荐结果等演示事件，不自己倒计时跳成功。',
      keep: '字从岗位记录读：标题、单位、城市、薪资、category、来源名、sourceUrl、externalId、syncTime。薪资没有就写「薪资面议」，不编数字。搜索点了只出「演示：弹出屏上键盘」，不编搜索结果。未登录点推荐或收藏去 login；登录后应回到本页（现有 login 屏会去「我的」，改程序时用 state.from=/jobs）。AI 要 job_ai 授权，弹层是 JobAiConsentModal。结果标「AI 生成，仅供参考」，并写 JobsQxChrome.tsx:9-10 那句不向企业共享简历。小青不可用：列表、筛选、扫码不受影响。读取中 / 失败 / 空 / 本机未开放岗位板块（KIOSK_JOB_BOARD_DISABLED，文案「本终端岗位板块已关闭」或「岗位板块已全局关闭」）都有去处。失败点重新读取后进入读取中，等演示事件 reload-ok / reload-fail，不自动成功。运行页每批 100 条；稿上一屏 3 条，用上一批 / 下一批。普通页 3 分钟。顶栏不报打印机。运行页错误码 JOB_AI_QUOTA_UNAVAILABLE 的原句点名现场的人，屏上改为服务电话。' + HELP_NOTE + ' 边界原句：「本机不代收简历、不代替投递。岗位由来源平台发布，投递在来源平台完成。」'
    },
    render: () => F({
      band: { kind: 'compact', eyebrow: '岗位信息', title: '想看哪些岗位？', sub: '只展示已审核发布且在有效期内的第三方与官方岗位；来源要素不完整时仅保留只读详情。', seal: null, place: ' ', status: jobsStatus() },
      body: jobsBody(),
      dock: { backLabel: '返回', ask: '问小青：这些岗位怎么看？', pri: { label: '线下招聘机构', go: 'b-agencies' } },
      nav: ''
    }),
    mount(el) {
      return mount(el, (k, arg) => {
        const s = S();
        if (k === 'cat') {
          s.fjPage = 1;
          if (cat() === arg) { if (arg === '') s.fjDrawer = 'filter'; else s.fjCat = ''; }
          else s.fjCat = arg;
          refresh(); return;
        }
        if (k === 'drawer') { s.fjDrawer = arg; refresh(); return; }
        if (k === 'close') { s.fjDrawer = ''; refresh(); return; }
        if (k === 'city') { s.fjCity = arg; s.fjPage = 1; refresh(); return; }
        if (k === 'ind') { s.fjIndustry = arg; s.fjPage = 1; refresh(); return; }
        if (k === 'src') { s.fjSource = arg; s.fjPage = 1; refresh(); return; }
        if (k === 'sort') { s.fjSort = arg; refresh(); return; }
        if (k === 'clear-filter') { s.fjCity = ''; s.fjIndustry = ''; s.fjSource = ''; s.fjFavOnly = false; s.fjCat = ''; s.fjPage = 1; s.fjJobsEmpty = false; s.fjDrawer = ''; refresh(); return; }
        if (k === 'fav-only') { s.fjFavOnly = !s.fjFavOnly; s.fjPage = 1; refresh(); return; }
        if (k === 'fav') { const a = saved(); const i = a.indexOf(arg); if (i >= 0) a.splice(i, 1); else a.push(arg); refresh(); return; }
        if (k === 'page') { const all = jobsFiltered(); const pages = Math.max(1, Math.ceil(all.length / 3)); s.fjPage = Math.min(pages, Math.max(1, (+(s.fjPage || 1)) + (+arg))); refresh(); return; }
        if (k === 'rec-start') {
          if (!s.logged) return;
          if (s.ai === 'down') { s.fjAiOff = true; refresh(); return; }
          s.fjDrawer = s.fjConsent ? 'pick' : 'consent'; refresh(); return;
        }
        if (k === 'consent-ok') { s.fjConsent = true; s.fjDrawer = 'pick'; refresh(); return; }
        if (k === 'use-resume') { s.fjDrawer = ''; s.fjRec = 'load'; s.fjRecMsg = ''; refresh(); return; }
        if (k === 'rec-clear') { s.fjRec = ''; s.fjAiOff = false; refresh(); return; }
        if (k === 'ai-off') { s.fjAiOff = !s.fjAiOff; refresh(); return; }
        if (k === 'retry') { s.fjJobsErr = false; s.fjJobsEmpty = false; s.fjJobsLoad = true; refresh(); return; }
        if (k === 'demo:rec-done') { s.fjRec = 'done'; s.fjDrawer = ''; s.fjJobsLoad = false; refresh(); return; }
        if (k === 'demo:rec-fail') { s.fjRec = 'fail'; s.fjRecMsg = '今日 AI 辅助额度已用完，请明天再试。'; s.fjDrawer = ''; refresh(); return; }
        if (k === 'demo:rec-empty') { s.fjRec = 'empty'; s.fjDrawer = ''; refresh(); return; }
        if (k === 'demo:reload-ok') { s.fjJobsLoad = false; s.fjJobsErr = false; refresh(); return; }
        if (k === 'demo:reload-fail') { s.fjJobsLoad = false; s.fjJobsErr = true; refresh(); return; }
      });
    }
  });

  /* ---------- b-job ---------- */
  function curJob() {
    const s = S();
    if (s.fjSrcBad) return jobBy('j-block');
    return jobBy(s.fjJob || 'j-wh');
  }
  function jobQr(j) {
    return ov(`<h2>扫码投递</h2>
      <div class="fj-qrbox"><div>${qr(j.id.length + 3, 240)}</div><div class="fj-cap"><b class="fj-host">${esc(j.host || '来源平台未提供主机名')}</b><p class="fj-warn">示例码，不能扫</p><p class="fj-note">用手机扫码，在来源平台投递。</p><p class="fj-note">请使用手机扫码前往来源平台自行操作。本系统不接收简历、不参与招聘闭环。离开前请关掉二维码，不把账号留在公共终端。</p></div></div>
      <div class="fj-kvs"><div class="fj-kv"><small>来源机构</small><b>${esc(j.source || '来源平台未提供')}</b></div><div class="fj-kv"><small>外部编号</small><b>${esc(j.ext || '来源平台未提供')}</b></div></div>
      <p class="fj-k">二维码直接编码来源链接，不经过我方域名中转。</p>
      <button class="btn pri" type="button" data-fj="close">关闭</button>`);
  }
  function jobDetailBody() {
    const s = S();
    const j = curJob();
    if (s.fjJobLoad) return `<section class="fj-card fj-grow"><h2>正在读取岗位标题、原文与来源信息</h2><p class="fj-note">真实内容返回前不显示示例内容，也不预估剩余时间。</p><div class="fj-kvs">${['标题', '职责', '要求', '来源机构', '同步时间', '外部 ID', '来源链接'].map((k) => `<div class="fj-kv"><small>${k}</small><b>取到才显示</b></div>`).join('')}</div></section>`;
    if (s.fjJobMiss) return `<section class="fj-card fj-grow"><h2>没有找到这条岗位</h2><p class="fj-note">岗位可能已被来源平台撤回，或链接本身不正确。本机不会用相似岗位替你补上。</p>${goBtn('fj-link', '<b>回岗位列表重新找</b><small>不拿别的岗位顶上</small>', 'b-jobs')}</section>`;
    if (s.fjJobErr) return `<section class="fj-card fj-grow"><h2>岗位详情这次没取到</h2><p class="fj-note">不显示上一次打开过的内容。</p><button class="fj-link" type="button" data-fj="job-retry"><b>重新读取</b><small>再请求这条岗位</small></button>${helpLine()}</section>`;
    const miss = missingOf(j);
    const ok = miss.length === 0;
    const reason = blockReason(j);
    const favOn = saved().includes(j.id);
    const fav = s.logged
      ? `<button class="fj-fav" type="button" data-fj="fav" data-fjarg="${j.id}" aria-pressed="${favOn ? 'true' : 'false'}">${favOn ? '已收藏' : '收藏'}</button>`
      : `<button class="fj-fav" type="button" data-go="login">收藏</button>`;
    const prof = j.companyId && coBy(j.companyId);
    const co = prof ? goBtn('fj-link', `<b>${esc(j.company)}</b><small>查看企业资料</small>`, 'b-company', 'fjCo=' + j.companyId) : `<p class="fj-note">${esc(j.company)} · 来源企业未关联企业资料</p>`;
    const aiBtn = (kind, title, hint) => {
      if (!s.logged) return goBtn('fj-link', `<b>${title}</b><small>要先登录</small>`, 'login');
      if (s.ai === 'down') return `<button class="fj-link" type="button" data-fj="ai-off" data-fjarg="${kind}"><b>${title}</b><small>小青这次不可用</small></button>`;
      if (kind === 'match' && s.fjNoResume) return goBtn('fj-link', `<b>${title}</b><small>还没有本人简历</small>`, 'resume');
      return `<button class="fj-link" type="button" data-fj="ai-open" data-fjarg="${kind}"><b>${title}</b><small>${hint}</small></button>`;
    };
    let aiBox = '';
    if (s.fjAiOff) aiBox = `<p class="fj-warn">小青这次生成不了。岗位原文和扫码投递不受影响。你可以自己看职责和要求，或扫码到来源平台。</p>`;
    if (s.fjAi === 'load') aiBox = `<section class="fj-card"><h2>正在生成岗位 AI 参考…</h2><p class="fj-note">好了以前不展示解读或匹配等级。</p></section>`;
    if (s.fjAi === 'fail') aiBox = `<section class="fj-card"><h2>${s.fjAiKind === 'match' ? '岗位匹配参考' : 'AI 岗位解读'}</h2><p class="fj-warn">${esc(s.fjAiMsg || '这次没有生成出来，请稍后重试。')}</p><p class="fj-note">没有生成结果不影响你查看岗位详情，也不影响去来源平台投递。</p><button class="fj-mini" type="button" data-fj="ai-retry">重新生成</button><button class="fj-mini" type="button" data-fj="ai-clear">收起</button></section>`;
    if (s.fjAi === 'explain') aiBox = `<section class="fj-card"><h2>AI 岗位解读</h2><p class="fj-sub">仅供参考，不代表录用结果。</p>${aiMark()}
      <p class="fj-note"><b>这个岗位主要做什么</b>　${esc(j.duties.join('；') || '来源平台暂未提供岗位职责。')}</p>
      <p class="fj-note"><b>必须准备的要求</b>　${esc(j.reqs.join('；') || '来源平台暂未提供任职要求。')}</p>
      <p class="fj-note"><b>可加分的准备</b>　${esc((j.skills || []).join('、') || '来源没有单列加分项。')}</p>
      <p class="fj-note"><b>面试前准备建议</b>　准备一段和「${esc(j.title)}」最接近的经历，数字用你自己的。</p>
      <button class="fj-mini" type="button" data-fj="ai-clear">收起解读</button></section>`;
    if (s.fjAi === 'match') aiBox = `<section class="fj-card"><h2>岗位匹配参考</h2>${aiMark()}<p class="fj-note"><b>匹配参考：较高</b>　简历里有与「${esc(j.title)}」相关的经历。这不是录用结论。</p>
      <p class="fj-note"><b>匹配点 · 简历原文依据</b>　「负责过现场排班和交接」——摘自 ${RESUME.name}。</p>
      <p class="fj-note">${NO_SHARE}</p>
      <button class="fj-mini" type="button" data-fj="ai-clear">收起</button></section>`;
    const consent = s.fjDrawer === 'consent' ? ov(`<h2>开启岗位 AI 辅助</h2><p class="fj-note">基于本人简历与来源岗位内容生成参考建议，不代表录用结果。</p><p class="fj-note">分析结果只展示给当前登录的求职者本人。绝不向企业共享或推荐您的简历。不会提供平台内办理、企业端筛选或录用承诺。</p><p class="fj-sub">${AGE}</p><div class="fj-rowbtns"><button class="btn sec" type="button" data-fj="close">取消</button><button class="btn pri" type="button" data-fj="consent-ok">同意并继续</button></div>`) : '';
    const pick = s.fjDrawer === 'pick' ? ov(`<h2>选一份本人简历</h2><p class="fj-note">匹配要已完成诊断的简历。${NO_SHARE}</p><button class="fj-main" type="button" data-fj="use-resume"><b>${RESUME.name}</b><small>${RESUME.pages} · ${RESUME.at}</small></button>${goBtn('fj-link', '<b>去准备简历</b><small>没有可用来对照的简历</small>', 'resume')}<button class="btn sec" type="button" data-fj="close">取消</button>`) : '';
    const qrLayer = s.fjQr ? jobQr(j) : '';
    const duties = s.fjAi ? '' : `<div class="fj-cols"><section class="fj-card"><h2>岗位职责</h2><p class="fj-k">内容由来源平台同步</p>${j.duties.length ? `<ul>${j.duties.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="fj-note">来源平台暂未提供岗位职责，建议通过来源链接查看完整说明。</p>'}</section><section class="fj-card"><h2>任职要求</h2>${j.reqs.length ? `<ul>${j.reqs.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="fj-note">来源平台暂未提供任职要求。</p>'}</section></div>`;
    return `${qrLayer}${consent}${pick}
      <section class="fj-card"><div class="fj-row"><div style="flex:1"><h2>${esc(j.title)}</h2><p class="fj-sub">${esc(j.city)} · ${esc(j.catLabel)} · ${esc(j.industry)}</p></div>${fav}</div>
        <div class="fj-metric"><span><small>薪资</small><b>${esc(j.salary)}</b></span><span><small>招聘人数</small><b>${esc(j.head || '来源平台未提供')}</b></span><span><small>学历</small><b>${esc(j.edu || '来源未单列')}</b></span><span><small>经验</small><b>${esc(j.exp || '来源未单列')}</b></span></div>
        ${co}
        <div class="fj-acts three">${aiBtn('explain', 'AI 岗位解读', '看懂职责与准备')}${aiBtn('match', '岗位匹配参考', '用本人简历对照')}${goBtn('fj-link', '<b>打印岗位信息</b><small>A4 黑白，以公示为准</small>', 'print-src')}</div>
        ${s.ai === 'down' && !s.fjAiOff ? '<p class="fj-warn">小青这次不可用。岗位原文和底部扫码不受影响。</p>' : ''}
        <p class="fj-sub">${AGE} · ${AI_MARK}</p></section>
      ${duties}
      ${aiBox}
      <section class="fj-card fj-grow"><h2>信息来源</h2><p class="fj-k">以来源平台公布的为准</p>
        <div class="fj-kvs four">
          <div class="fj-kv"><small>来源机构</small><b>${esc(j.source || '来源平台未提供')}</b></div>
          <div class="fj-kv"><small>同步时间</small><b>${esc(j.sync || '来源平台未提供')}</b></div>
          <div class="fj-kv"><small>外部 ID</small><b>${esc(j.ext || '来源平台未提供')}</b></div>
          <div class="fj-kv"><small>来源核验</small><b>${esc(j.trust)}</b></div>
        </div>
        <p class="fj-note">外部投递链接　<b>${ok ? esc(j.url) : '来源平台未提供有效链接'}</b>${j.valid ? `　有效期限 ${esc(j.valid)}（以来源平台公示为准）` : ''}</p>
        ${ok ? '' : `<p class="fj-warn">来源要素不完整，前往来源平台与扫码已停用。缺：${esc(miss.join('、'))}。是否仍在招聘由来源平台决定。</p><p class="fj-note">${esc(reason)}</p>`}
        <p class="fj-note">本岗位来自第三方或官方来源，本系统不接收简历、不参与招聘闭环。${TRUST} ${SRC_NOTE}</p>
        <p class="fj-note">防骗：正规招聘不向求职者收取培训费、工装费、体检费、内推费、保证金或押金。如遇收费或保证录用，可拨打 12333。本系统不审核岗位是否真实招人。</p>
        <p class="fj-note">先核对原文和来源信息，再去来源平台自行操作。结果以来源平台为准，本终端不读取筛选、面试或录用结果。</p>
      </section>`;
  }
  add('b-job', G, '岗位详情', {
    demo: [{ label: '演示：解读生成好了', ev: 'ai-done' }, { label: '演示：解读没生成', ev: 'ai-fail' }, { label: '演示：匹配生成好了', ev: 'match-done' }, { label: '演示：匹配没生成', ev: 'match-fail' }, { label: '演示：详情重新取到', ev: 'reload-ok' }],
    notes: {
      does: '运行页 /jobs/:id，JobDetailPage.tsx:37。职责、要求、来源四项、收藏、AI 岗位解读、岗位匹配参考、查看企业、打印岗位信息、扫码投递、去来源平台投递。一体机上两个投递按钮都打开同一二维码层（:149-157），不打开外部网页。',
      motion: '按下缩小。生成中停在「正在生成」，等演示事件 ai-done / ai-fail / match-done / match-fail，不倒计时自动成功。',
      keep: '来源四项从岗位读：来源机构、同步时间、外部 ID、来源链接。缺一则两个投递按钮置灰，原因用 sourceTrustReason；只缺链接时是「该来源未提供可用的投递链接，请到来源平台查询该职位」。数据来源说明缺省句：「信息来自第三方或官方来源平台，以来源平台原文为准。」二维码直接编码来源平台链接，不经过我方域名中转，并标「示例码，不能扫」。未登录：收藏和两个 AI 去 login，登录后应回到 /jobs/:id。匹配没有简历时去 resume。小青不可用：原文和扫码仍在。岗位详情没有「记一笔求职进度」按钮。jobApplications.ts 只读列表，注释写明手填入口待建设、本客户端不发 POST；MyActivityPage 的求职进度是本人已有记录，起手行写「手填入口待建设」。所以这里不画记一笔。若以后加上，必须写「只记在你自己的记录里，企业和来源平台都看不到」。防骗原文照 JobAntiFraudNotice。普通页 3 分钟。顶栏：来源信息齐全 / 来源信息不全，暂不提供投递二维码。不报打印机。' + HELP_NOTE + ' 禁止出现在按钮上的词：一键投递、立即投递、平台投递、企业收简历、候选人、在线投递、投简历。运行页「不接收简历」屏上写「不代收简历」。'
    },
    render: () => {
      const s = S();
      const j = curJob();
      const miss = (!s.fjJobLoad && !s.fjJobMiss && !s.fjJobErr) ? missingOf(j) : [];
      const ok = !miss.length && !s.fjJobLoad && !s.fjJobMiss && !s.fjJobErr;
      const st = s.fjJobLoad ? { text: '正在取岗位原文与来源' } : s.fjJobMiss ? { text: '这条岗位没有找到', warn: 1 } : s.fjJobErr ? { text: '岗位详情读取失败', warn: 1 } : ok ? { text: '来源信息齐全' } : { text: '来源信息不全，暂不提供投递二维码', warn: 1 };
      const dis = ok ? '' : ' aria-disabled="true"';
      return F({
        band: { kind: 'compact', eyebrow: '岗位详情', title: s.fjJobMiss ? '这条岗位不在了' : (s.fjJobLoad ? '正在读这条岗位' : esc(j.title)), sub: s.fjJobLoad ? '内容返回前不展示任何岗位内容。' : (ok ? `${esc(j.source)} · 信息以来源平台为准` : '来源要素不完整，外部入口已停用。'), seal: null, place: ' ', status: st },
        body: jobDetailBody(),
        dock: {
          left: goBtn('btn sec', `${icon('chevL', 30, 2.4)}返回岗位列表`, 'b-jobs'),
          ask: '问小青：这个岗位怎么看？',
          mid: `<button class="btn sec" type="button" data-fj="qr"${dis}>扫码投递</button><button class="btn pri" type="button" data-fj="qr"${dis}>去来源平台投递${icon('arrowR', 30, 2.4)}</button>`
        },
        nav: ''
      });
    },
    mount(el) {
      return mount(el, (k, arg) => {
        const s = S();
        if (k === 'close') { s.fjDrawer = ''; s.fjQr = false; refresh(); return; }
        if (k === 'qr') { if (missingOf(curJob()).length) return; s.fjQr = true; refresh(); return; }
        if (k === 'fav') { const a = saved(); const i = a.indexOf(arg); if (i >= 0) a.splice(i, 1); else a.push(arg); refresh(); return; }
        if (k === 'ai-off') { s.fjAiOff = !s.fjAiOff; s.fjAiKind = arg || s.fjAiKind; refresh(); return; }
        if (k === 'ai-open') {
          s.fjAiKind = arg || 'explain'; s.fjAiOff = false;
          if (!s.fjConsent) { s.fjDrawer = 'consent'; refresh(); return; }
          if (s.fjAiKind === 'match') { s.fjDrawer = 'pick'; refresh(); return; }
          s.fjAi = 'load'; refresh(); return;
        }
        if (k === 'consent-ok') { s.fjConsent = true; s.fjDrawer = ''; if (s.fjAiKind === 'match') s.fjDrawer = 'pick'; else s.fjAi = 'load'; refresh(); return; }
        if (k === 'use-resume') { s.fjDrawer = ''; s.fjAi = 'load'; s.fjAiKind = 'match'; refresh(); return; }
        if (k === 'ai-clear') { s.fjAi = ''; s.fjAiMsg = ''; refresh(); return; }
        if (k === 'ai-retry') { s.fjAi = 'load'; refresh(); return; }
        if (k === 'job-retry') { s.fjJobErr = false; s.fjJobLoad = true; refresh(); return; }
        if (k === 'demo:ai-done') { s.fjAi = 'explain'; s.fjAiKind = 'explain'; s.fjDrawer = ''; s.fjJobLoad = false; refresh(); return; }
        if (k === 'demo:ai-fail') { s.fjAi = 'fail'; s.fjAiKind = 'explain'; s.fjAiMsg = '这次没有生成出解读，请稍后重试。'; s.fjDrawer = ''; refresh(); return; }
        if (k === 'demo:match-done') { s.fjAi = 'match'; s.fjAiKind = 'match'; s.fjDrawer = ''; refresh(); return; }
        if (k === 'demo:match-fail') { s.fjAi = 'fail'; s.fjAiKind = 'match'; s.fjAiMsg = '这次没有生成出匹配参考，请稍后重试。'; refresh(); return; }
        if (k === 'demo:reload-ok') { s.fjJobLoad = false; s.fjJobErr = false; refresh(); return; }
      });
    }
  });

  /* ---------- offline job ---------- */
  function offJob() {
    const s = S();
    if (s.fjOffBad) return OJOBS['oj-3'];
    return OJOBS[s.fjOffJob || 'oj-1'] || OJOBS['oj-1'];
  }
  function agencyBy(id) { return AGENCIES.find((a) => a.id === id) || AGENCIES[0]; }
  add('b-job-offline', G, '线下岗位详情', {
    demo: [{ label: '演示：岗位重新取到', ev: 'reload-ok' }, { label: '演示：仍读不到', ev: 'reload-fail' }, { label: '演示：咨询问题生成了', ev: 'prep-done' }],
    notes: {
      does: '运行页 /jobs/:id/offline，OfflineJobDetailPage.tsx。岗位概要、要求、来源核对、到店指引。按钮「查看来源机构门店」「上传自备材料打印」（打印去 /print/upload，稿屏 print-src）。',
      motion: '按下缩小。咨询问题等演示事件 prep-done，不自动编一份清单。',
      keep: '边界运行页原句：「本机只做机构信息展示、门店指引和材料打印：不代收简历、不代投递，也不记录你到店后的结果。」屏上照用这句。来源不全时不给外跳和到店指引，原因用 sourceTrustReason，并写明没有代办这条路。电话缺省时运行页点名门店现场的人，屏上改为「来源未提供电话」。小青不可用时出路是运行页 fallback：不靠 AI 也能问清楚岗位要求、材料清单、收费公示。普通页 3 分钟。顶栏「线下岗位 · 自行到店咨询」，不报打印机。' + HELP_NOTE
    },
    render: () => {
      const s = S();
      const j = offJob();
      const ag = agencyBy(j.agencyId);
      const bad = !!j.bad || !!s.fjOffBad;
      const miss = [];
      if (!ag.name) miss.push('来源机构');
      if (!j.sync) miss.push('同步时间');
      if (!j.ext) miss.push('外部ID');
      if (!j.url) miss.push('外部投递链接');
      if (s.fjOffLoad) {
        return F({
          band: { kind: 'compact', eyebrow: '线下机构岗位', title: '正在读这条线下岗位', sub: '取到之前不显示岗位名称或来源编号。', seal: null, place: ' ', status: { text: '正在读取线下岗位' } },
          body: `<section class="fj-card fj-grow"><h2>正在读取线下岗位</h2><p class="fj-note">取到之前不显示岗位名称或来源编号。</p>${helpLine()}</section>`,
          dock: { left: goBtn('btn sec', `${icon('chevL', 30, 2.4)}返回机构`, 'b-agencies'), ask: '问小青：到店要带什么？' }, nav: ''
        });
      }
      if (s.fjOffErr) {
        return F({
          band: { kind: 'compact', eyebrow: '线下机构岗位', title: '这条岗位没读到', sub: '不会拿别的岗位顶上。', seal: null, place: ' ', status: { text: '岗位信息读取失败', warn: 1 } },
          body: `<section class="fj-card fj-grow"><h2>岗位信息加载失败</h2><button class="fj-link" type="button" data-fj="off-retry"><b>重试</b><small>再请求一次</small></button>${helpLine()}<p class="fj-note">${B_OFF}</p></section>`,
          dock: { ask: '问小青：到店要带什么？', pri: { label: '回机构目录', go: 'b-agencies' } }, nav: ''
        });
      }
      const prep = s.fjPrep === 'done'
        ? `<p class="fj-note"><b>可以当面问的三件事</b>　岗位还招不招、要带哪些材料、收费贴在哪里。</p>${aiMark()}`
        : s.fjPrep === 'load' ? '<p class="fj-note">正在整理咨询问题…好了以前不展示清单。</p>'
          : (s.fjPrepNote ? `<p class="fj-warn">${esc(s.fjPrepNote)}</p>` : '');
      const aiAct = !s.logged ? goBtn('fj-link', '<b>整理咨询问题</b><small>要先登录</small>', 'login')
        : (s.ai === 'down' ? `<button class="fj-link" type="button" data-fj="prep-off"><b>整理咨询问题</b><small>不靠小青也能问</small></button>` : `<button class="fj-link" type="button" data-fj="prep"><b>整理咨询问题</b><small>不生成机构或岗位信息</small></button>`);
      const body = bad ? `<section class="fj-card"><h2>${esc(j.title)} <span class="fj-tag clay">来源要素不足</span></h2><p class="fj-sub">${esc(ag.name)} · ${esc(j.loc)}</p>
          <div class="fj-metric"><span><small>薪资待遇</small><b>${esc(j.salary)}</b></span><span><small>岗位类型</small><b>${esc(j.type)}</b></span></div></section>
        <section class="fj-card fj-grow"><h2>来源信息不完整 · 已停用外跳</h2><p class="fj-note">这条线下岗位没有凑齐可核对的来源要素，本机不提供外跳、扫码或到店指引。</p>
          <p class="fj-warn">${esc(miss.map((m) => m + ' —— 未返回').join('；'))}</p>
          <p class="fj-note">${esc(blockReason({ source: ag.name, sync: j.sync, ext: j.ext, url: j.url }))} 线下岗位没有代收简历这条路：本机既不代收简历也不代投递。</p>
          <div class="fj-acts">${goBtn('fj-link', '<b>回机构目录重新找</b><small>目录里的机构带地址与来源编号</small>', 'b-agencies')}${goBtn('fj-link', '<b>先把材料打好</b><small>不依赖这条岗位信息</small>', 'print-src')}</div>
          <p class="fj-note">${B_OFF}</p></section>`
        : `<section class="fj-card"><h2>${esc(j.title)} <span class="fj-tag">线下岗位</span></h2><p class="fj-sub">${esc(j.loc)} · ${esc(ag.name)}</p>
          <div class="fj-metric"><span><small>薪资待遇</small><b>${esc(j.salary)}</b></span><span><small>岗位类型</small><b>${esc(j.type)}</b></span><span><small>学历要求</small><b>${esc(j.edu)}</b></span></div>
          <div class="fj-acts">${aiAct}</div>${prep}
          <p class="fj-k">小青不可用时，不靠 AI 也能问清楚岗位要求、材料清单、收费公示。</p></section>
        <div class="fj-cols"><section class="fj-card"><h2>任职要求</h2>${j.reqs.length ? `<ul>${j.reqs.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="fj-note">暂无任职要求说明，请到门店咨询。</p>'}</section>
          <section class="fj-card"><h2>工作职责</h2>${j.duties.length ? `<ul>${j.duties.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="fj-note">暂无职责说明，请到门店咨询。</p>'}</section></div>
        <section class="fj-card fj-grow"><h2>发布机构与到店指引</h2>
          <div class="fj-kvs stretch">
            <div class="fj-kv"><small>机构名称</small><b>${esc(ag.name)}</b></div>
            <div class="fj-kv"><small>机构类型</small><b>${esc(ag.type)}</b></div>
            <div class="fj-kv"><small>营业时间</small><b>${esc(ag.hours)}</b></div>
            <div class="fj-kv"><small>联系电话</small><b>${esc(ag.phone || '来源未提供电话')}</b></div>
            <div class="fj-kv"><small>机构地址</small><b>${esc(ag.address)}</b></div>
            <div class="fj-kv"><small>来源编号</small><b>${esc(j.ext)}</b></div>
            <div class="fj-kv"><small>同步时间</small><b>${esc(j.sync)}</b></div>
            <div class="fj-kv"><small>来源网站</small><b>${esc(j.host)}</b></div>
          </div>
          <p class="fj-note">来源说明：岗位与机构内容由来源机构发布并经管理员审核，本机只做展示。先核对地址、营业时间和收费公示，再自行到店。${B_OFF}</p>
        </section>`;
      const storeDis = bad ? ' aria-disabled="true"' : '';
      return F({
        band: { kind: 'compact', eyebrow: '线下机构岗位', title: bad ? '这条岗位对不上来源' : '要不要自己到店问？', sub: bad ? '缺少可核对的来源要素，外跳和到店指引一律不给。' : '先看岗位信息，再决定要不要自行到店咨询。', seal: null, place: ' ', status: bad ? { text: '来源要素不完整 · 已停用外跳', warn: 1 } : { text: '线下岗位 · 自行到店咨询' } },
        body,
        dock: bad
          ? { left: goBtn('btn sec', `${icon('chevL', 30, 2.4)}回机构目录`, 'b-agencies'), ask: '问小青：到店要带什么？', mid: `<button class="btn sec" type="button" aria-disabled="true">查看来源机构门店</button>`, pri: { label: '上传自备材料打印', go: 'print-src' } }
          : { left: goBtn('btn sec', `${icon('chevL', 30, 2.4)}返回机构`, 'b-agency', 'fjAgency=' + ag.id), ask: '问小青：到店要带什么？', mid: `<button class="btn sec" type="button" data-go="b-agency" data-set="fjAgency=${ag.id}"${storeDis}>查看来源机构门店</button>`, pri: { label: '上传自备材料打印', go: 'print-src' } },
        nav: ''
      });
    },
    mount(el) {
      return mount(el, (k) => {
        const s = S();
        if (k === 'off-retry') { s.fjOffErr = false; s.fjOffLoad = true; refresh(); return; }
        if (k === 'prep') { s.fjPrep = 'load'; s.fjPrepNote = ''; refresh(); return; }
        if (k === 'prep-off') { s.fjPrepNote = '本机没有连上 AI 服务，因此不会给你一份编出来的问题清单。不靠 AI 也能问清楚：岗位要求、材料清单、收费公示，到店当面确认这三项。'; s.fjPrep = ''; refresh(); return; }
        if (k === 'demo:reload-ok') { s.fjOffLoad = false; s.fjOffErr = false; refresh(); return; }
        if (k === 'demo:reload-fail') { s.fjOffLoad = false; s.fjOffErr = true; refresh(); return; }
        if (k === 'demo:prep-done') { s.fjPrep = 'done'; refresh(); return; }
      });
    }
  });

  /* ---------- agencies ---------- */
  function agFiltered() {
    const s = S();
    return AGENCIES.filter((a) => {
      if (s.fjDist && a.district !== s.fjDist) return false;
      if (s.fjOrgType && a.typeKey !== s.fjOrgType) return false;
      if (s.fjSvc && !(a.services || []).includes(s.fjSvc)) return false;
      return true;
    });
  }
  add('b-agencies', G, '线下招聘机构', {
    demo: [{ label: '演示：名单重新取到', ev: 'reload-ok' }, { label: '演示：名单仍失败', ev: 'reload-fail' }],
    notes: {
      does: '运行页 /offline-agencies，OfflineAgenciesPage.tsx。四项筛选：关键词、区域、服务项目、机构类型，收进本屏抽屉。机构行去机构详情。',
      motion: '按下缩小。重新读取后停在读取中，等演示事件。',
      keep: '状态：正在读取机构名单、机构名单读取失败、当前条件没有匹配机构。失败和空态运行页写了找现场的人，屏上改为服务电话，并给「去帮助中心」「清除条件」。每行带「机构信息已审核」，不把审核说成资质核验。收录状态：已发布 / 暂停收录 / 收录状态未知。边界原句见线下岗位 notes。普通页 3 分钟。顶栏不报打印机。关键词搜索是「演示：弹出屏上键盘」，服务项目用已出现的词做芯片，不编输入结果。' + HELP_NOTE
    },
    render: () => {
      const s = S();
      const list = agFiltered();
      const pill = s.fjAgLoad ? { text: '正在读取机构名单' } : s.fjAgErr ? { text: '机构名单读取失败', warn: 1 } : (!list.length || s.fjAgEmpty) ? { text: '当前条件没有匹配机构', warn: 1 } : { text: (s.fjDist || s.fjOrgType || s.fjSvc) ? '已按检索方式重新取名单' : '已发布机构名单' };
      const sub = s.fjAgLoad ? '正在读取名单，取到之前不显示机构名称或数量。' : s.fjAgErr ? '名单没取到，不会拿示例机构顶替真实结果。' : (s.fjAgEmpty || !list.length) ? '这些条件没有匹配的门店，换个条件再试。' : '先缩小范围，再看已发布的机构名单。';
      const drawer = s.fjDrawer === 'ag' ? ov(`<h2>缩小范围</h2><p class="fj-note">四项都会真正用来筛选，可单选也可组合。区县、服务项目和机构类型按你点的项精确筛选；没有结果就如实空着。</p>
        <button class="fj-search" type="button" data-act="toast" data-arg="演示：弹出屏上键盘，用来填机构名称">${icon('keyboard', 28, 2)}输入机构名称、地址或说明关键词</button>
        <p class="fj-k">区域</p><div class="fj-chips">${['', '珠海香洲', '佛山南海', '东莞松山湖'].map((d) => `<button type="button" data-fj="dist" data-fjarg="${esc(d)}" aria-pressed="${(s.fjDist || '') === d ? 'true' : 'false'}">${d || '全部'}</button>`).join('')}</div>
        <p class="fj-k">服务项目</p><div class="fj-chips">${['', '职业介绍', '政策咨询', '到店咨询', '材料打印指引', '岗位问询'].map((d) => `<button type="button" data-fj="svc" data-fjarg="${esc(d)}" aria-pressed="${(s.fjSvc || '') === d ? 'true' : 'false'}">${d || '全部'}</button>`).join('')}</div>
        <p class="fj-k">机构类型</p><div class="fj-chips">${[['', '全部类型'], ['recruitment', '招聘服务机构'], ['public_employment_service', '公共就业服务机构'], ['licensed_hr_agency', '持证人力资源机构']].map(([v, lab]) => `<button type="button" data-fj="otype" data-fjarg="${v}" aria-pressed="${(s.fjOrgType || '') === v ? 'true' : 'false'}">${lab}</button>`).join('')}</div>
        <div class="fj-rowbtns"><button class="btn sec" type="button" data-fj="ag-clear">清除全部</button><button class="btn pri" type="button" data-fj="close">看名单</button></div>`) : '';
      let core = '';
      if (s.fjAgLoad) core = `<section class="fj-card fj-grow"><h2>正在读取已发布机构名单</h2><p class="fj-note">取到名单之前，这里不显示任何机构名称、数量或收录状态。名单来自来源机构同步并经管理员审核发布。</p><p class="fj-note">${B_OFF}</p></section>`;
      else if (s.fjAgErr) core = `<section class="fj-card fj-grow"><h2>机构名单没取到</h2><p class="fj-note">这次请求失败了。本机不会用示例机构顶替真实结果，所以目录先空着。</p><div class="fj-acts"><button class="fj-link" type="button" data-fj="ag-retry"><b>重试</b><small>再请求一次</small></button>${goBtn('fj-link', '<b>去帮助中心</b><small>常见问题</small>', 'help')}</div>${helpLine()}<p class="fj-note">${B_OFF}</p></section>`;
      else if (s.fjAgEmpty || !list.length) core = `<section class="fj-card fj-grow"><h2>当前条件没有匹配的机构</h2><p class="fj-note">换个关键词或检索方式再试一次。机构信息需要管理员审核发布后才会出现在目录里。</p><button class="fj-link" type="button" data-fj="ag-clear"><b>清除条件重新查询</b><small>区域、服务、类型都清掉</small></button>${helpLine()}<p class="fj-note">${B_OFF}</p></section>`;
      else core = `<section class="fj-card fj-grow"><p class="fj-meta">已收录机构 · 共 ${list.length} 家 · ${ (s.fjDist || s.fjSvc || s.fjOrgType) ? '已应用检索条件' : '本机只做门店指引，不代收简历' }</p>
        ${list.map((a) => `<button class="fj-main" type="button" data-go="b-agency" data-set="fjAgency=${a.id}"><b>${esc(a.name)} <span class="fj-tag ${a.status === '已发布' ? '' : 'clay'}">${esc(a.status)}</span> <span class="fj-tag slate">机构信息已审核</span></b><small>${esc(a.address)}</small><small>${esc(a.hours)} · ${esc(a.district)} · 来源编号 ${esc(a.orgCode)}</small><small>${esc(a.services.join('、'))}</small></button>`).join('')}
        <p class="fj-note">${B_OFF}</p>
        <div class="fj-acts">${goBtn('fj-link', '<b>打印自备材料</b><small>登记表、复印件、自带简历，A4 黑白</small>', 'print-src')}${goBtn('fj-link', '<b>纸质材料扫成 PDF</b><small>在打印机面板上扫，文件回本机取</small>', 'scan-guide')}</div>
      </section>`;
      return F({
        band: { kind: 'compact', eyebrow: '线下招聘机构', title: '想去哪家门店问？', sub, seal: null, place: ' ', status: pill },
        body: `${drawer}<div class="fj-tool"><button class="fj-search" type="button" data-act="toast" data-arg="演示：弹出屏上键盘">${icon('keyboard', 28, 2)}搜索机构名称</button><button class="fj-mini" type="button" data-fj="drawer" data-fjarg="ag">筛选</button></div>${core}`,
        dock: { left: goBtn('btn sec', `${icon('chevL', 30, 2.4)}返回社会招聘`, 'b-social'), ask: '问小青：到店要带什么？', mid: `<button class="btn pri" type="button" data-fj="drawer" data-fjarg="ag">筛选机构${icon('arrowR', 30, 2.4)}</button>` },
        nav: ''
      });
    },
    mount(el) {
      return mount(el, (k, arg) => {
        const s = S();
        if (k === 'drawer') { s.fjDrawer = arg; refresh(); return; }
        if (k === 'close') { s.fjDrawer = ''; refresh(); return; }
        if (k === 'dist') { s.fjDist = arg; s.fjAgEmpty = false; refresh(); return; }
        if (k === 'svc') { s.fjSvc = arg; s.fjAgEmpty = false; refresh(); return; }
        if (k === 'otype') { s.fjOrgType = arg; s.fjAgEmpty = false; refresh(); return; }
        if (k === 'ag-clear') { s.fjDist = ''; s.fjSvc = ''; s.fjOrgType = ''; s.fjAgEmpty = false; s.fjDrawer = ''; refresh(); return; }
        if (k === 'ag-retry') { s.fjAgErr = false; s.fjAgLoad = true; refresh(); return; }
        if (k === 'demo:reload-ok') { s.fjAgLoad = false; s.fjAgErr = false; refresh(); return; }
        if (k === 'demo:reload-fail') { s.fjAgLoad = false; s.fjAgErr = true; refresh(); return; }
      });
    }
  });

  /* ---------- agency detail ---------- */
  function curAg() { return agencyBy(S().fjAgency || 'ag-cheng'); }
  add('b-agency', G, '机构详情', {
    demo: [{ label: '演示：详情重新取到', ev: 'reload-ok' }, { label: '演示：仍读不到', ev: 'reload-fail' }],
    notes: {
      does: '运行页 /offline-agencies/:id，OfflineAgencyDetailPage.tsx:39。地址、电话、营业时间、本机构岗位行。行上「查看岗位」进线下岗位详情。',
      motion: '按下缩小。重新加载后停在读取中，等演示事件。',
      keep: '岗位行为 0 是真的空，不造岗位。运行页空态和失败态写了找现场的人，屏上改为服务电话。电话缺省也不写那个称呼。收录状态写「机构信息已审核」，并写「没有可核对的资质项时，这里不展示资质核验结论」。收费以门店公示为准，本机不代收任何费用。边界原句在线下岗位 notes。普通页 3 分钟。顶栏不报打印机。' + HELP_NOTE
    },
    render: () => {
      const s = S();
      const a = curAg();
      const jobs = (a.jobs || []).map((id) => OJOBS[id]).filter(Boolean);
      const skel = (keys) => `<div class="fj-facts">${keys.map((k) => `<div class="fj-kv"><small>${k}</small><b>正在读取</b></div>`).join('')}</div>`;
      if (s.fjAgLoad) return F({ cls: 'fj-ag', band: { kind: 'compact', eyebrow: '机构详情', title: '正在读这家机构', sub: '正在读取机构资料和岗位清单。', seal: null, place: ' ', status: { text: '正在读取机构详情' } }, body: `<section class="fj-card"><h2>正在读取机构详情</h2>${skel(['机构类型', '服务项目', '营业时间', '联系电话', '来源编号', '收录状态'])}</section><div class="fj-skel"><i>岗位 · 正在读取</i><i>岗位 · 正在读取</i></div><div class="fj-visit"><div><b>到店之前</b><small>正在读取</small></div><div><b>材料</b><small>正在读取</small></div><div><b>收费</b><small>正在读取</small></div></div>`, dock: { ask: '问小青：这家机构怎么去？', pri: { label: '返回机构目录', go: 'b-agencies' } }, nav: '' });
      if (s.fjAgErr) return F({ cls: 'fj-ag', band: { kind: 'compact', eyebrow: '机构详情', title: '这家机构没读到', sub: '这次没有取到，请重新加载，或回目录换一家。', seal: null, place: ' ', status: { text: '机构详情读取失败', warn: 1 } }, body: `<section class="fj-card"><h2>机构详情读取失败</h2><p class="fj-note">这次没有取到机构资料和岗位清单。本机不会把上一次看到的内容当作这次的结果。</p>${helpLine()}</section><div class="fj-acts"><button class="fj-link" type="button" data-fj="ag-retry"><b>重新加载机构详情</b><small>再次请求当前机构</small></button>${goBtn('fj-link', '<b>返回机构目录</b><small>换一家已发布的机构</small>', 'b-agencies')}</div><p class="fj-note">${B_OFF}</p>`, dock: { ask: '问小青：这家机构怎么去？', mid: `<button class="btn pri" type="button" data-fj="ag-retry">重新加载${icon('arrowR', 30, 2.4)}</button>` }, nav: '' });
      if (s.fjAgMiss) return F({ cls: 'fj-ag', band: { kind: 'compact', eyebrow: '机构详情', title: '这家机构不在目录里', sub: '未发布、已下架或链接过期，回目录重选一次。', seal: null, place: ' ', status: { text: '机构未发布或链接已失效', warn: 1 } }, body: `<section class="fj-card"><h2>机构详情不可用</h2><p class="fj-note">这家机构可能未发布、已下架，或这条链接已经过期。本机不会用同名或附近的机构顶替。</p>${helpLine()}</section><div class="fj-acts">${goBtn('fj-link', '<b>回机构目录</b><small>重新检索已发布机构</small>', 'b-agencies')}${goBtn('fj-link', '<b>看岗位信息</b><small>按岗位找其他来源</small>', 'b-jobs')}</div><p class="fj-note">${B_OFF}</p>`, dock: { ask: '问小青：这家机构怎么去？', pri: { label: '回机构目录重选', go: 'b-agencies' } }, nav: '' });
      const empty = jobs.length === 0;
      const rows = empty
        ? `<section class="fj-card"><h2>该机构当前没有已发布岗位</h2><p class="fj-note">可以到店咨询服务项目，或去看其他来源的岗位。</p><div class="fj-acts">${goBtn('fj-link', '<b>回机构目录</b><small>换一家门店</small>', 'b-agencies')}${goBtn('fj-link', '<b>看岗位信息</b><small>按岗位找</small>', 'b-jobs')}</div></section>`
        : `<section class="fj-card"><h2>该机构的岗位</h2><p class="fj-meta">已发布岗位 · 共 ${jobs.length} 条 · 岗位由机构发布，本机不代投递</p>${jobs.map((j) => {
          const duty = j.duties.length ? '职责：' + j.duties.join('；') : '职责：以门店说明为准';
          const req = j.reqs.length ? '要求：' + j.reqs.join('；') : '要求：以门店说明为准';
          return goBtn('fj-jobbig', `<span class="ic">${icon('clipboard', 36, 2)}</span><span><b>${esc(j.title)}</b><small>${esc(j.loc || a.address)} · ${esc(j.type)} · ${esc(j.salary)}</small><small>${esc(req)}</small><small>${esc(duty)}</small></span>`, 'b-job-offline', 'fjOffJob=' + j.id + ';fjOffBad=' + (j.bad ? 'true' : 'false'));
        }).join('')}</section>`;
      return F({
        cls: 'fj-ag',
        band: { kind: 'compact', eyebrow: '机构详情', title: esc(a.name), sub: empty ? '机构资料可用，但当前没有已发布岗位。到店咨询办理。' : '地址、营业时间和服务项目以机构依法公示为准。到店咨询办理。', seal: null, place: ' ', status: empty ? { text: '机构已发布 · 当前岗位为 0', warn: 1 } : { text: '机构资料 · 以门店公示为准' } },
        body: `<section class="fj-card"><h2>门店信息</h2><p class="fj-sub">${esc(a.address)}</p>
          <div class="fj-facts">
            <div class="fj-kv"><small>机构类型</small><b>${esc(a.type)}</b></div>
            <div class="fj-kv"><small>服务项目</small><b>${esc(a.services.join('、'))}</b></div>
            <div class="fj-kv"><small>营业时间</small><b>${esc(a.hours)}</b></div>
            <div class="fj-kv"><small>联系电话</small><b>${esc(a.phone || '来源未提供电话')}</b></div>
            <div class="fj-kv"><small>来源编号</small><b>${esc(a.orgCode)}</b></div>
            <div class="fj-kv"><small>收录状态</small><b>机构信息已审核</b></div>
          </div></section>
        ${rows}
        <div class="fj-visit">
          <div><b>1 先核对地址和营业时间</b><small>${esc(a.address)}。${esc(a.hours)}。以机构公示为准。</small></div>
          <div><b>2 带上本人材料，自己到店问</b><small>服务项目：${esc(a.services.join('、'))}。本机不代你到店，也不记录你到店后的结果。</small></div>
          <div><b>3 收费看门店公示</b><small>本机不代收任何费用。${HELP}</small></div>
        </div>
        <p class="fj-note">${B_OFF}</p>`,
        dock: empty
          ? { left: goBtn('btn sec', `${icon('chevL', 30, 2.4)}返回机构目录`, 'b-agencies'), ask: '问小青：这家机构怎么去？', pri: { label: '去看岗位信息', go: 'b-jobs' } }
          : { left: goBtn('btn sec', `${icon('chevL', 30, 2.4)}返回机构目录`, 'b-agencies'), ask: '问小青：这家机构怎么去？', mid: `<button class="btn pri" type="button" data-go="b-job-offline" data-set="fjOffJob=${jobs[0].id};fjOffBad=${jobs[0].bad ? 'true' : 'false'}">查看岗位${icon('arrowR', 30, 2.4)}</button>` },
        nav: ''
      });
    },
    mount(el) {
      return mount(el, (k) => {
        const s = S();
        if (k === 'ag-retry') { s.fjAgErr = false; s.fjAgLoad = true; refresh(); return; }
        if (k === 'demo:reload-ok') { s.fjAgLoad = false; s.fjAgErr = false; refresh(); return; }
        if (k === 'demo:reload-fail') { s.fjAgLoad = false; s.fjAgErr = true; refresh(); return; }
      });
    }
  });

  /* The dock pri go for agency doesn't pass job id. Fix by custom dock in a moment if audit clicks 查看岗位 and lands on default offline job — that is a real screen. OK. */

  /* ---------- companies ---------- */
  function coBy(id) { return COS.find((c) => c.id === id) || null; }
  function cosFiltered() {
    const s = S();
    return COS.filter((c) => {
      if (s.fjInd && c.industryKey !== s.fjInd) return false;
      if (s.fjRegion && c.city !== s.fjRegion) return false;
      if (s.fjRecruit && !(c.recruit || []).includes(s.fjRecruit)) return false;
      if (s.fjKind && c.kindKey !== s.fjKind) return false;
      return true;
    });
  }
  function metricsOn() { return !S().fjMetricsOff; }
  add('b-companies', G, '找企业', {
    demo: [{ label: '演示：目录重新取到', ev: 'reload-ok' }, { label: '演示：目录仍失败', ev: 'reload-fail' }],
    notes: {
      does: '运行页 /companies，CompaniesPage.tsx:115。筛选：行业、地区、招聘类型（社招 / 校招 / 实习 / 兼职 / 招聘会参展）、来源种类，收进抽屉。企业行去企业详情。',
      motion: '按下缩小。',
      keep: '边界运行页原句：「本机只做来源企业与岗位导览：不收简历、不做筛选、不安排面试，投递在来源平台完成。」屏上「不收简历」写成「不代收简历」。企业指标受管理员开关控制：showOpenJobCount、showCity、showEmployeeScale、showBoothNo。关闭或数据为空都不展示，不写 0 顶替。默认四项开着；S().fjMetricsOff 为真时指标条不画。列表上的在招岗位数对应 showOpenJobCount。地址里的城市是资料字段，不是 showCity 那一格。小青「按本人简历排出先看哪几家」不可用时仍可按筛选自己看。空、失败有清除筛选和去岗位信息。普通页 3 分钟。顶栏不报打印机。' + HELP_NOTE
    },
    render: () => {
      const s = S();
      const list = cosFiltered();
      const on = metricsOn();
      const filtered = !!(s.fjInd || s.fjRegion || s.fjRecruit || s.fjKind);
      const pill = s.fjCoLoad ? { text: '正在读取企业目录' } : s.fjCoErr ? { text: '企业目录读取失败', warn: 1 } : (s.fjCoEmpty || !list.length) ? { text: '当前筛选没有匹配企业', warn: 1 } : { text: filtered ? '已按筛选条件重新请求' : '已审核发布的企业' };
      const openSum = list.reduce((n, c) => n + c.open, 0);
      const drawer = s.fjDrawer === 'co' ? ov(`<h2>按条件找企业</h2><p class="fj-note">行业、地区、招聘类型、来源种类都对应真实查询。选完立即用于筛选。</p>
        <p class="fj-k">行业</p><div class="fj-chips">${[['', '全部'], ['物流', '交通物流'], ['医疗', '医疗健康'], ['制造', '智能制造'], ['材料', '新材料'], ['零售', '商贸零售'], ['文旅', '文旅传媒']].map(([v, lab]) => `<button type="button" data-fj="ind" data-fjarg="${v}" aria-pressed="${(s.fjInd || '') === v ? 'true' : 'false'}">${lab}</button>`).join('')}</div>
        <p class="fj-k">地区</p><div class="fj-chips">${['', '佛山', '珠海', '东莞', '中山', '惠州', '江门'].map((v) => `<button type="button" data-fj="region" data-fjarg="${esc(v)}" aria-pressed="${(s.fjRegion || '') === v ? 'true' : 'false'}">${v || '全部城市'}</button>`).join('')}</div>
        <p class="fj-k">招聘类型</p><div class="fj-chips">${[['', '全部'], ['fulltime', '社招'], ['campus', '校招'], ['intern', '实习'], ['parttime', '兼职'], ['fair', '招聘会参展']].map(([v, lab]) => `<button type="button" data-fj="recruit" data-fjarg="${v}" aria-pressed="${(s.fjRecruit || '') === v ? 'true' : 'false'}">${lab}</button>`).join('')}</div>
        <p class="fj-k">来源种类</p><div class="fj-chips">${[['', '全部'], ['public_employment_service', '人社平台'], ['school_employment_center', '大学就业网'], ['fair_organizer', '招聘会主办方'], ['licensed_hr_agency', '第三方合规平台']].map(([v, lab]) => `<button type="button" data-fj="kind" data-fjarg="${v}" aria-pressed="${(s.fjKind || '') === v ? 'true' : 'false'}">${lab}</button>`).join('')}</div>
        <div class="fj-rowbtns"><button class="btn sec" type="button" data-fj="co-clear">清除全部筛选</button><button class="btn pri" type="button" data-fj="close">看企业</button></div>`) : '';
      let core = '';
      if (s.fjCoLoad) core = `<section class="fj-card fj-grow"><h2>正在读取企业目录与统计</h2><p class="fj-note">企业列表与在招岗位数同一次请求返回；取到之前不显示任何企业名称或数字。</p><p class="fj-note">${B_CO}</p></section>`;
      else if (s.fjCoErr) core = `<section class="fj-card fj-grow"><h2>企业目录没取到</h2><p class="fj-note">列表与在招岗位数一起失败了。数字不会退回到固定值，也不会写 0 顶替。</p><div class="fj-acts"><button class="fj-link" type="button" data-fj="co-retry"><b>重试</b><small>再请求目录</small></button>${goBtn('fj-link', '<b>去岗位信息</b><small>改按岗位找</small>', 'b-jobs')}</div>${helpLine()}</section>`;
      else if (s.fjCoEmpty || !list.length) core = `<section class="fj-card fj-grow"><h2>当前筛选没有匹配的企业</h2><p class="fj-note">少选两个条件再试；企业需审核通过并发布后才会进入目录。</p><div class="fj-acts"><button class="fj-link" type="button" data-fj="co-clear"><b>清除全部筛选</b><small>行业、地区、类型、来源</small></button>${goBtn('fj-link', '<b>去岗位信息</b><small>改按岗位找</small>', 'b-jobs')}</div><p class="fj-note">${B_CO}</p></section>`;
      else {
        const rank = s.fjRank === 'done' ? `<p class="fj-ai">${AI_MARK}　按岗位原文，建议先看岭南津渡物流（示例）的仓储现场主管，再看北岸精工坊（示例）。不改企业事实，也不打百分比。</p>` : (s.fjRank === 'load' ? '<p class="fj-note">正在按岗位内容排序…好了以前不展示顺序。</p>' : (s.fjRankNote ? `<p class="fj-warn">${esc(s.fjRankNote)}</p>` : ''));
        const rankBtn = ''; /* 运行页找企业没有「按简历排序」，不画（agy 反方 10/27：也容易被看成撮合） */
        const page = Math.max(1, +(s.fjCoPage || 1));
        const pages = Math.max(1, Math.ceil(list.length / 3));
        const slice = list.slice((page - 1) * 3, page * 3);
        const fairN = list.filter((c) => c.fair).length;
        core = `<section class="fj-card fj-grow"><p class="fj-meta">已发布企业 · 共 ${list.length} 条${on ? ` · 在招岗位 ${openSum} 个${fairN ? ` · 招聘会参展 ${fairN} 家` : ''}` : ' · 在招岗位数这项已关闭'}${pages > 1 ? ` · 第 ${page}/${pages} 批` : ''} <span class="fj-pager"><button type="button" data-fj="co-page" data-fjarg="-1" ${page <= 1 ? 'disabled' : ''}>上一批</button><button type="button" data-fj="co-page" data-fjarg="1" ${page >= pages ? 'disabled' : ''}>下一批</button></span></p>
          ${slice.map((c) => {
            const no = c.open === 0;
            const side = on ? `<span class="fj-tag">${c.open} 个在招</span>` : '';
            const jobsBtn = no
              ? `<button class="fj-mini" type="button" aria-disabled="true">查看岗位</button><p class="fj-k">该企业当前没有在招岗位</p>`
              : goBtn('fj-mini', '查看岗位', 'b-company', 'fjCo=' + c.id);
            return `<div class="fj-row"><button class="fj-main" type="button" data-go="b-company" data-set="fjCo=${c.id}"><b>${esc(c.name)} ${side} ${c.fair ? '<span class="fj-tag clay">招聘会参展</span>' : ''} <span class="fj-tag slate">${esc(c.industry)}</span></b><small>${esc(c.province)} · ${esc(c.city)} · ${esc(c.district)} · 来源 ${esc(c.source)}</small><small>${esc(c.desc)}</small>${c.jobs.length && on ? `<small>代表岗位：${c.jobs.map((id) => esc(jobBy(id).title)).join(' · ')}</small>` : ''}</button><div style="display:flex;flex-direction:column;gap:6px;justify-content:center">${jobsBtn}</div></div>`;
          }).join('')}
          <p class="fj-note">${filtered ? '已应用筛选条件。' : ''}${B_CO}</p>
          ${rankBtn}${rank}
        </section>`;
      }
      return F({
        band: { kind: 'compact', eyebrow: '找企业', title: '想看哪类企业？', sub: s.fjCoLoad ? '企业列表与在招岗位数一起返回，取到之前不显示数字。' : '先定行业和地区，再看企业与在招岗位。', seal: null, place: ' ', status: pill },
        body: `${drawer}<div class="fj-tool"><button class="fj-search" type="button" data-act="toast" data-arg="演示：弹出屏上键盘">${icon('keyboard', 28, 2)}搜索企业 / 岗位</button><button class="fj-mini" type="button" data-fj="drawer" data-fjarg="co">筛选</button></div>${core}`,
        dock: { left: goBtn('btn sec', `${icon('chevL', 30, 2.4)}返回社会招聘`, 'b-social'), ask: '问小青：怎么挑企业？', mid: `<button class="btn pri" type="button" data-fj="drawer" data-fjarg="co">按条件筛选${icon('arrowR', 30, 2.4)}</button>` },
        nav: ''
      });
    },
    mount(el) {
      return mount(el, (k, arg) => {
        const s = S();
        if (k === 'drawer') { s.fjDrawer = arg; refresh(); return; }
        if (k === 'close') { s.fjDrawer = ''; refresh(); return; }
        if (k === 'ind') { s.fjInd = arg; s.fjCoEmpty = false; s.fjCoPage = 1; refresh(); return; }
        if (k === 'region') { s.fjRegion = arg; s.fjCoEmpty = false; s.fjCoPage = 1; refresh(); return; }
        if (k === 'recruit') { s.fjRecruit = arg; s.fjCoEmpty = false; s.fjCoPage = 1; refresh(); return; }
        if (k === 'kind') { s.fjKind = arg; s.fjCoEmpty = false; s.fjCoPage = 1; refresh(); return; }
        if (k === 'co-page') { const all = cosFiltered(); const pages = Math.max(1, Math.ceil(all.length / 3)); s.fjCoPage = Math.min(pages, Math.max(1, (+(s.fjCoPage || 1)) + (+arg))); refresh(); return; }
        if (k === 'co-clear') { s.fjInd = ''; s.fjRegion = ''; s.fjRecruit = ''; s.fjKind = ''; s.fjCoEmpty = false; s.fjCoPage = 1; s.fjDrawer = ''; refresh(); return; }
        if (k === 'co-retry') { s.fjCoErr = false; s.fjCoLoad = true; refresh(); return; }
        if (k === 'rank') { s.fjRank = 'load'; s.fjRankNote = ''; refresh(); return; }
        if (k === 'rank-off') { s.fjRankNote = '小青这次排不了序。筛选、企业资料和岗位原文都还在，可以自己看。'; s.fjRank = ''; refresh(); return; }
        if (k === 'demo:reload-ok') { s.fjCoLoad = false; s.fjCoErr = false; refresh(); return; }
        if (k === 'demo:reload-fail') { s.fjCoLoad = false; s.fjCoErr = true; refresh(); return; }
        if (k === 'demo:rank-done') { s.fjRank = 'done'; refresh(); return; }
      });
    }
  });

  /* ---------- company detail ---------- */
  function curCo() {
    const s = S();
    if (s.fjCoEmpty) return coBy('co-empty');
    return coBy(s.fjCo || 'co-jinnan');
  }
  add('b-company', G, '企业详情', {
    demo: [{ label: '演示：详情重新取到', ev: 'reload-ok' }, { label: '演示：仍读不到', ev: 'reload-fail' }],
    notes: {
      does: '运行页 /companies/:id，CompanyDetailPage.tsx:38。企业资料、来源四项、在招岗位行。行上「查看岗位」去岗位详情，「去来源平台投递」打开二维码层。',
      motion: '按下缩小。二维码层点关闭才收起，不自动跳成功。',
      keep: '不放「投递企业」总按钮。运行页 CompanyDetailPage.tsx:311 的理由：去来源平台投递按该岗位自己的来源链接单独放行，链接不合法就置灰；企业页不设一个总的办理入口。来源四项：来源机构、同步时间、外部 ID、来源链接。数据来源说明运行页原句：「数据来源说明：来源名称、外部ID 与同步时间随企业记录一起返回；缺哪项就空着，不写默认值，也不写「最新」。」指标条同找企业：fjMetricsOff 时不画在招岗位数、城市指标、人员规模、展位号。在招岗位为 0 时「查看岗位」置灰，原因「该企业当前没有在招岗位」。二维码句：「用手机扫码，在来源平台投递」；企业资料码的标题是「用手机扫码，在来源平台查看企业资料」。二维码直接编码来源链接，不经过我方域名。普通页 3 分钟。顶栏不报打印机。' + HELP_NOTE + ' 边界原句含「不收简历」，屏上写「不代收简历」。'
    },
    render: () => {
      const s = S();
      const missScreen = () => F({ cls: 'fj-co', band: { kind: 'compact', eyebrow: '企业详情', title: '这家企业不在目录里', sub: '未发布、已下架或链接失效。', seal: null, place: ' ', status: { text: '企业未发布或链接已失效', warn: 1 } }, body: `<section class="fj-card"><h2>企业详情不可用</h2><p class="fj-note">这家企业可能未发布、已下架，或这条链接已经失效。本机不会拿同名企业或相似企业顶上来。</p>${helpLine()}</section><div class="fj-acts">${goBtn('fj-link', '<b>回企业目录</b><small>按行业和地区重新筛</small>', 'b-companies')}${goBtn('fj-link', '<b>看岗位信息</b><small>直接按岗位找</small>', 'b-jobs')}</div><p class="fj-note">${B_CO}</p>`, dock: { ask: '问小青：这家企业怎么看？', pri: { label: '回企业目录重选', go: 'b-companies' } }, nav: '' });
      if (s.fjCoLoad) return F({ cls: 'fj-co', band: { kind: 'compact', eyebrow: '企业详情', title: '正在读这家企业', sub: '资料、岗位与来源主页缺哪项就不显示哪项。', seal: null, place: ' ', status: { text: '正在读取企业详情' } }, body: `<section class="fj-card"><h2>正在读取企业资料</h2><div class="fj-facts">${['企业类型', '所属行业', '企业地址', '来源机构', '同步时间', '外部编号', '来源链接', '来源种类'].map((k) => `<div class="fj-kv"><small>${k}</small><b>正在读取</b></div>`).join('')}</div></section><div class="fj-skel"><i>在招岗位 · 正在读取</i><i>岗位职责 · 正在读取</i></div><p class="fj-note">${B_CO}</p>`, dock: { ask: '问小青：这家企业怎么看？', pri: { label: '返回企业目录', go: 'b-companies' } }, nav: '' });
      if (s.fjCoMiss || !curCo()) return missScreen();
      if (s.fjCoErr) return F({ cls: 'fj-co', band: { kind: 'compact', eyebrow: '企业详情', title: '这家企业没读到', sub: '企业资料和在招岗位这次没有取回。', seal: null, place: ' ', status: { text: '企业详情读取失败', warn: 1 } }, body: `<section class="fj-card"><h2>企业详情读取失败</h2><p class="fj-note">本机不会用上一次的内容或相似企业顶替。</p>${helpLine()}</section><div class="fj-acts"><button class="fj-link" type="button" data-fj="co-retry"><b>重新加载</b><small>再请求这家企业</small></button>${goBtn('fj-link', '<b>回企业目录</b><small>换一家看</small>', 'b-companies')}</div><p class="fj-note">${B_CO}</p>`, dock: { left: goBtn('btn sec', `${icon('chevL', 30, 2.4)}返回企业目录`, 'b-companies'), ask: '问小青：这家企业怎么看？', mid: `<button class="btn pri" type="button" data-fj="co-retry">重新加载${icon('arrowR', 30, 2.4)}</button>` }, nav: '' });
      const c = curCo();
      const on = metricsOn();
      const jobs = (c.jobs || []).map((id) => jobBy(id));
      const sparse = jobs.length === 0;
      const orgOk = !!(c.source && c.sync && c.ext && c.url && c.host);
      const qrLayer = s.fjQr === 'org' ? ov(`<h2>用手机扫码，在来源平台查看企业资料</h2><div class="fj-qrbox"><div>${qr(4, 220)}</div><div class="fj-cap"><b class="fj-host">${esc(c.host)}</b><p class="fj-warn">示例码，不能扫</p><ol class="fj-steps"><li>手机扫码打开来源平台的企业页。</li><li>浏览、登录都在该平台完成，材料不经过这台机器。</li><li>离开前请关掉二维码，不把账号留在公共终端。</li></ol><p class="fj-note">本机不接收简历、不代投递，也拿不到你的浏览结果。</p></div></div><button class="btn pri" type="button" data-fj="close">关闭</button>`) : '';
      const qrJob = s.fjQr && s.fjQr !== 'org' ? jobBy(s.fjQr) : null;
      const qrJobLayer = qrJob ? ov(`<h2>用手机扫码，在来源平台完成投递</h2><div class="fj-qrbox"><div>${qr(6, 220)}</div><div class="fj-cap"><b class="fj-host">${esc(qrJob.host)}</b><p class="fj-warn">示例码，不能扫</p><p class="fj-note">用手机扫码，在来源平台投递。</p><ol class="fj-steps"><li>手机扫码打开来源平台的岗位页。</li><li>在来源平台登录并办理，材料不经过这台机器。</li><li>面试与结果由来源平台和企业通知你。</li></ol><p class="fj-note">本机不接收简历、不代投递；二维码按该岗位的来源链接生成。</p></div></div><button class="btn pri" type="button" data-fj="close">关闭</button>`) : '';
      const metric = on ? `<div class="fj-metric">${c.open ? `<span><small>在招岗位</small><b>${c.open}</b></span>` : ''}${c.city ? `<span><small>城市</small><b>${esc(c.city)}</b></span>` : ''}${c.scale ? `<span><small>人员规模</small><b>${esc(c.scale)}</b></span>` : ''}${c.booth ? `<span><small>展位</small><b>${esc(c.booth)}</b></span>` : ''}</div>` : `<p class="fj-k">在招岗位数、城市指标、人员规模、展位号这四项管理员已关闭，这里不显示，也不写 0。</p>`;
      const jobCard = (j) => {
        const jok = !missingOf(j).length;
        const apply = jok
          ? `<button class="fj-mini" type="button" data-fj="qr-job" data-fjarg="${j.id}">去来源平台投递</button>`
          : `<button class="fj-mini" type="button" aria-disabled="true">去来源平台投递</button>`;
        const why = jok ? '' : `<p class="fj-note">${esc(blockReason(j))}</p>`;
        const ul = (title, arr, empty) => `<p class="fj-k">${title}</p>${arr.length ? `<ul class="fj-ul">${arr.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : `<p class="fj-note">${empty}</p>`}`;
        const req = `<p class="fj-note"><b>要求</b>　${esc(j.reqs.length ? j.reqs.join('；') : '来源平台暂未提供任职要求。')}</p>`;
        const ben = j.benefits && j.benefits.length ? `<p class="fj-note"><b>福利</b>　${esc(j.benefits.join('；'))}</p>` : '';
        return `<section class="fj-card"><h2>${esc(j.title)}</h2><p class="fj-sub">${esc(j.city)} · ${esc(j.salary)} · ${esc(j.catLabel)}</p>${ul('岗位职责', j.duties, '来源平台暂未提供岗位职责。')}${req}${ben}<div class="fj-acts">${goBtn('fj-mini', '查看岗位', 'b-job', 'fjJob=' + j.id + ';fjSrcBad=' + (j.blocked ? 'true' : 'false'))}${apply}</div>${why}</section>`;
      };
      const jobRows = sparse
        ? `<section class="fj-card"><h2>该企业当前没有在招岗位</h2><p class="fj-note">这是确实为 0，不是没查到。没有岗位就不放能点的「查看岗位」。</p>${helpLine()}</section><div class="fj-empty2">${goBtn('fj-jobbig', `<span class="ic">${icon('landmark', 36, 2)}</span><span><b>回企业目录</b><small>换一家已发布的企业，按行业和地区重新看</small></span>`, 'b-companies')}${goBtn('fj-jobbig', `<span class="ic">${icon('clipboard', 36, 2)}</span><span><b>看岗位信息</b><small>改按岗位找。办理仍在来源平台完成</small></span>`, 'b-jobs')}</div><p class="fj-note">${B_CO}</p>`
        : `<p class="fj-meta">在招岗位 · 共 ${jobs.length} 条</p>` + jobs.map(jobCard).join('') + `<p class="fj-note">每个岗位单独核对来源链接，缺了就置灰。${B_CO}</p>`;
      const first = jobs[0];
      return F({
        cls: 'fj-co',
        band: { kind: 'compact', eyebrow: '企业详情', title: esc(c.name), sub: '来源企业与岗位导览。资料、岗位与来源主页缺哪项就不显示哪项。', seal: null, place: ' ', status: sparse ? { text: '该企业当前没有在招岗位', warn: 1 } : { text: '企业资料 · 以来源同步为准' } },
        body: `${qrLayer}${qrJobLayer}
          <section class="fj-card"><h2>企业资料</h2><p class="fj-sub">${esc([c.province, c.city, c.district].filter(Boolean).join(' · '))} · 来源 ${esc(c.source)}</p><p class="fj-note">${esc(c.desc)}</p>${metric}
            <div class="fj-facts">
              <div class="fj-kv"><small>企业类型</small><b>${esc(c.type)}</b></div>
              <div class="fj-kv"><small>所属行业</small><b>${esc(c.industry)}</b></div>
              <div class="fj-kv"><small>企业地址</small><b>${esc(c.address)}</b></div>
              <div class="fj-kv"><small>来源机构</small><b>${esc(c.source)}</b></div>
              <div class="fj-kv"><small>同步时间</small><b>${esc(c.sync)}</b></div>
              <div class="fj-kv"><small>外部编号</small><b>${esc(c.ext)}</b></div>
              <div class="fj-kv"><small>来源链接</small><b>${esc(c.host || '来源未提供')}</b></div>
              <div class="fj-kv"><small>来源种类</small><b>${esc(c.sourceKind)}</b></div>
            </div>
            <p class="fj-note">${esc(c.note)}</p>
            ${orgOk ? '<button class="fj-mini" type="button" data-fj="qr-org">去来源平台查看</button>' : '<button class="fj-mini" type="button" aria-disabled="true">去来源平台查看</button><p class="fj-k">来源要素不全，这里不提供跳转。</p>'}
          </section>
          ${jobRows}`,
        dock: sparse
          ? { left: goBtn('btn sec', `${icon('chevL', 30, 2.4)}返回企业目录`, 'b-companies'), ask: '问小青：这家企业怎么看？', pri: { label: '看岗位信息', go: 'b-jobs' } }
          : { left: goBtn('btn sec', `${icon('chevL', 30, 2.4)}返回企业目录`, 'b-companies'), ask: '问小青：这家企业怎么看？', mid: `<button class="btn pri" type="button" data-go="b-job" data-set="fjJob=${first.id};fjSrcBad=${first.blocked ? 'true' : 'false'}">查看岗位${icon('arrowR', 30, 2.4)}</button>` },
        nav: ''
      });
    },
    mount(el) {
      return mount(el, (k, arg) => {
        const s = S();
        if (k === 'close') { s.fjQr = ''; refresh(); return; }
        if (k === 'qr-org') { s.fjQr = 'org'; refresh(); return; }
        if (k === 'qr-job') { s.fjQr = arg; refresh(); return; }
        if (k === 'co-retry') { s.fjCoErr = false; s.fjCoLoad = true; refresh(); return; }
        if (k === 'demo:reload-ok') { s.fjCoLoad = false; s.fjCoErr = false; refresh(); return; }
        if (k === 'demo:reload-fail') { s.fjCoLoad = false; s.fjCoErr = true; refresh(); return; }
      });
    }
  });

  if (window.SCREEN_GROUPS.indexOf(G) < 0) window.SCREEN_GROUPS.push(G);
})();
