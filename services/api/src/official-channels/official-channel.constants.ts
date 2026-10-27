export const OFFICIAL_CHANNEL_CATEGORY = 'official_channel'

/**
 * 与 packages/shared 的 OFFICIAL_CHANNEL_AUDIENCES 保持同一组英文值。
 * services/api 是 CommonJS，不直接 import 该包。中文标题只放在 shared，不写进本目录的 service。
 */
export const OFFICIAL_CHANNEL_AUDIENCES = ['graduate', 'social', 'general'] as const

export type OfficialChannelAudience = (typeof OFFICIAL_CHANNEL_AUDIENCES)[number]

/** 公开读取：库里的未知值收成 general。已知值原样返回。 */
export function officialChannelAudienceOrGeneral(value: string): OfficialChannelAudience {
  for (const audience of OFFICIAL_CHANNEL_AUDIENCES) {
    if (audience === value) return audience
  }
  return 'general'
}

export const OFFICIAL_CHANNEL_CODES = {
  urlInvalid: 'OFFICIAL_CHANNEL_URL_INVALID',
  domainNotVerified: 'OFFICIAL_CHANNEL_DOMAIN_NOT_VERIFIED',
  commercialHost: 'OFFICIAL_CHANNEL_COMMERCIAL_HOST_BLOCKED',
  nameInvalid: 'OFFICIAL_CHANNEL_NAME_INVALID',
  notFound: 'OFFICIAL_CHANNEL_NOT_FOUND',
  emptyUpdate: 'OFFICIAL_CHANNEL_EMPTY_UPDATE',
  verifiedDomainInvalid: 'VERIFIED_DOMAIN_INVALID',
  orgNotFound: 'ORG_NOT_FOUND',
  orgRequired: 'ORG_REQUIRED',
  terminalNotFound: 'TERMINAL_NOT_FOUND',
  emergencyHeld: 'EMERGENCY_TAKEDOWN_IRREVERSIBLE',
} as const
