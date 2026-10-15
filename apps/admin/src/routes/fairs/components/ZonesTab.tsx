import { Card } from '@ai-job-print/ui'
import { ZONE_CATEGORY_LABELS } from './shared'
import type { FairZoneView } from '../../../services/api/fairsAdmin'

/**
 * 招聘会「展区管理」页签（只读）。
 *
 * 3.15 起管理员不代改招聘会内容：新增 / 编辑 / 删除展区不论托管开关一律停放，
 * 完整可写版本在同目录 ZonesTabEditor.tsx（不被 import）。
 */
export function ZonesTab({ zones }: { zones: FairZoneView[] }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600">{zones.length} 个展区(按排序值升序展示)</p>

      {zones.length === 0 ? (
        <Card className="p-10 text-center text-xs text-neutral-400">暂无展区</Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {zones.map((z) => (
            <Card key={z.id} className="p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs text-neutral-500">#{z.sortOrder}</span>
                  <p className="truncate font-medium text-neutral-800">{z.name}</p>
                </div>
                <p className="mt-1 text-xs text-neutral-400">
                  {z.category ? ZONE_CATEGORY_LABELS[z.category] ?? z.category : '未分类'}
                  {z.city ? ` · ${z.city}` : ''}
                </p>
                {z.description && <p className="mt-1.5 line-clamp-2 text-xs text-neutral-500">{z.description}</p>}
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-neutral-400">
        展区由招聘会的发布机构维护，本平台不代为新增或修改。展区信息用于一体机"展位导览"页展示；当前未建展位(booth)级数据模型,导览图展示展区列表与底图,不含展位坐标。
      </p>
    </div>
  )
}
