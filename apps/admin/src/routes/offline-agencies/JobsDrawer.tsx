import { useCallback, useEffect, useState } from 'react'
import { Drawer, EmptyState, StatusBadge } from '@ai-job-print/ui'
import { BriefcaseIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Field, GhostButton, PrimaryButton } from '../../components/form'
import {
  offlineAgenciesAdminService,
  type OfflineAgencyJob,
  type OfflineAgencyJobInput,
} from '../../services/api/offlineAgenciesAdmin'

// ─── 样式 ─────────────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

const JOB_REVIEW_BADGE: Record<string, { status: 'success' | 'warning' | 'error' | 'info' | 'default'; label: string }> = {
  pending:   { status: 'warning', label: '待审核' },
  reviewing: { status: 'info',    label: '审核中' },
  approved:  { status: 'success', label: '已通过' },
  rejected:  { status: 'error',   label: '已驳回' },
}

// ─── 岗位表单 ─────────────────────────────────────────────────────────────────

interface JobFormState {
  title: string
  salary: string
  city: string
  category: string
  description: string
  requirements: string
}

const EMPTY_JOB: JobFormState = {
  title: '', salary: '', city: '', category: '', description: '', requirements: '',
}

function jobToForm(j: OfflineAgencyJob): JobFormState {
  return {
    title: j.title,
    salary: j.salary ?? '',
    city: j.city ?? '',
    category: j.category ?? '',
    description: j.description ?? '',
    requirements: j.requirements ?? '',
  }
}

function validateJob(f: JobFormState): string | null {
  if (!f.title.trim() || f.title.trim().length < 2) return '岗位名称至少 2 个字符'
  if (f.title.trim().length > 100) return '岗位名称不能超过 100 个字符'
  return null
}

function formToJobInput(f: JobFormState): OfflineAgencyJobInput {
  const s = (v: string) => (v.trim() ? v.trim() : null)
  return {
    title: f.title.trim(),
    salary: s(f.salary),
    city: s(f.city),
    category: s(f.category),
    description: s(f.description),
    requirements: s(f.requirements),
  }
}

// ─── 嵌入式岗位表单面板 ───────────────────────────────────────────────────────

function JobFormPanel({
  initial,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  initial: JobFormState
  busy: boolean
  error: string | null
  onCancel: () => void
  onSubmit: (f: JobFormState) => void
}) {
  const [form, setForm] = useState<JobFormState>(initial)
  const set = (key: keyof JobFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }))

  return (
    <div className="space-y-3 rounded-lg border border-primary-100 bg-primary-50/40 p-4">
      {error && <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <Field label="岗位名称" required>
        <input className={inputCls} placeholder="如：销售顾问" value={form.title} onChange={set('title')} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="薪资范围">
          <input className={inputCls} placeholder="如：8-12K" value={form.salary} onChange={set('salary')} />
        </Field>
        <Field label="城市">
          <input className={inputCls} placeholder="如：北京" value={form.city} onChange={set('city')} />
        </Field>
      </div>

      <Field label="岗位类别">
        <input className={inputCls} placeholder="如：全职 / 兼职 / 实习" value={form.category} onChange={set('category')} />
      </Field>

      <Field label="岗位描述">
        <textarea className={`${inputCls} h-16 resize-none`} placeholder="岗位职责说明" value={form.description} onChange={set('description')} />
      </Field>

      <Field label="任职要求">
        <textarea className={`${inputCls} h-16 resize-none`} placeholder="学历、技能、经验要求" value={form.requirements} onChange={set('requirements')} />
      </Field>

      <div className="flex justify-end gap-2">
        <GhostButton disabled={busy} onClick={onCancel}>取消</GhostButton>
        <PrimaryButton disabled={busy} onClick={() => onSubmit(form)}>
          {busy ? '保存中…' : '保存'}
        </PrimaryButton>
      </div>
    </div>
  )
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface JobsDrawerProps {
  open: boolean
  agencyId: string | null
  agencyName: string
  onClose: () => void
  onJobCountChange?: (count: number) => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function JobsDrawer({ open, agencyId, agencyName, onClose, onJobCountChange }: JobsDrawerProps) {
  const [jobs,        setJobs]        = useState<OfflineAgencyJob[]>([])
  const [loadState,   setLoadState]   = useState<'loading' | 'error' | 'ready'>('loading')
  const [formMode,    setFormMode]    = useState<'none' | 'create' | 'edit'>('none')
  const [editingJob,  setEditingJob]  = useState<OfflineAgencyJob | null>(null)
  const [busy,        setBusy]        = useState(false)
  const [formError,   setFormError]   = useState<string | null>(null)
  const [deletingId,  setDeletingId]  = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!agencyId) return
    setLoadState('loading')
    try {
      const data = await offlineAgenciesAdminService.listJobs(agencyId)
      setJobs(data)
      onJobCountChange?.(data.length)
      setLoadState('ready')
    } catch {
      setLoadState('error')
    }
  }, [agencyId, onJobCountChange])

  useEffect(() => {
    if (open && agencyId) {
      setFormMode('none')
      setFormError(null)
      void load()
    }
  }, [open, agencyId, load])

  const handleCreate = async (f: JobFormState) => {
    if (!agencyId) return
    const err = validateJob(f)
    if (err) { setFormError(err); return }
    setBusy(true); setFormError(null)
    try {
      const created = await offlineAgenciesAdminService.createJob(agencyId, formToJobInput(f))
      setJobs((prev) => [created, ...prev])
      onJobCountChange?.(jobs.length + 1)
      setFormMode('none')
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '创建失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const handleUpdate = async (f: JobFormState) => {
    if (!agencyId || !editingJob) return
    const err = validateJob(f)
    if (err) { setFormError(err); return }
    setBusy(true); setFormError(null)
    try {
      const updated = await offlineAgenciesAdminService.updateJob(agencyId, editingJob.id, formToJobInput(f))
      setJobs((prev) => prev.map((j) => j.id === editingJob.id ? updated : j))
      setFormMode('none')
      setEditingJob(null)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '更新失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (jobId: string) => {
    if (!agencyId) return
    setDeletingId(jobId)
    try {
      await offlineAgenciesAdminService.deleteJob(agencyId, jobId)
      setJobs((prev) => prev.filter((j) => j.id !== jobId))
      onJobCountChange?.(jobs.length - 1)
    } catch {
      // 静默失败，刷新列表
      void load()
    } finally {
      setDeletingId(null)
    }
  }

  const openEdit = (job: OfflineAgencyJob) => {
    setEditingJob(job)
    setFormMode('edit')
    setFormError(null)
  }

  const cancelForm = () => {
    setFormMode('none')
    setEditingJob(null)
    setFormError(null)
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`岗位管理 — ${agencyName}`}
      size="lg"
      footer={
        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-400">仅作信息展示，不参与平台内投递</span>
          <GhostButton onClick={onClose}>关闭</GhostButton>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 新增按钮 */}
        {formMode === 'none' && (
          <button
            onClick={() => { setFormMode('create'); setFormError(null) }}
            className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-200 py-3 text-sm font-medium text-neutral-500 hover:border-primary-300 hover:text-primary-600"
          >
            <PlusIcon className="h-4 w-4" />
            新增岗位
          </button>
        )}

        {/* 新建表单 */}
        {formMode === 'create' && (
          <JobFormPanel
            initial={EMPTY_JOB}
            busy={busy}
            error={formError}
            onCancel={cancelForm}
            onSubmit={(f) => void handleCreate(f)}
          />
        )}

        {/* 列表 */}
        {loadState === 'loading' && (
          <div className="flex h-32 items-center justify-center">
            <p className="text-sm text-neutral-400">加载中…</p>
          </div>
        )}

        {loadState === 'error' && (
          <div className="flex h-32 items-center justify-center">
            <p className="text-sm text-red-500">加载失败，请重试</p>
          </div>
        )}

        {loadState === 'ready' && jobs.length === 0 && formMode !== 'create' && (
          <EmptyState
            title="暂无岗位"
            description="点击上方按钮添加线下招聘岗位"
            icon={BriefcaseIcon}
            className="py-10"
          />
        )}

        {loadState === 'ready' && jobs.map((job) => (
          <div key={job.id} className="rounded-lg border border-neutral-100 bg-white">
            {/* 编辑表单（展开） */}
            {formMode === 'edit' && editingJob?.id === job.id ? (
              <div className="p-3">
                <JobFormPanel
                  initial={jobToForm(job)}
                  busy={busy}
                  error={formError}
                  onCancel={cancelForm}
                  onSubmit={(f) => void handleUpdate(f)}
                />
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-neutral-800">{job.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                    {job.salary && <span>{job.salary}</span>}
                    {job.city && <span>{job.city}</span>}
                    {job.category && <span>{job.category}</span>}
                  </div>
                  <div className="mt-1.5">
                    <StatusBadge dot status={JOB_REVIEW_BADGE[job.reviewStatus]?.status ?? 'default'} label={JOB_REVIEW_BADGE[job.reviewStatus]?.label ?? job.reviewStatus} />
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => openEdit(job)}
                    className="rounded p-1.5 text-neutral-400 hover:bg-neutral-50 hover:text-neutral-700"
                    title="编辑"
                  >
                    <PencilIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => { if (window.confirm(`确定删除岗位「${job.title}」？`)) void handleDelete(job.id) }}
                    disabled={deletingId === job.id}
                    className="rounded p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                    title="删除"
                  >
                    <Trash2Icon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Drawer>
  )
}
