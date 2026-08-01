# AI Contract Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有百宝箱候选入口下交付一个默认关闭、境内模型限定、会话级留存的“AI 签约风险提示”完整闭环。

**Architecture:** 新建独立 `contract-review` 领域模块和 `ContractReviewTask` 聚合，复用 FileObject、OCR、BullMQ、Audit、法律文档与打印基础设施。处理管线固定为逐页提取 → 规则检查 → 境内 LLM → ContractReviewSafetyGate → 原子落库；Kiosk 只通过任务状态和结构化结果交互，不接触未校验模型输出。

**Tech Stack:** TypeScript、NestJS、Prisma（SQLite + PostgreSQL）、Redis/BullMQ、百度 OCR、Node `test`、React/Vite、Playwright、PDFKit、pnpm monorepo。

---

## 执行前约束

- 从干净 `main` 创建 `codex/contract-review-p0` 独立 worktree；不得在当前上线收口分支直接实现。
- Gate 0 未签字前允许完成契约、纯函数、假 provider 测试和生产默认关闭 UI；不得向真实合同调用 OCR/LLM，不得启用生产入口。
- 每个任务坚持 RED → GREEN → REFACTOR；失败时修实现，不通过放宽断言掩盖问题。
- 仅合同专用环境变量可以选择 provider；不得给 `LlmConfigService` 增加 `contract_review` feature key。
- 所有提交只包含当前任务列出的文件；保留用户工作树中的其他改动。
- 计划按三个串行交付波次执行，每个波次都是独立 implementation slice，必须使用独立分支/PR、独立验收和停线：Wave A（Task 1–6，基础契约与归属，预计 38–40 个文件）、Wave B（Task 7–12，AI 管线与 API，预计 24–28 个文件）、Wave C（Task 13–14，Kiosk、报告与发布，预计 20–24 个文件）。前一波通过全部门禁后才能开始下一波。
- 设计中的 32–40 个文件预算按单个波次核算；本总计划列出的总文件数还包含三波各自的测试、静态 verifier 和迁移文件。执行时不得跨波次顺手修改，也不得新增本计划以外的文件；若单波预计超出预算，先停线回到方案审查。

## 文件责任图

| 责任 | 文件 |
| --- | --- |
| 共享 API 契约 | `packages/shared/src/types/contractReview.ts` |
| 文件用途与短期留存 | `packages/shared/src/types/file.ts`、`services/api/src/files/*` |
| 双库任务聚合 | 两套 `schema.prisma` 与同名 additive migration |
| 归属、状态机和编排 | `services/api/src/contract-review/contract-review.service.ts` |
| 逐页 canonical text | `contract-review-extraction.service.ts`、`canonical-text.ts` |
| 规则包 | `contract-review.rules.ts`、`contract-review-rule-engine.ts` |
| 境内模型与脱敏 | `contract-review-provider.service.ts`、`contract-review-pii-masker.ts` |
| 输出放行 | `contract-review-safety-gate.service.ts` |
| 异步与清理 | `contract-review.queue.ts`、`contract-review.processor.ts`、`contract-review.cleanup.task.ts` |
| HTTP 边界 | `contract-review.controller.ts`、`dto/contract-review.dto.ts` |
| Kiosk 易失会话与 API | `contractReviewSession.ts`、`services/api/contractReview.ts` |
| 五步竖屏流程 | `apps/kiosk/src/pages/toolbox/contract-review/*` |
| 报告与打印 | `contract-review-pdf.service.ts` 与既有打印 URL 链路 |
| 静态/集成/E2E 门禁 | `verify-contract-review*.ts|mjs`、Playwright spec |

## Wave A：合规、契约、数据和归属

### Task 1: 冻结 Gate 0 与默认关闭策略

**Files:**
- Create: `docs/compliance/contract-review-release-gate.md`
- Create: `services/api/scripts/verify-contract-review-gate0.ts`
- Modify: `services/api/package.json`
- Test: `services/api/scripts/verify-contract-review-gate0.ts`

- [ ] **Step 1: 写入会失败的 Gate 0 验证脚本**

```typescript
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../../..')
const gate = readFileSync(resolve(root, 'docs/compliance/contract-review-release-gate.md'), 'utf8')
for (const marker of [
  'provider_allowlist:',
  'algorithm_filing:',
  'generative_ai_security_assessment:',
  'aigc_visible_label:',
  'aigc_metadata_label:',
  'legal_gold_set:',
]) assert.ok(gate.includes(marker), `缺少 Gate 0 字段: ${marker}`)
assert.match(gate, /status: (blocked|approved)/)
assert.ok(gate.includes('production_default: false'))
if (gate.includes('status: approved')) {
  for (const key of ['provider_allowlist', 'algorithm_filing', 'generative_ai_security_assessment',
    'aigc_visible_label', 'aigc_metadata_label', 'legal_gold_set']) {
    assert.ok(gate.includes(`${key}: approved`), `总体 approved 但 ${key} 未 approved`)
  }
  assert.doesNotMatch(gate, /approved_by: \[\]/)
}
console.log('contract review Gate 0 static contract passed')
```

- [ ] **Step 2: 运行脚本并确认因文件不存在而失败**

Run: `pnpm --filter @ai-job-print/api exec node -r @swc-node/register scripts/verify-contract-review-gate0.ts`

Expected: FAIL，错误包含 `contract-review-release-gate.md`。

- [ ] **Step 3: 创建明确阻断状态的合规门禁文档并接入命令**

```markdown
---
status: blocked
production_default: false
provider_allowlist: pending
algorithm_filing: pending
generative_ai_security_assessment: pending
aigc_visible_label: pending
aigc_metadata_label: pending
legal_gold_set: pending
approved_by: []
approved_at: null
---

# 合同审查上线门禁

任一字段未由法务、隐私或安全责任人签字改为 approved 时，真实合同调用和生产入口保持关闭。
```

在 `services/api/package.json` 增加：

```json
"verify:contract-review:gate0": "node -r @swc-node/register scripts/verify-contract-review-gate0.ts"
```

- [ ] **Step 4: 运行静态门禁**

Run: `pnpm --filter @ai-job-print/api verify:contract-review:gate0`

Expected: PASS；注意这只证明门禁字段完整，不代表 Gate 0 已批准。

- [ ] **Step 5: 提交**

```bash
git add docs/compliance/contract-review-release-gate.md services/api/scripts/verify-contract-review-gate0.ts services/api/package.json
git commit -m "docs: define contract review release gates"
```

### Task 2: 建立共享契约与状态机

**Files:**
- Create: `packages/shared/src/types/contractReview.ts`
- Create: `services/api/scripts/verify-contract-review-contract.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/types/file.ts`
- Modify: `packages/shared/src/types/uploadSession.ts`
- Modify: `packages/shared/src/types/scanTask.ts`
- Modify: `services/api/package.json`
- Test: `services/api/scripts/verify-contract-review-contract.ts`

- [ ] **Step 1: 写契约验证的失败断言**

```typescript
import assert from 'node:assert/strict'
import type { ContractReviewFinding, ContractReviewTaskView } from '../../../packages/shared/src/types/contractReview'

const finding: ContractReviewFinding = {
  id: 'f-1', category: 'probation', priority: 'priority_check', title: '核实试用期',
  evidence: { pageNumber: 1, excerpt: '试用期六个月', charStart: 20, charEnd: 26 },
  explanation: '需结合合同期限核实', basisRef: 'labor-contract-law:19',
  verificationQuestion: '合同期限与试用期分别是多少？', uncertainty: '', source: 'rule_and_ai',
}
const view: ContractReviewTaskView = {
  id: 'task-1', status: 'completed', contractType: 'labor_contract', analyzedPages: 1,
  totalPages: 1, truncated: false, ocrConfidence: 'high', expiresAt: '2026-08-01T12:00:00.000Z',
  progress: { stage: 'completed', completedPages: 1, totalPages: 1 },
  result: { priorityCheckCount: 1, attentionCount: 0, insufficientInfoCount: 0,
    coverage: 'complete', ocrConfidence: 'high', disclaimerVersion: 'contract-review-v1',
    rulePackVersion: 'cn-labor-p0-v1', generatedByAi: true, findings: [finding] },
}
assert.equal(view.result?.findings[0]?.evidence.excerpt, '试用期六个月')
```

- [ ] **Step 2: 运行并确认模块不存在**

Run: `pnpm --filter @ai-job-print/api exec node -r @swc-node/register scripts/verify-contract-review-contract.ts`

Expected: FAIL，错误包含 `Cannot find module ... contractReview`。

- [ ] **Step 3: 实现唯一共享契约**

```typescript
export const CONTRACT_REVIEW_STATUSES = [
  'uploaded', 'queued', 'extracting', 'awaiting_confirmation', 'rule_checking',
  'ai_analyzing', 'safety_reviewing', 'completed', 'failed', 'cancelled', 'expired',
] as const
export type ContractReviewStatus = (typeof CONTRACT_REVIEW_STATUSES)[number]
export type ContractType = 'labor_contract' | 'internship_agreement' | 'non_compete' | 'offer'
export type ContractReviewPriority = 'priority_check' | 'attention' | 'insufficient_info'
export type ContractReviewCategory =
  | 'parties' | 'term' | 'probation' | 'compensation' | 'position_location'
  | 'working_time' | 'social_insurance' | 'training_service' | 'penalty'
  | 'non_compete' | 'deposit_documents' | 'termination' | 'imbalance' | 'offer_conditions'

export interface ContractReviewFinding {
  id: string
  category: ContractReviewCategory
  priority: ContractReviewPriority
  title: string
  evidence: { pageNumber: number | null; excerpt: string; charStart: number | null; charEnd: number | null }
  explanation: string
  basisRef: string | null
  verificationQuestion: string
  uncertainty: string
  source: 'rule' | 'ai' | 'rule_and_ai'
}
export interface ContractReviewResult {
  priorityCheckCount: number
  attentionCount: number
  insufficientInfoCount: number
  coverage: 'complete' | 'truncated'
  ocrConfidence: 'high' | 'medium' | 'low'
  disclaimerVersion: string
  rulePackVersion: string
  generatedByAi: true
  findings: ContractReviewFinding[]
}
export interface ContractReviewTaskView {
  id: string
  status: ContractReviewStatus
  contractType: ContractType
  analyzedPages: number
  totalPages: number | null
  truncated: boolean
  ocrConfidence: 'high' | 'medium' | 'low' | null
  expiresAt: string
  progress: { stage: ContractReviewStatus; completedPages: number; totalPages: number | null }
  result: ContractReviewResult | null
}
```

同时给 `FilePurpose` 增加 `'contract_upload'`，给 `ScanType` 增加 `'contract'`，给 UploadSession 请求允许该 purpose，并从 `packages/shared/src/index.ts` 导出新类型。

- [ ] **Step 4: 运行契约验证和 shared typecheck**

Run: `pnpm --filter @ai-job-print/api exec node -r @swc-node/register scripts/verify-contract-review-contract.ts && pnpm --filter @ai-job-print/shared typecheck`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src services/api/scripts/verify-contract-review-contract.ts services/api/package.json
git commit -m "feat: add contract review shared contracts"
```

### Task 3: 新增双库 ContractReviewTask 聚合

**Files:**
- Modify: `services/api/prisma/schema.prisma`
- Generated by `db:pg:sync`: `services/api/prisma/postgres/schema.prisma`
- Create: `services/api/prisma/migrations/20260801090000_add_contract_review_task/migration.sql`
- Create: `services/api/prisma/postgres/migrations/20260801090000_add_contract_review_task/migration.sql`
- Create: `services/api/src/contract-review/__tests__/contract-review-schema.test.ts`
- Test: `services/api/src/contract-review/__tests__/contract-review-schema.test.ts`

- [ ] **Step 1: 写双库模型与索引失败测试**

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../../../..')
for (const rel of ['prisma/schema.prisma', 'prisma/postgres/schema.prisma']) {
  const schema = readFileSync(resolve(root, rel), 'utf8')
  test(`${rel} contains contract task indexes`, () => {
    assert.match(schema, /model ContractReviewTask \{/)
    for (const marker of ['@@index([endUserId, createdAt])', '@@index([accessTokenHash])',
      '@@index([status, updatedAt])', '@@index([expiresAt])', '@@index([sourceFileId])']) {
      assert.ok(schema.includes(marker), `${rel} missing ${marker}`)
    }
  })
}
```

- [ ] **Step 2: 运行并确认模型缺失**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register src/contract-review/__tests__/contract-review-schema.test.ts`

Expected: FAIL，断言缺少 `ContractReviewTask`。

- [ ] **Step 3: 只在 SQLite SSOT schema 写入应用层 string enum 模型**

```prisma
model ContractReviewTask {
  id              String    @id @default(cuid())
  endUserId       String?
  endUser         EndUser?  @relation(fields: [endUserId], references: [id], onDelete: SetNull)
  accessTokenHash String?
  sourceFileId    String
  resultFileId    String?
  contractType    String
  status          String    @default("uploaded")
  consentVersion  String
  consentedAt     DateTime
  consentScopeHash String
  disclaimerVersion String
  rulePackVersion String
  schemaVersion   String
  ocrProvider     String?
  ocrConfidence   String?
  analyzedPages   Int       @default(0)
  totalPages      Int?
  truncated       Boolean   @default(false)
  professionalConsultationRecommended Boolean @default(false)
  aiProvider      String?
  aiModel         String?
  resultJson      String?
  errorCode       String?
  errorMessage    String?
  expiresAt       DateTime
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([endUserId, createdAt])
  @@index([accessTokenHash])
  @@index([status, updatedAt])
  @@index([expiresAt])
  @@index([sourceFileId])
}
```

给 SQLite SSOT 的 `EndUser` 增加 `contractReviewTasks ContractReviewTask[]`；随后运行 `pnpm --filter @ai-job-print/api db:pg:sync` 生成 PostgreSQL schema，禁止手工维护第二份模型。两套 migration 只做 additive create table/index，不修改既有列和数据。

- [ ] **Step 4: 生成客户端并执行双库检查**

Run: `pnpm --filter @ai-job-print/api db:pg:sync && pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register src/contract-review/__tests__/contract-review-schema.test.ts && pnpm --filter @ai-job-print/api db:pg:sync:check && pnpm --filter @ai-job-print/api typecheck`

Expected: 两套 schema 测试 PASS、sync check PASS、typecheck PASS。

- [ ] **Step 5: 提交**

```bash
git add services/api/prisma services/api/src/contract-review/__tests__/contract-review-schema.test.ts
git commit -m "feat: add contract review task schema"
```

### Task 4: 打通 contract_upload 短期文件链路

**Files:**
- Modify: `services/api/src/files/file.types.ts`
- Modify: `services/api/src/files/file-validation.ts`
- Modify: `services/api/src/files/retention-policy.ts`
- Modify: `services/api/src/files/files.service.ts`
- Modify: `services/api/src/files/dto/kiosk-upload-options.dto.ts`
- Modify: `services/api/src/upload-sessions/upload-sessions.dto.ts`
- Modify: `services/api/src/upload-sessions/upload-sessions.service.ts`
- Modify: `services/api/src/storage/object-key.ts`
- Modify: `services/api/src/scan-tasks/dto/create-scan-task.dto.ts`
- Modify: `services/api/src/scan-tasks/scan-tasks.service.ts`
- Modify: `services/api/src/member-assets/member-assets.service.ts`
- Test: `services/api/src/contract-review/__tests__/contract-review-file-policy.test.ts`
- Test: `services/api/scripts/verify-upload-sessions.ts`
- Test: `services/api/scripts/verify-scan-tasks.ts`

- [ ] **Step 1: 写两小时锁定、不可进“我的文档”的失败测试**

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { allowedPoliciesForFile, defaultRetentionForUpload } from '../../files/retention-policy'

test('contract upload is locked to a two-hour system session', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const result = defaultRetentionForUpload({ purpose: 'contract_upload', sensitiveLevel: 'highly_sensitive', ownerType: 'user', endUserId: 'u1', now })
  assert.equal(result.retentionPolicy, 'system_short')
  assert.equal(result.expiresAt?.toISOString(), '2026-08-01T02:00:00.000Z')
  assert.deepEqual(allowedPoliciesForFile({ purpose: 'contract_upload', assetCategory: 'original' }), ['system_short'])
})
```

- [ ] **Step 2: 运行并确认当前仍按一小时或会员 90 天处理**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register src/contract-review/__tests__/contract-review-file-policy.test.ts`

Expected: FAIL，实际过期时间不是两小时。

- [ ] **Step 3: 实现 purpose-specific 决策并贯通三条入口**

```typescript
const CONTRACT_REVIEW_TTL_MS = 2 * 60 * 60 * 1000

export function defaultRetentionForUpload(input: RetentionUploadInput): RetentionDecision {
  const now = input.now ?? new Date()
  if (input.purpose === 'contract_upload') {
    return {
      expiresAt: new Date(now.getTime() + CONTRACT_REVIEW_TTL_MS),
      retentionPolicy: 'system_short', retentionSetBy: 'system',
      retentionConsentAt: null, retentionConsentVersion: null,
    }
  }
  // 保留既有分支原样
}
```

同时完成以下精确变更：

- `FilesService.upload()` 对 `contract_upload` 强制 `highly_sensitive/private/system_short`，写入 `retentionLockedReason='contract_review_session_only'`，忽略客户端 sensitiveLevel。
- `PURPOSE_FOLDER.contract_upload = { scope: 'user', folder: 'contract-reviews' }`；匿名无 owner 时仍回退 `tmp/uploads`。
- Kiosk multipart、UploadSession purpose 白名单加入 `contract_upload`；会员绑定时沿用两小时决策，不转 90 天。
- ScanType 加 `contract`，`SCAN_TYPE_TO_PURPOSE.contract='contract_upload'`。
- 会员资产查询改为 `purpose: { notIn: ['signature_image', 'contract_upload'] }`，并排除 `retentionLockedReason='contract_review_session_only'`；这样后续 `purpose=print_doc` 的短期派生报告也不会进入“我的文档”。

- [ ] **Step 4: 运行文件、扫码上传和扫描回归**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register src/contract-review/__tests__/contract-review-file-policy.test.ts && pnpm --filter @ai-job-print/api verify:file-retention && pnpm --filter @ai-job-print/api verify:upload-sessions && pnpm --filter @ai-job-print/api verify:scan-tasks`

Expected: 全部 PASS；既有 resume/print/signature 行为不变。

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/types/file.ts packages/shared/src/types/uploadSession.ts packages/shared/src/types/scanTask.ts services/api/src/files services/api/src/upload-sessions services/api/src/storage/object-key.ts services/api/src/scan-tasks services/api/src/member-assets/member-assets.service.ts services/api/src/contract-review/__tests__/contract-review-file-policy.test.ts
git commit -m "feat: add short-lived contract upload lifecycle"
```

### Task 5: 版本化免责声明与独立同意

**Files:**
- Modify: `packages/shared/src/types/legalDocs.ts`
- Modify: `packages/shared/src/types/member-privacy.ts`
- Modify: `services/api/src/legal/legal.service.ts`
- Modify: `services/api/src/member-privacy/member-privacy.types.ts`
- Modify: `services/api/src/member-privacy/member-privacy.service.ts`
- Modify: `services/api/scripts/verify-legal-doc-version.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-consent.test.ts`

- [ ] **Step 1: 写 scope/version 和撤回收敛失败测试**

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { consentVersionForScope } from '../../member-privacy/member-privacy.service'

test('contract review has an isolated consent version', () => {
  assert.equal(consentVersionForScope('contract_review'), 'contract-review-consent-v1')
  assert.notEqual(consentVersionForScope('contract_review'), consentVersionForScope('job_ai'))
})
```

- [ ] **Step 2: 运行并确认新 scope 不存在**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register src/contract-review/__tests__/contract-review-consent.test.ts`

Expected: FAIL，缺少 `consentVersionForScope` 或 scope 类型错误。

- [ ] **Step 3: 实现版本映射与撤回事务**

```typescript
export type MemberAiConsentScope = 'job_ai' | 'contract_review'
export const CONSENT_VERSION_BY_SCOPE: Record<MemberAiConsentScope, string> = {
  job_ai: '20260701',
  contract_review: 'contract-review-consent-v1',
}
export function consentVersionForScope(scope: MemberAiConsentScope): string {
  return CONSENT_VERSION_BY_SCOPE[scope]
}
```

`getConsentStatus()` 返回两个 scope；`grantConsent/requireActiveConsent` 使用映射版本。撤回 `contract_review` 时同一事务把该会员所有处理中任务 CAS 到 `cancelled`。`LEGAL_DOC_TYPES` 增加 `contract_review_disclaimer`，但不激活任何草稿。

- [ ] **Step 4: 运行同意与法律文档回归**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register src/contract-review/__tests__/contract-review-consent.test.ts && pnpm --filter @ai-job-print/api verify:legal-doc-version && pnpm --filter @ai-job-print/api verify:member-data-request-contract`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/types/legalDocs.ts packages/shared/src/types/member-privacy.ts services/api/src/legal services/api/src/member-privacy services/api/scripts/verify-legal-doc-version.ts services/api/src/contract-review/__tests__/contract-review-consent.test.ts
git commit -m "feat: add contract review consent and disclaimer"
```

### Task 6: 实现归属、匿名令牌与状态机核心

**Files:**
- Create: `services/api/src/contract-review/contract-review.types.ts`
- Create: `services/api/src/contract-review/contract-review-access.ts`
- Create: `services/api/src/contract-review/contract-review-state.ts`
- Create: `services/api/src/contract-review/contract-review.service.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-service.test.ts`

- [ ] **Step 1: 写匿名/会员 XOR 与非法转换失败测试**

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertOwnerShape, assertTransition } from '../contract-review-state'

test('task owner is exactly member or anonymous token', () => {
  assert.doesNotThrow(() => assertOwnerShape({ endUserId: 'u1', accessTokenHash: null }))
  assert.doesNotThrow(() => assertOwnerShape({ endUserId: null, accessTokenHash: 'a'.repeat(64) }))
  assert.throws(() => assertOwnerShape({ endUserId: 'u1', accessTokenHash: 'a'.repeat(64) }))
})
test('completed cannot return to processing', () => {
  assert.throws(() => assertTransition('completed', 'ai_analyzing'))
})
```

- [ ] **Step 2: 运行并确认核心文件不存在**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register src/contract-review/__tests__/contract-review-service.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现纯函数与一次性令牌**

```typescript
export const ALLOWED_TRANSITIONS: Record<ContractReviewStatus, readonly ContractReviewStatus[]> = {
  uploaded: ['queued', 'cancelled', 'expired'],
  queued: ['extracting', 'cancelled', 'failed', 'expired'],
  extracting: ['awaiting_confirmation', 'failed', 'cancelled', 'expired'],
  awaiting_confirmation: ['rule_checking', 'cancelled', 'expired'],
  rule_checking: ['ai_analyzing', 'failed', 'cancelled', 'expired'],
  ai_analyzing: ['safety_reviewing', 'failed', 'cancelled', 'expired'],
  safety_reviewing: ['completed', 'failed', 'cancelled', 'expired'],
  completed: ['expired'], failed: ['expired'], cancelled: ['expired'], expired: [],
}
export function assertTransition(from: ContractReviewStatus, to: ContractReviewStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) throw new Error(`CONTRACT_REVIEW_INVALID_TRANSITION:${from}:${to}`)
}
export function assertOwnerShape(owner: { endUserId: string | null; accessTokenHash: string | null }): void {
  if (Boolean(owner.endUserId) === Boolean(owner.accessTokenHash)) throw new Error('CONTRACT_REVIEW_OWNER_INVALID')
}
```

`contract-review-access.ts` 使用 `randomBytes(32).toString('base64url')`、SHA-256 和 `timingSafeEqual`；数据库只存 hash。`ContractReviewService.create()` 校验 `sourceFile.purpose/status/expiresAt/owner`，会员调用 `requireActiveConsent`，匿名要求 consent snapshot；任务 `expiresAt` 直接继承源文件，不能重新延长。

- [ ] **Step 4: 运行核心单测并要求 80% 覆盖**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register --experimental-test-coverage --test-coverage-lines=80 --test-coverage-functions=80 --test-coverage-include=src/contract-review/contract-review-access.ts --test-coverage-include=src/contract-review/contract-review-state.ts --test-coverage-include=src/contract-review/contract-review.service.ts src/contract-review/__tests__/contract-review-service.test.ts`

Expected: PASS，lines/functions 均不低于 80%。

- [ ] **Step 5: 提交**

```bash
git add services/api/src/contract-review
git commit -m "feat: add contract review ownership and state machine"
```

## Wave B：逐页提取、规则、模型、安全闸与 API

### Task 7: 实现逐页提取与 canonical text

**Files:**
- Create: `services/api/src/contract-review/canonical-text.ts`
- Create: `services/api/src/contract-review/contract-review-extraction.service.ts`
- Create: `services/api/src/contract-review/__tests__/canonical-text.test.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-extraction.test.ts`

- [ ] **Step 1: 写 NFC/LF、页内 UTF-16 边界和 50 页硬上限失败测试**

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalizePage, locateExcerpt } from '../canonical-text'
import { assertBornDigitalPdfPageLimit } from '../contract-review-extraction.service'

test('canonical text keeps page-local UTF-16 offsets', () => {
  const text = canonicalizePage('甲方\r\n试用期😀六个月')
  assert.equal(text, '甲方\n试用期😀六个月')
  const range = locateExcerpt(text, '试用期😀六个月')
  assert.deepEqual(range, { charStart: 3, charEnd: 11 })
  assert.equal(text.slice(range.charStart, range.charEnd), '试用期😀六个月')
})

test('born-digital PDF over 50 pages is rejected instead of partially reviewed', () => {
  assert.doesNotThrow(() => assertBornDigitalPdfPageLimit(50))
  assert.throws(
    () => assertBornDigitalPdfPageLimit(51),
    /CONTRACT_PAGE_LIMIT_EXCEEDED/,
  )
})
```

- [ ] **Step 2: 运行并确认 helper 不存在**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register src/contract-review/__tests__/canonical-text.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现逐页提取服务**

```typescript
export function canonicalizePage(input: string): string {
  return input.normalize('NFC').replace(/\r\n?/g, '\n')
}
export function locateExcerpt(page: string, excerpt: string) {
  const charStart = page.indexOf(excerpt)
  if (charStart < 0) throw new Error('CONTRACT_EVIDENCE_NOT_FOUND')
  return { charStart, charEnd: charStart + excerpt.length }
}
export function assertBornDigitalPdfPageLimit(pageCount: number): void {
  if (pageCount > 50) throw new Error('CONTRACT_PAGE_LIMIT_EXCEEDED')
}
```

Extraction service 只读取 `contract_upload`：DOCX 用 `mammoth.extractRawText`；文字层 PDF 用 `unpdf.extractText(..., { mergePages:false })` 保留页数组，并在处理前调用 `assertBornDigitalPdfPageLimit`，超过 50 页以 `CONTRACT_PAGE_LIMIT_EXCEEDED` 拒绝整份审查，绝不截断后伪装为完整结果；扫描 PDF 最多逐页 OCR 20 页、每页完成才递增进度，任一必需页失败则整体失败；图片按单页 OCR。始终在 `finally` 销毁 PDF renderer，全文只存在 worker 内存。

- [ ] **Step 4: 运行提取单测与 OCR 回归**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register --experimental-test-coverage --test-coverage-lines=80 --test-coverage-functions=80 --test-coverage-include=src/contract-review/{canonical-text,contract-review-extraction.service}.ts src/contract-review/__tests__/canonical-text.test.ts src/contract-review/__tests__/contract-review-extraction.test.ts && pnpm --filter @ai-job-print/api verify:ocr-baidu`

Expected: PASS；OCR disabled/failure/truncated 均有真实错误码。

- [ ] **Step 5: 提交**

```bash
git add services/api/src/contract-review
git commit -m "feat: add contract page extraction"
```

### Task 8: 实现版本化规则包

**Files:**
- Create: `services/api/src/contract-review/contract-review.rules.ts`
- Create: `services/api/src/contract-review/contract-review-rule-engine.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-rule-engine.test.ts`

- [ ] **Step 1: 写地域无关和地域降级失败测试**

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { ContractReviewRuleEngine } from '../contract-review-rule-engine'

const engine = new ContractReviewRuleEngine()

test('probation term rule is deterministic when facts are complete', () => {
  const out = engine.evaluate({ contractMonths: 12, probationMonths: 3, locality: null })
  assert.equal(out.find((x) => x.ruleId === 'labor.probation.term')?.priority, 'priority_check')
})
test('local wage fact never becomes a deterministic violation without dataset', () => {
  const out = engine.evaluate({ probationSalary: 1800, locality: null })
  assert.equal(out.find((x) => x.ruleId === 'labor.probation.local_wage')?.priority, 'insufficient_info')
})
```

- [ ] **Step 2: 运行并确认 rule engine 不存在**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register src/contract-review/__tests__/contract-review-rule-engine.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现白名单规则结构和 P0 首发子集**

```typescript
export const CONTRACT_RULE_PACK_VERSION = 'cn-labor-p0-v1'
export const BASIS_ALLOWLIST = new Map([
  ['labor-contract-law:19', { url: 'https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394622_wap.html', effectiveFrom: '2013-07-01' }],
  ['labor-contract-law:22', { url: 'https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394622_wap.html', effectiveFrom: '2013-07-01' }],
  ['labor-contract-law:24', { url: 'https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394622_wap.html', effectiveFrom: '2013-07-01' }],
])
```

P0 确定性子集只包含试用期期限、竞业期限、扣押证件/收费、违约责任适用范围；地域工资和补偿只产生 `insufficient_info`。规则输出包含 `ruleId/rulePackVersion/basisRef/evidence/requiredFacts`，不生成法条号。

- [ ] **Step 4: 运行 100% 固定样本命中与覆盖率测试**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register --experimental-test-coverage --test-coverage-lines=80 --test-coverage-functions=80 --test-coverage-include=src/contract-review/contract-review-rule*.ts src/contract-review/__tests__/contract-review-rule-engine.test.ts`

Expected: PASS；固定样本断言全部命中。

- [ ] **Step 5: 提交**

```bash
git add services/api/src/contract-review/contract-review.rules.ts services/api/src/contract-review/contract-review-rule-engine.ts services/api/src/contract-review/__tests__/contract-review-rule-engine.test.ts
git commit -m "feat: add contract review rule pack"
```

### Task 9: 实现全文脱敏和境内模型专用通道

**Files:**
- Create: `services/api/src/contract-review/contract-review-pii-masker.ts`
- Create: `services/api/src/contract-review/contract-review-provider.service.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-pii-masker.test.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-provider.test.ts`

- [ ] **Step 1: 写漏遮、误遮和境外 fallback 失败测试**

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { maskContractText } from '../contract-review-pii-masker'
import { loadContractProviderConfig } from '../contract-review-provider.service'

test('masker removes PII but preserves salary and term facts', () => {
  const out = maskContractText('张三 370101199001011234 手机13800138000 月薪12000元 合同3年')
  assert.doesNotMatch(out.text, /370101199001011234|13800138000|张三/)
  assert.match(out.text, /12000元|3年/)
})
test('foreign or mutable providers fail closed', () => {
  assert.throws(() => loadContractProviderConfig({
    CONTRACT_REVIEW_PROVIDER: 'claude',
    CONTRACT_REVIEW_BASE_URL: 'https://api.anthropic.com',
    CONTRACT_REVIEW_MODEL: 'x',
  }), /CONTRACT_PROVIDER_NOT_ALLOWED/)
})
```

- [ ] **Step 2: 运行并确认两个模块不存在**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register src/contract-review/__tests__/contract-review-pii-masker.test.ts src/contract-review/__tests__/contract-review-provider.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现固定 allowlist 和 schema-only 调用**

```typescript
const CONTRACT_PROVIDER_ALLOWLIST = {
  deepseek: { hosts: ['api.deepseek.com'], models: ['deepseek-chat'] },
  qwen: { hosts: ['dashscope.aliyuncs.com'], models: ['qwen-plus'] },
} as const

export function loadContractProviderConfig(env: Record<string, string | undefined>) {
  const provider = env.CONTRACT_REVIEW_PROVIDER
  const baseUrl = new URL(env.CONTRACT_REVIEW_BASE_URL ?? '')
  const model = env.CONTRACT_REVIEW_MODEL ?? ''
  const allowed = provider && CONTRACT_PROVIDER_ALLOWLIST[provider as keyof typeof CONTRACT_PROVIDER_ALLOWLIST]
  if (!allowed || !allowed.hosts.includes(baseUrl.hostname as never) || !allowed.models.includes(model as never)) {
    throw new Error('CONTRACT_PROVIDER_NOT_ALLOWED')
  }
  return { provider, baseUrl: baseUrl.toString(), model }
}
```

服务不得注入或调用 `LlmConfigService`；配置缺失、host/model 不匹配、超时和响应 schema 错误均 fail closed。请求正文只使用 masker 输出和结构化主体存在性事实，无工具、无网络代理、无完整日志。

- [ ] **Step 4: 运行安全单测与源码反向门禁**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register --experimental-test-coverage --test-coverage-lines=80 --test-coverage-functions=80 --test-coverage-include=src/contract-review/contract-review-{pii-masker,provider.service}.ts src/contract-review/__tests__/contract-review-pii-masker.test.ts src/contract-review/__tests__/contract-review-provider.test.ts && ! rg "LlmConfigService|AiModelFeatureKey" services/api/src/contract-review`

Expected: PASS；反向搜索无命中。

- [ ] **Step 5: 提交**

```bash
git add services/api/src/contract-review
git commit -m "feat: add compliant contract model channel"
```

### Task 10: 实现 ContractReviewSafetyGate

**Files:**
- Create: `services/api/src/contract-review/contract-review-safety-gate.service.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-safety-gate.test.ts`

- [ ] **Step 1: 写证据错位、伪法条、确定性结论和 PII 输出失败测试**

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import type { ContractReviewResult } from '@ai-job-print/shared'
import { ContractReviewSafetyGate } from '../contract-review-safety-gate.service'

const gate = new ContractReviewSafetyGate()
const canonicalPages = [{ pageNumber: 1, text: '试用期六个月' }]
const validResult: ContractReviewResult = {
  priorityCheckCount: 1, attentionCount: 0, insufficientInfoCount: 0,
  coverage: 'complete', ocrConfidence: 'high', disclaimerVersion: 'contract-review-v1',
  rulePackVersion: 'cn-labor-p0-v1', generatedByAi: true,
  findings: [{
    id: 'f1', category: 'probation', priority: 'priority_check', title: '核实试用期',
    evidence: { pageNumber: 1, excerpt: '试用期六个月', charStart: 0, charEnd: 6 },
    explanation: '建议结合合同期限核实', basisRef: 'labor-contract-law:19',
    verificationQuestion: '合同期限是多少？', uncertainty: '', source: 'rule_and_ai',
  }],
}
const candidates = [
  { name: 'wrong offset', result: { ...validResult, findings: [{ ...validResult.findings[0]!, evidence: { pageNumber: 1, excerpt: '试用期六个月', charStart: 1, charEnd: 7 } }] } },
  { name: 'unknown basis', result: { ...validResult, findings: [{ ...validResult.findings[0]!, basisRef: 'fake-law:1' }] } },
  { name: 'legal conclusion', result: { ...validResult, findings: [{ ...validResult.findings[0]!, explanation: '合同无效' }] } },
  { name: 'PII leak', result: { ...validResult, findings: [{ ...validResult.findings[0]!, explanation: '身份证号370101199001011234' }] } },
] satisfies Array<{ name: string; result: ContractReviewResult }>

for (const candidate of candidates) {
  test(`rejects unsafe result: ${candidate.name}`, () => {
    assert.throws(() => gate.validate(candidate.result, canonicalPages), /CONTRACT_SAFETY_GATE_REJECTED/)
  })
}
test('accepts a schema-valid evidence-backed result', () => {
  assert.equal(gate.validate(validResult, canonicalPages).generatedByAi, true)
})
```

- [ ] **Step 2: 运行并确认 SafetyGate 不存在**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register src/contract-review/__tests__/contract-review-safety-gate.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现八项放行检查**

```typescript
validate(result: ContractReviewResult, pages: CanonicalPage[]): ContractReviewResult {
  assertContractReviewSchema(result)
  for (const finding of result.findings) {
    if (finding.basisRef && !BASIS_ALLOWLIST.has(finding.basisRef)) this.reject('BASIS_NOT_ALLOWED')
    assertEvidenceSlice(finding.evidence, pages)
    assertNoDeterministicLegalConclusion(finding)
    assertNoSensitivePii(finding)
    assertNoPromptInjectionEcho(finding)
  }
  return forceUncertaintyForLowConfidence(result)
}
```

禁止词至少覆盖“合同无效/本条违法/一定胜诉/保证赔偿”；任何 finding 失败使整份 AI 输出 fail closed。原始模型输出不作为异常 message、日志或审计 payload。

- [ ] **Step 4: 运行红队与覆盖率测试**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register --experimental-test-coverage --test-coverage-branches=80 --test-coverage-lines=80 --test-coverage-functions=80 --test-coverage-include=src/contract-review/contract-review-safety-gate.service.ts src/contract-review/__tests__/contract-review-safety-gate.test.ts`

Expected: PASS，红队绕过次数 0。

- [ ] **Step 5: 提交**

```bash
git add services/api/src/contract-review/contract-review-safety-gate.service.ts services/api/src/contract-review/__tests__/contract-review-safety-gate.test.ts
git commit -m "feat: add contract review safety gate"
```

### Task 11: 接入 BullMQ 编排、原子结果与清理

**Files:**
- Create: `services/api/src/contract-review/contract-review.queue.ts`
- Create: `services/api/src/contract-review/contract-review.processor.ts`
- Create: `services/api/src/contract-review/contract-review.cleanup.task.ts`
- Create: `services/api/src/contract-review/contract-review.module.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-processor.test.ts`
- Modify: `services/api/src/app.module.ts`

- [ ] **Step 1: 写“未过 SafetyGate 不落 resultJson”的失败测试**

```typescript
test('raw model output is never persisted before safety approval', async () => {
  provider.review.mockResolvedValue(unsafeResult)
  gate.validate.mockImplementation(() => { throw new Error('CONTRACT_SAFETY_GATE_REJECTED') })
  await assert.rejects(() => processor.process(job))
  assert.equal(prisma.contractReviewTask.update.mock.calls.some(([x]) => x.data?.resultJson), false)
})
test('validated result and completed status use one transaction', async () => {
  await processor.process(job)
  assert.equal(prisma.$transaction.mock.calls.length, 1)
})
```

- [ ] **Step 2: 运行并确认 processor 不存在**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register src/contract-review/__tests__/contract-review-processor.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现 Redis 可用才注册的专用队列**

```typescript
export const CONTRACT_REVIEW_QUEUE = 'contract-review'
export const CONTRACT_REVIEW_JOB = 'contract-review.process'
export interface ContractReviewJobData { taskId: string }

@Processor(CONTRACT_REVIEW_QUEUE)
export class ContractReviewProcessor extends WorkerHost {
  async process(job: Job<ContractReviewJobData>) {
    if (job.name !== CONTRACT_REVIEW_JOB || !job.data.taskId) throw new Error('CONTRACT_REVIEW_JOB_INVALID')
    return this.orchestrator.execute(job.data.taskId)
  }
}
```

Orchestrator 每阶段先做 CAS；五分钟总 deadline；取消/过期后停止后续 OCR。SafetyGate 通过后用一个 `$transaction` 写 `resultJson + completed + aiProvider/model`。清理 cron 先 CAS 到 expired，再删 source/result 对象，失败记录脱敏码并重试。

- [ ] **Step 4: 运行 processor、清理与 API typecheck**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register --experimental-test-coverage --test-coverage-lines=80 --test-coverage-functions=80 --test-coverage-include=src/contract-review/contract-review.{processor,cleanup.task}.ts src/contract-review/__tests__/contract-review-processor.test.ts && pnpm --filter @ai-job-print/api typecheck`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add services/api/src/contract-review services/api/src/app.module.ts
git commit -m "feat: orchestrate contract review jobs"
```

### Task 12: 暴露最小 HTTP API 与真实轮询

**Files:**
- Create: `services/api/src/contract-review/dto/contract-review.dto.ts`
- Create: `services/api/src/contract-review/contract-review.controller.ts`
- Create: `services/api/scripts/verify-contract-review-http.ts`
- Modify: `services/api/src/contract-review/contract-review.module.ts`
- Modify: `services/api/package.json`

- [ ] **Step 1: 写 HTTP 归属和错误同形失败验证**

```typescript
assert.equal(await request('GET', `/contract-reviews/${otherId}`, memberA).status, 404)
assert.equal(await request('GET', `/contract-reviews/${missingId}`, memberA).status, 404)
assert.equal(await request('GET', `/contract-reviews/${anonymousId}`, { 'x-contract-review-access-token': 'wrong' }).status, 404)
assert.equal((await request('POST', '/contract-reviews', anonymousWithoutConsent)).status, 400)
```

- [ ] **Step 2: 运行并确认路由 404**

Run: `pnpm --filter @ai-job-print/api exec node -r @swc-node/register scripts/verify-contract-review-http.ts`

Expected: FAIL，合同审查路由不存在。

- [ ] **Step 3: 实现五个端点与限流**

```typescript
function headerOf(req: RequestLike, name: string): string | null {
  const value = req.headers?.[name]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value) && value[0]) return value[0].trim()
  return null
}

@Controller('contract-reviews')
export class ContractReviewController {
  constructor(
    private readonly service: ContractReviewService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  private async requesterOf(req: RequestLike): Promise<ContractReviewRequester> {
    const member = await resolveOptionalEndUser(req.headers?.authorization, this.jwt, this.redis, this.prisma)
    return member
      ? { endUserId: member.endUserId, accessToken: null }
      : { endUserId: null, accessToken: headerOf(req, 'x-contract-review-access-token') }
  }

  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async create(@Body() dto: CreateContractReviewDto, @Req() req: RequestLike) {
    return ApiResponse.ok(await this.service.create(dto, await this.requesterOf(req)))
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: RequestLike) {
    return ApiResponse.ok(await this.service.get(id, await this.requesterOf(req)))
  }

  @Post(':id/confirm')
  @Throttle({ default: { ttl: 60_000, limit: 8 } })
  async confirm(@Param('id') id: string, @Body() dto: ConfirmContractReviewDto, @Req() req: RequestLike) {
    return ApiResponse.ok(await this.service.confirm(id, dto, await this.requesterOf(req)))
  }

  @Post(':id/report')
  @Throttle({ default: { ttl: 60_000, limit: 4 } })
  async report(@Param('id') id: string, @Req() req: RequestLike) {
    return ApiResponse.ok(await this.service.createReport(id, await this.requesterOf(req)))
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: RequestLike) {
    return ApiResponse.ok(await this.service.remove(id, await this.requesterOf(req)))
  }
}
```

为保证 Task 12 单独可编译，`ContractReviewService.createReport()` 在 Task 14 接入 PDF 前先实现诚实的受控响应：完成归属校验后抛出 `REPORT_NOT_AVAILABLE`（503）；HTTP verify 必须断言该错误，不能返回假 fileId。Task 14 用真实短期派生文件实现替换该分支。

Requester 解析沿用 optional member 模式；匿名只读 `x-contract-review-access-token` header，禁止 query token。Create DTO 只允许 `sourceFileId/contractType/consentVersion/consentedAt/consentScopeHash/disclaimerVersion`，全局 whitelist 拒绝额外字段。GET 仅 completed 返回 result；其余只返回真实 stage/page progress。

- [ ] **Step 4: 运行 HTTP、越权和回归验证**

Run: `pnpm --filter @ai-job-print/api verify:contract-review:http && pnpm --filter @ai-job-print/api verify:upload-sessions:http && pnpm --filter @ai-job-print/api typecheck`

Expected: PASS；不存在与越权响应同为 404。

- [ ] **Step 5: 提交**

```bash
git add services/api/src/contract-review services/api/scripts/verify-contract-review-http.ts services/api/package.json
git commit -m "feat: expose contract review API"
```

## Wave C：Kiosk、报告、打印与灰度发布

### Task 13: 实现 Kiosk 易失会话、五步流程与百宝箱入口

**Files:**
- Create: `apps/kiosk/src/pages/toolbox/contract-review/contractReviewSession.ts`
- Create: `apps/kiosk/src/pages/toolbox/contract-review/ContractReviewPage.tsx`
- Create: `apps/kiosk/src/pages/toolbox/contract-review/ContractReviewUpload.tsx`
- Create: `apps/kiosk/src/pages/toolbox/contract-review/ContractReviewResult.tsx`
- Create: `apps/kiosk/src/pages/toolbox/contract-review/contract-review.css`
- Create: `apps/kiosk/src/pages/assistant/contractTextRedirect.ts`
- Modify: `apps/kiosk/src/pages/assistant/AssistantPage.tsx`
- Create: `apps/kiosk/src/services/api/contractReview.ts`
- Create: `apps/kiosk/scripts/verify-contract-review-ui.mjs`
- Modify: `apps/kiosk/src/auth/kioskSensitiveSession.ts`
- Modify: `apps/kiosk/src/routes/index.tsx`
- Modify: `packages/shared/src/types/toolboxMicroApp.ts`
- Modify: `services/api/scripts/verify-toolbox-micro-app-platform.ts`
- Modify: `apps/kiosk/package.json`
- Test: `apps/kiosk/tests/visual/contract-review.spec.ts`

- [ ] **Step 1: 写 UI 静态门禁和公共屏 E2E 失败断言**

```javascript
assertIncludes(session, 'let accessToken: string | null = null')
assertIncludes(session, 'clearContractReviewSession')
assertNotIncludes(session, 'localStorage')
assertNotIncludes(session, 'sessionStorage')
assertIncludes(route, "path: 'toolbox/contract-review'")
assertIncludes(toolbox, "entryType: 'internal_route'")
assertIncludes(assistant, 'shouldRedirectLegalRiskInput')
assertIncludes(assistant, "navigate('/toolbox/contract-review'")
assertIncludes(result, 'const EVIDENCE_VISIBLE_MS = 30_000')
assertIncludes(result, 'setEvidenceVisible(false)')
```

```typescript
test('refresh ends anonymous review instead of restoring it', async ({ page }) => {
  await page.route('**/api/v1/contract-reviews/task-1', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: {
        id: 'task-1', status: 'completed', contractType: 'labor_contract', analyzedPages: 1,
        totalPages: 1, truncated: false, ocrConfidence: 'high', expiresAt: '2026-08-01T12:00:00.000Z',
        progress: { stage: 'completed', completedPages: 1, totalPages: 1 },
        result: { priorityCheckCount: 1, attentionCount: 0, insufficientInfoCount: 0,
          coverage: 'complete', ocrConfidence: 'high', disclaimerVersion: 'v1', rulePackVersion: 'v1',
          generatedByAi: true, findings: [] },
      } }),
    })
  })
  await page.goto('/toolbox/contract-review')
  await page.evaluate(() => history.replaceState({ taskId: 'task-1' }, '', location.href))
  await page.reload()
  await expect(page.getByText('请重新开始本次审查')).toBeVisible()
  await expect(page.getByText('身份证')).toHaveCount(0)
})

test('legal risk assistant redirects long contract text without sending it to chat', async ({ page }) => {
  let chatCalled = false
  await page.route('**/api/v1/assistant/chat', async (route) => {
    chatCalled = true
    await route.abort()
  })
  await page.goto('/assistant?intent=legal_risk_check')
  await page.locator('textarea').fill('劳动合同条款：'.repeat(100))
  await page.locator('.assistant-send').click()
  await expect(page).toHaveURL(/\/toolbox\/contract-review$/)
  expect(chatCalled).toBe(false)
})
```

同一 Playwright 文件还必须用 `page.clock.install()` 和 `page.clock.fastForward(30_001)` 覆盖证据片段：点击“查看对应原文”后 `data-testid="contract-evidence"` 初始清晰，推进 30,001ms 后进入 `is-blurred`，再次点击只重新显示当前最小片段，不恢复整份原文。

- [ ] **Step 2: 运行并确认 UI 文件和路由不存在**

Run: `pnpm --filter @ai-job-print/kiosk exec node scripts/verify-contract-review-ui.mjs && pnpm --filter @ai-job-print/kiosk exec playwright test tests/visual/contract-review.spec.ts --project=kiosk-1080x1920`

Expected: FAIL。

- [ ] **Step 3: 实现易失 store、API 轮询和五步状态**

```typescript
let state: { taskId: string | null; accessToken: string | null; sourceFileId: string | null } = {
  taskId: null, accessToken: null, sourceFileId: null,
}
export function setContractReviewSession(next: typeof state): void { state = { ...next } }
export function getContractReviewSession() { return { ...state } }
export function clearContractReviewSession(): void {
  state = { taskId: null, accessToken: null, sourceFileId: null }
}

export function shouldRedirectLegalRiskInput(intent: string | null, text: string): boolean {
  return intent === 'legal_risk_check' && text.trim().length >= 600
}
```

`contractReview.ts` 每次请求把 token 放 `X-Contract-Review-Access-Token` header；confirm 后从 1.5 秒轮询，指数退避封顶 5 秒，组件卸载/离席时 abort。五步 UI 固定为说明同意、上传/扫描、完整性确认、真实阶段、结果；不显示伪百分比或完整合同常驻文本。上传前和处理中明确“刷新将结束本次审查”。

`ContractReviewResult.tsx` 用 `EVIDENCE_VISIBLE_MS = 30_000` 管理最小证据片段；每次打开先清理旧 timer，30 秒无操作后 `setEvidenceVisible(false)` 并应用模糊遮罩，组件卸载时清理 timer。页面和可访问性文本都不得把完整合同放进 DOM。

`AssistantPage.tsx` 在调用 `chatWithAssistant` 和写入消息列表之前读取原始 `intent`；当 `shouldRedirectLegalRiskInput(intent, text)` 为真时，清空输入并直接 `navigate('/toolbox/contract-review')`。合同长文本不得进入普通咨询消息、网络请求、日志或历史状态；短问题仍只能走既有白名单能力，不能把 `legal_risk_check` 偷加进通用 `AssistantSkill`。

百宝箱候选项同时改：`entryType:'internal_route'`、`internalRoute:'/toolbox/contract-review'`、移除 `assistantIntent`，仍 `productionEnabledByDefault:false`。

- [ ] **Step 4: 运行 Kiosk 门禁、E2E、typecheck 和既有百宝箱回归**

Run: `pnpm --filter @ai-job-print/kiosk verify:contract-review-ui && pnpm --filter @ai-job-print/kiosk exec playwright test tests/visual/contract-review.spec.ts --project=kiosk-1080x1920 && pnpm --filter @ai-job-print/kiosk typecheck && pnpm --filter @ai-job-print/api verify:toolbox-micro-app-platform`

Expected: PASS；离席、刷新、返回首页后无上一用户内容。

- [ ] **Step 5: 提交**

```bash
git add apps/kiosk/src/pages/toolbox/contract-review apps/kiosk/src/pages/assistant/contractTextRedirect.ts apps/kiosk/src/pages/assistant/AssistantPage.tsx apps/kiosk/src/services/api/contractReview.ts apps/kiosk/src/auth/kioskSensitiveSession.ts apps/kiosk/src/routes/index.tsx apps/kiosk/scripts/verify-contract-review-ui.mjs apps/kiosk/tests/visual/contract-review.spec.ts apps/kiosk/package.json packages/shared/src/types/toolboxMicroApp.ts services/api/scripts/verify-toolbox-micro-app-platform.ts
git commit -m "feat: add kiosk contract review flow"
```

### Task 14: 生成 AI 标识报告、打印并完成发布门禁

**Files:**
- Create: `services/api/src/contract-review/contract-review-pdf.service.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-pdf.test.ts`
- Create: `services/api/scripts/verify-contract-review.ts`
- Modify: `services/api/src/contract-review/contract-review.service.ts`
- Modify: `services/api/src/contract-review/contract-review.module.ts`
- Modify: `services/api/package.json`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [ ] **Step 1: 写显式/隐式标识与短期派生文件失败测试**

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import type { ContractReviewResult } from '@ai-job-print/shared'
import { ContractReviewPdfService } from '../contract-review-pdf.service'

class RecordingPdfAdapter {
  readonly visibleText: string[] = []
  metadata: Record<string, string> = {}
  text(value: string): void { this.visibleText.push(value) }
  setMetadata(value: Record<string, string>): void { this.metadata = { ...value } }
  finish(): Buffer { return Buffer.from('pdf') }
}
const result: ContractReviewResult = {
  priorityCheckCount: 0, attentionCount: 0, insufficientInfoCount: 0,
  coverage: 'complete', ocrConfidence: 'high', disclaimerVersion: 'v1',
  rulePackVersion: 'v1', generatedByAi: true, findings: [],
}

test('report is visibly and invisibly labelled and never outlives the task', async () => {
  const adapter = new RecordingPdfAdapter()
  const service = new ContractReviewPdfService(() => adapter)
  const expiresAt = new Date('2026-08-01T12:00:00.000Z')
  const rendered = await service.render(result, {
    taskId: 't1', expiresAt, generatedAt: '2026-08-01T10:00:00.000Z', providerCode: 'zyd-contract-v1',
  })
  assert.match(adapter.visibleText.join('\n'), /AI 生成，仅作风险提示，不构成正式法律意见/)
  assert.equal(adapter.metadata.aiGenerated, 'true')
  assert.equal(adapter.metadata.serviceProviderCode, 'zyd-contract-v1')
  assert.equal(adapter.metadata.contentId, 't1')
  assert.equal(rendered.expiresAt.toISOString(), expiresAt.toISOString())
})
```

- [ ] **Step 2: 运行并确认报告服务不存在**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register src/contract-review/__tests__/contract-review-pdf.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现短期 PDF 与打印桥接**

```typescript
const metadata = {
  Title: 'AI 签约风险提示',
  Subject: 'AI generated contract risk提示',
  Keywords: `aiGenerated=true;serviceProviderCode=${providerCode};contentId=${taskId};generatedAt=${generatedAt}`,
}
```

`ContractReviewPdfService` 使用可注入 adapter 以便测试，公开签名固定为：

```typescript
export interface ContractReviewPdfAdapter {
  text(value: string): void
  setMetadata(value: Record<string, string>): void
  finish(): Buffer
}
export interface RenderedContractReviewPdf { buffer: Buffer; expiresAt: Date }
export class ContractReviewPdfService {
  constructor(private readonly createPdf: () => ContractReviewPdfAdapter) {}
  async render(result: ContractReviewResult, context: {
    taskId: string; expiresAt: Date; generatedAt: string; providerCode: string
  }): Promise<RenderedContractReviewPdf> {
    const pdf = this.createPdf()
    pdf.setMetadata({
      aiGenerated: 'true', serviceProviderCode: context.providerCode,
      contentId: context.taskId, generatedAt: context.generatedAt,
    })
    pdf.text('AI 生成，仅作风险提示，不构成正式法律意见')
    for (const finding of result.findings) {
      pdf.text(`${finding.title}\n${finding.explanation}\n${finding.verificationQuestion}`)
    }
    return { buffer: pdf.finish(), expiresAt: context.expiresAt }
  }
}
```

每页页眉/页脚显示 AI 标识、免责声明、规则包版本和生成时间；`FilesService.upload` 使用 `purpose:'print_doc'`、`assetCategory:'derived'`、`sourceFileId`、`expiresAtOverride:task.expiresAt`、`retentionLockedReason:'contract_review_session_only'`。API 只返回短期 fileId/签名 URL，由现有打印确认流程消费，不绕过打印定价和真实状态。

- [ ] **Step 4: 运行全量验证矩阵**

Run:

```bash
pnpm --filter @ai-job-print/api verify:contract-review:gate0
pnpm --filter @ai-job-print/api verify:contract-review:http
pnpm --filter @ai-job-print/api verify:contract-review
pnpm --filter @ai-job-print/api verify:print-jobs
pnpm --filter @ai-job-print/api verify:file-retention
pnpm --filter @ai-job-print/api db:pg:sync:check
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/kiosk verify:contract-review-ui
pnpm --filter @ai-job-print/kiosk exec playwright test tests/visual/contract-review.spec.ts --project=kiosk-1080x1920
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
pnpm verify:dependency-security
```

Expected: 全部 PASS。Gate 0 文档若仍为 `blocked`，验证只确认“生产默认关闭且阻断字段齐全”，最终发布步骤必须停止。

- [ ] **Step 5: 更新正式进度文档并提交**

在 `current-progress.md` 记录实际完成的任务、验证命令和仍阻断的 Gate 0；在 `next-tasks.md` 只保留未完成的法务签字、真实 provider 灰度、Windows 真机和生产发布，不宣称未执行的验收通过。

```bash
git add services/api/src/contract-review services/api/scripts/verify-contract-review.ts services/api/package.json docs/progress/current-progress.md docs/progress/next-tasks.md
git commit -m "feat: complete contract review release candidate"
```

## 设计覆盖自检

| 设计章节 | 实施任务 |
| --- | --- |
| 产品定位、输出与人工法务边界 | Task 1、10、13、14 |
| 四类文件、格式、页数和 OCR 诚实失败 | Task 2、7 |
| 视觉提取、规则、LLM、SafetyGate | Task 7–11 |
| 结构化结果与 page-local UTF-16 证据 | Task 2、7、10 |
| 独立数据模型、XOR 归属和状态机 | Task 3、6、11 |
| 两小时文件留存、UploadSession、扫描和“我的文档”排除 | Task 4、11、14 |
| 五个最小 API、轮询和匿名 header token | Task 6、12、13 |
| 27 寸五步 UI 与公共屏隐私 | Task 13 |
| 免责声明、显式/隐式 AI 标识和报告 | Task 1、5、14 |
| 同意、PII 遮蔽、境内 provider 和提示注入 | Task 1、5、9、10 |
| 黄金集、红队、双库、浏览器和真机门禁 | Task 1、8–10、12–14 |
| 三阶段文件预算和生产默认关闭 | Wave A/B/C、Task 1、13、14 |

## 最终验收与发布停止条件

- [ ] SQLite 主路径与 PostgreSQL schema parity 通过。
- [ ] 核心纯函数/服务 Node test lines/functions/branches ≥ 80%。
- [ ] API 越权、匿名 token、同意撤回、过期、删除、OCR 失败和 SafetyGate fail-closed 全部通过。
- [ ] 1080×1920 Playwright 覆盖上传、处理中刷新、离席、报告和打印入口。
- [ ] Windows 真机验证扫描件逐页进度、五分钟超时、打印和连续会话内存释放。
- [ ] 真实日志和 AuditLog 抽样确认无合同正文、PII、签名 URL 或原始模型输出。
- [ ] Gate 0 七项全部 approved 且有责任人、日期和证据引用。
- [ ] 仅在以上全部满足后创建新的百宝箱审核版本并灰度 1–2 台终端；禁止直接改写历史发布版本。
