# Admin Billing Description Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-safe Admin `/billing` control that updates one price item's `description` without sending or changing `unitCents` or `active`.

**Architecture:** Keep the existing backend DTO, service, audit path, and Admin API client unchanged. Add a second, isolated editing state and save callback inside `PriceConfigSection`, then extend the existing static UI verify so the description-only payload and confirmation boundary fail closed before implementation.

**Tech Stack:** React 18, TypeScript, Vite, existing Admin API service, Node static verify script, pnpm.

---

## File map

- Modify `apps/admin/scripts/verify-admin-billing-ui.mjs`: RED/GREEN static contract for description-only editing.
- Modify `apps/admin/src/routes/billing/index.tsx`: independent description state, confirmation, save action, and table column.
- Modify `docs/progress/current-progress.md`: record local candidate and verification truth only.
- Modify `docs/progress/next-tasks.md`: replace the UI capability gap with deploy/production follow-up boundaries.
- Do not modify `apps/admin/src/services/api/adminBilling.ts`, backend DTO/service, Prisma, payment runtime, or production configuration; those contracts already support `description`.

### Task 1: Add the failing description-only UI contract

**Files:**
- Modify: `apps/admin/scripts/verify-admin-billing-ui.mjs`（在既有 page 校验之后追加，不替换任何原有校验）
- Test: `apps/admin/scripts/verify-admin-billing-ui.mjs`

- [ ] **Step 1: Add RED assertions for isolated state and payload**

After the existing page checks, add a scoped extraction and assertions equivalent to:

```js
const descriptionSaveBlock = page.match(/const saveDescription[\s\S]*?const toggleActive/)?.[0] ?? ''
const descriptionCatchBlock = descriptionSaveBlock.match(/catch \(e\) \{[\s\S]*?\} finally/)?.[0] ?? ''

if (page.includes('descriptionEditing') && page.includes('保存说明')) {
  pass('说明编辑使用独立状态和独立保存操作')
} else {
  fail('说明编辑不得复用单价状态或保存操作')
}

if (
  /updatePriceConfig\s*\(\s*item\.serviceKey\s*,\s*\{\s*description:\s*nextDescription\s*\}\s*\)/.test(descriptionSaveBlock) &&
  !descriptionSaveBlock.includes('unitCents') &&
  !descriptionSaveBlock.includes('active:')
) {
  pass('说明保存请求只提交 description')
} else {
  fail('说明保存请求必须只提交 description，不得携带单价或状态')
}

if (
  descriptionSaveBlock.includes('只更新说明，不修改单价与启停状态') &&
  descriptionSaveBlock.includes('记入审计')
) {
  pass('说明保存二次确认明确字段边界与审计')
} else {
  fail('说明保存确认缺少字段隔离或审计提示')
}

if (
  descriptionSaveBlock.includes('delete next[item.serviceKey]') &&
  descriptionSaveBlock.includes('await load()') &&
  descriptionSaveBlock.includes('setDescriptionEditing') &&
  descriptionSaveBlock.indexOf('await load()') < descriptionSaveBlock.indexOf('setDescriptionEditing')
) {
  pass('说明保存成功后先刷新再清理当前行状态')
} else {
  fail('说明保存成功后必须先刷新再清理当前行状态')
}

if (
  descriptionCatchBlock &&
  !descriptionCatchBlock.includes('setDescriptionEditing') &&
  !descriptionCatchBlock.includes('delete next[item.serviceKey]')
) {
  pass('说明保存失败时保留当前编辑值')
} else {
  fail('说明保存失败时不得清理当前编辑值')
}

if (page.includes('maxLength={200}') && descriptionSaveBlock.includes('nextDescription.length > 200')) {
  pass('说明长度在输入与保存边界均限制为 200 字符')
} else {
  fail('说明编辑缺少 200 字符双重边界')
}
```

- [ ] **Step 2: Run the focused verify and prove RED**

Run:

```bash
pnpm --filter @ai-job-print/admin verify:admin-billing-ui
```

Expected: non-zero exit with six new failures covering missing independent state, description-only payload, confirmation boundary, success cleanup order, failure preservation, and the 200-character boundary. Existing checks must remain PASS.

- [ ] **Step 3: Commit the RED guard**

```bash
git add apps/admin/scripts/verify-admin-billing-ui.mjs
git commit -m "test: guard admin billing description updates"
```

### Task 2: Implement the minimal isolated description editor

**Files:**
- Modify: `apps/admin/src/routes/billing/index.tsx:37-177`
- Test: `apps/admin/scripts/verify-admin-billing-ui.mjs`

- [ ] **Step 1: Add independent description state**

Immediately beside the existing `editing` state, add:

```tsx
const [descriptionEditing, setDescriptionEditing] = useState<Record<string, string>>({})
```

- [ ] **Step 2: Add the description-only save callback**

Insert the callback between `savePrice` and `toggleActive`. `saveDescription` must remain defined before `toggleActive` because the static verify intentionally scopes that exact block:

```tsx
const saveDescription = useCallback(
  async (item: AdminPriceConfigItem) => {
    const nextDescription = descriptionEditing[item.serviceKey]
    const currentDescription = item.description ?? ''
    if (nextDescription === undefined || nextDescription === currentDescription) return
    if (nextDescription.length > 200) {
      setError('价目说明不能超过 200 个字符')
      return
    }
    const oldLabel = currentDescription || '（空）'
    const newLabel = nextDescription || '（空）'
    if (!window.confirm(
      `确认更新「${SERVICE_LABELS[item.serviceKey] ?? item.serviceKey}」说明？\n旧说明：${oldLabel}\n新说明：${newLabel}\n只更新说明，不修改单价与启停状态，操作记入审计。`,
    )) return
    setSaving(item.serviceKey)
    setError(null)
    try {
      await adminBillingService.updatePriceConfig(item.serviceKey, { description: nextDescription })
      await load()
      setDescriptionEditing((prev) => {
        const next = { ...prev }
        delete next[item.serviceKey]
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '说明更新失败')
    } finally {
      setSaving(null)
    }
  },
  [descriptionEditing, load],
)
```

- [ ] **Step 3: Add the description column and independent action**

Insert `<th className="px-5 py-3">说明</th>` immediately after the existing `单价（元）` header. Insert the corresponding description `<td>` immediately after the existing unit-price `<td>` so header and body both have six columns. In each row derive:

```tsx
const descriptionEditVal = descriptionEditing[item.serviceKey]
const currentDescription = item.description ?? ''
const descriptionChanged = descriptionEditVal !== undefined && descriptionEditVal !== currentDescription
```

Render a controlled input in the new cell:

```tsx
<input
  type="text"
  maxLength={200}
  aria-label={`${SERVICE_LABELS[item.serviceKey] ?? item.serviceKey}说明`}
  value={descriptionEditVal ?? currentDescription}
  disabled={busy}
  onChange={(e) => setDescriptionEditing((prev) => ({ ...prev, [item.serviceKey]: e.target.value }))}
  className="w-full min-w-72 rounded-md border border-neutral-200 px-2 py-1 text-sm"
/>
```

Render the independent action before the existing price/toggle actions:

```tsx
{descriptionChanged && (
  <button
    onClick={() => void saveDescription(item)}
    disabled={busy}
    className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
  >
    <CheckIcon className="h-3.5 w-3.5" /> 保存说明
  </button>
)}
```

- [ ] **Step 4: Run GREEN verification**

Run:

```bash
pnpm --filter @ai-job-print/admin verify:admin-billing-ui
pnpm --filter @ai-job-print/admin typecheck
```

Expected: `verify:admin-billing-ui` reports `ALL PASS`; Admin TypeScript exits 0.

- [ ] **Step 5: Commit the implementation**

```bash
git add apps/admin/src/routes/billing/index.tsx
git commit -m "feat(admin): edit billing descriptions independently"
```

### Task 3: Run regression gates and record truthful status

**Files:**
- Modify: `docs/progress/current-progress.md:3`
- Modify: `docs/progress/next-tasks.md:53`

- [ ] **Step 1: Run all scoped validation**

```bash
pnpm --filter @ai-job-print/admin verify:admin-billing-ui
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/admin lint
git diff --check
```

Expected: all commands exit 0; lint has no new errors.

- [ ] **Step 2: Update progress truth**

Prepend this fact pattern to `current-progress.md`, using the final command results rather than stronger claims: “2026-07-15 完成 Admin 价目说明独立编辑本地候选：每行说明状态与单价状态隔离，保存请求仅提交 description，二次确认明确不修改单价与启停状态并记审计；静态门禁、Admin typecheck 与 lint 通过。未 push、未创建 PR、未运行 CI、未部署，生产两条旧说明仍未修改。”

Update the existing `FREE_MODE 价目说明文案诚实化` item in `next-tasks.md` to state: “Admin 说明独立编辑候选已在本地完成并通过门禁；下一步为 review / PR / CI，部署仍需明确授权；部署后再经独立生产授权更新两条 description，保持 0 元和 active，不重复建单或出纸。”

- [ ] **Step 3: Commit documentation truth**

```bash
git add docs/progress/current-progress.md docs/progress/next-tasks.md
git commit -m "docs: record billing description editor candidate"
```

### Task 4: Complete dual-model security review and CCG archive

**Files:**
- Modify: `.ccg/tasks/update-free-mode-price-descriptions/review.md`
- Move: `.ccg/tasks/update-free-mode-price-descriptions/` to `.ccg/tasks/archive/2026-07/`

- [ ] **Step 1: Run Antigravity and Claude reviewers in parallel**

Both reviewers must inspect the full branch diff and specifically verify:

- description save sends only `{ description }`;
- price and active state cannot be changed by that action;
- confirmation is truthful and audit-backed;
- empty string and 200-character boundary are handled;
- failed saves preserve the edited value;
- no credentials, production writes, deploys, or unrelated changes exist.

Expected: Critical 0 and Warning 0 from both models. Any Critical or Warning is fixed and both reviewers rerun.

- [ ] **Step 2: Perform final repository verification**

```bash
git diff --check
git status --short --branch
git log -5 --oneline --decorate
```

Expected: only intended task/archive files remain before the final archive commit; no production artifacts or secrets are present.

- [ ] **Step 3: Archive and commit the CCG task**

Record the two review verdicts in `review.md`, set `task.json` to completed, move the task to `.ccg/tasks/archive/2026-07/`, then stage only that archive path:

```bash
git add -f .ccg/tasks/archive/2026-07/update-free-mode-price-descriptions/
git commit -m "chore: archive ccg task update-free-mode-price-descriptions"
```

Do not push, open a PR, deploy, or modify production in this plan.
