import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useRecruitmentHosting } from '../hooks/useRecruitmentHosting'
import { RecruitmentHostingOffPage } from '../pages/recruitment-hosting/RecruitmentHostingOffPage'

/**
 * 招聘类路由的托管闸门（next-tasks 3.13）。与百宝箱 / 智慧校园的能力边界同一形态：
 * 未打开时不挂载业务页，也就不会去请求岗位、招聘会或企业接口。
 *
 * 校招迎新和校园招聘数据在确认托管配置时，与其他招聘路由一样走说明页：
 * 带返回首页和底导航。读到关闭后仍送到 /campus，最终去向不变。
 */
const CAMPUS_CHILD_PATHS = new Set(['/campus/welcome', '/campus/freshman-insights'])

export function RecruitmentHostingBoundary() {
  const hosting = useRecruitmentHosting()
  const { pathname } = useLocation()
  if (hosting.enabled) return <Outlet />
  if (CAMPUS_CHILD_PATHS.has(pathname) && hosting.status === 'ready') {
    return <Navigate to="/campus" replace />
  }
  return <RecruitmentHostingOffPage pathname={pathname} checking={hosting.status === 'loading'} />
}
