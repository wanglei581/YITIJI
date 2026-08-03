import { getKioskPresentationAttributes, KioskTopbar } from '@ai-job-print/ui'
import { HomeIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom'
import { KioskStageFit } from '../../components/kiosk-shell/KioskStageFit'

export function KioskRouteErrorPage() {
  const routeError = useRouteError()
  const navigate = useNavigate()
  const isNotFound = isRouteErrorResponse(routeError) && routeError.status === 404

  return (
    <KioskStageFit>
      <div
        {...getKioskPresentationAttributes('fusion-youth', 'kiosk')}
        className="ui-kiosk-shell flex h-full flex-col overflow-hidden bg-canvas"
        data-kiosk-screen="route-error"
      >
        <KioskTopbar
          brandTitle="就业服务大厅"
          brandSubtitle="AI求职打印服务终端"
          right={<span className="k-status-chip" data-tone="warning" role="status">页面恢复指引</span>}
        />

        <main className="flex flex-1 items-center justify-center px-12 py-16">
          <section className="w-full max-w-3xl rounded-3xl border border-stroke bg-white p-14 text-center shadow-sm">
            <span className="mx-auto flex size-24 items-center justify-center rounded-full bg-amber-50 text-amber-700">
              <TriangleAlertIcon className="size-12" aria-hidden="true" />
            </span>
            <h1 className="mt-8 font-serif text-5xl font-semibold text-ink">
              {isNotFound ? '页面不存在' : '页面暂时无法显示'}
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-2xl leading-relaxed text-muted">
              {isNotFound
                ? '当前入口可能已经调整，请返回首页重新选择服务。'
                : '本次操作没有完成。你可以重新加载页面，或返回首页选择其他服务。'}
            </p>

            <div className="mt-10 flex justify-center gap-5">
              <button
                type="button"
                className="inline-flex min-h-16 min-w-52 items-center justify-center gap-3 rounded-2xl border border-stroke bg-white px-8 text-2xl font-semibold text-ink"
                onClick={() => window.location.reload()}
              >
                <RefreshCwIcon aria-hidden="true" />
                重试页面
              </button>
              <button
                type="button"
                className="inline-flex min-h-16 min-w-52 items-center justify-center gap-3 rounded-2xl bg-emerald-700 px-8 text-2xl font-semibold text-white"
                onClick={() => navigate('/', { replace: true })}
              >
                <HomeIcon aria-hidden="true" />
                返回首页
              </button>
            </div>
          </section>
        </main>
      </div>
    </KioskStageFit>
  )
}

export default KioskRouteErrorPage
