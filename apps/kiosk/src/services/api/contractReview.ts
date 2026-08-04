// ============================================================
// 合同审查 API service（Kiosk）
//
// 流程：GET consent-scope → 上传文件 → POST /contract-reviews →
//        轮询 GET /:id → POST /:id/confirm → 结果展示
//
// 凭证：登录会员 Bearer；匿名用 x-contract-review-access-token。
// 合规：结果仅作风险提示，不构成正式法律意见；原文会话后即弃。
// ============================================================

import type {
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

export interface ConsentScope {
  consentVersion: string
  consentScopeHash: string
  disclaimerVersion: string
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
  init?: { method?: string; body?: unknown },
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
): Promise<ContractReviewTaskView> {
  if (API_MODE !== 'http') return mockCreateTask(contractType)
  // 1. 上传文件
  const upload = await kioskUploadFile(file, 'contract_upload', access.token)
  // 2. 创建审查任务
  return call<ContractReviewTaskView>('/contract-reviews', access, {
    method: 'POST',
    body: {
      sourceFileId: upload.fileId,
      contractType,
      consentVersion: consent.consentVersion,
      consentedAt: new Date().toISOString(),
      consentScopeHash: consent.consentScopeHash,
      disclaimerVersion: consent.disclaimerVersion,
    },
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
  if (API_MODE !== 'http') return
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
  if (API_MODE !== 'http') return
  await call(`/contract-reviews/${id}`, access, { method: 'DELETE' }).catch(() => undefined)
}

// ── Mock 实现（开发调试用） ────────────────────────────────

function mockConsentScope(): ConsentScope {
  return {
    consentVersion: 'v1.0',
    consentScopeHash: 'a'.repeat(64),
    disclaimerVersion: 'v1.0',
    disclaimer: {
      id: 'disclaimer-v1',
      version: 'v1.0',
      content: '本 AI 合同审查服务仅作风险提示，不构成正式法律意见；重大争议请咨询律师或官方窗口。合同原文仅在本次会话期间用于分析，会话结束后立即删除，不保存至任何外部服务。',
      publishedAt: new Date().toISOString(),
    },
    disclosures: {
      dataCategories: ['合同原文（OCR文字）', 'AI 审查结果'],
      retention: { maximumHours: 2, sessionDeletionFirst: true },
    },
  }
}

let _mockStep = 0

function mockCreateTask(contractType: ContractType): ContractReviewTaskView {
  _mockStep = 0
  return {
    id: 'mock-task-001',
    status: 'queued',
    contractType,
    analyzedPages: 0,
    totalPages: null,
    truncated: false,
    ocrConfidence: null,
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    progress: { stage: 'queued', completedPages: 0, totalPages: null },
    result: null,
  }
}

function mockGetTask(id: string): ContractReviewTaskView {
  const stages = ['queued', 'extracting', 'awaiting_confirmation', 'rule_checking', 'ai_analyzing', 'safety_reviewing', 'completed'] as const
  _mockStep = Math.min(_mockStep + 1, stages.length - 1)
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
            explanation: '根据《劳动合同法》第 19 条，劳动合同期限 3 年以上不满 8 年的，试用期不得超过 2 个月；满 8 年的不得超过 6 个月。合同未注明期限，请核实合同期限是否≥8 年。',
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
    result: null,
  }
}
