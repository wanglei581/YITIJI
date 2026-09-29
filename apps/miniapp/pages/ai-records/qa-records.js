// pages/ai-records/qa-records.js
// 把 GET /me/ai-records 附带的 qaRecords 收成和本页其它记录一样的行。
// 服务端列表只有元数据（id / sessionId / artifactId / kind / title / createdAt / expiresAt / fileId），
// 不含对话正文。要点条数或摘要只在响应里真有 pins / highlights / todos 时才写。

const FILTER = { key: 'qa', label: '问答要点' }
const FALLBACK_TITLE = '小青问答要点'

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function dayLabel(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '日期未知'
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((today - target) / 86400000)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays > 1 && diffDays < 7) return `${diffDays} 天前`
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function timeLabel(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function lineOf(item) {
  if (typeof item === 'string') return item.trim()
  if (item && typeof item.content === 'string') return item.content.trim()
  return ''
}

/** 只认响应里的要点数组，不从标题或会话主题推断条数。 */
function pointLines(item) {
  if (!item || typeof item !== 'object') return []
  const pins = Array.isArray(item.pins) ? item.pins.map(lineOf).filter(Boolean) : []
  if (pins.length) return pins
  const highlights = Array.isArray(item.highlights) ? item.highlights.map(lineOf).filter(Boolean) : []
  const todos = Array.isArray(item.todos)
    ? item.todos.map(lineOf).filter(Boolean).map((line) => (line.startsWith('待办') ? line : `待办：${line}`))
    : []
  return highlights.concat(todos)
}

function numericCount(item) {
  const raw = item && (item.pinCount != null ? item.pinCount : item.highlightCount != null ? item.highlightCount : item.pointCount)
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : null
}

function detailLabel(item, lines) {
  if (lines.length) {
    const preview = lines.slice(0, 2).map((line) => (line.length > 36 ? `${line.slice(0, 36)}…` : line)).join('；')
    return lines.length > 2 ? `${lines.length} 条要点 · ${preview}` : preview
  }
  const count = numericCount(item)
  if (count != null) return `${count} 条要点`
  const day = dayLabel(item && item.expiresAt)
  if (item && item.expiresAt && day !== '日期未知') return `保存至 ${day}`
  return '问答要点'
}

function mapQaRecord(item) {
  if (!item || typeof item !== 'object') return null
  const rawId = text(item.id) || text(item.artifactId)
  if (!rawId) return null
  const lines = pointLines(item)
  return {
    id: `qa:${rawId}`,
    taskId: '',
    sessionId: text(item.sessionId),
    artifactId: text(item.artifactId) || rawId,
    kind: 'qa_pins',
    type: FILTER.key,
    title: text(item.title) || FALLBACK_TITLE,
    day: dayLabel(item.createdAt),
    time: timeLabel(item.createdAt),
    createdAt: text(item.createdAt),
    status: 'completed',
    statusLabel: detailLabel(item, lines),
    icon: 'i-message-circle',
    tone: 'teal',
    route: '',
    canOpen: true,
    noRouteReason: '',
    actionLabel: '查看要点',
    source: 'qa',
    points: lines,
  }
}

function readQaBundle(list) {
  const records = list && Array.isArray(list.qaRecords) ? list.qaRecords : []
  const rawCursor = list ? list.qaNextCursor : null
  const totalRaw = list ? list.qaTotal : undefined
  return {
    records,
    nextCursor: typeof rawCursor === 'string' && rawCursor ? rawCursor : null,
    total: Number.isFinite(Number(totalRaw)) ? Number(totalRaw) : records.length,
  }
}

function appendQa(existing, incoming) {
  const seen = new Set()
  const out = []
  for (const item of [...(existing || []), ...(incoming || [])]) {
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

/** 三类记录按创建时间从新到旧排。同一时刻保持原顺序。 */
function combine(records, qa, interviews) {
  const all = []
  for (const item of records || []) if (item) all.push(item)
  for (const item of qa || []) if (item) all.push(item)
  for (const item of interviews || []) if (item) all.push(item)
  all.sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0))
  return all
}

function pointsFromSession(session, artifactId) {
  const artifacts = session && Array.isArray(session.artifacts) ? session.artifacts : []
  const wanted = text(artifactId)
  const art = wanted
    ? artifacts.find((item) => item && (item.artifactId === wanted || item.id === wanted))
    : artifacts[0]
  const payload = art && art.payload
  if (!payload || (payload.kind && payload.kind !== 'qa_pins')) return []
  return pointLines(payload)
}

function modalContent(record, lines, mode) {
  const when = [record && record.day, record && record.time].filter(Boolean).join(' ')
  const parts = []
  if (when) parts.push(when)
  if (mode === 'unavailable') parts.push('要点这次没有读出来，这条记录还在。')
  else if (mode === 'empty') parts.push('这份要点里没有可显示的条目。')
  else if (!lines || !lines.length) parts.push('列表里只有标题和时间。')
  else {
    const shown = lines.slice(0, 12)
    shown.forEach((line, index) => parts.push(`${index + 1}. ${line}`))
    if (lines.length > shown.length) parts.push(`还有 ${lines.length - shown.length} 条未展开。`)
  }
  parts.push('不含对话正文。')
  return parts.join('\n').slice(0, 900)
}

module.exports = {
  FILTER,
  mapQaRecord,
  readQaBundle,
  appendQa,
  combine,
  pointsFromSession,
  modalContent,
}
