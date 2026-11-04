/* fix-scan.js：扫描与打印工具。样式、示例数据和八屏行为都在这里，类名加 fs-。 */
(function () {
  const css = document.createElement('style');
  css.textContent = `
.screen:has(.body.fs-fill) .dock{padding:16px 28px;gap:12px}
.screen:has(.body.fs-fill) .dock .btn{padding:0 16px}
.screen:has(.body.fs-fill) .dock .btn.pri{min-width:0}
.body.fs-fill{justify-content:flex-start;gap:10px;padding:12px 40px 10px}
.fs-grow{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}
.fs-card{background:var(--card);border:1.5px solid var(--edge);border-radius:26px;padding:14px 16px;display:flex;flex-direction:column;gap:8px;min-height:0}
.fs-h{font:700 24px/1.3 var(--sans);color:var(--ink);margin:0}
.fs-p{margin:0;font-size:22px;line-height:1.45;color:var(--ink-2)}
.fs-p b{color:var(--ink)}
.fs-help{background:var(--teal-wash);color:var(--teal-ink);border-radius:18px;padding:12px 14px;font-size:22px;line-height:1.45}
.fs-warn{background:var(--clay-wash);color:var(--clay-ink);border-radius:18px;padding:12px 14px;font-size:22px;line-height:1.45}
.fs-ol{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}
.fs-step{flex:1;min-height:0;display:grid;grid-template-columns:48px 1fr;gap:4px 12px;align-content:center;background:var(--well);border-radius:20px;padding:10px 14px}
.fs-step .n{grid-row:1 / span 2;width:48px;height:48px;border-radius:50%;background:var(--deep);color:var(--cream);display:grid;place-items:center;font:700 22px/1 var(--sans)}
.fs-step b{font-size:24px;line-height:1.3;color:var(--ink)}
.fs-step span{font-size:22px;line-height:1.4;color:var(--ink-2)}
.fs-row{display:flex;align-items:center;gap:12px;width:100%;min-height:76px;padding:10px 14px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge);text-align:left;color:var(--ink)}
.fs-row:active{transform:scale(.98)}
.fs-row b{display:block;font-size:24px;line-height:1.3}
.fs-row small{display:block;font-size:22px;line-height:1.35;color:var(--ink-2);font-weight:500}
.fs-row .go{margin-left:auto;flex:none;color:var(--teal-ink)}
.fs-row[disabled]{opacity:.45}
.fs-row.on,.fs-type[aria-pressed="true"]{background:var(--deep);color:var(--cream);border-color:var(--deep)}
.fs-row.on small,.fs-type[aria-pressed="true"] .fs-sub{color:var(--mint)}
.fs-types{display:flex;flex-direction:column;gap:8px}
.fs-type{display:flex;flex-direction:column;gap:4px;width:100%;min-height:96px;padding:12px 14px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge);text-align:left;color:var(--ink)}
.fs-type:active{transform:scale(.98)}
.fs-type b{font:700 28px/1.25 var(--serif)}
.fs-type .fs-sub{font-size:22px;line-height:1.35;color:var(--ink-2)}
.fs-chips{display:flex;flex-wrap:wrap;gap:8px}
.fs-chip{display:inline-flex;align-items:center;min-height:36px;padding:0 12px;border-radius:18px;background:var(--teal-wash);color:var(--teal-ink);font:700 20px/1.2 var(--sans)}
.fs-chip.clay{background:var(--clay-wash);color:var(--clay-ink)}
.fs-type[aria-pressed="true"] .fs-chip{background:rgba(255,255,255,.14);color:var(--cream)}
.fs-facts{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:1fr;gap:8px}
.fs-fact{background:var(--well);border-radius:18px;padding:12px 14px;display:flex;flex-direction:column;justify-content:center;gap:4px;min-height:0}
.fs-fact.wide{grid-column:1 / -1}
.fs-fact b{font-size:22px;line-height:1.3;color:var(--ink)}
.fs-fact span{font-size:22px;line-height:1.4;color:var(--ink-2)}
.fs-2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.fs-kvs{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.fs-kv{background:var(--well);border-radius:18px;padding:10px 12px;display:flex;flex-direction:column;justify-content:center;gap:4px;min-height:84px}
.fs-kv span{font-size:20px;line-height:1.3;color:var(--ink-3)}
.fs-kv b{font-size:24px;line-height:1.35;color:var(--ink)}
.fs-mock{background:var(--deep);color:var(--cream);border-radius:18px;padding:12px 14px;display:flex;flex-direction:column;gap:4px}
.fs-mock b{font-size:20px;color:var(--mint)}
.fs-mock span{font-size:26px;line-height:1.3}
.fs-chain{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.fs-chain div{background:var(--well);border-radius:18px;padding:10px 12px;min-height:88px;display:flex;flex-direction:column;justify-content:center;gap:4px}
.fs-chain b{font-size:22px;color:var(--ink)}
.fs-chain span{font-size:20px;line-height:1.35;color:var(--ink-2)}
.fs-file{display:flex;gap:16px;align-items:center;min-height:0}
.fs-file .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.fs-card>.tx{min-width:0;display:flex;flex-direction:column;gap:4px}
.fs-file b,.fs-card>.tx b{font-size:26px;line-height:1.3;word-break:break-all}
.fs-doc{height:82%;max-width:78%;display:flex;align-items:center;justify-content:center}
.fs-doc svg{height:100%;width:auto;max-width:100%}
.fs-hero{flex:1;min-height:0;background:var(--well);border-radius:22px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:12px 16px}
.fs-hero .fs-doc{height:52%}
.fs-hero .fs-time{font:700 48px/1.15 var(--serif);color:var(--ink)}
.fs-kvs.flat{flex:none;grid-auto-rows:auto}
.fs-slot{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}
.fs-page{flex:1;min-height:0;background:var(--well);border-radius:22px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
.fs-sheet{height:90%;width:auto;aspect-ratio:1/1.414;max-width:70%;background:#fff;border-radius:10px;position:relative;box-shadow:0 8px 20px rgba(11,36,30,.12)}
.fs-stamp{position:absolute;min-height:36px;padding:4px;border:2px dashed var(--teal);border-radius:8px;background:rgba(226,242,235,.9);color:var(--teal-ink);font:700 20px/1.2 var(--sans);display:flex;align-items:center;justify-content:center;text-align:center}
.body.fs-fill [hidden]{display:none !important}
.fs-nine{max-width:none;width:100%;flex:1;min-height:0;grid-template-rows:repeat(3,minmax(72px,1fr))}
.fs-nine button{height:auto;min-height:72px;font:700 22px/1.2 var(--sans);color:var(--ink)}
.fs-plist{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}
.fs-plist div{flex:1;min-height:64px;display:flex;flex-direction:column;justify-content:center;gap:4px;background:var(--well);border-radius:18px;padding:12px 14px}
.fs-plist b{font-size:24px;line-height:1.3;word-break:break-all}
.fs-plist span{font-size:22px;line-height:1.35;color:var(--ink-2)}
.fs-plist div.on{background:var(--deep);color:var(--cream)}
.fs-plist div.on span{color:var(--mint)}
.fs-moregrid{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:1fr;gap:8px}
.fs-moregrid .fs-row{height:100%;min-height:72px}
.fs-nine button.on{color:#fff}
.fs-pair{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px}
.fs-act{flex:1;min-height:200px;display:grid;grid-template-columns:220px minmax(0,1fr) 64px;gap:16px;align-items:center;width:100%;padding:16px 18px;border-radius:28px;background:var(--card);border:1.5px solid var(--edge);text-align:left;color:var(--ink)}
.fs-act .vis{height:100%;min-height:0;border-radius:22px;background:var(--well);display:grid;place-items:center;overflow:hidden}
.fs-act .vis svg{height:76%;width:auto;max-width:90%;max-height:90%}
.fs-act .tx{min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:6px}
.fs-act h3{margin:0;font:700 36px/1.25 var(--serif);color:var(--ink)}
.fs-act p{margin:0;font-size:24px;line-height:1.4;color:var(--ink-2)}
.fs-act .go{width:64px;height:64px;border-radius:50%;background:var(--deep);color:var(--cream);display:grid;place-items:center}
.fs-act:not(:disabled):active{transform:scale(.985)}
.fs-act:disabled{background:var(--well);border-style:dashed;cursor:default}
.fs-act:disabled h3{color:var(--ink-2)}
.fs-act:disabled .go{visibility:hidden}
.fs-lead{margin:0;font:700 32px/1.35 var(--serif);color:var(--ink)}
.fs-idhead{display:grid;grid-template-columns:250px minmax(0,1fr);gap:18px;align-items:center;background:var(--card);border:1.5px solid var(--edge);border-radius:26px;padding:14px 18px}
.fs-idhead .vis{min-height:150px;border-radius:22px;background:var(--well);display:grid;place-items:center}
.fs-idhead .vis svg{height:132px;width:auto}
.fs-idhead h2{margin:0;font:700 40px/1.25 var(--serif);color:var(--ink)}
.fs-idhead p{margin:8px 0 0;font-size:24px;line-height:1.4;color:var(--ink-2)}
.fs-plan{background:var(--card);border:1.5px solid var(--edge);border-radius:22px;padding:12px 16px;display:flex;flex-direction:column;gap:6px}
.fs-plan .hd{display:flex;align-items:center;gap:10px}
.fs-plan .hd b{font-size:24px;color:var(--ink)}
.fs-plan ol{margin:0;padding:0 0 0 1.4em;display:flex;flex-direction:column;gap:4px}
.fs-plan li{font-size:22px;line-height:1.35;color:var(--ink-2)}
.fs-lock{display:flex;flex-direction:column;gap:8px}
.fs-hold{display:grid;grid-template-columns:148px minmax(0,1fr) auto;gap:12px;align-items:center;min-height:76px;padding:8px 14px;border-radius:20px;background:var(--well);border:1.5px dashed var(--edge)}
.fs-steps{display:flex;flex-direction:column;gap:8px;flex:none}
.fs-steps .fs-step{flex:none;padding:12px 14px}
.fs-scanhero{flex:1;min-height:180px;display:grid;grid-template-columns:minmax(180px,42%) minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:16px;align-items:stretch;background:var(--well);border-radius:22px;padding:16px 20px}
.fs-scanhero .vis{min-height:0;height:100%;display:grid;place-items:center}
.fs-scanhero .vis svg{height:100%;width:auto;max-width:100%;max-height:100%}
.fs-scanhero p{margin:0;align-self:center;font-size:26px;line-height:1.45;color:var(--ink)}
.fs-hold b{font-size:26px;line-height:1.3;color:var(--ink)}
.fs-hold span{font-size:22px;line-height:1.35;color:var(--ink-2)}
.fs-pips{display:flex;gap:8px}
.fs-pips span{flex:1;min-height:48px;border-radius:16px;background:var(--well);display:flex;align-items:center;justify-content:center;font:700 22px/1.2 var(--sans);color:var(--ink-3)}
.fs-pips span.on{background:var(--deep);color:var(--cream)}
.fs-ovacts{display:flex;gap:12px;width:100%;flex-wrap:wrap}
.fs-ovacts .btn{flex:1;min-width:140px}
.fs-qr{display:flex;justify-content:center}
@keyframes fs-breathe{from{opacity:.35}to{opacity:1}}
.fs-dot{width:14px;height:14px;border-radius:50%;background:var(--teal);display:inline-block;animation:fs-breathe 1.6s ease-in-out infinite alternate;flex:none}
.app.reduced .fs-dot{animation:none;opacity:1}
`;
  document.head.appendChild(css);

  const { icon, band, dock, nav, qr, resume, stack, phone, usb, idcard, scanPaper, checklist } = UI;
  const S = () => window.S;
  const refresh = () => window.__proto && window.__proto.refresh();
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const HELP = '需要帮助？拨打服务电话 183-6916-1921';
  const RAIL = ['选类型', '扫描指引', '等回传', '扫描完成'];
  const FORMAT = '设备回传原格式（系统不转换）';
  const SAVE = '按设备回传的原格式保存，系统不做转换';
  const AUTH = '我确认本人拥有该签名/印章图片的使用授权，仅用于本人材料的版式整理';
  const ESIGN = '签名仅用于个人材料整理与打印辅助，不提供 CA 电子签、电子认证或合同签署服务；仅为图片合成预览，不具备法律认证效力，正式法律文件请通过具备资质的电子签名服务办理。';
  const SENSITIVE = '证件照、身份证等敏感文件仅用于本次打印/扫描,完成后按隐私策略自动清理,不长期留存;打印前隐私检查时,扫描件/图片可能通过第三方 OCR 服务识别文字。';
  const TYPES = {
    resume: { label: '简历扫描', desc: '扫描纸质简历，按设备回传格式保存，可进入 AI 识别与优化，也可打印', chips: [['支持 AI 简历识别', ''], ['按回传格式保存', '']] },
    id: { label: '证件扫描', desc: '扫描证件原件存档；证件类文件设有效期并自动清理', chips: [['敏感文件 · 自动清理', 'clay'], ['按回传格式保存', '']] },
    document: { label: '普通文档', desc: '扫描通用材料，按设备回传格式保存；未登录不会进入「我的文档」', chips: [['按回传格式保存', ''], ['可打印', '']] }
  };
  const STEPS = {
    resume: [
      '将简历原件正面朝上放入自动进纸器，或正面朝下对齐玻璃板左上角',
      '在打印机操作面板点击「扫描」',
      '选择「扫描到 SMB」（本机已配置的接收目录）；简历建议黑白，文字更清晰',
      '按「开始」扫描；完成后回到这台机器等待自动识别，请勿关闭页面'
    ],
    id: [
      '将证件正面朝下放在打印机玻璃板中央，取下订书钉并抚平',
      '在打印机操作面板点击「扫描」，分辨率建议 300 DPI',
      '选择「扫描到 SMB」（本机已配置的接收目录）后按「开始」；正反面需翻面再扫一次',
      '完成后回到这台机器等待自动识别，请勿关闭页面'
    ],
    document: [
      '多页材料放入自动进纸器，单页证书放在玻璃板上',
      '在打印机操作面板点击「扫描」，并选择「扫描到 SMB」（本机已配置的接收目录）',
      '按「开始」扫描；整叠扫完后回到这台机器等待自动生成 PDF，请勿关闭页面'
    ]
  };
  const FILES = {
    resume: { name: '王晓婷-产品运营简历.pdf', mime: 'PDF', size: '486 KB', pages: '2 页', pagesN: 2 },
    id: { name: '居民身份证-正反面.jpg', mime: 'JPEG', size: '1.2 MB', pages: '页数以文件为准', pagesN: 0 },
    document: { name: '实习证明-青序文化-2026.pdf', mime: 'PDF', size: '220 KB', pages: '1 页', pagesN: 1 }
  };
  const POOL = [
    { name: '成绩单-2024学年-第1页.jpg', size: '1.8 MB', kb: 1800 },
    { name: '校园创业大赛-获奖证书.png', size: '640 KB', kb: 640 },
    { name: '实习证明-青序文化-扫描.png', size: '2.1 MB', kb: 2100 }
  ];
  const POS = [
    ['top-left', '左上'], ['top-center', '上'], ['top-right', '右上'],
    ['middle-left', '左'], ['center', '中'], ['middle-right', '右'],
    ['bottom-left', '左下'], ['bottom-center', '下'], ['bottom-right', '右下']
  ];
  const POS_L = Object.fromEntries(POS);

  function typeId() { return TYPES[S().fsType] ? S().fsType : 'resume'; }
  function fileOf() { return FILES[typeId()]; }
  function leftText(sec) {
    const s = Math.max(0, sec | 0), m = Math.floor(s / 60), r = s % 60;
    return '剩余 ' + m + ' 分 ' + (r < 10 ? '0' : '') + r + ' 秒';
  }
  function waitText(sec) {
    const s = Math.max(0, sec | 0), m = Math.floor(s / 60), r = s % 60;
    return m + ' 分 ' + (r < 10 ? '0' : '') + r + ' 秒';
  }
  function aiNote() {
    return S().ai === 'down' ? '<p class="fs-help">小青暂时接不上。这一步不用它也能做完，照下面的按钮继续。</p>' : '';
  }
  function help(t) { return `<p class="fs-help">${t || HELP}</p>`; }
  function shell(o) {
    const b = band(Object.assign({ back: true, seal: null, kind: 'compact' }, o.band));
    const d = o.dock === false ? '' : dock(o.dock || {});
    const n = nav(null).replace('<span>问小青</span>', '<span>AI 顾问</span>');
    return b + `<main class="body fs-fill">${o.body}</main>` + d + n + (o.overlay || '');
  }
  function backPrint(label) {
    return `<button class="btn sec" data-go="print">${icon('chevL', 30, 2.4)}${label || '返回打印扫描'}</button>`;
  }
  function row(arg, title, desc, o) {
    o = o || {};
    const go = o.go ? ` data-go="${o.go}"` : '';
    const dis = o.dis ? ' disabled' : '';
    const pr = o.pressed != null ? ` aria-pressed="${o.pressed ? 'true' : 'false'}"` : '';
    return `<button class="fs-row${o.on ? ' on' : ''}" data-act="fs" data-arg="${arg}"${go}${dis}${pr}><span><b>${title}</b>${desc ? `<small>${desc}</small>` : ''}</span></button>`;
  }
  function goRow(go, title, desc) {
    return `<button class="fs-row" data-go="${go}"><span><b>${title}</b>${desc ? `<small>${desc}</small>` : ''}</span><span class="go">${icon('chevR', 28, 2.2)}</span></button>`;
  }
  function chips(list, on) {
    return `<span class="fs-chips">${list.map((c) => `<span class="fs-chip ${on ? 'on' : ''} ${c[1] || ''}">${c[0]}</span>`).join('')}</span>`;
  }
  function facts(list) {
    return `<div class="fs-facts">${list.map((f) => `<div class="fs-fact${f.wide ? ' wide' : ''}"><b>${f.t}</b><span${f.attr || ''}>${f.d}</span></div>`).join('')}</div>`;
  }
  function stepsHtml(lines) {
    return `<div class="fs-ol">${lines.map((t, i) => `<div class="fs-step"><span class="n">${i + 1}</span><b>${typeof t === 'string' ? '' : t[0]}</b><span>${typeof t === 'string' ? t : t[1]}</span></div>`).join('')}</div>`;
  }
  function overlay(h, body, acts) {
    return `<div class="overlay"><div class="dialog"><h2>${h}</h2>${body}<div class="fs-ovacts">${acts}</div></div></div>`;
  }
  function qrBox(kind) {
    const map = {
      img: ['用手机加一张图片', '扫这个码，传一张 JPG 或 PNG。系统放进列表之后，这里才看得到。这一页不自己变成已收到。', 7],
      pdf: ['用手机上传 PDF', '扫这个码，上传不超过 15MB、1 到 30 页的 PDF。系统收下后才进入下一步。', 3],
      stamp: ['用手机上传签名图', '扫这个码，上传 JPG 或 PNG。只接受本人手写签名，不接受单位公章或圆形章。', 5]
    };
    const m = map[kind] || map.img;
    return overlay(m[0], `<div class="fs-qr">${qr(m[2], 280)}</div><p>${m[1]}</p>`, '<button class="btn pri" data-act="fs" data-arg="qr-close">关闭</button>');
  }

  function scanType() {
    if (S().fsUsb) return usbPage();
    const g = S().fsGate || 'ready';
    if (g === 'checking' || g === 'closed' || g === 'unknown') return gatePage(g);
    const id = typeId();
    const t = TYPES[id];
    const cards = Object.keys(TYPES).map((k) => {
      const o = TYPES[k];
      return `<button class="fs-type" data-act="fs" data-arg="type:${k}" data-pick="${S().fsPick || 0}" aria-pressed="${k === id ? 'true' : 'false'}"><b>${o.label}</b><span class="fs-sub">${o.desc}</span>${chips(o.chips, k === id)}</button>`;
    }).join('');
    return shell({
      band: { eyebrow: '材料扫描', title: '材料扫描', sub: '请先选择扫描类型；本页尚未创建任务。下一步会真实建立这次扫描', status: { text: '可创建扫描任务 · 需面板操作' }, rail: { labels: RAIL, now: 0 } },
      body: `${aiNote()}<div class="fs-types" data-pick="${S().fsPick || 0}">${cards}</div>
        ${row('usb', '改用面板扫描到 U 盘', '不创建平台任务，文件只在你的 U 盘')}
        <div class="fs-grow">${facts([
          { t: '屏幕上没有「开始扫描」', d: '只能在奔图面板启动。网页不能远程驱动扫描仪，也没有扫到第几张的进度。', wide: true },
          { t: '放好纸', d: '把原稿放进扫描区。你在打印机上操作。' },
          { t: '面板上按扫描', d: '按屏幕上给出的这次说明操作。' },
          { t: '回到这台机器', d: '文件回来后在这里确认。未登录不进「我的文档」。' },
          { t: '已选「' + t.label + '」', d: '点类型只是选中。下一步建立这次扫描，并确认这台机器能收到扫描件。', wide: true }
        ])}</div>`,
      dock: { ask: '问小青：扫描和复印有什么不同', pri: { label: '下一步 · 建立这次扫描', go: 'scan-guide', act: 'fs', arg: 'next' } }
    });
  }
  function usbPage() {
    return shell({
      band: { eyebrow: '材料扫描', title: '扫描到 U 盘', sub: '这是打印机自己的独立能力，不经过屏幕上的扫描流程', status: { text: '独立路径 · 扫描到 U 盘', warn: 1 } },
      body: `<p class="fs-warn">这条能力暂未开通，不能把这条说明当成已经可以用。</p>
        <div class="fs-grow">${facts([
          { t: '把 U 盘插上', d: '插到打印机支持的 USB 接口。' },
          { t: '在奔图面板上选', d: '打开「扫描」，选择「扫描到 U 盘」。' },
          { t: '按面板提示', d: '选文件格式和保存位置，再开始扫描。' },
          { t: '拔出之前', d: '先按面板提示安全结束，再拔出 U 盘。' },
          { t: '和平台扫描不同', d: '不创建平台任务，没有任务编号，不显示进度，不进「我的文档」。', wide: true },
          { t: '面板没有这一项', d: '不要反复点。' + HELP, wide: true }
        ])}</div>`,
      dock: { back: false, left: `<button class="btn sec" data-act="fs" data-arg="usb-back">${icon('chevL', 30, 2.4)}返回材料扫描</button>`, ask: '问小青：U 盘扫描怎么走', pri: { label: '完成后回打印扫描', go: 'print' } }
    });
  }
  function gatePage(g) {
    const checking = g === 'checking';
    const unknown = g === 'unknown';
    const title = checking ? '正在确认扫描能力' : unknown ? '能力状态暂不可用' : '扫描能力暂未开放';
    const status = checking ? '正在确认扫描能力' : unknown ? '能力状态暂不可用' : '扫描能力暂未开放';
    const lead = checking ? '正在读取这台机器的扫描配置。' : unknown ? '本机未能读取扫描能力配置。恢复后可继续；扫描仍需在打印机面板操作。' : '扫描还没对这台机器开放，或正在维护。恢复之后可以再试。';
    return shell({
      band: { eyebrow: '材料扫描', title: title, sub: '当前无法创建扫描任务', status: { text: status, warn: !checking } },
      body: `<div class="fs-grow">${facts([
          { t: checking ? '正在读取配置' : unknown ? '状态未知' : '暂未开放', d: lead, wide: true },
          { t: '测试中，暂未对用户开放', d: '还在测试，或正在维护，现在都不能扫描。' },
          { t: '维护中，暂时不可用', d: '这台机器暂时不支持扫描。恢复之后可以再试。' },
          { t: '现在不能开始', d: '确认完成之前，不能建立扫描，也不能在面板上开始。' },
          { t: '你现在还能做什么', d: '上传现成文件仍可打印。也可以看扫描到 U 盘的说明，那条仍写暂未开通。', wide: true }
        ])}${help()}</div>
        ${row(checking ? 'noop' : 'recheck', checking ? '正在确认…' : '重新确认能力', '再读一次这台机器的扫描配置', { dis: checking })}
        ${row('usb', '改用面板扫描到 U 盘', '文件只进你的 U 盘，平台不接收')}`,
      dock: { back: false, left: backPrint(), ask: '问小青：扫描没开放怎么办', pri: { label: '改用上传文件打印', go: 'print-src' } }
    });
  }

  function guideMode() {
    const g = S().fsGuide;
    if (!g || g === 'steps') return 'steps';
    return g;
  }
  function scanGuide() {
    const mode = guideMode();
    const id = typeId();
    if (mode === 'creating') {
      return shell({
        band: { eyebrow: '扫描指引', title: '正在建立这次扫描', sub: '等系统返回这次扫描，返回前不给出面板步骤', status: { text: '正在建立这次扫描' }, rail: { labels: RAIL, now: 1 } },
        body: `<div class="fs-grow">${aiNote()}${facts([
          { t: '还没有任务', d: '系统没返回之前，不显示面板步骤，也不开始等待。', wide: true },
          { t: '类型', d: TYPES[id].label },
          { t: '输出格式', d: FORMAT },
          { t: '保存', d: SAVE },
          { t: '主按钮', d: '停在「等系统返回这次扫描」，不能提前去面板。' },
          { t: '返回', d: '返回选类型会撤掉这次还没建成的请求。' }
        ])}</div>`,
        dock: { back: false, left: `<button class="btn sec" data-go="scan-type" data-act="fs" data-arg="restart">${icon('chevL', 30, 2.4)}返回选类型</button>`, ask: '问小青：任务还没建好', pri: { label: '等系统返回这次扫描', disabled: true } }
      });
    }
    if (mode === 'fail') {
      return shell({
        band: { eyebrow: '扫描指引', title: '扫描任务未创建', sub: '这次扫描没建好', status: { text: '这次扫描没建好', warn: 1 }, rail: { labels: RAIL, now: 1 } },
        body: `<div class="fs-grow">${aiNote()}${facts([
          { t: '没建好', d: '上一场还没收尾，或这台机器暂时存不下。请重新建立，或返回重选。', wide: true },
          { t: '重新建立', d: '再试一次。建好之前，还看不到面板上的步骤。' },
          { t: '安全重扫', d: S().fsRescan ? '这是一次安全重扫，要等系统确认，现在还没放行。' : '这次不是安全重扫。' },
          { t: '类型', d: TYPES[id].label },
          { t: '输出格式', d: FORMAT },
          { t: '下一步', d: '建好之前不给出面板步骤，也不开始等待。' }
        ])}${help()}</div>`,
        dock: { back: false, left: `<button class="btn sec" data-go="scan-type" data-act="fs" data-arg="restart">${icon('chevL', 30, 2.4)}返回选类型</button>`, ask: '问小青：扫描任务没建好', pri: { label: '重新建立', act: 'fs', arg: 'rebuild' } }
      });
    }
    if (mode === 'expired') {
      return shell({
        band: { eyebrow: '扫描指引', title: '这次扫描已过期', sub: '有效期 10 分钟，到点就不能按原任务继续', status: { text: '这次扫描已过期', warn: 1 }, rail: { labels: RAIL, now: 1 } },
        body: `<div class="fs-grow">${aiNote()}${facts([
          { t: '已过期', d: '请重新开始一次扫描。过期不是成功，也不会自动重扫。', wide: true },
          { t: '凭据', d: '安全重扫凭据另行计 15 分钟，和这 10 分钟不是同一件事。' },
          { t: '有效期', d: '任务本身 10 分钟。到点不能按原任务继续。' },
          { t: '类型', d: TYPES[id].label },
          { t: '输出格式', d: FORMAT },
          { t: '保存', d: SAVE }
        ])}${help()}</div>`,
        dock: { ask: '问小青：扫描过期了怎么办', pri: { label: '重新开始一次扫描', go: 'scan-type', act: 'fs', arg: 'restart' } }
      });
    }
    if (mode === 'ack') {
      return shell({
        band: { eyebrow: '扫描指引', title: '正在确认能收到扫描件', sub: '确认之前，先不显示面板步骤', status: { text: '还没确认能收到扫描件', warn: 1 }, rail: { labels: RAIL, now: 1 } },
        body: `<div class="fs-grow">${aiNote()}${facts([
          { t: '先确认授权', d: '还没确认之前，看不到面板上的操作步骤。按下之后才会看到。', wide: true },
          { t: '怎么继续', d: '点下面的「先确认授权」。确认之后，再按这一次的步骤去打印机上操作。', wide: true },
          { t: '类型', d: TYPES[id].label },
          { t: S().fsRescan ? '安全重扫' : '普通扫描', d: S().fsRescan ? '这是一次安全重扫，要等系统确认，现在还没放行。' : '这一次是普通扫描。' },
          { t: '输出格式', d: FORMAT },
          { t: '有效期', d: '这次扫描 10 分钟内有效。授权没确认之前，倒计时还不开始。' }
        ])}</div>`,
        dock: { back: false, left: `<button class="btn sec" data-go="scan-type" data-act="fs" data-arg="restart">${icon('chevL', 30, 2.4)}返回选类型</button>`, ask: '问小青：为什么还不能扫', pri: { label: '先确认授权', act: 'fs', arg: 'ack' } }
      });
    }
    const lines = STEPS[id];
    return shell({
      band: { eyebrow: '扫描指引', title: '扫描指引', sub: '扫描任务已创建，请只按系统给出的这一次操作说明来做。', status: { text: '第 2 步 · 去面板操作' }, rail: { labels: RAIL, now: 1 } },
      body: `<div class="fs-kvs">
          <div class="fs-kv"><span>类型</span><b>${TYPES[id].label}</b></div>
          <div class="fs-kv"><span>这次扫描 10 分钟内有效</span><b data-fs-left>${leftText(S().fsLeft == null ? 600 : S().fsLeft)}</b></div>
          <div class="fs-kv"><span>输出格式</span><b>${FORMAT}</b></div>
          <div class="fs-kv"><span>保存</span><b>${SAVE}</b></div>
        </div>
        ${aiNote()}
        <div class="fs-steps">${lines.map((t, i) => `<div class="fs-step"><span class="n">${i + 1}</span><b>面板步骤 ${i + 1}</b><span>${t}</span></div>`).join('')}</div>
        <div class="fs-scanhero"><div class="vis">${scanPaper(170)}</div><p>按上面四步，在打印机面板上操作。扫完可以取回原件。</p></div>
        ${S().fsRescan ? '<p class="fs-help">这是一次安全重扫，要等系统确认才能继续。</p>' : ''}`,
      dock: { back: false, left: `<button class="btn sec" data-go="scan-type" data-act="fs" data-arg="restart">${icon('chevL', 30, 2.4)}返回（取消任务）</button>`, ask: '问小青：面板上怎么扫', pri: { label: '我已操作，开始等待', go: 'scan-wait', act: 'fs', arg: 'begin-wait' } }
    });
  }

  function scanWait() {
    const w = S().fsWait || 'wait';
    const polls = S().fsPolls || 0;
    const sec = S().fsWaitSec || 0;
    const id = typeId();
    if (w === 'ack' || w === 'acking') {
      return shell({
        band: { eyebrow: '等回传', title: '正在确认能收到扫描件', sub: '确认之前，这一页还不能检查文件', status: { text: w === 'acking' ? '正在确认能收到扫描件' : '还没确认能收到扫描件', warn: 1 }, rail: { labels: RAIL, now: 2 } },
        body: `<div class="fs-grow">${aiNote()}${facts([
          { t: '还不能等文件', d: '确认之前，这一页还不能接收扫描件。', wide: true },
          { t: '主按钮', d: '这一页写「再确认一次」。指引页上你能按的那一下写「先确认授权」。' },
          { t: '类型', d: TYPES[id].label },
          { t: '输出格式', d: FORMAT },
          { t: '保存策略', d: SAVE },
          { t: '查询', d: '授权确认之后才每 3 秒查一次，最长 10 分钟。' }
        ])}</div>
        ${row('wait-reack', w === 'acking' ? '等系统确认' : '再确认一次', '系统没回之前，不说已经确认', { dis: w === 'acking' })}`,
        dock: { back: false, left: backPrint(), ask: '问小青：授权还没好' }
      });
    }
    if (w === 'cancelled') {
      return shell({
        band: { eyebrow: '等回传', title: '这次扫描已取消', sub: '系统已经取消，可以重新选类型', status: { text: '系统已取消这次扫描', warn: 1 }, rail: { labels: RAIL, now: 2 } },
        body: `<div class="fs-grow">${aiNote()}${facts([
          { t: '已取消', d: '这是系统回了取消之后才写的。请求发出去、系统没回之前，不说已经取消。', wide: true },
          { t: '这次不算成功', d: '没有文件，也不进入「我的文档」。' },
          { t: '类型', d: TYPES[id].label },
          { t: '下一步', d: '可以重新选一种材料，再建立一次扫描。' }
        ])}</div>
        ${row('restart', '返回选类型', '重新选一种材料', { go: 'scan-type' })}`,
        dock: { back: false, left: backPrint(), ask: '问小青：取消之后怎么办' }
      });
    }
    const querying = w === 'querying';
    const failed = w === 'queryfail';
    const cancelling = w === 'cancelling';
    const armed = !!S().fsCancel && !cancelling;
    const status = cancelling ? '正在发送取消请求' : failed ? '查状态失败 · 不改判' : querying ? '正在查询系统' : '等待文件回传';
    return shell({
      band: { eyebrow: '等回传', title: '等待打印机端扫描完成', sub: '请在打印机面板完成扫描；本页每 3 秒自动检测结果', status: { text: status, warn: failed || cancelling }, rail: { labels: RAIL, now: 2 } },
      body: `<div class="fs-grow">${aiNote()}<div class="fs-hero"><div class="fs-doc">${UI.scanPaper(220)}</div><span class="fs-p">已等待 · 已查询 <b data-fs-polls>${polls}</b> 次</span><b class="fs-time" data-fs-wait>${waitText(sec)}</b><span class="fs-p">每 3 秒查一次，最长等 10 分钟。</span></div>
        <div class="fs-kvs flat">
          <div class="fs-kv"><span>扫描类型</span><b>${TYPES[id].label}</b></div>
          <div class="fs-kv"><span>输出格式</span><b>${FORMAT}</b></div>
          <div class="fs-kv"><span>保存策略</span><b>${SAVE}</b></div>
          <div class="fs-kv"><span>你在面板上</span><b>请在打印机上完成扫描。这一页不显示扫到第几张。</b></div>
        </div>
        ${failed ? '<p class="fs-warn">这一次没查到状态，不改判。留在这一页，可以再检查一次。</p>' : ''}
        ${cancelling ? '<p class="fs-warn">正在发送取消请求。系统没回之前，不说已经取消。</p>' : ''}
        </div>
        <div class="fs-2">
          ${row('cancel-arm', cancelling ? '正在发送取消请求' : armed ? '再点一次确认取消' : '取消扫描', armed ? '再按一次才会发出取消' : '取消这次还没完成的扫描', { dis: cancelling })}
          ${row('check-now', '立即检查', '只增加一次查询，不自己判成功', { dis: cancelling })}
        </div>`,
      dock: { back: false, left: backPrint(), ask: '问小青：一直等不到怎么办' }
    });
  }

  function resultFileLine(f) {
    return `${esc(f.name)} · ${f.mime} · ${f.size} · ${f.pages}`;
  }
  function scanResult() {
    const kind = S().fsResult || 'ok';
    if (kind === 'timeout' || kind === 'incomplete' || kind === 'nofile') return scanFail(kind);
    const id = typeId();
    const f = fileOf();
    const aiOn = id === 'resume';
    const logged = !!S().logged;
    const aiDesc = aiOn ? '识别扫描件内容，进入简历诊断与优化' : `AI 简历识别只对简历扫描开放；这次扫的是「${TYPES[id].label}」。`;
    const ov = S().fsPreview ? previewOverlay(f) : '';
    return shell({
      band: { eyebrow: '扫描完成', title: '扫描完成', sub: '请核对文件信息，选择下一步操作', status: { text: '系统已返回完成，并带回文件' }, rail: { labels: RAIL, now: 3 } },
      body: `<div class="fs-card fs-grow"><div class="fs-page"><div class="fs-doc">${id === 'document' ? stack(220, 2) : resume(240, 'plain')}</div></div>
        <div class="tx"><b>${esc(f.name)}</b><span class="fs-p">${f.mime} · ${f.size} · ${f.pages}</span><span class="fs-p">${TYPES[id].label} · 文件名、格式、大小、页数从这次结果读</span></div>
        ${aiNote()}
        <p class="fs-p">预览用的是结果里那条临时链接。打不开只证明这一次没打开，不改判。</p>
        ${row('preview', '整屏查看', '翻页和适宽在查看层里')}
        </div>
        ${aiOn ? goRow('reading', 'AI 简历识别', aiDesc) : row('noop', 'AI 简历识别', aiDesc, { dis: true })}
        ${goRow('pii', '拿去打印', '先检查文件和个人信息。金额由系统报价，本页不给价格。')}
        ${logged ? goRow('my-docs', '前往我的文档', '在「我的文档」查看与管理本次扫描件') : row('noop', '本次不进入我的文档', '未登录扫描件不会进入「我的文档」，请在本次操作内完成打印或识别', { dis: true })}
        <p class="fs-p">还没选下一步的临时文件，会按保存规则清理。扫完请取回原件。</p>`,
      overlay: ov,
      dock: { back: false, left: `<button class="btn sec" data-go="scan-type" data-act="fs" data-arg="plain">${icon('refresh', 28, 2)}重新扫描</button>`, ask: '问小青：扫描件接下来呢', pri: { label: '拿去打印', go: 'pii' } }
    });
  }
  function previewOverlay(f) {
    const bad = !!S().fsPreviewBad;
    const page = S().fsPreviewPage || 1;
    const pager = f.pagesN > 1
      ? `${row('pv-prev', '上一页', '', { dis: page <= 1 })}${row('pv-next', '下一页', '第 ' + page + ' 页 / 共 ' + f.pagesN + ' 页', { dis: page >= f.pagesN })}`
      : `<p class="fs-p">${f.pages}</p>`;
    const zoom = S().fsFit ? 1.2 : 1;
    const art = bad ? '<p class="fs-warn">这一次预览没有打开。打不开只证明这一次没打开，不改判扫描已完成。</p>'
      : `<div style="transform:scale(${zoom})">${resume(200, 'plain')}</div>`;
    return overlay('整屏查看', `${art}<p>${resultFileLine(f)}</p>${pager}`, `${row('fit', S().fsFit ? '适宽' : '放大', '')}<button class="btn pri" data-act="fs" data-arg="preview-close">关闭</button>`);
  }
  function scanFail(kind) {
    const title = kind === 'nofile' ? '已完成 · 结果里没有文件' : kind === 'timeout' ? '等待超时' : '扫描未完成';
    const status = kind === 'nofile' ? '已完成 · 结果里没有文件' : kind === 'timeout' ? '等待超时 · 没有文件' : '扫描未完成';
    const reason = kind === 'nofile'
      ? '系统确认这次扫描已经完成，可是同一份结果里没有带可用的文件信息。这份文件还在不在，本机没有依据判断。'
      : kind === 'timeout'
        ? '等待超时，这次没有拿到文件。'
        : '扫描任务未能完成。';
    return shell({
      band: { eyebrow: '扫描结果', title: title, sub: '本次没有生成可用的扫描文件', status: { text: status, warn: 1 }, rail: { labels: RAIL, now: 3 } },
      body: `<div class="fs-grow">${aiNote()}${facts([
          { t: '失败原因原文', d: reason, wide: true },
          { t: '同一张纸', d: '同一张纸原样再扫，系统可能按重复件拒收（两小时内）。这句只出现在失败说明里。', wide: true },
          { t: '重试扫描（同一份材料）', d: '带着凭据申请放行，认不认由系统定。这里不写成已经放行。' },
          { t: '重新开始一次扫描', d: '这是一次普通新会话，不是免查重的重扫。不自动重扫。' }
        ])}${help()}</div>
        ${goRow('home', '返回首页', '结束这次等待')}
        ${row('plain', '重新开始一次扫描', '回选类型，不带安全重扫凭据', { go: 'scan-type' })}`,
      dock: { back: false, left: backPrint(), ask: '问小青：扫描失败怎么办', pri: { label: '重试扫描（同一份材料）', go: 'scan-guide', act: 'fs', arg: 'safe' } }
    });
  }

  function copyPage() {
    const copySteps = [
      ['放原件', '多页普通纸：放进打印机上方的进纸口，字朝上。单页、证件、书本：掀开上盖，字朝下放在玻璃上，对齐左上角，再合上盖。'],
      ['在打印机屏幕上选功能', '普通复印点「复印」；复印身份证点「身份证复印」；复印发票、收据点「票据复印」。'],
      ['需要时改设置', '可以改份数、黑白或彩色、单面或双面、放大缩小。每一项在哪里改，以打印机屏幕显示为准；上一位调过的设置可能还在，开始前看一眼。'],
      ['开始复印', '点打印机屏幕上的「复印」开始。原件放在玻璃上时，扫描过程中不要掀盖。'],
      ['取走复印件和原件', '复印件从出纸口取。原件还在玻璃上或进纸口里，一起带走。']
    ];
    return shell({
      band: { eyebrow: '复印', title: '怎么在打印机上复印', sub: '复印不用在这台屏幕上下单，也不会出现在「我的打印订单」里。照下面五步做就行。', status: { text: '复印在打印机面板上操作' } },
      body: `${aiNote()}<div class="fs-grow"><p class="fs-h">照着做：五步复印</p>${stepsHtml(copySteps)}
        <p class="fs-h">这几种原件这样复印</p>
        <div class="fs-fact"><b>身份证</b><span>在打印机屏幕上点「身份证复印」。身份证怎么放、怎么翻面，请看打印机屏幕上的图示。</span></div>
        <div class="fs-fact"><b>发票、收据</b><span>在打印机屏幕上点「票据复印」，原件字朝下放在玻璃上、合上盖；摆放位置以打印机屏幕提示为准。</span></div>
        <div class="fs-fact"><b>正反两面都有字</b><span>第一面印完，原件会从上方出纸口出来。照原样放回进纸口，不翻面、不掉头，再点开始；等太久没放，就只印单面。</span></div>
        <p class="fs-warn">不得复印伪造的证件、印章、票据。只能复印本人的真实证件和票据。</p>
        <p class="fs-warn">复印件和原件一起带走。原件还在玻璃上或进纸口里，请务必取回。${HELP}</p>
        </div>`,
      dock: { back: false, left: backPrint(), ask: '问小青：复印要注意什么', pri: { label: '去打印文件', go: 'print-src' } }
    });
  }

  function featureInfo() {
    if (S().fsFeat === 'unknown') {
      return shell({
        band: { eyebrow: '打印扫描', title: '这个能力名我不认识', sub: '地址里的能力名对不上现有说明', status: { text: '能力说明不存在', warn: 1 } },
        body: `<div class="fs-grow">${aiNote()}${facts([
          { t: '没有这份说明', d: '这个名字不在复印、证件照这些说明里。本页不编一套步骤。', wide: true },
          { t: '复印', d: '复印的说明在「怎么在打印机上复印」。' },
          { t: '证件照', d: '证件照这一页写的是尚未开放，和两条替代路径。' },
          { t: '下一步', d: '回到打印扫描，从那里选已经有的功能。' }
        ])}${help()}</div>`,
        dock: { back: false, ask: '问小青：这个功能是什么', pri: { label: '返回打印扫描', go: 'print' } }
      });
    }
    return shell({
      band: { eyebrow: '打印扫描 · 证件照', title: '证件照：本机尚未开放', sub: '现在不能裁切、换底色或排版，也不会生成证件照成品', status: { text: '证件照尚未开放', warn: 1 } },
      body: `${aiNote()}
        <div class="fs-idhead"><div class="vis">${idcard(240)}</div><div class="tx"><h2>本机暂未开放证件照</h2><p>已经有电子版可以按照片打印；只有纸质的，先在打印机上扫描。</p></div></div>
        <div class="fs-pair">
          ${actCard({ go: 'print-src', title: '已经有证件照文件', desc: '传到这台机器，按普通照片打印。尺寸和底色以你手上的原图为准。', vis: stack(140, 2) })}
          ${actCard({ go: 'scan-type', title: '只有纸质照片', desc: '在打印机面板上扫描，回到这台机器取电子版。扫描不做裁切和换底色。', vis: scanPaper(150) })}
        </div>
        <div class="fs-plan"><div class="hd"><b>以后会做</b><span class="fs-chip clay">规划，不是承诺</span></div><ol>
          <li>选常见规格与底色（一寸 / 二寸 / 小一寸）。</li>
          <li>按纸张规格自动排版，确认张数后进入打印流程。</li>
          <li>证件照属敏感文件，按短期留存策略清理。</li>
        </ol></div>
        <p class="fine">${SENSITIVE}</p>
        <div class="remind">${icon('call', 34, 2)}<span>${HELP}</span></div>`,
      dock: { back: false, left: backPrint(), ask: '问小青：证件照怎么办', pri: { label: '先用照片打印', go: 'print-src' } }
    });
  }

  function ensureImgs() {
    const p = S().fsPdf || 'empty';
    const seed = p === 'edit' || p === 'result' || p === 'unknown' || p === 'conflict';
    if (seed && (!S().fsImgs || !S().fsImgs.length)) {
      S().fsImgs = POOL.slice(0, 2).map((x) => Object.assign({}, x));
      if (S().fsSel == null) S().fsSel = 0;
    }
    if (!S().fsImgs) S().fsImgs = [];
  }
  function kbLabel(imgs) {
    const kb = imgs.reduce((s, i) => s + (i.kb || 0), 0);
    return kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB';
  }
  function actCard(o) {
    const dis = o.dis ? ' disabled' : '';
    const go = o.go ? ` data-go="${o.go}"` : '';
    const act = o.act ? ` data-act="fs" data-arg="${o.arg}"` : '';
    const chip = o.chip ? `<span class="fs-chip ${o.chipKind || ''}">${o.chip}</span>` : '';
    return `<button class="fs-act${o.dis ? ' off' : ''}" type="button"${dis}${go}${act}><span class="vis">${o.vis}</span><span class="tx">${chip}<h3>${o.title}</h3><p>${o.desc}</p></span><span class="go">${icon('chevR', 28, 2.2)}</span></button>`;
  }
  function img2pdf() {
    const phase = S().fsPdf || 'empty';
    if (phase === 'closed') {
      return shell({
        band: { eyebrow: '照片合成 PDF', title: '图片转 PDF：本机暂未开通', sub: '这项现在不能合成', status: { text: '本机暂未开通', warn: 1 } },
        body: `<div class="fs-grow">${aiNote()}${facts([
          { t: '暂未开通', d: '打不开转换。已经在手机里的文件，可以回到打印扫描用别的方式办。', wide: true },
          { t: '上限仍在', d: '开通之后也是最多 20 张，只收 JPG、PNG。' },
          { t: '大小', d: '单张 10MB，合计 40MB，成品 15MB。' },
          { t: '像素', d: '单张不超过 2500 万像素，合计不超过 2 亿像素。' }
        ])}${help()}</div>`,
        dock: { back: false, ask: '问小青：不能转 PDF 怎么办', pri: { label: '返回打印扫描', go: 'print' } }
      });
    }
    if (phase === 'usb') {
      return shell({
        band: { eyebrow: '照片合成 PDF', title: 'U 盘图片还没接到这里', sub: '这一页现在只接了手机扫码', status: { text: 'U 盘来源未接线', warn: 1 } },
        body: `<div class="fs-grow">${aiNote()}${facts([
          { t: '尚未接到转换列表', d: 'U 盘图片导入尚未接到转换列表。一体机这里不打开本机文件框。', wide: true },
          { t: '改用手机', d: '这台机器没有本机文件框。请回到手机扫码，传 JPG 或 PNG。' },
          { t: '现在能用的', d: '手机扫码上传一张 JPG 或 PNG。传到这台机器之后，才会出现在列表里。' },
          { t: '还没加进来', d: 'U 盘里的图片不会出现在这个列表里。' }
        ])}${help()}</div>
        ${row('pdf-back', '回到手机扫码', '继续用手机加图片')}`,
        dock: { back: false, left: backPrint(), ask: '问小青：U 盘图片怎么加' }
      });
    }
    if (phase === 'uploading') {
      return shell({
        band: { eyebrow: '照片合成 PDF', title: '正在接收这一张', sub: '取消就停下这一张', status: { text: '正在接收图片' } },
        body: `<div class="fs-grow">${aiNote()}${facts([
          { t: S().fsUpName || '正在接收这一张', d: '系统还没把这一张放进列表。取消只停这一张，不假装已经收到。', wide: true },
          { t: '还没进列表', d: '传到这台机器之后，才会出现在列表里。' },
          { t: '格式', d: '只收 JPG、PNG。单张不超过 10MB，不超过 2500 万像素。' },
          { t: '取消', d: '取消只停这一张，已经在列表里的不动。' }
        ])}</div>
        ${row('cancel-up', '取消这一张', '回到加图片')}`,
        dock: { back: false, left: backPrint(), ask: '问小青：上传停住了' }
      });
    }
    ensureImgs();
    const imgs = S().fsImgs || [];
    const err = S().fsErr ? `<p class="fs-warn">${esc(S().fsErr)}</p>` : '';
    if (phase === 'composing' || phase === 'recheck') {
      const re = phase === 'recheck';
      return shell({
        band: { eyebrow: '照片合成 PDF', title: re ? '正在用同一标记查询' : '正在合成', sub: re ? '不另起一次合成' : '合成好了，这一页才会换成结果', status: { text: re ? '正在用同一标记查询' : '正在合成' } },
        body: `<div class="fs-grow">${aiNote()}${err}${facts([
          { t: re ? '同一标记' : '正在合成', d: (re ? '用上一次的标记再查这一次的结果。' : '等系统回这份 PDF。') + '当前 ' + imgs.length + ' 张，合计 ' + kbLabel(imgs) + '。', wide: true },
          { t: '等这一次的结果', d: '合成好了，这一页才会换成结果。' },
          { t: '页数', d: '合成后每张一页，页数等于张数，不写死纸型。' },
          { t: '成品', d: '成品不超过 15MB。超过就停在出错说明，不给一份假 PDF。' }
        ])}</div>`,
        dock: { back: false, left: backPrint(), ask: '问小青：合成要多久', pri: { label: re ? '正在查询这一次的结果' : '合成完成后可继续', disabled: true } }
      });
    }
    if (phase === 'result') {
      const n = imgs.length || 0;
      const logged = !!S().logged;
      return shell({
        band: { eyebrow: '照片合成 PDF', title: 'PDF 已经合成', sub: '页数等于这次的张数', status: { text: '合成完成' } },
        body: `<div class="fs-grow">${aiNote()}${facts([
          { t: '格式转换-' + n + '张图片.pdf', d: n + ' 页。页数从这次列表读，不写死纸型。合计 ' + kbLabel(imgs) + '。', wide: true },
          { t: '文件从哪来', d: imgs.map((i) => esc(i.name) + ' · ' + i.size).join('；') || '这次没有图片', wide: true },
          { t: '拿去打印', d: '先做材料检查。金额由系统报价，这一页不给价格。' },
          { t: logged ? '我的文档' : '先登录', d: logged ? '登录后可以去我的文档看这份 PDF。' : '合成本身不用先登录。这是完成之后的登录入口。' }
        ])}</div>
        ${logged ? goRow('my-docs', '查看我的文档', '登录后可以去我的文档') : goRow('login', '先登录再转换', '这是完成之后的登录入口，合成本身不用先登录')}`,
        dock: { back: false, left: backPrint(), ask: '问小青：合成的 PDF 怎么打印', pri: { label: '拿这份 PDF 去打印', go: 'pii' } }
      });
    }
    if (phase === 'unknown') {
      return shell({
        band: { eyebrow: '照片合成 PDF', title: '这一次的结果没有确认', sub: '用同一个标记再查，不重新合成', status: { text: '结果未知 · 需再查询', warn: 1 } },
        body: `<div class="fs-grow">${aiNote()}${facts([
          { t: '结果未知', d: imgs.length ? ('列表里有 ' + imgs.length + ' 张。系统还没说合成成没成。') : '还没有可以查询的标记。', wide: true },
          { t: '同一标记', d: '用上一次的标记再查，不另起一次合成。' },
          { t: '列表还在', d: imgs.map((i) => esc(i.name)).join('、') || '这次没有图片' },
          { t: '不改判成功', d: '没确认之前，不写成 PDF 已经合成。' }
        ])}${help()}</div>
        ${row('recheck-pdf', '用同一标记再查', '不另起一次合成', { dis: !imgs.length })}`,
        dock: { back: false, left: backPrint(), ask: '问小青：结果还没回来' }
      });
    }
    if (phase === 'conflict') {
      return shell({
        band: { eyebrow: '照片合成 PDF', title: '这个标记和上一次撞了', sub: '可以换一个新标识，或恢复上一次的顺序', status: { text: '标识冲突', warn: 1 } },
        body: `<div class="fs-grow">${aiNote()}${facts([
          { t: '当前顺序', d: imgs.map((i) => esc(i.name)).join('、') || '没有图片', wide: true },
          { t: '上一次的顺序', d: (S().fsOrderPrev || []).map(esc).join('、') || '没有记下上一次', wide: true },
          { t: '换一个新标识', d: '标记 ' + ((S().fsMark || 1) + 1) + '。换过之后按当前顺序继续。' },
          { t: '恢复', d: '按冲突前的顺序放回，不重新上传。' }
        ])}</div>
        <div class="fs-2">${row('new-mark', '换一个新标识', '标记 ' + ((S().fsMark || 1) + 1))}${row('restore', '恢复上一次的顺序', '按冲突前的顺序放回')}</div>`,
        dock: { back: false, left: backPrint(), ask: '问小青：顺序冲突了' }
      });
    }
    if (phase === 'edit' && imgs.length) return pdfEdit(imgs, err);
    return shell({
      band: { eyebrow: '照片合成 PDF', title: '把图片合成一个 PDF', sub: '还没有图片。加上之后才能合成', status: { text: '图片转 PDF · 最多 20 张' } },
      body: `${err}${aiNote()}
        <p class="fs-lead">还没有图片。用手机扫码传上来之后，才能合成。</p>
        <div class="fs-pair">
          ${actCard({ act: 1, arg: 'qr:img', title: '手机扫码传图片', desc: '在手机上选 JPG 或 PNG。传到这台机器之后，才会出现在列表里。', vis: phone(120) })}
          ${actCard({ dis: 1, title: 'U 盘导入', chip: '暂未开通', chipKind: 'clay', desc: '从 U 盘加图片，本机暂未开通。', vis: usb(140) })}
        </div>
        <p class="fine">最多 20 张，单张不超过 10MB，只收 JPG、PNG。</p>`,
      overlay: S().fsQr ? qrBox(S().fsQr) : '',
      dock: { back: false, left: backPrint(), ask: '问小青：照片怎么合成 PDF', pri: { label: '至少加一张图再合成', disabled: true } }
    });
  }
  function pdfEdit(imgs, err) {
    const sel = Math.min(S().fsSel || 0, imgs.length - 1);
    S().fsSel = sel;
    const cur = imgs[sel];
    const more = !!S().fsMore;
    const armed = S().fsRm === sel;
    const list = `<div class="fs-plist">${imgs.map((im, i) => `<div class="${i === sel ? 'on' : ''}"><b>${esc(im.name)}</b><span>${im.size} · 第 ${i + 1} 张 / 共 ${imgs.length} 张</span></div>`).join('')}</div>`;
    const visual = `<div class="fs-card fs-grow" ${more ? 'hidden' : ''}>${aiNote()}${list}<p class="fs-p">单张 10MB，合计 40MB，成品 15MB。单张 2500 万像素，合计 2 亿像素。只收 JPG、PNG。</p><p class="fs-p">旋转 90° 当前不可用：格式转换还不能旋转，这一步也还没接上。</p></div>`;
    const moreBox = `<div class="fs-card fs-grow" ${more ? '' : 'hidden'}><div class="fs-moregrid">
        ${row('up', '上移', '', { dis: sel <= 0 })}
        ${row('down', '下移', '', { dis: sel >= imgs.length - 1 })}
        ${row('rm', armed ? '再点一次确认移除' : '移除', armed ? '再按一次才从列表拿掉' : '从这次列表移除')}
        ${row('view', '查看', '看大图')}
        ${row('noop', '旋转 90°', '当前不可用', { dis: true })}
      </div>
      <p class="fs-p">旋转 90° 当前不可用：格式转换还不能旋转，这一步也还没接上。</p>
    </div>`;
    const view = S().fsView ? overlay('查看这一张', `<p>${esc(cur.name)}</p><p>${cur.size} · 第 ${sel + 1} 张 / 共 ${imgs.length} 张</p>`, '<button class="btn pri" data-act="fs" data-arg="view-close">关闭</button>') : '';
    return shell({
      band: { eyebrow: '照片合成 PDF', title: '排好顺序再合成', sub: '已有 ' + imgs.length + ' 张 · 合计 ' + kbLabel(imgs) + ' · 最多 20 张', status: { text: '图片转 PDF · 最多 20 张' } },
      body: `${err}<div class="fs-slot">${visual}${moreBox}</div>
        <div class="fs-2">
          ${row('img-prev', '上一张', '', { dis: sel <= 0 })}
          ${row('img-next', '下一张', '', { dis: sel >= imgs.length - 1 })}
        </div>
        <div class="fs-2">${row('qr:img', '手机扫码上传一张', '')}${row('usb-src', '从 U 盘加图片', '尚未接到列表')}</div>
        ${row('more', more ? '收起更多设置' : '更多设置', '上移、下移、移除、查看、旋转')}`,
      overlay: (S().fsQr ? qrBox(S().fsQr) : '') + view,
      dock: { back: false, left: backPrint(), ask: '问小青：照片怎么合成 PDF', pri: { label: '合成', act: 'fs', arg: 'compose' } }
    });
  }

  function signClosed() {
    const hold = (t, d) => `<div class="fs-hold" role="group" aria-disabled="true" aria-label="${t}，本机暂未开通"><b>${t}</b><span>${d}</span><span class="fs-chip clay">本机暂未开通</span></div>`;
    return shell({
      band: { eyebrow: '签名', title: '签名：本机暂未开通', sub: '选 PDF、传签名图和放置，现在都还不能用', status: { text: '本机暂未开通', warn: 1 } },
      body: `${aiNote()}
        <div class="sec-t">签名的三步<small>现在都不能用</small></div>
        <div class="fs-lock">
          ${hold('选 PDF', '选一份要签名的 PDF')}
          ${hold('传签名图', '上传本人手写签名')}
          ${hold('放置', '把签名放到某一页')}
        </div>
        <div class="sec-t">这些还能办</div>
        <div class="fs-pair">
          ${actCard({ go: 'print', title: '打印扫描', desc: '上传文件、扫描纸质材料、看复印步骤，都不靠签名。', vis: scanPaper(150) })}
          ${actCard({ go: 'policy', title: '查政策', desc: '看本机构发布的政策和要带的材料。', vis: checklist(130) })}
        </div>
        <div class="remind">${icon('call', 34, 2)}<span>${HELP}</span></div>`,
      dock: { back: false, ask: '问小青：签名没开怎么办', pri: { label: '返回打印扫描', go: 'print' } }
    });
  }
  function signSimple(title, sub, status, body, pri, ask) {
    return shell({
      band: { eyebrow: '签名', title, sub, status: { text: status, warn: 1 } },
      body: `<div class="fs-grow">${aiNote()}${body}${help()}</div>`,
      dock: { back: false, left: backPrint(), ask: ask, pri: pri }
    });
  }
  function ensureSign(step) {
    const needDoc = ['stamp', 'place', 'composing', 'result', 'unknown', 'recheck'].indexOf(step) >= 0;
    const needStamp = ['place', 'composing', 'result', 'unknown', 'recheck'].indexOf(step) >= 0;
    if (needDoc && !S().fsPdfName) {
      S().fsPdfName = '毕业生就业推荐表（已填写）.pdf';
      if (!S().fsPages) S().fsPages = 2;
    }
    if (needStamp && !S().fsStampName) S().fsStampName = '手写签名.png';
  }
  function pips(cur) {
    const items = [['pdf', '选 PDF'], ['stamp', '传签名图'], ['place', '放置']];
    return `<div class="fs-pips">${items.map((it) => `<span class="${cur === it[0] || (cur === 'composing' && it[0] === 'place') ? 'on' : ''}">${it[1]}</span>`).join('')}</div>`;
  }
  function stampStyle() {
    const size = S().fsSize || 'medium';
    const w = size === 'small' ? 15 : size === 'large' ? 35 : 25;
    const pos = S().fsPos || 'bottom-right';
    const box = {
      'top-left': `top:8%;left:8%;width:${w}%`,
      'top-center': `top:8%;left:${(100 - w) / 2}%;width:${w}%`,
      'top-right': `top:8%;right:8%;width:${w}%`,
      'middle-left': `top:42%;left:8%;width:${w}%`,
      'center': `top:42%;left:${(100 - w) / 2}%;width:${w}%`,
      'middle-right': `top:42%;right:8%;width:${w}%`,
      'bottom-left': `bottom:8%;left:8%;width:${w}%`,
      'bottom-center': `bottom:8%;left:${(100 - w) / 2}%;width:${w}%`,
      'bottom-right': `bottom:8%;right:8%;width:${w}%`
    };
    return box[pos] || box['bottom-right'];
  }
  function signFlow() {
    const step = S().fsSign || 'pdf';
    if (step === 'loading') {
      return signSimple('正在读取签名是否开通', '确认前不放文件', '正在读取签名开关', facts([{ t: '正在确认', d: '开关还没读完，不能选 PDF，也不能放置。', wide: true }, { t: '不会创建文件', d: '确认前不展示 PDF，也不展示签名图。' }, { t: '主按钮', d: '停在「正在确认」，同时可以返回打印扫描。' }, { t: '读完之后', d: '没开通就整页说明；开通了要先登录。' }]), { label: '正在确认', disabled: true }, '问小青：签名开关还在读');
    }
    if (step === 'maint') {
      return signSimple('签名暂停维护', '这一会儿做不了', '签名暂停维护', facts([{ t: '暂停', d: '维护时不放文件。维护结束再来。', wide: true }, { t: '不放文件', d: '不展示 PDF，也不展示签名图。' }, { t: '现在可以', d: '回到打印扫描，用上传、扫描或复印办别的事。' }, { t: '结束之后', d: '维护结束再打开签名。这一页不自己变成已开通。' }]), { label: '返回打印扫描', go: 'print' }, '问小青：签名在维护');
    }
    if (step === 'term') {
      return signSimple('这台终端还没有登记', '没登记就不能签名', '终端未登记', facts([{ t: '未登记', d: '这台机器还没登记终端，签不了名。', wide: true }, { t: '不放文件', d: '不展示 PDF，也不展示签名图。' }, { t: '现在可以', d: '回到打印扫描。打印和扫描不靠这个登记。' }, { t: '登记之后', d: '登记完成再打开签名。这一页不编一套临时步骤。' }]), { label: '返回打印扫描', go: 'print' }, '问小青：终端没登记');
    }
    if (step === 'expired') {
      return signSimple('登录已经过期', '请重新登录后再签名。不展示文件', '登录已过期', facts([{ t: '请重新登录', d: '过期之后不展示 PDF，也不展示签名图。', wide: true }, { t: '文件还在不在', d: '这一页不判断原来的 PDF 还在不在。' }, { t: '打印和扫描', d: '打印和扫描不用先登录，可以从打印扫描继续。' }, { t: '登录之后', d: '重新登录再回到签名，重新选 PDF。' }]), { label: '去登录', go: 'login' }, '问小青：登录过期了');
    }
    if (!S().logged) {
      return signSimple('先登录才能签名', '没登录不展示文件，也不能放置', '先登录才能签名', facts([{ t: '去登录', d: '登录只打开签名。打印和扫描不用先登录。', wide: true }, { t: '不展示文件', d: '没登录不放 PDF，也不放签名图。' }, { t: '登录之后', d: '先选一份 PDF，再传本人手写签名，放到某一页。' }, { t: '原文件', d: '原 PDF 全程不改写。合成的是新文件。' }]), { label: '去登录', go: 'login' }, '问小青：签名为什么要登录');
    }
    ensureSign(step);
    if (step === 'stamp') return signStamp();
    if (step === 'place' || step === 'composing') return signPlace(step);
    if (step === 'result') return signResult();
    if (step === 'unknown' || step === 'recheck') return signUnknown(step);
    return signPdf();
  }
  function signPdf() {
    return shell({
      band: { eyebrow: '签名', title: '选一份要签名的 PDF', sub: '还没有选中的 PDF。不放示例文件', status: { text: '请先选择 PDF' } },
      body: `${pips('pdf')}${aiNote()}
        ${row('qr:pdf', '手机扫码上传 PDF', '不超过 15MB，1 到 30 页')}
        ${goRow('my-docs', '从我的文档选', '选中一份再带回签名页。这一跳要加在我的文档的文件卡上')}
        ${row('noop', '从 U 盘选 PDF', 'U 盘导入能用来打印，但还没通到签名这一步', { dis: true })}
        <div class="fs-grow">${facts([
          { t: '会检查什么', d: '是不是真的 PDF、有没有加密损坏或数字签名域、页数是不是 1 到 30。原文件全程不改写。', wide: true },
          { t: '原 PDF：永不改写。', d: '合成的是新文件。一体机不打开本机文件框，所以没有「本机上传」。', wide: true },
          { t: '大小和页数', d: '不超过 15MB，1 到 30 页。' },
          { t: '还没选中', d: '不放示例文件。系统收下之后才进入传签名图。' }
        ])}</div>`,
      overlay: S().fsQr ? qrBox(S().fsQr) : '',
      dock: { back: false, left: backPrint(), ask: '问小青：签名用哪份 PDF', pri: { label: '先选一份 PDF', disabled: true } }
    });
  }
  function signStamp() {
    return shell({
      band: { eyebrow: '签名', title: '上传本人手写签名', sub: esc(S().fsPdfName) + ' · ' + (S().fsPages || 1) + ' 页', status: { text: '请上传签名图' } },
      body: `${pips('stamp')}${aiNote()}
        <p class="fs-p">只接受本人手写签名，不接受单位公章或圆形章；这不是可靠电子签名。</p>
        ${row('qr:stamp', '手机扫码上传图片', 'JPG 或 PNG，不超过 10MB，不超过 2500 万像素')}
        ${row('noop', '从 U 盘选图片', '还没通到签名这一步', { dis: true })}
        <div class="fs-grow">${facts([
          { t: '签名图留多久', d: '大约 1 小时后清除，不进「我的文档」。', wide: true },
          { t: '这份 PDF', d: esc(S().fsPdfName) + '。原 PDF：永不改写。文件名来自这次上传。', wide: true },
          { t: '图片限制', d: 'JPG 或 PNG，不超过 10MB，不超过 2500 万像素。' },
          { t: '不收公章', d: '只接受本人手写签名，不接受单位公章或圆形章。' }
        ])}</div>`,
      overlay: S().fsQr ? qrBox(S().fsQr) : '',
      dock: { back: false, left: backPrint(), ask: '问小青：签名图是什么', pri: { label: '先传签名图', disabled: true } }
    });
  }
  function signPlace(step) {
    const pages = S().fsPages || 2;
    const page = Math.min(pages, Math.max(1, S().fsPage || 1));
    S().fsPage = page;
    const pos = S().fsPos || 'bottom-right';
    const size = S().fsSize || 'medium';
    const sizeLabel = size === 'small' ? '小 15%' : size === 'large' ? '大 35%' : '中 25%';
    const more = !!S().fsMore;
    const busy = step === 'composing';
    const zoom = S().fsZoom || 1;
    const grid = `<div class="fs-nine nine" ${more ? '' : 'hidden'}>${POS.map((p) => `<button type="button" class="${p[0] === pos ? 'on' : ''}" data-act="fs" data-arg="pos:${p[0]}" aria-label="${p[1]}" aria-pressed="${p[0] === pos ? 'true' : 'false'}">${p[1]}</button>`).join('')}</div>
      <div class="fs-2" ${more ? '' : 'hidden'}>
        ${row('size:small', '小 15%', '', { pressed: size === 'small' })}
        ${row('size:medium', '中 25%', '', { pressed: size === 'medium' })}
        ${row('size:large', '大 35%', '', { pressed: size === 'large' })}
        ${row('zoom-fit', '适宽', '', { pressed: zoom === 1 })}
        ${row('zoom-in', '放大', '', { pressed: zoom !== 1 })}
      </div>`;
    return shell({
      band: { eyebrow: '签名', title: '放在这一页的哪里？', sub: esc(S().fsPdfName), status: { text: busy ? '正在提交' : '放置签名' } },
      body: `${pips('place')}<p class="fs-p">第 ${page} 页 / 共 ${pages} 页 · ${POS_L[pos] || '右下'} · ${sizeLabel}</p>
        <div class="fs-slot">
          <div class="fs-page" ${more ? 'hidden' : ''}><div class="fs-sheet" style="transform:scale(${zoom})"><span class="fs-stamp" style="${stampStyle()}">手写签名</span></div></div>
          ${grid}
          <p class="fs-p">${ESIGN}</p>
        </div>
        <div class="fs-2">
          ${row('pg-prev', '上一页', '', { dis: page <= 1 })}
          ${row('pg-next', '下一页', '', { dis: page >= pages })}
        </div>
        ${row('more', more ? '收起更多设置' : '更多设置', '九宫格、大小、适宽和放大')}
        ${aiNote()}
        ${row('auth', AUTH, '', { pressed: !!S().fsAuth })}
        <p class="fs-p">原 PDF：永不改写。签名图大约 1 小时后清除，不进「我的文档」。</p>`,
      dock: { back: false, left: backPrint(), ask: '问小青：签名放在哪一页', pri: { label: busy ? '正在提交' : '生成合成 PDF', act: 'fs', arg: 'generate', disabled: busy || !S().fsAuth } }
    });
  }
  function signResult() {
    return shell({
      band: { eyebrow: '签名', title: '新的 PDF 已生成', sub: '原 PDF 一个字节没改', status: { text: '新的 PDF 已生成' } },
      body: `<div class="fs-grow">${aiNote()}${facts([
        { t: '合成结果.pdf', d: '页数与原 PDF 相同。原 PDF 未被改写。原 PDF：永不改写。', wide: true },
        { t: '来源', d: esc(S().fsPdfName || '这次上传的 PDF') + ' · ' + esc(S().fsStampName || '手写签名.png') + '。文件名来自这次上传。', wide: true },
        { t: '去材料检查', d: '拿去打印之前先检查文件和个人信息。这一页不给价格。' },
        { t: '再加一处', d: '可以换成刚合成的 PDF，清空签名图，再放一处本人手写签名。' }
      ])}
      <p class="fs-p">${ESIGN}</p></div>
      ${row('again', '再加一处本人手写签名', '换成刚合成的 PDF，并清空签名图')}`,
      dock: { back: false, left: backPrint(), ask: '问小青：合成完怎么打印', pri: { label: '去材料检查', go: 'pii' } }
    });
  }
  function signUnknown(step) {
    const re = step === 'recheck';
    return shell({
      band: { eyebrow: '签名', title: re ? '正在用同一个标记查询' : '这一次的结果没有确认', sub: '不另起一次合成', status: { text: re ? '正在用同一标记查询' : '结果没有确认', warn: !re } },
      body: `<div class="fs-grow">${aiNote()}${facts([
        { t: re ? '查询中' : '结果未知', d: '系统还没确认新 PDF 有没有生成。用同一个标记再查。', wide: true },
        { t: '不另起一次', d: '用同一个标记再查，不重新生成。' },
        { t: '原 PDF', d: '原 PDF：永不改写。没确认之前不写成新文件已经生成。' },
        { t: '来源', d: esc(S().fsPdfName || '这次上传的 PDF') + ' · ' + esc(S().fsStampName || '手写签名.png') + '。' }
      ])}${help()}</div>
      ${re ? '' : row('sign-recheck', '用同一个标记再查', '不重新生成')}`,
      dock: { back: false, left: backPrint(), ask: '问小青：签名结果没回来', pri: re ? { label: '正在查询', disabled: true } : undefined }
    });
  }

  function resetScan() {
    S().fsUsb = false;
    S().fsRescan = false;
    S().fsGuide = '';
    S().fsCancel = 0;
    S().fsPolls = 0;
    S().fsWaitSec = 0;
    S().fsLeft = 600;
    S().fsPreview = false;
    delete S().fsResult;
    delete S().fsWait;
  }
  function handle(id, arg) {
    if (arg === 'noop') return 'refresh';
    if (arg.indexOf('type:') === 0) { S().fsType = arg.slice(5); S().fsPick = (S().fsPick || 0) + 1; return 'refresh'; }
    if (arg === 'usb') { S().fsUsb = true; return 'refresh'; }
    if (arg === 'usb-back') {
      if (id === 'img2pdf') { S().fsPdf = (S().fsImgs && S().fsImgs.length) ? 'edit' : 'empty'; return 'refresh'; }
      S().fsUsb = false; return 'refresh';
    }
    if (arg === 'recheck') { S().fsGate = 'checking'; return 'refresh'; }
    if (arg === 'next') { S().fsGuide = 'ack'; S().fsRescan = false; S().fsLeft = 600; S().fsPreview = false; delete S().fsResult; delete S().fsWait; return 'go'; }
    if (arg === 'restart' || arg === 'plain') { resetScan(); return 'go'; }
    if (arg === 'ack') { S().fsGuide = 'steps'; S().fsLeft = 600; return 'refresh'; }
    if (arg === 'rebuild') { S().fsGuide = 'creating'; return 'refresh'; }
    if (arg === 'begin-wait') { S().fsWait = 'wait'; S().fsPolls = 0; S().fsWaitSec = 0; S().fsCancel = 0; return 'go'; }
    if (arg === 'safe') { S().fsRescan = true; S().fsGuide = 'ack'; return 'go'; }
    if (arg === 'cancel-arm') {
      if (S().fsWait === 'cancelling') return 'refresh';
      if (S().fsCancel) { S().fsCancel = 0; S().fsWait = 'cancelling'; } else S().fsCancel = 1;
      return 'refresh';
    }
    if (arg === 'check-now') {
      S().fsPolls = (S().fsPolls || 0) + 1;
      S().fsWaitSec = (S().fsWaitSec || 0) + 3;
      S().fsWait = S().fsWait === 'queryfail' ? 'wait' : 'querying';
      return 'refresh';
    }
    if (arg === 'wait-reack') { S().fsWait = 'acking'; return 'refresh'; }
    if (arg === 'preview') { S().fsPreview = true; S().fsPreviewPage = 1; S().fsPreviewBad = false; return 'refresh'; }
    if (arg === 'preview-close') { S().fsPreview = false; return 'refresh'; }
    if (arg === 'pv-next') { const n = fileOf().pagesN || 1; S().fsPreviewPage = Math.min(n, (S().fsPreviewPage || 1) + 1); return 'refresh'; }
    if (arg === 'pv-prev') { S().fsPreviewPage = Math.max(1, (S().fsPreviewPage || 1) - 1); return 'refresh'; }
    if (arg === 'fit') { S().fsFit = !S().fsFit; return 'refresh'; }
    if (arg === 'qr-close' || arg === 'view-close') { S().fsQr = ''; S().fsView = false; return 'refresh'; }
    if (arg.indexOf('qr:') === 0) { S().fsQr = arg.slice(3); return 'refresh'; }
    if (arg === 'usb-src') { S().fsPdf = 'usb'; S().fsQr = ''; return 'refresh'; }
    if (arg === 'pdf-back') { S().fsPdf = (S().fsImgs && S().fsImgs.length) ? 'edit' : 'empty'; return 'refresh'; }
    if (arg === 'cancel-up') { S().fsPdf = (S().fsImgs && S().fsImgs.length) ? 'edit' : 'empty'; return 'refresh'; }
    if (arg === 'more') { S().fsMore = !S().fsMore; return 'refresh'; }
    if (arg === 'img-prev') { S().fsSel = Math.max(0, (S().fsSel || 0) - 1); S().fsRm = -1; return 'refresh'; }
    if (arg === 'img-next') { S().fsSel = Math.min((S().fsImgs || []).length - 1, (S().fsSel || 0) + 1); S().fsRm = -1; return 'refresh'; }
    if (arg === 'up' || arg === 'down') {
      const imgs = S().fsImgs || []; const i = S().fsSel || 0; const j = arg === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= imgs.length) return 'refresh';
      const t = imgs[i]; imgs[i] = imgs[j]; imgs[j] = t; S().fsSel = j; S().fsRm = -1; return 'refresh';
    }
    if (arg === 'rm') {
      const imgs = S().fsImgs || []; const i = S().fsSel || 0;
      if (S().fsRm === i) { imgs.splice(i, 1); S().fsRm = -1; S().fsSel = Math.max(0, Math.min(i, imgs.length - 1)); if (!imgs.length) S().fsPdf = 'empty'; }
      else S().fsRm = i;
      return 'refresh';
    }
    if (arg === 'view') { S().fsView = true; return 'refresh'; }
    if (arg === 'compose') { if ((S().fsImgs || []).length) { S().fsPdf = 'composing'; S().fsMore = false; } return 'refresh'; }
    if (arg === 'recheck-pdf') { S().fsPdf = 'recheck'; return 'refresh'; }
    if (arg === 'new-mark') { S().fsMark = (S().fsMark || 1) + 1; S().fsPdf = 'edit'; return 'refresh'; }
    if (arg === 'restore') {
      const prev = S().fsOrderPrev || []; const map = {}; (S().fsImgs || []).forEach((i) => { map[i.name] = i; });
      const next = prev.map((n) => map[n]).filter(Boolean);
      if (next.length) S().fsImgs = next;
      S().fsPdf = 'edit'; S().fsSel = 0; return 'refresh';
    }
    if (arg.indexOf('pos:') === 0) { S().fsPos = arg.slice(4); return 'refresh'; }
    if (arg.indexOf('size:') === 0) { S().fsSize = arg.slice(5); return 'refresh'; }
    if (arg === 'zoom-in') { S().fsZoom = 1.35; return 'refresh'; }
    if (arg === 'zoom-fit') { S().fsZoom = 1; return 'refresh'; }
    if (arg === 'pg-prev') { S().fsPage = Math.max(1, (S().fsPage || 1) - 1); return 'refresh'; }
    if (arg === 'pg-next') { S().fsPage = Math.min(S().fsPages || 2, (S().fsPage || 1) + 1); return 'refresh'; }
    if (arg === 'auth') { S().fsAuth = !S().fsAuth; return 'refresh'; }
    if (arg === 'generate') { if (S().fsAuth && S().fsSign !== 'composing') { S().fsSign = 'composing'; S().fsMore = false; } return 'refresh'; }
    if (arg === 'again') { S().fsPdfName = '合成结果.pdf'; S().fsStampName = ''; S().fsSign = 'stamp'; S().fsAuth = false; S().fsMore = false; return 'refresh'; }
    if (arg === 'sign-recheck') { S().fsSign = 'recheck'; return 'refresh'; }
    return 'refresh';
  }
  function onDemo(id, ev) {
    if (id === 'scan-type') {
      if (ev === 'ready') S().fsGate = 'ready';
      else if (ev === 'closed') S().fsGate = 'closed';
      else if (ev === 'unknown') S().fsGate = 'unknown';
      else return 'ignore';
      S().fsUsb = false; return 'refresh';
    }
    if (id === 'scan-guide') {
      if (ev === 'created') S().fsGuide = 'ack';
      else if (ev === 'acked') { S().fsGuide = 'steps'; S().fsLeft = 600; }
      else if (ev === 'fail') S().fsGuide = 'fail';
      else return 'ignore';
      return 'refresh';
    }
    if (id === 'scan-wait') {
      if (ev === 'done') { S().fsResult = 'ok'; window.go('scan-result'); return 'go'; }
      if (ev === 'timeout') { S().fsResult = 'timeout'; window.go('scan-result'); return 'go'; }
      if (ev === 'queryfail') S().fsWait = 'queryfail';
      else if (ev === 'cancelled') { S().fsWait = 'cancelled'; S().fsCancel = 0; }
      else if (ev === 'acked') { S().fsWait = 'wait'; S().fsCancel = 0; }
      else return 'ignore';
      return 'refresh';
    }
    if (id === 'scan-result') {
      if (ev === 'previewfail') { S().fsPreview = true; S().fsPreviewBad = true; return 'refresh'; }
      return 'ignore';
    }
    if (id === 'img2pdf') {
      if (ev === 'added') {
        const have = new Set((S().fsImgs || []).map((i) => i.name));
        const next = POOL.find((i) => !have.has(i.name)) || POOL[0];
        S().fsImgs = (S().fsImgs || []).concat([Object.assign({}, next)]);
        S().fsPdf = 'edit'; S().fsSel = S().fsImgs.length - 1; S().fsErr = ''; S().fsQr = '';
        return 'refresh';
      }
      if (ev === 'toobig') { S().fsErr = '这一张超过 10MB，没有加进列表。'; return 'refresh'; }
      if (ev === 'bad') { S().fsErr = '只收 JPG 或 PNG，这一张没有加进列表。'; return 'refresh'; }
      if (ev === 'unknown') { S().fsPdf = 'unknown'; return 'refresh'; }
      if (ev === 'conflict') {
        if (!S().fsImgs || !S().fsImgs.length) S().fsImgs = POOL.slice(0, 2).map((x) => Object.assign({}, x));
        S().fsOrderPrev = S().fsImgs.map((i) => i.name);
        S().fsImgs = S().fsImgs.slice().reverse();
        S().fsPdf = 'conflict'; S().fsSel = 0; return 'refresh';
      }
      if (ev === 'done') {
        if (!(S().fsImgs || []).length) return 'ignore';
        S().fsPdf = 'result'; return 'refresh';
      }
      return 'ignore';
    }
    if (id === 'sign') {
      if (!S().controlsOn) return 'ignore';
      if (ev === 'pdf') {
        if (!S().logged) return 'ignore';
        S().fsPdfName = '毕业生就业推荐表（已填写）.pdf'; S().fsPages = 2; S().fsStampName = ''; S().fsSign = 'stamp'; S().fsQr = '';
        return 'refresh';
      }
      if (ev === 'stamp') {
        if (!S().logged) return 'ignore';
        if (!S().fsPdfName) { S().fsPdfName = '毕业生就业推荐表（已填写）.pdf'; S().fsPages = 2; }
        S().fsStampName = '手写签名.png'; S().fsSign = 'place'; S().fsPage = S().fsPage || 1; S().fsQr = '';
        return 'refresh';
      }
      if (ev === 'unknown') {
        if (!S().logged || !S().fsPdfName) return 'ignore';
        S().fsSign = 'unknown'; return 'refresh';
      }
      if (ev === 'done') {
        if (S().fsSign !== 'composing' && S().fsSign !== 'recheck' && S().fsSign !== 'unknown') return 'ignore';
        S().fsSign = 'result'; return 'refresh';
      }
      return 'ignore';
    }
    return 'ignore';
  }
  function tickLeft(el) {
    const node = el.querySelector('[data-fs-left]');
    if (!node) return function () {};
    if (S().fsLeft == null) S().fsLeft = 600;
    const paint = () => { const n = el.querySelector('[data-fs-left]'); if (n) n.textContent = leftText(S().fsLeft); };
    paint();
    const t = setInterval(() => {
      if (S().fsLeft == null) return;
      if (S().fsLeft <= 0) { S().fsGuide = 'expired'; refresh(); return; }
      S().fsLeft -= 1;
      if (S().fsLeft <= 0) { S().fsGuide = 'expired'; refresh(); return; }
      paint();
    }, 1000);
    return () => clearInterval(t);
  }
  function tickWait(el) {
    if (!el.querySelector('[data-fs-wait]')) return function () {};
    const t = setInterval(() => {
      const w = S().fsWait || 'wait';
      if (w !== 'wait' && w !== 'querying') return;
      const sec = (S().fsWaitSec || 0) + 3;
      S().fsWaitSec = sec > 600 ? 600 : sec;
      S().fsPolls = (S().fsPolls || 0) + 1;
      const a = el.querySelector('[data-fs-wait]');
      const b = el.querySelector('[data-fs-polls]');
      if (a) a.textContent = waitText(S().fsWaitSec);
      if (b) b.textContent = String(S().fsPolls);
    }, 3000);
    return () => clearInterval(t);
  }
  function watchLeave(el) {
    const fn = (e) => {
      const b = e.target.closest('[data-act="back"], [data-go="home"], [data-go="xq"], [data-go="me"], [data-go="print"]');
      if (!b || !el.contains(b)) return;
      S().fsCancelLeave = 1;
    };
    el.addEventListener('click', fn, true);
    return () => el.removeEventListener('click', fn, true);
  }
  function mount(el) {
    const id = el.dataset.id;
    const click = (e) => {
      const b = e.target.closest('[data-act="fs"]');
      if (!b || !el.contains(b) || b.disabled) return;
      const mode = handle(id, b.dataset.arg || '');
      if (mode === 'go') return;
      e.preventDefault();
      e.stopPropagation();
      refresh();
    };
    const demo = (e) => {
      const mode = onDemo(id, e.detail);
      if (mode === 'refresh') refresh();
    };
    el.addEventListener('click', click);
    el.addEventListener('proto-demo', demo);
    const stops = [];
    if (id === 'scan-guide') stops.push(tickLeft(el));
    if (id === 'scan-wait') stops.push(tickWait(el));
    if (id && id.indexOf('scan-') === 0) stops.push(watchLeave(el));
    return () => {
      el.removeEventListener('click', click);
      el.removeEventListener('proto-demo', demo);
      stops.forEach((fn) => fn());
    };
  }
  const demoScanType = () => [
    { label: '演示：能力已放行', ev: 'ready' },
    { label: '演示：暂未开放', ev: 'closed' },
    { label: '演示：能力读不到', ev: 'unknown' }
  ];
  const demoGuide = () => [
    { label: '演示：任务已创建', ev: 'created' },
    { label: '演示：授权已确认', ev: 'acked' },
    { label: '演示：创建失败', ev: 'fail' }
  ];
  const demoWait = () => [
    { label: '演示：扫描件回来了', ev: 'done' },
    { label: '演示：等待超时', ev: 'timeout' },
    { label: '演示：查状态失败', ev: 'queryfail' },
    { label: '演示：系统已取消', ev: 'cancelled' },
    { label: '演示：授权已确认', ev: 'acked' }
  ];
  const demoResult = () => [{ label: '演示：预览没打开', ev: 'previewfail' }];
  const demoPdf = () => [
    { label: '演示：手机传来一张', ev: 'added' },
    { label: '演示：合成好了', ev: 'done' },
    { label: '演示：结果未知', ev: 'unknown' },
    { label: '演示：标识冲突', ev: 'conflict' },
    { label: '演示：这一张太大', ev: 'toobig' },
    { label: '演示：格式不对', ev: 'bad' }
  ];
  const demoSign = () => [
    { label: '演示：PDF 到了', ev: 'pdf' },
    { label: '演示：签名图到了', ev: 'stamp' },
    { label: '演示：合成好了', ev: 'done' },
    { label: '演示：结果未知', ev: 'unknown' }
  ];

  window.FS = {
    scanType, scanGuide, scanWait, scanResult, copy: copyPage, feature: featureInfo, img2pdf, sign: function () { return S().controlsOn ? signFlow() : signClosed(); },
    mount,
    scanTypeDemo: demoScanType, scanGuideDemo: demoGuide, scanWaitDemo: demoWait, scanResultDemo: demoResult, img2pdfDemo: demoPdf, signDemo: demoSign
  };
})();
