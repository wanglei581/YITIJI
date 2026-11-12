/* free-1112.js：首页「免费使用」标识（2026-11-12，总指挥（七）转来，和动效、省步版一起给他看）
 * 依据：11/08 20:31 他对「公共点位首页标免费，做成按机器的开关」回了「按推荐」（review-1108/STATUS.md:66）。
 * 显示规则（core4-tail-1108/STATUS.md 46–52）：这台机器的开关开着（后台终端详情抽屉里，默认开），并且价目读到、黑白和彩色都是 0，
 *   才显示「免费使用」；价目大于 0 或读失败都不显示。价目大于 0 时首页页脚写「收费以现场公示为准」
 *   （运行页 HomeTouchView.tsx:83-84），两句不同屏。原型里「收费点位」开关代表价目大于 0。 */
(function () {
  'use strict';
  const S = () => window.S || {};
  const css = document.createElement('style');
  css.textContent = `
.greet{position:relative}
.greet .m-free{position:absolute;right:0;top:6px;display:inline-flex;align-items:center;gap:10px;padding:12px 28px 12px 20px;border-radius:999px;
  background:linear-gradient(135deg,#4ff0b9,#2ee6a8 55%,#1fc794);color:#06261d;font:800 32px/1.2 var(--sans);letter-spacing:.06em;box-shadow:0 10px 26px rgba(0,0,0,.28),0 0 0 6px rgba(46,230,168,.16)}
.greet .m-free svg{flex:none}`;
  document.head.appendChild(css);
  const d = (window.SCREENS || []).find((s) => s.id === 'home'); if (!d) return;
  const r0 = d.render, m0 = d.mount, demo0 = d.demo;
  const show = () => !S().fee && !S().mFreeOff && !S().mPriceFail;
  d.render = () => {
    const h = r0();
    if (!show()) return h;
    const pill = '<span class="m-free" aria-label="免费使用"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>免费使用</span>';
    /* 贴在问候这一块的右上角，不占问候文字的宽度 */
    return h.replace(/(<div class="greet">[\s\S]*?<\/p><\/div>)(<\/div>)/, '$1' + pill + '$2');
  };
  d.demo = () => {
    const base = typeof demo0 === 'function' ? (demo0() || []) : (demo0 || []);
    return [{ label: '演示：这台机器关了「免费使用」开关', ev: 'm-free-off' }, { label: '演示：价目没读到', ev: 'm-price-fail' }, { label: '演示：恢复（开关开、价目全 0）', ev: 'm-free-on' }].concat(base);
  };
  d.mount = (el) => {
    const c0 = m0 ? m0(el) : null;
    const on = (e) => {
      if (e.detail === 'm-free-off') S().mFreeOff = true;
      else if (e.detail === 'm-price-fail') S().mPriceFail = true;
      else if (e.detail === 'm-free-on') { S().mFreeOff = false; S().mPriceFail = false; }
      else return;
      window.__proto.refresh();
    };
    el.addEventListener('proto-demo', on);
    return () => { el.removeEventListener('proto-demo', on); if (c0) c0(); };
  };
})();
