/**
 * 本人求职备忘本（pages/job-tracker）与 3 分钟微面试快练（pages/interview-entry）单测：
 * - §4.4A 字段白名单（绝不发送 jobId / channel / statusSource / resumeFileId / consentId / 企业字段）
 * - 未登录不请求、账号切换/登出清个人数据且丢弃迟到响应、分页游标与去重
 * - POST 超时不自动重发、显式提示先刷新核对避免重复
 * - 3 分钟快练 (?quick=1) 仅预选整数 3、热门方向可改写、不自动建场、防双击、不带简历
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { deferred, flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))
const trackerApiMod = requireMiniapp('./api-job-tracker.js')

test('§4.4A 白名单：buildCreatePayload / buildUpdatePayload 剔除一切禁止字段与 jobId', () => {
  const created = trackerApiMod.buildCreatePayload({
    jobId: 'job-123',
    companyName: '  青岛某科技公司  ',
    positionTitle: '  前端开发工程师  ',
    status: 'applied',
    note: '  准备二面项目复盘  ',
    selfReportedAt: '2026-11-24T00:00:00.000Z',
    channel: 'platform',
    statusSource: 'employer_feedback',
    resumeFileId: 'file-1',
    consentId: 'consent-1',
    sourceName: '外部渠道',
    endUserId: 'u-other',
    employerId: 'emp-1',
    companyProfileId: 'cp-1',
    recruiterId: 'hr-1',
  })
  assert.deepEqual(Object.keys(created).sort(), ['companyName', 'note', 'positionTitle', 'selfReportedAt', 'status'])
  assert.equal(created.companyName, '青岛某科技公司')
  assert.equal(created.positionTitle, '前端开发工程师')
  assert.equal(created.status, 'applied')
  assert.equal('jobId' in created, false)
  assert.equal('channel' in created, false)
  assert.equal('statusSource' in created, false)
  assert.equal('resumeFileId' in created, false)
  assert.equal('consentId' in created, false)

  const cleared = trackerApiMod.buildUpdatePayload({
    jobId: 'job-999',
    status: 'interviewing',
    selfReportedAt: null,
    channel: 'platform',
    statusSource: 'employer_feedback',
  })
  assert.deepEqual(Object.keys(cleared).sort(), ['selfReportedAt', 'status'])
  assert.equal(cleared.selfReportedAt, null)
  assert.equal(cleared.status, 'interviewing')
})

function setupTracker({ user = { id: 'u-a' }, apiOverrides = {} } = {}) {
  let currentUser = user
  const listeners = new Set()
  const calls = { list: [], create: [], update: [], del: [], nav: [], toast: [], modal: [] }

  const auth = {
    isLoggedIn: () => Boolean(currentUser),
    getUser: () => currentUser,
    subscribeSessionChange(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    _switchUser(nextUser) {
      currentUser = nextUser
      listeners.forEach((fn) => fn({ reason: nextUser ? 'switch' : 'logout' }))
    },
  }

  const trackerApi = {
    listJobApplications: (q) => {
      calls.list.push(q)
      return Promise.resolve({ items: [], nextCursor: null, total: 0 })
    },
    createJobApplication: (body) => {
      calls.create.push(body)
      return Promise.resolve({ id: 'ja-new', ...body })
    },
    updateJobApplication: (id, body) => {
      calls.update.push({ id, body })
      return Promise.resolve({ id, ...body })
    },
    deleteJobApplication: (id) => {
      calls.del.push(id)
      return Promise.resolve({ removed: true })
    },
    ...apiOverrides,
  }

  const wx = {
    navigateTo: (o) => calls.nav.push(o.url),
    switchTab: (o) => calls.nav.push(o.url),
    navigateBack: () => {},
    showToast: (o) => calls.toast.push(o.title),
    showModal: (o) => calls.modal.push(o),
  }

  const def = loadPageDefinition('pages/job-tracker/job-tracker.js', {
    wx,
    modules: { auth, 'api-job-tracker': trackerApi },
  })
  const page = instantiate(def)
  page.onLoad({})
  return { page, calls, auth }
}

test('未登录不发任何列表请求，展示登录引导', async () => {
  const { page, calls } = setupTracker({ user: null })
  page.onShow()
  await flush()
  assert.equal(page.data.isLoggedIn, false)
  assert.equal(calls.list.length, 0)
})

test('分页游标、总数展示与触底去重追加，切换筛选重置游标', async () => {
  let reqCount = 0
  const { page, calls } = setupTracker({
    apiOverrides: {
      listJobApplications: (q) => {
        calls.list.push(q)
        reqCount += 1
        if (reqCount === 1) {
          return Promise.resolve({
            items: [{ id: 'ja-1', companyName: '公司A', positionTitle: '产品经理', status: 'applied' }],
            nextCursor: 'cur-2',
            total: 25,
          })
        }
        if (reqCount === 2) {
          return Promise.resolve({
            items: [
              { id: 'ja-1', companyName: '公司A', positionTitle: '产品经理', status: 'applied' },
              { id: 'ja-2', companyName: '公司B', positionTitle: '前端开发', status: 'interviewing' },
            ],
            nextCursor: null,
            total: 25,
          })
        }
        return Promise.resolve({ items: [], nextCursor: null, total: 0 })
      },
    },
  })

  page.onShow()
  await flush()
  assert.equal(page.data.total, 25, '总数来自服务端 total 而非当前页长度')
  assert.equal(page.data.items.length, 1)
  assert.equal(page.data.items[0].statusLabel, '已自填投递')
  assert.equal(page.data.items[0].sourceBadge, '本人自填')

  page.onReachBottom()
  await flush()
  assert.equal(calls.list[1].cursor, 'cur-2')
  assert.deepEqual(Array.from(page.data.items, (i) => i.id), ['ja-1', 'ja-2'], '触底按 id 去重追加')

  page.tapFilter({ currentTarget: { dataset: { key: 'interviewing' } } })
  await flush()
  assert.equal(calls.list[2].status, 'interviewing')
  assert.equal(calls.list[2].cursor, undefined, '切换筛选必须重置游标')
})

test('账号切换/登出立即清空个人记录并丢弃上一位用户的迟到响应', async () => {
  const slowA = deferred()
  let count = 0
  const { page, auth } = setupTracker({
    user: { id: 'u-a' },
    apiOverrides: {
      listJobApplications: () => {
        count += 1
        if (count === 1) return slowA.promise
        return Promise.resolve({
          items: [{ id: 'ja-b1', companyName: 'B公司', positionTitle: 'B岗位', status: 'intention' }],
          nextCursor: null,
          total: 1,
        })
      },
    },
  })

  page.onShow()
  assert.equal(page.data.loading, true)

  // 用户 A 登出并切换为用户 B
  auth._switchUser(null)
  assert.equal(page.data.isLoggedIn, false)
  assert.equal(page.data.items.length, 0)
  assert.equal(page.data.loading, false)

  auth._switchUser({ id: 'u-b' })
  page.onShow()
  await flush()
  assert.deepEqual(Array.from(page.data.items, (i) => i.id), ['ja-b1'])

  // A 的旧请求迟到返回，绝不能覆盖 B 的数据
  slowA.resolve({
    items: [{ id: 'ja-a-leak', companyName: 'A隐私公司', positionTitle: 'A岗位', status: 'offered' }],
    nextCursor: null,
    total: 9,
  })
  await flush()
  assert.deepEqual(Array.from(page.data.items, (i) => i.id), ['ja-b1'])
  assert.equal(page.data.total, 1)
})

test('POST 超时不自动重发，提示先刷新核对避免重复', async () => {
  const { page, calls } = setupTracker({
    apiOverrides: {
      createJobApplication: (body) => {
        calls.create.push(body)
        return Promise.reject(Object.assign(new Error('request:fail timeout'), { code: 'NETWORK_ERROR' }))
      },
    },
  })
  page.onShow()
  await flush()

  page.openCreate()
  page.onCompanyInput({ detail: { value: '星辰科技' } })
  page.onPositionInput({ detail: { value: '运营专员' } })
  page.submitForm()
  await flush()

  assert.equal(calls.create.length, 1, '绝不自动重发 POST')
  assert.equal(page.data.uncertainSubmit, true, '给出刷新核对提示条')
  assert.equal(page.data.saving, false)
  assert.ok(calls.list.length >= 2, '自动刷新一次列表让用户核对')
})

test('单条推进防双击与删除幂等刷新', async () => {
  const slowPatch = deferred()
  const { page, calls } = setupTracker({
    apiOverrides: {
      listJobApplications: () => Promise.resolve({
        items: [{ id: 'ja-1', companyName: '示例单位', positionTitle: '行政专员', status: 'intention' }],
        nextCursor: null,
        total: 1,
      }),
      updateJobApplication: (id, body) => {
        calls.update.push({ id, body })
        return slowPatch.promise
      },
    },
  })
  page.onShow()
  await flush()

  const ev = { currentTarget: { dataset: { id: 'ja-1', next: 'applied' } } }
  page.tapAdvance(ev)
  page.tapAdvance(ev)
  assert.equal(calls.update.length, 1, '同一条目写入串行防连点')
  slowPatch.resolve({ id: 'ja-1', status: 'applied' })
  await flush()
  assert.equal(page.data.busyMap['ja-1'], undefined)

  page.tapDelete({ currentTarget: { dataset: { id: 'ja-1' } } })
  assert.equal(calls.modal.length, 1)
  calls.modal[0].success({ confirm: true })
  await flush()
  assert.deepEqual(calls.del, ['ja-1'])
})

test('合规模板断言：常驻本人自填声明条与「记录一笔」主按钮，零违禁招聘文案', () => {
  const wxml = fs.readFileSync(path.join(MINIAPP, 'pages/job-tracker/job-tracker.wxml'), 'utf8')
  assert.ok(wxml.includes('本人自填备忘 · 仅本人可见，不向任何企业或第三方回传'))
  assert.ok(wxml.includes('记录一笔'))
  assert.ok(wxml.includes('{{item.sourceBadge}}'))
  for (const banned of ['一键投递', '立即投递', '平台投递', '去来源平台投递', '扫码投递']) {
    assert.equal(wxml.includes(banned), false, `模板不得出现 ${banned}`)
  }
})

test('3 分钟微面试快练：?quick=1 预选整数 3、热门方向可改写、不自动建场且防双击', async () => {
  const pending = deferred()
  const sent = []
  const nav = []
  const wx = {
    showToast: () => {},
    navigateTo: (o) => nav.push(o.url),
    redirectTo: (o) => nav.push(o.url),
    navigateBack: () => {},
    switchTab: () => {},
  }
  const def = loadPageDefinition('pages/interview-entry/interview-entry.js', {
    wx,
    modules: {
      api: {
        createInterview: (payload) => {
          sent.push(payload)
          return pending.promise
        },
      },
      storage: { KEYS: { INTERVIEW_SESSION: 'INTERVIEW_SESSION' }, get: () => null, set: () => true },
    },
  })
  const page = instantiate(def)
  page.onLoad({ quick: '1', position: encodeURIComponent('前端开发') })
  assert.equal(page.data.activeDuration, 3)
  assert.equal(typeof page.data.activeDuration, 'number')
  assert.equal(page.data.form.position, '前端开发')
  assert.equal(sent.length, 0, '进入页面绝不自动建场')

  page.tapHotPosition({ currentTarget: { dataset: { pos: '产品经理' } } })
  assert.equal(page.data.form.position, '产品经理')
  page.inputPosition({ detail: { value: '资深产品经理' } })
  assert.equal(page.data.form.position, '资深产品经理')

  const p1 = page.tapStart()
  const p2 = page.tapStart()
  assert.equal(sent.length, 1, 'creating 锁防止重复建场')
  assert.equal(sent[0].durationMin, 3)
  assert.equal(typeof sent[0].durationMin, 'number')
  assert.equal(sent[0].position, '资深产品经理')
  assert.equal('resumeFileId' in sent[0], false)

  pending.resolve({ sessionId: 'sess-quick-1', accessToken: 'tok-1', questionTarget: 4 })
  await Promise.all([p1, p2])
  assert.deepEqual(nav, ['/pages/interview-qa/interview-qa?sessionId=sess-quick-1'])
})
