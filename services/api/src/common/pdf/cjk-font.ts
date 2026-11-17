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

export function builtinCjkFontCandidates(platform: NodeJS.Platform, winDir = 'C:\\Windows'): CjkFontCandidate[] {
  if (platform === 'win32') {
    return [
      { path: `${winDir}\\Fonts\\msyh.ttc`, family: 'Microsoft YaHei' },
      { path: `${winDir}\\Fonts\\msyh.ttf` },
      { path: `${winDir}\\Fonts\\simhei.ttf` },
      { path: `${winDir}\\Fonts\\simsun.ttc`, family: 'SimSun' },
    ]
  }
  if (platform === 'darwin') {
    return [
      { path: '/System/Library/Fonts/PingFang.ttc', family: 'PingFangSC-Regular' },
      { path: '/System/Library/Fonts/Hiragino Sans GB.ttc', family: 'HiraginoSansGB-W3' },
      { path: '/System/Library/Fonts/STHeiti Light.ttc', family: 'STHeitiSC-Light' },
      { path: '/System/Library/Fonts/Supplemental/Songti.ttc', family: 'STSongti-SC-Regular' },
    ]
  }
  return [
    { path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', family: 'NotoSansCJKsc-Regular' },
    // .ttc 按 PostScript 名取字，家族名 WenQuanYi Micro Hei 会加载失败。
    { path: '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', family: 'WenQuanYiMicroHei' },
  ]
}

export function cjkFontCandidates(): CjkFontCandidate[] {
  const resumePath = process.env['RESUME_PDF_FONT_PATH']?.trim()
  const resumeFamily = process.env['RESUME_PDF_FONT_FAMILY']?.trim() || undefined
  const legacyPath = process.env['JOB_MATERIAL_PDF_FONT_PATH']?.trim()
  const legacyFamily = process.env['JOB_MATERIAL_PDF_FONT_FAMILY']?.trim() || undefined
  const candidates: CjkFontCandidate[] = []

  if (resumePath) candidates.push({ path: resumePath, family: resumeFamily })
  if (legacyPath && legacyPath !== resumePath) candidates.push({ path: legacyPath, family: legacyFamily })
  candidates.push(...builtinCjkFontCandidates(process.platform, process.env['WINDIR'] || 'C:\\Windows'))
  return candidates
}

export function tryRegisterCjkFont(doc: PDFKit.PDFDocument, candidate: CjkFontCandidate): boolean {
  if (!existsSync(candidate.path)) return false
  try {
    if (candidate.family) doc.registerFont('cjk', candidate.path, candidate.family)
    else doc.registerFont('cjk', candidate.path)
    // registerFont 只登记。font() 才读 .ttc；名字不对就抛，调用方换下一个。
    doc.font('cjk')
    return true
  } catch {
    return false
  }
}

export function selectLoadableCjkFont(candidates: readonly CjkFontCandidate[]): CjkFontCandidate | null {
  for (const candidate of candidates) {
    const probe = new PDFDocument({ autoFirstPage: false })
    const ok = tryRegisterCjkFont(probe, candidate)
    probe.end()
    if (ok) return candidate
  }
  return null
}

export function resolveCjkFont(): CjkFontCandidate | null {
  const key = fontCacheKey()
  if (cachedKey === key) return cachedFont

  cachedKey = key
  cachedFont = selectLoadableCjkFont(cjkFontCandidates())
  return cachedFont
}

export function registerCjkFont(doc: PDFKit.PDFDocument): boolean {
  const resolved = resolveCjkFont()
  if (resolved && tryRegisterCjkFont(doc, resolved)) return true

  cachedKey = null
  cachedFont = null
  const retried = resolveCjkFont()
  return Boolean(retried && tryRegisterCjkFont(doc, retried))
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
