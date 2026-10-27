import { useNavigate } from 'react-router-dom'
import { QxTouchCallout } from '../../components/qingxu/touch/QxTouchCallout'
import { RecruitDoors, type RecruitDoor } from './RecruitDoors'
import { RtFrame } from './RtFrame'
import { useRecruitmentAvailability } from './useRecruitmentAvailability'

const DOORS: readonly RecruitDoor[] = [
  { icon: 'ticket', title: '校园招聘会', desc: '挑一场本校或校招场次', route: '/campus', kind: 'info', span: true },
  { icon: 'clipboard', title: '校招岗位', desc: '看分类为校招的来源岗位', route: '/jobs?category=campus', kind: 'info' },
  { icon: 'clock', title: '实习岗位', desc: '看分类为实习的来源岗位', route: '/jobs?category=intern', kind: 'info', tone: 'slate' },
  { icon: 'layers', title: '校园招聘数据', desc: '只显示经核验的聚合统计', route: '/campus/freshman-insights', kind: 'info' },
  { icon: 'map', title: '全部校园招聘会', desc: '场次名单里只留校园相关', route: '/job-fairs?audience=campus', kind: 'info', tone: 'slate' },
  { icon: 'qr', title: '到场指引', desc: '核对来源预约，本机不做签到', route: '/job-fairs/checkin', kind: 'info' },
  { icon: 'file', title: '简历服务', desc: '诊断、优化或准备纸质材料', route: '/resume-service', kind: 'info', tone: 'slate' },
  { icon: 'printer', title: '打印扫描', desc: '先看文件和办理入口，出纸步骤进去再确认', route: '/print-scan', kind: 'device' },
  { icon: 'sparkle', title: '问 AI', desc: '问问参会准备。AI 不可用时仍可自己看场次', route: '/assistant', kind: 'ai', tone: 'clay' },
]

const MORE: readonly RecruitDoor[] = [
  { icon: 'ticket', title: '全部招聘会', desc: '社会和校园场次都在这一份名单', route: '/job-fairs', kind: 'info' },
  { icon: 'eye', title: '浏览记录', desc: '看过的招聘会留在这里', route: '/me/activity', kind: 'account' },
  { icon: 'compass', title: '外部跳转', desc: '打开过来源入口的记录', route: '/me/activity?tab=jump', kind: 'account', tone: 'slate' },
]

export function CampusServicePage() {
  const navigate = useNavigate()
  const { availability, apiStatus, retryApi } = useRecruitmentAvailability(true)
  const status = apiStatus === 'checking'
    ? { text: '正在确认在线服务' }
    : apiStatus === 'unavailable'
      ? { text: '在线服务当前不可用', tone: 'warn' as const }
      : availability.deviceChecking
        ? { text: '正在确认本机设备' }
        : availability.deviceOff
          ? { text: '本机设备当前不可用', tone: 'warn' as const }
          : { text: '校园招聘 · 来源信息入口' }

  return (
    <RtFrame
      eyebrow="私有化版 · 校园招聘"
      title="先看哪一场？"
      sub="实习和校招从这里进。"
      status={status}
      backLabel="返回"
      onBack={() => navigate('/')}
      ask={{ label: '问小青：校园招聘怎么看？', draft: '校园招聘怎么看？' }}
      primary={apiStatus === 'unavailable' ? { label: '重新确认在线服务', onClick: retryApi, noArrow: true } : undefined}
      testId="campus-service"
      stateId={apiStatus}
    >
      <RecruitDoors doors={DOORS} availability={availability} />
      <p className="rt-hint">
        全职和兼职在
        <button type="button" onClick={() => navigate('/jobs-service')}>社会招聘</button>
        。
      </p>
      <QxTouchCallout kind="fine">不代收简历，也不代预约。预约和到场登记由来源平台与主办方负责。</QxTouchCallout>
      <p className="rt-note">更多去处</p>
      <RecruitDoors doors={MORE} availability={availability} />
    </RtFrame>
  )
}
