/* fix-resume-1111.js：第二批补稿 · 乙路「改简历加深」（2026-11-11）。
 * 客户清单「简历优化机」六条里对不上的四条：识别亮点与不足、职位关键词优化与多模板适配、提供多方案选择、模板预览对比。
 * 产品负责人 11/11：岗位要求对照和多模板做回改简历流程里；首页仍只有四张卡；素材库页（templates）不恢复、不动。
 * 改已有屏：diagnosis、jobfit、jobfit-result、optimize、compare、resume-edit、resume-export、gen-preview。
 *   做法：包住原 render，新状态（S().b2v）走新画法；要动默认样子的，只在原 HTML 上做恰好一处的替换（不是恰好一处就 throw）。
 * 新增屏：resume-preview（看成品）、tpl-compare（模板并排对比），分组「改简历」。样式类一律 b2r-，不覆盖已有类。
 * 注意：window.S 由排在后面的 app.js 建，本文件加载时还没有，所以 mini / scanner 的默认值在读 S() 时补上。 */
(function () {
  const { icon, band, dock, nav } = UI;
  const S = () => {
    const s = window.S;
    if (s.mini === undefined) s.mini = /[?&]mini=1/.test(location.search);
    if (s.scanner === undefined) s.scanner = !/[?&]scanner=0/.test(location.search);
    return s;
  };
  const F = (o) => (o.band ? band(o.band) : '') + `<main class="body ${o.cls || ''}">${o.body}</main>` + (o.dock === false ? '' : dock(o.dock || {})) + nav(null);
  const HELP = '需要帮助？拨打服务电话 183-6916-1921';
  const QUOTA = '今天的简历类 AI 次数用完了，明天 0 点恢复';
  const RAIL = ['上传与方向', 'AI 解析', '诊断报告', '优化打印'];
  const LIST = window.SCREENS;
  const find = (id) => { const s = LIST.find((x) => x.id === id); if (!s) throw new Error('fix-resume-1111：找不到屏 ' + id); return s; };
  const once = (html, from, to, tag) => {
    const i = html.indexOf(from);
    if (i < 0 || html.indexOf(from, i + 1) >= 0) throw new Error('fix-resume-1111：「' + tag + '」的替换目标不是恰好一处');
    return html.slice(0, i) + to + html.slice(i + from.length);
  };
  const variant = (list) => { const v = S().b2v; return list.indexOf(v) >= 0 ? v : ''; };
  const refresh = () => { if (window.__proto) window.__proto.refresh(); };
  const later = (fn) => setTimeout(fn, 0);
  const on = (el, type, fn) => { el.addEventListener(type, fn); return () => el.removeEventListener(type, fn); };
  const both = (a, b) => (el) => { const x = a ? a(el) : null; const y = b ? b(el) : null; return () => { try { if (x) x(); } catch (e) { } try { if (y) y(); } catch (e) { } }; };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fine = (t) => `<p class="fine">${t}</p>`;
  const remind = (t) => `<div class="remind">${icon('call', 34, 2)}<span>${t}</span></div>`;
  const MY_KEYS = ['b2v', 'b2fitName', 'b2fitReq', 'b2fitOk', 'b2fitFlow', 'b2pick', 'b2fact', 'b2tpl', 'b2page', 'b2fit1', 'b2keep2', 'b2sel', 'b2right', 'b2who'];
  const clearMine = () => { const s = window.S; MY_KEYS.forEach((k) => { delete s[k]; }); if (s.b2ctx === 'jobfit') delete s.b2ctx; };
  const endRow = (sub) => `<div class="b2r-endrow"><button class="btn sec b2r-endbtn" data-act="clear">${icon('erase', 30, 2.2)}结束使用</button><small>${sub}</small></div>`;
  const RESUME_FILE = (window.D && D.resume && D.resume.file) || '李佳怡-简历-2026秋招.pdf';

  const css = document.createElement('style');
  css.id = 'b2r-style';
  css.textContent = `
.b2r-seg2{display:grid;grid-template-columns:1fr 1fr;gap:8px;flex:none}
.b2r-seg2 button{min-height:64px;border-radius:18px;background:var(--card);border:1.5px solid var(--edge);font-size:22px;font-weight:700;color:var(--ink-2)}
.b2r-seg2 button[aria-selected="true"]{background:var(--deep);border-color:var(--deep);color:var(--cream)}
.d4-card.b2r-good b{display:flex;align-items:center;gap:8px;font-size:24px}
.d4-card.b2r-good b .i{color:var(--teal);flex:none}
.d4-card.b2r-good p{margin-top:6px;font-size:22px;line-height:1.4}
.b2r-hie{display:flex;flex-direction:column;gap:10px;flex:1;min-height:0;justify-content:center}
.b2r-hie-msg{margin:0;display:flex;gap:14px;align-items:flex-start;padding:16px 18px;border-radius:22px;background:var(--well);font-size:24px;line-height:1.5;font-weight:600;color:var(--ink-2);text-align:left}
.b2r-hie-msg .i{flex:none;color:var(--teal-ink);margin-top:4px}
.b2r-hie-k{margin:6px 0 0;font-size:22px;font-weight:700;text-align:left}
.b2r-hie-row{display:flex;align-items:center;gap:12px;min-height:76px;padding:8px 14px;border-radius:18px;background:var(--card);border:1.5px solid var(--edge);text-align:left}
.b2r-hie-row i{font-style:normal;width:40px;height:40px;border-radius:50%;background:var(--clay);color:#fff;display:grid;place-items:center;font-weight:700;font-size:20px;flex:none}
.b2r-hie-row b{font-size:24px}
.b2r-hie-row small{margin-left:auto;font-size:20px;color:var(--ink-3)}
.b2r-hie-go{min-height:88px;border-radius:22px;background:var(--deep);color:var(--cream);font-size:26px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:10px}
.body.d4-diag.b2r-out{gap:10px}
.body.d4-diag.b2r-out .d4-take{min-height:0;padding:6px 12px}
.b2r-endrow{flex:none;display:flex;align-items:center;gap:16px;min-height:72px}
.b2r-endrow .b2r-endbtn{height:72px;font-size:24px;border-radius:22px;padding:0 24px;gap:10px}
.b2r-endrow small{flex:1;min-width:0;font-size:20px;line-height:1.4;color:var(--ink-3);text-align:left}
.body.b2r-fit{justify-content:space-between;gap:14px;padding-top:18px;padding-bottom:14px}
.b2r-field{display:flex;flex-direction:column;gap:8px;min-height:150px;width:100%;padding:18px 24px;border-radius:26px;background:var(--card);border:2px solid rgba(31,158,134,.55);box-shadow:0 0 0 6px rgba(31,158,134,.08);text-align:left;justify-content:center}
.b2r-fl{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.b2r-fl b{font-size:26px}
.b2r-fl small{font-size:20px;color:var(--ink-3)}
.b2r-must,.b2r-optl{font-style:normal;display:inline-flex;align-items:center;height:34px;padding:0 12px;border-radius:17px;font-size:20px;font-weight:700}
.b2r-must{background:var(--clay-wash);color:var(--clay-ink)}
.b2r-optl{background:var(--well);color:var(--ink-2)}
.b2r-fv{font:700 36px/1.3 var(--serif);color:var(--ink)}
.b2r-fv.b2r-ph{font:500 26px/1.3 var(--sans);color:var(--ink-3)}
.b2r-req{display:flex;flex-direction:column;gap:12px;padding:18px 20px;border-radius:26px;background:var(--card);border:1.5px solid var(--edge);text-align:left}
.b2r-ways{display:grid;grid-template-columns:1.12fr 1fr;gap:12px}
.b2r-way{display:flex;align-items:center;gap:16px;min-height:184px;padding:14px 18px;border-radius:22px;background:var(--well);text-align:left}
.b2r-way.b2r-main{background:var(--teal-wash);color:var(--teal-ink)}
.b2r-way b{display:block;font:700 32px/1.25 var(--serif)}
.b2r-way small{display:block;margin-top:6px;font-size:21px;line-height:1.4;color:var(--ink-2)}
.b2r-wv{flex:none;width:96px;display:grid;place-items:center;color:var(--ink-2)}
.b2r-nomust{margin:0;display:flex;align-items:center;gap:10px;font-size:22px;line-height:1.4;color:var(--teal-ink);font-weight:700}
.b2r-reqtx{display:flex;flex-direction:column;gap:4px;padding:12px 18px;border-radius:18px;background:var(--well)}
.b2r-reqtx p{margin:0;font-size:23px;line-height:1.5;color:var(--ink)}
.b2r-mini{margin-left:auto;min-height:64px;min-width:120px;padding:0 18px;border-radius:18px;background:var(--well);font-size:22px;font-weight:700;color:var(--teal-ink)}
.b2r-consent{display:flex;align-items:center;gap:16px;min-height:96px;padding:0 22px;border-radius:24px;background:var(--teal-wash);color:var(--teal-ink);font-size:27px;font-weight:700;cursor:pointer;text-align:left}
.b2r-consent input{appearance:none;-webkit-appearance:none;width:64px;height:64px;margin:0;flex:none;border:2px solid var(--teal-ink);border-radius:14px;background:#fff;display:grid;place-items:center;cursor:pointer}
.b2r-consent input:checked{background:var(--deep);border-color:var(--deep)}
.b2r-consent input:checked::after{content:"";width:18px;height:10px;border-left:4px solid #fff;border-bottom:4px solid #fff;transform:rotate(-45deg) translate(2px,-3px)}
.b2r-why{margin:0;min-height:64px;display:flex;align-items:center;gap:12px;padding:8px 20px;border-radius:18px;background:var(--clay-wash);color:var(--clay-ink);font-size:22px;font-weight:700;line-height:1.4;text-align:left}
.b2r-why.ok{background:var(--teal-wash);color:var(--teal-ink)}
.b2r-why .i{flex:none}
.filecard.b2r-file{min-height:0;padding:16px 24px;gap:20px}
.filecard.b2r-file .ft{width:68px;height:84px}
.filecard.b2r-file b{font-size:26px}
.filecard.b2r-file small{display:block;font-size:21px}
.filecard.b2r-file .chip{margin-left:auto}
.b2r-take{display:flex;align-items:center;gap:28px;padding:18px 26px;border-radius:26px;background:var(--well);text-align:left}
.b2r-take .tx{display:flex;flex-direction:column;gap:6px}
.b2r-take small{font-size:21px;color:var(--teal-ink);font-weight:700}
.b2r-take b{font:700 34px/1.3 var(--serif)}
.b2r-take span{font-size:23px;line-height:1.45;color:var(--ink-2)}
.b2r-reqs{display:flex;flex-direction:column;gap:10px;text-align:left}
.b2r-reqs .b2r-rh{display:flex;align-items:center;gap:12px;font-size:24px;font-weight:700}
.b2r-reqs .b2r-rh .chip{margin-left:auto}
.b2r-fit .livebox{min-height:132px}
.b2r-fit .livebox b{font-size:30px}
.b2r-fit .livebox small{font-size:22px}
.b2r-hold{display:flex;align-items:center;gap:16px;min-height:100px;padding:10px 20px;border-radius:22px;background:var(--well);border:1.5px dashed var(--edge);font-size:23px;line-height:1.45;color:var(--ink-2)}
.b2r-hold i{font-style:normal;width:44px;height:44px;border-radius:50%;background:var(--card);border:1.5px solid var(--edge);display:grid;place-items:center;font-weight:700;font-size:21px;flex:none;color:var(--ink-3)}
.b2r-self .st3-check{min-height:64px;align-items:center}
.body.d4-opt.b2r-fit2 .d4-row{min-height:150px}
.b2r-fitbar{display:flex;align-items:center;gap:16px;min-height:88px;padding:12px 22px;border-radius:24px;background:var(--teal-wash);color:var(--teal-ink);font-size:24px;font-weight:700;line-height:1.45;text-align:left;flex:none}
.b2r-fitbar .i{flex:none}
.b2r-fitchip{display:inline-flex;align-items:center;height:36px;padding:0 12px;margin-left:12px;border-radius:18px;background:var(--slate-wash);color:var(--slate-ink);font-size:20px;font-weight:700;vertical-align:3px}
.b2r-nofake{margin:0;flex:none;display:flex;align-items:center;gap:12px;min-height:64px;padding:8px 18px;border-radius:20px;background:var(--teal-wash);color:var(--teal-ink);font-size:22px;font-weight:700;line-height:1.4;text-align:left}
.b2r-nofake .i{flex:none}
.b2r-orig{gap:6px}
.b2r-alts{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.b2r-alt{gap:8px}
.body.d4-cmp .b2r-alt p{font-size:26px;line-height:1.45;word-break:keep-all}
.b2r-alt .b2r-m{font-size:20px;color:var(--ink-3)}
.b2r-alt.on{border:2px solid var(--teal);box-shadow:0 0 0 5px rgba(31,158,134,.12)}
.b2r-alt .d4-fact{margin-top:auto;min-height:72px;padding:0 12px;font-size:22px}
.b2r-wait{display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:26px;border:1.5px dashed var(--edge);background:var(--well)}
.b2r-waitbar{display:flex;align-items:center;gap:14px;min-height:64px;padding:0 8px;text-align:left}
.b2r-waitbar b{font-size:28px}
.b2r-waitbar small{margin-left:auto;font-size:21px;color:var(--ink-3)}
.b2r-spin.b2r-dk{border-color:var(--teal-wash);border-top-color:var(--teal)}
.b2r-holdalt{background:var(--card);border-style:dashed;gap:12px}
.b2r-holdalt b{color:var(--ink-3)}
.b2r-regen{display:flex;align-items:center;gap:16px;min-height:96px;padding:10px 12px 10px 22px;border-radius:24px;background:var(--well);text-align:left}
.b2r-regen.warn{background:var(--clay-wash);color:var(--clay-ink)}
.b2r-regen>div{flex:1;min-width:0}
.b2r-regen b{display:block;font-size:24px;line-height:1.35}
.b2r-regen small{display:block;font-size:20px;line-height:1.35;color:var(--ink-3)}
.b2r-regen.warn small{color:var(--clay-ink)}
.b2r-regen .btn{height:72px;font-size:24px;border-radius:22px;padding:0 22px}
.d4-custom.b2r-own{padding:12px 16px;gap:8px}
.d4-custom.b2r-own .d4-ta{min-height:88px}
.b2r-cap{display:flex;align-items:center;justify-content:center;gap:18px;width:100%;flex:none}
.body.d4-ed .d4-sheet svg.b2r-art{max-height:56%}
.body.d4-ed .d4-sheet .b2r-see svg{width:30px;height:30px;max-height:none}
.b2r-see{display:inline-flex;align-items:center;gap:10px;min-height:72px;padding:0 26px;border-radius:22px;background:var(--deep);color:var(--cream);font-size:26px;font-weight:700;white-space:nowrap}
.b2r-tpls{display:flex;flex-direction:column;gap:8px}
.b2r-tpl{display:flex;align-items:center;gap:12px;min-height:112px;width:100%;padding:6px 10px;border-radius:20px;background:var(--card);border:1.5px solid var(--edge);text-align:left}
.b2r-tpl[aria-pressed="true"]{border-color:var(--teal);background:var(--teal-wash);box-shadow:inset 0 0 0 2px var(--teal)}
.b2r-tart{position:relative;flex:none;width:72px;display:grid;place-items:center}
.b2r-tart .b2r-tick{position:absolute;right:-8px;bottom:-6px;width:34px;height:34px;box-shadow:0 0 0 3px var(--teal-wash)}
.b2r-ttx{flex:1;min-width:0}
.b2r-ttx b{display:block;font-size:24px;line-height:1.3}
.b2r-ttx small{display:block;font-size:20px;line-height:1.3;color:var(--ink-2)}
.b2r-tick{width:40px;height:40px;border-radius:50%;background:var(--teal);color:#fff;display:grid;place-items:center;flex:none;visibility:hidden}
[aria-pressed="true"] .b2r-tick,.b2r-tcard.on .b2r-tick{visibility:visible}
.b2r-tpls3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.b2r-tpl.b2r-tplc{flex-direction:column;justify-content:center;gap:6px;min-height:0;padding:8px 4px}
.b2r-tplc .b2r-tart{width:auto}
.b2r-tplc .b2r-tart .b2r-tick{width:28px;height:28px;right:-10px;bottom:-4px}
.b2r-tplc b{font-size:20px;line-height:1.3}
.b2r-pv .b2r-errbox .btns{display:flex;gap:14px}
.b2r-pv .b2r-errbox .btn{min-width:200px}
.b2r-hint.b2r-warn{background:var(--clay-wash);border-color:transparent;color:var(--clay-ink)}
.b2r-hint.b2r-warn .b2r-ht small{color:var(--clay-ink)}
.body.b2r-pv{justify-content:space-between;gap:12px;padding:14px 40px 12px}
.b2r-tagbar{display:flex;align-items:center;gap:10px;flex:none}
.b2r-tagk{font-size:22px;font-weight:700;color:var(--ink-3);margin-right:2px}
.b2r-tag{display:inline-flex;align-items:center;gap:8px;min-height:64px;padding:0 20px;border-radius:32px;background:var(--card);border:1.5px solid var(--edge);font-size:24px;font-weight:700;color:var(--ink)}
.b2r-tag.on{background:var(--deep);border-color:var(--deep);color:var(--cream)}
.b2r-cmplink{margin-left:auto;display:inline-flex;align-items:center;gap:8px;min-height:64px;padding:0 18px;border-radius:20px;background:var(--well);font-size:22px;font-weight:700;color:var(--teal-ink)}
.b2r-pgrow{display:flex;align-items:center;justify-content:center;gap:22px;flex:none}
.b2r-page{margin:0;position:relative;flex:none;line-height:0;border-radius:6px;overflow:hidden;background:#fff;box-shadow:0 14px 34px rgba(11,36,30,.14),0 0 0 1.5px var(--edge)}
.b2r-flip{width:96px;height:96px;border-radius:50%;background:var(--card);border:1.5px solid var(--edge);display:grid;place-items:center;color:var(--ink);flex:none}
.b2r-flip.off{opacity:.32}
.b2r-pgno{margin:0;flex:none;text-align:center;font-size:24px;font-weight:700;color:var(--ink-2)}
.b2r-hint{display:flex;align-items:center;gap:16px;min-height:104px;padding:12px 14px 12px 26px;border-radius:26px;background:var(--card);border:1.5px solid var(--edge);flex:none}
.b2r-hint.ok{background:var(--teal-wash);border-color:transparent;color:var(--teal-ink)}
.b2r-ht{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;text-align:left}
.b2r-ht b{font:700 30px/1.3 var(--serif);display:flex;align-items:center;gap:8px}
.b2r-ht small{font-size:21px;line-height:1.4;color:var(--ink-3)}
.b2r-hint.ok .b2r-ht small{color:var(--teal-ink)}
.b2r-opts{display:flex;gap:10px;flex:none}
.b2r-opts button{width:258px;min-height:100px;padding:10px 18px;border-radius:22px;background:var(--well);text-align:left}
.b2r-opts button b{display:block;font-size:26px}
.b2r-opts button small{display:block;margin-top:2px;font-size:20px;line-height:1.35;color:var(--ink-2)}
.b2r-opts button.b2r-dark{background:var(--deep);color:var(--cream)}
.b2r-opts button.b2r-dark small{color:var(--mint)}
.b2r-opts button[aria-pressed="true"]{background:var(--teal-wash);box-shadow:inset 0 0 0 3px var(--teal)}
.b2r-phtag{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:inline-flex;align-items:center;gap:12px;padding:16px 26px;border-radius:999px;background:rgba(11,36,30,.86);color:var(--cream);font-size:24px;font-weight:700;line-height:1;white-space:nowrap}
.b2r-spin{width:32px;height:32px;border-radius:50%;border:4px solid rgba(255,255,255,.25);border-top-color:var(--glow);animation:spin 1s linear infinite;flex:none}
.body.b2r-tc{justify-content:space-between;gap:12px;padding:14px 36px 12px}
.b2r-tcs{display:grid;grid-template-columns:1fr 1fr;gap:14px;flex:none}
.b2r-tcard{display:flex;flex-direction:column;gap:8px;padding:4px 4px 10px;border-radius:22px;background:var(--card);border:2px solid var(--edge);text-align:left;position:relative}
.b2r-tcard.on{border-color:var(--teal);box-shadow:0 0 0 3px var(--teal),0 0 0 9px rgba(31,158,134,.16)}
.b2r-tthumb{position:relative;display:block;line-height:0;border-radius:16px;overflow:hidden;box-shadow:0 0 0 1.5px var(--edge)}
.b2r-tcap{display:flex;align-items:center;gap:10px;padding:2px 10px}
.b2r-tcap b{display:block;font:700 30px/1.3 var(--serif)}
.b2r-tcap small{display:block;font-size:21px;color:var(--ink-3)}
.b2r-tcap .b2r-tick{margin-left:auto}
.b2r-errbox{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:28px;background:rgba(255,253,247,.95);line-height:1.4;text-align:center;color:var(--clay-ink)}
.b2r-errbox b{font-size:28px;color:var(--ink)}
.b2r-errbox small{font-size:22px;color:var(--ink-2)}
.b2r-errbox .btn{height:80px;font-size:26px}
.b2r-diff{display:grid;grid-template-columns:170px 1fr 1fr;border-radius:22px;background:var(--card);border:1.5px solid var(--edge);overflow:hidden;flex:none}
.b2r-diff>*{min-height:58px;display:flex;align-items:center;padding:6px 18px;border-top:1px solid var(--line);font-size:23px;font-weight:700;text-align:left}
.b2r-diff>.h{border-top:0;background:var(--well)}
.b2r-diff>.k{font-size:21px;font-weight:500;color:var(--ink-3)}
.b2r-swap{display:flex;align-items:center;gap:10px;flex:none}
.b2r-swk{font-size:22px;font-weight:700;color:var(--ink-3);margin-right:4px;white-space:nowrap}
.b2r-sw{flex:1;min-height:80px;border-radius:20px;background:var(--card);border:1.5px solid var(--edge);font-size:24px;font-weight:700;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;line-height:1.3}
.b2r-sw[aria-pressed="true"]{background:var(--deep);border-color:var(--deep);color:var(--cream)}
.b2r-sw.off{background:var(--well);border-style:dashed;color:var(--ink-3)}
.b2r-sw small{font-size:20px;font-weight:500}
.b2r-seg2 button:active,.b2r-hie-go:active,.b2r-field:active,.b2r-way:active,.b2r-mini:active,.b2r-tpl:active,.b2r-see:active,.b2r-tag:active,.b2r-cmplink:active,.b2r-flip:active,.b2r-opts button:active,.b2r-tcard:active,.b2r-sw:active{transform:scale(.98)}
`;
  document.head.appendChild(css);

  /* ── 三套版式：名字和一句话照素材库 TPLS（fix-resume2.js）起过的名字 ── */
  const TPL = {
    clean: { name: '清爽单栏', desc: '单栏，经历不长时比较好读', cols: '单栏', contact: '顶部，姓名下面' },
    left: { name: '左栏信息', desc: '双栏，联系方式放在左栏', cols: '双栏', contact: '左栏' },
    formal: { name: '正式单栏', desc: '单栏，经历比较多时用', cols: '单栏', contact: '顶部，居中' }
  };
  const TPL_KEYS = ['clean', 'left', 'formal'];
  const V2T = { tpl2: 'left', tpl3: 'formal' };
  const T2V = { clean: '', left: 'tpl2', formal: 'tpl3' };
  const curTpl = () => V2T[S().b2v] || (TPL[S().b2tpl] ? S().b2tpl : 'clean');

  /* 版式小样：只用色块线条，不放真实文字（编辑页的模板小卡和左边示意图）。 */
  function art(k, w) {
    const h = Math.round(w * 1.414);
    const INK = '#13231e', TEAL = '#1f9e86', GRAY = '#d9ded9', SUB = '#b9c3bf';
    const r = (x, y, ww, hh, c, rr) => `<rect x="${x}" y="${y}" width="${ww}" height="${hh}" rx="${rr === undefined ? 0.8 : rr}" fill="${c}"/>`;
    const L = (x, y, ws) => ws.map((ww, i) => r(x, y + i * 4.4, ww, 1.6, GRAY)).join('');
    let s = `<svg class="illus paper-shadow b2r-art" width="${w}" height="${h}" viewBox="0 0 100 141.4" aria-hidden="true"><rect width="100" height="141.4" rx="4" fill="#fff"/>`;
    if (k === 'left') {
      s += '<path d="M4 0H33V141.4H4Q0 141.4 0 137.4V4Q0 0 4 0Z" fill="#e2efe9"/>';
      s += r(5, 9, 22, 4.6, INK) + r(5, 16, 17, 1.8, TEAL);
      s += r(5, 26, 11, 2.2, TEAL) + L(5, 31.5, [21, 19, 15]);
      s += r(5, 48, 11, 2.2, TEAL) + [0, 1, 2, 3].map((i) => r(5 + (i % 2) * 11.5, 53.5 + Math.floor(i / 2) * 5.2, 10, 3.6, '#c4dbd1', 1.8)).join('');
      s += r(5, 70, 11, 2.2, TEAL) + L(5, 75.5, [22, 18, 20]);
      [[9, [54, 46, 51, 40]], [37, [54, 48, 52, 44, 38]], [69, [54, 46, 50, 42]], [97, [52, 47, 54]], [119, [50, 44]]].forEach(([y, ws]) => { s += r(38, y, 18, 2.6, TEAL) + L(38, y + 6, ws); });
    } else if (k === 'formal') {
      s += r(30, 9, 40, 5, INK) + r(24, 17, 52, 1.8, SUB) + r(9, 23, 82, 0.9, INK, 0) + r(9, 25, 82, 0.4, INK, 0);
      [[31, [64, 82, 74, 78]], [62, [64, 80, 70, 76]], [93, [64, 78, 72]], [119, [64, 70]]].forEach(([y, ws]) => { s += r(9, y, 17, 2.6, INK) + r(9, y + 4.3, 82, 0.5, INK, 0) + r(79, y + 7, 12, 1.6, SUB) + L(9, y + 7, ws); });
    } else {
      s += r(9, 9, 36, 5, INK) + r(9, 17, 50, 1.8, SUB);
      [[27, [82, 70, 78, 60, 74]], [60, [82, 72, 78, 64, 70]], [93, [82, 70, 76, 62]], [119, [80, 66, 72]]].forEach(([y, ws]) => { s += r(9, y, 20, 2.6, TEAL) + L(9, y + 6, ws); });
    }
    return s + '</svg>';
  }

  /* ── 成品页：同一份内容按模板排进 A4（viewBox 640×905），有标题、分区、正文。排不下就换页，页数是排出来的。 ── */
  const PW = 640, PH = 905;
  const ACC = '#3f68b0', INKC = '#13231e', BODY = '#33443e', GRC = '#5b6963', RULE = '#d3dae6';
  const SERIF = "'Noto Serif SC','Songti SC','STSong',serif";
  const chW = (ch, fs) => (/[\x00-\xff]/.test(ch) ? fs * 0.56 : fs);
  const tw = (s, fs) => { let w = 0; for (const ch of s) w += chW(ch, fs); return w; };
  function wrapT(s, fs, max) {
    const out = []; let line = '', w = 0;
    for (const ch of s) {
      const c = chW(ch, fs);
      if (w + c > max && line) {
        if (/[，。、；：）」』]/.test(ch)) { out.push(line + ch); line = ''; w = 0; continue; }
        const open = /[（「『]$/.test(line) ? line.slice(-1) : '';
        out.push(open ? line.slice(0, -1) : line); line = open + ch; w = tw(line, fs);
      } else { line += ch; w += c; }
    }
    if (line) out.push(line);
    return out;
  }
  const tx = (x, y, s, fs, o) => { o = o || {}; return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${fs}" fill="${o.c || BODY}"${o.b ? ' font-weight="700"' : ''}${o.a ? ` text-anchor="${o.a}"` : ''}${o.f ? ` font-family="${o.f}"` : ''}${o.ls ? ` letter-spacing="${o.ls}"` : ''}>${esc(s)}</text>`; };
  const hl = (x1, y, x2, c, sw) => `<line x1="${x1.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${c}" stroke-width="${sw}"/>`;
  const who = () => (S().b2who === 'gen'
    ? { name: '周宁', job: '内容运营', phone: '138****6217', mail: 'ning.zhou@foxmail.com' }
    : { name: '李佳怡', job: '新媒体运营', phone: '138****6721', mail: 'lijiayi@foxmail.com' });
  const SECS = {
    sum: { t: '个人总结', lines: ['性格开朗，学习能力强。'] },
    edu: { t: '教育经历', items: [{ h: '青岛大学 · 汉语言文学 · 本科', d: '2022.09 – 2026.06', lines: ['主修课程：新闻写作、现代汉语、传播学概论、新媒体概论'] }] },
    work: { t: '工作 / 实习经历', items: [
      { h: '青岛海禾文化传媒 · 新媒体实习生', d: '2025.07 – 2025.09', lines: ['参与公众号推文的选题和撰写，配合编辑完成排版与发布。', '用剪映剪辑活动现场短视频，配合账号日常更新。'] },
      { h: '学院公众号 · 运营负责人', d: '2023.09 – 至今', lines: ['负责学院公众号的选题、撰写与排版工作。'] }] },
    proj: { t: '项目经历', items: [
      { h: '学院新闻中心 · 学生记者', d: '2022.10 – 2023.06', lines: ['采写学院活动新闻稿，参与校园活动的现场拍摄。'] },
      { h: '迎新志愿服务 · 志愿者', d: '2024.09', lines: ['参与迎新志愿服务。'] }] },
    skill: { t: '技能', lines: ['熟悉办公软件，会用剪映。'] },
    cert: { t: '证书', lines: ['普通话二级甲等（2023）', '全国计算机等级考试二级（2023）', '大学英语四级（2023）'] }
  };
  const ORDER = { clean: ['sum', 'edu', 'work', 'proj', 'skill', 'cert'], formal: ['sum', 'work', 'proj', 'edu', 'skill', 'cert'] };
  function singleCol(k, compact) {
    const P = compact ? { top: 44, mx: 46, bot: 44, gap: 14, hd: 30, lh: 22, eg: 6 } : { top: 56, mx: 52, bot: 60, gap: 22, hd: 34, lh: 25, eg: 8 };
    const formal = k === 'formal', p = who();
    const pages = [[]], rows = [0];
    const X0 = P.mx, X1 = PW - P.mx, MAXW = X1 - X0;
    const put = (s, row) => { pages[pages.length - 1].push(s); if (row) rows[rows.length - 1] += 1; };
    let y;
    if (formal) {
      put(tx(PW / 2, P.top + 30, p.name, 32, { b: 1, c: INKC, a: 'middle', f: SERIF, ls: 6 }));
      put(tx(PW / 2, P.top + 58, `求职意向：${p.job} · 青岛`, 14.5, { a: 'middle', c: INKC }));
      put(tx(PW / 2, P.top + 80, `${p.phone}  |  ${p.mail}`, 13.5, { a: 'middle', c: GRC }));
      put(hl(X0, P.top + 95, X1, INKC, 1.6) + hl(X0, P.top + 99, X1, INKC, 0.6));
      y = P.top + 100;
    } else {
      put(tx(X0, P.top + 30, p.name, 34, { b: 1, c: INKC }));
      put(tx(X0, P.top + 58, `求职意向：${p.job} · 青岛`, 15, { b: 1, c: ACC }));
      put(tx(X0, P.top + 80, `${p.phone}  ·  ${p.mail}`, 13.5, { c: GRC }));
      put(`<rect x="${X0}" y="${P.top + 93}" width="${MAXW}" height="3" rx="1.5" fill="${ACC}"/>`);
      y = P.top + 96;
    }
    const room = (hh) => y + hh <= PH - P.bot;
    const brk = () => { pages.push([]); rows.push(0); y = P.top; };
    ORDER[k].forEach((key) => {
      const sec = SECS[key];
      y += P.gap;
      if (!room(P.hd + P.lh * (sec.items ? 2 : 1))) brk();
      if (formal) { put(tx(X0, y + 17, sec.t, 16, { b: 1, c: INKC, ls: 2 }), 1); put(hl(X0, y + 25, X1, INKC, 0.8)); }
      else { put(tx(X0, y + 17, sec.t, 17, { b: 1, c: ACC }), 1); put(hl(X0 + tw(sec.t, 17) + 12, y + 11, X1, RULE, 1)); }
      y += P.hd;
      if (sec.items) {
        sec.items.forEach((it, i) => {
          if (i) y += P.eg;
          if (!room(P.lh * 2)) brk();
          put(tx(X0, y + 17, it.h, 15, { b: 1, c: INKC }), 1);
          put(tx(X1, y + 17, it.d, 13, { a: 'end', c: GRC }));
          y += P.lh;
          it.lines.forEach((t) => wrapT(t, 14.5, MAXW - 14).forEach((l, j) => {
            if (!room(P.lh)) brk();
            if (!j) put(tx(X0 + 2, y + 17, '·', 14.5, { c: GRC }));
            put(tx(X0 + 14, y + 17, l, 14.5), 1);
            y += P.lh;
          }));
        });
      } else {
        sec.lines.forEach((t) => wrapT(t, 14.5, MAXW).forEach((l) => { if (!room(P.lh)) brk(); put(tx(X0, y + 17, l, 14.5), 1); y += P.lh; }));
      }
    });
    return { pages, rows };
  }
  function leftCol() {
    const p = who(), out = [], SW = 206, top = 56;
    out.push(`<rect x="0" y="0" width="${SW}" height="${PH}" fill="#edf1f8"/>`);
    let y = top;
    out.push(tx(26, y + 30, p.name, 30, { b: 1, c: INKC })); y += 46;
    out.push(tx(26, y + 16, p.job, 15, { b: 1, c: ACC })); y += 30;
    const side = (title, lines) => {
      y += 16;
      out.push(tx(26, y + 15, title, 15.5, { b: 1, c: ACC }));
      out.push(hl(26, y + 24, SW - 22, '#c9d4e8', 1));
      y += 34;
      lines.forEach((t) => wrapT(t, 13.5, SW - 40).forEach((l) => { out.push(tx(26, y + 15, l, 13.5)); y += 22; }));
    };
    side('联系方式', [p.phone, p.mail, '青岛']);
    side('技能', SECS.skill.lines);
    side('证书', SECS.cert.lines);
    const X0 = SW + 30, X1 = PW - 44, MAXW = X1 - X0;
    y = top;
    ['edu', 'work', 'proj', 'sum'].forEach((key, si) => {
      const sec = SECS[key];
      if (si) y += 20;
      out.push(tx(X0, y + 17, sec.t, 17, { b: 1, c: ACC }));
      out.push(hl(X0 + tw(sec.t, 17) + 12, y + 11, X1, RULE, 1));
      y += 34;
      if (sec.items) {
        sec.items.forEach((it, i) => {
          if (i) y += 8;
          out.push(tx(X0, y + 17, it.h, 15, { b: 1, c: INKC })); y += 23;
          out.push(tx(X0, y + 15, it.d, 13, { c: GRC })); y += 22;
          it.lines.forEach((t) => wrapT(t, 14.5, MAXW - 14).forEach((l, j) => { if (!j) out.push(tx(X0 + 2, y + 17, '·', 14.5, { c: GRC })); out.push(tx(X0 + 14, y + 17, l, 14.5)); y += 24; }));
        });
      } else {
        sec.lines.forEach((t) => wrapT(t, 14.5, MAXW).forEach((l) => { out.push(tx(X0, y + 17, l, 14.5)); y += 24; }));
      }
    });
    return { pages: [out], rows: [0] };
  }
  const laid = (k, compact) => (k === 'left' ? leftCol() : singleCol(k, compact));
  const pageSvg = (k, n, w, compact) => {
    const L = laid(k, compact);
    return `<svg class="b2r-paper" width="${w}" height="${Math.round(w * PH / PW)}" viewBox="0 0 ${PW} ${PH}" role="img" aria-label="${TPL[k].name}成品第 ${n} 页"><rect width="${PW}" height="${PH}" fill="#fff"/>${(L.pages[n - 1] || []).join('')}</svg>`;
  };
  const skeleton = (w) => {
    const bars = [[52, 56, 200, 26, '#e6eae7'], [52, 98, 300, 12, '#eef1ee'], [52, 122, 260, 10, '#eef1ee'], [52, 146, 536, 3, '#e6eae7']];
    for (let i = 0; i < 6; i++) {
      const y = 186 + i * 112;
      bars.push([52, y, 110, 14, '#e3e8f1']);
      [536, 470, 510, 420].slice(0, i % 2 ? 3 : 4).forEach((ww, j) => bars.push([52, y + 30 + j * 20, ww, 9, '#eef1ee']));
    }
    return `<svg width="${w}" height="${Math.round(w * PH / PW)}" viewBox="0 0 ${PW} ${PH}" aria-hidden="true"><rect width="${PW}" height="${PH}" fill="#fff"/>${bars.map((b) => `<rect x="${b[0]}" y="${b[1]}" width="${b[2]}" height="${b[3]}" rx="4" fill="${b[4]}"/>`).join('')}</svg>`;
  };
  const blankPaper = (w) => `<svg width="${w}" height="${Math.round(w * PH / PW)}" viewBox="0 0 ${PW} ${PH}" aria-hidden="true"><rect width="${PW}" height="${PH}" fill="#fff"/><rect x="52" y="56" width="536" height="793" rx="10" fill="none" stroke="#e3e8e5" stroke-width="3" stroke-dasharray="14 12"/></svg>`;

  /* ══════════ 1. diagnosis：先改这几处 | 做得好的；对照岗位要求；已登录时结束使用 ══════════ */
  const DG = find('diagnosis');
  const dgRender = DG.render, dgMount = DG.mount, dgKeep = (DG.notes && DG.notes.keep) || '';
  const GOOD = [
    ['经历里有具体产出', '负责学院公众号的选题、撰写和排版。', '招聘的人能看出你做过整套流程。'],
    ['技能写的是具体工具', '会用剪映', '比「熟悉办公软件」这类说法更容易被注意到。'],
    ['基础信息齐全好找', '姓名、手机、邮箱、求职意向都在第一屏', '不用翻页就能联系到你。']
  ];
  const FIX3 = [['工作经历', '成果量化程度'], ['求职目标', '求职目标清晰度'], ['项目经历', '经历表达清晰度']];
  const seg2 = (fix, nGood) => `<div class="b2r-seg2" role="tablist" aria-label="要改的，还是做得好的"><button role="tab" data-b2seg="fix" aria-selected="${fix}">要改的 4 处</button><button role="tab" data-b2seg="hi" aria-selected="${!fix}">做得好的 ${nGood} 处</button></div>`;
  DG.render = () => {
    const v = variant(['hi', 'hi-empty']);
    let h = dgRender();
    const head = '<div class="d4-h">先改这几处<small>最多 3 条</small></div>';
    if (!v) h = once(h, head, seg2(true, 3), 'diagnosis 先改这几处');
    else {
      const start = '<section class="d4-prios" aria-label="先改这几处">';
      const i = h.indexOf(start);
      if (i < 0 || h.indexOf(start, i + 1) >= 0) throw new Error('fix-resume-1111：「diagnosis 先改这几处一栏」的替换目标不是恰好一处');
      const j = h.indexOf('</section>', i);
      const inner = v === 'hi'
        ? seg2(false, 3) + GOOD.map((g) => `<article class="d4-card b2r-good"><b>${icon('check', 26, 2.8)}${g[0]}</b><p><u>依据</u>「${g[1]}」</p><p><u>为什么算</u>${g[2]}</p></article>`).join('')
        : seg2(false, 0) + `<div class="b2r-hie"><p class="b2r-hie-msg">${icon('sparkle', 32, 2)}<span>这份简历里暂时没有可以单独点名的地方。先把要改的几处改了，再诊断一次看看。</span></p>
            <p class="b2r-hie-k">先改这几处</p>${FIX3.map((f, n) => `<div class="b2r-hie-row"><i>${n + 1}</i><b>${f[0]}</b><small>${f[1]}</small></div>`).join('')}
            <button class="b2r-hie-go" data-b2seg="fix">看要改的 4 处${icon('arrowR', 30, 2.4)}</button></div>`;
      h = h.slice(0, i) + `<section class="d4-prios" aria-label="${v === 'hi' ? '做得好的' : '做得好的（0 处）'}">` + inner + h.slice(j);
    }
    h = once(h, '<button data-go="jobfit">简历对照</button>', '<button data-go="jobfit" data-set="b2v=input">对照岗位要求</button>', 'diagnosis 简历对照');
    if (S().logged) {
      h = once(h, '<main class="body tight d4-fill d4-diag">', '<main class="body tight d4-fill d4-diag b2r-out">', 'diagnosis 正文');
      h = once(h, '</main>', endRow('退出登录，并清掉这台机器上这一次的内容。这份报告已记在你的账号里。') + '</main>', 'diagnosis 结束使用');
    }
    return h;
  };
  DG.mount = both((el) => on(el, 'click', (e) => {
    if (e.target.closest('[data-act="clear"]')) { clearMine(); return; }
    const b = e.target.closest('[data-b2seg]');
    if (!b || !el.contains(b)) return;
    const cur = S().b2v;
    S().b2v = b.dataset.b2seg === 'fix' ? '' : (cur === 'hi-empty' ? 'hi-empty' : 'hi');
    refresh();
  }), dgMount);
  DG.name += '（第二批补稿）';
  DG.notes = {
    does: '「先改这几处」的标题位置换成两段切换「要改的 4 处」|「做得好的 3 处」，默认停在「要改的」，下面三张卡照原稿。切到「做得好的」（S().b2v=hi）列三条亮点：一句亮点、依据（引原文）、为什么算；为 0 时（hi-empty）写明暂时没有，列出先改的三条并给「看要改的 4 处」。「简历对照」改名「对照岗位要求」，带着这份简历去 jobfit 的填写态（b2v=input）。已登录时底部按区上方多一行「结束使用」。对的是客户清单「识别亮点与不足」。',
    motion: '两段切换只重绘这一栏，不播动画。',
    keep: '亮点由模型和问题一起给出，每条必须带原文依据，没有依据的不显示；亮点不打分、不排名、不预测录用。AI 标识照本屏原做法：意图带「AI 生成，仅供参考，请对照原文核对」管全屏，卡上不另贴。后端现在的报告只有六维和问题、没有亮点一栏，要新做（每条：一句亮点、原文依据、为什么算；依据要能在原文里找到）。条数从本次报告读；0 条原句「这份简历里暂时没有可以单独点名的地方。先把要改的几处改了，再诊断一次看看。」。「结束使用」只在已登录时出现，次要样式、放左边离主按钮远，副句「退出登录，并清掉这台机器上这一次的内容。这份报告已记在你的账号里。」，按一下就结束（同打印完成页一步结束，运行页 endKioskUse），回首页；放不下时只挤「带走这份报告」一块的余量和块间距，不压正文字号。默认（未登录）与原稿的差异只在「先改这几处」一栏的标题位置和「对照岗位要求」这个按钮名。原稿说明：' + dgKeep
  };

  /* ══════════ 2. jobfit：从诊断报告带着这份简历来对照岗位要求 ══════════ */
  const JF = find('jobfit');
  const jfRender = JF.render, jfMount = JF.mount, jfDemo = JF.demo, jfKeep = (JF.notes && JF.notes.keep) || '';
  const FIT_V = ['input', 'name-only', 'filled', 'loading', 'error', 'quota'];
  const REQ = ['1. 本科及以上，中文、新闻、市场营销等相关专业；', '2. 有公众号运营经验，文字功底好；', '3. 能独立策划选题，有短视频账号运营经验优先；', '4. 会用剪映等剪辑工具，有数据分析意识。'];
  const REQ_N = REQ.join('').length;
  const fitBand = (title, sub, status, now, warn) => ({ kind: 'compact', place: ' ', eyebrow: '改简历 · 对照岗位要求', title, sub, seal: null, status: { text: status, warn: warn ? 1 : 0 }, rail: { labels: ['填岗位要求', '逐条对照', '看对照结果'], now } });
  const fileCard = (chip) => `<div class="filecard b2r-file"><span class="ft">PDF</span><div style="min-width:0"><b>${RESUME_FILE}</b><small>这次对照用的简历 · 从诊断报告带过来</small></div>${chip || ''}</div>`;
  const fitTake = () => `<div class="b2r-take">${UI.report(150)}<div class="tx"><small>对照完，你会看到</small><b>一份简历对照报告</b><span>已经写到的、还没体现的要求，逐条列出，每条带依据</span><span>只给你自己看，不提供给企业；可以打印</span></div></div>`;
  function fitForm(v) {
    const s = S();
    const filled = v === 'filled';
    const name = filled || v === 'name-only' || s.b2fitName === true;
    const req = filled || s.b2fitReq === true;
    const ok = filled || v === 'name-only' || s.b2fitOk === true;
    const can = !!(name && ok);
    const lack = [name ? '' : '岗位名称还没填', ok ? '' : '「我同意用这份简历做这次对照」还没勾'].filter(Boolean).join('；');
    const nameBox = `<button class="b2r-field" data-act="type" data-b2="fit-name"><span class="b2r-fl"><b>岗位名称</b><em class="b2r-must">必填</em><small>最多 50 字</small></span><span class="b2r-fv${name ? '' : ' b2r-ph'}">${name ? '新媒体运营' : '点这里输入，例如：行政专员'}</span></button>`;
    const reqBox = req
      ? `<div class="b2r-req"><div class="b2r-fl"><b>岗位要求</b><em class="b2r-optl">选填</em><small>已贴 ${REQ_N} 字 · 最多 2000 字</small><button class="b2r-mini" data-go="phone-fill" data-set="b2ctx=jobfit">重新贴</button></div><div class="b2r-reqtx">${REQ.map((r) => `<p>${r}</p>`).join('')}</div></div>`
      : `<div class="b2r-req"><div class="b2r-fl"><b>岗位要求</b><em class="b2r-optl">选填</em><small>最多 2000 字 · 贴了更有针对性</small></div>
          <div class="b2r-ways">
            <button class="b2r-way b2r-main" data-go="phone-fill" data-set="b2ctx=jobfit"><span class="b2r-wv">${UI.phone(76)}</span><span><b>用手机贴过来</b><small>在手机上复制招聘信息里的要求，扫码贴到这台机器</small></span></button>
            <button class="b2r-way" data-act="type" data-b2="fit-req"><span class="b2r-wv">${icon('keyboard', 64, 1.8)}</span><span><b>在屏上打</b><small>要求不长时，用屏上键盘打</small></span></button>
          </div>
          <p class="b2r-nomust">${icon('check', 26, 2.6)}没有也行：只填岗位名称就能对照，贴了更有针对性</p></div>`;
    const consent = `<label class="b2r-consent"><input type="checkbox" id="b2FitOk"${ok ? ' checked' : ''}><span>我同意用这份简历做这次对照</span></label>`;
    const why = can ? `<p class="b2r-why ok">${icon('check', 28, 2.6)}可以开始了${req ? '' : '：只填了岗位名称，也能对照'}</p>` : `<p class="b2r-why">${icon('alert', 28, 2.2)}还不能开始：${lack}。</p>`;
    return F({
      band: fitBand('你想对照哪个岗位？', '把招聘信息里的岗位要求贴过来，逐条看简历写到了哪些。只对照，不打分，结果只给你自己看。', can ? '可以开始对照' : '填岗位要求', 0),
      cls: 'tight b2r-fit',
      body: nameBox + reqBox + consent + why + fileCard() + fitTake(),
      dock: { ask: '问小青：岗位要求从哪找？', pri: { label: '开始对照', id: 'b2FitGo', disabled: !can } }
    });
  }
  function fitLoading() {
    const req = S().b2fitReq === true || S().b2fitName !== true;
    return F({
      band: fitBand('正在逐条对照', '返回之前，不显示对照要点、百分比或任何录用相关结论。', '正在对照 · 没有百分比', 1),
      cls: 'tight b2r-fit',
      body: `<div class="livebox"><span class="spin"></span><div><b>正在逐条对照</b><small>拿这份简历，对着下面的岗位要求一条一条看；一次出结果，中间不播报进度</small></div></div>
        <div class="b2r-reqs"><div class="b2r-rh">对照的岗位：新媒体运营<span class="chip slate">${req ? `${REQ.length} 条要求` : '只按岗位名称'}</span></div>
          ${req ? REQ.map((r, i) => `<div class="b2r-hold"><i>${i + 1}</i><span>${r.replace(/^\d\.\s*/, '')}</span></div>`).join('') : '<div class="b2r-hold"><i>1</i><span>没有贴岗位要求，按「新媒体运营」这个岗位名称对照</span></div>'}</div>
        ${fileCard()}${fitTake()}
        ${fine('只对照，不打分：不给档位或分数，也不预测通过率')}`,
      dock: { left: `<button class="btn sec" data-go="diagnosis" data-set="b2v=">${icon('chevL', 30, 2.4)}取消，回诊断报告</button>`, ask: '问小青：对照要看什么？' }
    });
  }
  function fitError() {
    return F({
      band: fitBand('这次没对照出来', '岗位名称和岗位要求都还在，可以再试一次。', '这次没对照出来', 1, true),
      cls: 'tight st3-fill b2r-fit',
      body: `${fileCard('<span class="chip cin">未对照</span>')}
        <div class="dsec"><h4>${icon('alert', 30, 2)}原因</h4><p class="st3-reason">请求中断，没有拿到对照结果。不保留半截结论，也不拿上一次的结果顶替。这次不计次数。</p></div>
        ${UI.slab({ i: 2, row: 1, id: 'b2FitRetry', title: '再试一次', desc: '沿用刚才的岗位名称和要求，重新对照', vis: UI.report(118) })}
        ${UI.slab({ i: 3, row: 1, go: 'diagnosis', title: '回诊断报告', desc: '诊断报告和要改的几处都还在，不用 AI 也能看', vis: UI.resume(112, 'annot') })}
        ${remind(HELP)}`,
      dock: { ask: '问小青：没对照出来怎么办？', pri: { label: '再试一次', id: 'b2FitRetry2' } }
    });
  }
  function fitQuota() {
    return F({
      band: fitBand(QUOTA, '这次没有开始对照。下面两件事不用 AI，现在就能做。', '今天次数已用完', 1, true),
      cls: 'tight st3-fill b2r-fit',
      body: `${fileCard('<span class="chip clay">未对照</span>')}
        ${UI.slab({ i: 0, row: 1, go: 'diagnosis', title: '回诊断报告', desc: '诊断报告和要改的几处都还在，看完可以自己改', vis: UI.resume(112, 'annot') })}
        ${UI.slab({ i: 1, row: 1, go: 'resume-edit', title: '去编辑简历', desc: '对着岗位要求自己改，不用 AI', vis: UI.resume(112) })}
        <div class="olist b2r-self"><div class="olist-t">先自己对一遍 · 你贴的 4 条岗位要求，简历里写到了没有</div>
          ${REQ.map((r, i) => `<div class="st3-check"><i>${i + 1}</i><span>${r.replace(/^\d\.\s*/, '')}</span></div>`).join('')}</div>`,
      dock: { ask: '问小青：次数用完了还能做什么？', pri: { label: '回诊断报告', go: 'diagnosis' } }
    });
  }
  JF.render = () => {
    const v = variant(FIT_V);
    if (!v) return jfRender();
    if (v === 'loading') return fitLoading();
    if (v === 'error') return fitError();
    if (v === 'quota') return fitQuota();
    return fitForm(v);
  };
  const fitMount = (el) => {
    const offs = [];
    offs.push(on(el, 'click', (e) => {
      const t = e.target.closest('button');
      if (!t || !el.contains(t)) return;
      const s = S(), v = variant(FIT_V);
      const keepForm = () => { if (v === 'filled') { s.b2fitName = true; s.b2fitReq = true; s.b2fitOk = true; } if (v === 'name-only') { s.b2fitName = true; s.b2fitOk = true; } if (v === 'filled' || v === 'name-only') s.b2v = 'input'; };
      if (t.dataset.b2 === 'fit-name') { keepForm(); s.b2fitName = true; later(refresh); return; }
      if (t.dataset.b2 === 'fit-req') { keepForm(); s.b2fitReq = true; later(refresh); return; }
      if (t.id === 'b2FitGo' || t.id === 'b2FitRetry' || t.id === 'b2FitRetry2') { if (v === 'filled') { s.b2fitName = true; s.b2fitReq = true; } if (v === 'name-only') s.b2fitName = true; s.b2v = 'loading'; refresh(); return; }
      if (t.dataset.go === 'diagnosis' || t.dataset.go === 'resume-edit') s.b2v = '';
    }));
    offs.push(on(el, 'change', (e) => {
      if (e.target.id !== 'b2FitOk') return;
      const s = S(), v = variant(FIT_V);
      if (v === 'filled') { s.b2fitName = true; s.b2fitReq = true; }
      if (v === 'name-only') s.b2fitName = true;
      s.b2v = 'input'; s.b2fitOk = e.target.checked; refresh();
    }));
    offs.push(on(el, 'proto-demo', (e) => {
      const s = S();
      if (s.b2v !== 'loading') return;
      if (e.detail === 'b2r-done') { s.b2v = ''; s.b2fitFlow = true; window.go('jobfit-result'); return; }
      if (e.detail === 'b2r-fail') { s.b2v = 'error'; refresh(); return; }
      if (e.detail === 'b2r-quota') { s.b2v = 'quota'; refresh(); }
    }));
    return () => offs.forEach((f) => f());
  };
  JF.mount = (el) => (variant(FIT_V) ? fitMount(el) : (jfMount ? jfMount(el) : null));
  JF.demo = () => {
    const v = variant(FIT_V);
    if (v === 'loading') return [{ label: '演示：对照好了', ev: 'b2r-done' }, { label: '演示：没对照出来', ev: 'b2r-fail' }, { label: '演示：今天次数用完', ev: 'b2r-quota' }];
    if (v) return [];
    return typeof jfDemo === 'function' ? jfDemo() : (jfDemo || []);
  };
  JF.name += '（第二批补稿）';
  JF.notes = {
    does: '默认（没有简历的空态）照原稿。从诊断报告「对照岗位要求」进来（S().b2v）：input 填写（岗位名称、岗位要求两种填法、本人确认）；name-only 只填岗位名称并勾了确认，主按钮可点；filled 岗位名称和要求都有；loading 正在逐条对照；error 没对照出来；quota 今天次数用完。',
    motion: '只有 loading 的转圈在动，表示在进行，不表示百分比；其余静止。',
    keep: '入口只在诊断报告里（带着这份简历），服务台和首页不单独放卡。输入规则：岗位名称必填、最多 50 字；岗位要求选填、最多 2000 字（K/pages/resume/jobFit/jobFitQxKit.tsx:186-196）；没有岗位要求也能对照，屏上写「没有也行：只填岗位名称就能对照，贴了更有针对性」。本人确认一行对应原页面的本人授权（会员「开启岗位 AI 辅助」、匿名「确认岗位匹配授权」两套原句仍按原页面，稿上合成一行勾选，改程序时按登录态接回原授权）。口径「只对照，不打分」「不给档位或分数，也不预测通过率」「对照结果只供本人准备，不提供给企业」。「用手机贴过来」先设 S().b2ctx=\'jobfit\' 再去 phone-fill（另一路的屏，合并后按这个来路显示「把岗位要求贴过来」；回到这里 b2v 仍是 input）；「在屏上打」现在走 data-act=type，合并后可换成 kbd-short。等待中不显示进度百分比；「取消，回诊断报告」。失败归还次数是后端事实：屏上写「这次不计次数」，没有扣次数只写在这里。次数用完原句「' + QUOTA + '」，给回诊断报告、去编辑简历（不用 AI）。对照好了去 jobfit-result（演示事件）。恢复时程序侧要动停放清单、授权收尾登记、门禁清单并取回用例（track-A 核过）。原稿说明：' + jfKeep
  };

  /* ══════════ 3. jobfit-result：按这几条去改；去掉整理佐证材料；不替你写 ══════════ */
  const JR = find('jobfit-result');
  const jrRender = JR.render, jrMount = JR.mount, jrKeep = (JR.notes && JR.notes.keep) || '';
  JR.render = () => {
    let h = jrRender();
    if (S().frRep === 'wait') return h;
    h = once(h, '<button class="fr-btn" data-fr="materials">整理佐证材料</button>', '', 'jobfit-result 整理佐证材料');
    h = once(h, '<div class="fr-tags">', `<p class="b2r-nofake">${icon('pen', 28, 2.2)}没有的经历不会替你写；确实有，就到编辑里自己补上。</p><div class="fr-tags">`, 'jobfit-result 还没体现');
    h = once(h, 'data-go="optimize" data-arg="optimize" >优化简历', 'data-go="optimize" data-arg="optimize" data-set="b2v=from-fit" >按这几条去改', 'jobfit-result 主按钮');
    return h;
  };
  JR.mount = both((el) => on(el, 'click', (e) => {
    const t = e.target.closest('button');
    if (!t || !el.contains(t) || !S().b2fitFlow) return;
    if (t.dataset.act === 'back' && t.closest('.dock')) S().b2v = 'filled';
    if (t.dataset.fr === 'again') { const s = S(); s.b2v = 'input'; s.b2fitName = false; s.b2fitReq = false; s.b2fitOk = false; }
  }), jrMount);
  JR.name += '（第二批补稿）';
  JR.notes = {
    does: '主按钮「优化简历」改成「按这几条去改」，去 optimize 并带上对照（S().b2v=from-fit）。次按钮去掉「整理佐证材料」（通向已停放的素材库），其余三个照旧、排匀。「还没体现」三条下面加一句「没有的经历不会替你写；确实有，就到编辑里自己补上。」',
    motion: '无循环动画。',
    keep: '不打分、不提供给单位。还没体现的要求只提示本人去补，AI 不替用户编经历。从新流程进来时，底栏「返回填写」回 jobfit 的已填写态，「换个岗位分析」回 jobfit 的空白填写态。原稿说明：' + jrKeep
  };

  /* ══════════ 4. optimize：从对照结果来时标出和岗位要求相关的几条 ══════════ */
  const OP = find('optimize');
  const opRender = OP.render, opKeep = (OP.notes && OP.notes.keep) || '';
  const fitChip = '<span class="b2r-fitchip">岗位要求相关</span>';
  OP.render = () => {
    const h = opRender();
    if (S().b2v !== 'from-fit') return h;
    let x = once(h, '<main class="body tight d4-fill d4-opt">', `<main class="body tight d4-fill d4-opt b2r-fit2"><div class="b2r-fitbar">${icon('target', 34, 2)}<span>按『新媒体运营』的岗位要求对照：还有 3 条没体现——数据分析、独立策划选题、短视频账号运营</span></div>`, 'optimize 意图带下');
    x = once(x, '<div class="d4-rowtx"><b>求职目标</b>', '<div class="d4-rowtx"><b>求职目标' + fitChip + '</b>', 'optimize 求职目标');
    x = once(x, '<div class="d4-rowtx"><b>工作经历</b>', '<div class="d4-rowtx"><b>工作经历' + fitChip + '</b>', 'optimize 工作经历');
    return x;
  };
  OP.name += '（第二批补稿）';
  OP.notes = {
    does: '默认照原稿。从对照结果「按这几条去改」进来（S().b2v=from-fit）：意图带下面加一条对照摘要，清单里和岗位要求有关的条目标题旁加小标「岗位要求相关」（示例：求职目标、工作经历）。',
    motion: '无循环动画。',
    keep: '摘要和小标都从这次对照结果带过来：岗位名称、没体现的几条、哪几条改动和岗位要求相关；没有对照结果时不出现。小标只是提示，不改排序、不替用户补没有的经历。为放下摘要，这一态四行条目的最小高度从 172 调到 150，字号不变。原稿说明：' + opKeep
  };

  /* ══════════ 5. compare：关键句两种写法 ══════════ */
  const CMP = find('compare');
  const cmpRender = CMP.render, cmpMount = CMP.mount, cmpKeep = (CMP.notes && CMP.notes.keep) || '';
  const CMP_V = ['regen', 'regen-error', 'regen-used', 'quota'];
  const ALT = {
    first: [
      { k: '写法一 · 只理顺表达', html: '负责学院公众号的选题、撰写<del>和</del><ins>与</ins>排版<ins>工作</ins>。', m: '字数 17 → 19 · 删除 1 字 · 新增 3 字', fact: false },
      { k: '写法二 · 突出做法和结果', html: '<span class="d4-swap">独立运营</span>学院公众号，<span class="d4-swap">负责</span>选题、撰写和排版，<ins>周更 2 篇</ins>。', m: '字数 17 → 28 · 删除 3 字 · 新增 14 字', fact: true }
    ],
    second: [
      { k: '写法一 · 只理顺表达', html: '<del>负责</del>学院公众号的选题、撰写和排版<ins>由我负责</ins>。', m: '字数 17 → 19 · 删除 2 字 · 新增 4 字', fact: false },
      { k: '写法二 · 突出做法和结果', html: '<ins>独立</ins>负责学院公众号的选题、撰写和排版，<ins>周更 2 篇</ins>。', m: '字数 17 → 26 · 删除 0 字 · 新增 9 字', fact: true }
    ]
  };
  function cmpNew(v) {
    const s = S();
    const c = Object.assign({ all: 4, opt: 2, keep: 1, own: 0, pend: 1, msg: '' }, s.cmp || {});
    const pick = s.b2pick || '';
    const busy = v === 'regen';
    const fact = s.b2fact === true;
    const alts = v === 'regen-used' ? ALT.second : ALT.first;
    const altCard = (a, i) => `<section class="d4-col d4-diff b2r-alt${pick === (i ? 'two' : 'one') ? ' on' : ''}"><b>${a.k}</b><p>${a.html}</p><small>AI 生成，仅供参考，请自行核对</small><span class="b2r-m">${a.m}</span>${a.fact ? `<label class="d4-fact"><input id="b2Fact" type="checkbox"${fact ? ' checked' : ''}><span>周更 2 篇是我的真实信息</span></label>` : ''}</section>`;
    const holdCard = (k) => `<section class="d4-col b2r-alt b2r-holdalt"><b>${k}</b><svg width="100%" height="118" viewBox="0 0 420 118" preserveAspectRatio="none" aria-hidden="true"><rect x="0" y="6" width="400" height="22" rx="8" fill="#e7e2d4"/><rect x="0" y="48" width="330" height="22" rx="8" fill="#e7e2d4"/><rect x="0" y="90" width="250" height="22" rx="8" fill="#ece7da"/></svg></section>`;
    const altsHtml = busy
      ? `<div class="b2r-wait"><div class="b2r-waitbar"><span class="b2r-spin b2r-dk"></span><b>正在重写这一句</b><small>原文不动；好了会换成新的两种写法</small></div><div class="b2r-alts">${alts.map((a) => holdCard(a.k)).join('')}</div></div>`
      : `<div class="b2r-alts">${alts.map(altCard).join('')}</div>`;
    const pb = (k, label, dis) => `<button data-b2pick="${k}" aria-pressed="${pick === k}"${dis ? ' disabled' : ''}${k === 'own' ? ' data-act="type"' : ''}>${label}</button>`;
    const picks = `<div class="d4-seg d4-dec" role="group" aria-label="这一条用哪一种">${pb('one', '用写法一', busy)}${pb('two', '用写法二', busy || !fact)}${pb('keep', '保留原文', busy)}${pb('own', '自己写', busy)}</div>`;
    const RG = {
      '': { t: '想看别的说法？', sm: '算 1 次 · 今天还剩 17 次', btn: '换一批写法', id: 'b2Regen' },
      regen: { t: '想看别的说法？', sm: '算 1 次 · 今天还剩 17 次', btn: '正在换…', dis: 1 },
      'regen-error': { warn: 1, t: '这次没换成，原来的两种写法还在', sm: '算 1 次 · 今天还剩 17 次', btn: '再试一次', id: 'b2Regen' },
      'regen-used': { t: '这是换过的一批写法', sm: '用了 1 次 · 今天还剩 16 次', btn: '这一条已经换过一次', dis: 1 },
      quota: { warn: 1, t: QUOTA, sm: '原来的两种写法照常可选', btn: '换一批写法', dis: 1 }
    }[v];
    const regenRow = pick === 'own'
      ? `<div class="d4-custom b2r-own"><b class="d4-cl">自己写这一条</b><button class="d4-ta" data-act="type">在这里写你自己的这一句</button><p class="d4-cn">这段只留在本页，刷新后不保留。要放进新简历，请回编辑区填写。</p></div>`
      : `<div class="b2r-regen${RG.warn ? ' warn' : ''}"><div><b>${RG.t}</b><small>${RG.sm}</small></div><button class="btn sec"${RG.id ? ` id="${RG.id}"` : ''}${RG.dis ? ' disabled' : ''}>${RG.dis ? '' : icon('refresh', 28, 2.2)}${RG.btn}</button></div>`;
    const st = { regen: ['正在重写', 0], 'regen-error': ['这次没换成', 1], quota: ['今天次数已用完', 1] }[v] || ['待本人选择', 0];
    return F({
      band: { kind: 'compact', eyebrow: '逐条选择', title: '第 4 / 4 条 · 工作经历', sub: '选择还没写进简历，在『编辑』里生效', rail: { labels: RAIL, now: 3 }, seal: null, place: ' ', status: { text: st[0], warn: st[1] } },
      cls: 'tight d4-fill d4-cmp b2r-cmp',
      body: `<div class="d4-top">
          <button class="d4-prev" data-go="optimize" data-set="opt=2">上一条</button>
          <div class="d4-legend" aria-label="对照图例"><span><del>删掉</del> 删除</span><span><ins>加上</ins> 新增</span><span class="d4-swap">换写法</span><span>普通文字 保留</span></div>
        </div>
        <div class="d4-stats5" aria-label="改写选择统计"><span><u>全部</u><b>${c.all}</b></span><span><u>已采纳</u><b>${c.opt}</b></span><span><u>保留原文</u><b>${c.keep}</b></span><span><u>自己写</u><b>${c.own}</b></span><span><u>待定</u><b>${c.pend}</b></span></div>
        <div class="d4-batch" aria-label="批量处理"><button data-cmp="opt-all"><b>可采纳的全部采纳</b><small>跳过有待确认事实的那几条</small></button><button data-cmp="keep-rest"><b>其余保留原文</b><small>把还没决定的都记为保留</small></button><button data-cmp="clear"><b>清空全部选择</b><small>全部回到待定</small></button></div>
        <p class="d4-draft">${c.msg || '选择是阅读决策，未保存、未生成文件；返回优化页时可以选择是否应用到编辑区。只有编辑区的内容会进入导出。'}</p>
        <section class="d4-col b2r-orig"><b>原文</b><p>负责学院公众号的选题、撰写和排版。</p><small>摘自本次简历原文</small></section>
        ${altsHtml}${picks}${regenRow}`,
      dock: { backLabel: '返回', ask: '问小青：这句还能怎么改 →', pri: { label: '去编辑', go: 'resume-edit' } }
    });
  }
  const cmpMine = (el) => {
    const offs = [];
    offs.push(on(el, 'click', (e) => {
      const t = e.target.closest('button');
      if (!t || !el.contains(t)) return;
      const s = S();
      if (t.dataset.b2pick) { s.b2pick = t.dataset.b2pick; later(refresh); return; }
      if (t.id === 'b2Regen') { s.b2v = 'regen'; s.b2pick = ''; refresh(); return; }
      const k = t.dataset.cmp;
      if (!k) return;
      const c = Object.assign({ all: 4, opt: 2, keep: 1, own: 0, pend: 1, msg: '' }, s.cmp || {});
      if (k === 'opt-all') c.msg = '可以采纳的都已采纳；这一条有待你确认的新增内容（周更 2 篇），先跳过，仍是待定。';
      if (k === 'keep-rest') { c.keep += c.pend; c.pend = 0; s.b2pick = 'keep'; c.msg = '还没决定的都记为保留原文。'; }
      if (k === 'clear') { Object.assign(c, { opt: 0, keep: 0, own: 0, pend: c.all, msg: '全部回到待定，可以重新逐条选。' }); s.b2pick = ''; }
      s.cmp = c; refresh();
    }));
    offs.push(on(el, 'change', (e) => { if (e.target.id === 'b2Fact') { S().b2fact = e.target.checked; if (!e.target.checked && S().b2pick === 'two') S().b2pick = ''; refresh(); } }));
    offs.push(on(el, 'proto-demo', (e) => {
      const s = S();
      if (s.b2v !== 'regen') return;
      const to = { 'b2r-done': 'regen-used', 'b2r-fail': 'regen-error', 'b2r-quota': 'quota' }[e.detail];
      if (to) { s.b2v = to; refresh(); }
    }));
    return () => offs.forEach((f) => f());
  };
  CMP.render = () => (S().b2v === 'single' ? cmpRender() : cmpNew(variant(CMP_V)));
  CMP.mount = (el) => (S().b2v === 'single' ? cmpMount(el) : cmpMine(el));
  CMP.demo = () => (S().b2v === 'regen' ? [{ label: '演示：换好了', ev: 'b2r-done' }, { label: '演示：没换成', ev: 'b2r-fail' }, { label: '演示：今天次数用完', ev: 'b2r-quota' }] : []);
  CMP.name += '（第二批补稿）';
  CMP.notes = {
    does: '第 4 / 4 条「工作经历」是「先改这几处」里的一条，属于关键句，新的默认画两种写法：写法一只理顺表达，写法二突出做法和结果（含新增事实「周更 2 篇」，没勾确认不能选）。选择：用写法一 / 用写法二 / 保留原文 / 自己写；「换一批写法」每条 1 次。状态（S().b2v）：regen 正在重写这一句；regen-error 没换成，原来的写法还在，可再试；regen-used 换过一次，按钮变灰；quota 次数用完；single 不是关键句，只有一种写法，就是原稿的样子。',
    motion: '只有 regen 的转圈在动；其余静止。勾上事实后「用写法二」才可点。',
    keep: '只有「先改这几处」里的关键句（最多 3 条）给两种写法，其余一种（single，与原稿逐像素一致）。两种写法都只在原文已有事实上改，新增的数字和事实照旧要本人勾选「{新增内容}是我的真实信息」才能用。每张写法卡保留「AI 生成，仅供参考，请自行核对」和字数变化一行，字号不小于 24。「换一批写法」旁小字「算 1 次 · 今天还剩 17 次」：剩余次数读得到才显示，读不到只写「算 1 次」；每条只能换 1 次（regen-used 按钮写「这一条已经换过一次」）；没换成不算这一条的那 1 次、也不计简历类 AI 次数（与对照失败同口径，后端新做时守住）；次数用完原句「' + QUOTA + '」，原来的两种写法照常可选。后端现在每条只回一个改写，要新做（关键句回两种写法，换一批再回两种）。对的是客户清单「提供多方案选择」，验收说法「关键语句提供两组表述供对比替换」。自己写走屏上键盘，展开时收起「换一批」一行。原稿说明：' + cmpKeep
  };

  /* ══════════ 6. resume-edit：三套模板小卡、看成品 ══════════ */
  const ED = find('resume-edit');
  const edRender = ED.render, edMount = ED.mount, edKeep = (ED.notes && ED.notes.keep) || '';
  const tplCards = (k, compact) => (compact
    ? `<div class="b2r-tpls b2r-tpls3" role="group" aria-label="模板">${TPL_KEYS.map((x) => `<button class="b2r-tpl b2r-tplc" type="button" data-b2tpl="${x}" aria-pressed="${x === k}"><span class="b2r-tart">${art(x, 44)}<span class="b2r-tick">${icon('check', 18, 3)}</span></span><b>${TPL[x].name}</b></button>`).join('')}</div>`
    : `<div class="b2r-tpls" role="group" aria-label="模板">${TPL_KEYS.map((x) => `<button class="b2r-tpl" type="button" data-b2tpl="${x}" aria-pressed="${x === k}"><span class="b2r-tart">${art(x, 70)}<span class="b2r-tick">${icon('check', 22, 3)}</span></span><span class="b2r-ttx"><b>${TPL[x].name}</b><small>${TPL[x].desc}</small></span></button>`).join('')}</div>`);
  ED.render = () => {
    const k = curTpl(), T = TPL[k];
    let h = edRender();
    h = once(h, UI.resume(520), art(k, 520), 'resume-edit 示意图');
    h = once(h, '<p><b>1 页</b><span>示意，非打印稿</span></p>', `<div class="b2r-cap"><p><b>1 页</b><span>示意，非打印稿</span></p><button class="b2r-see" data-go="resume-preview" data-set="b2v=loading;b2who=">${icon('eye', 30, 2)}看成品</button></div>`, 'resume-edit 看成品');
    h = once(h, '<span>导出前不知道真实页数。这里的 1 页只是示意，打印以导出文件为准。</span>', '<span>点『看成品』，看真实页数和每一页的样子。</span>', 'resume-edit 页数');
    h = once(h, '<span>当前选中「清爽通用简历模板」。想换别的，去右边素材库。</span>', `<span>当前选中「${T.name}」。三套版式随时换，内容不会变。</span>`, 'resume-edit 模板说明');
    h = once(h, '<button class="d4-tpl" type="button" aria-pressed="true">清爽通用简历模板</button>', tplCards(k, S().layoutMore === true), 'resume-edit 模板区');
    h = once(h, '<button class="d4-outlink" data-go="templates">去素材库看更多模板</button>', '', 'resume-edit 素材库入口');
    if (T.cols === '双栏') {
      h = once(h, '<span>现在是单栏。', '<span>现在是双栏。', 'resume-edit 栏数');
      if (S().layoutMore === true) h = once(h, '<button aria-pressed="true" data-act="seg">单栏</button><button aria-pressed="false" data-act="seg">双栏</button>', '<button aria-pressed="false" data-act="seg">单栏</button><button aria-pressed="true" data-act="seg">双栏</button>', 'resume-edit 栏数选择');
      else h = once(h, '页边距标准 · 单栏 · 主色蓝', '页边距标准 · 双栏 · 主色蓝', 'resume-edit 当前版式');
    }
    return h;
  };
  ED.mount = both((el) => on(el, 'click', (e) => {
    const t = e.target.closest('[data-b2tpl],.b2r-see');
    if (!t || !el.contains(t)) return;
    const s = S();
    if (t.classList.contains('b2r-see')) { s.b2tpl = curTpl(); s.b2fit1 = false; s.b2page = 1; s.b2keep2 = false; return; }
    s.b2tpl = t.dataset.b2tpl; s.b2v = T2V[t.dataset.b2tpl]; refresh();
  }), edMount);
  ED.name += '（第二批补稿）';
  ED.notes = {
    does: '模板区从一行「清爽通用简历模板」加「去素材库看更多模板」，改成三张模板小卡（版式小样、名字、一句话）：清爽单栏、左栏信息、正式单栏，点哪张哪张选中，左边示意图跟着换（S().b2v=tpl2 是选中左栏信息、换成双栏的样子）。页数一块改成「点『看成品』，看真实页数和每一页的样子。」，示意图下面加「看成品」去 resume-preview。',
    motion: '换模板只重绘，不播动画。',
    keep: '模板现在只有 1 套，「换模板」没有可见变化（A/job-materials/job-material-templates.ts:11-33、A/ai/resume/resume-pdf.service.ts:118）：左栏信息、正式单栏两套排版要新做，三套都走同一个导出排版，换模板不改内容。三个名字和一句话沿用 templates 屏起过的名字；素材库页不恢复，templates 屏不动、这里也不再链过去。模板说明里「当前选中」后面的名字跟着选中的模板（原稿写的「清爽通用简历模板」不再出现）；选左栏信息时「栏数」「当前版式」跟着写双栏（模板自带默认版式）。展开「更多版式」时三张小卡收成一行（小样加名字），一句话不显示，免得挤出屏；左边「模板」一格照样写当前选中的是哪套。其余（主色、更多版式、AI 精简、AI 调整排版、待确认事实、去导出）照原稿。原稿说明：' + edKeep
  };

  /* ══════════ 7. resume-preview（新）：看成品 ══════════ */
  const PV_V = ['loading', 'one', 'error', 'empty', 'tpl2', 'tpl3'];
  const pvBand = (title, sub, status, warn) => ({ kind: 'compact', back: false, place: ' ', eyebrow: '改简历 · 看成品', title, sub, seal: null, status: { text: status, warn: warn ? 1 : 0 } });
  function pvRender() {
    const s = S(), v = variant(PV_V), k = curTpl(), T = TPL[k];
    const dk = { backLabel: '返回', ask: '问小青：一页好还是两页好', pri: { label: '去导出', go: 'resume-export' } };
    const off = (dir) => `<div class="b2r-flip off" aria-hidden="true">${icon(dir === 'prev' ? 'chevL' : 'chevR', 46, 2.6)}</div>`;
    if (v === 'error' || v === 'empty') {
      const err = v === 'error';
      const box = err
        ? `<span class="b2r-errbox">${icon('alert', 52, 2)}<b>成品没排出来</b><small>这次没有拿到排好的成品图。没有生成文件，也不计次数。</small><span class="btns"><button class="btn pri" id="b2PvRetry">${icon('refresh', 28, 2.2)}再排一次</button><button class="btn sec" data-go="resume-edit">先回编辑</button></span></span>`
        : `<span class="b2r-errbox" style="color:var(--ink-2)">${icon('file', 52, 2)}<b>还没有可排的内容</b><small>编辑里有了简历内容，才能排成品。</small><span class="btns"><button class="btn pri" data-go="resume-edit">回编辑</button><button class="btn sec" data-go="resume">回简历服务台</button></span></span>`;
      return F({
        band: pvBand(err ? '成品没排出来' : '还没有可排的内容', err ? '编辑里的内容、模板和版式都还在，可以再排一次。' : '先上传或填写一份简历，再来看成品。', err ? '成品没排出来' : '没有可排的内容', 1),
        cls: 'tight b2r-pv',
        body: `<div class="b2r-pgrow">${off('prev')}<figure class="b2r-page">${blankPaper(680)}${box}</figure>${off('next')}</div>
          <p class="b2r-pgno">${err ? `「${T.name}」这次没排出来` : '没有内容，排不出页数'}</p>
          ${err ? remind(HELP) : `<div class="b2r-hint"><div class="b2r-ht"><b>看成品不生成文件，也不计次数</b><small>上传简历、从零生成都从简历服务台开始；编辑里有了内容再回来</small></div></div>`}`,
        dock: err ? { backLabel: '返回', ask: '问小青：成品没排出来怎么办', pri: { label: '再排一次', id: 'b2PvRetry2' } } : { backLabel: '返回', ask: '问小青：先做哪一步', pri: { label: '回编辑', go: 'resume-edit' } }
      });
    }
    const loading = v === 'loading';
    const compact = v === 'one' || (s.b2fit1 === true && k !== 'left');
    const L = loading ? null : laid(k, compact);
    const pages = L ? L.pages.length : 0;
    const page = Math.max(1, Math.min(s.b2page || 1, pages || 1));
    const tags = `<div class="b2r-tagbar"><span class="b2r-tagk">版式</span>${TPL_KEYS.map((x) => (x === k ? `<span class="b2r-tag on" aria-current="true">${icon('check', 24, 2.8)}${TPL[x].name}</span>` : `<button class="b2r-tag" data-b2tpl="${x}">${TPL[x].name}</button>`)).join('')}<button class="b2r-cmplink" data-b2="cmp">${icon('layers', 28, 2)}换一套并排比</button></div>`;
    const flip = (dir, ok) => (ok ? `<button class="b2r-flip" data-b2pg="${dir}" aria-label="${dir === 'prev' ? '上一页' : '下一页'}">${icon(dir === 'prev' ? 'chevL' : 'chevR', 46, 2.6)}</button>` : `<div class="b2r-flip off" aria-hidden="true">${icon(dir === 'prev' ? 'chevL' : 'chevR', 46, 2.6)}</div>`);
    const figure = loading
      ? `<figure class="b2r-page">${skeleton(650)}<span class="b2r-phtag"><span class="b2r-spin"></span>正在排成品</span></figure>`
      : `<figure class="b2r-page">${pageSvg(k, page, 650, compact)}</figure>`;
    const lastRows = L ? L.rows[pages - 1] : 0;
    let hint;
    if (loading) hint = `<div class="b2r-hint"><div class="b2r-ht"><b>正在按「${T.name}」排成品</b><small>和导出用同一套排版；排好才显示真实页数</small></div></div>`;
    else if (pages > 1) hint = `<div class="b2r-hint"><div class="b2r-ht"><b>共 ${pages} 页，第 ${pages} 页只有 ${lastRows} 行</b><small>两种都能打印，你来定</small></div><div class="b2r-opts"><button class="b2r-dark" data-b2="fit1"><b>压到一页</b><small>自动调小行距和页边距，内容不删</small></button><button data-b2="keep2" aria-pressed="${s.b2keep2 === true}"><b>就按 ${pages} 页</b><small>不调排版，照现在打印</small></button></div></div>`;
    else hint = `<div class="b2r-hint ok"><div class="b2r-ht"><b>${icon('check', 32, 2.8)}刚好一页</b><small>${compact ? '行距和页边距调小了，内容一句没删' : '全部内容都在这一页上'}</small></div></div>`;
    return F({
      band: pvBand('打印出来就是这样', loading ? `${T.name} · 蓝色 · 正在排版` : `${T.name} · 蓝色 · 共 ${pages} 页`, loading ? '正在排成品' : '还没导出'),
      cls: 'tight b2r-pv',
      body: `${tags}<div class="b2r-pgrow">${flip('prev', !loading && page > 1)}${figure}${flip('next', !loading && page < pages)}</div><p class="b2r-pgno">${loading ? '排好后显示页数' : `第 ${page} / ${pages} 页`}</p>${hint}`,
      dock: loading ? Object.assign({}, dk, { pri: { label: '去导出', go: 'resume-export', disabled: true } }) : dk
    });
  }
  const pvMount = (el) => {
    const offs = [];
    offs.push(on(el, 'click', (e) => {
      const t = e.target.closest('button');
      if (!t || !el.contains(t)) return;
      const s = S();
      if (t.dataset.b2tpl) { s.b2tpl = t.dataset.b2tpl; s.b2v = T2V[t.dataset.b2tpl]; s.b2page = 1; s.b2fit1 = false; s.b2keep2 = false; refresh(); return; }
      if (t.dataset.b2pg) { s.b2page = (s.b2page || 1) + (t.dataset.b2pg === 'next' ? 1 : -1); refresh(); return; }
      if (t.dataset.b2 === 'fit1') { s.b2tpl = curTpl(); s.b2fit1 = true; s.b2keep2 = false; s.b2page = 1; s.b2v = 'loading'; refresh(); return; }
      if (t.dataset.b2 === 'keep2') { s.b2keep2 = s.b2keep2 !== true; refresh(); return; }
      if (t.dataset.b2 === 'cmp') { s.b2tpl = curTpl(); s.b2right = ''; s.b2sel = 'R'; s.b2v = 'loading'; window.go('tpl-compare'); return; }
      if (t.id === 'b2PvRetry' || t.id === 'b2PvRetry2') { s.b2v = 'loading'; refresh(); return; }
      if (t.dataset.go || t.dataset.act === 'back') { s.b2tpl = curTpl(); s.b2v = ''; }
    }));
    offs.push(on(el, 'proto-demo', (e) => {
      const s = S();
      if (s.b2v !== 'loading') return;
      if (e.detail === 'b2r-ready') { const k = curTpl(); s.b2v = s.b2fit1 === true && k !== 'left' ? 'one' : T2V[k]; s.b2page = 1; refresh(); return; }
      if (e.detail === 'b2r-fail') { s.b2v = 'error'; refresh(); return; }
      if (e.detail === 'b2r-empty') { s.b2v = 'empty'; refresh(); }
    }));
    return () => offs.forEach((f) => f());
  };

  /* ══════════ 8. tpl-compare（新）：两套并排看 ══════════ */
  const TC_V = ['loading', 'error'];
  function tcRender() {
    const s = S(), v = variant(TC_V);
    const Lk = TPL[s.b2tpl] ? s.b2tpl : 'clean';
    const Rk = TPL[s.b2right] && s.b2right !== Lk ? s.b2right : (Lk === 'left' ? 'clean' : 'left');
    const sel = v ? 'L' : (s.b2sel === 'L' ? 'L' : 'R');
    const pL = laid(Lk, false).pages.length, pR = laid(Rk, false).pages.length;
    const card = (side, k, n) => `<button class="b2r-tcard${sel === side ? ' on' : ''}" data-b2sel="${side}" aria-pressed="${sel === side}"><span class="b2r-tthumb">${pageSvg(k, 1, 484, false)}</span><span class="b2r-tcap"><span><b>${TPL[k].name} · ${n} 页</b><small>${TPL[k].desc}</small></span><span class="b2r-tick">${icon('check', 26, 3)}</span></span></button>`;
    const right = v === 'loading'
      ? `<div class="b2r-tcard" aria-disabled="true"><span class="b2r-tthumb">${skeleton(484)}<span class="b2r-phtag"><span class="b2r-spin"></span>正在排</span></span><span class="b2r-tcap"><span><b>${TPL[Rk].name} · 正在排</b><small>${TPL[Rk].desc}</small></span></span></div>`
      : v === 'error'
        ? `<div class="b2r-tcard"><span class="b2r-tthumb">${blankPaper(484)}<span class="b2r-errbox">${icon('alert', 44, 2)}<b>${TPL[Rk].name}这次没排出来</b><small>左边那套照常可选</small><button class="btn sec" data-b2="rerun">${icon('refresh', 28, 2.2)}再排一次</button></span></span><span class="b2r-tcap"><span><b>${TPL[Rk].name} · 没排出来</b><small>${TPL[Rk].desc}</small></span></span></div>`
        : card('R', Rk, pR);
    const rp = v ? (v === 'loading' ? '排好后显示' : '没排出来') : `${pR} 页`;
    const diff = `<div class="b2r-diff"><span class="h"></span><span class="h">${TPL[Lk].name}</span><span class="h">${TPL[Rk].name}</span>
      <span class="k">栏数</span><span>${TPL[Lk].cols}</span><span>${TPL[Rk].cols}</span>
      <span class="k">联系方式</span><span>${TPL[Lk].contact}</span><span>${TPL[Rk].contact}</span>
      <span class="k">页数</span><span>${pL} 页</span><span>${rp}</span></div>`;
    const swap = `<div class="b2r-swap"><span class="b2r-swk">右边换成</span>${TPL_KEYS.map((x) => (x === Lk ? `<span class="b2r-sw off" aria-disabled="true">${TPL[x].name}<small>左边在用</small></span>` : `<button class="b2r-sw" data-b2right="${x}" aria-pressed="${x === Rk}">${TPL[x].name}</button>`)).join('')}</div>`;
    return F({
      band: { kind: 'compact', back: false, place: ' ', eyebrow: '改简历 · 模板对比', title: '两套并排看，用哪一套？', sub: '左右是同一份内容，只换了版式；页数按实际排版算。', seal: null, status: { text: v === 'loading' ? '右边正在排' : v === 'error' ? '右边没排出来' : '还没导出', warn: v === 'error' ? 1 : 0 } },
      cls: 'tight b2r-tc',
      body: `<div class="b2r-tcs">${card('L', Lk, pL)}${right}</div>${diff}${swap}${fine('选哪一套都不改内容；回到看成品还能翻页、压到一页')}`,
      dock: { backLabel: '返回', ask: '问小青：哪套更适合我', pri: { label: '用选中的这一套', go: 'resume-preview', id: 'b2TcGo' } }
    });
  }
  const tcMount = (el) => {
    const offs = [];
    offs.push(on(el, 'click', (e) => {
      const t = e.target.closest('button');
      if (!t || !el.contains(t)) return;
      const s = S(), v = variant(TC_V);
      if (t.dataset.b2sel) { s.b2sel = t.dataset.b2sel; refresh(); return; }
      if (t.dataset.b2right) { s.b2right = t.dataset.b2right; s.b2v = 'loading'; refresh(); return; }
      if (t.dataset.b2 === 'rerun') { s.b2v = 'loading'; refresh(); return; }
      if (t.id === 'b2TcGo') {
        const Lk = TPL[s.b2tpl] ? s.b2tpl : 'clean';
        const Rk = TPL[s.b2right] && s.b2right !== Lk ? s.b2right : (Lk === 'left' ? 'clean' : 'left');
        s.b2tpl = !v && s.b2sel !== 'L' ? Rk : Lk; s.b2v = 'loading'; s.b2fit1 = false; s.b2keep2 = false; s.b2page = 1;
        return;
      }
      if (t.dataset.act === 'back') s.b2v = '';
    }));
    offs.push(on(el, 'proto-demo', (e) => {
      const s = S();
      if (s.b2v !== 'loading') return;
      if (e.detail === 'b2r-ready') { s.b2v = ''; refresh(); return; }
      if (e.detail === 'b2r-fail') { s.b2v = 'error'; refresh(); }
    }));
    return () => offs.forEach((f) => f());
  };

  const at = LIST.findIndex((x) => x.id === 'resume-edit');
  LIST.splice(at + 1, 0, {
    id: 'resume-preview', group: '改简历', name: '看成品（第二批补稿）',
    render: pvRender, mount: pvMount,
    demo: () => (S().b2v === 'loading' ? [{ label: '演示：排好了', ev: 'b2r-ready' }, { label: '演示：没排出来', ev: 'b2r-fail' }, { label: '演示：没有可排的内容', ev: 'b2r-empty' }] : []),
    notes: {
      does: '把这份简历按所选模板排成成品，一页一页翻着看，导出前就知道真实页数。意图带下面一行三个模板标签（当前这套高亮），点了直接换成那一套的成品（S().b2v=tpl2 是换成左栏信息、双栏 1 页的样子）；「换一套并排比」是次要入口，去 tpl-compare。两页时提示「共 2 页，第 2 页只有 4 行」，选「压到一页」或「就按 2 页」。状态：loading 正在排成品（纸张占位，不塌版）；默认两页；one 刚好一页（不出现「压到一页」）；error 成品没排出来（纸张位置写原因，给「再排一次」「先回编辑」和服务电话标准句）；empty 还没有可排的内容（给「回编辑」「回简历服务台」）。',
      motion: '只有 loading 的转圈在动；翻页、换模板只重绘，不播翻页动画。',
      keep: '成品图由服务端按当前编辑内容和所选模板排出来，和导出用同一套排版，所以页数是真的；第 2 页剩几行也按排版结果写。看成品不生成文件、不计次数；导出才出文件。换模板、压到一页都要重新排版：运行时先显示 loading 再换图，稿上标签点了直接换。「压到一页」只调小行距和页边距（已有的排版微调：字号、行距、页边距各三档，主色，单双栏，压到一页），不删内容。成品图上的字是成品页的缩小图，不按屏上 20px 的字号规则；按钮和说明都守 20px。示例：从编辑来是李佳怡（求职意向新媒体运营）；从从零生成来（gen-preview）是周宁（内容运营）；手机号沿用示例数据的打码写法，运行时成品按本人填写原样排。可点 9 个（翻页 2 里不可翻的那个画成不可点，模板标签 2、换一套并排比、两种页数选择、底部三个），多于一屏 7 个的口径，为减一个去掉了顶部返回（底部「返回」仍在）。对的是客户清单「模板预览」。'
    }
  }, {
    id: 'tpl-compare', group: '改简历', name: '模板并排对比（第二批补稿）',
    render: tcRender, mount: tcMount,
    demo: () => (S().b2v === 'loading' ? [{ label: '演示：右边排好了', ev: 'b2r-ready' }, { label: '演示：右边没排出来', ev: 'b2r-fail' }] : []),
    notes: {
      does: '同一份内容排成两种版式，左右并排看（每张成品图宽 484），点哪一张哪一张选中（打勾、描边）；下面列两套不一样在哪（栏数、联系方式、页数），「右边换成」可换右边那套，左边在用的那套不可选。主按钮「用选中的这一套」回看成品。状态：默认（左清爽单栏 2 页，右左栏信息 1 页，选中右边）；loading 右边正在排，占位，只能选左边；error 右边没排出来，给「再排一次」，左边仍可选。',
      motion: '只有 loading 的转圈在动。',
      keep: '两边是同一份内容；页数各自是真的（同看成品，服务端按模板排）。只换版式，不改内容。可点 7 个（两张成品、右边换成里可选的两个、底部三个），去掉了顶部返回。对的是客户清单「模板预览对比」。'
    }
  });
  const flow = (window.FLOWS || []).find((f) => f.n === '改简历');
  if (flow && flow.ids.indexOf('resume-preview') < 0) flow.ids.splice(flow.ids.indexOf('resume-edit') + 1, 0, 'resume-preview', 'tpl-compare');

  /* ══════════ 9. resume-export：导出之后（已登录）加「结束使用」 ══════════ */
  const EX = find('resume-export');
  const exRender = EX.render, exMount = EX.mount, exKeep = (EX.notes && EX.notes.keep) || '';
  EX.render = () => {
    const h = exRender();
    if (!(S().expDone === true && S().logged)) return h;
    const x = once(h, UI.qr(8, 148), UI.qr(8, 224), 'resume-export 带走二维码');
    return once(x, '<p class="fine">这是阅读草稿', endRow('退出登录，并清掉这台机器上这一次的内容。导出的文件已在你的『我的文档』里。') + '<p class="fine">这是阅读草稿', 'resume-export 结束使用');
  };
  EX.mount = both((el) => on(el, 'click', (e) => { if (e.target.closest('[data-act="clear"]')) clearMine(); }), exMount);
  EX.name += '（第二批补稿）';
  EX.notes = {
    does: '默认（还没导出）照原稿。导出之后（S().expDone 为真）且已登录时，在页脚上方加一行「结束使用」，副句「退出登录，并清掉这台机器上这一次的内容。导出的文件已在你的『我的文档』里。」，按一下就结束回首页。',
    motion: '无。',
    keep: '「结束使用」只在已登录、导出之后出现；按一下就结束（10/26 定的完成页一步结束同口径），运行页走 endKioskUse：结束人次 → 清本机数据 → 退出登录 → 回首页。次要样式、放左边，离主按钮远。这一态多了一行，带走二维码相应放大（148 → 224），下面四格说明不再被拉成空盒；字号不变。默认（还没导出）与原稿逐像素一致，原稿里四格说明被拉高的情况（screen-lint 记 4 个空卡）原样保留。原稿说明：' + exKeep
  };

  /* ══════════ 10. gen-preview：看成品、换模板 ══════════ */
  const GP = find('gen-preview');
  const gpRender = GP.render, gpKeep = (GP.notes && GP.notes.keep) || '';
  GP.render = () => {
    const h = gpRender();
    if ((S().frPrev || 'ready') !== 'ready') return h;
    return once(h, '<button class="fr-btn" data-fr="facts">改事实</button>', '<button class="fr-btn" data-fr="facts">改事实</button><button class="fr-btn" data-go="resume-preview" data-set="b2v=loading;b2who=gen;b2tpl=clean;b2page=1;b2fit1=false">看成品、换模板</button>', 'gen-preview 看成品');
  };
  GP.name += '（第二批补稿）';
  GP.notes = {
    does: '只在「改事实」「更多」那一排加一个「看成品、换模板」，去 resume-preview（同一张看成品页，成品是这一次生成的内容），三个按钮排匀。其余照原稿。',
    motion: '无循环动画。',
    keep: '看成品不生成文件、不计次数，事实没确认也能看；导出仍要先确认事实。原稿说明：' + gpKeep
  };
})();
