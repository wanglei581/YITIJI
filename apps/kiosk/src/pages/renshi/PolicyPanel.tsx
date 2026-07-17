import { useEffect, useMemo, useRef, useState } from 'react'
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const openedIdRef = useRef<string | null>(null)
  const { isFavorite, toggle: toggleFavorite } = useFavorites()

  const visible = useMemo(() => items.filter((item) => matchAudience(item, audience)), [items, audience])
  const selected = visible.find((item) => item.id === selectedId) ?? visible[0] ?? null

  useEffect(() => {
    if (!selected) {
      openedIdRef.current = null
      return
    }
    if (openedIdRef.current === selected.id) return
    openedIdRef.current = selected.id
    onOpened(selected)
  }, [onOpened, selected])

  const selectItem = (item: PolicyItem) => {
    if (item.id === selected?.id) return
    setSelectedId(item.id)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <AudienceFilter value={audience} onChange={onAudienceChange} />

      {sourceLine && (
        <p className="flex shrink-0 items-center gap-2 text-[16px] text-neutral-500">
          <InfoIcon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
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
        <div className="grid min-h-0 flex-1 grid-cols-[430px_minmax(0,1fr)] gap-[22px]">
          <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto pr-1">
            {visible.map((item) => {
              const active = selected?.id === item.id
              const canFavorite = !item.id.startsWith('builtin-')
              const favorite = canFavorite && isFavorite('policy', item.id)
              return (
                <article
                  key={item.id}
                  className={[
                    'flex shrink-0 items-start gap-3 rounded-[14px] border p-[18px_20px] transition-colors',
                    active
                      ? 'border-warning/50 bg-warning-bg shadow-[0_3px_14px_rgba(169,120,31,.12)]'
                      : 'border-neutral-200 bg-surface hover:border-neutral-300',
                  ].join(' ')}
                >
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => selectItem(item)}>
                    <span className={`inline-flex rounded-full px-3 py-1 text-[15px] font-semibold ${TAG_TONE[item.tagTone]}`}>
                      {item.tagLabel}
                    </span>
                    <strong className="mt-2 block text-[22px] leading-snug text-neutral-900">{item.title}</strong>
                    <span className="mt-2 block text-[16px] leading-snug text-neutral-500">{item.sourceName}</span>
                    {item.updatedAt && <span className="mt-1 block text-[15px] text-neutral-400">更新 {item.updatedAt}</span>}
                  </button>
                  {canFavorite && (
                    <button
                      type="button"
                      onClick={() => toggleFavorite({ type: 'policy', id: item.id, title: item.title })}
                      aria-label={favorite ? '取消收藏' : '收藏政策'}
                      className={[
                        'flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors',
                        favorite ? 'bg-error-bg text-error-fg' : 'text-neutral-300 hover:text-error',
                      ].join(' ')}
                    >
                      <HeartIcon className={favorite ? 'h-6 w-6 fill-current' : 'h-6 w-6'} aria-hidden="true" />
                    </button>
                  )}
                </article>
              )
            })}
          </div>

          {selected && (
            <section className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-[18px] border border-neutral-200 border-t-4 border-t-warning bg-surface p-6 shadow-sm">
              <h2 className="font-serif text-[29px] font-bold leading-snug tracking-wide text-neutral-900">{selected.title}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-[15px] font-semibold ${TAG_TONE[selected.tagTone]}`}>{selected.tagLabel}</span>
                <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-[15px] text-neutral-500">
                  来源 <b className="font-semibold text-neutral-700">{selected.sourceName}</b>
                </span>
              </div>

              {selected.conditions && <DetailList icon={BadgeCheckIcon} iconColor="text-warning-fg" title="先看是否符合" items={selected.conditions} />}
              {selected.materials && <DetailList icon={ListChecksIcon} iconColor="text-warning-fg" title="需要准备材料" items={selected.materials} />}
              {selected.steps && <DetailList icon={ChevronRightIcon} iconColor="text-warning-fg" title="建议办理路径" items={selected.steps} ordered />}
              {!selected.conditions && !selected.materials && !selected.steps && selected.content && (
                <p className="whitespace-pre-wrap rounded-[14px] border border-neutral-200 bg-neutral-50 p-5 text-[19px] leading-relaxed text-neutral-700">
                  {selected.content}
                </p>
              )}

              <div className="mt-auto grid grid-cols-2 gap-3.5 pt-2">
                <button type="button" onClick={() => navigate('/print/upload')} className={`${BTN_PRINT} min-h-[78px] justify-center text-[20px]`}>
                  <PrinterIcon className="h-6 w-6" aria-hidden="true" />
                  上传自备材料打印
                </button>
                {selected.officialUrl && isValidSourceUrl(selected.officialUrl) && (
                  <button type="button" onClick={() => onOfficialEntry(selected)} className={`${BTN_OFFICIAL} min-h-[78px] justify-center text-[20px]`}>
                    <QrCodeIcon className="h-6 w-6" aria-hidden="true" />
                    扫码打开官方入口
                  </button>
                )}
              </div>
              <p className="text-[15px] leading-relaxed text-neutral-500">办理结果以官方平台为准，本系统仅提供信息说明、材料清单与打印辅助。</p>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
