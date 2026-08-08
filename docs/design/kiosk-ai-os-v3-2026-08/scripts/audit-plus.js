/*
 * 扩展自检：现有页面级溢出检查发现不了 .verrand 被 flex 压缩后，
 * “跳过，直接打印”按钮超出卡片底部 20px 并被 overflow:hidden 裁掉的问题；
 * 也发现不了文案承诺 data-ev 左右联动、实际却没有绑定点击行为的问题。
 */
(function (window, document) {
  'use strict';

  var originalAudit = window.v3Audit;
  var decorationClasses = [
    'aurora', 'mesh', 'grain', 'vhero-field', 'vhero-dots'
  ];
  var interactiveSelector =
    'a,button,input,select,textarea,[role="button"]';

  function trim(text) {
    return String(text || '').replace(/^\s+|\s+$/g, '');
  }

  function hasClass(element, name) {
    return !!(element.classList && element.classList.contains(name));
  }

  function isDecoration(element) {
    var node = element;
    var i;
    while (node && node.nodeType === 1) {
      for (i = 0; i < decorationClasses.length; i += 1) {
        if (hasClass(node, decorationClasses[i])) {
          return true;
        }
      }
      node = node.parentNode;
    }
    return false;
  }

  function matches(element, selector) {
    var method = element.matches ||
      element.msMatchesSelector ||
      element.webkitMatchesSelector;
    return !!(method && method.call(element, selector));
  }

  function isClipping(style) {
    var pattern = /(^|\s)(hidden|clip)(\s|$)/;
    return pattern.test(style.overflow || '') ||
      pattern.test(style.overflowY || '');
  }

  function elementName(element) {
    var name;
    var classes;
    var i;
    if (element.id) {
      return '#' + element.id;
    }
    name = element.tagName.toLowerCase();
    classes = trim(element.className).split(/\s+/);
    for (i = 0; i < classes.length && i < 2; i += 1) {
      if (classes[i]) {
        name += '.' + classes[i];
      }
    }
    return name;
  }

  function elementText(element) {
    var text = trim(element.textContent);
    if (!text) {
      text = trim(
        element.getAttribute('aria-label') ||
        element.getAttribute('title') ||
        element.value ||
        element.tagName.toLowerCase()
      );
    }
    return text.length > 50 ? text.substring(0, 47) + '...' : text;
  }

  function overflowText(bottom, right) {
    var parts = [];
    if (bottom > 0) {
      parts.push('底部 ' + Math.ceil(bottom) + 'px');
    }
    if (right > 0) {
      parts.push('右侧 ' + Math.ceil(right) + 'px');
    }
    return parts.join('、');
  }

  function auditInternalClipping() {
    var result = {
      '视口外': 0,
      '严重': 0,
      '一般': 0,
      '明细': []
    };
    var viewportItems = [];
    var severeItems = [];
    var normalItems = [];
    var elements = document.getElementsByTagName('*');
    var decorativeClasses = {
      'aurora': true,
      'mesh': true,
      'grain': true,
      'vhero-field': true,
      'vhero-dots': true
    };

    function trimText(value) {
      return String(value || '')
        .replace(/\s+/g, ' ')
        .replace(/^\s+|\s+$/g, '');
    }

    function isDecorative(element) {
      var node = element;
      var className;
      var classes;
      var i;

      while (node && node.nodeType === 1) {
        className = typeof node.className === 'string' ? node.className : '';
        classes = className.split(/\s+/);

        for (i = 0; i < classes.length; i++) {
          if (decorativeClasses[classes[i]]) {
            return true;
          }
        }

        node = node.parentElement;
      }

      return false;
    }

    function isInteractive(element) {
      var tagName = element.tagName.toLowerCase();
      var role = trimText(element.getAttribute('role')).toLowerCase();

      return tagName === 'a' ||
        tagName === 'button' ||
        tagName === 'input' ||
        tagName === 'select' ||
        tagName === 'textarea' ||
        role === 'button';
    }

    function hasLeafText(element) {
      return element.children.length === 0 &&
        trimText(element.textContent || element.innerText).length > 0;
    }

    function isClippingContainer(element) {
      var style = window.getComputedStyle(element);
      var overflow = style.overflow;
      var overflowY = style.overflowY;

      return element.clientHeight > 40 &&
        (overflow === 'hidden' ||
         overflow === 'clip' ||
         overflowY === 'hidden' ||
         overflowY === 'clip');
    }

    /** 是否有可滚动祖先：有则该元素虽在视口外，用户滚一下就能看到，不算缺陷 */
    function hasScrollableAncestor(element) {
      var node = element.parentElement;
      var style;
      while (node && node.nodeType === 1) {
        style = window.getComputedStyle(node);
        if (/auto|scroll/.test(style.overflowY || '') &&
            node.scrollHeight > node.clientHeight + 4) {
          return true;
        }
        node = node.parentElement;
      }
      return false;
    }

    function findNearestClippingContainer(element) {
      var parent = element.parentElement;

      while (parent) {
        if (isClippingContainer(parent)) {
          return parent;
        }
        parent = parent.parentElement;
      }

      return null;
    }

    function describeElement(element) {
      var description = element.tagName.toLowerCase();
      var id = trimText(element.id);
      var className = typeof element.className === 'string'
        ? trimText(element.className)
        : '';
      var classes;
      var i;

      if (id) {
        description += '#' + id;
      }

      if (className) {
        classes = className.split(/\s+/);
        for (i = 0; i < classes.length && i < 3; i++) {
          if (classes[i]) {
            description += '.' + classes[i];
          }
        }
      }

      return description;
    }

    function getDisplayText(element) {
      var text = trimText(element.innerText || element.textContent);

      if (!text && element.value !== undefined) {
        text = trimText(element.value);
      }
      if (!text) {
        text = trimText(
          element.getAttribute('aria-label') ||
          element.getAttribute('title') ||
          element.getAttribute('placeholder')
        );
      }

      return text.length > 60 ? text.substring(0, 57) + '...' : text;
    }

    for (var i = 0; i < elements.length; i++) {
      var element = elements[i];
      var interactive;
      var container;
      var elementRect;
      var containerRect;
      var limit;
      var overflowAmount;
      var detail;

      if (isDecorative(element)) {
        continue;
      }

      interactive = isInteractive(element);
      if (!interactive && !hasLeafText(element)) {
        continue;
      }

      elementRect = element.getBoundingClientRect();
      if (elementRect.width <= 0 || elementRect.height <= 0) {
        continue;
      }

      /*
       * 顺序很重要：先判「视口外」，再判「相对容器被裁」。
       *
       * 实测漏检：.pgno「3 / 3」top=2086、bottom=2098，视口高 1920 —— 整个在屏幕下方，
       * 用户完全看不见。但它相对最近的裁切祖先 .sheet-a4（底 2120）并没有溢出，
       * 于是被「必须相对容器溢出」这个前置条件挡掉，报了 0 处，漏掉了真缺陷。
       *
       * 「跑到视口外」是比「被某个容器切掉一角」更严重的问题：前者整块内容看不见，
       * 且不依赖任何容器是否 overflow:hidden。因此它必须独立判断，不设前置条件。
       */
      /*
       * 「能滚到的」不算缺陷。
       * 实测误报：.paper 预览区内部可滚动，第 1 页的「王·个人简历」「教育背景」等
       * 被滚到视口上方（超出 -2184px），报了 4 处 —— 但用户往上滚就能看到，不是缺陷。
       * 只有落在视口外**且没有可滚动祖先**（滚不到）才是真的看不见。
       */
      if ((elementRect.top >= window.innerHeight || elementRect.bottom <= 0) &&
          !hasScrollableAncestor(element)) {
        detail = {
          '类型': '视口外',
          '容器': (function () {
            var c = findNearestClippingContainer(element);
            return c ? describeElement(c) : '（无裁切容器·直接落在视口外）';
          })(),
          '文字': getDisplayText(element),
          '超出': Math.round((elementRect.top - window.innerHeight) * 10) / 10,
          '可交互': interactive
        };
        result['视口外']++;
        viewportItems.push(detail);
        continue;
      }

      container = findNearestClippingContainer(element);
      if (!container) {
        continue;
      }

      containerRect = container.getBoundingClientRect();
      limit = interactive ? 4 : 2;
      overflowAmount = elementRect.bottom - containerRect.bottom;

      if (overflowAmount <= limit) {
        continue;
      }

      detail = {
        '类型': '',
        '容器': describeElement(container),
        '文字': getDisplayText(element),
        '超出': Math.round(overflowAmount * 10) / 10,
        '可交互': interactive
      };

      /*
       * 实测中，绝对定位的 .pgno「3 / 3」会被 body、stage、screen、work、
       * wmain、paper 等六层裁切祖先重复上报。现在从元素向上只取最近的裁切
       * 祖先，因此同一元素只统计一次；同时它位于 1920px 视口下方
       * （top=2086、bottom=2098），应优先归为“视口外”，而不是普通被裁。
       */
      if (elementRect.top >= window.innerHeight || elementRect.bottom <= 0) {
        detail['类型'] = '视口外';
        result['视口外']++;
        viewportItems.push(detail);
      } else if (interactive) {
        detail['类型'] = '可交互被裁';
        result['严重']++;
        severeItems.push(detail);
      } else {
        detail['类型'] = '文字被裁';
        result['一般']++;
        normalItems.push(detail);
      }
    }

    result['明细'] = viewportItems
      .concat(severeItems, normalItems)
      .slice(0, 8);

    return result;
  }

  /**
   * 判定某个 [data-ev] 元素属于「证据侧」还是「条目侧」。
   *
   * 必须与 scripts/linkage.js 的判定保持一致，否则会出现
   * 「联动实际能用，但自检报缺锚点」的矛盾（P09 实测过：
   * 联动 4 条全通，自检却报 缺锚点 9 / 未绑定 5）。
   *
   * 两种页面写法都要支持：
   *   P11 岗位匹配   —— 证据在 #src 容器内
   *   P09 简历工作台 —— 没有容器，证据元素自身带 .hit / .gapline
   */
  function isInEvidencePane(element) {
    var node = element;
    var cls;
    // ① 容器式
    while (node && node.nodeType === 1) {
      if (
        node.id === 'src' ||
        hasClass(node, 'resume-src') ||
        (node.hasAttribute && node.hasAttribute('data-evidence-pane'))
      ) {
        return true;
      }
      node = node.parentNode;
    }
    // ② 无容器式：按证据元素自身类名
    cls = (typeof element.className === 'string' ? element.className : '');
    if (/(^|\s)(hit|gapline|ev-hit)(\s|$)/.test(cls)) {
      return true;
    }
    return false;
  }

  function auditEvidenceWiring() {
    var result = {
      '声明条数': 0,
      '缺锚点': [],
      '未绑定': []
    };
    var elements = document.querySelectorAll('[data-ev]');
    var anchors = {};
    var i;

    for (i = 0; i < elements.length; i += 1) {
      if (isInEvidencePane(elements[i])) {
        anchors['$' + elements[i].getAttribute('data-ev')] = true;
      }
    }

    for (i = 0; i < elements.length; i += 1) {
      var item = elements[i];
      var value;
      var role;
      var cursor;
      var hasOnclick;

      if (isInEvidencePane(item)) {
        continue;
      }

      value = item.getAttribute('data-ev');
      result['声明条数'] += 1;

      if (!anchors['$' + value]) {
        result['缺锚点'].push(value);
      }

      role = trim(item.getAttribute('role')).toLowerCase();
      cursor = window.getComputedStyle(item).cursor;
      hasOnclick = item.getAttribute('onclick') !== null ||
        typeof item.onclick === 'function';

      if (role !== 'button' && cursor !== 'pointer' && !hasOnclick) {
        result['未绑定'].push(value);
      }
    }
    return result;
  }

  function issueValue(value) {
    var names = ['数量', 'count', 'total', '严重', '一般', '明细',
      'details', 'items'];
    var i;

    if (typeof value === 'number') {
      return value > 0;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    if (Object.prototype.toString.call(value) === '[object Array]') {
      return value.length > 0;
    }
    if (typeof value === 'string') {
      return !/^(|0|0处|无|通过|正常)$/.test(trim(value));
    }
    if (value && typeof value === 'object') {
      for (i = 0; i < names.length; i += 1) {
        if (Object.prototype.hasOwnProperty.call(value, names[i]) &&
            issueValue(value[names[i]])) {
          return true;
        }
      }
    }
    return false;
  }


  /**
   * 检查三：看着能点、实际点不了
   *
   * 实证：首页功能卡里的「本机上传 / 手机扫码传 / U 盘」是 .card-pill 的 <span>，
   * 视觉上是 chip，用户会去点，但没有任何交互 —— 界面承诺了一个不存在的入口。
   * 与「底部写着可点却没绑事件」同类：**页面在对用户撒谎**。
   *
   * 判定：类名含 pill / chip / tag / btn，但既不是 a|button|input，
   * 也没有 role=button、onclick、cursor:pointer 的元素。
   * 豁免：类名含 info / static / label / meta 的（已被明确标注为「这是状态不是入口」），
   * 以及 disabled 的。豁免机制很重要 —— 状态标签本来就不该可点，
   * 一刀切都要求可点会制造另一种错误（用户点「12 家来源」期待发生什么）。
   */
  function auditFakeAffordance() {
    var out = { '疑似假入口': 0, '明细': [] };
    var all = document.querySelectorAll('[class*="pill"],[class*="chip"],[class*="tag"],[class*="btn"]');
    var i, el, cls, tag, cs, txt;
    for (i = 0; i < all.length; i++) {
      el = all[i];
      tag = el.tagName.toLowerCase();
      if (tag === 'a' || tag === 'button' || tag === 'input') continue;
      cls = (typeof el.className === 'string' ? el.className : '');
      // 豁免：已明确标注为非入口的，以及项目里表示「状态」的既有命名。
      // 实测误报 6 处：stage（舞台容器）、devpill（设备在线）、vfigure-tag（顾问在线）、
      // vstep-tag（下一步）—— 全是状态标签，本来就不该可点。
      // 判定假入口要看它是否**声称是入口**，而不是看类名里有没有 pill/tag。
      // 豁免：已明确标注为非入口的，以及项目里表示「状态/评级」的既有命名。
      // 实测误报累计 10 处：stage 舞台容器、devpill 设备在线、vfigure-tag 顾问在线、
      // vstep-tag 下一步、dim-tag 维度评级（好/需改/一般）—— 全是状态，本来就不该可点。
      // 判定假入口要看它是否**声称是入口**，而不是类名里有没有 pill/tag。
      if (/info|static|label|meta|disabled|stage|dev|status|state|figure|step|badge|dot|dim|level|score|rank|grade/i.test(cls)) continue;
      if (el.getAttribute('role') === 'button') continue;
      if (el.getAttribute('onclick')) continue;
      if (el.disabled) continue;
      try { cs = window.getComputedStyle(el); } catch (e) { continue; }
      if (cs.cursor === 'pointer') continue;
      if (!el.getBoundingClientRect().width) continue;
      txt = (el.textContent || '').replace(/\s+/g, ' ').replace(/^ | $/g, '');
      if (!txt) continue;
      out['疑似假入口'] += 1;
      if (out['明细'].length < 8) {
        out['明细'].push({ '文字': txt.length > 24 ? txt.substring(0, 21) + '...' : txt, '类名': cls.substring(0, 30) });
      }
    }
    return out;
  }

  window.v3AuditPlus = function () {
    var result = {};
    var baseError = false;
    var oldKeys = ['横向溢出', '主体纵向溢出', '触控不足48', '违禁文案'];
    var clipping;
    var wiring;
    var hasProblem;
    var base;
    var key;
    var i;

    if (typeof originalAudit === 'function') {
      try {
        base = originalAudit.call(window);
        if (base && typeof base === 'object') {
          for (key in base) {
            if (Object.prototype.hasOwnProperty.call(base, key)) {
              result[key] = base[key];
            }
          }
        }
      } catch (error) {
        baseError = true;
        if (window.console && window.console.warn) {
          window.console.warn('v3Audit 原有自检执行失败：', error);
        }
      }
    }

    clipping = auditInternalClipping();
    wiring = auditEvidenceWiring();
    result['内部裁切'] = clipping;
    result['联动接线'] = wiring;
    result['假入口'] = auditFakeAffordance();

    hasProblem = baseError ||
      clipping['严重'] > 0 ||
      clipping['一般'] > 0 ||
      wiring['缺锚点'].length > 0 ||
      wiring['未绑定'].length > 0;

    for (i = 0; i < oldKeys.length; i += 1) {
      if (issueValue(result[oldKeys[i]])) {
        hasProblem = true;
      }
    }

    if (window.console) {
      if (hasProblem && window.console.warn) {
        window.console.warn('v3AuditPlus 发现问题：', result);
      } else if (!hasProblem && window.console.log) {
        window.console.log('v3AuditPlus 全部通过：', result);
      }
    }
    return result;
  };

  function autoRun() {
    window.v3AuditPlus();
  }

  if (document.readyState === 'complete') {
    window.setTimeout(autoRun, 0);
  } else if (window.addEventListener) {
    window.addEventListener('load', autoRun, false);
  } else {
    window.attachEvent('onload', autoRun);
  }
}(window, document));
