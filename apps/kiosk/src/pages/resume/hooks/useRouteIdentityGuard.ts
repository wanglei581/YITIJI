// 宿主 46 决策工作台两条兄弟路由（/resume/job-fit/actions、/resume/career-plan）共用的身份闸。
// 独立成模块由两页各自引用，页面之间不互相 import。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { AuthContextValue } from '../../../auth/context'
import { onMemberSessionExpired } from '../../../services/auth/memberSessionEvents'
import { readAiResumeSession } from '../aiResumeSession'

/** 生成 / 打印各自独占：同类已有一趟在路上，第二趟直接不发。读取不设独占（effect 的 cancelled 作废旧的那趟）。 */
type RouteLane = 'generate' | 'print'
interface RouteRun { readonly epoch: number; readonly lane: RouteLane | null }

function aiResumeSessionKey(): string | null {
  const session = readAiResumeSession()
  return session ? `${session.taskId}\n${session.accessToken ?? ''}` : null
}

/**
 * 把当前这条历史记录里上一位的任务凭据洗掉：state（React Router 的 usr）里的 taskId / accessToken
 * 与地址里的 taskId。直接改 window.history，保留 key / idx 与其它字段；只在地址仍是本路由时动手。
 * 401 之后回登录页是整页跳转，再按浏览器返回，这条记录会重新挂载成下一位 —— 不能让它捡回这些。
 */
function scrubRouteHistoryEntry(routePath: string): void {
  if (typeof window === 'undefined' || window.location.pathname !== routePath) return
  const entry = window.history.state as { usr?: unknown } | null
  const url = new URL(window.location.href)
  const usr = entry?.usr && typeof entry.usr === 'object' ? { ...(entry.usr as Record<string, unknown>) } : null
  const stateHasTask = usr !== null && ('taskId' in usr || 'accessToken' in usr)
  if (!stateHasTask && !url.searchParams.has('taskId')) return
  url.searchParams.delete('taskId')
  if (usr) {
    delete usr.taskId
    delete usr.accessToken
  }
  const nextUsr = usr && Object.keys(usr).length > 0 ? usr : stateHasTask ? null : entry?.usr
  window.history.replaceState({ ...entry, usr: nextUsr }, '', `${url.pathname}${url.search}${url.hash}`)
}

/**
 * 决策工作台路由的身份闸（/resume/job-fit/actions 与 /resume/career-plan 共用，判据只留这一份）。
 *
 * 挂载那一刻绑定：会员 id + 令牌原文（游客为 guest），以及本机 AI 简历会话（taskId + 匿名
 * accessToken，登出 / 清场会同步抹掉）。路由还挂着时任一项变了 —— 登出、401 过期而回登录页
 * 还在等扫描收尾、换人、清场 —— 这次会话就**永久结束**：
 *  - 同一次渲染 `ended` 已为真，页面只画会话结束屏，不读挂载时存下的任何结果；
 *  - 在路上的读取 / 生成 / 打印回来时 `isLive` 为假：不写结果、不导航；
 *  - `begin` 不再放行任何请求，挂载时的 taskId / 匿名 accessToken 落不到下一位身上。
 * `isLive` / `begin` 同步读令牌与会话，登出已发生、还没重渲染的那一拍也拦得住；结束与卸载都让代次 +1。
 * 生成 / 打印同类独占，所以调用方 finally 里放下的只可能是它自己那一趟的忙态，碰不到更新的一趟。
 * 另外两处调同一个 `scrubRouteHistoryEntry`：会员会话失效事件的同步派发里（没有待撤扫描时 AuthProvider
 * 在同一调用栈里就整页跳走，React 来不及再渲染），以及会话结束后的 effect（其余身份变化与扫描收尾按住的路径）。
 */
export function useRouteIdentityGuard({ user, getToken }: Pick<AuthContextValue, 'user' | 'getToken'>) {
  const { pathname } = useLocation()
  const token = user ? getToken() : null
  const identity = user ? `member\n${user.id}\n${token ?? ''}` : 'guest'
  const session = aiResumeSessionKey()
  const [bound] = useState(() => ({ identity, token, session, path: pathname }))
  const [latched, setLatched] = useState(false)
  const endedRef = useRef(false)
  const epochRef = useRef(0)
  const lanesRef = useRef(new Set<RouteLane>())
  const ended = latched || identity !== bound.identity || session !== bound.session

  const end = useCallback(() => {
    if (endedRef.current) return
    endedRef.current = true
    epochRef.current += 1
    setLatched(true)
  }, [])
  useLayoutEffect(() => { if (ended) end() }, [ended, end])
  useEffect(() => () => { epochRef.current += 1 }, [])
  // 与 AuthProvider 同一判据（只认本页绑定的那张会员令牌失效）。事件派发是同步的：无论本监听排在
  // AuthProvider 之前还是之后，都落在整页跳转真正卸载本页之前。路由不变，会话结束屏与扫描收尾照旧。
  useEffect(() => onMemberSessionExpired((failedToken) => {
    if (bound.token === null || (failedToken && failedToken !== bound.token)) return
    scrubRouteHistoryEntry(bound.path)
  }), [bound])
  useEffect(() => { if (ended) scrubRouteHistoryEntry(bound.path) }, [ended, bound])

  const stillBound = useCallback((): boolean => {
    if (endedRef.current) return false
    if (getToken() === bound.token && aiResumeSessionKey() === bound.session) return true
    end()
    return false
  }, [bound, getToken, end])
  const begin = useCallback((lane: RouteLane | null = null): RouteRun | null => {
    if (!stillBound() || (lane && lanesRef.current.has(lane))) return null
    if (lane) lanesRef.current.add(lane)
    return { epoch: epochRef.current, lane }
  }, [stillBound])
  const settle = useCallback((run: RouteRun) => { if (run.lane) lanesRef.current.delete(run.lane) }, [])
  const isLive = useCallback((run: RouteRun): boolean => run.epoch === epochRef.current && stillBound(), [stillBound])

  return { ended, begin, settle, isLive }
}
