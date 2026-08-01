# F1 D2′ 执行包合同收紧需求

## 目标

修复 `main@5b251e5f` fresh retake 暴露的执行入口歧义：`D2_APPROVED_PATH` 只能表示 executable `PATH`，不能接受仓库/clone 路径；canonical fresh-retake 命令必须显式传入 evidence 目录和文件；pre-nonce 失败必须用固定、可定位且不泄密的错误码。

## 功能归位与文件预算

- 后端运维脚本：`services/api/scripts/d2-same-host/run.sh`。
- 离线合同：`services/api/scripts/d2-same-host/verify-contract.mjs`。
- 设备 runbook：`docs/device/f1-d2-same-host-dual-port-runbook.md`。
- 正式计划/进度：`docs/superpowers/plans/2026-08-01-f1-d2-execution-contract-hardening.md`、`docs/progress/current-progress.md`、`docs/progress/next-tasks.md`。
- 不涉及 Kiosk/Admin/Partner、worker、Terminal Agent、共享包、数据库、API schema 或 UI。

## 硬边界

- 不启动或连接 Colima，不执行 `drill:d2-same-host`，不生成 nonce/evidence。
- 不连接 production、不 SSH、不部署、不切流、不进入 D3–D6。
- 不新增依赖、执行器、npm script、环境变量或 evidence schema 字段。
- 不修改 `apps/`、其他 `services/`、`packages/`、`legacy-miaoda/`。

## 验收

- 严格 RED→GREEN：先让当前 main 因缺少新合同而失败，再做最小实现。
- mutation 覆盖 clone 路径守卫缺失、required-command 检查失效、错误码坍缩/闭集漂移、注释诱饵和 canonical command 漂移。
- `verify:d2-same-host-contract`、Bash/Node 语法、API lint/typecheck/build、`git diff --check` 全绿。
- Antigravity + Claude 终审 Critical 为 0。
