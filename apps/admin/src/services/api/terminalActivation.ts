/**
 * 照契约 v1，shared 类型进来后改为从 shared 导入。
 *
 * 激活文件响应带 Cache-Control: no-store。前端不得缓存 bindCode / signature，
 * 不得写入 localStorage、sessionStorage、IndexedDB，也不得放进 mock 适配器的持久状态。
 * 下载完成后页面只保留到期时间。
 */

export type TerminalIdentityStatus =
  | 'ok'
  | 'suspected_clone'
  | 'suspected_replacement'
  | 'unknown'

export interface TerminalProvisionFailedCheck {
  key: string
  code: string
}

/** 最近一次装机自检。没回报过为 null。 */
export interface TerminalProvisionReport {
  ok: boolean
  failedKeys: string[]
  failedChecks: TerminalProvisionFailedCheck[]
  reportedAt: string
  agentVersion: string
}

/** POST /admin/terminals/:id/activation-file 的 data。整份原样存成激活文件，前端不验签。 */
export interface TerminalActivationFile {
  schemaVersion: number
  terminalCode: string
  bindCode: string
  expiresAt: string
  apiBaseUrl: string
  printerNamePattern: string | null
  kid: string
  signature: string
}

/** 放行 / 确认换件成功。契约不返回指纹，这里也不加。 */
export interface TerminalIdentityActionResult {
  accepted: true
}
