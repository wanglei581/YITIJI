import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFavorites } from '../../favorites/useFavorites'
import { isValidSourceUrl } from '../../lib/url'
import { HeartIcon, PrinterIcon, QrCodeIcon } from 'lucide-react'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { QxAiHelp } from '../../components/qingxu/QxAiHelp'
import { matchAudience, type AudienceKey, type PolicyItem } from './shared'
import { AudienceFilter, DetailList, SourceFacts, type SourceQrTarget } from './components'

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
  onAudienceChange,
  onOpened,
  onActiveId,
  onDetailSelected,
  onUpload,
  onOfficialEntry,
}: {
  libraryItems: PolicyItem[]
  guideItems: PolicyItem[]
  audience: AudienceKey
  /** 收藏或地址里点名的那一条。在列表里就展开它，不先展开第一条。 */
  focusId?: string | null
  onAudienceChange: (k: AudienceKey) => void
  onOpened: (item: PolicyItem) => void
  onActiveId: (id: string | null) => void
  onDetailSelected: (selected: boolean) => void
  onUpload: (id: string) => void
  onOfficialEntry: (item: PolicyItem, target: SourceQrTarget) => void
}) {
  const navigate = useNavigate()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const openedIdRef = useRef<string | null>(null)
  const audienceSeen = useRef(audience)
  const { isFavorite, toggle: toggleFavorite, source } = useFavorites()
  const [page, setPage] = useState(0)
  const [guideView, setGuideView] = useState(false)
  if (audienceSeen.current !== audience) {
    audienceSeen.current = audience
    setTouched(false)
    setExpandedId(null)
    setPage(0)
    setGuideView(false)
  }

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
  const focusHit = focusId && selectable.some((item) => item.id === focusId) ? focusId : null
  const stillThere = (id: string | null) => Boolean(id && selectable.some((item) => item.id === id))
  const openId = touched
    ? (stillThere(expandedId) ? expandedId : null)
    : focusHit

  useEffect(() => {
    if (touched || !focusHit || openId !== focusHit) return
    document.querySelector(`[data-policy-id="${CSS.escape(focusHit)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [focusHit, openId, touched])

  useEffect(() => {
    onActiveId(openId)
    return () => onActiveId(null)
  }, [onActiveId, openId])

  // 本人点开或地址点名的那一条独占详情内容区：
  // 页面据此决定问小青的问句，以及被下架时是整页换成「已下架」还是只从列表里摘掉。
  const userOpened = openId !== null && (touched || openId === focusHit)
  useEffect(() => {
    onDetailSelected(userOpened)
    return () => onDetailSelected(false)
  }, [onDetailSelected, userOpened])

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
        <div className={open ? 'rq-detail-card' : undefined}>
        <div className="rq-item-head">
          <button type="button" className="rq-item-main" aria-expanded={open} onClick={() => toggle(item)}>
            <span className="rq-item-tx"><b>{item.title}</b>
              {!open && (kind === 'builtin' || visibleLibrary.length < 5) && item.summary ? <span className="rq-item-sub">{item.summary}</span> : null}
              {!open && <small className="rq-item-meta">{kind === 'library' ? `${item.tagLabel} · ${item.publishedDate ? `发布于 ${item.publishedDate.slice(0, 10)}` : '发布日期未提供'} · 看原文` : '办事参考 · 查看'}</small>}
            </span>
          </button>
        </div>
        {open && (
          <div className="rq-acc">
            {canFavorite && <button type="button" className={favorite ? 'rq-fav is-on' : 'rq-fav'} aria-label={favorite ? '取消收藏' : '收藏政策'} onClick={() => toggleFavorite({ type: 'policy', id: item.id, title: item.title })}>
              <HeartIcon className={favorite ? 'is-on' : ''} aria-hidden="true" /><span><b>{favorite ? '已收藏，再点取消' : '收藏这条'}</b>{source === 'local' && <small>只记在这台机器的这次办理里</small>}</span>
            </button>}
            {kind === 'builtin' ? <p className="rq-kindchip">内置指引 · 非政策库内容</p> : null}
            {(item.content || item.summary) && !item.conditions && (
              <div className="rq-quote">
                <span>政策原文</span>
                <p>{item.content || item.summary}</p>
              </div>
            )}
            {item.conditions && <DetailList title="先看是否符合" items={item.conditions} layout="list" />}
            {item.materials && <DetailList title="需要准备的材料" items={item.materials} layout="cols" />}
            {item.steps && <DetailList title="建议怎么办" items={item.steps} layout="steps" />}
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
                <p className="rq-ai-remind"><QxTouchIcon name="sparkle" /><span>小青还不能解释这条政策。看原文、扫码和条件核对都可以继续。</span></p>
                <QxAiHelp label="问小青别的问题，不判断能不能办" draft={`关于「${item.title}」，如何核对发布机构和来源地址？小青还不能解释政策原文，也不判断能否办理。`} testId="renshi-ask-ai" />
              </div>
            ) : (
              <p className="rq-note">{SRC_RULE}</p>
            )}
          </div>
        )}
        </div>
        {open && <>
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
                  <span><b>扫码打开来源链接</b><small>扫码前核对机构和域名</small></span>
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
                  <span><b>上传自备材料打印</b><small>只处理你自己带来的材料</small></span>
                </button>
              ) : (
                <button type="button" className="rq-exit" onClick={() => onUpload(item.id)}>
                  <PrinterIcon aria-hidden="true" />
                  <span><b>上传自备材料打印</b><small>只处理你自己带来的材料</small></span>
                </button>
              )}
            </div>
            {!urlOk && (
              <p id={`rq-src-why-${item.id}`} className="rq-why">
                {urlMissing ? '发布方没有提供来源地址' : '来源地址不是有效的网址'}；本机不会猜地址或补链接。
              </p>
            )}
        </>}
      </article>
    )
  }

  const selectedLibrary = visibleLibrary.find((item) => item.id === openId)
  const selectedGuide = visibleGuides.find((item) => item.id === openId)
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visibleLibrary.length / 6) - 1))
  const pageItems = visibleLibrary.slice(currentPage * 6, (currentPage + 1) * 6)
  const remaining = Math.max(0, visibleLibrary.length - (currentPage + 1) * 6)
  const foldedGuides = visibleLibrary.length >= 3
  const showingGuides = foldedGuides && guideView

  return (
    <div className={`rq-policy${userOpened ? ' rq-policy-detail' : ''}${visibleLibrary.length >= 5 ? ' rq-policy-dense' : ' rq-policy-roomy'}`}>
      {!userOpened && <AudienceFilter value={audience} onChange={onAudienceChange} />}
      {(!userOpened || selectedLibrary) && !showingGuides && <section className="rq-sec" data-policy-section="library">
        {userOpened && selectedLibrary ? renderItem(selectedLibrary, 'library') : visibleLibrary.length === 0 ? (
          <div className="rq-state" data-kind={libraryEmpty ? 'empty' : 'filter'}>
            <b>{libraryEmpty ? '政策库暂无内容' : '当前身份暂无匹配政策'}</b>
            <p>{libraryEmpty
              ? '这里只展示发布机构自己审核并发布的政策。下方「通用办事指引」是本机整理的参考，不属于政策库。'
              : '可切换身份或选择「全部」再看一次；这只是筛选结果，不代表库里没有政策。'}</p>
          </div>
        ) : <>
          <div className="rq-list">{pageItems.map((item) => renderItem(item, 'library'))}</div>
          {remaining > 0 && <button type="button" className="rq-list-nav" onClick={() => setPage(currentPage + 1)}><b>加载更多</b><small>还有 {remaining} 条</small></button>}
          {currentPage > 0 && <button type="button" className="rq-list-nav" onClick={() => setPage(currentPage - 1)}>上一页</button>}
        </>}
      </section>}
      {(!userOpened || selectedGuide) && <section className="rq-sec" data-policy-section="builtin">
        {userOpened && selectedGuide ? renderItem(selectedGuide, 'builtin') : foldedGuides && !showingGuides ? (
          <button type="button" className="rq-list-nav rq-guide-fold" onClick={() => setGuideView(true)}><span><b>通用办事指引</b><small>本机整理 · {visibleGuides.length} 条 · 不属于政策库，办理以官方发布为准</small></span><b>展开</b></button>
        ) : <>
          <header className="rq-grp rq-grp-builtin"><b>通用办事指引</b><span>本机整理的参考，不属于政策库，办理以官方发布为准</span></header>
          {visibleGuides.length === 0 ? <div className="rq-state" data-kind="filter"><b>当前身份暂无匹配指引</b><p>可切换身份或选择「全部」再看一次。</p></div>
            : <div className="rq-list">{visibleGuides.map((item) => renderItem(item, 'builtin'))}</div>}
          {showingGuides && <button type="button" className="rq-list-nav" onClick={() => setGuideView(false)}><b>返回已发布政策</b><small>回到合作机构发布的列表</small></button>}
        </>}
      </section>}
      {!userOpened && <p className="rq-list-page">当前显示第 {currentPage + 1} 页。</p>}
    </div>
  )
}
