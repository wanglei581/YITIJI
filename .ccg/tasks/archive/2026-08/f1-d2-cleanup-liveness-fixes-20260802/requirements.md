# 需求、范围与验收

## 真实问题

`run.sh` 的 cleanup 路径仍有四处不能形成可信 PASS 的缺口：

1. Nginx PID 文件无效/缺失时跳过停止与存活证明，可能直接删除 `RUN_DIR`。
2. `bounded_pm2_kill()` 看到 PM2 状态文件消失即成功，未复核先前捕获的 daemon PID 已退出。
3. `systemd-run` 已部分创建 keeper unit 但 CLI 非零时，`KEEPER_STARTED` 尚未置位，cleanup 漏掉 unit。
4. `stop_user_unit_and_prove_inactive()` 的同步 `systemctl --user stop` 没有脚本级 timeout。

## 功能归位与文件预算

- 后端发布脚本：`services/api/scripts/d2-same-host/run.sh`。
- 演练生命周期：`services/api/scripts/d2-same-host/drill.mjs`。仅允许新增 Nginx 启动尝试标记与
  独立身份记录；保留现有 best-effort `quit`，最终存活证明仍由外层 cleanup 负责。
- 离线合同：优先只修改 `verify-cleanup-contract.mjs`；如现有总合同必须补静态接线，才允许修改
  `verify-contract.mjs`。
- 文档：`docs/progress/current-progress.md`、`docs/progress/next-tasks.md`；只有执行口径实际变化时
  才允许最小更新 D2 runbook。
- 任务审计：本目录，完成后归档到 `.ccg/tasks/archive/2026-08/`。
- 预计 production 文件不超过 2 个、测试文件不超过 2 个、正式文档不超过 3 个。

## 已审方案

- systemd stop：以 `timeout` 约束同步客户端调用；无论 stop 返回什么，仍以有限轮询得到的
  `LoadState` / `ActiveState` 明确元组作为唯一成功依据。
- PM2：一旦捕获 daemon PID，状态文件消失只能结束状态轮询，不能绕过 PID 存活复验与现有
  `control-plane.mjs` 严格身份终止路径。
- keeper：在 `systemd-run` 前悲观置位启动尝试状态；未创建 unit 时既有
  `not-found + inactive` 元组仍安全成功。
- Nginx：`drill.mjs` 在启动调用前写独占 attempt marker，确认 PID 后写独占、持久身份记录
  （PID + `/proc` start-time）；`run.sh` 仅在当前 PID 的 uid、可执行文件和 start-time 全部匹配时
  发送 TERM，并有限等待。未尝试启动可跳过；已尝试但身份缺失/损坏、身份漂移或超时均失败关闭并
  保留取证目录。

## 明确不涉及

- 不修改前端、Terminal Agent、数据库、Redis、对象存储、依赖或 lockfile。
- 不运行 `run.sh`、reserve/invoke/full drill、Colima、systemd、PM2、Nginx 或 API 服务。
- 不连接生产、不部署、不生成 nonce/evidence、不进入 D3–D6。
- 修复代码和离线合同不等于 D2′ PASS，不授权 fresh retake；`productionF1` 保持 `NO-GO`。

## TDD 验收

- 四个缺口分别有先红后绿的行为/Mutation 合同，删除任一守卫必须使测试失败。
- 正常 cleanup、已回收 unit、读取失败、timeout、partial-start、PID 身份漂移等既有边界不回退。
- `bash -n`、Node 语法、D2 cleanup/总合同、governance gate、API lint/typecheck/build、
  `git diff --check` 全部通过。
- Claude 与 Antigravity 对分析和最终 diff 均给出 Critical/Warning 0；Cursor 参与交叉验证。
