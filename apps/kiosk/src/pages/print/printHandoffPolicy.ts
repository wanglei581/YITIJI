// 打印交接的入口与检查策略：进打印的来源集中在这一张表里（商用收口 P0-5 第二、三批）。
//
// 判据与服务端建单隐私闸门一致（services/api/src/print-jobs/pii-scan-gate.ts）：
//   - 用户自己的原件（上传、扫描、诊断失败的原件、我的文档里的原件）打印前必须先做材料检查；
//   - 派生产物（AI 报告、优化稿、生成稿、求职材料、招聘会资料）免检查，直达报价确认页。
// 图片转 PDF、签名的输出在服务端是派生，但装的是用户原件的内容，产品选择先查。
// 本文件不能有运行时 import：单元测试直接转译它。

export type PrintHandoffOrigin =
  | 'upload'
  | 'scan_result'
  | 'resume_report'
  | 'resume_original'
  | 'resume_optimize'
  | 'resume_generate'
  | 'image_convert'
  | 'sign_stamp'
  | 'advisor_artifact'
  | 'job_material'
  | 'my_documents'
  | 'job_fit'
  | 'career_plan'
  | 'self_assessment'
  | 'interview_report'
  | 'interview_practice'
  | 'fair_material'
  | 'fair_visit_plan'
  | 'fair_company'

export type PrintHandoffEntry = 'check' | 'preview' | 'confirm'

export interface PrintHandoffPolicy {
  checkPolicy: 'required' | 'exempt'
  entry: PrintHandoffEntry
}

const REQUIRED: PrintHandoffPolicy = { checkPolicy: 'required', entry: 'check' }
const EXEMPT_CONFIRM: PrintHandoffPolicy = { checkPolicy: 'exempt', entry: 'confirm' }

const POLICY: Record<Exclude<PrintHandoffOrigin, 'my_documents'>, PrintHandoffPolicy> = {
  upload: REQUIRED,
  scan_result: REQUIRED,
  resume_original: REQUIRED,
  image_convert: REQUIRED,
  sign_stamp: REQUIRED,
  resume_report: EXEMPT_CONFIRM,
  resume_optimize: EXEMPT_CONFIRM,
  resume_generate: EXEMPT_CONFIRM,
  advisor_artifact: EXEMPT_CONFIRM,
  job_material: EXEMPT_CONFIRM,
  job_fit: EXEMPT_CONFIRM,
  career_plan: EXEMPT_CONFIRM,
  self_assessment: EXEMPT_CONFIRM,
  interview_report: EXEMPT_CONFIRM,
  interview_practice: EXEMPT_CONFIRM,
  fair_material: EXEMPT_CONFIRM,
  fair_visit_plan: EXEMPT_CONFIRM,
  // 企业资料页（托管 a 已关，b 版本保留）历来进参数页：免检查，先看预览再定参数。
  fair_company: { checkPolicy: 'exempt', entry: 'preview' },
}

export function isPrintHandoffOrigin(value: unknown): value is PrintHandoffOrigin {
  return typeof value === 'string' && (value === 'my_documents' || Object.prototype.hasOwnProperty.call(POLICY, value))
}

/**
 * 「我的文档」按文件本身定：调用方说清这一份要不要检查（documentNeedsPrintMaterialCheck）；
 * 没说就按原件处理（fail-closed，与服务端「不是派生就要检查」同口径）。
 */
export function printHandoffPolicyFor(
  origin: PrintHandoffOrigin,
  options: { requiresCheck?: boolean } = {},
): PrintHandoffPolicy {
  if (origin === 'my_documents') return options.requiresCheck === false ? { ...EXEMPT_CONFIRM } : { ...REQUIRED }
  return { ...POLICY[origin] }
}

export function printHandoffEntryPath(entry: PrintHandoffEntry): string {
  if (entry === 'check') return '/print/desk?step=check'
  if (entry === 'preview') return '/print/desk?step=preview'
  return '/print/confirm'
}
