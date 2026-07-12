import { useEffect, useState } from 'react'
import { mergeById, useInteractionLock, useRefreshable } from '@ai-job-print/refresh'
import { Card, Drawer, EmptyState, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import { FileTextIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import {
  partnerPoliciesService,
  type PartnerPolicyRecord,
  type PolicyAudience,
  type PolicyCategory,
  type PolicyKind,
  type SavePolicyInput,
} from '../../services/api/policies'

// ─── Display maps ─────────────────────────────────────────────────────────────

const KIND_LABELS: Record<string, string> = { policy_guide: '政策扶持', notice: '政策公告' }
const AUDIENCE_LABELS: Record<string, string> = {
  graduate: '应届高校毕业生', flexible: '灵活就业人员', migrant: '返乡务工人员', hardship: '困难群体就业援助', startup: '创业扶持', general: '通用',
}
const CATEGORY_LABELS: Record<string, string> = {
  policy: '政策', announcement: '公告', notice: '通知', recruitment: '招募',
}

const REVIEW_MAP: Record<string, { badge: 'warning' | 'info' | 'success' | 'error'; label: string }> = {
  pending:   { badge: 'warning', label: '待审核' },
  reviewing: { badge: 'info',    label: '审核中' },
  approved:  { badge: 'success', label: '已通过' },
  rejected:  { badge: 'error',   label: '已拒绝' },
}

const PUBLISH_MAP: Record<string, { badge: 'success' | 'warning' | 'default'; label: string }> = {
  draft:       { badge: 'warning', label: '待发布' },
  published:   { badge: 'success', label: '已发布' },
  unpublished: { badge: 'default', label: '已下架' },
  expired:     { badge: 'default', label: '已过期' },
}
const PARTNER_POLICIES_REFRESH_KEY = 'partner:policies'

const inputCls =
  'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">
        {label}
        {required && <span className="ml-0.5 text-error-fg">*</span>}
      </span>
      {children}
    </label>
  )
}

interface PolicyFormState {
  kind: PolicyKind
  title: string
  summary: string
  content: string
  audience: PolicyAudience
  category: PolicyCategory
  externalUrl: string
  publishedDate: string // YYYY-MM-DD
}

const EMPTY_FORM: PolicyFormState = {
  kind: 'notice', title: '', summary: '', content: '', audience: 'general', category: 'notice', externalUrl: '', publishedDate: '',
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as Error).message === 'string') return (e as Error).message
  return '操作失败,请重试'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PolicyPage() {
  const [editing, setEditing] = useState<PartnerPolicyRecord | 'new' | null>(null)
  const [form, setForm] = useState<PolicyFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const { data, status, refresh } = useRefreshable(
    PARTNER_POLICIES_REFRESH_KEY,
    () => partnerPoliciesService.getPolicies(),
    {
      intervalMs: 60_000,
      merge: mergeById<PartnerPolicyRecord>((item) => item.id),
      failPolicy: 'keep-last',
    },
  )

  useInteractionLock(
    editing !== null || saving || busyId !== null || deletingId !== null,
    [PARTNER_POLICIES_REFRESH_KEY],
    'hard',
  )

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(t)
  }, [notice])

  useEffect(() => {
    if (!deletingId) return
    const t = setTimeout(() => setDeletingId(null), 5000)
    return () => clearTimeout(t)
  }, [deletingId])

  const rows = data ?? []
  const loading = status === 'idle' || (status === 'loading' && rows.length === 0)
  const error = status === 'error' && rows.length === 0

  const openNew = () => {
    setForm(EMPTY_FORM)
    setFormError(null)
    setEditing('new')
  }

  const openEdit = (r: PartnerPolicyRecord) => {
    setForm({
      kind: (r.kind as PolicyKind) ?? 'notice',
      title: r.title,
      summary: r.summary ?? '',
      content: r.content ?? '',
      audience: (r.audience as PolicyAudience) ?? 'general',
      category: (r.category as PolicyCategory) ?? 'notice',
      externalUrl: r.externalUrl ?? '',
      publishedDate: r.publishedDate ?? '',
    })
    setFormError(null)
    setEditing(r)
  }

  const canSave = form.title.trim().length > 0

  const save = async () => {
    setSaving(true)
    setFormError(null)
    const payload: SavePolicyInput = {
      kind: form.kind,
      title: form.title.trim(),
      summary: form.summary.trim() || undefined,
      content: form.content.trim() || undefined,
      audience: form.kind === 'policy_guide' ? form.audience : undefined,
      category: form.kind === 'notice' ? form.category : undefined,
      externalUrl: form.externalUrl.trim() || undefined,
      publishedDate: form.publishedDate || undefined,
    }
    try {
      if (editing === 'new') {
        await partnerPoliciesService.createPolicy(payload)
        setNotice('政策内容已提交,进入待审核;管理员审核通过并发布后,终端才会展示。')
      } else if (editing) {
        await partnerPoliciesService.updatePolicy(editing.id, payload)
        setNotice('修改已保存。该内容已重新进入待审核,审核通过并重新发布前,终端不展示。')
      }
      setEditing(null)
      void refresh()
    } catch (e) {
      setFormError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const handleUnpublish = async (id: string) => {
    setBusyId(id)
    try {
      await partnerPoliciesService.unpublishPolicy(id)
      void refresh()
    } catch (e) {
      setNotice(errMsg(e))
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id)
      return
    }
    setDeletingId(null)
    setBusyId(id)
    try {
      await partnerPoliciesService.deletePolicy(id)
      void refresh()
    } catch (e) {
      setNotice(errMsg(e))
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <Page title="政策公告" subtitle="加载中...">
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-neutral-400">加载中...</p>
        </div>
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="政策公告" subtitle="加载失败">
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <FileTextIcon className="h-10 w-10 text-neutral-200" />
          <p className="text-sm text-neutral-400">加载失败，请稍后重试</p>
        </div>
      </Page>
    )
  }

  return (
    <Page
      title="政策公告"
      subtitle={`共 ${rows.length} 条政策内容 — 政策扶持条目与政策公告`}
      actions={
        <button onClick={openNew} className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700">
          <PlusIcon className="h-4 w-4" />
          新增政策内容
        </button>
      }
    >
      {notice && (
        <div className="mb-4 rounded-lg border border-success/30 bg-success-bg px-4 py-3 text-sm text-success-fg">
          {notice}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={FileTextIcon}
          title="暂无政策内容"
          description='点击右上角"新增政策内容",发布就业政策说明与公告(经管理员审核后在一体机展示)'
          className="py-16"
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {['类型', '标题', '分组/标签', '展示日期', '审核状态', '发布状态', '操作'].map((h) => (
                    <th key={h} className="whitespace-nowrap border-b border-neutral-900/10 px-4 py-2.5 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900/[0.06]">
                {rows.map((r) => {
                  const review = REVIEW_MAP[r.reviewStatus] ?? REVIEW_MAP.pending
                  const publish = PUBLISH_MAP[r.publishStatus] ?? PUBLISH_MAP.draft
                  return (
                    <tr key={r.id} className="hover:bg-neutral-50">
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${r.kind === 'policy_guide' ? 'bg-info-bg text-info-fg' : 'bg-purple-50 text-purple-600'}`}>
                          {KIND_LABELS[r.kind] ?? r.kind}
                        </span>
                      </td>
                      <td className="max-w-96 px-4 py-3">
                        <p className="font-medium text-neutral-800">{r.title}</p>
                        {r.summary && <p className="mt-0.5 line-clamp-1 text-xs text-neutral-400">{r.summary}</p>}
                        {r.reviewStatus === 'rejected' && r.rejectReason && (
                          <p className="mt-0.5 text-xs text-error-fg">拒绝原因:{r.rejectReason}(修改后将重新提审)</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">
                        {r.kind === 'policy_guide'
                          ? (r.audience ? AUDIENCE_LABELS[r.audience] ?? r.audience : '—')
                          : (r.category ? CATEGORY_LABELS[r.category] ?? r.category : '—')}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{r.publishedDate ?? '—'}</td>
                      <td className="px-4 py-3"><StatusBadge dot status={review.badge} label={review.label} /></td>
                      <td className="px-4 py-3"><StatusBadge dot status={publish.badge} label={publish.label} /></td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => openEdit(r)} className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">
                            <PencilIcon className="h-3.5 w-3.5" />
                          </button>
                          {r.publishStatus === 'published' && (
                            <button
                              disabled={busyId === r.id}
                              onClick={() => void handleUnpublish(r.id)}
                              className="rounded px-2 py-1 text-xs font-medium text-warning-fg hover:bg-warning-bg disabled:opacity-50"
                            >
                              下架
                            </button>
                          )}
                          <button
                            disabled={busyId === r.id}
                            onClick={() => void handleDelete(r.id)}
                            className={`rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                              deletingId === r.id ? 'bg-error text-white hover:bg-error/90' : 'text-error-fg hover:bg-error-bg'
                            }`}
                          >
                            {deletingId === r.id ? '确认删除?' : <Trash2Icon className="h-3.5 w-3.5" />}
                          </button>
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

      <p className="mt-3 text-xs text-neutral-400">
        政策内容为 info-only:仅政策说明、材料清单与官方入口;不承诺补贴到账、不代申请。提交后需管理员审核通过并发布,才会在一体机「政策服务」页展示。
      </p>

      {/* 新增/编辑抽屉 */}
      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? '新增政策内容' : '编辑政策内容'}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(null)} disabled={saving} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">取消</button>
            <button onClick={save} disabled={saving || !canSave} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? '保存中…' : editing === 'new' ? '提交审核' : '保存并重新提审'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {formError && <p className="rounded-lg bg-error-bg px-3 py-2 text-xs text-error-fg">{formError}</p>}
          {editing !== 'new' && (
            <p className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning-fg">
              保存后该内容将重新进入待审核状态;审核通过并重新发布前,终端不展示。
            </p>
          )}
          <Field label="内容类型" required>
            <select className={inputCls} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as PolicyKind }))}>
              <option value="notice">政策公告(公告/通知/招募,展示在公告列表)</option>
              <option value="policy_guide">政策扶持条目(按人群分组展示)</option>
            </select>
          </Field>
          <Field label="标题" required>
            <input className={inputCls} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </Field>
          {form.kind === 'policy_guide' ? (
            <Field label="适用人群" required>
              <select className={inputCls} value={form.audience} onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value as PolicyAudience }))}>
                {Object.entries(AUDIENCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="公告标签" required>
              <select className={inputCls} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as PolicyCategory }))}>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          )}
          <Field label="摘要(一体机列表展示)">
            <textarea className={`${inputCls} h-16 resize-none`} maxLength={500} value={form.summary} onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))} />
          </Field>
          <Field label="正文(政策说明/材料清单/办理指引)">
            <textarea className={`${inputCls} h-32 resize-none`} maxLength={10000} value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="官方入口链接">
              <input className={inputCls} placeholder="https://…(官方平台入口)" value={form.externalUrl} onChange={(e) => setForm((f) => ({ ...f, externalUrl: e.target.value }))} />
            </Field>
            <Field label="展示日期">
              <input type="date" className={inputCls} value={form.publishedDate} onChange={(e) => setForm((f) => ({ ...f, publishedDate: e.target.value }))} />
            </Field>
          </div>
          <p className="text-xs text-neutral-400">
            合规提示:内容仅做政策说明与官方入口指引;请勿出现"补贴必到账""代为申请"等承诺性表述,此类内容审核将不予通过。
          </p>
        </div>
      </Drawer>
    </Page>
  )
}
