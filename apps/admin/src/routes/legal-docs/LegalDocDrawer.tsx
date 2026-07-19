import { useState } from 'react'
import { XIcon } from 'lucide-react'
import { legalDocsService, type CreateLegalDocVersionInput } from '../../services/api/legalDocs'

const DOC_TYPE_OPTIONS = [
  { value: 'terms_of_service', label: '用户服务协议' },
  { value: 'privacy_policy', label: '隐私政策' },
  { value: 'ai_disclaimer', label: 'AI 服务免责声明' },
]

interface Props {
  onCreated: () => void
  onClose: () => void
}

export function LegalDocDrawer({ onCreated, onClose }: Props) {
  const [form, setForm] = useState<CreateLegalDocVersionInput>({
    docType: 'terms_of_service',
    version: '',
    title: '',
    content: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof CreateLegalDocVersionInput>(
    key: K,
    value: CreateLegalDocVersionInput[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.version.trim() || !form.title.trim() || !form.content.trim()) {
      setError('版本号、标题和内容不能为空')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await legalDocsService.create(form)
      onCreated()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/30"
      role="dialog"
      aria-modal="true"
      aria-label="新增法务文档版本"
    >
      {/* Drawer panel */}
      <div className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="text-base font-semibold text-neutral-900">新增法务文档版本</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            aria-label="关闭"
          >
            <XIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-y-auto px-6 py-5">
          <div className="space-y-4">
            {/* docType */}
            <div>
              <label htmlFor="docType" className="mb-1.5 block text-sm font-medium text-neutral-700">
                文档类型 <span aria-hidden="true" className="text-red-500">*</span>
              </label>
              <select
                id="docType"
                value={form.docType}
                onChange={(e) => set('docType', e.target.value)}
                className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                {DOC_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {/* version */}
            <div>
              <label htmlFor="version" className="mb-1.5 block text-sm font-medium text-neutral-700">
                版本号 <span aria-hidden="true" className="text-red-500">*</span>
              </label>
              <input
                id="version"
                type="text"
                placeholder="例：v1.1"
                value={form.version}
                onChange={(e) => set('version', e.target.value)}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-700 placeholder-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>

            {/* title */}
            <div>
              <label htmlFor="title" className="mb-1.5 block text-sm font-medium text-neutral-700">
                标题 <span aria-hidden="true" className="text-red-500">*</span>
              </label>
              <input
                id="title"
                type="text"
                placeholder="例：用户服务协议"
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-700 placeholder-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>

            {/* content */}
            <div>
              <label htmlFor="content" className="mb-1.5 block text-sm font-medium text-neutral-700">
                内容（Markdown） <span aria-hidden="true" className="text-red-500">*</span>
              </label>
              <textarea
                id="content"
                rows={14}
                placeholder="请输入 Markdown 格式的法务文档全文…"
                value={form.content}
                onChange={(e) => set('content', e.target.value)}
                className="w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-700 placeholder-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              <p className="mt-1 text-xs text-neutral-400">
                创建后状态为「草稿」，需在列表页点击「激活」才会对 Kiosk 生效
              </p>
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>

          <div className="mt-auto flex justify-end gap-3 pt-6">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? '创建中…' : '创建草稿'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
