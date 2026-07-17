# 范围与验收

## 目标

把已批准的平行 Genesis bootstrap 规格转为一个仅限本地代码与离线测试的精确实施计划。

## 允许的计划范围

- future-only release provenance TypeScript 模块、离线 verify、API package script 和 progress 文档的预期改动。
- 只为计划写入 `docs/superpowers/plans/2026-07-16-f1-parallel-genesis-bootstrap-implementation.md` 并更新两份 progress SSOT。

## 禁止的计划范围

- 任何生产 SSH、PM2/Nginx/LB/环境/凭据/数据库/迁移/Agent/Kiosk/打印操作。
- 历史 F1 回填、legacy 作为 previous/rollback、或手工路径/PM2 绕过。
- Genesis 直接承载业务流量或取代已有稳态 activation。

## 验收

- 计划含精确文件、类型、函数、测试场景、命令和预期结果，遵循 RED→GREEN。
- Genesis 只允许平行零流量链，必须拒绝重入/legacy/previous/状态残留，失败只清理自建资源。
- `r1 → r2` 明确复用既有 `activateRelease`。
- 计划把镜像 rollback 演练列为 D5 traffic cutover 的硬前置；不包含生产执行命令。
- Claude 与 Antigravity 终审无 Critical 或未关闭 Warning。
