import { useCallback, useEffect, useState } from 'react'
import { Card, EmptyState, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import { Building2Icon, PlusIcon, SearchIcon } from 'lucide-react'
import { Page } from '../Page'
import { CompanyDetailDrawer } from './components/CompanyDetailDrawer'
import { CreateCompanyDrawer } from './components/CreateCompanyDrawer'
import {
  PUBLISH_BADGE,
  PUBLISH_FILTER_OPTIONS,
  REVIEW_BADGE,
  REVIEW_FILTER_OPTIONS,
  companyTypeLabel,
  industryLabel,
  inputCls,
  regionLabel,
} from './components/shared'
import {
  companiesAdminService,
  type AdminCompanyListItem,
  type CompanyListFilters,
} from '../../services/api/companiesAdmin'

// ============================================================
// 企业展示管理（CompanyProfile）
//
// 合规定位（长期红线）：企业展示 = 来源企业与岗位导览，不是招聘平台。
// 只管理展示信息与岗位关联；不收简历、无平台内投递、
// 无候选人 / 简历筛查 / 面试 / Offer 任何能力。
// ============================================================

export default function CompaniesPage() {
  const [reviewStatus, setReviewStatus] = useState('')
  const [publishStatus, setPublishStatus] = useState('')
  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [rows, setRows] = useState<AdminCompanyListItem[]>([])
  const [listState, setListState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const loadList = useCallback(async () => {
    setListState('loading')
    const filters: CompanyListFilters = {
      reviewStatus: reviewStatus || undefined,
      publishStatus: publishStatus || undefined,
      keyword: keyword || undefined,
    }
    try {
      const data = await companiesAdminService.listCompanies(filters)
      setRows(data)
      setListState('ready')
    } catch {
      setListState('error')
    }
  }, [reviewStatus, publishStatus, keyword])

  useEffect(() => { void loadList() }, [loadList])

  /** 抽屉内操作成功后刷新列表（不打断抽屉）。 */
  const refreshList = useCallback(() => { void loadList() }, [loadList])

  const hasFilter = Boolean(reviewStatus || publishStatus || keyword)

  return (
    <Page
      title="企业展示管理"
      subtitle="来源企业展示信息运营 — 审核 · 发布 · 展示资料 · 岗位关联（仅信息展示，不参与招聘闭环）"
      actions={
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          <PlusIcon className="h-4 w-4" />
          新增企业
        </button>
      }
    >
      {/* 筛选条 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className={`${inputCls} w-auto`} value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)}>
          {REVIEW_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={publishStatus} onChange={(e) => setPublishStatus(e.target.value)}>
          {PUBLISH_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="flex flex-1 gap-2 sm:max-w-sm">
          <input
            className={inputCls}
            placeholder="按企业名称搜索"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setKeyword(keywordInput.trim()) }}
          />
          <button
            onClick={() => setKeyword(keywordInput.trim())}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
          >
            <SearchIcon className="h-4 w-4" />
            搜索
          </button>
        </div>
      </div>

      {listState === 'loading' && <LoadingState className="py-24" />}
      {listState === 'error' && <ErrorState className="py-24" onRetry={() => void loadList()} />}
      {listState === 'ready' && rows.length === 0 && (
        <EmptyState
          className="py-24"
          title={hasFilter ? '没有符合筛选条件的企业' : '暂无企业数据'}
          description={
            hasFilter
              ? '调整筛选条件或关键词后重试。'
              : '企业由合作机构导入或管理员手工新增，审核通过并发布后在一体机「找企业」展示。'
          }
        />
      )}

      {listState === 'ready' && rows.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-100 bg-neutral-50">
                <tr>
                  {['企业名称', '来源机构', '地区', '行业', '类型', '审核状态', '发布状态', '关联岗位', '操作'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-neutral-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map((c) => (
                  <tr key={c.id} className="cursor-pointer hover:bg-neutral-50" onClick={() => setSelectedId(c.id)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Building2Icon className="h-4 w-4 shrink-0 text-neutral-400" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-neutral-800">{c.name}</p>
                          {c.fairParticipant && <p className="text-xs text-neutral-400">招聘会参展</p>}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{c.sourceName}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{regionLabel(c)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{industryLabel(c.industry)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{companyTypeLabel(c.companyType)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge status={REVIEW_BADGE[c.reviewStatus]?.status ?? 'default'} label={REVIEW_BADGE[c.reviewStatus]?.label ?? c.reviewStatus} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge status={PUBLISH_BADGE[c.publishStatus]?.status ?? 'default'} label={PUBLISH_BADGE[c.publishStatus]?.label ?? c.publishStatus} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">{c.linkedJobCount}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedId(c.id)
                        }}
                        className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                      >
                        管理
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="mt-6 text-xs text-neutral-400">
        企业展示模块仅提供来源企业信息与岗位导览：展示来源机构提供并经审核的企业资料；系统不接收求职者简历，不参与招聘闭环。
      </p>

      <CompanyDetailDrawer
        companyId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={refreshList}
      />

      <CreateCompanyDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false)
          refreshList()
          setSelectedId(id)
        }}
      />
    </Page>
  )
}
