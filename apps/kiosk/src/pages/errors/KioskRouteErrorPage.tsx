import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom'
import { KioskStageFit } from '../../components/kiosk-shell/KioskStageFit'
import { useSupportContact } from '../../hooks/useSupportContact'
import { PublicTouchFrame } from '../public-touch/PublicTouchFrame'

export function KioskRouteErrorPage({ notFound = false }: { notFound?: boolean }) {
  const routeError = useRouteError()
  const navigate = useNavigate()
  const contact = useSupportContact()
  const isNotFound = notFound || (isRouteErrorResponse(routeError) && routeError.status === 404)
  const phoneLine = contact.servicePhone
    ? `需要帮助？拨打服务电话 ${contact.servicePhone}${contact.serviceHours ? `（${contact.serviceHours}）` : ''}`
    : null

  return (
    <KioskStageFit>
      <div
        className="fusion-w5 fusion-w5--system"
        data-kiosk-screen="route-error"
        data-kiosk-presentation="fusion-youth"
        data-state={isNotFound ? 'not-found' : 'error'}
      >
        <PublicTouchFrame
          title={isNotFound ? '页面不存在' : '这一页打不开'}
          sub={isNotFound
            ? '当前入口可能已经调整，请返回首页重新选择服务。'
            : '这次没有打开。可以重新打开这一页，或回首页再选。'}
          eyebrow="页面"
          status={{ tone: 'warn', label: isNotFound ? '没有这一页' : '这一页没打开' }}
          back={false}
          nav={false}
          screen="route-error"
          dock={(
            <footer className="qxt-dock">
              <button type="button" className="qxt-btn qxt-btn-sec" onClick={() => navigate('/', { replace: true })}>
                回首页
              </button>
              <button type="button" className="qxt-btn qxt-btn-pri qxt-wide" onClick={() => window.location.reload()}>
                重新打开
              </button>
            </footer>
          )}
        >
          <p className="qxp-note">
            {isNotFound
              ? '当前入口可能已经调整，请返回首页重新选择服务。'
              : '本次操作没有完成。重新打开会再加载一次；已经交出去的打印任务不会因此取消。'}
          </p>
          {phoneLine ? <p className="qxp-remind">{phoneLine}</p> : null}
        </PublicTouchFrame>
      </div>
    </KioskStageFit>
  )
}

export default KioskRouteErrorPage
