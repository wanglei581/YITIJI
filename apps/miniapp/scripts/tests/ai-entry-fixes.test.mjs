/**
 * OPS1 + VIS2（10/16）：简历优化入口死路；面试入口选项块。真跑页面源码，wx / api / storage 用替身。
 *
 * 守的是 10/16 开发者工具实际模拟器截图里看到的两件事：
 *   - 从「AI 工具」或首页的「简历优化」进去（不带 taskId），只有「未指定优化任务 / 返回」，入口是死路；
 *   - 面试入口选项块文字贴在上沿；「练习时长」标签下的选项只写题数。
 *
 * 无任务态只给两条已鉴权的现有路线（我的简历、上传新简历）。本机缓存的 RESUME_TASK 没有账号归属，
 * 无任务态既不读它、也不显示它的文件名（第一版方案想原地继续它，agy 判需修改，已撤）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MINIAPP, rel), 'utf8')
const RESUME_TASK = 'zyd_resume_task'

/** optimize：每次调用返回什么（函数，拿到第几次调用）。默认永不返回。 */
function loadOptimize({ saved = null, optimize = () => new Promise(() => {}), navFail = false } = {}) {
  const calls = { navigateTo: [], optimize: [], toast: [], reads: [] }
  const wx = {
    navigateTo(opts) {
      calls.navigateTo.push(opts.url)
      if (navFail && opts.fail) opts.fail({ errMsg: 'navigateTo:fail' })
    },
    navigateBack() {},
    switchTab() {},
    showToast(opts) { calls.toast.push(opts.title) },
    showLoading() {},
    hideLoading() {},
    showModal() {},
  }
  const api = {
    getResumeExportPricing: () => new Promise(() => {}),
    getMyBenefits: () => new Promise(() => {}),
    getResumeOptimize: (taskId, token) => {
      calls.optimize.push({ taskId, token })
      return optimize(calls.optimize.length)
    },
  }
  const storage = {
    KEYS: { RESUME_TASK },
    get: (key) => { calls.reads.push(key); return key === RESUME_TASK ? saved : null },
    set() {},
  }
  const auth = { isLoggedIn: () => true, getUser: () => ({ id: 'member-1' }) }
  const def = loadPageDefinition('pages/resume-optimize/resume-optimize.js', { wx, modules: { api, storage, auth } })
  return { page: instantiate(def), calls }
}

const OTHER_ACCOUNT_TASK = { taskId: 't-other', fileName: '别人的简历.pdf', accessToken: 'tok-other' }

test('简历优化：不带任务进入停在「选择要优化的简历」，不发请求，也不读、不显示本机缓存的任务', async () => {
  const { page, calls } = loadOptimize({ saved: OTHER_ACCOUNT_TASK })
  page.onLoad({})
  await flush()
  assert.equal(page.data.phase, 'no-task')
  assert.equal(calls.optimize.length, 0)
  assert.equal(calls.reads.includes(RESUME_TASK), false, '本机缓存没有账号归属，无任务态不能读它')
  const shown = JSON.stringify(page.data)
  assert.equal(shown.includes('别人的简历'), false, '页面数据里不能出现缓存的文件名')
  assert.equal(shown.includes('t-other'), false, '页面数据里不能出现缓存的 taskId')
})

test('简历优化：「从我的简历选择」去我的简历，「上传新简历」去选文件的上传页；跳转失败给提示', () => {
  const { page, calls } = loadOptimize()
  page.onLoad({})
  page.toResumes()
  page.tapReupload()
  assert.deepEqual([...calls.navigateTo], ['/pages/resumes/resumes', '/pages/resume-upload/resume-upload'])

  const failing = loadOptimize({ navFail: true })
  failing.page.onLoad({})
  failing.page.toResumes()
  assert.deepEqual([...failing.calls.toast], ['页面跳转失败'])
})

test('简历优化：带 taskId 进入照旧——与本机任务同一份才带本机令牌，不同就不带', async () => {
  const same = loadOptimize({ saved: { taskId: 't-1', accessToken: 'tok-1' } })
  same.page.onLoad({ taskId: 't-1' })
  await flush()
  assert.equal(same.page.data.phase, 'loading')
  assert.deepEqual({ ...same.calls.optimize[0] }, { taskId: 't-1', token: 'tok-1' })

  const other = loadOptimize({ saved: OTHER_ACCOUNT_TASK })
  other.page.onLoad({ taskId: 't-1' })
  await flush()
  assert.deepEqual({ ...other.calls.optimize[0] }, { taskId: 't-1', token: '' })
})

test('简历优化失败态：记录不存在或无权访问——可以重试，也能另选一份', async () => {
  const { page, calls } = loadOptimize({
    optimize: (n) => (n === 1 ? Promise.reject({ code: 'AI_TASK_NOT_FOUND', message: '任务不存在，请先提交简历解析' }) : new Promise(() => {})),
  })
  page.onLoad({ taskId: 't-1' })
  await flush()
  assert.equal(page.data.phase, 'failed')
  assert.equal(page.data.failMsg, '优化记录不存在或无权访问')
  assert.equal(page.data.needReupload, false)
  page.tapRetry()
  await flush()
  assert.equal(calls.optimize.length, 2, '重试是用户自己点的才再请求')
  page.toResumes()
  assert.deepEqual([...calls.navigateTo], ['/pages/resumes/resumes'])
})

test('简历优化失败态：原文已清理——改走重新上传，重试按钮不再发请求', async () => {
  const { page, calls } = loadOptimize({
    optimize: () => Promise.resolve({ taskId: 't-1', status: 'failed', failReason: '简历原文已按隐私策略自动清理，请重新上传简历后再生成优化版' }),
  })
  page.onLoad({ taskId: 't-1' })
  await flush()
  assert.equal(page.data.phase, 'failed')
  assert.equal(page.data.needReupload, true)
  page.tapRetry()
  await flush()
  assert.equal(calls.optimize.length, 1)
})

test('简历优化失败态：非终态「优化任务未完成」保留手动重试，页面不自动轮询', async () => {
  const { page, calls } = loadOptimize({ optimize: () => Promise.resolve({ taskId: 't-1', status: 'pending' }) })
  page.onLoad({ taskId: 't-1' })
  await flush()
  await flush()
  assert.equal(page.data.phase, 'failed')
  assert.equal(page.data.failMsg, '优化任务未完成')
  assert.equal(page.data.needReupload, false)
  assert.equal(calls.optimize.length, 1, '不自动再请求')
  page.tapRetry()
  await flush()
  assert.equal(calls.optimize.length, 2)
})

/** 把 navigateTo 的 url 当成真实落点：必须是 app.json 注册过的页，再用 url 里的参数跑它的 onLoad。 */
function landOn(url, { modules = {}, loggedIn = true } = {}) {
  const [route, query = ''] = url.replace(/^\//, '').split('?')
  const app = JSON.parse(read('app.json'))
  const registered = [...app.pages, ...(app.subpackages || app.subPackages || []).flatMap((p) => p.pages.map((name) => `${p.root}/${name}`))]
  assert.ok(registered.includes(route), `${route} 没有在 app.json 注册`)
  const calls = { chooseMessageFile: 0, chooseMedia: 0, getMyResumes: 0 }
  const wx = {
    navigateTo() {}, redirectTo() {}, navigateBack() {}, switchTab() {}, showToast() {}, showModal() {},
    showLoading() {}, hideLoading() {},
    chooseMessageFile() { calls.chooseMessageFile += 1 },
    chooseMedia() { calls.chooseMedia += 1 },
  }
  const api = {
    getDocumentConversionCapabilities: () => new Promise(() => {}),
    getMyResumes: () => { calls.getMyResumes += 1; return new Promise(() => {}) },
  }
  const auth = { isLoggedIn: () => loggedIn, getUser: () => (loggedIn ? { id: 'member-1' } : null) }
  const def = loadPageDefinition(`${route}.js`, { wx, modules: { api, auth, ...modules } })
  const page = instantiate(def)
  const options = Object.fromEntries(new URLSearchParams(query))
  page.onLoad(options)
  if (typeof page.onShow === 'function') page.onShow()
  return { page, calls, route, wxml: read(`${route}.wxml`) }
}

test('落点：「上传新简历」和失败态「重新上传简历」都落在能选文件的上传页，不是报错页', async () => {
  for (const enter of ['no-task', 'failed']) {
    const { page, calls } = loadOptimize({
      optimize: () => Promise.resolve({ taskId: 't-1', status: 'failed', failReason: '简历原文已按隐私策略自动清理，请重新上传简历后再生成优化版' }),
    })
    page.onLoad(enter === 'no-task' ? {} : { taskId: 't-1' })
    await flush()
    if (enter === 'failed') assert.equal(page.data.needReupload, true, '失败态显示的是「重新上传简历」')
    page.tapReupload()
    const url = calls.navigateTo.at(-1)
    const landed = landOn(url)
    assert.equal(landed.route, 'pages/resume-upload/resume-upload', enter)
    assert.match(landed.wxml, /bindtap="tapUploadFile"/, '落点页上有选文件的入口')
    landed.page.tapUploadFile()
    assert.equal(landed.calls.chooseMessageFile, 1, `${enter}：点了真的打开选文件`)
  }
})

test('落点反例：不带 fileId 直接进解析页会停在「缺少待解析的简历文件」——所以不能跳那里', () => {
  const sessionStub = { ownerId: () => null, sameIdentity: () => true, nonemptyToken: (v) => v || '', persistResumeTask: () => true }
  const landed = landOn('/pages/resume-parse/resume-parse', { modules: { 'resume-parse-session': sessionStub } })
  assert.equal(landed.page.data.phase, 'missing')
  assert.equal(landed.page.data.atext, '缺少待解析的简历文件')
})

test('落点：「从我的简历选择」未登录先给登录，已登录才按本人取列表', () => {
  const guest = landOn('/pages/resumes/resumes', { loggedIn: false })
  assert.equal(guest.page.data.loginRequired, true)
  assert.equal(guest.calls.getMyResumes, 0, '未登录不取列表')
  // FLOW1b：登录卡片前面多了「恢复中 / 可重试」两支，登录卡片改成同一条链上的 wx:elif。
  assert.match(guest.wxml, /wx:elif="\{\{loginRequired\}\}"[\s\S]*?bindtap="goLogin">微信一键登录<\/view>/)
  const member = landOn('/pages/resumes/resumes', { loggedIn: true })
  assert.equal(member.page.data.loginRequired, false)
  assert.equal(member.calls.getMyResumes, 1)
})

test('简历优化模板：无任务态只有三条去路，不绑定任何缓存字段', () => {
  const wxml = read('pages/resume-optimize/resume-optimize.wxml')
  const block = wxml.slice(wxml.indexOf(`wx:if="{{phase === 'no-task'}}"`), wxml.indexOf(`wx:if="{{phase === 'loading'}}"`))
  assert.match(block, /<view class="btn primary block tap" hover-class="tap-press" bindtap="toResumes">从我的简历选择<\/view>/)
  assert.match(block, /bindtap="tapReupload">上传新简历<\/view>/)
  assert.match(block, /bindtap="goBack">返回<\/view>/)
  assert.doesNotMatch(block, /saved|continueSaved|继续优化/, '不原地继续本机缓存的任务')
  assert.doesNotMatch(block, /未指定优化任务|请从简历诊断页发起/, '不再停在只能返回的说法上')
})

test('简历优化模板：任何失败都有「选择其他简历」；提示语不再把所有失败都说成真实性校验', () => {
  const wxml = read('pages/resume-optimize/resume-optimize.wxml')
  const block = wxml
    .slice(wxml.indexOf(`wx:if="{{phase === 'failed'}}"`), wxml.indexOf(`wx:if="{{phase === 'done' && isMock}}"`))
    .replace(/<!--[\s\S]*?-->/g, '') // 只看屏上会出现的字，模板注释不算
  assert.match(block, /<view class="btn ghost tap fail-btn" hover-class="tap-press" bindtap="toResumes">选择其他简历<\/view>/, '不挂在 needReupload 条件上')
  assert.doesNotMatch(block, /真实性校验/, '原因在上一行原话里，提示只说还能做什么')
  assert.match(block, /bindtap="tapRetry">重试<\/view>/)
  assert.match(block, /bindtap="tapReupload">重新上传简历<\/view>/)
})

test('面试入口：练习时长的选项同时写时长和题数，与 durationMin 和后端换算一致', () => {
  const wx = { navigateTo() {}, showToast() {}, setStorageSync() {}, getStorageSync() { return '' } }
  const def = loadPageDefinition('pages/interview-entry/interview-entry.js', {
    wx,
    modules: { api: {}, auth: { isLoggedIn: () => true, getUser: () => ({ id: 'm' }) } },
  })
  const target = { 3: 4, 5: 6, 8: 8 } // 后端 DURATION_TARGET
  const durations = def.data.durations
  assert.equal(durations.length, 3)
  for (const d of durations) {
    assert.ok(d.label.includes(`约${d.val}分钟`), d.label)
    assert.ok(d.label.includes(`${target[d.val]}题`), d.label)
  }
})

test('面试入口：选项块文字纵向居中，触控高度不缩', () => {
  const css = read('pages/interview-entry/interview-entry.wxss')
  const at = css.indexOf('.opt-chip {')
  const rule = css.slice(at, css.indexOf('}', at))
  assert.match(rule, /display: inline-flex/)
  assert.match(rule, /align-items: center/)
  assert.match(rule, /min-height: 96rpx/)
  assert.match(rule, /font-size: var\(--fs-base\)/)
})
