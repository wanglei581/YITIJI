import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import type { FairLiveStatsDTO } from '@ai-job-print/shared'
import {
  ActivityIcon,
  BriefcaseIcon,
  BuildingIcon,
  PrinterIcon,
  QrCodeIcon,
  ScanIcon,
  TrendingUpIcon,
  UsersIcon,
} from 'lucide-react'
import { getFairStats } from '../../services/api'

function BigStat({
  label,
  value,
  note,
  icon: Icon,
  accent,
}: {
  label: string
  value: string | number
  note?: string
  icon: React.ElementType
  accent: string
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className={`rounded-lg p-2 ${accent}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-3 text-2xl font-bold text-gray-900">{value}</p>
      <p className="mt-0.5 text-xs font-medium text-gray-500">{label}</p>
      {note && <p className="mt-0.5 text-xs text-gray-400">{note}</p>}
    </Card>
  )
}

export function FairStatsPage() {
  const navigate = useNavigate()
  const { id }   = useParams<{ id: string }>()
  const fairId   = id ?? ''

  const [stats,   setStats]   = useState<FairLiveStatsDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    let cancelled = false
    getFairStats(fairId)
      .then((res) => {
        if (cancelled) return
        if (res.data) setStats(res.data)
        else setError(true)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fairId])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">加载中...</p>
      </div>
    )
  }

  if (error || !stats) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <ActivityIcon className="h-12 w-12 text-gray-200" />
        <p className="text-sm text-gray-400">暂无统计数据</p>
        <Button variant="secondary" onClick={() => navigate(`/job-fairs/${fairId}`)}>返回详情</Button>
      </div>
    )
  }

  const checkinRate = stats.totalCompanies > 0
    ? Math.round((stats.checkedInCompanies / stats.totalCompanies) * 100)
    : 0

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-6">
        <PageHeader
          title="现场数据"
          subtitle={`${stats.fairName} · 准实时数据`}
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate(`/job-fairs/${fairId}`)}>
              返回详情
            </Button>
          }
        />
        <p className="mt-1 text-xs text-gray-400">
          数据更新于 {formatTime(stats.lastUpdated)} · 系统仅记录服务数据，不记录求职者个人信息
        </p>
        {stats.isMockData && (
          <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            当前为模拟数据，真实数据将在 Phase 7 接入 API 后替换
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        <div className="grid grid-cols-2 gap-3">
          <BigStat
            label="参展企业"
            value={stats.totalCompanies}
            note={`已签到 ${stats.checkedInCompanies}`}
            icon={BuildingIcon}
            accent="bg-blue-50 text-blue-600"
          />
          <BigStat
            label="招聘岗位"
            value={stats.totalPositions}
            note={`合计 ${stats.totalHeadcount} 人次`}
            icon={BriefcaseIcon}
            accent="bg-green-50 text-green-600"
          />
        </div>

        <Card className="p-5">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <TrendingUpIcon className="h-4 w-4 text-gray-400" />
            服务数据统计
            <span className="ml-auto text-xs font-normal text-gray-400">（系统服务行为，不含求职者信息）</span>
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-gray-50 p-3 text-center">
              <ScanIcon className="mx-auto h-5 w-5 text-gray-400" />
              <p className="mt-1.5 text-xl font-bold text-gray-900">{stats.browseCount}</p>
              <p className="mt-0.5 text-xs text-gray-500">信息浏览</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 text-center">
              <QrCodeIcon className="mx-auto h-5 w-5 text-gray-400" />
              <p className="mt-1.5 text-xl font-bold text-gray-900">{stats.scanCount}</p>
              <p className="mt-0.5 text-xs text-gray-500">二维码展示</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 text-center">
              <PrinterIcon className="mx-auto h-5 w-5 text-gray-400" />
              <p className="mt-1.5 text-xl font-bold text-gray-900">{stats.printCount}</p>
              <p className="mt-0.5 text-xs text-gray-500">资料打印</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 text-center">
              <UsersIcon className="mx-auto h-5 w-5 text-gray-400" />
              <p className="mt-1.5 text-xl font-bold text-gray-900">{stats.checkinCount}</p>
              <p className="mt-0.5 text-xs text-gray-500">现场签到</p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">企业签到进度</p>
            <span className="text-sm font-semibold text-green-600">{checkinRate}%</span>
          </div>
          <div className="h-3 rounded-full bg-gray-100">
            <div
              className="h-3 rounded-full bg-green-400 transition-all"
              style={{ width: `${checkinRate}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-gray-400">
            {stats.checkedInCompanies} / {stats.totalCompanies} 家企业已签到入场
          </p>

          {stats.zoneBreakdown.length > 0 && (
            <div className="mt-4 space-y-2">
              {stats.zoneBreakdown.map((zone) => {
                const rate = zone.boothCount > 0
                  ? Math.round((zone.checkedInCount / zone.boothCount) * 100)
                  : 0
                return (
                  <div key={zone.id}>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>{zone.zoneName}</span>
                      <span>{zone.checkedInCount}/{zone.boothCount}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-gray-100">
                      <div
                        className="h-1.5 rounded-full bg-primary-400"
                        style={{ width: `${rate}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
