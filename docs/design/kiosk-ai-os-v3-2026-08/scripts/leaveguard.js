/* ============================================================
   V3 · 离场确认（LeaveGuard）· 事件委托 + 声明式标记
   ------------------------------------------------------------
   为什么要有这个文件：

     工作台里做到一半按返回，东西直接没了，没有任何确认。
     在一台公共机器上这尤其糟：用户是站着操作的，返回键就在拇指旁边，
     误触一次就要从上传简历、扫描、逐题作答重来一遍。
     （blockers.md A8）

   三条设计取舍：

   1) **必须说清丢的是什么，不能只说「未保存的更改」。**
      「未保存的更改」是给程序员看的话。用户需要知道的是
      「已上传的简历、刚生成的 3 条改写建议」——具体到他脑子里那个东西。
      所以 data-lose 是必填；没写就不拦截，宁可不拦也不弹一句空话。

   2) **「存下来再走」只在页面真有这个能力时才出现。**
      没有真实落点却给一个存的按钮，是伪造能力（CLAUDE.md §9）。
      页面用 data-keep 指明落点；没写就只有「留下」和「直接离开」两个选择。

   3) **纯事件委托，不改页面 DOM。**
      已有的返回键、导航链接一行不动就能生效。

   ── 用法 ────────────────────────────────────────────────
   在 .screen 上声明「哪些阶段算有未存的东西」和「丢的是什么」：

     <div class="screen" data-stage="s3"
          data-guard-at="s2 s3 s4"
          data-guard-lose="已上传的简历、刚生成的 3 条改写建议"
          data-guard-keep="存进「我的文档」">

   也可以按阶段分别写，精确到每一步丢什么：

     <div class="screen" … data-guard-lose-s2="刚扫进来的 6 页原件">

   动态场景（例如只有真上传了文件才算脏）可以自己判定：

     window.v3Guard.dirty(function () { return !!state.file })

   API：
     v3Guard.dirty(fn)      自定义脏判定，返回 true 表示有未存的东西
     v3Guard.check(href)    手动问一次，返回 Promise<boolean>（true = 可以走）
     v3Guard.off()          本页关闭拦截（例如已经真的存好了）
   ============================================================ */
;(function (window, document) {
  'use strict'
  if (window.v3Guard) return

  var screen = null
  var dirtyFn = null
  var disabled = false
  var layer = null
  var pending = null

  function scr () {
    if (!screen) screen = document.querySelector('.screen')
    return screen
  }

  /* ---------- 脏判定 ----------
     自定义判定优先；否则看当前阶段在不在 data-guard-at 里。 */
  function isDirty () {
    if (disabled) return false
    var s = scr(); if (!s) return false
    if (typeof dirtyFn === 'function') {
      try { if (!dirtyFn()) return false } catch (e) { return false }
      return !!loseText()
    }
    var at = (s.getAttribute('data-guard-at') || '').split(/\s+/).filter(Boolean)
    if (!at.length) return false
    var cur = s.getAttribute('data-stage') || ''
    if (at.indexOf(cur) < 0) return false
    return !!loseText()
  }

  /* 丢的是什么。按阶段找更精确的那条，没有就用通用的。
     一个字都没有就返回空 —— 上层据此放弃拦截，不弹空话。 */
  function loseText () {
    var s = scr(); if (!s) return ''
    var cur = s.getAttribute('data-stage') || ''
    return (cur && s.getAttribute('data-guard-lose-' + cur)) ||
           s.getAttribute('data-guard-lose') || ''
  }
  function keepText () {
    var s = scr(); if (!s) return ''
    var cur = s.getAttribute('data-stage') || ''
    return (cur && s.getAttribute('data-guard-keep-' + cur)) ||
           s.getAttribute('data-guard-keep') || ''
  }

  /* ---------- 弹层 ---------- */
  function build () {
    if (layer) return layer
    layer = document.createElement('div')
    layer.className = 'lg-mask'
    layer.hidden = true
    layer.setAttribute('role', 'dialog')
    layer.setAttribute('aria-modal', 'true')
    layer.setAttribute('aria-labelledby', 'lg-t')
    layer.innerHTML =
      '<div class="lg-box">' +
        '<div class="lg-hd"><span class="lg-ic" aria-hidden="true"></span>' +
        '<b id="lg-t">这一步的东西还没存下来</b></div>' +
        '<p class="lg-lose">离开就没了：<b class="lg-what"></b></p>' +
        '<div class="lg-acts">' +
          '<button type="button" class="lg-btn lg-stay">留在这一步</button>' +
          '<button type="button" class="lg-btn lg-keep" hidden></button>' +
          '<button type="button" class="lg-btn lg-go">直接离开，不要了</button>' +
        '</div>' +
      '</div>'
    document.body.appendChild(layer)

    layer.addEventListener('click', function (e) {
      if (e.target === layer) return close(false)          // 点遮罩 = 留下（更安全的默认）
      if (e.target.closest('.lg-stay')) return close(false)
      if (e.target.closest('.lg-go')) return close(true)
      var k = e.target.closest('.lg-keep')
      if (k) {
        /* 「存下来」交回页面处理：派事件，页面自己去落地。
           这里**不**假装存好了 —— 没有真实落点就不该有这个按钮。 */
        var ev = new CustomEvent('lg:keep', { detail: { href: pending && pending.href }, cancelable: true })
        var ok = layer.dispatchEvent(ev)
        if (ok) close(true)
      }
    })
    document.addEventListener('keydown', function (e) {
      if (!layer.hidden && (e.key === 'Escape')) close(false)
    })
    return layer
  }

  function open (href) {
    var l = build()
    l.querySelector('.lg-what').textContent = loseText()
    var kt = keepText()
    var kb = l.querySelector('.lg-keep')
    if (kt) { kb.hidden = false; kb.textContent = kt + '，再离开' }
    else { kb.hidden = true }
    l.hidden = false
    /* 焦点给「留在这一步」：默认停留，误触时最不容易造成损失 */
    setTimeout(function () { l.querySelector('.lg-stay').focus() }, 0)
    return new Promise(function (resolve) { pending = { href: href, resolve: resolve } })
  }

  function close (go) {
    if (layer) layer.hidden = true
    var p = pending; pending = null
    if (p) p.resolve(!!go)
  }

  /* ---------- 拦截 ----------
     只拦「离开本页」的动作。页内阶段回退（data-go）不拦 —— 那不是离场。 */
  document.addEventListener('click', function (e) {
    if (pending) return
    var a = e.target.closest('a[href], .backbtn, [data-leave]')
    if (!a) return
    if (a.hasAttribute('data-go')) return
    if (a.closest('.lg-mask')) return
    var href = a.getAttribute('href') || ''
    if (!href || href.charAt(0) === '#') {
      if (!a.classList.contains('backbtn') && !a.hasAttribute('data-leave')) return
    }
    /* 同页换阶段的链接（?stage=…）不算离场 */
    if (href && href.split('?')[0] &&
        href.split('?')[0] === location.pathname.split('/').pop()) return
    if (!isDirty()) return

    e.preventDefault()
    e.stopPropagation()
    open(href).then(function (go) {
      if (!go) return
      disabled = true                                   // 用户已经明确说不要了
      if (href && href.charAt(0) !== '#') location.href = href
      else if (typeof window.v3SyncBack === 'function') window.v3SyncBack()
    })
  }, true)                                              // 捕获阶段：早于页面自己的处理

  window.v3Guard = {
    dirty: function (fn) { dirtyFn = fn },
    check: function (href) { return isDirty() ? open(href || '') : Promise.resolve(true) },
    off: function () { disabled = true },
    on: function () { disabled = false },
    isDirty: isDirty
  }
})(window, document)
