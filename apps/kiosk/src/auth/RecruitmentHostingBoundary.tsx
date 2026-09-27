import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useRecruitmentHosting } from '../hooks/useRecruitmentHosting'
import { RecruitmentHostingOffPage } from '../pages/recruitment-hosting/RecruitmentHostingOffPage'

/**
 * 招聘类路由的托管闸门（next-tasks 3.13）。与百宝箱 / 智慧校园的能力边界同一形态：
 * 未打开时不挂载业务页，也就不会去请求岗位、招聘会或企业接口。
 *
 * 这两条校招子页仍在旧 KioskLayout 壳里（顶栏与底栏都在），在里面再挂一层青序页头会叠出
 * 两道顶栏。关闭时把它们送到 /campus 那张整屏说明；确认中只放一行状态，不下结论。
 */
const LEGACY_SHELL_PATHS = new Set(['/campus/welcome', '/campus/freshman-insights'])

export function RecruitmentHostingBoundary() {
  const hosting = useRecruitmentHosting()
  const { pathname } = useLocation()
  if (hosting.enabled) return <Outlet />
  if (LEGACY_SHELL_PATHS.has(pathname)) {
    if (hosting.status === 'ready') return <Navigate to="/campus" replace />
    return (
      <p className="p-10 text-lg text-neutral-500" role="status" data-kiosk-screen="recruitment-hosting" data-state="checking">
        正在确认本机开通的服务
      </p>
    )
  }
  return <RecruitmentHostingOffPage pathname={pathname} checking={hosting.status === 'loading'} />
}
