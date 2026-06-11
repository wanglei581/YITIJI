// ============================================================
// 账号资产面板（Phase C-2D，从 ProfilePage 拆出）
//
// 六个资产组各自独立加载 / 失败重试 / 游标翻页（useMemberAssetGroups），
// 不再单个 Promise.all 绑死。会员操作（查看 / 导出 / 再打印 / 删除）在各组内实现，
// 全部凭本人会员 token，归属由后端 EndUserAuthGuard + endUserId 过滤校验。
// ============================================================

import { AiRecordsGroup } from './AiRecordsGroup'
import { BenefitsGroup } from './BenefitsGroup'
import { DocumentsGroup } from './DocumentsGroup'
import { FavoritesGroup } from './FavoritesGroup'
import { PrintOrdersGroup } from './PrintOrdersGroup'
import { ResumesGroup } from './ResumesGroup'
import type { MemberAssetGroups } from './useMemberAssetGroups'

export function AccountAssetsPanel({
  groups,
  onToast,
  cardSurface,
}: {
  groups: MemberAssetGroups
  onToast: (msg: string) => void
  cardSurface: string
}) {
  return (
    <section aria-label="账号资产" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-gray-500">账号资产</h2>
        <span className="text-xs text-gray-400">本人 · 留存期内可见</span>
      </div>
      <div className={`${cardSurface} px-4`}>
        <ResumesGroup group={groups.resumes} />
        <DocumentsGroup group={groups.documents} onToast={onToast} />
        <AiRecordsGroup
          group={groups.aiRecords}
          onToast={onToast}
          // 级联：删 parse 时同任务 optimize 行一并被服务端删除 → 简历组联动刷新
          onDeleted={() => groups.resumes.reload()}
        />
        <PrintOrdersGroup group={groups.printOrders} />
        <FavoritesGroup group={groups.favorites} onToast={onToast} />
        <BenefitsGroup group={groups.benefits} />
      </div>
    </section>
  )
}
