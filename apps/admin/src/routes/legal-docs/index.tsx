import { useEffect, useState } from 'react'
import { Card, EmptyState, StatusBadge } from '@ai-job-print/ui'
import { FileTextIcon, PlusIcon, CheckIcon } from 'lucide-react'
import { Page } from '../Page'
import { LegalDocDrawer } from './LegalDocDrawer'
import { legalDocsService, type LegalDocVersionView } from '../../services/api/legalDocs'

// ─── 常量 ───────────────────────────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  terms_of_service: '用户服务协议',
  privacy_policy: '隐私政策',
  ai_disclaimer: 'AI 服务免责声明',
}

const TAB_OPTIONS: { key: string | undefined; label: string }[] = [
  { key: undefined, label: '全部' },
  { key: 'terms_of_service', label: '用户服务协议' },
  { key: 'privacy_policy', label: '隐私政策' },
  { key: 'ai_disclaimer', label: 'AI 免责声明' },
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

// ─── Component ──────────────────────────────────────────────────────────────

export default function LegalDocsPage() {
  const [rows, setRows] = useState<LegalDocVersionView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<string | undefined>(undefined)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activating, setActivating] = useState<string | null>(null)

  const loadData = (docType?: string) => {
    setLoading(true)
    setError(null)
    legalDocsService
      .list(docType)
      .then(setRows)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadData(tab)
  }, [tab])

  const handleActivate = async (id: string) => {
    setActivating(id)
    try {
      await legalDocsService.activate(id)
      loadData(tab)
    } catch (e) {
      alert(`激活失败：${(e as Error).message}`)
    } finally {
      setActivating(null)
    }
  }

  const handleCreated = () => {
    setDrawerOpen(false)
    loadData(tab)
  }

  return (
    <Page
      title="法务文档版本"
      subtitle="管理用户服务协议、隐私政策等法务文档的历史版本与当前有效版本"
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
      {/* Tabs */}
      <div className="flex gap-1 border-b border-neutral-200">
        {TAB_OPTIONS.map((t) => (
          <button
            key={String(t.key)}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
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
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 text-neutral-700">
                        {DOC_TYPE_LABELS[row.docType] ?? row.docType}
                      </td>
                      <td className="px-4 py-3 font-mono text-neutral-600">{row.version}</td>
                      <td className="max-w-xs truncate px-4 py-3 text-neutral-800">{row.title}</td>
                      <td className="px-4 py-3">
                        {row.isActive ? (
                          <StatusBadge status="success" label="当前有效" />
                        ) : (
                          <StatusBadge status="default" label="草稿" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-neutral-500">{formatDate(row.publishedAt)}</td>
                      <td className="px-4 py-3">
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {drawerOpen && (
        <LegalDocDrawer onCreated={handleCreated} onClose={() => setDrawerOpen(false)} />
      )}
    </Page>
  )
}
