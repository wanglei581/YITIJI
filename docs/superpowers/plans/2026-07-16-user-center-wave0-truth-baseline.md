# User Center Wave 0 Truth and Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除用户中心与登录页的重复/占位/不可用入口，复验二维码现行守卫，禁止未完成的导出/删除工单被标记为完成，并用全新 SQLite + PostgreSQL readiness 建立可重复验证基线。

**Architecture:** 本波不新增功能和数据模型。Kiosk 只收口已有 `profileEntries`、登录方式和设置页口径；API 在现有 `MemberPrivacyService.handleDataRequest` 增加 fail-closed 转换规则；静态守卫和 CI 明确锁住真实表达。数据库只重放现有 migration，禁止为 `Order.refundedAmountCents` 或 `RedemptionRecord` 重复建迁移。

**Tech Stack:** React + TypeScript；NestJS + Prisma；Node 静态 verify；SQLite/PostgreSQL migration；GitHub Actions。

---

## Task 0: 建立隔离工作区与 CCG 任务

**Files:**

- Create: `.ccg/tasks/user-center-wave0-truth-baseline/task.json`（工具状态，不提交）
- Read: `.ccg/spec/guides/index.md`
- Read: `.ccg/spec/frontend/index.md`（若存在）
- Read: `.ccg/spec/backend/index.md`（若存在）

- [ ] 从最新远端主线创建隔离 worktree：

```bash
git fetch origin main
git worktree add .worktrees/user-center-wave0-truth-baseline -b codex/user-center-wave0-truth-baseline origin/main
```

Expected: 新 worktree `git status --short` 为空。

- [ ] 写 CCG task，复杂度 `M`、风险 `high`、阶段 `analysis`；允许文件只列本计划明确文件。
- [ ] 读取 `.ccg/spec/**` 后，把本任务文件预算和验证命令写入 task 的 `requirements.md`。
- [ ] 运行基线守卫，记录最新主线事实：

```bash
pnpm --filter @ai-job-print/kiosk verify:qr-login-ui
pnpm --filter @ai-job-print/kiosk verify:profile-inkpaper-home
```

Expected: 两个守卫均 PASS；QR 守卫已经与当前实现一致，Profile 守卫则仍把重复/占位入口当作必须存在，后者将在 Task 2 随真实合同一起更新。

## Task 1: 先写 Wave 0 真实表达守卫（RED）

**Files:**

- Create: `apps/kiosk/scripts/verify-user-center-wave0.mjs`
- Modify: `apps/kiosk/package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] 创建静态守卫并让它先失败。完整核心断言如下：

```js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8')
const entries = read('src/pages/profile/profileEntries.ts')
const login = read('src/pages/auth/LoginPage.tsx')
const settings = read('src/pages/profile/me/MySettingsPage.tsx')

for (const forbidden of [
  '招聘会扫码凭证',
  '招聘会权益活动',
  '求职打印套餐',
  'AI服务套餐',
  "label: '身份切换'",
  "type LoginTab = 'phone' | 'scan' | 'email'",
  'EmailReservedPane',
  '邮箱登录暂未开放',
  '/activities?source=fair',
]) {
  assert.equal(`${entries}\n${login}`.includes(forbidden), false, `禁止残留：${forbidden}`)
}

assert.equal((entries.match(/label: '权益活动'/g) ?? []).length, 1, '权益活动只保留一个真实入口')
assert.match(entries, /label: '权益活动'[\s\S]{0,120}route: '\/activities'/)
assert.doesNotMatch(settings, /身份切换/)
assert.match(settings, /账号注销和数据导出尚未开放/)
assert.doesNotMatch(`${entries}\n${login}`, /一键投递|立即投递|平台投递|投递简历/)

console.log('verify-user-center-wave0: ok')
```

- [ ] 在 `apps/kiosk/package.json` 注册：

```json
"verify:user-center-wave0": "node scripts/verify-user-center-wave0.mjs"
```

- [ ] 在 CI `Verify suites` 中紧跟 `verify:profile-inkpaper-home` 加：

```yaml
pnpm --filter @ai-job-print/kiosk verify:user-center-wave0
```

- [ ] 运行并确认 RED：

```bash
pnpm --filter @ai-job-print/kiosk verify:user-center-wave0
```

Expected: 因当前邮箱、招聘会场景重复权益入口、三个建设中卡片和设置页旧口径而失败；最新 `origin/main` 已无 Profile「身份切换」入口，该项仅作为防回归断言。

- [ ] Commit：

```bash
git add apps/kiosk/scripts/verify-user-center-wave0.mjs apps/kiosk/package.json .github/workflows/ci.yml
git commit -m "test: lock user center wave0 truth"
```

## Task 2: 清理 Profile 重复与占位入口（GREEN）

**Files:**

- Modify: `apps/kiosk/src/pages/profile/profileEntries.ts`
- Modify: `apps/kiosk/scripts/verify-profile-inkpaper-home.mjs`
- Modify: `apps/kiosk/scripts/verify-lightflow-profile-entry.mjs`
- Modify: `apps/kiosk/scripts/verify-lightflow-4188-layout-parity.mjs`

- [ ] 把 `FAIRS` 收敛为真实记录入口，不保留扫码凭证和第二个权益入口：

```ts
const FAIRS: Entry[] = [
  { icon: 'eye', tone: 'slate', label: '浏览记录', desc: '岗位、招聘会、政策、企业', route: '/me/activity' },
  { icon: 'external', tone: 'teal', label: '外部跳转记录', desc: '本人离场跳转记录', route: '/me/activity?tab=jump' },
]
```

- [ ] 把权益分区改名为“权益与政策”，只留真实入口：

```ts
const BENEFITS: Entry[] = [
  { icon: 'ticket', tone: 'rose', label: '权益活动', desc: '查看正式活动入口', route: '/activities' },
  { icon: 'policy', tone: 'wheat', label: '政策补贴指引', desc: '政策说明与官方入口', route: '/renshi?tab=policy' },
]
```

- [ ] 最新 `origin/main` 的 `ACCOUNT` 已无 `身份切换`；保持该入口缺失并保留反向断言。切换账号仍是设置页内真实操作，不新增 Profile 同义入口。
- [ ] 更新 `SECTIONS` 分区标题/副标题，禁止出现“上线后在这里开通”：

```ts
{ title: '权益与政策', subtitle: '查看本人权益、真实活动和官方政策入口。', layout: 'chips', rail: 'plum', entries: BENEFITS }
```

- [ ] 修改 `verify-profile-inkpaper-home.mjs` 的 `expectedEntries`，精确删除以下旧期望；真实 `权益活动 -> /activities` 必须保留：

```text
招聘会权益活动 -> /activities?source=fair
```

- [ ] `招聘会扫码凭证`、`求职打印套餐`、`AI服务套餐` 不在 `expectedEntries` 数组中；把三项各自的“仍为建设中”正向 `expectMatches` 删除并改为反向断言，禁止仅从数组里查找后误以为守卫已同步。

- [ ] 把分区标题守卫中的 `权益活动与服务套餐` 更新为 `权益与政策`，其余四个分区标题不变。
- [ ] 同步更新 `verify-lightflow-profile-entry.mjs`：`expectedEntries` 删除 `招聘会权益活动`，入口总数从 26 改为 22，建设中标签从 3 改为 0，把标题循环中的 `权益活动与服务套餐` 改为 `权益与政策`，并把三项占位能力改为反向断言；同时更新仍描述“23 个真实入口 + 3 个建设中入口”的旧断言消息，避免守卫通过但文案口径漂移。
- [ ] 同步更新 `verify-lightflow-4188-layout-parity.mjs` 的五区标题，将 `权益活动与服务套餐` 改为 `权益与政策`。该守卫只改标题契约，不改首页或布局断言。

- [ ] 在同一守卫加入明确的反向断言：

```js
expectMatches(entries, /label:\s*'权益活动'[\s\S]{0,120}?route:\s*'\/activities'/, '权益活动只保留真实入口')
expectMatches(entries, /const BENEFITS:[\s\S]*?label:\s*'权益活动'[\s\S]*?label:\s*'政策补贴指引'/, '权益分区只保留已接真能力')
expectAbsent(entries, /招聘会扫码凭证|招聘会权益活动|求职打印套餐|AI服务套餐|label:\s*'身份切换'|\/activities\?source=fair/, 'Profile 不再展示重复或占位入口')
```

- [ ] 运行：

```bash
pnpm --filter @ai-job-print/kiosk verify:profile-inkpaper-home
pnpm --filter @ai-job-print/kiosk verify:lightflow-profile-entry
pnpm --filter @ai-job-print/kiosk verify:lightflow-4188-layout-parity
pnpm --filter @ai-job-print/kiosk verify:user-center-wave0
```

Expected: Profile 守卫通过；Wave 0 守卫此时只剩邮箱/设置口径失败。

- [ ] Commit：

```bash
git add apps/kiosk/src/pages/profile/profileEntries.ts apps/kiosk/scripts/verify-profile-inkpaper-home.mjs apps/kiosk/scripts/verify-lightflow-profile-entry.mjs apps/kiosk/scripts/verify-lightflow-4188-layout-parity.mjs
git commit -m "fix: remove duplicate and placeholder profile entries"
```

## Task 3: 删除不可用邮箱登录方式（GREEN）

**Files:**

- Modify: `apps/kiosk/src/pages/auth/LoginPage.tsx`
- Modify: `apps/kiosk/src/pages/auth/styles/login-form.css`

- [ ] 将登录 tab 类型改为真实方式：

```ts
type LoginTab = 'phone' | 'scan'
```

- [ ] 删除 `MailIcon` import、邮箱 tab button、`EmailReservedPane` 组件和文件头“邮箱预留”说明。
- [ ] 保留两种方式的现有状态切换，确保 `switchTab` 只接收 `phone | scan`。
- [ ] 更新标题文案，不宣称不存在的第三种方式：

```tsx
<p>手机号验证码或手机扫码，全程不超过 3 步</p>
```

- [ ] 从 `styles/login-form.css` 删除只被邮箱预留 pane 使用的 `.k-reserved` 规则；`login.css` 只是样式 import 入口，不修改。
- [ ] 运行：

```bash
pnpm --filter @ai-job-print/kiosk verify:user-center-wave0
pnpm --filter @ai-job-print/kiosk typecheck
```

Expected: Wave 0 守卫只剩设置页口径失败；TypeScript 无未使用 import/不可达联合类型。

- [ ] Commit：

```bash
git add apps/kiosk/src/pages/auth/LoginPage.tsx apps/kiosk/src/pages/auth/styles/login-form.css
git commit -m "fix: remove unavailable email login entry"
```

## Task 4: 清理设置页身份切换遗留口径（GREEN）

**Files:**

- Modify: `apps/kiosk/src/pages/profile/me/MySettingsPage.tsx`
- Modify: `apps/kiosk/scripts/verify-profile-inkpaper-home.mjs`

- [ ] 保留设置页内“切换账号”真实操作，但把代码注释从“身份切换”统一为“切换账号”。
- [ ] 将底部诚实说明改成只描述仍未开放的数据权利，不再说昵称（本波不设计昵称功能）：

```tsx
<p className="text-xs leading-relaxed text-neutral-500">
  手机号换绑、账号注销和数据导出尚未开放；相关能力完成安全验证与运营闭环后将在本页提供。如需协助，请联系现场工作人员。
</p>
```

- [ ] 把 `verify-profile-inkpaper-home.mjs` 对旧文案的断言替换为：

```js
expectIncludes(settingsPage, '手机号换绑、账号注销和数据导出尚未开放', '账号设置诚实说明未开放的数据权利')
```

- [ ] 运行：

```bash
pnpm --filter @ai-job-print/kiosk verify:user-center-wave0
pnpm --filter @ai-job-print/kiosk verify:profile-inkpaper-home
pnpm --filter @ai-job-print/kiosk verify:profile-commercial-first-batch
```

Expected: 全部通过。

- [ ] Commit：

```bash
git add apps/kiosk/src/pages/profile/me/MySettingsPage.tsx apps/kiosk/scripts/verify-profile-inkpaper-home.mjs
git commit -m "fix: align account settings truth copy"
```

## Task 5: 复验二维码现行守卫（验证任务，无代码变更）

**Files:**

- Verify only: `apps/kiosk/scripts/verify-qr-login-ui.mjs`
- Verify only: `apps/kiosk/src/pages/auth/ScanQrLoginPanel.tsx`

- [ ] 基于最新 `origin/main` 确认实现包含以下三条降级文案；静态守卫当前断言前两条，第三条通过实现只读复核确认：

```text
本机扫码登录服务未连接，请使用手机号登录
扫码登录服务不可用，请使用手机号登录
本机服务不可用？改用手机号登录
```

- [ ] `origin/main@6c787559` 的 `verify-qr-login-ui.mjs` 已不含旧断言“请刷新二维码或使用手机号登录”，且在干净工作树实跑通过；不得为制造 RED 回退实现或重复修改守卫。

- [ ] 运行：

```bash
pnpm --filter @ai-job-print/kiosk verify:qr-login-ui
```

Expected: `verify-qr-login-ui: ok`。

- [ ] 该任务无 diff、无单独 commit；把 PASS 记入 Wave 0 验收证据。

## Task 6: 先写虚假完成态回归测试（RED）

**Files:**

- Create: `services/api/scripts/verify-member-data-request-truth.ts`
- Modify: `services/api/package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] 新建集成 verify，使用独立临时 SQLite、真实 `PrismaService + AuditService + MemberPrivacyService` 创建 EndUser 和三类请求；不启动完整 `AppModule`，避免把 Redis、支付或生产密钥变成 Wave 0 的无关前置条件。
- [ ] 核心断言必须覆盖：

```ts
await expectHttpError(
  () => privacy.handleDataRequest(exportRequest.id, {
    status: 'completed',
    handledBy: adminId,
  }),
  'DATA_REQUEST_EXECUTION_INCOMPLETE',
)

await expectHttpError(
  () => privacy.handleDataRequest(deleteRequest.id, {
    status: 'completed',
    handledBy: adminId,
  }),
  'DATA_REQUEST_EXECUTION_INCOMPLETE',
)

await expectHttpError(
  () => privacy.handleDataRequest(deleteRequest.id, {
    status: 'rejected',
    handledBy: adminId,
  }),
  'DATA_REQUEST_EXECUTION_INCOMPLETE',
)

const revoked = await privacy.handleDataRequest(revokeRequest.id, {
  status: 'completed',
  handledBy: adminId,
})
assert.equal(revoked.status, 'completed')
```

- [ ] 再查数据库和审计：export/delete 的完成尝试均未改变原状态，delete 的普通拒绝尝试也未改变原状态；不存在对应的 `toStatus=completed` / `toStatus=rejected` 审计。
- [ ] 注册：

```json
"verify:member-data-request-truth": "node -r @swc-node/register scripts/verify-member-data-request-truth.ts"
```

- [ ] CI 的 SQLite `Verify suites` 紧跟 `verify:job-ai-privacy` 执行该守卫；`postgres-readiness` 也在 PostgreSQL migration deploy 后执行同一守卫。
- [ ] 运行确认 RED：

```bash
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-data-request-truth
```

Expected: 当前服务允许 `export/delete -> completed`，测试失败。

- [ ] Commit：

```bash
git add services/api/scripts/verify-member-data-request-truth.ts services/api/package.json .github/workflows/ci.yml
git commit -m "test: reproduce false privacy request completion"
```

## Task 7: 阻断 export/delete 虚假 completed（GREEN）

**Files:**

- Modify: `services/api/src/member-privacy/member-privacy.service.ts`
- Modify: `services/api/scripts/verify-job-ai-privacy.ts`

- [ ] 在读到 `existing` 后、任何删除/审计/更新前加入 fail-closed 检查：

```ts
if (
  (
    input.status === 'completed' &&
    (existing.requestType === 'export' || existing.requestType === 'delete')
  ) ||
  (input.status === 'rejected' && existing.requestType === 'delete')
) {
  throw new BadRequestException({
    error: {
      code: 'DATA_REQUEST_EXECUTION_INCOMPLETE',
      message: '该数据请求尚未完成真实执行，不能进入目标状态',
    },
  })
}
```

- [ ] 删除现有 `delete` 请求在 Admin 置 `completed` 时直接调用 `deleteJobAiPersonalData` 的分支；`deleteJobAiPersonalData` 若无其他调用者则连同死代码删除。Wave 1 将由专用 closure worker 接管，Wave 0 不保留“部分删除但叫完成”的语义。
- [ ] 删除 `verify-job-ai-privacy.ts` 中“Admin completed 会同步删除 AI 数据”的成功/回滚/调用方 auditRef 绕过测试夹具与断言，以及静态 `mustContain` 对 `deleteJobAiPersonalData` 的旧字符串要求；替换为：`export/delete -> completed` 与 `delete -> rejected` 返回 `DATA_REQUEST_EXECUTION_INCOMPLETE`、AI 数据不删除、AuditService 不写完成/拒绝审计、request 状态保持原值。守卫必须要求 fail-closed，禁止为了让旧断言通过而恢复虚假完成实现。
- [ ] 保持 `revoke_consent` 的同步完成逻辑不变。
- [ ] 运行：

```bash
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-data-request-truth
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:job-ai-privacy
pnpm --filter @ai-job-print/api typecheck
```

Expected: 新守卫通过；原岗位 AI 隐私守卫若仍要求 `deleteJobAiPersonalData`，先按真实新契约更新守卫，不能恢复假实现。

- [ ] Commit：

```bash
git add services/api/src/member-privacy/member-privacy.service.ts services/api/scripts/verify-job-ai-privacy.ts
git commit -m "fix: prevent false privacy request completion"
```

## Task 8: 从正式 migration 验证双数据库基线

**Files:**

- No runtime file changes
- Verify: `services/api/prisma/migrations/**`
- Verify: `services/api/prisma/postgres/migrations/**`

- [ ] 用独立临时 SQLite 文件重放正式迁移，不覆盖用户现有 `dev.db`：

```bash
cd services/api
DATABASE_URL='file:./prisma/wave0-verify.db' npx prisma migrate deploy
DATABASE_URL='file:./prisma/wave0-verify.db' npx prisma generate
DATABASE_URL='file:./prisma/wave0-verify.db' PAYMENT_PROVIDER=disabled pnpm verify:member-print-orders
DATABASE_URL='file:./prisma/wave0-verify.db' PAYMENT_PROVIDER=disabled pnpm verify:benefit-redemption
DATABASE_URL='file:./prisma/wave0-verify.db' PAYMENT_PROVIDER=disabled pnpm verify:member-data-request-truth
```

Expected: 不再出现缺 `Order.refundedAmountCents` 列或缺 `RedemptionRecord` 表。

- [ ] 清理本任务临时数据库（只删本任务创建的 `wave0-verify.db*`，先 `ls` 确认文件名）：

```bash
rm -f prisma/wave0-verify.db prisma/wave0-verify.db-journal prisma/wave0-verify.db-wal prisma/wave0-verify.db-shm
```

- [ ] 验证 schema mirror：

```bash
pnpm db:pg:sync:check
```

Expected: SQLite/PostgreSQL schema 无漂移。

- [ ] 在可用的 PostgreSQL 16 + Redis 环境运行 CI `postgres-readiness` 对应命令；本地无实例则由 GitHub CI 提供正式证据，不伪造 PASS。
- [ ] 检查 `git status --short`，确认没有新 migration 和临时数据库被跟踪。

## Task 9: 同步正式文档与验收记录

**Files:**

- Modify: `docs/product/user-data-flow-matrix.md`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Create: `docs/acceptance/user-center-wave0-acceptance.md`

- [ ] 更新数据流矩阵，删除“建设中入口当前展示”的事实，记录这些能力为“不展示，未进入范围”。
- [ ] 在验收文档记录：分支/commit、SQLite 临时库命令、PG CI URL/commit、所有 verify 结果；不记录手机号、token、验证码、签名 URL。
- [ ] `current-progress.md` 只在所有本波门禁通过后写“Wave 0 完成”；PG 未通过时写“代码完成，生产数据库门禁待通过”。
- [ ] `next-tasks.md` 把下一步切到 Wave 1 account-security，不提前写数据导出/注销已完成。
- [ ] Commit：

```bash
git add docs/product/user-data-flow-matrix.md docs/progress/current-progress.md docs/progress/next-tasks.md docs/acceptance/user-center-wave0-acceptance.md
git commit -m "docs: record user center wave0 acceptance"
```

## Task 10: 全量验证与双模型复审

- [ ] 运行本波最小完整套件：

```bash
pnpm --filter @ai-job-print/kiosk verify:user-center-wave0
pnpm --filter @ai-job-print/kiosk verify:qr-login-ui
pnpm --filter @ai-job-print/kiosk verify:profile-inkpaper-home
pnpm --filter @ai-job-print/kiosk verify:lightflow-profile-entry
pnpm --filter @ai-job-print/kiosk verify:lightflow-4188-layout-parity
pnpm --filter @ai-job-print/kiosk verify:profile-commercial-first-batch
pnpm --filter @ai-job-print/kiosk verify:member-session-closure
pnpm --filter @ai-job-print/kiosk typecheck
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:member-data-request-truth
PAYMENT_PROVIDER=disabled pnpm --filter @ai-job-print/api verify:job-ai-privacy
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api db:pg:sync:check
git diff --check origin/main...HEAD
```

- [ ] 运行 Kiosk/Admin/API 生产 build；若因无关基线失败，记录原始命令、错误和与本 diff 的关系，不改范围外代码。
- [ ] 并行调用 Claude + Antigravity reviewer，重点审查：无效入口是否彻底删除、状态转换是否仍可伪造完成、迁移是否重复、合规文案是否回退。
- [ ] 修复所有 Critical/High 后重跑完整套件和双模型复审。
- [ ] 更新 CCG `review.md`，归档任务；只显式暂存本任务文件。

## Wave 0 完成定义

- `/profile` 没有重复权益活动、身份切换、扫码凭证/套餐建设中卡片。
- `/login` 只显示真实手机号和扫码方式。
- `/me/settings` 口径真实，仍保留可用的切换账号和退出登录。
- 当前 QR 实现与静态守卫一致。
- `export/delete` 不能通过 Admin/API 产生虚假 `completed` 或完成审计。
- SQLite 正式 migration 重放与 PostgreSQL readiness 有同一提交证据。
- 没有新增 migration、入口、页面、服务、外部依赖或硬件改动。
