# 多模型自主 Loop 审计与收口要求

- 目标：只处理上线前可本地验证、可回滚的工程门禁，不新增业务功能。
- 允许修改：`.github/workflows/ci.yml`、`docs/progress/current-progress.md`、`docs/progress/next-tasks.md`、本任务计划与归档记录。
- 禁止修改：业务源码、Prisma schema/migration、产品入口、Terminal Agent、生产配置、密钥与部署资源。
- 用户原工作区的未提交文档改动属于受保护资产；实施仅在 `origin/main@b1d681f7` 的隔离 worktree 中进行。
- CI 中所有共享 SQLite verify 保持逐行串行，禁止并行。
- live、真实外部服务、生产写入、Windows/打印扫描真机、法务和密钥轮换不得纳入自主 Loop。
- 完成标准：新增守卫在临时 SQLite 中通过；数据库相关守卫进入 PostgreSQL readiness；typecheck、lint、安全门禁、PG schema drift 与 YAML/静态覆盖检查通过；三模型复审无 Critical/High。
