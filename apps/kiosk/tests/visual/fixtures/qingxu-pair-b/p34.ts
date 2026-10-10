// 稿 34：自我探索。questions / review / result / ai-down 配到真实页，不再停在拦截态。
// 示例句子写在本文件里，不从页面模型导入（那个文件带 import.meta.env）。
import type { ResumePageFixture } from './types'

const PROTO_KEY = 'sa_static_proto_v1'
const RUNTIME_KEY = 'self_assessment_session_v1'
const CONSENT_VERSION = 'sa-consent-v2.2026-09-29'

const DIMS = [
  { key: 'interest', label: '兴趣偏好' },
  { key: 'style', label: '工作风格' },
  { key: 'team', label: '团队偏好' },
  { key: 'value', label: '价值取向' },
  { key: 'motivation', label: '求职动机' },
] as const

/** 每维五个选项。只有 a 的权重是 1，强度等于这一维里 a 的个数。 */
const CYCLES = [
  ['a', 'a', 'b', 'a', 'c'],
  ['b', 'a', 'c', 'b', 'a'],
  ['c', 'b', 'a', 'a', 'b'],
  ['a', 'c', 'b', 'a', 'a'],
  ['b', 'c', 'a', 'b', 'c'],
] as const

const NOTES = [
  '你更愿意先把一件具体的事做出来，再回头补说明。这次选择里，动手验证比先读完材料更常出现。',
  '你习惯先列清单再推进，也接受中途调整。书面、能回看的反馈比当场讨论更让你安心。',
  '你在协作里更看重责任边界和事实，不太把拍板交给别人。团队变大时，你倾向于用流程把事情对齐。',
  '你看重把事情做成，也在意日常生活还能留下来。认可更希望落在具体任务上，而不是一句空泛的评价。',
  '这一轮你更想先把下一份工作的方向说清楚，同时把经历写得能让对方看懂。',
] as const

function protoAnswers(): Record<string, string> {
  const answers: Record<string, string> = {}
  CYCLES.forEach((cycle, dim) => {
    cycle.forEach((choice, idx) => { answers[String(dim * 5 + idx + 1)] = choice })
  })
  return answers
}

function runtimeAnswers(): Record<string, Record<number, string>> {
  const answers: Record<string, Record<number, string>> = {}
  DIMS.forEach((dim, di) => {
    answers[dim.key] = {}
    CYCLES[di].forEach((choice, idx) => { answers[dim.key][idx] = choice })
  })
  return answers
}

function protoSession(opts: { consented: boolean; full: boolean; submitted: boolean }): string {
  return JSON.stringify({
    v: 2,
    consented: opts.consented,
    answers: opts.full ? protoAnswers() : {},
    cursor: opts.full ? 25 : 1,
    submitted: opts.submitted,
  })
}

function dimension(index: number, withNote: boolean) {
  const cycle = CYCLES[index]
  const evidence = cycle.map((choice, idx) => (choice === 'a' ? idx : -1)).filter((idx) => idx >= 0)
  return {
    key: DIMS[index].key,
    label: DIMS[index].label,
    strength: evidence.length,
    note: withNote ? NOTES[index] : null,
    evidenceQuestionIdx: evidence,
  }
}

function resultBody(withInterpretation: boolean) {
  return {
    taskId: 'sa-20261006-7f3c91',
    status: 'completed' as const,
    dimensions: DIMS.map((_, index) => dimension(index, withInterpretation)),
    summary: withInterpretation
      ? '这次作答里，你更常选择先动手验证、把责任划清，也在意日常还能留下时间。五个方向只描述这次的倾向，不打总分，也不判断适不适合某个岗位。'
      : null,
    providerName: withInterpretation ? 'llm' : 'llm_unavailable',
    accessToken: 'sa-access-7f3c91e2',
    expiresAt: '2026-10-07T09:30:00.000Z',
    consentVersion: CONSENT_VERSION,
    consentedAt: '2026-10-06T09:12:00.000Z',
    interpretationAvailable: withInterpretation,
  }
}

function runtimeSession(kind: 'questions' | 'review' | 'result' | 'ai-down'): string {
  const base = {
    answers: kind === 'questions' ? {} : runtimeAnswers(),
    consent: { nonSensitive: true, sensitive: false },
    consentVersion: CONSENT_VERSION,
    consentedAt: '2026-10-06T09:12:00.000Z',
  }
  if (kind === 'questions' || kind === 'review') return JSON.stringify(base)
  const result = resultBody(kind === 'result')
  return JSON.stringify({ ...base, taskId: result.taskId, accessToken: result.accessToken, result })
}

const PLANS: Record<string, { marker: string; path: string; proto: string; runtime: 'questions' | 'review' | 'result' | 'ai-down' }> = {
  questions: {
    marker: '[data-testid="self-assessment-state-quiz"]',
    path: '/resume/self-assessment/questions',
    proto: protoSession({ consented: true, full: false, submitted: false }),
    runtime: 'questions',
  },
  review: {
    marker: '[data-testid="self-assessment-state-review"]',
    path: '/resume/self-assessment/questions',
    proto: protoSession({ consented: true, full: true, submitted: false }),
    runtime: 'review',
  },
  result: {
    marker: '[data-testid="self-assessment-state-result-ready"]',
    path: '/resume/self-assessment/result',
    proto: protoSession({ consented: true, full: true, submitted: true }),
    runtime: 'result',
  },
  'ai-down': {
    marker: '[data-testid="self-assessment-state-result-ai-down"]',
    path: '/resume/self-assessment/result',
    proto: protoSession({ consented: true, full: true, submitted: true }),
    runtime: 'ai-down',
  },
}

export const page34: ResumePageFixture = {
  prefix: '34-',
  plan(_screen, state) {
    const hit = PLANS[state]
    if (!hit) return null
    return {
      plan: { kind: 'resume-pages' },
      reason: null,
      marker: hit.marker,
      runtimePath: hit.path,
      protoStorage: { [PROTO_KEY]: hit.proto },
    }
  },
  async prepare(page, _api, target) {
    const hit = PLANS[target.state]
    if (!hit) return
    await page.addInitScript(({ key, value }) => {
      sessionStorage.setItem(key, value)
    }, { key: RUNTIME_KEY, value: runtimeSession(hit.runtime) })
    await page.goto(hit.path, { waitUntil: 'domcontentloaded' })
    if (target.state === 'review') {
      await page.getByRole('button', { name: '去提交前确认' }).click()
    }
    await page.locator(hit.marker).waitFor({ state: 'visible', timeout: 12_000 })
  },
}
