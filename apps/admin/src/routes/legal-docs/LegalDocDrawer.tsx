import { useState } from 'react'
import { XIcon } from 'lucide-react'
import {
  legalDocsService,
  type CreateLegalDocVersionInput,
  type LegalDocVersionView,
} from '../../services/api/legalDocs'
import { LegalDocPreview } from './LegalDocPreview'
import { DOC_TYPE_LABELS, DOC_TYPE_ORDER, VERSION_MAX_LENGTH, versionProblem } from './legalDocMeta'

// 经营者信息（operator_info）：电商法第十五条要求首页持续公示营业执照信息或其链接。
// 2026-09-29 按代码核实：一体机 /legal 与小程序协议页目前只读用户服务协议、隐私政策，
// 还没有页面读取 operator_info 或 ai_disclaimer —— 这两类发布后暂时不会对用户展示。
const DOC_TYPE_OPTIONS = DOC_TYPE_ORDER.map((value) => ({ value, label: DOC_TYPE_LABELS[value] }))

interface Props {
  /** 已有版本（全部类型），用于前端拦截同类型重复版本号。服务端不做这项校验。 */
  existing: LegalDocVersionView[]
  onCreated: () => void
  onClose: () => void
}

export function LegalDocDrawer({ existing, onCreated, onClose }: Props) {
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

  const versionError = versionProblem(existing, form.docType, form.version)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.version.trim() || !form.title.trim() || !form.content.trim()) {
      setError('版本号、标题和内容不能为空')
      return
    }
    if (versionError) {
      setError(versionError)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await legalDocsService.create({ ...form, version: form.version.trim() })
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
      <div className="relative flex h-full w-full max-w-2xl flex-col bg-white shadow-xl">
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
                placeholder="例：2026.10.01-试运行v1"
                value={form.version}
                maxLength={VERSION_MAX_LENGTH}
                onChange={(e) => set('version', e.target.value)}
                aria-invalid={versionError ? true : undefined}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-700 placeholder-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              {versionError ? (
                <p className="mt-1 text-xs text-red-600">{versionError}</p>
              ) : (
                <p className="mt-1 text-xs text-neutral-400">
                  试运行期间可用「2026.10.01-试运行v1」，正式版可用「2026.11.01-v1.0」；同一类型的版本号不能重复，最多 {VERSION_MAX_LENGTH} 个字。
                  会员同意记录会带上这个版本号。
                </p>
              )}
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
                正文 <span aria-hidden="true" className="text-red-500">*</span>
              </label>
              <p className="mb-1.5 text-xs leading-relaxed text-neutral-500">
                排版规则：空一行分段；以「#」开头，或以「第一条」「第一章」「一、」开头的短行（30 字以内、不以句号结尾）作章节标题；
                不支持加粗、斜体和链接，这些符号会原样显示。下方预览按一体机的规则排版（小程序按行显示，只认「#」标题和「- 」列表）。
              </p>
              <textarea
                id="content"
                rows={12}
                placeholder={'例：\n第一条 总则\n本协议是……\n\n第二条 服务内容\n……'}
                value={form.content}
                onChange={(e) => set('content', e.target.value)}
                className="w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-700 placeholder-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              <p className="mt-1 text-xs text-neutral-400">
                创建后状态为「草稿」，需在列表页点击「激活」才算正式发布
              </p>
              <LegalDocPreview content={form.content} className="mt-3" />
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
