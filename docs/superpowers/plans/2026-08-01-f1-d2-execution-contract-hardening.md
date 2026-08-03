# F1 D2′ Execution Contract Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 D2′ fresh-retake 入口在 nonce 前拒绝 clone 路径误注入、输出可定位的固定错误码，并以唯一 canonical command 显式绑定 evidence 目录与文件。

**Architecture:** `run.sh` 继续是唯一 full-drill 入口，不新增执行器或环境变量。`verify-contract.mjs` 在既有 offline contract 中静态校验入口代码、错误码闭集、runbook canonical command 和 mutation；runbook 只承载一个由标记围栏固定的 full-drill 命令模板。

**Tech Stack:** Bash、Node.js ESM、`node:assert/strict`、源码 mutation、Markdown runbook、pnpm。

---

## 文件结构与预算

- Modify: `services/api/scripts/d2-same-host/verify-contract.mjs` — 新增约 80 行入口合同与 mutation；总行数不得超过 1000。
- Modify: `services/api/scripts/d2-same-host/run.sh` — 收紧 approved PATH，拆分 pre-nonce 错误码；不改变 nonce 后演练算法。
- Modify: `docs/device/f1-d2-same-host-dual-port-runbook.md` — 唯一 canonical command 与变量语义。
- Modify after GREEN: `docs/progress/current-progress.md`、`docs/progress/next-tasks.md` — 只记录实际结果与下一授权边界。
- Do not modify: `services/api/package.json`、evidence schema、`drill.mjs`、其他 apps/services/packages。

### Task 1: Offline entry contract RED

**Files:**
- Modify: `services/api/scripts/d2-same-host/verify-contract.mjs`
- Test: `services/api/scripts/d2-same-host/verify-contract.mjs`

- [x] **Step 1: 写当前 main 必然失败的入口合同**

新增 `assertExecutionEntryContract(runSource, runbookSource)`，要求：

```js
const shellSource = runSource.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n')
const approvedPathGuard = '[[ "$path_part" != "$ROOT" && "$path_part" != "$ROOT/"* ]]'
assert.ok(shellSource.includes(approvedPathGuard))
assert.doesNotMatch(shellSource, /D2_PRIME_NO_GO_ENVIRONMENT/)
assert.match(shellSource, /command -v "\$required_command"[^\n]+D2_PRIME_NO_GO_APPROVED_PATH_COMMAND/)
```

函数同时提取全部 `no_go "CODE"` 调用，断言实参都是裸固定字面量、没有 `$`，且属于计划内闭集；从 runbook 的 `D2_FRESH_RETAKE_COMMAND_START/END` 标记中提取唯一代码块，与 `FRESH_RETAKE_COMMAND` 常量逐字匹配。

- [x] **Step 2: 加入最小 mutation 矩阵**

```js
assert.throws(() => assertExecutionEntryContract(runSource.replace(approvedPathGuard, ':'), runbookSource))
assert.throws(() => assertExecutionEntryContract(runSource.replace('command -v "$required_command"', ':'), runbookSource))
assert.throws(() => assertExecutionEntryContract(runSource.replace('D2_PRIME_NO_GO_APPROVED_PATH_COMMAND', 'D2_PRIME_NO_GO_ENVIRONMENT'), runbookSource))
assert.throws(() => assertExecutionEntryContract(`# ${approvedPathGuard}\n${runSource.replace(approvedPathGuard, ':')}`, runbookSource))
assert.throws(() => assertExecutionEntryContract(runSource, runbookSource.replace('D2_EVIDENCE_DIR=', 'D2_EVIDENCE_DIRECTORY=')))
```

- [x] **Step 3: 在 `main()` 接入并运行 RED**

Run:

```bash
pnpm --filter @ai-job-print/api verify:d2-same-host-contract
```

Expected: exit `2`，固定输出 `D2_PRIME_EXECUTION_ENTRY_CONTRACT_INVALID`；失败原因是 current main 缺少 repo-root guard、仍含通用 `_ENVIRONMENT` 且 runbook 没有 canonical block。

### Task 2: Minimal run.sh GREEN

**Files:**
- Modify: `services/api/scripts/d2-same-host/run.sh`
- Test: `services/api/scripts/d2-same-host/verify-contract.mjs`

- [x] **Step 1: 收紧 approved PATH**

格式和仓库边界失败统一使用固定码：

```bash
[[ ${#approved_path_parts[@]} -gt 0 ]] || no_go "D2_PRIME_NO_GO_APPROVED_PATH"
for path_part in "${approved_path_parts[@]}"; do
  [[ "$path_part" == /* && "$path_part" != *$'\n'* && "$path_part" != *"/../"* ]] \
    || no_go "D2_PRIME_NO_GO_APPROVED_PATH"
  [[ "$path_part" != "$ROOT" && "$path_part" != "$ROOT/"* ]] \
    || no_go "D2_PRIME_NO_GO_APPROVED_PATH"
done
```

- [x] **Step 2: 拆分原通用环境错误码**

按固定失败簇替换：

```text
D2_PRIME_NO_GO_KERNEL
D2_PRIME_NO_GO_APPROVED_PATH_COMMAND
D2_PRIME_NO_GO_TOOLCHAIN
D2_PRIME_NO_GO_RUNTIME_DIR
D2_PRIME_NO_GO_USER_MANAGER
D2_PRIME_NO_GO_CGROUP_DELEGATION
D2_PRIME_NO_GO_PM2_PREFLIGHT
```

所有错误只输出固定码，不拼接命令名、路径或环境值。

- [x] **Step 3: 运行 Bash 语法与合同，确认仍因 runbook 缺模板而 RED**

```bash
bash -n services/api/scripts/d2-same-host/run.sh
pnpm --filter @ai-job-print/api verify:d2-same-host-contract
```

Expected: Bash exit `0`；合同仍 exit `2`，且只剩 canonical runbook mismatch。

### Task 3: Canonical command GREEN

**Files:**
- Modify: `docs/device/f1-d2-same-host-dual-port-runbook.md`
- Test: `services/api/scripts/d2-same-host/verify-contract.mjs`

- [x] **Step 1: 明确变量语义**

写明 `D2_APPROVED_PATH` 是冒号分隔的 executable PATH，只能指向仓库外二进制目录；不能传 fresh clone/repository path，也不会自动回退。

- [x] **Step 2: 只保留一个标记后的 canonical full-drill block**

```bash
: "${D2_EVIDENCE_DIR:?missing exact authorized evidence directory}"
: "${D2_EVIDENCE_OUT:?missing exact authorized evidence path}"
env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  LANG=C.UTF-8 \
  D2_APPROVED_PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  D2_EVIDENCE_DIR="$D2_EVIDENCE_DIR" \
  D2_EVIDENCE_OUT="$D2_EVIDENCE_OUT" \
  pnpm --filter @ai-job-print/api drill:d2-same-host
```

该 block 前后使用唯一 `D2_FRESH_RETAKE_COMMAND_START/END` 标记；独立 verifier 只读取 `$D2_EVIDENCE_OUT`，不得再出现第二个 full-drill 示例。

- [x] **Step 3: 运行 GREEN**

```bash
pnpm --filter @ai-job-print/api verify:d2-same-host-contract
```

Expected: exit `0`，新增 `PASS D2 fresh-retake entry rejects repository PATH and locks one canonical command`，末行 `D2_PRIME_CONTRACT_ALL_PASS`。

### Task 4: Refactor and full offline verification

**Files:**
- Modify if necessary: the same three functional files only

- [x] **Step 1: 检查 verifier 行数与占位符**

```bash
wc -l services/api/scripts/d2-same-host/verify-contract.mjs
rg -n 'D2_PRIME_NO_GO_ENVIRONMENT' \
  services/api/scripts/d2-same-host/run.sh \
  services/api/scripts/d2-same-host/verify-contract.mjs \
  docs/device/f1-d2-same-host-dual-port-runbook.md
```

Expected: verifier `<=1000`；无计划占位符；`run.sh` 不再包含通用 `_ENVIRONMENT`。

- [x] **Step 2: 全套纯离线验证**

```bash
bash -n services/api/scripts/d2-same-host/run.sh
node --check services/api/scripts/d2-same-host/verify-contract.mjs
pnpm --filter @ai-job-print/api verify:d2-same-host-contract
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api build
git diff --check
```

Expected: 全部 exit `0`；不执行 `drill:d2-same-host`。

### Task 5: Documentation, dual review, and archive

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Modify: `.ccg/tasks/f1-d2-execution-contract-hardening-20260801/*`

- [x] **Step 1: 同步正式进度**

记录 RED→GREEN、固定错误码、canonical command、验证结果和边界；明确代码修复不等于 D2′ PASS，后续 retake 仍须新 baseline/path/window 且必须单独明确本机 `colima ssh` transport 是否允许。

- [x] **Step 2: 双模型并行终审**

Antigravity + Claude 审查完整 diff、mutation、错误码泄漏、模板唯一性、无 drill/Colima 边界。Critical 必须为 0；Critical 修复后重新双审。

- [x] **Step 3: 完成 CCG review、归档并本地提交**

归档到 `.ccg/tasks/archive/2026-08/f1-d2-execution-contract-hardening-20260801/`，精确 stage，使用 conventional commit；push/PR/merge 另等用户授权。
