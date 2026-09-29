/**
 * 「我的简历」「意见反馈」列表翻页：真跑页面，api 是替身。
 *
 * 钉住的是走查 W-32：两页都只取第一页 50 条，服务端附在数组上的 nextCursor 被丢掉，
 * 第 51 条起永远看不到。触底要带着 cursor 请求下一页并追加；没有下一页就不再请求；
 * 翻页失败保留已经显示的那一页。退出登录后，迟到的下一页不得写回屏幕。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { deferred, flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

function pageOf(items, nextCursor) {
  const list = items.slice()
  list.nextCursor = nextCursor
  return list
}

function start(rel, method) {
  const calls = []
  const pending = []
  const api = {
    [method](params) {
      calls.push({
        pageSize: params && params.pageSize,
        cursor: params && params.cursor,
      })
      const slot = deferred()
      pending.push(slot)
      return slot.promise
    },
  }
  let logged = true
  const auth = { isLoggedIn: () => logged }
  const wx = {
    showLoading() {},
    hideLoading() {},
    showToast() {},
    navigateTo() {},
    navigateBack() {},
    switchTab() {},
  }
  const def = loadPageDefinition(rel, { wx, modules: { auth, api } })
  const page = instantiate(def)
  page.onLoad({})
  page.onShow()
  return {
    page,
    calls,
    pending,
    setLoggedIn(value) { logged = value },
  }
}

const resume = (id) => ({ id, taskId: `t-${id}`, kind: 'generate', status: 'completed', updatedAt: '2026-09-01T08:00:00.000Z' })
const feedback = (id) => ({
  id, category: 'general', title: `标题${id}`, content: `内容不少于十字${id}`, status: 'pending', createdAt: '2026-09-01T08:00:00.000Z',
})

test('简历：第一页带 nextCursor，触底带 cursor 请求第二页并追加', async () => {
  const { page, calls, pending } = start('pages/resumes/resumes.js', 'getMyResumes')
  pending[0].resolve(pageOf([resume('r1')], 'c-resume'))
  await flush()
  assert.equal(page.data.resumes.length, 1)
  assert.equal(page.data.nextCursor, 'c-resume')

  page.onReachBottom()
  page.onReachBottom()
  assert.equal(calls.length, 2, '翻页进行中再次触底不得再发一次')
  assert.equal(calls[0].pageSize, 50)
  assert.equal(calls[0].cursor, undefined)
  assert.equal(calls[1].pageSize, 50)
  assert.equal(calls[1].cursor, 'c-resume')

  pending[1].resolve(pageOf([resume('r2')], null))
  await flush()
  assert.equal(page.data.resumes.length, 2)
  assert.equal(page.data.resumes[0].id, 'r1')
  assert.equal(page.data.resumes[1].id, 'r2')
  assert.equal(page.data.nextCursor, null)
  assert.equal(page.data.loadingMore, false)
})

test('简历：没有 nextCursor 时触底不再请求', async () => {
  const { page, calls, pending } = start('pages/resumes/resumes.js', 'getMyResumes')
  pending[0].resolve(pageOf([resume('r1')], null))
  await flush()
  page.onReachBottom()
  await flush()
  assert.equal(calls.length, 1)
  assert.equal(page.data.resumes.length, 1)
  assert.equal(page.data.resumes[0].id, 'r1')
})

test('简历：翻页失败保留第一页，并可带着原 cursor 重试', async () => {
  const { page, calls, pending } = start('pages/resumes/resumes.js', 'getMyResumes')
  pending[0].resolve(pageOf([resume('r1')], 'c-resume'))
  await flush()
  page.onReachBottom()
  pending[1].reject(Object.assign(new Error('网络异常'), { statusCode: 500 }))
  await flush()
  assert.equal(page.data.resumes.length, 1)
  assert.equal(page.data.resumes[0].id, 'r1')
  assert.equal(page.data.loadingMore, false)
  assert.equal(page.data.loginRequired, false)
  assert.ok(page.data.loadMoreError)

  page.retryLoadMore()
  assert.equal(calls.length, 3)
  assert.equal(calls[2].cursor, 'c-resume')
  pending[2].resolve(pageOf([resume('r2')], null))
  await flush()
  assert.equal(page.data.resumes.length, 2)
  assert.equal(page.data.resumes[1].id, 'r2')
  assert.equal(page.data.loadMoreError, '')
})

test('简历：退出登录后，迟到的第二页不得写回', async () => {
  const { page, calls, pending, setLoggedIn } = start('pages/resumes/resumes.js', 'getMyResumes')
  pending[0].resolve(pageOf([resume('r1')], 'c-resume'))
  await flush()
  page.onReachBottom()
  setLoggedIn(false)
  page.onShow()
  assert.equal(page.data.loginRequired, true)
  assert.equal(page.data.resumes.length, 0)
  pending[1].resolve(pageOf([resume('r2')], null))
  await flush()
  assert.equal(calls.length, 2, '退出本身不再请求')
  assert.equal(page.data.resumes.length, 0)
  assert.equal(page.data.loginRequired, true)
})

test('反馈：第一页带 nextCursor，触底带 cursor 请求第二页并追加', async () => {
  const { page, calls, pending } = start('pages/feedback/feedback.js', 'getMyFeedback')
  pending[0].resolve(pageOf([feedback('f1')], 'c-feedback'))
  await flush()
  assert.equal(page.data.list.length, 1)
  assert.equal(page.data.listState, 'ready')
  assert.equal(page.data.nextCursor, 'c-feedback')

  page.onReachBottom()
  page.onReachBottom()
  assert.equal(calls.length, 2, '翻页进行中再次触底不得再发一次')
  assert.equal(calls[0].pageSize, 50)
  assert.equal(calls[0].cursor, undefined)
  assert.equal(calls[1].pageSize, 50)
  assert.equal(calls[1].cursor, 'c-feedback')

  pending[1].resolve(pageOf([feedback('f2')], null))
  await flush()
  assert.equal(page.data.list.length, 2)
  assert.equal(page.data.list[0].id, 'f1')
  assert.equal(page.data.list[1].id, 'f2')
  assert.equal(page.data.nextCursor, null)
  assert.equal(page.data.loadingMore, false)
  assert.equal(page.data.listState, 'ready')
})

test('反馈：没有 nextCursor 时触底不再请求', async () => {
  const { page, calls, pending } = start('pages/feedback/feedback.js', 'getMyFeedback')
  pending[0].resolve(pageOf([feedback('f1')], null))
  await flush()
  page.onReachBottom()
  await flush()
  assert.equal(calls.length, 1)
  assert.equal(page.data.list.length, 1)
  assert.equal(page.data.list[0].id, 'f1')
})

test('反馈：翻页失败保留第一页，并可带着原 cursor 重试', async () => {
  const { page, calls, pending } = start('pages/feedback/feedback.js', 'getMyFeedback')
  pending[0].resolve(pageOf([feedback('f1')], 'c-feedback'))
  await flush()
  page.onReachBottom()
  pending[1].reject(Object.assign(new Error('网络异常'), { statusCode: 500 }))
  await flush()
  assert.equal(page.data.list.length, 1)
  assert.equal(page.data.list[0].id, 'f1')
  assert.equal(page.data.listState, 'ready', 'listState 变成 error 会让模板把整段列表换成错误卡片')
  assert.equal(page.data.loadingMore, false)
  assert.equal(page.data.loggedIn, true)
  assert.ok(page.data.loadMoreError)

  page.retryLoadMore()
  assert.equal(calls.length, 3)
  assert.equal(calls[2].cursor, 'c-feedback')
  pending[2].resolve(pageOf([feedback('f2')], null))
  await flush()
  assert.equal(page.data.list.length, 2)
  assert.equal(page.data.list[1].id, 'f2')
  assert.equal(page.data.loadMoreError, '')
})

test('反馈：退出登录后，迟到的第二页不得写回', async () => {
  const { page, calls, pending, setLoggedIn } = start('pages/feedback/feedback.js', 'getMyFeedback')
  pending[0].resolve(pageOf([feedback('f1')], 'c-feedback'))
  await flush()
  page.onReachBottom()
  setLoggedIn(false)
  page.onShow()
  assert.equal(page.data.loggedIn, false)
  assert.equal(page.data.list.length, 0)
  pending[1].resolve(pageOf([feedback('f2')], null))
  await flush()
  assert.equal(calls.length, 2, '退出本身不再请求')
  assert.equal(page.data.list.length, 0)
  assert.equal(page.data.loggedIn, false)
})
