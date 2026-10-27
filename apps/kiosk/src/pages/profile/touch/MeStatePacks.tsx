import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { publicIdleLogoutLabel, resultIdleLogoutLabel } from '../../../auth/kioskIdleTiming'
import { helpNeededLine, type PublicSupportContact } from '../../../copy/unattendedCopy'
import { useSupportContact } from '../../../hooks/useSupportContact'

export type MeGatePage =
  | 'notifications'
  | 'my-resumes'
  | 'my-orders'
  | 'my-docs'
  | 'my-ai'
  | 'my-activity'
  | 'my-fav'
  | 'my-benefits'
  | 'feedback'
  | 'privacy'

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

const CAN: Record<MeGatePage, [string, string][]> = {
  notifications: [['看未读和已读', '可以只看未读，也可以看全部'], ['标成已读', '一条一条标，或全部标为已读'], ['删掉不需要的', '先点删除，再点一次确认']],
  'my-resumes': [['看处理结果和保留期限', '完成、处理中、失败都会写在每一份上'], ['打开诊断、优化或生成结果', '还在处理或失败的，暂时打不开'], ['删掉不需要的一份', '先点删除，再点一次确认']],
  'my-orders': [['看打印进度和到机码', '进行中的订单能看到取件用的到机码'], ['去我的文档再打一份', '会新建一张打印任务，不改原来那张'], ['手机上下的到店单，输码取件', '还没核销的到店单，不在订单列表里']],
  'my-docs': [['看文件名和保存期限', '每份文件写着大小、时间和能保存多久'], ['选一份去打印', 'PDF、JPG、PNG 可以直接打'], ['改保存期限', '3 个月或 6 个月，到期后不能恢复']],
  'my-ai': [['打开已经生成的结果', '诊断、优化、生成、规划和模拟面试'], ['看还在处理或失败的原因', '打不开的会写明为什么'], ['删掉不需要的记录', '小青作业只能删除']],
  'my-activity': [['看浏览过的政策', '只记你在这台机器上看过的'], ['看打开过的来源', '点一条可以再打开那条政策'], ['按时间排好', '最近看的在最前面']],
  'my-fav': [['看收藏的政策', '只收藏政策，方便下次再找'], ['点一条打开政策', '打开的是这条政策本身'], ['取消收藏在政策页里', '这一页不能取消']],
  'my-benefits': [['看每项现在能不能用', '可用、已用完、已过期、已撤销都会写明'], ['看补贴说明', '说明不等于补贴已经发放'], ['没有权益也能去办事', '打印、简历和政策照样能办']],
  feedback: [['选类型并提交', '设备、打印、文件、建议，或 AI 内容投诉'], ['看以前的处理进度', '已提交、处理中、已回复、已关闭'], ['补充回复或关闭工单', '关闭前会再问一次']],
  privacy: [['撤回 AI 使用授权', '不影响简历、打印、收藏和已保存的文件'], ['看申请记录', '提交之后，进度出现在这一页'], ['导出和注销不在这台机器上', '按《隐私政策》里的联系方式申请']],
}

function PhoneArt() {
  return (
    <span className="qxt-me-ic" aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.4">
        <rect x="14" y="6" width="20" height="36" rx="4" />
        <path d="M20 10h8M22 36h4" />
      </svg>
    </span>
  )
}

function PrintArt() {
  return (
    <span className="qxt-me-ic" aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.4">
        <path d="M16 18V8h16v10M14 30h20v10H14zM12 18h24a4 4 0 0 1 4 4v8H8v-8a4 4 0 0 1 4-4z" />
      </svg>
    </span>
  )
}

function BookArt() {
  return (
    <span className="qxt-me-ic" aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.4">
        <path d="M10 12h12a6 6 0 0 1 6 6v18H16a6 6 0 0 0-6 6V12zM38 12H26a6 6 0 0 0-6 6v18h12a6 6 0 0 1 6 6V12z" />
      </svg>
    </span>
  )
}

export function MeExitCard({
  title,
  desc,
  onClick,
  testId,
  art = 'book',
}: {
  title: string
  desc: string
  onClick: () => void
  testId?: string
  art?: 'phone' | 'print' | 'book'
}) {
  return (
    <button type="button" className="qxt-me-exit" data-testid={testId} onClick={onClick}>
      {art === 'phone' ? <PhoneArt /> : art === 'print' ? <PrintArt /> : <BookArt />}
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
    <p className="qxt-me-idle">
      离开 {label}没操作会自动退出。{helpNeededLine(contact)}
    </p>
  )
}

export function MeLoginGate({ page, printPick = false }: { page: MeGatePage; printPick?: boolean }) {
  const navigate = useNavigate()
  const what = WHAT[page]
  const docs = page === 'my-docs'
  return (
    <div className="qxt-me-state">
      <section className="qxt-me-login" aria-label="登录引导">
        <PhoneArt />
        <span>
          <b>登录后看你的{what}</b>
          <p>用手机号和验证码，或在手机上扫码确认。登录后会回到这一页。</p>
        </span>
      </section>
      <p className="qxt-me-k">登录后在这一页能</p>
      {CAN[page].map(([title, desc]) => (
        <div className="qxt-me-can" key={title}>
          <BookArt />
          <span><b>{title}</b><small>{desc}</small></span>
        </div>
      ))}
      <div className="qxt-me-stack">
        <p className="qxt-me-k">不登录也能办</p>
        {docs && printPick ? (
          <MeExitCard art="print" title="返回选文件" desc="回到刚才的打印" onClick={() => navigate('/print/upload')} />
        ) : null}
        <MeExitCard art="print" title="打印扫描" desc="不登录也能打印、扫描" onClick={() => navigate('/print-scan')} />
        <MeExitCard title="查政策" desc="看本机构发布的就业政策" onClick={() => navigate('/policy-service')} />
        {page === 'my-benefits' ? (
          <MeExitCard title="先看看有哪些活动" desc="活动列表现在就能看" onClick={() => navigate('/activities')} />
        ) : null}
      </div>
      <MeIdleHelp docs={docs} />
    </div>
  )
}

export function MeProfileGuest({ contact }: { contact?: PublicSupportContact } = {}) {
  const navigate = useNavigate()
  const jumps: [string, string, string][] = [
    ['/me/resumes', '简历与文档', '看保存的简历和文件'],
    ['/me/print-orders', '打印订单', '看打印进度和到机码'],
    ['/me/benefits', '权益', '看能不能用，以及有哪些活动'],
  ]
  return (
    <div className="qxt-me-state">
      <section className="qxt-me-login" aria-label="登录引导">
        <PhoneArt />
        <span>
          <b>这台机器是公共终端</b>
          <p>不登录不会显示任何人的记录。用手机号和验证码，或在手机上扫码确认。</p>
        </span>
      </section>
      <p className="qxt-me-k">登录后可以看</p>
      {jumps.map(([to, title, desc]) => (
        <button
          type="button"
          className="qxt-me-exit"
          key={to}
          onClick={() => navigate('/login', { state: { from: to } })}
        >
          <BookArt />
          <span><b>{title}</b><small>{desc}</small></span>
        </button>
      ))}
      <section className="qxt-me-stack" aria-label="不登录也能办">
        <p className="qxt-me-k">不登录也能办</p>
        <MeExitCard art="print" title="打印扫描" desc="不登录也能打印、扫描" onClick={() => navigate('/print-scan')} />
        <MeExitCard title="查政策" desc="看本机构发布的就业政策" onClick={() => navigate('/policy-service')} />
      </section>
      <MeIdleHelp contact={contact} />
    </div>
  )
}

export function MeErrorPack({
  reloadLabel = '重新加载',
  onRetry,
}: {
  reloadLabel?: '重新加载' | '重新读取'
  onRetry?: () => void
}) {
  const navigate = useNavigate()
  const contact = useSupportContact()
  const sentence = reloadLabel === '重新读取'
    ? '数量和待办这次没有取到。记录还在，可以重新读取。'
    : '这次没有读到列表。记录还在，可以重新加载。'
  const again = '再读一次。刚才没出来的内容会重新显示。'
  return (
    <div className="qxt-me-state">
      <p className="qxt-me-lead">{sentence}</p>
      <div className="qxt-me-stack">
        <button
          type="button"
          className="qxt-me-exit"
          aria-label={`${reloadLabel}，${again}`}
          onClick={onRetry}
        >
          <BookArt />
          <span><b>{reloadLabel}</b><small>{again}</small></span>
        </button>
        <MeExitCard title="先去办别的" desc="回到首页。打印、扫描和查政策都可以继续。" onClick={() => navigate('/')} />
      </div>
      <p className="qxt-me-idle">{helpNeededLine(contact)}</p>
    </div>
  )
}

export function MeLoadingPack({ rows = 8 }: { rows?: number }) {
  return (
    <div className="qxt-me-skel" aria-busy="true" aria-label="正在读取">
      {Array.from({ length: rows }, (_, index) => (
        <div className="qxt-me-skel-row" key={index} aria-hidden="true">
          <span />
          <span />
        </div>
      ))}
    </div>
  )
}

export function MeProfileLoading() {
  const names = ['我的简历', '我的文档', '打印订单', '我的收藏', '我的权益', 'AI 服务记录']
  return (
    <div className="qxt-me-state" aria-busy="true">
      <section className="qxt-me-login">
        <BookArt />
        <span><b>正在读取</b><p>请稍等</p></span>
      </section>
      <div className="qxt-me-counts">
        {names.map((name) => (
          <div key={name}><span>{name}</span><b>正在读取</b></div>
        ))}
      </div>
      <MeLoadingPack rows={6} />
    </div>
  )
}

export function MeEmptyPack({ sentence, children }: { sentence: string; children: ReactNode }) {
  const contact = useSupportContact()
  return (
    <div className="qxt-me-state">
      <p className="qxt-me-lead">{sentence}</p>
      <div className="qxt-me-stack">{children}</div>
      <p className="qxt-me-idle">{helpNeededLine(contact)}</p>
    </div>
  )
}

export function MeAiChip() {
  return <span className="qxt-me-ai">AI 生成，仅供参考</span>
}

export function gatePageFromTitle(title: string): MeGatePage {
  if (title.includes('文档')) return 'my-docs'
  if (title.includes('简历')) return 'my-resumes'
  if (title.includes('订单')) return 'my-orders'
  if (title.includes('AI')) return 'my-ai'
  if (title.includes('收藏')) return 'my-fav'
  if (title.includes('消息')) return 'notifications'
  if (title.includes('权益')) return 'my-benefits'
  if (title.includes('反馈')) return 'feedback'
  if (title.includes('隐私')) return 'privacy'
  return 'my-activity'
}
