import { helpNeededLine, peekSupportContact } from '../../copy/unattendedCopy'

/** 有服务电话才出这一句。读不到号码就不显示。 */
export function PhoneHelpLine() {
  if (!peekSupportContact().servicePhone) return null
  return <p className="qxt-fine" data-testid="service-phone-line">{helpNeededLine()}</p>
}
