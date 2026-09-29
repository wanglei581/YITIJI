import { useEffect, useState } from 'react'
import { Card, EmptyState, StatusBadge } from '@ai-job-print/ui'
import { FileTextIcon, PlusIcon, CheckIcon, EyeIcon } from 'lucide-react'
import { Page } from '../Page'
import { LegalDocDrawer } from './LegalDocDrawer'
import { LegalDocViewDrawer } from './LegalDocViewDrawer'
import { LegalReadinessCard } from './LegalReadinessCard'
import { DOC_TYPE_LABELS, DOC_TYPE_ORDER, activateConfirmText, docTypeLabel } from './legalDocMeta'
import { legalDocsService, type LegalDocVersionView } from '../../services/api/legalDocs'

// ─── 常量 ───────────────────────────────────────────────────────────────────

const TAB_OPTIONS: { key: string | undefined; label: string }[] = [
  { key: undefined, label: '全部' },
  ...DOC_TYPE_ORDER.map((key) => ({ key, label: DOC_TYPE_LABELS[key] })),
]

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 被新版取代的已发布版本仍带 publishedAt，不得标成「草稿」。 */
function legalDocBadge(
  row: LegalDocVersionView,
  all: LegalDocVersionView[] = [],
): { status: 'success' | 'warning' | 'default'; label: string } {
  if (row.isActive) return { status: 'success', label: '当前有效' }
  if (row.publishedAt) {
    const successor = all.find((item) => item.docType === row.docType && item.isActive)
    return {
      status: 'default',
      label: successor ? `已归档 / 已被 ${successor.version} 取代` : '已归档',
    }
  }
  return { status: 'warning', label: '草稿' }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function LegalDocsPage() {
  // 一次取全部版本：顶部「上线就绪」要看每一类的现行版本，列表按标签在前端筛选。
  const [allRows, setAllRows] = useState<LegalDocVersionView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<string | undefined>(undefined)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [activating, setActivating] = useState<string | null>(null)

  const loadData = () => {
    setLoading(true)
    setError(null)
    legalDocsService
      .list()
      .then(setAllRows)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadData()
  }, [])

  const rows = tab ? allRows.filter((row) => row.docType === tab) : allRows

  const handleActivate = async (id: string) => {
    const row = allRows.find((r) => r.id === id)
    // 协议与隐私政策影响会员登录同意；AI 服务说明、经营者信息等不涉及，确认文案按类型区分。
    const text = row ? activateConfirmText(row) : '确认激活该版本为当前有效版本？同类型其它版本将同时失活。'
    if (!window.confirm(text)) {
      return
    }
    setActivating(id)
    try {
      await legalDocsService.activate(id)
      loadData()
    } catch (e) {
      alert(`激活失败：${(e as Error).message}`)
    } finally {
      setActivating(null)
    }
  }

  const handleCreated = () => {
    setDrawerOpen(false)
    loadData()
  }

  return (
    <Page
      title="法务文档版本"
      subtitle="维护一体机与小程序「用户服务协议」「隐私政策」页及会员登录勾选所用的文本，以及 AI 服务说明、经营者信息等法务文档；新版本先存草稿，激活后才正式发布"
      actions={
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
        >
          <PlusIcon className="h-4 w-4" aria-hidden="true" />
          新增版本
        </button>
      }
    >
      {!loading && !error && <LegalReadinessCard rows={allRows} />}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-neutral-200">
        {TAB_OPTIONS.map((t) => (
          <button
            key={String(t.key)}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {loading && (
          <div className="py-16 text-center text-sm text-neutral-500">加载中…</div>
        )}
        {!loading && error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            加载失败：{error}
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <EmptyState
            icon={FileTextIcon}
            title="暂无法务文档版本"
            description="点击右上角「新增版本」创建草稿"
          />
        )}
        {!loading && !error && rows.length > 0 && (
          <Card>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-100 text-sm">
                <thead className="bg-neutral-50 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 text-left">文档类型</th>
                    <th className="px-4 py-3 text-left">版本号</th>
                    <th className="px-4 py-3 text-left">标题</th>
                    <th className="px-4 py-3 text-left">状态</th>
                    <th className="px-4 py-3 text-left">发布时间</th>
                    <th className="px-4 py-3 text-left">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-50 bg-white">
                  {rows.map((row) => {
                    const badge = legalDocBadge(row, allRows)
                    return (
                    <tr key={row.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 text-neutral-700">
                        {docTypeLabel(row.docType)}
                      </td>
                      <td className="px-4 py-3 font-mono text-neutral-600">{row.version}</td>
                      <td className="max-w-xs truncate px-4 py-3 text-neutral-800">{row.title}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={badge.status} label={badge.label} />
                      </td>
                      <td className="px-4 py-3 text-neutral-500">{formatDate(row.publishedAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setViewingId(row.id)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                          >
                            <EyeIcon className="h-3.5 w-3.5" aria-hidden="true" />
                            查看正文
                          </button>
                          {!row.isActive && (
                            <button
                              type="button"
                              disabled={activating === row.id}
                              onClick={() => handleActivate(row.id)}
                              className="inline-flex items-center gap-1.5 rounded-md border border-primary-300 px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
                              {activating === row.id ? '激活中…' : '激活'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {drawerOpen && (
        <LegalDocDrawer existing={allRows} onCreated={handleCreated} onClose={() => setDrawerOpen(false)} />
      )}
      {viewingId && <LegalDocViewDrawer id={viewingId} onClose={() => setViewingId(null)} />}
    </Page>
  )
}
