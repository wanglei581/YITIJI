/* 第四批：简历诊断方向、编辑、导出。运行页事实见简历服务源码；样式只加在本文件。 */
(function () {
  const { icon, band, dock, nav, slab, tile } = UI;
  const S = () => window.S;
  const F = (o) => (o.band ? band(o.band) : '') + (o.pre || '') + `<main class="body ${o.cls || ''}">${o.body}</main>` + (o.dock === false ? '' : (o.dockHtml || dock(o.dock || {}))) + (o.nav === false ? '' : (o.navAdvisor ? nav(o.nav).replace('<span>问小青</span>', '<span>AI 顾问</span>') : nav(o.nav)));
  const fine = (t) => `<p class="fine">${t}</p>`;
  const add = (id, group, name, def) => window.SCREENS.push(Object.assign({ id, group, name }, def));
  if (typeof document !== 'undefined' && !document.getElementById('d4-style')) {
    const st = document.createElement('style');
    st.id = 'd4-style';
    st.textContent = `
.body.d4-fill{justify-content:flex-start;gap:12px;padding:16px 56px 12px}
.body.d4-fill>.d4-grow{flex:1 1 auto;min-height:0}
.body.d4-fill .why{min-height:72px;padding:12px 20px;font-size:22px}
.body.d4-fill .readgrid.d4-grow{flex:1}
.body.d4-fill .readgrid .reader{height:100%;width:100%;display:flex;align-items:center;justify-content:center}
.body.d4-fill .rcol{min-height:0}
.d4-srcs{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.d4-src{min-height:148px;padding:14px 14px 12px;border-radius:26px;background:var(--card);border:1.5px solid var(--edge);text-align:left;display:flex;flex-direction:column;gap:6px}
.d4-src[aria-pressed="true"]{background:var(--deep);color:var(--cream);border-color:var(--deep)}
.d4-src[aria-pressed="true"] small{color:var(--mint)}
.d4-src b{font-size:28px;font-family:var(--serif)}
.d4-src small{font-size:20px;line-height:1.35;color:var(--ink-2)}
.d4-ico{width:64px;height:64px;border-radius:18px;background:var(--teal-wash);color:var(--teal-ink);display:grid;place-items:center}
.d4-src[aria-pressed="true"] .d4-ico{background:rgba(255,255,255,.12);color:var(--cream)}
.d4-panel{display:flex;flex-direction:column;gap:10px;min-height:0;padding:12px 16px;border-radius:26px;background:var(--card);border:1.5px solid var(--edge)}
.d4-panel[hidden]{display:none !important}
.d4-panel>b{font-size:26px;text-align:left}
.d4-panel>p{margin:0;font-size:22px;line-height:1.4;color:var(--ink-2);text-align:left}
.d4-qr{display:flex;justify-content:center}
.d4-ops{display:flex;gap:10px}
.d4-ops button{min-height:64px;min-width:120px;padding:0 18px;border-radius:20px;background:var(--well);font-size:22px;font-weight:700}
.d4-panel .dropzone{flex:1;min-height:88px}
.d4-link{min-height:72px;width:100%;display:flex;align-items:center;gap:12px;padding:0 16px;border-radius:22px;background:var(--well);font-size:22px;font-weight:700;text-align:left}
.d4-link span{flex:1}
.d4-links{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.d4-links button{min-height:64px;padding:8px 14px;border-radius:20px;background:var(--well);font-size:22px;font-weight:700;color:var(--teal-ink)}
.d4-steps{display:flex;flex-direction:column;gap:8px;flex:1;min-height:0}
.d4-step{flex:1;min-height:64px;display:flex;align-items:center;gap:12px;padding:8px 12px;border-radius:20px;background:var(--card);border:1.5px solid var(--edge);text-align:left}
.d4-step i{width:40px;height:40px;border-radius:50%;background:var(--well);display:grid;place-items:center;font-weight:700;font-style:normal;font-size:20px;flex:none}
.d4-step span{min-width:0}
.d4-step b{display:block;font-size:22px}
.d4-step small{display:block;font-size:20px;color:var(--ink-3);line-height:1.3}
.d4-step em{margin-left:auto;font-style:normal;font-size:20px;font-weight:700;color:var(--ink-3);flex:none}
.d4-paths{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.d4-path{min-height:156px;padding:18px 18px;border-radius:24px;background:var(--card);border:1.5px solid var(--edge);text-align:left}
.d4-path b{display:block;font-size:26px;font-family:var(--serif)}
.d4-path small{display:block;margin-top:4px;font-size:20px;line-height:1.35;color:var(--ink-2)}
.d4-path[aria-pressed="true"]{background:var(--deep);color:var(--cream);border-color:var(--deep)}
.d4-path[aria-pressed="true"] small{color:var(--mint)}
.d4-block{display:flex;flex-direction:column;gap:8px;text-align:left}
.d4-lab{font-size:22px;font-weight:700}
.d4-lab small{font-weight:500;font-size:20px;color:var(--ink-3);margin-left:8px}
.d4-chips{display:flex;flex-wrap:wrap;gap:8px}
.d4-chips button{min-height:84px;min-width:64px;padding:0 10px;border-radius:20px;background:var(--card);border:1.5px solid var(--edge);font-size:20px;font-weight:700;white-space:nowrap}
.d4-chips button[aria-pressed="true"]{background:var(--deep);color:var(--cream);border-color:var(--deep)}
.d4-fields{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
.d4-field{min-height:120px;padding:14px 14px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge);text-align:left}
.d4-field small{display:block;font-size:20px;color:var(--ink-3)}
.d4-field b{display:block;margin-top:4px;font:700 26px/1.3 var(--serif)}
.d4-ph{color:var(--ink-3);font-family:var(--sans);font-size:22px;font-weight:500}
.d4-skip{min-height:88px;width:100%;border-radius:22px;background:var(--well);font-size:24px;font-weight:700}
.d4-hint{min-height:72px;display:flex;flex-direction:column;justify-content:center;gap:4px;padding:10px 16px;border-radius:22px;background:var(--teal-wash);color:var(--teal-ink);text-align:left}
.d4-hint p{margin:0;font-size:22px;line-height:1.4}
.d4-rep{display:grid;grid-template-columns:1fr 1.08fr;gap:12px;min-height:0}
.d4-dims,.d4-prios{display:flex;flex-direction:column;gap:8px;min-height:0}
.d4-h{display:flex;align-items:baseline;gap:8px;font-size:22px;font-weight:700;text-align:left}
.d4-h small{font-size:20px;font-weight:500;color:var(--ink-3)}
.d4-dim{flex:1;min-height:64px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;align-items:center;padding:6px 10px 8px;border-radius:18px;background:var(--card);border:1.5px solid var(--edge);text-align:left}
.d4-dim b{font-size:20px}
.d4-dim small{grid-column:1;font-size:20px;line-height:1.25;color:var(--ink-2)}
.d4-dim em{font-style:normal;font-weight:700;font-size:20px}
.d4-dim em.teal,.d4-dim i.teal{color:var(--teal-ink)}
.d4-dim em.clay{color:var(--clay-ink)}
.d4-dim i{grid-column:1 / -1;display:block;height:8px;border-radius:4px;background:var(--well);position:relative}
.d4-dim i::after{content:"";position:absolute;inset:0;border-radius:4px;transform:scaleX(var(--p));transform-origin:left;background:var(--teal)}
.d4-dim i.clay::after{background:var(--clay)}
.d4-card{flex:1;min-height:0;padding:8px 12px;border-radius:20px;background:var(--card);border:1.5px solid var(--edge);text-align:left}
.d4-card b{font-size:22px}
.d4-card>small{display:block;font-size:20px;color:var(--ink-3)}
.d4-card p{margin:3px 0 0;font-size:20px;line-height:1.3;color:var(--ink-2)}
.d4-card u{text-decoration:none;font-weight:700;color:var(--ink);margin-right:4px}
.d4-all{border-radius:20px;background:var(--well);padding:0 14px 8px;text-align:left}
.d4-all summary{min-height:64px;display:flex;align-items:center;font-size:22px;font-weight:700;list-style:none}
.d4-all summary::-webkit-details-marker{display:none}
.d4-all>p{margin:0 0 6px;font-size:20px;color:var(--ink-3)}
.d4-take{display:flex;align-items:center;gap:10px;min-height:120px;padding:8px 12px;border-radius:24px;background:var(--card);border:1.5px solid var(--edge)}
.d4-take>b{font-size:22px;text-align:left}
.d4-price{font-size:20px;font-weight:700;color:var(--teal-ink)}
.d4-take button{min-height:72px;min-width:64px;padding:0 14px;border-radius:20px;background:var(--well);font-size:22px;font-weight:700}
.d4-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.d4-stats span{min-height:72px;display:flex;flex-direction:column;justify-content:center;padding:6px 12px;border-radius:18px;background:var(--well);text-align:left;cursor:default}
.d4-stats u{font-size:20px;text-decoration:none;color:var(--ink-3)}
.d4-stats b{font-size:28px;font-variant-numeric:tabular-nums}
.d4-stats small{font-size:20px;font-weight:500;color:var(--ink-3)}
.d4-batch{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.d4-batch button{min-height:80px;padding:8px 10px;border-radius:20px;background:var(--card);border:1.5px solid var(--edge);text-align:left}
.d4-batch b{display:block;font-size:22px}
.d4-batch small{display:block;font-size:20px;line-height:1.3;color:var(--ink-3);font-weight:500}
.d4-rows{display:flex;flex-direction:column;gap:8px}
.d4-row{flex:1;min-height:96px;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(240px,.9fr) 104px;gap:10px;align-items:center;padding:8px 10px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge)}
.d4-rowtx{min-width:0;text-align:left}
.d4-rowtx b{display:block;font-size:24px}
.d4-rowtx small{display:block;font-size:20px;line-height:1.3;color:var(--ink-2)}
.d4-seg{display:flex;gap:8px}
.d4-seg button{flex:1;min-height:64px;min-width:64px;padding:0 10px;border-radius:18px;background:var(--card);border:1.5px solid var(--edge);font-size:22px;font-weight:700}
.d4-seg button[aria-pressed="true"]{background:var(--deep);color:var(--cream);border-color:var(--deep)}
.d4-seg button[disabled]{opacity:.42;pointer-events:none}
.d4-open{min-height:64px;min-width:96px;border-radius:18px;background:var(--teal-wash);color:var(--teal-ink);font-size:22px;font-weight:700}
.d4-hand{min-height:64px;display:flex;align-items:center;justify-content:center;padding:0 8px;border-radius:18px;background:var(--well);font-size:22px;font-weight:700;color:var(--ink-2)}
.d4-exits{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.d4-exits .btn{width:100%}
.d4-top{display:flex;align-items:center;gap:12px}
.d4-prev{min-height:64px;min-width:140px;padding:0 18px;border-radius:20px;background:var(--card);border:1.5px solid var(--edge);font-size:22px;font-weight:700;flex:none}
.d4-legend{flex:1;display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;min-height:64px;font-size:20px}
.d4-legend del,.d4-diff del{background:var(--cin-wash);color:var(--cinnabar);text-decoration:line-through;padding:0 6px;border-radius:8px}
.d4-legend ins,.d4-diff ins{background:var(--teal-wash);color:var(--teal-ink);text-decoration:none;padding:0 6px;border-radius:8px}
.d4-swap{background:var(--clay-wash);color:var(--clay-ink);padding:0 6px;border-radius:8px}
.d4-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.d4-col{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border-radius:24px;background:var(--card);border:1.5px solid var(--edge);text-align:left;min-height:0}
.d4-col b{font-size:24px}
.d4-col p{margin:0;flex:1;font-size:26px;line-height:1.45}
.d4-col small{font-size:20px;color:var(--ink-3)}
.d4-fact{min-height:72px;display:flex;align-items:center;gap:14px;padding:0 16px;border-radius:20px;background:var(--clay-wash);color:var(--clay-ink);font-size:24px;font-weight:700;text-align:left}
.d4-fact input{width:36px;height:36px;flex:none}
.d4-custom{display:flex;flex-direction:column;gap:10px;padding:16px 18px;border-radius:24px;background:var(--well)}
.d4-custom .d4-cl{font-size:24px}
.d4-custom .d4-ta{width:100%;min-height:150px;padding:16px 18px;border-radius:20px;border:2px dashed var(--edge);background:var(--card);font-size:24px;color:var(--ink-3);text-align:left;display:flex;align-items:flex-start}
.d4-custom .d4-cn{margin:0;font-size:20px;line-height:1.45;color:var(--ink-3)}
.d4-custom .d4-ca{display:flex;gap:12px}
.d4-custom .d4-ca .btn{min-width:160px}
.d4-custom[hidden]{display:none !important}
.d4-edit{display:grid;grid-template-columns:440px minmax(0,1fr);gap:12px}
.d4-sheet{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:12px;border-radius:26px;background:var(--card);border:1.5px solid var(--edge);min-height:0}
.d4-sheet p{margin:0;display:flex;gap:12px;align-items:center;font-size:20px;color:var(--ink-3)}
.d4-sheet p b{font-size:24px;color:var(--ink)}
.d4-side{display:flex;flex-direction:column;gap:8px;min-height:0}
.d4-line{display:grid;grid-template-columns:84px minmax(0,1fr);gap:8px;align-items:center}
.d4-line>span{font-size:22px;font-weight:700;text-align:left}
.d4-swatch{width:22px;height:22px;border-radius:50%;display:inline-block;margin-right:6px;vertical-align:-4px}
.d4-swatch.blue{background:var(--slate)}
.d4-swatch.green{background:var(--teal)}
.d4-swatch.gray{background:var(--ink-3)}
.d4-note{margin:0;font-size:20px;line-height:1.35;color:var(--ink-3);text-align:left}
.d4-warn{margin:0;min-height:64px;display:flex;align-items:center;padding:8px 14px;border-radius:18px;background:var(--clay-wash);color:var(--clay-ink);font-size:22px;font-weight:700;line-height:1.35;text-align:left}
.d4-status{margin:0;min-height:40px;display:flex;align-items:center;font-size:22px;font-weight:700}
.d4-ai{flex:1;display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge);text-align:left;min-height:0}
.d4-ai h3{margin:0;font-size:24px;display:flex;align-items:center;gap:8px}
.d4-ai p{margin:0;font-size:20px;line-height:1.4;color:var(--ink-2)}
.d4-ai-acts{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.d4-ai-acts button{min-height:64px;padding:0 8px;border-radius:18px;background:var(--teal-wash);color:var(--teal-ink);font-size:20px;font-weight:700}
.d4-fmts{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:12px}
.d4-fmt{min-height:120px;padding:16px 18px;border-radius:26px;background:var(--card);border:1.5px solid var(--edge);text-align:left;display:flex;flex-direction:column;justify-content:center;gap:6px}
.d4-fmt b{font-size:32px;font-family:var(--serif)}
.d4-fmt small{font-size:20px;line-height:1.35;color:var(--ink-2)}
.d4-fmt[aria-pressed="true"]{background:var(--deep);color:var(--cream);border-color:var(--deep)}
.d4-fmt[aria-pressed="true"] small{color:var(--mint)}
.d4-out{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px;align-items:center;padding:12px 14px;border-radius:24px;background:var(--card);border:1.5px solid var(--edge);text-align:left}
.d4-out>b{display:block;font-size:26px}
.d4-file small{display:block;margin-top:4px;font-size:20px;color:var(--ink-3)}
.d4-out>button{min-height:80px;min-width:180px;padding:0 16px;border-radius:20px;background:var(--deep);color:var(--cream);font-size:24px;font-weight:700}
.d4-out>button[hidden]{display:none !important}
.d4-qrcell{display:flex;flex-direction:column;align-items:center;gap:6px}
.d4-qrcell button{min-height:64px;min-width:140px;padding:0 12px;border-radius:18px;background:var(--well);font-size:22px;font-weight:700}
.d4-guest{margin:0;min-height:64px;display:flex;align-items:center;justify-content:center;padding:8px 16px;border-radius:18px;background:var(--well);font-size:22px;font-weight:700;text-align:center}
.d4-src:active,.d4-path:active,.d4-fmt:active,.d4-chips button:active,.d4-seg button:active,.d4-open:active,.d4-links button:active,.d4-skip:active,.d4-field:active,.d4-prev:active,.d4-take button:active,.d4-ai-acts button:active,.d4-batch button:active,.d4-outlink:active,.d4-modes button:active,.d4-dimpick button:active{transform:scale(.98)}
.screen:has(.d4-hub) .askq span,.screen:has(.d4-srcpage) .askq span,.screen:has(.d4-dir) .askq span,.screen:has(.d4-more) .askq span,.screen:has(.d4-read) .askq span,.screen:has(.d4-diag) .askq span,.screen:has(.d4-opt) .askq span,.screen:has(.d4-cmp) .askq span,.screen:has(.d4-ed) .askq span,.screen:has(.d4-ex) .askq span,.screen:has(.st3-aidown) .askq span{white-space:normal;overflow:visible;text-overflow:clip;line-height:1.2}
.d4-outlink{min-height:64px;width:100%;border-radius:22px;background:var(--card);border:1.5px solid var(--edge);font-size:24px;font-weight:700;color:var(--teal-ink);text-align:left;padding:0 20px;display:flex;align-items:center}
.d4-dead{display:flex;flex-direction:column;gap:8px}
.d4-dead .slab{padding:16px 18px 14px 22px}
.d4-dead .slab .vis{min-height:120px}
.d4-dead .slab .txt{gap:6px}
.body.d4-hub{justify-content:flex-start;gap:12px;padding-top:16px;padding-bottom:10px}
.body.d4-hub .d4-dead .slab.row{min-height:0;padding:14px 18px;gap:16px}
.body.d4-hub .d4-dead .slab.row .vis{min-height:96px;width:150px}
.body.d4-hub .fine{line-height:1.45}
.body.d4-srcpage .d4-panel{flex:none}
.body.d4-srcpage .d4-qr svg{width:360px;height:360px}
.d4-ministep{margin:0}
.d4-ministep .s{padding:12px 14px;gap:4px;min-height:96px}
.d4-ministep .s b{font-size:22px;line-height:1.3}
.d4-drop{flex:none;height:160px;min-height:160px;max-height:160px}
.body.d4-dir{justify-content:flex-start;gap:12px}
.d4-modes{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.d4-modes button{min-height:96px;padding:14px 16px;border-radius:24px;background:var(--card);border:1.5px solid var(--edge);text-align:left}
.d4-modes b{display:block;font-size:28px;font-family:var(--serif)}
.d4-modes small{display:block;margin-top:4px;font-size:20px;line-height:1.35;color:var(--ink-2)}
.d4-modes button[aria-pressed="true"]{background:var(--deep);color:var(--cream);border-color:var(--deep)}
.d4-modes button[aria-pressed="true"] small{color:var(--mint)}
.d4-dir .d4-path{min-height:240px;padding:28px 24px;display:flex;flex-direction:column;justify-content:center}
.d4-dir .d4-path b{font-size:36px}
.d4-dir .d4-path small{font-size:24px;margin-top:10px}
.d4-dir.on .d4-path{min-height:112px;padding:16px 18px}
.d4-dir.on .d4-path b{font-size:28px}
.d4-dir.on .d4-path small{font-size:20px;margin-top:4px}
.d4-see{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;padding:16px 18px;border-radius:26px;background:var(--card);border:1.5px solid var(--edge);text-align:left}
.d4-see>b{font-size:28px;font-family:var(--serif)}
.d4-see>p{margin:0;font-size:22px;line-height:1.4;color:var(--ink-2)}
.d4-see ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;flex:1}
.d4-see li{flex:1;min-height:64px;display:flex;flex-direction:column;justify-content:center;padding:8px 12px;border-radius:16px;background:var(--well);text-align:left}
.d4-see li b{font-size:24px}
.d4-see li span{font-size:20px;line-height:1.35;color:var(--ink-2)}
.d4-dimpick{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
.d4-dimpick button{min-height:132px;padding:12px 12px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge);font-size:24px;font-weight:700;line-height:1.3;text-align:left}
.d4-dimpick button[aria-pressed="true"]{background:var(--deep);color:var(--cream);border-color:var(--deep)}
.d4-more .d4-chips button{min-height:64px;font-size:22px}
.d4-more .d4-field{min-height:96px}
.body.d4-read .readgrid{grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);align-items:stretch}
.body.d4-read .reader{width:100%;height:100%;background:transparent;box-shadow:none;display:flex;align-items:center;justify-content:center}
.body.d4-read .reader svg{width:auto;height:100%;max-width:100%}
.body.d4-read .rcol{background:var(--card);border:1.5px solid var(--edge);border-radius:26px;padding:12px;display:flex;flex-direction:column;gap:8px}
.body.d4-read .d4-steps{flex:none}
.body.d4-read .d4-step{flex:none;min-height:0;padding:10px 12px}
.body.d4-read .d4-dimro{flex:1;min-height:0}
.body.d4-read .d4-rochips{flex:1;flex-direction:column}
.body.d4-read .d4-rochips span{flex:1;min-height:44px}
.d4-dimro{display:flex;flex-direction:column;gap:8px;text-align:left}
.d4-dimro>b{font-size:22px}
.d4-dimro .d4-rochips{display:flex;flex-wrap:wrap;gap:8px}
.d4-dimro .d4-rochips span{min-height:48px;display:inline-flex;align-items:center;padding:6px 12px;border-radius:16px;background:var(--card);border:1.5px solid var(--edge);font-size:20px;font-weight:700}
.body.d4-opt .d4-rows{flex:none}
.body.d4-opt .d4-row{flex:none;min-height:172px}
.body.d4-opt .d4-rowtx small{font-size:24px;line-height:1.35}
.body.d4-opt .d4-stats span{min-height:112px}
.body.d4-opt .d4-stats b{font-size:40px}
.body.d4-opt .d4-batch button{min-height:112px}
.d4-draft{margin:0;min-height:64px;display:flex;align-items:center;padding:8px 16px;border-radius:18px;background:var(--well);font-size:24px;font-weight:700;line-height:1.35;text-align:left}
.body.d4-cmp{justify-content:space-between;gap:10px}
.body.d4-cmp .d4-cols{flex:none}
.body.d4-cmp .d4-col{flex:none}
.body.d4-cmp .d4-col p{flex:none;font-size:28px;line-height:1.45}
.d4-stats5{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.d4-metrics{margin:0;font-size:22px;color:var(--ink-3);text-align:right}
.body.d4-cmp .d4-batch button{min-height:96px}
.d4-stats5 span{min-height:128px;display:flex;flex-direction:column;justify-content:center;padding:8px 12px;border-radius:18px;background:var(--well);text-align:left}
.d4-stats5 u{font-size:20px;text-decoration:none;color:var(--ink-3)}
.d4-stats5 b{font-size:40px;font-variant-numeric:tabular-nums}
.d4-cmp .d4-dec button{min-height:88px;font-size:26px}
.d4-fact{position:relative;cursor:pointer}
.d4-fact input{appearance:none;-webkit-appearance:none;width:64px;height:64px;margin:0;flex:none;border:2px solid var(--ink);border-radius:12px;background:#fff;display:grid;place-items:center}
.d4-fact input:checked{background:var(--deep);border-color:var(--deep)}
.d4-fact input:checked::after{content:"";width:14px;height:8px;border-left:3px solid #fff;border-bottom:3px solid #fff;transform:rotate(-45deg) translate(1px,-2px)}
.body.d4-ed .d4-edit{flex:1;min-height:0;align-items:stretch;grid-template-columns:minmax(0,1.25fr) minmax(300px,.75fr)}
.body.d4-ed .d4-sheet{height:100%;justify-content:flex-start;align-items:center;padding:12px}
.body.d4-ed .d4-sheet svg{width:100%;height:auto;max-height:62%}
.d4-sheetfacts{margin-top:8px;width:100%;flex:1;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr 1fr;gap:8px}
.d4-sheetfacts div{min-height:0;padding:10px 12px;border-radius:16px;background:var(--well);text-align:left;display:flex;flex-direction:column;justify-content:center;gap:4px}
.d4-sheetfacts b{font-size:22px}
.d4-sheetfacts span{font-size:20px;line-height:1.35;color:var(--ink-2)}
.body.d4-ed .d4-ai{flex:none}
.body.d4-ed .d4-side{height:100%;gap:10px}
.d4-now{margin-top:auto;min-height:112px;padding:14px 16px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge);display:flex;flex-direction:column;justify-content:center;gap:6px;text-align:left}
.d4-now b{font-size:24px}
.d4-now span{font-size:22px;line-height:1.4;color:var(--ink-2)}
.d4-tpl{min-height:88px;width:100%;padding:12px 16px;border-radius:22px;background:var(--deep);color:var(--cream);border:1.5px solid var(--deep);font-size:26px;font-weight:700;text-align:left}
.d4-morebtn{min-height:72px}
.d4-layout[hidden]{display:none !important}
.body.d4-ex{justify-content:flex-start;gap:12px}
.body.d4-ex .d4-fmts{flex:none;grid-template-rows:180px 180px}
.body.d4-ex .d4-fmt{min-height:0;height:180px}
.d4-facts{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.d4-facts div{min-height:150px;padding:16px 18px;border-radius:24px;background:var(--card);border:1.5px solid var(--edge);text-align:left;display:flex;flex-direction:column;justify-content:center;gap:6px}
.d4-facts b{font-size:26px}
.d4-facts span{font-size:22px;line-height:1.4;color:var(--ink-2)}
.d4-pricebar{margin:0;min-height:72px;display:flex;align-items:center;justify-content:center;padding:8px 16px;border-radius:20px;background:var(--teal-wash);color:var(--teal-ink);font-size:28px;font-weight:700}
.d4-factdlg{align-items:stretch;text-align:left;width:920px}
.d4-factdlg h2{text-align:left}
.d4-factdlg .d4-fact{width:100%;background:var(--card);border:1.5px solid var(--edge)}
.d4-factdlg .d4-fact em{margin-left:auto;font-style:normal;font-size:22px;font-weight:700;color:var(--ink-3)}
.d4-pending{font-size:24px;font-weight:700;color:var(--clay-ink)}
.st3-aidown .d4-ck{font-size:22px;font-weight:500;color:var(--ink-3);margin-left:8px}
.st3-aidown .d4-exgroup{display:flex;flex-direction:column;gap:10px}
.st3-aidown .d4-exgroup .slab.row{min-height:0;padding:10px 14px}
.st3-aidown .d4-exgroup .slab.row .vis{min-height:72px;width:96px}
.st3-aidown .d4-exgroup{gap:8px}
.body.st3-aidown{justify-content:flex-start;gap:8px;padding-top:8px;padding-bottom:6px}
.st3-aidown .howto{min-height:0;padding:12px 16px}
.st3-aidown .olist{padding:12px 14px;gap:4px}
.st3-aidown .st3-check{min-height:44px;align-items:center;padding:0}
.st3-aidown .olist-t{font-size:24px}
.body.d4-dir.on .d4-dimpick button{min-height:72px}
.body.d4-dir.on .d4-modes button{min-height:80px}
.body.d4-dir.on .d4-field{min-height:96px}
.body.d4-dir.on .d4-path{min-height:88px;padding:12px 16px}
.body.d4-dir.on .d4-see li{min-height:48px;padding:4px 10px}
.body.d4-diag .d4-take{flex-wrap:wrap}
.body.d4-ex .d4-facts{flex:1}
.body.d4-opt .d4-stats span{min-height:128px}
.body.d4-opt .d4-batch button{min-height:128px}
`;
    document.head.appendChild(st);
  }

  const chip = (label, on) => `<button aria-pressed="${on ? 'true' : 'false'}" data-act="chip">${label}</button>`;
  const one = (label, on) => `<button aria-pressed="${on ? 'true' : 'false'}" data-act="seg">${label}</button>`;

  const DIMS = [
    ['基础信息完整度', '看姓名、联系方式、求职意向是否齐全好找。'],
    ['求职目标清晰度', '看有没有写明目标岗位，全篇是否围绕它。'],
    ['经历表达清晰度', '看每段经历有没有交代做法与结果。'],
    ['成果量化程度', '看成果有没有用可核实的数字说明。'],
    ['岗位关键词覆盖', '看用词与目标岗位的常见表述是否对得上。'],
    ['版式与可读性', '看分区、留白与长度是否便于快速阅读。']
  ];
  const DIM_ON = new Set(['经历表达清晰度', '成果量化程度', '岗位关键词覆盖']);

  add('resume-direction', '改简历', '诊断方向（可以不选）', {
    notes: {
      does: '运行页方向在 /resume/source 的 DiagnosisDirectionForm，不单独成路由。默认通用诊断（ResumeSourcePage.tsx genericDiagnosis 初值 true）。S().directed 为真时画定向诊断。S().intent 为 optimize 时预选「直接给改法」，否则预选「先诊断，再逐条改」（来自 resume-more 的 data-arg，或主卡 diagnose）。',
      motion: '两条路点选只改 aria-pressed，并记下 S().intent。定向 / 通用切换重绘本屏。',
      keep: '定向诊断原文「按你选的重点排建议顺序」，通用诊断原文「不设方向，下面各项都不参与」。说明句「只影响建议关注顺序，报告仍固定输出 6 个维度。」通用态只有两条路、这个二选一、说明、六维只读卡和主按钮，可点不超过 8 个（导航三格不计入）。「不选了，按通用标准看」并进「通用诊断」，不再单列。定向态六维可多选，默认 3 项：经历表达清晰度、成果量化程度、岗位关键词覆盖（DEFAULT_SELECTED_DIMENSIONS：keyword、quantification、experience）。目标岗位示例「行政专员」（最多 80 字，运行页占位「例如：前端工程师、财务助理」）。行业是 GB/T 4754 的 20 个门类，示例写「教育」（代码 P）。经历、场景、专业、学历在 resume-direction-more。两条路：diagnose 主按钮「开始 AI 诊断」，optimize 主按钮「上传并生成优化建议」，都去 reading。六维名称来自 RESUME_SCORING_DIMENSIONS，人话来自 DIM_ABOUT。第一次用 AI 的授权弹层不盖在这一帧上。'
    },
    render: () => {
      const directed = S().directed === true;
      const opt = S().intent === 'optimize';
      const modes = `<div class="d4-modes" role="group" aria-label="诊断范围">
          <button type="button" data-d4-mode="directed" aria-pressed="${directed ? 'true' : 'false'}"><b>定向诊断</b><small>按你选的重点排建议顺序</small></button>
          <button type="button" data-d4-mode="generic" aria-pressed="${directed ? 'false' : 'true'}"><b>通用诊断</b><small>不设方向，下面各项都不参与</small></button>
        </div>`;
      const paths = `<div class="d4-paths" role="group" aria-label="先诊断还是直接给改法">
          <button class="d4-path" data-act="seg" data-d4-intent="diagnose" aria-pressed="${opt ? 'false' : 'true'}"><b>先诊断，再逐条改</b><small>推荐 · 先看问题，再决定改不改</small></button>
          <button class="d4-path" data-act="seg" data-d4-intent="optimize" aria-pressed="${opt ? 'true' : 'false'}"><b>直接给改法</b><small>上传后生成优化建议</small></button>
        </div>`;
      const hint = `<div class="d4-hint"><p>只影响建议关注顺序，报告仍固定输出 6 个维度。</p></div>`;
      const see = `<section class="d4-see" aria-label="通用诊断看什么"><b>通用诊断看什么</b><p>不设方向。报告仍按这 6 个维度输出，只读，这里不能勾。</p><ul>${DIMS.map((d) => `<li><b>${d[0]}</b><span>${d[1]}</span></li>`).join('')}</ul></section>`;
      const seeDirected = `<section class="d4-see" aria-label="报告仍会写出的维度"><b>报告仍固定写出这 6 维</b><p>勾选只影响建议关注顺序。下面只读，不能在这里改勾选。</p><ul>${DIMS.map((d) => `<li><b>${d[0]}</b><span>${d[1]}</span></li>`).join('')}</ul></section>`;
      const picked = `<div class="d4-block"><div class="d4-lab">重点看哪几维<small>默认 3 项，可增减</small></div><div class="d4-dimpick" role="group" aria-label="重点关注维度">${DIMS.map((d) => `<button type="button" data-act="chip" aria-pressed="${DIM_ON.has(d[0]) ? 'true' : 'false'}">${d[0]}</button>`).join('')}</div></div>
          <div class="d4-fields" style="grid-template-columns:1fr 1fr">
            <button class="d4-field" data-act="type"><small>目标岗位</small><b>行政专员</b></button>
            <button class="d4-field" data-act="toast" data-arg="行业按 20 个门类选，当前是教育"><small>行业 · 全部 20 个门类</small><b>教育</b></button>
          </div>
          <button class="d4-outlink" data-go="resume-direction-more">更多条件（可不填）：经历、场景、专业、学历 ›</button>`;
      return F({
        band: { kind: 'compact', eyebrow: '诊断方向（可以不选）', title: directed ? '想按什么方向看？' : '按通用标准看，可以吗？', sub: directed ? '可以多选重点，也可以改回通用。' : '不设方向。想指定重点，再改成定向诊断。', rail: { labels: ['上传与方向', 'AI 解析', '诊断报告', '优化打印'], now: 0 }, seal: null, place: ' ', status: { text: directed ? '定向诊断' : '通用诊断' } },
        cls: 'tight d4-fill d4-dir' + (directed ? ' on' : ''),
        body: directed ? `${modes}${paths}${picked}${seeDirected}` : `${modes}${paths}${see}${hint}`,
        dock: { backLabel: '返回', ask: '问小青：帮我选重点', pri: { label: `<span id="d4DirGoLabel">${opt ? '上传并生成优化建议' : '开始 AI 诊断'}</span>`, go: 'reading', id: 'd4DirGo' } }, nav: null, navAdvisor: 1
      });
    },
    mount: (el) => {
      const onClick = (e) => {
        const path = e.target.closest('[data-d4-intent]');
        if (path) S().intent = path.dataset.d4Intent === 'optimize' ? 'optimize' : 'diagnose';
        const mode = e.target.closest('[data-d4-mode]');
        if (mode) {
          S().directed = mode.dataset.d4Mode === 'directed';
          window.__proto.refresh();
          return;
        }
        queueMicrotask(() => {
          const lab = el.querySelector('#d4DirGoLabel');
          const opt = el.querySelector('[data-d4-intent="optimize"][aria-pressed="true"]');
          if (lab) lab.textContent = opt ? '上传并生成优化建议' : '开始 AI 诊断';
        });
      };
      el.addEventListener('click', onClick);
      return () => el.removeEventListener('click', onClick);
    }
  });

  add('resume-direction-more', '改简历', '更多条件（可不填）', {
    notes: {
      does: '运行页没有单独路由。这些字段在 DiagnosisDirectionForm 同一页：经验级别、求职场景、专业、学历。稿上从 resume-direction 拆出来，避免定向态一屏可点过多。',
      motion: '经历、场景、学历单选只改 aria-pressed。专业点了走屏上键盘。',
      keep: '经历选项是「暂不指定」加 RESUME_TARGET_EXPERIENCE_OPTIONS；运行页标签是「经验级别」，这一屏按稿写「经历」。场景是「暂不指定」加 RESUME_TARGET_SCENE_OPTIONS；运行页标签是「求职场景」。其中「招聘会现场」只是诊断参考的场景标签，不是招聘会入口，不去任何招聘会页（10/26 产品负责人同意保留）。学历是「不填写」加 EDUCATION_LEVEL_OPTIONS。专业不是枚举，最多 60 字，占位「例如：计算机科学与技术」。示例预选：应届、校招、本科，与拆屏前这一帧一致。主按钮「好了，回去开始诊断」回 resume-direction，不在这里直接解析。次按钮「都不填」也回 resume-direction，这四项不参与。说明句「专业与学历仅用于本人简历表达的诊断重点参考，不影响是否可以诊断。」'
    },
    render: () => {
      const exp = ['暂不指定', '无工作经验', '应届', '1年以内', '1-3年', '3-5年', '5年以上'];
      const scene = ['暂不指定', '校招', '社招', '转岗', '招聘会现场'];
      const deg = ['不填写', '初中及以下', '高中', '职高', '中专', '技校/中技', '高职专科', '大专', '本科', '硕士', '博士', '境外学历', '其他'];
      return F({
        band: { kind: 'compact', eyebrow: '更多条件（可不填）', title: '这些要不要一起告诉我？', sub: '不填也能诊断。填了只影响建议关注顺序。', rail: { labels: ['上传与方向', 'AI 解析', '诊断报告', '优化打印'], now: 0 }, seal: null, place: ' ', status: { text: '都可以不填' } },
        cls: 'tight d4-fill d4-more',
        body: `<div class="d4-block"><div class="d4-lab">经历</div><div class="d4-chips" role="group" aria-label="经历">${exp.map((x) => one(x, x === '应届')).join('')}</div></div>
          <div class="d4-block"><div class="d4-lab">场景</div><div class="d4-chips" role="group" aria-label="场景">${scene.map((x) => one(x, x === '校招')).join('')}</div></div>
          <button class="d4-field" data-act="type"><small>专业（选填）</small><b class="d4-ph">例如：计算机科学与技术</b></button>
          <div class="d4-block"><div class="d4-lab">学历<small>选填</small></div><div class="d4-chips" role="group" aria-label="学历">${deg.map((x) => one(x, x === '本科')).join('')}</div></div>
          <div class="d4-hint"><p>专业与学历仅用于本人简历表达的诊断重点参考，不影响是否可以诊断。</p></div>
          <section class="d4-see" aria-label="这四项怎么用"><b>这四项怎么用</b><ul>
            <li><b>经历</b><span>就是经验级别。示例预选「应届」。不选，这一项不参与。</span></li>
            <li><b>场景</b><span>就是求职场景。示例预选「校招」。不选，这一项不参与。</span></li>
            <li><b>专业</b><span>不是固定名单，最多 60 字。只作本人简历表达的诊断重点参考。</span></li>
            <li><b>学历</b><span>选填。同样只影响建议关注顺序，不影响是否可以诊断。</span></li>
          </ul></section>
          <button class="d4-skip" data-go="resume-direction">都不填</button>`,
        dock: { backLabel: '返回', ask: '问小青：可以不填吗', pri: { label: '好了，回去开始诊断', go: 'resume-direction' } }, nav: null, navAdvisor: 1
      });
    }
  });

  add('resume-edit', '改简历', '编辑', {
    notes: {
      does: '运行页优化工作台里的编辑区（OptimizeReadyBody、ResumeLayoutControls、ResumeFormatChooser 的模板列表）。左页是 HTML 预览。S().layoutMore 展开字号、行距、页边距、栏数。S().aiAdjusted 为真才出现「撤销 AI 调整」。事实未全勾时，点「去导出」先出「导出前核对事实」（S().factSheet），全勾后才去 resume-export。',
      motion: '展开版式和核对弹层都是重绘，不播循环动画。',
      keep: '模板名从后台读。这一帧示例只有一张「清爽通用简历模板」选中，旁边「去素材库看更多模板」去 templates（ResumeFormatChooser 按返回的模板画按钮，不是写死三份）。清爽 / 紧凑 / 正式是素材库 STYLE_LABELS 的风格标签，不在这里当模板。内置那一份的标题就是「清爽通用简历模板」。页数是导出回执的 pageCount，导出前不知道，这里的「1 页」是示意，并写 HTML_PREVIEW_NOTE「示意，非打印稿」。主区：模板、主色（蓝 / 绿 / 灰）、AI 精简、AI 调整排版。更多版式：字号紧凑/标准/放大，行距紧凑/标准/舒展，页边距窄/标准/宽，栏数单栏/双栏。撤销只在做过一次 AI 调整之后出现（lastResumeBeforeAiAdjust）。说明句「仅基于当前简历和原文做表达密度调整，不新增经历或事实」。状态「未保存」。还有 1 处事实待确认，对应「周更 2 篇」。弹层标题「导出前核对事实」，说明用 ResumeFactConfirmDialog 原文，待确认「周更 2 篇」，一条勾选，未全勾时主按钮禁用。主按钮文案按运行页是「确认导出」。取消是「返回修改」。'
    },
    render: () => {
      const more = S().layoutMore === true;
      const undone = S().aiAdjusted === true;
      const line = (label, items, on) => `<div class="d4-line"><span>${label}</span><div class="d4-chips" role="group" aria-label="${label}">${items.map((it) => one(it, it === on)).join('')}</div></div>`;
      const sheet = S().factSheet ? `<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="d4FactTitle"><div class="dialog d4-factdlg">
          <h2 id="d4FactTitle">导出前核对事实</h2>
          <p>请逐项勾选「已核对」。未全勾不能出文件。系统不会替你确认学校、公司、时间段、证书或电话。</p>
          <p class="d4-pending">待本人确认：周更 2 篇</p>
          <label class="d4-fact"><input id="d4FactOk" type="checkbox"><span>周更 2 篇</span><em>已核对</em></label>
          <p id="d4FactWhy">还有未勾选的事实，不能出文件。</p>
          <div class="btns">
            <button class="btn pri" id="d4FactGo" disabled>确认导出</button>
            <button class="btn sec" id="d4FactBack" type="button">返回修改</button>
          </div>
        </div></div>` : '';
      return F({
        band: { kind: 'compact', eyebrow: '编辑', title: '版式和模板，要怎么排？', rail: { labels: ['上传与方向', 'AI 解析', '诊断报告', '优化打印'], now: 3 }, seal: null, place: ' ', status: { text: '未保存' } },
        cls: 'tight d4-fill d4-ed',
        body: `<div class="d4-edit">
            <div class="d4-sheet">${UI.resume(520)}<p><b>1 页</b><span>示意，非打印稿</span></p>
              <div class="d4-sheetfacts">
                <div><b>页数</b><span>导出前不知道真实页数。这里的 1 页只是示意，打印以导出文件为准。</span></div>
                <div><b>模板</b><span>当前选中「清爽通用简历模板」。想换别的，去右边素材库。</span></div>
                <div><b>状态</b><span>未保存。选择和版式要在编辑区里才进导出。</span></div>
                <div><b>事实</b><span>还有 1 处待确认：周更 2 篇。未全勾不能出文件。</span></div>
                <div><b>主色</b><span>现在是蓝。要改就点右边的色块，绿和灰同样能选。</span></div>
                <div><b>栏数</b><span>现在是单栏。字号、行距、页边距在「更多版式」里。</span></div>
              </div>
            </div>
            <div class="d4-side">
              <p class="d4-status">未保存</p>
              <p class="d4-warn">还有 1 处事实待你确认，确认后才能导出</p>
              <div class="d4-block">
                <div class="d4-lab">模板</div>
                <button class="d4-tpl" type="button" aria-pressed="true">清爽通用简历模板</button>
                <button class="d4-outlink" data-go="templates">去素材库看更多模板</button>
              </div>
              <div class="d4-line"><span>主色</span><div class="d4-chips" role="group" aria-label="主色"><button aria-pressed="true" data-act="seg"><i class="d4-swatch blue"></i>蓝</button><button aria-pressed="false" data-act="seg"><i class="d4-swatch green"></i>绿</button><button aria-pressed="false" data-act="seg"><i class="d4-swatch gray"></i>灰</button></div></div>
              <button class="d4-outlink d4-morebtn" type="button" id="d4LayoutMore" aria-expanded="${more ? 'true' : 'false'}">${more ? '收起版式' : '更多版式 ›'}</button>
              <div class="d4-layout" ${more ? '' : 'hidden'}>
                ${line('字号', ['紧凑', '标准', '放大'], '标准')}
                ${line('行距', ['紧凑', '标准', '舒展'], '标准')}
                ${line('页边距', ['窄', '标准', '宽'], '标准')}
                ${line('栏数', ['单栏', '双栏'], '单栏')}
              </div>
              <div class="d4-ai">
                <h3>AI 辅助调整 <span class="chip ai">AI</span></h3>
                <p>仅基于当前简历和原文做表达密度调整，不新增经历或事实</p>
                <p>导出的就是编辑区里的这一份。PDF 可以进打印确认；Word、TXT、Markdown 先保存到手机。</p>
                <div class="d4-ai-acts" style="grid-template-columns:1fr 1fr">
                  <button type="button" data-d4-ai="condense" data-act="toast" data-arg="AI 精简">AI 精简</button>
                  <button type="button" data-d4-ai="reformat" data-act="toast" data-arg="AI 调整排版">AI 调整排版</button>
                </div>
                ${undone ? '<button class="d4-outlink" type="button" id="d4Undo" data-act="toast" data-arg="撤销 AI 调整">撤销 AI 调整</button>' : ''}
              </div>
              ${more ? '' : '<div class="d4-now"><b>当前版式</b><span>字号标准 · 行距标准 · 页边距标准 · 单栏 · 主色蓝</span><span>这些收在「更多版式」里。导出的是编辑区里的这一份。</span></div>'}
            </div>
          </div>`,
        dock: { backLabel: '返回', ask: '问小青：版式怎么排', pri: { label: '去导出', id: 'd4ToExport' } }, nav: null, navAdvisor: 1
      }) + sheet;
    },
    mount: (el) => {
      const syncFact = () => {
        const box = el.querySelector('#d4FactOk');
        const go = el.querySelector('#d4FactGo');
        const why = el.querySelector('#d4FactWhy');
        if (!box || !go) return;
        go.disabled = !box.checked;
        if (why) why.hidden = box.checked;
      };
      const onClick = (e) => {
        if (e.target.closest('#d4ToExport')) {
          S().factSheet = true;
          window.__proto.refresh();
          return;
        }
        if (e.target.closest('#d4FactBack') || (e.target.classList && e.target.classList.contains('overlay'))) {
          S().factSheet = false;
          window.__proto.refresh();
          return;
        }
        if (e.target.closest('#d4FactGo')) {
          const box = el.querySelector('#d4FactOk');
          if (!box || !box.checked) return;
          S().factSheet = false;
          window.go('resume-export');
          return;
        }
        if (e.target.closest('#d4LayoutMore')) {
          S().layoutMore = !S().layoutMore;
          window.__proto.refresh();
          return;
        }
        if (e.target.closest('[data-d4-ai]')) {
          S().aiAdjusted = true;
          window.__proto.refresh();
          return;
        }
        if (e.target.closest('#d4Undo')) {
          S().aiAdjusted = false;
          window.__proto.refresh();
        }
      };
      el.addEventListener('click', onClick);
      el.addEventListener('change', syncFact);
      return () => { el.removeEventListener('click', onClick); el.removeEventListener('change', syncFact); };
    }
  });

  add('resume-export', '改简历', '导出与打印', {
    notes: {
      does: '运行页导出格式在 ResumeFormatChooser 的 FORMATS。默认是导出之前：PDF 选中，价目一句，主按钮「导出」。点导出后 S().expDone 为真，才出现回执和带走。S().expFmt 记住格式。',
      motion: '点格式只改选中。导出后重绘成已生成，不播进度。',
      keep: '选项名用运行页 PDF / DOCX / TXT / MD。说明句仍写 Word、Markdown（同一文件 16–20 行）。价目这一帧是 0 元单：「免费试运营，本单 0 元」。收费、价目停用、价目没读到时导出不可点，这一帧不画那三态。只有 PDF 出现「打印这一份」，主按钮变成「去打印这一份」（去 confirm，来源 resume）。不是 PDF 时没有打印，主按钮写「扫码带走」。未登录用 GUEST_TAKEAWAY_COPY「登录后可存我的文档，本次可扫码带走」。文件名、页数、大小是示例回执：PDF 为 2 页 · 248 KB；DOCX / TXT / MD 页数按运行页写 0。页脚「这是阅读草稿，不是简历最终稿」。带走区四句来自导出页：简历内容、文件与页数、手机取件、打印确认。'
    },
    render: () => {
      const fmt = S().expFmt || 'pdf';
      const done = S().expDone === true;
      const fmts = [
        ['pdf', 'PDF', '排版固定，打印出来就是屏幕上这样'],
        ['docx', 'DOCX', 'Word 文档，回去还能自己接着改'],
        ['txt', 'TXT', '纯文字，粘进在线表单最省事'],
        ['md', 'MD', 'Markdown，会用的人拿去二次排版']
      ];
      const file = {
        pdf: ['李佳怡-行政专员-简历.pdf', '2 页 · 248 KB', true],
        docx: ['李佳怡-行政专员-简历.docx', '页数 0 · 36 KB', false],
        txt: ['李佳怡-行政专员-简历.txt', '页数 0 · 4 KB', false],
        md: ['李佳怡-行政专员-简历.md', '页数 0 · 6 KB', false]
      }[fmt];
      const pri = !done
        ? { label: '导出', id: 'd4DoExport' }
        : (file[2]
          ? { label: '去打印这一份', go: 'confirm', arg: 'resume' }
          : { label: '扫码带走', act: 'toast', arg: '扫码带走' });
      const facts = `<div class="d4-facts">
            <div><b>简历内容</b><span>导出只做排版与文件保存，不再润色。导出不改内容，也不会再过一遍模型。</span></div>
            <div><b>文件与页数</b><span>以这次导出结果为准；未收到结果时不估算。PDF 有页数；DOCX、TXT、MD 页数 0。</span></div>
            <div><b>手机取件</b><span>真实下载链接在有效期内才显示二维码。下载链接与打印链接用途不同。</span></div>
            <div><b>打印确认</b><span>PDF 和打印链接都就绪才可进入，不会自动打印。不是 PDF 时这一格式暂不开放打印。</span></div>
          </div>`;
        return F({
        band: { kind: 'compact', eyebrow: '导出与打印', title: '要带走哪一种文件？', rail: { labels: ['上传与方向', 'AI 解析', '诊断报告', '优化打印'], now: 3 }, seal: null, place: ' ', status: { text: done ? '已生成文件' : '还没有文件' } },
        cls: 'tight d4-fill d4-ex',
        body: `<div class="d4-fmts" role="group" aria-label="导出格式">${fmts.map((f) => `<button class="d4-fmt" data-act="seg" data-d4-fmt="${f[0]}" aria-pressed="${fmt === f[0] ? 'true' : 'false'}"><b>${f[1]}</b><small>${f[2]}</small></button>`).join('')}</div>
          ${done ? '' : '<p class="d4-pricebar">免费试运营，本单 0 元</p>'}
          ${done ? `<section class="d4-out" aria-label="导出结果">
            <div class="d4-file"><b>${file[0]}</b><small>${file[1]}</small><span class="d4-price">免费试运营，本单 0 元</span></div>
            ${file[2] ? '<button id="d4Print" data-go="confirm" data-arg="resume">打印这一份</button>' : ''}
            <div class="d4-qrcell">${UI.qr(8, 148)}<button data-act="toast" data-arg="扫码带走">扫码带走</button></div>
          </section>` : ''}
          ${facts}
          ${S().logged ? '' : '<p class="d4-guest">登录后可存我的文档，本次可扫码带走</p>'}
          ${fine('这是阅读草稿，不是简历最终稿；用不用由你决定')}`,
        dock: { backLabel: '返回', ask: '问小青：导出成哪种', pri }, nav: null, navAdvisor: 1
      });
    },
    mount: (el) => {
      const onClick = (e) => {
        const fmt = e.target.closest('[data-d4-fmt]');
        if (fmt) {
          S().expFmt = fmt.dataset.d4Fmt;
          if (S().expDone) window.__proto.refresh();
        }
        if (e.target.closest('#d4DoExport')) {
          const on = el.querySelector('[data-d4-fmt][aria-pressed="true"]');
          S().expFmt = (on && on.dataset.d4Fmt) || S().expFmt || 'pdf';
          S().expDone = true;
          window.__proto.refresh();
        }
      };
      el.addEventListener('click', onClick);
      return () => el.removeEventListener('click', onClick);
    }
  });

  function moveAfter(id, afterId) {
    const list = window.SCREENS;
    const from = list.findIndex((s) => s.id === id);
    if (from < 0) return;
    const [item] = list.splice(from, 1);
    const at = list.findIndex((s) => s.id === afterId);
    list.splice(at < 0 ? list.length : at + 1, 0, item);
  }
  moveAfter('resume-direction', 'resume-src');
  moveAfter('resume-direction-more', 'resume-direction');
  moveAfter('resume-edit', 'compare');
  moveAfter('resume-export', 'resume-edit');
  if (window.SCREEN_GROUPS && !window.SCREEN_GROUPS.includes('改简历')) window.SCREEN_GROUPS.push('改简历');
})();
