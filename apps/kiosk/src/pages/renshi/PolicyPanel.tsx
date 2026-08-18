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

/**
 * 政策事项面板。
 *
 * 两个分区严格分开渲染，不合并成一个列表：
 *   library —— 政策库：合作机构发布、管理员审核通过的真实条目。
 *   builtin —— 通用办事指引：本机整理的参考资料，不来自政策库。
 *
 * 合并渲染会让「政策库为空」这件事在页面上完全看不出来：内置指引常驻 5 条
 * （其中一条 audiences 含 'general'，任何身份筛选都命中），页面永远是满的，
 * 运营录完种子政策也无法判断到底进没进去（CLAUDE.md §9「不伪造能力」）。
 */
export function PolicyPanel({
  libraryItems,
  guideItems,
  audience,
  onAudienceChange,
  sourceLine,
  onOpened,
  onOfficialEntry,
}: {
  /** 政策库条目（后端 kind=policy_guide，已审核已发布）。 */
  libraryItems: PolicyItem[]
  /** 本机内置通用办事指引，不属于政策库。 */
  guideItems: PolicyItem[]
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

  const visibleLibrary = useMemo(
    () => libraryItems.filter((item) => matchAudience(item, audience)),
    [libraryItems, audience],
  )
  const visibleGuides = useMemo(
    () => guideItems.filter((item) => matchAudience(item, audience)),
    [guideItems, audience],
  )
  // 右侧详情面板由两个分区共用，所以「能被选中的条目」需要一个统一顺序。
  // 这只决定选中哪一条，不参与列表渲染 —— 列表必须分区渲染。
  const selectable = useMemo(() => [...visibleLibrary, ...visibleGuides], [visibleLibrary, visibleGuides])
  const selected = selectable.find((item) => item.id === selectedId) ?? selectable[0] ?? null

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

  const renderCard = (item: PolicyItem) => {
    const active = selected?.id === item.id
    const canFavorite = !item.id.startsWith('builtin-')
    const favorite = canFavorite && isFavorite('policy', item.id)
    return (
      <article
        key={item.id}
        className={`k8-policy-list-item${active ? ' is-active' : ''}`}
      >
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => selectItem(item)}>
          <span className={`inline-flex rounded-full px-3 py-1 text-[15px] font-semibold ${TAG_TONE[item.tagTone]}`}>
            {item.tagLabel}
          </span>
          <b className="mt-2 block">{item.title}</b>
          <span className="k8-policy-list-sub">{item.sourceName}</span>
          {item.updatedAt && <span className="k8-policy-list-updated">更新 {item.updatedAt}</span>}
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
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <AudienceFilter value={audience} onChange={onAudienceChange} />

      {sourceLine && (
        <p className="k8-policy-src-line">
          <InfoIcon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
          {sourceLine}
        </p>
      )}

      <div className="k8-policy-grid">
          <div className="k8-policy-list">
            <section className="k8-policy-sec" data-policy-section="library">
              <header className="k8-policy-sec-head">
                <b>政策库</b>
                <span>合作机构发布 · 管理员审核后展示（{visibleLibrary.length} 条）</span>
              </header>
              {visibleLibrary.length === 0 ? (
                <EmptyState
                  icon={FileTextIcon}
                  title={libraryItems.length === 0 ? '政策库还没有内容' : '当前身份下暂无匹配的政策'}
                  description={
                    libraryItems.length === 0
                      ? '这里只展示合作机构发布、管理员审核通过的政策；下方「通用办事指引」是本机整理的参考资料，不属于政策库。'
                      : '可切换上方身份或选择「全部」查看政策库中的其他条目。'
                  }
                  className="py-8"
                />
              ) : (
                visibleLibrary.map(renderCard)
              )}
            </section>

            <section className="k8-policy-sec" data-policy-section="builtin">
              <header className="k8-policy-sec-head">
                <b>通用办事指引</b>
                <span>本机整理参考 · 不属于政策库，办理以官方发布为准（{visibleGuides.length} 条）</span>
              </header>
              {visibleGuides.length === 0 ? (
                <EmptyState
                  icon={FileTextIcon}
                  title="当前身份下暂无匹配的办事指引"
                  description="可切换上方身份或选择「全部」查看。"
                  className="py-8"
                />
              ) : (
                visibleGuides.map(renderCard)
              )}
            </section>
          </div>

          {selected && (
            <section className="k8-policy-detail">
              <h2>{selected.title}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-[15px] font-semibold ${TAG_TONE[selected.tagTone]}`}>{selected.tagLabel}</span>
                <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-[15px] text-neutral-500">
                  来源 <b className="font-semibold text-neutral-700">{selected.sourceName}</b>
                </span>
                {/* 详情页也要能一眼看出这条是不是库内数据，否则从列表跳进来又混在一起了。 */}
                <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-[15px] text-neutral-500">
                  {selected.id.startsWith('builtin-') ? '通用办事指引 · 非政策库内容' : '政策库 · 已审核发布'}
                </span>
              </div>

              {selected.conditions && <DetailList icon={BadgeCheckIcon} iconColor="text-wheat-fg" title="先看是否符合" items={selected.conditions} />}
              {selected.materials && <DetailList icon={ListChecksIcon} iconColor="text-wheat-fg" title="需要准备材料" items={selected.materials} />}
              {selected.steps && <DetailList icon={ChevronRightIcon} iconColor="text-wheat-fg" title="建议办理路径" items={selected.steps} ordered />}
              {!selected.conditions && !selected.materials && !selected.steps && selected.content && (
                <p className="whitespace-pre-wrap rounded-[14px] border border-neutral-200 bg-neutral-50 p-5 text-[19px] leading-relaxed text-neutral-700">
                  {selected.content}
                </p>
              )}

              <div className="k8-policy-detail-actions">
                <button type="button" onClick={() => navigate('/print/upload')} className={`k8-policy-detail-btn ${BTN_PRINT}`}>
                  <PrinterIcon className="h-6 w-6" aria-hidden="true" />
                  上传自备材料打印
                </button>
                {selected.officialUrl && isValidSourceUrl(selected.officialUrl) && (
                  <button type="button" onClick={() => onOfficialEntry(selected)} className={`k8-policy-detail-btn ${BTN_OFFICIAL}`}>
                    <QrCodeIcon className="h-6 w-6" aria-hidden="true" />
                    扫码打开来源链接
                  </button>
                )}
              </div>
              <p className="k8-policy-detail-note">政策内容和办理要求以发布主体及目标网站最新信息为准，本系统仅提供信息说明、材料清单与打印辅助。</p>
            </section>
          )}
      </div>
    </div>
  )
}
