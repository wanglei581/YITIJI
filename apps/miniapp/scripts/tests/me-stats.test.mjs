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
  const calls = { resume: 0, docs: 0, order: 0, cloud: 0 }
  const auth = { isLoggedIn: () => loggedIn, getUser: () => ({ nickname: '测试' }) }
  const api = {
    getMyResumes: () => { calls.resume += 1; return loaders.resume(calls.resume) },
    getMyDocuments: () => { calls.docs += 1; return loaders.docs(calls.docs) },
    getMyPrintOrders: () => { calls.order += 1; return loaders.order(calls.order) },
    // 手机单（还没到机）：默认没有，个别用例覆盖
    getMyCloudPrintOrders: () => { calls.cloud += 1; return (loaders.cloud || (() => Promise.resolve([])))(calls.cloud) },
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

// ── 打印单要把手机下的单也算上（走查 9/30：王堃订单页有 1 张过期没取的手机单，「我的」却显示 0）──
test('打印单 = 取件后的打印任务 + 还没到机的手机单', async () => {
  const { page } = setup({ loaders: {
    resume: () => Promise.resolve({ total: 0 }),
    docs: () => Promise.resolve({ total: 0 }),
    order: () => Promise.resolve({ total: 3, items: [] }),
    cloud: () => Promise.resolve([{ id: 'o1' }, { id: 'o2' }]),
  } })
  page.onShow()
  await flush()
  assert.equal(values(page), 'resume=0,docs=0,order=5')
})

test('只有一张手机单（没取件）：打印单是 1，不是 0', async () => {
  const { page } = setup({ loaders: {
    resume: () => Promise.resolve({ total: 0 }),
    docs: () => Promise.resolve({ total: 0 }),
    order: () => Promise.resolve({ total: 0, items: [] }),
    cloud: () => Promise.resolve([{ id: 'o1', pickupStatus: 'expired' }]),
  } })
  page.onShow()
  await flush()
  assert.equal(values(page), 'resume=0,docs=0,order=1')
})

test('手机单那段满 50 条上限：写成「N+」，不装精确', async () => {
  const { page } = setup({ loaders: {
    resume: () => Promise.resolve({ total: 0 }),
    docs: () => Promise.resolve({ total: 0 }),
    order: () => Promise.resolve({ total: 4, items: [] }),
    cloud: () => Promise.resolve(Array.from({ length: 50 }, (_, i) => ({ id: 'o' + i }))),
  } })
  page.onShow()
  await flush()
  assert.equal(values(page), 'resume=0,docs=0,order=54+')
})

test('手机单那段没读到：打印单整项「—」并提示可重试，不拿半个数冒充', async () => {
  const { page } = setup({ loaders: {
    resume: () => Promise.resolve({ total: 0 }),
    docs: () => Promise.resolve({ total: 0 }),
    order: () => Promise.resolve({ total: 3, items: [] }),
    cloud: () => Promise.reject(new Error('网络错误')),
  } })
  page.onShow()
  await flush()
  assert.equal(values(page), 'resume=0,docs=0,order=—')
  assert.equal(page.data.statsFailed, true)
})
