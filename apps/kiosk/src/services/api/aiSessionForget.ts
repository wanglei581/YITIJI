// 清场时让服务器忘掉这一人次的小青对话和作业内存。
//
// 会话号只留在本模块的内存里：整页重载自然清空，不写 localStorage / sessionStorage。
// 发送用 keepalive 的裸 fetch，不等回执、不抛错。终端封装发出前会先等声明桥和在飞的续期，
// 可能晚于清场末尾的整页重载；这两个接口本身也不要求终端会话票。

import { parseId } from '../../pages/ai-plan/advisorArtifactModel'
import { API_BASE_URL, API_MODE } from './client'

/** 服务端铸的小青会话号：randomBytes(16) 的小写十六进制。客户端的 session-…、演示的 mock-… 不收。 */
const ASSISTANT_SESSION_ID_RE = /^[0-9a-f]{32}$/
const MAX_REMEMBERED = 10

export interface AdvisorSessionAccess {
  token?: string | null
  accessToken?: string | null
}

interface AdvisorMemory {
  id: string
  accessToken?: string
}

const assistantIds: string[] = []
const advisorSessions: AdvisorMemory[] = []

function rememberLimited<T>(list: T[], item: T, same: (entry: T) => boolean): void {
  const next = list.filter((entry) => !same(entry))
  next.push(item)
  list.splice(0, list.length, ...next.slice(-MAX_REMEMBERED))
}

export function rememberAssistantSession(id: string): void {
  if (typeof id !== 'string' || !ASSISTANT_SESSION_ID_RE.test(id)) return
  rememberLimited(assistantIds, id, (entry) => entry === id)
}

/** 作业号沿用作业面 parseId。匿名令牌有的话记下；没有则沿用这个号上一次记下的。 */
export function rememberAdvisorSession(id: string, access?: AdvisorSessionAccess): void {
  if (typeof id !== 'string') return
  const parsed = parseId(id)
  if (!parsed) return
  const fresh = typeof access?.accessToken === 'string' ? access.accessToken.trim() : ''
  const previous = advisorSessions.find((entry) => entry.id === parsed)
  const accessToken = fresh || previous?.accessToken
  rememberLimited(
    advisorSessions,
    accessToken ? { id: parsed, accessToken } : { id: parsed },
    (entry) => entry.id === parsed,
  )
}

function fireForget(path: string, headers: Record<string, string>, body?: string): void {
  try {
    void fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers,
      credentials: 'include',
      keepalive: true,
      ...(body !== undefined ? { body } : {}),
    }).catch(() => undefined)
  } catch {
    // 同步抛错也吞掉。清场不能停在这一步。
  }
}

/**
 * 先取走登记再清空：同一次清场里再进来就是空操作。
 * 只在 http 模式发。失败一律吞掉，不许抛到清场外面。
 */
export function forgetAiSessions(memberToken: string | null): void {
  try {
    const assistants = assistantIds.splice(0, assistantIds.length)
    const advisors = advisorSessions.splice(0, advisorSessions.length)
    if (API_MODE !== 'http') return
    const token = typeof memberToken === 'string' && memberToken.trim() ? memberToken.trim() : null

    if (assistants.length > 0) {
      const body = JSON.stringify({ sessionIds: assistants })
      const headers = { Accept: 'application/json', 'Content-Type': 'application/json' }
      // 登录前开的对话归来源地址。先按会员发，再匿名发一次；不是自己的，服务端回 0。
      if (token) {
        fireForget('/assistant/sessions/forget', { ...headers, Authorization: `Bearer ${token}` }, body)
      }
      fireForget('/assistant/sessions/forget', headers, body)
    }

    for (const advisor of advisors) {
      if (!token && !advisor.accessToken) continue
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`
      if (advisor.accessToken) headers['x-advisor-access-token'] = advisor.accessToken
      fireForget(`/advisor/sessions/${encodeURIComponent(advisor.id)}/forget`, headers)
    }
  } catch {
    assistantIds.splice(0, assistantIds.length)
    advisorSessions.splice(0, advisorSessions.length)
  }
}
