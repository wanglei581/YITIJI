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

/** 入口没确认可用就不给点。可用时不盖读屏名；不可用时读「标题，原因。说明」。 */
export function RecruitDoors({
  doors,
  availability,
  layout = 'fill',
}: {
  doors: readonly RecruitDoor[]
  availability: HubAvailability
  layout?: 'fill' | 'more'
}) {
  const navigate = useNavigate()
  return (
    <div className={layout === 'more' ? 'rt-more' : 'rt-doors'}>
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
            label={reason ? `${door.title}，${reason}。${door.desc}` : undefined}
          />
        )
        return (
          <div
            className={door.span ? 'rt-span' : undefined}
            key={door.route}
            data-door-title={door.title}
            data-disabled-reason={reason ? `capability:${door.kind}` : undefined}
          >
            {tile}
          </div>
        )
      })}
    </div>
  )
}
