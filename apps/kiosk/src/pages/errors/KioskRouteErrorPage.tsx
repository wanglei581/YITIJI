import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom'
import { KioskStageFit } from '../../components/kiosk-shell/KioskStageFit'
import { QxTouchCallout } from '../../components/qingxu/touch/QxTouchCallout'
import { useSupportContact } from '../../hooks/useSupportContact'
import { PairCard } from '../public-touch/PublicBlocks'
import { IllusChecklist, IllusStack } from '../public-touch/PublicIllus'
import { PublicTouchFrame } from '../public-touch/PublicTouchFrame'
import './route-error-touch.css'

/**
 * 路由出错页与未知地址页。只有两个出口：重新打开（真重载）和回首页。
 * 不链到帮助页，不给设备状态或问小青；不判断打印是否在出。号码读不到就不显示求助句。
 */
export function KioskRouteErrorPage({ notFound = false }: { notFound?: boolean }) {
  const routeError = useRouteError()
  const navigate = useNavigate()
  const contact = useSupportContact()
  const isNotFound = notFound || (isRouteErrorResponse(routeError) && routeError.status === 404)
  const phoneLine = contact.servicePhone
    ? `需要帮助？拨打服务电话 ${contact.servicePhone}${contact.serviceHours ? `（${contact.serviceHours}）` : ''}`
    : null
  const reopen = () => window.location.reload()
  const goHome = () => navigate('/', { replace: true })

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
          main
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
              <button type="button" className="qxt-btn qxt-btn-sec qxt-fill" onClick={reopen}>重新打开</button>
              <button type="button" className="qxt-btn qxt-btn-pri qxt-fill" onClick={goHome}>回首页</button>
            </footer>
          )}
        >
          <div className="qxp-grow">
            <QxTouchCallout kind="howto" icon="alert">
              {isNotFound ? '这个入口现在没有对应的页面。' : '这次没有完成。'}
            </QxTouchCallout>
            <div className="qxp-pair qxp-pair-grow">
              <PairCard title="重新打开" desc="再载入这一页" art={<IllusChecklist w={200} />} onClick={reopen} />
              <PairCard title="回首页" desc="改简历、练面试、打印扫描、查政策" art={<IllusStack w={200} n={3} />} onClick={goHome} />
            </div>
            {phoneLine ? <QxTouchCallout kind="remind">{phoneLine}</QxTouchCallout> : null}
          </div>
        </PublicTouchFrame>
      </div>
    </KioskStageFit>
  )
}

export default KioskRouteErrorPage
