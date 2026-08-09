// ============================================================
// FairCompanyPrintService
//
// 参会企业「企业资料 / 岗位清单」按需打印。
//
// 背景：Kiosk FairCompanyDetailPage 此前直接 navigate('/print/preview') 并伪造
// 一个只有 name/size/pages 的 PrintFile —— 没有 fileId、没有 fileUrl，而
// PrintPreviewPage 判定 `!file.fileUrl` 即视为不可预览，后续也无法建打印任务，
// 按钮点了永远不出纸。本服务补上真实链路：库内展示数据 → 渲染 PDF →
// 走 FilesService 落成标准短期 FileObject → 返回内部 HMAC 签名 printFileUrl。
//
// 与 FairMaterialPrintBridgeService 的差异：活动资料是「已存在的用户上传文件」，
// 需要桥接表做去重 / single-flight / TTL 复用；企业资料没有预置文件，是按库内
// 展示字段实时渲染的派生件，因此沿用 JobMaterialsService 的「渲染→上传→返回」
// 模式即可，不需要新增数据模型。
//
// 合规：只渲染 FairCompany / FairCompanyPosition 中本就对 Kiosk 公开展示的字段，
// 不含联系人、HR 邮箱等可用于私下投递的信息；页脚固定声明本系统不接收简历。
// ============================================================

import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { existsSync } from 'fs'
import PDFDocument from 'pdfkit'
import { FilesService } from '../files/files.service'
import { PrismaService } from '../prisma/prisma.service'
import { signFileUrl } from '../files/signing'
import { withPublicFairDemoExclusion } from './jobs-shared'

/** 派生打印文件 TTL：与活动资料桥接件保持一致（1 小时）。 */
const PRINT_FILE_TTL_MS = 60 * 60 * 1000
/** 单次打印最多渲染的岗位条数，避免一键产出几十页纸；超出部分在 PDF 内如实说明。 */
const MAX_PRINTED_POSITIONS = 60
const GENERATED_BY = 'fair_company_print'

const PAGE = { width: 595.28, height: 841.89 }
const MARGIN = 48
const CONTENT_W = PAGE.width - MARGIN * 2

const INK = '#111827'
const MUTED = '#6b7280'
const FAINT = '#9ca3af'
const LINE = '#d1d5db'
const ACCENT = '#2563eb'

export type FairCompanyPrintVariant = 'profile' | 'positions'

export interface FairCompanyPrintView {
  fileId: string
  filename: string
  sizeBytes: number
  mimeType: string
  pageCount: number
  printFileUrl: string
  variant: FairCompanyPrintVariant
}

interface PrintablePosition {
  title: string
  headcount: number
  salary: string | null
  requirements: string | null
  education: string | null
  experience: string | null
  location: string | null
  positionType: string | null
  department: string | null
}

interface PrintableCompany {
  id: string
  name: string
  industry: string | null
  scale: string | null
  description: string | null
  founded: string | null
  headquarters: string | null
  registeredCapital: string | null
  honorTags: string
  boothNumber: string | null
  sourceUrl: string | null
  positions: PrintablePosition[]
}

const POSITION_TYPE_LABELS: Record<string, string> = {
  full_time: '全职',
  part_time: '兼职',
  intern: '实习',
}

const SCALE_LABELS: Record<string, string> = {
  '<50': '50 人以下',
  '50-500': '50-500 人',
  '500-2000': '500-2000 人',
  '>2000': '2000 人以上',
}

interface FontCandidate {
  path: string
  family?: string
}

/**
 * 中文字体候选。与 job-material-pdf / resume-pdf 等既有 PDF 服务同构：
 * 本仓库现有 7 个 PDF 服务各自持有一份，此处沿用同一约定，不在本次修复里
 * 顺带重构那 7 个文件（改动面控制）。
 */
function fontCandidates(): FontCandidate[] {
  const custom = process.env['JOB_MATERIAL_PDF_FONT_PATH']?.trim() || process.env['RESUME_PDF_FONT_PATH']?.trim()
  const list: FontCandidate[] = []
  if (custom) list.push({ path: custom })
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
    )
  } else {
    list.push(
      { path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', family: 'NotoSansCJKsc-Regular' },
      { path: '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', family: 'WenQuanYi Micro Hei' },
    )
  }
  return list
}

@Injectable()
export class FairCompanyPrintService {
  private readonly logger = new Logger(FairCompanyPrintService.name)
  private resolvedFont: FontCandidate | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  async prepare(fairId: string, companyId: string, rawVariant: string | undefined): Promise<FairCompanyPrintView> {
    const variant = parseVariant(rawVariant)
    const company = await this.requirePrintableCompany(fairId, companyId)
    if (variant === 'positions' && company.positions.length === 0) {
      throw new NotFoundException({
        error: { code: 'FAIR_COMPANY_NO_POSITIONS', message: '该企业暂无可打印的岗位信息' },
      })
    }

    const rendered = await this.render(variant, company)
    const expiresAt = new Date(Date.now() + PRINT_FILE_TTL_MS)
    const uploaded = await this.files.upload({
      buffer: rendered.buffer,
      filename: safePdfFilename(`${company.name}_${variant === 'profile' ? '企业资料' : '岗位清单'}`),
      mimeType: 'application/pdf',
      purpose: 'fair_material',
      uploaderId: null,
      assetCategory: 'derived',
      createdBy: GENERATED_BY,
      validationMode: 'intent',
      expiresAtOverride: expiresAt,
    })

    this.logger.log(
      `faircompany.print_ready company=${company.id} variant=${variant} file=${uploaded.fileId} pages=${rendered.pageCount}`,
    )

    return {
      fileId: uploaded.fileId,
      filename: uploaded.filename,
      sizeBytes: uploaded.sizeBytes,
      mimeType: 'application/pdf',
      pageCount: rendered.pageCount,
      printFileUrl: signFileUrl(uploaded.fileId).url,
      variant,
    }
  }

  /** 与 JobsKioskService.getFairCompanyById 同一可见性口径：招聘会须 approved + published。 */
  private async requirePrintableCompany(fairId: string, companyId: string): Promise<PrintableCompany> {
    const fair = await this.prisma.jobFair.findFirst({
      where: withPublicFairDemoExclusion({ id: fairId, reviewStatus: 'approved', publishStatus: 'published' }),
      select: { id: true },
    })
    if (!fair) throw companyNotPrintableError()

    const company = await this.prisma.fairCompany.findFirst({
      where: { id: companyId, jobFairId: fairId },
      include: { positions: { orderBy: { sortOrder: 'asc' } } },
    })
    if (!company) throw companyNotPrintableError()

    return {
      id: company.id,
      name: company.name,
      industry: company.industry,
      scale: company.scale,
      description: company.description,
      founded: company.founded,
      headquarters: company.headquarters,
      registeredCapital: company.registeredCapital,
      honorTags: company.honorTags,
      boothNumber: company.boothNumber,
      sourceUrl: company.sourceUrl,
      positions: company.positions.map((position) => ({
        title: position.title,
        headcount: position.headcount,
        salary: position.salary,
        requirements: position.requirements,
        education: position.education,
        experience: position.experience,
        location: position.location,
        positionType: position.positionType,
        department: position.department,
      })),
    }
  }

  private async render(
    variant: FairCompanyPrintVariant,
    company: PrintableCompany,
  ): Promise<{ buffer: Buffer; pageCount: number }> {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: { Title: `${company.name} - ${variant === 'profile' ? '企业资料' : '岗位清单'}` },
    })
    this.resolveFont(doc)

    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)
    })

    this.drawHeader(doc, company, variant)
    if (variant === 'profile') this.drawProfile(doc, company)
    else this.drawPositions(doc, company)
    this.drawFooter(doc, company)

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
        return
      }
    }
    doc.end()
    throw new ServiceUnavailableException({
      error: {
        code: 'FAIR_COMPANY_PDF_FONT_NOT_FOUND',
        message: '服务器缺少可用中文字体，暂时无法生成企业资料 PDF；请配置 JOB_MATERIAL_PDF_FONT_PATH',
      },
    })
  }

  private drawHeader(
    doc: InstanceType<typeof PDFDocument>,
    company: PrintableCompany,
    variant: FairCompanyPrintVariant,
  ): void {
    doc.fillColor(ACCENT).fontSize(10.5).text('AI求职打印服务终端 · 招聘会参会企业信息', { width: CONTENT_W, align: 'right' })
    doc.moveDown(0.5)
    doc.fillColor(INK).fontSize(22).text(company.name, { width: CONTENT_W })
    doc.moveDown(0.25)
    doc.fillColor(MUTED).fontSize(11).text(variant === 'profile' ? '企业资料' : '招聘岗位清单', { width: CONTENT_W })
    doc.moveDown(0.6)
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE.width - MARGIN, doc.y).strokeColor(ACCENT).lineWidth(1.3).stroke()
    doc.moveDown(0.8)
  }

  private drawProfile(doc: InstanceType<typeof PDFDocument>, company: PrintableCompany): void {
    this.section(doc, '企业基本信息')
    this.infoRow(doc, '所属行业', company.industry)
    this.infoRow(doc, '企业规模', company.scale ? SCALE_LABELS[company.scale] ?? company.scale : null)
    this.infoRow(doc, '成立年份', company.founded)
    this.infoRow(doc, '总部城市', company.headquarters)
    this.infoRow(doc, '注册资本', company.registeredCapital)
    this.infoRow(doc, '现场展位', company.boothNumber)
    this.infoRow(doc, '在招岗位', `${company.positions.length} 个`)

    const honors = splitTags(company.honorTags)
    if (honors.length > 0) {
      this.section(doc, '企业标签')
      this.paragraph(doc, honors.join(' · '))
    }

    const description = company.description?.trim()
    if (description) {
      this.section(doc, '企业介绍')
      this.paragraph(doc, description)
    }

    if (company.positions.length > 0) {
      this.section(doc, '在招岗位概览')
      for (const position of company.positions.slice(0, 12)) {
        this.bullet(doc, [position.title, position.salary, position.location].filter(Boolean).join(' · '))
      }
      if (company.positions.length > 12) {
        doc.fillColor(FAINT).fontSize(9.5).text(
          `另有 ${company.positions.length - 12} 个岗位未在本页列出，可返回一体机选择「打印岗位清单」查看完整列表。`,
          MARGIN,
          doc.y,
          { width: CONTENT_W, lineGap: 2 },
        )
        doc.moveDown(0.4)
      }
    }
  }

  private drawPositions(doc: InstanceType<typeof PDFDocument>, company: PrintableCompany): void {
    const printed = company.positions.slice(0, MAX_PRINTED_POSITIONS)
    const omitted = company.positions.length - printed.length

    doc.fillColor(MUTED).fontSize(10).text(
      `共 ${company.positions.length} 个岗位${omitted > 0 ? `，本次打印前 ${printed.length} 个` : ''}${
        company.boothNumber ? ` ｜ 现场展位 ${company.boothNumber}` : ''
      }`,
      MARGIN,
      doc.y,
      { width: CONTENT_W },
    )
    doc.moveDown(0.6)

    printed.forEach((position, index) => {
      const meta = [
        position.positionType ? POSITION_TYPE_LABELS[position.positionType] ?? position.positionType : null,
        position.location,
        position.education,
        position.experience,
        position.headcount > 0 ? `招 ${position.headcount} 人` : null,
        position.department,
      ]
        .filter(Boolean)
        .join(' ｜ ')

      doc.fillColor(ACCENT).fontSize(12).text(`${index + 1}. ${position.title}`, MARGIN, doc.y, { width: CONTENT_W })
      doc.moveDown(0.15)
      if (position.salary) {
        doc.fillColor(INK).fontSize(10.5).text(`薪资：${position.salary}`, MARGIN + 14, doc.y, { width: CONTENT_W - 14 })
      }
      if (meta) {
        doc.fillColor(MUTED).fontSize(10).text(meta, MARGIN + 14, doc.y, { width: CONTENT_W - 14, lineGap: 2 })
      }
      const requirements = position.requirements?.trim()
      if (requirements) {
        doc.fillColor(INK).fontSize(10).text(`岗位要求：${requirements}`, MARGIN + 14, doc.y, {
          width: CONTENT_W - 14,
          lineGap: 3,
        })
      }
      doc.moveDown(0.35)
      doc.moveTo(MARGIN, doc.y).lineTo(PAGE.width - MARGIN, doc.y).strokeColor(LINE).lineWidth(0.5).stroke()
      doc.moveDown(0.45)
    })

    if (omitted > 0) {
      doc.fillColor(FAINT).fontSize(9.5).text(
        `另有 ${omitted} 个岗位未打印（单次打印上限 ${MAX_PRINTED_POSITIONS} 个），完整岗位列表以来源平台为准。`,
        MARGIN,
        doc.y,
        { width: CONTENT_W, lineGap: 2 },
      )
      doc.moveDown(0.4)
    }
  }

  private drawFooter(doc: InstanceType<typeof PDFDocument>, company: PrintableCompany): void {
    doc.moveDown(0.8)
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE.width - MARGIN, doc.y).strokeColor(LINE).lineWidth(0.6).stroke()
    doc.moveDown(0.5)
    doc.fillColor(MUTED).fontSize(9).text(`打印时间：${formatDateTime(new Date())}`, MARGIN, doc.y, { width: CONTENT_W })
    if (company.sourceUrl) {
      doc.fillColor(MUTED).fontSize(9).text(`来源链接：${company.sourceUrl}`, MARGIN, doc.y, { width: CONTENT_W })
    }
    doc.moveDown(0.2)
    doc.fillColor(FAINT).fontSize(9).text(
      '本页信息由招聘会主办方 / 来源机构提供，仅供本人现场了解企业与岗位时参考；岗位办理请前往来源平台或现场展位咨询。' +
        '本系统不接收简历，不提供平台内投递、筛选或面试邀约服务。',
      MARGIN,
      doc.y,
      { width: CONTENT_W, lineGap: 2 },
    )
  }

  private section(doc: InstanceType<typeof PDFDocument>, title: string): void {
    doc.moveDown(0.5)
    doc.fillColor(ACCENT).fontSize(13).text(title, MARGIN, doc.y, { width: CONTENT_W })
    doc.moveDown(0.25)
  }

  private infoRow(doc: InstanceType<typeof PDFDocument>, label: string, value: string | null | undefined): void {
    const y = doc.y
    doc.fillColor(MUTED).fontSize(10.5).text(label, MARGIN, y, { width: 72 })
    doc.fillColor(INK).fontSize(10.5).text(value?.trim() || '未提供', MARGIN + 82, y, {
      width: CONTENT_W - 82,
      lineGap: 2,
    })
    doc.moveDown(0.45)
  }

  private paragraph(doc: InstanceType<typeof PDFDocument>, text: string): void {
    doc.fillColor(INK).fontSize(11).text(text, MARGIN, doc.y, { width: CONTENT_W, lineGap: 4 })
    doc.moveDown(0.5)
  }

  private bullet(doc: InstanceType<typeof PDFDocument>, text: string): void {
    const y = doc.y
    doc.fillColor(ACCENT).fontSize(10.5).text('•', MARGIN, y, { width: 16 })
    doc.fillColor(INK).fontSize(10.5).text(text, MARGIN + 18, y, { width: CONTENT_W - 18, lineGap: 3 })
    doc.moveDown(0.35)
  }
}

function parseVariant(raw: string | undefined): FairCompanyPrintVariant {
  if (raw === 'profile' || raw === 'positions') return raw
  throw new BadRequestException({
    error: { code: 'FAIR_COMPANY_PRINT_VARIANT_INVALID', message: 'variant 只能是 profile 或 positions' },
  })
}

function companyNotPrintableError(): NotFoundException {
  return new NotFoundException({
    error: { code: 'FAIR_COMPANY_NOT_PRINTABLE', message: '企业不存在，或所属招聘会未通过审核 / 未发布' },
  })
}

function splitTags(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12)
}

function safePdfFilename(name: string): string {
  const trimmed = name.trim().replace(/[\\/:*?"<>|]/g, '-')
  return `${trimmed || '企业资料'}.pdf`
}

function formatDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
