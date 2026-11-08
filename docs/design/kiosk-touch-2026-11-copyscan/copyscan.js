/* copyscan.js：屏上扫描 16 屏、屏上复印 16 屏（含面板复印图文指引 2 屏）、设备状态细分 1 屏，共 33 屏。
   待产品负责人审看的补稿：样式沿用青序流光触屏版（ui.js 部件、状态样式板的写法），定稿目录里的文件一个字节不改。
   11/04 动画补稿（待产品负责人看，还没改程序）：玻璃台、进纸器各一段「原件怎么放」，选中才播，字幕只用本文件已有原句。
   11/08 补稿（待产品负责人看，不改程序）：复印「免费额度用完」cs-copy-quota，以及对稿清单（同目录 state-map.md）查出的缺稿：
   屏上扫描 cs-scan-failed，屏上复印 cs-copy-more、cs-copy-unknown、cs-copy-failed、cs-copy-err-limit、cs-copy-err-off，
   另给已有屏加了运行页才有的几种样子（地址参数见 README）。字逐字照运行页代码，出处写在各屏说明栏。
   11/08 第二轮：产品负责人对对稿清单的 10 处回「按推荐」，照改（定案逐条见 state-map.md 末节）；
   11/04 的 cs-scan-offline、cs-scan-file-gone 不采用，已删掉，断网和文件失效用程序现状。
   11/09 第三轮：三屏留白修整（cs-copy-more、cs-scan-failed?fail=nofile、cs-scan-stopped?flow=copy），只改版式、放大主视觉，字和出路不动，其余屏不变。
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
/* 扫什么：四种材料，样子照定稿 scan-type 的类型卡，选中是深色；每张带一张「扫的是什么」的小样 */
.cs-types{flex:1;min-height:0;display:flex;flex-direction:column;gap:14px}
.cs-type{flex:1;min-height:0;display:grid;grid-template-columns:230px minmax(0,1fr) 56px;gap:26px;align-items:center;width:100%;padding:16px 28px 16px 16px;border-radius:30px;background:var(--card);border:2px solid var(--edge);text-align:left;color:var(--ink);transition:transform var(--t-press),border-color var(--t-press),background-color var(--t-press)}
.cs-type:active{transform:scale(.985)}
.cs-type .vis{align-self:stretch;border-radius:22px;background:var(--well);display:grid;place-items:center;overflow:hidden}
.cs-type .vis svg{max-height:88%;max-width:86%;height:auto;width:auto}
.cs-type .tx{display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-width:0}
.cs-type b{font:700 40px/1.25 var(--serif)}
.cs-type .sub{font-size:25px;line-height:1.45;color:var(--ink-2);text-wrap:pretty}
.cs-type .sub2{font-size:22px;line-height:1.4;color:var(--ink-3)}
.cs-type .mark{width:56px;height:56px;border-radius:50%;border:3px solid var(--edge);display:grid;place-items:center;color:transparent}
.cs-type[aria-pressed="true"]{background:var(--deep);color:var(--cream);border-color:var(--deep)}
.cs-type[aria-pressed="true"] .sub{color:var(--mint)}
.cs-type[aria-pressed="true"] .sub2{color:var(--mint);opacity:.85}
.cs-type[aria-pressed="true"] .vis{background:rgba(255,255,255,.1)}
.cs-type[aria-pressed="true"] .chip{background:rgba(255,255,255,.14);color:var(--cream)}
.cs-type[aria-pressed="true"] .mark{background:var(--glow);border-color:var(--glow);color:var(--deep)}
/* 带插画的大选项：选中式（打勾）和直达式（箭头） */
.cs-ways{flex:1;min-height:0;display:flex;flex-direction:column;gap:14px}
.cs-ways>.cs-way{flex:1}
.cs-way{position:relative;display:grid;grid-template-columns:210px minmax(0,1fr) 64px;gap:22px;align-items:center;width:100%;min-height:190px;padding:18px 24px 18px 18px;border-radius:30px;background:var(--card);border:2px solid var(--edge);text-align:left;color:var(--ink);transition:transform var(--t-press),border-color var(--t-press),background-color var(--t-press)}
.cs-way:active{transform:scale(.985)}
.cs-way .vis{align-self:stretch;min-height:140px;border-radius:22px;background:var(--well);display:grid;place-items:center;overflow:hidden}
.cs-way .vis svg{height:82%;width:auto;max-width:90%}
.cs-way .tx{min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:8px}
.cs-way h3{margin:0;font:700 36px/1.25 var(--serif)}
.cs-way p{margin:0;font-size:24px;line-height:1.45;color:var(--ink-2);word-break:keep-all;overflow-wrap:anywhere}
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
.cs-src .vis svg{height:auto;width:100%;max-width:100%}
.cs-src b{font:700 42px/1.25 var(--serif)}
.cs-src .d{font-size:28px;line-height:1.4;color:var(--ink)}
.cs-src .d2{font-size:26px;line-height:1.4;color:var(--ink-2)}
.cs-src .cs-tick{position:absolute;right:14px;top:14px}
.cs-src[aria-pressed="true"]{border-color:var(--teal);background:var(--teal-wash)}
.cs-src[aria-pressed="true"] .vis{background:var(--card)}
/* 黑白 / 彩色、单面 / 双面 */
.cs-seg button{min-height:104px}
.cs-set .cs-seg button{min-height:140px;font-size:30px}
.cs-set .cs-seg button small{font-size:22px}
.cs-set .howto{min-height:128px;font-size:28px;padding:22px 30px}
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
/* 11/04 三张出错补稿：只作用于新屏。大纸照 K1b-2 铺满，不留固定 736px 后的空带。 */
.cs-issue .cs-hero{align-items:stretch;justify-content:stretch;padding:16px 28px}
.cs-issue .cs-hrow{flex:1;min-height:0;align-items:stretch;gap:30px;width:100%}
.cs-issue .cs-hero.none .cs-reader{width:520px;height:auto;min-height:0;align-self:stretch}
.cs-issue .cs-hero.none .cs-side{flex:1;min-width:0;width:auto;justify-content:center}
.cs-issue .cs-big{font-size:42px;overflow-wrap:anywhere}
.cs-issue .cs-cap{font-size:26px;line-height:1.5}
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
/* 面板复印图文引导（cs-copy-guide、cs-copy-guide-more）：只加 cs-g- 开头的类，前面的类一个不改 */
.cs-body.cs-g-body{gap:10px;padding:14px 40px 12px}
.cs-g-card{display:grid;grid-template-columns:44px minmax(0,1fr);column-gap:14px;align-items:start;padding:12px 22px 14px;border-radius:28px;background:var(--card);border:2px solid var(--edge)}
.cs-g-n{width:44px;height:44px;border-radius:50%;background:var(--deep);color:var(--cream);display:grid;place-items:center;font:700 23px/1 var(--sans)}
.cs-g-m{min-width:0;display:flex;flex-direction:column;gap:6px}
.cs-g-m h2{margin:0;min-height:44px;display:flex;align-items:center;font:700 32px/1.25 var(--serif);color:var(--ink)}
.cs-g-p{margin:0;font-size:23px;line-height:1.45;color:var(--ink-2);text-wrap:pretty}
.cs-g-p b{font-weight:700;color:var(--ink);white-space:nowrap}
.cs-g-p .nw{white-space:nowrap}
.cs-g-two{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:2px}
.cs-g-pick{display:grid;grid-template-columns:104px minmax(0,1fr);gap:12px;align-items:center}
.cs-g-pick .vis{width:104px;height:104px;border-radius:20px;background:var(--well);display:grid;place-items:center;overflow:hidden}
.cs-g-pick .vis svg{width:100%;height:auto}
.cs-g-warn{display:flex;align-items:center;gap:12px;margin:2px 0 0;padding:9px 16px;border-radius:16px;background:var(--clay-wash);color:var(--clay-ink);font-size:23px;font-weight:600;line-height:1.4}
.cs-g-warn svg{flex:none}
.cs-g-hint{display:flex;align-items:center;gap:10px;margin-top:-2px}
.cs-g-hint svg{flex:none;color:var(--teal-ink)}
.cs-g-sp{display:flex;gap:20px;align-items:center;margin-top:4px}
.cs-g-tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
.cs-g-panel{position:relative;display:flex;gap:12px;flex:none;width:520px;height:212px;padding:12px;border-radius:26px;background:#14231f;box-shadow:inset 0 0 0 2px #2d4540,0 8px 18px rgba(11,36,30,.16)}
.cs-g-panel .keys{display:flex;flex-direction:column;justify-content:center;gap:10px;width:56px;flex:none}
.cs-g-panel .key{width:56px;height:56px;border-radius:16px;background:#2a3e38;color:#d9e6e0;display:grid;place-items:center;box-shadow:inset 0 0 0 1.5px #3b544c}
.cs-g-panel .key.home{box-shadow:inset 0 0 0 2.5px var(--glow);color:#fff}
.cs-g-panel .scr{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;padding:9px;border-radius:16px;background:#f4f7f5}
.cs-g-panel .btns{flex:1;min-height:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.cs-g-panel .b{position:relative;display:flex;flex-direction:column;align-items:center;gap:5px;padding:11px 2px 6px;border-radius:12px;background:#fff;box-shadow:inset 0 0 0 1.5px #d3dad6;color:#4c5c56;text-align:center}
.cs-g-panel .b em{font:700 21px/1.2 var(--sans);font-style:normal}
.cs-g-panel .b.on{background:var(--teal);color:#fff;box-shadow:0 0 0 4px rgba(46,230,168,.5)}
.cs-g-panel .b.sub{background:var(--teal-wash);color:var(--teal-ink);box-shadow:inset 0 0 0 2px var(--teal)}
.cs-g-panel .bar{height:30px;border-radius:9px;background:#dde4e0;display:flex;align-items:center;gap:10px;padding:0 12px;font-size:20px;line-height:1;color:#43544d}
.cs-g-panel .bar i{width:12px;height:12px;border-radius:50%;background:var(--teal)}
.cs-g-panel .tap{position:absolute;right:-14px;bottom:-24px;color:var(--deep);filter:drop-shadow(0 2px 3px rgba(0,0,0,.3))}
.cs-g-panel.md{width:480px;height:216px}
.cs-g-panel.md .keys{width:54px}
.cs-g-panel.md .key{width:54px;height:54px}
.cs-g-more{display:flex;align-items:center;gap:10px;width:100%;min-height:80px;padding:8px 12px 8px 10px;border-radius:22px;background:var(--teal-wash);border:2px solid var(--teal);text-align:left;color:var(--teal-ink);transition:transform var(--t-press)}
.cs-g-more:active{transform:scale(.985)}
.cs-g-more .tx{flex:1;min-width:0}
.cs-g-more b{display:block;font-size:23px;line-height:1.3}
.cs-g-more small{display:block;font-size:21px;line-height:1.3;color:var(--teal-ink);opacity:.85}
.cs-g-list{display:flex;flex-direction:column;align-items:stretch;padding:2px 22px}
.cs-g-list .row{display:grid;grid-template-columns:44px minmax(0,1fr) auto;column-gap:14px;align-items:start;padding:10px 0 12px;border-top:1.5px solid var(--line)}
.cs-g-list .row:first-child{border-top:0}
.cs-g-list .cs-g-m h2{min-height:44px}
.cs-g-art{align-self:center;display:grid;place-items:center}
.cs-g-art .well{width:84px;height:84px;border-radius:22px;background:var(--teal-wash);color:var(--teal-ink);display:grid;place-items:center}
.cs-g-mfp{position:relative;display:block;flex:none}
.cs-g-mfp .in{position:absolute;left:0;top:0;width:620px;height:600px;transform-origin:0 0}
.cs-g-mfp .in>svg{position:absolute;left:0;top:0}
.cs-g-mfp .sh{position:absolute;left:150px;top:276px;width:320px;height:118px;border-radius:6px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.16);transform:translateY(124px) rotate(-2deg);transform-origin:top center}
.cs-g-mfp .sh.b{transform:translateY(120px) rotate(1.5deg)}
.cs-g-mfp .sh.c{transform:translateY(116px)}
.cs-g-mfp .sh::before{content:"";position:absolute;left:28px;right:90px;top:30px;height:8px;border-radius:4px;background:#d9ded9;box-shadow:0 22px 0 #d9ded9,0 44px 0 #d9ded9}
.cs-body.cs-g-s2{justify-content:space-between}
.cs-g-kind{display:grid;grid-template-columns:540px minmax(0,1fr);gap:26px;align-items:center;padding:18px 26px 18px 18px;border-radius:28px;background:var(--card);border:2px solid var(--edge)}
.cs-g-kind .pic{display:grid;place-items:center;border-radius:22px;background:var(--well);padding:22px 0}
.cs-g-kind h2{margin:0 0 8px;font:700 36px/1.25 var(--serif);color:var(--ink)}
.cs-g-kind .cs-g-p{font-size:24px;line-height:1.5}
.cs-g-kind .illus{max-width:100%;height:auto}
.cs-g-s2.tight .cs-g-kind{padding:10px 24px 10px 14px}
.cs-g-s2.tight .cs-g-kind .pic{padding:14px 0}
.cs-g-pill{display:flex;align-items:flex-start;gap:10px;margin:10px 0 0;padding:10px 14px;border-radius:16px;background:var(--teal-wash);color:var(--teal-ink);font-size:23px;font-weight:600;line-height:1.45;text-wrap:balance}
.cs-g-pill.clay{background:var(--clay-wash);color:var(--clay-ink)}
.cs-g-pill svg{flex:none;margin-top:3px}
.cs-g-big{display:flex;align-items:center;gap:22px;padding:22px 28px;border-radius:26px;background:var(--clay-wash);color:var(--clay-ink);font:700 30px/1.45 var(--serif)}
.cs-g-big svg{flex:none}
.cs-g-notes{display:flex;flex-direction:column;gap:10px}
.cs-g-notes .remind{min-height:0;padding:12px 22px;font-size:23px;line-height:1.45}
.cs-g-s1.roomy{gap:14px}
.cs-g-s1.roomy .cs-g-card{padding:16px 22px 18px}
.cs-g-s1.roomy .cs-g-pick{grid-template-columns:116px minmax(0,1fr)}
.cs-g-s1.roomy .cs-g-pick .vis{width:116px;height:116px}
.cs-g-s1.roomy .cs-g-panel{height:228px}
.cs-g-s1.roomy .cs-g-panel .b em{font-size:22px}
.cs-g-s1.roomy .cs-g-list{padding:4px 22px}
.cs-g-s1.roomy .cs-g-list .row{padding:14px 0 16px}
.cs-g-s1.roomy .cs-g-notes .remind{padding:14px 22px}
.cs-g-s1.tight{gap:8px}
.cs-g-s1.tight .cs-g-card{padding:8px 20px 10px}
.cs-g-s1.tight .cs-g-pick{grid-template-columns:88px minmax(0,1fr)}
.cs-g-s1.tight .cs-g-pick .vis{width:88px;height:88px}
.cs-g-s1.tight .cs-g-panel{height:196px}
.cs-g-s1.tight .cs-g-list .row{padding:6px 0 8px}
.cs-g-s1.tight .cs-g-notes{gap:8px}
.cs-g-s1.tight .cs-g-notes .remind{padding:8px 20px}
/* 放纸演示（11/04，待产品负责人看）：只加 cs-pl- 开头的类。一轮 7 秒。
   未播放时的样子就是末帧：玻璃台盖合上、纸在左上角、字朝下；进纸器纸已推进、导板靠拢、字朝上。 */
.cs-src .vis.cs-pl-on{display:flex;flex-direction:column;align-items:stretch;justify-content:center;padding:8px 12px 6px}
.cs-src .vis.cs-pl-on .cs-pl{flex:1;min-height:0;width:100%;display:flex;flex-direction:column;align-items:center}
.cs-src .vis.cs-pl-on .cs-pl-stage{flex:1 1 auto;min-height:0;width:100%;display:grid;place-items:center}
.cs-src .vis.cs-pl-on .cs-pl-stage svg{width:100%;height:100%;max-width:100%;max-height:100%;min-width:0;min-height:0}
.cs-g-pick .vis.cs-pl-on{display:grid;place-items:center;padding:0}
.cs-g-pick .cs-pl,.cs-g-pick .cs-pl-stage{width:100%;height:100%;min-height:0}
.cs-g-pick .cs-pl-caps{display:none!important}
.cs-g-pick .cs-pl-stage svg{width:100%;height:100%;min-width:0;min-height:0}
.cs-pl-caps{flex:none;width:100%;height:36px;position:relative}
.cs-pl-cap{position:absolute;inset:0;display:grid;place-items:center;padding:0 4px;font-size:22px;font-weight:700;line-height:1.25;color:var(--teal-ink);text-align:center;opacity:0}
.cs-pl-lid,.cs-pl-sheet,.cs-pl-stack,.cs-pl-gl,.cs-pl-gr{transform-box:fill-box;transform-origin:center}
.cs-pl-lid{transform-origin:center top;transform:scaleY(1)}
.cs-pl-g .cs-pl-sheet{opacity:1}
.cs-pl-g .cs-pl-ink{opacity:0}
.cs-pl-g .cs-pl-mark{opacity:1}
.cs-pl-f .cs-pl-stack{opacity:1}
.cs-pl-f .cs-pl-arrow{opacity:0}
.cs-pl-g .cs-pl-lid{animation:cs-pl-g-lid 7s linear infinite}
.cs-pl-g .cs-pl-sheet{animation:cs-pl-g-sheet 7s linear infinite}
.cs-pl-g .cs-pl-ink{animation:cs-pl-g-ink 7s linear infinite}
.cs-pl-g .cs-pl-mark{animation:cs-pl-g-mark 7s linear infinite}
.cs-pl-f .cs-pl-stack{animation:cs-pl-f-stack 7s linear infinite}
.cs-pl-f .cs-pl-gl{animation:cs-pl-f-gl 7s linear infinite}
.cs-pl-f .cs-pl-gr{animation:cs-pl-f-gr 7s linear infinite}
.cs-pl-f .cs-pl-arrow{animation:cs-pl-f-arrow 7s linear infinite}
.cs-pl-g .cs-pl-c0{animation:cs-pl-g-c0 7s linear infinite}
.cs-pl-g .cs-pl-c1{animation:cs-pl-g-c1 7s linear infinite}
.cs-pl-g .cs-pl-c2{animation:cs-pl-g-c2 7s linear infinite}
.cs-pl-g .cs-pl-c3{animation:cs-pl-g-c3 7s linear infinite}
.cs-pl-f .cs-pl-c0{animation:cs-pl-f-c0 7s linear infinite}
.cs-pl-f .cs-pl-c1{animation:cs-pl-f-c1 7s linear infinite}
.cs-pl-sync{border-radius:6px}
.cs-pl-sync.cs-pl-g0{animation:cs-pl-h-g0 7s linear infinite}
.cs-pl-sync.cs-pl-g1{animation:cs-pl-h-g1 7s linear infinite}
.cs-pl-sync.cs-pl-g2{animation:cs-pl-h-g2 7s linear infinite}
.cs-pl-sync.cs-pl-g3{animation:cs-pl-h-g3 7s linear infinite}
.cs-pl-sync.cs-pl-f0{animation:cs-pl-h-f0 7s linear infinite}
.cs-pl-sync.cs-pl-f1{animation:cs-pl-h-f1 7s linear infinite}
@keyframes cs-pl-g-lid{0%,8%{transform:scaleY(1)}18%,76%{transform:scaleY(.08)}92%,100%{transform:scaleY(1)}}
@keyframes cs-pl-g-sheet{
  0%,5%{transform:translate(0,0) scaleY(1);opacity:1}
  9%{transform:translate(0,0) scaleY(1);opacity:0}
  14%{transform:translate(78%,-72%) rotate(-8deg) scaleY(1);opacity:0}
  22%{transform:translate(78%,-72%) rotate(-8deg) scaleY(1);opacity:1}
  33%{transform:translate(36%,-6%) rotate(0deg) scaleY(.08);opacity:1}
  42%{transform:translate(32%,22%) scaleY(1);opacity:1}
  62%,100%{transform:translate(0,0) scaleY(1);opacity:1}}
@keyframes cs-pl-g-ink{0%,20%{opacity:0}23%,32%{opacity:1}38%,100%{opacity:0}}
@keyframes cs-pl-g-mark{0%,48%{opacity:.22}56%{opacity:1}60%{opacity:.22}64%{opacity:1}72%,100%{opacity:1}}
@keyframes cs-pl-f-stack{
  0%,4%{transform:translateY(0);opacity:1}
  8%{transform:translateY(0);opacity:0}
  12%{transform:translateY(-118%);opacity:0}
  18%,30%{transform:translateY(-118%);opacity:1}
  54%,100%{transform:translateY(0);opacity:1}}
@keyframes cs-pl-f-gl{0%,6%{transform:translateX(0)}14%,52%{transform:translateX(-170%)}74%,100%{transform:translateX(0)}}
@keyframes cs-pl-f-gr{0%,6%{transform:translateX(0)}14%,52%{transform:translateX(170%)}74%,100%{transform:translateX(0)}}
@keyframes cs-pl-f-arrow{0%,26%{opacity:0}32%,50%{opacity:1}58%,100%{opacity:0}}
@keyframes cs-pl-g-c0{0%,8%{opacity:0}12%,20%{opacity:1}24%,100%{opacity:0}}
@keyframes cs-pl-g-c1{0%,20%{opacity:0}24%,42%{opacity:1}46%,100%{opacity:0}}
@keyframes cs-pl-g-c2{0%,44%{opacity:0}48%,72%{opacity:1}76%,100%{opacity:0}}
@keyframes cs-pl-g-c3{0%,74%{opacity:0}78%,96%{opacity:1}100%{opacity:0}}
@keyframes cs-pl-f-c0{0%,14%{opacity:0}18%,34%{opacity:1}38%,100%{opacity:0}}
@keyframes cs-pl-f-c1{0%,34%{opacity:0}38%,96%{opacity:1}100%{opacity:0}}
@keyframes cs-pl-h-g0{0%,8%,24%,100%{background:transparent;color:inherit}12%,20%{background:var(--teal-wash);color:var(--teal-ink)}}
@keyframes cs-pl-h-g1{0%,20%,46%,100%{background:transparent;color:inherit}24%,42%{background:var(--teal-wash);color:var(--teal-ink)}}
@keyframes cs-pl-h-g2{0%,44%,76%,100%{background:transparent;color:inherit}48%,72%{background:var(--teal-wash);color:var(--teal-ink)}}
@keyframes cs-pl-h-g3{0%,74%,100%{background:transparent;color:inherit}78%,96%{background:var(--teal-wash);color:var(--teal-ink)}}
@keyframes cs-pl-h-f0{0%,14%,38%,100%{background:transparent;color:inherit}18%,34%{background:var(--teal-wash);color:var(--teal-ink)}}
@keyframes cs-pl-h-f1{0%,34%,100%{background:transparent;color:inherit}38%,96%{background:var(--teal-wash);color:var(--teal-ink)}}
.static .cs-pl-caps{display:none!important}
.reduced .stage .cs-pl-caps{height:auto;display:flex;flex-direction:column;gap:2px}
.reduced .stage .cs-pl-cap{position:static!important;opacity:1!important;animation:none!important;display:block}
.reduced .stage .cs-pl-sync{animation:none!important;background:transparent!important;color:inherit!important}
@media (prefers-reduced-motion:reduce){
  .stage .cs-pl-caps{height:auto;display:flex;flex-direction:column;gap:2px}
  .stage .cs-pl-cap{position:static!important;opacity:1!important;animation:none!important}
  .stage .cs-pl-sync{animation:none!important;background:transparent!important;color:inherit!important}
}
/* 11/08 补稿（待产品负责人看）：额度屏与对稿清单补的几种样子。只加 cs-q- / cs-solo / cs-cmore / cs-gw / cs-pv / cs-cpg / cs-pending 开头的类，前面的类一个不改。
   两条额度说明的点列照运行页 copy/copy-print.css 27–31；单栏居中照同文件 cc-quota-solo（29–30）。 */
.cs-q-facts{display:grid;gap:10px;margin:20px 0 0;padding:18px 0 0;list-style:none;border-top:1.5px solid var(--edge)}
.cs-q-facts li{position:relative;padding-left:26px;font-size:24px;line-height:1.5;color:var(--ink-2)}
.cs-q-facts li::before{content:"";position:absolute;left:4px;top:.6em;width:10px;height:10px;border-radius:50%;background:var(--teal-ink)}
.cs-solo .cs-why{grid-template-columns:minmax(0,1fr);justify-items:center;align-content:center;gap:28px;padding:36px 56px;text-align:center}
.cs-solo .cs-q-facts{justify-items:center}
/* 11/08 第二轮：复印「这一页扫好了」只剩一张卡，已收到的页放大、整块上下拉开（不撑空格子）
   11/09 第三轮：上中下三段各空约 170px。已收到的页那一格改成撑满上部：最后两页画成大页，「下一页」占位改成两页下面的一整条；
   这一格和「再扫一页」卡按正文 14px 间距排，卡落在底部。只作用于本屏（cs-cmore），cs-scan-more 不受影响。 */
.cs-cmore .cs-strip{flex:1;min-height:0}
.cs-cmore .cs-strip .cs-thumbs{flex:0 1 796px;min-height:0;width:100%;display:grid;grid-template:minmax(0,1fr) 120px/repeat(2,minmax(0,1fr));gap:20px 24px;align-items:center;justify-items:center}
.cs-cmore .cs-strip .cs-thumbs.cs-cm1{grid-template-columns:minmax(0,1fr)}
.cs-cmore .cs-strip .cs-thumbs.cs-cm0{flex-basis:656px;grid-template:minmax(0,1fr)/minmax(0,1fr)}
.cs-cmore .cs-strip .cs-pg{width:auto;height:100%;max-height:656px;aspect-ratio:464/656}
.cs-cmore .cs-strip .cs-pg>svg.illus{width:100%;height:100%}
.cs-cmore .cs-strip .cs-pg i{width:56px;height:56px;right:-12px;top:-12px}
.cs-cmore .cs-strip .cs-pg i svg{width:34px;height:34px}
.cs-cmore .cs-strip .cs-pg.next{grid-column:1/-1;width:100%;height:120px;aspect-ratio:auto;flex-direction:row;gap:14px}
.cs-cmore .cs-strip .cs-cm0 .cs-pg.next{width:auto;height:100%;aspect-ratio:464/656;flex-direction:column}
.cs-cmore .cs-strip>svg.illus{flex:1 1 0;min-height:0;width:100%;height:auto}
/* 11/08 第二轮：状态未知两屏，大纸居中、说明放在纸下面，整块上下拉开；字号不变 */
.cs-issue .cs-hero.cs-unk{flex-direction:column;align-items:center;justify-content:space-evenly;gap:26px;padding:24px 30px}
.cs-unk .cs-reader{flex:1 1 0;min-height:0;max-height:906px;width:auto;height:auto;aspect-ratio:520/736;--h:736px}
.cs-unk-tx{display:flex;flex-direction:column;align-items:center;gap:10px;max-width:860px;text-align:center}
/* 11/08 第二轮：复印已停止，原件在哪的示意（玻璃台、进纸器两张现成插画）
   11/09 第三轮：三块之间和示意卡下面各空约 130px。三块按正文 14px 间距排，示意卡撑满下部；
   两张插画并排最多只有半屏宽、撑不满，改成上下排（玻璃台在上、进纸器在下，同提醒句的先后），裁掉插画四周的透明边后放大。 */
.cs-cstop{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:space-evenly;padding:20px 30px;border-radius:30px;background:var(--well)}
.cs-cstop svg{flex:0 1 45%;min-height:0;width:100%;height:auto}
/* 11/08 第二轮：屏上扫描中断结果屏底栏左右两颗长按钮，照定稿 fix-scan.js 同类失败屏收紧底栏边距，免得问小青那句被截 */
.screen:has(.cs-sfail) .dock{padding:16px 28px;gap:12px}
.screen:has(.cs-sfail) .dock .btn{padding:0 16px}
.screen:has(.cs-sfail) .dock .btn.pri{min-width:0}
/* 11/09 第三轮：屏上扫描「已完成 · 结果里没有文件」（?fail=nofile）只有一张出路卡，原因卡被拉高、卡内上下各空约 200px。
   插画在左、字在右撑不满这么高的卡（左栏最多半屏宽），所以照单栏居中那种，把插画放大到卡里没有大块空白；字号、句子不变。只作用于这一种（cs-sfail 加 cs-solo）。 */
.cs-sfail.cs-solo .cs-why{grid-template-rows:minmax(0,1fr) auto;gap:24px;padding:28px 56px}
.cs-sfail.cs-solo .cs-why .vis{width:auto;height:100%;max-height:600px;aspect-ratio:1/1}
.cs-sfail.cs-solo .cs-why .vis svg.illus{width:90%}
.cs-sfail.cs-solo .cs-why .vis .warn{right:20px;top:20px;width:76px;height:76px}
.cs-sfail.cs-solo .cs-why .vis .warn svg{width:42px;height:42px}
.cs-sfail.cs-solo .cs-why p{text-wrap:balance}
.cs-gw{margin:0;padding:14px 20px;border-radius:20px;background:var(--clay-wash);color:var(--clay-ink);font-size:23px;font-weight:600;line-height:1.5}
.cs-gw ol{margin:4px 0 0;padding-left:34px}
.cs-pv{align-self:center;display:flex;flex-direction:column;align-items:center;gap:14px;max-width:620px;font-size:24px;line-height:1.5;color:var(--ink-2);text-align:center}
.cs-pv svg{color:var(--ink-3)}
.cs-cpg{flex:none}
.cs-ring.cs-pending b{font-size:60px}
/* 屏上扫描中断结果屏：照运行页 scan/styles/scan-fs.css 228–252，说明格按内容定高，多出来的高度给扫描小样，不撑空格 */
.body.fs-fill.cs-fsfail .fs-facts{flex:none;grid-auto-rows:auto}
.cs-fsfail .cs-sample{flex:1 1 0;min-height:160px;display:flex;align-items:center;justify-content:center;padding:16px 20px;border-radius:22px;background:var(--well);overflow:hidden}
.cs-fsfail .cs-sample svg{height:100%;width:auto;max-width:100%;max-height:100%}
/* 预览打不开：照运行页完成屏预览区那张白纸（文件图标、文件名、一句话） */
.cs-pvsheet{align-self:stretch;width:560px;max-width:100%;justify-content:center;padding:28px 36px;border-radius:14px;background:#fff;box-shadow:0 6px 18px rgba(11,36,30,.10)}
.cs-pvsheet b{font-size:26px;color:var(--ink);word-break:break-all}
`;
  document.head.appendChild(css);

  const { icon, band, dock, nav, scanPaper, stack, mfp } = UI;
  const S = () => window.S;
  const refresh = () => window.__proto && window.__proto.refresh();
  const PHONE = '183-6916-1921';
  const HELP = '需要帮助？拨打服务电话 ' + PHONE;
  const MACHINE = '这台机器暂时打不了，我们已经收到提醒，会尽快处理。你可以稍后再来；需要帮助请拨打服务电话 ' + PHONE + '。';
  const SCAN_RAIL = ['扫什么', '怎么扫', '放纸设置', '扫描', '拿走文件'];
  const COPY_RAIL = ['扫原件', '核对', '打印', '取走'];
  const G_SCAN = '屏上扫描（新）', G_COPY = '屏上复印（新）', G_DEV = '设备状态（新）';
  const MATS = {
    resume: { label: '简历', desc: '纸质简历，扫成 PDF', more: '扫完可以做 AI 简历识别，也可以打印', fs: 'resume' },
    id: { label: '证件', desc: '身份证、学历证书等原件', more: '正反面要各扫一次', chip: '敏感文件 · 自动清理', fs: 'id' },
    doc: { label: '普通文档', desc: '证明、成绩单等多页材料', more: '多页的放进纸器，一次扫完', fs: 'document' },
    contract: { label: '合同', desc: '多页合同、协议，扫成 PDF', more: '扫完是一个 PDF，可以打印', fs: 'document' }
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
        mat: MATS[q.get('mat')] ? q.get('mat') : 'doc', way: 'screen', src: '', ink: '', flow: q.get('flow') === 'copy' ? 'copy' : 'scan', rec: null, stopArm: false,
        copies: 2, orig: 'glass', cink: 'bw', dup: 'double', pstage: q.get('stage') === '2' ? 2 : 3, mini: true, tel: false,
        unknownTone: q.get('unknown') === 'unreachable' ? 'unreachable' : 'unconfirmed', unknownStop: ''
      };
      /* 11/08 补的几种样子：值都是字符串，演示事件用 set:键=值 改，空串是默认样子 */
      const pick = (k, list) => (list.includes(q.get(k)) ? q.get(k) : '');
      Object.assign(s.cs, {
        matNone: q.get('mat') === 'none' ? '1' : '',
        probe: pick('scanner', Object.keys(PROBE)),
        quota: pick('quota', ['member', 'terminal']) || 'guest', limit: pick('limit', ['none']),
        run: pick('run', ['waiting', 'finishing']), start: pick('start', ['busy', 'rejected', 'offline', 'limit', 'unknown']),
        make: pick('make', ['delivering']), owned: pick('owned', ['0']), view: pick('view', ['now']),
        preview: pick('preview', ['loading', 'fail']), cpg: pick('cpages', ['7']), quote: pick('quote', ['changed', 'odd', 'none']),
        net: pick('net', ['off']), pstate: pick('printer', ['unknown']), quiet: pick('quiet', ['none']), purged: pick('purged', ['0']),
        busy: pick('busy', ['1']), why: pick('why', ['wait', 'stop', 'token']),
        fail: pick('fail', ['expired', 'nofile']), reason: pick('reason', ['stopped', 'warming', 'large', 'ack']), rescan: pick('rescan', ['lost'])
      });
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
  /* 11/08：运行页其余几种检查结论（?scanner=…），句子逐字照 scan/scanProbeCopy.ts 66–80；复印把「扫描能力 / 屏上扫描 / 面板扫描」
     换成「复印能力 / 屏上复印 / 面板复印」，照 copy/useCopyFlow.ts 46。网络断开句照 copy/unattendedCopy.ts 176（标准句）。 */
  const PROBE = {
    capcheck: '正在检查这台机器能不能在屏上扫描',
    capfail: '屏上扫描能力暂时无法确认，请先用面板扫描',
    checking: '正在检查扫描仪',
    unreachable: '本机程序连不上，扫描仪状态未知，请先用面板扫描',
    unknown: '扫描仪状态未知，请先用面板扫描',
    busy: '扫描仪正忙，请稍后再试',
    notfound: '未找到扫描仪，请先用面板扫描',
    error: '扫描仪状态暂时无法确认，请先用面板扫描'
  };
  const asCopy = (t) => t.replace(/扫描能力/g, '复印能力').replace(/屏上扫描/g, '屏上复印').replace(/面板扫描/g, '面板复印');
  const NET = '网络断开时，我们会收到提醒并远程处理';
  const PRINTER_UNKNOWN = '打印机状态暂时无法确认，请先用面板复印';
  const probing = (c) => c.probe === 'capcheck' || c.probe === 'checking';
  function scanBlock() {
    const c = st();
    if (c.scandev === 'off') return '这台机器还没开通屏上扫描';
    if (c.scanner === 'stale') return '扫描仪状态 2 分钟没更新，先用面板扫描';
    if (c.probe) return PROBE[c.probe];
    return '';
  }
  function copyBlock() {
    const c = st();
    if (c.net) return NET;
    if (c.copydev === 'off') return '这台机器暂时只能在打印机面板上复印';
    if (c.scanner === 'stale') return '扫描仪状态 2 分钟没更新，先用面板复印';
    if (c.probe) return asCopy(PROBE[c.probe]);
    if (c.pstate) return PRINTER_UNKNOWN;
    return '';
  }
  function scanChip() {
    const c = st();
    if (c.scandev === 'off') return { text: '屏上扫描未开通', warn: 1 };
    if (c.scanner === 'stale') return { text: '扫描仪状态过期 · 2 分钟前', warn: 1 };
    if (c.probe) return { text: PROBE[c.probe], warn: 1 };
    return { text: '扫描仪就绪 · 20 秒前检查' };
  }
  function copyChip() {
    const c = st();
    if (c.net) return { text: NET, warn: 1 };
    if (printerOff()) return { text: '打印机离线', warn: 1 };
    if (c.copydev === 'off') return { text: '屏上复印未开通', warn: 1 };
    if (c.scanner === 'stale') return { text: '扫描仪状态过期 · 2 分钟前', warn: 1 };
    if (c.probe) return { text: asCopy(PROBE[c.probe]), warn: 1 };
    if (c.pstate) return { text: PRINTER_UNKNOWN, warn: 1 };
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
  /* 放纸演示：玻璃台、进纸器共用一套，几何沿用上面两张静态插画。
     字幕只切已有原句，不新造承诺。末帧（不播动画时）= 盖已合上 / 纸已推进且导板靠拢。 */
  function glassAnim() {
    return `<svg class="illus" viewBox="0 0 150 150" aria-hidden="true">
      <rect x="14" y="132" width="122" height="6" rx="3" fill="#aab4af"/>
      <rect x="8" y="22" width="134" height="108" rx="14" fill="#c9cfcc"/>
      <rect x="20" y="34" width="110" height="84" rx="8" fill="#eaf2ef" stroke="#9aa6a1" stroke-width="2"/>
      <g class="cs-pl-sheet">
        <rect x="30" y="46" width="52" height="64" rx="3" fill="#fff" stroke="#c9d1cd" stroke-width="2"/>
        <g class="cs-pl-ink"><rect x="38" y="56" width="34" height="5" rx="2" fill="#d9ded9"/><rect x="38" y="68" width="26" height="5" rx="2" fill="#d9ded9"/><rect x="38" y="80" width="34" height="5" rx="2" fill="#d9ded9"/><rect x="38" y="92" width="22" height="5" rx="2" fill="#d9ded9"/></g>
      </g>
      <rect class="cs-pl-lid" x="46" y="40" width="80" height="74" rx="8" fill="#b7c0bb" stroke="#8e9994" stroke-width="2"/>
      <path class="cs-pl-mark" d="M22 62V36h26" fill="none" stroke="#1f9e86" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  function feederAnim() {
    return `<svg class="illus" viewBox="0 0 150 150" aria-hidden="true">
      <rect x="8" y="82" width="134" height="50" rx="12" fill="#c9cfcc"/>
      <path d="M26 82 L36 20 H116 L124 82 Z" fill="#dfe5e2" stroke="#9aa6a1" stroke-width="2"/>
      <g class="cs-pl-stack">
        <rect x="48" y="36" width="58" height="38" rx="3" fill="#fff" stroke="#c9d1cd" stroke-width="2" transform="rotate(-4 73 55)"/>
        <rect x="44" y="32" width="58" height="38" rx="3" fill="#fff" stroke="#c9d1cd" stroke-width="2"/>
        <g class="cs-pl-ink"><rect x="52" y="41" width="34" height="5" rx="2" fill="#d9ded9"/><rect x="52" y="52" width="26" height="5" rx="2" fill="#d9ded9"/></g>
      </g>
      <rect class="cs-pl-gl" x="35" y="30" width="9" height="38" rx="3" fill="#8e9994"/>
      <rect class="cs-pl-gr" x="106" y="30" width="9" height="38" rx="3" fill="#8e9994"/>
      <path class="cs-pl-arrow" d="M126 22v22M118 36l8 8 8-8" fill="none" stroke="#1f9e86" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="20" y="70" width="110" height="18" rx="8" fill="#9aa6a1"/>
      <rect x="30" y="104" width="90" height="6" rx="3" fill="#2ee6a8"/>
    </svg>`;
  }
  function placeAnim(kind) {
    const glass = kind === 'glass';
    const caps = (glass ? ['掀开上盖', '字朝下放在玻璃上', '对齐左上角', '再合上盖'] : ['字朝上', '放进打印机上方的进纸口，字朝上'])
      .map((t, i) => `<span class="cs-pl-cap cs-pl-c${i}">${t}</span>`).join('');
    const label = glass ? '掀开上盖，字朝下放在玻璃上，对齐左上角，再合上盖' : '放进打印机上方的进纸口，字朝上';
    return `<span class="cs-pl cs-pl-${glass ? 'g' : 'f'}" role="img" aria-label="${label}"><span class="cs-pl-stage">${glass ? glassAnim() : feederAnim()}</span><span class="cs-pl-caps">${caps}</span></span>`;
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
  /* 合同的小样：多页纸，底下一道签字线（只是示意要扫的是合同，不是签名功能） */
  function contractSvg(w) {
    const h = Math.round(w * 1.414);
    return `<svg class="illus paper-shadow" width="${w}" height="${h}" viewBox="0 0 120 170" aria-hidden="true"><rect x="1" y="1" width="118" height="168" rx="6" fill="#fff" stroke="rgba(11,36,30,.14)" stroke-width="2"/>
      <rect x="14" y="16" width="64" height="10" rx="3" fill="#13231e"/>
      <rect x="14" y="40" width="92" height="5" rx="2" fill="#d9ded9"/><rect x="14" y="54" width="80" height="5" rx="2" fill="#d9ded9"/><rect x="14" y="68" width="92" height="5" rx="2" fill="#d9ded9"/>
      <rect x="14" y="82" width="70" height="5" rx="2" fill="#d9ded9"/><rect x="14" y="96" width="88" height="5" rx="2" fill="#d9ded9"/><rect x="14" y="110" width="60" height="5" rx="2" fill="#d9ded9"/>
      <path d="M16 142q8-18 14-5t14-1 16-8" fill="none" stroke="#3f68b0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><rect x="14" y="150" width="62" height="2.5" rx="1" fill="#9aa6a1"/></svg>`;
  }
  const MAT_ART = { resume: () => UI.resume(150, 'plain'), id: () => UI.idcard(180), doc: () => stack(124, 3, ''), contract: () => contractSvg(150) };
  /* 一张材料卡：单选，选中变深色（跟定稿扫描类型卡一个样子） */
  function typeCard(k, on) {
    const m = MATS[k];
    return `<button class="cs-type" data-cs="mat:${k}" aria-pressed="${on}"><span class="vis">${MAT_ART[k]()}</span><span class="tx"><b>${m.label}</b><span class="sub">${m.desc}</span><span class="sub2">${m.more}</span>${m.chip ? `<span class="chip clay">${m.chip}</span>` : ''}</span><span class="mark">${icon('check', 30, 3)}</span></button>`;
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
    const g = k === 'glass', on = cur === k;
    const art = on ? placeAnim(g ? 'glass' : 'feeder') : (g ? glassSvg(170) : feederSvg(170));
    return `<button class="cs-src" data-cs="${act}:${k}" aria-pressed="${on}"><span class="vis${on ? ' cs-pl-on' : ''}">${art}</span><b>${g ? '玻璃台' : '进纸器'}</b><span class="d">${g ? '一次一页，适合证件、书本' : '一叠最多 50 页，只扫单面'}</span><span class="d2">${g ? '字朝下，对齐左上角' : '字朝上'}</span><span class="cs-tick">${icon('check', 26, 3)}</span></button>`;
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
  /* 11/09 第三轮，只给复印「这一页扫好了」用（cs-scan-more 仍用上面的 thumbs）：最后两页画成大页，
     「下一页」占位是两页下面的一整条；一页都没有时占位画成一页大小。字只有原来的「下一页」。 */
  function cmoreThumbs(n) {
    const shown = Math.min(n, 2), from = n - shown, w = shown ? 952 : 464, h = shown ? 120 : 656;
    let t = '';
    for (let i = 0; i < shown; i++) t += `<span class="cs-pg">${pageSvg(464, 656, from + i)}<i>${icon('check', 26, 3.4)}</i></span>`;
    t += `<span class="cs-pg next"><svg class="dash" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="14" fill="none" stroke="rgba(31,158,134,.55)" stroke-width="3" stroke-dasharray="10 8"/></svg>${icon('plus', 44, 2.4)}<span>下一页</span></span>`;
    return `<div class="cs-thumbs cs-cm${shown}">${t}</div>`;
  }
  /* 11/09 第三轮：插画四周有透明边，放大时只换看的范围（viewBox），画本身不改 */
  const cropSvg = (svg, vb) => svg.replace('viewBox="0 0 150 150"', `viewBox="${vb}"`);
  function overlay(h, body, acts) {
    return `<div class="overlay"><div class="dialog"><h2>${h}</h2>${body}<div class="cs-ovacts">${acts}</div></div></div>`;
  }
  const fileName = (c) => `${MATS[c.mat].label}-${c.rec || 3}页.pdf`;
  const fileSize = (c) => ((c.rec || 3) * 0.37).toFixed(1) + ' MB';
  const call = '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>';
  const chev = () => `<span class="chev">${icon('chevR', 30, 2.2)}</span>`;
  const rowBtn = (attr, ic, t, d) => `<button class="cs-row" ${attr}><span class="ic">${icon(ic, 36, 2)}</span><span class="tx"><b>${t}</b><small>${d}</small></span>${chev()}</button>`;

  /* ═════════ 屏上扫描 ═════════ */
  /* 1 扫什么：只问材料，四选一 */
  function scanWhat() {
    const c = st();
    return shell({
      band: { eyebrow: '屏上扫描', title: '扫什么？', status: scanChip(), rail: { labels: SCAN_RAIL, now: 0 } },
      cls: 'cs-what',
      body: `<div class="cs-types" role="group" aria-label="扫什么">${Object.keys(MATS).map((k) => typeCard(k, !c.matNone && c.mat === k)).join('')}</div>`,
      /* ?mat=none：运行页一种都没选时主按钮写「先选一种材料」、灰、无箭头（scan/ScanStartPage.tsx 261–287） */
      dock: D({ back: { go: 'print' }, ask: '问小青：扫描和复印有什么不同', pri: c.matNone ? pri('先选一种材料', '', { dis: 1, noArrow: 1 }) : pri('下一步', 'data-cs="what-next"') })
    });
  }
  /* 2 怎么扫：只问方式，二选一 */
  function scanHow() {
    const c = st(), blocked = scanBlock(), w = blocked ? 'panel' : c.way, m = MATS[c.mat];
    return shell({
      band: { eyebrow: '屏上扫描 · ' + m.label, title: '怎么扫？', status: scanChip(), rail: { labels: SCAN_RAIL, now: 1 } },
      cls: 'cs-how',
      body: `<div class="cs-ways">
          ${wayCard({ big: 1, cs: 'way:screen', on: w === 'screen', dis: !!blocked, chip: blocked ? '' : '推荐', t: '在这块屏上开始扫描', d: blocked || '放好纸，在屏上点开始，扫描仪自己动', vis: scanPaper(250) })}
          ${wayCard({ big: 1, cs: 'way:panel', on: w === 'panel', t: '到打印机面板上扫', d: '在打印机屏幕上按扫描，文件传回这台机器', vis: mfp() })}
        </div>
        ${S().logged ? '' : `<div class="cs-login"><span>想带走电子版？先扫码登录（微信一扫，不用短信），扫完会存进<span style="white-space:nowrap">「我的文档」</span></span><button class="btn pri" data-go="login">先登录</button></div>`}
        <div class="cs-hold" role="note">${icon('usb', 32, 2)}<span>用 U 盘：在打印机面板上选「扫描到 U 盘」——这台机器暂未开通</span></div>`,
      /* 检查中（?scanner=capcheck|checking）主按钮照 scan/ScanHowPage.tsx 145–147：「正在检查扫描仪」、灰、无箭头 */
      dock: D({ back: { go: 'cs-scan-what' }, ask: '问小青：两种扫法怎么选', pri: probing(c) ? pri('正在检查扫描仪', '', { dis: 1, noArrow: 1 }) : pri('下一步', 'data-cs="how-next"') })
    });
  }
  /* 3 放纸与设置（上一屏已经选过方式，要改就点「返回」，这里不再放「改用面板扫描」） */
  function scanSet() {
    const c = st(), blocked = scanBlock(), m = MATS[c.mat], src = srcOf(c), ink = inkOf(c);
    /* 11/08：运行页这一屏的几种样子（scan/ScanDeviceSettingsPage.tsx 60–80、147；scan/useScanDeviceStart.ts 20–21）：
       ?scanner=checking 胶囊「正在确认扫描仪」、开始灰；?start=busy「正在开始」；?start=rejected / offline 在提示行写两句之一 */
    const checking = probing(c);
    const START = { rejected: '这一次没有建成扫描。可以再点一次开始。', offline: '状态未知。这一次没能确认有没有建成扫描，请先返回，过一会儿再试。不要再点开始。' };
    const startNote = START[c.start] ? `<p class="cs-warn">${START[c.start]}</p>` : '';
    const startPri = c.start === 'busy' ? pri('正在开始', '', { dis: 1 }) : pri('开始扫描', 'data-cs="set-start"', { dis: !!blocked || c.start === 'offline' });
    if (checking || c.start) {
      return shell({
        band: { eyebrow: '屏上扫描 · ' + m.label, title: '纸放哪？扫成黑白还是彩色？', status: checking ? { text: '正在确认扫描仪', warn: 1 } : scanChip(), rail: { labels: SCAN_RAIL, now: 2 } },
        cls: 'cs-set',
        body: `<div class="sec-t">纸放哪？</div>
          <div class="cs-two">${srcCard('glass', src, 'src')}${srcCard('feeder', src, 'src')}</div>
          <div class="sec-t">黑白还是彩色？</div>
          <div class="seg tall cs-seg">
            <button data-cs="ink:bw" aria-pressed="${ink === 'bw'}">黑白<small>文字材料</small></button>
            <button data-cs="ink:color" aria-pressed="${ink === 'color'}">彩色<small>带照片、带颜色的材料</small></button>
          </div>
          ${howto('多页单面材料用进纸器一次扫完；玻璃台适合证件、书本，一面一面扫')}
          ${startNote}`,
        dock: D({ back: { go: 'cs-scan-how' }, ask: '问小青：纸怎么放', pri: checking ? pri('开始扫描', '', { dis: 1 }) : startPri })
      });
    }
    return shell({
      band: { eyebrow: '屏上扫描 · ' + m.label, title: '纸放哪？扫成黑白还是彩色？', status: scanChip(), rail: { labels: SCAN_RAIL, now: 2 } },
      cls: 'cs-set',
      body: `<div class="sec-t">纸放哪？</div>
        <div class="cs-two">${srcCard('glass', src, 'src')}${srcCard('feeder', src, 'src')}</div>
        <div class="sec-t">黑白还是彩色？</div>
        <div class="seg tall cs-seg">
          <button data-cs="ink:bw" aria-pressed="${ink === 'bw'}">黑白<small>文字材料</small></button>
          <button data-cs="ink:color" aria-pressed="${ink === 'color'}">彩色<small>带照片、带颜色的材料</small></button>
        </div>
        ${howto('多页单面材料用进纸器一次扫完；玻璃台适合证件、书本，一面一面扫')}
        ${blocked ? `<p class="cs-warn">${blocked}。点「返回」改选「到打印机面板上扫」。</p>` : ''}`,
      dock: D({ back: { go: 'cs-scan-how' }, ask: '问小青：纸怎么放', pri: pri('开始扫描', 'data-cs="set-start"', { dis: !!blocked }) })
    });
  }
  /* 3 正在扫描（屏上复印的第 1 步同一个样子：copy 为真时换标题和路径线） */
  /* 11/08：运行页还有两种样子（scan/ScanDeviceRunView.tsx 49–56、71–113；copy/CopyDeviceView.tsx 46–48）：
     ?run=waiting 已交给机器、等扫描仪回报开始；?run=finishing 复印扫完、整理成预览（扫描这一步在 cs-scan-make） */
  function runWait(copy) {
    const c = st(), fin = copy && c.run === 'finishing', none = c.pages === 'none', n = c.rec == null ? 2 : c.rec;
    const t3 = fin && !none ? '已收到 ' + n + ' 页' : '正在扫描';
    const steps = fin
      ? [['已收到', '完成', '这台机器收到了扫描请求', 'on'], ['扫描仪已开始', '完成', '扫描仪回报已经开始扫', 'on'], [t3, '完成', none ? '先别动原件' : '每扫完一整页才加一', 'on'], ['整理成预览', '进行中', '扫完后准备给你核对', 'now']]
      : [['已收到', '完成', '这台机器收到了扫描请求', 'on'], ['扫描仪已开始', '未开始', '扫描仪回报已经开始扫', ''], ['正在扫描', '未开始', '先别动原件', ''], copy ? ['整理成预览', '未开始', '扫完后准备给你核对', ''] : ['生成文件并传回', '未开始', '扫完后合成一个 PDF', '']];
    const big = !fin || none;
    const band = fin
      ? { eyebrow: '屏上复印', title: '正在扫原件', sub: '扫完后准备给你核对', status: { text: '整理成预览' }, rail: { labels: COPY_RAIL, now: 0 } }
      : copy
        ? { eyebrow: '屏上复印', title: '正在扫原件', sub: '还在等扫描仪回报已经开始。先别动原件。', status: { text: '等待扫描仪', warn: 1 }, rail: { labels: COPY_RAIL, now: 0 } }
        : { eyebrow: '屏上扫描', title: '已把扫描请求交给这台机器', sub: '还在等扫描仪回报已经开始。先别动原件。', status: { text: '等待扫描仪', warn: 1 }, rail: { labels: SCAN_RAIL, now: 3 } };
    return shell({
      band, cls: 'cs-run',
      body: `${psteps(steps)}
        <div class="cs-hero${big ? ' none' : ''}"><div class="cs-hrow">
          <div class="cs-reader" aria-hidden="true">${pageSvg(big ? 520 : 440, big ? 736 : 622, 0)}${fin ? '' : '<span class="scanline"></span>'}</div>
          <div class="cs-side">
            ${big ? `<div class="cs-spin" aria-hidden="true"></div><b class="cs-big">${fin ? '正在扫描' : '等待扫描仪'}</b>`
              : `<div class="cs-count"><b>${n}</b><span>页</span></div><p class="cs-cap">已收到</p>`}
          </div></div>${big ? '' : thumbs(n, '整理成预览')}</div>
        ${armNote()}<p class="cs-fine">每扫完一整页才加一；扫描仪不报就不显示页数</p>`,
      dock: dock({ back: false, ask: '问小青：一直扫不完怎么办', mid: stopBtn(copy ? '停止复印' : '停止扫描') })
    });
  }
  function runScreen(copy) {
    if (st().run === 'waiting' || (copy && st().run === 'finishing')) return runWait(copy);
    const c = st(), none = c.pages === 'none', n = c.rec == null ? 2 : c.rec;
    const third = none ? ['正在扫描', '进行中', '先别动原件'] : ['已收到 ' + n + ' 页', '进行中', '每扫完一整页才加一'];
    const last = copy ? ['整理成预览', '未开始', '扫完后准备给你核对'] : ['生成文件并传回', '未开始', '扫完后合成一个 PDF'];
    return shell({
      band: copy
        ? { eyebrow: '屏上复印', title: '正在扫原件', sub: '先别动原件，扫描仪正在工作。', status: { text: '扫描中' }, rail: { labels: COPY_RAIL, now: 0 } }
        : { eyebrow: '屏上扫描', title: '正在扫描', sub: '先别动原件，扫描仪正在工作。', status: { text: '扫描中' }, rail: { labels: SCAN_RAIL, now: 3 } },
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
    /* 11/08：?pages=none 扫描仪不报页数或上限、?busy=1 命令在途（scan/ScanDeviceMoreView.tsx 32–36、64–96）。
       不报页数时程序那一格只有一句「这一页已扫好」，稿放玻璃台大图把格子占住，字不加。 */
    if (c.pages === 'none' || c.busy) {
      const none = c.pages === 'none', busy = !!c.busy;
      return shell({
        band: { eyebrow: '屏上扫描 · 玻璃台', title: '这一页扫好了，还有下一页吗？', status: { text: none ? '这一页已扫好' : '已收到 ' + n + ' 页' }, rail: { labels: SCAN_RAIL, now: 3 } },
        cls: 'cs-more',
        body: `<div class="cs-strip">${none ? glassSvg(300) : thumbs(n, '下一页', true)}<p>${none ? '这一页已扫好' : `已收到 ${n} 页<small>最多 20 页</small>`}</p></div>
          <div class="cs-ways">
            ${wayCard({ cs: 'more', dis: full || busy, t: '再扫一页', d: full ? '已经到 20 页，不能再加了' : '先把下一页放上玻璃台，字朝下，对齐左上角', vis: glassSvg(150) })}
            ${wayCard({ cs: 'finish', dis: busy, t: '扫完了，生成文件', d: none ? '把已经扫到的页合成一个 PDF' : '把已收到的 ' + n + ' 页合成一个 PDF', vis: stack(120, 3, '') })}
          </div>
          ${armNote()}${remind(none ? '10 分钟内没操作会自动结束' : '最多 20 页；10 分钟内没操作会自动结束', 'clock')}`,
        dock: D({ left: stopBtn('停止扫描', true), ask: '问小青：下一页怎么放', pri: pri('扫完了', 'data-cs="finish"', { dis: busy }) })
      });
    }
    return shell({
      band: { eyebrow: '屏上扫描 · 玻璃台', title: '这一页扫好了，还有下一页吗？', status: { text: '已收到 ' + n + ' 页' }, rail: { labels: SCAN_RAIL, now: 3 } },
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
    /* 11/08：?make=delivering 正在传回、?pages=none 不报页数（scan/ScanDeviceMakeView.tsx 40–66） */
    const del = c.make === 'delivering', none = c.pages === 'none';
    return shell({
      band: { eyebrow: '屏上扫描', title: '正在生成文件', sub: '扫描仪已经扫完，正在把页面合成一个文件。', status: { text: '正在生成文件' }, rail: { labels: SCAN_RAIL, now: 3 } },
      cls: 'cs-make',
      body: `<div class="stagelist">
          <div class="it ok"><span class="ico">${icon('check', 24, 3)}</span>${none ? '扫描仪已扫完' : `扫描仪已扫完 · 共收到 ${n} 页`}</div>
          <div class="it ${del ? 'ok' : 'now'}"><span class="ico">${del ? icon('check', 24, 3) : ''}</span>生成一个 PDF</div>
          <div class="it${del ? ' now' : ''}"><span class="ico"></span>传回这台机器</div>
        </div>
        <div class="cs-merge">
          <div class="cs-pile" aria-hidden="true">
            <span style="position:absolute;left:0;top:76px;transform:rotate(-6deg)">${pageSvg(300, 424, 1)}</span>
            <span style="position:absolute;left:100px;top:40px;transform:rotate(-1deg)">${pageSvg(300, 424, 2)}</span>
            <span style="position:absolute;left:210px;top:0;transform:rotate(5deg)">${pageSvg(300, 424, 0)}</span>
          </div>
          <div class="cs-facts"><div><b>${none ? '还没回报' : n + ' 页'}</b><span>刚收到的</span></div><div><b>1 个 PDF</b><span>合成后的文件</span></div><div><b>这台机器</b><span>文件先放在这里</span></div></div>
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
    /* 11/08：游客段用程序的「带走的办法」三条（scan/scanGuestWays.ts 11–24，第三条后半句只在小程序已发布时出现，11/08 定为默认）；
       ?login=1&owned=0 已登录但「我的文档」里还没核对到这份（scan/ScanDeviceDonePage.tsx 32–48）；?preview=fail 预览打不开（components/PdfCanvasPreview.tsx 22） */
    const owned = !c.owned;
    const ways = `<div class="cs-gw">未登录扫描件不会进入「我的文档」。带走的办法：<ol><li>当场打印：请在本次操作内完成打印或识别。</li><li>存 U 盘：在打印机面板上选「扫描到 U 盘」，这台机器暂未开通。</li><li>存进「我的文档」：下次先扫码登录再扫${c.mini ? '，手机小程序里也能看到' : ''}。</li></ol></div>`;
    const note = logged
      ? (owned ? `<div class="cs-saved">${icon('folder', 40, 2)}<span>这份扫描件已存进「我的文档」${c.mini ? '，手机上打开职易达小程序也能看到' : ''}</span></div>` : '')
      : ways;
    return shell({
      band: { eyebrow: '扫描完成', title: '扫描完成，文件已传回', sub: '先核对文件，再选下一步。', status: { text: '文件已传回' }, rail: { labels: SCAN_RAIL, now: 4 } },
      cls: 'cs-done',
      body: `<div class="cs-file"><div class="cs-fhead"><span class="ft">PDF</span><div class="tx"><b>${fileName(c)}</b><span class="meta">${n} 页 · ${fileSize(c)}</span></div><span class="chips"><span class="chip">${m.label}</span>${id ? '<span class="chip clay">敏感文件 · 自动清理</span>' : ''}</span></div>
          <div class="cs-fpages">${c.preview === 'fail' ? `<div class="cs-pv cs-pvsheet">${icon('file', 72, 1.6)}<b>${fileName(c)}</b><span>预览没能生成，打印仍按原文件。</span></div>` : pgs}</div>
          <p class="cs-fine">页数和方向请自己核一下</p></div>
        ${note}
        <div class="cs-rows">
          ${rowBtn('data-go="pii"', 'printer', '拿去打印', '先检查文件和个人信息，再打印')}
          ${ai}
          ${logged && owned ? rowBtn('data-go="my-docs"', 'folder', '前往我的文档', '在「我的文档」里看和管理这份扫描件') : ''}
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
    /* 11/08：?busy=1 重试、改用玻璃台或改用面板还在途：卡片、返回、主按钮全灰，字不变（scan/ScanDeviceErrorPage.tsx 44、59–60） */
    const busy = !!c.busy;
    return shell({
      band: { eyebrow: copy ? '屏上复印' : '屏上扫描', title: o.title, sub: o.sub, status: { text: o.chip, warn: 1 } },
      cls: 'cs-err cs-err' + opts.length,
      body: `<div class="cs-why"><span class="vis">${o.art}<i class="warn">${icon('alert', 34, 2.4)}</i></span><div><b>${o.reason[0]}</b><p>${o.reason[1]}</p></div></div>
        <div class="cs-ways">${opts.map((x) => wayCard(busy ? Object.assign({}, x, { dis: 1 }) : x)).join('')}</div>
        ${remind(HELP)}`,
      dock: busy
        ? D({ left: `<button class="btn sec" disabled>${icon('chevL', 30, 2.4)}返回</button>`, ask: o.ask, pri: o.pri(copy).replace('class="btn pri"', 'class="btn pri" disabled') })
        : D({ back: { go: o.back || (copy ? 'cs-copy-set' : 'cs-scan-set') }, ask: o.ask, pri: o.pri(copy) })
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

  /* 11/04 补稿，11/08 定：只留「状态未知」并改版（右栏留白），断网、文件失效用程序现状，两张整屏不采用、已删。
     事实：ScanDeviceUnknownView 15–17、StopButton 27/46、useScanDeviceFlow 26/126–160。 */
  const issueAi = () => S().ai === 'down' ? '<p class="cs-ai">小青也要联网，恢复后再问</p>' : '';
  function issueShell(o) {
    return B(o.band) + `<main class="body cs-body cs-issue ${o.cls || ''}">${issueAi()}${o.body}</main>` + o.dock + nav(null);
  }
  /* 大纸居中、说明在纸下面，整块上下拉开（11/08 定）；纸是现成插画，不充当本次文件预览 */
  function issuePaper(title, detail) {
    return `<div class="cs-hero cs-unk"><div class="cs-reader" aria-hidden="true">${pageSvg(520, 736, 0)}</div>
      <div class="cs-unk-tx"><b class="cs-big">${title}</b><p class="cs-cap">${detail}</p></div></div>`;
  }
  function scanUnknown() {
    const c = st(), detail = c.unknownTone === 'unreachable' ? '本机程序连不上。这一步还没有结果。' : '这一步的结果还没确认。';
    const stop = `<button class="btn cs-stop${c.stopArm ? ' armed' : ''}" data-cs="unknown-stop"${c.unknownStop ? ' disabled' : ''}>${icon('x', 30, 2.6)}${c.unknownStop === 'busy' ? '正在停止' : c.stopArm ? '再点一次确认停止' : '停止扫描'}</button>`;
    return issueShell({
      band: { eyebrow: '屏上扫描', title: '状态未知', sub: detail, status: { text: '状态未知', warn: 1 }, rail: { labels: SCAN_RAIL, now: 3 } },
      cls: 'cs-unknown', body: issuePaper('状态未知', detail) + armNote(),
      dock: dock({ back: false, ask: '问小青：这一步还没有结果', mid: stop })
    });
  }

  /* 12 已停止 */
  function scanStopped() {
    const c = st(), copy = c.flow === 'copy';
    /* 11/08 定：复印停止没有静默期（复印取消回包不带），不画倒计时；补原件提醒，配玻璃台、进纸器示意（copy/copyDeviceFlow.ts 214–231） */
    if (copy) {
      return shell({
        band: { eyebrow: '屏上复印', title: '已停止复印', sub: '这次到这里为止，不会再继续。', status: { text: '已停止', warn: 1 } },
        cls: 'cs-stopped cs-cstopped',
        body: `<div class="cs-fact big"><span class="ic">${icon('erase', 40, 2)}</span><b>已停止复印，已扫的页已从这台机器删除</b></div>
          <div class="cs-remind-big">${icon('hand', 64, 1.8)}<span>原件还在玻璃上或进纸器里，请带走</span></div>
          <div class="cs-cstop" aria-hidden="true">${cropSvg(glassSvg(420), '4 18 142 124')}${cropSvg(feederSvg(420), '4 16 142 120')}</div>`,
        dock: D({ back: { go: 'print', label: '回打印扫描' }, ask: '问小青：怎么复印更合适', pri: pri('回首页', 'data-go="home"') })
      });
    }
    /* 11/08（只扫描）：?quiet=none 停止回包没带服务端时间、?purged=0 本机回包没说已删页（scan/ScanDeviceStoppedPage.tsx 16–38） */
    if (!copy && (c.quiet || c.purged)) {
      const quiet = !c.quiet;
      return shell({
        band: { eyebrow: '屏上扫描', title: '已停止扫描', sub: '这次到这里为止，不会再继续。', status: { text: '已停止', warn: 1 } },
        cls: 'cs-stopped',
        body: `<div class="cs-fact big"><span class="ic">${icon('erase', 40, 2)}</span><b>${c.purged ? '已停止扫描' : '已停止扫描，已扫的页已从这台机器删除'}</b></div>
          <div class="cs-wait"><div class="cs-ring${quiet ? '' : ' cs-pending'}">${ring(1, 480, 26)}<b>${quiet ? '90<small>秒</small>' : '请稍候'}</b></div>
            <div class="tx">${quiet ? '<b>90 秒后才能开始新的扫描</b><span>为了不让下一位看到你的材料，90 秒后才能开始新的扫描。</span>' : '<b>请稍候再开始新的扫描</b><span>为了不让下一位看到你的材料，过一会儿才能开始新的扫描。</span>'}</div></div>
          <div class="cs-fact"><span class="ic">${icon('hand', 36, 2)}</span><b>原件还在玻璃台或进纸器里，请取走</b></div>`,
        dock: D({ back: { go: 'print', label: '回打印扫描' }, ask: quiet ? '问小青：为什么要等 90 秒' : '问小青：为什么要等', pri: pri('回首页', 'data-go="home"') })
      });
    }
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
  /* 屏上扫描中断后的结果屏。原因句 scan/scanDeviceState.ts 111–159、scan/scanDeliveryAck.ts 124–126。
     ?fail=expired|nofile；?reason=stopped|warming|large|ack；?rescan=lost。
     11/08 定：新默认是屏上扫描自己的结果屏（scanFailed，程序随后照它改）；?view=now 是现在程序借的面板失败屏（scanFailedNow，
     scan/ScanResultFailedView.tsx 36–109，照定稿 fix-scan.js scanFail 的 fs- 版式），留着对照，待改。 */
  const FAIL_REASON = {
    '': '这次扫描没有完成。',
    stopped: '已停止扫描。这次到这里为止，不会再继续。',
    warming: '扫描仪还在预热。这次先停在这里。',
    large: '这一次超过了这台机器能收的大小。这次先停在这里。',
    ack: '系统没有确认这一场能收到扫描件（已过期、被取消或已经结束），本机已经把它撤掉。面板上扫出来的文件不会交到这一场，你手上的纸也不会被谁收走。要继续请重新开始一次扫描。'
  };
  const RESCAN_LOST = '<b>刚才那份安全重扫凭据已经用不了了</b>（超过 15 分钟，或者中间清过场 / 换过人）。本页<b>没有</b>替你改成普通重扫 —— 同一张纸如果走普通扫描，系统会按重复件拒收，你会在机器前白等到这次扫描过期。要继续，请自己按右下角<b>「重新开始一次扫描」</b>，并且换一份材料。';
  const RESCAN_AUTH = '这一次会带上上一场的凭据去申请安全重扫放行：系统认了，同一份材料照原样再扫一遍就行；不认会在下一页当场说明，不会悄悄按普通重扫处理。';
  function scanFailed() {
    const c = st();
    if (c.view === 'now') return scanFailedNow();
    const nofile = c.fail === 'nofile', expired = c.fail === 'expired', lost = !!c.rescan, auth = !nofile && !lost;
    const kind = nofile ? '已完成 · 结果里没有文件' : expired ? '等待超时' : '扫描未完成';
    const reason = nofile ? '系统说已完成，但这次结果里没有可用文件' : expired ? '等待超时，这次没有拿到文件。' : FAIL_REASON[c.reason];
    const detail = nofile
      ? '同一份结果里没有带可用的文件信息（结果里允许不带文件，这不是出错）。这份文件此刻还在不在系统里，本机没有依据判断。这次扫描到此结束。'
      : '同一张纸原样再扫，系统可能按重复件拒收（两小时内）。';
    const opts = (auth ? [{ go: 'cs-scan-set', t: '重试扫描（同一份材料）', d: RESCAN_AUTH, vis: glassSvg(150) }] : [])
      .concat([{ cs: 'again', t: '重新开始一次扫描', d: '这是一次普通新会话，不是免查重的重扫。不自动重扫。', vis: scanPaper(150) }])
      .concat(nofile ? [] : [{ go: 'home', t: '返回首页', d: '结束这次等待', vis: stack(110, 2, '') }]);
    return shell({
      band: { eyebrow: '屏上扫描', title: kind, sub: '本次没有生成可用的扫描文件', status: { text: nofile ? kind : expired ? '等待超时 · 没有文件' : '扫描未完成', warn: 1 } },
      cls: 'cs-sfail cs-err cs-err' + opts.length + (opts.length === 1 ? ' cs-solo' : ''),
      body: `<div class="cs-why" role="alert"><span class="vis">${nofile ? cropSvg(scanPaper(220), '4 6 142 128') : scanPaper(220)}<i class="warn">${icon('alert', 34, 2.4)}</i></span><div><b>${reason}</b><p>${detail}</p></div></div>
        <div class="cs-ways">${opts.map((x) => wayCard(x)).join('')}</div>
        ${lost ? `<p class="cs-warn">${RESCAN_LOST}</p>` : ''}
        ${remind(HELP)}`,
      dock: D({ left: `<button class="btn sec" data-go="print">${icon('chevL', 30, 2.4)}返回打印扫描</button>`, ask: '问小青：扫描失败怎么办',
        pri: auth ? pri('重试扫描（同一份材料）', 'data-go="cs-scan-set"') : pri('重新开始一次扫描', 'data-cs="again"') })
    });
  }
  /* 现在程序的样子（待改）：面板扫描失败屏，眉题「扫描完成」、面板四步路径线，重试和重新开始都进面板 scan-guide */
  function scanFailedNow() {
    const c = st(), nofile = c.fail === 'nofile', expired = c.fail === 'expired', lost = !!c.rescan, auth = !nofile && !lost;
    const kind = nofile ? '已完成 · 结果里没有文件' : expired ? '等待超时' : '扫描未完成';
    const fact = (t, d, wide) => `<div class="fs-fact${wide ? ' wide' : ''}"><b>${t}</b>${d}</div>`;
    const first = nofile
      ? fact('系统说已完成，但这次结果里没有可用文件', '<span>系统确认<b>这次扫描已经完成</b>，可是同一份结果里<b>没有带可用的文件信息</b>（结果里允许不带文件，这不是出错）。</span><span>这份文件此刻还在不在系统里，<b>本机没有依据判断</b>。页面不替系统说它还在，不说它已被删掉，也不承诺能找回来。这次扫描到此结束。</span>', 1)
      : fact(expired ? '等待超时，这次没有拿到文件' : '这次没扫成的原因', `<span>${expired ? '等待超时，这次没有拿到文件。' : FAIL_REASON[c.reason]}</span>`, 1);
    const rowGo = (go, t, d) => `<button class="fs-row" data-go="${go}"><span><b>${t}</b><small>${d}</small></span><span class="go">${icon('chevR', 28, 2.2)}</span></button>`;
    const ai = S().ai === 'down' ? '<p class="fs-help">小青暂时接不上。这一步不用它也能做完，照下面的按钮继续。</p>' : '';
    return band({ back: true, seal: null, kind: 'compact', eyebrow: '扫描完成', title: kind, sub: '本次没有生成可用的扫描文件', status: { text: nofile ? kind : expired ? '等待超时 · 没有文件' : '扫描未完成', warn: 1 }, rail: { labels: ['选类型', '扫描指引', '等回传', '扫描完成'], now: 3 } })
      + `<main class="body fs-fill cs-fsfail"><div class="fs-grow">${ai}<div class="fs-facts">${first}
          ${fact('同一张纸', '<span>同一张纸原样再扫，系统可能按重复件拒收（两小时内）。</span>', 1)}
          ${fact('重试扫描（同一份材料）', `<span>${auth ? RESCAN_AUTH : '本机没有可用的安全重扫凭据。这里不写成已经放行。'}</span>`)}
          ${fact('重新开始一次扫描', '<span>这是一次普通新会话，不是免查重的重扫。不自动重扫。</span>')}</div>
          ${lost ? `<p class="fs-warn">${RESCAN_LOST}</p>` : ''}
          <p class="fs-help">${HELP}</p>
          <div class="cs-sample" aria-hidden="true">${scanPaper(300)}</div></div>
        ${nofile ? '' : rowGo('home', '返回首页', '结束这次等待')}
        ${auth ? rowGo('scan-guide', '重新开始一次扫描', '回选类型，不带安全重扫凭据') : ''}</main>`
      + dock({ back: false, left: `<button class="btn sec" data-go="print">${icon('chevL', 30, 2.4)}返回打印扫描</button>`, ask: '问小青：扫描失败怎么办', pri: { label: auth ? '重试扫描（同一份材料）' : '重新开始一次扫描', go: 'scan-guide' } })
      + nav(null);
  }

  /* ═════════ 屏上复印 ═════════ */
  /* 14 怎么复印 */
  function copyHow() {
    const blocked = copyBlock(), off = printerOff();
    return shell({
      band: { eyebrow: '复印', title: '怎么复印？', status: copyChip(), rail: { labels: COPY_RAIL, now: -1 } },
      cls: 'cs-chow',
      body: `<div class="cs-ways">
          ${wayCard({ big: 1, go: 'cs-copy-guide', chip: '最快', t: '在打印机面板上快速复印', d: '身份证复印、票据复印也在面板上', vis: mfp() })}
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
    /* 11/08：运行页设置下面的提示行（copy/CopyWorkbenchPage.tsx 42、64–72；copy/copySession.ts 95–101）：
       ?start=busy 正在建单（开始灰）、?start=limit 超过这台机器能收的大小、?start=unknown 结果没确认；
       ?scanner=capcheck…error、?printer=unknown、?net=off 时把原因写在这里，开始复印变灰。?scanner=stale 照旧只改胶囊。 */
    const CSTART = { limit: '这一次超过了这台机器能收的大小。这次先停在这里。', unknown: '状态未知。这一步的结果还没确认，请先用面板复印。不要更改设置后重新开始。' };
    const why = c.copydev === 'off' || off || c.scanner === 'stale' ? '' : copyBlock();
    const setNote = CSTART[c.start] || why, setDis = !!why || c.start === 'busy';
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
        ${off ? `<p class="cs-warn">${MACHINE}</p>` : ''}${setNote ? `<p class="cs-warn">${setNote}</p>` : ''}`,
      dock: D({ back: { go: 'cs-copy-how' }, ask: '问小青：份数怎么选', pri: pri(off ? '打印机离线' : '开始复印', 'data-cs="copy-start"', { dis: off || setDis }) })
    });
  }
  /* 17 核对复印 */
  function copyCheck() {
    const c = st(), off = printerOff(), p = c.cpg ? +c.cpg : (c.cpages || 3), n = c.copies, total = p * n, shown = Math.min(p, 3);
    const dup = c.duplex === 'off' ? 'single' : c.dup, cink = c.color === 'off' ? 'bw' : c.cink;
    const sheets = dup === 'double' ? Math.ceil(p / 2) * n : total; // 11/08 定：照程序按份取整（copy/copyCheckModel.ts 4–6）
    /* 11/08：运行页核对屏的几种样子（copy/CopyCheckView.tsx 27–49；copy/copyDeviceFlow.ts 159、166；copy/CopyDeviceView.tsx 52–53）：
       ?preview=loading|fail、?cpages=7 超过三页按组翻（翻组键照定稿 screens.js 1057 打印预览的 .pager）、
       ?quote=changed|odd|none、?net=off 主按钮「网络已断开」。付费那一种不画（价格不进仓库）。 */
    const PV = { loading: '正在读取本机预览', fail: '预览暂时无法确认，请重扫或返回。' };
    const QN = { changed: '报价已更新，请重新核对后再开始打印。', odd: '这次奇数页多份双面暂未开通，请返回修改设置。' };
    const prow = PV[c.preview] ? `<div class="cs-pv">${c.preview === 'loading' ? '<div class="cs-spin" aria-hidden="true"></div>' : icon('image', 72, 1.6)}<span>${PV[c.preview]}</span></div>`
      : `<div class="cs-prow">${Array.from({ length: shown }, (_, i) => `<div class="pgc">${pageSvg(290, 410, i)}第 ${i + 1} 页 / 共 ${p} 页</div>`).join('')}</div>`;
    const pager = p > 3 ? `<div class="pager cs-cpg"><button aria-label="上一组" disabled>${icon('chevL', 30, 2.4)}</button><span>1–3 / ${p}</span><button aria-label="下一组">${icon('chevR', 30, 2.4)}</button></div>` : '';
    const dis = off || !!c.net || !!PV[c.preview] || c.quote === 'odd' || c.quote === 'none';
    return shell({
      band: { eyebrow: '屏上复印', title: '核对一下，再开始打印', status: { text: '原件已扫完，等你核对' }, rail: { labels: COPY_RAIL, now: 1 } },
      cls: 'cs-check',
      body: `<div class="cs-pages">${prow}${pager}
          <div class="cs-pfacts"><div>原件 ${p} 页 × ${n} 份 = ${total} 页</div><div>${dup === 'double' ? '双面打印，用' : '单面打印，用'} ${sheets} 张纸</div><div>${cink === 'bw' ? '黑白' : '彩色'}</div><div>${c.quote === 'none' ? '报价暂时无法确认' : '本机构免费'}</div></div></div>
        ${howto('发现身份证号等个人信息时，会先问你保留还是遮挡', 'shield')}
        ${howto('扫描件只在这台机器上，打印完就删除', 'lock')}
        ${off ? `<p class="cs-warn">${MACHINE}</p>` : ''}${QN[c.quote] ? `<p class="cs-warn">${QN[c.quote]}</p>` : ''}`,
      dock: D({ left: `<button class="btn sec" data-cs="rescan">${icon('refresh', 28, 2)}重扫</button>`, ask: '问小青：核对什么', pri: pri(off ? '打印机离线' : c.net ? '网络已断开' : '开始打印', 'data-cs="copy-print"', { dis }) })
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
          <button class="cs-way big" data-go="cs-copy-guide"><span class="vis">${mfp()}</span><span class="tx"><span class="chip">现在可以用</span><h3>在打印机面板上复印</h3><p>复印、身份证复印、票据复印，都在打印机屏幕上点。</p></span><span class="arrow">${icon('arrowR', 30, 2.4)}</span></button>
        </div>
        ${remind(HELP)}`,
      dock: D({ back: { go: 'cs-copy-how' }, ask: '问小青：面板上怎么复印', pri: pri('怎么在打印机上复印', 'data-go="cs-copy-guide"') })
    });
  }

  /* ═════════ 11/08 补稿：屏上复印运行页有、稿上没画的几屏（待产品负责人看，不改程序） ═════════ */
  /* 免费额度用完：确认时超额（copy/CopyQuotaView.tsx、copy/copyQuotaCopy.ts）。字逐字照 copyQuotaText，面数是示意值。
     不给「改用面板复印」：面板复印不经过额度，引导过去等于绕开上限（CopyQuotaView.tsx 14–15）。 */
  const QUOTA = {
    guest: { title: '这次超过了免登录的复印面数', chip: '超过免登录上限', login: true, n: 20,
      reason: (n) => `免登录每次${n ? `最多复印 ${n} 面` : '复印的面数有上限'}。用手机号登录后，可以一次复印更多。` },
    member: { title: '你今天的免费额度已用完', chip: '今天的额度已用完', login: false, n: 50,
      reason: (n) => `${n ? `你今天已免费打印复印 ${n} 面，达到每日上限` : '你今天的免费打印复印量已达上限'}，明天 0 点恢复。` },
    terminal: { title: '这台机器今天的免费额度已用完', chip: '今天的额度已用完', login: false, n: 0,
      reason: () => '今天这台机器的免费打印复印量已用完，明天 0 点恢复。' }
  };
  const QUOTA_FACTS = ['复印和打印共用免费额度', '只算成功出纸的面数，没出纸不算'];
  const takeAll = (t) => `<div class="cs-help">${icon('hand', 34, 2)}<span>${t}</span></div>`;
  function copyQuota() {
    const c = st(), t = QUOTA[c.quota], n = c.limit ? null : t.n;
    const phoneArt = UI.phone(120).replace(/<text[^>]*>上传<\/text>/, '');
    const ways = (t.login ? wayCard({ go: 'login', t: '去登录', d: '用手机号登录后，一次可以复印更多；要重新放原件、再扫一次', vis: phoneArt }) : '')
      + wayCard({ go: 'home', t: '回首页', d: '先去办别的事', vis: stack(110, 2, '') });
    return shell({
      band: { eyebrow: '屏上复印', title: t.title, status: { text: t.chip, warn: 1 } },
      cls: 'cs-err cs-err2 cs-quota' + (t.login ? '' : ' cs-solo'),
      body: `<div class="cs-why" role="alert"><span class="vis">${mfp()}<i class="warn">${icon('alert', 34, 2.4)}</i></span>
          <div><b>${t.reason(n)}</b><p>本次没有建单，也没有出纸。${t.login ? '登录后要重新放原件、再扫一次。' : ''}</p>
          <ul class="cs-q-facts">${QUOTA_FACTS.map((f) => `<li>${f}</li>`).join('')}</ul></div></div>
        <div class="cs-ways">${ways}</div>
        ${takeAll('原件还在玻璃上或进纸器里，请带走')}
        ${remind(HELP)}`,
      dock: D({ left: t.login ? '<button class="btn sec" data-go="home">回首页</button>' : '', ask: '问小青：免费额度什么时候恢复', pri: t.login ? pri('去登录', 'data-go="login"') : pri('回首页', 'data-go="home"') })
    });
  }
  /* 复印·这一页扫好了（玻璃台）：copy/CopyDeviceView.tsx 41–59。一张「再扫一页」卡，主按钮「扫完了」；
     11/08 定：不加「扫完了，整理成预览」卡；已收到的页放大、整块上下拉开。 */
  function copyMore() {
    const c = st(), none = c.pages === 'none', n = c.rec == null ? 2 : c.rec, busy = !!c.busy;
    return shell({
      band: { eyebrow: '屏上复印', title: '这一页扫好了，还有下一页吗？', status: { text: '这一页已扫好' }, rail: { labels: COPY_RAIL, now: 0 } },
      cls: 'cs-more cs-cmore',
      body: `<div class="cs-strip">${none ? cropSvg(glassSvg(420), '2 16 146 128') : cmoreThumbs(n)}<p>${none ? '这一页已扫好' : `已收到 ${n} 页`}</p></div>
        <div class="cs-ways">
          ${wayCard({ cs: 'cmore', dis: busy, t: '再扫一页', d: '先把下一页放上玻璃台，字朝下，对齐左上角', vis: glassSvg(150) })}
        </div>
        ${armNote()}`,
      dock: D({ left: stopBtn('停止复印'), ask: '问小青：一直扫不完怎么办', pri: pri('扫完了', 'data-cs="cfinish"', { dis: busy }) })
    });
  }
  /* 复印·状态未知：copy/CopyDeviceView.tsx 40–63 + copy/copyDeviceFlow.ts 22、58、231。程序正文只有一句提示，稿借 cs-scan-unknown 的大纸版式。
     ?why=wait 等太久、?why=stop 停止没确认、?why=token 建单回包缺凭据（copy/copySession.ts 92；这一种没有停止键） */
  const CUNK = {
    '': '状态未知。这一步的结果还没确认，请先停止操作，不要重新开始。',
    wait: '状态未知。等太久还没收到新的扫描结果，请先停止操作，不要重新开始。',
    stop: '状态未知。这次停止的结果还没确认，请不要重新开始。',
    token: '状态未知。这一次没能确认复印能否继续，请先用面板复印。不要再点开始。'
  };
  function copyUnknown() {
    const c = st();
    return shell({
      band: { eyebrow: '屏上复印', title: '状态未知', status: { text: '状态未知', warn: 1 }, rail: { labels: COPY_RAIL, now: 0 } },
      cls: 'cs-issue cs-cunknown',
      body: issuePaper('状态未知', CUNK[c.why]) + armNote(),
      dock: dock({ left: `<button class="btn sec" data-go="cs-copy-how">${icon('chevL', 30, 2.4)}返回</button>`, ask: '问小青：一直扫不完怎么办', mid: c.why === 'token' ? '' : stopBtn('停止复印') })
    });
  }
  /* 复印的三种出错（copy/CopyErrorView.tsx）：打印失败、超过这台机器能收的大小、中途没开通。程序这三屏都没有「返回」。
     短句的两屏用额度屏的单栏居中，免得右半边一大片空。 */
  function copyErr(o) {
    return shell({
      band: { eyebrow: o.eyebrow || '屏上复印', title: o.title, status: { text: o.chip, warn: 1 } },
      cls: 'cs-err cs-err2' + (o.solo ? ' cs-solo' : ''),
      body: `<div class="cs-why" role="alert"><span class="vis">${mfp()}<i class="warn">${icon('alert', 34, 2.4)}</i></span><div><b>${o.reason}</b></div></div>
        <div class="cs-ways">${o.opts.map((x) => wayCard(x)).join('')}</div>
        ${o.take ? takeAll('原件还在玻璃上或进纸器里，请和复印件一起带走') : ''}
        ${remind(HELP)}`,
      dock: D({ left: '', ask: o.ask, pri: pri(o.pri, `data-cs="${o.cs}"`) })
    });
  }
  const homeOpt = { go: 'home', t: '回首页', d: '先去办别的事', vis: stack(110, 2, '') };
  const copyFailed = () => copyErr({ title: '打印失败', chip: '打印失败', reason: '看打印机屏幕上的提示。这次不会自动重打，也不会重复收费。',
    opts: [panelOpt(true), homeOpt], take: 1, ask: '问小青：取纸或异常怎么办', pri: '改用面板复印', cs: 'panel-copy' });
  const copyErrLimit = () => copyErr({ title: '这次超过了这台机器能收的大小', chip: '超过限制', reason: '减少原件页数后再试。', solo: 1,
    opts: [{ cs: 'restart-copy', t: '减少页数再试', d: '减少原件页数后再试', vis: glassSvg(150) }, panelOpt(true)], ask: '问小青：原件太多怎么复印', pri: '减少页数再试', cs: 'restart-copy' });
  const copyErrOff = () => copyErr({ eyebrow: '复印', title: '这台机器暂时只能在打印机面板上复印', chip: '屏上复印未开通', reason: '这次不能继续屏上复印，请改用面板复印。', solo: 1,
    opts: [panelOpt(true), homeOpt], ask: '问小青：面板上怎么复印', pri: '改用面板复印', cs: 'panel-copy' });

  /* ═════════ 面板复印图文引导 ═════════ */
  /* 定稿「复印」说明屏（kiosk-touch-2026-10/fix-scan.js 的 copyPage）的图文版：五步的标题和正文照定稿原句，只加协调方给的两句。
     配图只画手册核实过的东西：玻璃、进纸器、打印机面板主屏（一排四个按钮 + 左边三个实体键）、出纸口用现成的 mfp()。
     不画设置屏、开始键位置，也不画身份证、票据放在玻璃上的位置。 */
  const GI = {
    back: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3"/><path d="M14 2v4M8 10v4M16 18v4"/>',
    tap: '<path d="M22 14a8 8 0 0 1-8 8"/><path d="M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1"/><path d="M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10"/><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>'
  };
  const gicon = (p, s, w) => `<svg class="i" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w || 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  /* 打印机面板主屏：触摸屏上一排四个按钮、最下面一条状态栏；触摸屏左边竖排三个实体键（返回、主页、说明）。
     hl='all'：第 2 步，突出「复印」，身份证复印、票据复印次级突出，主页键描边；hl='id' / 'bill'：只突出对应那一个按钮。 */
  function panelDraw(hl, md) {
    const all = hl === 'all', tap = `<span class="tap">${gicon(GI.tap, 40, 1.8)}</span>`;
    const b = (key, ic, lab) => {
      const on = all ? key === 'copy' : key === hl, sub = all && (key === 'id' || key === 'bill');
      return `<span class="b${on ? ' on' : sub ? ' sub' : ''}"><span class="ic">${icon(ic, md ? 40 : 42, 2)}</span><em>${lab}</em>${on ? tap : ''}</span>`;
    };
    return `<div class="cs-g-panel${md ? ' md' : ''}" role="img" aria-label="打印机触摸屏主屏：一排四个按钮，复印、扫描、身份证复印、票据复印；触摸屏左边三个实体键">
      <div class="keys"><span class="key">${gicon(GI.back, 30, 2.2)}</span><span class="key${all ? ' home' : ''}">${icon('home', 30, 2.2)}</span><span class="key">${icon('help', 30, 2.2)}</span></div>
      <div class="scr"><div class="btns">${b('copy', 'copy', '复印')}${b('scan', 'scan', '扫描')}${b('id', 'idcard', '身份证<br>复印')}${b('bill', 'receipt', '票据<br>复印')}</div>
        <div class="bar"><i></i>就绪</div></div></div>`;
  }
  /* 出纸口：现成的 mfp()，托盘里放三张纸（样子同 cs-copy-done），按宽度缩小 */
  function mfpMini(w) {
    const k = w / 620;
    return `<span class="cs-g-mfp" style="width:${w}px;height:${Math.round(600 * k)}px" aria-hidden="true"><span class="in" style="transform:scale(${k.toFixed(4)})">${mfp()}<span class="sh"></span><span class="sh b"></span><span class="sh c"></span></span></span>`;
  }
  /* 两条提醒：不得复印伪造的证件、印章、票据；复印件和原件一起带走。big 为真时第一条放大（第二屏，正好在说身份证、票据之后） */
  const guideNotes = (big) => `<div class="cs-g-notes">
          ${big ? `<div class="cs-g-big">${icon('shield', 52, 1.8)}<span>不得复印伪造的证件、印章、票据。<br>只能复印本人的真实证件和票据。</span></div>`
            : `<div class="remind">${icon('shield', 34, 2)}<span>不得复印伪造的证件、印章、票据。只能复印本人的真实证件和票据。</span></div>`}
          <div class="remind">${icon('call', 34, 2)}<span>复印件和原件一起带走。原件还在玻璃上或进纸口里，请务必取回。${HELP}</span></div>
        </div>`;
  const guideOff = () => (printerOff() ? '<p class="cs-warn">打印机离线时复印可能也用不了，以打印机屏幕为准。</p>' : '');
  const guideChip = { text: '复印在打印机面板上操作' };
  const guideRow = (n, t, p, art) => `<div class="row"><span class="cs-g-n">${n}</span><div class="cs-g-m"><h2>${t}</h2><p class="cs-g-p">${p}</p></div><span class="cs-g-art">${art}</span></div>`;
  const guideDock = (back) => D({ back, ask: '问小青：复印要注意什么', pri: pri('去打印文件', 'data-go="print-src"') });
  /* 1 怎么在打印机上复印：五步 + 两条提醒；身份证、发票、双面放在 cs-copy-guide-more，从第 2 步旁边的按钮进 */
  function copyGuide() {
    const nb = (S().ai === 'down' ? 1 : 0) + (printerOff() ? 1 : 0);
    return shell({
      band: { eyebrow: '复印', title: '怎么在打印机上复印', sub: '复印不用在这台屏幕上下单，也不会出现在「我的打印订单」里。照下面五步做就行。', status: guideChip },
      cls: 'cs-g-body cs-g-s1 ' + (nb === 0 ? 'roomy' : nb === 2 ? 'tight' : ''),
      body: `${guideOff()}
        <section class="cs-g-card"><span class="cs-g-n">1</span><div class="cs-g-m"><h2>放原件</h2>
          <div class="cs-g-two">
            <div class="cs-g-pick"><span class="vis cs-pl-on">${placeAnim('feeder')}</span><p class="cs-g-p"><b>多页普通纸：</b><span class="cs-pl-sync cs-pl-f1">放进打印机上方的进纸口</span>，<span class="cs-pl-sync cs-pl-f0">字朝上</span>。</p></div>
            <div class="cs-g-pick"><span class="vis cs-pl-on">${placeAnim('glass')}</span><p class="cs-g-p"><b>单页、证件、书本：</b><span class="cs-pl-sync cs-pl-g0">掀开上盖</span>，<span class="cs-pl-sync cs-pl-g1">字朝下放在玻璃上</span>，<span class="cs-pl-sync cs-pl-g2">对齐左上角</span>，<span class="cs-pl-sync cs-pl-g3">再合上盖</span>。</p></div>
          </div>
          <p class="cs-g-warn">${icon('alert', 28, 2)}<span>进纸器里有纸时先扫进纸器，玻璃上的不会被复印。</span></p></div></section>
        <section class="cs-g-card"><span class="cs-g-n">2</span><div class="cs-g-m"><h2>在打印机屏幕上选功能</h2>
          <p class="cs-g-p cs-g-hint">${icon('home', 28, 2)}<span>屏幕不在主屏时，先按触摸屏左边的主页键（小房子）。</span></p>
          <div class="cs-g-sp">${panelDraw('all')}<div class="cs-g-tx">
            <p class="cs-g-p"><b>普通复印</b>点<b>「复印」</b></p>
            <p class="cs-g-p"><b>复印身份证</b>点<b>「身份证复印」</b></p>
            <p class="cs-g-p"><b>复印发票、收据</b>点<b>「票据复印」</b></p>
            <button class="cs-g-more" data-go="cs-copy-guide-more">${icon('idcard', 40, 2)}<span class="tx"><b>这几种原件这样复印</b><small>身份证、发票、双面</small></span>${icon('chevR', 28, 2.4)}</button></div></div></div></section>
        <section class="cs-g-card cs-g-list">
          ${guideRow(3, '需要时改设置', '可以改份数、黑白或彩色、单面或双面、放大缩小。每一项在哪里改，以打印机屏幕显示为准；上一位调过的设置可能还在，开始前看一眼。', `<span class="well">${gicon(GI.sliders, 48, 1.8)}</span>`)}
          ${guideRow(4, '开始复印', '点打印机屏幕上的「复印」开始。原件放在玻璃上时，扫描过程中不要掀盖。', `<span class="well">${gicon(GI.tap, 48, 1.8)}</span>`)}
          ${guideRow(5, '取走复印件和原件', '复印件从出纸口取。原件还在玻璃上或进纸口里，一起带走。', mfpMini(108))}
        </section>
        ${guideNotes()}`,
      dock: guideDock({ go: 'print', label: '返回打印扫描' })
    });
  }

  /* 双面原件：第一面印完，原件从进纸器出口出来，照原样放回进纸口。两张纸上同一个字母在同一个角，表示朝向不变。 */
  function flipDraw() {
    const sheet = (x) => `<g transform="translate(${x} 14)"><rect width="112" height="156" rx="10" fill="#fff" stroke="#9aa6a1" stroke-width="2.5"/><text x="16" y="62" font-size="56" font-weight="800" fill="#1f9e86">A</text><rect x="16" y="84" width="72" height="7" rx="3" fill="#d9ded9"/><rect x="16" y="104" width="58" height="7" rx="3" fill="#d9ded9"/><rect x="16" y="124" width="72" height="7" rx="3" fill="#d9ded9"/></g>`;
    return `<svg class="illus" width="496" height="244" viewBox="0 0 460 226" role="img" aria-label="第一面印完，原件从进纸器出口出来，照原样放回进纸口，不翻面、不转方向；两张纸上的字母 A 在同一个角">
      ${sheet(8)}${sheet(340)}
      <path d="M142 92H318M296 70l24 22-24 22" fill="none" stroke="#1f9e86" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="230" y="62" text-anchor="middle" font-size="24" font-weight="700" fill="#0f6e5c">原样放回</text>
      <text x="230" y="140" text-anchor="middle" font-size="22" fill="#43544d">不翻面、不转方向</text>
      <text x="64" y="204" text-anchor="middle" font-size="22" fill="#43544d">第一面印完</text>
      <text x="396" y="204" text-anchor="middle" font-size="22" fill="#43544d">放回进纸口</text></svg>`;
  }
  /* 2 这几种原件这样复印：身份证、发票收据、正反两面都有字 */
  function copyGuideMore() {
    /* 一张卡：左边图，右边标题 + 一两句话 + 一条小提示（提示条用 teal 或 clay 底，里头是原来同一段话的后半句） */
    const kind = (pic, t, p, note, cls) => `<section class="cs-g-kind${cls ? ' ' + cls : ''}"><div class="pic">${pic}</div><div class="tx"><h2>${t}</h2><p class="cs-g-p">${p}</p>${note}</div></section>`;
    const pill = (ic, t, clay) => `<p class="cs-g-pill${clay ? ' clay' : ''}">${icon(ic, 28, 2)}<span>${t}</span></p>`;
    return shell({
      band: { eyebrow: '复印', title: '这几种原件这样复印', sub: '身份证、发票收据、正反两面都有字，各有一点不同。', status: guideChip },
      cls: 'cs-g-body cs-g-s2' + (S().ai === 'down' && printerOff() ? ' tight' : ''),
      body: `${guideOff()}
        ${kind(panelDraw('id', 1), '身份证', '在打印机屏幕上点<b>「身份证复印」</b>，<span class="nw">需要时改设置</span>，再点<b>「复印」</b>开始。', pill('eye', '身份证怎么放、怎么翻面，请看打印机屏幕上的图示。'))}
        ${kind(panelDraw('bill', 1), '发票、收据', '在打印机屏幕上点<b>「票据复印」</b>，原件字朝下放在玻璃上、合上盖，<span class="nw">需要时改设置</span>，再点<b>「复印」</b>开始。', pill('eye', '摆放位置以打印机屏幕提示为准。'))}
        ${kind(flipDraw(), '正反两面都有字', '用进纸器放原件，选<b>「双面复印」</b>。第一面印完，原件会从进纸器出口出来。照原样放回进纸口，不翻面、不转方向，再按打印机屏幕提示印第二面。', pill('clock', '等太久没放，就只印单面。', 1), 'flip')}
        ${guideNotes(!(S().ai === 'down' || printerOff()))}`,
      dock: guideDock({ go: 'cs-copy-guide', label: '返回' })
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
    if (copy) return go('cs-copy-guide');
    S().fsType = MATS[c.mat].fs;
    return go('scan-type');
  }
  function act(k) {
    const c = st(), a = k.split(':')[0], v = k.split(':')[1];
    switch (a) {
      case 'mat': c.mat = v; c.matNone = ''; return refresh();
      case 'cmore': c.run = ''; return go('cs-copy-scan');
      case 'cfinish': c.run = 'finishing'; return go('cs-copy-scan');
      case 'way': c.way = v; return refresh();
      case 'what-next': return go('cs-scan-how');
      case 'how-next': { if (!scanBlock() && c.way === 'screen') { c.flow = 'scan'; return go('cs-scan-set'); } return toPanel(false); }
      case 'panel': return toPanel(false);
      case 'panel-copy': return toPanel(true);
      case 'src': c.src = v; return refresh();
      case 'ink': c.ink = v; return refresh();
      case 'set-start': c.flow = 'scan'; c.rec = srcOf(c) === 'glass' ? 0 : 2; c.run = ''; c.start = ''; return go('cs-scan-run');
      case 'more': return go('cs-scan-run');
      case 'finish': return go('cs-scan-make');
      case 'retry': return go('cs-scan-run');
      case 'retry-copy': return go('cs-copy-scan');
      case 'glass': c.src = 'glass'; return go('cs-scan-set');
      case 'glass-copy': c.orig = 'glass'; return go('cs-copy-set');
      case 'restart': return go('cs-scan-what');
      case 'restart-copy': return go('cs-copy-set');
      case 'again': c.rec = null; return go('cs-scan-what');
      case 'unknown-stop': {
        if (c.unknownStop) return;
        if (!c.stopArm) { c.stopArm = true; return refresh(); }
        c.stopArm = false; c.unknownStop = 'busy'; return refresh();
      }
      case 'stop': {
        if (!c.stopArm) { c.stopArm = true; return refresh(); }
        c.rec = null; return go('cs-scan-stopped');
      }
      case 'copies': c.copies = Math.min(99, Math.max(1, c.copies + (+v))); return refresh();
      case 'corig': c.orig = v; return refresh();
      case 'cink': c.cink = v; return refresh();
      case 'dup': c.dup = v; return refresh();
      case 'copy-screen': c.flow = 'copy'; return go('cs-copy-set');
      case 'copy-start': case 'rescan': c.flow = 'copy'; c.rec = c.orig === 'glass' ? 0 : 2; c.cpages = 3; c.run = ''; c.start = ''; return go('cs-copy-scan');
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
    /* 11/08：通用写法「set:键=值,键=值>屏」——改状态（值留空就是回到默认样子），带 >屏 就跳过去，不带就原地刷新 */
    if (ev.indexOf('set:') === 0) {
      const [pairs, to] = ev.slice(4).split('>');
      pairs.split(',').forEach((kv) => { const i = kv.indexOf('='); c[kv.slice(0, i)] = kv.slice(i + 1); });
      c.stopArm = false;
      return to ? go(to) : refresh();
    }
    if (ERRS[ev]) return go(ERRS[ev]);
    if (ev === 'quota') return go('cs-copy-quota');
    switch (ev) {
      case 'unknown': case 'unreachable':
        c.unknownTone = ev === 'unreachable' ? 'unreachable' : 'unconfirmed'; c.unknownStop = ''; return go('cs-scan-unknown');
      case 'stop-unconfirmed': c.unknownStop = 'locked'; c.stopArm = false; return refresh();
      case 'cloud-run': c.unknownStop = ''; return go('cs-scan-run');
      case 'cloud-make': c.unknownStop = ''; return go('cs-scan-make');
      case 'cloud-done': c.unknownStop = ''; return go('cs-scan-done');
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
    'cs-scan-what': [{ label: '演示：扫描仪状态过期', ev: 'stale' }, { label: '演示：没开通屏上扫描', ev: 'scandev-off' }, { label: '演示：恢复正常', ev: 'ok' }],
    'cs-scan-how': [{ label: '演示：扫描仪状态过期', ev: 'stale' }, { label: '演示：没开通屏上扫描', ev: 'scandev-off' }, { label: '演示：恢复正常', ev: 'ok' }],
    'cs-scan-set': [{ label: '演示：扫描仪状态过期', ev: 'stale' }, { label: '演示：没开通屏上扫描', ev: 'scandev-off' }, { label: '演示：恢复正常', ev: 'ok' }, ],
    'cs-scan-run': [{ label: '演示：扫描仪不回报页数', ev: 'nopages' }, { label: '演示：页数恢复', ev: 'pages' }, { label: '演示：这一页扫好了（玻璃台）', ev: 'pagedone' }, { label: '演示：整叠扫完了（进纸器）', ev: 'alldone' }, { label: '演示：这一步结果未确认', ev: 'unknown' }, { label: '演示：扫描中断网（进状态未知）', ev: 'set:unknownTone=unreachable,unknownStop=>cs-scan-unknown' }].concat(demoErrs),
    'cs-scan-more': [{ label: '演示：等太久没操作', ev: 'timeout' }],
    'cs-scan-make': [{ label: '演示：文件传回来了', ev: 'made' }, { label: '演示：生成文件时断网（进状态未知）', ev: 'set:unknownTone=unreachable,unknownStop=>cs-scan-unknown' }, { label: '演示：完成但结果里没有文件', ev: 'set:fail=nofile,reason=,rescan=,view=>cs-scan-failed' }],
    'cs-scan-done': [{ label: '演示：小程序还没发布（收起「手机上也能看到」）', ev: 'mini-off' }, { label: '演示：小程序已发布', ev: 'mini-on' }],
    'cs-scan-unknown': [{ label: '演示：这一步结果未确认', ev: 'unknown' }, { label: '演示：本机程序连不上', ev: 'unreachable' }, { label: '演示：停止结果未确认（停止不可再点）', ev: 'stop-unconfirmed' }, { label: '演示：云端确认正在扫描', ev: 'cloud-run' }, { label: '演示：云端确认正在生成', ev: 'cloud-make' }, { label: '演示：云端确认完成且文件可用', ev: 'cloud-done' }, { label: '演示：云端完成但结果里没有文件', ev: 'set:fail=nofile,reason=,rescan=,view=>cs-scan-failed' }],
    'cs-copy-how': [{ label: '演示：没开通屏上复印', ev: 'copydev-off' }, { label: '演示：扫描仪状态过期', ev: 'stale' }, { label: '演示：恢复正常', ev: 'ok' }],
    'cs-copy-set': [{ label: '演示：彩色没开通', ev: 'coloroff' }, { label: '演示：双面没开通', ev: 'duplexoff' }, { label: '演示：都恢复', ev: 'allon' }],
    'cs-copy-scan': [{ label: '演示：原件扫完了', ev: 'copy-scanned' }, { label: '演示：扫描仪不回报页数', ev: 'nopages' }, { label: '演示：页数恢复', ev: 'pages' }].concat(demoErrs),
    'cs-copy-print': [{ label: '演示：正在交给打印机（还没出纸）', ev: 'stage2' }, { label: '演示：打印机正在出纸', ev: 'stage3' }, { label: '演示：已交给打印机', ev: 'handed' }, { label: '演示：这次没收到打印结果', ev: 'noresult' }],
    'cs-device': [{ label: '演示：扫描仪状态过期', ev: 'stale' }, { label: '演示：恢复正常', ev: 'ok' }]
  };
  /* 11/08 补的演示事件：都用 set: 写法；先列各屏的，再统一拼到已有列表后面 */
  const D2 = (label, ev) => ({ label, ev });
  const probeDemos = (copy) => [
    D2('演示：正在检查能不能屏上' + (copy ? '复印' : '扫描'), 'set:probe=capcheck'), D2('演示：正在检查扫描仪', 'set:probe=checking'),
    D2('演示：能力读不到', 'set:probe=capfail'), D2('演示：本机程序连不上', 'set:probe=unreachable'), D2('演示：扫描仪状态未知', 'set:probe=unknown'),
    D2('演示：扫描仪正忙', 'set:probe=busy'), D2('演示：未找到扫描仪', 'set:probe=notfound'), D2('演示：扫描仪出错', 'set:probe=error'), D2('演示：检查结论恢复', 'set:probe=')
  ];
  const busyDemos = [D2('演示：处理中（全灰）', 'set:busy=1'), D2('演示：处理完', 'set:busy=')];
  const more = {
    'cs-scan-what': [D2('演示：一种都没选', 'set:matNone=1'), D2('演示：已选材料', 'set:matNone=')],
    'cs-scan-how': probeDemos(false),
    'cs-scan-set': [D2('演示：正在确认扫描仪', 'set:probe=checking'), D2('演示：正在开始', 'set:start=busy'), D2('演示：没建成（可再点开始）', 'set:start=rejected'),
      D2('演示：开始前断网', 'set:start=offline'), D2('演示：回到默认', 'set:probe=,start=')],
    'cs-scan-run': [D2('演示：已交给机器，等扫描仪', 'set:run=waiting'), D2('演示：扫描仪已开始', 'set:run=')],
    'cs-scan-more': [D2('演示：不报页数或上限', 'set:pages=none'), D2('演示：报页数', 'set:pages=known')].concat(busyDemos),
    'cs-scan-make': [D2('演示：正在传回', 'set:make=delivering'), D2('演示：正在合成', 'set:make='), D2('演示：不报页数', 'set:pages=none'), D2('演示：报页数', 'set:pages=known'),
      D2('演示：云端失败或取消（结果屏）', 'set:fail=,reason=,rescan=,view=>cs-scan-failed')],
    'cs-scan-done': [D2('演示：已登录但还没核对到本人', 'set:owned=0'),
      D2('演示：已登录且已存进', 'set:owned='), D2('演示：预览打不开', 'set:preview=fail'), D2('演示：预览正常', 'set:preview=')],
    'cs-scan-stopped': [D2('演示：没有服务端时间', 'set:quiet=none'), D2('演示：本机没确认删页', 'set:purged=0'), D2('演示：回到默认', 'set:quiet=,purged=')],
    'cs-scan-failed': [D2('演示：扫描未完成', 'set:fail=,reason='), D2('演示：云端已取消或设备中止', 'set:fail=,reason=stopped'), D2('演示：扫描仪还在预热', 'set:fail=,reason=warming'),
      D2('演示：超过这台机器能收的大小', 'set:fail=,reason=large'), D2('演示：投递没被确认', 'set:fail=,reason=ack'), D2('演示：等待超时（会话过期）', 'set:fail=expired'),
      D2('演示：完成但结果里没有文件', 'set:fail=nofile'), D2('演示：安全重扫凭据失效', 'set:rescan=lost'), D2('演示：凭据还在', 'set:rescan='),
      D2('演示：现在程序的样子（待改）', 'set:view=now'), D2('演示：新稿（11/08 定）', 'set:view=')],
    'cs-copy-how': probeDemos(true).concat([D2('演示：打印机状态读不到', 'set:pstate=unknown'), D2('演示：网络断开', 'set:net=off'), D2('演示：网络、打印机恢复', 'set:pstate=,net=')]),
    'cs-copy-set': [D2('演示：正在建单', 'set:start=busy'), D2('演示：超过这台机器能收的大小', 'set:start=limit'), D2('演示：建单结果没确认', 'set:start=unknown'),
      D2('演示：网络断开', 'set:net=off'), D2('演示：本机程序连不上', 'set:probe=unreachable'), D2('演示：回到默认', 'set:start=,net=,probe=')],
    'cs-copy-scan': [D2('演示：已交给机器，等扫描仪', 'set:run=waiting'), D2('演示：扫描仪已开始', 'set:run='), D2('演示：整理成预览', 'set:run=finishing'),
      D2('演示：这一页扫好了（玻璃台）', 'set:run=>cs-copy-more'), D2('演示：等太久没有新结果', 'set:why=wait>cs-copy-unknown'), D2('演示：超过这台机器能收的大小', 'set:busy=>cs-copy-err-limit'), D2('演示：中途没开通', 'set:busy=>cs-copy-err-off')],
    'cs-copy-more': [D2('演示：不报页数', 'set:pages=none'), D2('演示：报页数', 'set:pages=known')].concat(busyDemos),
    'cs-copy-check': [D2('演示：超过免费额度', 'quota'), D2('演示：正在读取预览', 'set:preview=loading'), D2('演示：预览打不开', 'set:preview=fail'), D2('演示：原件 7 页（按组翻）', 'set:cpg=7'),
      D2('演示：报价已更新', 'set:quote=changed'), D2('演示：奇数页多份双面未开通', 'set:quote=odd'), D2('演示：报价暂时无法确认', 'set:quote=none'), D2('演示：网络断开', 'set:net=off'),
      D2('演示：结果没确认（状态未知）', 'set:why=>cs-copy-unknown'), D2('演示：回到默认', 'set:preview=,cpg=,quote=,net=')],
    'cs-copy-print': [D2('演示：打印失败', 'set:busy=>cs-copy-failed')],
    'cs-copy-unknown': [D2('演示：这一步结果没确认', 'set:why='), D2('演示：等太久没有新结果', 'set:why=wait'), D2('演示：停止结果没确认', 'set:why=stop'), D2('演示：建单回包缺凭据（没有停止键）', 'set:why=token'),
      D2('演示：停止已确认', 'set:why=>cs-scan-stopped')],
    'cs-copy-quota': [D2('演示：游客单次超限', 'set:quota=guest'), D2('演示：本人今天用完', 'set:quota=member'), D2('演示：整机今天用完', 'set:quota=terminal'),
      D2('演示：后台没给面数', 'set:limit=none'), D2('演示：后台给了面数', 'set:limit=')]
  };
  Object.keys(more).forEach((k) => { demos[k] = (demos[k] || []).concat(more[k]); });
  ['cs-scan-err-nopaper', 'cs-scan-err-jam', 'cs-scan-err-busy', 'cs-scan-err-noresp', 'cs-scan-timeout'].forEach((k) => { demos[k] = (demos[k] || []).concat(busyDemos); });
  /* 打开某一屏时，记下它属于扫描还是复印，出错屏照这个换写法 */
  const FLOW = (id) => (/^cs-copy-/.test(id) ? 'copy' : (/^cs-scan-(what|how|set|run|more|make|done|off|unknown|failed)$/.test(id) ? 'scan' : ''));
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

  reg('cs-scan-what', G_SCAN, '扫什么', scanWhat, {
    does: '屏上扫描的第一问，只问「扫什么？」：简历 / 证件 / 普通文档 / 合同，四选一，点「下一步」去「怎么扫」。',
    motion: '无。选中只变深色并打勾。',
    keep: '样子照定稿面板扫描的选类型屏（scan-type）：整行类型卡，选中是深色；每张多一张「扫的是什么」的小样，下面两行字都是已有说法（简历可做 AI 简历识别、证件正反面各扫一次、多页放进纸器、扫成一个 PDF）。证件带「敏感文件 · 自动清理」。状态是扫描仪状态，两个样子（?scanner=stale、?scandev=off）在下一屏「怎么扫」里体现。合同在面板扫描里按普通文档处理。每屏可点 7 个：4 个材料 + 底部 3 个。可用地址 #cs-scan-what 直接打开，?mat=resume|id|doc|contract 预选材料。 11/08 补：?mat=none 是程序一种都没选时的样子，主按钮「先选一种材料」灰、无箭头（scan/ScanStartPage.tsx 261–287）。程序这屏还多副题「请先选择一种材料。本页尚未创建任务。」、U 盘灰行和两格说明，胶囊写「可创建扫描任务 · 需面板操作」，见对稿清单。' + NK
  });
  reg('cs-scan-how', G_SCAN, '怎么扫', scanHow, {
    does: '屏上扫描的第二问，只问「怎么扫？」：在这块屏上开始 / 到打印机面板上扫。选好点「下一步」，返回回「扫什么」。',
    motion: '无。选中只改边框和打勾。',
    keep: '状态「扫描仪就绪 · 20 秒前检查」。「在这块屏上开始扫描」标「推荐」。两个样子：地址 ?scanner=stale（或演示事件）时屏上方式灰掉，写「扫描仪状态 2 分钟没更新，先用面板扫描」；?scandev=off 时写「这台机器还没开通屏上扫描」。选面板扫描，「下一步」带着上一屏选的材料去定稿现有的面板扫描选类型屏（scan-type）。底部两行：没登录的人多一行「想带走电子版？先扫码登录（微信一扫，不用短信），扫完会存进「我的文档」」加「先登录」按钮，去定稿现有的登录屏（login），登录成功回到这一屏；跟说明栏「已登录」开关走，登录后这行不显示。另一行灰掉、不能点：用 U 盘（在打印机面板上选「扫描到 U 盘」）——这台机器暂未开通，真机试通之前照实写暂未开通。不做「扫码带走电子版」：屏上的码会被旁人拍走。每屏可点 5 个：2 个方式 + 底部 3 个（没登录再加「先登录」共 6 个）。 11/08 补：?scanner=capcheck|checking|capfail|unreachable|unknown|busy|notfound|error 是程序其余几种检查结论，胶囊和屏上卡写同一句（scan/scanProbeCopy.ts 66–80）；检查中主按钮「正在检查扫描仪」、灰、无箭头。程序改选面板后卡下还有一句「下一步会真实建立这次扫描」，稿没画。' + NK
  });
  reg('cs-scan-set', G_SCAN, '放纸与设置', scanSet, {
    does: '放纸与设置：纸放玻璃台还是进纸器、扫成黑白还是彩色，然后开始扫描。',
    motion: '选中的那种播「原件怎么放」（一轮 7 秒，循环）；没选中的仍是静态插画。玻璃台：掀开上盖，纸翻面字朝下放上玻璃，滑到左上角（角标闪一下），再合上盖。进纸器：一叠纸字朝上，推进进纸口到底，两侧导板靠拢。字幕只用已有原句。减弱动效时停在末帧，字幕全部展开。这是待产品负责人看的动画补稿，还没改程序。',
    keep: '玻璃台写「一次一页，适合证件、书本」「字朝下，对齐左上角」；进纸器写「一叠最多 50 页，只扫单面」「字朝上」。提示：多页单面材料用进纸器一次扫完；玻璃台适合证件、书本，一面一面扫。默认：证件用玻璃台和彩色，其余用进纸器和黑白，点了就记住。方式上一屏已经选过，这里不再放「改用面板扫描」，要改就点「返回」。扫描仪状态过期或没开通时，「开始扫描」停用，写原因并提示点「返回」改选面板扫描。每屏可点 7 个：2 个放纸 + 2 个颜色 + 底部 3 个。 11/08 补：?scanner=checking 胶囊「正在确认扫描仪」、开始灰；?start=busy 主按钮「正在开始」；?start=rejected 提示行「这一次没有建成扫描。可以再点一次开始。」；?start=offline 提示行「状态未知。这一次没能确认有没有建成扫描，请先返回，过一会儿再试。不要再点开始。」、开始灰 60 秒——这是程序断网的现状（留在本屏）。11/08 定：断网用程序现状，11/04 的独立断网屏不采用、已删。' + NK
  });
  reg('cs-scan-run', G_SCAN, '正在扫描', () => runScreen(false), {
    does: '扫描进行中。四段进度：已收到 → 扫描仪已开始 → 已收到 N 页 → 生成文件并传回，第三段进行中。',
    motion: '只有纸上的扫描光带和第三段的小圆点在动，别的都静止。可一键减弱动效。',
    keep: '页数写「已收到 N 页」，不写「已扫」；小字「每扫完一整页才加一；扫描仪不报就不显示页数」。地址 ?pages=none（或演示事件）是扫描仪不回报页数：只写「正在扫描」，不编数字和百分比。「停止扫描」要点两次：第一次变成「再点一次确认停止」并提示已收到的页会删除，6 秒不点自动取消。出错屏、这一页扫好了、扫完了都从说明栏下面的演示事件打开，也可以直接用地址 #cs-scan-err-nopaper 等打开。 11/08 补：?run=waiting 是开始后、扫描仪还没回报开始的样子：标题「已把扫描请求交给这台机器」、胶囊「等待扫描仪」（scan/ScanDeviceRunView.tsx 49–56）。' + NK
  });
  reg('cs-scan-more', G_SCAN, '这一页扫好了', scanMore, {
    does: '只在玻璃台方式出现：一页扫好后问还有没有下一页。',
    motion: '无。',
    keep: '状态「已收到 N 页」。「再扫一页」要先把下一页放上玻璃台；「扫完了，生成文件」去生成。提醒：最多 20 页；10 分钟内没有操作会自动结束，并删除已扫的页。到 20 页时「再扫一页」停用。底部左边是「停止扫描」，也要点两次。 11/08 补：?pages=none 不报页数或上限：胶囊和格子写「这一页已扫好」，提醒只剩「10 分钟内没操作会自动结束」；?busy=1 命令在途全灰。程序提醒没有「，并删除已扫的页」，见对稿清单。' + NK
  });
  reg('cs-scan-make', G_SCAN, '正在生成文件', scanMake, {
    does: '扫描仪扫完后，把页面合成一个 PDF 并传回这台机器。',
    motion: '只有「生成一个 PDF」前的小圈在转。',
    keep: '三步：扫描仪已扫完（共收到 N 页，打勾）→ 生成一个 PDF（进行中）→ 传回这台机器。可「停止」，要点两次。文件传回靠演示事件「文件传回来了」去 cs-scan-done，屏上不自己跳成功。 11/08 补：?make=delivering「生成一个 PDF」打勾、「传回这台机器」进行中；?pages=none 首行「扫描仪已扫完」、事实格「还没回报」。' + NK
  });
  reg('cs-scan-done', G_SCAN, '扫描完成', scanDone, {
    does: '扫描完成，文件已传回。核对后选下一步：拿去打印 / AI 简历识别（只简历）/ 前往我的文档（登录后）/ 再扫一份。分登录后、没登录两个样子，用说明栏「已登录」切换。',
    motion: '无。',
    keep: '「扫描完成，文件已传回」只在这一屏写。文件卡写文件名、页数、大小，下面是每一页的小图，小字「页数和方向请自己核一下」。拿去打印去定稿现有的材料检查屏 pii；AI 简历识别只有扫的是简历才能点，去 reading，其他材料灰掉并写「AI 简历识别只对简历扫描开放」。登录后：文件卡下一句醒目的「这份扫描件已存进「我的文档」，手机上打开职易达小程序也能看到」，去向多一项「前往我的文档」；后半句「手机上打开职易达小程序也能看到」属于「手机上能看到」类句子，小程序正式发布前由开关收起，只显示前半句，演示事件可切换这两种；这条「后半句要等小程序发布后才显示」的小注写在说明栏，不写在屏上。没登录：不进「我的文档」，游客段写「未登录扫描件不会进入「我的文档」。带走的办法：」三条——当场打印、存 U 盘（这台机器暂未开通）、存进「我的文档」（下次先扫码登录再扫；小程序发布后加「，手机小程序里也能看到」）（11/08 定，照程序 scan/scanGuestWays.ts 11–24，替掉旧两句）。不做「扫码带走电子版」，屏上不画二维码（屏上的码会被旁人拍走）。原件提醒：原件还在玻璃台或进纸器里，请取走。小程序一律写「职易达」。 11/08 补：游客段 11/08 定为程序的三条出路（见上）；?login=1&owned=0 已登录但还没核对到是本人的文件：不说已存、不给「前往我的文档」、也不出游客段；?preview=fail 预览区写「预览没能生成，打印仍按原文件。」，其余出路照常。程序还有「整屏查看」按钮和查看层（定稿 scan-result 有同样的查看层），这屏没画。' + NK
  });
  reg('cs-scan-err-nopaper', G_SCAN, '出错：进纸器里没有纸', errOf('nopaper'), {
    does: '扫描仪回报进纸器里没有纸。照状态样式板的版式。',
    motion: '无。',
    keep: '选项：放好纸再试 / 改用玻璃台 / 改用面板扫描，再加服务电话句。出错屏按刚才走的是扫描还是复印换写法：复印时「再试」回复印第 1 步，「改用面板」去定稿现有的面板复印屏 copy。 11/08 补：?busy=1 是重试、改用玻璃台或改用面板还在途：卡片、返回、主按钮全灰，字不变。' + NK
  });
  reg('cs-scan-err-jam', G_SCAN, '出错：卡纸或盖板没合上', errOf('jam'), {
    does: '扫描仪回报卡纸或盖板没合上。',
    motion: '无。',
    keep: '原话：扫描仪报告：卡纸或盖板没合上；合上盖板、取出卡住的纸后再试。选项：处理好了，再试 / 改用面板扫描，再加服务电话句。 11/08 补：?busy=1 是重试、改用玻璃台或改用面板还在途：卡片、返回、主按钮全灰，字不变。' + NK
  });
  reg('cs-scan-err-busy', G_SCAN, '出错：打印机正在忙', errOf('busy'), {
    does: '打印机正在打印，或有人在打印机屏幕上操作，扫描仪暂时用不了。',
    motion: '无。',
    keep: '原话：打印机正在打印，或有人在打印机屏幕上操作；等它空下来再点「再试」。选项：再试 / 取消（取消回打印扫描）。这是等一等就好的情况，不放服务电话句。 11/08 补：?busy=1 是重试、改用玻璃台或改用面板还在途：卡片、返回、主按钮全灰，字不变。' + NK
  });
  reg('cs-scan-err-noresp', G_SCAN, '出错：扫描仪没有响应', errOf('noresp'), {
    does: '这台机器暂时连不上扫描仪。',
    motion: '无。',
    keep: '原话：这台机器暂时连不上扫描仪，我们已经收到提醒，会尽快处理。选项：改用面板扫描 / 回首页，再加服务电话句。 11/08 补：?busy=1 是重试、改用玻璃台或改用面板还在途：卡片、返回、主按钮全灰，字不变。' + NK
  });
  reg('cs-scan-timeout', G_SCAN, '出错：等太久没有结果', errOf('timeout'), {
    does: '等了超过 3 分钟没有收到扫描结果。',
    motion: '无。',
    keep: '原话：超过 3 分钟没有收到扫描结果，这次不会自动重扫。选项：重新开始 / 改用面板扫描。不自己重扫，也不判成功。 11/08 补：?busy=1 是重试、改用玻璃台或改用面板还在途：卡片、返回、主按钮全灰，字不变。' + NK
  });
  reg('cs-scan-unknown', G_SCAN, '状态未知（11/08 定：改版）', scanUnknown, {
    does: '照运行页 ScanDeviceUnknownView（15–17、20–40）：两种说法——默认「这一步的结果还没确认。」，?unknown=unreachable「本机程序连不上。这一步还没有结果。」（断网时云端连续两次查不到也是这句）；停止扫描；没有返回或重新开始按钮。路径停在扫描，不点亮拿走文件。',
    motion: '纸页静止。没有四段进度、光带、百分比或成功计时器。运行页每 3 秒继续查云端（useScanDeviceFlow.ts 26/126–160），连续两次查不到进入未知；稿只由说明栏回报切屏，不发真实请求。',
    keep: '11/08 产品负责人定（按推荐）：右栏留白改版——大纸从左栏改到居中，说明（「状态未知」和那一句）放在纸下面，整块上下拉开；字号、句子、出路（底栏停止键、问小青）都没变，没加新信息。胶囊橙色，扫描、复印各处一致。问句逐字取 ScanWorkbenchChrome.tsx 66。停止先改成「再点一次确认停止」，6 秒不按收回；第二次只到「正在停止」，不跳已停止屏。说明栏可演示停止未确认：锁住停止，仍留未知。主导航与问小青是离开扫描的出口，运行页尽力撤销并清本机登记，不承诺后台已停止。可点 5（停止 1、问小青 1、导航 3）；正在停止或锁住时 4。' + NK
  });
  reg('cs-scan-stopped', G_SCAN, '已停止', scanStopped, {
    does: '用户确认停止之后：已收到的页从这台机器删除，并锁一段时间不能开始新的扫描。',
    motion: '倒计时数字这里静态画；运行时每秒减一。',
    keep: '原话：已停止扫描，已扫的页已从这台机器删除；为了不让下一位看到你的材料，90 秒后才能开始新的扫描。选项：回打印扫描 / 回首页。复印中停止（地址 ?flow=copy）见下。 11/08 补（只扫描）：?quiet=none 停止回包没带服务端时间：环里写「请稍候」、「请稍候再开始新的扫描」「为了不让下一位看到你的材料，过一会儿才能开始新的扫描。」、问句「问小青：为什么要等」；?purged=0 本机没确认删页时首格只写「已停止扫描」。11/08 定：复印停止没有静默期，稿去掉 90 秒倒计时，标题「已停止复印」，补原件提醒「原件还在玻璃上或进纸器里，请带走」，下面放玻璃台、进纸器两张现成插画示意原件在哪；问小青用「怎么复印更合适」（复印各屏已有的问句）。11/09 第三轮：复印停止三块按正文间距排，示意卡撑满下部，两张插画改上下排并放大（并排最多半屏宽，撑不满）。' + NK
  });
  reg('cs-scan-off', G_SCAN, '屏上扫描没开通', scanOff, {
    does: '这台机器还没开通屏上扫描：说清楚，并把面板扫描放成主按钮。',
    motion: '无。',
    keep: '主按钮「到打印机面板上扫」去定稿现有的面板扫描选类型屏。屏上方式灰掉、写「这台机器还没开通」，不装成可点。可用地址 #cs-scan-off 直接打开。' + NK
  });
  reg('cs-scan-failed', G_SCAN, '中断：扫描未完成（11/08 定稿）', scanFailed, {
    does: '屏上扫描中途结束、没有文件时的结果屏：云端失败或取消、设备中止、预热、超过大小、投递被拒（?reason=stopped|warming|large|ack），会话过期（?fail=expired），完成但结果里没有文件（?fail=nofile），安全重扫凭据失效（?rescan=lost）。?view=now 是现在程序的样子（待改）。',
    motion: '无。',
    keep: '11/08 产品负责人定（按推荐）：改成屏上扫描自己的结果屏，程序随后照这张改。眉题「屏上扫描」，不画面板四步路径线；原因卡写这次的原因（运行页原因句）和「同一张纸原样再扫，系统可能按重复件拒收（两小时内）。」；出路：「重试扫描（同一份材料）」回 cs-scan-set（有安全重扫凭据时才有），「重新开始一次扫描」回 cs-scan-what，「返回首页」（没文件那种没有）；底栏「返回打印扫描」、问小青「扫描失败怎么办」、主按钮有凭据时「重试扫描（同一份材料）」，没有时「重新开始一次扫描」；服务电话行照稿里的写法，运行时从后台读，读不到不显示。凭据失效那段原句照 scan/ScanResultFailedView.tsx 92–99。?view=now：现在程序落的面板失败屏（眉题「扫描完成」、面板四步路径线、重试和重新开始都进面板 scan-guide），留着对照，待改。11/09 第三轮：?fail=nofile 只有一张出路卡，原因卡照单栏居中、插画放大把卡撑满（插画在左、字在右撑不满这么高的卡）。' + NK
  });

  reg('cs-copy-how', G_COPY, '怎么复印', copyHow, {
    does: '复印的第一问：在打印机面板上快速复印，还是在这块屏上复印。两条路点了就走。',
    motion: '无。',
    keep: '第一条「在打印机面板上快速复印」标「最快」，写「身份证复印、票据复印也在面板上」，点了去本目录的图文版 cs-copy-guide（定稿 copy 屏的图文版）。第二条「在这块屏上复印」标「可先看效果」，写「先看扫描效果再打印，能改份数，彩色原件也能印成黑白；比面板慢；扫描件只在这台机器上处理，不上传」。没有「推荐」字样。底部边界句：不得复印伪造的证件、印章、票据，只能复印本人的真实证件和票据。屏上复印没开通、扫描仪状态过期、打印机离线时第二条灰掉并写原因。 11/08 补：?scanner=…（同「怎么扫」八种，字换成复印）、?printer=unknown「打印机状态暂时无法确认，请先用面板复印」、?net=off「网络断开时，我们会收到提醒并远程处理」（copy/useCopyFlow.ts 45–47、CopyWorkbenchPage.tsx 42），胶囊和屏上卡写同一句、屏上卡灰。' + NK
  });
  reg('cs-copy-guide', G_COPY, '怎么在打印机上复印（图文）', copyGuide, {
    does: '定稿「怎么在打印机上复印」（copy 屏）的图文版：五步，每步配图或图标，下面两条提醒。复印不在这块屏上下单，所以没有进度、完成页，也不进「我的打印订单」。',
    motion: '第 1 步「放原件」的两张小图播怎么放（一轮 7 秒，跟放纸设置同一套）：进纸器字朝上推进去、导板靠拢；玻璃台掀盖、字朝下对齐左上角、再合上盖。旁边原句随当前这一步加深，字不改。步骤卡仍不是按钮。减弱动效时停在末帧，原句整句都在。这是待产品负责人看的动画补稿，还没改程序。',
    keep: '标题、副标题和五步的标题与正文照定稿 copy 屏原句，只加两句：第 1 步「进纸器里有纸时先扫进纸器，玻璃上的不会被复印」（后半句出自厂家官方手册，免得「先扫」被读成「两处都扫」），第 2 步「屏幕不在主屏时，先按触摸屏左边的主页键（小房子）」。配图只画手册核实过的：第 1 步进纸器和玻璃两小图；第 2 步打印机面板主屏（触摸屏上一排四个按钮：复印、扫描、身份证复印、票据复印，最下面一条状态栏「就绪」，左边竖排三个实体键，从上到下返回、主页、说明；突出「复印」，身份证复印、票据复印次级突出，主页键描边）；第 3、4 步只用图标（设置、点一下），不画设置屏，不画开始键在屏上哪里；第 5 步用现成的 mfp()。身份证、票据放在玻璃上的位置和翻面手册没写，不画，也不写。状态胶囊「复印在打印机面板上操作」；?printer=down 时多一条「打印机离线时复印可能也用不了，以打印机屏幕为准」（同定稿打印服务台）；?ai=down 时多小青接不上的一句，步骤照样能做。可点只有：第 2 步旁的「这几种原件这样复印」（去 cs-copy-guide-more）和底栏三个。底栏：返回打印扫描去 print，问小青：复印要注意什么，主按钮「去打印文件」去 print-src。法律两句、带走原件加服务电话都在，号码与服务时间从后台读，读不到不显示。一屏放不下的身份证、发票、双面三种原件放第二屏。' + NK
  });
  reg('cs-copy-guide-more', G_COPY, '这几种原件这样复印（图文）', copyGuideMore, {
    does: '图文版的第二屏：身份证、发票收据、正反两面都有字，三张卡各配一张图。从 cs-copy-guide 第 2 步旁的按钮进来，返回回到第一屏。',
    motion: '无。',
    keep: '身份证：点「身份证复印」，需要时改设置，再点「复印」开始；怎么放、怎么翻面只写「请看打印机屏幕上的图示」。发票、收据：点「票据复印」，原件字朝下放在玻璃上、合上盖（同定稿 copy 屏原句；玻璃上一律字朝下，手册 PDF 第 31 页），需要时改设置，再点「复印」开始；具体摆在玻璃哪里以打印机屏幕提示为准。正反两面都有字：用进纸器放原件，选「双面复印」；第一面印完，原件会从进纸器出口出来；照原样放回进纸口，不翻面、不转方向，再按打印机屏幕提示印第二面；等太久没放，就只印单面。图：身份证、发票两张用面板主屏，只突出对应那一个按钮；双面那张画两张纸，同一个字母在同一个角，表示朝向不变。不画身份证、票据放在玻璃上的位置和翻面。法律提醒放大（有提示条时缩成细条），带走原件和服务电话也在。底栏同第一屏，返回回 cs-copy-guide。' + NK
  });
  reg('cs-copy-set', G_COPY, '复印设置', copySet, {
    does: '放好原件，选份数、颜色、单面还是双面，然后开始复印。',
    motion: '同 cs-scan-set：选中的原件位置播怎么放（一轮 7 秒），另一种静态。字幕只用已有原句。减弱动效时停在末帧，字幕全部展开。这是待产品负责人看的动画补稿，还没改程序。',
    keep: '原件：玻璃台 / 进纸器。份数 1–99，−10 / −1 / +1 / +10。颜色黑白 / 彩色；打印成单面 / 双面。地址 ?color=off、?duplex=off（或演示事件）时对应选项灰掉，写「本机暂未开通」。小字「原件几页，扫完才知道；扫完会给你核对」。打印机离线时主按钮写「打印机离线」并停用。每屏可点数多，是因为这里有 4 组设置，和定稿的预览与设置屏同类。 11/08 补：?start=busy 正在建单（开始灰；程序还把四组设置锁住，稿只画主按钮）、?start=limit「这一次超过了这台机器能收的大小。这次先停在这里。」、?start=unknown「状态未知。这一步的结果还没确认，请先用面板复印。不要更改设置后重新开始。」（程序把四组设置锁住）；?net=off、?scanner=capcheck…error、?printer=unknown 时原因写在提示行、开始复印灰。' + NK
  });
  reg('cs-copy-scan', G_COPY, '复印第 1 步：正在扫原件', () => runScreen(true), {
    does: '复印第 1 步：扫原件。样子同「正在扫描」，标题和路径线换成复印。',
    motion: '同 cs-scan-run：只有扫描光带和小圆点在动。',
    keep: '路径线：扫原件 → 核对 → 打印 → 取走，当前在第 1 步。页数写「已收到 N 页」，扫描仪不报就不显示。「停止复印」要点两次。原件扫完靠演示事件去核对；出错屏同扫描，按复印换写法。 11/08 补：?run=waiting 胶囊「等待扫描仪」、副题「还在等扫描仪回报已经开始。先别动原件。」；?run=finishing 胶囊「整理成预览」、副题「扫完后准备给你核对」、第 4 段进行中（copy/CopyDeviceView.tsx 46–48）；不报页数时大字照程序写「正在扫描」。' + NK
  });
  reg('cs-copy-check', G_COPY, '核对复印', copyCheck, {
    does: '复印第 2 步：核对页面和数量，再开始打印。',
    motion: '无。',
    keep: '事实格：原件 N 页 × 份数 = 总页数；单面或双面用几张纸；黑白或彩色；本机构免费。小字：发现身份证号等个人信息时，会先问你保留还是遮挡；扫描件只在这台机器上，打印完就删除。「重扫」回第 1 步。双面用纸张数按每份页数除以二向上取整再乘份数（11/08 定，照程序 copy/copyCheckModel.ts 4–6：3 页双面 × 2 份 = 4 张）。 11/08 补：演示事件「演示：超过免费额度」去 cs-copy-quota；?preview=loading「正在读取本机预览」、?preview=fail「预览暂时无法确认，请重扫或返回。」（这两种开始打印灰）；?cpages=7 超过三页按组翻（翻组键照定稿打印预览 .pager，程序是文字键「上一组」「下一组」）；?quote=changed「报价已更新，请重新核对后再开始打印。」、?quote=odd「这次奇数页多份双面暂未开通，请返回修改设置。」（开始灰）、?quote=none 价格格写「报价暂时无法确认」（开始灰）；?net=off 主按钮「网络已断开」。程序这屏没有「发现身份证号…保留还是遮挡」「打印完就删除」两条，只有「扫描件只在这台机器上处理，不上传」；双面用纸 11/08 定为照程序按份取整，稿已改。付费那一种不画（价格不进仓库）。' + NK
  });
  reg('cs-copy-print', G_COPY, '复印第 3 步：正在打印', copyPrint, {
    does: '复印第 3 步：打印。四段：已收到 → 正在交给打印机 → 打印机正在出纸 → 已交给打印机。',
    motion: '出纸动画只在第三段「打印机正在出纸」：纸一张一张从出纸口落进托盘，每张 760 毫秒，错开出来；运行时张数跟打印机回报走。第二段不出纸、不动。',
    keep: '小字「出了几张，以出纸口为准」。系统不知道用户是否拿到纸，所以不写「已出纸」「复印完成」。演示事件：正在交给打印机 / 打印机正在出纸 / 已交给打印机（去完成）/ 这次没收到打印结果（去未确认）。 11/08 补：演示事件「演示：打印失败」去 cs-copy-failed。程序没有「打印机正在出纸」这一段（没有证据就不说正在出纸），只有三段：已收到 → 正在交给打印机 → 已交给打印机，见对稿清单。' + NK
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
    keep: '大卡和主按钮「怎么在打印机上复印」都去本目录的图文版 cs-copy-guide。屏上方式灰掉、写「这台机器还没开通」。可用地址 #cs-copy-off 直接打开。' + NK
  });
  reg('cs-copy-quota', G_COPY, '复印：免费额度用完（11/08 待看）', copyQuota, {
    does: '核对屏点「开始打印」时超过免费额度：没有建单、没有出纸。三种说法用地址 ?quota=guest|member|terminal 切换（缺省 guest），说明栏演示事件也能切；?limit=none 是后台没给面数时的说法。从 cs-copy-check 的演示事件「演示：超过免费额度」进来。',
    motion: '无。',
    keep: '字逐字照 copy/copyQuotaCopy.ts（copyQuotaText），面数是示意值：游客 20 面、本人 50 面，和运行页截图一致。游客单次超限（PRINT_GUEST_ORDER_QUOTA_EXCEEDED）两条出路「去登录」「回首页」，底栏「回首页」「问小青：免费额度什么时候恢复」「去登录」；登录后回到「放好原件，选份数」，要重新放原件、再扫一次（COPY_LOGIN_PATH）。本人每日（PRINT_MEMBER_DAILY_QUOTA_REACHED）、整机每日（PRINT_TERMINAL_DAILY_QUOTA_REACHED）只有「回首页」一条出路，原因卡单栏居中竖排（照 copy-print.css 的 cc-quota-solo），底栏只有问小青和「回首页」。两条额度说明：复印和打印共用免费额度；只算成功出纸的面数，没出纸不算（COPY_QUOTA_FACTS）。不给「改用面板复印」：面板复印不经过额度，会绕开上限（CopyQuotaView.tsx 14–15）。原件提醒用 cs-copy-done 的绿条，句子照运行页「原件还在玻璃上或进纸器里，请带走」；服务电话照稿里的写法，运行时从后台读，读不到不显示。离开即清场（撤销云端单、删本机扫描页），屏上不写。定稿和本目录搜过「额度」「免登录」「每日上限」「0 点恢复」，没有同类屏，这是新屏。' + NK
  });
  reg('cs-copy-more', G_COPY, '复印：这一页扫好了', copyMore, {
    does: '复印选玻璃台时，一页扫好后问还有没有下一页（copy/CopyDeviceView.tsx 41–59）。',
    motion: '无。',
    keep: '胶囊「这一页已扫好」，标题「这一页扫好了，还有下一页吗？」，一张「再扫一页」「先把下一页放上玻璃台，字朝下，对齐左上角」，底栏「停止复印」（点两次）、问小青「一直扫不完怎么办」、主按钮「扫完了」，没有返回——都是运行页原句。11/08 定：不加「扫完了，整理成预览」卡，主按钮「扫完了」保留；已收到的页小图放大、整块上下拉开，不撑空格子。?pages=none 时只写「这一页已扫好」，格子里放玻璃台大图；?busy=1 是命令在途，卡和主按钮全灰。11/09 第三轮：已收到的页那一格撑满上部，最后两页画成大页，「下一页」占位改成两页下面一整条，「再扫一页」卡落到底部。' + NK
  });
  reg('cs-copy-unknown', G_COPY, '复印：状态未知（11/08 定：改版）', copyUnknown, {
    does: '复印中云端和本机的读数接不上、等太久没新结果、停止结果没确认时程序落的屏（copy/CopyDeviceView.tsx 40–63，句子 copy/copyDeviceFlow.ts 22、58、231）。?why=wait|stop|token 切说法（token 是建单回包缺凭据，copy/copySession.ts 92）。',
    motion: '纸页静止。',
    keep: '程序正文只有一句提示。11/08 产品负责人定（按推荐）：和 cs-scan-unknown 一起改版——大纸居中、说明放在纸下面，整块上下拉开，字号、句子、出路都没变；缺凭据那种胶囊和标题一致写「状态未知」（程序现在胶囊写「扫描仪就绪 · 刚刚检查」，要改）；胶囊橙色。和屏上扫描的状态未知不同：复印这屏有「返回」（回「怎么复印？」并清场），有「停止复印」（点两次；缺凭据那种没有停止键）。' + NK
  });
  reg('cs-copy-failed', G_COPY, '复印：打印失败（11/08 待看）', copyFailed, {
    does: '复印交给打印机后打印失败（copy/CopyErrorView.tsx，printing 为真）。',
    motion: '无。',
    keep: '标题、胶囊「打印失败」，原因「看打印机屏幕上的提示。这次不会自动重打，也不会重复收费。」，出路「改用面板复印」「回首页」，原件提醒「原件还在玻璃上或进纸器里，请和复印件一起带走」，服务电话行；底栏问小青「取纸或异常怎么办」、主按钮「改用面板复印」，没有返回——都照运行页。不重打、不重复收费是程序行为（同一次只派发一次）。' + NK
  });
  reg('cs-copy-err-limit', G_COPY, '复印：超过这台机器能收的大小', copyErrLimit, {
    does: '扫原件时超过这台机器能收的大小（错误码 too_large / COPY_LIMIT_EXCEEDED，copy/copyPrintModel.ts 14）。',
    motion: '无。',
    keep: '标题「这次超过了这台机器能收的大小」、胶囊「超过限制」、原因「减少原件页数后再试。」，出路「减少页数再试」「改用面板复印」，主按钮「减少页数再试」（回放好原件那一步重来），没有返回——照 copy/CopyErrorView.tsx 26–51。原因只有一句，稿用额度屏的单栏居中，免得右半边一大片空。11/08 定：问小青改「问小青：原件太多怎么复印」（程序现在借的是「扫描仪连不上怎么办」，要改）。' + NK
  });
  reg('cs-copy-err-off', G_COPY, '复印：中途没开通', copyErrOff, {
    does: '扫到一半屏上复印被关掉、授权失效或单子过期（COPY_UNAUTHORIZED / REVOKED / DISABLED / EXPIRED，copy/copyPrintModel.ts 15）。',
    motion: '无。',
    keep: '眉题「复印」、标题「这台机器暂时只能在打印机面板上复印」、胶囊「屏上复印未开通」、原因「这次不能继续屏上复印，请改用面板复印。」，出路「改用面板复印」「回首页」，主按钮「改用面板复印」——照 copy/CopyErrorView.tsx 26–51。和开始前就没开通的 cs-copy-off 不是一屏：这里是出错版式、没有返回。11/08 定：问小青用复印没开通屏的原句「问小青：面板上怎么复印」（程序现在借的是「扫描仪连不上怎么办」，要改）。' + NK
  });

  reg('cs-device', G_DEV, '设备状态（细分）', device, {
    does: '设备状态细分：终端程序、打印机、扫描仪、面板扫描接收，每一项都写检查时间。',
    motion: '无。',
    keep: '终端程序在线（10 秒前）、打印机就绪（10 秒前）、扫描仪就绪（20 秒前）、面板扫描接收就绪（开机时检查）。超过 1 分钟没更新的状态不算就绪：画成灰色虚线行，写「状态过期（3 分钟前）」，不用绿色。地址 ?device=stale 或演示事件，让扫描仪那一行直接变成过期，并连带写明屏上扫描、屏上复印暂不能用、先用面板。' + NK
  });

  /* 说明栏的分组和流程缩略图 */
  [G_SCAN, G_COPY, G_DEV].forEach((g) => { if (window.SCREEN_GROUPS.indexOf(g) < 0) window.SCREEN_GROUPS.push(g); });
  window.FLOWS.push(
    { n: '屏上扫描（新）', ids: ['print', 'cs-scan-what', 'cs-scan-how', 'cs-scan-set', 'cs-scan-run', 'cs-scan-more', 'cs-scan-make', 'cs-scan-done', 'pii'] },
    { n: '屏上扫描出错（新）', ids: ['cs-scan-run', 'cs-scan-err-nopaper', 'cs-scan-err-jam', 'cs-scan-err-busy', 'cs-scan-err-noresp', 'cs-scan-timeout', 'cs-scan-unknown', 'cs-scan-stopped', 'cs-scan-failed', 'cs-scan-off'] },
    { n: '屏上复印（新）', ids: ['print', 'cs-copy-how', 'cs-copy-set', 'cs-copy-scan', 'cs-copy-more', 'cs-copy-check', 'cs-copy-quota', 'cs-copy-print', 'cs-copy-done', 'cs-copy-unconfirmed', 'cs-copy-failed', 'cs-copy-unknown', 'cs-copy-err-limit', 'cs-copy-err-off', 'cs-copy-off'] },
    { n: '面板复印图文指引（新）', ids: ['print', 'cs-copy-how', 'cs-copy-guide', 'cs-copy-guide-more', 'print-src'] },
    { n: '设备状态（新）', ids: ['offline', 'cs-device'] }
  );
})();
