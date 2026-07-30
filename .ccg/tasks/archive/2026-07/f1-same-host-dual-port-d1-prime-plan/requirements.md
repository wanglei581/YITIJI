# F1 同机双端口 D1′/D2′ 实施计划要求

## 目标

基于用户已批准的 `2026-07-30-f1-same-host-dual-port-managed-topology-design.md`，编写一份可以由后续执行者逐任务实施的计划：D1′ 关闭代码/fixture/CI/runbook/D3 SSOT 的 `3010 → 3011` 拓扑修订；D2′ 在非生产环境证明同机双端口、独立 `PM2_HOME`、Nginx 全切或不切、资源争用和 managed-only rollback。

## 包含

- future-only health URL 继续精确全等，但唯一允许值改为 `http://127.0.0.1:3011/api/v1/health`。
- RED→GREEN 正负例、Genesis/activation 双路径、SSRF fail-closed、legacy spy 零调用。
- runbook、D3 B1–B9、审批包引用和 progress SSOT 一致性修订。
- D2′ 非生产同机演练、Nginx 校验失败/全切或不切、独立 PM2_HOME/目录/日志、资源与数据副作用证据。
- Claude、Antigravity、Cursor 与 Codex 交叉审查。

## 排除

- D3 production SSH、D4 Genesis、D5 Nginx 切流、D6 activation。
- 生产 PM2/Nginx/账户/目录/防火墙/数据库/Redis/对象存储修改。
- migration、DDL、seed、第二套 worker/cron/consumer。
- legacy 退役、fallback 或 provenance 回填。

## 计划文件预算

- `docs/superpowers/plans/2026-07-30-f1-same-host-dual-port-d1-prime-implementation.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/f1-same-host-dual-port-d1-prime-plan/**`

本任务只写计划，不实施计划中的代码或演练。
