// 优化稿编辑区的简介、描述上限必须跟后端 RESUME_DOC_LIMITS 同一份数字。
// 生成简历那条路的 LEN.description 仍是 1000，这里不能跟着改，也不能再写死 600。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MINIAPP = path.resolve(HERE, '../..')
const REPO = path.resolve(MINIAPP, '../..')
const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))
const { RESUME_DOC_LIMITS } = requireMiniapp('../utils/resume-doc-limits.js')

const BACKEND_LIMITS = path.join(REPO, 'services/api/src/ai/resume/resume-doc-limits.ts')
const OPTIMIZE_WXML = path.join(MINIAPP, 'pages/resume-optimize/resume-optimize.wxml')

function backendDocLimits(src) {
  const block = src.match(/export const RESUME_DOC_LIMITS = \{([\s\S]*?)\n\}/)
  assert.ok(block, '后端文件里没有 export const RESUME_DOC_LIMITS')
  const body = block[1]
  function pick(key) {
    const matched = body.match(new RegExp(`(?:^|\\n)\\s*${key}:\\s*(\\d+)\\s*,?\\s*(?:\\n|$)`))
    assert.ok(matched, `后端 RESUME_DOC_LIMITS 没有 ${key}`)
    return Number(matched[1])
  }
  return { summary: pick('summary'), description: pick('description') }
}

function fill(parts, length) {
  let text = ''
  let i = 0
  while (text.length < length) {
    text += parts[i % parts.length]
    i += 1
  }
  return text.slice(0, length)
}

function diffCount(left, right) {
  const a = String(left)
  const b = String(right)
  let count = Math.abs(a.length - b.length)
  const shared = Math.min(a.length, b.length)
  for (let i = 0; i < shared; i += 1) if (a[i] !== b[i]) count += 1
  return count
}

const SUMMARY = fill([
  '我是林知夏，杭州师范大学新闻学本科毕业，过去两年在社区团购团队做用户运营。',
  '日常负责新用户承接、社群答疑和周末市集的活动执行，习惯把一次活动从邀约、到场到复盘写成能交接的记录。',
  '做过三场从零拉起的社区试吃会，单场到场大约八十人，复购主要来自当天留下的微信群。',
  '写文案时会先问店主真正想卖的是哪一款，再决定标题，不堆形容词。',
  '希望下一份工作继续做靠近用户的运营，能独立跟一场活动从方案到复盘。',
], 700)

const EXPERIENCE = fill([
  '在青禾市集负责三个街道社群的日常运营，每天上午回复隔夜消息，把缺货和配送延迟单独记下来交给仓配。',
  '新用户第一周会发三条承接：怎么进群、怎么自提、订单出了问题找谁，避免只丢一张海报。',
  '周末市集负责摊位排期和志愿者分工，活动前一天把物资清单发给店主确认，活动当天在群里报三次到场进度。',
  '有一次冷链酸奶集中破损，先在群里说明可换货的时间，再把受影响的订单号整理成表，当天晚上前回访了大部分用户。',
  '和店主对活动文案时会留下修改原因，下次换人接手不用重新猜。',
  '月度复盘只写三件事：哪类商品复购高、哪条通知没人点、下个月准备停掉什么，不把数据表原样贴进纪要。',
  '带过两名实习生做社群值守，交接时要求他们能独立处理催单和自提改期，而不是每条都来问。',
], 1500)

test('优化稿上限与后端 RESUME_DOC_LIMITS 的 summary、description 逐个相等', () => {
  const backend = backendDocLimits(fs.readFileSync(BACKEND_LIMITS, 'utf8'))
  assert.equal(RESUME_DOC_LIMITS.summary, backend.summary)
  assert.equal(RESUME_DOC_LIMITS.description, backend.description)
  assert.equal(backend.summary, 24000)
  assert.equal(backend.description, 24000)
})

test('优化页简介和两处描述的 textarea 用 DOC_LEN，不再写死 600 或 LEN.description', () => {
  const wxml = fs.readFileSync(OPTIMIZE_WXML, 'utf8')
  const summary = wxml.match(/<textarea[^>]*value="\{\{editor\.summary\}\}"[^>]*>/)
  assert.ok(summary, '找不到简介 textarea')
  assert.match(summary[0], /maxlength="\{\{DOC_LEN\.summary\}\}"/)
  const descriptions = [...wxml.matchAll(/<textarea[^>]*value="\{\{row\.description\}\}"[^>]*>/g)]
  assert.equal(descriptions.length, 2)
  for (const tag of descriptions) {
    assert.match(tag[0], /maxlength="\{\{DOC_LEN\.description\}\}"/)
  }
  assert.doesNotMatch(wxml, /maxlength="600"/)
  assert.doesNotMatch(wxml, /(?<!DOC_)LEN\.description/)
})

function createWx() {
  return {
    navigateTo() {},
    navigateBack() {},
    switchTab() {},
    showToast() {},
    showLoading() {},
    hideLoading() {},
    showModal() {},
    downloadFile() {},
    openDocument() {},
    pageScrollTo() {},
    getStorageSync() { return '' },
    setStorageSync() {},
    removeStorageSync() {},
  }
}

test('700 字简介和 1500 字经历描述进入编辑区，改一个字后仍是全文，导出请求体也是全文', async () => {
  assert.equal(SUMMARY.length, 700)
  assert.equal(EXPERIENCE.length, 1500)
  assert.equal(SUMMARY.includes('测试'), false)
  assert.equal(EXPERIENCE.includes('测试'), false)
  const at = EXPERIENCE.indexOf('群')
  assert.ok(at > 0)
  const edited = `${EXPERIENCE.slice(0, at)}圈${EXPERIENCE.slice(at + 1)}`
  assert.equal(edited.length, 1500)
  assert.equal(diffCount(EXPERIENCE, edited), 1)

  const resume = {
    basic: { name: '林知夏', phone: '13800138000', email: 'linzhixia@example.com', city: '杭州' },
    intention: { position: '用户运营', city: '杭州', jobType: '全职', salary: '面议' },
    summary: SUMMARY,
    education: [{
      school: '杭州师范大学',
      major: '新闻学',
      degree: '本科',
      period: '2019.09-2023.06',
      description: '本科期间在校报跑校园活动，采访过招生咨询会和社团招新，交稿前会自己核对时间和人名。',
    }],
    experience: [{
      company: '青禾市集',
      role: '用户运营',
      period: '2023.07-2025.08',
      description: EXPERIENCE,
    }],
    projects: [],
    skills: ['活动策划', '用户访谈'],
    certificates: ['大学英语六级'],
  }

  const bodies = []
  const page = instantiate(loadPageDefinition('pages/resume-optimize/resume-optimize.js', {
    wx: createWx(),
    modules: {
      auth: { isLoggedIn: () => true, getUser: () => ({ id: 'u1', nickname: '林知夏' }) },
      storage: {
        KEYS: { RESUME_TASK: 'zyd_resume_task' },
        get() { return {} },
      },
      api: {
        getResumeOptimize: () => Promise.resolve({
          taskId: 'task-long',
          status: 'completed',
          modules: [],
          optimizedResume: resume,
        }),
        getResumeExportPricing: () => Promise.resolve({ mode: 'free', unitCents: 0 }),
        getResumeDraft: () => Promise.resolve({}),
        putResumeDraft: () => Promise.resolve({ updatedAt: '2026-11-12T08:00:00.000Z' }),
        getResumeVersions: () => Promise.resolve({ items: [], latestVersion: null }),
        factCheckResume: () => Promise.resolve({ originalAvailable: true, items: [] }),
        exportGeneratedResume: (payload) => {
          bodies.push(payload)
          return Promise.resolve({
            fileId: 'file-1',
            filename: '林知夏-用户运营.pdf',
            printFileUrl: '/api/v1/files/file-print/content?sig=1',
            sizeBytes: 20480,
            pageCount: 2,
            expiresAt: '2026-12-31T00:00:00.000Z',
          })
        },
      },
    },
  }))

  assert.equal(page.data.DOC_LEN.summary, RESUME_DOC_LIMITS.summary)
  assert.equal(page.data.DOC_LEN.description, RESUME_DOC_LIMITS.description)

  page.onLoad({ taskId: 'task-long' })
  await flush()
  await flush()

  assert.equal(page.data.phase, 'done')
  assert.equal(String(page.data.editor.summary), SUMMARY)
  assert.equal(String(page.data.editor.summary).length, 700)
  assert.equal(String(page.data.editor.experience[0].description), EXPERIENCE)
  assert.equal(String(page.data.editor.experience[0].description).length, 1500)

  page.onDraftInput({
    currentTarget: { dataset: { section: 'experience', key: 'description', index: 0 } },
    detail: { value: edited },
  })

  assert.equal(String(page.data.editor.experience[0].description), edited)
  assert.equal(String(page.data.editor.experience[0].description).length, 1500)
  assert.equal(diffCount(EXPERIENCE, page.data.editor.experience[0].description), 1)
  assert.equal(String(page.data.editor.summary), SUMMARY)

  assert.equal(page.data.exportDisabled, false, page.data.exportDisabledReason)
  page.exportResume()
  await flush()
  await flush()
  assert.equal(page.data.factPanel.canConfirm, true, page.data.factPanel.error || '事实核对没有打开')
  page.confirmFacts()
  await flush()

  assert.equal(bodies.length, 1)
  const body = bodies[0]
  assert.equal(String(body.summary), SUMMARY)
  assert.equal(String(body.summary).length, 700)
  assert.equal(String(body.experience[0].description), edited)
  assert.equal(String(body.experience[0].description).length, 1500)
  assert.equal(diffCount(EXPERIENCE, body.experience[0].description), 1)
})
