import { useEffect, useState } from 'react'
import { listPickupHereOrders } from '../../services/api/pickupHereOrdersApi'
import { pickupHereRows, type PickupHereRow } from './pickupHereOrders'

export type PickupHereListStatus = 'off' | 'loading' | 'error' | 'ready'

/** 登录后读一次本人在这台机器上还没取的单。没登录不发请求。 */
export function usePickupHereList(token: string | null): { status: PickupHereListStatus; rows: PickupHereRow[] } {
  const [status, setStatus] = useState<PickupHereListStatus>(token ? 'loading' : 'off')
  const [rows, setRows] = useState<PickupHereRow[]>([])

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
  }, [token])

  return { status, rows }
}
