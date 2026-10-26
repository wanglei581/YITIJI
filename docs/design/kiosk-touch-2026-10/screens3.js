/* 状态样式板：七个真实页面的真实状态。以后同类状态照这七屏做。
   字面对运行页（打印服务台、打印台、简历服务台、完成页、诊断失败屏）。 */
(function () {
  const { icon, band, dock, nav: navUi, slab, tile } = UI;
  const nav = (active) => navUi(active).replace('问小青', 'AI 顾问');
  const S = () => window.S;
  const F = (o) => (o.band ? band(o.band) : '') + (o.pre || '') + `<main class="body ${o.cls || ''}">${o.body}</main>` + (o.dock === false ? '' : (o.dockHtml || dock(o.dock || {}))) + (o.nav === false ? '' : nav(o.nav));
  const fine = (t) => `<p class="fine">${t}</p>`;
  const sec = (t, s) => `<div class="sec-t">${t}${s ? `<small>${s}</small>` : ''}</div>`;
  const add = (id, group, name, def) => window.SCREENS.push(Object.assign({ id, group, name }, def));
  const PHONE = '183-6916-1921';
  const helpLine = () => `需要帮助？拨打服务电话 ${PHONE}`;
  const machineLine = () => `这台机器暂时打不了，我们已经收到提醒，会尽快处理。你可以稍后再来；需要帮助请拨打服务电话 ${PHONE}。`;
  const phoneNote = '号码与服务时间从后台读，读不到不显示';

  const css = document.createElement('style');
  css.textContent = `
.st3-hold{background:var(--well);border-style:dashed;cursor:default}
.st3-hold:active{transform:none}
.st3-hold h3,.st3-hold b{color:var(--ink)}
.st3-hold p,.st3-hold small{color:var(--ink-2)}
.st3-go{cursor:pointer}
.st3-go:active{transform:scale(.982)}
.st3-askoff{background:var(--well);color:var(--ink-2);cursor:default}
.st3-askoff .mic{background:var(--ink-3)}
.st3-askoff:active{transform:none}
.screen:has(.st3-load) .status{background:rgba(255,255,255,.08)}
.screen:has(.st3-load) .status .dot{background:var(--mint);box-shadow:0 0 0 4px rgba(191,233,216,.28)}
.st3-slim.slab.row{min-height:0;padding:18px 28px}
.st3-slim.slab.row .vis{min-height:112px}
.st3-check{display:flex;gap:16px;align-items:flex-start;min-height:48px;padding:2px 4px;font-size:24px;line-height:1.45;color:var(--ink)}
.st3-check i{flex:none;width:44px;height:44px;border-radius:50%;background:var(--deep);color:var(--cream);display:grid;place-items:center;font-style:normal;font-weight:700;font-size:22px}
.st3-reason{margin:0;font-size:24px;line-height:1.5;color:var(--ink-2)}
.st3-load .st3-hold.task{padding:14px 18px 12px;gap:4px}
.st3-load .st3-hold.task .ic{width:56px;height:56px;border-radius:18px}
.st3-load .st3-hold.task h3{font-size:32px;line-height:1.15;margin:0}
.st3-load .st3-hold.task p{max-width:none}
.st3-arrival{display:flex;align-items:center;gap:18px;min-height:156px;padding:16px 22px;border-radius:32px;background:var(--card);border:1.5px solid var(--edge);text-align:left;width:100%;transition:transform var(--t-press)}
.st3-arrival:active{transform:scale(.985)}
.st3-arrival>.ic{width:72px;height:72px;border-radius:22px;background:var(--teal-wash);color:var(--teal-ink);display:grid;place-items:center;flex:none}
.st3-arrival .tx{min-width:0;flex:1;display:flex;flex-direction:column;gap:6px}
.st3-arrival .k{display:flex;align-items:center;gap:12px;min-width:0}
.st3-arrival h3{margin:0;font:700 34px/1.2 var(--serif)}
.st3-arrival p{margin:0;font-size:22px;line-height:1.4;color:var(--ink-2)}
.st3-arrival .go{width:64px;height:64px;border-radius:50%;background:var(--deep);color:var(--cream);display:grid;place-items:center;flex:none}
.st3-steps{grid-template-columns:repeat(4,1fr)}
.st3-hub.body,.st3-fill.body{justify-content:flex-start;gap:14px;padding-top:14px;padding-bottom:12px}
.st3-hub>.grid2:first-of-type{flex:1;min-height:0}
.st3-hub>.grid2:first-of-type>.task{height:100%}
.st3-fill>.slab.row{flex:1;min-height:180px}
.st3-unc.body{justify-content:space-between;gap:12px;padding-top:16px;padding-bottom:14px}
.st3-unc .st3-vsteps{flex:none;grid-template-columns:1fr;gap:12px}
.st3-unc .steps3.big .s{min-height:150px}
.st3-unc .sumcard .r{min-height:76px;padding:12px 22px}
.st3-exits{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.st3-exits .btn{width:100%;height:80px}
.st3-reason{background:var(--well);border-radius:24px;padding:16px 20px}
`;
  document.head.appendChild(css);

  const askOff = (text) => `<button class="askq st3-askoff" type="button" aria-disabled="true"><span class="mic">${icon('mic', 30, 2.2)}</span><span>${text}</span></button>`;
  const holdTask = (o) => `<div class="task st3-hold rise" style="--i:${o.i};min-height:${o.h || 188}px" role="group" aria-disabled="true" aria-label="${o.t}，正在确认"><div class="top"><span class="ic">${icon(o.ic, 36, 2)}</span><span class="chip slate">正在确认</span></div><h3>${o.t}</h3><p>${o.d}</p></div>`;
  const stopTask = (o) => `<div class="task st3-hold rise" style="--i:${o.i};min-height:${o.h || 210}px" role="group" aria-disabled="true" aria-label="${o.t}，${o.why}"><div class="top"><span class="ic">${icon(o.ic, 40, 2)}</span><span class="chip clay">${o.badge}</span></div><h3 style="font-size:36px">${o.t}</h3><p>${o.why}</p></div>`;
  const goTask = (o) => `<button class="task rise${o.held ? ' st3-hold st3-go' : ''}" style="--i:${o.i};min-height:${o.h || 210}px" data-go="${o.go}"${o.arg ? ` data-arg="${o.arg}"` : ''}><div class="top"><span class="ic">${icon(o.ic, 40, 2)}</span>${o.chip ? `<span class="chip ${o.chipKind || ''}">${o.chip}</span>` : ''}</div><h3 style="font-size:36px">${o.t}</h3><p>${o.d}</p>${o.vis ? `<div class="mini">${o.vis}</div>` : ''}<div class="take">${icon('arrowR', 24, 2.6)}${o.take || ''}</div></button>`;
  const holdTile = (o) => `<div class="tile off st3-hold rise" style="--i:${o.i};min-height:112px" role="group" aria-disabled="true" aria-label="${o.t}，${o.d}"><span class="ic ${o.tone || ''}">${icon(o.icon, 34, 2)}</span><span class="tx"><b>${o.t}</b><small>${o.d}</small></span></div>`;

  add('st-loading', '状态样式板', '加载：打印服务台正在确认本机能力', {
    notes: {
      does: '打印服务台还在读本机能力时，版式与打印服务台一致：打印、扫描先不开，复印和到机码照常可点。',
      motion: '卡片依次浮入。确认中的状态点不转圈，避免看成马上就好。',
      keep: '对应运行页 /print-scan 的 capability-loading（printHubContent.ts）。胶囊「正在读取本机能力」。问句「正在确认这台机器能做什么。」副题「确认前，打印、扫描这几项先不进入；到机码、复印照常可用。」打印文件、扫描纸质材料写「正在确认」，浅底虚线。复印、到机码照常可点。其他工具 3×2：照片打印、照片合成 PDF、证件照、签名写「正在确认」；我的文档、打印订单不在能力确认里，照常可点。不画空白骨架，不写时长。不把彩色、双面写成已经开通。'
    },
    render: () => F({
      band: {
        eyebrow: '打印扫描服务',
        title: '正在确认这台机器能做什么。',
        sub: '确认前，打印、扫描这几项先不进入；到机码、复印照常可用。',
        seal: 'idle',
        place: ' ',
        status: { text: '正在读取本机能力' },
        rail: { labels: ['选文件', '材料检查', '预览与参数', '核对价格'], now: -1 }
      },
      cls: 'd3-print st3-load',
      body: `<div class="grid2">
          ${holdTask({ i: 0, h: 200, ic: 'printer', t: '打印文件', d: '正在确认这台机器能不能打印' })}
          ${holdTask({ i: 1, h: 200, ic: 'scan', t: '扫描纸质材料', d: '正在确认这台机器能不能扫描' })}
          ${goTask({ i: 2, h: 200, go: 'copy', ic: 'copy', t: '复印', d: '在打印机屏幕上点<span class="d3-ext">「复印」</span><span class="d3-ext">「身份证复印」</span>或<span class="d3-ext">「票据复印」</span>；不经过这台一体机下单，也不进打印订单', take: '复印件', vis: `<span class="d3-mfpmini">${UI.mfp()}</span>` })}
          ${goTask({ i: 3, h: 200, go: 'pickup', ic: 'ticket', chip: '不是取件码', chipKind: 'slate', t: '到机码核销', d: '凭码办理，<br>不登录也能核销<br>· 8 位数字（历史 10 位码也<span class="d3-ext">支持）</span>', take: '订单里的打印件', vis: `<div class="codeart" aria-hidden="true">${'<i></i>'.repeat(8)}</div>` })}
        </div>
        <p class="fine" style="margin:0">按 A4 出纸 · 彩色 / 双面 · 本机暂未开通</p>
        ${sec('其他工具')}
        <div class="d3-tools">
          ${holdTile({ i: 4, icon: 'image', t: '照片打印', d: '正在确认' })}
          ${holdTile({ i: 5, icon: 'layers', t: '照片合成 PDF', d: '正在确认' })}
          ${holdTile({ i: 6, icon: 'idcard', t: '证件照', d: '正在确认' })}
          ${holdTile({ i: 7, icon: 'pen', tone: 'clay', t: '签名', d: '正在确认' })}
          ${tile({ i: 8, go: 'my-docs', icon: 'folder', tone: 'slate', title: '我的文档', desc: '登录后查看' })}
          ${tile({ i: 9, go: 'my-orders', icon: 'receipt', tone: 'slate', title: '打印订单', desc: '登录后查看' })}
        </div>`,
      dock: { ask: '问小青：怎么选打印方式？' },
      nav: 'home'
    })
  });

  add('st-empty', '状态样式板', '空：检查与预览没有待处理的文件', {
    notes: {
      does: '材料检查或预览打开时，这次办理里没有文件。',
      motion: '说明卡和两个去向依次浮入。',
      keep: '对应运行页 /print/desk 缺文件，以及 /print/material-check、/print/preview 落到同一空态。标题「这一页没有待处理的文件」是 W6 门禁钉的原句（PrintMaterialCheckPage.tsx、PrintPreviewPage.tsx）。不显示文件名、页数、大小、检查结论，也不放示例文件。主按钮「去选文件」去选文件步。我的文档要登录后才有本人文件；未登录去登录。到这一步没有订单、没有扣费。办理顺序四字用 PrintDeskChrome 原文：选文件、材料检查、预览与参数、核对价格；这一屏不标当前停在哪一步，因为检查和预览都会落到这个空态。'
    },
    render: () => F({
      band: {
        place: ' ',
        eyebrow: '材料检查与预览',
        title: '这一页没有待处理的文件',
        sub: '先选好要打印的材料，再检查、再设参数。',
        seal: null,
        status: { text: '没有待处理的文件', warn: 1 }
      },
      cls: 'tight st3-fill',
      body: `<div class="howto rise" style="--i:0">${icon('file', 34, 2)}<span>文件还没选，或者上一位的文件已经清除。到这一步没有订单，也没有扣费。</span></div>
        ${sec('办理顺序')}
        <div class="steps3 st3-steps rise" style="--i:1">
          <div class="s"><span class="n">1</span><b>选文件</b></div>
          <div class="s"><span class="n">2</span><b>材料检查</b></div>
          <div class="s"><span class="n">3</span><b>预览与参数</b></div>
          <div class="s"><span class="n">4</span><b>核对价格</b></div>
        </div>
        ${slab({ i: 2, row: 1, go: 'print-src', title: '去选文件', desc: '手机、U 盘，把真实文件带进这次办理', vis: UI.phone(86) })}
        ${slab({ i: 3, row: 1, go: S().logged ? 'my-docs' : 'login', title: '我的文档（登录后）', desc: S().logged ? '你保存过的文件在这里，选一份再来' : '登录后才能看到你保存的文件', vis: UI.stack(100, 2) })}
        ${fine('这一页本身不保存文件')}`,
      dock: { ask: '问小青：文件要从哪传？', pri: { label: '去选文件', go: 'print-src' } },
      nav: 'home'
    })
  });

  add('st-error', '状态样式板', '出错：文件没传上来', {
    notes: {
      does: '上传没成功：二维码没出来、上传失败、文件过大或格式不收，都落在这一类。',
      motion: '原因卡和两个去向依次浮入。静止，不做成即将成功。',
      keep: '对应运行页 /print/upload 的过大拒收（phoneUploadModel.ts too-large）。副题「体积是在手机上就拦下的，系统没有收到这份文件。」原因卡「这个文件 23.6MB，超过单个 10MB 的上限，没有发出去。请压缩后再选一次。」示例文件「毕业论文-终稿（含图表）.pdf」，运行时读被拒的那一份。一体机不写本机选文件。没有进入本次办理，不写手机连接状态，不写下单人。两条去向不写「带走」。' + phoneNote + '。'
    },
    render: () => F({
      band: {
        place: ' ',
        eyebrow: '打印文件 · 上传',
        title: '这份文件没传上来',
        sub: '体积是在手机上就拦下的，系统没有收到这份文件。',
        seal: null,
        status: { text: '没有收下', warn: 1 }
      },
      cls: 'tight st3-fill',
      body: `<div class="filecard rise" style="--i:0"><span class="ft">PDF</span><div style="min-width:0"><b>毕业论文-终稿（含图表）<span class="d3-ext">.pdf</span></b><small>手机通道 · 这一份没有进入本次办理</small></div><span class="chip cin">未收下</span></div>
        <div class="dsec rise" style="--i:1"><h4>${icon('alert', 30, 2)}原因</h4><p class="st3-reason">这个文件 23.6MB，超过单个 10MB 的上限，没有发出去。请压缩后再选一次。</p></div>
        ${slab({ i: 2, row: 1, go: 'upload', arg: 'print', title: '重新传一次', desc: '这一份没有收下。压缩后再选一次', vis: UI.phone(86) })}
        ${slab({ i: 3, row: 1, go: 'print-src', title: '换一种方式', desc: '改用 U 盘，或登录后从我的文档选', vis: UI.usb(140) })}
        <div class="remind rise" style="--i:4">${icon('call', 34, 2)}<span>${helpLine()}</span></div>`,
      dock: { ask: '问小青：这份太大了怎么办？', pri: { label: '重新传一次', go: 'upload', arg: 'print' } },
      nav: 'home'
    })
  });

  add('st-unavailable', '状态样式板', '不可用：在线服务暂时连不上', {
    notes: {
      does: '简历服务台在后端没就绪时：要联网的入口全部停，并给重新检测。',
      motion: '卡片依次浮入。问小青留在原位，呈不可用，不播放聆听。',
      keep: '对应运行页 /resume-service，useApiReadiness 为 unavailable（QxServiceHubPage statusPill「在线服务不可用」，noticeCopy 的 apiDown）。八项能力与三条常用入口的路由都不在不联网白名单里（serviceHubModel.ts needsBackend），全部停用。原因按 unavailableReason：kind===ai 写「AI能力当前不可用」（AI 简历诊断、AI 简历优化、从零生成简历、职业规划、简历对照）；其余要联网的写「在线服务当前不可用」（简历素材库 info、求职材料 info、简历打印 device——本屏是后端不可用不是打印机离线，所以不写「本机设备当前不可用」、我的简历 account、AI服务记录 account、自我探索 info）。说明句用「网络断开时，这台机器暂时办不了需要联网的事，请稍后再来」。主按钮「重新检测」。问小青不消失，文案「小青也要联网，恢复后再问」。合同审查只在开关打开时才有，这里不画。不出现岗位、招聘会入口。' + phoneNote + '。'
    },
    render: () => F({
      band: {
        place: ' ',
        eyebrow: '改简历',
        title: '在线服务暂时连不上',
        sub: '网络断开时，这台机器暂时办不了需要联网的事，请稍后再来。',
        seal: null,
        status: { text: '在线服务不可用', warn: 1 }
      },
      cls: 'tight',
      body: `${sec('八项简历能力', '要联网的先停')}
        <div class="grid2">
          ${[['eye', 'AI 简历诊断', 'ai'], ['pen', 'AI 简历优化', 'ai'], ['file', '从零生成简历', 'ai'], ['layout', '简历素材库', 'net'], ['map', '职业规划', 'ai'], ['clipboard', '求职材料', 'net'], ['printer', '简历打印', 'net'], ['target', '简历对照', 'ai']].map((c, i) => holdTile({ i, icon: c[0], t: c[1], d: c[2] === 'ai' ? 'AI能力当前不可用' : '在线服务当前不可用' })).join('')}
        </div>
        ${sec('常用入口', '同样要联网')}
        <div class="grid2">
          ${holdTile({ i: 8, icon: 'user', tone: 'slate', t: '我的简历', d: '在线服务当前不可用' })}
          ${holdTile({ i: 9, icon: 'sparkle', t: 'AI 服务记录', d: '在线服务当前不可用' })}
          ${holdTile({ i: 10, icon: 'compass', t: '自我探索', d: '在线服务当前不可用' })}
        </div>
        <div class="remind rise" style="--i:12">${icon('call', 34, 2)}<span>${helpLine()}</span></div>`,
      dock: { ask: false, mid: askOff('小青也要联网，恢复后再问'), pri: { label: '重新检测', act: 'toast', arg: '演示：重新检测', kind: 'pri' } },
      nav: 'home'
    })
  });

  add('st-device-off', '状态样式板', '设备停用：打印机缺纸', {
    notes: {
      does: '打印机确定缺纸时：出纸和扫描先停，复印说明、到机码、手机和 U 盘上传仍可进。',
      motion: '可点的卡照常按下缩小；停用的卡按下不动。',
      keep: '对应运行页 /print-scan 的 device-off，且设备短标题是缺纸（胶囊「打印机缺纸 · 出纸类暂停」）。问句「这台机器出不了纸。」打印文件、材料扫描呈浅底虚线停用样。照片打印同样要出纸，本屏不另占一张卡。扫描原因用「扫描和打印是同一台机器，一起停」。复印卡写「缺纸时复印也出不了纸，补纸后再用」，呈停用样但仍可点进说明。到机码卡写「这台机器现在出不了纸，核销完也拿不到纸；订单还在，请稍后再来。」不写附近另有终端才会出现的换机句。手机扫码、U 盘导入仍可进，先传、稍后打印。底部用机器故障标准句。' + phoneNote + '。'
    },
    render: () => F({
      band: {
        place: ' ',
        eyebrow: '打印 · 扫描 · 复印',
        title: '这台机器出不了纸。',
        sub: '缺纸了。打印和扫描先停，订单还在。',
        seal: null,
        status: { text: '打印机缺纸 · 出纸类暂停', warn: 1 }
      },
      cls: 'tight st3-hub',
      body: `<div class="grid2">
          ${stopTask({ i: 0, h: 200, ic: 'printer', t: '打印文件', badge: '打印机缺纸', why: '打印机缺纸，这次出不了纸。文件可以先从下面传上来。' })}
          ${stopTask({ i: 1, h: 200, ic: 'scan', t: '扫描纸质材料', badge: '一起停', why: '扫描和打印是同一台机器，一起停。' })}
          ${goTask({ i: 2, h: 200, go: 'copy', ic: 'copy', held: 1, t: '复印', d: '缺纸时复印也出不了纸，补纸后再用', take: '看复印步骤' })}
          ${goTask({ i: 3, h: 200, go: 'pickup', ic: 'ticket', chip: '不是取件码', chipKind: 'slate', t: '到机码核销', d: '这台机器现在出不了纸，核销完也拿不到纸；订单还在，请稍后再来。', take: '核对这一单' })}
        </div>
        ${sec('先传、稍后打印')}
        <div class="grid2">
          ${tile({ i: 4, go: 'upload', arg: 'print', icon: 'phone', title: '手机扫码上传', desc: '先传上来，稍后打印' })}
          ${tile({ i: 5, go: 'usb', arg: 'print', icon: 'usb', title: 'U 盘导入', desc: '先导入，稍后打印' })}
        </div>
        <div class="remind rise" style="--i:6">${icon('alert', 34, 2.2)}<span>${machineLine()}</span></div>`,
      dock: { ask: '问小青：缺纸了文件还要传吗？' },
      nav: 'home'
    })
  });

  add('st-unconfirmed', '状态样式板', '结果未确认：打印机没有回报', {
    notes: {
      does: '运行页 /print/done 未确认态，errorCode 为 PRINT_JOB_UNCONFIRMED。打印流程里的 unconfirmed 屏复用这一屏的 render。',
      motion: '三步静止展开。不做成功对勾，也不做倒计时演完自动结束。',
      keep: '眉题「打印结果」，大标题「这次打印结果未确认。」，副句「系统已明确登记，等待人工核查」，胶囊「打印结果未确认」。三步：先看出纸口是否已有纸张；无论有没有，这笔订单都已保留，不要重复打印；需要帮助拨打服务电话并报订单号。服务电话只出现在第 3 步。摘要含订单号，示例 ORD-20261026-0418，运行时从订单读。底部返回位「返回首页」。内容区「查看订单说明」「反馈问题」。主按钮「使用帮助」（运行页主按钮是现场核查口径，本屏改成使用帮助）。问小青「取纸或异常怎么办」。「查看打印订单」是细行，登录后才有本人订单。底部小字「这次结果已登记，等待人工核查；订单保留。」不猜成功也不猜失败，不重复下单。' + phoneNote + '。'
    },
    render: () => F({
      band: {
        kind: 'compact',
        eyebrow: '打印结果',
        title: '这次打印结果未确认。',
        sub: '系统已明确登记，等待人工核查',
        seal: null,
        place: ' ',
        status: { text: '打印结果未确认', warn: 1 }
      },
      cls: 'st3-unc',
      body: `<div class="steps3 big st3-vsteps">
          <div class="s"><span class="n">1</span><b>先看出纸口是否已有纸张</b><small>设备在断电、失联或硬件异常后，无法确认这次打印的实际结果。</small></div>
          <div class="s"><span class="n">2</span><b>无论有没有，这笔订单都已保留，不要重复打印</b><small>不猜成功也不猜失败，已登记等待人工核查。</small></div>
          <div class="s"><span class="n">3</span><b>需要帮助？拨打服务电话 <span class="d3-ext">${PHONE}</span>，报这一单的订单号</b><small>服务时间：工作日 9:00–18:00</small></div>
        </div>
        <div class="sumcard">
          <div class="r"><span>订单号</span><b>ORD-20261026-0418</b><span></span></div>
          <div class="r"><span>文件</span><b>毕业生就业推荐表（已填写）<span class="d3-ext">.pdf</span></b><span></span></div>
          <div class="r"><span>参数</span><b>2 张 · 黑白 · 单面</b><span></span></div>
        </div>
        <div class="st3-exits">
          <button class="btn sec" data-act="toast" data-arg="订单 ORD-20261026-0418，毕业生就业推荐表（已填写）.pdf，2 张，黑白，单面。结果未确认，订单保留。">查看订单说明</button>
          <button class="btn sec" data-act="toast" data-arg="不用登录也能反馈。写完留在这一页。">反馈问题</button>
        </div>
        <button class="rowlink" data-go="my-orders">${icon('receipt', 32, 2)}<span><b>查看打印订单</b></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button>
        ${fine('这次结果已登记，等待人工核查；订单保留。')}`,
      dock: { back: false, left: `<button class="btn sec" data-go="home">${icon('chevL', 30, 2.4)}返回首页</button>`, ask: '问小青：取纸或异常怎么办', pri: { label: '使用帮助', go: 'help' } },
      nav: 'home'
    })
  });

  const MANUAL = [
    '姓名、手机号、邮箱在第一屏就能看到',
    '每段经历都写了起止时间',
    '职责后面跟着结果，不只写「负责什么」',
    '技能写清工具名称和熟练程度',
    '通读一遍，没有错别字和断行',
    '控制在一到两页，导出后再看一次排版'
  ];

  add('st-ai-down', '状态样式板', '小青不可用：这次没诊断出来', {
    notes: {
      does: '简历诊断明确失败，而且小青这次用不了（含当天额度用完）。页面只给不用 AI 也能做的事。这一帧画原件可以打印的那一态。',
      motion: '各块依次浮入。不播放小青在听或在想。',
      keep: '对应运行页 /resume/report 的 diagnose-failed，且解析页判定 aiDown（含当日额度用完，ResumeReportPage.tsx、ResumeParsePage.tsx）。胶囊用 REPORT_STATUS diagnose-failed「解析失败」。意图带「这次没诊断出来」。额度原句 AI_PUBLIC_QUOTA_EXCEEDED_COPY：「今天的 AI 次数用完了，明天恢复；可以先打印原件。」说明用文件名加「这次没有生成诊断结论」。文件名从上传结果读，示例「李佳怡-产品运营-简历.pdf」。自查标题「不等 AI，先自己核一遍」，6 条是 MANUAL_CHECKS 原文。「6 项 · 纸质简历同样适用」不小于 20px。出口组标题「这些都不需要 AI · 现在就能做」。打印原件可点，说明「不需要 AI，先检查个人信息再打印」，去 pii（运行页先核对个人信息再进打印）。置灰态不画在这一帧：拿不到 fileId 或 fileUrl 时按钮写「本次不可用」，原因是 ResumeDiagnosisFailExits 的 NO_PRINT_URL_REASON「这里拿不到你刚上传的那份原件（离开这一页再回来就拿不到了）。请回到简历来源重新选取文件，再去打印。」其余出口：去打印 / 扫描其他材料（打印扫描不依赖 AI，照常可用）去 print；查政策（查看本机构发布的政策与办理说明）去 policy；本机构官方渠道（扫码查看本机构官网或官方账号）只在渠道数大于 0 时出现，这一帧画大于 0，去 official。不画和主按钮重复的「换一份简历」。问小青留在原位但不可用，文案「小青暂时不可用，先自己核一遍」。主按钮「打印我上传的原件」。'
    },
    render: () => {
      const exit = (o) => `<button class="slab row rise" style="--i:${o.i}" data-go="${o.go}"><div class="vis">${icon(o.ic, 40, 2)}</div><div class="txt"><h3>${o.t}</h3><p>${o.d}</p><div class="take">${icon('arrowR', 26, 2.4)}<span>${o.take}</span></div></div></button>`;
      return F({
        band: {
          place: ' ',
          eyebrow: '简历诊断报告',
          title: '这次没诊断出来',
          sub: '今天的 AI 次数用完了，明天恢复；可以先打印原件。',
          seal: null,
          status: { text: '解析失败', warn: 1 },
          rail: { labels: ['上传与方向', 'AI 解析', '诊断报告', '优化打印'], now: 1 },
          kind: 'compact'
        },
        cls: 'tight st3-aidown',
        body: `<div class="howto rise" style="--i:0">${icon('alert', 34, 2)}<span>「李佳怡-产品运营-简历.pdf」的解析没有完成。这次没有生成诊断结论，下面不需要 AI 的事现在就能做。</span></div>
          <div class="sec-t">这些都不需要 AI · 现在就能做</div>
          <div class="d4-exgroup">
            ${exit({ i: 1, go: 'pii', ic: 'printer', t: '打印我上传的原件', d: '不需要 AI，先检查个人信息再打印', take: '去核对' })}
            ${exit({ i: 2, go: 'print', ic: 'printer', t: '去打印 / 扫描其他材料', d: '打印扫描不依赖 AI，照常可用', take: '去打印扫描' })}
            ${exit({ i: 3, go: 'policy', ic: 'book', t: '查政策', d: '查看本机构发布的政策与办理说明', take: '去看政策' })}
            ${exit({ i: 4, go: 'official', ic: 'qr', t: '本机构官方渠道', d: '扫码查看本机构官网或官方账号', take: '去扫码' })}
          </div>
          <div class="olist rise" style="--i:5"><div class="olist-t">不等 AI，先自己核一遍<span class="d4-ck">6 项 · 纸质简历同样适用</span></div>
            ${MANUAL.map((t, i) => `<div class="st3-check"><i>${i + 1}</i><span>${t}</span></div>`).join('')}
          </div>`,
        dock: { ask: false, mid: askOff('小青暂时不可用，先自己核一遍'), pri: { label: '打印我上传的原件', go: 'pii' } },
        nav: 'home'
      });
    }
  });

  window.SCREEN_GROUPS.push('状态样式板');
})();
