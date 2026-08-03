import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { UserCogIcon } from 'lucide-react'

export default function AccountPage() {
  return (
    <Page title="账号权限" subtitle="机构子账号与操作权限管理">
      <EmptyState
        icon={UserCogIcon}
        title="账号与角色由平台侧统一管理"
        description="机构子账号与细粒度权限本阶段不开放自助配置。需要增删机构账号请联系平台运营，本页不做半套 RBAC。"
      />
    </Page>
  )
}
