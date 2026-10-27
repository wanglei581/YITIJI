import { useNavigate } from 'react-router-dom'
import { RecruitDoors, type RecruitDoor } from './RecruitDoors'
import { RtFrame } from './RtFrame'
import { useRecruitmentAvailability } from './useRecruitmentAvailability'

const DOORS: readonly RecruitDoor[] = [
  { icon: 'clipboard', title: '找全职', desc: '按城市、行业筛选已经发布的全职岗位', route: '/jobs?category=fulltime', kind: 'info' },
  { icon: 'clock', title: '找兼职', desc: '看灵活就业的来源信息，办理在来源平台完成', route: '/jobs?category=parttime', kind: 'info', tone: 'slate' },
  { icon: 'ticket', title: '社会招聘会', desc: '通用场次和行业场次，预约在来源平台办理', route: '/job-fairs?audience=social', kind: 'info', span: true },
  { icon: 'idcard', title: '找企业', desc: '先看企业资料和在招岗位，再决定要不要去看来源', route: '/companies', kind: 'info' },
  { icon: 'map', title: '线下招聘机构', desc: '看地址、营业时间和到店咨询，本机不代你去', route: '/offline-agencies', kind: 'info', tone: 'clay' },
  { icon: 'target', title: '岗位匹配参考', desc: '用简历和目标岗位逐项对照，只给你自己看', route: '/resume/job-fit', kind: 'ai' },
  { icon: 'sparkle', title: '问 AI 顾问', desc: '问岗位怎么看、材料怎么准备', route: '/assistant', kind: 'ai', tone: 'slate' },
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
      ask={{ label: '问小青：社会招聘怎么选？', draft: '社会招聘怎么选？', voice: true }}
      primary={apiStatus === 'ready' ? undefined : { label: '重新检测', onClick: retryApi, noArrow: true }}
      testId="social-hub"
      stateId={apiStatus}
    >
      <div className="rt-hub" data-hub-device-probe="off">
        <RecruitDoors doors={DOORS} availability={availability} />
        <p className="rt-hint">
          实习、校招岗位在『
          <button type="button" onClick={() => navigate('/fairs-service')}>校园招聘</button>
          』里。
        </p>
        <div className="rt-declarations">
          <p>投递在来源平台完成。</p>
          <p>本机记录你的浏览与外部跳转；投递进度由你自己填写，本机不掌握来源平台的处理结果。</p>
          <p>本机不代收简历</p>
          <p>不做企业筛选、面试邀约或Offer管理。</p>
        </div>
        <p className="rt-note">更多去处</p>
        <RecruitDoors doors={MORE} availability={availability} layout="more" />
      </div>
    </RtFrame>
  )
}
