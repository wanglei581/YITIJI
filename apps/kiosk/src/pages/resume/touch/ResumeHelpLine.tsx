// 页脚求助句：服务电话（号码从后台读，读不到只写去哪里查）加一个去帮助中心的按钮。
// 现场没有工作人员，这里不写「找 / 联系工作人员」；帮助中心是站内自助常见问题页。
import { helpNeededLine } from '../../../copy/unattendedCopy'

export function ResumeHelpLine({ lead, onHelp }: { lead?: string; onHelp: () => void }) {
  return (
    <p className="rtp-help">
      {lead ? <>{lead}{' '}</> : null}
      {helpNeededLine()}
      <button type="button" className="rtp-help-link" data-route="/help" onClick={onHelp}>帮助中心</button>
    </p>
  )
}
