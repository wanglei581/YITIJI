/* ============================================================
   V5 增强动效行为层（fx2）
   ------------------------------------------------------------
   1) 数据流连线：量出顾问肖像与办理路径首节点的真实坐标后连曲线
   2) 玻璃反光跟手：给 vcommand / verrand / vpanel / card 写 --mx --my
   3) 卡片按压微倾斜：朝手指方向轻微翻转
   4) 计数点阵：把 [data-dots="12"] 渲染成 12 个点（真实数量可视化）
   5) 生成序列：全屏光扫 + 色域增亮 + 处理日志逐条 + 路径逐节点写入
   全部动效在 prefers-reduced-motion 下跳过或退化。
   ============================================================ */
;(function () {
  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches
  var screen = document.querySelector('.screen')
  var vivid = document.querySelector('.vivid')
  if (!screen || !vivid) return

  /* ---------- 1. 数据流连线 ---------- */
  function drawLink () {
    var old = vivid.querySelector('.fx2-link')
    if (old) old.remove()
    var fig = screen.querySelector('.vfigure img')
    var dot = screen.querySelector('.vstep--now .vstep-dot')
    if (!fig || !dot) return

    var host = vivid.getBoundingClientRect()
    var f = fig.getBoundingClientRect()
    var d = dot.getBoundingClientRect()
    var x1 = f.left - host.left + 22            // 肖像左下角出发
    var y1 = f.bottom - host.top - 30
    var x2 = d.left - host.left + d.width / 2    // 落到当前节点
    var y2 = d.top - host.top - 16
    if (y2 - y1 < 40) return

    // 先向左下走，再回到节点上方：绕开玻璃胶囊，读起来像一条走线
    var path = 'M' + x1 + ' ' + y1 +
               ' C' + (x1 - 90) + ' ' + (y1 + 70) + ', ' + (x2 + 130) + ' ' + (y1 + 40) + ', ' +
               x2 + ' ' + y2
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'fx2-link')
    svg.setAttribute('viewBox', '0 0 ' + host.width + ' ' + host.height)
    svg.innerHTML = '<path class="base" d="' + path + '"/><path class="flow" d="' + path + '"/>'
    vivid.appendChild(svg)
  }

  /* ---------- 2 + 3. 反光跟手 / 按压倾斜 ---------- */
  var LIT = '.vcommand, .verrand, .vpanel, .card'
  screen.addEventListener('pointermove', function (e) {
    var host = e.target.closest(LIT)
    if (!host) return
    var r = host.getBoundingClientRect()
    host.style.setProperty('--mx', (e.clientX - r.left) + 'px')
    host.style.setProperty('--my', (e.clientY - r.top) + 'px')
    host.classList.add('is-lit')
  })
  screen.addEventListener('pointerleave', function () {
    screen.querySelectorAll('.is-lit').forEach(function (n) { n.classList.remove('is-lit') })
  })
  screen.addEventListener('pointerout', function (e) {
    var host = e.target.closest(LIT)
    if (host && !host.contains(e.relatedTarget)) host.classList.remove('is-lit')
  })

  screen.addEventListener('pointerdown', function (e) {
    var card = e.target.closest('.card')
    if (!card || REDUCED) return
    var r = card.getBoundingClientRect()
    var dx = (e.clientX - r.left) / r.width - .5
    var dy = (e.clientY - r.top) / r.height - .5
    card.classList.add('is-tilt')
    card.style.transform = 'perspective(900px) rotateY(' + (dx * 4).toFixed(2) + 'deg) rotateX(' +
                           (-dy * 4).toFixed(2) + 'deg) translateY(1px)'
  })
  function untilt () {
    screen.querySelectorAll('.card.is-tilt').forEach(function (c) {
      c.style.transform = ''
      setTimeout(function () { c.classList.remove('is-tilt') }, 160)
    })
  }
  screen.addEventListener('pointerup', untilt)
  screen.addEventListener('pointercancel', untilt)

  /* ---------- 4. 计数点阵 ---------- */
  function renderDots () {
    screen.querySelectorAll('[data-dots]').forEach(function (el) {
      if (el.querySelector('.dotc')) return
      var n = parseInt(el.getAttribute('data-dots'), 10)
      if (!n || n > 24) return
      var wrap = document.createElement('span')
      wrap.className = n > 6 ? 'dotc dotc--wrap' : 'dotc'
      for (var i = 0; i < n; i++) {
        var d = document.createElement('i')
        d.style.animationDelay = (i * 34) + 'ms'
        wrap.appendChild(d)
      }
      el.insertBefore(wrap, el.firstChild)
    })
  }

  /* ---------- 5. 生成序列 ---------- */
  var STEPS_TEXT = [
    '读取 个人简历.pdf · 3 页',
    '核对 周五 夏季综合招聘会 · 128 家企业',
    '排出办理顺序 · 3 步'
  ]
  var busy = false
  function runSequence () {
    if (busy) return
    busy = true
    var cap = screen.querySelector('.vcommand')
    var errand = screen.querySelector('.verrand')
    var main = errand && errand.querySelector('.verrand-main')
    var kick = errand && errand.querySelector('.verrand-kick span:not([hidden])')
    var kickText = kick ? kick.textContent : ''
    var hidden = []

    screen.classList.add('is-working')
    if (cap) cap.classList.add('is-working')

    // 全屏光扫
    if (!REDUCED) {
      var sw = document.createElement('div')
      sw.className = 'sweep'
      screen.appendChild(sw)
      setTimeout(function () { sw.remove() }, 1200)
    }

    // 建议正文暂时让位给处理日志：AI 在读什么，写清楚
    if (main) {
      main.querySelectorAll('.verrand-h, .verrand-p, .verrand-foot').forEach(function (n) {
        if (!n.hidden) { n.hidden = true; hidden.push(n) }
      })
      var log = document.createElement('div')
      log.className = 'proclog'
      main.appendChild(log)
      if (kick) kick.textContent = '本次办理单 · 正在盘点'
      STEPS_TEXT.forEach(function (t, i) {
        setTimeout(function () {
          var prev = log.lastElementChild
          if (prev) prev.classList.add('done')
          var row = document.createElement('div')
          row.textContent = t
          log.appendChild(row)
        }, REDUCED ? 0 : i * 620)
      })
    }

    setTimeout(function () {
      screen.classList.remove('is-working')
      if (cap) cap.classList.remove('is-working')
      var log2 = main && main.querySelector('.proclog')
      if (log2) log2.remove()
      hidden.forEach(function (n) { n.hidden = false })
      if (kick) kick.textContent = kickText
      // 路径逐节点写入
      var nodes = screen.querySelectorAll('.vstep')
      nodes.forEach(function (n, i) {
        n.classList.remove('is-writing')
        setTimeout(function () { n.classList.add('is-writing') }, i * 140)
      })
      var primary = screen.querySelector('.actionbar .btn--primary:not([hidden])')
      if (primary) {
        primary.classList.add('is-next')
        setTimeout(function () { primary.classList.remove('is-next') }, 8400)
      }
      busy = false
      drawLink()
    }, REDUCED ? 200 : 2250)
  }

  screen.addEventListener('click', function (e) {
    if (e.target.closest('[data-fx="submit"], [data-fx="scene"]')) runSequence()
  }, true)

  addEventListener('load', function () { renderDots(); drawLink() })
  addEventListener('resize', drawLink)
  new MutationObserver(function () { setTimeout(drawLink, 80) })
    .observe(screen, { attributes: true, attributeFilter: ['data-state'] })
})()
