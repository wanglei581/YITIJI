# Partner Account Phone Transfer UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理员在机构账号管理中准确区分删除、普通换绑和单手机号安全转移，并在开始高风险验证前看到可执行的正确路径。

**Architecture:** 只修改 Admin 既有机构账号组件和静态专项门禁。账号列表通过当前 `accounts` 派生最后启用账号状态，提前阻止注定失败的删除；弹窗仅补充基于现有服务端方法枚举和动作类型的说明，不新增状态、API 或持久化。

**Tech Stack:** React 18、TypeScript、React Router、Tailwind CSS、Node.js 静态 verifier、现有 Vite/Admin 构建链

---

## File map

- `apps/admin/scripts/verify-partner-account-action-ui.mjs`：本任务的 RED→GREEN 静态交互合同。
- `apps/admin/src/routes/partners/PartnerAccountManager.tsx`：安全转移上下文入口、最后启用账号删除预判和就地原因。
- `apps/admin/src/routes/partners/PartnerAccountActionDialog.tsx`：`PHONE_TAKEN` 等跨步骤错误的可执行说明。
- `apps/admin/src/routes/partners/partner-account-action-steps/ActionCredentialSteps.tsx`：验证方式不可用原因及删除/普通换绑授权语义。
- `apps/admin/src/routes/partners/partner-account-action-steps/PhoneRebindSteps.tsx`：新手机号必须未占用及单手机号安全转移提示。
- `apps/admin/src/routes/partners/partner-account-action-steps/PartnerAccountDeleteConfirmationDialog.tsx`：最终删除不等于转移的二次确认。
- `docs/progress/current-progress.md`：完成后记录实际变更、验证结果和未改边界。
- `.ccg/tasks/clarify-partner-account-phone-transfer-ux/*`：任务阶段和审查记录；完成后按 CCG 规则归档。

### Task 1: Add failing UX contract

**Files:**
- Modify: `apps/admin/scripts/verify-partner-account-action-ui.mjs`
- Test: `apps/admin/scripts/verify-partner-account-action-ui.mjs`

- [ ] **Step 1: Add exact failing assertions**

在现有 manager/steps 断言之后增加以下合同：

```js
expectContains(manager, 'enabledAccountCount', '账号列表必须提前计算启用账号数量')
expectContains(manager, 'isLastEnabledAccount', '最后启用机构账号必须在前端提前识别')
expectContains(manager, 'account.enabled && enabledAccountCount <= 1', '只有最后一个启用账号需要提前禁用删除')
expectContains(manager, '前往账号设置安全转移', '单手机号场景必须提供现有安全转移入口')
expectContains(manager, 'to="/account-settings"', '安全转移入口必须指向既有账号设置页面')
expectContains(manager, '该账号是机构最后一个启用账号', '删除按钮禁用时必须就地解释原因')
expectContains(credentialSteps, '该账号密码由管理员创建或重置', '密码验证不可用时必须解释证明状态限制')
expectContains(credentialSteps, '不会自动绑定到管理员账号', '删除短信授权必须明确不执行手机号转移')
expectContains(credentialSteps, '还需要验证另一个未被占用的新手机号', '普通换绑授权必须明确新手机号要求')
expectContains(rebindSteps, '必须未被任何账号占用', '新手机号输入步骤必须解释唯一性要求')
expectContains(rebindSteps, '从机构账号安全转移手机号', '普通换绑页必须指向单手机号正确路径')
expectContains(steps, '删除账号不会把该手机号绑定到管理员账号', '最终删除确认必须再次区分删除与转移')
expectContains(dialog, '关闭当前弹窗，前往“账号设置”使用安全转移', '手机号占用错误必须给出安全转移下一步')
```

- [ ] **Step 2: Run the verifier and confirm RED**

Run:

```bash
pnpm --filter @ai-job-print/admin verify:partner-account-action-ui
```

Expected: exit 1；新增断言报告缺少安全转移入口、最后启用账号预判和说明文案，既有安全合同仍继续执行。

- [ ] **Step 3: Commit the RED contract**

```bash
git add apps/admin/scripts/verify-partner-account-action-ui.mjs
git commit -m "test: require clear partner phone transfer guidance"
```

### Task 2: Guide users before account actions

**Files:**
- Modify: `apps/admin/src/routes/partners/PartnerAccountManager.tsx`
- Test: `apps/admin/scripts/verify-partner-account-action-ui.mjs`

- [ ] **Step 1: Import the existing router link**

在 React import 后加入：

```tsx
import { Link } from 'react-router-dom'
```

- [ ] **Step 2: Derive the enabled-account count once**

在 `securityActionOpen` 后增加：

```tsx
const enabledAccountCount = accounts.filter((account) => account.enabled).length
```

该值只来自已经加载的当前机构账号，不新增请求。

- [ ] **Step 3: Add the single-phone guidance next to the account heading**

在账号区标题之后、错误提示之前增加：

```tsx
<div className="rounded-lg border border-primary-100 bg-primary-50 px-3 py-2 text-xs leading-5 text-primary-800">
  <p>只有一个手机号，且希望绑定到管理员账号？请勿删除机构账号或使用普通换绑。</p>
  <p className="mt-1">
    <Link to="/account-settings" className="font-medium text-primary-700 underline underline-offset-2">
      前往账号设置安全转移
    </Link>
    <span>；转移后机构账号仍可使用用户名和密码登录。</span>
  </p>
</div>
```

- [ ] **Step 4: Prevent the last enabled account from entering delete**

在 `accounts.map` 内派生：

```tsx
const isLastEnabledAccount = account.enabled && enabledAccountCount <= 1
```

删除按钮的 `disabled` 条件增加 `isLastEnabledAccount`，但普通换绑、重置密码和停用逻辑保持不变：

```tsx
disabled={accountBusy !== null || securityActionOpen || actionsUnavailable || isLastEnabledAccount}
```

账号行尾增加就地说明：

```tsx
{isLastEnabledAccount && (
  <p className="basis-full rounded-lg bg-warning-bg px-3 py-2 text-xs leading-5 text-warning-fg">
    该账号是机构最后一个启用账号，不能删除。请先创建并启用接替账号；如目的是把手机号绑定给管理员，请使用账号设置中的安全转移。
  </p>
)}
```

- [ ] **Step 5: Run the focused verifier**

Run:

```bash
pnpm --filter @ai-job-print/admin verify:partner-account-action-ui
```

Expected: Task 2 的 manager 断言通过；步骤弹窗相关断言仍失败，因此整体保持 RED。

- [ ] **Step 6: Commit the manager guidance**

```bash
git add apps/admin/src/routes/partners/PartnerAccountManager.tsx
git commit -m "fix: guide single-phone partner account actions"
```

### Task 3: Explain credential, deletion, and rebind semantics

**Files:**
- Modify: `apps/admin/src/routes/partners/PartnerAccountActionDialog.tsx`
- Modify: `apps/admin/src/routes/partners/partner-account-action-steps/ActionCredentialSteps.tsx`
- Modify: `apps/admin/src/routes/partners/partner-account-action-steps/PhoneRebindSteps.tsx`
- Modify: `apps/admin/src/routes/partners/partner-account-action-steps/PartnerAccountDeleteConfirmationDialog.tsx`
- Test: `apps/admin/scripts/verify-partner-account-action-ui.mjs`

- [ ] **Step 1: Explain why password verification is disabled**

在 `choose_method` 中复用现有 `methods`，于按钮网格之后增加：

```tsx
{!methods.includes('password') && (
  <p className="rounded-lg bg-warning-bg px-3 py-2 text-xs leading-5 text-warning-fg">
    该账号密码由管理员创建或重置，或尚未完成持有人证明，因此不能用于本次高风险操作。请使用账号已验证手机号；若手机号无法接收，只能先完成线下核验恢复。
  </p>
)}
```

按钮继续保持 disabled，不放宽服务端方法枚举。

- [ ] **Step 2: Clarify old-factor authorization**

在 `sms_verify` 的发码说明后，按 `state.action` 增加：

```tsx
<p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs leading-5 text-neutral-600">
  {state.action === 'delete_account'
    ? '本次验证只授权删除该机构账号；删除会释放手机号，但不会自动绑定到管理员账号。'
    : '本次验证只授权机构账号普通换绑；通过后还需要验证另一个未被占用的新手机号。'}
</p>
```

- [ ] **Step 3: Clarify the new-phone step**

在 `PhoneRebindSteps` 的旧因子已验证提示之后增加：

```tsx
<p className="rounded-lg bg-warning-bg px-3 py-2 text-xs leading-5 text-warning-fg">
  新手机号必须未被任何账号占用。本流程只更改机构账号绑定；如需把当前手机号绑定给管理员，请退出并在“账号设置”使用“从机构账号安全转移手机号”。
</p>
```

- [ ] **Step 4: Clarify the final delete confirmation**

在最终删除身份说明之后增加：

```tsx
<p className="mt-2 rounded-lg bg-error-bg px-3 py-2 text-xs leading-5 text-error-fg">
  删除账号不会把该手机号绑定到管理员账号。只有一个手机号时，请取消删除并前往账号设置使用安全转移。
</p>
```

- [ ] **Step 5: Make PHONE_TAKEN actionable**

将 `PartnerAccountActionDialog.tsx` 的错误文案改为：

```tsx
PHONE_TAKEN: '新手机号已被其他账号使用。若要把机构账号当前手机号绑定给管理员，请关闭当前弹窗，前往“账号设置”使用安全转移。',
```

- [ ] **Step 6: Run focused tests for GREEN**

Run:

```bash
pnpm --filter @ai-job-print/admin verify:partner-account-action-ui
pnpm --filter @ai-job-print/admin verify:admin-phone-transfer-ui
pnpm --filter @ai-job-print/admin exec tsx --test src/routes/partners/partnerAccountActionMachine.test.ts
```

Expected: all commands exit 0；安全操作专项合同、既有管理员安全转移合同和纯状态机测试全部通过。

- [ ] **Step 7: Commit the completed UX flow**

```bash
git add \
  apps/admin/src/routes/partners/PartnerAccountActionDialog.tsx \
  apps/admin/src/routes/partners/partner-account-action-steps/ActionCredentialSteps.tsx \
  apps/admin/src/routes/partners/partner-account-action-steps/PhoneRebindSteps.tsx \
  apps/admin/src/routes/partners/partner-account-action-steps/PartnerAccountDeleteConfirmationDialog.tsx
git commit -m "fix: clarify partner account security flows"
```

### Task 4: Verify and close project records

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `.ccg/tasks/clarify-partner-account-phone-transfer-ux/task.json`
- Create: `.ccg/tasks/clarify-partner-account-phone-transfer-ux/review.md`
- Move: `.ccg/tasks/clarify-partner-account-phone-transfer-ux/` to `.ccg/tasks/archive/2026-07/clarify-partner-account-phone-transfer-ux/`

- [ ] **Step 1: Run the full relevant verification set**

Run:

```bash
pnpm --filter @ai-job-print/admin verify:partner-account-action-ui
pnpm --filter @ai-job-print/admin verify:admin-phone-transfer-ui
pnpm --filter @ai-job-print/admin exec tsx --test src/routes/partners/partnerAccountActionMachine.test.ts
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/admin lint
VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/admin build
git diff --check
```

Expected: every command exits 0；lint has zero errors；production build emits Admin assets without TypeScript/Vite failure。

- [ ] **Step 2: Review the scoped diff**

Run:

```bash
git diff --stat HEAD~3
git diff HEAD~3 -- \
  apps/admin/src/routes/partners \
  apps/admin/scripts/verify-partner-account-action-ui.mjs \
  docs/progress/current-progress.md
```

Check: no backend、Prisma、短信、生产配置、Kiosk、Partner or Terminal Agent changes；no sensitive values、mock flow or new dependency。

- [ ] **Step 3: Record actual completion facts**

在 `docs/progress/current-progress.md` 顶部追加一条 2026-07-26 记录，必须包含：

- 只改 Admin 既有机构账号 UI；
- 安全转移入口、最后启用账号前置阻断、禁用密码原因、删除/换绑语义；
- 实际通过的验证命令；
- 未改后端安全规则、数据库、真实账号、短信与部署。

- [ ] **Step 4: Write review.md and archive the CCG task**

`review.md` 按 `Critical / Warning / Info` 记录审查结论和验证证据；更新 `task.json` 为 `completed` 后移动到：

```text
.ccg/tasks/archive/2026-07/clarify-partner-account-phone-transfer-ux/
```

- [ ] **Step 5: Commit closure records**

```bash
git add docs/progress/current-progress.md .ccg/tasks/
git commit -m "docs: record partner account UX clarification"
```

## Plan self-review

- Spec coverage: §4.1–4.5 分别由 Task 2–3 覆盖；§5 不新增敏感状态；§6 保留后端并发事实来源；§7–8 由 Task 1 和 Task 4 覆盖。
- Scope: 只涉及 Admin 现有 UI、静态 verifier 和正式进度记录；没有后端或数据库任务。
- Type consistency: `enabledAccountCount`、`isLastEnabledAccount` 和现有 `availableActionVerificationMethods` 均使用当前组件已有类型；无新 DTO。
- Placeholder scan: 无 TBD、TODO、模糊测试或未定义函数。
