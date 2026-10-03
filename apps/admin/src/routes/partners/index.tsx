import { useCallback, useEffect, useState } from 'react'
import type { PartnerType } from '@ai-job-print/shared'
import { Card, ErrorState, LoadingState } from '@ai-job-print/ui'
import { PlusIcon } from 'lucide-react'
import { Page } from '../Page'
import { useTableState } from '../components/DataTable'
import { orgsAdminService, type AdminOrgListItem } from '../../services/api/orgsAdmin'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { useRecruitmentHosting } from '../components/recruitment/useRecruitmentHosting'
import { CreateOrgDrawer } from './CreateOrgDrawer'
import { OrgDetailDrawer } from './OrgDetailDrawer'
import { PartnerFilters } from './PartnerFilters'
import { PartnerTable } from './PartnerTable'
import { STATUS_FILTERS } from './orgPresentation'

export default function PartnersPage() {
  const [orgs, setOrgs] = useState<AdminOrgListItem[]>([])
  const [listState, setListState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('全部')
  const [typeFilter, setTypeFilter] = useState<PartnerType | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [detailOrgId, setDetailOrgId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const { page, pageSize, search, setPage, setPageSize, setSearch } = useTableState(20)
  const hosting = useRecruitmentHosting()
  const showRecruitment = hosting.status === 'ready' && hosting.enabled

  const load = useCallback(async () => {
    setListState('loading')
    try {
      setOrgs(await orgsAdminService.listOrgs())
      setListState('ready')
    } catch {
      setListState('error')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const toggleOrg = async (org: AdminOrgListItem) => {
    setBusyId(org.id)
    setActionError(null)
    try {
      await orgsAdminService.setOrgStatus(org.id, org.enabled ? 'disable' : 'enable')
      await load()
    } catch (e) {
      setActionError(userMessageOf(e, org.enabled ? '停用失败，请稍后重试' : '启用失败，请稍后重试'))
    } finally {
      setBusyId(null)
    }
  }

  const filtered = orgs.filter((o) => {
    const matchStatus =
      statusFilter === '全部' || (statusFilter === '合作中' ? o.enabled : !o.enabled)
    const matchType = typeFilter === null || o.type === typeFilter
    return matchStatus && matchType
  })

  const searched = search.trim()
    ? filtered.filter((o) => o.name.includes(search) || (o.contact ?? '').includes(search))
    : filtered

  const total = searched.length
  const paginated = searched.slice((page - 1) * pageSize, page * pageSize)

  const statusCounts = {
    全部: orgs.length,
    合作中: orgs.filter((o) => o.enabled).length,
    已停用: orgs.filter((o) => !o.enabled).length,
  }

  return (
    <Page
      title="合作机构管理"
      subtitle={`共 ${orgs.length} 家合作机构 — 机构档案 · 授权启停 · 内容可信 · 官方域名与渠道 · 资质核验 · 后台账号`}
      actions={
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          <PlusIcon className="h-4 w-4" />
          新增机构
        </button>
      }
    >
      {listState === 'loading' && <LoadingState className="py-24" />}
      {listState === 'error' && <ErrorState className="py-24" onRetry={() => void load()} />}
      {actionError && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error-bg px-4 py-2.5 text-sm text-error-fg" role="alert">
          {actionError}。请刷新后重试。
        </div>
      )}

      {listState === 'ready' && (
        <>
          <PartnerFilters statusFilter={statusFilter} setStatusFilter={setStatusFilter} typeFilter={typeFilter}
            setTypeFilter={setTypeFilter} statusCounts={statusCounts} search={search} setSearch={setSearch} onResetPage={() => setPage(1)} />
          <Card className="overflow-hidden p-0">
            <PartnerTable items={paginated} total={total} page={page} pageSize={pageSize} search={search}
              onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
              showRecruitment={showRecruitment} onDetail={setDetailOrgId} onToggle={toggleOrg} busyId={busyId} />
          </Card>

          <p className="mt-3 text-xs text-neutral-400">
            {showRecruitment
              ? '合作机构是外部岗位、招聘会与政策数据的来源方。停用机构后，该机构账号不能登录，数据导入会被拒绝（已发布内容需到信息源逐条下架）。'
              : '合作机构在本平台维护政策与官方渠道。停用机构后，该机构账号不能登录。'}
            「内容可信」决定该机构的{showRecruitment ? '岗位、招聘会与政策' : '政策与官方渠道'}
            <strong>能不能被发布</strong>
            ：状态为「内容可信」且机构未归档，在机构详情里核验与变更。
            所有操作记录审计日志；不存在企业招聘端，不接收求职者简历。
          </p>
        </>
      )}

      <CreateOrgDrawer showRecruitment={showRecruitment} open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => void load()} />
      <OrgDetailDrawer
        orgId={detailOrgId}
        open={detailOrgId !== null}
        showRecruitment={showRecruitment}
        onClose={() => setDetailOrgId(null)}
        onChanged={() => void load()}
      />
    </Page>
  )
}
