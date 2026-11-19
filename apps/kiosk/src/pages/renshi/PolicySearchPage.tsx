import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getPublishedPolicies } from '../../services/api/policies'
import { PolicyGuideRow } from './PolicyGuideRow'
import { PolicySearchField } from './PolicySearchField'
import { PolicyTouchLayout } from './PolicyTouchLayout'
import { PolicyExitCard, PolicyLinkRow, PolicyStatusCard } from './policyStatus'
import { POLICY_ASK_HOME, POLICY_CATEGORIES, POLICY_PAGE_SIZE, policyPage, policyPagination, policyRead } from './policyModel'
import { clearPolicyKeyword, getPolicyKeyword, setPolicyKeyword, subscribePolicyKeywordClear } from './policyKeywordSession'
import { policyDeadlineLabel, policyTooLongCopy, resolvePolicySearch, type PolicySearchOutcome } from './policySearchModel'

type View =
  | { status: 'idle' }
  | { status: 'loading'; keyword: string }
  | PolicySearchOutcome

function categoryLabel(audience?: string): string | undefined {
  return POLICY_CATEGORIES.find((category) => category.key === audience)?.label
}

export function PolicySearchPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const page = policyPage(params.get('page'))
  const inputRef = useRef<HTMLInputElement>(null)
  const [keyword, setKeyword] = useState(getPolicyKeyword)
  const [view, setView] = useState<View>({ status: 'idle' })
  const [attempt, setAttempt] = useState(0)
  const [noticeTotal, setNoticeTotal] = useState(0)
  useEffect(() => subscribePolicyKeywordClear(() => {
    setKeyword('')
    setView({ status: 'idle' })
  }), [])
  useEffect(() => {
    let active = true
    policyRead(getPublishedPolicies({ kind: 'notice', pageSize: 1 }))
      .then((data) => { if (active) setNoticeTotal(data.total) })
      .catch(() => { if (active) setNoticeTotal(0) })
    return () => { active = false }
  }, [attempt])
  useEffect(() => {
    const word = keyword.trim()
    if (!word) {
      setView({ status: 'idle' })
      return
    }
    let active = true
    setView({ status: 'loading', keyword: word })
    resolvePolicySearch(word, (term) => getPublishedPolicies({
      kind: 'policy_guide', keyword: term, page, pageSize: POLICY_PAGE_SIZE,
    })).then((outcome) => { if (active) setView(outcome) })
    return () => { active = false }
  }, [keyword, page, attempt])

  const goHome = () => { clearPolicyKeyword(); navigate('/policy-service') }
  const submit = (word: string) => {
    setPolicyKeyword(word)
    setKeyword(word)
    if (page !== 1) navigate('/renshi?search=1')
  }
  const word = view.status === 'idle' ? keyword.trim() : view.keyword
  const found = view.status === 'ready' ? view.result : null
  const none = found !== null && found.total === 0
  // view.blocked 分开「没发请求」和「发了被拒」。两种都用稿上超过 30 字的句子，不把内部判定写到屏上。
  const tooLong = view.status === 'too-long' ? policyTooLongCopy(view.count) : null
  const title = view.status === 'loading' ? `正在找含「${word}」的政策`
    : view.status === 'failed' ? '这次没读到搜索结果'
      : tooLong ? tooLong.title
        : none ? `没有找到含「${word}」的政策`
          : found ? `找到 ${found.total} 条含「${word}」的政策`
            : '输入一个词找政策'
  const sub = view.status === 'loading' ? '找到后列出标题、发布机构和更新时间。'
    : view.status === 'failed' ? '不是没有相关政策，是这次没连上。关键词还在，可以再搜一次。'
      : tooLong ? tooLong.sub
        : none ? '只按政策标题和摘要找；过了截止日期的政策不再显示。'
          : found ? '按标题和摘要找 · 每条写明发布机构 · 过了截止日期的不显示'
            : '按政策标题和摘要找，输入一个词就行。'
  const state = view.status === 'loading' ? 'loading'
    : view.status === 'failed' ? 'failed'
      : view.status === 'too-long' ? 'too-long'
        : none ? 'none' : found ? 'results' : 'idle'
  const paging = found && found.items.length > 0 ? policyPagination(found) : null
  const goPage = (next: number) => navigate(`/renshi?search=1&page=${next}`)
  return <PolicyTouchLayout eyebrow={found || none ? '查政策 · 搜索结果' : '查政策 · 搜索'} title={title} sub={sub}
    askPrompt={POLICY_ASK_HOME} state={state}>
    <PolicySearchField inputRef={inputRef} initial={keyword} showGo={!keyword.trim()} clearLabel="清空，回到政策首页"
      onSearch={submit} onClear={goHome} />
    {view.status === 'loading' && <PolicyStatusCard icon="clock" title="正在按标题和摘要找" chip="找到后可以打印这样一页" artWidth={300}>
      <ul><li>只找发布机构在后台发布、还没过截止日期的政策</li><li>打印、扫描照常</li></ul>
    </PolicyStatusCard>}
    {view.status === 'failed' && <>
      <PolicyStatusCard icon="wifi" title="这次没连上" chip="找到后可以打印这样一页">
        <ul>
          <li>关键词「{word}」还留在框里</li>
          <li>可以再搜一次，或者先按类别看</li>
          <li>打印、扫描照常</li>
        </ul>
      </PolicyStatusCard>
      <div className="policy-exit-grid">
        <PolicyExitCard icon="refresh" title="再搜一次" desc={`还是搜「${word}」`} onClick={() => setAttempt((value) => value + 1)} />
        <PolicyExitCard icon="landmark" title="按类别看全部政策" desc="六类都在政策首页" onClick={goHome} />
      </div>
    </>}
    {tooLong && <section className="policy-min-section" role="status">
      <h2>{tooLong.heading}</h2>
      <p>{tooLong.body}</p>
    </section>}
    {found && found.items.length > 0 && <>
      <div className="policy-min-list policy-search-list" data-testid="policy-search-list">
        {found.items.map((policy) => <PolicyGuideRow key={policy.id} policy={policy} highlight={word}
          categoryLabel={categoryLabel(policy.audience)} deadlineLabel={policyDeadlineLabel(policy.validThrough)}
          showHandling={false}
          onOpen={() => navigate(`/renshi?policy=${encodeURIComponent(policy.id)}`)} />)}
      </div>
      {paging && (paging.previous || paging.next) && <div className="policy-min-pagination">
        {paging.previous && <button type="button" className="policy-min-button" onClick={() => goPage(paging.page - 1)}>上一页</button>}
        <span>第 {paging.page} / {paging.pages} 页</span>
        {paging.next && <button type="button" className="policy-min-button" onClick={() => goPage(paging.page + 1)}>再看 4 条</button>}
      </div>}
    </>}
    {none && <>
      <PolicyStatusCard icon="help" title="可以这样再找" chip="找到政策后可以打印这样一页" artWidth={260}>
        <ul>
          <li>换一个更短的词，比如「失业」「补贴」</li>
          <li>按类别看全部政策</li>
          <li>这里只有发布机构在本机发布的政策，没在这里发布的，以发布机构的官方渠道为准</li>
        </ul>
      </PolicyStatusCard>
      <div className="policy-exit-grid">
        <PolicyExitCard icon="keyboard" title="换个词再搜" desc="点这里后改框里的词" onClick={() => inputRef.current?.focus()} />
        <PolicyExitCard icon="landmark" title="按类别看全部政策" desc="六类都在政策首页" onClick={goHome} />
      </div>
      {noticeTotal > 0 && <PolicyLinkRow icon="message" title="机构公告" detail={`${noticeTotal} 条 · 公告不在搜索范围里`}
        onClick={() => navigate('/renshi?tab=notice')} />}
    </>}
    {view.status === 'loading' && <PolicyLinkRow icon="landmark" title="不等了，按类别看全部政策" onClick={goHome} />}
    <p className="policy-min-fine policy-min-foot">政策由发布机构自行审核发布，以官方原文为准</p>
  </PolicyTouchLayout>
}
