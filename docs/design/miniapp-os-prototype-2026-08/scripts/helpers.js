;(function () {
  const icon = (name, cls = '') =>
    `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`
  const badge = (text, tone = '') => `<span class="badge ${tone}">${text}</span>`
  const statusbar = () =>
    `<div class="statusbar"><span>9:41</span><span class="status-icons">5G&nbsp; ◼︎</span></div>`
  const nav = (title, right = '') =>
    `<div class="mini-nav"><button class="nav-icon" data-back aria-label="返回">${icon('back')}</button><h2>${title}</h2><button class="nav-text">${right}</button></div>`
  const tabs = (active) => `<div class="tabbar">
    ${[
      ['today', 'home', '今天', 'T01'],
      ['materials', 'file', '材料', 'M01'],
      ['discover', 'compass', '发现', 'D01'],
      ['mine', 'user', '我的', 'U01'],
    ]
      .map(
        ([key, ic, label, id]) =>
          `<button class="${active === key ? 'active' : ''}" data-go="${id}">${icon(ic)}<span>${label}</span></button>`
      )
      .join('')}
  </div>`
  const fab = () =>
    `<button class="ai-fab" data-go="A01" aria-label="打开小青助手">${icon('spark')}</button>`
  const screen = ({ body, tab, title, right = '', bare = false, action = '', className = '' }) =>
    `<section class="mini-screen ${className}">${statusbar()}${bare ? '' : nav(title, right)}${body}${action}${tab ? tabs(tab) + fab() : ''}</section>`
  const section = (title, body, more = '') =>
    `<section class="section"><div class="section-head"><h3>${title}</h3>${more ? `<button>${more}</button>` : ''}</div>${body}</section>`
  const row = ({ iconName = 'file', tone = '', title, sub = '', value = '', go = '' }) =>
    `<div class="row" ${go ? `data-go="${go}" role="button" tabindex="0"` : ''}><span class="icon-tile ${tone}">${icon(iconName)}</span><div class="row-main"><div class="row-title">${title}</div>${sub ? `<div class="row-sub">${sub}</div>` : ''}</div>${value ? `<span class="row-value">${value}</span>` : ''}${go ? icon('arrow') : ''}</div>`
  const notice = (text, tone = '', iconName = 'lock') =>
    `<div class="notice ${tone}">${icon(iconName)}<span>${text}</span></div>`
  const actionbar = (primary, go, secondary = '', secondaryGo = '') =>
    `<div class="actionbar"><div class="${secondary ? 'button-row' : ''}">${secondary ? `<button class="secondary-button" ${secondaryGo ? `data-go="${secondaryGo}"` : ''}>${secondary}</button>` : ''}<button class="primary-button button-block" ${go ? `data-go="${go}"` : ''}>${primary}</button></div></div>`
  const source = (name, time, id) =>
    `<div class="source-box"><b>来源：</b>${name}<br><b>更新时间：</b>${time}　<b>外部 ID：</b>${id}</div>`
  const steps = (items, active) =>
    `<div class="stepper">${items.map((item, i) => `<div class="step ${i < active ? 'done' : i === active ? 'active' : ''}"><i></i>${item}</div>`).join('')}</div>`
  const paper = () => `<div class="paper-preview">${'<i></i>'.repeat(7)}</div>`
  const pageBand = (eyebrow, title, subtitle, tone = '') =>
    `<div class="page-band ${tone}"><div class="eyebrow">${icon('spark')}${eyebrow}</div><h1 class="page-title">${title}</h1><p class="page-subtitle">${subtitle}</p></div>`

  window.Proto = {
    screens: [],
    icon,
    badge,
    statusbar,
    nav,
    tabs,
    fab,
    screen,
    section,
    row,
    notice,
    actionbar,
    source,
    steps,
    paper,
    pageBand,
  }
})()
