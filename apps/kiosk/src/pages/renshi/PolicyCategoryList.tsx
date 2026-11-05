import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPublishedPolicies, type PublishedPoliciesResult } from '../../services/api/policies'
import { POLICY_ASK_LIST, PolicyChecklistSample, PolicyReadState, PolicyTouchLayout } from './PolicyTouchLayout'
import { POLICY_CATEGORIES, POLICY_PAGE_SIZE, policyPagination, policyRead, type PolicyAudience } from './policyModel'
import { policyPublishedOn } from './policyFacts'

export function PolicyCategoryList({ audience, page }: { audience: PolicyAudience; page: number }) {
  const navigate = useNavigate()
  const [result, setResult] = useState<PublishedPoliciesResult | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const label = POLICY_CATEGORIES.find((category) => category.key === audience)!.label
  useEffect(() => {
    let active = true
    setResult(null)
    setFailed(false)
    policyRead(getPublishedPolicies({ kind: 'policy_guide', audience, page, pageSize: POLICY_PAGE_SIZE }))
      .then((data) => { if (active) setResult(data) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [audience, page, attempt])
  const paging = result ? policyPagination(result) : null
  const goPage = (next: number) => navigate(`/renshi?audience=${audience}&page=${next}`)
  return <PolicyTouchLayout eyebrow={`查政策 · ${label}`} title={result ? `${result.total} 条政策` : failed ? '这次没读到政策' : '正在读取政策'}
    sub="按更新时间排列 · 每条写明发布机构" askPrompt={POLICY_ASK_LIST} state={failed ? 'failed' : result ? 'list' : 'loading'}>
    {!result ? <PolicyReadState failed={failed} retry={() => setAttempt((value) => value + 1)} /> : <>
      <div className="policy-min-list" data-testid="renshi-policy-list">
        {result.items.map((policy) => <button type="button" className="policy-min-card qxt-rise" key={policy.id}
          data-policy-id={policy.id} onClick={() => navigate(`/renshi?policy=${encodeURIComponent(policy.id)}`)}>
          <b>{policy.title}</b>
          <span className="policy-min-summary">{policy.summary || '发布机构没有提供摘要'}</span>
          <span className="policy-min-meta"><span>{policy.sourceName || '发布机构未提供'}</span>
            <span>更新于 {policyPublishedOn(policy) ?? '日期未提供'}</span>
            {policy.requiredMaterials?.trim() && <span className="policy-min-chip">有材料清单</span>}
            {policy.externalUrlVerified === true && <span className="policy-min-chip">可扫码看原文</span>}
          </span>
        </button>)}
      </div>
      {result.items.length === 0 && <p role="status">{result.total === 0 ? '这个类别还没有机构发布政策。' : '这一页没有政策，请返回上一页。'}</p>}
      {result.items.length < 3 && <PolicyChecklistSample />}
      {paging && <div className="policy-min-pagination">
        {paging.previous && <button type="button" className="policy-min-button" onClick={() => goPage(paging.page - 1)}>上一页</button>}
        <span>第 {paging.page} / {paging.pages} 页</span>
        {paging.next && <button type="button" className="policy-min-button" onClick={() => goPage(paging.page + 1)}>再看 4 条</button>}
      </div>}
      <p className="policy-min-fine">政策由发布机构自行审核发布，以官方原文为准。</p>
    </>}
  </PolicyTouchLayout>
}
