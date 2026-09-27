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
 * 3.13（2026-09-26）起：
 *   - job-sources / fair-sources 的审核 / 发布 / 下架整组包在托管开关守卫里：托管关闭（我们云上默认）
 *     时不渲染，只留查看与紧急下架；托管打开（私有化部署 b）时按上面的矩阵渲染，另加紧急下架。
 *   - policy-sources 不再有任何管理员审核 / 发布 / 批量发布：政策由机构自己审核发布，
 *     服务端对管理员一律回 403 ADMIN_POLICY_PUBLISH_DISABLED。页面只留查看与紧急下架。
 *
 * Run: pnpm --filter @ai-job-print/admin verify:source-publish-actions
 *
 * ⚠ 该 npm script 现在跑两个脚本：本文件（发布/下架按钮渲染条件），以及
 *   scripts/verify-admin-content-trust-ui.mjs（发布的**前置**：来源机构内容可信控件）。
 *   两者同属「运营到底能不能把内容发出去」这一面，且都是纯静态、无 DB 依赖。
 *   之所以共用一个 script 名而不是各起一个：新增 verify:* 名字必须同时改
 *   .github/workflows/ci.yml，否则 verify:ci-gate-coverage 会判它「未被任何 CI job
 *   执行」而转红。拆名字时请连同 ci.yml 一起改。
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
]

/** 托管开关守卫：管理员对招聘内容的审核 / 发布 / 下架只在它为真时渲染。 */
const HOSTING_GUARD_LINE = '{hosting.writable && ('

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

/**
 * 找到 `{hosting.writable && (` 这一守卫包住的行号区间（按括号配对，JSX 里的中文与 className 不含括号）。
 * 返回 [开始行, 结束行]（1 起算，含两端）。
 */
function hostingGuardRange(source, file) {
  const lines = source.split('\n')
  const starts = lines.flatMap((line, index) => (line.trim() === HOSTING_GUARD_LINE ? [index] : []))
  if (starts.length !== 1) fail(`${rel(file)} 应恰好有 1 处 \`${HOSTING_GUARD_LINE}\` 守卫包住审核 / 发布 / 下架，实际 ${starts.length} 处`)
  let depth = 0
  for (let i = starts[0]; i < lines.length; i += 1) {
    for (const ch of lines[i]) {
      if (ch === '(') depth += 1
      if (ch === ')') depth -= 1
    }
    if (depth === 0) return [starts[0] + 1, i + 1]
  }
  fail(`${rel(file)} 的托管守卫没有闭合`)
}

for (const target of targets) {
  const source = readFileSync(target, 'utf8')
  const [from, to] = hostingGuardRange(source, target)
  const lines = source.split('\n')
  for (const label of ['审核通过', '拒绝', '发布', '下架']) {
    const at = lines.flatMap((line, index) => (line.trim() === label ? [index + 1] : []))
    if (at.length === 0) fail(`${rel(target)} 找不到「${label}」按钮，页面结构已失配`)
    const outside = at.filter((line) => line < from || line > to)
    if (outside.length > 0) {
      fail(`${rel(target)}:${outside.join(',')} 的「${label}」不在托管开关守卫（第 ${from}-${to} 行）里 —— 托管关闭时会渲染出点了就 403 的按钮`)
    }
  }
  if (!/hosting\.writable \? <BulkPublishButton/.test(source)) {
    fail(`${rel(target)} 的批量发布没有按托管开关收起（期望 \`hosting.writable ? <BulkPublishButton\`）`)
  }
  const kind = target.includes('job-sources') ? 'job' : 'job_fair'
  if (!source.includes(`setTakedown({ targetType: '${kind}'`) || !source.includes('<EmergencyTakedownDialog')) {
    fail(`${rel(target)} 没有逐条的紧急下架入口（targetType=${kind}）`)
  }
  const takedownLine = lines.findIndex((line) => line.includes(`setTakedown({ targetType: '${kind}'`)) + 1
  if (takedownLine >= from && takedownLine <= to) {
    fail(`${rel(target)}:${takedownLine} 紧急下架被包进了托管开关守卫 —— 托管关闭时管理员反而无法下架`)
  }
  pass(`${rel(target)} 审核 / 发布 / 下架只在托管打开时渲染（第 ${from}-${to} 行），紧急下架两种状态都在`)
}

// ── 3.13 政策：管理员只读 + 紧急下架 ─────────────────────────────────────────
/** 去掉块注释与行注释，只看会执行的代码（注释里解释「为什么不再调用」不应打挂断言）。 */
function codeOnly(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

{
  const policyPath = join(adminRoot, 'src/routes/policy-sources/index.tsx')
  const policyPage = codeOnly(readFileSync(policyPath, 'utf8'))
  const policyLines = policyPage.split('\n').map((line) => line.trim())
  for (const label of ['审核通过', '拒绝', '发布', '下架']) {
    if (policyLines.includes(label)) fail(`${rel(policyPath)} 仍渲染管理员「${label}」按钮 —— 政策由机构自己审核发布`)
  }
  for (const token of ['reviewPolicy(', 'publishPolicy(', 'BulkPublishButton', 'window.confirm(']) {
    if (policyPage.includes(token)) fail(`${rel(policyPath)} 仍含 ${token} —— 管理员不能审核、发布或按旧方式下架政策`)
  }
  if (!policyPage.includes("setTakedown({ targetType: 'policy'") || !policyPage.includes('<EmergencyTakedownDialog')) {
    fail(`${rel(policyPath)} 缺少政策的紧急下架入口`)
  }
  const policiesService = codeOnly(readFileSync(join(adminRoot, 'src/services/api/policiesAdmin.ts'), 'utf8'))
  for (const token of ['reviewPolicy', 'publishPolicy', '/review`', '/publish`']) {
    if (policiesService.includes(token)) fail(`policiesAdmin.ts 仍能调用管理员审核 / 发布政策（${token}）`)
  }
  pass(`${rel(policyPath)} 只留查看与紧急下架；管理员政策 service 不再提供审核 / 发布`)
}

const jobSources = readFileSync(join(adminRoot, 'src/routes/job-sources/index.tsx'), 'utf8')
const fairSources = readFileSync(join(adminRoot, 'src/routes/fair-sources/index.tsx'), 'utf8')
const policySources = readFileSync(join(adminRoot, 'src/routes/policy-sources/index.tsx'), 'utf8')
const importBatches = readFileSync(join(adminRoot, 'src/routes/import-batches/index.tsx'), 'utf8')

if (!importBatches.includes('filterScope=org') || !fairSources.includes('按来源机构筛选招聘会')) {
  fail('ADM-C9: 查看招聘会必须按机构筛选，横幅不得声称按批次')
}
pass('ADM-C9 招聘会从导入批次进入时横幅按机构诚实说明')

if (fairSources.includes('展位数')) {
  fail('ADM-C14: 不得把 companyCount 标成「展位数」')
}
if (!fairSources.includes('参展企业数')) {
  fail('ADM-C14: 招聘会详情应把 boothCount 标成「参展企业数」')
}
if (jobSources.includes('label="行业"')) {
  fail('ADM-C14: http 模式 industry 恒空，不得渲染行业列/行')
}
pass('ADM-C14 参展企业数 / 行业列口径诚实')

const sourcePaging = readFileSync(join(adminRoot, 'src/services/api/sourcePaging.ts'), 'utf8')
const mockAdapter = readFileSync(join(adminRoot, 'src/services/api/adminMockAdapter.ts'), 'utf8')
const policiesAdmin = readFileSync(join(adminRoot, 'src/services/api/policiesAdmin.ts'), 'utf8')
const httpAdapter = readFileSync(join(adminRoot, 'src/services/api/adminHttpAdapter.ts'), 'utf8')

if (!sourcePaging.includes('items: rows.slice(start, start + pageSize)') || !sourcePaging.includes('total: rows.length')) {
  fail('ADM-C15: sourcePaging 必须按 page/pageSize 切片并返回 total')
}
pass('ADM-C15 mock 分页助手按 page/pageSize 切片并带 total')

for (const [name, source, fetchName] of [
  ['job-sources', jobSources, 'getJobSources'],
  ['fair-sources', fairSources, 'getFairSources'],
  ['policy-sources', policySources, 'getPolicySources'],
]) {
  if (source.includes('服务端当前全量返回，本页本地分页') || source.includes('仅显示前')) {
    fail(`ADM-C15: ${name} 已接服务端分页，不得再声明本地截断`)
  }
  if (source.includes('.slice((page - 1) * pageSize') || source.includes('const total = searched.length')) {
    fail(`ADM-C15: ${name} 不得再对全集做本地 slice / 用筛选长度当 total`)
  }
  if (!source.includes('<Pagination total={total}')) {
    fail(`ADM-C15: ${name} 分页控件必须把服务端 total 传给 Pagination`)
  }
  if (!source.includes('setTotal(pageData.total)') && !source.includes('setTotal(data.total)')) {
    fail(`ADM-C15: ${name} 必须把服务端 total 写入分页控件`)
  }
  if (!source.includes('requireAdminSourcePage')) {
    fail(`ADM-C15: ${name} 必须按分页对象解包，不能把裸数组当成一页`)
  }
  if (!new RegExp(`${fetchName}\\(listQuery\\)`).test(source)) {
    fail(`ADM-C15: ${name} 必须把 page/pageSize 随 listQuery 传给 ${fetchName}`)
  }
}
if (!httpAdapter.includes('toAdminSourceQueryString(query)') || !httpAdapter.includes('isPagedSourceQuery(query)')) {
  fail('ADM-C15: http 适配器必须把 page/pageSize 打进查询串，并按分页形状解包')
}
if (!mockAdapter.includes('paginateAdminSourceRows') || !policiesAdmin.includes('paginateAdminSourceRows')) {
  fail('ADM-C15: mock 必须按 page/pageSize 切片，不能 mock 有分页、http 没分页')
}
pass('ADM-C15 三个来源页分页控件读服务端 total，mock/http 都按 page/pageSize 分页')

console.log('\nALL PASS')
