/**
 * 扫描件交接（稿 21 scan-ready）。
 *
 * 扫描工作台把扫描件交给 /resume/parse 时用的是 replace，并清掉了扫描登记——这份文件的身份
 * 从那一刻起只在路由 state 里（ScanResultPage.handleResumeAI）。解析页要把人送回来源选择时，
 * 必须把**同一份**文件身份原样带回去，否则文件就丢了。
 *
 * 这里只搬运扫描工作台已经交出来的字段（fileId + file 的展示信息与签名内容链接），
 * 不新增字段、不改后端合同；来源页读回时逐项校验类型，任何一项不对就当作没有交接。
 * 与 aiResumeSession 不同，这里**不落任何浏览器存储**：它只活在这一条历史条目的 state 里。
 */
export interface ScanHandoff {
  fileId: string
  file: {
    name: string
    size?: number | string
    format?: string
    fileUrl?: string
    mimeType?: string
  }
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 从解析页的路由 state 取出扫描件交接；字段不全就返回 null（fail-closed）。 */
export function buildScanHandoff(state: Record<string, unknown> | null | undefined): ScanHandoff | null {
  if (!state || state.source !== 'scan') return null
  const fileId = pickString(state.fileId)
  const raw = state.file
  if (!fileId || !raw || typeof raw !== 'object') return null
  const file = raw as Record<string, unknown>
  const name = pickString(file.name)
  if (!name) return null
  const size = typeof file.size === 'number' || typeof file.size === 'string' ? file.size : undefined
  return {
    fileId,
    file: {
      name,
      size,
      format: pickString(file.format),
      fileUrl: pickString(file.fileUrl),
      mimeType: pickString(file.mimeType),
    },
  }
}

/** 来源页读回：只认 `state.scanHandoff`，逐项校验。 */
export function readScanHandoff(state: unknown): ScanHandoff | null {
  if (!state || typeof state !== 'object') return null
  const handoff = (state as { scanHandoff?: unknown }).scanHandoff
  if (!handoff || typeof handoff !== 'object') return null
  const { fileId, file } = handoff as { fileId?: unknown; file?: unknown }
  return buildScanHandoff({ source: 'scan', fileId, file })
}
