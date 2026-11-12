/**
 * 包 3 的页面行为：没登录不选文件、游客文件找不到后改重新选择、
 * 我的简历按 kind 跳转、优化失败两种回包按错误码说、
 * AI 结果的保存期限。由 verify:page-lifecycle 拉起。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MINIAPP, rel), 'utf8')
const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))

let ACTIVE_WX = null
Object.defineProperty(globalThis, 'wx', { get: () => ACTIVE_WX, configurable: true })

function createWx() {
  const storage = new Map()
  const calls = { chooseMessageFile: 0, chooseMedia: 0, modal: [], nav: [], redirect: [] }
  const randomSeed = { n: 0 }
  const wx = {
    calls,
    storage,
    getStorageSync: (key) => (storage.has(key) ? storage.get(key) : ''),
    setStorageSync: (key, value) => { storage.set(key, value) },
    removeStorageSync: (key) => { storage.delete(key) },
    showToast() {},
    showLoading() {},
    hideLoading() {},
    showModal(opts) {
      calls.modal.push(opts)
      if (opts && opts.success) opts.success({ confirm: false })
    },
    navigateTo(opts) { calls.nav.push(opts && opts.url); if (opts && opts.success) opts.success() },
    redirectTo(opts) { calls.redirect.push(opts && opts.url) },
    navigateBack(opts) { if (opts && opts.fail) opts.fail({ errMsg: 'no page' }) },
    switchTab() {},
    chooseMessageFile() { calls.chooseMessageFile += 1 },
    chooseMedia() { calls.chooseMedia += 1 },
    getRandomValues(opts) {
      const length = (opts && opts.length) || 16
      randomSeed.n += 1
      const bytes = new Uint8Array(length)
      for (let i = 0; i < length; i += 1) bytes[i] = (randomSeed.n * 37 + i * 11) & 0xff
      if (opts && opts.success) opts.success({ randomValues: bytes.buffer })
    },
  }
  return wx
}

function createAuth(id) {
  const user = id ? { id } : null
  return {
    isLoggedIn: () => !!user,
    getUser: () => user,
    getToken: () => (user ? 'tok' : ''),
    sessionGeneration: () => 1,
    isSameSession: () => true,
  }
}

function makePage(rel, { wx, auth, api, modules }) {
  ACTIVE_WX = wx
  return instantiate(loadPageDefinition(rel, {
    wx,
    modules: Object.assign({ api: api || {}, auth: auth || createAuth(null) }, modules || {}),
  }))
}

test('没登录点上传或拍照：先出登录提示，不调选文件', async () => {
  const wx = createWx()
  const page = makePage('pages/resume-upload/resume-upload.js', {
    wx,
    auth: createAuth(null),
    api: { getDocumentConversionCapabilities: () => Promise.resolve({ wordToPdf: false }) },
  })
  page.onLoad()
  page.tapUploadFile()
  assert.equal(wx.calls.chooseMessageFile, 0, '没登录不选聊天文件')
  assert.equal(wx.calls.modal.length, 1)
  assert.match(wx.calls.modal[0].title, /先登录再用 AI/)
  assert.match(wx.calls.modal[0].content, /登录后回到这一页继续/)
  assert.equal(wx.calls.nav.length, 0, '点「稍后」不离开')
  await flush()
  page.tapCamera()
  assert.equal(wx.calls.chooseMedia, 0, '没登录不调拍照')
  assert.equal(wx.calls.modal.length, 2)
  assert.match(wx.calls.modal[1].title, /先登录再用 AI/)
})

test('已登录才调选文件', () => {
  const wx = createWx()
  const page = makePage('pages/resume-upload/resume-upload.js', {
    wx,
    auth: createAuth('member-1'),
    api: { getDocumentConversionCapabilities: () => Promise.resolve({ wordToPdf: false }) },
  })
  page.onLoad()
  page.tapUploadFile()
  page.tapCamera()
  assert.equal(wx.calls.modal.length, 0)
  assert.equal(wx.calls.chooseMessageFile, 1)
  assert.equal(wx.calls.chooseMedia, 1)
})

test('游客文件登录后找不到：重试不再提交，主按钮改为重新选择文件', async () => {
  const wx = createWx()
  let posts = 0
  const missing = new Error('文件不存在或已被清理')
  missing.statusCode = 404
  missing.code = 'FILE_NOT_FOUND'
  const page = makePage('pages/resume-parse/resume-parse.js', {
    wx,
    auth: createAuth('member-1'),
    api: { parseResume: () => { posts += 1; return Promise.reject(missing) } },
  })
  page.onLoad({ fileId: 'guest-file', fileName: 'a.pdf', fileFormat: 'pdf' })
  await flush()
  await flush()
  assert.equal(posts, 1)
  assert.equal(page.data.phase, 'failed')
  assert.equal(page.data.fileMissing, true)
  page.retry()
  await flush()
  assert.equal(posts, 1, '重试不再原样重发同一份文件')
  const wxml = read('pages/resume-parse/resume-parse.wxml')
  assert.match(wxml, /wx:elif="\{\{fileMissing\}\}"[\s\S]*重新选择文件/)
  assert.match(wxml, /fileMissing\}\}" class="btn primary tap flex-1-5" bindtap="toUpload">重新选择文件/)

  const byText = new Error('找不到文件')
  byText.statusCode = 400
  byText.code = 'SOME_OTHER'
  let posts2 = 0
  const page2 = makePage('pages/resume-parse/resume-parse.js', {
    wx: createWx(),
    auth: createAuth('member-1'),
    api: { parseResume: () => { posts2 += 1; return Promise.reject(byText) } },
  })
  page2.onLoad({ fileId: 'guest-file-2', fileFormat: 'pdf' })
  await flush()
  await flush()
  assert.equal(page2.data.fileMissing, true)
  page2.retry()
  assert.equal(posts2, 1)
})

test('我的简历：解析进诊断，生成进生成结果', async () => {
  const wx = createWx()
  const page = makePage('pages/resumes/resumes.js', {
    wx,
    auth: createAuth('member-1'),
    api: {
      getMyResumes: () => Promise.resolve([
        { id: 'p1', taskId: 'task-parse', kind: 'parse', status: 'completed', createdAt: '2026-03-01T12:00:00.000Z', expiresAt: '2026-03-02T12:00:00.000Z' },
        { id: 'g1', taskId: 'task-gen', kind: 'generate', status: 'completed', createdAt: '2026-03-01T12:00:00.000Z', expiresAt: '2026-03-01T12:00:00.000Z' },
      ]),
    },
  })
  page.onShow()
  await flush()
  await flush()
  assert.equal(page.data.resumes[0].kind, 'parse')
  assert.equal(page.data.resumes[1].kind, 'generate')
  assert.equal(page.data.resumes[0].viewUntil, '3 月 2 日前可查看')
  assert.equal(page.data.resumes[1].viewUntil, '3 月 1 日前可查看')
  page.openResume({ currentTarget: { dataset: { taskId: 'task-parse', kind: 'parse' } } })
  page.openResume({ currentTarget: { dataset: { taskId: 'task-gen', kind: 'generate' } } })
  assert.equal(wx.calls.nav[0], '/pages/resume-diagnose/resume-diagnose?taskId=task-parse')
  assert.equal(wx.calls.nav[1], '/pages/resume-build/resume-build?taskId=task-gen')
  const wxml = read('pages/resumes/resumes.wxml')
  assert.match(wxml, /查看诊断/)
  assert.match(wxml, /查看生成结果/)
  assert.doesNotMatch(wxml, /点击简历可查看诊断报告/)
})

test('优化失败：200 失败回包和请求抛错按同一错误码说，不把非法输出当成事实核查', async () => {
  const { SUPPORT_HINT } = requireMiniapp('../utils/user-error.js')
  const unavailable = `AI 优化暂时用不了。${SUPPORT_HINT}`
  const invalid = 'AI 优化没有生成可用结果，请稍后重试。'
  const baseApi = {
    getResumeExportPricing: () => Promise.resolve({ mode: 'free', unitCents: 0 }),
    getMyBenefits: () => Promise.resolve([]),
  }
  async function open(taskId, getResumeOptimize) {
    const page = makePage('pages/resume-optimize/resume-optimize.js', {
      wx: createWx(),
      auth: createAuth('member-1'),
      api: Object.assign({}, baseApi, { getResumeOptimize }),
    })
    page.onLoad({ taskId })
    await flush()
    await flush()
    return page
  }

  const factLike = await open('opt-1', () => Promise.resolve({
    taskId: 'opt-1',
    status: 'failed',
    failCode: 'AI_OPTIMIZE_INVALID_OUTPUT',
    failReason: '优化结果包含无法从原文确认的信息，系统已拦截，请重新生成或检查原文',
  }))
  assert.equal(factLike.data.phase, 'failed')
  assert.equal(factLike.data.failMsg, invalid)
  assert.equal(factLike.data.factBlocked, undefined)
  assert.doesNotMatch(factLike.data.failMsg, /真实性校验|无法从原文确认/)

  const notJson = await open('opt-json', () => Promise.resolve({
    taskId: 'opt-json',
    status: 'failed',
    failCode: 'AI_OPTIMIZE_INVALID_OUTPUT',
    failReason: '不是合法 JSON',
  }))
  assert.equal(notJson.data.failMsg, invalid, '非法 JSON 与事实不符是同一个码，不说真实性校验')
  assert.doesNotMatch(notJson.data.failMsg, /真实性校验|不是合法 JSON/)

  const thrownInvalid = await open('opt-throw', () => Promise.reject(Object.assign(new Error('不是合法 JSON'), { code: 'AI_OPTIMIZE_INVALID_OUTPUT' })))
  assert.equal(thrownInvalid.data.failMsg, notJson.data.failMsg, '抛错和 200 失败回包是同一句')

  const failedBody = await open('opt-3', () => Promise.resolve({
    taskId: 'opt-3',
    status: 'failed',
    failCode: 'AI_PROVIDER_NOT_CONFIGURED',
    failReason: 'AI 简历优化模型尚未配置，请联系管理员后重试',
  }))
  assert.equal(failedBody.data.failMsg, unavailable)
  assert.match(failedBody.data.failMsg, /服务电话/)
  assert.doesNotMatch(failedBody.data.failMsg, /管理员|手动修改/)

  const thrown = await open('opt-4', () => Promise.reject(Object.assign(
    new Error('AI 简历优化模型尚未配置或未启用，请联系管理员'),
    { code: 'AI_PROVIDER_NOT_CONFIGURED' },
  )))
  assert.equal(thrown.data.failMsg, failedBody.data.failMsg, '模型没配的两种回包是同一句')

  const unavailableCode = await open('opt-unavail', () => Promise.reject(Object.assign(
    new Error('AI 优化服务暂时不可用，请稍后重试'),
    { code: 'AI_OPTIMIZE_UNAVAILABLE' },
  )))
  assert.equal(unavailableCode.data.failMsg, 'AI 优化服务暂时不可用，请稍后重试。')
  assert.match(unavailableCode.data.failMsg, /暂时不可用/)
  assert.doesNotMatch(unavailableCode.data.failMsg, /真实性校验/)

  const unknownCode = await open('opt-unknown', () => Promise.resolve({
    taskId: 'opt-unknown',
    status: 'failed',
    failCode: 'SOME_NEW_CODE',
    failReason: '请找工作人员，或联系管理员',
  }))
  assert.match(unknownCode.data.failMsg, /服务电话/)
  assert.doesNotMatch(unknownCode.data.failMsg, /工作人员|管理员/)

  const reupload = await open('opt-5', () => Promise.resolve({
    taskId: 'opt-5',
    status: 'failed',
    failReason: '简历原文已清理，请重新上传',
  }))
  assert.equal(reupload.data.needReupload, true)
  assert.match(reupload.data.failMsg, /重新上传/)

  const wxml = read('pages/resume-optimize/resume-optimize.wxml')
  assert.doesNotMatch(wxml, /真实性校验/)
  assert.doesNotMatch(wxml, /手动修改/)
  assert.match(wxml, /bindtap="tapRetry">重试/)
  assert.match(wxml, /bindtap="goBack">返回/)
})

test('AI 服务记录：有到期日的逐条写，面试记录不编日期，列表说明保存多久', async () => {
  const wx = createWx()
  const page = makePage('pages/ai-records/ai-records.js', {
    wx,
    auth: createAuth('member-1'),
    api: {
      getMyAiRecords: () => Promise.resolve([
        { id: 'r1', taskId: 't1', kind: 'parse', status: 'completed', createdAt: '2026-03-01T12:00:00.000Z', expiresAt: '2026-03-02T12:00:00.000Z' },
      ]),
      getMyMockInterviews: () => Promise.resolve([
        { sessionId: 's1', position: '行政助理', hasReport: true, createdAt: '2026-03-01T02:00:00+08:00' },
      ]),
    },
  })
  page.onShow()
  await flush()
  await flush()
  const items = []
  for (const g of page.data.groups) for (const item of g.items) items.push(item)
  const ai = items.find((item) => item.kind === 'parse')
  const interview = items.find((item) => item.kind === 'mock_interview')
  assert.ok(ai, '解析记录在列表里')
  assert.equal(ai.viewUntil, '3 月 2 日前可查看')
  assert.ok(interview, '模拟面试记录在列表里')
  assert.equal(interview.viewUntil, '', '面试列表没有到期字段，不编一个日期')
  const wxml = read('pages/ai-records/ai-records.wxml')
  assert.match(wxml, /AI 做出的结果默认保存 24 小时，模拟面试记录保存 7 天，要长期留请导出或存进我的文档。/)
})

test('自我探索：次数用完说明天 0 点恢复', () => {
  const page = makePage('pages/self-explore/self-explore.js', {
    wx: createWx(),
    auth: createAuth('member-1'),
    api: {},
  })
  const view = page._toResultView({
    status: 'completed',
    interpretationAvailable: false,
    aiUnavailableReason: 'AI_QUOTA_EXHAUSTED',
    dimensions: [],
  })
  assert.equal(view.aiReasonText, '今天的 AI 次数用完了，明天 0 点恢复。')
  assert.doesNotMatch(view.aiReasonText, /购买|套餐|权益|没有开放/)
})

test('到期日空值、空串、非法日期不显示 1970，问答要点走同一条', async () => {
  const qa = requireMiniapp('../pages/ai-records/qa-records.js')
  const samples = [
    { id: 'n', expiresAt: null, viewUntil: '' },
    { id: 'e', expiresAt: '', viewUntil: '' },
    { id: 'u', viewUntil: '' },
    { id: 'b', expiresAt: 'not-a-date', viewUntil: '' },
    { id: 'ok', expiresAt: '2026-04-02T12:00:00.000Z', viewUntil: '4 月 2 日前可查看' },
  ]
  const page = makePage('pages/resumes/resumes.js', {
    wx: createWx(),
    auth: createAuth('member-1'),
    api: {
      getMyResumes: () => Promise.resolve(samples.map((row) => ({
        id: row.id,
        taskId: `task-${row.id}`,
        kind: 'parse',
        status: 'completed',
        createdAt: '2026-04-01T12:00:00.000Z',
        expiresAt: row.expiresAt,
      }))),
    },
  })
  page.onShow()
  await flush()
  await flush()
  for (const row of samples) {
    const item = page.data.resumes.find((entry) => entry.id === row.id)
    assert.ok(item, row.id)
    assert.equal(item.viewUntil, row.viewUntil, `我的简历 ${row.id}`)
  }

  const records = makePage('pages/ai-records/ai-records.js', {
    wx: createWx(),
    auth: createAuth('member-1'),
    api: {
      getMyAiRecords: () => Promise.resolve(samples.map((row) => ({
        id: row.id,
        taskId: `task-${row.id}`,
        kind: 'parse',
        status: 'completed',
        createdAt: '2026-04-01T12:00:00.000Z',
        expiresAt: row.expiresAt,
      }))),
      getMyMockInterviews: () => Promise.resolve([]),
    },
  })
  records.onShow()
  await flush()
  await flush()
  const listed = []
  for (const group of records.data.groups) for (const item of group.items) listed.push(item)
  for (const row of samples) {
    const item = listed.find((entry) => entry.id === row.id)
    assert.ok(item, `AI 记录 ${row.id}`)
    assert.equal(item.viewUntil, row.viewUntil, `AI 记录 ${row.id}`)
  }

  for (const row of samples) {
    const mapped = qa.mapQaRecord({
      id: `q-${row.id}`,
      createdAt: '2026-04-01T12:00:00.000Z',
      expiresAt: row.expiresAt,
    })
    assert.equal(mapped.day, '4月1日', '创建日仍按原分组，不因到期空值改掉')
    if (row.viewUntil) assert.equal(mapped.statusLabel, '保存至 4月2日')
    else assert.equal(mapped.statusLabel, '问答要点', `问答要点 ${row.id} 不编 1970`)
  }
})

test('登录后重新选择文件再上传：新文件继续解析，不撞旧解析标识', async () => {
  const wx = createWx()
  const headersSeen = []
  const missing = new Error('文件不存在或已被清理')
  missing.statusCode = 404
  missing.code = 'FILE_NOT_FOUND'
  let uploads = 0
  const api = {
    parseResume: (payload, headers) => {
      headersSeen.push({ fileId: payload.fileId, intent: headers['x-resume-parse-intent'] })
      if (payload.fileId === 'guest-file') return Promise.reject(missing)
      return Promise.resolve({
        taskId: 'task-new',
        status: 'completed',
        accessToken: 'tok',
        fileId: payload.fileId,
      })
    },
    uploadResumeFile: () => {
      uploads += 1
      return Promise.resolve({ fileId: 'new-file', filename: 'b.pdf' })
    },
    getDocumentConversionCapabilities: () => Promise.resolve({ wordToPdf: false }),
  }
  const auth = createAuth('member-1')
  const parse1 = makePage('pages/resume-parse/resume-parse.js', { wx, auth, api })
  parse1.onLoad({ fileId: 'guest-file', fileName: 'a.pdf', fileFormat: 'pdf' })
  await flush()
  await flush()
  await flush()
  assert.equal(parse1.data.fileMissing, true)
  assert.equal(headersSeen.length, 1)
  parse1.toUpload()
  assert.equal(wx.calls.redirect[0], '/pages/resume-upload/resume-upload')

  const upload = makePage('pages/resume-upload/resume-upload.js', { wx, auth, api })
  upload.onLoad()
  upload._upload('/tmp/b.pdf', 'b.pdf', 'resume_upload')
  await flush()
  await flush()
  assert.equal(uploads, 1)
  const nextUrl = wx.calls.nav[wx.calls.nav.length - 1]
  assert.match(nextUrl, /fileId=new-file/)

  const parse2 = makePage('pages/resume-parse/resume-parse.js', { wx, auth, api })
  parse2.onLoad({ fileId: 'new-file', fileName: 'b.pdf', fileFormat: 'pdf' })
  await flush()
  await flush()
  await flush()
  await flush()
  assert.equal(headersSeen.length, 2, '新文件发出了另一次解析')
  assert.notEqual(headersSeen[1].intent, headersSeen[0].intent, '不沿用旧解析标识')
  assert.equal(headersSeen[1].fileId, 'new-file')
  assert.equal(parse2.data.conflict, '')
  assert.equal(parse2.data.fileMissing, false)
  assert.equal(parse2.data.done, true)
  assert.equal(parse2.data.atext, '解析完成')
})

test('重新选择文件时清不掉旧解析标识：停在当前页，不进新文件上传', async () => {
  const wx = createWx()
  const storageMod = requireMiniapp('../utils/storage.js')
  const key = storageMod.KEYS.RESUME_PARSE_INTENT
  let intentWrites = 0
  const realSet = wx.setStorageSync
  wx.setStorageSync = (k, value) => {
    if (k === key) {
      intentWrites += 1
      if (intentWrites > 1) throw new Error('disk')
    }
    realSet(k, value)
  }
  const missing = new Error('文件不存在或已被清理')
  missing.statusCode = 404
  missing.code = 'FILE_NOT_FOUND'
  let uploads = 0
  const api = {
    parseResume: () => Promise.reject(missing),
    uploadResumeFile: () => { uploads += 1; return Promise.resolve({ fileId: 'new-file' }) },
  }
  const page = makePage('pages/resume-parse/resume-parse.js', { wx, auth: createAuth('member-1'), api })
  page.onLoad({ fileId: 'guest-file', fileName: 'a.pdf', fileFormat: 'pdf' })
  await flush()
  await flush()
  await flush()
  assert.equal(page.data.phase, 'failed')
  assert.equal(page.data.fileMissing, true)
  assert.equal(page.data.failMsg, '没能清掉上一次的记录，请再点一次重新选择')
  const kept = wx.getStorageSync(key)
  assert.equal(Array.isArray(kept) && kept.length === 1, true, '旧解析标识还在')
  page.toUpload()
  await flush()
  assert.equal(wx.calls.redirect.length, 0, '清不掉就不进上传页')
  assert.equal(uploads, 0)
  assert.equal(page.data.failMsg, '没能清掉上一次的记录，请再点一次重新选择')
  wx.setStorageSync = realSet
  page.toUpload()
  await flush()
  await flush()
  assert.equal(wx.calls.redirect[0], '/pages/resume-upload/resume-upload')
  assert.equal(uploads, 0, '离开本页这一步还不上传新文件')
})

test('超过每天免费面数：本机和个人、一份和多份都原样显示', () => {
  const { userMessageOf } = requireMiniapp('../utils/user-error.js')
  const sentences = [
    '这台终端今天还只能再打 1 份，这一份已经超过本机上限。',
    '这台终端今天还只能再打 2 份，这一单 4 份已经超过本机上限。',
    '你今天还只能再打 1 份，这一份已经超过个人上限。',
    '你今天还只能再打 3 份，这一单 5 份已经超过个人上限。',
  ]
  for (const sentence of sentences) {
    const shown = userMessageOf({
      code: 'PRINT_ORDER_EXCEEDS_DAILY_FREE_SIDES',
      message: sentence,
      statusCode: 400,
    }, '兜底')
    assert.equal(shown, sentence)
  }
})
