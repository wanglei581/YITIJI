/* fix-resume3.js：简历「改写换上」收尾补稿（2026-11-12，补全线第八任总指挥起草，待产品负责人看过再改程序）。
 * 只补两件事，屏上新加的字只有三处：
 *   ① 总览（optimize）里「保持原文」那一条：AI 没动的整段（程序里叫 K 类说明条，另有改写与原句一字不差的同文条目）
 *      不再显示「只能手改」，改为右侧「无需操作」、原句后写「这一段保持原文。」；不计入「只能手改」，没有「打开」。
 *      对照页逐条看时跳过这类条目（第 n / N 条只数可以改的）。
 *   ② 换不上的那一条（改写没有原样写进优化稿）：总览这一行的「只能手改」换成按钮「去编辑区改这一条」，
 *      对照页（compare-manual）在选择按钮的位置给「只能手改」说明和同一个按钮；按钮去编辑区，并停在这一条原文所在的那一栏。
 *      说明句沿用运行页现成的一句（OptimizeOverview.tsx MANUAL_NOTE['not-found']），不新写。
 *   ③ 对照页批量「可采纳的全部采纳」的小字补上「只能手改」：跳过有待确认事实、只能手改的那几条。
 * 导出前核对弹层把新增的数字、职责词做成勾选项：screens4.js 401–410 行已画（「周更 2 篇 · 已核对」），这里不重画。
 * 做法：在 screens.js 原有两屏的画法上做带断言的字符串替换，找不到原句就抛错，免得原稿改了这里静默失效。 */
(function () {
  const list = window.SCREENS;
  const must = (html, from, to) => {
    if (!html.includes(from)) throw new Error('fix-resume3：原稿里找不到「' + from.slice(0, 48) + '」');
    return html.replace(from, to);
  };
  const st = document.createElement('style');
  st.textContent = `
.d4-goedit{cursor:pointer;background:var(--teal-wash);color:var(--teal-ink);border:1.5px solid var(--teal-ink);line-height:1.2;text-align:center}
.d4-keep{min-height:64px;display:flex;align-items:center;justify-content:center;padding:0 8px;border-radius:18px;background:var(--card);border:1.5px dashed var(--edge);font-size:22px;font-weight:700;color:var(--ink-3)}
.body.d4-opt .d4-row.d4-keeprow{min-height:128px;background:var(--well)}
.body.d4-opt .d4-rows{gap:10px}
.body.d4-opt .d4-row{min-height:148px}
.d4-manual{display:grid;grid-template-columns:auto 1fr;gap:12px 16px;align-items:center;padding:18px 20px;border-radius:24px;background:var(--well);border:1.5px solid var(--edge);text-align:left}
.d4-manual p{margin:0;font-size:24px;line-height:1.45;color:var(--ink-2)}
.d4-manual .d4-goedit{grid-column:1 / -1;min-height:88px;border-radius:22px;font-size:26px;font-weight:800}
`;
  document.head.appendChild(st);

  const KEEP_ROW = `<div class="d4-row d4-keeprow" data-kind="keep">
            <div class="d4-rowtx"><b>教育经历（保持原文）</b><small>原文：2019.09–2023.06 山东某高校 新闻学 本科。这一段保持原文。</small></div>
            <span class="d4-keep">无需操作</span>
            <span></span>
          </div>
          `;
  const MANUAL_ROW_FROM = `<small>原文：参与迎新志愿服务。这一条只能在编辑区里改。</small></div>
            <span class="d4-hand">只能手改</span>
            <button class="d4-open" data-go="compare">打开</button>`;
  const MANUAL_ROW_TO = `<small>原文：参与迎新志愿服务。这一条只能在编辑区里改。</small></div>
            <button class="d4-hand d4-goedit" data-go="resume-edit">去编辑区改这一条</button>
            <button class="d4-open" data-go="compare-manual">打开</button>`;

  const opt = list.find((x) => x.id === 'optimize');
  const optRender = opt.render;
  opt.render = () => {
    let h = optRender();
    h = must(h, MANUAL_ROW_FROM, MANUAL_ROW_TO);
    h = must(h, '<div class="d4-row">\n            <div class="d4-rowtx"><b>项目经历</b>', KEEP_ROW + '<div class="d4-row">\n            <div class="d4-rowtx"><b>项目经历</b>');
    return h;
  };
  opt.name = opt.name + '（补：保持原文、去编辑区改）';
  opt.notes = Object.assign({}, opt.notes, {
    keep: opt.notes.keep + ' 11/12 补：AI 没动的整段（保持原文说明条）和改写与原句一字不差的条目，在清单里显示「无需操作」，原句后写「这一段保持原文。」，不计入用改写、保留原文、只能手改，没有「打开」，逐条看时跳过；换不上的那一行用按钮「去编辑区改这一条」代替「只能手改」标签，点了去编辑区并停在这一条原文所在的那一栏，「打开」去 compare-manual。'
  });

  const SKIP_FROM = '<small>跳过有待确认事实的那几条</small>';
  const SKIP_TO = '<small>跳过有待确认事实、只能手改的那几条</small>';
  const cmp = list.find((x) => x.id === 'compare');
  const cmpRender = cmp.render;
  cmp.render = () => must(cmpRender(), SKIP_FROM, SKIP_TO);

  const manual = Object.assign({}, cmp, {
    id: 'compare-manual',
    name: '逐条选择 · 换不上的这一条（补）',
    notes: {
      does: '运行页 /resume/optimize/compare 里「改写没有原样写进优化稿」的那一条（程序里 D 类：原句在稿里不止一处或找不到，改写也不在稿里）。按基准稿分类，和总览用同一个判断；这一帧是第 3 / 4 条 · 项目经历。',
      motion: '无循环动画。',
      keep: '左右照常是原文和改写、字数。选择按钮（用改写 / 保留原文 / 自己写）和新增事实勾选不画：这一条在这里选了也换不进稿，免得选了才说换不了。原位置放「只能手改」和运行页现成的一句「这条改写没有原样写进优化稿，这里没法切换；要用哪一版，请在编辑区里对照着改。」，下面一个大按钮「去编辑区改这一条」：回优化页打开编辑区，滚到这一条原文所在的那一栏并高亮；找不到原文就停在编辑区顶部。批量「可采纳的全部采纳」跳过这一条。不是最后一条，主按钮是「下一条」。'
    },
    render: () => {
      let h = cmpRender();
      h = must(h, SKIP_FROM, SKIP_TO);
      h = must(h, '第 4 / 4 条 · 工作经历', '第 3 / 4 条 · 项目经历');
      h = must(h, '<p>负责学院公众号的选题、撰写和排版。</p>', '<p>参与迎新志愿服务。</p>');
      h = must(h, '<p><del>负责</del><span class="d4-swap">独立运营</span>学院公众号的选题、撰写和排版，<ins>周更 2 篇</ins>。</p>', '<p><del>参与</del><span class="d4-swap">在</span>迎新志愿服务<ins>中协助新生报到和答疑</ins>。</p>');
      h = must(h, '字数 17 → 26 · 删除 2 字 · 新增 11 字', '字数 9 → 18 · 删除 2 字 · 新增 11 字');
      h = must(h, '<label class="d4-fact"><input id="d4Fact" type="checkbox"><span>周更 2 篇是我的真实信息</span></label>', `<div class="d4-manual" role="status" data-testid="compare-manual">
          <span class="d4-hand">只能手改</span>
          <p>这条改写没有原样写进优化稿，这里没法切换；要用哪一版，请在编辑区里对照着改。</p>
          <button class="d4-goedit" data-go="resume-edit">去编辑区改这一条</button>
        </div>`);
      /* 选择按钮和「自己写」块是正文最后两块，一直删到 </main> 之前。 */
      const seg = h.indexOf('<div class="d4-seg d4-dec"');
      const custom = h.indexOf('<div class="d4-custom" id="d4Custom">');
      const mainEnd = h.indexOf('</main>', custom);
      if (seg < 0 || custom < seg || mainEnd < 0) throw new Error('fix-resume3：原稿里找不到选择按钮或「自己写」块');
      h = h.slice(0, seg) + h.slice(mainEnd);
      h = must(h, 'data-go="resume-edit" >去编辑', 'data-go="compare" >下一条');
      return h;
    },
    mount: undefined,
    demo: undefined
  });
  const at = list.indexOf(cmp);
  list.splice(at + 1, 0, manual);
})();
