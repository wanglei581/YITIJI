;(function () {
  const p = window.Proto
  const phone = document.querySelector('#phone')
  const catalog = document.querySelector('#catalog-list')
  const search = document.querySelector('#search')
  const phaseFilter = document.querySelector('#phase-filter')
  const params = new URLSearchParams(location.search)
  const phaseOrder = ['全部', 'M0', 'M1', 'M2', 'M3', 'M4']
  let phase = '全部'

  if (params.get('capture') === '1') document.body.classList.add('capture')

  function currentId() {
    const match = location.hash.match(/screen=([A-Z]\d+)/i)
    return match ? match[1].toUpperCase() : 'T01'
  }

  function getScreen(id) {
    return p.screens.find((item) => item.id === id) || p.screens[0]
  }

  function setScreen(id, replace = false) {
    const next = `#screen=${id}`
    if (replace) history.replaceState(null, '', next)
    else location.hash = next
    render()
  }

  function renderPhone(item) {
    phone.innerHTML = item.render()
    document.querySelector('#screen-id').textContent = item.id
    document.querySelector('#screen-name').textContent = item.name
    document.querySelector('#screen-meta').textContent = `${item.phase} · ${item.meta}`
    document.querySelector('#screen-goal').textContent = item.goal
    document.querySelector('#screen-cta').textContent = item.cta
    document.querySelector('#screen-states').textContent = item.states
    document.title = `${item.id} ${item.name} · 青序小程序原型`
  }

  function renderCatalog(activeId) {
    const query = search.value.trim().toLowerCase()
    const filtered = p.screens.filter((item) => {
      const phaseMatch = phase === '全部' || item.phase === phase
      const text = `${item.id} ${item.name} ${item.group} ${item.meta}`.toLowerCase()
      return phaseMatch && (!query || text.includes(query))
    })
    const groups = [...new Set(filtered.map((item) => item.group))]
    catalog.innerHTML = groups
      .map(
        (group) =>
          `<div class="catalog-group"><div class="catalog-group-title">${group}</div>${filtered
            .filter((item) => item.group === group)
            .map(
              (item) =>
                `<button class="catalog-item ${item.id === activeId ? 'active' : ''}" data-go="${item.id}"><code>${item.id}</code><span>${item.name}</span><em>${item.phase}</em></button>`
            )
            .join('')}</div>`
      )
      .join('')
    document.querySelector('#page-count').textContent = p.screens.length
  }

  function renderFilters() {
    phaseFilter.innerHTML = phaseOrder
      .map(
        (item) =>
          `<button class="${item === phase ? 'active' : ''}" data-phase="${item}">${item}</button>`
      )
      .join('')
  }

  function render() {
    const item = getScreen(currentId())
    renderPhone(item)
    renderFilters()
    renderCatalog(item.id)
  }

  function move(delta) {
    const index = Math.max(
      0,
      p.screens.findIndex((item) => item.id === currentId())
    )
    const next = (index + delta + p.screens.length) % p.screens.length
    setScreen(p.screens[next].id)
  }

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-go], [data-back], [data-phase]')
    if (!target) return
    if (target.dataset.go) setScreen(target.dataset.go)
    else if (target.dataset.back) move(-1)
    else if (target.dataset.phase) {
      phase = target.dataset.phase
      render()
    }
  })
  document.querySelector('#prev-screen').addEventListener('click', () => move(-1))
  document.querySelector('#next-screen').addEventListener('click', () => move(1))
  search.addEventListener('input', render)
  window.addEventListener('hashchange', render)
  window.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') move(-1)
    if (event.key === 'ArrowRight') move(1)
  })

  if (!location.hash) setScreen('T01', true)
  else render()
})()
