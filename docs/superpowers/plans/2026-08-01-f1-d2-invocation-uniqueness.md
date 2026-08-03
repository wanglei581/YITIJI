# F1 D2 Invocation Uniqueness Implementation Plan

> **历史计划（已被替代）：** 本文记录的是已合入 `main` 的 #463 初始方案，不再作为当前执行真值。后续 D2′ 调用治理必须以 `docs/device/f1-d2-same-host-dual-port-runbook.md` 和当前代码中的 `governance.mjs reserve/invoke` 合同为准；不要继续实施本文的 JSONL ledger、全局锁或 `--consume` 设计。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不执行 full drill 的前提下，用两阶段 `reserve` / `consume` 协议保证每个 D2 fresh-retake 的 task、baseline、branch、clone、evidence 和 archive 身份均只能使用一次。

**Architecture:** clone 创建前，宿主从已审基线调用 `invocation-governance.mjs --reserve`，在仓库外 owner-only governance root 中通过全局短临界区、脱敏 JSONL ledger 和持久 reservation 建立唯一性。clone 创建后，`run.sh` 在 kernel/toolchain/preflight/nonce 之前调用 `--consume`，原子写入 `INVOKED`；后续任何成败都不删除 reservation。既有 988 行 verifier 只做薄接线，行为与并发测试放入独立 verifier。

**Tech Stack:** Node.js ESM、`node:fs`、`node:crypto`、Bash、Linux/macOS POSIX filesystem primitives、JSON Lines、现有 D2 offline contract。

---

## 文件责任与边界

- 新建 `services/api/scripts/d2-same-host/invocation-governance.mjs`：纯治理协议与 CLI；不启动演练、Colima、systemd、PM2 或 Nginx。
- 新建 `services/api/scripts/d2-same-host/verify-invocation-governance.mjs`：临时目录内的单元/并发/泄漏/崩溃合同。
- 修改 `services/api/scripts/d2-same-host/verify-contract.mjs`：仅 import 并 await 新 verifier，保持低于 1000 行。
- 修改 `services/api/scripts/d2-same-host/run.sh`：在既有前置门禁之前 consume，在 approved PATH 建立后复核 Git baseline；不改 `drill.mjs`、证据 schema 或 cleanup 语义。
- 修改 `docs/device/f1-d2-same-host-dual-port-runbook.md`：新增 pre-clone reservation 命令和更新唯一 full-drill command。
- 修改 `docs/progress/current-progress.md` 与 `docs/progress/next-tasks.md`：只记录代码候选和未演练/NO-GO 事实。
- 修改 `.ccg/tasks/f1-d2-invocation-uniqueness-20260801/`：任务状态、审查和归档。

## 协议不变量

```js
const INPUT_KEYS = Object.freeze([
  'D2_GOVERNANCE_ROOT',
  'D2_TASK_ID',
  'D2_BASELINE_SHA',
  'D2_BRANCH_NAME',
  'D2_CLONE_PATH',
  'D2_EVIDENCE_OUT',
  'D2_ARCHIVE_PATH',
])

const ERROR_CODES = Object.freeze({
  PATH: 'D2_PRIME_NO_GO_GOVERNANCE_PATH',
  INPUT: 'D2_PRIME_NO_GO_INVOCATION_INPUT',
  BUSY: 'D2_PRIME_NO_GO_INVOCATION_BUSY',
  RESERVED: 'D2_PRIME_NO_GO_INVOCATION_RESERVED',
  NOT_RESERVED: 'D2_PRIME_NO_GO_INVOCATION_NOT_RESERVED',
  ARCHIVE_EXISTS: 'D2_PRIME_NO_GO_ARCHIVE_EXISTS',
  LEDGER: 'D2_PRIME_NO_GO_INVOCATION_LEDGER',
})
```

- governance root 必须预先存在、为 owner-owned 真实目录、mode `0700`、位于 clone/repository 外。
- `taskId` 匹配 `^[a-z0-9][a-z0-9-]{0,95}$`；baseline 匹配 `^[0-9a-f]{40}$`；branch 拒绝 control/space、`..`、`@{`、`.lock`、首尾 `/` 或 `.` 及 Git 禁用字符。
- clone/evidence/archive 使用“真实 parent + basename”得到未来物理身份；`reserve` 时三个 target 必须不存在且不是 symlink。
- 追加 ledger 只写 facet SHA-256、`RESERVED|INVOKED`、schema version 和 RFC3339 时间；不写原始 path/SHA/task/branch/nonce/env。
- 全局 `reservation.lock` 只在成功完成一次原子变更或纯读拒绝时移除；已产生部分持久变更后发生错误则保留 busy tombstone，禁止当窗口自动恢复。

### Task 1: 先建立独立 RED 行为合同

**Files:**
- Create: `services/api/scripts/d2-same-host/verify-invocation-governance.mjs`
- Modify: `services/api/scripts/d2-same-host/verify-contract.mjs:1-30,960-988`

- [x] **Step 1: 写失败测试入口**

```js
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ERROR_CODES, consumeInvocation, reserveInvocation,
} from './invocation-governance.mjs'

export async function verifyInvocationGovernanceContract() {
  await verifyReserveConsumeAndReplay()
  await verifyConcurrentSingleWinner()
  verifyArchiveAndAliasRejection()
  verifyCrashAndLedgerFailures()
  await verifyCliRedaction()
  console.log('  PASS invocation governance atomically reserves and consumes each retake once')
}
```

每个 helper 必须在 `mkdtempSync(join(tmpdir(), 'd2-invocation-'))` 下自建 mode `0700` fixture，在 `finally` 中只删除该临时根。断言至少覆盖：

```js
assert.equal(first.event, 'RESERVED')
assert.throws(() => reserveInvocation(reusedCloneWithNewEvidence),
  (error) => error?.message === ERROR_CODES.RESERVED)
assert.throws(() => consumeInvocation(firstInput),
  (error) => error?.message === ERROR_CODES.RESERVED)
assert.equal(statSync(join(governanceRoot, 'invocations.jsonl')).mode & 0o777, 0o600)
assert.equal(ledger.includes(taskId), false)
assert.equal(ledger.includes(clonePath), false)
assert.equal(ledger.includes(baselineSha), false)
```

- [x] **Step 2: 将新 verifier 薄接入总门禁**

```js
import { verifyInvocationGovernanceContract } from './verify-invocation-governance.mjs'

async function main(args = process.argv.slice(2)) {
  // 保留既有顺序
  await verifyInvocationGovernanceContract()
  console.log('D2_PRIME_CONTRACT_ALL_PASS')
  verifyEvidenceFile(args)
}

try {
  await main()
} catch (error) {
  // 保留既有脱敏错误映射
}
```

- [x] **Step 3: 运行 RED**

Run:

```bash
node services/api/scripts/d2-same-host/verify-invocation-governance.mjs
pnpm --filter @ai-job-print/api verify:d2-same-host-contract
```

Expected: 因 `invocation-governance.mjs` 不存在而失败；不得出现 `D2_PRIME_CONTRACT_ALL_PASS`。记录精确 RED 错误。

### Task 2: 实现 reserve/consume 原子协议

**Files:**
- Create: `services/api/scripts/d2-same-host/invocation-governance.mjs`
- Test: `services/api/scripts/d2-same-host/verify-invocation-governance.mjs`

- [x] **Step 1: 实现固定错误与 canonical facet**

```js
export const ERROR_CODES = Object.freeze({
  PATH: 'D2_PRIME_NO_GO_GOVERNANCE_PATH',
  INPUT: 'D2_PRIME_NO_GO_INVOCATION_INPUT',
  BUSY: 'D2_PRIME_NO_GO_INVOCATION_BUSY',
  RESERVED: 'D2_PRIME_NO_GO_INVOCATION_RESERVED',
  NOT_RESERVED: 'D2_PRIME_NO_GO_INVOCATION_NOT_RESERVED',
  ARCHIVE_EXISTS: 'D2_PRIME_NO_GO_ARCHIVE_EXISTS',
  LEDGER: 'D2_PRIME_NO_GO_INVOCATION_LEDGER',
})

function fail(code) {
  throw new Error(code)
}

function facetIds(input) {
  return Object.freeze({
    taskId: sha256(input.taskId),
    baselineId: sha256(input.baselineSha),
    branchId: sha256(input.branchName),
    cloneId: sha256(canonicalFutureOrExistingPath(input.clonePath)),
    evidenceId: sha256(canonicalFuturePath(input.evidenceOut)),
    archiveId: sha256(canonicalFuturePath(input.archivePath)),
  })
}
```

- [x] **Step 2: 实现临界区和 ledger**

```js
function withGovernanceLock(root, action) {
  const lockPath = join(root, 'reservation.lock')
  try {
    mkdirSync(lockPath, { mode: 0o700 })
  } catch (error) {
    if (error?.code === 'EEXIST') fail(ERROR_CODES.BUSY)
    fail(ERROR_CODES.LEDGER)
  }
  let durableMutation = false
  try {
    const result = action(() => { durableMutation = true })
    rmSync(lockPath, { recursive: false })
    return result
  } catch (error) {
    if (!durableMutation) rmSync(lockPath, { recursive: false, force: true })
    throw error
  }
}

function appendEvent(root, event, facets, recordedAt) {
  const line = `${JSON.stringify({ v: 1, event, recordedAt, ...facets })}\n`
  if (Buffer.byteLength(line) > 4096) fail(ERROR_CODES.LEDGER)
  const fd = openSync(join(root, 'invocations.jsonl'), 'a', 0o600)
  try {
    writeSync(fd, line)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}
```

任何 `mkdirSync` 或 `O_CREAT|O_EXCL` 成功后必须立即调用 `markDurableMutation()`，早于后续权限校验、写入与 fsync；从该时刻起的任何失败都必须保留 `reservation.lock`。

- [x] **Step 3: 实现 reserve**

```js
export function reserveInvocation(rawInput, options = {}) {
  const input = validateReserveInput(rawInput)
  const root = validateGovernanceRoot(input.governanceRoot, input.clonePath)
  return withGovernanceLock(root, (markDurableMutation) => {
    assertTargetsAbsent(input)
    const facets = facetIds(input)
    const records = readLedger(root)
    if (records.some((record) => Object.keys(facets).some((key) => record[key] === facets[key]))) {
      fail(ERROR_CODES.RESERVED)
    }
    const reservationDir = join(root, 'reservations', facets.taskId)
    mkdirSync(reservationDir, { mode: 0o700 })
    markDurableMutation()
    writeExclusiveJson(join(reservationDir, 'reservation.json'), { v: 1, ...facets })
    appendEvent(root, 'RESERVED', facets, new Date((options.now ?? Date.now)()).toISOString())
    return Object.freeze({ event: 'RESERVED' })
  })
}
```

- [x] **Step 4: 实现 consume 与 CLI**

```js
export function consumeInvocation(rawInput, options = {}) {
  const input = validateConsumeInput(rawInput)
  const root = validateGovernanceRoot(input.governanceRoot, input.clonePath)
  return withGovernanceLock(root, (markDurableMutation) => {
    assertConsumeTargets(input)
    const facets = facetIds(input)
    const reservationDir = join(root, 'reservations', facets.taskId)
    const reserved = readReservation(reservationDir)
    if (!reserved) fail(ERROR_CODES.NOT_RESERVED)
    if (JSON.stringify(reserved) !== JSON.stringify({ v: 1, ...facets })) {
      fail(ERROR_CODES.NOT_RESERVED)
    }
    writeExclusiveJson(join(reservationDir, 'invoked.json'), { v: 1, ...facets })
    markDurableMutation()
    appendEvent(root, 'INVOKED', facets, new Date((options.now ?? Date.now)()).toISOString())
    return Object.freeze({ event: 'INVOKED' })
  })
}

if (isMain(import.meta.url)) {
  try {
    const input = inputFromEnvironment(process.env)
    process.argv[2] === '--reserve' ? reserveInvocation(input) : consumeInvocation(input)
  } catch (error) {
    const code = Object.values(ERROR_CODES).includes(error?.message) ? error.message : ERROR_CODES.LEDGER
    process.stderr.write(`${code}\n`)
    process.exitCode = 2
  }
}
```

- [x] **Step 5: 运行 GREEN 并检查文件模式**

Run:

```bash
node --check services/api/scripts/d2-same-host/invocation-governance.mjs
node --check services/api/scripts/d2-same-host/verify-invocation-governance.mjs
pnpm --filter @ai-job-print/api verify:d2-same-host-contract
```

Expected: concurrency 精确一个 reserve 成功，重放/别名/archive/崩溃/append 失败全部 fail closed；在 Task 3 尚未接线时，独立 verifier 只允许停在 `run.sh` consume wiring RED。

### Task 3: 将 consume 放到 run.sh 最早可信边界

**Files:**
- Modify: `services/api/scripts/d2-same-host/run.sh:1-90,180-205`
- Test: `services/api/scripts/d2-same-host/verify-invocation-governance.mjs`
- Test: `services/api/scripts/d2-same-host/verify-contract.mjs`

- [x] **Step 1: 先增加 wiring mutation 断言并确认 RED**

```js
const consumeAnchor = '"$GOVERNANCE_NODE_BIN" "$SCRIPT_DIR/invocation-governance.mjs" --consume'
assert.ok(runSource.indexOf(consumeAnchor) > runSource.indexOf('ROOT='))
assert.ok(runSource.indexOf(consumeAnchor) < runSource.indexOf('[[ "$(uname -s)" == "Linux" ]]'))
assert.ok(runSource.indexOf(consumeAnchor) < runSource.indexOf('NONCE='))
assert.doesNotMatch(runSource, /rm -rf[^\n]*D2_GOVERNANCE_ROOT/)
assert.throws(() => assertInvocationWiring(runSource.replace(consumeAnchor, ':')))
```

Run: `node services/api/scripts/d2-same-host/verify-invocation-governance.mjs`
Expected: wiring 缺失而 RED。

- [x] **Step 2: 在可信 PATH bootstrap 后立即 consume**

```bash
APPROVED_PATH="${D2_APPROVED_PATH:-/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin}"
# 仅用 shell builtin 验证每个绝对目录均在仓库外，再 export PATH。
export PATH="$APPROVED_PATH"
GOVERNANCE_ENV_BIN="$(command -v env 2>/dev/null || true)"
GOVERNANCE_NODE_BIN="$(command -v node 2>/dev/null || true)"

required_invocation_variables=(
  D2_GOVERNANCE_ROOT D2_TASK_ID D2_BASELINE_SHA D2_BRANCH_NAME
  D2_CLONE_PATH D2_EVIDENCE_OUT D2_ARCHIVE_PATH
)
for variable_name in "${required_invocation_variables[@]}"; do
  [[ -n "${!variable_name:-}" ]] || no_go "D2_PRIME_NO_GO_INVOCATION_INPUT"
done
[[ "$GOVERNANCE_ENV_BIN" == /* && -x "$GOVERNANCE_ENV_BIN" \
  && "$GOVERNANCE_NODE_BIN" == /* && -x "$GOVERNANCE_NODE_BIN" ]] \
  || no_go "D2_PRIME_NO_GO_INVOCATION_INPUT"
"$GOVERNANCE_ENV_BIN" -i PATH="$APPROVED_PATH" HOME="$SCRIPT_DIR" \
  D2_GOVERNANCE_ROOT="$D2_GOVERNANCE_ROOT" \
  D2_TASK_ID="$D2_TASK_ID" \
  D2_BASELINE_SHA="$D2_BASELINE_SHA" \
  D2_BRANCH_NAME="$D2_BRANCH_NAME" \
  D2_CLONE_PATH="$D2_CLONE_PATH" \
  D2_EVIDENCE_OUT="$D2_EVIDENCE_OUT" \
  D2_ARCHIVE_PATH="$D2_ARCHIVE_PATH" \
  "$GOVERNANCE_NODE_BIN" "$SCRIPT_DIR/invocation-governance.mjs" --consume \
  || exit 2
```

紧随其后保留既有 Linux/cgroup/toolchain 门禁。在 approved `git` 与 `realpath` 可用后，通过统一 helper
复核 baseline、symbolic branch、clone realpath，以及 tracked worktree/index clean；该 helper 在首次副作用前
和真正调用 `drill.mjs` 前再次执行。consume 后的任何复核失败都永久消耗 invocation，符合 fail-closed 语义。

```bash
CURRENT_BASELINE="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)" \
  || no_go "D2_PRIME_NO_GO_INVOCATION_INPUT"
[[ "$CURRENT_BASELINE" == "$D2_BASELINE_SHA" ]] \
  || no_go "D2_PRIME_NO_GO_INVOCATION_INPUT"
[[ "$(realpath "$ROOT")" == "$(realpath "$D2_CLONE_PATH")" ]] \
  || no_go "D2_PRIME_NO_GO_INVOCATION_INPUT"
```

- [x] **Step 3: 恢复 GREEN**

Run:

```bash
bash -n services/api/scripts/d2-same-host/run.sh
node services/api/scripts/d2-same-host/verify-invocation-governance.mjs
pnpm --filter @ai-job-print/api verify:d2-same-host-contract
```

Expected: 语法和两套 offline contract 通过，不执行 full drill。

### Task 4: 锁定 runbook 的 pre-clone reservation 与唯一 full-drill command

**Files:**
- Modify: `docs/device/f1-d2-same-host-dual-port-runbook.md:35-90`
- Test: `services/api/scripts/d2-same-host/verify-invocation-governance.mjs`
- Test: `services/api/scripts/d2-same-host/verify-contract.mjs`

- [x] **Step 1: 为 runbook 新增两个 marker 合同**

```js
assert.equal((runbook.match(/D2_INVOCATION_RESERVE_COMMAND_START/g) ?? []).length, 1)
assert.equal((runbook.match(/D2_INVOCATION_RESERVE_COMMAND_END/g) ?? []).length, 1)
assert.equal((runbook.match(/drill:d2-same-host/g) ?? []).length, 1)
for (const name of [
  'D2_GOVERNANCE_ROOT', 'D2_TASK_ID', 'D2_BASELINE_SHA', 'D2_BRANCH_NAME',
  'D2_CLONE_PATH', 'D2_EVIDENCE_OUT', 'D2_ARCHIVE_PATH',
]) assert.match(reserveBlock, new RegExp(`${name}=`))
```

- [x] **Step 2: 写入精确 reservation 命令**

```bash
: "${D2_GOVERNANCE_ROOT:?missing exact governance root}"
: "${D2_TASK_ID:?missing exact task id}"
: "${D2_BASELINE_SHA:?missing exact baseline}"
: "${D2_BRANCH_NAME:?missing exact branch}"
: "${D2_CLONE_PATH:?missing exact fresh clone path}"
: "${D2_EVIDENCE_OUT:?missing exact evidence path}"
: "${D2_ARCHIVE_PATH:?missing exact archive target}"
env -i \
  PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  HOME="$HOME" LANG=C.UTF-8 \
  D2_GOVERNANCE_ROOT="$D2_GOVERNANCE_ROOT" \
  D2_TASK_ID="$D2_TASK_ID" D2_BASELINE_SHA="$D2_BASELINE_SHA" \
  D2_BRANCH_NAME="$D2_BRANCH_NAME" D2_CLONE_PATH="$D2_CLONE_PATH" \
  D2_EVIDENCE_OUT="$D2_EVIDENCE_OUT" D2_ARCHIVE_PATH="$D2_ARCHIVE_PATH" \
  node services/api/scripts/d2-same-host/invocation-governance.mjs --reserve
```

该命令只做 reservation，不创建 clone、不调用 drill。唯一 full-drill block 必须传入同一组身份变量，由 `run.sh` consume。

- [x] **Step 3: 锁定永久保留与手工恢复边界**

Runbook 必须明确：

```text
reservation 或 invoked 事件一旦持久即永久消耗对应身份；普通 cleanup 不删除。
reservation.lock 残留表示临界区内发生不可证明的部分变更；当前窗口禁止删锁或重试，必须另立法证/恢复任务。
archive target 在 reserve 和 consume 时都必须不存在；archive 只在调用结束后创建。
```

- [x] **Step 4: 运行文档合同**

Run: `pnpm --filter @ai-job-print/api verify:d2-same-host-contract`
Expected: reservation block 精确唯一，full drill 字符仍精确一处，`D2_PRIME_CONTRACT_ALL_PASS`。

### Task 5: 全量验证、双模型终审与文档收口

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Modify: `.ccg/tasks/f1-d2-invocation-uniqueness-20260801/task.json`
- Create: `.ccg/tasks/f1-d2-invocation-uniqueness-20260801/review.md`

- [x] **Step 1: 串行执行门禁**

```bash
bash -n services/api/scripts/d2-same-host/run.sh
node --check services/api/scripts/d2-same-host/invocation-governance.mjs
node --check services/api/scripts/d2-same-host/verify-invocation-governance.mjs
node --check services/api/scripts/d2-same-host/verify-contract.mjs
pnpm --filter @ai-job-print/api verify:d2-same-host-contract
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api build
pnpm audit --audit-level=critical
git diff --check
wc -l services/api/scripts/d2-same-host/verify-contract.mjs
```

Expected: 全部 exit `0`；主 verifier 低于 1000 行；无 critical audit finding。不并行 lint/typecheck/build，避免 Prisma generated-directory 竞态。

- [x] **Step 2: 双模型并行终审**

Antigravity + Claude 同时审查完整 `git diff`，重点检查：全局锁崩溃语义、单赢家、追加原子性、symlink/alias、archive TOCTOU、ledger 脱敏、`run.sh` consume 时序、既有 cleanup 无回归、无 full drill 副作用。Critical 或 Warning 必须修复后重新双审。

- [x] **Step 3: 同步真实进度**

`current-progress.md` 记录 RED→GREEN、实际验证、未执行 drill/Colima/部署；`next-tasks.md` 只在双审通过后勾选 invocation 唯一性，保留 stale-PID/cleanup 和后续 fresh retake 未勾选。

- [x] **Step 4: 归档 CCG 任务并提交**

```bash
mkdir -p .ccg/tasks/archive/2026-08
mv .ccg/tasks/f1-d2-invocation-uniqueness-20260801 \
  .ccg/tasks/archive/2026-08/
git add \
  services/api/scripts/d2-same-host/invocation-governance.mjs \
  services/api/scripts/d2-same-host/verify-invocation-governance.mjs \
  services/api/scripts/d2-same-host/verify-contract.mjs \
  services/api/scripts/d2-same-host/run.sh \
  docs/device/f1-d2-same-host-dual-port-runbook.md \
  docs/progress/current-progress.md docs/progress/next-tasks.md \
  docs/superpowers/plans/2026-08-01-f1-d2-invocation-uniqueness.md \
  .ccg/tasks/archive/2026-08/f1-d2-invocation-uniqueness-20260801
git commit -m "fix: enforce D2 invocation uniqueness"
```

push / PR / merge 必须另行取得用户授权。提交完成不代表 D2′ PASS，`productionF1` 仍是 `NO-GO`。

## 自审结果

- 覆盖 task/baseline/branch/clone/evidence/archive 六个独立唯一 facet。
- 覆盖 pre-clone reservation、pre-preflight consume、并发单赢家、重放、路径别名、archive 存在、append 失败、临界区崩溃和输出脱敏。
- 每个实施步骤都给出了确定接口、断言或命令，没有未定内容。
- 不修改 stale-PID/cleanup、`drill.mjs`、evidence schema、UI、数据库或生产环境。
