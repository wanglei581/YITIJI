// AI 服务记录（C-2D）：解析 / 优化 / 生成 如实区分（generate 绝不展示为「简历解析」）。
// 删除：两步确认 → DELETE /me/ai-records/:id（硬删；parse 级联删同任务 optimize 行，
// 服务端审计留痕）。删除后简历组可能联动变化 → 由父级回调一并刷新。

import type { MemberAiRecordItem } from '@ai-job-print/shared'
import { SparklesIcon } from 'lucide-react'
import { useAuth } from '../../../auth/useAuth'
import { deleteMyAiRecord } from '../../../services/api/memberAssets'
import { AI_KIND_LABEL, aiStatusLabel, formatTime } from './format'
import { AssetGroupShell, AssetRow, TwoStepDeleteButton } from './ui'
import type { AssetGroupHandle } from './useMemberAssetGroups'

export function AiRecordsGroup({
  group,
  onDeleted,
  onToast,
}: {
  group: AssetGroupHandle<MemberAiRecordItem>
  /** 删除成功后回调（父级刷新简历组：级联删除可能摘掉 parse/optimize 行） */
  onDeleted: (record: MemberAiRecordItem) => void
  onToast: (msg: string) => void
}) {
  const { getToken } = useAuth()

  const remove = async (record: MemberAiRecordItem) => {
    const token = getToken()
    if (!token) return
    try {
      const res = await deleteMyAiRecord(token, record.id)
      if (res.deletedCount > 1) {
        // parse 级联删了同任务 optimize 行：本地摘单行会留下幽灵行，整组重载
        group.reload()
      } else {
        group.removeLocal(record.id)
      }
      onDeleted(record)
      onToast(res.deletedCount > 1 ? 'AI 记录已删除（含派生的优化记录）' : 'AI 记录已删除')
    } catch {
      onToast('删除失败，请稍后重试')
    }
  }

  return (
    <AssetGroupShell
      title="AI 服务记录"
      group={group}
      empty="暂无 AI 服务记录"
      renderRow={(a) => (
        <AssetRow
          key={a.id}
          icon={SparklesIcon}
          iconBg="bg-violet-50"
          iconColor="text-violet-600"
          name={`${AI_KIND_LABEL[a.kind] ?? a.kind} · ${aiStatusLabel(a.status)}`}
          meta={formatTime(a.createdAt)}
        >
          <TwoStepDeleteButton title="删除记录" onConfirm={() => void remove(a)} />
        </AssetRow>
      )}
    />
  )
}
