import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '../..')
const realRequire = createRequire(import.meta.url)
function load(file, mocks = {}, globals = {}) {
  const source = readFileSync(resolve(root, file), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}
  vm.runInNewContext(output, { exports, require: (id) => id in mocks ? mocks[id] : realRequire(id), setTimeout, clearTimeout, URLSearchParams, ...globals })
  return exports
}
const plain = (value) => JSON.parse(JSON.stringify(value))
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

// Minimal hook scheduler: executes the production hook, effects and cleanup without a browser.
function hooks() {
  const slots = []; let index = 0, dirty = false, mounted = true, renderFn, value, effects = []
  const changed = (a, b) => !a || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]))
  const react = {
    useState(initial) {
      const i = index++
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, (next) => { const v = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(v, slots[i].value)) { slots[i].value = v; dirty = true } }]
    },
    useRef(initial) { const i = index++; return (slots[i] ??= { current: initial }) },
    useCallback(fn, deps) { const i = index++; if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { deps, fn }; return slots[i].fn },
    useEffect(fn, deps) {
      const i = index++
      if (!slots[i] || changed(slots[i].deps, deps)) {
        const previous = slots[i]; slots[i] = { deps }
        effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn() })
      }
    },
  }
  const render = (fn = renderFn) => {
    renderFn = fn; index = 0; dirty = false; value = fn()
    const pending = effects; effects = []; pending.forEach((effect) => effect())
    return value
  }
  return { react, render, get value() { return value },
    async flush() { for (let i = 0; i < 12; i++) { await Promise.resolve(); if (mounted && dirty) render() } return value },
    unmount() { mounted = false; slots.forEach((slot) => { slot?.cleanup?.(); if (slot) slot.cleanup = undefined }) },
  }
}

const nav = load('src/pages/profile/me/aiRecordNavigation.ts')
test('six result types carry the selected task; expired/failed/processing cannot open', () => {
  for (const kind of ['parse', 'optimize', 'generate', 'job_fit', 'career_plan', 'self_assessment']) {
    const item = { kind, taskId: 'A/&?', status: 'completed', expiresAt: '2099-01-01' }
    assert.equal(new URL(nav.aiRecordPath(item), 'http://test').searchParams.get('taskId'), item.taskId)
    if (kind === 'optimize') assert.equal(new URL(nav.aiRecordPath(item), 'http://test').searchParams.get('saved'), '1')
    for (const patch of [{ expiresAt: null }, { expiresAt: 'bad-date' }, { expiresAt: '2000-01-01' }, { status: 'failed' }, { status: 'processing' }, { taskId: '' }]) {
      assert.equal(nav.aiRecordPath({ ...item, ...patch }), null)
      assert.ok(nav.recordUnavailableReason({ ...item, ...patch }))
    }
  }
})

test('assessment deep link A discards cached B, cached A body is revalidated, anonymous credentials never cross tasks', () => {
  const { sessionForAssessmentRecord } = load('src/pages/resume/selfAssessmentSession.ts', { '@ai-job-print/shared': { SELF_ASSESSMENT_QUESTIONS_V1: { dimensions: [] } } })
  const saved = { taskId: 'B', accessToken: 'secret-B', answers: { one: 1 }, consent: { nonSensitive: true }, result: { taskId: 'B' } }
  const a = sessionForAssessmentRecord('A', saved)
  assert.equal(a.taskId, 'A'); assert.equal(a.result, undefined); assert.equal(a.accessToken, undefined)
  assert.deepEqual(plain(a.answers), {})
  const b = sessionForAssessmentRecord('B', saved)
  assert.equal(b.accessToken, 'secret-B'); assert.equal(b.result, undefined)
  assert.equal(sessionForAssessmentRecord(null, saved), saved)
})

test('deletion clears only the matching resume and assessment references', () => {
  let resume = { taskId: 'A' }, assessment = { taskId: 'B' }
  const { clearResumeReferences } = load('src/pages/resume/clearResumeReferences.ts', {
    './aiResumeSession': { readAiResumeSession: () => resume, clearAiResumeSession: () => { resume = null } },
    './selfAssessmentSession': { loadSession: () => assessment, clearSession: () => { assessment = {} } },
  })
  clearResumeReferences('A'); assert.equal(resume, null); assert.equal(assessment.taskId, 'B')
  clearResumeReferences('B'); assert.deepEqual(assessment, {})
})

test('pagination passes cursor, deduplicates, guards double taps, preserves first page on failure and retries', async () => {
  const h = hooks(), requests = []
  const fetchPage = (cursor) => { const request = deferred(); requests.push({ cursor, ...request }); return request.promise }
  const { useMemberCursorPage } = load('src/pages/profile/me/useMemberCursorPage.ts', { react: h.react })
  h.render(() => useMemberCursorPage({ enabled: true, identityKey: 'member-A', fetchPage }))
  requests[0].resolve({ items: [{ id: '1' }], nextCursor: '1', total: 3 }); await h.flush()
  h.value.loadMore(); h.value.loadMore(); assert.equal(requests.length, 2); assert.equal(requests[1].cursor, '1')
  requests[1].reject(Error('offline')); await h.flush()
  assert.equal(h.value.items.length, 1); assert.equal(h.value.loadMoreError, true); assert.equal(h.value.nextCursor, '1')
  h.value.loadMore(); requests[2].resolve({ items: [{ id: '1' }, { id: '2' }], nextCursor: null, total: 2 }); await h.flush()
  assert.deepEqual(plain(h.value.items), [{ id: '1' }, { id: '2' }]); assert.equal(h.value.nextCursor, null)
  h.unmount()
})

test('filter/reset, logout and unmount reject late responses; sources keep independent cursors', async () => {
  const h = hooks(), requests = []
  const fetchPage = (cursor) => { const r = deferred(); requests.push({ cursor, ...r }); return r.promise }
  const { useMemberCursorPage } = load('src/pages/profile/me/useMemberCursorPage.ts', { react: h.react })
  let identityKey = 'A', reloadKey = 'all', enabled = true
  h.render(() => useMemberCursorPage({ enabled, identityKey, reloadKey, fetchPage }))
  requests[0].resolve({ items: [{ id: 'A' }], nextCursor: 'A' }); await h.flush()
  h.value.loadMore(); reloadKey = 'unread'; h.render(); await h.flush()
  assert.equal(requests[2].cursor, undefined); assert.equal(h.value.nextCursor, null)
  requests[1].resolve({ items: [{ id: 'old-filter' }], nextCursor: 'old' }); await h.flush()
  assert.equal(h.value.items.length, 0)
  requests[2].resolve({ items: [], nextCursor: 'filtered-page' }); await h.flush()
  assert.equal(h.value.nextCursor, 'filtered-page') // empty visible page must still expose Load More
  h.value.loadMore(); identityKey = 'B'; h.render(); await h.flush()
  requests[3].resolve({ items: [{ id: 'A-late' }], nextCursor: null }); await h.flush()
  assert.equal(h.value.items.length, 0)
  enabled = false; h.render(); await h.flush()
  requests[4].resolve({ items: [{ id: 'B-late' }], nextCursor: null }); await h.flush()
  assert.equal(h.value.items.length, 0); assert.equal(h.value.total, 0)
  enabled = true; h.render(); h.unmount(); requests[5].resolve({ items: [{ id: 'unmounted' }], nextCursor: null }); await h.flush()
  assert.equal(h.value.items.length, 0)

  const multi = hooks()
  const hook = load('src/pages/profile/me/useMemberCursorPage.ts', { react: multi.react }).useMemberCursorPage
  const a = async (cursor) => ({ items: [{ id: cursor ?? 'a' }], nextCursor: cursor ? null : 'a-next' })
  const b = async () => ({ items: [{ id: 'b' }], nextCursor: 'b-next' })
  multi.render(() => [hook({ enabled: true, identityKey: 'A', fetchPage: a }), hook({ enabled: true, identityKey: 'A', fetchPage: b })])
  await multi.flush(); multi.value[0].loadMore(); await multi.flush()
  assert.equal(multi.value[0].nextCursor, null); assert.equal(multi.value[1].nextCursor, 'b-next'); multi.unmount()
})

function optimizeHarness() {
  const h = hooks(), request = deferred(), state = {}, locks = { active: 0 }
  const { useOptimizeLoad, OPTIMIZE_LOAD_LIMIT_MS } = load('src/pages/resume/components/resume-deliver/useOptimizeLoad.ts', {
    react: h.react,
    '../../resumeUserCopy': load('src/pages/resume/resumeUserCopy.ts'),
    '../../../../services/api': { getResumeOptimize: (_task, _access, existingOnly) => { state.ExistingOnly = existingOnly; return request.promise } },
    '../../../../services/api/jobMaterials': { getResumeTemplates: async () => [] },
    '../../../../services/api/userErrorMessage': { errorCodeOf: (error) => error.code ?? 'FAILED', userMessageOf: (_e, text) => text },
    '../../../../ai/aiOutage': { isAiOutage: () => false }, './fixtures': {},
    '../../../../contexts/KioskBusyContext': { useBusyLock: (active) => h.react.useEffect(() => { if (active) { locks.active++; return () => { locks.active-- } } }, [active]) },
  })
  const opts = { taskId: 'A', access: {}, consentReady: true, consentChecking: false, consentNeedsPrompt: false, retryNonce: 0 }
  for (const name of ['Loading', 'FailKind', 'FailMsg', 'Modules', 'OptimizedResume', 'TemplatesError', 'ResumeTemplates', 'SelectedTemplateId']) opts[`set${name}`] = (value) => { state[name] = typeof value === 'function' ? value(state[name]) : value }
  h.render(() => useOptimizeLoad(opts))
  return { h, request, state, locks, opts, limit: OPTIMIZE_LOAD_LIMIT_MS }
}

test('resume failure reasons preserve user messages and shared rate-limit copy verbatim', () => {
  const { resumeUserReason } = load('src/pages/resume/resumeUserCopy.ts')
  const fallback = '这次没有生成优化建议，请稍后再试。'
  for (const reason of ['文字识别失败，请确保文件清晰', '当前使用的人较多，请稍后再试', '文件已清理，请重新上传', '今日配额已用完', 'AI 服务繁忙，请稍后再试', '请上传清晰的 PDF 或 JPG 文件']) {
    assert.equal(resumeUserReason(reason, fallback), reason)
  }
  // 执行既有 userMessageOf：HTTP 429 的统一提示不能再被结果页改成“额度用完”。
  class ApiHttpError extends Error {}
  const { userMessageOf } = load('src/services/api/userErrorMessage.ts', { './httpAdapter': { ApiHttpError } })
  const error = Object.assign(new ApiHttpError('今日次数已用完'), { code: 'AI_PUBLIC_QUOTA_EXCEEDED', status: 429 })
  assert.equal(resumeUserReason(userMessageOf(error, fallback), fallback), '当前使用的人较多，请稍后再试')
})

test('resume failure reasons fall back exactly for empty, technical or injected text', () => {
  const { resumeUserReason } = load('src/pages/resume/resumeUserCopy.ts')
  const fallback = '这次没有生成优化建议，请稍后再试。'
  for (const reason of [undefined, null, '', '   ', '服务端字段 pending / uploaded / 内部文件号 abc', '<script>alert(1)</script>', '未验收：能力探测失败', 'unknown provider detail', '服务端超时 trace-id:abc', '后端会话已过期，请重新上传', '接口落库失败，链路无回执', '处理中：pending', '上传状态 uploaded', '解析失败 AI_PROVIDER_ERROR', 'HTTP 500：处理失败']) {
    assert.equal(resumeUserReason(reason, fallback), fallback)
  }
  assert.doesNotMatch(resumeUserReason('服务端超时 trace-id:abc', fallback), /服务端|trace-id|abc/)
})

test('optimization preserves user failure reasons and filters technical reasons before choosing an exit', async () => {
  for (const reason of ['文字识别失败，请确保文件清晰', '当前使用的人较多，请稍后再试', '文件已清理，请重新上传', '后端会话已过期，请重新上传']) {
    const box = optimizeHarness(); await box.h.flush()
    box.request.resolve({ status: 'failed', failReason: reason }); await box.h.flush()
    const technical = reason.startsWith('后端')
    assert.equal(box.state.FailMsg, technical ? '本次没有生成优化建议，可重试或返回重新解析' : reason)
    assert.equal(box.state.FailKind, !technical && reason.includes('重新上传') ? 'expired' : 'retry')
    assert.equal(box.locks.active, 0); box.h.unmount()
  }
})

test('USB files render as named buttons and retain size, MIME, purpose and busy contracts', async () => {
  const h = hooks(), upload = deferred(), imported = [], requests = [], busy = []
  const files = [
    { safeId: 'pdf', filename: 'U盘简历.pdf', sizeBytes: 2048 },
    { safeId: 'image', filename: 'my_pdf_resume.jpg', sizeBytes: 2048 },
    { safeId: 'oversize', filename: 'too-large.pdf', sizeBytes: 11 * 1024 * 1024 },
  ]
  const { ResumeUsbImportPanel } = load('src/pages/resume/components/ResumeUsbImportPanel.tsx', {
    react: h.react,
    '../../../services/api/userErrorMessage': { userMessageOf: (_err, fallback) => fallback },
    '../../../auth/useAuth': { useAuth: () => ({ getToken: () => 'test-member-token' }) },
    '@ai-job-print/ui': { Button: 'button', KioskStatePanel: 'aside' },
    'lucide-react': { FileTextIcon: 'svg', LoaderIcon: 'svg', RefreshCwIcon: 'svg', UsbIcon: 'svg' },
    '../../../services/files/usbImportApi': {
      isUsbImportConfigured: () => true,
      getUsbStatus: async () => ({ present: true, driveLabel: 'TEST-USB' }),
      listUsbFiles: async () => ({ files }),
      uploadUsbFile: (...args) => { requests.push(args); return upload.promise },
    },
    // W-125：面板先过后台能力闸门；这份单测只管文件列表与导入契约，闸门按已放行处理。
    '../../../hooks/useUsbImportGate': { useUsbImportGate: () => ({ state: 'allowed', note: null, retry: () => {} }) },
  }, { window: { setTimeout: () => 1, clearTimeout: () => {} } })
  const props = { onUploaded: (file) => imported.push(file), onBusyChange: (value) => busy.push(value) }
  const nodes = (node) => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.props?.children)] : []
  const text = (node) => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' ? node : ''
  const rows = () => nodes(h.value).filter((node) => node.type === 'button' && node.props.className?.includes('resume-usb-panel__row'))
  h.render(() => ResumeUsbImportPanel(props)); await h.flush()
  assert.equal(rows().length, 2)
  for (const file of files.slice(0, 2)) {
    const row = rows().find((node) => text(node).includes(file.filename))
    assert.ok(row, `named file button: ${file.filename}`)
    assert.equal(row.props.type, 'button'); assert.equal(row.props.disabled, false)
  }
  assert.equal(nodes(h.value).some((node) => node.type === 'details'), false)
  assert.equal(text(h.value).includes('too-large.pdf'), false)
  rows()[1].props.onClick(); await h.flush()
  assert.deepEqual(requests, [['image', 'resume_upload', 'test-member-token']])
  assert.ok(rows().every((node) => node.props.disabled)); assert.equal(busy.at(-1), true)
  upload.resolve({ filename: 'my_pdf_resume.jpg', sizeBytes: 2048, mimeType: 'image/jpeg', fileId: 'file-image', fileUrl: '/fixture.jpg' }); await h.flush()
  assert.deepEqual(plain(imported), [{ name: 'my_pdf_resume.jpg', size: '2 KB', format: 'jpg', fileId: 'file-image', fileUrl: '/fixture.jpg', mimeType: 'image/jpeg', channel: 'usb' }])
  assert.equal(busy.at(-1), false); h.unmount()
})

test('optimize holds a lock through 95s, succeeds before 100s, releases on failure and unmount', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const outcome of ['success', 'failure', 'unmount']) {
    const box = optimizeHarness(); await box.h.flush()
    assert.equal(box.locks.active, 1)
    t.mock.timers.tick(95_000); await box.h.flush(); assert.equal(box.locks.active, 1)
    if (outcome === 'success') box.request.resolve({ status: 'completed', modules: [], optimizedResume: { name: 'A' } })
    if (outcome === 'failure') box.request.reject(Error('failed'))
    if (outcome === 'unmount') { box.h.unmount(); box.request.resolve({ status: 'completed', optimizedResume: { name: 'late' } }) }
    await box.h.flush(); assert.equal(box.locks.active, 0)
    if (outcome === 'unmount') assert.equal(box.state.OptimizedResume, null)
    else box.h.unmount()
  }
})

test('optimize bounded timeout rejects a late response; awaiting consent does not hold lock', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const box = optimizeHarness(); await box.h.flush()
  t.mock.timers.tick(box.limit); await box.h.flush()
  assert.equal(box.locks.active, 0); assert.equal(box.state.Loading, false)
  box.request.resolve({ status: 'completed', optimizedResume: { name: 'too late' } }); await box.h.flush()
  assert.equal(box.state.OptimizedResume, null)
  box.opts.existingOnly = true; box.h.render(); await box.h.flush(); assert.equal(box.state.ExistingOnly, true)
  box.opts.consentReady = false; box.h.render(); await box.h.flush(); assert.equal(box.locks.active, 0)
  box.h.unmount()
})


test('deleted saved optimization shows a usable reason and releases the lock', async () => {
  const box = optimizeHarness(); await box.h.flush()
  box.request.reject(Object.assign(Error('not found'), { code: 'AI_TASK_NOT_FOUND' })); await box.h.flush()
  assert.equal(box.locks.active, 0); assert.match(box.state.FailMsg, /已删除.*保存期限.*当前账号/)
  assert.equal(box.state.OptimizedResume, null); box.h.unmount()
})
