import { Navigate, useSearchParams } from 'react-router-dom'
import { PolicyCategoryList } from './PolicyCategoryList'
import { PolicyDetail } from './PolicyDetail'
import { PolicyNotices } from './PolicyNotices'
import { policyAudience, policyPage } from './policyModel'

/** 路由壳只分发最小闭环；停放的旧分区统一回政策首页。 */
export function RenshiPage() {
  const [params] = useSearchParams()
  const id = params.get('policy')?.trim()
  if (id) return <PolicyDetail key={id} id={id} />
  const tab = params.get('tab')
  if (tab === 'notice') return <PolicyNotices />
  if (tab) return <Navigate to="/policy-service" replace />
  const audience = policyAudience(params.get('audience'))
  if (audience) return <PolicyCategoryList key={`${audience}:${params.get('page')}`} audience={audience} page={policyPage(params.get('page'))} />
  return <Navigate to="/policy-service" replace />
}
