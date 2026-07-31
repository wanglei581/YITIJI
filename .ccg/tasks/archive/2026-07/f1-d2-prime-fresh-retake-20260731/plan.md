# F1 D2′ Fresh Retake Execution Plan

> **For agentic workers:** 本任务是高风险、一次性运维演练，必须由主执行者按验证循环串行完成；不得并行触碰同一 Colima 环境，不得委托未经上下文隔离的执行代理。

**Goal:** 基于 `origin/main@06c7fe00357533fbcd91928a3abf2ed8c2933dec`，在本机现有非生产 Colima 中完成一次新的 D2′ full drill，并形成可独立验证的 PASS 或锁定的 NO-GO 证据。

**Architecture:** macOS 工作区只负责编排、离线门禁和文档留痕；Linux 演练在既有 Colima guest 的全新 detached clone 中执行。`run.sh` 自行生成一次性 32 位十六进制 nonce，创建隔离 PM2/systemd/Nginx 资源，`drill.mjs` 生成脱敏 evidence，`verify-contract.mjs` 独立复算；任何失败均停止且本窗口不重跑。

**Tech Stack:** Git worktree、Colima Ubuntu Linux、systemd user manager、cgroup v2、PM2、Nginx、Node.js 22、pnpm、Bash、JSON evidence contract。

---

## 文件预算

- 创建/修改：`.ccg/tasks/f1-d2-prime-fresh-retake-20260731/{task.json,requirements.md,plan.md,review.md}`。
- 结果后修改：`docs/progress/current-progress.md`、`docs/progress/next-tasks.md`。
- 只读：`docs/device/f1-d2-same-host-dual-port-runbook.md`、`services/api/scripts/d2-same-host/**`。
- 禁止修改：应用代码、数据库 schema/migration、生产配置、Windows Agent、Kiosk/Admin/Partner、密钥与远端服务器文件。

### Task 1: 固定干净基线并完成离线门禁

- [x] **Step 1:** 确认 PR #448 已合入，`origin/main` 为 `06c7fe00357533fbcd91928a3abf2ed8c2933dec`。
- [x] **Step 2:** 从该 SHA 创建隔离分支 `codex/f1-d2-prime-fresh-retake-20260731` 和专用 worktree。
- [x] **Step 3:** 执行 `pnpm install --frozen-lockfile`。
- [x] **Step 4:** 执行 Bash/Node 语法、`verify:d2-same-host-contract`、API lint/typecheck/build。
- [x] **Step 5:** 确认除本任务记录外没有代码差异，离线门禁输出包含 `D2_PRIME_CONTRACT_ALL_PASS`。

### Task 2: 多模型只读方案审查

- [x] **Step 1:** Claude 审查 runbook、`run.sh`、`drill.mjs`、`verify-contract.mjs`，结论为 `GO for preparing authorization packet`。
- [x] **Step 2:** Antigravity 同范围审查，结论为准备授权包 GO、立即执行 NO-GO。
- [x] **Step 3:** Cursor CLI 空输出后按用户既有授权改用 Cursor 客户端；客户端确认基线干净，并要求新窗口/新 evidence/脚本生成的新 nonce。
- [x] **Step 4:** 将三方意见去重写入 `review.md`；只采纳与正式 runbook/脚本一致的门禁。

### Task 3: 只读检查既有 Colima 状态

- [x] **Step 1:** 在 macOS 执行 `colima status`；结果为 `colima is not running`，没有自动创建新 profile 或新虚拟机。
- [x] **Step 2:** 因既有 Colima 未运行，本步骤按规则跳过；未连接 guest。
- [x] **Step 3:** 已记录 `stopped`，未在授权前启动。
- [x] **Step 4:** 授权后启动既有 Colima；生产凭据变量、旧 D2 残留、目标路径、端口和 runtime 门禁均在生成 nonce 前通过。

### Task 4: 提交并等待一次性执行授权

- [x] **Step 1:** 向用户提交以下精确授权包：
  - 环境：本机现有非生产 Colima；不新增云主机/虚拟机，不连接 production。
  - commit：`06c7fe00357533fbcd91928a3abf2ed8c2933dec`。
  - guest fresh clone：`/var/lib/ai-job-print-d2-prime-retake-20260731-06c7fe00`。
  - evidence：`/var/lib/ai-job-print-d2-prime-retake-20260731-06c7fe00/services/api/scripts/d2-same-host/.evidence/d2-prime-evidence-20260731T022000Z.json`。
  - 窗口：`2026-07-31T10:20:00+08:00` 至 `2026-07-31T11:50:00+08:00`。
  - nonce：由 `run.sh:156` 在唯一一次 full drill 中从 `/proc/sys/kernel/random/uuid` 自动生成全新 32-hex；无法也不得预先复用或人工注入。
  - 调用上限：`drill:d2-same-host` 精确一次；失败后本窗口不重跑。
  - 永久边界：`productionF1=NO-GO`，D3–D6 禁止。
- [x] **Step 2:** 已收到原授权包及路径修正包的明确授权；修正后的精确 guest clone 为 `/var/lib/d2-prime-prep/fresh-retake-20260731-06c7fe00`，evidence 为其下 `services/api/scripts/d2-same-host/.evidence/d2-prime-evidence-20260731T022000Z.json`，其余 SHA、窗口、一次调用上限与永久边界不变。
- [x] **Step 3:** 在 `2026-07-31T10:20:00+08:00` 至 `2026-07-31T11:50:00+08:00` 授权窗口内执行；窗口未过期。

### Task 5: 授权后准备 fresh Linux clone

- [x] **Step 1:** 仅在授权窗口内启动既有 `default` Colima profile，没有创建第二 profile 或新虚拟机。
- [x] **Step 2:** 原授权目标 `/var/lib/ai-job-print-d2-prime-retake-20260731-06c7fe00` 因 `/var/lib` 为 root:root 0755 而在创建前 fail-closed；目标保持不存在。用户修正授权后，已在既有可信可写根下创建 `/var/lib/d2-prime-prep/fresh-retake-20260731-06c7fe00` fresh clone，并 detached checkout 精确 SHA。
- [x] **Step 3:** `HEAD` 与 `origin/main` 均精确为 `06c7fe00357533fbcd91928a3abf2ed8c2933dec`，工作树干净、无真实 `.env`，clone mode 0700。
- [x] **Step 4:** `pnpm install --frozen-lockfile`、API fresh build和 offline contract 均通过，输出 `D2_PRIME_CONTRACT_ALL_PASS`。
- [x] **Step 5:** 环境、XDG、systemd/cgroup、端口、production denylist、evidence/work 路径门禁全部通过；最终 pre-nonce gate 确认 full drill 计数为 0。

### Task 6: 唯一一次 full drill 与独立验证

- [x] **Step 1:** 已确认处于授权窗口、目标 evidence 文件不存在、full drill 计数为 0。
- [x] **Step 2:** 只调用一次：

```bash
D2_EVIDENCE_OUT="/var/lib/d2-prime-prep/fresh-retake-20260731-06c7fe00/services/api/scripts/d2-same-host/.evidence/d2-prime-evidence-20260731T022000Z.json" \
  pnpm --filter @ai-job-print/api drill:d2-same-host
```

- [x] **Step 3:** 唯一 full drill 输出 latency 后返回 `D2_PRIME_NO_GO D2_PRIME_DRILL_FAILED`、`D2_PRIME_NO_GO D2_PRIME_RUNTIME_FAILURE`，exit `2`；证据未修改或覆盖，本窗口不再调用。
- [x] **Step 4:** 执行一次独立 verifier：

```bash
node services/api/scripts/d2-same-host/verify-contract.mjs \
  --evidence "/var/lib/d2-prime-prep/fresh-retake-20260731-06c7fe00/services/api/scripts/d2-same-host/.evidence/d2-prime-evidence-20260731T022000Z.json"
```

- [x] **Step 5:** verifier 输出 `D2_PRIME_EVIDENCE_NO_GO`、`evidenceVerdict=D2_PRIME_NO_GO`、`productionF1=NO-GO` 并 exit `2`；evidence SHA-256 为 `9ec390733185016981ddc46a03dcf0893e224e8fd21ba39329afdf7c2488f7b3`，本轮已锁定 NO-GO。

### Task 7: 清理验证、结论与闭环

- [x] **Step 1:** 只读确认 `3010/3011/18080`、D2/preflight units、nonce PM2/Nginx 进程、socket/pidfile、runtime root 和 `.work` 残留均为 0；evidence 保留。
- [x] **Step 2:** 没有演练残留需要人工清理；既有 Colima 已停止。预检误触发的默认 PM2 daemon 已在 full drill 前用精确 `PM2_HOME` 有界停止并验证为 0，没有宽泛 kill/glob 或目录删除。
- [x] **Step 3:** Claude、Antigravity、Cursor/Codex 已只读审查执行证据和结论；已剔除 Cursor 对 evidence absent / 人工 nonce 的误读，并把可证明的代码诊断缺口记录到 `review.md`。
- [x] **Step 4:** 已同步 `docs/progress/current-progress.md` 与 `docs/progress/next-tasks.md`，明确 `productionF1=NO-GO`、nonce 由脚本自动生成、下一步须另立诊断合同任务。
- [x] **Step 5:** 文档/diff 门禁与 offline contract 通过；提交 `9934a210` 已推送并创建 PR #450，合并仍需用户独立授权。
- [x] **Step 6:** 任务记录已完成，随本次收口迁移到 `.ccg/tasks/archive/2026-07/`。

## 硬停止条件

1. 授权缺字段、尚未生效或已过期。
2. Colima 不是既有非生产 profile，或需要新增主机/虚拟机。
3. SHA/工作树/fresh clone/evidence 路径不精确。
4. 发现生产凭据、数据库/Redis/对象存储连接、migration/DDL/seed 或第二 worker/cron/consumer 风险。
5. Linux、XDG、user systemd、Linger、cgroup v2、资源 limits、必要工具或端口任一门禁失败。
6. full drill 返回非 0、任何 `D2_PRIME_NO_GO_*`、evidence 缺失/不合法或 cleanup 残留。
7. full drill 已调用一次；本窗口内无论结果均不得第二次调用。
