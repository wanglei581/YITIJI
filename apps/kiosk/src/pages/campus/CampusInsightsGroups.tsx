import type { ElementType } from 'react'
import type { CampusRecruitmentSourceGroup, CampusRecruitmentStatsData } from '@ai-job-print/shared'
import { BuildingIcon, BriefcaseIcon, CalendarIcon, LayersIcon } from 'lucide-react'
import {
  FusionNotice,
  FusionSectionHead,
  FusionSourceMeta,
} from '../jobs/components/W4Presentation'

function MetricCard({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string
  value: number
  note?: string
  icon: ElementType
}) {
  return (
    <div className="jf-stat-card">
      <div className="k">
        <Icon aria-hidden="true" />
        {label}
      </div>
      <div className="v">{value.toLocaleString()}</div>
      {note ? <div className="note">{note}</div> : null}
    </div>
  )
}

function formatPeriod(period: string): string {
  const [year, month] = period.split('-')
  if (!year || !month) return period
  return `${year}年${Number(month)}月`
}

function jobCountNote(group: CampusRecruitmentSourceGroup): string | undefined {
  if (group.jobListingCount === 0 && group.fairPositionCount === 0) return undefined
  return `校招岗位 ${group.jobListingCount.toLocaleString()} · 场内岗位 ${group.fairPositionCount.toLocaleString()}`
}

export function CampusInsightsGroups({ data }: { data: CampusRecruitmentStatsData }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-6" data-kiosk-screen="campus-freshman-insights">
      <FusionNotice>
        {data.notes[0] ?? '本页只聚合已审核且已发布的校园招聘会与校招岗位。'}
        {data.truncated ? ` 本次按同步时间只统计最近 ${data.scanLimit} 条，不是全量。` : null}
      </FusionNotice>

      {data.groups.map((group) => (
        <article key={group.sourceOrgId} className="jf-card">
          <FusionSectionHead
            icon={BuildingIcon}
            title={group.sourceName}
            subtitle="学校 / 举办方来源机构"
          />
          <FusionSourceMeta sourceName={group.sourceName} syncTime={group.syncTime} />
          <div className="jf-stat-grid">
            <MetricCard label="招聘会场次" value={group.fairCount} icon={LayersIcon} />
            <MetricCard label="参会企业" value={group.companyCount} icon={BuildingIcon} />
            <MetricCard
              label="在招岗位"
              value={group.openJobCount}
              note={jobCountNote(group)}
              icon={BriefcaseIcon}
            />
            <MetricCard
              label="有场次的月份"
              value={group.timeDistribution.length}
              note={
                group.timeDistribution.length > 0
                  ? group.timeDistribution
                      .map((bucket) => `${formatPeriod(bucket.period)} ${bucket.fairCount} 场`)
                      .join(' · ')
                  : '该来源暂无已发布校园招聘会场次'
              }
              icon={CalendarIcon}
            />
          </div>
        </article>
      ))}
    </div>
  )
}
