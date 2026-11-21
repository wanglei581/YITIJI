// ============================================================
// 会员侧 AI/扫描服务单与本机收费态读取钩子。
//
// 隐私与竞态红线：
// - 未登录（!isLoggedIn）时零请求（不读 /me/service-orders，也不读终端配置），
//   保证未登录访问 /me/print-orders 严格维持 0 条额外 /api/v1/ 请求。
// - 绑定明确会话身份（endUserId + token）与单调递增代次 genRef：
//   登出、换人（即使 getToken 引用稳定）或卸载时同步失效并清空列表/游标/分页态；
//   首页与 loadMoreServices 写 state 前一律核验 gen 与 activeSessionRef，杜绝跨人残单。
// - 读取服务单失败不阻断打印订单页展示（温和降级为空列表）。
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MemberServiceOrderItem } from '@ai-job-print/shared'
import { getMyServiceOrders } from '../../../../services/api/memberServiceOrders'
import { getCachedKioskTerminalConfig, getTerminalId } from '../../../../services/api/terminalConfig'
import { isTerminalConfigCharged } from './orderInvoiceCopy'

const SERVICE_PAGE_SIZE = 20

export interface MemberServiceOrdersState {
  serviceOrders: MemberServiceOrderItem[]
  serviceTotal: number
  serviceNextCursor: string | null
  serviceLoading: boolean
  loadingMoreServices: boolean
  serviceError: boolean
  hasAnyPositivePrice: boolean
  loadMoreServices: () => void
}

interface ScopedState {
  owner: string | null
  items: MemberServiceOrderItem[]
  total: number
  nextCursor: string | null
  loading: boolean
  loadingMore: boolean
  error: boolean
  hasAnyPositivePrice: boolean
}

const EMPTY_SCOPED_STATE: ScopedState = {
  owner: null,
  items: [],
  total: 0,
  nextCursor: null,
  loading: false,
  loadingMore: false,
  error: false,
  hasAnyPositivePrice: false,
}

function appendUniqueOrders(
  prev: readonly MemberServiceOrderItem[],
  incoming: readonly MemberServiceOrderItem[],
): MemberServiceOrderItem[] {
  const seen = new Set(prev.map((item) => item.id))
  return [...prev, ...incoming.filter((item) => !seen.has(item.id))]
}

export function useMemberServiceOrders(
  isLoggedIn: boolean,
  getToken: () => string | null,
  reloadKey: number,
  endUserId?: string | null,
): MemberServiceOrdersState {
  const currentToken = isLoggedIn ? getToken() : null
  const sessionKey = isLoggedIn ? `${endUserId ?? ''}|${currentToken ?? ''}` : null

  const genRef = useRef(0)
  const activeSessionRef = useRef<string | null>(sessionKey)
  if (activeSessionRef.current !== sessionKey) {
    activeSessionRef.current = sessionKey
    genRef.current += 1
  }

  const getTokenRef = useRef(getToken)
  getTokenRef.current = getToken

  const [scoped, setScoped] = useState<ScopedState>(EMPTY_SCOPED_STATE)
  const visible = sessionKey !== null && scoped.owner === sessionKey ? scoped : EMPTY_SCOPED_STATE

  useEffect(() => {
    genRef.current += 1
    const gen = genRef.current
    const expectedSession = sessionKey
    activeSessionRef.current = expectedSession

    if (!expectedSession) {
      setScoped(EMPTY_SCOPED_STATE)
      return () => {
        genRef.current += 1
      }
    }

    const isCurrent = () => genRef.current === gen && activeSessionRef.current === expectedSession

    setScoped({
      ...EMPTY_SCOPED_STATE,
      owner: expectedSession,
      loading: true,
    })

    const token = getTokenRef.current()
    void getMyServiceOrders(token, { pageSize: SERVICE_PAGE_SIZE })
      .then((page) => {
        if (!isCurrent()) return
        setScoped((prev) => (prev.owner === expectedSession
          ? { ...prev, items: page.items, total: page.total, nextCursor: page.nextCursor, error: false }
          : prev))
      })
      .catch(() => {
        if (!isCurrent()) return
        setScoped((prev) => (prev.owner === expectedSession
          ? { ...prev, items: [], total: 0, nextCursor: null, error: true }
          : prev))
      })
      .finally(() => {
        if (!isCurrent()) return
        setScoped((prev) => (prev.owner === expectedSession ? { ...prev, loading: false } : prev))
      })

    const terminalId = getTerminalId()
    if (terminalId) {
      void getCachedKioskTerminalConfig(terminalId)
        .then((config) => {
          if (!isCurrent()) return
          const charged = isTerminalConfigCharged(config)
          setScoped((prev) => (prev.owner === expectedSession ? { ...prev, hasAnyPositivePrice: charged } : prev))
        })
        .catch(() => {
          if (!isCurrent()) return
          setScoped((prev) => (prev.owner === expectedSession ? { ...prev, hasAnyPositivePrice: false } : prev))
        })
    }

    return () => {
      genRef.current += 1
    }
  }, [sessionKey, reloadKey])

  const loadMoreServices = useCallback(() => {
    if (!sessionKey || !visible.nextCursor || visible.loadingMore) return
    const gen = genRef.current
    const expectedSession = sessionKey
    const cursor = visible.nextCursor
    const isCurrent = () => genRef.current === gen && activeSessionRef.current === expectedSession

    setScoped((prev) => (prev.owner === expectedSession ? { ...prev, loadingMore: true, error: false } : prev))

    void getMyServiceOrders(getTokenRef.current(), { cursor, pageSize: SERVICE_PAGE_SIZE })
      .then((page) => {
        if (!isCurrent()) return
        setScoped((prev) => (prev.owner === expectedSession
          ? {
              ...prev,
              items: appendUniqueOrders(prev.items, page.items),
              total: page.total,
              nextCursor: page.nextCursor,
              error: false,
            }
          : prev))
      })
      .catch(() => {
        if (!isCurrent()) return
        setScoped((prev) => (prev.owner === expectedSession ? { ...prev, error: true } : prev))
      })
      .finally(() => {
        if (!isCurrent()) return
        setScoped((prev) => (prev.owner === expectedSession ? { ...prev, loadingMore: false } : prev))
      })
  }, [sessionKey, visible.nextCursor, visible.loadingMore])

  return {
    serviceOrders: visible.items,
    serviceTotal: visible.total,
    serviceNextCursor: visible.nextCursor,
    serviceLoading: visible.loading,
    loadingMoreServices: visible.loadingMore,
    serviceError: visible.error,
    hasAnyPositivePrice: visible.hasAnyPositivePrice,
    loadMoreServices,
  }
}
