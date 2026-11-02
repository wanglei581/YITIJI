// ============================================================
// 签约风险提示：创建审查任务没成时，屏上对人说的话。
//
// 走查 I-28：后端排队不可用（503 CONTRACT_REVIEW_QUEUE_UNAVAILABLE）时页面写「请检查文件格式后重试」，
// 让人去查自己的文件；这是服务那一头的问题，换多少份文件都不会好。
//
// 判据：服务这一头没接住（排队不可用、服务端出错、够不着服务）才说服务暂时用不了；
// 服务明确回了「请求本身有问题」的 4xx 才说检查文件；认不出的错误按文件说，不冤枉服务。
// 本文件不依赖任何运行时模块，node 测试直接转译它来跑（scripts/tests/contract-review-failure-copy.test.mjs）。
// ============================================================

/** 服务这头用不了：说清不是文件的错，并给出不用 AI 也能做的事。 */
export const CONTRACT_SERVICE_DOWN_NOTICE =
  '合同审查服务暂时用不了，不是你的文件有问题。请稍后再试；合同原件可以到打印扫描里直接打印。'

/** 服务明确说请求本身不对（文件类型、大小、同意版本）时才用这一句。 */
export const CONTRACT_FILE_PROBLEM_NOTICE = '创建审查任务失败，请检查文件格式后重试'

/**
 * 这次失败是不是服务那一头的问题。
 * 认的有四类：后端回的排队不可用码；任何 5xx；状态 0 或「网络错误」码（请求没送到）；fetch 够不着服务时抛的 TypeError。
 */
export function isContractReviewServiceFailure(err: unknown): boolean {
  if (err instanceof TypeError) return true
  if (typeof err !== 'object' || err === null) return false
  const { code, status } = err as { code?: unknown; status?: unknown }
  if (code === 'CONTRACT_REVIEW_QUEUE_UNAVAILABLE' || code === 'NETWORK_ERROR') return true
  return typeof status === 'number' && (status === 0 || status >= 500)
}

/** 非 AI 停用的创建失败：服务问题说服务，其余才说文件。 */
export function contractReviewCreateFailureText(err: unknown): string {
  return isContractReviewServiceFailure(err) ? CONTRACT_SERVICE_DOWN_NOTICE : CONTRACT_FILE_PROBLEM_NOTICE
}
