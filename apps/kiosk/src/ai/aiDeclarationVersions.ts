/**
 * 与服务端逐字一致的声明版本和请求头。
 * 版本：services/api/src/member-privacy/member-privacy.service.ts
 * 头名：services/api/src/common/privacy/client-declaration.ts
 * 门禁 verify:kiosk-ai-declaration 对照这两处源码，改一边而不改另一边会红。
 */

export const AGE_14_PLUS_SCOPE = 'age_14_plus'
export const VOICE_RECORDING_SCOPE = 'voice_recording'

export const AGE_14_PLUS_CONSENT_VERSION = 'age-14-plus-v1'
export const VOICE_RECORDING_CONSENT_VERSION = 'voice-recording-v1'

export const AGE_14_PLUS_HEADER = 'x-age-14-plus'
export const AGE_14_PLUS_VERSION_HEADER = 'x-age-14-plus-version'
export const VOICE_RECORDING_HEADER = 'x-voice-recording'
export const VOICE_RECORDING_VERSION_HEADER = 'x-voice-recording-version'

export const AGE_14_PLUS_FLAG = 'declared'
export const VOICE_RECORDING_FLAG = 'granted'

/** 清场清单里的 sessionStorage 键。只对这一位、这一次办理有效。 */
export const AI_DECLARATION_SESSION_KEY = 'ai-job-print:ai-declaration:v1'

export const AI_DECLARATION_REQUIRED_CODE = 'AI_DECLARATION_REQUIRED'

export type DeclarationScope = typeof AGE_14_PLUS_SCOPE | typeof VOICE_RECORDING_SCOPE
