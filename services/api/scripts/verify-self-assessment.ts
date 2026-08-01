/**
 * Self-Assessment 纯函数评分门禁：
 * - 5 维度 key 命中；strength ∈ {0..5}；
 * - answersHash 稳定（同一答案 → 同一 hash；同序 / 倒序答案 → 同一 hash）；
 * - 容错：未知 dim / idx / 选项 → 落入 unmatched；
 * - evidence 仅含题号，不含答案原文；
 * - 复位 / 重答取最后一条；
 * - clamp：raw > 5 截断为 5；raw < 0 截断为 0。
 *
 * 用独立 mock 题目 seed 验证，不依赖 Prisma / NestJS / LLM。
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { scoreSelfAssessment } from '../src/ai/resume/self-assessment-scoring'
import type {
  SelfAssessmentAnswerV1,
  SelfAssessmentQuestionsV1,
} from '@ai-job-print/shared'

type RawChoice = { key: string; label: string; weight: number }
type RawQuestion = { idx: number; prompt: string; choices: RawChoice[]; sensitive?: boolean }
type RawDimension = { key: 'interest' | 'style' | 'team' | 'value' | 'motivation'; label: string; questions: RawQuestion[] }

function makeQuestions(seed: 'control' | 'boundary' = 'control'): SelfAssessmentQuestionsV1 {
  // 生成 5×5 题目；每题 3 选项，权重按 seed 决定
  const dims: RawDimension[] = ['interest', 'style', 'team', 'value', 'motivation'].map((key, dimIdx) => ({
    key: key as RawDimension['key'],
    label: `维度${dimIdx + 1}`,
    questions: Array.from({ length: 5 }, (_, q) => ({
      idx: q,
      prompt: `${key}-q${q}`,
      choices: [
        { key: 'a', label: 'A', weight: seed === 'boundary' && q === 4 ? 7 : 1 },
        { key: 'b', label: 'B', weight: 0 },
        { key: 'c', label: 'C', weight: 0 },
      ],
    })),
  }))
  return { version: 'v1', dimensions: dims }
}

function makeAnswers(): SelfAssessmentAnswerV1[] {
  // 完整 25 题，全选 a
  const dims = ['interest', 'style', 'team', 'value', 'motivation'] as const
  const out: SelfAssessmentAnswerV1[] = []
  for (const d of dims) {
    for (let i = 0; i < 5; i++) out.push({ dim: d, idx: i, choice: 'a' })
  }
  return out
}

let failed = 0
function pass(message: string) {
  console.log(`PASS ${message}`)
}
function fail(message: string) {
  failed += 1
  console.error(`FAIL ${message}`)
}

console.log('\n=== self-assessment scoring 纯函数门禁 ===')

// 1) 5 维度结构命中
{
  const r = scoreSelfAssessment({ answers: makeAnswers() })
  assert.equal(r.dimensions.length, 5, 'dimensions 数 = 5')
  const keys = r.dimensions.map((d) => d.key).sort()
  assert.deepEqual(keys, ['interest', 'motivation', 'style', 'team', 'value'], '5 维度 key 命中')
  for (const d of r.dimensions) {
    assert.ok([0, 1, 2, 3, 4, 5].includes(d.strength), `${d.key} strength ∈ {0..5}`)
    assert.equal(d.note, null, `${d.key} note 默认 null`)
  }
  pass('5 维度结构 / strength ∈ {0..5} / note 默认 null')
}

// 2) 全 a 加权 → strength=5
{
  const r = scoreSelfAssessment({ answers: makeAnswers() })
  for (const d of r.dimensions) {
    assert.equal(d.strength, 5, `${d.key} 全选 a → strength=5`)
  }
  pass('全选 a → 5 维度 strength=5')
}

// 3) answersHash 稳定：同答案 → 同 hash
{
  const a1 = makeAnswers()
  const r1 = scoreSelfAssessment({ answers: a1 })
  const r2 = scoreSelfAssessment({ answers: a1 })
  assert.equal(r1.answersHash, r2.answersHash, '同答案 → 同 hash')
  pass('answersHash 稳定（同答案 → 同 hash）')
}

// 4) answersHash 与顺序无关
{
  const a1 = makeAnswers()
  const a2 = [...a1].reverse()
  const r1 = scoreSelfAssessment({ answers: a1 })
  const r2 = scoreSelfAssessment({ answers: a2 })
  assert.equal(r1.answersHash, r2.answersHash, '乱序答案 → 同 hash')
  pass('answersHash 与答案顺序无关')
}

// 5) answersHash 与 Node crypto SHA-256 一致
{
  const a = makeAnswers()
  const r = scoreSelfAssessment({ answers: a })
  const sorted = [...a]
    .map((x) => ({ dim: x.dim, idx: x.idx, choice: x.choice }))
    .sort((x, y) => (x.dim === y.dim ? x.idx - y.idx : x.dim.localeCompare(y.dim)))
  const expected = createHash('sha256').update(JSON.stringify(sorted), 'utf8').digest('hex')
  assert.equal(r.answersHash, expected, 'hash 算法 = SHA-256(规范化 JSON)')
  pass('answersHash = SHA-256(规范化 JSON)')
}

// 6) 同一题号重答取最后一条
{
  const a: SelfAssessmentAnswerV1[] = [
    { dim: 'interest', idx: 0, choice: 'a' },
    { dim: 'interest', idx: 0, choice: 'b' }, // 重复 → 最后一条生效（weight=0）
  ]
  const r = scoreSelfAssessment({ answers: a })
  const interest = r.dimensions.find((d) => d.key === 'interest')!
  assert.equal(interest.strength, 0, '同一题号最后一条生效')
  assert.deepEqual(interest.evidenceQuestionIdx, [0], 'evidence 含 0 题号')
  pass('同一题号重答取最后一条')
}

// 7) 未匹配答案落入 unmatched
{
  const a: SelfAssessmentAnswerV1[] = [
    { dim: 'interest', idx: 99, choice: 'a' }, // unknown_idx
    { dim: 'fantasy', idx: 0, choice: 'a' }, // unknown_dim
    { dim: 'interest', idx: 0, choice: 'zz' }, // unknown_choice
  ]
  const r = scoreSelfAssessment({ answers: a })
  assert.equal(r.unmatched.length, 3, '3 条未匹配')
  const reasons = r.unmatched.map((u) => u.reason).sort()
  assert.deepEqual(reasons, ['unknown_choice', 'unknown_dim', 'unknown_idx'], '未匹配原因分类正确')
  pass('未匹配答案落入 unmatched 并分类')
}

// 8) evidence 不含答案原文（仅 idx）
{
  const a = makeAnswers()
  const r = scoreSelfAssessment({ answers: a })
  for (const d of r.dimensions) {
    for (const idx of d.evidenceQuestionIdx) {
      assert.ok(typeof idx === 'number' && Number.isInteger(idx), `${d.key} evidence 仅含整数 idx`)
    }
  }
  pass('evidenceQuestionIdx 仅含整数 idx，不含答案原文')
}

// 9) clamp：raw > 5 → 5
{
  const a: SelfAssessmentAnswerV1[] = [
    { dim: 'interest', idx: 4, choice: 'a' }, // weight=7（boundary seed）
  ]
  const r = scoreSelfAssessment({ answers: a, questions: makeQuestions('boundary') })
  const interest = r.dimensions.find((d) => d.key === 'interest')!
  assert.equal(interest.strength, 5, 'raw=7 → 截断为 5')
  pass('strength clamp：raw > 5 → 5')
}

// 10) clamp：raw 非法 → 0
{
  const a: SelfAssessmentAnswerV1[] = [
    { dim: 'interest', idx: 0, choice: 'a' }, // weight=1
  ]
  const questions = makeQuestions()
  // 注入 NaN 权重
  questions.dimensions[0]!.questions[0]!.choices[0]!.weight = Number.NaN
  const r = scoreSelfAssessment({ answers: a, questions })
  const interest = r.dimensions.find((d) => d.key === 'interest')!
  assert.equal(interest.strength, 0, 'NaN weight → strength=0')
  pass('strength clamp：NaN weight → 0')
}

if (failed > 0) {
  console.error(`\nverify-self-assessment failed: ${failed}`)
  process.exit(1)
}
console.log('\nverify-self-assessment passed')
