import { preferUnattended } from '../../copy/unattendedCopy'

export const SCAN_TERMINAL_FAIL_COPY = '这台机器的安全校验没通过。请安全返回扫描首页后再试。'
export const SCAN_DISABLED_COPY = '扫描功能已停用。请安全返回扫描首页后再试。'
export const SCAN_CREATE_FAIL_COPY = '系统没能建立这次扫描。请返回重试。'

/** 服务端原话若仍把人支去现场，改成这一页自己的句子。号码由 PhoneHelpLine 另读。 */
export function scanShownText(text: string, replacement = SCAN_CREATE_FAIL_COPY): string {
  return preferUnattended(text, replacement)
}

/** 仅在服务端明确给出类型错误时使用；通用上传失败不能推断为 PDF。 */
export function scanFailureReason(code: string | null | undefined, message: string | null | undefined, scanType: string): string {
  if (scanType === 'id' && code === 'SCAN_FILE_TYPE_NOT_ALLOWED') {
    return '文件格式不符合证件扫描要求，请在打印机屏幕上选 JPG（图片）后重新扫描。'
  }
  return message ?? '扫描处理失败，请重试'
}
