/**
 * 「存一条、删掉、再查没有了」：一体机扫码前屏上第 3 句话在小程序这头靠得住靠不住（合规 2026-10-10 定字）。
 *
 *   七项那一句：「手机上填的内容和结果存在你自己的账号里，在小程序「我的」里能看，也能自己删。」
 *   小青那一句：「点「保存本次要点」后，要点会存进你自己账号的「我的文档」，能看、能删。」
 *
 * 做法：真跑三个页面（AI 服务记录、我的文档、小青），页面背后接同一份内存里的「账号」——
 * 接口替身只做存、列、删三件事，不替页面判断任何东西。每条都走完：账号里有 → 页面上看得到 →
 * 在页面上点删除并确认 → 页面重新取数 → 页面上没有了，账号里也没有了。
 *
 * 说明它证明什么、不证明什么：证明的是小程序页面把「看」和「删」真接到了接口上、删完会重新取数；
 * 服务端删没删干净由服务端自己的门禁管。自我探索在结果页「撤回本次结果」那条路这里没有跑。
 *
 * 末尾是反向变异。由 verify:page-lifecycle 拉起。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MINIAPP, rel), 'utf8')

const AI_RECORDS = 'pages/ai-records/ai-records.js'
const DOCUMENTS = 'pages/documents/documents.js'
const ASSISTANT = 'pages/assistant/assistant.js'

/** 一个人的账号：三张清单。接口替身只在这上面存、列、删。 */
function createAccount() {
  const account = { aiRecords: [], interviews: [], documents: [], seq: 0 }
  const api = {
    getMyAiRecords: () => Promise.resolve(account.aiRecords.map((r) => ({ ...r }))),
    getMyMockInterviews: () => Promise.resolve(account.interviews.map((r) => ({ ...r }))),
    deleteMyAiRecord: (id) => {
      account.aiRecords = account.aiRecords.filter((r) => r.id !== id)
      return Promise.resolve({ deleted: true })
    },
    deleteMyMockInterview: (sessionId) => {
      account.interviews = account.interviews.filter((r) => r.sessionId !== sessionId)
      return Promise.resolve({ deleted: true })
    },
    getMyDocuments: () => Promise.resolve(account.documents.map((d) => ({ ...d }))),
    deleteMyDocument: (id) => {
      account.documents = account.documents.filter((d) => d.id !== id)
      return Promise.resolve({ deleted: true })
    },
    getDocumentConversionCapabilities: () => Promise.resolve({ enabled: false }),
    getAssistantVoiceCapability: () => Promise.resolve({ asrEnabled: false }),
    summarizeAssistantSession: (sessionId) => {
      account.seq += 1
      const doc = {
        id: `doc-${account.seq}`,
        filename: 'AI 顾问 · 本次要点单.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 48211,
        pageCount: 1,
        createdAt: '2026-10-10T08:21:00.000Z',
        expiresAt: '2027-01-08T08:21:00.000Z',
        assetCategory: 'ai_generated',
        purpose: 'print_doc',
        sourceSessionId: sessionId,
      }
      account.documents.push(doc)
      return Promise.resolve({ highlights: ['把项目结果写具体'], todos: ['补一段实习经历'], document: { id: doc.id } })
    },
  }
  return { account, api }
}

function createWx() {
  const wx = { sheets: [], modals: [], toasts: [], navs: [] }
  wx.showActionSheet = (o) => wx.sheets.push(o)
  wx.showModal = (o) => wx.modals.push(o)
  wx.showToast = (o) => wx.toasts.push(o)
  wx.showLoading = () => {}
  wx.hideLoading = () => {}
  wx.navigateTo = (o) => wx.navs.push(o && o.url)
  wx.redirectTo = wx.navigateTo
  wx.switchTab = wx.navigateTo
  wx.navigateBack = () => {}
  wx.getWindowInfo = () => ({ statusBarHeight: 20 })
  return wx
}

const auth = {
  isLoggedIn: () => true,
  getUser: () => ({ id: 'u-chen' }),
  getToken: () => 'tok-u-chen',
  sessionGeneration: () => 'u-chen',
}

const settleUi = async () => { await flush(); await flush(); await flush() }

function recordTitles(page) {
  const out = []
  for (const g of page.data.groups || []) for (const item of g.items || []) out.push(item)
  return out
}

/** 在页面上对一条记录走完「更多 → 删除记录 → 确认」。 */
async function deleteOnRecordsPage(page, wx, account, id) {
  const sheetsBefore = wx.sheets.length
  page.moreRecord({ currentTarget: { dataset: { id } } })
  assert.equal(wx.sheets.length, sheetsBefore + 1, '「更多」出菜单')
  const sheet = wx.sheets[wx.sheets.length - 1]
  const idx = Array.from(sheet.itemList).indexOf('删除记录')
  assert.ok(idx >= 0, '菜单里有「删除记录」')
  const modalsBefore = wx.modals.length
  const total = () => account.aiRecords.length + account.interviews.length
  const before = total()
  sheet.success({ tapIndex: idx })
  assert.equal(wx.modals.length, modalsBefore + 1, '删除前先确认')
  // 还没点确认、或者点了取消：什么都不删。
  await settleUi()
  assert.equal(total(), before, '没点确认之前不删')
  wx.modals[wx.modals.length - 1].success({ confirm: false, cancel: true })
  await settleUi()
  assert.equal(total(), before, '点取消不删')
  wx.modals[wx.modals.length - 1].success({ confirm: true })
  await settleUi()
}

async function deleteOnDocumentsPage(page, wx, id) {
  page.more({ currentTarget: { dataset: { id } } })
  const sheet = wx.sheets[wx.sheets.length - 1]
  const idx = Array.from(sheet.itemList).indexOf('删除文件')
  assert.ok(idx >= 0, '文档菜单里有「删除文件」')
  const modalsBefore = wx.modals.length
  sheet.success({ tapIndex: idx })
  assert.equal(wx.modals.length, modalsBefore + 1, '删除前先确认')
  wx.modals[wx.modals.length - 1].success({ confirm: true })
  await settleUi()
}

// ── 七项那一句 ──────────────────────────────────────────────────────────

async function sevenItemsViewableAndDeletable({ sources = {} } = {}) {
  const { account, api } = createAccount()
  // 存：六类结果进「AI 服务记录」，求职材料进「我的文档」（它不经过 AI）。
  account.aiRecords = [
    { id: 'r-gen', taskId: 't-gen', kind: 'generate', status: 'completed', createdAt: '2026-10-10T01:12:00.000Z' },
    { id: 'r-opt', taskId: 't-res', kind: 'optimize', status: 'completed', createdAt: '2026-10-10T02:40:00.000Z' },
    { id: 'r-fit', taskId: 't-res', kind: 'job_fit', status: 'completed', createdAt: '2026-10-10T03:05:00.000Z' },
    { id: 'r-plan', taskId: 't-res', kind: 'career_plan', status: 'completed', createdAt: '2026-10-10T03:31:00.000Z' },
    { id: 'r-self', taskId: 't-self', kind: 'self_assessment', status: 'completed', createdAt: '2026-10-10T04:02:00.000Z' },
  ]
  account.interviews = [{ sessionId: 's-iv', position: '行政助理', hasReport: true, createdAt: '2026-10-10T05:18:00.000Z' }]
  account.documents = [{
    id: 'd-mat', filename: '求职材料_行政助理.pdf', mimeType: 'application/pdf', sizeBytes: 90211, pageCount: 2,
    createdAt: '2026-10-10T06:44:00.000Z', expiresAt: '2027-01-08T06:44:00.000Z', assetCategory: 'ai_generated', purpose: 'print_doc',
  }]

  // 看：AI 服务记录页上六条都在。
  const wx = createWx()
  const records = instantiate(loadPageDefinition(AI_RECORDS, { wx, source: sources[AI_RECORDS], modules: { auth, api } }))
  records.onShow()
  await settleUi()
  const expectTitles = ['AI 生成简历', '简历优化', '简历对照', '职业规划', '自我探索', '模拟面试 · 行政助理']
  const shown = recordTitles(records).map((r) => r.title)
  for (const title of expectTitles) assert.ok(shown.includes(title), `「我的 → AI 服务记录」里看得到：${title}`)
  assert.equal(shown.length, expectTitles.length)

  // 删：一条一条删，删一条少一条，别的不受牵连。
  let left = expectTitles.length
  for (const title of expectTitles) {
    const item = recordTitles(records).find((r) => r.title === title)
    assert.ok(item, `删之前还在：${title}`)
    await deleteOnRecordsPage(records, wx, account, item.id)
    left -= 1
    const now = recordTitles(records).map((r) => r.title)
    assert.ok(!now.includes(title), `删掉以后页面上没有了：${title}`)
    assert.equal(now.length, left, '只少这一条')
    assert.equal(account.aiRecords.length + account.interviews.length, left, '账号里也只少这一条')
  }
  assert.equal(account.aiRecords.length, 0)
  assert.equal(account.interviews.length, 0)

  // 求职材料：在「我的文档」看得到、删得掉。
  const wxDoc = createWx()
  const docs = instantiate(loadPageDefinition(DOCUMENTS, { wx: wxDoc, source: sources[DOCUMENTS], modules: { auth, api } }))
  docs.onLoad()
  await settleUi()
  assert.equal(docs.data.all.length, 1)
  assert.equal(docs.data.all[0].name, '求职材料_行政助理.pdf')
  await deleteOnDocumentsPage(docs, wxDoc, 'd-mat')
  assert.equal(account.documents.length, 0, '账号里没有了')
  assert.equal(docs.data.all.length, 0, '页面重新取数后没有了')
  assert.equal(docs.data.filtered.length, 0)
}

// ── 小青那一句 ──────────────────────────────────────────────────────────

async function xiaoqingSavedPointsViewableAndDeletable({ sources = {} } = {}) {
  const { account, api } = createAccount()
  const wx = createWx()
  const voice = { cancel: () => {}, stop: () => {}, start: () => {}, isSupported: () => false }
  const assistant = instantiate(loadPageDefinition(ASSISTANT, {
    wx, source: sources[ASSISTANT], modules: { auth, api, 'voice-recorder': voice },
  }))
  assistant.onLoad({})
  await settleUi()
  assert.equal(account.documents.length, 0, '没点保存之前，账号里没有要点文件')

  // 存：聊过一轮后点「保存本次要点」。
  assistant.setData({ sessionId: 'sess-xq-1' })
  assistant.saveSummary()
  await settleUi()
  assert.equal(assistant.data.summaryHint, '本次要点已保存到我的文档，可打印。')
  assert.equal(account.documents.length, 1, '存进了账号的「我的文档」')
  const savedId = account.documents[0].id

  // 看：「我的文档」里有这一份。
  const wxDoc = createWx()
  const docs = instantiate(loadPageDefinition(DOCUMENTS, { wx: wxDoc, source: sources[DOCUMENTS], modules: { auth, api } }))
  docs.onLoad()
  await settleUi()
  assert.equal(docs.data.all.length, 1)
  assert.equal(docs.data.all[0].id, savedId)
  assert.match(docs.data.all[0].name, /本次要点/)

  // 删：删完页面和账号里都没有了。
  await deleteOnDocumentsPage(docs, wxDoc, savedId)
  assert.equal(account.documents.length, 0)
  assert.equal(docs.data.all.length, 0)

  // 再开一次「我的文档」，还是没有。
  const again = instantiate(loadPageDefinition(DOCUMENTS, { wx: createWx(), source: sources[DOCUMENTS], modules: { auth, api } }))
  again.onLoad()
  await settleUi()
  assert.equal(again.data.all.length, 0)
}

const SCENARIOS = { sevenItemsViewableAndDeletable, xiaoqingSavedPointsViewableAndDeletable }

for (const [name, run] of Object.entries(SCENARIOS)) test(name, () => run())

// ── 反向变异 ────────────────────────────────────────────────────────────

function mutated(rel, from, to) {
  const src = read(rel)
  assert.ok(src.includes(from), `变异锚点不在 ${rel}：${from}`)
  return { [rel]: src.replace(from, to) }
}

const MUTATIONS = [
  ['记录页菜单里没有删除', 'sevenItemsViewableAndDeletable',
    mutated(AI_RECORDS, "itemList: ['删除记录'],", "itemList: ['查看详情'],")],
  ['记录页点了删除不调接口', 'sevenItemsViewableAndDeletable',
    mutated(AI_RECORDS, ': api.deleteMyAiRecord(record.id)', ': Promise.resolve({ deleted: true })')],
  ['面试记录删不掉', 'sevenItemsViewableAndDeletable',
    mutated(AI_RECORDS, '? api.deleteMyMockInterview(record.sessionId)', '? Promise.resolve({ deleted: true })')],
  ['记录页不等确认就删', 'sevenItemsViewableAndDeletable',
    mutated(AI_RECORDS, "itemList: ['删除记录'],\n      success: (res) => {\n        if (res.tapIndex !== 0) return", "itemList: ['删除记录'],\n      success: (res) => {\n        if (res.tapIndex !== 0) return\n        api.deleteMyAiRecord(record.id)")],
  ['文档页点了删除不调接口', 'sevenItemsViewableAndDeletable',
    mutated(DOCUMENTS, '            api.deleteMyDocument(id)\n', '            Promise.resolve({ deleted: true })\n')],
  ['文档页删完不重新取数', 'xiaoqingSavedPointsViewableAndDeletable',
    mutated(DOCUMENTS, "                wx.showToast({ title: '已删除', icon: 'success' })\n                this.loadDocuments()", "                wx.showToast({ title: '已删除', icon: 'success' })")],
  ['小青没存成也说已保存', 'xiaoqingSavedPointsViewableAndDeletable',
    mutated(ASSISTANT, '    api.summarizeAssistantSession(this.data.sessionId).then((res) => {', "    Promise.resolve({ document: { id: 'x' } }).then((res) => {")],
]

for (const [label, scenario, sources] of MUTATIONS) {
  test(`变异：${label} → ${scenario} 判红`, async () => {
    await assert.rejects(() => SCENARIOS[scenario]({ sources }), (err) => {
      assert.equal(err && err.code, 'ERR_ASSERTION', `应当是断言失败，实际：${err && err.stack}`)
      return true
    })
  })
}
