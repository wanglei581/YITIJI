/* ============================================================
   阶段机（stages）· 给打印 / 扫描 / 简历这类多阶段工作台
   ------------------------------------------------------------
   一页多阶段，不换页、不换栅格：`.screen[data-stage="s3"]`
   元素用 `data-at="s2 s3"` 声明自己在哪些阶段出现。
   与四态（data-when）互不干扰：两者都命中才显示。
   ?stage=s4 可直接进入指定阶段。
   ============================================================ */
;(function () {
  var screen = document.querySelector('.screen')
  if (!screen || !screen.hasAttribute('data-stage')) return
  var q = new URLSearchParams(location.search)

  function apply (st) {
    screen.setAttribute('data-stage', st)
    if (window.v3ApplyVisibility) window.v3ApplyVisibility()
    // 阶段轨状态。
    // 只数**当前可见**的站：同一站可能有多个变体（例如收银在免费单里是"跳过"态），
    // 把隐藏的也数进去会把总步数虚报（曾经报成 4/8，实际 7 步）。
    var rs = []
    var all = screen.querySelectorAll('.rstep')
    for (var i = 0; i < all.length; i++) if (!all[i].hidden) rs.push(all[i])
    var order = []
    for (var j = 0; j < rs.length; j++) order.push(rs[j].getAttribute('data-go'))
    var cur = order.indexOf(st)
    for (var k = 0; k < rs.length; k++) {
      rs[k].classList.remove('rstep--now', 'rstep--done')
      if (k < cur) rs[k].classList.add('rstep--done')
      if (k === cur) rs[k].classList.add('rstep--now')
      rs[k].setAttribute('aria-current', k === cur ? 'step' : 'false')
    }
    var cnt = screen.querySelector('[data-rail-count]')
    if (cnt && cur > -1) cnt.innerHTML = '第 <b>' + (cur + 1) + '</b> / ' + rs.length + ' 步'
    if (window.v3Audit) requestAnimationFrame(window.v3Audit)
  }

  screen.addEventListener('click', function (e) {
    var b = e.target.closest('[data-go]')
    if (b) apply(b.getAttribute('data-go'))
  })

  window.v3Stage = apply

  /* ── ?stage= 必须校验 ────────────────────────────────────────────
     原来是 apply(q.get('stage') || …)，一个字都不验。
     传一个这一页不存在的阶段（打印的二维码过期、旧书签、手抄错一个字母），
     applyVisibility() 就把所有 data-at 门控的内容全部隐藏 —— **整屏白**。
     全站 31 个多阶段页都是这样，只有 42 / 43 自己写了白名单兜底。
     白屏在一体机上尤其糟：用户面前是一块什么都没有的屏，连返回键都找不到。

     修法刻意保守：只做校验与回落，**不注入任何 DOM**。
     （教训来自同一天：往页脚加了一条 64px 的信息条，把首页「查看招聘会」
     挤到裁切线以下、点不动。共享脚本往页面里塞东西的代价很难预估。）

     回落到这一页自己声明的默认阶段；请求过的值记在 data-stage-fallback 上
     并 console.warn —— 信息不丢，页面若要告诉用户「这条链接指的那一步不存在」，
     可以自己读这个属性来显示，由页面决定怎么说。 */
  function validStages () {
    var set = {}
    document.querySelectorAll('[data-at]').forEach(function (el) {
      String(el.getAttribute('data-at') || '').split(/\s+/).forEach(function (v) { if (v) set[v] = 1 })
    })
    return set
  }

  /* 回落目标取**阶段轨的第一步**，不取 screen 当前的 data-stage。
     实测发现后者会被污染：只要有任何代码先一步改过这个属性，
     回落就会落到那个被改过的值上（测试里出现过「已回落到 zzz」这种自相矛盾）。
     而且语义上也该是第一步 —— 一条指向不存在阶段的链接，
     把用户放在流程开头才是对的，放在半路等于换了一种走错。 */
  function firstStage () {
    var rail = document.querySelector('.rail, .spine-rail, [data-rail]')
    /* **没有阶段轨就不要猜。**
       第一版写的是 (rail || document)，在没有轨的页面上退化成
       「扫全文档第一个 [data-go]」—— 而那通常是正文里的某个跳转按钮，
       不是流程的第一步。实测后果：裸开 03 身份门落在 s2「输入手机号」，
       三选一那一屏根本没出现；裸开 05 手机接力落在 s2 一屏正在上传的进度条，
       还带着两个不属于用户的文件名 —— 既是错方向，又是伪造的进行态。
       没有轨时返回 null，交回页面自己在 HTML 里声明的 data-stage。 */
    if (!rail) return null
    var ok = validStages()
    var found = null
    rail.querySelectorAll('[data-go]').forEach(function (el) {
      if (found) return
      var v = el.getAttribute('data-go')
      if (v && ok[v]) found = v
    })
    return found
  }

  var fallback = firstStage() || screen.getAttribute('data-stage') || 's1'
  var want = q.get('stage')
  if (want) {
    var ok = validStages()
    if (!ok[want]) {
      screen.setAttribute('data-stage-fallback', want)
      try {
        console.warn('[v3] ?stage=' + want + ' —— 这一页没有这个阶段，已回落到 ' + fallback +
                     '。本页可用阶段：' + Object.keys(ok).join(' / '))
      } catch (e) {}
      want = null
    }
  }
  apply(want || fallback)
})()
