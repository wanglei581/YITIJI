// 稿 52：小青的作业面。有内容的五态走真实会话，打印按钮因此可点。
// 示例正文写在本文件里，不从页面模型导入（那个文件带 import.meta.env）。
import type { ResumePageFixture } from './types'

const FUTURE = '2099-01-01T00:00:00.000Z'
const PAST = '2020-01-01T00:00:00.000Z'

const QA = {
  kind: 'qa_pins',
  title: '你钉住的条目',
  pins: [
    { content: '我做过两年社群运营，最多同时管 6 个群。', evidenceLevel: 'E1', sourceNote: '来源：你在第 2 轮说的原话' },
    { content: '你在本机的简历里写了「用户增长」相关经历，可以在面试里直接引用。', evidenceLevel: 'E2', sourceNote: '来源：本机已有的简历诊断结果' },
    { content: '被问到离职原因时，可以把重点放在「想做更靠近用户的岗位」。', evidenceLevel: 'E3', sourceNote: 'AI 的建议，仅供参考 —— 说不说、怎么说由你定' },
    { content: '我能接受青岛市内通勤，不接受长期出差。', evidenceLevel: 'E1', sourceNote: '来源：你在第 5 轮说的原话' },
  ],
}

const SLOT = {
  kind: 'slot_draft',
  draft: '我做过两年社群运营，最多同时管 6 个群，日常处理入群审核、活动通知和答疑。\n去年负责的一次线下活动宣讲，从建群到活动结束一共来了 180 多人。\n我想换到更靠近用户的岗位，因为我更喜欢直接听到用户怎么说。',
  blanks: [] as string[],
  summary: '由你自己说过的话拼接',
  basedOn: [
    { slotKey: 'current_role', prompt: '现在做什么', value: '社群运营，两年，最多同时管 6 个群' },
    { slotKey: 'best_achievement', prompt: '最拿得出手的结果', value: '线下活动宣讲来了 180 多人' },
    { slotKey: 'why_this_job', prompt: '为什么想做这个岗位', value: '想更靠近用户，喜欢直接听用户怎么说' },
  ],
}

const COMPARE_ITEMS = [
  { requirement: '两年以上社群或用户运营经验', verdict: 'covered', evidence: '我做过两年社群运营，最多同时管 6 个群' },
  { requirement: '有线下活动组织经验', verdict: 'covered', evidence: '线下活动宣讲，从建群到活动结束一共来了 180 多人' },
  { requirement: '熟练使用数据分析工具（如 Excel / SQL）', verdict: 'missing', evidence: '材料里没有出现相关表述。要是你会，补一句写清「用什么工具、做到什么程度」。' },
  { requirement: '有内容撰写或短视频经验', verdict: 'missing', evidence: '材料里没有出现相关表述。' },
  { requirement: '本科及以上学历', verdict: 'not_a_capability', evidence: '这是硬性条件，不是能写进材料的能力，本机不做判定。' },
]

const COMPARE = {
  kind: 'compare_report',
  summary: '5 条要求里有 2 条没写到',
  extras: [{ point: '有基础的平面设计能力', note: '要求里没写，面试时可以主动说' }],
  items: COMPARE_ITEMS,
}

const COMPARE_ALL = {
  kind: 'compare_report',
  summary: '要求都写到了',
  extras: COMPARE.extras,
  items: [
    COMPARE_ITEMS[0],
    COMPARE_ITEMS[1],
    { requirement: '熟练使用数据分析工具（如 Excel / SQL）', verdict: 'covered', evidence: '日常用 Excel 做群活跃度周报' },
    COMPARE_ITEMS[4],
  ],
}

function session(sessionId: string, artifactId: string, kind: string, payload: unknown, expiresAt: string) {
  return {
    sessionId,
    expiresAt,
    artifacts: [{
      artifactId,
      kind,
      status: 'completed',
      payload,
      provider: 'llm:deepseek',
      printedFileId: null,
      createdAt: '2026-09-29T00:00:00.000Z',
      updatedAt: '2026-09-29T00:00:00.000Z',
      expiresAt,
    }],
  }
}

const PATHS: Record<string, { path: string; body?: ReturnType<typeof session> }> = {
  'no-artifact': { path: '/ai/plan' },
  'print-unavailable': { path: '/ai/plan?state=print-unavailable&capture=1' },
  expired: {
    path: '/ai/plan?sessionId=pair52-exp&artifactId=pair52-exp-1',
    body: session('pair52-exp', 'pair52-exp-1', 'qa_pins', QA, PAST),
  },
  'qa-pins': {
    path: '/ai/plan?sessionId=pair52-qa&artifactId=pair52-qa-1',
    body: session('pair52-qa', 'pair52-qa-1', 'qa_pins', QA, FUTURE),
  },
  'slot-draft': {
    path: '/ai/plan?sessionId=pair52-slot&artifactId=pair52-slot-1',
    body: session('pair52-slot', 'pair52-slot-1', 'slot_draft', SLOT, FUTURE),
  },
  'slot-draft-blanks': {
    path: '/ai/plan?sessionId=pair52-blanks&artifactId=pair52-blanks-1',
    body: session('pair52-blanks', 'pair52-blanks-1', 'slot_draft', { ...SLOT, blanks: ['你最想让对方记住的一个结果', '你为什么选这家公司'] }, FUTURE),
  },
  'compare-report': {
    path: '/ai/plan?sessionId=pair52-cmp&artifactId=pair52-cmp-1',
    body: session('pair52-cmp', 'pair52-cmp-1', 'compare_report', COMPARE, FUTURE),
  },
  'compare-all-covered': {
    path: '/ai/plan?sessionId=pair52-all&artifactId=pair52-all-1',
    body: session('pair52-all', 'pair52-all-1', 'compare_report', COMPARE_ALL, FUTURE),
  },
}

export const page52: ResumePageFixture = {
  prefix: '52-',
  plan(_screen, state) {
    const hit = PATHS[state]
    if (!hit) return null
    return {
      plan: { kind: 'resume-pages' },
      reason: null,
      marker: `[data-kiosk-screen="advisor-artifact"][data-state="${state}"]`,
      runtimePath: hit.path,
    }
  },
  async prepare(page, api, target) {
    const hit = PATHS[target.state]
    if (hit?.body) {
      api.respond('GET', `/api/v1/advisor/sessions/${hit.body.sessionId}`, { status: 200, json: hit.body })
    }
    await page.goto(hit?.path ?? target.runtimeUrl ?? '/ai/plan', { waitUntil: 'domcontentloaded' })
    const marker = `[data-kiosk-screen="advisor-artifact"][data-state="${target.state}"]`
    await page.locator(marker).waitFor({ state: 'visible', timeout: 12_000 })
    if (hit?.body && target.state !== 'expired') {
      await page.locator('[data-testid="advisor-artifact-cta-print"]:not([disabled])').waitFor({ state: 'visible', timeout: 8_000 })
    }
  },
}
