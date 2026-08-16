/**
 * 来源审核页「发布 / 下架」按钮渲染条件守卫。
 *
 * 背景（2026-08-16 线上事故）：
 *   job-sources / fair-sources 把「发布」按钮的渲染条件写成
 *     reviewStatus === 'approved' && publishStatus === 'draft'
 *   而后端 publishJobSource() / publishFairSource() 只校验 reviewStatus === 'approved'，
 *   不校验当前 publishStatus —— 也就是说 unpublished 的行在 API 层本来就允许重新发布。
 *   结果：只要某行被「下架」过一次（publishStatus 变成 'unpublished'），
 *   操作列就只剩「查看」，再也无法从后台恢复上架。生产库因此积压了
 *   217 条 approved + unpublished 的岗位和 3 场招聘会。
 *
 * 本脚本刻意不做字符串匹配（那样只能锁死写法、锁不住行为）：
 *   它把 JSX 里的守卫表达式原样抽出来，在 ReviewStatus × PublishStatus
 *   的 4×4 全矩阵上真正求值，断言渲染行为与后端契约完全等价。
 *
 * 期望契约：
 *   「发布」渲染 ⟺ reviewStatus === 'approved' && publishStatus !== 'published'
 *   「下架」渲染 ⟺ publishStatus === 'published'
 *
 * Run: pnpm --filter @ai-job-print/admin verify:source-publish-actions
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(adminRoot, '..', '..')

/** 与 packages/shared/src/types/job.ts 保持一致 */
const REVIEW_STATUSES = ['pending', 'reviewing', 'approved', 'rejected']
const PUBLISH_STATUSES = ['draft', 'published', 'unpublished', 'expired']

/** 后端契约对应的期望渲染函数 */
const ORACLES = {
  发布: (row) => row.reviewStatus === 'approved' && row.publishStatus !== 'published',
  下架: (row) => row.publishStatus === 'published',
}

const targets = [
  join(adminRoot, 'src/routes/job-sources/index.tsx'),
  join(adminRoot, 'src/routes/fair-sources/index.tsx'),
  join(adminRoot, 'src/routes/policy-sources/index.tsx'),
]

/** 形如 `{<expr> && (` 的 JSX 守卫行 */
const GUARD_RE = /^\s*\{(.+?)\s*&&\s*\($/
const LOOKAHEAD = 24

function fail(message) {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

function pass(message) {
  console.log(`  PASS ${message}`)
}

function rel(path) {
  return path.replace(repoRoot + '/', '')
}

/**
 * 抽出每个「发布 / 下架」按钮前最近的一层守卫表达式。
 * 遇到下一个守卫行即停止前瞻，避免把上一组（审核通过 / 拒绝）的条件错配过来。
 */
function collectGuardedButtons(source) {
  const lines = source.split('\n')
  const found = []
  for (let i = 0; i < lines.length; i += 1) {
    const matched = lines[i].match(GUARD_RE)
    if (!matched) continue
    const condition = matched[1]
    for (let j = i + 1; j < Math.min(lines.length, i + LOOKAHEAD); j += 1) {
      if (GUARD_RE.test(lines[j])) break
      const label = lines[j].trim()
      if (label in ORACLES) {
        found.push({ label, condition, line: i + 1 })
        break
      }
    }
  }
  return found
}

function evaluateGuard(condition, row) {
  const varMatch = condition.match(/([A-Za-z_$][\w$]*)\s*\./)
  if (!varMatch) fail(`无法从守卫条件中解析行变量名: ${condition}`)
  const varName = varMatch[1]
  let fn
  try {
    fn = new Function(varName, `return Boolean(${condition})`)
  } catch (e) {
    fail(`守卫条件无法求值: ${condition} (${e.message})`)
  }
  return fn(row)
}

console.log('\n=== 来源审核页 发布/下架 按钮渲染条件验证 ===')

for (const target of targets) {
  if (!existsSync(target)) fail(`文件不存在: ${target}`)
  const source = readFileSync(target, 'utf8')
  const buttons = collectGuardedButtons(source)

  // 防止提取失败导致「空断言通过」
  for (const label of Object.keys(ORACLES)) {
    const hits = buttons.filter((b) => b.label === label)
    if (hits.length === 0) fail(`${rel(target)} 未提取到「${label}」按钮的渲染守卫，脚本或页面结构已失配`)
    if (hits.length > 1) fail(`${rel(target)} 提取到 ${hits.length} 个「${label}」按钮守卫，预期 1 个`)
  }

  for (const { label, condition, line } of buttons) {
    const oracle = ORACLES[label]
    for (const reviewStatus of REVIEW_STATUSES) {
      for (const publishStatus of PUBLISH_STATUSES) {
        const row = { reviewStatus, publishStatus }
        const actual = evaluateGuard(condition, row)
        const expected = oracle(row)
        if (actual !== expected) {
          fail(
            `${rel(target)}:${line} 「${label}」渲染条件与后端契约不符\n` +
              `       条件: ${condition}\n` +
              `       用例: reviewStatus=${reviewStatus}, publishStatus=${publishStatus}\n` +
              `       期望渲染=${expected}, 实际渲染=${actual}`,
          )
        }
      }
    }
    pass(`${rel(target)}:${line} 「${label}」在 ${REVIEW_STATUSES.length}×${PUBLISH_STATUSES.length} 状态矩阵上与后端契约一致`)
  }

  // 事故本体的具名回归用例：approved + unpublished 必须点得出「发布」
  const publishGuard = buttons.find((b) => b.label === '发布')
  const regressionRow = { reviewStatus: 'approved', publishStatus: 'unpublished' }
  if (!evaluateGuard(publishGuard.condition, regressionRow)) {
    fail(`${rel(target)}:${publishGuard.line} approved + unpublished 的行渲染不出「发布」按钮（2026-08-16 事故回归）`)
  }
  pass(`${rel(target)} approved + unpublished 可渲染「发布」按钮`)
}

console.log('\nALL PASS')
