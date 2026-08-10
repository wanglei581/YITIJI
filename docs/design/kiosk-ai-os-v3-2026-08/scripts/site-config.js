/* ============================================================
   V3 · 站点配置与计价 · 单一真源
   ------------------------------------------------------------
   为什么有这个文件：

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
     <span data-site-price="15"></span>                →  3.00 元（15 印刷面，黑白）
     <span data-site-price="15" data-site-mode="color"></span>
     <span data-site-time="hint"></span>               →  3 分钟
     window.v3Price(15)            → 3
     window.v3Price(15, 'color')   → 22.5
     window.v3SiteApply(root)      → 手动重扫（改了 data-site 之后调）
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

    /* 计价 —— 单位一律是「印刷面」，不是「页」。
       双面打印一张纸两个印刷面，算两面。这条口径必须全站一致。 */
    price: {
      bwPerFace: 0.20,      // A4 黑白，每印刷面
      colorPerFace: 1.50,   // A4 彩色，每印刷面
      unitLabel: '印刷面'
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
     faces = 印刷面数（已含份数）。返回数值，元。
     刻意不做「页」的重载：一旦允许传页数，双面就会算错一半。 */
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
