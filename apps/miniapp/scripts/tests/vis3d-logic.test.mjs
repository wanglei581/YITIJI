/**
 * VIS3d（10/17）：
 *   - RESUME_TASK 账号归属：同一部手机换号以后，诊断、职业规划、岗位匹配、自我探索不再拿上一位的任务和文件名；
 *   - 简历优化在 AI 额度用完或不可用时，提示语说「可以先（用模板）手动填写」，失败态要真的给这条路。
 * 写的那一侧（解析页落库带 ownerId）在 page-lifecycle.test.mjs 的 RP-OWN。
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))
const session = requireMiniapp('./resume-parse-session.js')
const KEY = 'zyd_resume_task'
const authAs = (id) => ({ isLoggedIn: () => !!id, getUser: () => (id ? { id } : null) })
const pending = () => new Promise(() => {})
const anyApi = (overrides = {}) => new Proxy(overrides, { get: (t, k) => (k in t ? t[k] : () => pending()) })
const storageWith = (saved) => ({ KEYS: { RESUME_TASK: KEY }, get: (k) => (k === KEY ? saved : null), set() { return true }, read: () => ({ ok: true, found: !!saved, value: saved }), remove() {} })
const wxStub = (calls = { navigateTo: [] }) => ({
  navigateTo: (o) => calls.navigateTo.push(o.url), redirectTo() {}, navigateBack() {}, switchTab() {}, reLaunch() {},
  showToast() {}, showModal() {}, showLoading() {}, hideLoading() {}, setNavigationBarTitle() {},
  getWindowInfo: () => ({ windowWidth: 375, pixelRatio: 2 }), getSystemInfoSync: () => ({ windowWidth: 375, pixelRatio: 2 }),
  createSelectorQuery: () => ({ select: () => ({ fields: () => ({ exec() {} }), boundingClientRect: () => ({ exec() {} }) }) }),
  getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
})

const OTHERS = { taskId: 'T-B', ownerId: 'B', fileName: 'B的简历.pdf', accessToken: '' }
const MINE = { taskId: 'T-A', ownerId: 'A', fileName: 'A的简历.pdf', accessToken: '' }

test('ownedResumeTask：新记录按 ownerId 严格比对；旧记录带令牌按匿名、不带令牌一律不用', () => {
  const own = session.ownedResumeTask
  assert.equal(own(MINE, authAs('A')), MINE)
  assert.equal(own(OTHERS, authAs('A')), null)
  const anon = { taskId: 'T-N', ownerId: null, accessToken: 'tok', fileName: 'x.pdf' }
  assert.equal(own(anon, authAs(null)), anon)
  assert.equal(own(anon, authAs('A')), null, '匿名任务登录后不再自动拿来用（隐私优先）')
  const legacyAnon = { taskId: 'T-L', accessToken: 'tok', fileName: 'x.pdf' }
  assert.equal(own(legacyAnon, authAs(null)), legacyAnon)
  assert.equal(own(legacyAnon, authAs('A')), null)
  assert.equal(own({ taskId: 'T-M', accessToken: '', fileName: 'x.pdf' }, authAs('A')), null, '不知道是哪位会员的旧记录不用')
  assert.equal(own(null, authAs('A')), null)
  assert.equal(own({ fileName: 'x.pdf' }, authAs('A')), null)
})

function load(rel, saved, user, apiOverrides, calls) {
  const def = loadPageDefinition(rel, { wx: wxStub(calls), modules: { api: anyApi(apiOverrides), auth: authAs(user), storage: storageWith(saved) } })
  return instantiate(def)
}

test('诊断：存的是别人的任务时，不出「查看上一次的诊断」也不露文件名；是自己的照旧', async () => {
  const other = load('pages/resume-diagnose/resume-diagnose.js', OTHERS, 'A')
  other.onLoad({})
  await flush()
  assert.equal(other.data.hasSavedTask, false)
  assert.equal(other.data.savedFileName, '')
  other.viewSaved()
  assert.notEqual(other.data.taskId, 'T-B', 'viewSaved 也不能拿别人的任务')
  const mine = load('pages/resume-diagnose/resume-diagnose.js', MINE, 'A')
  mine.onLoad({})
  await flush()
  assert.equal(mine.data.hasSavedTask, true)
  assert.equal(mine.data.savedFileName, 'A的简历.pdf')
})

test('职业规划、岗位匹配：存的是别人的任务时进无任务态；是自己的照旧拿来用', async () => {
  for (const rel of ['pages/career-plan/career-plan.js', 'pages/job-fit/job-fit.js']) {
    const other = load(rel, OTHERS, 'A')
    other.onLoad({})
    await flush()
    assert.equal(other.data.phase, 'no-task', rel)
    assert.notEqual(other.data.taskId, 'T-B', rel)
    assert.doesNotMatch(JSON.stringify(other.data), /B的简历/, rel)
    const mine = load(rel, MINE, 'A')
    mine.onLoad({})
    await flush()
    assert.equal(mine.data.taskId, 'T-A', rel)
    assert.equal(mine.data.resumeName, 'A的简历.pdf', rel)
  }
})

test('自我探索：不拿别人的匿名令牌当种子；自己的照旧', () => {
  const other = load('pages/self-explore/self-explore.js', { taskId: 'T-B', ownerId: null, accessToken: 'tok-B' }, 'A')
  other.onLoad({})
  assert.equal(other._token, '')
  const mine = load('pages/self-explore/self-explore.js', { taskId: 'T-N', ownerId: null, accessToken: 'tok-N' }, null)
  mine.onLoad({})
  assert.equal(mine._token, 'tok-N')
})

async function optimizeFailing(failure) {
  const calls = { navigateTo: [] }
  const api = { getResumeOptimize: () => (failure.reject ? Promise.reject(failure.reject) : Promise.resolve(failure.resolve)) }
  const page = load('pages/resume-optimize/resume-optimize.js', null, 'A', api, calls)
  page.onLoad({ taskId: 'T-A' })
  await flush()
  await flush()
  return { page, calls }
}

test('简历优化：额度用完或 AI 不可用时，失败态给「按模板手动填写」，点了到「从零建一份简历」', async () => {
  for (const code of ['AI_BUDGET_EXHAUSTED', 'AI_BUDGET_UNAVAILABLE']) {
    const { page, calls } = await optimizeFailing({ reject: { code, message: '今天的 AI 额度已用完，明天恢复；这一步可以先用模板手动填写，打印照常可用' } })
    assert.equal(page.data.phase, 'failed', code)
    assert.equal(page.data.canManual, true, code)
    page.toManualBuild()
    assert.deepEqual([...calls.navigateTo], ['/pages/resume-build/resume-build'], code)
  }
  const provider = await optimizeFailing({ resolve: { taskId: 'T-A', status: 'failed', failReason: 'AI 暂时不可用，可以先按模板手动填写' } })
  assert.equal(provider.page.data.canManual, true, '模型层额度问题：服务端原话说可以按模板手动填写')
})

test('简历优化：别的失败不给「按模板手动填写」', async () => {
  const notFound = await optimizeFailing({ reject: { code: 'AI_TASK_NOT_FOUND', message: '' } })
  assert.equal(notFound.page.data.canManual, false)
  const fabricated = await optimizeFailing({ resolve: { taskId: 'T-A', status: 'failed', failReason: '优化结果包含无法从原文确认的信息，系统已拦截，请重新生成或检查原文' } })
  assert.equal(fabricated.page.data.canManual, false)
})
