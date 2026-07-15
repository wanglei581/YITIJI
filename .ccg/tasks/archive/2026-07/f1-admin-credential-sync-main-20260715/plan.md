# F1 管理员凭据加固同步 `origin/main@faa82612` 计划

## 0. 结论与范围声明

本任务是既有、本地 F1 安全候选 `ddff6c07` 向最新主线的选择性同步，不是 F2 安全换机任务，也不是生产验收或部署任务。

- 功能闭环：管理员首次手机号绑定的用户状态与完成审计原子一致；改密 verify 只能连接专用本地 SQLite 且不得清空审计记录。
- 后端：仅 `services/api` 的一个 service、三个 verify 脚本和两个小型守卫脚本。
- 前端 / Kiosk / Terminal Agent / 共享类型 / 共享 UI：不涉及。
- 数据模型 / migration / 外部依赖：不涉及。
- 文档：仅 `docs/progress/current-progress.md` 追加本地候选和验证事实；不改 `next-tasks.md`。
- 禁止真实短信、Redis、数据库、生产 / 共享预生产、凭据、打印、支付和 F2。

主线已从此前基线前进到 `faa82612`，其中 `package.json`、三个 F1 目标文件和进度文档均有历史重叠。因此严禁 rebase/cherry-pick/整文件覆盖；必须在新分支按最小 diff 手工重放。

## 1. 已完成的分析门禁

- 独立 Claude：允许继续，条件是完整携带两个新守卫文件、手工合并 package 单行、仅追加 progress、不得携带旧 archive 或 `next-tasks.md`。
- Antigravity Claude Sonnet 4.6：条件性通过，要求守卫在 `PrismaService` 实例化前执行、验证审计失败回滚、保持 package/doc 最小 diff。
- Antigravity Claude Opus 4.6：两次均为服务高流量错误，未计为通过。
- 已核实的前置事实：候选的目标守卫调用在 `verify-change-password.ts` 第 45 行、`new PrismaService()` 在第 199 行；主线目前仍在第 221 行执行 `prisma.auditLog.deleteMany()`；候选的手机号完成步骤在同一 `$transaction` callback 中执行 CAS 与 `tx.auditLog.create()`。同一 transaction callback 任一操作抛错会回滚，不能把操作顺序误判为回滚失效。

## 2. 文件预算

允许改动：

1. `services/api/src/auth/admin-initial-phone-bind.service.ts`
2. `services/api/scripts/verify-internal-auth-phone.ts`
3. `services/api/scripts/verify-change-password.ts`
4. `services/api/scripts/change-password-verify-target.ts`（新增）
5. `services/api/scripts/verify-change-password-target-guard.ts`（新增）
6. `services/api/package.json`（只增加一条 script）
7. `docs/progress/current-progress.md`（只追加一条事实记录）
8. 本任务 `.ccg/tasks/f1-admin-credential-sync-main-20260715/` 记录，完成后归档。

禁止改动：

- `docs/progress/next-tasks.md`、旧 F1 `.ccg` archive；
- 任一 Prisma schema / migration；
- `apps/kiosk/`、`apps/terminal-agent/`、打印/支付/生产配置及所有 F2 文件；
- 新路由、页面、依赖、环境变量、数据库表或外部调用。

`verify-internal-auth-phone.ts` 当前 847 行，超过 800 行阈值；本轮属于已验证安全缺陷的回归收口，按规范只允许最小测试增量，不借机继续堆叠或重构。`verify-change-password.ts` 为 524 行，本轮把纯目标判断放入新增 24 行 helper，避免继续扩大主脚本职责。

## 3. 实施步骤（TDD）

1. **建立同步基线。** 确认工作树无跟踪改动后，以 `origin/main@faa82612` 新建 `codex/f1-admin-credential-sync-main-20260715`；保留旧候选分支和提交，不删除、不改写它。
2. **RED：事务原子性回归。** 先在 `verify-internal-auth-phone.ts` 增加隔离 SQLite `AuditLog` 表和“transaction 内审计插入强制失败”的场景。此时主线 service 仍在用户 CAS 之后通过 `AuditService` 写完成审计，新的测试应观察到不符合“失败不写手机号”的行为并失败。
3. **GREEN：最小原子实现。** 仅在 `admin-initial-phone-bind.service.ts` 将原 CAS 和完成审计放到同一个 `PrismaService.$transaction` callback；审计直接使用 `tx.auditLog.create`，payload 固定为 `{ phoneMasked }`，所有失败继续映射为既有 `AUTH_INITIAL_PHONE_BIND_UNAVAILABLE`。
4. **RED：改密 verify 清理防回退。** 新增守卫验证脚本的静态断言，先针对主线的 `prisma.auditLog.deleteMany()` 运行并确认失败；此阶段不允许执行实际改密 verify。
5. **GREEN：目标守卫与无损清理。** 新增纯 helper，明确定义唯一允许的 `file:./prisma/verify-change-password.db`、非 production 和专用绝对路径标记；让 `verify-change-password.ts` 在创建 `PrismaService` 前调用 helper，移除 `auditLog.deleteMany()`；完成守卫脚本并在 `package.json` 仅追加 `verify:change-password:target-guard`，保留主线第 54–55 行的打印安全脚本。
6. **文档与任务事实。** 在最新 `current-progress.md` 的 PR #249 记录之后追加“本地同步候选、提交基线、验证级、未 push/部署/真实环境”的事实；不复活旧分支的 `next-tasks.md` 或 archive。
7. **本地验证与审查。** 运行第 4 节命令，检查 diff 白名单、无敏感字段、无 schema/migration，再执行 Claude 与 Antigravity 两路 diff 审查。Critical 必须修复并复审；仅当两路均有有效正文才可本地提交。
8. **收尾。** 再 fetch 复核 `origin/main` 未在白名单上产生新交集；如有交集则停止并重做同步核对。无新交集时归档 CCG task、精确暂存白名单文件、只创建本地 conventional commit；不 push/PR/deploy。

## 4. 最小验证清单

以下命令全部只作用于隔离的本地 SQLite 或静态源代码，不得替代生产验收：

```bash
pnpm --filter @ai-job-print/api run verify:change-password:target-guard
INTERNAL_AUTH_VERIFY_TARGET=isolated pnpm --filter @ai-job-print/api run verify:internal-auth-phone
pnpm --filter @ai-job-print/api run verify:change-password
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/api run db:pg:sync:check
git diff --check
```

额外手工门禁：

- `verify-change-password.ts` 的 helper 调用必须先于 `new PrismaService()`；
- 除守卫脚本中的“禁止字符串”静态断言外，实际 verify 源码不得出现 `auditLog.deleteMany`；
- 完成审计 payload 不得返回或记录 MAC/IP、绑定码、token、明文/哈希/密文手机号；
- `package.json` diff 仅一行，进度 diff 仅追加一条，且所有 tracked diff 都在文件预算内。

## 5. 完成定义

完成仅表示：F1 安全补强已在最新主线基线的本地候选完成 TDD、验证和双模型复审，并本地提交。

不表示：已 push、已合并、CI 通过、已部署、已发送真实短信、已修改任何生产/共享预生产账号或数据库、已进行浏览器或 Windows 真机验收，也不改变 F2 `CLOSED_MODE`。
