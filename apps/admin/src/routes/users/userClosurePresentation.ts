import type { AdminUserClosureRequest } from '@ai-job-print/shared'
import { ApiHttpError } from '../../services/api/client'
import { AdminUserClosureError } from '../../services/api/adminUsers'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { PAY_STATUS_MAP, PICKUP_LABELS, STATUS_MAP } from '../orders/orderDisplay'

export const CLOSURE_CONSEQUENCES = [
  ['会删除：', '简历与 AI 生成的简历结果；上传的文件、扫描件及其衍生文件；模拟面试、AI 顾问、岗位 AI 的会话与报告；合同审查与材料检查记录；浏览、收藏、打开来源平台的记录；本人自填的求职进度；站内通知。'],
  ['会保留（已去掉能认出本人的信息）：', '订单、支付与退款流水（金额与订单号保留）；打印任务的状态记录；权益发放与兑换流水；意见反馈的处理记录；已签署的协议版本与时间；AI 调用的计量记录；操作审计日志。'],
  ['另外：', '未使用的权益会作废；未处理完的意见反馈会关闭；该手机号以后重新注册是一个新账号，看不到以上任何记录；注销不能撤销。'],
] as const

export const CLOSURE_MESSAGES: Readonly<Record<string, string>> = {
  CLOSURE_PHONE_MISMATCH: '手机尾号与该账号不一致，请向会员本人核对后重填。',
  CLOSURE_REQUEST_REQUIRED: '该会员没有待处理的注销申请。如会员到场办理，请改选「凭线下申请办理」并填写凭据编号。',
  CLOSURE_BLOCKED_BY_OPEN_ORDERS: '该会员还有未完成的订单，暂不能注销。请先处理完下列订单：',
  CLOSURE_IN_PROGRESS: '该账号正在注销中，请稍后刷新查看结果。',
  CLOSURE_CONTEXT_MISMATCH: '该账号上一次注销没有完成。重试时办理来源、事由、凭据编号必须与上一次完全相同。',
  CLOSURE_EXECUTION_FAILED: '注销没有完成，账号停在注销中。请用相同的来源、事由、凭据编号再提交一次；仍失败请联系技术人员。',
  CLOSURE_SOURCE_INVALID: '请选择办理来源。',
  CLOSURE_REASON_REQUIRED: '请填写 1–200 字事由。',
  CLOSURE_PHONE_REQUIRED: '请填写四位数字手机尾号。',
  CLOSURE_EVIDENCE_REQUIRED: '请填写 1–64 字线下凭据编号。',
  ADMIN_USER_NOT_FOUND: '用户不存在或已被移除，请刷新列表。',
  DEMO_MODE_READONLY: '演示模式不执行账号注销。',
}

export type ClosureFieldErrors = Partial<Record<keyof AdminUserClosureRequest, string>>
export function validateClosure(input: AdminUserClosureRequest): ClosureFieldErrors {
  const errors: ClosureFieldErrors = {}
  if (!['member_request', 'offline'].includes(input.source)) errors.source = CLOSURE_MESSAGES.CLOSURE_SOURCE_INVALID
  if (!input.reasonText.trim() || input.reasonText.trim().length > 200) errors.reasonText = CLOSURE_MESSAGES.CLOSURE_REASON_REQUIRED
  if (!/^\d{4}$/.test(input.phoneLast4)) errors.phoneLast4 = CLOSURE_MESSAGES.CLOSURE_PHONE_REQUIRED
  if (input.source === 'offline' && (!input.offlineEvidenceNo?.trim() || input.offlineEvidenceNo.trim().length > 64)) {
    errors.offlineEvidenceNo = CLOSURE_MESSAGES.CLOSURE_EVIDENCE_REQUIRED
  }
  return errors
}

const ERROR_FIELDS: Readonly<Record<string, keyof AdminUserClosureRequest>> = {
  CLOSURE_SOURCE_INVALID: 'source', CLOSURE_REASON_REQUIRED: 'reasonText',
  CLOSURE_PHONE_REQUIRED: 'phoneLast4', CLOSURE_EVIDENCE_REQUIRED: 'offlineEvidenceNo',
}

/** 注销错误只用登记文案与 HTTP 状态，不读取服务端 message、reason 或尾号。 */
export function closureFailure(caught: unknown) {
  const code = caught instanceof ApiHttpError ? caught.code : ''
  const field = ERROR_FIELDS[code]
  const message = CLOSURE_MESSAGES[code] ?? userMessageOf(
    caught instanceof ApiHttpError ? new ApiHttpError('', '', caught.status) : caught,
    '注销未完成，请检查网络后重试。',
  )
  return {
    message, fields: field ? { [field]: message } : {},
    orders: code === 'CLOSURE_BLOCKED_BY_OPEN_ORDERS' && caught instanceof AdminUserClosureError ? caught.orders : [],
  }
}

export function closureOrderStatus(status: string): string {
  if (status.startsWith('pickup_')) return PICKUP_LABELS[status.slice(7)] ?? '状态未识别'
  return PAY_STATUS_MAP[status]?.label ?? STATUS_MAP[status]?.label ?? '状态未识别'
}
