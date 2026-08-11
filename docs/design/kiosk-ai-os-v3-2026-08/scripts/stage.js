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
    /* padY 与 body.proto 的 padding(28 顶 + 60 底)对齐，否则舞台底部出滚动 */
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
    // 第三条轴：收银子状态。支付这件事光靠"阶段"表达不了 ——
    // 待付 / 到账中 / 已付 / 码过期 / 主动查单 / 超时关单，都是同一个阶段里的不同处境，
    // 而且必须同版面切换（收银台不许换版式，钱的界面一动用户就慌）。
    var pay = screen.getAttribute('data-pay') || ''
    // 第四条轴：出纸阶段的任务处境。
    // 「已支付」到「出纸中」之间不是一步 —— 提交、排队、服务端校验各有可能卡住，
    // 校验失败要能回去重新上传，超时要自动转待打印订单。这些都得能单独看。
    var job = screen.getAttribute('data-job') || ''
    var nodes = screen.querySelectorAll('[data-when],[data-at],[data-pay],[data-job]')
    for (var i = 0; i < nodes.length; i++) {
      var w = nodes[i].getAttribute('data-when')
      var a = nodes[i].getAttribute('data-at')
      var y = nodes[i].getAttribute('data-pay')
      var jb = nodes[i].getAttribute('data-job')
      var ok = true
      if (w && w.split(/\s+/).indexOf(state) === -1) ok = false
      if (a && a.split(/\s+/).indexOf(stage) === -1) ok = false
      if (y && y.split(/\s+/).indexOf(pay) === -1) ok = false
      if (jb && jb.split(/\s+/).indexOf(job) === -1) ok = false
      nodes[i].hidden = !ok
    }
  }
  window.v3ApplyVisibility = applyVisibility

  /* ---------- 收银子状态（只有打印工作台用） ---------- */
  function applyPay (k) {
    if (!screen) return
    screen.setAttribute('data-pay', k)
    applyVisibility()
    var pb = document.querySelectorAll('[data-pay-btn]')
    for (var j = 0; j < pb.length; j++) {
      pb[j].setAttribute('aria-pressed', pb[j].getAttribute('data-pay-btn') === k ? 'true' : 'false')
    }
    if (window.v3Audit) requestAnimationFrame(window.v3Audit)
  }
  window.v3Pay = applyPay

  function applyJob (k) {
    if (!screen) return
    screen.setAttribute('data-job', k)
    applyVisibility()
    var jb = document.querySelectorAll('[data-job-btn]')
    for (var j = 0; j < jb.length; j++) {
      jb[j].setAttribute('aria-pressed', jb[j].getAttribute('data-job-btn') === k ? 'true' : 'false')
    }
    if (window.v3Audit) requestAnimationFrame(window.v3Audit)
  }
  window.v3Job = applyJob
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-job-btn]')
    if (b) applyJob(b.getAttribute('data-job-btn'))
    var g = e.target.closest('[data-job-go]')
    if (g) applyJob(g.getAttribute('data-job-go'))
  })
  if (screen && screen.hasAttribute('data-job')) {
    applyJob(q.get('job') || screen.getAttribute('data-job') || 'printing')
  }
  if (screen && screen.hasAttribute('data-pay')) {
    applyPay(q.get('pay') || screen.getAttribute('data-pay') || 'wait')
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pay-btn]')
    if (b) applyPay(b.getAttribute('data-pay-btn'))
    var g = e.target.closest('[data-pay-go]')
    if (g) applyPay(g.getAttribute('data-pay-go'))
  })

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
    // .stage 为了塞进浏览器窗口会整体 transform: scale()，getBoundingClientRect 拿到的是缩放后的屏幕像素。
    // 0.33 倍预览下一个 48px 的按钮量出来是 16px —— 全部误报，还会把真实问题淹掉。
    // 触控尺寸的判据是 1080×1920 下的布局像素，所以先把缩放除掉。
    var stEl = document.querySelector('.stage')
    var sc = stEl && stEl.offsetHeight ? stEl.getBoundingClientRect().height / stEl.offsetHeight : 1
    if (!sc || !isFinite(sc) || sc <= 0) sc = 1
    for (var j = 0; j < hit.length; j++) {
      if (hit[j].hidden || hit[j].offsetParent === null) continue
      // [data-review] 是原型评审用的脚手架（切处境、切态），不是给终端用户按的，
      // 不按 48px 触控要求算。产品 UI 一律不许挂这个属性。
      if (hit[j].closest('[data-review]')) continue
      var b = hit[j].getBoundingClientRect()
      // 真实触控目标以外层包裹（label / 行容器）为准
      var wrap = hit[j].closest('label,.kv-row,.step,.readout,.node') || hit[j]
      if (b.height / sc < 47.5 && wrap.getBoundingClientRect().height / sc < 47.5) small.push(hit[j])
    }
    out.触控不足48 = small.length
    // 文字裁切：容器比文字窄，字被切掉。
    // 这类缺陷不改变布局尺寸，纵向溢出和触控两项都抓不到，只能单独查。
    //
    // 不能用 scrollWidth：.card::after 那种刻意出血的装饰伪元素也会把 scrollWidth 撑大，
    // 首页六张卡全被误报（第一版就是这么错的）。改成直接量文本节点自己的矩形，
    // 只有真的字越过了容器内容框才算。
    var cut = []
    var rng = document.createRange()
    var hosts = screen.querySelectorAll('span,p,div,b,a,button,h1,h2,h3,h4,li,td,label')
    for (var k = 0; k < hosts.length; k++) {
      var e = hosts[k]
      if (e.hidden || e.offsetParent === null) continue
      if (e.closest('.aurora,.mesh,.grain,.vhero-field,.vhero-dots,[data-review]')) continue
      var cs = getComputedStyle(e)
      if (cs.overflowX === 'visible' || cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue
      var eb = e.getBoundingClientRect()
      // getBoundingClientRect 是缩放后的屏幕像素，getComputedStyle 的 padding 是布局像素。
      // 直接相减会多扣 padding×(1-缩放)，把 padding 大的按钮全判成裁切
      // —— 自检台的 iframe 是 1:1 所以看不出来，但在缩放预览里会一直误报。
      var padL = (parseFloat(cs.paddingLeft) || 0) * sc, padR = (parseFloat(cs.paddingRight) || 0) * sc
      var innerL = eb.left + padL, innerR = eb.right - padR
      for (var t = 0; t < e.childNodes.length; t++) {
        var tn = e.childNodes[t]
        if (tn.nodeType !== 3 || !tn.nodeValue.trim()) continue
        rng.selectNodeContents(tn)
        var tb = rng.getBoundingClientRect()
        if (!tb.width) continue
        if (tb.right > innerR + 1 || tb.left < innerL - 1) { cut.push(e); break }
      }
    }
    out.文字裁切 = cut.length
    window.__V3_CUT__ = cut

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

    /* ── 以下四项是"审别人的页"时最常漏的，全部可机械判定 ── */

    // ① 三档匹配参考的红线：禁百分比匹配度、禁录用概率。
    //    「78% 完成」这类进度百分比是允许的，只有和匹配/录用绑在一起才违规。
    //    和违禁文案同一条规矩：**否定式声明必须放过**。
    //    「本机不预测录用概率」是合规披露，把它判成违规会逼页面回避这个词、反而说不清边界。
    //    （这条豁免是补的 —— 第一版漏了，P14 的合规声明当场被误报。）
    var red = []
    var RED = [/匹配[度率]?\s*[:：]?\s*\d+\s*%/g, /\d+\s*%\s*匹配/g, /录用(概率|率)/g, /通过率\s*\d+/g, /成功率\s*\d+/g]
    for (var q = 0; q < RED.length; q++) {
      var re = RED[q], m
      re.lastIndex = 0
      while ((m = re.exec(txt))) {
        if (!NEG.test(txt.slice(Math.max(0, m.index - 6), m.index))) { red.push(re.source); break }
      }
    }
    out.量化红线 = red

    // ② 建议必须标证据级别（README §三）。
    //    第一版判成"凡建议必标 E3"，那是错的：P04 断网页写「建议先把要打的打了 ——
    //    打印不依赖网络」，依据是设备能力事实，该标 E2 而不是 E3。
    //    机器只能判"有没有任何证据标注"；至于该标 E2 还是 E3，是 §9.2 的人工项。
    //    判据只收"模型在下判断"的措辞。刻意不收：
    //      · 「预计」—— 文件预计大小、预计用纸，那是服务端算出来的，不是模型猜的
    //      · 「看起来」—— 太弱，"看起来能点"这类描述性说法会大量误报
    var JUDGE = /(我建议|建议先|建议你|建议改|推测|可能更适合|我觉得|偏向于|更适合你)/
    //    否定豁免同上：「不是建议你转」「本机不推测」是免责声明，不是在下判断。
    //    这条豁免补过三次了（违禁文案、量化红线、这里）—— 凡是按词判的检查都得带。
    var judged = false
    var jre = new RegExp(JUDGE.source, 'g'), jm
    while ((jm = jre.exec(txt))) {
      if (!NEG.test(txt.slice(Math.max(0, jm.index - 6), jm.index))) { judged = true; break }
    }
    out.建议无证据 = (judged && !screen.querySelector('.ev--e1,.ev--e2,.ev--e3')) ? 1 : 0

    // ③ 来源三字段（CLAUDE.md §10）：来源机构 / 同步时间 / 外部 ID 缺一不可。
    //    只能按"当前这一态里真的展示了来源条目"来判，不能拿整页文本判 ——
    //    第一版就是拿整页文本判的，结果 empty / error 态（列表本来就没条目）全被误报，
    //    而 P13 那种三字段齐全的页反倒被点名。
    //    两种判法：
    //      · 有可见的 .srcline 构件 → 逐个查它自己是否三样都在（漏一个就是漏一个）
    //      · 没有 .srcline 但出现「来源机构」标签（详情型写法）→ 整页必须能查到另两样
    var lack = {}
    var XID = /(外部\s*ID|文号|公告号|编号|批次号)/i
    var sls = screen.querySelectorAll('.srcline')
    var sawItem = false
    for (var y = 0; y < sls.length; y++) {
      if (sls[y].hidden || sls[y].offsetParent === null) continue
      sawItem = true
      var st2 = sls[y].innerText || ''
      if (!/来源/.test(st2)) lack['来源机构'] = 1
      if (!/同步/.test(st2)) lack['同步时间'] = 1
      // 外部标识在不同业务里叫法不同：岗位/招聘会是「外部 ID」，
      // 政策是「文号」，活动是「公告号」。只认一种写法会逼页面写得不像人话。
      if (!XID.test(st2)) lack['外部ID'] = 1
    }
    // 详情型写法：kv 行「来源机构 | 某某公司」。要在**同一个 kv 容器内**查另两样，
    // 不能拿整页文本查 —— 整页查会把别处的"同步"当成这条的同步时间。
    // 汇总口径要放过：P22 写的是「来自 3 家来源机构，同步于 8月9日」，
    // 那是 214 条岗位的统计，没有"某一条"的外部 ID，要求它有就是错的。
    var kvs = screen.querySelectorAll('.kv-row')
    for (var z = 0; z < kvs.length; z++) {
      var row = kvs[z]
      if (row.hidden || row.offsetParent === null) continue
      var kEl = row.querySelector('.k'), vEl = row.querySelector('.v')
      if (!kEl || !/来源机构/.test(kEl.textContent || '')) continue
      var val = (vEl && vEl.textContent || '').trim()
      if (/^\d+\s*[家个条]/.test(val)) continue          // 汇总口径，不是单条来源
      var box = row.closest('.kv') || row.parentElement
      var bt = (box && box.innerText) || ''
      sawItem = true
      if (!/同步/.test(bt)) lack['同步时间'] = 1
      if (!XID.test(bt)) lack['外部ID'] = 1
    }
    out.来源三字段缺 = sawItem ? Object.keys(lack) : []

    // ④ 四态是否真的做了：切到某一态时，页面必须有内容随之变化。
    //    只把 data-state 换掉但一个 [data-when] 都没有 = 四态是假的。
    out.四态未落地 = screen.querySelector('[data-when]') ? 0 : 1

    // ⑤ 标点在行首（中文排版禁则）。
    //    源码里 grep「</b>，」没有意义 —— 那种写法极常见，只有断行恰好落在标点前才出问题。
    //    只能在渲染后按字符量。两个坑都踩过了：
    //      · 纯文本里浏览器本来就不让逗号起行，所以只在**跨元素边界**时才会发生
    //        （`<b>左上角</b>，压平` 里逗号是下一个文本节点的第一个字符）；
    //      · 因此绝不能只在文本节点内部比较，必须把整块的字符位置连起来看 ——
    //        第一版从 ci=1 开始，恰好漏掉唯一会发生的情形。
    var BAD_LEAD = '，。、；：？！）」』】…·'
    var lead = []
    var rng2 = document.createRange()
    var blocks = screen.querySelectorAll('p,span,div,li,td,b,label,h1,h2,h3,h4')
    var seen = []
    for (var bi = 0; bi < blocks.length; bi++) {
      var bl = blocks[bi]
      if (bl.offsetParent === null) continue
      if (bl.closest('[data-review],.aurora,.mesh,.grain')) continue
      if (getComputedStyle(bl).display === 'inline') continue      // 只按块量，避免重复
      // 收集这一块里所有文本位置（跨元素边界连成一串）
      var pos = []
      var w2 = document.createTreeWalker(bl, NodeFilter.SHOW_TEXT, null)
      var t2
      while ((t2 = w2.nextNode())) {
        if (!t2.nodeValue) continue
        if (t2.parentElement && t2.parentElement.closest('[data-review]')) continue
        for (var k2 = 0; k2 < t2.nodeValue.length; k2++) pos.push([t2, k2, t2.nodeValue.charAt(k2)])
        if (pos.length > 1600) break
      }
      for (var pi = 1; pi < pos.length; pi++) {
        if (BAD_LEAD.indexOf(pos[pi][2]) === -1) continue
        rng2.setStart(pos[pi][0], pos[pi][1]); rng2.setEnd(pos[pi][0], pos[pi][1] + 1)
        var rc = rng2.getBoundingClientRect()
        rng2.setStart(pos[pi - 1][0], pos[pi - 1][1]); rng2.setEnd(pos[pi - 1][0], pos[pi - 1][1] + 1)
        var rp = rng2.getBoundingClientRect()
        if (!rc.height || !rp.height) continue
        if (rc.top - rp.top > rp.height * 0.6) {
          var ctx = ''
          for (var c2 = Math.max(0, pi - 10); c2 <= pi; c2++) ctx += pos[c2][2]
          var key = ctx + '|' + Math.round(rc.top)
          if (seen.indexOf(key) === -1) { seen.push(key); lead.push({ 字: pos[pi][2], 上下文: ctx }) }
        }
      }
    }
    out.标点在行首 = lead.length
    window.__V3_LEAD__ = lead
    var bad = out.横向溢出 || out.主体纵向溢出 || out.触控不足48 || out.文字裁切 ||
      out.违禁文案.length || out.量化红线.length || out.E3未标注 ||
      out.来源三字段缺.length || out.四态未落地 || out.标点在行首
    console.log('%c[V3 自查] ' + (bad ? '✗ 有问题' : '✓ 通过'),
      'color:' + (bad ? '#ff6f5e' : '#34e0a8') + ';font-weight:700', out)
    if (over.length) console.log('溢出元素：', over)
    if (small.length) console.log('触控不足元素：', small)
    window.__V3_AUDIT__ = out
    // 必须返回：audit-plus.js 用 base = originalAudit.call(window) 合并九项基础检查，
    // 少了 return 会让 v3AuditPlus() 的返回值里永远看不到触控/违禁词/裁字等项。
    return out
  }
  window.v3Audit = audit

  // ── 返回键：先退阶段，退无可退才离开本页 ─────────────────────────
  // 一体机没有浏览器后退键；用户口径是「回到上一级，不是回首页」。
  function stageList () {
    var set = new Set()
    document.querySelectorAll('[data-at]').forEach(function (el) {
      String(el.getAttribute('data-at') || '').split(/\s+/).forEach(function (v) { if (v) set.add(v) })
    })
    var order = []
    var rail = document.querySelector('.rail, [data-rail], .spine-rail') || document
    if (rail) {
      rail.querySelectorAll('[data-go]').forEach(function (el) {
        var v = el.getAttribute('data-go'); if (v && set.has(v) && order.indexOf(v) < 0) order.push(v)
      })
    }
    if (!order.length) order = Array.from(set)
    return order
  }
  function syncBack () {
    var b = document.querySelector('.actionbar > .backbtn'); if (!b) return
    var cur = screen.getAttribute('data-stage') || screen.getAttribute('data-at') || ''
    var list = stageList(); var i = list.indexOf(cur)
    var t = b.querySelector('.backbtn-t'); var sub = b.querySelector('.backbtn-sub')
    if (i > 0) { if (t) t.firstChild ? (t.firstChild.nodeValue = '上一步') : (t.textContent = '上一步'); if (sub) sub.textContent = '第 ' + i + ' 步' }
    else { if (t) t.firstChild ? (t.firstChild.nodeValue = '返回') : (t.textContent = '返回'); if (sub) sub.textContent = b.getAttribute('data-parent-label') || '' }
  }
  /* 这一次按返回，会被当成「退一个阶段」，还是「离开本页」？
     ── 为什么要把这个判断单独暴露出来（blockers.md A25）────────────────
     离场确认（leaveguard.js）要拦的只是**离开本页**，页内退阶段不该弹窗。
     但它必须在**任何人改动 data-stage 之前**拿到答案：
     原来两边的捕获监听都挂在 document 上，谁先注册谁先跑，stage.js 先跑并且
     已经把阶段退掉了，于是 leaveguard 读到的是**退完之后**的阶段。
     后果实测（07 扫描台，data-guard-at="s3 s4"，从 s3 起按返回）：
       第 1 次 → 退到 s2，不弹窗（此时 isDirty 已变 false）
       第 2 次 → 退到 s1，不弹窗
       第 3 次 → **直接跳到 39-print-hub.html，全程没有任何确认**
     修法分两半：这里给出「会不会退阶段」的判据并导出；leaveguard 把自己的
     捕获监听改挂到 window（捕获阶段 window 永远早于 document，与脚本加载
     顺序无关），从而在阶段被改之前问到真答案。
     判据与下面真正处理点击的那段**共用同一个函数**，两边不可能给出不同答案。 */
  function backWillRetreat (el) {
    if (!screen) return false
    /* 只有 .actionbar 的直接子返回键才由本文件接管退阶段（43 那种包了一层
       .backwrap 的不在此列）—— 判据必须和下面的选择器完全一致。 */
    if (el && el.matches && !el.matches('.actionbar > .backbtn')) return false
    var cur = screen.getAttribute('data-stage') || screen.getAttribute('data-at') || ''
    return stageList().indexOf(cur) > 0
  }
  window.v3BackWillRetreat = backWillRetreat

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.actionbar > .backbtn'); if (!b) return
    if (!backWillRetreat(b)) return
    var cur = screen.getAttribute('data-stage') || screen.getAttribute('data-at') || ''
    var list = stageList(); var i = list.indexOf(cur)
    e.preventDefault()
    if (typeof window.v3Stage === 'function') window.v3Stage(list[i - 1])
    else { screen.setAttribute('data-stage', list[i - 1]); applyVisibility() }
    syncBack()
  }, true)
  window.v3SyncBack = syncBack

  tick(); fit()
  applyState(q.get('state') || 'default')
  addEventListener('load', function () { fit(); requestAnimationFrame(audit) })
})()
