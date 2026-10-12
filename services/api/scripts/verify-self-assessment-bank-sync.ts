// ============================================================
// 自我探索题库对齐（挂在 verify:assess-isolation 后面）
//
// 契约源：packages/shared/src/data/selfAssessment/v1.questions.json
// 服务端副本：src/ai/resume/self-assessment-questions.ts
// 两份必须逐字一致（版本、维度顺序、每题每个字段、每个选项每个字段）。
// ============================================================

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SELF_ASSESSMENT_QUESTIONS_V1 } from '../src/ai/resume/self-assessment-questions'

const JSON_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'packages',
  'shared',
  'src',
  'data',
  'selfAssessment',
  'v1.questions.json',
)

const EXPECTED_DIMENSIONS = 5
const EXPECTED_QUESTIONS = 25

let passed = 0
let failed = 0

function pass(message: string): void {
  passed += 1
  console.log(`PASS ${message}`)
}

function fail(message: string): void {
  failed += 1
  console.error(`FAIL ${message}`)
}

function show(value: unknown): string {
  if (value === undefined) return '（缺失）'
  return JSON.stringify(value)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return Object.is(left, right)
}

/** 整体深比较。返回的每一行都是一处不一致。 */
function compareBanks(jsonBank: unknown, serverBank: unknown): string[] {
  const diffs: string[] = []

  if (!isObject(jsonBank) || !isObject(serverBank)) {
    diffs.push(`题库：JSON 是${show(jsonBank)} / 服务端是${show(serverBank)}`)
    return diffs
  }

  const topKeys = new Set([...Object.keys(jsonBank), ...Object.keys(serverBank)])
  for (const key of topKeys) {
    if (key === 'dimensions') continue
    if (!valuesEqual(jsonBank[key], serverBank[key])) {
      const name = key === 'version' ? '版本' : key
      diffs.push(`${name}：JSON 是${show(jsonBank[key])} / 服务端是${show(serverBank[key])}`)
    }
  }

  const jsonDims = jsonBank.dimensions
  const serverDims = serverBank.dimensions
  if (!Array.isArray(jsonDims) || !Array.isArray(serverDims)) {
    diffs.push(`维度：JSON 是${show(jsonDims)} / 服务端是${show(serverDims)}`)
    return diffs
  }

  const dimCount = Math.max(jsonDims.length, serverDims.length)
  for (let di = 0; di < dimCount; di++) {
    const whereDim = `第${di + 1}维`
    const jsonDim = jsonDims[di]
    const serverDim = serverDims[di]
    if (!isObject(jsonDim) || !isObject(serverDim)) {
      diffs.push(`${whereDim}：JSON 是${show(jsonDim)} / 服务端是${show(serverDim)}`)
      continue
    }

    const dimKeys = new Set([...Object.keys(jsonDim), ...Object.keys(serverDim)])
    for (const key of dimKeys) {
      if (key === 'questions') continue
      if (!valuesEqual(jsonDim[key], serverDim[key])) {
        diffs.push(`${whereDim} ${key}：JSON 是${show(jsonDim[key])} / 服务端是${show(serverDim[key])}`)
      }
    }

    const jsonQuestions = jsonDim.questions
    const serverQuestions = serverDim.questions
    if (!Array.isArray(jsonQuestions) || !Array.isArray(serverQuestions)) {
      diffs.push(`${whereDim} questions：JSON 是${show(jsonQuestions)} / 服务端是${show(serverQuestions)}`)
      continue
    }

    const questionCount = Math.max(jsonQuestions.length, serverQuestions.length)
    for (let qi = 0; qi < questionCount; qi++) {
      const whereQuestion = `${whereDim}第${qi + 1}题`
      const jsonQuestion = jsonQuestions[qi]
      const serverQuestion = serverQuestions[qi]
      if (!isObject(jsonQuestion) || !isObject(serverQuestion)) {
        diffs.push(`${whereQuestion}：JSON 是${show(jsonQuestion)} / 服务端是${show(serverQuestion)}`)
        continue
      }

      const questionKeys = new Set([...Object.keys(jsonQuestion), ...Object.keys(serverQuestion)])
      for (const key of questionKeys) {
        if (key === 'choices') continue
        if (!valuesEqual(jsonQuestion[key], serverQuestion[key])) {
          diffs.push(`${whereQuestion} ${key}：JSON 是${show(jsonQuestion[key])} / 服务端是${show(serverQuestion[key])}`)
        }
      }

      const jsonChoices = jsonQuestion.choices
      const serverChoices = serverQuestion.choices
      if (!Array.isArray(jsonChoices) || !Array.isArray(serverChoices)) {
        diffs.push(`${whereQuestion} choices：JSON 是${show(jsonChoices)} / 服务端是${show(serverChoices)}`)
        continue
      }

      const choiceCount = Math.max(jsonChoices.length, serverChoices.length)
      for (let ci = 0; ci < choiceCount; ci++) {
        const jsonChoice = jsonChoices[ci]
        const serverChoice = serverChoices[ci]
        const letterSource = isObject(jsonChoice) ? jsonChoice : isObject(serverChoice) ? serverChoice : null
        const letter = letterSource && typeof letterSource.key === 'string' ? letterSource.key : String(ci + 1)
        const whereChoice = `${whereQuestion}选项${letter}`
        if (!isObject(jsonChoice) || !isObject(serverChoice)) {
          diffs.push(`${whereChoice}：JSON 是${show(jsonChoice)} / 服务端是${show(serverChoice)}`)
          continue
        }
        const choiceKeys = new Set([...Object.keys(jsonChoice), ...Object.keys(serverChoice)])
        for (const key of choiceKeys) {
          if (!valuesEqual(jsonChoice[key], serverChoice[key])) {
            diffs.push(`${whereChoice} ${key}：JSON 是${show(jsonChoice[key])} / 服务端是${show(serverChoice[key])}`)
          }
        }
      }
    }
  }

  return diffs
}

function countDimensions(bank: unknown): number {
  if (!isObject(bank) || !Array.isArray(bank.dimensions)) return -1
  return bank.dimensions.length
}

function countQuestions(bank: unknown): number {
  if (!isObject(bank) || !Array.isArray(bank.dimensions)) return -1
  let total = 0
  for (const dimension of bank.dimensions) {
    if (!isObject(dimension) || !Array.isArray(dimension.questions)) return -1
    total += dimension.questions.length
  }
  return total
}

const jsonBank: unknown = JSON.parse(readFileSync(JSON_PATH, 'utf8'))
const serverBank: unknown = SELF_ASSESSMENT_QUESTIONS_V1

const diffs = compareBanks(jsonBank, serverBank)
if (diffs.length === 0) {
  pass('题库与共享 JSON 逐字一致')
} else {
  for (const diff of diffs) fail(diff)
}

const jsonDimensions = countDimensions(jsonBank)
const serverDimensions = countDimensions(serverBank)
if (jsonDimensions === EXPECTED_DIMENSIONS && serverDimensions === EXPECTED_DIMENSIONS) {
  pass(`维度 ${EXPECTED_DIMENSIONS}`)
} else {
  fail(`维度应为 ${EXPECTED_DIMENSIONS}：JSON 是${jsonDimensions} / 服务端是${serverDimensions}`)
}

const jsonQuestions = countQuestions(jsonBank)
const serverQuestions = countQuestions(serverBank)
if (jsonQuestions === EXPECTED_QUESTIONS && serverQuestions === EXPECTED_QUESTIONS) {
  pass(`题数 ${EXPECTED_QUESTIONS}`)
} else {
  fail(`题数应为 ${EXPECTED_QUESTIONS}：JSON 是${jsonQuestions} / 服务端是${serverQuestions}`)
}

// 阳性对照：内存里改掉共享题库的一个字，比较函数必须报出这一处。
const mutated = JSON.parse(JSON.stringify(jsonBank)) as {
  dimensions: Array<{ questions: Array<{ prompt: string }> }>
}
const originalPrompt = mutated.dimensions[0].questions[0].prompt
const changedPrompt = `${originalPrompt.slice(0, -1)}${originalPrompt.endsWith('？') ? '。' : '？'}`
mutated.dimensions[0].questions[0].prompt = changedPrompt
const positiveDiffs = compareBanks(jsonBank, mutated)
const positiveHit = positiveDiffs.find(
  (line) => line.startsWith('第1维第1题 prompt：') && line.includes(show(originalPrompt)) && line.includes(show(changedPrompt)),
)
if (positiveDiffs.length === 1 && positiveHit) {
  pass('阳性对照：改掉一个字后比较函数报出不一致')
} else {
  fail(`阳性对照：改掉一个字后比较函数没有只报出这一处（得到 ${positiveDiffs.length} 条）`)
  for (const line of positiveDiffs) console.error(`  ${line}`)
}

console.log(`汇总：PASS ${passed}，FAIL ${failed}`)
if (failed > 0) process.exit(1)
