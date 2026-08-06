;(function () {
  function renderHome(screen, h) {
    const goal = screen.sections[0]?.fields?.[0]?.value || ''
    const services = screen.sections[1]?.items || []
    const serviceHtml = services
      .map(
        (item) => `
          <button type="button" class="home-service ${item.layoutSlot?.startsWith('support-') ? '' : 'is-primary'}" data-domain="${h.safe(item.domain || 'local')}" data-layout-slot="${h.safe(item.layoutSlot || 'support-policy')}" data-to="${h.safe(item.to || '')}">
            <span class="home-service-icon"><i data-lucide="${h.iconFor(item.title)}"></i></span>
            <span><strong>${h.safe(item.title)}</strong><small>${h.safe(item.text)}</small></span>
            <i data-lucide="chevron-right"></i>
          </button>`
      )
      .join('')

    return `${h.renderTopbar()}
      <main class="home-v2-main">
        <section class="home-v2-hero">
          <div class="home-v2-hero-copy">
            <span>线下就业服务台</span>
            <h1>简历、岗位、打印，<br />一趟办完</h1>
            <p>现场准备求职材料，也可以先让 AI 帮你理清要办的事。</p>
          </div>
          <div class="home-v2-goal">
            <label for="home-v2-goal">告诉我今天想完成什么</label>
            <div><input id="home-v2-goal" value="${h.safe(goal)}" /><button type="button" class="button button-primary" data-to="13"><i data-lucide="arrow-right"></i>帮我安排</button></div>
          </div>
        </section>
        <section class="home-v2-services">
          <header><div><span>常用服务</span><h2>从今天要办的事开始</h2></div><p>岗位与招聘会信息均标注第三方或官方来源</p></header>
          <div class="home-service-grid">${serviceHtml}</div>
          <div class="home-v2-lower">
            <button type="button" data-to="11"><span>本周招聘会</span><strong>高校毕业生就业服务专场</strong><small>周五 09:00 · 查看官方信息、参会须知与场馆导览</small><i data-lucide="arrow-up-right"></i></button>
            <div><span>设备提醒</span><strong>状态检查中</strong><small>进入打印流程后再确认纸张、耗材与计价。</small></div>
          </div>
        </section>
      </main>${h.renderNavbar(screen)}`
  }

  function renderResumePreview() {
    return `<article class="print-v2-sheet" aria-label="简历第 1 页预览">
      <header><div><h2>王同学</h2><p>求职方向：运营专员<br />手机 138****2026 · 深圳</p></div><span>证件照</span></header>
      <section><h3>教育经历</h3><p>南方城市大学 · 市场营销 · 本科</p><i></i></section>
      <section><h3>实习经历</h3><p>负责活动内容策划、数据整理与项目复盘，协助完成多渠道运营。</p><i></i><i class="short"></i></section>
      <section><h3>项目经历</h3><p>校园就业服务活动 · 项目执行</p><i></i><i></i><i class="short"></i></section>
      <section><h3>技能与证书</h3><p>Office · 数据分析 · 英语四级</p></section>
    </article>`
  }

  function renderPrint(screen, h) {
    const segment = (label, items, selected) =>
      `<section class="print-v2-control"><div><strong>${h.safe(label)}</strong></div><div class="print-v2-segments">${items
        .map(
          (item, index) =>
            `<button type="button" data-segment-option="true" class="${index === selected ? 'is-selected' : ''}">${h.safe(item)}</button>`
        )
        .join('')}</div></section>`
    return `${h.renderTopbar()}${h.renderTaskStrip(screen)}
      <main class="screen-main">${h.renderHead(screen)}
        <div class="print-v2-workspace">
          <section class="print-v2-preview">
            <header><div><strong>个人简历.pdf</strong><span>3 页 · A4 · 文件预览</span></div><div><button aria-label="缩小"><i data-lucide="zoom-out"></i></button><button aria-label="放大"><i data-lucide="zoom-in"></i></button></div></header>
            <div class="print-v2-paper">${renderResumePreview()}</div>
            <footer><button class="is-active">1</button><button>2</button><button>3</button><span>第 1 / 3 页</span></footer>
          </section>
          <aside class="print-v2-panel">
            <section class="print-v2-control"><div><strong>打印份数</strong><span>每份 3 页</span></div><div class="print-v2-stepper"><button data-copy-step="minus" aria-label="减少份数"><i data-lucide="minus"></i></button><output data-value="2">2 份</output><button data-copy-step="plus" aria-label="增加份数"><i data-lucide="plus"></i></button></div></section>
            ${segment('打印方式', ['黑白', '彩色待确认', '自动'], 0)}
            ${segment('单双面', ['单面', '双面长边', '双面短边'], 1)}
            ${segment('页面布局', ['自动方向', '纵向', '横向'], 0)}
            <section class="print-v2-paper-meta"><div><span>纸张</span><strong>A4</strong></div><div><span>缩放</span><strong>适合页面</strong></div></section>
            <section class="print-v2-device"><i data-lucide="loader-circle"></i><div><strong>设备能力检查中</strong><span>彩色 mode、纸张与耗材以本机 Agent 返回为准。</span></div></section>
            <section class="print-v2-quote"><div><span>本次预估</span><strong>待服务端核价</strong></div><p><span data-paper-count>6 个文档页</span>。确认前不会创建打印任务或扣费。</p></section>
          </aside>
        </div>
      </main>${h.renderActionbar(screen)}`
  }

  function renderAdvisor(screen, h) {
    const goalSection = screen.sections.find((section) => section.kind === 'form')
    const metricSection = screen.sections.find((section) => section.kind === 'metrics')
    const timelineSection = screen.sections.find((section) => section.kind === 'timeline')
    const goal = goalSection?.fields?.[0]?.value || ''
    return `${h.renderTopbar()}
      <main class="advisor-v2-main">
        <aside class="advisor-v2-rail">
          <button type="button" data-to="01"><i data-lucide="arrow-left"></i>返回首页</button>
          <div class="advisor-v2-person"><span>青</span><div><strong>就业顾问 小青</strong><small>目标拆解与材料准备</small></div></div>
          <h1>你想先解决<br />哪一件事？</h1>
          <p>AI 先确认目标与缺口，再整理可以逐步确认的办理顺序。</p>
          <div class="advisor-v2-presets"><button class="is-active">参加招聘会并备齐材料</button><button>针对目标岗位优化简历</button><button>完成一次模拟面试训练</button></div>
          <div class="advisor-v2-boundary"><strong><i data-lucide="shield-check"></i>关键操作不会自动执行</strong><p>支付、打印、删除、保存和跳往第三方平台，都需要本人再次确认。</p></div>
        </aside>
        <section class="advisor-v2-board">
          <header><span>AI 求职顾问 · 任务编排</span><h2>先把目标说清楚</h2><p>${h.safe(screen.summary)}</p></header>
          <section class="advisor-v2-goal"><label>本次目标</label><div><input value="${h.safe(goal)}" /><button><i data-lucide="list-restart"></i>重新整理</button></div></section>
          <section class="advisor-v2-facts">${h.renderSection(metricSection)}<div class="advisor-v2-gap"><strong>还要确认</strong><span>招聘会官方要求</span><span>目标岗位方向</span><span>份数、设备与最终价格</span></div></section>
          <section class="advisor-v2-plan"><div><h3>建议按这个顺序办理</h3><span>每一步都能返回修改</span></div>${h.renderSection(timelineSection)}</section>
          <footer><p><i data-lucide="circle-check-big"></i>确认计划不代表同意修改、支付或打印。</p>${h.actionButton(screen.primary, 'button-primary')}</footer>
        </section>
      </main>${h.renderNavbar(screen)}`
  }

  window.KioskSpecialScreens = { '01': renderHome, '03': renderPrint, 13: renderAdvisor }
})()
