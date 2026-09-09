#!/usr/bin/env node
/**
 * verify:ci-main-runs-complete —— main 上的 CI 运行不得被后续推送取消。
 *
 * 防的是 2026-09-08 实测到的结构性问题：`concurrency.cancel-in-progress: true`
 * 对所有 ref 一视同仁，于是**每次合并都会掐掉正在跑的 main CI**。
 * 当天 main 上最近 25 次 CI：**20 次 cancelled / 4 次 success**。
 *
 * 后果不是浪费 CI 时间，是**发布拿不到绿运行号**：
 * `deploy.yml` 强制校验 `name=CI && head_branch=main && conclusion=success`
 * （这条校验是「只发 CI 验证过的提交」的唯一执行点，不得为赶时间放松），
 * 所以 main CI 一直被取消 = 一直发不出去。当天一个上线阻塞级修复
 * （终端会话失效后页面永久卡死）因此连续三轮发布失败。
 *
 * 正确形态：PR 分支照常取消（省时间），main 必须跑完。
 *
 * ── 2026-09-09 复发：上面那条修对了一半 ────────────────────────────────────
 * `cancel-in-progress: false` 保住的是**正在跑**的 run；**排队中**的 run 不受它保护 ——
 * 同一个 concurrency group 里 GitHub 只保留最新的那个待跑 run，更早的一律取消。
 * main CI 要跑 ~30 分钟而合并每 ~6 分钟一次，于是每一次都在排队阶段被顶掉。
 *
 * 决定性判据是 **job 数**（不是 conclusion）：
 *   run 34346438000 / 34347178593 / 34347730125 全部 conclusion=cancelled，
 *   而三者 `GET /actions/runs/:id/jobs` 返回的 **job 数都是 0** —— 一个 job 都没启动过。
 *   取消时刻分别精确等于下一次 run 的创建时刻。
 * 后果与去年那次相同：四次合并之后 main 没有任何一次完整跑过，
 * 最后一次绿停在合并之前，发布再次落进「状态未知」区间。
 *
 * 所以本门禁此前的断言不够：它断言的是「配置写成了我相信的那个样子」，
 * 而那个样子挡不住排队阶段的取消。现在补断言「main 上不同提交不得共用 group」。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const ciPath = resolve(here, '../.github/workflows/ci.yml')
const deployPath = resolve(here, '../.github/workflows/deploy.yml')
const ci = readFileSync(ciPath, 'utf8')
const deploy = readFileSync(deployPath, 'utf8')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail && !ok ? ` — ${detail}` : ''}`)
}

// ── 一、main 不得被取消 ──────────────────────────────────────────────────
const concurrency = ci.slice(ci.indexOf('\nconcurrency:'), ci.indexOf('\njobs:'))
check(
  'ci.yml 有 concurrency 块',
  concurrency.includes('concurrency:'),
)
check(
  'cancel-in-progress 不是无条件 true',
  !/cancel-in-progress:\s*true\s*$/m.test(concurrency),
  'main 上的运行会被下一次合并掐掉，发布将永远拿不到绿运行号',
)
check(
  'cancel-in-progress 按 ref 排除 main',
  /cancel-in-progress:\s*\$\{\{\s*github\.ref\s*!=\s*'refs\/heads\/main'\s*\}\}/.test(concurrency),
  '必须写成 ${{ github.ref != \'refs/heads/main\' }}',
)
check(
  '并发分组仍按 ref 隔离（不同分支互不影响）',
  /group:\s*ci-\$\{\{\s*github\.ref\s*\}\}/.test(concurrency),
)
check(
  'main 上不同提交不得共用 concurrency group',
  /github\.ref\s*==\s*'refs\/heads\/main'\s*&&\s*format\(\s*'-\{0\}'\s*,\s*github\.sha\s*\)/.test(
    concurrency,
  ),
  "共用 group 时，排队中的旧 run 会被新 run 顶掉（cancel-in-progress 管不到排队）；"
    + "main 段必须把 github.sha 拼进 group",
)

// ── 二、被保护的那条不变量仍在（否则本门禁就没有意义）────────────────────
// 只有当部署确实要求「main 上 conclusion=success 的 CI」时，
// 「main CI 必须跑完」才是刚需。两者一起构成完整链条。
check(
  'deploy 仍强制校验运行必须是 CI',
  /\[\s*"\$NAME"\s*!=\s*"CI"\s*\]/.test(deploy),
  '若放松此校验，可发出未经 CI 验证的提交',
)
check(
  'deploy 仍强制校验分支为 main',
  /\[\s*"\$BRANCH"\s*!=\s*"main"\s*\]/.test(deploy),
)
check(
  'deploy 仍强制校验结论为 success',
  /\[\s*"\$CONCL"\s*!=\s*"success"\s*\]/.test(deploy),
  '这是「只发 CI 验证过的提交」的唯一执行点，不得为赶时间放松',
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? '✅ ALL PASS' : `❌ ${failed.length} 项失败`} — main CI 必须跑完`)
process.exit(failed.length === 0 ? 0 : 1)
