# 合作机构成员账号安全移除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The current task policy prohibits dispatching subagents, so execute inline with review checkpoints.

**Goal:** 让平台管理员能够在既有合作机构详情中安全移除 Partner 成员账号，同时保证机构始终保留至少一个有效登录账号。

**Architecture:** 使用 `User.deletedAt` 墓碑而非物理删除，保留历史外键并释放用户名、手机号等可复用凭据。删除在可串行化事务中完成并有限重试；认证和缓存把墓碑视为立即失效状态，所有后续 User 写入使用条件更新避免竞态复活。

**Tech Stack:** NestJS、Prisma 7（SQLite / PostgreSQL）、Redis、React、TypeScript、Tailwind、现有 Node verification scripts。

---

## 文件结构

| 文件 | 责任 |
| --- | --- |
| `services/api/prisma/schema.prisma` | `User.deletedAt` 与机构有效账号查询索引的唯一模型真相源。 |
| `services/api/prisma/postgres/schema.prisma` | 由 `db:pg:sync` 机械生成，禁止手改。 |
| 两套 `20260716193000_add_partner_account_tombstone/migration.sql` | SQLite / PostgreSQL 同步落地墓碑列与索引。 |
| `services/api/src/orgs/admin-orgs.service.ts` | 原子移除、成员查询过滤、账号启停/改密防竞态。 |
| `services/api/src/orgs/admin-orgs.controller.ts` | Admin-only `DELETE /admin/orgs/:id/accounts/:accountId`。 |
| `services/api/src/auth/*.ts`、`jwt-auth.guard.ts` | 登录、令牌、手机号绑定的墓碑拒绝和缓存失效。 |
| `services/api/scripts/verify-admin-orgs-delete-schema.ts` | 双 schema、双 migration 的 RED→GREEN 静态门禁。 |
| `services/api/scripts/verify-*.ts` | 真实 SQLite 行为、并发与缓存安全验证。 |
| `apps/admin/src/routes/partners/*.tsx` | 在现有机构详情中提供二次确认删除；拆出账号区以降低 817 行页面复杂度。 |
| `apps/admin/src/services/api/orgsAdmin.ts` | HTTP / mock adapter 的删除契约。 |
| `apps/admin/scripts/verify-partner-account-delete-ui.mjs` | UI 契约、可访问性、忙碌锁与刷新验证。 |

## Task 1: 墓碑数据模型与双数据库迁移

**Files:**

- Modify: `services/api/prisma/schema.prisma`
- Modify (generated): `services/api/prisma/postgres/schema.prisma`
- Create: `services/api/prisma/migrations/20260716193000_add_partner_account_tombstone/migration.sql`
- Create: `services/api/prisma/postgres/migrations/20260716193000_add_partner_account_tombstone/migration.sql`
- Create: `services/api/scripts/verify-admin-orgs-delete-schema.ts`
- Modify: `services/api/package.json`

- [ ] **Step 1: 先写会失败的双 schema / migration 门禁。**

  创建 `verify-admin-orgs-delete-schema.ts`。缺失文件返回空文本而不是抛系统错误，使 RED 输出明确指出缺失的设计元素：

  ```ts
  function expect(condition: boolean, message: string): void {
    if (!condition) failures.push(message)
  }

  const sqliteSchema = read('prisma/schema.prisma')
  const pgSchema = read('prisma/postgres/schema.prisma')
  const sqliteMigration = read('prisma/migrations/20260716193000_add_partner_account_tombstone/migration.sql')
  const pgMigration = read('prisma/postgres/migrations/20260716193000_add_partner_account_tombstone/migration.sql')

  expect(/deletedAt\s+DateTime\?/.test(sqliteSchema), 'SQLite User schema 缺少 deletedAt DateTime?')
  expect(/@@index\(\[orgId, role, enabled, deletedAt\]\)/.test(sqliteSchema), 'SQLite User schema 缺少有效账号索引')
  expect(pgSchema.includes('provider = "postgresql"') && /deletedAt\s+DateTime\?/.test(pgSchema), 'PostgreSQL schema 未同步 deletedAt')
  expect(sqliteMigration.includes('ADD COLUMN "deletedAt"') && sqliteMigration.includes('User_orgId_role_enabled_deletedAt_idx'), 'SQLite tombstone migration 不完整')
  expect(pgMigration.includes('ADD COLUMN "deletedAt"') && pgMigration.includes('User_orgId_role_enabled_deletedAt_idx'), 'PostgreSQL tombstone migration 不完整')
  ```

- [ ] **Step 2: 运行该门禁并确认 RED。**

  Run: `node -r @swc-node/register scripts/verify-admin-orgs-delete-schema.ts`

  Expected: 以 `SQLite User schema 缺少 deletedAt DateTime?`、migration 缺失等断言失败；不得因为读取缺失文件而异常退出。

- [ ] **Step 3: 在 SQLite schema 中实现最小模型变更。**

  在 `User` 增加并只增加下列字段与索引：

  ```prisma
  deletedAt DateTime?

  @@index([orgId, role, enabled, deletedAt])
  ```

  不改变 `id`、`username`、`phoneHash` 的唯一约束，不新增“删除原因”“恢复状态”或第二套成员表。

- [ ] **Step 4: 添加成对 migration。**

  SQLite migration 内容：

  ```sql
  ALTER TABLE "User" ADD COLUMN "deletedAt" DATETIME;
  CREATE INDEX "User_orgId_role_enabled_deletedAt_idx"
    ON "User"("orgId", "role", "enabled", "deletedAt");
  ```

  PostgreSQL migration 内容：

  ```sql
  ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
  CREATE INDEX "User_orgId_role_enabled_deletedAt_idx"
    ON "User"("orgId", "role", "enabled", "deletedAt");
  ```

  不执行任何生产数据库命令。

- [ ] **Step 5: 从唯一 schema 真相源同步 PostgreSQL schema，并验证 GREEN。**

  在 `package.json` 增加：

  ```json
  "verify:admin-orgs-delete-schema": "node -r @swc-node/register scripts/verify-admin-orgs-delete-schema.ts"
  ```

  Run: `pnpm --filter @ai-job-print/api exec prisma migrate deploy && pnpm --filter @ai-job-print/api db:pg:sync && pnpm --filter @ai-job-print/api db:pg:sync --check && pnpm --filter @ai-job-print/api db:pg:generate && pnpm --filter @ai-job-print/api verify:admin-orgs-delete-schema && pnpm --filter @ai-job-print/api typecheck`

  Expected: 本地 SQLite 验证库已应用新增 migration，`postgres schema 同步校验通过`，且生成的 PG client 包含 `deletedAt`。此命令只使用本地 `file:` 验证库；不得指向 PostgreSQL 生产连接。

- [ ] **Step 6: 核验 migration 对称性并提交。**

  Run: `git diff --check && git diff -- services/api/prisma/schema.prisma services/api/prisma/postgres/schema.prisma services/api/prisma/migrations services/api/prisma/postgres/migrations`

  Commit:

  ```bash
  git add services/api/prisma services/api/scripts/verify-admin-orgs-delete-schema.ts services/api/package.json
  git commit -m "feat: add partner account tombstone schema"
  ```

## Task 2: Admin 删除 API 与原子“最后有效账号”保护

**Files:**

- Modify: `services/api/src/orgs/admin-orgs.service.ts:223-642`
- Modify: `services/api/src/orgs/admin-orgs.controller.ts:34-87`
- Modify: `services/api/scripts/verify-admin-orgs.ts`
- Create: `services/api/scripts/verify-admin-orgs-delete-concurrency.ts`
- Modify: `services/api/package.json`

- [ ] **Step 1: 先扩展机构验证脚本，定义删除行为的失败断言。**

  在 `verify-admin-orgs.ts` 新增第二个 Partner 账号并调用尚不存在的 `deleteAccount`：

  ```ts
  await svc.deleteAccount(orgId, removableAccount.id, admin)
  await expectCode(
    () => svc.deleteAccount(orgId, survivingAccount.id, admin),
    'LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED',
    '最后一个有效 Partner 账号不可删除',
  )
  ```

  同一测试必须断言：详情和列表计数不再返回墓碑账号、原账号 ID 仍在数据库、`enabled === false`、`deletedAt !== null`、手机号字段为 `null`、原用户名与手机号可创建新账号、审计记录不含原用户名/手机号。

- [ ] **Step 2: 运行测试确认 RED。**

  Run: `pnpm --filter @ai-job-print/api verify:admin-orgs`

  Expected: FAIL，原因是运行时 `deleteAccount` 尚不存在。

- [ ] **Step 3: 实现短事务、串行化重试和墓碑更新。**

  在 `AdminOrgsService` 新增 `deleteAccount(orgId, accountId, admin)`，核心形状如下：

  ```ts
  const tombstonePasswordHash = await bcrypt.hash(randomUUID(), 10)
  const deleted = await this.withSerializableRetry(() => this.prisma.$transaction(
    async (tx) => {
      const account = await tx.user.findFirst({
        where: { id: accountId, orgId, role: 'partner', deletedAt: null },
      })
      if (!account) this.throwAccountNotFound(orgId, accountId)

      const activeCount = await tx.user.count({
        where: { orgId, role: 'partner', enabled: true, deletedAt: null },
      })
      if (activeCount - (account.enabled ? 1 : 0) < 1) {
        throw new ConflictException({
          error: {
            code: 'LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED',
            message: '请先新增并启用接替账号，再移除此账号',
          },
        })
      }

      const updated = await tx.user.updateMany({
        where: { id: account.id, orgId, role: 'partner', deletedAt: null },
        data: {
          deletedAt: new Date(), enabled: false,
          tokenVersion: { increment: 1 },
          username: `deleted:${account.id}`,
          passwordHash: tombstonePasswordHash,
          name: '已移除账号',
          phoneHash: null, phoneEnc: null, phoneVerifiedAt: null, lastLoginAt: null,
        },
      })
      if (updated.count !== 1) this.throwAccountNotFound(orgId, accountId)

      await tx.auditLog.create({
        data: {
          actorId: admin.userId, actorRole: 'admin', action: 'org.account.delete',
          targetType: 'organization', targetId: orgId,
          payloadJson: JSON.stringify({ accountId: account.id }),
        },
      })
      return { ...account, tokenVersion: account.tokenVersion + 1, deletedAt: new Date() }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 },
  ))
  await this.publishDeletedSessionState(deleted)
  return { success: true as const }
  ```

  同一 Task 在类内定义以下两个 helper，并从 `../generated/prisma/client` 导入 `Prisma`：

  ```ts
  private throwAccountNotFound(orgId: string, accountId: string): never {
    throw new NotFoundException({
      error: { code: 'ACCOUNT_NOT_FOUND', message: `Account ${accountId} not found in org ${orgId}` },
    })
  }

  private async withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await operation()
      } catch (error) {
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'
        if (!retryable || attempt === 2) throw error
      }
    }
    throw new Error('unreachable')
  }
  ```

  不得在事务外计数，不得物理删除 User。

- [ ] **Step 4: 同步收紧既有机构成员查询和操作。**

  - `listOrgs()` 和 `getOrgDetail()` 的账号计数改为 `role='partner', deletedAt=null`；详情 `users` 同样过滤墓碑。
  - `assertAccountInOrg()` 加 `deletedAt: null`。
  - 启停、重置密码改为 `updateMany({ where: { id, deletedAt: null }, ... })` 并检查 `count === 1`；失败时返回 `ACCOUNT_NOT_FOUND`。
  - `assertPhoneAvailable()` 显式忽略墓碑账号。
  - `invalidateOrgSessions()` 只枚举未移除账号。

- [ ] **Step 5: 暴露最小 Admin-only HTTP 路由。**

  在 `AdminOrgsController` 增加：

  ```ts
  @Delete('admin/orgs/:id/accounts/:accountId')
  deleteAccount(
    @Param('id') id: string,
    @Param('accountId') accountId: string,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.orgs.deleteAccount(id, accountId, user)
  }
  ```

  保持 controller 既有 `@Roles('admin')` 守卫，不为 Partner 自助端增加路由。

- [ ] **Step 6: 添加并发专项验证。**

  创建 `verify-admin-orgs-delete-concurrency.ts`，以内存 Prisma/Redis harness 覆盖以下并发场景：

  ```ts
  await Promise.all([
    harness.service.deleteAccount(orgId, first.id, admin),
    harness.service.deleteAccount(orgId, second.id, admin),
  ])
  const active = harness.users.filter((u) =>
    u.orgId === orgId && u.role === 'partner' && u.enabled && u.deletedAt === null,
  )
  if (active.length < 1) fail('并发删除使机构失去全部有效账号')
  ```

  同一脚本还必须覆盖：删除与启用竞态、删除与管理员重置密码竞态、删除与手机号绑定竞态、审计 payload 不含原凭据。

- [ ] **Step 7: 注册并运行后端验证。**

  在 API `package.json` 增加：

  ```json
  "verify:admin-orgs-delete-concurrency": "node -r @swc-node/register scripts/verify-admin-orgs-delete-concurrency.ts"
  ```

  Run: `pnpm --filter @ai-job-print/api verify:admin-orgs && pnpm --filter @ai-job-print/api verify:admin-orgs-delete-concurrency`

  Expected: 两个脚本均输出 `PASS` 并以 0 退出。

- [ ] **Step 8: 提交后端删除闭环。**

  ```bash
  git add services/api/src/orgs services/api/scripts/verify-admin-orgs.ts services/api/scripts/verify-admin-orgs-delete-concurrency.ts services/api/package.json
  git commit -m "feat: add safe partner account removal api"
  ```

## Task 3: 认证、Redis 与手机号写入的墓碑防复活

**Files:**

- Modify: `services/api/src/common/guards/jwt-auth.guard.ts`
- Modify: `services/api/src/auth/auth.service.ts`
- Modify: `services/api/src/auth/initial-phone-bind.service.ts`
- Modify: `services/api/src/auth/admin-initial-phone-bind.service.ts`
- Modify: `services/api/scripts/verify-internal-auth-phone.ts`
- Modify: `services/api/scripts/verify-admin-orgs-delete-concurrency.ts`

- [ ] **Step 1: 先在认证验证脚本加入删除后的失败断言。**

  在 `verify-internal-auth-phone.ts` 创建 `deletedAt` 非空、`enabled=false` 的 Partner fixture，并断言：

  ```ts
  await expectCode(() => auth.login(username, password, 'partner'), 'AUTH_LOGIN_FAILED', '墓碑账号不能密码登录')
  await expectCode(() => auth.changePassword(userId, oldPassword, newPassword), 'AUTH_SESSION_INVALID', '墓碑账号不能自助改密')
  await expectCode(() => auth.verifyAndBindPhone(userId, phone, code), 'AUTH_SESSION_INVALID', '墓碑账号不能写回手机号')
  ```

- [ ] **Step 2: 运行确认 RED。**

  Run: `pnpm --filter @ai-job-print/api verify:internal-auth-phone`

  Expected: FAIL，因为现有 `InternalUser`、查询和条件更新均不知道 `deletedAt`。

- [ ] **Step 3: 让 AuthService 的所有入口与写入都拒绝墓碑。**

  - `InternalUser` 选取 `deletedAt`，`canUseAccount()` 首先拒绝 `!enabled || deletedAt !== null`。
  - 登录签发 `lastLoginAt`、完成找回密码、改密、常规手机号绑定全部改为带 `deletedAt: null`、`enabled: true` 的 `updateMany`，检查 `count === 1`。
  - 用户名/手机号查找和重置目标只允许 `deletedAt: null`；手机号占用检查也过滤墓碑。
  - 条件更新落空统一返回既有通用登录/会话错误，不泄露账号删除状态。

  条件更新必须采用这一形式：

  ```ts
  const updated = await this.prisma.user.updateMany({
    where: { id: user.id, deletedAt: null, enabled: true, passwordHash: user.passwordHash },
    data: { passwordHash, tokenVersion: { increment: 1 } },
  })
  if (updated.count !== 1) throw this.resetFailed()
  ```

- [ ] **Step 4: 保护两种首次手机号绑定写入。**

  在普通首次绑定的更新条件中增加：

  ```ts
  where: { id: user.id, enabled: true, deletedAt: null, phoneEnc: null }
  ```

  在 Admin 首次绑定的事务更新条件中增加：

  ```ts
  deletedAt: null,
  enabled: true,
  ```

  两处 `assertPhoneAvailable` 都只把 `deletedAt: null` 账号视为占用者；唯一约束冲突仍映射到既有安全错误。

- [ ] **Step 5: 让 JWT 缓存 fail closed。**

  `CachedSessionState` 增加 `deletedAt: string | null`；解析旧缓存时若缺少此字段，删除缓存并重新读取数据库。所有数据库读取选择 `deletedAt`，并在令牌验证前执行：

  ```ts
  if (!state || state.deletedAt !== null || !state.enabled || payload.ver !== state.tokenVersion) {
    throw new UnauthorizedException({ error: { code: 'AUTH_TOKEN_INVALID', message: 'Token 无效或已过期' } })
  }
  ```

  对缓存命中的 Partner，重新查询数据库的 `enabled`、`tokenVersion`、`deletedAt` 与机构启用状态，再决定是否接受缓存；非 Partner 保持既有缓存路径。删除提交后写入更高 tokenVersion 的禁用会话状态，不能只 `del` 缓存键。

- [ ] **Step 6: 验证 stale Redis 与晚到写入。**

  在并发脚本预置旧状态缓存并验证：

  ```ts
  redis.cache.set(key, JSON.stringify({
    userId, role: 'partner', orgId, enabled: true,
    tokenVersion: oldVersion, deletedAt: null, orgEnabled: true,
  }))
  await expectCode(() => guard.canActivate(jwtContext(oldToken)), 'AUTH_TOKEN_INVALID', '残留缓存不能接受墓碑账号令牌')
  ```

- [ ] **Step 7: 运行认证验证并提交。**

  Run: `pnpm --filter @ai-job-print/api verify:internal-auth-phone && pnpm --filter @ai-job-print/api verify:admin-orgs-delete-concurrency`

  Expected: 所有认证、手机号和 stale-cache 场景均 PASS。

  ```bash
  git add services/api/src/auth services/api/src/common/guards/jwt-auth.guard.ts services/api/scripts/verify-internal-auth-phone.ts services/api/scripts/verify-admin-orgs-delete-concurrency.ts
  git commit -m "fix: prevent deleted partner accounts from regaining access"
  ```

## Task 4: 现有 Admin 机构详情的删除操作与 UI 验证

**Files:**

- Modify: `apps/admin/src/services/api/orgsAdmin.ts`
- Modify: `apps/admin/src/routes/partners/index.tsx`
- Create: `apps/admin/src/routes/partners/PartnerAccountManager.tsx`
- Create: `apps/admin/src/routes/partners/PartnerAccountDeletionDialog.tsx`
- Create: `apps/admin/scripts/verify-partner-account-delete-ui.mjs`
- Modify: `apps/admin/package.json`

- [ ] **Step 1: 先写失败的 Admin UI 契约验证。**

  新脚本必须读取 adapter 和两个组件源码，至少断言：

  ```js
  expect(source.includes("DELETE', `/admin/orgs/${orgId}/accounts/${accountId}`"), 'adapter 必须调用删除端点')
  expect(dialog.includes('role="alertdialog"'), '确认框必须是 alertdialog')
  expect(dialog.includes('删除后不可直接恢复'), '确认框必须声明不可恢复')
  expect(manager.includes('LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED'), '冲突必须给出接替账号提示')
  ```

- [ ] **Step 2: 运行确认 RED。**

  Run: `pnpm --filter @ai-job-print/admin verify:partner-account-delete-ui`

  Expected: FAIL，因为脚本和删除 adapter/组件尚不存在。

- [ ] **Step 3: 补齐 HTTP 与 mock adapter。**

  在 `OrgsAdminServiceInterface` 和两个 adapter 增加：

  ```ts
  deleteAccount(orgId: string, accountId: string): Promise<void>

  // HTTP
  deleteAccount: async (orgId, accountId) => {
    await req<{ success: true }>('DELETE', `/admin/orgs/${orgId}/accounts/${accountId}`)
  }
  ```

  Mock adapter 使用不可变 `filter` 移除模拟成员，找不到时抛出 `ApiHttpError('ACCOUNT_NOT_FOUND', ...)`；不得使用 `push` 或直接突变数组。

- [ ] **Step 4: 从 817 行页面提取既有账号管理区。**

  `PartnerAccountManager` 接收 `orgId`、`accounts`、`onReload`、`onChanged`，承接现有的新增、启停、重置密码和新删除行为；`index.tsx` 只保留机构详情加载、档案编辑和渲染：

  ```tsx
  <PartnerAccountManager
    orgId={orgId}
    accounts={detail.accounts}
    onReload={() => load(false)}
    onChanged={onChanged}
  />
  ```

  `load(showLoading = true)` 在首开和重试时显示 loading；账号操作刷新传 `false`，避免子组件在未完成请求时被卸载。提取后 `index.tsx` 不得继续超过 800 行。

- [ ] **Step 5: 实现二次确认与全列表忙碌锁。**

  `PartnerAccountDeletionDialog` 使用 `role="alertdialog"`、`autoFocus`、Escape 阻断冒泡、取消后返回删除触发按钮焦点。确认 handler 使用：

  ```tsx
  if (!deleteTarget || accountBusy !== null) return
  setAccountBusy(deleteTarget.id)
  setError(null)
  try {
    await orgsAdminService.deleteAccount(orgId, deleteTarget.id)
    setDeleteTarget(null)
    await onReload()
    onChanged()
  } catch (error) {
    const message = errMsg(error)
    setError(
      error instanceof ApiHttpError && error.code === 'LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED'
        ? '该机构必须保留一个已启用账号；请先新增并启用接替账号。'
        : message,
    )
  } finally {
    setAccountBusy(null)
  }
  ```

  启停、重置、删除按钮均以 `disabled={accountBusy !== null}` 锁定；删除确认文案不得声称物理删除或机构注销。

- [ ] **Step 6: 注册、运行 UI 验证并完成前端构建。**

  在 `apps/admin/package.json` 增加：

  ```json
  "verify:partner-account-delete-ui": "node scripts/verify-partner-account-delete-ui.mjs"
  ```

  Run: `pnpm --filter @ai-job-print/admin verify:partner-account-delete-ui && pnpm --filter @ai-job-print/admin typecheck && pnpm --filter @ai-job-print/admin build`

  Expected: verification、typecheck、Vite build 均通过。

- [ ] **Step 7: 提交 UI 闭环。**

  ```bash
  git add apps/admin/package.json apps/admin/scripts/verify-partner-account-delete-ui.mjs apps/admin/src/routes/partners apps/admin/src/services/api/orgsAdmin.ts
  git commit -m "feat: add partner account removal controls"
  ```

## Task 5: 全量收口、双数据库验证、审查与进度事实

**Files:**

- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Modify: `.ccg/tasks/partner-account-member-safe-removal-20260716/task.json`
- Create: `.ccg/tasks/partner-account-member-safe-removal-20260716/review.md`

- [ ] **Step 1: 运行所有本任务验证。**

  ```bash
  pnpm --filter @ai-job-print/api db:pg:sync --check
  pnpm --filter @ai-job-print/api verify:admin-orgs
  pnpm --filter @ai-job-print/api verify:admin-orgs-delete-concurrency
  pnpm --filter @ai-job-print/api verify:internal-auth-phone
  pnpm --filter @ai-job-print/api typecheck
  pnpm --filter @ai-job-print/api build
  pnpm --filter @ai-job-print/admin verify:partner-account-delete-ui
  pnpm --filter @ai-job-print/admin typecheck
  pnpm --filter @ai-job-print/admin build
  ```

  Expected: 每条命令以 0 退出；若 SQLite 的临时数据库 schema 落后，先按现有项目 migration 流程重建验证库，再重跑，绝不改测试绕过 migration。

- [ ] **Step 2: 执行变更与安全检查。**

  ```bash
  git diff --check origin/main...HEAD
  git diff --name-only origin/main...HEAD
  git diff origin/main...HEAD -- services/api apps/admin | rg -n 'BEGIN (RSA|OPENSSH)|api[_-]?key|secret\s*=' || true
  ```

  Expected: 无空白错误、变更仅在设计规格允许范围、无硬编码凭据；`password` 仅可出现在 DTO、测试或 bcrypt 逻辑中，不能出现明文生产值。

- [ ] **Step 3: 完成前后端与安全双模型审查。**

  以 `git diff origin/main...HEAD` 为输入分别请求前端审查与 Claude 审查，记录 Critical / Warning / Info。Critical 必须修复并重跑 Step 1；Warning 需记录处置理由。把最终结论写入 task 的 `review.md`。

- [ ] **Step 4: 如实更新进度文档。**

  在 `current-progress.md` 仅记录已通过的本地验证、API/UI 边界、未执行生产迁移的事实；在 `next-tasks.md` 列出上线前数据库 migration 与 Admin 手动走查。不得写“生产已部署”或“机构已注销”。

- [ ] **Step 5: 完成、归档并提交。**

  ```bash
  git add docs/progress .ccg/tasks
  git commit -m "docs: record partner account removal verification"
  mkdir -p .ccg/tasks/archive/$(date +%Y-%m)
  mv .ccg/tasks/partner-account-member-safe-removal-20260716 .ccg/tasks/archive/$(date +%Y-%m)/
  git add .ccg/tasks
  git commit -m "chore: archive ccg task partner-account-member-safe-removal-20260716"
  ```

  归档后再次运行 `git status --short`，预期为空。

## 覆盖性自检

| 已确认需求 | 对应任务 |
| --- | --- |
| Admin-only、仅 Partner、无新入口 | Task 2 Step 5；Task 4 Steps 4–5 |
| 最后有效账号不可删且并发安全 | Task 2 Steps 3、6 |
| 保留历史关联、释放凭据 | Task 1；Task 2 Steps 1、3–4 |
| 令牌、Redis、密码和手机流程不能复活 | Task 3 全部 |
| SQLite / PostgreSQL 对称迁移 | Task 1；Task 5 Step 1 |
| 二次确认、错误提示、无障碍、刷新 | Task 4 全部 |
| 无生产宣称、进度事实收口、双模型审查 | Task 5 全部 |

未发现未决占位语句或未定义的后续实现项。类型一致性：服务端错误码统一为 `LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED`，墓碑字段统一为 `deletedAt`，删除端点统一为 `DELETE /admin/orgs/:id/accounts/:accountId`。
