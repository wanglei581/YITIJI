/* ============================================================
   青序流光 · 简历决策工作台（静态原型）
   宿主：46-resume-decision-workspace.html
   route：/resume/job-fit · /resume/job-fit/actions
        · /resume/career-plan · /resume/templates

   四条本文件必须守住的规则：

   1. 不编造。没有 taskId、目标岗位、AI 返回或打印文件时，页面只写
      「尚未选择 / 等待服务端确认 / 尚未生成 / 当前不可用」，不写岗位、
      企业、简历原文、匹配分、百分比、阶段名、恢复时间或打印成功。
   2. 等待态（loading / analyzing / generating）只表达三件事：整体等待、
      已经确认的输入、还没有返回的内容。不画进度条，不写预计时间，
      并且始终留一条取消或返回的真实出口。
   3. 失败态（ai-down / failed / print-failed / error）给真实产品出口 ——
      简历上传、打印服务、简历优化、岗位信息、帮助页；内部重试只回到
      对应的合理状态。普通 CTA 不叫「结构演示 / 状态演示」。
   4. 原型控件只在 ?debug=1 出现。非 debug 分支不解除 hidden / disabled，
      也不绑定任何打开交互（配合 CSS 的 html:not([data-debug="1"]) 段落）。
   5. 主内容是产品内容，不是治理说明。真实性 / 授权 / 服务端边界压成一条
      guardline 或底部单行披露；结果、清单、计划、模板页的主体一律是真实
      业务结构 + 诚实槽位。用户可见文案里不出现 route 字符串、taskId 这类
      内部标识，也不出现「结构演示 / 信息结构」这类开发话术。
   ============================================================ */

(function () {
  'use strict'

  /* ---------- URL 参数 ---------- */

  var Q = new URLSearchParams(location.search)
  var FLAT = Q.get('flat') === '1'
  var DEBUG = Q.get('debug') === '1'

  var SCREENS = {
    'job-fit': {
      eyebrow: 'JOB FIT',
      route: '/resume/job-fit',
      def: 'missing-task',
      states: ['missing-task', 'rejected-task', 'loading', 'anonymous-consent', 'member-consent',
        'pick', 'analyzing', 'result-high', 'result-mid', 'result-low', 'ai-down', 'failed']
    },
    actions: {
      eyebrow: 'FIT ACTIONS',
      route: '/resume/job-fit/actions',
      def: 'missing-task',
      states: ['missing-task', 'loading', 'ready', 'print-pending', 'print-failed']
    },
    'career-plan': {
      eyebrow: 'CAREER PLAN',
      route: '/resume/career-plan',
      def: 'missing-task',
      states: ['missing-task', 'loading', 'generating', 'ready', 'ai-down', 'failed',
        'print-pending', 'print-failed']
    },
    templates: {
      eyebrow: 'RESUME TEMPLATES',
      route: '/resume/templates',
      def: 'list',
      states: ['loading', 'error', 'empty', 'list', 'selected']
    }
  }

  var screen = Object.prototype.hasOwnProperty.call(SCREENS, Q.get('screen')) ? Q.get('screen') : 'job-fit'
  var conf = SCREENS[screen]
  var state = conf.states.indexOf(Q.get('state')) >= 0 ? Q.get('state') : conf.def

  function url (s, st) {
    return '?screen=' + s + '&state=' + st + (FLAT ? '&flat=1' : '') + (DEBUG ? '&debug=1' : '')
  }

  /* ---------- 站内真实去处（只写确实存在的原型页与 route） ---------- */

  var T = {
    triage: ['21-resume-triage.html?state=source', '/resume/source'],
    resumeHub: ['16-service-hubs.html?hub=resume', '/resume-service'],
    printHub: ['10-print-hub.html', '/print-scan'],
    scan: ['18-scan-workbench.html', '/scan/start'],
    jobs: ['26-browse-list.html', '/jobs'],
    optimize: ['23-resume-optimize.html', '/resume/optimize'],
    generate: ['24-resume-generate.html', '/resume/generate'],
    materials: ['25-material-workshop.html', '/resume/materials'],
    assistant: ['05-ai-cockpit.html', '/assistant'],
    help: ['06-help.html', '/help']
  }

  /** 本宿主内部的状态跳转，也带真实 route（四条 route 都由这一个宿主承接）。 */
  function at (s, st) { return [url(s, st), SCREENS[s].route] }
  function tgt (t) { return typeof t === 'string' ? T[t] : t }
  function tid (id) { return 'resume-decision-' + screen + '-' + id }

  /* ---------- 图标 ---------- */

  var IC = {
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/>',
    shield: '<path d="M12 3l7.5 3v6.2c0 4.4-3.1 7.6-7.5 8.8-4.4-1.2-7.5-4.4-7.5-8.8V6z"/>',
    lock: '<rect x="4.5" y="10" width="15" height="10" rx="2.4"/><path d="M8 10V7.2a4 4 0 0 1 8 0V10"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    print: '<path d="M7.5 9.5V3.5h9v6"/><rect x="4" y="9.5" width="16" height="7" rx="2"/><path d="M7.5 14h9v6.5h-9z"/>',
    scan: '<path d="M4 8.5V5.6A1.6 1.6 0 0 1 5.6 4H8.5"/><path d="M20 8.5V5.6A1.6 1.6 0 0 0 18.4 4H15.5"/><path d="M4 15.5v2.9A1.6 1.6 0 0 0 5.6 20H8.5"/><path d="M20 15.5v2.9A1.6 1.6 0 0 1 18.4 20H15.5"/><path d="M4 12h16"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
    pen: '<path d="M4 20h4.2L20 8.2 15.8 4 4 15.8z"/><path d="M14.4 5.4l4.2 4.2"/>',
    route: '<circle cx="6" cy="6" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="M6 8.6V13a5 5 0 0 0 5 5h4.4"/>',
    grid: '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="2"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="2"/><rect x="13" y="13" width="7.5" height="7.5" rx="2"/>',
    clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3 1.8"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20.4 4.2v4.6h-4.6"/>',
    alert: '<path d="M12 3.6l8.6 15.4H3.4z"/><path d="M12 9.8v4"/><path d="M12 16.6h.01"/>',
    x: '<path d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6"/>',
    help: '<circle cx="12" cy="12" r="8.6"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.1 2.4c-.7.2-1.1.8-1.1 1.5v.4"/><path d="M11.9 16.8h.01"/>',
    bot: '<rect x="4" y="7.5" width="16" height="11" rx="3.2"/><path d="M12 4v3.5"/><path d="M9 12.6h.01M15 12.6h.01"/>',
    ok: '<path d="M4.5 12.5l5 5 10-11"/>',
    chev: '<path d="M6 9.5l6 6 6-6"/>'
  }

  function svg (name, size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      IC[name] + '</svg>'
  }

  /* ---------- 骨架与产品模块 ---------- */

  function sec (o) {
    return '<section class="section' + (o.grow ? ' grow' : '') + '">' +
      '<div class="section-head"><h2>' + (o.no ? '<span class="no">' + o.no + '</span>' : '') + o.title + '</h2>' +
      (o.small ? '<small>' + o.small + '</small>' : '') + '</div>' +
      (o.copy ? '<p class="copy">' + o.copy + '</p>' : '') + o.body + '</section>'
  }

  /** 输入槽位：第三项为 true 表示这一格是已确定的事实，其余一律显示诚实占位。 */
  function slots (items, c3) {
    return '<div class="slots' + (c3 ? ' c3' : '') + '">' + items.map(function (x) {
      return '<div class="slot' + (x[2] ? ' set' : '') + '"><small>' + x[0] + '</small><b>' + x[1] + '</b></div>'
    }).join('') + '</div>'
  }

  /** 前置检查：[ck, icon, 标题, 说明, 角标]，ck ∈ ok | wait | off。 */
  function checks (items) {
    return '<div class="checks">' + items.map(function (x) {
      return '<div class="check" data-ck="' + x[0] + '">' +
        '<div class="ck-ic">' + svg(x[1], 24) + '</div>' +
        '<div class="ck-t"><b>' + x[2] + '</b><p>' + x[3] + '</p></div>' +
        '<div class="ck-s">' + x[4] + '</div></div>'
    }).join('') + '</div>'
  }

  /** 状态轨：只标当前停在哪一步，不画百分比。[小标, 标题, 说明, 是否当前]。 */
  function trace (items) {
    return '<div class="trace">' + items.map(function (x) {
      return '<div' + (x[3] ? ' class="now"' : '') + '><small>' + x[0] + '</small><b>' + x[1] + '</b>' +
        '<p>' + x[2] + '</p>' + (x[3] ? '<span class="now-tag">当前停在这里</span>' : '') + '</div>'
    }).join('') + '</div>'
  }

  /** 左边一句判断，右边一句解释。[前缀, 判断, 说明]。 */
  function why (items) {
    return '<div class="why">' + items.map(function (x) {
      return '<div><div><span class="wy-h">' + x[0] + '</span><b>' + x[1] + '</b></div><p>' + x[2] + '</p></div>'
    }).join('') + '</div>'
  }

  /** 恢复路径卡（真实可点）：[icon, 标题, 说明, 行动词, target, id]。 */
  function routes (items, cols) {
    return '<div class="routes ' + (cols === 3 ? 'c3' : 'c2') + '">' + items.map(function (x) {
      var d = tgt(x[4])
      return '<a class="route-card m-press" href="' + d[0] + '" data-route="' + d[1] + '" data-testid="' + tid('route-' + x[5]) + '">' +
        '<span class="rc-ic">' + svg(x[0], 24) + '</span><b>' + x[1] + '</b><p>' + x[2] + '</p>' +
        '<span class="rc-go">' + x[3] + ' →</span></a>'
    }).join('') + '</div>'
  }

  /** 非 AI 退路条：[icon, 标题, 一句话, target, id]。 */
  function kit (items) {
    return '<div class="kit">' + items.map(function (x) {
      var d = tgt(x[3])
      return '<a class="m-press" href="' + d[0] + '" data-route="' + d[1] + '" data-testid="' + tid('kit-' + x[4]) + '">' +
        '<span class="kt-ic">' + svg(x[0], 22) + '</span><span><b>' + x[1] + '</b><small>' + x[2] + '</small></span></a>'
    }).join('') + '</div>'
  }

  /** 等待面板：整体脉冲，没有进度条、百分比或预计时间。 */
  function waiting (icon, head, body, tag) {
    return '<div class="wait"><div class="w-ic">' + svg(icon, 34) + '</div>' +
      '<div class="w-t"><b>' + head + '</b><p>' + body + '</p>' +
      '<div class="m-pulse"><span class="mp-dots"><i></i><i></i><i></i></span><span>' + tag + '</span></div>' +
      '</div></div>'
  }

  /** 紧凑披露条：一行说清真实性 / 授权 / 服务端边界，不再用等权卡铺满主内容。 */
  function guard (head, body) {
    return '<div class="guardline"><span class="g-ic">' + svg('shield', 18) + '</span>' +
      '<p><b>' + head + '</b>' + body + '</p></div>'
  }

  /** 真实业务分组 + 诚实字段槽位：[tone, 角标, 组名, 一句说明, 角标状态, [[字段, 占位], ...]]。
      角标是 IC 里的图标名就画图标，否则当文字用。容器复用 .ready-stack。 */
  function groups (items) {
    return '<div class="ready-stack">' + items.map(function (g) {
      return '<div class="wl-group" data-tone="' + g[0] + '">' +
        '<div class="wl-top"><span class="wl-no">' + (IC[g[1]] ? svg(g[1], 22) : g[1]) + '</span>' +
        '<b>' + g[2] + '</b><span class="wl-chip">' + g[4] + '</span></div>' +
        '<p class="wl-desc">' + g[3] + '</p><div class="wl-fields">' +
        g[5].map(function (f) {
          return '<div class="wl-field"><small>' + f[0] + '</small><span>' + f[1] + '</span></div>'
        }).join('') + '</div></div>'
    }).join('') + '</div>'
  }

  /** 下一步建议：第一条就是这一档的首选，顺序与文案随档位变。[target, 标题, 一句话, id]。 */
  function nextSteps (items) {
    return '<div class="nextsteps">' + items.map(function (x, i) {
      var d = tgt(x[0])
      return '<a class="ns-row m-press" href="' + d[0] + '" data-route="' + d[1] +
        '" data-testid="' + tid('next-' + x[3]) + '">' +
        '<span class="ns-no">' + (i + 1) + '</span>' +
        '<span class="ns-t"><b>' + x[1] + '</b><p>' + x[2] + '</p></span>' +
        '<span class="ns-go">→</span></a>'
    }).join('') + '</div>'
  }

  /** 明确否定：这些事现在没有发生。 */
  function nots (items) {
    return '<div class="nots">' + items.map(function (x) {
      return '<div class="not"><span class="nt-ic">' + svg('x', 18) + '</span><span>' + x + '</span></div>'
    }).join('') + '</div>'
  }

  /** 当前判定条：[tone, 名称, 结论]，tone ∈ v-bad | v-warn | v-ok。 */
  function verdict (items, cols) {
    return '<div class="verdict' + (cols === 2 ? ' c2' : '') + '">' + items.map(function (x) {
      return '<div class="' + x[0] + '"><small>' + x[1] + '</small><b>' + x[2] + '</b></div>'
    }).join('') + '</div>'
  }

  /** 未返回占位：虚线框写清「等待返回」，不画骨架假内容。 */
  function ghosts (items, cols) {
    return '<div class="ghosts' + (cols === 2 ? ' c2' : '') + '">' + items.map(function (x) {
      return '<div class="ghost"><b>' + x[0] + '</b><p>' + x[1] + '</p><span class="g-tag">' + x[2] + '</span></div>'
    }).join('') + '</div>'
  }

  function steps (items) {
    return '<div class="steps">' + items.map(function (x, i) {
      return '<div class="step"><div class="s-no">' + (i + 1) + '</div>' +
        '<div class="s-t"><b>' + x[0] + '</b><p>' + x[1] + '</p></div></div>'
    }).join('') + '</div>'
  }

  function listRows (items) {
    return '<div class="list">' + items.map(function (x, i) {
      return '<div class="list-row"><i>' + (i + 1) + '</i><span>' + x + '</span></div>'
    }).join('') + '</div>'
  }

  /** 就地展开：只切 class，不跳状态、不改 URL。 */
  function disclose (id, label, items) {
    return '<button type="button" class="disclose" data-disclose="' + id + '" aria-expanded="false" ' +
      'aria-controls="dsc-' + id + '" data-testid="' + tid('disclose-' + id) + '">' +
      '<span>' + label + '</span><span class="d-cv">' + svg('chev', 22) + '</span></button>' +
      '<div class="disclose-body" id="dsc-' + id + '"><ul>' +
      items.map(function (x) { return '<li>' + x + '</li>' }).join('') + '</ul></div>'
  }

  function notice (kind, head, body) {
    return '<div class="notice' + (kind ? ' ' + kind : '') + '"><span class="nc-ic">' +
      svg(kind === 'error' ? 'alert' : kind === 'warn' ? 'alert' : 'help', 22) +
      '</span><div><b>' + head + '</b><br>' + body + '</div></div>'
  }

  function rails (items) {
    return '<div class="rails">' + items.map(function (x) {
      return '<div class="rail"><small>' + x[0] + '</small><b>' + x[1] + '</b><p>' + x[2] + '</p></div>'
    }).join('') + '</div>'
  }

  function flow (items) {
    return '<div class="decision-flow">' + items.map(function (x) {
      return '<div><small>' + x[0] + '</small><b>' + x[1] + '</b><p>' + x[2] + '</p></div>'
    }).join('') + '</div>'
  }

  function cards (items) {
    return '<div class="grid3 mt">' + items.map(function (x) {
      return '<div class="card"><h3>' + x[0] + '</h3><p>' + x[1] + '</p><span class="tag">' + x[2] + '</span></div>'
    }).join('') + '</div>'
  }

  /* ---------- 动作坞 ---------- */

  function btn (t, label, primary, id) {
    var d = tgt(t)
    return '<a class="btn m-press' + (primary ? ' primary' : '') + '" href="' + d[0] + '" data-route="' + d[1] +
      '" data-testid="' + tid(id) + '">' + label + (primary ? '<em>→</em>' : '') + '</a>'
  }

  function dock (note, buttons) {
    return '<div class="actiondock">' +
      (note ? '<p class="act-note">' + svg('alert', 20) + '<span>' + note + '</span></p>' : '') +
      '<div class="actionbar">' + buttons + '</div></div>'
  }

  /* ---------- job-fit ---------- */

  var V = {}

  V['job-fit/missing-task'] = {
    h: ['先补上简历任务，<em>再谈岗位匹配。</em>',
      '岗位匹配需要一份仍可读取的本人简历任务。现在没有，所以不显示任何岗位、企业或匹配结论。',
      '缺少可读取的本人简历任务'],
    body: function () {
      return sec({
        no: '01', title: '这次匹配要用到的输入', small: '四项都要有真实来源',
        body: slots([
          ['本人简历任务', '尚未选择'],
          ['目标岗位', '尚未选择'],
          ['本人授权', '未确认'],
          ['结果归属', '仅本人可见', true]
        ])
      }) + sec({
        no: '02', title: '现在缺哪一项', small: '补齐前不会启动分析', grow: true,
        body: checks([
          ['off', 'file', '本人简历任务', '还没有可读取的简历任务。上传 PDF 或扫描纸质简历，解析成功后才会出现可选任务。', '缺失'],
          ['wait', 'target', '目标岗位', '可以从已发布岗位里选，也可以只填一个目标岗位名称。当前尚未选择。', '待选择'],
          ['wait', 'shield', '本人授权', '匿名任务和会员账号按各自规则确认。任务补齐后再走这一步。', '待确认'],
          ['ok', 'lock', '结果去向', '匹配参考只供本人准备，不提供给企业，也不形成任何投递记录。', '已固定']
        ])
      }) + sec({
        no: '03', title: '不做 AI 分析，也能先推进这些', small: '都是既有流程',
        body: kit([
          ['print', '打印现有简历', '已有电子稿或纸质件，直接走打印流程', 'printHub', 'print'],
          ['scan', '扫描纸质简历', '先扫成 PDF 存下来，再决定要不要分析', 'scan', 'scan'],
          ['list', '看来源岗位要求', '直接浏览来源平台的岗位信息，自己比对', 'jobs', 'jobs']
        ])
      }) + dock('没有本人简历任务时，本页不显示任何岗位、企业或匹配结论。',
        btn('resumeHub', '返回简历服务', false, 'back') +
        btn('triage', '去上传或扫描简历', true, 'primary'))
    }
  }

  V['job-fit/rejected-task'] = {
    h: ['这份任务<em>现在读不出来。</em>',
      '服务端没有返回这份简历任务的内容。系统不会用其他人的任务或历史结果替代它。',
      '任务不可读取，需重新准备'],
    body: function () {
      return sec({
        title: '读不出来的三种可能', small: '具体原因以服务端返回为准',
        body: why([
          ['可能原因', '任务已过期', '临时任务有保存期限，过期后不再返回原文，也不保留分析结果。'],
          ['可能原因', '不属于当前会话', '换人使用或重新登录后，上一次的任务不会带到这次会话里。'],
          ['可能原因', '服务端已停止读取', '服务端可以主动停止某份任务的读取，此时不展示任何原文片段。']
        ])
      }) + sec({
        title: '让它重新可用的三步', small: '每一步都在既有流程里', grow: true,
        body: steps([
          ['重新上传或扫描一份简历', '进入简历材料入口，选择文件上传、纸质扫描或手机传输。'],
          ['等待解析完成', '解析成功后才会出现可用任务；失败会直接显示失败原因，不会静默通过。'],
          ['回到岗位匹配重新选目标', '任务可用后，再选择目标岗位并确认本人授权。']
        ])
      }) + sec({
        title: '这次没有发生的事', small: '明确否定，避免误解',
        body: nots([
          '没有读取到本人简历原文',
          '没有生成任何匹配等级或建议',
          '没有把简历内容提供给企业或第三方'
        ]) + disclose('reuse', '为什么不直接沿用上一次的结果？', [
          '上一次的结果对应的是另一份任务，未必是你现在手上的这份简历。',
          '任务不可读取时，无法核对结果与原文的对应关系，展示出来就是不可验证的结论。',
          '重新上传后拿到的是这份材料的真实分析，比拿旧结果凑合更有用。'
        ])
      }) + dock('不会用其他人的任务或历史结果顶替这份不可读取的任务。',
        btn('resumeHub', '返回简历服务', false, 'back') +
        btn('triage', '重新上传简历', true, 'primary'))
    }
  }

  V['job-fit/loading'] = {
    h: ['正在读取，<em>还没有结果。</em>',
      '读取请求已经提交。读到历史报告才显示内容；没有报告或读取失败会直接转到对应状态。',
      '正在等待服务端返回'],
    body: function () {
      return sec({
        title: '正在读取历史岗位匹配报告', small: '无进度条 · 无预计时间',
        body: waiting('clock', '请求已提交，等待服务端返回',
          '读取的是你本人此前的岗位匹配报告。返回之前，不显示等级、依据或建议。',
          '只表达整体等待，没有百分比')
      }) + sec({
        title: '已经确认并提交的内容', small: '本次读取用到的真实条件', grow: true,
        body: listRows([
          '当前会话身份已校验，只读取本人的任务与报告',
          '读取请求已发送给服务端，等待确认这份任务是否仍然可用',
          '如果历史报告存在，其目标岗位会随报告一起返回',
          '如果不存在历史报告，会转到目标岗位选择，而不是显示一份空结果',
          '等待期间不放开打印，也不提前展示任何结论'
        ])
      }) + sec({
        title: '还没有返回的内容', small: '返回前一律留空',
        body: ghosts([
          ['匹配等级', '三档参考只在结果返回后显示。', '等待返回'],
          ['匹配依据', '岗位要求与简历依据由服务端逐条给出。', '等待返回'],
          ['行动建议', '差距与准备建议只出现在真实结果里。', '等待返回']
        ])
      }) + dock('读取失败或没有历史报告时会直接说明，不会显示一份空白结果。',
        btn('resumeHub', '返回简历服务', false, 'back') +
        btn(at('job-fit', 'pick'), '取消读取，重新选择目标岗位', true, 'primary'))
    }
  }

  V['job-fit/analyzing'] = {
    h: ['已提交分析，<em>等待返回。</em>',
      '目标岗位与本人授权已确认。服务端返回之前，不显示等级、依据、百分比或任何录用相关结论。',
      '分析进行中，等待服务端返回'],
    body: function () {
      return sec({
        title: '正在等待岗位匹配结果', small: '无阶段名 · 无百分比',
        body: waiting('bot', '分析请求已提交给服务端',
          '本页只表达整体等待。没有阶段进度，也不预告结果会是什么。',
          '等待中，可随时取消并返回')
      }) + sec({
        title: '当前停在哪一步', small: '只标位置，不画进度',
        body: trace([
          ['输入', '已确认输入', '目标岗位与本人授权都已确认。', false],
          ['当前', '等待服务端返回', '等级、依据与建议全部由服务端给出。', true],
          ['之后', '由本人决定下一步', '看完参考后，是否优化、准备材料或打印由你决定。', false]
        ])
      }) + sec({
        title: '等待期间不会发生的事', small: '合规边界不随状态放宽', grow: true,
        body: nots([
          '不显示匹配百分比、评分或通过率预测',
          '不给出录用、面试或 Offer 相关结论',
          '不把简历内容提供给企业或第三方',
          '不在本页生成文件、发起支付或打印',
          '不替你在来源渠道完成任何投递或预约动作'
        ])
      }) + dock('分析结果只供本人准备使用，不构成企业侧任何判断。',
        btn('resumeHub', '返回简历服务', false, 'back') +
        btn(at('job-fit', 'pick'), '取消分析，返回目标选择', true, 'primary'))
    }
  }

  V['job-fit/ai-down'] = {
    h: ['AI 匹配<em>当前不可用。</em>',
      '这项分析暂时调不通。系统不显示等级、依据或建议，也不会用旧结果冒充这次的结论。',
      'AI 匹配服务当前不可用'],
    body: function () {
      return sec({
        title: '当前判定', small: '只写已经确认的事实',
        body: verdict([
          ['v-bad', 'AI 匹配分析', '当前不可用'],
          ['v-ok', '本人简历任务', '仍可查看和打印'],
          ['v-warn', '其他 AI 能力', '需各自打开确认']
        ])
      }) + sec({
        title: '现在能走的三条路', small: '都进入既有流程',
        body: routes([
          ['pen', '继续改简历', '不依赖这项分析，先按目标岗位自己调整内容重点。', '去简历优化', 'optimize', 'optimize'],
          ['list', '看来源岗位要求', '直接浏览来源平台的岗位信息，自己逐条比对。', '去岗位信息', 'jobs', 'jobs'],
          ['print', '打印现有简历', '手上已有可用文件时，直接进入既有打印流程。', '去打印服务', 'printHub', 'print']
        ], 3)
      }) + sec({
        title: '不可用期间，这些仍然成立', small: '不因故障降低标准', grow: true,
        body: why([
          ['状态', '不做假降级', '不会用模板结论或历史报告冒充这一次的分析结果。'],
          ['恢复', '不承诺恢复时间', '服务端没有给出可用时间，本页也不写「稍后自动恢复」。'],
          ['数据', '材料仍在你这边', '分析不可用不影响你查看、修改和打印自己的材料。'],
          ['费用', '未产生任何扣费', '分析没有完成，本页也没有发起过支付。'],
          ['边界', '仍不提供给企业', '无论服务是否可用，简历都不会提供给企业或第三方。']
        ])
      }) + dock('服务不可用时不显示任何匹配结论，也不保留半截结果。',
        btn('resumeHub', '返回简历服务', false, 'back') +
        btn(at('job-fit', 'analyzing'), '重新提交分析', true, 'primary'))
    }
  }

  V['job-fit/failed'] = {
    h: ['这次分析<em>没有完成。</em>',
      '请求中断，没有可确认的结果。系统不展示等级、依据或建议，也不保留半截结论。',
      '本次分析未完成'],
    body: function () {
      return sec({
        title: '这次请求的结果', small: '只写事实，不猜原因',
        body: verdict([
          ['v-bad', '本次分析', '未完成'],
          ['v-warn', '可用结果', '没有返回']
        ], 2)
      }) + sec({
        title: '重试之前，先确认这几件事', small: '确认后再决定要不要重来', grow: true,
        body: checks([
          ['ok', 'file', '简历任务仍然可用', '任务本身没有失效，重试不需要重新上传材料。', '可用'],
          ['wait', 'target', '目标岗位保持不变', '上一次选择的目标仍在本次会话内，重试会沿用它。', '待确认'],
          ['wait', 'refresh', '重试次数由你决定', '系统不会自动重复请求，也不会在后台悄悄重跑。', '手动'],
          ['off', 'x', '没有部分结果', '不保留半截结论，也不把上一次的报告当成这次的结果。', '无'],
          ['ok', 'lock', '记录只留在你这边', '失败记录只用于本人排查，不提供给企业或第三方。', '已固定']
        ])
      }) + sec({
        title: '不想重试，也有别的走法', small: '都是既有入口',
        body: kit([
          ['pen', '先自己改简历', '按目标岗位重排内容重点，不依赖 AI', 'optimize', 'optimize'],
          ['print', '打印现有简历', '已有可用文件就直接走打印流程', 'printHub', 'print'],
          ['help', '问 AI 顾问怎么准备', '让顾问按你的目标给准备思路', 'assistant', 'assistant']
        ])
      }) + dock('失败不会写成已完成，也不会写成已发送到打印机。',
        btn(at('job-fit', 'pick'), '返回目标选择', false, 'back') +
        btn(at('job-fit', 'analyzing'), '重新提交分析', true, 'primary'))
    }
  }

  V['job-fit/pick'] = {
    h: ['先把目标说清，<em>再决定下一步。</em>',
      '匹配只对本人提供三档参考；岗位、授权与结果全部以服务端返回为准。',
      '匹配前需要真实任务与本人授权'],
    body: function () {
      return sec({
        no: '01', title: '选择目标岗位', small: '系统岗位或手填目标，二选一',
        body: '<div class="grid2 mt">' +
          '<button class="card choice on" type="button" data-testid="resume-decision-job-fit-system-choice">' +
          '<h3>从已发布岗位中选择</h3><p>只有服务端返回已发布岗位后，才会显示标题、来源与详情。</p>' +
          '<span class="tag">按来源数据选择</span></button>' +
          '<button class="card choice" type="button" data-testid="resume-decision-job-fit-manual-choice">' +
          '<h3>手填目标岗位</h3><p>只填写目标名称与要求，不会把内容提供给企业，也不替你操作。</p>' +
          '<span class="tag">只供本人分析</span></button></div>' +
          '<div class="field"><small>目标岗位</small><b><span class="placeholder">等待本人选择或填写</span></b></div>'
      }) + sec({
        no: '02', title: '分析前检查', small: '三项齐备才启动', grow: true,
        body: checks([
          ['wait', 'file', '本人简历任务', '必须存在，且通过当前会话校验；不会读取别人的任务。', '待确认'],
          ['wait', 'target', '目标岗位', '系统岗位或手填目标，至少要有名称，不补默认内容。', '待选择'],
          ['wait', 'shield', '本人授权', '匿名与会员按各自规则确认；未授权不分析。', '待确认'],
          ['ok', 'lock', '结果去向', '三档参考只供本人准备，不提供给企业，也不形成投递记录。', '已固定']
        ]) + guard('三档参考 · 较高 / 中等 / 偏低',
          '不给分数，也不预测通过率；分析过程中不显示进度百分比，返回前不提前放出结果。')
      }) + sec({
        no: '03', title: '不做 AI 分析，也能先推进', small: '都是既有流程',
        body: kit([
          ['print', '打印现有简历', '已有电子稿或纸质件，直接走打印流程', 'printHub', 'print'],
          ['list', '看来源岗位要求', '直接浏览来源平台的岗位信息，自己比对', 'jobs', 'jobs'],
          ['help', '问 AI 顾问怎么定目标', '还没想清楚方向时，先把想法说出来', 'assistant', 'assistant']
        ])
      }) + dock('匹配结果不代表录用判断，也不会提供给企业。',
        btn('resumeHub', '返回简历服务', false, 'back') +
        btn(at('job-fit', 'anonymous-consent'), '继续并确认授权', true, 'primary'))
    }
  }

  function consent (member) {
    return {
      h: ['先确认授权，<em>再开始分析。</em>',
        '授权只用于对当前这份本人简历任务做岗位匹配参考。没有授权，简历不会进入这项 AI 分析。',
        member ? '等待会员本人确认授权' : '等待匿名任务本人确认授权'],
      body: function () {
        return sec({
          title: '确认本次分析授权', small: member ? '会员授权' : '匿名任务授权',
          copy: '授权是一次性的：只覆盖当前简历任务和这次选择的目标岗位，下一次分析会重新问你一遍。',
          body: cards([
            ['分析范围', '当前简历与这次选择的目标岗位。', '不扩展到其他任务'],
            ['结果归属', '只供本人查看，不提供给企业。', '不参与企业筛选'],
            ['随时停止', '授权状态与可用范围由真实服务端决定。', '不伪造已撤回']
          ])
        }) + sec({
          title: '授权覆盖什么、不覆盖什么', small: '逐条写清楚', grow: true,
          body: checks([
            ['ok', 'target', '分析范围', '仅当前本人简历任务，与这次选择的目标岗位。', '本次'],
            ['ok', 'user', '结果归属', '只供本人查看，不提供给企业，也不形成投递记录。', '本人'],
            ['wait', 'clock', '有效范围', '这次授权只对本次分析生效，下一次会再确认一遍。', '单次'],
            ['off', 'x', '不包含的事', '不包含把简历提供给企业，也不包含代你在来源渠道操作。', '不做'],
            ['ok', 'lock', '记录范围', '只记录你本人发起过这次分析，不记录任何企业侧动作。', '已固定']
          ])
        }) + sec({
          title: '授权前后各是什么状态', small: '不预先承诺结果',
          body: rails([
            ['授权前', '不请求分析', '未确认前，简历与岗位不会进入这项分析。'],
            ['授权后', '等待真实结果', '请求仍可能失败、超时或不可用，不预先承诺结果。'],
            ['授权边界', '只限本人', '不提供给企业，也不形成投递、筛选或录用流程。']
          ])
        }) + dock('确认授权后才开始分析；未确认前，简历不会进入这项分析。',
          btn(at('job-fit', 'pick'), '暂不授权', false, 'decline') +
          btn(at('job-fit', 'analyzing'), '确认并开始分析', true, 'primary'))
      }
    }
  }

  V['job-fit/anonymous-consent'] = consent(false)
  V['job-fit/member-consent'] = consent(true)

  /* 三档结果：档位是服务端唯一给出的事实，所以三档之间必须在「关注重点、风险提示、
     推荐下一步顺序、首选 CTA、色系」上真的不同；除此之外全部是诚实槽位 ——
     不写岗位、企业、经历、匹配点、分数或通过率。 */
  var RESULT = {
    high: {
      hero: ['这次匹配，<em>准备程度较高。</em>',
        '方向基本对得上。重点转到怎么把已经匹配的经历讲清楚，具体依据与差距由服务端逐条返回。',
        '匹配参考已返回 · 较高'],
      focus: '把已经对得上的经历讲清楚、讲具体',
      lead: '较高说明目标方向和你现在这份材料基本对得上。接下来把对应的经历、成果和能出示的材料准备到当面能讲清楚。',
      risk: '较高不等于稳：面试仍会追细节，先把能佐证的材料备齐。',
      steps: [
        [at('actions', 'ready'), '查看行动清单', '把返回的依据变成一条条能做的准备。', 'actions'],
        ['optimize', '去简历优化', '把对得上的经历排到更靠前、写得更具体。', 'optimize'],
        ['materials', '备齐佐证材料', '成果、证书、作品这类能当面出示的东西。', 'materials']
      ],
      note: '参考只描述准备程度，不代表企业的真实评价。',
      cta: [[at('job-fit', 'pick'), '换一个目标岗位', 'back'], [at('actions', 'ready'), '查看行动清单', 'primary']]
    },
    mid: {
      hero: ['还有差距，<em>但都能补上。</em>',
        '有一部分对得上，也有明显缺口。先按返回的差距补关键项。',
        '匹配参考已返回 · 中等'],
      focus: '先补差距里最影响判断的那几项',
      lead: '中等说明这份材料和目标岗位有一部分对得上，也有明显缺口。补的顺序比补的数量更重要：先补硬性要求，再补加分项。',
      risk: '中等的关键在顺序：先补硬性要求，再补加分项，不要一次全铺开。',
      steps: [
        ['optimize', '去简历优化', '按目标岗位重排内容，把缺口位置补写清楚。', 'optimize'],
        [at('actions', 'ready'), '查看行动清单', '返回的差距会按重要程度排成可执行的准备。', 'actions'],
        ['materials', '补齐证明材料', '缺的成果、证书、作品在材料工坊里准备。', 'materials']
      ],
      note: '参考只描述准备程度，不代表企业的真实评价；补到什么程度由你自己判断。',
      cta: [[at('actions', 'ready'), '查看行动清单', 'back'], ['optimize', '去简历优化', 'primary']]
    },
    low: {
      hero: ['差距还比较多，<em>先把底子补上。</em>',
        '按现在这份材料，和这个目标差距比较多。补材料或换目标都行。',
        '匹配参考已返回 · 偏低'],
      focus: '先补基础材料，或换一个更接近的目标',
      lead: '偏低说明按现在这份材料，和这个目标的差距比较多。两条路都成立：把简历内容补完整，或者在同类岗位里挑一个门槛更接近的再看一次。',
      risk: '偏低不代表不能投；它只描述现在这份材料的准备程度。',
      steps: [
        [at('job-fit', 'pick'), '换一个更接近的目标', '在同类岗位里挑一个门槛更接近的，再看一次参考。', 'pick'],
        ['jobs', '先看岗位要求', '直接看来源平台写的要求，自己对一遍。', 'jobs'],
        [at('actions', 'ready'), '查看行动清单', '想继续冲这个目标，就按差距一条条补。', 'actions']
      ],
      note: '偏低不代表不能投；这里只描述当前材料的准备程度。',
      cta: [[at('actions', 'ready'), '查看行动清单', 'back'], [at('job-fit', 'pick'), '换一个更接近的目标', 'primary']]
    }
  }

  function result (level, key) {
    var c = RESULT[key]
    return {
      h: c.hero,
      tone: key,
      body: function () {
        return sec({
          title: '岗位匹配参考', small: '仅供本人准备使用',
          body: '<div class="verdict-card is-' + key + '">' +
            '<div class="vc-badge"><small>准备程度</small><b>' + level + '</b>' +
            '<div class="tier-ladder" role="img" aria-label="三档参考，这次是' + level + '">' +
            ['较高', '中等', '偏低'].map(function (x) {
              return '<span' + (x === level ? ' class="on"' : '') + '>' + x + '</span>'
            }).join('') + '</div></div>' +
            '<div class="vc-main"><small>关注重点</small><b>' + c.focus + '</b><p>' + c.lead + '</p>' +
            '<p class="vc-risk">' + svg('alert', 18) + '<span>' + c.risk + '</span></p></div></div>' +
            guard('三档参考 · 较高 / 中等 / 偏低',
              '不等于录用结论：不展示分数或通过率，结果只供本人准备，不提供给企业。')
        }) + sec({
          title: '结果明细', small: '服务端逐条返回后填入', grow: true,
          body: '<div class="evi">' +
            '<div class="evi-col"><div class="evi-h"><span class="e-ic">' + svg('ok', 20) + '</span>' +
            '<b>可以直接讲的优势</b></div><div class="evi-slot"><b>等待服务端逐条返回</b>' +
            '<p>每条附上简历里的原文依据。</p><span class="g-tag">尚未返回</span></div></div>' +
            '<div class="evi-col warn"><div class="evi-h"><span class="e-ic">' + svg('alert', 20) + '</span>' +
            '<b>需要补齐的差距</b></div><div class="evi-slot"><b>等待服务端逐条返回</b>' +
            '<p>每条写明缺什么、可以怎么补。</p><span class="g-tag">尚未返回</span></div></div></div>' +
            '<div class="evi-map"><div class="em-h"><b>结果依据</b><small>成对返回，未返回不填</small></div>' +
            '<div class="em-row"><span>岗位要求</span><span class="em-arrow">↔</span><span>简历原文依据</span></div></div>'
        }) + sec({
          title: '下一步建议', small: '按这一档的优先级排序',
          body: nextSteps(c.steps)
        }) + dock(c.note,
          btn(c.cta[0][0], c.cta[0][1], false, c.cta[0][2]) +
          btn(c.cta[1][0], c.cta[1][1], true, c.cta[1][2]))
      }
    }
  }

  V['job-fit/result-high'] = result('较高', 'high')
  V['job-fit/result-mid'] = result('中等', 'mid')
  V['job-fit/result-low'] = result('偏低', 'low')

  /* ---------- actions ---------- */

  V['actions/missing-task'] = {
    h: ['还没有<em>可用的匹配结果。</em>',
      '行动清单必须来自真实的岗位匹配结果。没有结果就没有清单，系统不生成空模板。',
      '缺少可用的岗位匹配结果'],
    body: function () {
      return sec({
        no: '01', title: '清单依赖的三项输入', small: '缺一项就不生成',
        body: slots([
          ['本人简历任务', '尚未确认'],
          ['目标岗位', '尚未选择'],
          ['匹配结果', '尚未生成']
        ], true)
      }) + sec({
        no: '02', title: '拿到清单的四步', small: '顺序固定，不能跳过', grow: true,
        copy: '每一步都在既有流程里完成，本页不会替你跳过其中任何一步。',
        body: steps([
          ['准备本人简历任务', '上传 PDF 或扫描纸质简历，等待解析成功。'],
          ['选择目标岗位', '从已发布岗位中选择，或只填一个目标岗位名称。'],
          ['确认本人授权', '确认之后，简历才会用于这次岗位匹配分析。'],
          ['等待匹配结果返回', '结果返回后，差距与建议才会变成可执行的行动项。']
        ])
      }) + sec({
        no: '03', title: '现在就能开始的两条路', small: '按你手上有什么来选',
        body: routes([
          ['target', '去做岗位匹配', '选择目标岗位并确认授权，走完才会有行动清单。', '去岗位匹配', at('job-fit', 'missing-task'), 'jobfit'],
          ['list', '先看来源岗位要求', '直接浏览来源平台的岗位信息，自己比对要求。', '去岗位信息', 'jobs', 'jobs']
        ])
      }) + dock('没有真实结果时，不生成也不打印任何清单。',
        btn('resumeHub', '返回简历服务', false, 'back') +
        btn('triage', '去准备简历材料', true, 'primary'))
    }
  }

  V['actions/loading'] = {
    h: ['正在读取，<em>清单还没到。</em>',
      '读取请求已提交。只有服务端确认存在真实差距与建议，才会出现行动项。',
      '正在读取行动清单'],
    body: function () {
      return sec({
        title: '正在读取本人的行动清单', small: '无进度条 · 无预计时间',
        body: waiting('list', '读取请求已提交，等待服务端返回',
          '清单内容全部来自这次匹配结果。读取失败或没有内容会直接说明，不补造行动项。',
          '整体等待中，没有百分比')
      }) + sec({
        title: '这次读取用到的条件', small: '每一项都可核对', grow: true,
        body: checks([
          ['ok', 'user', '本人身份', '当前会话已校验，只读取属于你本人的清单。', '已确认'],
          ['ok', 'target', '匹配结果', '已定位到这次匹配结果，正在等待清单内容返回。', '已提交'],
          ['wait', 'list', '行动项内容', '差距、依据和准备动作由服务端逐条给出。', '等待返回'],
          ['wait', 'print', '打印版文件', '清单可读之后才谈打印，本页现在不生成任何文件。', '未开始']
        ])
      }) + sec({
        title: '还没有返回的内容', small: '返回前一律留空',
        body: ghosts([
          ['差距与依据', '每条行动项对应的岗位要求与简历依据，返回后才显示。', '等待返回'],
          ['可执行动作', '优化、材料准备还是打印，按真实建议再决定。', '等待返回']
        ], 2)
      }) + dock('读取期间不放开打印，也不提前显示清单内容。',
        btn('resumeHub', '返回简历服务', false, 'back') +
        btn(at('job-fit', 'result-high'), '取消读取，返回匹配参考', true, 'primary'))
    }
  }

  V['actions/print-pending'] = {
    h: ['打印版<em>还没有生成。</em>',
      '文件正在等待服务端生成。生成成功才进入既有打印确认流程；本页不代表已打印、已扣费或已出纸。',
      '等待服务端生成打印版文件'],
    body: function () {
      return sec({
        title: '已提交生成打印版', small: '生成 ≠ 打印',
        body: waiting('print', '请求已提交，等待文件生成',
          '行动清单可读，不等于打印文件已经存在。文件真实生成后，才会进入既有的打印确认与取件流程。',
          '等待生成，没有进度和预计时间')
      }) + sec({
        title: '打印这件事现在到哪一步', small: '只标位置，不画进度',
        body: trace([
          ['第一步', '清单已可读', '行动项来自这次真实的匹配结果。', false],
          ['第二步', '等待生成文件', '服务端生成文件之前不进入打印。', true],
          ['第三步', '进入打印确认', '份数、单双面与费用在确认页由你决定。', false]
        ])
      }) + sec({
        title: '现在还没有发生的事', small: '不提前写成已完成', grow: true,
        body: nots([
          '没有发送到打印机，也没有开始出纸',
          '没有产生取件码或订单号',
          '没有发起支付，也没有任何扣费',
          '没有生成可预览或可下载的文件',
          '没有把清单内容提供给企业或第三方'
        ])
      }) + dock('打印结果以既有打印流程和真实设备状态为准。',
        btn(at('actions', 'ready'), '返回行动清单', false, 'back') +
        btn('printHub', '取消生成，改用现有文件打印', true, 'primary'))
    }
  }

  V['actions/print-failed'] = {
    h: ['打印版<em>没有生成成功。</em>',
      '文件生成失败。系统不会把失败写成已发送打印，也不保留半截文件。',
      '打印版文件生成失败'],
    body: function () {
      return sec({
        title: '这次的结果', small: '只写已确认的事实',
        body: verdict([
          ['v-bad', '打印版文件', '未生成'],
          ['v-ok', '行动清单', '仍可查看'],
          ['v-ok', '费用', '未发生扣费']
        ])
      }) + sec({
        title: '可能的原因，和你能确认的事', small: '不猜测具体故障', grow: true,
        body: why([
          ['可能原因', '文件生成未返回', '生成文件的服务这次没有给出结果，本页不猜测具体原因。'],
          ['可能原因', '清单内容仍在变化', '结果尚未稳定时，生成可能被服务端中止。'],
          ['你能确认', '清单没有丢', '行动清单本身仍可查看，重试不需要重新做一次匹配。'],
          ['你能确认', '没有产生订单', '没有取件码、没有订单号，也没有扣费记录。'],
          ['你能确认', '打印机没收到任务', '打印机没有收到任何任务，纸张与耗材没有被占用。']
        ])
      }) + sec({
        title: '接下来', small: '两条都进入既有流程',
        body: routes([
          ['refresh', '重新生成打印版', '沿用当前清单再试一次，不重新跑匹配分析。', '重新生成', at('actions', 'print-pending'), 'regen'],
          ['print', '改用现有文件打印', '手上已有可用文件或纸质件时，直接走既有打印流程。', '去打印服务', 'printHub', 'print']
        ])
      }) + dock('失败就是失败，不写成已发送到打印机。',
        btn(at('actions', 'ready'), '返回行动清单', false, 'back') +
        btn(at('actions', 'print-pending'), '重新生成打印版', true, 'primary'))
    }
  }

  V['actions/ready'] = {
    h: ['清单来了，<em>一件一件来。</em>',
      '每条准备事项都来自这次的匹配结果。没有返回的条目留空，不先填内容凑数。',
      '行动建议以真实匹配结果为准'],
    body: function () {
      return sec({
        title: '你的准备清单', small: '按轻重缓急分三组', grow: true,
        body: groups([
          ['urgent', '1', '优先处理', '影响最大的差距先补。返回后按重要程度排进这一组。', '等待返回',
            [['待补事项', '等待匹配结果返回'], ['建议动作', '返回后逐条给出，做完可自己划掉']]],
          ['week', '2', '本周准备', '不紧急但要提前做的：作品整理、自我介绍、常见问题。', '等待返回',
            [['准备事项', '等待匹配结果返回'], ['怎么算做完', '返回后写明可自查的标准']]],
          ['print', '3', '材料与打印', '需要纸质件时，在这里确认打印哪几份、打几份。', '等待返回',
            [['需要的材料', '等待匹配结果返回'], ['要不要纸质件', '由你在打印流程里确认']]]
        ])
      }) + sec({
        title: '准备路径', small: '确认后再进入既有流程',
        body: routes([
          ['pen', '去简历优化', '按你确认的方向修改内容，不自动改写简历。', '去简历优化', 'optimize', 'optimize'],
          ['file', '准备证明材料', '按目标岗位补齐成果、证书这类可出示材料。', '去材料工坊', 'materials', 'materials'],
          ['print', '生成打印版', '文件生成成功后才进入打印确认，生成前不表示已打印。', '生成打印版', at('actions', 'print-pending'), 'print']
        ], 3) + guard('清单只供本人准备',
          '不提供给企业，本页也不新建任何站内投递入口；完成与否由你自己决定，不用静态勾选冒充完成。')
      }) + dock('没有返回的条目会一直留空，不会先填内容凑数。',
        btn(at('job-fit', 'result-high'), '返回匹配参考', false, 'back') +
        btn(at('actions', 'print-pending'), '生成打印版', true, 'primary'))
    }
  }

  /* ---------- career-plan ---------- */

  V['career-plan/missing-task'] = {
    h: ['规划要<em>基于真实材料。</em>',
      '职业规划只在本人简历任务可用时生成。没有材料就没有规划，系统不写通用模板。',
      '缺少可读取的本人简历任务'],
    body: function () {
      return sec({
        title: '当前状态', small: '只写已确认的事实',
        body: verdict([
          ['v-bad', '本人简历任务', '尚未可用'],
          ['v-warn', '职业规划', '尚未生成'],
          ['v-ok', '材料与打印', '不受影响']
        ])
      }) + sec({
        title: '规划会用到、也只会用到这些', small: '输入范围写在前面', grow: true,
        body: listRows([
          '当前本人简历任务里的经历、技能与教育信息',
          '你自己填写或选择的目标方向（可以留空）',
          '本人此前的岗位匹配参考，且需要你同意这次使用',
          '本人此前的模拟面试摘要，且需要你同意这次使用',
          '不使用他人材料，不引入企业侧数据，不做录用或收入承诺'
        ])
      }) + sec({
        title: '现在能做的两件事', small: '按你手上有什么来选',
        body: routes([
          ['file', '上传或扫描简历', '有了可读取的简历任务，才能开始做规划。', '去简历上传', 'triage', 'triage'],
          ['help', '先和 AI 顾问聊目标', '还没想清楚方向时，可以先把想法说出来。', '去 AI 顾问', 'assistant', 'assistant']
        ])
      }) + dock('没有可读取的简历任务时，不生成任何个人规划内容。',
        btn('resumeHub', '返回简历服务', false, 'back') +
        btn('triage', '去上传或扫描简历', true, 'primary'))
    }
  }

  V['career-plan/loading'] = {
    h: ['正在读取，<em>还没有内容。</em>',
      '读取的是本人此前保存的规划。读到才显示；没有或读取失败会直接说明。',
      '正在读取已有职业规划'],
    body: function () {
      return sec({
        title: '正在读取本人已有的职业规划', small: '无进度条 · 无预计时间',
        body: waiting('route', '读取请求已提交，等待服务端返回',
          '读取成功才显示方向、技能计划和行动清单。没有已有规划时会转到生成入口，不显示空壳内容。',
          '整体等待中，没有百分比')
      }) + sec({
        title: '读取之后会怎么走', small: '三种结果都写清楚', grow: true,
        body: steps([
          ['读到已有规划', '直接显示上一次生成的内容与生成时间，全部由服务端提供。'],
          ['没有已有规划', '转到生成入口，由你确认后再开始，不会自动替你生成。'],
          ['读取失败', '直接显示失败状态，不用模板内容或他人内容顶替。'],
          ['任何一种情况', '都不会替你决定方向，也不会把内容提供给企业。']
        ])
      }) + sec({
        title: '还没有返回的内容', small: '返回前一律留空',
        body: ghosts([
          ['当前画像', '只展示能回溯到简历原文的要点。', '等待返回'],
          ['可选方向', '方向、原因与第一步由结果给出。', '等待返回'],
          ['技能与行动', '技能计划与清单返回后才显示。', '等待返回']
        ])
      }) + dock('读取期间不生成、不保存、不打印任何内容。',
        btn('resumeHub', '返回简历服务', false, 'back') +
        btn(at('job-fit', 'pick'), '取消读取，先看岗位匹配', true, 'primary'))
    }
  }

  V['career-plan/generating'] = {
    h: ['已提交生成，<em>等待返回。</em>',
      '输入已确认，生成请求已提交。服务端返回之前，不显示方向、技能计划或行动清单。',
      '规划生成中，等待服务端返回'],
    body: function () {
      return sec({
        title: '正在等待职业规划结果', small: '无阶段名 · 无百分比',
        body: waiting('bot', '生成请求已提交给服务端',
          '本页只表达整体等待。没有阶段名称，也不预告规划会给出什么方向。',
          '等待中，可随时取消并返回')
      }) + sec({
        title: '本次生成已确认的输入', small: '只用你同意的部分',
        body: slots([
          ['本人简历任务', '已确认可读取', true],
          ['目标方向', '由你填写或留空', true],
          ['可选上下文', '仅使用你已同意的部分', true]
        ], true)
      }) + sec({
        title: '生成期间不会发生的事', small: '边界不随状态放宽', grow: true,
        body: nots([
          '不显示生成进度百分比或阶段名称',
          '不承诺薪资、录用或跳槽结果',
          '不把简历或规划内容提供给企业',
          '不把未完成的内容自动保存为最终版本',
          '不生成文件、不发起支付、不打印'
        ])
      }) + dock('规划只供本人参考，不构成录用或收入承诺。',
        btn(at('job-fit', 'pick'), '先看岗位匹配', false, 'back') +
        btn('resumeHub', '取消生成，返回简历服务', true, 'primary'))
    }
  }

  V['career-plan/ai-down'] = {
    h: ['规划生成<em>当前不可用。</em>',
      '这项 AI 能力暂时调不通。系统不显示方向、技能计划或行动清单，也不用模板内容顶替。',
      '职业规划生成当前不可用'],
    body: function () {
      return sec({
        title: '当前判定', small: '只写已确认的事实',
        body: verdict([
          ['v-bad', 'AI 规划生成', '当前不可用'],
          ['v-ok', '简历与打印', '仍可正常使用'],
          ['v-warn', '其他 AI 能力', '需各自打开确认']
        ])
      }) + sec({
        title: '不依赖 AI，也能先自查这几项', small: '现在就能做', grow: true,
        body: checks([
          ['ok', 'file', '你的材料还在', '简历任务、文档和打印记录都不受这次故障影响。', '可用'],
          ['ok', 'pen', '目标可以先自己写', '把想去的方向、岗位名称和时间点先写下来，恢复后再对照。', '可做'],
          ['wait', 'clock', '恢复时间未知', '服务端没有给出恢复时间，本页也不写「稍后自动恢复」。', '未知'],
          ['off', 'x', '不用旧规划顶替', '不会把上一次的规划或他人的内容当成这次的结果。', '不做'],
          ['ok', 'lock', '边界不变', '无论是否可用，规划内容都不提供给企业或第三方。', '已固定']
        ]) + disclose('down', '什么情况才算「当前不可用」？', [
          '服务端明确返回了不可用，或请求在约定时间内没有任何返回。',
          '不可用只影响这项生成能力，不影响你查看材料、打印和浏览来源岗位。',
          '恢复由服务端决定；本页不做倒计时，也不承诺具体恢复时间。'
        ])
      }) + sec({
        title: '现在能用的非 AI 入口', small: '都是既有流程',
        body: kit([
          ['pen', '手动整理求职材料', '按自己的判断准备材料清单', 'materials', 'materials'],
          ['list', '看来源岗位与要求', '直接浏览来源平台的岗位信息', 'jobs', 'jobs'],
          ['print', '打印现有材料', '走既有打印流程，不依赖 AI', 'printHub', 'print']
        ])
      }) + dock('服务不可用时不显示任何规划内容，也不承诺恢复时间。',
        btn('resumeHub', '返回简历服务', false, 'back') +
        btn(at('career-plan', 'generating'), '重新提交生成', true, 'primary'))
    }
  }

  V['career-plan/failed'] = {
    h: ['这次规划<em>没有生成成功。</em>',
      '请求中断，没有可确认的规划结果。系统不保留半截内容，也不把上一次的结果当成这次的。',
      '本次职业规划生成未完成'],
    body: function () {
      return sec({
        title: '这次请求的结果', small: '只写事实，不猜原因',
        body: verdict([
          ['v-bad', '本次生成', '未完成'],
          ['v-warn', '可用规划', '没有返回']
        ], 2)
      }) + sec({
        title: '可能的原因，和你能确认的事', small: '两类分开写', grow: true,
        body: why([
          ['可能原因', '生成请求中断', '服务端在返回结果前中断了这次请求，本页不猜测具体原因。'],
          ['可能原因', '输入超出可处理范围', '材料过长或格式异常时，生成可能被终止。'],
          ['你能确认', '简历任务没有变化', '重试不需要重新上传，材料仍然可用。'],
          ['你能确认', '没有半截规划', '不保留未完成的方向或计划片段。'],
          ['你能确认', '没有产生扣费', '生成没有完成，本页也没有发起过支付。']
        ])
      }) + sec({
        title: '接下来三选一', small: '都进入既有流程',
        body: routes([
          ['refresh', '重新生成规划', '沿用当前材料再试一次，不需要重新上传。', '重新生成', at('career-plan', 'generating'), 'regen'],
          ['target', '先做岗位匹配', '先看清目标岗位的差距，再谈长期规划。', '去岗位匹配', at('job-fit', 'pick'), 'jobfit'],
          ['pen', '先改简历', '按自己的判断调整材料重点，不依赖规划结果。', '去简历优化', 'optimize', 'optimize']
        ], 3)
      }) + dock('未完成不会写成已生成，也不会自动保存。',
        btn('resumeHub', '返回简历服务', false, 'back') +
        btn(at('career-plan', 'generating'), '重新生成规划', true, 'primary'))
    }
  }

  V['career-plan/print-pending'] = {
    h: ['打印版<em>还在等生成。</em>',
      '规划可读不等于打印文件已存在。文件真实生成后才进入既有打印确认流程。',
      '等待服务端生成规划打印版'],
    body: function () {
      return sec({
        title: '已提交生成规划打印版', small: '生成 ≠ 打印',
        body: waiting('print', '请求已提交，等待文件生成',
          '生成成功后进入既有打印确认页，由你确认份数、单双面和费用。本页不代表已经打印。',
          '等待生成，没有进度和预计时间')
      }) + sec({
        title: '打印这件事的真实状态', small: '逐条对照，不含糊', grow: true,
        body: listRows([
          '打印文件尚未生成，没有可预览或可下载的版本',
          '打印机没有收到任务，也没有开始出纸',
          '没有取件码，也没有订单号',
          '没有发起支付，没有产生任何扣费',
          '生成成功后会进入打印确认页，由你逐项确认后再打印'
        ])
      }) + sec({
        title: '生成成功后才会出现', small: '现在一律留空',
        body: ghosts([
          ['打印预览', '文件生成后才可以预览页数与版式。', '等待生成'],
          ['打印确认', '份数、单双面与费用在确认页由你决定。', '等待生成']
        ], 2)
      }) + dock('以既有打印流程与真实设备状态为准。',
        btn(at('career-plan', 'ready'), '返回职业规划', false, 'back') +
        btn('printHub', '取消生成，改用现有文件打印', true, 'primary'))
    }
  }

  V['career-plan/print-failed'] = {
    h: ['规划打印版<em>没有生成。</em>',
      '文件生成失败。系统不会把失败写成已发送到打印机，也不保留半截文件。',
      '规划打印版生成失败'],
    body: function () {
      return sec({
        title: '这次的结果', small: '只写已确认的事实',
        body: verdict([
          ['v-bad', '打印版文件', '未生成'],
          ['v-ok', '规划内容', '仍可查看'],
          ['v-ok', '打印机', '未收到任务']
        ])
      }) + sec({
        title: '可以按这个顺序试', small: '从代价最小的开始', grow: true,
        body: steps([
          ['先确认规划内容仍可打开', '回到职业规划页，确认内容还在，再决定要不要重试。'],
          ['重新生成一次打印版', '沿用当前规划再试，不需要重新生成规划本身。'],
          ['仍然失败就换现有文件', '手上已有可用文件或纸质件时，直接走既有打印流程。'],
          ['需要人工协助时看帮助页', '帮助页有现场操作说明和联系方式。'],
          ['全程不会有扣费', '没有生成成功就不会发起支付，也不会产生订单。']
        ])
      }) + sec({
        title: '三个既有入口', small: '按需要选一个',
        body: kit([
          ['refresh', '重新生成打印版', '沿用当前规划再试一次', at('career-plan', 'print-pending'), 'regen'],
          ['print', '打印现有文件', '走既有打印流程，不依赖生成', 'printHub', 'print'],
          ['help', '查看帮助', '现场操作说明与联系方式', 'help', 'help']
        ])
      }) + dock('失败不写成已发送打印，也不产生取件码。',
        btn(at('career-plan', 'ready'), '返回职业规划', false, 'back') +
        btn(at('career-plan', 'print-pending'), '重新生成打印版', true, 'primary'))
    }
  }

  V['career-plan/ready'] = {
    h: ['把方向拆成<em>能开始的一步。</em>',
      '规划按现在 / 接下来 / 持续积累三段展开。每一段的内容都由真实规划结果填入。',
      '职业规划需要当前本人简历任务'],
    body: function () {
      return sec({
        title: '你的阶段计划', small: '三段节奏，先看最近的一段', grow: true,
        body: groups([
          ['now', 'clock', '现在', '最近就能动手的一件事，小到今天或这周能开始。', '等待返回',
            [['本阶段目标', '等待规划结果返回'], ['第一步', '返回后写明从哪件事开始']]],
          ['next', 'target', '接下来', '要补的能力、材料或经历，排开做，不堆在一起。', '等待返回',
            [['要补的部分', '等待规划结果返回'], ['怎么算做完', '返回后给出可自查的标准']]],
          ['keep', 'grid', '持续积累', '长期方向上的积累，不设截止时间，按自己的节奏走。', '等待返回',
            [['方向候选', '等待规划结果返回，每个方向会附上原因'], ['积累方式', '返回后给出可长期做的事']]]
        ])
      }) + sec({
        title: '规划确认台', small: '把结果变成可复核的下一步',
        body: slots([
          ['规划依据', '当前本人简历任务', true],
          ['可选上下文', '有匹配或面试摘要才读取'],
          ['打印版文件', '尚未生成']
        ], true) + guard('只供本人参考',
          '不做薪资、录用、Offer 或通过率承诺；方向、时间与第一步都只在服务端返回后填入，不写通用模板。')
      }) + dock('规划只供本人参考，不构成录用或收入承诺。',
        btn(at('job-fit', 'pick'), '查看岗位匹配', false, 'back') +
        btn(at('career-plan', 'print-pending'), '生成打印版', true, 'primary'))
    }
  }

  /* ---------- templates ---------- */

  V['templates/loading'] = {
    h: ['正在读取版式，<em>还没有列表。</em>',
      '模板列表由服务端发布。读取完成前不显示任何模板名称、数量或已选状态。',
      '正在读取简历模板列表'],
    body: function () {
      return sec({
        title: '正在读取可用的简历模板', small: '无进度条 · 无预计时间',
        body: waiting('grid', '读取请求已提交，等待服务端返回',
          '只显示服务端已发布的模板。读取失败或没有模板时会直接说明，不用内置默认模板顶替。',
          '整体等待中，没有百分比')
      }) + sec({
        title: '这一步会做什么、不会做什么', small: '读取范围写在前面', grow: true,
        body: checks([
          ['ok', 'user', '只读列表', '这一步只读取模板列表，不读取你的简历内容。', '已确认'],
          ['wait', 'grid', '模板数量', '有几个模板由服务端发布结果决定，本页不预设。', '等待返回'],
          ['ok', 'lock', '不自动应用', '读到列表也不会自动套用到你的简历上。', '已固定'],
          ['ok', 'pen', '内容仍由你决定', '版式只影响排版，经历与成果始终以你确认的事实为准。', '已固定']
        ])
      }) + sec({
        title: '还没有返回的内容', small: '返回前一律留空',
        body: ghosts([
          ['模板名称', '标题与适用场景由服务端提供。', '等待返回'],
          ['版式预览', '预览图在模板返回后才显示。', '等待返回'],
          ['适用说明', '适合哪类经历由发布方说明。', '等待返回']
        ])
      }) + dock('读取期间不显示任何模板，也不保存任何选择。',
        btn('resumeHub', '返回简历服务', false, 'back') +
        btn('optimize', '不等模板，直接去简历优化', true, 'primary'))
    }
  }

  V['templates/error'] = {
    h: ['模板列表<em>这次没读到。</em>',
      '读取失败。系统不会用内置默认模板冒充服务端列表，也不显示上一次的缓存内容。',
      '模板列表读取失败'],
    body: function () {
      return sec({
        title: '这次的结果', small: '只写已确认的事实',
        body: verdict([
          ['v-bad', '模板列表', '未读取到'],
          ['v-ok', '简历优化', '不依赖模板']
        ], 2)
      }) + sec({
        title: '这次没有发生的事', small: '失败不影响你已有的内容', grow: true,
        body: nots([
          '没有显示任何模板名称或预览',
          '没有用内置默认模板冒充服务端列表',
          '没有把任何版式套用到你的简历上',
          '没有修改或保存你的简历内容',
          '没有产生任何费用'
        ])
      }) + sec({
        title: '接下来', small: '版式不是前提，内容才是',
        body: routes([
          ['refresh', '重新读取模板', '网络或服务恢复之后可以再试一次。', '重新读取', at('templates', 'loading'), 'reload'],
          ['pen', '不用模板，直接优化', '先按目标岗位调整内容重点，版式随后再说。', '去简历优化', 'optimize', 'optimize']
        ])
      }) + dock('模板只影响排版，不影响你已有的简历内容。',
        btn('resumeHub', '返回简历服务', false, 'back') +
        btn(at('templates', 'loading'), '重新读取模板', true, 'primary'))
    }
  }

  V['templates/empty'] = {
    h: ['当前<em>没有已发布的模板。</em>',
      '服务端这次没有返回任何已发布模板。这不影响你继续准备简历——内容比版式更重要。',
      '当前没有可用的简历模板'],
    body: function () {
      return sec({
        title: '当前状态', small: '读取成功，只是内容为空',
        body: verdict([
          ['v-warn', '已发布模板', '数量为 0'],
          ['v-ok', '本次读取', '已成功完成'],
          ['v-ok', '简历优化', '可以直接进行']
        ])
      }) + sec({
        title: '没有模板时，这样准备一样有效', small: '一页 A4 就够', grow: true,
        body: listRows([
          '用一页 A4 说清楚：目标岗位、核心能力、可验证的成果',
          '把与目标岗位最相关的经历放在最前面，其余往后压',
          '每段经历写清楚：做了什么、怎么做的、结果是什么',
          '只写你本人能解释清楚的事实，不写无法印证的内容',
          '打印前先看一遍分页，避免关键内容被切到第二页'
        ]) + disclose('why-empty', '为什么模板不是必需的？', [
          '版式解决的是「好不好读」，内容解决的是「值不值得读」，后者决定结果。',
          '模板由服务端发布，数量随运营调整；为空不代表功能异常。',
          '发布后模板会自动出现在这一页，不需要你做任何额外操作。'
        ])
      }) + sec({
        title: '两个既有入口', small: '按你手上有什么来选',
        body: routes([
          ['pen', '直接去简历优化', '按目标岗位重排已有内容，不依赖模板。', '去简历优化', 'optimize', 'optimize'],
          ['file', '生成一份新简历', '还没有简历时，从结构化填写开始。', '去简历生成', 'generate', 'generate']
        ])
      }) + dock('模板列表为空不代表服务异常；发布后会自动出现在这一页。',
        btn(at('templates', 'loading'), '重新读取模板', false, 'reload') +
        btn('optimize', '去简历优化', true, 'primary'))
    }
  }

  /* 列表页与选中页必须一眼分得出：选中页有选中态、预览视窗和内容核对；
     列表页提示待选择。没有服务端模板时，卡片写「等待服务端模板」，
     不拿三段说明冒充三份模板，也不冒充已应用 / 已保存 / 已生成。 */
  function templateList (selected) {
    var tplFilter = Q.get('filter') === '简历模板' || Q.get('filter') === '通用' ? Q.get('filter') : '全部'
    var templates = [{
      id: 'resume-template-clean', title: '清爽通用简历模板', style: 'clean',
      desc: '单栏清爽版式，突出个人总结、经历与技能。', tags: ['简历模板', '通用'],
      recommendedFor: '简历诊断、AI 简历优化、现场打印前版式参考'
    }]
    var visible = templates.filter(function (t) { return tplFilter === '全部' || t.tags.indexOf(tplFilter) >= 0 })
    var side = selected ? [
      ['ok', '经历与成果属实', '版式不改事实：写上去的每一条都要是你能解释清楚的。'],
      ['target', '和目标岗位对得上', '把与目标最相关的经历放前面，其余往后压。'],
      ['file', '关键信息在第一页', '姓名、联系方式、核心能力尽量不翻页。'],
      ['print', '分页别切断内容', '打印前看一遍分页，避免关键段落被切到第二页。']
    ] : [
      ['pen', '内容优先', '版式只影响排版，不会改写你的经历、技能或成果。'],
      ['list', '排版影响读感', '同样的内容，分组和留白会明显改变读起来顺不顺。'],
      ['file', '一页 A4 最稳', '多数岗位一页就够；写不下时先压缩不相关的经历。'],
      ['refresh', '选了也能反悔', '这一页只做版式参考，换一个或不选都不影响你的材料。']
    ]
    return {
      h: selected
        ? ['版式选好了，<em>再核对内容。</em>',
          '选中只是这次的版式参考。预览和正式输出都由后续真实流程给出，这里不冒充已生成。',
          '已选中一个版式位 · 未保存']
        : ['先挑一个版式，<em>内容仍由你决定。</em>',
          '模板由服务端发布。选中后可以看预览，不会自动应用，也不会直接生成简历。',
          '模板列表以服务端返回为准'],
      body: function () {
        return sec({
          title: '选择一个版式参考', small: selected ? '已选中 1 个' : '按真实分类筛选',
          body: '<div class="meta mt">' + ['全部','简历模板','通用'].map(function (f) {
            return '<a class="chip press' + (tplFilter === f ? ' on' : '') + '" href="' + url('templates', 'list') + '&filter=' + encodeURIComponent(f) + '" data-route="/resume/templates" aria-pressed="' + (tplFilter === f) + '">' + f + '</a>'
          }).join('') + '</div><div class="grid3 mt">' + visible.map(function (t) {
            var on = selected
            return '<a class="card choice template' + (on ? ' on' : '') + '" href="' + url('templates', 'selected') + '&filter=' + encodeURIComponent(tplFilter) + '" data-route="/resume/templates" ' +
              'data-testid="resume-decision-templates-template-' + t.id + '">' +
              '<span class="template-art"><i></i><i></i><i></i></span>' +
              '<h3>' + t.title + '</h3><p>' + t.desc + '</p><small>' + t.recommendedFor + '</small>' +
              '<span class="tag">' + t.tags.join(' · ') + (on ? ' · 当前选择' : ' · 选择此版式') + '</span></a>'
          }).join('') + '</div>' + (visible.length ? '' : notice('warn','该分类暂无简历素材','切换其他分类查看；空列表不使用占位模板填充。'))
        }) + sec({
          title: selected ? '进入优化前核对' : '版式怎么选',
          small: selected ? '内容比版式更重要' : '选之前先看这几点', grow: true,
          body: '<div class="tpl-split"><div class="pv-pane' + (selected ? ' on' : '') + '">' +
            '<div class="pv-head"><b>版式预览</b><small>' + (selected ? templates[0].title : '尚未选择') + '</small></div>' +
            '<div class="pv-body"><div class="pv-page"><b>' +
            (selected ? '清爽通用 · 单栏结构' : '先选择一份已发布模板') + '</b><p>' +
            (selected ? '预览由服务端按这个版式生成，这里不拿示例图顶替。' : '选中后，这里显示该版式的预览。') +
            '</p></div></div></div><div class="tpl-side">' + side.map(function (x) {
              return '<div class="tip-row"><span class="tip-ic">' + svg(x[0], 22) + '</span>' +
                '<span class="tip-t"><b>' + x[1] + '</b><p>' + x[2] + '</p></span></div>'
            }).join('') + '</div></div>'
        }) + sec({
          title: '不用等版式也能推进', small: '都是既有入口',
          body: kit([
            ['pen', '直接去简历优化', '按目标岗位重排已有内容', 'optimize', 'optimize'],
            ['file', '生成一份新简历', '还没有简历时从结构化填写开始', 'generate', 'generate'],
            ['print', '打印现有简历', '手上已有可用文件就直接打印', 'printHub', 'print']
          ])
        }) + dock(selected
          ? '此页不会保存模板选择，也不会直接生成简历。'
          : '模板由服务端发布；此页不会保存模板选择，也不会直接生成简历。',
        (selected
          ? btn(at('templates', 'list'), '换一个版式', false, 'back')
          : btn(at('templates', 'loading'), '重新读取模板', false, 'reload')) +
        btn('optimize', '进入简历优化', true, 'primary'))
      }
    }
  }

  V['templates/list'] = templateList(false)
  V['templates/selected'] = templateList(true)

  /* ---------- 渲染 ---------- */

  var root = document.getElementById('workspace')
  var view = V[screen + '/' + state] || V[screen + '/' + conf.def]

  document.getElementById('eyebrow').textContent = conf.eyebrow
  document.getElementById('hero-title').innerHTML = view.h[0]
  document.getElementById('hero-copy').textContent = view.h[1]
  document.getElementById('status-copy').textContent = view.h[2]

  if (view.tone) document.documentElement.dataset.tone = view.tone

  root.innerHTML = view.body()
  root.dataset.screen = 'resume-decision-' + screen
  root.dataset.state = state
  root.dataset.testid = 'resume-decision-' + screen + '-state-' + state
  root.classList.add('action-enter')

  if (FLAT) document.documentElement.dataset.flat = '1'

  function fit () {
    document.getElementById('stage').style.transform =
      'translate(-50%,-50%) scale(' + Math.min(innerWidth / 1080, innerHeight / 1920) + ')'
  }
  fit()
  addEventListener('resize', fit)

  function clock () {
    var d = new Date()
    document.getElementById('clock').textContent =
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  }
  clock()
  setInterval(clock, 10000)

  /* ---------- 页内交互：选择卡与就地展开，都不改 URL、不推进业务 ---------- */

  root.addEventListener('click', function (e) {
    var choice = e.target.closest('.choice')
    if (choice) {
      choice.parentElement.querySelectorAll('.choice').forEach(function (x) { x.classList.remove('on') })
      choice.classList.add('on')
      return
    }
    var head = e.target.closest('.disclose')
    if (!head) return
    var body = document.getElementById('dsc-' + head.dataset.disclose)
    var open = head.getAttribute('aria-expanded') === 'true'
    head.setAttribute('aria-expanded', open ? 'false' : 'true')
    if (body) body.classList.toggle('show', !open)
  })

  /* ---------- 原型演示控制：只有 ?debug=1 才存在 ----------
     非 debug 分支什么都不做 —— HTML 里的 hidden / disabled / tabindex="-1"
     与 CSS 的 html:not([data-debug="1"]) 段落已经让这两个元素不可见、
     不可聚焦、不可点击、零尺寸、不参与布局。这里再显式补一次属性，
     防止有人后来在 HTML 里漏写。 */

  var tab = document.getElementById('demo-tab')
  var panel = document.getElementById('demo-panel')

  if (!DEBUG) {
    tab.disabled = true
    tab.tabIndex = -1
    tab.setAttribute('aria-hidden', 'true')
    tab.hidden = true
    panel.tabIndex = -1
    panel.setAttribute('aria-hidden', 'true')
    panel.hidden = true
  } else {
    document.documentElement.dataset.debug = '1'
    tab.hidden = false
    tab.disabled = false
    tab.tabIndex = 0
    tab.removeAttribute('aria-hidden')
    panel.hidden = false
    panel.removeAttribute('tabindex')
    panel.setAttribute('aria-hidden', 'true')

    Object.keys(SCREENS).forEach(function (s) {
      SCREENS[s].states.forEach(function (st) {
        var a = document.createElement('a')
        a.href = url(s, st)
        a.textContent = s + ' · ' + st
        if (s === screen && st === state) a.className = 'on'
        panel.appendChild(a)
      })
    })

    tab.addEventListener('click', function () {
      var open = panel.classList.toggle('show')
      tab.setAttribute('aria-expanded', open ? 'true' : 'false')
      panel.setAttribute('aria-hidden', open ? 'false' : 'true')
    })
  }
})()
