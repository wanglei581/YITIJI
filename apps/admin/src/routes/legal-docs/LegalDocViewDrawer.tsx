import { useEffect, useState } from 'react'
import { formatDateTime } from '@ai-job-print/shared'
import { XIcon } from 'lucide-react'
import { API_MODE } from '../../services/api/client'
import { legalDocsService, type LegalDocVersionDetail } from '../../services/api/legalDocs'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { LegalDocPreview } from './LegalDocPreview'
import { docTypeLabel } from './legalDocMeta'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; doc: LegalDocVersionDetail }
  | { status: 'error'; text: string }

/** 「查看正文」：按一体机排版预览某一版本，可切原文。每次打开服务端都会记一条查看审计。 */
export function LegalDocViewDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    legalDocsService
      .get(id)
      .then((doc) => { if (!cancelled) setState({ status: 'ready', doc }) })
      .catch((e: unknown) => { if (!cancelled) setState({ status: 'error', text: userMessageOf(e, '正文加载失败，请稍后重试') }) })
    return () => { cancelled = true }
  }, [id])

  const title = state.status === 'ready' ? `${docTypeLabel(state.doc.docType)} · ${state.doc.version}` : '查看正文'

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" role="dialog" aria-modal="true" aria-label="查看法务文档正文">
      <div className="relative flex h-full w-full max-w-2xl flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-3 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            aria-label="关闭"
          >
            <XIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {state.status === 'loading' && <p className="py-16 text-center text-sm text-neutral-500">正文加载中…</p>}
          {state.status === 'error' && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">正文加载失败：{state.text}</div>
          )}
          {state.status === 'ready' && (
            <>
              <dl className="mb-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex gap-2"><dt className="text-neutral-400">标题</dt><dd className="text-neutral-800">{state.doc.title || '—'}</dd></div>
                <div className="flex gap-2">
                  <dt className="text-neutral-400">状态</dt>
                  <dd className="text-neutral-800">{state.doc.isActive ? '当前有效' : state.doc.publishedAt ? '已归档' : '草稿（未发布）'}</dd>
                </div>
                <div className="flex gap-2"><dt className="text-neutral-400">创建时间</dt><dd className="text-neutral-800">{formatDateTime(state.doc.createdAt)}</dd></div>
                <div className="flex gap-2"><dt className="text-neutral-400">发布时间</dt><dd className="text-neutral-800">{formatDateTime(state.doc.publishedAt)}</dd></div>
              </dl>
              <LegalDocPreview content={state.doc.content} />
              <p className="mt-2 text-xs text-neutral-400">
                「排版预览」按一体机的分章规则显示；{API_MODE === 'http' ? '本次查看已记入操作审计。' : '当前为演示数据，不写审计。'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
