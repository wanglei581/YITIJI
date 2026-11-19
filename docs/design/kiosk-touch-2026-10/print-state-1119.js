/* print-state-1119.js：打印状态补稿（2026-11-19 起草；产品负责人看过、同意后才进冻结清单）
 * 补全线 S15c 在程序里做了三组状态，稿上没画。照 10/25「改程序前先补稿」，先补进触屏稿：
 * 1. 打印失败三态（/print/done）：缺纸 PAPER_EMPTY、故障可能卡纸 PRINTER_ERROR、离线 PRINTER_OFFLINE。
 *    新屏 st-fail-paper / st-fail-fault / st-fail-offline，排在状态样式板「结果未确认」后面，骨架照它：
 *    三步 + 订单摘要 + 出口 + 文件带走 +「查看打印订单」+ 小字。标题、副句、胶囊说同一件事；
 *    服务电话只在第 3 步；PRINTER_ERROR 写「打印机出了故障（可能卡纸）」，公开状态确实是卡纸才写「打印机卡纸」。
 * 2. 打印机卡纸（公开状态 paper_jam）：首页顶栏胶囊、打印卡角标写「打印机卡纸」（地址 ?printer=jam#home）；
 *    打印扫描服务台新屏 st-device-jam，排在 st-device-off 后面，胶囊「打印机卡纸 · 出纸类暂停」，版面同缺纸。
 * 3. 我的打印订单列出手机上下、还没取的单（地址 ?login=1&pk=…#my-orders）：有待取单没有打印任务、
 *    有待取单也有打印任务、读失败、走错机器；另画读失败且没有打印任务。
 * 原有稿文件一个字不改，只包住它们画出来的屏。地址加 ?ps=0 看改前原样。
 * 状态键：S().pfRetry（blocked / ready / none）、S().pfTake（qr / miss / expired）、S().pfJam、
 *   S().pk（'' / rows / both / fail / fail-empty / elsewhere）、S().pkReload；S().printer 多一个值 jam。
 * 依据：分支 claude/print-status-s15c-1118 头 61c89198d（S15c2）的 printDoneFailedModel.ts、printProgressModel.ts、
 *   PrintDoneFailed.tsx、QxPrintHubView.tsx、PrintScanHomePage.tsx、PendingPickupSection.tsx、pendingPickupExits.ts、
 *   pickupHereOrders.ts、MyPrintOrdersPage.tsx。 */
(function () {
  'use strict';
  const Q = new URLSearchParams(location.search);
  if (Q.get('ps') === '0') return;
  const { icon, band, dock, nav } = UI;
  const PHONE = '183-6916-1921';
  const ORDER = 'ORD-20261026-0418';

  /* window.S 由 app.js 建，app.js 排在本文件之后：默认值在第一次画屏时从地址读。 */
  function S() {
    const s = window.S;
    if (!s) return {};
    if (!s.__ps19) {
      Object.defineProperty(s, '__ps19', { value: true, enumerable: false });
      if (Q.get('printer') === 'jam') s.printer = 'jam';
      s.pfRetry = ['ready', 'none'].indexOf(Q.get('pfRetry')) >= 0 ? Q.get('pfRetry') : 'blocked';
      s.pfTake = ['miss', 'expired'].indexOf(Q.get('pfTake')) >= 0 ? Q.get('pfTake') : 'qr';
      s.pfJam = Q.get('pfJam') === '1';
      s.pk = ['rows', 'both', 'fail', 'fail-empty', 'elsewhere'].indexOf(Q.get('pk')) >= 0 ? Q.get('pk') : '';
      s.pkReload = false;
    }
    return s;
  }
  /* 首屏不是本文件包住的屏时，地址里的 ?printer=jam 也要生效。 */
  setTimeout(() => { if (window.S && !window.S.__ps19) { S(); if (S().printer === 'jam' && window.__proto) window.__proto.refresh(); } }, 0);

  function find(id) {
    const d = (window.SCREENS || []).find((x) => x.id === id);
    if (!d) throw new Error('print-state-1119：找不到屏 ' + id);
    return d;
  }
  function insertAfter(afterId, def) {
    const list = window.SCREENS;
    const i = list.findIndex((x) => x.id === afterId);
    list.splice(i < 0 ? list.length : i + 1, 0, def);
  }
  function once(html, from, to, where) {
    const n = html.split(from).length - 1;
    if (n !== 1) throw new Error('print-state-1119：' + where + ' 的替换目标出现 ' + n + ' 次（应为 1 次）：' + from.slice(0, 40));
    return html.replace(from, () => to);
  }
  function demoOf(d) { const x = d.demo; return typeof x === 'function' ? (x() || []) : (x || []); }
  const refresh = () => window.__proto.refresh();
  /* pay-1113.js 已把「公共就业点位」算成不收费：S().fee 为真就是收费点位。 */
  const charged = () => !!S().fee;
  const printerStatus = () => {
    const p = S().printer;
    if (p === 'jam') return { text: '打印机卡纸', warn: 1 };
    if (p === 'down') return { text: '打印机离线', warn: 1 };
    return { text: '打印机在线' };
  };

  /* ───────── 样式（类名一律 pf- / pk-） ───────── */
  const css = document.createElement('style');
  css.id = 'ps19-style';
  css.textContent = `
.pf-fail.body{justify-content:space-between;gap:12px;padding-top:16px;padding-bottom:12px}
.pf-fail .st3-vsteps{gap:10px}
.pf-fail .steps3.big .s{min-height:0;padding:16px 26px}
.pf-fail .steps3.big .s b{font-size:26px;line-height:1.3}
.pf-fail .steps3.big .s small{font-size:22px;line-height:1.45;margin-top:2px}
.pf-fail .sumcard .r{min-height:62px;padding:8px 24px;font-size:25px}
.pf-fail .sumcard .r b{line-height:1.35}
.pf-exits{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:12px}
.pf-exits .btn{width:100%;min-width:0;height:80px;padding:0 14px}
.pf-exits .pf-retry[aria-disabled="true"]{background:var(--well);color:var(--ink-3);border:1.5px dashed rgba(11,36,30,.28);cursor:default}
.pf-exits .pf-retry[aria-disabled="true"]:active{transform:none}
.pf-why{display:flex;gap:10px;align-items:flex-start;margin:-2px 0 0;font-size:22px;line-height:1.45;color:var(--clay-ink);font-weight:600}
.pf-why svg{flex:none;margin-top:2px}
.pf-take{display:flex;align-items:center;gap:26px;padding:14px 24px;border-radius:26px;background:var(--card);border:1.5px solid var(--edge)}
.pf-take .q{flex:none;width:172px;height:172px;padding:6px;border-radius:16px;background:#fff;box-shadow:0 0 0 1.5px var(--edge)}
.pf-take .q svg{width:160px;height:160px;display:block}
.pf-take b{display:block;font:700 32px/1.25 var(--serif)}
.pf-take .left{display:inline-flex;align-items:center;height:40px;margin:10px 0 8px;padding:0 14px;border-radius:20px;background:var(--teal-wash);color:var(--teal-ink);font-size:21px;font-weight:700}
.pf-take small{display:block;font-size:22px;line-height:1.45;color:var(--ink-2)}
.pf-fail .rowlink{min-height:80px}
.pk-list{display:flex;flex-direction:column;gap:10px;flex:none}
.pk-row{display:flex;align-items:center;gap:20px;min-height:128px;padding:16px 22px;border-radius:26px;background:var(--card);border:1.5px solid var(--edge)}
.pk-ft{flex:none;width:72px;height:88px;border-radius:14px;background:#fdecea;color:var(--cinnabar);display:grid;place-items:center;font:700 20px var(--sans)}
.pk-ft.pkg{background:var(--teal-wash);color:var(--teal-ink)}
.pk-tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;text-align:left}
.pk-tx b{font-size:28px;line-height:1.3}
.pk-tx small{font-size:22px;line-height:1.4;color:var(--ink-3);font-weight:600}
.pk-row .btn.pk-go{flex:none;min-width:0;height:80px;padding:0 30px;font-size:26px}
.pk-where{display:flex;gap:12px;align-items:flex-start;margin-top:8px;padding:12px 16px;border-radius:18px;background:var(--clay-wash);color:var(--clay-ink)}
.pk-where svg{flex:none;margin-top:2px}
.pk-where b{display:block;font-size:24px;line-height:1.35}
.pk-where span{display:block;font-size:22px;line-height:1.45;font-weight:600}
.pk-err{display:flex;align-items:center;gap:16px;min-height:112px;padding:16px 22px;border-radius:26px;background:var(--clay-wash);color:var(--clay-ink)}
.pk-err>svg{flex:none}
.pk-err p{flex:1;margin:0;font-size:24px;line-height:1.45;font-weight:700}
.pk-err p span{display:block;font-size:22px;font-weight:600}
.pk-page .fe-rows.few{flex:0 0 auto}
.pk-exits .fe-exit{flex:1 1 0}
.pk-exits .fe-exit>div:first-child{flex:none;width:240px;height:100%;display:grid;place-items:center}
.pk-exits .fe-exit svg{width:auto;height:auto;max-width:240px;max-height:100%}
.pk-err .btn{flex:none;min-width:0;height:72px;padding:0 26px;font-size:24px}
`;
  document.head.appendChild(css);

  /* ───────── 1. 打印失败三态 ───────── */
  const LOOK = ['先看出纸口，已出的纸取走收好', '本机不知道出了几页，以你手里的实物为准。'];
  const KINDS = {
    paper: {
      id: 'st-fail-paper',
      name: '打印失败：打印机缺纸（11/19 补稿）',
      code: 'PAPER_EMPTY',
      fault: () => '打印机缺纸',
      subFault: () => '机器缺纸，加纸后也不会自动续打',
      step1: () => LOOK,
      tail: '',
      report: '打印机缺纸，当前无法打印。',
      blocked: () => '打印机现在还缺纸，暂时不能重新提交；机器恢复后，这个按钮会自己亮起。'
    },
    fault: {
      id: 'st-fail-fault',
      name: '打印失败：打印机出了故障（可能卡纸）（11/19 补稿）',
      code: 'PRINTER_ERROR',
      fault: () => (S().pfJam ? '打印机卡纸' : '打印机出了故障（可能卡纸）'),
      subFault: () => (S().pfJam ? '机器卡纸' : '机器出了故障'),
      step1: () => ['已出的纸取走收好，不要开机盖、不要拽纸', S().pfJam ? '卡着的纸撕在里面更难取，也可能弄坏机器。' : '可能卡了纸，撕在里面更难取，也可能弄坏机器。'],
      tail: '这次打印不会自己接着打。',
      report: () => (S().pfJam ? '打印机卡纸，当前无法打印。' : '打印机可能卡纸或发生设备故障，当前暂时无法继续使用。'),
      blocked: () => (S().pfJam ? '打印机现在还卡着纸' : '打印机现在还有故障') + '，暂时不能重新提交；机器恢复后，这个按钮会自己亮起。'
    },
    offline: {
      id: 'st-fail-offline',
      name: '打印失败：打印机离线（11/19 补稿）',
      code: 'PRINTER_OFFLINE',
      fault: () => '打印机离线',
      subFault: () => '打印机没连上',
      step1: () => LOOK,
      tail: '这次打印不会自己接着打。',
      report: '打印机离线，当前无法打印。',
      blocked: () => '这台机器的打印机现在离线，暂时不能重新提交；机器恢复后，这个按钮会自己亮起。'
    }
  };

  function failRender(k) {
    const K = KINDS[k];
    const s = S();
    const paid = charged();
    const retry = s.pfRetry || 'blocked';
    const fault = K.fault();
    const sub = (paid ? '你的订单和已付金额都保留着。' : '你的订单还在。') + K.subFault() + '，我们已经收到提醒，会尽快处理';
    const lead = K.tail ? K.tail + '<br>' : '';
    const step2 = retry === 'none'
      ? lead + (paid ? '是否补打、费用怎么处理，以订单记录为准；' : '是否补打，以订单记录为准；') + '你可以稍后再来。'
      : lead + '机器恢复后，用下面的「重新提交打印」整份重打' + (paid ? '，不再收费' : '') + '；也可以稍后再来。';
    const steps = [
      K.step1(),
      [paid ? '请不要重新下单，那会变成两笔费用' : '请不要重新下单', step2],
      [`需要帮助？拨打服务电话 <span class="d3-ext">${PHONE}</span>，报这一单的订单号`, '服务时间：工作日 9:00–18:00']
    ];
    const rows = [
      ['订单号', ORDER],
      ['文件', '毕业生就业推荐表（已填写）<span class="d3-ext">.pdf</span>'],
      ['参数', '2 张 · 黑白 · 单面'],
      paid ? ['支付状态', '已付 2.00 元'] : ['办理方式', '免费试运营，本单 0 元'],
      ['设备上报', typeof K.report === 'function' ? K.report() : K.report]
    ];
    let retryBtn = '';
    let why = '';
    if (retry === 'ready') retryBtn = `<button class="btn pri pf-retry" data-go="printing">重新提交打印</button>`;
    else if (retry === 'blocked') {
      retryBtn = `<button class="btn sec pf-retry" aria-disabled="true" aria-describedby="pfWhy">重新提交打印</button>`;
      why = `<p class="pf-why" id="pfWhy" role="status">${icon('lock', 26, 2.2)}<span>${K.blocked()}</span></p>`;
    }
    const take = s.pfTake === 'miss' || s.pfTake === 'expired'
      ? `<p class="fine">${s.pfTake === 'miss' ? '手机带走链接这次没取到，不影响这笔订单。' : '手机带走链接已过期，不影响这笔订单。'}</p>`
      : `<section class="pf-take" aria-label="文件带走"><div class="q">${UI.qr(11, 160)}</div><div><b>文件带走</b><span class="left">剩余 29 分 41 秒</span><small>请用本人手机扫码保存</small></div></section>`;
    const L = s.fmLayer && s.fmLayer.id === K.id ? s.fmLayer : null;
    const layer = !L ? '' : L.kind === 'order' ? orderLayer(paid) : window.FM.layerFor([K.id]);
    return band({ kind: 'compact', eyebrow: '打印结果', title: fault, sub, seal: null, place: ' ', status: { text: fault, warn: 1 } })
      + `<main class="body st3-unc pf-fail">
        <div class="steps3 big st3-vsteps" role="list" aria-label="处理之前先做这三件">${steps.map((t, i) => `<div class="s" role="listitem"><span class="n">${i + 1}</span><b>${t[0]}</b><small>${t[1]}</small></div>`).join('')}</div>
        <div class="sumcard">${rows.map((r) => `<div class="r"><span>${r[0]}</span><b>${r[1]}</b><span></span></div>`).join('')}</div>
        <div class="pf-exits" style="--n:${retryBtn ? 3 : 2}">
          <button class="btn sec" data-fl="order">${paid ? '查看费用说明' : '查看订单说明'}</button>
          <button class="btn sec" data-fl="fb">反馈问题</button>
          ${retryBtn}
        </div>
        ${why}
        ${take}
        <button class="rowlink" data-go="my-orders">${icon('receipt', 32, 2)}<span><b>查看打印订单</b></span><span class="chev">${icon('chevR', 28, 2.2)}</span></button>
        <p class="fine">${paid ? '订单和已付金额都保留着' : '订单记录保留着'}，不会因为这次失败消失。</p>
      </main>`
      + dock({ back: false, left: `<button class="btn sec" data-go="home">${icon('chevL', 30, 2.4)}返回首页</button>`, ask: '问小青：取纸或异常怎么办', pri: { label: '使用帮助', go: 'help' } })
      + nav('home')
      + layer;
  }
  function orderLayer(paid) {
    return `<div class="overlay"><div class="dialog" role="dialog"><h2>${paid ? '费用说明' : '订单说明'}</h2><p>订单 ${ORDER} · 毕业生就业推荐表（已填写）.pdf · 2 张 · 黑白 · 单面。</p><p>${paid ? '这次没打完，订单和已付金额都保留着；是否补打、费用怎么处理，以订单记录为准。' : '这次没打完，订单保留；是否补打，以订单记录为准。'}</p><div class="btns"><button class="btn pri" data-fl="close">知道了</button></div></div></div>`;
  }

  const FAIL_COMMON = '对应运行页 /print/done 的失败态（PrintDoneFailed.tsx，文案在 printDoneFailedModel.ts）。版式照状态样式板「结果未确认」：三步 + 订单摘要 + 出口 +「文件带走」+「查看打印订单」+ 小字；底部「返回首页 / 问小青：取纸或异常怎么办 / 使用帮助」。'
    + '标题、副句、胶囊说同一件事，胶囊只写故障，不再带「免费试运营，本单 0 元 ·」前缀（付款事实在摘要「办理方式 / 支付状态」一行；前缀加上「打印机出了故障（可能卡纸）」会把左上角「职易达」和右上角日期挤成两行）。'
    + '副句一律是「你的订单还在。{机器怎么了}，我们已经收到提醒，会尽快处理」，不复述标题：缺纸「机器缺纸，加纸后也不会自动续打」、故障「机器出了故障」、确实卡纸「机器卡纸」、离线「打印机没连上」；收费点位换成「你的订单和已付金额都保留着。…」。'
    + '第 2 步一律「请不要重新下单」：故障、离线先说「这次打印不会自己接着打。」（缺纸在副句说过），再说机器恢复后用「重新提交打印」整份重打，也可以稍后再来。'
    + '第 3 步一律是结果未确认那一屏的第 3 步：「需要帮助？拨打服务电话 …，报这一单的订单号」，服务时间另起一行；服务电话只出现在这里——「设备上报」只写设备那一句，「带走链接没取到」后面不接电话，小字不接电话。'
    + '「我们已经收到提醒，会尽快处理」只在副句说一次，第 3 步不再整句贴标准句 2。附近还有在线终端时（otherOnlineTerminalNearby），第 2 步末尾「也可以稍后再来」改成「也可以换一台机器继续，或稍后再来」。'
    + '「重新提交打印」只在带走链接接口给出 canRetry 时有：打印机还没好时置灰（aria-disabled），原因写在按钮下面一行，句子只说为什么不能点和什么时候会亮，「订单还在，请不要重新下单」第 2 步已经说过，不再重复；机器恢复后按钮自己亮起（演示事件），点了去出纸中。拿不到 canRetry 时不画按钮，第 2 步换成「是否补打，以订单记录为准；你可以稍后再来」（演示事件「这一单不能重新提交」）。'
    + '「文件带走」：带走链接签发成功才有，二维码不小于 168px，剩余时间按 30 分钟有效期倒数；没取到（含接口回 500）写「手机带走链接这次没取到，不影响这笔订单。」，到期写「手机带走链接已过期，不影响这笔订单。」，两句都不接电话。'
    + '「查看打印订单」和结果未确认一样画在这里；运行页只在登录后有这一行，没登录时不画，下面小字接上来。从到机码来的单，小字上面加运行页的同码续打句（SAME_CODE_RESUME_LINE），本帧是现场单不画。'
    + '「查看订单说明」在本屏开弹层（和结果未确认一致）；收费点位叫「查看费用说明」。订单号、文件、参数从这一单读，示例同结果未确认。'
    + '收费点位（?fee=1）只改钱的几处：副句、摘要「支付状态 已付 2.00 元」、出口「查看费用说明」、第 2 步「那会变成两笔费用」「不再收费」。退款句不写：11/13 定的是「能重试的失败同一单免费再试一次，不再试或再不成钱自动退回」，运行页失败页现在写「本机不会自动处理费用」，两边不一致，等收费线（P2e）一起定。'
    + '号码与服务时间从后台读，读不到时第 3 步写「需要帮助？查看《隐私政策》里的联系方式」。屏上没有「工作人员」类说法。';

  function failDef(k, extra) {
    const K = KINDS[k];
    return {
      id: K.id,
      group: '状态样式板',
      name: K.name,
      notes: {
        does: extra.does,
        motion: '三步静止展开。不做失败动画，不倒计时演成恢复；按钮亮起只由演示事件触发。',
        get keep() { return extra.keep() + FAIL_COMMON; }
      },
      demo: () => [
        { label: '演示：打印机恢复了（「重新提交打印」亮起）', ev: 'pf-ready' },
        { label: '演示：这一单不能重新提交（没有 canRetry）', ev: 'pf-none' },
        { label: '演示：带走链接没取到', ev: 'pf-miss' },
        { label: '演示：带走链接到期（30 分钟）', ev: 'pf-expired' }
      ].concat(k === 'fault' ? [{ label: S().pfJam ? '演示：回到「可能卡纸」' : '演示：公开状态确实是卡纸（paper_jam）', ev: 'pf-jam' }] : [])
        .concat([{ label: '演示：恢复默认', ev: 'pf-reset' }]),
      render: () => failRender(k),
      mount: (el) => {
        const on = (e) => {
          const s = S();
          if (e.detail === 'pf-ready') s.pfRetry = 'ready';
          else if (e.detail === 'pf-none') s.pfRetry = 'none';
          else if (e.detail === 'pf-miss') s.pfTake = 'miss';
          else if (e.detail === 'pf-expired') s.pfTake = 'expired';
          else if (e.detail === 'pf-jam') s.pfJam = !s.pfJam;
          else if (e.detail === 'pf-reset') { s.pfRetry = 'blocked'; s.pfTake = 'qr'; s.pfJam = false; }
          else return;
          refresh();
        };
        el.addEventListener('proto-demo', on);
        return () => el.removeEventListener('proto-demo', on);
      }
    };
  }

  const failScreens = [
    failDef('paper', {
      does: '运行页 /print/done 的缺纸失败态：打印任务失败，errorCode 为 PAPER_EMPTY（variant out-of-paper）。',
      keep: () => '眉题「打印结果」，标题与胶囊「打印机缺纸」，副句「你的订单还在。打印机缺纸，我们已经收到提醒，会尽快处理」。第 1 步先看出纸口，本机不知道出了几页；第 2 步写明「这次打印不会在加纸后自己接着打」（服务端没有加纸后自动续打的链路，重来只有 POST /print/jobs/:taskId/retry，整份重打）。设备上报「打印机缺纸，当前无法打印。」（printProgressModel.ts 对照表原句）。'
    }),
    failDef('fault', {
      does: '运行页 /print/done 的故障失败态：errorCode 为 PRINTER_ERROR（variant paper-jam）。设备只报了故障，不一定是卡纸，所以不说死。',
      keep: () => (S().pfJam
        ? '这一帧是公开打印机状态确实为卡纸（paper_jam，打印机报 DetectedErrorState=8）时：标题、胶囊写「打印机卡纸」，副句「你的订单还在。机器卡纸，我们已经收到提醒，会尽快处理」，第 1 步说明写「卡着的纸撕在里面更难取」，设备上报换成「打印机卡纸，当前无法打印。」（和缺纸、离线同一写法），整屏不再出现「可能卡纸」。'
        : '标题、胶囊写「打印机出了故障（可能卡纸）」，副句「你的订单还在。机器出了故障，我们已经收到提醒，会尽快处理」，和设备上报原句「打印机可能卡纸或发生设备故障，当前暂时无法继续使用。」同一口径；只有公开打印机状态确实是卡纸才改写「打印机卡纸」（演示事件）。还在读状态、离线、缺纸、别的故障都按「可能卡纸」写。')
        + '确实卡纸只升不降：这一页读到过一次 paper_jam 就一直写「打印机卡纸」，打印机恢复后不改回「可能卡纸」，换一单或离开本页才重置，标题和胶囊不来回跳。'
        + '第 1 步把取纸和「不要开机盖、不要拽纸」并成一步（可能卡了纸，撕在里面更难取，也可能弄坏机器），第 2、3 步和另两态一样。'
    }),
    failDef('offline', {
      does: '运行页 /print/done 的离线失败态：errorCode 为 PRINTER_OFFLINE（variant offline，测试标识 print-fulfill-state-offline）。',
      keep: () => '标题与胶囊「打印机离线」，副句「你的订单还在。打印机没连上，我们已经收到提醒，会尽快处理」，不把标题再说一遍，不写「请稍后重试」。全屏只用「稍后再来」一种说法。设备上报「打印机离线，当前无法打印。」。'
    })
  ];
  failScreens.slice().reverse().forEach((d) => insertAfter('st-unconfirmed', d));

  /* 出纸中：服务端回报失败时去这三屏（演示事件），和「打印机没有回报」去结果未确认同一种做法。 */
  {
    const pr = find('printing');
    const m0 = pr.mount;
    const demo0 = pr.demo;
    const go = { 'pf-go-paper': 'st-fail-paper', 'pf-go-fault': 'st-fail-fault', 'pf-go-offline': 'st-fail-offline' };
    pr.demo = () => demoOf({ demo: demo0 }).concat([
      { label: '演示：服务端回报失败——缺纸', ev: 'pf-go-paper' },
      { label: '演示：服务端回报失败——故障（可能卡纸）', ev: 'pf-go-fault' },
      { label: '演示：服务端回报失败——离线', ev: 'pf-go-offline' }
    ]);
    pr.mount = (el) => {
      const c0 = m0 ? m0(el) : null;
      const on = (e) => { const to = go[e.detail]; if (!to) return; const s = S(); s.pfRetry = 'blocked'; s.pfTake = 'qr'; s.pfJam = false; window.go(to); };
      el.addEventListener('proto-demo', on);
      return () => { el.removeEventListener('proto-demo', on); if (c0) c0(); };
    };
  }

  /* ───────── 2. 打印机卡纸：首页与打印扫描服务台 ───────── */
  {
    const home = find('home');
    const r0 = home.render;
    const m0 = home.mount;
    const demo0 = home.demo;
    const n0 = home.notes;
    /* 卡纸和离线在首页是同一种画法，只换字：先按离线画，再把「打印机离线」换成「打印机卡纸」。 */
    home.render = () => {
      const s = S();
      if (s.printer !== 'jam') return r0();
      s.printer = 'down';
      let h;
      try { h = r0(); } finally { s.printer = 'jam'; }
      return h.split('打印机离线').join('打印机卡纸');
    };
    home.demo = () => demoOf({ demo: demo0 }).concat(S().printer === 'jam'
      ? [{ label: '演示：打印机恢复在线', ev: 'ps-printer-ok' }]
      : [{ label: '演示：打印机卡纸（公开状态 paper_jam）', ev: 'ps-printer-jam' }]);
    home.mount = (el) => {
      const c0 = m0 ? m0(el) : null;
      const on = (e) => {
        if (e.detail === 'ps-printer-jam') S().printer = 'jam';
        else if (e.detail === 'ps-printer-ok') S().printer = 'ok';
        else return;
        refresh();
      };
      el.addEventListener('proto-demo', on);
      return () => { el.removeEventListener('proto-demo', on); if (c0) c0(); };
    };
    const JAM_HOME = '【11/19 卡纸态，地址 ?printer=jam】公开打印机状态是 paper_jam 时，顶栏胶囊「打印机卡纸」（陶土色），打印卡角标「打印机卡纸」，其余和离线态一字不差；点打印卡进卡纸版服务台（st-device-jam）。只有打印机报 DetectedErrorState=8 才算卡纸；PRINTER_ERROR 的失败任务不改首页的字。运行页打印卡里另有一行「打印机卡纸 · 上传与文件加工仍可用，出纸与扫描暂停」（homeDomainStatus.ts），离线态稿上也没画这一行，属旧差异，这次不动。';
    home.notes = {
      get does() { return n0.does; },
      get motion() { return n0.motion; },
      get keep() { return S().printer === 'jam' ? JAM_HOME + n0.keep : n0.keep; }
    };
  }

  /* 服务台卡纸版：照「设备停用：打印机缺纸」，缺纸换成卡纸；副句加一句别自己动机器。 */
  function jamHub() {
    let h = find('st-device-off').render();
    h = h.split('缺纸').join('卡纸');
    h = once(h, '补纸后再用', '恢复后再用', 'st-device-jam 复印卡');
    h = once(h, '卡纸了。打印和扫描先停，订单还在。', '卡纸了，请不要自己开机盖、拽纸。打印和扫描先停，订单还在。', 'st-device-jam 副句');
    return h;
  }
  insertAfter('st-device-off', {
    id: 'st-device-jam',
    group: '状态样式板',
    name: '设备停用：打印机卡纸（11/19 补稿）',
    notes: {
      does: '公开打印机状态确实是卡纸（paper_jam）时的打印扫描服务台：和缺纸一样，出纸和扫描先停，复印说明、到机码、手机和 U 盘上传仍可进。',
      motion: '可点的卡照常按下缩小；停用的卡按下不动。',
      keep: '对应运行页 /print-scan 的 device-off，设备短标题是卡纸（useTerminalDeviceStatus 把 paper_jam 映射成「打印机卡纸」）。胶囊「打印机卡纸 · 出纸类暂停」。版面用缺纸那一版（st-device-off），字只换「缺纸」为「卡纸」：问句「这台机器出不了纸。」，副句「卡纸了，请不要自己开机盖、拽纸。打印和扫描先停，订单还在。」，打印卡角标「打印机卡纸」、说明「打印机卡纸，这次出不了纸。文件可以先从下面传上来。」，扫描卡「一起停」，复印卡「卡纸时复印也出不了纸，恢复后再用」，到机码卡、先传稍后打印、底部标准句 2 同缺纸，问小青「卡纸了文件还要传吗？」。'
        + '改程序时要落实：运行页现在只给确定缺纸用这一版（PrintScanHomePage.tsx paperOff 只认 paperEmpty），卡纸走的是离线那一版，复印卡还写「打印机异常时复印可能也用不了」，和胶囊「打印机卡纸」不是一个说法；改成确定卡纸也用这一版。离线、别的故障、暂停接单仍用 ?printer=down#print 那一版（MFP 本身可能还能复印）。号码与服务时间从后台读，读不到不显示。'
    },
    render: jamHub
  });
  {
    const hub = find('print');
    const r0 = hub.render;
    const n0 = hub.notes;
    hub.render = () => (S().printer === 'jam' ? jamHub() : r0());
    const JAM_HUB = '【11/19 卡纸态，地址 ?printer=jam】公开打印机状态是 paper_jam 时，本屏画法同状态样式板「设备停用：打印机卡纸」（st-device-jam）。';
    hub.notes = {
      get does() { return n0.does; },
      get motion() { return n0.motion; },
      get keep() { return S().printer === 'jam' ? JAM_HUB + n0.keep : n0.keep; }
    };
  }

  /* ───────── 3. 我的打印订单：手机上还没取的单 ───────── */
  const TASKS = [
    { id: 'o1', name: '毕业生就业推荐表.pdf', when: '今天 14:12', copies: '1 份', pages: '2 页', st: '打印中', bucket: 'doing', code: '48291736' },
    { id: 'o4', name: '成绩单-2026春.pdf', when: '今天 13:05', copies: '2 份', pages: '3 页', st: '排队中', bucket: 'doing', code: '19364028' },
    { id: 'o2', name: '求职信-新媒体运营.pdf', when: '昨天 16:22', copies: '1 份', pages: '1 页', st: '已完成', bucket: 'done' }
  ];
  const PAY = '0 元（免费试运营） · 免费';
  const PLACE = '二楼服务区的 2 号机';
  const btnHtml = (cls, attrs, label) => `<button type="button" class="${cls}" ${attrs}>${label}</button>`;
  const exitCard = (attrs, illus, title, desc) => `<button type="button" class="fe-exit" ${attrs}><div>${illus}</div><div><b>${title}</b><span>${desc}</span></div></button>`;
  function feBag() {
    const s = S();
    return (s.feUi && s.feUi['my-orders']) || {};
  }
  function pickRow(kind, here) {
    const label = kind === 'file' ? '简***.pdf' : '材料包 · 3 个文件';
    const detail = kind === 'file' ? '11月18日 20:16 · 1 页' : '11月17日 18:40 · 9 页';
    const ft = kind === 'file' ? '<span class="pk-ft">PDF</span>' : `<span class="pk-ft pkg">${icon('layers', 38, 2)}</span>`;
    if (here) {
      return `<div class="pk-row" role="listitem">${ft}<div class="pk-tx"><b>${label}</b><small>${detail}</small></div>${btnHtml('btn pri pk-go', `data-go="pickup" aria-label="到这台取件 ${label}"`, '到这台取件')}</div>`;
    }
    return `<div class="pk-row" role="listitem">${ft}<div class="pk-tx"><b>${label}</b><small>${detail}</small><div class="pk-where">${icon('map', 30, 2)}<div><b>去哪台取</b><span>这笔订单不在这台机器取件，请到${PLACE}领取</span></div></div></div></div>`;
  }
  function errBox(hasTasks) {
    const busy = !!S().pkReload;
    const said = '手机上还没取的单这次没读到。' + (hasTasks ? '<span>下面已产生打印任务的订单不受影响。</span>' : '');
    return `<div class="pk-err" role="status">${icon('alert', 34, 2.2)}<p>${said}</p>${busy ? btnHtml('btn sec', 'disabled', '正在重新读取…') : btnHtml('btn sec', 'data-pk="reload"', '重新读取')}</div>`;
  }
  function taskList() {
    const b = feBag();
    const filt = b.filt || 'all';
    const open = b.open || '';
    const rows = filt === 'all' ? TASKS : TASKS.filter((r) => r.bucket === filt);
    const seg = `<div class="fe-seg">${[['all', '全部'], ['doing', '进行中'], ['done', '已完成'], ['fail', '失败'], ['cancel', '已取消']].map(([id, label]) => (id === filt
      ? `<button type="button" class="fe-seg-b on" disabled>${label}</button>`
      : `<button type="button" class="fe-seg-b" data-fe="filt" data-arg="${id}">${label}</button>`)).join('')}</div>`;
    if (!rows.length) {
      return seg + `<p class="fe-p">这个筛选下没有订单。</p><div class="fe-stack pk-exits">${exitCard('data-fe="filt" data-arg="all"', UI.checklist(120), '查看全部', '全部订单都在「全部」里')}${exitCard('data-go="print"', UI.usb(120), '去打印', '打一份新的，会新建一张打印任务')}</div>`;
    }
    const list = rows.map((r) => {
      const detail = open === r.id ? `<div class="fe-acts">${btnHtml('btn pri sm', 'data-go="my-docs"', '去我的文档再打印')}${r.bucket === 'done' ? btnHtml('btn sec sm', 'data-fe="to-fb"', '反馈问题') : ''}</div>
          <p class="fe-p">${r.copies} · ${r.pages}</p>
          <p class="fe-p">免费试运营，本单 0 元。</p>
          ${r.code ? `<p class="fe-p">到机码 ${r.code}。在到机码页输入，用来取件。订单完成或退款后，这里不再显示。</p>` : ''}
          <p class="fe-p">再打印从「我的文档」重新选择文件发起，将创建新的打印任务与订单。</p>` : '';
      return `<div class="fe-line">${btnHtml('fe-open', `data-fe="open" data-arg="${r.id}"`, `<b>${r.name}</b><small>${r.st} · ${r.when} · ${PAY}${r.code ? ' · 到机码' : ''}</small>`)}${detail}</div>`;
    }).join('');
    const few = rows.length < 5 && !open;
    const tail = few ? `<div class="fe-stack pk-exits">${exitCard('data-go="print"', UI.usb(110), '去打印', '打一份新的，会新建一张打印任务')}${exitCard('data-go="my-docs"', UI.stack(110, 3), '去我的文档', '从已保存的文件里再选一份')}</div>` : '';
    return seg + `<div class="fe-rows${few ? ' few' : ''}${open ? ' is-scroll' : ''}">${list}</div>
      <div class="remind">${icon('alert', 34, 2)}<span>进行中的订单会自动刷新。没登录时在这台机器上打的单不会进这个账号。</span></div>${tail}`;
  }
  function pendingPage(pk) {
    const hasTasks = pk === 'both' || pk === 'fail';
    const fail = pk === 'fail' || pk === 'fail-empty';
    const pick = pk === 'rows' ? [pickRow('file', true), pickRow('pkg', true)]
      : pk === 'elsewhere' ? [pickRow('file', true), pickRow('pkg', false)]
        : pk === 'both' ? [pickRow('file', true)] : [];
    const banner = btnHtml('fe-line', 'data-go="pickup"', `<b>手机上下的到店单，到机器上输到机码取件</b>${fail ? '' : '<small>还没取的手机单列在这一条下面。</small>'}`);
    const block = fail ? errBox(hasTasks) : `<div class="pk-list" role="list" aria-label="手机上还没取的单">${pick.join('')}</div>`;
    const main = hasTasks ? taskList()
      : `<div class="fe-stack pk-exits">${exitCard('data-go="print"', UI.usb(200), '去打印', 'U 盘、手机或扫描都可以')}${exitCard('data-go="my-docs"', UI.stack(170, 3), '去我的文档', '从已保存的文件里再选一份')}</div>`;
    const sub = hasTasks ? `共 ${TASKS.length} 条已产生打印任务的单` : '还没有归入账号的打印任务';
    const tabs = '<div class="fe-seg"><button type="button" class="fe-seg-b" data-go="my-docs">文档</button><button type="button" class="fe-seg-b on" disabled>订单</button></div>';
    return band({ kind: 'compact', eyebrow: '我的 · 打印订单', title: '打印订单', sub, seal: null, status: printerStatus(), back: true })
      + `<main class="body fe-fill pk-page">${tabs}${banner}${block}${main}</main>`
      + dock({ ask: '问小青：失败的订单怎么办？', pri: { label: '去打印', go: 'print' } })
      + nav('me');
  }

  {
    const mo = find('my-orders');
    const r0 = mo.render;
    const m0 = mo.mount;
    const demo0 = mo.demo;
    const n0 = mo.notes;
    const active = () => {
      const s = S();
      return !!(s.pk && s.logged && !s.fee && !s.feError && !s.feLoading);
    };
    mo.render = function () { return active() ? pendingPage(S().pk) : r0.call(this); };
    mo.demo = function () {
      return demoOf({ demo: () => (typeof demo0 === 'function' ? demo0.call(mo) : demo0) }).concat([
        { label: '演示：手机上有待取单（还没有打印任务）', ev: 'pk-rows' },
        { label: '演示：有待取单也有打印任务', ev: 'pk-both' },
        { label: '演示：有一笔不在这台取（走错机器）', ev: 'pk-elsewhere' },
        { label: '演示：待取单没读到（有打印任务）', ev: 'pk-fail' },
        { label: '演示：待取单没读到，也没有打印任务', ev: 'pk-fail-empty' },
        { label: '演示：重新读取读到了', ev: 'pk-reload-ok' },
        { label: '演示：没有待取单（回到原样）', ev: 'pk-off' }
      ]);
    };
    /* fix-me.js 的演示处理收到任何事件都会刷新本屏，刷新会摘掉同一屏上还没轮到的监听；所以本文件的监听先挂。 */
    mo.mount = function (el) {
      const onDemo = (e) => {
        const s = S();
        const ev = e.detail;
        if (ev === 'empty') { s.pk = ''; s.pkReload = false; return; }
        if (ev === 'pk-rows' || ev === 'pk-both' || ev === 'pk-elsewhere' || ev === 'pk-fail' || ev === 'pk-fail-empty') { s.pk = ev.slice(3); s.pkReload = false; s.feEmpty = false; s.feError = false; s.feLoading = false; }
        else if (ev === 'pk-reload-ok') { s.pk = s.pk === 'fail' ? 'both' : 'rows'; s.pkReload = false; }
        else if (ev === 'pk-off') { s.pk = ''; s.pkReload = false; }
        else return;
        e.stopImmediatePropagation();
        refresh();
      };
      const onClick = (e) => {
        const b = e.target.closest('[data-pk="reload"]');
        if (!b || !el.contains(b)) return;
        S().pkReload = true;
        refresh();
      };
      el.addEventListener('proto-demo', onDemo);
      el.addEventListener('click', onClick);
      const c0 = m0 ? m0.call(mo, el) : null;
      return () => { el.removeEventListener('proto-demo', onDemo); el.removeEventListener('click', onClick); if (c0) c0(); };
    };
    const PK_NOTE = {
      rows: '【11/19 有待取单、还没有打印任务，地址 ?login=1&pk=rows】待取单块下面接两张出路卡「去打印」「去我的文档」：第二张不用「输到机码取件」，因为上面横幅和每笔「到这台取件」都已经去到机码页（S15c3 第 2 条；小程序没发布时照旧「看看我的文档」）。副题照空态写「还没有归入账号的打印任务」（S15c3 第 3 条）。',
      elsewhere: '【11/19 走错机器，地址 ?login=1&pk=elsewhere】服务端判定不能在这台领（claimableHere 为假）的单也列出来，不给「到这台取件」，写「去哪台取」和「这笔订单不在这台机器取件，请到{网点的机器}领取」；网点名和机器名都没有时写「这笔订单不在这台机器取件，请到下单时选的网点领取」。「去哪台取」是标题，不是按钮。',
      both: '【11/19 有待取单也有打印任务，地址 ?login=1&pk=both】待取单块在筛选条上面，下面是已产生打印任务的单，照原来的列表；任务少于 5 条时底部接「去打印」「去我的文档」。',
      fail: '【11/19 待取单没读到，地址 ?login=1&pk=fail】只在这一块说真话：「手机上还没取的单这次没读到。下面已产生打印任务的订单不受影响。」，「重新读取」放在同一块右边，不另起一行；下面的打印任务照常显示。横幅不写小字。重新读取后进「正在重新读取…」，结果用演示事件。',
      'fail-empty': '【11/19 待取单没读到、也没有打印任务，地址 ?login=1&pk=fail-empty】句子只说「手机上还没取的单这次没读到。」（下面没有打印任务，不写「下面…不受影响」），下面接「去打印」「去我的文档」两张出路卡，不留整屏空白。改程序时要落实：运行页现在这一态只有这一块（pendingPickupExitCards 只在读到待取单时给出路卡）。'
    };
    const PK_COMMON = '这一页的出路卡（待取单下面、列表尾、筛选为空）插画列一律 240px 宽、插画居中，两张卡等高，标题左边缘对齐（S15c4 第 5 条）。待取单块对应运行页 PendingPickupSection.tsx（复用取件时间线 GET /me/print-orders/timeline?status=waiting，只读本人的手机单件和材料包，现场单不进这里）。横幅有待取单时小字改成「还没取的手机单列在这一条下面。」。每笔一张卡：左边文件类型块，中间打码后的文件名（保留首字和扩展名）或「材料包 · N 个文件」，下单时间（北京时间）和页数，能在这台领的右边一个「到这台取件」去到机码页。不显示到机码，不显示原始文件名。没有待取单时这一块不画（原来的 my-orders）。收费点位的订单页另见收费补稿，这几态按 0 元画。';
    mo.notes = {
      get does() { return n0.does; },
      get motion() { return n0.motion; },
      get keep() { return active() ? (PK_NOTE[S().pk] || '') + PK_COMMON + n0.keep : n0.keep; }
    };
  }
})();
