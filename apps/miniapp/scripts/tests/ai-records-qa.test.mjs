/**
 * AI 服务记录里的小青问答要点（pages/ai-records）：真跑页面，api / auth 是替身。
 *
 * 钉住的是走查 W-33：
 *   - 首页那一次 GET /me/ai-records 已经带着 qaRecords，「全部」和「问答要点」都能看见；
 *   - 响应里没有 qaRecords 字段时页面照常，不报错；
 *   - 有 qaNextCursor 时，加载更多带 qaCursor；只翻记录时不要把问答第一页再并进来；
 *   - 加载更多失败不清空已有要点；
 *   - 换账号、退出登录，以及晚到的旧响应，都不得留下上一个人的要点。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { deferred, flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const require = createRequire(import.meta.url)
const qaMod = require('../../pages/ai-records/qa-records.js')

function titlesOf(page) {
  const out = []
  const groups = page.data.groups || []
  for (let i = 0; i < groups.length; i += 1) {
    const items = groups[i].items || []
    for (let j = 0; j < items.length; j += 1) out.push(items[j])
  }
  return out
}

function titleText(page) {
  return titlesOf(page).map((item) => item.title).join('|')
}

function attach(items, extra) {
  const list = items.slice()
  if (extra) Object.assign(list, extra)
  return list
}

const resume = {
  id: 'r1',
  taskId: 't1',
  kind: 'parse',
  status: 'completed',
  createdAt: '2026-09-27T01:00:00.000Z',
}

const qaMeta = {
  id: 'a1',
  sessionId: 's1',
  artifactId: 'a1',
  kind: 'qa_pins',
  title: '小青本次要点',
  createdAt: '2026-09-29T01:00:00.000Z',
  expiresAt: '2026-10-29T01:00:00.000Z',
  fileId: null,
}

const qaPins = {
  id: 'a2',
  sessionId: 's2',
  artifactId: 'a2',
  kind: 'qa_pins',
  title: '',
  createdAt: '2026-09-28T01:00:00.000Z',
  pins: [{ content: '先改项目描述' }, { content: '补上量化结果' }],
}

function setup({ userId = 'A', loggedIn = true, pages, advisor } = {}) {
  const calls = []
  const advisorCalls = []
  const modals = []
  const toasts = []
  const sheets = []
  const navigated = []
  let deleted = 0
  const state = { userId, loggedIn }
  const auth = {
    isLoggedIn: () => state.loggedIn,
    getUser: () => (state.userId ? { id: state.userId } : null),
    getToken: () => (state.loggedIn ? `tok-${state.userId || 'x'}` : ''),
    sessionGeneration: () => state.userId || 'out',
  }
  const api = {
    getMyAiRecords: (params) => {
      calls.push({ ...params })
      return pages(calls.length, params)
    },
    getMyMockInterviews: () => Promise.resolve([]),
    getAdvisorSession: (sessionId) => {
      advisorCalls.push(sessionId)
      return advisor ? advisor(sessionId) : Promise.resolve({ artifacts: [] })
    },
    deleteMyAiRecord: () => {
      deleted += 1
      return Promise.resolve({ deleted: true })
    },
    deleteMyMockInterview: () => Promise.resolve({ deleted: true }),
  }
  const wx = {
    navigateTo(opts) { navigated.push(opts.url) },
    navigateBack() {},
    switchTab() {},
    showModal(opts) { modals.push(opts) },
    showToast(opts) { toasts.push(opts) },
    showActionSheet(opts) { sheets.push(opts) },
    showLoading() {},
    hideLoading() {},
  }
  const def = loadPageDefinition('pages/ai-records/ai-records.js', { wx, modules: { auth, api } })
  const page = instantiate(def)
  return { page, calls, advisorCalls, modals, toasts, sheets, navigated, state, deleted: () => deleted }
}

test('列表字段：有标题写标题，没有标题用小青问答要点；有要点才写摘要', () => {
  const meta = qaMod.mapQaRecord(qaMeta)
  assert.equal(meta.title, '小青本次要点')
  assert.match(meta.statusLabel, /^保存至 /)
  assert.equal(meta.points.length, 0)
  assert.equal(meta.icon, 'i-message-circle')
  const pins = qaMod.mapQaRecord(qaPins)
  assert.equal(pins.title, '小青问答要点')
  assert.match(pins.statusLabel, /先改项目描述/)
  assert.match(pins.statusLabel, /补上量化结果/)
  const lines = qaMod.pointsFromSession({
    slots: [{ value: '用户问题不该出现' }],
    pins: [{ content: '会话钉不该出现' }],
    artifacts: [{ artifactId: 'a1', payload: { kind: 'qa_pins', pins: [{ content: '把项目结果写具体' }] } }],
  }, 'a1')
  assert.deepEqual(lines, ['把项目结果写具体'])
  assert.equal(qaMod.readQaBundle({ items: [resume] }).records.length, 0)
  assert.equal(qaMod.readQaBundle({ items: [resume] }).nextCursor, null)
})

test('有 qaRecords 时，全部和问答要点都能看见，而且首页不再另发一次请求', async () => {
  const { page, calls } = setup({
    pages: () => Promise.resolve(attach([resume], {
      qaRecords: [qaMeta, qaPins],
      qaNextCursor: null,
      qaTotal: 2,
    })),
  })
  page.onShow()
  await flush()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].pageSize, 50)
  assert.equal(calls[0].qaCursor, undefined)
  assert.equal(page.data.filters[page.data.filters.length - 1].label, '问答要点')
  assert.equal(page.data.filters[page.data.filters.length - 1].key, 'qa')
  const all = titleText(page)
  assert.match(all, /小青本次要点/)
  assert.match(all, /小青问答要点/)
  assert.match(all, /简历诊断/)
  const metaRow = titlesOf(page).find((item) => item.title === '小青本次要点')
  assert.match(metaRow.statusLabel, /保存至/)
  const pinRow = titlesOf(page).find((item) => item.title === '小青问答要点')
  assert.match(pinRow.statusLabel, /先改项目描述/)
  page.setFilter({ currentTarget: { dataset: { key: 'qa' } } })
  const only = titleText(page)
  assert.match(only, /小青本次要点/)
  assert.match(only, /小青问答要点/)
  assert.doesNotMatch(only, /简历诊断/)
  assert.equal(page.data.loadError, '')
  assert.equal(page.data.loginRequired, false)
})

test('响应没有 qaRecords 字段时页面照常，不报错', async () => {
  const { page, navigated } = setup({
    pages: () => Promise.resolve(attach([resume])),
  })
  page.onShow()
  await flush()
  assert.equal(titleText(page), '简历诊断')
  assert.equal(page.data.loadError, '')
  assert.equal(page.data.loginRequired, false)
  page.setFilter({ currentTarget: { dataset: { key: 'qa' } } })
  assert.equal(titlesOf(page).length, 0)
  page.setFilter({ currentTarget: { dataset: { key: 'all' } } })
  page.openRecord({ currentTarget: { dataset: { id: 'r1' } } })
  assert.equal(navigated[0], '/pages/resume-diagnose/resume-diagnose?taskId=t1')
})

test('qaNextCursor 翻页带 qaCursor；只翻记录时不会把问答第一页再并进来', async () => {
  const second = {
    id: 'a3',
    sessionId: 's3',
    artifactId: 'a3',
    kind: 'qa_pins',
    title: '第二页要点',
    createdAt: '2026-09-20T01:00:00.000Z',
    expiresAt: '2026-10-20T01:00:00.000Z',
    fileId: null,
  }
  const resume2 = {
    id: 'r2',
    taskId: 't2',
    kind: 'optimize',
    status: 'completed',
    createdAt: '2026-09-19T01:00:00.000Z',
  }
  const { page, calls } = setup({
    pages: (_n, params) => {
      if (params.qaCursor === 'qa-2') {
        return Promise.resolve(attach([], { qaRecords: [second], qaNextCursor: null, nextCursor: 'rec-2' }))
      }
      if (params.cursor === 'rec-2') {
        return Promise.resolve(attach([resume2], { qaRecords: [qaMeta], qaNextCursor: null, nextCursor: null }))
      }
      return Promise.resolve(attach([resume], {
        nextCursor: 'rec-2',
        qaRecords: [qaMeta],
        qaNextCursor: 'qa-2',
        qaTotal: 2,
      }))
    },
  })
  page.onShow()
  await flush()
  page.onReachBottom()
  await flush()
  assert.equal(calls[1].qaCursor, 'qa-2')
  assert.equal(calls[1].cursor, 'rec-2')
  assert.match(titleText(page), /第二页要点/)
  assert.equal(titleText(page).split('小青本次要点').length - 1, 1)
  page.onReachBottom()
  await flush()
  assert.equal(calls[2].cursor, 'rec-2')
  assert.equal(calls[2].qaCursor, undefined)
  assert.equal(titleText(page).split('小青本次要点').length - 1, 1)
  assert.match(titleText(page), /简历优化/)
})

test('加载更多失败时不清空已经显示的要点', async () => {
  const { page, toasts } = setup({
    pages: (n) => (n === 1
      ? Promise.resolve(attach([resume], { qaRecords: [qaMeta], qaNextCursor: 'qa-2' }))
      : Promise.reject(new Error('网络错误'))),
  })
  page.onShow()
  await flush()
  page.onReachBottom()
  await flush()
  assert.match(titleText(page), /小青本次要点/)
  assert.match(titleText(page), /简历诊断/)
  assert.equal(page.data.loadError, '')
  assert.equal(page.data.loginRequired, false)
  assert.equal(toasts[0].title, '网络错误')
})

test('换账号和退出登录都会清掉上一个人的要点，晚到的旧响应写不回来', async () => {
  const slow = deferred()
  const { page, state, calls } = setup({
    pages: (n) => {
      if (state.userId === 'B') return Promise.resolve(attach([resume]))
      if (n === 1) return Promise.resolve(attach([], { qaRecords: [qaMeta] }))
      return slow.promise
    },
  })
  page.onShow()
  await flush()
  assert.match(titleText(page), /小青本次要点/)
  page.onShow()
  state.userId = 'B'
  page.onShow()
  assert.equal(titlesOf(page).length, 0, '换账号后先清空，不能留着上一个人的要点等新请求')
  await flush()
  assert.doesNotMatch(titleText(page), /小青本次要点/)
  assert.match(titleText(page), /简历诊断/)
  slow.resolve(attach([], { qaRecords: [{ ...qaMeta, id: 'late', title: '迟到的要点' }] }))
  await flush()
  assert.doesNotMatch(titleText(page), /迟到的要点/)
  assert.doesNotMatch(titleText(page), /小青本次要点/)
  assert.equal(calls.length, 3)

  state.loggedIn = false
  page.onShow()
  assert.equal(page.data.loginRequired, true)
  assert.equal(titlesOf(page).length, 0)
  assert.equal(page.data.loadError, '')
})

test('点开有要点的行只读列出条目；没有要点才去读会话详情', async () => {
  const session = {
    slots: [{ value: '用户问题不该出现' }],
    pins: [{ content: '会话钉不该出现' }],
    artifacts: [{ artifactId: 'a1', payload: { kind: 'qa_pins', pins: [{ content: '把项目结果写具体' }] } }],
  }
  const { page, advisorCalls, modals, deleted } = setup({
    pages: () => Promise.resolve(attach([resume], { qaRecords: [qaMeta, qaPins] })),
    advisor: () => Promise.resolve(session),
  })
  page.onShow()
  await flush()
  page.openRecord({ currentTarget: { dataset: { id: 'qa:a2' } } })
  assert.equal(advisorCalls.length, 0)
  assert.match(modals[0].content, /1\. 先改项目描述/)
  assert.match(modals[0].content, /不含对话正文/)
  assert.doesNotMatch(modals[0].content, /已保存对话全文/)
  page.moreRecord({ currentTarget: { dataset: { id: 'qa:a2' } } })
  assert.equal(deleted(), 0)
  page.openRecord({ currentTarget: { dataset: { id: 'qa:a1' } } })
  await flush()
  assert.deepEqual(advisorCalls, ['s1'])
  const opened = modals[modals.length - 1].content
  assert.match(opened, /把项目结果写具体/)
  assert.doesNotMatch(opened, /用户问题不该出现/)
  assert.doesNotMatch(opened, /会话钉不该出现/)
  assert.match(opened, /不含对话正文/)
})

test('换账号后，上一个人还没读完的要点详情不再弹出来', async () => {
  const slow = deferred()
  const { page, state, modals } = setup({
    pages: () => Promise.resolve(attach([], { qaRecords: [qaMeta] })),
    advisor: () => slow.promise,
  })
  page.onShow()
  await flush()
  page.openRecord({ currentTarget: { dataset: { id: 'qa:a1' } } })
  state.userId = 'B'
  page.onShow()
  await flush()
  slow.resolve({
    artifacts: [{ artifactId: 'a1', payload: { kind: 'qa_pins', pins: [{ content: '不该再出现的要点' }] } }],
  })
  await flush()
  const leaked = modals.some((modal) => /不该再出现的要点/.test(modal.content || ''))
  assert.equal(leaked, false)
})
