// 优化页草稿自动保存 + 已确认版本。页面只做接线。
const buildModel = require('../../utils/resume-build-model')

const DEBOUNCE_MS = 2000

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}))
}

function str(value) {
  return value == null ? '' : String(value)
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasMetaObject(value) {
  return isPlainObject(value) && Object.keys(value).length > 0
}

/** 从 GET/PUT 响应取出 layout / decisions。缺项不补 null 或 {}。小程序不解释 decisions 语义，只透传。 */
function pickDraftExtras(source) {
  const raw = source && source.draft ? source.draft : source
  const extras = {}
  if (hasMetaObject(raw && raw.layout)) extras.layout = clone(raw.layout)
  if (hasMetaObject(raw && raw.decisions)) extras.decisions = clone(raw.decisions)
  return extras
}

function mergeDraftExtras(current, response) {
  const incoming = pickDraftExtras(response)
  const next = isPlainObject(current) ? Object.assign({}, current) : {}
  if (incoming.layout) next.layout = incoming.layout
  if (incoming.decisions) next.decisions = incoming.decisions
  return next
}

function resumeToEditor(resume) {
  const r = resume || {}
  const basic = r.basic || {}
  const intention = r.intention || {}
  return {
    basic: {
      name: str(basic.name),
      phone: str(basic.phone),
      email: str(basic.email),
      city: str(basic.city),
    },
    intention: {
      position: str(intention.position),
      city: str(intention.city),
      jobType: str(intention.jobType),
      salary: str(intention.salary),
    },
    summary: str(r.summary),
    education: (r.education || []).map((row, i) => ({
      id: `edu${i}`,
      school: str(row.school),
      major: str(row.major),
      degree: str(row.degree),
      period: str(row.period),
      description: str(row.description),
    })),
    experience: (r.experience || []).map((row, i) => ({
      id: `exp${i}`,
      company: str(row.company),
      role: str(row.role),
      period: str(row.period),
      description: str(row.description),
    })),
    projects: (r.projects || []).map((row, i) => ({
      id: `prj${i}`,
      name: str(row.name),
      role: str(row.role),
      description: str(row.description),
    })),
    skillsText: (r.skills || []).join('\n'),
    certsText: (r.certificates || []).join('\n'),
  }
}

function editorToResume(editor) {
  const ed = editor || resumeToEditor(null)
  return {
    basic: ed.basic,
    intention: ed.intention,
    summary: ed.summary,
    education: ed.education || [],
    experience: ed.experience || [],
    projects: ed.projects || [],
    skills: buildModel.parseList(ed.skillsText),
    certificates: buildModel.parseList(ed.certsText),
  }
}

function applyInput(editor, section, key, index, value) {
  const next = editor || resumeToEditor(null)
  if (section === 'basic' || section === 'intention') {
    if (!next[section]) next[section] = {}
    next[section][key] = value
    return next
  }
  if (section === 'summary' || section === 'skillsText' || section === 'certsText') {
    next[section] = value
    return next
  }
  const rows = next[section]
  const i = Number(index)
  if (Array.isArray(rows) && Number.isInteger(i) && rows[i]) rows[i][key] = value
  return next
}

function buildDraftPutBody(resume, extras) {
  const payload = buildModel.buildExportPayload(resume, {})
  const body = {
    resume: {
      basic: payload.basic,
      intention: payload.intention,
      summary: payload.summary,
      education: payload.education,
      experience: payload.experience,
      projects: payload.projects,
      skills: payload.skills,
      certificates: payload.certificates,
    },
  }
  if (hasMetaObject(extras && extras.layout)) body.layout = extras.layout
  if (hasMetaObject(extras && extras.decisions)) body.decisions = extras.decisions
  return body
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatClock(iso) {
  const date = new Date(iso)
  if (!iso || Number.isNaN(date.getTime())) return ''
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

function formatDateTime(iso) {
  const date = new Date(iso)
  if (!iso || Number.isNaN(date.getTime())) return '时间未知'
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function statusText(kind, iso) {
  if (kind === 'guest') return '未登录不保存'
  if (kind === 'unbound') return '当前账号无法保存这份任务的草稿'
  if (kind === 'saving') return '正在保存草稿…'
  if (kind === 'failed') return '保存失败'
  if (kind === 'saved') {
    const clock = formatClock(iso)
    return clock ? `草稿已保存 ${clock}` : '草稿已保存'
  }
  return ''
}

function hasUsableDraft(res) {
  return !!(res && res.draft && res.draft.resume && typeof res.draft.resume === 'object')
}

function explainLoadError(err) {
  const code = (err && err.code) || ''
  const status = err && err.statusCode
  if (code === 'AI_TASK_NOT_FOUND' || status === 404) {
    return { kind: 'unbound', text: statusText('unbound') }
  }
  return { kind: 'idle', text: (err && err.message) || '读取草稿失败，本次先用当前优化结果' }
}

function explainSaveError(err) {
  const code = (err && err.code) || ''
  if (code === 'AI_TASK_NOT_FOUND') return '当前账号无法保存这份任务的草稿'
  if (code === 'RESUME_DRAFT_TOO_LARGE') return (err && err.message) || '草稿内容过长，请精简后再保存'
  return (err && err.message) || '保存失败'
}

function promptContinueOrRestart() {
  return new Promise((resolve) => {
    wx.showModal({
      title: '发现编辑草稿',
      content: '上次离开时有一份编辑草稿。继续上次编辑会用草稿覆盖当前屏幕上的优化稿；重新开始则使用本次 AI 优化结果。',
      confirmText: '继续编辑',
      cancelText: '重新开始',
      success: (res) => resolve(res.confirm ? 'continue' : 'restart'),
      fail: () => resolve('restart'),
    })
  })
}

function formatVersionItem(item, index) {
  const version = Number(item && item.version)
  const fileId = item && item.fileId ? String(item.fileId) : ''
  return {
    key: `v${Number.isInteger(version) ? version : index + 1}`,
    versionLabel: Number.isInteger(version) ? `v${version}` : `版本 ${index + 1}`,
    confirmedAtLabel: formatDateTime(item && item.confirmedAt),
    factsLabel: item && item.factsConfirmedAt ? '导出时已附带事实核对时间' : '未见事实核对时间',
    fileId,
    canOpen: Boolean(fileId),
    openHint: fileId ? '' : '服务端未返回 fileId，没有其它 signedUrl 字段可打开',
  }
}

function formatVersions(res) {
  const items = res && Array.isArray(res.items) ? res.items : []
  const latest = res && res.latestVersion != null ? res.latestVersion : null
  return {
    latestLabel: latest == null ? '' : `当前最新 v${latest}`,
    items: items.map(formatVersionItem),
    empty: items.length === 0,
  }
}

function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return '未知'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatExpiry(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return '以服务端签名链接为准'
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function fileIdFromPrintUrl(url) {
  const match = /\/files\/([^/?]+)\/content(?:\?|$)/.exec(String(url || ''))
  return match ? decodeURIComponent(match[1]) : ''
}

function toExportResult(res, format, formats, absoluteUrl) {
  const definition = (formats || []).find((item) => item.key === format) || {}
  return {
    fileId: res.fileId,
    printFileId: fileIdFromPrintUrl(res.printFileUrl),
    filename: res.filename,
    mimeType: definition.mimeType || '',
    formatLabel: definition.label || String(format || '').toUpperCase(),
    sizeLabel: formatBytes(res.sizeBytes),
    pageLabel: Number(res.pageCount) > 0 ? `${res.pageCount} 页` : '非分页格式',
    expiresLabel: formatExpiry(res.expiresAt),
    expiresMs: res.expiresAt ? new Date(res.expiresAt).getTime() : 0,
    pdfUrl: absoluteUrl(res.printFileUrl),
    printFileUrl: res.printFileUrl,
    savedToDocuments: true,
  }
}

function restoreDraft(api, taskId) {
  return api.getResumeDraft(taskId).then((res) => {
    const extras = pickDraftExtras(res)
    if (!hasUsableDraft(res)) {
      return { resume: null, kind: 'idle', text: '', writable: true, extras }
    }
    return promptContinueOrRestart().then((choice) => ({
      resume: choice === 'continue' ? clone(res.draft.resume) : null,
      kind: 'idle',
      text: '',
      writable: true,
      extras,
    }))
  }).catch((err) => {
    const explained = explainLoadError(err)
    return { resume: null, kind: explained.kind, text: explained.text, writable: explained.kind !== 'unbound', extras: {} }
  })
}

function createAutosave(hooks) {
  let timer = null
  let seq = 0

  function cancel() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  function send() {
    if (!hooks.isLoggedIn()) {
      hooks.onStatus('guest')
      return Promise.resolve()
    }
    const taskId = hooks.getTaskId()
    const payload = hooks.getPayload()
    if (!taskId || !payload) return Promise.resolve()
    const my = seq + 1
    seq = my
    hooks.onStatus('saving')
    return hooks.put(taskId, payload).then((res) => {
      if (my !== seq) return
      if (typeof hooks.onResponse === 'function') hooks.onResponse(res)
      hooks.onStatus('saved', res && res.updatedAt)
    }, (err) => {
      if (my !== seq) return
      hooks.onStatus('failed', null, err)
    })
  }

  function schedule() {
    if (!hooks.isLoggedIn()) {
      hooks.onStatus('guest')
      return
    }
    cancel()
    timer = setTimeout(() => {
      timer = null
      send()
    }, DEBOUNCE_MS)
  }

  return { schedule, flush: () => { cancel(); return send() }, cancel }
}

module.exports = {
  DEBOUNCE_MS,
  clone,
  resumeToEditor,
  editorToResume,
  applyInput,
  buildDraftPutBody,
  pickDraftExtras,
  mergeDraftExtras,
  statusText,
  hasUsableDraft,
  explainLoadError,
  explainSaveError,
  promptContinueOrRestart,
  formatVersions,
  restoreDraft,
  fileIdFromPrintUrl,
  toExportResult,
  createAutosave,
}
