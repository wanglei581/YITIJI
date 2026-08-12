/* ============================================================
   V3 · 站点配置与计价 · 单一真源
   ------------------------------------------------------------
   ⚠️ 先读这一段：本文件里的价格**不是产品常量**

   `price` 下面的数字是**本机从后端拉到的配置快照**：
       GET /api/v1/print/price-config
       （源码注释原文：「公开只读价目（Kiosk 展示价唯一来源，匿名可读）」）
   后台改价走的是另一条路径，且必审计：
       PUT /admin/billing/price-config/:serviceKey
       （源码注释原文：「改价/启停（唯一合法改价路径，必审计）」）

   也就是说：**运营在后台改了价，屏上就得跟着变**。谁把 0.20 抄进页面里，
   谁就在下一次改价时把那一页变成假的。所以设计稿里所有金额只有两种合法写法：
     · 静态文案 → data-site-price / data-site-unit（本文件在 DOMContentLoaded 时填）
     · JS 计算  → window.v3Price()
   页面里**不许**再出现第三种：手抄一个 0.20 或 0.2。

   ── 拉取失败怎么办：PRICE_CONFIG_UNAVAILABLE ────────────────
   生产上 GET /print/price-config 拉不到时，**不要退回一个看起来像真的默认价**——
   那会让用户按错的价格做决定。正确处置是走 PRICE_CONFIG_UNAVAILABLE：
     · 金额位显示「价格暂不可用」，不显示任何数字；
     · 不阻断浏览与 AI 服务（那些本来就不收费），只挡住「去打印/去支付」这一步；
     · 引导用户看现场公示价或问工作人员，并以打印工作台核价为准。
   本设计稿是静态原型，site-config.js 一定加载得到，所以下面写的是快照值；
   页面 JS 里读不到 window.V3_SITE 时的那一行 fallback 只是「脚本没加载」的兜底，
   **不是**「后端拉取失败」的兜底 —— 后者必须由前端实现按上面这段做。

   ── 计价口径（2026-08-11 产品拍板，与后端 PriceConfig.unit 对齐）──
   后端 PriceConfig.unit 的取值只有 'page' | 'copy' | 'item' 三个，
   其中 **'page' 的真实含义是「所选文档内容页」**，公式：
       计费数量 = 所选文档页数 × 份数
   两条推论，屏上必须说清楚，否则用户会以为选双面能省钱：
     · **双面打印不减少计费数量** —— 它减少的是用纸张数；
     · **「一面排 N 页」也不减少计费数量** —— 同上，省纸不省钱。
   屏上统一叫「**计费页**」，解释语统一用「按所选文档页计费」，
   并在合适处补一句「双面只影响用纸张数，不减少计费页数」。
   ⚠️ 不要再引入「印刷面」这个单位，也不要把 page 口头解释成别的意思 ——
      本文件早期版本按「印刷面」计价（双面算 2 面），该口径已作废。

   ── 为什么有这个文件（历史）────────────────────────────────

   1) 单价此前全站有三套写法（0.20 元/面、1.50 元/面、0.30 元/页），
      履约页按「页」算、打印台按「印刷面」算，双面时会差一倍，
      而且 41 的账加不拢（已付 6.00，明细只有 3.00）。
      钱不能各页各算 —— 所有金额一律走 v3Price()。

   2) 「01 号机」「市人力资源市场 A 馆」「服务台在哪」「客服电话」
      这类值是**站点配置**，不是页面内容。生产由服务端按终端下发
      （interface-handoff.md §4C / blockers.md B5）。设计稿写死它们，
      等于把某一台机器的现场事实当成全网事实 —— 换个场地就全错。

   3) 会话时钟此前四处不一致（README 90/120 秒、40 与 04 写 4 分钟、
      23 与 32 写 5 分钟）。安全时限不一致，用户就无法预期自己的文件
      什么时候被清掉。这里定一份，页面只读不写。

   ── 缺配置兜底口径（重要）────────────────────────────────
   值为空时**不编一个像真的**。页面显示「本机未配置」并给出可行动作
   （去问现场工作人员），而不是显示「正门左手第一窗」这种看起来
   像事实、换个场地就是错的字符串。宁可承认没配，不可误导用户跑空。

   ── 用法 ──────────────────────────────────────────────
     <span data-site="terminalNo"></span>              →  01 号机
     <span data-site="serviceDesk"></span>             →  未配置时落到兜底文案
     <span data-site-price="15"></span>                →  3.00 元（15 计费页，黑白）
     <span data-site-price="15" data-site-mode="color"></span>
     <span data-site-unit="bw"></span>                 →  0.20 元（单价本身，不含数量）
     <span data-site-unit="color"></span>              →  1.50 元
     <span data-site-time="hint"></span>               →  3 分钟
     window.v3Price(15)            → 3
     window.v3Price(15, 'color')   → 22.5
     window.v3SiteApply(root)      → 手动重扫（改了 data-site 之后调）

   页面自己算钱时（JS 里），照 06 打印台的写法取单价，别再抄数字：
     function bwUnit () { var S = window.V3_SITE; return S ? S.price.bwPerFace : 0.2 }
   —— 末尾那个 0.2 只在 site-config.js 没加载成功时兜底，见上文
      PRICE_CONFIG_UNAVAILABLE 段；生产实现不许这么兜后端拉取失败。
   ============================================================ */
(function () {
  'use strict'

  /* ── 站点配置（生产由服务端下发；此处为设计稿示例值）────────── */
  var SITE = {
    /* 终端身份 */
    terminalNo: '01 号机',
    venue: '市人力资源市场 A 馆',
    brand: '职易达',

    /* 现场服务 —— 故意留空两项，用来在设计稿里演示「缺配置兜底」长什么样。
       生产必须由服务端下发；下发不到就保持空，页面照兜底文案显示。 */
    serviceDesk: '',        // 服务台位置，例：A 馆正门左手第一窗
    serviceHours: '',       // 服务时间，例：09:00–17:00
    supportPhone: '',       // 现场客服/运维电话
    peerTerminal: '',       // 就近另一台可用终端，例：B 馆入口右手 03 号机

    /* ── 计价 ──────────────────────────────────────────────
       ⚠️ 下面两个数字是 GET /api/v1/print/price-config 的**快照**，不是产品常量。
          后台（PUT /admin/billing/price-config/:serviceKey）一改，这里就该跟着变。
          拉不到时按 PRICE_CONFIG_UNAVAILABLE 处理，见文件头部。

       ⚠️ 2026-08-11 整改 ⑧：这两个值是**原型样例值，不是已经拍板的定价**。
          目前三套数值并存：开发种子 0.20 / 0.50（种子自陈「开发默认价，非正式价」）、
          后端方案建议 0.5 / 1.5、本设计稿快照 0.20 / 1.50。
          **正式价格以生产 PriceConfig 为准。**
          这一轮不改数值 —— 全站几十处对账金额都按 0.20 算过，改一个数会一起错。

       这两项是**打印**单价，单位一律是「计费页」：计费数量 = 所选文档页数 × 份数。
       双面打印与「一面排 N 页」都**只省纸、不省钱**，不减少计费页数。

       ⚠️ 2026-08-11 整改 ⑥：「计费页」统一的是**打印链**，
          准确说法是「全站所有**打印金额位**一律称计费页」，不强套别的服务：
            · 复印（未来）→ 「计费张 / 实际出纸张数」，身份证复印两面合成一张纸；
            · 扫描（未来）→ 「扫描页」，且扫描的「双面」会让页数与金额都翻倍。
          将来加复印/扫描单价时**另起 key**，不要复用下面这两个。

       key 名 bwPerFace / colorPerFace 是早期「印刷面」口径留下的历史名字，
       06 打印台按这两个 key 读单价，改名会把那边弄坏，所以**保留 key 名**；
       它们现在的含义一律是「每计费页单价（元）」。 */
    price: {
      bwPerFace: 0.20,      // A4 黑白，每计费页（元）—— 后台可改
      colorPerFace: 1.50,   // A4 彩色，每计费页（元）—— 后台可改
      unitLabel: '计费页',
      /* 屏上要用到的两句解释语，放这儿避免各页各写一版 */
      basisNote: '按所选文档页计费',
      duplexNote: '双面只影响用纸张数，不减少计费页数'
    },

    /* ── 补贴 / 免费额度 / 卡券 / 活动 ──────────────────────
       ⚠️ 这一块**全部由后台配**，页面不许写死，也不许假设它一定存在。

       口径（2026-08-11 产品拍板）：
       · 单位是「**次**」不是「页」—— 后端核销语义是「一次免掉一整单，额度扣 1」，
         对应的是免单券，不是页数额度。旧文案「每月 20 页免费额度」已作废。
       · **补贴不是全场通用**。用户自己带文件来单纯打印 → 走正常价格，不给补贴。
         免费/补贴只在**求职相关的特定场景**里出现（简历、求职材料、
         招聘会资料、政策申请材料等），具体范围也是后台配的。
       · 因此**通用打印类页面**（07 扫描台、08 文件工具、39 打印域、02、04 等）
         不得出现「有免费额度 / 可用免费次数」这类暗示 —— 那些页就是正常价格。
       · 页面上凡是列适用范围的地方，都要标清「适用范围由后台配置下发」，
         不能写成看起来像产品规则的固定清单。

       下面留空 = 本机没拿到配置。空值时页面**不显示任何免费/补贴字样**，
       按正常价格走（这比编一个额度安全：宁可少承诺，不可承诺了兑不出）。
       注：24-benefits 权益页有自己的一套渲染，不从这里取值，别在这里替它定死。 */
    benefit: {
      freeTimesPerMonth: null,   // 每月免费打印**次**数；null = 本机未配置
      freeScopeNote: '',         // 适用范围说明，由后台下发，例：简历 / 招聘会资料
      resetNote: ''              // 重置时点说明，由后台下发
    },

    /* 会话时钟（秒）—— 与手机接力二维码是**两口不同的钟**，不要混用 */
    session: {
      hintSec: 180,         // 无操作满 3 分钟 → 出提示条并开始倒计时
      graceSec: 60,         // 提示后再 60 秒无响应 → 清空
      handoffQrSec: 300     // 手机扫码上传的二维码有效期，另一口钟
    }
  }

  /* ── 缺配置兜底文案 ──────────────────────────────────────
     每条都满足两个条件：① 不假装知道 ② 给一个用户真能执行的下一步。 */
  var FALLBACK = {
    serviceDesk: '服务台位置本机未配置 · 可问现场工作人员',
    serviceHours: '服务时间本机未配置 · 以现场公示为准',
    supportPhone: '本机未配置客服电话 · 请找现场工作人员',
    peerTerminal: '本机未配置就近终端 · 可问现场工作人员'
  }

  function val (key) {
    var v = key.split('.').reduce(function (o, k) {
      return (o && o[k] !== undefined) ? o[k] : undefined
    }, SITE)
    if (v === undefined || v === null || v === '') {
      return FALLBACK[key] !== undefined ? FALLBACK[key] : ''
    }
    return String(v)
  }

  /* ── 计价 ────────────────────────────────────────────────
     第一个参数 = **计费页数**，即「所选文档页数 × 份数」。
     不要传纸张数，也不要按单双面折算 —— 双面和「一面排 N 页」都不影响这个数，
     它们只改用纸张数。返回数值，单位元。

     形参名保持 faces 不变：06 打印台正在用 v3Price()，改签名会把那边弄坏。
     名字是历史遗留（早期按「印刷面」计价），含义以本注释为准。 */
  function price (faces, mode) {
    var n = Number(faces)
    if (!isFinite(n) || n < 0) return 0
    var unit = (mode === 'color') ? SITE.price.colorPerFace : SITE.price.bwPerFace
    return Math.round(n * unit * 100) / 100
  }

  function priceText (faces, mode) {
    return price(faces, mode).toFixed(2) + ' 元'
  }

  /* 分钟化：只给整分钟或「X 分 Y 秒」，不给「180 秒」这种用户要心算的写法 */
  function mins (sec) {
    var s = Number(sec) || 0
    if (s % 60 === 0) return (s / 60) + ' 分钟'
    return Math.floor(s / 60) + ' 分 ' + (s % 60) + ' 秒'
  }

  var TIME = {
    hint: function () { return mins(SITE.session.hintSec) },
    grace: function () { return SITE.session.graceSec + ' 秒' },
    clear: function () { return mins(SITE.session.hintSec + SITE.session.graceSec) },
    qr: function () { return mins(SITE.session.handoffQrSec) }
  }

  /* ── DOM 应用 ───────────────────────────────────────────── */
  function apply (root) {
    var scope = root || document
    var i, el, list

    list = scope.querySelectorAll('[data-site]')
    for (i = 0; i < list.length; i++) {
      el = list[i]
      var key = el.getAttribute('data-site')
      var text = val(key)
      el.textContent = text
      /* 兜底文案给个记号，页面可以用 [data-site-missing] 换个语气或图标 */
      if (FALLBACK[key] !== undefined && !String(key.split('.').reduce(function (o, k) {
        return (o && o[k] !== undefined) ? o[k] : undefined
      }, SITE) || '')) el.setAttribute('data-site-missing', '')
      else el.removeAttribute('data-site-missing')
    }

    list = scope.querySelectorAll('[data-site-price]')
    for (i = 0; i < list.length; i++) {
      el = list[i]
      el.textContent = priceText(el.getAttribute('data-site-price'), el.getAttribute('data-site-mode'))
    }

    list = scope.querySelectorAll('[data-site-unit]')
    for (i = 0; i < list.length; i++) {
      el = list[i]
      el.textContent = (el.getAttribute('data-site-unit') === 'color'
        ? SITE.price.colorPerFace : SITE.price.bwPerFace).toFixed(2) + ' 元'
    }

    list = scope.querySelectorAll('[data-site-time]')
    for (i = 0; i < list.length; i++) {
      el = list[i]
      var fn = TIME[el.getAttribute('data-site-time')]
      if (fn) el.textContent = fn()
    }
  }

  window.V3_SITE = SITE
  window.v3Price = price
  window.v3PriceText = priceText
  window.v3SiteVal = val
  window.v3SiteTime = TIME
  window.v3SiteApply = apply

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { apply() })
  } else {
    apply()
  }
})()
