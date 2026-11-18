import { PolicyExitCard, PolicyStatusCard } from './policyStatus'
import type { PolicyGoneCopy } from './policySearchModel'

/** 从收藏或浏览记录打开已经 404，以及正在看时过了截止日期。两态文案由 policyGoneCopy 给出。 */
export function PolicyUnavailable({ copy, onHome, onKiosk }: {
  copy: PolicyGoneCopy
  onHome: () => void
  onKiosk: () => void
}) {
  const expired = copy.title === '这条政策已过截止日期'
  return <>
    <PolicyStatusCard icon={expired ? 'clock' : 'help'} title={copy.heading} chip="有政策时可以打印这样一页" artWidth={380}>
      <ul>{copy.items.map((item) => <li key={item}>{item}</li>)}</ul>
      {copy.note && <p className="policy-min-fine">{copy.note}</p>}
    </PolicyStatusCard>
    <div className="policy-exit-grid">
      <PolicyExitCard icon="landmark" title="返回政策首页" desc="看现在发布的政策" onClick={onHome} />
      <PolicyExitCard icon="home" title="回首页办别的事" desc="打印、扫描、改简历、练面试照常" onClick={onKiosk} />
    </div>
    <p className="policy-min-fine">政策由发布机构自行审核发布，以官方原文为准。</p>
  </>
}
