import { Injectable } from '@nestjs/common'
import type { GeneratedResume } from '../interfaces/ai-provider.interface'

// ============================================================
// ResumeTextService — Wave 1 Task 5 简历 txt / markdown 渲染
//
// 合规:只逐字输出 GeneratedResume 已有字段,不新增/编造任何内容;
// 空字段/空数组优雅跳过,不输出占位假数据。纯字符串渲染,无 I/O、无网络。
//
// 字段顺序对齐 ResumeDocxService / ResumePdfService:
// 姓名+联系方式抬头 → 求职意向 → 个人简介 → 教育经历 → 工作经历
// → 项目 → 技能 → 证书。
// ============================================================

@Injectable()
export class ResumeTextService {
  /** 渲染纯文本简历。分隔线 + 缩进组织,字段顺序同 docx/pdf。 */
  renderTxt(resume: GeneratedResume): string {
    const lines: string[] = []
    const divider = '='.repeat(40)
    const subDivider = '-'.repeat(40)

    const name = resume.basic?.name?.trim()
    lines.push(name || '(未填写姓名)')

    const contact = [
      resume.intention?.position ? `求职意向:${resume.intention.position}` : '',
      resume.intention?.city ? `意向城市:${resume.intention.city}` : '',
      resume.intention?.jobType ? `工作类型:${resume.intention.jobType}` : '',
      resume.intention?.salary ? `期望薪资:${resume.intention.salary}` : '',
      resume.basic?.phone ? `电话:${resume.basic.phone}` : '',
      resume.basic?.email ? `邮箱:${resume.basic.email}` : '',
      resume.basic?.city ? `所在城市:${resume.basic.city}` : '',
    ].filter(Boolean)
    if (contact.length > 0) {
      lines.push(contact.join('  |  '))
    }
    lines.push(divider)

    if (resume.summary?.trim()) {
      lines.push('【个人简介】')
      lines.push(resume.summary.trim())
      lines.push('')
    }

    if (resume.education?.length > 0) {
      lines.push('【教育经历】')
      for (const e of resume.education) {
        const head = [e.school, e.major, e.degree].filter(Boolean).join(' · ')
        lines.push(e.period ? `- ${head}（${e.period}）` : `- ${head}`)
        if (e.description?.trim()) {
          lines.push(`    ${e.description.trim()}`)
        }
      }
      lines.push('')
    }

    if (resume.experience?.length > 0) {
      lines.push('【实习 / 工作经历】')
      for (const e of resume.experience) {
        const head = `${e.company} · ${e.role}`
        lines.push(e.period ? `- ${head}（${e.period}）` : `- ${head}`)
        if (e.description?.trim()) {
          lines.push(`    ${e.description.trim()}`)
        }
      }
      lines.push('')
    }

    if (resume.projects?.length > 0) {
      lines.push('【项目经历】')
      for (const p of resume.projects) {
        const head = p.role ? `${p.name} · ${p.role}` : p.name
        lines.push(`- ${head}`)
        if (p.description?.trim()) {
          lines.push(`    ${p.description.trim()}`)
        }
      }
      lines.push('')
    }

    if (resume.skills?.length > 0) {
      lines.push('【技能】')
      lines.push(resume.skills.join('  ·  '))
      lines.push('')
    }

    if (resume.certificates?.length > 0) {
      lines.push('【证书 / 资质】')
      lines.push(resume.certificates.join('  ·  '))
      lines.push('')
    }

    // 去除末尾多余空行,补上收尾分隔线保持可读性
    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop()
    }
    lines.push(subDivider)

    return lines.join('\n')
  }

  /** 渲染 Markdown 简历。# 姓名 / ## 段落标题 / - 列表项,字段顺序同 docx/pdf。 */
  renderMarkdown(resume: GeneratedResume): string {
    const lines: string[] = []

    const name = resume.basic?.name?.trim()
    lines.push(`# ${name || '(未填写姓名)'}`)
    lines.push('')

    const contact = [
      resume.intention?.position ? `**求职意向**：${resume.intention.position}` : '',
      resume.intention?.city ? `**意向城市**：${resume.intention.city}` : '',
      resume.intention?.jobType ? `**工作类型**：${resume.intention.jobType}` : '',
      resume.intention?.salary ? `**期望薪资**：${resume.intention.salary}` : '',
      resume.basic?.phone ? `**电话**：${resume.basic.phone}` : '',
      resume.basic?.email ? `**邮箱**：${resume.basic.email}` : '',
      resume.basic?.city ? `**所在城市**：${resume.basic.city}` : '',
    ].filter(Boolean)
    if (contact.length > 0) {
      lines.push(contact.join('  \n'))
      lines.push('')
    }

    if (resume.summary?.trim()) {
      lines.push('## 个人简介')
      lines.push('')
      lines.push(resume.summary.trim())
      lines.push('')
    }

    if (resume.education?.length > 0) {
      lines.push('## 教育经历')
      lines.push('')
      for (const e of resume.education) {
        const head = [e.school, e.major, e.degree].filter(Boolean).join(' · ')
        lines.push(e.period ? `- **${head}**（${e.period}）` : `- **${head}**`)
        if (e.description?.trim()) {
          lines.push(`  ${e.description.trim()}`)
        }
      }
      lines.push('')
    }

    if (resume.experience?.length > 0) {
      lines.push('## 实习 / 工作经历')
      lines.push('')
      for (const e of resume.experience) {
        const head = `${e.company} · ${e.role}`
        lines.push(e.period ? `- **${head}**（${e.period}）` : `- **${head}**`)
        if (e.description?.trim()) {
          lines.push(`  ${e.description.trim()}`)
        }
      }
      lines.push('')
    }

    if (resume.projects?.length > 0) {
      lines.push('## 项目经历')
      lines.push('')
      for (const p of resume.projects) {
        const head = p.role ? `${p.name} · ${p.role}` : p.name
        lines.push(`- **${head}**`)
        if (p.description?.trim()) {
          lines.push(`  ${p.description.trim()}`)
        }
      }
      lines.push('')
    }

    if (resume.skills?.length > 0) {
      lines.push('## 技能')
      lines.push('')
      lines.push(resume.skills.map((s) => `- ${s}`).join('\n'))
      lines.push('')
    }

    if (resume.certificates?.length > 0) {
      lines.push('## 证书 / 资质')
      lines.push('')
      lines.push(resume.certificates.map((c) => `- ${c}`).join('\n'))
      lines.push('')
    }

    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop()
    }

    return lines.join('\n')
  }
}
