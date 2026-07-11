import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState } from '@ai-job-print/ui'
import { useFavorites } from '../../favorites/useFavorites'
import { isValidSourceUrl } from '../../lib/url'
import {
  BadgeCheckIcon,
  ChevronRightIcon,
  FileTextIcon,
  HeartIcon,
  InfoIcon,
  ListChecksIcon,
  PrinterIcon,
  QrCodeIcon,
} from 'lucide-react'
import { BTN_OFFICIAL, BTN_PRINT, TAG_TONE, matchAudience, type AudienceKey, type PolicyItem } from './shared'
import { AudienceFilter, DetailList } from './components'

// ─── Panel: 就业政策（政策匹配 + 内置模板 + 后端发布合并）──────────────────────

export function PolicyPanel({
  items,
  audience,
  onAudienceChange,
  sourceLine,
  onOpened,
  onOfficialEntry,
}: {
  items: PolicyItem[]
  audience: AudienceKey
  onAudienceChange: (k: AudienceKey) => void
  sourceLine: string | null
  onOpened: (item: PolicyItem) => void
  onOfficialEntry: (item: PolicyItem) => void
}) {
  const navigate = useNavigate()
  const [openId, setOpenId] = useState<string | null>(null)
  const { isFavorite, toggle: toggleFavorite } = useFavorites()

  const visible = useMemo(() => items.filter((it) => matchAudience(it, audience)), [items, audience])

  const toggleItem = (item: PolicyItem) => {
    const opening = openId !== item.id
    setOpenId(opening ? item.id : null)
    if (opening) onOpened(item)
  }

  return (
    <div className="flex flex-col gap-4">
      <AudienceFilter value={audience} onChange={onAudienceChange} />

      {sourceLine && (
        <p className="flex items-center gap-2 text-xs text-neutral-400">
          <InfoIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {sourceLine}
        </p>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon={FileTextIcon}
          title="暂无匹配的政策事项"
          description="可切换上方身份或选择「全部」查看；政策内容由合作机构发布、管理员审核后展示。"
          className="py-12"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((item) => {
            const itemOpen = openId === item.id
            const hasStructured = Boolean(item.conditions || item.materials || item.steps)
            const hasOfficial = Boolean(item.officialUrl && isValidSourceUrl(item.officialUrl))
            // 内置指引不在政策库中，服务端收藏会拒绝（仅接受已审核发布条目），不渲染收藏按钮。
            const canFavorite = !item.id.startsWith('builtin-')
            const fav = canFavorite && isFavorite('policy', item.id)
            return (
              <article key={item.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TAG_TONE[item.tagTone]}`}>
                    {item.tagLabel}
                  </span>
                  {item.updatedAt && <span className="ml-auto text-xs text-neutral-400">更新 {item.updatedAt}</span>}
                </div>
                <p className="mt-2 text-lg font-semibold leading-snug text-neutral-900">{item.title}</p>
                {item.summary && (
                  <p className={['mt-1 text-sm leading-relaxed text-neutral-500', itemOpen ? '' : 'line-clamp-2'].join(' ')}>
                    {item.summary}
                  </p>
                )}
                <p className="mt-1.5 text-xs text-neutral-400">来源：{item.sourceName}</p>

                {itemOpen && (
                  <div className="mt-3 flex flex-col gap-3">
                    {hasStructured ? (
                      <>
                        {item.conditions && (
                          <DetailList icon={BadgeCheckIcon} iconColor="text-success-fg" title="先看是否符合" items={item.conditions} />
                        )}
                        {item.materials && (
                          <DetailList icon={ListChecksIcon} iconColor="text-warning-fg" title="需要准备材料" items={item.materials} />
                        )}
                        {item.steps && (
                          <DetailList icon={ChevronRightIcon} iconColor="text-warning-fg" title="建议办理路径" items={item.steps} ordered />
                        )}
                      </>
                    ) : (
                      item.content && (
                        <div className="rounded-xl bg-neutral-50 px-4 py-3">
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-700">{item.content}</p>
                        </div>
                      )
                    )}

                    <div className="flex flex-wrap gap-2.5">
                      <button type="button" onClick={() => navigate('/print/upload')} className={BTN_PRINT}>
                        <PrinterIcon className="h-4 w-4" aria-hidden="true" />
                        上传自备材料打印
                      </button>
                      {hasOfficial && (
                        <button type="button" onClick={() => onOfficialEntry(item)} className={BTN_OFFICIAL}>
                          <QrCodeIcon className="h-4 w-4" aria-hidden="true" />
                          扫码打开官方入口
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-neutral-400">办理结果以官方平台为准，本系统仅提供信息说明、材料清单与打印辅助。</p>
                  </div>
                )}

                <div className="mt-3 flex items-center gap-2 border-t border-neutral-100 pt-3">
                  <button
                    type="button"
                    onClick={() => toggleItem(item)}
                    className="flex min-h-[48px] items-center gap-1 rounded-lg px-2 text-sm font-medium text-neutral-600 hover:text-warning-fg"
                  >
                    {itemOpen ? '收起' : '查看条件 / 材料'}
                    <ChevronRightIcon
                      className={['h-4 w-4 transition-transform', itemOpen ? 'rotate-90' : ''].join(' ')}
                      aria-hidden="true"
                    />
                  </button>
                  {canFavorite && (
                    <button
                      type="button"
                      onClick={() => toggleFavorite({ type: 'policy', id: item.id, title: item.title })}
                      aria-label={fav ? '取消收藏' : '收藏政策'}
                      className={[
                        'ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors',
                        fav ? 'bg-error-bg text-error-fg' : 'text-neutral-300 hover:text-error',
                      ].join(' ')}
                    >
                      <HeartIcon className={fav ? 'h-5 w-5 fill-current' : 'h-5 w-5'} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
