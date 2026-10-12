// Tab 选中下标按路径在当前 tabBar.list 里查。
// 完整版是 首页0 / AI工具1 / 打印2 / 我的3；不含 AI 版少一格，打印是 1、我的是 2。
function selectedIndex(list, route) {
  const target = String(route || '').replace(/^\/+/, '')
  const items = list || []
  for (let i = 0; i < items.length; i += 1) {
    const pagePath = String(items[i] && items[i].pagePath || '').replace(/^\/+/, '')
    if (pagePath === target) return i
  }
  return 0
}

function syncTabBar(page, route) {
  if (!page || typeof page.getTabBar !== 'function') return
  const bar = page.getTabBar()
  if (!bar || typeof bar.setData !== 'function') return
  const idx = typeof bar.selectedIndexFor === 'function'
    ? bar.selectedIndexFor(route)
    : selectedIndex(bar.data && bar.data.list, route)
  bar.setData({ selected: idx })
}

module.exports = { selectedIndex, syncTabBar }
