/* fix-public.js：本区（公共与系统页）新增的样式、示例数据与屏逻辑。类名一律加「fp-」前缀。 */
(function () {
  const css = document.createElement('style');
  css.textContent = `
.fp-fill.body{justify-content:flex-start;gap:12px;padding:14px 40px 12px}
.fp-grow{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;background:var(--well);border-radius:28px;padding:12px}
.fp-rest{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;justify-content:center}
.fp-block{display:flex;flex-direction:column;gap:12px}
.fp-stack{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px}
.fp-stack>.fp-card,.fp-stack>.fp-hit,.fp-stack>.fp-well,.fp-stack>.fp-rec{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center}
.fp-split.fp-fill{flex:1;min-height:0;grid-auto-rows:1fr}
.fp-split.fp-fill>.fp-card,.fp-split.fp-fill>.fp-hit{height:100%;min-height:0;display:flex;flex-direction:column;justify-content:center}
.fp-list.fp-fill{flex:1;min-height:0}
.fp-list.fp-fill>.fp-hit,.fp-list.fp-fill>.fp-card,.fp-list.fp-fill>.fp-rec{flex:1;min-height:0}
.fp-list.fp-fill>.fp-card,.fp-list.fp-fill>.fp-rec{display:flex;flex-direction:column;justify-content:center}
.fp-qrart{flex:1;min-height:180px;display:grid;place-items:center}
.fp-hero{min-height:220px;justify-content:center}
.fp-well{background:var(--well);border-radius:24px;padding:16px 18px}
.fp-card{background:var(--card);border:1.5px solid var(--edge);border-radius:24px;padding:14px 16px}
.fp-hit{display:flex;align-items:center;gap:14px;width:100%;min-height:72px;padding:12px 16px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge);text-align:left;font-size:24px;line-height:1.35;color:var(--ink)}
.fp-hit b{display:block;font-size:28px;line-height:1.3;font-weight:700}
.fp-hit small{display:block;margin-top:4px;font-size:20px;line-height:1.4;color:var(--ink-2);font-weight:500}
.fp-hit .fp-ic{width:64px;height:64px;border-radius:18px;display:grid;place-items:center;flex:none;background:var(--teal-wash);color:var(--teal-ink)}
.fp-hit .fp-go{margin-left:auto;color:var(--ink-3);flex:none}
.fp-list{display:flex;flex-direction:column;gap:10px}
.fp-split{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.fp-split3{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.fp-theme{min-height:150px;align-items:flex-start}
.fp-note{margin:0;font-size:22px;line-height:1.5;color:var(--ink-2)}
.fp-note b{color:var(--ink);font-weight:700}
.fp-k{margin:0 0 6px;font-size:20px;font-weight:700;color:var(--teal-ink)}
.fp-ol{margin:0;padding-left:28px;display:flex;flex-direction:column;gap:8px}
.fp-ol li{font-size:22px;line-height:1.45;color:var(--ink-2)}
.fp-ol b{color:var(--ink)}
.fp-row{display:flex;gap:12px}
.fp-row>*{flex:1;min-width:0}
.fp-statgrid{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(4,1fr);gap:10px}
.fp-stat{display:flex;flex-direction:column;justify-content:center;gap:4px;min-height:0;padding:10px 16px;border-radius:20px;background:var(--card);border:1.5px solid var(--edge)}
.fp-stat span{font-size:20px;color:var(--ink-3)}
.fp-stat b{font-size:26px;line-height:1.25}
.fp-stat em{font-style:normal;font-size:20px;line-height:1.35;color:var(--ink-2)}
.fp-bad{color:var(--cinnabar)}
.fp-mid{color:var(--clay-ink)}
.fp-ok{color:var(--teal-ink)}
.fp-dim{color:var(--ink-3);font-weight:600}
.fp-big{margin:0;font:700 132px/0.9 var(--sans);color:var(--deep);font-variant-numeric:tabular-nums}
.fp-qrs{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;gap:12px}
.fp-qrs.one{grid-template-columns:1fr}
.fp-qr{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:0;height:100%;padding:12px 14px;border-radius:24px;background:var(--card);border:1.5px solid var(--edge);text-align:center}
.fp-qr b{font-size:26px;line-height:1.3}
.fp-qr small{font-size:20px;line-height:1.4;color:var(--ink-2)}
.fp-legal{flex:1;min-height:0;display:grid;grid-template-columns:280px 1fr;gap:12px}
.fp-toc{display:flex;flex-direction:column;gap:8px;min-height:0;padding:12px;border-radius:24px;background:var(--well)}
.fp-toc button{min-height:72px;padding:10px 12px;border-radius:16px;text-align:left;font-size:22px;line-height:1.35;color:var(--ink-2);background:transparent}
.fp-toc button[aria-pressed="true"]{background:var(--deep);color:var(--cream);font-weight:700}
.fp-ltext{min-height:0;overflow:hidden;padding:18px 20px;border-radius:24px;background:var(--card);border:1.5px solid var(--edge);display:flex;flex-direction:column;justify-content:center;gap:10px}
.fp-ltext h3{margin:0;font:700 32px/1.35 var(--serif)}
.fp-ltext p{margin:0;font-size:24px;line-height:1.55;color:var(--ink)}
.fp-comp{align-items:center}
.fp-comp .fp-draft{flex:1;margin:0;font-size:24px;line-height:1.4;color:var(--ink);text-align:left}
.fp-dock2 .btn,.fp-dock3 .btn{flex:1;min-width:0}
.screen[data-id="session-resume"] .btn.pri,
.screen[data-id="login"] .btn.pri,
.screen[data-id="cleared"] .btn.pri,
.screen[data-id="offline"] .btn.pri,
.screen[data-id="route-error"] .btn.pri,
.screen[data-id="official"] .btn.pri,
.screen[data-id="xq"] .btn.pri{min-width:0}
.fp-phone.phonepage{padding:28px 40px 0}
.fp-phone .pcap h1{font-size:44px}
.fp-phone .pframe{transform:scale(1.42);transform-origin:top center;margin-top:12px}
.fp-phone .pscreen{font-size:16px}
.fp-phone .ptop{height:52px}
.fp-phone .ptop b{font-size:16px}
.fp-phone .ptop .pc{font-size:15px}
.fp-phone .pfile .ft{font-size:15px;width:44px;height:52px}
.fp-phone .pbody{gap:10px;padding:14px}
.fp-phone .fp-pfill{display:flex;flex-direction:column;gap:8px}
.fp-phone .fp-prow{background:var(--card);border:1px solid var(--edge);border-radius:14px;padding:8px 10px}
.fp-phone .fp-prow b{display:block;font-size:15px;line-height:1.3}
.fp-phone .fp-prow span{display:block;font-size:15px;line-height:1.35;color:var(--ink-2)}
.fp-phone .pcard b,.fp-phone .pfile b{font-size:16px}
.fp-phone .pcard small,.fp-phone .pnote,.fp-phone .pfoot,.fp-phone .plab,.fp-phone .pfile small,.fp-phone .pchk{font-size:15px;line-height:1.4}
.fp-phone .ppick{height:56px;font-size:16px}
.fp-phone .pbtn{height:56px;font-size:16px}
.fp-phone .pinput{min-height:52px;height:auto;font-size:16px}
.fp-phone .pchk{min-height:48px}
.fp-rec{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge)}
.fp-rec b{font-size:26px;line-height:1.35}
.fp-rec small{font-size:20px;line-height:1.4;color:var(--ink-2)}
.fp-chips{display:flex;flex-wrap:wrap;gap:8px}
.fp-chips i{font-style:normal;min-height:48px;padding:8px 14px;border-radius:999px;background:var(--card);border:1px solid var(--edge);font-size:20px;font-weight:700;color:var(--ink-2)}
.fp-standby-chips{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}
.fp-standby-chips i{font-style:normal;min-height:56px;padding:8px 16px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(46,230,168,.28);font-size:22px;color:var(--cream)}
.fp-slide-tag{font-size:20px;color:var(--mint)}
.fp-split.fp-fill>.fp-hit.fp-theme{align-items:center}
.fp-stat b{font-size:40px;line-height:1.15}
.fp-quote{margin:0;font:700 44px/1.35 var(--serif);color:var(--ink)}
.fp-now{border-color:var(--teal);box-shadow:inset 0 0 0 2px var(--teal)}
.fp-list.fp-fill>.fp-rec.fp-chan{flex-direction:row;align-items:center;justify-content:flex-start;gap:22px;overflow:hidden}
.fp-chan .fp-qrart{flex:none;width:240px;height:240px;min-height:0}
.fp-chan .fp-side{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;justify-content:center}
.fp-chan .fp-hit{min-height:72px}
.fp-theme-card{flex-direction:column;align-items:stretch;justify-content:space-between;gap:12px;text-align:left}
.fp-theme-card .fp-top{display:flex;gap:14px;align-items:flex-start}
.fp-theme-card .fp-art{display:flex;justify-content:flex-end;min-height:120px}
.fp-reply{display:flex;flex-direction:column;justify-content:flex-start;gap:16px}
.fp-reply .fp-side{display:flex;gap:18px;align-items:flex-start}
.fp-reply .fp-side>div:first-child{flex:1;min-width:0}
.fp-split.fp-fill>.fp-card.fp-tall{justify-content:space-between;align-items:stretch}
.fp-tall .fp-art{display:flex;justify-content:flex-end;margin-top:12px}
.fp-phone.phonepage{padding:12px 28px 0}
.fp-phone .pframe{transform:scale(1.78);transform-origin:top center;margin-top:4px}
.fp-grow{background:transparent;border-radius:0;padding:0}
.fp-rest{flex:none;justify-content:flex-start}
.fp-hero{min-height:0}
.fp-stack>.fp-card,.fp-stack>.fp-hit,.fp-stack>.fp-well,.fp-stack>.fp-rec{flex:none;min-height:0;justify-content:flex-start}
.fp-split.fp-fill{flex:none;grid-auto-rows:auto}
.fp-split.fp-fill>.fp-card,.fp-split.fp-fill>.fp-hit{height:auto;justify-content:flex-start}
.fp-list.fp-fill{flex:none}
.fp-list.fp-fill>.fp-hit,.fp-list.fp-fill>.fp-card,.fp-list.fp-fill>.fp-rec{flex:none;min-height:0}
.fp-list.fp-fill>.fp-card,.fp-list.fp-fill>.fp-rec{justify-content:flex-start}
.fp-statgrid{flex:none;grid-template-rows:none}
.fp-qr{height:auto}
.fp-ltext{justify-content:flex-start;overflow:hidden}
.fp-toc{background:transparent;padding:0}
.fp-legal{flex:1;min-height:0;align-items:stretch}
.fp-ltext{flex:1}
.fp-skel{height:22px;border-radius:11px;background:var(--paper-2)}
.fp-kicker{display:flex;align-items:center;gap:12px;margin:0}
.fp-span{flex:1;min-height:0}
.fp-pair{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:stretch}
.fp-quad{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:12px}
.fp-pair>.fp-card,.fp-pair>.fp-sink,.fp-quad>.fp-card{min-height:0;height:auto;display:flex;flex-direction:column;overflow:hidden}
.fp-sink{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;overflow:hidden}
.fp-artbox{flex:1;min-height:0;overflow:hidden;display:flex;align-items:center;justify-content:center}
.fp-artbox svg{height:92%;width:auto;max-width:100%}
.fp-facts{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:12px}
.fp-facts>.fp-card{min-height:0;display:flex;flex-direction:column;overflow:hidden;gap:6px}
.fp-strow{display:grid;grid-template-columns:64px minmax(0,1fr) auto;gap:12px;align-items:center;min-height:78px;padding:8px 14px;border-radius:18px;background:var(--card);border:1.5px solid var(--edge)}
.fp-strow b{display:block;font-size:24px;line-height:1.3}
.fp-strow small{display:block;font-size:20px;line-height:1.35;color:var(--ink-2)}
.fp-chans{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px}
.fp-chans .fp-chan{flex:1;min-height:0}
.fp-chans .fp-qrart{flex:none;width:auto;height:100%;min-height:0;overflow:hidden}
.fp-chans .fp-qrart svg{height:86%;width:auto;max-width:100%}
.fp-gh{flex:none;margin:2px 0 0;font:700 28px/1.25 var(--sans);color:var(--ink)}
.fp-cats>.fp-hit{min-height:128px}
.fp-split.fp-fill>.fp-hit.fp-theme-card{min-height:470px;height:auto;align-items:stretch;justify-content:space-between}
.fp-aidown .fp-exits .slab.row{min-height:210px;padding:14px 16px}
.fp-exits{display:flex;flex-direction:column;gap:10px}
.fp-exits .slab.row{min-height:236px}
.fp-exits .slab.row .vis{min-height:150px}
.fp-aidown .howto{min-height:88px}
.screen[data-id="xq"] .fp-aidown .fp-exits .slab.row{min-height:220px}
.fp-qlist{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px}
.fp-qlist>.fp-card{flex:1;min-height:0}
.fp-qlist b{display:block;font-size:28px;line-height:1.3}
.fp-grow>.fp-card.fp-reply{flex:1;min-height:0}
.fp-reply .fp-artbox{min-height:120px}
.fp-chans .fp-chan{flex-direction:row;align-items:center;overflow:hidden;gap:14px}
.fp-chans.fp-crowded,.fp-chans.fp-crowded .fp-chan{flex:none}
.fp-ltext .fp-artbox{min-height:160px}
.screen[data-id="help"] .fp-cats>.fp-hit{min-height:112px}
.fp-chans.fp-crowded .fp-chan{padding:8px 12px}
.fp-chans.fp-crowded .fp-qrart{width:136px;height:136px;max-height:136px}
.fp-chans.fp-crowded .fp-qrart svg{width:136px;height:136px;max-height:136px}
.fp-chans.fp-crowded .fp-hit{min-height:64px;padding:6px 10px}
.fp-chans.fp-crowded .fp-hit small{display:none}
.fp-chans.fp-crowded .fp-side{gap:2px}
.fp-chans.fp-crowded,.fp-chans.fp-crowded .fp-chan{flex:1}
`;
  document.head.appendChild(css);

  const S = () => window.S;
  const ic = (n, s) => UI.icon(n, s || 28, 2);
  const PHONE = '需要帮助？拨打服务电话 183-6916-1921';
  const FAULT = '这台机器暂时打不了，我们已经收到提醒，会尽快处理。你可以稍后再来；需要帮助请拨打服务电话 183-6916-1921。';
  const PHONE_NOTE = '号码与服务时间从后台读，读不到不显示';

  function set(patch) {
    Object.assign(window.S, patch);
    window.__proto.refresh();
  }
  function frame(o) {
    const band = o.band ? UI.band(Object.assign({ kind: 'compact', sealHtml: '', back: o.back }, o.band)) : '';
    const body = o.body == null ? '' : `<main class="body fp-fill">${o.body}</main>`;
    const foot = o.dock === false ? '' : (o.dockHtml || UI.dock(o.dock || {}));
    const nav = o.nav === false ? '' : UI.nav(o.nav === undefined ? 'home' : o.nav);
    return band + body + foot + nav + (o.extra || '');
  }
  function listen(el, fn) {
    const onClick = (e) => {
      const b = e.target.closest('[data-fp]');
      if (!b || !el.contains(b)) return;
      e.stopPropagation();
      fn(b.dataset.fp, b.dataset.k || '', b);
    };
    const onDemo = (e) => fn('demo:' + e.detail, '', null);
    el.addEventListener('click', onClick);
    el.addEventListener('proto-demo', onDemo);
    return () => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('proto-demo', onDemo);
    };
  }
  function sheet(title, inner) {
    return `<div class="scrim" data-fp="shut"></div><div class="sheet" role="dialog"><div class="grab"></div><h2>${title}</h2>${inner}<button class="btn sec" data-fp="shut">收起</button></div>`;
  }
  function bandOf(eyebrow, title, sub, status, warn) {
    return { eyebrow, title, sub, status: { text: status, warn: !!warn } };
  }
  function sink(note, art) {
    return `<div class="fp-card fp-sink">${note ? `<p class="fp-note">${note}</p>` : ''}<div class="fp-artbox">${art}</div></div>`;
  }
  function remind(text) {
    return `<div class="remind">${ic('call', 34)}<span>${text}</span></div>`;
  }

  const ADS = [
    ['改简历', '带上你的简历，当场看改法', '上传或扫描之后，改不改由你决定。', () => UI.resume(220, 'annot')],
    ['练面试', '3 分钟、5 分钟或 8 分钟', '练完看反馈，不做录用判断。', () => UI.report(220)],
    ['打印扫描', '手机或 U 盘里的文件', '先选材料，再在本机出纸。', () => UI.stack(200, 3)]
  ];

  function standbyMode() {
    if (S().fpNoAds) return 'empty';
    if (S().fpStandby === 'load') return 'load';
    return 'ads';
  }
  function standby() {
    const mode = standbyMode();
    const slides = mode === 'ads' ? ADS.map((s, i) => `<div class="slide ${i ? '' : 'on'}"><div class="k">${s[0]}</div><h2>${s[1]}</h2><p>${s[2]}</p><span class="chip ghost">示例</span><div class="art">${s[3]()}</div></div>`).join('') : '';
    const dots = mode === 'ads' ? `<div class="sb-dots">${ADS.map((_, i) => `<i class="fp-dot ${i ? '' : 'on'}"></i>`).join('')}</div>` : '';
    const mid = mode === 'empty'
      ? `<div class="slides"><div class="slide on"><div class="k">宣传位</div><h2>暂无宣传内容</h2><p>现在没有可展示的宣传。不影响打印、简历和信息查询。</p></div></div>`
      : mode === 'load'
        ? `<div class="slides"><div class="slide on"><div class="k">宣传位</div><h2>正在读取宣传内容</h2><p>素材还没就绪。轻触屏幕仍可进入首页。</p></div></div>`
        : `<div class="slides" id="fpSlides">${slides}</div>${dots}`;
    return `<div class="standby" data-go="home" role="button" aria-label="轻触屏幕，开始办事">
      <div class="halo"></div>
      <div style="display:flex;justify-content:space-between;align-items:center"><div class="brand"><div class="mark">职</div><div><b>职易达</b><small>就业服务大厅</small></div></div><span class="status"><i class="dot"></i>轻触即可开始</span></div>
      <div class="sb-time"><b data-fp-time>14:30</b><small data-fp-date></small></div>
      ${mid}
      <div class="fp-standby-chips"><span class="fp-slide-tag" style="width:100%">进门后可办</span><i>改简历</i><i>练面试</i><i>打印扫描</i><i>查政策</i></div>
      <div class="touch-cta"><span class="ring">${ic('hand', 40)}</span><span><b>轻触屏幕，开始办事</b><small>AI 帮你改简历、练面试；还能打印、扫描材料</small></span></div>
      <div class="sb-foot"><span>本机不代收简历 · 不替你投递 · AI 内容会标明 · 闲置后自动退出</span></div>
    </div>`;
  }
  function mountStandby(el) {
    const sl = [...el.querySelectorAll('.slide')];
    const dots = [...el.querySelectorAll('.fp-dot')];
    let k = 0;
    const spin = sl.length > 1 ? setInterval(() => {
      sl[k].classList.remove('on');
      if (dots[k]) dots[k].classList.remove('on');
      k = (k + 1) % sl.length;
      sl[k].classList.add('on');
      if (dots[k]) dots[k].classList.add('on');
    }, 6000) : 0;
    const paint = () => {
      const d = new Date();
      const wk = '日一二三四五六'[d.getDay()];
      const t = el.querySelector('[data-fp-time]');
      const day = el.querySelector('[data-fp-date]');
      if (t) t.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      if (day) day.textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 星期${wk}`;
    };
    paint();
    const clock = setInterval(paint, 10000);
    const off = listen(el, (fp) => {
      if (fp === 'demo:noads') set({ fpNoAds: true, fpStandby: '' });
      else if (fp === 'demo:loading') set({ fpNoAds: false, fpStandby: 'load' });
      else if (fp === 'demo:ads') set({ fpNoAds: false, fpStandby: '' });
    });
    return () => { if (spin) clearInterval(spin); clearInterval(clock); off(); };
  }

  const TASKS = {
    resume: {
      label: '简历与求职材料', desc: '项目经历、简历格式与求职材料准备', icon: 'file',
      welcome: '请告诉我你的目标岗位、目前的简历进度，以及最想解决的材料问题。',
      questions: ['项目经历应该怎么写？', '简历打印用 PDF 还是 Word？', '没有实习经历怎么办？'],
      acts: [['AI 简历服务', 'resume'], ['简历诊断', 'resume-src'], ['打印文件', 'print-src'], ['自我探索', 'sa-intro']],
      go: 'resume', answer: '先写你实际做过的事、你的角色和结果。具体数字以你自己的材料为准。'
    },
    interview: {
      label: '面试与沟通', desc: '面试准备、自我介绍与谈薪沟通', icon: 'message',
      welcome: '请补充目标岗位、当前面试阶段，以及最想准备的问题。',
      questions: ['自我介绍应该怎么准备？', '面试常见问题怎么回答？', '谈薪时应该注意什么？'],
      acts: [['AI 模拟面试', 'iv-1']],
      go: 'interview', answer: '自我介绍先说你是谁、学什么，再挑一段和这件事相关的经历。要不要去练，由你决定。'
    },
    jobs: {
      label: '岗位与选择', desc: '岗位理解、Offer 对比与求职方向', icon: 'layers',
      welcome: '请补充岗位名称、你关注的条件，或需要比较的 Offer 信息。',
      questions: ['这个岗位是否适合我？', '两个 Offer 应该怎样比较？', '阅读 JD 时应该关注哪些重点？'],
      acts: [],
      go: '', answer: '本终端未开放岗位与招聘会信息。你可以把要求记下来，回到简历或政策里自己核对。'
    },
    workplace: {
      label: '入职与职场', desc: '入职材料、试用期与社保公积金常识', icon: 'landmark',
      welcome: '请补充所在地区、想了解的事项和当前阶段；具体规定请以当地官方信息为准。',
      questions: ['入职通常需要准备哪些材料？', '试用期有哪些常见注意事项？', '社保公积金应该怎样了解？'],
      acts: [['政策服务', 'policy'], ['政策与材料说明', 'policy-list']],
      go: 'policy', answer: '入职材料和社保以当地官方说明为准。这里可以去政策服务，看本机构发布的内容。'
    }
  };
  const MANUAL = [
    ['print', 'printer', '打印扫描', '上传文件、打印或扫描材料', '文档打印：PDF / 图片上传后打印；手机扫码上传不用登录；材料扫描在打印机面板上完成。'],
    ['help', 'help', '帮助中心', '查常见问题与操作方法', '按要办的事找：登录、简历、打印、政策。常见问题点开就有做法。卡住了先看三步自助，再拨服务电话。'],
    ['policy', 'landmark', '政策服务', '查政策与办事材料说明', '就业、创业与灵活就业政策；社保参保流程与材料说明；档案、登记和证明材料。'],
    ['resume', 'file', 'AI简历服务', '已有简历可继续上传、打印', '简历打印：选择文件、核价后在本机打印。我的简历要登录后才能看已保存的版本。']
  ];

  function xqCopy() {
    const aiDown = S().ai === 'down';
    const phase = aiDown ? 'down' : (S().fpXqPhase || '');
    const scene = S().fpXqScene === 'career_explore';
    const task = TASKS[S().fpXqTask] || null;
    const draft = S().fpXqDraft || '';
    if (aiDown) return { title: 'AI 顾问暂不可用。', lede: '四个入口不经过 AI，照常能办。', pill: 'AI 暂不可用', warn: 1 };
    if (scene && !task && !phase) return { title: 'AI 求职方向探索', lede: '这里是求职方向探索助手。结果仅供个人参考。', pill: '小青在线', warn: 0 };
    if (phase === 'submitting') return { title: '已发出，等小青回答。', lede: '你的问题已发出，请稍候。', pill: '等待本轮返回', warn: 0 };
    if (phase === 'reply') return { title: '小青的回答到了。', lede: '看看建议，再选下一步要办的事。', pill: '真实模型已应答', warn: 0 };
    if (phase === 'notai') return { title: '这一轮不是 AI 生成。', lede: '请先选择办事入口，或稍后重新提问。', pill: '非 AI 回复 · 正文不展示', warn: 1 };
    if (phase === 'error') return { title: '这一轮没连上。', lede: '可以重试，也可以直接走下面四个入口。', pill: '本轮失败 · 可重试', warn: 1 };
    if (draft && !phase) return { title: '这条问题还没有发出。', lede: '可以接着改，也可以换一条再发。', pill: '尚未发送', warn: 0 };
    if (task) return { title: task.label, lede: task.welcome, pill: '小青在线', warn: 0 };
    return { title: '你想解决什么？', lede: '选一件事，或直接点常见问题；不打字也能用。', pill: '小青在线', warn: 0 };
  }
  function manualCards() {
    return `<div class="fp-list">${MANUAL.map((m) => `<button class="fp-hit" data-go="${m[0]}"><span class="fp-ic">${ic(m[1], 32)}</span><span><b>${m[2]}</b><small>${m[3]}</small></span></button>`).join('')}</div>`;
  }
  function manualExits() {
    const arts = [UI.stack(130, 3), UI.checklist(120), UI.checklist(120), UI.resume(120)];
    return `<div class="fp-exits">${MANUAL.map((m, i) => UI.slab({ i, row: 1, go: m[0], title: m[2], desc: m[3], vis: arts[i] })).join('')}</div>`;
  }
  function xq() {
    const c = xqCopy();
    const aiDown = S().ai === 'down';
    const phase = aiDown ? 'down' : (S().fpXqPhase || '');
    const task = TASKS[S().fpXqTask] || null;
    const scene = S().fpXqScene === 'career_explore';
    const q = S().fpXqQ || (phase === 'reply' || phase === 'notai' || phase === 'error' || phase === 'submitting' ? '项目经历应该怎么写？' : '');
    const draft = S().fpXqDraft || '';
    let body = '';
    let extra = '';
    const again = S().fpXqRecheck === 'checking';
    if (aiDown) {
      const still = S().fpXqRecheck === 'still' ? '这次检查仍不可用。' : '';
      body = `<div class="fp-grow fp-aidown"><div class="howto">${ic('alert', 34)}<span>小青这会儿没有接上。下面这些事不用问也能办。${still}</span></div><div class="sec-t">这些都不需要 AI · 现在就能做</div>${manualExits()}${remind(PHONE)}</div>`;
    } else if (!task && !phase && !scene) {
      const arts = { resume: UI.resume(160, 'annot'), interview: UI.report(150), jobs: UI.checklist(150), workplace: UI.stack(140, 3) };
      body = `<div class="fp-grow"><button class="fp-hit" data-go="iv-1"><span class="fp-ic">${ic('mic', 32)}</span><span><b>最近办理</b><small>模拟面试 · HR 面试 5 分钟</small></span><span class="chip">示例</span><span class="fp-go">${ic('chevR', 26)}</span></button><div class="fp-split fp-fill">${Object.keys(TASKS).map((id) => {
        const t = TASKS[id];
        return `<button class="fp-hit fp-theme fp-theme-card" data-fp="task" data-k="${id}"><span class="fp-top"><span class="fp-ic">${ic(t.icon, 32)}</span><span><b>${t.label}</b><small>${t.desc}</small><small>例如：${t.questions[0]}</small></span></span><span class="fp-art">${arts[id] || ''}</span></button>`;
      }).join('')}</div><div class="fp-row"><button class="fp-hit" data-fp="manual"><span><b>不经过 AI，直接去办</b><small>打印扫描、帮助、政策、简历</small></span></button><button class="fp-hit" data-go="feedback"><span><b>投诉 AI 内容</b><small>对回答有异议走这里</small></span></button></div></div>`;
      if (S().fpXqMore) extra = sheet('不经过 AI，直接去办', manualCards());
    } else if (scene && !task && !phase) {
      body = `<div class="fp-grow"><div class="howto">${ic('sparkle', 34)}<span>这里是求职方向探索助手。结果仅供个人参考，不构成职业规划建议。本终端未开放岗位与招聘会信息，这一页没有「去办理」。</span></div><div class="fp-pair"><div class="fp-card fp-sink"><p class="fp-k">可以说</p><p class="fp-note">专业背景、感兴趣的领域，或当前的困惑。</p><div class="fp-artbox">${UI.checklist(180)}</div></div><div class="fp-card fp-sink"><p class="fp-k">不会给出</p><p class="fp-note">不安排岗位、招聘会或企业入口。方向只供你自己参考。</p><div class="fp-artbox">${UI.report(160)}</div></div></div><div class="fp-row"><button class="fp-hit" data-fp="ask" data-k="我还不确定适合做什么"><span><b>我还不确定适合做什么</b><small>点了就发给小青</small></span></button><button class="fp-hit" data-fp="manual"><span><b>不经过 AI，直接去办</b></span></button><button class="fp-hit" data-go="feedback"><span><b>投诉 AI 内容</b></span></button></div></div>`;
      if (S().fpXqMore) extra = sheet('不经过 AI，直接去办', manualCards());
    } else if (task && !phase) {
      const qArt = [UI.resume(140, 'annot'), UI.report(130), UI.checklist(130)];
      body = `<div class="fp-grow"><div class="howto">${ic('message', 34)}<span>${task.welcome}${task.acts.length ? '' : ' 本终端未开放岗位与招聘会信息。问题仍可以问。'}</span></div><div class="fp-qlist">${task.questions.map((qq, i) => `<button class="fp-card fp-sink" data-fp="ask" data-k="${qq}"><span><b>${qq}</b><small class="fp-note">点了就发给小青</small></span><div class="fp-artbox">${qArt[i] || UI.checklist(120)}</div></button>`).join('')}</div><div class="fp-row"><button class="fp-hit" data-fp="acts"><span><b>这一主题还能去哪</b><small>${task.acts.length ? '打印、政策等入口' : '这一主题没有直达按钮'}</small></span></button><button class="fp-hit" data-fp="tasks"><span><b>换一个主题</b></span></button><button class="fp-hit" data-go="feedback"><span><b>投诉 AI 内容</b></span></button></div></div>`;
      if (S().fpXqActs) {
        const inner = task.acts.length
          ? `<div class="fp-list">${task.acts.map((a) => `<button class="fp-hit" data-go="${a[1]}"><span><b>${a[0]}</b><small>去${a[0]}</small></span></button>`).join('')}</div>`
          : '<p class="fp-note">本终端未开放岗位与招聘会信息。不放查看岗位、查看招聘会、找企业。</p>';
        extra = sheet('这一主题还能去哪', inner);
      }
    } else if (phase === 'submitting') {
      body = `<div class="fp-grow"><div class="fp-card"><p class="fp-k">你刚发出</p><p class="fp-note">${q}</p></div><div class="fp-pair"><div class="fp-card fp-sink"><p class="fp-k">请稍候</p><p class="fp-note">你的问题已发出。回答出现之前，这一页不写结论。</p><div class="fp-artbox">${UI.resume(180, 'annot')}</div></div><div class="fp-card fp-sink"><p class="fp-k">不由 AI 决定</p><p class="fp-note">身份、付款、打印、政策资格和录用结果都不由这一轮回答决定。</p><div class="fp-artbox">${UI.checklist(160)}</div></div></div></div>`;
    } else if (phase === 'reply') {
      const saved = !!S().fpXqSaved;
      const go = scene ? '' : (task && task.go);
      const ans = scene ? '方向只供你自己参考，不构成职业规划建议。' : (task ? task.answer : TASKS.resume.answer);
      const src = task || TASKS.resume;
      const bounds = ['身份', '付款', '打印是否出纸', '政策资格', '录用结果'];
      const more = src.questions.filter((x) => x !== q);
      body = `<div class="fp-grow"><div class="fp-card fp-reply"><div class="fp-side"><div><span class="ai" style="font-size:22px;color:var(--teal-ink);font-weight:700">AI 生成，仅供参考</span><p class="fp-quote">${ans}</p><p class="fp-k">你的问题</p><p class="fp-note" style="font-size:28px;color:var(--ink)">${q}</p></div><div>${scene ? UI.checklist(180) : UI.resume(200, 'annot')}</div></div><div><p class="fp-k">这一轮不替你决定</p><ul class="fp-ol">${bounds.map((t) => `<li>${t}</li>`).join('')}</ul><p class="fp-note">这一轮只保留这一问一答。${src.welcome}</p></div><div><p class="fp-k">这一主题还可以问</p><ul class="fp-ol">${more.map((t) => `<li>${t}</li>`).join('')}</ul></div>${go ? `<button class="action" data-go="${go}"><span class="ic">${ic('arrowR', 28)}</span><span><b>去办理</b><small>这一步的入口，办不办由你定</small></span></button>` : '<p class="fp-note">本终端未开放岗位与招聘会信息。这一页没有「去办理」。</p>'}<div class="fp-artbox">${scene ? UI.checklist(160) : UI.report(160)}</div></div><div class="fp-row"><button class="fp-hit" data-fp="save" ${saved ? 'disabled' : ''}><span><b>${saved ? '已记在这次登录里' : '保存这次回答的要点'}</b><small>${S().logged ? '记在这次登录的记录里' : '没登录会先去登录'}</small></span></button><button class="fp-hit" data-fp="again"><span><b>再问一句</b></span></button><button class="fp-hit" data-go="feedback"><span><b>投诉 AI 内容</b></span></button></div></div>`;
    } else if (phase === 'notai') {
      body = `<div class="fp-grow"><div class="howto">${ic('alert', 34)}<span>这次没有取得模型写出的回答，已为你保留问题：${q}</span></div>${manualExits()}<button class="fp-hit" data-fp="again"><span><b>重新提问</b></span></button></div>`;
    } else if (phase === 'error') {
      body = `<div class="fp-grow"><div class="howto">${ic('alert', 34)}<span>可以重试，也可以直接走下面四个入口。保留的问题：${q}</span></div>${manualExits()}<div class="fp-row"><button class="fp-hit" data-fp="retry"><span><b>重试这一轮</b></span></button><button class="fp-hit" data-go="feedback"><span><b>投诉 AI 内容</b></span></button></div></div>`;
    }
    const showCompose = !aiDown && phase !== 'notai' && phase !== 'error';
    const canSend = !!draft && phase !== 'submitting';
    const dockHtml = aiDown
      ? `<footer class="dock fp-dock3"><button class="btn sec" data-act="back">${ic('chevL', 28)}返回</button><button class="btn sec" data-go="feedback">投诉 AI 内容</button><button class="btn pri" data-fp="recheck" ${again ? 'disabled' : ''}>${again ? '正在重新检查' : '重新检查'}</button></footer>`
      : (showCompose ? `<footer class="composer fp-comp"><button class="btn sec" data-act="type">${ic('keyboard', 28)}打字</button><p class="fp-draft">${draft || '还没写问题。点「打字」用屏上键盘，或点上面的一句。'}</p><button class="btn pri" data-fp="send" ${canSend ? '' : 'disabled'}>发送${ic('arrowR', 26)}</button></footer>` : `<footer class="dock"><button class="btn sec" data-act="back">${ic('chevL', 28)}返回</button></footer>`);
    return frame({
      band: bandOf('问小青', c.title, c.lede, c.pill, c.warn),
      body, dockHtml, nav: 'xq', extra
    });
  }
  function mountXq(el) {
    return listen(el, (fp, k) => {
      if (fp === 'task') set({ fpXqTask: k, fpXqPhase: '', fpXqQ: '', fpXqActs: false, fpXqMore: false });
      else if (fp === 'tasks') set({ fpXqTask: '', fpXqPhase: '', fpXqQ: '', fpXqActs: false });
      else if (fp === 'manual') set({ fpXqMore: !S().fpXqMore, fpXqActs: false });
      else if (fp === 'acts') set({ fpXqActs: !S().fpXqActs, fpXqMore: false });
      else if (fp === 'shut') set({ fpXqMore: false, fpXqActs: false });
      else if (fp === 'ask') set({ fpXqQ: k, fpXqDraft: '', fpXqPhase: 'submitting', fpXqSaved: false, fpXqMore: false, fpXqActs: false });
      else if (fp === 'send') {
        if (!S().fpXqDraft || S().ai === 'down') return;
        set({ fpXqQ: S().fpXqDraft, fpXqDraft: '', fpXqPhase: 'submitting', fpXqSaved: false });
      } else if (fp === 'again') set({ fpXqPhase: '', fpXqQ: '', fpXqSaved: false, fpXqTask: S().fpXqScene === 'career_explore' ? '' : (S().fpXqTask || '') });
      else if (fp === 'retry') set({ fpXqPhase: 'submitting', fpXqSaved: false });
      else if (fp === 'save') {
        if (!S().logged) { S().fpFrom = 'xq'; window.go('login'); return; }
        set({ fpXqSaved: true });
      } else if (fp === 'recheck') set({ fpXqRecheck: 'checking' });
      else if (fp === 'demo:typed') {
        if (S().ai === 'down') return;
        set({ fpXqDraft: S().fpXqTask && TASKS[S().fpXqTask] ? TASKS[S().fpXqTask].questions[0] : '项目经历应该怎么写？' });
      } else if (fp === 'demo:done') {
        if (S().ai === 'down') { set({ fpXqRecheck: 'still' }); return; }
        const q = S().fpXqQ || S().fpXqDraft || '项目经历应该怎么写？';
        set({ fpXqQ: q, fpXqDraft: '', fpXqPhase: 'reply', fpXqSaved: false, fpXqTask: S().fpXqScene === 'career_explore' ? '' : (S().fpXqTask || 'resume') });
      } else if (fp === 'demo:fail') {
        if (S().ai === 'down') return;
        set({ fpXqPhase: 'error', fpXqQ: S().fpXqQ || S().fpXqDraft || '项目经历应该怎么写？' });
      } else if (fp === 'demo:notai') {
        if (S().ai === 'down') return;
        set({ fpXqPhase: 'notai', fpXqQ: S().fpXqQ || S().fpXqDraft || '项目经历应该怎么写？' });
      } else if (fp === 'demo:still') set({ fpXqRecheck: 'still' });
    });
  }

  const HELP = [
    { id: 'account', label: '登录与账号', summary: '要不要登录、为什么变回游客、怎么换账号', qs: [
      ['一定要登录才能使用吗？', '不需要。大部分服务可以游客身份直接使用。登录后，这次的简历、文档、打印订单和收藏会记到你的账号，只有你能看。'],
      ['为什么离开或刷新后又变回游客了？', '这是公用设备。登录只留在这一次。刷新、离开或闲置超时会退出，并清掉这次留下的内容。'],
      ['怎么切换成另一个账号？', '在「我的 → 账号设置」里退出，再用另一个手机号登录。这里不做多角色切换。']
    ], links: [['to-login', '去登录'], ['settings', '账号设置']] },
    { id: 'resume', label: 'AI简历服务', summary: '能做什么、会不会保证面试或录用', qs: [
      ['AI 简历服务能做什么？', '可以做诊断、优化建议和生成参考，只供你自己改简历时看。输出可能有偏差，用之前请核对。'],
      ['AI 会保证我面试或录用成功吗？', '不会。这里不承诺面试、录用或通过率，也不进入企业后续招聘流程。']
    ], links: [['resume-src', '开始使用']] },
    { id: 'print', label: '打印与扫描', summary: '怎么打印、扫描件保存在哪', qs: [
      ['怎么打印文件？', '在文档打印里上传文件，核对参数和现场公示的价目后再确认。确认并开始输出之后，纸张就消耗了。'],
      ['扫描的文件保存在哪里？', '扫描结果只用于这次打印，或留在这次的记录里。敏感文件短期有效，到期就删。']
    ], links: [['print-src', '文档打印'], ['scan-type', '扫描文件']] },
    { id: 'policy', label: '政策服务', summary: '能不能代申请补贴', qs: [
      ['政策服务能帮我申请补贴吗？', '只提供说明、材料清单、官方入口和打印。不代申请，不承诺发放或审核，也不保存身份证、银行卡、社保材料。结果以官方平台为准。']
    ], links: [['policy-list', '政策服务']] },
    { id: 'channels', label: '机构官方渠道', summary: '本机构的官方渠道在哪看、内容谁负责', qs: [
      ['这台机器上能看岗位或报名吗？', '不能。本机不存岗位和招聘会信息，也不代收简历。要看本机构发布的内容，去扫官方渠道里的码。'],
      ['官方渠道的内容谁负责？', '码由运营这台机器的机构自己维护，以机构官网或公众号为准。']
    ], links: [['official', '本机构官方渠道']] },
    { id: 'records', label: '我的记录', summary: '文档和订单在哪里看', qs: [
      ['在哪里查看我的文档和订单？', '登录后在「我的」里看你的文档、打印订单、收藏和浏览记录。记录只有你能看。']
    ], links: [['my-docs', '我的文档']] },
    { id: 'privacy', label: '隐私与留存', summary: '会不会推送给企业、文件存多久', qs: [
      ['我上传的简历会被推送给企业吗？', '不会。简历只用于你这次发起的 AI 分析，不进简历库，也不推送给企业或第三方招聘方。'],
      ['文件会保存多久？', '高敏或匿名文件短期保存。登录后的原始简历和求职材料默认 90 天，可在我的文档里延长。AI 成果要你确认后才长期留，也可以随时删。详见隐私政策。']
    ], links: [['to-legal', '隐私政策']] }
  ];
  const STEPS = [
    ['照屏幕上的提示走', '出错时先看当前页的提示和按钮，按提示重试或返回。设备故障不要自己拆，也不要拉扯纸张。'],
    ['退回上一步重做', '用「返回」回到上一步重选。打印要等你核对参数并确认之后才输出，确认前返回不会出纸。'],
    ['换一种来源', '一种上传方式不成，就回打印扫描换本机已经开通的其他来源。哪些能用，以那一页显示的为准。']
  ];
  function helpLinks(list) {
    return `<div class="fp-row">${list.map((l) => {
      const go = l[0] === 'to-login' || l[0] === 'to-legal' ? `data-fp="${l[0]}"` : `data-go="${l[0]}"`;
      return `<button class="fp-hit" ${go}><span><b>${l[1]}</b><small>打开</small></span></button>`;
    }).join('')}</div>`;
  }
  function help() {
    const view = S().fpHelp || '';
    const topic = HELP.find((h) => h.id === view);
    let title = '你想解决什么？';
    let sub = '先点一个分类，不用打字。';
    let pill = '常见问题';
    let warn = 0;
    let body = '';
    let dock = { ask: '问小青：这里没看懂', backLabel: '返回' };
    if (view === 'down') {
      title = '帮助内容没显示出来';
      sub = '帮助内容装在这台机器上。这一页没有显示完整。';
      pill = '帮助内容没显示出来';
      warn = 1;
      const n = S().fpHelpN || 0;
      body = `<div class="fp-grow"><div class="howto">${ic('help', 34)}<span>${n ? `已重新打开 ${n} 次，内容仍没回来。` : '可以再打开一次。'}正在办的打印不会因此取消。</span></div><div class="fp-list"><div class="fp-rec"><b>重新打开帮助</b><small>再加载一次这一页</small></div><div class="fp-rec"><b>回首页再进来</b><small>正在办的打印和取件码都还在</small></div><div class="fp-rec"><b>拨服务电话</b><small>${PHONE}</small></div></div>${sink('帮助页打不开，不会取消正在办的打印。', UI.checklist(180))}<button class="btn pri" data-fp="reopen" style="min-width:0">重新打开帮助</button></div>`;
      dock = { ask: '问小青：帮助页打不开', backLabel: '返回首页' };
    } else if (view === 'miss') {
      title = '没有这个分类';
      sub = '请回到帮助首页，再选一个分类。';
      pill = '不在帮助分类里';
      warn = 1;
      body = `<div class="fp-grow"><div class="howto">${ic('alert', 34)}<span>没有这个分类。回到帮助首页再选，正在办的事不受影响。</span></div>${sink('可以从帮助首页按要办的事继续找。', UI.checklist(200))}<button class="fp-hit" data-fp="cats"><span><b>回到帮助首页</b></span></button>${remind(PHONE)}</div>`;
      dock = { ask: '问小青：分类里没有我的问题', backLabel: '返回首页' };
    } else if (topic) {
      title = topic.label;
      sub = `${topic.summary}。下面 ${topic.qs.length} 条是这一类里常被问到的。`;
      pill = `当前分类 · ${topic.label}`;
      body = `<div class="fp-grow"><div class="fp-list">${topic.qs.map((qa) => `<div class="fp-card"><p class="fp-k">问</p><p class="fp-note"><b>${qa[0]}</b></p><p class="fp-note">${qa[1]}</p></div>`).join('')}</div><p class="fp-k">直接去办</p>${helpLinks(topic.links)}${sink('这里没答上，可以换一个分类，或问小青。', UI.checklist(160))}</div>`;
      dock = { ask: false, back: false };
    } else {
      body = `<div class="fp-grow"><div class="fp-list fp-cats">${HELP.filter((h) => h.id !== 'privacy').map((h) => `<button class="fp-hit" data-fp="topic" data-k="${h.id}"><span class="fp-ic">${ic('help', 28)}</span><span><b>${h.label}</b><small>${h.summary} · ${h.qs.length} 问</small></span></button>`).join('')}</div><button class="fp-hit" data-fp="more"><span><b>隐私、设备与备案</b><small>隐私与留存、看设备状态、备案号</small></span></button><div class="fp-well"><p class="fp-k">卡住了，先自己试这三步</p><ol class="fp-ol">${STEPS.map((s) => `<li><b>${s[0]}。</b>${s[1]}</li>`).join('')}</ol><p class="fp-note">${PHONE}</p><p class="fp-note">鲁ICP备2026023517号-2 · 鲁公网安备37021402007308号 · 职易达AI</p></div></div>`;
    }
    let extra = '';
    if (!topic && view !== 'down' && view !== 'miss' && S().fpHelpMore) {
      extra = sheet('隐私、设备与备案', `<button class="fp-hit" data-fp="topic" data-k="privacy"><span><b>隐私与留存</b><small>${HELP[6].summary}</small></span></button><button class="fp-hit" data-go="offline"><span><b>看设备状态</b><small>联网和各项读没读到</small></span></button><p class="fp-note">鲁ICP备2026023517号-2 · 鲁公网安备37021402007308号 · 职易达AI</p>`);
    }
    const dockHtml = topic ? `<footer class="dock"><button class="btn sec" data-fp="cats">${ic('chevL', 28)}返回分类</button><button class="askq" data-go="xq"><span class="mic">${ic('mic', 28)}</span><span>问小青：这里没看懂</span></button><button class="btn sec" data-go="home">返回首页</button></footer>` : '';
    return frame({
      band: bandOf('帮助', title, sub, pill, warn),
      body, extra,
      dock: dockHtml ? undefined : dock,
      dockHtml: dockHtml || undefined,
      nav: 'home'
    });
  }
  function mountHelp(el) {
    return listen(el, (fp, k) => {
      if (fp === 'topic') set({ fpHelp: k, fpHelpMore: false });
      else if (fp === 'more') set({ fpHelpMore: !S().fpHelpMore });
      else if (fp === 'shut' || fp === 'cats') set({ fpHelp: '', fpHelpMore: false, fpHelpN: 0 });
      else if (fp === 'reopen') set({ fpHelp: 'down', fpHelpN: (S().fpHelpN || 0) + 1 });
      else if (fp === 'to-login') { S().fpFrom = 'help'; window.go('login'); }
      else if (fp === 'to-legal') { S().fpDoc = 'privacy'; S().fpLegal = 'ready'; S().fpChap = 0; window.go('legal'); } 
      else if (fp === 'demo:down') set({ fpHelp: 'down', fpHelpMore: false });
      else if (fp === 'demo:miss') set({ fpHelp: 'miss', fpHelpMore: false });
      else if (fp === 'demo:ok') set({ fpHelp: '', fpHelpMore: false, fpHelpN: 0 });
    });
  }

  const CHANNELS = [
    { id: 'wx', name: '机构公众号', desc: '通知与办事指南，以该公众号为准', who: 'general' },
    { id: 'web', name: '机构官网', desc: '表格与说明原文，以该官网为准', who: 'general' },
    { id: 'grad', name: '毕业生服务号', desc: '毕业生办事说明，以该页面为准', who: 'graduate' },
    { id: 'soc', name: '求职者服务号', desc: '社会求职者办事说明，以该页面为准', who: 'social' }
  ];
  const WHO = [['面向高校毕业生', 'graduate'], ['面向社会求职者', 'social'], ['通用', 'general']];
  function official() {
    const st = S().fpOff || 'items';
    const hideWeb = !!S().fpHideWeb;
    const pool = CHANNELS.filter((c) => !(hideWeb && c.id === 'web') && (S().fpGroup || c.who === 'general'));
    const groups = WHO.map(([label, who]) => [label, pool.filter((c) => c.who === who)]).filter((g) => g[1].length);
    const grouped = !!S().fpGroup && !(groups.length === 1 && groups[0][0] === '通用');
    let title = '扫码，在手机上看';
    let sub = '扫下面的码，在自己的手机上打开机构的页面。';
    let pill = `${pool.length} 个官方渠道`;
    let warn = 0;
    let body = '';
    let dock = { ask: '问小青：这个码怎么用' };
    const pair = (a, b) => `<div class="fp-pair">${[a, b].map((o) => `<button class="fp-card fp-sink" ${o.fp ? `data-fp="${o.fp}"` : `data-go="${o.go}"`}><p class="fp-k">${o.t}</p><p class="fp-note">${o.d}</p><div class="fp-artbox">${o.art}</div></button>`).join('')}</div>`;
    if (st === 'load') {
      title = '正在读取本终端的官方渠道';
      sub = '读取完成前这里不下结论。';
      pill = '正在读取本机构渠道';
      body = `<div class="fp-grow"><div class="fp-rec"><p class="fp-k">正在读取</p><div class="fp-skel"></div><div class="fp-skel" style="width:68%"></div></div><div class="fp-rec"><p class="fp-k">正在读取</p><div class="fp-skel"></div><div class="fp-skel" style="width:52%"></div></div>${sink('读完之前，这里不显示二维码。', UI.checklist(220))}</div>`;
      dock = { ask: false, backLabel: '返回' };
    } else if (st === 'empty') {
      title = '本终端暂未配置官方渠道';
      sub = '没有可扫的码。可以问小青，或先看帮助。';
      pill = '暂未配置官方渠道';
      warn = 1;
      body = `<div class="fp-grow"><div class="howto">${ic('qr', 34)}<span>本终端还没有可扫的码。</span></div>${pair(
        { go: 'xq', t: '问小青', d: '渠道还没有码，仍可以问别的事', art: UI.checklist(180) },
        { go: 'help', t: '帮助', d: '常见问题和这一页的用法', art: UI.report(160) }
      )}${remind(PHONE)}</div>`;
      dock = { ask: false, pri: { label: '回首页', go: 'home' } };
    } else if (st === 'error') {
      title = '官方渠道这次没有读取成功';
      sub = '渠道这次没读到。可以重新读取，或先看帮助。';
      pill = '渠道读取失败';
      warn = 1;
      body = `<div class="fp-grow"><div class="howto">${ic('alert', 34)}<span>这次没有读到官方渠道。请重新读取。</span></div>${pair(
        { fp: 'reload', t: '重新读取', d: '先进入读取中，读完再显示', art: UI.checklist(180) },
        { go: 'help', t: '帮助', d: '渠道没读到时，仍可以查常见问题', art: UI.report(160) }
      )}${remind(PHONE)}</div>`;
      dock = { ask: false, pri: { label: '回首页', go: 'home' } };
    } else {
      const busy = S().fpCheck === 'busy';
      const fail = S().fpCheck === 'fail';
      const seed = { wx: 11, web: 12, grad: 13, soc: 14 };
      const chan = (c) => `<div class="fp-rec fp-chan"><div class="fp-qrart">${UI.qr(seed[c.id] || 11, 220)}</div><div class="fp-side"><b>${c.name}</b><small>${c.desc}</small><span class="chip">示例</span><button class="fp-hit" data-fp="check" data-k="${c.id}" ${busy ? 'disabled' : ''}><span><b>核对还能不能扫</b><small>点一下，看这个码现在还能不能打开</small></span></button></div></div>`;
      const chans = grouped ? groups.map(([label, xs]) => `<h3 class="fp-gh">${label}</h3>${xs.map(chan).join('')}`).join('') : pool.map(chan).join('');
      const note = S().fpWithdraw ? `<div class="howto">${ic('alert', 34)}<span>${S().fpWithdraw}</span></div>` : (fail ? '<div class="howto"><span>这次没有确认这些渠道还在，请再点一次。</span></div>' : (busy ? '<div class="howto"><span>正在确认这条渠道还在不在。</span></div>' : ''));
      body = `<div class="fp-grow">${note}<div class="fp-chans${grouped ? ' fp-crowded' : ''}">${chans}</div><div class="fp-well"><ol class="fp-ol"><li>用手机对准二维码。</li><li>在你自己的手机上打开，不用在这台机器上登录。</li><li>页面内容以该机构页面为准。</li></ol></div></div>`;
      dock = { ask: false, backLabel: '返回' };
    }
    const dockHtml = st === 'items' ? `<footer class="dock"><button class="btn sec" data-act="back">${ic('chevL', 28)}返回</button><button class="askq" data-go="xq"><span class="mic">${ic('mic', 28)}</span><span>问小青：这个码怎么用</span></button><button class="btn pri" data-fp="explore">AI 求职方向探索${ic('arrowR', 26)}</button></footer>` : '';
    return frame({
      band: bandOf('本机构官方渠道', title, sub, pill, warn),
      body,
      dock: dockHtml ? undefined : dock,
      dockHtml: dockHtml || undefined,
      nav: 'home'
    });
  }
  function mountOfficial(el) {
    return listen(el, (fp, k) => {
      if (fp === 'check') set({ fpCheck: 'busy', fpCheckId: k });
      else if (fp === 'reload') set({ fpOff: 'load', fpCheck: '', fpWithdraw: '' });
      else if (fp === 'explore') { S().fpXqScene = 'career_explore'; S().fpXqTask = ''; S().fpXqPhase = ''; S().fpXqQ = ''; window.go('xq'); }
      else if (fp === 'demo:load') set({ fpOff: 'load', fpCheck: '' });
      else if (fp === 'demo:empty') set({ fpOff: 'empty', fpCheck: '', fpHideWeb: false, fpWithdraw: '' });
      else if (fp === 'demo:error') set({ fpOff: 'error', fpCheck: '' });
      else if (fp === 'demo:items') set({ fpOff: 'items', fpCheck: '', fpHideWeb: false, fpWithdraw: '' });
      else if (fp === 'demo:recheck') set({ fpOff: 'items', fpCheck: 'fail' });
      else if (fp === 'demo:recheck-ok') set({ fpOff: 'items', fpCheck: '' });
      else if (fp === 'demo:group') set({ fpOff: 'items', fpGroup: !S().fpGroup });
      else if (fp === 'demo:withdraw') set({ fpOff: 'items', fpHideWeb: true, fpWithdraw: '「机构官网」已经撤下，不再提供二维码。', fpCheck: '' });
    });
  }

  function loginMode() { return S().fpLogin || 'phone'; }
  function login() {
    const mode = loginMode();
    const agree = !!S().fpAgree;
    const msg = S().fpMsg || '';
    let title = '用手机号登录';
    let sub = '勾选协议后可获取验证码并登录。';
    let pill = '等待填写手机号';
    let warn = 0;
    let main = '';
    if (mode === 'sms') {
      title = '短信验证码暂时发不出来';
      sub = '改用扫码登录。也可以不登录，继续使用公开服务。';
      pill = '暂时不能发';
      warn = 1;
      main = `<div class="howto">${ic('alert', 34)}<span>短信这条路先停下。验证码没有发出。不登录仍可以办下面这些事。</span></div><div class="fp-list"><button class="fp-hit" data-fp="mode" data-k="scan"><span><b>改用扫码登录</b><small>用手机确认这一次，票据 180 秒</small></span></button><button class="fp-hit" data-go="print"><span><b>打印与扫描</b><small>不登录也能办</small></span></button><button class="fp-hit" data-go="pickup"><span><b>到机码</b><small>手机上已经下过的单</small></span></button><button class="fp-hit" data-go="policy"><span><b>政策</b><small>不登录也能查</small></span></button><button class="fp-hit" data-go="help"><span><b>去帮助</b><small>发送失败时来这里看</small></span></button></div>${sink('验证码没有发出。可以改用扫码，也可以先办不用登录的事。', UI.phone(160))}${remind(PHONE)}`;
    } else if (mode === 'expired') {
      title = '二维码已过期';
      sub = '需要重新获取验证码。旧码不能接着用。';
      pill = '码已过期';
      warn = 1;
      main = `<div class="fp-card"><p class="fp-k">二维码已过期</p><p class="fp-note">票据 180 秒，从发出来时算。过期之后需要重新获取。</p><p class="fp-note">${msg || '点下面重新获取。新的码出现后再使用。'}</p></div><div class="fp-row"><button class="fp-hit" data-fp="renew"><span><b>重新获取</b><small>新码出现后再计 180 秒</small></span></button><button class="fp-hit" data-fp="mode" data-k="phone"><span><b>改回手机号</b><small>用短信验证码登录</small></span></button></div>${sink('旧码不能接着用。', UI.qr(6, 280))}`;
    } else if (mode === 'scan') {
      title = '用手机扫码登录';
      sub = '用手机扫码并确认，再回到这台机器继续办理。';
      pill = '票据 180 秒';
      main = `<div class="fp-block fp-span"><div class="fp-card fp-sink"><div class="fp-artbox">${UI.qr(5, 420)}</div><b>示例码，不能扫</b><small>剩余 180 秒（打开时读取）。到点不会自动登录，需要时再换一个码。</small></div><div class="fp-row"><button class="fp-hit" data-go="phone-login"><span><b>看手机上的确认页</b><small>在你自己的手机上打开</small></span></button><button class="fp-hit" data-fp="mode" data-k="phone"><span><b>改用手机号</b></span></button><button class="fp-hit" data-fp="renew"><span><b>换一个码</b></span></button></div>${msg ? `<p class="fp-note">${msg}</p>` : ''}</div>`;
    } else if (mode === 'code' || mode === 'verify' || mode === 'sending') {
      title = mode === 'verify' ? '正在核验验证码' : mode === 'sending' ? '验证码发送中' : '填写短信验证码';
      sub = mode === 'verify' ? '核验结果等系统返回，这一页不自己判成功。' : '手机号以你刚填的为准，获取验证码后改为脱敏显示。';
      pill = mode === 'sending' ? '发送中' : '60 秒后重发';
      const codeTxt = S().fpCodeOn ? '验证码已填，待核验' : '点这里填短信验证码';
      main = `<div class="fp-block"><div class="fp-well"><p class="fp-note">${S().fpPhoneOn ? '11 位已填，屏上改为脱敏。' : '手机号以你刚填的为准。'}重发要等 60 秒，按钮先停着。票据另计 180 秒。</p></div><button class="fp-hit" data-act="type"><span><b>${codeTxt}</b><small>屏上键盘是系统界面</small></span></button>${msg ? `<p class="fp-note">${msg}</p>` : ''}<div class="fp-row"><button class="fp-hit" disabled><span><b>60 秒后重发</b></span></button><button class="fp-hit" data-fp="verify" ${S().fpCodeOn && mode !== 'verify' ? '' : 'disabled'}><span><b>${mode === 'verify' ? '正在核验' : '提交核验'}</b></span></button></div></div>`;
    } else {
      const phoneTxt = S().fpPhoneOn ? '11 位已填' : '点这里填 11 位手机号';
      main = `<div class="fp-block"><button class="fp-hit" data-act="type"><span class="fp-ic">${ic('phone', 30)}</span><span><b>${phoneTxt}</b><small>用屏上键盘填写，不预填号码</small></span></button><button class="fp-hit" data-fp="agree" aria-pressed="${agree ? 'true' : 'false'}"><span><b>${agree ? '已勾选协议' : '请先勾选协议'}</b><small>我已阅读并同意用户服务协议和隐私政策</small></span></button><div class="fp-row"><button class="fp-hit" data-fp="terms"><span><b>用户服务协议</b></span></button><button class="fp-hit" data-fp="privacy"><span><b>隐私政策</b></span></button></div>${msg ? `<p class="fp-note">${msg}</p>` : ''}<div class="fp-row"><button class="fp-hit" data-fp="get" ${agree ? '' : 'disabled'}><span><b>${agree ? '获取验证码' : '勾选协议后才能获取'}</b></span></button><button class="fp-hit" data-fp="mode" data-k="scan"><span><b>改用扫码登录</b></span></button></div><button class="fp-hit" data-fp="anon"><span><b>不登录也能办</b><small>打印与扫描、到机码、政策</small></span></button>${S().fpAnon ? '<div class="fp-list"><button class="fp-hit" data-go="print"><span><b>打印与扫描</b></span></button><button class="fp-hit" data-go="pickup"><span><b>到机码</b></span></button><button class="fp-hit" data-go="policy"><span><b>政策</b></span></button></div>' : ''}</div>`;
    }
    const showFacts = (mode === 'phone' && !S().fpAnon) || mode === 'code' || mode === 'verify' || mode === 'sending';
    const facts = showFacts
      ? `<div class="fp-facts"><div class="fp-card"><p class="fp-k">简历</p><p class="fp-note">改好的简历，登录之后才记到账号。没登录时，这次改的先留在这台机器上。</p><div class="fp-artbox">${UI.resume(120)}</div></div><div class="fp-card"><p class="fp-k">打印订单</p><p class="fp-note">登录后才能对上你名下的订单。到机码不登录也能取手机上已经下过的单。</p><div class="fp-artbox">${UI.stack(110, 3)}</div></div><div class="fp-card"><p class="fp-k">AI 记录</p><p class="fp-note">诊断和面试反馈记在这次登录里。要保存回答要点，没登录会先到这一页。</p><div class="fp-artbox">${UI.report(110)}</div></div><div class="fp-card"><p class="fp-k">只管这一次</p><p class="fp-note">离开会退出。重发 60 秒，扫码票据 180 秒。</p><div class="fp-artbox">${UI.phone(90)}</div></div></div>`
      : (mode === 'phone' && S().fpAnon ? sink('打印、到机码和政策不需要登录。', UI.stack(180, 3)) : '');
    return frame({
      band: bandOf('登录', title, sub, pill, warn),
      body: `<div class="fp-grow">${main}${facts}</div>`,
      dock: { ask: '问小青：不登录能办什么', backLabel: '返回' },
      nav: 'home'
    });
  }
  function mountLogin(el) {
    return listen(el, (fp, k) => {
      if (fp === 'agree') set({ fpAgree: !S().fpAgree, fpMsg: '' });
      else if (fp === 'terms') { S().fpDoc = 'terms'; S().fpLegal = 'ready'; S().fpChap = 0; window.go('legal'); }
      else if (fp === 'privacy') { S().fpDoc = 'privacy'; S().fpLegal = 'ready'; S().fpChap = 0; window.go('legal'); }
      else if (fp === 'mode') set({ fpLogin: k, fpMsg: '' });
      else if (fp === 'anon') set({ fpAnon: !S().fpAnon });
      else if (fp === 'get') {
        if (!S().fpAgree) { set({ fpMsg: '请先勾选用户服务协议和隐私政策' }); return; }
        set({ fpLogin: 'sending', fpMsg: '正在请求验证码。发出与否等系统返回。' });
      } else if (fp === 'verify') {
        if (!S().fpCodeOn) { set({ fpMsg: '先填写短信验证码' }); return; }
        set({ fpLogin: 'verify', fpMsg: '正在核验。成功与否等系统返回。' });
      } else if (fp === 'renew') set({ fpLogin: 'scan', fpMsg: '已请求新码。剩余 180 秒从新码出现时重算。' });
      else if (fp === 'demo:typed') {
        if ((S().fpLogin || 'phone') === 'code' || S().fpLogin === 'verify') set({ fpCodeOn: true, fpMsg: '' });
        else set({ fpPhoneOn: true, fpMsg: '' });
      } else if (fp === 'demo:sent') {
        if (S().fpLogin === 'sms') return;
        set({ fpLogin: 'code', fpMsg: '' });
      } else if (fp === 'demo:coded') set({ fpLogin: 'code', fpCodeOn: true });
      else if (fp === 'demo:code-ok' || fp === 'demo:scan-ok') finishLogin();
      else if (fp === 'demo:scan') set({ fpLogin: 'scan', fpMsg: '' });
      else if (fp === 'demo:expired') set({ fpLogin: 'expired', fpMsg: '' });
      else if (fp === 'demo:sms') set({ fpLogin: 'sms', fpMsg: '' });
    });
  }
  function finishLogin() {
    const from = S().fpFrom;
    S().logged = true;
    S().fpFrom = '';
    S().fpLogin = '';
    S().fpMsg = '';
    const tg = document.getElementById('tg-login');
    if (tg) tg.setAttribute('aria-pressed', 'true');
    const back = window.afterLogin ? window.afterLogin() : 'me';
    window.go(from && from !== 'login' ? from : back);
  }

  function cleared() {
    const logged = !!S().logged;
    const who = (window.D && window.D.me) || { name: '李佳怡', phone: '138****6721' };
    const from = S().fpFrom;
    const backLine = from && from !== 'cleared' ? '继续后回到刚才那一页。' : '继续后回到首页。';
    const clears = logged
      ? ['登录状态：退出账号，下次需重新验证', `${who.name} · ${who.phone}`, '账号中已保存的数据不受本次终端清场影响', '本次上传的文件缓存与预览', 'AI 顾问对话与没提交的填写内容', '浏览与选择留下的临时上下文']
      : ['匿名使用：清掉这次留下的内容', '这次临时使用。匿名任务退出后无法恢复。', '本次上传的文件缓存与预览', 'AI 顾问对话与没提交的填写内容', '浏览与选择留下的临时上下文'];
    return frame({
      back: false,
      band: bandOf('使用时限', '还在用吗？', '30 秒后自动结束这次使用', '即将结束这次使用', 1),
      body: `<div class="fp-grow"><div class="fp-split"><div class="fp-card"><p class="fp-big"><span id="fpCd">30</span></p><p class="fp-note">秒后自动结束这次使用</p></div><div class="fp-card"><p class="fp-note">这是公用设备的隐私保护。时间一到，本机上这趟留下的东西会被清掉；已经交给系统的任务和账号数据不受影响。</p><p class="fp-note">${backLine}</p><p class="fp-note">现在结束使用，会结束并清除这台机器上的这次使用记录。</p></div></div><div class="fp-pair"><div class="fp-card fp-sink"><p class="fp-k">本机会清除</p><ul class="fp-ol">${clears.map((t) => `<li>${t}</li>`).join('')}</ul><div class="fp-artbox">${UI.stack(150, 3)}</div></div><div class="fp-card fp-sink"><p class="fp-k">不因此清除</p><ul class="fp-ol"><li>已创建的打印 / 扫描任务继续运行</li><li>账号里的文档、订单、AI 记录按保存期限管理</li><li>已下过单的到机码照常能用</li></ul><div class="fp-artbox">${UI.checklist(140)}</div></div></div><div class="fp-list"><div class="fp-rec"><b>我只是在看屏幕上的字</b><small>点「我还在，继续使用」就行。刚才填到一半的内容不会因此丢掉。</small></div><div class="fp-rec"><b>我的打印订单会不会没了</b><small>不会。订单在系统里。带到机码回来，或登录后到「我的 · 打印订单」查。</small></div><div class="fp-rec"><b>纸还在机器上</b><small>屏幕能清干净，纸不会自己收走。离开前请把原件和打印件一起带走。</small></div></div>${remind(PHONE)}</div>`,
      dockHtml: `<footer class="dock fp-dock2"><button class="btn sec" data-fp="stay">我还在，继续使用</button><button class="btn pri" data-fp="end">现在结束使用</button></footer>`,
      nav: false
    });
  }
  function mountCleared(el) {
    const n = el.querySelector('#fpCd');
    const shot = new URLSearchParams(location.search).get('shot') === '1';
    const endAt = Date.now() + 30000;
    if (shot && n) n.textContent = '30';
    const timer = shot ? 0 : setInterval(() => {
      const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      if (n) n.textContent = String(left);
      if (left <= 0) { clearInterval(timer); window.doClear(); }
    }, 1000);
    const off = listen(el, (fp) => {
      if (fp === 'stay') {
        const from = S().fpFrom;
        S().fpFrom = '';
        window.go(from && from !== 'cleared' ? from : 'home');
      } else if (fp === 'end') window.doClear();
    });
    return () => { clearInterval(timer); off(); };
  }

  const JOBS = [
    { t: '毕业生就业推荐表（已填写）.pdf', m: '等待领取 · 2 页 · 186 KB · 单号 P20261027-1842', go: 'printing', b: '去打印进度', why: '' },
    { t: '成绩单扫描件.pdf', m: '支付正在处理，本页不判定成功或失败 · 4 页 · 1.2 MB', go: 'cashier', b: '去收银台付款', why: '' },
    { t: '求职材料清单.pdf', m: '任务已结束 · 1 页 · 64 KB · 单号 P20261023-0911', go: '', b: '继续（暂不可用）', why: '任务已结束' }
  ];
  function resumeScreen() {
    if (!S().logged) {
      return frame({
        band: bandOf('继续打印任务', '未登录会先去登录', '这一页只列你名下没办完的打印任务。', '先登录再读列表', 0),
        body: `<div class="fp-grow"><div class="fp-card"><p class="fp-k">先登录，再看你的任务</p><p class="fp-note">还没登录。登录之后才能看到你名下没办完的打印。</p></div><p class="fp-k">登录后在这一页能</p><div class="fp-list"><div class="fp-rec"><b>看没办完的打印</b><small>只列还没办完的，已经完成的不在这里</small></div><div class="fp-rec"><b>接着付款或取件</b><small>回到这一单原来那一步</small></div><div class="fp-rec"><b>不能继续的会写原因</b><small>按钮会停住，并写明原因</small></div></div><p class="fp-k">不登录也能办</p><div class="fp-pair"><button class="fp-card fp-sink" data-go="print"><p class="fp-k">打印与扫描</p><p class="fp-note">上传文件或扫描原件，不用登录也能开始</p><div class="fp-artbox">${UI.stack(140, 3)}</div></button><button class="fp-card fp-sink" data-go="pickup"><p class="fp-k">到机码</p><p class="fp-note">手机上已经下过的单，凭码继续</p><div class="fp-artbox">${UI.phone(120)}</div></button></div></div>`,
        dockHtml: `<footer class="dock"><button class="btn sec" data-act="back">${ic('chevL', 28)}返回</button><button class="btn pri" data-fp="to-login">去登录</button></footer>`,
        nav: 'me'
      });
    }
    const st = S().fpResume || 'list';
    if (st === 'load') {
      return frame({
        band: bandOf('继续打印任务', '正在读取', '先确认登录还在不在，再取你名下没办完的打印任务。', '正在读取', 0),
        body: `<div class="fp-grow">${[70, 54, 62].map((w) => `<div class="fp-rec"><p class="fp-k">正在读取</p><div class="fp-skel"></div><div class="fp-skel" style="width:${w}%"></div></div>`).join('')}${sink('正在读取你名下没办完的打印。', UI.mfp())}</div>`,
        dockHtml: resumeDock(true),
        nav: 'me'
      });
    }
    if (st === 'empty') {
      return frame({
        band: bandOf('继续打印任务', '名下没有未完成任务', '只列你名下没办完的打印任务。', '名下没有未完成任务', 0),
        body: `<div class="fp-grow"><div class="howto">${ic('file', 34)}<span>没有没办完的打印。已经完成的不在这里。</span></div><div class="fp-quad">${[
          ['print', '直接办新的', '上传文件、扫描原件，或用手机传过来', UI.stack(120, 3)],
          ['pickup', '手机上已经下过单', '到机码还在有效期内，可以继续那一单', UI.phone(100)],
          ['my-activity', '查以前办过的', '打印订单和服务记录在我的记录里', UI.checklist(110)],
          ['help', '刚下过单却看不到', '先确认是不是另一个手机号建的单', UI.report(110)]
        ].map((x) => `<button class="fp-card fp-sink" data-go="${x[0]}"><p class="fp-k">${x[1]}</p><p class="fp-note">${x[2]}</p><div class="fp-artbox">${x[3]}</div></button>`).join('')}</div></div>`,
        dockHtml: `<footer class="dock"><button class="btn sec" data-go="home">${ic('chevL', 28)}返回首页</button><button class="btn pri" data-go="print">去打印扫描${ic('arrowR', 26)}</button></footer>`,
        nav: 'me'
      });
    }
    if (st === 'down') {
      return frame({
        band: bandOf('继续打印任务', '没读到未完成任务', '读不出列表不等于任务没了。', '没读到未完成任务', 1),
        body: `<div class="fp-grow"><div class="howto">${ic('alert', 34)}<span>没读到未完成任务。读不出列表不等于任务没了。</span></div><div class="fp-pair"><button class="fp-card fp-sink" data-go="print"><p class="fp-k">去打印扫描</p><p class="fp-note">可以先办新的，稍后再回来看</p><div class="fp-artbox">${UI.stack(140, 3)}</div></button><button class="fp-card fp-sink" data-fp="reload"><p class="fp-k">重新读取</p><p class="fp-note">再取一次你名下没办完的打印</p><div class="fp-artbox">${UI.mfp()}</div></button></div>${remind(PHONE)}</div>`,
        dockHtml: resumeDock(false),
        nav: 'me'
      });
    }
    return frame({
      band: bandOf('继续打印任务', `共 ${JOBS.length} 条`, '只列你名下没办完的打印任务。条数从待办里来。继续回到这一单原来那一步，不重新建单。', `共 ${JOBS.length} 条`, 0),
      body: `<div class="fp-grow"><p class="fp-k fp-kicker">共 ${JOBS.length} 条 <span class="chip">示例</span></p><div class="fp-list">${JOBS.map((j) => `<div class="fp-rec"><b>${j.t}</b><small>${j.m}</small>${j.go ? `<button class="fp-hit" data-go="${j.go}"><span><b>${j.b}</b></span></button>` : `<button class="fp-hit" disabled><span><b>${j.b}</b><small>${j.why}</small></span></button>`}</div>`).join('')}</div>${sink('继续回到这一单原来那一步。已经完成的不在这里。', UI.mfp())}</div>`,
      dockHtml: resumeDock(false),
      nav: 'me'
    });
  }
  function resumeDock(loading) {
    return `<footer class="dock fp-dock3"><button class="btn sec" data-go="home">${ic('chevL', 28)}返回首页</button><button class="btn sec" data-go="print">去打印扫描</button><button class="btn pri" data-fp="reload" ${loading ? 'disabled' : ''}>重新读取</button></footer>`;
  }
  function mountResume(el) {
    return listen(el, (fp) => {
      if (fp === 'to-login') { S().fpFrom = 'session-resume'; window.go('login'); }
      else if (fp === 'reload') set({ fpResume: 'load' });
      else if (fp === 'demo:load') set({ fpResume: 'load' });
      else if (fp === 'demo:empty') set({ fpResume: 'empty' });
      else if (fp === 'demo:down') set({ fpResume: 'down' });
      else if (fp === 'demo:list') set({ fpResume: 'list' });
    });
  }

  function netRows(mode) {
    const u = ['未检测', '还没有检测', 'fp-dim'];
    const miss = ['暂时读不到', '这次没有读到', 'fp-mid'];
    const map = {
      unknown: [
        ['联网', '未检测', '还没有向服务器探过', 'fp-dim'],
        ['本机程序', '未检测', '还没有检测结果', 'fp-dim'],
        ['打印机', '未检测', '还没有检测结果', 'fp-dim'],
        ['扫描件的存放', '未检测', '办理时才知道落在哪', 'fp-dim'],
        ['U 盘读取', '暂未开通', '这项本来就没开', 'fp-dim'],
        ['付款', '随请求确认', '办理到那一步再确认', 'fp-dim'],
        ['AI 服务', '随请求确认', '办理到那一步再确认', 'fp-dim'],
        ['机构官方渠道', '随请求确认', '办理到那一步再确认', 'fp-dim']
      ],
      checking: [
        ['联网', '检测中', '正在问服务器', 'fp-mid'],
        ['本机程序', '检测中', '正在问本机', 'fp-mid'],
        ['打印机', '检测中', '还没有结果', 'fp-mid'],
        ['扫描件的存放', ...u],
        ['U 盘读取', '暂未开通', '这项本来就没开', 'fp-dim'],
        ['付款', '随请求确认', '办理到那一步再确认', 'fp-dim'],
        ['AI 服务', '随请求确认', '办理到那一步再确认', 'fp-dim'],
        ['机构官方渠道', '随请求确认', '办理到那一步再确认', 'fp-dim']
      ],
      partial: [
        ['联网', '这次连得上', '只说明这条路通了', 'fp-ok'],
        ['本机程序', '这次连得上', '只说明程序有回应', 'fp-ok'],
        ['打印机', ...miss],
        ['扫描件的存放', ...u],
        ['U 盘读取', '暂未开通', '这项本来就没开', 'fp-dim'],
        ['付款', '随请求确认', '办理到那一步再确认', 'fp-dim'],
        ['AI 服务', '随请求确认', '办理到那一步再确认', 'fp-dim'],
        ['机构官方渠道', '随请求确认', '办理到那一步再确认', 'fp-dim']
      ],
      offline: [
        ['联网', '这次连不上', '和服务器之间不通', 'fp-bad'],
        ['本机程序', ...miss],
        ['打印机', ...miss],
        ['扫描件的存放', ...u],
        ['U 盘读取', '暂未开通', '这项本来就没开', 'fp-dim'],
        ['付款', ...miss],
        ['AI 服务', ...miss],
        ['机构官方渠道', ...miss]
      ]
    };
    return map[mode] || map.unknown;
  }
  function offline() {
    const mode = S().fpNet || 'unknown';
    const copy = {
      unknown: ['这台机器还没检测', '还没向服务器和打印机问过。', '还没检测', 0],
      checking: ['正在检测', '检测还没返回，请稍候。', '正在检测', 0],
      partial: ['连得上，但有几项取不到', '取不到的标成暂时读不到。', '部分取不到', 1],
      offline: ['和服务器连不上', '这次连不上。其余没问到的项标成暂时读不到。', '连不上服务器', 1]
    }[mode];
    const rows = netRows(mode);
    const foot = mode === 'offline' ? FAULT : PHONE;
    const icons = { '联网': 'wifi', '本机程序': 'refresh', '打印机': 'printer', '扫描件的存放': 'folder', 'U 盘读取': 'usb', '付款': 'ticket', 'AI 服务': 'sparkle', '机构官方渠道': 'qr' };
    const chip = { 'fp-bad': 'cin', 'fp-mid': 'clay', 'fp-ok': '', 'fp-dim': 'slate' };
    return frame({
      back: false,
      band: bandOf('机器状态', copy[0], copy[1], copy[2], copy[3]),
      body: `<div class="fp-grow"><div class="fp-list">${rows.map((r) => `<div class="fp-strow"><span class="fp-ic">${ic(icons[r[0]] || 'alert', 28)}</span><span><b>${r[0]}</b><small>${r[2]}</small></span><span class="chip ${chip[r[3]] || ''}">${r[1]}</span></div>`).join('')}</div>${sink('', UI.mfp())}${remind(foot)}</div>`,
      dockHtml: `<footer class="dock fp-dock3"><button class="btn sec" data-go="home">返回首页</button><button class="btn sec" data-go="help">帮助与求助</button><button class="btn pri" data-fp="check" ${mode === 'checking' ? 'disabled' : ''}>重新检测</button></footer>`,
      nav: false
    });
  }
  function mountOffline(el) {
    return listen(el, (fp) => {
      if (fp === 'check') set({ fpNet: 'checking' });
      else if (fp === 'demo:unknown') set({ fpNet: 'unknown' });
      else if (fp === 'demo:checking') set({ fpNet: 'checking' });
      else if (fp === 'demo:partial') set({ fpNet: 'partial' });
      else if (fp === 'demo:offline') set({ fpNet: 'offline' });
    });
  }

  function routeError() {
    const fail = S().fpRoute === 'fail';
    const n = S().fpRouteN || 0;
    const title = fail ? '这一页打不开' : '页面不存在';
    const sub = fail ? '本次操作没有完成。你可以重新打开，或返回首页选择其他服务。' : '当前入口可能已经调整，请返回首页重新选择服务。';
    return frame({
      back: false,
      band: bandOf('页面恢复指引', title, sub, '页面恢复指引', 1),
      body: `<div class="fp-grow"><div class="howto">${ic('alert', 34)}<span>${fail ? '这次没有完成。' : '这个入口现在没有对应的页面。'}${n ? `已重新打开 ${n} 次。` : ''}</span></div><div class="fp-pair"><button class="fp-card fp-sink" data-fp="reload"><p class="fp-k">重新打开</p><p class="fp-note">再载入这一页</p><div class="fp-artbox">${UI.checklist(200)}</div></button><button class="fp-card fp-sink" data-go="home"><p class="fp-k">回首页</p><p class="fp-note">改简历、练面试、打印扫描、查政策</p><div class="fp-artbox">${UI.stack(160, 3)}</div></button></div>${remind(PHONE)}</div>`,
      dockHtml: `<footer class="dock fp-dock2"><button class="btn sec" data-fp="reload">重新打开</button><button class="btn pri" data-go="home">回首页</button></footer>`,
      nav: false
    });
  }
  function mountRoute(el) {
    return listen(el, (fp) => {
      if (fp === 'reload') set({ fpRouteN: (S().fpRouteN || 0) + 1 });
      else if (fp === 'demo:fail') set({ fpRoute: 'fail' });
      else if (fp === 'demo:missing') set({ fpRoute: 'missing', fpRouteN: 0 });
    });
  }

  const DOCS = {
    terms: { name: '用户服务协议', chapters: [
      ['服务说明', '这台机器提供简历、面试练习、打印扫描和政策查询。岗位投递和招聘会预约不在本机完成。'],
      ['账号与本次使用', '登录只留在这一次。闲置之后会退出，并清掉这次留在机器上的内容。账号里已经保存的，按隐私政策留。'],
      ['AI 生成内容的性质', 'AI 写出的文字会标明仅供参考。身份、付款、打印、政策资格和录用结果都不由 AI 决定。']
    ] },
    privacy: { name: '隐私政策', chapters: [
      ['我们处理哪些信息', '你主动交来的文件、你填的手机号，以及这次办理留下的记录。不在这里采集没用到的身份材料。'],
      ['文件留多久', '匿名和高敏文件短期留存。登录后的简历材料有保存期限，到期删除，你也可以提前删。'],
      ['你可以把授权撤回', 'AI 使用授权可以撤回。撤回之后，新的 AI 功能不再用这份授权，已经交给打印机的任务继续。']
    ] }
  };
  function legal() {
    const docId = S().fpDoc === 'privacy' ? 'privacy' : 'terms';
    const doc = DOCS[docId];
    const st = S().fpLegal || 'ready';
    const chap = Math.min(S().fpChap || 0, doc.chapters.length - 1);
    const other = docId === 'terms' ? 'privacy' : 'terms';
    if (st === 'missing') {
      return frame({
        band: bandOf('协议与政策', '没有这份文档', '请打开下面两份之一。', '没有这份文档', 1),
        body: `<div class="fp-grow"><div class="howto">${ic('alert', 34)}<span>这份地址对不上用户服务协议或隐私政策。</span></div><div class="fp-pair"><button class="fp-card fp-sink" data-fp="doc" data-k="terms"><p class="fp-k">用户服务协议</p><p class="fp-note">简历、面试练习、打印扫描和政策查询怎么用。</p><div class="fp-artbox">${UI.resume(180)}</div></button><button class="fp-card fp-sink" data-fp="doc" data-k="privacy"><p class="fp-k">隐私政策</p><p class="fp-note">处理哪些信息、留多久、怎么撤回授权。</p><div class="fp-artbox">${UI.checklist(160)}</div></button></div>${remind(PHONE)}</div>`,
        dock: { ask: false }, nav: null
      });
    }
    if (st === 'load') {
      return frame({
        band: bandOf('协议与政策', `正在读取《${doc.name}》`, '取到之前不显示条款。', '正在读取', 0),
        body: `<div class="fp-grow"><div class="fp-rec"><p class="fp-k">正在读取</p><div class="fp-skel"></div><div class="fp-skel" style="width:72%"></div></div><div class="fp-rec"><p class="fp-k">正在读取</p><div class="fp-skel"></div><div class="fp-skel" style="width:48%"></div></div>${sink('正在读取条款。', UI.resume(220))}</div>`,
        dock: { ask: false }, nav: null
      });
    }
    if (st === 'error') {
      return frame({
        band: bandOf('协议与政策', `这次没能把《${doc.name}》的正文取回来`, '留存文本不是正式版本，要点开才看。', '正文没取回', 1),
        body: `<div class="fp-grow"><div class="howto">${ic('alert', 34)}<span>这次没能把《${doc.name}》的正文取回来。留存文本不是正式版本。</span></div><div class="fp-list"><button class="fp-hit" data-fp="reload"><span><b>重新读取</b><small>再取一次正文</small></span></button><button class="fp-hit" data-fp="fallback"><span><b>看本机留存文本（非正式版本）</b><small>不是最新正式版本</small></span></button><button class="fp-hit" data-fp="doc" data-k="${other}"><span><b>改看《${DOCS[other].name}》</b></span></button></div>${sink('取回之前，这里不显示条款。', UI.resume(180))}${remind(PHONE)}</div>`,
        dock: { ask: false }, nav: null
      });
    }
    const fallback = st === 'fallback';
    const ch = doc.chapters[chap];
    const ask = fallback
      ? `<button class="askq" disabled>看不懂这一章</button>`
      : `<button class="askq" data-go="xq"><span class="mic">${ic('mic', 28)}</span><span>问小青：看不懂这一章</span></button>`;
    return frame({
      band: bandOf('协议与政策', doc.name, fallback ? '这是这台机器上留着的文本，不是最新正式版本。' : '点左边的章节阅读。', fallback ? '不是最新正式版本' : '可以阅读', fallback ? 1 : 0),
      body: `<div class="fp-grow"><div class="seg"><button data-fp="doc" data-k="terms" aria-pressed="${docId === 'terms' ? 'true' : 'false'}" ${docId === 'terms' ? 'aria-disabled="true"' : ''}>用户服务协议</button><button data-fp="doc" data-k="privacy" aria-pressed="${docId === 'privacy' ? 'true' : 'false'}" ${docId === 'privacy' ? 'aria-disabled="true"' : ''}>隐私政策</button></div><div class="fp-legal"><div class="fp-toc">${doc.chapters.map((c, i) => `<button data-fp="chap" data-k="${i}" aria-pressed="${i === chap ? 'true' : 'false'}" ${i === chap ? 'aria-disabled="true"' : ''}>${c[0]}</button>`).join('')}</div><div class="fp-ltext"><span class="chip ${fallback ? 'clay' : ''}">${fallback ? '不是最新正式版本' : '示例'}</span><h3>${ch[0]}</h3><p>${ch[1]}</p>${fallback ? '<p>这是这台机器上留着的文本，不是最新正式版本。</p>' : ''}<p>${PHONE}</p><div class="fp-artbox">${UI.checklist(180)}</div></div></div></div>`,
      dockHtml: `<footer class="dock"><button class="btn sec" data-act="back">${ic('chevL', 28)}返回</button>${ask}</footer>`,
      nav: null
    });
  }
  function mountLegal(el) {
    return listen(el, (fp, k) => {
      if (fp === 'doc') set({ fpDoc: k, fpChap: 0, fpLegal: (S().fpLegal === 'error' || S().fpLegal === 'load') ? S().fpLegal : 'ready' });
      else if (fp === 'chap') set({ fpChap: +k || 0 });
      else if (fp === 'reload') set({ fpLegal: 'load' });
      else if (fp === 'fallback') set({ fpLegal: 'fallback', fpChap: 0 });
      else if (fp === 'demo:error') set({ fpLegal: 'error' });
      else if (fp === 'demo:ready') set({ fpLegal: 'ready' });
      else if (fp === 'demo:fallback') set({ fpLegal: 'fallback' });
      else if (fp === 'demo:load') set({ fpLegal: 'load' });
      else if (fp === 'demo:missing') set({ fpLegal: 'missing' });
    });
  }

  function phoneRows(rows) {
    return `<div class="fp-pfill">${rows.map((r) => `<div class="fp-prow"><b>${r[0]}</b><span>${r[1]}</span></div>`).join('')}</div>`;
  }
  function phoneShell(k, t, s, top, inner) {
    return `<div class="phonepage fp-phone"><div class="pcap"><div class="eyebrow">${k}</div><h1>${t}</h1><p>${s}</p></div><div class="pframe"><div class="pscreen"><div class="ptop"><span class="pm">职</span><b>职易达</b><span class="pc">${top}</span></div><div class="pbody">${inner}</div></div></div></div>`;
  }
  function phoneUpload() {
    const st = S().fpUp || 'ready';
    const kiosk = st === 'kiosk';
    const unknown = st === 'unknown';
    const got = st === 'got';
    const picked = st === 'picked';
    let inner = '';
    const after = phoneRows([
      ['收到之后', '系统已收到这份文件，请回一体机确认。手机上不宣布打印完成。'],
      ['结果未知', '不许再传。回一体机看这单现在怎样。'],
      ['再传一份', '回一体机重新打开。这一页的 10 分钟从生成时算，这里不显示已经过去多久。']
    ]);
    if (got) {
      inner = `<div class="pcard ok"><b>已收到</b><small>系统已收到这份文件，请回一体机确认</small></div><div class="pfile"><span class="ft">PDF</span><div><b>毕业生就业推荐表（已填写）.pdf</b><small>312 KB · 请回一体机确认</small></div></div><p class="pnote">这一页不说打印已经完成。还要传的话，回一体机再要一个新页面。</p>${after}`;
    } else if (unknown) {
      inner = `<div class="pcard"><b>这次结果还不知道</b><small>不许再传。回一体机看这单现在怎样。</small></div><button class="ppick" disabled>不能再选文件</button><p class="pnote">结果未知时，这一页不再收第二份。</p>${phoneRows([
        ['不要再选', '这一页不知道系统收没收下，不再收第二份。'],
        ['回一体机', '看这单现在怎样。手机上没有打印结果。'],
        ['时限', '自一体机生成起 10 分钟。本页不显示已经过去多久。']
      ])}`;
    } else if (kiosk) {
      inner = `<div class="pcard"><b>人在一体机上打开了本页</b><small>这台机器上不能选文件。请用手机打开。</small></div><button class="ppick" disabled>一体机上不能选文件</button>${phoneRows([
        ['用手机打开', '扫一体机上的码，在你自己的手机里选文件。'],
        ['这台屏幕', '人在一体机前时，选文件不可用。'],
        ['时限', '自生成起 10 分钟。本页不显示已经过去多久。']
      ])}`;
    } else if (picked) {
      inner = `<div class="pcard"><b>还没送到系统</b><small>选中不等于已经收到。</small></div><div class="pfile"><span class="ft">PDF</span><div><b>毕业生就业推荐表（已填写）.pdf</b><small>312 KB · 待上传</small></div><button class="pbtn ghost" data-fp="clear">移除</button></div><p class="pnote">上传结果等系统返回。这一页不自己走到已收到。</p>${phoneRows([
        ['选中之后', '先看到文件名和大小。选中还不等于系统已经收到。'],
        ['移除', '拿掉这一份，回到还没选文件。'],
        ['收到之后', '等系统返回。页上不会自己变成已收到。']
      ])}`;
    } else {
      inner = `<div class="pcard"><b>把文件传到一体机</b><small>自一体机生成起 10 分钟内有效。本页看不到已经过去多久。</small></div><button class="ppick" data-act="toast" data-arg="演示：打开手机文件选择">${ic('plus', 22)}选择手机里的文件</button><div class="fp-chips"><i>PDF</i><i>JPG</i><i>PNG</i></div><p class="pnote">单个不超过 10MB。Word 等格式，看这台机器当时能不能收。</p>${phoneRows([
        ['能传的', 'PDF、JPG、PNG。单个不超过 10MB。Word 等格式，看这台机器当时能不能收。'],
        ['选中之后', '先出现文件名和大小。选中还不等于系统已经收到。'],
        ['收到之后', '系统已收到这份文件，请回一体机确认。不在手机上宣布打印完成。'],
        ['结果未知', '不许再传。回一体机看这单。人在一体机上打开本页时，也不能选文件。']
      ])}`;
    }
    inner += `<div class="pfoot">文件只用于这次办理</div>`;
    return phoneShell('手机上的页面', '把文件传到一体机', '扫一体机上的码之后，在你自己的手机里打开。', '10 分钟内有效', inner);
  }
  function mountUpload(el) {
    return listen(el, (fp) => {
      if (fp === 'clear') set({ fpUp: 'ready' });
      else if (fp === 'demo:got') set({ fpUp: 'got' });
      else if (fp === 'demo:unknown') set({ fpUp: 'unknown' });
      else if (fp === 'demo:picked') set({ fpUp: 'picked' });
      else if (fp === 'demo:kiosk') set({ fpUp: 'kiosk' });
      else if (fp === 'demo:ready') set({ fpUp: 'ready' });
    });
  }
  function phoneLogin() {
    const st = S().fpPh || 'form';
    const agree = !!S().fpPhAgree;
    let inner = '';
    const backKiosk = phoneRows([
      ['回一体机', '确认提交后，回那块屏幕看有没有登录。这一页不宣布那边已经登录。'],
      ['重发', '间隔 60 秒，从发出时算。这一页不把秒数走完。'],
      ['票据', '一共 180 秒，从打开时算。过期后回一体机重新要码。'],
      ['结果未知', '不要再点确认。回一体机看这次有没有登上。']
    ]);
    if (st === 'done') {
      inner = `<div class="pcard ok"><b>已确认，请回一体机继续</b><small>这一页不说一体机已经登录。回那块屏幕看。</small></div>${backKiosk}`;
    } else if (st === 'unknown') {
      inner = `<div class="pcard"><b>这次确认有没有成功，本页不知道</b><small>不要再点确认。回一体机看。</small></div><button class="pbtn" disabled>不能再确认</button>${phoneRows([
        ['不要再确认', '本页不知道这次成没成，按钮停着。'],
        ['回一体机', '看那块屏幕现在是不是已经登录。'],
        ['票据', '180 秒从打开时算。过期就回一体机重新要码。']
      ])}`;
    } else if (st === 'confirming') {
      inner = `<div class="pcard"><b>正在提交确认</b><small>提交了不等于一体机已经登录。</small></div><button class="pbtn" disabled>正在确认</button>${backKiosk}`;
    } else if (st === 'sent' || st === 'sending') {
      const code = S().fpPhCode ? '验证码已填' : '点这里填验证码';
      inner = `<div class="pcard"><b>${st === 'sending' ? '正在发验证码' : '验证码已请求'}</b><small>手机号按你刚填的脱敏显示。重发间隔 60 秒，从发出时算。</small></div><button class="pinput" data-act="type">${code}</button><button class="pbtn ghost" disabled>60 秒后重发</button><button class="pbtn" data-fp="confirm" ${S().fpPhCode && st === 'sent' ? '' : 'disabled'}>确认</button><p class="pnote">确认后请回一体机。本页不宣布那边已经登录。</p>${phoneRows([
        ['确认之后', '回一体机看。这一页不宣布那边已经登录。'],
        ['重发与票据', '重发等 60 秒。票据一共 180 秒，从打开时算。这一页不把秒数走完。']
      ])}`;
    } else {
      const phone = S().fpPhFill ? '11 位已填' : '点这里填手机号';
      inner = `<div class="pcard"><b>在手机上确认这次登录</b><small>先认出是这一次的票据，再填号。票据 180 秒，从打开时算。</small></div><button class="pinput" data-act="type">${phone}</button><button class="pchk" data-fp="agree">${agree ? '已勾选' : '请勾选'}《用户服务协议》《隐私政策》</button><div class="prow2"><button class="pbtn ghost" data-fp="terms">用户服务协议</button><button class="pbtn ghost" data-fp="privacy">隐私政策</button></div><button class="pbtn" data-fp="send" ${agree ? '' : 'disabled'}>${agree ? '获取验证码' : '先勾选协议'}</button><p class="pnote">${S().fpPhMsg || '不预填手机号，也不预写验证码。'}</p>${phoneRows([
        ['先勾选', '没勾选协议不能获取验证码。协议在这一页打开，打开后可以阅读全文。'],
        ['验证码', '发出之后重发要等 60 秒。手机号按你刚填的脱敏显示。'],
        ['确认之后', '回一体机看。这一页不宣布那边已经登录。']
      ])}`;
    }
    return phoneShell('手机上的页面', '在手机上确认登录', '扫一体机上的登录码之后，在你自己的手机里打开。', '180 秒内有效', inner);
  }
  function mountPhoneLogin(el) {
    return listen(el, (fp) => {
      if (fp === 'agree') set({ fpPhAgree: !S().fpPhAgree, fpPhMsg: S().fpPhAgree ? '' : '' });
      else if (fp === 'terms') { S().fpDoc = 'terms'; S().fpLegal = 'ready'; S().fpChap = 0; window.go('legal'); }
      else if (fp === 'privacy') { S().fpDoc = 'privacy'; S().fpLegal = 'ready'; S().fpChap = 0; window.go('legal'); }
      else if (fp === 'send') {
        if (!S().fpPhAgree) { set({ fpPhMsg: '请先勾选用户服务协议和隐私政策' }); return; }
        set({ fpPh: 'sending', fpPhMsg: '正在请求验证码。' });
      } else if (fp === 'confirm') set({ fpPh: 'confirming' });
      else if (fp === 'demo:typed') {
        if (S().fpPh === 'sent' || S().fpPh === 'sending') set({ fpPh: 'sent', fpPhCode: true });
        else set({ fpPhFill: true });
      } else if (fp === 'demo:sent') set({ fpPh: 'sent' });
      else if (fp === 'demo:ok') set({ fpPh: 'done' });
      else if (fp === 'demo:unknown') set({ fpPh: 'unknown' });
    });
  }

  window.FP = {
    standby, mountStandby, xq, mountXq, help, mountHelp, official, mountOfficial,
    login, mountLogin, cleared, mountCleared, resume: resumeScreen, mountResume,
    offline, mountOffline, routeError, mountRoute, legal, mountLegal,
    phoneUpload, mountUpload, phoneLogin, mountPhoneLogin, PHONE_NOTE
  };
})();
