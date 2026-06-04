import { useState } from 'react'
import { Card, StatusBadge, EmptyState } from '@ai-job-print/ui'
import { Page } from '../Page'
import { FolderIcon, ShieldAlertIcon } from 'lucide-react'
import { Pagination, useTableState } from '../components/DataTable'

// ─── Types & mock ─────────────────────────────────────────────────────────────

type FileType     = 'resume' | 'scan' | 'photo' | 'id-copy' | 'document'
type CleanStatus  = 'active' | 'scheduled' | 'cleaned' | 'failed'
type SensitiveLevel = 'high' | 'medium' | 'low'

interface ManagedFile {
  id: string
  name: string
  user: string
  source: string
  size: string
  fileType: FileType
  sensitiveLevel: SensitiveLevel
  createdAt: string
  expiresAt: string
  cleanStatus: CleanStatus
  cleanPolicy: string
}

const MOCK_FILES: ManagedFile[] = [
  { id: 'f1',  name: '王某某_简历_2026.pdf',       user: '游客-A3F2', source: 'AI简历导出',   size: '312 KB', fileType: 'resume',   sensitiveLevel: 'high',   createdAt: '2026-05-25 09:12', expiresAt: '2026-05-26 09:12', cleanStatus: 'active',    cleanPolicy: '24小时自动清理' },
  { id: 'f2',  name: 'scan_20260525_091845.pdf',   user: '游客-D9E4', source: '扫描仪',       size: '1.2 MB', fileType: 'scan',     sensitiveLevel: 'medium', createdAt: '2026-05-25 09:18', expiresAt: '2026-05-26 09:18', cleanStatus: 'active',    cleanPolicy: '24小时自动清理' },
  { id: 'f3',  name: '证件照_H5I0.jpg',            user: '游客-H5I0', source: '证件照服务',   size: '87 KB',  fileType: 'photo',    sensitiveLevel: 'high',   createdAt: '2026-05-25 08:31', expiresAt: '2026-05-25 20:31', cleanStatus: 'scheduled', cleanPolicy: '12小时自动清理' },
  { id: 'f4',  name: '身份证正面_F2G8.jpg',         user: '游客-F2G8', source: '扫描仪',       size: '124 KB', fileType: 'id-copy',  sensitiveLevel: 'high',   createdAt: '2026-05-25 08:43', expiresAt: '2026-05-25 16:43', cleanStatus: 'scheduled', cleanPolicy: '8小时自动清理' },
  { id: 'f5',  name: '招聘会资料_2026春招.pdf',     user: '游客-J1K3', source: '打印下载',     size: '2.8 MB', fileType: 'document', sensitiveLevel: 'low',    createdAt: '2026-05-25 08:20', expiresAt: '2026-05-28 08:20', cleanStatus: 'active',    cleanPolicy: '3天自动清理' },
  { id: 'f6',  name: '李某某_优化简历_v2.pdf',      user: '游客-B7C1', source: 'AI简历导出',   size: '298 KB', fileType: 'resume',   sensitiveLevel: 'high',   createdAt: '2026-05-25 09:08', expiresAt: '2026-05-26 09:08', cleanStatus: 'active',    cleanPolicy: '24小时自动清理' },
  { id: 'f7',  name: 'print_upload_R8S3.docx',     user: '游客-R8S3', source: '用户上传',     size: '456 KB', fileType: 'document', sensitiveLevel: 'low',    createdAt: '2026-05-24 16:59', expiresAt: '2026-05-27 16:59', cleanStatus: 'active',    cleanPolicy: '3天自动清理' },
  { id: 'f8',  name: 'scan_20260524_173201.pdf',   user: '游客-N4O7', source: '扫描仪',       size: '890 KB', fileType: 'scan',     sensitiveLevel: 'medium', createdAt: '2026-05-24 17:32', expiresAt: '2026-05-25 17:32', cleanStatus: 'scheduled', cleanPolicy: '24小时自动清理' },
  { id: 'f9',  name: '身份证反面_L6M9.jpg',         user: '游客-L6M9', source: '扫描仪',       size: '118 KB', fileType: 'id-copy',  sensitiveLevel: 'high',   createdAt: '2026-05-24 17:45', expiresAt: '2026-05-25 01:45', cleanStatus: 'cleaned',   cleanPolicy: '8小时已清理' },
  { id: 'f10', name: '政策手册_就业补贴.pdf',       user: '游客-P2Q5', source: '用户上传',     size: '3.1 MB', fileType: 'document', sensitiveLevel: 'low',    createdAt: '2026-05-24 17:18', expiresAt: '2026-05-27 17:18', cleanStatus: 'failed',    cleanPolicy: '清理失败，等待重试' },
]

const FILE_TYPE_MAP: Record<FileType, { label: string; style: string }> = {
  resume:   { label: '简历PDF',     style: 'bg-blue-50 text-blue-600'   },
  scan:     { label: '扫描文件',     style: 'bg-purple-50 text-purple-600' },
  photo:    { label: '证件照',       style: 'bg-green-50 text-green-600'  },
  'id-copy': { label: '身份证复印件', style: 'bg-red-50 text-red-600'    },
  document: { label: '普通文档',     style: 'bg-gray-100 text-gray-600'   },
}

const SENSITIVE_MAP: Record<SensitiveLevel, { badge: 'error' | 'warning' | 'default'; label: string }> = {
  high:   { badge: 'error',   label: '高敏感' },
  medium: { badge: 'warning', label: '中敏感' },
  low:    { badge: 'default', label: '低敏感' },
}

const CLEAN_MAP: Record<CleanStatus, { badge: 'success' | 'warning' | 'default' | 'error'; label: string }> = {
  active:    { badge: 'success', label: '有效期内' },
  scheduled: { badge: 'warning', label: '即将清理' },
  cleaned:   { badge: 'default', label: '已清理'   },
  failed:    { badge: 'error',   label: '清理失败' },
}

const TYPE_FILTERS      = ['全部', '简历PDF', '扫描文件', '证件照', '身份证复印件', '普通文档'] as const
const SENSITIVE_FILTERS = ['全部', '高敏感', '中敏感', '低敏感'] as const
const CLEAN_FILTERS     = ['全部', '有效期内', '即将清理', '已清理', '清理失败'] as const

const TYPE_FILTER_MAP:      Record<string, FileType      | null> = { 全部: null, '简历PDF': 'resume', '扫描文件': 'scan', '证件照': 'photo', '身份证复印件': 'id-copy', '普通文档': 'document' }
const SENSITIVE_FILTER_MAP: Record<string, SensitiveLevel | null> = { 全部: null, '高敏感': 'high', '中敏感': 'medium', '低敏感': 'low' }
const CLEAN_FILTER_MAP:     Record<string, CleanStatus   | null> = { 全部: null, '有效期内': 'active', '即将清理': 'scheduled', '已清理': 'cleaned', '清理失败': 'failed' }

// ─── Component ────────────────────────────────────────────────────────────────

export default function FilesPage() {
  const [files, setFiles] = useState(MOCK_FILES)
  const [typeFilter,      setTypeFilter]      = useState('全部')
  const [sensitiveFilter, setSensitiveFilter] = useState('全部')
  const [cleanFilter,     setCleanFilter]     = useState('全部')
  const { page, pageSize, search, setPage, setPageSize, setSearch } = useTableState(20)

  const filtered = files.filter((f) => {
    const matchType      = typeFilter      === '全部' || f.fileType       === TYPE_FILTER_MAP[typeFilter]
    const matchSensitive = sensitiveFilter === '全部' || f.sensitiveLevel === SENSITIVE_FILTER_MAP[sensitiveFilter]
    const matchClean     = cleanFilter     === '全部' || f.cleanStatus    === CLEAN_FILTER_MAP[cleanFilter]
    return matchType && matchSensitive && matchClean
  })

  const searched = search.trim()
    ? filtered.filter((f) =>
        f.name.includes(search) ||
        f.user.includes(search)
      )
    : filtered

  const total = searched.length
  const paginated = searched.slice((page - 1) * pageSize, page * pageSize)

  const handleDelete = (id: string) => {
    setFiles((prev) => prev.map((f) =>
      f.id === id ? { ...f, cleanStatus: 'cleaned' as const, cleanPolicy: '管理员手动删除' } : f
    ))
  }

  const handleForceClean = (id: string) => {
    setFiles((prev) => prev.map((f) =>
      f.id === id ? { ...f, cleanStatus: 'cleaned' as const, cleanPolicy: '立即清理已执行' } : f
    ))
  }

  const highSensitiveCount = files.filter((f) => f.sensitiveLevel === 'high' && f.cleanStatus !== 'cleaned').length
  const failedCount        = files.filter((f) => f.cleanStatus === 'failed').length

  return (
    <Page
      title="文件管理"
      subtitle="用户文件生命周期与敏感文件清理"
    >
      {/* 风险提示 */}
      {(highSensitiveCount > 0 || failedCount > 0) && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm">
          <ShieldAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
          <div className="text-orange-700">
            {highSensitiveCount > 0 && <span>{highSensitiveCount} 个高敏感文件仍在有效期内；</span>}
            {failedCount > 0 && <span>{failedCount} 个文件清理失败，需关注。</span>}
          </div>
        </div>
      )}

      {/* 三行筛选 */}
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-14 text-xs text-gray-400">文件类型</span>
          <div className="flex flex-wrap gap-2">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => { setTypeFilter(f); setPage(1) }}
                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                  typeFilter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-14 text-xs text-gray-400">敏感级别</span>
          <div className="flex gap-2">
            {SENSITIVE_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => { setSensitiveFilter(f); setPage(1) }}
                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                  sensitiveFilter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-14 text-xs text-gray-400">清理状态</span>
          <div className="flex gap-2">
            {CLEAN_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => { setCleanFilter(f); setPage(1) }}
                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                  cleanFilter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f}
              </button>
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
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={11}>
                    <EmptyState title={search ? '未找到匹配的文件' : '当前筛选条件下无文件'} description={search ? '请尝试其他关键词' : undefined} icon={FolderIcon} className="py-12" />
                  </td>
                </tr>
              ) : (
                paginated.map((f) => {
                  const ft    = FILE_TYPE_MAP[f.fileType]
                  const sens  = SENSITIVE_MAP[f.sensitiveLevel]
                  const clean = CLEAN_MAP[f.cleanStatus]
                  const isActive = f.cleanStatus !== 'cleaned'
                  return (
                    <tr key={f.id} className={`hover:bg-gray-50 ${f.cleanStatus === 'cleaned' ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700 max-w-[160px] truncate">{f.name}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${ft.style}`}>{ft.label}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{f.user}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{f.source}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{f.size}</td>
                      <td className="px-4 py-3"><StatusBadge status={sens.badge} label={sens.label} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{f.createdAt}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{f.expiresAt}</td>
                      <td className="px-4 py-3"><StatusBadge status={clean.badge} label={clean.label} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">{f.cleanPolicy}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex gap-2">
                          <button className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">查看记录</button>
                          {isActive && (
                            <>
                              <button
                                className="rounded px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-50"
                                onClick={() => handleDelete(f.id)}
                              >
                                手动删除
                              </button>
                              {f.cleanStatus === 'failed' && (
                                <button
                                  className="rounded px-2 py-1 text-xs font-medium text-orange-500 hover:bg-orange-50"
                                  onClick={() => handleForceClean(f.id)}
                                >
                                  立即清理
                                </button>
                              )}
                            </>
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
          <li>身份证复印件、简历、证件照等高敏感文件均设置自动清理有效期，到期系统自动删除</li>
          <li>所有管理员手动删除、立即清理操作均会写入日志审计，不可撤销</li>
          <li>文件不长期保存，不做企业招聘闭环传递，不对外共享</li>
          <li>清理失败的文件将在下次定时任务中重试，如持续失败请查看日志审计</li>
        </ul>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        演示数据：文件管理后端端点尚未接入，本页的删除 / 立即清理仅更新前端演示状态，
        暂不执行真实文件删除，也暂未写入日志审计；上方合规说明描述的是接入后的目标行为。
      </p>
    </Page>
  )
}
