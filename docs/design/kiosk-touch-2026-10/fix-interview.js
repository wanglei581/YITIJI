/* fix-interview.js：练面试这一区的样式、示例和交互。类名一律 fi-。不改 index.html 已有规则。 */
(function () {
  const css = document.createElement('style');
  css.textContent = `
.fi-page{justify-content:flex-start;gap:10px;padding:14px 40px 12px}
.fi-page .chips{gap:8px}
.fi-page .chips button{min-height:64px;padding:0 12px;font-size:22px}
.fi-choices{flex:1;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:1fr 1fr;gap:8px;min-height:0}
.fi-page .fi-choices button{min-height:88px;height:100%;border-radius:22px;padding:8px 10px;line-height:1.3;white-space:normal;display:flex;align-items:center;justify-content:center;text-align:center}
.fi-sum{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}
.fi-sum .r{flex:1}
.fi-recs{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}
.fi-rec{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:flex-start;gap:8px;padding:12px 14px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge)}
.fi-rec .fi-cells{flex:1;grid-template-columns:1fr 1fr}
.fi-rec .fi-cells div{height:100%}
.fi-rec .fi-span{grid-column:1 / -1}
.fi-rec .fi-acts{flex-direction:row}
.fi-who{flex:1;min-height:0}
.fi-who .persona{flex:1}
.fi-grow{flex:none;display:flex;flex-direction:column;gap:8px;background:var(--card);border:1.5px solid var(--edge);border-radius:28px;padding:14px 16px}
.fi-grow p,.fi-grow li,.fi-grow span{margin:0;font-size:24px;line-height:1.4;color:var(--ink)}
.fi-grow b{font-size:24px}
.fi-lines{gap:8px;padding:0;background:transparent;border:0}
.fi-lines>p{flex:none;padding:12px 16px;border-radius:18px;background:var(--card);border:1.5px solid var(--edge);font-size:24px;line-height:1.4}
.fi-main{flex:1;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;gap:10px;text-align:left;min-height:300px;padding:18px 20px;border-radius:28px;background:var(--deep);color:var(--cream)}
.fi-main small{font-style:normal;font-size:24px;line-height:1.35;color:var(--mint)}
.fi-main b{font:700 40px/1.25 var(--serif)}
.fi-main .chip{background:rgba(255,255,255,.12);color:var(--cream)}
.fi-steps{display:flex;flex-direction:column;gap:8px;width:100%}
.fi-steps i{display:flex;flex-direction:column;gap:2px;font-style:normal;padding:8px 12px;border-radius:16px;background:rgba(255,255,255,.08)}
.fi-steps b{font:700 22px/1.3 var(--sans);color:var(--cream)}
.fi-steps em{font-style:normal;font-size:22px;line-height:1.35;color:var(--mint)}
.fi-hub .fi-grid .tile{min-height:156px}
.fi-morepage .fi-grid{flex:none}
.fi-morepage .fi-grid .tile{min-height:148px;height:auto}
.fi-morepage .fi-art{flex:1;min-height:0;overflow:hidden;justify-content:flex-start}
.fi-page>.fi-art{overflow:hidden;justify-content:flex-start}
.fi-page>.fi-art>svg{height:50%;width:auto;max-width:72%}
.fi-rest,.fi-page .fi-grow{flex:1;min-height:0}
.fi-art{flex:1;min-height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:20px;border-radius:28px;background:var(--card);border:1.5px solid var(--edge);text-align:center}
.fi-art b{font:700 36px/1.3 var(--serif)}
.fi-art p{margin:0;font-size:24px;line-height:1.45;color:var(--ink-2);max-width:860px}
.fi-dead{flex:1;display:flex;flex-direction:column;gap:8px;min-height:0}
.fi-dead .slab.row{min-height:0;padding:16px 18px;flex:1}
.fi-lead{display:flex;flex-direction:column;align-items:flex-start;gap:6px}
.fi-dead .fi-steps i{background:var(--well)}
.fi-dead .fi-steps b{color:var(--ink)}
.fi-dead .fi-steps em{color:var(--ink-2)}
.fi-out{min-height:64px;padding:0 18px;border-radius:20px;background:var(--teal-wash);color:var(--teal-ink);font:700 22px/1 var(--sans);text-align:left}
.fi-more{min-height:64px;padding:0 18px;border-radius:20px;background:var(--card);border:1.5px solid var(--edge);font:700 22px/1 var(--sans);display:flex;align-items:center;justify-content:space-between}
.fi-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.fi-grid .tile{min-height:112px}
.fi-note{display:flex;flex-direction:column;gap:4px;padding:12px 16px;border-radius:20px;background:var(--card);border:1.5px solid var(--edge)}
.fi-note b{font-size:24px}
.fi-note span,.fi-note p{margin:0;font-size:22px;line-height:1.4;color:var(--ink-2)}
.fi-field{min-height:88px;width:100%;padding:10px 16px;border-radius:24px;background:var(--card);border:1.5px solid var(--edge);text-align:left;display:flex;flex-direction:column;justify-content:center;gap:4px}
.fi-field small{font-size:20px;color:var(--ink-3)}
.fi-field b{font-size:26px;line-height:1.3}
.fi-sec{font-size:22px;font-weight:700;color:var(--ink-2)}
.fi-err{margin:0;font-size:22px;line-height:1.4;color:var(--cinnabar);font-weight:700}
.fi-page .persona{min-height:64px;padding:8px 12px;gap:12px}
.fi-page .persona .av{width:64px;height:64px;font-size:22px}
.fi-page .persona b{font-size:22px}
.fi-page .persona small{font-size:20px;margin-top:2px}
.fi-seg{display:flex;gap:8px}
.fi-seg button{flex:1;min-height:72px;border-radius:20px;background:var(--card);border:1.5px solid var(--edge);font-size:22px;font-weight:700;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:6px}
.fi-seg button small{font-size:20px;font-weight:600}
.fi-seg button[aria-pressed="true"]{background:var(--deep);color:var(--cream);border-color:var(--deep)}
.fi-page .sumcard .r{min-height:72px;padding:8px 14px;font-size:22px;grid-template-columns:108px 1fr auto}
.fi-edit{min-width:64px;min-height:64px;padding:0 14px;border-radius:18px;background:var(--teal-wash);color:var(--teal-ink);font:700 22px/1 var(--sans)}
.fi-cells{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.fi-cells div{min-height:72px;padding:8px 10px;border-radius:18px;background:var(--card);border:1.5px solid var(--edge);display:flex;flex-direction:column;justify-content:center;gap:2px}
.fi-cells small{font-size:20px;color:var(--ink-3)}
.fi-cells b{font-size:22px;line-height:1.3}
.fi-src{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.fi-src button,.fi-wide{min-height:88px;padding:10px 14px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge);text-align:left;display:flex;flex-direction:column;justify-content:center;gap:2px}
.fi-src b,.fi-wide b{font-size:24px}
.fi-src small,.fi-wide small{font-size:20px;color:var(--ink-3);font-weight:600}
.fi-banner{padding:12px 16px;border-radius:20px;background:var(--teal-wash);color:var(--teal-ink);font-size:22px;line-height:1.4}
.fi-ab{display:flex;flex-direction:column;gap:2px;padding:8px 0;border-top:1px solid var(--line)}
.fi-ab b{font-size:22px}
.fi-ab span{font-size:22px;line-height:1.35}
.fi-q{padding:12px 14px;border-radius:24px;background:var(--card);border:1.5px solid var(--edge);display:flex;flex-direction:column;gap:6px}
.fi-q .chip{align-self:flex-start}
.fi-q p{margin:0;font-size:26px;line-height:1.4}
.fi-q small{font-size:20px;color:var(--ink-3)}
.fi-answer{flex:none;min-height:120px;width:100%;padding:14px 16px;border-radius:24px;background:var(--card);border:1.5px solid var(--edge);text-align:left;display:flex;flex-direction:column;justify-content:flex-start;gap:8px}
.fi-run .fi-q{flex:1;min-height:0;overflow:hidden}
.fi-run .fi-qart{flex:1;min-height:0;overflow:hidden;display:flex;align-items:center;justify-content:flex-start}
.fi-run .fi-qart svg{height:88%;width:auto;max-width:68%}
.fi-answer b{font-size:24px}
.fi-answer span{font-size:22px;line-height:1.4;color:var(--ink-2)}
.fi-acts{display:flex;flex-wrap:wrap;gap:8px}
.fi-acts button{min-height:64px;padding:8px 14px;border-radius:18px;background:var(--card);border:1.5px solid var(--edge);font:700 22px/1.2 var(--sans)}
.fi-acts button[aria-pressed="true"]{background:var(--deep);color:var(--cream);border-color:var(--deep)}
.fi-page [aria-disabled="true"]{opacity:.45}
.fi-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:10px 12px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge)}
.fi-row b{font-size:22px;line-height:1.3}
.fi-row small,.fi-row p{margin:0;font-size:22px;line-height:1.35;color:var(--ink-2)}
.fi-row .fi-acts{flex-direction:column}
.fi-faq{min-height:64px;padding:8px 10px;border-radius:16px;background:var(--card);border:1.5px solid var(--edge);text-align:left;font:700 22px/1.3 var(--sans)}
.fi-faq[aria-pressed="true"]{background:var(--deep);color:var(--cream);border-color:var(--deep)}
.fi-ck{min-height:64px;padding:6px 10px;border-radius:16px;background:var(--card);border:1.5px solid var(--edge);text-align:left;font:700 22px/1.3 var(--sans)}
.fi-page.fi-tips{gap:6px;padding:8px 40px 8px}
.fi-tips .fi-grid{gap:6px}
.fi-tips .fi-note{padding:8px 12px;gap:2px}
.fi-tips .fi-recheck{min-height:64px;padding:0 16px;justify-content:center}
.fi-tips .fi-read{flex:1;min-height:0;display:flex;flex-direction:column;gap:4px;background:var(--card);border:1.5px solid var(--edge);border-radius:28px;padding:8px 12px}
.fi-tips .fi-split{flex:none;display:grid;grid-template-columns:1fr 1fr;gap:8px 16px}
.fi-tips .fi-col{display:flex;flex-direction:column;gap:2px}
.fi-tips .fi-col>b{font-size:22px;line-height:1.3}
.fi-tips .fi-line{flex:none;display:block;padding:2px 0 4px}
.fi-tips .fi-line b{font-size:22px;line-height:1.3}
.fi-tips .fi-line span{display:block;font-size:22px;line-height:1.35;color:var(--ink-2)}
.fi-tips:not(.fi-gated) .fi-ck{min-height:88px}
.fi-tips:not(.fi-gated) .fi-faq{min-height:94px}
.fi-tips.fi-gated:not(.fi-down) .fi-ck{min-height:76px}
.fi-tips.fi-gated:not(.fi-down) .fi-faq{min-height:76px}
.fi-tips .fi-detail{display:flex;flex-direction:column;gap:4px}
.fi-tips .fi-detail p,.fi-tips .fi-foot{margin:0;font-size:22px;line-height:1.35;color:var(--ink)}
.fi-tips .fi-foot{color:var(--ink-2)}
.fi-ck[aria-pressed="true"]{background:var(--teal-wash);border-color:var(--teal);color:var(--teal-ink)}
.overlay .fi-ind{width:980px;max-height:1700px;padding:22px 24px;gap:8px;align-items:stretch;text-align:left;background:var(--card)}
.fi-ind h2{font-size:36px;text-align:left}
.fi-ind p{font-size:20px;line-height:1.4;text-align:left}
.fi-indgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.fi-indgrid button{min-height:64px;padding:8px 10px;border-radius:16px;background:var(--paper);border:1.5px solid var(--edge);text-align:left;font:600 22px/1.3 var(--sans)}
.fi-indgrid button[aria-pressed="true"]{background:var(--deep);color:var(--cream);border-color:var(--deep)}
.overlay .fi-dlg{width:880px}
.overlay .fi-dlg .btns button{min-height:88px}
.fi-clock{font:700 28px/1 var(--sans);font-variant-numeric:tabular-nums}
.fi-morepage .fi-art{justify-content:center;gap:8px}
.fi-morepage .fi-art>svg{height:68%;width:auto;max-width:78%}
`;
  document.head.appendChild(css);

  const { icon, band, dock, nav } = UI;
  const S = () => window.S;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const refresh = () => { if (window.__proto && window.__proto.refresh) window.__proto.refresh(); };
  const go = (id) => { if (window.go) window.go(id); };
  function F(o) {
    return (o.band ? band(o.band) : '')
      + `<main class="body ${o.cls || ''}">${o.body}</main>`
      + (o.dock === false ? '' : dock(o.dock || {}))
      + (o.nav === false ? '' : nav(o.nav))
      + (o.extra || '');
  }
  function fmt(sec) {
    const n = Math.max(0, sec | 0);
    return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
  }
  function st() {
    const s = S();
    if (!s.fiWho) s.fiWho = 'hr';
    if (!s.fiDiff) s.fiDiff = 'standard';
    if (!s.fiDur) s.fiDur = 5;
    if (s.fiRole == null) s.fiRole = '';
    if (s.fiIndName == null) s.fiIndName = '';
    if (s.fiExp == null) s.fiExp = '';
    if (!s.fiChecks) s.fiChecks = '000000';
    return s;
  }

  const INDUSTRIES = ['农、林、牧、渔业', '采矿业', '制造业', '电力、热力、燃气及水生产和供应业', '建筑业', '批发和零售业', '交通运输、仓储和邮政业', '住宿和餐饮业', '信息传输、软件和信息技术服务业', '金融业', '房地产业', '租赁和商务服务业', '科学研究和技术服务业', '水利、环境和公共设施管理业', '居民服务、修理和其他服务业', '教育', '卫生和社会工作', '文化、体育和娱乐业', '公共管理、社会保障和社会组织', '国际组织'];
  const POSITIONS = ['前端开发工程师', '行政专员', '市场运营', '机械工程师', '会计', '销售代表'];
  const EXPS = ['应届生', '1 年以内', '1-3 年', '3-5 年', '5 年以上', '转行求职'];
  const WHO = [
    ['hr', 'HR 面试', 'HR', '自我介绍 · 求职动机 · 稳定性 · 薪资沟通'],
    ['manager', '业务主管', '主', '过往经历 · 岗位理解 · 协作与执行'],
    ['tech', '技术面试官', '技', '专业技能 · 项目细节 · 问题解决'],
    ['campus', '校招面试官', '校', '校园经历 · 学习能力 · 职业规划'],
    ['final', '终面负责人', '终', '价值观 · 长期发展 · 综合判断']
  ];
  const DIFFS = [['easy', '轻松练习', '适合第一次练习，问题更基础'], ['standard', '标准面试', '接近真实面试节奏'], ['pressure', '压力面试', '更多追问与细节验证']];
  const DURS = [[3, '3 分钟', '4 题'], [5, '5 分钟', '6 题'], [8, '8 分钟', '8 题']];
  const QMAP = { 3: 4, 5: 6, 8: 8 };
  const CHECKS = ['背景调研与岗位关键词', '准备真实经历与细节', '练习 1 分钟自我介绍', '核对材料、时间和路线', '确认线上设备与网络', '把问题写成 STAR 结构'];
  const STAR = [['S / T', '说清背景和任务', '交代情境、目标和你承担的角色。'], ['A', '说明你的行动', '聚焦本人做了什么，不只讲团队。'], ['R', '核对真实结果', '数字和成果由本人核实，不用编造。']];
  const INTRO = [['30 秒', '身份、核心优势、岗位动机。'], ['1 分钟', '加上一段真实经历和成果。'], ['3 分钟', '补充两三段经历与发展方向。']];
  const FAQS = [
    ['请简单自我介绍一下？', '我是谁 + 我做过什么 + 一个真实核心成绩 + 为什么适合目标岗位。不要逐条背诵简历或编造经历。', '表达能力、提炼重点的能力、与岗位的初步匹配度。', '逐条复述简历；讲到童年成长经历；超过 5 分钟。', '结尾落到「所以我希望在这个岗位上……」，把话题引回岗位。'],
    ['你为什么想应聘这个岗位？', '说明岗位理解、自己的对应能力和希望解决的问题，避免只说「想找一份工作」。', '求职动机是否真实、对岗位理解有多深。', '只说「离家近」「想找份工作」；对岗位职责说不出来。', '提前读三遍岗位描述，至少能说出两条核心职责。'],
    ['你最大的优势是什么？', '一个明确优势 + 一个具体事例支撑 + 与岗位的关联。', '自我认知，以及优势和岗位的关联。', '罗列五六个空泛形容词（认真、负责、能吃苦），没有事例。', '优势只讲一两个，但配上能讲出细节的真实例子。'],
    ['你最大的不足是什么？', '一个真实、不致命的不足 + 正在采取的改进行动。', '是否诚实面对自己、有没有改进意识。', '说「我太追求完美」这类包装答案；说出岗位核心能力上的硬伤。', '重点讲「我正在怎么改」，给出具体行动。'],
    ['讲一个你解决困难或挫折的经历。', '按 STAR：背景 → 你的任务 → 具体行动 → 结果与收获。', '分析问题、动手解决和复盘的能力。', '只抱怨困难本身；说不清自己在其中做了什么。', '突出「我」做了什么，而不是「我们团队」做了什么。'],
    ['你为什么想来我们公司？', '公司的业务方向或行业位置 + 和自己职业规划的契合点。', '求职诚意、对公司的了解程度。', '只说「贵公司是大公司」「工资高」；明显没做任何了解。', '至少了解公司的主营业务和一条近期动态。'],
    ['你对薪资有什么期待？', '给出有依据的区间 + 表达对综合发展的关注 + 留出商量空间。', '自我定位是否客观、沟通方式是否得体。', '一口咬死具体数字；完全不敢谈，说「随便都行」。', '提前查同城市同岗位的大致水平，区间上下浮动 15% 左右。'],
    ['你还有什么想问我们的？', '准备 2–3 个问题：岗位的工作内容、团队情况、入职后的成长路径。', '求职意愿和思考深度，这几乎是必问的收尾题。', '说「没有问题了」；一上来就问加班和假期。', '问「这个岗位前三个月最重要的目标是什么」是稳妥的好问题。']
  ];
  const SAMPLE_DRAFT = '我在学生会负责来访登记，把当天的访客、院系和离开时间写在同一本上。';
  const PHONE = '183-6916-1921';
  const MIC_DENY = '麦克风权限没有打开：可以直接用文字作答。需要语音时，请在浏览器设置里允许麦克风后点「重新检测麦克风」。需要帮助？拨打服务电话 ' + PHONE;

  function whoOf(k) { return WHO.find((w) => w[0] === k) || WHO[0]; }
  function diffOf(k) { return DIFFS.find((d) => d[0] === k) || DIFFS[1]; }
  function durOf(n) { return DURS.find((d) => d[0] === n) || DURS[1]; }
  function targetOf() { return QMAP[st().fiDur] || 6; }
  function micKey() {
    const m = S().fiMic;
    if (!m || m === 'ok') return 'ok';
    return m;
  }
  function micLabel() {
    const m = micKey();
    if (m === 'check') return '正在检测麦克风…';
    if (m === 'none') return '本机没有麦克风';
    if (m === 'deny') return '麦克风权限未开启';
    if (m === 'bad') return '浏览器不支持麦克风';
    return '语音回答可用';
  }
  function micReason() {
    const m = micKey();
    if (m === 'none') return '本机没有麦克风，请用文字作答。如果刚插入 USB 麦克风，点「重新检测麦克风」即可启用语音。';
    if (m === 'deny') return MIC_DENY;
    if (m === 'bad') return '当前浏览器环境不支持麦克风采集（需要 HTTPS 或 localhost），请用文字作答。';
    if (m === 'check') return (S().fiMicN ? '正在重新检测麦克风…' : '正在检测麦克风…');
    return '';
  }
  function validate() {
    const s = st();
    if (!String(s.fiRole || '').trim()) return '请先填写目标岗位，例如：前端开发工程师、行政专员';
    if (!String(s.fiIndName || '').trim()) return '请先选择本次练习的行业，不会替你预选';
    if (!s.fiExp) return '请先选择你的经验情况，不会替你预选';
    return '';
  }
  function hubMode() { return S().fiHub || 'ready'; }
  function aiDown() { return S().ai === 'down'; }
  function blockReason(kind) {
    const hub = hubMode();
    if (kind === 'ai') {
      if (hub === 'checking') return '正在确认AI能力状态';
      if (hub === 'down' || aiDown()) return 'AI能力当前不可用';
      return '';
    }
    if (kind === 'net') {
      if (hub === 'checking') return '正在确认在线服务';
      if (hub === 'down') return '在线服务当前不可用';
      return '';
    }
    return '';
  }
  function hubStatus() {
    const h = hubMode();
    if (h === 'down') return { text: '在线服务不可用', warn: 1 };
    if (h === 'checking') return { text: '正在确认在线服务', warn: 1 };
    return { text: '能力与设备状态以办理时确认为准' };
  }
  function setupStatus() {
    return aiDown() ? { text: 'AI 暂时不能出题', warn: 1 } : { text: 'AI 模拟面试' };
  }
  function tileLive(goId, ic, title, desc) {
    return `<button class="tile" data-go="${goId}"><span class="ic">${icon(ic, 34, 2)}</span><span class="tx"><b>${title}</b><small>${desc}</small></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button>`;
  }
  function tileDead(ic, title, desc, why) {
    return `<div class="tile off" role="group" aria-disabled="true"><span class="ic">${icon(ic, 34, 2)}</span><span class="tx"><b>${title}</b><small>${desc}</small><small>${esc(why)}</small></span></div>`;
  }
  function tileKind(kind, goId, ic, title, desc) {
    const why = blockReason(kind);
    return why ? tileDead(ic, title, desc, why) : tileLive(goId, ic, title, desc);
  }
  function cells(list) {
    return `<div class="fi-cells">${list.map((c) => `<div><small>${c[0]}</small><b>${c[1]}</b></div>`).join('')}</div>`;
  }
  function sampleRows() {
    return [
      { id: 'ses-20261022-1406', time: '10月22日 14:06', position: '行政专员', who: 'HR 面试', industry: '公共管理、社会保障和社会组织', dur: 5, hasReport: true, sample: true },
      { id: 'ses-20261021-0940', time: '10月21日 09:40', position: '前端开发工程师', who: '技术面试官', industry: '信息传输、软件和信息技术服务业', dur: 8, hasReport: false, sample: true }
    ];
  }
  function rows() {
    const s = S();
    if (!Array.isArray(s.fiRows)) s.fiRows = sampleRows();
    return s.fiRows;
  }
  const DEFAULT_META = { position: '行政专员', industry: '公共管理、社会保障和社会组织', who: 'HR 面试', dur: 5, sample: true };
  function reportState() {
    const s = st();
    const mode = s.fiRep || 'ready';
    if (mode === 'loading') return { mode: 'loading' };
    if (s.fiRepId) {
      const row = (Array.isArray(s.fiRows) ? s.fiRows : sampleRows()).find((r) => r.id === s.fiRepId);
      if (!row || !row.hasReport || mode === 'gone') return { mode: 'gone', row };
      return { mode, meta: row };
    }
    if (mode === 'gone') return { mode: 'gone' };
    return { mode, meta: DEFAULT_META };
  }
  function questionText() {
    const s = st();
    const role = s.fiRole || '行政专员';
    const n = s.fiQ || 1;
    if (n <= 1) return '请用一分钟介绍一下你自己，并说明你为什么应聘' + role + '。';
    return '讲一个你解决困难的经历：先说当时要解决什么，再说你本人做了什么，最后只说能核实的结果。';
  }

  function hubNotice() {
    const h = hubMode();
    if (h === 'down') return ['在线服务暂不可用。', '已暂停需要联网处理的入口；线上平台目录、面试技巧、社保与档案指引等不联网内容仍可进入。'];
    if (h === 'checking') return ['正在确认在线服务。', '检查完成前，需要在线处理的入口暂不开放。'];
    return ['进入具体服务后再确认实时能力。', '本页只负责分流，不预报在线、名额、价格或办理结果。'];
  }

  function hub() {
    const whyMain = blockReason('ai');
    const note = hubNotice();
    const steps = `<span class="fi-steps"><i><b>1 创建配置</b><em>记下岗位、面试官和时长</em></i><i><b>2 逐题作答</b><em>默认文字回答，语音进入后检测</em></i><i><b>3 生成练习报告</b><em>练完再生成，到点不自动交卷</em></i></span>`;
    const main = whyMain
      ? `<div class="fi-dead"><div class="slab row off" role="group" aria-disabled="true"><div class="txt"><span class="chip ai">AI · 练习</span><h3>马上练一场</h3><p>选择岗位类型与难度后进入训练</p><span class="lock">${esc(whyMain)}</span></div>${steps}</div><button class="fi-out" data-go="iv-tips">可以先看面试技巧</button></div>`
      : `<button class="fi-main" data-go="iv-1"><span class="fi-lead"><span class="chip ai">AI · 练习</span><b>马上练一场</b><small>选择岗位类型与难度后进入训练</small></span>${steps}</button>`;
    const re = hubMode() === 'down' ? `<button class="fi-wide" data-fi="recheck"><b>重新检测</b><small>检测完之前，需要联网的入口仍不开放</small></button>` : '';
    return F({
      band: { eyebrow: 'AI面试训练', title: '把表达练熟，不替你下结论', sub: '模拟问答、自我探索、技巧与历史报告，用于练习和复盘，不代表真实面试结果。', seal: 'idle', place: ' ', status: hubStatus(), path: ['创建配置', '逐题作答', '生成练习报告'], pathLabel: '一场练习' },
      cls: 'fi-page fi-hub',
      body: `${main}
        <div class="fi-grid">
          ${tileKind('off', 'iv-tips', 'book', '面试技巧', '查看通用问答与沟通要点')}
          ${tileKind('net', 'iv-reports', 'receipt', '训练报告', '查看模拟面试报告')}
          ${tileKind('ai', 'sa-intro', 'compass', '职业自我探索', '了解优势、偏好与可尝试方向')}
          ${tileKind('ai', 'career', 'map', '职业规划建议', '根据经历与目标形成行动建议')}
        </div>
        <button class="fi-more" data-go="interview-more">其余 4 项 ${icon('chevR', 24, 2.4)}</button>
        <div class="fi-note"><b>${note[0]}</b><span>${note[1]}</span><span><b>AI训练不是企业面试。</b>不进行录用判断，不向企业推荐候选人。不排名，不预测录用。报告仅供本人练习参考，不对外共享。</span></div>
        ${re}`,
      dock: { ask: '问小青：先练哪一项？' },
      nav: 'home'
    });
  }

  function more() {
    const back = `<button class="fi-wide" data-go="interview"><b>返回练面试</b><small>回到服务台，不靠历史记录</small></button>`;
    return F({
      band: { kind: 'compact', eyebrow: 'AI面试训练', title: '其余四项入口', sub: '评估历史、行业薪资参考、AI服务记录、简历服务。', seal: null, place: ' ', status: hubStatus() },
      cls: 'fi-page fi-morepage',
      body: `<div class="fi-grid">
          ${tileKind('net', 'sa-history', 'compass', '评估历史', '回看本人历次自我探索结果')}
          ${tileKind('ai', 'xq', 'sparkle', '行业薪资参考', '向通用AI顾问询问市场信息')}
          ${tileKind('net', 'my-ai', 'sparkle', 'AI服务记录', '查看本人AI调用记录')}
          ${tileKind('off', 'resume', 'file', '简历服务', '先完善求职材料')}
        </div>
        ${back}
        <div class="fi-art">${UI.report(220)}<b>按练习目标进入</b><p>评估历史回看本人历次自我探索。行业薪资参考向通用 AI 顾问询问市场信息，徽标是「AI · 需核实」。AI服务记录看本人调用。简历服务先完善求职材料，不联网也能进。</p></div>`,
      dock: { ask: '问小青：先练哪一项？' },
      nav: 'home'
    });
  }

  function indSheet() {
    const s = st();
    if (!s.fiInd) return '';
    const cur = s.fiIndName ? esc(s.fiIndName) : '尚未选择';
    const extra = s.fiIndMark ? '可以再点一个门类。' : '';
    return `<div class="overlay"><div class="dialog fi-ind" role="dialog" aria-label="选择面试行业">
      <h2>选择面试行业</h2>
      <p>从就业行业清单里选一个，用来调整这套练习题的方向。</p>
      <p>行业门类 · 当前：${cur}。${extra}国家标准 GB/T 4754-2017 门类，不预选、不推荐。</p>
      <div class="fi-indgrid">${INDUSTRIES.map((name) => `<button data-fi="ind" data-v="${esc(name)}" aria-pressed="${s.fiIndName === name ? 'true' : 'false'}">${esc(name)}</button>`).join('')}</div>
      <div class="fi-acts"><button data-fi="ind-clear">清空选择</button><button data-fi="ind-close">收起</button></div>
    </div></div>`;
  }

  function iv1() {
    const s = st();
    const role = s.fiRole ? esc(s.fiRole) : '输入目标岗位，例：前端开发工程师';
    return F({
      band: { kind: 'compact', eyebrow: '练面试 · 岗位与经验', title: '这次练哪个岗位？', sub: '选定岗位、面试官和时长后才开始这场练习；语音能否使用，进入后按麦克风实际情况确认。', rail: { labels: ['岗位与经验', '面试官与时长', '核对开始'], now: 0 }, seal: null, place: ' ', status: setupStatus() },
      cls: 'fi-page',
      body: `<button class="fi-field" data-act="type" data-fi="rolekey"><small>目标岗位（必填，最多 50 字）</small><b>${role}</b></button>
        <div class="chips fi-choices">${POSITIONS.map((p) => `<button aria-pressed="${s.fiRole === p ? 'true' : 'false'}" data-fi="pos" data-v="${esc(p)}">${esc(p)}</button>`).join('')}</div>
        <div class="fi-sec">行业（必填，从就业行业清单选择）</div>
        <button class="fi-field" data-fi="ind-open"><small>选择行业 (20)</small><b>${s.fiIndName ? esc(s.fiIndName) : '尚未选择'}</b></button>
        <div class="fi-sec">你的经验 ${s.fiExp ? '' : '· 尚未选择，请按自己的实际情况选择。'}</div>
        <div class="chips fi-choices">${EXPS.map((e) => `<button aria-pressed="${s.fiExp === e ? 'true' : 'false'}" data-fi="exp" data-v="${esc(e)}">${esc(e)}</button>`).join('')}</div>
        ${s.fiErr ? `<p class="fi-err" role="alert">${esc(s.fiErr)}</p>` : ''}
        <button class="fi-wide" data-go="iv-tips"><b>先看面试技巧</b><small>公开的准备方法，不依赖这场配置</small></button>
        ${cells([['文字回答', '可用'], ['语音回答', '进入后检测'], ['练习报告', '完成后生成']])}
        <div class="fi-note"><b>后面不改的话</b><span>HR 面试 · 标准面试 · 5 分钟 / 6 题 · 文字回答。</span><span>行业和经验都不预选。经验再点一次可以取消。</span></div>`,
      extra: indSheet(),
      dock: { ask: '问小青：这场练习怎么设', pri: { id: 'fiNext', label: '下一步' } },
      nav: null
    });
  }

  function iv2() {
    const s = st();
    const who = whoOf(s.fiWho);
    const diff = diffOf(s.fiDiff);
    const dur = durOf(s.fiDur);
    const echo = s.fiEcho || '默认已填：HR 面试、标准面试、5 分钟 / 6 题、文字回答。';
    return F({
      band: { kind: 'compact', eyebrow: '练面试 · 面试官与时长', title: '选一位面试官', sub: '难度和时长有默认值。到点不自动交卷。', rail: { labels: ['岗位与经验', '面试官与时长', '核对开始'], now: 1 }, seal: null, place: ' ', status: setupStatus() },
      cls: 'fi-page',
      body: `<div class="plist fi-who">${WHO.map((p) => `<button class="persona" aria-pressed="${s.fiWho === p[0] ? 'true' : 'false'}" data-fi="who" data-v="${p[0]}"><span class="av" style="background:var(--deep)">${p[2]}</span><span><b>${p[1]}</b><small>${p[3]}</small></span><span class="tick">${icon('check', 28, 2.6)}</span></button>`).join('')}</div>
        <div class="fi-sec">难度</div>
        <div class="fi-seg">${DIFFS.map((d) => `<button aria-pressed="${s.fiDiff === d[0] ? 'true' : 'false'}" data-fi="diff" data-v="${d[0]}">${d[1]}</button>`).join('')}</div>
        <div class="fi-sec">时长</div>
        <div class="fi-seg">${DURS.map((d) => `<button aria-pressed="${s.fiDur === d[0] ? 'true' : 'false'}" data-fi="dur" data-v="${d[0]}">${d[1]}<small>${d[2]}</small></button>`).join('')}</div>
        <button class="fi-wide" data-go="iv-tips"><b>先看面试技巧</b><small>公开的准备方法，不依赖这场配置</small></button>
        <div class="fi-note"><b>${esc(echo)}</b><span>这一场：${who[1]}。${who[3]}</span><span>难度：${diff[1]}。${diff[2]}</span><span>时长：${dur[1]} / ${dur[2]}。练习时长到了，只提示你点结束，不自动出报告。</span></div>`,
      dock: { backLabel: '上一步', ask: '问小青：选哪位面试官', pri: { label: '下一步', go: 'iv-3' } },
      nav: null
    });
  }

  function consentExtra() {
    const s = st();
    const c = s.fiConsent;
    if (c === 'age') {
      return `<div class="overlay"><div class="dialog fi-dlg" role="dialog"><h2>你已年满 14 周岁吗？</h2><p>使用 AI 分析、语音转文字之前需要确认。未满 14 周岁的，需要监护人同意后才能使用，这台机器暂时办不了。</p><div class="btns"><button class="btn pri" data-fi="age-yes">已满</button><button class="btn sec" data-fi="age-no">未满</button></div></div></div>`;
    }
    if (c === 'age-no') {
      return `<div class="overlay"><div class="dialog fi-dlg" role="dialog"><h2>这台机器暂时办不了</h2><p>未满 14 周岁需要监护人同意，这台机器暂时办不了 AI。打印、扫描和已有材料照常可办。</p><div class="btns"><button class="btn pri" data-fi="age-ack">知道了</button></div></div></div>`;
    }
    if (c === 'voice') {
      const items = ['只把你说的话转成文字，用于语音说简历、模拟面试作答，以及向小青提问。', '录音交给受托的语音识别服务商腾讯云转成文字。', '转完即删，不保存录音。', '不做声纹识别，不拿去训练模型。', '这次办完就不再沿用。登录后可在「我的」里撤回；没登录的，离开这台机器即不再使用。撤回后请改用手打。'];
      return `<div class="overlay"><div class="dialog fi-dlg" role="dialog"><h2>录音单独同意</h2>${items.map((t) => `<p>${t}</p>`).join('')}<div class="btns"><button class="btn pri" data-fi="voice-yes">同意录音</button><button class="btn sec" data-fi="voice-no">改用手打</button></div></div></div>`;
    }
    if (c === 'voice-no') {
      return `<div class="overlay"><div class="dialog fi-dlg" role="dialog"><h2>这次不录音</h2><p>这次不录音。请改用手打，文字照常可以提交。</p><div class="btns"><button class="btn pri" data-fi="voice-ack">知道了</button></div></div></div>`;
    }
    return '';
  }

  function iv3() {
    const s = st();
    const who = whoOf(s.fiWho);
    const diff = diffOf(s.fiDiff);
    const dur = durOf(s.fiDur);
    const roleLine = `${s.fiRole || '尚未选择'} · ${s.fiIndName || '尚未选择'} · ${s.fiExp || '尚未选择'}`;
    const down = aiDown();
    let priLabel = '创建并开始练习';
    let priDis = false;
    if (s.fiCreating) { priLabel = '正在为你准备面试官…'; priDis = true; }
    else if (down) priLabel = '打印通用题目单';
    const resumeFail = s.fiResumeFail === 'up' ? '简历上传失败，请重试' : (s.fiResumeFail === 'extract' ? '简历文件无法提取，请更换文件或选择「暂不使用简历」' : '');
    const resume = s.fiResume === 'on'
      ? `<div class="fi-note"><b>已选用 1 份</b><span>${esc(s.fiResumeName || '李佳怡-行政专员-简历.pdf')}</span><span>这场练习会用这份简历出题</span><span>移除后按通用问题练习，不会因此少一道题。</span><button class="fi-wide" data-fi="unresume"><b>移除，不用简历</b></button></div>`
      : `<div class="fi-src"><button data-go="upload"><b>手机扫码上传</b><small>把简历传到这台机器</small></button><button data-go="usb"><b>U 盘导入</b><small>只读取你插入的这只盘</small></button></div><p class="fi-sec">不上传也能开始。选一条来源，本机才会去取文件。没有简历时按通用问题练习，不会因此少一道题。</p>`;
    const failCopy = s.fiStartFail ? '这不是你的操作问题，AI 服务本身是通的。可以直接再点一次「创建并开始练习」。这次还没建立起这场练习，因此印不出按本场配置取题的题目单。面试准备要点是本机固定内容，不依赖 AI，现在照常可看。' : '';
    const blocked = s.fiConsent === 'age-block' ? '未满 14 周岁需要监护人同意，这台机器暂时办不了 AI。打印、扫描和已有材料照常可办。' : '';
    return F({
      band: { kind: 'compact', eyebrow: '练面试 · 核对开始', title: '核对一下，就开始', sub: '面试前，先设置一场练习。', rail: { labels: ['岗位与经验', '面试官与时长', '核对开始'], now: 2 }, seal: null, place: ' ', status: setupStatus() },
      cls: 'fi-page',
      body: `<div class="sumcard fi-sum">
          <div class="r"><span>岗位</span><b>${esc(roleLine)}</b><button class="fi-edit" data-go="iv-1">改</button></div>
          <div class="r"><span>面试官</span><b>${who[1]} · ${diff[1]}</b><button class="fi-edit" data-go="iv-2">改</button></div>
          <div class="r"><span>时长</span><b>${dur[1]} / ${dur[2]}</b><button class="fi-edit" data-go="iv-2">改</button></div>
        </div>
        ${cells([['文字回答', '可用'], ['语音回答', '进入后检测'], ['练习报告', '完成后生成']])}
        <div class="fi-sec">简历（可选） · ${s.fiResume === 'on' ? '已选用 1 份' : '不上传也能开始'}</div>
        ${resumeFail ? `<p class="fi-err" role="alert">${resumeFail}</p>` : ''}
        ${resume}
        ${s.fiErr ? `<p class="fi-err" role="alert">${esc(s.fiErr)}</p>` : ''}
        <button class="fi-wide" data-go="iv-tips"><b>先看面试技巧</b><small>公开的准备方法，不依赖 AI</small></button>
        <p class="fi-sec">使用 AI 即表示你已年满 14 周岁</p>
        <div class="fi-note"><b>三步都在这一场里</b><span>第 1 步 创建配置：记录岗位、难度和时长，不等于已经生成题目。</span><span>第 2 步 逐题作答：文字始终可以作答；语音要转写后由你确认。</span><span>第 3 步 生成练习报告：报告只在这场练习真正完成后生成。</span><span>${down ? 'AI 服务暂停中，打印、扫描照常可用。创建并开始练习（AI 面试官）这次不可用。题目单不经模型，不含点评、评分或通过率。' : (blocked || failCopy || '模拟面试不是企业面试。不代表任何招聘结果承诺，不会发出面试邀请。')}</span></div>`,
      extra: consentExtra(),
      dock: { backLabel: '上一步', ask: '问小青：这场练习怎么设', pri: { id: 'fiStart', label: priLabel, disabled: priDis } },
      nav: null
    });
  }

  function runStatus() {
    const s = st();
    if (s.fiPhase === 'expired') return { text: '这场练习已过期', warn: 1 };
    if (aiDown() || s.fiPhase === 'aidown') return { text: 'AI 暂时不能出题', warn: 1 };
    return { text: 'AI 模拟面试' };
  }
  function runAsk() {
    const p = st().fiPhase;
    if (p === 'expired') return '问小青：练习过期了怎么办';
    return '问小青：这一题怎么答';
  }
  function clockBits() {
    const s = st();
    if (s.fiTimeUp) s.fiLeft = 0;
    else if (typeof s.fiLeft !== 'number') s.fiLeft = (s.fiDur || 5) * 60;
    return fmt(s.fiLeft || 0);
  }

  function run() {
    const s = st();
    const phase = (aiDown() || s.fiPhase === 'aidown') ? 'aidown' : (s.fiPhase || '');
    if (phase === 'expired') {
      return F({
        band: { kind: 'compact', eyebrow: '练面试 · 作答', title: '这一场练习已经过期。', sub: '这场练习是否过期，由当时的办理结果决定。过期后不能续答，也不能把没答完的一场说成已完成。', seal: null, place: ' ', status: runStatus() },
        cls: 'fi-page',
        body: `<div class="fi-art">${UI.report(240)}<b>这场练习已过期，需要重新开始</b><p>公共终端上的这场练习有有效期。过期之后，旧的题目和还没提交的回答都不能继续使用。不能把没答完的一场说成已完成。重新创建会回到岗位与经验。</p></div>`,
        dock: { ask: runAsk(), pri: { label: '重新创建练习', go: 'iv-1' } },
        nav: null
      });
    }
    if (phase === 'aidown') {
      const saved = !!s.fiSaved || (s.fiAnswers || 0) > 0;
      const line = saved
        ? 'AI 暂时用不了，报告现在生成不了。你的回答已保存，AI 恢复后可以接着生成报告。'
        : 'AI 暂时用不了，报告现在生成不了。';
      const retry = saved ? '稍后再试生成报告' : '看面试要点';
      const pri = saved
        ? { id: 'fiRetry', label: '稍后再试生成报告' }
        : { label: '看面试要点', go: 'iv-tips' };
      return F({
        band: { kind: 'compact', eyebrow: '练面试 · 作答', title: '用真实经历回答。', sub: '文字输入始终可用。题目、剩余时间和下一题，都按这场练习显示。', seal: null, place: ' ', status: runStatus() },
        cls: 'fi-page',
        body: `${saved ? '<button class="fi-wide" data-go="iv-tips"><b>看面试要点</b><small>不需要 AI 的面试技巧</small></button>' : ''}
          <div class="fi-art">${UI.report(220)}<b>${line}</b><p>${s.fiRetry ? '仍未恢复。你的回答已保存，AI 恢复后可以接着生成报告。' : 'AI 现在停用，这场练习没法继续出题和点评。可以返回面试服务，看不需要 AI 的面试技巧。打印、扫描照常可用。'}</p></div>`,
        dock: { ask: runAsk(), pri },
        nav: null
      });
    }
    if (phase === 'noanswer') {
      return F({
        band: { kind: 'compact', eyebrow: '练面试 · 作答', title: '用真实经历回答。', sub: '这一场还没有记下的回答。', seal: null, place: ' ', status: runStatus() },
        cls: 'fi-page',
        body: `<button class="fi-wide" data-go="interview"><b>离开</b><small>回练面试服务台</small></button>
          <div class="fi-art">${UI.report(220)}<b>这一场还没有记下的回答，没法生成报告。</b><p>可以回去答一题再结束，或直接离开。跳过不算有效回答。继续答题回到当前这一题，不自动交卷。</p></div>`,
        dock: { ask: runAsk(), pri: { id: 'fiCont', label: '继续答题' } },
        nav: null
      });
    }
    const n = s.fiQ || 1;
    const tgt = targetOf();
    const who = whoOf(s.fiWho);
    const voice = s.fiVoice || 'idle';
    const mode = s.fiMode === 'voice' ? 'voice' : 'text';
    const mic = micKey();
    const timeMsg = s.fiTimeUp ? '<p id="fiTimeMsg">练习时长已到，回答完当前问题后点「结束本场练习」。</p>' : '<p id="fiTimeMsg" hidden>练习时长已到，回答完当前问题后点「结束本场练习」。</p>';
    const qCard = `<div class="fi-q"><span class="chip slate">示例</span><small>${who[1]} · 第 ${n} 题 / 目标 ${tgt} 题 · 题目由 AI 生成，仅供参考</small><p>${esc(questionText())}</p><div class="fi-qart">${UI.report(220)}</div></div>`;
    const star = `<div class="fi-note"><b>回答时可以这样组织</b><span>背景：先交代问题，说明当时要解决什么。</span><span>行动：说你做了什么，突出你本人的关键工作。</span><span>结果：只说能核实的，数字和成果由你自己核对。</span></div>`;
    const statusRow = cells([['麦克风', micLabel()], ['语音播报', '本机语音播报'], ['剩余时间', clockBits()]]);
    let pri;
    let mid = '';
    if (phase === 'thinking') pri = { id: 'fiSubmit', label: '正在分析你的回答…', disabled: true };
    else if (phase === 'finishing') pri = { id: 'fiSubmit', label: '正在生成练习报告…', disabled: true };
    else if (phase === 'done') pri = { id: 'fiEnd', label: '结束并生成练习报告' };
    else if (voice === 'rec') pri = { id: 'fiStop', label: '结束回答并转写' };
    else if (voice === 'trans') pri = { id: 'fiSubmit', label: '正在转写你的回答…', disabled: true };
    else if (voice === 'review') pri = { id: 'fiTrOk', label: '确认提交' };
    else if (mode === 'voice') pri = { id: 'fiRec', label: '开始回答（语音）' };
    else pri = { id: 'fiSubmit', label: '提交回答' };
    const micBtn = mic === 'ok'
      ? `<button data-fi="mode" data-v="${mode === 'voice' ? 'text' : 'voice'}">${mode === 'voice' ? '改用文字输入' : '改用语音回答'}</button>`
      : `<button data-fi="mode" data-v="voice" aria-disabled="true">改用语音回答</button>`;
    const recheck = mic === 'ok' ? '' : `<button data-fi="micre">重新检测麦克风</button>`;
    const acts = (phase === 'thinking' || phase === 'finishing') ? '' : `<div class="fi-acts">
        <button data-fi="omit" aria-pressed="${s.fiOmit ? 'true' : 'false'}">不打印我的回答（报告仍可在屏幕上回看问答摘录）</button>
        ${micBtn}${recheck}
        ${phase === 'done' ? '' : '<button data-fi="skip">跳过此题</button>'}
        ${phase === 'done' ? '' : '<button data-fi="end">结束本场</button>'}
        ${voice === 'review' ? '<button data-fi="tr-redo">重新录音</button><button data-fi="tr-text">改用文字输入</button>' : ''}
      </div>`;
    let answer = '';
    if (phase === 'thinking') answer = '<div class="fi-note"><b>面试官正在分析你的回答…</b><span>提交后才会进入下一题。这次没发出去时，页面会留下原因，你可以再试一次。</span></div>';
    else if (phase === 'finishing') answer = '<div class="fi-note"><b>正在生成练习报告…</b><span>生成好之前，不跳到报告页。</span></div>';
    else if (voice === 'rec') answer = `<div class="fi-note"><b>正在录音，最长 58 秒</b><span>点「结束回答并转写」就停。录满 58 秒也只停止录音并进入转写，不结束这场练习，也不自动出报告。</span></div>`;
    else if (voice === 'trans') answer = '<div class="fi-note"><b>正在转写你的回答…</b><span>转写完成后请你确认，不会自动提交。</span></div>';
    else if (voice === 'review') answer = `<div class="fi-note"><b>请确认转写结果</b><span class="chip slate">示例</span><span>${esc(s.fiReview || SAMPLE_DRAFT)}</span></div>`;
    else if (mode === 'voice') answer = `<div class="fi-note"><b>点下方「开始回答（语音）」</b><span>语音模式会自动播一次当前题。不是按住说话。最长 58 秒。</span>${mic !== 'ok' ? `<span>${esc(micReason())}</span>` : ''}</div>`;
    else {
      const draft = s.fiDraft || '';
      answer = `<button class="fi-answer" data-act="type" data-fi="draft"><b>你的回答</b><span>${draft ? esc(draft) : '在这里输入你的回答，最多 2000 字'}</span><span>${[...draft].length} / 2000</span><span>提交后才会进入下一题。这次没发出去时，页面会留下原因，你可以再试一次。</span></button>`;
    }
    const reason = mic !== 'ok' && mode !== 'voice' ? `<p class="fi-err">${esc(micReason())}</p>` : '';
    const err = s.fiRunErr ? `<p class="fi-err" role="alert">${esc(s.fiRunErr)}</p>` : '';
    const doneLine = phase === 'done' ? '<p class="fi-sec">本场问题已问完，可以结束并生成报告</p>' : '';
    const history = (s.fiMsgs || []).slice(-2).map((m) => `<span><b>${m.skipped ? '跳过记录' : (m.role === 'you' ? '你的回答' : who[1])}</b> ${esc(m.text)}</span>`).join('');
    const answerGrows = phase !== 'thinking' && phase !== 'finishing' && voice !== 'rec' && voice !== 'trans' && voice !== 'review' && mode !== 'voice';
    return F({
      band: { kind: 'compact', eyebrow: '练面试 · 作答', title: '用真实经历回答。', sub: '文字输入始终可用。题目、剩余时间和下一题，都按这场练习显示。', seal: null, place: ' ', status: runStatus() },
      cls: 'fi-page fi-run',
      extra: consentExtra(),
      body: `${qCard}${statusRow}${timeMsg}${doneLine}${err}${reason}${star}${answer}${acts}
        <div class="fi-note${answerGrows ? '' : ' fi-rest'}"><b>最近对话</b>${history || '<span>这场还没有记下的对话。提交或跳过之后，这里按本场返回。</span>'}<span>模拟练习仅供本人参考，对话内容不会发送给任何企业。转写不落库、音频不落盘。转完即删。</span>${s.fiDraft && s.fiRunErr ? '<span>你刚才的回答还在输入框里。</span>' : ''}</div>`,
      dock: { ask: runAsk(), pri },
      nav: null
    });
  }

  function reportBody(meta, mode) {
    const omit = !!st().fiOmit;
    const printV = mode === 'printing' ? '生成中' : (mode === 'fail' ? '没有生成' : '还没有');
    return `<div class="fi-banner"><b>AI 生成，仅供参考，只用于本人练习复盘。</b>不代表任何招聘结果，不参与企业筛选、面试邀约或录用决策，也不会发送给任何企业。</div>
      ${cells([['报告内容', '可以查看'], ['打印版', printV], ['录用预测', '不提供']])}
      <div class="fi-note"><span class="chip slate">示例</span><b>综合表现概览</b><span>这场练习里，自我介绍能说清学生会来访登记的职责；追问到人次和交接人时停住了。</span></div>
      <div class="fi-ab"><b>表达清晰度</b><span>句子完整，后半段重复了「负责接待」。</span></div>
      <div class="fi-ab"><b>和目标岗位要求的对照</b><span>能对上接待和台账，没说到材料移交。</span></div>
      <div class="fi-ab"><b>经历可信度与细节</b><span>提到了登记本，没有说出一天大约多少人。</span></div>
      <div class="fi-ab"><b>专业能力表现</b><span>知道要核对证件和登记时间。</span></div>
      <div class="fi-ab"><b>沟通与应变能力</b><span>被追问时说了「我再想想」，没有第二个例子。</span></div>
      <div class="fi-note"><b>风险点与改进建议</b><span>数字和交接对象都没说实。建议补一句「一天大约多少人次、交给谁」。</span></div>
      ${(st().fiPrintErr || (mode === 'fail' ? '打印版生成失败，请稍后重试' : '')) ? `<p class="fi-err" role="alert">${esc(st().fiPrintErr || '打印版生成失败，请稍后重试')}</p>` : ''}
      <button class="fi-wide" data-go="iv-report-more"><b>预测题、STAR、清单、摘录</b><small>${omit ? '你选择了不把回答印进打印件' : '打印件会收录每题回答的前 200 字'}</small></button>
      <div class="fi-acts"><button data-go="iv-reports">查看历史报告</button><button data-go="iv-1">重新练习</button></div>
      <div class="fi-note fi-rest"><span>模拟练习结果，仅供练习参考，不代表任何用人单位的评价或录用意见。</span><span><b>打印不会先假装成功。</b>只有真正生成文件之后，才会进入打印确认；失败时仍停在报告页并写明原因。</span></div>`;
  }

  function report() {
    const stt = reportState();
    if (stt.mode === 'loading') {
      return F({
        band: { kind: 'compact', eyebrow: '练面试 · 报告', title: '正在核对报告状态。', sub: '报告只按这场练习读取。读取完成前不展示上一次内容，也不提前放开打印。', seal: null, place: ' ', status: { text: '正在读取', warn: 1 } },
        cls: 'fi-page',
        body: `${cells([['报告内容', '读取中'], ['打印版', '未生成'], ['录用预测', '不提供']])}
          <div class="fi-art">${UI.report(240)}<b>正在读取本场练习报告</b><p>读取完成前，这里不展示上一次的内容，也不显示评分、打印成功或可下载文件。读取没有完成之前，不能生成打印版。</p></div>`,
        dock: { ask: '问小青：报告还在读取怎么办' },
        nav: null
      });
    }
    if (stt.mode === 'gone') {
      return F({
        band: { kind: 'compact', eyebrow: '练面试 · 报告', title: '这份报告暂时不能查看。', sub: '报告可能还没生成、已经过期，或当前账号不能查看；不能用固定内容替代实际结果。', seal: null, place: ' ', status: { text: '报告不可用', warn: 1 } },
        cls: 'fi-page',
        body: `<button class="fi-wide" data-go="iv-reports"><b>查看报告历史</b><small>回到本人的练习记录</small></button>
          <div class="fi-art">${UI.report(240)}<b>报告不存在或已过期</b><p>没有真实报告时，不显示评分、打印成功或可下载文件。可以重新开始一场练习，或先看历史里别的记录。</p></div>`,
        dock: { ask: '问小青：这份练习报告怎么看', pri: { label: '重新开始练习', go: 'iv-1' } },
        nav: null
      });
    }
    const meta = stt.meta;
    const printing = stt.mode === 'printing';
    const sub = `${meta.position} · ${meta.industry} · ${meta.who}。只用于本人复盘，不代表通过率或录用结果。`;
    return F({
      band: { kind: 'compact', eyebrow: '练面试 · 报告', title: '报告用来复盘练习。', sub, seal: null, place: ' ', status: stt.mode === 'fail' ? { text: '打印版没有生成', warn: 1 } : (printing ? { text: '正在生成打印版', warn: 1 } : { text: '报告可以查看' }) },
      cls: 'fi-page',
      body: reportBody(meta, stt.mode),
      dock: { ask: '问小青：这份练习报告怎么看', pri: { id: 'fiPrint', label: printing ? '正在生成打印版…' : '生成打印版', disabled: printing } },
      nav: null
    });
  }

  function reportMore() {
    const stt = reportState();
    if (stt.mode === 'loading' || stt.mode === 'gone') {
      return F({
        band: { kind: 'compact', eyebrow: '练面试 · 报告', title: '这份报告暂时不能查看。', sub: '没有真实报告时，不展示预测题、STAR、清单或摘录。', seal: null, place: ' ', status: { text: '报告不可用', warn: 1 } },
        cls: 'fi-page',
        body: `<div class="fi-art">${UI.report(240)}<b>报告不存在或还在读取</b><p>没有真实报告时，不展示预测题、STAR、清单或摘录，也不在这里提前生成打印版。</p></div>`,
        dock: { ask: '问小青：这份练习报告怎么看', pri: { label: '回到报告页', go: 'iv-report' } },
        nav: null
      });
    }
    const omit = !!st().fiOmit;
    return F({
      band: { kind: 'compact', eyebrow: '练面试 · 报告', title: '报告用来复盘练习。', sub: '预测题、STAR、准备清单和问答摘录。', seal: null, place: ' ', status: { text: '报告可以查看' } },
      cls: 'fi-page',
      body: `<div class="fi-note"><span class="chip slate">示例</span><b>高频问题预测</b><span>1. 来访高峰时你怎么保证登记不漏？</span><span>考察点：现场怎么安排。</span><span>回答思路：先说人流，再说你怎么分栏登记。</span></div>
        <div class="fi-note"><b>面试前准备清单</b><span>把来访登记的人次和交接人写成一句。</span><span>准备 1 分钟自我介绍，落到行政专员的日常。</span><span>核对材料、时间和路线。</span></div>
        <div class="fi-note"><b>问答摘录</b><span>${omit ? '你选择了不把回答印进打印件。下面仍可在屏幕上回看摘录。' : '打印件会收录每题回答的前 200 字。'}</span><span>1. 请用一分钟介绍一下你自己，并说明你为什么应聘行政专员。</span><span>回答：我在学生会负责来访登记，把访客、院系和离开时间写在同一本上。</span></div>
        <div class="fi-note fi-rest"><b>STAR 回答建议</b><span><b>S 情境：</b>开学周来访集中，登记本只有一本。</span><span><b>T 任务：</b>你负责当天的来访登记。</span><span><b>A 行动：</b>你按院系把表格分开，人走时核对离开时间。</span><span><b>R 结果：</b>当天有没有漏项，由你自己核对。数字和成果不用编造。</span></div>`,
      dock: { ask: '问小青：这份练习报告怎么看', pri: { label: '回到这份报告', go: 'iv-report' } },
      nav: null
    });
  }

  function tips() {
    const s = st();
    const hub = hubMode();
    const checks = (s.fiChecks || '000000').padEnd(6, '0').slice(0, 6);
    const done = checks.split('').filter((c) => c === '1').length;
    const rawFaq = s.fiFaq === true ? 1 : (s.fiFaq === false ? 0 : s.fiFaq);
    const open = (rawFaq === 0 || rawFaq > 0) ? rawFaq : -1;
    const faq = open >= 0 ? FAQS[open] : null;
    const gated = hub === 'down' || hub === 'checking';
    const gate = hub === 'down'
      ? '在线服务当前不可用，模拟面试需要联网才能开始；本页的准备清单、高频问题和 STAR 说明不依赖联网，可以继续看。'
      : (hub === 'checking' ? '正在确认在线服务，确认完成前不开始这场练习；本页的准备内容不依赖联网，可以继续看。' : '');
    const cap = hub === 'down' ? { text: '在线服务不可用', warn: 1 } : (hub === 'checking' ? { text: '正在确认在线服务', warn: 1 } : { text: 'AI 模拟面试' });
    const detail = faq
      ? `<p><b>回答结构</b> ${esc(faq[1])}</p><p><b>考察什么</b> ${esc(faq[2])}</p><p><b>别这样答</b> ${esc(faq[3])}</p><p><b>建议</b> ${esc(faq[4])}</p>`
      : `<p>点一道题，看回答结构、考察什么、别这样答、建议。</p><p><b>回答结构</b> 先有骨架，再填真实经历。</p><p><b>考察什么</b> 面试官想确认的能力。</p><p><b>别这样答</b> 常见的空话。</p><p><b>建议</b> 提前准备一个能讲清细节的例子。</p>`;
    const starCol = STAR.map((r) => `<div class="fi-line"><b>${r[0]} ${r[1]}</b><span>${r[2]}</span></div>`).join('');
    const introCol = INTRO.map((r) => `<div class="fi-line"><b>${r[0]}</b><span>${r[1]}</span></div>`).join('');
    return F({
      band: { kind: 'compact', eyebrow: '练面试 · 面试技巧', title: '先把准备方法练熟。', sub: '这是公开的面试准备说明，不会把固定技巧说成根据你的简历生成的建议。', seal: null, place: ' ', status: cap },
      cls: 'fi-page fi-tips' + (gated ? ' fi-gated' : '') + (hub === 'down' ? ' fi-down' : ''),
      body: `${gate ? `<div class="fi-note"><b>${hub === 'down' ? '在线服务不可用' : '正在确认在线服务'}</b><span>${gate}</span></div>` : ''}
        ${hub === 'down' ? '<button class="fi-wide fi-recheck" data-fi="recheck"><b>重新检测</b></button>' : ''}
        <div class="fi-sec">准备清单 · ${done} / 6 已完成</div>
        <div class="fi-grid">${CHECKS.map((t, i) => `<button class="fi-ck" aria-pressed="${checks[i] === '1' ? 'true' : 'false'}" data-fi="check" data-v="${i}">${t}</button>`).join('')}</div>
        <div class="fi-sec">高频问题应对 · 点开看回答思路</div>
        <div class="fi-grid">${FAQS.map((f, i) => `<button class="fi-faq" aria-pressed="${open === i ? 'true' : 'false'}" data-fi="faq" data-v="${i}">${i + 1}. ${f[0]}</button>`).join('')}</div>
        <div class="fi-read"><div class="fi-split"><div class="fi-col"><b>回答一题的基本结构 · STAR 练习法</b>${starCol}</div><div class="fi-col"><b>自我介绍怎么说</b>${introCol}</div></div><div class="fi-detail">${detail}</div><p class="fi-foot">这份技巧是公开的准备方法，不是根据你的材料生成的建议。想让 AI 按你的材料陪练，先设置一场练习。</p></div>`,
      dock: { ask: '问小青：面试前先准备什么', pri: { id: 'fiTipsGo', label: '设置一场练习', disabled: gated } },
      nav: null
    });
  }

  function reports() {
    const s = st();
    const logged = !!s.logged;
    const listMode = s.fiList || 'ready';
    if (!logged) {
      return F({
        band: { kind: 'compact', eyebrow: '练面试 · 练习记录', title: '你的练习记录，登录后才可长期查看。', sub: '未登录时，报告只在这次使用期间可看；登录后才能回看自己的历史列表。', seal: null, place: ' ', status: { text: '未登录', warn: 1 } },
        cls: 'fi-page',
        body: `<div class="fi-note"><b>登录后可保存练习报告</b><span>登录后，完成的练习报告会留在这里，方便你自己回看。</span></div>
          ${cells([['未登录', '大约保留 2 小时'], ['登录之后', '本人记录保留 7 天'], ['现在', '可以先登录']])}
          <button class="fi-wide" data-go="login"><b>手机号登录</b><small>登录后回到练习记录</small></button>
          <button class="fi-wide" data-go="iv-tips"><b>先看面试技巧</b><small>不登录也能看准备方法</small></button>
          <div class="fi-art">${UI.report(220)}<b>未登录不列出历史</b><p>大约保留 2 小时，是这次使用期间的说明，不是已经有两场。登录之后，本人记录保留 7 天。</p></div>`,
        dock: { ask: '问小青：练习记录在哪里', pri: { label: '开始新练习', go: 'iv-1' } },
        nav: null
      });
    }
    if (listMode === 'loading') {
      return F({
        band: { kind: 'compact', eyebrow: '练面试 · 练习记录', title: '登录后，只查看自己的报告。', sub: '未登录时，报告只在这次使用期间可看；登录后才能回看自己的历史列表。', seal: null, place: ' ', status: { text: '正在读取', warn: 1 } },
        cls: 'fi-page',
        body: `${cells([['本人列表', '读取中'], ['查看报告', '未开放'], ['删除记录', '未开放']])}
          <button class="fi-wide" data-go="iv-tips"><b>先看面试技巧</b><small>不依赖这份列表</small></button>
          <div class="fi-art">${UI.report(240)}<b>正在读取本人练习报告</b><p>列表返回前，这里不放示例记录。没有拿到列表之前，不能查看，也不能删除。</p></div>`,
        dock: { ask: '问小青：练习记录在哪里', pri: { label: '开始新练习', go: 'iv-1' } },
        nav: null
      });
    }
    if (listMode === 'error') {
      return F({
        band: { kind: 'compact', eyebrow: '练面试 · 练习记录', title: '登录后，只查看自己的报告。', sub: '没有拿到本人列表时，不显示任何固定历史。', seal: null, place: ' ', status: { text: '列表没有读到', warn: 1 } },
        cls: 'fi-page',
        body: `<button class="fi-wide" data-fi="reload"><b>重试加载</b><small>再读一次本人列表</small></button>
          <button class="fi-wide" data-go="iv-tips"><b>先看面试技巧</b><small>不依赖这份列表</small></button>
          <div class="fi-art">${UI.report(240)}<b>暂时无法加载练习报告</b><p>请检查网络后重试。没有拿到本人列表时，不显示任何固定历史。重试只回到读取中。</p></div>`,
        dock: { ask: '问小青：练习记录在哪里', pri: { label: '开始新练习', go: 'iv-1' } },
        nav: null
      });
    }
    if (listMode === 'empty' || rows().length === 0) {
      return F({
        band: { kind: 'compact', eyebrow: '练面试 · 练习记录', title: '登录后，只查看自己的报告。', sub: '未登录时，报告只在这次使用期间可看；登录后才能回看自己的历史列表。', seal: null, place: ' ', status: { text: '本人记录' } },
        cls: 'fi-page',
        body: `<button class="fi-wide" data-go="my-ai"><b>AI服务记录</b><small>查看本人AI调用记录</small></button>
          <button class="fi-wide" data-go="iv-tips"><b>先看面试技巧</b><small>公开的准备方法</small></button>
          <div class="fi-art">${UI.report(260)}<b>还没有练习报告</b><p>完成一次模拟面试后，这里会显示属于当前账号的练习报告。空列表不补示例行。</p></div>`,
        dock: { ask: '问小青：练习记录在哪里', pri: { label: '开始模拟面试', go: 'iv-1' } },
        nav: null
      });
    }
    const list = rows();
    const hint = s.fiHint ? `<p class="fi-err" role="status">${esc(s.fiHint)}</p>` : '';
    return F({
      band: { kind: 'compact', eyebrow: '练面试 · 练习记录', title: '登录后，只查看自己的报告。', sub: '未登录时，报告只在这次使用期间可看；登录后才能回看自己的历史列表。', seal: null, place: ' ', status: { text: '本人记录' } },
      cls: 'fi-page',
      body: `<div class="fi-recs">${list.map((r) => `<article class="fi-rec"><div><span class="chip slate">示例</span><small>${esc(r.time)}</small><b>${esc(r.position)} · ${esc(r.who)}</b></div><div class="fi-cells"><div class="fi-span"><small>行业</small><b>${esc(r.industry)}</b></div><div><small>时长</small><b>${r.dur} 分钟练习</b></div><div><small>报告</small><b>${r.hasReport ? '可以查看' : '报告未生成'}</b></div></div><div class="fi-acts">${r.hasReport ? `<button data-fi="view" data-v="${r.id}" data-go="iv-report">查看</button>` : '<button disabled>报告未生成</button>'}<button data-fi="del" data-v="${r.id}">${s.fiDel === r.id ? '再次确认删除' : '删除'}</button></div></article>`).join('')}</div>
        ${hint}
        <button class="fi-wide" data-go="my-ai"><b>AI服务记录</b><small>查看本人AI调用记录</small></button>
        <button class="fi-wide" data-go="iv-tips"><b>先看面试技巧</b><small>公开的准备方法</small></button>
        <div class="fi-note"><span>已登录 · 本人记录。只有已经生成报告的记录可以查看。没有报告的记录不能当成可打印。</span><span>删除需要再次确认。确认后才会删掉这条本人记录；失败时记录仍留在列表里。登录之后，本人记录保留 7 天。</span></div>`,
      dock: { ask: '问小青：练习记录在哪里', pri: { label: '开始新练习', go: 'iv-1' } },
      nav: null
    });
  }

  const ID_ACT = { fiNext: 'next1', fiStart: 'start', fiSubmit: 'submit', fiPrint: 'print', fiStop: 'stoprec', fiRec: 'recstart', fiEnd: 'end', fiCont: 'cont', fiRetry: 'retry-report', fiTipsGo: 'tips-go', fiTrOk: 'tr-ok' };

  function pushMsg(text, skipped) {
    const s = st();
    const list = Array.isArray(s.fiMsgs) ? s.fiMsgs.slice() : [];
    list.push({ role: 'you', text, skipped: !!skipped });
    s.fiMsgs = list.slice(-6);
  }

  function handle(name, v, btn, el) {
    const s = st();
    if (name === 'rolekey') return;
    if (name === 'view') {
      s.fiRepId = v;
      s.fiRep = 'ready';
      s.fiPrintErr = '';
      return;
    }
    if (name === 'pos') { s.fiRole = v; s.fiErr = ''; refresh(); return; }
    if (name === 'exp') { s.fiExp = s.fiExp === v ? '' : v; s.fiErr = ''; refresh(); return; }
    if (name === 'ind-open') { s.fiInd = true; refresh(); return; }
    if (name === 'ind') { s.fiIndName = v; s.fiInd = false; s.fiErr = ''; refresh(); return; }
    if (name === 'ind-clear') { s.fiIndName = ''; s.fiIndMark = (s.fiIndMark || 0) + 1; refresh(); return; }
    if (name === 'ind-close') { s.fiInd = false; refresh(); return; }
    if (name === 'who') { s.fiWho = v; s.fiEcho = '已点选面试官：' + whoOf(v)[1] + '。' + whoOf(v)[3]; refresh(); return; }
    if (name === 'diff') { s.fiDiff = v; s.fiEcho = '已点选难度：' + diffOf(v)[1] + '。' + diffOf(v)[2]; refresh(); return; }
    if (name === 'dur') { s.fiDur = +v; const d = durOf(s.fiDur); s.fiEcho = '已点选时长：' + d[1] + ' / ' + d[2] + '。到点不自动交卷。'; refresh(); return; }
    if (name === 'next1') {
      const err = validate();
      if (err) { s.fiErr = err; refresh(); return; }
      s.fiErr = '';
      go('iv-2');
      return;
    }
    if (name === 'start') {
      if (s.fiConsent === 'age-block') { s.fiConsent = 'age-no'; refresh(); return; }
      const err = validate();
      if (err) { s.fiErr = err; refresh(); return; }
      s.fiErr = '';
      if (aiDown()) { go('pii'); return; }
      if (!s.fiAgeOk) { s.fiConsent = 'age'; refresh(); return; }
      s.fiCreating = 1;
      s.fiStartFail = 0;
      refresh();
      return;
    }
    if (name === 'age-yes') { s.fiAgeOk = 1; s.fiConsent = ''; s.fiCreating = 1; s.fiStartFail = 0; refresh(); return; }
    if (name === 'age-no') { s.fiConsent = 'age-no'; refresh(); return; }
    if (name === 'age-ack') { s.fiConsent = 'age-block'; refresh(); return; }
    if (name === 'voice-yes') {
      s.fiVoiceOk = 1;
      s.fiConsent = '';
      if (el.dataset.id === 'iv-run') { s.fiVoice = 'rec'; s.fiRec = 0; s.fiMode = 'voice'; }
      refresh();
      return;
    }
    if (name === 'voice-no') { s.fiConsent = 'voice-no'; s.fiMode = 'text'; s.fiVoice = 'idle'; refresh(); return; }
    if (name === 'voice-ack') { s.fiConsent = ''; refresh(); return; }
    if (name === 'unresume') { s.fiResume = ''; s.fiResumeName = ''; s.fiResumeFail = ''; refresh(); return; }
    if (name === 'recheck') { s.fiHub = 'checking'; refresh(); return; }
    if (name === 'tips-go') { if (hubMode() === 'down' || hubMode() === 'checking') return; go('iv-1'); return; }
    if (name === 'draft') {
      if (!s.fiDraft) s.fiDraft = SAMPLE_DRAFT;
      setTimeout(refresh, 0);
      return;
    }
    if (name === 'omit') { s.fiOmit = !s.fiOmit; refresh(); return; }
    if (name === 'mode') {
      if (v === 'voice' && micKey() !== 'ok') return;
      s.fiMode = v === 'voice' ? 'voice' : 'text';
      s.fiVoice = 'idle';
      refresh();
      return;
    }
    if (name === 'micre') {
      if (s.fiMic === 'check') s.fiMicN = (s.fiMicN || 0) + 1;
      else s.fiMic = 'check';
      refresh();
      return;
    }
    if (name === 'recstart') {
      if (micKey() !== 'ok') return;
      if (!s.fiVoiceOk) { s.fiConsent = 'voice'; refresh(); return; }
      s.fiVoice = 'rec';
      s.fiRec = 0;
      s.fiMode = 'voice';
      refresh();
      return;
    }
    if (name === 'stoprec') { s.fiVoice = 'trans'; refresh(); return; }
    if (name === 'tr-redo') { s.fiVoice = 'rec'; s.fiRec = 0; refresh(); return; }
    if (name === 'tr-text') { s.fiMode = 'text'; s.fiVoice = 'idle'; s.fiDraft = s.fiReview || SAMPLE_DRAFT; refresh(); return; }
    if (name === 'tr-ok') {
      s.fiDraft = s.fiReview || SAMPLE_DRAFT;
      s.fiAnswers = (s.fiAnswers || 0) + 1;
      pushMsg(s.fiDraft, false);
      s.fiVoice = 'idle';
      s.fiMode = 'text';
      s.fiPhase = 'thinking';
      s.fiRunErr = '';
      refresh();
      return;
    }
    if (name === 'submit') {
      if (!(s.fiDraft || '').trim()) { s.fiRunErr = '请输入回答内容，或选择跳过此题'; refresh(); return; }
      s.fiAnswers = (s.fiAnswers || 0) + 1;
      pushMsg(s.fiDraft, false);
      s.fiPhase = 'thinking';
      s.fiRunErr = '';
      refresh();
      return;
    }
    if (name === 'skip') {
      pushMsg('跳过了这个问题', true);
      s.fiPhase = 'thinking';
      s.fiRunErr = '';
      refresh();
      return;
    }
    if (name === 'end') {
      if ((s.fiAnswers || 0) < 1) { s.fiPhase = 'noanswer'; refresh(); return; }
      s.fiPhase = 'finishing';
      refresh();
      return;
    }
    if (name === 'cont') { s.fiPhase = ''; refresh(); return; }
    if (name === 'retry-report') { s.fiRetry = 1; refresh(); return; }
    if (name === 'print') {
      if (s.fiRep === 'printing') return;
      s.fiRep = 'printing';
      s.fiPrintErr = '';
      refresh();
      return;
    }
    if (name === 'check') {
      const i = +v;
      const c = (s.fiChecks || '000000').split('');
      c[i] = c[i] === '1' ? '0' : '1';
      s.fiChecks = c.join('');
      refresh();
      return;
    }
    if (name === 'faq') { s.fiFaq = String(s.fiFaq) === String(v) ? null : +v; refresh(); return; }
    if (name === 'reload') { s.fiList = 'loading'; s.fiHint = ''; refresh(); return; }
    if (name === 'del') {
      if (s.fiDel === v) {
        s.fiRows = rows().filter((r) => r.id !== v);
        s.fiDel = '';
        s.fiHint = '练习记录已删除';
      } else {
        s.fiDel = v;
        s.fiHint = '';
      }
      refresh();
      return;
    }
  }

  function onDemo(ev) {
    const s = st();
    const el = document.querySelector('#stage .screen:not(.leave)');
    if (ev === 'hub-ready') { s.fiHub = 'ready'; refresh(); return; }
    if (ev === 'consent') { s.fiConsent = 'age'; refresh(); return; }
    if (ev === 'voice-consent') { s.fiConsent = 'voice'; refresh(); return; }
    if (ev === 'resume') { s.fiResume = 'on'; s.fiResumeName = '李佳怡-行政专员-简历.pdf'; s.fiResumeFail = ''; refresh(); return; }
    if (ev === 'resume-fail') { s.fiResumeFail = 'up'; refresh(); return; }
    if (ev === 'extract-fail') { s.fiResumeFail = 'extract'; refresh(); return; }
    if (ev === 'started') {
      s.fiCreating = 0;
      s.fiStartFail = 0;
      s.fiSession = 1;
      s.fiPhase = '';
      s.fiQ = 1;
      s.fiLeft = (s.fiDur || 5) * 60;
      s.fiTimeUp = 0;
      s.fiDraft = '';
      s.fiMsgs = [];
      s.fiAnswers = 0;
      s.fiVoice = 'idle';
      s.fiMode = 'text';
      go('iv-run');
      return;
    }
    if (ev === 'start-fail') {
      s.fiCreating = 0;
      s.fiStartFail = 1;
      s.fiErr = '这不是你的操作问题，AI 服务本身是通的。可以直接再点一次「创建并开始练习」。这次还没建立起这场练习，因此印不出按本场配置取题的题目单。面试准备要点是本机固定内容，不依赖 AI，现在照常可看。';
      refresh();
      return;
    }
    if (ev === 'timeup') { s.fiTimeUp = 1; s.fiLeft = 0; refresh(); return; }
    if (ev === 'rec-full') { s.fiVoice = 'trans'; s.fiRec = 58; s.fiMode = 'voice'; refresh(); return; }
    if (ev === 'transcript') { s.fiVoice = 'review'; s.fiReview = SAMPLE_DRAFT; s.fiMode = 'voice'; refresh(); return; }
    if (ev === 'next') {
      const tgt = targetOf();
      const q = (s.fiQ || 1) + 1;
      if (q > tgt) { s.fiQ = tgt; s.fiPhase = 'done'; }
      else { s.fiQ = q; s.fiPhase = ''; s.fiDraft = ''; }
      s.fiVoice = 'idle';
      refresh();
      return;
    }
    if (ev === 'report') {
      if ((s.fiAnswers || 0) > 0 || s.fiPhase === 'finishing' || s.fiPhase === 'done') go('iv-report');
      else { s.fiPhase = 'noanswer'; refresh(); }
      return;
    }
    if (ev === 'report-fail') {
      if (aiDown()) { s.fiPhase = 'aidown'; s.fiSaved = (s.fiAnswers || 0) > 0 ? 1 : 0; }
      else { s.fiPhase = ''; s.fiRunErr = '报告生成失败，请重试'; }
      refresh();
      return;
    }
    if (ev === 'mic-ok') { s.fiMic = 'ok'; s.fiMicN = 0; refresh(); return; }
    if (ev === 'mic-none') { s.fiMic = 'none'; refresh(); return; }
    if (ev === 'mic-deny') { s.fiMic = 'deny'; refresh(); return; }
    if (ev === 'mic-bad') { s.fiMic = 'bad'; refresh(); return; }
    if (ev === 'submit-fail') {
      s.fiPhase = '';
      if (!s.fiDraft) s.fiDraft = SAMPLE_DRAFT;
      s.fiRunErr = '这次没发出去。你刚才的回答还在输入框里。';
      refresh();
      return;
    }
    if (ev === 'print-ready') { s.ctx = 'report'; s.fiRep = 'ready'; go('pii'); return; }
    if (ev === 'print-fail') { s.fiRep = 'fail'; s.fiPrintErr = '打印版生成失败，请稍后重试'; refresh(); return; }
    if (ev === 'list') { s.fiList = 'ready'; s.fiHint = ''; refresh(); return; }
    if (ev === 'del-fail') { s.fiHint = '删除失败，请稍后重试'; s.fiDel = ''; refresh(); return; }
    if (el) { /* 未知演示事件留在本屏 */ }
  }

  function bind(el) {
    const onClick = (e) => {
      const b = e.target.closest('button');
      if (!b || !el.contains(b)) return;
      if (b.disabled || b.getAttribute('aria-disabled') === 'true') return;
      const name = b.dataset.fi || ID_ACT[b.id];
      if (!name) return;
      handle(name, b.dataset.v || '', b, el);
    };
    const onProto = (e) => onDemo(e.detail);
    el.addEventListener('click', onClick);
    el.addEventListener('proto-demo', onProto);
    return () => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('proto-demo', onProto);
    };
  }

  function demo(id) {
    if (id === 'interview' || id === 'interview-more' || id === 'iv-tips') {
      const h = S().fiHub;
      if (h === 'down' || h === 'checking') return [{ label: '演示：在线服务恢复了', ev: 'hub-ready' }];
      return [];
    }
    if (id === 'iv-3') {
      return [
        { label: '演示：确认年龄', ev: 'consent' },
        { label: '演示：录音同意', ev: 'voice-consent' },
        { label: '演示：简历传好了', ev: 'resume' },
        { label: '演示：简历上传失败', ev: 'resume-fail' },
        { label: '演示：简历无法提取', ev: 'extract-fail' },
        { label: '演示：练习创建好了', ev: 'started' },
        { label: '演示：这次没创建成', ev: 'start-fail' }
      ];
    }
    if (id === 'iv-run') {
      return [
        { label: '演示：练习时长到了', ev: 'timeup' },
        { label: '演示：录满 58 秒', ev: 'rec-full' },
        { label: '演示：转写好了', ev: 'transcript' },
        { label: '演示：面试官下一题', ev: 'next' },
        { label: '演示：报告生成好了', ev: 'report' },
        { label: '演示：报告没生成', ev: 'report-fail' },
        { label: '演示：麦克风可用', ev: 'mic-ok' },
        { label: '演示：没有麦克风', ev: 'mic-none' },
        { label: '演示：麦克风没权限', ev: 'mic-deny' },
        { label: '演示：浏览器不支持麦克风', ev: 'mic-bad' },
        { label: '演示：回答没提交上', ev: 'submit-fail' }
      ];
    }
    if (id === 'iv-report' || id === 'iv-report-more') {
      return [
        { label: '演示：打印版好了', ev: 'print-ready' },
        { label: '演示：打印版没生成', ev: 'print-fail' }
      ];
    }
    if (id === 'iv-reports') {
      return [
        { label: '演示：列表读好了', ev: 'list' },
        { label: '演示：删除失败', ev: 'del-fail' }
      ];
    }
    return [];
  }

  window.FI = { hub, more, iv1, iv2, iv3, run, report, reportMore, tips, reports, bind, demo };

  window.SCREENS.push({
    id: 'interview-more', group: '练面试', name: '练面试其余入口',
    notes: {
      does: '运行页 /interview-service 的 serviceHubSpecs.ts capabilities / quickLinks 里，服务台主屏没摆开的四项：评估历史 → sa-history（/resume/self-assessment/history），行业薪资参考 → xq（运行页 /assistant，没有单独薪资屏），AI服务记录 → my-ai，简历服务 → resume。',
      motion: '按下缩小。停用的卡不是按钮。',
      keep: '四张入口按内容高度，下面的说明配插画，不把格子拉高来填空白。在线服务检查中、不可达与服务台共用 S().fiHub。kind ai 在 ?ai=down 或 fiHub=down 时写「AI能力当前不可用」；检查中写「正在确认AI能力状态」。评估历史、AI服务记录在后端不可达时写「在线服务当前不可用」。简历服务在离线白名单，仍可进。不报打印机。普通页 3 分钟清除。号码不在这页。'
    },
    render: () => window.FI.more(),
    mount: (el) => window.FI.bind(el),
    demo: () => window.FI.demo('interview-more')
  });
  window.SCREENS.push({
    id: 'iv-report-more', group: '练面试', name: '练习报告其余栏目',
    notes: {
      does: '运行页 InterviewReportPage 下半：高频问题预测、STAR 回答建议、面试前准备清单、问答摘录。从 iv-report 的「预测题、STAR、清单、摘录」进入。',
      motion: '按下缩小。不自动跳打印。',
      keep: '句子是这一帧的示例，标「示例」；条数和正文从 report.predictedQuestions / starAdvice / checklist / qaExcerpts 读，空数组不补。includeAnswersInPrint 为假时用「你选择了不把回答印进打印件。下面仍可在屏幕上回看摘录。」否则「打印件会收录每题回答的前 200 字。」跳过的摘录写「回答：（跳过）」。无报告或读取中不展示这些栏。结果页 1 分 30 秒清除。不显示等级。'
    },
    render: () => window.FI.reportMore(),
    mount: (el) => window.FI.bind(el),
    demo: () => window.FI.demo('iv-report-more')
  });

  function moveAfter(id, afterId) {
    const list = window.SCREENS;
    const from = list.findIndex((s) => s.id === id);
    if (from < 0) return;
    const [item] = list.splice(from, 1);
    const at = list.findIndex((s) => s.id === afterId);
    list.splice(at < 0 ? list.length : at + 1, 0, item);
  }
  moveAfter('interview-more', 'interview');
  moveAfter('iv-report-more', 'iv-report');
})();
