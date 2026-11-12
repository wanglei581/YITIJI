import { createRequire } from 'node:module'
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import type { Writable } from 'node:stream'
import { dirname } from 'node:path'
import process from 'node:process'
import { FIXTURE_PDF, resetEvidence } from './sweep-harness'

/**
 * 走查用的两页中文简历。人物和单位都是虚构的。
 * 文字层要够长，服务端抽取才不会把它当成没有文字的扫描件。
 */
const RESUME_PAGE_ONE = [
  '林晓舟',
  '求职意向：仓储管理员',
  '电话：13900001234',
  '邮箱：linxiaozhou.example@example.com',
  '所在城市：青岚市',
  '教育经历',
  '青岚市海风职业学校　物流管理　2021.09—2024.06',
  '在校期间完成仓储实务与配送组织课程，并在校内实训仓做过理货和盘点。',
].join('\n')

const RESUME_PAGE_TWO = [
  '工作经历',
  '青岚市北区晨配服务站　夜班分拣员　2024.07—2025.08',
  '核对运单、分拣包裹并协助装车。按站点要求登记破损件，把当班交接写清楚。',
  '技能',
  '会使用手持终端扫码，能按库位核对件数，熟悉夜班交接记录。',
  '这份简历只用于本机交互走查，人物、学校和单位均为虚构。',
].join('\n')

interface PdfDoc {
  pipe: (stream: Writable) => void
  registerFont: (name: string, fontPath: string, family?: string) => PdfDoc
  font: (name: string) => PdfDoc
  fontSize: (size: number) => PdfDoc
  text: (value: string, options?: { align?: 'center' | 'left' }) => PdfDoc
  moveDown: (lines?: number) => PdfDoc
  addPage: () => PdfDoc
  end: () => void
}

interface FontCandidate {
  path: string
  family?: string
}

function fontCandidates(): FontCandidate[] {
  if (process.platform === 'win32') {
    const winDir = process.env['WINDIR'] || 'C:\\Windows'
    return [
      { path: `${winDir}\\Fonts\\msyh.ttc`, family: 'Microsoft YaHei' },
      { path: `${winDir}\\Fonts\\msyh.ttf` },
      { path: `${winDir}\\Fonts\\simhei.ttf` },
      { path: `${winDir}\\Fonts\\simsun.ttc`, family: 'SimSun' },
    ]
  }
  if (process.platform === 'darwin') {
    return [
      { path: '/System/Library/Fonts/PingFang.ttc', family: 'PingFangSC-Regular' },
      { path: '/System/Library/Fonts/Hiragino Sans GB.ttc', family: 'HiraginoSansGB-W3' },
      { path: '/System/Library/Fonts/STHeiti Light.ttc', family: 'STHeitiSC-Light' },
      { path: '/System/Library/Fonts/Supplemental/Songti.ttc', family: 'STSongti-SC-Regular' },
    ]
  }
  return [
    { path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', family: 'NotoSansCJKsc-Regular' },
    { path: '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', family: 'WenQuanYi Micro Hei' },
  ]
}

function loadPdfKit(): new (options: { size: string; margin: number }) => PdfDoc {
  const requireFromApi = createRequire(new URL('../../../../services/api/package.json', import.meta.url))
  return requireFromApi('pdfkit') as new (options: { size: string; margin: number }) => PdfDoc
}

function writeFixturePdf(outPath: string): Promise<void> {
  mkdirSync(dirname(outPath), { recursive: true })
  const PDFDocument = loadPdfKit()
  const tried: string[] = []
  let chosen: FontCandidate | null = null
  const probe = new PDFDocument({ size: 'A4', margin: 56 })
  for (const candidate of fontCandidates()) {
    tried.push(candidate.family ? `${candidate.path}#${candidate.family}` : candidate.path)
    if (!existsSync(candidate.path)) continue
    try {
      if (candidate.family) probe.registerFont('cjk', candidate.path, candidate.family)
      else probe.registerFont('cjk', candidate.path)
      chosen = candidate
      break
    } catch {
      // 下一个候选
    }
  }
  probe.end()
  if (!chosen) {
    throw new Error(`生成走查简历 PDF 失败：没有可用的中文字体。试过：${tried.join(' | ')}`)
  }
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 })
    const stream = createWriteStream(outPath)
    const fail = (error: Error) => reject(error)
    stream.on('error', fail)
    stream.on('finish', () => resolve())
    doc.pipe(stream)
    if (chosen.family) doc.registerFont('cjk', chosen.path, chosen.family)
    else doc.registerFont('cjk', chosen.path)
    doc.font('cjk').fontSize(20).text('个人简历', { align: 'center' })
    doc.moveDown(0.6)
    doc.fontSize(12).text(RESUME_PAGE_ONE)
    doc.addPage()
    doc.font('cjk').fontSize(12).text(RESUME_PAGE_TWO)
    doc.end()
  })
}

export default async function globalSetup(): Promise<void> {
  resetEvidence()
  if (!existsSync(FIXTURE_PDF)) await writeFixturePdf(FIXTURE_PDF)
}
