import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
  CONTRACT_REVIEW_STATUSES,
  type ContractReviewCategory,
  type ContractReviewFinding,
  type ContractReviewPriority,
  type ContractReviewResult,
  type ContractReviewStatus,
  type ContractReviewTaskView,
  type ContractType,
} from '../../../packages/shared/src/types/contractReview'
import type { FilePurpose } from '../../../packages/shared/src/types/file'
import type { ScanType } from '../../../packages/shared/src/types/scanTask'
import type { UploadSessionCreateRequest } from '../../../packages/shared/src/types/uploadSession'
import type {
  ContractReviewFinding as BarrelContractReviewFinding,
  ContractReviewTaskView as BarrelContractReviewTaskView,
} from '../../../packages/shared/src'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false

type SharedContractExports = typeof import('../../../packages/shared/src')

type ExpectedContractReviewEvidence = {
  pageNumber: number | null
  excerpt: string
  charStart: number | null
  charEnd: number | null
}

type ExpectedContractReviewFinding = {
  id: string
  category:
    | 'parties'
    | 'term'
    | 'probation'
    | 'compensation'
    | 'position_location'
    | 'working_time'
    | 'social_insurance'
    | 'training_service'
    | 'penalty'
    | 'non_compete'
    | 'deposit_documents'
    | 'termination'
    | 'imbalance'
    | 'offer_conditions'
  priority: 'priority_check' | 'attention' | 'insufficient_info'
  title: string
  evidence: ExpectedContractReviewEvidence
  explanation: string
  basisRef: string | null
  verificationQuestion: string
  uncertainty: string
  source: 'rule' | 'ai' | 'rule_and_ai'
}

type ExpectedContractReviewResult = {
  priorityCheckCount: number
  attentionCount: number
  insufficientInfoCount: number
  coverage: 'complete' | 'truncated'
  ocrConfidence: 'high' | 'medium' | 'low'
  disclaimerVersion: string
  rulePackVersion: string
  generatedByAi: true
  findings: ExpectedContractReviewFinding[]
}

type ExpectedContractReviewProgress = {
  stage: (typeof CONTRACT_REVIEW_STATUSES)[number]
  completedPages: number
  totalPages: number | null
}

type ExpectedContractReviewTaskView = {
  id: string
  status: (typeof CONTRACT_REVIEW_STATUSES)[number]
  contractType: 'labor_contract' | 'internship_agreement' | 'non_compete' | 'offer'
  analyzedPages: number
  totalPages: number | null
  truncated: boolean
  ocrConfidence: 'high' | 'medium' | 'low' | null
  expiresAt: string
  progress: ExpectedContractReviewProgress
  result: ExpectedContractReviewResult | null
}

function expectType<Check extends true>(_check?: Check): void {}

expectType<Equal<ContractReviewStatus, (typeof CONTRACT_REVIEW_STATUSES)[number]>>()
expectType<
  Equal<ContractType, 'labor_contract' | 'internship_agreement' | 'non_compete' | 'offer'>
>()
expectType<Equal<ContractReviewPriority, 'priority_check' | 'attention' | 'insufficient_info'>>()
expectType<
  Equal<
    ContractReviewCategory,
    | 'parties'
    | 'term'
    | 'probation'
    | 'compensation'
    | 'position_location'
    | 'working_time'
    | 'social_insurance'
    | 'training_service'
    | 'penalty'
    | 'non_compete'
    | 'deposit_documents'
    | 'termination'
    | 'imbalance'
    | 'offer_conditions'
  >
>()
expectType<
  Equal<SharedContractExports['CONTRACT_REVIEW_STATUSES'], typeof CONTRACT_REVIEW_STATUSES>
>()
expectType<Equal<BarrelContractReviewFinding, ContractReviewFinding>>()
expectType<Equal<BarrelContractReviewTaskView, ContractReviewTaskView>>()
expectType<Equal<ContractReviewFinding, ExpectedContractReviewFinding>>()
expectType<Equal<ContractReviewResult, ExpectedContractReviewResult>>()
expectType<Equal<ContractReviewTaskView, ExpectedContractReviewTaskView>>()
expectType<Equal<Extract<FilePurpose, 'contract_upload'>, 'contract_upload'>>()
expectType<Equal<Extract<ScanType, 'contract'>, 'contract'>>()
expectType<
  Equal<Extract<UploadSessionCreateRequest['purpose'], 'contract_upload'>, 'contract_upload'>
>()

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

const purpose: FilePurpose = 'contract_upload'
const scanType: ScanType = 'contract'
const uploadRequest: UploadSessionCreateRequest = {
  purpose: 'contract_upload',
  mode: 'temporary',
  channel: 'phone_h5',
}

function verifyTypeScriptContract(): void {
  const typescriptCli = require.resolve('typescript/bin/tsc')
  execFileSync(
    process.execPath,
    [
      typescriptCli,
      '--noEmit',
      '--strict',
      '--noUnusedLocals',
      '--noUnusedParameters',
      '--skipLibCheck',
      '--target',
      'ES2021',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--esModuleInterop',
      '--allowSyntheticDefaultImports',
      '--resolveJsonModule',
      '--pretty',
      'false',
      __filename,
    ],
    { cwd: resolve(__dirname, '../../..'), stdio: 'inherit' }
  )
}

verifyTypeScriptContract()

assert.deepEqual(CONTRACT_REVIEW_STATUSES, expectedStatuses)
assert.equal(new Set(CONTRACT_REVIEW_STATUSES).size, CONTRACT_REVIEW_STATUSES.length)
assert.equal(view.result?.findings[0]?.evidence.excerpt, '试用期六个月')
assert.equal(purpose, 'contract_upload')
assert.equal(scanType, 'contract')
assert.equal(uploadRequest.purpose, 'contract_upload')

console.log('contract review shared contract passed')
