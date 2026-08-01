# F1 D2 task / invocation 唯一性治理

## 目标

在不执行 full drill 的前提下，为 D2 fresh-retake 建立可离线验证的单次调用治理：全新 task ID、branch、clone、evidence 与 invocation audit；baseline/path 原子预留；追加式 ledger 阻止并发复用或第二次调用；archive 目标存在时 fail closed。协议分两阶段：clone 创建前在稳定的仓库外 governance root 执行 `reserve`；clone 内的 `run.sh` 在现有 kernel/toolchain/preflight 之前执行 `consume`。

## 功能归位与范围

- 业务闭环：F1 D2′ 非生产 fresh-retake 执行治理。
- 后端：`services/api/scripts/d2-same-host/` 的执行入口、离线合同与必要的窄模块。
- 文档：D2 runbook、`docs/progress/current-progress.md`、`docs/progress/next-tasks.md`。
- 明确不涉及：Kiosk/Admin/Partner UI、Terminal Agent、`packages/*`、Prisma/数据库、业务 API、打印/扫描硬件。
- 复用确认：复用现有 `run.sh`、`verify-contract.mjs`、canonical runbook 和固定 NO-GO 语义；不新建第二套演练入口。

## 允许修改

- `services/api/scripts/d2-same-host/run.sh`
- `services/api/scripts/d2-same-host/verify-contract.mjs`
- `services/api/scripts/d2-same-host/invocation-governance.mjs`
- `services/api/scripts/d2-same-host/verify-invocation-governance.mjs`
- `docs/device/f1-d2-same-host-dual-port-runbook.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/f1-d2-invocation-uniqueness-20260801/`

## 禁止事项

- 不启动 Colima、systemd、PM2、Nginx 或 API。
- 不执行 `drill:d2-same-host`，不生成 nonce/evidence。
- 不连接 production，不 SSH，不部署，不进入 D3–D6。
- 不处理 stale-PID/cleanup，不从已关闭 PR #449 复制代码。
- 不删除已有分支、worktree、ledger、archive 或法证资产。

## 验收口径

1. RED 用例证明当前入口不能防止同 baseline/clone/evidence 重放、并发预留与 archive 覆盖。
2. GREEN 实现全局短临界区下的单个赢家原子预留，无论演练成败都保留不可复用的 reservation，并追加脱敏 `RESERVED` / `INVOKED` ledger 事件。
3. governance root 必须在仓库外、owner-only `0700`；ledger/reservation 必须为 owner-only 且不被任何 cleanup trap 删除。临界区内崩溃保留 busy tombstone，不在同一 retake 中自动恢复。
4. 输出只含固定错误码，不泄露 path、task ID、branch、SHA、nonce 或环境值。
5. 既有 offline contract、Shell/Node 语法、API lint/typecheck/build 及差异门禁通过。
6. Antigravity + Claude 分析与终审均完成；Critical/Warning 清零或有明确处置。
