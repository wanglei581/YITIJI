import { useCallback, useEffect, useState } from 'react'
import { Card, ErrorState, LoadingState } from '@ai-job-print/ui'
import type { FairVenueFacilityType, FairVenueGuideDTO } from '@ai-job-print/shared'
import { DoorOpenIcon, InfoIcon, MapIcon, MessageCircleQuestionIcon, PrinterIcon } from 'lucide-react'
import { fairsAdminService } from '../../services/api/fairsAdmin'

// ============================================================
// 场馆导览 Tab(Admin，只读):展厅(A/B/C 厅) / 企业展位绑定 / 设施点位。
// 3.15 起管理员不代改招聘会内容：配置、保存、删除导览不论托管开关一律停放，
// 完整可写版本在同目录 VenueGuideTabEditor.tsx（不被 import）。
// 合规:仅会场位置导览与信息展示,不涉及任何投递/收简历闭环。
// ============================================================

const FACILITY_ICONS: Record<FairVenueFacilityType, React.ElementType> = {
  entrance: DoorOpenIcon,
  serviceDesk: InfoIcon,
  printPoint: PrinterIcon,
  consulting: MessageCircleQuestionIcon,
}

const HALL_COLORS = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-orange-500', 'bg-cyan-600', 'bg-rose-500']

const READ_ONLY_NOTE = '当前只读：场馆导览由招聘会的发布机构维护，本平台不代为配置、保存或删除。'

export function VenueGuideTab({ fairId }: { fairId: string }) {
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  /** null = 尚未配置(空态) */
  const [guide, setGuide] = useState<FairVenueGuideDTO | null>(null)

  const load = useCallback(async () => {
    setState('loading')
    try {
      const { data } = await fairsAdminService.getVenueGuide(fairId)
      setGuide(data)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [fairId])

  useEffect(() => { void load() }, [load])

  if (state === 'loading') return <LoadingState className="py-16" />
  if (state === 'error') return <ErrorState className="py-16" onRetry={() => void load()} />

  if (!guide) {
    return (
      <Card className="flex flex-col items-center gap-4 py-14 text-center">
        <MapIcon className="h-10 w-10 text-neutral-300" aria-hidden="true" />
        <div>
          <p className="text-base font-semibold text-neutral-700">该招聘会尚未配置场馆导览</p>
          <p className="mt-1 text-xs text-neutral-400">{READ_ONLY_NOTE}</p>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* 预览条:A/B/C 厅 + 企业数 */}
      <Card className="p-4">
        <p className="mb-3 text-sm font-medium text-neutral-700">布局预览</p>
        <div className="flex flex-wrap items-end gap-3">
          {guide.halls.length === 0 ? (
            <p className="text-xs text-neutral-400">暂无展厅</p>
          ) : (
            guide.halls.map((h, i) => (
              <div key={h.hallId} className="text-center">
                <div className={`flex h-16 w-24 flex-col items-center justify-center rounded-xl text-white shadow-sm ${HALL_COLORS[i % HALL_COLORS.length]}`}>
                  <p className="text-lg font-bold">{h.hallCode.toUpperCase() || '?'}</p>
                  <p className="text-[10px] opacity-90">{h.companies.length} 家企业</p>
                </div>
                <p className="mt-1 max-w-24 truncate text-[10px] text-neutral-500">{h.industryCategory || h.hallName}</p>
              </div>
            ))
          )}
          {guide.facilities.length > 0 && (
            <div className="ml-2 flex flex-wrap gap-1.5 self-center">
              {guide.facilities.map((f) => {
                const Icon = FACILITY_ICONS[f.type] ?? InfoIcon
                return (
                  <span key={f.id} className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-1 text-[10px] text-neutral-600">
                    <Icon className="h-3 w-3" />{f.name}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      </Card>

      <Card className="space-y-2 p-4 text-sm text-neutral-600">
        <p>场馆：{guide.venueName || '—'}</p>
        <ul className="space-y-1 text-xs text-neutral-500">
          {guide.halls.map((h) => (
            <li key={h.hallId}>
              {h.hallCode.toUpperCase()} · {h.hallName}（{h.companies.length} 家企业{h.boothRange ? ` · 展位 ${h.boothRange}` : ''}）
            </li>
          ))}
        </ul>
        <p className="text-xs text-neutral-400">{READ_ONLY_NOTE}</p>
      </Card>

      <p className="text-xs text-neutral-400">
        合规说明:场馆导览仅用于会场位置与展区信息展示;企业绑定来自本招聘会参展企业,系统不接收求职者简历,不参与招聘闭环。
      </p>
    </div>
  )
}
