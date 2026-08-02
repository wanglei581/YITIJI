#!/usr/bin/env node
/**
 * Verify self-assessment-staged-cleanup-r3 实质 commit 还在 cherry-pick 链路上。
 *
 * 不依赖 NestJS / Prisma / 网络；纯 git log / git show 检查。
 * 用于 PR #486 CI 漂移时本地兜底：即便 verify-fusion-w4 等被 G1 (#482) 卡住,
 * 本脚本能证明 self-assessment v1 三模型审查修复仍在分支历史上。
 *
 * Run: node scripts/verify-self-assessment-r3-pick.mjs
 */
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd: process.cwd() }).trim()
}

function fail(message) {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

function pass(message) {
  console.log(`  PASS ${message}`)
}

const HEAD = git(['rev-parse', 'HEAD'])
const SHORT = HEAD.slice(0, 7)
console.log(`\n=== Self-assessment r3 cherry-pick 兜底（HEAD=${SHORT}） ===`)

const MERGE_BASE = git(['merge-base', 'HEAD', 'origin/main'])
const log = git([
  'log',
  '--pretty=format:%H|%s',
  `${MERGE_BASE}..HEAD`,
])
const commits = log
  .split('\n')
  .map((line) => {
    const [hash, ...rest] = line.split('|')
    return { hash, subject: rest.join('|') }
  })

const FIX_COMMIT = '30018b7964a5cab2fe018e587eaa7db2a85a465c'
const DOC_COMMIT_SUBJECT = 'self-assessment v1 三模型审查收尾 r3'

const fixInHistory = commits.some(
  (c) => c.hash === FIX_COMMIT || c.subject.includes('修 7 项 Critical'),
)
assert(fixInHistory, 'r3 must carry self-assessment 7 项 Critical fix commit (or equivalent)')
pass('r3 carries self-assessment 7 项 Critical fix commit')

const docCommit = commits.find((c) => c.subject.includes(DOC_COMMIT_SUBJECT))
assert(docCommit, 'r3 must have a docs commit recording self-assessment v1 三模型审查收尾 r3')
pass('r3 docs commit found')

const diff = git(['diff', '--name-only', `${MERGE_BASE}..HEAD`])
const expectedTouched = [
  'services/api/src/audit/audit.types.ts',
  'services/api/src/ai/self-assessment.controller.ts',
  'services/api/src/files/file-validation.ts',
  'services/api/src/ai/resume/self-assessment.service.ts',
  'services/api/src/ai/resume/appended-self-assessment.service.ts',
  'services/api/src/ai/resume/career-plan.service.ts',
  'services/api/src/ai/resume/llm-career-plan.service.ts',
  'apps/kiosk/tests/visual/fusion-self-assessment-flow.spec.ts',
  'docs/reviews/2026-08-02-self-assessment-v1-three-model-review.md',
  'docs/reviews/self-assessment-v1-review-scope.md',
  'docs/progress/current-progress.md',
]

const missing = expectedTouched.filter((p) => !diff.split('\n').includes(p))
if (missing.length) fail(`r3 cherry-pick missing files: ${missing.join(', ')}`)
pass('r3 cherry-pick touches all 7 service files + 2 review docs + current-progress.md')

console.log('\n=== ALL PASS ===')