# 智慧校园与招聘会闭环交付协作规则

> 日期：2026-06-17
> 适用范围：智慧校园、校园招聘会、合作机构权限、三端数据闭环、上线前验收
> 关联文档：`docs/decisions/ai-collaboration-rules.md`、`docs/product/partner-permission-matrix.md`、`docs/product/campus-recruitment-design.md`、`docs/compliance/compliance-boundary.md`

## 目标

本轮交付目标不是增加入口，而是把现有 Admin、Partner、Kiosk、API、数据库、审计和验证脚本收成可上线使用的真实闭环：

- Admin 能按机构类型、授权模块、终端归属配置能力。
- Partner 账号只能看到和操作本机构已授权模块。
- Kiosk 只展示当前终端、当前机构、已审核发布的数据。
- 招聘会和智慧校园数据不能用静态占位冒充真实对接。
- 所有高风险修改必须通过自动验证、浏览器验收、真机/预生产验收和双模型审查。

## 分工

| 角色 | 职责 | 文件边界 |
|------|------|----------|
| Claude | 主力实现：后端 Guard、Prisma 迁移、API、前端接线、验证脚本 | `services/`、`apps/`、`packages/` |
| Codex | 需求拆解、规则文档、计划维护、对抗审查、验收汇总、必要小修 | `docs/`、`.ccg/tasks/`、审查报告；必要时可改代码但必须避开 Claude 正在修改的文件 |
| 双模型审查 | 最终独立审查 git diff、验证输出、合规边界和上线风险 | 不直接改业务代码，输出 Critical/Warning/Info |

同一时间同一文件只能有一个执行方负责。若必须交接，先在 CCG task 的 `nextAction` 写明交接范围，再由另一方接手。

## 阶段边界

### P0：上线前必须先做

1. 生产门禁补强：生产禁止 SQLite、生产文件存储必须为 COS、生产不能使用开发 JWT fallback。
2. 关键验证入 CI：`verify:partner-smart-campus`、`verify:partner-edit`、`verify:public-fair-demo-guard`、`verify:smart-campus-ui`。
3. 机构类型矩阵：服务端限制 `Organization.type -> sceneTemplate -> enabledModules`。
4. Partner 模块授权：后端按 `enabledModules` 和账号权限拒绝未授权 API，不只靠前端隐藏。
5. Admin 智慧校园配置：终端必须归属高校机构后才能打开智慧校园。
6. 招聘会审核闭环：Admin 信息源页补齐审核中、驳回、驳回原因；Partner 能看到被驳回原因并重新提交。
7. Kiosk 校园招聘会本校优先：按当前终端真实归属学校优先，而不是按列表第一条推断。
8. Partner 招聘会边界说明：明确参展企业、岗位明细、资料、导览当前由 Admin 运营维护，避免机构误解。

### P1：P0 稳定后再做

1. Partner 子账号权限页面真实化。
2. 智慧校园迎新内容 CMS：Partner 草稿、Admin 审核、Kiosk 已发布只读。
3. 行李帮运与校园全景做官方信息入口和可审核内容配置。
4. 来源平台打开、导航、资料打印等合法埋点补齐。
5. 批量导入事务化和部分成功回执优化。

### P2：上线后或专项合规后再做

1. 校园大数据解冻。前置条件是学校书面授权、数据处理协议、聚合脱敏模型、小样本保护、审核发布和法务确认。
2. 招聘会现场签到、展位网格、实时现场指标。
3. Webhook 防重放和全局限流切 Redis 共享存储，多实例部署前必须完成。

## 硬规则

1. 禁止新增招聘闭环能力。系统只提供信息展示、外部来源入口、打印与 AI 求职工具服务。
2. Partner 权限必须后端拦截。前端隐藏菜单只是体验，不算权限。
3. 智慧校园 `bigdata` 继续冻结。任何请求传入 true 都必须落为 false，前台只显示未开放。
4. 未通过 Admin 审核发布的数据不得进入 Kiosk。
5. 修改已发布招聘会或岗位后必须回到待审和草稿状态。
6. Kiosk 端不得展示 mock、静态占位或演示数据冒充真实数据。
7. 所有写操作必须有审计。审计失败必须可告警，不允许长期无感丢失。
8. 生产健康检查必须证明 `db=postgres`，不能只是服务启动。
9. 最终交付前必须重新启动双模型审查；Critical 未清零不得交付。

## 最终交付门禁

自动脚本至少包括：

```bash
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/partner typecheck
pnpm --filter @ai-job-print/api build
pnpm --filter @ai-job-print/kiosk build
pnpm --filter @ai-job-print/admin build
pnpm --filter @ai-job-print/partner build
pnpm --filter @ai-job-print/api verify:production-db-guard
pnpm --filter @ai-job-print/api verify:partner-smart-campus
pnpm --filter @ai-job-print/api verify:partner-edit
pnpm --filter @ai-job-print/api verify:public-fair-demo-guard
pnpm --filter @ai-job-print/api verify:admin-fairs
pnpm --filter @ai-job-print/api verify:admin-orgs
pnpm --filter @ai-job-print/api verify:fair-company-positions
pnpm --filter @ai-job-print/api verify:activity-logs
pnpm --filter @ai-job-print/kiosk verify:jobfair-ui
pnpm --filter @ai-job-print/kiosk verify:smart-campus-ui
```

浏览器验收至少覆盖：

- Admin 创建高校机构、授权模块、创建账号、绑定终端。
- Partner 学校账号只能看到本机构终端，非学校机构访问智慧校园被拒。
- Kiosk 首页智慧校园随终端开关出现和消失。
- `/smart-campus/freshman-insights` 始终只展示未开放。
- Partner 新增招聘会后 Kiosk 不可见；Admin 审核并发布后 Kiosk 可见。
- Partner 修改已发布招聘会后重新回待审，Kiosk 不再公开展示。
- `/campus` 本校优先按终端归属学校展示。
- 招聘会详情、参展企业、岗位、活动资料、导览、统计均读取真实接口。
- 外部入口只记录打开行为，不记录第三方处理结果。

生产/真机验收至少覆盖：

- `/api/v1/health` 返回 `db=postgres`。
- `FILE_STORAGE_DRIVER=cos`，COS live 冒烟通过。
- 1 台真实终端 + 1 台打印机 + 1 个学校 Partner 账号完整闭环。
- 断网、重启、打印失败、恢复上线均有状态回传。
- 生产库无演示、验证、测试残留数据。

## 双模型审查规则

最终代码和文档变更完成后，由 Codex 发起并行审查：

- Antigravity：重点看前端体验、数据流转、页面状态、遗漏入口。
- Claude：重点看架构、安全、权限、数据库、合规、上线门禁。

审查输入必须包含：

- `git diff`
- 本轮计划文档
- 自动验证输出
- 浏览器/真机验收记录
- 已知未做项和延期原因

审查输出必须合并为一份报告，按 Critical/Warning/Info 分级。Critical 必须修复后重新审查；Warning 需明确修复或延期理由；Info 可进入后续任务。
