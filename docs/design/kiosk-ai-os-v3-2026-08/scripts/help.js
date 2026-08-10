/* ============================================================
   V3 · 共享帮助层（全站唯一兜底出口）
   ------------------------------------------------------------
   为什么要有这个文件：
     294 次点击实测里 254 次界面零变化；其中「需要帮助」出现在 19 个页面、
     全部无反应 —— 而它是全站唯一的兜底出口。用户走不下去时按它，什么都不发生，
     等于告诉用户"这台机器不管你"。

   设计取舍：
     1) 纯事件委托，不改页面 DOM。已有的 19 个「需要帮助」按钮一行不动就能生效，
        新页面写 data-help 也能挂上去。这样不必去碰正在被别的代理整改的页面。
     2) 只做"怎么找到人"的指引。绝不显示"已提交工单""已通知运维"——
        原型没有工单系统，写了就是伪造能力（CLAUDE.md §9）。
     3) 服务台位置与客服电话一律标「按站点配置下发」，不编号码。
        每个站点的服务台和客服都不一样，写死一个假号码比不写更糟。

   API（window.v3Help）：
     open(topic?)              打开。topic 省略时按当前页 meta[name=screen-name] 分档
     close()                   关闭
     isOpen()                  是否打开
     topic()                   当前分档 key
     register(key, def)        追加/覆盖一档内容
                               def = { label, faq:[{q,a} ×3] }
     TOPICS                    只读查看内置分档

   自检口径：关闭态用 hidden，display:none 使一切矩形为 0，
   stage.js 与 audit-plus.js 的所有检查都会跳过；打开态的尺寸/文案
   均按 CLAUDE.md §9 与合规白名单写死（触控 ≥56px、无违禁文案）。
   ============================================================ */
;(function (window, document) {
  'use strict';

  if (window.v3Help) { return; }

  /* 文字触发词。19 个页面的按钮文案就这三种写法，
     用 indexOf 而不是全等 —— P06 写的是「卡纸了 / 需要帮助」「这次打印有问题」。 */
  var TRIGGER_TEXT = ['需要帮助', '异常求助', '打印有问题'];

  /* ---------- 分档内容 ----------
     按业务域分，不按页分：同一域内用户的困惑是同一批。
     每档固定 3 问，一句答复，不写"建议/推测"这类模型口吻
     （stage.js 的"建议无证据"检查会命中，且原型也没有依据可标）。 */
  var TOPICS = {
    system: {
      label: '开机与导航',
      faq: [
        { q: '我该从哪一步开始？',
          a: '首页入口按办事目的分：要打印复印就进打印扫描，要改简历就进 AI 简历服务，看岗位、企业、招聘会都在岗位信息里。选错了随时按左下角返回。' },
        { q: '屏幕提示 AI 不可用，还能办事吗？',
          a: '能。打印、复印、扫描、看岗位和招聘会都不依赖 AI；只有简历诊断、简历优化、面试训练这类要模型的功能会暂停，恢复后再来即可。' },
        { q: '一定要登录才能用吗？',
          a: '打印、扫描和信息浏览不用登录。只有把文件存进「我的」、或者取历史订单时，才需要手机号验证。' }
      ]
    },
    print: {
      label: '打印与扫描',
      faq: [
        { q: '文件传不上来怎么办？',
          a: '本机支持 U 盘、手机扫码传、现场扫描三种方式。U 盘认不出多为格式不支持，换 FAT32 或 exFAT 再试；扫码传要求手机和本机在同一个网络下。' },
        { q: '打印机不出纸、或者卡纸了？',
          a: '先看顶栏设备状态：显示离线时任务根本不会开始；显示工作中却停住，多是卡纸或缺纸。请找现场服务台开盖处理，不要自己拉扯卡住的纸。' },
        { q: '打了一半停了，费用怎么算？',
          a: '没开始出纸的任务可以在订单里取消。已经出纸的部分按实际张数结算；异常中断的单子，带着屏幕上的单号找现场服务台核对。' }
      ]
    },
    resume: {
      label: 'AI 简历服务',
      faq: [
        { q: '上传的简历识别得不全？',
          a: '图片和扫描件靠 OCR 识别，字迹淡、页面歪、页数超出受控范围都会掉字。可以用扫描工作台重新扫一遍，或者在结果页手工补上缺的段落。' },
        { q: '改完的简历能直接打印吗？',
          a: '能。改完的版本会进「我的文档」，在打印扫描里选它就能出纸。原始版本不会被覆盖，两版都在。' },
        { q: '我的简历会被拿去做什么？',
          a: '只用于你本次要的解析、诊断和排版。本机不代收简历、不代为投递、不把内容给任何企业。文件保留时长按站点配置，也可以在「我的」里自己删。' }
      ]
    },
    jobs: {
      label: '岗位与企业信息',
      faq: [
        { q: '这些岗位是这台机器发布的吗？',
          a: '不是。岗位来自第三方平台与官方来源，每条都带来源机构、同步时间和外部 ID。本机只做信息展示，不做企业招聘闭环。' },
        { q: '看中了要怎么继续？',
          a: '岗位详情页有「扫码投递」和去来源平台的入口，扫码后用手机在来源平台继续办。本机不代收简历，也不替你提交材料。' },
        { q: '岗位信息是什么时候的？',
          a: '每条岗位下方都写着同步时间。过了有效期的岗位会标成已过期，并停止展示外部入口，避免你白跑一趟。' }
      ]
    },
    fair: {
      label: '招聘会与校园招聘',
      faq: [
        { q: '怎么知道招聘会在哪、怎么走？',
          a: '详情页里有主办方、时间地点和展位导览图，可以直接打印一份带着走，现场没网也能看。' },
        { q: '能在这台机器上预约进场吗？',
          a: '不能。详情页提供「去来源平台预约」和「扫码预约」，跳到主办方或官方入口后用手机完成，本机不代办预约。' },
        { q: '打印出来的展位图和现场对不上？',
          a: '导览图按主办方给的版本展示，图上标了同步时间。现场以指引牌为准；出入较大时找现场服务台反馈。' }
      ]
    },
    interview: {
      label: '面试训练',
      faq: [
        { q: '没有耳机能练吗？',
          a: '能。全程可以只用文字作答，语音是可选项。旁边有人的时候用文字更自在，训练内容完全一样。' },
        { q: '练习记录会被别人看到吗？',
          a: '不会。记录只进你自己的 AI 服务记录，本机不把内容给企业，也不做筛选和排名。可以随时在「我的」里删除。' },
        { q: 'AI 给的分数算不算数？',
          a: '不算数。分数只是这一次作答的参考，不代表任何企业的评价，也不预测录用结果。' }
      ]
    },
    policy: {
      label: '政策服务',
      faq: [
        { q: '政策原文在哪里看？',
          a: '每条政策都带文号和来源单位，详情页能看到原文摘录，也可以打印一份带走去窗口对照。' },
        { q: '这个补贴我能不能领？',
          a: '本机只做政策信息展示，不做资格审定。是否符合条件，以受理单位的答复为准。' },
        { q: '材料清单能打印吗？',
          a: '能。详情页里的材料清单可以直接出纸，照着清单备齐再去窗口，少跑一趟。' }
      ]
    },
    advisor: {
      label: 'AI 顾问',
      faq: [
        { q: '顾问说的话可信吗？',
          a: '顾问的回答会标注依据来源。涉及政策和岗位的内容，一律以原文和来源平台为准，顾问只帮你找到它。' },
        { q: '我说的内容会被记录吗？',
          a: '对话只进你自己的 AI 服务记录，可以在「我的」里查看和删除。本机不把对话给企业。' },
        { q: '不想打字怎么办？',
          a: '可以按语音键直接说，也可以点屏幕上列出的常见问题。屏幕键盘也随时可以调出来。' }
      ]
    },
    me: {
      label: '我的与个人资料',
      faq: [
        { q: '怎么找回之前的文件和订单？',
          a: '用办理时填的手机号验证后，在「我的」里能看到文档、打印订单和 AI 服务记录。' },
        { q: '证件照、身份证这类文件会留多久？',
          a: '敏感文件的保留时长按站点配置，到期自动清理，你也可以随时手动删除。删除会记进日志。' },
        { q: '办完怎么退出，不让下一个人看到？',
          a: '在「我的」里退出登录即可。屏幕无操作一段时间后也会回到待机屏，需要重新验证才能看到你的资料。' }
      ]
    }
  };

  /* 页号 → 分档。meta[name=screen-name] 形如「P07 扫描工作台」。 */
  var PAGE_TOPIC = {
    P01: 'system', P02: 'system', P03: 'system', P04: 'system', P05: 'system',
    P06: 'print', P07: 'print', P08: 'print', P12: 'print', P29: 'print', P39: 'print',
    P09: 'resume', P10: 'resume', P32: 'resume', P33: 'resume',
    P11: 'jobs', P13: 'jobs', P14: 'jobs', P15: 'jobs', P16: 'jobs',
    P30: 'jobs', P34: 'jobs', P35: 'jobs',
    P17: 'fair', P18: 'fair', P19: 'fair', P36: 'fair',
    P20: 'interview', P37: 'interview',
    P21: 'policy', P38: 'policy',
    P22: 'me', P23: 'me', P24: 'me', P27: 'me', P28: 'me', P31: 'me',
    P25: 'advisor', P26: 'advisor'
  };

  /* 页号认不出时的兜底：按页名关键词分。 */
  var NAME_TOPIC = [
    [/打印|扫描|文件|证件照|材料/, 'print'],
    [/简历|素材/, 'resume'],
    [/岗位|企业|机构|平台|决策/, 'jobs'],
    [/招聘会|校园|校招/, 'fair'],
    [/面试/, 'interview'],
    [/政策/, 'policy'],
    [/顾问|助手/, 'advisor'],
    [/我的|权益|规划|探索|签约/, 'me']
  ];

  var screen = document.querySelector('.screen');
  var root = null;           // 帮助层根节点，首次打开时才建
  var titleEl, subEl, listEl;
  var lastFocus = null;
  var curTopic = '';
  var open = false;

  function screenName () {
    var m = document.querySelector('meta[name="screen-name"]');
    return m ? String(m.content || '') : '';
  }

  function resolveTopic (want) {
    var name, code, i;
    if (want && TOPICS[want]) { return want; }
    name = screenName();
    code = (name.match(/P\d{2}/) || [])[0];
    if (code && PAGE_TOPIC[code] && TOPICS[PAGE_TOPIC[code]]) { return PAGE_TOPIC[code]; }
    for (i = 0; i < NAME_TOPIC.length; i += 1) {
      if (NAME_TOPIC[i][0].test(name)) { return NAME_TOPIC[i][1]; }
    }
    return 'system';
  }

  function esc (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* 底部导航高度：帮助层与键盘都不许压住三项导航（用户要能随时回首页）。 */
  function navHeight () {
    var nav = screen && screen.querySelector('.navbar');
    return nav ? nav.offsetHeight : 0;
  }

  function homeHref () {
    var links = screen ? screen.querySelectorAll('.navbar a') : [];
    var i;
    for (i = 0; i < links.length; i += 1) {
      if ((links[i].textContent || '').indexOf('首页') > -1) { return links[i].getAttribute('href'); }
    }
    return '01-home-v5.html';
  }

  function build () {
    if (root) { return; }
    root = document.createElement('div');
    root.className = 'kio-help';
    root.id = 'kio-help';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'kio-help-t');
    root.innerHTML =
      '<div class="kio-help-mask" data-kio-close aria-hidden="true"></div>' +
      '<div class="kio-help-box">' +
        '<div class="kio-help-hd">' +
          '<svg class="ic"><use href="#i-help"/></svg>' +
          '<div class="kio-help-hgroup">' +
            '<h2 class="kio-help-t" id="kio-help-t">需要帮助</h2>' +
            '<p class="kio-help-sub"></p>' +
          '</div>' +
          '<button type="button" class="kio-close" data-kio-close aria-label="关闭帮助">' +
            '<svg class="ic"><use href="#i-close"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="kio-help-bd">' +
          '<div>' +
            '<p class="kio-sec-h">这一步常见的 3 个问题</p>' +
            '<div class="kio-sec-list" data-kio-faq></div>' +
          '</div>' +
          '<div>' +
            '<p class="kio-sec-h">找人工</p>' +
            '<div class="kio-svc">' +
              '<div class="kio-svc-l">' +
                '<svg class="ic"><use href="#i-users"/></svg>' +
                '<span class="kio-svc-k">现场服务台</span>' +
                '<span class="kio-svc-v">位置按站点配置下发</span>' +
              '</div>' +
              '<div class="kio-svc-l">' +
                '<svg class="ic"><use href="#i-phone"/></svg>' +
                '<span class="kio-svc-k">客服电话</span>' +
                '<span class="kio-svc-v">号码按站点配置下发</span>' +
              '</div>' +
              '<p class="kio-svc-tip">本机不会替你提交工单，也不会自动通知运维。上面两项由站点在管理后台填好后显示在这里；现在看到的是占位，不是真实号码。</p>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="kio-help-ft">' +
          '<button type="button" class="kio-big" data-kio-back>' +
            '<svg class="ic"><use href="#i-chevron"/></svg>回上一步' +
          '</button>' +
          '<a class="kio-big kio-big--go" href="#" data-kio-home>' +
            '<svg class="ic"><use href="#i-home"/></svg>回首页' +
          '</a>' +
        '</div>' +
      '</div>';

    (screen || document.body).appendChild(root);
    titleEl = root.querySelector('.kio-help-t');
    subEl = root.querySelector('.kio-help-sub');
    listEl = root.querySelector('[data-kio-faq]');
    root.querySelector('[data-kio-home]').setAttribute('href', homeHref());

    root.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('[data-kio-close]')) { e.preventDefault(); close(); return; }
      if (t.closest('[data-kio-back]')) { e.preventDefault(); goBack(); return; }
      var q = t.closest('.kio-q-t');
      if (q) {
        e.preventDefault();
        toggleQ(q);
      }
    });
  }

  function toggleQ (btn) {
    var on = btn.getAttribute('aria-expanded') === 'true';
    var ans = document.getElementById(btn.getAttribute('aria-controls'));
    btn.setAttribute('aria-expanded', on ? 'false' : 'true');
    if (ans) { ans.hidden = on; }
  }

  /* 回上一步：复用页面自己的返回件（stage.js 已经把"先退阶段、退无可退才离页"
     这条逻辑绑在 .actionbar > .backbtn 上），不另造一套导航。 */
  function goBack () {
    var b = (screen && (screen.querySelector('.actionbar > .backbtn') ||
      screen.querySelector('.backbtn'))) || null;
    close();
    if (b) { b.click(); return; }
    if (window.history.length > 1) { window.history.back(); return; }
    window.location.href = homeHref();
  }

  function render (topic) {
    var def = TOPICS[topic] || TOPICS.system;
    var html = '';
    var i;
    curTopic = topic;
    subEl.textContent = (screenName() || '本页') + ' · ' + def.label;
    for (i = 0; i < def.faq.length; i += 1) {
      html +=
        '<div class="kio-q">' +
          '<button type="button" class="kio-q-t" aria-expanded="false" aria-controls="kio-a' + i + '">' +
            '<span class="kio-q-n">' + (i + 1) + '</span>' +
            '<span class="kio-q-x">' + esc(def.faq[i].q) + '</span>' +
            '<svg class="ic"><use href="#i-chevron"/></svg>' +
          '</button>' +
          '<p class="kio-q-a" id="kio-a' + i + '" hidden>' + esc(def.faq[i].a) + '</p>' +
        '</div>';
    }
    listEl.innerHTML = html;
  }

  /* 锁滚动。
     刻意不用 .main{overflow:hidden} —— 那会把主体变成"裁切容器"，
     audit-plus 的内部裁切检查立刻把滚出可视区的内容全判成被裁，凭空造出几十条假缺陷。
     改成拦截帮助层之外的滚动手势，零布局副作用。 */
  function lockScroll (e) {
    if (root && e.target && e.target.closest && e.target.closest('.kio-help-bd')) { return; }
    e.preventDefault();
  }

  function onKey (e) {
    if (e.key === 'Escape' || e.keyCode === 27) { e.preventDefault(); close(); }
  }

  function openHelp (topic) {
    build();
    render(resolveTopic(topic));
    root.style.setProperty('--kio-navh', navHeight() + 'px');
    lastFocus = document.activeElement;
    if (window.v3Keypad && window.v3Keypad.isOpen()) { window.v3Keypad.close(); }
    root.hidden = false;
    open = true;
    document.addEventListener('keydown', onKey, false);
    document.addEventListener('wheel', lockScroll, { passive: false });
    document.addEventListener('touchmove', lockScroll, { passive: false });
    try { root.querySelector('.kio-close').focus(); } catch (err) {}
  }

  function close () {
    if (!root || !open) { return; }
    root.hidden = true;
    open = false;
    document.removeEventListener('keydown', onKey, false);
    document.removeEventListener('wheel', lockScroll, { passive: false });
    document.removeEventListener('touchmove', lockScroll, { passive: false });
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (err) {} }
    lastFocus = null;
  }

  /* ---------- 触发：事件委托，页面 DOM 一行不改 ---------- */
  function triggerFrom (target) {
    var d, b, txt, i;
    if (!target || !target.closest) { return null; }
    d = target.closest('[data-help]');
    if (d) { return d; }
    b = target.closest('button,a,[role="button"]');
    if (!b) { return null; }
    /* 外层若还套着别的按钮/链接，textContent 会把子按钮的字算进来 —— 不按文字判 */
    if (b.querySelector('button,a,[role="button"]')) { return null; }
    txt = (b.textContent || '').replace(/\s+/g, '');
    for (i = 0; i < TRIGGER_TEXT.length; i += 1) {
      if (txt.indexOf(TRIGGER_TEXT[i]) > -1) { return b; }
    }
    return null;
  }

  document.addEventListener('click', function (e) {
    var t;
    if (root && e.target.closest && e.target.closest('.kio-help')) { return; }
    t = triggerFrom(e.target);
    if (!t) { return; }
    e.preventDefault();
    openHelp(t.getAttribute('data-help') || '');
  }, false);

  window.v3Help = {
    open: openHelp,
    close: close,
    isOpen: function () { return open; },
    topic: function () { return curTopic; },
    register: function (key, def) {
      if (!key || !def) { return; }
      TOPICS[key] = def;
      if (open && curTopic === key) { render(key); }
    },
    TOPICS: TOPICS
  };
}(window, document));
