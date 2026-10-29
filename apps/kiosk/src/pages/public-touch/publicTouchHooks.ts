import { useNavigate } from 'react-router-dom'
import { useSupportContact } from '../../hooks/useSupportContact'
import { helpNeededLine, machineCannotPrintLine } from '../../copy/unattendedCopy'

/** 底栏三项的跳转：首页、AI 顾问、我的。 */
export function usePublicNav() {
  const navigate = useNavigate()
  return {
    onHome: () => navigate('/'),
    onAdvisor: () => navigate('/assistant'),
    onProfile: () => navigate('/profile'),
  }
}

/** 有号码才返回求助句。读不到号码时不显示，也不改写成隐私政策提示。 */
export function useVisibleHelpLine(fault = false): string | null {
  const contact = useSupportContact()
  if (!contact.servicePhone) return null
  return fault ? machineCannotPrintLine(contact) : helpNeededLine(contact)
}
