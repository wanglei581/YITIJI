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
  type AdminFilePurpose,
  type AdminFileRecord,
  type AdminFileSensitive,
} from '../../services/api'
import type { FileRetentionPolicy } from '@ai-job-print/shared'
import {
  CLEAN_FILTERS,
  SENSITIVE_FILTERS,
  TYPE_FILTERS,
  toViewFile,
} from './fileMeta'
import { RETENTION_FILTERS } from './retentionMeta'
import { RetentionSummary } from './RetentionSummary'
import { FileTable } from './FileTable'

const TYPE_FILTERS_TO_PURPOSE: Record<string, AdminFilePurpose | string | undefined> = {
  全部: undefined,
  简历上传: 'resume_upload',
  简历扫描: 'resume_scan',
  身份证: 'id_scan',
  打印文档: 'print_doc',
  招聘会资料: 'fair_material,job_fair_material',
  求职信: 'cover_letter',
}
const SENSITIVE_FILTERS_TO_LEVEL: Record<string, AdminFileSensitive | undefined> = {
  全部: undefined,
  高敏感: 'highly_sensitive',
  中敏感: 'sensitive',
  低敏感: 'normal',
}
const CLEAN_FILTERS_TO_STATUS: Record<string, 'active' | 'scheduled' | 'cleaned' | undefined> = {
  全部: undefined,
  有效期内: 'active',
  待清理: 'scheduled',
  已清理: 'cleaned',
}
const RETENTION_FILTERS_TO_POLICY: Record<string, FileRetentionPolicy | undefined> = {
  全部: undefined,
  保存3个月: 'months_3',
  保存6个月: 'months_6',
  长期保存: 'long_term',
  系统短期: 'system_short',
}

function resolveSignedUrl(signedUrl: string): string {
  if (signedUrl.startsWith('http://') || signedUrl.startsWith('https://')) return signedUrl
  const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, '')
  return origin + signedUrl
}

function openDeferredPreviewWindow(): Window | null {
  const previewWindow = window.open('about:blank', '_blank')
  if (!previewWindow) return null
  previewWindow.opener = null
  const referrerPolicy = previewWindow.document.createElement('meta')
  referrerPolicy.name = 'referrer'
  referrerPolicy.content = 'no-referrer'
  previewWindow.document.head.append(referrerPolicy)
  previewWindow.document.title = '正在打开文件'
  return previewWindow
}

export default function FilesPage() {
  const [files, setFiles] = useState<AdminFileRecord[]>([])
  const [total, setTotal] = useState(0)
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
      listFiles({
        includeDeleted: true,
        purpose: typeFilter === '全部' ? undefined : TYPE_FILTERS_TO_PURPOSE[typeFilter],
        sensitiveLevel: sensitiveFilter === '全部' ? undefined : SENSITIVE_FILTERS_TO_LEVEL[sensitiveFilter],
        cleanStatus: cleanFilter === '全部' ? undefined : CLEAN_FILTERS_TO_STATUS[cleanFilter],
        retentionPolicy: retentionFilter === '全部' ? undefined : RETENTION_FILTERS_TO_POLICY[retentionFilter],
        search: search.trim() || undefined,
        page,
        pageSize,
      }),
      getFileLifecycleSummary(),
    ])
      .then(([filePage, lifecycle]) => {
        setFiles(filePage.items)
        setTotal(filePage.total)
        setSummary(lifecycle)
        setNow(Date.now())
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [cleanFilter, page, pageSize, retentionFilter, search, sensitiveFilter, typeFilter])

  useEffect(() => { load() }, [load])

  const views = useMemo(() => files.map((f) => toViewFile(f, now)), [files, now])

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
    const previewWindow = openDeferredPreviewWindow()
    if (!previewWindow) {
      setNotice('浏览器阻止了文件窗口，请允许本站打开新窗口后重试')
      return
    }
    setBusyId(id)
    setNotice(null)
    getFileSignedUrl(id)
      .then((res) => { previewWindow.location.replace(resolveSignedUrl(res.signedUrl)) })
      .catch((e: unknown) => {
        previewWindow.close()
        setNotice(`获取访问链接失败：${e instanceof Error ? e.message : '请稍后重试'}`)
      })
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
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-sm">
          <ShieldAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" />
          <div className="text-warning-fg">
            {highSensitiveCount > 0 && <span>{highSensitiveCount} 个高敏感文件仍在有效期内；</span>}
            {expiredPending > 0 && <span>{expiredPending} 个文件已过期待清理。</span>}
          </div>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-neutral-500">当前列表 {total} 个文件；顶部统计为全库只读口径</p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCleanupExpired}
            disabled={cleaning}
            className="flex items-center gap-1.5 rounded-lg border border-warning/30 bg-surface px-3 py-1.5 text-xs text-warning-fg hover:bg-warning-bg disabled:opacity-50"
          >
            <Trash2Icon className="h-3.5 w-3.5" />{cleaning ? '清理中...' : '清理过期文件'}
          </button>
          <button onClick={load} className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-surface px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50">
            <RefreshCwIcon className="h-3.5 w-3.5" />刷新
          </button>
        </div>
      </div>

      {notice && (
        <div className="mb-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-600">{notice}</div>
      )}

      <div className="mb-4 space-y-2">
        {[
          ['文件类型', TYPE_FILTERS, typeFilter, setTypeFilter],
          ['敏感级别', SENSITIVE_FILTERS, sensitiveFilter, setSensitiveFilter],
          ['清理状态', CLEAN_FILTERS, cleanFilter, setCleanFilter],
          ['保存策略', RETENTION_FILTERS, retentionFilter, setRetentionFilter],
        ].map(([label, options, selected, setter]) => (
          <div key={label as string} className="flex items-center gap-2">
            <span className="w-14 text-xs text-neutral-400">{label as string}</span>
            <div className="flex flex-wrap gap-2">
              {(options as readonly string[]).map((f) => (
                <button
                  key={f}
                  onClick={() => resetPage(setter as (value: string) => void, f)}
                  className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${selected === f ? 'border-primary-600 bg-primary-600 text-white' : 'border-neutral-900/10 bg-surface text-neutral-700 hover:border-primary-600/40'}`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="relative mt-2">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索文件名、用户..." className="h-8 w-64 rounded-lg border border-neutral-200 bg-surface pl-8 pr-3 text-xs text-neutral-700 placeholder-neutral-400 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200" />
          <svg className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" /></svg>
        </div>
      </div>

      <FileTable
        loading={loading}
        error={error}
        search={search}
        files={views}
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

      <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-xs text-neutral-500">
        <p className="font-medium text-neutral-600">文件安全合规说明</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          <li>身份证、简历、求职信等敏感文件按保存策略自动清理；长期保存只适用于用户确认后的成果物</li>
          <li>管理员「查看文件」走后端临时签名 URL（短有效期），「手动删除」「清理过期文件」均物理删除并写入日志审计，不可撤销</li>
          <li>管理员只能查看生命周期状态，不能代替用户设置 6 个月或长期保存</li>
        </ul>
      </div>
    </Page>
  )
}
