// ============================================================================
// CI 串行命令清单执行器（跑完再汇总）
//
// 给 .github/workflows/ci.yml 里超长的 Verify suites / Core verify suites on PG
// 用：bash 默认 `set -e` 会在第一条失败处停掉整个 step，后面的门禁根本看不到。
// 本脚本从 stdin 读命令清单，逐条 spawnSync（仍串行，禁止并行），收集失败，
// 全部跑完后打印汇总；有失败则非零退出。
//
// 必须放在 scripts/lib/：verify:ci-gate-coverage 把 scripts/ 下的 .mjs 当门禁
// 入口，但排除 /scripts/lib/。放别处会被判成「未接线门禁」。
//
// 清单规则（与 ci.yml heredoc 对齐）：
//   - 空行跳过
//   - 首个非空白字符为 # 的行当注释跳过
//   - 其余每一行是一条完整 shell 命令（含 VAR=value 前缀）
//   - 用 /bin/bash -c 执行，语义与原来的 `run: |` 行一致
// ============================================================================

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const BASH = '/bin/bash'

function failUsage(message) {
  process.stderr.write(`ERROR: ${message}\n`)
  process.exit(2)
}

function readCommandList() {
  if (process.stdin.isTTY) {
    failUsage('expected a command list on stdin (pipe or heredoc), not a TTY')
  }

  let text
  try {
    text = readFileSync(0, 'utf8')
  } catch (error) {
    failUsage(`failed to read command list from stdin: ${error.message}`)
  }

  const commands = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('#')) continue
    commands.push(line)
  }

  if (commands.length === 0) {
    failUsage('command list is empty (no runnable lines after skipping comments/blanks)')
  }

  return commands
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatFailure(failure) {
  if (failure.error) return `error=${failure.error}`
  if (failure.signal) return `signal=${failure.signal}`
  return `exit=${failure.code}`
}

function runCommand(command) {
  const started = Date.now()
  const result = spawnSync(BASH, ['-c', command], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: process.env,
    cwd: process.cwd(),
  })
  return { result, durationMs: Date.now() - started }
}

function main() {
  const commands = readCommandList()
  const total = commands.length
  const failures = []

  process.stderr.write(`serial commands: ${total} (run all, then summarize)\n`)

  for (let i = 0; i < commands.length; i++) {
    const command = commands[i]
    const seq = i + 1
    process.stderr.write(`\n[${seq}/${total}] $ ${command}\n`)

    const { result, durationMs } = runCommand(command)
    const elapsed = formatDuration(durationMs)

    if (result.error) {
      process.stderr.write(`[${seq}/${total}] FAILED error=${result.error.message} (${elapsed})\n`)
      failures.push({ seq, command, error: result.error.message })
      continue
    }

    if (result.signal) {
      process.stderr.write(`[${seq}/${total}] FAILED signal=${result.signal} (${elapsed})\n`)
      failures.push({ seq, command, signal: result.signal })
      continue
    }

    if (result.status !== 0) {
      const code = result.status ?? 1
      process.stderr.write(`[${seq}/${total}] FAILED exit=${code} (${elapsed})\n`)
      failures.push({ seq, command, code })
      continue
    }

    process.stderr.write(`[${seq}/${total}] OK (${elapsed})\n`)
  }

  process.stderr.write('\n----- serial command summary -----\n')
  process.stderr.write(`ran: ${total}\n`)
  process.stderr.write(`passed: ${total - failures.length}\n`)
  process.stderr.write(`failed: ${failures.length}\n`)

  if (failures.length > 0) {
    process.stderr.write('\nfailed commands:\n')
    for (const failure of failures) {
      process.stderr.write(`  [${failure.seq}/${total}] ${formatFailure(failure)}  ${failure.command}\n`)
    }
    process.stderr.write('----------------------------------\n')
    process.exit(1)
  }

  process.stderr.write('----------------------------------\n')
}

main()
