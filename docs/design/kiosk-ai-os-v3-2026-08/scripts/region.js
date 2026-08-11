/* ============================================================
   V3 · 统一地区选择器（省 / 市 / 区县下钻）+ 同形态列表弹层
   ------------------------------------------------------------
   为什么要有这个文件：
     本稿此前全站有四套互不相同的地区选法 —— 原生 <select> 级联、
     弹层下钻、单层城市标签、以及压根点不动的死控件。其中**原生下拉在
     27 寸竖屏一体机上会弹系统级弹层**，把 Kiosk 全屏流程打断
     （CLAUDE.md §17：不出现系统级弹窗阻断流程）。所以这里只做一件事：
     把地区选择统一成**页面内的弹层下钻**，一套实现、一套触控尺寸。

   控件选型阈值（本组件按这套阈值取形态，页面照此选控件）：
     2–6   项 → 平铺标签，56–64px 高，间距 ≥12px（页面自己写 .fchip，不进本组件）
     7–12  项 → 两列弹层                        → v3Pick，cols=2
     13–30 项 → 大弹层 / 近全屏，带搜索          → v3Pick，cols=2 + find
     31+ 项或有层级 → 全屏下钻，带搜索/最近/面包屑 → v3Region
   触控：弹层内每个选项 ≥64px（阈值要求 ≥56px，这里取 64px 留余量）；
   弹层宽度 ≈ 屏宽 82%（生产版 28rem/44px 高的下拉对站立触控偏小，不照抄）。

   —— 直辖市判定：这里是**给生产的参考实现** ——
     生产的 isMunicipality() 用「该市级下只有一个市辖区」来判定直辖市。
     这条判据是错的：重庆下辖 26 个区，永远判不出来，于是重庆用户被迫多走
     一层毫无意义的「选市」（省=重庆市 → 市=重庆市 → 区）。
     直辖市是**固定四个**、几十年不变的行政事实，就该按固定名单判，
     不该从数据形状去猜。下面 MUNICIPALITIES 即为正确写法。

   —— 字典口径：本稿是**精简字典，不是全量** ——
     本文件内置：31 个省级行政区 + 每省 3–8 个代表市；
     其中**广东省完整到区县**（21 个地级市），四个直辖市完整到区。
     其余省份**只到市级**，选项上明确标注「本稿只到市级」，不冒充全量。
     真机接 china-division 全量字典（31 省 / 342 市 / 3056 区县），
     结构与本文件 DICT 完全一致（{ p, c:[{ n, d:[] }] }），换数据即可。
     districts 语义：数组 = 真实区县名单；[] = 该市**不设区**（东莞/中山）；
     null = 本稿未收录（真机有）。三者必须分开，否则「不设区」会被当成缺数据。

   ------------------------------------------------------------
   API
     window.v3Region.open(el)        为某个 [data-region] 触发器打开地区弹层
     window.v3Region.close()         关闭
     window.v3Region.isOpen()        是否打开
     window.v3Region.get(el)         → { province, city, district, value, text }
     window.v3Region.set(el, value)  value 形如 '广东省|广州市|天河区'，'' = 不限
     window.v3Region.isMunicipality(name)
     window.v3Region.DICT            精简字典

     window.v3Pick.open(el)          为某个 [data-listpick] 触发器打开列表弹层
     window.v3Pick.get(el)           → 已选值数组
     window.v3Pick.set(el, arr)

   HTML 约定（事件委托，页面不用写一行 JS 就能弹出）
     地区：<button data-region data-region-value="广东省|广州市|天河区"
                   data-region-empty="全国不限">
             <span data-region-text>广东省 · 广州市 · 天河区</span></button>
     列表：<template id="opt-x">["央企","国企"]</template>
           <button data-listpick="cotype" data-listpick-src="#opt-x"
                   data-listpick-title="企业类型" data-listpick-mode="multi"
                   data-listpick-find="1" data-listpick-value="">
             <span data-listpick-text>全部 12 类</span></button>
     已选回显：同一个 .fgroup 里放 <div data-pickbag></div>，
              组件会把已选项渲染成**可单独清除**的 chip（.fsel）。

   事件（都从触发器冒泡，页面在 .screen 上监听即可）
     v3region:change  detail = { province, city, district, value, text }
     v3pick:change    detail = { name, values }

   自检口径（与 kiosk-io.css 同一套，改动前先读）
     · 关闭态一律 [hidden] → display:none，一切矩形为 0，各项检查自动跳过。
     · 类名一律 rgn- / fpick- / fsel 前缀，且不含
       card / note / act / pane / row / item / pill / chip / tag / btn 子串
       —— audit-plus.js 的「假入口」「卡内溢出」按 [class*=] 选元素。
     · 直接包文字的元素不写 overflow:hidden（stage.js 文字裁切只放过
       visible/auto/scroll）；圆角裁切放在不直接含文字的 .rgn-box 上。
   ============================================================ */
;(function (window, document) {
  'use strict';

  if (window.v3Region) { return; }

  var screen = document.querySelector('.screen');

  /* ---------- 直辖市：固定名单，不从数据形状猜 ---------- */
  var MUNICIPALITIES = ['北京市', '天津市', '上海市', '重庆市'];

  function isMunicipality (name) {
    var i;
    for (i = 0; i < MUNICIPALITIES.length; i += 1) {
      if (MUNICIPALITIES[i] === name) { return true; }
    }
    return false;
  }

  /* ---------- 精简字典 ----------
     c = 市；d = 区县（数组=真实名单，[]=不设区，null=本稿未收录） */
  function city (n, d) { return { n: n, d: d === undefined ? null : d }; }

  var DICT = [
    { p: '北京市', c: [city('北京市', ['东城区', '西城区', '朝阳区', '丰台区', '石景山区', '海淀区', '门头沟区', '房山区', '通州区', '顺义区', '昌平区', '大兴区', '怀柔区', '平谷区', '密云区', '延庆区'])] },
    { p: '天津市', c: [city('天津市', ['和平区', '河东区', '河西区', '南开区', '河北区', '红桥区', '东丽区', '西青区', '津南区', '北辰区', '武清区', '宝坻区', '滨海新区', '宁河区', '静海区', '蓟州区'])] },
    { p: '河北省', c: [city('石家庄市'), city('唐山市'), city('保定市'), city('廊坊市'), city('邯郸市'), city('秦皇岛市')] },
    { p: '山西省', c: [city('太原市'), city('大同市'), city('临汾市'), city('运城市')] },
    { p: '内蒙古自治区', c: [city('呼和浩特市'), city('包头市'), city('鄂尔多斯市'), city('赤峰市')] },
    { p: '辽宁省', c: [city('沈阳市'), city('大连市'), city('鞍山市'), city('锦州市')] },
    { p: '吉林省', c: [city('长春市'), city('吉林市'), city('四平市')] },
    { p: '黑龙江省', c: [city('哈尔滨市'), city('齐齐哈尔市'), city('大庆市'), city('牡丹江市')] },
    { p: '上海市', c: [city('上海市', ['黄浦区', '徐汇区', '长宁区', '静安区', '普陀区', '虹口区', '杨浦区', '闵行区', '宝山区', '嘉定区', '浦东新区', '金山区', '松江区', '青浦区', '奉贤区', '崇明区'])] },
    { p: '江苏省', c: [city('南京市'), city('苏州市'), city('无锡市'), city('常州市'), city('南通市'), city('徐州市')] },
    { p: '浙江省', c: [city('杭州市'), city('宁波市'), city('温州市'), city('嘉兴市'), city('绍兴市'), city('金华市')] },
    { p: '安徽省', c: [city('合肥市'), city('芜湖市'), city('蚌埠市'), city('阜阳市')] },
    { p: '福建省', c: [city('福州市'), city('厦门市'), city('泉州市'), city('漳州市')] },
    { p: '江西省', c: [city('南昌市'), city('赣州市'), city('九江市'), city('上饶市')] },
    { p: '山东省', c: [city('济南市'), city('青岛市'), city('烟台市'), city('潍坊市'), city('临沂市'), city('济宁市')] },
    { p: '河南省', c: [city('郑州市'), city('洛阳市'), city('南阳市'), city('新乡市'), city('周口市')] },
    { p: '湖北省', c: [city('武汉市'), city('宜昌市'), city('襄阳市'), city('黄石市')] },
    { p: '湖南省', c: [city('长沙市'), city('株洲市'), city('湘潭市'), city('衡阳市'), city('岳阳市'), city('邵阳市')] },
    /* 广东省：本稿唯一完整到区县的省，21 个地级市全在。
       东莞市 / 中山市是「不设区的地级市」（直筒子市），d 给 [] 而不是 null —— 它们
       是真的没有区，不是本稿没收录；选到市就该结束，不该再问一次区县。 */
    { p: '广东省', c: [
      city('广州市', ['荔湾区', '越秀区', '海珠区', '天河区', '白云区', '黄埔区', '番禺区', '花都区', '南沙区', '从化区', '增城区']),
      city('深圳市', ['罗湖区', '福田区', '南山区', '宝安区', '龙岗区', '盐田区', '龙华区', '坪山区', '光明区']),
      city('珠海市', ['香洲区', '斗门区', '金湾区']),
      city('汕头市', ['龙湖区', '金平区', '濠江区', '潮阳区', '潮南区', '澄海区', '南澳县']),
      city('佛山市', ['禅城区', '南海区', '顺德区', '三水区', '高明区']),
      city('韶关市', ['武江区', '浈江区', '曲江区', '始兴县', '仁化县', '翁源县', '乳源瑶族自治县', '新丰县', '乐昌市', '南雄市']),
      city('河源市', ['源城区', '紫金县', '龙川县', '连平县', '和平县', '东源县']),
      city('梅州市', ['梅江区', '梅县区', '大埔县', '丰顺县', '五华县', '平远县', '蕉岭县', '兴宁市']),
      city('惠州市', ['惠城区', '惠阳区', '博罗县', '惠东县', '龙门县']),
      city('汕尾市', ['城区', '海丰县', '陆河县', '陆丰市']),
      city('东莞市', []),
      city('中山市', []),
      city('江门市', ['蓬江区', '江海区', '新会区', '台山市', '开平市', '鹤山市', '恩平市']),
      city('阳江市', ['江城区', '阳东区', '阳西县', '阳春市']),
      city('湛江市', ['赤坎区', '霞山区', '坡头区', '麻章区', '遂溪县', '徐闻县', '廉江市', '雷州市', '吴川市']),
      city('茂名市', ['茂南区', '电白区', '高州市', '化州市', '信宜市']),
      city('肇庆市', ['端州区', '鼎湖区', '高要区', '广宁县', '怀集县', '封开县', '德庆县', '四会市']),
      city('清远市', ['清城区', '清新区', '佛冈县', '阳山县', '连山壮族瑶族自治县', '连南瑶族自治县', '英德市', '连州市']),
      city('潮州市', ['湘桥区', '潮安区', '饶平县']),
      city('揭阳市', ['榕城区', '揭东区', '揭西县', '惠来县', '普宁市']),
      city('云浮市', ['云城区', '云安区', '新兴县', '郁南县', '罗定市'])
    ] },
    { p: '广西壮族自治区', c: [city('南宁市'), city('柳州市'), city('桂林市'), city('梧州市'), city('玉林市')] },
    { p: '海南省', c: [city('海口市'), city('三亚市'), city('儋州市', [])] },
    /* 重庆：26 个市辖区在此；另有 12 个县 / 自治县本稿未收录（真机全量字典有）。
       它正是「按市辖区数量猜直辖市」会漏掉的那一个。 */
    { p: '重庆市', c: [city('重庆市', ['渝中区', '大渡口区', '江北区', '沙坪坝区', '九龙坡区', '南岸区', '北碚区', '渝北区', '巴南区', '万州区', '涪陵区', '黔江区', '长寿区', '江津区', '合川区', '永川区', '南川区', '璧山区', '铜梁区', '潼南区', '荣昌区', '开州区', '梁平区', '武隆区', '綦江区', '大足区'])] },
    { p: '四川省', c: [city('成都市'), city('绵阳市'), city('南充市'), city('宜宾市'), city('达州市')] },
    { p: '贵州省', c: [city('贵阳市'), city('遵义市'), city('六盘水市')] },
    { p: '云南省', c: [city('昆明市'), city('曲靖市'), city('玉溪市'), city('大理白族自治州')] },
    { p: '西藏自治区', c: [city('拉萨市'), city('日喀则市')] },
    { p: '陕西省', c: [city('西安市'), city('宝鸡市'), city('咸阳市'), city('渭南市')] },
    { p: '甘肃省', c: [city('兰州市'), city('天水市'), city('酒泉市')] },
    { p: '青海省', c: [city('西宁市'), city('海东市')] },
    { p: '宁夏回族自治区', c: [city('银川市'), city('石嘴山市'), city('吴忠市')] },
    { p: '新疆维吾尔自治区', c: [city('乌鲁木齐市'), city('克拉玛依市'), city('喀什地区'), city('伊犁哈萨克自治州')] }
  ];

  function provOf (name) {
    var i;
    for (i = 0; i < DICT.length; i += 1) { if (DICT[i].p === name) { return DICT[i]; } }
    return null;
  }
  function cityOf (p, name) {
    var pv = provOf(p), i;
    if (!pv) { return null; }
    for (i = 0; i < pv.c.length; i += 1) { if (pv.c[i].n === name) { return pv.c[i]; } }
    return null;
  }

  /* ---------- 值 <-> 文字 ---------- */
  function parse (v) {
    var a = String(v || '').split('|');
    return { province: a[0] || '', city: a[1] || '', district: a[2] || '' };
  }
  function join (p, c, d) {
    if (!p && !c && !d) { return ''; }
    return [p || '', c || '', d || ''].join('|');
  }
  /* 直辖市的省名与市名相同，连着念是「北京市 · 北京市 · 朝阳区」—— 去重相邻重复段 */
  function textOf (v, empty) {
    var o = parse(v), parts = [], i, out = [];
    parts.push(o.province, o.city, o.district);
    for (i = 0; i < parts.length; i += 1) {
      if (parts[i] && parts[i] !== out[out.length - 1]) { out.push(parts[i]); }
    }
    return out.length ? out.join(' · ') : (empty || '全国不限');
  }

  /* ---------- 最近选择（只在本次会话内存里；真机应写用户会话，不落磁盘） ---------- */
  var RECENT = [];
  function pushRecent (v) {
    var i;
    if (!v) { return; }
    for (i = 0; i < RECENT.length; i += 1) { if (RECENT[i] === v) { RECENT.splice(i, 1); break; } }
    RECENT.unshift(v);
    if (RECENT.length > 5) { RECENT.length = 5; }
  }

  function esc (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ============================================================
     弹层外壳（地区与列表共用一套 DOM / 触控尺寸 / 无障碍）
     ============================================================ */
  var mask, box, hdT, hdS, crumbEl, toolEl, findEl, listEl, tipEl, clearEl, okEl;
  var built = false;
  var open = false;
  var mode = '';          // 'region' | 'list'
  var host = null;        // 触发器
  var level = 'prov';     // region：prov / city / dist
  var cur = { p: '', c: '' };
  var query = '';
  var pickOpts = [];      // list：全部选项
  var pickSel = [];       // list：已选
  var pickMulti = true;
  var lastFocus = null;

  function navHeight () {
    var nav = screen && screen.querySelector('.navbar');
    return nav ? nav.offsetHeight : 0;
  }

  function build () {
    if (built) { return; }
    mask = document.createElement('div');
    mask.className = 'rgn-mask';
    mask.hidden = true;
    mask.innerHTML =
      '<div class="rgn-box" role="dialog" aria-modal="true" aria-label="选择">' +
        '<div class="rgn-hd">' +
          '<span class="rgn-t"></span><span class="rgn-s"></span>' +
          '<button class="rgn-x" type="button" aria-label="关闭，不改变已选">' +
            '<svg class="ic"><use href="#i-close"/></svg>关闭</button>' +
        '</div>' +
        '<div class="rgn-crumbs"></div>' +
        '<div class="rgn-tools">' +
          '<svg class="ic"><use href="#i-search"/></svg>' +
          '<input class="rgn-find" type="text" data-keypad="text" autocomplete="off"' +
                ' aria-label="搜索" placeholder="输入名称搜索">' +
        '</div>' +
        '<div class="rgn-list"></div>' +
        '<div class="rgn-foot">' +
          '<span class="rgn-tip"></span>' +
          '<button class="rgn-go" type="button" data-rgn-clear>清除已选</button>' +
          '<button class="rgn-go rgn-go--ok" type="button" data-rgn-ok>完成</button>' +
        '</div>' +
      '</div>';
    (screen || document.body).appendChild(mask);
    built = true;

    box = mask.querySelector('.rgn-box');
    hdT = mask.querySelector('.rgn-t');
    hdS = mask.querySelector('.rgn-s');
    crumbEl = mask.querySelector('.rgn-crumbs');
    toolEl = mask.querySelector('.rgn-tools');
    findEl = mask.querySelector('.rgn-find');
    listEl = mask.querySelector('.rgn-list');
    tipEl = mask.querySelector('.rgn-tip');
    clearEl = mask.querySelector('[data-rgn-clear]');
    okEl = mask.querySelector('[data-rgn-ok]');

    /* 点遮罩空白处关闭；点弹层内部不关 */
    mask.addEventListener('click', function (e) { if (e.target === mask) { close(); } }, false);
    findEl.addEventListener('input', function () { query = findEl.value || ''; render(); }, false);
    mask.addEventListener('click', onMaskClick, false);
  }

  function close () {
    if (!open) { return; }
    mask.hidden = true;
    open = false;
    query = '';
    if (findEl) { findEl.value = ''; }
    document.removeEventListener('keydown', onKey, false);
    if (window.v3Keypad && window.v3Keypad.isOpen()) { window.v3Keypad.close(false); }
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    host = null;
    mode = '';
  }

  function onKey (e) {
    if (e.key === 'Escape' || e.keyCode === 27) { e.preventDefault(); close(); }
  }

  function show () {
    build();
    mask.style.setProperty('--rgn-navh', navHeight() + 'px');
    mask.hidden = false;
    open = true;
    document.addEventListener('keydown', onKey, false);
    render();
    if (listEl) { listEl.scrollTop = 0; }
  }

  /* ---------- 渲染：选项 ---------- */
  function optHtml (attr, val, name, sub, on) {
    return '<button class="rgn-opt' + (on ? ' rgn-opt--on' : '') + '" type="button" ' +
      attr + '="' + esc(val) + '"' + (on ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' +
      '<span class="rgn-opt-n">' + esc(name) + '</span>' +
      (sub ? '<span class="rgn-opt-s">' + esc(sub) + '</span>' : '') +
      '</button>';
  }

  function render () { if (mode === 'region') { renderRegion(); } else { renderList(); } }

  /* ============================================================
     一、地区下钻
     ============================================================ */
  function districtsNote (c) {
    if (c.d === null) { return '本稿只到市级'; }
    if (c.d.length === 0) { return '不设区'; }
    return c.d.length + ' 个区县';
  }

  function searchRegion (q) {
    var out = [], i, j, k, pv, ct;
    for (i = 0; i < DICT.length && out.length < 60; i += 1) {
      pv = DICT[i];
      if (pv.p.indexOf(q) > -1) { out.push({ p: pv.p, c: '', d: '' }); }
      for (j = 0; j < pv.c.length && out.length < 60; j += 1) {
        ct = pv.c[j];
        if (ct.n.indexOf(q) > -1) { out.push({ p: pv.p, c: ct.n, d: '' }); }
        if (!ct.d) { continue; }
        for (k = 0; k < ct.d.length && out.length < 60; k += 1) {
          if (ct.d[k].indexOf(q) > -1) { out.push({ p: pv.p, c: ct.n, d: ct.d[k] }); }
        }
      }
    }
    return out;
  }

  function renderRegion () {
    var v = host ? (host.getAttribute('data-region-value') || '') : '';
    var sel = parse(v);
    var h = '', i, pv, ct, res, muni;

    hdT.textContent = '选择地区';
    toolEl.hidden = false;
    clearEl.hidden = false;
    okEl.textContent = '用当前已选';

    /* 搜索：跨三级直搜，命中即整条路径回填 —— 31 省逐级翻太慢 */
    if (query) {
      res = searchRegion(query);
      hdS.textContent = '搜索「' + query + '」· ' + res.length + ' 条';
      crumbEl.hidden = true;
      for (i = 0; i < res.length; i += 1) {
        h += optHtml('data-rpath', join(res[i].p, res[i].c, res[i].d),
          textOf(join(res[i].p, res[i].c, res[i].d)),
          res[i].d ? '区县' : (res[i].c ? '整个市' : '整个省'), false);
      }
      listEl.innerHTML = h || '<div class="rgn-void">没有匹配的地区。本稿是精简字典，只有广东省与四个直辖市到区县。</div>';
      tipEl.textContent = '搜到的是完整路径，选中即回填三级';
      return;
    }

    crumbEl.hidden = false;
    crumbEl.innerHTML =
      '<button class="rgn-crumb" type="button" data-rlevel="prov">全国</button>' +
      (cur.p ? '<span class="rgn-sp">›</span><button class="rgn-crumb" type="button" data-rlevel="city">' + esc(cur.p) + '</button>' : '') +
      (cur.c && !isMunicipality(cur.p) ? '<span class="rgn-sp">›</span><button class="rgn-crumb" type="button" data-rlevel="dist">' + esc(cur.c) + '</button>' : '');

    if (level === 'prov') {
      hdS.textContent = '31 个省级行政区 · 精简字典';
      if (RECENT.length) {
        h += '<div class="rgn-gp">最近选过</div>';
        for (i = 0; i < RECENT.length; i += 1) {
          h += optHtml('data-rpath', RECENT[i], textOf(RECENT[i]), '最近', RECENT[i] === v);
        }
        h += '<div class="rgn-gp">全部省级行政区</div>';
      }
      h += optHtml('data-rpath', '', '全国不限', '不按地区筛', !v);
      for (i = 0; i < DICT.length; i += 1) {
        pv = DICT[i];
        h += optHtml('data-rp', pv.p, pv.p,
          isMunicipality(pv.p) ? '直辖市 · 直接选区' : pv.c.length + ' 个市',
          pv.p === sel.province);
      }
      tipEl.textContent = '省 → 市 → 区县，每一级都能提前停';
    } else if (level === 'city') {
      pv = provOf(cur.p);
      hdS.textContent = cur.p + ' · ' + (pv ? pv.c.length : 0) + ' 个市';
      h += optHtml('data-rall', join(cur.p, '', ''), '整个' + cur.p, '不再往下选', v === join(cur.p, '', ''));
      for (i = 0; pv && i < pv.c.length; i += 1) {
        ct = pv.c[i];
        h += optHtml('data-rc', ct.n, ct.n, districtsNote(ct), ct.n === sel.city && !sel.district);
      }
      tipEl.textContent = '只到市就够了的话，选「整个' + cur.p + '」';
    } else {
      ct = cityOf(cur.p, cur.c);
      muni = isMunicipality(cur.p);
      hdS.textContent = cur.c + ' · ' + (ct && ct.d ? ct.d.length : 0) + ' 个区县';
      h += optHtml('data-rall', join(cur.p, cur.c, ''), '整个' + cur.c, '不再往下选', v === join(cur.p, cur.c, ''));
      for (i = 0; ct && ct.d && i < ct.d.length; i += 1) {
        h += optHtml('data-rd', ct.d[i], ct.d[i], '', ct.d[i] === sel.district);
      }
      tipEl.textContent = muni ? '直辖市不必先选市，这里直接是区' : '选到区县最准，也可以停在整个市';
    }
    listEl.innerHTML = h;
  }

  function commitRegion (p, c, d) {
    var v = join(p, c, d);
    var empty = host.getAttribute('data-region-empty') || '全国不限';
    host.setAttribute('data-region-value', v);
    setText(host, '[data-region-text]', textOf(v, empty));
    pushRecent(v);
    renderBag(host, v ? [textOf(v)] : [], 'region');
    fire(host, 'v3region:change', {
      province: p || '', city: c || '', district: d || '', value: v, text: textOf(v, empty)
    });
    close();
  }

  /* ============================================================
     二、列表弹层（7–30 项：两列，13 项以上带搜索）
     ============================================================ */
  function optionsOf (el) {
    var src = el.getAttribute('data-listpick-src');
    var tpl = src ? document.querySelector(src) : null;
    var raw, arr;
    if (!tpl) { return []; }
    raw = tpl.content ? (tpl.content.textContent || '') : (tpl.textContent || '');
    try { arr = JSON.parse(raw); } catch (e) { arr = []; }
    return arr && arr.length ? arr : [];
  }

  function renderList () {
    var h = '', i, o, n, hit = 0;
    hdT.textContent = host.getAttribute('data-listpick-title') || '选择';
    toolEl.hidden = host.getAttribute('data-listpick-find') !== '1';
    crumbEl.hidden = true;
    clearEl.hidden = false;
    okEl.textContent = '完成';
    n = pickOpts.length;
    hdS.textContent = '共 ' + n + ' 项 · 已选 ' + pickSel.length + (pickMulti ? ' · 可多选' : ' · 单选');
    for (i = 0; i < n; i += 1) {
      o = pickOpts[i];
      if (query && o.indexOf(query) === -1) { continue; }
      hit += 1;
      h += optHtml('data-lv', o, o, '', pickSel.indexOf(o) > -1);
    }
    listEl.innerHTML = hit
      ? '<div class="rgn-two">' + h + '</div>'
      : '<div class="rgn-void">没有匹配项。这份字典由管理端下发，前台不自造选项。</div>';
    tipEl.textContent = host.getAttribute('data-listpick-note') || '';
  }

  function commitList () {
    var name = host.getAttribute('data-listpick');
    var empty = host.getAttribute('data-listpick-empty') || ('全部 ' + pickOpts.length + ' 项');
    host.setAttribute('data-listpick-value', pickSel.join(','));
    setText(host, '[data-listpick-text]',
      pickSel.length ? (pickSel.length === 1 ? pickSel[0] : '已选 ' + pickSel.length + ' 项') : empty);
    renderBag(host, pickSel.slice(0), 'list');
    fire(host, 'v3pick:change', { name: name, values: pickSel.slice(0) });
  }

  /* ============================================================
     公共：回写触发器文案 / 已选 chip / 事件
     ============================================================ */
  function setText (el, sel, text) {
    var t = el.querySelector(sel);
    if (t) { t.textContent = text; } else { el.textContent = text; }
  }

  function bagOf (el) {
    var g = el.closest ? (el.closest('.fgroup') || el.parentElement) : el.parentElement;
    return g ? g.querySelector('[data-pickbag]') : null;
  }

  /* 已选项回显成可**单独清除**的 chip —— 之前「少数标签 + 全部」那种写法
     根本看不出当前选了什么，也没法只去掉其中一个。 */
  function renderBag (el, labels, kind) {
    var bag = bagOf(el), h = '', i;
    if (!bag) { return; }
    for (i = 0; i < labels.length; i += 1) {
      h += '<button class="fsel" type="button" data-selkill="' + esc(labels[i]) + '" ' +
           'data-selkind="' + kind + '" aria-label="清除已选：' + esc(labels[i]) + '">' +
           esc(labels[i]) + '<span class="fsel-x" aria-hidden="true">✕</span></button>';
    }
    bag.innerHTML = h;
    bag.hidden = !labels.length;
  }

  function fire (el, type, detail) {
    var ev;
    try {
      ev = new CustomEvent(type, { bubbles: true, detail: detail });
    } catch (e) {
      ev = document.createEvent('CustomEvent');
      ev.initCustomEvent(type, true, false, detail);
    }
    el.dispatchEvent(ev);
  }

  /* ---------- 弹层内点击 ---------- */
  function onMaskClick (e) {
    var t = e.target, b;
    if (!t || !t.closest) { return; }

    if (t.closest('.rgn-x') || t.closest('[data-rgn-ok]')) {
      if (mode === 'list') { commitList(); }
      close(); return;
    }
    if (t.closest('[data-rgn-clear]')) {
      if (mode === 'region') { commitRegion('', '', ''); }
      else { pickSel = []; commitList(); render(); }
      return;
    }
    if ((b = t.closest('[data-rlevel]'))) {
      level = b.getAttribute('data-rlevel');
      if (level === 'prov') { cur = { p: '', c: '' }; }
      if (level === 'city') { cur.c = ''; }
      query = ''; findEl.value = ''; render(); listEl.scrollTop = 0; return;
    }
    if ((b = t.closest('[data-rp]'))) {
      cur.p = b.getAttribute('data-rp');
      /* 直辖市：省市同名，直接跳到区级 —— 不让用户在「重庆市 → 重庆市」上多点一次 */
      if (isMunicipality(cur.p)) { cur.c = cur.p; level = 'dist'; }
      else { cur.c = ''; level = 'city'; }
      render(); listEl.scrollTop = 0; return;
    }
    if ((b = t.closest('[data-rc]'))) {
      var cn = b.getAttribute('data-rc');
      var ct = cityOf(cur.p, cn);
      /* 不设区（东莞/中山）或本稿未收录区县 → 选到市即完成，不给空的下一级 */
      if (!ct || !ct.d || !ct.d.length) { commitRegion(cur.p, cn, ''); return; }
      cur.c = cn; level = 'dist'; render(); listEl.scrollTop = 0; return;
    }
    if ((b = t.closest('[data-rd]'))) { commitRegion(cur.p, cur.c, b.getAttribute('data-rd')); return; }
    if ((b = t.closest('[data-rall]'))) {
      var o = parse(b.getAttribute('data-rall'));
      commitRegion(o.province, o.city, o.district); return;
    }
    if ((b = t.closest('[data-rpath]'))) {
      var o2 = parse(b.getAttribute('data-rpath'));
      commitRegion(o2.province, o2.city, o2.district); return;
    }
    if ((b = t.closest('[data-lv]'))) {
      var v = b.getAttribute('data-lv'), at = pickSel.indexOf(v);
      if (!pickMulti) { pickSel = at > -1 ? [] : [v]; }
      else if (at > -1) { pickSel.splice(at, 1); }
      else { pickSel.push(v); }
      commitList(); render(); return;
    }
  }

  /* ---------- 打开 ---------- */
  function openRegion (el) {
    var o;
    if (!el) { return; }
    build();
    host = el; mode = 'region'; lastFocus = el;
    o = parse(el.getAttribute('data-region-value') || '');
    cur = { p: o.province || '', c: o.city || '' };
    if (o.district) { level = 'dist'; }
    else if (o.city) { level = isMunicipality(o.province) ? 'dist' : 'city'; }
    else if (o.province) { level = isMunicipality(o.province) ? 'dist' : 'city'; }
    else { level = 'prov'; }
    if (level !== 'prov' && isMunicipality(cur.p)) { cur.c = cur.p; }
    show();
  }

  function openList (el) {
    if (!el) { return; }
    build();
    host = el; mode = 'list'; lastFocus = el;
    pickOpts = optionsOf(el);
    pickMulti = el.getAttribute('data-listpick-mode') !== 'single';
    pickSel = String(el.getAttribute('data-listpick-value') || '')
      .split(',').filter(function (s) { return !!s; });
    show();
  }

  /* ---------- 事件委托：页面不用写 JS ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target, b;
    if (!t || !t.closest) { return; }
    if (t.closest('.rgn-mask')) { return; }

    if ((b = t.closest('[data-selkill]'))) {
      var owner = b.closest('.fgroup');
      var lab = b.getAttribute('data-selkill');
      var kind = b.getAttribute('data-selkind');
      var trig = owner && owner.querySelector(kind === 'region' ? '[data-region]' : '[data-listpick]');
      if (!trig) { return; }
      if (kind === 'region') {
        host = trig; mode = 'region'; commitRegion('', '', ''); host = null; mode = '';
      } else {
        host = trig; mode = 'list';
        pickOpts = optionsOf(trig);
        pickMulti = trig.getAttribute('data-listpick-mode') !== 'single';
        pickSel = String(trig.getAttribute('data-listpick-value') || '')
          .split(',').filter(function (s) { return !!s && s !== lab; });
        commitList(); host = null; mode = '';
      }
      return;
    }
    if ((b = t.closest('[data-region]'))) { openRegion(b); return; }
    if ((b = t.closest('[data-listpick]'))) { openList(b); }
  }, false);

  /* ---------- 初始化：把页面写死的初值同步成 chip 与文案 ---------- */
  function boot () {
    var i, els, el, v, sel;
    els = document.querySelectorAll('[data-region]');
    for (i = 0; i < els.length; i += 1) {
      el = els[i];
      v = el.getAttribute('data-region-value') || '';
      setText(el, '[data-region-text]', textOf(v, el.getAttribute('data-region-empty') || '全国不限'));
      renderBag(el, v ? [textOf(v)] : [], 'region');
    }
    els = document.querySelectorAll('[data-listpick]');
    for (i = 0; i < els.length; i += 1) {
      el = els[i];
      sel = String(el.getAttribute('data-listpick-value') || '')
        .split(',').filter(function (s) { return !!s; });
      renderBag(el, sel, 'list');
    }
  }

  window.v3Region = {
    open: openRegion,
    close: close,
    isOpen: function () { return open && mode === 'region'; },
    get: function (el) {
      var v = el.getAttribute('data-region-value') || '', o = parse(v);
      o.value = v; o.text = textOf(v, el.getAttribute('data-region-empty') || '全国不限');
      return o;
    },
    set: function (el, v) {
      var o = parse(v), keep = host, km = mode;
      host = el; mode = 'region'; commitRegionSilent(o.province, o.city, o.district);
      host = keep; mode = km;
    },
    isMunicipality: isMunicipality,
    DICT: DICT
  };

  /* set() 不该顺手关掉别人正开着的弹层 */
  function commitRegionSilent (p, c, d) {
    var v = join(p, c, d);
    var empty = host.getAttribute('data-region-empty') || '全国不限';
    host.setAttribute('data-region-value', v);
    setText(host, '[data-region-text]', textOf(v, empty));
    renderBag(host, v ? [textOf(v)] : [], 'region');
    fire(host, 'v3region:change', {
      province: p || '', city: c || '', district: d || '', value: v, text: textOf(v, empty)
    });
  }

  window.v3Pick = {
    open: openList,
    close: close,
    get: function (el) {
      return String(el.getAttribute('data-listpick-value') || '')
        .split(',').filter(function (s) { return !!s; });
    },
    set: function (el, arr) {
      var keep = host, km = mode;
      host = el; mode = 'list';
      pickOpts = optionsOf(el);
      pickMulti = el.getAttribute('data-listpick-mode') !== 'single';
      pickSel = (arr || []).slice(0);
      commitList();
      host = keep; mode = km;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, false);
  } else { boot(); }
}(window, document));
