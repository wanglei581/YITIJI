# F1 D2′ PM2 隔离修复计划

## 三模型结论

- Claude、Antigravity、Cursor 一致确认根因是深仓库路径下的 `PM2_HOME/pub.sock`、`rpc.sock`
  超过 Linux `AF_UNIX sun_path` 预算。
- `run.sh` 的 PM2 预检缺少硬超时；`managed-scope.mjs` 与 `drill.mjs` 都在 `ping`
  成功后才记录 daemon 已启动，无法覆盖“父 CLI 失败但 daemon 已派生”的清理路径。
- 测试应进入现有 `verify-contract.mjs` 离线入口；`contract.mjs` evidence 纯契约保持不变。
- 仅 PM2 控制面移到短路径，`HOME`、release workspace、Nginx 与 evidence 仍留在既有目录。

## 文件预算

- 新增 `services/api/scripts/d2-same-host/control-plane.mjs`：最多 120 行，只放纯路径/字节预算与
  spawn-attempt 状态机。
- 修改 `services/api/scripts/d2-same-host/verify-contract.mjs`：最多新增 80 行，承载离线 RED/GREEN。
- 修改 `services/api/scripts/d2-same-host/run.sh`：最多新增 60 行，创建和校验短控制根、所有 PM2
  调用加 timeout、精确清理控制根。
- 修改 `services/api/scripts/d2-same-host/managed-scope.mjs`：最多新增 30 行，共享路径守卫并在
  `ping` 前记录尝试。
- 修改 `services/api/scripts/d2-same-host/drill.mjs`：最多新增 20 行，共享路径守卫并覆盖 legacy
  daemon 的启动失败清理。
- 更新 `docs/progress/current-progress.md`、`docs/progress/next-tasks.md`；不修改业务代码、
  `contract.mjs`、生产配置或 runbook PASS 条件。

复审驱动的预算调整：Cursor 指出仅调用 `pm2 kill` 无法证明 daemon 已退出，因此在不新增依赖、
不扩大生产权限的前提下，将 `control-plane.mjs` 扩至 198 行、`run.sh` 本次净增 111 行、
`verify-contract.mjs` 本次净增 114 行；新增部分只用于受 UID / 精确 `PM2_HOME` / God Daemon title
约束的 PID TERM/KILL 兜底及其行为回归。五个目标脚本仍均低于 500 行，未触碰业务代码或 evidence
合同。

## TDD 顺序

1. 在 `verify-contract.mjs` 导入尚不存在的控制面 helper，并新增长 ASCII 路径、中文多字节路径、
   安全短路径、spawn-attempt 状态机、`run.sh` timeout/控制根/精确清理的离线合同；运行并保存 RED。
2. 实现 `control-plane.mjs`；Linux socket 路径按 UTF-8 字节计算，`pub.sock` / `rpc.sock` 均使用
   103 字节上限（比 Linux 107 个可用 pathname bytes 额外保留 4 字节）。
3. `run.sh` 使用 `/run/user/<uid>/d2p-<32位nonce>/{p,l,m}`；逐级校验绝对路径、owner、非 symlink、
   mode 0700 与精确 realpath。所有 PM2 预检和兜底 kill 使用 `timeout --kill-after`。
4. `managed-scope.mjs` 与 `drill.mjs` 在 `ping` 之前记录 spawn-attempt；finally 只对当前精确
   `PM2_HOME` 做有界 `pm2 kill`。外层 cleanup 先停止 managed unit，再对 p/l/m 逐个兜底清理；
   清理失败时保留控制根并退出 2，禁止广域 kill 或广域删除。
5. 运行 offline contract、shell/Node 语法检查、API typecheck/lint/build；不调用真实 PM2、Nginx、
   systemd，不运行 full drill。
6. Claude、Antigravity、Cursor 复核最终 diff；关闭 Critical/High 后更新进度并归档任务。

## 不做

- 不修改 evidence schema、productionF1、D2′ PASS 条件、生产凭据拒绝名单。
- 不重跑 Colima/full drill；修复通过不等于 D2′ PASS。
- 不新增依赖、第二 worker、cron、queue、业务入口或数据库变更。
