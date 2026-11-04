/**
 * 登录会员撞上简历 AI 授权 403 时，当场弹现有授权，同意后再发同一次请求。
 * 游客不走这条：服务端对游客的 resume_ai 不拦截，页面保持原来的失败处理。
 * 无状态：撤回后再收到同一个码，仍然要弹。
 */
export const RESUME_AI_CONSENT_REQUIRED_CODE = 'USER_AI_CONSENT_REQUIRED'

/** 与简历诊断页暂停态同一句。法律说明只在 ResumeAiConsentDialog 里，这里不另写。 */
export const RESUME_AI_CONSENT_NEEDED_COPY = '使用简历 AI 前需要先确认授权'

export function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && code.length > 0 ? code : undefined
}

export function resumeAiConsentPromptForMember(error: unknown, loggedIn: boolean): boolean {
  return loggedIn && readErrorCode(error) === RESUME_AI_CONSENT_REQUIRED_CODE
}
