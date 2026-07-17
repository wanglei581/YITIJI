# Wave 1-B Slice 1 需求边界

## 真实上线阻塞

现有会员资料导出、注销、同意状态撤回共用不完整的数据请求模型：状态枚举不全、没有幂等键、注销请求会被落库而没有明确的商用级执行边界。上线前必须先建立可审计、可恢复的账本契约，并确保账户注销在尚未具备正式审批流前绝不产生任何副作用。

## 本切片交付

- 将资料请求的状态、执行步骤、重试与下载能力收紧为跨层契约。
- 为 `UserDataRequest` 在 SQLite 与 PostgreSQL 两套 Prisma schema/migration 增加幂等和执行字段，以及有效的唯一约束。
- 新增专职数据请求服务，支持导出请求的 UUID 幂等键、同用户冲突检测与只消费一次的 Step-up 授权。
- 保留同意撤回为同步、可完成的用户动作。
- 账户注销只返回稳定的 `ACCOUNT_CLOSURE_NOT_AVAILABLE` 冲突错误；在该分支中不得读取或写入 Prisma、Redis、BullMQ、文件、审计或账户状态。
- 管理端旧通用 PATCH 收紧为仅允许导出请求进入 `rejected`；不得提供删除、完成、失败或重试的运行时入口。
- 添加状态机验证脚本，并扩展既有真相验证及 npm 脚本。

## 允许改动文件

- `packages/shared/src/types/member-privacy.ts`
- `services/api/src/member-privacy/member-privacy.types.ts`
- `services/api/src/member-privacy/member-privacy.service.ts`
- `services/api/src/member-privacy/member-data-request.service.ts`（新增）
- `services/api/src/member-privacy/member-privacy.controller.ts`
- `services/api/src/member-privacy/admin-member-privacy.controller.ts`
- `services/api/src/member-privacy/member-privacy.module.ts`（为注入新服务所必需的最小登记）
- `services/api/prisma/schema.prisma`
- `services/api/prisma/postgres/schema.prisma`
- `services/api/prisma/migrations/20260717130000_extend_user_data_requests/migration.sql`（新增）
- `services/api/prisma/postgres/migrations/20260717130000_extend_user_data_requests/migration.sql`（新增）
- `services/api/scripts/verify-member-data-request-state-machine.ts`（新增）
- `services/api/scripts/verify-member-data-request-truth.ts`
- `services/api/scripts/verify-job-ai-privacy.ts`（既有隐私门禁改为验证拆分后的服务职责与 Slice 1 fail-closed 契约）
- `services/api/package.json`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

`member-privacy.module.ts` 是正式 Slice 1 计划列表之外的必要最小扩展：控制器改为注入专职服务时，Nest 模块必须登记该 provider；不改该文件会造成运行时依赖解析失败。

`verify-job-ai-privacy.ts` 是必要的回归同步：它仍直接调用已迁出的数据请求方法，若不更新会让旧验证描述与新的职责拆分相矛盾，并在运行时失败；其余 Job AI 同意与配额断言保持不变。

## 明确禁止

- 不新增或改变 Kiosk、Admin、Partner 的可见页面、路由或入口。
- 不接入真实导出、下载、文件存储、Redis、BullMQ、短信或外部通知。
- 不执行账户注销、不删除用户数据、不修改用户状态或资料。
- 不修改生产配置、密钥、终端 Agent、打印扫描链路、CI 工作流或外部依赖。
- 不改变岗位、招聘会、简历投递的合规边界。

## 验证门槛

- 新状态机验证先失败后通过，且验证删除路径零副作用、导出幂等不重复消费授权。
- 既有 `verify-member-data-request-truth` 通过。
- Prisma SQLite/PostgreSQL schema 校验通过。
- API lint、typecheck、相关 verify 通过。
- 审查 `git diff`、不含密钥；完成时双模型审查均已尝试并如实记录结果。
