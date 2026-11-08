/* fix-main.js：本区（三条主路的闭环补位）新增的样式与示例数据。只放本区用到的东西，类名一律加「fm-」前缀，不改别的文件已有规则。 */
(function () {
  const css = document.createElement('style');
  css.textContent = `
.fm-file{display:flex;align-items:center;gap:16px;width:100%;min-width:0;text-align:left}
.fm-file .ft{width:72px;height:88px;border-radius:14px;background:#fdecea;color:var(--cinnabar);display:grid;place-items:center;font:700 20px var(--sans);flex:none}
.fm-file .ft.img{background:var(--teal-wash);color:var(--teal-ink)}
.fm-file div{min-width:0;flex:1}
.fm-file b{display:block;font-size:26px;line-height:1.3;color:var(--ink);font-weight:700}
.fm-file small{display:block;margin-top:4px;font-size:22px;line-height:1.35;color:var(--ink-2)}
.fm-ext{white-space:nowrap}
.dropzone.fm-got{border-style:solid;border-color:var(--edge);background:var(--card);color:var(--ink);justify-content:flex-start;padding:0 22px}
.d3-usb .filecard.fm-on{background:var(--teal-wash);border-color:var(--teal)}
.fm-note{margin:0;font-size:22px;line-height:1.4;color:var(--ink-2);text-align:left}
.fm-check{margin:0;font-size:22px;line-height:1.45;color:var(--ink-2);text-align:center}
.fm-quiet{margin:0;padding:16px 22px;border-radius:20px;background:var(--clay-wash);color:var(--clay-ink);font-size:24px;line-height:1.45;font-weight:700;text-align:left}
.fm-exp{justify-content:flex-start;align-items:stretch;text-align:left;gap:16px;padding:22px 26px}
.fm-exp p,.fm-exp b{text-align:left}
.fm-exp p{font-size:26px;line-height:1.55}
.fm-exp p b{font-size:26px;color:inherit}
.fm-facts{display:flex;flex-direction:column;gap:12px;flex:none}
.fm-facts div{min-height:100px;background:var(--well);border-radius:22px;padding:16px 22px;display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:18px}
.fm-facts span{font-size:24px;line-height:1.35;color:var(--ink-2);flex:none}
.fm-facts b{font-size:28px;line-height:1.35;color:var(--ink);text-align:right}
.fm-doc>span:not(.chev){min-width:0;flex:1}
.fm-doc small{display:block;margin-top:2px;line-height:1.35}
.fm-exp .kwrow{justify-content:flex-start}
.fm-cancel{display:flex;align-items:center;gap:28px;min-height:320px;padding:18px 22px;border-radius:28px;background:var(--card);border:1.5px solid var(--edge)}
.fm-cancel b{display:block;font:700 40px/1.3 var(--serif);color:var(--ink)}
.fm-cancel p{margin:8px 0 16px;font-size:24px;line-height:1.45;color:var(--ink-2)}
.fm-fb{width:100%;min-height:160px;border-radius:22px;border:1.5px solid var(--edge);background:var(--card);padding:16px 18px;font:500 24px/1.45 var(--sans);color:var(--ink)}
.band.hero.fm-hero{min-height:520px}
.d3-home.fm-x.body{gap:10px;padding-top:10px;padding-bottom:6px}
.d3-home.fm-x .grid2.tasks{gap:14px}
.d3-home.fm-x .task{min-height:250px}
.d3-home.fm-x.d3-on .task{min-height:228px}
.d3-home.fm-x .task .mini{transform:scale(.82);transform-origin:right bottom}
.d3-home .fm-home5{grid-template-columns:repeat(6,1fr)}
.d3-home .fm-home5>.tile:nth-child(-n+3){grid-column:span 2}
.d3-home .fm-home5>.tile:nth-child(n+4){grid-column:span 3}
.d3-home .fm-home4,.d3-home .fm-home6{grid-template-columns:repeat(6,1fr)}
.d3-home .fm-home4>.tile{grid-column:span 3}
.d3-home .fm-home6>.tile{grid-column:span 2}
.fm-hub .tile{flex:none}
.fm-pick .codebox i{height:104px}
.fm-pick .keypad{gap:12px}
.fm-pick .keypad button{height:96px}
.fm-pick .codehint{padding:14px 22px}
`;
  document.head.appendChild(css);

  function file(name, meta) {
    const m = String(name).match(/^(.*?)(\.(?:pdf|jpe?g|png))$/i);
    const base = m ? m[1] : String(name);
    const ext = m ? m[2] : '';
    const img = /\.(jpe?g|png)$/i.test(String(name));
    const kind = /\.png$/i.test(String(name)) ? 'PNG' : img ? 'JPG' : 'PDF';
    return `<div class="fm-file"><span class="ft${img ? ' img' : ''}">${kind}</span><div><b>${base}<span class="fm-ext">${ext}</span></b><small>${meta}</small></div></div>`;
  }

  function usbIndex() {
    const v = window.S && window.S.fmUsbSel;
    const n = window.D && D.usbFiles ? D.usbFiles.length : 0;
    if (v === 'first') return 0;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n) return v;
    return -1;
  }

  function hubSheet() {
    const icon = UI.icon;
    const down = window.S.ai === 'down';
    const rows = [
      ['sparkle', 'AI简历诊断', '带走问题清单和改法', 'AI 诊断改写', 'resume-src', 'diagnose', true],
      ['pen', 'AI简历优化', '对着你的方向逐条看改写', 'AI 优化改写', 'resume-src', 'optimize', true],
      ['layout', '简历素材库', '按分类查看真实模板、标签与适用场景', '模板目录', 'templates', '', false],
      ['printer', '简历打印', '选择文件、核价后在本机打印', '依赖打印机', 'print-src', '', false],
      ['user', '我的简历', '查看你名下的简历', '', 'my-resumes', '', false],
      ['sparkle', 'AI服务记录', '查看诊断与优化记录', '', 'my-ai', '', false],
      ['shield', 'AI签约风险提示', '上传劳动合同、实习协议或 Offer，核查试用期、薪酬、竞业等条款风险', 'AI · 仅供参考', 'contract', '', true]
    ];
    const item = (r) => {
      const chip = r[3] ? ` <span class="chip ${String(r[3]).startsWith('AI') ? 'ai' : 'slate'}" style="height:34px;font-size:20px;vertical-align:4px">${r[3]}</span>` : '';
      if (down && r[6]) return `<div class="tile off" role="group" aria-disabled="true" style="min-height:104px"><span class="ic">${icon(r[0], 32, 2)}</span><span class="tx"><b>${r[1]}${chip}</b><small>AI能力当前不可用</small></span></div>`;
      return `<button class="tile" data-go="${r[4]}"${r[5] ? ` data-arg="${r[5]}"` : ''} style="min-height:104px"><span class="ic">${icon(r[0], 32, 2)}</span><span class="tx"><b>${r[1]}${chip}</b><small>${r[2]}</small></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button>`;
    };
    return `<div class="scrim" data-fm="hubclose"></div><div class="sheet"><div class="grab"></div><h2>其余简历服务</h2>${rows.map(item).join('')}<button class="btn sec" data-fm="hubclose" style="width:100%">收起</button></div>`;
  }

  function feedback(state) {
    if (state === 'sent') {
      return `<div class="overlay"><div class="dialog"><h2>已记下</h2><p>不用登录，写完留在这一页。</p><div class="btns"><button class="btn pri" data-fm="fbclose">继续留在这一页</button></div></div></div>`;
    }
    return `<div class="overlay"><div class="dialog"><h2>反馈问题</h2><p>不用登录也能写。写完留在这一页。</p><textarea class="fm-fb" aria-label="反馈内容" placeholder="例如：出纸口卡住了，纸没出来"></textarea><div class="btns"><button class="btn pri" data-fm="fbsend">记下这条反馈</button><button class="btn sec" data-fm="fbclose">先不写</button></div></div></div>`;
  }

  function orderInfo() {
    return `<div class="overlay"><div class="dialog"><h2>订单说明</h2><p>订单 ORD-20261026-0418 · 毕业生就业推荐表（已填写）.pdf · 2 张 · 黑白 · 单面。</p><p>这次打印结果未确认，订单保留；结果以系统核查为准。</p><div class="btns"><button class="btn pri" data-fl="close">知道了</button></div></div></div>`;
  }
  /* 完成页、结果未确认页的「反馈问题」「查看订单说明」：在本屏开弹层（S.fmLayer 记在哪一屏、开的是哪一个），
     不弹提示条。打印服务台用自己的 data-fm 那一套，不走这里。 */
  function layerFor(ids) {
    const L = window.S.fmLayer;
    if (!L || ids.indexOf(L.id) < 0) return '';
    if (L.kind === 'order') return orderInfo();
    const fb = feedback(L.kind === 'sent' ? 'sent' : true);
    return fb.replace(/data-fm="fbsend"/g, 'data-fl="send"').replace(/data-fm="fbclose"/g, 'data-fl="close"');
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-fl]');
    const scr = e.target.closest('#stage .screen');
    if (!scr) return;
    const id = scr.dataset.id;
    if (t) {
      const k = t.dataset.fl;
      if (k === 'fb') window.S.fmLayer = { id, kind: 'fb' };
      else if (k === 'order') window.S.fmLayer = { id, kind: 'order' };
      else if (k === 'send') window.S.fmLayer = { id, kind: 'sent' };
      else if (k === 'close') window.S.fmLayer = null;
      window.__proto.refresh();
      return;
    }
    if (e.target.classList && e.target.classList.contains('overlay') && window.S.fmLayer) { window.S.fmLayer = null; window.__proto.refresh(); }
  });

  window.FM = {
    printDoc: { name: '毕业生就业推荐表（已填写）.pdf', meta: '2 页 · 186 KB' },
    /* 打印流程各屏的文件名：从 U 盘选了别的文件时，材料检查、预览、出纸都写那一份（S.printDoc），否则是示例文件。 */
    printName: () => { const n = (window.S.printDoc && window.S.printDoc.name) || '毕业生就业推荐表（已填写）.pdf'; const ext = (n.match(/\.[^.]+$/) || [''])[0]; return `<b class="d3-fname">${n.slice(0, n.length - ext.length)}<span class="d3-ext">${ext}</span></b>`; },
    printMeta: () => (window.S.printDoc ? window.S.printDoc.meta : '共 2 页 · 186 KB'),
    resumeDoc: { name: '李佳怡-产品运营-简历.pdf', meta: '1 页 · 248 KB' },
    file, usbIndex, hubSheet, feedback, layerFor
  };
})();
