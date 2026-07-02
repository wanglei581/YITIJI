import { Injectable } from '@nestjs/common'
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx'
import type { GeneratedResume } from '../interfaces/ai-provider.interface'

// ============================================================
// ResumeDocxService — Wave 1 Task 4 简历 Word(docx) 渲染
//
// 合规:只逐字输出 GeneratedResume 已有字段,不新增/编造任何内容;
// 空字段/空数组优雅跳过,不输出占位假数据。中文渲染依赖 Word/Office
// 端字体,docx 文件本身无需内嵌字体。
//
// 字段顺序对齐 ResumePdfService(resume-pdf.service.ts):
// 姓名+联系方式抬头 → 求职意向 → 个人简介 → 教育经历 → 工作经历
// → 项目 → 技能 → 证书。
// ============================================================

const ACCENT = '2563EB'
const SUB = '6B7280'
const INK = '1F2937'

export interface RenderedResumeDocx {
  buffer: Buffer
}

@Injectable()
export class ResumeDocxService {
  /** 渲染简历 docx。返回 buffer。 */
  async render(resume: GeneratedResume): Promise<RenderedResumeDocx> {
    const children: Paragraph[] = []

    // ── 头部:姓名 + 求职意向 + 联系方式 ─────────────────────────────
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        spacing: { after: 120 },
        children: [new TextRun({ text: resume.basic.name, bold: true, color: INK, size: 44 })],
      }),
    )

    const contact = [
      resume.intention.position ? `求职意向:${resume.intention.position}` : '',
      resume.intention.city ? `意向城市:${resume.intention.city}` : '',
      resume.basic.phone ? `电话:${resume.basic.phone}` : '',
      resume.basic.email ? `邮箱:${resume.basic.email}` : '',
    ].filter(Boolean).join('  ·  ')
    if (contact) {
      children.push(
        new Paragraph({
          spacing: { after: 240 },
          border: { bottom: { style: 'single', size: 6, color: ACCENT, space: 8 } },
          children: [new TextRun({ text: contact, color: SUB, size: 21 })],
        }),
      )
    } else {
      children.push(
        new Paragraph({
          spacing: { after: 240 },
          border: { bottom: { style: 'single', size: 6, color: ACCENT, space: 8 } },
          children: [new TextRun({ text: '', size: 21 })],
        }),
      )
    }

    const section = (title: string): Paragraph =>
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
        border: { bottom: { style: 'single', size: 4, color: 'D1D5DB', space: 4 } },
        children: [new TextRun({ text: title, bold: true, color: ACCENT, size: 26 })],
      })

    const entryHead = (left: string, right?: string): Paragraph =>
      new Paragraph({
        spacing: { after: 40 },
        tabStops: [{ type: 'right', position: 9026 }],
        children: [
          new TextRun({ text: left, bold: true, color: INK, size: 23 }),
          ...(right ? [new TextRun({ text: `\t${right}`, color: SUB, size: 20 })] : []),
        ],
      })

    const body = (text: string): Paragraph =>
      new Paragraph({
        spacing: { after: 160, line: 300 },
        children: [new TextRun({ text, color: INK, size: 21 })],
      })

    if (resume.summary.trim()) {
      children.push(section('个人简介'))
      children.push(body(resume.summary))
    }

    if (resume.education.length > 0) {
      children.push(section('教育经历'))
      for (const e of resume.education) {
        children.push(entryHead([e.school, e.major, e.degree].filter(Boolean).join(' · '), e.period))
        if (e.description?.trim()) {
          children.push(body(e.description))
        } else {
          children.push(new Paragraph({ spacing: { after: 120 }, children: [] }))
        }
      }
    }

    if (resume.experience.length > 0) {
      children.push(section('实习 / 工作经历'))
      for (const e of resume.experience) {
        children.push(entryHead(`${e.company} · ${e.role}`, e.period))
        if (e.description.trim()) children.push(body(e.description))
      }
    }

    if (resume.projects.length > 0) {
      children.push(section('项目经历'))
      for (const p of resume.projects) {
        children.push(entryHead(p.role ? `${p.name} · ${p.role}` : p.name))
        if (p.description.trim()) children.push(body(p.description))
      }
    }

    if (resume.skills.length > 0) {
      children.push(section('技能'))
      children.push(body(resume.skills.join('  ·  ')))
    }

    if (resume.certificates.length > 0) {
      children.push(section('证书 / 资质'))
      children.push(body(resume.certificates.join('  ·  ')))
    }

    const doc = new Document({
      title: `${resume.basic.name} 的简历`,
      sections: [
        {
          properties: {},
          children,
        },
      ],
    })

    const buffer = await Packer.toBuffer(doc)
    return { buffer }
  }
}
