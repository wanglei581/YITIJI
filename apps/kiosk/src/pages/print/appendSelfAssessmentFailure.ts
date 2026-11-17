import { SelfAssessmentApiError } from '../../services/api/selfAssessment'
import { isMemberSessionInvalidError } from '../../services/auth/memberSessionEvents'

const CONTINUE_ORIGINAL = '已帮你取消勾选。本次没有建单；再点一次确认，就按原文件打印。'

/** 文件本身附不上。沿用确认页原来的 404 句，并停用勾选。 */
export const APPEND_FILE_UNAVAILABLE =
  `这份文件不能附加自我探索，${CONTINUE_ORIGINAL}`

/** 其它失败。沿用确认页原来的重试句，保持勾选。 */
export const APPEND_RETRY =
  '合并版没有生成，本次没有建单。可以再点一次确认重试，或取消勾选「附加自我探索」直接打印原文件。'

/**
 * 游客（这次请求没带会员令牌）的 401。人还留在确认页，取消勾选后可以按原文件打印。
 * 带会员令牌的 401 会清场并跳到登录页，不走这句。
 * 前半句是现成的 `MEMBER_SESSION_EXPIRED`
 * （`apps/kiosk/src/services/api/userErrorMessage.ts`：「登录状态已失效，请重新登录后重试」）。
 * 触屏定稿没有确认页这句。
 */
export const APPEND_LOGIN_EXPIRED = `登录状态已失效，请重新登录后重试。${CONTINUE_ORIGINAL}`

/**
 * 429。仓库里没有一句同时说「操作太频繁」和「请稍后再试」且不带验证码或「一分钟」。
 * 「操作太频繁」见 `services/api/src/print-sign/print-sign.service.ts`；
 * 「请稍后再试」见 `userErrorMessage.ts` 的 `RATE_LIMITED`（那句是「人较多」，不用于这里）。
 */
export const APPEND_TOO_FREQUENT = `操作太频繁，请稍后再试。${CONTINUE_ORIGINAL}`

/**
 * `SELF_ASSESSMENT_NOT_FOUND`。服务端 message 是「自我探索记录不存在或已过期」
 * （`appended-self-assessment.service.ts`）。屏上说明结果找不到或已过期，可以不附直接打印。
 * 触屏定稿 `docs/design/kiosk-touch-2026-10/` 没有这句。
 */
export const APPEND_ASSESSMENT_MISSING =
  '自我探索结果找不到或已过期，已帮你取消勾选。本次没有建单；可以不附，再点一次确认就按原文件打印。'

export type AppendFailureAction = {
  message: string
  /** 取消勾选，主按钮回到按原文件打印。 */
  uncheck: boolean
  /** 停用勾选。只用于这份文件本身附不上。 */
  block: boolean
  /**
   * 会员令牌已经失效。全站过期出口会清场并离开确认页，
   * 屏上不再写「再点一次确认，就按原文件打印」。
   */
  silent?: boolean
}

/**
 * 错误码到屏上那一句。过期记录要先于普通 404，否则会被说成「这份文件不能附加」。
 * `memberTokenUsed` 是这次请求发出前有没有会员令牌。有令牌的会话失效不在本页说「可以继续打印」。
 */
export function appendSelfAssessmentFailure(
  err: unknown,
  options?: { memberTokenUsed?: boolean },
): AppendFailureAction {
  if (err instanceof SelfAssessmentApiError) {
    if (err.code === 'SELF_ASSESSMENT_NOT_FOUND') {
      return { message: APPEND_ASSESSMENT_MISSING, uncheck: true, block: false }
    }
    if (isMemberSessionInvalidError(err.status, err.code, Boolean(options?.memberTokenUsed))) {
      return { message: '', uncheck: true, block: false, silent: true }
    }
    if (err.status === 401) return { message: APPEND_LOGIN_EXPIRED, uncheck: true, block: false }
    if (err.status === 429) return { message: APPEND_TOO_FREQUENT, uncheck: true, block: false }
    if (err.code === 'RESUME_FILE_NOT_FOUND' || err.status === 404) {
      return { message: APPEND_FILE_UNAVAILABLE, uncheck: true, block: true }
    }
  }
  return { message: APPEND_RETRY, uncheck: false, block: false }
}

interface SelfAssessmentSessionSnapshot {
  taskId?: string
  accessToken?: string
  result?: { expiresAt?: string }
}

const SELF_ASSESSMENT_SESSION_KEY = 'self_assessment_session_v1'

/** 确认页只认带任务编号的自我探索会话。读不到就当没有，不抛。 */
export function readSelfAssessmentSnapshot(): SelfAssessmentSessionSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(SELF_ASSESSMENT_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SelfAssessmentSessionSnapshot
    if (!parsed || typeof parsed !== 'object' || !parsed.taskId) return null
    return parsed
  } catch {
    return null
  }
}
