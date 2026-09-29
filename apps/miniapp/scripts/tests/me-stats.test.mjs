/**
 * 「我的」概览计数（pages/me/me.js）：真跑页面，api 是替身。
 *
 * 钉住的是第 12 件（9/04 评审遗留）要修的事：
 *   - 读取失败时不写成 0，仍显示「—」，并且 statsFailed 打开（页面据此出现「没读到 + 重试」）；
 *   - 一项失败不连坐，读到的照常显示；
 *   - 重试只重读失败的那几项，读到后提示消失；
 *   - 旧请求晚到不能覆盖新结果（切走再回来会重读一次）；
 *   - 退出登录后回到三个「—」，提示不残留。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { deferred, flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

function setup({ loggedIn = true, loaders }) {
  const calls = { resume: 0, docs: 0, order: 0 }
  const auth = { isLoggedIn: () => loggedIn, getUser: () => ({ nickname: '测试' }) }
  const api = {
    getMyResumes: () => { calls.resume += 1; return loaders.resume(calls.resume) },
    getMyDocuments: () => { calls.docs += 1; return loaders.docs(calls.docs) },
    getMyPrintOrders: () => { calls.order += 1; return loaders.order(calls.order) },
  }
  const def = loadPageDefinition('pages/me/me.js', { wx: {}, modules: { auth, api } })
  const page = instantiate(def)
  return { page, calls, auth }
}

const values = (page) => page.data.stats.map((s) => `${s.key}=${s.value}`).join(',')

test('全部读到：显示真实数量，不出现「没读到」', async () => {
  const { page } = setup({ loaders: {
    resume: () => Promise.resolve({ total: 2 }),
    docs: () => Promise.resolve({ items: [1, 2, 3] }),
    order: () => Promise.resolve({ total: 0 }),
  } })
  page.onShow()
  await flush()
  assert.equal(values(page), 'resume=2,docs=3,order=0')
  assert.equal(page.data.statsFailed, false)
})

test('一项失败：该项仍是「—」不是 0，其余照常，并提示可重试', async () => {
  const { page } = setup({ loaders: {
    resume: () => Promise.resolve({ total: 2 }),
    docs: () => Promise.reject(new Error('网络错误')),
    order: () => Promise.resolve({ total: 5 }),
  } })
  page.onShow()
  await flush()
  assert.equal(values(page), 'resume=2,docs=—,order=5')
  assert.equal(page.data.statsFailed, true)
})

test('重试只重读失败的那一项，读到后提示消失', async () => {
  const { page, calls } = setup({ loaders: {
    resume: () => Promise.resolve({ total: 2 }),
    docs: (n) => (n === 1 ? Promise.reject(new Error('网络错误')) : Promise.resolve({ total: 4 })),
    order: () => Promise.resolve({ total: 5 }),
  } })
  page.onShow()
  await flush()
  page.retryStats()
  await flush()
  assert.equal(calls.docs, 2, '失败项重读一次')
  assert.equal(calls.resume, 1, '成功项不重读')
  assert.equal(calls.order, 1, '成功项不重读')
  assert.equal(values(page), 'resume=2,docs=4,order=5')
  assert.equal(page.data.statsFailed, false)
})

test('之前读到过、这次失败：回到「—」，不留旧数冒充当前值', async () => {
  const { page } = setup({ loaders: {
    resume: () => Promise.resolve({ total: 2 }),
    docs: (n) => (n === 1 ? Promise.resolve({ total: 7 }) : Promise.reject(new Error('网络错误'))),
    order: () => Promise.resolve({ total: 5 }),
  } })
  page.onShow()
  await flush()
  assert.equal(values(page), 'resume=2,docs=7,order=5')
  page.onShow()
  await flush()
  assert.equal(values(page), 'resume=2,docs=—,order=5')
  assert.equal(page.data.statsFailed, true)
})

test('旧请求晚到不覆盖新结果', async () => {
  const slow = deferred()
  const { page } = setup({ loaders: {
    resume: (n) => (n === 1 ? slow.promise : Promise.resolve({ total: 9 })),
    docs: () => Promise.resolve({ total: 1 }),
    order: () => Promise.resolve({ total: 1 }),
  } })
  page.onShow()          // 第一次：简历请求挂起
  page.onShow()          // 切走再回来：第二次全部读到
  await flush()
  assert.equal(values(page), 'resume=9,docs=1,order=1')
  slow.reject(new Error('迟到的失败'))
  await flush()
  assert.equal(values(page), 'resume=9,docs=1,order=1', '迟到的旧失败不能把 9 改回「—」')
  assert.equal(page.data.statsFailed, false, '迟到的旧失败不能让提示冒出来')
})

test('未登录：三个「—」，不发请求，不出提示', async () => {
  const { page, calls } = setup({ loggedIn: false, loaders: {
    resume: () => Promise.resolve({ total: 1 }),
    docs: () => Promise.resolve({ total: 1 }),
    order: () => Promise.resolve({ total: 1 }),
  } })
  page.onShow()
  await flush()
  assert.equal(values(page), 'resume=—,docs=—,order=—')
  assert.equal(calls.resume + calls.docs + calls.order, 0)
  assert.equal(page.data.statsFailed, false)
})
