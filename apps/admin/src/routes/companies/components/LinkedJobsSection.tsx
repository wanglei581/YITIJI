import { useCallback, useEffect, useState } from 'react'
import { Card, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import { LinkIcon, SearchIcon } from 'lucide-react'
import { DangerDeleteButton, InlineError, InlineSuccess } from '../../../components/form'
import { JOB_CATEGORY_LABELS, PUBLISH_BADGE, errMsg, inputCls } from './shared'
import { companiesAdminService, type AdminCompanyDetail, type CompanyLinkableJob } from '../../../services/api/companiesAdmin'

export function LinkedJobsSection({ detail, onMutated }: { detail: AdminCompanyDetail; onMutated: () => void }) {
  const [keyword, setKeyword] = useState('')
  const [linkable, setLinkable] = useState<CompanyLinkableJob[]>([])
  const [searchState, setSearchState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [busyJobId, setBusyJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const search = useCallback(async (kw: string) => {
    setSearchState('loading')
    try {
      const rows = await companiesAdminService.listLinkableJobs(detail.id, kw)
      setLinkable(rows)
      setSelected(new Set())
      setSearchState('ready')
    } catch {
      setSearchState('error')
    }
  }, [detail.id])

  useEffect(() => { void search('') }, [search])

  const toggle = (jobId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(jobId)) next.delete(jobId)
      else next.add(jobId)
      return next
    })
  }

  const link = async () => {
    if (selected.size === 0) return
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await companiesAdminService.linkJobs(detail.id, Array.from(selected))
      setSuccess(
        result.rejected.length > 0
          ? `已关联 ${result.linked} 个岗位；${result.rejected.length} 个岗位不符合条件（须同来源机构且已审核发布）被跳过`
          : `已关联 ${result.linked} 个岗位`,
      )
      onMutated()
      await search(keyword)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const unlink = async (jobId: string) => {
    setBusyJobId(jobId)
    setError(null)
    setSuccess(null)
    try {
      await companiesAdminService.unlinkJob(detail.id, jobId)
      setSuccess('已移除关联')
      onMutated()
      await search(keyword)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusyJobId(null)
    }
  }

  return (
    <Card className="space-y-4 p-4">
      <p className="text-sm font-medium text-gray-700">关联岗位（{detail.linkedJobs.length}）</p>
      <InlineError message={error} />
      <InlineSuccess message={success} />

      {/* 已关联岗位 */}
      {detail.linkedJobs.length === 0 ? (
        <p className="rounded-lg bg-gray-50 px-3 py-3 text-center text-xs text-gray-400">暂无关联岗位，可在下方搜索同来源机构的已发布岗位进行关联</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
          {detail.linkedJobs.map((j) => (
            <li key={j.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-800">{j.title}</p>
                <p className="text-xs text-gray-400">
                  {j.city || '—'} · {j.category ? JOB_CATEGORY_LABELS[j.category] ?? j.category : '—'}
                </p>
              </div>
              <StatusBadge status={PUBLISH_BADGE[j.publishStatus]?.status ?? 'default'} label={PUBLISH_BADGE[j.publishStatus]?.label ?? j.publishStatus} />
              <DangerDeleteButton onConfirm={() => void unlink(j.id)} busy={busyJobId === j.id} confirmText="确认移除?" />
            </li>
          ))}
        </ul>
      )}

      {/* 可关联岗位搜索 */}
      <div className="space-y-2 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
        <p className="text-xs font-medium text-gray-600">添加关联（仅同来源机构、已审核发布的岗位可关联）</p>
        <div className="flex gap-2">
          <input
            className={inputCls}
            placeholder="按岗位名称搜索"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void search(keyword) }}
          />
          <button
            onClick={() => void search(keyword)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            <SearchIcon className="h-4 w-4" />
            搜索
          </button>
        </div>
        {searchState === 'loading' && <LoadingState className="py-6" />}
        {searchState === 'error' && <ErrorState className="py-6" onRetry={() => void search(keyword)} />}
        {searchState === 'ready' && linkable.length === 0 && (
          <p className="py-4 text-center text-xs text-gray-400">没有可关联的岗位</p>
        )}
        {searchState === 'ready' && linkable.length > 0 && (
          <>
            <ul className="max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-100 bg-white">
              {linkable.map((j) => (
                <li key={j.id}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300"
                      checked={selected.has(j.id)}
                      onChange={() => toggle(j.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-gray-800">{j.title}</p>
                      <p className="text-xs text-gray-400">
                        {j.city || '—'} · {j.category ? JOB_CATEGORY_LABELS[j.category] ?? j.category : '—'}
                        {j.companyProfileId ? ' · 已关联其他企业，关联后将转移' : ''}
                      </p>
                    </div>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <button
                disabled={busy || selected.size === 0}
                onClick={() => void link()}
                className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <LinkIcon className="h-3.5 w-3.5" />
                {busy ? '关联中…' : `关联所选（${selected.size}）`}
              </button>
            </div>
          </>
        )}
      </div>
    </Card>
  )
}
