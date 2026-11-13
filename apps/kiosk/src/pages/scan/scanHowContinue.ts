// 游客在「怎么扫」点「先登录」时留下的返回意图。
// 短时、一次性、只含材料。不放扫描凭证、结果或令牌。
// 不放进扫描登记：游客登录会清那份登记，这一条要活过那一次清理。

import { isScanMaterial, type ScanMaterial } from './scanMaterials'
import { readScanWorkbenchSession } from './scanWorkbenchSession'

export const SCAN_HOW_CONTINUE_KEY = 'ai-job-print:scan-how-continue'
/** 十分钟。过了就当没选过，回到「扫什么？」。 */
const TTL_MS = 10 * 60 * 1000

interface ContinueMark {
  material: ScanMaterial
  expiresAt: number
}

function readMark(): ContinueMark | null {
  try {
    const raw = window.sessionStorage.getItem(SCAN_HOW_CONTINUE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { material?: unknown; expiresAt?: unknown }
    if (!isScanMaterial(parsed.material)) return null
    if (typeof parsed.expiresAt !== 'number' || Date.now() > parsed.expiresAt) {
      window.sessionStorage.removeItem(SCAN_HOW_CONTINUE_KEY)
      return null
    }
    return { material: parsed.material, expiresAt: parsed.expiresAt }
  } catch {
    return null
  }
}

/**
 * 登记里还有一场活的扫描或结果时不写。那种情况不该靠登录把凭证带到下一位。
 * @returns 是否写上了。
 */
export function armScanHowContinue(material: ScanMaterial): boolean {
  const session = readScanWorkbenchSession()
  if (session?.live || session?.result) return false
  try {
    const mark: ContinueMark = { material, expiresAt: Date.now() + TTL_MS }
    window.sessionStorage.setItem(SCAN_HOW_CONTINUE_KEY, JSON.stringify(mark))
    return true
  } catch {
    return false
  }
}

export function peekScanHowContinue(): ScanMaterial | null {
  return readMark()?.material ?? null
}

export function consumeScanHowContinue(): ScanMaterial | null {
  const mark = readMark()
  try {
    window.sessionStorage.removeItem(SCAN_HOW_CONTINUE_KEY)
  } catch {
    /* 读不到就当没有 */
  }
  return mark?.material ?? null
}

export function clearScanHowContinue(): void {
  try {
    window.sessionStorage.removeItem(SCAN_HOW_CONTINUE_KEY)
  } catch {
    /* ignore */
  }
}
