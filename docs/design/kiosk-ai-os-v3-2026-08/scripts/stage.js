/* ============================================================
   V3 · 原型工作台外壳（生产不需要本文件）
   ------------------------------------------------------------
   1) 把 1080×1920 舞台等比缩放到当前窗口
   2) 四态切换：默认 / 首次使用 / AI 不可用 / 设备离线
      —— 四态共用同一套版面，只换内容与主按钮，不重排页面
   3) ?capture=1 隐藏外壳并按 1080×1920 原尺寸输出
   4) ?state=first|ai-down|device-off 直接进入指定状态
   5) 自查：横向溢出 / 触控尺寸 / 违禁文案，结果打到 console
   ============================================================ */
;(function () {
  var q = new URLSearchParams(location.search)
  var CAPTURE = q.get('capture') === '1'
  var STATES = [
    { k: 'default',   n: '默认' },
    { k: 'first',     n: '首次使用' },
    { k: 'ai-down',   n: 'AI 不可用' },
    { k: 'device-off', n: '设备离线' }
  ]

  document.body.classList.add('proto')
  if (CAPTURE) document.body.classList.add('capture')

  var stage = document.querySelector('.stage')
  var screen = document.querySelector('.screen')

  /* ---------- 配色主题 ---------- */
  var THEMES = [
    { k: 'warm',   n: '暖玉纸' },
    { k: 'honey',  n: '蜜杏暖橙' },
    { k: 'frost',  n: '霜白玻璃' },
    { k: 'amber',  n: '暖夜琥珀' },
    { k: 'jade',   n: '青玉墨' },
    { k: 'cobalt', n: '深空钴蓝' },
    { k: 'neon',   n: '霓虹青梅' },
    { k: 'pine',   n: '松林墨绿' },
    { k: 'ink',    n: '水墨素白' }
  ]
  function applyTheme (k) {
    if (!screen) return
    screen.setAttribute('data-theme', k)
    try { localStorage.setItem('v3-theme', k) } catch (e) {}
    var btns = document.querySelectorAll('[data-theme-btn]')
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', btns[i].getAttribute('data-theme-btn') === k ? 'true' : 'false')
    }
  }
  var theme0 = q.get('theme')
  if (!theme0) { try { theme0 = localStorage.getItem('v3-theme') } catch (e) {} }
  applyTheme(theme0 || 'warm')

  /* ---------- 舞台缩放 ---------- */
  function fit () {
    if (!stage) return
    if (CAPTURE) { stage.style.transform = 'none'; return }
    var padY = 88, padX = 32
    var s = Math.min((innerWidth - padX) / 1080, (innerHeight - padY) / 1920)
    s = Math.min(s, 1)
    stage.style.transform = 'scale(' + s + ')'
    stage.style.marginBottom = (1920 * s - 1920) + 'px'
  }
  addEventListener('resize', fit)

  /* ---------- 可见性：四态(data-when) 与 阶段(data-at) 合并判定 ----------
     两者都用 hidden，必须一次算完，否则后跑的那个会盖掉前一个 */
  function applyVisibility () {
    if (!screen) return
    var state = screen.getAttribute('data-state') || 'default'
    var stage = screen.getAttribute('data-stage') || ''
    var nodes = screen.querySelectorAll('[data-when],[data-at]')
    for (var i = 0; i < nodes.length; i++) {
      var w = nodes[i].getAttribute('data-when')
      var a = nodes[i].getAttribute('data-at')
      var ok = true
      if (w && w.split(/\s+/).indexOf(state) === -1) ok = false
      if (a && a.split(/\s+/).indexOf(stage) === -1) ok = false
      nodes[i].hidden = !ok
    }
  }
  window.v3ApplyVisibility = applyVisibility

  /* ---------- 四态 ---------- */
  function applyState (k) {
    if (!screen) return
    screen.setAttribute('data-state', k)
    applyVisibility()
    var btns = document.querySelectorAll('[data-state-btn]')
    for (var j = 0; j < btns.length; j++) {
      btns[j].setAttribute('aria-pressed', btns[j].getAttribute('data-state-btn') === k ? 'true' : 'false')
    }
    // 状态切换后重放入场动效，便于评审看动效
    var rises = screen.querySelectorAll('.rise')
    for (var r = 0; r < rises.length; r++) {
      rises[r].style.animation = 'none'; void rises[r].offsetHeight; rises[r].style.animation = ''
    }
    requestAnimationFrame(audit)
  }

  /* ---------- 外壳 UI ---------- */
  if (!CAPTURE) {
    var shell = document.createElement('div')
    shell.className = 'shell'
    var name = document.querySelector('meta[name="screen-name"]')
    shell.innerHTML =
      '<span class="shell-id">' + (name ? name.content : '') + '</span>' +
      STATES.map(function (s) {
        return '<button class="shell-btn" data-state-btn="' + s.k + '">' + s.n + '</button>'
      }).join('') +
      '<span class="shell-div"></span>' +
      THEMES.map(function (t) {
        return '<button class="shell-btn shell-btn--theme" data-theme-btn="' + t.k + '">' + t.n + '</button>'
      }).join('') +
      '<a class="shell-btn shell-btn--link" href="index.html">总览</a>'
    document.body.appendChild(shell)
    shell.addEventListener('click', function (e) {
      var b = e.target.closest('[data-state-btn]')
      if (b) applyState(b.getAttribute('data-state-btn'))
      var t = e.target.closest('[data-theme-btn]')
      if (t) applyTheme(t.getAttribute('data-theme-btn'))
    })
    applyTheme(screen.getAttribute('data-theme') || 'warm')
  }

  /* ---------- 时钟（真实本机时间，不写死） ---------- */
  function tick () {
    var el = document.querySelector('[data-clock]')
    if (!el) return
    var d = new Date()
    var p = function (n) { return (n < 10 ? '0' : '') + n }
    el.innerHTML = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 <b>' +
                   p(d.getHours()) + ':' + p(d.getMinutes()) + '</b>'
  }
  setInterval(tick, 10000)

  /* ---------- 自查 ---------- */
  var BANNED = ['一键投递', '立即投递', '平台投递', '收简历', '候选人管理', '在线投递', '直接投递']
  function audit () {
    if (!screen) return
    var out = { screen: (document.querySelector('meta[name="screen-name"]') || {}).content || location.pathname }
    // 横向溢出（装饰层 .aurora/.mesh/.grain 是刻意出血的背景，不计入）
    var over = []
    var host = screen.getBoundingClientRect()
    var all = screen.querySelectorAll('*')
    for (var i = 0; i < all.length; i++) {
      if (all[i].closest('.aurora,.mesh,.grain,.vhero-field,.vhero-dots')) continue
      var r = all[i].getBoundingClientRect()
      if (r.width && (r.right > host.right + 1 || r.left < host.left - 1)) over.push(all[i])
    }
    out.横向溢出 = over.length
    // 主体垂直溢出
    var main = screen.querySelector('.main') || screen.querySelector('.sheet')
    out.主体纵向溢出 = main ? Math.max(0, main.scrollHeight - main.clientHeight) : 0
    // 触控尺寸
    var small = []
    var hit = screen.querySelectorAll('a,button,input,[role="button"],.tile,.step,.slab,.scene,.dir-row,.node')
    for (var j = 0; j < hit.length; j++) {
      if (hit[j].hidden || hit[j].offsetParent === null) continue
      var b = hit[j].getBoundingClientRect()
      // 真实触控目标以外层包裹（label / 行容器）为准
      var wrap = hit[j].closest('label,.kv-row,.step,.readout,.node') || hit[j]
      if (b.height < 47.5 && wrap.getBoundingClientRect().height < 47.5) small.push(hit[j])
    }
    out.触控不足48 = small.length
    // 违禁文案。注意：否定式声明不算违禁——
    // 「本机不代收简历」「不做平台内投递」这类句子是合规披露，必须允许写，
    // 否则页面会被逼着回避这些词，反而说不清边界。
    var txt = screen.innerText || ''
    var NEG = /[不非禁无绝永未杜]/
    out.违禁文案 = BANNED.filter(function (w) {
      var i = -1
      while ((i = txt.indexOf(w, i + 1)) > -1) {
        if (!NEG.test(txt.slice(Math.max(0, i - 5), i))) return true   // 有一处是肯定式就算违禁
      }
      return false
    })
    var bad = out.横向溢出 || out.主体纵向溢出 || out.触控不足48 || out.违禁文案.length
    console.log('%c[V3 自查] ' + (bad ? '✗ 有问题' : '✓ 通过'),
      'color:' + (bad ? '#ff6f5e' : '#34e0a8') + ';font-weight:700', out)
    if (over.length) console.log('溢出元素：', over)
    if (small.length) console.log('触控不足元素：', small)
    window.__V3_AUDIT__ = out
  }
  window.v3Audit = audit

  tick(); fit()
  applyState(q.get('state') || 'default')
  addEventListener('load', function () { fit(); requestAnimationFrame(audit) })
})()
