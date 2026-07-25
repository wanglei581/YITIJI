import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { ShieldIcon } from 'lucide-react'

export default function PermissionsPage() {
  return (
    <Page title="权限管理" subtitle="管理员角色与操作权限">
      <EmptyState
        icon={ShieldIcon}
        title="账号与角色由平台侧统一管理"
        description="当前为粗粒度管理员 / 合作机构角色，不提供自助 RBAC 配置。开账号或调整角色请联系平台运营，本页不开放细粒度权限编辑。"
      />
    </Page>
  )
}
