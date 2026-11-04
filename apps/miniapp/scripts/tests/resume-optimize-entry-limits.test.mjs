/**
 * 简历优化入口的三条收口：原文已清理时重新上传去上传页；
 * 切走再回来的旧请求不得打断新请求；只看最近 50 条。
 * 与 resume-optimize-entry.test.mjs 分开，避免那个文件超过 500 行。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { deferred, flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const CLEANED_REASON = '简历原文已按隐私策略自动清理，请重新上传简历后再生成优化版'

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

function tapHomeOptimize(page) {
  const item = page.data.primaryServices.filter((row) => row.title === '简历优化')[0]
  page.tapService({ currentTarget: { dataset: { url: item.url } } })
}

test('已完成诊断、无优化稿、原文件已清理时，从入口进入后重新上传去上传页', async () => {
  const taskId = 'cleaned-1'
  const home = makePage('pages/home/home.js', {
    loggedIn: true,
    api: {
      getMyResumes: () => Promise.resolve([
        { kind: 'parse', status: 'completed', taskId, optimized: false },
      ]),
    },
  })
  tapHomeOptimize(home.page)
  await flush()
  assert.deepEqual(home.wx.calls.navigateTo, [
    '/pages/resume-optimize/resume-optimize?taskId=' + encodeURIComponent(taskId),
  ])

  const opt = makePage('pages/resume-optimize/resume-optimize.js', {
    loggedIn: true,
    api: {
      getResumeOptimize: () => Promise.resolve({
        taskId,
        status: 'failed',
        failReason: CLEANED_REASON,
      }),
      getMyResumes: () => { throw new Error('已带编号不应再查列表') },
    },
  })
  opt.page.onLoad({ taskId })
  await flush()
  assert.equal(opt.page.data.phase, 'failed')
  assert.equal(opt.page.data.needReupload, true)
  assert.equal(opt.page.data.failMsg, CLEANED_REASON)
  opt.page.tapReupload()
  assert.deepEqual(opt.wx.calls.navigateTo, ['/pages/resume-upload/resume-upload'])
})

test('切走、返回、再点一次时，过期回调不得清掉新请求的打开状态和加载提示', async () => {
  const first = deferred()
  const second = deferred()
  const queued = [first, second]
  let calls = 0
  const { page, wx } = makePage('pages/ai/ai.js', {
    loggedIn: true,
    api: {
      getMyResumes: () => {
        const slot = queued[calls]
        calls += 1
        return slot.promise
      },
    },
  })
  page.tapEntry({ currentTarget: { dataset: { id: 'optimize' } } })
  page.onHide()
  page.onShow()
  page.tapEntry({ currentTarget: { dataset: { id: 'optimize' } } })
  await flush()
  assert.equal(calls, 2)
  assert.equal(page._optimizeOpening, true)
  assert.equal(wx.calls.showLoading.length, 2)
  assert.equal(wx.calls.hideLoading.length, 1)
  first.resolve([{ kind: 'parse', status: 'completed', taskId: 'old-a', optimized: false }])
  await flush()
  assert.equal(page._optimizeOpening, true)
  assert.equal(wx.calls.hideLoading.length, 1)
  assert.deepEqual(wx.calls.navigateTo, [])
  page.tapEntry({ currentTarget: { dataset: { id: 'optimize' } } })
  await flush()
  assert.equal(calls, 2)
  second.resolve([{ kind: 'parse', status: 'completed', taskId: 'new-b', optimized: true }])
  await flush()
  assert.equal(page._optimizeOpening, false)
  assert.equal(wx.calls.hideLoading.length, 2)
  assert.deepEqual(wx.calls.navigateTo, [
    '/pages/resume-optimize/resume-optimize?taskId=new-b',
  ])
})

test('只看最近 50 条：前 50 条都不可优化时不带编号，进出路页', async () => {
  const calls = []
  const recent = []
  for (let i = 0; i < 50; i += 1) {
    recent.push({
      kind: i % 2 ? 'generate' : 'parse',
      status: i % 2 ? 'completed' : 'failed',
      taskId: `skip-${i}`,
    })
  }
  recent.push({ kind: 'parse', status: 'completed', taskId: 'older-ok', optimized: true })
  recent.nextCursor = 'page-2'
  let records = 0
  const home = makePage('pages/home/home.js', {
    loggedIn: true,
    api: {
      getMyResumes: (params) => {
        calls.push({ pageSize: params && params.pageSize, cursor: params && params.cursor })
        if (params && params.cursor) {
          return Promise.resolve([
            { kind: 'parse', status: 'completed', taskId: 'paged-ok', optimized: true },
          ])
        }
        return Promise.resolve(recent)
      },
      getResumeRecord: () => { records += 1; return Promise.resolve({ status: 'completed', kind: 'parse' }) },
    },
  })
  tapHomeOptimize(home.page)
  await flush()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].pageSize, 50)
  assert.equal(calls[0].cursor, undefined)
  assert.equal(records, 0)
  assert.deepEqual(home.wx.calls.navigateTo, ['/pages/resume-optimize/resume-optimize'])
})
