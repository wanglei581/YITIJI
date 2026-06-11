// 我的收藏（C-2D）：岗位 / 招聘会 / 政策 的兴趣标记（仅浏览/收藏，不含投递/预约结果）。
// - 查看：job/job_fair 跳详情页；policy 跳政策服务页。
// - 取消收藏：服务端幂等删除后本地摘行。
// - 合并本机收藏：登录后显式触发（服务端 upsert 幂等去重，不覆盖账号已有收藏；
//   合并成功的本机记录清除，失败的保留下次再试）。

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MemberFavoriteItem } from '@ai-job-print/shared'
import { ExternalLinkIcon, Loader2Icon, UploadIcon } from 'lucide-react'
import { useAuth } from '../../../auth/useAuth'
import { useFavorites } from '../../../favorites/useFavorites'
import { removeFavorite } from '../../../services/api/memberFavorites'
import { FAVORITE_META, formatTime } from './format'
import { AssetGroupShell, AssetRow, RowTextButton, TwoStepDeleteButton } from './ui'
import type { AssetGroupHandle } from './useMemberAssetGroups'

export function FavoritesGroup({
  group,
  onToast,
}: {
  group: AssetGroupHandle<MemberFavoriteItem>
  onToast: (msg: string) => void
}) {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { localPendingCount, mergeLocalToAccount } = useFavorites()
  const [merging, setMerging] = useState(false)

  const remove = async (fav: MemberFavoriteItem) => {
    const token = getToken()
    if (!token) return
    try {
      await removeFavorite(token, fav.targetType, fav.targetId)
      group.removeLocal(fav.id)
      onToast('已取消收藏')
    } catch {
      onToast('取消收藏失败，请稍后重试')
    }
  }

  const merge = async () => {
    setMerging(true)
    try {
      const res = await mergeLocalToAccount()
      if (res.merged > 0) group.reload()
      onToast(
        res.failed > 0
          ? `已合并 ${res.merged} 条，${res.failed} 条失败（已保留，可重试）`
          : res.merged > 0
            ? `已把 ${res.merged} 条本机收藏合并到账号`
            : '本机暂无待合并收藏',
      )
    } finally {
      setMerging(false)
    }
  }

  return (
    <AssetGroupShell
      title="我的收藏"
      group={group}
      empty="暂无收藏，浏览岗位 / 招聘会 / 政策时点收藏后在此查看"
      headerExtra={
        localPendingCount > 0 ? (
          <button
            type="button"
            onClick={() => void merge()}
            disabled={merging}
            className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 text-xs font-medium text-primary-600 active:bg-primary-100 disabled:opacity-60"
          >
            {merging ? (
              <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <UploadIcon className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            合并本机收藏（{localPendingCount}）
          </button>
        ) : undefined
      }
      renderRow={(f) => {
        const meta = FAVORITE_META[f.targetType]
        const route = meta.route?.(f.targetId)
        return (
          <AssetRow
            key={f.id}
            icon={meta.icon}
            iconBg={meta.iconBg}
            iconColor={meta.iconColor}
            name={f.title || `${meta.label}收藏`}
            meta={`${meta.label} · ${formatTime(f.createdAt)}`}
          >
            {route && <RowTextButton label="查看" icon={ExternalLinkIcon} onClick={() => navigate(route)} />}
            <TwoStepDeleteButton title="取消收藏" onConfirm={() => void remove(f)} />
          </AssetRow>
        )
      }}
    />
  )
}
