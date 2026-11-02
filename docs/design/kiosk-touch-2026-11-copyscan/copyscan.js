/* copyscan.js：屏上扫描 13 屏、屏上复印 8 屏、设备状态细分 1 屏，共 22 屏。
   待产品负责人审看的补稿：样式沿用青序流光触屏版（ui.js 部件、状态样式板的写法），定稿目录里的文件一个字节不改。
   怎么打开、屏清单、地址参数见 docs/design/kiosk-touch-2026-11-copyscan/README.md。
   类名一律 cs- 开头；状态放在 window.S.cs。地址参数可切换样子：
   ?scanner=stale 扫描仪状态过期、?scandev=off 屏上扫描没开通、?copydev=off 屏上复印没开通、
   ?pages=none 扫描仪不回报页数、?color=off ?duplex=off 复印的彩色或双面没开通、?device=stale 设备状态里扫描仪过期、
   ?mat=resume|id|doc|contract 选好的材料、?stage=2 复印打印停在「正在交给打印机」。 */
(function () {
  const css = document.createElement('style');
  css.textContent = `
.cs-body.body{justify-content:flex-start;gap:14px;padding:18px 40px 14px}
.cs-body>.sec-t{margin:2px 0 -4px}
.cs-ai{margin:0;padding:12px 18px;border-radius:18px;background:var(--teal-wash);color:var(--teal-ink);font-size:22px;line-height:1.45}
.cs-warn{margin:0;padding:14px 20px;border-radius:20px;background:var(--clay-wash);color:var(--clay-ink);font-size:23px;font-weight:600;line-height:1.5}
.cs-fine{margin:0;font-size:20px;line-height:1.5;color:var(--ink-3);text-align:center}
.cs-tick{display:none;width:44px;height:44px;border-radius:50%;background:var(--teal);color:#fff;place-items:center;flex:none}
[aria-pressed="true"] .cs-tick{display:grid}
/* 材料四选一 */
.cs-mats{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.cs-mat{position:relative;display:flex;flex-direction:column;gap:4px;padding:18px 22px 20px;border-radius:28px;background:var(--card);border:2px solid var(--edge);text-align:left;color:var(--ink);transition:transform var(--t-press),border-color var(--t-press),background-color var(--t-press)}
.cs-mat:active{transform:scale(.985)}
.cs-mat .top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}
.cs-mat .ic{width:72px;height:72px;border-radius:22px;background:var(--teal-wash);color:var(--teal-ink);display:grid;place-items:center;flex:none}
.cs-mat b{font:700 34px/1.25 var(--serif)}
.cs-mat small{font-size:22px;line-height:1.4;color:var(--ink-2)}
.cs-mat .top .chip{height:36px;padding:0 12px;font-size:20px}
.cs-mat[aria-pressed="true"]{border-color:var(--teal);background:var(--teal-wash)}
.cs-mat[aria-pressed="true"] .ic{background:var(--teal);color:#fff}
/* 带插画的大选项：选中式（打勾）和直达式（箭头） */
.cs-ways{flex:1;min-height:0;display:flex;flex-direction:column;gap:14px}
.cs-ways>.cs-way{flex:1}
.cs-way{position:relative;display:grid;grid-template-columns:210px minmax(0,1fr) 64px;gap:22px;align-items:center;width:100%;min-height:190px;padding:18px 24px 18px 18px;border-radius:30px;background:var(--card);border:2px solid var(--edge);text-align:left;color:var(--ink);transition:transform var(--t-press),border-color var(--t-press),background-color var(--t-press)}
.cs-way:active{transform:scale(.985)}
.cs-way .vis{align-self:stretch;min-height:140px;border-radius:22px;background:var(--well);display:grid;place-items:center;overflow:hidden}
.cs-way .vis svg{height:82%;width:auto;max-width:90%}
.cs-way .tx{min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:8px}
.cs-way h3{margin:0;font:700 36px/1.25 var(--serif)}
.cs-way p{margin:0;font-size:24px;line-height:1.45;color:var(--ink-2)}
.cs-way .arrow{width:64px;height:64px;border-radius:50%;background:var(--deep);color:var(--cream);display:grid;place-items:center}
.cs-way .mark{width:56px;height:56px;border-radius:50%;border:3px solid var(--edge);display:grid;place-items:center;color:transparent;justify-self:center}
.cs-way[aria-pressed="true"]{border-color:var(--teal);background:var(--teal-wash)}
.cs-way[aria-pressed="true"] .mark{background:var(--teal);border-color:var(--teal);color:#fff}
.cs-way[aria-pressed="true"] .vis{background:var(--card)}
.cs-way[aria-pressed="true"] .chip:not(.clay){background:var(--teal);color:#fff}
.cs-way:disabled .chip{background:rgba(255,253,247,.8)}
.cs-way:disabled{background:var(--well);border-style:dashed;cursor:default}
.cs-way:disabled:active{transform:none}
.cs-way:disabled h3{color:var(--ink-2)}
.cs-way:disabled .vis{opacity:.55}
.cs-way.big{grid-template-columns:330px minmax(0,1fr) 64px;gap:30px;padding:22px 28px 22px 22px}
.cs-way.big h3{font-size:42px}
.cs-way.big p{font-size:26px}
.cs-way.big .vis svg{height:auto;width:84%;max-width:84%}
/* 纸放哪：玻璃台 / 进纸器 */
.cs-two{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;gap:14px}
.cs-src{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:16px 20px 18px;border-radius:28px;background:var(--card);border:2px solid var(--edge);text-align:left;color:var(--ink);transition:transform var(--t-press),border-color var(--t-press),background-color var(--t-press)}
.cs-src:active{transform:scale(.985)}
.cs-src .vis{align-self:stretch;flex:1;min-height:190px;border-radius:20px;background:var(--well);display:grid;place-items:center;overflow:hidden;margin-bottom:6px}
.cs-src .vis svg{height:84%;width:auto;max-width:90%}
.cs-src b{font:700 36px/1.25 var(--serif)}
.cs-src .d{font-size:24px;line-height:1.4;color:var(--ink)}
.cs-src .d2{font-size:22px;line-height:1.4;color:var(--ink-2)}
.cs-src .cs-tick{position:absolute;right:14px;top:14px}
.cs-src[aria-pressed="true"]{border-color:var(--teal);background:var(--teal-wash)}
.cs-src[aria-pressed="true"] .vis{background:var(--card)}
/* 黑白 / 彩色、单面 / 双面 */
.cs-seg button{min-height:104px}
.cs-seg button small{font-size:20px;font-weight:400;opacity:.9}
.cs-seg button[disabled]{text-decoration:none;opacity:1;background:transparent;border:2px dashed var(--line);color:var(--ink-3)}
.cs-seg button[disabled] small{color:var(--clay-ink);font-weight:700;opacity:1}
.cs-login{display:flex;align-items:center;gap:16px;min-height:100px;padding:12px 14px 12px 24px;border-radius:26px;background:var(--teal-wash);color:var(--teal-ink)}
.cs-login span{flex:1;min-width:0;font-size:24px;font-weight:600;line-height:1.45}
.cs-login .btn{height:76px;min-width:176px;padding:0 24px;font-size:26px;border-radius:22px}
.cs-hold{display:flex;align-items:center;gap:16px;min-height:80px;padding:10px 24px;border-radius:24px;background:var(--well);border:2px dashed var(--line);color:var(--ink-2);font-size:23px;line-height:1.45}
.cs-hold svg{flex:none;color:var(--ink-3)}
.cs-saved{display:flex;align-items:center;gap:18px;padding:20px 26px;border-radius:26px;background:var(--teal-wash);color:var(--teal-ink);font-size:28px;font-weight:700;line-height:1.5}
.cs-saved svg{flex:none}
.cs-link{display:flex;align-items:center;gap:18px;min-height:96px;padding:0 26px;border-radius:24px;background:var(--well);text-align:left;width:100%;color:var(--ink)}
.cs-link .tx{flex:1;min-width:0}
.cs-link b{display:block;font-size:26px}
.cs-link small{display:block;font-size:21px;color:var(--ink-3)}
.cs-link .chev{color:var(--ink-3)}
/* 四段进度 */
.cs-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;flex:none}
.cs-steps .s{display:flex;flex-direction:column;gap:6px;min-height:206px;padding:18px 16px;border-radius:24px;background:var(--well)}
.cs-steps .n{width:48px;height:48px;border-radius:50%;background:var(--deep);color:var(--cream);display:grid;place-items:center;font-weight:700;font-size:22px}
.cs-steps b{font-size:24px;line-height:1.3}
.cs-steps em{display:flex;align-items:center;gap:8px;font-style:normal;font-size:20px;font-weight:700;color:var(--ink-3)}
.cs-steps small{font-size:20px;line-height:1.4;color:var(--ink-3)}
.cs-steps .s.on{background:var(--teal-wash)}
.cs-steps .s.on .n{background:var(--teal)}
.cs-steps .s.on em{color:var(--teal-ink)}
.cs-steps .s.now{background:var(--card);border:2px solid var(--teal)}
.cs-steps .s.now em{color:var(--teal-ink)}
@keyframes cs-breathe{from{opacity:.35}to{opacity:1}}
.cs-dot{width:14px;height:14px;border-radius:50%;background:var(--teal);display:inline-block;animation:cs-breathe 1.6s ease-in-out infinite alternate;flex:none}
/* 正在扫描：纸上走一条光带，只有这里在动 */
.cs-hero{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;background:var(--well);border-radius:30px;padding:24px 30px}
.cs-hrow{display:flex;align-items:center;justify-content:center;gap:44px}
.cs-reader{position:relative;width:440px;height:622px;border-radius:18px;background:#fff;box-shadow:0 18px 40px rgba(11,36,30,.14),0 0 0 1.5px var(--edge);overflow:hidden;flex:none;--h:622px}
.cs-hero.none .cs-reader{width:520px;height:736px;--h:736px}
.cs-reader svg{position:absolute;left:0;top:0;width:100%;height:100%}
.cs-reader .scanline{position:absolute;left:0;right:0;top:-90px;height:90px;background:linear-gradient(180deg,rgba(46,230,168,0),rgba(46,230,168,.28) 70%,rgba(31,158,134,.85) 100%);animation:cs-sweep 2.4s ease-in-out infinite}
@keyframes cs-sweep{0%{transform:translateY(0)}100%{transform:translateY(calc(var(--h) + 90px))}}
.reduced .stage .cs-reader .scanline{display:none}
.cs-side{display:flex;flex-direction:column;gap:12px;min-width:240px}
.cs-hero.none .cs-side{width:330px}
.cs-count{display:flex;align-items:baseline;gap:12px;font-variant-numeric:tabular-nums}
.cs-count b{font:700 132px/1 var(--sans);color:var(--deep)}
.cs-count span{font-size:38px;color:var(--ink-2)}
.cs-cap{margin:0;font-size:26px;line-height:1.45;color:var(--ink-2)}
.cs-big{font:700 52px/1.2 var(--serif);color:var(--deep)}
.cs-spin{width:80px;height:80px;border-radius:50%;border:8px solid var(--teal-wash);border-top-color:var(--teal);animation:spin 1s linear infinite}
.cs-thumbs{display:flex;gap:16px;align-items:flex-end;flex-wrap:nowrap}
.cs-hero .cs-thumbs{justify-content:center}
.cs-pg{position:relative;width:86px;height:122px;flex:none}
.cs-pg>svg:not(.dash){width:86px;height:122px}
.cs-pg i{position:absolute;right:-8px;top:-8px;width:34px;height:34px;border-radius:50%;background:var(--teal);color:#fff;display:grid;place-items:center}
.cs-pg i svg{width:20px;height:20px}
.cs-pg.next{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;font-size:20px;font-weight:700;color:var(--teal-ink);line-height:1.3}
.cs-pg.next>svg.dash{position:absolute;left:0;top:0;width:100%;height:100%}

.cs-strip{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:20px 24px;border-radius:30px;background:var(--well)}
.cs-strip .cs-thumbs{gap:24px;justify-content:center}
.cs-strip .cs-pg{width:210px;height:297px}
.cs-strip .cs-pg>svg:not(.dash){width:210px;height:297px}
.cs-strip .cs-pg.next>svg.i{width:48px;height:48px}
.cs-strip .cs-pg i{width:42px;height:42px;right:-10px;top:-10px}
.cs-strip .cs-pg i svg{width:26px;height:26px}
.cs-more .cs-ways{flex:none}
.cs-more .cs-ways>.cs-way{flex:none;min-height:236px}
.cs-strip p{margin:0;font-size:30px;font-weight:700;color:var(--ink);line-height:1.4;text-align:center}
.cs-strip p small{display:block;font-size:23px;font-weight:400;color:var(--ink-2)}
.cs-stop.btn{background:transparent;color:var(--cinnabar);border:2.5px solid var(--cinnabar)}
.cs-stop.btn.armed{background:var(--cinnabar);color:#fff}
/* 生成文件 */
.cs-merge{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;background:var(--well);border-radius:30px;padding:20px 30px}
.cs-pile{position:relative;width:520px;height:500px;flex:none}
.cs-make .stagelist .it{min-height:104px;font-size:30px}
.cs-pile>svg{position:absolute;left:0;top:0}
.cs-facts{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;width:100%}
.cs-facts div{display:flex;flex-direction:column;gap:2px;padding:14px 16px;border-radius:20px;background:var(--card);align-items:flex-start;justify-content:center;min-height:96px}
.cs-facts b{font-size:28px;line-height:1.3}
.cs-facts span{font-size:21px;color:var(--ink-3)}
/* 完成页的文件卡 */
.cs-file{flex:1;min-height:0;display:flex;flex-direction:column;gap:16px;padding:22px 26px 18px;border-radius:30px;background:var(--card);border:1.5px solid var(--edge)}
.cs-fhead{display:flex;align-items:center;gap:20px}
.cs-fhead .ft{width:76px;height:96px;border-radius:14px;background:#fdecea;color:var(--cinnabar);display:grid;place-items:center;font:700 20px var(--sans);flex:none}
.cs-fhead .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.cs-fhead b{font:700 34px/1.3 var(--sans);word-break:break-all}
.cs-fhead .meta{font-size:28px;color:var(--ink-2)}
.cs-fhead .chips{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;max-width:300px}
.cs-fpages{flex:1;min-height:0;display:flex;align-items:stretch;justify-content:center;gap:24px;border-radius:22px;background:var(--well);padding:16px}
.cs-fpages .pgc{display:flex;flex-direction:column;align-items:center;gap:8px;font-size:22px;color:var(--ink-2);min-width:0;max-height:430px}
.cs-fpages .pgc svg{flex:1;min-height:0;width:240px;max-width:100%;filter:drop-shadow(0 6px 10px rgba(11,36,30,.12))}
.cs-fpages .more{align-self:center}
.cs-done .cs-row{min-height:92px;padding:8px 22px 8px 16px}
.cs-done .cs-row .ic{width:60px;height:60px}
.cs-done .cs-row b{font-size:27px}
.cs-fpages .more{font-size:26px;font-weight:700;color:var(--ink-2)}
.cs-rows{display:flex;flex-direction:column;gap:12px}
.cs-row{display:flex;align-items:center;gap:20px;min-height:104px;padding:12px 22px 12px 18px;border-radius:26px;background:var(--card);border:2px solid var(--edge);text-align:left;width:100%;color:var(--ink);transition:transform var(--t-press)}
.cs-row:active{transform:scale(.985)}
.cs-row .ic{width:68px;height:68px;border-radius:20px;background:var(--teal-wash);color:var(--teal-ink);display:grid;place-items:center;flex:none}
.cs-row .tx{flex:1;min-width:0}
.cs-row b{display:block;font-size:28px;line-height:1.3}
.cs-row small{display:block;font-size:22px;line-height:1.4;color:var(--ink-2)}
.cs-row .chev{color:var(--ink-3);flex:none}
.cs-row:disabled{background:var(--well);border-style:dashed;cursor:default}
.cs-row:disabled:active{transform:none}
.cs-row:disabled .ic{background:var(--paper-2);color:var(--ink-3)}
.cs-row:disabled b{color:var(--ink-2)}
/* 出错与状态：原因卡 */
.cs-why{flex:1;min-height:300px;display:grid;grid-template-columns:330px minmax(0,1fr);gap:30px;align-items:center;padding:22px 30px 22px 22px;border-radius:30px;background:var(--card);border:1.5px solid var(--edge)}
.cs-why .vis{position:relative;width:330px;height:330px;border-radius:26px;background:var(--well);display:grid;place-items:center;overflow:hidden}
.cs-why .vis svg.illus{width:76%;height:auto}
.cs-why .vis .warn{position:absolute;right:14px;top:14px;width:62px;height:62px;border-radius:50%;background:var(--clay);color:#fff;display:grid;place-items:center}
.cs-why b{display:block;font:700 38px/1.35 var(--serif)}
.cs-why p{margin:12px 0 0;font-size:27px;line-height:1.55;color:var(--ink-2)}
.cs-unc .steps3.big .s{min-height:190px}
.cs-unc .steps3.big .s b{font-size:30px}
.cs-unc .steps3.big .s small{font-size:24px}
.cs-err .cs-ways{flex:none}
.cs-err .cs-ways>.cs-way{flex:none;min-height:196px}
.cs-err2 .cs-ways>.cs-way{min-height:232px}
.cs-ring{position:relative;width:480px;height:480px;flex:none}
.cs-ring svg{transform:rotate(-90deg)}
.cs-ring b{position:absolute;inset:0;display:grid;place-items:center;align-content:center;font:700 180px/1 var(--sans);font-variant-numeric:tabular-nums;color:var(--deep)}
.cs-ring b small{font-size:40px;font-weight:400;color:var(--ink-2);margin-top:-6px}
.cs-wait{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding:26px 34px;border-radius:30px;background:var(--well);text-align:center}
.cs-wait .tx{display:flex;flex-direction:column;gap:10px}
.cs-wait .tx b{font:700 44px/1.35 var(--serif)}
.cs-wait .tx span{font-size:28px;line-height:1.55;color:var(--ink-2)}
.cs-fact{display:flex;align-items:center;gap:20px;min-height:116px;padding:12px 26px 12px 20px;border-radius:26px;background:var(--card);border:1.5px solid var(--edge)}
.cs-fact .ic{width:68px;height:68px;border-radius:20px;background:var(--teal-wash);color:var(--teal-ink);display:grid;place-items:center;flex:none}
.cs-fact b{font-size:28px;line-height:1.4}
.cs-fact.big{min-height:148px;background:var(--teal-wash);border-color:transparent}
.cs-fact.big .ic{width:80px;height:80px;border-radius:24px;background:var(--card)}
.cs-fact.big b{font-size:32px;color:var(--teal-ink)}
/* 复印 */
.cs-params{display:flex;flex-direction:column;gap:16px;padding:24px 24px;border-radius:28px;background:var(--card);border:1.5px solid var(--edge)}
.cs-params .prow{display:grid;grid-template-columns:116px 1fr;align-items:center;gap:16px}
.cs-params .prow>span{font-size:25px;font-weight:700;color:var(--ink-2)}
.cs-params .seg button{min-height:96px;font-size:26px}
.cs-stepx{display:flex;align-items:center;gap:10px}
.cs-stepx button{min-width:76px;height:92px;padding:0 12px;border-radius:22px;background:var(--well);font:700 26px/1 var(--sans);display:grid;place-items:center}
.cs-stepx button:active{transform:scale(.96)}
.cs-stepx button:disabled{opacity:.42}
.cs-stepx output{min-width:116px;text-align:center;font:700 44px var(--sans);font-variant-numeric:tabular-nums}
.cs-stepx output small{font-size:26px;font-weight:700;margin-left:4px}
.cs-stepx .cap{font-size:21px;color:var(--ink-3)}
.cs-pages{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:space-evenly;gap:16px;padding:22px 24px;border-radius:30px;background:var(--well)}
.cs-prow{display:flex;align-items:center;justify-content:center;gap:24px}
.cs-pages .pgc{display:flex;flex-direction:column;align-items:center;gap:10px;font-size:22px;color:var(--ink-2)}
.cs-pages .pgc svg{width:290px;height:410px;filter:drop-shadow(0 6px 10px rgba(11,36,30,.12))}
.cs-pfacts{display:grid;grid-template-columns:1fr 1fr;gap:12px;width:100%}
.cs-pfacts div{display:flex;align-items:center;min-height:116px;padding:14px 24px;border-radius:24px;background:var(--card);border:1.5px solid var(--edge);font:700 31px/1.35 var(--sans)}
.cs-printer{position:relative;width:620px;height:600px;flex:none;transform:scale(1.18);transform-origin:center center;margin:50px 0 60px}
.cs-printer>svg{position:absolute;left:0;top:0}
.cs-sheet{position:absolute;left:150px;top:276px;width:320px;height:118px;border-radius:6px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.16);opacity:1;transform:translateY(124px) rotate(-2deg);transform-origin:top center}
.cs-sheet.b{transform:translateY(120px) rotate(1.5deg)}
.cs-sheet.c{transform:translateY(116px)}
.cs-sheet::before{content:"";position:absolute;left:28px;right:90px;top:30px;height:8px;border-radius:4px;background:#d9ded9;box-shadow:0 22px 0 #d9ded9,0 44px 0 #d9ded9}
.cs-out .cs-sheet{animation:cs-out 2.7s cubic-bezier(.2,.8,.2,1) infinite both}
.cs-out .cs-sheet.b{animation-delay:.9s}
.cs-out .cs-sheet.c{animation-delay:1.8s}
@keyframes cs-out{0%{opacity:0;transform:translateY(-4px) scaleY(.2)}5%{opacity:1}28%{opacity:1;transform:translateY(124px) scaleY(1)}100%{opacity:1;transform:translateY(124px) scaleY(1)}}
.cs-remind-big{display:flex;align-items:center;gap:26px;padding:34px 36px;border-radius:30px;background:var(--clay-wash);color:var(--clay-ink);font:700 38px/1.45 var(--serif)}
.cs-remind-big svg{flex:none}
.cs-take{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;gap:30px;border-radius:30px;background:var(--card);border:1.5px solid var(--edge);padding:20px 30px;overflow:hidden}
.cs-take .cs-printer{transform:scale(.92);margin:-30px -34px}
.cs-take .tt{max-width:330px}
.cs-take .tt .tray-arrow{align-self:flex-start}
.cs-take .tt{display:flex;flex-direction:column;gap:12px}
.cs-take .tt b{font:700 44px/1.3 var(--serif)}
.cs-take .tt span{font-size:26px;line-height:1.6;color:var(--ink-2)}
.cs-help{display:flex;align-items:center;gap:18px;padding:22px 28px;border-radius:26px;background:var(--teal-wash);color:var(--teal-ink);font-size:25px;font-weight:600;line-height:1.55}
.cs-help svg{flex:none}
.cs-ovacts{display:flex;gap:12px;width:100%}
.cs-ovacts .btn{flex:1}
.cs-tel{font:700 72px/1.1 var(--sans);font-variant-numeric:tabular-nums;color:var(--deep);letter-spacing:.02em}
/* 设备状态 */
.cs-devs{display:flex;flex-direction:column;gap:12px}
.cs-dev{display:grid;grid-template-columns:72px minmax(0,1fr) auto;gap:18px;align-items:center;min-height:120px;padding:12px 24px 12px 20px;border-radius:26px;background:var(--card);border:1.5px solid var(--edge)}
.cs-dev .ic{width:72px;height:72px;border-radius:22px;background:var(--teal-wash);color:var(--teal-ink);display:grid;place-items:center}
.cs-dev b{display:block;font-size:30px;line-height:1.3}
.cs-dev small{display:block;font-size:22px;line-height:1.4;color:var(--ink-2)}
.cs-dev .when{font-size:22px;color:var(--ink-3);text-align:right;white-space:nowrap}
.cs-dev .st{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.cs-dev.stale{background:var(--well);border-style:dashed}
.cs-dev.stale .ic{background:var(--paper-2);color:var(--ink-3)}
.cs-dev.stale b{color:var(--ink-2)}
.cs-dev.stale small{color:var(--ink-3)}
.cs-can{flex:1;min-height:0;display:flex;flex-direction:column;border-radius:26px;background:var(--well);padding:8px 24px}
.cs-can div{flex:1;display:flex;align-items:center;gap:16px;min-height:84px;border-top:1.5px solid var(--line)}
.cs-can div:first-child{border-top:0}
.cs-can b{font-size:31px;flex:none;min-width:170px}
.cs-can .d{flex:1;font-size:25px;line-height:1.4;color:var(--ink-2)}
.cs-can .chip{height:48px;padding:0 20px;font-size:22px;border-radius:24px}
`;
  document.head.appendChild(css);

  const { icon, band, dock, nav, scanPaper, stack, mfp } = UI;
  const S = () => window.S;
  const refresh = () => window.__proto && window.__proto.refresh();
  const PHONE = '183-6916-1921';
  const HELP = '需要帮助？拨打服务电话 ' + PHONE;
  const MACHINE = '这台机器暂时打不了，我们已经收到提醒，会尽快处理。你可以稍后再来；需要帮助请拨打服务电话 ' + PHONE + '。';
  const SCAN_RAIL = ['选方式', '放纸设置', '扫描', '拿走文件'];
  const COPY_RAIL = ['扫原件', '核对', '打印', '取走'];
  const G_SCAN = '屏上扫描（新）', G_COPY = '屏上复印（新）', G_DEV = '设备状态（新）';
  const MATS = {
    resume: { label: '简历', icon: 'file', desc: '纸质简历，扫成 PDF', fs: 'resume' },
    id: { label: '证件', icon: 'idcard', desc: '身份证、学历证书等原件', chip: '敏感文件 · 自动清理', fs: 'id' },
    doc: { label: '普通文档', icon: 'layers', desc: '证明、成绩单等多页材料', fs: 'document' },
    contract: { label: '合同', icon: 'pen', desc: '多页合同、协议，扫成 PDF', fs: 'document' }
  };

  /* ───────── 状态：地址参数给初值，演示事件和点击改它；结束使用时随 doClear 一起清掉 ───────── */
  function st() {
    const s = S();
    if (!s.cs) {
      const q = new URLSearchParams(location.search);
      s.cs = {
        scanner: q.get('scanner') === 'stale' ? 'stale' : 'ok',
        scandev: q.get('scandev') === 'off' ? 'off' : 'on',
        copydev: q.get('copydev') === 'off' ? 'off' : 'on',
        pages: q.get('pages') === 'none' ? 'none' : 'known',
        color: q.get('color') === 'off' ? 'off' : 'on',
        duplex: q.get('duplex') === 'off' ? 'off' : 'on',
        device: q.get('device') === 'stale' ? 'stale' : 'ok',
        mat: MATS[q.get('mat')] ? q.get('mat') : 'doc', way: 'screen', src: '', ink: '', flow: 'scan', rec: null, stopArm: false,
        copies: 2, orig: 'glass', cink: 'bw', dup: 'double', pstage: q.get('stage') === '2' ? 2 : 3, mini: true, tel: false
      };
    }
    if (!window.__csClear && typeof window.doClear === 'function') {
      window.__csClear = true;
      const dc = window.doClear;
      window.doClear = function () { try { delete window.S.cs; } catch (e) { } return dc.apply(this, arguments); };
    }
    return s.cs;
  }
  const srcOf = (c) => c.src || (c.mat === 'id' ? 'glass' : 'feeder');
  const inkOf = (c) => c.ink || (c.mat === 'id' ? 'color' : 'bw');
  const go = (id) => { const c = st(); c.tel = false; c.stopArm = false; window.go(id); };
  const printerOff = () => S().printer === 'down';

  /* 扫描仪、复印的可用性：状态过期或没开通时，屏上方式灰掉并给出路 */
  function scanBlock() {
    const c = st();
    if (c.scandev === 'off') return '这台机器还没开通屏上扫描';
    if (c.scanner === 'stale') return '扫描仪状态 2 分钟没更新，先用面板扫描';
    return '';
  }
  function copyBlock() {
    const c = st();
    if (c.copydev === 'off') return '这台机器暂时只能在打印机面板上复印';
    if (c.scanner === 'stale') return '扫描仪状态 2 分钟没更新，先用面板复印';
    return '';
  }
  function scanChip() {
    const c = st();
    if (c.scandev === 'off') return { text: '屏上扫描未开通', warn: 1 };
    if (c.scanner === 'stale') return { text: '扫描仪状态过期 · 2 分钟前', warn: 1 };
    return { text: '扫描仪就绪 · 20 秒前检查' };
  }
  function copyChip() {
    const c = st();
    if (printerOff()) return { text: '打印机离线', warn: 1 };
    if (c.copydev === 'off') return { text: '屏上复印未开通', warn: 1 };
    if (c.scanner === 'stale') return { text: '扫描仪状态过期 · 2 分钟前', warn: 1 };
    return { text: '设备就绪 · 20 秒前检查' };
  }

  /* ───────── 插画：玻璃台、进纸器、纸页；打印机和扫描仪用 ui.js 现成的 ───────── */
  function glassSvg(w) {
    return `<svg class="illus" width="${w}" height="${w}" viewBox="0 0 150 150" aria-hidden="true">
      <rect x="8" y="22" width="134" height="108" rx="14" fill="#c9cfcc"/>
      <rect x="20" y="34" width="110" height="84" rx="8" fill="#eaf2ef" stroke="#9aa6a1" stroke-width="2"/>
      <rect x="30" y="46" width="52" height="64" rx="3" fill="#fff" stroke="#c9d1cd" stroke-width="2"/>
      <rect x="38" y="56" width="34" height="5" rx="2" fill="#d9ded9"/><rect x="38" y="68" width="26" height="5" rx="2" fill="#d9ded9"/><rect x="38" y="80" width="34" height="5" rx="2" fill="#d9ded9"/><rect x="38" y="92" width="22" height="5" rx="2" fill="#d9ded9"/>
      <path d="M22 62V36h26" fill="none" stroke="#1f9e86" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="14" y="132" width="122" height="6" rx="3" fill="#aab4af"/></svg>`;
  }
  function feederSvg(w, empty) {
    const paper = empty ? '' : `<rect x="48" y="26" width="58" height="38" rx="3" fill="#fff" stroke="#c9d1cd" stroke-width="2" transform="rotate(-4 77 45)"/>
      <rect x="44" y="22" width="58" height="38" rx="3" fill="#fff" stroke="#c9d1cd" stroke-width="2"/>
      <rect x="52" y="31" width="34" height="5" rx="2" fill="#d9ded9"/><rect x="52" y="42" width="26" height="5" rx="2" fill="#d9ded9"/>
      <path d="M126 22v22M118 36l8 8 8-8" fill="none" stroke="#1f9e86" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
    return `<svg class="illus" width="${w}" height="${w}" viewBox="0 0 150 150" aria-hidden="true">
      <rect x="8" y="82" width="134" height="50" rx="12" fill="#c9cfcc"/>
      <path d="M26 82 L36 20 H116 L124 82 Z" fill="#dfe5e2" stroke="#9aa6a1" stroke-width="2"/>
      ${paper}
      <rect x="20" y="70" width="110" height="18" rx="8" fill="#9aa6a1"/>
      <rect x="30" y="104" width="90" height="6" rx="3" fill="#2ee6a8"/></svg>`;
  }
  function pageSvg(w, h, k) {
    const p = Math.round(w * 0.09), iw = w - 2 * p, g = Math.max(10, Math.round(w * 0.046));
    const ws = [[1, .84, .94, .7, .9, .6], [.9, .96, .74, 1, .66, .86], [.8, 1, .88, .62, .94, .72]][k % 3];
    let s = `<svg class="illus" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${Math.round(w * 0.04)}" fill="#fff" stroke="rgba(11,36,30,.14)" stroke-width="2"/>`;
    s += `<rect x="${p}" y="${p}" width="${iw * (k % 3 === 1 ? .5 : .62)}" height="${g * 1.1}" rx="3" fill="#13231e"/>`;
    s += `<rect x="${p}" y="${p + g * 1.7}" width="${iw * .38}" height="${g * .42}" rx="2" fill="#b9c3bf"/>`;
    let y = p + g * 3.2, i = 0;
    while (y < h - p - g) {
      if (i && i % 5 === 0) { y += g * .6; s += `<rect x="${p}" y="${y}" width="${iw * .26}" height="${g * .5}" rx="2" fill="#1f9e86"/>`; y += g * 1.2; }
      s += `<rect x="${p}" y="${y}" width="${iw * ws[i % 6]}" height="${Math.max(3, g * .4)}" rx="2" fill="#d9ded9"/>`;
      y += g * .95; i++;
    }
    return s + '</svg>';
  }
  function ring(pct, size, stroke) {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(11,36,30,.1)" stroke-width="${stroke}"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#1f9e86" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/></svg>`;
  }

  /* ───────── 公共部件 ───────── */
  const B = (o) => band(Object.assign({ back: false, seal: null, kind: 'compact', place: ' ' }, o));
  function shell(o) {
    const ai = S().ai === 'down' ? '<p class="cs-ai">小青暂时接不上。这一步不用它也能做完，照下面的按钮继续。</p>' : '';
    return B(o.band) + `<main class="body cs-body ${o.cls || ''}">${ai}${o.body}</main>` + o.dock + nav(null) + (o.overlay || '');
  }
  /* 底部按区：左 返回（或自定义）· 中 问小青 · 右 主按钮 */
  function D(o) {
    const left = o.left !== undefined ? o.left : (o.back ? `<button class="btn sec" data-go="${o.back.go}">${icon('chevL', 30, 2.4)}${o.back.label || '返回'}</button>` : '');
    return dock({ left: left || undefined, back: left ? undefined : false, ask: o.ask, mid: o.pri || '' });
  }
  const pri = (label, attr, o) => `<button class="btn pri" ${attr}${o && o.dis ? ' disabled' : ''}>${label}${o && o.noArrow ? '' : icon('arrowR', 30, 2.4)}</button>`;
  const stopBtn = (label, short) => {
    const arm = st().stopArm;
    return `<button class="btn cs-stop${arm ? ' armed' : ''}" data-cs="stop">${icon('x', 30, 2.6)}${arm ? (short ? '再点确认停止' : '再点一次确认停止') : label}</button>`;
  };
  const armNote = () => (st().stopArm ? '<p class="cs-warn">再按一次才会停止，已扫的页会从这台机器删除。</p>' : '');
  const remind = (t, ic) => `<div class="remind">${icon(ic || 'call', 34, 2)}<span>${t}</span></div>`;
  const howto = (t, ic) => `<div class="howto">${icon(ic || 'help', 34, 2)}<span>${t}</span></div>`;
  function matTile(k, on) {
    const m = MATS[k];
    return `<button class="cs-mat" data-cs="mat:${k}" aria-pressed="${on}"><span class="top"><span class="ic">${icon(m.icon, 44, 2)}</span>${m.chip ? `<span class="chip clay">${m.chip}</span>` : ''}<span class="cs-tick">${icon('check', 26, 3)}</span></span><b>${m.label}</b><small>${m.desc}</small></button>`;
  }
  /* 带插画的大选项：on 有值是选中式，没有是直达式（带箭头） */
  function wayCard(o) {
    const attr = o.dis ? ' disabled' : (o.cs ? ` data-cs="${o.cs}"` : (o.go ? ` data-go="${o.go}"` : ''));
    const pr = o.on !== undefined ? ` aria-pressed="${o.on ? 'true' : 'false'}"` : '';
    const tail = o.on !== undefined ? `<span class="mark">${icon('check', 30, 3)}</span>` : (o.dis ? '<span></span>' : `<span class="arrow">${icon('arrowR', 30, 2.4)}</span>`);
    const chip = o.chip ? `<span class="chip ${o.chipKind || ''}">${o.chip}</span>` : '';
    return `<button class="cs-way${o.big ? ' big' : ''}"${attr}${pr}><span class="vis">${o.vis || ''}</span><span class="tx">${chip}<h3>${o.t}</h3><p>${o.d}</p></span>${tail}</button>`;
  }
  function srcCard(k, cur, act) {
    const g = k === 'glass';
    return `<button class="cs-src" data-cs="${act}:${k}" aria-pressed="${cur === k}"><span class="vis">${g ? glassSvg(170) : feederSvg(170)}</span><b>${g ? '玻璃台' : '进纸器'}</b><span class="d">${g ? '一次一页，适合证件、书本' : '一叠最多 50 页，只扫单面'}</span><span class="d2">${g ? '字朝下，对齐左上角' : '字朝上'}</span><span class="cs-tick">${icon('check', 26, 3)}</span></button>`;
  }
  function psteps(list) {
    return `<div class="cs-steps">${list.map((s, i) => `<div class="s ${s[3]}"><span class="n">${i + 1}</span><b>${s[0]}</b><em>${s[3] === 'now' ? '<i class="cs-dot"></i>' : ''}${s[1]}</em><small>${s[2]}</small></div>`).join('')}</div>`;
  }
  /* 已收到的页：打勾的小图；大号用在「这一页扫好了」，只画最后三页 */
  function thumbs(n, nextLabel, big) {
    const shown = Math.min(n, big ? 3 : 5), from = n - shown, w = big ? 210 : 86, h = big ? 297 : 122;
    let t = '';
    for (let i = 0; i < shown; i++) t += `<span class="cs-pg">${pageSvg(w, h, from + i)}<i>${icon('check', big ? 26 : 20, 3.4)}</i></span>`;
    if (nextLabel) t += `<span class="cs-pg next"><svg class="dash" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="12" fill="none" stroke="rgba(31,158,134,.55)" stroke-width="3" stroke-dasharray="10 8"/></svg>${big ? icon('plus', 44, 2.4) : ''}<span>${nextLabel}</span></span>`;
    return `<div class="cs-thumbs">${t}</div>`;
  }
  function overlay(h, body, acts) {
    return `<div class="overlay"><div class="dialog"><h2>${h}</h2>${body}<div class="cs-ovacts">${acts}</div></div></div>`;
  }
  const fileName = (c) => `${MATS[c.mat].label}-${c.rec || 3}页.pdf`;
  const fileSize = (c) => ((c.rec || 3) * 0.37).toFixed(1) + ' MB';
  const call = '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>';
  const chev = () => `<span class="chev">${icon('chevR', 30, 2.2)}</span>`;
  const rowBtn = (attr, ic, t, d) => `<button class="cs-row" ${attr}><span class="ic">${icon(ic, 36, 2)}</span><span class="tx"><b>${t}</b><small>${d}</small></span>${chev()}</button>`;

  /* ═════════ 屏上扫描 ═════════ */
  /* 1 扫什么、怎么扫 */
  function scanHow() {
    const c = st(), blocked = scanBlock(), w = blocked ? 'panel' : c.way;
    return shell({
      band: { eyebrow: '屏上扫描', title: '扫什么？怎么扫？', status: scanChip(), rail: { labels: SCAN_RAIL, now: 0 } },
      cls: 'cs-how',
      body: `<div class="sec-t">扫什么？</div>
        <div class="cs-mats">${Object.keys(MATS).map((k) => matTile(k, c.mat === k)).join('')}</div>
        <div class="sec-t">怎么扫？</div>
        <div class="cs-ways">
          ${wayCard({ cs: 'way:screen', on: w === 'screen', dis: !!blocked, chip: blocked ? '' : '推荐', t: '在这块屏上开始扫描', d: blocked || '放好纸，在屏上点开始，扫描仪自己动', vis: scanPaper(150) })}
          ${wayCard({ cs: 'way:panel', on: w === 'panel', t: '到打印机面板上扫', d: '在打印机屏幕上按扫描，文件传回这台机器', vis: mfp() })}
        </div>
        ${S().logged ? '' : `<div class="cs-login"><span>想带走电子版？先扫码登录（微信一扫，不用短信），扫完会存进<span style="white-space:nowrap">「我的文档」</span></span><button class="btn pri" data-go="login">先登录</button></div>`}
        <div class="cs-hold" role="note">${icon('usb', 32, 2)}<span>用 U 盘：在打印机面板上选「扫描到 U 盘」——这台机器暂未开通</span></div>`,
      dock: D({ back: { go: 'print' }, ask: '问小青：扫描和复印有什么不同', pri: pri('下一步', 'data-cs="how-next"') })
    });
  }
  /* 2 放纸与设置 */
  function scanSet() {
    const c = st(), blocked = scanBlock(), m = MATS[c.mat], src = srcOf(c), ink = inkOf(c);
    return shell({
      band: { eyebrow: '屏上扫描 · ' + m.label, title: '纸放哪？扫成黑白还是彩色？', status: scanChip(), rail: { labels: SCAN_RAIL, now: 1 } },
      cls: 'cs-set',
      body: `<div class="sec-t">纸放哪？</div>
        <div class="cs-two">${srcCard('glass', src, 'src')}${srcCard('feeder', src, 'src')}</div>
        <div class="sec-t">黑白还是彩色？</div>
        <div class="seg tall cs-seg">
          <button data-cs="ink:bw" aria-pressed="${ink === 'bw'}">黑白<small>文字材料</small></button>
          <button data-cs="ink:color" aria-pressed="${ink === 'color'}">彩色<small>带照片、带颜色的材料</small></button>
        </div>
        ${howto('多页单面材料用进纸器一次扫完；玻璃台适合证件、书本，一面一面扫')}
        ${blocked ? `<p class="cs-warn">${blocked}。</p>` : ''}
        <button class="cs-link" data-cs="panel"><span class="tx"><b>改用面板扫描</b><small>在打印机屏幕上按扫描，文件传回这台机器</small></span>${chev()}</button>`,
      dock: D({ back: { go: 'cs-scan-how' }, ask: '问小青：纸怎么放', pri: pri('开始扫描', 'data-cs="set-start"', { dis: !!blocked }) })
    });
  }
  /* 3 正在扫描（屏上复印的第 1 步同一个样子：copy 为真时换标题和路径线） */
  function runScreen(copy) {
    const c = st(), none = c.pages === 'none', n = c.rec == null ? 2 : c.rec;
    const third = none ? ['正在扫描', '进行中', '先别动原件'] : ['已收到 ' + n + ' 页', '进行中', '每扫完一整页才加一'];
    const last = copy ? ['整理成预览', '未开始', '扫完后准备给你核对'] : ['生成文件并传回', '未开始', '扫完后合成一个 PDF'];
    return shell({
      band: copy
        ? { eyebrow: '屏上复印', title: '正在扫原件', sub: '先别动原件，扫描仪正在工作。', status: { text: '扫描中' }, rail: { labels: COPY_RAIL, now: 0 } }
        : { eyebrow: '屏上扫描', title: '正在扫描', sub: '先别动原件，扫描仪正在工作。', status: { text: '扫描中' }, rail: { labels: SCAN_RAIL, now: 2 } },
      cls: 'cs-run',
      body: `${psteps([['已收到', '完成', '这台机器收到了扫描请求', 'on'], ['扫描仪已开始', '完成', '扫描仪回报已经开始扫', 'on'], [third[0], third[1], third[2], 'now'], [last[0], last[1], last[2], '']])}
        <div class="cs-hero${none ? ' none' : ''}"><div class="cs-hrow">
          <div class="cs-reader" aria-hidden="true">${pageSvg(none ? 520 : 440, none ? 736 : 622, 0)}<span class="scanline"></span></div>
          <div class="cs-side">
            ${none ? '<div class="cs-spin" aria-hidden="true"></div><b class="cs-big">正在扫描</b>'
              : `<div class="cs-count"><b>${n}</b><span>页</span></div><p class="cs-cap">已收到</p>`}
          </div></div>${none ? '' : thumbs(n, '扫描中')}</div>
        ${armNote()}<p class="cs-fine">每扫完一整页才加一；扫描仪不报就不显示页数</p>`,
      dock: dock({ back: false, ask: '问小青：一直扫不完怎么办', mid: stopBtn(copy ? '停止复印' : '停止扫描') })
    });
  }
  /* 4 这一页扫好了（只在玻璃台方式） */
  function scanMore() {
    const c = st(), n = c.rec == null ? 2 : c.rec, full = n >= 20;
    return shell({
      band: { eyebrow: '屏上扫描 · 玻璃台', title: '这一页扫好了，还有下一页吗？', status: { text: '已收到 ' + n + ' 页' }, rail: { labels: SCAN_RAIL, now: 2 } },
      cls: 'cs-more',
      body: `<div class="cs-strip">${thumbs(n, '下一页', true)}<p>已收到 ${n} 页<small>最多 20 页</small></p></div>
        <div class="cs-ways">
          ${wayCard({ cs: 'more', dis: full, t: '再扫一页', d: full ? '已经到 20 页，不能再加了' : '先把下一页放上玻璃台，字朝下，对齐左上角', vis: glassSvg(150) })}
          ${wayCard({ cs: 'finish', t: '扫完了，生成文件', d: '把已收到的 ' + n + ' 页合成一个 PDF', vis: stack(120, 3, '') })}
        </div>
        ${armNote()}${remind('最多 20 页；10 分钟内没操作会自动结束，并删除已扫的页', 'clock')}`,
      dock: D({ left: stopBtn('停止扫描', true), ask: '问小青：下一页怎么放', pri: pri('扫完了', 'data-cs="finish"') })
    });
  }
  /* 5 正在生成文件 */
  function scanMake() {
    const c = st(), n = c.rec == null ? 3 : c.rec;
    return shell({
      band: { eyebrow: '屏上扫描', title: '正在生成文件', sub: '扫描仪已经扫完，正在把页面合成一个文件。', status: { text: '正在生成文件' }, rail: { labels: SCAN_RAIL, now: 2 } },
      cls: 'cs-make',
      body: `<div class="stagelist">
          <div class="it ok"><span class="ico">${icon('check', 24, 3)}</span>扫描仪已扫完 · 共收到 ${n} 页</div>
          <div class="it now"><span class="ico"></span>生成一个 PDF</div>
          <div class="it"><span class="ico"></span>传回这台机器</div>
        </div>
        <div class="cs-merge">
          <div class="cs-pile" aria-hidden="true">
            <span style="position:absolute;left:0;top:76px;transform:rotate(-6deg)">${pageSvg(300, 424, 1)}</span>
            <span style="position:absolute;left:100px;top:40px;transform:rotate(-1deg)">${pageSvg(300, 424, 2)}</span>
            <span style="position:absolute;left:210px;top:0;transform:rotate(5deg)">${pageSvg(300, 424, 0)}</span>
          </div>
          <div class="cs-facts"><div><b>${n} 页</b><span>刚收到的</span></div><div><b>1 个 PDF</b><span>合成后的文件</span></div><div><b>这台机器</b><span>文件先放在这里</span></div></div>
        </div>
        ${armNote()}<p class="cs-fine">文件传回来之前，请先别离开。</p>`,
      dock: dock({ back: false, ask: '问小青：文件还没出来', mid: stopBtn('停止') })
    });
  }
  /* 6 扫描完成：登录后、没登录两个样子。屏上不放二维码领文件（旁人能拍走），电子版只靠登录后存进「我的文档」。 */
  function scanDone() {
    const c = st(), logged = !!S().logged, id = c.mat === 'id', m = MATS[c.mat], n = c.rec || 3, shown = Math.min(n, 3);
    const isResume = c.mat === 'resume';
    const pgs = Array.from({ length: shown }, (_, i) => `<div class="pgc">${pageSvg(240, 340, i)}第 ${i + 1} 页</div>`).join('') + (n > shown ? `<span class="more">…共 ${n} 页</span>` : '');
    const ai = isResume
      ? rowBtn('data-go="reading"', 'sparkle', 'AI 简历识别', '识别扫描件内容，进入简历诊断与优化')
      : `<button class="cs-row" disabled><span class="ic">${icon('sparkle', 36, 2)}</span><span class="tx"><b>AI 简历识别</b><small>AI 简历识别只对简历扫描开放；这次扫的是「${m.label}」。</small></span></button>`;
    const note = logged
      ? `<div class="cs-saved">${icon('folder', 40, 2)}<span>这份扫描件已存进「我的文档」${c.mini ? '，手机上打开职易达小程序也能看到' : ''}</span></div>`
      : '<p class="cs-warn">未登录扫描件不会进入「我的文档」，请在本次操作内完成打印或识别。<br>要带走电子版，下次先扫码登录再扫。</p>';
    return shell({
      band: { eyebrow: '扫描完成', title: '扫描完成，文件已传回', sub: '先核对文件，再选下一步。', status: { text: '文件已传回' }, rail: { labels: SCAN_RAIL, now: 3 } },
      cls: 'cs-done',
      body: `<div class="cs-file"><div class="cs-fhead"><span class="ft">PDF</span><div class="tx"><b>${fileName(c)}</b><span class="meta">${n} 页 · ${fileSize(c)}</span></div><span class="chips"><span class="chip">${m.label}</span>${id ? '<span class="chip clay">敏感文件 · 自动清理</span>' : ''}</span></div>
          <div class="cs-fpages">${pgs}</div>
          <p class="cs-fine">页数和方向请自己核一下</p></div>
        ${note}
        <div class="cs-rows">
          ${rowBtn('data-go="pii"', 'printer', '拿去打印', '先检查文件和个人信息，再打印')}
          ${ai}
          ${logged ? rowBtn('data-go="my-docs"', 'folder', '前往我的文档', '在「我的文档」里看和管理这份扫描件') : ''}
          ${rowBtn('data-cs="again"', 'refresh', '再扫一份', '回到第一步，重新选材料')}
        </div>
        ${remind('原件还在玻璃台或进纸器里，请取走', 'hand')}`,
      dock: D({ left: '', ask: '问小青：扫描件怎么用', pri: pri('拿去打印', 'data-go="pii"') })
    });
  }

  /* 出错屏：同一个版式。扫描还是复印，跟着刚才走的那条路换写法。 */
  const panelOpt = (copy) => ({ cs: copy ? 'panel-copy' : 'panel', t: copy ? '改用面板复印' : '改用面板扫描', d: copy ? '在打印机屏幕上点复印，不用在这块屏上办' : '在打印机屏幕上按扫描，文件传回这台机器', vis: mfp() });
  const retry = (copy) => (copy ? 'retry-copy' : 'retry');
  function errScreen(o) {
    const c = st(), copy = c.flow === 'copy', opts = o.opts(copy);
    return shell({
      band: { eyebrow: copy ? '屏上复印' : '屏上扫描', title: o.title, sub: o.sub, status: { text: o.chip, warn: 1 } },
      cls: 'cs-err cs-err' + opts.length,
      body: `<div class="cs-why"><span class="vis">${o.art}<i class="warn">${icon('alert', 34, 2.4)}</i></span><div><b>${o.reason[0]}</b><p>${o.reason[1]}</p></div></div>
        <div class="cs-ways">${opts.map(wayCard).join('')}</div>
        ${remind(HELP)}`,
      dock: D({ back: { go: o.back || (copy ? 'cs-copy-set' : 'cs-scan-set') }, ask: o.ask, pri: o.pri(copy) })
    });
  }
  const E = {
    nopaper: {
      title: '进纸器里没有纸', sub: '扫描仪没有在进纸器里找到纸。', chip: '进纸器没有纸', art: feederSvg(220, true),
      reason: ['扫描仪没有在进纸器里找到纸', '放好纸后再试，或者改用玻璃台。'], ask: '问小青：进纸器没纸怎么办',
      opts: (copy) => [
        { cs: retry(copy), t: '放好纸再试', d: '把纸放进进纸器，字朝上，再点一次', vis: feederSvg(150) },
        { cs: copy ? 'glass-copy' : 'glass', t: '改用玻璃台', d: '一次一页，字朝下，对齐左上角', vis: glassSvg(150) },
        panelOpt(copy)
      ],
      pri: (copy) => pri('放好纸再试', `data-cs="${retry(copy)}"`)
    },
    jam: {
      title: '卡纸或盖板没合上', sub: '先处理好，再点“再试”。', chip: '扫描仪报告有故障', art: feederSvg(220),
      reason: ['扫描仪报告：卡纸或盖板没合上', '合上盖板、取出卡住的纸后再试。'], ask: '问小青：卡纸怎么办',
      opts: (copy) => [
        { cs: retry(copy), t: '处理好了，再试', d: '盖板合好、卡住的纸取出来之后，再点一次', vis: glassSvg(150) },
        panelOpt(copy)
      ],
      pri: (copy) => pri('处理好了，再试', `data-cs="${retry(copy)}"`)
    },
    busy: {
      title: '打印机正在忙', sub: '等它空下来再试。', chip: '打印机正在忙', art: mfp(),
      reason: ['打印机正在打印，或有人在打印机屏幕上操作', '等它空下来再点「再试」。'], ask: '问小青：打印机忙要等多久',
      opts: (copy) => [
        { cs: retry(copy), t: '再试', d: '打印机空下来之后，再点一次', vis: scanPaper(150) },
        { go: 'print', t: '取消', d: '先不扫了，回到打印扫描', vis: stack(110, 2, '') }
      ],
      pri: (copy) => pri('再试', `data-cs="${retry(copy)}"`)
    },
    noresp: {
      title: '扫描仪没有响应', sub: '这次扫不了，请换个办法。', chip: '扫描仪没有响应', art: scanPaper(220), back: 'print',
      reason: ['这台机器暂时连不上扫描仪', '我们已经收到提醒，会尽快处理。'], ask: '问小青：扫描仪连不上怎么办',
      opts: (copy) => [panelOpt(copy), { go: 'home', t: '回首页', d: '先去办别的事', vis: stack(110, 2, '') }],
      pri: (copy) => pri(copy ? '改用面板复印' : '改用面板扫描', `data-cs="${copy ? 'panel-copy' : 'panel'}"`)
    },
    timeout: {
      title: '等太久没有结果', sub: '这次没有扫出文件。', chip: '等待超时', art: scanPaper(220), back: 'print',
      reason: ['超过 3 分钟没有收到扫描结果', '这次不会自动重扫。'], ask: '问小青：等太久没结果怎么办',
      opts: (copy) => [
        { cs: copy ? 'restart-copy' : 'restart', t: '重新开始', d: copy ? '回到第一步，重新放原件、选份数' : '回到第一步，重新选材料', vis: copy ? glassSvg(150) : scanPaper(150) },
        panelOpt(copy)
      ],
      pri: (copy) => pri('重新开始', `data-cs="${copy ? 'restart-copy' : 'restart'}"`)
    }
  };
  const errOf = (k) => () => errScreen(E[k]);

  /* 12 已停止 */
  function scanStopped() {
    const c = st(), copy = c.flow === 'copy';
    return shell({
      band: { eyebrow: copy ? '屏上复印' : '屏上扫描', title: copy ? '已停止复印' : '已停止扫描', sub: '这次到这里为止，不会再继续。', status: { text: '已停止', warn: 1 } },
      cls: 'cs-stopped',
      body: `<div class="cs-fact big"><span class="ic">${icon('erase', 40, 2)}</span><b>${copy ? '已停止复印' : '已停止扫描'}，已扫的页已从这台机器删除</b></div>
        <div class="cs-wait"><div class="cs-ring">${ring(1, 480, 26)}<b>90<small>秒</small></b></div>
          <div class="tx"><b>90 秒后才能开始新的${copy ? '复印或扫描' : '扫描'}</b><span>为了不让下一位看到你的材料，90 秒后才能开始新的${copy ? '复印或扫描' : '扫描'}。</span></div></div>
        <div class="cs-fact"><span class="ic">${icon('hand', 36, 2)}</span><b>原件还在玻璃台或进纸器里，请取走</b></div>`,
      dock: D({ back: { go: 'print', label: '回打印扫描' }, ask: '问小青：为什么要等 90 秒', pri: pri('回首页', 'data-go="home"') })
    });
  }
  /* 13 屏上扫描没开通 */
  function scanOff() {
    return shell({
      band: { eyebrow: '屏上扫描', title: '这台机器还不能在屏上开始扫描', sub: '先用打印机面板扫描，文件会传回这台机器。', status: { text: '屏上扫描未开通', warn: 1 } },
      cls: 'cs-off',
      body: `<div class="cs-ways">
          <button class="cs-way big" disabled><span class="vis">${scanPaper(250)}</span><span class="tx"><span class="chip clay">这台机器还没开通</span><h3>在这块屏上开始扫描</h3><p>放好纸，在屏上点开始，扫描仪自己动。这台机器暂时做不到。</p></span><span></span></button>
          <button class="cs-way big" data-cs="panel"><span class="vis">${mfp()}</span><span class="tx"><span class="chip">现在可以用</span><h3>到打印机面板上扫</h3><p>在打印机屏幕上按扫描，文件传回这台机器。</p></span><span class="arrow">${icon('arrowR', 30, 2.4)}</span></button>
        </div>
        ${remind(HELP)}`,
      dock: D({ back: { go: 'print' }, ask: '问小青：面板上怎么扫', pri: pri('到打印机面板上扫', 'data-cs="panel"') })
    });
  }

  /* ═════════ 屏上复印 ═════════ */
  /* 14 怎么复印 */
  function copyHow() {
    const blocked = copyBlock(), off = printerOff();
    return shell({
      band: { eyebrow: '复印', title: '怎么复印？', status: copyChip(), rail: { labels: COPY_RAIL, now: -1 } },
      cls: 'cs-chow',
      body: `<div class="cs-ways">
          ${wayCard({ big: 1, go: 'copy', chip: '最快', t: '在打印机面板上快速复印', d: '身份证复印、票据复印也在面板上', vis: mfp() })}
          ${wayCard({ big: 1, cs: 'copy-screen', dis: !!blocked || off, chip: blocked || off ? '' : '可先看效果', t: '在这块屏上复印', d: blocked || (off ? '这台机器暂时打不了，先用面板复印' : '先看扫描效果再打印，能改份数，彩色原件也能印成黑白；比面板慢；扫描件只在这台机器上处理，不上传'), vis: scanPaper(250) })}
        </div>
        ${remind('不得复印伪造的证件、印章、票据。只能复印本人的真实证件和票据。', 'shield')}`,
      dock: D({ back: { go: 'print' }, ask: '问小青：怎么复印更合适' })
    });
  }
  /* 15 复印设置 */
  function copySet() {
    const c = st(), off = printerOff(), n = c.copies, colorOff = c.color === 'off', dupOff = c.duplex === 'off';
    const cink = colorOff ? 'bw' : c.cink, dup = dupOff ? 'single' : c.dup;
    const off2 = (label) => `<button disabled>${label}<small>本机暂未开通</small></button>`;
    return shell({
      band: { eyebrow: '屏上复印', title: '放好原件，选份数', status: copyChip(), rail: { labels: COPY_RAIL, now: 0 } },
      cls: 'cs-cset',
      body: `<div class="sec-t">原件放哪？</div>
        <div class="cs-two">${srcCard('glass', c.orig, 'corig')}${srcCard('feeder', c.orig, 'corig')}</div>
        <div class="cs-params">
          <div class="prow"><span>份数</span><div class="cs-stepx"><button data-cs="copies:-10" aria-label="少十份" ${n <= 1 ? 'disabled' : ''}>−10</button><button data-cs="copies:-1" aria-label="少一份" ${n <= 1 ? 'disabled' : ''}>${icon('minus', 34, 2.6)}</button><output>${n}<small>份</small></output><button data-cs="copies:1" aria-label="多一份" ${n >= 99 ? 'disabled' : ''}>${icon('plus', 34, 2.6)}</button><button data-cs="copies:10" aria-label="多十份" ${n >= 99 ? 'disabled' : ''}>+10</button><span class="cap">1–99 份</span></div></div>
          <div class="prow"><span>颜色</span><div class="seg cs-seg"><button data-cs="cink:bw" aria-pressed="${cink === 'bw'}">黑白</button>${colorOff ? off2('彩色') : `<button data-cs="cink:color" aria-pressed="${cink === 'color'}">彩色</button>`}</div></div>
          <div class="prow"><span>单双面</span><div class="seg cs-seg"><button data-cs="dup:single" aria-pressed="${dup === 'single'}">单面</button>${dupOff ? off2('双面') : `<button data-cs="dup:double" aria-pressed="${dup === 'double'}">双面</button>`}</div></div>
        </div>
        <p class="cs-fine">原件几页，扫完才知道；扫完会给你核对</p>
        ${off ? `<p class="cs-warn">${MACHINE}</p>` : ''}`,
      dock: D({ back: { go: 'cs-copy-how' }, ask: '问小青：份数怎么选', pri: pri(off ? '打印机离线' : '开始复印', 'data-cs="copy-start"', { dis: off }) })
    });
  }
  /* 17 核对复印 */
  function copyCheck() {
    const c = st(), off = printerOff(), p = c.cpages || 3, n = c.copies, total = p * n, shown = Math.min(p, 3);
    const dup = c.duplex === 'off' ? 'single' : c.dup, cink = c.color === 'off' ? 'bw' : c.cink;
    const sheets = dup === 'double' ? Math.ceil(total / 2) : total;
    return shell({
      band: { eyebrow: '屏上复印', title: '核对一下，再开始打印', status: { text: '原件已扫完，等你核对' }, rail: { labels: COPY_RAIL, now: 1 } },
      cls: 'cs-check',
      body: `<div class="cs-pages"><div class="cs-prow">${Array.from({ length: shown }, (_, i) => `<div class="pgc">${pageSvg(290, 410, i)}第 ${i + 1} 页 / 共 ${p} 页</div>`).join('')}</div>
          <div class="cs-pfacts"><div>原件 ${p} 页 × ${n} 份 = ${total} 页</div><div>${dup === 'double' ? '双面打印，用' : '单面打印，用'} ${sheets} 张纸</div><div>${cink === 'bw' ? '黑白' : '彩色'}</div><div>本机构免费</div></div></div>
        ${howto('发现身份证号等个人信息时，会先问你保留还是遮挡', 'shield')}
        ${howto('扫描件只在这台机器上，打印完就删除', 'lock')}
        ${off ? `<p class="cs-warn">${MACHINE}</p>` : ''}`,
      dock: D({ left: `<button class="btn sec" data-cs="rescan">${icon('refresh', 28, 2)}重扫</button>`, ask: '问小青：核对什么', pri: pri(off ? '打印机离线' : '开始打印', 'data-cs="copy-print"', { dis: off }) })
    });
  }
  /* 18 复印 · 正在打印 */
  function copyPrint() {
    const c = st(), s3 = c.pstage !== 2;
    const steps = [
      ['已收到', '完成', '这台机器收到了打印请求', 'on'],
      ['正在交给打印机', s3 ? '完成' : '进行中', '把要印的页交给打印机', s3 ? 'on' : 'now'],
      ['打印机正在出纸', s3 ? '进行中' : '未开始', '纸从出纸口出来', s3 ? 'now' : ''],
      ['已交给打印机', '未开始', '页都交给打印机之后', '']
    ];
    return shell({
      band: { eyebrow: '屏上复印', title: '正在打印', sub: '复印件会从出纸口出来，请留在机器旁。', status: { text: s3 ? '打印机正在出纸' : '正在交给打印机' }, rail: { labels: COPY_RAIL, now: 2 } },
      cls: 'cs-cprint' + (s3 ? ' printing' : ''),
      body: `${psteps(steps)}
        <div class="cs-hero"><div class="cs-printer ${s3 ? 'cs-out' : ''}">${mfp()}${s3 ? '<span class="cs-sheet"></span><span class="cs-sheet b"></span><span class="cs-sheet c"></span>' : ''}</div></div>
        <p class="cs-fine">出了几张，以出纸口为准</p>`,
      dock: dock({ back: false, ask: '问小青：纸没出来怎么办' })
    });
  }
  /* 19 复印完成 */
  function copyDone() {
    return shell({
      band: { eyebrow: '屏上复印', title: '请到出纸口取走复印件', status: { text: '已交给打印机' }, rail: { labels: COPY_RAIL, now: 3 } },
      cls: 'cs-cdone',
      body: `<div class="cs-remind-big">${icon('hand', 64, 1.8)}<span>原件还在玻璃上或进纸器里，请和复印件一起带走</span></div>
        <div class="cs-take"><div class="cs-printer">${mfp()}<span class="cs-sheet"></span><span class="cs-sheet b"></span><span class="cs-sheet c"></span></div>
          <div class="tt"><span class="tray-arrow">${icon('arrowD', 72, 2.4)}</span><b>出纸口在下面</b><span>先看出纸口，再看玻璃台和进纸器。</span></div></div>
        <div class="cs-help">${icon('call', 34, 2)}<span>没出纸？看打印机屏幕上的提示，或拨打服务电话 ${PHONE}。这次不会自动重打，也不会重复收费</span></div>`,
      dock: D({ left: '', ask: '问小青：怎么取纸', pri: `<button class="btn danger" data-cs="end" style="flex:none;min-width:360px">${icon('erase', 32, 2.2)}拿到了，结束</button>` })
    });
  }
  /* 20 结果没确认 */
  function copyUnconfirmed() {
    const c = st();
    const ov = c.tel ? overlay('服务电话', `<div class="cs-tel">${PHONE}</div><p>请用自己的手机拨打。服务时间：工作日 9:00–18:00</p>`, '<button class="btn pri" data-cs="telclose">知道了</button>') : '';
    return shell({
      band: { eyebrow: '屏上复印', title: '这次没收到打印结果', sub: '先看出纸口；这次不会自动重打', status: { text: '没收到打印结果', warn: 1 } },
      cls: 'cs-unc',
      body: `<div class="steps3 big" style="grid-template-columns:1fr;gap:12px">
          <div class="s"><span class="n">1</span><b>先看出纸口是否已有纸张</b><small>没收到打印结果，不能确定纸有没有出来。</small></div>
          <div class="s"><span class="n">2</span><b>这次不会自动重打，先别再点复印</b><small>不猜成功也不猜失败，免得多印。</small></div>
          <div class="s"><span class="n">3</span><b>需要帮助？拨打服务电话 ${PHONE}</b><small>服务时间：工作日 9:00–18:00</small></div>
        </div>
        <div class="cs-ways">
          ${wayCard({ cs: 'end', t: '纸出来了，结束', d: '看到复印件了，就结束这次使用', vis: stack(130, 2, '') })}
          ${wayCard({ cs: 'tel', t: '需要帮助，拨打服务电话', d: '看服务电话和服务时间', vis: `<span style="color:var(--teal-ink)"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:160px;height:160px;max-width:none" aria-hidden="true">${call}</svg></span>` })}
        </div>`,
      dock: D({ left: '', ask: '问小青：取纸或异常怎么办', pri: pri('纸出来了，结束', 'data-cs="end"', { noArrow: true }) }),
      overlay: ov
    });
  }
  /* 21 屏上复印没开通 */
  function copyOff() {
    return shell({
      band: { eyebrow: '复印', title: '这台机器暂时只能在打印机面板上复印', sub: '面板上的复印、身份证复印、票据复印都能用。', status: { text: '屏上复印未开通', warn: 1 } },
      cls: 'cs-coff',
      body: `<div class="cs-ways">
          <button class="cs-way big" disabled><span class="vis">${scanPaper(250)}</span><span class="tx"><span class="chip clay">这台机器还没开通</span><h3>在这块屏上复印</h3><p>先看扫描效果再打印、能改份数。这台机器暂时做不到。</p></span><span></span></button>
          <button class="cs-way big" data-go="copy"><span class="vis">${mfp()}</span><span class="tx"><span class="chip">现在可以用</span><h3>在打印机面板上复印</h3><p>复印、身份证复印、票据复印，都在打印机屏幕上点。</p></span><span class="arrow">${icon('arrowR', 30, 2.4)}</span></button>
        </div>
        ${remind(HELP)}`,
      dock: D({ back: { go: 'cs-copy-how' }, ask: '问小青：面板上怎么复印', pri: pri('怎么在打印机上复印', 'data-go="copy"') })
    });
  }

  /* ═════════ 设备状态（细分） ═════════ */
  function device() {
    const c = st(), stale = c.scanner === 'stale' || c.device === 'stale';
    const staleRow = ['scan', '扫描仪 · 状态过期（3 分钟前）', '能不能在屏上扫描，现在不知道', '不算就绪', '', 1];
    const rows = [
      ['refresh', '终端程序', '这台机器上的服务程序', '在线', '10 秒前检查'],
      ['printer', '打印机', '能出纸', '就绪', '10 秒前检查'],
      stale ? staleRow : ['scan', '扫描仪', '能在屏上扫描', '就绪', '20 秒前检查'],
      ['folder', '面板扫描接收', '在打印机面板上扫的文件，能传回这台机器', '就绪', '开机时检查']
    ];
    const row = (r) => `<div class="cs-dev${r[5] ? ' stale' : ''}"><span class="ic">${icon(r[0], 38, 2)}</span><span><b>${r[1]}</b><small>${r[2]}</small></span><span class="st"><span class="chip${r[5] ? ' mute' : ''}">${r[3]}</span>${r[4] ? `<span class="when">${r[4]}</span>` : ''}</span></div>`;
    const can = [
      ['屏上扫描', stale ? '扫描仪状态过期，先用面板扫描' : '扫描仪就绪时可用', stale ? ['暂不能用', 'mute'] : ['可用', '']],
      ['屏上复印', stale ? '扫描仪状态过期，先用面板复印' : '扫描仪和打印机都就绪时可用', stale ? ['暂不能用', 'mute'] : ['可用', '']],
      ['面板扫描', '面板扫描接收就绪时可用', ['可用', '']]
    ];
    const tail = stale
      ? `<p class="cs-warn">扫描仪状态过期：屏上扫描和屏上复印先停，先用打印机面板。</p>
         <button class="cs-link" data-cs="panel"><span class="tx"><b>改用面板扫描</b><small>在打印机屏幕上按扫描，文件传回这台机器</small></span>${chev()}</button>`
      : `<div class="sec-t">如果某一项超过 1 分钟没更新，会这样显示</div>${row(staleRow)}`;
    return shell({
      band: { eyebrow: '设备状态', title: '这台机器现在能做什么', sub: '每一项都写着什么时候检查的。', status: stale ? { text: '有一项状态已过期', warn: 1 } : { text: '各项就绪' } },
      cls: 'cs-device',
      body: `<div class="cs-devs">${rows.map(row).join('')}</div>${tail}
        <div class="sec-t">这些状态决定了什么</div>
        <div class="cs-can">${can.map((x) => `<div><b>${x[0]}</b><span class="d">${x[1]}</span><span class="chip ${x[2][1]}">${x[2][0]}</span></div>`).join('')}</div>
        <p class="cs-fine">超过 1 分钟没更新的状态，不算就绪</p>`,
      dock: D({ back: { go: 'home', label: '返回首页' }, ask: '问小青：设备状态怎么看', pri: `<button class="btn pri" data-act="toast" data-arg="演示：重新检测">重新检测${icon('refresh', 28, 2.2)}</button>` })
    });
  }

  /* ═════════ 点击与演示事件 ═════════ */
  function toPanel(copy) {
    const c = st();
    if (copy) return go('copy');
    S().fsType = MATS[c.mat].fs;
    return go('scan-type');
  }
  function act(k) {
    const c = st(), a = k.split(':')[0], v = k.split(':')[1];
    switch (a) {
      case 'mat': c.mat = v; return refresh();
      case 'way': c.way = v; return refresh();
      case 'how-next': { if (!scanBlock() && c.way === 'screen') { c.flow = 'scan'; return go('cs-scan-set'); } return toPanel(false); }
      case 'panel': return toPanel(false);
      case 'panel-copy': return toPanel(true);
      case 'src': c.src = v; return refresh();
      case 'ink': c.ink = v; return refresh();
      case 'set-start': c.flow = 'scan'; c.rec = srcOf(c) === 'glass' ? 0 : 2; return go('cs-scan-run');
      case 'more': return go('cs-scan-run');
      case 'finish': return go('cs-scan-make');
      case 'retry': return go('cs-scan-run');
      case 'retry-copy': return go('cs-copy-scan');
      case 'glass': c.src = 'glass'; return go('cs-scan-set');
      case 'glass-copy': c.orig = 'glass'; return go('cs-copy-set');
      case 'restart': return go('cs-scan-how');
      case 'restart-copy': return go('cs-copy-set');
      case 'again': c.rec = null; return go('cs-scan-how');
      case 'stop': {
        if (!c.stopArm) { c.stopArm = true; return refresh(); }
        c.rec = null; return go('cs-scan-stopped');
      }
      case 'copies': c.copies = Math.min(99, Math.max(1, c.copies + (+v))); return refresh();
      case 'corig': c.orig = v; return refresh();
      case 'cink': c.cink = v; return refresh();
      case 'dup': c.dup = v; return refresh();
      case 'copy-screen': c.flow = 'copy'; return go('cs-copy-set');
      case 'copy-start': case 'rescan': c.flow = 'copy'; c.rec = c.orig === 'glass' ? 0 : 2; c.cpages = 3; return go('cs-copy-scan');
      case 'copy-print': c.pstage = 3; return go('cs-copy-print');
      case 'tel': c.tel = true; return refresh();
      case 'telclose': c.tel = false; return refresh();
      case 'end': return window.doClear();
    }
  }
  /* 说明栏里的「演示事件」：硬件和后台的回报，屏上不放这些按钮 */
  const ERRS = { nopaper: 'cs-scan-err-nopaper', jam: 'cs-scan-err-jam', busy: 'cs-scan-err-busy', noresp: 'cs-scan-err-noresp', timeout: 'cs-scan-timeout' };
  function onDemo(id, ev) {
    const c = st();
    if (ERRS[ev]) return go(ERRS[ev]);
    switch (ev) {
      case 'stale': c.scanner = 'stale'; return refresh();
      case 'ok': c.scanner = 'ok'; c.scandev = 'on'; c.copydev = 'on'; c.device = 'ok'; c.pages = 'known'; return refresh();
      case 'scandev-off': c.scandev = 'off'; return refresh();
      case 'copydev-off': c.copydev = 'off'; return refresh();
      case 'nopages': c.pages = 'none'; return refresh();
      case 'pages': c.pages = 'known'; return refresh();
      case 'pagedone': c.rec = (c.rec == null ? 2 : c.rec) + 1; return go('cs-scan-more');
      case 'alldone': c.rec = Math.max(3, c.rec || 0); return go('cs-scan-make');
      case 'made': return go('cs-scan-done');
      case 'mini-on': c.mini = true; return refresh();
      case 'mini-off': c.mini = false; return refresh();
      case 'copy-scanned': c.cpages = 3; return go('cs-copy-check');
      case 'coloroff': c.color = 'off'; return refresh();
      case 'duplexoff': c.duplex = 'off'; return refresh();
      case 'allon': c.color = 'on'; c.duplex = 'on'; return refresh();
      case 'stage2': c.pstage = 2; return refresh();
      case 'stage3': c.pstage = 3; return refresh();
      case 'handed': return go('cs-copy-done');
      case 'noresult': return go('cs-copy-unconfirmed');
    }
  }
  const demoErrs = [
    { label: '演示：进纸器没有纸', ev: 'nopaper' }, { label: '演示：卡纸或盖板没合上', ev: 'jam' }, { label: '演示：打印机正在忙', ev: 'busy' },
    { label: '演示：扫描仪没有响应', ev: 'noresp' }, { label: '演示：等太久没有结果', ev: 'timeout' }
  ];
  const demos = {
    'cs-scan-how': [{ label: '演示：扫描仪状态过期', ev: 'stale' }, { label: '演示：没开通屏上扫描', ev: 'scandev-off' }, { label: '演示：恢复正常', ev: 'ok' }],
    'cs-scan-set': [{ label: '演示：扫描仪状态过期', ev: 'stale' }, { label: '演示：没开通屏上扫描', ev: 'scandev-off' }, { label: '演示：恢复正常', ev: 'ok' }],
    'cs-scan-run': [{ label: '演示：扫描仪不回报页数', ev: 'nopages' }, { label: '演示：页数恢复', ev: 'pages' }, { label: '演示：这一页扫好了（玻璃台）', ev: 'pagedone' }, { label: '演示：整叠扫完了（进纸器）', ev: 'alldone' }].concat(demoErrs),
    'cs-scan-more': [{ label: '演示：等太久没操作', ev: 'timeout' }],
    'cs-scan-make': [{ label: '演示：文件传回来了', ev: 'made' }],
    'cs-scan-done': [{ label: '演示：小程序还没发布（收起「手机上也能看到」）', ev: 'mini-off' }, { label: '演示：小程序已发布', ev: 'mini-on' }],
    'cs-copy-how': [{ label: '演示：没开通屏上复印', ev: 'copydev-off' }, { label: '演示：扫描仪状态过期', ev: 'stale' }, { label: '演示：恢复正常', ev: 'ok' }],
    'cs-copy-set': [{ label: '演示：彩色没开通', ev: 'coloroff' }, { label: '演示：双面没开通', ev: 'duplexoff' }, { label: '演示：都恢复', ev: 'allon' }],
    'cs-copy-scan': [{ label: '演示：原件扫完了', ev: 'copy-scanned' }, { label: '演示：扫描仪不回报页数', ev: 'nopages' }, { label: '演示：页数恢复', ev: 'pages' }].concat(demoErrs),
    'cs-copy-print': [{ label: '演示：正在交给打印机（还没出纸）', ev: 'stage2' }, { label: '演示：打印机正在出纸', ev: 'stage3' }, { label: '演示：已交给打印机', ev: 'handed' }, { label: '演示：这次没收到打印结果', ev: 'noresult' }],
    'cs-device': [{ label: '演示：扫描仪状态过期', ev: 'stale' }, { label: '演示：恢复正常', ev: 'ok' }]
  };
  /* 打开某一屏时，记下它属于扫描还是复印，出错屏照这个换写法 */
  const FLOW = (id) => (/^cs-copy-/.test(id) ? 'copy' : (/^cs-scan-(how|set|run|more|make|done|off)$/.test(id) ? 'scan' : ''));
  function mount(el) {
    const c = st(), id = el.dataset.id;
    if (FLOW(id)) c.flow = FLOW(id);
    let t = null;
    if (c.stopArm) t = setTimeout(() => { c.stopArm = false; refresh(); }, 6000);
    const onClick = (e) => {
      const b = e.target.closest('[data-cs]');
      if (!b || !el.contains(b) || b.disabled) return;
      e.stopPropagation();
      act(b.dataset.cs);
    };
    const onLeave = (e) => { if (e.target.closest('[data-go],[data-act="back"]')) { c.stopArm = false; c.tel = false; } };
    const onEv = (e) => onDemo(id, e.detail);
    el.addEventListener('click', onLeave, true);
    el.addEventListener('click', onClick);
    el.addEventListener('proto-demo', onEv);
    return () => { clearTimeout(t); el.removeEventListener('click', onLeave, true); el.removeEventListener('click', onClick); el.removeEventListener('proto-demo', onEv); };
  }

  /* ═════════ 注册 ═════════ */
  const reg = (id, group, name, render, notes) => window.SCREENS.push({ id, group, name, render, mount, demo: demos[id], notes });
  const NK = '现场无人值守：屏上不写「找工作人员」一类说法，出错只给自助出路和「需要帮助？拨打服务电话」，号码照定稿写法，运行时与服务时间一起从后台读，读不到不显示。不写打印机品牌型号，不写开发用语。';

  reg('cs-scan-how', G_SCAN, '扫什么、怎么扫', scanHow, {
    does: '屏上扫描的第一问：扫什么（简历 / 证件 / 普通文档 / 合同）、怎么扫（在这块屏上开始 / 到打印机面板上扫）。选好点「下一步」。',
    motion: '无。选中只改边框和打勾。',
    keep: '状态「扫描仪就绪 · 20 秒前检查」。证件带「敏感文件 · 自动清理」。「在这块屏上开始扫描」标「推荐」。两个样子：地址 ?scanner=stale（或演示事件）时屏上方式灰掉，写「扫描仪状态 2 分钟没更新，先用面板扫描」；?scandev=off 时写「这台机器还没开通屏上扫描」。选面板扫描，「下一步」带着已选的材料去定稿现有的面板扫描选类型屏（scan-type）。合同在面板扫描里按普通文档处理。底部两行：没登录的人多一行「想带走电子版？先扫码登录（微信一扫，不用短信），扫完会存进「我的文档」」加「先登录」按钮，去定稿现有的登录屏（login），登录成功回到这一屏；跟说明栏「已登录」开关走，登录后这行不显示。另一行灰掉、不能点：用 U 盘（在打印机面板上选「扫描到 U 盘」）——这台机器暂未开通，真机试通之前照实写暂未开通。不做「扫码带走电子版」：屏上的码会被旁人拍走。每屏可点：4 个材料 + 2 个方式 + 底部 3 个共 9 个（没登录再加「先登录」共 10 个），超过 7 个是这一屏要一次问两件事造成的。' + NK
  });
  reg('cs-scan-set', G_SCAN, '放纸与设置', scanSet, {
    does: '放纸与设置：纸放玻璃台还是进纸器、扫成黑白还是彩色，然后开始扫描。',
    motion: '无。',
    keep: '玻璃台写「一次一页，适合证件、书本」「字朝下，对齐左上角」；进纸器写「一叠最多 50 页，只扫单面」「字朝上」。提示：多页单面材料用进纸器一次扫完；玻璃台适合证件、书本，一面一面扫。默认：证件用玻璃台和彩色，其余用进纸器和黑白，点了就记住。次要入口「改用面板扫描」去 scan-type。扫描仪状态过期或没开通时，「开始扫描」停用并写原因。' + NK
  });
  reg('cs-scan-run', G_SCAN, '正在扫描', () => runScreen(false), {
    does: '扫描进行中。四段进度：已收到 → 扫描仪已开始 → 已收到 N 页 → 生成文件并传回，第三段进行中。',
    motion: '只有纸上的扫描光带和第三段的小圆点在动，别的都静止。可一键减弱动效。',
    keep: '页数写「已收到 N 页」，不写「已扫」；小字「每扫完一整页才加一；扫描仪不报就不显示页数」。地址 ?pages=none（或演示事件）是扫描仪不回报页数：只写「正在扫描」，不编数字和百分比。「停止扫描」要点两次：第一次变成「再点一次确认停止」并提示已收到的页会删除，6 秒不点自动取消。出错屏、这一页扫好了、扫完了都从说明栏下面的演示事件打开，也可以直接用地址 #cs-scan-err-nopaper 等打开。' + NK
  });
  reg('cs-scan-more', G_SCAN, '这一页扫好了', scanMore, {
    does: '只在玻璃台方式出现：一页扫好后问还有没有下一页。',
    motion: '无。',
    keep: '状态「已收到 N 页」。「再扫一页」要先把下一页放上玻璃台；「扫完了，生成文件」去生成。提醒：最多 20 页；10 分钟内没有操作会自动结束，并删除已扫的页。到 20 页时「再扫一页」停用。底部左边是「停止扫描」，也要点两次。' + NK
  });
  reg('cs-scan-make', G_SCAN, '正在生成文件', scanMake, {
    does: '扫描仪扫完后，把页面合成一个 PDF 并传回这台机器。',
    motion: '只有「生成一个 PDF」前的小圈在转。',
    keep: '三步：扫描仪已扫完（共收到 N 页，打勾）→ 生成一个 PDF（进行中）→ 传回这台机器。可「停止」，要点两次。文件传回靠演示事件「文件传回来了」去 cs-scan-done，屏上不自己跳成功。' + NK
  });
  reg('cs-scan-done', G_SCAN, '扫描完成', scanDone, {
    does: '扫描完成，文件已传回。核对后选下一步：拿去打印 / AI 简历识别（只简历）/ 前往我的文档（登录后）/ 再扫一份。分登录后、没登录两个样子，用说明栏「已登录」切换。',
    motion: '无。',
    keep: '「扫描完成，文件已传回」只在这一屏写。文件卡写文件名、页数、大小，下面是每一页的小图，小字「页数和方向请自己核一下」。拿去打印去定稿现有的材料检查屏 pii；AI 简历识别只有扫的是简历才能点，去 reading，其他材料灰掉并写「AI 简历识别只对简历扫描开放」。登录后：文件卡下一句醒目的「这份扫描件已存进「我的文档」，手机上打开职易达小程序也能看到」，去向多一项「前往我的文档」；后半句「手机上打开职易达小程序也能看到」属于「手机上能看到」类句子，小程序正式发布前由开关收起，只显示前半句，演示事件可切换这两种；这条「后半句要等小程序发布后才显示」的小注写在说明栏，不写在屏上。没登录：不进「我的文档」，原句「未登录扫描件不会进入「我的文档」，请在本次操作内完成打印或识别」，再加「要带走电子版，下次先扫码登录再扫」。不做「扫码带走电子版」，屏上不画二维码（屏上的码会被旁人拍走）。原件提醒：原件还在玻璃台或进纸器里，请取走。小程序一律写「职易达」。' + NK
  });
  reg('cs-scan-err-nopaper', G_SCAN, '出错：进纸器里没有纸', errOf('nopaper'), {
    does: '扫描仪回报进纸器里没有纸。照状态样式板的版式。',
    motion: '无。',
    keep: '选项：放好纸再试 / 改用玻璃台 / 改用面板扫描，再加服务电话句。出错屏按刚才走的是扫描还是复印换写法：复印时「再试」回复印第 1 步，「改用面板」去定稿现有的面板复印屏 copy。' + NK
  });
  reg('cs-scan-err-jam', G_SCAN, '出错：卡纸或盖板没合上', errOf('jam'), {
    does: '扫描仪回报卡纸或盖板没合上。',
    motion: '无。',
    keep: '原话：扫描仪报告：卡纸或盖板没合上；合上盖板、取出卡住的纸后再试。选项：处理好了，再试 / 改用面板扫描，再加服务电话句。' + NK
  });
  reg('cs-scan-err-busy', G_SCAN, '出错：打印机正在忙', errOf('busy'), {
    does: '打印机正在打印，或有人在打印机屏幕上操作，扫描仪暂时用不了。',
    motion: '无。',
    keep: '原话：打印机正在打印，或有人在打印机屏幕上操作；等它空下来再点「再试」。选项：再试 / 取消（取消回打印扫描）。这是等一等就好的情况，不放服务电话句。' + NK
  });
  reg('cs-scan-err-noresp', G_SCAN, '出错：扫描仪没有响应', errOf('noresp'), {
    does: '这台机器暂时连不上扫描仪。',
    motion: '无。',
    keep: '原话：这台机器暂时连不上扫描仪，我们已经收到提醒，会尽快处理。选项：改用面板扫描 / 回首页，再加服务电话句。' + NK
  });
  reg('cs-scan-timeout', G_SCAN, '出错：等太久没有结果', errOf('timeout'), {
    does: '等了超过 3 分钟没有收到扫描结果。',
    motion: '无。',
    keep: '原话：超过 3 分钟没有收到扫描结果，这次不会自动重扫。选项：重新开始 / 改用面板扫描。不自己重扫，也不判成功。' + NK
  });
  reg('cs-scan-stopped', G_SCAN, '已停止', scanStopped, {
    does: '用户确认停止之后：已收到的页从这台机器删除，并锁一段时间不能开始新的扫描。',
    motion: '倒计时数字这里静态画；运行时每秒减一。',
    keep: '原话：已停止扫描，已扫的页已从这台机器删除；为了不让下一位看到你的材料，90 秒后才能开始新的扫描。选项：回打印扫描 / 回首页。复印中停止时标题换成「已停止复印」。' + NK
  });
  reg('cs-scan-off', G_SCAN, '屏上扫描没开通', scanOff, {
    does: '这台机器还没开通屏上扫描：说清楚，并把面板扫描放成主按钮。',
    motion: '无。',
    keep: '主按钮「到打印机面板上扫」去定稿现有的面板扫描选类型屏。屏上方式灰掉、写「这台机器还没开通」，不装成可点。可用地址 #cs-scan-off 直接打开。' + NK
  });

  reg('cs-copy-how', G_COPY, '怎么复印', copyHow, {
    does: '复印的第一问：在打印机面板上快速复印，还是在这块屏上复印。两条路点了就走。',
    motion: '无。',
    keep: '第一条「在打印机面板上快速复印」标「最快」，写「身份证复印、票据复印也在面板上」，点了去定稿现有的「怎么在打印机上复印」（copy）。第二条「在这块屏上复印」标「可先看效果」，写「先看扫描效果再打印，能改份数，彩色原件也能印成黑白；比面板慢；扫描件只在这台机器上处理，不上传」。没有「推荐」字样。底部边界句：不得复印伪造的证件、印章、票据，只能复印本人的真实证件和票据。屏上复印没开通、扫描仪状态过期、打印机离线时第二条灰掉并写原因。' + NK
  });
  reg('cs-copy-set', G_COPY, '复印设置', copySet, {
    does: '放好原件，选份数、颜色、单面还是双面，然后开始复印。',
    motion: '无。',
    keep: '原件：玻璃台 / 进纸器。份数 1–99，−10 / −1 / +1 / +10。颜色黑白 / 彩色；打印成单面 / 双面。地址 ?color=off、?duplex=off（或演示事件）时对应选项灰掉，写「本机暂未开通」。小字「原件几页，扫完才知道；扫完会给你核对」。打印机离线时主按钮写「打印机离线」并停用。每屏可点数多，是因为这里有 4 组设置，和定稿的预览与设置屏同类。' + NK
  });
  reg('cs-copy-scan', G_COPY, '复印第 1 步：正在扫原件', () => runScreen(true), {
    does: '复印第 1 步：扫原件。样子同「正在扫描」，标题和路径线换成复印。',
    motion: '同 cs-scan-run：只有扫描光带和小圆点在动。',
    keep: '路径线：扫原件 → 核对 → 打印 → 取走，当前在第 1 步。页数写「已收到 N 页」，扫描仪不报就不显示。「停止复印」要点两次。原件扫完靠演示事件去核对；出错屏同扫描，按复印换写法。' + NK
  });
  reg('cs-copy-check', G_COPY, '核对复印', copyCheck, {
    does: '复印第 2 步：核对页面和数量，再开始打印。',
    motion: '无。',
    keep: '事实格：原件 N 页 × 份数 = 总页数；单面或双面用几张纸；黑白或彩色；本机构免费。小字：发现身份证号等个人信息时，会先问你保留还是遮挡；扫描件只在这台机器上，打印完就删除。「重扫」回第 1 步。双面用纸张数按总页数除以二向上取整，改程序时要和真实打印任务的算法对一下。' + NK
  });
  reg('cs-copy-print', G_COPY, '复印第 3 步：正在打印', copyPrint, {
    does: '复印第 3 步：打印。四段：已收到 → 正在交给打印机 → 打印机正在出纸 → 已交给打印机。',
    motion: '出纸动画只在第三段「打印机正在出纸」：纸一张一张从出纸口落进托盘，每张 760 毫秒，错开出来；运行时张数跟打印机回报走。第二段不出纸、不动。',
    keep: '小字「出了几张，以出纸口为准」。系统不知道用户是否拿到纸，所以不写「已出纸」「复印完成」。演示事件：正在交给打印机 / 打印机正在出纸 / 已交给打印机（去完成）/ 这次没收到打印结果（去未确认）。' + NK
  });
  reg('cs-copy-done', G_COPY, '复印第 4 步：取走', copyDone, {
    does: '复印第 4 步：到出纸口取走复印件，别落下原件。',
    motion: '出纸口箭头不动（打印已交出，没有进行中的事）。',
    keep: '状态「已交给打印机」，标题「请到出纸口取走复印件」，不写「打印机回报已完成」「复印完成」。大提醒卡：原件还在玻璃上或进纸器里，请和复印件一起带走。补一句：没出纸？看打印机屏幕上的提示，或拨打服务电话；这次不会自动重打，也不会重复收费。主按钮「拿到了，结束」按一下就结束本次使用。' + NK
  });
  reg('cs-copy-unconfirmed', G_COPY, '复印：结果没确认', copyUnconfirmed, {
    does: '打印交出去之后没收到打印结果。不猜成功也不猜失败。',
    motion: '无。',
    keep: '原话：这次没收到打印结果。先看出纸口；这次不会自动重打。选项：纸出来了，结束 / 需要帮助，拨打服务电话（点开看号码和服务时间）。不自动重打、不重复收费。' + NK
  });
  reg('cs-copy-off', G_COPY, '屏上复印没开通', copyOff, {
    does: '这台机器还没开通屏上复印：说清楚，并把面板复印放成主按钮。',
    motion: '无。',
    keep: '主按钮「怎么在打印机上复印」去定稿现有的 copy。屏上方式灰掉、写「这台机器还没开通」。可用地址 #cs-copy-off 直接打开。' + NK
  });

  reg('cs-device', G_DEV, '设备状态（细分）', device, {
    does: '设备状态细分：终端程序、打印机、扫描仪、面板扫描接收，每一项都写检查时间。',
    motion: '无。',
    keep: '终端程序在线（10 秒前）、打印机就绪（10 秒前）、扫描仪就绪（20 秒前）、面板扫描接收就绪（开机时检查）。超过 1 分钟没更新的状态不算就绪：画成灰色虚线行，写「状态过期（3 分钟前）」，不用绿色。地址 ?device=stale 或演示事件，让扫描仪那一行直接变成过期，并连带写明屏上扫描、屏上复印暂不能用、先用面板。' + NK
  });

  /* 说明栏的分组和流程缩略图 */
  [G_SCAN, G_COPY, G_DEV].forEach((g) => { if (window.SCREEN_GROUPS.indexOf(g) < 0) window.SCREEN_GROUPS.push(g); });
  window.FLOWS.push(
    { n: '屏上扫描（新）', ids: ['print', 'cs-scan-how', 'cs-scan-set', 'cs-scan-run', 'cs-scan-more', 'cs-scan-make', 'cs-scan-done', 'pii'] },
    { n: '屏上扫描出错（新）', ids: ['cs-scan-run', 'cs-scan-err-nopaper', 'cs-scan-err-jam', 'cs-scan-err-busy', 'cs-scan-err-noresp', 'cs-scan-timeout', 'cs-scan-stopped', 'cs-scan-off'] },
    { n: '屏上复印（新）', ids: ['print', 'cs-copy-how', 'cs-copy-set', 'cs-copy-scan', 'cs-copy-check', 'cs-copy-print', 'cs-copy-done', 'cs-copy-unconfirmed', 'cs-copy-off'] },
    { n: '设备状态（新）', ids: ['offline', 'cs-device'] }
  );
})();
