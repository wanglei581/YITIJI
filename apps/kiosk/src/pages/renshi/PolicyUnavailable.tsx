import { QxTouchArtChecklist } from '../../components/qingxu/touch/QxTouchArt'
import { PolicyChecklistSample } from './PolicyTouchLayout'
import type { PolicyGoneCopy } from './policySearchModel'

/** 从收藏或浏览记录打开已经 404，以及正在看时过了截止日期。两态文案由 policyGoneCopy 给出。 */
export function PolicyUnavailable({ copy, onHome, onKiosk }: {
  copy: PolicyGoneCopy
  onHome: () => void
  onKiosk: () => void
}) {
  return <>
    <section className="policy-min-section policy-search-status" role="status">
      <div>
        <h2>{copy.heading}</h2>
        <ul>{copy.items.map((item) => <li key={item}>{item}</li>)}</ul>
        {copy.note && <p className="policy-min-fine">{copy.note}</p>}
      </div>
      <QxTouchArtChecklist width={280} />
    </section>
    <div className="policy-min-grid">
      <button type="button" className="policy-gone-action" aria-label="返回政策首页" onClick={onHome}>
        <b>返回政策首页</b><small>看现在发布的政策</small>
      </button>
      <button type="button" className="policy-gone-action" aria-label="回首页办别的事" onClick={onKiosk}>
        <b>回首页办别的事</b><small>打印、扫描、改简历、练面试照常</small>
      </button>
    </div>
    <PolicyChecklistSample />
    <p className="policy-min-fine">政策由发布机构自行审核发布，以官方原文为准。</p>
  </>
}
