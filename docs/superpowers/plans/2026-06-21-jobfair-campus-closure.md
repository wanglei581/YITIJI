# 招聘会与校园招聘闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不突破招聘平台合规红线的前提下，按独立分支补齐招聘会 / 校园招聘闭环的排序一致性、外部跳转记录和页面质量门禁。

**Architecture:** 保留现有 `apps/kiosk` + `services/api` + `packages/shared` 结构，不做物理目录迁移。先做低风险 Kiosk 列表接线，再做 activity target 模型扩展，最后做页面拆分；每个分支独立验证和审查。

**Tech Stack:** React + Vite + TypeScript + NestJS + Prisma + CCG verify scripts。

---

## 文件结构预算

本计划不允许一次性修改所有文件。每个任务必须单独分支、单独提交、单独验证。

禁止事项：

- 不新增招聘会入口或校园招聘重复入口。
- 不新增报名、签到、入场券、投递结果、预约结果、候选人管理。
- 不把 `FairCompany` 临时记成 `company_profile` 或 `job_fair`。
- 不在 `CampusPage.tsx` / `JobFairDetailPage.tsx` 继续堆新功能。

## Task 1：招聘会列表页本校优先接线

**Files:**

- Modify: `apps/kiosk/src/pages/job-fairs/JobFairsPage.tsx`

- [ ] **Step 1：创建独立分支**

```bash
git switch main
git pull --ff-only
git switch -c codex/jobfairs-list-terminal-priority
```

- [ ] **Step 2：确认现状**

Run:

```bash
nl -ba apps/kiosk/src/pages/job-fairs/JobFairsPage.tsx | sed -n '210,240p'
```

Expected:

- 页面当前只调用 `getJobFairs()`。
- 页面已有 `recordExternalJump(getToken(), 'job_fair', fair.id, 'external_appointment')`。

- [ ] **Step 3：最小接线**

Implementation intent:

```tsx
import { getJobFairs, getTerminalId } from '../../services/api'

useEffect(() => {
  let cancelled = false
  const terminalId = getTerminalId()
  setLoading(true)
  setError(false)
  getJobFairs(terminalId ? { terminalId } : undefined)
    .then((res) => { if (!cancelled) { setFairs(res.data); setLoading(false) } })
    .catch(() => { if (!cancelled) { setError(true); setLoading(false) } })
  return () => { cancelled = true }
}, [retryKey])
```

- [ ] **Step 4：验证**

Run:

```bash
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
pnpm --filter @ai-job-print/api verify:jobfair-campus-priority
```

Expected:

- Kiosk typecheck / lint 通过。
- 后端本校优先 verify 仍通过。

- [ ] **Step 5：审查与提交**

If diff exceeds 30 lines, run Claude + Antigravity review before commit.

```bash
git add apps/kiosk/src/pages/job-fairs/JobFairsPage.tsx
git commit -m "fix: prioritize local school fairs on kiosk list"
```

## Task 2：参展企业外部投递跳转记录

**Files:**

- Modify: `services/api/src/activity/activity.types.ts`
- Modify: `services/api/src/activity/activity.service.ts`
- Modify: `services/api/scripts/verify-activity-logs.ts`
- Modify: `apps/kiosk/src/services/api/activity.ts`
- Modify: `apps/kiosk/src/pages/job-fairs/FairCompanyDetailPage.tsx`
- Modify: `packages/shared/src/types/memberAssets.ts`

- [ ] **Step 1：创建独立分支**

```bash
git switch main
git pull --ff-only
git switch -c codex/fair-company-external-jump-logs
```

- [ ] **Step 2：先定 activity target 模型**

Required model:

```ts
export const ACTIVITY_TARGET_TYPES = ['job', 'job_fair', 'policy', 'company_profile', 'fair_company'] as const

export const JUMP_ACTION_BY_TARGET: Record<ActivityTargetType, ActivityJumpAction> = {
  job: 'external_apply',
  job_fair: 'external_appointment',
  policy: 'external_open',
  company_profile: 'external_open',
  fair_company: 'external_apply',
}
```

Do not allow `job_fair + external_apply`.

The backend target enum and `packages/shared/src/types/memberAssets.ts` must be updated together. Kiosk imports `ActivityTargetType` from shared, so treating shared as optional will fail typecheck when `fair_company` is used in the frontend.

- [ ] **Step 3：服务端快照读取**

Implementation intent:

```ts
if (targetType === 'fair_company') {
  const company = await this.prisma.fairCompany.findFirst({
    where: {
      id: targetId,
      jobFair: { reviewStatus: 'approved', publishStatus: 'published' },
    },
    select: {
      name: true,
      sourceUrl: true,
      jobFair: { select: { sourceName: true, sourceUrl: true, externalId: true } },
    },
  })
  return company && {
    targetTitle: company.name,
    sourceName: company.jobFair.sourceName,
    sourceUrl: company.sourceUrl ?? company.jobFair.sourceUrl,
    externalId: company.jobFair.externalId,
  }
}
```

- [ ] **Step 4：补 verify**

Extend `services/api/scripts/verify-activity-logs.ts` to cover:

- approved + published fair company can record `fair_company + external_apply`。
- pending / draft fair company cannot be recorded。
- `fair_company + external_appointment` is rejected。
- snapshot does not include resume / candidate / application result fields。

- [ ] **Step 5：前端接线**

Implementation intent:

```tsx
import { SourceUrlQr } from '../../components/SourceUrlQr'
import { recordExternalJump } from '../../services/api/activity'
import { useAuth } from '../../auth/useAuth'

const { getToken } = useAuth()

const openApplyQr = () => {
  recordExternalJump(getToken(), 'fair_company', company.id, 'external_apply')
  setShowQr(true)
}

const openSource = () => {
  recordExternalJump(getToken(), 'fair_company', company.id, 'external_apply')
  window.open(company.sourceUrl, '_blank', 'noopener')
}
```

QR must use:

```tsx
<SourceUrlQr value={company.sourceUrl} size={180} />
```

- [ ] **Step 6：验证**

Run:

```bash
pnpm --filter @ai-job-print/api verify:activity-logs
pnpm --filter @ai-job-print/api verify:jobfair-review
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
```

- [ ] **Step 7：双模型审查与提交**

Required:

- Claude + Antigravity review。
- Critical 必须修复后复审。

```bash
git add services/api/src/activity/activity.types.ts services/api/src/activity/activity.service.ts services/api/scripts/verify-activity-logs.ts apps/kiosk/src/services/api/activity.ts apps/kiosk/src/pages/job-fairs/FairCompanyDetailPage.tsx
git commit -m "feat: record fair company external jumps"
```

## Task 3：招聘会页面大文件拆分

**Files:**

- Modify: `apps/kiosk/src/pages/campus/CampusPage.tsx`
- Modify: `apps/kiosk/src/pages/job-fairs/JobFairDetailPage.tsx`
- Modify: `apps/kiosk/src/pages/job-fairs/FairCompanyDetailPage.tsx`
- Create: `apps/kiosk/src/pages/campus/components/*`
- Create: `apps/kiosk/src/pages/job-fairs/components/*`

- [ ] **Step 1：创建独立分支**

```bash
git switch main
git pull --ff-only
git switch -c codex/jobfair-pages-size-split
```

- [ ] **Step 2：确认行数基线**

Run:

```bash
wc -l apps/kiosk/src/pages/campus/CampusPage.tsx apps/kiosk/src/pages/job-fairs/JobFairDetailPage.tsx apps/kiosk/src/pages/job-fairs/FairCompanyDetailPage.tsx
```

Expected current baseline:

- `CampusPage.tsx` around 896 lines。
- `JobFairDetailPage.tsx` around 856 lines。
- `FairCompanyDetailPage.tsx` around 628 lines。

- [ ] **Step 3：拆分规则**

Move only existing code, preserve behavior:

- QR modal / overlay → component。
- Action bar → component。
- Tab panels → components。
- Constants and pure helpers → local `types.ts` / `utils.ts` where useful。

Do not change:

- Routes。
- API calls。
- Compliance copy。
- Button labels。
- External jump behavior。

- [ ] **Step 4：验证**

Run:

```bash
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/kiosk build
```

- [ ] **Step 5：双模型审查与提交**

Required:

- Claude + Antigravity review。
- Review must confirm zero behavior change and no new route / entry。

```bash
git add apps/kiosk/src/pages/campus apps/kiosk/src/pages/job-fairs
git commit -m "refactor: split kiosk job fair pages"
```

## Self-review

- Spec coverage：覆盖了列表排序一致性、参展企业外部跳转记录、页面大小门禁。
- Placeholder scan：无 `TBD` / `TODO`。
- Scope check：每个任务都可独立分支、独立验证、独立审查。
- Compliance check：没有平台内投递、报名、签到、候选人或企业招聘闭环。
