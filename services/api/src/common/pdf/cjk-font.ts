import { existsSync } from 'node:fs'
import PDFDocument from 'pdfkit'

export interface CjkFontCandidate {
  path: string
  family?: string
}

export interface CjkFontProbeResult {
  ok: boolean
  path: string | null
  family: string | null
  tried: string[]
}

export const CJK_FONT_MISSING_USER_MESSAGE =
  '服务器缺少中文字体，已通知运维；你可以先打印原件或扫码保存'

let cachedKey: string | null = null
let cachedFont: CjkFontCandidate | null = null

function fontCacheKey(): string {
  return [
    process.platform,
    process.env['WINDIR'] ?? '',
    process.env['RESUME_PDF_FONT_PATH'] ?? '',
    process.env['RESUME_PDF_FONT_FAMILY'] ?? '',
    process.env['JOB_MATERIAL_PDF_FONT_PATH'] ?? '',
    process.env['JOB_MATERIAL_PDF_FONT_FAMILY'] ?? '',
  ].join('\u0000')
}

export function cjkFontCandidates(): CjkFontCandidate[] {
  const resumePath = process.env['RESUME_PDF_FONT_PATH']?.trim()
  const resumeFamily = process.env['RESUME_PDF_FONT_FAMILY']?.trim() || undefined
  const legacyPath = process.env['JOB_MATERIAL_PDF_FONT_PATH']?.trim()
  const legacyFamily = process.env['JOB_MATERIAL_PDF_FONT_FAMILY']?.trim() || undefined
  const candidates: CjkFontCandidate[] = []

  if (resumePath) candidates.push({ path: resumePath, family: resumeFamily })
  if (legacyPath && legacyPath !== resumePath) candidates.push({ path: legacyPath, family: legacyFamily })

  if (process.platform === 'win32') {
    const winDir = process.env['WINDIR'] || 'C:\\Windows'
    candidates.push(
      { path: `${winDir}\\Fonts\\msyh.ttc`, family: 'Microsoft YaHei' },
      { path: `${winDir}\\Fonts\\msyh.ttf` },
      { path: `${winDir}\\Fonts\\simhei.ttf` },
      { path: `${winDir}\\Fonts\\simsun.ttc`, family: 'SimSun' },
    )
  } else if (process.platform === 'darwin') {
    candidates.push(
      { path: '/System/Library/Fonts/PingFang.ttc', family: 'PingFangSC-Regular' },
      { path: '/System/Library/Fonts/Hiragino Sans GB.ttc', family: 'HiraginoSansGB-W3' },
      { path: '/System/Library/Fonts/STHeiti Light.ttc', family: 'STHeitiSC-Light' },
      { path: '/System/Library/Fonts/Supplemental/Songti.ttc', family: 'STSongti-SC-Regular' },
    )
  } else {
    candidates.push(
      { path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', family: 'NotoSansCJKsc-Regular' },
      { path: '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', family: 'WenQuanYi Micro Hei' },
    )
  }

  return candidates
}

function tryRegister(doc: PDFKit.PDFDocument, candidate: CjkFontCandidate): boolean {
  if (!existsSync(candidate.path)) return false
  try {
    if (candidate.family) doc.registerFont('cjk', candidate.path, candidate.family)
    else doc.registerFont('cjk', candidate.path)
    doc.font('cjk')
    return true
  } catch {
    return false
  }
}

export function resolveCjkFont(): CjkFontCandidate | null {
  const key = fontCacheKey()
  if (cachedKey === key) return cachedFont

  cachedKey = key
  cachedFont = null
  for (const candidate of cjkFontCandidates()) {
    const probe = new PDFDocument({ autoFirstPage: false })
    const ok = tryRegister(probe, candidate)
    probe.end()
    if (ok) {
      cachedFont = candidate
      break
    }
  }
  return cachedFont
}

export function registerCjkFont(doc: PDFKit.PDFDocument): boolean {
  const resolved = resolveCjkFont()
  if (resolved && tryRegister(doc, resolved)) return true

  cachedKey = null
  cachedFont = null
  const retried = resolveCjkFont()
  return Boolean(retried && tryRegister(doc, retried))
}

export function probeCjkFont(): CjkFontProbeResult {
  const candidates = cjkFontCandidates()
  const resolved = resolveCjkFont()
  return {
    ok: resolved !== null,
    path: resolved?.path ?? null,
    family: resolved?.family ?? null,
    tried: candidates.map((candidate) => candidate.path),
  }
}
