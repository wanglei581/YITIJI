import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFavorites } from '../../favorites/useFavorites'
import { isValidSourceUrl } from '../../lib/url'
import { FileTextIcon, HeartIcon, PrinterIcon, QrCodeIcon } from 'lucide-react'
import { QxAiHelp, QxStepActions } from '../../components/qingxu/QxAiHelp'
import { matchAudience, type AudienceKey, type PolicyItem } from './shared'
import { AudienceFilter, CollapsedChevron, DetailList, SourceFacts, type SourceQrTarget } from './components'

const SRC_RULE = '来源入口由发布方提供，本系统未核验其官方性；扫码前请核对机构和目标域名。'

/** 点名的那一条即使被身份筛选挡住，也留在列表里并展开，不用另一条顶上。 */
function pinFocused(matched: PolicyItem[], all: PolicyItem[], focusId?: string | null): PolicyItem[] {
  if (!focusId || matched.some((item) => item.id === focusId)) return matched
  const focused = all.find((item) => item.id === focusId)
  return focused ? [focused, ...matched] : matched
}

/**
 * 政策库与通用办事指引分区渲染，不合并成一个列表。
 * 内置指引常驻，合并后政策库为空时页面仍会满屏。
 */
export function PolicyPanel({
  libraryItems,
  guideItems,
  audience,
  focusId,
  suppressAutoOpen = false,
  onAudienceChange,
  onOpened,
  onActiveId,
  onUpload,
  onOfficialEntry,
  aiLabel,
  aiDraft,
}: {
  libraryItems: PolicyItem[]
  guideItems: PolicyItem[]
  audience: AudienceKey
  /** 收藏或地址里点名的那一条。在列表里就展开它，不先展开第一条。 */
  focusId?: string | null
  /** 刚撤下一条时，不要改去展开下一条。 */
  suppressAutoOpen?: boolean
  onAudienceChange: (k: AudienceKey) => void
  onOpened: (item: PolicyItem) => void
  onActiveId: (id: string | null) => void
  onUpload: (id: string) => void
  onOfficialEntry: (item: PolicyItem, target: SourceQrTarget) => void
  aiLabel: string
  aiDraft: string
}) {
  const navigate = useNavigate()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const openedIdRef = useRef<string | null>(null)
  const audienceSeen = useRef(audience)
  const { isFavorite, toggle: toggleFavorite } = useFavorites()
  if (audienceSeen.current !== audience) {
    audienceSeen.current = audience
    setTouched(false)
    setExpandedId(null)
  }

  const goHub = () => navigate('/policy-service')
  // 选了身份时服务端只回这一身份与通用事项：这时一条都没有是筛选结果，不是政策库空（稿 48 的 filtered-empty）。
  const libraryEmpty = libraryItems.length === 0 && audience === 'all'
  const visibleLibrary = useMemo(
    () => pinFocused(libraryItems.filter((item) => matchAudience(item, audience)), libraryItems, focusId),
    [libraryItems, audience, focusId],
  )
  const visibleGuides = useMemo(
    () => pinFocused(guideItems.filter((item) => matchAudience(item, audience)), guideItems, focusId),
    [guideItems, audience, focusId],
  )
  const selectable = useMemo(() => [...visibleLibrary, ...visibleGuides], [visibleLibrary, visibleGuides])
  const fallbackId = selectable[0]?.id ?? null
  const focusHit = focusId && selectable.some((item) => item.id === focusId) ? focusId : null
  const stillThere = (id: string | null) => Boolean(id && selectable.some((item) => item.id === id))
  const openId = touched
    ? (stillThere(expandedId) ? expandedId : null)
    : suppressAutoOpen
      ? focusHit
      : (focusHit ?? fallbackId)

  useEffect(() => {
    if (touched || !focusHit || openId !== focusHit) return
    document.querySelector(`[data-policy-id="${CSS.escape(focusHit)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [focusHit, openId, touched])

  useEffect(() => {
    onActiveId(openId)
    return () => onActiveId(null)
  }, [onActiveId, openId])

  useEffect(() => {
    const item = selectable.find((entry) => entry.id === openId)
    if (!item) {
      openedIdRef.current = null
      return
    }
    if (openedIdRef.current === item.id) return
    openedIdRef.current = item.id
    onOpened(item)
  }, [onOpened, openId, selectable])

  const toggle = (item: PolicyItem) => {
    setTouched(true)
    setExpandedId(openId === item.id ? null : item.id)
  }

  const renderItem = (item: PolicyItem, kind: 'library' | 'builtin') => {
    const open = openId === item.id
    const canFavorite = !item.id.startsWith('builtin-')
    const favorite = canFavorite && isFavorite('policy', item.id)
    const urlOk = Boolean(item.officialUrl && isValidSourceUrl(item.officialUrl))
    const urlMissing = !item.officialUrl
    return (
      <article key={item.id} className={`k8-policy-list-item${open ? ' is-open' : ''}`} data-policy-id={item.id}>
        <div className="rq-item-head">
          <button
            type="button"
            className="rq-item-main"
            aria-expanded={open}
            onClick={() => toggle(item)}
          >
            <span className={kind === 'library' ? 'rq-item-ic rq-item-ic-lib' : 'rq-item-ic'} aria-hidden="true">
              <FileTextIcon />
            </span>
            <span className="rq-item-tx">
              <b>{item.title}</b>
              <span className="rq-item-sub">{item.summary || item.sourceName}</span>
            </span>
            <span className="rq-item-tail">
              <span className={kind === 'library' ? 'rq-tag rq-tag-lib' : 'rq-tag'}>{item.tagLabel}</span>
              <CollapsedChevron />
            </span>
          </button>
          {canFavorite && (
            <button
              type="button"
              className={favorite ? 'rq-fav is-on' : 'rq-fav'}
              aria-label={favorite ? '取消收藏' : '收藏政策'}
              onClick={() => toggleFavorite({ type: 'policy', id: item.id, title: item.title })}
            >
              <HeartIcon className={favorite ? 'is-on' : ''} aria-hidden="true" />
            </button>
          )}
        </div>
        {open && (
          <div className="rq-acc">
            {kind === 'builtin' ? <p className="rq-kindchip">内置指引 · 非政策库内容</p> : null}
            {(item.content || item.summary) && !item.conditions && (
              <div className="rq-quote">
                <span>政策原文</span>
                <p>{item.content || item.summary}</p>
              </div>
            )}
            {item.conditions && <DetailList title="先看是否符合" items={item.conditions} layout="list" />}
            {item.materials && <DetailList title="需要准备材料" items={item.materials} layout="cols" />}
            {item.steps && <DetailList title="建议办理路径" items={item.steps} layout="steps" />}
            {kind === 'library' ? (
              <SourceFacts
                sourceName={item.sourceName}
                syncTime={item.syncTime}
                publishedOn={item.publishedDate}
              />
            ) : (
              <p className="rq-srcchip">整理来源 <b>{item.sourceName}</b></p>
            )}
            {kind === 'library' ? (
              <div className="rq-ai-off">
                <b>本条政策暂未接入小青</b>
                <span>小青还不能解释政策原文。看原文、来源二维码和条件核对都不经过它。</span>
                <QxAiHelp label={aiLabel} draft={aiDraft} testId="renshi-ask-ai" />
              </div>
            ) : (
              <p className="rq-note">{SRC_RULE}</p>
            )}
            <div className="rq-strip">
              {urlOk ? (
                <button
                  type="button"
                  className="rq-exit"
                  onClick={() => onOfficialEntry(item, {
                    title: item.title,
                    url: item.officialUrl!,
                    sourceKind: kind === 'builtin' ? '本机整理的办事指引' : '政策库条目',
                    sourceDetail: item.sourceName,
                  })}
                >
                  <QrCodeIcon aria-hidden="true" />
                  <span><b>扫码打开来源链接</b><small>先核对机构和目标域名再用手机访问</small></span>
                </button>
              ) : (
                <button
                  type="button"
                  className="rq-exit"
                  aria-disabled="true"
                  aria-describedby={`rq-src-why-${item.id}`}
                  onClick={(event) => event.preventDefault()}
                >
                  <QrCodeIcon aria-hidden="true" />
                  <span>
                    <b>来源二维码暂不可用</b>
                    <small>{urlMissing ? '发布方没有提供来源地址' : '来源地址不是有效的网址'}</small>
                  </span>
                </button>
              )}
              {kind === 'builtin' ? (
                <button type="button" className="rq-exit" onClick={() => navigate('/print/upload')}>
                  <PrinterIcon aria-hidden="true" />
                  <span><b>上传自备材料打印</b><small>本机只打印你自己带来的文件</small></span>
                </button>
              ) : (
                <button type="button" className="rq-exit" onClick={() => onUpload(item.id)}>
                  <PrinterIcon aria-hidden="true" />
                  <span><b>上传自备材料打印</b><small>本机只打印你自己带来的文件</small></span>
                </button>
              )}
            </div>
            {!urlOk && (
              <p id={`rq-src-why-${item.id}`} className="rq-why">
                {urlMissing ? '发布方没有提供来源地址' : '来源地址不是有效的网址'}；本机不会猜地址或补链接。
              </p>
            )}
          </div>
        )}
      </article>
    )
  }

  return (
    <div className="rq-policy">
      <AudienceFilter value={audience} onChange={onAudienceChange} />
      <section className="rq-sec" data-policy-section="library">
        <header className="rq-grp">
          <b>政策库</b>
          <span>
            {visibleLibrary.length === 0
              ? (libraryEmpty ? '本次没有读到条目' : '当前筛选无匹配')
              : '读到的条目按下面的结构展示'}
          </span>
        </header>
        {visibleLibrary.length === 0 ? (
          <div className="rq-state" data-kind={libraryEmpty ? 'empty' : 'filter'}>
            <b>{libraryEmpty ? '政策库暂无内容' : '当前身份暂无匹配政策'}</b>
            <p>
              {libraryEmpty
                ? '这里只展示合作机构发布、管理员审核通过的政策。下方「通用办事指引」是本机整理的参考，不属于政策库。'
                : '可切换身份或选择「全部」再看一次；这只是筛选结果，不代表库里没有政策。'}
            </p>
          </div>
        ) : (
          <div className="rq-list">{visibleLibrary.map((item) => renderItem(item, 'library'))}</div>
        )}
      </section>
      <section className="rq-sec" data-policy-section="builtin">
        <header className="rq-grp rq-grp-builtin">
          <b>通用办事指引</b>
          <span>本机整理的参考，不属于政策库，办理以官方发布为准</span>
        </header>
        {visibleGuides.length === 0 ? (
          <div className="rq-state" data-kind="filter">
            <b>当前身份暂无匹配指引</b>
            <p>可切换身份或选择「全部」再看一次。</p>
          </div>
        ) : (
          <div className="rq-list">{visibleGuides.map((item) => renderItem(item, 'builtin'))}</div>
        )}
      </section>
      {visibleLibrary.some((item) => item.id === openId) ? null : (
        <QxStepActions onPrev={goHub}>
          <QxAiHelp label={aiLabel} draft={aiDraft} testId="renshi-ask-ai" />
        </QxStepActions>
      )}
    </div>
  )
}
