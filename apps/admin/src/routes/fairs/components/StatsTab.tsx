import { Card, LoadingState } from '@ai-job-print/ui'
import { BuildingIcon, FileTextIcon, MapPinIcon, PrinterIcon } from 'lucide-react'
import { type AdminFairStats } from '../../../services/api/fairsAdmin'

export function StatsTab({ stats }: { stats: AdminFairStats | null }) {
  if (!stats) return <LoadingState className="py-16" />
  const cards = [
    { label: '参展企业(已录入)', value: stats.companyTotal,        note: '本系统已录入的企业卡片数',  icon: BuildingIcon,  accent: 'text-blue-600 bg-blue-50' },
    { label: '展区',             value: stats.zoneTotal,           note: '导览展区数量',              icon: MapPinIcon,    accent: 'text-teal-600 bg-teal-50' },
    { label: '活动资料',         value: stats.materialTotal,       note: `已发布 ${stats.materialPublished} 份`, icon: FileTextIcon, accent: 'text-purple-600 bg-purple-50' },
    { label: '资料打印次数',     value: stats.materialPrintCount,  note: '一体机打印活动资料次数',    icon: PrinterIcon,   accent: 'text-orange-500 bg-orange-50' },
  ]
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map(({ label, value, note, icon: Icon, accent }) => (
          <Card key={label} className="p-4">
            <div className={`w-fit rounded-lg p-2 ${accent}`}>
              <Icon className="h-4 w-4" />
            </div>
            <p className="mt-3 text-xl font-bold text-gray-900">{value}</p>
            <p className="mt-0.5 text-xs font-medium text-gray-500">{label}</p>
            <p className="mt-0.5 text-xs text-gray-400">{note}</p>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <p className="mb-2 text-sm font-medium text-gray-700">来源同步快照(仅供参考,非本系统统计)</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-gray-50 p-3 text-center">
            <p className="text-lg font-bold text-gray-800">{stats.snapshot.companyCount}</p>
            <p className="text-xs text-gray-500">来源标称企业数</p>
          </div>
          <div className="rounded-lg bg-gray-50 p-3 text-center">
            <p className="text-lg font-bold text-gray-800">{stats.snapshot.jobCount}</p>
            <p className="text-xs text-gray-500">来源标称岗位数</p>
          </div>
          <div className="rounded-lg bg-gray-50 p-3 text-center">
            <p className="text-lg font-bold text-gray-800">{stats.snapshot.viewCount}</p>
            <p className="text-xs text-gray-500">终端浏览次数</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          系统仅统计服务行为(录入 / 浏览 / 打印),不记录求职者个人信息,不参与招聘闭环。现场签到 / 展位入驻未建数据模型,此处不展示估算数据。
        </p>
      </Card>
    </div>
  )
}
