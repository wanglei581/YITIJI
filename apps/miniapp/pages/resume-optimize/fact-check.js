// 优化页导出前事实核对。页面只做接线，不伪造「已核对」。

const KIND_LABEL = {
  school: '学校',
  company: '公司',
  period: '时间段',
  certificate: '证书',
  phone: '电话',
  email: '邮箱',
}

const SCALAR_PATHS = {
  'basic.phone': { section: 'basic', field: 'phone', index: -1, selector: '#edit-basic' },
  'basic.email': { section: 'basic', field: 'email', index: -1, selector: '#edit-basic' },
  'basic.city': { section: 'basic', field: 'city', index: -1, selector: '#edit-basic' },
  summary: { section: 'summary', field: 'summary', index: -1, selector: '#edit-basic' },
}

function parseFactPath(path) {
  const p = String(path || '')
  if (SCALAR_PATHS[p]) return Object.assign({ kind: 'scalar' }, SCALAR_PATHS[p])
  const intention = /^intention\.([A-Za-z]+)$/.exec(p)
  if (intention) {
    return { kind: 'scalar', section: 'intention', field: intention[1], index: -1, selector: '#edit-basic' }
  }
  const row = /^(education|experience|projects)\[(\d+)\](?:\.(\w+))?$/.exec(p)
  if (row) {
    if (row[1] === 'projects') return { kind: 'array', selector: '#edit-draft' }
    const prefix = row[1] === 'education' ? 'edu' : 'exp'
    return { kind: 'array', selector: `#edit-${prefix}-${row[2]}` }
  }
  if (/^certificates\[\d+\]$/.test(p) || /^skills\[\d+\]$/.test(p)) {
    return { kind: 'array', selector: '#edit-lists' }
  }
  return { kind: 'array', selector: '#edit-draft' }
}

function toViewItems(items) {
  return (Array.isArray(items) ? items : []).map((item, i) => {
    const found = item && item.foundInOriginal === true
    const path = (item && item.path) || `fact${i}`
    return {
      key: path,
      path,
      kind: item && item.kind,
      label: KIND_LABEL[item && item.kind] || (item && item.kind) || '事实',
      value: item && item.value ? String(item.value) : '',
      foundInOriginal: found,
      needsConfirm: !found,
      confirmed: found,
      removed: false,
      mark: found ? '原文可对应' : '原文未找到，需本人确认',
    }
  })
}

function toggleItem(items, key) {
  return (items || []).map((item) => {
    if (item.key !== key || !item.needsConfirm || item.removed) return item
    return Object.assign({}, item, { confirmed: !item.confirmed })
  })
}

function pendingCount(items) {
  return (items || []).filter((item) => item.needsConfirm && !item.confirmed && !item.removed).length
}

function removedCount(items) {
  return (items || []).filter((item) => item.removed).length
}

function removedHint(items) {
  const n = removedCount(items)
  return n > 0 ? `已从优化稿删除 ${n} 项，导出内容以编辑区为准` : ''
}

function allConfirmed(items) {
  return pendingCount(items) === 0
}

function nowIso() {
  return new Date().toISOString()
}

function explainError(err) {
  const code = (err && err.code) || ''
  const status = err && err.statusCode
  const message = (err && err.message) || ''
  if (code === 'AI_RESUME_SOURCE_UNAVAILABLE' || status === 503) {
    return {
      originalAvailable: false,
      canConfirm: false,
      text: message || '简历原文已按隐私策略清理，无法核对事实。未核对不能导出。',
    }
  }
  if (code === 'AI_TASK_NOT_FOUND' || status === 404) {
    return {
      originalAvailable: false,
      canConfirm: false,
      text: message || '任务不存在或无权核对，无法完成事实核对。未核对不能导出。',
    }
  }
  if (code === 'AI_RESULT_NOT_READY') {
    return {
      originalAvailable: false,
      canConfirm: false,
      text: message || '还没有可核对的优化稿，无法完成事实核对。',
    }
  }
  return {
    originalAvailable: false,
    canConfirm: false,
    text: message || '事实核对失败，未核对不能导出。',
  }
}

function explainExportError(err) {
  const code = (err && err.code) || ''
  if (code === 'RESUME_FACTS_NOT_CONFIRMED') {
    return messageOf(err) || '导出前请先核对优化稿中未能在原文找到的事实（电话、邮箱、数字等），全部确认后再导出。'
  }
  return messageOf(err) || '请稍后重试'
}

function messageOf(err) {
  return (err && err.message) || ''
}

function panelShape(extra) {
  return Object.assign({
    open: false,
    loading: false,
    originalAvailable: false,
    canConfirm: false,
    items: [],
    pending: 0,
    removedCount: 0,
    removedHint: '',
    error: '',
  }, extra)
}

function openPanel(res) {
  const items = toViewItems(res && res.items)
  const originalAvailable = !!(res && res.originalAvailable === true)
  return panelShape({
    open: true,
    originalAvailable,
    canConfirm: originalAvailable,
    items,
    pending: pendingCount(items),
    error: originalAvailable ? '' : '服务端未确认原文可用，不能把这次结果写成已核对。',
  })
}

function loadingPanel() {
  return panelShape({ open: true, loading: true })
}

function errorPanel(err) {
  const explained = explainError(err)
  return panelShape({
    open: true,
    originalAvailable: explained.originalAvailable,
    canConfirm: explained.canConfirm,
    error: explained.text,
  })
}

function closedPanel() {
  return panelShape({})
}

function removeItem(panel, key) {
  const items = (panel && panel.items) || []
  const item = items.find((row) => row.key === key)
  if (!item || !item.needsConfirm || item.removed) return { action: 'noop' }
  const parsed = parseFactPath(item.path || item.key)
  if (parsed.kind === 'scalar') {
    const next = items.map((row) => (
      row.key === key
        ? Object.assign({}, row, { removed: true, mark: '已从优化稿删除，导出以编辑区为准' })
        : row
    ))
    return {
      action: 'scalar',
      section: parsed.section,
      field: parsed.field,
      index: parsed.index,
      items: next,
      pending: pendingCount(next),
      removedCount: removedCount(next),
      removedHint: removedHint(next),
    }
  }
  return { action: 'array', label: item.label, selector: parsed.selector }
}

function runRemove(page, helpers, key) {
  const out = removeItem(page.data.factPanel, key)
  if (out.action === 'scalar') {
    page._factsConfirmedAt = ''
    page._factsNeedRecheck = true
    page._editor = helpers.draft.applyInput(helpers.draft.clone(page._editor), out.section, out.field, out.index, '')
    page._resume = helpers.draft.editorToResume(page._editor)
    page.setData({
      editor: page._editor,
      factsBlockedReason: '',
      'factPanel.items': out.items,
      'factPanel.pending': out.pending,
      'factPanel.removedCount': out.removedCount,
      'factPanel.removedHint': out.removedHint,
    }, () => page._syncExportAvailability())
    if (page._saver && helpers.auth.isLoggedIn() && page._draftWritable) page._saver.flush()
    return
  }
  if (out.action === 'array') {
    page._factsConfirmedAt = ''
    page._factsNeedRecheck = true
    page.setData({ factPanel: closedPanel() }, () => {
      wx.pageScrollTo({ selector: out.selector, duration: 300 })
    })
    wx.showToast({ title: `请在编辑区修改：${out.label}`, icon: 'none', duration: 2500 })
  }
}

module.exports = {
  KIND_LABEL,
  toViewItems,
  toggleItem,
  pendingCount,
  removedCount,
  removedHint,
  allConfirmed,
  nowIso,
  explainError,
  explainExportError,
  openPanel,
  loadingPanel,
  errorPanel,
  closedPanel,
  parseFactPath,
  removeItem,
  runRemove,
}
