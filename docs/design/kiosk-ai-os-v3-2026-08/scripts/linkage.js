/* ═══════════════════════════════════════════════════════════════════════
   linkage.js — 「左侧逐条 ↔ 右侧原文定位高亮」联动

   引入：<script src="scripts/linkage.js?v=4"></script>

   背景：P11 底部已写「点左边任一条，右边原文定位到对应证据」，
   markup **两侧都已布好线**，用的是同一个属性名：
     左侧  .req[data-ev="rN"]        岗位要求逐条（8 条）
     右侧  #src [data-ev="rN"]       简历原文中的对应证据（r4 有 2 处）
   缺的只是把两侧接起来的这几行 JS —— 在此之前点了没反应，
   文案承诺了一个不存在的交互。

   两条设计纪律：
   · 一条要求对应多处证据时**全部点亮**。只亮一处会让用户误以为
     「简历里只有这一句支撑」，而实际有两句。
   · 不做任何文本猜测匹配。曾试过按关键词自动定位，结果把
     「没写到 A/B 测试」匹配到简历里无关的「测试」二字并点亮 ——
     等于凭空造出一条不存在的证据。只认作者标好的 data-ev。

   这套语法在项目多个作业面复用：比对岗位要求 / 裁决隐私片段 /
   裁决 AI 改动 / 钉对话要点 —— 用户学会一次，处处通用。
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // 证据侧容器：不同页面类名不同，但语法一致
  //   P11 岗位匹配：左 .req[data-ev] ↔ 右 #src 内 [data-ev]
  //   P09 简历工作台：左 .issue[data-ev] ↔ 右 .hit / .gapline[data-ev]
  // 统一按「证据元素自身的类名」识别，不再依赖某个固定容器 id。
  var SRC_SEL = '#src, .resume-src, [data-evidence-pane]';
  var EVIDENCE_CLS = /(^|\s)(hit|gapline|ev-hit)(\s|$)/;

  function isEvidence(el) {
    var cls = (typeof el.className === 'string' ? el.className : '');
    return EVIDENCE_CLS.test(cls);
  }

  function init() {
    var pane = document.querySelector(SRC_SEL);
    var all = [].slice.call(document.querySelectorAll('[data-ev]'));
    if (!all.length) return;

    // 左侧 = 条目；右侧 = 证据。优先用容器区分（P11），
    // 没有容器时按证据元素自身类名区分（P09 的 .hit / .gapline）。
    var reqs = all.filter(function (el) {
      return pane ? !pane.contains(el) : !isEvidence(el);
    });
    if (!reqs.length) return;

    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches;

    function evidenceOf(id) {
      if (pane) return pane.querySelectorAll('[data-ev="' + id + '"]');
      var out = [], list = document.querySelectorAll('[data-ev="' + id + '"]'), i;
      for (i = 0; i < list.length; i++) if (isEvidence(list[i])) out.push(list[i]);
      return out;
    }

    function activate(req) {
      var id = req.getAttribute('data-ev');
      reqs.forEach(function (r) { r.classList.remove('is-active'); });
      [].forEach.call(document.querySelectorAll('[data-ev]'), function (s) { s.classList.remove('is-hot'); });

      req.classList.add('is-active');
      var hits = evidenceOf(id);
      if (!hits.length) return;

      [].forEach.call(hits, function (s) { s.classList.add('is-hot'); });   // 多处证据全部点亮
      hits[0].scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    }

    reqs.forEach(function (req) {
      // 没有对应证据的条目不做成可点，避免「点了没反应」
      if (!evidenceOf(req.getAttribute('data-ev')).length) return;
      req.setAttribute('role', 'button');
      req.setAttribute('tabindex', '0');
      req.style.cursor = 'pointer';
      req.addEventListener('click', function () { activate(req); });
      req.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(req); }
      });
    });

    // 自检：把缺锚点的条目报到 console，避免「文案承诺可点、部分条目点不动」悄悄上线
    var orphan = reqs.filter(function (r) { return !evidenceOf(r.getAttribute('data-ev')).length; })
                     .map(function (r) { return r.getAttribute('data-ev'); });
    console.log('[linkage] 已接线 ' + (reqs.length - orphan.length) + '/' + reqs.length + ' 条' +
      (orphan.length ? '；缺证据锚点：' + orphan.join(', ') : ''));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ── 卡片内快捷入口：pill 不能用 <a>（外层整卡已是 <a>，嵌套锚点是非法 HTML，
   浏览器会重构 DOM 导致布局错乱：实测 pill 宽度从 ~90px 变成 348/604px）。
   改用 span[role=button][data-href]，在此绑定并阻止冒泡到外层卡片链接。 ── */
(function () {
  'use strict';
  function go(el) {
    var href = el.getAttribute('data-href');
    if (href) location.href = href;
  }
  var pills = document.querySelectorAll('[data-href][role="button"]');
  for (var i = 0; i < pills.length; i++) {
    (function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();   // 不触发外层整卡跳转
        go(el);
      });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); go(el); }
      });
    })(pills[i]);
  }
})();
