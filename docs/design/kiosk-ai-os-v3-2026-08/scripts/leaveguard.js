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
  /* 高水位闩：本次进入这一页之后，是否曾经处在「有未存东西」的阶段。
     见下面 isDirty() 里的长注释（blockers.md A25）。 */
  var everDirty = false
  var latchLose = ''

  function scr () {
    if (!screen) screen = document.querySelector('.screen')
    return screen
  }

  /* 当前阶段本身是否被 data-guard-at 列为「有未存的东西」 */
  function guardedNow () {
    var s = scr(); if (!s) return false
    var at = (s.getAttribute('data-guard-at') || '').split(/\s+/).filter(Boolean)
    if (!at.length) return false
    return at.indexOf(s.getAttribute('data-stage') || '') > -1
  }

  /* 每次阶段变化都记一笔：进过受保护阶段就把闩扣上，并记住**那一刻**
     丢的是什么 —— 退回第 1 步之后 data-guard-lose-<阶段> 已经取不到了，
     没有这一份就只能弹一句空话。 */
  function noteStage () {
    if (disabled) return
    if (!guardedNow()) return
    var s = scr(); if (!s) return
    var cur = s.getAttribute('data-stage') || ''
    var t = (cur && s.getAttribute('data-guard-lose-' + cur)) ||
            s.getAttribute('data-guard-lose') || ''
    if (!t) return
    everDirty = true
    latchLose = t
  }

  /* ---------- 脏判定 ----------
     自定义判定优先；否则看当前阶段在不在 data-guard-at 里 —— **或者**本次
     进页之后曾经在里面过。

     为什么要加后半句（blockers.md A25）：
       「有没有未存的东西」是**这一次会话攒下了什么**的属性，不是「此刻停在
       第几步」的属性。退一个阶段并不会把已经扫进来的 3 页原件删掉，页面上
       也没有任何一处「撤销」能删掉它。可原来的判据只看当前阶段，于是
       从 s3 退到 s2 之后 isDirty() 立刻变 false，再按一次返回就静默走人。
       实测三次按键：s3 → s2（不弹）→ s1（不弹）→ 直接跳走（不弹）。
     闩只在两种情况下解开：页面明说已经存好了（v3Guard.off()），
     或者用户自己选了「直接离开，不要了」。

     刻意**不**把闩套到 dirtyFn 那一支：页面自己实现了判定，就以页面为准 ——
     它说「文件已经被删了、没什么可丢的」时，不该被闩推翻。 */
  function isDirty () {
    if (disabled) return false
    var s = scr(); if (!s) return false
    if (typeof dirtyFn === 'function') {
      try { if (!dirtyFn()) return false } catch (e) { return false }
      return !!loseText()
    }
    if (!guardedNow() && !everDirty) return false
    return !!loseText()
  }

  /* 丢的是什么。按阶段找更精确的那条，没有就用通用的，
     都没有就用闩记下的那一份（已经退出受保护阶段的情形）。
     一个字都没有就返回空 —— 上层据此放弃拦截，不弹空话。 */
  function loseText () {
    var s = scr(); if (!s) return ''
    var cur = s.getAttribute('data-stage') || ''
    return (cur && s.getAttribute('data-guard-lose-' + cur)) ||
           s.getAttribute('data-guard-lose') || latchLose || ''
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
           这里**不**假装存好了 —— 没有真实落点就不该有这个按钮。

           ⚠ 2026-08-11 实测记录（本轮未修，超出本次授权文件范围）：
           全站 `grep -rn "lg:keep"` 除本文件外**零个监听**。也就是说 07/09/10/12
           这四页写了 data-guard-keep，但没有任何一页在 lg:keep 上 preventDefault()
           并真的落盘 —— 按下「…，再离开」的结果是 ok===true → close(true) → 直接跳走，
           东西并没有存下来。契约本身是对的（页面接了就 preventDefault、自己去存），
           缺的是四个页面各自的实现；09/10 不在本轮可改文件内，所以只留证据不动它。
           下一轮要么补上四页的监听，要么按本文件开头第 2 条取舍撤掉这四处声明。 */
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
     只拦「离开本页」的动作。页内阶段回退（data-go / 返回键退一步）不拦 ——
     那不是离场，把返回键做成「永远弹一次窗」比不拦更糟。

     ── 监听为什么挂在 window 而不是 document（blockers.md A25）──────────
     stage.js 也在 document 的**捕获**阶段听点击，用来把返回键实现成「退一个
     阶段」。同一个节点上，捕获监听按注册先后跑；stage.js 先加载、先注册，
     于是它先把 data-stage 退掉，本文件再跑时读到的已经是退完之后的阶段。
     捕获阶段的传播路径是 window → document → … ，所以挂到 window 上就永远
     早于 document，**与两个文件谁先加载无关**（不靠 stopImmediatePropagation
     这种依赖注册顺序的把戏）。
     拿到「阶段还没被动过」的现场之后，再问 stage.js：这一次按下去到底是退
     阶段还是离场。 */
  window.addEventListener('click', function (e) {
    var a = e.target.closest('a[href], .backbtn, [data-leave]')
    if (!a) return
    if (a.closest('.lg-mask')) return                   // 弹层自己的三个按钮，放行
    /* 弹层已经开着时，把底下所有「会离开本页」的点击**吃掉**，不是 return。
       原来这里是 `if (pending) return` —— 不拦也不 preventDefault，于是那一次
       点击带着 <a href> 的默认行为直接走掉。实测：弹层开着再按一次返回键，
       仍然跳去 39-print-hub.html。遮罩在视觉上盖住了整屏，所以手指点不到，
       但连点、触控抖动、以及任何合成事件都能穿过去 ——
       「无论按几次都不会静默离开」不能靠遮罩挡得住手来保证。 */
    /* 同步再记一次现场。MutationObserver 的回调是**微任务**，页面若在同一个
       tick 里先改阶段、再填 data-guard-lose-*（20 面试舱就是这么写的），
       紧跟着的那次点击有可能赶在回调之前。这一行让闩不依赖回调时机。
       位置必须在「会不会退阶段」判断**之前** —— 退阶段那一支是直接 return 的，
       放在后面就会漏掉「从受保护阶段退出去」这一步的现场。 */
    noteStage()
    if (pending) { e.preventDefault(); e.stopPropagation(); return }
    if (a.hasAttribute('data-go')) return
    /* 这一次返回会被 stage.js 接管成「退一个阶段」→ 页内导航，不是离场 */
    if (typeof window.v3BackWillRetreat === 'function' && window.v3BackWillRetreat(a)) return
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
      everDirty = false; latchLose = ''
      if (href && href.charAt(0) !== '#') location.href = href
      else if (typeof window.v3SyncBack === 'function') window.v3SyncBack()
    })
  }, true)                                              // 捕获阶段：早于页面自己的处理

  /* 阶段一变就记一笔。用 MutationObserver 而不是包一层 v3Stage()：
     改 data-stage 的地方有四处（v3Stage、stage.js 的返回键、页面自己的脚本、
     回归台的驱动），包哪一个都会漏掉另外三个。
     **不加 attributeFilter**：20 面试舱的 data-guard-lose-* 是它自己 render()
     按真实作答题数写上去的，写的时机不一定早于阶段切换 —— 只盯 data-stage
     会在「阶段先变、文案后填」的顺序下漏掉这一页。全属性监听的代价只是
     多跑几次 getAttribute。 */
  function watch () {
    var s = scr(); if (!s) return
    noteStage()
    if (typeof window.MutationObserver !== 'function') return
    new window.MutationObserver(noteStage).observe(s, { attributes: true })
  }
  if (document.querySelector('.screen')) watch()
  else document.addEventListener('DOMContentLoaded', watch)

  window.v3Guard = {
    dirty: function (fn) { dirtyFn = fn },
    check: function (href) { return isDirty() ? open(href || '') : Promise.resolve(true) },
    /* 页面真的把东西存下来了才调这个：连高水位闩一起解开，
       否则「已经存好」的页面还会被闩着弹一次假警报。 */
    off: function () { disabled = true; everDirty = false; latchLose = '' },
    on: function () { disabled = false },
    isDirty: isDirty
  }
})(window, document)
