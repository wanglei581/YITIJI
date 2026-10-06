import type { TerminalActivationFile } from '../../services/api/terminalActivation'

/** 激活文件名。终端号取响应里的 terminalCode，不另算。 */
export function activationFileName(terminalCode: string): string {
  return `AIJobPrint-activation-${terminalCode}.json`
}

/**
 * 整份 data 原样序列化。响应是 Cache-Control: no-store，
 * 这里不读、不写任何存储，调用方也不得把 data 放进状态。
 */
export function activationFileText(data: TerminalActivationFile): string {
  return JSON.stringify(data, null, 2)
}

/** 触发下载并立刻只交还到期时间。对象 URL 在点击后撤销。 */
export function downloadActivationFile(data: TerminalActivationFile): string {
  const blob = new Blob([activationFileText(data)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = activationFileName(data.terminalCode)
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
  return data.expiresAt
}
