// 读 D1 的 policies.md / channels.md。
// 实际稿是「## 机构 / ### 标题 / 编辑状态、出处、摘要段落」，也兼容：
// 「- 标注 / - 类型 / - 正文」草案、Markdown 表格、```json 围栏。
import { orgByKey, orgKeyFromName } from './d2-catalog.mjs'

const DISPOSITIONS = [
  ['待审核', 'pending'],
  ['留待审核', 'pending'],
  ['准备下架', 'takedown'],
  ['待下架', 'takedown'],
  ['已过期', 'expired'],
  ['已发布', 'publish'],
  ['发布', 'publish'],
]

function stripMarks(value) {
  return String(value ?? '').replace(/\*\*/g, '').replace(/`/g, '').trim()
}

function fieldMap(lines) {
  const map = {}
  const body = []
  let inBody = false
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      if (inBody) body.push('')
      continue
    }
    const matched = line.match(/^(?:[-*]\s*)?(?:\*\*)?([^：:*]{1,16})(?:\*\*)?\s*[：:]\s*(.*)$/)
    if (!inBody && matched) {
      const key = stripMarks(matched[1])
      const value = stripMarks(matched[2])
      if (/^正文/.test(key)) {
        inBody = true
        if (value) body.push(value)
        continue
      }
      map[key] = map[key] ? `${map[key]}\n${value}` : value
      continue
    }
    if (inBody) body.push(line.replace(/^>\s?/, ''))
  }
  if (body.length) map['正文'] = body.join('\n').trim()
  return map
}

function dispositionOf(value) {
  const text = stripMarks(value)
  for (const [label, code] of DISPOSITIONS) {
    if (text.includes(label)) return code
  }
  if (/pending/i.test(text)) return 'pending'
  if (/expire/i.test(text)) return 'expired'
  if (/takedown|unpublish/i.test(text)) return 'takedown'
  return 'publish'
}

function kindOf(value) {
  const text = stripMarks(value)
  if (/扶持|policy_guide|guide/i.test(text)) return 'policy_guide'
  return 'notice'
}

function audienceOf(value) {
  const text = stripMarks(value)
  if (/应届|毕业|高校|见习/.test(text) || text === 'graduate') return 'graduate'
  if (/灵活|零工|家政|家庭服务/.test(text) || text === 'flexible') return 'flexible'
  if (/返乡|务工/.test(text) || text === 'migrant') return 'migrant'
  if (/困难/.test(text) || text === 'hardship') return 'hardship'
  if (/创业|贷款/.test(text) || text === 'startup') return 'startup'
  return 'general'
}

function categoryOf(value) {
  const text = stripMarks(value)
  if (/招募|recruitment/.test(text)) return 'recruitment'
  if (/公告|announcement|房源|直通车/.test(text)) return 'announcement'
  if (/通知|须知|指引/.test(text) || text === 'notice') return 'notice'
  return 'policy'
}

function firstDate(value) {
  return String(value ?? '').match(/20\d{2}-\d{2}-\d{2}/)?.[0] ?? null
}

function dateOf(lines, fields, disposition) {
  const labels = ['拟发布日期', '拟稿日期', '出处发布日期', '出处页面日期', '出处日期', '展示日期', '发布日期', '日期']
  for (const label of labels) {
    const fromField = firstDate(fields[label])
    if (fromField) return fromField
    const line = lines.find((item) => item.includes(label))
    const fromLine = firstDate(line)
    if (fromLine) return fromLine
  }
  if (disposition === 'expired') return '2024-12-31'
  return '2026-09-01'
}

function summaryOf(lines, fields, title) {
  if (fields['摘要']) return fields['摘要']
  for (const raw of lines) {
    const line = raw.trim().replace(/^[-*]\s*/, '')
    const matched = line.match(/^摘要[^：:]{0,24}[：:]\s*(.+)$/)
    if (matched?.[1]) return matched[1].trim()
  }
  const paragraph = lines
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('-') && !line.startsWith('#') && !line.startsWith('|') && !/^https?:/.test(line))
  return paragraph || `示例。${title}`
}

function urlsIn(text) {
  return [...String(text).matchAll(/https?:\/\/[^\s)）>]+/g)]
    .map((match) => match[0].replace(/[)）、，。；]+$/u, ''))
}

function policyFromBlock(orgKey, title, lines) {
  const org = orgByKey(orgKey)
  const fields = fieldMap(lines)
  const text = lines.join('\n')
  const cleanTitle = stripMarks(title).replace(/^\d+\.\s*/, '').slice(0, 200)
  const disposition = dispositionOf(fields['编辑状态'] || fields['标注'] || fields['状态'] || fields['处置'] || '')
  const publishedDate = dateOf(lines, fields, disposition)
  const externalUrl = urlsIn([fields['来源'], fields['出处'], fields['链接'], text].filter(Boolean).join('\n'))[0] || ''
  const example = /性质\s*[：:][^\n]*示例/.test(text) || cleanTitle.startsWith('示例')
  const summary = summaryOf(lines, fields, cleanTitle).replace(/\s+/g, ' ').slice(0, 500)
  const explicitKind = fields['类型'] || fields['kind']
  const guide = explicitKind
    ? kindOf(explicitKind) === 'policy_guide'
    : !example && /补贴|贷款|见习|贴息/.test(cleanTitle)
  const kind = guide ? 'policy_guide' : 'notice'
  const audience = audienceOf(fields['人群'] || fields['适用人群'] || fields['audience'] || cleanTitle)
  const category = fields['标签'] || fields['公告标签'] || fields['category']
    ? categoryOf(fields['标签'] || fields['公告标签'] || fields['category'])
    : categoryOf(cleanTitle)
  const head = example
    ? '【示例】没有可对照的公开原文，不写金额，不构成办理承诺。'
    : `【转载】只转述出处原文。出处日期 ${publishedDate}。链接 ${externalUrl || '（稿面未给链接）'}。金额、期限、间数以出处当页为准，不是本机构新定的标准。`
  const body = fields['正文'] || lines.map((line) => line.trim()).filter(Boolean).join('\n')
  const content = `${head}\n\n${body}`.slice(0, 8000)
  return {
    orgKey,
    orgName: org.name,
    title: cleanTitle,
    disposition,
    kind,
    audience,
    category: kind === 'notice' ? category : 'policy',
    publishedDate,
    externalUrl: externalUrl.slice(0, 500),
    summary,
    content,
    example,
  }
}

function parseHeadingMarkdown(markdown) {
  const policies = []
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let orgKey = null
  let title = null
  let bucket = []
  const flush = () => {
    if (orgKey && title) policies.push(policyFromBlock(orgKey, title, bucket))
    bucket = []
  }
  for (const line of lines) {
    const itemHeading = line.match(/^###\s+(.+?)\s*$/)
    const orgHeading = line.match(/^##\s+(.+?)\s*$/)
    if (itemHeading) {
      flush()
      title = stripMarks(itemHeading[1])
      continue
    }
    if (orgHeading) {
      flush()
      title = null
      orgKey = orgKeyFromName(stripMarks(orgHeading[1]))
      continue
    }
    if (title) bucket.push(line)
  }
  flush()
  return policies
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => stripMarks(cell))
}

function parseTables(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const policies = []
  let headers = null
  for (const line of lines) {
    if (!line.trim().startsWith('|')) {
      headers = null
      continue
    }
    const cells = splitTableRow(line)
    if (!headers) {
      headers = cells
      continue
    }
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue
    const row = {}
    headers.forEach((header, index) => { row[header] = cells[index] ?? '' })
    const orgKey = orgKeyFromName(row['机构'] || row['发布机构'] || row['所属机构'] || '')
    const title = row['标题'] || row['政策标题']
    if (!orgKey || !title) continue
    policies.push(policyFromBlock(orgKey, title, [
      `- 标注：${row['标注'] || row['状态'] || row['处置'] || ''}`,
      `- 类型：${row['类型'] || ''}`,
      `- 人群：${row['人群'] || row['适用人群'] || ''}`,
      `- 标签：${row['标签'] || row['公告标签'] || ''}`,
      `- 展示日期：${row['展示日期'] || row['日期'] || row['发布日期'] || ''}`,
      `- 来源：${row['来源'] || row['出处'] || row['链接'] || ''}`,
      `- 摘要：${row['摘要'] || ''}`,
      `- 正文：${row['正文'] || row['摘要'] || ''}`,
    ]))
  }
  return policies
}

function parseJsonFence(markdown) {
  const matched = markdown.match(/```json\s*([\s\S]*?)```/)
  if (!matched) return []
  let data
  try { data = JSON.parse(matched[1]) } catch { return [] }
  const list = Array.isArray(data) ? data : data.policies
  if (!Array.isArray(list)) return []
  return list.map((item) => {
    const orgKey = item.orgKey || orgKeyFromName(item.org || item.orgName || '')
    if (!orgKey || !item.title) return null
    return policyFromBlock(orgKey, item.title, [
      `- 标注：${item.disposition || item.mark || item.status || ''}`,
      `- 类型：${item.kind || ''}`,
      `- 人群：${item.audience || ''}`,
      `- 标签：${item.category || ''}`,
      `- 展示日期：${item.publishedDate || item.date || ''}`,
      `- 来源：${item.externalUrl || item.source || item.url || ''}`,
      `- 摘要：${item.summary || ''}`,
      `- 正文：${item.content || item.body || ''}`,
    ])
  }).filter(Boolean)
}

export function parsePolicies(markdown) {
  const fromJson = parseJsonFence(markdown)
  if (fromJson.length >= 8) return fromJson
  const fromHeadings = parseHeadingMarkdown(markdown)
  if (fromHeadings.length >= 8) return fromHeadings
  const fromTables = parseTables(markdown)
  if (fromTables.length > fromHeadings.length) return fromTables
  return fromHeadings.length ? fromHeadings : fromTables
}

function channelFrom(orgKey, name, url, order) {
  return {
    orgKey,
    name: String(name).replace(/\s+/g, ' ').trim().slice(0, 40),
    url: String(url).trim(),
    order: String(order || '1').replace(/\D/g, '') || '1',
  }
}

function displayChannelName(orgKey, raw) {
  const name = stripMarks(raw).replace(/\s+/g, ' ').trim()
  if (name.includes('示例') || name.includes('「')) return name.slice(0, 40)
  const short = { shinan: '市南', laoshan: '崂山', huangdao: '黄岛', chengyang: '城阳' }[orgKey] || ''
  return `示例·${short}${name}`.slice(0, 40)
}

function parseNumberedChannels(markdown) {
  const channels = []
  let orgKey = null
  let current = null
  const flush = () => {
    if (current?.name && current.url && orgKey) {
      channels.push(channelFrom(orgKey, displayChannelName(orgKey, current.name), current.url, current.order))
    }
    current = null
  }
  for (const raw of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const orgHeading = raw.match(/^##\s+(.+?)\s*$/)
    if (orgHeading) {
      flush()
      orgKey = orgKeyFromName(stripMarks(orgHeading[1]))
      current = null
      continue
    }
    const item = raw.trim().match(/^(\d+)\.\s+(.+)$/)
    if (item) {
      flush()
      current = { order: item[1], name: item[2] }
      continue
    }
    if (!current) continue
    const url = raw.match(/链接\s*[：:]\s*(https?:\/\/\S+)/)
    if (url) current.url = url[1].replace(/[)）、，。]+$/u, '')
  }
  flush()
  return channels
}

export function parseChannels(markdown) {
  const numbered = parseNumberedChannels(markdown)
  if (numbered.length >= 4) return numbered

  const fromJson = (() => {
    const matched = markdown.match(/```json\s*([\s\S]*?)```/)
    if (!matched) return []
    try {
      const data = JSON.parse(matched[1])
      const list = Array.isArray(data) ? data : data.channels
      if (!Array.isArray(list)) return []
      return list.map((item) => {
        const orgKey = item.orgKey || orgKeyFromName(item.org || item.orgName || '')
        if (!orgKey || !item.name || !item.url) return null
        return channelFrom(orgKey, item.name, item.url, item.order)
      }).filter(Boolean)
    } catch { return [] }
  })()
  if (fromJson.length >= 4) return fromJson

  const channels = []
  let orgKey = null
  let current = null
  const flush = () => {
    if (current?.name && current.url && orgKey) channels.push(channelFrom(orgKey, current.name, current.url, current.order))
    current = null
  }
  for (const raw of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const orgHeading = raw.match(/^##\s+(.+?)\s*$/)
    if (orgHeading) {
      flush()
      orgKey = orgKeyFromName(stripMarks(orgHeading[1]))
      continue
    }
    const line = stripMarks(raw)
    const name = line.match(/^(?:[-*]\s*)?名称\s*[：:]\s*(.+)$/)
    if (name) {
      flush()
      current = { name: name[1].trim() }
      continue
    }
    if (!current) continue
    const url = line.match(/链接\s*[：:]\s*(https?:\/\/\S+)/)
    const order = line.match(/排序\s*[：:]\s*(\d+)/)
    if (url) current.url = url[1].replace(/[)）、，。]+$/u, '')
    if (order) current.order = order[1]
  }
  flush()
  if (channels.length >= 4) return channels

  const tableOnes = []
  let headers = null
  for (const line of markdown.split('\n')) {
    if (!line.trim().startsWith('|')) { headers = null; continue }
    const cells = splitTableRow(line)
    if (!headers) { headers = cells; continue }
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue
    const row = {}
    headers.forEach((header, index) => { row[header] = cells[index] ?? '' })
    const key = orgKeyFromName(row['机构'] || '')
    const name = row['名称'] || row['渠道']
    const url = (row['链接'] || row['网址'] || '').match(/https?:\/\/\S+/)?.[0]
    if (key && name && url) tableOnes.push(channelFrom(key, name, url, row['排序']))
  }
  return tableOnes.length > channels.length ? tableOnes : channels
}

export function hostsOf(channels, orgKey) {
  const hosts = []
  for (const channel of channels) {
    if (channel.orgKey !== orgKey) continue
    try { hosts.push(new URL(channel.url).hostname) } catch { /* 坏链接留给发布时报出来 */ }
  }
  return [...new Set(hosts)]
}
