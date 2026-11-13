// 优化稿编辑区的简介、描述、技能、证书上限必须跟后端 RESUME_DOC_LIMITS 同一份数字。
// 生成简历那条路的 LEN.description 仍是 1000，这里不能跟着改，也不能再写死 600 或 800。
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
const { RESUME_DOC_LIMITS, LIST_BOX_LIMITS, exportListErrors } = requireMiniapp('../utils/resume-doc-limits.js')
const { parseList, buildExportPayload } = requireMiniapp('../utils/resume-build-model.js')
const draft = requireMiniapp('../pages/resume-optimize/draft.js')

const BACKEND_LIMITS = path.join(REPO, 'services/api/src/ai/resume/resume-doc-limits.ts')
const LIMITS_JS = path.join(MINIAPP, 'utils/resume-doc-limits.js')
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
  return {
    summary: pick('summary'),
    description: pick('description'),
    skills: pick('skills'),
    skill: pick('skill'),
    certificates: pick('certificates'),
    certificate: pick('certificate'),
  }
}

// 与 utils/resume-doc-limits.js 的 joinedListLimit 同一条式子，测试自己算，不调用那份实现。
function joinedListLimit(count, itemLength) {
  return count * itemLength + (count - 1)
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

test('优化稿上限与后端 RESUME_DOC_LIMITS 的 skills、skill、certificates、certificate 逐个相等', () => {
  const backend = backendDocLimits(fs.readFileSync(BACKEND_LIMITS, 'utf8'))
  assert.equal(RESUME_DOC_LIMITS.skills, backend.skills)
  assert.equal(RESUME_DOC_LIMITS.skill, backend.skill)
  assert.equal(RESUME_DOC_LIMITS.certificates, backend.certificates)
  assert.equal(RESUME_DOC_LIMITS.certificate, backend.certificate)
  assert.equal(backend.skills, 60)
  assert.equal(backend.skill, 200)
  assert.equal(backend.certificates, 40)
  assert.equal(backend.certificate, 200)
})

test('技能框和证书框上限由镜像按条数乘单条再加换行算出来', () => {
  const skillsBox = joinedListLimit(RESUME_DOC_LIMITS.skills, RESUME_DOC_LIMITS.skill)
  const certsBox = joinedListLimit(RESUME_DOC_LIMITS.certificates, RESUME_DOC_LIMITS.certificate)
  assert.equal(skillsBox, 12059)
  assert.equal(certsBox, 8039)
  assert.equal(LIST_BOX_LIMITS.skillsText, skillsBox)
  assert.equal(LIST_BOX_LIMITS.certsText, certsBox)
  const src = fs.readFileSync(LIMITS_JS, 'utf8')
  assert.equal(src.includes('12059'), false)
  assert.equal(src.includes('8039'), false)
})

test('优化页技能和证书两个 textarea 用 DOC_LEN，不再写死 800', () => {
  const wxml = fs.readFileSync(OPTIMIZE_WXML, 'utf8')
  const skills = wxml.match(/<textarea[^>]*value="\{\{editor\.skillsText\}\}"[^>]*>/)
  assert.ok(skills, '找不到技能 textarea')
  assert.match(skills[0], /maxlength="\{\{DOC_LEN\.skillsText\}\}"/)
  const certs = wxml.match(/<textarea[^>]*value="\{\{editor\.certsText\}\}"[^>]*>/)
  assert.ok(certs, '找不到证书 textarea')
  assert.match(certs[0], /maxlength="\{\{DOC_LEN\.certsText\}\}"/)
  assert.doesNotMatch(wxml, /maxlength="800"/)
})

const SKILLS = [
  '能把一场社区试吃会从邀约做到次日复盘并写成可以交接的记录',
  '每天上午先处理社群里隔夜的缺货和配送延迟再去回复普通闲聊',
  '新用户第一周会发出进群方式自提点和售后找谁这三条承接说明',
  '写活动文案之前会先问清店主这一次真正想卖出去的是哪一款商品',
  '周末市集能排好摊位顺序也能给每位志愿者写清当天各自的分工',
  '活动前一天会把物资清单发给店主逐项确认避免开摊当天才现凑',
  '冷链酸奶破损时会先说明可换货的时间再把受影响的订单号整理成表',
  '和店主修改活动文案时会留下修改原因方便下一次换人不用重猜',
  '月度复盘只写哪类商品复购高哪条通知没人点以及下个月准备停什么',
  '带过两名实习生做社群值守交接之后他们能独立处理催单和改期',
  '会把一次活动的到场人数和复购来源记成下一班同事能接手的记录',
  '能在活动当天的社群里按开场中场和收摊三个节点报出到场进度',
  '承接新用户时不会只丢一张海报就结束而是写清楚出了问题找谁',
  '发现一条活动通知没人点开会改掉标题和卖点而不是原样再发一遍',
  '能把店主口头说的摊位要求整理成当天摊位可以照着执行的清单',
  '会把缺货和配送延迟单独记下来交给仓配避免这些消息和闲聊混在一起',
  '做过三场从零拉起的社区试吃会单场到场大约八十人并留下微信群',
  '写月度复盘时不把数据表原样贴进去只保留三件下个月准备改的事',
  '能独立跟完一场活动从最初方案邀约到场执行一直到次日书面复盘',
  '写标题时会先确定这一款商品的卖点再选词不堆没有信息的形容词',
  '志愿者临时缺席时能当场改好分工保证开摊时间和现场物资不受影响',
  '会在群里单独记下配送延迟的订单并在当天晚上把用户回访做完',
  '能把社群值守交接成接班的人不用每条消息都回来问我的工作状态',
  '和仓配一起处理过一次冷链集中破损并在当天晚上回访了大部分用户',
  '会用一张表格跟踪三个街道社群每天的问题以及这些问题的处理结果',
  '活动物资如果少了会在前一天晚上找店主补齐而不是开摊当天才现凑',
  '能看懂哪类商品复购更高并在下一次市集调整这些商品的陈列位置',
  '接到用户投诉时会先核对订单号和自提点再告诉对方具体的处理时间',
  '会把用户当天留下的微信群当作复购的主要来源持续维护而不是丢掉',
  '下一份工作仍想做靠近用户的运营并且能独立负责一场完整的活动',
]

test('30 条技能拼起来超过 800 字，改一个字后编辑区仍是全部条目，导出请求体也是 30 条', async () => {
  assert.equal(SKILLS.length, 30)
  for (const skill of SKILLS) {
    assert.equal(skill.includes('测试'), false)
    assert.equal(/[\n,，、;；]/.test(skill), false)
    assert.ok(skill.length >= 28 && skill.length <= 34, skill)
  }
  const joined = SKILLS.join('\n')
  assert.ok(joined.length > 800, String(joined.length))
  const at = joined.indexOf('吃')
  assert.ok(at > 0)
  const editedText = `${joined.slice(0, at)}饮${joined.slice(at + 1)}`
  assert.equal(editedText.length, joined.length)
  assert.equal(diffCount(joined, editedText), 1)
  const editedSkills = parseList(editedText)
  assert.equal(editedSkills.length, 30)

  const resume = {
    basic: { name: '林知夏', phone: '13800138000', email: 'linzhixia@example.com', city: '杭州' },
    intention: { position: '用户运营', city: '杭州', jobType: '全职', salary: '面议' },
    summary: '过去两年在社区团购团队做用户运营，能独立跟一场活动从方案到复盘。',
    education: [],
    experience: [],
    projects: [],
    skills: SKILLS,
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
          taskId: 'task-skills',
          status: 'completed',
          modules: [],
          optimizedResume: resume,
        }),
        getResumeExportPricing: () => Promise.resolve({ mode: 'free', unitCents: 0 }),
        getResumeDraft: () => Promise.resolve({}),
        putResumeDraft: () => Promise.resolve({ updatedAt: '2026-11-13T08:00:00.000Z' }),
        getResumeVersions: () => Promise.resolve({ items: [], latestVersion: null }),
        factCheckResume: () => Promise.resolve({ originalAvailable: true, items: [] }),
        exportGeneratedResume: (payload) => {
          bodies.push(payload)
          return Promise.resolve({
            fileId: 'file-skills',
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

  assert.equal(page.data.DOC_LEN.skillsText, LIST_BOX_LIMITS.skillsText)
  assert.equal(page.data.DOC_LEN.certsText, LIST_BOX_LIMITS.certsText)
  assert.equal(page.data.DOC_LEN.skillsText, joinedListLimit(RESUME_DOC_LIMITS.skills, RESUME_DOC_LIMITS.skill))
  assert.equal(page.data.DOC_LEN.certsText, joinedListLimit(RESUME_DOC_LIMITS.certificates, RESUME_DOC_LIMITS.certificate))

  page.onLoad({ taskId: 'task-skills' })
  await flush()
  await flush()

  assert.equal(page.data.phase, 'done')
  assert.equal(String(page.data.editor.skillsText), joined)
  assert.ok(String(page.data.editor.skillsText).length > 800)
  const loaded = parseList(page.data.editor.skillsText)
  assert.equal(loaded.length, 30)
  for (let i = 0; i < 30; i += 1) assert.equal(loaded[i], SKILLS[i])

  page.onDraftInput({
    currentTarget: { dataset: { section: 'skillsText', key: 'skillsText', index: -1 } },
    detail: { value: editedText },
  })

  assert.equal(String(page.data.editor.skillsText), editedText)
  assert.equal(diffCount(joined, page.data.editor.skillsText), 1)
  const kept = parseList(page.data.editor.skillsText)
  assert.equal(kept.length, 30)
  for (let i = 0; i < 30; i += 1) assert.equal(kept[i], editedSkills[i])

  assert.equal(page.data.exportDisabled, false, page.data.exportDisabledReason)
  page.exportResume()
  await flush()
  await flush()
  assert.equal(page.data.factPanel.canConfirm, true, page.data.factPanel.error || '事实核对没有打开')
  page.confirmFacts()
  await flush()

  assert.equal(bodies.length, 1)
  const body = bodies[0]
  assert.equal(body.skills.length, 30)
  for (let i = 0; i < 30; i += 1) assert.equal(String(body.skills[i]), editedSkills[i])
})

// 62 个短技能词，写法照样稿 _prep/r3-skills-63.js。中间只有空格，没有换行、逗号、顿号、分号。
const SHORT_SKILLS = [
  '公众号运营', '视频号运营', '小红书运营', '抖音运营', '微博运营', '社群运营', '企业微信私域', '会员运营',
  '内容策划', '选题策划', '文案撰写', '新闻稿撰写', '短视频脚本', '直播策划', '直播中控', '直播复盘',
  '活动策划', '活动执行', '节日营销', '新品上市推广', '达人合作', 'KOC 招募', '探店笔记', '品牌联名',
  '用户调研', '用户画像分析', '数据分析', 'Excel 数据透视表', 'VLOOKUP 函数', '周报月报', '竞品分析', '舆情监测',
  '差评处理', '危机公关', '秀米排版', '135 编辑器', '剪映剪辑', 'Premiere 基础', 'Photoshop 基础', 'Canva 可画',
  '稿定设计', '手机摄影', '视频拍摄', '收音与布光', '巨量引擎投放', '腾讯广告投放', '小红书聚光投放', '千川投放',
  'SEO 基础', '预算编制', '供应商管理', '跨部门沟通', '项目排期', '新人带教', '门店培训', '外卖平台运营',
  '美团点评运营', '团购套餐设计', '优惠券策略', '会员等级设计', 'AIGC 写作辅助', '提示词编写',
]
const EXTRA_SKILL = '门店日常复盘'
// 整句超过单条上限。中间只有空格和句号，没有换行、逗号、顿号、分号，拆编辑区文本时不会被拆成两条。
const LONG_SKILL = '熟悉小红书 抖音 视频号三个平台的推荐逻辑和流量规则 能根据后台的曝光 点击 完播 互动和转化数据判断一条内容的问题出在选题 标题 封面还是发布时间 并在下一次发布前做出对应调整。做过从零起号到稳定日更的完整过程 知道冷启动阶段怎么选题 怎么借势热点 怎么用评论区维护早期用户 也知道账号进入瓶颈期以后怎么通过栏目化和系列化把内容做深 让老粉丝愿意持续看下去。平时也会把评论区里反复出现的问题记下来 反推下一期选题 让内容和用户的真实疑问对得上。'

function countSentence(kind, count) {
  const cap = kind === '技能' ? RESUME_DOC_LIMITS.skills : RESUME_DOC_LIMITS.certificates
  return `${kind}最多 ${cap} 项，当前 ${count} 项`
}

function lengthSentence(kind, text) {
  const cap = kind === '技能' ? RESUME_DOC_LIMITS.skill : RESUME_DOC_LIMITS.certificate
  return `${kind}「${String(text).slice(0, 10)}…」超过 ${cap} 字`
}

function baseResume(extra) {
  return Object.assign({
    basic: { name: '林知夏', phone: '13800138000', email: 'linzhixia@example.com', city: '杭州' },
    intention: { position: '用户运营', city: '杭州', jobType: '全职', salary: '面议' },
    summary: '过去两年在社区团购团队做用户运营，能独立跟一场活动从方案到复盘。',
    education: [],
    experience: [],
    projects: [],
    skills: ['活动策划', '用户访谈'],
    certificates: ['大学英语六级'],
  }, extra || {})
}

test('63 条技能只报条数，满额且每条正好到单条上限时不报错', () => {
  const skills = SHORT_SKILLS.concat([EXTRA_SKILL])
  assert.equal(SHORT_SKILLS.length, 62)
  assert.equal(skills.length, 63)
  for (const skill of skills) {
    assert.equal(skill.includes('测试'), false)
    assert.equal(/[\n,，、;；]/.test(skill), false)
    assert.ok(skill.length <= RESUME_DOC_LIMITS.skill, skill)
  }
  const onlyCount = exportListErrors({ skills, certificates: ['大学英语六级'] })
  assert.equal(onlyCount.length, 1)
  assert.equal(onlyCount[0], countSentence('技能', 63))

  const skillOk = fill([
    '能独立完成一场社区市集从邀约和现场执行到次日复盘并把到场人数和复购来源写成下一班可以接手的记录。',
  ], RESUME_DOC_LIMITS.skill)
  const certOk = fill([
    '大学英语六级通过。备考时按听力和阅读分周练习。作文先列三个能从实习里举出来的例子再写。',
  ], RESUME_DOC_LIMITS.certificate)
  assert.equal(skillOk.length, RESUME_DOC_LIMITS.skill)
  assert.equal(certOk.length, RESUME_DOC_LIMITS.certificate)
  assert.equal(/[\n,，、;；]/.test(skillOk), false)
  assert.equal(/[\n,，、;；]/.test(certOk), false)
  const fullSkills = []
  const fullCerts = []
  for (let i = 0; i < RESUME_DOC_LIMITS.skills; i += 1) fullSkills.push(skillOk)
  for (let i = 0; i < RESUME_DOC_LIMITS.certificates; i += 1) fullCerts.push(certOk)
  assert.deepEqual(exportListErrors({ skills: fullSkills, certificates: fullCerts }), [])
})

test('一条超长技能和一条超长证书各报一句，四种同时出现时按条数再逐条的顺序', () => {
  const skillLong = `${fill(['能把一场社区试吃会从邀约做到次日复盘并写成可以交接的记录。'], RESUME_DOC_LIMITS.skill)}。`
  const certLong = `${fill(['教师资格证面试试讲用过一节社区团购的用户承接课。'], RESUME_DOC_LIMITS.certificate)}。`
  assert.equal(skillLong.length, RESUME_DOC_LIMITS.skill + 1)
  assert.equal(certLong.length, RESUME_DOC_LIMITS.certificate + 1)
  const pair = exportListErrors({
    skills: ['活动策划', skillLong],
    certificates: ['大学英语六级', certLong],
  })
  assert.deepEqual(pair, [lengthSentence('技能', skillLong), lengthSentence('证书', certLong)])
  assert.equal(pair[0].includes(`${skillLong.slice(0, 10)}…`), true)
  assert.equal(pair[1].includes(`${certLong.slice(0, 10)}…`), true)

  const skills = SHORT_SKILLS.concat([skillLong])
  const certificates = []
  for (let i = 0; i < RESUME_DOC_LIMITS.certificates; i += 1) certificates.push('大学英语六级')
  certificates.push(certLong)
  assert.equal(skills.length, 63)
  assert.equal(certificates.length, RESUME_DOC_LIMITS.certificates + 1)
  assert.deepEqual(exportListErrors({ skills, certificates }), [
    countSentence('技能', skills.length),
    lengthSentence('技能', skillLong),
    countSentence('证书', certificates.length),
    lengthSentence('证书', certLong),
  ])
})

test('空串和空白由请求体滤掉；顿号逗号拆开后的条数就是函数看到的条数', () => {
  const rawSkills = ['活动策划', '   ', '', '用户访谈']
  const filtered = buildExportPayload(baseResume({
    skills: rawSkills,
    certificates: ['  ', '', '大学英语六级'],
  }), { format: 'pdf', taskId: 'task-blank' })
  assert.equal(rawSkills.length, 4)
  assert.equal(filtered.skills.length, 2)
  assert.equal(filtered.skills[0], '活动策划')
  assert.equal(filtered.skills[1], '用户访谈')
  assert.equal(filtered.certificates.length, 1)
  assert.deepEqual(exportListErrors(filtered), [])

  const names = SHORT_SKILLS.concat([EXTRA_SKILL])
  const editor = draft.resumeToEditor(baseResume({ skills: [], certificates: ['大学英语六级'] }))
  editor.skillsText = `${names.join('、').replace('活动策划', '活动策划，用户访谈')}\n   \n，`
  editor.certsText = '大学英语六级'
  const parsed = parseList(editor.skillsText)
  const resume = draft.editorToResume(editor)
  const payload = buildExportPayload(resume, { format: 'pdf', taskId: 'task-split' })
  assert.ok(parsed.length > names.length)
  assert.equal(payload.skills.length, parsed.length)
  assert.equal(payload.skills.length, names.length + 1)
  const errors = exportListErrors(payload)
  assert.equal(errors.length, 1)
  assert.equal(errors[0], countSentence('技能', payload.skills.length))

  const kept = buildExportPayload(baseResume({
    skills: ['活动策划、用户访谈'],
    certificates: ['大学英语六级'],
  }), { format: 'pdf', taskId: 'task-kept' })
  assert.equal(kept.skills.length, 1)
  assert.equal(kept.skills[0], '活动策划、用户访谈')
  assert.deepEqual(exportListErrors(kept), [])
})

function loadOptimize(resume, wx, extra) {
  const more = extra || {}
  return instantiate(loadPageDefinition('pages/resume-optimize/resume-optimize.js', {
    wx,
    globals: more.globals || {
      getApp: () => ({ globalData: { statusBarHeight: 47 } }),
    },
    modules: {
      auth: { isLoggedIn: () => true, getUser: () => ({ id: 'u1', nickname: '林知夏' }) },
      storage: {
        KEYS: { RESUME_TASK: 'zyd_resume_task' },
        get() { return {} },
      },
      api: {
        getResumeOptimize: () => Promise.resolve({
          taskId: 'task-export-limit',
          status: 'completed',
          modules: [],
          optimizedResume: resume,
        }),
        getResumeExportPricing: () => Promise.resolve({ mode: 'free', unitCents: 0 }),
        getResumeDraft: () => Promise.resolve({}),
        putResumeDraft: () => Promise.resolve({ updatedAt: '2026-11-13T08:00:00.000Z' }),
        getResumeVersions: () => Promise.resolve({ items: [], latestVersion: null }),
        factCheckResume: () => Promise.resolve({ originalAvailable: true, items: [] }),
        exportGeneratedResume: (payload) => {
          wx._bodies.push(payload)
          return Promise.resolve({
            fileId: 'file-limit',
            filename: '林知夏-用户运营.pdf',
            printFileUrl: '/api/v1/files/file-print/content?sig=1',
            sizeBytes: 20480,
            pageCount: 2,
            expiresAt: '2026-12-31T00:00:00.000Z',
          })
        },
        ...(more.api || {}),
      },
    },
  }))
}

function limitWx(options) {
  const opt = options || {}
  const modals = []
  const scrolls = []
  const queries = []
  const wx = {
    navigateTo() {},
    navigateBack() {},
    switchTab() {},
    showToast() {},
    showLoading() {},
    hideLoading() {},
    downloadFile() {},
    openDocument() {},
    getStorageSync() { return '' },
    setStorageSync() {},
    removeStorageSync() {},
    showModal(modal) {
      modals.push(modal)
      const done = () => {
        if (typeof modal.success === 'function') modal.success({ confirm: true, cancel: false })
      }
      if (opt.deferModal) setTimeout(done, 0)
      else done()
    },
    pageScrollTo(scroll) { scrolls.push(scroll) },
    createSelectorQuery() {
      const q = {
        select(sel) {
          queries.push(sel)
          return q
        },
        selectViewport() { return q },
        boundingClientRect() { return q },
        scrollOffset() { return q },
        exec(cb) {
          if (opt.missingLists) cb([null, { scrollTop: 180 }])
          else cb([{ top: 640 }, { scrollTop: 180 }])
        },
      }
      return q
    },
    _bodies: [],
    _modals: modals,
    _scrolls: scrolls,
    _queries: queries,
  }
  return wx
}

test('63 条技能里有一条超长时先弹明哪两条，删到 60 条后再进入核对', async () => {
  assert.ok(LONG_SKILL.length > RESUME_DOC_LIMITS.skill)
  assert.equal(/[\n,，、;；]/.test(LONG_SKILL), false)
  const skills = SHORT_SKILLS.concat([LONG_SKILL])
  assert.equal(skills.length, 63)
  const wx = limitWx()
  const page = loadOptimize(baseResume({ skills, certificates: ['大学英语六级'] }), wx)

  page.onLoad({ taskId: 'task-export-limit' })
  await flush()
  await flush()
  assert.equal(page.data.exportDisabled, false, page.data.exportDisabledReason)
  assert.equal(page.data.factPanel.open, false)

  page.exportResume()
  assert.equal(wx._modals.length, 1)
  assert.equal(wx._modals[0].title, '暂时不能导出')
  assert.equal(wx._modals[0].showCancel, false)
  assert.equal(wx._modals[0].content, [
    countSentence('技能', 63),
    lengthSentence('技能', LONG_SKILL),
  ].join('；\n'))
  assert.equal(page.data.factPanel.open, false)
  assert.equal(page.data.exporting, false)
  assert.equal(wx._bodies.length, 0)
  assert.equal(wx._queries.length, 1)
  assert.equal(wx._queries[0], '#edit-lists')
  assert.equal(wx._scrolls.length, 1)
  const inset = 47 + 44
  assert.equal(wx._scrolls[0].scrollTop, 180 + 640 - inset)
  assert.equal(wx._scrolls[0].selector, undefined)

  const kept = SHORT_SKILLS.slice(0, RESUME_DOC_LIMITS.skills)
  assert.equal(kept.length, RESUME_DOC_LIMITS.skills)
  page.onDraftInput({
    currentTarget: { dataset: { section: 'skillsText', key: 'skillsText', index: -1 } },
    detail: { value: kept.join('\n') },
  })
  page.exportResume()
  await flush()
  await flush()
  assert.equal(wx._modals.length, 1)
  assert.equal(page.data.factPanel.canConfirm, true, page.data.factPanel.error || '事实核对没有打开')
  assert.equal(wx._bodies.length, 0)
  assert.equal(wx._scrolls.length, 1)
})

test('技能里夹着顿号时按请求体条数放行，不按编辑区文本重拆', async () => {
  const skills = SHORT_SKILLS.slice(0, 59).concat(['公众号运营、视频号运营'])
  assert.equal(skills.length, 60)
  const wx = limitWx()
  const page = loadOptimize(baseResume({ skills, certificates: ['大学英语六级'] }), wx)
  page.onLoad({ taskId: 'task-export-limit' })
  await flush()
  await flush()
  assert.equal(page.data.exportDisabled, false, page.data.exportDisabledReason)
  const payload = buildExportPayload(page._resume, { format: page.data.format, taskId: page.data.taskId })
  const fromEditor = parseList(page.data.editor.skillsText)
  assert.equal(payload.skills.length, 60)
  assert.equal(fromEditor.length, 61)
  assert.notEqual(payload.skills.length, fromEditor.length)

  page.exportResume()
  await flush()
  await flush()
  assert.equal(wx._modals.length, 0)
  assert.equal(page.data.factPanel.canConfirm, true, page.data.factPanel.error || '事实核对没有打开')
  assert.equal(wx._bodies.length, 0)
  assert.equal(wx._scrolls.length, 0)
})

test('已经核对过时超限仍先弹窗，不直接导出', async () => {
  const skills = SHORT_SKILLS.concat([LONG_SKILL])
  const wx = limitWx()
  const page = loadOptimize(baseResume({ skills, certificates: ['大学英语六级'] }), wx)
  page.onLoad({ taskId: 'task-export-limit' })
  await flush()
  await flush()
  assert.equal(page.data.exportDisabled, false, page.data.exportDisabledReason)
  page._factsConfirmedAt = '2026-11-13T01:02:03.000Z'
  page._factsNeedRecheck = false
  page.exportResume()
  assert.equal(wx._modals.length, 1)
  assert.equal(wx._modals[0].title, '暂时不能导出')
  assert.equal(wx._modals[0].content, [
    countSentence('技能', 63),
    lengthSentence('技能', LONG_SKILL),
  ].join('；\n'))
  assert.equal(page.data.factPanel.open, false)
  assert.equal(wx._bodies.length, 0)
  assert.equal(page.data.exporting, false)
})

function overLimitResume() {
  return baseResume({
    skills: SHORT_SKILLS.concat([LONG_SKILL]),
    certificates: ['大学英语六级'],
  })
}

test('核对面板删掉电话后，顿号被拆开的技能按真正发出的请求体拦住', async () => {
  const skills = SHORT_SKILLS.slice(0, 59).concat(['公众号运营、视频号运营'])
  assert.equal(skills.length, 60)
  for (const skill of skills) assert.equal(skill.includes('测试'), false)
  const wx = limitWx()
  const page = loadOptimize(baseResume({ skills, certificates: ['大学英语六级'] }), wx, {
    api: {
      factCheckResume: () => Promise.resolve({
        originalAvailable: true,
        items: [{ path: 'basic.phone', kind: 'phone', value: '13800138000', foundInOriginal: false }],
      }),
    },
  })
  page.onLoad({ taskId: 'task-export-limit' })
  await flush()
  await flush()
  assert.equal(page.data.exportDisabled, false, page.data.exportDisabledReason)
  const before = buildExportPayload(page._resume, { format: page.data.format, taskId: page.data.taskId })
  assert.equal(before.skills.length, 60)
  assert.equal(parseList(page.data.editor.skillsText).length, 61)

  page.exportResume()
  await flush()
  await flush()
  assert.equal(wx._modals.length, 0)
  assert.equal(page.data.factPanel.open, true)
  assert.equal(page.data.factPanel.canConfirm, true, page.data.factPanel.error || '事实核对没有打开')
  const phone = page.data.factPanel.items.find((item) => item.path === 'basic.phone')
  assert.ok(phone, '核对面板里没有电话')
  page.removeFact({ currentTarget: { dataset: { factKey: phone.key } } })
  assert.equal(page.data.editor.basic.phone, '')
  assert.equal(page._resume.skills.length, 61)
  assert.equal(page.data.exporting, false)

  page.confirmFacts()
  assert.equal(wx._modals.length, 1)
  assert.equal(wx._modals[0].title, '暂时不能导出')
  assert.equal(wx._modals[0].showCancel, false)
  assert.equal(wx._modals[0].content, countSentence('技能', 61))
  assert.equal(wx._bodies.length, 0)
  assert.equal(page.data.exporting, false)
  await flush()
  assert.equal(wx._bodies.length, 0)
  assert.equal(page.data.exporting, false)
})

test('超限弹窗关掉之后才滚动到技能卡', async () => {
  const wx = limitWx({ deferModal: true })
  const page = loadOptimize(overLimitResume(), wx)
  page.onLoad({ taskId: 'task-export-limit' })
  await flush()
  await flush()
  assert.equal(page.data.exportDisabled, false, page.data.exportDisabledReason)
  page.exportResume()
  assert.equal(wx._modals.length, 1)
  assert.equal(wx._modals[0].title, '暂时不能导出')
  assert.equal(wx._scrolls.length, 0)
  await flush()
  assert.equal(wx._scrolls.length, 1)
  assert.equal(wx._scrolls[0].scrollTop, 180 + 640 - (47 + 44))
  assert.equal(wx._bodies.length, 0)
  assert.equal(page.data.exporting, false)
})

test('状态栏 47、导航栏 40 时滚到已滚距离加节点 top 再减 87', async () => {
  const wx = limitWx()
  const page = loadOptimize(overLimitResume(), wx, {
    globals: {
      getApp: () => ({ globalData: { statusBarHeight: 47, navBarHeight: 40 } }),
    },
  })
  page.onLoad({ taskId: 'task-export-limit' })
  await flush()
  await flush()
  assert.equal(page.data.exportDisabled, false, page.data.exportDisabledReason)
  page.exportResume()
  assert.equal(wx._scrolls.length, 1)
  assert.equal(wx._scrolls[0].scrollTop, 180 + 640 - 87)
  assert.equal(wx._bodies.length, 0)
})

test('查不到技能卡节点时不调用 pageScrollTo', async () => {
  const wx = limitWx({ missingLists: true })
  const page = loadOptimize(overLimitResume(), wx)
  page.onLoad({ taskId: 'task-export-limit' })
  await flush()
  await flush()
  assert.equal(page.data.exportDisabled, false, page.data.exportDisabledReason)
  page.exportResume()
  assert.equal(wx._modals.length, 1)
  assert.equal(wx._queries.includes('#edit-lists'), true)
  assert.equal(wx._scrolls.length, 0)
  assert.equal(wx._bodies.length, 0)
  assert.equal(page.data.exporting, false)
})

test('超长技能的第 10 个字是表情时，提示按完整字符截取', async () => {
  const head = '能独立跟完社区活动'
  const emoji = '🙂'
  assert.equal(Array.from(head).length, 9)
  assert.equal(emoji.length, 2)
  const tail = fill([
    '并把到场人数和复购来源写成下一班同事可以接手的记录。',
  ], 220)
  const skill = `${head}${emoji}${tail}`
  assert.equal(skill.includes('测试'), false)
  assert.ok(skill.length > RESUME_DOC_LIMITS.skill)
  assert.equal(Array.from(skill)[9], emoji)
  const preview = Array.from(skill).slice(0, 10).join('')
  assert.equal(preview, `${head}${emoji}`)
  assert.notEqual(skill.slice(0, 10), preview)
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(preview), false)

  const wx = limitWx()
  const page = loadOptimize(baseResume({ skills: [skill], certificates: ['大学英语六级'] }), wx)
  page.onLoad({ taskId: 'task-export-limit' })
  await flush()
  await flush()
  assert.equal(page.data.exportDisabled, false, page.data.exportDisabledReason)
  page.exportResume()
  assert.equal(wx._modals.length, 1)
  assert.equal(wx._modals[0].title, '暂时不能导出')
  assert.equal(wx._modals[0].showCancel, false)
  assert.equal(wx._modals[0].content, `技能「${preview}…」超过 ${RESUME_DOC_LIMITS.skill} 字`)
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(wx._modals[0].content), false)
  assert.notEqual(wx._modals[0].content, lengthSentence('技能', skill))
  assert.equal(wx._bodies.length, 0)
  assert.equal(page.data.exporting, false)
})
