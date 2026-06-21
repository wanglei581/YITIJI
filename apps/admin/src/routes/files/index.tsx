import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, StatusBadge, EmptyState } from '@ai-job-print/ui'
import { Page } from '../Page'
import { FolderIcon, ShieldAlertIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react'
import { Pagination, useTableState } from '../components/DataTable'
import {
  listFiles,
  deleteFile,
  cleanupExpiredFiles,
  getFileSignedUrl,
  API_BASE_URL,
  type AdminFileRecord,
  type AdminFilePurpose,
  type AdminFileSensitive,
} from '../../services/api'

// ─── 后端字段 → 展示映射 ─────────────────────────────────────────────────────

const PURPOSE_META: Record<AdminFilePurpose, { label: string; style: string; source: string }> = {
  resume_upload:        { label: '简历上传',   style: 'bg-blue-50 text-blue-600',     source: '用户上传' },
  resume_scan:          { label: '简历扫描',   style: 'bg-purple-50 text-purple-600', source: '扫描仪'   },
  id_scan:              { label: '身份证',     style: 'bg-red-50 text-red-600',       source: '扫描仪'   },
  print_doc:            { label: '打印文档',   style: 'bg-gray-100 text-gray-600',    source: '打印上传' },
  fair_material:        { label: '招聘会资料', style: 'bg-green-50 text-green-600',    source: '机构上传' },
  cover_letter:         { label: '求职信',     style: 'bg-blue-50 text-blue-600',     source: '用户上传' },
  partner_profile:      { label: '机构资料',   style: 'bg-teal-50 text-teal-600',     source: '机构上传' },
  partner_image:        { label: '岗位图片',   style: 'bg-teal-50 text-teal-600',     source: '机构上传' },
  partner_video:        { label: '机构视频',   style: 'bg-teal-50 text-teal-600',     source: '机构上传' },
  job_fair_material:    { label: '招聘会资料', style: 'bg-green-50 text-green-600',    source: '机构上传' },
  screensaver_material: { label: '宣传屏素材', style: 'bg-amber-50 text-amber-600',   source: '运营上传' },
  admin_upload:         { label: '管理员上传', style: 'bg-gray-100 text-gray-600',    source: '管理员'   },
  temp:                 { label: '临时文件',   style: 'bg-gray-100 text-gray-500',    source: '临时'     },
}

/** 未知 / 未来 purpose 的安全兜底,避免 PURPOSE_META 查不到字段时崩页。 */
const PURPOSE_FALLBACK = { label: '其他文件', style: 'bg-gray-100 text-gray-500', source: '其他' }

const SENSITIVE_UI: Record<AdminFileSensitive, { key: 'high' | 'medium' | 'low'; badge: 'error' | 'warning' | 'default'; label: string }> = {
  highly_sensitive: { key: 'high',   badge: 'error',   label: '高敏感' },
  sensitive:        { key: 'medium', badge: 'warning', label: '中敏感' },
  normal:           { key: 'low',    badge: 'default', label: '低敏感' },
}

type CleanStatus = 'active' | 'scheduled' | 'cleaned'
const CLEAN_MAP: Record<CleanStatus, { badge: 'success' | 'warning' | 'default'; label: string }> = {
  active:    { badge: 'success', label: '有效期内' },
  scheduled: { badge: 'warning', label: '待清理'   },
  cleaned:   { badge: 'default', label: '已清理'   },
}

const TYPE_FILTERS      = ['全部', '简历上传', '简历扫描', '身份证', '打印文档', '招聘会资料', '求职信'] as const
const SENSITIVE_FILTERS = ['全部', '高敏感', '中敏感', '低敏感'] as const
const CLEAN_FILTERS     = ['全部', '有效期内', '待清理', '已清理'] as const

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function cleanStatusOf(f: AdminFileRecord, now: number): CleanStatus {
  if (f.deletedAt !== null) return 'cleaned'
  if (f.expiresAt === null) return 'active'
  if (Date.parse(f.expiresAt) <= now) return 'scheduled'
  return 'active'
}

function cleanPolicyOf(f: AdminFileRecord, status: CleanStatus): string {
  if (status === 'cleaned') return f.deleteReason ?? '已清理'
  if (status === 'scheduled') return '已过期，待定时清理'
  if (f.expiresAt === null) return '长期保存'
  return f.sensitiveLevel === 'highly_sensitive' ? '高敏感·到期即删' : '到期自动清理'
}

interface ViewFile {
  raw: AdminFileRecord
  name: string
  user: string
  source: string
  size: string
  typeLabel: string
  typeStyle: string
  sensitive: 'high' | 'medium' | 'low'
  sensitiveBadge: 'error' | 'warning' | 'default'
  sensitiveLabel: string
  createdAt: string
  expiresAt: string
  clean: CleanStatus
  cleanPolicy: string
}

function toViewFile(f: AdminFileRecord, now: number): ViewFile {
  const meta = PURPOSE_META[f.purpose] ?? PURPOSE_FALLBACK
  const sens = SENSITIVE_UI[f.sensitiveLevel] ?? SENSITIVE_UI.normal
  const clean = cleanStatusOf(f, now)
  return {
    raw: f,
    name: f.filename,
    user: f.uploaderId ?? '匿名(Kiosk)',
    source: meta.source,
    size: fmtBytes(f.sizeBytes),
    typeLabel: meta.label,
    typeStyle: meta.style,
    sensitive: sens.key,
    sensitiveBadge: sens.badge,
    sensitiveLabel: sens.label,
    createdAt: fmtDate(f.createdAt),
    expiresAt: f.expiresAt === null ? '长期保存' : fmtDate(f.expiresAt),
    clean,
    cleanPolicy: cleanPolicyOf(f, clean),
  }
}

/** 后端返回的 signedUrl 是相对路径(/api/v1/...)，按 API 源拼成可打开的绝对地址 */
function resolveSignedUrl(signedUrl: string): string {
  const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, '')
  return origin + signedUrl
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FilesPage() {
  const [files, setFiles] = useState<AdminFileRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [cleaning, setCleaning] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const [typeFilter,      setTypeFilter]      = useState('全部')
  const [sensitiveFilter, setSensitiveFilter] = useState('全部')
  const [cleanFilter,     setCleanFilter]     = useState('全部')
  const { page, pageSize, search, setPage, setPageSize, setSearch } = useTableState(20)

  const load = useCallback(() => {
    setLoading(true)
    setError(false)
    // includeDeleted:同时展示已清理行,便于审计回看
    listFiles({ includeDeleted: true, limit: 200 })
      .then((rows) => setFiles(rows))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const now = Date.now()
  const views = useMemo(() => files.map((f) => toViewFile(f, now)), [files, now])

  const filtered = views.filter((v) => {
    const matchType      = typeFilter      === '全部' || v.typeLabel      === typeFilter
    const matchSensitive = sensitiveFilter === '全部' || v.sensitiveLabel === sensitiveFilter
    const matchClean     = cleanFilter     === '全部' || CLEAN_MAP[v.clean].label === cleanFilter
    return matchType && matchSensitive && matchClean
  })

  const searched = search.trim()
    ? filtered.filter((v) => v.name.includes(search) || v.user.includes(search))
    : filtered

  const total = searched.length
  const paginated = searched.slice((page - 1) * pageSize, page * pageSize)

  const highSensitiveCount = views.filter((v) => v.sensitive === 'high' && v.clean !== 'cleaned').length
  const expiredPending = views.filter((v) => v.clean === 'scheduled').length

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
    // 访问走后端临时签名 URL 端点(后端写访问审计 file.get_signed_url)
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
      {/* 风险提示 */}
      {(highSensitiveCount > 0 || expiredPending > 0) && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm">
          <ShieldAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
          <div className="text-orange-700">
            {highSensitiveCount > 0 && <span>{highSensitiveCount} 个高敏感文件仍在有效期内；</span>}
            {expiredPending > 0 && <span>{expiredPending} 个文件已过期待清理。</span>}
          </div>
        </div>
      )}

      {/* 操作条 */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">共 {total} 个文件</p>
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

      {/* 三行筛选 */}
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-14 text-xs text-gray-400">文件类型</span>
          <div className="flex flex-wrap gap-2">
            {TYPE_FILTERS.map((f) => (
              <button key={f} onClick={() => { setTypeFilter(f); setPage(1) }} className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${typeFilter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{f}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-14 text-xs text-gray-400">敏感级别</span>
          <div className="flex gap-2">
            {SENSITIVE_FILTERS.map((f) => (
              <button key={f} onClick={() => { setSensitiveFilter(f); setPage(1) }} className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${sensitiveFilter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{f}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-14 text-xs text-gray-400">清理状态</span>
          <div className="flex gap-2">
            {CLEAN_FILTERS.map((f) => (
              <button key={f} onClick={() => { setCleanFilter(f); setPage(1) }} className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${cleanFilter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{f}</button>
            ))}
          </div>
        </div>
        <div className="relative mt-2">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索文件名、用户..." className="h-8 w-64 rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-xs text-gray-700 placeholder-gray-400 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200" />
          <svg className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" /></svg>
        </div>
      </div>

      {/* 表格 */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                {['文件名', '类型', '用户', '来源', '大小', '敏感级别', '创建时间', '有效期至', '清理状态', '清理策略', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <tr key={i}>
                    {Array.from({ length: 11 }).map((_, j) => (
                      <td key={j} className="px-4 py-4"><div className="h-3 w-3/4 animate-pulse rounded bg-gray-100" /></td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={11}>
                    <div className="flex flex-col items-center gap-3 py-12">
                      <p className="text-sm text-gray-400">文件数据加载失败，请稍后重试</p>
                      <button onClick={load} className="rounded-lg bg-primary-600 px-4 py-1.5 text-xs text-white hover:bg-primary-700">重试</button>
                    </div>
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={11}>
                    <EmptyState title={search ? '未找到匹配的文件' : '当前筛选条件下无文件'} description={search ? '请尝试其他关键词' : undefined} icon={FolderIcon} className="py-12" />
                  </td>
                </tr>
              ) : (
                paginated.map((v) => {
                  const clean = CLEAN_MAP[v.clean]
                  const isAlive = v.clean !== 'cleaned'
                  const rowBusy = busyId === v.raw.id
                  return (
                    <tr key={v.raw.id} className={`hover:bg-gray-50 ${v.clean === 'cleaned' ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700 max-w-[160px] truncate" title={v.name}>{v.name}</td>
                      <td className="px-4 py-3"><span className={`rounded px-2 py-0.5 text-xs font-medium ${v.typeStyle}`}>{v.typeLabel}</span></td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600 max-w-[120px] truncate" title={v.user}>{v.user}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{v.source}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{v.size}</td>
                      <td className="px-4 py-3"><StatusBadge status={v.sensitiveBadge} label={v.sensitiveLabel} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{v.createdAt}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{v.expiresAt}</td>
                      <td className="px-4 py-3"><StatusBadge status={clean.badge} label={clean.label} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">{v.cleanPolicy}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex gap-2">
                          {isAlive ? (
                            <>
                              <button disabled={rowBusy} onClick={() => handleView(v.raw.id)} className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 disabled:opacity-40">查看文件</button>
                              <button disabled={rowBusy} onClick={() => handleDelete(v.raw.id, v.name)} className="rounded px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-50 disabled:opacity-40">手动删除</button>
                            </>
                          ) : (
                            <span className="px-2 py-1 text-xs text-gray-300">已清理</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <Pagination total={total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1) }} />
      </Card>

      {/* 合规说明 */}
      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
        <p className="font-medium text-gray-600">文件安全合规说明</p>
        <ul className="mt-1 space-y-0.5 list-disc list-inside">
          <li>身份证、简历、求职信等高敏感文件均设置自动清理有效期，到期由定时任务删除</li>
          <li>管理员「查看文件」走后端临时签名 URL（短有效期），「手动删除」「清理过期文件」均物理删除并写入日志审计，不可撤销</li>
          <li>文件不长期保存，不做企业招聘闭环传递，不对外共享</li>
        </ul>
      </div>
    </Page>
  )
}
