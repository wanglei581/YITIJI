// 打印流程的实物小样插画。照第 5 版稿 ui.js 的画法，颜色全走 CSS 类（见 print-art.css），源码里不写色值。
// 返回 SVG 字符串，由 PrintArt 组件以 aria-hidden 方式放进页面；内容全是常量，不含用户数据。

function lines(x: number, y: number, w: number, rows: number, gap: number, cls: string, widths: readonly number[]): string {
  let s = ''
  for (let i = 0; i < rows; i += 1) {
    const ww = w * (widths[i % widths.length] ?? 1)
    s += `<rect class="${cls}" x="${x}" y="${y + i * gap}" width="${ww}" height="${Math.max(3, gap * 0.34)}" rx="2"/>`
  }
  return s
}

export function resumeArt(w = 200): string {
  const h = Math.round(w * 1.414)
  const p = w * 0.1
  const inner = w - p * 2
  const g = w * 0.052
  let s = `<svg class="pa-svg pa-shadow" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">`
  s += `<rect class="a-w" x="0" y="0" width="${w}" height="${h}" rx="${w * 0.05}"/>`
  s += `<rect class="a-ink" x="${p}" y="${p}" width="${inner * 0.46}" height="${g * 1.15}" rx="3"/>`
  s += `<rect class="a-g2" x="${p}" y="${p + g * 1.7}" width="${inner * 0.7}" height="${g * 0.45}" rx="2"/>`
  const secs = [p + g * 3.4, p + g * 7.6, p + g * 12.2]
  const lw = [1, 0.86, 0.94, 0.72, 0.9, 0.64]
  secs.forEach((sy, k) => {
    s += `<rect class="a-t" x="${p}" y="${sy}" width="${inner * 0.26}" height="${g * 0.55}" rx="2"/>`
    s += lines(p, sy + g * 1.1, inner, k === 2 ? 3 : 4, g * 0.78, 'a-g1', lw)
  })
  return `${s}</svg>`
}

export function stackArt(w = 200, n = 3): string {
  const h = Math.round(w * 1.2)
  let s = `<svg class="pa-svg" width="${w + 30}" height="${h + 30}" viewBox="0 0 ${w + 30} ${h + 30}" aria-hidden="true">`
  for (let i = n - 1; i >= 0; i -= 1) {
    s += `<rect class="${i === 0 ? 'a-w' : 'a-w2'} a-edge" x="${i * 12}" y="${30 - i * 12}" width="${w}" height="${h}" rx="10"/>`
  }
  s += lines(w * 0.12, 30 + h * 0.14, w * 0.76, 7, h * 0.1, 'a-g1', [1, 0.8, 0.92, 0.7])
  return `${s}</svg>`
}

export function phoneArt(w = 150): string {
  const h = Math.round(w * 1.9)
  let s = `<svg class="pa-svg" width="${w}" height="${h}" viewBox="0 0 150 285" aria-hidden="true">`
  s += '<rect class="a-ink" x="6" y="4" width="138" height="277" rx="24"/><rect class="a-paper" x="14" y="20" width="122" height="245" rx="14"/>'
  s += '<rect class="a-ink2" x="58" y="10" width="34" height="5" rx="2.5"/>'
  s += '<rect class="a-w a-edge2" x="34" y="70" width="58" height="76" rx="8"/><path class="a-nofill a-edge2" d="M76 70v18h16"/>'
  s += '<rect class="a-g1" x="44" y="104" width="38" height="5" rx="2"/><rect class="a-g1" x="44" y="116" width="30" height="5" rx="2"/>'
  s += '<circle class="a-t" cx="104" cy="180" r="22"/><path class="a-arrow" d="M104 192v-24M94 177l10-10 10 10"/>'
  s += '<rect class="a-deep" x="30" y="222" width="90" height="26" rx="13"/>'
  return `${s}</svg>`
}

export function usbArt(w = 150): string {
  return `<svg class="pa-svg" width="${w}" height="${w}" viewBox="0 0 150 150" aria-hidden="true">
      <rect class="a-m1" x="18" y="86" width="114" height="46" rx="10"/><rect class="a-ink" x="40" y="100" width="70" height="18" rx="4"/>
      <rect class="a-t" x="54" y="20" width="42" height="56" rx="8"/><rect class="a-m3 a-edge3" x="60" y="74" width="30" height="30" rx="3"/><rect class="a-m2" x="66" y="80" width="6" height="6"/><rect class="a-m2" x="78" y="80" width="6" height="6"/>
      <path class="a-arrow-clay" d="M75 6v8M68 10l7 7 7-7"/></svg>`
}

export function scanPaperArt(w = 150): string {
  return `<svg class="pa-svg" width="${w}" height="${w}" viewBox="0 0 150 150" aria-hidden="true">
      <rect class="a-m1" x="10" y="64" width="130" height="62" rx="12"/><rect class="a-m2" x="10" y="52" width="130" height="18" rx="7"/>
      <rect class="a-w a-edge2" x="34" y="18" width="70" height="56" rx="6" transform="rotate(-8 69 46)"/>
      <rect class="a-g1" x="46" y="32" width="40" height="5" rx="2" transform="rotate(-8 69 46)"/><rect class="a-g1" x="46" y="44" width="30" height="5" rx="2" transform="rotate(-8 69 46)"/>
      <rect class="a-mint" x="22" y="96" width="106" height="6" rx="3"/></svg>`
}

/** 打印机正面示意：只画机身，不演出纸。 */
export function mfpArt(): string {
  return `<svg class="pa-svg" width="620" height="600" viewBox="0 0 620 600" aria-hidden="true">
      <defs><linearGradient id="paMfpB" x1="0" y1="0" x2="0" y2="1"><stop class="a-grad-a" offset="0"/><stop class="a-grad-b" offset="1"/></linearGradient></defs>
      <rect class="a-m4a a-edge4" x="70" y="40" width="480" height="70" rx="18"/>
      <rect class="a-edge4" fill="url(#paMfpB)" x="60" y="100" width="500" height="380" rx="30"/>
      <rect class="a-ink" x="420" y="128" width="112" height="64" rx="12"/><rect class="a-t a-dim" x="432" y="140" width="62" height="40" rx="6"/><circle class="a-mint" cx="512" cy="160" r="8"/>
      <rect class="a-ink" x="130" y="250" width="360" height="22" rx="11"/>
      <rect class="a-mint a-glow" x="150" y="256" width="320" height="10" rx="5"/>
      <path class="a-m5 a-edge5" d="M110 440h400l-30 70H140z"/>
      <rect class="a-m4" x="90" y="505" width="440" height="22" rx="11"/>
    </svg>`
}

/** 倒计时圆环：pct 是剩余比例 0–1。 */
export function ringArt(pct: number, size = 96, stroke = 8): string {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle class="a-ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/><circle class="a-ring-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/></svg>`
}
