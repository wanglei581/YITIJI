import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom'
import { KioskStageFit } from '../../components/kiosk-shell/KioskStageFit'
import { useSupportContact } from '../../hooks/useSupportContact'
import { PublicArt } from '../public-touch/PublicArt'
import { PublicTouchFrame } from '../public-touch/PublicTouchFrame'
import './route-error-touch.css'

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
        className="fusion-w5 fusion-w5--system ui-kiosk-shell"
        data-kiosk-screen="route-error"
        data-kiosk-presentation="fusion-youth"
        data-state={isNotFound ? 'not-found' : 'error'}
      >
        <PublicTouchFrame
          page="route-error"
          title={isNotFound ? '页面不存在' : '这一页打不开'}
          sub={isNotFound
            ? '当前入口可能已经调整，请返回首页重新选择服务。'
            : '本次操作没有完成。你可以重新打开，或返回首页选择其他服务。'}
          eyebrow="页面恢复指引"
          status={{ tone: 'warn', label: '页面恢复指引' }}
          back={false}
          nav={false}
          dock={(
            <footer className="qxt-dock">
              <button type="button" className="qxt-btn qxt-btn-sec" onClick={() => window.location.reload()}>
                重新打开
              </button>
              <button type="button" className="qxt-btn qxt-btn-pri qxt-wide" onClick={() => navigate('/', { replace: true })}>
                回首页
              </button>
            </footer>
          )}
        >
          <div className="qxp-grow">
            <p className="qxp-note">
              {isNotFound
                ? '这个入口现在没有对应的页面。'
                : '这次没有完成。重新打开会再加载一次；已经交出去的打印任务不会因此取消。'}
            </p>
            <div className="qxp-pair">
              <button type="button" className="qxp-card" onClick={() => window.location.reload()}>
                <p className="qxp-k">重新打开</p>
                <p className="qxp-note">再载入这一页</p>
                <span className="qxp-art"><PublicArt kind="list" /></span>
              </button>
              <button type="button" className="qxp-card" onClick={() => navigate('/', { replace: true })}>
                <p className="qxp-k">回首页</p>
                <p className="qxp-note">改简历、练面试、打印扫描、查政策</p>
                <span className="qxp-art"><PublicArt kind="stack" /></span>
              </button>
            </div>
            {phoneLine ? <p className="qxp-remind">{phoneLine}</p> : null}
          </div>
        </PublicTouchFrame>
      </div>
    </KioskStageFit>
  )
}

export default KioskRouteErrorPage
