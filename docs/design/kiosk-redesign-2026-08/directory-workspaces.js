/* ============================================================
   青序流光 · 目录工作台共享运行时（静态原型）
   宿主：42 线下机构 / 43 找企业 / 44 招聘会参展企业 / 45 线上平台目录
   职责：按 ?state= 渲染 main 主体、顶栏 pill、紧凑任务标题、页内 AI 辅助、演示面板
   骨架口径（DESIGN-SYSTEM §3.1 / §3.2）：目录与详情用紧凑任务标题，第一屏留给
        名单 / 详情 / 岗位；不常驻大号小青横幅，不用等高卡片撑屏。
   边界：不预置机构/企业/平台名称、数量、时间、来源链接与二维码；
        缺来源要素一律 fail-closed，投递类按钮置灰并常显原因（触屏无 hover）
   AI（DESIGN-SYSTEM §7.1 AI-CONTEXT）：页内 AI 只在用户主动给出输入后才可用，
        不自动调用模型、不静默读取简历；本原型不产生任何 AI 结果，只表达契约。
   ============================================================ */
(function () {
'use strict'

/* ── 图标（本地内联 SVG，无外部请求） ─────────────────── */
var ICO = {
  building: '<path d="M4 21V4.5A1.5 1.5 0 0 1 5.5 3H13v18M13 8h5.5A1.5 1.5 0 0 1 20 9.5V21"/><path d="M7 7h2M7 11h2M7 15h2M16 12h1M16 16h1"/><path d="M2.5 21h19"/>',
  pin: '<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.4l3.4 2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16.2 16.2 4 4"/>',
  arrow: '<path d="M9 5l7 7-7 7"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  doc: '<path d="M14 2H6.5A2.5 2.5 0 0 0 4 4.5v15A2.5 2.5 0 0 0 6.5 22h11a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 2v6h6"/>',
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M4 12h16"/>',
  resume: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h5M8 12h8M8 16h6"/>',
  qr: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h3v3h-3zm3.5 3.5h3v3h-3zM14 20.5h1.5M20.5 14v1.5"/>',
  ext: '<path d="M14 4h6v6"/><path d="m20 4-8.5 8.5"/><path d="M19 14.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6h.01"/>',
  lock: '<rect x="4.5" y="10" width="15" height="10.5" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
  print: '<path d="M7 9V3.5h10V9"/><rect x="3" y="9" width="18" height="8" rx="2.5"/><path d="M7 14h10v6.5H7z"/>',
  brief: '<rect x="3" y="7.5" width="18" height="12.5" rx="2.5"/><path d="M8.5 7.5V5.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2M3 13h18"/>',
  alert: '<path d="M12 3.5 21 20H3z"/><path d="M12 10v4.5M12 17.4h.01"/>',
  booth: '<path d="M3 8.5 4.5 4h15L21 8.5"/><path d="M3 8.5h18v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5z"/><path d="M9 21v-6h6v6"/>',
  chat: '<path d="M21 12a8 8 0 1 1-3.5-6.6"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'
}
function svg (name, stroke, size) {
  return '<svg width="' + (size || 28) + '" height="' + (size || 28) + '" viewBox="0 0 24 24" fill="none" stroke="' +
    (stroke || 'currentColor') + '" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICO[name] + '</svg>'
}

/* ── 通用片段 ─────────────────────────────────────────── */
var SCREEN = ''
var aiStep = 'need-input'
function tid (suffix) { return SCREEN + '-' + suffix }
/** 字段占位：真实数据返回前只占位置，不写任何名称/数量/时间 */
function slot (label, big) {
  return '<span class="slot' + (big ? ' slotbig' : '') + '">' + label + '</span>'
}
/** 主任务区用 data-primary 标注，供取证脚本计算首要内容占比 */
function sec (no, title, hint, inner, cls, primary) {
  return '<section class="sec' + (cls ? ' ' + cls : '') + '"' + (primary ? ' data-primary="1"' : '') + '>' +
    (title ? '<div class="sec-label">' +
      (no ? '<span class="no serif">' + no + '</span>' : '') +
      '<span class="t">' + title + '</span>' +
      (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>' : '') + inner + '</section>'
}
function box (kind, id, head, paras) {
  return '<div class="state" data-kind="' + kind + '" data-testid="' + tid(id) + '">' +
    '<div class="state-h">' + head + '</div>' +
    paras.map(function (p) { return '<div class="state-p">' + p + '</div>' }).join('') + '</div>'
}
function link (href, route, id, cls, inner, extra) {
  return '<a class="' + cls + ' press" href="' + href + '" data-route="' + route + '" data-testid="' + tid(id) + '"' +
    (extra || '') + '>' + inner + '</a>'
}
/** 置灰控件：aria-disabled + aria-describedby 指向常显原因；点击由壳层统一拦截，绝不跳转 */
function off (id, cls, inner, reasonId) {
  return '<button type="button" class="' + cls + '" aria-disabled="true" data-testid="' + tid(id) + '"' +
    (reasonId ? ' aria-describedby="' + reasonId + '"' : '') + '>' + inner + '</button>'
}
/** 常显原因文本：置灰控件必须能指到它 */
function why (id, text, cls) {
  return '<span class="' + (cls || 'reason') + '" id="' + id + '">' + text + '</span>'
}
function esc (value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  })
}
function hrefWith (changes) {
  var next = new URLSearchParams(query || location.search)
  Object.keys(changes || {}).forEach(function (key) {
    var value = changes[key]
    if (value == null || value === '') next.delete(key)
    else next.set(key, String(value))
  })
  return '?' + next.toString()
}
function hiddenQuery (except) {
  if (!query) return ''
  var blocked = except || []
  var html = ''
  query.forEach(function (value, key) {
    if (blocked.indexOf(key) < 0) html += '<input type="hidden" name="' + esc(key) + '" value="' + esc(value) + '">'
  })
  return html
}
function qbar (name, placeholder, action, target) {
  var value = query ? query.get(name) || '' : ''
  return '<form class="qbar" method="get" role="search">' +
    '<span class="qi">' + svg('search', 'currentColor', 26) + '</span>' +
    '<input class="qinput" name="' + esc(name) + '" value="' + esc(value) + '" maxlength="80" placeholder="' + esc(placeholder) + '">' +
    hiddenQuery([name, 'state', 'page', 'cursor']) + '<input type="hidden" name="state" value="' + esc(target) + '">' +
    '<button class="qbtn press" type="submit" data-testid="' + tid('search') + '">' + action + '</button></form>'
}
function fgrp (label, param, items, target) {
  var active = query ? query.get(param) || '' : ''
  var normalized = [{ value: '', text: '全部' }].concat(items.map(function (item) {
    return typeof item === 'string' ? { value: item, text: item } : item
  }))
  var chips = normalized.map(function (item, i) {
    var changes = { state: target, page: null, cursor: null }
    changes[param] = item.value
    return '<a class="chip press' + (item.value === active ? ' on' : '') + '" href="' + hrefWith(changes) +
      '" data-testid="' + tid('filter-' + param + '-' + i) + '">' + esc(item.text) + '</a>'
  }).join('')
  return '<div class="fgrp"><span class="fl">' + label + '</span><span class="fc">' + chips + '</span></div>'
}
function filterInput (label, name, placeholder) {
  var value = query ? query.get(name) || '' : ''
  return '<label class="filter-input"><span>' + label + '</span><input name="' + esc(name) + '" value="' + esc(value) +
    '" maxlength="80" placeholder="' + esc(placeholder) + '"></label>'
}
function selectInput (label, name, placeholder, items) {
  var active = query ? query.get(name) || '' : ''
  return '<label class="filter-input"><span>' + label + '</span><select name="' + esc(name) + '">' +
    '<option value="">' + esc(placeholder) + '</option>' + items.map(function (item) {
      var option = typeof item === 'string' ? { value: item, text: item } : item
      return '<option value="' + esc(option.value) + '"' + (option.value === active ? ' selected' : '') + '>' + esc(option.text) + '</option>'
    }).join('') + '</select></label>'
}
function filterForm (fields, target, note) {
  var names = fields.map(function (field) { var m = field.match(/name="([^"]+)"/); return m ? m[1] : '' })
  return '<form class="filter-form" method="get">' + hiddenQuery(names.concat(['state', 'page', 'cursor'])) +
    '<input type="hidden" name="state" value="' + esc(target) + '">' +
    '<div class="filter-fields">' + fields.join('') + '</div><div class="filter-actions">' +
    '<span class="filter-note">' + note + '</span>' +
    '<a class="chip press" href="?state=list-ready" data-testid="' + tid('clear-all') + '">清除全部</a>' +
    '<button class="qbtn press" type="submit">应用条件</button></div></form>'
}
function pager (info, mode) {
  if (mode === 'cursor') {
    return '<div class="pager"><span class="pinfo">' + info + '</span>' +
      '<a class="pbtn press" href="' + hrefWith({ state: 'list-filtered', cursor: 'next' }) + '" data-testid="' +
      tid('load-more') + '">加载更多</a></div>'
  }
  var pageNo = Math.max(1, Number.parseInt(query && query.get('page') || '1', 10) || 1)
  var prev = pageNo > 1
  return '<div class="pager">' +
    (prev ? link(hrefWith({ page: pageNo - 1 }), '', 'pager-prev', 'pbtn', '上一页') : off('pager-prev', 'pbtn', '上一页', tid('pager-reason'))) +
    link(hrefWith({ page: pageNo + 1 }), '', 'pager-next', 'pbtn', '下一页') +
    '<span class="pinfo" id="' + tid('pager-reason') + '">第 ' + pageNo + ' 页 · ' + info + '</span></div>'
}
function tiles (list) {
  return '<div class="tiles" style="grid-template-columns:repeat(' + list.length + ',minmax(0,1fr))">' + list.map(function (t) {
    return '<div class="tile' + (t[2] ? ' accent' : '') + '"><div class="tv">' + t[1] + '</div><div class="tl">' + t[0] + '</div></div>'
  }).join('') + '</div>'
}
function kv (list) {
  return '<div class="kv">' + list.map(function (r) {
    return '<div><span>' + r[0] + '</span><b>' + r[1] + '</b></div>'
  }).join('') + '</div>'
}
function steps (list) {
  return '<ul class="steps">' + list.map(function (s, i) {
    return '<li><span class="sn">' + (i + 1) + '</span><span>' + s + '</span></li>'
  }).join('') + '</ul>'
}
function cta (parts) { return '<div class="ctabar">' + parts.join('') + '</div>' }
function primary (href, route, text) {
  return link(href, route, 'primary', 'btn primary', text, ' style="flex:1.6"')
}
function ghost (href, route, id, text) { return link(href, route, id, 'btn ghost', text) }
/** 紧凑入口条：一行装 2–3 个真实去处，替代半屏卡片墙 */
function stripItem (href, route, id, icon, tone, title, desc) {
  return link(href, route, id, 'stripitem',
    '<span class="si-ic" style="background:var(--' + tone + '-soft);color:var(--' + tone + '-d)">' + svg(icon, 'currentColor', 26) + '</span>' +
    '<span class="si-tx"><b>' + title + '</b><span>' + desc + '</span></span>')
}
function strip (items) { return '<div class="strip">' + items.join('') + '</div>' }
/** 带小标题的入口条：把「下一步能去哪」写成可点的去处，而不是三行说明文字 */
function titledStrip (title, items) {
  return '<div class="stripgroup"><h3 class="strip-t">' + title + '</h3>' + strip(items) + '</div>'
}
/** 死路页的出口清单：整行可点、纵向填满剩余高度。
    异常页剩下的空间应该给「真的能走的下一步」，不是给居中的空白，也不是给说明文字。 */
function exitList (items) { return '<div class="exitlist">' + items.join('') + '</div>' }
/** 带小标题的出口清单：异常态统一结构 = 状态卡 → 建议卡 → 大号出口清单 */
function titledExits (title, items) {
  return '<div class="stripgroup grow"><h3 class="strip-t">' + title + '</h3>' + exitList(items) + '</div>'
}
/** 就地说明：与相邻按钮/清单绑定，一页只出现一次 */
function noteline (icon, text, tail, tone) {
  return '<div class="noteline' + (tone ? ' ' + tone : '') + '">' +
    svg(icon, 'currentColor', 23) + '<span>' + text + '</span>' +
    (tail ? '<span class="nl-go">' + tail + '</span>' : '') + '</div>'
}
/** 扫码态的唯一任务是把码举到能扫的尺寸：码位是主视觉，说明压在上下两侧。
    码位随可用高度增长并保持正方形；静态原型只画位置，不画可扫描图形。 */
function qrBlock (targetLabel, addrHtml, lines, tailReason) {
  return '<div class="blk qrhero">' +
    '<div class="qrhead"><h4>' + targetLabel + '</h4>' +
    '<span class="qraddr">目标地址：' + addrHtml + '</span></div>' +
    '<div class="qrbox" data-testid="' + tid('qr-slot') + '">' + svg('qr', 'currentColor', 220) +
    '<span>二维码按来源地址在运行时生成，这里只画二维码位置</span></div>' +
    '<div class="qrfoot">' + steps(lines) + '<div class="reason">' + tailReason + '</div></div></div>'
}
function repeatRows (n, fn) {
  var out = ''
  for (var i = 0; i < n; i++) out += fn(i)
  return '<div class="rlist" data-testid="' + tid('list') + '">' + out + '</div>'
}
function skeletonRows (n, label) {
  var out = ''
  for (var i = 0; i < n; i++) {
    out += '<div class="row skeleton-row" aria-hidden="true"><span class="row-ic">' + svg('list', 'currentColor', 28) +
      '</span><span class="row-main"><span class="row-t">' + slot(label || '等待真实数据', true) + '</span>' +
      '<span class="row-sub"><span>' + slot('来源字段') + '</span><span>' + slot('状态字段') + '</span></span></span></div>'
  }
  return '<div class="rlist skeleton-list">' + out + '</div>'
}
function guide (title, list) {
  return '<div class="blk guide"><h3>' + title + '</h3>' + steps(list) + '</div>'
}
function illegalState (requested) {
  return sec('', '', '', box('warn', 'illegal-state', svg('alert', 'currentColor', 30) + '页面状态参数无效',
    ['地址栏里的状态「<b>' + esc(requested) + '</b>」不属于这个页面。',
      '本机不会静默跳到另一个状态，避免把错误链接误看成正常结果。'])) +
    sec('', '可以继续', '', exitList([
      stripItem('?state=' + esc(page.states[0]), '', 'illegal-default', 'list', 'slate', '打开默认页面', '回到该页面的正常入口'),
      stripItem('16-service-hubs.html?hub=jobs', '/jobs-service', 'illegal-hub', 'brief', 'teal', '返回岗位服务', '重新选择服务入口'),
      stripItem('01-home.html', '/', 'illegal-home', 'info', 'clay', '返回首页', '结束当前错误路径')
    ]), 'grow last', true) +
    cta([primary('?state=' + esc(page.states[0]), '', '打开默认页面')])
}

/* ── 页内 AI 辅助（AI-CONTEXT）─────────────────────────
   六项契约（输入 / 授权 / 输出 / 失败 / 非 AI 回退 / 持久化）逐条写在各宿主 HTML
   注释里；这里只实现可验证的交互：缺输入 → 主动作 aria-disabled + 常显原因；
   用户主动选简历或填方向 → 可用；点击后只呈现真实状态（本机未接 AI 服务），
   并给出不依赖 AI 的做法。任何分支都不生成 AI 结果，也不改变主任务。 */
var AI = {
  'offline-agency': {
    title: '整理到店要问的问题',
    desc: '按你选的简历或填的方向，整理咨询问题和材料清单。<b>不核验机构资质，也不生成机构或岗位信息。</b>',
    run: '整理咨询问题',
    goalLabel: '求职方向',
    goalHolder: '例如：仓储物流 · 佛山南海',
    needReason: '还没选简历、也没填方向：不会自动读你的文件，也不会先生成内容。',
    goalReason: '方向还没填：填一两个词就能整理。',
    readyNote: '只用于这一次整理，不写入你的记录；离开本页即清除。',
    failBody: '本机没有连上 AI 服务，因此不会给你一份编出来的问题清单。',
    fallback: '不靠 AI 也能问清楚：岗位要求、材料清单、收费公示，到店当面确认这三项。'
  },
  'company-directory': {
    title: '按本人简历排出先看哪几家',
    desc: '用你选的简历对比岗位已返回的字段，给出比较依据和先后顺序。<b>不打匹配百分比，也不改企业和岗位事实。</b>',
    run: '按岗位字段排序',
    goalLabel: '求职方向',
    goalHolder: '例如：机械设计 · 3 年 · 珠海',
    needReason: '还没选简历、也没填方向：不会自动读你的文件，也不会先生成排序。',
    goalReason: '方向还没填：填一两个词就能给比较依据。',
    readyNote: '只用于这一次排序，不写入你的记录；筛选和浏览不受影响。',
    failBody: '本机没有连上 AI 服务，因此不会给你一份编出来的排序。',
    fallback: '不靠 AI 也能筛：地区、行业、来源三组条件照常可用，企业和岗位照常可看。'
  },
  'fair-company': {
    title: '到展位先问哪几句',
    desc: '按现场岗位清单和你填的方向，整理到展位要问的问题。<b>不代投递、不预约、不签到，也不生成企业信息。</b>',
    run: '整理展位提问',
    goalLabel: '求职方向',
    goalHolder: '例如：电气维修 · 应届',
    needReason: '还没选简历、也没填方向：不会自动读你的文件，也不会先生成提问。',
    goalReason: '方向还没填：填一两个词就能整理。',
    readyNote: '只用于这一次整理，不写入你的记录；不产生任何投递或预约动作。',
    failBody: '本机没有连上 AI 服务，因此不会给你一份编出来的提问清单。',
    fallback: '不靠 AI 也能问：岗位要求、到岗时间、后续联系方式，到展位当面问这三项。'
  },
  'online-platform': {
    title: '整理可核对的搜索词',
    desc: '按你选的简历或填的方向，给出岗位名称、技能和地区搜索词，自己在平台里搜。<b>不比较平台优劣，也不替你投递。</b>',
    run: '生成搜索词',
    goalLabel: '求职方向',
    goalHolder: '例如：数控编程 · 中山',
    needReason: '还没选简历、也没填方向：不会自动读你的文件，也不会先生成搜索词。',
    goalReason: '方向还没填：填一两个词就能给搜索词。',
    readyNote: '只用于这一次整理，不写入你的记录；平台入口不受影响。',
    failBody: '本机没有连上 AI 服务，因此不会给你一组编出来的搜索词。',
    fallback: '不靠 AI 也能搜：岗位名称 + 地区先搜一轮，再按经验年限和学历收窄。'
  }
}
var AI_MISS_TITLE = '本机没有读到可用的本人简历'
var AI_MISS_BODY = '可以去「我的简历」选一份，或直接填写求职方向。'
function aiChip (act, text, on) {
  return '<button type="button" class="chip press' + (on ? ' on' : '') + '" data-ai="' + act + '" data-testid="' +
    tid('ai-' + act) + '">' + text + '</button>'
}
/** step: need-input | resume-missing | goal | unavailable */
function aiInline (step) {
  var c = AI[SCREEN]
  if (!c) return ''
  var reasonId = tid('ai-reason')
  var runBtn = step === 'goal'
    ? '<button type="button" class="ai-run press" aria-disabled="true" aria-describedby="' + reasonId +
      '" data-ai="run" data-testid="' + tid('ai-run') + '">' + c.run + '</button>'
    : off('ai-run', 'ai-run', c.run, reasonId)
  var body
  if (step === 'unavailable') {
    body = '<div class="ai-line"><b class="ai-t">' + c.title + '</b><span class="ai-ops">' +
      aiChip('reset', '重新选输入') +
      link('05-ai-cockpit.html', '/assistant', 'ai-help', 'chip', '去问小青') + '</span></div>' +
      '<div class="ai-fail" data-testid="' + tid('ai-unavailable') + '"><b>小青这次没接上</b><span>' + c.failBody + '</span></div>' +
      '<span class="ai-note">' + c.fallback + '</span>'
  } else if (step === 'resume-missing') {
    body = '<div class="ai-line"><b class="ai-t">' + c.title + '</b><span class="ai-ops">' +
      aiChip('goal', '填写求职方向') + runBtn + '</span></div>' +
      '<div class="ai-fail" data-kind="miss" data-testid="' + tid('ai-no-resume') + '"><b>' + AI_MISS_TITLE +
      '</b><span>' + AI_MISS_BODY + '</span></div>' +
      '<span class="ai-note">' + link('30-my-profile.html', '/profile', 'ai-resume-entry', 'chip', '去我的简历') + '</span>' +
      why(reasonId, c.needReason, 'reason')
  } else if (step === 'goal') {
    body = '<div class="ai-line"><b class="ai-t">' + c.title + '</b><span class="ai-ops">' +
      aiChip('resume', '用本人简历') + aiChip('goal', '填写求职方向', true) + runBtn + '</span></div>' +
      '<div class="ai-field"><label for="' + tid('ai-goal') + '">' + c.goalLabel + '</label>' +
      '<input id="' + tid('ai-goal') + '" type="text" data-ai-input="1" data-testid="' + tid('ai-goal-input') +
      '" placeholder="' + c.goalHolder + '" autocomplete="off"></div>' +
      why(reasonId, c.goalReason, 'ai-note') +
      '<span class="reason" data-ai-ready-note hidden>' + c.readyNote + '</span>'
  } else {
    body = '<div class="ai-line"><b class="ai-t">' + c.title + '</b><span class="ai-ops">' +
      aiChip('resume', '用本人简历') + aiChip('goal', '填写求职方向') + runBtn + '</span></div>' +
      '<span class="ai-d">' + c.desc + '</span>' +
      why(reasonId, c.needReason, 'reason')
  }
  return '<div class="ai-inline" data-testid="' + tid('ai') + '" data-ai-step="' + step + '">' +
    '<span class="ai-ic">' + svg('chat', 'currentColor', 26) + '</span>' +
    '<div class="ai-main">' + body + '</div></div>'
}

/* ── 42 线下招聘机构工作台 ─────────────────────────────── */
var OFFLINE_PREP = strip([
  stripItem('12-file-source.html?source=document&tab=file', '/print/upload', 'prep-print', 'print', 'teal',
    '打印自备材料', '登记表、复印件、自带简历，A4 黑白'),
  stripItem('18-scan-workbench.html', '/scan/start', 'prep-scan', 'scan', 'slate',
    '纸质材料扫成 PDF', '在奔图面板上扫，文件回本机取'),
  stripItem('21-resume-triage.html', '/resume/source', 'prep-resume', 'resume', 'clay',
    '简历先过一遍', '上传或扫描后做一次诊断')
])
var OFFLINE_BOUNDARY = '本机只做机构信息展示、门店指引和材料打印：不代收简历、不代投递，也不记录你到店后的结果。'

function agencyRow (i) {
  return link('?state=agency-ready', '/offline-agencies/:id', 'row-agency' + (i ? '-' + i : ''), 'row',
    '<span class="row-ic">' + svg('building', 'currentColor', 32) + '</span>' +
    '<span class="row-main"><span class="row-t">' + slot('机构名称', true) + '</span>' +
    '<span class="row-sub"><span>' + svg('pin', 'currentColor', 20) + slot('门店地址') + '</span>' +
    '<span>' + svg('clock', 'currentColor', 20) + slot('营业时间') + '</span></span>' +
    '<span class="row-chips"><span class="chip">服务项目 ' + slot('—') + '</span>' +
    '<span class="chip">来源编号 ' + slot('—') + '</span></span></span>' +
    '<span class="row-go">' + svg('arrow', 'currentColor', 26) + '</span>')
}

function offlineList (state) {
  var results
  if (state === 'list-loading') {
    results = '<div class="rbox">' + box('info', 'result-loading',
      '<span class="dot16 breathe"></span>正在读取已发布机构名单',
      ['取到名单之前，这里<b>不显示任何机构名称、数量或收录状态</b>。',
        '名单来自来源机构同步并经管理员审核发布。']) + skeletonRows(4, '机构字段') + '</div>'
  } else if (state === 'list-empty') {
    results = '<div class="rbox">' + box('warn', 'result-empty',
      svg('building', 'currentColor', 26) + '当前条件没有匹配的机构',
      ['换个关键词或检索方式再试一次。',
        '机构信息需要管理员<b>审核发布</b>后才会出现在目录里。',
        '也可以到前台，让工作人员按纸质名单帮你找。']) +
      '<div class="meta"><a class="chip press" href="?state=list-ready" data-testid="' + tid('clear-filter') + '">清除条件重新查询</a>' +
      '<a class="chip press" href="06-help.html" data-route="/help" data-testid="' + tid('help') + '">联系工作人员</a></div>' +
      guide('换条件时先看三项', ['机构所在区域是否方便到达。', '服务项目是否与当前材料或岗位有关。', '来源编号与门店公示是否能互相核对。']) + '</div>'
  } else if (state === 'list-error') {
    results = '<div class="rbox">' + box('error', 'result-error',
      svg('alert', 'currentColor', 26) + '机构名单没取到',
      ['这次请求失败了。本机<b>不会用示例机构顶替真实结果</b>，所以目录先空着。',
        '可以重试；重试仍失败时，请到前台找工作人员。']) +
      '<div class="meta"><a class="chip press" href="?state=list-ready" data-testid="' + tid('retry') + '">重试</a>' +
      '<a class="chip press" href="06-help.html" data-route="/help" data-testid="' + tid('help') + '">联系工作人员</a></div>' +
      guide('请求失败时仍能做', ['保留当前关键词，先重试一次。', '改看已审核发布的岗位信息。', '到前台按纸质名单核对机构与门店。']) + '</div>'
  } else {
    var filtered = state === 'list-filtered'
    results = '<div class="rbox">' +
      '<div class="rhead"><span class="rn">已发布机构</span><span>共 ' + slot('—') + ' 条 · 每页 10 条</span>' +
      '<span class="rsp">' + (filtered ? '已应用：关键词 · 区县 · 服务项目 · 机构类型' : '本机只做门店指引，不代收简历') + '</span></div>' +
      repeatRows(4, agencyRow) +
      pager('翻页在名单返回总条数之后可用。') +
      '</div>'
  }
  var exception = state === 'list-loading' || state === 'list-empty' || state === 'list-error'
  return sec('01', '先缩小范围', '四项均为真实接口参数，可单选也可组合',
    qbar('keyword', '输入机构名称、地址或说明关键词', '查询', 'list-filtered') +
    filterForm([
      filterInput('区县', 'district', '输入区县全称'),
      filterInput('服务项目', 'service', '输入来源机构发布的服务项目'),
      selectInput('机构类型', 'orgType', '全部类型', [
        { value: 'recruitment', text: '招聘服务机构' },
        { value: 'public_employment_service', text: '公共就业服务机构' },
        { value: 'licensed_hr_agency', text: '持证人力资源机构' }
      ])
    ], 'list-filtered', '区县、服务项目和机构类型是接口支持的精确条件；输入不存在的值时显示真实空态。')) +
  sec('02', '机构名单', '每页 10 条', results, 'grow', true) +
  sec('03', '到店前，可以先在本机做', '',
    OFFLINE_PREP + (exception ? noteline('info', OFFLINE_BOUNDARY) : aiInline(aiStep)), 'last') +
  cta([ghost('16-service-hubs.html?hub=jobs', '/jobs-service', 'back-hub', '返回岗位服务'),
    primary('?state=list-filtered', '/offline-agencies', '查询机构目录')])
}

function offlineAgency (state) {
  if (state === 'agency-error') {
    return sec('', '', '',
      box('error', 'agency-error', svg('alert', 'currentColor', 30) + '机构详情读取失败',
        ['这次没有取到机构资料和岗位清单，本机不会显示上一次缓存冒充当前结果。',
          '可以重试；目录仍可继续使用。'])) +
    sec('', '仍然可以继续', '', exitList([
      stripItem('?state=agency-ready', '/offline-agencies/:id', 'ae-retry', 'building', 'teal', '重新加载机构详情', '再次请求当前机构'),
      stripItem('?state=list-ready', '/offline-agencies', 'ae-list', 'list', 'slate', '返回机构目录', '保留目录主任务'),
      stripItem('06-help.html', '/help', 'ae-help', 'info', 'clay', '联系工作人员', '现场核对纸质名单')
    ]), 'grow last', true) +
    cta([ghost('16-service-hubs.html?hub=jobs', '/jobs-service', 'ae-back', '返回岗位服务'),
      primary('?state=agency-ready', '/offline-agencies/:id', '重新加载')])
  }
  if (state === 'agency-not-found') {
    return sec('', '', '',
      box('warn', 'agency-missing', svg('lock', 'currentColor', 30) + '机构详情不可用',
        ['这家机构可能<b>未发布、已下架，或这条链接已经过期</b>。',
          '本机不会用同名或附近的机构顶替：地址和资质对不上，到店就是白跑一趟。',
          '如果是扫码进来的，那张码多半是旧的。'])) +
    sec('', '', '',
      guide('重选时这样核对', ['先确认机构全称，不用同名门店顶替。', '再确认所在区域和可到达时间。',
        '最后核对来源编号与门店依法公示信息。'])) +
    sec('', '现在可以去哪', '都是本机真的能打开的页面', exitList([
      stripItem('?state=list-ready', '/offline-agencies', 'nf-list', 'building', 'teal', '回机构目录', '重新检索已发布机构'),
      stripItem('26-browse-list.html', '/jobs', 'nf-jobs', 'brief', 'wheat', '看岗位信息', '第三方来源岗位，带来源与同步时间'),
      stripItem('28-jobfair-enhanced.html', '/job-fairs', 'nf-fairs', 'booth', 'slate', '看招聘会', '现场时间、地点与参展名单'),
      stripItem('06-help.html', '/help', 'nf-help', 'info', 'clay', '联系工作人员', '现场按纸质名单帮你确认门店')
    ]) + noteline('info', OFFLINE_BOUNDARY), 'grow last', true) +
    cta([ghost('16-service-hubs.html?hub=jobs', '/jobs-service', 'nf-back', '返回岗位服务'),
      primary('?state=list-ready', '/offline-agencies', '回机构目录重选')])
  }
  if (state === 'agency-jobs-empty') {
    return sec('01', '机构资料', '以门店依法公示为准',
      '<div class="blk">' + kv([['机构名称', slot('—')], ['机构类型', slot('—')], ['营业时间', slot('—')],
        ['联系电话', slot('—')], ['机构地址', slot('—')], ['来源编号', slot('—')]]) + '</div>', '', true) +
    sec('02', '该机构的岗位', '真实返回 0 条',
      box('warn', 'agency-jobs-empty', svg('brief', 'currentColor', 30) + '该机构当前没有已发布岗位',
        ['这是岗位列表真实返回为空，不代表机构详情失效。', '可以到店咨询服务项目，或回岗位信息查看其他来源。']) +
      titledStrip('其他查找方式', [
        stripItem('26-browse-list.html', '/jobs', 'aje-jobs', 'brief', 'wheat', '岗位信息', '按岗位名称查其他来源'),
        stripItem('28-jobfair-enhanced.html', '/job-fairs', 'aje-fairs', 'booth', 'teal', '招聘会', '查看现场参展单位')
      ]), 'grow', true) +
    sec('03', '到店咨询', '', noteline('info', OFFLINE_BOUNDARY), 'last') +
    cta([ghost('?state=list-ready', '/offline-agencies', 'aje-back', '返回机构目录'),
      primary('26-browse-list.html', '/jobs', '去看岗位信息')])
  }
  return sec('01', '机构资料', '以门店依法公示为准',
    '<div class="blk"><div class="row-t" style="font-size:29px">' + slot('机构名称', true) + '</div>' +
    '<div style="height:14px"></div>' +
    kv([['机构类型', slot('—')], ['服务项目', slot('—')], ['营业时间', slot('—')],
      ['联系电话', slot('—')], ['机构地址', slot('—')], ['来源编号', slot('—')]]) +
    '<div class="reason">没有可核对的资质字段时，这里不展示资质核验或收录状态结论。</div></div>', '', true) +
  sec('02', '该机构的岗位', '只列已发布岗位',
    '<div class="rbox">' +
    '<div class="rhead"><span class="rn">在招岗位</span><span>共 ' + slot('—') + ' 条</span>' +
    '<span class="rsp">岗位由机构发布，本机不代投递</span></div>' +
    repeatRows(4, function (i) {
      return link('?state=job-ready', '/jobs/:id/offline', 'row-job' + (i ? '-' + i : ''), 'row solid',
        '<span class="row-ic" style="background:var(--wheat-soft);color:var(--wheat-d)">' + svg('brief', 'currentColor', 30) + '</span>' +
        '<span class="row-main"><span class="row-t">' + slot('岗位名称', true) + '</span>' +
        '<span class="row-sub"><span>' + svg('pin', 'currentColor', 20) + slot('工作地点') + '</span>' +
        '<span>' + svg('shield', 'currentColor', 20) + slot('岗位类型') + '</span></span></span>' +
        '<span class="row-go">' + svg('arrow', 'currentColor', 26) + '</span>')
    }) + '</div>', 'grow', true) +
  sec('03', '到店咨询', '费用以门店公示为准',
    '<div class="blk">' + steps([
      '看清门店地址与营业时间，营业时间以机构公示为准。',
      '带上本人材料，自行前往门店咨询岗位。',
      '服务收费以门店依法公示为准，本机不代收任何费用。'
    ]) + '<div class="reason">' + OFFLINE_BOUNDARY + '</div></div>' + aiInline(aiStep), 'last') +
  cta([ghost('?state=list-ready', '/offline-agencies', 'agency-back', '返回机构目录'),
    primary('?state=job-ready', '/jobs/:id/offline', '查看该机构岗位')])
}

function offlineJob (state) {
  if (state === 'job-source-incomplete') {
    return sec('01', '岗位概要', '只显示已返回的字段',
      '<div class="blk"><div class="row-t" style="font-size:29px">' + slot('岗位名称', true) +
      '<span class="tag wheat">来源要素不足</span></div>' +
      '<div class="row-sub" style="margin-top:9px"><span>' + svg('pin', 'currentColor', 20) + slot('工作地点') + '</span>' +
      '<span>' + svg('building', 'currentColor', 20) + '来源机构 未返回</span></div>' +
      '<div style="height:14px"></div>' +
      tiles([['薪资待遇', slot('—')], ['岗位类型', slot('—')], ['学历要求', slot('—')]]) +
      '</div>') +
    sec('02', '来源核对', '缺一项就不给外跳',
      box('error', 'source-incomplete', svg('alert', 'currentColor', 30) + '来源信息不完整 · 已停用外跳',
        ['这条线下岗位<b>没有凑齐可核对的来源要素</b>，本机不提供外跳、扫码或到店指引。',
          '不是页面坏了：来源对不上时给你一个地址，等于让你按没验证过的信息跑一趟。']) +
      '<div class="blk"><ul class="miss">' +
      '<li><span class="mk">!</span><span>来源机构名称 —— 未返回</span></li>' +
      '<li><span class="mk">!</span><span>门店地址 —— 未返回，无法给到店指引</span></li>' +
      '<li><span class="mk">!</span><span>来源编号 —— 未返回，无法溯源核对</span></li>' +
      '</ul><div class="reason">线下岗位没有「平台内投递」这条路：本机既不代收简历也不代投递，来源不足时就是没有下一步。</div></div>' +
      guide('不要按不完整信息出发', ['回机构目录重新选择有地址和来源编号的机构。', '先准备本人材料，不把文件交给不明来源。', '需要确认时请现场工作人员核对纸质名单。']), 'grow', true) +
    sec('03', '现在可以怎么办', '两条真的能走的路', strip([
      stripItem('?state=list-ready', '/offline-agencies', 'si-list', 'building', 'teal',
        '回机构目录重新找', '目录里的机构带地址与来源编号'),
      stripItem('12-file-source.html?source=document&tab=file', '/print/upload', 'si-print', 'print', 'clay',
        '先把材料打好', '不依赖这条岗位信息')
    ]), 'last') +
    cta([off('blocked-store', 'btn ghost', '查看来源机构门店', tid('blocked-store-reason')),
      why(tid('blocked-store-reason'), '缺少门店地址与来源编号，无法给出到店指引', 'why'),
      primary('?state=list-ready', '/offline-agencies', '回机构目录')])
  }
  return sec('01', '岗位概要', '字段以来源机构发布为准',
    '<div class="blk"><div class="row-t" style="font-size:29px">' + slot('岗位名称', true) +
    '<span class="tag wheat">线下岗位</span></div>' +
    '<div class="row-sub" style="margin-top:9px"><span>' + svg('pin', 'currentColor', 20) + slot('工作地点') + '</span>' +
    '<span>' + svg('building', 'currentColor', 20) + slot('来源机构') + '</span></div>' +
    '<div style="height:14px"></div>' +
    tiles([['薪资待遇', slot('—'), true], ['岗位类型', slot('—')], ['学历要求', slot('—')]]) +
    '</div>', '', true) +
  sec('02', '岗位要求', '来源机构没发布就写「到门店咨询」',
    '<div class="grid2">' +
    '<div class="blk"><div class="state-h" style="font-size:24px">任职要求</div><div style="height:10px"></div>' +
    kv([['学历', slot('—')], ['经验', slot('—')], ['技能', slot('—')]]) +
    '<div class="reason">未发布时显示：暂无任职要求说明，请到门店咨询。</div></div>' +
    '<div class="blk"><div class="state-h" style="font-size:24px">工作职责</div><div style="height:10px"></div>' +
    kv([['岗位职责', slot('—')], ['工作时间', slot('—')], ['用工形式', slot('—')]]) +
    '<div class="reason">未发布时显示：暂无职责说明，请到门店咨询。</div></div>' +
    '</div>', '', true) +
  sec('03', '发布机构与到店指引', '来源三要素齐了才给到店指引',
    '<div class="grid2">' +
    '<div class="blk">' + kv([['机构名称', slot('—')], ['机构类型', slot('—')],
      ['营业时间', slot('—')], ['联系电话', slot('—')], ['机构地址', slot('—')], ['来源编号', slot('—')]]) +
    '<div class="reason">数据来源说明：岗位与机构字段由来源机构发布并经管理员审核，本机只做展示，不改写、不补写。</div></div>' +
    '<div class="blk">' + steps([
      '先核对地址、营业时间和收费公示。',
      '带上本人材料，自行前往门店咨询。',
      '岗位要求没发布时，先向门店确认再准备材料。'
    ]) + '<div class="reason">' + OFFLINE_BOUNDARY + '</div></div>' +
    '</div>') +
  sec('', '', '', aiInline(aiStep), 'last') +
  cta([ghost('?state=agency-ready', '/offline-agencies/:id', 'job-store', '查看来源机构门店'),
    primary('12-file-source.html?source=document&tab=file', '/print/upload', '上传自备材料打印')])
}

/* ── 43 找企业工作台 ───────────────────────────────────── */
var COMPANY_TYPES = [
  ['central_soe', '央企'], ['soe', '国企'], ['public_institution', '事业单位'], ['private', '民营企业'],
  ['foreign', '外资企业'], ['joint_venture', '合资企业'], ['listed', '上市公司'], ['specialized_new', '专精特新'],
  ['high_tech', '高新技术企业'], ['school_enterprise', '校企合作单位'], ['public_org', '公共机构'], ['other', '其他']
].map(function (x) { return { value: x[0], text: x[1] } })
var COMPANY_INDUSTRIES = [
  ['smart_manufacturing', '智能制造'], ['internet_software', '互联网/软件'], ['ai_big_data', 'AI/大数据'],
  ['electronics', '电子信息'], ['new_energy', '新能源'], ['new_materials', '新材料'], ['biomedicine', '生物医药'],
  ['finance', '金融'], ['education', '教育培训'], ['healthcare', '医疗健康'], ['construction_realestate', '建筑地产'],
  ['transport_logistics', '交通物流'], ['retail_trade', '商贸零售'], ['culture_media', '文旅传媒'],
  ['agriculture_food', '农业食品'], ['professional_services', '专业服务'], ['public_services', '公共服务'], ['other', '其他']
].map(function (x) { return { value: x[0], text: x[1] } })
var COMPANY_RECRUIT_TYPES = [
  { value: 'fulltime', text: '社招' }, { value: 'campus', text: '校招' }, { value: 'intern', text: '实习' },
  { value: 'parttime', text: '兼职' }, { value: 'fair', text: '招聘会参展' }
]
var COMPANY_SOURCES = [
  { value: 'public_employment_service', text: '人社平台' }, { value: 'school_employment_center', text: '大学就业网' },
  { value: 'fair_organizer', text: '招聘会主办方' }, { value: 'licensed_hr_agency', text: '第三方合规平台' }
]
var COMPANY_BOUNDARY = '本机只做来源企业与岗位导览：不收简历、不做筛选、不安排面试，投递在来源平台完成。'

function companyRow (i) {
  return link('?state=company-ready', '/companies/:id', 'row-company' + (i ? '-' + i : ''), 'row',
    '<span class="row-ic" style="background:var(--slate-soft);color:var(--slate-d)">' + svg('building', 'currentColor', 32) + '</span>' +
    '<span class="row-main"><span class="row-t">' + slot('企业名称', true) + '</span>' +
    '<span class="row-sub"><span>' + svg('pin', 'currentColor', 20) + slot('省 · 市 · 区') + '</span>' +
    '<span>' + svg('shield', 'currentColor', 20) + '来源 ' + slot('—') + '</span></span></span>' +
    '<span class="row-side"><span class="num">' + slot('—') + '</span><span class="nt">在招岗位</span></span>' +
    '<span class="row-go">' + svg('arrow', 'currentColor', 26) + '</span>')
}

function companyList (state) {
  var results
  if (state === 'list-loading') {
    results = '<div class="rbox">' + box('info', 'result-loading',
      '<span class="dot16 breathe"></span>正在读取企业目录与统计',
      ['企业列表与在招岗位数<b>同一次请求返回</b>；取到之前不显示任何企业名称或数字。',
        '企业需要审核通过并发布后才会进入目录。']) + skeletonRows(5, '企业字段') + '</div>'
  } else if (state === 'list-empty') {
    results = '<div class="rbox">' + box('warn', 'result-empty',
      svg('building', 'currentColor', 26) + '当前筛选没有匹配的企业',
      ['少选两个条件再试；企业需<b>审核通过并发布</b>后才会进入目录。',
        '也可以直接去看岗位信息，那边按岗位而不是按企业组织。']) +
      '<div class="meta"><a class="chip press" href="?state=list-ready" data-testid="' + tid('clear-filter') + '">清除全部筛选</a>' +
      '<a class="chip press" href="26-browse-list.html" data-route="/jobs" data-testid="' + tid('to-jobs') + '">去岗位信息</a></div>' +
      guide('换条件的顺序', ['先放宽地区，再减少行业条件。', '来源不确定时只看已发布记录。', '也可以直接按岗位名称查找。']) + '</div>'
  } else if (state === 'list-error') {
    results = '<div class="rbox">' + box('error', 'result-error',
      svg('alert', 'currentColor', 26) + '企业目录没取到',
      ['列表与在招岗位数一起失败了。<b>数字不会退回到固定值</b>，也不会写 0 顶替。',
        '可以重试，或先去看岗位信息。']) +
      '<div class="meta"><a class="chip press" href="?state=list-ready" data-testid="' + tid('retry') + '">重试</a>' +
      '<a class="chip press" href="26-browse-list.html" data-route="/jobs" data-testid="' + tid('to-jobs') + '">去岗位信息</a></div>' +
      guide('目录失败时仍可继续', ['重试企业目录，不显示上一次缓存。', '直接浏览已审核发布的岗位。', '到招聘会列表查看真实参展名单。']) + '</div>'
  } else {
    var filtered = state === 'list-filtered'
    results = '<div class="rbox">' +
      '<div class="rhead"><span class="rn">已发布企业</span><span>共 ' + slot('—') + ' 条 · 在招岗位 ' + slot('—') + ' 个</span>' +
      '<span class="rsp">' + (filtered ? '条件：行业 · 智能制造' : COMPANY_BOUNDARY) + '</span></div>' +
      repeatRows(5, companyRow) +
      pager('每次加载 10 条；只有接口返回 nextCursor 时才显示此动作。', 'cursor') +
      '</div>'
  }
  var exception = state === 'list-loading' || state === 'list-empty' || state === 'list-error'
  return sec('01', '按条件找企业', '所有条件均对应真实 CompanyQuery',
    qbar('keyword', '搜索企业名称或岗位关键词', '搜索', 'list-filtered') +
    filterForm([
      filterInput('省份', 'province', '输入省级行政区全称'),
      filterInput('城市', 'city', '输入城市全称'),
      filterInput('区县', 'district', '输入区县全称'),
      selectInput('企业类型', 'companyType', '全部 12 类', COMPANY_TYPES),
      selectInput('所属行业', 'industry', '全部 18 个行业', COMPANY_INDUSTRIES),
      selectInput('招聘类型', 'recruitType', '全部招聘类型', COMPANY_RECRUIT_TYPES),
      selectInput('来源类型', 'sourceKind', '全部来源类型', COMPANY_SOURCES)
    ], 'list-filtered', '省市区在 React 中使用完整全国行政区划联动；静态页允许手动输入全称，不用几枚城市按钮冒充完整字典。')) +
  sec('02', '企业名单', '只列已审核发布企业', results, 'grow', true) +
  sec('', '', '', exception ? noteline('info', COMPANY_BOUNDARY) : aiInline(aiStep), 'last') +
  cta([ghost('16-service-hubs.html?hub=jobs', '/jobs-service', 'back-hub', '返回岗位服务'),
    primary('?state=list-filtered', '/companies', '按条件筛选')])
}

function companyDetail (state) {
  if (state === 'company-error') {
    return sec('', '', '', box('error', 'company-error', svg('alert', 'currentColor', 30) + '企业详情读取失败',
      ['企业资料和在招岗位这次没有取回，本机不会用缓存或相似企业顶替。', '可重试当前详情，或返回企业目录继续浏览。'])) +
    sec('', '仍然可以继续', '', exitList([
      stripItem('?state=company-ready', '/companies/:id', 'ce-retry', 'building', 'slate', '重新加载企业详情', '再次请求当前企业'),
      stripItem('?state=list-ready', '/companies', 'ce-list', 'list', 'teal', '返回企业目录', '按完整条件重新选择'),
      stripItem('26-browse-list.html', '/jobs', 'ce-jobs', 'brief', 'wheat', '岗位信息', '直接按岗位查找')
    ]), 'grow last', true) +
    cta([ghost('16-service-hubs.html?hub=jobs', '/jobs-service', 'ce-back', '返回岗位服务'),
      primary('?state=company-ready', '/companies/:id', '重新加载')])
  }
  if (state === 'company-not-found') {
    return sec('', '', '',
      box('warn', 'company-missing', svg('lock', 'currentColor', 30) + '企业详情不可用',
        ['这家企业可能<b>未发布、已下架，或这条链接已经失效</b>。',
          '本机不会拿同名企业或相似企业顶上来。',
          '回目录按行业和地区重新筛一次，或者直接去看岗位信息。'])) +
    sec('', '', '',
      guide('重选企业时核对', ['企业名称与来源名称是否一致。', '所在地区和行业是否符合当前方向。',
        '只有真实在招岗位返回后才进入岗位详情。'])) +
    sec('', '现在可以去哪', '都是本机真的能打开的页面', exitList([
      stripItem('?state=list-ready', '/companies', 'cnf-list', 'building', 'slate', '回企业目录', '按行业和地区重新筛'),
      stripItem('26-browse-list.html', '/jobs', 'cnf-jobs', 'brief', 'wheat', '看岗位信息', '直接按岗位找，不按企业找'),
      stripItem('28-jobfair-enhanced.html', '/job-fairs', 'cnf-fairs', 'booth', 'teal', '看招聘会', '现场参展企业名单'),
      stripItem('45-online-platform-directory.html', '/jobs/online-platforms', 'cnf-platforms', 'ext', 'clay',
        '线上招聘平台', '扫码去来源平台官网自己查')
    ]) + noteline('info', COMPANY_BOUNDARY), 'grow last', true) +
    cta([ghost('16-service-hubs.html?hub=jobs', '/jobs-service', 'cnf-back', '返回岗位服务'),
      primary('?state=list-ready', '/companies', '回企业目录重选')])
  }
  var sparse = state === 'company-sparse'
  var jobsBlock = sparse
    ? '<div class="rbox">' + box('warn', 'jobs-empty', svg('brief', 'currentColor', 30) + '该企业当前没有在招岗位',
      ['这是<b>确实为 0</b>，不是没查到。没有岗位就不放「查看在招岗位」的入口。',
        '可以回目录换一家，或去岗位信息里按岗位找。']) +
      titledStrip('下一步可以这样找', [
        stripItem('?state=list-ready', '/companies', 'sparse-list', 'building', 'slate', '回企业目录', '按行业和地区换一家'),
        stripItem('26-browse-list.html', '/jobs', 'sparse-jobs', 'brief', 'wheat', '去岗位信息', '按岗位名称直接找'),
        stripItem('28-jobfair-enhanced.html', '/job-fairs', 'sparse-fairs', 'booth', 'teal', '去招聘会', '看现场参展企业')
      ]) + '</div>'
    : '<div class="rbox">' +
      '<div class="rhead"><span class="rn">在招岗位</span><span>共 ' + slot('—') + ' 条</span>' +
      '<span class="rsp">' + COMPANY_BOUNDARY + '</span></div>' +
      repeatRows(5, function (i) {
        return link('27-browse-detail.html', '/jobs/:id', 'row-job' + (i ? '-' + i : ''), 'row solid',
          '<span class="row-ic" style="background:var(--wheat-soft);color:var(--wheat-d)">' + svg('brief', 'currentColor', 30) + '</span>' +
          '<span class="row-main"><span class="row-t">' + slot('岗位名称', true) + '</span>' +
          '<span class="row-sub"><span>' + svg('pin', 'currentColor', 20) + slot('工作地点') + '</span>' +
          '<span>' + svg('clock', 'currentColor', 20) + slot('有效期') + '</span></span></span>' +
          '<span class="row-go">' + svg('arrow', 'currentColor', 26) + '</span>')
      }) +
      '<div class="reason">「去来源平台投递」在岗位详情页按该岗位的来源链接单独放行，链接不合法就置灰。</div></div>'
  return sec('01', '企业资料', '缺哪项就不显示哪项',
    '<div class="blk"><div class="row-t" style="font-size:29px">' + slot('企业名称', true) + '</div>' +
    '<div class="row-sub" style="margin-top:9px"><span>' + svg('pin', 'currentColor', 20) + slot('省 · 市 · 区') + '</span>' +
    '<span>' + svg('shield', 'currentColor', 20) + '来源 ' + slot('—') + '</span></div>' +
    '<div style="height:14px"></div>' +
    kv([['企业类型', slot('—')], ['所属行业', slot('—')], ['招聘类型', slot('—')], ['企业地址', slot('—')],
      ['外部ID', slot('—')], ['同步时间', slot('—')]]) +
    '<div class="reason">数据来源说明：来源名称、外部ID 与同步时间随企业记录一起返回；缺哪项就空着，不写默认值，也不写「最新」。</div>' +
    '<div class="meta" style="margin-top:14px">' + off('source-home-disabled', 'chip', '去来源平台查看', tid('source-home-reason')) +
    '<span class="chip warn" id="' + tid('source-home-reason') + '">该来源未提供可用的链接，请到来源平台查询该企业</span></div></div>', '', true) +
  sec('02', '在招岗位', sparse ? '确实为 0，不是查不到' : '只列已发布岗位', jobsBlock, 'grow', true) +
  sec('', '', '', sparse ? noteline('info', COMPANY_BOUNDARY) : aiInline(aiStep), 'last') +
  cta([ghost('?state=list-ready', '/companies', 'company-back', '返回企业目录'),
    sparse ? why(tid('jobs-bar-reason'), '该企业当前没有在招岗位', 'why') +
      off('jobs-disabled-bar', 'btn primary', '查看在招岗位', tid('jobs-bar-reason'))
      : primary('27-browse-detail.html', '/jobs/:id', '查看在招岗位')])
}

/* ── 44 招聘会参展企业详情 ─────────────────────────────── */
var FAIR_BOUNDARY = '本机不接收简历、不代投递：投递扫码去来源平台，或现场到展位当面咨询。'
var FAIR_PRINT_NOTE = '打印企业资料与岗位清单需要后台支持，本机暂不可用；需要纸质资料请到前台咨询。'

function fairCompany (state) {
  if (state === 'loading') {
    return sec('', '', '',
      box('info', 'loading', '<span class="dot16 breathe"></span>正在读取该企业的展位与岗位',
        ['展位号、行业、岗位数量都等主办方名单返回；<b>取到之前不显示任何数字</b>。',
          '这段时间可以先回参展企业列表换一家看，或先把纸质简历打好。']) +
      skeletonRows(6, '展位与岗位字段'), 'grow') +
    sec('01', '这段时间可以先做什么', '', strip([
      stripItem('28-jobfair-enhanced.html', '/job-fairs/:id/companies', 'loading-list', 'booth', 'wheat',
        '回参展企业列表', '换一家企业或按展区找'),
      stripItem('12-file-source.html?source=document&tab=file', '/print/upload', 'loading-print', 'print', 'clay',
        '先打好自备简历', '现场投纸质简历常用')
    ]) + noteline('info', FAIR_BOUNDARY), 'last') +
    cta([primary('28-jobfair-enhanced.html', '/job-fairs/:id/companies', '返回参展企业列表')])
  }
  if (state === 'not-found' || state === 'error') {
    var nf = state === 'not-found'
    return sec('', '', '',
      box(nf ? 'warn' : 'error', nf ? 'company-missing' : 'company-error',
        svg(nf ? 'lock' : 'alert', 'currentColor', 30) + (nf ? '企业不在本场名单里' : '参展企业资料没读到'),
        [nf ? '这家企业<b>不在本场招聘会的参展名单</b>里，或者展位记录已被主办方撤下。'
          : '本场名单还在，但这家企业的资料<b>这次没取回来</b>。不会用上一次的缓存冒充当前结果。',
          '现场以主办方公布的展位图和名单为准，回列表重新选一家。'])) +
    sec('', '', '',
      guide('现场核对顺序', ['先看主办方展位图和企业全称。', '再看现场岗位牌或企业纸质清单。',
        '仍不一致时交给现场工作人员确认。'])) +
    sec('', '现在可以怎么办', '都是本机真的能打开的页面', exitList([
      stripItem('28-jobfair-enhanced.html', '/job-fairs/:id/companies', 'nf-list', 'booth', 'wheat',
        '参展企业列表', '回本场名单重新选一家'),
      stripItem('28-jobfair-enhanced.html', '/job-fairs/:id/map', 'nf-map', 'pin', 'teal',
        '展位图', '主办方给了真实图才展示'),
      stripItem('12-file-source.html?source=document&tab=file', '/print/upload', 'nf-print', 'print', 'clay',
        '先打好纸质简历', '展位现场收纸质简历很常见'),
      stripItem('06-help.html', '/help', 'nf-help', 'info', 'slate',
        '现场工作人员', '手上有主办方纸质名单')
    ]) + noteline('info', FAIR_BOUNDARY), 'grow last', true) +
    cta([ghost('06-help.html', '/help', 'nf-help-bar', '联系工作人员'),
      primary('28-jobfair-enhanced.html', '/job-fairs/:id/companies', '返回参展企业列表')])
  }
  if (state === 'qr') {
    return sec('', '', '',
      qrBlock('用手机扫码，在来源平台完成投递', slot('来源地址'),
        ['手机扫码打开来源平台的岗位页。', '在来源平台登录并投递，简历不经过这台机器。',
          '面试与结果由来源平台和企业通知你。'],
        '二维码按服务端返回的来源链接在运行时生成；静态原型不生成可扫描图形。' +
        '本机不接收简历、不代投递，也拿不到你的投递结果；离开前请关掉二维码，不把账号留在公共终端。'), 'grow qr-primary', true) +
    sec('01', '现场也可以直接去展位', '扫码不是唯一路径', strip([
      stripItem('?state=ready', '/job-fairs/:id/companies/:companyId', 'qr-back-detail', 'booth', 'wheat',
        '回企业详情看展位', '展位号与岗位清单都在详情页'),
      stripItem('12-file-source.html?source=document&tab=file', '/print/upload', 'qr-print', 'print', 'clay',
        '打一份纸质简历带过去', '展位现场收纸质简历很常见')
    ]), 'last') +
    cta([primary('?state=ready', '/job-fairs/:id/companies/:companyId', '关闭二维码')])
  }
  var blocked = state === 'source-incomplete'
  var empty = state === 'positions-empty'
  var positions = empty
    ? '<div class="rbox">' + box('warn', 'positions-empty', svg('brief', 'currentColor', 30) + '这家企业没有返回岗位清单',
      ['名单里有这家企业，但<b>岗位清单是空的</b>。本机不替它编现场岗位。',
        '到展位当面问，是这种情况下最靠谱的一条路。']) +
      guide('没有岗位清单时', ['到展位看现场岗位牌。', '询问岗位要求、到岗时间和联系方式。', '不把现场口头信息写成平台已发布岗位。']) +
      titledStrip('现在可以怎么办', [
        stripItem('28-jobfair-enhanced.html', '/job-fairs/:id/companies', 'empty-back', 'booth', 'wheat',
          '回参展企业列表', '换一家企业或按展区找'),
        stripItem('06-help.html', '/help', 'empty-help', 'info', 'slate',
          '联系工作人员', '按纸质名单帮你确认')
      ]) + '</div>'
    : '<div class="rbox">' +
      '<div class="rhead"><span class="rn">现场岗位</span><span>共 ' + slot('—') + ' 条</span>' +
      '<span class="rsp">' + FAIR_BOUNDARY + '</span></div>' +
      fgrp('筛选', 'positionField', [
        { value: 'location', text: '工作地点' },
        { value: 'education', text: '学历' },
        { value: 'experience', text: '经验' }
      ], state) +
      repeatRows(6, function (i) {
        return link('27-browse-detail.html', '/jobs/:id', 'row-position' + (i ? '-' + i : ''), 'row solid',
          '<span class="row-ic" style="background:var(--wheat-soft);color:var(--wheat-d)">' + svg('brief', 'currentColor', 30) + '</span>' +
          '<span class="row-main"><span class="row-t">' + slot('岗位名称', true) + '</span>' +
          '<span class="row-sub"><span>' + svg('pin', 'currentColor', 20) + slot('工作地点') + '</span>' +
          '<span>' + svg('shield', 'currentColor', 20) + slot('学历 / 经验') + '</span></span></span>' +
          '<span class="row-go">' + svg('arrow', 'currentColor', 26) + '</span>')
      }) + '</div>'
  return sec('01', '参展企业', '展位与岗位以主办方名单为准',
    '<div class="blk"><div class="row-t" style="font-size:29px">' + slot('企业名称', true) +
    (blocked ? '<span class="tag wheat">来源要素不足</span>' : '') + '</div>' +
    '<div style="height:14px"></div>' +
    tiles([['展位号', slot('—'), true], ['现场岗位', slot('—')], ['所属行业', slot('—')],
      ['来源链接', blocked ? '未返回' : slot('—')]]) +
    '</div>', '', true) +
  sec('02', '现场岗位', empty ? '名单里有企业，岗位清单为空' : '真实清单由主办方提供', positions, 'grow', true) +
  sec('', '', '', (empty ? noteline('info', FAIR_BOUNDARY) : aiInline(aiStep)) +
    noteline('print', FAIR_PRINT_NOTE, link('06-help.html', '/help', 'print-help', 'chip', '联系工作人员'), 'warn'), 'last') +
  cta(blocked
    ? [off('apply-qr-blocked', 'btn ghost', '扫码投递', tid('apply-reason')),
      why(tid('apply-reason'), '该来源未提供可用的投递链接，请到来源平台查询该职位', 'why'),
      off('apply-open-blocked', 'btn primary', '去来源平台投递', tid('apply-reason'))]
    : [ghost('28-jobfair-enhanced.html', '/job-fairs/:id/companies', 'fair-back', '返回列表'),
      /* 原来这里并列两个按钮，href 都是 ?state=qr、行为完全一致，也没说明区别。
         只留主 CTA；措辞沿用 27 页口径，不写「扫码投递」以免暗示码已经生成。 */
      primary('?state=qr', '/job-fairs/:id/companies/:companyId', svg('ext', 'currentColor', 26) + '去来源平台投递')])
}

/* ── 45 线上招聘平台目录 ───────────────────────────────── */
/* 名称、分类与官网域名逐字取自运行时硬编码清单
   apps/kiosk/src/pages/jobs/OnlinePlatformsPage.tsx（PLATFORMS 常量），
   不是 Admin 审核结果，也不代表任何合作关系。 */
var PLATFORMS = [
  { k: 'boss', n: 'Boss直聘', c: '直聘平台', d: 'www.zhipin.com' },
  { k: '51job', n: '前程无忧', c: '综合平台', d: 'www.51job.com' },
  { k: 'zhilian', n: '智联招聘', c: '综合平台', d: 'www.zhaopin.com' },
  { k: 'liepin', n: '猎聘', c: '中高端平台', d: 'www.liepin.com' }
]
var PLATFORM_BOUNDARY = '浏览、登录和投递都在来源平台完成，本机不接收简历，也不记录你在平台上的操作。'
function platformRow (p, blocked) {
  var reasonId = tid('platform-reason-' + p.k)
  var head = '<span class="plat-ic">' + p.n.slice(0, 1) + '</span>' +
    '<span class="plat-main"><span class="plat-kicker">第三方官网入口</span><span class="plat-n">' + p.n + '<span class="tag slate">' + p.c + '</span>' +
    (blocked ? '<span class="tag wheat">入口已停用</span>' : '') + '</span>' +
    '<span class="plat-d">' + p.d + '</span></span>' +
    // 停用的入口不再摆「扫码打开 / 在官网继续浏览」这类可用流程提示，同一行位只写停用原因
    (blocked
      ? '<span class="plat-flow plat-blocked" id="' + reasonId + '">未通过来源校验，本机不会为它生成二维码</span>'
      : '<span class="plat-flow"><span>' + svg('qr', 'currentColor', 22) + '手机扫码打开</span><span>' +
        svg('ext', 'currentColor', 22) + '在官网继续浏览</span></span>')
  if (blocked) {
    return '<div class="plat" aria-disabled="true" role="group" data-testid="' + tid('platform-' + p.k) + '">' + head +
      off('platform-open-' + p.k, 'plat-go', svg('qr', 'currentColor', 24) + '扫码打开来源平台', reasonId) + '</div>'
  }
  return link('?state=qr&p=' + p.k, '/jobs/online-platforms', 'platform-' + p.k, 'plat',
    head + '<span class="plat-go">' + svg('qr', 'currentColor', 24) + '扫码打开来源平台</span>')
}
function platformDirectory (state) {
  if (state === 'navigator') {
    return sec('01', 'AI 找岗方向', '快捷选项只是起点，自由文本负责补齐',
      box('info', 'navigator-boundary', svg('chat', 'currentColor', 28) + '只整理方向和检索词',
        ['不展示虚构岗位，不给匹配分数，不读取浏览记录或历史画像。',
          '静态稿不发起模型调用；确认后才进入 AI 求职方向探索。']) +
      fgrp('关注领域', 'field', [
        '互联网与产品', '运营与市场', '销售与客户服务', '制造与工程', '行政与人事', '财务与商务'
      ], 'navigator') +
      filterForm([
        filterInput('关注领域', 'fieldText', '可填写任意岗位或行业方向'),
        filterInput('工作地点', 'cityText', '可填写任意城市、区域或远程倾向'),
        filterInput('当前阶段', 'stageText', '可填写应届、经验年限或转行背景'),
        filterInput('补充说明', 'note', '课程、项目、技能或希望避开的工作方式')
      ], 'navigator', '四个自由文本字段可补充快捷选项未覆盖的内容；补充说明按 React 合同最多 300 字。'),
      'grow', true) +
    sec('02', '当前填写内容', '未填写的项目明确保留为空',
      '<div class="blk">' + kv([
        ['关注领域', esc(query.get('fieldText') || query.get('field') || '暂未指定')],
        ['工作地点', esc(query.get('cityText') || '暂未指定')],
        ['当前阶段', esc(query.get('stageText') || '暂未指定')],
        ['补充说明', esc((query.get('note') || '暂未填写').slice(0, 300))]
      ]) + '<div class="reason">确认前不会发起 AI 调用，也不会把这些文本交给来源平台。</div></div>', 'last') +
    cta([ghost('?state=ready', '/jobs/online-platforms', 'navigator-back', '返回平台列表'),
      primary('05-ai-cockpit.html?intent=career_explore', '/assistant?intent=career_explore', '确认并开始 AI 方向探索')])
  }
  if (state === 'invalid-platform') {
    return sec('', '', '', box('warn', 'invalid-platform', svg('alert', 'currentColor', 30) + '平台参数无效',
      ['平台标识不在当前固定清单中，因此不会生成二维码。', '返回列表重新选择四个已列出的官网入口。'])) +
    sec('', '仍然可以继续', '', exitList([
      stripItem('?state=ready', '/jobs/online-platforms', 'ip-list', 'list', 'slate', '返回平台列表', '重新选择固定官网入口'),
      stripItem('?state=navigator', '/jobs/online-platforms', 'ip-nav', 'chat', 'teal', 'AI 找岗方向', '先整理岗位方向和检索词'),
      stripItem('26-browse-list.html', '/jobs', 'ip-jobs', 'brief', 'wheat', '岗位信息', '查看已审核发布岗位')
    ]), 'grow last', true) + cta([primary('?state=ready', '/jobs/online-platforms', '返回平台列表')])
  }
  if (state === 'qr') {
    // 选了哪个平台必须写出来：扫错码就等于打开了另一家平台的官网
    var pk = new URLSearchParams(location.search).get('p')
    var picked = null
    for (var pi = 0; pi < PLATFORMS.length; pi++) if (PLATFORMS[pi].k === pk) picked = PLATFORMS[pi]
    if (!picked) return platformDirectory('invalid-platform')
    return sec('', '', '',
      qrBlock('用手机扫码打开 ' + picked.n + ' 官网',
        '<b>' + picked.d + '</b>',
        ['手机扫码，在浏览器里打开平台官网。', '浏览岗位、登录、投递都在该平台完成。',
          '本机不接收简历，也不记录你在平台上的操作。'],
        '二维码在运行时按内置官网地址生成；静态原型不生成可扫描图形。本机与这些平台没有数据对接，也不是合作关系；' +
        '离开前请关掉二维码，不把账号留在公共终端。'), 'grow qr-primary', true) +
    sec('01', '也可以不扫码', '', strip([
      stripItem('?state=ready', '/jobs/online-platforms', 'qr-back', 'list', 'slate', '回平台入口', '换一个来源平台'),
      stripItem('26-browse-list.html', '/jobs', 'qr-jobs', 'brief', 'wheat', '看岗位信息', '本机已审核发布的岗位')
    ]), 'last') +
    cta([primary('?state=ready', '/jobs/online-platforms', '关闭二维码')])
  }
  return sec('01', '选择来源平台', '当前 React 固定展示 4 个官网入口',
    '<div class="platform-grid" data-testid="' + tid('list') + '">' +
    PLATFORMS.map(function (p) { return platformRow(p, false) }).join('') + '</div>' +
    noteline('shield', '<b>' + PLATFORM_BOUNDARY + '</b>',
      link('26-browse-list.html', '/jobs', 'alt-jobs', 'chip', '看岗位信息')) +
    titledStrip('还不确定搜什么', [
      stripItem('?state=navigator', '/jobs/online-platforms', 'open-navigator', 'chat', 'teal',
        'AI 找岗方向', '快捷选项加自由填写，确认后再进入 AI 对话')
    ]), 'grow platform-primary', true) +
  cta([ghost('16-service-hubs.html?hub=jobs', '/jobs-service', 'back-hub', '返回岗位服务'),
    primary('26-browse-list.html', '/jobs', '去看岗位信息')])
}

/* ── 各宿主注册表 ─────────────────────────────────────── */
var PAGES = {
  'offline-agency': {
    title: { list: '线下招聘机构', agency: '机构详情', job: '线下岗位' },
    states: ['list-ready', 'list-loading', 'list-filtered', 'list-empty', 'list-error',
      'agency-ready', 'agency-jobs-empty', 'agency-not-found', 'agency-error', 'job-ready', 'job-source-incomplete'],
    pill: {
      'list-ready': ['', '已发布机构名单'],
      'list-loading': ['', '正在读取机构名单'],
      'list-filtered': ['', '已按检索方式重新取名单'],
      'list-empty': ['warn', '当前条件没有匹配机构'],
      'list-error': ['bad', '机构名单读取失败'],
      'agency-ready': ['', '机构资料 · 以门店公示为准'],
      'agency-jobs-empty': ['warn', '机构已发布 · 当前岗位为 0'],
      'agency-not-found': ['warn', '机构未发布或链接已失效'],
      'agency-error': ['bad', '机构详情读取失败'],
      'job-ready': ['', '线下岗位 · 自行到店咨询'],
      'job-source-incomplete': ['bad', '来源要素不完整 · 已停用外跳']
    },
    head: {
      'list-ready': ['list', '先缩小范围，再看已发布的机构名单。'],
      'list-loading': ['list', '正在读取名单，取到之前不显示机构名称或数量。'],
      'list-filtered': ['list', '已按检索方式重新取名单，条件只改请求参数。'],
      'list-empty': ['list', '这些条件没有匹配的门店，换个条件再试。'],
      'list-error': ['list', '名单没取到，不会拿示例机构顶替真实结果。'],
      'agency-ready': ['agency', '地址、营业时间和服务项目以机构依法公示为准。'],
      'agency-jobs-empty': ['agency', '机构资料可用，但当前没有已发布岗位。'],
      'agency-not-found': ['agency', '未发布、已下架或链接过期，回目录重选一次。'],
      'agency-error': ['agency', '详情请求失败，不用缓存或示例内容顶替。'],
      'job-ready': ['job', '先看岗位信息，再决定要不要自行到店咨询。'],
      'job-source-incomplete': ['job', '缺少可核对的来源要素，外跳和到店指引一律不给。']
    },
    render: function (s) {
      if (s.indexOf('list-') === 0) return offlineList(s)
      if (s.indexOf('agency-') === 0) return offlineAgency(s)
      return offlineJob(s)
    }
  },
  'company-directory': {
    title: { list: '找企业', company: '企业详情' },
    states: ['list-ready', 'list-loading', 'list-filtered', 'list-empty', 'list-error',
      'company-ready', 'company-sparse', 'company-not-found', 'company-error'],
    pill: {
      'list-ready': ['', '已审核发布的企业'],
      'list-loading': ['', '正在读取企业目录'],
      'list-filtered': ['', '已按筛选条件重新请求'],
      'list-empty': ['warn', '当前筛选没有匹配企业'],
      'list-error': ['bad', '企业目录读取失败'],
      'company-ready': ['', '企业资料 · 以来源同步为准'],
      'company-sparse': ['warn', '该企业当前没有在招岗位'],
      'company-not-found': ['warn', '企业未发布或链接已失效'],
      'company-error': ['bad', '企业详情读取失败']
    },
    head: {
      'list-ready': ['list', '先定行业和地区，再看企业与在招岗位。'],
      'list-loading': ['list', '企业列表与在招岗位数一起返回，取到之前不显示数字。'],
      'list-filtered': ['list', '已按筛选条件重新请求，条件只改请求参数。'],
      'list-empty': ['list', '这些条件没有企业，少选两个条件再试。'],
      'list-error': ['list', '目录没取到，数字不会退回固定值。'],
      'company-ready': ['company', '资料、岗位与来源主页缺哪项就不显示哪项。'],
      'company-sparse': ['company', '这家企业当前没有在招岗位，确实为 0。'],
      'company-not-found': ['company', '未发布、已下架或链接失效，不拿同名企业顶替。'],
      'company-error': ['company', '企业详情请求失败，不用缓存冒充当前结果。']
    },
    render: function (s) { return s.indexOf('list-') === 0 ? companyList(s) : companyDetail(s) }
  },
  'fair-company': {
    title: { d: '招聘会参展企业' },
    states: ['ready', 'loading', 'qr', 'positions-empty', 'source-incomplete', 'not-found', 'error'],
    pill: {
      ready: ['', '展位与岗位以主办方名单为准'],
      loading: ['', '正在读取参展企业资料'],
      qr: ['', '扫码后在来源平台完成投递'],
      'positions-empty': ['warn', '该企业未返回岗位清单'],
      'source-incomplete': ['bad', '来源投递链接不可用 · 已置灰'],
      'not-found': ['warn', '企业不在本场参展名单'],
      error: ['bad', '参展企业资料读取失败']
    },
    head: {
      ready: ['d', '先看展位和现场岗位，再安排逛展路线。'],
      loading: ['d', '正在读取展位与岗位，取到之前不显示数字。'],
      qr: ['d', '扫码去来源平台投递，简历不经过这台机器。'],
      'positions-empty': ['d', '名单里有这家企业，但岗位清单是空的。'],
      'source-incomplete': ['d', '来源投递链接不可用，两个投递按钮都已置灰。'],
      'not-found': ['d', '本场名单里没有这家企业，回列表重新选。'],
      error: ['d', '企业资料这次没取回，不用缓存冒充当前结果。']
    },
    render: fairCompany
  },
  'online-platform': {
    title: { d: '线上招聘平台' },
    states: ['ready', 'navigator', 'qr', 'invalid-platform'],
    pill: {
      ready: ['', '4 个固定官网入口'],
      navigator: ['', '本人填写后再确认进入 AI 对话'],
      qr: ['', '扫码后在来源平台自行浏览'],
      'invalid-platform': ['warn', '平台参数无效 · 不生成二维码']
    },
    head: {
      ready: ['d', '选一个固定官网入口，扫码后在手机上打开。'],
      navigator: ['d', '快捷选项不是完整字典，可用自由文本补充任意方向。'],
      qr: ['d', '扫码打开官网，浏览、登录和投递都在该平台完成。'],
      'invalid-platform': ['d', '平台标识不在固定清单中，返回列表重新选择。']
    },
    render: platformDirectory
  }
}

/* ── 壳层：状态渲染、页内 AI 交互、时钟、缩放、演示控制 ── */
var page = PAGES[window.DW_SCREEN]
if (page) {
  SCREEN = window.DW_SCREEN
  var root = document.getElementById('body-root')
  var query = new URLSearchParams(location.search)
  var requestedState = query.get('state')
  var invalidState = requestedState && page.states.indexOf(requestedState) < 0
  var state = invalidState ? 'illegal' : (requestedState || page.states[0])

  root.setAttribute('data-state', state)
  root.setAttribute('data-testid', SCREEN + '-state-' + state)
  root.innerHTML = invalidState ? illegalState(requestedState) : page.render(state)
  root.classList.add('action-enter')

  var pill = document.getElementById('pill')
  var pillState = invalidState ? ['warn', '页面状态参数无效'] : page.pill[state]
  pill.className = 'pill' + (pillState[0] ? ' ' + pillState[0] : '')
  document.getElementById('pill-txt').textContent = pillState[1]
  document.getElementById('pill-dot').className = 'dot' + (/loading/.test(state) ? ' breathe' : '')
  var titleEl = document.getElementById('task-title')
  var subEl = document.getElementById('task-sub')
  if (invalidState) {
    if (titleEl) titleEl.textContent = '链接不可用'
    if (subEl) subEl.textContent = '参数不属于当前页面，请返回有效入口。'
  } else {
    if (titleEl) titleEl.textContent = page.title[page.head[state][0]]
    if (subEl) subEl.innerHTML = page.head[state][1]
  }

  /* 演示面板：只切 data-state，不驱动任何业务结果 */
  var panel = document.getElementById('demo-panel')
  panel.innerHTML = '<div class="dp-t">原型演示控制</div>' + page.states.map(function (s) {
    return '<a href="?state=' + s + '" data-s="' + s + '"' + (s === state ? ' class="on"' : '') + '>' + s + '</a>'
  }).join('')
  document.getElementById('demo-tab').addEventListener('click', function () { panel.classList.toggle('show') })
  if (query.get('debug') === '1') {
    document.documentElement.classList.add('debug')
    Array.prototype.forEach.call(panel.querySelectorAll('a'), function (a) {
      a.href = '?debug=1&state=' + a.getAttribute('data-s')
    })
  }

  var stage = document.getElementById('stage')

  /* 置灰控件真的不放行：拦截冒泡阶段之前的点击 */
  stage.addEventListener('click', function (event) {
    var blocked = event.target.closest('[aria-disabled="true"]')
    if (!blocked) return
    event.preventDefault()
    event.stopPropagation()
  }, true)

  /* 页内 AI：只在用户主动点选后改变自身状态，不发请求、不读文件、不生成结果 */
  var repaintAi = function (step) {
    aiStep = step
    var host = stage.querySelector('.ai-inline')
    if (!host) return
    host.outerHTML = aiInline(step)
    if (step === 'goal') {
      var input = stage.querySelector('[data-ai-input]')
      if (input) input.focus()
    }
  }
  stage.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-ai]')
    if (!btn || btn.getAttribute('aria-disabled') === 'true') return
    var act = btn.getAttribute('data-ai')
    if (act === 'resume') repaintAi('resume-missing')
    else if (act === 'goal') repaintAi('goal')
    else if (act === 'run') repaintAi('unavailable')
    else if (act === 'reset') repaintAi('need-input')
  })
  /* 本地必填校验：填了方向才允许触发，仍然不代表模型可用 */
  stage.addEventListener('input', function (event) {
    var field = event.target.closest('[data-ai-input]')
    if (!field) return
    var ok = field.value.trim().length > 0
    var run = stage.querySelector('.ai-run')
    var reason = stage.querySelector('#' + SCREEN + '-ai-reason')
    var note = stage.querySelector('[data-ai-ready-note]')
    if (run) run.setAttribute('aria-disabled', ok ? 'false' : 'true')
    if (reason) reason.hidden = ok
    if (note) note.hidden = !ok
  })

  /* 触屏回馈：只给确实可操作的元素短促按压态，不截获链接，也不假装请求已经完成。 */
  var pressSelector = 'a, button:not([aria-disabled="true"])'
  var releasePress = function (event) {
    var active = stage.querySelector('.is-pressing')
    if (active) active.classList.remove('is-pressing')
  }
  stage.addEventListener('pointerdown', function (event) {
    var control = event.target.closest(pressSelector)
    if (!control || control.closest('[aria-disabled="true"]')) return
    releasePress()
    control.classList.add('is-pressing')
  })
  stage.addEventListener('pointerup', releasePress)
  stage.addEventListener('pointercancel', releasePress)
  stage.addEventListener('pointerleave', releasePress)

  /* 时钟：只刷新顶栏时间文本，不推进任何业务状态 */
  var tick = function () {
    var d = new Date()
    document.getElementById('clock').textContent = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2)
  }
  tick(); setInterval(tick, 20000)

  var fit = function () {
    var s = Math.min(innerWidth / 1080, innerHeight / 1920)
    document.getElementById('stage').style.transform = 'translate(-50%,-50%) scale(' + s + ')'
  }
  fit(); addEventListener('resize', fit)
  if (query.get('flat') === '1') document.getElementById('stage').classList.add('flat')
}
})()
