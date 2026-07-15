# F1 管理员凭据加固同步最新主线

## 范围

- 在当前独立工作树中，从 `origin/main@faa82612` 新建本地同步分支。
- 选择性重放本地候选 `ddff6c07` 的管理员首次手机号绑定原子审计和改密 verify 目标守卫；不得整体 rebase 或 cherry-pick 旧分支。
- 不触碰 Prisma schema/migration、Agent、Kiosk、打印、支付、生产配置、真实短信/Redis/数据库/凭据；F2 保持 `CLOSED_MODE`。

## 已确认的迁移边界

- 直接迁移：`admin-initial-phone-bind.service.ts`、两个内部验证脚本以及两个新增目标守卫脚本。
- 手工合并：`services/api/package.json` 的单条 verify script，保留主线新增的打印安全脚本；`current-progress.md` 追加事实记录。
- 禁止迁移：旧 `.ccg` archive、`next-tasks.md` 和所有超出 F1 的文件。

## CCG 审查状态

- Claude 已给出有效只读分析：按上述白名单迁移、保留主线 package/docs 变更后可进入 TDD。
- Antigravity 的 Claude Sonnet 4.6 已给出有效实质性只读分析：条件性通过，要求目标守卫在 PrismaClient 创建前生效、验证审计失败回滚及 package/doc 的最小 diff。
- Antigravity Gemini 初始调用的 `RESOURCE_EXHAUSTED`、以及 Claude Opus 4.6 两次 `high traffic` 错误均已记录，但均不计为通过。
- 双模型有效分析现已具备；进入实施前仍须完成 spec、计划和代码级前置核验。
