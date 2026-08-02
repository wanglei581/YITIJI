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
- Modify: `services/api/src/files/files.cleanup.task.ts`
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
- Modify: `services/api/src/member-privacy/member-privacy.service.ts`

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

`contract-review-access.ts` 使用 `randomBytes(32).toString('base64url')`、SHA-256 和 `timingSafeEqual`；数据库只存 hash。`ContractReviewService.create()` 校验 `sourceFile.purpose/status/expiresAt/owner`，匿名要求 consent snapshot；任务 `expiresAt` 直接继承源文件，不能重新延长。

匿名创建不能把随机 `sourceFileId` 当成唯一授权：请求还必须携带上传接口已返回的短期 HMAC signed content URL 作为 `sourceFileProof`，服务端复用 `parseAndVerifySignedContentUrl` 验证未过期且 fileId 与 `sourceFileId` 精确一致。proof 不落库、不写日志；仅持有 fileId、畸形/过期 proof 或其他文件 proof 均与不存在同形拒绝。proof 是短期 bearer，不宣称一次性；同文件允许用户重试，重放成本由 Task 12 create 限流控制。

任务 consent snapshot 必须绑定服务端真相：同一数据库事务内要求恰好一个 active `contract_review_disclaimer`，0 个或多个均 fail closed；用确定性 canonical JSON + SHA-256 绑定 scope、当前 consent version、active 文档 id/version/content hash/publishedAt 和设计 11.1 的七项固定披露。请求的 `disclaimerVersion` / `consentScopeHash` 必须精确匹配服务端计算值，task 只存服务端值。匿名 `consentedAt` 不得早于 publishedAt、不得超过 15 分钟且未来时钟容差最多 60 秒；会员继续记录 DB grant 时间，并要求当前版本 grant 不早于 active 文档 publishedAt。不得因 Gate 0 未通过而自动激活草稿。

会员创建必须与 Task 5 的撤回事务形成同一并发协议：`MemberPrivacyService` 提供可在 Prisma transaction client 上执行的“最新事件真相”校验；创建使用 Serializable transaction，并对 Prisma 写冲突/序列化失败做有界重试。在同一事务中先读取 `contract_review` 最新 consent 事件并确认当前版本未撤回，再插入 `ContractReviewTask`。撤回路径使用同级 Serializable/retry 策略。并发结果必须满足二选一：创建先线性化时撤回事务能看见并取消任务；撤回先线性化时创建失败，绝不能留下“最新 consent 已撤回但任务仍为处理中”的状态。单元 fake 只验证协议与重试分支，真实 PostgreSQL 双连接验收留 Task 14。

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
- Create: `services/api/src/contract-review/contract-review-docx-archive.ts`
- Create: `services/api/src/contract-review/contract-review-extraction.service.ts`
- Create: `services/api/src/contract-review/__tests__/canonical-text.test.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-extraction.test.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-docx-archive.test.ts`
- Modify: `services/api/src/files/files.service.ts`
- Modify: `services/api/src/contract-review/__tests__/contract-review-file-policy.test.ts`

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

Extraction service 必须通过 `FilesService.readContentForEndUser(fileId, task.endUserId)` 读取并二次断言 `purpose === 'contract_upload'`；禁止使用无归属校验的 `readContent()`。该读取会复验 active/未过期/会员或匿名 owner，防止 create 后到 worker 执行前的 TOCTOU。DOCX 用 `mammoth.extractRawText`；文字层 PDF 用 `unpdf.extractText(..., { mergePages:false })` 保留页数组，并在处理前调用 `assertBornDigitalPdfPageLimit`。PDF `numPages` 必须是 1–50 的安全整数，0/畸形直接失败；51 页必须在 `extractText` 零调用时以 `CONTRACT_PAGE_LIMIT_EXCEEDED` 拒绝整份审查，绝不截断后伪装为完整结果。

PDF 按页决定 `text_layer | ocr | mixed`：每页先生成唯一 canonical text；无可靠文字层的页才进入 OCR。可靠性计数必须排除 Unicode 空白、控制字符和 format/零宽字符，且不得仅凭短页眉或页脚达到阈值；纯扫描 PDF 总页数最多 20；mixed PDF 总页数仍受 50 页上限且需 OCR 的页数最多 20，超限在 renderer/OCR 零调用时整体拒绝。按原页序逐页完成，只有该页已有可靠文字层或 OCR 成功后才递增真实进度；任一必需页 OCR/渲染失败或识别为空则整体失败，不返回部分 pages。任务级 OCR 置信度取所有 OCR 页的最低档。图片按单页 OCR。

`unpdf` 返回的页数组必须逐索引验证为 dense string array，稀疏数组 fail closed。提取后还要执行 canonical 输出预算：单页不超过 200,000 个 UTF-16 code units、整份不超过 2,000,000。DOCX 在交给 `mammoth` 前必须按规范化路径逐条验证 ZIP central/local headers：拒绝路径别名/穿越、重复 entry、Zip64、加密、多盘、data descriptor 和未知压缩方法；限制单路径 1,024 bytes、最多 64 层和总 entry 4,096。标准 Unicode Path extra 必须按 version 1、raw filename CRC32、fatal UTF-8 和 NFC 校验；bit 11 未置时允许它作为 legacy raw filename 的 canonical Unicode 替代路径，central/local 的 resolved path 必须一致。central CRC、local CRC 与 stored/deflate 实际流式输出 CRC 必须三方一致。全部非目录 entry 的声明与实际流式解压内容统一计入 16MB 安全预算，同时保留 64MB 总量门禁；不采用可伪造的媒体魔数豁免，因此图片很多的超大 DOCX 也会 fail closed。要求唯一 `word/document.xml`。不能只相信 central-directory 声明大小，也不能把完整预解压结果聚合进内存。Task 12 仍需在 processor 层设置总执行时间、内存上限和可终止 worker 回收门禁，因为 Promise timeout 不能真正取消第三方原生解析；该门禁完成前保持 Gate 0 阻断。

文字层 `unpdf` proxy 与 OCR `openPdfForRender` renderer 必须分别用独立 `finally` 销毁；先销毁文字层 proxy，再进入 renderer，不能同时持有两套 PDF 资源。destroy 失败不得掩盖已经发生的原始提取错误；若提取本身成功但 destroy 失败则 fail closed，且最后一页的 100% 进度只能在 renderer 成功销毁后上报，避免“已完成后又失败”。全文、页图和 OCR 文本只存在 worker 内存，不写临时文件、日志、审计或数据库。单元测试用可注入 runtime/fake 验证资源释放和调用顺序，并增加生产编译后的 Nest DI smoke，不以真实第三方调用替代边界断言。

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
- Modify: `services/api/src/contract-review/contract-review.service.ts`

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
  ['labor-contract-law:9', { url: 'https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394622_wap.html', effectiveFrom: '2013-07-01' }],
  ['labor-contract-law:19', { url: 'https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394622_wap.html', effectiveFrom: '2013-07-01' }],
  ['labor-contract-law:20', { url: 'https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394622_wap.html', effectiveFrom: '2013-07-01' }],
  ['labor-contract-law:22', { url: 'https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394622_wap.html', effectiveFrom: '2013-07-01' }],
  ['labor-contract-law:23', { url: 'https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394622_wap.html', effectiveFrom: '2013-07-01' }],
  ['labor-contract-law:24', { url: 'https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394622_wap.html', effectiveFrom: '2013-07-01' }],
  ['labor-contract-law:25', { url: 'https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394622_wap.html', effectiveFrom: '2013-07-01' }],
])
```

`contract-review.rules.ts` 是规则包版本与 `BASIS_ALLOWLIST` 的唯一真源；`contract-review.service.ts` 只允许 import/re-export `CONTRACT_RULE_PACK_VERSION`，不得保留第二份字符串常量。Task 10 的 SafetyGate 必须复用同一白名单，不另建镜像。

P0 只对 `labor_contract` 执行确定性规则；其他合同类型返回空确定性结果或明确 `insufficient_info`，不得伪装为已覆盖。确定性子集只包含试用期期限、竞业期限、扣押证件/财物、违约责任适用范围；地域最低工资和竞业补偿在没有已签署数据集时只产生 `insufficient_info`，并记录 `localityDatasetVersion: null`。不得从官方 URL 推导法务批准或解除 Gate 0。

规则引擎必须是无 Nest、无 I/O、无 `Date`、无日志、无模型调用的纯函数/不可变实现。内部规则输出包含 `ruleId/rulePackVersion/basisRef/evidence/requiredFacts/source: 'rule'`，由 Task 11 再映射与合并到共享 Finding。所有 `priority_check` 必须携带 canonical page 上的精确原文证据，`charStart/charEnd` 使用 UTF-16 code units 且能按页切片还原；缺少完整事实或精确证据时必须降级为 `insufficient_info`，不得断言。输出文案使用“建议核实”“与法定上限不一致”等保守表述，禁止“合同无效”“必属违法”等结论性语言，也不生成白名单之外的法条编号。

事实输入必须区分“明确未约定”和“尚未提取/未知”：劳动合同规则字段缺失或为 unknown 时输出带 `requiredFacts` 的 `insufficient_info`，不得以空 findings 伪装为已检查无风险；显式 absent 才允许静默无命中。结构化事实与原文冲突、原文只有否定句、数字仅出现在工资/补偿/生效时间等非期限语境，均不得产生 `priority_check`。违约金第 23 条豁免只适用于竞业限制约定，不把一般保密义务单独当作允许劳动者承担违约金的情形；确定性证据还必须明确绑定劳动者一方的支付/承担义务。

固定样本必须覆盖：合同期限 `<3` 月不得约定试用期、`3–<12` 月最多 1 月、`12–<36` 月最多 2 月、`>=36` 月或无固定期限最多 6 月；竞业期限超过 24 月；扣押证件/收取财物的否定语境；仅第 22/23 条范围内可约定违约金；emoji 前缀的 UTF-16 偏移、同页重复文本的证据定位、缺地域数据、所有 basisRef 均在白名单、输入/输出不可变，以及非劳动合同不得产生确定性违法判断。

- [ ] **Step 4: 运行 100% 固定样本命中与覆盖率测试**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register --experimental-test-coverage --test-coverage-lines=80 --test-coverage-functions=80 '--test-coverage-include=src/contract-review/contract-review-rule*.ts' '--test-coverage-include=src/contract-review/contract-review.rules.ts' src/contract-review/__tests__/contract-review-rule-engine.test.ts`

Expected: PASS；固定样本断言全部命中。

- [ ] **Step 5: 提交**

```bash
git add services/api/src/contract-review/contract-review.rules.ts services/api/src/contract-review/contract-review-rule-engine.ts services/api/src/contract-review/__tests__/contract-review-rule-engine.test.ts services/api/src/contract-review/contract-review.service.ts
git commit -m "feat: add contract review rule pack"
```

### Task 9: 实现全文脱敏和境内模型专用通道

**Files:**
- Create: `services/api/src/contract-review/contract-review-pii-masker.ts`
- Create: `services/api/src/contract-review/contract-review-provider.service.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-pii-masker.test.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-provider.test.ts`

- [ ] **Step 1: 写逐页漏遮、误遮、稳定占位和境外 fallback 失败测试**

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { maskContractPages } from '../contract-review-pii-masker'
import {
  ContractReviewProviderService,
  loadContractProviderConfig,
} from '../contract-review-provider.service'

test('masker removes PII across pages but preserves legal facts', () => {
  const out = maskContractPages([
    { pageNumber: 1, text: '乙方：张三 身份证370101199001011234 手机13800138000' },
    { pageNumber: 2, text: '张三月薪12000元，合同3年，依据第19条。' },
  ])
  assert.doesNotMatch(out.pages.map((page) => page.text).join('\n'), /370101199001011234|13800138000|张三/)
  assert.match(out.pages[1]!.text, /12000元|3年|第19条/)
  assert.equal(out.pages[0]!.text.match(/\[劳动者_1\]/u)?.[0], out.pages[1]!.text.match(/\[劳动者_1\]/u)?.[0])
})
test('foreign or mutable providers fail closed', () => {
  assert.throws(() => loadContractProviderConfig({
    CONTRACT_REVIEW_PROVIDER: 'claude',
    CONTRACT_REVIEW_BASE_URL: 'https://api.anthropic.com',
    CONTRACT_REVIEW_MODEL: 'x',
  }), /CONTRACT_PROVIDER_NOT_ALLOWED/)
})
test('provider revalidates approval and config before every call', async () => {
  // fake transport must not run after approval/config changes; there is no fallback.
})
```

测试矩阵必须覆盖：15/18 位及空格/连字符身份证、`+86`/空格手机号、16–19 位银行卡、邮箱、详细地址、统一社会信用代码、标签化劳动者/用人单位名称；同一实体跨页占位一致且结果不返回原值映射；薪资、日期、期限、法条编号不得误遮。masker 仅接受页码连续且已 canonicalize 的逐页输入，页序、页数保持不变；任何高置信残留或输入/输出预算越界均 fail closed。

- [ ] **Step 2: 运行并确认两个模块不存在**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register src/contract-review/__tests__/contract-review-pii-masker.test.ts src/contract-review/__tests__/contract-review-provider.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现“固定支持表 + 独立批准闸”的 schema-only 调用**

```typescript
const CONTRACT_PROVIDER_SUPPORT = {
  deepseek: [{ baseUrl: 'https://api.deepseek.com/', model: 'deepseek-v4-pro' }],
  qwen: [{ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/', model: 'qwen-plus' }],
} as const

export function loadContractProviderConfig(env: Record<string, string | undefined>) {
  // 所有字段仅接受 env 自有属性；URL 解析错误统一映射为安全错误码。
  // 仅接受支持表中的精确 https base URL + model，并要求独立 API key。
  // provider support 只表示代码可识别，不代表该组合已获得项目合规批准。
}
```

`maskContractPages` 先从 canonical 原文按甲方/乙方/姓名/用人单位/统一社会信用代码等明确标签提取仅布尔主体事实和会话内实体字典，再用固定“类别 + 序号”占位符逐页替换；字典只存在于调用栈内，返回值不得包含原值或可逆映射。不得用宽泛“任意 2–4 个汉字”规则冒充姓名识别；无法可靠识别但疑似含高风险 PII 时整份拒绝，不带病上送。

服务不得注入或调用 `LlmConfigService`。固定支持表与独立 `ContractProviderApprovalGate` 必须分离：默认 gate 永远拒绝；只有 Task 14 归档并绑定精确 provider/base URL/model 的合规证据后才可替换。构造初始化和**每次调用前**都重新读取、验证配置并调用批准闸；初始化后 env、批准状态或配置变化必须在发请求前被阻断。

URL 只接受支持表中的精确 canonical `https` base URL；拒绝 userinfo、显式端口、query/hash、尾点、IDN/IP、路径偏移和 redirect。API key 必填且不进入错误或日志。Provider 使用可注入 transport；Task 9 可实现并测试严格 fetch transport，但不注册 Nest module、不启用生产入口、不执行真实模型请求。固定超时 30 秒、输入上限 500,000 UTF-16 code units、流式响应上限 512 KiB，超时、非 2xx、重定向、超限、空响应和严格 schema 错误均 fail closed，不重试、不返回部分结果、不 fallback。

请求的 system 与 contract data 分消息；正文只包含 masker 输出和不含明文的主体存在性事实，无工具、无网络/文件/数据库权限。模型仅返回结构化 finding draft（页码 + 非 PII excerpt，不信任模型给出的 canonical offset）；Task 11 必须让规则引擎、AI excerpt 重定位和 SafetyGate 统一使用同一份 **脱敏后的 canonical pages**。不得把脱敏 excerpt 回映到含 PII 的原始页，也不得把原始页作为最终 finding 的证据坐标空间。原始请求正文和原始模型响应不得写日志、异常或审计。

- [ ] **Step 4: 运行安全单测与源码反向门禁**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register --experimental-test-coverage --test-coverage-branches=80 --test-coverage-lines=80 --test-coverage-functions=80 '--test-coverage-include=src/contract-review/contract-review-pii-masker.ts' '--test-coverage-include=src/contract-review/contract-review-provider.service.ts' src/contract-review/__tests__/contract-review-pii-masker.test.ts src/contract-review/__tests__/contract-review-provider.test.ts && ! rg "LlmConfigService|AiModelFeatureKey|llm-chat.service|llm-config.service" services/api/src/contract-review`

Expected: PASS；反向搜索无命中。

- [ ] **Step 5: 提交**

```bash
git add services/api/src/contract-review
git commit -m "feat: add compliant contract model channel"
```

### Task 10: 实现 ContractReviewSafetyGate

**Files:**
- Create: `services/api/src/contract-review/contract-review-safety-gate.service.ts`
- Create: `services/api/src/contract-review/contract-review-safety-semantics.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-safety-gate.test.ts`
- Modify: `services/api/src/contract-review/contract-review.types.ts`

- [ ] **Step 1: 写严格 schema、证据、规则冲突、输出边界和 PII 红队失败测试**

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import type { ContractReviewResult } from '@ai-job-print/shared'
import { ContractReviewSafetyGate } from '../contract-review-safety-gate.service'

const gate = new ContractReviewSafetyGate()
const canonicalPages = [{ pageNumber: 1, text: '试用期六个月' }]
const validResult: ContractReviewResult = {
  priorityCheckCount: 1, attentionCount: 0, insufficientInfoCount: 0,
  coverage: 'complete', ocrConfidence: 'high', disclaimerVersion: 'active-disclaimer-v1',
  rulePackVersion: 'cn-labor-p0-v1', generatedByAi: true,
  findings: [{
    id: 'f1', category: 'probation', priority: 'priority_check', title: '核实试用期',
    evidence: { pageNumber: 1, excerpt: '试用期六个月', charStart: 0, charEnd: 6 },
    explanation: '建议结合合同期限核实', basisRef: 'labor-contract-law:19',
    verificationQuestion: '合同期限是多少？', uncertainty: '', source: 'rule_and_ai',
  }],
}
const context = {
  expectedDisclaimerVersion: 'active-disclaimer-v1',
  expectedOcrConfidence: 'high' as const,
  expectedCoverage: 'complete' as const,
  hasFieldConflict: false,
  authoritativeRuleFindings: [{ ...structuredClone(validResult.findings[0]!), source: 'rule' as const }],
}
const candidates = [
  { name: 'wrong offset', result: { ...validResult, findings: [{ ...validResult.findings[0]!, evidence: { pageNumber: 1, excerpt: '试用期六个月', charStart: 1, charEnd: 7 } }] } },
  { name: 'unknown basis', result: { ...validResult, findings: [{ ...validResult.findings[0]!, basisRef: 'fake-law:1' }] } },
  { name: 'legal conclusion', result: { ...validResult, findings: [{ ...validResult.findings[0]!, explanation: '合同无效' }] } },
  { name: 'PII leak', result: { ...validResult, findings: [{ ...validResult.findings[0]!, explanation: '身份证号370101199001011234' }] } },
] satisfies Array<{ name: string; result: ContractReviewResult }>

for (const candidate of candidates) {
  test(`rejects unsafe result: ${candidate.name}`, () => {
    assert.throws(
      () => gate.validate(candidate.result, canonicalPages, context),
      (error) => error instanceof Error && error.message === 'CONTRACT_SAFETY_GATE_REJECTED',
    )
  })
}
test('accepts a schema-valid evidence-backed result', () => {
  assert.equal(gate.validate(validResult, canonicalPages, context).generatedByAi, true)
})
```

RED 矩阵必须覆盖：顶层 / finding / evidence 精确键集，拒绝额外键、accessor、错误原型、非法枚举、`NaN` / `Infinity` / 非安全整数、重复 finding id；最多 100 条 finding。SafetyGate 的终态字符串上限为 id 64、title 120、excerpt 500、explanation 2,000、basisRef 120、verificationQuestion / uncertainty 500 UTF-16 code units；除 Task 10 新增的 id 上限外，其余与 Task 9 provider 对齐。三个计数字段必须分别等于对应 priority 的 finding 数量，且三者之和必须等于 findings 总数。

`services/api` 是隔离 CommonJS root，按现有 `contract-review.types.ts` 约定不得直接 runtime import shared ESM。Task 10 必须在该 API mirror 中 additive 补齐与 `packages/shared/src/types/contractReview.ts` 结构完全一致的 Result / Finding / Category / Priority 类型；测试读取两侧声明做精确防漂移。招聘禁词在 SafetyGate 内使用 runtime-local readonly mirror，并由测试断言完整包含 shared `COMPLIANCE_FORBIDDEN_TERMS` 六个字面量；不得修改 package 依赖、tsconfig 或复制一套可漂移而无门禁的契约。

canonical pages 必须是 1–50 个连续页码的 NFC + LF 文本，单页 200,000、整份 2,000,000 UTF-16 code units；稀疏数组、重复/跳号页、CR、非 canonical Unicode、越界或畸形对象均拒绝。`priority_check` / `attention` 必须有非空、可按 UTF-16 `slice(charStart, charEnd)` 精确还原的 evidence；`insufficient_info` 可使用完整可定位证据或全空 null tuple，禁止半空结构。

所有非 null `basisRef` 必须在 `BASIS_ALLOWLIST`，`priority_check` 及 `rule` / `rule_and_ai` finding 必须有 basis。测试必须覆盖确定性法律结论、诉讼承诺、平台投递 / 企业收简历 / 候选人筛选推荐等越界能力、已知 prompt-injection 标记和中英文变体，以及上述危险语义和 PII 在 title / excerpt / explanation / question / uncertainty 的跨字段 / 跨 finding 拆分重组。PII 检查必须复用 Task 9 `assertNoHighConfidencePii`，不得另建缩水正则；安全扫描必须基于剥离伪造官方 uncertainty 文案后的终态文本，禁止扫描后变换重新拼出 PII 或禁用结论。

`ContractReviewSafetyContext` 必须绑定任务真相：`expectedDisclaimerVersion`、`expectedOcrConfidence`、`expectedCoverage`、`hasFieldConflict` 和 Task 11 映射后的 `authoritativeRuleFindings`。结果中的 disclaimer / OCR / coverage 必须与 context 精确一致，rulePackVersion 必须等于 `CONTRACT_RULE_PACK_VERSION`。规则 finding 以 `id` 唯一匹配最终结果，category / priority / basisRef / evidence / title / explanation 不得被 LLM 覆盖，最终 source 只能为 `rule` 或 `rule_and_ai`；缺失、降级、重复 id 或同 id AI 冒充均拒绝。

导出并冻结三条确定性文案常量：`CONTRACT_SAFETY_LOW_OCR_NOTICE = '文字识别置信度较低，请以合同原件为准。'`、`CONTRACT_SAFETY_TRUNCATED_NOTICE = '本次仅分析了部分内容，未覆盖部分需要人工核对。'`、`CONTRACT_SAFETY_FIELD_CONFLICT_NOTICE = '提取字段存在冲突，请结合合同原件人工核对。'`。仅以 context 真相触发：`expectedOcrConfidence === 'low'` 触发 LOW_OCR，`expectedCoverage === 'truncated'` 触发 TRUNCATED，`hasFieldConflict === true` 触发 FIELD_CONFLICT；按该固定顺序把尚未包含的整句用 `；` 追加到每条 finding.uncertainty。不得重复追加，追加后仍须不超过 500 UTF-16 code units，否则整份拒绝。测试分别覆盖三个单独触发、组合顺序、已有文案去重、顶层结果伪造与长度越界。输入不得被修改，返回值必须递归冻结。所有失败只抛固定 `CONTRACT_SAFETY_GATE_REJECTED`，不得携带原因子码、合同片段或模型原文。

- [ ] **Step 2: 运行并确认 SafetyGate 不存在**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register src/contract-review/__tests__/contract-review-safety-gate.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现八项放行检查与规则权威上下文**

```typescript
validate(
  result: unknown,
  pages: unknown,
  context: unknown,
): ContractReviewResult {
  try {
    const checked = assertExactSchemaCountsAndBudgets(result)
    const canonicalPages = assertCanonicalPages(pages)
    const safetyContext = assertSafetyContext(context)
    assertExpectedTaskTruth(checked, safetyContext)
    assertBasisAllowlistAndEvidence(checked, canonicalPages)
    assertNoDeterministicLegalOrProductConclusion(checked)
    assertNoPromptInjectionEcho(checked)
    assertNoHighConfidencePii(findingTextFragments(checked))
    assertAuthoritativeRulesPreserved(checked, safetyContext.authoritativeRuleFindings)
    return addMandatoryUncertaintyAndDeepFreeze(checked, safetyContext)
  } catch {
    throw new Error('CONTRACT_SAFETY_GATE_REJECTED')
  }
}
```

八项放行检查固定为：① strict runtime schema + keys / 枚举 / 长度 / 数量 / 唯一 id / 计数一致性；② `basisRef` 与版本白名单；③ canonical pages 和 UTF-16 证据切片；④ 禁止确定性法律结论、诉讼承诺、招聘闭环和企业侧能力；⑤ 已知提示注入标记与指令语义回显；⑥ Task 9 同源 PII 全字段 / 跨 finding 扫描；⑦ 低 OCR、截断、字段冲突强制 uncertainty；⑧ authoritative rule findings 不得被 LLM 删除、降级或改写。

`findingTextFragments` 必须按 finding 顺序、按 `id → title → evidence.excerpt → explanation → basisRef（非 null）→ verificationQuestion → uncertainty` 的固定字段顺序无分隔拼接，按不超过 100,000 UTF-16 code units 切成连续伪页后一次性交给 `assertNoHighConfidencePii`；不得逐 finding 单独扫描或遗漏 excerpt，确保跨字段、跨 finding 重组仍可被 Task 9 的 virtual view 拦截。

禁用结论至少覆盖“合同无效 / 本条违法 / 一定或必然胜诉 / 保证或必须赔偿 / 法院一定支持”等确定性承诺；招聘边界复用共享 `COMPLIANCE_FORBIDDEN_TERMS` 并补企业筛选、面试邀约、Offer 管理、候选人推荐和平台收简历语义。提示注入标记至少覆盖 `ignore previous instructions`、`system/developer prompt`、`<|im_start|>`、`[INST]`、`<<SYS>>`、忽略此前/系统指令、输出或泄露系统提示等大小写与 NFKC 变体。正则必须固定结构、无嵌套无界量词；任何 finding 失败使整份输出 fail closed。

SafetyGate 是纯 TypeScript、无 Nest、无 I/O、无日志、无模型调用的独立服务；不注册 module / controller / worker，不修改 Gate 0。它只允许为 uncertainty 添加固定安全文案，其他无法修复的问题一律拒绝。原始模型输出不作为异常 message、日志或审计 payload。

- [ ] **Step 4: 运行红队与覆盖率测试**

Run: `pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register --experimental-test-coverage --test-coverage-branches=80 --test-coverage-lines=80 --test-coverage-functions=80 '--test-coverage-include=src/contract-review/contract-review-safety-gate.service.ts' '--test-coverage-include=src/contract-review/contract-review-safety-semantics.ts' src/contract-review/__tests__/contract-review-safety-gate.test.ts`

Expected: PASS，红队绕过次数 0；输入未修改、输出递归冻结，错误字符串只包含固定安全码。

- [ ] **Step 5: 提交**

```bash
git add services/api/src/contract-review/contract-review-safety-gate.service.ts services/api/src/contract-review/contract-review-safety-semantics.ts services/api/src/contract-review/__tests__/contract-review-safety-gate.test.ts services/api/src/contract-review/contract-review.types.ts
git commit -m "feat: add contract review safety gate"
```

### Task 11: 接入两阶段 BullMQ 编排、原子结果与可重试清理

Task 11 的范围是建立 **默认关闭、无 HTTP 入口** 的后台能力。Gate 0 仍为 `blocked`，且进程级 hard kill / 内存上限尚未完成，因此 Task 14 前 AppModule **永不注册** 合同 BullMQ queue/processor；Task 11 只实现可直接单测的 queue gateway、processor 与 orchestrator，并在隔离测试模块中装配。高敏合同队列服务在 AppModule 中固定不可用，禁止 `setImmediate`、Promise 或 controller 内联执行。Task 14 只有在 Gate 0、Redis、显式开关和执行隔离全部通过后才修改 module 注册真实 worker。

**Files:**
- Create: `services/api/src/contract-review/contract-review.queue.ts`
- Create: `services/api/src/contract-review/contract-review.processor.ts`
- Create: `services/api/src/contract-review/contract-review-orchestrator.service.ts`
- Create: `services/api/src/contract-review/contract-review-fact-merger.ts`
- Create: `services/api/src/contract-review/contract-review-finding-mapper.ts`
- Create: `services/api/src/contract-review/contract-review.cleanup.task.ts`
- Create: `services/api/src/contract-review/contract-review.module.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-fact-merger.test.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-finding-mapper.test.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-orchestrator.test.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-processor.test.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-cleanup.test.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-module.test.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-sensitive-delete.test.ts`
- Create: `services/api/prisma/migrations/20260801130000_add_contract_review_confirmation_checkpoint/migration.sql`
- Create: `services/api/prisma/postgres/migrations/20260801130000_add_contract_review_confirmation_checkpoint/migration.sql`
- Modify: `services/api/src/contract-review/contract-review-provider.service.ts`
- Modify: `services/api/src/contract-review/contract-review-extraction.service.ts`
- Modify: `services/api/src/contract-review/__tests__/contract-review-extraction.test.ts`
- Modify: `services/api/src/contract-review/__tests__/contract-review-provider.test.ts`
- Modify: `services/api/src/contract-review/__tests__/contract-review-schema.test.ts`
- Modify: `services/api/src/files/files.service.ts`
- Modify: `services/api/src/files/files.cleanup.task.ts`
- Modify: `services/api/src/prisma/prisma.service.ts`
- Modify: `services/api/prisma/schema.prisma`
- Modify: `services/api/prisma/postgres/schema.prisma`
- Modify: `services/api/src/app.module.ts`
- Modify: `docs/superpowers/plans/2026-08-01-ai-contract-review.md`

`contract-review-orchestrator.service.ts` 目标 300–450 行且只负责编排；事实抽取、finding 映射和清理必须留在独立文件，禁止形成新的 800 行服务。测试按事实、编排、processor、清理拆分，禁止把所有矩阵继续堆入一个超长测试文件。

- [x] **Step 1: 写两阶段、证据坐标、原子落库和清理重试的 RED 测试**

```typescript
test('extract job stops at awaiting_confirmation and never calls provider', async () => {
  await orchestrator.extract('task-1')
  assert.equal(lastTaskWrite().status, 'awaiting_confirmation')
  assert.equal(provider.reviewWithIdentity.mock.calls.length, 0)
})

test('analyze job uses masked canonical pages for rules, AI offsets and SafetyGate', async () => {
  await orchestrator.analyze('task-1')
  assert.deepEqual(ruleEngine.evaluate.mock.calls[0][0].canonicalPages, masked.pages)
  assert.deepEqual(gate.validate.mock.calls[0][1], masked.pages)
  assert.equal(gate.validate.mock.calls[0][2].expectedDisclaimerVersion, task.disclaimerVersion)
  assert.equal(gate.validate.mock.calls[0][2].expectedOcrConfidence, extraction.ocrConfidence ?? 'high')
  assert.equal(gate.validate.mock.calls[0][2].expectedCoverage, extraction.truncated ? 'truncated' : 'complete')
  assert.equal(gate.validate.mock.calls[0][2].hasFieldConflict, merged.hasFieldConflict)
})

test('raw model output is never persisted before safety approval', async () => {
  gate.validate.mockImplementation(() => { throw new Error('CONTRACT_SAFETY_GATE_REJECTED') })
  await assert.rejects(() => orchestrator.analyze('task-1'))
  assert.equal(allTaskWrites().some((write) => write.data?.resultJson !== undefined), false)
})

test('validated result and completed status use one CAS transaction', async () => {
  await orchestrator.analyze('task-1')
  assert.equal(prisma.$transaction.mock.calls.length, 1)
  assert.equal(finalTransactionWrite().where.status, 'safety_reviewing')
  assert.equal(finalTransactionWrite().data.status, 'completed')
})
```

同批 RED 还必须覆盖：

- `extract` 和 `analyze` 两个 job name 严格分流，未知 name / 空 taskId 固定拒绝；jobId 按阶段 + taskId 幂等。extract 可有限重试，analyze 因包含模型调用固定 `attempts:1`，不得违反 Task 9 的模型不重试约束。
- `uploaded → queued → extracting → awaiting_confirmation` 后必须停住。Extraction 必须对它本次实际读取的 buffer 当场计算 `sourceSha256/sourceSizeBytes` 并随结果返回，禁止另查或信任可能与对象不同步的 `FileObject.sha256`。Stage 1 持久化的 `extractionFingerprint` 是 `sourceFileId + 实际 buffer SHA-256/size + extraction mode/totalPages + schemaVersion` 的版本化 SHA-256，不含正文。
- Task 12 的 confirm 在归属校验后持久化 `confirmedAt` 并 CAS `awaiting_confirmation → rule_checking`，该状态变更就是不可绕过的用户确认事实。analyze job 只接受 `status:'rule_checking' + confirmedAt 非空 + extractionFingerprint 非空`，不得自行从 `awaiting_confirmation` 推进；直接投递 job 无法绕过确认。
- Stage 2 为避免持久化合同正文，允许在用户确认后重新提取一次；必须重算并精确匹配 `extractionFingerprint`，而不只是比较页数。同一 source file 的不可变 SHA、大小、解析模式或页数任一漂移都 fail closed。
- 纯文本层 `ocrConfidence:null` 由服务端固定映射为 `high`；模型不得提供或覆盖 disclaimer/OCR/coverage/rulePackVersion。
- 事实合并器对同一字段多个不同值输出 `hasFieldConflict:true` 并把该字段降为 unknown；不得任意选择一个值。无可靠事实时保持 `undefined`，让规则引擎输出 `insufficient_info`，不得猜测。
- 规则引擎只接收脱敏 canonical pages；权威规则 finding 用固定 rule-id 映射表补 category/question/uncertainty。AI finding 的 excerpt 只在声明 page 的脱敏文本中做 **唯一精确匹配** 并生成 UTF-16 `charStart/charEnd`；0 次或多次命中均 fail closed。`pageNumber:null` 只允许映射为无证据的 `insufficient_info`。
- provider 返回 draft 与实际使用的 provider/model identity 必须由同一次配置快照产生；不得 review 后再次读取易变 env 反推 identity。
- provider 的 `reviewWithIdentity` 回归必须补入既有 provider 测试；module 测试必须证明 AppModule 在 `REDIS_URL` / 运行时开关任意组合下都不注册合同 processor，默认 provider runtime 也不会在启动时解析密钥或解除 Gate 0。
- provider 未批准、SafetyGate 拒绝、超时、取消、过期、CAS 竞争和最终 BullMQ attempt 失败都只写固定 error code / 固定安全文案，不写原始异常、合同文本或模型响应。五分钟超时 CAS 为 `failed/CONTRACT_REVIEW_TIMEOUT`，用户取消保持 `cancelled`，TTL 保持 `expired`；所有迟到结果由最终 CAS 拒绝。
- analyze 不从 `ai_analyzing/safety_reviewing` 恢复或再次调用模型；worker 崩溃后的该任务固定失败并要求用户新建任务。Task 14 的 child-process runner 也必须保持单次模型调用语义。
- 规则 finding 永不丢弃。provider draft 与规则映射合计超过 SafetyGate 100 条上限时整体拒绝；禁止切掉规则，也禁止静默截断 AI finding。
- 清理单条物理删除失败时保留 `expired` task，下一次 cron 继续选择并重试；成功或已被通用 file cleanup 删除时幂等收口。共享同一 source file 的未过期任务仍存在时不得删除该文件。
- 合同清理必须调用 `FilesService.systemDeleteSensitive`（或等价受控入口）；其成功日志只含 fileId 摘要。测试必须证明现有 `_delete` 的完整 fileId 日志不会出现在高敏删除路径。

- [x] **Step 2: 运行并确认新组件不存在或断言失败**

Run:

```bash
pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register \
  src/contract-review/__tests__/contract-review-extraction.test.ts \
  src/contract-review/__tests__/contract-review-fact-merger.test.ts \
  src/contract-review/__tests__/contract-review-finding-mapper.test.ts \
  src/contract-review/__tests__/contract-review-orchestrator.test.ts \
  src/contract-review/__tests__/contract-review-processor.test.ts \
  src/contract-review/__tests__/contract-review-cleanup.test.ts \
  src/contract-review/__tests__/contract-review-module.test.ts \
  src/contract-review/__tests__/contract-review-sensitive-delete.test.ts \
  src/contract-review/__tests__/contract-review-provider.test.ts \
  src/contract-review/__tests__/contract-review-schema.test.ts
```

Expected: FAIL。

- [x] **Step 3: 实现无 inline fallback 的两阶段队列和恢复点**

```typescript
export const CONTRACT_REVIEW_QUEUE = 'contract-review'
export const CONTRACT_REVIEW_EXTRACT_JOB = 'contract-review.extract'
export const CONTRACT_REVIEW_ANALYZE_JOB = 'contract-review.analyze'
export interface ContractReviewJobData { readonly taskId: string }

@Processor(CONTRACT_REVIEW_QUEUE)
export class ContractReviewProcessor extends WorkerHost {
  async process(job: Job<ContractReviewJobData>): Promise<unknown> {
    assertContractReviewJob(job)
    if (job.name === CONTRACT_REVIEW_EXTRACT_JOB) return this.orchestrator.extract(job.data.taskId)
    if (job.name === CONTRACT_REVIEW_ANALYZE_JOB) return this.orchestrator.analyze(job.data.taskId)
    throw new Error('CONTRACT_REVIEW_JOB_INVALID')
  }
}
```

`ContractReviewQueueService` 可接受显式注入的 Queue adapter；未注入时 `enqueueExtract/enqueueAnalyze` 只抛 `CONTRACT_REVIEW_QUEUE_UNAVAILABLE`。`ContractReviewModule` 在 AppModule 中只注册 service、清理任务、不可用 queue gateway 和默认拒绝 provider runtime；**不得** `BullModule.registerQueue`，也不得注册 processor。processor 和 mock queue 只在本任务的隔离单测模块中装配。模块启动不得实例化会因 Gate 0 默认拒绝而抛错的真实 `ContractReviewProviderService`，真实 provider runtime 与 BullMQ 注册都留给 Task 14。

extract job 使用 CAS 逐步推进，重试时允许从 `extracting` 重做本阶段；它只持久化页数、进度、OCR provider/confidence、coverage、版本化 `extractionFingerprint` 与 `awaiting_confirmation`，**不持久化原始页文本或事实全文**。analyze job 只从 Task 12 已确认的 `rule_checking` 单次执行；所有 canonical 原文、脱敏页、事实和 model draft 只存在于当前进程内存。进入 `ai_analyzing` 后的异常固定收敛到 failed，不允许 worker 自动重放模型调用。

每个 job 从 worker 实际开始时计算五分钟协作式 budget，在昂贵步骤前后及 extraction `onPageComplete` 中重读 task 状态与 deadline；发现 cancelled/expired/超时后不得开始下一页 OCR 或 LLM。必须诚实记录：这只能在页边界和网络调用边界停止，不能终止已经进入的第三方原生 PDF/DOCX 解析；真正的进程级 hard kill 与内存上限是 Task 14 启用生产入口前的阻断项。

- [x] **Step 4: 实现统一脱敏坐标、SafetyGate server truth 和最终事务**

为持久化确认真相，先给双 Prisma schema 添加 nullable `extractionFingerprint String?` 与 `confirmedAt DateTime?`，并用新的 additive SQLite/PostgreSQL migration 演进；更新 schema parity 测试并运行 fresh migration drift。不得回写或改写已经封板的 Task 3 migration。

`ContractReviewFactMerger` 是纯 TypeScript、无 Nest/I/O/Date/日志/模型调用的保守解析器，只提取 Task 8 确定性子集需要的事实并显式检测冲突。它和规则引擎都接收 masker 输出页，禁止再次接触未遮蔽页。

`ContractReviewFindingMapper` 固定完成三件事：

1. 以版本化静态表把 Task 8 `ruleId` 映射成共享 finding，保留 `id=ruleId`、basis 和脱敏 evidence；未知 rule id 立即拒绝。
2. 把 provider draft 映射为 `source:'ai'` finding，id 用不含正文的确定性摘要生成，证据仅在脱敏页内唯一定位。
3. 只做拼接和计数，不让 AI 覆盖同 id 规则 finding；规则 authoritative 集合原样传入 SafetyGate。规则 + AI 超过 100 条立即拒绝，不截断任何一方。

调用 SafetyGate 时显式组装：

```typescript
const context: ContractReviewSafetyContext = {
  expectedDisclaimerVersion: task.disclaimerVersion,
  expectedOcrConfidence: extraction.ocrConfidence ?? 'high',
  expectedCoverage: extraction.truncated ? 'truncated' : 'complete',
  hasFieldConflict: merged.hasFieldConflict,
  authoritativeRuleFindings,
}
const validated = gate.validate(candidateResult, masked.pages, context)
```

SafetyGate 通过后，唯一一次 `$transaction` 内用 `updateMany where { id, status:'safety_reviewing', expiresAt:{gt:now} }` 同时写 `resultJson/status:'completed'/aiProvider/aiModel/ocrProvider/ocrConfidence/professionalConsultationRecommended`；影响行数不是 1 则整笔回滚。事务外不得写 `resultJson`，也不得把 candidate/raw draft 放进 Redis、错误、日志或审计。

- [x] **Step 5: 实现无需新增清理重试字段的 TTL 清理**

清理 cron 每批最多处理固定数量的 `expiresAt <= now` task：先对当前 status 做 CAS 到 `expired`，再处理已 `expired` 的遗留行。每个 fileId 删除前读取 `FileObject`：不存在或 `deletedAt != null` 视为幂等完成；仍被其他未过期合同任务引用时跳过物理删除；否则调用新增的 `FilesService.systemDeleteSensitive`。该入口复用现有 storage + DB 删除语义，但成功日志只写不可逆摘要，不写完整 fileId。删除抛错后重新读取 `FileObject`，只有 DB 已证明 deleted 才视为成功。

全部需删除对象完成或因活跃共享引用而正确延期后，删除已过期 task 行，使 `resultJson/accessTokenHash` 一并退出数据库；任一对象失败则保留 `expired` task，下一轮 cron 自动重试。日志只允许固定 `code`、计数和 taskId 摘要，禁止原始 error message、fileId、文件名、路径、正文、token 或模型内容。该设计不新增 `cleanupRetryCount`，以“expired 行仍存在”作为持久重试账本。

- [x] **Step 6: 运行覆盖率、全量合同回归和 API 门禁**

Run:

```bash
pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register \
  --experimental-test-coverage \
  --test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80 \
  --test-coverage-include=src/contract-review/contract-review.queue.ts \
  --test-coverage-include=src/contract-review/contract-review.processor.ts \
  --test-coverage-include=src/contract-review/contract-review-orchestrator.service.ts \
  --test-coverage-include=src/contract-review/contract-review-fact-merger.ts \
  --test-coverage-include=src/contract-review/contract-review-finding-mapper.ts \
  --test-coverage-include=src/contract-review/contract-review.cleanup.task.ts \
  src/contract-review/__tests__/contract-review-fact-merger.test.ts \
  src/contract-review/__tests__/contract-review-finding-mapper.test.ts \
  src/contract-review/__tests__/contract-review-orchestrator.test.ts \
  src/contract-review/__tests__/contract-review-processor.test.ts \
  src/contract-review/__tests__/contract-review-cleanup.test.ts \
  src/contract-review/__tests__/contract-review-module.test.ts \
  src/contract-review/__tests__/contract-review-sensitive-delete.test.ts
pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register 'src/contract-review/__tests__/*.test.ts'
pnpm --filter @ai-job-print/api verify:contract-review:schema
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/api verify:contract-review:gate0
```

Expected: PASS；Gate 0 仍显示 `blocked`，默认运行时不开队列/processor，且没有 HTTP 入口。

- [x] **Step 7: 双模型审查后提交**

```bash
git add \
  services/api/src/contract-review \
  services/api/src/files/files.service.ts \
  services/api/src/app.module.ts \
  services/api/prisma/schema.prisma \
  services/api/prisma/postgres/schema.prisma \
  services/api/prisma/migrations/20260801130000_add_contract_review_confirmation_checkpoint/migration.sql \
  services/api/prisma/postgres/migrations/20260801130000_add_contract_review_confirmation_checkpoint/migration.sql \
  docs/superpowers/plans/2026-08-01-ai-contract-review.md \
  .ccg/tasks/contract-review-professional-design
git commit -m "feat: orchestrate contract review jobs"
```

### Task 12: 暴露最小 HTTP API 与真实轮询

文件预算门禁：`contract-review.service.ts` 在 Task 6 已达约 479 行，Task 12 新增 `get/getConsentScope/confirm/remove/createReport` 前必须先把 consent snapshot / access 或持久化职责拆到独立文件；不得让该 service 跨过 500 行后继续堆叠。Task 6 的 `contract-review-service.test.ts` 已 999 行，Task 12 只能新建 HTTP/服务分层测试，禁止继续向该文件追加。

Task 12 只接线 Task 11 的队列服务：create 持久化成功后必须 `enqueueExtract`；confirm 完成归属、`awaiting_confirmation` 和 `extractionFingerprint` 校验后，在数据库中写 `confirmedAt` 并 CAS 到 `rule_checking`，再 `enqueueAnalyze`。这个 CAS 是用户确认事件的持久化真相，不是 controller 伪造后台进度；analyze processor 不能从 `awaiting_confirmation` 自行推进。两者都禁止在 HTTP 线程内联执行。enqueue 失败时 create 将新 task CAS 为 `expired` 且把 `expiresAt` 收紧为当前时间后返回 503；confirm enqueue 失败则保留已确认的 `rule_checking`，同一归属用户重试 confirm 时只允许幂等补发同 jobId，不得重复改写 `confirmedAt`。匿名 create 在 enqueue 成功前不得把 access token 返回客户端。

为避免上述边界被 controller 分裂，HTTP 编排固定收口到新的 `ContractReviewLifecycleService`：controller 只解析 requester、调用一个 lifecycle 方法并包装 `ApiResponse`，不直接调 queue/Prisma/清理。`createAndEnqueue` 在队列成功前只在调用栈内保持匿名明文 token；队列抛错后对 `uploaded/queued/extracting/awaiting_confirmation` 做 fail-closed CAS 到 `expired + expiresAt=now`，即使 CAS 因竞争为 0 也只返 503 且永不返 token。`confirmAndEnqueue` 首次确认与重试补发走同一方法，已是 `rule_checking + confirmedAt` 时只补发确定性 analyze jobId。

由于 Task 14 之前尚无可终止的进程隔离与 Gate 0 批准 runtime，`ContractReviewController` 只能由不被 AppModule 引用的独立 `ContractReviewHttpModule` 显式装配供 verifier/单测使用；禁止通过 env 分支或“测试开关”改变默认 Module 元数据。默认 AppModule 仍无生产合同 HTTP 路由。Task 12 的“路由通过”表示测试模块契约通过，不表示生产入口已启用。

**Files:**
- Create: `services/api/src/contract-review/dto/contract-review.dto.ts`
- Create: `services/api/src/contract-review/contract-review.controller.ts`
- Create: `services/api/src/contract-review/contract-review-consent.service.ts`
- Create: `services/api/src/contract-review/contract-review-lifecycle.service.ts`
- Create: `services/api/src/contract-review/contract-review-task-access.ts`
- Create: `services/api/src/contract-review/contract-review-task-view.mapper.ts`
- Create: `services/api/src/contract-review/contract-review-http.module.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-lifecycle.test.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-http-controller.test.ts`
- Create: `services/api/scripts/verify-contract-review-http.ts`
- Modify: `services/api/src/contract-review/contract-review.service.ts`
- Modify: `services/api/src/contract-review/contract-review.types.ts`
- Modify: `services/api/src/contract-review/contract-review.cleanup.task.ts`
- Modify: `services/api/src/contract-review/__tests__/contract-review-cleanup.test.ts`
- Modify: `services/api/src/contract-review/contract-review-safety-gate.service.ts`
- Modify: `services/api/src/contract-review/__tests__/contract-review-safety-gate.test.ts`
- Modify: `services/api/src/contract-review/contract-review.module.ts`
- Modify: `services/api/package.json`
- Modify: `docs/superpowers/plans/2026-08-01-ai-contract-review.md`

`ContractReviewConsentService` 承接唯一 active disclaimer 查询、合法性检查和 scope snapshot；`ContractReviewTaskAccess` 只做 member/token 同形 404 归属校验；task-view mapper 是纯函数，只在 `status === 'completed'` 时解析并返回 `resultJson`。Task 6 的 `ContractReviewService.create()` 仍是可返回匿名明文 token 的内部持久化 primitive，只允许 lifecycle 调用；本次必须把 `ContractReviewService` 从模块 exports 移除，controller/外部模块不能注入或直连它，模块只公开 lifecycle/consent/queue 所需边界。`ContractReviewHttpModule` 不得被 AppModule 或默认 `ContractReviewModule` import，它只供 Task 12 verifier/单测显式装配 controller；Task 14 达成所有生产门禁后再决定生产注册。

行数预算：`ContractReviewLifecycleService` 300–450 行，controller 不超过 180 行，consent/access/mapper 各自不超过 200 行；两个新增测试文件各不超过 600 行，按 lifecycle 并发/持久化语义与真实 HTTP/DTO/限流契约拆分。默认 `ContractReviewModule` 本次只能增加/导出 consent 与 lifecycle provider，其 metadata 必须继续零 controller、零 Bull queue/processor、零 `ContractReviewHttpModule` import，模块测试必须对此做精确断言。

DELETE 要求真正“立即删除”，因此 Task 11 cleanup 必须暴露一个按 taskId 精确处理的受控方法 `purgeExpiredTaskById(taskId)`：lifecycle 先完成归属校验，再把当前状态 CAS 为 `expired` 并同步写 `expiresAt=now`，随后调用该方法删除原件/派生件和 task 行；它与 cron 复用同一共享引用、幂等删除和脱敏日志语义，不复制第二套删除实现。只有 task 行确认已删除（或被并发 cleanup 删除）才返回 `{ id, deleted: true }`；任一待删物理对象失败时必须保留 `expired + expiresAt<=now` 的 task 行并抛固定 503 `CONTRACT_REVIEW_DELETE_RETRY`，让下一轮 DELETE 或 cron 可立即重试，禁止返回假成功。

- [ ] **Step 1: 写 HTTP 归属和错误同形失败验证**

```typescript
assert.equal((await request('GET', `/contract-reviews/${otherId}`, memberA)).status, 404)
assert.equal((await request('GET', `/contract-reviews/${missingId}`, memberA)).status, 404)
assert.equal((await request('GET', `/contract-reviews/${anonymousId}`, { 'x-contract-review-access-token': 'wrong' })).status, 404)
assert.equal((await request('POST', '/contract-reviews', anonymousWithoutConsent)).status, 400)
assert.equal((await request('POST', '/contract-reviews', anonymousWithoutSourceProof)).status, 404)
assert.equal((await request('POST', '/contract-reviews', anonymousWithWrongFileProof)).status, 404)
assert.equal((await request('GET', '/contract-reviews/consent-scope')).status, 200)
assert.equal((await request('POST', `/contract-reviews/${id}/confirm`, validConfirm)).status, 202)
assert.equal((await request('POST', `/contract-reviews/${id}/report`)).status, 503)
```

同批 RED 还必须覆盖：匿名 create 入队成功才返 token，入队失败时 503 + 无 token + task 转 expired；confirm 入队失败后保留原 `confirmedAt/rule_checking`，同归属重试只补发同 jobId 且不重写时间；GET 在非 completed 状态即使库中存在 `resultJson` 也固定返 `result:null`；GET/confirm/report/delete 的跨会员、错 token、无 token、会员访问匿名 task 均与不存在完全同形 404；默认 Module/AppModule 继续无合同 controller，只有显式 HttpModule harness 路由通过。

还必须显式断言：会员 create 永不返 accessToken；Confirm DTO 缺字段、多字段、页数/截断不匹配或两个声明不是字面量 `true` 均 400 且不写 `confirmedAt`；匿名 token 的空值、错误长度、非法 hex/base64 与超长值均走现有定长 hash/timing-safe verifier 并固定同形 404，不抛长度异常或泄露比较分支；completed 的持久化 JSON 解析/strict parser 失败只返固定 500 且不回显原 JSON；DELETE 在未到 TTL 时也立即把任务置为 `expired + expiresAt<=now` 并完成物理清理，首次对象删除失败保留可立即重试的 task 行且第二次 DELETE/cron 能成功，存在共享文件引用时保留共享对象但仍删除当前 task 行。Task 6 旧 `contract-review-service.test.ts` 保留“持久化层明文 token 与 hash 匹配”的内部安全断言，但不再代表 HTTP 暴露时机；新 lifecycle/HTTP 测试是“队列成功后才暴露 token”的唯一外部契约。禁止继续向 999 行旧测试追加用例。

并发 RED 不得省略：两个同归属 confirm 并发时只允许一次 CAS 写入 `confirmedAt`，CAS 失败方重读到 `rule_checking + confirmedAt` 后只补发同一个确定性 analyze jobId；jobId 继续严格复用 Task 11 已冻结的 `${jobName}.${taskId}`（即 `contract-review.analyze.${taskId}`），禁止时间戳、ULID 或请求级随机量。create 入队出现“队列可能已接收但客户端抛错”的模糊失败时，无论 worker 已推进到何状态，都不得泄露匿名 token或盲写覆盖 worker 终态。重复 queue add 可发生，但 adapter 必须依赖相同 jobId 去重。

- [ ] **Step 2: 运行并确认路由 404**

Run: `pnpm --filter @ai-job-print/api exec node -r @swc-node/register scripts/verify-contract-review-http.ts`

Expected: FAIL，合同审查路由不存在。

- [ ] **Step 3: 实现五个端点与限流**

```typescript
function headerOf(req: RequestLike, name: string): string | null {
  const value = req.headers?.[name.toLowerCase()]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value) && value[0]) return value[0].trim()
  return null
}

@Controller('contract-reviews')
export class ContractReviewController {
  constructor(
    private readonly lifecycle: ContractReviewLifecycleService,
    private readonly consent: ContractReviewConsentService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  private async requesterOf(
    req: RequestLike,
    includeSourceProof = false,
  ): Promise<ContractReviewRequester> {
    const member = await resolveOptionalEndUser(req.headers?.authorization, this.jwt, this.redis, this.prisma)
    return member
      ? { endUserId: member.endUserId, accessToken: null, sourceFileProof: null }
      : {
          endUserId: null,
          accessToken: headerOf(req, 'x-contract-review-access-token'),
          sourceFileProof: includeSourceProof
            ? headerOf(req, 'x-contract-review-source-file-proof')
            : null,
        }
  }

  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async create(@Body() dto: CreateContractReviewDto, @Req() req: RequestLike) {
    return ApiResponse.ok(await this.lifecycle.createAndEnqueue(
      dto,
      await this.requesterOf(req, true),
    ))
  }

  @Get('consent-scope')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async consentScope() {
    return ApiResponse.ok(await this.consent.getConsentScope())
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: RequestLike) {
    return ApiResponse.ok(await this.lifecycle.get(id, await this.requesterOf(req)))
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60_000, limit: 8 } })
  async confirm(@Param('id') id: string, @Body() dto: ConfirmContractReviewDto, @Req() req: RequestLike) {
    return ApiResponse.ok(await this.lifecycle.confirmAndEnqueue(
      id,
      dto,
      await this.requesterOf(req),
    ))
  }

  @Post(':id/report')
  @Throttle({ default: { ttl: 60_000, limit: 4 } })
  async report(@Param('id') id: string, @Req() req: RequestLike) {
    return ApiResponse.ok(await this.lifecycle.createReport(id, await this.requesterOf(req)))
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: RequestLike) {
    return ApiResponse.ok(await this.lifecycle.remove(id, await this.requesterOf(req)))
  }
}
```

Confirm DTO 固定为精确键：`contractType`、`totalPages`、`analyzedPages`、`truncated`、`ocrCoverageConfirmed: true`、`personalUseConfirmed: true`。页数/截断必须与任务持久化真相精确相等，两个声明必须是布尔字面量 `true`；`contractType` 允许用户在完整性确认时更正并与首次 CAS 同时写入。DTO 不接收 fingerprint、token、provider/model 或任何原文字段。Create 成功保持 Nest POST 的 `201 Created`；confirm 固定 `202 Accepted`；GET/DELETE 成功为 200；report 在 Task 14 前固定完成归属校验后返 503 `REPORT_NOT_AVAILABLE`。

`ContractReviewConsentService.getConsentScope()` 必须复用 Task 6 的唯一 active disclaimer 校验和 `createContractReviewConsentScopeSnapshot()`，返回当前免责声明 `id/version/content/publishedAt`、七项机器可读披露与服务端计算的 `consentScopeHash`；0 个/多个 active 文档继续 503 fail closed。Kiosk 必须先展示这份服务端内容并使用返回的 hash/version，不能在前端复制 canonical 算法或编造 hash。

为保证 Task 12 单独可编译，`ContractReviewLifecycleService.createReport()` 在 Task 14 接入 PDF 前先实现诚实的受控响应：完成归属校验后抛出 `REPORT_NOT_AVAILABLE`（503）；HTTP verify 必须断言该错误，不能返回假 fileId。Task 14 用真实短期派生文件实现替换该分支。

Requester 解析沿用 optional member 模式；匿名任务读写只读 `x-contract-review-access-token` header，匿名 create 另只读 `x-contract-review-source-file-proof` header，二者均禁止 query token。source-file proof 必须是当前上传响应的短期 signed content URL，不能持久化到 local/session storage、日志或审计 payload。Create DTO 只允许 `sourceFileId/contractType/consentVersion/consentedAt/consentScopeHash/disclaimerVersion`，全局 whitelist 拒绝额外字段。GET 仅 completed 返回 result；其余只返回真实 stage/page progress。

归属规则固定为：会员 task 只匹配精确 `endUserId`；匿名 task 只使用 `verifyAnonymousAccessToken()` 验证存储 hash；有效 member JWT 时 controller 忽略匿名/proof header，无效 JWT 按现有 optional-member 模式回落匿名且仍必须拥有相应 task token/proof。不存在、跨会员、错/缺 token、会员访问匿名 task 以及任何 GET/confirm/report/delete 的 proof 重放均返完全同形 404 `CONTRACT_REVIEW_TASK_NOT_FOUND`，不用 403 泄露存在性。归属正确且行仍存在的 `expired` 任务可返 200 `status:'expired'`；cleanup 删行后返 404。

Task-view mapper 仅输出共享 `ContractReviewTaskView` 定义的字段；非 `completed` 时无条件返 `result:null`，即使数据库异常存在 `resultJson`。Task 10 SafetyGate 必须导出它已有的 `parsePersistedContractReviewResult(value: unknown)` strict result-shape parser 供持久化读取复用，不复制第二套 schema；`completed` JSON 经 `JSON.parse` 后必须通过该 parser，失败只抛固定 `CONTRACT_REVIEW_RESULT_INVALID`，lifecycle 将其映射为不回显原 JSON 的固定 500。`errorMessage`、accessTokenHash、fingerprint、provider/model 不得进入 TaskView。

create 入队失败的多状态 CAS 只执行一次；影响行数为 0 时不再做盲写，不返 token，固定 503，已有终态/竞争行由原 `expiresAt` + Task 11 cleanup 最终收口。此取舍避免 HTTP 错误分支覆盖 worker 真实终态。

`ContractReviewHttpModule` 必须显式 import `ContractReviewModule`、`JwtVerifierModule`、`RedisModule`，但不在业务模块内重复注册全局限流守卫。测试 root module 单独 import `ThrottlerModule.forRoot(...)` 并注册 `APP_GUARD -> ThrottlerGuard`，同时像 `main.ts` 一样显式安装 `ValidationPipe({ whitelist:true, forbidNonWhitelisted:true, transform:true, exceptionFactory:... })` 与 `HttpExceptionFilter`，不得依赖 AppModule 的隐式全局状态。由于 `CONTRACT_REVIEW_QUEUE_ADAPTER` 在默认模块中是 optional 且未注册，harness 禁止对该 token 使用无效的 `overrideProvider`；必须 override 已注册且导出的 `ContractReviewQueueService`，其 value 为 `new ContractReviewQueueService(memoryAdapter)`，分别模拟成功、确定失败和“已接受后抛错”的模糊失败。真实 HTTP 测试必须覆盖未知 DTO 字段的统一 400、固定错误 envelope，以及 create/confirm/report 超限后的 429；默认 AppModule 仍不得 import 该 HttpModule。Task 14 若把 HttpModule 接入已有 `AppModule`，直接复用 AppModule 的单个全局 ThrottlerGuard，禁止再次注册造成双重计数。

`verify-contract-review-http.ts` 必须在同一脚本内依次启动并关闭两个独立 Nest application：第一段使用默认 `AppModule`，只断言所有合同路由为 404；第二段显式使用测试 `ContractReviewHttpModule` + 每例新建的内存 queue adapter，断言正向/错误/限流契约。两段不得复用同一个 application、端口、adapter 状态或全局容器；若必须 `listen`，只能使用 `listen(0)` 并读取 OS 分配端口，禁止 CI 硬编码端口，确保“默认关闭”与“隔离可验证”不是靠环境开关切换出来的假象。

DELETE 置为 `expired + expiresAt<=now` 后，即使客户端不再重试，也必须被 Task 11 已有周期 cleanup 的 `expiresAt<=now` 扫描选中并复用同一 purge 核心；新增回归测试要证明 HTTP 首次物理删除失败后，下一轮 `runOnce()` 能清掉该行，禁止仅依赖客户端第二次 DELETE。

- [ ] **Step 4: 运行 HTTP、越权和回归验证**

Run:

```bash
pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register \
  src/contract-review/__tests__/contract-review-lifecycle.test.ts \
  src/contract-review/__tests__/contract-review-http-controller.test.ts \
  src/contract-review/__tests__/contract-review-cleanup.test.ts \
  src/contract-review/__tests__/contract-review-safety-gate.test.ts \
  src/contract-review/__tests__/contract-review-module.test.ts
pnpm --filter @ai-job-print/api exec node --test \
  --experimental-test-coverage \
  --test-coverage-lines=80 \
  --test-coverage-functions=80 \
  --test-coverage-branches=80 \
  --test-coverage-include='src/contract-review/contract-review-lifecycle.service.ts' \
  --test-coverage-include='src/contract-review/contract-review-task-access.ts' \
  --test-coverage-include='src/contract-review/contract-review-task-view.mapper.ts' \
  --test-coverage-include='src/contract-review/contract-review-consent.service.ts' \
  --test-coverage-include='src/contract-review/contract-review.controller.ts' \
  -r @swc-node/register \
  src/contract-review/__tests__/contract-review-lifecycle.test.ts \
  src/contract-review/__tests__/contract-review-http-controller.test.ts
pnpm --filter @ai-job-print/api exec node --test -r @swc-node/register 'src/contract-review/__tests__/*.test.ts'
pnpm --filter @ai-job-print/api verify:contract-review:http
pnpm --filter @ai-job-print/api verify:upload-sessions:http
pnpm --filter @ai-job-print/api verify:contract-review:schema
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/api verify:contract-review:gate0
git diff --check
```

Expected: PASS；纳入统计的新增 lifecycle/access/view/consent/controller 代码整体行/函数/分支覆盖率均不低于 80%；不存在与越权响应同为 404；真实 ValidationPipe/Filter/Throttler 契约通过；默认 AppModule 仍 404，只有 verifier 显式装配的 `ContractReviewHttpModule` 通过路由；Gate 0 仍显示 `blocked`。

- [ ] **Step 5: 提交**

```bash
git add services/api/src/contract-review services/api/scripts/verify-contract-review-http.ts services/api/package.json docs/superpowers/plans/2026-08-01-ai-contract-review.md
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
assertIncludes(session, 'let sourceFileProof: string | null = null')
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
let state: {
  taskId: string | null
  accessToken: string | null
  sourceFileId: string | null
  sourceFileProof: string | null
} = {
  taskId: null, accessToken: null, sourceFileId: null, sourceFileProof: null,
}
export function setContractReviewSession(next: typeof state): void { state = { ...next } }
export function getContractReviewSession() { return { ...state } }
export function clearContractReviewSession(): void {
  state = { taskId: null, accessToken: null, sourceFileId: null, sourceFileProof: null }
}

export function shouldRedirectLegalRiskInput(intent: string | null, text: string): boolean {
  return intent === 'legal_risk_check' && text.trim().length >= 600
}
```

`contractReview.ts` 先从 `GET /contract-reviews/consent-scope` 获取并展示服务端免责声明/披露，直接使用返回的 version/hash；不得在 Kiosk 复制 canonical hash 算法。仅在匿名 create 时把上传响应的 `signedUrl` 放入 `X-Contract-Review-Source-File-Proof` header；创建成功后立即从内存移除 proof，后续请求只把任务 token 放 `X-Contract-Review-Access-Token` header。两种 bearer 都不得进入 URL、日志、localStorage 或 sessionStorage。confirm 后从 1.5 秒轮询，指数退避封顶 5 秒，组件卸载/离席时 abort。五步 UI 固定为说明同意、上传/扫描、完整性确认、真实阶段、结果；不显示伪百分比或完整合同常驻文本。上传前和处理中明确“刷新将结束本次审查”。

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
- Create: `services/api/src/contract-review/contract-review-execution-runner.ts`
- Create: `services/api/src/contract-review/contract-review-execution.child.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-execution-runner.test.ts`
- Create: `services/api/src/contract-review/contract-review-pdf.service.ts`
- Create: `services/api/src/contract-review/__tests__/contract-review-pdf.test.ts`
- Create: `services/api/scripts/verify-contract-review.ts`
- Create: `services/api/scripts/verify-contract-review-consent-postgres.ts`
- Modify: `services/api/src/contract-review/contract-review.service.ts`
- Modify: `services/api/src/contract-review/contract-review.module.ts`
- Modify: `services/api/package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [ ] **Step 1: 先写可终止执行隔离、显式/隐式标识与短期派生文件失败测试**

Task 11 的五分钟 budget 只能协作式停止后续步骤，不能终止已进入的原生 PDF/DOCX 解析。Task 14 在任何生产开关或 controller 注册前必须增加独立 child-process 执行边界：父进程只传 `taskId + stage`，child 自行从数据库读取 server truth；禁止通过 argv、env 或 IPC 传正文/token/model output。父进程用固定五分钟 wall-clock 强制终止 child，并以 Node 内存参数设置固定 heap 上限；child 超时、异常退出、IPC 超限或内存退出都只映射固定安全码。测试必须使用可注入 child adapter，证明 timeout 会实际调用 `kill`、迟到消息不会落库、父进程不会记录 child 原始 stderr/stdout。

只有 Gate 0 全部 approved、真实 provider runtime 绑定精确批准 identity、child-process hard kill/内存测试通过、Redis 可用且显式运行时开关开启时，Task 14 才允许注册 queue processor 和 HTTP controller；任何一项不满足都保持默认关闭。真实 Windows 连续会话还必须验证 child 退出后 RSS 回落，不能只靠 Promise race 冒充资源回收。

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
pnpm --filter @ai-job-print/api verify:contract-review:contract
pnpm --filter @ai-job-print/api verify:contract-review:consent
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

在 PostgreSQL readiness job 使用两个独立连接运行 `verify-contract-review-consent-postgres.ts`：定向交错会员任务创建与 `contract_review` 撤回，验证 Serializable/retry 后不存在“最新 consent 已撤回且任务仍处于处理中”的提交结果；同时验证事务失败回滚和终态 CAS 不回退。没有真实 PostgreSQL 连接时只能显式 skip，不能用内存 fake 冒充通过。

同时确认 `verify:contract-review:gate0`、`verify:contract-review:contract`、`verify:contract-review:consent` 与最终 `verify:contract-review` 都在 `.github/workflows/ci.yml` 的显式 verifier allowlist；任一未接入时不得视为发布门禁完成。

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
