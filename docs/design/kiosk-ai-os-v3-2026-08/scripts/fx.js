/* ============================================================
   V3 · 动效行为层
   ------------------------------------------------------------
   1) 神经连线：量出 orb 与办理单的真实坐标后连线（版面变了也不会错位）
   2) 目标输入打字机：轮播示例，告诉用户"能说什么"
   3) 生成序列：点「排出办理顺序」→ 盘点 → 逐条写入步骤 → 主按钮待命
   4) 触点：光斑跟手 + 按下涟漪（一体机没有鼠标，手感全靠这个）
   5) 数字滚动：[data-count] 到位动画
   全部动效在 prefers-reduced-motion 下自动跳过。
   ============================================================ */
;(function () {
  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches
  var screen = document.querySelector('.screen')
  if (!screen) return

  /* ---------- 1. 神经连线 ---------- */
  function drawLink () {
    var orb = screen.querySelector('[data-adv]') || screen.querySelector('.hero-orb .orb:not([hidden])')
    var band = screen.querySelector('.band')
    if (!screen.querySelector('.hero')) return       // V4 印务台版面不走长连线
    var old = screen.querySelector('.fx-link')
    if (old) old.remove()
    if (!orb || !band) return

    var s = screen.getBoundingClientRect()
    var o = orb.getBoundingClientRect()
    var b = band.getBoundingClientRect()
    var x1 = o.left - s.left + o.width / 2
    var y1 = o.bottom - s.top + 8           // 卡片下方一点，留出"发出"的呼吸
    var x2 = b.right - s.left - 118          // 落到步骤列上方
    var y2 = b.top - s.top

    if (y2 - y1 < 16) return                 // 距离太近就不画，避免变成一团
    var cy = (y1 + y2) / 2
    var d = 'M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + cy + ', ' + x2 + ' ' + (y1 + 8) + ', ' + x2 + ' ' + y2

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'fx-link')
    svg.setAttribute('viewBox', '0 0 ' + s.width + ' ' + s.height)
    svg.innerHTML = '<path d="' + d + '"/><path class="flow" d="' + d + '"/>'
    screen.appendChild(svg)
  }

  /* ---------- 2. 打字机：示例轮播 ---------- */
  var SAMPLES = [
    '周五要去招聘会，简历还没改',
    '帮我把这两页身份证复印成一张',
    '我想看看广州的运营岗',
    '我不知道从哪开始'
  ]
  function typewriter () {
    // 只接受显式声明 data-typewriter 的输入框。
    // 早前按 .goalfield input 全局抓，结果访谈页、文件名输入框都被首页的示例占用了。
    var input = screen.querySelector('[data-typewriter]')
    if (!input || REDUCED) return
    var si = 0, ci = 0, dir = 1
    setInterval(function () {
      if (document.activeElement === input || input.value) return
      var t = SAMPLES[si]
      ci += dir
      input.setAttribute('placeholder', t.slice(0, ci))
      if (ci >= t.length) { dir = 0; setTimeout(function () { dir = -1 }, 1600) }
      if (ci <= 0 && dir === -1) { dir = 1; si = (si + 1) % SAMPLES.length }
    }, 62)
  }

  /* ---------- 3. 生成序列 ---------- */
  function runSequence () {
    var band = screen.querySelector('[data-fx="think-target"]') || screen.querySelector('.band')
    var note = band && band.querySelector('.panel-note:not([hidden]), .advice-kicker span:first-child')
    var orb = screen.querySelector('[data-fx="figure"]') || screen.querySelector('[data-adv]') ||
              screen.querySelector('.hero-orb .orb:not([hidden])')
    var stepsHost = screen.querySelector('[data-fx="steps"]')
    var steps = stepsHost || (band && band.querySelector('.steps:not([hidden])'))
    if (!band || !steps) return
    var noteText = note ? note.textContent : ''

    band.classList.add('is-thinking')
    if (orb) orb.classList.add('is-think')
    if (note) note.textContent = '正在盘点你手上的材料与这周的场次…'

    setTimeout(function () {
      band.classList.remove('is-thinking')
      if (orb) orb.classList.remove('is-think')
      if (note) note.textContent = noteText
      var rows = steps.querySelectorAll('.step, .node')
      for (var i = 0; i < rows.length; i++) {
        (function (el, i) {
          el.classList.remove('is-writing')
          setTimeout(function () { el.classList.add('is-writing') }, i * 130)
        })(rows[i], i)
      }
      var primary = screen.querySelector('.actionbar .btn--primary:not([hidden])')
      if (primary) {
        primary.classList.add('is-next')
        setTimeout(function () { primary.classList.remove('is-next') }, 8400)
      }
    }, REDUCED ? 120 : 2200)
  }

  screen.addEventListener('click', function (e) {
    var trigger = e.target.closest('[data-fx="submit"], [data-fx="scene"], .goalbar .btn--primary, .hero-ex .chip')
    if (!trigger) return
    if (trigger.classList.contains('chip') || trigger.getAttribute('data-fx') === 'scene') {
      var input = screen.querySelector('.goalfield input, .command-field input')
      if (input) { input.value = trigger.textContent.trim(); input.parentElement.classList.add('has-value') }
    }
    runSequence()
  })

  /* ---------- 4. 触点：光斑 + 涟漪 ---------- */
  screen.addEventListener('pointermove', function (e) {
    var tile = e.target.closest('.tile, .slab')
    if (!tile) return
    var r = tile.getBoundingClientRect()
    tile.style.setProperty('--mx', (e.clientX - r.left) + 'px')
    tile.style.setProperty('--my', (e.clientY - r.top) + 'px')
  })
  screen.addEventListener('pointerdown', function (e) {
    var host = e.target.closest('.btn, .tile, .chip, .step, .slab, .scene, .dir-row, .card, .vscene')
    if (!host || REDUCED) return
    var r = host.getBoundingClientRect()
    var size = Math.max(r.width, r.height) * 1.6
    var el = document.createElement('span')
    el.className = 'ripple'
    el.style.width = el.style.height = size + 'px'
    el.style.left = (e.clientX - r.left) + 'px'
    el.style.top = (e.clientY - r.top) + 'px'
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
    host.appendChild(el)
    setTimeout(function () { el.remove() }, 640)
  })

  /* ---------- 5. 数字滚动（opt-in，且有禁区） ----------
     纪律：只允许用在"氛围型"数字上。
     设备状态、纸量、价格、页数、份数、匹配档位一律禁止滚动——
     动画中途的中间值会被用户当成真实读数，那就是伪造数据。
     首页因此不使用它：本机状态与场次规模都是要被当真的数字。 */
  function countUp () {
    var nodes = screen.querySelectorAll('[data-count]')
    for (var i = 0; i < nodes.length; i++) {
      (function (el) {
        var to = parseFloat(el.getAttribute('data-count'))
        if (REDUCED) { el.textContent = to; return }
        // 兜底：rAF 被浏览器节流时也必须落到真值，绝不能停在中间数
        setTimeout(function () { el.textContent = to }, 1300)
        var t0 = null, dur = 760
        function step (ts) {
          if (!t0) t0 = ts
          var p = Math.min(1, (ts - t0) / dur)
          var e = 1 - Math.pow(1 - p, 3)
          el.textContent = Math.round(to * e)
          if (p < 1) requestAnimationFrame(step); else el.textContent = to
        }
        requestAnimationFrame(step)
      })(nodes[i])
    }
  }

  var input0 = screen.querySelector('.goalfield input, .command-field input')
  if (input0) input0.addEventListener('input', function () {
    input0.parentElement.classList.toggle('has-value', !!input0.value)
  })

  addEventListener('load', function () { drawLink(); countUp(); typewriter() })
  addEventListener('resize', drawLink)
  // 四态切换后重新量线
  new MutationObserver(function () { setTimeout(drawLink, 60) })
    .observe(screen, { attributes: true, attributeFilter: ['data-state'] })
})()
