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
  apply(q.get('stage') || screen.getAttribute('data-stage') || 's1')
})()
