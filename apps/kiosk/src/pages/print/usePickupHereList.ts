import { useCallback, useEffect, useState } from 'react'
import { listPickupHereOrders } from '../../services/api/pickupHereOrdersApi'
import { pickupHereRows, type PickupHereRow } from './pickupHereOrders'

export type PickupHereListStatus = 'off' | 'loading' | 'error' | 'ready'

/**
 * 登录后读本人在这台机器上还没取的单。没登录不发请求。
 * reload 重新读；removeRow 只从屏上拿掉一行，不再请求。
 */
export function usePickupHereList(token: string | null): {
  status: PickupHereListStatus
  rows: PickupHereRow[]
  reload: () => void
  removeRow: (orderId: string) => void
} {
  const [status, setStatus] = useState<PickupHereListStatus>(token ? 'loading' : 'off')
  const [rows, setRows] = useState<PickupHereRow[]>([])
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!token) {
      setStatus('off')
      setRows([])
      return
    }
    let cancelled = false
    setStatus('loading')
    void listPickupHereOrders(token).then(
      (items) => {
        if (cancelled) return
        setRows(pickupHereRows(items))
        setStatus('ready')
      },
      () => {
        if (cancelled) return
        setRows([])
        setStatus('error')
      },
    )
    return () => { cancelled = true }
  }, [token, reloadKey])

  const reload = useCallback(() => {
    setStatus((current) => (current === 'off' ? current : 'loading'))
    setReloadKey((key) => key + 1)
  }, [])

  const removeRow = useCallback((orderId: string) => {
    setRows((current) => current.filter((row) => row.orderId !== orderId))
  }, [])

  return { status, rows, reload, removeRow }
}
