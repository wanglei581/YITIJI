import type { PickupHereRow } from '../pickupHereOrders'
import type { PickupHereListStatus } from '../usePickupHereList'

/** 登录后、输码格上面：本人在这台机器上还没取的手机单，点一下领取。没有单就不占地方。 */
export function PickupHereList({
  status,
  rows,
  busy,
  onClaim,
}: {
  status: PickupHereListStatus
  rows: readonly PickupHereRow[]
  busy: boolean
  onClaim: (orderId: string) => void
}) {
  if (status === 'off') return null
  if (status === 'loading') {
    return <p className="pcp-here-note" data-testid="pickup-here-loading">正在读取你在这台机器上还没取的单。</p>
  }
  if (status === 'error') {
    return (
      <p className="pcp-here-note" role="status" data-testid="pickup-here-error">
        暂时列不出你的单，可以在下面输到机码。
      </p>
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
              <span className="pcp-here-name">{row.label}</span>
              <span className="pcp-here-act">在本机领取</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
