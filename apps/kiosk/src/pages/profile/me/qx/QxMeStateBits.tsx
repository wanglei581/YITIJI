import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { BriefcaseIcon, LandmarkIcon, PrinterIcon } from 'lucide-react'
import { MeErrorPack, MeLoadingPack, MeLoginGate, gatePageFromTitle } from '../../touch/MeStatePacks'

export function QxMeSkeletonList({ count = 4, foot }: { count?: number; foot: string }) {
  return (
    <section className="qx-me-list qx-me-grow" aria-label="正在加载的记录占位">
      {Array.from({ length: count }, (_, i) => (
        <div className="qx-me-row" aria-hidden="true" key={i}>
          <span className="qx-me-row-ico" data-tone="off" />
          <span className="qx-me-row-main"><span className="qx-me-skel" /><span className="qx-me-skel qx-me-skel-s" /></span>
          <span className="qx-me-acts"><span className="qx-me-skel" style={{ width: 110, height: 50, borderRadius: 16 }} /></span>
        </div>
      ))}
      <div className="qx-me-legal">{foot}</div>
    </section>
  )
}

export function QxMeStructRow({
  icon: Icon,
  title,
  desc,
  mode,
  testid,
}: {
  icon: LucideIcon
  title: string
  desc: string
  mode: 'lock' | 'error'
  testid: string
}) {
  return (
    <div className="qx-me-row" data-dead="true" data-slot-mode={mode} data-testid={testid}>
      <span className="qx-me-row-ico" data-tone="off" aria-hidden="true"><Icon size={28} /></span>
      <span className="qx-me-row-main">
        <span className="qx-me-row-title">{title}</span>
        <span className="qx-me-row-sub">{desc}</span>
        <span className="qx-me-row-foot" style={{ marginTop: 9, display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          <span className="qx-me-slot">{mode === 'lock' ? '标题登录后显示' : '标题本次未取到'}</span>
          <span className="qx-me-slot">{mode === 'lock' ? '时间登录后显示' : '时间本次未取到'}</span>
        </span>
      </span>
      <span className="qx-me-acts">
        <span className="qx-me-small" aria-disabled="true">{mode === 'lock' ? '登录后显示' : '本次未取到'}</span>
      </span>
    </div>
  )
}

export function QxMeStartRow({
  icon: Icon,
  tone,
  title,
  desc,
  label,
  onClick,
  testid,
  route,
}: {
  icon: LucideIcon
  tone?: 'slate' | 'plum' | 'wheat'
  title: string
  desc: string
  label: string
  onClick: () => void
  testid: string
  route: string
}) {
  return (
    <button type="button" className="qx-me-row" data-route={route} data-testid={testid} onClick={onClick}>
      <span className="qx-me-row-ico" data-tone={tone} aria-hidden="true"><Icon size={28} /></span>
      <span className="qx-me-row-main">
        <span className="qx-me-row-title">{title}</span>
        <span className="qx-me-row-sub">{desc}</span>
      </span>
      <span className="qx-me-acts"><span className="qx-me-small" data-variant="primary">{label}</span></span>
    </button>
  )
}

export function QxMePendingRow({
  route,
  testid,
  title,
  sub,
  icon: Icon,
  tone,
}: {
  route: string
  testid: string
  title: string
  sub: string
  icon: LucideIcon
  tone?: 'slate' | 'plum' | 'wheat'
}) {
  return (
    <div
      className="qx-me-row"
      data-dead="true"
      aria-disabled="true"
      data-pending-route-host="true"
      data-route={route}
      data-testid={testid}
      aria-label={`${title}（对应页面待建设，暂不可进入）`}
    >
      <span className="qx-me-row-ico" data-tone={tone} aria-hidden="true"><Icon size={28} /></span>
      <span className="qx-me-row-main">
        <span className="qx-me-row-title">{title}</span>
        <span className="qx-me-row-sub">{sub}</span>
        <span className="qx-me-reason">对应页面待建设，暂不可进入</span>
      </span>
      <span className="qx-me-pending">待建设</span>
    </div>
  )
}

/** `hostingOpen`：招聘内容托管（3.13）关闭时没有岗位与招聘会可看，这一行换成同样不用登录的政策服务。 */
export function QxMeGuestRows({ onJobs, onPrint, hostingOpen }: { onJobs: () => void; onPrint: () => void; hostingOpen: boolean }) {
  const navigate = useNavigate()
  return (
    <>
      <div className="qx-me-legal">不用登录也能办 · 这两项在这台机器上不需要账号</div>
      {hostingOpen ? (
        <QxMeStartRow icon={BriefcaseIcon} title="看第三方岗位与招聘会" desc="来源机构、更新时间与外部入口都在详情页里" label="查看岗位" route="/jobs" testid="member-records-guest-jobs" onClick={onJobs} />
      ) : (
        <QxMeStartRow icon={LandmarkIcon} tone="slate" title="查看就业政策" desc="政策、社保与登记指引，资格以官方核验为准" label="查看政策" route="/policy-service" testid="member-records-guest-policy" onClick={() => navigate('/policy-service')} />
      )}
      <QxMeStartRow icon={PrinterIcon} tone="wheat" title="打印或扫描材料" desc="当场办完的打印、扫描不需要登录，也不会绑定到账号" label="去打印扫描" route="/print-scan" testid="member-records-guest-print" onClick={onPrint} />
    </>
  )
}

export function QxMeLoginBlock({
  title,
  printPick = false,
}: {
  title: string
  desc?: string
  struct?: ReactNode
  onJobs?: () => void
  onPrint?: () => void
  printPick?: boolean
}) {
  return <MeLoginGate page={gatePageFromTitle(title)} printPick={printPick} />
}

export function QxMeLoadingBlock(props: { title?: string }) {
  void props.title
  return <MeLoadingPack />
}

export function QxMeErrorBlock({ onRetry }: { title?: string; desc?: string; struct?: ReactNode; onRetry?: () => void }) {
  return <MeErrorPack onRetry={onRetry} />
}
