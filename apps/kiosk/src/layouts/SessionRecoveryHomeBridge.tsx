import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  acknowledgeSessionRecoveryHome,
  sessionRecoveryWantsHome,
  useSessionRecoveryNotice,
} from '../hooks/useSessionRecoveryNotice'

/** with-other：人在哪一页都换回首页。已经在首页就只把这一次导航收掉，提示留着。 */
export function SessionRecoveryHomeBridge() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const notice = useSessionRecoveryNotice()
  useEffect(() => {
    if (!sessionRecoveryWantsHome()) return
    if (pathname !== '/') navigate('/', { replace: true })
    acknowledgeSessionRecoveryHome()
  }, [notice, pathname, navigate])
  return null
}
