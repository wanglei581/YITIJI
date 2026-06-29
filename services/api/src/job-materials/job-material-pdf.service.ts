import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { existsSync } from 'fs'
import PDFDocument from 'pdfkit'
import type { GenerateJobMaterialInput, JobMaterialTemplateView } from './job-materials.types'

interface FontCandidate {
  path: string
  family?: string
}

const PAGE = { width: 595.28, height: 841.89 }
const MARGIN = 48
const CONTENT_W = PAGE.width - MARGIN * 2

function fontCandidates(): FontCandidate[] {
  const custom = process.env['JOB_MATERIAL_PDF_FONT_PATH']?.trim() || process.env['RESUME_PDF_FONT_PATH']?.trim()
  const customFamily = process.env['JOB_MATERIAL_PDF_FONT_FAMILY']?.trim() ||
    process.env['RESUME_PDF_FONT_FAMILY']?.trim() ||
    undefined
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

export interface RenderedJobMaterialPdf {
  buffer: Buffer
  pageCount: number
}

@Injectable()
export class JobMaterialPdfService {
  private readonly logger = new Logger(JobMaterialPdfService.name)
  private resolvedFont: FontCandidate | null = null

  async render(template: JobMaterialTemplateView, input: GenerateJobMaterialInput): Promise<RenderedJobMaterialPdf> {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: { Title: `${template.title} - ${input.applicantName}` },
    })
    this.resolveFont(doc)

    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)
    })

    this.drawDocument(doc, template, input)
    const pageCount = Math.max(1, doc.bufferedPageRange().count)
    doc.end()
    const buffer = await done
    return { buffer, pageCount }
  }

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
        this.logger.log(`job material pdf font: ${candidate.path}${candidate.family ? ` (${candidate.family})` : ''}`)
        return
      }
    }
    throw new ServiceUnavailableException({
      error: {
        code: 'JOB_MATERIAL_PDF_FONT_NOT_FOUND',
        message: '服务器缺少可用中文字体，无法生成求职材料 PDF；请配置 JOB_MATERIAL_PDF_FONT_PATH 指向 .ttf/.ttc 中文字体文件',
      },
    })
  }

  private drawDocument(
    doc: InstanceType<typeof PDFDocument>,
    template: JobMaterialTemplateView,
    input: GenerateJobMaterialInput,
  ): void {
    const ink = '#111827'
    const muted = '#6b7280'
    const line = '#d1d5db'
    const accent = '#2563eb'

    doc.fillColor(accent).fontSize(11).text('AI求职打印服务终端 · 求职材料', { width: CONTENT_W, align: 'right' })
    doc.moveDown(0.5)
    doc.fillColor(ink).fontSize(24).text(template.title, { width: CONTENT_W })
    doc.moveDown(0.3)
    doc.fillColor(muted).fontSize(10.5).text(template.description, { width: CONTENT_W, lineGap: 2 })
    doc.moveDown(0.7)
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE.width - MARGIN, doc.y).strokeColor(accent).lineWidth(1.3).stroke()
    doc.moveDown(0.8)

    this.infoRow(doc, '姓名', input.applicantName)
    this.infoRow(doc, '目标岗位', input.targetRole)
    this.infoRow(doc, '目标单位', input.targetOrganization?.trim() || '未填写')
    this.infoRow(doc, '适用场景', template.recommendedFor)
    doc.moveDown(0.4)
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE.width - MARGIN, doc.y).strokeColor(line).lineWidth(0.6).stroke()
    doc.moveDown(0.8)

    if (template.type === 'materials_checklist') {
      this.section(doc, '材料清单')
      this.bullet(doc, '纸质简历 2-3 份，建议黑白双面或按招聘会要求打印。')
      this.bullet(doc, '身份证、学生证、学历证明等证件仅本人保管，现场按需出示。')
      this.bullet(doc, '作品集、证书复印件、成绩单等辅助材料按岗位相关性准备。')
      this.bullet(doc, '提前确认招聘会地址、时间、目标展位和来源平台投递方式。')
    } else if (template.type === 'portfolio_cover') {
      this.section(doc, '作品集封面摘要')
      this.paragraph(doc, `${input.applicantName} / ${input.targetRole}`)
      this.paragraph(doc, `本作品集围绕「${input.targetRole}」相关能力整理，适用于线下面试、招聘会沟通和材料装订。`)
    } else if (template.type === 'thank_you') {
      this.section(doc, '感谢与跟进')
      this.paragraph(doc, `您好，我是${input.applicantName}。感谢您就「${input.targetRole}」岗位与我交流。`)
      this.paragraph(doc, '通过本次沟通，我对岗位职责、团队目标和能力要求有了更具体的理解。')
      this.paragraph(doc, '如后续需要补充材料，我会及时配合提供。期待有机会继续沟通。')
    } else {
      this.section(doc, '自荐正文')
      this.paragraph(doc, `您好，我是${input.applicantName}，正在关注「${input.targetRole}」相关机会。`)
      this.paragraph(doc, '我希望结合自身经历与岗位要求，进一步了解并争取合适的面试或沟通机会。')
    }

    const strengths = input.keyStrengths?.trim()
    if (strengths) {
      this.section(doc, '核心亮点')
      for (const lineText of splitLines(strengths)) this.bullet(doc, lineText)
    }

    const notes = input.notes?.trim()
    if (notes) {
      this.section(doc, '补充说明')
      this.paragraph(doc, notes)
    }

    doc.moveDown(1)
    doc.fillColor(muted).fontSize(9.5).text(
      '本材料由用户在一体机上主动生成，仅用于个人求职准备、查看和打印；系统不提供平台内投递或向企业发送简历服务。',
      MARGIN,
      doc.y,
      { width: CONTENT_W, lineGap: 2 },
    )
  }

  private section(doc: InstanceType<typeof PDFDocument>, title: string): void {
    doc.moveDown(0.5)
    doc.fillColor('#2563eb').fontSize(13).text(title, MARGIN, doc.y, { width: CONTENT_W })
    doc.moveDown(0.25)
  }

  private infoRow(doc: InstanceType<typeof PDFDocument>, label: string, value: string): void {
    const y = doc.y
    doc.fillColor('#6b7280').fontSize(10.5).text(label, MARGIN, y, { width: 72 })
    doc.fillColor('#111827').fontSize(10.5).text(value, MARGIN + 82, y, { width: CONTENT_W - 82, lineGap: 2 })
    doc.moveDown(0.45)
  }

  private paragraph(doc: InstanceType<typeof PDFDocument>, text: string): void {
    doc.fillColor('#111827').fontSize(11).text(text, MARGIN, doc.y, { width: CONTENT_W, lineGap: 4 })
    doc.moveDown(0.5)
  }

  private bullet(doc: InstanceType<typeof PDFDocument>, text: string): void {
    const y = doc.y
    doc.fillColor('#2563eb').fontSize(10.5).text('•', MARGIN, y, { width: 16 })
    doc.fillColor('#111827').fontSize(10.5).text(text, MARGIN + 18, y, { width: CONTENT_W - 18, lineGap: 3 })
    doc.moveDown(0.35)
  }
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n|[；;]/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
}
