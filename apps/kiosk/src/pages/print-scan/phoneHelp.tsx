import { helpNeededLine } from '../../copy/unattendedCopy'
import { useSupportContact } from '../../hooks/useSupportContact'

/**
 * 有服务电话才出这一句。读不到号码就不显示。
 * 号码自己负责加载并在到手后自己重画：直接落到本屏（屏保唤醒、深链）时会话缓存还是空的，
 * 只在外壳里触发加载没用——外壳重画不会重画父页面传下来的子节点。
 */
export function PhoneHelpLine() {
  const contact = useSupportContact()
  if (!contact.servicePhone) return null
  return <p className="qxt-fine" data-testid="service-phone-line">{helpNeededLine(contact)}</p>
}
