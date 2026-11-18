/* policy-1117.js：政策补稿（2026-11-17 起草，产品负责人看过、同意后才进仓库）
 * 在 11/05 政策最小闭环（policy-min.js）之上补四处，policy-min.js 一个字不改，只包住它画出来的几屏：
 * 1. 关键词搜索：首页类别卡上方加搜索框（未输入）；点框弹出 Windows 系统触摸键盘（输入中）；超过 30 个字（框变陶土色、搜索停用）；
 *    新屏 policy-search：正在找、有结果、没结果、没连上。
 * 2. 详情「原文摘录」：发布机构填了正文（policy.content 非空）才出；先露两行，「展开全文」打开阅读层按页翻；两行以内整段放下；没填不出。
 * 3. 截止日期：列表每条、搜索结果每条、详情意图带写「X 月 X 日截止」（填了才写）；过了截止日期服务端不返回，一体机上不出现；
 *    从收藏打开一条已经看不到的政策，写清可能的原因（含过了截止日期）。
 * 4. 没绑运营机构（服务端 scope=unbound）或认不出终端（scope=missing）且一条没有：空态标题换成「本机还没有运营机构发布的政策」。
 * 后端依据：分支 claude/policy-expiry-1117（9bca3f4ad 截止日期、fe911d80f 没绑机构空态、34b6aa8e5 关键词、79c68d0ad 北京时间）。
 * 状态键：S().p17Home（'' / typing）、S().p17Val（comp / done / blank / long）、S().p17Res（loading / results / none / failed）、
 *   S().p17Pc（long / short / none）、S().p17Open、S().p17Page、S().p17Gone（'' / gone / expired）、S().p17Scope（'' / unbound）。
 * 地址：?p17home=typing&p17val=comp、?p17res=none、?p17pc=short、?p17open=1、?p17gone=gone、?p17scope=unbound；?pol=0 回到 11/05 原样。 */
(function () {
  'use strict';
  const { icon, band, dock, nav, checklist } = UI;
  const Q = new URLSearchParams(location.search);
  if (Q.get('pol') === '0') return;

  /* window.S 由 app.js 建，app.js 排在本文件之后：默认值在第一次画屏时从地址读。 */
  function S() {
    const s = window.S;
    if (!s) return {};
    if (!s.__p17) {
      Object.defineProperty(s, '__p17', { value: true, enumerable: false });
      s.p17Home = Q.get('p17home') === 'typing' ? 'typing' : '';
      s.p17Val = ['comp', 'done', 'blank', 'long'].indexOf(Q.get('p17val')) >= 0 ? Q.get('p17val') : 'blank';
      s.p17Res = ['loading', 'results', 'none', 'failed'].indexOf(Q.get('p17res')) >= 0 ? Q.get('p17res') : 'results';
      s.p17Pc = ['long', 'short', 'none'].indexOf(Q.get('p17pc')) >= 0 ? Q.get('p17pc') : 'long';
      s.p17Open = Q.get('p17open') === '1';
      s.p17Page = Q.get('p17page') === '2' ? 2 : 1;
      s.p17Gone = ['gone', 'expired'].indexOf(Q.get('p17gone')) >= 0 ? Q.get('p17gone') : '';
      s.p17Scope = Q.get('p17scope') === 'unbound' ? 'unbound' : '';
    }
    return s;
  }
  function once(html, from, to, where) {
    const n = html.split(from).length - 1;
    if (n !== 1) throw new Error('policy-1117：' + where + ' 的替换目标出现 ' + n + ' 次（应为 1 次）：' + from.slice(0, 40));
    return html.replace(from, () => to);
  }
  function find(id) {
    const d = (window.SCREENS || []).find((x) => x.id === id);
    if (!d) throw new Error('policy-1117：找不到屏 ' + id);
    return d;
  }
  const refresh = () => window.__proto.refresh();
  const svg = (s, body, w) => `<svg class="i" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w || 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const MAG = (s) => svg(s || 34, '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>', 2.2);
  const KB = {
    back: svg(36, '<path d="M8.5 5H20a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H8.5L3 12z"/><path d="m11.5 9.5 5 5m0-5-5 5"/>', 1.7),
    enter: svg(36, '<path d="M20 5v7a2 2 0 0 1-2 2H5"/><path d="m9 10-4 4 4 4"/>', 1.7),
    shift: svg(34, '<path d="M12 4 4 12h4.5v7h7v-7H20z"/>', 1.7),
    hide: svg(38, '<rect x="3" y="3.5" width="18" height="11" rx="1.5"/><path d="M7 7.5h.01M11 7.5h.01M15 7.5h.01M8 11h8"/><path d="m9 18 3 2.5 3-2.5"/>', 1.6),
    emoji: svg(34, '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 10h.01M15 10h.01"/>', 1.7),
    mic: svg(34, '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>', 1.7)
  };

  /* ───────── 样式（类名一律 p17-） ───────── */
  const css = document.createElement('style');
  css.id = 'p17-style';
  css.textContent = `
.p17-home.body{gap:20px;padding-top:28px}
.p17-home .grid2{gap:18px}
.p17-home .cat{min-height:214px;gap:8px;padding:22px 26px 20px}
.p17-home .cat .ic{width:64px;height:64px;border-radius:18px}
.p17-search{display:flex;flex-direction:column;gap:12px;flex:none}
.p17-sr{display:flex;gap:16px}
.p17-fw{position:relative;flex:1;min-width:0}
.p17-field{display:flex;align-items:center;gap:14px;height:96px;padding:0 100px 0 24px;border-radius:26px;background:var(--card);border:2px solid var(--edge);cursor:pointer}
.p17-field.idle{padding-right:26px}
.p17-field .mag{flex:none;display:grid;color:var(--ink-3)}
.p17-field .ph{flex:1;min-width:0;font-size:26px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.p17-field .kbi{flex:none;display:inline-flex;align-items:center;gap:8px;font-size:22px;color:var(--ink-3)}
.p17-field .val{flex:1;min-width:0;font:500 32px/1.45 var(--sans);color:var(--ink);white-space:nowrap;overflow:hidden}
.p17-field.on{border:2.5px solid var(--teal);box-shadow:0 0 0 6px rgba(31,158,134,.10)}
.p17-field.on .mag{color:var(--teal-ink)}
.p17-field.bad{border:2.5px solid var(--clay);box-shadow:0 0 0 6px rgba(184,104,60,.12)}
.p17-field.bad .mag{color:var(--clay-ink)}
.p17-x{position:absolute;right:12px;top:12px;width:72px;height:72px;border-radius:50%;background:var(--well);color:var(--ink-2);display:grid;place-items:center}
.p17-go.btn{height:96px;min-width:184px;border-radius:26px;padding:0 30px}
.p17-u{text-decoration:underline 3px var(--teal);text-underline-offset:7px;color:var(--teal-ink);margin-left:2px}
.p17-caret{display:inline-block;width:3px;height:1.05em;background:var(--teal);vertical-align:-.12em;margin-left:2px;animation:blink 1.1s step-end infinite}
.p17-field.bad .p17-caret{background:var(--clay)}
.p17-hint{display:flex;align-items:baseline;gap:16px;padding:0 8px;font-size:22px;color:var(--ink-3)}
.p17-hint b{margin-left:auto;font-weight:700;font-variant-numeric:tabular-nums;color:var(--ink-2)}
.p17-hint.bad{color:var(--clay-ink);font-weight:700}
.p17-hint.bad b{color:var(--clay-ink)}
.p17-tip{margin:0;padding:0 8px;font-size:22px;line-height:1.5;color:var(--ink-2)}
/* 系统触摸键盘的示意：Windows 自带，不是页面画的；灰底、平键，和本站配色分开 */
.p17-kb{position:absolute;left:0;right:0;bottom:0;z-index:25;display:flex;flex-direction:column;gap:8px;padding:0 10px 14px;background:#dfe2e1;border-top:1px solid #c4c9c7;box-shadow:0 -10px 30px rgba(0,0,0,.12);font-family:"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif}
.p17-kbbar{display:flex;align-items:center;gap:4px;height:78px;margin:0 -10px;padding:0 16px;border-bottom:1px solid #cdd1cf;background:#e9eceb}
.p17-kbbar .c{min-width:76px;height:62px;padding:0 16px;border-radius:8px;display:grid;place-items:center;font-size:32px;color:#1b1b1b;font-style:normal}
.p17-kbbar .c.on{background:#cdd2d0}
.p17-kbbar .more{margin-left:auto;display:grid;place-items:center;width:62px;height:62px;color:#5f6563}
.p17-kbbar .tl{width:62px;height:62px;display:grid;place-items:center;color:#3b403e;border-radius:8px}
.p17-kbbar .sp{flex:1}
.p17-kbr{display:flex;gap:8px}
.p17-k{flex:1 1 0;min-width:0;height:98px;border-radius:8px;background:#fbfbfb;box-shadow:0 1px 0 rgba(0,0,0,.2);display:grid;place-items:center;font-size:32px;color:#1b1b1b;font-style:normal}
.p17-k.fn{background:#eef0ef;font-size:24px;color:#2b2f2d}
.p17-k.w14{flex-grow:1.4}.p17-k.w18{flex-grow:1.8}.p17-k.sp{flex-grow:5.4}
/* 搜索结果 */
.p17-res .stack{gap:16px}
.p17-res .pol{min-height:220px;padding:26px 34px;gap:10px}
.p17-res .pol .meta .chip,.p17-list .pol .meta .chip{height:36px;font-size:20px}
.p17-hl{background:rgba(31,158,134,.18);color:var(--teal-ink);border-radius:6px;padding:0 4px;margin:0 1px}
.p17-card{display:flex;gap:28px;align-items:center}
.p17-card .tx{flex:1;min-width:0}
.p17-card .art{display:flex;flex-direction:column;align-items:center;gap:10px;flex:none}
.p17-card .art .chip{height:36px;font-size:20px}
.p17-card.tall{min-height:720px}
.p17-gone .p17-card{min-height:760px}
/* 原文摘录 */
.p17-pcbody.body{gap:14px;padding-top:22px;padding-bottom:20px}
.p17-pcbody .dsec{padding:24px 32px}
.p17-pcbody .dsec h4{margin-bottom:10px}
.p17-pcbody .dsec li{line-height:1.5}
.p17-pcbody .tile{min-height:116px;padding-top:14px;padding-bottom:14px}
.p17-pch{display:flex;align-items:center;gap:14px;margin-bottom:10px}
.p17-pch h4{margin:0!important}
.p17-pch .chip{height:36px;font-size:20px}
.p17-more{margin-left:auto;display:inline-flex;align-items:center;gap:6px;height:72px;padding:0 16px 0 24px;border-radius:22px;background:var(--teal-wash);color:var(--teal-ink);font:700 24px/1 var(--sans);white-space:nowrap}
.p17-pcx{margin:0;font-size:25px;line-height:1.6;color:var(--ink-2);white-space:pre-wrap;word-break:break-all}
.p17-pcx.cut{max-height:80px;overflow:hidden;-webkit-mask-image:linear-gradient(#000 40%,transparent);mask-image:linear-gradient(#000 40%,transparent)}
.p17-sheet.sheet{top:250px;max-height:none;padding:18px 48px 34px;gap:16px}
.p17-shh{display:flex;align-items:flex-start;gap:18px}
.p17-shh h2{margin:4px 0 0;font:700 40px/1.3 var(--serif)}
.p17-shh small{display:block;margin-top:6px;font-size:22px;line-height:1.4;color:var(--ink-3)}
.p17-shh .chip{margin-left:auto;margin-top:8px;flex:none}
.p17-read{flex:1;min-height:0;overflow:hidden;padding:24px 30px;border-radius:24px;background:var(--card);border:1.5px solid var(--edge);font-size:27px;line-height:1.75;color:var(--ink);white-space:pre-wrap;word-break:break-all}
.p17-pager{display:flex;align-items:center;gap:16px}
.p17-pager .btn{flex:1;min-width:0}
.p17-pager span{min-width:190px;text-align:center;font-size:24px;font-weight:700;color:var(--ink-2);font-variant-numeric:tabular-nums}
.p17-shfine{margin:0;font-size:22px;line-height:1.5;color:var(--ink-3);text-align:center}
.p17-sheet .p17-close{width:100%}
`;
  document.head.appendChild(css);

  /* ───────── 示例数据（和 policy-min 首页的条数、最近一条对得上） ───────── */
  const ORG = '某大学就业指导中心', ORG2 = '某区就业服务中心';
  const WORD = '创业', NONE_WORD = '失业金';
  const LONG = '我今年刚从大学毕业，想回老家创业，请问有没有补贴可以领，要去哪里办理';
  const MAX = 30;
  const RES = [
    { t: '高校毕业生一次性求职创业补贴', sum: '毕业学年内、家庭困难等几类毕业生；材料 4 项', org: ORG, date: '11 月 5 日', cat: '应届高校毕业生', dl: '12 月 31 日截止' },
    { t: '创业担保贷款贴息', sum: '个人创业和小微企业可以申请创业担保贷款，按规定享受财政贴息', org: ORG2, date: '11 月 2 日', cat: '创业扶持', dl: '' },
    { t: '一次性开业补贴', sum: '首次创业、正常经营满 6 个月的个体工商户和小微企业', org: ORG2, date: '10 月 30 日', cat: '创业扶持', dl: '11 月 30 日截止' },
    { t: '求职创业补贴申报常见问题', sum: '申报时间、材料补交和办理进度怎么查', org: ORG, date: '10 月 21 日', cat: '应届高校毕业生', dl: '' }
  ];
  /* 发布机构在后台填的「正文」示例（纯文本、原样）。阅读层按两页画，运行页按屏高翻页。 */
  const PC_P1 = '　　为帮助困难家庭高校毕业生顺利求职创业，根据上级有关文件要求，现将本学年一次性求职创业补贴申报的有关事项说明如下。\n'
    + '一、补贴对象\n'
    + '　　毕业学年内有就业创业意愿并积极求职创业的普通高校毕业生，且属于下列情形之一：\n'
    + '（一）城乡居民最低生活保障家庭；\n（二）脱贫家庭（含防止返贫监测对象家庭）；\n（三）残疾人；\n（四）在校期间获得国家助学贷款；\n（五）特困人员。\n'
    + '二、补贴标准\n'
    + '　　补贴标准按当年上级文件执行，每人只能享受一次。\n'
    + '三、申报时间\n'
    + '　　11 月 5 日起至 12 月 31 日止，逾期不再受理。\n'
    + '四、申报方式\n'
    + '（一）本人提出申请，填写《一次性求职创业补贴申请表》，连同证明材料交学校就业指导中心（学生活动中心二楼）。\n'
    + '（二）就业指导中心审核后公示 5 个工作日，无异议的报人社部门审核发放。\n'
    + '五、需要提交的材料\n'
    + '（一）本人身份证复印件；\n（二）学生证或学籍证明；\n（三）对应困难类型的证明材料；\n（四）本人银行卡复印件。';
  const PC_P2 = '六、其他\n'
    + '（一）申请人对所交材料的真实性负责，弄虚作假的取消补贴资格。\n'
    + '（二）补贴资金直接发到本人银行账户，不得由他人代领。\n'
    + '（三）咨询地点：学生活动中心二楼就业指导中心，工作日上午 9 点至 11 点半、下午 2 点至 5 点。\n'
    + '某大学就业指导中心\n11 月 5 日';
  const PC_SHORT = '材料不齐的，可以在 12 月 25 日前到学生活动中心二楼补交一次。';
  const words = (t) => Array.from(t.replace(/\s/g, '')).length;
  const about = (n) => '约 ' + (Math.round(n / 10) * 10).toLocaleString('zh-CN') + ' 字';
  const hl = (t, w) => t.split(w).join(`<mark class="p17-hl">${w}</mark>`);
  const dl = (t) => (t ? `<span class="chip clay">${t}</span>` : '');
  const fine = (t) => `<p class="fine">${t}</p>`;

  /* ───────── 搜索框 ───────── */
  function field(o) {
    // o.mode：idle 未输入 / typing 输入中 / filled 已有词（结果屏、收起键盘后）
    if (o.mode === 'idle') {
      return `<div class="p17-search"><div class="p17-sr"><div class="p17-fw"><div class="p17-field idle" role="button" tabindex="0" data-p17="focus" aria-label="输入一个词找政策">
        <span class="mag">${MAG()}</span><span class="ph">输入一个词找政策，比如「补贴」「见习」</span><span class="kbi">${icon('keyboard', 30, 2)}</span></div></div></div></div>`;
    }
    const v = o.val;
    const caret = o.mode === 'typing' ? '<i class="p17-caret" aria-hidden="true"></i>' : '';
    const len = v === 'long' ? LONG.length : v === 'done' ? 2 : v === 'comp' ? 1 : v === 'blank' ? 0 : Array.from(o.word || '').length;
    const bad = len > MAX;
    let shown;
    if (v === 'comp') shown = `创<u class="p17-u">ye</u>${caret}`;
    else if (v === 'done') shown = `${WORD}${caret}`;
    else if (v === 'long') shown = `…${LONG.slice(-17)}${caret}`;
    else if (v === 'blank') shown = '';
    else shown = `${o.word}${caret}`;
    const inner = v === 'blank'
      ? `<span class="mag">${MAG()}</span>${caret}<span class="ph">输入一个词找政策，比如「补贴」「见习」</span>`
      : `<span class="mag">${MAG()}</span><span class="val">${shown}</span>`;
    const tapAttr = o.mode === 'typing' ? '' : (o.onTap || 'data-p17="focus"');
    const x = v === 'blank' ? '' : `<button class="p17-x" data-p17="clear" aria-label="${o.clearLabel || '清空'}">${icon('x', 30, 2.4)}</button>`;
    const go = o.noGo ? '' : `<button class="btn pri p17-go" data-p17="go" ${bad || len === 0 ? 'disabled' : ''}>${MAG(30)}搜索</button>`;
    let below = '';
    if (o.mode === 'typing' || bad) {
      below = bad
        ? `<div class="p17-hint bad"><span>最多 ${MAX} 个字，现在 ${len} 个字</span><b>${len} / ${MAX}</b></div><p class="p17-tip">这里按政策标题和摘要里的词找，输入一个词就够，比如「创业」「补贴」。</p>`
        : `<div class="p17-hint"><span>按政策标题和摘要找，输入一个词就行</span><b>${len} / ${MAX}</b></div>`;
    }
    return `<div class="p17-search"><div class="p17-sr"><div class="p17-fw"><div class="p17-field ${o.mode === 'typing' ? 'on' : ''} ${bad ? 'bad' : ''}" ${tapAttr ? 'role="button" tabindex="0" ' + tapAttr : ''} aria-label="搜索框">${inner}</div>${x}</div>${go}</div>${below}</div>`;
  }

  /* 系统触摸键盘示意（Windows 自带）：拼音候选在键盘顶上一条；没在打拼音时顶上是工具条 */
  function keyboard(val) {
    const comp = val === 'comp';
    const bar = comp
      ? `<div class="p17-kbbar"><button class="c on" data-p17="pick">业</button>${['也', '夜', '页', '叶', '液', '野', '冶'].map((c) => `<i class="c">${c}</i>`).join('')}<span class="more">${icon('chevR', 32, 2)}</span></div>`
      : `<div class="p17-kbbar"><span class="tl">${KB.emoji}</span><span class="tl">${KB.mic}</span><span class="sp"></span><button class="tl" data-p17="kbhide" aria-label="收起键盘">${KB.hide}</button></div>`;
    const keys = (s) => [...s].map((c) => `<i class="p17-k">${c}</i>`).join('');
    return `<div class="p17-kb" aria-hidden="false">${bar}
      <div class="p17-kbr">${keys('qwertyuiop')}<i class="p17-k fn w14">${KB.back}</i></div>
      <div class="p17-kbr">${keys('asdfghjkl')}<button class="p17-k fn w18" data-p17="go" aria-label="回车：搜索">${KB.enter}</button></div>
      <div class="p17-kbr"><i class="p17-k fn w14">${KB.shift}</i>${keys('zxcvbnm，。')}<i class="p17-k fn w14">${KB.shift}</i></div>
      <div class="p17-kbr"><i class="p17-k fn w14">&amp;123</i><i class="p17-k fn">中</i><i class="p17-k sp"></i><i class="p17-k fn">‹</i><i class="p17-k fn">›</i><button class="p17-k fn w14" data-p17="kbhide" aria-label="收起键盘">${KB.hide}</button></div></div>`;
  }

  /* ───────── 1. 首页：加搜索框 ───────── */
  const home = find('policy');
  const homeR0 = home.render;
  home.render = () => {
    const s = S();
    let h = homeR0();
    const typing = s.p17Home === 'typing';
    const val = s.p17Val;
    const fld = typing ? field({ mode: 'typing', val }) : (val === 'done' || val === 'long') ? field({ mode: 'filled', val }) : field({ mode: 'idle' });
    h = once(h, '<main class="body ">', '<main class="body p17-home">', '首页 body');
    h = once(h, '<div class="grid2">', fld + '<div class="grid2">', '首页类别卡');
    h = once(h, '条数从发布数据读；', '', '首页页脚');
    if (typing) h += keyboard(val);
    return h;
  };
  home.name = '政策首页（最小闭环 + 11/17 搜索）';
  home.notes = {
    does: '在 11/05 首页的类别卡上方加搜索框。点框弹出 Windows 系统触摸键盘（输入中）；按「搜索」或键盘回车，带着关键词去搜索结果屏 policy-search。超过 30 个字时框变陶土色、「搜索」停用，提示改成一个词。为腾出搜索框，类别卡压矮（图标 64、最低高 214）；其余照 11/05。页脚去掉「条数从发布数据读」（给开发看的话）。',
    motion: '光标每秒闪一次；键盘是系统自己弹出来的，页面不另做动画。',
    keep: '首页读到政策时才出搜索框（读取中、没读到、全库 0 条都不出）；授权收尾（winding-down）时和类别卡一起停用。系统键盘只在手指点输入框时弹出（鼠标点不弹），所以首页这一格本身就是输入框，不换页再自动聚焦。下半屏灰色键盘是系统触摸键盘的示意，高度、键位、工具条以真机为准；输入框、清空、搜索、字数都在上半屏，键盘盖住下半截或页面缩到键盘上方都能用。字数按字符串长度算，和服务端 POLICY_KEYWORD_MAX_LENGTH 同一口径（一个汉字算 1，少数生僻字和表情算 2）；拼音还在候选栏、没选字时不算。去掉首尾空格后是空的不发请求；超过 30 字不发请求；万一服务端回 400 POLICY_KEYWORD_TOO_LONG，也按「超过 30 字」显示，不当成没连上。只搜政策（kind=policy_guide），公告不在搜索范围。关键词只在这一次使用里留着：清场、结束使用后清掉，不进浏览记录，也不给发布机构看。微软拼音会不会把上一位打过的词留在候选栏里，真机验收时和输入样板 kbd-short 一起看。'
  };
  home.demo = () => (S().p17Home === 'typing'
    ? [{ label: '演示：用拼音打出「创」，正在打 ye', ev: 'p17-comp' }, { label: '演示：打了 34 个字', ev: 'p17-long' }, { label: '演示：清空', ev: 'p17-blank' }]
    : [{ label: '演示：点搜索框（弹出系统键盘）', ev: 'p17-focus' }]);

  /* ───────── 2. 新屏：搜索结果 ───────── */
  function resRows() {
    return `<div class="stack">${RES.map((p, i) => `<button class="pol rise" style="--i:${i}" data-go="policy-detail" data-set="p17Pc=long;p17Open=false;p17Gone="><b>${hl(p.t, WORD)}</b><span class="sum">${hl(p.sum, WORD)}</span><div class="meta"><span>${icon('landmark', 22, 2)} ${p.org}</span><span>更新于 ${p.date}</span><span class="chip slate">${p.cat}</span>${dl(p.dl)}</div></button>`).join('')}</div>`;
  }
  function sample(label, w) {
    return `<div class="art">${checklist(w || 280)}<span class="chip slate">${label}</span></div>`;
  }
  function searchR() {
    const s = S();
    const v = s.p17Res;
    const word = v === 'none' ? NONE_WORD : WORD;
    const fld = field({ mode: 'filled', word, val: 'word', noGo: true, clearLabel: '清空，回到政策首页', onTap: 'data-act="toast" data-arg="演示：在这一屏弹出系统触摸键盘改词，样子同政策首页「输入中」"' });
    const ask = '问小青：这些政策怎么看？';
    if (v === 'loading') {
      return band({ eyebrow: '查政策 · 搜索', title: `正在找含「${word}」的政策`, sub: '找到后列出标题、发布机构和更新时间。', seal: null })
        + `<main class="body p17-res">${fld}
          <div class="dsec p17-card tall rise" style="--i:0"><div class="tx"><h4>${icon('clock', 30, 2)}正在按标题和摘要找</h4><ul><li>只找发布机构在后台发布、还没过截止日期的政策</li><li>打印、扫描照常</li></ul></div>${sample('找到后可以打印这样一页', 300)}</div>
          <button class="rowlink rise" style="--i:1" data-go="policy" data-set="p17Home=;p17Val=blank">${icon('landmark', 32, 2)}<span><b>不等了，按类别看全部政策</b></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button>
          ${fine('政策由发布机构自行审核发布，以官方原文为准')}</main>`
        + dock({ ask }) + nav('home');
    }
    if (v === 'failed') {
      return band({ eyebrow: '查政策 · 搜索', title: '这次没读到搜索结果', sub: '不是没有相关政策，是这次没连上。关键词还在，可以再搜一次。', seal: null })
        + `<main class="body p17-res">${fld}
          <div class="dsec p17-card rise" style="--i:0"><div class="tx"><h4>${icon('wifi', 30, 2)}这次没连上</h4><ul><li>关键词「${word}」还留在框里</li><li>可以再搜一次，或者先按类别看</li><li>打印、扫描照常</li></ul></div>${sample('找到后可以打印这样一页')}</div>
          <div class="grid2"><button class="cat rise" style="--i:1" data-p17="retry"><span class="ic">${icon('refresh', 38, 2)}</span><b>再搜一次</b><small>还是搜「${word}」</small></button><button class="cat rise" style="--i:2" data-go="policy" data-set="p17Home=;p17Val=blank"><span class="ic">${icon('landmark', 38, 2)}</span><b>按类别看全部政策</b><small>六类都在政策首页</small></button></div>
          ${fine('政策由发布机构自行审核发布，以官方原文为准')}</main>`
        + dock({ ask }) + nav('home');
    }
    if (v === 'none') {
      return band({ eyebrow: '查政策 · 搜索结果', title: `没有找到含「${word}」的政策`, sub: '只按政策标题和摘要找；过了截止日期的政策不再显示。', seal: null })
        + `<main class="body p17-res">${fld}
          <div class="dsec p17-card rise" style="--i:0"><div class="tx"><h4>${icon('help', 30, 2)}可以这样再找</h4><ul><li>换一个更短的词，比如「失业」「补贴」</li><li>按类别看全部政策</li><li>这里只有发布机构在本机发布的政策，没在这里发布的，以发布机构的官方渠道为准</li></ul></div>${sample('找到政策后可以打印这样一页', 260)}</div>
          <div class="grid2"><button class="cat rise" style="--i:1" data-act="toast" data-arg="演示：弹出系统触摸键盘，框里的词可以改"><span class="ic">${icon('keyboard', 38, 2)}</span><b>换个词再搜</b><small>键盘弹出后改框里的词</small></button><button class="cat rise" style="--i:2" data-go="policy" data-set="p17Home=;p17Val=blank"><span class="ic">${icon('landmark', 38, 2)}</span><b>按类别看全部政策</b><small>六类都在政策首页</small></button></div>
          <button class="rowlink rise" style="--i:3" data-go="policy-list">${icon('message', 32, 2)}<span><b>机构公告</b> <small>· 2 条 · 公告不在搜索范围里</small></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button></main>`
        + dock({ ask }) + nav('home');
    }
    return band({ eyebrow: '查政策 · 搜索结果', title: `找到 ${RES.length} 条含「${word}」的政策`, sub: '按标题和摘要找 · 每条写明发布机构 · 过了截止日期的不显示', seal: null })
      + `<main class="body p17-res">${fld}${resRows()}${fine('示例内容 · 政策由发布机构自行审核发布，以官方原文为准')}</main>`
      + dock({ ask }) + nav('home');
  }
  const SEARCH_NOTES = {
    does: '搜索结果：沿用列表屏的政策行，每行把关键词标出来，写发布机构、更新时间、类别、截止日期（填了才写）。一页 4 条，多于 4 条时底部出「第 1 / 2 页 · 再看 4 条」（同列表屏）。顶部还是搜索框：点框在本屏弹出系统键盘改词，右边 × 清空并回政策首页。四态：正在找、有结果、没结果、没连上。',
    motion: '结果依次浮入；正在找不转圈、不画骨架。',
    keep: '接口 GET /api/v1/policies?kind=policy_guide&keyword=…&page=&pageSize=4。服务端去首尾空白、最长 30 字（超长回 400），按标题和摘要包含匹配，和类别、分页、显示范围、截止日期一起生效；过了截止日期（北京时间过了当天）的不返回，屏上不画「已过期」。只做一个词的整段包含匹配：「创业贷款」找不到「创业担保贷款贴息」，所以提示一律写「输入一个词」。没结果照实写空，给换个词、按类别看、机构公告（有公告才出）三条出路，不拿别的政策凑数。没连上不说成没结果：标题「这次没读到搜索结果」，关键词留着，可以再搜一次；8 秒没回来按没连上（policyRead 同一个超时）。结果是服务端回报，原型里用说明栏的演示事件切换，屏上不演成功。'
  };
  const search = {
    id: 'policy-search', group: '查政策', name: '搜政策结果（11/17 补稿）', notes: SEARCH_NOTES, render: searchR,
    demo: () => [{ label: '演示：服务端回了 4 条', ev: 'p17-res-results' }, { label: '演示：服务端回了 0 条（换成「失业金」）', ev: 'p17-res-none' }, { label: '演示：没连上', ev: 'p17-res-failed' }, { label: '演示：正在找', ev: 'p17-res-loading' }]
  };
  {
    const list = window.SCREENS;
    const i = list.findIndex((x) => x.id === 'policy-list');
    list.splice(i < 0 ? list.length : i + 1, 0, search);
  }

  /* ───────── 3. 列表：截止日期 ───────── */
  const lst = find('policy-list');
  const lstR0 = lst.render;
  lst.render = () => {
    let h = lstR0();
    h = once(h, '<main class="body ">', '<main class="body p17-list">', '列表 body');
    h = once(h, '<span>更新于 11 月 5 日</span>', '<span>更新于 11 月 5 日</span>' + dl('12 月 31 日截止'), '列表截止 1');
    h = once(h, '<span>更新于 11 月 3 日</span>', '<span>更新于 11 月 3 日</span>' + dl('11 月 28 日截止'), '列表截止 2');
    h = once(h, '示例内容 · 一页 4 条，多了点「再看 4 条」；以发布机构原文为准', '示例内容 · 政策由发布机构自行审核发布，以官方原文为准', '列表页脚');
    return h;
  };
  lst.name = '政策列表（最小闭环 + 11/17 截止日期）';
  lst.notes = Object.assign({}, lst.notes, {
    keep: (lst.notes && lst.notes.keep ? lst.notes.keep + ' ' : '') + '11/17：发布机构填了截止日期的写「X 月 X 日截止」（陶土色小签，放在更新时间后面）；截止日期当天仍显示，过了当天（北京时间）服务端不返回，列表里不会出现，也不画「已过期」。每小时任务把过期的写成已下架，只影响后台状态，一体机不等它。页脚去掉「一页 4 条，多了点「再看 4 条」」（给开发看的话）。'
  });

  /* ───────── 4. 详情：原文摘录、截止日期、已看不到 ───────── */
  function pcSection(s) {
    if (s.p17Pc === 'short') {
      return `<div class="dsec rise" style="--i:3"><div class="p17-pch"><h4>${icon('book', 30, 2)}原文摘录</h4><span class="chip slate">以发布机构原文为准</span></div><p class="p17-pcx">${PC_SHORT}</p></div>`;
    }
    return `<div class="dsec rise" style="--i:3"><div class="p17-pch"><h4>${icon('book', 30, 2)}原文摘录</h4><span class="chip slate">以发布机构原文为准</span><button class="p17-more" data-p17="pc-open">展开全文 · ${about(words(PC_P1 + PC_P2))}${icon('chevR', 26, 2.4)}</button></div><p class="p17-pcx cut">${PC_P1}</p></div>`;
  }
  function sheet(s) {
    const p = s.p17Page === 2 ? 2 : 1;
    return `<div class="scrim" data-p17="pc-close"></div><div class="sheet p17-sheet" role="dialog" aria-label="原文摘录"><div class="grab"></div>
      <div class="p17-shh"><div><h2>原文摘录</h2><small>高校毕业生一次性求职创业补贴 · ${ORG}发布 · 11 月 5 日</small></div><span class="chip slate">以发布机构原文为准</span></div>
      <div class="p17-read">${p === 1 ? PC_P1 : PC_P2}</div>
      <div class="p17-pager"><button class="btn sec" data-p17="pc-prev" ${p === 1 ? 'disabled' : ''}>${icon('chevL', 30, 2.4)}上一页</button><span>第 ${p} / 2 页</span><button class="btn pri" data-p17="pc-next" ${p === 2 ? 'disabled' : ''}>下一页${icon('chevR', 30, 2.4)}</button></div>
      <p class="p17-shfine">这是发布机构填写的正文，原样显示，没有改动；办理以发布机构原文为准。</p>
      <button class="btn sec p17-close" data-p17="pc-close">收起</button></div>`;
  }
  function goneR(kind) {
    const exp = kind === 'expired';
    const head = exp
      ? { eyebrow: `${ORG}发布 · 12 月 31 日截止`, title: '这条政策已过截止日期' }
      : { eyebrow: '查政策', title: '这条政策现在看不到了' };
    const items = exp
      ? ['发布机构写的截止日期是 12 月 31 日，过了这一天，这里不再显示', '不再显示正文、原文二维码和办事清单', '还要办理的，以发布机构原文和官方渠道为准']
      : ['发布机构写的截止日期已经过了', '发布机构已经撤下这一条', '这一条不在本机的显示范围里'];
    return band({ kind: 'compact', eyebrow: head.eyebrow, title: head.title, seal: null })
      + `<main class="body tight p17-gone"><div class="dsec p17-card rise" style="--i:0"><div class="tx"><h4>${icon(exp ? 'clock' : 'help', 30, 2)}${exp ? '12 月 31 日已截止' : '可能是这几种情况'}</h4><ul>${items.map((t) => `<li>${t}</li>`).join('')}</ul>${exp ? '' : '<p class="fine left" style="margin-top:14px;font-size:22px">不再显示旧正文、原文二维码和办事清单。</p>'}</div>${sample('有政策时可以打印这样一页', 380)}</div>
        <div class="grid2"><button class="cat rise" style="--i:1" data-go="policy" data-set="p17Gone=;p17Home=;p17Val=blank"><span class="ic">${icon('landmark', 38, 2)}</span><b>返回政策首页</b><small>看现在发布的政策</small></button><button class="cat rise" style="--i:2" data-go="home" data-set="p17Gone="><span class="ic">${icon('home', 38, 2)}</span><b>回首页办别的事</b><small>打印、扫描、改简历、练面试照常</small></button></div>
        ${fine('政策由发布机构自行审核发布，以官方原文为准')}</main>`
      + dock({ ask: false }) + nav(null);
  }
  const det = find('policy-detail');
  const detR0 = det.render;
  det.render = () => {
    const s = S();
    if (s.p17Gone) return goneR(s.p17Gone);
    let h = detR0();
    h = once(h, `${ORG}发布 · 11 月 5 日`, `${ORG}发布 · 11 月 5 日 · 12 月 31 日截止`, '详情意图带');
    if (s.p17Pc === 'none') return h;
    h = once(h, '<main class="body tight">', '<main class="body tight p17-pcbody">', '详情 body');
    h = once(h, '<div class="grid2">', pcSection(s) + '<div class="grid2">', '详情原文摘录');
    if (s.p17Open && s.p17Pc === 'long') h += sheet(s);
    return h;
  };
  det.name = '政策详情（最小闭环 + 11/17 原文摘录）';
  det.notes = Object.assign({}, det.notes, {
    does: (det.notes && det.notes.does ? det.notes.does + ' ' : '') + '11/17：发布机构填了正文（policy.content 非空）时，三块下方加「原文摘录」：标题右边写「以发布机构原文为准」，先露两行，「展开全文 · 约 N 字」打开阅读层；阅读层原样显示全文，「上一页」「下一页」整屏翻（手指上下拖也能翻），写「第 1 / 2 页」，底部「收起」。正文两行放得下就整段放下，不出展开键。没填正文不出这一节，页面和 11/05 一样。意图带写截止日期（填了才写）。',
    keep: (det.notes && det.notes.keep ? det.notes.keep + ' ' : '') + '11/17：正文按纯文本原样显示，保留换行，不排版、不摘要、不让 AI 改写；正文里的网址只当文字，不生成二维码（二维码只给发布时核对过的原文链接）。字数按去掉空白后的字数取整到十位写「约」。正文后端没有长度上限，阅读层按屏翻，几十页也照样翻。有正文时三块的内边距和行距略收（字号不变），没正文时和 11/05 一样。从收藏或浏览记录打开、这条已经看不到（服务端 404：撤下、过了截止日期或不在本机显示范围）时，标题「这条政策现在看不到了」，三种可能都写上，不再只说「撤下」；正在看时过了截止日期（30 秒复查时这条已知截止日期且已过），标题「这条政策已过截止日期」，写明哪一天截止。两种都不再显示正文、原文二维码和清单。'
  });
  det.demo = () => {
    const s = S();
    if (s.p17Gone) return [{ label: '演示：恢复（这条还在发布中）', ev: 'p17-gone-off' }];
    return [
      { label: '演示：正文较长（默认）', ev: 'p17-pc-long' }, { label: '演示：正文很短', ev: 'p17-pc-short' }, { label: '演示：发布机构没填正文', ev: 'p17-pc-none' },
      { label: '演示：从收藏打开时已看不到（404）', ev: 'p17-gone-gone' }, { label: '演示：30 秒复查时已过截止日期', ev: 'p17-gone-expired' }
    ];
  };

  /* ───────── 5. 空态：没绑运营机构 ───────── */
  const emp = find('policy-empty');
  const empR0 = emp.render;
  emp.render = () => {
    let h = empR0();
    h = once(h, '空态照实写；全库为 0 条时整屏换成这一屏，不显示类别卡', '政策由发布机构自行审核发布，以官方原文为准', '空态页脚');
    if (S().p17Scope === 'unbound') h = once(h, '<h1>这里还没有发布的政策</h1>', '<h1>本机还没有运营机构发布的政策</h1>', '空态标题');
    return h;
  };
  emp.name = '政策空态（最小闭环 + 11/17 没绑机构）';
  emp.notes = Object.assign({}, emp.notes, {
    keep: (emp.notes && emp.notes.keep ? emp.notes.keep + ' ' : '') + '11/17：服务端给出 scope=unbound（终端没绑运营机构）或 scope=missing（认不出终端）且一条没有时，标题换成产品负责人批过的「本机还没有运营机构发布的政策」，副题、三步、两条出路照旧；scope 缺省（显示范围是所有终端，试点现状）时照旧「这里还没有发布的政策」。页脚原来那句「空态照实写；全库为 0 条时整屏换成这一屏，不显示类别卡」是给开发看的，挪进说明，屏上换成边界句。'
  });
  emp.demo = () => (S().p17Scope === 'unbound'
    ? [{ label: '演示：显示范围是所有终端（原样标题）', ev: 'p17-scope-all' }]
    : [{ label: '演示：本机没绑运营机构', ev: 'p17-scope-unbound' }]);

  /* ───────── 流程条：搜政策 ───────── */
  if (Array.isArray(window.FLOWS)) window.FLOWS.push({ n: '搜政策', ids: ['policy', 'policy-search', 'policy-detail'] });

  /* ───────── 点击与演示事件 ───────── */
  function onClick(e) {
    const b = e.target.closest('[data-p17]');
    if (!b || !e.currentTarget.contains(b) || b.disabled) return;
    e.stopPropagation();
    const s = S(), k = b.dataset.p17;
    if (k === 'focus') { s.p17Home = 'typing'; if (s.p17Val !== 'done' && s.p17Val !== 'long') s.p17Val = 'blank'; }
    else if (k === 'pick') s.p17Val = 'done';
    else if (k === 'kbhide') s.p17Home = '';
    else if (k === 'clear') {
      if (e.currentTarget.dataset.id === 'policy-search') { s.p17Home = ''; s.p17Val = 'blank'; window.go('policy'); return; }
      s.p17Val = 'blank';
    }
    else if (k === 'go') {
      if (s.p17Val === 'long' || s.p17Val === 'blank') return;
      s.p17Home = ''; s.p17Val = 'blank'; s.p17Res = 'loading'; window.go('policy-search'); return;
    }
    else if (k === 'retry') s.p17Res = 'loading';
    else if (k === 'pc-open') { s.p17Open = true; s.p17Page = 1; }
    else if (k === 'pc-close') s.p17Open = false;
    else if (k === 'pc-next') s.p17Page = 2;
    else if (k === 'pc-prev') s.p17Page = 1;
    else return;
    refresh();
  }
  function onDemo(e) {
    const s = S(), d = e.detail;
    const map = {
      'p17-focus': () => { s.p17Home = 'typing'; s.p17Val = 'blank'; },
      'p17-comp': () => { s.p17Val = 'comp'; }, 'p17-long': () => { s.p17Val = 'long'; }, 'p17-blank': () => { s.p17Val = 'blank'; },
      'p17-res-results': () => { s.p17Res = 'results'; }, 'p17-res-none': () => { s.p17Res = 'none'; }, 'p17-res-failed': () => { s.p17Res = 'failed'; }, 'p17-res-loading': () => { s.p17Res = 'loading'; },
      'p17-pc-long': () => { s.p17Pc = 'long'; }, 'p17-pc-short': () => { s.p17Pc = 'short'; s.p17Open = false; }, 'p17-pc-none': () => { s.p17Pc = 'none'; s.p17Open = false; },
      'p17-gone-gone': () => { s.p17Gone = 'gone'; s.p17Open = false; }, 'p17-gone-expired': () => { s.p17Gone = 'expired'; s.p17Open = false; }, 'p17-gone-off': () => { s.p17Gone = ''; },
      'p17-scope-unbound': () => { s.p17Scope = 'unbound'; }, 'p17-scope-all': () => { s.p17Scope = ''; }
    };
    if (!map[d]) return;
    map[d]();
    refresh();
  }
  for (const d of [home, search, lst, det, emp]) {
    const m0 = d.mount;
    d.mount = (el) => {
      const c0 = m0 ? m0(el) : null;
      el.addEventListener('click', onClick);
      el.addEventListener('proto-demo', onDemo);
      return () => { el.removeEventListener('click', onClick); el.removeEventListener('proto-demo', onDemo); if (c0) c0(); };
    };
  }
})();
