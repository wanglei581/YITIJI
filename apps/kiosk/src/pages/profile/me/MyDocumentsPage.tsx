// ============================================================
// 我的文档 — /me/documents（本人，只读元数据）。
// 列表只给 downloadUrlPath/previewUrlPath；查看时凭本人 token 现换 TTL 受控签名 URL
// （fetchAccessUrl），过期文档诚实置灰不可打开。不长期留存敏感文件（后端到期自动清理）。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { Card } from '@ai-job-print/ui'
import type { MemberDocumentItem } from '@ai-job-print/shared'
import { FilesIcon, EyeIcon } from 'lucide-react'
import { fetchAccessUrl, getMyDocuments } from '../../../services/api/memberAssets'
import { useAuth } from '../../../auth/useAuth'
import { formatTime } from '../assets/format'
import { MeListShell, type MeListState } from './MeListShell'

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function MyDocumentsPage() {
  const { isLoggedIn, getToken } = useAuth()
  const [items, setItems] = useState<MemberDocumentItem[]>([])
  const [state, setState] = useState<MeListState>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [hint, setHint] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!isLoggedIn) {
      setState('ready')
      return
    }
    setState('loading')
    getMyDocuments(getToken(), { pageSize: 50 })
      .then((r) => {
        setItems(r.items)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [isLoggedIn, getToken])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(null), 3000)
    return () => clearTimeout(t)
  }, [hint])

  const open = async (doc: MemberDocumentItem) => {
    const token = getToken()
    if (!token) return
    setOpening(doc.id)
    try {
      const res = await fetchAccessUrl(doc.previewUrlPath, token)
      window.open(res.url, '_blank', 'noopener')
    } catch {
      setHint('文档打开失败，可能已到期或被清理')
    } finally {
      setOpening(null)
    }
  }

  const now = Date.now()

  return (
    <MeListShell
      title="我的文档"
      subtitle="本人保存的文档（仅本人可见，到期自动清理）"
      loginFrom="/me/documents"
      isLoggedIn={isLoggedIn}
      state={state}
      onRetry={() => setReloadKey((k) => k + 1)}
      isEmpty={items.length === 0}
      emptyIcon={FilesIcon}
      emptyTitle="还没有文档"
      emptyDescription="保存简历 / 打印材料等文档后，这里会显示你的文档记录"
    >
      {hint && (
        <div role="status" className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-neutral-900/90 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
          {hint}
        </div>
      )}
      {items.map((doc) => {
        const expired = new Date(doc.expiresAt).getTime() < now
        return (
          <Card key={doc.id} className="flex items-center gap-4 p-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50">
              <FilesIcon className="h-6 w-6 text-blue-600" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-gray-900">{doc.filename}</p>
              <p className="mt-0.5 truncate text-xs text-gray-400">
                {formatBytes(doc.sizeBytes)} · {formatTime(doc.createdAt)}
                {expired ? ' · 已到期' : ` · 有效期至 ${formatTime(doc.expiresAt)}`}
              </p>
            </div>
            <button
              type="button"
              disabled={expired || opening === doc.id}
              onClick={() => void open(doc)}
              className={[
                'flex h-12 shrink-0 items-center gap-1 rounded-lg border px-4 text-sm font-medium transition-colors',
                expired
                  ? 'cursor-not-allowed border-gray-100 text-gray-300'
                  : 'border-gray-200 text-gray-600 hover:bg-blue-50 hover:text-blue-600',
              ].join(' ')}
            >
              <EyeIcon className="h-4 w-4" aria-hidden="true" />
              {expired ? '已到期' : opening === doc.id ? '打开中' : '查看'}
            </button>
          </Card>
        )
      })}
      <p className="mt-1 text-center text-xs text-gray-400">文档查看使用短期签名链接；敏感文件不长期留存，到期自动清理</p>
    </MeListShell>
  )
}
