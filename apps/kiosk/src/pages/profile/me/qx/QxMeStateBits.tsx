import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { BriefcaseIcon, PrinterIcon } from 'lucide-react'
import { QxMeBanner, QxMeGuide, QX_ME_GUIDE } from './QxMeChrome'

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

export function QxMeGuestRows({ onJobs, onPrint }: { onJobs: () => void; onPrint: () => void }) {
  return (
    <>
      <div className="qx-me-legal">不用登录也能办 · 这两项在这台机器上不需要账号</div>
      <QxMeStartRow icon={BriefcaseIcon} title="看第三方岗位与招聘会" desc="来源机构、更新时间与外部入口都在详情页里" label="查看岗位" route="/jobs" testid="member-records-guest-jobs" onClick={onJobs} />
      <QxMeStartRow icon={PrinterIcon} tone="wheat" title="打印或扫描材料" desc="当场办完的打印、扫描不需要登录，也不会绑定到账号" label="去打印扫描" route="/print-scan" testid="member-records-guest-print" onClick={onPrint} />
    </>
  )
}

export function QxMeLoginBlock({
  title,
  desc,
  struct,
  onJobs,
  onPrint,
}: {
  title: string
  desc: string
  struct: ReactNode
  onJobs: () => void
  onPrint: () => void
}) {
  return (
    <>
      <QxMeBanner tone="lock" title={title} desc={<>{desc}<b>下面是登录后会出现的内容结构，以及现在就能办的事。</b></>} minis={['共 —', '登录后回填']} />
      <section className="qx-me-list qx-me-grow" aria-label="登录后会出现的内容结构，以及不用登录也能办的事">
        <div className="qx-me-legal">登录后会出现的内容结构 · 现在不显示任何明细</div>
        {struct}
        <QxMeGuestRows onJobs={onJobs} onPrint={onPrint} />
        <div className="qx-me-legal">登录只用来确认「是你本人」。<b>结束会话只清除本机登录态与临时会话信息</b>；服务端的记录按各自留存期限管理。</div>
      </section>
      <QxMeGuide items={[...QX_ME_GUIDE.login]} />
    </>
  )
}

export function QxMeLoadingBlock({ title }: { title: string }) {
  return (
    <>
      <QxMeBanner tone="calm" title={title} desc={<>正在读取当前账号的记录。<b>返回前一律显示「—」</b>，不会闪回上一位用户的内容。</>} minis={['共 —', '正在安全读取']} />
      <QxMeSkeletonList foot="这次读取失败不会删除任何记录，也不会改动任何已保存的内容。" />
      <QxMeGuide items={[...QX_ME_GUIDE.loading]} />
    </>
  )
}

export function QxMeErrorBlock({ title, desc, struct }: { title: string; desc: string; struct: React.ReactNode }) {
  return (
    <>
      <QxMeBanner tone="warn" title={title} desc={<>{desc}<b>本页不会拿上一次的内容冒充当前账号</b>，所以字段一律显示「—」。</>} minis={['共 —', '本次未取到']} />
      <section className="qx-me-list qx-me-grow" aria-label="本次未取到的内容结构">
        {struct}
        <div className="qx-me-legal">重试不会重复创建记录，也不会改动已保存的内容。多次重试仍失败时，可以让现场工作人员协助查询。</div>
      </section>
      <QxMeGuide items={[...QX_ME_GUIDE.error]} />
    </>
  )
}
