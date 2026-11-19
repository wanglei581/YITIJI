import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchIcon } from '../../../../components/qingxu/touch/QxTouchIcon'
import { listPickupHereOrders } from '../../../../services/api/pickupHereOrdersApi'
import { pendingPickupRows, type PendingPickupRow } from '../../../print/pickupHereOrders'
import { MeBtn } from '../../touch/MeKit'
import { pendingPickupErrorLines, pendingPickupFileMark } from './pendingPickupExits'

export type PendingPickupPresence = 'off' | 'loading' | 'hidden' | 'rows' | 'error'

/** 登录后读本人手机上下、还没取的单。没登录不发请求。复用取件页的时间线，不另造接口。 */
export function usePendingPickupOrders(token: string | null): {
  presence: PendingPickupPresence
  rows: PendingPickupRow[]
  /** 失败块上的「重新读取」进行中。这一下不把整页换成读取中。 */
  reloading: boolean
  reload: () => void
} {
  const [presence, setPresence] = useState<PendingPickupPresence>(token ? 'loading' : 'off')
  const [rows, setRows] = useState<PendingPickupRow[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const [reloading, setReloading] = useState(false)
  const presenceRef = useRef(presence)
  presenceRef.current = presence

  useEffect(() => {
    if (!token) {
      setPresence('off')
      setRows([])
      setReloading(false)
      return
    }
    let cancelled = false
    // 第一次读用整页等待。已经失败后再读，留在这一块，按钮改成「正在重新读取…」。
    const keepError = reloadKey > 0 && presenceRef.current === 'error'
    if (keepError) setReloading(true)
    else {
      setReloading(false)
      setPresence('loading')
    }
    const load = async () => {
      // 终端身份晚一点才到。那不是「手机单读失败」，先等一会儿再读，避免空订单页误报没读到。
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (cancelled) return
        try {
          const items = await listPickupHereOrders(token)
          if (cancelled) return
          const next = pendingPickupRows(items)
          setRows(next)
          setReloading(false)
          setPresence(next.length > 0 ? 'rows' : 'hidden')
          return
        } catch (err) {
          const waiting = err instanceof Error && err.message === '终端身份尚未就绪'
          if (!waiting || attempt === 7) {
            if (cancelled) return
            setRows([])
            setReloading(false)
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
  return { presence, rows, reloading, reload }
}

/** 没有待取单时不占地方。读失败只说这一块，不把已有打印任务一起藏起来。 */
export function PendingPickupSection({
  presence,
  rows,
  hasTasks,
  reloading = false,
  onReload,
}: {
  presence: PendingPickupPresence
  rows: readonly PendingPickupRow[]
  /** 下面已经有归入账号的打印任务。没有时，失败句不提「下面…不受影响」。 */
  hasTasks: boolean
  reloading?: boolean
  onReload: () => void
}) {
  const navigate = useNavigate()
  if (presence === 'error') {
    const lines = pendingPickupErrorLines(hasTasks)
    return (
      <div className="me-pk-err" data-testid="pending-pickup-error" role="status">
        <QxTouchIcon name="alert" size={34} strokeWidth={2.2} />
        <p>
          {lines.map((line) => <span key={line}>{line}</span>)}
        </p>
        <MeBtn v="sec" className="me-pk-retry" disabled={reloading} onClick={onReload}>
          {reloading ? '正在重新读取…' : '重新读取'}
        </MeBtn>
      </div>
    )
  }
  if (presence !== 'rows' || rows.length === 0) return null
  return (
    <section className="me-stack me-pin" data-testid="pending-pickup-list" aria-label="手机上还没取的单">
      {rows.map((row) => {
        const mark = pendingPickupFileMark(row.label)
        return (
          <div className="me-pk-row" key={row.orderId} data-testid="pending-pickup-row" role="listitem">
            <span className={mark.pkg ? 'me-pk-ft me-pk-pkg' : 'me-pk-ft'}>
              {mark.pkg ? <QxTouchIcon name="layers" size={38} /> : mark.text}
            </span>
            <div className="me-pk-tx">
              <b>{row.label}</b>
              {row.detail ? <small>{row.detail}</small> : null}
              {row.claimableHere ? null : (
                <div className="me-pk-where">
                  <QxTouchIcon name="map" size={30} />
                  <div>
                    <b>去哪台取</b>
                    <span data-testid="pending-pickup-elsewhere">{row.elsewhere}</span>
                  </div>
                </div>
              )}
            </div>
            {row.claimableHere ? (
              <MeBtn v="pri" className="me-pk-go" onClick={() => navigate('/print/pickup-claim')} aria-label={`到这台取件 ${row.label}`}>
                到这台取件
              </MeBtn>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}
