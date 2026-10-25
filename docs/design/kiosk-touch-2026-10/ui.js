/* 公共部件：图标、插画、意图带、底部按区、导航。全部返回 HTML 字符串。 */
(function () {
  const P = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
    printer: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
    landmark: '<path d="M3 21h18"/><path d="M5 21V10M9.5 21V10M14.5 21V10M19 21V10"/><path d="M2.5 10 12 4l9.5 6z"/>',
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M4 12h16"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    usb: '<path d="M9 2h6v6H9z"/><path d="M7 8h10v9a5 5 0 0 1-10 0z"/><path d="M10.5 4.5v1M13.5 4.5v1"/>',
    ticket: '<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M9 8v1.5M9 11.25v1.5M9 14.5V16"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    pen: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    sparkle: '<path d="M12 3l1.8 4.6 4.7 1.8-4.7 1.8L12 16l-1.8-4.8-4.7-1.8 4.7-1.8z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    chevR: '<path d="m9 6 6 6-6 6"/>', chevL: '<path d="m15 6-6 6 6 6"/>',
    arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>', arrowD: '<path d="M12 4v16M6 14l6 6 6-6"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>', check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2h.01"/>',
    call: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14"/><path d="M12 17h.01"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6L20 8"/><path d="M20 3v5h-5"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    message: '<path d="M4 5h16v11H9l-5 4z"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M9 7h6"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M8.5 10h7M8.5 14h7M8.5 18h4"/>',
    layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M17 21h4v-4M14 21v-3"/>',
    skip: '<path d="m5 5 8 7-8 7z"/><path d="M19 5v14"/>',
    sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9a4 4 0 0 1 0 6"/>',
    erase: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    swap: '<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>',
    idcard: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="8.5" cy="11" r="2.2"/><path d="M5.5 16c.6-1.6 1.7-2.4 3-2.4s2.4.8 3 2.4M14 10h4.5M14 13.5h3"/>',
    wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><path d="M12 19.5h.01"/>',
    hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-.5a5.5 5.5 0 0 1-4.6-2.5L3.6 14a1.5 1.5 0 0 1 2.5-1.7L8 15"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>'
  };
  function icon(n, s = 32, w = 2) {
    return `<svg class="i" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;
  }

  /* ── 插画：都是「带走什么」的实物小样 ── */
  function lines(x, y, w, rows, gap, color, widths) {
    let s = '';
    for (let i = 0; i < rows; i++) {
      const ww = w * (widths ? widths[i % widths.length] : 1);
      s += `<rect x="${x}" y="${y + i * gap}" width="${ww}" height="${Math.max(3, gap * 0.34)}" rx="2" fill="${color}"/>`;
    }
    return s;
  }
  function resume(w = 200, state = 'plain') {
    const h = Math.round(w * 1.414), p = w * 0.1, inner = w - p * 2, g = w * 0.052;
    let s = `<svg class="illus paper-shadow" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">`;
    s += `<rect x="0" y="0" width="${w}" height="${h}" rx="${w * 0.05}" fill="#fff"/>`;
    s += `<rect x="${p}" y="${p}" width="${inner * 0.46}" height="${g * 1.15}" rx="3" fill="#13231e"/>`;
    s += `<rect x="${p}" y="${p + g * 1.7}" width="${inner * 0.7}" height="${g * 0.45}" rx="2" fill="#b9c3bf"/>`;
    const secs = [p + g * 3.4, p + g * 7.6, p + g * 12.2];
    const lw = [1, .86, .94, .72, .9, .64];
    secs.forEach((sy, k) => {
      s += `<rect x="${p}" y="${sy}" width="${inner * 0.26}" height="${g * 0.55}" rx="2" fill="#1f9e86"/>`;
      s += lines(p, sy + g * 1.1, inner, k === 2 ? 3 : 4, g * 0.78, '#d9ded9', lw);
    });
    if (state === 'blank') {
      s = `<svg class="illus paper-shadow" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><rect width="${w}" height="${h}" rx="${w * 0.05}" fill="#fff"/>`;
      for (let i = 0; i < 9; i++) s += `<rect x="${p}" y="${p + g * 1.5 * i + g}" width="${inner * (i % 3 === 0 ? .45 : .92)}" height="2" fill="${i % 3 === 0 ? '#1f9e86' : '#d9ded9'}" stroke-dasharray="4 4"/>`;
      s += `<g transform="translate(${w * .58} ${h * .62}) rotate(-35)"><rect x="0" y="0" width="${w * .5}" height="${w * .1}" rx="${w * .05}" fill="#0b241e"/><path d="M0 0 L${-w * .09} ${w * .05} L0 ${w * .1} z" fill="#b8683c"/></g>`;
      return s + '</svg>';
    }
    if (state === 'annot') {
      const marks = [[secs[0] + g * 1.1, .9], [secs[0] + g * 2.66, .7], [secs[1] + g * 1.1, .8], [secs[1] + g * 3.44, .55], [secs[2] + g * 1.88, .6]];
      marks.forEach((m, i) => {
        s += `<rect x="${p - 2}" y="${m[0] - 2}" width="${inner * m[1] + 4}" height="${g * 0.34 + 4}" rx="3" fill="rgba(184,104,60,.28)"/>`;
        s += `<circle cx="${w - p * 0.55}" cy="${m[0] + g * 0.16}" r="${g * 0.62}" fill="#b8683c"/><text x="${w - p * 0.55}" y="${m[0] + g * 0.16}" dy=".35em" text-anchor="middle" font-size="${g * 0.86}" font-weight="700" fill="#fff" font-family="sans-serif">${i + 1}</text>`;
      });
    }
    if (state === 'fixed') {
      [[secs[0] + g * 1.1, .92], [secs[0] + g * 2.66, .78], [secs[1] + g * 1.1, .84], [secs[2] + g * 1.88, .66]].forEach(m => {
        s += `<rect x="${p - 2}" y="${m[0] - 2}" width="${inner * m[1] + 4}" height="${g * 0.34 + 4}" rx="3" fill="rgba(31,158,134,.30)"/>`;
      });
      s += `<circle cx="${w - p * 1.2}" cy="${p + g * 0.6}" r="${g * 1.05}" fill="#1f9e86"/><path d="M${w - p * 1.2 - g * .45} ${p + g * .6} l${g * .32} ${g * .32} l${g * .6} ${-g * .6}" stroke="#fff" stroke-width="${g * .22}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    return s + '</svg>';
  }
  function report(w = 200) {
    const h = Math.round(w * 1.414), p = w * .1, inner = w - p * 2, g = w * .052;
    let s = `<svg class="illus paper-shadow" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><rect width="${w}" height="${h}" rx="${w * .05}" fill="#fff"/>`;
    s += `<rect x="${p}" y="${p}" width="${inner * .62}" height="${g * 1.1}" rx="3" fill="#13231e"/>`;
    s += `<rect x="${p}" y="${p + g * 1.7}" width="${inner * .42}" height="${g * .45}" rx="2" fill="#b9c3bf"/>`;
    [[.82, '#1f9e86'], [.64, '#1f9e86'], [.48, '#b8683c']].forEach((b, i) => {
      const y = p + g * (3.4 + i * 1.5);
      s += `<rect x="${p}" y="${y}" width="${inner}" height="${g * .62}" rx="${g * .31}" fill="#eef1ee"/><rect x="${p}" y="${y}" width="${inner * b[0]}" height="${g * .62}" rx="${g * .31}" fill="${b[1]}"/>`;
    });
    for (let i = 0; i < 5; i++) {
      const y = p + g * (8.6 + i * 1.45);
      s += `<circle cx="${p + g * .4}" cy="${y + g * .2}" r="${g * .32}" fill="${i < 3 ? '#1f9e86' : '#b8683c'}"/>`;
      s += `<rect x="${p + g * 1.2}" y="${y}" width="${inner * [.8, .66, .74, .7, .58][i]}" height="${g * .4}" rx="2" fill="#d9ded9"/>`;
    }
    return s + '</svg>';
  }
  function checklist(w = 200) {
    const h = Math.round(w * 1.414), p = w * .1, inner = w - p * 2, g = w * .052;
    let s = `<svg class="illus paper-shadow" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><rect width="${w}" height="${h}" rx="${w * .05}" fill="#fff"/>`;
    s += `<rect x="${p}" y="${p}" width="${inner * .56}" height="${g * 1.1}" rx="3" fill="#13231e"/><rect x="${p}" y="${p + g * 1.7}" width="${inner * .36}" height="${g * .45}" rx="2" fill="#3f68b0"/>`;
    for (let i = 0; i < 7; i++) {
      const y = p + g * (3.6 + i * 1.6);
      s += `<rect x="${p}" y="${y}" width="${g * .9}" height="${g * .9}" rx="3" fill="none" stroke="#3f68b0" stroke-width="2"/>`;
      if (i < 3) s += `<path d="M${p + g * .2} ${y + g * .48} l${g * .22} ${g * .22} l${g * .38} ${-g * .42}" stroke="#3f68b0" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
      s += `<rect x="${p + g * 1.5}" y="${y + g * .25}" width="${inner * [.7, .54, .76, .6, .66, .5, .62][i]}" height="${g * .42}" rx="2" fill="#d9ded9"/>`;
    }
    return s + '</svg>';
  }
  function stack(w = 200, n = 3, badge = '') {
    const h = Math.round(w * 1.2);
    let s = `<svg class="illus" width="${w + 30}" height="${h + 30}" viewBox="0 0 ${w + 30} ${h + 30}" aria-hidden="true">`;
    for (let i = n - 1; i >= 0; i--) {
      s += `<rect x="${i * 12}" y="${30 - i * 12 + 0}" width="${w}" height="${h}" rx="10" fill="${i === 0 ? '#fff' : '#f6f4ee'}" stroke="rgba(11,36,30,.12)" stroke-width="1.5"/>`;
    }
    s += lines(w * .12, 30 + h * .14, w * .76, 7, h * .1, '#d9ded9', [1, .8, .92, .7]);
    if (badge) s += `<rect x="${w * .5}" y="${h * .78}" width="${w * .5}" height="${h * .2}" rx="${h * .1}" fill="#0b241e"/><text x="${w * .75}" y="${h * .88}" dy=".35em" text-anchor="middle" fill="#f6f3ea" font-size="${h * .1}" font-weight="700" font-family="sans-serif">${badge}</text>`;
    return s + '</svg>';
  }
  function phone(w = 150, state = 'up') {
    const h = Math.round(w * 1.9);
    let s = `<svg class="illus" width="${w}" height="${h}" viewBox="0 0 150 285" aria-hidden="true">`;
    s += `<rect x="6" y="4" width="138" height="277" rx="24" fill="#13231e"/><rect x="14" y="20" width="122" height="245" rx="14" fill="#f5f2e9"/>`;
    s += `<rect x="58" y="10" width="34" height="5" rx="2.5" fill="#33423d"/>`;
    s += `<rect x="34" y="70" width="58" height="76" rx="8" fill="#fff" stroke="#c9d1cd" stroke-width="2"/><path d="M76 70v18h16" fill="none" stroke="#c9d1cd" stroke-width="2"/>`;
    s += `<rect x="44" y="104" width="38" height="5" rx="2" fill="#d9ded9"/><rect x="44" y="116" width="30" height="5" rx="2" fill="#d9ded9"/>`;
    s += `<circle cx="104" cy="180" r="22" fill="#1f9e86"/><path d="M104 192v-24M94 177l10-10 10 10" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    s += `<rect x="30" y="222" width="90" height="26" rx="13" fill="#0b241e"/><text x="75" y="235" dy=".35em" text-anchor="middle" fill="#f6f3ea" font-size="13" font-weight="700" font-family="sans-serif">上传</text>`;
    return s + '</svg>';
  }
  function usb(w = 150) {
    return `<svg class="illus" width="${w}" height="${w}" viewBox="0 0 150 150" aria-hidden="true">
      <rect x="18" y="86" width="114" height="46" rx="10" fill="#c9cfcc"/><rect x="40" y="100" width="70" height="18" rx="4" fill="#13231e"/>
      <g class="usb-in"><rect x="54" y="20" width="42" height="56" rx="8" fill="#1f9e86"/><rect x="60" y="74" width="30" height="30" rx="3" fill="#dfe5e2" stroke="#9aa6a1" stroke-width="2"/><rect x="66" y="80" width="6" height="6" fill="#9aa6a1"/><rect x="78" y="80" width="6" height="6" fill="#9aa6a1"/></g>
      <path d="M75 6v8M68 10l7 7 7-7" stroke="#b8683c" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  function scanPaper(w = 150) {
    return `<svg class="illus" width="${w}" height="${w}" viewBox="0 0 150 150" aria-hidden="true">
      <rect x="10" y="64" width="130" height="62" rx="12" fill="#c9cfcc"/><rect x="10" y="52" width="130" height="18" rx="7" fill="#9aa6a1"/>
      <rect x="34" y="18" width="70" height="56" rx="6" fill="#fff" stroke="#c9d1cd" stroke-width="2" transform="rotate(-8 69 46)"/>
      <rect x="46" y="32" width="40" height="5" rx="2" fill="#d9ded9" transform="rotate(-8 69 46)"/><rect x="46" y="44" width="30" height="5" rx="2" fill="#d9ded9" transform="rotate(-8 69 46)"/>
      <rect x="22" y="96" width="106" height="6" rx="3" fill="#2ee6a8"/></svg>`;
  }
  function idcard(w = 150) {
    return `<svg class="illus" width="${w}" height="${Math.round(w * .66)}" viewBox="0 0 150 99" aria-hidden="true">
      <rect x="3" y="3" width="144" height="93" rx="10" fill="#e6ecf6" stroke="#3f68b0" stroke-width="2"/>
      <rect x="14" y="18" width="40" height="52" rx="6" fill="#c8d4ea"/><circle cx="34" cy="38" r="9" fill="#9fb2d8"/><path d="M20 66c2-9 8-13 14-13s12 4 14 13" fill="#9fb2d8"/>
      <rect x="66" y="22" width="64" height="7" rx="3" fill="#9fb2d8"/><rect x="66" y="38" width="50" height="7" rx="3" fill="#c8d4ea"/><rect x="66" y="54" width="58" height="7" rx="3" fill="#c8d4ea"/><rect x="14" y="78" width="116" height="7" rx="3" fill="#c8d4ea"/></svg>`;
  }
  function mfp() {
    // 打印机正面示意：上盖、操作面板、出纸口、出纸托盘（纸张由 app.js 按真实张数下落）
    return `<svg class="illus" width="620" height="600" viewBox="0 0 620 600" aria-hidden="true">
      <defs><linearGradient id="mfpB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef0ee"/><stop offset="1" stop-color="#cfd5d2"/></linearGradient></defs>
      <rect x="70" y="40" width="480" height="70" rx="18" fill="#dfe4e1" stroke="#b9c2be" stroke-width="2"/>
      <rect x="60" y="100" width="500" height="380" rx="30" fill="url(#mfpB)" stroke="#b9c2be" stroke-width="2"/>
      <rect x="420" y="128" width="112" height="64" rx="12" fill="#13231e"/><rect x="432" y="140" width="62" height="40" rx="6" fill="#1f9e86" opacity=".85"/><circle cx="512" cy="160" r="8" fill="#2ee6a8"/>
      <rect x="130" y="250" width="360" height="22" rx="11" fill="#13231e"/>
      <rect class="slot-glow" x="150" y="256" width="320" height="10" rx="5" fill="#2ee6a8" opacity=".35"/>
      <path d="M110 440h400l-30 70H140z" fill="#c3cbc7" stroke="#aab4af" stroke-width="2"/>
      <rect x="90" y="505" width="440" height="22" rx="11" fill="#aab4af"/>
    </svg>`;
  }
  function qr(seed = 7, size = 360) {
    const n = 29, cell = size / n;
    let r = seed * 9301 + 49297, out = '';
    const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
    const finder = (x, y) => x < 8 && y < 8 || x > n - 9 && y < 8 || x < 8 && y > n - 9;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (finder(x, y)) continue;
      if (x > 11 && x < 17 && y > 11 && y < 17) continue;
      if (rnd() > .52) out += `M${x * cell} ${y * cell}h${cell}v${cell}h${-cell}z`;
    }
    const f = (x, y) => `<rect x="${x * cell + cell * .5}" y="${y * cell + cell * .5}" width="${cell * 6}" height="${cell * 6}" rx="${cell * 1.2}" fill="none" stroke="#0b241e" stroke-width="${cell}"/><rect x="${x * cell + cell * 2}" y="${y * cell + cell * 2}" width="${cell * 3}" height="${cell * 3}" rx="${cell * .6}" fill="#0b241e"/>`;
    return `<svg class="illus" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="示例二维码，不能扫"><path d="${out}" fill="#0b241e"/>${f(0, 0)}${f(n - 7, 0)}${f(0, n - 7)}
      <rect x="${cell * 12}" y="${cell * 12}" width="${cell * 5}" height="${cell * 5}" rx="${cell}" fill="#1f9e86"/><text x="${size / 2}" y="${size / 2}" dy=".36em" text-anchor="middle" font-size="${cell * 2.6}" font-weight="900" fill="#fff" font-family="serif">职</text></svg>`;
  }
  function ring(pct, size = 96, stroke = 8, color = '#1f9e86', track = 'rgba(11,36,30,.1)') {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/><circle class="arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/></svg>`;
  }
  function flowLines(h = 600) {
    return `<div class="flow"><svg viewBox="0 0 1200 ${h}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="fl1" x1="0" x2="1"><stop offset="0" stop-color="#2ee6a8" stop-opacity="0"/><stop offset=".5" stop-color="#2ee6a8" stop-opacity=".55"/><stop offset="1" stop-color="#2ee6a8" stop-opacity="0"/></linearGradient></defs>
      <path d="M-20 ${h * .78} C 260 ${h * .5}, 520 ${h * .98}, 820 ${h * .62} S 1150 ${h * .3}, 1240 ${h * .44}" fill="none" stroke="url(#fl1)" stroke-width="2.2"/>
      <path d="M-20 ${h * .9} C 300 ${h * .66}, 560 ${h * 1.06}, 860 ${h * .74} S 1160 ${h * .46}, 1240 ${h * .58}" fill="none" stroke="url(#fl1)" stroke-width="1.2" opacity=".7"/>
      <path d="M-20 ${h * .36} C 340 ${h * .12}, 640 ${h * .5}, 900 ${h * .26} S 1180 ${h * .02}, 1240 ${h * .14}" fill="none" stroke="url(#fl1)" stroke-width="1" opacity=".45"/>
    </svg></div>`;
  }

  /* ── 骨架 ── */
  function seal(state = 'idle', cls = '') { return `<div class="seal ${cls} ${state === 'listen' ? 'listen' : state === 'think' ? 'think' : ''}" aria-hidden="true">青</div>`; }
  function clock() {
    return `<div class="clock"><b data-clock="t">14:30</b><small data-clock="d">10月25日 周日</small></div>`;
  }
  function header(o = {}) {
    const st = o.status === false ? '' : status(o.status);
    return `<div class="hdr">${o.back ? `<button class="back" data-act="back" aria-label="返回上一步">${icon('chevL', 34, 2.4)}</button>` : ''}
      <div class="brand"><div class="mark">职</div><div><b>职易达</b><small>${o.place || '就业服务大厅'}</small></div></div>
      <div class="right">${st}${clock()}</div></div>`;
  }
  function status(s) {
    const st = window.S || {};
    if (s && s.text) return `<span class="status ${s.warn ? 'warn' : ''}"><i class="dot"></i>${s.text}</span>`;
    if (st.printer === 'down') return `<span class="status warn"><i class="dot"></i>打印机暂时连不上</span>`;
    return `<span class="status"><i class="dot"></i>打印机就绪</span>`;
  }
  function band(o) {
    const kind = o.kind || 'std';
    const rail = o.rail ? `<div class="rail">${o.rail.labels.map((l, i) => `<div class="st ${i < o.rail.now ? 'done' : i === o.rail.now ? 'now' : ''}"><div class="bar"></div><span>${i < o.rail.now ? '✓ ' : ''}${l}</span></div>`).join('')}</div>` : '';
    return `<header class="band ${kind} ${o.live ? 'flowing' : ''}">
      ${flowLines(kind === 'hero' ? 700 : 460)}<div class="halo"></div>
      ${header({ back: o.back !== false, status: o.status, place: o.place })}
      <div class="ask"><div class="t">${o.eyebrow ? `<div class="eyebrow">${o.eyebrow}</div>` : ''}<h1>${o.title}</h1>${o.sub ? `<p>${o.sub}</p>` : ''}</div>${o.sealHtml !== undefined ? o.sealHtml : (o.seal === null ? '' : seal(o.seal || 'idle'))}</div>
      ${rail}${o.path ? `<div class="pathline"><span class="pl-k">${o.pathLabel || '一共 ' + o.path.length + ' 步'}</span>${o.path.map((l, i) => `<span class="pl"><b>${i + 1}</b>${l}</span>`).join('<i>→</i>')}</div>` : ''}</header>`;
  }
  function dock(o = {}) {
    let s = '<footer class="dock">';
    if (o.left) s += o.left;
    else if (o.back !== false) s += `<button class="btn sec" data-act="back">${icon('chevL', 30, 2.4)}${o.backLabel || '返回'}</button>`;
    if (o.ask !== false) s += `<button class="askq" data-go="xq" data-ctx="${(o.ask || '').replace(/"/g, '')}"><span class="mic">${icon('mic', 30, 2.2)}</span><span>${o.ask || '问小青：这一步怎么办？'}</span></button>`;
    if (o.mid) s += o.mid;
    if (o.pri) s += `<button class="btn ${o.pri.kind || 'pri'} ${o.ask === false && !o.mid ? 'wide' : ''}" ${attrs(o.pri)} ${o.pri.disabled ? 'disabled' : ''}>${o.pri.label}${o.pri.noArrow ? '' : icon('arrowR', 30, 2.4)}</button>`;
    return s + '</footer>';
  }
  function attrs(a) {
    let s = '';
    if (a.go) s += ` data-go="${a.go}"`;
    if (a.act) s += ` data-act="${a.act}"`;
    if (a.arg !== undefined) s += ` data-arg="${a.arg}"`;
    if (a.id) s += ` id="${a.id}"`;
    return s;
  }
  function nav(active) {
    const it = [['home', '首页', 'home'], ['xq', '问小青', 'sparkle'], ['me', '我的', 'user']];
    return `<nav class="nav">${it.map(([k, l, ic]) => `<button class="${active === k ? 'on' : ''}" data-go="${k === 'me' ? 'me' : k}" ${active === k ? 'aria-current="page"' : ''}>${icon(ic, 36, 2)}<span>${l}</span></button>`).join('')}</nav>`;
  }
  function slab(o) {
    return `<button class="slab ${o.dark ? 'dark' : ''} ${o.row ? 'row' : ''} ${o.off ? 'off' : ''} rise" style="--i:${o.i || 0}" ${attrs(o)}>
      ${o.row ? `<div class="vis">${o.vis || ''}</div>` : ''}
      <div class="txt">${o.chip ? `<span class="chip ${o.chipKind || ''} ${o.ai ? 'ai' : ''}">${o.chip}</span>` : ''}<h3>${o.title}</h3><p>${o.desc}</p>
      ${o.lock ? `<span class="lock">${o.lock}</span>` : ''}
      ${o.take ? `<div class="take">${icon('check', 26, 2.6)}<span>带走：${o.take}</span><span class="go">${icon('arrowR', 30, 2.4)}</span></div>` : `<div class="take"><span class="go">${icon('arrowR', 30, 2.4)}</span></div>`}</div>
      ${o.row ? '' : `<div class="vis">${o.vis || ''}</div>`}</button>`;
  }
  function tile(o) {
    return `<button class="tile ${o.off ? 'off' : ''} rise" style="--i:${o.i || 0}" ${attrs(o)}><span class="ic ${o.tone || ''}">${icon(o.icon, 34, 2)}</span><span class="tx"><b>${o.title}</b><small>${o.desc}</small></span><span class="chev">${icon('chevR', 30, 2.2)}</span></button>`;
  }

  window.UI = { icon, resume, report, checklist, stack, phone, usb, scanPaper, idcard, mfp, qr, ring, flowLines, seal, header, band, dock, nav, slab, tile, attrs, status, clock };
})();
