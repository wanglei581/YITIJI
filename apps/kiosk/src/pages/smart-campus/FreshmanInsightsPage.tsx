// ============================================================
// FreshmanInsightsPage — 校园大数据（/smart-campus/freshman-insights）
//
// 校园大数据本期严格冻结：需取得学校书面授权 + 数据处理协议、且只接聚合脱敏统计后
// 才会解冻。在此之前本页绝不展示任何统计数字（含示例 / 演示 / 假数据）。
//
// 入口侧：bigdata 子模块开关在后端被强制落 false（smart-campus.service.ts），
// 因此正常路径下首页 / 智慧校园专区都不会出现「校园大数据」入口。
// 本页仅用于「直达 URL 兜底」：任何人手动访问该地址，只能看到“未开放”的真实状态，
// 不会被误导为已上线，也拿不到任何数据。
//
// 合规（compliance-boundary.md §九）：不读写任何学生数据，不在本终端采集任何个人信息，
// 无任何招聘闭环语义。
// ============================================================

import { Button, Card } from '@ai-job-print/ui'
import { useNavigate } from 'react-router-dom'
import { LockIcon, ShieldCheckIcon } from 'lucide-react'

export function FreshmanInsightsPage() {
  const navigate = useNavigate()

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-canvas p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">校园大数据</h1>
          <p className="mt-0.5 text-sm text-gray-500">迎新报到聚合统计</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => navigate('/smart-campus')}>
          返回
        </Button>
      </div>

      <Card className="flex flex-col items-center justify-center gap-4 p-10 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
          <LockIcon className="h-8 w-8 text-gray-400" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">校园大数据暂未开放</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-500">
            该功能需在取得学校书面授权与数据处理协议、且仅接入聚合脱敏统计后才会开放。
            开放前本终端不展示任何统计数据，也不采集任何个人信息。
          </p>
        </div>
        <Button size="lg" onClick={() => navigate('/smart-campus')}>
          返回智慧校园
        </Button>
      </Card>

      <div className="mt-5 flex items-start gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
        <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-indigo-900">
          合规边界：校园大数据若上线，仅展示<span className="font-semibold">聚合统计</span>，绝不含任何个人身份信息，
          也不在本终端采集任何个人信息。
        </p>
      </div>

      <div className="h-2" />
    </div>
  )
}
