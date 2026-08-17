// ============================================================
// AI 签约风险提示 API service（Kiosk）
//
// 流程：GET consent-scope → 上传文件 → POST /contract-reviews →
//        轮询 GET /:id → POST /:id/confirm → 结果展示
//
// 凭证：登录会员 Bearer；匿名用 x-contract-review-access-token。
// 合规：结果仅作风险提示，不构成正式法律意见；原文按同意范围短期保留并优先删除。
// ============================================================

import type {
  ContractReviewStatus,
  ContractReviewReportView,
  ContractReviewTaskView,
  ContractType,
} from '@ai-job-print/shared'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { API_BASE_URL, API_MODE } from './client'
import { kioskUploadFile } from './files'

export class ContractReviewApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ContractReviewApiError'
  }
}

export interface ContractReviewAccess {
  token?: string | null
  accessToken?: string | null
}

export interface ContractReviewCreatedTaskView {
  id: string
  status: ContractReviewStatus
  expiresAt: string
  accessToken?: string
}

// 形状必须与服务端 `ContractReviewPublicConsentScope` 逐字段一致。
// 服务端只返回嵌套的 `disclaimer.version`，**没有**平铺的 `disclaimerVersion`；
// 曾经多出的那个平铺字段在 http 模式下恒为 undefined，导致
// `POST /contract-reviews` 必然 400（disclaimerVersion should not be empty）。
// mock 当时伪造了该平铺字段，所以 mock 用例全绿而真实后端 100% 失败。
export interface ConsentScope {
  consentVersion: string
  consentScopeHash: string
  disclaimer: {
    id: string
    version: string
    content: string
    publishedAt: string
  }
  disclosures: {
    dataCategories: string[]
    retention: { maximumHours: number; sessionDeletionFirst: boolean }
  }
}

// ── 内部请求工具 ───────────────────────────────────────────

async function call<T>(
  path: string,
  access: ContractReviewAccess,
  init?: { method?: string; body?: unknown; extraHeaders?: Record<string, string> },
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(access.token ? { Authorization: `Bearer ${access.token}` } : {}),
      ...(!access.token && access.accessToken
        ? { 'x-contract-review-access-token': access.accessToken }
        : {}),
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.extraHeaders ?? {}),
    },
    credentials: 'include',
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const code: string = json?.error?.code ?? json?.code ?? 'UNKNOWN'
    const msg: string = json?.error?.message ?? json?.message ?? `HTTP ${res.status}`
    if (isMemberSessionInvalidError(res.status, code, !!access.token)) {
      notifyMemberSessionExpired()
    }
    throw new ContractReviewApiError(code, msg, res.status)
  }
  return (json?.data ?? json) as T
}

// ── 公共 API ──────────────────────────────────────────────

/** 获取知情同意所需的版本信息与免责声明内容 */
export async function getConsentScope(): Promise<ConsentScope> {
  if (API_MODE !== 'http') return mockConsentScope()
  return call<ConsentScope>('/contract-reviews/consent-scope', {}, undefined)
}

/** 上传合同文件并创建审查任务 */
export async function createContractReview(
  file: File,
  contractType: ContractType,
  consent: { consentVersion: string; consentScopeHash: string; disclaimerVersion: string },
  access: ContractReviewAccess,
): Promise<ContractReviewCreatedTaskView> {
  if (API_MODE !== 'http') return mockCreateTask()
  // 1. 上传文件
  const upload = await kioskUploadFile(file, 'contract_upload', access.token)
  // 2. 创建审查任务。匿名用户需附带 source-file-proof（上传返回的签名 URL），
  //    后端用于验证 sourceFileId 归属；已登录用户凭 JWT 校验，无需 proof。
  const extraHeaders: Record<string, string> = !access.token && upload.signedUrl
    ? { 'x-contract-review-source-file-proof': upload.signedUrl }
    : {}
  return call<ContractReviewCreatedTaskView>('/contract-reviews', access, {
    method: 'POST',
    body: {
      sourceFileId: upload.fileId,
      contractType,
      consentVersion: consent.consentVersion,
      consentedAt: new Date().toISOString(),
      consentScopeHash: consent.consentScopeHash,
      disclaimerVersion: consent.disclaimerVersion,
    },
    extraHeaders,
  })
}

/** 轮询审查任务状态 */
export async function getContractReview(
  id: string,
  access: ContractReviewAccess,
): Promise<ContractReviewTaskView> {
  if (API_MODE !== 'http') return mockGetTask(id)
  return call<ContractReviewTaskView>(`/contract-reviews/${id}`, access)
}

/** 确认页面数/OCR 覆盖（awaiting_confirmation → rule_checking/ai_analyzing） */
export async function confirmContractReview(
  id: string,
  params: {
    contractType: ContractType
    totalPages: number
    analyzedPages: number
    truncated: boolean
  },
  access: ContractReviewAccess,
): Promise<void> {
  if (API_MODE !== 'http') {
    _mockConfirmed = true
    return
  }
  await call(`/contract-reviews/${id}/confirm`, access, {
    method: 'POST',
    body: {
      ...params,
      ocrCoverageConfirmed: true,
      personalUseConfirmed: true,
    },
  })
}

/** 取消/删除审查任务（会话结束时调用） */
export async function deleteContractReview(
  id: string,
  access: ContractReviewAccess,
): Promise<void> {
  if (API_MODE !== 'http') {
    _mockStep = 0
    _mockConfirmed = false
    return
  }
  await call(`/contract-reviews/${id}`, access, { method: 'DELETE' })
}

/** 生成短期 AI 风险提示 PDF；服务端开关关闭时固定 fail-closed。 */
export async function createContractReviewReport(
  id: string,
  access: ContractReviewAccess,
): Promise<ContractReviewReportView> {
  if (API_MODE !== 'http') {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    return {
      fileId: 'mock-contract-report-001',
      filename: 'AI签约风险提示报告.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 42_800,
      pages: 2,
      expiresAt,
      printFileUrl: '/api/v1/files/mock-contract-report-001/content?expires=1&sig=mock',
      abandonToken: 'mock-contract-report-abandon-token',
      abandonTokenExpiresAt: expiresAt,
    }
  }
  return call<ContractReviewReportView>(`/contract-reviews/${id}/report`, access, {
    method: 'POST',
  })
}

/** 放弃尚未创建 PrintTask 的报告；凭证不具备合同或报告读取权限。 */
export async function abandonContractReviewReport(
  fileId: string,
  abandonToken: string,
): Promise<void> {
  if (API_MODE !== 'http') return
  await call(`/contract-reviews/reports/${encodeURIComponent(fileId)}`, {}, {
    method: 'DELETE',
    extraHeaders: { 'x-contract-review-report-abandon-token': abandonToken },
  })
}

// ── Mock 实现（开发调试用） ────────────────────────────────

function mockConsentScope(): ConsentScope {
  return {
    consentVersion: 'v1.0',
    consentScopeHash: 'a'.repeat(64),
    disclaimer: {
      id: 'disclaimer-v1',
      version: 'v1.0',
      content: '本 AI 签约风险提示服务仅作风险提示，不构成正式法律意见；重大争议请咨询律师或官方窗口。合同原文在受控存储中短期保留，发送模型前脱敏，结束时优先删除，异常情况下最长保留 2 小时。',
      publishedAt: new Date().toISOString(),
    },
    disclosures: {
      dataCategories: ['合同原文（OCR文字）', 'AI 审查结果'],
      retention: { maximumHours: 2, sessionDeletionFirst: true },
    },
  }
}

let _mockStep = 0
let _mockConfirmed = false

function mockCreateTask(): ContractReviewCreatedTaskView {
  _mockStep = 0
  _mockConfirmed = false
  return {
    id: 'mock-task-001',
    status: 'queued',
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    accessToken: 'mock-contract-review-access-token',
  }
}

function mockGetTask(id: string): ContractReviewTaskView {
  const stages = ['queued', 'extracting', 'awaiting_confirmation', 'rule_checking', 'ai_analyzing', 'safety_reviewing', 'completed'] as const
  if (_mockStep !== 2 || _mockConfirmed) {
    _mockStep = Math.min(_mockStep + 1, stages.length - 1)
  }
  const status = stages[_mockStep]
  if (status === 'completed') {
    return {
      id,
      status: 'completed',
      contractType: 'labor_contract',
      analyzedPages: 5,
      totalPages: 5,
      truncated: false,
      ocrConfidence: 'high',
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      progress: { stage: 'completed', completedPages: 5, totalPages: 5 },
      // 与服务端同一条公式：20 + 页数 × 15（秒）。
      estimatedSeconds: 20 + 5 * 15,
      failureCode: null,
      failureReason: null,
      result: {
        priorityCheckCount: 2,
        attentionCount: 3,
        insufficientInfoCount: 1,
        coverage: 'complete',
        ocrConfidence: 'high',
        disclaimerVersion: 'v1.0',
        rulePackVersion: 'v1.0',
        generatedByAi: true,
        findings: [
          {
            id: 'f1',
            category: 'probation',
            priority: 'priority_check',
            title: '试用期时长可能超过法定上限',
            evidence: {
              pageNumber: 2,
              excerpt: '试用期为六个月',
              charStart: null,
              charEnd: null,
            },
            explanation: '根据《劳动合同法》第 19 条，三年以上固定期限和无固定期限劳动合同，试用期不得超过六个月。合同期限信息未被完整识别，请先核实合同期限，再判断六个月试用期是否适用。',
            basisRef: '《劳动合同法》第 19 条',
            verificationQuestion: '合同约定的劳动合同总期限是多久？',
            uncertainty: '合同中未明确注明总期限，本项结论存在不确定性。',
            source: 'rule_and_ai',
          },
          {
            id: 'f2',
            category: 'compensation',
            priority: 'priority_check',
            title: '薪资约定不明确，缺少结构说明',
            evidence: {
              pageNumber: 3,
              excerpt: '月薪若干元',
              charStart: null,
              charEnd: null,
            },
            explanation: '合同仅注明"月薪若干元"，未区分基本工资、绩效及各项补贴，在发生争议时可能不利于劳动者主张权益。建议要求补充书面附件或补充条款明确薪资结构。',
            basisRef: '《劳动合同法》第 17 条',
            verificationQuestion: '入职前是否已有书面 Offer 或薪资说明？',
            uncertainty: '无',
            source: 'ai',
          },
          {
            id: 'f3',
            category: 'non_compete',
            priority: 'attention',
            title: '竞业限制条款范围较宽',
            evidence: {
              pageNumber: 4,
              excerpt: '离职后 2 年内不得从事任何相关行业',
              charStart: null,
              charEnd: null,
            },
            explanation: '竞业限制应限于负有保密义务的劳动者，且范围应合理。条款中"任何相关行业"措辞较宽，建议确认是否有竞业补偿，以及限制范围是否可协商缩小。',
            basisRef: '《劳动合同法》第 23、24 条',
            verificationQuestion: '合同中是否约定了相应的竞业限制经济补偿？',
            uncertainty: '无',
            source: 'rule_and_ai',
          },
          {
            id: 'f4',
            category: 'working_time',
            priority: 'attention',
            title: '未约定加班工资计算方式',
            evidence: { pageNumber: 3, excerpt: '按公司规章制度执行', charStart: null, charEnd: null },
            explanation: '法定工作时间以外的工时应支付加班工资。条款以"按公司规章制度执行"兜底，属不明确约定，建议要求补充具体计算基数和倍数。',
            basisRef: '《劳动法》第 44 条',
            verificationQuestion: '是否存在公司另行下发的书面规章制度？',
            uncertainty: '如公司规章制度已在入职前公示，本项风险相对降低。',
            source: 'ai',
          },
          {
            id: 'f5',
            category: 'social_insurance',
            priority: 'attention',
            title: '社保缴纳基数未明确',
            evidence: { pageNumber: 3, excerpt: '按国家规定缴纳', charStart: null, charEnd: null },
            explanation: '社保缴纳基数应以实际工资为基准。条款未说明具体缴费基数，建议入职后核查实际缴纳情况。',
            basisRef: '《社会保险法》第 12 条',
            verificationQuestion: '无',
            uncertainty: '无',
            source: 'rule',
          },
          {
            id: 'f6',
            category: 'term',
            priority: 'insufficient_info',
            title: '合同终止条件信息不足',
            evidence: { pageNumber: 5, excerpt: '（相关页面识别置信度偏低）', charStart: null, charEnd: null },
            explanation: '合同第 5 页 OCR 识别置信度偏低，合同解除/终止相关条款可能未被完整捕获，建议对照纸质原件核查该部分条款。',
            basisRef: null,
            verificationQuestion: '请对照纸质合同第 5 页"合同解除/终止"部分自行核查。',
            uncertainty: '本项因 OCR 识别质量限制，结论可靠性较低。',
            source: 'ai',
          },
        ],
      },
    }
  }
  if (status === 'awaiting_confirmation') {
    return {
      id,
      status: 'awaiting_confirmation',
      contractType: 'labor_contract',
      analyzedPages: 5,
      totalPages: 5,
      truncated: false,
      ocrConfidence: 'high',
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      progress: { stage: 'awaiting_confirmation', completedPages: 5, totalPages: 5 },
      estimatedSeconds: 20 + 5 * 15,
      failureCode: null,
      failureReason: null,
      result: null,
    }
  }
  return {
    id,
    status,
    contractType: 'labor_contract',
    analyzedPages: _mockStep,
    totalPages: 5,
    truncated: false,
    ocrConfidence: null,
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    progress: { stage: status, completedPages: _mockStep, totalPages: 5 },
    // 页数未识别时按 1 页算，与服务端 mapper 的取值顺序一致。
    estimatedSeconds: 20 + (_mockStep || 1) * 15,
    failureCode: null,
    failureReason: null,
    result: null,
  }
}
