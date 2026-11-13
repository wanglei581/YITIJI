import type { PickupHereRow } from '../pickupHereOrders'
import type { PickupHereListStatus } from '../usePickupHereList'

/** 登录后：本人在这台机器上还没取的手机单，点一下领取。没有单、还在读，都不占地方。 */
export function PickupHereList({
  status,
  rows,
  busy,
  onClaim,
  onReload,
}: {
  status: PickupHereListStatus
  rows: readonly PickupHereRow[]
  busy: boolean
  onClaim: (orderId: string) => void
  onReload: () => void
}) {
  if (status === 'off' || status === 'loading') return null
  if (status === 'error') {
    return (
      <div className="pcp-here-error" role="status" data-testid="pickup-here-error">
        <p className="pcp-here-note">暂时列不出你的单，可以在上面输到机码。</p>
        <button type="button" className="qx-btn pcp-here-reload" data-testid="pickup-here-reload" onClick={onReload}>
          重新读取
        </button>
      </div>
    )
  }
  if (rows.length === 0) return null
  return (
    <section className="qx-card pcp-here" data-testid="pickup-here-list" aria-label="这台机器上还没取的单">
      <p className="pch-title">你在这台机器上还没取的单</p>
      <ul>
        {rows.map((row) => (
          <li key={row.orderId}>
            <button
              type="button"
              className="qx-btn pcp-here-go"
              disabled={busy}
              data-testid="pickup-here-claim"
              onClick={() => onClaim(row.orderId)}
            >
              <span className="pcp-here-name">
                {row.label}
                {row.detail ? <span className="pcp-here-meta">{row.detail}</span> : null}
              </span>
              <span className="pcp-here-act">在本机领取</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
