// ============================================================
// 合同审查 PII 遮盖（re-export 薄壳）
//
// 实现已于 2026-08-16（S0-2）提到 common/pii/pii-masker.ts，供简历链复用。
// 本文件只做 re-export：合同审查侧的 5 个调用点与既有 __tests__ 无需改动，
// 行为与迁移前逐字一致（仍走默认 assertComplete=true 的 fail-closed 严格模式）。
//
// 新代码请直接从 common/pii/pii-masker 引入；本壳只为不动合同审查链路而保留。
// ============================================================

export {
  assertNoHighConfidencePii,
  maskContractPages,
  maskContractText,
} from '../common/pii/pii-masker'

export type {
  ContractMaskPage,
  ContractMaskResult,
  ContractPartyFacts,
  MaskOptions,
} from '../common/pii/pii-masker'
