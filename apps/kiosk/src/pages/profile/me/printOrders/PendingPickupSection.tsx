import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listPickupHereOrders } from '../../../../services/api/pickupHereOrdersApi'
import { pendingPickupRows, type PendingPickupRow } from '../../../print/pickupHereOrders'
import { MeBtn } from '../../touch/MeKit'

export type PendingPickupPresence = 'off' | 'loading' | 'hidden' | 'rows' | 'error'

/** 登录后读本人手机上下、还没取的单。没登录不发请求。复用取件页的时间线，不另造接口。 */
export function usePendingPickupOrders(token: string | null): {
  presence: PendingPickupPresence
  rows: PendingPickupRow[]
  reload: () => void
} {
  const [presence, setPresence] = useState<PendingPickupPresence>(token ? 'loading' : 'off')
  const [rows, setRows] = useState<PendingPickupRow[]>([])
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!token) {
      setPresence('off')
      setRows([])
      return
    }
    let cancelled = false
    setPresence('loading')
    const load = async () => {
      // 终端身份晚一点才到。那不是「手机单读失败」，先等一会儿再读，避免空订单页误报没读到。
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (cancelled) return
        try {
          const items = await listPickupHereOrders(token)
          if (cancelled) return
          const next = pendingPickupRows(items)
          setRows(next)
          setPresence(next.length > 0 ? 'rows' : 'hidden')
          return
        } catch (err) {
          const waiting = err instanceof Error && err.message === '终端身份尚未就绪'
          if (!waiting || attempt === 7) {
            if (cancelled) return
            setRows([])
            setPresence('error')
            return
          }
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      }
    }
    void load()
    return () => { cancelled = true }
  }, [token, reloadKey])

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])
  return { presence, rows, reload }
}

/** 横幅小字。有待取单时改口，避免仍说「不在下面的列表里」。读失败时不写这句，由下面那一块说真话。 */
export function pendingPickupBannerNote(presence: PendingPickupPresence): string | null {
  if (presence === 'rows') return '还没取的手机单列在这一条下面。'
  if (presence === 'error') return null
  return '还没核销出打印任务的单，不在下面的列表里'
}

/** 没有待取单时不占地方。读失败只说这一块，不把已有打印任务一起藏起来。 */
export function PendingPickupSection({
  presence,
  rows,
  onReload,
}: {
  presence: PendingPickupPresence
  rows: readonly PendingPickupRow[]
  onReload: () => void
}) {
  const navigate = useNavigate()
  if (presence === 'error') {
    return (
      <div className="me-stack me-pin" data-testid="pending-pickup-error" role="status">
        <p className="me-reason">手机上还没取的单这次没读到。下面已产生打印任务的订单不受影响。</p>
        <MeBtn v="sec" onClick={onReload}>重新读取</MeBtn>
      </div>
    )
  }
  if (presence !== 'rows' || rows.length === 0) return null
  return (
    <section className="me-stack me-pin" data-testid="pending-pickup-list" aria-label="手机上还没取的单">
      {rows.map((row) => (
        <div className="me-line" key={row.orderId} data-testid="pending-pickup-row">
          <b>{row.label}</b>
          {row.detail ? <small>{row.detail}</small> : null}
          {row.claimableHere ? (
            <MeBtn v="pri" onClick={() => navigate('/print/pickup-claim')} aria-label={`到这台取件 ${row.label}`}>
              到这台取件
            </MeBtn>
          ) : (
            <>
              <b>去哪台取</b>
              <small data-testid="pending-pickup-elsewhere">{row.elsewhere}</small>
            </>
          )}
        </div>
      ))}
    </section>
  )
}
