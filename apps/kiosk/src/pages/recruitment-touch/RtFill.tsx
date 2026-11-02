import { useNavigate } from 'react-router-dom'
import { QxTouchTile } from '../../components/qingxu/touch/QxTouchTile'
import type { QxTouchIconName } from '../../components/qingxu/touch/QxTouchIcon'

type Preset = 'campus' | 'jobs' | 'fairs' | 'fair' | 'directory'

type Item = {
  icon: QxTouchIconName
  title: string
  desc: string
  to: string
  tone?: 'teal' | 'slate'
}

const ITEMS: Record<Preset, readonly Item[]> = {
  campus: [
    { icon: 'clipboard', title: '校招岗位', desc: '看分类为校招的来源岗位', to: '/jobs?category=campus' },
    { icon: 'layers', title: '校园招聘会', desc: '场次名单里只留校园相关', to: '/job-fairs?audience=campus', tone: 'slate' },
  ],
  jobs: [
    { icon: 'layout', title: '找企业', desc: '来源企业与岗位导览', to: '/companies' },
    { icon: 'layers', title: '招聘会', desc: '先看场次，再决定要不要去', to: '/job-fairs', tone: 'slate' },
  ],
  fairs: [
    { icon: 'book', title: '校园招聘', desc: '从已发布的校园场次里挑一场', to: '/campus' },
    { icon: 'clipboard', title: '岗位信息', desc: '已审核发布的来源岗位', to: '/jobs', tone: 'slate' },
  ],
  fair: [
    { icon: 'layers', title: '招聘会列表', desc: '回到全部场次', to: '/job-fairs' },
    { icon: 'clipboard', title: '岗位信息', desc: '岗位和场次不是同一份名单', to: '/jobs', tone: 'slate' },
  ],
  directory: [
    { icon: 'clipboard', title: '岗位信息', desc: '已审核发布的来源岗位', to: '/jobs' },
    { icon: 'layers', title: '招聘会', desc: '先看场次，再决定要不要去', to: '/job-fairs', tone: 'slate' },
  ],
}

/** 短页剩余高度放两张真实去向。不给格子涂底，缝里仍是纸色。 */
export function RtFill({ preset }: { preset: Preset }) {
  const navigate = useNavigate()
  return (
    <div className="rt-fill">
      {ITEMS[preset].map((item, index) => (
        <QxTouchTile
          key={item.to + item.title}
          icon={item.icon}
          title={item.title}
          desc={item.desc}
          tone={item.tone ?? 'teal'}
          index={index}
          onClick={() => navigate(item.to)}
        />
      ))}
    </div>
  )
}
