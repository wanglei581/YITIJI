import { Button } from '@ai-job-print/ui'
import type { ExternalJobDTO } from '@ai-job-print/shared'
import {
  ArrowRightIcon,
  BanIcon,
  BuildingIcon,
  ExternalLinkIcon,
  FileSearchIcon,
  InfoIcon,
  Link2Icon,
  MapPinIcon,
  PrinterIcon,
  QrCodeIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  SparklesIcon,
  StarIcon,
  TagIcon,
  XIcon,
} from 'lucide-react'
import { SourceUrlQr } from '../../../components/SourceUrlQr'
import { SOURCE_APPLY_UNAVAILABLE_REASON } from '../../../lib/capabilityReasons'
import { isValidSourceUrl } from '../../../lib/url'
import { CATEGORY_LABEL, formatFullDate, jobCompleteness, splitTextLines } from '../utils/jobDisplay'
import {
  describeSourceOrgTrust,
  SOURCE_ORG_TRUST_DISCLAIMER,
} from '../utils/sourceContentTrust'
import { SOURCE_ELEMENT_MISSING_TEXT, sourceTrustReason, type JobSourceTrust } from '../utils/sourceTrust'

export function QrOverlay({
  job,
  onClose,
}: {
  job: ExternalJobDTO
  onClose: () => void
}) {
  const valid = isValidSourceUrl(job.sourceUrl)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative w-[22rem] max-w-full rounded-2xl bg-white p-7 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <button onClick={onClose} aria-label="关闭" className="absolute right-4 top-4 rounded-full p-1 text-neutral-400 hover:bg-neutral-100">
          <XIcon className="h-5 w-5" />
        </button>

        <p className="text-center text-base font-semibold text-neutral-800">扫码前往来源平台投递</p>

        <div className="mt-5 flex justify-center">
          <SourceUrlQr value={job.sourceUrl} size={196} />
        </div>

        {valid && <p className="mt-3 break-all rounded-lg bg-neutral-50 px-3 py-2 text-center text-[11px] text-neutral-500">{job.sourceUrl}</p>}

        <div className="mt-4 space-y-1.5 rounded-lg bg-neutral-50 px-4 py-3 text-xs text-neutral-500">
          <InfoRow label="来源机构" value={job.sourceName} />
          <InfoRow label="外部编号" value={job.externalId} mono />
        </div>

        <div className="mt-4 flex items-start gap-2">
          <SmartphoneIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" />
          <p className="text-xs leading-relaxed text-neutral-500">
            请使用手机扫码前往来源平台办理投递，本系统不接收简历、不参与招聘流程。
          </p>
        </div>
      </div>
    </div>
  )
}

export function JobSummarySection({
  job,
  favorite,
  onToggleFavorite,
}: {
  job: ExternalJobDTO
  favorite: boolean
  onToggleFavorite: () => void
}) {
  const completeness = jobCompleteness(job)
  return (
    // shrink-0：.jf-content 是 `display:flex; flex-direction:column; overflow-y:auto` 的定高容器
    // （apps/kiosk/src/pages/styles/jobs-fairs-foundation.css:119）。flex 子项默认 flex-shrink:1，
    // 内容超出时它们会被压扁，而 .jf-card 又是 overflow:hidden —— 结果是**内容被静默裁掉、
    // 容器还不滚动**（实测：本页三张卡在真机尺寸下原本就被裁掉 ~123px，字段还没加就已经在丢内容）。
    // 钉住 shrink-0 后超出部分交给容器自己滚，声明的 overflow-y:auto 才真正生效，
    // 不会出现「字段渲染了但用户看不到」（CLAUDE.md §9）。
    <section className="jf-card accented compact shrink-0">
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-[36px] font-black leading-tight tracking-[1px]">{job.title}</h2>
          <div className="jf-row-info mt-3">
            <span><BuildingIcon aria-hidden="true" />{job.company}</span>
            <span><MapPinIcon aria-hidden="true" />{job.city}</span>
          </div>
        </div>
        <button
          onClick={onToggleFavorite}
          aria-pressed={favorite}
          aria-label={favorite ? '取消收藏' : '收藏岗位'}
          className={`jf-fav-chip${favorite ? ' on' : ''}`}
        >
          <StarIcon className={`h-6 w-6 ${favorite ? 'fill-current' : ''}`} />
          {favorite ? '已收藏' : '收藏'}
        </button>
      </div>

      <div className="jf-metrics mt-5">
        <SummaryMetric label="薪资" value={job.salaryDisplay || '薪资面议'} />
        <SummaryMetric label="类型" value={job.category ? CATEGORY_LABEL[job.category] ?? job.category : '来源平台未提供'} />
        <SummaryMetric label="行业" value={job.industry || '来源平台未提供'} />
        {/*
          招聘人数：五部门《关于规范网络平台招聘类信息发布的通知》（2026-01）要求
          招聘信息包含招聘人数。来源未提供时如实显示「来源平台未提供」——
          绝不填 0、不填 1、不按其他字段估算（CLAUDE.md §9 不伪造能力）。
        */}
        <SummaryMetric
          label="招聘人数"
          value={typeof job.headcount === 'number' ? `${job.headcount} 人` : '来源平台未提供'}
        />
        {/*
          学历要求 / 工作经验：标签与相邻位置照 docs/design/kiosk-redesign-2026-08/27-browse-detail.html
          的 tilesBlock（招聘人数 · 学历要求 · 工作经验）。与上面的「招聘人数」不同，这两项没有
          法规要求必须出现，来源没给就整格不渲染 —— 不写「暂无」「未提供」，也不留空占位格
          （CLAUDE.md §9 不伪造能力：null 是「来源平台没给」，渲染成任何具体值都是编）。
        */}
        {job.educationRequirement && <SummaryMetric label="学历要求" value={job.educationRequirement} />}
        {job.experienceRequirement && <SummaryMetric label="工作经验" value={job.experienceRequirement} />}
        <SummaryMetric label="字段完整度" value={`${completeness}%`} />
      </div>

      <div className="jf-meta-chips mt-4">
        {job.category && (
          <span className="jf-chip">
            {CATEGORY_LABEL[job.category] ?? job.category}
          </span>
        )}
        {job.tags.map((tag) => (
          <span key={tag} className="jf-chip">
            <TagIcon className="h-3 w-3" />
            {tag}
          </span>
        ))}
      </div>
    </section>
  )
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="jf-metric">
      <p className="k">{label}</p>
      <p className={`v ${label === '薪资' ? 'salary' : ''}`}>{value}</p>
    </div>
  )
}

export function JobDescriptionSection({ job }: { job: ExternalJobDTO }) {
  const descriptions = splitTextLines(job.description)
  const requirements = splitTextLines(job.requirements)
  // skills / benefits 的共享类型是 string[]，且服务端 prismaJobToListItem 走 safeJsonArr()
  // （services/api/src/jobs/jobs-shared.ts），它只会产出数组并把非字符串项过滤掉 ——
  // 所以运行时不会是字符串，也不会是 undefined，**来源没给就是空数组**。
  // 判空必须看 length：`job.skills && ...` 对 [] 是 true，会渲染出一排空标签。
  const skills = job.skills ?? []
  const benefits = job.benefits ?? []

  return (
    // shrink-0 的理由见 JobSummarySection
    <section className="jf-card compact shrink-0">
      <div className="jf-card-head">
        <span className="jf-g-icon"><FileSearchIcon aria-hidden="true" /></span>
        <div>
          <h2>职责与要求</h2>
          <div className="sub">内容由来源平台同步</div>
        </div>
      </div>

      <div className="jf-desc-grid">
        <TextList title="岗位职责" items={descriptions} fallback="来源平台暂未提供岗位职责，建议通过来源链接查看完整 JD。" />
        <TextList title="任职要求" items={requirements} fallback="来源平台暂未提供任职要求，客户可在导入时补充 requirements 字段。" />
        {/*
          技能要求 / 福利待遇：27-browse-detail.html 没画这两项（原型的岗位内容块只有
          工作内容 / 任职要求 / 工作地点），所以不自创版式 —— 复用本卡已有的 jf-desc-grid 栅格
          与全局 jf-chip 标签样式，落在同一张「内容由来源平台同步」的卡里。
          来源没给（空数组）就整块不渲染，不留标题、不写「暂无」。
        */}
        {skills.length > 0 && <ChipList title="技能要求" items={skills} />}
        {benefits.length > 0 && <ChipList title="福利待遇" items={benefits} />}
      </div>
    </section>
  )
}

function ChipList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3>{title}</h3>
      <div className="jf-meta-chips">
        {/* 来源平台的原始条目可能重复，key 带下标避免 React 重复 key */}
        {items.map((item, index) => (
          <span key={`${item}-${index}`} className="jf-chip">{item}</span>
        ))}
      </div>
    </div>
  )
}

function TextList({ title, items, fallback }: { title: string; items: string[]; fallback: string }) {
  return (
    <div>
      <h3>{title}</h3>
      {items.length > 0 ? (
        <ul>
          {items.slice(0, 8).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="text-[20px] leading-relaxed text-[var(--muted)]">{fallback}</p>
      )}
    </div>
  )
}

export function JobTrustSection({ job, trust }: { job: ExternalJobDTO; trust: JobSourceTrust }) {
  const sourceCanApply = trust.ok
  const sourceOrgTrust = describeSourceOrgTrust(job.sourceContentTrustStatus)
  return (
    // shrink-0 的理由见 JobSummarySection
    <section className="jf-card accented compact shrink-0" style={{ '--accent': 'var(--wheat)', '--accent-deep': 'var(--wheat-deep)', '--accent-soft': 'var(--wheat-soft)' } as React.CSSProperties}>
      <div className="jf-card-head">
        <span className="jf-g-icon"><ShieldCheckIcon aria-hidden="true" /></span>
        <div>
          <h2>来源可信区</h2>
          {/* 规则常显，不只在触发时才出现 —— 照 27-browse-detail.html「信息来源」卡头右侧的
              `四要素缺一即不放行外跳`，让用户在正常态就知道这个入口是有前置条件的。 */}
          <div className="sub">第三方来源信息，请核对后前往办理 · 来源四要素缺一即不放行外跳与扫码</div>
        </div>
      </div>

      {/*
        四要素逐格如实显示：来源方没给就写「来源平台未提供」，不留空格子。
        空白格子会被当成排版问题而不是数据问题，用户也无从知道到底是哪一项拦住了入口
        （原型在这四行用 `—` 占位，同一个意思）。
      */}
      <div className="jf-kv-grid">
        <SourceElementCell label="来源机构" value={job.sourceName} present={trust.present.sourceName} />
        <div className="jf-kv"><div className="k">来源类型</div><div className="v">线上招聘平台</div></div>
        <SourceElementCell label="同步时间" value={formatFullDate(job.syncTime)} present={trust.present.syncTime} />
        <SourceElementCell label="外部ID" value={job.externalId} present={trust.present.externalId} />
        <div className="jf-kv" data-source-org-trust="true">
          <div className="k">来源核验状态</div>
          <div className={`v${sourceOrgTrust.known ? '' : ' text-[var(--muted)]'}`}>{sourceOrgTrust.label}</div>
        </div>
        {job.sourceOrgArchived ? (
          <div className="jf-kv">
            <div className="k">机构归档</div>
            <div className="v">来源机构已归档</div>
          </div>
        ) : null}
        {/*
          有效期限：27-browse-detail.html 的「信息来源」块把它列为来源四要素之一
          （来源平台 / 同步时间 / 外部编号 / 有效期限），所以放在同一个 kv 栅格里。
          这里只如实回显来源平台标注的日期，**不判断、不标注「已过期」**，
          也不按当前时间做任何分支 —— 不是因为「无权判断」，而是因为
          **过期岗位到不了这一页**：服务端列表（buildPublishedJobWhere）与详情
          （getPublishedJobById）两条读取路径都套了 jobValidityWhere，读取时即过滤。
          详见 ../utils/sourceTrust.ts 顶部的复核记录。
          来源没给就不渲染这一格。
        */}
        {job.validThrough && (
          <div className="jf-kv"><div className="k">有效期限</div><div className="v">{formatFullDate(job.validThrough)}</div></div>
        )}
      </div>

      {/* 链接这一行只看链接本身：门禁是四要素的合取，链接没问题时不该把它也说成「未提供」。 */}
      <div className="mt-4 flex items-center gap-2 text-[18px] text-[var(--muted)]">
        <Link2Icon className="h-5 w-5 shrink-0 opacity-70" />
        来源链接 <b className="break-all text-[var(--ink)]">{trust.present.sourceUrl ? job.sourceUrl : '来源平台未提供有效链接'}</b>
        {sourceCanApply && <span className="ml-2 shrink-0">(完整链接见扫码页)</span>}
      </div>

      {/*
        不放行时的整块说明，对应原型 source-unavailable 态的 `aibar off` 横幅。
        写清三件事：停了什么、为什么停、这不代表岗位无效。
        最后一句是硬要求 —— 本机只能说「我核不了来源」，不能替来源平台断言「该岗位无效」。
      */}
      {sourceCanApply ? null : (
        <aside className="jf-notice mt-4" style={{ '--accent': 'var(--clay)', '--accent-deep': 'var(--clay-deep)', '--accent-soft': 'var(--clay-soft)' } as React.CSSProperties}>
          <BanIcon aria-hidden="true" />
          <p>
            <b className="text-[var(--ink)]">来源要素不完整，前往来源平台与扫码已停用</b>
            <span className="mt-1 block">
              来源方没有返回可核对的{trust.missingLabels.join('、')}。为了不让你扫到无法核对的地址，
              本机关闭了这条岗位的外部入口，只保留原文只读。
              这不表示该岗位无效 —— 岗位是否仍在招聘由来源平台决定，可到来源平台自行查询该职位。
            </span>
          </p>
        </aside>
      )}

      {/* 不放行的原因只在「紧挨着被停用的控件」的地方各写一次（扫码面板、底部操作条），
          外加上面那条整块说明。这里不再复述第四遍 —— 同一句话满屏重复会把它变成背景噪音。 */}
      <div className="jf-notice mt-4">
        <InfoIcon aria-hidden="true" />
        <p>
          本岗位来自第三方/官方来源，本系统不接收简历、不参与招聘流程。
          <span className="mt-1 block">{SOURCE_ORG_TRUST_DISCLAIMER}</span>
          <span className="mt-1 block text-neutral-400">{job.dataSourceNote}</span>
        </p>
      </div>
    </section>
  )
}

/** 来源四要素单格：缺失时如实写「来源平台未提供」，不留空。 */
function SourceElementCell({ label, value, present }: { label: string; value: string; present: boolean }) {
  return (
    <div className="jf-kv">
      <div className="k">{label}</div>
      <div className={`v${present ? '' : ' text-[var(--muted)]'}`}>{present ? value : SOURCE_ELEMENT_MISSING_TEXT}</div>
    </div>
  )
}

export function JobNextActionsSection({
  job,
  trust,
  onOpenQr,
  onViewCompany,
  onExplainAi,
  onMatchAi,
  onPrint,
}: {
  job: ExternalJobDTO
  trust: JobSourceTrust
  onOpenQr: () => void
  onViewCompany: () => void
  onExplainAi: () => void
  onMatchAi: () => void
  onPrint: () => void
}) {
  const sourceCanApply = trust.ok
  const blockedReason = sourceTrustReason(trust, SOURCE_APPLY_UNAVAILABLE_REASON)
  return (
    // shrink-0 的理由见 JobSummarySection
    <div className="jf-action-zone shrink-0">
      <section className="jf-card compact">
        <div className="jf-card-head">
          <span className="jf-g-icon"><ArrowRightIcon aria-hidden="true" /></span>
          <div>
            <h2>后续动作</h2>
            <div className="sub">AI 内容仅供参考，需登录后使用</div>
          </div>
        </div>
        <div className="jf-next-grid">
          <ActionButton tinted icon={SparklesIcon} label="AI岗位解读" hint="看懂职责与准备点" onClick={onExplainAi} />
          <ActionButton icon={FileSearchIcon} label="岗位匹配参考" hint="用本人简历做准备" onClick={onMatchAi} />
          <ActionButton icon={BuildingIcon} label="查看企业" hint={job.companyProfileId ? job.company : '来源企业未关联'} disabled={!job.companyProfileId} onClick={onViewCompany} />
          <ActionButton icon={PrinterIcon} label="打印岗位信息" hint="A4 黑白 · 以现场公示价为准" onClick={onPrint} />
        </div>
      </section>
      <div className="jf-qr-panel">
        <div className="qr-title">扫码投递</div>
        {/*
          门禁不放行时不渲染可扫的码 —— 照原型 source-unavailable 态：那里整块二维码被撤下，
          底栏只留一个停用的「二维码不可用」。这一条是实质性的：来源要素核不全时，
          一张仍然能扫的码等于把用户送去一个本机无法核对的地址，置灰按钮拦不住已经举起的手机。
          （SourceUrlQr 自身只挡非法 scheme；缺来源机构 / 同步时间 / 外部ID 时它照样会出码。）
        */}
        {sourceCanApply ? (
          <SourceUrlQr value={job.sourceUrl} size={170} />
        ) : (
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50 p-4 text-center text-[16px] text-[var(--muted)]"
            style={{ width: 170, height: 170 }}
          >
            <BanIcon aria-hidden="true" className="h-7 w-7 opacity-60" />
            <span>二维码不可用</span>
          </div>
        )}
        <div className="qr-sub">
          手机扫码打开来源平台投递页，投递结果以来源平台为准
          {sourceCanApply ? null : (
            <b id="job-qr-blocked" className="jf-blocked-reason">{blockedReason}</b>
          )}
        </div>
        <button
          type="button"
          className="jf-btn ghost sm"
          aria-disabled={!sourceCanApply || undefined}
          aria-describedby={sourceCanApply ? undefined : 'job-qr-blocked'}
          onClick={onOpenQr}
        >
          <QrCodeIcon aria-hidden="true" />
          放大二维码
        </button>
      </div>
    </div>
  )
}

function ActionButton({
  icon: Icon,
  label,
  hint,
  disabled,
  tinted,
  onClick,
}: {
  icon: typeof QrCodeIcon
  label: string
  hint: string
  disabled?: boolean
  tinted?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`jf-tile${tinted ? ' tinted' : ''} disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <span className="jf-tile-icon"><Icon aria-hidden="true" /></span>
      <span><b>{label}</b><span>{hint}</span></span>
    </button>
  )
}

export function StickyActionBar({
  sourceCanApply,
  onOpenSource,
  onOpenQr,
}: {
  sourceCanApply: boolean
  onOpenSource: () => void
  onOpenQr: () => void
}) {
  return (
    <div className="border-t border-neutral-100 px-6 pb-6 pt-3">
      {/* 能力门禁用 aria-disabled + 常显原因，不用原生 disabled（触屏无 hover，
          原生 disabled 还会让读屏跳过按钮、读不到原因）。真正的放行由上层
          onOpenSource / onOpenQr 内部的 `if (!sourceCanApply) return` 兜底。 */}
      {sourceCanApply ? null : (
        <p id="job-sticky-apply-blocked" className="mb-2 text-center text-sm text-neutral-500">
          {SOURCE_APPLY_UNAVAILABLE_REASON}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Button
          size="lg"
          className={`flex items-center gap-2${sourceCanApply ? '' : ' cursor-not-allowed opacity-50'}`}
          aria-disabled={!sourceCanApply || undefined}
          aria-describedby={sourceCanApply ? undefined : 'job-sticky-apply-blocked'}
          onClick={onOpenSource}
        >
          <ExternalLinkIcon className="h-4 w-4" />
          去来源平台投递
        </Button>
        <Button
          size="lg"
          variant="secondary"
          className={`flex items-center gap-2${sourceCanApply ? '' : ' cursor-not-allowed opacity-50'}`}
          aria-disabled={!sourceCanApply || undefined}
          aria-describedby={sourceCanApply ? undefined : 'job-sticky-apply-blocked'}
          onClick={onOpenQr}
        >
          <QrCodeIcon className="h-4 w-4" />
          扫码投递
        </Button>
      </div>
      <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-neutral-400">
        <InfoIcon className="h-3 w-3" />
        {sourceCanApply ? '扫码将跳转至来源平台办理，本系统不收取简历' : '来源平台未提供有效投递链接，请前往来源机构咨询'}
      </div>
    </div>
  )
}

function InfoRow({
  label,
  value,
  mono,
  wrap,
}: {
  label: string
  value: string
  mono?: boolean
  wrap?: boolean
}) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="shrink-0 text-neutral-400">{label}</span>
      <span className={[
        'text-right text-neutral-700',
        mono ? 'font-mono text-xs' : '',
        wrap ? 'break-all text-xs' : '',
      ].join(' ')}>
        {value}
      </span>
    </div>
  )
}
// 岗位摘要 — 职位核心信息摘要卡片
