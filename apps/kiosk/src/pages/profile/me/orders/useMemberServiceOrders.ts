// ============================================================
// 会员侧 AI/扫描服务单与本机收费态读取钩子。
//
// 隐私红线：
// - 未登录（!isLoggedIn）时零请求（不读 /me/service-orders，也不读终端配置），
//   保证未登录访问 /me/print-orders 严格维持 0 条额外 /api/v1/ 请求。
// - 退出登录时立即清空内存中的服务单列表与游标。
// - 读取服务单失败不阻断打印订单页展示（温和降级为空列表）。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
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
  hasAnyPositivePrice: boolean
  loadMoreServices: () => void
}

export function useMemberServiceOrders(
  isLoggedIn: boolean,
  getToken: () => string | null,
  reloadKey: number,
): MemberServiceOrdersState {
  const [serviceOrders, setServiceOrders] = useState<MemberServiceOrderItem[]>([])
  const [serviceTotal, setServiceTotal] = useState(0)
  const [serviceNextCursor, setServiceNextCursor] = useState<string | null>(null)
  const [serviceLoading, setServiceLoading] = useState(false)
  const [loadingMoreServices, setLoadingMoreServices] = useState(false)
  const [hasAnyPositivePrice, setHasAnyPositivePrice] = useState(false)

  useEffect(() => {
    if (!isLoggedIn) {
      setServiceOrders([])
      setServiceTotal(0)
      setServiceNextCursor(null)
      setServiceLoading(false)
      setHasAnyPositivePrice(false)
      return undefined
    }
    let alive = true
    setServiceLoading(true)
    const token = getToken()
    const serviceReq = getMyServiceOrders(token, { pageSize: SERVICE_PAGE_SIZE })
      .then((page) => {
        if (!alive) return
        setServiceOrders(page.items)
        setServiceTotal(page.total)
        setServiceNextCursor(page.nextCursor)
      })
      .catch(() => {
        if (!alive) return
        setServiceOrders([])
        setServiceTotal(0)
        setServiceNextCursor(null)
      })
      .finally(() => {
        if (alive) setServiceLoading(false)
      })

    const terminalId = getTerminalId()
    if (terminalId) {
      void getCachedKioskTerminalConfig(terminalId)
        .then((config) => {
          if (alive) setHasAnyPositivePrice(isTerminalConfigCharged(config))
        })
        .catch(() => {
          if (alive) setHasAnyPositivePrice(false)
        })
    } else {
      setHasAnyPositivePrice(false)
    }

    void serviceReq
    return () => {
      alive = false
    }
  }, [isLoggedIn, getToken, reloadKey])

  const loadMoreServices = useCallback(() => {
    if (!isLoggedIn || !serviceNextCursor || loadingMoreServices) return
    setLoadingMoreServices(true)
    getMyServiceOrders(getToken(), { cursor: serviceNextCursor, pageSize: SERVICE_PAGE_SIZE })
      .then((page) => {
        setServiceOrders((prev) => {
          const seen = new Set(prev.map((item) => item.id))
          return [...prev, ...page.items.filter((item) => !seen.has(item.id))]
        })
        setServiceTotal(page.total)
        setServiceNextCursor(page.nextCursor)
      })
      .catch(() => {
        /* 保持已加载列表不变，用户可再次尝试 */
      })
      .finally(() => setLoadingMoreServices(false))
  }, [isLoggedIn, serviceNextCursor, loadingMoreServices, getToken])

  return {
    serviceOrders,
    serviceTotal,
    serviceNextCursor,
    serviceLoading,
    loadingMoreServices,
    hasAnyPositivePrice,
    loadMoreServices,
  }
}
