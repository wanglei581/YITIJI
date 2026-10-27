import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  BellIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  ClockIcon,
  EyeIcon,
  FileTextIcon,
  FolderIcon,
  LandmarkIcon,
  MessageSquareIcon,
  PenLineIcon,
  PrinterIcon,
  ReceiptTextIcon,
  ShieldIcon,
  SparklesIcon,
  TicketIcon,
  Trash2Icon,
} from 'lucide-react'
import { QxTouchCallout } from '../../../components/qingxu/touch/QxTouchCallout'
import { publicIdleLogoutLabel, resultIdleLogoutLabel } from '../../../auth/kioskIdleTiming'
import { helpNeededLine, type PublicSupportContact } from '../../../copy/unattendedCopy'
import { useSupportContact } from '../../../hooks/useSupportContact'
import { MeArt, type MeArtName } from './MeIllus'
import type { MeGatePage } from './meGatePage'

const WHAT: Record<MeGatePage, string> = {
  notifications: '消息',
  'my-resumes': '简历',
  'my-orders': '打印订单',
  'my-docs': '文档',
  'my-ai': 'AI 服务记录',
  'my-activity': '浏览与跳转记录',
  'my-fav': '收藏',
  'my-benefits': '权益',
  feedback: '反馈',
  privacy: '隐私请求',
}

const CAN: Record<MeGatePage, [LucideIcon, string, string][]> = {
  notifications: [[BellIcon, '看未读和已读', '可以只看未读，也可以看全部'], [CheckIcon, '标成已读', '一条一条标，或全部标为已读'], [Trash2Icon, '删掉不需要的', '点开一条，再点删除']],
  'my-resumes': [[FileTextIcon, '看处理结果和保留期限', '完成、处理中、失败都会写在每一份上'], [EyeIcon, '打开诊断、优化或生成结果', '还在处理或失败的，暂时打不开'], [Trash2Icon, '删掉不需要的一份', '先点删除，再点一次确认']],
  'my-orders': [[ReceiptTextIcon, '看打印进度和到机码', '进行中的订单能看到取件用的到机码'], [FolderIcon, '去我的文档再打一份', '会新建一张打印任务，不改原来那张'], [TicketIcon, '手机上下的到店单，输码取件', '还没核销的到店单，不在订单列表里']],
  'my-docs': [[FolderIcon, '看文件名和保存期限', '每份文件写着大小、时间和能保存多久'], [PrinterIcon, '选一份去打印', 'PDF、JPG、PNG 可以直接打'], [ClockIcon, '改保存期限', '3 个月或 6 个月，到期后不能恢复']],
  'my-ai': [[SparklesIcon, '打开已经生成的结果', '诊断、优化、生成、规划和模拟面试'], [ClockIcon, '看还在处理或失败的原因', '打不开的会写明为什么'], [Trash2Icon, '删掉不需要的记录', '小青作业只能删除']],
  'my-activity': [[BookOpenIcon, '看浏览过的政策', '只记你在这台机器上看过的'], [ChevronRightIcon, '看打开过的来源', '点一条可以再打开那条政策'], [ClockIcon, '按时间排好', '最近看的在最前面']],
  'my-fav': [[BookOpenIcon, '看收藏的政策', '只收藏政策，方便下次再找'], [EyeIcon, '点一条打开政策', '打开的是这条政策本身'], [ChevronRightIcon, '取消收藏在政策页里', '这一页不能取消']],
  'my-benefits': [[CheckIcon, '看每项现在能不能用', '可用、已用完、已过期、已撤销都会写明'], [LandmarkIcon, '看补贴说明', '说明不等于补贴已经发放'], [PrinterIcon, '没有权益也能去办事', '打印、简历和政策照样能办']],
  feedback: [[MessageSquareIcon, '选类型并提交', '设备、打印、文件、建议，或 AI 内容投诉'], [ClockIcon, '看以前的处理进度', '已提交、处理中、已回复、已关闭'], [PenLineIcon, '补充回复或关闭工单', '关闭前会再问一次']],
  privacy: [[ShieldIcon, '撤回 AI 使用授权', '不影响简历、打印、收藏和已保存的文件'], [ClipboardListIcon, '看申请记录', '提交之后，进度出现在这一页'], [FileTextIcon, '导出和注销不在这台机器上', '按《隐私政策》里的联系方式申请']],
}

/** 出口卡。左边插画、右边宋体标题加一句话，整张卡可点；tall 是稿上的高卡（插画 240 宽）。 */
export function MeExitCard({
  title,
  desc,
  onClick,
  testId,
  art = 'checklist',
  artWidth = 110,
  tall = false,
  label,
}: {
  title: string
  desc: string
  onClick: () => void
  testId?: string
  art?: MeArtName
  artWidth?: number
  tall?: boolean
  /** 读屏念的整句。不传时按标题加说明。 */
  label?: string
}) {
  return (
    <button
      type="button"
      className={`me-exit qxt-me-exit${tall ? ' me-tall' : ''}`}
      data-testid={testId}
      aria-label={label ?? `${title}，${desc}`}
      onClick={onClick}
    >
      <span className="me-exit-art"><MeArt name={art} width={artWidth} /></span>
      <span>
        <b>{title}</b>
        <small>{desc}</small>
      </span>
    </button>
  )
}

export function MeIdleHelp({
  docs = false,
  contact: given,
}: {
  docs?: boolean
  /** 调用方已经读过联系方式时传进来。登录门自己不发请求。 */
  contact?: PublicSupportContact
}) {
  const peeked = useSupportContact(false)
  const contact = given ?? peeked
  const label = docs ? resultIdleLogoutLabel() : publicIdleLogoutLabel()
  return (
    <p className="me-fine">
      离开 {label}没操作会自动退出。{helpNeededLine(contact)}
    </p>
  )
}

function LoginCard({ title, text }: { title: string; text: string }) {
  return (
    <section className="me-login" aria-label="登录引导">
      <span className="me-login-vis"><MeArt name="phone" width={96} /></span>
      <span>
        <b>{title}</b>
        <p>{text}</p>
      </span>
    </section>
  )
}

export function MeLoginGate({ page, printPick = false }: { page: MeGatePage; printPick?: boolean }) {
  const navigate = useNavigate()
  const what = WHAT[page]
  const docs = page === 'my-docs'
  return (
    <div className="me-state">
      <LoginCard title={`登录后看你的${what}`} text="用手机号和验证码，或在手机上扫码确认。登录后会回到这一页。" />
      <p className="me-k">登录后在这一页能</p>
      {CAN[page].map(([Icon, title, desc]) => (
        <div className="me-can" key={title}>
          <span className="me-ic"><Icon size={32} strokeWidth={2} aria-hidden /></span>
          <span><b>{title}</b><span>{desc}</span></span>
        </div>
      ))}
      <div className="me-stack">
        <p className="me-k">不登录也能办</p>
        {docs && printPick ? (
          <MeExitCard art="scan" artWidth={120} title="返回选文件" desc="回到刚才的打印" onClick={() => navigate('/print/upload')} />
        ) : null}
        <MeExitCard art="usb" artWidth={120} title="打印扫描" desc="不登录也能打印、扫描" onClick={() => navigate('/print-scan')} />
        <MeExitCard art="checklist" artWidth={108} title="查政策" desc="看本机构发布的就业政策" onClick={() => navigate('/policy-service')} />
        {page === 'my-benefits' ? (
          <MeExitCard art="stack" artWidth={108} title="先看看有哪些活动" desc="活动列表现在就能看" onClick={() => navigate('/activities')} />
        ) : null}
      </div>
      <MeIdleHelp docs={docs} />
    </div>
  )
}

export function MeProfileGuest({ contact }: { contact?: PublicSupportContact } = {}) {
  const navigate = useNavigate()
  const jumps: [string, LucideIcon, string, string][] = [
    ['/me/resumes', FileTextIcon, '简历与文档', '看保存的简历和文件'],
    ['/me/print-orders', ReceiptTextIcon, '打印订单', '看打印进度和到机码'],
    ['/me/benefits', CheckIcon, '权益', '看能不能用，以及有哪些活动'],
  ]
  return (
    <div className="me-state">
      <LoginCard title="这台机器是公共终端" text="不登录不会显示任何人的记录。用手机号和验证码，或在手机上扫码确认。" />
      <p className="me-k">登录后可以看</p>
      {jumps.map(([to, Icon, title, desc]) => (
        <button type="button" className="me-line me-jump" key={to} onClick={() => navigate('/login', { state: { from: to } })}>
          <span className="me-ic"><Icon size={32} strokeWidth={2} aria-hidden /></span>
          <span className="me-jump-tx"><b>{title}</b><small>{desc}</small></span>
          <ChevronRightIcon size={28} strokeWidth={2.2} aria-hidden />
        </button>
      ))}
      <section className="me-stack" aria-label="不登录也能办">
        <p className="me-k">不登录也能办</p>
        <MeExitCard art="usb" artWidth={120} title="打印扫描" desc="不登录也能打印、扫描" onClick={() => navigate('/print-scan')} />
        <MeExitCard art="checklist" artWidth={108} title="查政策" desc="看本机构发布的就业政策" onClick={() => navigate('/policy-service')} />
      </section>
      <MeIdleHelp contact={contact} />
    </div>
  )
}

export function MeErrorPack({
  reloadLabel = '重新加载',
  onRetry,
  sentence: given,
}: {
  reloadLabel?: '重新加载' | '重新读取'
  onRetry?: () => void
  /** 页面要多交代一句时覆盖默认的一句话（例如权益台账不显示缓存）。 */
  sentence?: string
}) {
  const navigate = useNavigate()
  const contact = useSupportContact()
  const sentence = given ?? (reloadLabel === '重新读取'
    ? '数量和待办这次没有取到。记录还在，可以重新读取。'
    : '这次没有读到列表。记录还在，可以重新加载。')
  const again = '再读一次。刚才没出来的内容会重新显示。'
  return (
    <div className="me-state">
      <p className="me-p">{sentence}</p>
      <div className="me-stack">
        <MeExitCard art="report" artWidth={140} title={reloadLabel} desc={again} onClick={() => onRetry?.()} label={`${reloadLabel}，${again}`} />
        <MeExitCard art="resume" artWidth={140} title="先去办别的" desc="回到首页。打印、扫描和查政策都可以继续。" onClick={() => navigate('/')} />
      </div>
      <QxTouchCallout kind="remind" icon="call">{helpNeededLine(contact)}</QxTouchCallout>
    </div>
  )
}

export function MeLoadingPack({ rows = 8 }: { rows?: number }) {
  return (
    <div className="me-rows" aria-busy="true" aria-label="正在读取">
      {Array.from({ length: rows }, (_, index) => (
        <div className="me-skel" key={index} aria-hidden="true">
          <b>正在读取</b>
          <i />
          <i className="me-short" />
        </div>
      ))}
    </div>
  )
}

export function MeProfileLoading() {
  const names = ['我的简历', '我的文档', '打印订单', '我的收藏', '我的权益', 'AI 服务记录']
  return (
    <div className="me-state" aria-busy="true">
      <div className="me-id"><b>正在读取</b><span>请稍等</span></div>
      <div className="me-counts">
        {names.map((name) => (
          <div className="me-count" key={name}><span>{name}</span><b className="me-ghost">正在读取</b></div>
        ))}
      </div>
      <MeLoadingPack rows={6} />
    </div>
  )
}

export function MeEmptyPack({ sentence, children, note }: { sentence: string; children: ReactNode; note?: ReactNode }) {
  const contact = useSupportContact()
  return (
    <div className="me-state">
      <p className="me-p">{sentence}</p>
      {note}
      <div className="me-stack">{children}</div>
      <QxTouchCallout kind="remind" icon="call">{helpNeededLine(contact)}</QxTouchCallout>
    </div>
  )
}

export function MeAiChip() {
  return <span className="me-ai">AI 生成，仅供参考</span>
}
