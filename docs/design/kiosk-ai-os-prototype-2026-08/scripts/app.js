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
      [/打印|出纸/, 'printer'],
      [/扫描/, 'scan-line'],
      [/简历|材料/, 'file-user'],
      [/岗位|职位/, 'briefcase-business'],
      [/招聘会|活动|日程/, 'calendar-days'],
      [/面试|咨询|反馈/, 'messages-square'],
      [/政策|法律|隐私/, 'landmark'],
      [/企业|机构|校园|学校/, 'building-2'],
      [/登录|账号|本人|我的/, 'user-round'],
      [/文件|文档|导出/, 'files'],
      [/支付|订单|权益/, 'receipt-text'],
      [/地图|导览|地点|门店/, 'map-pinned'],
      [/电话|语音/, 'phone-call'],
    ]
    return rules.find(([pattern]) => pattern.test(value))?.[1] || 'circle-dashed'
  }

  function actionButton(action, fallbackClass) {
    if (!action) return ''
    const tone = action.tone === 'source' ? 'button-source' : fallbackClass
    return `<button type="button" class="button ${tone}" data-to="${safe(action.to || '')}" data-confirm="${action.confirm ? 'true' : 'false'}" data-external="${action.external ? 'true' : 'false'}"><i data-lucide="${action.external ? 'external-link' : iconFor(action.label)}"></i>${safe(action.label)}</button>`
  }

  function renderTopbar() {
    return `
      <header class="kiosk-topbar">
        <div class="kiosk-brand"><span class="kiosk-brand-mark">职</span><div><strong>职易达</strong><span>就业服务终端 · 01 号机</span></div></div>
        <div class="kiosk-brand"><span class="kiosk-topbar-time">2026年8月5日 18:08</span><span class="device-slot">设备状态待确认</span></div>
      </header>`
  }

  function renderTaskStrip(screen) {
    return `
      <div class="task-strip">
        <div class="task-context">
          <span class="task-context-icon"><i data-lucide="clipboard-list"></i></span>
          <div><small>本次办理</small><strong>${safe(screen.task)}</strong><span>${safe(screen.taskStatus)}</span></div>
        </div>
        <div class="task-step"><i></i>${safe(templateLabel(screen.template))}流程</div>
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
          ? `<span class="${item.state.includes('未') || item.state.includes('待') ? 'warning-label' : 'status-label'}">${safe(item.state)}</span>`
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
        return `<div class="field ${field.wide ? 'wide' : ''}"><label>${safe(field.label)}</label>${control}</div>`
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
          `<div class="metric"><span>${safe(label)}</span><strong>${safe(value)}</strong></div>`
      )
      .join('')}</div>`
  }

  function renderDocument(section) {
    const body = safe(section.body || '').replaceAll('\n', '<br />')
    return `<div class="document-workspace">
      <div class="document-pages"><div class="document-thumb is-active">第 1 页</div><div class="document-thumb">第 2 页</div><div class="document-thumb">第 3 页</div></div>
      <article class="document-sheet"><h3>${safe(section.heading || '文档预览')}</h3><p>${body}</p></article>
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
    return `<div class="progress-hero"><span class="progress-symbol">${section.headline?.includes('收到') ? '收' : '办'}</span><h2>${safe(section.headline)}</h2><p>${safe(section.text)}</p></div>`
  }

  function renderPhoto(section) {
    const src = section.advisor
      ? '../../../apps/kiosk/public/assets/ai-advisor.png'
      : '../../../apps/kiosk/public/assets/kiosk-home-hero-job-fair.png'
    return `<div class="photo-band"><img src="${src}" alt="${section.advisor ? 'AI 顾问小青' : '招聘会现场'}" /><div class="photo-caption">${safe(section.captionText || '招聘会现场公开服务信息')}</div></div>`
  }

  function renderQr(section) {
    return `<div class="qr-placeholder">${safe(section.text || '二维码示意').replaceAll('\n', '<br />')}</div>`
  }

  function renderText(section) {
    return `<div class="document-sheet text-sheet">${(section.paragraphs || []).map((paragraph) => `<p>${safe(paragraph)}</p>`).join('')}</div>`
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
    }[section.kind]

    return `<section class="section-block section-${safe(section.kind)}"><div class="section-heading"><h2>${safe(section.title)}</h2><span>${safe(section.caption)}</span></div>${content ? content() : ''}</section>`
  }

  function renderRailBlock(block) {
    if (block.kind === 'task') {
      return `<section class="task-summary"><h3>本次办理单</h3>${(block.pairs || [])
        .map(
          ([label, value]) =>
            `<div class="summary-pair"><span>${safe(label)}</span><strong>${safe(value)}</strong></div>`
        )
        .join('')}</section>`
    }
    if (block.kind === 'photo') return renderPhoto({ captionText: block.caption })
    const className =
      block.kind === 'assistant'
        ? 'assistant-note'
        : block.kind === 'warning'
          ? 'warning-note'
          : 'truth-note'
    return `<section class="${className}"><strong>${safe(block.title)}</strong><p>${safe(block.text)}</p></section>`
  }

  function renderActionbar(screen) {
    return `<footer class="screen-actionbar"><span class="action-helper">${safe(screen.helper)}</span><div class="action-buttons">${actionButton(screen.secondary, 'button-secondary')}${actionButton(screen.primary, 'button-primary')}</div></footer>`
  }

  function renderNavbar(screen) {
    const tabs = [
      ['home', '首页', '01'],
      ['assistant', 'AI 顾问', '13'],
      ['profile', '我的', '14'],
    ]
    const icons = { home: 'house', assistant: 'sparkles', profile: 'user-round' }
    return `<nav class="kiosk-navbar">${tabs.map(([tab, label, to]) => `<button type="button" data-to="${to}" class="${screen.activeTab === tab ? 'is-active' : ''}"><i data-lucide="${icons[tab]}"></i>${label}</button>`).join('')}</nav>`
  }

  function renderMobile(mobile) {
    return `<div class="mobile-frame"><header><h2>${safe(mobile.title)}</h2></header><main><p>${safe(mobile.body)}</p><div class="record-list">${mobile.rows.map((row, index) => `<div class="record-row"><span class="row-number">${index + 1}</span><span class="row-copy"><strong>${safe(row)}</strong></span><span class="row-end">→</span></div>`).join('')}</div></main><footer><button class="button button-primary" type="button">${safe(mobile.action)}</button></footer></div>`
  }

  function renderStateScreen(screen) {
    const content = screen.mobile
      ? renderMobile(screen.mobile)
      : `<div class="state-panel"><div class="state-code">${safe(screen.state.code)}</div><h1>${safe(screen.state.title)}</h1><p>${safe(screen.state.body)}</p><div class="action-buttons">${actionButton(screen.secondary, 'button-secondary')}${actionButton(screen.primary, 'button-primary')}</div></div>`
    return `${renderTopbar()}${renderTaskStrip(screen)}<main class="screen-main"><div class="screen-body">${content}</div></main>${screen.mobile ? renderActionbar(screen) : ''}`
  }

  function stateLayer(screen) {
    if (activeState === 'default') return '<div class="screen-state-layer" hidden></div>'
    const copy = {
      loading: ['正在读取真实数据', `正在加载“${screen.title}”所需的服务端状态，请稍候。`],
      empty: ['当前没有可显示内容', '没有数据时提供与本页目标一致的下一步，不填充演示记录。'],
      error: [
        '暂时无法完成本页操作',
        '保留已确认内容与任务 ID，可重试或返回上一步，不显示假成功。',
      ],
    }[activeState]
    return `<div class="screen-state-layer"><div class="screen-state-box"><strong>${safe(copy[0])}</strong><p>${safe(copy[1])}</p><div class="action-buttons"><button type="button" class="button button-secondary" data-state-reset="true">返回默认状态</button></div></div></div>`
  }

  function renderScreen(screen) {
    if (!screen) return
    const isTopTab = ['01', '13', '14'].includes(screen.id)
    const helpers = {
      safe,
      iconFor,
      renderTopbar,
      renderTaskStrip,
      renderHead,
      renderSection,
      renderRailBlock,
      renderActionbar,
      renderNavbar,
      actionButton,
    }
    const special = window.KioskSpecialScreens?.[screen.id]
    const shell = special
      ? special(screen, helpers)
      : screen.template === 'state'
        ? renderStateScreen(screen)
        : `${renderTopbar()}${renderTaskStrip(screen)}<main class="screen-main">${renderHead(screen)}<div class="screen-body"><div class="screen-primary">${screen.sections.map(renderSection).join('')}</div><aside class="screen-rail">${screen.rail.map(renderRailBlock).join('')}</aside></div></main>${isTopTab ? renderNavbar(screen) : renderActionbar(screen)}`
    stage.innerHTML = `<div class="kiosk-screen template-${safe(screen.template)} domain-${safe(screen.section)} screen-${safe(screen.id)}">${shell}${stateLayer(screen)}</div>`

    document.querySelector('#toolbar-id').textContent = screen.id
    document.querySelector('#toolbar-title').textContent = screen.title
    document.querySelector('#toolbar-meta').textContent =
      `${templateLabel(screen.template)} · ${screen.summary}`
    document.querySelector('#inspector-goal').textContent = screen.goal
    document.querySelector('#inspector-action').textContent = screen.action
    document.querySelector('#inspector-mapping').textContent = screen.mapping
    document.querySelector('#inspector-boundary').textContent = screen.boundary
    document.title = `${screen.id} ${screen.title} · Kiosk AI OS 原型`
    if (window.lucide) window.lucide.createIcons()
    updateStateSwitcher()
    renderNav()
  }

  function updateStateSwitcher() {
    document.querySelectorAll('#state-switcher [data-state]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.state === activeState)
    })
  }

  function scaleStage() {
    if (captureMode) return
    const canvas = document.querySelector('.prototype-canvas')
    const inspector = document.querySelector('.prototype-inspector')
    const style = getComputedStyle(canvas)
    const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
    const verticalPadding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
    const inspectorWidth =
      inspector && getComputedStyle(inspector).display !== 'none' ? inspector.offsetWidth + 32 : 0
    const availableWidth = canvas.clientWidth - horizontalPadding - inspectorWidth
    const availableHeight = canvas.clientHeight - verticalPadding
    const scale = Math.max(0.28, Math.min(availableWidth / 1080, availableHeight / 1920, 0.64))
    scaler.style.transform = `scale(${scale})`
    scaler.style.width = `${1080 * scale}px`
    scaler.style.height = `${1920 * scale}px`
  }

  function openConfirm(button) {
    pendingAction = {
      to: button.dataset.to,
      external: button.dataset.external === 'true',
      label: button.textContent.trim(),
    }
    dialogTitle.textContent = pendingAction.external ? '即将打开第三方来源' : pendingAction.label
    dialogMessage.textContent = pendingAction.external
      ? '离开本平台后，请在来源平台核实账号、隐私和办理结果。本平台只记录打开来源，不知道是否完成投递、预约或签到。'
      : '请核对当前文件、数据、费用或授权范围。确认后才进入下一步；原型不会连接真实服务。'
    dialogConfirm.textContent = pendingAction.external ? '知道了，查看来源' : '确认继续'
    dialog.showModal()
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('button')
    if (!button) return
    if (button.dataset.screen) navigate(button.dataset.screen)
    if (button.dataset.section) {
      activeSection = button.dataset.section
      document
        .querySelectorAll('#section-filters [data-section]')
        .forEach((item) =>
          item.classList.toggle('is-active', item.dataset.section === activeSection)
        )
      renderNav()
    }
    if (button.dataset.state) {
      activeState = button.dataset.state
      renderScreen(P.get(currentId()))
    }
    if (button.dataset.stateReset) {
      activeState = 'default'
      renderScreen(P.get(currentId()))
    }
    if (button.dataset.segmentOption) {
      button.parentElement
        .querySelectorAll('[data-segment-option]')
        .forEach((item) => item.classList.toggle('is-selected', item === button))
    }
    if (button.dataset.copyStep) {
      const output = button.parentElement.querySelector('output')
      const next = Math.max(
        1,
        Math.min(20, Number(output.dataset.value) + (button.dataset.copyStep === 'plus' ? 1 : -1))
      )
      output.dataset.value = String(next)
      output.textContent = `${next} 份`
      document.querySelector('[data-paper-count]').textContent = `${next * 3} 个文档页`
    }
    if (button.dataset.historyBack) {
      const currentIndex = P.screens.findIndex((screen) => screen.id === currentId())
      navigate(P.screens[Math.max(0, currentIndex - 1)].id)
    }
    if (button.dataset.to !== undefined) {
      if (button.dataset.confirm === 'true') openConfirm(button)
      else if (button.dataset.to) navigate(button.dataset.to)
    }
  })

  dialog.addEventListener('close', () => {
    if (
      dialog.returnValue === 'confirm' &&
      pendingAction &&
      !pendingAction.external &&
      pendingAction.to
    )
      navigate(pendingAction.to)
    pendingAction = null
  })

  document.querySelector('#previous-screen').addEventListener('click', () => {
    const index = P.screens.findIndex((screen) => screen.id === currentId())
    navigate(P.screens[(index - 1 + P.screens.length) % P.screens.length].id)
  })

  document.querySelector('#next-screen').addEventListener('click', () => {
    const index = P.screens.findIndex((screen) => screen.id === currentId())
    navigate(P.screens[(index + 1) % P.screens.length].id)
  })

  search.addEventListener('input', renderNav)
  window.addEventListener('hashchange', () => renderScreen(P.get(currentId())))
  window.addEventListener('resize', scaleStage)

  renderFilters()
  P.screens.sort((a, b) => Number(a.id) - Number(b.id))
  renderScreen(P.get(currentId()))
  requestAnimationFrame(scaleStage)
})(window.KioskPrototype)
