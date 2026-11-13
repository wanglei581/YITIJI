/* reduce-toggle-1112.js：页内「减弱动效」开关（2026-11-12 补稿；产品负责人看过首页底部关、开两张图后选「放首页底部」）。
 * 位置：首页底部身份与状态行，「设备状态」左边。可点区域 64px 高，跟同一行的小按钮同一种样子。
 * 开：这次使用期间不播装饰动画（换页滑入、按下水波、招呼逐字、待机浮动、各处演示循环都停在静止样子，和 ?reduced=1 一样）；
 * 结束使用（清场）或进待机后恢复成默认，下一位不继承上一位的选择。地址带 ?reduced=1 的演示不受影响。 */
(function () {
  'use strict';
  const S = () => window.S || {};
  const Q = new URLSearchParams(location.search);
  const css = document.createElement('style');
  css.textContent = `.d3-mini.m-rm{gap:10px}.d3-mini.m-rm i{width:40px;height:24px;border-radius:12px;background:var(--line);position:relative;flex:none}
.d3-mini.m-rm i::after{content:"";position:absolute;left:3px;top:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.d3-mini.m-rm[aria-pressed="true"]{border-color:var(--deep)}.d3-mini.m-rm[aria-pressed="true"] i{background:var(--deep)}.d3-mini.m-rm[aria-pressed="true"] i::after{left:19px}`;
  document.head.appendChild(css);
  const app = () => document.getElementById('app');
  const set = (on) => { S().mReduce = on; const a = app(); if (a && Q.get('reduced') !== '1') a.classList.toggle('reduced', on); };
  const home = (window.SCREENS || []).find((s) => s.id === 'home');
  if (home) {
    const r0 = home.render;
    home.render = () => r0().replace('<button class="d3-mini" data-go="offline">设备状态</button>',
      `<button class="d3-mini m-rm" data-m-rm aria-pressed="${!!S().mReduce}"><i aria-hidden="true"></i>减弱动效</button><button class="d3-mini" data-go="offline">设备状态</button>`);
  }
  /* 清场、待机：复位 */
  ['cleared', 'standby'].forEach((id) => {
    const d = (window.SCREENS || []).find((s) => s.id === id); if (!d) return;
    const m0 = d.mount; d.mount = (el) => { if (S().mReduce) set(false); return m0 ? m0(el) : null; };
  });
  window.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-m-rm]'); if (!b) return;
    set(!S().mReduce); window.__proto.refresh();
  }, true);
})();
