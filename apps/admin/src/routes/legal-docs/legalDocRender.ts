// 法务正文的分章规则 —— 与一体机 /legal/:doc 的渲染逐字同一套。
//
// 对照：apps/kiosk/src/pages/legal/legalDocModel.ts 的 splitToParagraphs / headingOf /
// splitLegalSections（两个 app 不能互相 import，只能复制；改那边必须同步改这里，
// verify:legal-doc-version 会比对两边的两条标题正则）。
//
// 规则：空行（连续两个以上换行）分段；段首一行若是 `#`～`####` 开头，或是 30 字以内、
// 不以句号 / 分号 / 逗号结尾、以「第X章/节/条/部分」或「一、」式开头的短行，就当章节标题；
// 认不出任何标题时整篇作为「全文」一章。段内单个换行照原样保留（一体机用 white-space: pre-line）。
// 不支持加粗、斜体、链接等其它 Markdown 写法，这些符号会原样显示。

export interface LegalSection {
  title: string
  paragraphs: string[]
}

export function splitToParagraphs(content: string): string[] {
  return content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
}

const MARKDOWN_HEADING = /^#{1,4}\s+(.+)$/
const ORDINAL_HEADING = /^(?:第[一二三四五六七八九十百零〇\d]+[章节条部分]|[一二三四五六七八九十]+、)/

function headingOf(line: string): string | null {
  const trimmed = line.trim()
  const markdown = MARKDOWN_HEADING.exec(trimmed)
  if (markdown) return markdown[1].trim()
  if (trimmed.length <= 30 && ORDINAL_HEADING.test(trimmed) && !/[。；;，,]$/.test(trimmed)) return trimmed
  return null
}

export function splitLegalSections(content: string): LegalSection[] {
  const sections: LegalSection[] = []
  let current: LegalSection | null = null
  for (const block of splitToParagraphs(content)) {
    const [first, ...rest] = block.split('\n')
    const heading = headingOf(first)
    if (heading) {
      current = { title: heading, paragraphs: [] }
      sections.push(current)
      const body = rest.join('\n').trim()
      if (body) current.paragraphs.push(body)
      continue
    }
    if (!current) {
      current = { title: '', paragraphs: [] }
      sections.push(current)
    }
    current.paragraphs.push(block)
  }
  if (sections.length === 0) return [{ title: '全文', paragraphs: [] }]
  if (sections.length === 1 && !sections[0].title) return [{ title: '全文', paragraphs: sections[0].paragraphs }]
  return sections.map((section) => (section.title ? section : { ...section, title: '开篇说明' }))
}
