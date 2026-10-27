/**
 * 面试各页展示层。共享错误文案里的现场求助句只在这里换成服务电话。
 * 判定用无人值守词表。读不到号码就去掉那半句，不改成隐私政策兜底。
 */
import { containsStaffHandoff, UNATTENDED_FORBIDDEN_PHRASES } from '../../copy/unattendedCopy'

export type InterviewContact = {
  servicePhone: string | null
  serviceHours: string | null
}

const LEAD = /(?:[，,；;。！？]?\s*(?:在一体机上请|一体机上请|请|或|并))$/u
const TAIL = /^(?:后再试|核实该笔订单|协助)。?/u

function stripStaffClause(text: string): string {
  let out = text
  const phrases = [...UNATTENDED_FORBIDDEN_PHRASES].sort((a, b) => b.length - a.length)
  for (let guard = 0; guard < 8 && containsStaffHandoff(out); guard += 1) {
    let hit = -1
    let phrase = ''
    for (const item of phrases) {
      const at = out.indexOf(item)
      if (at >= 0 && (hit < 0 || at < hit)) {
        hit = at
        phrase = item
      }
    }
    if (hit < 0) break
    let start = hit
    const lead = LEAD.exec(out.slice(0, hit))
    if (lead) start = hit - lead[0].length
    let end = hit + phrase.length
    const tail = TAIL.exec(out.slice(end))
    if (tail) end += tail[0].length
    else if (out[end] === '。' || out[end] === '！' || out[end] === '？') end += 1
    out = `${out.slice(0, start)}${out.slice(end)}`
  }
  return out
    .replace(/[，,；;]{2,}/gu, '，')
    .replace(/\s+/gu, ' ')
    .replace(/^[，,；;\s]+/u, '')
    .replace(/[，,；;\s]+$/u, '')
    .replace(/。{2,}/gu, '。')
    .trim()
}

function phoneSentence(contact: InterviewContact): string | null {
  const phone = contact.servicePhone?.trim()
  if (!phone) return null
  const hours = contact.serviceHours?.trim()
  return hours
    ? `需要帮助？拨打服务电话 ${phone}（${hours}）`
    : `需要帮助？拨打服务电话 ${phone}`
}

/** 展示前过一遍。没有求助句时原样返回。 */
export function interviewUserLine(
  text: string | null | undefined,
  contact: InterviewContact,
): string | null {
  if (text == null || text === '') return text ?? null
  if (!containsStaffHandoff(text)) return text
  const stem = stripStaffClause(text).replace(/[。！？]+$/u, '')
  const help = phoneSentence(contact)
  if (!stem) return help ?? ''
  if (!help) return stem
  return `${stem}。${help}`
}

/** 作答页麦克风句的旧入口，转到同一套替换。 */
export function interviewMicLine(
  text: string | null | undefined,
  contact: InterviewContact,
): string | null {
  return interviewUserLine(text, contact)
}
