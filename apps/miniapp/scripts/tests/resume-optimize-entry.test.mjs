/**
 * 简历优化入口：没有任务编号时必须有能继续的路；有编号时照常读取优化结果。
 * 在 node:vm 里执行页面源码。出路只许三条已经走得通的：
 *   上传页（上传 → 解析 → 诊断 → 优化）、从零填写、已完成诊断的任务编号。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deferred, flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OPTIMIZE_JS = path.join(MINIAPP, 'pages/resume-optimize/resume-optimize.js')
const OPTIMIZE_WXML = path.join(MINIAPP, 'pages/resume-optimize/resume-optimize.wxml')
const BANNED = ['已完成', '已保存', '已发送', '一键投递', '立即投递', '岗位', '招聘会', '企业', '价格', '套餐', '购买', '开通', '续费']

function registeredPages() {
  const app = JSON.parse(fs.readFileSync(path.join(MINIAPP, 'app.json'), 'utf8'))
  const set = new Set(app.pages)
  for (const sub of app.subpackages || []) {
    for (const page of sub.pages) set.add(`${sub.root}/${page}`)
  }
  return set
}

const PAGES = registeredPages()

function createWx() {
  const calls = { navigateTo: [], switchTab: [], showToast: [], showLoading: [], hideLoading: [] }
  const api = {
    navigateTo(opts) { calls.navigateTo.push(opts.url); if (opts.success) opts.success() },
    navigateBack(opts) { if (opts && opts.fail) opts.fail({ errMsg: 'navigateBack:fail' }) },
    switchTab(opts) { calls.switchTab.push(opts.url) },
    showToast(opts) { calls.showToast.push(opts && opts.title) },
    showLoading(opts) { calls.showLoading.push(opts && opts.title) },
    hideLoading() { calls.hideLoading.push(1) },
    getStorageSync() { return '' },
    setStorageSync() {},
  }
  return { api, calls }
}

function createStorage(saved) {
  const data = {}
  if (saved) data.zyd_resume_task = saved
  return {
    KEYS: { RESUME_TASK: 'zyd_resume_task' },
    get(key, fallback = null) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback
    },
  }
}

function createAuth(loggedIn) {
  return {
    isLoggedIn: () => !!loggedIn,
    getUser: () => (loggedIn ? { id: 'u1', nickname: '测' } : null),
  }
}

function makePage(rel, { loggedIn = false, saved = null, api = {} } = {}) {
  const wx = createWx()
  const page = instantiate(loadPageDefinition(rel, {
    wx: wx.api,
    modules: {
      api: Object.assign({
        getResumeExportPricing: () => Promise.reject(new Error('pricing-skip')),
        getMyResumes: () => Promise.resolve([]),
        getResumeRecord: () => Promise.resolve(null),
        getResumeOptimize: () => Promise.resolve({
          taskId: 'task-1',
          status: 'completed',
          modules: [],
          optimizedResume: { basic: { name: '测' } },
        }),
      }, api),
      auth: createAuth(loggedIn),
      storage: createStorage(saved),
    },
  }))
  return { page, wx }
}

function idsOf(ways) {
  return (ways || []).map((way) => way.id)
}

function assertCopy(text) {
  for (const word of BANNED) assert.equal(String(text).includes(word), false, word)
}

function assertWay(way) {
  assert.equal(typeof way.id, 'string')
  assert.ok(way.title, way.id)
  assert.ok(way.hint, way.id)
  assertCopy(`${way.title}\n${way.hint}`)
  const pathOnly = String(way.url || '').split('?')[0].replace(/^\//, '')
  assert.equal(PAGES.has(pathOnly), true, way.url)
  if (way.id === 'upload') {
    assert.equal(way.url, '/pages/resume-upload/resume-upload')
  } else if (way.id === 'build') {
    assert.equal(way.url, '/pages/resume-build/resume-build')
  } else if (way.id === 'continue') {
    const taskId = new URLSearchParams(String(way.url).split('?')[1] || '').get('taskId')
    assert.ok(taskId, way.url)
    assert.equal(way.url, `/pages/resume-optimize/resume-optimize?taskId=${encodeURIComponent(taskId)}`)
  } else {
    assert.fail(`走不通的入口：${way.id} ${way.url}`)
  }
}

function assertWays(ways) {
  assert.ok(ways && ways.length >= 2)
  const ids = idsOf(ways)
  assert.equal(ids.includes('upload'), true)
  assert.equal(ids.includes('build'), true)
  assert.equal(new Set(ids).size, ids.length)
  ways.forEach(assertWay)
  assert.equal(ids[ids.length - 2], 'upload')
  assert.equal(ids[ids.length - 1], 'build')
  if (ids.includes('continue')) assert.equal(ids[0], 'continue')
}

const MIXED = [
  { kind: 'generate', status: 'completed', taskId: 'gen-1', optimized: true },
  { kind: 'parse', status: 'failed', taskId: 'bad-1' },
  { kind: 'parse', status: 'pending', taskId: 'pend-1' },
  { kind: 'parse', status: 'processing', taskId: 'run-1' },
  { kind: 'parse', status: 'completed', taskId: 'a&b=1', optimized: false },
  { kind: 'parse', status: 'completed', taskId: 'older', optimized: true },
]

test('优化页不超过 500 行，空态文案在页面上能看到', () => {
  const src = fs.readFileSync(OPTIMIZE_JS, 'utf8')
  const lineCount = src.split('\n').length - (src.endsWith('\n') ? 1 : 0)
  assert.ok(lineCount <= 500, `优化页 ${lineCount} 行`)
  assert.match(src, /require\('\.\.\/\.\.\/utils\/resume-optimize-entry'\)/)
  const wxml = fs.readFileSync(OPTIMIZE_WXML, 'utf8')
  const block = wxml.slice(wxml.indexOf("phase === 'no-task'"), wxml.indexOf("phase === 'loading'"))
  assert.match(block, /wx:for="\{\{ways\}\}"/)
  assert.match(block, /\{\{item\.title\}\}/)
  assert.match(block, /\{\{item\.hint\}\}/)
  assert.match(block, /bindtap="tapWay"/)
  assert.match(block, /bindtap="goBack"/)
  assert.equal(/resume-parse|job-fit|resumes/.test(block), false)
  assertCopy(block)
})

test('无编号进入先给出上传和从零写，列表回来后才出现接着改', async () => {
  const pending = deferred()
  let resumes = 0
  let records = 0
  const { page, wx } = makePage('pages/resume-optimize/resume-optimize.js', {
    loggedIn: true,
    api: {
      getMyResumes: () => { resumes += 1; return pending.promise },
      getResumeRecord: () => { records += 1; return Promise.resolve({ status: 'completed' }) },
      getResumeOptimize: () => { throw new Error('无编号不应请求优化') },
    },
  })
  page.onLoad({})
  assert.equal(page.data.phase, 'no-task')
  assertWays(page.data.ways)
  assert.deepEqual(idsOf(page.data.ways), ['upload', 'build'])
  assert.equal(page.data.ways[0].primary, true)
  await flush()
  assert.equal(resumes, 1)
  assert.equal(records, 0)
  assert.deepEqual(idsOf(page.data.ways), ['upload', 'build'])
  pending.resolve(MIXED)
  await flush()
  assertWays(page.data.ways)
  assert.deepEqual(idsOf(page.data.ways), ['continue', 'upload', 'build'])
  assert.equal(page.data.ways[0].url, '/pages/resume-optimize/resume-optimize?taskId=' + encodeURIComponent('a&b=1'))
  assert.equal(page.data.ways[0].hint.includes('最近一次诊断过的简历'), true)
  assert.equal(page.data.ways[0].hint.includes('优化结果'), false)
  assert.equal(records, 0)
  page.tapWay({ currentTarget: { dataset: { id: 'continue' } } })
  page.tapWay({ currentTarget: { dataset: { id: 'upload' } } })
  page.tapWay({ currentTarget: { dataset: { id: 'build' } } })
  page.tapWay({ currentTarget: { dataset: { id: 'job-fit' } } })
  assert.deepEqual(wx.calls.navigateTo, [
    '/pages/resume-optimize/resume-optimize?taskId=' + encodeURIComponent('a&b=1'),
    '/pages/resume-upload/resume-upload',
    '/pages/resume-build/resume-build',
  ])
})

test('已有优化结果时，接着改说的是打开上次的优化结果', async () => {
  const { page } = makePage('pages/resume-optimize/resume-optimize.js', {
    loggedIn: true,
    api: {
      getMyResumes: () => Promise.resolve([
        { kind: 'parse', status: 'completed', taskId: 'opt-1', optimized: true },
      ]),
    },
  })
  page.onLoad({})
  await flush()
  assert.equal(page.data.ways[0].id, 'continue')
  assert.equal(page.data.ways[0].title, '接着改上次那份')
  assert.equal(page.data.ways[0].hint.includes('打开上次的优化结果'), true)
  assert.equal(page.data.ways[0].url, '/pages/resume-optimize/resume-optimize?taskId=opt-1')
})

test('未登录且本机没有已完成诊断时，不列出接着改，也不请求简历列表', async () => {
  let resumes = 0
  let records = 0
  const { page, wx } = makePage('pages/resume-optimize/resume-optimize.js', {
    api: {
      getMyResumes: () => { resumes += 1; return Promise.resolve(MIXED) },
      getResumeRecord: () => { records += 1; return Promise.resolve({ status: 'completed' }) },
    },
  })
  page.onLoad({})
  await flush()
  assert.deepEqual(idsOf(page.data.ways), ['upload', 'build'])
  assert.equal(resumes, 0)
  assert.equal(records, 0)
  page.tapWay({ currentTarget: { dataset: { id: 'upload' } } })
  page.tapWay({ currentTarget: { dataset: { id: 'build' } } })
  assert.deepEqual(wx.calls.navigateTo, [
    '/pages/resume-upload/resume-upload',
    '/pages/resume-build/resume-build',
  ])
  page.goBack()
  assert.deepEqual(wx.calls.switchTab, ['/pages/home/home'])
})

test('未登录时本机最近一次已完成诊断可以接着改，未完成的不行', async () => {
  let seen = null
  const ready = makePage('pages/resume-optimize/resume-optimize.js', {
    saved: { taskId: 'local-9', accessToken: 'tok' },
    api: {
      getMyResumes: () => { throw new Error('未登录不应拉列表') },
      getResumeRecord: (taskId, token) => {
        seen = [taskId, token]
        return Promise.resolve({ status: 'completed' })
      },
    },
  })
  ready.page.onLoad({})
  await flush()
  assert.deepEqual(seen, ['local-9', 'tok'])
  assert.equal(ready.page.data.ways[0].id, 'continue')
  assert.equal(ready.page.data.ways[0].url, '/pages/resume-optimize/resume-optimize?taskId=local-9')
  assert.equal(ready.page.data.ways[0].hint.includes('优化结果'), false)

  const failed = makePage('pages/resume-optimize/resume-optimize.js', {
    saved: { taskId: 'local-x', accessToken: 'tok' },
    api: { getResumeRecord: () => Promise.resolve({ status: 'failed' }) },
  })
  failed.page.onLoad({})
  await flush()
  assert.deepEqual(idsOf(failed.page.data.ways), ['upload', 'build'])

  const down = makePage('pages/resume-optimize/resume-optimize.js', {
    saved: { taskId: 'local-y', accessToken: 'tok' },
    api: { getResumeRecord: () => Promise.reject(new Error('404')) },
  })
  down.page.onLoad({})
  await flush()
  assert.deepEqual(idsOf(down.page.data.ways), ['upload', 'build'])
})

test('登录列表没有可优化记录时，退回本机已完成诊断；列表失败也一样', async () => {
  let records = 0
  const local = makePage('pages/resume-optimize/resume-optimize.js', {
    loggedIn: true,
    saved: { taskId: 'local-9', accessToken: 'tok' },
    api: {
      getMyResumes: () => Promise.resolve([{ kind: 'generate', status: 'completed', taskId: 'gen-1' }]),
      getResumeRecord: () => { records += 1; return Promise.resolve({ status: 'completed', kind: 'parse' }) },
    },
  })
  local.page.onLoad({})
  await flush()
  assert.equal(records, 1)
  assert.equal(local.page.data.ways[0].url, '/pages/resume-optimize/resume-optimize?taskId=local-9')

  const server = makePage('pages/resume-optimize/resume-optimize.js', {
    loggedIn: true,
    saved: { taskId: 'local-9', accessToken: 'tok' },
    api: {
      getMyResumes: () => Promise.resolve([{ kind: 'parse', status: 'completed', taskId: 'server-1', optimized: false }]),
      getResumeRecord: () => { throw new Error('列表已有记录，不应再读本机任务') },
    },
  })
  server.page.onLoad({})
  await flush()
  assert.equal(server.page.data.ways[0].url, '/pages/resume-optimize/resume-optimize?taskId=server-1')

  const down = makePage('pages/resume-optimize/resume-optimize.js', {
    loggedIn: true,
    api: { getMyResumes: () => Promise.reject(new Error('down')) },
  })
  down.page.onLoad({})
  await flush()
  assert.deepEqual(idsOf(down.page.data.ways), ['upload', 'build'])
})

test('离开页面后，迟到的简历列表不再改空态', async () => {
  const pending = deferred()
  const { page } = makePage('pages/resume-optimize/resume-optimize.js', {
    loggedIn: true,
    api: { getMyResumes: () => pending.promise },
  })
  page.onLoad({})
  page.onUnload()
  pending.resolve(MIXED)
  await flush()
  assert.deepEqual(idsOf(page.data.ways), ['upload', 'build'])
})

test('有任务编号时照常读取优化结果，不改走出路页', async () => {
  let optimizeArgs = null
  let resumes = 0
  let records = 0
  const { page } = makePage('pages/resume-optimize/resume-optimize.js', {
    api: {
      getResumeOptimize: (taskId, token) => {
        optimizeArgs = [taskId, token]
        return Promise.resolve({
          taskId,
          status: 'completed',
          modules: [{ title: '简介', before: '旧', after: '新' }],
          optimizedResume: { basic: { name: '测' } },
        })
      },
      getMyResumes: () => { resumes += 1; return Promise.resolve(MIXED) },
      getResumeRecord: () => { records += 1; return Promise.resolve({ status: 'completed' }) },
    },
  })
  page.onLoad({ taskId: 'task-1' })
  assert.equal(page.data.phase, 'loading')
  assert.equal(page.data.taskId, 'task-1')
  await flush()
  assert.equal(page.data.phase, 'done')
  assert.equal(page.data.opt.hasModules, true)
  assert.deepEqual(optimizeArgs, ['task-1', ''])
  assert.equal(resumes, 0)
  assert.equal(records, 0)
})

function tapHomeOptimize(page) {
  const item = page.data.primaryServices.filter((row) => row.title === '简历优化')[0]
  page.tapService({ currentTarget: { dataset: { url: item.url } } })
}

test('首页有最近一份已完成诊断时带编号进入，没有就进出路页', async () => {
  const found = makePage('pages/home/home.js', {
    loggedIn: true,
    api: { getMyResumes: () => Promise.resolve(MIXED) },
  })
  tapHomeOptimize(found.page)
  assert.equal(found.wx.calls.showLoading[0], '正在打开…')
  await flush()
  assert.deepEqual(found.wx.calls.navigateTo, [
    '/pages/resume-optimize/resume-optimize?taskId=' + encodeURIComponent('a&b=1'),
  ])
  assert.equal(found.wx.calls.hideLoading.length, 1)

  let resumes = 0
  const none = makePage('pages/home/home.js', {
    api: { getMyResumes: () => { resumes += 1; return Promise.resolve(MIXED) } },
  })
  tapHomeOptimize(none.page)
  await flush()
  assert.equal(resumes, 0)
  assert.deepEqual(none.wx.calls.navigateTo, ['/pages/resume-optimize/resume-optimize'])

  const diagnose = none.page.data.primaryServices.filter((row) => row.title === '简历诊断')[0]
  none.page.tapService({ currentTarget: { dataset: { url: diagnose.url } } })
  assert.equal(none.wx.calls.navigateTo[1], '/pages/resume-diagnose/resume-diagnose')
  assert.equal(resumes, 0)
})

test('首页列表失败或切走时不带一个猜出来的编号', async () => {
  const down = makePage('pages/home/home.js', {
    loggedIn: true,
    api: { getMyResumes: () => Promise.reject(new Error('down')) },
  })
  tapHomeOptimize(down.page)
  await flush()
  assert.deepEqual(down.wx.calls.navigateTo, ['/pages/resume-optimize/resume-optimize'])

  const pending = deferred()
  let calls = 0
  const leaving = makePage('pages/home/home.js', {
    loggedIn: true,
    api: { getMyResumes: () => { calls += 1; return pending.promise } },
  })
  tapHomeOptimize(leaving.page)
  tapHomeOptimize(leaving.page)
  await flush()
  assert.equal(calls, 1)
  leaving.page.onLoad()
  leaving.page.onHide()
  pending.resolve(MIXED)
  await flush()
  assert.deepEqual(leaving.wx.calls.navigateTo, [])
  assert.equal(leaving.wx.calls.hideLoading.length, 1)
})

test('AI 页简历优化与首页同一规则，其它入口不查简历列表', async () => {
  let resumes = 0
  const found = makePage('pages/ai/ai.js', {
    loggedIn: true,
    saved: { taskId: 'local-9', accessToken: 'tok' },
    api: {
      getMyResumes: () => { resumes += 1; return Promise.resolve(MIXED) },
      getResumeRecord: () => { throw new Error('列表已有记录，不应再读本机任务') },
    },
  })
  found.page.tapEntry({ currentTarget: { dataset: { id: 'optimize' } } })
  await flush()
  assert.equal(resumes, 1)
  assert.deepEqual(found.wx.calls.navigateTo, [
    '/pages/resume-optimize/resume-optimize?taskId=' + encodeURIComponent('a&b=1'),
  ])

  const other = makePage('pages/ai/ai.js', {
    loggedIn: true,
    api: { getMyResumes: () => { resumes += 1; return Promise.resolve(MIXED) } },
  })
  other.page.tapEntry({ currentTarget: { dataset: { id: 'diagnose' } } })
  other.page.tapEntry({ currentTarget: { dataset: { id: 'build' } } })
  assert.deepEqual(other.wx.calls.navigateTo, [
    '/pages/resume-diagnose/resume-diagnose',
    '/pages/resume-build/resume-build',
  ])
  assert.equal(resumes, 1)

  const pending = deferred()
  const leaving = makePage('pages/ai/ai.js', {
    loggedIn: true,
    api: { getMyResumes: () => pending.promise },
  })
  leaving.page.tapEntry({ currentTarget: { dataset: { id: 'optimize' } } })
  leaving.page.onHide()
  pending.resolve([{ kind: 'parse', status: 'completed', taskId: 'server-1', optimized: true }])
  await flush()
  assert.deepEqual(leaving.wx.calls.navigateTo, [])
})
