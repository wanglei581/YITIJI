;(function (P) {
  const nav = document.querySelector('#screen-nav')
  const filters = document.querySelector('#section-filters')
  const search = document.querySelector('#screen-search')
  const stage = document.querySelector('#kiosk-stage')
  const scaler = document.querySelector('#stage-scaler')
  const dialog = document.querySelector('#confirm-dialog')
  const dialogTitle = document.querySelector('#dialog-title')
  const dialogMessage = document.querySelector('#dialog-message')
  const dialogConfirm = document.querySelector('#dialog-confirm')
  const params = new URLSearchParams(location.search)
  const captureMode = params.get('capture') === '1'
  let activeSection = 'all'
  let activeState = params.get('state') || 'default'
  let pendingAction = null

  if (captureMode) document.body.classList.add('capture')

  function safe(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;')
  }

  function currentId() {
    const hash = location.hash.match(/screen=(\d{1,2})/)
    return String(hash?.[1] || params.get('screen') || '01').padStart(2, '0')
  }

  function navigate(id) {
    location.hash = `screen=${String(id).padStart(2, '0')}`
  }

  function renderFilters() {
    filters.innerHTML = [
      '<button type="button" data-section="all" class="is-active">全部</button>',
      ...P.sections.map(
        (section) => `<button type="button" data-section="${section.id}">${section.label}</button>`
      ),
    ].join('')
  }

  function visibleScreens() {
    const query = search.value.trim().toLowerCase()
    return P.screens.filter((screen) => {
      const sectionMatch = activeSection === 'all' || screen.section === activeSection
      const textMatch =
        !query ||
        `${screen.id} ${screen.title} ${screen.summary} ${screen.task}`
          .toLowerCase()
          .includes(query)
      return sectionMatch && textMatch
    })
  }

  function renderNav() {
    const screens = visibleScreens()
    const grouped = P.sections
      .map((section) => ({
        section,
        screens: screens.filter((screen) => screen.section === section.id),
      }))
      .filter((group) => group.screens.length)

    nav.innerHTML = grouped
      .map(
        ({ section, screens: groupScreens }) => `
          <div class="nav-group-label">${safe(section.label)}</div>
          ${groupScreens
            .map(
              (screen) => `
                <button type="button" data-screen="${screen.id}" class="${screen.id === currentId() ? 'is-active' : ''}">
                  <span class="nav-id">${screen.id}</span>
                  <span class="nav-title">${safe(screen.title)}</span>
                  <span class="nav-template">${safe(templateLabel(screen.template))}</span>
                </button>`
            )
            .join('')}
        `
      )
      .join('')
  }

  function templateLabel(template) {
    return (
      {
        home: '首页',
        directory: '目录',
        workbench: '办理',
        document: '文档',
        collection: '列表',
        detail: '详情',
        progress: '履约',
        state: '状态',
      }[template] || template
    )
  }

  function iconFor(text) {
    const value = String(text || '')
    const rules = [
      [/打印|出纸|取件/, 'printer'],
      [/扫描|复印/, 'scan-line'],
      [/简历|材料/, 'file-user'],
      [/岗位|职位|企业|公司/, 'briefcase-business'],
      [/招聘会|活动|日程|签到/, 'calendar-days'],
      [/面试|咨询|反馈/, 'messages-square'],
      [/政策|法律|隐私|法务/, 'landmark'],
      [/机构|校园|学校/, 'building-2'],
      [/登录|账号|本人|我的/, 'user-round'],
      [/文件|文档|导出|模板/, 'files'],
      [/支付|订单|权益/, 'receipt-text'],
      [/地图|导览|地点|门店|场馆/, 'map-pinned'],
      [/电话|语音|通话/, 'phone-call'],
      [/转换|格式/, 'repeat'],
      [/签名|盖章/, 'pen-line'],
      [/证件照/, 'image'],
      [/诊断|检查|识别|解析/, 'scan-search'],
      [/优化|生成/, 'wand-2'],
      [/规划/, 'compass'],
      [/收藏/, 'star'],
      [/通知|消息/, 'bell'],
      [/设置|安全/, 'settings'],
      [/帮助/, 'circle-help'],
      [/屏保/, 'monitor-play'],
      [/超时|离线|断网|异常/, 'wifi-off'],
      [/上传|接力/, 'smartphone'],
      [/AI 顾问|顾问/, 'sparkles'],
      [/统计|数据/, 'chart-no-axes-column'],
      [/模板/, 'layout-template'],
      [/测评|自我/, 'clipboard-check'],
    ]
    return rules.find(([pattern]) => pattern.test(value))?.[1] || 'circle-dashed'
  }

  function actionButton(action, fallbackClass) {
    if (!action) return ''
    const tone = action.tone === 'source' ? 'button-source' : fallbackClass
    const disabled = action.disabled ? ' disabled' : ''
    return `<button type="button" class="button ${tone}" data-to="${safe(action.to || '')}" data-confirm="${action.confirm ? 'true' : 'false'}" data-external="${action.external ? 'true' : 'false'}"${disabled}><i data-lucide="${action.external ? 'external-link' : iconFor(action.label)}"></i>${safe(action.label)}</button>`
  }

  function renderTopbar(screen) {
    const deviceState = screen.deviceState || '设备状态待确认'
    const deviceClass = screen.deviceOk ? 'is-ok' : screen.deviceErr ? 'is-err' : ''
    return `
      <header class="kiosk-topbar">
        <div class="kiosk-brand"><span class="kiosk-brand-mark">职</span><div><strong>职易达</strong><span>就业服务终端 · 01 号机</span></div></div>
        <div class="kiosk-topbar-status"><span class="kiosk-topbar-time">2026年8月7日 09:41</span><span class="device-slot ${deviceClass}">${safe(deviceState)}</span></div>
      </header>`
  }

  function renderTaskStrip(screen) {
    const steps = (screen.steps || [])
      .map(
        (step, index) =>
          `<span class="task-step ${step.done ? 'is-done' : ''} ${step.active ? 'is-active' : ''}"><i></i>${safe(step.label)}</span>`
      )
      .join('')
    return `
      <div class="task-strip">
        <div class="task-context">
          <span class="task-context-icon"><i data-lucide="${iconFor(screen.task)}"></i></span>
          <div><small>${safe(screen.taskKicker || '本次办理')}</small><strong>${safe(screen.task)}</strong><span>${safe(screen.taskStatus)}</span></div>
        </div>
        ${steps ? `<div class="task-steps">${steps}</div>` : ''}
      </div>`
  }

  function renderHead(screen) {
    const back =
      screen.id === '01'
        ? ''
        : '<button class="screen-back" type="button" data-history-back="true">← 返回上一步</button>'
    return `
      <header class="screen-head">
        <div>${back}<span class="screen-kicker">${safe(screen.kicker)}</span><h1>${safe(screen.title)}</h1><p>${safe(screen.summary)}</p></div>
        <span class="screen-head-mark"><i data-lucide="${iconFor(screen.title)}"></i></span>
      </header>`
  }

  function renderRows(section, choiceMode) {
    const rows = section.items || []
    return `<div class="${choiceMode ? 'choice-list' : 'service-list'}">${rows
      .map((item, index) => {
        const state = item.state
          ? `<span class="${item.state.includes('未') || item.state.includes('待') || item.state.includes('即将') ? 'warning-label' : 'status-label'}">${safe(item.state)}</span>`
          : '<span class="row-end">→</span>'
        return `<button type="button" class="${choiceMode ? 'choice-row' : 'service-row'}" ${item.to ? `data-to="${safe(item.to)}"` : ''}>
          <span class="${choiceMode ? 'row-symbol' : 'row-number'}">${choiceMode ? (item.selected ? '✓' : '○') : `<i data-lucide="${iconFor(item.title)}"></i>`}</span>
          <span class="row-copy"><strong>${safe(item.title)}</strong><span>${safe(item.text)}</span></span>${state}
        </button>`
      })
      .join('')}</div>`
  }

  function renderForm(section) {
    return `<div class="form-grid">${(section.fields || [])
      .map((field) => {
        const control = field.textarea
          ? `<textarea aria-label="${safe(field.label)}">${safe(field.value)}</textarea>`
          : `<input aria-label="${safe(field.label)}" value="${safe(field.value)}" />`
        const hint = field.hint
          ? `<span class="field-hint"><i data-lucide="${field.hintIcon || 'circle-check-big'}"></i>${safe(field.hint)}</span>`
          : ''
        return `<div class="field ${field.wide ? 'wide' : ''}"><label>${safe(field.label)}</label>${control}${hint}</div>`
      })
      .join('')}</div>`
  }

  function renderSegments(section) {
    return `<div class="segmented">${(section.items || [])
      .map(
        (item, index) =>
          `<button type="button" class="${index === section.selected ? 'is-selected' : ''}">${safe(item)}</button>`
      )
      .join('')}</div>`
  }

  function renderMetrics(section) {
    return `<div class="metric-list">${(section.items || [])
      .map(
        ([label, value]) =>
          `<div class="metric"><span>${safe(label)}</span><strong class="sd-num">${safe(value)}</strong></div>`
      )
      .join('')}</div>`
  }

  function renderDocument(section) {
    const pages = (section.pages || [1, 2, 3])
    const body = safe(section.body || '').replaceAll('\n', '<br />')
    return `<div class="document-workspace">
      <div class="document-pages">${pages
        .map((page, index) => `<div class="document-thumb ${index === (section.activePage ?? 0) ? 'is-active' : ''}">第 ${page} 页</div>`)
        .join('')}</div>
      <div class="document-sheet">
        <div class="document-toolbar"><span>${safe(section.fileName || '文档预览')} · ${safe(section.fileMeta || 'PDF · 3 页 · 380 KB')}</span><div class="segmented"><button type="button" class="is-selected">100%</button><button type="button">适应宽度</button></div></div>
        <h3>${safe(section.heading || '文档内容')}</h3><p>${body}</p>
      </div>
    </div>`
  }

  function renderCompare(section) {
    return `<div class="compare-grid"><article class="compare-pane"><span class="warning-label">原文</span><p>${safe(section.before)}</p></article><article class="compare-pane is-new"><span class="status-label">建议稿</span><p>${safe(section.after)}</p></article></div>`
  }

  function renderTimeline(section) {
    return `<div class="timeline">${(section.items || [])
      .map(
        (item) =>
          `<div class="timeline-item is-${safe(item.status || 'pending')}"><span class="timeline-marker"></span><div class="timeline-copy"><strong>${safe(item.title)}</strong><span>${safe(item.text)}</span></div></div>`
      )
      .join('')}</div>`
  }

  function renderProgress(section) {
    const animate = section.animate !== false
    return `<div class="progress-hero"><span class="progress-symbol">${safe(section.symbol || '办')}</span><h2>${safe(section.headline)}</h2><p>${safe(section.text)}</p>${animate ? '<div class="progress-track"><i></i></div>' : ''}</div>`
  }

  function renderPhoto(section) {
    const src = section.advisor
      ? 'assets/ai-advisor.png'
      : 'assets/kiosk-home-hero-job-fair.png'
    return `<div class="photo-band"><img src="${src}" alt="${section.advisor ? 'AI 顾问小青' : '招聘会现场'}" /><div class="photo-caption">${safe(section.captionText || '招聘会现场公开服务信息')}</div></div>`
  }

  function renderQr(section) {
    return `<div class="qr-panel"><div class="qr-placeholder">${safe(section.text || '二维码示意').replaceAll('\n', '<br />')}</div><strong>${safe(section.title || '扫码接力')}</strong><span>${safe(section.caption || '')}</span></div>`
  }

  function renderText(section) {
    return `<div class="document-sheet text-sheet">${(section.paragraphs || []).map((paragraph) => `<p>${safe(paragraph)}</p>`).join('')}</div>`
  }

  function renderNotice(section) {
    return `<div class="notice-card ${section.tone ? `is-${safe(section.tone)}` : ''}"><i data-lucide="${section.icon || 'info'}"></i><span>${safe(section.text)}</span></div>`
  }

  function renderChecklist(section) {
    return `<div class="checklist">${(section.items || [])
      .map(
        (item) =>
          `<div class="check-item ${item.missing ? 'is-missing' : ''}"><i data-lucide="${item.missing ? 'triangle-alert' : 'circle-check-big'}"></i><div><strong>${safe(item.title)}</strong><span>${safe(item.text)}</span></div></div>`
      )
      .join('')}</div>`
  }

  function renderPlan(section) {
    return `<div class="advisor-plan">${(section.items || [])
      .map(
        (item) => `
          <article class="plan-card ${item.next ? 'is-next' : ''}">
            <div class="plan-card-head">
              <i data-lucide="${iconFor(item.title)}"></i><strong>${safe(item.title)}</strong>
              <span class="${item.status?.includes('未') || item.status?.includes('待') ? 'warning-label' : 'status-label'}">${safe(item.status || '可办理')}</span>
            </div>
            <p>${safe(item.text)}</p>
            ${item.actions ? `<div class="plan-card-actions">${(item.actions || []).map((a) => actionButton(a, 'button-secondary')).join('')}</div>` : ''}
          </article>`
      )
      .join('')}</div>`
  }

  function renderPrice(section) {
    return `<div class="price-line"><span>${safe(section.label)}</span><strong class="sd-num">${safe(section.amount)}</strong></div><p class="price-note">${safe(section.note || '金额以服务端实时核价为准')}</p>`
  }

  function renderSection(section) {
    const content = {
      rows: () => renderRows(section, false),
      choices: () => renderRows(section, true),
      form: () => renderForm(section),
      segments: () => renderSegments(section),
      metrics: () => renderMetrics(section),
      document: () => renderDocument(section),
      compare: () => renderCompare(section),
      timeline: () => renderTimeline(section),
      progress: () => renderProgress(section),
      photo: () => renderPhoto(section),
      qr: () => renderQr(section),
      text: () => renderText(section),
      notice: () => renderNotice(section),
      checklist: () => renderChecklist(section),
      plan: () => renderPlan(section),
      price: () => renderPrice(section),
    }[section.kind]

    if (!content) return ''
    const heading = section.headless
      ? ''
      : `<div class="section-heading"><h2>${safe(section.title)}</h2><span>${safe(section.caption)}</span></div>`
    return `<section class="section-block section-${safe(section.kind)} ${section.wide ? 'wide' : ''}">${heading}<div class="section-content">${content()}</div></section>`
  }

  function renderRail(screen) {
    if (!screen.rail?.length) return ''
    return `<aside class="screen-rail">${screen.rail
      .map((item) => {
        if (item.kind === 'photo') return renderPhoto(item)
        if (item.kind === 'qr') return renderQr(item)
        if (item.kind === 'notice') return renderNotice(item)
        if (item.kind === 'price') return renderPrice(item)
        if (item.kind === 'metric') return `<section class="section-block"><div class="section-content">${renderMetrics(item)}</div></section>`
        if (item.kind === 'segments') {
          return `<section class="section-block"><div class="section-heading"><h2>${safe(item.title || '参数')}</h2></div><div class="section-content">${renderSegments(item)}</div></section>`
        }
        if (item.kind === 'truth') {
          return `<section class="section-block"><div class="section-heading"><h2>${safe(item.title || '真实性边界')}</h2></div><div class="section-content"><div class="notice-card"><i data-lucide="shield-check"></i><span>${safe(item.text)}</span></div></div></section>`
        }
        return ''
      })
      .join('')}</aside>`
  }

  function renderScreen(screen) {
    const bodySections = (screen.sections || []).map(renderSection).join('')
    const primary = actionButton(screen.primary, 'button-primary')
    const secondary = actionButton(screen.secondary, 'button-secondary')
    const hasBottomNav = screen.bottomNav !== false
    const hasActionbar = !!screen.primary || !!screen.secondary

    const bottomNav = hasBottomNav
      ? `<nav class="kiosk-bottomnav">
          <button type="button" class="${screen.activeTab === 'home' ? 'is-active' : ''}" data-to="01"><i data-lucide="house"></i>首页</button>
          <button type="button" class="${screen.activeTab === 'advisor' ? 'is-active' : ''}" data-to="13"><i data-lucide="sparkles"></i>AI 顾问</button>
          <button type="button" class="${screen.activeTab === 'account' ? 'is-active' : ''}" data-to="14"><i data-lucide="user-round"></i>我的</button>
        </nav>`
      : ''

    const actionbar = hasActionbar
      ? `<div class="screen-actionbar">${screen.helper ? `<span class="action-hint">${safe(screen.helper)}</span>` : ''}${secondary}${primary}</div>`
      : ''

    return `
      <div class="kiosk-screen template-${safe(screen.template || 'directory')} ${hasActionbar ? 'has-actionbar' : ''} ${hasBottomNav ? 'has-bottomnav' : ''}">
        ${renderTopbar(screen)}
        ${renderTaskStrip(screen)}
        <div class="screen-body">
          <main class="screen-main">${bodySections}</main>
          ${renderRail(screen)}
        </div>
        ${actionbar}
        ${bottomNav}
        ${renderStateLayer(screen)}
      </div>`
  }

  function renderStateLayer(screen) {
    if (activeState === 'default') return '<div class="screen-state-layer" hidden></div>'
    const states = {
      loading: {
        icon: 'loader-circle',
        title: '正在获取最新状态',
        text: screen.stateLoadingText || '系统正在读取真实数据，请稍候。',
        cls: 'state-loading',
      },
      empty: {
        icon: 'inbox',
        title: '暂时没有内容',
        text: screen.stateEmptyText || '这里还没有可显示的数据；真实开通后会自动出现。',
        cls: 'state-empty',
      },
      error: {
        icon: 'triangle-alert',
        title: '暂时无法完成',
        text: screen.stateErrorText || '服务暂时不可用，请稍后重试；问题持续时联系现场工作人员。',
        cls: 'state-error',
      },
    }[activeState]
    if (!states) return ''
    return `<div class="screen-state-layer ${states.cls}">
      <div class="screen-state-box">
        <span class="screen-state-icon"><i data-lucide="${states.icon}"></i></span>
        <strong>${safe(states.title)}</strong>
        <p>${safe(states.text)}</p>
        ${activeState === 'error' ? '<div class="action-buttons"><button type="button" class="button button-primary">重新加载</button></div>' : ''}
      </div>
    </div>`
  }

  function updateInspector(screen) {
    document.querySelector('#toolbar-id').textContent = screen.id
    document.querySelector('#toolbar-title').textContent = screen.title
    document.querySelector('#toolbar-meta').textContent = `${screen.kicker || ''} · ${screen.summary || ''}`
    document.querySelector('#inspector-goal').textContent = screen.goal || ''
    document.querySelector('#inspector-action').textContent = screen.action || ''
    document.querySelector('#inspector-mapping').textContent = screen.mapping || ''
    document.querySelector('#inspector-boundary').textContent =
      screen.boundary || '页面只表达可验证状态；动态数据必须来自真实接口或硬件上报。'
  }

  function render() {
    const screen = P.get(currentId()) || P.get('01')
    stage.innerHTML = renderScreen(screen)
    updateInspector(screen)
    renderNav()
    if (window.lucide) lucide.createIcons({ attrs: { 'stroke-width': 2 } })
    document.querySelectorAll('#kiosk-stage [data-to]').forEach((button) => {
      button.addEventListener('click', () => navigate(button.dataset.to))
    })
    document.querySelectorAll('#kiosk-stage [data-history-back]').forEach((button) => {
      button.addEventListener('click', () => history.back())
    })
    document.querySelectorAll('#kiosk-stage [data-confirm="true"]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        pendingAction = button.dataset.to
        dialogTitle.textContent = '确认继续'
        dialogMessage.textContent =
          button.dataset.external === 'true'
            ? '即将离开本终端前往来源平台，平台不会代你投递或预约；请在来源页面自行确认。'
            : '确认后系统将按真实流程继续；涉及支付、打印或删除的动作都只会发生在你确认之后。'
        dialog.showModal()
      })
    })
  }

  nav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-screen]')
    if (!button) return
    navigate(button.dataset.screen)
  })

  filters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-section]')
    if (!button) return
    activeSection = button.dataset.section
    filters.querySelectorAll('button').forEach((item) => item.classList.remove('is-active'))
    button.classList.add('is-active')
    renderNav()
  })

  search.addEventListener('input', renderNav)

  document.querySelectorAll('.state-switcher button').forEach((button) => {
    button.addEventListener('click', () => {
      activeState = button.dataset.state
      document.querySelectorAll('.state-switcher button').forEach((item) => item.classList.remove('is-active'))
      button.classList.add('is-active')
      render()
    })
  })

  document.querySelector('#previous-screen').addEventListener('click', () => {
    const screens = P.screens
    const index = screens.findIndex((screen) => screen.id === currentId())
    if (index > 0) navigate(screens[index - 1].id)
  })

  document.querySelector('#next-screen').addEventListener('click', () => {
    const screens = P.screens
    const index = screens.findIndex((screen) => screen.id === currentId())
    if (index < screens.length - 1) navigate(screens[index + 1].id)
  })

  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'confirm' && pendingAction) navigate(pendingAction)
    pendingAction = null
  })

  window.addEventListener('hashchange', render)
  renderFilters()
  render()
})(window.KioskPrototype)
