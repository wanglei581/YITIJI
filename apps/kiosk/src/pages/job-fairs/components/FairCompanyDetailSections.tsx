import { useState } from 'react'
import type { FairCompanyDTO, FairCompanyPositionDTO } from '@ai-job-print/shared'
import { COMPANY_SCALE_LABELS } from '../../../types/fair'
import {
  AwardIcon,
  BriefcaseIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ExternalLinkIcon,
  FilterIcon,
  GraduationCapIcon,
  InfoIcon,
  LayoutGridIcon,
  ListIcon,
  MapPinIcon,
  PrinterIcon,
  QrCodeIcon,
  SmartphoneIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react'
import { SourceUrlQr } from '../../../components/SourceUrlQr'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ViewMode = 'list' | 'poster'

export interface Filters {
  location:     string
  education:    string
  experience:   string
  positionType: string
}

export interface PrintFile {
  name:  string
  size:  string
  pages: number
}

// ─── Position type constants ──────────────────────────────────────────────────

const POSITION_TYPE_LABELS: Record<string, string> = {
  full_time: '全职',
  part_time: '兼职',
  intern:    '实习',
}
// ─── QR overlay ───────────────────────────────────────────────────────────────

export function QrOverlay({
  companyName,
  sourceUrl,
  onClose,
}: {
  companyName: string
  sourceUrl: string | undefined
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="relative w-[340px] rounded-2xl bg-white p-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-neutral-400 hover:bg-neutral-100"
        >
          <XIcon className="h-5 w-5" />
        </button>
        <p className="text-center text-base font-semibold text-neutral-800">扫码前往来源平台</p>
        <p className="mt-1 text-center text-xs text-neutral-400">{companyName}</p>
        <div className="mt-5 flex justify-center">
          <SourceUrlQr value={sourceUrl} size={180} />
        </div>
        <div className="mt-5 flex items-start gap-2 rounded-lg bg-primary-50 px-3 py-2.5">
          <SmartphoneIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" />
          <p className="text-xs leading-relaxed text-neutral-600">
            请使用手机扫描二维码，前往来源平台完成投递。本系统不接收简历，不参与招聘闭环。
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Cover area ───────────────────────────────────────────────────────────────

export function CoverArea({ company }: { company: FairCompanyDTO }) {
  const totalHeadcount = company.positions.reduce((s, p) => s + p.headcount, 0)

  return (
    <section className="jf-card accented">
      <div className="flex items-start gap-5">
        <span className="jf-company-logo">{company.companyName.slice(0, 1)}</span>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-[38px] font-black leading-tight text-[var(--ink)]">{company.companyName}</h2>
          <p className="mt-2 text-[21px] text-[var(--muted)]">{company.industry} · {COMPANY_SCALE_LABELS[company.scale]}</p>
          {company.honorTags && company.honorTags.length > 0 && (
            <div className="jf-meta-chips mt-4">
              {company.honorTags.map((tag) => (
                <span key={tag} className="jf-chip ok">
                  <AwardIcon aria-hidden="true" />
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        {company.boothNumber && (
          <div className="jf-booth-tag">
            <div className="k">展位</div>
            <b>{company.boothNumber}</b>
          </div>
        )}
      </div>

      <div className="jf-row-info mt-5">
        <span>
          <BriefcaseIcon aria-hidden="true" />
          {company.positions.length} 个岗位
        </span>
        <span>
          <UsersIcon aria-hidden="true" />
          共招 {totalHeadcount} 人
        </span>
        {company.zoneName && (
          <span>
            <MapPinIcon aria-hidden="true" />
            {company.zoneName}
          </span>
        )}
      </div>
    </section>
  )
}

// ─── Company info card ────────────────────────────────────────────────────────

export function CompanyInfoCard({ company }: { company: FairCompanyDTO }) {
  const [expanded, setExpanded] = useState(false)
  const descLong = (company.description?.length ?? 0) > 100

  return (
    <section className="jf-card">
      <div className="jf-kv3">
        {company.founded && (
          <div className="jf-kv">
            <div className="k">成立时间</div>
            <div className="v">成立 {company.founded} 年</div>
          </div>
        )}
        {company.headquarters && (
          <div className="jf-kv">
            <div className="k">总部</div>
            <div className="v">{company.headquarters}</div>
          </div>
        )}
        {company.registeredCapital && (
          <div className="jf-kv">
            <div className="k">注册资本</div>
            <div className="v">{company.registeredCapital}</div>
          </div>
        )}
      </div>

      {company.description && (
        <div className="mt-3">
          <p className={['text-[20px] leading-relaxed text-[var(--muted)]', !expanded && descLong ? 'line-clamp-3' : ''].join(' ')}>
            {company.description}
          </p>
          {descLong && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="mt-3 flex items-center gap-1 text-[18px] font-semibold text-[var(--accent-deep)]"
            >
              {expanded
                ? <><ChevronUpIcon className="h-3.5 w-3.5" />收起</>
                : <><ChevronDownIcon className="h-3.5 w-3.5" />展开全文</>}
            </button>
          )}
        </div>
      )}

      {company.sourceUrl && (
        <div className="mt-4 flex items-center gap-2 border-t border-[var(--line)] pt-4 text-[17px] text-[var(--muted)]">
          <InfoIcon className="h-3.5 w-3.5 shrink-0" />
          <span>数据来自合作平台 · 仅供展示参考</span>
          <ExternalLinkIcon className="ml-auto h-3.5 w-3.5 shrink-0 text-primary-400" />
        </div>
      )}
    </section>
  )
}

// ─── Action bar ───────────────────────────────────────────────────────────────

interface ActionBarProps {
  sourceCanApply:   boolean
  onScanQr:         () => void
  onOpenSource:     () => void
  onPrintProfile:   () => void
  onPrintPositions: () => void
}

export function ActionBar({ sourceCanApply, onScanQr, onOpenSource, onPrintProfile, onPrintPositions }: ActionBarProps) {
  return (
    <section className="jf-action-zone company">
      <div className="jf-qr-panel">
        <div className="jf-qr-box" aria-hidden="true" />
        <div className="qr-title">来源平台入口</div>
        <div className="qr-sub">扫码或前往来源平台办理岗位投递</div>
      </div>
      <div className="jf-next-grid">
        <button type="button" className="jf-tile tinted" onClick={onScanQr} disabled={!sourceCanApply}>
          <span className="jf-tile-icon"><QrCodeIcon aria-hidden="true" /></span>
          <span><b>扫码投递</b><span>手机扫码前往来源平台</span></span>
        </button>
        <button type="button" className="jf-tile" onClick={onOpenSource} disabled={!sourceCanApply}>
          <span className="jf-tile-icon"><ExternalLinkIcon aria-hidden="true" /></span>
          <span><b>去来源平台投递</b><span>系统不接收简历</span></span>
        </button>
        <button type="button" className="jf-tile" onClick={onPrintProfile}>
          <span className="jf-tile-icon"><PrinterIcon aria-hidden="true" /></span>
          <span><b>打印企业资料</b><span>用于现场咨询准备</span></span>
        </button>
        <button type="button" className="jf-tile" onClick={onPrintPositions}>
          <span className="jf-tile-icon"><PrinterIcon aria-hidden="true" /></span>
          <span><b>打印岗位清单</b><span>按需打印本企业岗位</span></span>
        </button>
      </div>
    </section>
  )
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

interface FilterBarProps {
  positions: FairCompanyPositionDTO[]
  filters: Filters
  viewMode: ViewMode
  onFilter: (f: Partial<Filters>) => void
  onViewMode: (v: ViewMode) => void
}

export function FilterBar({ positions, filters, viewMode, onFilter, onViewMode }: FilterBarProps) {
  const locations   = ['不限', ...Array.from(new Set(positions.map((p) => p.location).filter((l): l is string => !!l)))]
  const educations  = ['不限', '大专及以上', '本科及以上', '硕士及以上']
  const experiences = ['不限', '应届生', '1年以上', '3年以上', '5年以上']
  const typeOptions = [
    { value: '不限',      label: '不限' },
    { value: 'full_time', label: '全职' },
    { value: 'part_time', label: '兼职' },
    { value: 'intern',    label: '实习' },
  ]

  const ChipRow = ({ label, opts, fk }: { label: string; opts: string[]; fk: keyof Filters }) => (
      <div className="flex items-center gap-2">
        <span className="jf-filter-label w-12 shrink-0">{label}</span>
        <div className="flex gap-2 overflow-x-auto pb-0.5">
        {opts.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onFilter({ [fk]: opt })}
            className={`jf-f-chip sm ${filters[fk] === opt ? 'on' : ''}`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <section className="jf-card compact">
      <div className="mb-4 flex items-center gap-3">
        <FilterIcon className="h-6 w-6 text-[var(--accent-deep)]" />
        <span className="text-[22px] font-semibold text-[var(--ink)]">筛选岗位</span>
        <div className="ml-auto flex rounded-xl border border-[var(--line)] bg-[var(--paper)] p-1">
          <button
            type="button"
            onClick={() => onViewMode('list')}
            className={['rounded-lg p-2 transition-colors', viewMode === 'list' ? 'bg-[var(--dark)] text-[var(--paper)]' : 'text-[var(--muted)]'].join(' ')}
            title="列表视图"
          >
            <ListIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onViewMode('poster')}
            className={['rounded-lg p-2 transition-colors', viewMode === 'poster' ? 'bg-[var(--dark)] text-[var(--paper)]' : 'text-[var(--muted)]'].join(' ')}
            title="海报视图"
          >
            <LayoutGridIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <ChipRow label="城市" opts={locations} fk="location" />
        <ChipRow label="学历" opts={educations} fk="education" />
        <ChipRow label="经验" opts={experiences} fk="experience" />
        <div className="flex items-center gap-2">
          <span className="jf-filter-label w-12 shrink-0">类型</span>
          <div className="flex gap-2">
            {typeOptions.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => onFilter({ positionType: value })}
                className={`jf-f-chip sm ${filters.positionType === value ? 'on' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Position list view ───────────────────────────────────────────────────────

export function PositionListView({ positions, companyName }: { positions: FairCompanyPositionDTO[]; companyName: string }) {
  if (positions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-neutral-200 py-12 text-center">
        <BriefcaseIcon className="h-8 w-8 text-neutral-200" />
        <p className="text-sm text-neutral-400">暂无匹配岗位</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {positions.map((pos) => (
        <div key={pos.id} className="jf-job-row">
          <div className="j-top">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <b>{pos.title}</b>
                {pos.positionType && (
                  <span className="jf-kind">
                    {POSITION_TYPE_LABELS[pos.positionType] ?? pos.positionType}
                  </span>
                )}
              </div>
            </div>
            <span className="salary">{pos.salary ?? '薪资面议'}</span>
          </div>
          <div className="j-meta">
            <span>招 {pos.headcount} 人</span>
            {pos.location && <span className="flex items-center gap-0.5"><MapPinIcon className="h-3 w-3" />{pos.location}</span>}
            {pos.education && <span className="flex items-center gap-0.5"><GraduationCapIcon className="h-3 w-3" />{pos.education}</span>}
            {pos.experience && <span>{pos.experience}</span>}
            {pos.department && <span className="text-neutral-400">/ {pos.department}</span>}
          </div>
          {pos.requirements && <p className="mt-3 text-[17px] leading-relaxed text-[var(--muted)]">{pos.requirements}</p>}
          <p className="mt-2 text-right text-[15px] text-[var(--muted)]">来源：{companyName}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Position poster view ─────────────────────────────────────────────────────

export function PositionPosterView({ positions, companyName, industry }: { positions: FairCompanyPositionDTO[]; companyName: string; industry: string }) {
  const posterGradient: Record<string, string> = {
    '互联网/软件': 'from-primary-700 to-primary-500',
    '金融/财务':  'from-success-fg to-success',
    '制造/工程':  'from-warning-fg to-warning-fg',
    '政事业':     'from-plum to-plum',
    '教育/医疗':  'from-primary-700 to-primary-500',
    '产品/技术':  'from-plum to-plum',
    '数据/AI':    'from-info-fg to-info',
    '运营/市场':  'from-error-fg to-error-fg',
  }
  const gradient = posterGradient[industry] ?? 'from-neutral-600 to-neutral-500'

  if (positions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-neutral-200 py-12 text-center">
        <BriefcaseIcon className="h-8 w-8 text-neutral-200" />
        <p className="text-sm text-neutral-400">暂无匹配岗位</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {positions.map((pos) => (
        <div key={pos.id} className={`flex flex-col rounded-xl bg-gradient-to-br ${gradient} overflow-hidden`}>
          <div className="px-4 pt-4 pb-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-white/60">{companyName}</p>
            <p className="mt-1 text-base font-bold leading-snug text-white">{pos.title}</p>
            {pos.positionType && (
              <span className="mt-1 inline-block rounded-full bg-white/20 px-2 py-0.5 text-[10px] text-white">
                {POSITION_TYPE_LABELS[pos.positionType] ?? pos.positionType}
              </span>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-1.5 bg-white/10 px-4 py-3 text-xs text-white/90">
            <p className="text-sm font-semibold text-white">{pos.salary ?? '薪资面议'}</p>
            <p>招 {pos.headcount} 人</p>
            {pos.education && <p>{pos.education}</p>}
            {pos.experience && <p>{pos.experience}</p>}
            {pos.location && (
              <p className="flex items-center gap-1">
                <MapPinIcon className="h-3 w-3" />
                {pos.location}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 bg-black/10 px-4 py-2">
            <QrCodeIcon className="h-3.5 w-3.5 text-white/50" />
            <p className="text-[10px] text-white/50">扫码查看 · 去来源平台投递</p>
          </div>
        </div>
      ))}
    </div>
  )
}
