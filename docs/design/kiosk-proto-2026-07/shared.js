// Kiosk 原型公共脚本:舞台自适应缩放 + 顶栏时钟
(function () {
  function fit() {
    var stage = document.getElementById('stage');
    if (!stage) return;
    var vw = (window.visualViewport && window.visualViewport.width) || window.innerWidth;
    var vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    var k = Math.min(vw / 1080, vh / 1920);
    stage.style.transform = 'scale(' + k + ')';
    stage.style.marginLeft = Math.max(0, (vw - 1080 * k) / 2) + 'px';
    document.body.classList.add('fit-scale');
    document.body.style.height = (1920 * k) + 'px';
    document.body.style.overflow = 'hidden';
  }
  window.addEventListener('resize', fit);
  document.addEventListener('DOMContentLoaded', fit);
  fit();

  function tick() {
    var el = document.getElementById('clock');
    if (!el) return;
    var n = new Date();
    el.textContent = n.getFullYear() + '年' + (n.getMonth() + 1) + '月' + n.getDate() + '日 ' +
      String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
  }
  setInterval(tick, 15000);
  document.addEventListener('DOMContentLoaded', tick);
})();
