import { ContentTrustCell } from './ContentTrustCell'
import { formatDate, formatDateTime, formatCount, PARTNER_TYPE_LABELS, SCENE_TEMPLATE_LABELS, type PartnerType, type SceneTemplate } from '@ai-job-print/shared'
import { ConsoleTable, StatusBadge, type ConsoleColumn } from '@ai-job-print/ui'
import type { AdminOrgListItem } from '../../services/api/orgsAdmin'
import { moduleLabel, contactPhoneText } from './orgPresentation'
import { TwoStepButton } from './orgFormParts'

interface Props {
  items: AdminOrgListItem[]; total: number; page: number; pageSize: number; search: string
  onPageChange: (page: number) => void; onPageSizeChange: (size: number) => void
  showRecruitment: boolean; onDetail: (id: string) => void
  onToggle: (org: AdminOrgListItem) => Promise<void>; busyId: string | null
}

export function PartnerTable({ showRecruitment, onDetail, onToggle, busyId, search, ...table }: Props) {
  const modules = (org: AdminOrgListItem) => org.enabledModules.map((m) => moduleLabel(m, showRecruitment)).join(' · ') || '—'
  const columns: ConsoleColumn<AdminOrgListItem>[] = [
    { id: 'name', header: '机构名称', headerClassName: 'w-[22%]', cell: (o) => <div title={o.name} className="line-clamp-2 min-w-36 font-medium text-neutral-800">{o.name}</div> },
    { id: 'type', header: '机构类型 / 场景', cell: (o) => <div className="space-y-1 text-xs">
      <p title={PARTNER_TYPE_LABELS[o.type as PartnerType] ?? o.type} className="max-w-32 truncate">{PARTNER_TYPE_LABELS[o.type as PartnerType] ?? o.type}</p>
      <p className="text-neutral-400">{o.sceneTemplate ? SCENE_TEMPLATE_LABELS[o.sceneTemplate as SceneTemplate] ?? o.sceneTemplate : '未设置'}</p>
    </div> },
    { id: 'modules', header: '启用模块', title: modules, truncate: true, cell: (o) => <span className="block max-w-24 truncate text-xs text-neutral-500">{modules(o)}</span> },
    { id: 'contact', header: '联系人', cell: (o) => <div className="text-xs"><p title={o.contact ?? undefined} className="max-w-20 truncate">{o.contact ?? '—'}</p><p className="mt-1 whitespace-nowrap font-mono text-neutral-400">{contactPhoneText(o.contactPhone)}</p></div> },
    { id: 'status', header: '状态 / 内容可信', cell: (o) => <div className="space-y-1"><StatusBadge dot status={o.enabled ? 'success' : 'error'} label={o.enabled ? '合作中' : '已停用'} /><ContentTrustCell status={o.contentTrustStatus} archived={o.archived} /></div> },
    { id: 'counts', header: '接入数量', cell: (o) => <div className="whitespace-nowrap text-xs text-neutral-500">
      <p>账号 {formatCount(o.counts.accounts)}</p><p>数据源 {formatCount(o.counts.sources)}</p>
      {showRecruitment && <><p>岗位 {formatCount(o.counts.jobs)}</p><p>招聘会 {formatCount(o.counts.fairs)}</p></>}
    </div> },
    { id: 'date', header: '加入时间', cellClassName: 'whitespace-nowrap text-xs text-neutral-500', cell: (o) => <span title={formatDateTime(o.createdAt)}>{formatDate(o.createdAt)}</span> },
    { id: 'actions', header: '操作', sticky: true, align: 'right', cell: (o) => <div className="flex flex-col items-end gap-1">
      <button onClick={() => onDetail(o.id)} className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">详情/账号</button>
      <TwoStepButton key={o.id} label={o.enabled ? '停用' : '启用'} confirmLabel={o.enabled ? '确认停用?' : '确认启用?'}
        className={o.enabled ? 'text-warning-fg hover:bg-warning-bg' : 'text-success-fg hover:bg-success-bg'}
        confirmClassName={o.enabled ? 'bg-warning text-white' : 'bg-success text-white'} onConfirm={() => void onToggle(o)} disabled={busyId === o.id} />
    </div> },
  ]
  const widths: Record<string, string> = { name: 'w-[22%]', type: 'w-[14%]', modules: 'w-[10%]', contact: 'w-[12%]', status: 'w-[12%]', counts: 'w-[11%]', date: 'w-[10%]', actions: 'w-[9%]' }
  const compactColumns = columns.map((c) => ({ ...c, headerClassName: `${c.headerClassName ?? ''} !px-2 ${widths[c.id]}`, cellClassName: `${c.cellClassName ?? ''} !px-2` }))
  return <ConsoleTable {...table} columns={compactColumns} scrollX={false} className="[&_table]:table-fixed"
    empty={{ title: search ? '未找到匹配的机构' : '暂无合作机构', description: search ? '请尝试其他关键词' : '点击右上角"新增机构"录入第一家合作机构' }} />
}
