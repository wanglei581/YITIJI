import { preferUnattended } from '../../copy/unattendedCopy'

export const SCAN_TERMINAL_FAIL_COPY = '这台机器的安全校验没通过。请安全返回扫描首页后再试。'
export const SCAN_DISABLED_COPY = '扫描功能已停用。请安全返回扫描首页后再试。'
export const SCAN_CREATE_FAIL_COPY = '系统没能建立这次扫描。请返回重试。'

/** 服务端原话若仍把人支去现场，改成这一页自己的句子。号码由 PhoneHelpLine 另读。 */
export function scanShownText(text: string, replacement = SCAN_CREATE_FAIL_COPY): string {
  return preferUnattended(text, replacement)
}
