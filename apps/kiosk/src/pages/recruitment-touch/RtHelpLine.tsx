import { helpNeededLine } from '../../copy/unattendedCopy'
import { useSupportContact } from '../../hooks/useSupportContact'

/**
 * 状态页里的求助句：只写服务电话（号码、服务时间都从后台读）。
 * 现场无人值守，这里不教用户去找人，只给服务电话；读不到号码时是项目统一的保守句，
 * 后台号码读到后随即换成「拨打服务电话 …」。
 */
export function RtHelpLine() {
  const contact = useSupportContact()
  return <p className="rt-note" data-testid="recruit-help-line">{helpNeededLine(contact)}</p>
}
