# F1 D2′ Fresh Retake Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `executing-plans`;本任务由主执行者串行完成，不并行触碰同一 Colima 环境。

**Goal:** 在授权窗口内，对 `main@5b251e5f` 执行唯一一次非生产 D2′ full drill，形成可独立验证的 PASS 或永久锁定的 NO-GO 证据。

**Architecture:** macOS 仅编排与留痕；Linux 演练在既有 Colima guest 的全新 detached clone 中进行。fresh install/build/offline contract 与 pre-nonce 门禁必须先通过；full drill 仅调用一次，由脚本生成 nonce；随后独立验证 evidence、审计 cleanup 并停止 Colima。

**Tech Stack:** Git、Colima Ubuntu、systemd user manager、cgroup v2、PM2、Nginx、Node.js 22、pnpm、Bash、JSON evidence contract。

---

### Task 1：固定授权与 pre-start 审查

- [x] 固定 commit、环境、clone、evidence、窗口、一次调用上限与永久边界。
- [x] Antigravity 与 Claude 只读审查当前 `origin/main` 脚本、runbook、授权包和硬停止条件；双方均为条件式 `PRE-START GO`，Critical 0。
- [x] 确认当前时间在授权窗口内、PR/main CI 全绿且执行基线未漂移。

### Task 2：启动既有环境并创建 fresh clone

- [x] 只启动既有 `default` Colima，不创建 profile/VM。
- [x] 确认 clone 与 evidence 精确路径均不存在，可信父目录 owner/mode/realpath 合格。
- [x] 从 `origin/main` 创建 mode `0700` detached fresh clone，HEAD 与 remote SHA 精确一致、工作树干净、无真实 `.env`。

### Task 3：fresh build 与 pre-nonce 硬门禁

- [x] `pnpm install --frozen-lockfile`、API build、offline contract 和 Bash/Node 语法通过。
- [x] Linux/XDG/user-systemd/Linger/cgroup v2、工具版本与资源 controller 门禁通过。
- [x] production denylist 命中为 0；`3010/3011/18080`、D2 unit/process/runtime 均为空。
- [x] evidence 不存在，full-drill 调用计数为 0，仍在授权窗口；最终 gate `2026-08-01T00:58:41+08:00` 为 0 failures。

### Task 4：唯一一次 full drill 与独立 verifier

- [x] 使用精确 `D2_EVIDENCE_DIR` / `D2_EVIDENCE_OUT` 发起一次 `pnpm --filter @ai-job-print/api drill:d2-same-host`；同时误把 clone 路径传给实际覆盖 executable `PATH` 的 `D2_APPROVED_PATH`。
- [x] 唯一调用返回 `D2_PRIME_NO_GO_ENVIRONMENT` / 内部 exit `2`；调用计数锁定为 1，本窗口不第二次调用。
- [x] 独立运行 `verify-contract.mjs --evidence <exact-path>`；offline contract 全绿，因 evidence 未生成而返回 `D2_PRIME_EVIDENCE_REJECTED` / 内部 exit `2`，无文件 SHA-256。

### Task 5：cleanup 与结果闭环

- [x] 只读审计端口、unit、PM2/Nginx、runtime、socket/pidfile、`.work` 残留，全部为 0。
- [x] 停止既有 Colima，确认 stopped。
- [x] 双模型只读复核执行证据与 PASS/NO-GO 结论；Antigravity `APPROVE`、Claude `FINAL REVIEW: GO`，均为 Critical 0。
- [x] 更新正式 progress 文档；明确 operator invocation root cause、PRE-NONCE NO-GO 与不可重跑边界。
- [x] 完成 CCG review 并归档；不扩大为 production 或 D3–D6 授权。

## 硬停止条件

1. 授权未生效、过期或任一固定字段不精确。
2. 需要新增 profile/VM、连接 production、SSH 或生产凭据。
3. clone/evidence 已存在，或父目录 owner/mode/realpath 不可信。
4. SHA、工作树、真实 `.env`、frozen install/build/offline contract 任一失败。
5. Linux/XDG/user-systemd/Linger/cgroup、工具、端口、production denylist 或 cleanup preflight 任一失败。
6. full drill 已调用一次；本窗口内无论结果均不得第二次调用。
7. full drill 非零、任何 NO-GO、evidence 非法/缺失或 cleanup 残留均锁定本轮 NO-GO。

执行后审计附注：原始“不 SSH”硬停止条件保持不变；guest 命令实际使用本机 `colima ssh` transport，相关执行时解释与潜在授权边界偏差见同目录 `requirements.md` 和 `review.md`。
