import { useCallback, useEffect, useMemo, useState } from 'react'
import { Page } from '../Page'
import { ShieldAlertIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react'
import { useTableState } from '../components/DataTable'
import {
  API_BASE_URL,
  cleanupExpiredFiles,
  deleteFile,
  getFileLifecycleSummary,
  getFileSignedUrl,
  listFiles,
  type AdminFileLifecycleSummary,
  type AdminFileRecord,
} from '../../services/api'
import {
  CLEAN_FILTERS,
  CLEAN_MAP,
  SENSITIVE_FILTERS,
  TYPE_FILTERS,
  toViewFile,
} from './fileMeta'
import { RETENTION_FILTERS, retentionPolicyLabel } from './retentionMeta'
import { RetentionSummary } from './RetentionSummary'
import { FileTable } from './FileTable'

function resolveSignedUrl(signedUrl: string): string {
  if (signedUrl.startsWith('http://') || signedUrl.startsWith('https://')) return signedUrl
  const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, '')
  return origin + signedUrl
}

export default function FilesPage() {
  const [files, setFiles] = useState<AdminFileRecord[]>([])
  const [summary, setSummary] = useState<AdminFileLifecycleSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [cleaning, setCleaning] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const [typeFilter, setTypeFilter] = useState('全部')
  const [sensitiveFilter, setSensitiveFilter] = useState('全部')
  const [cleanFilter, setCleanFilter] = useState('全部')
  const [retentionFilter, setRetentionFilter] = useState('全部')
  const { page, pageSize, search, setPage, setPageSize, setSearch } = useTableState(20)

  const load = useCallback(() => {
    setLoading(true)
    setError(false)
    Promise.all([
      listFiles({ includeDeleted: true, limit: 200 }),
      getFileLifecycleSummary(),
    ])
      .then(([rows, lifecycle]) => {
        setFiles(rows)
        setSummary(lifecycle)
        setNow(Date.now())
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const views = useMemo(() => files.map((f) => toViewFile(f, now)), [files, now])

  const filtered = views.filter((v) => {
    const matchType = typeFilter === '全部' || v.typeLabel === typeFilter
    const matchSensitive = sensitiveFilter === '全部' || v.sensitiveLabel === sensitiveFilter
    const matchClean = cleanFilter === '全部' || CLEAN_MAP[v.clean].label === cleanFilter
    const matchRetention = retentionFilter === '全部' || retentionPolicyLabel(v.raw.retentionPolicy) === retentionFilter
    return matchType && matchSensitive && matchClean && matchRetention
  })

  const searched = search.trim()
    ? filtered.filter((v) => v.name.includes(search) || v.user.includes(search))
    : filtered

  const total = searched.length
  const paginated = searched.slice((page - 1) * pageSize, page * pageSize)
  const highSensitiveCount = views.filter((v) => v.sensitive === 'high' && v.clean !== 'cleaned').length
  const expiredPending = summary?.expiredPendingCleanup ?? views.filter((v) => v.clean === 'scheduled').length

  const resetPage = (fn: (value: string) => void, value: string) => {
    fn(value)
    setPage(1)
  }

  const handleDelete = (id: string, name: string) => {
    if (busyId) return
    if (!window.confirm(`确认删除文件「${name}」？此操作将物理删除文件并写入审计，不可撤销。`)) return
    setBusyId(id)
    setNotice(null)
    deleteFile(id, '管理员手动删除')
      .then(() => { setNotice(`已删除：${name}`); load() })
      .catch((e: unknown) => setNotice(`删除失败：${e instanceof Error ? e.message : '请稍后重试'}`))
      .finally(() => setBusyId(null))
  }

  const handleView = (id: string) => {
    if (busyId) return
    setBusyId(id)
    setNotice(null)
    getFileSignedUrl(id)
      .then((res) => { window.open(resolveSignedUrl(res.signedUrl), '_blank', 'noopener,noreferrer') })
      .catch((e: unknown) => setNotice(`获取访问链接失败：${e instanceof Error ? e.message : '请稍后重试'}`))
      .finally(() => setBusyId(null))
  }

  const handleCleanupExpired = () => {
    if (cleaning) return
    if (!window.confirm('立即清理所有已过期文件？此操作会物理删除过期文件并写入审计，不可撤销。')) return
    setCleaning(true)
    setNotice(null)
    cleanupExpiredFiles()
      .then((res) => { setNotice(`已清理 ${res.deletedCount} 个过期文件`); load() })
      .catch((e: unknown) => setNotice(`清理失败：${e instanceof Error ? e.message : '请稍后重试'}`))
      .finally(() => setCleaning(false))
  }

  return (
    <Page title="文件管理" subtitle="用户文件生命周期与敏感文件清理">
      <div className="mb-4">
        <RetentionSummary summary={summary} />
      </div>

      {(highSensitiveCount > 0 || expiredPending > 0) && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm">
          <ShieldAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
          <div className="text-orange-700">
            {highSensitiveCount > 0 && <span>{highSensitiveCount} 个高敏感文件仍在有效期内；</span>}
            {expiredPending > 0 && <span>{expiredPending} 个文件已过期待清理。</span>}
          </div>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">当前列表 {total} 个文件；顶部统计为全库只读口径</p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCleanupExpired}
            disabled={cleaning}
            className="flex items-center gap-1.5 rounded-lg border border-orange-200 bg-white px-3 py-1.5 text-xs text-orange-600 hover:bg-orange-50 disabled:opacity-50"
          >
            <Trash2Icon className="h-3.5 w-3.5" />{cleaning ? '清理中...' : '清理过期文件'}
          </button>
          <button onClick={load} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
            <RefreshCwIcon className="h-3.5 w-3.5" />刷新
          </button>
        </div>
      </div>

      {notice && (
        <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-600">{notice}</div>
      )}

      <div className="mb-4 space-y-2">
        {[
          ['文件类型', TYPE_FILTERS, typeFilter, setTypeFilter],
          ['敏感级别', SENSITIVE_FILTERS, sensitiveFilter, setSensitiveFilter],
          ['清理状态', CLEAN_FILTERS, cleanFilter, setCleanFilter],
          ['保存策略', RETENTION_FILTERS, retentionFilter, setRetentionFilter],
        ].map(([label, options, selected, setter]) => (
          <div key={label as string} className="flex items-center gap-2">
            <span className="w-14 text-xs text-gray-400">{label as string}</span>
            <div className="flex flex-wrap gap-2">
              {(options as readonly string[]).map((f) => (
                <button
                  key={f}
                  onClick={() => resetPage(setter as (value: string) => void, f)}
                  className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${selected === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="relative mt-2">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索文件名、用户..." className="h-8 w-64 rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-xs text-gray-700 placeholder-gray-400 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200" />
          <svg className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" /></svg>
        </div>
      </div>

      <FileTable
        loading={loading}
        error={error}
        search={search}
        files={paginated}
        total={total}
        page={page}
        pageSize={pageSize}
        busyId={busyId}
        onRetry={load}
        onView={handleView}
        onDelete={handleDelete}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
      />

      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
        <p className="font-medium text-gray-600">文件安全合规说明</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          <li>身份证、简历、求职信等敏感文件按保存策略自动清理；长期保存只适用于用户确认后的成果物</li>
          <li>管理员「查看文件」走后端临时签名 URL（短有效期），「手动删除」「清理过期文件」均物理删除并写入日志审计，不可撤销</li>
          <li>管理员只能查看生命周期状态，不能代替用户设置 6 个月或长期保存</li>
        </ul>
      </div>
    </Page>
  )
}
