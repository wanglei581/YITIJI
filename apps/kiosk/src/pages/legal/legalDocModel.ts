// /legal/:doc 的纯逻辑：取数结果归类、正文分章、返回来源。不含任何条款正文。
//
// 稿 08-legal 的阅读排版是「左目录 + 右单章」。服务端返回的是一整段文本（运营方在后台
// 录入，段落之间空一行），章节只能从文本本身认出来：认 Markdown 标题（#）、
// 「第X章/节/条」和「一、」式短行。认不出任何章节时整篇作为「全文」一章，不硬拆。

export interface Section {
  title: string
  paragraphs: string[]
}

/** 服务端 `GET /kiosk/legal/{docType}` 的 data 形状（版本号与发布时间只从这里来）。 */
export interface ApiDocContent {
  content: string
  publishedAt: string | null
  version?: string | null
}

/**
 * 单份文档的取数结果：
 * - ready  服务端给出了当前有效版本的正文；
 * - draft  服务端可达，但运营方还没有激活任何版本（data: null）；
 * - error  请求失败、非 2xx 或形状不对 —— 取不到，不顶替。
 */
export type DocLoad =
  | { status: 'loading' }
  | { status: 'ready'; content: string; publishedAt: string | null; version: string | null }
  | { status: 'draft' }
  | { status: 'error' }

/** 将 Markdown 纯文本按段落分行（不引入新依赖，仅分段落渲染） */
export function splitToParagraphs(content: string): string[] {
  return content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
}

const MARKDOWN_HEADING = /^#{1,4}\s+(.+)$/
const ORDINAL_HEADING = /^(?:第[一二三四五六七八九十百零〇\d]+[章节条部分]|[一二三四五六七八九十]+、)/

/** 一行是不是章节标题。正文里的「1. …」编号句不算，以免把一章拆成几十段。 */
function headingOf(line: string): string | null {
  const trimmed = line.trim()
  const markdown = MARKDOWN_HEADING.exec(trimmed)
  if (markdown) return markdown[1].trim()
  if (trimmed.length <= 30 && ORDINAL_HEADING.test(trimmed) && !/[。；;，,]$/.test(trimmed)) return trimmed
  return null
}

export function splitLegalSections(content: string): Section[] {
  const sections: Section[] = []
  let current: Section | null = null
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

export function readDocLoad(json: unknown): DocLoad {
  const envelope = json as { success?: boolean; data?: ApiDocContent | null } | null
  if (!envelope?.success) return { status: 'error' }
  if (envelope.data == null) return { status: 'draft' }
  const content = typeof envelope.data.content === 'string' ? envelope.data.content.trim() : ''
  if (!content) return { status: 'error' }
  const version = typeof envelope.data.version === 'string' ? envelope.data.version.trim() : ''
  return {
    status: 'ready',
    content,
    publishedAt: typeof envelope.data.publishedAt === 'string' ? envelope.data.publishedAt : null,
    version: version || null,
  }
}

export function formatPublishedAt(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

/** 稿 08 的受控返回来源：只认这四个键，未知一律不采信（回上一页或首页），不接受任意路径。 */
export const FROM_TARGETS = {
  home: { label: '返回首页', route: '/' },
  login: { label: '返回登录', route: '/login' },
  profile: { label: '返回我的', route: '/profile' },
  help: { label: '返回帮助', route: '/help' },
} as const

export type FromKey = keyof typeof FROM_TARGETS

export function readFromKey(search: string): FromKey | null {
  const value = new URLSearchParams(search).get('from')
  return value !== null && Object.prototype.hasOwnProperty.call(FROM_TARGETS, value) ? (value as FromKey) : null
}
