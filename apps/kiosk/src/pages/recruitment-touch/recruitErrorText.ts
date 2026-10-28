import { containsStaffHandoff } from '../../copy/unattendedCopy'
import { userMessageOf } from '../../services/api/userErrorMessage'

/**
 * 本包页面里把接口错误翻成屏上那一句。
 * 5xx 的通用说法里带「联系现场工作人员」，现场无人值守，这类句子一律不上屏：
 * 命中无人值守禁用说法时换成调用方给的、和当前操作相关的那一句，求助交给页面上的 helpNeededLine()（服务电话）。
 * 其余错误码（网络、限流、登录失效等）照 userMessageOf 原样。
 */
export function recruitErrorText(error: unknown, fallback: string): string {
  const text = userMessageOf(error, fallback)
  return containsStaffHandoff(text) ? fallback : text
}
