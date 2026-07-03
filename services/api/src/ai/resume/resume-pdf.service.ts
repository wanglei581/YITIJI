import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { existsSync } from 'fs'
import PDFDocument from 'pdfkit'
import type { GeneratedResume, ResumeLayoutSettings } from '../interfaces/ai-provider.interface'
import type { ResumeTemplateLayoutPreset, ResumeTemplateSectionKey } from '../../job-materials/job-materials.types'

// ============================================================
// ResumePdfService — 阶段2A 简历 PDF 渲染(服务端真实产物)
//
// 合规:只渲染用户确认后的简历内容为真实 PDF 文件(进 FileObject + 签名 URL +
// 清理策略),绝不构造假文件进打印链路(CLAUDE.md 既有红线)。
//
// 中文字体:PDF 必须内嵌 CJK 字体。方案 = 运行环境系统字体解析(零仓库膨胀、
// 无网络依赖),按平台尝试常见中文字体,支持 env RESUME_PDF_FONT_PATH 显式覆盖;
// 全部不可用时诚实报错 RESUME_PDF_FONT_NOT_FOUND,绝不输出乱码 PDF。
//   - Windows(生产一体机/服务器):微软雅黑 / 黑体
//   - macOS(开发机):PingFang / Hiragino Sans GB / 华文黑体
//   - Linux:Noto Sans CJK / 文泉驿
// ============================================================

interface FontCandidate {
  path: string
  /** TTC 集合需指定字体族名;单字体文件为 undefined */
  family?: string
}

function fontCandidates(): FontCandidate[] {
  const custom = process.env['RESUME_PDF_FONT_PATH']?.trim()
  const customFamily = process.env['RESUME_PDF_FONT_FAMILY']?.trim() || undefined
  const list: FontCandidate[] = []
  if (custom) list.push({ path: custom, family: customFamily })
  if (process.platform === 'win32') {
    const winDir = process.env['WINDIR'] || 'C:\\Windows'
    list.push(
      { path: `${winDir}\\Fonts\\msyh.ttc`, family: 'Microsoft YaHei' },
      { path: `${winDir}\\Fonts\\msyh.ttf` },
      { path: `${winDir}\\Fonts\\simhei.ttf` },
      { path: `${winDir}\\Fonts\\simsun.ttc`, family: 'SimSun' },
    )
  } else if (process.platform === 'darwin') {
    list.push(
      { path: '/System/Library/Fonts/PingFang.ttc', family: 'PingFangSC-Regular' },
      { path: '/System/Library/Fonts/Hiragino Sans GB.ttc', family: 'HiraginoSansGB-W3' },
      { path: '/System/Library/Fonts/STHeiti Light.ttc', family: 'STHeitiSC-Light' },
      { path: '/System/Library/Fonts/Supplemental/Songti.ttc', family: 'STSongti-SC-Regular' },
    )
  } else {
    list.push(
      { path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', family: 'NotoSansCJKsc-Regular' },
      { path: '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', family: 'WenQuanYi Micro Hei' },
    )
  }
  return list
}

const PAGE = { width: 595.28, height: 841.89 } // A4 pt
const MARGIN = 48
const DEFAULT_MARGIN = MARGIN
const DEFAULT_LINE_GAP = 2.5
const DEFAULT_ACCENT = '#2563eb'
const DEFAULT_FONT_SCALE = 1

const ACCENT_COLORS = {
  blue: DEFAULT_ACCENT,
  green: '#047857',
  slate: '#475569',
} as const

type ResumePdfLayoutConfig = {
  margin: number
  contentWidth: number
  fontScale: number
  lineGap: number
  accent: string
  columns: 1 | 2
}

function resolveLayout(layout?: ResumeLayoutSettings): ResumePdfLayoutConfig {
  const margin = layout?.margin === 'narrow' ? 36 : layout?.margin === 'wide' ? 60 : DEFAULT_MARGIN
  const fontScale = layout?.fontScale === 'compact' ? 0.92 : layout?.fontScale === 'large' ? 1.08 : DEFAULT_FONT_SCALE
  const lineGap = layout?.lineSpacing === 'compact' ? 1.5 : layout?.lineSpacing === 'relaxed' ? 4 : DEFAULT_LINE_GAP
  const accent = layout?.accent ? ACCENT_COLORS[layout.accent] || DEFAULT_ACCENT : DEFAULT_ACCENT
  const columns = layout?.columns === 2 ? 2 : 1
  return { margin, contentWidth: PAGE.width - margin * 2, fontScale, lineGap, accent, columns }
}

function resolveHeaderBottomY(currentY: number): number {
  return currentY
}

export interface RenderedResumePdf {
  buffer: Buffer
  pageCount: number
}

export interface ResumePdfRenderOptions {
  layout?: ResumeLayoutSettings
  templatePreset?: ResumeTemplateLayoutPreset
}

function isRenderOptions(value: ResumeLayoutSettings | ResumePdfRenderOptions | undefined): value is ResumePdfRenderOptions {
  return Boolean(value && ('layout' in value || 'templatePreset' in value))
}

@Injectable()
export class ResumePdfService {
  private readonly logger = new Logger(ResumePdfService.name)
  private resolvedFont: FontCandidate | null = null

  /** 解析可用中文字体(进程内缓存);不可用 → 诚实报错。 */
  private resolveFont(doc: InstanceType<typeof PDFDocument>): void {
    const tryRegister = (candidate: FontCandidate): boolean => {
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

    if (this.resolvedFont && tryRegister(this.resolvedFont)) return
    for (const candidate of fontCandidates()) {
      if (tryRegister(candidate)) {
        this.resolvedFont = candidate
        this.logger.log(`resume pdf font: ${candidate.path}${candidate.family ? ` (${candidate.family})` : ''}`)
        return
      }
    }
    throw new ServiceUnavailableException({
      error: {
        code: 'RESUME_PDF_FONT_NOT_FOUND',
        message: '服务器缺少可用中文字体,无法导出 PDF;请配置 RESUME_PDF_FONT_PATH 指向 .ttf/.ttc 中文字体文件',
      },
    })
  }

  /** 渲染简历 PDF(A4 受控排版)。返回 buffer + 页数。 */
  async render(resume: GeneratedResume, options?: ResumeLayoutSettings | ResumePdfRenderOptions): Promise<RenderedResumePdf> {
    const renderOptions = isRenderOptions(options) ? options : { layout: options }
    const cfg = resolveLayout({ ...renderOptions.templatePreset?.defaultLayout, ...renderOptions.layout })
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: cfg.margin, bottom: cfg.margin, left: cfg.margin, right: cfg.margin },
      bufferPages: true,
      info: { Title: `${resume.basic.name} 的简历` },
    })
    this.resolveFont(doc)

    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    const done = new Promise<Buffer>((resolvePromise, rejectPromise) => {
      doc.on('end', () => resolvePromise(Buffer.concat(chunks)))
      doc.on('error', rejectPromise)
    })

    const ink = '#1f2937'
    const sub = '#6b7280'
    const line = '#d1d5db'
    const accent = cfg.accent
    const fs = (n: number) => Number((n * cfg.fontScale).toFixed(2))

    // ── 头部:姓名 + 求职意向 + 联系方式 ─────────────────────────────
    doc.fillColor(ink).fontSize(fs(24)).text(resume.basic.name, { width: cfg.contentWidth })
    const contact = [
      resume.intention.position ? `求职意向:${resume.intention.position}` : '',
      resume.intention.city ? `意向城市:${resume.intention.city}` : '',
      resume.basic.phone ? `电话:${resume.basic.phone}` : '',
      resume.basic.email ? `邮箱:${resume.basic.email}` : '',
    ].filter(Boolean).join('  ·  ')
    if (contact) {
      doc.moveDown(0.3)
      doc.fillColor(sub).fontSize(fs(10.5)).text(contact, { width: cfg.contentWidth })
    }
    doc.moveDown(0.6)
    doc.moveTo(cfg.margin, doc.y).lineTo(PAGE.width - cfg.margin, doc.y).strokeColor(accent).lineWidth(1.5).stroke()
    doc.moveDown(0.6)

    const headerBottomY = resolveHeaderBottomY(doc.y)
    const bodyStartY = headerBottomY
    const columnGap = 22
    const columnWidth = cfg.columns === 2 ? (cfg.contentWidth - columnGap) / 2 : cfg.contentWidth
    let column = 0
    const xForColumn = () => cfg.margin + column * (columnWidth + columnGap)
    const resetX = () => { doc.x = xForColumn() }
    const ensureSpace = (minHeight = 80) => {
      if (cfg.columns === 1) return
      if (doc.y + minHeight <= PAGE.height - cfg.margin) return
      const columnAvailableHeight = PAGE.height - cfg.margin - bodyStartY
      if (minHeight > columnAvailableHeight || doc.y === bodyStartY) return
      if (cfg.columns === 2 && column === 0) {
        column = 1
        doc.y = bodyStartY
        resetX()
        return
      }
      doc.addPage()
      column = 0
      doc.y = bodyStartY
      resetX()
    }

    const section = (title: string) => {
      ensureSpace(48)
      doc.moveDown(0.4)
      doc.fillColor(accent).fontSize(fs(13)).text(title, xForColumn(), doc.y, { width: columnWidth })
      doc.moveDown(0.15)
      doc.moveTo(xForColumn(), doc.y).lineTo(xForColumn() + columnWidth, doc.y).strokeColor(line).lineWidth(0.5).stroke()
      doc.moveDown(0.35)
      resetX()
    }
    const entryHead = (left: string, right?: string) => {
      ensureSpace(36)
      const y = doc.y
      const rightWidth = cfg.columns === 1 ? 130 : Math.min(110, Math.max(80, columnWidth * 0.35))
      doc.fillColor(ink).fontSize(fs(11.5)).text(left, xForColumn(), y, { width: columnWidth - rightWidth })
      if (right) {
        doc.fillColor(sub).fontSize(fs(10)).text(right, xForColumn() + columnWidth - rightWidth, y, { width: rightWidth, align: 'right' })
      }
      resetX()
      doc.moveDown(0.1)
    }
    const body = (text: string) => {
      ensureSpace(80)
      doc.fillColor(ink).fontSize(fs(10.5)).text(text, xForColumn(), doc.y, { width: columnWidth, lineGap: cfg.lineGap })
      doc.moveDown(0.4)
      resetX()
    }

    const drawSummary = () => {
      if (!resume.summary.trim()) return
      section('个人简介')
      body(resume.summary)
    }

    const drawEducation = () => {
      if (resume.education.length === 0) return
      section('教育经历')
      for (const e of resume.education) {
        entryHead([e.school, e.major, e.degree].filter(Boolean).join(' · '), e.period)
        if (e.description?.trim()) body(e.description)
        else doc.moveDown(0.3)
      }
    }

    const drawExperience = () => {
      if (resume.experience.length === 0) return
      section('实习 / 工作经历')
      for (const e of resume.experience) {
        entryHead(`${e.company} · ${e.role}`, e.period)
        if (e.description.trim()) body(e.description)
      }
    }

    const drawProjects = () => {
      if (resume.projects.length === 0) return
      section('项目经历')
      for (const p of resume.projects) {
        entryHead(p.role ? `${p.name} · ${p.role}` : p.name)
        if (p.description.trim()) body(p.description)
      }
    }

    const drawSkills = () => {
      if (resume.skills.length === 0) return
      section('技能')
      body(resume.skills.join('  ·  '))
    }

    const drawCertificates = () => {
      if (resume.certificates.length === 0) return
      section('证书 / 资质')
      body(resume.certificates.join('  ·  '))
    }

    const defaultOrder: ResumeTemplateSectionKey[] = ['summary', 'education', 'experience', 'projects', 'skills', 'certificates']
    const order = renderOptions.templatePreset?.sectionOrder.filter((sectionKey) => sectionKey !== 'header') ?? defaultOrder
    let drewSkills = false
    let drewCertificates = false
    for (const sectionKey of order) {
      if (sectionKey === 'summary') drawSummary()
      if (sectionKey === 'education') drawEducation()
      if (sectionKey === 'experience') drawExperience()
      if (sectionKey === 'projects') drawProjects()
      if (sectionKey === 'skills' && !drewSkills) {
        drawSkills()
        drewSkills = true
      }
      if (sectionKey === 'certificates' && !drewCertificates) {
        drawCertificates()
        drewCertificates = true
      }
    }

    // 页数必须在 end() 前取:bufferPages 的页在 end 时刷出,之后 range 为空
    const pageCount = doc.bufferedPageRange().count
    doc.end()
    const buffer = await done
    return { buffer, pageCount }
  }
}
