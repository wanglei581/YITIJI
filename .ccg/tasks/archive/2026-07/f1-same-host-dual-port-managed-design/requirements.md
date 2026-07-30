# F1 同机双端口 managed 发布拓扑设计要求

## 目标

在只有一台 production Linux 服务器、没有 production Docker、不得新增云主机的约束下，正式定义 legacy API `127.0.0.1:3010` 与 future-only managed API `127.0.0.1:3011` 的同机隔离拓扑，作为后续 D1′ 本地实现计划的设计输入。

## 用户已确认的关键决策

- 不新增服务器，不把同机方案表述为 HA 或容灾。
- legacy 与 managed 共用既有 PostgreSQL、Redis 和对象存储，但 D4/D5 不执行 migration、DDL 或 seed。
- 两套链隔离 Linux 账户、`PM2_HOME`、PM2 名称、日志、release/artifact/current/control/launcher/runtime-contract 路径。
- D5 前 Nginx 100% 保持 legacy；D5 只允许原子完成切换或完整保持 legacy。
- future-only Genesis/activation 只管理 managed 链，health URL 只接受精确 `http://127.0.0.1:3011/api/v1/health`，不得保留 3010 白名单或开放动态 URL。
- `CUTOVER_CONFIRMED` 后只允许回到 verified managed previous；legacy 退役另行授权。
- runtime environment contract 只记录变量名称与用途，不记录变量值。

## 文件预算

允许修改：

- `docs/superpowers/specs/2026-07-30-f1-same-host-dual-port-managed-topology-design.md`
- `docs/superpowers/specs/2026-07-16-f1-parallel-genesis-bootstrap-design.md`（仅增加修订索引）
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/f1-same-host-dual-port-managed-design/**`

禁止修改：

- `services/`、`apps/`、`packages/`、数据库 schema/migration、CI、生产配置和凭据。
- 现有 runbook 的可执行模板与 D3 输入值；这些属于用户审阅设计后才编写的 D1′ 实施计划范围。
- legacy 运行目录、PM2、Nginx、生产 PostgreSQL、Redis、对象存储或任何线上状态。

## 验证

- 设计前基线：API typecheck、release-provenance fixture、Genesis fixture。
- 文档完成后：`pnpm exec prettier --check`（范围文件）、`git diff --check`、链接/术语只读检查。
- Claude、Antigravity、Cursor 只读交叉审查；Critical/High 必须关闭。

## 不代表

设计文档完成不代表 D1′ 已实现、D2′ 已演练、D3 已重新授权、D4 Genesis 已运行、D5 已切流、D6 已开放或 production F1 已解除 NO-GO。
