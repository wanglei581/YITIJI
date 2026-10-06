import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellIcon, FileTextIcon, GiftIcon, HelpCircleIcon, InboxIcon, LockIcon, MessageSquareIcon, PrinterIcon, ShieldIcon, StarIcon, TriangleAlertIcon } from 'lucide-react'
import { useOfficialChannels } from '../../../hooks/useOfficialChannels'
import { useRecruitmentHosting } from '../../../hooks/useRecruitmentHosting'
import type { PendingTask } from '../../../services/api/pendingTasks'

export type ProfileUiState = 'signed-out' | 'loading' | 'error' | 'empty' | 'member' | 'ready' | 'printing'

type Fact = readonly [string, string]

const LOADING_FACTS: Fact[] = [
  ['正在读取', '你的资产数量，以及有没有没办完的事'],
  ['类目', '六项是本页固定结构，读取中也不会变'],
  ['数量', '还没有返回，因此数量位留空'],
  ['上一次的数字', '不会拿来冒充当前账号'],
  ['待办', '以你账号里的真实待办为准，没有就是没有'],
  ['读取失败时', '数量显示「—」，入口仍然可以点'],
]

const ERROR_FACTS: Fact[] = [
  ['受影响', '六项的数量显示，一律是「—」'],
  ['受影响', '待办卡片，这次不显示任何进度'],
  ['不受影响', '六个入口本身，点进去各自重新加载'],
  ['不受影响', '已提交的订单、文件与记录'],
  ['本机没有做', '退出登录，也没有改动任何数据'],
  ['重新加载', '只重发这两个读取请求，不重复提交任何操作'],
]

/** 稿 30 的 PILL / HEAD。member 不在表里，沿用稿的默认胶囊和页头。 */
export function profileChrome(state: ProfileUiState): {
  status: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  subtitle: string
} {
  if (state === 'signed-out') {
    return { status: { tone: 'warn', label: '未登录，不展示任何人的记录' }, subtitle: '公共终端不登录就不显示任何人的简历、订单和文件。' }
  }
  if (state === 'loading') {
    return { status: { tone: 'unknown', label: '正在取资产数量与待办' }, subtitle: '数量返回前显示「—」，不显示上一次的数字。' }
  }
  if (state === 'error') {
    return { status: { tone: 'bad', label: '账号数据这次没取到' }, subtitle: '数量取不到时入口仍可用，但不显示旧数字。' }
  }
  if (state === 'empty') {
    return { status: { tone: 'unknown', label: '这个账号下还没有记录' }, subtitle: '空就是空，不造记录让页面好看。' }
  }
  if (state === 'ready') {
    return { status: { tone: 'unknown', label: '有一笔待付款' }, subtitle: '有未付款的打印，先把这件事办完再走。' }
  }
  // 10/4 方案②：取件凭证码取消，到机码是唯一的码。一体机当场出纸本来就不用码。稿 30 早于这个决定。
  if (state === 'printing') {
    return { status: { tone: 'warn', label: '有文件正在出纸' }, subtitle: '文件正在出纸，请在出纸口等候取走。' }
  }
  return {
    status: { tone: 'unknown', label: '以你账号里的实际记录为准' },
    subtitle: '简历、文档、订单、收藏与权益都在这里；以实际记录为准。',
  }
}

export function ProfileSupportRows() {
  const navigate = useNavigate()
  const rows = [
    { icon: BellIcon, title: '消息通知', desc: '系统下发的会员通知，已读与标记都会记录。', to: '/me/notifications', testid: 'profile-notifications' },
    { icon: ShieldIcon, title: '隐私请求', desc: '当前可撤回 AI 使用授权；注销账号、复制个人信息，请按《隐私政策》的联系方式申请。', to: '/me/privacy-requests', testid: 'profile-privacy' },
    { icon: HelpCircleIcon, title: '帮助中心', desc: '常见问题与操作说明。', to: '/help', testid: 'profile-help' },
    { icon: MessageSquareIcon, title: '意见反馈', desc: '提交后能看到处理状态。', to: '/me/feedback', testid: 'profile-feedback' },
  ]
  return (
    <section className="pf-support">
      <div className="qx-sec-h">
        <span className="t">通知与支持</span>
        <span className="hint">只列已经能用的</span>
      </div>
      <div className="qx-rows pf-support-rows">
        {rows.map((row) => (
          <button type="button" key={row.to} className="qx-row" data-testid={row.testid} onClick={() => navigate(row.to)}>
            <span className="qx-row-ic">
              <row.icon size={24} aria-hidden />
            </span>
            <span className="qx-row-tx">
              <span className="qx-row-t">{row.title}</span>
              <span className="qx-row-d">{row.desc}</span>
            </span>
            <span className="qx-row-go">›</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export function ProfileStateBanner({
  tone,
  title,
  children,
}: {
  tone: 'error' | 'info'
  title: string
  children: ReactNode
}) {
  const Icon = tone === 'error' ? TriangleAlertIcon : InboxIcon
  return (
    <div className="qx-state pf-state" data-tone={tone} role={tone === 'error' ? 'alert' : undefined} data-testid="profile-fallback">
      <div className="pf-state-h">
        <Icon size={32} aria-hidden />
        {title}
      </div>
      <p>{children}</p>
    </div>
  )
}

export function ProfileFactGrid({ title, hint, rows, ariaLabel }: { title: string; hint: string; rows: readonly Fact[]; ariaLabel?: string }) {
  return (
    <section aria-label={ariaLabel}>
      <div className="qx-sec-h">
        <span className="t">{title}</span>
        <span className="hint">{hint}</span>
      </div>
      <div className="pf-meta2">
        {rows.map(([label, value]) => (
          <div key={`${label}:${value}`}>
            <small>{label}</small>
            <b>{value}</b>
          </div>
        ))}
      </div>
    </section>
  )
}

export function ProfileLoadingFacts() {
  return <ProfileFactGrid title="正在读取什么" hint="数量返回前一律显示「—」" rows={LOADING_FACTS} />
}

export function ProfileErrorFacts() {
  return <ProfileFactGrid title="这次没取到，什么受影响" hint="分开说，不含糊" rows={ERROR_FACTS} />
}

export function SignedOutBody() {
  const navigate = useNavigate()
  const rows = [
    { icon: FileTextIcon, title: '你自己的简历与文档', desc: '解析过的简历、生成的材料与扫描件。', from: '/me/resumes' },
    { icon: PrinterIcon, title: '打印订单与办理进度', desc: '订单状态以系统记录为准，可继续办理。', from: '/me/print-orders' },
    { icon: GiftIcon, title: '权益台账与活动记录', desc: '是否有可用权益由系统判定。', from: '/me/benefits' },
  ]
  const bounds: Fact[] = [
    ['不需要账号', '打印、扫描、复印与文件转换'],
    ['不需要账号', '机构官方渠道与政策查询'],
    ['需要登录', '跨设备保存的简历、文档与打印订单'],
    ['需要登录', '会员权益、隐私请求与消息通知'],
    ['现在显示的数量', '没有 —— 未登录时本机不预渲染任何人的数据'],
    ['登录之后', '数量与待办按你本人的账号显示'],
  ]
  return (
    <>
      <div className="pf-note">
        <div className="pf-note-t"><LockIcon size={24} aria-hidden />不登录也能用的服务</div>
        <p>
          打印、扫描、机构官方渠道和政策查询都<b>不需要账号</b>。需要本人身份、跨设备保存或会员权益的功能，会在进入时再要求登录。
        </p>
      </div>
      <section>
        <div className="qx-sec-h">
          <span className="t">登录之后会出现</span>
          <span className="hint">现在不预渲染任何人的数据</span>
        </div>
        <div className="qx-rows">
          {rows.map((row) => (
            <button
              type="button"
              key={row.from}
              className="qx-row"
              onClick={() => navigate('/login', { state: { from: row.from } })}
            >
              <span className="qx-row-ic" aria-hidden="true"><row.icon size={24} /></span>
              <span className="qx-row-tx">
                <span className="qx-row-t">{row.title}</span>
                <span className="qx-row-d">{row.desc}</span>
              </span>
              <span className="qx-row-go" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      </section>
      <ProfileFactGrid title="登录与不登录的分界" hint="按功能划线，不按页面划线" rows={bounds} ariaLabel="登录与不登录的分界" />
    </>
  )
}

export function EmptyStartRows() {
  const navigate = useNavigate()
  const recruitment = useRecruitmentHosting()
  const channels = useOfficialChannels()
  // 与首页同一条：读到托管关闭，并且至少有一个官方渠道，才指向渠道页。
  // 自营点位没配渠道时，那一页是空的，这一行改回就业政策。
  const showOfficialChannels = recruitment.status === 'ready' && !recruitment.enabled && channels.status === 'ready' && channels.items.length > 0
  const third = showOfficialChannels
    ? {
        title: '看看机构官方渠道',
        desc: '这里只放本机构的官方入口，报名不在这台机器上办。',
        to: '/official-channels',
        icon: StarIcon,
      }
    : {
        title: '看看就业政策并收藏',
        desc: '查看办事指引，资格与办理以官方核验为准。',
        to: '/policy-service',
        icon: FileTextIcon,
      }
  const ThirdIcon = third.icon
  return (
    <section>
      <div className="qx-sec-h">
        <span className="t">从这里开始</span>
      </div>
      <div className="qx-rows">
        <button type="button" className="qx-row" onClick={() => navigate('/resume/source')}>
          <span className="qx-row-ic" aria-hidden="true"><FileTextIcon size={24} /></span>
          <span className="qx-row-tx">
            <span className="qx-row-t">上传或扫描一份简历</span>
            <span className="qx-row-d">解析完就能诊断、优化和生成材料。</span>
          </span>
          <span className="qx-row-go" aria-hidden="true">›</span>
        </button>
        <button type="button" className="qx-row" onClick={() => navigate('/print/upload')}>
          <span className="qx-row-ic" aria-hidden="true"><PrinterIcon size={24} /></span>
          <span className="qx-row-tx">
            <span className="qx-row-t">打印你带来的文件</span>
            <span className="qx-row-d">U 盘、手机传输或本机扫描都可以。</span>
          </span>
          <span className="qx-row-go" aria-hidden="true">›</span>
        </button>
        <button type="button" className="qx-row" data-testid="profile-empty-start-third" onClick={() => navigate(third.to)}>
          <span className="qx-row-ic" aria-hidden="true"><ThirdIcon size={24} /></span>
          <span className="qx-row-tx">
            <span className="qx-row-t">{third.title}</span>
            <span className="qx-row-d">{third.desc}</span>
          </span>
          <span className="qx-row-go" aria-hidden="true">›</span>
        </button>
      </div>
    </section>
  )
}

function AccountSettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="qx-btn" data-variant="ghost" data-narrow="1" data-testid="profile-account" onClick={onClick}>
      账号设置
    </button>
  )
}

function EndUseButton({ primary, onClick }: { primary: boolean; onClick: () => void }) {
  return (
    <button type="button" className="qx-btn" data-variant="danger" data-narrow="1" data-testid={primary ? 'profile-primary' : 'profile-end-use'} onClick={onClick}>
      结束使用
    </button>
  )
}

export function ProfileCta({
  uiState,
  pendingTask,
  onLogin,
  onHome,
  onRetry,
  onHelp,
  onProgress,
  onSettings,
  onEnd,
}: {
  uiState: ProfileUiState
  pendingTask: PendingTask | null
  onLogin: () => void
  onHome: () => void
  onRetry: () => void
  onHelp: () => void
  onProgress: () => void
  onSettings: () => void
  onEnd: () => void
}) {
  if (uiState === 'signed-out') {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" data-narrow="1" onClick={onHome}>回首页</button>
        <button type="button" className="qx-btn" data-variant="primary" data-grow="1" data-testid="profile-primary" onClick={onLogin}>
          <span data-testid="profile-login">去登录</span>
        </button>
      </>
    )
  }
  if (uiState === 'loading') {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" data-testid="profile-primary" onClick={onHome}>回首页</button>
        <AccountSettingsButton onClick={onSettings} />
        <EndUseButton primary={false} onClick={onEnd} />
      </>
    )
  }
  if (uiState === 'error') {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" data-narrow="1" onClick={onHelp}>找工作人员</button>
        <button type="button" className="qx-btn" data-variant="primary" data-grow="1" data-testid="profile-primary" onClick={onRetry}>
          重新加载
        </button>
        <AccountSettingsButton onClick={onSettings} />
        <EndUseButton primary={false} onClick={onEnd} />
      </>
    )
  }
  if (uiState === 'empty') {
    return (
      <>
        <AccountSettingsButton onClick={onSettings} />
        <EndUseButton primary={false} onClick={onEnd} />
        <button type="button" className="qx-btn" data-variant="primary" data-grow="1" data-testid="profile-primary" onClick={onHome}>
          回首页选服务
        </button>
      </>
    )
  }
  if (uiState === 'printing' && pendingTask) {
    return (
      <>
        <p className="why">出纸完成前不要离开取件口；离开这一页不会取消已经提交的打印。</p>
        <button type="button" className="qx-btn" data-variant="primary" data-grow="1" data-testid="profile-primary" onClick={onProgress}>
          看出纸进度
        </button>
        <AccountSettingsButton onClick={onSettings} />
        <EndUseButton primary={false} onClick={onEnd} />
      </>
    )
  }
  return (
    <>
      <p className="why">离开前请点「结束使用」；这会退出登录并清掉本机这一次的临时信息。</p>
      <AccountSettingsButton onClick={onSettings} />
      <EndUseButton primary onClick={onEnd} />
    </>
  )
}
