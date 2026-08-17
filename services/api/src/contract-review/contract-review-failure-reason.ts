/**
 * 失败原因的**对外白名单**：内部机器码 → 用户看得懂的一句话。
 *
 * ── 为什么需要它 ───────────────────────────────────────────────────────────
 *
 * `ContractReviewTaskView` 此前只回 `status: 'failed'`，不带任何原因。
 * 小程序拿到 failed 之后无从告知用户，只能显示
 * 「分析失败，服务端未说明原因」。这是产品缺陷，不只是排查不便 ——
 * 用户不知道该重试、该换文件、还是该等一会儿。
 *
 * ── 两条硬约束 ─────────────────────────────────────────────────────────────
 *
 * 1. **只放行白名单里的码**。`errorCode` 落库时是服务端自己写的机器码，
 *    但视图层不能假设它永远合法（历史数据、将来新增的码都可能出现）。
 *    不在表里的一律降级成通用文案 —— 宁可说得笼统，也不把内部码或
 *    实现细节漏给前端。
 * 2. **文案里不出现机器码、堆栈、厂商名、模型名、内部组件名**。
 *    用户需要知道的是「发生了什么、我该做什么」，不是我们的模块划分。
 *    由 `verify:contract-review:timeout` 逐条断言。
 *
 * 合规口径：文案不得暗示平台给出了法律结论，也不得伪造「已完成」的印象
 * （CLAUDE.md §9「不伪造能力」）。失败就说失败。
 */

/** 兜底文案：码不认识时用它，绝不回显原始码。 */
export const CONTRACT_REVIEW_GENERIC_FAILURE_REASON =
  '分析未能完成，请稍后重试；若反复失败，可换用文字版合同原件（PDF / DOCX）再试一次。'

/**
 * 白名单表。键必须是 `UPPER_SNAKE` 机器码，值必须是可直接展示给用户的中文。
 *
 * 分组只是为了读起来清楚，运行时没有分组语义。
 */
const FAILURE_REASONS: Readonly<Record<string, string>> = Object.freeze({
  // ── 超时族：本次生产故障的主角 ──────────────────────────────────────────
  // 用户最需要的信息是「不是你的文件坏了，是太长了」以及「重试可能仍然慢」。
  CONTRACT_PROVIDER_TIMEOUT:
    '合同篇幅较长，AI 分析超出了预计时间。可稍后重试，或先拆分成较少页数再上传。',
  CONTRACT_REVIEW_TIMEOUT:
    '本次分析超出了预计时间。可稍后重试，或先拆分成较少页数再上传。',

  // ── 上游可用性 ────────────────────────────────────────────────────────────
  CONTRACT_PROVIDER_TRANSPORT_FAILED:
    'AI 服务暂时连接不上，请稍后重试。',
  CONTRACT_PROVIDER_NOT_APPROVED:
    'AI 合同分析服务当前未开放，请稍后再试。',
  CONTRACT_PROVIDER_CONFIG_INVALID:
    'AI 合同分析服务当前不可用，请稍后再试。',
  CONTRACT_PROVIDER_API_KEY_INVALID:
    'AI 合同分析服务当前不可用，请稍后再试。',
  CONTRACT_PROVIDER_NOT_ALLOWED:
    'AI 合同分析服务当前不可用，请稍后再试。',

  // ── 回包不可用 ────────────────────────────────────────────────────────────
  CONTRACT_PROVIDER_RESPONSE_INVALID:
    'AI 返回的结果无法解析，本次分析未完成，请重试。',
  CONTRACT_PROVIDER_RESPONSE_TOO_LARGE:
    'AI 返回的结果过大，本次分析未完成，请重试。',

  // ── 输入体量 / 内容 ───────────────────────────────────────────────────────
  CONTRACT_PROVIDER_INPUT_LIMIT:
    '合同文字量超出单次分析上限，请拆分后分批上传。',
  CONTRACT_PROVIDER_INPUT_INVALID:
    '合同内容未通过安全检查，本次分析未进行。请确认上传的是合同文件本身。',

  // ── 抽取阶段 ──────────────────────────────────────────────────────────────
  CONTRACT_REVIEW_EXTRACTION_FAILED:
    '未能从该文件中读出合同文字。请改用文字版 PDF / DOCX，或重新拍摄更清晰的照片。',
  CONTRACT_REVIEW_EXTRACT_ATTEMPTS_EXHAUSTED:
    '多次尝试后仍未能读出合同文字。请改用文字版 PDF / DOCX，或重新拍摄更清晰的照片。',
  CONTRACT_REVIEW_EXTRACT_STATE_INVALID:
    '本次任务状态异常，未能继续分析，请重新发起。',

  // ── 分析阶段 ──────────────────────────────────────────────────────────────
  CONTRACT_REVIEW_ANALYSIS_FAILED:
    '分析过程中出现问题，本次未完成，请重试。',
  CONTRACT_REVIEW_ANALYZE_ATTEMPT_FAILED:
    '分析过程中出现问题，本次未完成，请重试。',
  CONTRACT_REVIEW_ANALYZE_NOT_RESUMABLE:
    '上一次分析被中断且无法继续，请重新发起。',
  CONTRACT_REVIEW_SAFETY_REJECTED:
    'AI 给出的结果未通过安全检查，已丢弃，请重试。',

  // ── 任务一致性 ────────────────────────────────────────────────────────────
  CONTRACT_REVIEW_SOURCE_CHANGED:
    '合同原件在分析期间发生变化，请重新上传。',
  CONTRACT_REVIEW_CONFIRMATION_REQUIRED:
    '尚未确认分析范围，请回到确认页重新确认。',
  CONTRACT_REVIEW_STAGE_CHANGED:
    '本次任务状态已变化，未能继续分析，请重新发起。',
  CONTRACT_REVIEW_FINAL_CAS_FAILED:
    '结果保存失败，本次分析未完成，请重试。',
})

/** 码是否在白名单内。视图层据此决定回真实码还是不回码。 */
export function isKnownContractReviewFailureCode(code: unknown): code is string {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(FAILURE_REASONS, code)
}

/**
 * 用户可读的失败原因。
 *
 * 未登记的码一律走兜底文案 —— **绝不**把原始码拼进句子里。
 */
export function contractReviewFailureReason(code: unknown): string {
  return isKnownContractReviewFailureCode(code)
    ? FAILURE_REASONS[code] as string
    : CONTRACT_REVIEW_GENERIC_FAILURE_REASON
}

/** 供门禁遍历。返回副本，防止外部改动白名单。 */
export function contractReviewFailureCodes(): readonly string[] {
  return Object.freeze(Object.keys(FAILURE_REASONS))
}
