import { useNavigate } from 'react-router-dom'
import { QxTouchCallout } from '../../components/qingxu/touch/QxTouchCallout'
import { RecruitDoors, type RecruitDoor } from './RecruitDoors'
import { RtFrame } from './RtFrame'
import { useRecruitmentAvailability } from './useRecruitmentAvailability'

const DOORS: readonly RecruitDoor[] = [
  { icon: 'clipboard', title: '找全职', desc: '看已审核发布的全职来源岗位', route: '/jobs?category=fulltime', kind: 'info' },
  { icon: 'clock', title: '找兼职', desc: '看灵活就业与兼职来源信息', route: '/jobs?category=parttime', kind: 'info', tone: 'slate' },
  { icon: 'ticket', title: '社会招聘会', desc: '看综合和行业场次，预约在来源平台', route: '/job-fairs?audience=social', kind: 'info', span: true },
  { icon: 'idcard', title: '找企业', desc: '先看来源企业，再看它的岗位', route: '/companies', kind: 'info' },
  { icon: 'map', title: '线下招聘机构', desc: '查看机构地址与到店咨询指引', route: '/offline-agencies', kind: 'info', tone: 'slate' },
  { icon: 'target', title: '岗位匹配参考', desc: '用本人简历对照当前岗位，仅供参考', route: '/resume/job-fit', kind: 'ai' },
  { icon: 'sparkle', title: '问 AI', desc: '问问怎么看这些来源，AI 不可用时仍可自己浏览', route: '/assistant', kind: 'ai', tone: 'clay' },
]

const MORE: readonly RecruitDoor[] = [
  { icon: 'layers', title: '全部岗位', desc: '不限全职或兼职', route: '/jobs', kind: 'info' },
  { icon: 'book', title: '官方与合作平台目录', desc: '扫码前往机构渠道，本机不代投', route: '/official-channels', kind: 'info', tone: 'slate' },
  { icon: 'eye', title: '浏览记录', desc: '看过的岗位留在这里', route: '/me/activity', kind: 'account' },
  { icon: 'compass', title: '外部跳转', desc: '打开过来源入口的记录', route: '/me/activity?tab=jump', kind: 'account', tone: 'slate' },
]

export function SocialHubPage() {
  const navigate = useNavigate()
  const { availability, apiStatus, retryApi } = useRecruitmentAvailability(false)
  const status = apiStatus === 'checking'
    ? { text: '正在确认在线服务' }
    : apiStatus === 'unavailable'
      ? { text: '在线服务当前不可用', tone: 'warn' as const }
      : { text: '社会招聘 · 来源信息入口' }

  return (
    <RtFrame
      eyebrow="私有化版 · 社会招聘"
      title="想找哪种工作？"
      sub="全职和兼职从这里进。"
      status={status}
      backLabel="返回"
      onBack={() => navigate('/')}
      ask={{ label: '问小青：社会招聘怎么选？', draft: '社会招聘怎么选？' }}
      primary={apiStatus === 'unavailable' ? { label: '重新确认在线服务', onClick: retryApi, noArrow: true } : undefined}
      testId="social-hub"
      stateId={apiStatus}
    >
      <RecruitDoors doors={DOORS} availability={availability} />
      <p className="rt-hint">
        实习、校招在
        <button type="button" onClick={() => navigate('/fairs-service')}>校园招聘</button>
        。
      </p>
      <QxTouchCallout kind="fine">不代收简历。岗位来自第三方或官方来源，投递在来源平台完成。</QxTouchCallout>
      <p className="rt-note">更多去处</p>
      <RecruitDoors doors={MORE} availability={availability} />
    </RtFrame>
  )
}
