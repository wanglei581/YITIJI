import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CONTRACT_REVIEW_STATUSES as CONTRACT_REVIEW_STATUSES_FROM_INDEX,
} from '../../../packages/shared/src'
import {
  CONTRACT_REVIEW_STATUSES,
  type ContractReviewFinding,
  type ContractReviewTaskView,
} from '../../../packages/shared/src/types/contractReview'
import type { FilePurpose } from '../../../packages/shared/src/types/file'
import type { ScanSessionCreateRequest } from '../../../packages/shared/src/types/scanTask'
import type { UploadSessionCreateRequest } from '../../../packages/shared/src/types/uploadSession'

const expectedStatuses = [
  'uploaded',
  'queued',
  'extracting',
  'awaiting_confirmation',
  'rule_checking',
  'ai_analyzing',
  'safety_reviewing',
  'completed',
  'failed',
  'cancelled',
  'expired',
] as const

assert.deepEqual(CONTRACT_REVIEW_STATUSES, expectedStatuses)
assert.equal(new Set(CONTRACT_REVIEW_STATUSES).size, CONTRACT_REVIEW_STATUSES.length)
assert.strictEqual(CONTRACT_REVIEW_STATUSES_FROM_INDEX, CONTRACT_REVIEW_STATUSES)

const finding: ContractReviewFinding = {
  id: 'f-1',
  category: 'probation',
  priority: 'priority_check',
  title: '核实试用期',
  evidence: {
    pageNumber: 1,
    excerpt: '试用期六个月',
    charStart: 20,
    charEnd: 26,
  },
  explanation: '需结合合同期限核实',
  basisRef: 'labor-contract-law:19',
  verificationQuestion: '合同期限与试用期分别是多少？',
  uncertainty: '',
  source: 'rule_and_ai',
}

const view: ContractReviewTaskView = {
  id: 'task-1',
  status: 'completed',
  contractType: 'labor_contract',
  analyzedPages: 1,
  totalPages: 1,
  truncated: false,
  ocrConfidence: 'high',
  expiresAt: '2026-08-01T12:00:00.000Z',
  progress: { stage: 'completed', completedPages: 1, totalPages: 1 },
  result: {
    priorityCheckCount: 1,
    attentionCount: 0,
    insufficientInfoCount: 0,
    coverage: 'complete',
    ocrConfidence: 'high',
    disclaimerVersion: 'contract-review-v1',
    rulePackVersion: 'cn-labor-p0-v1',
    generatedByAi: true,
    findings: [finding],
  },
}

const filePurpose: FilePurpose = 'contract_upload'
const uploadRequest: UploadSessionCreateRequest = {
  purpose: 'contract_upload',
  mode: 'temporary',
  channel: 'phone_h5',
}
const scanRequest: ScanSessionCreateRequest = {
  scanType: 'contract',
  terminalId: 'terminal-contract',
}

assert.equal(view.result?.findings[0]?.evidence.excerpt, '试用期六个月')
assert.equal(filePurpose, 'contract_upload')
assert.equal(uploadRequest.purpose, 'contract_upload')
assert.equal(scanRequest.scanType, 'contract')

const repoRoot = resolve(__dirname, '../../..')
const fileSource = readFileSync(resolve(repoRoot, 'packages/shared/src/types/file.ts'), 'utf8')
const scanTaskSource = readFileSync(resolve(repoRoot, 'packages/shared/src/types/scanTask.ts'), 'utf8')
const uploadSessionSource = readFileSync(
  resolve(repoRoot, 'packages/shared/src/types/uploadSession.ts'),
  'utf8',
)
const sharedIndexSource = readFileSync(resolve(repoRoot, 'packages/shared/src/index.ts'), 'utf8')

assert.match(fileSource, /^\s*\| 'contract_upload'(?:\s|$)/m)
assert.match(scanTaskSource, /^export type ScanType = [^\n]*\| 'contract'$/m)
assert.match(
  uploadSessionSource,
  /export interface UploadSessionCreateRequest\s*{[\s\S]*purpose: FilePurpose/,
)
assert.match(sharedIndexSource, /export \* from ['"]\.\/types\/contractReview['"]/)

console.log('contract review shared contract passed')
