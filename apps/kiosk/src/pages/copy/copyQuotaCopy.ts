import { copyQuotaCode } from './copyCheckModel'

/** 登录后回到「放好原件，选份数」，要重新放原件、再扫一次；回跳地址不带单号。 */
export const COPY_LOGIN_PATH = `/login?from=${encodeURIComponent('/print-scan/feature/copy-screen?stage=set')}`

export interface CopyQuotaText {
  title: string
  chip: string
  reason: string
  /** 只有游客单次超限给「去登录」；机器日额度、本人日额度登录也过不了。 */
  login: boolean
}

/** 额度怎么算（11/08 计费口径）：复印与打印共用，出纸成功才算。 */
export const COPY_QUOTA_FACTS = ['复印和打印共用免费额度', '只算成功出纸的面数，没出纸不算'] as const

/**
 * 复印超过免费额度时屏上的说法：与后端 subject:'copy' 的三句同义（复印与打印共用额度，所以说「打印复印」），
 * 服务电话由 PhoneHelpLine 另起一行，不拼进这句。按错误码选句，不读服务端文案。
 */
export function copyQuotaText(errorCode: string | null, limit: number | null): CopyQuotaText {
  const code = copyQuotaCode(errorCode)
  if (code === 'PRINT_GUEST_ORDER_QUOTA_EXCEEDED') {
    return {
      title: '这次超过了免登录的复印面数', chip: '超过免登录上限', login: true,
      reason: `免登录每次${limit ? `最多复印 ${limit} 面` : '复印的面数有上限'}。用手机号登录后，可以一次复印更多。`,
    }
  }
  if (code === 'PRINT_MEMBER_DAILY_QUOTA_REACHED') {
    return {
      title: '你今天的免费额度已用完', chip: '今天的额度已用完', login: false,
      reason: `${limit ? `你今天已免费打印复印 ${limit} 面，达到每日上限` : '你今天的免费打印复印量已达上限'}，明天 0 点恢复。`,
    }
  }
  if (code === 'PRINT_TERMINAL_DAILY_QUOTA_REACHED') {
    return {
      title: '这台机器今天的免费额度已用完', chip: '今天的额度已用完', login: false,
      reason: '今天这台机器的免费打印复印量已用完，明天 0 点恢复。',
    }
  }
  return { title: '这次超过了免费额度', chip: '超过免费额度', login: false, reason: '这次超过了免费额度。' }
}
