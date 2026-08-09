/* ============================================================
   V3 · 图标体系（icon 库）
   ------------------------------------------------------------
   统一规格：24×24 网格 / stroke 1.75 / round cap+join / 无填充。
   同一族几何：圆角 2px、笔画对齐半像素网格、视觉重心一致。
   零外部依赖：本文件把 <symbol> 注入 DOM，页面用 <use> 引用。
   用法：<svg class="ic"><use href="#i-printer"/></svg>
   ============================================================ */
;(function () {
  var I = {
    /* — 业务 — */
    printer: '<path d="M6.5 9V4.5h11V9"/><rect x="3.5" y="9" width="17" height="7.5" rx="2"/><path d="M6.5 16.5h11v3H6.5z"/><circle cx="17.5" cy="12" r=".9"/>',
    scan: '<path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5"/><path d="M4 12h16"/>',
    resume: '<path d="M14 3.5H7a1.8 1.8 0 0 0-1.8 1.8v13.4A1.8 1.8 0 0 0 7 20.5h10a1.8 1.8 0 0 0 1.8-1.8V8.3z"/><path d="M14 3.5V8h4.8"/><path d="M8.6 12.5h6.8M8.6 16h4.4"/>',
    briefcase: '<rect x="3.2" y="7.6" width="17.6" height="12" rx="2"/><path d="M9 7.6V6a1.6 1.6 0 0 1 1.6-1.6h2.8A1.6 1.6 0 0 1 15 6v1.6"/><path d="M3.2 12.4h17.6"/><path d="M10.4 12.4v1.4h3.2v-1.4"/>',
    fair: '<rect x="3.4" y="5.6" width="17.2" height="14" rx="2"/><path d="M3.4 10h17.2M8.2 3.6v3.4M15.8 3.6v3.4"/><path d="M7.6 13.6h3v3h-3z"/><path d="M13.6 14.4h3"/>',
    interview: '<path d="M12 4.2a2.6 2.6 0 0 1 2.6 2.6v3.4a2.6 2.6 0 0 1-5.2 0V6.8A2.6 2.6 0 0 1 12 4.2z"/><path d="M6.6 10.6a5.4 5.4 0 0 0 10.8 0"/><path d="M12 16v3.8M9 19.8h6"/>',
    policy: '<path d="M4 20h16"/><path d="M5.6 20V9.6M18.4 20V9.6M9.4 20v-5.4h5.2V20"/><path d="M3.4 9.6 12 4.4l8.6 5.2z"/>',
    company: '<path d="M4.6 20V6.2a1.6 1.6 0 0 1 1.6-1.6h6.4a1.6 1.6 0 0 1 1.6 1.6V20"/><path d="M14.2 10.4h3.6A1.6 1.6 0 0 1 19.4 12v8"/><path d="M3.2 20h17.6"/><path d="M7.8 8.2h3M7.8 11.6h3M7.8 15h3"/>',
    campus: '<path d="M12 4 2.8 8.2 12 12.4l9.2-4.2z"/><path d="M6.4 10.4v4.4c0 1.7 2.5 3 5.6 3s5.6-1.3 5.6-3v-4.4"/><path d="M20.6 9.2v5"/>',
    toolbox: '<rect x="3.4" y="7.4" width="17.2" height="12.2" rx="2"/><path d="M8.8 7.4V5.8A1.6 1.6 0 0 1 10.4 4.2h3.2a1.6 1.6 0 0 1 1.6 1.6v1.6"/><path d="M3.4 13.2h6M15 13.2h5.6"/><rect x="9" y="11.4" width="6" height="3.6" rx="1"/>',
    agency: '<path d="M4.4 20V9.4l7.6-5 7.6 5V20"/><path d="M2.8 20h18.4"/><path d="M9.4 20v-6.2h5.2V20"/><path d="M8 9.8h8"/>',

    /* — AI（刻意不用星星/魔法棒：那是通用 AI 皮） — */
    orbit: '<circle cx="12" cy="12" r="3.1"/><ellipse cx="12" cy="12" rx="9" ry="4.4" transform="rotate(-28 12 12)"/><circle cx="19.4" cy="8.6" r="1.5"/>',
    brain: '<path d="M12 5.4v13.2"/><path d="M12 7.2A2.8 2.8 0 0 0 6.6 8a2.6 2.6 0 0 0-1.4 4.5A2.8 2.8 0 0 0 7 17.4a2.6 2.6 0 0 0 5 .6"/><path d="M12 7.2A2.8 2.8 0 0 1 17.4 8a2.6 2.6 0 0 1 1.4 4.5A2.8 2.8 0 0 1 17 17.4a2.6 2.6 0 0 1-5 .6"/>',
    target: '<circle cx="12" cy="12" r="7.6"/><circle cx="12" cy="12" r="3.6"/><path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6"/>',
    route: '<circle cx="6" cy="18.4" r="2.2"/><circle cx="18" cy="5.6" r="2.2"/><path d="M8.2 18.4h4.6a3.4 3.4 0 0 0 0-6.8H11a3.4 3.4 0 0 1 0-6.8h4.8"/>',

    /* — 导航 / 通用 — */
    home: '<path d="M4 10.4 12 4l8 6.4V19a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 19z"/><path d="M9.6 20.6v-6h4.8v6"/>',
    user: '<circle cx="12" cy="8.4" r="3.6"/><path d="M4.8 20.2a7.6 7.6 0 0 1 14.4 0"/>',
    arrowRight: '<path d="M4.6 12h14.8"/><path d="M13.6 6.2 19.4 12l-5.8 5.8"/>',
    external: '<path d="M14.4 4.6h5v5"/><path d="M19.4 4.6 11.6 12.4"/><path d="M17.6 13.6v4.8a1.6 1.6 0 0 1-1.6 1.6H6a1.6 1.6 0 0 1-1.6-1.6V8.4A1.6 1.6 0 0 1 6 6.8h4.8"/>',
    chevron: '<path d="M9.4 5.6 15.8 12l-6.4 6.4"/>',
    check: '<path d="M4.8 12.6 9.6 17.4 19.2 6.6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.4V12l3.4 2"/>',
    shield: '<path d="M12 3.6 5 6.2v5.2c0 4 2.9 7.6 7 9 4.1-1.4 7-5 7-9V6.2z"/><path d="M9.2 12.2 11.4 14.4l4-4.2"/>',
    info: '<circle cx="12" cy="12" r="8.2"/><path d="M12 11v5.2M12 8.1v.1"/>',
    alert: '<path d="M12 4.4 21 19.6H3z"/><path d="M12 9.6v4.2M12 16.6v.1"/>',
    offline: '<path d="M3 4.2 21 20.4"/><path d="M6.4 10.2a10 10 0 0 1 3-1.7M2.6 7.4A15 15 0 0 1 8 4.4M12 16.6v.1"/><path d="M9.4 13.6a5.4 5.4 0 0 1 2-1.1M16.6 10.6a10 10 0 0 1 1 .6M21.4 7.4a15 15 0 0 0-6.8-3"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.4V9h-4.6"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.4"/><path d="M15.6 15.6 20 20"/>',
    qr: '<rect x="4" y="4" width="6.4" height="6.4" rx="1.4"/><rect x="13.6" y="4" width="6.4" height="6.4" rx="1.4"/><rect x="4" y="13.6" width="6.4" height="6.4" rx="1.4"/><path d="M13.6 13.6h2.6v2.6h-2.6zM17.8 17.8H20V20h-2.2z"/>',
    upload: '<path d="M12 15.6V4.8"/><path d="M7.6 9.2 12 4.8l4.4 4.4"/><path d="M4.4 15.2v3a2 2 0 0 0 2 2h11.2a2 2 0 0 0 2-2v-3"/>',
    download: '<path d="M12 4.8v10.8"/><path d="M7.6 11.2 12 15.6l4.4-4.4"/><path d="M4.4 15.2v3a2 2 0 0 0 2 2h11.2a2 2 0 0 0 2-2v-3"/>',
    usb: '<path d="M12 20.4V7.6"/><circle cx="12" cy="5" r="1.8"/><path d="M12 13.4l3.6-2.2V8.6"/><path d="M15.6 6.4h2.2v2.2h-2.2z"/><path d="M12 16l-3.6-2.2v-2.6"/><circle cx="8.4" cy="10" r="1.6"/>',
    phone: '<rect x="6.6" y="2.8" width="10.8" height="18.4" rx="2.4"/><path d="M10.6 18.4h2.8"/>',
    mic: '<rect x="9.4" y="3.4" width="5.2" height="9.6" rx="2.6"/><path d="M6.4 11.4a5.6 5.6 0 0 0 11.2 0"/><path d="M12 17v3.6"/>',
    pen: '<path d="M16.2 4.6l3.2 3.2-9.6 9.6-4 .8.8-4z"/><path d="M14 6.8l3.2 3.2"/>',
    card: '<rect x="3" y="5.6" width="18" height="12.8" rx="2.2"/><path d="M3 10h18"/><path d="M6.6 14.4h3.2"/>',
    package: '<path d="M20.4 8.2v7.6a1.8 1.8 0 0 1-.9 1.5l-6.6 3.6a1.8 1.8 0 0 1-1.8 0l-6.6-3.6a1.8 1.8 0 0 1-.9-1.5V8.2"/><path d="M3.9 7.4 12 3.2l8.1 4.2L12 11.6z"/><path d="M12 11.6v9"/>',
    file: '<path d="M13.6 3.6H7.2A1.8 1.8 0 0 0 5.4 5.4v13.2a1.8 1.8 0 0 0 1.8 1.8h9.6a1.8 1.8 0 0 0 1.8-1.8V8z"/><path d="M13.6 3.6V8h4.9"/>',
    folder: '<path d="M3.6 7.4a1.8 1.8 0 0 1 1.8-1.8h3.4l2 2.6h7.8a1.8 1.8 0 0 1 1.8 1.8v7.6a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8z"/>',
    layers: '<path d="M12 3.4 3.6 7.6 12 11.8l8.4-4.2z"/><path d="M3.6 12.2 12 16.4l8.4-4.2"/><path d="M3.6 16.6 12 20.8l8.4-4.2"/>',
    bookmark: '<path d="M6.6 4.4h10.8v16l-5.4-3.8-5.4 3.8z"/>',
    bell: '<path d="M6.8 10.4a5.2 5.2 0 0 1 10.4 0c0 4 1.6 5.6 1.6 5.6H5.2s1.6-1.6 1.6-5.6z"/><path d="M10.2 19a2 2 0 0 0 3.6 0"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.4v2M12 18.6v2M4.9 7.8l1.7 1M17.4 15.2l1.7 1M4.9 16.2l1.7-1M17.4 8.8l1.7-1"/><circle cx="12" cy="12" r="8.4"/>',
    ticket: '<path d="M3.4 9.4V7a1.6 1.6 0 0 1 1.6-1.6h14a1.6 1.6 0 0 1 1.6 1.6v2.4a2.6 2.6 0 0 0 0 5.2V17a1.6 1.6 0 0 1-1.6 1.6H5A1.6 1.6 0 0 1 3.4 17v-2.4a2.6 2.6 0 0 0 0-5.2z"/><path d="M12 8v8"/>',
    history: '<path d="M4 12a8 8 0 1 0 8-8 8 8 0 0 0-6.7 3.7"/><path d="M4 4.4V9h4.6"/><path d="M12 8.4V12l3 1.8"/>',
    trash: '<path d="M4.6 7.4h14.8"/><path d="M9.4 7.4V5.6h5.2v1.8"/><path d="M6.4 7.4l.9 11.4a1.6 1.6 0 0 0 1.6 1.4h6.2a1.6 1.6 0 0 0 1.6-1.4l.9-11.4"/>',
    help: '<circle cx="12" cy="12" r="8.2"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.7"/><path d="M12 16.6v.1"/>',
    book: '<path d="M4.4 5.2A1.6 1.6 0 0 1 6 3.6h4.4A1.6 1.6 0 0 1 12 5.2v15a1.6 1.6 0 0 0-1.6-1.6H4.4z"/><path d="M19.6 5.2A1.6 1.6 0 0 0 18 3.6h-4.4A1.6 1.6 0 0 0 12 5.2v15a1.6 1.6 0 0 1 1.6-1.6h6z"/>',
    map: '<path d="M9.4 4.4 4 6.6v13l5.4-2.2 5.2 2.2 5.4-2.2v-13L14.6 6.6z"/><path d="M9.4 4.4v13M14.6 6.6v13"/>',
    pin: '<path d="M12 21c3.6-4.2 6-7 6-10a6 6 0 1 0-12 0c0 3 2.4 5.8 6 10z"/><circle cx="12" cy="10.6" r="2.2"/>',
    users: '<circle cx="9.2" cy="8.6" r="3.2"/><path d="M3.4 19.4a5.9 5.9 0 0 1 11.6 0"/><path d="M15.6 6.2a3.2 3.2 0 0 1 0 6.2M17 19.4a5.6 5.6 0 0 0-1.2-3.4"/>',
    eye: '<path d="M2.6 12S6 6.4 12 6.4 21.4 12 21.4 12 18 17.6 12 17.6 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="2.8"/>',
    idcard: '<rect x="2.8" y="5.4" width="18.4" height="13.2" rx="2.2"/><circle cx="8.6" cy="11" r="2.1"/><path d="M5.4 16.2a3.6 3.6 0 0 1 6.4 0"/><path d="M14.8 10.4h3.8M14.8 13.6h3.8"/>',
    image: '<rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.2"/><circle cx="8.8" cy="9.8" r="1.7"/><path d="M4 16.6l4.6-4 3.6 3.2 3-2.6 4.4 3.8"/>',
    building: '<rect x="4.6" y="3.6" width="14.8" height="16.8" rx="1.8"/><path d="M8.4 7.4h2.2M13.4 7.4h2.2M8.4 11h2.2M13.4 11h2.2M8.4 14.6h2.2M13.4 14.6h2.2"/><path d="M10.4 20.4v-2.8h3.2v2.8"/>'
  }

  var head = '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden">'
  var body = ''
  for (var k in I) {
    body += '<symbol id="i-' + k + '" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
            ' stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + I[k] + '</symbol>'
  }
  var host = document.createElement('div')
  host.setAttribute('data-sprite', 'v3')
  host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
  host.innerHTML = head + body + '</svg>'
  ;(document.body || document.documentElement).insertBefore(host, (document.body || document.documentElement).firstChild)
})()
