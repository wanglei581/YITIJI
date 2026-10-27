import { useNavigate } from 'react-router-dom'
import { QxTouchTile } from '../../components/qingxu/touch/QxTouchTile'
import type { QxTouchIconName } from '../../components/qingxu/touch/QxTouchIcon'
import type { CapabilityKind, HubAvailability } from '../service-hubs/serviceHubModel'
import { doorReason } from './useRecruitmentAvailability'

export type RecruitDoor = {
  icon: QxTouchIconName
  title: string
  desc: string
  route: string
  kind: CapabilityKind
  tone?: 'teal' | 'slate' | 'clay'
  span?: boolean
}

/** 入口没确认可用就不给点。原因写在说明上，不把「还在检查」画成可以进入。 */
export function RecruitDoors({
  doors,
  availability,
}: {
  doors: readonly RecruitDoor[]
  availability: HubAvailability
}) {
  const navigate = useNavigate()
  return (
    <div className="rt-doors">
      {doors.map((door, index) => {
        const reason = doorReason(door.kind, door.route, availability)
        const tile = (
          <QxTouchTile
            icon={door.icon}
            title={door.title}
            desc={reason ? `${door.desc}。${reason}` : door.desc}
            tone={door.tone ?? 'teal'}
            off={Boolean(reason)}
            index={index}
            onClick={reason ? undefined : () => navigate(door.route)}
            label={reason ? `${door.title}：${reason}` : door.title}
          />
        )
        return door.span ? (
          <div className="rt-span" key={door.route}>{tile}</div>
        ) : (
          <div key={door.route}>{tile}</div>
        )
      })}
    </div>
  )
}
